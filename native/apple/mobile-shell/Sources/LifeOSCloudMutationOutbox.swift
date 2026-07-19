import CryptoKit
import Foundation

enum LifeOSCloudPendingMutationKind: String, Codable, Equatable {
    case memoryCreate
    case taskComplete
    case chatRequest
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
    let chatRequestRecord: LifeOSCloudRecord?
    let deviceKeyRecord: LifeOSCloudRecord?

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
            taskItemId: nil,
            chatRequestRecord: nil,
            deviceKeyRecord: nil
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
            taskItemId: itemId,
            chatRequestRecord: nil,
            deviceKeyRecord: nil
        ), now: now)
    }

    static func chatRequest(
        record: LifeOSCloudRecord,
        deviceKeyRecord: LifeOSCloudRecord,
        accountFingerprint: String,
        now: Date
    ) throws -> LifeOSCloudPendingMutation {
        let validatedDeviceKey = try validateDeviceKeyRecord(deviceKeyRecord, now: now)
        let validatedRecord = try validateChatRequestRecord(record, deviceKeyRecord: validatedDeviceKey, now: now)
        return try validated(LifeOSCloudPendingMutation(
            schemaVersion: 1,
            id: validatedRecord.mutationId,
            accountFingerprint: accountFingerprint,
            kind: .chatRequest,
            createdAt: now,
            attempts: 0,
            nextRetryAt: nil,
            state: .pending,
            memoryRecord: nil,
            taskRecord: nil,
            taskItemId: nil,
            chatRequestRecord: validatedRecord,
            deviceKeyRecord: validatedDeviceKey
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
                  mutation.taskItemId == nil,
                  mutation.chatRequestRecord == nil,
                  mutation.deviceKeyRecord == nil else {
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
                  mutation.chatRequestRecord == nil,
                  mutation.deviceKeyRecord == nil,
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
        case .chatRequest:
            guard mutation.id.hasPrefix("ios-chat-request:"),
                  mutation.memoryRecord == nil,
                  mutation.taskRecord == nil,
                  mutation.taskItemId == nil,
                  let record = mutation.chatRequestRecord,
                  let deviceKeyRecord = mutation.deviceKeyRecord else {
                throw LifeOSCloudMutationOutboxError.invalidMutation
            }
            let validatedDeviceKey = try validateDeviceKeyRecord(deviceKeyRecord, now: now)
            let validatedRecord = try validateChatRequestRecord(record, deviceKeyRecord: validatedDeviceKey, now: now)
            guard mutation.id == validatedRecord.mutationId else {
                throw LifeOSCloudMutationOutboxError.invalidMutation
            }
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

    static func validateDeviceKeyRecord(_ record: LifeOSCloudRecord, now: Date = Date()) throws -> LifeOSCloudRecord {
        let validated = try validateRecord(record)
        guard validated.zone == "LifeOSDeviceTrustZone",
              validated.recordType == "LifeOSDeviceKey",
              !validated.requiresUserReview,
              let payload = try? JSONSerialization.jsonObject(with: Data(validated.payloadJson.utf8)) as? [String: Any],
              Set(payload.keys) == Set([
                "schemaVersion", "deviceId", "deviceIdHash", "displayName", "deviceType", "channelScope",
                "publicKey", "publicKeyFingerprint", "proofSignature", "status", "createdAt", "expiresAt", "syncMutation",
              ]),
              (payload["schemaVersion"] as? NSNumber)?.intValue == 1,
              let deviceId = payload["deviceId"] as? String,
              let deviceIdHash = payload["deviceIdHash"] as? String,
              let displayName = payload["displayName"] as? String,
              payload["deviceType"] as? String == "ios",
              payload["channelScope"] as? String == "cloudkit-chat",
              let publicKeyValue = payload["publicKey"] as? String,
              let publicKeyFingerprint = payload["publicKeyFingerprint"] as? String,
              let proofSignatureValue = payload["proofSignature"] as? String,
              payload["status"] as? String == "active",
              let createdAt = (payload["createdAt"] as? NSNumber)?.int64Value,
              let expiresAt = (payload["expiresAt"] as? NSNumber)?.int64Value,
              let metadata = payload["syncMutation"] as? [String: Any],
              Set(metadata.keys) == Set(["kind", "origin", "mutatedAt"]),
              metadata["kind"] as? String == "device-key-register",
              metadata["origin"] as? String == "ios-native",
              (metadata["mutatedAt"] as? NSNumber)?.int64Value == createdAt,
              deviceId == deviceId.lowercased(),
              deviceIdHash == LifeOSCloudDeviceIdentity.sha256Hex(deviceId),
              !displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              displayName.count <= 80,
              let publicKeyData = LifeOSCloudDeviceIdentity.decodeBase64URL(publicKeyValue),
              publicKeyData.count == 91,
              publicKeyFingerprint == LifeOSCloudDeviceIdentity.sha256Hex(publicKeyData),
              let proofSignatureData = LifeOSCloudDeviceIdentity.decodeBase64URL(proofSignatureValue),
              proofSignatureData.count == 64,
              createdAt > 0,
              expiresAt > createdAt,
              expiresAt - createdAt <= Int64(LifeOSCloudDeviceIdentity.lifetime * 1000),
              expiresAt > Int64(now.timeIntervalSince1970 * 1000),
              validated.recordName == "device-key:\(deviceIdHash.prefix(24))",
              validated.mutationId == "ios-device-key:\(deviceId)",
              validated.logicalClock == createdAt,
              publicKeyData.prefix(26) == Data([
                0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
                0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
              ]),
              let publicKey = try? P256.Signing.PublicKey(x963Representation: publicKeyData.dropFirst(26)),
              let proofSignature = try? P256.Signing.ECDSASignature(rawRepresentation: proofSignatureData) else {
            throw LifeOSCloudMutationOutboxError.invalidMutation
        }
        let proofText = [
            "ownorbit-cloudkit-device-key.v1", deviceId, deviceIdHash, publicKeyFingerprint,
            String(createdAt), String(expiresAt),
        ].joined(separator: "\n")
        guard publicKey.isValidSignature(proofSignature, for: Data(proofText.utf8)) else {
            throw LifeOSCloudMutationOutboxError.invalidMutation
        }
        return validated
    }

    static func validateChatRequestRecord(
        _ record: LifeOSCloudRecord,
        deviceKeyRecord: LifeOSCloudRecord,
        now: Date = Date()
    ) throws -> LifeOSCloudRecord {
        let validated = try validateRecord(record)
        let validatedDeviceKey = try validateDeviceKeyRecord(deviceKeyRecord, now: now)
        guard validated.zone == "LifeOSChatZone",
              validated.recordType == "LifeOSChatRequest",
              !validated.requiresUserReview,
              let payload = try? JSONSerialization.jsonObject(with: Data(validated.payloadJson.utf8)) as? [String: Any],
              let devicePayload = try? JSONSerialization.jsonObject(with: Data(validatedDeviceKey.payloadJson.utf8)) as? [String: Any],
              Set(payload.keys) == Set([
                "schemaVersion", "requestId", "conversationId", "userMessageId", "deviceId", "sourceDeviceHash",
                "publicKeyFingerprint", "signature", "prompt", "locale", "status", "clientSequence", "createdAt",
                "expiresAt", "syncMutation",
              ]),
              (payload["schemaVersion"] as? NSNumber)?.intValue == 1,
              let requestId = payload["requestId"] as? String,
              let conversationId = payload["conversationId"] as? String,
              let userMessageId = payload["userMessageId"] as? String,
              let deviceId = payload["deviceId"] as? String,
              let sourceDeviceHash = payload["sourceDeviceHash"] as? String,
              let publicKeyFingerprint = payload["publicKeyFingerprint"] as? String,
              let signatureValue = payload["signature"] as? String,
              let prompt = payload["prompt"] as? String,
              let locale = payload["locale"] as? String,
              payload["status"] as? String == "queued",
              let clientSequence = (payload["clientSequence"] as? NSNumber)?.int64Value,
              let createdAt = (payload["createdAt"] as? NSNumber)?.int64Value,
              let expiresAt = (payload["expiresAt"] as? NSNumber)?.int64Value,
              let metadata = payload["syncMutation"] as? [String: Any],
              Set(metadata.keys) == Set(["kind", "origin", "mutatedAt"]),
              metadata["kind"] as? String == "chat-request",
              metadata["origin"] as? String == "ios-native",
              (metadata["mutatedAt"] as? NSNumber)?.int64Value == createdAt,
              deviceId == devicePayload["deviceId"] as? String,
              sourceDeviceHash == devicePayload["deviceIdHash"] as? String,
              publicKeyFingerprint == devicePayload["publicKeyFingerprint"] as? String,
              let publicKeyValue = devicePayload["publicKey"] as? String,
              let publicKeyData = LifeOSCloudDeviceIdentity.decodeBase64URL(publicKeyValue),
              let publicKey = try? P256.Signing.PublicKey(x963Representation: publicKeyData.dropFirst(26)),
              let signatureData = LifeOSCloudDeviceIdentity.decodeBase64URL(signatureValue),
              signatureData.count == 64,
              let signature = try? P256.Signing.ECDSASignature(rawRepresentation: signatureData),
              expiresAt > createdAt,
              expiresAt - createdAt <= Int64(LifeOSCloudChatRequestMutationBuilder.requestTTL * 1000),
              validated.recordName == "chat-request:\(requestId.lowercased())",
              validated.mutationId == "ios-chat-request:\(requestId.lowercased())",
              validated.logicalClock == createdAt else {
            throw LifeOSCloudMutationOutboxError.invalidMutation
        }
        let signatureText = [
            "ownorbit-cloudkit-chat.v1", requestId.lowercased(), conversationId.lowercased(), userMessageId.lowercased(),
            deviceId.lowercased(), sourceDeviceHash.lowercased(), publicKeyFingerprint.lowercased(),
            LifeOSCloudDeviceIdentity.sha256Hex(prompt), locale, String(clientSequence), String(createdAt), String(expiresAt),
        ].joined(separator: "\n")
        guard publicKey.isValidSignature(signature, for: Data(signatureText.utf8)) else {
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
