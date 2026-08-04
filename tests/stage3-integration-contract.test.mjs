import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("uses the normative profile and internal trusted device identity", async () => {
  const [contracts, api, keyStore] = await Promise.all([
    readFile(new URL("lib/media/contracts.ts", root), "utf8"),
    readFile(new URL("app/cifra-api.ts", root), "utf8"),
    readFile(new URL("lib/media/device-key-store.ts", root), "utf8"),
  ]);
  for (const source of [contracts, keyStore]) {
    assert.match(source, /CIFRA-ECDH-P256-HKDF-SHA256-A256KW/);
    assert.doesNotMatch(source, /["']ECDH-P256\+A256KW["']/);
  }
  assert.match(api, /"\/api\/v1\/devices"/);
  assert.match(api, /device\.externalDeviceId === externalDeviceId/);
  assert.match(api, /device\.trustStatus === "trusted"/);
  assert.match(keyStore, /response\.encryptionPublicJwk/);
  assert.match(keyStore, /sameP256Coordinates/);
});

test("fails closed after reload and after an unknown publish result", async () => {
  const [coordinator, page] = await Promise.all([
    readFile(new URL("lib/media/media-upload-coordinator.ts", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
  ]);
  assert.match(
    coordinator,
    /operation\.phase === "ready"[\s\S]*MEDIA_RESELECT_REQUIRED/,
  );
  assert.match(coordinator, /this\.publishState = "unknown"/);
  assert.match(
    coordinator,
    /this\.publishState = "unknown";[\s\S]*this\.preparedEnvelope = null;/,
  );
  assert.match(coordinator, /errorCode: "MEDIA_DELIVERY_UNKNOWN"/);
  assert.match(coordinator, /retryable: false/);
  assert.match(coordinator, /canRetry: false/);
  assert.doesNotMatch(page, /publishPrepared\(/);
});

test("documents the unresolved backend signing, dedupe and migration gates", async () => {
  const document = await readFile(
    new URL("docs/STAGE3_CRYPTO_MEDIA_RU.md", root),
    "utf8",
  );
  assert.match(document, /sender_user_id/);
  assert.match(document, /signing key ID\/version/);
  assert.match(document, /recordCommittedMessage\(\)/);
  assert.match(document, /0006/);
  assert.match(document, /MEDIA_DELIVERY_UNKNOWN/);
});
