import {
  MEDIA_NONCE_PREFIX_BYTES,
  bytesToBase64Url,
  canonicalJson,
} from "./protocol.mjs";

export interface PreparedMediaKey {
  mediaKey: CryptoKey;
  /** Same-tab only; caller MUST zero it after signed envelope preparation. */
  mediaDek: Uint8Array;
  noncePrefix: Uint8Array;
  mediaNonce: string;
  wrappedMediaDek: string;
}

export async function prepareMediaKey(input: {
  complianceKeyId: string;
  compliancePublicJwk: JsonWebKey;
}): Promise<PreparedMediaKey> {
  assertWebCrypto();
  const rawDek = crypto.getRandomValues(new Uint8Array(32));
  const noncePrefix = crypto.getRandomValues(
    new Uint8Array(MEDIA_NONCE_PREFIX_BYTES),
  );
  try {
    const mediaKey = await crypto.subtle.importKey(
      "raw",
      rawDek,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"],
    );
    const wrapped = await wrapMediaDek(rawDek, input.compliancePublicJwk);
    return {
      mediaKey,
      mediaDek: rawDek.slice(),
      noncePrefix,
      mediaNonce: bytesToBase64Url(noncePrefix),
      wrappedMediaDek: bytesToBase64Url(
        new TextEncoder().encode(
          canonicalJson({
            algorithm: "RSA-OAEP-256",
            key_id: input.complianceKeyId,
            version: 1,
            wrapped_key: bytesToBase64Url(wrapped),
          }),
        ),
      ),
    };
  } finally {
    rawDek.fill(0);
  }
}

async function wrapMediaDek(
  rawDek: Uint8Array,
  publicJwk: JsonWebKey,
): Promise<Uint8Array> {
  const keyOperations = publicJwk.key_ops;
  if (Array.isArray(keyOperations) && keyOperations.includes("encrypt")) {
    const complianceKey = await crypto.subtle.importKey(
      "jwk",
      publicJwk,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["encrypt"],
    );
    return new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "RSA-OAEP" },
        complianceKey,
        rawDek.buffer as ArrayBuffer,
      ),
    );
  }

  const [wrappableMediaKey, complianceKey] = await Promise.all([
    crypto.subtle.importKey(
      "raw",
      rawDek.buffer as ArrayBuffer,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt"],
    ),
    crypto.subtle.importKey(
      "jwk",
      publicJwk,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["wrapKey"],
    ),
  ]);
  return new Uint8Array(
    await crypto.subtle.wrapKey(
      "raw",
      wrappableMediaKey,
      complianceKey,
      { name: "RSA-OAEP" },
    ),
  );
}

function assertWebCrypto(): void {
  if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) {
    throw new Error("Браузер не поддерживает обязательный Web Crypto API");
  }
}
