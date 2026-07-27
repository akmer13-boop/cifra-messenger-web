export type DataMode = "mock" | "api";

const configuredMode: DataMode =
  process.env.NEXT_PUBLIC_DATA_MODE === "api" ? "api" : "mock";

export const backendConfig = Object.freeze({
  dataMode: configuredMode,
  apiBaseUrl: process.env.NEXT_PUBLIC_CIFRA_API_URL?.trim() ?? "",
  cifraWebSocketUrl:
    process.env.NEXT_PUBLIC_CIFRA_WS_URL?.trim() ?? "",
  tinodeWebSocketUrl:
    process.env.NEXT_PUBLIC_TINODE_WS_URL?.trim() ?? "",
});

export function validateBackendConfig() {
  if (backendConfig.dataMode === "mock") return;

  const missing = [
    ["NEXT_PUBLIC_CIFRA_API_URL", backendConfig.apiBaseUrl],
    ["NEXT_PUBLIC_CIFRA_WS_URL", backendConfig.cifraWebSocketUrl],
    ["NEXT_PUBLIC_TINODE_WS_URL", backendConfig.tinodeWebSocketUrl],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Не заданы переменные подключения CIFRA: ${missing.join(", ")}`,
    );
  }
}
