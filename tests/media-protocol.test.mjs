import assert from "node:assert/strict";
import test from "node:test";

import {
  base64UrlToBytes,
  bytesToBase64Url,
  bytesToHex,
  calculateMediaUploadPlan,
  canonicalJson,
  deriveMediaPartIv,
  mediaPartAad,
} from "../lib/media/protocol.mjs";

test("uses the backend canonical JSON and canonical unpadded base64url formats", () => {
  assert.equal(
    canonicalJson({ version: 1, nested: { z: 2, a: 1 }, list: [{ b: 2, a: 1 }] }),
    '{"list":[{"a":1,"b":2}],"nested":{"a":1,"z":2},"version":1}',
  );
  const encoded = bytesToBase64Url(Uint8Array.from([0, 1, 2, 253, 254, 255]));
  assert.equal(encoded, "AAEC_f7_");
  assert.deepEqual(base64UrlToBytes(encoded), Uint8Array.from([0, 1, 2, 253, 254, 255]));
  assert.throws(() => base64UrlToBytes("AAEC_f7_="), /canonical base64url/);
});

test("calculates ciphertext sizes with one GCM tag per plaintext part", () => {
  assert.deepEqual(calculateMediaUploadPlan(65_521, 65_520), {
    expectedParts: 2,
    ciphertextSize: 65_553,
  });
  assert.throws(() => calculateMediaUploadPlan(0, 65_520), /positive/);
});

test("matches the fixed AES-256-GCM chunk vector for backend PR 18", async () => {
  const keyBytes = Uint8Array.from({ length: 32 }, (_, index) => index);
  const prefix = Uint8Array.from({ length: 8 }, (_, index) => 0xa0 + index);
  const mediaId = "123e4567-e89b-12d3-a456-426614174000";
  const partNumber = 7;
  const plaintext = new TextEncoder().encode("CIFRA media vector");
  const iv = deriveMediaPartIv(prefix, partNumber);
  const additionalData = mediaPartAad(mediaId, partNumber);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData, tagLength: 128 },
    key,
    plaintext,
  );

  assert.equal(bytesToHex(iv), "a0a1a2a3a4a5a6a700000007");
  assert.equal(
    new TextDecoder().decode(additionalData),
    '{"cipher":"AES-256-GCM-CHUNKED-V1","media_id":"123e4567-e89b-12d3-a456-426614174000","part_number":7,"version":1}',
  );
  assert.equal(
    bytesToHex(new Uint8Array(ciphertext)),
    "2bc9aa56d3dee1a4e3b7bed2f5bfef2919d67642e48bb64851ea38bfc9527b6f434e",
  );
  assert.deepEqual(
    new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData, tagLength: 128 },
        key,
        ciphertext,
      ),
    ),
    plaintext,
  );
});

