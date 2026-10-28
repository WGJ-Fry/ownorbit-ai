import assert from "node:assert/strict";
import test from "node:test";
import {
  TAILSCALE_CGNAT_RANGE,
  TAILSCALE_DNS_ADMIN_URL,
  TAILSCALE_MAGIC_DNS_RESOLVER,
  buildTunnelConflictNote,
  detectTunnelConflicts,
} from "../server/tunnelConflict.ts";

const ipv4 = (address) => ({ family: "IPv4", address, internal: false, netmask: "255.255.255.0" });

test("a proxy client in TUN mode is identified as the likely cause", () => {
  const report = detectTunnelConflicts({
    lo0: [{ family: "IPv4", address: "127.0.0.1", internal: true, netmask: "255.0.0.0" }],
    en1: [ipv4("192.168.150.109")],
    utun1024: [ipv4("198.18.0.1")],
  });
  assert.equal(report.detected, true);
  assert.equal(report.severity, "likely");
  assert.equal(report.reason, "proxy-tun-mode");
  assert.deepEqual(report.interfaces, [{ device: "utun1024", kind: "proxy-fake-ip" }]);
});

test("Tailscale's own tunnel is never reported as a conflict", () => {
  const report = detectTunnelConflicts({
    en0: [ipv4("192.168.1.20")],
    utun3: [ipv4("100.88.155.24")],
  });
  assert.equal(report.detected, false);
  assert.equal(report.severity, "none");
  assert.deepEqual(report.interfaces, []);
});

test("with Tailscale up alongside a proxy tunnel, only the proxy is reported", () => {
  const report = detectTunnelConflicts({
    utun3: [ipv4("100.88.155.24")],
    utun1024: [ipv4("198.19.4.7")],
  });
  assert.deepEqual(report.interfaces, [{ device: "utun1024", kind: "proxy-fake-ip" }]);
  assert.equal(report.severity, "likely");
});

test("an unrecognized tunnel is reported as a weaker possibility", () => {
  const report = detectTunnelConflicts({ utun2: [ipv4("10.8.0.6")] });
  assert.equal(report.detected, true);
  assert.equal(report.severity, "possible");
  assert.equal(report.reason, "other-tunnel-interface");
  assert.deepEqual(report.interfaces, [{ device: "utun2", kind: "other-tunnel" }]);
});

test("ordinary and loopback interfaces are never treated as tunnels", () => {
  const report = detectTunnelConflicts({
    lo0: [{ family: "IPv4", address: "127.0.0.1", internal: true, netmask: "255.0.0.0" }],
    en1: [ipv4("192.168.150.109")],
    bridge0: [ipv4("10.0.0.1")],
    "en0:1": [ipv4("172.20.1.1")],
  });
  assert.equal(report.detected, false);
});

test("CGNAT and fake-ip range edges are classified exactly", () => {
  // 100.64–100.127 is Tailscale's range; the neighbours outside it are not.
  assert.equal(detectTunnelConflicts({ utun0: [ipv4("100.64.0.1")] }).detected, false);
  assert.equal(detectTunnelConflicts({ utun0: [ipv4("100.127.255.254")] }).detected, false);
  assert.equal(detectTunnelConflicts({ utun0: [ipv4("100.63.0.1")] }).severity, "possible");
  assert.equal(detectTunnelConflicts({ utun0: [ipv4("100.128.0.1")] }).severity, "possible");
  // 198.18–198.19 is the benchmark range proxy clients use for fake-ip.
  assert.equal(detectTunnelConflicts({ utun0: [ipv4("198.18.0.1")] }).severity, "likely");
  assert.equal(detectTunnelConflicts({ utun0: [ipv4("198.19.255.254")] }).severity, "likely");
  assert.equal(detectTunnelConflicts({ utun0: [ipv4("198.20.0.1")] }).severity, "possible");
  assert.equal(detectTunnelConflicts({ utun0: [ipv4("198.17.0.1")] }).severity, "possible");
});

test("IPv6-only and address-less tunnels are ignored", () => {
  const report = detectTunnelConflicts({
    utun4: [],
    utun5: [{ family: "IPv6", address: "fe80::1", internal: false, netmask: "ffff::" }],
  });
  assert.equal(report.detected, false);
});

test("the conflict note names the fix and adapts to whether Tailscale is up", () => {
  const report = detectTunnelConflicts({ utun1024: [ipv4("198.18.0.1")] });

  const offline = buildTunnelConflictNote(report, false);
  assert.match(offline, /utun1024/);
  assert.match(offline, /system-proxy mode/);
  assert.ok(offline.includes(TAILSCALE_CGNAT_RANGE));
  assert.ok(offline.includes(TAILSCALE_MAGIC_DNS_RESOLVER));

  const online = buildTunnelConflictNote(report, true);
  assert.match(online, /online now/);
  assert.notEqual(online, offline);
});

test("no conflict produces no note at all", () => {
  const clean = detectTunnelConflicts({ en1: [ipv4("192.168.1.5")] });
  assert.equal(buildTunnelConflictNote(clean, false), "");
  assert.equal(buildTunnelConflictNote(clean, true), "");
});

test("the note never leaks tunnel addresses, only device names", () => {
  const report = detectTunnelConflicts({ utun1024: [ipv4("198.18.0.1")], utun2: [ipv4("10.8.0.6")] });
  for (const online of [true, false]) {
    const note = buildTunnelConflictNote(report, online);
    assert.doesNotMatch(note, /198\.18\.0\.1/);
    assert.doesNotMatch(note, /10\.8\.0\.6/);
  }
  assert.equal(JSON.stringify(report).includes("198.18.0.1"), false);
});

test("the MagicDNS guidance points at the page that has both switches", () => {
  assert.equal(TAILSCALE_DNS_ADMIN_URL, "https://login.tailscale.com/admin/dns");
});
