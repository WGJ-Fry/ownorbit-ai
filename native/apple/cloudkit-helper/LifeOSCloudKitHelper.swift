import CloudKit
import Foundation

private let protocolVersion = 1
private let requestSchema = "lifeos-cloudkit-helper-request.v1"
private let responseSchema = "lifeos-cloudkit-helper-response.v1"
private let confirmationEnv = "LIFEOS_CLOUDKIT_TEST_WRITE_CONFIRM"
private let confirmationPhrase = "DELETE_DISPOSABLE_RECORDS"
private let syncExportSchema = "lifeos-cloudkit-sync-export.v1"
private let syncExportConfirmation = "SYNC_APPROVED_RECORDS"
private let syncImportConfirmation = "IMPORT_CLOUDKIT_CHANGES"
private let subscriptionId = "lifeos-private-database-changes-v1"

private func nowIso() -> String {
  ISO8601DateFormatter().string(from: Date())
}

private func iso(_ date: Date?) -> String {
  guard let date else { return "" }
  return ISO8601DateFormatter().string(from: date)
}

private func compact(_ value: Any?, limit: Int = 800) -> String {
  let text = String(describing: value ?? "")
    .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    .trimmingCharacters(in: .whitespacesAndNewlines)
  return String(text.prefix(limit))
}

private func redact(_ value: Any?, limit: Int = 800) -> String {
  var text = compact(value, limit: limit)
  let patterns = [
    "\\b(Bearer|Basic)\\s+[A-Za-z0-9._~+/=-]+",
    "\\b(?:github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{12,}|sk-or-[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{20,})\\b",
    "\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b",
    "/Users/[^/\\s]+",
    "/(?:home|tmp|private/tmp|var/folders|Volumes)/[^\\s]+",
    "(client_secret|refresh_token|access_token|token|key|secret|password)=\\S+",
  ]
  for pattern in patterns {
    text = text.replacingOccurrences(of: pattern, with: "[redacted]", options: [.regularExpression, .caseInsensitive])
  }
  return text
}

private func emit(_ response: [String: Any], exitCode: Int32) -> Never {
  let data = (try? JSONSerialization.data(withJSONObject: response, options: [.prettyPrinted, .sortedKeys])) ?? Data("{}".utf8)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
  Foundation.exit(exitCode)
}

private func responseBase(operation: String, ok: Bool) -> [String: Any] {
  [
    "protocolVersion": protocolVersion,
    "schema": responseSchema,
    "operation": operation,
    "ok": ok,
    "checkedAt": nowIso(),
  ]
}

private func stringList(_ value: Any?, limit: Int = 24) -> [String] {
  guard let list = value as? [Any] else { return [] }
  return Array(list.compactMap { item in
    let text = compact(item, limit: 120)
    return text.isEmpty ? nil : text
  }.prefix(limit))
}

private func dictList(_ value: Any?, limit: Int = 16) -> [[String: Any]] {
  guard let list = value as? [Any] else { return [] }
  return Array(list.compactMap { $0 as? [String: Any] }.prefix(limit))
}

private func safeRecordFieldName(_ value: String) -> String {
  let cleaned = value.replacingOccurrences(of: "[^A-Za-z0-9_]", with: "_", options: .regularExpression)
  return String(cleaned.prefix(64))
}

private func encodeChangeToken(_ token: CKServerChangeToken?) -> String {
  guard let token else { return "" }
  guard let data = try? NSKeyedArchiver.archivedData(withRootObject: token, requiringSecureCoding: true) else { return "" }
  return data.base64EncodedString()
}

private func decodeChangeToken(_ value: String) -> CKServerChangeToken? {
  let token = compact(value, limit: 16_384)
  if token.isEmpty { return nil }
  guard let data = Data(base64Encoded: token) else { return nil }
  return try? NSKeyedUnarchiver.unarchivedObject(ofClass: CKServerChangeToken.self, from: data)
}

private func changeTokenByZone(_ request: [String: Any]) -> [String: String] {
  guard let syncState = request["syncState"] as? [String: Any] else { return [:] }
  var result: [String: String] = [:]
  for item in dictList(syncState["zones"], limit: 64) {
    let zone = compact(item["zone"], limit: 80)
    let token = compact(item["serverChangeToken"], limit: 16_384)
    if !zone.isEmpty && !token.isEmpty {
      result[zone] = token
    }
  }
  return result
}

private func cloudKitRecordSummary(record: CKRecord, zone: String) -> [String: Any] {
  [
    "zone": zone,
    "recordType": record.recordType,
    "recordName": record.recordID.recordName,
    "mutationId": compact(record["mutationId"], limit: 80),
    "contentHash": compact(record["contentHash"], limit: 120),
    "logicalClock": (record["logicalClock"] as? NSNumber)?.doubleValue ?? 0,
    "payloadByteSize": (record["payloadByteSize"] as? NSNumber)?.intValue ?? 0,
    "requiresUserReview": (record["requiresUserReview"] as? NSNumber)?.boolValue ?? true,
    "modifiedAt": iso(record.modificationDate),
  ]
}

private func accountStatusName(_ status: CKAccountStatus) -> String {
  switch status {
  case .available: return "available"
  case .couldNotDetermine: return "could-not-determine"
  case .noAccount: return "no-account"
  case .restricted: return "restricted"
  case .temporarilyUnavailable: return "temporarily-unavailable"
  @unknown default: return "unknown"
  }
}

private func firstRecordPlan(_ request: [String: Any]) -> (zone: String, recordType: String)? {
  guard let plan = dictList(request["recordPlan"]).first else { return nil }
  let zone = compact(plan["zone"], limit: 80)
  let recordType = stringList(plan["recordTypes"], limit: 8).first ?? "LifeOSCloudKitRoundtrip"
  if zone.isEmpty || recordType.isEmpty { return nil }
  return (zone, recordType)
}

private func buildProbeResponse(
  operation: String,
  accountStatus: CKAccountStatus,
  warnings: [String],
  errors: [String]
) -> [String: Any] {
  let account = accountStatusName(accountStatus)
  let reachable = accountStatus == .available
  var verified = ["account-status"]
  if reachable {
    verified.append(contentsOf: ["private-database", "container-reachability"])
  }
  var response = responseBase(operation: operation, ok: reachable && errors.isEmpty)
  response["accountStatus"] = account
  response["containerReachable"] = reachable
  response["capabilitiesVerified"] = verified
  response["warnings"] = warnings.map { redact($0, limit: 240) }
  response["errors"] = errors.map { redact($0, limit: 240) }
  response["roundtrip"] = [
    "created": false,
    "fetched": false,
    "deleted": false,
    "recordType": "",
    "zone": "",
  ]
  response["evidenceId"] = "lifeos-cloudkit-probe-\(UUID().uuidString)"
  return response
}

private func runProbe(container: CKContainer, operation: String) async -> [String: Any] {
  do {
    let status = try await container.accountStatus()
    return buildProbeResponse(operation: operation, accountStatus: status, warnings: [], errors: [])
  } catch {
    return buildProbeResponse(
      operation: operation,
      accountStatus: .couldNotDetermine,
      warnings: [],
      errors: ["CloudKit account probe failed: \(redact(error.localizedDescription, limit: 240))"]
    )
  }
}

private func runRoundtrip(container: CKContainer, request: [String: Any]) async -> [String: Any] {
  guard ProcessInfo.processInfo.environment[confirmationEnv] == confirmationPhrase else {
    var response = responseBase(operation: "roundtrip", ok: false)
    response["accountStatus"] = "not-checked"
    response["containerReachable"] = false
    response["capabilitiesVerified"] = ["account-status"]
    response["warnings"] = []
    response["errors"] = ["Set \(confirmationEnv)=\(confirmationPhrase) to allow disposable CloudKit roundtrip writes."]
    response["roundtrip"] = [
      "created": false,
      "fetched": false,
      "deleted": false,
      "recordType": "",
      "zone": "",
    ]
    response["evidenceId"] = ""
    return response
  }

  let probe = await runProbe(container: container, operation: "roundtrip")
  guard probe["ok"] as? Bool == true else { return probe }
  guard let plan = firstRecordPlan(request) else {
    var response = responseBase(operation: "roundtrip", ok: false)
    response["accountStatus"] = probe["accountStatus"] ?? "unknown"
    response["containerReachable"] = probe["containerReachable"] ?? false
    response["capabilitiesVerified"] = probe["capabilitiesVerified"] ?? ["account-status"]
    response["warnings"] = []
    response["errors"] = ["No CloudKit record plan was provided for the disposable roundtrip."]
    response["roundtrip"] = [
      "created": false,
      "fetched": false,
      "deleted": false,
      "recordType": "",
      "zone": "",
    ]
    response["evidenceId"] = ""
    return response
  }

  let database = container.privateCloudDatabase
  let zoneId = CKRecordZone.ID(zoneName: plan.zone, ownerName: CKCurrentUserDefaultName)
  let recordId = CKRecord.ID(recordName: "LifeOSHelperRoundtrip-\(UUID().uuidString)", zoneID: zoneId)
  var warnings: [String] = []
  var errors: [String] = []
  var created = false
  var fetched = false
  var deleted = false

  do {
    _ = try await database.save(CKRecordZone(zoneID: zoneId))
  } catch {
    warnings.append("CloudKit zone save did not complete cleanly; continuing in case it already exists: \(redact(error.localizedDescription, limit: 240))")
  }

  let record = CKRecord(recordType: plan.recordType, recordID: recordId)
  record["lifeosKind"] = "helper-roundtrip" as NSString
  record["createdAt"] = Date() as NSDate
  record["expiresAt"] = Date(timeIntervalSinceNow: 300) as NSDate

  do {
    _ = try await database.save(record)
    created = true
  } catch {
    errors.append("CloudKit disposable record create failed: \(redact(error.localizedDescription, limit: 240))")
  }

  if created {
    do {
      _ = try await database.record(for: recordId)
      fetched = true
    } catch {
      errors.append("CloudKit disposable record fetch failed: \(redact(error.localizedDescription, limit: 240))")
    }
  }

  if created {
    do {
      _ = try await database.deleteRecord(withID: recordId)
      deleted = true
    } catch {
      errors.append("CloudKit disposable record delete failed: \(redact(error.localizedDescription, limit: 240))")
    }
  }

  var response = responseBase(operation: "roundtrip", ok: created && fetched && deleted && errors.isEmpty)
  response["accountStatus"] = probe["accountStatus"] ?? "available"
  response["containerReachable"] = probe["containerReachable"] ?? true
  response["capabilitiesVerified"] = [
    "account-status",
    "private-database",
    "container-reachability",
    "custom-zones",
    "create-fetch-delete-roundtrip",
  ]
  response["warnings"] = warnings.map { redact($0, limit: 240) }
  response["errors"] = errors.map { redact($0, limit: 240) }
  response["roundtrip"] = [
    "created": created,
    "fetched": fetched,
    "deleted": deleted,
    "recordType": plan.recordType,
    "zone": plan.zone,
  ]
  response["evidenceId"] = "lifeos-cloudkit-roundtrip-\(UUID().uuidString)"
  return response
}

private func runSubscriptionProbe(container: CKContainer) async -> [String: Any] {
  let probe = await runProbe(container: container, operation: "subscription-probe")
  guard probe["ok"] as? Bool == true else { return probe }

  let database = container.privateCloudDatabase
  let subscription = CKDatabaseSubscription(subscriptionID: subscriptionId)
  let notification = CKSubscription.NotificationInfo()
  notification.shouldSendContentAvailable = true
  subscription.notificationInfo = notification
  var warnings: [String] = []
  var errors: [String] = []
  var saved = false

  do {
    _ = try await database.save(subscription)
    saved = true
  } catch {
    errors.append("CloudKit subscription save failed: \(redact(error.localizedDescription, limit: 240))")
  }

  var response = responseBase(operation: "subscription-probe", ok: saved && errors.isEmpty)
  response["accountStatus"] = probe["accountStatus"] ?? "available"
  response["containerReachable"] = probe["containerReachable"] ?? true
  response["capabilitiesVerified"] = saved
    ? [
      "account-status",
      "private-database",
      "container-reachability",
      "subscription-push",
    ]
    : [
      "account-status",
      "private-database",
      "container-reachability",
    ]
  response["warnings"] = warnings.map { redact($0, limit: 240) }
  response["errors"] = errors.map { redact($0, limit: 240) }
  response["subscriptionProbe"] = [
    "subscriptionId": subscriptionId,
    "exists": saved,
    "saved": saved,
    "contentAvailable": saved,
  ]
  response["roundtrip"] = [
    "created": false,
    "fetched": false,
    "deleted": false,
    "recordType": "",
    "zone": "",
  ]
  response["evidenceId"] = saved ? "lifeos-cloudkit-subscription-probe-\(UUID().uuidString)" : ""
  return response
}

private func assignRecordField(_ record: CKRecord, key: String, value: Any) {
  let field = safeRecordFieldName(key)
  if field.isEmpty { return }
  if let bool = value as? Bool {
    record[field] = NSNumber(value: bool)
  } else if let number = value as? NSNumber {
    record[field] = number
  } else if let string = value as? String {
    record[field] = string as NSString
  }
}

private func runSyncExport(container: CKContainer, request: [String: Any]) async -> [String: Any] {
  guard let batch = request["syncBatch"] as? [String: Any] else {
    var response = responseBase(operation: "sync-export", ok: false)
    response["accountStatus"] = "not-checked"
    response["containerReachable"] = false
    response["capabilitiesVerified"] = ["account-status"]
    response["warnings"] = []
    response["errors"] = ["syncBatch is required for CloudKit sync export."]
    response["syncExport"] = ["attempted": 0, "saved": 0, "failed": 0, "recordPlanHash": "", "zones": [], "recordTypes": []]
    response["evidenceId"] = ""
    return response
  }
  guard compact(batch["schema"], limit: 80) == syncExportSchema, compact(batch["confirmation"], limit: 80) == syncExportConfirmation else {
    var response = responseBase(operation: "sync-export", ok: false)
    response["accountStatus"] = "not-checked"
    response["containerReachable"] = false
    response["capabilitiesVerified"] = ["account-status"]
    response["warnings"] = []
    response["errors"] = ["CloudKit sync export requires an approved LifeOS batch schema and confirmation."]
    response["syncExport"] = ["attempted": 0, "saved": 0, "failed": 0, "recordPlanHash": "", "zones": [], "recordTypes": []]
    response["evidenceId"] = ""
    return response
  }

  let probe = await runProbe(container: container, operation: "sync-export")
  guard probe["ok"] as? Bool == true else { return probe }

  let database = container.privateCloudDatabase
  let records = dictList(batch["records"], limit: 500)
  let recordPlanHash = compact(batch["recordPlanHash"], limit: 80)
  var warnings: [String] = []
  var errors: [String] = []
  var saved = 0
  var failed = 0
  var zones = Set<String>()
  var recordTypes = Set<String>()
  var createdZones = Set<String>()

  for item in records {
    let zone = compact(item["zone"], limit: 80)
    let recordType = compact(item["recordType"], limit: 80)
    let recordName = compact(item["recordName"], limit: 160)
    guard !zone.isEmpty, !recordType.isEmpty, !recordName.isEmpty else {
      failed += 1
      errors.append("CloudKit sync export skipped one invalid record descriptor.")
      continue
    }
    zones.insert(zone)
    recordTypes.insert(recordType)
    let zoneId = CKRecordZone.ID(zoneName: zone, ownerName: CKCurrentUserDefaultName)
    if !createdZones.contains(zone) {
      do {
        _ = try await database.save(CKRecordZone(zoneID: zoneId))
      } catch {
        warnings.append("CloudKit zone save did not complete cleanly for \(redact(zone, limit: 80)); continuing in case it already exists: \(redact(error.localizedDescription, limit: 240))")
      }
      createdZones.insert(zone)
    }

    let record = CKRecord(recordType: recordType, recordID: CKRecord.ID(recordName: recordName, zoneID: zoneId))
    if let fields = item["fields"] as? [String: Any] {
      for (key, value) in fields {
        assignRecordField(record, key: key, value: value)
      }
    }
    record["lifeosSyncedAt"] = Date() as NSDate

    do {
      _ = try await database.save(record)
      saved += 1
    } catch {
      failed += 1
      errors.append("CloudKit sync export failed for \(redact(recordType, limit: 80)): \(redact(error.localizedDescription, limit: 240))")
    }
  }

  var response = responseBase(operation: "sync-export", ok: records.count > 0 && saved == records.count && failed == 0)
  response["accountStatus"] = probe["accountStatus"] ?? "available"
  response["containerReachable"] = probe["containerReachable"] ?? true
  response["capabilitiesVerified"] = [
    "account-status",
    "private-database",
    "container-reachability",
    "custom-zones",
    "sync-export-save",
  ]
  response["warnings"] = warnings.map { redact($0, limit: 240) }
  response["errors"] = errors.map { redact($0, limit: 240) }
  response["syncExport"] = [
    "attempted": records.count,
    "saved": saved,
    "failed": failed,
    "recordPlanHash": recordPlanHash,
    "zones": Array(zones).sorted(),
    "recordTypes": Array(recordTypes).sorted(),
  ]
  response["roundtrip"] = [
    "created": false,
    "fetched": false,
    "deleted": false,
    "recordType": "",
    "zone": "",
  ]
  response["evidenceId"] = "lifeos-cloudkit-sync-export-\(UUID().uuidString)"
  return response
}

private func runSyncImportPreview(container: CKContainer, request: [String: Any]) async -> [String: Any] {
  let probe = await runProbe(container: container, operation: "sync-import-preview")
  guard probe["ok"] as? Bool == true else { return probe }

  let database = container.privateCloudDatabase
  let recordPlan = dictList(request["recordPlan"], limit: 16)
  let desiredKeys = [
    "lifeosSchema",
    "lifeosDataType",
    "lifeosRecordType",
    "lifeosRecordName",
    "sourceIdHash",
    "mutationId",
    "logicalClock",
    "contentHash",
    "payloadByteSize",
    "requiresUserReview",
    "lifeosSyncedAt",
  ]
  var scannedZones = Set<String>()
  var scannedRecordTypes = Set<String>()
  var previewRecords: [[String: Any]] = []
  var warnings: [String] = []
  var errors: [String] = []
  var fetched = 0
  var failed = 0
  var truncated = false

  for plan in recordPlan {
    let zone = compact(plan["zone"], limit: 80)
    if zone.isEmpty { continue }
    scannedZones.insert(zone)
    let zoneId = CKRecordZone.ID(zoneName: zone, ownerName: CKCurrentUserDefaultName)
    for recordType in stringList(plan["recordTypes"], limit: 16) {
      if recordType.isEmpty { continue }
      scannedRecordTypes.insert(recordType)
      let query = CKQuery(recordType: recordType, predicate: NSPredicate(value: true))
      do {
        let result = try await database.records(
          matching: query,
          inZoneWith: zoneId,
          desiredKeys: desiredKeys,
          resultsLimit: 50
        )
        if result.queryCursor != nil { truncated = true }
        for (_, recordResult) in result.matchResults {
          switch recordResult {
          case .success(let record):
            fetched += 1
            if previewRecords.count < 200 {
              previewRecords.append([
                "zone": zone,
                "recordType": record.recordType,
                "recordName": record.recordID.recordName,
                "mutationId": compact(record["mutationId"], limit: 80),
                "contentHash": compact(record["contentHash"], limit: 120),
                "logicalClock": (record["logicalClock"] as? NSNumber)?.doubleValue ?? 0,
                "payloadByteSize": (record["payloadByteSize"] as? NSNumber)?.intValue ?? 0,
                "requiresUserReview": (record["requiresUserReview"] as? NSNumber)?.boolValue ?? true,
                "modifiedAt": iso(record.modificationDate),
              ])
            } else {
              truncated = true
            }
          case .failure(let error):
            failed += 1
            errors.append("CloudKit import preview could not fetch one \(redact(recordType, limit: 80)) record: \(redact(error.localizedDescription, limit: 240))")
          }
        }
      } catch {
        failed += 1
        errors.append("CloudKit import preview query failed for \(redact(recordType, limit: 80)): \(redact(error.localizedDescription, limit: 240))")
      }
    }
  }

  var response = responseBase(operation: "sync-import-preview", ok: failed == 0)
  response["accountStatus"] = probe["accountStatus"] ?? "available"
  response["containerReachable"] = probe["containerReachable"] ?? true
  response["capabilitiesVerified"] = [
    "account-status",
    "private-database",
    "container-reachability",
    "custom-zones",
    "sync-import-preview-query",
  ]
  response["warnings"] = warnings.map { redact($0, limit: 240) }
  response["errors"] = errors.map { redact($0, limit: 240) }
  response["syncImportPreview"] = [
    "scannedZones": Array(scannedZones).sorted(),
    "scannedRecordTypes": Array(scannedRecordTypes).sorted(),
    "fetched": fetched,
    "failed": failed,
    "truncated": truncated,
    "records": previewRecords,
    "rawPayloadIncluded": false,
  ]
  response["roundtrip"] = [
    "created": false,
    "fetched": false,
    "deleted": false,
    "recordType": "",
    "zone": "",
  ]
  response["evidenceId"] = "lifeos-cloudkit-sync-import-preview-\(UUID().uuidString)"
  return response
}

private func runSyncChangesPreview(container: CKContainer, request: [String: Any]) async -> [String: Any] {
  let probe = await runProbe(container: container, operation: "sync-changes-preview")
  guard probe["ok"] as? Bool == true else { return probe }

  let database = container.privateCloudDatabase
  let recordPlan = dictList(request["recordPlan"], limit: 16)
  let previousTokens = changeTokenByZone(request)
  let desiredKeys = [
    "lifeosSchema",
    "lifeosDataType",
    "lifeosRecordType",
    "lifeosRecordName",
    "sourceIdHash",
    "mutationId",
    "logicalClock",
    "contentHash",
    "payloadByteSize",
    "requiresUserReview",
    "lifeosSyncedAt",
  ]
  var scannedZones = Set<String>()
  var zones: [[String: Any]] = []
  var changedRecords: [[String: Any]] = []
  var deletedRecords: [[String: Any]] = []
  var warnings: [String] = []
  var errors: [String] = []
  var changed = 0
  var deleted = 0
  var failed = 0
  var anyMoreComing = false

  for plan in recordPlan {
    let zone = compact(plan["zone"], limit: 80)
    if zone.isEmpty || scannedZones.contains(zone) { continue }
    scannedZones.insert(zone)
    let zoneId = CKRecordZone.ID(zoneName: zone, ownerName: CKCurrentUserDefaultName)
    let previousToken = decodeChangeToken(previousTokens[zone] ?? "")
    do {
      let result = try await database.recordZoneChanges(
        inZoneWith: zoneId,
        since: previousToken,
        desiredKeys: desiredKeys,
        resultsLimit: 100
      )
      var zoneChanged = 0
      var zoneDeleted = 0
      var zoneFailed = 0
      for (_, recordResult) in result.modificationResultsByID {
        switch recordResult {
        case .success(let modification):
          changed += 1
          zoneChanged += 1
          if changedRecords.count < 300 {
            changedRecords.append(cloudKitRecordSummary(record: modification.record, zone: zone))
          }
        case .failure(let error):
          failed += 1
          zoneFailed += 1
          errors.append("CloudKit change preview could not read one changed record in \(redact(zone, limit: 80)): \(redact(error.localizedDescription, limit: 240))")
        }
      }
      for deletion in result.deletions {
        deleted += 1
        zoneDeleted += 1
        if deletedRecords.count < 300 {
          deletedRecords.append([
            "zone": zone,
            "recordType": deletion.recordType,
            "recordName": deletion.recordID.recordName,
            "deletedAt": nowIso(),
          ])
        }
      }
      if result.moreComing { anyMoreComing = true }
      zones.append([
        "zone": zone,
        "previousServerChangeTokenPresent": previousToken != nil,
        "serverChangeToken": encodeChangeToken(result.changeToken),
        "changed": zoneChanged,
        "deleted": zoneDeleted,
        "failed": zoneFailed,
        "moreComing": result.moreComing,
      ])
    } catch {
      failed += 1
      errors.append("CloudKit change preview failed for \(redact(zone, limit: 80)): \(redact(error.localizedDescription, limit: 240))")
      zones.append([
        "zone": zone,
        "previousServerChangeTokenPresent": previousToken != nil,
        "serverChangeToken": "",
        "changed": 0,
        "deleted": 0,
        "failed": 1,
        "moreComing": false,
      ])
    }
  }

  var response = responseBase(operation: "sync-changes-preview", ok: failed == 0)
  response["accountStatus"] = probe["accountStatus"] ?? "available"
  response["containerReachable"] = probe["containerReachable"] ?? true
  response["capabilitiesVerified"] = [
    "account-status",
    "private-database",
    "container-reachability",
    "custom-zones",
    "change-token-fetch",
    "sync-changes-preview",
  ]
  response["warnings"] = warnings.map { redact($0, limit: 240) }
  response["errors"] = errors.map { redact($0, limit: 240) }
  response["syncChangesPreview"] = [
    "scannedZones": Array(scannedZones).sorted(),
    "changed": changed,
    "deleted": deleted,
    "failed": failed,
    "moreComing": anyMoreComing,
    "zones": zones,
    "changedRecords": changedRecords,
    "deletedRecords": deletedRecords,
    "rawPayloadIncluded": false,
  ]
  response["roundtrip"] = [
    "created": false,
    "fetched": false,
    "deleted": false,
    "recordType": "",
    "zone": "",
  ]
  response["evidenceId"] = "lifeos-cloudkit-sync-changes-preview-\(UUID().uuidString)"
  return response
}

private func runSyncImportQuarantine(container: CKContainer, request: [String: Any]) async -> [String: Any] {
  guard compact(request["importConfirmation"], limit: 80) == syncImportConfirmation else {
    var response = responseBase(operation: "sync-import-quarantine", ok: false)
    response["warnings"] = []
    response["errors"] = ["CloudKit import quarantine requires explicit confirmation: \(syncImportConfirmation)."]
    response["syncImportQuarantine"] = [
      "scannedZones": [],
      "changed": 0,
      "deleted": 0,
      "failed": 0,
      "moreComing": false,
      "zones": [],
      "changedRecords": [],
      "deletedRecords": [],
      "rawPayloadIncluded": false,
    ]
    response["roundtrip"] = [
      "created": false,
      "fetched": false,
      "deleted": false,
      "recordType": "",
      "zone": "",
    ]
    return response
  }

  let probe = await runProbe(container: container, operation: "sync-import-quarantine")
  guard probe["ok"] as? Bool == true else { return probe }

  let database = container.privateCloudDatabase
  let recordPlan = dictList(request["recordPlan"], limit: 16)
  let previousTokens = changeTokenByZone(request)
  let desiredKeys = [
    "lifeosSchema",
    "lifeosDataType",
    "lifeosRecordType",
    "lifeosRecordName",
    "sourceIdHash",
    "mutationId",
    "logicalClock",
    "contentHash",
    "payloadByteSize",
    "requiresUserReview",
    "lifeosSyncedAt",
    "payloadJson",
  ]
  var scannedZones = Set<String>()
  var zones: [[String: Any]] = []
  var changedRecords: [[String: Any]] = []
  var deletedRecords: [[String: Any]] = []
  var warnings: [String] = []
  var errors: [String] = []
  var changed = 0
  var deleted = 0
  var failed = 0
  var anyMoreComing = false

  for plan in recordPlan {
    let zone = compact(plan["zone"], limit: 80)
    if zone.isEmpty || scannedZones.contains(zone) { continue }
    scannedZones.insert(zone)
    let zoneId = CKRecordZone.ID(zoneName: zone, ownerName: CKCurrentUserDefaultName)
    let previousToken = decodeChangeToken(previousTokens[zone] ?? "")
    do {
      let result = try await database.recordZoneChanges(
        inZoneWith: zoneId,
        since: previousToken,
        desiredKeys: desiredKeys,
        resultsLimit: 100
      )
      var zoneChanged = 0
      var zoneDeleted = 0
      var zoneFailed = 0
      for (_, recordResult) in result.modificationResultsByID {
        switch recordResult {
        case .success(let modification):
          changed += 1
          zoneChanged += 1
          if changedRecords.count < 300 {
            var summary = cloudKitRecordSummary(record: modification.record, zone: zone)
            summary["payloadJson"] = compact(modification.record["payloadJson"], limit: 64_000)
            changedRecords.append(summary)
          }
        case .failure(let error):
          failed += 1
          zoneFailed += 1
          errors.append("CloudKit import quarantine could not read one changed record in \(redact(zone, limit: 80)): \(redact(error.localizedDescription, limit: 240))")
        }
      }
      for deletion in result.deletions {
        deleted += 1
        zoneDeleted += 1
        if deletedRecords.count < 300 {
          deletedRecords.append([
            "zone": zone,
            "recordType": deletion.recordType,
            "recordName": deletion.recordID.recordName,
            "deletedAt": nowIso(),
          ])
        }
      }
      if result.moreComing { anyMoreComing = true }
      zones.append([
        "zone": zone,
        "previousServerChangeTokenPresent": previousToken != nil,
        "serverChangeToken": encodeChangeToken(result.changeToken),
        "changed": zoneChanged,
        "deleted": zoneDeleted,
        "failed": zoneFailed,
        "moreComing": result.moreComing,
      ])
    } catch {
      failed += 1
      errors.append("CloudKit import quarantine failed for \(redact(zone, limit: 80)): \(redact(error.localizedDescription, limit: 240))")
      zones.append([
        "zone": zone,
        "previousServerChangeTokenPresent": previousToken != nil,
        "serverChangeToken": "",
        "changed": 0,
        "deleted": 0,
        "failed": 1,
        "moreComing": false,
      ])
    }
  }

  var response = responseBase(operation: "sync-import-quarantine", ok: failed == 0)
  response["accountStatus"] = probe["accountStatus"] ?? "available"
  response["containerReachable"] = probe["containerReachable"] ?? true
  response["capabilitiesVerified"] = [
    "account-status",
    "private-database",
    "container-reachability",
    "custom-zones",
    "change-token-fetch",
    "sync-import-quarantine",
  ]
  response["warnings"] = warnings.map { redact($0, limit: 240) }
  response["errors"] = errors.map { redact($0, limit: 240) }
  response["syncImportQuarantine"] = [
    "scannedZones": Array(scannedZones).sorted(),
    "changed": changed,
    "deleted": deleted,
    "failed": failed,
    "moreComing": anyMoreComing,
    "zones": zones,
    "changedRecords": changedRecords,
    "deletedRecords": deletedRecords,
    "rawPayloadIncluded": true,
  ]
  response["roundtrip"] = [
    "created": false,
    "fetched": false,
    "deleted": false,
    "recordType": "",
    "zone": "",
  ]
  response["evidenceId"] = "lifeos-cloudkit-sync-import-quarantine-\(UUID().uuidString)"
  return response
}

@main
struct LifeOSCloudKitHelper {
  static func main() async {
    guard CommandLine.arguments.contains("--lifeos-cloudkit-json") else {
      emit(responseBase(operation: "unknown", ok: false).merging([
        "errors": ["Missing --lifeos-cloudkit-json."],
        "warnings": [],
      ]) { _, new in new }, exitCode: 2)
    }

    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard
      let payload = try? JSONSerialization.jsonObject(with: input, options: []),
      let request = payload as? [String: Any]
    else {
      emit(responseBase(operation: "unknown", ok: false).merging([
        "errors": ["stdin was not valid JSON."],
        "warnings": [],
      ]) { _, new in new }, exitCode: 2)
    }

    let operation = compact(request["operation"], limit: 40)
    guard request["protocolVersion"] as? Int == protocolVersion, compact(request["schema"], limit: 80) == requestSchema else {
      emit(responseBase(operation: operation.isEmpty ? "unknown" : operation, ok: false).merging([
        "errors": ["Request protocol or schema did not match LifeOS CloudKit helper v1."],
        "warnings": [],
      ]) { _, new in new }, exitCode: 2)
    }

    let containerId = compact(request["containerId"], limit: 160)
    guard !containerId.isEmpty else {
      emit(responseBase(operation: operation, ok: false).merging([
        "errors": ["containerId is required."],
        "warnings": [],
      ]) { _, new in new }, exitCode: 2)
    }

    let container = CKContainer(identifier: containerId)
    let response: [String: Any]
    if operation == "probe" {
      response = await runProbe(container: container, operation: operation)
    } else if operation == "roundtrip" {
      response = await runRoundtrip(container: container, request: request)
    } else if operation == "subscription-probe" {
      response = await runSubscriptionProbe(container: container)
    } else if operation == "sync-export" {
      response = await runSyncExport(container: container, request: request)
    } else if operation == "sync-import-preview" {
      response = await runSyncImportPreview(container: container, request: request)
    } else if operation == "sync-changes-preview" {
      response = await runSyncChangesPreview(container: container, request: request)
    } else if operation == "sync-import-quarantine" {
      response = await runSyncImportQuarantine(container: container, request: request)
    } else {
      response = responseBase(operation: operation, ok: false).merging([
        "errors": ["Unsupported operation: \(redact(operation, limit: 80))"],
        "warnings": [],
      ]) { _, new in new }
    }

    emit(response, exitCode: (response["ok"] as? Bool) == true ? 0 : 1)
  }
}
