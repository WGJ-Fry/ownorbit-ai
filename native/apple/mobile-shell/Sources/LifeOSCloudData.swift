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
        case "LifeOSChatRequest":
            return NSLocalizedString("cloud.item.chatRequest", comment: "")
        case "LifeOSChatResponse":
            return NSLocalizedString("cloud.item.chatResponse", comment: "")
        case "LifeOSChatReceipt":
            return NSLocalizedString("cloud.item.chatReceipt", comment: "")
        case "LifeOSDeviceKey":
            return NSLocalizedString("cloud.item.deviceKey", comment: "")
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
        case "LifeOSChatRequest":
            return string(payload["prompt"])
        case "LifeOSChatResponse":
            return string(payload["text"], fallback: string(payload["status"]))
        case "LifeOSChatReceipt":
            return string(payload["responseId"])
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

    var chatRequestId: String? {
        guard ["LifeOSChatRequest", "LifeOSChatResponse", "LifeOSChatReceipt"].contains(recordType) else { return nil }
        return decodedPayload["requestId"] as? String
    }

    var chatStatus: String? { decodedPayload["status"] as? String }
    var chatSafeErrorCode: String? { decodedPayload["safeErrorCode"] as? String }
    var chatSourceDeviceHash: String? { decodedPayload["sourceDeviceHash"] as? String }
    var chatCreatedAt: Int64 { (decodedPayload["createdAt"] as? NSNumber)?.int64Value ?? logicalClock }
    var chatExpiresAt: Int64 { (decodedPayload["expiresAt"] as? NSNumber)?.int64Value ?? 0 }

    var decodedPayload: [String: Any] {
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

struct LifeOSCloudChatItem: Identifiable, Equatable {
    enum State: Equatable {
        case waitingForMac
        case macUnavailable
        case processing
        case retrying
        case completed
        case failed
        case timedOut
    }

    let requestId: String
    let prompt: String
    let responseText: String
    let safeErrorCode: String?
    let createdAt: Date
    let state: State

    var id: String { requestId }
}

extension LifeOSCloudSnapshot {
    func chatItems(
        now: Date = Date(),
        sourceDeviceHash: String? = nil,
        responseVerifier: (LifeOSCloudRecord, LifeOSCloudRecord) -> Bool = { _, _ in false }
    ) -> [LifeOSCloudChatItem] {
        var requestsById: [String: LifeOSCloudRecord] = [:]
        for request in records where request.recordType == "LifeOSChatRequest" {
            guard sourceDeviceHash == nil || request.chatSourceDeviceHash == sourceDeviceHash,
                  let requestId = request.chatRequestId else { continue }
            if let existing = requestsById[requestId], existing.logicalClock >= request.logicalClock { continue }
            requestsById[requestId] = request
        }
        var responses: [String: LifeOSCloudRecord] = [:]
        for response in records where response.recordType == "LifeOSChatResponse" {
            guard let requestId = response.chatRequestId,
                  let request = requestsById[requestId],
                  responseVerifier(response, request) else { continue }
            let responseUpdatedAt = (response.decodedPayload["updatedAt"] as? NSNumber)?.int64Value ?? 0
            let existingUpdatedAt = responses[requestId]
                .flatMap { $0.decodedPayload["updatedAt"] as? NSNumber }?.int64Value ?? 0
            if existingUpdatedAt >= responseUpdatedAt { continue }
            responses[requestId] = response
        }
        let nowValue = Int64(now.timeIntervalSince1970 * 1000)
        return requestsById.values
            .compactMap { request -> LifeOSCloudChatItem? in
                guard let requestId = request.chatRequestId else { return nil }
                let response = responses[requestId]
                let state: LifeOSCloudChatItem.State
                switch response?.chatStatus {
                case "processing": state = .processing
                case "retrying": state = .retrying
                case "completed": state = .completed
                case "failed": state = .failed
                case "expired": state = .timedOut
                default:
                    if request.chatExpiresAt > 0 && request.chatExpiresAt <= nowValue { state = .timedOut }
                    else if nowValue - request.chatCreatedAt >= 90_000 { state = .macUnavailable }
                    else { state = .waitingForMac }
                }
                return LifeOSCloudChatItem(
                    requestId: requestId,
                    prompt: request.displayBody,
                    responseText: response?.displayBody ?? "",
                    safeErrorCode: response?.chatSafeErrorCode,
                    createdAt: Date(timeIntervalSince1970: TimeInterval(request.chatCreatedAt) / 1000),
                    state: state
                )
            }
            .sorted { $0.createdAt > $1.createdAt }
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

enum LifeOSCloudChatWriteError: LocalizedError, Equatable {
    case emptyPrompt
    case tooLong
    case unsafeContent
    case invalidRequest
    case collision
    case saveFailed

    var errorDescription: String? {
        switch self {
        case .emptyPrompt: return NSLocalizedString("cloud.chat.error.empty", comment: "")
        case .tooLong: return NSLocalizedString("cloud.chat.error.length", comment: "")
        case .unsafeContent: return NSLocalizedString("cloud.chat.error.unsafe", comment: "")
        case .invalidRequest: return NSLocalizedString("cloud.chat.error.invalid", comment: "")
        case .collision: return NSLocalizedString("cloud.chat.error.collision", comment: "")
        case .saveFailed: return NSLocalizedString("cloud.chat.error.failed", comment: "")
        }
    }
}

enum LifeOSCloudChatRequestMutationBuilder {
    static let maxPromptLength = 8_000
    static let requestTTL: TimeInterval = 24 * 60 * 60

    private static let uuidPattern = #"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"#
    private static let hashPattern = #"^[0-9a-f]{64}$"#
    private static let secretLikePattern = try! NSRegularExpression(
        pattern: #"(?:github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,}|sk-or-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]+|/Users/[^/\s]+|[A-Z]:\\Users\\[^\\\s]+)"#,
        options: [.caseInsensitive]
    )

    static func create(
        prompt: String,
        identity: LifeOSCloudDeviceIdentity,
        locale: String,
        requestId: String = UUID().uuidString.lowercased(),
        conversationId: String,
        userMessageId: String = UUID().uuidString.lowercased(),
        clientSequence: Int64,
        trustedMacFingerprint: String? = nil,
        now: Date = Date(),
        expiresAt: Date? = nil
    ) throws -> LifeOSCloudRecord {
        let normalizedPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedRequestId = requestId.lowercased()
        let normalizedConversationId = conversationId.lowercased()
        let normalizedUserMessageId = userMessageId.lowercased()
        let normalizedTrustedMacFingerprint = trustedMacFingerprint?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        guard !normalizedPrompt.isEmpty else { throw LifeOSCloudChatWriteError.emptyPrompt }
        guard normalizedPrompt.count <= maxPromptLength else { throw LifeOSCloudChatWriteError.tooLong }
        guard !containsSecretLikeContent(normalizedPrompt) else { throw LifeOSCloudChatWriteError.unsafeContent }
        guard normalizedRequestId.range(of: uuidPattern, options: .regularExpression) != nil,
              normalizedConversationId.range(of: uuidPattern, options: .regularExpression) != nil,
              normalizedUserMessageId.range(of: uuidPattern, options: .regularExpression) != nil,
              identity.deviceIdHash.range(of: hashPattern, options: .regularExpression) != nil,
              normalizedTrustedMacFingerprint == nil ||
                normalizedTrustedMacFingerprint?.range(of: hashPattern, options: .regularExpression) != nil,
              locale == "zh-CN" || locale == "en-US",
              clientSequence >= 0 else {
            throw LifeOSCloudChatWriteError.invalidRequest
        }
        let createdAt = Int64(now.timeIntervalSince1970 * 1000)
        let resolvedExpiresAt = expiresAt ?? now.addingTimeInterval(requestTTL)
        let expiresAtValue = Int64(resolvedExpiresAt.timeIntervalSince1970 * 1000)
        guard createdAt > 0,
              expiresAtValue > createdAt,
              expiresAtValue - createdAt <= Int64(requestTTL * 1000),
              identity.expiresAt > resolvedExpiresAt else {
            throw LifeOSCloudChatWriteError.invalidRequest
        }
        let promptHash = LifeOSCloudDeviceIdentity.sha256Hex(normalizedPrompt)
        var signatureValues = [
            "ownorbit-cloudkit-chat.v1",
            normalizedRequestId,
            normalizedConversationId,
            normalizedUserMessageId,
            identity.deviceId,
            identity.deviceIdHash,
            identity.publicKeyFingerprint,
        ]
        if let normalizedTrustedMacFingerprint {
            signatureValues.append(normalizedTrustedMacFingerprint)
        }
        signatureValues.append(contentsOf: [
            promptHash,
            locale,
            String(clientSequence),
            String(createdAt),
            String(expiresAtValue),
        ])
        let signatureText = signatureValues.joined(separator: "\n")
        var payload: [String: Any] = [
            "schemaVersion": 1,
            "requestId": normalizedRequestId,
            "conversationId": normalizedConversationId,
            "userMessageId": normalizedUserMessageId,
            "deviceId": identity.deviceId,
            "sourceDeviceHash": identity.deviceIdHash,
            "publicKeyFingerprint": identity.publicKeyFingerprint,
            "signature": try identity.sign(signatureText),
            "prompt": normalizedPrompt,
            "locale": locale,
            "status": "queued",
            "clientSequence": NSNumber(value: clientSequence),
            "createdAt": NSNumber(value: createdAt),
            "expiresAt": NSNumber(value: expiresAtValue),
            "syncMutation": [
                "kind": "chat-request",
                "origin": "ios-native",
                "mutatedAt": NSNumber(value: createdAt),
            ],
        ]
        if let normalizedTrustedMacFingerprint {
            payload["trustedMacFingerprint"] = normalizedTrustedMacFingerprint
        }
        guard JSONSerialization.isValidJSONObject(payload),
              let payloadData = try? JSONSerialization.data(
                withJSONObject: payload,
                options: [.sortedKeys, .withoutEscapingSlashes]
              ),
              let payloadJson = String(data: payloadData, encoding: .utf8) else {
            throw LifeOSCloudChatWriteError.invalidRequest
        }
        let contentHash = SHA256.hash(data: payloadData).map { String(format: "%02x", $0) }.joined()
        let sourceHash = SHA256.hash(data: Data(normalizedRequestId.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        do {
            return try LifeOSCloudRecordValidator.validate(LifeOSCloudRecordInput(
                zone: "LifeOSChatRelayZone",
                recordType: "LifeOSChatRequest",
                recordName: "chat-request:\(normalizedRequestId)",
                lifeosSchema: "lifeos-cloudkit-record.v1",
                lifeosDataType: "chat-relay",
                sourceIdHash: "chat-relay:\(sourceHash.prefix(16))",
                mutationId: "ios-chat-request:\(normalizedRequestId)",
                logicalClock: createdAt,
                contentHash: contentHash,
                payloadByteSize: payloadData.count,
                requiresUserReview: false,
                payloadJson: payloadJson,
                modifiedAt: now
            ))
        } catch {
            throw LifeOSCloudChatWriteError.invalidRequest
        }
    }

    private static func containsSecretLikeContent(_ value: String) -> Bool {
        secretLikePattern.firstMatch(
            in: value,
            range: NSRange(value.startIndex..., in: value)
        ) != nil
    }
}

enum LifeOSCloudChatReceiptMutationBuilder {
    private static let uuidPattern = #"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"#
    private static let hashPattern = #"^[0-9a-f]{64}$"#

    static func create(
        response: LifeOSCloudRecord,
        request: LifeOSCloudRecord,
        identity: LifeOSCloudDeviceIdentity,
        now: Date = Date()
    ) throws -> LifeOSCloudRecord {
        _ = try LifeOSCloudMacResponseVerifier.verify(response: response, request: request)
        guard response.zone == "LifeOSChatRelayZone",
              response.recordType == "LifeOSChatResponse",
              request.zone == "LifeOSChatRelayZone",
              request.recordType == "LifeOSChatRequest",
              let requestId = response.chatRequestId?.lowercased(),
              requestId == request.chatRequestId?.lowercased(),
              requestId.range(of: uuidPattern, options: .regularExpression) != nil,
              let responseId = response.decodedPayload["responseId"] as? String,
              responseId.range(of: uuidPattern, options: .regularExpression) != nil,
              let status = response.chatStatus,
              ["completed", "failed", "expired"].contains(status),
              let requestDeviceId = request.decodedPayload["deviceId"] as? String,
              requestDeviceId == identity.deviceId,
              request.chatSourceDeviceHash == identity.deviceIdHash,
              request.decodedPayload["publicKeyFingerprint"] as? String == identity.publicKeyFingerprint,
              response.contentHash.range(of: hashPattern, options: .regularExpression) != nil,
              let responseUpdatedAt = (response.decodedPayload["updatedAt"] as? NSNumber)?.int64Value,
              responseUpdatedAt > 0,
              response.logicalClock == responseUpdatedAt else {
            throw LifeOSCloudChatWriteError.invalidRequest
        }
        let signatureText = [
            "ownorbit-cloudkit-chat-receipt.v1",
            requestId,
            responseId.lowercased(),
            identity.deviceId,
            identity.deviceIdHash,
            identity.publicKeyFingerprint,
            response.contentHash.lowercased(),
            String(responseUpdatedAt),
            String(responseUpdatedAt),
        ].joined(separator: "\n")
        let payload: [String: Any] = [
            "schemaVersion": 1,
            "requestId": requestId,
            "responseId": responseId.lowercased(),
            "deviceId": identity.deviceId,
            "sourceDeviceHash": identity.deviceIdHash,
            "publicKeyFingerprint": identity.publicKeyFingerprint,
            "responseContentHash": response.contentHash.lowercased(),
            "responseUpdatedAt": NSNumber(value: responseUpdatedAt),
            "acknowledgedAt": NSNumber(value: responseUpdatedAt),
            "signature": try identity.sign(signatureText),
            "syncMutation": [
                "kind": "chat-receipt",
                "origin": "ios-native",
                "mutatedAt": NSNumber(value: responseUpdatedAt),
            ],
        ]
        guard JSONSerialization.isValidJSONObject(payload),
              let payloadData = try? JSONSerialization.data(
                withJSONObject: payload,
                options: [.sortedKeys, .withoutEscapingSlashes]
              ),
              let payloadJson = String(data: payloadData, encoding: .utf8) else {
            throw LifeOSCloudChatWriteError.invalidRequest
        }
        let sourceHash = LifeOSCloudDeviceIdentity.sha256Hex(requestId)
        return try LifeOSCloudRecordValidator.validate(LifeOSCloudRecordInput(
            zone: "LifeOSChatRelayZone",
            recordType: "LifeOSChatReceipt",
            recordName: "chat-receipt:\(requestId)",
            lifeosSchema: "lifeos-cloudkit-record.v1",
            lifeosDataType: "chat-relay",
            sourceIdHash: "chat-relay:\(sourceHash.prefix(16))",
            mutationId: "ios-chat-receipt:\(requestId)",
            logicalClock: responseUpdatedAt,
            contentHash: LifeOSCloudDeviceIdentity.sha256Hex(payloadData),
            payloadByteSize: payloadData.count,
            requiresUserReview: false,
            payloadJson: payloadJson,
            modifiedAt: now
        ))
    }

    static func matches(
        _ receipt: LifeOSCloudRecord,
        response: LifeOSCloudRecord,
        identity: LifeOSCloudDeviceIdentity
    ) -> Bool {
        let payload = receipt.decodedPayload
        guard receipt.zone == "LifeOSChatRelayZone",
              receipt.recordType == "LifeOSChatReceipt",
              let requestId = response.chatRequestId?.lowercased(),
              receipt.recordName == "chat-receipt:\(requestId)",
              receipt.mutationId == "ios-chat-receipt:\(requestId)",
              payload["requestId"] as? String == requestId,
              let responseId = payload["responseId"] as? String,
              let responseRecordId = response.decodedPayload["responseId"] as? String,
              responseId == responseRecordId,
              payload["deviceId"] as? String == identity.deviceId,
              payload["sourceDeviceHash"] as? String == identity.deviceIdHash,
              payload["publicKeyFingerprint"] as? String == identity.publicKeyFingerprint,
              payload["responseContentHash"] as? String == response.contentHash,
              let responseUpdatedAt = (payload["responseUpdatedAt"] as? NSNumber)?.int64Value,
              let acknowledgedAt = (payload["acknowledgedAt"] as? NSNumber)?.int64Value,
              responseUpdatedAt == response.logicalClock,
              acknowledgedAt == responseUpdatedAt,
              receipt.logicalClock == acknowledgedAt,
              let signatureValue = payload["signature"] as? String,
              let signatureData = LifeOSCloudDeviceIdentity.decodeBase64URL(signatureValue),
              signatureData.count == 64,
              let signature = try? P256.Signing.ECDSASignature(rawRepresentation: signatureData) else {
            return false
        }
        let signatureText = [
            "ownorbit-cloudkit-chat-receipt.v1",
            requestId,
            responseId.lowercased(),
            identity.deviceId,
            identity.deviceIdHash,
            identity.publicKeyFingerprint,
            response.contentHash.lowercased(),
            String(responseUpdatedAt),
            String(acknowledgedAt),
        ].joined(separator: "\n")
        return identity.privateKey.publicKey.isValidSignature(signature, for: Data(signatureText.utf8))
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
        "LifeOSChatRelayZone": (
            "chat-relay",
            ["LifeOSDeviceKey", "LifeOSChatRequest", "LifeOSChatResponse", "LifeOSChatReceipt"]
        ),
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
