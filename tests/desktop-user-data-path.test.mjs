import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);
const {
  establishedUserDataScore,
  resolvePreferredDesktopUserDataPath,
} = require("../desktop/userDataPath.cjs");

async function createDataDir(root, name, options = {}) {
  const userDataPath = path.join(root, name);
  const dataPath = path.join(userDataPath, "data");
  await mkdir(dataPath, { recursive: true });
  if (options.databaseBytes) {
    await writeFile(path.join(dataPath, "lifeos.db"), Buffer.alloc(options.databaseBytes));
  }
  if (options.walBytes) {
    await writeFile(path.join(dataPath, "lifeos.db-wal"), Buffer.alloc(options.walBytes));
  }
  if (options.secret) await writeFile(path.join(dataPath, "lifeos-secret.key"), "secret-marker");
  if (options.runtimeConfig) await writeFile(path.join(dataPath, "desktop-runtime-config.json"), "{}");
  if (options.backup) {
    await mkdir(path.join(dataPath, "backups"), { recursive: true });
    await writeFile(path.join(dataPath, "backups", "lifeos-backup.db"), "backup");
  }
  if (options.message) {
    const database = new DatabaseSync(path.join(dataPath, "lifeos.db"));
    database.exec("CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY)");
    database.prepare("INSERT INTO messages (id) VALUES (?)").run("message-1");
    database.close();
  }
  return userDataPath;
}

test("desktop reuses lowercase legacy data after the OwnOrbit rename", async (t) => {
  const appDataPath = await mkdtemp(path.join(tmpdir(), "ownorbit-user-data-"));
  t.after(() => rm(appDataPath, { recursive: true, force: true }));
  const currentUserDataPath = path.join(appDataPath, "ownorbit-ai");
  const legacyUserDataPath = await createDataDir(appDataPath, "lifeos-ai", {
    databaseBytes: 128 * 1024,
    secret: true,
    runtimeConfig: true,
  });

  assert.equal(resolvePreferredDesktopUserDataPath({ appDataPath, currentUserDataPath }), legacyUserDataPath);
});

test("desktop recovers from an accidental fresh OwnOrbit data shell", async (t) => {
  const appDataPath = await mkdtemp(path.join(tmpdir(), "ownorbit-user-data-"));
  t.after(() => rm(appDataPath, { recursive: true, force: true }));
  const currentUserDataPath = await createDataDir(appDataPath, "ownorbit-ai", {
    databaseBytes: 4 * 1024,
    walBytes: 512 * 1024,
  });
  const legacyUserDataPath = await createDataDir(appDataPath, "lifeos-ai", {
    databaseBytes: 128 * 1024,
    secret: true,
    backup: true,
  });

  assert.equal(establishedUserDataScore(currentUserDataPath), 0);
  assert.equal(resolvePreferredDesktopUserDataPath({ appDataPath, currentUserDataPath }), legacyUserDataPath);
});

test("desktop recovers after an empty OwnOrbit database has grown through migrations", async (t) => {
  const appDataPath = await mkdtemp(path.join(tmpdir(), "ownorbit-user-data-"));
  t.after(() => rm(appDataPath, { recursive: true, force: true }));
  const currentUserDataPath = await createDataDir(appDataPath, "ownorbit-ai", {
    databaseBytes: 512 * 1024,
  });
  const legacyUserDataPath = await createDataDir(appDataPath, "lifeos-ai", {
    databaseBytes: 128 * 1024,
    runtimeConfig: true,
  });

  assert.equal(establishedUserDataScore(currentUserDataPath), 2);
  assert.equal(resolvePreferredDesktopUserDataPath({ appDataPath, currentUserDataPath }), legacyUserDataPath);
});

test("desktop keeps a new OwnOrbit database once it contains user content", async (t) => {
  const appDataPath = await mkdtemp(path.join(tmpdir(), "ownorbit-user-data-"));
  t.after(() => rm(appDataPath, { recursive: true, force: true }));
  const currentUserDataPath = await createDataDir(appDataPath, "ownorbit-ai", {
    message: true,
  });
  await createDataDir(appDataPath, "lifeos-ai", {
    databaseBytes: 128 * 1024,
    secret: true,
    backup: true,
  });

  assert.ok(establishedUserDataScore(currentUserDataPath) >= 16);
  assert.equal(resolvePreferredDesktopUserDataPath({ appDataPath, currentUserDataPath }), currentUserDataPath);
});

test("desktop preserves an established OwnOrbit data directory", async (t) => {
  const appDataPath = await mkdtemp(path.join(tmpdir(), "ownorbit-user-data-"));
  t.after(() => rm(appDataPath, { recursive: true, force: true }));
  const currentUserDataPath = await createDataDir(appDataPath, "ownorbit-ai", {
    databaseBytes: 128 * 1024,
    runtimeConfig: true,
  });
  await createDataDir(appDataPath, "lifeos-ai", {
    databaseBytes: 256 * 1024,
    secret: true,
    backup: true,
  });

  assert.equal(resolvePreferredDesktopUserDataPath({ appDataPath, currentUserDataPath }), currentUserDataPath);
});

test("desktop still recognizes the historical title-case folder", async (t) => {
  const appDataPath = await mkdtemp(path.join(tmpdir(), "ownorbit-user-data-"));
  t.after(() => rm(appDataPath, { recursive: true, force: true }));
  const currentUserDataPath = path.join(appDataPath, "ownorbit-ai");
  const legacyUserDataPath = await createDataDir(appDataPath, "LifeOS AI", {
    databaseBytes: 128 * 1024,
    secret: true,
  });

  assert.equal(resolvePreferredDesktopUserDataPath({ appDataPath, currentUserDataPath }), legacyUserDataPath);
});
