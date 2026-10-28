import CryptoKit
import Foundation
import Security

enum LifeOSCloudMacTrustError: Error, Equatable {
    case invalidAccount
    case invalidResponse
    case invalidKey
    case invalidSignature
    case identityChanged
    case awaitingReplacementResponse
    case keychain
}

enum LifeOSCloudMacResponseVerifier {
    private static let uuidPattern = #"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"#
    private static let hashPattern = #"^[0-9a-f]{64}$"#
    private static let spkiPrefix = Data([
        0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
        0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
    ])

    static func verify(response: LifeOSCloudRecord, request: LifeOSCloudRecord) throws -> String {
        guard response.recordType == "LifeOSChatResponse",
              request.recordType == "LifeOSChatRequest",
              response.zone == "LifeOSChatRelayZone",
              request.zone == "LifeOSChatRelayZone",
              let requestId = string(response.decodedPayload["requestId"]),
              requestId == string(request.decodedPayload["requestId"]),
              requestId.range(of: uuidPattern, options: .regularExpression) != nil,
              response.recordName == "chat-response:\(requestId)",
              let responseId = string(response.decodedPayload["responseId"]),
              responseId == deterministicResponseId(requestId: requestId),
              let conversationId = string(response.decodedPayload["conversationId"]),
              conversationId == string(request.decodedPayload["conversationId"]),
              let status = string(response.decodedPayload["status"]),
              ["retrying", "processing", "completed", "failed", "expired"].contains(status),
              let requestContentHash = string(response.decodedPayload["requestContentHash"]),
              requestContentHash == request.contentHash,
              requestContentHash.range(of: hashPattern, options: .regularExpression) != nil,
              let updatedAt = integer(response.decodedPayload["updatedAt"]),
              updatedAt > 0,
              response.logicalClock == updatedAt,
              response.mutationId == "mac-chat-response:\(requestId)",
              let macPublicKey = string(response.decodedPayload["macPublicKey"]),
              let macPublicKeyFingerprint = string(response.decodedPayload["macPublicKeyFingerprint"])?.lowercased(),
              macPublicKeyFingerprint.range(of: hashPattern, options: .regularExpression) != nil,
              let macSignature = string(response.decodedPayload["macSignature"]),
              let publicKeySPKI = LifeOSCloudDeviceIdentity.decodeBase64URL(macPublicKey),
              publicKeySPKI.count == spkiPrefix.count + 65,
              publicKeySPKI.starts(with: spkiPrefix),
              LifeOSCloudDeviceIdentity.sha256Hex(publicKeySPKI) == macPublicKeyFingerprint,
              let signatureData = LifeOSCloudDeviceIdentity.decodeBase64URL(macSignature),
              signatureData.count == 64 else {
            throw LifeOSCloudMacTrustError.invalidResponse
        }

        let publicKey: P256.Signing.PublicKey
        let signature: P256.Signing.ECDSASignature
        do {
            publicKey = try P256.Signing.PublicKey(x963Representation: publicKeySPKI.dropFirst(spkiPrefix.count))
            signature = try P256.Signing.ECDSASignature(rawRepresentation: signatureData)
        } catch {
            throw LifeOSCloudMacTrustError.invalidKey
        }
        guard publicKey.isValidSignature(
            signature,
            for: Data(signatureText(payload: response.decodedPayload).utf8)
        ) else {
            throw LifeOSCloudMacTrustError.invalidSignature
        }
        return macPublicKeyFingerprint
    }

    static func signatureText(payload: [String: Any]) -> String {
        let text = string(payload["text"]) ?? ""
        let requestId = string(payload["requestId"])?.lowercased() ?? ""
        let responseId = string(payload["responseId"])?.lowercased() ?? ""
        let conversationId = string(payload["conversationId"])?.lowercased() ?? ""
        let assistantMessageId = string(payload["assistantMessageId"])?.lowercased() ?? ""
        let status = string(payload["status"]) ?? ""
        let safeErrorCode = string(payload["safeErrorCode"]) ?? ""
        let providerLabel = string(payload["providerLabel"]) ?? ""
        let modelLabel = string(payload["modelLabel"]) ?? ""
        let requestContentHash = string(payload["requestContentHash"])?.lowercased() ?? ""
        let startedAt = integer(payload["startedAt"]).map { String($0) } ?? ""
        let completedAt = integer(payload["completedAt"]).map { String($0) } ?? ""
        let updatedAt = integer(payload["updatedAt"]).map { String($0) } ?? ""
        let macFingerprint = string(payload["macPublicKeyFingerprint"])?.lowercased() ?? ""
        let values: [String] = [
            "ownorbit-cloudkit-chat.v1",
            requestId,
            responseId,
            conversationId,
            assistantMessageId,
            status,
            LifeOSCloudDeviceIdentity.sha256Hex(text),
            safeErrorCode,
            providerLabel,
            modelLabel,
            requestContentHash,
            startedAt,
            completedAt,
            updatedAt,
            macFingerprint,
        ]
        return values.joined(separator: "\n")
    }

    static func integerValue(_ value: Any?) -> Int64? {
        integer(value)
    }

    private static func deterministicResponseId(requestId: String) -> String {
        let hash = LifeOSCloudDeviceIdentity.sha256Hex("ownorbit-chat-response:\(requestId.lowercased())")
        return "\(hash.prefix(8))-\(hash.dropFirst(8).prefix(4))-4\(hash.dropFirst(13).prefix(3))-a\(hash.dropFirst(17).prefix(3))-\(hash.dropFirst(20).prefix(12))"
    }

    private static func string(_ value: Any?) -> String? {
        guard let value = value as? String, !value.isEmpty else { return nil }
        return value
    }

    private static func integer(_ value: Any?) -> Int64? {
        guard let number = value as? NSNumber else { return nil }
        return number.int64Value
    }
}

protocol LifeOSCloudMacTrustStorage {
    func loadTrustedFingerprint(accountFingerprint: String) throws -> String?
    func saveTrustedFingerprint(_ fingerprint: String, accountFingerprint: String) throws
    func removeTrustedFingerprint(accountFingerprint: String) throws
    func loadReplacementResetAt(accountFingerprint: String) throws -> Int64?
    func saveReplacementResetAt(_ resetAt: Int64, accountFingerprint: String) throws
    func clearReplacementResetAt(accountFingerprint: String) throws
}

struct LifeOSCloudMacTrustKeychainStorage: LifeOSCloudMacTrustStorage {
    private let service: String
    private let replacementService: String

    init(serviceNamespace: String = "com.wgjfry.ownorbit.cloudkit-mac") {
        service = "\(serviceNamespace)-trust"
        replacementService = "\(serviceNamespace)-replacement"
    }

    func loadTrustedFingerprint(accountFingerprint: String) throws -> String? {
        var query = baseQuery(accountFingerprint: accountFingerprint)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess,
              let data = result as? Data,
              let value = String(data: data, encoding: .utf8),
              value.range(of: #"^[0-9a-f]{64}$"#, options: .regularExpression) != nil else {
            throw LifeOSCloudMacTrustError.keychain
        }
        return value
    }

    func saveTrustedFingerprint(_ fingerprint: String, accountFingerprint: String) throws {
        var query = baseQuery(accountFingerprint: accountFingerprint)
        query[kSecValueData as String] = Data(fingerprint.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw LifeOSCloudMacTrustError.keychain }
    }

    func removeTrustedFingerprint(accountFingerprint: String) throws {
        let status = SecItemDelete(baseQuery(accountFingerprint: accountFingerprint) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw LifeOSCloudMacTrustError.keychain
        }
    }

    func loadReplacementResetAt(accountFingerprint: String) throws -> Int64? {
        var query = replacementQuery(accountFingerprint: accountFingerprint)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess,
              let data = result as? Data,
              let value = String(data: data, encoding: .utf8),
              let timestamp = Int64(value),
              timestamp > 0 else {
            throw LifeOSCloudMacTrustError.keychain
        }
        return timestamp
    }

    func saveReplacementResetAt(_ resetAt: Int64, accountFingerprint: String) throws {
        let query = replacementQuery(accountFingerprint: accountFingerprint)
        let valueData = Data(String(resetAt).utf8)
        let updateStatus = SecItemUpdate(
            query as CFDictionary,
            [kSecValueData as String: valueData] as CFDictionary
        )
        if updateStatus == errSecSuccess { return }
        guard updateStatus == errSecItemNotFound else {
            throw LifeOSCloudMacTrustError.keychain
        }
        var addQuery = query
        addQuery[kSecValueData as String] = valueData
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else { throw LifeOSCloudMacTrustError.keychain }
    }

    func clearReplacementResetAt(accountFingerprint: String) throws {
        let status = SecItemDelete(replacementQuery(accountFingerprint: accountFingerprint) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw LifeOSCloudMacTrustError.keychain
        }
    }

    private func baseQuery(accountFingerprint: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "icloud:\(accountFingerprint)",
        ]
    }

    private func replacementQuery(accountFingerprint: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: replacementService,
            kSecAttrAccount as String: "icloud:\(accountFingerprint)",
        ]
    }
}

enum LifeOSCloudMacTrustStore {
    private static let keychainStorage = LifeOSCloudMacTrustKeychainStorage()

    static func verifyAndPin(
        response: LifeOSCloudRecord,
        request: LifeOSCloudRecord,
        accountFingerprint: String
    ) throws -> Bool {
        try verifyAndPin(
            response: response,
            request: request,
            accountFingerprint: accountFingerprint,
            storage: keychainStorage
        )
    }

    static func verifyAndPin(
        response: LifeOSCloudRecord,
        request: LifeOSCloudRecord,
        accountFingerprint: String,
        storage: any LifeOSCloudMacTrustStorage
    ) throws -> Bool {
        guard accountFingerprint.range(
            of: #"^[0-9a-f]{64}$"#,
            options: .regularExpression
        ) != nil else {
            throw LifeOSCloudMacTrustError.invalidAccount
        }
        let verifiedFingerprint = try LifeOSCloudMacResponseVerifier.verify(response: response, request: request)
        if let resetAt = try storage.loadReplacementResetAt(accountFingerprint: accountFingerprint) {
            guard request.chatCreatedAt > resetAt,
                  let responseUpdatedAt = LifeOSCloudMacResponseVerifier.integerValue(
                    response.decodedPayload["updatedAt"]
                  ),
                  responseUpdatedAt > resetAt else {
                throw LifeOSCloudMacTrustError.awaitingReplacementResponse
            }
            try storage.removeTrustedFingerprint(accountFingerprint: accountFingerprint)
            try storage.saveTrustedFingerprint(verifiedFingerprint, accountFingerprint: accountFingerprint)
            try storage.clearReplacementResetAt(accountFingerprint: accountFingerprint)
            return true
        }
        if let pinned = try storage.loadTrustedFingerprint(accountFingerprint: accountFingerprint) {
            guard pinned == verifiedFingerprint else { throw LifeOSCloudMacTrustError.identityChanged }
            return true
        }
        try storage.saveTrustedFingerprint(verifiedFingerprint, accountFingerprint: accountFingerprint)
        return true
    }

    static func trustedFingerprint(accountFingerprint: String) throws -> String? {
        try trustedFingerprint(accountFingerprint: accountFingerprint, storage: keychainStorage)
    }

    static func trustedFingerprint(
        accountFingerprint: String,
        storage: any LifeOSCloudMacTrustStorage
    ) throws -> String? {
        guard accountFingerprint.range(
            of: #"^[0-9a-f]{64}$"#,
            options: .regularExpression
        ) != nil else {
            throw LifeOSCloudMacTrustError.invalidAccount
        }
        return try storage.loadTrustedFingerprint(accountFingerprint: accountFingerprint)
    }

    static func reset(accountFingerprint: String, resetAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) throws {
        try reset(accountFingerprint: accountFingerprint, resetAt: resetAt, storage: keychainStorage)
    }

    static func reset(
        accountFingerprint: String,
        resetAt: Int64,
        storage: any LifeOSCloudMacTrustStorage
    ) throws {
        guard accountFingerprint.range(
            of: #"^[0-9a-f]{64}$"#,
            options: .regularExpression
        ) != nil else {
            throw LifeOSCloudMacTrustError.invalidAccount
        }
        guard resetAt > 0 else { throw LifeOSCloudMacTrustError.invalidResponse }
        try storage.saveReplacementResetAt(resetAt, accountFingerprint: accountFingerprint)
        try storage.removeTrustedFingerprint(accountFingerprint: accountFingerprint)
    }
}
