import CloudKit
import CryptoKit
import Foundation
import UIKit

extension Notification.Name {
    static let lifeOSCloudKitPush = Notification.Name("lifeos.native.cloudkit.push")
}

final class LifeOSCloudKitPushRequest {
    private let lock = NSLock()
    private var completed = false
    private let completion: (UIBackgroundFetchResult) -> Void

    init(completion: @escaping (UIBackgroundFetchResult) -> Void) {
        self.completion = completion
    }

    func finish(_ result: UIBackgroundFetchResult) {
        lock.lock()
        guard !completed else {
            lock.unlock()
            return
        }
        completed = true
        lock.unlock()
        completion(result)
    }
}

struct LifeOSCloudSyncReport: Codable, Equatable {
    let accountStatus: String
    let changed: Int
    let deleted: Int
    let rejected: Int
    let pagesFetched: Int
    let passes: Int
    let moreComing: Bool
    let subscriptionReady: Bool
    let accountChanged: Bool
    let resetZoneCount: Int
    let syncedAt: Date
}

enum LifeOSCloudSyncOutcome: Equatable {
    case newData
    case noData
    case failed

    var backgroundFetchResult: UIBackgroundFetchResult {
        switch self {
        case .newData: return .newData
        case .noData: return .noData
        case .failed: return .failed
        }
    }
}

enum LifeOSCloudSyncError: LocalizedError, Equatable {
    case noAccount
    case restricted
    case accountChanged
    case networkUnavailable
    case temporarilyUnavailable
    case unavailable
    case invalidContainer

    var errorDescription: String? {
        switch self {
        case .noAccount: return NSLocalizedString("cloud.error.noAccount", comment: "")
        case .restricted: return NSLocalizedString("cloud.error.restricted", comment: "")
        case .accountChanged: return NSLocalizedString("cloud.error.accountChanged", comment: "")
        case .networkUnavailable: return NSLocalizedString("cloud.error.network", comment: "")
        case .temporarilyUnavailable: return NSLocalizedString("cloud.error.temporary", comment: "")
        case .unavailable: return NSLocalizedString("cloud.error.unavailable", comment: "")
        case .invalidContainer: return NSLocalizedString("cloud.error.invalidContainer", comment: "")
        }
    }

    static func userFacing(_ error: Error) -> LifeOSCloudSyncError {
        guard let cloudError = error as? CKError else { return .unavailable }
        switch cloudError.code {
        case .notAuthenticated: return .noAccount
        case .accountTemporarilyUnavailable: return .temporarilyUnavailable
        case .networkFailure, .networkUnavailable: return .networkUnavailable
        case .requestRateLimited, .serviceUnavailable, .zoneBusy: return .temporarilyUnavailable
        default: return .unavailable
        }
    }
}

final class LifeOSCloudKitClient {
    private let containerIdentifier: String
    private let container: CKContainer
    private let database: CKDatabase
    private let zones = [
        "LifeOSChatZone",
        "LifeOSMemoryZone",
        "LifeOSTaskZone",
        "LifeOSGeneratedAppZone",
        "LifeOSDeviceTrustZone",
    ]
    private let desiredKeys = [
        "lifeosSchema",
        "lifeosDataType",
        "sourceIdHash",
        "mutationId",
        "logicalClock",
        "contentHash",
        "payloadByteSize",
        "requiresUserReview",
        "payloadJson",
    ]
    private let subscriptionId = "lifeos-native-mobile-private-changes-v1"
    private let maxRecords = 100
    private let maxPages = 10

    init(containerIdentifier: String = LifeOSCloudKitClient.configuredContainerIdentifier) {
        self.containerIdentifier = containerIdentifier
        container = CKContainer(identifier: containerIdentifier)
        database = container.privateCloudDatabase
    }

    static var configuredContainerIdentifier: String {
        let value = (Bundle.main.object(forInfoDictionaryKey: "LifeOSCloudKitContainerIdentifier") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.hasPrefix("iCloud.") ? value : "iCloud.ai.lifeos.desktop"
    }

    func currentAccountFingerprint() async throws -> String {
        let account = try await container.accountStatus()
        guard account == .available else {
            if account == .noAccount { throw LifeOSCloudSyncError.noAccount }
            if account == .restricted { throw LifeOSCloudSyncError.restricted }
            throw LifeOSCloudSyncError.unavailable
        }
        let userRecordId = try await container.userRecordID()
        return LifeOSCloudAccountIdentity.fingerprint(
            containerIdentifier: containerIdentifier,
            userRecordName: userRecordId.recordName
        )
    }

    func sync(snapshot: LifeOSCloudSnapshot, now: Date = Date()) async throws -> (LifeOSCloudSnapshot, LifeOSCloudSyncReport) {
        let accountFingerprint = try await currentAccountFingerprint()
        let scoped = snapshot.scoped(to: accountFingerprint)
        let currentSnapshot = scoped.snapshot

        let subscriptionReady = await ensureSubscription()
        var changed: [LifeOSCloudRecord] = []
        var deleted = Set<String>()
        var tokens: [String: Data] = [:]
        var resetZones = Set<String>()
        var rejected = 0
        var pagesFetched = 0
        var moreComing = false

        for zone in zones {
            if changed.count + deleted.count >= maxRecords {
                moreComing = true
                break
            }
            let zoneId = CKRecordZone.ID(zoneName: zone, ownerName: CKCurrentUserDefaultName)
            var cursor = decodeToken(currentSnapshot.serverChangeTokens[zone])
            var zoneMoreComing = true
            var zoneRejected = false
            var zonePages = 0
            var didResetExpiredToken = false

            while zoneMoreComing && zonePages < maxPages && changed.count + deleted.count < maxRecords {
                let remaining = max(1, maxRecords - changed.count - deleted.count)
                do {
                    let result = try await database.recordZoneChanges(
                        inZoneWith: zoneId,
                        since: cursor,
                        desiredKeys: desiredKeys,
                        resultsLimit: min(100, remaining)
                    )
                    zonePages += 1
                    pagesFetched += 1

                    for (_, recordResult) in result.modificationResultsByID {
                        switch recordResult {
                        case .success(let modification):
                            do {
                                changed.append(try validatedRecord(modification.record, zone: zone))
                            } catch {
                                rejected += 1
                                zoneRejected = true
                            }
                        case .failure:
                            rejected += 1
                            zoneRejected = true
                        }
                    }
                    for deletion in result.deletions {
                        deleted.insert("\(zone)/\(deletion.recordID.recordName)")
                    }
                    cursor = result.changeToken
                    zoneMoreComing = result.moreComing
                } catch let error as CKError where error.code == .changeTokenExpired && cursor != nil && !didResetExpiredToken {
                    changed.removeAll { $0.zone == zone }
                    deleted = Set(deleted.filter { !$0.hasPrefix("\(zone)/") })
                    cursor = nil
                    resetZones.insert(zone)
                    didResetExpiredToken = true
                    zonePages = 0
                    continue
                } catch let error as CKError where error.code == .zoneNotFound {
                    resetZones.insert(zone)
                    cursor = nil
                    zoneMoreComing = false
                    break
                }
            }

            if zoneMoreComing || zoneRejected { moreComing = true }
            if !zoneRejected, let encoded = encodeToken(cursor) { tokens[zone] = encoded }
        }

        let next = currentSnapshot.merging(
            changed: changed,
            deletedRecordIds: deleted,
            serverChangeTokens: tokens,
            accountFingerprint: accountFingerprint,
            resetZones: resetZones,
            moreComing: moreComing,
            now: now
        )
        return (next, LifeOSCloudSyncReport(
            accountStatus: "available",
            changed: changed.count,
            deleted: deleted.count,
            rejected: rejected,
            pagesFetched: pagesFetched,
            passes: 1,
            moreComing: moreComing,
            subscriptionReady: subscriptionReady,
            accountChanged: scoped.didReset,
            resetZoneCount: resetZones.count,
            syncedAt: now
        ))
    }

    func completeTaskListItem(
        snapshotRecord: LifeOSCloudRecord,
        itemId: String,
        mutationId: String,
        expectedAccountFingerprint: String,
        now: Date = Date()
    ) async throws -> LifeOSCloudRecord {
        guard snapshotRecord.zone == "LifeOSTaskZone",
              snapshotRecord.recordType == "LifeOSTaskListSnapshot",
              snapshotRecord.recordName == "task-list:lifeos_tasks_pro",
              !snapshotRecord.requiresUserReview else {
            throw LifeOSCloudTaskWriteError.invalidRecord
        }
        let currentFingerprint = try await currentAccountFingerprint()
        guard currentFingerprint == expectedAccountFingerprint else { throw LifeOSCloudSyncError.accountChanged }
        guard mutationId.range(of: "^ios-task-complete:[0-9a-f]{64}$", options: .regularExpression) != nil else {
            throw LifeOSCloudTaskWriteError.invalidRecord
        }
        let zoneId = CKRecordZone.ID(zoneName: snapshotRecord.zone, ownerName: CKCurrentUserDefaultName)
        let recordId = CKRecord.ID(recordName: snapshotRecord.recordName, zoneID: zoneId)
        let cloudRecord = try await database.record(for: recordId)
        let current = try validatedRecord(cloudRecord, zone: snapshotRecord.zone)
        if current.contentHash != snapshotRecord.contentHash {
            if isMatchingTaskCompletion(current, itemId: itemId, baseContentHash: snapshotRecord.contentHash) {
                return current
            }
            throw LifeOSCloudTaskWriteError.stale
        }
        let mutation = try LifeOSCloudTaskMutationBuilder.complete(record: current, itemId: itemId, now: now)
        cloudRecord["mutationId"] = mutationId as CKRecordValue
        cloudRecord["logicalClock"] = NSNumber(value: mutation.logicalClock)
        cloudRecord["contentHash"] = mutation.contentHash as CKRecordValue
        cloudRecord["payloadByteSize"] = NSNumber(value: mutation.payloadByteSize)
        cloudRecord["requiresUserReview"] = NSNumber(value: false)
        cloudRecord["payloadJson"] = mutation.payloadJson as CKRecordValue
        cloudRecord["lifeosSyncedAt"] = now as CKRecordValue

        do {
            let result = try await database.modifyRecords(
                saving: [cloudRecord],
                deleting: [],
                savePolicy: .ifServerRecordUnchanged,
                atomically: true
            )
            guard let saveResult = result.saveResults[recordId] else { throw LifeOSCloudTaskWriteError.saveFailed }
            switch saveResult {
            case .success(let saved):
                return try validatedRecord(saved, zone: snapshotRecord.zone)
            case .failure(let error as CKError) where error.code == .serverRecordChanged:
                return try await resolveTaskConflict(
                    recordId: recordId,
                    snapshotRecord: snapshotRecord,
                    itemId: itemId
                )
            case .failure(let error):
                throw error
            }
        } catch let error as CKError where error.code == .serverRecordChanged {
            return try await resolveTaskConflict(
                recordId: recordId,
                snapshotRecord: snapshotRecord,
                itemId: itemId
            )
        }
    }

    func createMemory(
        title: String,
        text: String,
        memoryId: String,
        now: Date = Date()
    ) async throws -> (record: LifeOSCloudRecord, accountFingerprint: String) {
        let accountFingerprint = try await currentAccountFingerprint()
        let candidate = try LifeOSCloudMemoryMutationBuilder.create(
            title: title,
            text: text,
            memoryId: memoryId,
            now: now
        )
        let record = try await saveMemoryRecord(
            candidate,
            expectedAccountFingerprint: accountFingerprint,
            now: now
        )
        return (record, accountFingerprint)
    }

    func saveMemoryRecord(
        _ input: LifeOSCloudRecord,
        expectedAccountFingerprint: String,
        now: Date = Date()
    ) async throws -> LifeOSCloudRecord {
        let accountFingerprint = try await currentAccountFingerprint()
        guard accountFingerprint == expectedAccountFingerprint else { throw LifeOSCloudSyncError.accountChanged }
        let candidate = try LifeOSCloudPendingMutation.validateMemoryRecord(input)
        let zoneId = CKRecordZone.ID(zoneName: candidate.zone, ownerName: CKCurrentUserDefaultName)
        try await ensureZone(zoneId)
        let recordId = CKRecord.ID(recordName: candidate.recordName, zoneID: zoneId)
        let cloudRecord = CKRecord(recordType: candidate.recordType, recordID: recordId)
        cloudRecord["lifeosSchema"] = "lifeos-cloudkit-record.v1" as CKRecordValue
        cloudRecord["lifeosDataType"] = candidate.dataType as CKRecordValue
        cloudRecord["lifeosRecordType"] = candidate.recordType as CKRecordValue
        cloudRecord["lifeosRecordName"] = candidate.recordName as CKRecordValue
        cloudRecord["sourceIdHash"] = candidate.sourceIdHash as CKRecordValue
        cloudRecord["mutationId"] = candidate.mutationId as CKRecordValue
        cloudRecord["logicalClock"] = NSNumber(value: candidate.logicalClock)
        cloudRecord["contentHash"] = candidate.contentHash as CKRecordValue
        cloudRecord["payloadByteSize"] = NSNumber(value: candidate.payloadJson.utf8.count)
        cloudRecord["requiresUserReview"] = NSNumber(value: false)
        cloudRecord["payloadJson"] = candidate.payloadJson as CKRecordValue
        cloudRecord["lifeosSyncedAt"] = now as CKRecordValue

        do {
            let result = try await database.modifyRecords(
                saving: [cloudRecord],
                deleting: [],
                savePolicy: .ifServerRecordUnchanged,
                atomically: true
            )
            guard let saveResult = result.saveResults[recordId] else { throw LifeOSCloudMemoryWriteError.saveFailed }
            switch saveResult {
            case .success(let saved):
                return try validatedRecord(saved, zone: candidate.zone)
            case .failure(let error as CKError) where error.code == .serverRecordChanged:
                return try await resolveMemoryCollision(recordId: recordId, candidate: candidate)
            case .failure(let error):
                throw error
            }
        } catch let error as CKError where error.code == .serverRecordChanged {
            return try await resolveMemoryCollision(recordId: recordId, candidate: candidate)
        }
    }

    private func resolveMemoryCollision(
        recordId: CKRecord.ID,
        candidate: LifeOSCloudRecord
    ) async throws -> LifeOSCloudRecord {
        let existing = try validatedRecord(try await database.record(for: recordId), zone: candidate.zone)
        guard existing.mutationId == candidate.mutationId,
              existing.contentHash == candidate.contentHash else {
            throw LifeOSCloudMemoryWriteError.collision
        }
        return existing
    }

    private func resolveTaskConflict(
        recordId: CKRecord.ID,
        snapshotRecord: LifeOSCloudRecord,
        itemId: String
    ) async throws -> LifeOSCloudRecord {
        let current = try validatedRecord(try await database.record(for: recordId), zone: snapshotRecord.zone)
        guard isMatchingTaskCompletion(
            current,
            itemId: itemId,
            baseContentHash: snapshotRecord.contentHash
        ) else { throw LifeOSCloudTaskWriteError.stale }
        return current
    }

    private func isMatchingTaskCompletion(
        _ record: LifeOSCloudRecord,
        itemId: String,
        baseContentHash: String
    ) -> Bool {
        guard record.taskItems.contains(where: { $0.id == itemId && $0.completed }),
              let payload = try? JSONSerialization.jsonObject(with: Data(record.payloadJson.utf8)) as? [String: Any],
              let metadata = payload["syncMutation"] as? [String: Any] else { return false }
        return metadata["kind"] as? String == "task-list-item-complete" &&
            metadata["itemId"] as? String == itemId &&
            metadata["baseContentHash"] as? String == baseContentHash
    }

    private func validatedRecord(_ record: CKRecord, zone: String) throws -> LifeOSCloudRecord {
        try LifeOSCloudRecordValidator.validate(LifeOSCloudRecordInput(
            zone: zone,
            recordType: record.recordType,
            recordName: record.recordID.recordName,
            lifeosSchema: record["lifeosSchema"] as? String ?? "",
            lifeosDataType: record["lifeosDataType"] as? String ?? "",
            sourceIdHash: record["sourceIdHash"] as? String ?? "",
            mutationId: record["mutationId"] as? String ?? "",
            logicalClock: (record["logicalClock"] as? NSNumber)?.int64Value ?? 0,
            contentHash: record["contentHash"] as? String ?? "",
            payloadByteSize: (record["payloadByteSize"] as? NSNumber)?.intValue ?? 0,
            requiresUserReview: (record["requiresUserReview"] as? NSNumber)?.boolValue ?? true,
            payloadJson: record["payloadJson"] as? String ?? "",
            modifiedAt: record.modificationDate
        ))
    }

    private func ensureZone(_ zoneId: CKRecordZone.ID) async throws {
        do {
            _ = try await database.recordZone(for: zoneId)
        } catch let error as CKError where error.code == .zoneNotFound {
            _ = try await database.save(CKRecordZone(zoneID: zoneId))
        }
    }

    private func ensureSubscription() async -> Bool {
        if (try? await database.subscription(for: subscriptionId)) != nil { return true }
        let subscription = CKDatabaseSubscription(subscriptionID: subscriptionId)
        let info = CKSubscription.NotificationInfo()
        info.shouldSendContentAvailable = true
        subscription.notificationInfo = info
        return (try? await database.save(subscription)) != nil
    }

    private func encodeToken(_ token: CKServerChangeToken?) -> Data? {
        guard let token else { return nil }
        return try? NSKeyedArchiver.archivedData(withRootObject: token, requiringSecureCoding: true)
    }

    private func decodeToken(_ data: Data?) -> CKServerChangeToken? {
        guard let data else { return nil }
        return try? NSKeyedUnarchiver.unarchivedObject(ofClass: CKServerChangeToken.self, from: data)
    }
}

@MainActor
final class LifeOSCloudDataStore: ObservableObject {
    enum StatusTone: Equatable { case neutral, success, warning, error }
    enum NextAction: Equatable {
        case none
        case retry
        case continueSync
        case checkAccount

        var localizationKey: String {
            switch self {
            case .none: return ""
            case .retry: return "cloud.action.retry"
            case .continueSync: return "cloud.action.continue"
            case .checkAccount: return "cloud.action.checkAccount"
            }
        }
    }

    @Published private(set) var snapshot: LifeOSCloudSnapshot
    @Published private(set) var report: LifeOSCloudSyncReport?
    @Published private(set) var isSyncing = false
    @Published private(set) var statusMessage = ""
    @Published private(set) var statusTone: StatusTone = .neutral
    @Published private(set) var nextAction: NextAction = .none
    @Published private(set) var writingTaskRecordId: String?
    @Published private(set) var writingMemory = false
    @Published private(set) var isProcessingPendingMutations = false
    @Published private(set) var pendingMutationCount = 0
    @Published private(set) var reviewMutationCount = 0
    @Published private(set) var otherAccountMutationCount = 0
    @Published private(set) var enabled: Bool
    private(set) var lastSyncOutcome: LifeOSCloudSyncOutcome = .noData

    var isWriting: Bool { writingTaskRecordId != nil || writingMemory || isProcessingPendingMutations }
    var totalMutationCount: Int { pendingMutationCount + reviewMutationCount + otherAccountMutationCount }

    private let enabledKey = "lifeos.native.cloud-data-enabled.v1"
    private let fileURL: URL
    private var mutationOutbox: LifeOSCloudMutationOutbox
    private var notificationObserver: NSObjectProtocol?
    private var accountObserver: NSObjectProtocol?
    private var retryTask: Task<Void, Never>?
    private var retryAttempt = 0
    private let maxCatchUpPasses = 3
    private let simulatorDemoMode: Bool
    private lazy var client = LifeOSCloudKitClient()

    init(demoModeOverride: Bool? = nil, mutationOutboxURLOverride: URL? = nil) {
        fileURL = Self.snapshotFileURL()
        mutationOutbox = LifeOSCloudMutationOutbox(
            fileURL: mutationOutboxURLOverride ?? Self.mutationOutboxFileURL()
        )
        #if targetEnvironment(simulator)
        let demoMode = demoModeOverride ?? ProcessInfo.processInfo.arguments.contains("--cloud-data-demo")
        #else
        let demoMode = false
        #endif
        simulatorDemoMode = demoMode
        enabled = demoMode || UserDefaults.standard.bool(forKey: enabledKey)
        #if targetEnvironment(simulator)
        snapshot = demoMode ? Self.simulatorDemoSnapshot() : Self.loadSnapshot(from: fileURL)
        #else
        snapshot = Self.loadSnapshot(from: fileURL)
        #endif
        #if targetEnvironment(simulator)
        if demoMode {
            statusMessage = NSLocalizedString("cloud.status.ready", comment: "")
            statusTone = .success
            if ProcessInfo.processInfo.arguments.contains("--cloud-outbox-demo") {
                seedSimulatorMutationOutbox()
            }
        }
        #endif
        refreshMutationSummary()
        notificationObserver = NotificationCenter.default.addObserver(
            forName: .lifeOSCloudKitPush,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            let request = notification.object as? LifeOSCloudKitPushRequest
            Task { @MainActor in
                guard let self else {
                    request?.finish(.failed)
                    return
                }
                _ = await self.sync(reason: "push")
                request?.finish(self.lastSyncOutcome.backgroundFetchResult)
            }
        }
        accountObserver = NotificationCenter.default.addObserver(
            forName: Notification.Name.CKAccountChanged,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                await self?.handleAccountChanged()
            }
        }
    }

    deinit {
        if let notificationObserver { NotificationCenter.default.removeObserver(notificationObserver) }
        if let accountObserver { NotificationCenter.default.removeObserver(accountObserver) }
        retryTask?.cancel()
    }

    func enableAndSync() async {
        enabled = true
        UserDefaults.standard.set(true, forKey: enabledKey)
        await sync(reason: "enable")
    }

    @discardableResult
    func sync(reason: String = "manual") async -> Bool {
        guard enabled, !isSyncing, !isWriting else {
            lastSyncOutcome = .noData
            return false
        }
        if simulatorDemoMode {
            statusMessage = NSLocalizedString("cloud.status.ready", comment: "")
            statusTone = .success
            nextAction = .none
            lastSyncOutcome = .noData
            return false
        }
        if reason == "retry" {
            retryTask = nil
        } else {
            retryTask?.cancel()
            retryTask = nil
        }
        isSyncing = true
        statusMessage = NSLocalizedString("cloud.status.syncing", comment: "")
        statusTone = .neutral
        nextAction = .none
        defer { isSyncing = false }
        do {
            #if targetEnvironment(simulator)
            throw LifeOSCloudSyncError.invalidContainer
            #else
            var currentSnapshot = snapshot
            var combinedReport: LifeOSCloudSyncReport?
            for _ in 0..<maxCatchUpPasses {
                let (next, passReport) = try await client.sync(snapshot: currentSnapshot)
                try save(next)
                currentSnapshot = next
                snapshot = next
                combinedReport = combine(combinedReport, with: passReport)
                if !passReport.moreComing || passReport.rejected > 0 { break }
                try await Task.sleep(nanoseconds: 250_000_000)
            }
            guard let nextReport = combinedReport else { return false }
            report = nextReport
            if nextReport.rejected > 0 {
                statusMessage = String(
                    format: NSLocalizedString("cloud.status.reviewRequired", comment: ""),
                    nextReport.rejected
                )
                statusTone = .warning
            } else if nextReport.moreComing {
                statusMessage = NSLocalizedString("cloud.status.moreComing", comment: "")
                statusTone = .warning
                nextAction = .continueSync
                scheduleRetry(after: 2)
            } else if nextReport.accountChanged {
                statusMessage = NSLocalizedString("cloud.status.accountChanged", comment: "")
                statusTone = .success
                retryAttempt = 0
            } else if nextReport.resetZoneCount > 0 {
                statusMessage = NSLocalizedString("cloud.status.cursorRebuilt", comment: "")
                statusTone = .success
                retryAttempt = 0
            } else {
                statusMessage = NSLocalizedString("cloud.status.ready", comment: "")
                statusTone = .success
                retryAttempt = 0
            }
            let hasNewData = nextReport.changed > 0 ||
                nextReport.deleted > 0 ||
                nextReport.accountChanged ||
                nextReport.resetZoneCount > 0
            let uploaded = await processPendingMutations(accountFingerprint: currentSnapshot.accountFingerprint)
            let changedAnything = hasNewData || uploaded > 0
            lastSyncOutcome = changedAnything ? .newData : .noData
            return changedAnything
            #endif
        } catch {
            let userError = error as? LifeOSCloudSyncError ?? LifeOSCloudSyncError.userFacing(error)
            if userError == .noAccount || userError == .restricted {
                clearAccountScopedSnapshot()
                nextAction = .checkAccount
            } else if userError == .invalidContainer {
                nextAction = .none
            } else {
                nextAction = .retry
                retryAttempt = min(retryAttempt + 1, 6)
                scheduleRetry(after: retryDelay(for: error))
            }
            statusMessage = userError.errorDescription ?? NSLocalizedString("cloud.error.unavailable", comment: "")
            statusTone = .error
            lastSyncOutcome = .failed
            return false
        }
    }

    func performNextAction() async {
        switch nextAction {
        case .retry, .continueSync, .checkAccount:
            await sync(reason: "next-action")
        case .none:
            break
        }
    }

    func completeTaskListItem(record: LifeOSCloudRecord, item: LifeOSCloudTaskItem) async {
        guard enabled, !isSyncing, !isWriting else { return }
        writingTaskRecordId = "\(record.id)/\(item.id)"
        statusMessage = NSLocalizedString("cloud.task.status.writing", comment: "")
        statusTone = .neutral
        nextAction = .none
        defer { writingTaskRecordId = nil }
        do {
            #if targetEnvironment(simulator)
            guard simulatorDemoMode else { throw LifeOSCloudSyncError.invalidContainer }
            let mutation = try LifeOSCloudTaskMutationBuilder.complete(record: record, itemId: item.id, now: Date())
            let updatedRecord = LifeOSCloudRecord(
                zone: record.zone,
                recordType: record.recordType,
                recordName: record.recordName,
                dataType: record.dataType,
                sourceIdHash: record.sourceIdHash,
                mutationId: "simulator-task-complete",
                logicalClock: mutation.logicalClock,
                contentHash: mutation.contentHash,
                requiresUserReview: false,
                payloadJson: mutation.payloadJson,
                modifiedAt: Date()
            )
            snapshot = snapshot.merging(
                changed: [updatedRecord],
                deletedRecordIds: [],
                serverChangeTokens: [:],
                accountFingerprint: snapshot.accountFingerprint ?? "simulator-demo",
                moreComing: false,
                now: Date()
            )
            statusMessage = String(
                format: NSLocalizedString("cloud.task.status.completed", comment: ""),
                item.text
            )
            statusTone = .success
            #else
            guard let accountFingerprint = snapshot.accountFingerprint else {
                statusMessage = NSLocalizedString("cloud.outbox.error.syncFirst", comment: "")
                statusTone = .warning
                nextAction = .continueSync
                return
            }
            let pending = try LifeOSCloudPendingMutation.taskCompletion(
                record: record,
                itemId: item.id,
                accountFingerprint: accountFingerprint,
                now: Date()
            )
            _ = try mutationOutbox.enqueue(pending)
            refreshMutationSummary()
            statusMessage = NSLocalizedString("cloud.task.status.queued", comment: "")
            statusTone = .warning
            _ = await processPendingMutations(accountFingerprint: accountFingerprint)
            if let retained = mutationOutbox.entries.first(where: { $0.id == pending.id }) {
                statusMessage = NSLocalizedString(
                    retained.state == .needsReview ? "cloud.outbox.status.review" : "cloud.task.status.queued",
                    comment: ""
                )
                statusTone = .warning
            } else {
                statusMessage = String(
                    format: NSLocalizedString("cloud.task.status.completed", comment: ""),
                    item.text
                )
                statusTone = .success
            }
            #endif
        } catch let error as LifeOSCloudTaskWriteError {
            statusMessage = error.errorDescription ?? NSLocalizedString("cloud.task.error.failed", comment: "")
            statusTone = .error
            if error == .stale { nextAction = .continueSync }
        } catch let error as LifeOSCloudMutationOutboxError {
            statusMessage = NSLocalizedString(
                error == .full ? "cloud.outbox.error.full" : "cloud.outbox.error.storage",
                comment: ""
            )
            statusTone = .error
        } catch let error as LifeOSCloudSyncError {
            statusMessage = error.errorDescription ?? NSLocalizedString("cloud.task.error.failed", comment: "")
            statusTone = .error
        } catch {
            statusMessage = LifeOSCloudSyncError.userFacing(error).errorDescription
                ?? NSLocalizedString("cloud.task.error.failed", comment: "")
            statusTone = .error
            nextAction = .continueSync
        }
    }

    func createMemory(
        title: String,
        text: String,
        memoryId: String = "ios-memory-\(UUID().uuidString.lowercased())"
    ) async -> Bool {
        guard enabled, !isSyncing, !isWriting else { return false }
        writingMemory = true
        statusMessage = NSLocalizedString("cloud.memory.status.writing", comment: "")
        statusTone = .neutral
        nextAction = .none
        defer { writingMemory = false }
        do {
            #if targetEnvironment(simulator)
            guard simulatorDemoMode else { throw LifeOSCloudSyncError.invalidContainer }
            if snapshot.records.contains(where: { $0.zone == "LifeOSMemoryZone" && $0.recordName == "memory:\(memoryId)" }) {
                throw LifeOSCloudMemoryWriteError.collision
            }
            let createdRecord = try LifeOSCloudMemoryMutationBuilder.create(
                title: title,
                text: text,
                memoryId: memoryId,
                now: Date()
            )
            snapshot = snapshot.merging(
                changed: [createdRecord],
                deletedRecordIds: [],
                serverChangeTokens: [:],
                accountFingerprint: snapshot.accountFingerprint ?? "simulator-demo",
                moreComing: false,
                now: Date()
            )
            #else
            guard let accountFingerprint = snapshot.accountFingerprint else {
                statusMessage = NSLocalizedString("cloud.outbox.error.syncFirst", comment: "")
                statusTone = .warning
                nextAction = .continueSync
                return false
            }
            let candidate = try LifeOSCloudMemoryMutationBuilder.create(
                title: title,
                text: text,
                memoryId: memoryId,
                now: Date()
            )
            let pending = try LifeOSCloudPendingMutation.memory(
                record: candidate,
                accountFingerprint: accountFingerprint,
                now: Date()
            )
            _ = try mutationOutbox.enqueue(pending)
            refreshMutationSummary()
            statusMessage = NSLocalizedString("cloud.memory.status.queued", comment: "")
            statusTone = .warning
            _ = await processPendingMutations(accountFingerprint: accountFingerprint)
            if let retained = mutationOutbox.entries.first(where: { $0.id == pending.id }) {
                statusMessage = NSLocalizedString(
                    retained.state == .needsReview ? "cloud.outbox.status.review" : "cloud.memory.status.queued",
                    comment: ""
                )
                statusTone = .warning
            } else {
                statusMessage = NSLocalizedString("cloud.memory.status.saved", comment: "")
                statusTone = .success
            }
            return true
            #endif
            statusMessage = NSLocalizedString("cloud.memory.status.saved", comment: "")
            statusTone = .success
            return true
        } catch let error as LifeOSCloudMemoryWriteError {
            statusMessage = error.errorDescription ?? NSLocalizedString("cloud.memory.error.failed", comment: "")
            statusTone = .error
            if error == .collision { nextAction = .continueSync }
            return false
        } catch let error as LifeOSCloudMutationOutboxError {
            statusMessage = NSLocalizedString(
                error == .full ? "cloud.outbox.error.full" : "cloud.outbox.error.storage",
                comment: ""
            )
            statusTone = .error
            return false
        } catch let error as LifeOSCloudSyncError {
            statusMessage = error.errorDescription ?? NSLocalizedString("cloud.memory.error.failed", comment: "")
            statusTone = .error
            return false
        } catch {
            statusMessage = LifeOSCloudSyncError.userFacing(error).errorDescription
                ?? NSLocalizedString("cloud.memory.error.failed", comment: "")
            statusTone = .error
            nextAction = .continueSync
            return false
        }
    }

    func disableAndClear() {
        retryTask?.cancel()
        retryTask = nil
        enabled = false
        UserDefaults.standard.removeObject(forKey: enabledKey)
        try? FileManager.default.removeItem(at: fileURL)
        let clearedPendingActions = (try? mutationOutbox.clear()) != nil
        snapshot = .empty
        report = nil
        lastSyncOutcome = .noData
        statusMessage = NSLocalizedString(
            clearedPendingActions ? "cloud.status.cleared" : "cloud.outbox.error.storage",
            comment: ""
        )
        statusTone = clearedPendingActions ? .neutral : .error
        nextAction = .none
        refreshMutationSummary()
    }

    func retryPendingMutations() async {
        guard enabled, !isSyncing, !isWriting else { return }
        guard let accountFingerprint = snapshot.accountFingerprint else {
            await sync(reason: "outbox-account-check")
            return
        }
        do {
            try mutationOutbox.makeDue(accountFingerprint: accountFingerprint)
            refreshMutationSummary()
            await sync(reason: "outbox-manual")
        } catch {
            statusMessage = NSLocalizedString("cloud.outbox.error.storage", comment: "")
            statusTone = .error
        }
    }

    func clearPendingMutations() {
        do {
            try mutationOutbox.clear()
            refreshMutationSummary()
            statusMessage = NSLocalizedString("cloud.outbox.status.cleared", comment: "")
            statusTone = .neutral
        } catch {
            statusMessage = NSLocalizedString("cloud.outbox.error.storage", comment: "")
            statusTone = .error
        }
    }

    func isTaskCompletionQueued(record: LifeOSCloudRecord, item: LifeOSCloudTaskItem) -> Bool {
        guard let accountFingerprint = snapshot.accountFingerprint else { return false }
        return mutationOutbox.entries.contains {
            $0.kind == .taskComplete &&
                $0.accountFingerprint == accountFingerprint &&
                $0.taskRecord?.id == record.id &&
                $0.taskItemId == item.id
        }
    }

    private func processPendingMutations(accountFingerprint: String?) async -> Int {
        guard let accountFingerprint else {
            refreshMutationSummary()
            return 0
        }
        let due = mutationOutbox.due(accountFingerprint: accountFingerprint)
        guard !due.isEmpty else {
            refreshMutationSummary()
            return 0
        }
        isProcessingPendingMutations = true
        defer { isProcessingPendingMutations = false }
        var uploaded = 0

        for entry in due {
            do {
                let savedRecord: LifeOSCloudRecord
                switch entry.kind {
                case .memoryCreate:
                    guard let memoryRecord = entry.memoryRecord else {
                        throw LifeOSCloudMutationOutboxError.invalidMutation
                    }
                    savedRecord = try await client.saveMemoryRecord(
                        memoryRecord,
                        expectedAccountFingerprint: accountFingerprint
                    )
                case .taskComplete:
                    guard let taskRecord = entry.taskRecord, let taskItemId = entry.taskItemId else {
                        throw LifeOSCloudMutationOutboxError.invalidMutation
                    }
                    savedRecord = try await client.completeTaskListItem(
                        snapshotRecord: taskRecord,
                        itemId: taskItemId,
                        mutationId: entry.id,
                        expectedAccountFingerprint: accountFingerprint
                    )
                }
                let next = snapshot.merging(
                    changed: [savedRecord],
                    deletedRecordIds: [],
                    serverChangeTokens: [:],
                    accountFingerprint: accountFingerprint,
                    moreComing: snapshot.moreComing,
                    now: Date()
                )
                try save(next)
                try mutationOutbox.remove(id: entry.id)
                snapshot = next
                uploaded += 1
            } catch {
                if mutationRequiresReview(error) {
                    try? mutationOutbox.markNeedsReview(id: entry.id)
                    statusMessage = NSLocalizedString("cloud.outbox.status.review", comment: "")
                    statusTone = .warning
                    continue
                }
                let delay = mutationRetryDelay(for: entry, error: error)
                do {
                    try mutationOutbox.markAttempt(id: entry.id, retryAt: Date().addingTimeInterval(delay))
                    scheduleRetry(after: delay)
                    statusMessage = NSLocalizedString("cloud.outbox.status.waiting", comment: "")
                    statusTone = .warning
                } catch {
                    statusMessage = NSLocalizedString("cloud.outbox.error.storage", comment: "")
                    statusTone = .error
                }
                break
            }
        }
        refreshMutationSummary()
        if !mutationOutbox.due(accountFingerprint: accountFingerprint, limit: 1).isEmpty {
            scheduleRetry(after: 1)
        }
        if reviewMutationCount > 0 && statusTone != .error {
            statusMessage = NSLocalizedString("cloud.outbox.status.review", comment: "")
            statusTone = .warning
        }
        return uploaded
    }

    private func mutationRequiresReview(_ error: Error) -> Bool {
        if let syncError = error as? LifeOSCloudSyncError {
            return syncError == .accountChanged
        }
        if let taskError = error as? LifeOSCloudTaskWriteError {
            return taskError != .saveFailed
        }
        if let memoryError = error as? LifeOSCloudMemoryWriteError {
            return memoryError != .saveFailed
        }
        if let outboxError = error as? LifeOSCloudMutationOutboxError {
            return outboxError == .invalidMutation
        }
        return error is LifeOSCloudRecordError
    }

    private func mutationRetryDelay(for entry: LifeOSCloudPendingMutation, error: Error) -> TimeInterval {
        if let cloudError = error as? CKError,
           let retryAfter = cloudError.userInfo[CKErrorRetryAfterKey] as? NSNumber {
            return max(1, min(retryAfter.doubleValue, 300))
        }
        return min(5 * pow(2, Double(entry.attempts)), 300)
    }

    private func refreshMutationSummary() {
        let summary = mutationOutbox.summary(accountFingerprint: snapshot.accountFingerprint)
        pendingMutationCount = summary.pending
        reviewMutationCount = summary.needsReview
        otherAccountMutationCount = summary.otherAccount
    }

    private func combine(_ current: LifeOSCloudSyncReport?, with next: LifeOSCloudSyncReport) -> LifeOSCloudSyncReport {
        guard let current else { return next }
        return LifeOSCloudSyncReport(
            accountStatus: next.accountStatus,
            changed: current.changed + next.changed,
            deleted: current.deleted + next.deleted,
            rejected: current.rejected + next.rejected,
            pagesFetched: current.pagesFetched + next.pagesFetched,
            passes: current.passes + next.passes,
            moreComing: next.moreComing,
            subscriptionReady: current.subscriptionReady || next.subscriptionReady,
            accountChanged: current.accountChanged || next.accountChanged,
            resetZoneCount: current.resetZoneCount + next.resetZoneCount,
            syncedAt: next.syncedAt
        )
    }

    private func handleAccountChanged() async {
        guard enabled else { return }
        retryTask?.cancel()
        retryTask = nil
        clearAccountScopedSnapshot()
        statusMessage = NSLocalizedString("cloud.status.accountChecking", comment: "")
        statusTone = .neutral
        nextAction = .none
        await sync(reason: "account-change")
    }

    private func clearAccountScopedSnapshot() {
        try? FileManager.default.removeItem(at: fileURL)
        snapshot = .empty
        report = nil
        refreshMutationSummary()
    }

    private func scheduleRetry(after seconds: TimeInterval) {
        guard enabled else { return }
        retryTask?.cancel()
        let nanoseconds = UInt64(max(1, min(seconds, 300)) * 1_000_000_000)
        retryTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: nanoseconds)
            guard !Task.isCancelled else { return }
            await self?.sync(reason: "retry")
        }
    }

    private func retryDelay(for error: Error) -> TimeInterval {
        if let cloudError = error as? CKError,
           let retryAfter = cloudError.userInfo[CKErrorRetryAfterKey] as? NSNumber {
            return max(1, min(retryAfter.doubleValue, 300))
        }
        return min(5 * pow(2, Double(max(0, retryAttempt - 1))), 300)
    }

    private func save(_ snapshot: LifeOSCloudSnapshot) throws {
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(snapshot)
        try data.write(to: fileURL, options: [.atomic])
        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: fileURL.path
        )
        var protectedURL = fileURL
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try protectedURL.setResourceValues(values)
    }

    private static func snapshotFileURL() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return base.appendingPathComponent("LifeOS", isDirectory: true).appendingPathComponent("cloud-snapshot-v1.json")
    }

    private static func mutationOutboxFileURL() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return base.appendingPathComponent("LifeOS", isDirectory: true)
            .appendingPathComponent("cloud-mutation-outbox-v1.json")
    }

    private static func loadSnapshot(from url: URL) -> LifeOSCloudSnapshot {
        guard let data = try? Data(contentsOf: url),
              let snapshot = try? JSONDecoder().decode(LifeOSCloudSnapshot.self, from: data),
              snapshot.schemaVersion == 1 else { return .empty }
        return snapshot
    }

    #if targetEnvironment(simulator)
    private func seedSimulatorMutationOutbox() {
        guard let accountFingerprint = snapshot.accountFingerprint,
              let record = snapshot.records.first(where: { $0.recordType == "LifeOSTaskListSnapshot" }),
              let item = record.taskItems.first(where: { !$0.completed }),
              let pending = try? LifeOSCloudPendingMutation.taskCompletion(
                  record: record,
                  itemId: item.id,
                  accountFingerprint: accountFingerprint,
                  now: Date()
              ) else { return }
        _ = try? mutationOutbox.enqueue(pending)
    }

    private static func simulatorDemoSnapshot() -> LifeOSCloudSnapshot {
        let payload: [String: Any] = [
            "taskListKey": "lifeos_tasks_pro",
            "items": [
                [
                    "id": "demo-1",
                    "text": NSLocalizedString("cloud.demo.task.review", comment: ""),
                    "completed": false,
                    "priority": "high",
                    "createdAt": 1_700_000_000_000,
                ],
                [
                    "id": "demo-2",
                    "text": NSLocalizedString("cloud.demo.task.online", comment: ""),
                    "completed": true,
                    "priority": "medium",
                    "createdAt": 1_700_000_001_000,
                ],
            ],
            "updatedAt": 1_700_000_002_000,
        ]
        guard let payloadData = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
              let payloadJson = String(data: payloadData, encoding: .utf8) else { return .empty }
        let contentHash = SHA256.hash(data: payloadData).map { String(format: "%02x", $0) }.joined()
        let record = LifeOSCloudRecord(
            zone: "LifeOSTaskZone",
            recordType: "LifeOSTaskListSnapshot",
            recordName: "task-list:lifeos_tasks_pro",
            dataType: "tasks",
            sourceIdHash: "tasks:simulator-demo",
            mutationId: "simulator-demo",
            logicalClock: 1_700_000_002_000,
            contentHash: contentHash,
            requiresUserReview: false,
            payloadJson: payloadJson,
            modifiedAt: Date(timeIntervalSince1970: 1_700_000_002)
        )
        let accountFingerprint = LifeOSCloudAccountIdentity.fingerprint(
            containerIdentifier: "iCloud.ai.lifeos.desktop",
            userRecordName: "simulator-demo"
        )
        return LifeOSCloudSnapshot(
            schemaVersion: 1,
            accountFingerprint: accountFingerprint,
            updatedAt: Date(),
            records: [record],
            serverChangeTokens: [:],
            moreComing: false
        )
    }
    #endif
}
