import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const realtimeUrl = new URL("../app/cifra-realtime.ts", import.meta.url);

test("exposes safe runtime diagnostics for two-browser staging acceptance", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /data-realtime-user-id=/);
  assert.match(page, /data-realtime-session-ready=/);
  assert.match(page, /data-realtime-connection-generation=/);
  assert.match(page, /data-realtime-reconnect-success-count=/);
  assert.match(page, /data-realtime-duplicate-message-count=/);
  assert.match(page, /data-realtime-last-error=/);
  assert.doesNotMatch(page, /data-realtime-(?:ticket|access-token|refresh-token|secret)=/);
});

test("wires diagnostics from the realtime client without exposing credentials", async () => {
  const page = await readFile(pageUrl, "utf8");
  const realtime = await readFile(realtimeUrl, "utf8");

  assert.match(page, /onDiagnostics:\s*\(diagnostics\)\s*=>/);
  assert.match(realtime, /getDiagnostics\(\): RealtimeDiagnostics/);
  assert.match(realtime, /duplicateMessageCount \+= 1/);
  assert.match(realtime, /reconnectSuccessCount \+= 1/);
  assert.match(realtime, /connectionGeneration \+= 1/);
});

test("clears cross-user realtime state on explicit logout", async () => {
  const page = await readFile(pageUrl, "utf8");
  const logoutBlock = page.slice(
    page.indexOf("const logout = async"),
    page.indexOf("const changeOwnPassword"),
  );

  assert.match(logoutBlock, /setRealtimeMessages\(\[\]\)/);
  assert.match(logoutBlock, /setRealtimeMetadata\(\[\]\)/);
  assert.match(logoutBlock, /setRealtimeReceipts\(\[\]\)/);
  assert.match(logoutBlock, /setRealtimeDiagnostics\(EMPTY_REALTIME_DIAGNOSTICS\)/);
  assert.match(logoutBlock, /setSelectedChatId\(null\)/);
});


test("resets diagnostics when the backend session is inactive", async () => {
  const page = await readFile(pageUrl, "utf8");
  const inactiveSessionBlock = page.slice(
    page.indexOf("if (\n      !sessionActive"),
    page.indexOf("const realtimeClient = new CifraRealtimeClient"),
  );

  assert.match(
    inactiveSessionBlock,
    /setRealtimeDiagnostics\(EMPTY_REALTIME_DIAGNOSTICS\)/,
  );
  assert.match(inactiveSessionBlock, /setRealtimeMetadata\(\[\]\)/);
  assert.match(inactiveSessionBlock, /setRealtimeMessages\(\[\]\)/);
});
