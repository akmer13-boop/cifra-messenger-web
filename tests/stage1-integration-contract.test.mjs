import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const apiUrl = new URL("../app/cifra-api.ts", import.meta.url);

test("loads the directory lazily and never assigns the first employee as self", async () => {
  const [page, api] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(apiUrl, "utf8"),
  ]);

  assert.match(api, /if \(cursor\) params\.set\("cursor", cursor\)/);
  assert.match(api, /async listUsers\(/);
  assert.match(page, /await client\.listUsers\("", null, controller\.signal\)/);
  assert.match(page, /setDirectoryNextCursor\(merged\.next_cursor\)/);
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
  assert.match(page, /disabled=\{sendPending \|\| \(!draft && !recording && mediaPipelineBusy\)\}/);
  assert.match(page, /const result = await realtimeClient\.publishText/);
  assert.doesNotMatch(page, /void realtimeClient[\s\S]{0,30}\.publishText/);
  assert.match(page, /className="composer-send-error" role="alert"/);
  assert.match(page, /result === "unknown"/);
  assert.match(page, /retryable: false/);
});

test("backend mode uses protected media and never falls back to simulated delivery", async () => {
  const page = await readFile(pageUrl, "utf8");
  const voiceHandler = page.slice(
    page.indexOf("const handleVoice ="),
    page.indexOf("const handleAttachment ="),
  );

  assert.match(page, /new MediaUploadCoordinator\(/);
  assert.match(voiceHandler, /new MediaRecorderAdapter\(\)/);
  assert.match(voiceHandler, /await recorder\.start\(/);
  assert.match(page, /if \(authMode === "backend"\) \{[\s\S]*?WebRTC/);
  assert.doesNotMatch(voiceHandler, /voice: "0:07"/);
  assert.match(page, /Файл не опубликован в чате и не показан получателю/);
});

test("accepts the staging data-mode and API URL build variables", async () => {
  const api = await readFile(apiUrl, "utf8");

  assert.match(api, /process\.env\.NEXT_PUBLIC_DATA_MODE/);
  assert.match(api, /process\.env\.NEXT_PUBLIC_CIFRA_API_URL/);
  assert.match(api, /BUILD_TIME_DATA_MODE === "api"/);
  assert.match(api, /BUILD_TIME_API_BASE_URL\.trim\(\)/);
});
