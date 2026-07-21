const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const LEGACY_USER_DATA_DIR_NAMES = ["lifeos-ai", "LifeOS AI"];
const FRESH_DATABASE_MAX_BYTES = 16 * 1024;
const MEANINGFUL_USER_TABLES = [
  "app_secrets",
  "custom_apps",
  "devices",
  "memories",
  "messages",
  "tasks",
];

function fileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function hasBackupFiles(dataPath) {
  const backupsPath = path.join(dataPath, "backups");
  try {
    return fs.readdirSync(backupsPath, { withFileTypes: true }).some((entry) => entry.isFile());
  } catch {
    return false;
  }
}

function databaseHasMeaningfulUserData(userDataPath) {
  const databasePath = path.join(userDataPath, "data", "lifeos.db");
  if (!fs.existsSync(databasePath)) return false;

  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const tables = new Set(database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name));
    return MEANINGFUL_USER_TABLES.some((table) => (
      tables.has(table)
      && Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count || 0) > 0
    ));
  } catch {
    return false;
  } finally {
    database?.close();
  }
}

function establishedUserDataScore(userDataPath) {
  const dataPath = path.join(userDataPath, "data");
  if (!fs.existsSync(dataPath)) return 0;

  let score = 0;
  if (fs.existsSync(path.join(dataPath, "lifeos-secret.key"))) score += 8;
  if (fs.existsSync(path.join(dataPath, "desktop-runtime-config.json"))) score += 6;
  if (hasBackupFiles(dataPath)) score += 4;
  if (fileSize(path.join(dataPath, "lifeos.db")) > FRESH_DATABASE_MAX_BYTES) score += 2;
  if (databaseHasMeaningfulUserData(userDataPath)) score += 16;
  return score;
}

function hasDataDirectory(userDataPath) {
  return fs.existsSync(path.join(userDataPath, "data"));
}

function resolvePreferredDesktopUserDataPath({ appDataPath, currentUserDataPath }) {
  const currentPath = path.resolve(currentUserDataPath);
  const candidates = LEGACY_USER_DATA_DIR_NAMES
    .map((name) => path.join(appDataPath, name))
    .filter((candidate, index, all) => (
      path.resolve(candidate) !== currentPath
      && all.findIndex((item) => path.resolve(item) === path.resolve(candidate)) === index
      && hasDataDirectory(candidate)
    ));

  if (!candidates.length) return currentPath;

  const rankedLegacy = candidates
    .map((candidate) => ({ candidate, score: establishedUserDataScore(candidate) }))
    .sort((left, right) => right.score - left.score);
  const bestLegacy = rankedLegacy[0];
  const currentScore = establishedUserDataScore(currentPath);

  if (!hasDataDirectory(currentPath)) return path.resolve(bestLegacy.candidate);
  // A newly renamed app can create a fully migrated but otherwise empty SQLite
  // shell before the old directory is discovered. Database size alone must not
  // hide established legacy data, while real user content always wins.
  if (currentScore <= 2 && bestLegacy.score >= 4) return path.resolve(bestLegacy.candidate);
  return currentPath;
}

module.exports = {
  LEGACY_USER_DATA_DIR_NAMES,
  databaseHasMeaningfulUserData,
  establishedUserDataScore,
  resolvePreferredDesktopUserDataPath,
};
