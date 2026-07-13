import CryptoKit
import Foundation

struct LifeOSCloudRecordInput {
    let zone: String
    let recordType: String
    let recordName: String
    let lifeosSchema: String
    let lifeosDataType: String
    let sourceIdHash: String
    let mutationId: String
    let logicalClock: Int64
    let contentHash: String
    let payloadByteSize: Int
    let requiresUserReview: Bool
    let payloadJson: String
    let modifiedAt: Date?
}

struct LifeOSCloudRecord: Codable, Equatable, Identifiable {
    let zone: String
    let recordType: String
    let recordName: String
    let dataType: String
    let sourceIdHash: String
    let mutationId: String
    let logicalClock: Int64
    let contentHash: String
    let requiresUserReview: Bool
    let payloadJson: String
    let modifiedAt: Date?

    var id: String { "\(zone)/\(recordName)" }

    var displayTitle: String {
        let payload = decodedPayload
        switch recordType {
        case "LifeOSConversation":
            return string(payload["title"], fallback: NSLocalizedString("cloud.item.conversation", comment: ""))
        case "LifeOSMessage":
            return string(payload["conversationTitle"], fallback: NSLocalizedString("cloud.item.message", comment: ""))
        case "LifeOSMemory", "LifeOSMemoryTombstone":
            return string(payload["title"], fallback: NSLocalizedString("cloud.item.memory", comment: ""))
        case "LifeOSTask", "LifeOSTaskTombstone":
            if let input = payload["input"] as? [String: Any] {
                return string(input["title"], fallback: string(payload["type"], fallback: NSLocalizedString("cloud.item.task", comment: "")))
            }
            return string(payload["type"], fallback: NSLocalizedString("cloud.item.task", comment: ""))
        case "LifeOSTaskListSnapshot":
            return NSLocalizedString("cloud.item.taskList", comment: "")
        default:
            return recordType
        }
    }

    var displayBody: String {
        let payload = decodedPayload
        switch recordType {
        case "LifeOSMessage":
            if let content = payload["contentJson"] as? [String: Any], let parts = content["parts"] as? [[String: Any]] {
                return parts.compactMap { $0["text"] as? String }.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
            }
        case "LifeOSMemory", "LifeOSMemoryTombstone":
            return string(payload["text"])
        case "LifeOSTask", "LifeOSTaskTombstone":
            return string(payload["state"])
        case "LifeOSTaskListSnapshot":
            let count = (payload["items"] as? [Any])?.count ?? 0
            return String(format: NSLocalizedString("cloud.item.taskCount", comment: ""), count)
        default:
            break
        }
        return ""
    }

    var taskItems: [LifeOSCloudTaskItem] {
        guard recordType == "LifeOSTaskListSnapshot",
              let items = decodedPayload["items"] as? [[String: Any]] else { return [] }
        return items.prefix(50).compactMap { item in
            guard let rawId = item["id"], let text = item["text"] as? String else { return nil }
            let id: String
            if let value = rawId as? String { id = value }
            else if let value = rawId as? NSNumber { id = value.stringValue }
            else { return nil }
            let normalizedText = text.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !id.isEmpty, !normalizedText.isEmpty else { return nil }
            return LifeOSCloudTaskItem(
                id: String(id.prefix(80)),
                text: String(normalizedText.prefix(500)),
                completed: item["completed"] as? Bool ?? false,
                priority: item["priority"] as? String ?? "medium",
                createdAt: (item["createdAt"] as? NSNumber)?.int64Value ?? 0
            )
        }
    }

    private var decodedPayload: [String: Any] {
        guard let data = payloadJson.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return object
    }

    private func string(_ value: Any?, fallback: String = "") -> String {
        guard let text = value as? String else { return fallback }
        let compact = text.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return compact.isEmpty ? fallback : String(compact.prefix(500))
    }
}

struct LifeOSCloudTaskItem: Equatable, Identifiable {
    let id: String
    let text: String
    let completed: Bool
    let priority: String
    let createdAt: Int64
}

struct LifeOSCloudTaskCompletionMutation: Equatable {
    let payloadJson: String
    let contentHash: String
    let payloadByteSize: Int
    let logicalClock: Int64
}

enum LifeOSCloudTaskWriteError: LocalizedError, Equatable {
    case stale
    case invalidRecord
    case taskNotFound
    case alreadyCompleted
    case saveFailed

    var errorDescription: String? {
        switch self {
        case .stale: return NSLocalizedString("cloud.task.error.stale", comment: "")
        case .invalidRecord: return NSLocalizedString("cloud.task.error.invalid", comment: "")
        case .taskNotFound: return NSLocalizedString("cloud.task.error.notFound", comment: "")
        case .alreadyCompleted: return NSLocalizedString("cloud.task.error.completed", comment: "")
        case .saveFailed: return NSLocalizedString("cloud.task.error.failed", comment: "")
        }
    }
}

enum LifeOSCloudTaskMutationBuilder {
    static func complete(
        record: LifeOSCloudRecord,
        itemId: String,
        now: Date
    ) throws -> LifeOSCloudTaskCompletionMutation {
        guard record.zone == "LifeOSTaskZone",
              record.recordType == "LifeOSTaskListSnapshot",
              record.recordName == "task-list:lifeos_tasks_pro",
              !record.requiresUserReview,
              let payloadData = record.payloadJson.data(using: .utf8),
              var payload = try JSONSerialization.jsonObject(with: payloadData) as? [String: Any],
              payload["taskListKey"] as? String == "lifeos_tasks_pro",
              var items = payload["items"] as? [[String: Any]] else {
            throw LifeOSCloudTaskWriteError.invalidRecord
        }
        guard let itemIndex = items.firstIndex(where: { item in
            if let value = item["id"] as? String { return value == itemId }
            if let value = item["id"] as? NSNumber { return value.stringValue == itemId }
            return false
        }) else { throw LifeOSCloudTaskWriteError.taskNotFound }
        if items[itemIndex]["completed"] as? Bool == true { throw LifeOSCloudTaskWriteError.alreadyCompleted }
        items[itemIndex]["completed"] = true
        let wallClock = Int64(now.timeIntervalSince1970 * 1000)
        let nextClock = record.logicalClock.addingReportingOverflow(1)
        guard !nextClock.overflow else { throw LifeOSCloudTaskWriteError.invalidRecord }
        let timestamp = max(wallClock, nextClock.partialValue)
        payload["items"] = items
        payload["updatedAt"] = NSNumber(value: timestamp)
        payload["syncMutation"] = [
            "kind": "task-list-item-complete",
            "origin": "ios-native",
            "itemId": itemId,
            "baseContentHash": record.contentHash,
            "mutatedAt": NSNumber(value: timestamp),
        ]
        guard JSONSerialization.isValidJSONObject(payload) else { throw LifeOSCloudTaskWriteError.invalidRecord }
        let nextPayloadData = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys, .withoutEscapingSlashes])
        guard !nextPayloadData.isEmpty,
              nextPayloadData.count <= LifeOSCloudRecordValidator.maxPayloadBytes,
              let payloadJson = String(data: nextPayloadData, encoding: .utf8) else {
            throw LifeOSCloudTaskWriteError.invalidRecord
        }
        let contentHash = SHA256.hash(data: nextPayloadData).map { String(format: "%02x", $0) }.joined()
        return LifeOSCloudTaskCompletionMutation(
            payloadJson: payloadJson,
            contentHash: contentHash,
            payloadByteSize: nextPayloadData.count,
            logicalClock: timestamp
        )
    }
}

enum LifeOSCloudMemoryWriteError: LocalizedError, Equatable {
    case emptyTitle
    case emptyText
    case tooLong
    case unsafeContent
    case collision
    case saveFailed

    var errorDescription: String? {
        switch self {
        case .emptyTitle: return NSLocalizedString("cloud.memory.error.title", comment: "")
        case .emptyText: return NSLocalizedString("cloud.memory.error.text", comment: "")
        case .tooLong: return NSLocalizedString("cloud.memory.error.length", comment: "")
        case .unsafeContent: return NSLocalizedString("cloud.memory.error.unsafe", comment: "")
        case .collision: return NSLocalizedString("cloud.memory.error.collision", comment: "")
        case .saveFailed: return NSLocalizedString("cloud.memory.error.failed", comment: "")
        }
    }
}

enum LifeOSCloudMemoryMutationBuilder {
    static let maxTitleLength = 120
    static let maxTextLength = 4000

    static func create(
        title: String,
        text: String,
        memoryId: String,
        now: Date
    ) throws -> LifeOSCloudRecord {
        let normalizedTitle = title.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedTitle.isEmpty else { throw LifeOSCloudMemoryWriteError.emptyTitle }
        guard !normalizedText.isEmpty else { throw LifeOSCloudMemoryWriteError.emptyText }
        guard normalizedTitle.utf16.count <= maxTitleLength, normalizedText.utf16.count <= maxTextLength else {
            throw LifeOSCloudMemoryWriteError.tooLong
        }
        let idPattern = #"^ios-memory-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"#
        guard memoryId.range(of: idPattern, options: .regularExpression) != nil else {
            throw LifeOSCloudMemoryWriteError.unsafeContent
        }
        let timestamp = Int64(now.timeIntervalSince1970 * 1000)
        guard timestamp > 0 else { throw LifeOSCloudMemoryWriteError.unsafeContent }
        let payload: [String: Any] = [
            "memoryId": memoryId,
            "title": normalizedTitle,
            "text": normalizedText,
            "sensitivity": "normal",
            "createdAt": NSNumber(value: timestamp),
            "updatedAt": NSNumber(value: timestamp),
            "syncMutation": [
                "kind": "memory-create",
                "origin": "ios-native",
                "mutatedAt": NSNumber(value: timestamp),
            ],
        ]
        guard JSONSerialization.isValidJSONObject(payload),
              let payloadData = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys, .withoutEscapingSlashes]),
              let payloadJson = String(data: payloadData, encoding: .utf8) else {
            throw LifeOSCloudMemoryWriteError.unsafeContent
        }
        let contentHash = SHA256.hash(data: payloadData).map { String(format: "%02x", $0) }.joined()
        let sourceHash = SHA256.hash(data: Data(memoryId.utf8)).map { String(format: "%02x", $0) }.joined()
        do {
            return try LifeOSCloudRecordValidator.validate(LifeOSCloudRecordInput(
                zone: "LifeOSMemoryZone",
                recordType: "LifeOSMemory",
                recordName: "memory:\(memoryId)",
                lifeosSchema: "lifeos-cloudkit-record.v1",
                lifeosDataType: "memory",
                sourceIdHash: "memory:\(sourceHash.prefix(16))",
                mutationId: "ios-memory-create:\(memoryId)",
                logicalClock: timestamp,
                contentHash: contentHash,
                payloadByteSize: payloadData.count,
                requiresUserReview: false,
                payloadJson: payloadJson,
                modifiedAt: now
            ))
        } catch {
            throw LifeOSCloudMemoryWriteError.unsafeContent
        }
    }
}

struct LifeOSCloudSnapshot: Codable, Equatable {
    let schemaVersion: Int
    var accountFingerprint: String?
    var updatedAt: Date?
    var records: [LifeOSCloudRecord]
    var serverChangeTokens: [String: Data]
    var moreComing: Bool

    static let empty = LifeOSCloudSnapshot(
        schemaVersion: 1,
        accountFingerprint: nil,
        updatedAt: nil,
        records: [],
        serverChangeTokens: [:],
        moreComing: false
    )

    func scoped(to fingerprint: String) -> (snapshot: LifeOSCloudSnapshot, didReset: Bool) {
        let normalized = fingerprint.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return (.empty, true) }
        if accountFingerprint == normalized {
            return (self, false)
        }
        let hadPreviousScope = accountFingerprint != nil || !records.isEmpty || !serverChangeTokens.isEmpty
        return (LifeOSCloudSnapshot(
            schemaVersion: 1,
            accountFingerprint: normalized,
            updatedAt: nil,
            records: [],
            serverChangeTokens: [:],
            moreComing: false
        ), hadPreviousScope)
    }

    func merging(
        changed: [LifeOSCloudRecord],
        deletedRecordIds: Set<String>,
        serverChangeTokens: [String: Data],
        accountFingerprint: String,
        resetZones: Set<String> = [],
        moreComing: Bool,
        now: Date
    ) -> LifeOSCloudSnapshot {
        var byId = Dictionary(uniqueKeysWithValues: records
            .filter { !resetZones.contains($0.zone) }
            .map { ($0.id, $0) })
        for id in deletedRecordIds { byId.removeValue(forKey: id) }
        for record in changed {
            if let existing = byId[record.id], existing.logicalClock > record.logicalClock { continue }
            byId[record.id] = record
        }
        var nextTokens = self.serverChangeTokens
        for zone in resetZones { nextTokens.removeValue(forKey: zone) }
        for (zone, token) in serverChangeTokens { nextTokens[zone] = token }
        return LifeOSCloudSnapshot(
            schemaVersion: 1,
            accountFingerprint: accountFingerprint,
            updatedAt: now,
            records: byId.values.sorted {
                ($0.modifiedAt ?? .distantPast) > ($1.modifiedAt ?? .distantPast)
            },
            serverChangeTokens: nextTokens,
            moreComing: moreComing
        )
    }
}

enum LifeOSCloudAccountIdentity {
    static func fingerprint(containerIdentifier: String, userRecordName: String) -> String {
        let value = "\(containerIdentifier):\(userRecordName)"
        return SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

enum LifeOSCloudRecordError: Error, Equatable {
    case unsupportedRecord
    case schemaMismatch
    case sourceMismatch
    case payloadTooLarge
    case payloadLengthMismatch
    case contentHashMismatch
    case invalidPayload
    case forbiddenField
    case secretLikeContent
}

enum LifeOSCloudRecordValidator {
    static let maxPayloadBytes = 64 * 1024

    private static let plans: [String: (dataType: String, recordTypes: Set<String>)] = [
        "LifeOSChatZone": ("chat-history", ["LifeOSConversation", "LifeOSMessage"]),
        "LifeOSMemoryZone": ("memory", ["LifeOSMemory", "LifeOSMemoryTombstone"]),
        "LifeOSTaskZone": ("tasks", ["LifeOSTask", "LifeOSTaskTombstone", "LifeOSTaskListSnapshot"]),
        "LifeOSGeneratedAppZone": ("generated-app-state", ["LifeOSGeneratedAppState", "LifeOSGeneratedAppMutation"]),
        "LifeOSDeviceTrustZone": ("device-trust", ["LifeOSDeviceTrust"]),
    ]

    private static let forbiddenField = try! NSRegularExpression(
        pattern: "api[-_]?key|provider[-_]?key|token|password|passphrase|secret|authorization|cookie|private[-_]?key|credential|sqlite|local[-_]?path|file[-_]?path",
        options: [.caseInsensitive]
    )
    private static let forbiddenValue = try! NSRegularExpression(
        pattern: "(?:github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,}|sk-or-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|Bearer\\s+[A-Za-z0-9._~+/=-]+|/Users/[^/\\s]+|[A-Z]:\\\\Users\\\\[^\\\\\\s]+)",
        options: [.caseInsensitive]
    )

    static func validate(_ input: LifeOSCloudRecordInput) throws -> LifeOSCloudRecord {
        guard let plan = plans[input.zone], plan.recordTypes.contains(input.recordType) else {
            throw LifeOSCloudRecordError.unsupportedRecord
        }
        guard input.lifeosSchema == "lifeos-cloudkit-record.v1", input.lifeosDataType == plan.dataType else {
            throw LifeOSCloudRecordError.schemaMismatch
        }
        guard input.sourceIdHash.hasPrefix("\(plan.dataType):") else {
            throw LifeOSCloudRecordError.sourceMismatch
        }
        let data = Data(input.payloadJson.utf8)
        guard !data.isEmpty, data.count <= maxPayloadBytes else { throw LifeOSCloudRecordError.payloadTooLarge }
        guard input.payloadByteSize == data.count else { throw LifeOSCloudRecordError.payloadLengthMismatch }
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        guard input.contentHash.lowercased() == digest else { throw LifeOSCloudRecordError.contentHashMismatch }
        guard let payload = try? JSONSerialization.jsonObject(with: data),
              let object = payload as? [String: Any] else { throw LifeOSCloudRecordError.invalidPayload }
        if collectFieldNames(object).contains(where: matchesForbiddenField) {
            throw LifeOSCloudRecordError.forbiddenField
        }
        if matches(forbiddenValue, text: input.payloadJson) {
            throw LifeOSCloudRecordError.secretLikeContent
        }
        return LifeOSCloudRecord(
            zone: input.zone,
            recordType: input.recordType,
            recordName: input.recordName,
            dataType: input.lifeosDataType,
            sourceIdHash: input.sourceIdHash,
            mutationId: input.mutationId,
            logicalClock: input.logicalClock,
            contentHash: digest,
            requiresUserReview: input.requiresUserReview,
            payloadJson: input.payloadJson,
            modifiedAt: input.modifiedAt
        )
    }

    private static func collectFieldNames(_ value: Any, prefix: String = "") -> [String] {
        if let dictionary = value as? [String: Any] {
            return dictionary.flatMap { key, child in
                let next = prefix.isEmpty ? key : "\(prefix).\(key)"
                return [next] + collectFieldNames(child, prefix: next)
            }
        }
        if let array = value as? [Any] {
            return array.prefix(16).flatMap { collectFieldNames($0, prefix: prefix) }
        }
        return []
    }

    private static func matchesForbiddenField(_ value: String) -> Bool {
        matches(forbiddenField, text: value)
    }

    private static func matches(_ expression: NSRegularExpression, text: String) -> Bool {
        expression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }
}
