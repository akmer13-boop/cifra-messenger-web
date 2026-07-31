import assert from "node:assert/strict";
import test from "node:test";

import {
  getReadableRealtimeSubscriptions,
  resolveRealtimeObservedTopic,
} from "../app/realtime-multi-chat-policy.mjs";

test("keeps every unique readable Tinode chat subscription", () => {
  const subscriptions = [
    { topic: "usrDirectChat01", access: { mode: "JRWPA" } },
    { topic: "grpTeamChat001", access: { mode: "JR" } },
    { topic: "chnReadOnly01", access: { mode: "J" } },
    { topic: "usrDirectChat01", access: { mode: "JRWPA" } },
    { topic: "grpNoModeChat" },
    null,
  ];

  assert.deepEqual(
    getReadableRealtimeSubscriptions(subscriptions).map(
      (subscription) => subscription.topic,
    ),
    ["usrDirectChat01", "grpTeamChat001", "grpNoModeChat"],
  );
});

test("selects the opened attached topic before the previous observed topic", () => {
  const attached = ["usrDirectChat01", "grpTeamChat001"];

  assert.equal(
    resolveRealtimeObservedTopic(
      "grpTeamChat001",
      "usrDirectChat01",
      attached,
    ),
    "grpTeamChat001",
  );
  assert.equal(
    resolveRealtimeObservedTopic("mock-chat", "usrDirectChat01", attached),
    "usrDirectChat01",
  );
  assert.equal(
    resolveRealtimeObservedTopic("mock-chat", "missing", attached),
    "usrDirectChat01",
  );
  assert.equal(resolveRealtimeObservedTopic(null, null, []), null);
});
