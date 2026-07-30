import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);

test("observes one readable Tinode chat without replacing the mock chat UI", async () => {
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
  assert.match(
    page,
    /realtimeSubscriptions\.find\([\s\S]*?candidate\.access\.mode\.includes\("R"\)/,
  );
  assert.match(
    page,
    /subscribeToChat\(subscription\.topic, \{[\s\S]*?historyLimit: 20/,
  );
  assert.match(page, /data-realtime-chat-status=\{realtimeChatStatus\}/);
  assert.match(
    page,
    /data-realtime-observed-topic=\{realtimeObservedTopic \?\? ""\}/,
  );
  assert.match(page, /data-realtime-message-count=/);
  assert.match(page, /setRealtimeMessages\(\[\]\)/);

  assert.match(page, /useState<Chat\[]>\(initialChats\)/);
  assert.doesNotMatch(
    page,
    /setChatItems\([\s\S]{0,300}(?:realtimeMessages|realtimeObservedTopic)/,
  );
  assert.match(page, /const sendMessage = \(/);
  assert.match(page, /window\.setTimeout/);
});
