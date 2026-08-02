import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);

test("observes every readable Tinode chat while retaining mock UI only in demo mode", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /type RealtimeChatMessage/);
  assert.match(
    page,
    /const \[realtimeMessages, setRealtimeMessages\] = useState<[\s\S]*?readonly RealtimeChatMessage\[\][\s\S]*?>\(\[\]\);/,
  );
  assert.match(
    page,
    /new CifraRealtimeClient\([\s\S]*?\(messages\) => \{[\s\S]*?setRealtimeMessages\(\[\.\.\.messages\]\);[\s\S]*?\},[\s\S]*?\);/,
  );
  assert.match(page, /getReadableRealtimeSubscriptions\(realtimeSubscriptions\)/);
  assert.match(
    page,
    /readableSubscriptions\.map\(\(subscription\) =>[\s\S]*?subscribeToChat\(subscription\.topic, \{[\s\S]*?historyLimit: 20/,
  );
  assert.match(page, /Promise\.allSettled\(subscriptionTasks\)/);
  assert.match(page, /data-realtime-chat-status=\{realtimeChatStatus\}/);
  assert.match(
    page,
    /data-realtime-observed-topic=\{realtimeObservedTopic \?\? ""\}/,
  );
  assert.match(page, /data-realtime-attached-topic-count=/);
  assert.match(page, /data-realtime-message-count=/);
  assert.match(page, /setRealtimeMessages\(\[\]\)/);

  assert.match(page, /useState<Chat\[]>\(\[\]\)/);
  assert.match(page, /setChatItems\(initialChats\)/);
  assert.match(page, /const withoutRealtimeTopics = canUseLocalChatFallback\(authMode\)/);
  assert.match(page, /filterChatsForRuntimeMode/);
  assert.match(page, /const sendMessage = \(/);
  assert.match(page, /window\.setTimeout/);
});
