// @ts-check

export const MEDIA_CIPHER = "AES-256-GCM-CHUNKED-V1";
export const MEDIA_GCM_TAG_BYTES = 16;
export const MEDIA_NONCE_PREFIX_BYTES = 8;

/**
 * Matches backend `stableJson`: object keys are sorted recursively, arrays keep
 * their order, UTF-8 encoding happens at the call site.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  return JSON.stringify(sortCanonicalValue(value));
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64Url(bytes) {
  let binary = "";
  const blockSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + blockSize));
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * @param {string} value
 * @returns {Uint8Array}
 */
export function base64UrlToBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Value is not canonical base64url");
  }
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytesToBase64Url(bytes) !== value) {
    throw new Error("Value is not canonical base64url");
  }
  return bytes;
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {number} plaintextSize
 * @param {number} maxPlaintextPartBytes
 */
export function calculateMediaUploadPlan(
  plaintextSize,
  maxPlaintextPartBytes,
) {
  if (!Number.isSafeInteger(plaintextSize) || plaintextSize <= 0) {
    throw new Error("Plaintext size must be a positive safe integer");
  }
  if (
    !Number.isSafeInteger(maxPlaintextPartBytes) ||
    maxPlaintextPartBytes <= 0
  ) {
    throw new Error("Plaintext part limit must be a positive safe integer");
  }
  const expectedParts = Math.ceil(plaintextSize / maxPlaintextPartBytes);
  return {
    expectedParts,
    ciphertextSize: plaintextSize + expectedParts * MEDIA_GCM_TAG_BYTES,
  };
}

/**
 * @param {Uint8Array} prefix
 * @param {number} partNumber
 * @returns {Uint8Array}
 */
export function deriveMediaPartIv(prefix, partNumber) {
  if (prefix.byteLength !== MEDIA_NONCE_PREFIX_BYTES) {
    throw new Error("Media nonce prefix must contain exactly 8 bytes");
  }
  if (
    !Number.isSafeInteger(partNumber) ||
    partNumber < 0 ||
    partNumber > 0xffff_ffff
  ) {
    throw new Error("Media part number is outside uint32 range");
  }
  const iv = new Uint8Array(12);
  iv.set(prefix, 0);
  new DataView(iv.buffer).setUint32(MEDIA_NONCE_PREFIX_BYTES, partNumber, false);
  return iv;
}

/**
 * @param {string} mediaId
 * @param {number} partNumber
 * @returns {Uint8Array}
 */
export function mediaPartAad(mediaId, partNumber) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      mediaId,
    )
  ) {
    throw new Error("Media id must be a UUID");
  }
  return new TextEncoder().encode(
    canonicalJson({
      cipher: MEDIA_CIPHER,
      media_id: mediaId,
      part_number: partNumber,
      version: 1,
    }),
  );
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sortCanonicalValue(value) {
  if (Array.isArray(value)) return value.map(sortCanonicalValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(/** @type {Record<string, unknown>} */ (value))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortCanonicalValue(entry)]),
    );
  }
  return value;
}
