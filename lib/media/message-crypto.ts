import type {
  CifraMessageEnvelope,
  MediaKind,
  MediaManifest,
  TopicCryptoContext,
} from "./contracts";
import type { StoredDeviceKeys } from "./upload-store";
import {
  CIFRA_CONTENT_ALGORITHM,
  CIFRA_CRYPTO_SUITE,
  CIFRA_KDF_ALGORITHM,
  CIFRA_RECIPIENT_KEK_PROFILE,
  contentAad,
  decryptA256Gcm,
  deriveRecipientKek,
  ecPublicJwkToUncompressedPoint,
  encodeRecipientBundle,
  encryptA256Gcm,
  mediaManifestSha256,
  messageSignatureInput,
  parseMediaPayload,
  parseMessageEnvelope,
  parseRecipientBundle,
  publicEncryptionJwk,
  serializeRecipientKdfContext,
  sha256Hex,
  signCanonical,
  unwrapDek,
  verifyCanonical,
  wrapComplianceDek,
  wrapDek,
} from "./cifra-crypto-v1.mjs";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  canonicalJson,
  deriveMediaPartIv,
  mediaPartAad,
} from "./protocol.mjs";

export interface ReadyMediaInput {
  kind: Exclude<MediaKind, "preview">;
  fileName: string;
  mimeType: string;
  plaintextSize: number;
  durationMs: number | null;
  mediaDek: Uint8Array;
  mediaNonce: string;
  mediaId: string;
  manifestVersion: number;
  manifestSha256: string;
}

export interface PrepareMediaEnvelopeInput {
  topicId: string;
  senderUserId: string;
  senderDeviceId: string;
  deviceKeys: StoredDeviceKeys;
  cryptoContext: TopicCryptoContext;
  media: ReadyMediaInput;
  clientMsgId?: string;
}

export interface DecryptedMediaMetadata {
  envelope: CifraMessageEnvelope;
  topicId: string;
  payload: {
    version: 1;
    caption: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    duration_ms: number | null;
    waveform: number[] | null;
    media_nonce: string;
    media_cipher: "AES-256-GCM-CHUNKED-V1";
  };
  /** Non-extractable media content key; raw DEK bytes are never returned. */
  mediaKey: CryptoKey;
  senderUserId: string;
  senderDeviceId: string;
  signatureStatus: "verified" | "gateway-verified-only";
}

export interface MediaDownloadApi {
  getMediaManifest(mediaId: string): Promise<MediaManifest>;
  downloadMediaContent(
    mediaId: string,
    options?: { range?: string; controlledPlayback?: boolean },
  ): Promise<{
    body: ArrayBuffer;
    status: 200 | 206;
    contentRange: string | null;
    contentLength: number;
    etag: string | null;
  }>;
}

export async function prepareMediaEnvelope(
  input: PrepareMediaEnvelopeInput,
): Promise<CifraMessageEnvelope> {
  assertWebCrypto();
  validateSenderInput(input);
  const clientMsgId = input.clientMsgId ?? crypto.randomUUID();
  const messageDek = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const mediaPayload = parseMediaPayload({
      version: 1,
      caption: "",
      file_name: input.media.fileName,
      mime_type: input.media.mimeType,
      size_bytes: input.media.plaintextSize,
      duration_ms: input.media.durationMs,
      waveform: null,
      media_dek: bytesToBase64Url(input.media.mediaDek),
      media_nonce: input.media.mediaNonce,
      media_cipher: "AES-256-GCM-CHUNKED-V1",
  });
  const plaintext = new TextEncoder().encode(canonicalJson(mediaPayload));
  try {
    const ephemeral = (await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    )) as CryptoKeyPair;
    const ephemeralPublic = publicEncryptionJwk(
      await crypto.subtle.exportKey("jwk", ephemeral.publicKey),
    );
    const ephemeralPoint = ecPublicJwkToUncompressedPoint(ephemeralPublic);
    const recipientKeys = [...input.cryptoContext.recipientKeys]
      .sort((left, right) =>
        `${left.userId}\u0000${left.deviceId}\u0000${left.keyId}` <
        `${right.userId}\u0000${right.deviceId}\u0000${right.keyId}`
          ? -1
          : 1,
      );
    const wrappedKeys = [];
    for (const recipient of recipientKeys) {
      const info = serializeRecipientKdfContext({
        senderUserId: input.senderUserId,
        senderDeviceId: input.senderDeviceId,
        recipientUserId: recipient.userId,
        recipientDeviceId: recipient.deviceId,
        recipientKeyId: recipient.keyId,
        topicId: input.topicId,
        clientMsgId,
        keyEpoch: recipient.keyEpoch,
        ephemeralPublicKey: ephemeralPoint,
      });
      const kek = await deriveRecipientKek({
        privateKey: ephemeral.privateKey,
        publicJwk: recipient.publicJwk,
        salt,
        info,
      });
      try {
        wrappedKeys.push({
          user_id: recipient.userId,
          device_id: recipient.deviceId,
          key_id: recipient.keyId,
          key_epoch: recipient.keyEpoch,
          wrapped_key: bytesToBase64Url(await wrapDek(kek, messageDek)),
        });
      } finally {
        kek.fill(0);
      }
    }
    const recipientDek = encodeRecipientBundle({
      version: 1,
      suite: CIFRA_CRYPTO_SUITE,
      algorithm: CIFRA_RECIPIENT_KEK_PROFILE,
      ephemeral_public_key: ephemeralPublic,
      kdf: { algorithm: CIFRA_KDF_ALGORITHM, salt: bytesToBase64Url(salt) },
      keys: wrappedKeys,
    });
    const encrypted = await encryptA256Gcm({
      dek: messageDek,
      nonce,
      plaintext,
      aad: contentAad({
        clientMsgId,
        contentType: input.media.kind,
        topicId: input.topicId,
      }),
    });
    const complianceDek = await wrapComplianceDek(
      messageDek,
      input.cryptoContext.complianceKey.publicJwk,
    );
    const unsigned: CifraMessageEnvelope = {
      schema: "cifra.message/1",
      client_msg_id: clientMsgId,
      kind: input.media.kind,
      crypto: {
        version: 1,
        suite: CIFRA_CRYPTO_SUITE,
        profile: CIFRA_RECIPIENT_KEK_PROFILE,
        key_epoch: input.cryptoContext.keyEpoch,
        content_algorithm: CIFRA_CONTENT_ALGORITHM,
        nonce: bytesToBase64Url(nonce),
        ciphertext: bytesToBase64Url(encrypted.ciphertext),
        authentication_tag: bytesToBase64Url(encrypted.authenticationTag),
        recipient_dek: recipientDek,
        compliance_key_id: input.cryptoContext.complianceKey.keyId,
        compliance_dek: bytesToBase64Url(complianceDek),
        signature: bytesToBase64Url(new Uint8Array(64)),
      },
      media: [
        {
          id: input.media.mediaId,
          manifest_version: input.media.manifestVersion,
          manifest_sha256: input.media.manifestSha256,
        },
      ],
    };
    const signatureInput = await messageSignatureInput({
      envelope: unsigned,
      topicId: input.topicId,
      senderUserId: input.senderUserId,
      senderDeviceId: input.senderDeviceId,
    });
    const envelope: CifraMessageEnvelope = {
      ...unsigned,
      crypto: {
        ...unsigned.crypto,
        signature: bytesToBase64Url(
          await signCanonical(signatureInput, input.deviceKeys.signaturePrivateKey),
        ),
      },
    };
    return parseMessageEnvelope(envelope) as CifraMessageEnvelope;
  } finally {
    messageDek.fill(0);
    plaintext.fill(0);
  }
}

export async function decryptMediaEnvelopeMetadata(input: {
  envelope: unknown;
  topicId: string;
  recipientUserId: string;
  recipientDeviceId: string;
  recipientKeyId: string;
  recipientPrivateKey: CryptoKey;
  senderSignaturePublicJwk?: JsonWebKey;
}): Promise<DecryptedMediaMetadata> {
  const envelope = parseMessageEnvelope(input.envelope) as CifraMessageEnvelope;
  const bundle = parseRecipientBundle(envelope.crypto.recipient_dek);
  const recipient = bundle.keys.find(
    (key: {
      user_id: string;
      device_id: string;
      key_id: string;
      key_epoch: number;
      wrapped_key: string;
    }) =>
      key.user_id === input.recipientUserId &&
      key.device_id === input.recipientDeviceId &&
      key.key_id === input.recipientKeyId,
  );
  if (!recipient || recipient.key_epoch !== envelope.crypto.key_epoch) {
    throw new Error("Сообщение не содержит DEK для текущего устройства");
  }
  const salt = base64UrlToBytes(bundle.kdf.salt);
  const ephemeralPoint = ecPublicJwkToUncompressedPoint(
    bundle.ephemeral_public_key,
  );
  const candidates = uniqueSenderCandidates(bundle.keys);
  for (const candidate of candidates) {
    const info = serializeRecipientKdfContext({
      senderUserId: candidate.userId,
      senderDeviceId: candidate.deviceId,
      recipientUserId: input.recipientUserId,
      recipientDeviceId: input.recipientDeviceId,
      recipientKeyId: input.recipientKeyId,
      topicId: input.topicId,
      clientMsgId: envelope.client_msg_id,
      keyEpoch: envelope.crypto.key_epoch,
      ephemeralPublicKey: ephemeralPoint,
    });
    const kek = await deriveRecipientKek({
      privateKey: input.recipientPrivateKey,
      publicJwk: bundle.ephemeral_public_key,
      salt,
      info,
    });
    let messageDek: Uint8Array | null = null;
    try {
      try {
        messageDek = await unwrapDek(
          kek,
          base64UrlToBytes(recipient.wrapped_key),
        );
      } catch {
        continue;
      }
      let plaintext: Uint8Array;
      try {
        plaintext = await decryptA256Gcm({
          dek: messageDek,
          nonce: base64UrlToBytes(envelope.crypto.nonce),
          ciphertext: base64UrlToBytes(envelope.crypto.ciphertext),
          authenticationTag: base64UrlToBytes(
            envelope.crypto.authentication_tag,
          ),
          aad: contentAad({
            clientMsgId: envelope.client_msg_id,
            contentType: envelope.kind,
            topicId: input.topicId,
          }),
        });
      } catch {
        continue;
      }
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
        const parsed = JSON.parse(text) as unknown;
        if (canonicalJson(parsed) !== text) {
          throw new Error("Media payload is not canonical JSON");
        }
        const payloadWithDek = parseMediaPayload(parsed) as
          DecryptedMediaMetadata["payload"] & { media_dek: string };
        const rawMediaDek = base64UrlToBytes(payloadWithDek.media_dek);
        let mediaKey: CryptoKey;
        try {
          mediaKey = await crypto.subtle.importKey(
            "raw",
            exactArrayBuffer(rawMediaDek),
            { name: "AES-GCM", length: 256 },
            false,
            ["decrypt"],
          );
        } finally {
          rawMediaDek.fill(0);
        }
        const payload: DecryptedMediaMetadata["payload"] = {
          version: payloadWithDek.version,
          caption: payloadWithDek.caption,
          file_name: payloadWithDek.file_name,
          mime_type: payloadWithDek.mime_type,
          size_bytes: payloadWithDek.size_bytes,
          duration_ms: payloadWithDek.duration_ms,
          waveform: payloadWithDek.waveform,
          media_nonce: payloadWithDek.media_nonce,
          media_cipher: payloadWithDek.media_cipher,
        };
        const signatureInput = await messageSignatureInput({
          envelope,
          topicId: input.topicId,
          senderUserId: candidate.userId,
          senderDeviceId: candidate.deviceId,
        });
        if (
          input.senderSignaturePublicJwk &&
          !(await verifyCanonical(
            signatureInput,
            input.senderSignaturePublicJwk,
            base64UrlToBytes(envelope.crypto.signature),
          ))
        ) {
          throw new Error("Подпись отправителя недействительна");
        }
        return {
          envelope,
          topicId: input.topicId,
          payload,
          mediaKey,
          senderUserId: candidate.userId,
          senderDeviceId: candidate.deviceId,
          signatureStatus: input.senderSignaturePublicJwk
            ? "verified"
            : "gateway-verified-only",
        };
      } finally {
        plaintext.fill(0);
      }
    } finally {
      kek.fill(0);
      messageDek?.fill(0);
    }
  }
  throw new Error("Не удалось аутентифицированно раскрыть DEK сообщения");
}

export async function downloadAndDecryptMedia(input: {
  api: MediaDownloadApi;
  metadata: DecryptedMediaMetadata;
  mode?: "range" | "full";
}): Promise<{ blob: Blob; fileName: string; mimeType: string; durationMs: number | null }> {
  const reference = input.metadata.envelope.media[0];
  if (!reference || input.metadata.envelope.media.length !== 1) {
    throw new Error("Web Stage 3 поддерживает ровно одно media на сообщение");
  }
  const manifest = await input.api.getMediaManifest(reference.id);
  validateManifestAgainstEnvelope(
    manifest,
    reference,
    input.metadata.payload,
    input.metadata.envelope.kind,
    input.metadata.topicId,
  );
  const digest = await mediaManifestSha256({
    mediaId: reference.id,
    manifestVersion: reference.manifest_version,
    chunks: manifest.chunks.map((chunk) => ({
      index: chunk.index,
      sizeBytes: chunk.sizeBytes,
      checksumSha256: chunk.checksumSha256,
    })),
  });
  if (digest !== reference.manifest_sha256) {
    throw new Error("SHA-256 media manifest не совпадает с envelope");
  }
  const trustedMimeType = trustedMediaMimeType(manifest, input.metadata.envelope.kind);

  const noncePrefix = base64UrlToBytes(input.metadata.payload.media_nonce);
  const plaintextParts: Uint8Array[] = [];
  try {
    const ciphertextParts = input.mode === "full"
      ? await downloadFull(input.api, reference.id, manifest, input.metadata.envelope.kind)
      : await downloadRanges(input.api, reference.id, manifest, input.metadata.envelope.kind);
    for (let index = 0; index < ciphertextParts.length; index += 1) {
      const ciphertext = ciphertextParts[index];
      const expected = manifest.chunks[index];
      if (!expected || (await sha256Hex(ciphertext)) !== expected.checksumSha256) {
        throw new Error(`SHA-256 ciphertext part ${index} не совпадает`);
      }
      try {
        plaintextParts.push(
          new Uint8Array(
            await crypto.subtle.decrypt(
              {
                name: "AES-GCM",
                iv: exactArrayBuffer(deriveMediaPartIv(noncePrefix, index)),
                additionalData: exactArrayBuffer(
                  mediaPartAad(reference.id, index),
                ),
                tagLength: 128,
              },
              input.metadata.mediaKey,
              exactArrayBuffer(ciphertext),
            ),
          ),
        );
      } catch {
        throw new Error(`GCM authentication media part ${index} failed`);
      }
    }
    const total = plaintextParts.reduce((size, part) => size + part.byteLength, 0);
    if (total !== input.metadata.payload.size_bytes) {
      throw new Error("Расшифрованный размер media не совпадает с payload");
    }
    return {
      blob: new Blob(plaintextParts.map(exactArrayBuffer), {
        type: trustedMimeType,
      }),
      fileName: input.metadata.payload.file_name,
      mimeType: trustedMimeType,
      durationMs: input.metadata.payload.duration_ms,
    };
  } finally {
    plaintextParts.forEach((part) => part.fill(0));
  }
}

function validateSenderInput(input: PrepareMediaEnvelopeInput): void {
  if (
    input.cryptoContext.suite !== CIFRA_CRYPTO_SUITE ||
    input.cryptoContext.profile !== CIFRA_RECIPIENT_KEK_PROFILE ||
    input.cryptoContext.topicId !== input.topicId ||
    input.cryptoContext.senderDeviceId !== input.senderDeviceId ||
    input.deviceKeys.userId !== input.senderUserId ||
    input.deviceKeys.deviceId !== input.senderDeviceId ||
    input.media.mediaDek.byteLength !== 32 ||
    base64UrlToBytes(input.media.mediaNonce).byteLength !== 8 ||
    input.cryptoContext.recipientKeys.length === 0 ||
    input.cryptoContext.recipientKeys.some(
      (recipient) =>
        recipient.keyEpoch !== input.cryptoContext.keyEpoch ||
        recipient.algorithm !== CIFRA_RECIPIENT_KEK_PROFILE,
    )
  ) {
    throw new Error("Актуальный CIFRA crypto context не совпадает с отправителем/media");
  }
  if (new Date(input.cryptoContext.expiresAt).getTime() <= Date.now()) {
    throw new Error("CIFRA crypto context истёк; envelope нужно собрать заново");
  }
}

function uniqueSenderCandidates(
  keys: Array<{ user_id: string; device_id: string }>,
): Array<{ userId: string; deviceId: string }> {
  const seen = new Set<string>();
  const candidates: Array<{ userId: string; deviceId: string }> = [];
  for (const key of keys) {
    const id = `${key.user_id}:${key.device_id}`;
    if (!seen.has(id)) {
      seen.add(id);
      candidates.push({ userId: key.user_id, deviceId: key.device_id });
    }
  }
  return candidates;
}

function validateManifestAgainstEnvelope(
  manifest: MediaManifest,
  reference: CifraMessageEnvelope["media"][number],
  payload: DecryptedMediaMetadata["payload"],
  kind: CifraMessageEnvelope["kind"],
  topicId: string,
): void {
  const ciphertextSize = manifest.chunks.reduce(
    (total, chunk) => total + chunk.sizeBytes,
    0,
  );
  if (
    manifest.media.id !== reference.id ||
    manifest.media.topicId !== topicId ||
    manifest.media.kind !== kind ||
    manifest.media.manifestVersion !== reference.manifest_version ||
    manifest.media.status !== "ready" ||
    manifest.media.plaintextSize !== payload.size_bytes ||
    manifest.media.declaredMimeType !== payload.mime_type ||
    manifest.media.ciphertextSize !== ciphertextSize ||
    manifest.chunks.length === 0 ||
    manifest.chunks.some(
      (chunk, index) =>
        chunk.index !== index ||
        chunk.sizeBytes <= 16 ||
        !/^[0-9a-f]{64}$/.test(chunk.checksumSha256),
    )
  ) {
    throw new Error("Backend media manifest не совпадает с signed envelope/payload");
  }
}

function trustedMediaMimeType(
  manifest: MediaManifest,
  kind: CifraMessageEnvelope["kind"],
): string {
  const normalizedBase = baseMimeType(manifest.media.normalizedMimeType);
  const detected = manifest.media.detectedMimeType;
  const detectedBase = detected === null ? null : baseMimeType(detected);
  if (detectedBase !== null && detectedBase !== normalizedBase) {
    throw new Error("Backend detected MIME не совпадает с normalized MIME");
  }
  if (
    (kind === "voice" && !normalizedBase.startsWith("audio/")) ||
    ((kind === "video" || kind === "video_note") &&
      !normalizedBase.startsWith("video/")) ||
    (kind === "image" && !normalizedBase.startsWith("image/"))
  ) {
    throw new Error("Backend media kind/MIME invariant нарушен");
  }
  return detected ?? manifest.media.normalizedMimeType;
}

function baseMimeType(value: string): string {
  const base = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(base)) {
    throw new Error("Backend media MIME некорректен");
  }
  return base;
}

async function downloadRanges(
  api: MediaDownloadApi,
  mediaId: string,
  manifest: MediaManifest,
  kind: CifraMessageEnvelope["kind"],
): Promise<Uint8Array[]> {
  const total = manifest.chunks.reduce((sum, chunk) => sum + chunk.sizeBytes, 0);
  let offset = 0;
  let etag: string | null = null;
  const output: Uint8Array[] = [];
  for (const chunk of manifest.chunks) {
    const start = offset;
    const end = start + chunk.sizeBytes - 1;
    const response = await api.downloadMediaContent(mediaId, {
      range: `bytes=${start}-${end}`,
      controlledPlayback: kind === "voice" || kind === "video" || kind === "video_note",
    });
    if (
      response.status !== 206 ||
      response.contentLength !== chunk.sizeBytes ||
      response.contentRange !== `bytes ${start}-${end}/${total}` ||
      (etag !== null && response.etag !== etag)
    ) {
      throw new Error("Backend вернул некорректный authenticated Range response");
    }
    etag = response.etag;
    output.push(new Uint8Array(response.body));
    offset = end + 1;
  }
  return output;
}

async function downloadFull(
  api: MediaDownloadApi,
  mediaId: string,
  manifest: MediaManifest,
  kind: CifraMessageEnvelope["kind"],
): Promise<Uint8Array[]> {
  const response = await api.downloadMediaContent(mediaId, {
    controlledPlayback: kind === "voice" || kind === "video" || kind === "video_note",
  });
  const expectedSize = manifest.chunks.reduce((sum, chunk) => sum + chunk.sizeBytes, 0);
  if (
    response.status !== 200 ||
    response.contentRange !== null ||
    response.contentLength !== expectedSize
  ) {
    throw new Error("Backend вернул некорректный full ciphertext response");
  }
  const full = new Uint8Array(response.body);
  const output: Uint8Array[] = [];
  let offset = 0;
  for (const chunk of manifest.chunks) {
    output.push(full.slice(offset, offset + chunk.sizeBytes));
    offset += chunk.sizeBytes;
  }
  return output;
}

function assertWebCrypto(): void {
  if (!globalThis.crypto?.subtle || typeof crypto.randomUUID !== "function") {
    throw new Error("Web Crypto API обязателен для CIFRA_CRYPTO_V1");
  }
}

function exactArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}
