import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);

test("projects latest Tinode activity, preview, time and unread count into every real chat row", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /getLatestRealtimeSeq/);
  assert.match(page, /getRealtimeUnreadCount/);
  assert.match(page, /const \[realtimeReadSeqByTopic, setRealtimeReadSeqByTopic\]/);
  assert.match(page, /const realtimeActivityRef = useRef</);
  assert.match(page, /activeSubscriptions\.map\(\(subscription\) =>/);
  assert.match(page, /latestServerSeq > previousActivity\.seq/);
  assert.match(page, /order: \+\+activitySequenceRef\.current/);
  assert.match(page, /subtitle: latestMessage[\s\S]*?getChatPreview\(latestMessage, realtimeKind\)/);
  assert.match(page, /time:[\s\S]*?latestMessage\?\.time/);
  assert.match(page, /unread,[\s\S]*?lastActivityOrder: realtimeActivityOrder/);
});

test("clears realtime unread state when any attached chat is opened or visible", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /!realtimeUserId \|\| !realtimeAttachedTopics\.includes\(id\)/);
  assert.match(page, /getLatestIncomingRealtimeSeq\([\s\S]*?realtimeMessages/);
  assert.match(page, /setRealtimeReadSeqByTopic\(\(current\) =>/);
  assert.match(page, /realtimeClient\.markRead\(topic, latestIncomingSeq\)/);
  assert.match(page, /data-realtime-unread-count=/);
  assert.match(page, /data-realtime-local-read-seq=/);
  assert.match(page, /data-realtime-activity-order=/);
});
