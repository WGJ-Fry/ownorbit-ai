import CloudKit
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
    let moreComing: Bool
    let subscriptionReady: Bool
    let syncedAt: Date
}

enum LifeOSCloudSyncError: LocalizedError {
    case noAccount
    case restricted
    case unavailable
    case invalidContainer

    var errorDescription: String? {
        switch self {
        case .noAccount: return NSLocalizedString("cloud.error.noAccount", comment: "")
        case .restricted: return NSLocalizedString("cloud.error.restricted", comment: "")
        case .unavailable: return NSLocalizedString("cloud.error.unavailable", comment: "")
        case .invalidContainer: return NSLocalizedString("cloud.error.invalidContainer", comment: "")
        }
    }
}

final class LifeOSCloudKitClient {
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
        container = CKContainer(identifier: containerIdentifier)
        database = container.privateCloudDatabase
    }

    static var configuredContainerIdentifier: String {
        let value = (Bundle.main.object(forInfoDictionaryKey: "LifeOSCloudKitContainerIdentifier") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.hasPrefix("iCloud.") ? value : "iCloud.ai.lifeos.desktop"
    }

    func sync(snapshot: LifeOSCloudSnapshot, now: Date = Date()) async throws -> (LifeOSCloudSnapshot, LifeOSCloudSyncReport) {
        let account = try await container.accountStatus()
        guard account == .available else {
            if account == .noAccount { throw LifeOSCloudSyncError.noAccount }
            if account == .restricted { throw LifeOSCloudSyncError.restricted }
            throw LifeOSCloudSyncError.unavailable
        }

        let subscriptionReady = await ensureSubscription()
        var changed: [LifeOSCloudRecord] = []
        var deleted = Set<String>()
        var tokens: [String: Data] = [:]
        var rejected = 0
        var pagesFetched = 0
        var moreComing = false

        for zone in zones {
            if changed.count + deleted.count >= maxRecords {
                moreComing = true
                break
            }
            let zoneId = CKRecordZone.ID(zoneName: zone, ownerName: CKCurrentUserDefaultName)
            var cursor = decodeToken(snapshot.serverChangeTokens[zone])
            var zoneMoreComing = true
            var zoneRejected = false
            var zonePages = 0

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
                } catch let error as CKError where error.code == .zoneNotFound {
                    zoneMoreComing = false
                    break
                }
            }

            if zoneMoreComing || zoneRejected { moreComing = true }
            if !zoneRejected, let encoded = encodeToken(cursor) { tokens[zone] = encoded }
        }

        let next = snapshot.merging(
            changed: changed,
            deletedRecordIds: deleted,
            serverChangeTokens: tokens,
            moreComing: moreComing,
            now: now
        )
        return (next, LifeOSCloudSyncReport(
            accountStatus: "available",
            changed: changed.count,
            deleted: deleted.count,
            rejected: rejected,
            pagesFetched: pagesFetched,
            moreComing: moreComing,
            subscriptionReady: subscriptionReady,
            syncedAt: now
        ))
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
    enum StatusTone { case neutral, success, warning, error }

    @Published private(set) var snapshot: LifeOSCloudSnapshot
    @Published private(set) var report: LifeOSCloudSyncReport?
    @Published private(set) var isSyncing = false
    @Published private(set) var statusMessage = ""
    @Published private(set) var statusTone: StatusTone = .neutral
    @Published private(set) var enabled: Bool

    private let enabledKey = "lifeos.native.cloud-data-enabled.v1"
    private let fileURL: URL
    private var notificationObserver: NSObjectProtocol?
    private lazy var client = LifeOSCloudKitClient()

    init() {
        enabled = UserDefaults.standard.bool(forKey: enabledKey)
        fileURL = Self.snapshotFileURL()
        snapshot = Self.loadSnapshot(from: fileURL)
        notificationObserver = NotificationCenter.default.addObserver(
            forName: .lifeOSCloudKitPush,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            let request = notification.object as? LifeOSCloudKitPushRequest
            Task { @MainActor in
                let synced = await self?.sync(reason: "push") ?? false
                request?.finish(synced ? .newData : .noData)
            }
        }
    }

    deinit {
        if let notificationObserver { NotificationCenter.default.removeObserver(notificationObserver) }
    }

    func enableAndSync() async {
        enabled = true
        UserDefaults.standard.set(true, forKey: enabledKey)
        await sync(reason: "enable")
    }

    @discardableResult
    func sync(reason: String = "manual") async -> Bool {
        guard enabled, !isSyncing else { return false }
        isSyncing = true
        statusMessage = NSLocalizedString("cloud.status.syncing", comment: "")
        statusTone = .neutral
        defer { isSyncing = false }
        do {
            #if targetEnvironment(simulator)
            throw LifeOSCloudSyncError.invalidContainer
            #else
            let (next, nextReport) = try await client.sync(snapshot: snapshot)
            try save(next)
            snapshot = next
            report = nextReport
            statusMessage = nextReport.moreComing
                ? NSLocalizedString("cloud.status.moreComing", comment: "")
                : NSLocalizedString("cloud.status.ready", comment: "")
            statusTone = nextReport.rejected > 0 || nextReport.moreComing ? .warning : .success
            return true
            #endif
        } catch {
            statusMessage = (error as? LocalizedError)?.errorDescription
                ?? NSLocalizedString("cloud.error.unavailable", comment: "")
            statusTone = .error
            return false
        }
    }

    func disableAndClear() {
        enabled = false
        UserDefaults.standard.removeObject(forKey: enabledKey)
        try? FileManager.default.removeItem(at: fileURL)
        snapshot = .empty
        report = nil
        statusMessage = NSLocalizedString("cloud.status.cleared", comment: "")
        statusTone = .neutral
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

    private static func loadSnapshot(from url: URL) -> LifeOSCloudSnapshot {
        guard let data = try? Data(contentsOf: url),
              let snapshot = try? JSONDecoder().decode(LifeOSCloudSnapshot.self, from: data),
              snapshot.schemaVersion == 1 else { return .empty }
        return snapshot
    }
}
