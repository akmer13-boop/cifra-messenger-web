import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps real chat UI state while the client reconnects with refreshed API auth", async () => {
  const [page, api, realtime] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/cifra-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/cifra-realtime.ts", import.meta.url), "utf8"),
  ]);

  assert.match(api, /async issueRealtimeTicket\(\): Promise<unknown>/);
  assert.match(
    api,
    /this\.request<Record<string, unknown>>\([\s\S]*?"\/api\/v1\/realtime\/tickets"[\s\S]*?parseJsonRecord/,
  );
  assert.match(page, /ticketProvider: \(\) => apiClient\.issueRealtimeTicket\(\)/);
  assert.match(page, /if \(status === "disconnected"\) \{[\s\S]*?setRealtimeUserId\(null\)/);
  assert.doesNotMatch(page, /if \(status !== "connected"\) \{[\s\S]{0,100}?setRealtimeUserId\(null\)/);
  assert.match(page, /if \(realtimeStatus === "reconnecting"\) \{\s*return;\s*\}/);
  assert.match(page, /data-realtime-preserved-during-reconnect=/);
  assert.match(realtime, /scheduleReconnect\("websocket_closed"\)/);
  assert.match(realtime, /restoreDesiredChatSubscriptions\(socket\)/);
  assert.match(realtime, /since: latestLocalSeq \+ 1/);
});
