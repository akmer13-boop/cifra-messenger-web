import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRealtimeParticipantProfiles,
  getRealtimeAvatarUrl,
  getRealtimeDisplayName,
  getRealtimeInitials,
  getRealtimeTopicType,
  projectRealtimeChatMetadata,
} from "../app/realtime-chat-metadata-policy.mjs";

test("projects direct, group, and channel metadata into safe chat UI fields", () => {
  assert.equal(getRealtimeTopicType("usrZyXwVuTsR10"), "direct");
  assert.equal(getRealtimeTopicType("grpAbCdEfGhI12"), "group");
  assert.equal(getRealtimeTopicType("chnAbCdEfGhI12"), "channel");

  assert.equal(
    getRealtimeDisplayName({ fn: "  Анна Смирнова  " }, undefined, "fallback"),
    "Анна Смирнова",
  );
  assert.equal(getRealtimeInitials("Анна Смирнова"), "АС");

  const direct = projectRealtimeChatMetadata(
    {
      topic: "usrZyXwVuTsR10",
      public: { fn: "Старое имя" },
    },
    {
      topic: "usrZyXwVuTsR10",
      kind: "direct",
      public: {
        fn: "Анна Смирнова",
        photo: { ref: "https://media.example.test/avatar.jpg" },
      },
      participants: [
        {
          userId: "usrAbCdEfGhI12",
          public: { fn: "Текущий пользователь" },
        },
        {
          userId: "usrZyXwVuTsR10",
          public: { fn: "Анна Смирнова" },
          online: true,
        },
        {
          userId: "usrZyXwVuTsR10",
          public: { fn: "Дубликат" },
        },
      ],
    },
    "usrAbCdEfGhI12",
  );

  assert.deepEqual(direct, {
    title: "Анна Смирнова",
    avatar: "АС",
    avatarUrl: "https://media.example.test/avatar.jpg",
    type: "direct",
    kind: "personal",
    memberIds: ["usrZyXwVuTsR10"],
    participants: [
      {
        id: "usrZyXwVuTsR10",
        name: "Анна Смирнова",
        avatar: "АС",
        avatarUrl: undefined,
        online: true,
      },
    ],
  });

  const group = projectRealtimeChatMetadata(
    { topic: "grpAbCdEfGhI12" },
    {
      topic: "grpAbCdEfGhI12",
      kind: "group",
      private: { comment: "Проект Север" },
      participants: [],
    },
    "usrAbCdEfGhI12",
  );
  assert.equal(group.title, "Проект Север");
  assert.equal(group.type, "group");
  assert.equal(group.kind, "group");

  const channel = projectRealtimeChatMetadata(
    { topic: "chnAbCdEfGhI12" },
    undefined,
    "usrAbCdEfGhI12",
  );
  assert.equal(channel.title, "Канал Tinode");
  assert.equal(channel.type, "channel");
  assert.equal(channel.kind, "group");
});

test("normalizes supported avatars and rejects unsafe image sources", () => {
  assert.equal(
    getRealtimeAvatarUrl({ photo: "/api/v1/media/avatar.png" }),
    "/api/v1/media/avatar.png",
  );
  assert.equal(
    getRealtimeAvatarUrl({ avatar: { type: "image/png", data: "QUJDRA==" } }),
    "data:image/png;base64,QUJDRA==",
  );
  assert.equal(
    getRealtimeAvatarUrl({ image: "data:image/webp;base64,QUJDRA==" }),
    "data:image/webp;base64,QUJDRA==",
  );
  assert.equal(
    getRealtimeAvatarUrl({ photo: "javascript:alert(1)" }),
    undefined,
  );
  assert.equal(
    getRealtimeAvatarUrl({ photo: "//outside.example.test/avatar.png" }),
    undefined,
  );
  assert.equal(
    getRealtimeAvatarUrl({ photo: "data:image/svg+xml;base64,PHN2Zz4=" }),
    undefined,
  );
});

test("builds unique participant profiles and excludes the current user", () => {
  const profiles = buildRealtimeParticipantProfiles(
    {
      participants: [
        { userId: "usrAbCdEfGhI12", public: { fn: "Я" } },
        {
          userId: "usrMemberOne12",
          public: {
            fn: "Иван Петров",
            photo: { type: "image/jpeg", data: "QUJDRA==" },
          },
          online: true,
        },
        { userId: "usrMemberOne12", public: { fn: "Дубликат" } },
        { userId: "usrMemberTwo34", private: { name: "Мария" } },
      ],
    },
    "usrAbCdEfGhI12",
  );

  assert.deepEqual(profiles, [
    {
      id: "usrMemberOne12",
      name: "Иван Петров",
      avatar: "ИП",
      avatarUrl: "data:image/jpeg;base64,QUJDRA==",
      online: true,
    },
    {
      id: "usrMemberTwo34",
      name: "Мария",
      avatar: "М",
      avatarUrl: undefined,
      online: false,
    },
  ]);
});
