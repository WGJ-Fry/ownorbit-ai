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

struct LifeOSCloudSnapshot: Codable, Equatable {
    let schemaVersion: Int
    var updatedAt: Date?
    var records: [LifeOSCloudRecord]
    var serverChangeTokens: [String: Data]
    var moreComing: Bool

    static let empty = LifeOSCloudSnapshot(
        schemaVersion: 1,
        updatedAt: nil,
        records: [],
        serverChangeTokens: [:],
        moreComing: false
    )

    func merging(
        changed: [LifeOSCloudRecord],
        deletedRecordIds: Set<String>,
        serverChangeTokens: [String: Data],
        moreComing: Bool,
        now: Date
    ) -> LifeOSCloudSnapshot {
        var byId = Dictionary(uniqueKeysWithValues: records.map { ($0.id, $0) })
        for id in deletedRecordIds { byId.removeValue(forKey: id) }
        for record in changed {
            if let existing = byId[record.id], existing.logicalClock > record.logicalClock { continue }
            byId[record.id] = record
        }
        var nextTokens = self.serverChangeTokens
        for (zone, token) in serverChangeTokens { nextTokens[zone] = token }
        return LifeOSCloudSnapshot(
            schemaVersion: 1,
            updatedAt: now,
            records: byId.values.sorted {
                ($0.modifiedAt ?? .distantPast) > ($1.modifiedAt ?? .distantPast)
            },
            serverChangeTokens: nextTokens,
            moreComing: moreComing
        )
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
