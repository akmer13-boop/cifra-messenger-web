import assert from "node:assert/strict";
import test from "node:test";

import {
  decryptMediaEnvelopeMetadata,
  downloadAndDecryptMedia,
  prepareMediaEnvelope,
} from "../lib/media/message-crypto.ts";
import {
  mediaManifestSha256,
  publicEncryptionJwk,
  publicSignatureJwk,
  sha256Hex,
} from "../lib/media/cifra-crypto-v1.mjs";
import {
  bytesToBase64Url,
  deriveMediaPartIv,
  mediaPartAad,
} from "../lib/media/protocol.mjs";

const SENDER_USER_ID = "11111111-1111-4111-8111-111111111111";
const SENDER_DEVICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECIPIENT_USER_ID = "22222222-2222-4222-8222-222222222222";
const RECIPIENT_DEVICE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MEDIA_ID = "018f22a7-8a7c-7df0-9e38-55f2668f6c30";
const CLIENT_MSG_ID = "33333333-3333-4333-8333-333333333333";
const TOPIC_ID = "grpStage3RoundTrip";

async function fixture() {
  const [senderEncryption, senderSignature, recipientEncryption, compliance] =
    await Promise.all([
      crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        false,
        ["deriveBits"],
      ),
      crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign", "verify"],
      ),
      crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        false,
        ["deriveBits"],
      ),
      crypto.subtle.generateKey(
        {
          name: "RSA-OAEP",
          modulusLength: 2048,
          publicExponent: Uint8Array.of(1, 0, 1),
          hash: "SHA-256",
        },
        true,
        ["encrypt", "decrypt"],
      ),
    ]);
  const [senderEncryptionJwk, senderSignatureJwk, recipientEncryptionJwk, complianceJwk] =
    await Promise.all([
      crypto.subtle.exportKey("jwk", senderEncryption.publicKey),
      crypto.subtle.exportKey("jwk", senderSignature.publicKey),
      crypto.subtle.exportKey("jwk", recipientEncryption.publicKey),
      crypto.subtle.exportKey("jwk", compliance.publicKey),
    ]);
  const senderPublicEncryption = publicEncryptionJwk(senderEncryptionJwk);
  const senderPublicSignature = publicSignatureJwk(senderSignatureJwk);
  const recipientPublicEncryption = publicEncryptionJwk(recipientEncryptionJwk);
  const mediaDek = crypto.getRandomValues(new Uint8Array(32));
  const mediaNonce = crypto.getRandomValues(new Uint8Array(8));
  const original = new TextEncoder().encode(
    "CIFRA Stage 3 authenticated Range voice round-trip: Привет, B!",
  );
  const plaintextParts = [original.slice(0, 19), original.slice(19, 43), original.slice(43)];
  const mediaKey = await crypto.subtle.importKey(
    "raw",
    mediaDek,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const ciphertextParts = [];
  for (let index = 0; index < plaintextParts.length; index += 1) {
    ciphertextParts.push(
      new Uint8Array(
        await crypto.subtle.encrypt(
          {
            name: "AES-GCM",
            iv: deriveMediaPartIv(mediaNonce, index),
            additionalData: mediaPartAad(MEDIA_ID, index),
            tagLength: 128,
          },
          mediaKey,
          plaintextParts[index],
        ),
      ),
    );
  }
  const chunks = await Promise.all(
    ciphertextParts.map(async (part, index) => ({
      index,
      sizeBytes: part.byteLength,
      checksumSha256: await sha256Hex(part),
    })),
  );
  const manifestSha256 = await mediaManifestSha256({
    mediaId: MEDIA_ID,
    manifestVersion: 1,
    chunks,
  });
  const manifest = {
    media: {
      id: MEDIA_ID,
      topicId: TOPIC_ID,
      ownerId: SENDER_USER_ID,
      kind: "voice",
      status: "ready",
      declaredMimeType: "audio/webm",
      normalizedMimeType: "audio/webm",
      detectedMimeType: "audio/webm",
      plaintextSize: original.byteLength,
      ciphertextSize: ciphertextParts.reduce(
        (size, part) => size + part.byteLength,
        0,
      ),
      manifestVersion: 1,
      durationMs: 1_234,
      waveform: null,
      rejectionCode: null,
      createdAt: "2026-08-04T10:00:00.000Z",
      readyAt: "2026-08-04T10:00:01.000Z",
    },
    chunks,
  };
  const envelope = await prepareMediaEnvelope({
    topicId: TOPIC_ID,
    senderUserId: SENDER_USER_ID,
    senderDeviceId: SENDER_DEVICE_ID,
    clientMsgId: CLIENT_MSG_ID,
    deviceKeys: {
      id: `${SENDER_USER_ID}:${SENDER_DEVICE_ID}`,
      userId: SENDER_USER_ID,
      deviceId: SENDER_DEVICE_ID,
      encryptionKeyId: "sender-enc-1",
      encryptionPrivateKey: senderEncryption.privateKey,
      encryptionPublicJwk: senderPublicEncryption,
      signatureKeyId: "sender-sig-1",
      signaturePrivateKey: senderSignature.privateKey,
      signaturePublicJwk: senderPublicSignature,
      registrationIdempotencyKey: "44444444-4444-4444-8444-444444444444",
      registeredKeyVersion: 1,
      createdAt: "2026-08-04T10:00:00.000Z",
    },
    cryptoContext: {
      suite: "CIFRA_CRYPTO_V1",
      profile: "CIFRA-ECDH-P256-HKDF-SHA256-A256KW",
      topicId: TOPIC_ID,
      keyEpoch: 7,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      senderDeviceId: SENDER_DEVICE_ID,
      recipientKeys: [
        {
          userId: SENDER_USER_ID,
          deviceId: SENDER_DEVICE_ID,
          keyId: "sender-enc-1",
          keyEpoch: 7,
          algorithm: "CIFRA-ECDH-P256-HKDF-SHA256-A256KW",
          publicJwk: senderPublicEncryption,
        },
        {
          userId: RECIPIENT_USER_ID,
          deviceId: RECIPIENT_DEVICE_ID,
          keyId: "recipient-enc-1",
          keyEpoch: 7,
          algorithm: "CIFRA-ECDH-P256-HKDF-SHA256-A256KW",
          publicJwk: recipientPublicEncryption,
        },
      ],
      complianceKey: {
        keyId: "compliance-rsa-2026-08",
        algorithm: "RSA-OAEP-256",
        publicJwk: complianceJwk,
      },
    },
    media: {
      kind: "voice",
      fileName: "voice.webm",
      mimeType: "audio/webm",
      plaintextSize: original.byteLength,
      durationMs: 1_234,
      mediaDek,
      mediaNonce: bytesToBase64Url(mediaNonce),
      mediaId: MEDIA_ID,
      manifestVersion: 1,
      manifestSha256,
    },
  });
  mediaDek.fill(0);
  const metadata = await decryptMediaEnvelopeMetadata({
    envelope,
    topicId: TOPIC_ID,
    recipientUserId: RECIPIENT_USER_ID,
    recipientDeviceId: RECIPIENT_DEVICE_ID,
    recipientKeyId: "recipient-enc-1",
    recipientPrivateKey: recipientEncryption.privateKey,
    senderSignaturePublicJwk: senderPublicSignature,
  });
  const ciphertext = concat(ciphertextParts);
  const api = rangeApi(manifest, ciphertext);
  return { api, ciphertext, envelope, manifest, metadata, original };
}

test("performs the Stage 3 A-to-B signed envelope and authenticated Range round-trip", async () => {
  const value = await fixture();
  assert.equal(value.metadata.signatureStatus, "verified");
  assert.equal(value.metadata.mediaKey.extractable, false);
  assert.equal("media_dek" in value.metadata.payload, false);
  const result = await downloadAndDecryptMedia({
    api: value.api,
    metadata: value.metadata,
    mode: "range",
  });
  assert.equal(result.fileName, "voice.webm");
  assert.equal(result.mimeType, "audio/webm");
  assert.deepEqual(
    new Uint8Array(await result.blob.arrayBuffer()),
    value.original,
  );
});

test("rejects a tampered manifest and a tampered ciphertext Range", async () => {
  const value = await fixture();
  const badManifest = structuredClone(value.manifest);
  badManifest.chunks[0].checksumSha256 = "0".repeat(64);
  await assert.rejects(
    downloadAndDecryptMedia({
      api: rangeApi(badManifest, value.ciphertext),
      metadata: value.metadata,
      mode: "range",
    }),
    /manifest не совпадает/,
  );

  const tamperedCiphertext = value.ciphertext.slice();
  tamperedCiphertext[0] ^= 1;
  await assert.rejects(
    downloadAndDecryptMedia({
      api: rangeApi(value.manifest, tamperedCiphertext),
      metadata: value.metadata,
      mode: "range",
    }),
    /SHA-256 ciphertext part 0 не совпадает/,
  );
});

function rangeApi(manifest, ciphertext) {
  return {
    async getMediaManifest() {
      return manifest;
    },
    async downloadMediaContent(_mediaId, options = {}) {
      const match = /^bytes=(\d+)-(\d+)$/.exec(options.range ?? "");
      assert.ok(match, "receiver must request an explicit byte Range");
      const start = Number(match[1]);
      const end = Number(match[2]);
      const body = ciphertext.slice(start, end + 1);
      return {
        body: body.buffer,
        status: 206,
        contentRange: `bytes ${start}-${end}/${ciphertext.byteLength}`,
        contentLength: body.byteLength,
        etag: '"stage3-ciphertext"',
      };
    },
  };
}

function concat(parts) {
  const output = new Uint8Array(
    parts.reduce((size, part) => size + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}
