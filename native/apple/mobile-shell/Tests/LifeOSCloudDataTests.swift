import CryptoKit
import XCTest
@testable import LifeOSMobile

final class LifeOSCloudDataTests: XCTestCase {
    func testValidCloudKitPayloadBecomesOfflineRecord() throws {
        let payload = #"{"memoryId":"memory-1","title":"Weekly plan","text":"Prepare the week","updatedAt":1700000000000}"#
        let record = try LifeOSCloudRecordValidator.validate(input(
            zone: "LifeOSMemoryZone",
            recordType: "LifeOSMemory",
            dataType: "memory",
            recordName: "memory:memory-1",
            sourceIdHash: "memory:0123456789abcdef",
            payload: payload
        ))

        XCTAssertEqual(record.displayTitle, "Weekly plan")
        XCTAssertEqual(record.displayBody, "Prepare the week")
        XCTAssertEqual(record.dataType, "memory")
    }

    func testTamperedAndSecretPayloadsAreRejected() throws {
        let payload = #"{"memoryId":"memory-1","text":"safe"}"#
        var tampered = input(
            zone: "LifeOSMemoryZone",
            recordType: "LifeOSMemory",
            dataType: "memory",
            recordName: "memory:memory-1",
            sourceIdHash: "memory:0123456789abcdef",
            payload: payload
        )
        tampered = LifeOSCloudRecordInput(
            zone: tampered.zone,
            recordType: tampered.recordType,
            recordName: tampered.recordName,
            lifeosSchema: tampered.lifeosSchema,
            lifeosDataType: tampered.lifeosDataType,
            sourceIdHash: tampered.sourceIdHash,
            mutationId: tampered.mutationId,
            logicalClock: tampered.logicalClock,
            contentHash: String(repeating: "0", count: 64),
            payloadByteSize: tampered.payloadByteSize,
            requiresUserReview: tampered.requiresUserReview,
            payloadJson: tampered.payloadJson,
            modifiedAt: tampered.modifiedAt
        )
        XCTAssertThrowsError(try LifeOSCloudRecordValidator.validate(tampered)) { error in
            XCTAssertEqual(error as? LifeOSCloudRecordError, .contentHashMismatch)
        }

        let secretPayload = #"{"memoryId":"memory-2","providerApiKey":"sk-abcdefghijklmnop"}"#
        XCTAssertThrowsError(try LifeOSCloudRecordValidator.validate(input(
            zone: "LifeOSMemoryZone",
            recordType: "LifeOSMemory",
            dataType: "memory",
            recordName: "memory:memory-2",
            sourceIdHash: "memory:fedcba9876543210",
            payload: secretPayload
        ))) { error in
            XCTAssertEqual(error as? LifeOSCloudRecordError, .forbiddenField)
        }
    }

    func testSnapshotMergeUsesLogicalClockAndKeepsOpaqueChangeTokens() throws {
        let old = try LifeOSCloudRecordValidator.validate(input(
            zone: "LifeOSMemoryZone",
            recordType: "LifeOSMemory",
            dataType: "memory",
            recordName: "memory:memory-1",
            sourceIdHash: "memory:0123456789abcdef",
            payload: #"{"memoryId":"memory-1","title":"Old","text":"Old"}"#,
            logicalClock: 20
        ))
        let staleRemote = try LifeOSCloudRecordValidator.validate(input(
            zone: "LifeOSMemoryZone",
            recordType: "LifeOSMemory",
            dataType: "memory",
            recordName: "memory:memory-1",
            sourceIdHash: "memory:0123456789abcdef",
            payload: #"{"memoryId":"memory-1","title":"Stale","text":"Stale"}"#,
            logicalClock: 10
        ))
        let task = try LifeOSCloudRecordValidator.validate(input(
            zone: "LifeOSTaskZone",
            recordType: "LifeOSTask",
            dataType: "tasks",
            recordName: "task:task-1",
            sourceIdHash: "tasks:fedcba9876543210",
            payload: #"{"taskId":"task-1","type":"planning","state":"ready"}"#,
            logicalClock: 30
        ))
        let snapshot = LifeOSCloudSnapshot(
            schemaVersion: 1,
            accountFingerprint: "account-a",
            updatedAt: nil,
            records: [old],
            serverChangeTokens: [:],
            moreComing: false
        ).merging(
            changed: [staleRemote, task],
            deletedRecordIds: [],
            serverChangeTokens: ["LifeOSTaskZone": Data([1, 2, 3])],
            accountFingerprint: "account-a",
            moreComing: true,
            now: Date(timeIntervalSince1970: 1_700_000_000)
        )

        XCTAssertEqual(snapshot.records.count, 2)
        XCTAssertEqual(snapshot.records.first(where: { $0.recordName == "memory:memory-1" })?.displayTitle, "Old")
        XCTAssertEqual(snapshot.serverChangeTokens["LifeOSTaskZone"], Data([1, 2, 3]))
        XCTAssertTrue(snapshot.moreComing)
    }

    func testAccountScopeNeverCarriesRecordsAcrossAppleAccounts() throws {
        let record = try LifeOSCloudRecordValidator.validate(input(
            zone: "LifeOSMemoryZone",
            recordType: "LifeOSMemory",
            dataType: "memory",
            recordName: "memory:private",
            sourceIdHash: "memory:0123456789abcdef",
            payload: #"{"memoryId":"private","text":"Private memory"}"#
        ))
        let firstFingerprint = LifeOSCloudAccountIdentity.fingerprint(
            containerIdentifier: "iCloud.ai.lifeos.desktop",
            userRecordName: "account-a"
        )
        let secondFingerprint = LifeOSCloudAccountIdentity.fingerprint(
            containerIdentifier: "iCloud.ai.lifeos.desktop",
            userRecordName: "account-b"
        )
        let previous = LifeOSCloudSnapshot(
            schemaVersion: 1,
            accountFingerprint: firstFingerprint,
            updatedAt: Date(),
            records: [record],
            serverChangeTokens: ["LifeOSMemoryZone": Data([1, 2, 3])],
            moreComing: false
        )

        let scoped = previous.scoped(to: secondFingerprint)

        XCTAssertTrue(scoped.didReset)
        XCTAssertEqual(scoped.snapshot.accountFingerprint, secondFingerprint)
        XCTAssertTrue(scoped.snapshot.records.isEmpty)
        XCTAssertTrue(scoped.snapshot.serverChangeTokens.isEmpty)
        XCTAssertNotEqual(firstFingerprint, secondFingerprint)
    }

    func testZoneResetDropsStaleRecordsAndExpiredToken() throws {
        let memory = try LifeOSCloudRecordValidator.validate(input(
            zone: "LifeOSMemoryZone",
            recordType: "LifeOSMemory",
            dataType: "memory",
            recordName: "memory:stale",
            sourceIdHash: "memory:0123456789abcdef",
            payload: #"{"memoryId":"stale","text":"Stale"}"#
        ))
        let previous = LifeOSCloudSnapshot(
            schemaVersion: 1,
            accountFingerprint: "account-a",
            updatedAt: Date(),
            records: [memory],
            serverChangeTokens: ["LifeOSMemoryZone": Data([9, 9, 9])],
            moreComing: false
        )

        let reset = previous.merging(
            changed: [],
            deletedRecordIds: [],
            serverChangeTokens: [:],
            accountFingerprint: "account-a",
            resetZones: ["LifeOSMemoryZone"],
            moreComing: false,
            now: Date()
        )

        XCTAssertTrue(reset.records.isEmpty)
        XCTAssertNil(reset.serverChangeTokens["LifeOSMemoryZone"])
    }

    private func input(
        zone: String,
        recordType: String,
        dataType: String,
        recordName: String,
        sourceIdHash: String,
        payload: String,
        logicalClock: Int64 = 1
    ) -> LifeOSCloudRecordInput {
        let data = Data(payload.utf8)
        let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        return LifeOSCloudRecordInput(
            zone: zone,
            recordType: recordType,
            recordName: recordName,
            lifeosSchema: "lifeos-cloudkit-record.v1",
            lifeosDataType: dataType,
            sourceIdHash: sourceIdHash,
            mutationId: "mutation-1",
            logicalClock: logicalClock,
            contentHash: hash,
            payloadByteSize: data.count,
            requiresUserReview: false,
            payloadJson: payload,
            modifiedAt: Date(timeIntervalSince1970: TimeInterval(logicalClock))
        )
    }
}
