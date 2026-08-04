import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
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
  sanitizeEncryptionPublicJwk,
  serializeRecipientKdfContext,
  unwrapDek,
  verifyCanonical,
  wrapComplianceDek,
  wrapDek,
} from "../lib/media/cifra-crypto-v1.mjs";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  canonicalJson,
} from "../lib/media/protocol.mjs";

const golden = JSON.parse(
  await readFile(
    new URL("./fixtures/crypto-golden-vectors.json", import.meta.url),
    "utf8",
  ),
);
const compliance = JSON.parse(
  await readFile(
    new URL("./fixtures/compliance-rsa-oaep-fixture.json", import.meta.url),
    "utf8",
  ),
);

for (const vector of golden.vectors) {
  test(`matches official CIFRA_CRYPTO_V1 vector ${vector.id}`, async () => {
    const ephemeralPrivateKey = await crypto.subtle.importKey(
      "jwk",
      vector.ephemeral.private_jwk,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
    const ephemeralPoint = ecPublicJwkToUncompressedPoint(
      vector.ephemeral.public_jwk,
    );
    const salt = base64UrlToBytes(vector.salt);
    const dek = base64UrlToBytes(vector.dek);

    for (const recipient of vector.recipients) {
      const info = serializeRecipientKdfContext({
        senderUserId: vector.sender.user_id,
        senderDeviceId: vector.sender.device_id,
        recipientUserId: recipient.user_id,
        recipientDeviceId: recipient.device_id,
        recipientKeyId: recipient.key_id,
        topicId: vector.topic_id,
        clientMsgId: vector.client_msg_id,
        keyEpoch: vector.key_epoch,
        ephemeralPublicKey: ephemeralPoint,
      });
      assert.equal(bytesToBase64Url(info), recipient.kdf_info);
      const kek = await deriveRecipientKek({
        privateKey: ephemeralPrivateKey,
        publicJwk: recipient.public_jwk,
        salt,
        info,
      });
      assert.equal(bytesToBase64Url(kek), recipient.kek);
      const wrapped = await wrapDek(kek, dek);
      assert.equal(bytesToBase64Url(wrapped), recipient.wrapped_key);
      assert.deepEqual(await unwrapDek(kek, wrapped), dek);
      kek.fill(0);
    }

    assert.equal(
      encodeRecipientBundle(vector.recipient_bundle.json),
      vector.recipient_bundle.encoded,
    );
    const aad = contentAad({
      clientMsgId: vector.client_msg_id,
      contentType: vector.kind,
      topicId: vector.topic_id,
    });
    assert.equal(bytesToBase64Url(aad), vector.content.aad);
    const encrypted = await encryptA256Gcm({
      dek,
      nonce: base64UrlToBytes(vector.content.nonce),
      plaintext: base64UrlToBytes(vector.content.plaintext),
      aad,
    });
    assert.equal(bytesToBase64Url(encrypted.ciphertext), vector.content.ciphertext);
    assert.equal(
      bytesToBase64Url(encrypted.authenticationTag),
      vector.content.authentication_tag,
    );
    assert.deepEqual(
      await decryptA256Gcm({
        dek,
        nonce: base64UrlToBytes(vector.content.nonce),
        ciphertext: encrypted.ciphertext,
        authenticationTag: encrypted.authenticationTag,
        aad,
      }),
      base64UrlToBytes(vector.content.plaintext),
    );

    const signing = JSON.parse(vector.signature.canonical_input_utf8);
    const media = vector.media
      ? [{
          id: vector.media.media_id,
          manifest_version: vector.media.manifest_version,
          manifest_sha256: vector.media.manifest_sha256,
        }]
      : [];
    const envelope = {
      schema: "cifra.message/1",
      client_msg_id: vector.client_msg_id,
      kind: vector.kind,
      crypto: {
        version: 1,
        suite: golden.suite,
        profile: golden.profile,
        key_epoch: vector.key_epoch,
        content_algorithm: "A256GCM",
        nonce: vector.content.nonce,
        ciphertext: vector.content.ciphertext,
        authentication_tag: vector.content.authentication_tag,
        recipient_dek: vector.recipient_bundle.encoded,
        compliance_key_id: signing.compliance_key_id,
        compliance_dek: signing.compliance_dek,
        signature: vector.signature.signature,
      },
      media,
    };
    assert.deepEqual(parseMessageEnvelope(envelope), envelope);
    const signatureInput = await messageSignatureInput({
      envelope,
      topicId: vector.topic_id,
      senderUserId: vector.sender.user_id,
      senderDeviceId: vector.sender.device_id,
    });
    assert.equal(canonicalJson(signatureInput), vector.signature.canonical_input_utf8);
    assert.equal(
      await verifyCanonical(
        signatureInput,
        vector.signature.public_jwk,
        base64UrlToBytes(vector.signature.signature),
      ),
      true,
    );

    if (vector.media) {
      assert.equal(
        await mediaManifestSha256({
          mediaId: vector.media.media_id,
          manifestVersion: vector.media.manifest_version,
          chunks: [{
            index: vector.media.part_number,
            sizeBytes: base64UrlToBytes(vector.media.combined_ciphertext).byteLength,
            checksumSha256: vector.media.chunk_checksum_sha256,
          }],
        }),
        vector.media.manifest_sha256,
      );
    }
    dek.fill(0);
  });
}

test("rejects noncanonical base64url pad bits, unknown fields and tampering", async () => {
  const vector = golden.vectors[0];
  const noncanonicalX = `${"A".repeat(42)}B`;
  assert.throws(
    () => sanitizeEncryptionPublicJwk({
      kty: "EC",
      crv: "P-256",
      x: noncanonicalX,
      y: "A".repeat(43),
      use: "enc",
    }),
    /invalid/,
  );

  const signing = JSON.parse(vector.signature.canonical_input_utf8);
  const envelope = {
    schema: "cifra.message/1",
    client_msg_id: vector.client_msg_id,
    kind: vector.kind,
    crypto: {
      version: 1,
      suite: golden.suite,
      profile: golden.profile,
      key_epoch: vector.key_epoch,
      content_algorithm: "A256GCM",
      nonce: vector.content.nonce,
      ciphertext: vector.content.ciphertext,
      authentication_tag: vector.content.authentication_tag,
      recipient_dek: vector.recipient_bundle.encoded,
      compliance_key_id: signing.compliance_key_id,
      compliance_dek: signing.compliance_dek,
      signature: vector.signature.signature,
    },
    media: [],
  };
  assert.throws(() => parseMessageEnvelope({ ...envelope, plaintext: "leak" }), /unknown/);
  assert.throws(() => parseRecipientBundle("A".repeat(15)), /wire length/);
  assert.throws(() => parseRecipientBundle("A".repeat(1_000_001)), /wire length/);
  assert.throws(
    () => parseMessageEnvelope({
      ...envelope,
      crypto: { ...envelope.crypto, compliance_dek: "A".repeat(1_367) },
    }),
    /crypto fields/,
  );

  const tag = base64UrlToBytes(vector.content.authentication_tag);
  tag[0] ^= 1;
  await assert.rejects(
    decryptA256Gcm({
      dek: base64UrlToBytes(vector.dek),
      nonce: base64UrlToBytes(vector.content.nonce),
      ciphertext: base64UrlToBytes(vector.content.ciphertext),
      authenticationTag: tag,
      aad: base64UrlToBytes(vector.content.aad),
    }),
    /authentication failed/,
  );
});

test("accepts only schema-sized voice waveforms", () => {
  const payload = {
    version: 1,
    caption: "",
    file_name: "voice.webm",
    mime_type: "audio/webm",
    size_bytes: 123,
    duration_ms: 1_000,
    waveform: Array(64).fill(0.5),
    media_dek: "A".repeat(43),
    media_nonce: "A".repeat(11),
    media_cipher: "AES-256-GCM-CHUNKED-V1",
  };
  assert.deepEqual(parseMediaPayload(payload), payload);
  assert.throws(
    () => parseMediaPayload({ ...payload, waveform: Array(63).fill(0.5) }),
    /payload is invalid/,
  );
});

test("wraps the compliance copy with both permitted RSA key_ops profiles", async () => {
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    compliance.private_jwk,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
  const rawDek = new Uint8Array(32).fill(0x51);
  for (const keyOps of [["encrypt"], ["wrapKey"]]) {
    const wrapped = await wrapComplianceDek(rawDek, {
      ...compliance.public_jwk,
      key_ops: keyOps,
    });
    assert.equal(wrapped.byteLength, 256);
    assert.deepEqual(
      new Uint8Array(
        await crypto.subtle.decrypt("RSA-OAEP", privateKey, wrapped),
      ),
      rawDek,
    );
  }
  rawDek.fill(0);
});
