import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);

test("bridges Tinode receipts into real message delivery statuses", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /type RealtimeChatReceipt/);
  assert.match(
    page,
    /const \[realtimeReceipts, setRealtimeReceipts\] = useState<[\s\S]*?readonly RealtimeChatReceipt\[\][\s\S]*?>\(\[\]\);/,
  );
  assert.match(
    page,
    /\(receipts\) => \{[\s\S]*?setRealtimeReceipts\(\[\.\.\.receipts\]\);/,
  );
  assert.match(page, /const getRealtimeReceiptSeq = \(/);
  assert.match(page, /receipt\.from !== selfUserId/);
  assert.match(page, /message\.seq <= remoteReadSeq/);
  assert.match(page, /message\.seq <= remoteReceivedSeq/);
  assert.match(page, /const withRealtimeReceiptStatus = \(/);
  assert.match(page, /\? "read"[\s\S]*?\? "delivered"[\s\S]*?: "sent"/);
  assert.match(
    page,
    /withRealtimeReceiptStatus\([\s\S]*?buildRealtimeUiMessage\([\s\S]*?message,[\s\S]*?realtimeUserId,[\s\S]*?participantNameById\.get\(message\.from\)[\s\S]*?\),[\s\S]*?message,[\s\S]*?realtimeUserId,[\s\S]*?realtimeReceipts/,
  );
  assert.match(page, /data-realtime-receipt-count=/);
  assert.match(page, /data-realtime-remote-recv-seq=/);
  assert.match(page, /data-realtime-remote-read-seq=/);
});

test("marks incoming messages read only while the real chat is visible", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /selectedChatId !== topic/);
  assert.match(page, /document\.visibilityState === "hidden"/);
  assert.match(page, /message\.from !== userId/);
  assert.match(page, /realtimeClient\.markRead\(topic, latestIncomingSeq\)/);
  assert.match(page, /document\.addEventListener\([\s\S]*?"visibilitychange"/);
  assert.match(page, /document\.removeEventListener\([\s\S]*?"visibilitychange"/);

  // Mock chats keep their existing local delivered/read timers.
  assert.match(page, /const deliveredTimer = window\.setTimeout/);
  assert.match(page, /const readTimer = window\.setTimeout/);
});
