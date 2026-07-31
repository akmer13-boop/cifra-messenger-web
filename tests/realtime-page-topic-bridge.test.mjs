import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);

test("bridges Tinode me-topic subscriptions without mutating chat rows directly", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /type RealtimeChatSubscription/);
  assert.match(
    page,
    /const \[realtimeSubscriptions, setRealtimeSubscriptions\] = useState<[\s\S]*?readonly RealtimeChatSubscription\[\][\s\S]*?>\(\[\]\);/,
  );
  assert.match(
    page,
    /new CifraRealtimeClient\([\s\S]*?\(subscriptions\) => \{[\s\S]*?setRealtimeSubscriptions\(\[\.\.\.subscriptions\]\);[\s\S]*?\},[\s\S]*?\);/,
  );
  assert.match(
    page,
    /data-realtime-topic-count=\{realtimeSubscriptions\.length\}/,
  );
  assert.match(page, /setRealtimeSubscriptions\(\[\]\)/);

  assert.match(page, /useState<Chat\[]>\(initialChats\)/);
  assert.doesNotMatch(
    page,
    /setChatItems\([\s\S]{0,240}realtimeSubscriptions/,
  );
});
