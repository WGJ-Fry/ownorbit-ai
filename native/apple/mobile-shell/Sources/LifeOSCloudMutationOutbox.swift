import CryptoKit
import Foundation

enum LifeOSCloudPendingMutationKind: String, Codable, Equatable {
    case memoryCreate
    case taskComplete
}

enum LifeOSCloudPendingMutationState: String, Codable, Equatable {
    case pending
    case needsReview
}

struct LifeOSCloudPendingMutation: Codable, Equatable, Identifiable {
    let schemaVersion: Int
    let id: String
    let accountFingerprint: String
    let kind: LifeOSCloudPendingMutationKind
    let createdAt: Date
    var attempts: Int
    var nextRetryAt: Date?
    var state: LifeOSCloudPendingMutationState
    let memoryRecord: LifeOSCloudRecord?
    let taskRecord: LifeOSCloudRecord?
    let taskItemId: String?

    static func memory(
        record: LifeOSCloudRecord,
        accountFingerprint: String,
        now: Date
    ) throws -> LifeOSCloudPendingMutation {
        let validatedRecord = try validateMemoryRecord(record)
        return try validated(LifeOSCloudPendingMutation(
            schemaVersion: 1,
            id: validatedRecord.mutationId,
            accountFingerprint: accountFingerprint,
            kind: .memoryCreate,
            createdAt: now,
            attempts: 0,
            nextRetryAt: nil,
            state: .pending,
            memoryRecord: validatedRecord,
            taskRecord: nil,
            taskItemId: nil
        ), now: now)
    }

    static func taskCompletion(
        record: LifeOSCloudRecord,
        itemId: String,
        accountFingerprint: String,
        now: Date
    ) throws -> LifeOSCloudPendingMutation {
        _ = try LifeOSCloudTaskMutationBuilder.complete(record: record, itemId: itemId, now: now)
        return try validated(LifeOSCloudPendingMutation(
            schemaVersion: 1,
            id: taskMutationId(
                record: record,
                itemId: itemId,
                accountFingerprint: accountFingerprint
            ),
            accountFingerprint: accountFingerprint,
            kind: .taskComplete,
            createdAt: now,
            attempts: 0,
            nextRetryAt: nil,
            state: .pending,
            memoryRecord: nil,
            taskRecord: record,
            taskItemId: itemId
        ), now: now)
    }

    static func validated(_ mutation: LifeOSCloudPendingMutation, now: Date) throws -> LifeOSCloudPendingMutation {
        guard mutation.schemaVersion == 1,
              mutation.accountFingerprint.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
              mutation.id.utf8.count <= 160,
              mutation.attempts >= 0,
              mutation.attempts <= LifeOSCloudMutationOutbox.maxAttempts,
              mutation.createdAt <= now.addingTimeInterval(24 * 60 * 60),
              mutation.createdAt >= now.addingTimeInterval(-LifeOSCloudMutationOutbox.maxAge) else {
            throw LifeOSCloudMutationOutboxError.invalidMutation
        }
        switch mutation.kind {
        case .memoryCreate:
            guard mutation.id.hasPrefix("ios-memory-create:"),
                  let record = mutation.memoryRecord,
                  mutation.taskRecord == nil,
                  mutation.taskItemId == nil else {
                throw LifeOSCloudMutationOutboxError.invalidMutation
            }
            _ = try validateMemoryRecord(record)
            guard mutation.id == record.mutationId else {
                throw LifeOSCloudMutationOutboxError.invalidMutation
            }
        case .taskComplete:
            guard mutation.id.range(of: "^ios-task-complete:[0-9a-f]{64}$", options: .regularExpression) != nil,
                  mutation.memoryRecord == nil,
                  let record = mutation.taskRecord,
                  let itemId = mutation.taskItemId,
                  !record.requiresUserReview,
                  !itemId.isEmpty,
                  itemId.utf8.count <= 256 else {
                throw LifeOSCloudMutationOutboxError.invalidMutation
            }
            let validatedRecord = try validateRecord(record)
            guard mutation.id == taskMutationId(
                record: validatedRecord,
                itemId: itemId,
                accountFingerprint: mutation.accountFingerprint
            ) else {
                throw LifeOSCloudMutationOutboxError.invalidMutation
            }
            _ = try LifeOSCloudTaskMutationBuilder.complete(
                record: validatedRecord,
                itemId: itemId,
                now: mutation.createdAt
            )
        }
        return mutation
    }

    static func validateMemoryRecord(_ record: LifeOSCloudRecord) throws -> LifeOSCloudRecord {
        let validated = try validateRecord(record)
        guard validated.zone == "LifeOSMemoryZone",
              validated.recordType == "LifeOSMemory",
              !validated.requiresUserReview,
              let payload = try? JSONSerialization.jsonObject(with: Data(validated.payloadJson.utf8)) as? [String: Any],
              let memoryId = payload["memoryId"] as? String,
              let title = payload["title"] as? String,
              let text = payload["text"] as? String,
              let createdAt = (payload["createdAt"] as? NSNumber)?.int64Value,
              payload["sensitivity"] as? String == "normal",
              let metadata = payload["syncMutation"] as? [String: Any],
              metadata["kind"] as? String == "memory-create",
              metadata["origin"] as? String == "ios-native",
              validated.recordName == "memory:\(memoryId)",
              validated.mutationId == "ios-memory-create:\(memoryId)" else {
            throw LifeOSCloudMutationOutboxError.invalidMutation
        }
        let rebuilt = try LifeOSCloudMemoryMutationBuilder.create(
            title: title,
            text: text,
            memoryId: memoryId,
            now: Date(timeIntervalSince1970: TimeInterval(createdAt) / 1000)
        )
        guard rebuilt.zone == validated.zone,
              rebuilt.recordType == validated.recordType,
              rebuilt.recordName == validated.recordName,
              rebuilt.dataType == validated.dataType,
              rebuilt.sourceIdHash == validated.sourceIdHash,
              rebuilt.mutationId == validated.mutationId,
              rebuilt.logicalClock == validated.logicalClock,
              rebuilt.contentHash == validated.contentHash,
              rebuilt.payloadJson == validated.payloadJson else {
            throw LifeOSCloudMutationOutboxError.invalidMutation
        }
        return validated
    }

    private static func validateRecord(_ record: LifeOSCloudRecord) throws -> LifeOSCloudRecord {
        try LifeOSCloudRecordValidator.validate(LifeOSCloudRecordInput(
            zone: record.zone,
            recordType: record.recordType,
            recordName: record.recordName,
            lifeosSchema: "lifeos-cloudkit-record.v1",
            lifeosDataType: record.dataType,
            sourceIdHash: record.sourceIdHash,
            mutationId: record.mutationId,
            logicalClock: record.logicalClock,
            contentHash: record.contentHash,
            payloadByteSize: record.payloadJson.utf8.count,
            requiresUserReview: record.requiresUserReview,
            payloadJson: record.payloadJson,
            modifiedAt: record.modifiedAt
        ))
    }

    private static func taskMutationId(
        record: LifeOSCloudRecord,
        itemId: String,
        accountFingerprint: String
    ) -> String {
        let seed = "\(accountFingerprint)|\(record.id)|\(itemId)|\(record.contentHash)"
        let digest = SHA256.hash(data: Data(seed.utf8)).map { String(format: "%02x", $0) }.joined()
        return "ios-task-complete:\(digest)"
    }
}

enum LifeOSCloudMutationOutboxError: Error, Equatable {
    case invalidMutation
    case full
    case storage
}

struct LifeOSCloudMutationOutboxSummary: Equatable {
    let pending: Int
    let needsReview: Int
    let otherAccount: Int

    var total: Int { pending + needsReview + otherAccount }
}

struct LifeOSCloudMutationOutbox {
    static let maxEntries = 50
    static let maxEncodedBytes = 512 * 1024
    static let maxAttempts = 8
    static let maxAge: TimeInterval = 30 * 24 * 60 * 60

    private struct Envelope: Codable {
        let schemaVersion: Int
        let entries: [LifeOSCloudPendingMutation]
    }

    private(set) var entries: [LifeOSCloudPendingMutation]
    let fileURL: URL

    init(fileURL: URL, now: Date = Date()) {
        self.fileURL = fileURL
        entries = Self.load(from: fileURL, now: now)
    }

    @discardableResult
    mutating func enqueue(_ mutation: LifeOSCloudPendingMutation, now: Date = Date()) throws -> Bool {
        let candidate = try LifeOSCloudPendingMutation.validated(mutation, now: now)
        if let existing = entries.first(where: { $0.id == candidate.id }) {
            guard existing.accountFingerprint == candidate.accountFingerprint,
                  existing.kind == candidate.kind else {
                throw LifeOSCloudMutationOutboxError.invalidMutation
            }
            return false
        }
        guard entries.count < Self.maxEntries else { throw LifeOSCloudMutationOutboxError.full }
        try commit(entries + [candidate])
        return true
    }

    func summary(accountFingerprint: String?) -> LifeOSCloudMutationOutboxSummary {
        guard let accountFingerprint else {
            return LifeOSCloudMutationOutboxSummary(pending: 0, needsReview: 0, otherAccount: entries.count)
        }
        var pending = 0
        var needsReview = 0
        var otherAccount = 0
        for entry in entries {
            guard entry.accountFingerprint == accountFingerprint else {
                otherAccount += 1
                continue
            }
            if entry.state == .pending { pending += 1 }
            else { needsReview += 1 }
        }
        return LifeOSCloudMutationOutboxSummary(
            pending: pending,
            needsReview: needsReview,
            otherAccount: otherAccount
        )
    }

    func due(accountFingerprint: String, now: Date = Date(), limit: Int = 10) -> [LifeOSCloudPendingMutation] {
        entries
            .filter {
                $0.accountFingerprint == accountFingerprint &&
                    $0.state == .pending &&
                    ($0.nextRetryAt == nil || $0.nextRetryAt! <= now)
            }
            .sorted { $0.createdAt < $1.createdAt }
            .prefix(max(0, limit))
            .map { $0 }
    }

    mutating func makeDue(accountFingerprint: String) throws {
        var next = entries
        for index in next.indices where next[index].accountFingerprint == accountFingerprint && next[index].state == .pending {
            next[index].nextRetryAt = nil
        }
        try commit(next)
    }

    mutating func markAttempt(id: String, retryAt: Date?) throws {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
        var next = entries
        next[index].attempts = min(next[index].attempts + 1, Self.maxAttempts)
        if next[index].attempts >= Self.maxAttempts {
            next[index].state = .needsReview
            next[index].nextRetryAt = nil
        } else {
            next[index].nextRetryAt = retryAt
        }
        try commit(next)
    }

    mutating func markNeedsReview(id: String) throws {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
        var next = entries
        next[index].state = .needsReview
        next[index].nextRetryAt = nil
        try commit(next)
    }

    mutating func remove(id: String) throws {
        guard entries.contains(where: { $0.id == id }) else { return }
        try commit(entries.filter { $0.id != id })
    }

    mutating func clear() throws {
        do {
            if FileManager.default.fileExists(atPath: fileURL.path) {
                try FileManager.default.removeItem(at: fileURL)
            }
            entries = []
        } catch {
            throw LifeOSCloudMutationOutboxError.storage
        }
    }

    private mutating func commit(_ next: [LifeOSCloudPendingMutation]) throws {
        guard next.count <= Self.maxEntries else { throw LifeOSCloudMutationOutboxError.full }
        let data: Data
        do {
            data = try Self.encoded(next)
        } catch {
            throw LifeOSCloudMutationOutboxError.storage
        }
        guard data.count <= Self.maxEncodedBytes else { throw LifeOSCloudMutationOutboxError.full }
        do {
            try Self.persist(data, to: fileURL)
        } catch {
            throw LifeOSCloudMutationOutboxError.storage
        }
        entries = next
    }

    private static func load(from fileURL: URL, now: Date) -> [LifeOSCloudPendingMutation] {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: fileURL.path),
              let size = attributes[.size] as? NSNumber,
              size.intValue > 0,
              size.intValue <= maxEncodedBytes,
              let data = try? Data(contentsOf: fileURL),
              let envelope = try? JSONDecoder().decode(Envelope.self, from: data),
              envelope.schemaVersion == 1,
              envelope.entries.count <= maxEntries else { return [] }
        return envelope.entries.compactMap { try? LifeOSCloudPendingMutation.validated($0, now: now) }
    }

    private static func encoded(_ entries: [LifeOSCloudPendingMutation]) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(Envelope(schemaVersion: 1, entries: entries))
    }

    private static func persist(_ data: Data, to fileURL: URL) throws {
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
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
}
