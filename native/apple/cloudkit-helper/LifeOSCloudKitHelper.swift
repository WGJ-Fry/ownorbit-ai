import CloudKit
import Foundation

private let protocolVersion = 1
private let requestSchema = "lifeos-cloudkit-helper-request.v1"
private let responseSchema = "lifeos-cloudkit-helper-response.v1"
private let confirmationEnv = "LIFEOS_CLOUDKIT_TEST_WRITE_CONFIRM"
private let confirmationPhrase = "DELETE_DISPOSABLE_RECORDS"

private func nowIso() -> String {
  ISO8601DateFormatter().string(from: Date())
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
    } else {
      response = responseBase(operation: operation, ok: false).merging([
        "errors": ["Unsupported operation: \(redact(operation, limit: 80))"],
        "warnings": [],
      ]) { _, new in new }
    }

    emit(response, exitCode: (response["ok"] as? Bool) == true ? 0 : 1)
  }
}
