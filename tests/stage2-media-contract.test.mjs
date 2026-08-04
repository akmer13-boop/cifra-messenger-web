import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiUrl = new URL("../app/cifra-api.ts", import.meta.url);
const pageUrl = new URL("../app/page.tsx", import.meta.url);
const coordinatorUrl = new URL(
  "../lib/media/media-upload-coordinator.ts",
  import.meta.url,
);
const storeUrl = new URL("../lib/media/upload-store.ts", import.meta.url);
const cryptoUrl = new URL("../lib/media/crypto.ts", import.meta.url);
const workerUrl = new URL("../app/workers/media-crypto.worker.ts", import.meta.url);
const recorderUrl = new URL(
  "../lib/media/media-recorder-adapter.ts",
  import.meta.url,
);

test("wires the exact PR 18 media endpoints and binary part headers", async () => {
  const api = await readFile(apiUrl, "utf8");
  assert.match(api, /"\/api\/v1\/capabilities"/);
  assert.match(api, /\/api\/v1\/devices\/\$\{encodeURIComponent\(deviceId\)\}\/crypto-keys/);
  assert.match(api, /"\/api\/v1\/devices"/);
  assert.match(api, /\/api\/v1\/chats\/\$\{encodeURIComponent\(topicId\)\}\/crypto-context/);
  assert.match(api, /"\/api\/v1\/media\/uploads"/);
  assert.match(api, /\/parts\/\$\{partNumber\}/);
  assert.match(api, /"Content-Type": "application\/octet-stream"/);
  assert.match(api, /"Content-SHA256": checksumSha256/);
  assert.match(api, /\/complete`/);
});

test("persists ciphertext resume data but never plaintext or a raw DEK", async () => {
  const [store, crypto] = await Promise.all([
    readFile(storeUrl, "utf8"),
    readFile(cryptoUrl, "utf8"),
  ]);
  assert.match(store, /ciphertext: ArrayBuffer/);
  assert.match(store, /nextPart: number/);
  assert.match(store, /ownerUserId: string/);
  assert.match(store, /ownerDeviceId: string/);
  assert.match(store, /scopeId: string/);
  assert.doesNotMatch(store, /plaintext:\s*(?:ArrayBuffer|Blob|Uint8Array)/);
  assert.doesNotMatch(store, /rawDek:\s*(?:ArrayBuffer|Uint8Array|string)/);
  assert.match(crypto, /rawDek\.fill\(0\)/);
  assert.match(crypto, /false,\s*\["encrypt"\]/);
  assert.match(crypto, /"RSA-OAEP"/);
});

test("scopes resume state by account, device and chat", async () => {
  const [store, coordinator] = await Promise.all([
    readFile(storeUrl, "utf8"),
    readFile(coordinatorUrl, "utf8"),
  ]);
  assert.match(store, /const DATABASE_VERSION = 2/);
  assert.match(store, /createIndex\("scopeId", "scopeId"/);
  assert.match(store, /getLatestOperationForScope\(/);
  assert.match(store, /mediaOperationScopeId\(userId, deviceId, topicId\)/);
  assert.match(coordinator, /getLatestOperationForScope\(/);
  assert.match(coordinator, /assertOperationScope\(operation, scope\)/);
});

test("commits uploaded-part progress and chunk deletion atomically", async () => {
  const [store, coordinator] = await Promise.all([
    readFile(storeUrl, "utf8"),
    readFile(coordinatorUrl, "utf8"),
  ]);
  assert.match(store, /async acknowledgeUploadedPart\(/);
  assert.match(
    store,
    /database\.transaction\(\s*\[OPERATIONS_STORE, CHUNKS_STORE\],\s*"readwrite"/,
  );
  assert.match(
    store,
    /objectStore\(OPERATIONS_STORE\)\.put\(operation\)[\s\S]*objectStore\(CHUNKS_STORE\)[\s\S]*\.delete\(chunkId\(operation\.operationId, partNumber\)\)/,
  );
  assert.match(coordinator, /await this\.store\.acknowledgeUploadedPart\(/);
  assert.doesNotMatch(coordinator, /this\.store\.deleteChunk\(/);
});

test("encrypts chunked AES-GCM in a worker and acknowledges storage before continuing", async () => {
  const worker = await readFile(workerUrl, "utf8");
  assert.match(worker, /deriveMediaPartIv\(request\.noncePrefix, partNumber\)/);
  assert.match(worker, /mediaPartAad\(request\.mediaId, partNumber\)/);
  assert.match(worker, /tagLength: 128/);
  assert.match(worker, /await waitForChunkAcknowledgement/);
  assert.match(worker, /ciphertext/);
});

test("records real voice and prepares a signed envelope while UI publication stays blocked", async () => {
  const [page, coordinator] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(coordinatorUrl, "utf8"),
  ]);
  assert.match(page, /new MediaRecorderAdapter\(\)/);
  assert.match(page, /await recorder\.start\(/);
  assert.match(page, /formatMediaDuration\(recordingElapsedMs\)/);
  assert.doesNotMatch(page, /<strong>0:07<\/strong>/);
  assert.match(page, /await coordinator\.start\(voiceDraft\.file, "voice"/);
  assert.match(coordinator, /deliveryBlocked: true/);
  assert.match(coordinator, /prepareMediaEnvelope/);
  assert.match(coordinator, /publishMessageEnvelope/);
  assert.match(coordinator, /MEDIA_DELIVERY_UNKNOWN/);
  assert.doesNotMatch(page, /publishPrepared\(/);
});

test("stops a late microphone grant after cancellation or disposal", async () => {
  const recorder = await readFile(recorderUrl, "utf8");
  assert.match(recorder, /private disposed = false/);
  assert.match(recorder, /private startGeneration = 0/);
  assert.match(recorder, /generation !== this\.startGeneration/);
  assert.match(
    recorder,
    /stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/,
  );
  assert.match(recorder, /dispose\(\): void \{\s*this\.disposed = true;/);
});

test("matches PR 18 create response and validates ciphertext after complete", async () => {
  const coordinator = await readFile(coordinatorUrl, "utf8");
  assert.match(coordinator, /upload\.media\.ciphertextSize !== null/);
  assert.doesNotMatch(
    coordinator,
    /upload\.media\.ciphertextSize !== plan\.ciphertextSize/,
  );
  assert.match(
    coordinator,
    /media\.ciphertextSize !== operation\.ciphertextSize/,
  );
});

test("treats malformed successful JSON as a non-retryable contract error", async () => {
  const api = await readFile(apiUrl, "utf8");
  assert.match(api, /parseSuccessfulResponse\(parseJson, responseBody\)/);
  assert.match(api, /throw contractError\("ответ API", "json"\)/);
  assert.match(api, /"API_CONTRACT_MISMATCH"/);
});
