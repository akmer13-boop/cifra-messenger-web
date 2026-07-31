import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);

test("projects every attached Tinode topic and server message into the chat UI", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(
    page,
    /const \[realtimeUserId, setRealtimeUserId\] = useState<string \| null>\(null\)/,
  );
  assert.match(page, /\.then\(\(userId\) => \{[\s\S]*?setRealtimeUserId\(userId\)/);
  assert.match(page, /const getRealtimeMessageText = \(content: unknown\)/);
  assert.match(page, /content\["txt"\]/);
  assert.match(page, /const buildRealtimeUiMessage = \(/);
  assert.match(page, /message\.from === selfUserId/);
  assert.match(page, /deliveryStatus: "sent" as const/);
  assert.match(
    page,
    /activeSubscriptions\.map\(\(subscription\) =>[\s\S]*?realtimeMessages\.filter\([\s\S]*?message\.topic === activeTopic[\s\S]*?buildRealtimeUiMessage\([\s\S]*?message,[\s\S]*?realtimeUserId,[\s\S]*?participantNameById\.get\(message\.from\)/,
  );
  assert.match(page, /projectedMessagesByTopic\[activeTopic\] = projectedMessages/);
  assert.match(page, /id: activeTopic/);
  assert.match(page, /title,[\s\S]*?subtitle: latestMessage/);
  assert.match(
    page,
    /for \(const \[topic, messages\] of Object\.entries\([\s\S]*?projectedMessagesByTopic[\s\S]*?next\[topic\] = messages/,
  );
  assert.match(
    page,
    /return \[\.\.\.nextRealtimeChats, \.\.\.withoutRealtimeTopics\]/,
  );
  assert.match(page, /data-realtime-ui-topic=/);
  assert.match(page, /data-realtime-ui-topic-count=/);
  assert.match(page, /data-realtime-ui-message-count=/);
});

test("keeps mock delivery timers outside the real Tinode publish path", async () => {
  const page = await readFile(pageUrl, "utf8");
  const publishBranch = page.indexOf("realtimeClient.isTopicSubscribed(chatId)");
  const mockTimer = page.indexOf("const deliveredTimer = window.setTimeout");

  assert.ok(publishBranch >= 0);
  assert.ok(mockTimer > publishBranch);
  assert.match(page, /publishText\(chatId, normalizedText\)/);
  assert.match(page, /return true;[\s\S]*?const now = formatMessageTime\(\)/);
});
