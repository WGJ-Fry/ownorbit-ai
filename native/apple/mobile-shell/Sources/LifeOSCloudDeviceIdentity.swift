import CryptoKit
import Foundation
import Security
import UIKit

enum LifeOSCloudDeviceIdentityError: Error, Equatable {
    case invalidIdentity
    case keychain
    case signing
}

struct LifeOSCloudDeviceIdentity {
    static let lifetime: TimeInterval = 180 * 24 * 60 * 60
    static let rotationWindow: TimeInterval = 14 * 24 * 60 * 60

    let deviceId: String
    let privateKey: P256.Signing.PrivateKey
    let createdAt: Date
    let expiresAt: Date

    init(deviceId: String, privateKey: P256.Signing.PrivateKey, createdAt: Date, expiresAt: Date) throws {
        let normalizedDeviceId = deviceId.lowercased()
        guard normalizedDeviceId.range(
            of: #"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"#,
            options: .regularExpression
        ) != nil,
        expiresAt > createdAt,
        expiresAt.timeIntervalSince(createdAt) <= Self.lifetime else {
            throw LifeOSCloudDeviceIdentityError.invalidIdentity
        }
        self.deviceId = normalizedDeviceId
        self.privateKey = privateKey
        self.createdAt = createdAt
        self.expiresAt = expiresAt
    }

    var deviceIdHash: String { Self.sha256Hex(deviceId) }

    var publicKeySPKI: Data {
        let prefix = Data([
            0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
            0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
        ])
        return prefix + privateKey.publicKey.x963Representation
    }

    var publicKey: String { Self.base64URL(publicKeySPKI) }
    var publicKeyFingerprint: String { Self.sha256Hex(publicKeySPKI) }

    func sign(_ value: String) throws -> String {
        do {
            return Self.base64URL(try privateKey.signature(for: Data(value.utf8)).rawRepresentation)
        } catch {
            throw LifeOSCloudDeviceIdentityError.signing
        }
    }

    func isUsable(at now: Date) -> Bool {
        expiresAt.timeIntervalSince(now) > Self.rotationWindow
    }

    static func sha256Hex(_ value: String) -> String { sha256Hex(Data(value.utf8)) }

    static func sha256Hex(_ value: Data) -> String {
        SHA256.hash(data: value).map { String(format: "%02x", $0) }.joined()
    }

    static func base64URL(_ value: Data) -> String {
        value.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func decodeBase64URL(_ value: String) -> Data? {
        guard value.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil else { return nil }
        var normalized = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        normalized += String(repeating: "=", count: (4 - normalized.count % 4) % 4)
        guard let data = Data(base64Encoded: normalized), base64URL(data) == value else { return nil }
        return data
    }
}

enum LifeOSCloudDeviceIdentityStore {
    private static let service = "com.wgjfry.ownorbit.cloudkit-device-key"
    private static let account = "cloudkit-chat-v1"

    private struct StoredIdentity: Codable {
        let schemaVersion: Int
        let deviceId: String
        let privateKey: String
        let createdAt: Date
        let expiresAt: Date
    }

    static func loadOrCreate(now: Date = Date()) throws -> LifeOSCloudDeviceIdentity {
        if let stored = try load(), let identity = try? identity(from: stored), identity.isUsable(at: now) {
            return identity
        }
        try? remove()
        let createdAt = now
        let identity = try LifeOSCloudDeviceIdentity(
            deviceId: UUID().uuidString,
            privateKey: P256.Signing.PrivateKey(),
            createdAt: createdAt,
            expiresAt: createdAt.addingTimeInterval(LifeOSCloudDeviceIdentity.lifetime)
        )
        try save(identity)
        return identity
    }

    private static func identity(from stored: StoredIdentity) throws -> LifeOSCloudDeviceIdentity {
        guard stored.schemaVersion == 1, let privateData = Data(base64Encoded: stored.privateKey) else {
            throw LifeOSCloudDeviceIdentityError.invalidIdentity
        }
        return try LifeOSCloudDeviceIdentity(
            deviceId: stored.deviceId,
            privateKey: P256.Signing.PrivateKey(rawRepresentation: privateData),
            createdAt: stored.createdAt,
            expiresAt: stored.expiresAt
        )
    }

    private static func load() throws -> StoredIdentity? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw LifeOSCloudDeviceIdentityError.keychain
        }
        do { return try JSONDecoder().decode(StoredIdentity.self, from: data) }
        catch { throw LifeOSCloudDeviceIdentityError.invalidIdentity }
    }

    private static func save(_ identity: LifeOSCloudDeviceIdentity) throws {
        let stored = StoredIdentity(
            schemaVersion: 1,
            deviceId: identity.deviceId,
            privateKey: identity.privateKey.rawRepresentation.base64EncodedString(),
            createdAt: identity.createdAt,
            expiresAt: identity.expiresAt
        )
        let data = try JSONEncoder().encode(stored)
        var query = baseQuery()
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw LifeOSCloudDeviceIdentityError.keychain }
    }

    private static func remove() throws {
        let status = SecItemDelete(baseQuery() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw LifeOSCloudDeviceIdentityError.keychain
        }
    }

    private static func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}

enum LifeOSCloudDeviceKeyMutationBuilder {
    static func create(
        identity: LifeOSCloudDeviceIdentity,
        displayName: String = UIDevice.current.name,
        now: Date = Date()
    ) throws -> LifeOSCloudRecord {
        let normalizedName = String(displayName.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
        guard !normalizedName.isEmpty, identity.expiresAt > now else {
            throw LifeOSCloudDeviceIdentityError.invalidIdentity
        }
        let createdAt = Int64(identity.createdAt.timeIntervalSince1970 * 1000)
        let expiresAt = Int64(identity.expiresAt.timeIntervalSince1970 * 1000)
        let proofText = [
            "ownorbit-cloudkit-device-key.v1",
            identity.deviceId,
            identity.deviceIdHash,
            identity.publicKeyFingerprint,
            String(createdAt),
            String(expiresAt),
        ].joined(separator: "\n")
        let payload: [String: Any] = [
            "schemaVersion": 1,
            "deviceId": identity.deviceId,
            "deviceIdHash": identity.deviceIdHash,
            "displayName": normalizedName,
            "deviceType": "ios",
            "channelScope": "cloudkit-chat",
            "publicKey": identity.publicKey,
            "publicKeyFingerprint": identity.publicKeyFingerprint,
            "proofSignature": try identity.sign(proofText),
            "status": "active",
            "createdAt": NSNumber(value: createdAt),
            "expiresAt": NSNumber(value: expiresAt),
            "syncMutation": [
                "kind": "device-key-register",
                "origin": "ios-native",
                "mutatedAt": NSNumber(value: createdAt),
            ],
        ]
        guard JSONSerialization.isValidJSONObject(payload),
              let payloadData = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys, .withoutEscapingSlashes]),
              let payloadJson = String(data: payloadData, encoding: .utf8) else {
            throw LifeOSCloudDeviceIdentityError.invalidIdentity
        }
        return try LifeOSCloudRecordValidator.validate(LifeOSCloudRecordInput(
            zone: "LifeOSDeviceTrustZone",
            recordType: "LifeOSDeviceKey",
            recordName: "device-key:\(identity.deviceIdHash.prefix(24))",
            lifeosSchema: "lifeos-cloudkit-record.v1",
            lifeosDataType: "device-trust",
            sourceIdHash: "device-trust:\(identity.deviceIdHash.prefix(16))",
            mutationId: "ios-device-key:\(identity.deviceId)",
            logicalClock: createdAt,
            contentHash: LifeOSCloudDeviceIdentity.sha256Hex(payloadData),
            payloadByteSize: payloadData.count,
            requiresUserReview: false,
            payloadJson: payloadJson,
            modifiedAt: now
        ))
    }
}
