import CryptoKit
import XCTest
@testable import LifeOSMobile

private final class InMemoryCloudMacTrustStorage: LifeOSCloudMacTrustStorage {
    var trustedFingerprints: [String: String] = [:]
    var replacementResetTimes: [String: Int64] = [:]
    var failNextTrustedFingerprintRemoval = false
    var failNextReplacementResetSave = false
    var operations: [String] = []

    init(
        trustedFingerprints: [String: String] = [:],
        replacementResetTimes: [String: Int64] = [:]
    ) {
        self.trustedFingerprints = trustedFingerprints
        self.replacementResetTimes = replacementResetTimes
    }

    func loadTrustedFingerprint(accountFingerprint: String) throws -> String? {
        trustedFingerprints[accountFingerprint]
    }

    func saveTrustedFingerprint(_ fingerprint: String, accountFingerprint: String) throws {
        trustedFingerprints[accountFingerprint] = fingerprint
    }

    func removeTrustedFingerprint(accountFingerprint: String) throws {
        operations.append("remove-trusted-fingerprint")
        if failNextTrustedFingerprintRemoval {
            failNextTrustedFingerprintRemoval = false
            throw LifeOSCloudMacTrustError.keychain
        }
        trustedFingerprints.removeValue(forKey: accountFingerprint)
    }

    func loadReplacementResetAt(accountFingerprint: String) throws -> Int64? {
        replacementResetTimes[accountFingerprint]
    }

    func saveReplacementResetAt(_ resetAt: Int64, accountFingerprint: String) throws {
        operations.append("save-replacement-reset")
        if failNextReplacementResetSave {
            failNextReplacementResetSave = false
            throw LifeOSCloudMacTrustError.keychain
        }
        replacementResetTimes[accountFingerprint] = resetAt
    }

    func clearReplacementResetAt(accountFingerprint: String) throws {
        replacementResetTimes.removeValue(forKey: accountFingerprint)
    }
}

final class LifeOSCloudDataTests: XCTestCase {
    func testCloudSyncOutcomeMapsBackgroundFetchResultsWithoutCollapsingFailures() {
        XCTAssertEqual(LifeOSCloudSyncOutcome.newData.backgroundFetchResult, .newData)
        XCTAssertEqual(LifeOSCloudSyncOutcome.noData.backgroundFetchResult, .noData)
        XCTAssertEqual(LifeOSCloudSyncOutcome.failed.backgroundFetchResult, .failed)
    }

    func testBackgroundEvidencePersistsOnlySafeDeliveryMetadata() throws {
        let suiteName = "OwnOrbitCloudKitBackgroundEvidence-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let evidence = LifeOSCloudBackgroundEvidence(
            trigger: .push,
            outcome: .newData,
            recordedAt: Date(timeIntervalSince1970: 1_700_000_000),
            deliveryAppState: .background
        )

        LifeOSCloudBackgroundEvidenceStore.save(evidence, defaults: defaults)

        XCTAssertEqual(LifeOSCloudBackgroundEvidenceStore.load(defaults: defaults), evidence)
        let stored = try XCTUnwrap(defaults.data(forKey: LifeOSCloudBackgroundEvidenceStore.defaultsKey))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: stored) as? [String: Any])
        XCTAssertEqual(
            Set(json.keys),
            ["schemaVersion", "trigger", "outcome", "recordedAt", "deliveryAppState"]
        )
        XCTAssertNil(LifeOSCloudBackgroundTrigger(reason: "foreground"))
        XCTAssertEqual(LifeOSCloudBackgroundTrigger(reason: "background-refresh"), .backgroundRefresh)
        XCTAssertEqual(LifeOSCloudDeliveryAppState(applicationState: .active), .active)
        XCTAssertEqual(LifeOSCloudDeliveryAppState(applicationState: .inactive), .inactive)
        XCTAssertEqual(LifeOSCloudDeliveryAppState(applicationState: .background), .background)
    }

    func testRemoteRegistrationEvidencePersistsNoDeviceTokenOrErrorDetails() throws {
        let suiteName = "OwnOrbitRemoteRegistrationEvidence-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let evidence = LifeOSRemoteNotificationRegistrationEvidence(
            state: .registered,
            recordedAt: Date(timeIntervalSince1970: 1_700_000_000)
        )

        LifeOSRemoteNotificationRegistrationEvidenceStore.save(evidence, defaults: defaults)

        XCTAssertEqual(
            LifeOSRemoteNotificationRegistrationEvidenceStore.load(defaults: defaults),
            evidence
        )
        let stored = try XCTUnwrap(
            defaults.data(forKey: LifeOSRemoteNotificationRegistrationEvidenceStore.defaultsKey)
        )
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: stored) as? [String: Any])
        XCTAssertEqual(Set(json.keys), ["schemaVersion", "state", "recordedAt"])
        XCTAssertEqual(LifeOSCloudBackgroundRefreshAvailability(status: .available), .available)
        XCTAssertEqual(LifeOSCloudBackgroundRefreshAvailability(status: .denied), .denied)
        XCTAssertEqual(LifeOSCloudBackgroundRefreshAvailability(status: .restricted), .restricted)
    }

    func testBackgroundRefreshPolicyRequiresOptInAndKeepsIdentifierInsideBundleScope() {
        let suiteName = "LifeOSCloudBackgroundRefreshPolicy-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        XCTAssertFalse(LifeOSCloudBackgroundRefreshPolicy.isEnabled(defaults: defaults))
        defaults.set(true, forKey: LifeOSCloudBackgroundRefreshPolicy.enabledDefaultsKey)
        XCTAssertTrue(LifeOSCloudBackgroundRefreshPolicy.isEnabled(defaults: defaults))
        XCTAssertEqual(LifeOSCloudBackgroundRefreshPolicy.earliestDelay, 30 * 60)
        XCTAssertEqual(
            LifeOSCloudBackgroundRefreshPolicy.resolvedIdentifier(
                configuredIdentifier: "ai.example.ownorbit.cloudkit-refresh",
                bundleIdentifier: "ai.example.ownorbit"
            ),
            "ai.example.ownorbit.cloudkit-refresh"
        )
        XCTAssertEqual(
            LifeOSCloudBackgroundRefreshPolicy.resolvedIdentifier(
                configuredIdentifier: "com.untrusted.refresh",
                bundleIdentifier: "ai.example.ownorbit"
            ),
            "ai.example.ownorbit.cloudkit-refresh"
        )
    }

    func testBackgroundRefreshRequestFinishesExactlyOnce() {
        var results: [Bool] = []
        let request = LifeOSCloudBackgroundRefreshRequest { results.append($0) }

        request.finish(success: true)
        request.finish(success: false)

        XCTAssertEqual(results, [true])
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

    func testTaskCompletionRejectsRecordsThatNeedManualReview() throws {
        let record = try LifeOSCloudRecordValidator.validate(input(
            zone: "LifeOSTaskZone",
            recordType: "LifeOSTaskListSnapshot",
            dataType: "tasks",
            recordName: "task-list:lifeos_tasks_pro",
            sourceIdHash: "tasks:0123456789abcdef",
            payload: #"{"taskListKey":"lifeos_tasks_pro","items":[{"id":"task-1","text":"Review first","completed":false,"priority":"high","createdAt":1}],"updatedAt":10}"#,
            requiresUserReview: true
        ))
        let fingerprint = LifeOSCloudAccountIdentity.fingerprint(
            containerIdentifier: "iCloud.ai.lifeos.desktop",
            userRecordName: "account-a"
        )

        XCTAssertThrowsError(try LifeOSCloudTaskMutationBuilder.complete(
            record: record,
            itemId: "task-1",
            now: Date(timeIntervalSince1970: 1_700_000_000)
        )) { error in
            XCTAssertEqual(error as? LifeOSCloudTaskWriteError, .invalidRecord)
        }
        XCTAssertThrowsError(try LifeOSCloudPendingMutation.taskCompletion(
            record: record,
            itemId: "task-1",
            accountFingerprint: fingerprint,
            now: Date(timeIntervalSince1970: 1_700_000_000)
        )) { error in
            XCTAssertEqual(error as? LifeOSCloudTaskWriteError, .invalidRecord)
        }
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

    func testChatRequestMutationBuildsCanonicalSafeRecord() throws {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let requestId = "123e4567-e89b-42d3-a456-426614174000"
        let conversationId = "223e4567-e89b-42d3-a456-426614174000"
        let messageId = "323e4567-e89b-42d3-a456-426614174000"
        let trustedMacFingerprint = String(repeating: "f", count: 64)
        let identity = try LifeOSCloudDeviceIdentity(
            deviceId: "423e4567-e89b-42d3-a456-426614174000",
            privateKey: P256.Signing.PrivateKey(rawRepresentation: Data(repeating: 1, count: 32)),
            createdAt: now,
            expiresAt: now.addingTimeInterval(LifeOSCloudDeviceIdentity.lifetime)
        )
        let deviceKeyRecord = try LifeOSCloudDeviceKeyMutationBuilder.create(
            identity: identity,
            displayName: "Test iPhone",
            now: now
        )
        let record = try LifeOSCloudChatRequestMutationBuilder.create(
            prompt: "  Plan tomorrow's focus.  ",
            identity: identity,
            locale: "en-US",
            requestId: requestId,
            conversationId: conversationId,
            userMessageId: messageId,
            clientSequence: 7,
            trustedMacFingerprint: trustedMacFingerprint,
            now: now
        )
        let payload = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(record.payloadJson.utf8)) as? [String: Any]
        )
        let metadata = try XCTUnwrap(payload["syncMutation"] as? [String: Any])

        XCTAssertEqual(record.zone, "LifeOSChatRelayZone")
        XCTAssertEqual(record.recordType, "LifeOSChatRequest")
        XCTAssertEqual(record.recordName, "chat-request:\(requestId)")
        XCTAssertEqual(record.mutationId, "ios-chat-request:\(requestId)")
        XCTAssertEqual(record.logicalClock, 1_700_000_000_000)
        XCTAssertFalse(record.requiresUserReview)
        XCTAssertEqual(payload["schemaVersion"] as? Int, 1)
        XCTAssertEqual(payload["prompt"] as? String, "Plan tomorrow's focus.")
        XCTAssertEqual(payload["deviceId"] as? String, identity.deviceId)
        XCTAssertEqual(payload["sourceDeviceHash"] as? String, identity.deviceIdHash)
        XCTAssertEqual(payload["publicKeyFingerprint"] as? String, identity.publicKeyFingerprint)
        XCTAssertEqual(payload["trustedMacFingerprint"] as? String, trustedMacFingerprint)
        XCTAssertNotNil(payload["signature"] as? String)
        XCTAssertEqual(payload["status"] as? String, "queued")
        XCTAssertEqual((payload["clientSequence"] as? NSNumber)?.int64Value, 7)
        XCTAssertEqual((payload["expiresAt"] as? NSNumber)?.int64Value, 1_700_086_400_000)
        XCTAssertEqual(metadata["kind"] as? String, "chat-request")
        XCTAssertEqual(metadata["origin"] as? String, "ios-native")
        XCTAssertEqual((metadata["mutatedAt"] as? NSNumber)?.int64Value, record.logicalClock)
        XCTAssertEqual(try LifeOSCloudPendingMutation.validateDeviceKeyRecord(deviceKeyRecord, now: now), deviceKeyRecord)
        XCTAssertEqual(
            try LifeOSCloudPendingMutation.validateChatRequestRecord(record, deviceKeyRecord: deviceKeyRecord, now: now),
            record
        )
    }

    func testChatRequestRejectsSecretsAndInvalidExpiry() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let identity = try! LifeOSCloudDeviceIdentity(
            deviceId: "423e4567-e89b-42d3-a456-426614174000",
            privateKey: P256.Signing.PrivateKey(rawRepresentation: Data(repeating: 2, count: 32)),
            createdAt: now,
            expiresAt: now.addingTimeInterval(LifeOSCloudDeviceIdentity.lifetime)
        )
        let common: (String, Date?) throws -> LifeOSCloudRecord = { prompt, expiresAt in
            try LifeOSCloudChatRequestMutationBuilder.create(
                prompt: prompt,
                identity: identity,
                locale: "zh-CN",
                requestId: "123e4567-e89b-42d3-a456-426614174000",
                conversationId: "223e4567-e89b-42d3-a456-426614174000",
                userMessageId: "323e4567-e89b-42d3-a456-426614174000",
                clientSequence: 1,
                now: now,
                expiresAt: expiresAt
            )
        }
        XCTAssertThrowsError(try common("Use sk-1234567890abcdef", nil)) { error in
            XCTAssertEqual(error as? LifeOSCloudChatWriteError, .unsafeContent)
        }
        XCTAssertThrowsError(try common(
            "A safe question",
            Date(timeIntervalSince1970: 1_700_000_000 + LifeOSCloudChatRequestMutationBuilder.requestTTL + 1)
        )) { error in
            XCTAssertEqual(error as? LifeOSCloudChatWriteError, .invalidRequest)
        }
    }

    func testChatActivityDistinguishesWaitingOfflineRetryingCompletedAndTimeout() throws {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let requestId = "123e4567-e89b-42d3-a456-426614174000"
        let identity = try LifeOSCloudDeviceIdentity(
            deviceId: "423e4567-e89b-42d3-a456-426614174000",
            privateKey: P256.Signing.PrivateKey(rawRepresentation: Data(repeating: 4, count: 32)),
            createdAt: now,
            expiresAt: now.addingTimeInterval(LifeOSCloudDeviceIdentity.lifetime)
        )
        let request = try LifeOSCloudChatRequestMutationBuilder.create(
            prompt: "Show the current state clearly.",
            identity: identity,
            locale: "en-US",
            requestId: requestId,
            conversationId: "223e4567-e89b-42d3-a456-426614174000",
            userMessageId: "323e4567-e89b-42d3-a456-426614174000",
            clientSequence: 5,
            now: now
        )
        let base = LifeOSCloudSnapshot(
            schemaVersion: 1,
            accountFingerprint: "test",
            updatedAt: now,
            records: [request],
            serverChangeTokens: [:],
            moreComing: false
        )
        XCTAssertEqual(base.chatItems(now: now.addingTimeInterval(10)).first?.state, .waitingForMac)
        XCTAssertEqual(base.chatItems(now: now.addingTimeInterval(100)).first?.state, .macUnavailable)
        XCTAssertEqual(base.chatItems(now: now.addingTimeInterval(24 * 60 * 60 + 1)).first?.state, .timedOut)

        func response(status: String, text: String? = nil, safeErrorCode: String? = nil) throws -> LifeOSCloudRecord {
            var payload: [String: Any] = [
                "schemaVersion": 1,
                "requestId": requestId,
                "responseId": "523e4567-e89b-42d3-a456-426614174000",
                "conversationId": "223e4567-e89b-42d3-a456-426614174000",
                "status": status,
                "requestContentHash": request.contentHash,
                "updatedAt": NSNumber(value: 1_700_000_001_000 as Int64),
            ]
            if let text { payload["text"] = text }
            if let safeErrorCode { payload["safeErrorCode"] = safeErrorCode }
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
            return try LifeOSCloudRecordValidator.validate(LifeOSCloudRecordInput(
                zone: "LifeOSChatRelayZone",
                recordType: "LifeOSChatResponse",
                recordName: "chat-response:\(requestId)",
                lifeosSchema: "lifeos-cloudkit-record.v1",
                lifeosDataType: "chat-relay",
                sourceIdHash: "chat-relay:1234567890abcdef",
                mutationId: "mac-chat-response:\(requestId)",
                logicalClock: 1_700_000_001_000,
                contentHash: LifeOSCloudDeviceIdentity.sha256Hex(data),
                payloadByteSize: data.count,
                requiresUserReview: false,
                payloadJson: String(decoding: data, as: UTF8.self),
                modifiedAt: now
            ))
        }

        for (record, expected) in [
            (try response(status: "processing"), LifeOSCloudChatItem.State.processing),
            (try response(status: "retrying", safeErrorCode: "ai-temporarily-unavailable"), .retrying),
            (try response(status: "completed", text: "Done"), .completed),
        ] {
            let snapshot = LifeOSCloudSnapshot(
                schemaVersion: 1,
                accountFingerprint: "test",
                updatedAt: now,
                records: [request, record],
                serverChangeTokens: [:],
                moreComing: false
            )
            XCTAssertEqual(
                snapshot.chatItems(now: now, responseVerifier: { _, _ in true }).first?.state,
                expected
            )
        }
    }

    func testChatActivityRejectsUnsignedResponsesByDefaultAndToleratesDuplicateRequests() throws {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let requestId = "123e4567-e89b-42d3-a456-426614174000"
        let identity = try LifeOSCloudDeviceIdentity(
            deviceId: "423e4567-e89b-42d3-a456-426614174000",
            privateKey: P256.Signing.PrivateKey(rawRepresentation: Data(repeating: 5, count: 32)),
            createdAt: now,
            expiresAt: now.addingTimeInterval(LifeOSCloudDeviceIdentity.lifetime)
        )
        let request = try LifeOSCloudChatRequestMutationBuilder.create(
            prompt: "Keep unsigned replies hidden.",
            identity: identity,
            locale: "en-US",
            requestId: requestId,
            conversationId: "223e4567-e89b-42d3-a456-426614174000",
            userMessageId: "323e4567-e89b-42d3-a456-426614174000",
            clientSequence: 8,
            now: now
        )
        let payload: [String: Any] = [
            "schemaVersion": 1,
            "requestId": requestId,
            "responseId": "1d7a0c51-5a71-43ce-ae50-13af3a17e9df",
            "conversationId": "223e4567-e89b-42d3-a456-426614174000",
            "assistantMessageId": "623e4567-e89b-42d3-a456-426614174000",
            "status": "completed",
            "text": "Unsigned reply",
            "requestContentHash": request.contentHash,
            "completedAt": NSNumber(value: 1_700_000_001_000 as Int64),
            "updatedAt": NSNumber(value: 1_700_000_001_000 as Int64),
        ]
        let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        let unsignedResponse = try LifeOSCloudRecordValidator.validate(LifeOSCloudRecordInput(
            zone: "LifeOSChatRelayZone",
            recordType: "LifeOSChatResponse",
            recordName: "chat-response:\(requestId)",
            lifeosSchema: "lifeos-cloudkit-record.v1",
            lifeosDataType: "chat-relay",
            sourceIdHash: "chat-relay:1234567890abcdef",
            mutationId: "mac-chat-response:\(requestId)",
            logicalClock: 1_700_000_001_000,
            contentHash: LifeOSCloudDeviceIdentity.sha256Hex(data),
            payloadByteSize: data.count,
            requiresUserReview: false,
            payloadJson: String(decoding: data, as: UTF8.self),
            modifiedAt: now
        ))
        let snapshot = LifeOSCloudSnapshot(
            schemaVersion: 1,
            accountFingerprint: "test",
            updatedAt: now,
            records: [request, request, unsignedResponse],
            serverChangeTokens: [:],
            moreComing: false
        )

        let items = snapshot.chatItems(now: now.addingTimeInterval(10))
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items.first?.state, .waitingForMac)
        XCTAssertEqual(items.first?.responseText, "")
    }

    func testMacSignedChatResponseIsVerifiedAndTamperingIsRejected() throws {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let requestId = "123e4567-e89b-42d3-a456-426614174000"
        let requestIdentity = try LifeOSCloudDeviceIdentity(
            deviceId: "423e4567-e89b-42d3-a456-426614174000",
            privateKey: P256.Signing.PrivateKey(rawRepresentation: Data(repeating: 4, count: 32)),
            createdAt: now,
            expiresAt: now.addingTimeInterval(LifeOSCloudDeviceIdentity.lifetime)
        )
        let request = try LifeOSCloudChatRequestMutationBuilder.create(
            prompt: "Verify the Mac reply.",
            identity: requestIdentity,
            locale: "en-US",
            requestId: requestId,
            conversationId: "223e4567-e89b-42d3-a456-426614174000",
            userMessageId: "323e4567-e89b-42d3-a456-426614174000",
            clientSequence: 6,
            now: now
        )
        let macIdentity = try LifeOSCloudDeviceIdentity(
            deviceId: "523e4567-e89b-42d3-a456-426614174000",
            privateKey: P256.Signing.PrivateKey(rawRepresentation: Data(repeating: 8, count: 32)),
            createdAt: now,
            expiresAt: now.addingTimeInterval(LifeOSCloudDeviceIdentity.lifetime)
        )
        let responseId = "1d7a0c51-5a71-43ce-ae50-13af3a17e9df"
        var payload: [String: Any] = [
            "schemaVersion": 1,
            "requestId": requestId,
            "responseId": responseId,
            "conversationId": "223e4567-e89b-42d3-a456-426614174000",
            "assistantMessageId": "623e4567-e89b-42d3-a456-426614174000",
            "status": "completed",
            "text": "This reply is authenticated.",
            "providerLabel": "Test",
            "modelLabel": "test-model",
            "requestContentHash": request.contentHash,
            "startedAt": NSNumber(value: 1_700_000_000_500 as Int64),
            "completedAt": NSNumber(value: 1_700_000_001_000 as Int64),
            "updatedAt": NSNumber(value: 1_700_000_001_000 as Int64),
            "macPublicKey": macIdentity.publicKey,
            "macPublicKeyFingerprint": macIdentity.publicKeyFingerprint,
        ]
        payload["macSignature"] = try macIdentity.sign(
            LifeOSCloudMacResponseVerifier.signatureText(payload: payload)
        )

        func record(_ value: [String: Any], logicalClock: Int64 = 1_700_000_001_000) throws -> LifeOSCloudRecord {
            let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
            return try LifeOSCloudRecordValidator.validate(LifeOSCloudRecordInput(
                zone: "LifeOSChatRelayZone",
                recordType: "LifeOSChatResponse",
                recordName: "chat-response:\(requestId)",
                lifeosSchema: "lifeos-cloudkit-record.v1",
                lifeosDataType: "chat-relay",
                sourceIdHash: "chat-relay:1234567890abcdef",
                mutationId: "mac-chat-response:\(requestId)",
                logicalClock: logicalClock,
                contentHash: LifeOSCloudDeviceIdentity.sha256Hex(data),
                payloadByteSize: data.count,
                requiresUserReview: false,
                payloadJson: String(decoding: data, as: UTF8.self),
                modifiedAt: now
            ))
        }

        let signedResponse = try record(payload)
        XCTAssertEqual(
            try LifeOSCloudMacResponseVerifier.verify(response: signedResponse, request: request),
            macIdentity.publicKeyFingerprint
        )
        let receipt = try LifeOSCloudChatReceiptMutationBuilder.create(
            response: signedResponse,
            request: request,
            identity: requestIdentity,
            now: now.addingTimeInterval(2)
        )
        XCTAssertEqual(receipt.recordType, "LifeOSChatReceipt")
        XCTAssertEqual(receipt.recordName, "chat-receipt:\(requestId)")
        XCTAssertEqual(receipt.mutationId, "ios-chat-receipt:\(requestId)")
        XCTAssertEqual(receipt.logicalClock, signedResponse.logicalClock)
        XCTAssertTrue(
            LifeOSCloudChatReceiptMutationBuilder.matches(
                receipt,
                response: signedResponse,
                identity: requestIdentity
            )
        )
        let otherIdentity = try LifeOSCloudDeviceIdentity(
            deviceId: "723e4567-e89b-42d3-a456-426614174000",
            privateKey: P256.Signing.PrivateKey(rawRepresentation: Data(repeating: 9, count: 32)),
            createdAt: now,
            expiresAt: now.addingTimeInterval(LifeOSCloudDeviceIdentity.lifetime)
        )
        XCTAssertFalse(
            LifeOSCloudChatReceiptMutationBuilder.matches(
                receipt,
                response: signedResponse,
                identity: otherIdentity
            )
        )
        var tampered = payload
        tampered["text"] = "Tampered reply"
        XCTAssertThrowsError(
            try LifeOSCloudMacResponseVerifier.verify(response: try record(tampered), request: request)
        ) { error in
            XCTAssertEqual(error as? LifeOSCloudMacTrustError, .invalidSignature)
        }
        XCTAssertThrowsError(
            try LifeOSCloudMacResponseVerifier.verify(
                response: try record(payload, logicalClock: 9_000_000_000_000),
                request: request
            )
        ) { error in
            XCTAssertEqual(error as? LifeOSCloudMacTrustError, .invalidResponse)
        }
    }

    func testMacTrustPinsPerAccountRejectsIdentityChangesAndRequiresFreshResponseAfterReset() throws {
        let storage = InMemoryCloudMacTrustStorage()
        let accountA = String(repeating: "a", count: 64)
        let accountB = String(repeating: "b", count: 64)
        let baseTimestamp: Int64 = 1_700_000_000_000
        let requestIdentity = try LifeOSCloudDeviceIdentity(
            deviceId: "423e4567-e89b-42d3-a456-426614174000",
            privateKey: P256.Signing.PrivateKey(rawRepresentation: Data(repeating: 4, count: 32)),
            createdAt: Date(timeIntervalSince1970: TimeInterval(baseTimestamp) / 1000),
            expiresAt: Date(timeIntervalSince1970: TimeInterval(baseTimestamp) / 1000 + LifeOSCloudDeviceIdentity.lifetime)
        )
        let macA = try LifeOSCloudDeviceIdentity(
            deviceId: "523e4567-e89b-42d3-a456-426614174000",
            privateKey: P256.Signing.PrivateKey(rawRepresentation: Data(repeating: 8, count: 32)),
            createdAt: Date(timeIntervalSince1970: TimeInterval(baseTimestamp) / 1000),
            expiresAt: Date(timeIntervalSince1970: TimeInterval(baseTimestamp) / 1000 + LifeOSCloudDeviceIdentity.lifetime)
        )
        let macB = try LifeOSCloudDeviceIdentity(
            deviceId: "623e4567-e89b-42d3-a456-426614174000",
            privateKey: P256.Signing.PrivateKey(rawRepresentation: Data(repeating: 9, count: 32)),
            createdAt: Date(timeIntervalSince1970: TimeInterval(baseTimestamp) / 1000),
            expiresAt: Date(timeIntervalSince1970: TimeInterval(baseTimestamp) / 1000 + LifeOSCloudDeviceIdentity.lifetime)
        )

        func request(
            id: String,
            conversationId: String,
            messageId: String,
            createdAt: Int64
        ) throws -> LifeOSCloudRecord {
            try LifeOSCloudChatRequestMutationBuilder.create(
                prompt: "Bind this response to one trusted Mac.",
                identity: requestIdentity,
                locale: "en-US",
                requestId: id,
                conversationId: conversationId,
                userMessageId: messageId,
                clientSequence: createdAt - baseTimestamp + 1,
                now: Date(timeIntervalSince1970: TimeInterval(createdAt) / 1000)
            )
        }

        func response(
            request: LifeOSCloudRecord,
            requestId: String,
            conversationId: String,
            mac: LifeOSCloudDeviceIdentity,
            updatedAt: Int64
        ) throws -> LifeOSCloudRecord {
            let responseHash = LifeOSCloudDeviceIdentity.sha256Hex(
                "ownorbit-chat-response:\(requestId.lowercased())"
            )
            let responseId = "\(responseHash.prefix(8))-\(responseHash.dropFirst(8).prefix(4))-4\(responseHash.dropFirst(13).prefix(3))-a\(responseHash.dropFirst(17).prefix(3))-\(responseHash.dropFirst(20).prefix(12))"
            var payload: [String: Any] = [
                "schemaVersion": 1,
                "requestId": requestId,
                "responseId": responseId,
                "conversationId": conversationId,
                "assistantMessageId": "723e4567-e89b-42d3-a456-426614174000",
                "status": "completed",
                "text": "Authenticated response",
                "providerLabel": "Test",
                "modelLabel": "test-model",
                "requestContentHash": request.contentHash,
                "startedAt": NSNumber(value: updatedAt - 100),
                "completedAt": NSNumber(value: updatedAt),
                "updatedAt": NSNumber(value: updatedAt),
                "macPublicKey": mac.publicKey,
                "macPublicKeyFingerprint": mac.publicKeyFingerprint,
            ]
            payload["macSignature"] = try mac.sign(
                LifeOSCloudMacResponseVerifier.signatureText(payload: payload)
            )
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
            return try LifeOSCloudRecordValidator.validate(LifeOSCloudRecordInput(
                zone: "LifeOSChatRelayZone",
                recordType: "LifeOSChatResponse",
                recordName: "chat-response:\(requestId)",
                lifeosSchema: "lifeos-cloudkit-record.v1",
                lifeosDataType: "chat-relay",
                sourceIdHash: "chat-relay:1234567890abcdef",
                mutationId: "mac-chat-response:\(requestId)",
                logicalClock: updatedAt,
                contentHash: LifeOSCloudDeviceIdentity.sha256Hex(data),
                payloadByteSize: data.count,
                requiresUserReview: false,
                payloadJson: String(decoding: data, as: UTF8.self),
                modifiedAt: Date(timeIntervalSince1970: TimeInterval(updatedAt) / 1000)
            ))
        }

        let firstRequestId = "123e4567-e89b-42d3-a456-426614174000"
        let firstConversationId = "223e4567-e89b-42d3-a456-426614174000"
        let firstRequest = try request(
            id: firstRequestId,
            conversationId: firstConversationId,
            messageId: "323e4567-e89b-42d3-a456-426614174000",
            createdAt: baseTimestamp
        )
        let firstMacAResponse = try response(
            request: firstRequest,
            requestId: firstRequestId,
            conversationId: firstConversationId,
            mac: macA,
            updatedAt: baseTimestamp + 500
        )
        XCTAssertTrue(try LifeOSCloudMacTrustStore.verifyAndPin(
            response: firstMacAResponse,
            request: firstRequest,
            accountFingerprint: accountA,
            storage: storage
        ))
        XCTAssertEqual(
            try LifeOSCloudMacTrustStore.trustedFingerprint(accountFingerprint: accountA, storage: storage),
            macA.publicKeyFingerprint
        )

        let firstMacBResponse = try response(
            request: firstRequest,
            requestId: firstRequestId,
            conversationId: firstConversationId,
            mac: macB,
            updatedAt: baseTimestamp + 500
        )
        XCTAssertThrowsError(try LifeOSCloudMacTrustStore.verifyAndPin(
            response: firstMacBResponse,
            request: firstRequest,
            accountFingerprint: accountA,
            storage: storage
        )) { error in
            XCTAssertEqual(error as? LifeOSCloudMacTrustError, .identityChanged)
        }
        XCTAssertTrue(try LifeOSCloudMacTrustStore.verifyAndPin(
            response: firstMacBResponse,
            request: firstRequest,
            accountFingerprint: accountB,
            storage: storage
        ))
        XCTAssertEqual(
            try LifeOSCloudMacTrustStore.trustedFingerprint(accountFingerprint: accountB, storage: storage),
            macB.publicKeyFingerprint
        )

        let resetAt = baseTimestamp + 1_000
        storage.failNextReplacementResetSave = true
        XCTAssertThrowsError(try LifeOSCloudMacTrustStore.reset(
            accountFingerprint: accountA,
            resetAt: resetAt,
            storage: storage
        )) { error in
            XCTAssertEqual(error as? LifeOSCloudMacTrustError, .keychain)
        }
        XCTAssertEqual(storage.trustedFingerprints[accountA], macA.publicKeyFingerprint)
        XCTAssertNil(storage.replacementResetTimes[accountA])
        XCTAssertEqual(Array(storage.operations.suffix(1)), ["save-replacement-reset"])

        storage.failNextTrustedFingerprintRemoval = true
        XCTAssertThrowsError(try LifeOSCloudMacTrustStore.reset(
            accountFingerprint: accountA,
            resetAt: resetAt,
            storage: storage
        )) { error in
            XCTAssertEqual(error as? LifeOSCloudMacTrustError, .keychain)
        }
        XCTAssertEqual(storage.trustedFingerprints[accountA], macA.publicKeyFingerprint)
        XCTAssertEqual(storage.replacementResetTimes[accountA], resetAt)
        XCTAssertEqual(
            Array(storage.operations.suffix(2)),
            ["save-replacement-reset", "remove-trusted-fingerprint"]
        )

        let restartedStorage = InMemoryCloudMacTrustStorage(
            trustedFingerprints: storage.trustedFingerprints,
            replacementResetTimes: storage.replacementResetTimes
        )
        XCTAssertThrowsError(try LifeOSCloudMacTrustStore.verifyAndPin(
            response: firstMacBResponse,
            request: firstRequest,
            accountFingerprint: accountA,
            storage: restartedStorage
        )) { error in
            XCTAssertEqual(error as? LifeOSCloudMacTrustError, .awaitingReplacementResponse)
        }

        let replacementRequestId = "823e4567-e89b-42d3-a456-426614174000"
        let replacementConversationId = "923e4567-e89b-42d3-a456-426614174000"
        let replacementRequest = try request(
            id: replacementRequestId,
            conversationId: replacementConversationId,
            messageId: "a23e4567-e89b-42d3-a456-426614174000",
            createdAt: resetAt + 1
        )
        let replacementResponse = try response(
            request: replacementRequest,
            requestId: replacementRequestId,
            conversationId: replacementConversationId,
            mac: macB,
            updatedAt: resetAt + 2
        )
        XCTAssertTrue(try LifeOSCloudMacTrustStore.verifyAndPin(
            response: replacementResponse,
            request: replacementRequest,
            accountFingerprint: accountA,
            storage: restartedStorage
        ))
        XCTAssertEqual(
            try LifeOSCloudMacTrustStore.trustedFingerprint(
                accountFingerprint: accountA,
                storage: restartedStorage
            ),
            macB.publicKeyFingerprint
        )
        XCTAssertNil(restartedStorage.replacementResetTimes[accountA])
    }

    func testChatRequestOutboxPersistsAndStaysBoundToOneAppleAccount() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("lifeos-chat-outbox-\(UUID().uuidString)", isDirectory: true)
        let fileURL = directory.appendingPathComponent("outbox.json")
        defer {
            if FileManager.default.fileExists(atPath: directory.path) {
                try? FileManager.default.removeItem(at: directory)
            }
        }
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let fingerprint = LifeOSCloudAccountIdentity.fingerprint(
            containerIdentifier: "iCloud.ai.lifeos.desktop",
            userRecordName: "chat-account"
        )
        let otherFingerprint = LifeOSCloudAccountIdentity.fingerprint(
            containerIdentifier: "iCloud.ai.lifeos.desktop",
            userRecordName: "other-account"
        )
        let identity = try LifeOSCloudDeviceIdentity(
            deviceId: "423e4567-e89b-42d3-a456-426614174000",
            privateKey: P256.Signing.PrivateKey(rawRepresentation: Data(repeating: 3, count: 32)),
            createdAt: now,
            expiresAt: now.addingTimeInterval(LifeOSCloudDeviceIdentity.lifetime)
        )
        let deviceKeyRecord = try LifeOSCloudDeviceKeyMutationBuilder.create(
            identity: identity,
            displayName: "Outbox iPhone",
            now: now
        )
        let record = try LifeOSCloudChatRequestMutationBuilder.create(
            prompt: "Summarize today's priorities.",
            identity: identity,
            locale: "en-US",
            requestId: "123e4567-e89b-42d3-a456-426614174000",
            conversationId: "223e4567-e89b-42d3-a456-426614174000",
            userMessageId: "323e4567-e89b-42d3-a456-426614174000",
            clientSequence: 2,
            now: now
        )
        let pending = try LifeOSCloudPendingMutation.chatRequest(
            record: record,
            deviceKeyRecord: deviceKeyRecord,
            accountFingerprint: fingerprint,
            now: now
        )
        var outbox = LifeOSCloudMutationOutbox(fileURL: fileURL, now: now)
        XCTAssertTrue(try outbox.enqueue(pending, now: now))
        XCTAssertFalse(try outbox.enqueue(pending, now: now))
        XCTAssertEqual(outbox.due(accountFingerprint: fingerprint, now: now), [pending])
        XCTAssertTrue(outbox.due(accountFingerprint: otherFingerprint, now: now).isEmpty)
        XCTAssertEqual(outbox.summary(accountFingerprint: otherFingerprint).otherAccount, 1)
        XCTAssertEqual(LifeOSCloudMutationOutbox(fileURL: fileURL, now: now).entries, [pending])
        try outbox.removeChatRequests()
        XCTAssertTrue(outbox.entries.isEmpty)
        XCTAssertTrue(LifeOSCloudMutationOutbox(fileURL: fileURL, now: now).entries.isEmpty)
    }

    func testMutationOutboxPersistsDeduplicatesAndNeverCrossesAppleAccounts() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("lifeos-outbox-\(UUID().uuidString)", isDirectory: true)
        let fileURL = directory.appendingPathComponent("outbox.json")
        defer { try? FileManager.default.removeItem(at: directory) }
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let firstFingerprint = LifeOSCloudAccountIdentity.fingerprint(
            containerIdentifier: "iCloud.ai.lifeos.desktop",
            userRecordName: "account-a"
        )
        let secondFingerprint = LifeOSCloudAccountIdentity.fingerprint(
            containerIdentifier: "iCloud.ai.lifeos.desktop",
            userRecordName: "account-b"
        )
        let memoryId = "ios-memory-123e4567-e89b-42d3-a456-426614174000"
        let record = try LifeOSCloudMemoryMutationBuilder.create(
            title: "Offline memory",
            text: "Keep this safe until iCloud returns.",
            memoryId: memoryId,
            now: now
        )
        let pending = try LifeOSCloudPendingMutation.memory(
            record: record,
            accountFingerprint: firstFingerprint,
            now: now
        )
        var outbox = LifeOSCloudMutationOutbox(fileURL: fileURL, now: now)

        XCTAssertTrue(try outbox.enqueue(pending, now: now))
        XCTAssertFalse(try outbox.enqueue(pending, now: now))
        XCTAssertEqual(outbox.summary(accountFingerprint: firstFingerprint).pending, 1)
        XCTAssertEqual(outbox.summary(accountFingerprint: secondFingerprint).otherAccount, 1)
        XCTAssertEqual(outbox.due(accountFingerprint: secondFingerprint, now: now).count, 0)

        let reloaded = LifeOSCloudMutationOutbox(fileURL: fileURL, now: now)
        XCTAssertEqual(reloaded.entries, [pending])
        XCTAssertEqual(reloaded.due(accountFingerprint: firstFingerprint, now: now), [pending])
        XCTAssertEqual(try fileURL.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup, true)
    }

    func testTaskMutationOutboxSupportsRetryReviewAndExplicitClear() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("lifeos-outbox-\(UUID().uuidString)", isDirectory: true)
        let fileURL = directory.appendingPathComponent("outbox.json")
        defer { try? FileManager.default.removeItem(at: directory) }
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let fingerprint = LifeOSCloudAccountIdentity.fingerprint(
            containerIdentifier: "iCloud.ai.lifeos.desktop",
            userRecordName: "account-a"
        )
        let record = try LifeOSCloudRecordValidator.validate(input(
            zone: "LifeOSTaskZone",
            recordType: "LifeOSTaskListSnapshot",
            dataType: "tasks",
            recordName: "task-list:lifeos_tasks_pro",
            sourceIdHash: "tasks:0123456789abcdef",
            payload: #"{"taskListKey":"lifeos_tasks_pro","items":[{"id":"task-1","text":"Retry safely","completed":false,"priority":"high","createdAt":1}],"updatedAt":10}"#
        ))
        let pending = try LifeOSCloudPendingMutation.taskCompletion(
            record: record,
            itemId: "task-1",
            accountFingerprint: fingerprint,
            now: now
        )
        var outbox = LifeOSCloudMutationOutbox(fileURL: fileURL, now: now)
        try outbox.enqueue(pending, now: now)

        try outbox.markAttempt(id: pending.id, retryAt: now.addingTimeInterval(60))
        XCTAssertTrue(outbox.due(accountFingerprint: fingerprint, now: now).isEmpty)
        try outbox.makeDue(accountFingerprint: fingerprint)
        XCTAssertEqual(outbox.due(accountFingerprint: fingerprint, now: now).count, 1)
        try outbox.markNeedsReview(id: pending.id)
        XCTAssertTrue(outbox.due(accountFingerprint: fingerprint, now: now).isEmpty)
        XCTAssertEqual(outbox.summary(accountFingerprint: fingerprint).needsReview, 1)

        try outbox.clear()
        XCTAssertTrue(outbox.entries.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: fileURL.path))
    }

    func testMutationOutboxDropsTamperedPersistedPayloadsBeforeProcessing() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("lifeos-outbox-\(UUID().uuidString)", isDirectory: true)
        let fileURL = directory.appendingPathComponent("outbox.json")
        defer { try? FileManager.default.removeItem(at: directory) }
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let fingerprint = LifeOSCloudAccountIdentity.fingerprint(
            containerIdentifier: "iCloud.ai.lifeos.desktop",
            userRecordName: "account-a"
        )
        let record = try LifeOSCloudMemoryMutationBuilder.create(
            title: "Offline memory",
            text: "Original queue payload",
            memoryId: "ios-memory-123e4567-e89b-42d3-a456-426614174000",
            now: now
        )
        let pending = try LifeOSCloudPendingMutation.memory(
            record: record,
            accountFingerprint: fingerprint,
            now: now
        )
        var outbox = LifeOSCloudMutationOutbox(fileURL: fileURL, now: now)
        try outbox.enqueue(pending, now: now)
        let stored = try String(contentsOf: fileURL, encoding: .utf8)
        let tampered = stored.replacingOccurrences(of: "Original queue payload", with: "Tampered queue payload")
        XCTAssertNotEqual(stored, tampered)
        try Data(tampered.utf8).write(to: fileURL, options: [.atomic])

        let reloaded = LifeOSCloudMutationOutbox(fileURL: fileURL, now: now)
        XCTAssertTrue(reloaded.entries.isEmpty)
    }

    func testMutationOutboxEnforcesBoundedEntryCount() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("lifeos-outbox-\(UUID().uuidString)", isDirectory: true)
        let fileURL = directory.appendingPathComponent("outbox.json")
        defer { try? FileManager.default.removeItem(at: directory) }
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let fingerprint = LifeOSCloudAccountIdentity.fingerprint(
            containerIdentifier: "iCloud.ai.lifeos.desktop",
            userRecordName: "account-a"
        )
        var outbox = LifeOSCloudMutationOutbox(fileURL: fileURL, now: now)

        for index in 0..<LifeOSCloudMutationOutbox.maxEntries {
            let memoryId = String(
                format: "ios-memory-%08x-0000-4000-8000-%012x",
                index,
                index
            )
            let record = try LifeOSCloudMemoryMutationBuilder.create(
                title: "Queued \(index)",
                text: "Bounded offline action \(index)",
                memoryId: memoryId,
                now: now
            )
            let pending = try LifeOSCloudPendingMutation.memory(
                record: record,
                accountFingerprint: fingerprint,
                now: now
            )
            XCTAssertTrue(try outbox.enqueue(pending, now: now))
        }
        let overflowRecord = try LifeOSCloudMemoryMutationBuilder.create(
            title: "Overflow",
            text: "This action must stay out of a full queue.",
            memoryId: "ios-memory-ffffffff-0000-4000-8000-ffffffffffff",
            now: now
        )
        let overflow = try LifeOSCloudPendingMutation.memory(
            record: overflowRecord,
            accountFingerprint: fingerprint,
            now: now
        )

        XCTAssertThrowsError(try outbox.enqueue(overflow, now: now)) { error in
            XCTAssertEqual(error as? LifeOSCloudMutationOutboxError, .full)
        }
        XCTAssertEqual(outbox.entries.count, LifeOSCloudMutationOutbox.maxEntries)
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

    @MainActor
    func testSimulatorDataStoreQueuesSafeChatAndRejectsSecretLikePrompt() async {
        let store = LifeOSCloudDataStore(demoModeOverride: true)
        let initialCount = store.snapshot.records.count
        let sent = await store.sendChatRequest(prompt: "Help me plan the next hour.")
        XCTAssertTrue(sent)
        XCTAssertEqual(store.snapshot.records.count, initialCount + 2)
        XCTAssertEqual(store.snapshot.records.first(where: { $0.recordType == "LifeOSChatRequest" })?.displayBody, "Help me plan the next hour.")

        let countBeforeUnsafePrompt = store.snapshot.records.count
        let rejected = await store.sendChatRequest(prompt: "My token is sk-1234567890abcdef")
        XCTAssertFalse(rejected)
        XCTAssertEqual(store.snapshot.records.count, countBeforeUnsafePrompt)
        XCTAssertEqual(store.statusTone, .error)
    }

    private func input(
        zone: String,
        recordType: String,
        dataType: String,
        recordName: String,
        sourceIdHash: String,
        payload: String,
        logicalClock: Int64 = 1,
        requiresUserReview: Bool = false
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
            requiresUserReview: requiresUserReview,
            payloadJson: payload,
            modifiedAt: Date(timeIntervalSince1970: TimeInterval(logicalClock))
        )
    }
}
