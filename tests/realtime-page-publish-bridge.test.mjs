import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);

test("routes only the observed attached real chat through Tinode publish", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /type RealtimePublishStatus =/);
  assert.match(
    page,
    /const \[realtimePublishStatus, setRealtimePublishStatus\] =/,
  );
  assert.match(
    page,
    /const \[realtimePublishedSeq, setRealtimePublishedSeq\] = useState</,
  );
  assert.match(
    page,
    /chatId === realtimeObservedTopic[\s\S]*?realtimeStatus === "connected"[\s\S]*?realtimeChatStatus === "subscribed"[\s\S]*?realtimeClient\.isTopicSubscribed\(chatId\)/,
  );
  assert.match(
    page,
    /realtimeClient[\s\S]*?\.publishText\(chatId, normalizedText\)/,
  );
  assert.match(page, /setRealtimePublishStatus\("publishing"\)/);
  assert.match(page, /setRealtimePublishStatus\("published"\)/);
  assert.match(page, /setRealtimePublishedSeq\(result\.seq\)/);
  assert.match(page, /setRealtimePublishStatus\("error"\)/);
  assert.match(
    page,
    /data-realtime-publish-status=\{realtimePublishStatus\}/,
  );
  assert.match(
    page,
    /data-realtime-published-seq=\{realtimePublishedSeq \?\? ""\}/,
  );

  // Mock chats keep their existing behavior until real topic IDs are added to the UI.
  assert.match(page, /const deliveredTimer = window\.setTimeout/);
  assert.match(page, /const readTimer = window\.setTimeout/);
  assert.doesNotMatch(page, /cifra:realtime-publish-text/);
});
