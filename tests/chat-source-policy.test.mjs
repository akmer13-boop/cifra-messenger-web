import assert from "node:assert/strict";
import test from "node:test";

import {
  canUseLocalChatFallback,
  filterChatsForRuntimeMode,
  filterMessagesForRuntimeMode,
  keepSelectedChatForRuntimeMode,
} from "../app/chat-source-policy.mjs";

test("keeps demo chats only in demo mode and real topics only in backend mode", () => {
  const chats = [
    { id: "product", title: "Demo" },
    { id: "usrReal001", title: "Real direct" },
    { id: "grpReal001", title: "Real group" },
  ];

  assert.equal(filterChatsForRuntimeMode("demo", chats, []).length, 3);
  assert.deepEqual(
    filterChatsForRuntimeMode("backend", chats, [
      "usrReal001",
      "grpReal001",
    ]).map((chat) => chat.id),
    ["usrReal001", "grpReal001"],
  );
  assert.deepEqual(filterChatsForRuntimeMode("backend", chats, []), []);
});

test("keeps only Tinode message histories in backend mode", () => {
  const messages = {
    product: [{ id: 1, text: "Demo" }],
    usrReal001: [{ id: 2, text: "Real" }],
  };

  assert.equal(filterMessagesForRuntimeMode("demo", messages, {}), messages);
  assert.deepEqual(
    filterMessagesForRuntimeMode("backend", messages, ["usrReal001"]),
    { usrReal001: messages.usrReal001 },
  );
  assert.deepEqual(filterMessagesForRuntimeMode("backend", messages, []), {});
});

test("drops stale selected chats when backend topics disappear", () => {
  assert.equal(
    keepSelectedChatForRuntimeMode("backend", "usrReal001", [
      "usrReal001",
    ]),
    "usrReal001",
  );
  assert.equal(
    keepSelectedChatForRuntimeMode("backend", "product", ["usrReal001"]),
    null,
  );
  assert.equal(
    keepSelectedChatForRuntimeMode("demo", "product", []),
    "product",
  );
});

test("allows local chat simulation only in demo mode", () => {
  assert.equal(canUseLocalChatFallback("demo"), true);
  assert.equal(canUseLocalChatFallback("backend"), false);
});
