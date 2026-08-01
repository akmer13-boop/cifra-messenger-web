import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRealtimeDirectoryQueries,
  filterChatsForAuditUser,
  findDirectChatForUser,
  findDirectRealtimeTopicForUser,
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

test("continues the existing m.fillipov chat when REST and realtime names use different separators", () => {
  const existingChat = {
    id: "usrnx1K5ZRG1qg",
    title: "m.fillipov",
    kind: "personal",
    realtimeType: "direct",
  };
  const directoryUser = {
    id: "4f966cd1-922d-46d2-9081-9e271ca59fc6",
    backendId: "4f966cd1-922d-46d2-9081-9e271ca59fc6",
    name: "m fillipov",
    username: "m.fillipov",
  };

  assert.equal(findDirectChatForUser([existingChat], directoryUser), existingChat);
});

test("resolves an existing direct topic from raw realtime subscriptions before directory search", () => {
  const directoryUser = {
    id: "4f966cd1-922d-46d2-9081-9e271ca59fc6",
    backendId: "4f966cd1-922d-46d2-9081-9e271ca59fc6",
    name: "m fillipov",
    username: "m.fillipov",
    email: "m.fillipov@company.ru",
  };
  const subscriptions = [
    {
      topic: "usrnx1K5ZRG1qg",
      public: { fn: "m.fillipov" },
    },
    {
      topic: "usrAnotherPerson02",
      public: { fn: "Другой сотрудник" },
    },
  ];

  assert.equal(
    findDirectRealtimeTopicForUser(
      subscriptions,
      [],
      directoryUser,
      "usrQlEX4mFC0BQ",
    ),
    "usrnx1K5ZRG1qg",
  );
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
