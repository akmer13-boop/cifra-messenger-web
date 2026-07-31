import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const realtimeUrl = new URL("../app/cifra-realtime.ts", import.meta.url);

test("bridges Tinode chat metadata into chat rows, profiles, and participants", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /type RealtimeChatMetadata/);
  assert.match(
    page,
    /const \[realtimeMetadata, setRealtimeMetadata\] = useState<[\s\S]*?readonly RealtimeChatMetadata\[\][\s\S]*?>\(\[\]\);/,
  );
  assert.match(
    page,
    /\(metadata\) => \{[\s\S]*?setRealtimeMetadata\(\[\.\.\.metadata\]\);/,
  );
  assert.match(
    page,
    /const metadataByTopic = new Map\([\s\S]*?realtimeMetadata\.map\(\(metadata\) => \[metadata\.topic, metadata\]\)/,
  );
  assert.match(page, /projectRealtimeChatMetadata\(/);
  assert.match(page, /title: metadataProjection\.title/);
  assert.match(page, /avatar: metadataProjection\.avatar/);
  assert.match(page, /avatarUrl: metadataProjection\.avatarUrl/);
  assert.match(page, /realtimeType: metadataProjection\.type/);
  assert.match(page, /memberIds: metadataProjection\.memberIds/);
  assert.match(page, /buildRealtimeParticipantProfiles\(metadata, realtimeUserId\)/);
  assert.match(page, /position: "Участник Tinode"/);
  assert.match(page, /participantNameById\.get\(message\.from\)/);
  assert.match(page, /imageUrl=\{chat\.avatarUrl\}/);
  assert.match(page, /chat\.realtimeType === "channel"/);
  assert.match(page, /data-realtime-metadata-count=/);
  assert.match(page, /data-realtime-selected-participant-count=/);
});

test("requests Tinode description, subscriber list, and history together", async () => {
  const realtime = await readFile(realtimeUrl, "utf8");

  assert.match(realtime, /export interface RealtimeChatMetadata/);
  assert.match(realtime, /private chatMetadata = new Map<string, RealtimeChatMetadata>/);
  assert.match(realtime, /what: "desc sub data"/);
  assert.match(realtime, /sub: \{[\s\S]*?limit: 100/);
  assert.match(realtime, /parseTinodeChatMetadata\(event\.data\)/);
  assert.match(
    realtime,
    /this\.subscribedTopics\.has\(metadata\.topic\)[\s\S]*?this\.attachingTopics\.has\(metadata\.topic\)/,
  );
  assert.match(realtime, /this\.clearChatMetadata\(\)/);
});
