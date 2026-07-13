import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const rootDir = process.cwd();
const nativeDir = path.join(rootDir, "native", "apple", "mobile-shell");

test("Apple native mobile shell validates safe iCloud entries without storing credentials", async () => {
  const [project, entry, store, notifications, app, webView, content, buildScript, smokeScript, packageJson, nativeWorkflow] = await Promise.all([
    readFile(path.join(nativeDir, "project.yml"), "utf8"),
    readFile(path.join(nativeDir, "Sources", "LifeOSEntry.swift"), "utf8"),
    readFile(path.join(nativeDir, "Sources", "LifeOSEntryStore.swift"), "utf8"),
    readFile(path.join(nativeDir, "Sources", "LifeOSEntryNotifications.swift"), "utf8"),
    readFile(path.join(nativeDir, "Sources", "LifeOSMobileApp.swift"), "utf8"),
    readFile(path.join(nativeDir, "Sources", "LifeOSWebView.swift"), "utf8"),
    readFile(path.join(nativeDir, "Sources", "ContentView.swift"), "utf8"),
    readFile(path.join(rootDir, "scripts", "build-ios-mobile-shell.mjs"), "utf8"),
    readFile(path.join(rootDir, "scripts", "mobile-ios-native-shell-smoke.mjs"), "utf8"),
    readFile(path.join(rootDir, "package.json"), "utf8").then(JSON.parse),
    readFile(path.join(rootDir, ".github", "workflows", "ios-native.yml"), "utf8"),
  ]);

  assert.match(project, /platform: iOS/);
  assert.match(project, /NSLocalNetworkUsageDescription/);
  assert.match(project, /lifeos/);
  assert.match(entry, /import CryptoKit/);
  assert.match(entry, /SHA256\.hash/);
  assert.match(entry, /withoutEscapingSlashes/);
  assert.match(entry, /entryChecksumSha256 == checksum/);
  assert.match(entry, /components\.user == nil/);
  assert.match(entry, /scheme == "https" \|\| \(scheme == "http" && isPrivateHost/);
  assert.match(store, /startAccessingSecurityScopedResource/);
  assert.match(store, /payload\["service"\] as\? String == "lifeos-local-core"/);
  assert.match(store, /lifeos\.native\.saved-entry\.v1/);
  assert.match(store, /notifications\.entryDidConnect/);
  assert.match(store, /notifications\.recordConnectionFailure/);
  assert.match(notifications, /expirationWarningLeadTime: TimeInterval = 24 \* 60 \* 60/);
  assert.match(notifications, /connectionFailureThreshold = 3/);
  assert.match(notifications, /requestAuthorization\(options: \[\.alert, \.sound\]\)/);
  assert.match(notifications, /--disable-local-notifications/);
  assert.match(notifications, /LIFEOS_DISABLE_LOCAL_NOTIFICATIONS/);
  assert.match(notifications, /removePendingNotificationRequests/);
  assert.match(app, /UNUserNotificationCenter\.current\(\)\.delegate = self/);
  assert.match(app, /\[\.banner, \.list, \.sound\]/);
  assert.doesNotMatch(notifications, /baseURL|chatURL|pairURL|desktopName|checksum|accessToken|privateKey|apiKey/);
  assert.doesNotMatch(`${entry}\n${store}`, /accessToken|privateKey|adminPassword|apiKey/i);
  assert.match(webView, /WKNavigationDelegate/);
  assert.match(webView, /sameOrigin\(url, entry\.baseURL\)/);
  assert.match(content, /fileImporter/);
  assert.match(content, /allowedContentTypes: \[\.json\]/);
  assert.match(buildScript, /xcodegen/);
  assert.match(buildScript, /xcodebuild/);
  assert.match(buildScript, /CODE_SIGNING_ALLOWED=NO/);
  assert.match(smokeScript, /simctl/);
  assert.match(smokeScript, /native-entry-setup/);
  assert.match(smokeScript, /native-mobile-chat/);
  assert.match(smokeScript, /native-cloud-data/);
  assert.match(smokeScript, /native-cloud-pending-actions/);
  assert.match(smokeScript, /--cloud-outbox-demo/);
  assert.match(smokeScript, /--disable-local-notifications/);
  assert.match(smokeScript, /SIMCTL_CHILD_LIFEOS_DISABLE_LOCAL_NOTIFICATIONS/);
  assert.match(smokeScript, /"privacy", device\.udid, "reset", "all", bundleId/);
  assert.match(smokeScript, /"shutdown", device\.udid/);
  assert.match(smokeScript, /does not replace cellular/);
  assert.match(packageJson.scripts["mobile:native:build"], /build-ios-mobile-shell/);
  assert.match(packageJson.scripts["mobile:native:device:compile"], /--device-compile/);
  assert.match(packageJson.scripts["mobile:native:device:build"], /--device/);
  assert.match(packageJson.scripts["mobile:native:smoke"], /mobile-ios-native-shell-smoke/);
  assert.match(nativeWorkflow, /runs-on: macos-latest/);
  assert.match(nativeWorkflow, /npm run mobile:native:device:compile/);
});

test("Apple native mobile shell has a guarded private CloudKit offline data path", async () => {
  const [project, entitlements, cloudData, cloudSync, cloudOutbox, cloudScreen, buildScript] = await Promise.all([
    readFile(path.join(nativeDir, "project.yml"), "utf8"),
    readFile(path.join(nativeDir, "Config", "LifeOSMobile.entitlements"), "utf8"),
    readFile(path.join(nativeDir, "Sources", "LifeOSCloudData.swift"), "utf8"),
    readFile(path.join(nativeDir, "Sources", "LifeOSCloudKitSync.swift"), "utf8"),
    readFile(path.join(nativeDir, "Sources", "LifeOSCloudMutationOutbox.swift"), "utf8"),
    readFile(path.join(nativeDir, "Sources", "CloudDataScreen.swift"), "utf8"),
    readFile(path.join(rootDir, "scripts", "build-ios-mobile-shell.mjs"), "utf8"),
  ]);

  assert.match(project, /CODE_SIGN_ENTITLEMENTS: Config\/LifeOSMobile\.entitlements/);
  assert.match(project, /UIBackgroundModes:[\s\S]*remote-notification/);
  assert.match(project, /UISupportedInterfaceOrientations/);
  assert.match(entitlements, /com\.apple\.developer\.icloud-container-identifiers/);
  assert.match(entitlements, /com\.apple\.developer\.icloud-services/);
  assert.match(entitlements, /CloudKit/);
  assert.match(cloudData, /maxPayloadBytes = 64 \* 1024/);
  assert.match(cloudData, /contentHashMismatch/);
  assert.match(cloudData, /forbiddenField/);
  assert.match(cloudData, /accountFingerprint/);
  assert.match(cloudData, /func scoped\(to fingerprint:/);
  assert.match(cloudData, /resetZones: Set<String>/);
  assert.match(cloudData, /var taskItems: \[LifeOSCloudTaskItem\]/);
  assert.match(cloudSync, /privateCloudDatabase/);
  assert.match(cloudSync, /recordZoneChanges/);
  assert.match(cloudSync, /CKDatabaseSubscription/);
  assert.match(cloudSync, /container\.userRecordID\(\)/);
  assert.match(cloudSync, /changeTokenExpired/);
  assert.match(cloudSync, /Notification\.Name\.CKAccountChanged/);
  assert.match(cloudSync, /enum LifeOSCloudSyncOutcome/);
  assert.match(cloudSync, /lastSyncOutcome\.backgroundFetchResult/);
  assert.match(cloudSync, /lastSyncOutcome = \.failed/);
  assert.match(cloudSync, /maxCatchUpPasses = 3/);
  assert.match(cloudSync, /scheduleRetry\(after:/);
  assert.match(cloudSync, /completeTaskListItem/);
  assert.match(cloudData, /task-list-item-complete/);
  assert.match(cloudData, /LifeOSCloudMemoryMutationBuilder/);
  assert.match(cloudData, /memory-create/);
  assert.match(cloudSync, /func createMemory/);
  assert.match(cloudSync, /ensureZone/);
  assert.match(cloudSync, /savePolicy: \.ifServerRecordUnchanged/);
  assert.match(
    cloudSync,
    /#if targetEnvironment\(simulator\)\s+snapshot = demoMode \? Self\.simulatorDemoSnapshot\(\) : Self\.loadSnapshot\(from: fileURL\)\s+#else\s+snapshot = Self\.loadSnapshot\(from: fileURL\)\s+#endif/,
  );
  assert.match(cloudSync, /completeUntilFirstUserAuthentication/);
  assert.match(cloudSync, /isExcludedFromBackup = true/);
  assert.match(cloudSync, /serverChangeTokens/);
  assert.match(cloudOutbox, /maxEntries = 50/);
  assert.match(cloudOutbox, /maxEncodedBytes = 512 \* 1024/);
  assert.match(cloudOutbox, /accountFingerprint/);
  assert.match(cloudOutbox, /completeUntilFirstUserAuthentication/);
  assert.match(cloudOutbox, /isExcludedFromBackup = true/);
  assert.match(cloudOutbox, /func due\(accountFingerprint:/);
  assert.match(cloudOutbox, /func markNeedsReview/);
  assert.match(cloudSync, /processPendingMutations/);
  assert.match(cloudSync, /seedSimulatorMutationOutbox/);
  assert.match(cloudSync, /currentAccountFingerprint/);
  assert.match(cloudSync, /resolveMemoryCollision/);
  assert.match(cloudSync, /isMatchingTaskCompletion/);
  assert.match(cloudScreen, /cloud\.enable\.safe/);
  assert.match(cloudScreen, /cloudStore\.performNextAction/);
  assert.match(cloudScreen, /LifeOSPendingTaskCompletion/);
  assert.match(cloudScreen, /cloudStore\.completeTaskListItem/);
  assert.match(cloudScreen, /LifeOSMemoryComposer/);
  assert.match(cloudScreen, /cloudStore\.createMemory/);
  assert.match(cloudScreen, /cloudStore\.retryPendingMutations/);
  assert.match(cloudScreen, /cloudStore\.clearPendingMutations/);
  assert.match(buildScript, /generic\/platform=iOS/);
  assert.match(buildScript, /deviceCompile/);
  assert.match(buildScript, /CODE_SIGNING_ALLOWED=NO/);
  assert.match(buildScript, /LIFEOS_CLOUDKIT_ALLOW_PROVISIONING_UPDATES/);
  assert.match(buildScript, /No matching iPhone provisioning profile is installed/);
  assert.doesNotMatch(`${cloudData}\n${cloudSync}\n${cloudOutbox}`, /accessToken|adminPassword|providerApiKey|sessionCookie|privateKey/);
});

test("Apple native mobile shell localizations stay aligned", async () => {
  const [english, chinese] = await Promise.all([
    readFile(path.join(nativeDir, "Resources", "en.lproj", "Localizable.strings"), "utf8"),
    readFile(path.join(nativeDir, "Resources", "zh-Hans.lproj", "Localizable.strings"), "utf8"),
  ]);
  const keys = (source) => [...source.matchAll(/^"([^"]+)"\s*=/gm)].map((match) => match[1]).sort();
  assert.deepEqual(keys(english), keys(chinese));
  assert.ok(keys(english).length >= 25);
  assert.doesNotMatch(english, /=\s*""/);
  assert.doesNotMatch(chinese, /=\s*""/);
});
