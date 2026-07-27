import assert from "node:assert/strict";
import test from "node:test";

import {
  clampSwipeOffset,
  getSwipeActionState,
  snapSwipeOffset,
  SWIPE_MAX_RATIO,
} from "../app/swipe-policy.mjs";

const width = 300;

test("limits both swipe directions to 40 percent of the row", () => {
  assert.equal(clampSwipeOffset(-999, width), -width * SWIPE_MAX_RATIO);
  assert.equal(clampSwipeOffset(999, width), width * SWIPE_MAX_RATIO);
});

test("reveals left actions only at 20, 33 and 40 percent", () => {
  assert.deepEqual(
    {
      mute: getSwipeActionState(-width * 0.19, width).showMute,
      delete: getSwipeActionState(-width * 0.32, width).showDelete,
      archive: getSwipeActionState(-width * 0.39, width).showArchive,
    },
    { mute: false, delete: false, archive: false },
  );

  assert.equal(getSwipeActionState(-width * 0.2, width).showMute, true);
  assert.equal(getSwipeActionState(-width * 0.33, width).showDelete, true);
  assert.equal(getSwipeActionState(-width * 0.4, width).showArchive, true);
});

test("reveals pin at 20 percent and snaps to supported stops", () => {
  assert.equal(getSwipeActionState(width * 0.19, width).showPin, false);
  assert.equal(getSwipeActionState(width * 0.2, width).showPin, true);
  assert.equal(snapSwipeOffset(width * 0.25, width), width * 0.2);
  assert.equal(snapSwipeOffset(width * 0.25, width, false), 0);
  assert.equal(snapSwipeOffset(-width * 0.35, width), -width * 0.33);
  assert.equal(snapSwipeOffset(-width * 0.4, width), -width * 0.4);
});
