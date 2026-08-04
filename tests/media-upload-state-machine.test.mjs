import assert from "node:assert/strict";
import test from "node:test";

import {
  assertMediaUploadTransition,
  canTransitionMediaUpload,
  isTerminalMediaUploadPhase,
} from "../lib/media/upload-state-machine.mjs";

test("permits the protected upload happy path", () => {
  const phases = [
    "idle",
    "analyzing",
    "creating",
    "encrypting",
    "uploading",
    "completing",
    "processing",
    "ready",
  ];
  phases.slice(1).forEach((phase, index) => {
    assert.equal(canTransitionMediaUpload(phases[index], phase), true);
    assert.doesNotThrow(() => assertMediaUploadTransition(phases[index], phase));
  });
  assert.equal(isTerminalMediaUploadPhase("ready"), true);
});

test("only retries a failed operation into a persisted resume phase", () => {
  assert.equal(canTransitionMediaUpload("failed", "uploading"), true);
  assert.equal(canTransitionMediaUpload("failed", "processing"), true);
  assert.equal(canTransitionMediaUpload("failed", "encrypting"), false);
  assert.throws(
    () => assertMediaUploadTransition("ready", "uploading"),
    /Invalid media upload transition/,
  );
});

