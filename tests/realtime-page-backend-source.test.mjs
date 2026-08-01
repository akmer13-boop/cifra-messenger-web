import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);

test("uses Tinode as the only chat and message source in backend mode", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /filterChatsForRuntimeMode/);
  assert.match(page, /filterMessagesForRuntimeMode/);
  assert.match(page, /previousTopics\.size > 0 \|\| authMode === "backend"/);
  assert.match(
    page,
    /const withoutRealtimeTopics = canUseLocalChatFallback\(authMode\)[\s\S]*?: \[\];/,
  );
  assert.match(
    page,
    /const next = canUseLocalChatFallback\(authMode\) \? \{ \.\.\.current \} : \{\};/,
  );
  assert.match(page, /data-chat-source=/);
  assert.match(page, /data-local-chat-fallback=/);
});

test("does not create or publish local mock data in backend mode", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(
    page,
    /const openUserChat = async \(id: string\) => \{[\s\S]*?if \(canUseLocalChatFallback\(authMode\)\)[\s\S]*?const newChat: Chat[\s\S]*?realtimeClient\.openDirectConversation\(peerUserId/,
  );
  assert.match(
    page,
    /const createGroup = async \([\s\S]*?name: string,[\s\S]*?memberIds: string\[\],[\s\S]*?canUseLocalChatFallback\(authMode\)[\s\S]*?const newChat: Chat[\s\S]*?realtimeClient\.createGroup\(name, members\.resolved\)/,
  );
  assert.match(
    page,
    /realtimeClient\.isTopicSubscribed\(chatId\)[\s\S]*?publishText\(chatId, normalizedText, \{[\s\S]*?if \(!canUseLocalChatFallback\(authMode\)\) \{[\s\S]*?return false;[\s\S]*?const now = formatMessageTime\(\)/,
  );
  assert.match(
    page,
    /const clearMessages = \(chatId: string\) => \{\s*if \(!canUseLocalChatFallback\(authMode\)\) return;/,
  );
});

test("renders an empty conversation safely after a backend topic is removed", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(
    page,
    /const selectedChat = selectedChatId[\s\S]*?\? \(chatItems\.find\([\s\S]*?\?\? null\)[\s\S]*?: null;/,
  );
  assert.match(page, /\{selectedChat \? \([\s\S]*?<ChatView/);
  assert.match(page, /keepSelectedChatForRuntimeMode\(authMode, current, \[\]\)/);
});
