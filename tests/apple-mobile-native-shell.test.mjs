import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const rootDir = process.cwd();
const nativeDir = path.join(rootDir, "native", "apple", "mobile-shell");

test("Apple native mobile shell validates safe iCloud entries without storing credentials", async () => {
  const [project, entry, store, webView, content, buildScript, smokeScript, packageJson] = await Promise.all([
    readFile(path.join(nativeDir, "project.yml"), "utf8"),
    readFile(path.join(nativeDir, "Sources", "LifeOSEntry.swift"), "utf8"),
    readFile(path.join(nativeDir, "Sources", "LifeOSEntryStore.swift"), "utf8"),
    readFile(path.join(nativeDir, "Sources", "LifeOSWebView.swift"), "utf8"),
    readFile(path.join(nativeDir, "Sources", "ContentView.swift"), "utf8"),
    readFile(path.join(rootDir, "scripts", "build-ios-mobile-shell.mjs"), "utf8"),
    readFile(path.join(rootDir, "scripts", "mobile-ios-native-shell-smoke.mjs"), "utf8"),
    readFile(path.join(rootDir, "package.json"), "utf8").then(JSON.parse),
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
  assert.match(smokeScript, /does not replace cellular/);
  assert.match(packageJson.scripts["mobile:native:build"], /build-ios-mobile-shell/);
  assert.match(packageJson.scripts["mobile:native:smoke"], /mobile-ios-native-shell-smoke/);
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
