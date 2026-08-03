const UNKNOWN_PUBLISH_OUTCOME_CODES = new Set([
  "tinode_control_timeout",
  "websocket_failed",
  "websocket_closed_before_control",
  "realtime_connection_cancelled",
  "tinode_publish_seq_missing",
]);

/**
 * Once a WebSocket frame may have left the browser, several transport errors
 * cannot prove that the server rejected it. Retrying those automatically could
 * create a duplicate until client_msg_id deduplication is contracted.
 */
export function classifyRealtimePublishError(error) {
  const code =
    error && typeof error === "object" && typeof error.code === "string"
      ? error.code
      : "";
  return UNKNOWN_PUBLISH_OUTCOME_CODES.has(code) ? "unknown" : "failed";
}
