// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";

function installStorage() {
  const storage = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
  };
  return storage;
}

function createFakeIndexedDb() {
  const databases = new Map();
  return {
    open(name) {
      const request = {};
      queueMicrotask(() => {
        const stores = databases.get(name) || new Map();
        databases.set(name, stores);
        request.result = {
          objectStoreNames: {
            contains(storeName) {
              return stores.has(storeName);
            },
          },
          createObjectStore(storeName) {
            if (!stores.has(storeName)) stores.set(storeName, new Map());
          },
          transaction(storeName) {
            const store = stores.get(storeName);
            return {
              objectStore() {
                return {
                  get(key) {
                    const getRequest = {};
                    queueMicrotask(() => {
                      getRequest.result = store?.get(key);
                      getRequest.onsuccess?.();
                    });
                    return getRequest;
                  },
                  put(value, key) {
                    store?.set(key, value);
                  },
                  delete(key) {
                    store?.delete(key);
                  },
                };
              },
              set oncomplete(handler) {
                queueMicrotask(handler);
              },
              set onerror(_handler) {},
            };
          },
          close() {},
        };
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
}

test("mobile pairing intent survives PWA start_url reset and is consumed once", async () => {
  installStorage();
  delete globalThis.indexedDB;
  const pairing = await import(`../src/services/mobilePairingIntent.ts?case=${Date.now()}`);

  pairing.savePendingPairingToken("bind_install_from_safari", 1_000);
  assert.equal(pairing.peekPendingPairingToken(2_000), "bind_install_from_safari");
  assert.equal(pairing.peekPendingPairingToken(11 * 60 * 1000), "bind_install_from_safari");
  assert.equal(pairing.consumePendingPairingToken(2_000), "bind_install_from_safari");
  assert.equal(pairing.consumePendingPairingToken(2_001), "");
});

test("mobile pairing intent ignores invalid or expired tokens", async () => {
  const storage = installStorage();
  delete globalThis.indexedDB;
  const pairing = await import(`../src/services/mobilePairingIntent.ts?case=expired-${Date.now()}`);

  pairing.savePendingPairingToken("not-a-bind-token", 1_000);
  assert.equal(pairing.consumePendingPairingToken(2_000), "");

  pairing.savePendingPairingToken("bind_expired_token", 1_000);
  assert.equal(pairing.consumePendingPairingToken(25 * 60 * 60 * 1000), "");

  storage.set(
    "lifeos_pending_pairing_intent",
    JSON.stringify({ token: "bind_<script>alert(1)</script>", expiresAt: 25 * 60 * 60 * 1000 }),
  );
  assert.equal(pairing.peekPendingPairingToken(2_000), "");
  assert.equal(storage.has("lifeos_pending_pairing_intent"), false);
});

test("mobile pairing intent uses IndexedDB primary storage and clears legacy localStorage", async () => {
  const storage = installStorage();
  globalThis.indexedDB = createFakeIndexedDb();
  const pairing = await import(`../src/services/mobilePairingIntent.ts?case=indexed-primary-${Date.now()}`);

  pairing.savePendingPairingToken("bind_indexed_primary", 1_000);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(storage.has("lifeos_pending_pairing_intent"), false);
  assert.equal(await pairing.peekPendingPairingTokenAsync(2_000), "bind_indexed_primary");

  pairing.clearPendingPairingIntentCacheForTests();
  assert.equal(pairing.peekPendingPairingToken(2_000), "");
  assert.equal(await pairing.consumePendingPairingTokenAsync(2_000), "bind_indexed_primary");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(await pairing.peekPendingPairingTokenAsync(2_001), "");
  assert.equal(storage.has("lifeos_pending_pairing_intent"), false);

  delete globalThis.indexedDB;
});

test("mobile pairing intent migrates legacy localStorage into IndexedDB", async () => {
  const storage = installStorage();
  globalThis.indexedDB = createFakeIndexedDb();
  storage.set("lifeos_pending_pairing_intent", JSON.stringify({
    token: "bind_legacy_migrate",
    createdAt: 1_000,
    expiresAt: 10_000,
  }));
  const pairing = await import(`../src/services/mobilePairingIntent.ts?case=legacy-migrate-${Date.now()}`);

  assert.equal(await pairing.peekPendingPairingTokenAsync(2_000), "bind_legacy_migrate");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(storage.has("lifeos_pending_pairing_intent"), false);

  pairing.clearPendingPairingIntentCacheForTests();
  assert.equal(await pairing.consumePendingPairingTokenAsync(2_000), "bind_legacy_migrate");

  delete globalThis.indexedDB;
});

test("mobile pairing intent extracts tokens from install start URLs", async () => {
  installStorage();
  delete globalThis.indexedDB;
  const pairing = await import(`../src/services/mobilePairingIntent.ts?case=url-${Date.now()}`);

  assert.equal(pairing.extractPairingToken("bind_direct_token"), "bind_direct_token");
  assert.equal(
    pairing.extractPairingToken("http://phone.test/mobile/chat?pairingToken=bind_from_manifest"),
    "bind_from_manifest",
  );
  assert.equal(
    pairing.extractPairingToken("http://phone.test/mobile/pair?token=bind_from_pair_page"),
    "bind_from_pair_page",
  );
  assert.equal(
    pairing.extractPairingToken("http://phone.test/mobile/install/bind_from_install_path"),
    "bind_from_install_path",
  );
  assert.equal(pairing.extractPairingToken("/mobile/install/bind_from_relative_path"), "bind_from_relative_path");
  assert.equal(pairing.extractPairingToken("http://phone.test/mobile/chat"), "");
  assert.equal(pairing.pairingInstallPath("bind_from_path_helper"), "/mobile/install/bind_from_path_helper");
});

test("mobile pairing intent rejects malformed or unsafe install tokens", async () => {
  installStorage();
  delete globalThis.indexedDB;
  const pairing = await import(`../src/services/mobilePairingIntent.ts?case=unsafe-${Date.now()}`);

  assert.equal(pairing.extractPairingToken("bind_short"), "");
  assert.equal(pairing.extractPairingToken("bind_<script>alert(1)</script>"), "");
  assert.equal(pairing.extractPairingToken("http://phone.test/mobile/install/%E0%A4%A"), "");
  assert.equal(pairing.extractPairingToken("http://phone.test/mobile/install/bind_unsafe_token_123%2Fextra"), "");
  assert.equal(pairing.extractPairingToken("http://phone.test/mobile/chat?pairingToken=bind_<script>alert(1)</script>"), "");
  assert.equal(pairing.pairingInstallPath("bind_<script>alert(1)</script>"), "/mobile/chat");
});

test("mobile pair page can switch manifest href for iOS add-to-home-screen", async () => {
  installStorage();
  delete globalThis.indexedDB;
  const pairing = await import(`../src/services/mobilePairingIntent.ts?case=manifest-${Date.now()}`);
  const manifest = {
    href: "/manifest.webmanifest",
    getAttribute(name) {
      return name === "href" ? this.href : null;
    },
    setAttribute(name, value) {
      if (name === "href") this.href = value;
    },
  };
  globalThis.document = {
    querySelector(selector) {
      return selector === 'link[rel="manifest"]' ? manifest : null;
    },
  };

  const restore = pairing.setPairingManifestToken("bind_install_token");
  assert.equal(manifest.href, "/manifest.webmanifest?pairingToken=bind_install_token");
  restore();
  assert.equal(manifest.href, "/manifest.webmanifest");

  delete globalThis.document;
});

test("pasted pairing links on another origin open there instead of replaying the token here", async () => {
  installStorage();
  delete globalThis.indexedDB;
  const pairing = await import(`../src/services/mobilePairingIntent.ts?case=destination-cross-${Date.now()}`);
  const current = "https://old-quick.trycloudflare.com";

  assert.deepEqual(
    pairing.resolvePairingInputDestination("https://new-quick.trycloudflare.com/mobile/install/bind_new_tunnel_token", current),
    { token: "bind_new_tunnel_token", href: "https://new-quick.trycloudflare.com/mobile/install/bind_new_tunnel_token", crossOrigin: true },
  );
  // Legacy pair-page and manifest start_url forms land on the install path too.
  assert.equal(
    pairing.resolvePairingInputDestination("https://new-quick.trycloudflare.com/mobile/pair?token=bind_legacy_pair_link", current)?.href,
    "https://new-quick.trycloudflare.com/mobile/install/bind_legacy_pair_link",
  );
  assert.equal(
    pairing.resolvePairingInputDestination("http://192.168.1.20:3000/mobile/chat?pairingToken=bind_manifest_start", current)?.href,
    "http://192.168.1.20:3000/mobile/install/bind_manifest_start",
  );
  // Scheme, host and port each make a different origin.
  assert.equal(pairing.resolvePairingInputDestination("http://old-quick.trycloudflare.com/mobile/install/bind_scheme_differs", current)?.crossOrigin, true);
  assert.equal(pairing.resolvePairingInputDestination("https://old-quick.trycloudflare.com:8443/mobile/install/bind_port_differs", current)?.crossOrigin, true);
  // Protocol-relative links name a host as well and inherit this page's scheme.
  assert.deepEqual(
    pairing.resolvePairingInputDestination("//mac.tailnet.ts.net/mobile/install/bind_protocol_relative", current),
    { token: "bind_protocol_relative", href: "https://mac.tailnet.ts.net/mobile/install/bind_protocol_relative", crossOrigin: true },
  );
  // Surrounding whitespace from a copy/paste is tolerated.
  assert.equal(
    pairing.resolvePairingInputDestination("  https://new-quick.trycloudflare.com/mobile/install/bind_padded_link\n", current)?.href,
    "https://new-quick.trycloudflare.com/mobile/install/bind_padded_link",
  );
});

test("pasted pairing links keep a base path and drop credentials, query and fragment", async () => {
  installStorage();
  delete globalThis.indexedDB;
  const pairing = await import(`../src/services/mobilePairingIntent.ts?case=destination-base-${Date.now()}`);
  const current = "https://old-quick.trycloudflare.com";

  assert.deepEqual(
    pairing.resolvePairingInputDestination("https://proxy.example.com/ownorbit/mobile/install/bind_base_path_token", current),
    { token: "bind_base_path_token", href: "https://proxy.example.com/ownorbit/mobile/install/bind_base_path_token", crossOrigin: true },
  );
  assert.equal(
    pairing.resolvePairingInputDestination("https://proxy.example.com/my%20apps/ownorbit/mobile/pair?token=bind_nested_base_path", current)?.href,
    "https://proxy.example.com/my%20apps/ownorbit/mobile/install/bind_nested_base_path",
  );
  assert.equal(
    pairing.resolvePairingInputDestination("https://user:secret@proxy.example.com/ownorbit/mobile/install/bind_strip_extras?next=/admin#frag", current)?.href,
    "https://proxy.example.com/ownorbit/mobile/install/bind_strip_extras",
  );
  // A cross-origin destination keeps the base path but never doubles a slash.
  assert.equal(
    pairing.resolvePairingInputDestination("https://proxy.example.com//ownorbit/mobile/install/bind_double_slash_base", current)?.href,
    "https://proxy.example.com/ownorbit/mobile/install/bind_double_slash_base",
  );
  // extractPairingToken itself is unchanged: it still reads only root install paths.
  assert.equal(pairing.extractPairingToken("https://proxy.example.com/ownorbit/mobile/install/bind_base_path_token"), "");
});

test("same-origin pairing links under a base path stay rejected so the credential is kept", async () => {
  installStorage();
  delete globalThis.indexedDB;
  const pairing = await import(`../src/services/mobilePairingIntent.ts?case=destination-same-base-${Date.now()}`);
  const current = "https://proxy.example.com";

  // The pair page reads its token only from a root /mobile/install/ path, so
  // following these would clear the credential here and then fail to pair.
  // Before pasted links were followed they were rejected as unreadable; they
  // still are (the device page then keeps the credential).
  for (const raw of [
    "https://proxy.example.com/ownorbit/mobile/install/bind_same_origin_base",
    "https://proxy.example.com/ownorbit/mobile/pair?token=bind_same_origin_base_query",
    "https://proxy.example.com/my%20apps/ownorbit/mobile/chat?pairingToken=bind_same_origin_nested",
    // A doubled slash can never become a protocol-relative path to another host.
    "https://proxy.example.com//evil.example/mobile/install/bind_double_slash",
    "https:/proxy.example.com/ownorbit/mobile/install/bind_sloppy_same_origin_base",
  ]) {
    assert.equal(pairing.resolvePairingInputDestination(raw, current), null, raw);
    assert.equal(pairing.resolvePairingInputDestination(raw, `${current}/ownorbit/mobile/device`), null, `${raw} from a base-path page`);
  }
  // Root links on the same origin are unaffected.
  assert.deepEqual(
    pairing.resolvePairingInputDestination("https://proxy.example.com/mobile/install/bind_same_origin_root", current),
    { token: "bind_same_origin_root", href: "/mobile/install/bind_same_origin_root", crossOrigin: false },
  );
});

test("scheme links with malformed slashes and backslash host forms never resolve to this origin", async () => {
  installStorage();
  delete globalThis.indexedDB;
  const pairing = await import(`../src/services/mobilePairingIntent.ts?case=destination-malformed-${Date.now()}`);
  const current = "https://old-quick.trycloudflare.com";
  const newHost = "https://new-quick.trycloudflare.com";

  // Resolved against an https page, "https:/host" and "https:host" keep the
  // page's host and push the intended one into the path; a "\\host" pair is a
  // host to the URL parser. Each must land on the new host (or be rejected),
  // never become a same-origin path that clears this origin's credential.
  for (const [raw, token] of [
    ["https:/new-quick.trycloudflare.com/mobile/install/bind_one_slash_scheme", "bind_one_slash_scheme"],
    ["https:new-quick.trycloudflare.com/mobile/install/bind_no_slash_scheme", "bind_no_slash_scheme"],
    ["https:\\new-quick.trycloudflare.com/mobile/install/bind_backslash_scheme", "bind_backslash_scheme"],
    ["HTTPS:\\\\new-quick.trycloudflare.com/mobile/install/bind_double_backslash_scheme", "bind_double_backslash_scheme"],
    ["https:/\\new-quick.trycloudflare.com/mobile/pair?token=bind_mixed_slash_scheme", "bind_mixed_slash_scheme"],
    ["\\\\new-quick.trycloudflare.com/mobile/install/bind_backslash_pair", "bind_backslash_pair"],
    ["/\\new-quick.trycloudflare.com/mobile/install/bind_slash_backslash", "bind_slash_backslash"],
    ["\\/new-quick.trycloudflare.com/mobile/install/bind_backslash_slash", "bind_backslash_slash"],
    ["\t\\\\new-quick.trycloudflare.com/mobile/install/bind_padded_backslash_pair\n", "bind_padded_backslash_pair"],
  ]) {
    assert.deepEqual(
      pairing.resolvePairingInputDestination(raw, current),
      { token, href: `${newHost}/mobile/install/${token}`, crossOrigin: true },
      JSON.stringify(raw),
    );
  }
  // A sloppy scheme link keeps a base path on the other host too.
  assert.equal(
    pairing.resolvePairingInputDestination("https:/proxy.example.com/ownorbit/mobile/install/bind_sloppy_base_path", current)?.href,
    "https://proxy.example.com/ownorbit/mobile/install/bind_sloppy_base_path",
  );
  // An http page reads "https:/host" as the https host, not a path either.
  assert.equal(
    pairing.resolvePairingInputDestination("https:/new-quick.trycloudflare.com/mobile/install/bind_from_http_page", "http://192.168.1.20:3000")?.crossOrigin,
    true,
  );
  // A sloppy link that really names this host is still this origin.
  assert.deepEqual(
    pairing.resolvePairingInputDestination("https:/old-quick.trycloudflare.com/mobile/install/bind_sloppy_same_host", current),
    { token: "bind_sloppy_same_host", href: "/mobile/install/bind_sloppy_same_host", crossOrigin: false },
  );
  // Non-http schemes written the same way stay rejected, and a backslash host
  // pair needs a known page origin to inherit a scheme from.
  assert.equal(pairing.resolvePairingInputDestination("javascript:/new-quick.trycloudflare.com/mobile/install/bind_sloppy_javascript", current), null);
  assert.equal(pairing.resolvePairingInputDestination("\\\\mac.tailnet.ts.net/mobile/install/bind_backslash_unknown_origin", ""), null);
  // A single leading backslash is still just a path on this origin.
  assert.deepEqual(
    pairing.resolvePairingInputDestination("\\mobile/install/bind_single_backslash_path", current),
    { token: "bind_single_backslash_path", href: "/mobile/install/bind_single_backslash_path", crossOrigin: false },
  );
});

test("saving a pending pairing token can be awaited and never rejects", async () => {
  const storage = installStorage();
  globalThis.indexedDB = createFakeIndexedDb();
  const pairing = await import(`../src/services/mobilePairingIntent.ts?case=awaited-save-${Date.now()}`);

  // The device page awaits this before clearing the credential and leaving.
  const saving = pairing.savePendingPairingToken("bind_awaited_save_token", 1_000);
  assert.ok(saving instanceof Promise);
  await saving;
  pairing.clearPendingPairingIntentCacheForTests();
  assert.equal(await pairing.peekPendingPairingTokenAsync(2_000), "bind_awaited_save_token");
  assert.equal(storage.has("lifeos_pending_pairing_intent"), false);

  // IndexedDB and localStorage both failing still resolves.
  globalThis.indexedDB = { open() { throw new Error("blocked"); } };
  globalThis.localStorage.setItem = () => { throw new Error("quota"); };
  await pairing.savePendingPairingToken("bind_storage_blocked_token", 1_000);
  assert.equal(pairing.peekPendingPairingToken(2_000), "bind_storage_blocked_token");
  assert.equal(await pairing.savePendingPairingToken("not-a-bind-token", 1_000), undefined);

  delete globalThis.indexedDB;
});

test("pasted pairing links on the current origin keep today's relative install path", async () => {
  installStorage();
  delete globalThis.indexedDB;
  const pairing = await import(`../src/services/mobilePairingIntent.ts?case=destination-same-${Date.now()}`);
  const current = "https://old-quick.trycloudflare.com";
  const same = { token: "bind_same_origin_token", href: "/mobile/install/bind_same_origin_token", crossOrigin: false };

  assert.deepEqual(pairing.resolvePairingInputDestination("bind_same_origin_token", current), same);
  assert.deepEqual(pairing.resolvePairingInputDestination("/mobile/install/bind_same_origin_token", current), same);
  assert.deepEqual(pairing.resolvePairingInputDestination("https://old-quick.trycloudflare.com/mobile/install/bind_same_origin_token", current), same);
  assert.deepEqual(pairing.resolvePairingInputDestination("HTTPS://OLD-QUICK.trycloudflare.com:443/mobile/install/bind_same_origin_token", current), same);
  assert.deepEqual(pairing.resolvePairingInputDestination("https://old-quick.trycloudflare.com/mobile/chat?pairingToken=bind_same_origin_token", `${current}/mobile/device`), same);
});

test("pasted pairing links reject non-http schemes and unreadable input", async () => {
  installStorage();
  delete globalThis.indexedDB;
  const pairing = await import(`../src/services/mobilePairingIntent.ts?case=destination-unsafe-${Date.now()}`);
  const current = "https://old-quick.trycloudflare.com";

  for (const raw of [
    "",
    "   ",
    "not-a-pairing-link",
    "javascript:alert(1)//mobile/install/bind_javascript_attack",
    "javascript:location='https://evil.example/?token=bind_javascript_query'",
    "JaVaScRiPt:alert('/mobile/install/bind_mixed_case_scheme')",
    "java\tscript:alert(1)?token=bind_tab_split_scheme",
    "java\nscript:alert(1)?pairingToken=bind_newline_split_scheme",
    "\u0001javascript:alert(1)?token=bind_control_prefix",
    "data:text/html,<a href='/mobile/install/bind_data_url_token'>x</a>",
    "data:text/html;base64,PHNjcmlwdD4=?token=bind_data_query_token",
    "vbscript:msgbox?token=bind_vbscript_token",
    "file:///mobile/install/bind_file_url_token",
    "ftp://files.example.com/mobile/install/bind_ftp_url_token",
    "mailto:someone@example.com?token=bind_mailto_token",
    "lifeos://connect/mobile/install/bind_custom_scheme_token",
    // A host without a scheme must not be taken for a path on this origin.
    "new-quick.trycloudflare.com/mobile/install/bind_schemeless_host",
    "https://new-quick.trycloudflare.com/mobile/install/bind_<script>alert(1)</script>",
    "https://new-quick.trycloudflare.com/mobile/install/bind_unsafe_token_123%2Fextra",
    "https://new-quick.trycloudflare.com/mobile/chat",
  ]) {
    assert.equal(pairing.resolvePairingInputDestination(raw, current), null, JSON.stringify(raw));
  }
  assert.equal(pairing.resolvePairingInputDestination(null, current), null);
  assert.equal(pairing.resolvePairingInputDestination(undefined, current), null);
});

test("pasted pairing links still resolve when the current origin is unknown", async () => {
  installStorage();
  delete globalThis.indexedDB;
  const pairing = await import(`../src/services/mobilePairingIntent.ts?case=destination-no-origin-${Date.now()}`);

  assert.deepEqual(
    pairing.resolvePairingInputDestination("https://new-quick.trycloudflare.com/mobile/install/bind_unknown_current", "null"),
    { token: "bind_unknown_current", href: "https://new-quick.trycloudflare.com/mobile/install/bind_unknown_current", crossOrigin: true },
  );
  assert.equal(pairing.resolvePairingInputDestination("//mac.tailnet.ts.net/mobile/install/bind_unknown_current", ""), null);
  assert.deepEqual(
    pairing.resolvePairingInputDestination("bind_unknown_current", ""),
    { token: "bind_unknown_current", href: "/mobile/install/bind_unknown_current", crossOrigin: false },
  );
});
