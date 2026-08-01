import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRealtimeDirectoryQueries,
  filterChatsForAuditUser,
  findDirectChatForUser,
  resolveRealtimeUserId,
} from "../app/direct-chat-policy.mjs";

const user = {
  id: "backend-morozov",
  backendId: "backend-morozov",
  realtimeUserId: "usrMorozov001",
  username: "i.morozov",
  email: "i.morozov@company.ru",
};

test("matches an existing direct topic through the employee realtime identity", () => {
  const chats = [
    {
      id: "grpProject001",
      kind: "group",
      memberIds: ["usrMorozov001"],
    },
    {
      id: "usrMorozov001",
      kind: "work",
      realtimeType: "direct",
      memberIds: ["usrMorozov001"],
    },
  ];

  assert.equal(resolveRealtimeUserId(user), "usrMorozov001");
  assert.equal(findDirectChatForUser(chats, user)?.id, "usrMorozov001");
});

test("never treats a group membership as the employee direct chat", () => {
  const chats = [
    {
      id: "grpProject001",
      kind: "group",
      realtimeType: "group",
      memberIds: ["usrMorozov001"],
    },
  ];

  assert.equal(findDirectChatForUser(chats, user), null);
  assert.deepEqual(filterChatsForAuditUser(chats, user), [chats[0]]);
});

test("continues a uniquely named direct chat when old metadata lacks member ids", () => {
  const chat = {
    id: "usrMorozov001",
    title: "Иван Морозов",
    kind: "personal",
    realtimeType: "direct",
  };
  const directoryUser = {
    id: "backend-morozov",
    backendId: "backend-morozov",
    name: "Иван Морозов",
  };

  assert.equal(findDirectChatForUser([chat], directoryUser), chat);
  assert.equal(findDirectChatForUser([chat, { ...chat, id: "usrDuplicate01" }], directoryUser), null);
});

test("builds bounded directory queries from corporate login and email", () => {
  assert.deepEqual(buildRealtimeDirectoryQueries(user), [
    "basic:i.morozov",
    "login:i.morozov",
    "i.morozov",
    "email:i.morozov@company.ru",
    "i.morozov@company.ru",
  ]);
});
