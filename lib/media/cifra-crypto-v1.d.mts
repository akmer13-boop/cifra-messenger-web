export const CIFRA_CRYPTO_SUITE: "CIFRA_CRYPTO_V1";
export const CIFRA_RECIPIENT_KEK_PROFILE: "CIFRA-ECDH-P256-HKDF-SHA256-A256KW";
export const CIFRA_KDF_ALGORITHM: "HKDF-SHA-256";
export const CIFRA_CONTENT_ALGORITHM: "A256GCM";

export interface EncryptionPublicJwk extends JsonWebKey {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  use: "enc";
}

export interface RecipientBundle {
  version: 1;
  suite: "CIFRA_CRYPTO_V1";
  algorithm: "CIFRA-ECDH-P256-HKDF-SHA256-A256KW";
  ephemeral_public_key: EncryptionPublicJwk;
  kdf: { algorithm: "HKDF-SHA-256"; salt: string };
  keys: Array<{
    user_id: string;
    device_id: string;
    key_id: string;
    key_epoch: number;
    wrapped_key: string;
  }>;
}

export function sanitizeEncryptionPublicJwk(value: unknown): EncryptionPublicJwk;
export function publicEncryptionJwk(value: JsonWebKey): EncryptionPublicJwk;
export function publicSignatureJwk(value: JsonWebKey): JsonWebKey;
export function ecPublicJwkToUncompressedPoint(
  jwk: { x: string; y: string },
): Uint8Array;
export function serializeRecipientKdfContext(context: {
  senderUserId: string;
  senderDeviceId: string;
  recipientUserId: string;
  recipientDeviceId: string;
  recipientKeyId: string;
  topicId: string;
  clientMsgId: string;
  keyEpoch: number | bigint;
  ephemeralPublicKey: Uint8Array;
}): Uint8Array;
export function deriveRecipientKek(input: {
  privateKey: CryptoKey;
  publicJwk: JsonWebKey;
  salt: Uint8Array;
  info: Uint8Array;
}): Promise<Uint8Array>;
export function wrapDek(kek: Uint8Array, dek: Uint8Array): Promise<Uint8Array>;
export function unwrapDek(
  kek: Uint8Array,
  wrapped: Uint8Array,
): Promise<Uint8Array>;
export function encryptA256Gcm(input: {
  dek: Uint8Array;
  nonce: Uint8Array;
  plaintext: Uint8Array;
  aad?: Uint8Array;
}): Promise<{ ciphertext: Uint8Array; authenticationTag: Uint8Array }>;
export function decryptA256Gcm(input: {
  dek: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  authenticationTag: Uint8Array;
  aad?: Uint8Array;
}): Promise<Uint8Array>;
export function contentAad(input: {
  clientMsgId: string;
  contentType: string;
  topicId: string;
}): Uint8Array;
export function encodeRecipientBundle(value: unknown): string;
export function parseRecipientBundle(value: string): RecipientBundle;
export function validateRecipientBundle(value: unknown): RecipientBundle;
export function parseMessageEnvelope(value: unknown): unknown;
export function parseMediaPayload(value: unknown): unknown;
export function messageSignatureInput(input: {
  envelope: unknown;
  topicId: string;
  senderUserId: string;
  senderDeviceId: string;
}): Promise<unknown>;
export function signCanonical(
  value: unknown,
  privateKey: CryptoKey,
): Promise<Uint8Array>;
export function verifyCanonical(
  value: unknown,
  publicJwk: JsonWebKey,
  signature: Uint8Array,
): Promise<boolean>;
export function sha256Base64Url(value: Uint8Array): Promise<string>;
export function sha256Hex(value: Uint8Array): Promise<string>;
export function mediaManifestSha256(input: {
  mediaId: string;
  manifestVersion: number;
  chunks: Array<{ index: number; sizeBytes: number; checksumSha256: string }>;
}): Promise<string>;
export function wrapComplianceDek(
  rawDek: Uint8Array,
  publicJwk: JsonWebKey,
): Promise<Uint8Array>;
