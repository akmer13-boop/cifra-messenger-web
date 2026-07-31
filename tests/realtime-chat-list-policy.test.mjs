import assert from "node:assert/strict";
import test from "node:test";

import {
  getLatestIncomingRealtimeSeq,
  getLatestRealtimeSeq,
  getRealtimeUnreadCount,
} from "../app/realtime-chat-list-policy.mjs";

const messages = [
  { topic: "usr-chat", seq: 2, from: "usr-self" },
  { topic: "usr-chat", seq: 3, from: "usr-peer" },
  { topic: "usr-chat", seq: 5, from: "usr-peer" },
  { topic: "grp-other", seq: 99, from: "usr-peer" },
];

test("finds the latest server and incoming sequence for one topic", () => {
  assert.equal(getLatestRealtimeSeq(messages, "usr-chat", 4), 5);
  assert.equal(
    getLatestIncomingRealtimeSeq(messages, "usr-chat", "usr-self"),
    5,
  );
});

test("counts only unread incoming messages after the local read watermark", () => {
  assert.equal(
    getRealtimeUnreadCount(messages, "usr-chat", "usr-self", 2, 5),
    3,
  );
  assert.equal(
    getRealtimeUnreadCount(messages, "usr-chat", "usr-self", 3, 5),
    2,
  );
  assert.equal(
    getRealtimeUnreadCount(messages, "usr-chat", "usr-self", 5, 5),
    0,
  );
});

test("ignores malformed sequences and messages from other topics", () => {
  const malformed = [
    ...messages,
    { topic: "usr-chat", seq: -1, from: "usr-peer" },
    { topic: "usr-chat", seq: "8", from: "usr-peer" },
  ];

  assert.equal(getLatestRealtimeSeq(malformed, "usr-chat"), 5);
  assert.equal(
    getRealtimeUnreadCount(malformed, "usr-chat", "usr-self", 3),
    1,
  );
});


test("uses the topic sequence as a fallback when older unread history is not loaded", () => {
  const partialHistory = [
    { topic: "usr-chat", seq: 10, from: "usr-peer" },
  ];

  assert.equal(
    getRealtimeUnreadCount(partialHistory, "usr-chat", "usr-self", 6, 10),
    4,
  );
});
