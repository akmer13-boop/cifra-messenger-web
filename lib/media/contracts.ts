export type MediaKind =
  | "image"
  | "video"
  | "video_note"
  | "document"
  | "preview"
  | "voice";

export type MediaStatus =
  | "created"
  | "uploading"
  | "uploaded"
  | "scanning"
  | "processing"
  | "ready"
  | "rejected"
  | "failed"
  | "expired";

export interface VoiceCapabilities {
  enabled: boolean;
  maxBytes: number;
  maxDurationSeconds: number;
  preferredMimeTypes: string[];
}

export interface MediaCapabilities {
  enabled: boolean;
  maxFileBytes: number;
  chunkMaxBytes: number;
  maxPlaintextPartBytes: number;
  maxParts: number;
  mediaCipher: "AES-256-GCM-CHUNKED-V1";
  nonceDerivation: "PREFIX8+PART_UINT32_BE";
  allowedMimeTypes: string[];
  voice: VoiceCapabilities;
}

export interface CapabilitiesResponse {
  apiVersion: "v1";
  messageSchema: "cifra.message/1";
  cryptoSuites: string[];
  media: MediaCapabilities;
}

export interface DeviceCryptoKeysRequest {
  version: 1;
  encryption: {
    algorithm: "ECDH-P256+A256KW";
    key_id: string;
    public_jwk: JsonWebKey;
  };
  signature: {
    algorithm: "ECDSA-P256-SHA256";
    key_id: string;
    public_jwk: JsonWebKey;
  };
}

export interface DeviceCryptoKeysResponse {
  version: 1;
  deviceId: string;
  keyVersion: number;
  encryptionKeyId: string;
  signatureKeyId: string;
}

export interface TopicCryptoContext {
  suite: "CIFRA_CRYPTO_V1";
  topicId: string;
  keyEpoch: number;
  expiresAt: string;
  senderDeviceId: string;
  recipientKeys: Array<{
    userId: string;
    deviceId: string;
    keyId: string;
    algorithm: "ECDH-P256+A256KW";
    publicJwk: JsonWebKey;
  }>;
  complianceKey: {
    keyId: string;
    algorithm: "RSA-OAEP-256";
    publicJwk: JsonWebKey;
  };
}

export interface MediaView {
  id: string;
  topicId: string;
  ownerId: string;
  kind: MediaKind;
  status: MediaStatus;
  declaredMimeType: string;
  normalizedMimeType: string;
  detectedMimeType: string | null;
  plaintextSize: number;
  ciphertextSize: number | null;
  manifestVersion: number;
  durationMs: number | null;
  waveform: number[] | null;
  rejectionCode: string | null;
  createdAt: string;
  readyAt: string | null;
}

export interface MediaCreateUploadInput {
  topic_id: string;
  kind: MediaKind;
  mime_type: string;
  plaintext_size: number;
  ciphertext_size: number;
  checksum_sha256: string;
  expected_parts: number;
  compliance_key_id: string;
  wrapped_media_dek: string;
  media_cipher: "AES-256-GCM-CHUNKED-V1";
  media_nonce: string;
}

export interface MediaCreateUploadResponse {
  media: MediaView;
  upload: {
    id: string;
    expectedParts: number;
    expiresAt: string;
    chunkMaxBytes: number;
    maxPlaintextPartBytes: number;
    mediaCipher: "AES-256-GCM-CHUNKED-V1";
    nonceDerivation: "PREFIX8+PART_UINT32_BE";
    manifestVersion: number;
  };
}

export interface MediaUploadPartResponse {
  uploaded: true;
  partNumber: number;
  sizeBytes: number;
  checksumSha256: string;
}

export function parseCapabilitiesResponse(value: unknown): CapabilitiesResponse {
  const root = record(value, "capabilities");
  const apiVersion = literal(root.api_version, "v1", "capabilities.api_version");
  const messageSchema = literal(
    root.message_schema,
    "cifra.message/1",
    "capabilities.message_schema",
  );
  const cryptoSuites = stringArray(
    root.crypto_suites,
    "capabilities.crypto_suites",
  );
  const media = record(root.media, "capabilities.media");
  const voice = record(media.voice, "capabilities.media.voice");
  return {
    apiVersion,
    messageSchema,
    cryptoSuites,
    media: {
      enabled: boolean(media.enabled, "capabilities.media.enabled"),
      maxFileBytes: positiveInteger(
        media.max_file_bytes,
        "capabilities.media.max_file_bytes",
      ),
      chunkMaxBytes: positiveInteger(
        media.chunk_max_bytes,
        "capabilities.media.chunk_max_bytes",
      ),
      maxPlaintextPartBytes: positiveInteger(
        media.max_plaintext_part_bytes,
        "capabilities.media.max_plaintext_part_bytes",
      ),
      maxParts: positiveInteger(
        media.max_parts,
        "capabilities.media.max_parts",
      ),
      mediaCipher: literal(
        media.media_cipher,
        "AES-256-GCM-CHUNKED-V1",
        "capabilities.media.media_cipher",
      ),
      nonceDerivation: literal(
        media.nonce_derivation,
        "PREFIX8+PART_UINT32_BE",
        "capabilities.media.nonce_derivation",
      ),
      allowedMimeTypes: stringArray(
        media.allowed_mime_types,
        "capabilities.media.allowed_mime_types",
      ),
      voice: {
        enabled: boolean(voice.enabled, "capabilities.media.voice.enabled"),
        maxBytes: positiveInteger(
          voice.max_bytes,
          "capabilities.media.voice.max_bytes",
        ),
        maxDurationSeconds: positiveInteger(
          voice.max_duration_seconds,
          "capabilities.media.voice.max_duration_seconds",
        ),
        preferredMimeTypes: stringArray(
          voice.preferred_mime_types,
          "capabilities.media.voice.preferred_mime_types",
        ),
      },
    },
  };
}

export function parseDeviceCryptoKeysResponse(
  value: unknown,
): DeviceCryptoKeysResponse {
  const root = record(value, "device crypto keys");
  const encryption = record(root.encryption, "device crypto keys.encryption");
  const signature = record(root.signature, "device crypto keys.signature");
  return {
    version: literal(root.version, 1, "device crypto keys.version"),
    deviceId: nonEmptyString(root.device_id, "device crypto keys.device_id"),
    keyVersion: positiveInteger(
      root.key_version,
      "device crypto keys.key_version",
    ),
    encryptionKeyId: nonEmptyString(
      encryption.key_id,
      "device crypto keys.encryption.key_id",
    ),
    signatureKeyId: nonEmptyString(
      signature.key_id,
      "device crypto keys.signature.key_id",
    ),
  };
}

export function parseTopicCryptoContext(value: unknown): TopicCryptoContext {
  const root = record(value, "topic crypto context");
  const compliance = record(
    root.compliance_key,
    "topic crypto context.compliance_key",
  );
  if (!Array.isArray(root.recipient_keys)) {
    invalid("topic crypto context.recipient_keys");
  }
  return {
    suite: literal(root.suite, "CIFRA_CRYPTO_V1", "topic crypto context.suite"),
    topicId: nonEmptyString(root.topic_id, "topic crypto context.topic_id"),
    keyEpoch: positiveInteger(root.key_epoch, "topic crypto context.key_epoch"),
    expiresAt: nonEmptyString(
      root.expires_at,
      "topic crypto context.expires_at",
    ),
    senderDeviceId: nonEmptyString(
      root.sender_device_id,
      "topic crypto context.sender_device_id",
    ),
    recipientKeys: root.recipient_keys.map((entry, index) => {
      const key = record(entry, `topic crypto context.recipient_keys[${index}]`);
      return {
        userId: nonEmptyString(key.user_id, "recipient key.user_id"),
        deviceId: nonEmptyString(key.device_id, "recipient key.device_id"),
        keyId: nonEmptyString(key.key_id, "recipient key.key_id"),
        algorithm: literal(
          key.algorithm,
          "ECDH-P256+A256KW",
          "recipient key.algorithm",
        ),
        publicJwk: jwk(key.public_jwk, "recipient key.public_jwk"),
      };
    }),
    complianceKey: {
      keyId: nonEmptyString(
        compliance.key_id,
        "topic crypto context.compliance_key.key_id",
      ),
      algorithm: literal(
        compliance.algorithm,
        "RSA-OAEP-256",
        "topic crypto context.compliance_key.algorithm",
      ),
      publicJwk: jwk(
        compliance.public_jwk,
        "topic crypto context.compliance_key.public_jwk",
      ),
    },
  };
}

export function parseMediaCreateUploadResponse(
  value: unknown,
): MediaCreateUploadResponse {
  const root = record(value, "media upload");
  const upload = record(root.upload, "media upload.upload");
  return {
    media: parseMediaView(root.media),
    upload: {
      id: nonEmptyString(upload.id, "media upload.upload.id"),
      expectedParts: positiveInteger(
        upload.expected_parts,
        "media upload.upload.expected_parts",
      ),
      expiresAt: nonEmptyString(
        upload.expires_at,
        "media upload.upload.expires_at",
      ),
      chunkMaxBytes: positiveInteger(
        upload.chunk_max_bytes,
        "media upload.upload.chunk_max_bytes",
      ),
      maxPlaintextPartBytes: positiveInteger(
        upload.max_plaintext_part_bytes,
        "media upload.upload.max_plaintext_part_bytes",
      ),
      mediaCipher: literal(
        upload.media_cipher,
        "AES-256-GCM-CHUNKED-V1",
        "media upload.upload.media_cipher",
      ),
      nonceDerivation: literal(
        upload.nonce_derivation,
        "PREFIX8+PART_UINT32_BE",
        "media upload.upload.nonce_derivation",
      ),
      manifestVersion: positiveInteger(
        upload.manifest_version,
        "media upload.upload.manifest_version",
      ),
    },
  };
}

export function parseMediaUploadPartResponse(
  value: unknown,
): MediaUploadPartResponse {
  const root = record(value, "media upload part");
  return {
    uploaded: literal(root.uploaded, true, "media upload part.uploaded"),
    partNumber: nonNegativeInteger(
      root.part_number,
      "media upload part.part_number",
    ),
    sizeBytes: positiveInteger(
      root.size_bytes,
      "media upload part.size_bytes",
    ),
    checksumSha256: sha256(
      root.checksum_sha256,
      "media upload part.checksum_sha256",
    ),
  };
}

export function parseMediaView(value: unknown): MediaView {
  const root = record(value, "media");
  const kind = nonEmptyString(root.kind, "media.kind");
  const status = nonEmptyString(root.status, "media.status");
  if (!isMediaKind(kind)) invalid("media.kind");
  if (!isMediaStatus(status)) invalid("media.status");
  return {
    id: nonEmptyString(root.id, "media.id"),
    topicId: nonEmptyString(root.topic_id, "media.topic_id"),
    ownerId: nonEmptyString(root.owner_id, "media.owner_id"),
    kind,
    status,
    declaredMimeType: nonEmptyString(
      root.declared_mime_type,
      "media.declared_mime_type",
    ),
    normalizedMimeType: nonEmptyString(
      root.normalized_mime_type,
      "media.normalized_mime_type",
    ),
    detectedMimeType: nullableString(
      root.detected_mime_type,
      "media.detected_mime_type",
    ),
    plaintextSize: positiveInteger(root.plaintext_size, "media.plaintext_size"),
    ciphertextSize: nullablePositiveInteger(
      root.ciphertext_size,
      "media.ciphertext_size",
    ),
    manifestVersion: positiveInteger(
      root.manifest_version,
      "media.manifest_version",
    ),
    durationMs: nullableNonNegativeInteger(
      root.duration_ms,
      "media.duration_ms",
    ),
    waveform: nullableWaveform(root.waveform, "media.waveform"),
    rejectionCode: nullableString(root.rejection_code, "media.rejection_code"),
    createdAt: nonEmptyString(root.created_at, "media.created_at"),
    readyAt: nullableString(root.ready_at, "media.ready_at"),
  };
}

function isMediaKind(value: string): value is MediaKind {
  return ["image", "video", "video_note", "document", "preview", "voice"].includes(
    value,
  );
}

function isMediaStatus(value: string): value is MediaStatus {
  return [
    "created",
    "uploading",
    "uploaded",
    "scanning",
    "processing",
    "ready",
    "rejected",
    "failed",
    "expired",
  ].includes(value);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(path);
  }
  return value as Record<string, unknown>;
}

function jwk(value: unknown, path: string): JsonWebKey {
  const parsed = record(value, path);
  if (typeof parsed.kty !== "string") invalid(`${path}.kty`);
  return parsed as JsonWebKey;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(path);
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") invalid(path);
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    invalid(path);
  }
  return [...value];
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path);
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) invalid(path);
  return value as number;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(path);
  return value as number;
}

function nullablePositiveInteger(value: unknown, path: string): number | null {
  if (value === null) return null;
  return positiveInteger(value, path);
}

function nullableNonNegativeInteger(
  value: unknown,
  path: string,
): number | null {
  if (value === null) return null;
  return nonNegativeInteger(value, path);
}

function nullableWaveform(value: unknown, path: string): number[] | null {
  if (value === null) return null;
  if (
    !Array.isArray(value) ||
    !value.every(
      (entry) =>
        typeof entry === "number" &&
        Number.isFinite(entry) &&
        entry >= 0 &&
        entry <= 1,
    )
  ) {
    invalid(path);
  }
  return [...value];
}

function sha256(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) invalid(path);
  return value.toLowerCase();
}

function literal<const T extends string | number | boolean>(
  value: unknown,
  expected: T,
  path: string,
): T {
  if (value !== expected) invalid(path);
  return expected;
}

function invalid(path: string): never {
  throw new Error(`Некорректный backend media contract: ${path}`);
}
