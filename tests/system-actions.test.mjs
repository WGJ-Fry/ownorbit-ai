import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ALLOWED_SCHEMES,
  buildActionLogSourceSummary,
  buildShortcutUrl,
  redactActionTarget,
  redactActionUrl,
  riskForScheme,
  summarizeActionParams,
  normalizeAllowedUrlSchemes,
} from "../src/services/systemActions.ts";
import {
  ALLOWED_URL_SCHEMES_STORAGE_KEY,
  SYSTEM_ACTIONS_STORAGE_KEY,
  SYSTEM_ACTION_LOGS_STORAGE_KEY,
  loadAllowedUrlSchemes,
  loadSavedSystemActions,
  loadSystemActionLogs,
  writeSystemActionStorage,
} from "../src/services/systemActionStorage.ts";

test("system action scheme whitelist removes blocked and malformed schemes", () => {
  assert.deepEqual(
    normalizeAllowedUrlSchemes(["HTTPS", " shortcuts ", "javascript", "data", "file", "blob", "view-source", "bad scheme", "1bad", "weixin"]),
    ["https", "shortcuts", "weixin"],
  );
});

test("system action scheme whitelist falls back when input is unusable", () => {
  assert.deepEqual(normalizeAllowedUrlSchemes("https,shortcuts"), DEFAULT_ALLOWED_SCHEMES);
  assert.deepEqual(normalizeAllowedUrlSchemes(["javascript", "data"], []), []);
  assert.deepEqual(normalizeAllowedUrlSchemes(["javascript", "data"]), DEFAULT_ALLOWED_SCHEMES);
});

test("system action URL logs redact sensitive targets and query values", () => {
  assert.equal(redactActionUrl("tel:+15551234567"), "tel:[redacted]");
  assert.equal(redactActionUrl("sms:+15551234567?body=door-code-1234"), "sms:[redacted]?body=[redacted]");
  assert.equal(redactActionUrl("mailto:user@example.test?subject=Secret&body=Token"), "mailto:[redacted]?subject=[redacted]&body=[redacted]");
  assert.equal(redactActionUrl("shortcuts://run-shortcut?name=LifeOS&text=secret-token"), "shortcuts://run-shortcut?name=[redacted]&text=[redacted]");
  assert.equal(redactActionUrl("https://example.test/path?token=abc&code=123#frag"), "https://example.test/path?token=[redacted]&code=[redacted]");
  assert.equal(redactActionUrl("weixin://dl/business/?ticket=secret"), "weixin://[redacted]?ticket=[redacted]");
  assert.equal(redactActionUrl("not a url"), "[invalid-url]");
  assert.equal(redactActionTarget("+15551234567", "tel"), "[redacted phone]");
  assert.equal(redactActionTarget("user@example.test", "mailto"), "[redacted email]");
  assert.equal(redactActionTarget("https://example.test/path?token=abc", "https"), "https://example.test/path?token=[redacted]");
  assert.equal(redactActionTarget("Open Maps", "maps"), "Open Maps");
});

test("system action helpers classify risk and summarize params", () => {
  assert.equal(riskForScheme("https"), "low");
  assert.equal(riskForScheme("maps"), "medium");
  assert.equal(riskForScheme("tel"), "high");
  assert.equal(summarizeActionParams("shortcuts://run-shortcut?name=LifeOS&input=text&text=hello&token=secret&extra=ignored"), "name, input, text, token");
  assert.equal(summarizeActionParams("tel:+15551234567"), "-");
});

test("system action source summary redacts and aggregates risky origins", () => {
  const summary = buildActionLogSourceSummary([
    { source: "AI Agent token=secret-value", status: "opened", risk: "high" },
    { source: "AI Agent token=other-secret", status: "cancelled", risk: "high" },
    { source: "https://example.test/run?token=abc", status: "blocked", risk: "medium" },
    { source: "Manual Action", status: "opened", risk: "low" },
  ]);

  assert.equal(summary.totalSources, 3);
  assert.equal(summary.topSource, "AI Agent token=[redacted]");
  assert.equal(summary.topSourceCount, 2);
  assert.equal(summary.blockedSources, 1);
  assert.equal(summary.highRiskSources, 1);
  assert.doesNotMatch(summary.topSource, /secret/);
});

test("system action shortcut URL builder encodes name and optional text", () => {
  assert.equal(buildShortcutUrl("LifeOS Bridge", ""), "shortcuts://run-shortcut?name=LifeOS+Bridge");
  assert.equal(
    buildShortcutUrl("LifeOS Bridge", "open sesame"),
    "shortcuts://run-shortcut?name=LifeOS+Bridge&input=text&text=open+sesame",
  );
});

test("system action storage loads safe defaults when local data is corrupt or unavailable", () => {
  const brokenStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("quota");
    },
  };

  assert.deepEqual(loadAllowedUrlSchemes(brokenStorage), DEFAULT_ALLOWED_SCHEMES);
  assert.deepEqual(loadSavedSystemActions(brokenStorage), []);
  assert.deepEqual(loadSystemActionLogs(brokenStorage), []);
  assert.equal(writeSystemActionStorage(SYSTEM_ACTIONS_STORAGE_KEY, [], brokenStorage), false);
});

test("system action storage normalizes whitelist, saved actions, and redacted logs", () => {
  const values = {
    [ALLOWED_URL_SCHEMES_STORAGE_KEY]: JSON.stringify(["HTTPS", "javascript", "shortcuts"]),
    [SYSTEM_ACTIONS_STORAGE_KEY]: JSON.stringify([
      { id: "open-map", name: "Open Map", url: "maps://?q=home" },
      { id: "broken", name: 123, url: "javascript:alert(1)" },
    ]),
    [SYSTEM_ACTION_LOGS_STORAGE_KEY]: JSON.stringify([
      {
        id: "log-1",
        label: "Call",
        url: "tel:+15551234567",
        scheme: "tel",
        status: "opened",
        risk: "high",
      },
      { label: "bad" },
    ]),
  };
  const storage = {
    getItem(key) {
      return values[key] || null;
    },
    setItem(key, value) {
      values[key] = value;
    },
  };

  assert.deepEqual(loadAllowedUrlSchemes(storage), ["https", "shortcuts"]);
  assert.deepEqual(loadSavedSystemActions(storage), [{ id: "open-map", name: "Open Map", url: "maps://?q=home" }]);
  const logs = loadSystemActionLogs(storage);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].url, "tel:[redacted]");
  assert.equal(logs[0].target, "[redacted phone]");
  assert.equal(logs[0].paramsSummary, "-");
  assert.equal(writeSystemActionStorage(SYSTEM_ACTION_LOGS_STORAGE_KEY, logs, storage), true);
  assert.match(values[SYSTEM_ACTION_LOGS_STORAGE_KEY], /tel:\[redacted\]/);
  assert.doesNotMatch(values[SYSTEM_ACTION_LOGS_STORAGE_KEY], /\+15551234567/);
});

test("system action storage filters unsafe saved launchers before UI rendering", () => {
  const values = {
    [SYSTEM_ACTIONS_STORAGE_KEY]: JSON.stringify([
      { id: "safe", name: "Personal phone", url: "tel:+15551234567" },
      { id: "blocked", name: "Script", url: "javascript:alert(1)" },
      { id: "missing", name: "Missing scheme", url: "//example.test" },
      { id: "long", name: "x".repeat(80), url: `sms:+15551234567?body=${"secret".repeat(200)}` },
    ]),
  };
  const storage = {
    getItem(key) {
      return values[key] || null;
    },
  };

  const actions = loadSavedSystemActions(storage);
  assert.equal(actions.length, 2);
  assert.equal(actions[0].url, "tel:+15551234567");
  assert.equal(actions[1].name.length, 40);
  assert.equal(actions[1].url.length, 600);
});
