import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseDeviceCryptoKeysResponse } from "../lib/media/contracts.ts";

const golden = JSON.parse(
  await readFile(
    new URL("./fixtures/crypto-golden-vectors.json", import.meta.url),
    "utf8",
  ),
);

test("strictly acknowledges the registered device algorithms, UUID and public keys", () => {
  const vector = golden.vectors[0];
  const response = {
    version: 1,
    device_id: vector.sender.device_id,
    key_version: 7,
    encryption: {
      algorithm: "CIFRA-ECDH-P256-HKDF-SHA256-A256KW",
      key_id: "web-enc-1",
      public_jwk: vector.recipients[0].public_jwk,
    },
    signature: {
      algorithm: "ECDSA-P256-SHA256",
      key_id: "web-sig-1",
      public_jwk: vector.signature.public_jwk,
    },
    created_at: "2026-08-04T10:00:00.000Z",
  };
  const parsed = parseDeviceCryptoKeysResponse(response);
  assert.equal(parsed.deviceId, response.device_id);
  assert.deepEqual(parsed.encryptionPublicJwk, response.encryption.public_jwk);
  assert.deepEqual(parsed.signaturePublicJwk, response.signature.public_jwk);
  assert.throws(
    () => parseDeviceCryptoKeysResponse({
      ...response,
      encryption: { ...response.encryption, algorithm: "ECDH-P256+A256KW" },
    }),
    /device crypto keys\.encryption\.algorithm/,
  );
  assert.throws(
    () => parseDeviceCryptoKeysResponse({ ...response, ignored: true }),
    /device crypto keys/,
  );
});
