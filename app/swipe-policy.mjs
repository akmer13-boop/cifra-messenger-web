export const SWIPE_MAX_RATIO = 0.4;

export const SWIPE_THRESHOLDS = Object.freeze({
  mute: 0.2,
  delete: 0.33,
  archive: 0.4,
  pin: 0.2,
});

const THRESHOLD_EPSILON = 0.000001;

function normalizedWidth(width) {
  return Math.max(Number.isFinite(width) ? width : 0, 1);
}

function reaches(value, threshold) {
  return value + THRESHOLD_EPSILON >= threshold;
}

export function clampSwipeOffset(offset, width) {
  const limit = normalizedWidth(width) * SWIPE_MAX_RATIO;
  return Math.max(-limit, Math.min(limit, offset));
}

export function getSwipeActionState(offset, width, pinEnabled = true) {
  const ratio = Math.min(
    Math.abs(offset) / normalizedWidth(width),
    SWIPE_MAX_RATIO,
  );
  const swipingLeft = offset < 0;
  const swipingRight = offset > 0;

  return {
    ratio,
    swipingLeft,
    swipingRight,
    showMute: swipingLeft && reaches(ratio, SWIPE_THRESHOLDS.mute),
    showDelete: swipingLeft && reaches(ratio, SWIPE_THRESHOLDS.delete),
    showArchive: swipingLeft && reaches(ratio, SWIPE_THRESHOLDS.archive),
    showPin:
      pinEnabled &&
      swipingRight &&
      reaches(ratio, SWIPE_THRESHOLDS.pin),
  };
}

export function snapSwipeOffset(offset, width, pinEnabled = true) {
  const safeWidth = normalizedWidth(width);
  const { ratio } = getSwipeActionState(offset, safeWidth);

  if (offset < 0) {
    const snapRatio = reaches(ratio, SWIPE_THRESHOLDS.archive)
      ? SWIPE_THRESHOLDS.archive
      : reaches(ratio, SWIPE_THRESHOLDS.delete)
        ? SWIPE_THRESHOLDS.delete
        : reaches(ratio, SWIPE_THRESHOLDS.mute)
          ? SWIPE_THRESHOLDS.mute
          : 0;
    return -safeWidth * snapRatio;
  }

  return (
    pinEnabled &&
    offset > 0 &&
    reaches(ratio, SWIPE_THRESHOLDS.pin)
  )
    ? safeWidth * SWIPE_THRESHOLDS.pin
    : 0;
}
