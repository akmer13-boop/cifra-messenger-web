import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const apiUrl = new URL("../app/cifra-api.ts", import.meta.url);

test("loads every directory page and never assigns the first employee as self", async () => {
  const [page, api] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(apiUrl, "utf8"),
  ]);

  assert.match(api, /async listUsers\(query = "", cursor: string \| null = null\)/);
  assert.match(api, /if \(cursor\) params\.set\("cursor", cursor\)/);
  assert.match(api, /async listAllUsers\(query = ""\)/);
  assert.match(page, /await client\.listAllUsers\(\)/);
  assert.match(page, /authSessionToMessenger\(session\), \.\.\.directoryUsers/);
  assert.doesNotMatch(page, /\?\? users\[0\]/);
});

test("keeps a text draft until the realtime server acknowledges publication", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /onSend: \([\s\S]*?\) => Promise<SendMessageResult>/);
  assert.match(page, /const result = await onSend\(value, \{/);
  assert.match(page, /if \(result !== "sent"\) \{[\s\S]*?setSendError/);
  assert.match(page, /setDraft\(\(current\) => \(current\.trim\(\) === value/);
  assert.match(page, /if \(!value \|\| sendPending\) return/);
  assert.match(page, /disabled=\{sendPending\}/);
  assert.match(page, /const result = await realtimeClient\.publishText/);
  assert.doesNotMatch(page, /void realtimeClient[\s\S]{0,30}\.publishText/);
  assert.match(page, /className="composer-send-error" role="alert"/);
  assert.match(page, /result === "unknown"/);
  assert.match(page, /retryable: false/);
});

test("backend mode does not present simulated media, voice, or calls as real", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /if \(runtimeMode === "backend"\) \{[\s\S]*?media pipeline/);
  assert.match(page, /if \(authMode === "backend"\) \{[\s\S]*?WebRTC/);
});

test("accepts the staging data-mode and API URL build variables", async () => {
  const api = await readFile(apiUrl, "utf8");

  assert.match(api, /process\.env\.NEXT_PUBLIC_DATA_MODE/);
  assert.match(api, /process\.env\.NEXT_PUBLIC_CIFRA_API_URL/);
  assert.match(api, /BUILD_TIME_DATA_MODE === "api"/);
  assert.match(api, /BUILD_TIME_API_BASE_URL\.trim\(\)/);
});
