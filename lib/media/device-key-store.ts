import type {
  DeviceCryptoKeysRequest,
  DeviceCryptoKeysResponse,
} from "./contracts";
import {
  MediaUploadStore,
  type StoredDeviceKeys,
} from "./upload-store";

export interface DeviceCryptoRegistrationApi {
  readonly currentDeviceId: string;
  readonly currentSession: {
    context: { user_id: string };
  } | null;
  registerDeviceCryptoKeys(
    input: DeviceCryptoKeysRequest,
    idempotencyKey: string,
  ): Promise<DeviceCryptoKeysResponse>;
}

export async function ensureRegisteredDeviceKeys(
  api: DeviceCryptoRegistrationApi,
  store = new MediaUploadStore(),
): Promise<StoredDeviceKeys> {
  const userId = api.currentSession?.context.user_id;
  if (!userId) throw new Error("Требуется активная backend-сессия");
  const deviceId = api.currentDeviceId;
  const storageId = `${userId}:${deviceId}`;
  let stored = await store.getDeviceKeys(storageId);

  if (!stored) {
    stored = await generateDeviceKeys(storageId, userId, deviceId);
    // Private keys are non-extractable CryptoKey objects. IndexedDB stores
    // structured clones; no private JWK or raw key material is persisted.
    await store.putDeviceKeys(stored);
  }

  if (stored.registeredKeyVersion !== null) return stored;

  const response = await api.registerDeviceCryptoKeys(
    {
      version: 1,
      encryption: {
        algorithm: "ECDH-P256+A256KW",
        key_id: stored.encryptionKeyId,
        public_jwk: stored.encryptionPublicJwk,
      },
      signature: {
        algorithm: "ECDSA-P256-SHA256",
        key_id: stored.signatureKeyId,
        public_jwk: stored.signaturePublicJwk,
      },
    },
    stored.registrationIdempotencyKey,
  );
  if (response.deviceId !== deviceId) {
    throw new Error("Backend зарегистрировал crypto keys для другого устройства");
  }
  if (
    response.encryptionKeyId !== stored.encryptionKeyId ||
    response.signatureKeyId !== stored.signatureKeyId
  ) {
    throw new Error("Backend подтвердил другой набор crypto keys устройства");
  }
  stored = { ...stored, registeredKeyVersion: response.keyVersion };
  await store.putDeviceKeys(stored);
  return stored;
}

async function generateDeviceKeys(
  id: string,
  userId: string,
  deviceId: string,
): Promise<StoredDeviceKeys> {
  assertWebCrypto();
  const encryption = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits", "deriveKey"],
  )) as CryptoKeyPair;
  const signature = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const [encryptionPublicJwk, signaturePublicJwk] = await Promise.all([
    crypto.subtle.exportKey("jwk", encryption.publicKey),
    crypto.subtle.exportKey("jwk", signature.publicKey),
  ]);
  const keySuffix = crypto.randomUUID();
  return {
    id,
    userId,
    deviceId,
    encryptionKeyId: `web-enc-${keySuffix}`,
    encryptionPrivateKey: encryption.privateKey,
    encryptionPublicJwk,
    signatureKeyId: `web-sig-${keySuffix}`,
    signaturePrivateKey: signature.privateKey,
    signaturePublicJwk,
    registrationIdempotencyKey: crypto.randomUUID(),
    registeredKeyVersion: null,
    createdAt: new Date().toISOString(),
  };
}

function assertWebCrypto(): void {
  if (!globalThis.crypto?.subtle || typeof crypto.randomUUID !== "function") {
    throw new Error("Браузер не поддерживает обязательный Web Crypto API");
  }
}
