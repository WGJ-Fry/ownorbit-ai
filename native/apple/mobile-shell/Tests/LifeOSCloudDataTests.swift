import CryptoKit
import XCTest
@testable import LifeOSMobile

final class LifeOSCloudDataTests: XCTestCase {
    func testCloudSyncOutcomeMapsBackgroundFetchResultsWithoutCollapsingFailures() {
        XCTAssertEqual(LifeOSCloudSyncOutcome.newData.backgroundFetchResult, .newData)
        XCTAssertEqual(LifeOSCloudSyncOutcome.noData.backgroundFetchResult, .noData)
        XCTAssertEqual(LifeOSCloudSyncOutcome.failed.backgroundFetchResult, .failed)
    }

    @MainActor
    func testSimulatorCloudSyncDistinguishesNoDataFromFailure() async {
        let demoStore = LifeOSCloudDataStore(demoModeOverride: true)
        let foundNewData = await demoStore.sync(reason: "test-no-data")
        XCTAssertFalse(foundNewData)
        XCTAssertEqual(demoStore.lastSyncOutcome, .noData)

        let unavailableStore = LifeOSCloudDataStore(demoModeOverride: false)
        await unavailableStore.enableAndSync()
        XCTAssertEqual(unavailableStore.lastSyncOutcome, .failed)
        unavailableStore.disableAndClear()
    }

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

    func testTaskListSnapshotExposesOnlySafeCompletionItems() throws {
        let record = try LifeOSCloudRecordValidator.validate(input(
            zone: "LifeOSTaskZone",
            recordType: "LifeOSTaskListSnapshot",
            dataType: "tasks",
            recordName: "task-list:lifeos_tasks_pro",
            sourceIdHash: "tasks:0123456789abcdef",
            payload: #"{"taskListKey":"lifeos_tasks_pro","items":[{"id":"task-1","text":"Finish CloudKit write-back","completed":false,"priority":"high","createdAt":1700000000000}],"updatedAt":1700000001000}"#
        ))

        XCTAssertEqual(record.taskItems, [LifeOSCloudTaskItem(
            id: "task-1",
            text: "Finish CloudKit write-back",
            completed: false,
            priority: "high",
            createdAt: 1_700_000_000_000
        )])
    }

    func testTaskCompletionMutationChangesOnlySelectedItemAndKeepsBaseHash() throws {
        let record = try LifeOSCloudRecordValidator.validate(input(
            zone: "LifeOSTaskZone",
            recordType: "LifeOSTaskListSnapshot",
            dataType: "tasks",
            recordName: "task-list:lifeos_tasks_pro",
            sourceIdHash: "tasks:0123456789abcdef",
            payload: #"{"taskListKey":"lifeos_tasks_pro","items":[{"id":"task-1","text":"Complete me","completed":false,"priority":"high","createdAt":1},{"id":"task-2","text":"Keep me","completed":false,"priority":"medium","createdAt":2}],"updatedAt":10}"#
        ))
        let mutation = try LifeOSCloudTaskMutationBuilder.complete(
            record: record,
            itemId: "task-1",
            now: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let payload = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(mutation.payloadJson.utf8)) as? [String: Any]
        )
        let items = try XCTUnwrap(payload["items"] as? [[String: Any]])
        let metadata = try XCTUnwrap(payload["syncMutation"] as? [String: Any])
        let digest = SHA256.hash(data: Data(mutation.payloadJson.utf8)).map { String(format: "%02x", $0) }.joined()

        XCTAssertEqual(items[0]["completed"] as? Bool, true)
        XCTAssertEqual(items[1]["completed"] as? Bool, false)
        XCTAssertEqual(items[1]["text"] as? String, "Keep me")
        XCTAssertEqual(metadata["kind"] as? String, "task-list-item-complete")
        XCTAssertEqual(metadata["baseContentHash"] as? String, record.contentHash)
        XCTAssertEqual(mutation.logicalClock, 1_700_000_000_000)
        XCTAssertEqual(mutation.payloadByteSize, Data(mutation.payloadJson.utf8).count)
        XCTAssertEqual(mutation.contentHash, digest)
    }

    func testTaskCompletionMutationKeepsLogicalClockMonotonicWhenPhoneClockIsBehind() throws {
        let record = try LifeOSCloudRecordValidator.validate(input(
            zone: "LifeOSTaskZone",
            recordType: "LifeOSTaskListSnapshot",
            dataType: "tasks",
            recordName: "task-list:lifeos_tasks_pro",
            sourceIdHash: "tasks:0123456789abcdef",
            payload: #"{"taskListKey":"lifeos_tasks_pro","items":[{"id":"task-1","text":"Complete me","completed":false,"priority":"high","createdAt":1}],"updatedAt":1700000000100}"#,
            logicalClock: 1_700_000_000_100
        ))

        let mutation = try LifeOSCloudTaskMutationBuilder.complete(
            record: record,
            itemId: "task-1",
            now: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let payload = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(mutation.payloadJson.utf8)) as? [String: Any]
        )
        let metadata = try XCTUnwrap(payload["syncMutation"] as? [String: Any])

        XCTAssertEqual(mutation.logicalClock, 1_700_000_000_101)
        XCTAssertEqual((payload["updatedAt"] as? NSNumber)?.int64Value, mutation.logicalClock)
        XCTAssertEqual((metadata["mutatedAt"] as? NSNumber)?.int64Value, mutation.logicalClock)
    }

    func testMemoryCreateMutationBuildsAValidatedNormalMemoryRecord() throws {
        let memoryId = "ios-memory-123e4567-e89b-42d3-a456-426614174000"
        let record = try LifeOSCloudMemoryMutationBuilder.create(
            title: "  Captured   on iPhone  ",
            text: "Remember the guarded CloudKit path.",
            memoryId: memoryId,
            now: Date(timeIntervalSince1970: 1_700_000_000)
        )
        let payload = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(record.payloadJson.utf8)) as? [String: Any]
        )
        let metadata = try XCTUnwrap(payload["syncMutation"] as? [String: Any])
        let digest = SHA256.hash(data: Data(record.payloadJson.utf8)).map { String(format: "%02x", $0) }.joined()

        XCTAssertEqual(record.zone, "LifeOSMemoryZone")
        XCTAssertEqual(record.recordType, "LifeOSMemory")
        XCTAssertEqual(record.recordName, "memory:\(memoryId)")
        XCTAssertEqual(record.mutationId, "ios-memory-create:\(memoryId)")
        XCTAssertEqual(record.contentHash, digest)
        XCTAssertFalse(record.requiresUserReview)
        XCTAssertEqual(payload["title"] as? String, "Captured on iPhone")
        XCTAssertEqual(payload["text"] as? String, "Remember the guarded CloudKit path.")
        XCTAssertEqual(payload["sensitivity"] as? String, "normal")
        XCTAssertEqual(metadata["kind"] as? String, "memory-create")
        XCTAssertEqual(metadata["origin"] as? String, "ios-native")
        XCTAssertEqual((metadata["mutatedAt"] as? NSNumber)?.int64Value, 1_700_000_000_000)
    }

    func testMemoryCreateMutationRejectsSensitiveLookingAndOversizedText() {
        let memoryId = "ios-memory-123e4567-e89b-42d3-a456-426614174000"
        XCTAssertThrowsError(try LifeOSCloudMemoryMutationBuilder.create(
            title: "Private path",
            text: "Read /Users/example/private.txt later",
            memoryId: memoryId,
            now: Date()
        )) { error in
            XCTAssertEqual(error as? LifeOSCloudMemoryWriteError, .unsafeContent)
        }
        XCTAssertThrowsError(try LifeOSCloudMemoryMutationBuilder.create(
            title: "Too long",
            text: String(repeating: "a", count: LifeOSCloudMemoryMutationBuilder.maxTextLength + 1),
            memoryId: memoryId,
            now: Date()
        )) { error in
            XCTAssertEqual(error as? LifeOSCloudMemoryWriteError, .tooLong)
        }
    }

    @MainActor
    func testSimulatorDataStoreCreatesMemoryAndRejectsUnsafeDraftWithoutCloudKit() async {
        let store = LifeOSCloudDataStore(demoModeOverride: true)
        let initialCount = store.snapshot.records.count
        let memoryId = "ios-memory-123e4567-e89b-42d3-a456-426614174000"

        let created = await store.createMemory(
            title: "Simulator memory",
            text: "This should join the protected offline snapshot.",
            memoryId: memoryId
        )
        XCTAssertTrue(created)
        XCTAssertEqual(store.snapshot.records.count, initialCount + 1)
        let memory = store.snapshot.records.first(where: { $0.recordType == "LifeOSMemory" })
        XCTAssertEqual(memory?.displayTitle, "Simulator memory")
        XCTAssertEqual(memory?.displayBody, "This should join the protected offline snapshot.")

        let duplicate = await store.createMemory(
            title: "Duplicate retry",
            text: "The same draft identifier must not create another record.",
            memoryId: memoryId
        )
        XCTAssertFalse(duplicate)
        XCTAssertEqual(store.snapshot.records.count, initialCount + 1)
        XCTAssertEqual(store.nextAction, .continueSync)

        let countBeforeUnsafeDraft = store.snapshot.records.count
        let rejected = await store.createMemory(
            title: "Private path",
            text: "Read /Users/example/private.txt later"
        )
        XCTAssertFalse(rejected)
        XCTAssertEqual(store.snapshot.records.count, countBeforeUnsafeDraft)
        XCTAssertEqual(store.statusTone, .error)
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
