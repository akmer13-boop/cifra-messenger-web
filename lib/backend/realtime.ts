import { backendConfig, validateBackendConfig } from "./config";

export type RealtimeChannel = "cifra" | "tinode";

export function openRealtimeSocket(channel: RealtimeChannel) {
  validateBackendConfig();

  const url =
    channel === "tinode"
      ? backendConfig.tinodeWebSocketUrl
      : backendConfig.cifraWebSocketUrl;

  return new WebSocket(url);
}
