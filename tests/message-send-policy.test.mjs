import assert from "node:assert/strict";
import test from "node:test";

import { classifyRealtimePublishError } from "../app/message-send-policy.mjs";

test("treats post-send transport ambiguity as an unknown delivery result", () => {
  for (const code of [
    "tinode_control_timeout",
    "websocket_failed",
    "websocket_closed_before_control",
    "realtime_connection_cancelled",
    "tinode_publish_seq_missing",
  ]) {
    assert.equal(classifyRealtimePublishError({ code }), "unknown", code);
  }
});

test("allows a manual retry only for definitive pre-send or server failures", () => {
  assert.equal(
    classifyRealtimePublishError({ code: "realtime_not_connected" }),
    "failed",
  );
  assert.equal(
    classifyRealtimePublishError({ code: "tinode_publish_rejected" }),
    "failed",
  );
  assert.equal(classifyRealtimePublishError(new Error("network")), "failed");
});
