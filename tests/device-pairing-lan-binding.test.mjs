import assert from "node:assert/strict";
import test from "node:test";
import { pairingBaseUrlNeedsLanBinding } from "../server/routes/deviceRoutes.ts";

test("a LAN QR code is refused while the core only listens on loopback", () => {
  for (const bindHost of ["127.0.0.1", "localhost", "::1", "[::1]", "127.1.2.3"]) {
    assert.equal(pairingBaseUrlNeedsLanBinding("http://192.168.150.109:3000", bindHost), true);
  }
  for (const baseUrl of ["http://10.0.0.5:3000", "http://172.16.0.9:3000", "http://172.31.255.1:3000"]) {
    assert.equal(pairingBaseUrlNeedsLanBinding(baseUrl, "127.0.0.1"), true);
  }
});

test("a LAN QR code is allowed once the core listens on every interface", () => {
  assert.equal(pairingBaseUrlNeedsLanBinding("http://192.168.150.109:3000", "0.0.0.0"), false);
  assert.equal(pairingBaseUrlNeedsLanBinding("http://10.0.0.5:3000", "0.0.0.0"), false);
  // An explicit LAN bind host is also a real listener, so it must not be blocked.
  assert.equal(pairingBaseUrlNeedsLanBinding("http://192.168.150.109:3000", "192.168.150.109"), false);
});

test("tunnel hostnames stay allowed because they proxy into loopback on purpose", () => {
  assert.equal(pairingBaseUrlNeedsLanBinding("https://mac-mini.tailf0e47d.ts.net", "127.0.0.1"), false);
  assert.equal(pairingBaseUrlNeedsLanBinding("https://calm-river-1234.trycloudflare.com", "127.0.0.1"), false);
  assert.equal(pairingBaseUrlNeedsLanBinding("https://orbit.example.com", "127.0.0.1"), false);
});

test("addresses outside the private IPv4 ranges are not treated as LAN pairing", () => {
  assert.equal(pairingBaseUrlNeedsLanBinding("http://172.15.1.4:3000", "127.0.0.1"), false);
  assert.equal(pairingBaseUrlNeedsLanBinding("http://172.32.1.4:3000", "127.0.0.1"), false);
  assert.equal(pairingBaseUrlNeedsLanBinding("http://100.88.155.24:3000", "127.0.0.1"), false);
});

test("an unparsable base URL never crashes the pairing guard", () => {
  assert.equal(pairingBaseUrlNeedsLanBinding("not a url", "127.0.0.1"), false);
  assert.equal(pairingBaseUrlNeedsLanBinding("", "127.0.0.1"), false);
});
