import crypto from "crypto";
import {
  archiveInternalAppSecret,
  getInternalAppSecret,
  getInternalAppSecretStorage,
  saveInternalAppSecret,
} from "./appSecrets";
import {
  cloudKitChatResponseSignatureText,
  type CloudKitChatResponsePayload,
  type CloudKitChatUnsignedResponsePayload,
} from "./cloudKitChatProtocol";

const identitySecretId = "internal.cloudkit-chat-mac-identity.v1";

function isVerifiedSignedDesktop() {
  return process.env.LIFEOS_DISTRIBUTION === "signed"
    && (process.env.LIFEOS_DESKTOP_PACKAGED !== "1" || process.env.LIFEOS_DESKTOP_SIGNATURE_VERIFIED === "1");
}

function isUnsignedDesktop() {
  return process.platform === "darwin" && !isVerifiedSignedDesktop();
}

function requireSystemIdentityStorage() {
  return process.platform === "darwin"
    && Boolean(process.versions.electron)
    && isVerifiedSignedDesktop()
    && process.env.LIFEOS_ALLOW_INSECURE_MAC_IDENTITY_STORAGE !== "1";
}

type StoredMacIdentity = {
  schemaVersion: 1;
  privateKey: string;
  createdAt: number;
};

export type CloudKitMacIdentityPublic = {
  publicKey: string;
  publicKeyFingerprint: string;
};

function parseStoredIdentity(value: string) {
  if (!value) return null;
  let parsed: StoredMacIdentity;
  try {
    parsed = JSON.parse(value) as StoredMacIdentity;
  } catch {
    throw new Error("Stored CloudKit Mac identity is invalid.");
  }
  if (
    parsed?.schemaVersion !== 1
    || typeof parsed.privateKey !== "string"
    || !Number.isSafeInteger(parsed.createdAt)
    || parsed.createdAt <= 0
  ) {
    throw new Error("Stored CloudKit Mac identity is invalid.");
  }
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(parsed.privateKey, "base64url"),
    format: "der",
    type: "pkcs8",
  });
  if (privateKey.asymmetricKeyType !== "ec" || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("Stored CloudKit Mac identity uses an unsupported key.");
  }
  return privateKey;
}

function createStoredIdentity(requireSystemStorage = requireSystemIdentityStorage()) {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const encoded: StoredMacIdentity = {
    schemaVersion: 1,
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
    createdAt: Date.now(),
  };
  saveInternalAppSecret(identitySecretId, JSON.stringify(encoded), { requireSystemStorage });
  return privateKey;
}

function loadOrCreatePrivateKey() {
  const requireSystemStorage = requireSystemIdentityStorage();
  if (
    isUnsignedDesktop()
    && getInternalAppSecretStorage(identitySecretId) === "electron_safe_storage"
  ) {
    // Preserve the inaccessible ciphertext for forensic rollback, then create a
    // stable file-encrypted identity. The iPhone will require an explicit Mac
    // trust reset before accepting a changed identity.
    archiveInternalAppSecret(identitySecretId, "unsigned-keychain");
  }
  return parseStoredIdentity(getInternalAppSecret(identitySecretId, {
    requireSystemStorage,
    migrateToSystemStorage: requireSystemStorage,
  })) || createStoredIdentity(requireSystemStorage);
}

function publicIdentity(privateKey: crypto.KeyObject): CloudKitMacIdentityPublic {
  const publicKeyData = crypto.createPublicKey(privateKey).export({ format: "der", type: "spki" });
  return {
    publicKey: publicKeyData.toString("base64url"),
    publicKeyFingerprint: crypto.createHash("sha256").update(publicKeyData).digest("hex"),
  };
}

export function getCloudKitMacIdentityPublic(): CloudKitMacIdentityPublic {
  return publicIdentity(loadOrCreatePrivateKey());
}

export function signCloudKitChatResponse(
  payload: CloudKitChatUnsignedResponsePayload,
): CloudKitChatResponsePayload {
  const privateKey = loadOrCreatePrivateKey();
  const identity = publicIdentity(privateKey);
  const unsigned = {
    ...payload,
    macPublicKey: identity.publicKey,
    macPublicKeyFingerprint: identity.publicKeyFingerprint,
  };
  const macSignature = crypto.sign(
    "sha256",
    Buffer.from(cloudKitChatResponseSignatureText(unsigned), "utf8"),
    { key: privateKey, dsaEncoding: "ieee-p1363" },
  ).toString("base64url");
  return { ...unsigned, macSignature };
}
