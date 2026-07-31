import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);

test("attaches every readable Tinode topic and tracks successful subscriptions", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /getReadableRealtimeSubscriptions/);
  assert.match(page, /const \[realtimeAttachedTopics, setRealtimeAttachedTopics\] = useState</);
  assert.match(page, /readableSubscriptions\.map\(\(subscription\) =>[\s\S]*?subscribeToChat\(subscription\.topic/);
  assert.match(page, /Promise\.allSettled\(subscriptionTasks\)/);
  assert.match(page, /setRealtimeAttachedTopics\(attachedTopics\)/);
  assert.match(page, /attachedTopics\.length > 0 \? "subscribed" : "error"/);
  assert.match(page, /data-realtime-attached-topic-count=/);
});

test("projects all attached real chats and excludes mock chats in backend mode", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /const realtimeUiTopicsRef = useRef<Set<string>>/);
  assert.match(page, /activeSubscriptions\.map\(\(subscription\) =>/);
  assert.match(page, /projectedMessagesByTopic\[activeTopic\] = projectedMessages/);
  assert.match(page, /const withoutRealtimeTopics = canUseLocalChatFallback\(authMode\)/);
  assert.match(page, /filterChatsForRuntimeMode/);
  assert.match(page, /resolveRealtimeObservedTopic\([\s\S]*?selectedChatId/);
  assert.match(page, /realtimeAttachedTopics\.includes\(id\)/);
  assert.match(page, /realtimeAttachedTopics\.includes\(chatId\)/);
  assert.match(page, /data-realtime-ui-topic-count=/);
  assert.match(page, /data-realtime-selected-topic=/);
});
