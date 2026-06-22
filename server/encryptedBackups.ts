import crypto from "crypto";
import fs from "fs";
import { getBackupPath, importDatabaseBackup } from "./db";

const MAGIC = "lifeos.encrypted.sqlite.backup";
const VERSION = 1;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const PBKDF2_ITERATIONS = 210_000;
const MAX_CIPHERTEXT_BYTES = 128 * 1024 * 1024;

export type EncryptedBackupPayload = {
  magic: typeof MAGIC;
  version: typeof VERSION;
  encryptedAt: string;
  originalFile: string;
  kdf: {
    name: "pbkdf2";
    hash: "sha256";
    iterations: number;
    salt: string;
  };
  cipher: {
    name: "aes-256-gcm";
    iv: string;
    tag: string;
  };
  ciphertext: string;
};

function normalizePassphrase(passphrase: unknown) {
  if (typeof passphrase !== "string" || passphrase.length < 10) {
    throw new Error("Encryption passphrase must be at least 10 characters");
  }
  if (passphrase.length > 256) {
    throw new Error("Encryption passphrase is too long");
  }
  return passphrase;
}

function deriveKey(passphrase: string, salt: Buffer, iterations = PBKDF2_ITERATIONS) {
  if (!Number.isFinite(iterations) || iterations < 100_000 || iterations > 1_000_000) {
    throw new Error("Unsupported backup KDF parameters");
  }
  return crypto.pbkdf2Sync(passphrase, salt, iterations, KEY_BYTES, "sha256");
}

function decodeBase64UrlField(value: unknown, expectedBytes: number | { min: number; max: number }, label: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid encrypted backup ${label}`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (typeof expectedBytes === "number") {
    if (decoded.length !== expectedBytes) throw new Error(`Invalid encrypted backup ${label}`);
  } else if (decoded.length < expectedBytes.min || decoded.length > expectedBytes.max) {
    throw new Error(`Invalid encrypted backup ${label}`);
  }
  return decoded;
}

export function encryptBackupFile(file: string, passphraseInput: unknown): EncryptedBackupPayload {
  const passphrase = normalizePassphrase(passphraseInput);
  const backupPath = getBackupPath(file);
  if (!backupPath) throw new Error("Backup file not found");

  const plaintext = fs.readFileSync(backupPath);
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  key.fill(0);

  return {
    magic: MAGIC,
    version: VERSION,
    encryptedAt: new Date().toISOString(),
    originalFile: file,
    kdf: {
      name: "pbkdf2",
      hash: "sha256",
      iterations: PBKDF2_ITERATIONS,
      salt: salt.toString("base64url"),
    },
    cipher: {
      name: "aes-256-gcm",
      iv: iv.toString("base64url"),
      tag: tag.toString("base64url"),
    },
    ciphertext: ciphertext.toString("base64url"),
  };
}

function assertPayload(payload: any): asserts payload is EncryptedBackupPayload {
  if (!payload || payload.magic !== MAGIC || payload.version !== VERSION) {
    throw new Error("Unsupported encrypted backup file");
  }
  if (typeof payload.originalFile !== "string" || payload.originalFile.length > 180 || /[\\/]/.test(payload.originalFile)) {
    throw new Error("Unsupported encrypted backup file");
  }
  if (payload.kdf?.name !== "pbkdf2" || payload.kdf?.hash !== "sha256" || payload.cipher?.name !== "aes-256-gcm") {
    throw new Error("Unsupported encrypted backup parameters");
  }
  decodeBase64UrlField(payload.kdf.salt, SALT_BYTES, "salt");
  decodeBase64UrlField(payload.cipher.iv, IV_BYTES, "iv");
  decodeBase64UrlField(payload.cipher.tag, AUTH_TAG_BYTES, "auth tag");
  decodeBase64UrlField(payload.ciphertext, { min: 1, max: MAX_CIPHERTEXT_BYTES }, "ciphertext");
}

export function importEncryptedBackup(payload: unknown, passphraseInput: unknown) {
  const passphrase = normalizePassphrase(passphraseInput);
  assertPayload(payload);

  const salt = decodeBase64UrlField(payload.kdf.salt, SALT_BYTES, "salt");
  const iv = decodeBase64UrlField(payload.cipher.iv, IV_BYTES, "iv");
  const tag = decodeBase64UrlField(payload.cipher.tag, AUTH_TAG_BYTES, "auth tag");
  const ciphertext = decodeBase64UrlField(payload.ciphertext, { min: 1, max: MAX_CIPHERTEXT_BYTES }, "ciphertext");
  const key = deriveKey(passphrase, salt, payload.kdf.iterations);

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return importDatabaseBackup(plaintext, "encrypted-import");
  } catch {
    throw new Error("Encrypted backup could not be decrypted or validated");
  } finally {
    key.fill(0);
  }
}
