import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);

test("people, search, compose and admin profile share one direct-chat route", async () => {
  const page = await readFile(pageUrl, "utf8");
  const start = page.indexOf("const openUserChat = async");
  const end = page.indexOf("const getApiClient", start);
  const handler = page.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(page, /onMessageUser=\{openUserChat\}/);
  assert.match(page, /onMessage=\{openUserChat\}/);
  assert.match(page, /onSelect=\{openUserChat\}/);
  assert.match(page, /onMessage=\{\(id\) => \{[\s\S]*?openUserChat\(id\)/);
  assert.match(handler, /findDirectChatForUser\(chatItems, user\)/);
  assert.match(handler, /findUserByDirectoryQueries\(/);
  assert.match(handler, /openDirectConversation\(peerUserId/);
  assert.doesNotMatch(handler, /role === "employee"|role === "admin"/);
});

test("opening any conversation switches from People to Chats", async () => {
  const page = await readFile(pageUrl, "utf8");
  const start = page.indexOf("const openChat = (id: string)");
  const end = page.indexOf("const openUserChat", start);
  const handler = page.slice(start, end);

  assert.match(handler, /setActiveTab\("chats"\)/);
  assert.match(handler, /setSelectedChatId\(id\)/);
  assert.match(handler, /setSelectedProfileUserId\(null\)/);
});

