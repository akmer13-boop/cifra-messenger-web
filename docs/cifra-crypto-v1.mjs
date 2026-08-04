import {
  base64UrlToBytes,
  bytesToBase64Url,
  bytesToHex,
  canonicalJson,
} from "./protocol.mjs";

export const CIFRA_CRYPTO_SUITE = "CIFRA_CRYPTO_V1";
export const CIFRA_RECIPIENT_KEK_PROFILE =
  "CIFRA-ECDH-P256-HKDF-SHA256-A256KW";
export const CIFRA_KDF_ALGORITHM = "HKDF-SHA-256";
export const CIFRA_CONTENT_ALGORITHM = "A256GCM";

const UTF8 = new TextEncoder();
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MEDIA_KINDS = new Set([
  "image",
  "video",
  "video_note",
  "document",
  "voice",
]);

/** @param {unknown} value */
export function sanitizeEncryptionPublicJwk(value) {
  const jwk = exactRecord(value, ["crv", "kty", "use", "x", "y"], "encryption JWK");
  if (
    jwk.kty !== "EC" ||
    jwk.crv !== "P-256" ||
    jwk.use !== "enc" ||
    !canonicalBytes(jwk.x, 32) ||
    !canonicalBytes(jwk.y, 32)
  ) {
    throw new Error("CIFRA encryption JWK is invalid");
  }
  return /** @type {{kty:"EC",crv:"P-256",x:string,y:string,use:"enc"}} */ ({
    kty: "EC",
    crv: "P-256",
    x: jwk.x,
    y: jwk.y,
    use: "enc",
  });
}

/** @param {JsonWebKey} value */
export function publicEncryptionJwk(value) {
  if (
    value.kty !== "EC" ||
    value.crv !== "P-256" ||
    !canonicalBytes(value.x, 32) ||
    !canonicalBytes(value.y, 32)
  ) {
    throw new Error("Generated P-256 encryption public key is invalid");
  }
  return {
    kty: "EC",
    crv: "P-256",
    x: value.x,
    y: value.y,
    use: "enc",
  };
}

/** @param {JsonWebKey} value */
export function publicSignatureJwk(value) {
  if (
    value.kty !== "EC" ||
    value.crv !== "P-256" ||
    !canonicalBytes(value.x, 32) ||
    !canonicalBytes(value.y, 32)
  ) {
    throw new Error("Generated P-256 signature public key is invalid");
  }
  return {
    kty: "EC",
    crv: "P-256",
    x: value.x,
    y: value.y,
    use: "sig",
  };
}

/** @param {{x:string,y:string}} jwk */
export function ecPublicJwkToUncompressedPoint(jwk) {
  const x = decodeCanonicalBytes(jwk.x, 32, "P-256 x");
  const y = decodeCanonicalBytes(jwk.y, 32, "P-256 y");
  const point = new Uint8Array(65);
  point[0] = 0x04;
  point.set(x, 1);
  point.set(y, 33);
  return point;
}

/**
 * @param {{
 * senderUserId:string,senderDeviceId:string,recipientUserId:string,
 * recipientDeviceId:string,recipientKeyId:string,topicId:string,
 * clientMsgId:string,keyEpoch:number|bigint,ephemeralPublicKey:Uint8Array
 * }} context
 */
export function serializeRecipientKdfContext(context) {
  assertUuid(context.senderUserId, "sender user id");
  assertUuid(context.senderDeviceId, "sender device id");
  assertUuid(context.recipientUserId, "recipient user id");
  assertUuid(context.recipientDeviceId, "recipient device id");
  assertUuid(context.clientMsgId, "client message id");
  const recipientKeyId = canonicalText(context.recipientKeyId, "recipient key id");
  const topicId = canonicalText(context.topicId, "topic id");
  if (
    context.ephemeralPublicKey.byteLength !== 65 ||
    context.ephemeralPublicKey[0] !== 0x04
  ) {
    throw new Error("CIFRA ephemeral key must be an uncompressed P-256 point");
  }
  const epoch = BigInt(context.keyEpoch);
  if (epoch <= BigInt(0) || epoch > BigInt("18446744073709551615")) {
    throw new Error("CIFRA key epoch must fit a positive uint64");
  }
  const epochBytes = new Uint8Array(8);
  new DataView(epochBytes.buffer).setBigUint64(0, epoch, false);
  return concatBytes(
    Uint8Array.of(1),
    lpUtf8(CIFRA_CRYPTO_SUITE),
    lpUtf8("CIFRA-RECIPIENT-KEK"),
    lpUtf8(CIFRA_RECIPIENT_KEK_PROFILE),
    lpUtf8(context.senderUserId),
    lpUtf8(context.senderDeviceId),
    lpUtf8(context.recipientUserId),
    lpUtf8(context.recipientDeviceId),
    lpUtf8(recipientKeyId),
    lpUtf8(topicId),
    lpUtf8(context.clientMsgId),
    epochBytes,
    lpBytes(context.ephemeralPublicKey),
  );
}

/**
 * @param {{privateKey:CryptoKey,publicJwk:JsonWebKey,salt:Uint8Array,info:Uint8Array}} input
 */
export async function deriveRecipientKek(input) {
  assertCrypto();
  if (input.salt.byteLength !== 32) throw new Error("HKDF salt must be 32 bytes");
  const publicJwk = sanitizeEncryptionPublicJwk(input.publicJwk);
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    publicJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: publicKey },
      input.privateKey,
      256,
    ),
  );
  try {
    const hkdfKey = await crypto.subtle.importKey(
      "raw",
      sharedSecret,
      "HKDF",
      false,
      ["deriveBits"],
    );
    return new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: input.salt,
          info: input.info,
        },
        hkdfKey,
        256,
      ),
    );
  } finally {
    sharedSecret.fill(0);
  }
}

/** @param {Uint8Array} kek @param {Uint8Array} dek */
export async function wrapDek(kek, dek) {
  if (kek.byteLength !== 32 || dek.byteLength !== 32) {
    throw new Error("CIFRA KEK and DEK must be 32 bytes");
  }
  const [wrappingKey, contentKey] = await Promise.all([
    crypto.subtle.importKey("raw", kek, "AES-KW", false, ["wrapKey"]),
    crypto.subtle.importKey(
      "raw",
      dek,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    ),
  ]);
  const wrapped = new Uint8Array(
    await crypto.subtle.wrapKey("raw", contentKey, wrappingKey, "AES-KW"),
  );
  if (wrapped.byteLength !== 40) throw new Error("AES-KW output must be 40 bytes");
  return wrapped;
}

/** @param {Uint8Array} kek @param {Uint8Array} wrapped */
export async function unwrapDek(kek, wrapped) {
  if (kek.byteLength !== 32 || wrapped.byteLength !== 40) {
    throw new Error("CIFRA KEK/wrapped DEK length is invalid");
  }
  try {
    const wrappingKey = await crypto.subtle.importKey(
      "raw",
      kek,
      "AES-KW",
      false,
      ["unwrapKey"],
    );
    const contentKey = await crypto.subtle.unwrapKey(
      "raw",
      wrapped,
      wrappingKey,
      "AES-KW",
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", contentKey));
    if (raw.byteLength !== 32) throw new Error("Unwrapped DEK is not 32 bytes");
    return raw;
  } catch {
    throw new Error("CIFRA AES-256-KW integrity check failed");
  }
}

/** @param {{dek:Uint8Array,nonce:Uint8Array,plaintext:Uint8Array,aad?:Uint8Array}} input */
export async function encryptA256Gcm(input) {
  if (input.dek.byteLength !== 32 || input.nonce.byteLength !== 12) {
    throw new Error("A256GCM key or nonce length is invalid");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    input.dek,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const combined = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: input.nonce,
        ...(input.aad ? { additionalData: input.aad } : {}),
        tagLength: 128,
      },
      key,
      input.plaintext,
    ),
  );
  return {
    ciphertext: combined.slice(0, -16),
    authenticationTag: combined.slice(-16),
  };
}

/** @param {{dek:Uint8Array,nonce:Uint8Array,ciphertext:Uint8Array,authenticationTag:Uint8Array,aad?:Uint8Array}} input */
export async function decryptA256Gcm(input) {
  if (
    input.dek.byteLength !== 32 ||
    input.nonce.byteLength !== 12 ||
    input.authenticationTag.byteLength !== 16
  ) {
    throw new Error("A256GCM key, nonce or tag length is invalid");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    input.dek,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: input.nonce,
          ...(input.aad ? { additionalData: input.aad } : {}),
          tagLength: 128,
        },
        key,
        concatBytes(input.ciphertext, input.authenticationTag),
      ),
    );
  } catch {
    throw new Error("CIFRA A256GCM authentication failed");
  }
}

/** @param {{clientMsgId:string,contentType:string,topicId:string}} input */
export function contentAad(input) {
  assertUuid(input.clientMsgId, "client message id");
  canonicalText(input.topicId, "topic id");
  return UTF8.encode(canonicalJson({
    client_msg_id: input.clientMsgId,
    content_algorithm: CIFRA_CONTENT_ALGORITHM,
    content_type: input.contentType,
    protocol: "cifra.content-aad/1",
    schema: "cifra.message/1",
    topic_id: input.topicId,
  }));
}

/** @param {unknown} value */
export function encodeRecipientBundle(value) {
  const parsed = validateRecipientBundle(value);
  return bytesToBase64Url(UTF8.encode(canonicalJson(parsed)));
}

/** @param {string} value */
export function parseRecipientBundle(value) {
  if (typeof value !== "string" || value.length < 16 || value.length > 1_000_000) {
    throw new Error("CIFRA recipient bundle wire length is invalid");
  }
  const decoded = decodeCanonicalBytes(value, null, "recipient bundle");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("CIFRA recipient bundle is not JSON");
  }
  if (canonicalJson(parsed) !== text) {
    throw new Error("CIFRA recipient bundle is not canonical JSON");
  }
  return validateRecipientBundle(parsed);
}

/** @param {unknown} value */
export function validateRecipientBundle(value) {
  const bundle = exactRecord(
    value,
    ["algorithm", "ephemeral_public_key", "kdf", "keys", "suite", "version"],
    "recipient bundle",
  );
  if (
    bundle.version !== 1 ||
    bundle.suite !== CIFRA_CRYPTO_SUITE ||
    bundle.algorithm !== CIFRA_RECIPIENT_KEK_PROFILE
  ) {
    throw new Error("CIFRA recipient bundle identifiers are invalid");
  }
  const ephemeral = sanitizeEncryptionPublicJwk(bundle.ephemeral_public_key);
  const kdf = exactRecord(bundle.kdf, ["algorithm", "salt"], "recipient KDF");
  if (kdf.algorithm !== CIFRA_KDF_ALGORITHM || !canonicalBytes(kdf.salt, 32)) {
    throw new Error("CIFRA recipient KDF is invalid");
  }
  if (!Array.isArray(bundle.keys) || bundle.keys.length < 1 || bundle.keys.length > 1000) {
    throw new Error("CIFRA recipient key set is invalid");
  }
  const seen = new Set();
  let previous = null;
  const keys = bundle.keys.map((entry, index) => {
    const key = exactRecord(
      entry,
      ["device_id", "key_epoch", "key_id", "user_id", "wrapped_key"],
      `recipient key ${index}`,
    );
    assertUuid(key.user_id, "recipient user id");
    assertUuid(key.device_id, "recipient device id");
    const keyId = canonicalText(key.key_id, "recipient key id");
    if (keyId.length > 256) {
      throw new Error("CIFRA recipient key id is too long");
    }
    if (!Number.isSafeInteger(key.key_epoch) || key.key_epoch <= 0) {
      throw new Error("CIFRA recipient key epoch is invalid");
    }
    if (!canonicalBytes(key.wrapped_key, 40)) {
      throw new Error("CIFRA wrapped recipient DEK is invalid");
    }
    const duplicate = `${key.device_id}\u0000${keyId}`;
    const sort = `${key.user_id}\u0000${key.device_id}\u0000${keyId}`;
    if (seen.has(duplicate) || (previous !== null && previous >= sort)) {
      throw new Error("CIFRA recipient keys are duplicated or unsorted");
    }
    seen.add(duplicate);
    previous = sort;
    return {
      user_id: key.user_id,
      device_id: key.device_id,
      key_id: keyId,
      key_epoch: key.key_epoch,
      wrapped_key: key.wrapped_key,
    };
  });
  return {
    version: 1,
    suite: CIFRA_CRYPTO_SUITE,
    algorithm: CIFRA_RECIPIENT_KEK_PROFILE,
    ephemeral_public_key: ephemeral,
    kdf: { algorithm: CIFRA_KDF_ALGORITHM, salt: kdf.salt },
    keys,
  };
}

/** @param {{envelope:any,topicId:string,senderUserId:string,senderDeviceId:string}} input */
export async function messageSignatureInput(input) {
  const envelope = parseMessageEnvelope(input.envelope);
  assertUuid(input.senderUserId, "sender user id");
  assertUuid(input.senderDeviceId, "sender device id");
  const contentDigest = envelope.media.length === 0
    ? {
        ciphertext_sha256: bytesToBase64Url(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              base64UrlToBytes(envelope.crypto.ciphertext),
            ),
          ),
        ),
      }
    : {
        manifests: envelope.media.map((media) => ({
          id: media.id,
          manifest_sha256: media.manifest_sha256,
          manifest_version: media.manifest_version,
        })),
      };
  return {
    authentication_tag: envelope.crypto.authentication_tag,
    client_msg_id: envelope.client_msg_id,
    compliance_dek: envelope.crypto.compliance_dek,
    compliance_key_id: envelope.crypto.compliance_key_id,
    content_algorithm: envelope.crypto.content_algorithm,
    content_digest: contentDigest,
    content_type: envelope.kind,
    key_epoch: envelope.crypto.key_epoch,
    nonce: envelope.crypto.nonce,
    profile: envelope.crypto.profile,
    protocol: "cifra.message-signature/1",
    recipient_bundle: parseRecipientBundle(envelope.crypto.recipient_dek),
    schema: envelope.schema,
    sender_device_id: input.senderDeviceId,
    sender_user_id: input.senderUserId,
    suite: envelope.crypto.suite,
    topic_id: canonicalText(input.topicId, "topic id"),
    version: envelope.crypto.version,
  };
}

/** @param {unknown} value */
export function parseMessageEnvelope(value) {
  const envelope = exactRecord(value, ["client_msg_id", "crypto", "kind", "media", "schema"], "message envelope");
  if (envelope.schema !== "cifra.message/1") throw new Error("CIFRA envelope schema is invalid");
  assertUuid(envelope.client_msg_id, "client message id");
  if (
    typeof envelope.kind !== "string" ||
    !["text", "image", "video", "video_note", "document", "voice", "system"].includes(envelope.kind)
  ) {
    throw new Error("CIFRA envelope kind is invalid");
  }
  const crypt = exactRecord(
    envelope.crypto,
    [
      "authentication_tag", "ciphertext", "compliance_dek",
      "compliance_key_id", "content_algorithm", "key_epoch", "nonce",
      "profile", "recipient_dek", "signature", "suite", "version",
    ],
    "message crypto",
  );
  if (
    crypt.version !== 1 ||
    crypt.suite !== CIFRA_CRYPTO_SUITE ||
    crypt.profile !== CIFRA_RECIPIENT_KEK_PROFILE ||
    crypt.content_algorithm !== CIFRA_CONTENT_ALGORITHM ||
    !Number.isSafeInteger(crypt.key_epoch) ||
    crypt.key_epoch <= 0 ||
    !canonicalBytes(crypt.nonce, 12) ||
    !canonicalBytes(crypt.authentication_tag, 16) ||
    !canonicalBytes(crypt.signature, 64) ||
    typeof crypt.compliance_dek !== "string" ||
    crypt.compliance_dek.length < 342 ||
    crypt.compliance_dek.length > 1_366 ||
    !canonicalBytesInRange(crypt.compliance_dek, 256, 1024) ||
    typeof crypt.compliance_key_id !== "string" ||
    crypt.compliance_key_id.length < 1 ||
    crypt.compliance_key_id.length > 256 ||
    typeof crypt.ciphertext !== "string" ||
    crypt.ciphertext.length < 1 ||
    crypt.ciphertext.length > 2_000_000 ||
    !canonicalBytes(crypt.ciphertext, null)
  ) {
    throw new Error("CIFRA message crypto fields are invalid");
  }
  parseRecipientBundle(crypt.recipient_dek);
  if (!Array.isArray(envelope.media) || envelope.media.length > 10) {
    throw new Error("CIFRA message media list is invalid");
  }
  const media = envelope.media.map((entry, index) => {
    const item = exactRecord(entry, ["id", "manifest_sha256", "manifest_version"], `media reference ${index}`);
    assertUuid(item.id, "media id");
    if (!Number.isSafeInteger(item.manifest_version) || item.manifest_version <= 0 || !canonicalBytes(item.manifest_sha256, 32)) {
      throw new Error("CIFRA media reference is invalid");
    }
    return { id: item.id, manifest_version: item.manifest_version, manifest_sha256: item.manifest_sha256 };
  });
  if ((MEDIA_KINDS.has(envelope.kind) && media.length === 0) || (!MEDIA_KINDS.has(envelope.kind) && media.length > 0)) {
    throw new Error("CIFRA envelope media/kind invariant failed");
  }
  return {
    schema: "cifra.message/1",
    client_msg_id: envelope.client_msg_id,
    kind: envelope.kind,
    crypto: {
      version: 1,
      suite: CIFRA_CRYPTO_SUITE,
      profile: CIFRA_RECIPIENT_KEK_PROFILE,
      key_epoch: crypt.key_epoch,
      content_algorithm: CIFRA_CONTENT_ALGORITHM,
      nonce: crypt.nonce,
      ciphertext: crypt.ciphertext,
      authentication_tag: crypt.authentication_tag,
      recipient_dek: crypt.recipient_dek,
      compliance_key_id: crypt.compliance_key_id,
      compliance_dek: crypt.compliance_dek,
      signature: crypt.signature,
    },
    media,
  };
}

/** @param {unknown} value */
export function parseMediaPayload(value) {
  const payload = exactRecord(
    value,
    ["caption", "duration_ms", "file_name", "media_cipher", "media_dek", "media_nonce", "mime_type", "size_bytes", "version", "waveform"],
    "media payload",
  );
  if (
    payload.version !== 1 ||
    typeof payload.caption !== "string" || payload.caption.length > 4096 ||
    typeof payload.file_name !== "string" || payload.file_name.length < 1 || payload.file_name.length > 512 ||
    typeof payload.mime_type !== "string" || payload.mime_type.length < 3 || payload.mime_type.length > 200 ||
    !Number.isSafeInteger(payload.size_bytes) || payload.size_bytes <= 0 ||
    (payload.duration_ms !== null && (!Number.isSafeInteger(payload.duration_ms) || payload.duration_ms <= 0)) ||
    !validWaveform(payload.waveform) ||
    !canonicalBytes(payload.media_dek, 32) ||
    !canonicalBytes(payload.media_nonce, 8) ||
    payload.media_cipher !== "AES-256-GCM-CHUNKED-V1"
  ) {
    throw new Error("CIFRA encrypted media payload is invalid");
  }
  return {
    version: 1,
    caption: payload.caption,
    file_name: payload.file_name,
    mime_type: payload.mime_type,
    size_bytes: payload.size_bytes,
    duration_ms: payload.duration_ms,
    waveform: payload.waveform === null ? null : [...payload.waveform],
    media_dek: payload.media_dek,
    media_nonce: payload.media_nonce,
    media_cipher: "AES-256-GCM-CHUNKED-V1",
  };
}

/** @param {unknown} value @param {CryptoKey} privateKey */
export async function signCanonical(value, privateKey) {
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      UTF8.encode(canonicalJson(value)),
    ),
  );
  if (signature.byteLength !== 64) {
    throw new Error("Web Crypto did not return IEEE-P1363 ES256");
  }
  return signature;
}

/** @param {unknown} value @param {JsonWebKey} publicJwk @param {Uint8Array} signature */
export async function verifyCanonical(value, publicJwk, signature) {
  if (signature.byteLength !== 64) return false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      publicJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signature,
      UTF8.encode(canonicalJson(value)),
    );
  } catch {
    return false;
  }
}

/** @param {Uint8Array} value */
export async function sha256Base64Url(value) {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", value)));
}

/** @param {Uint8Array} value */
export async function sha256Hex(value) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", value)));
}

/** @param {{mediaId:string,manifestVersion:number,chunks:Array<{index:number,sizeBytes:number,checksumSha256:string}>}} input */
export async function mediaManifestSha256(input) {
  assertUuid(input.mediaId, "media id");
  if (!Number.isSafeInteger(input.manifestVersion) || input.manifestVersion <= 0 || input.chunks.length === 0) {
    throw new Error("CIFRA media manifest is invalid");
  }
  const chunks = input.chunks.map((chunk, index) => {
    if (chunk.index !== index || !Number.isSafeInteger(chunk.sizeBytes) || chunk.sizeBytes <= 16 || !/^[0-9a-f]{64}$/.test(chunk.checksumSha256)) {
      throw new Error("CIFRA media manifest chunks are invalid");
    }
    return { checksum_sha256: chunk.checksumSha256, index, size_bytes: chunk.sizeBytes };
  });
  return sha256Base64Url(UTF8.encode(canonicalJson({
    chunks,
    cipher: "AES-256-GCM-CHUNKED-V1",
    manifest_version: input.manifestVersion,
    media_id: input.mediaId,
    version: 1,
  })));
}

/** @param {Uint8Array} rawDek @param {JsonWebKey} publicJwk */
export async function wrapComplianceDek(rawDek, publicJwk) {
  if (rawDek.byteLength !== 32 || publicJwk.kty !== "RSA") {
    throw new Error("CIFRA compliance key input is invalid");
  }
  if (Array.isArray(publicJwk.key_ops) && publicJwk.key_ops.includes("wrapKey")) {
    const [contentKey, wrappingKey] = await Promise.all([
      crypto.subtle.importKey(
        "raw",
        rawDek,
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
      await crypto.subtle.wrapKey("raw", contentKey, wrappingKey, "RSA-OAEP"),
    );
  }
  const encryptionKey = await crypto.subtle.importKey(
    "jwk",
    publicJwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  return new Uint8Array(
    await crypto.subtle.encrypt("RSA-OAEP", encryptionKey, rawDek),
  );
}

/** @param {string} value @param {number|null} bytes */
function canonicalBytes(value, bytes) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    const decoded = base64UrlToBytes(value);
    return (
      bytesToBase64Url(decoded) === value &&
      (bytes === null || decoded.byteLength === bytes)
    );
  } catch {
    return false;
  }
}

function canonicalBytesInRange(value, minimum, maximum) {
  if (!canonicalBytes(value, null)) return false;
  const length = base64UrlToBytes(value).byteLength;
  return length >= minimum && length <= maximum;
}

function validWaveform(value) {
  return value === null || (
    Array.isArray(value) &&
    value.length >= 64 &&
    value.length <= 128 &&
    value.every((sample) =>
      typeof sample === "number" &&
      Number.isFinite(sample) &&
      sample >= 0 &&
      sample <= 1
    )
  );
}

/** @param {string} value @param {number|null} bytes @param {string} label */
function decodeCanonicalBytes(value, bytes, label) {
  if (!canonicalBytes(value, bytes)) throw new Error(`CIFRA ${label} is invalid`);
  return base64UrlToBytes(value);
}

/** @param {unknown} value @param {string[]} keys @param {string} label */
function exactRecord(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`CIFRA ${label} must be an object`);
  }
  const object = /** @type {Record<string, any>} */ (value);
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`CIFRA ${label} contains missing or unknown fields`);
  }
  return object;
}

/** @param {string} value @param {string} label */
function assertUuid(value, label) {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new Error(`CIFRA ${label} must be a lowercase canonical UUID`);
  }
}

/** @param {string} value @param {string} label */
function canonicalText(value, label) {
  if (typeof value !== "string") throw new Error(`CIFRA ${label} must be text`);
  const normalized = value.trim().normalize("NFC");
  if (!normalized || normalized !== value) throw new Error(`CIFRA ${label} is not canonical text`);
  return normalized;
}

/** @param {string} value */
function lpUtf8(value) {
  return lpBytes(UTF8.encode(value));
}

/** @param {Uint8Array} value */
function lpBytes(value) {
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, value.byteLength, false);
  return concatBytes(length, value);
}

/** @param {...Uint8Array} values */
function concatBytes(...values) {
  const output = new Uint8Array(values.reduce((total, value) => total + value.byteLength, 0));
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.byteLength;
  }
  return output;
}

function assertCrypto() {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto API is required");
}
