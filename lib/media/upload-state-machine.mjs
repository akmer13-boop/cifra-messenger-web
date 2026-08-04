// @ts-check

export const MEDIA_UPLOAD_PHASES = [
  "idle",
  "analyzing",
  "creating",
  "encrypting",
  "uploading",
  "completing",
  "processing",
  "ready",
  "rejected",
  "failed",
  "expired",
  "cancelled",
];

const TERMINAL_PHASES = new Set([
  "ready",
  "rejected",
  "expired",
  "cancelled",
]);

/** @type {Record<string, readonly string[]>} */
const ALLOWED_TRANSITIONS = {
  idle: ["analyzing", "uploading", "processing"],
  analyzing: ["creating", "failed", "cancelled"],
  creating: ["encrypting", "failed", "cancelled"],
  encrypting: ["uploading", "failed", "cancelled"],
  uploading: ["completing", "failed", "expired", "cancelled"],
  completing: ["processing", "failed", "expired", "cancelled"],
  processing: ["ready", "rejected", "failed", "expired", "cancelled"],
  ready: [],
  rejected: [],
  failed: ["uploading", "processing", "cancelled"],
  expired: [],
  cancelled: [],
};

/**
 * @param {string} value
 */
export function isMediaUploadPhase(value) {
  return MEDIA_UPLOAD_PHASES.includes(value);
}

/**
 * @param {string} phase
 */
export function isTerminalMediaUploadPhase(phase) {
  return TERMINAL_PHASES.has(phase);
}

/**
 * @param {string} current
 * @param {string} next
 */
export function canTransitionMediaUpload(current, next) {
  const allowed = ALLOWED_TRANSITIONS[current];
  return Array.isArray(allowed) && allowed.includes(next);
}

/**
 * @param {string} current
 * @param {string} next
 */
export function assertMediaUploadTransition(current, next) {
  if (!canTransitionMediaUpload(current, next)) {
    throw new Error(`Invalid media upload transition: ${current} -> ${next}`);
  }
}
