import assert from "node:assert/strict";
import test from "node:test";

import {
  buildComplianceAuditDataset,
  buildLocalAuditDataset,
} from "../app/audit-chat-policy.mjs";

const user = {
  id: "backend-morozov",
  backendId: "backend-morozov",
  realtimeUserId: "usrMorozov001",
  name: "Иван Морозов",
};

test("demo audit contains only chats where the selected employee participates", () => {
  const chats = [
    { id: "usrMorozov001", kind: "work", memberIds: ["usrMorozov001"] },
    { id: "usrOtherUser01", kind: "work", memberIds: ["usrOtherUser01"] },
    { id: "grpTeamAudit1", kind: "group", memberIds: ["usrMorozov001"] },
  ];
  const dataset = buildLocalAuditDataset(
    chats,
    {
      usrMorozov001: [{ id: 1, text: "one" }],
      usrOtherUser01: [{ id: 2, text: "two" }],
      grpTeamAudit1: [{ id: 3, text: "three" }],
    },
    user,
  );

  assert.deepEqual(dataset.chats.map((chat) => chat.id), [
    "usrMorozov001",
    "grpTeamAudit1",
  ]);
  assert.equal("usrOtherUser01" in dataset.messagesByChat, false);
  assert.equal(dataset.metadataOnly, false);
});

test("compliance audit groups real server metadata by topic without inventing content", () => {
  const dataset = buildComplianceAuditDataset(
    [
      {
        topic_id: "p2pAuditTopic1",
        seq: 2,
        sender_id: "backend-fillipov",
        client_msg_id: "two",
        kind: "text",
        created_at: "2026-08-01T10:02:00.000Z",
        deleted_at: null,
      },
      {
        topic_id: "p2pAuditTopic1",
        seq: 1,
        sender_id: "backend-morozov",
        client_msg_id: "one",
        kind: "text",
        created_at: "2026-08-01T10:01:00.000Z",
        deleted_at: null,
      },
    ],
    user,
  );

  assert.equal(dataset.metadataOnly, true);
  assert.equal(dataset.chats.length, 1);
  assert.equal(dataset.messagesByChat.p2pAuditTopic1[0].side, "out");
  assert.equal(dataset.messagesByChat.p2pAuditTopic1[1].side, "in");
  assert.match(dataset.messagesByChat.p2pAuditTopic1[0].text, /содержимое защищено/);
  assert.doesNotMatch(dataset.messagesByChat.p2pAuditTopic1[0].text, /one/);
});

