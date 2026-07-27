import { backendConfig, validateBackendConfig } from "./config";
import type { LoginRequest } from "./contracts";

export class CifraApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "CifraApiError";
  }
}

type RequestOptions = RequestInit & {
  accessToken?: string;
};

export async function cifraRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  validateBackendConfig();

  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  if (options.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (options.accessToken) {
    headers.set("authorization", `Bearer ${options.accessToken}`);
  }

  const response = await fetch(
    new URL(path, `${backendConfig.apiBaseUrl.replace(/\/$/, "")}/`),
    {
      ...options,
      headers,
      cache: "no-store",
    },
  );

  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new CifraApiError(
      `CIFRA API вернул ${response.status}`,
      response.status,
      body,
    );
  }

  return body as T;
}

export function checkBackendReady() {
  return cifraRequest<unknown>("/health/ready");
}

export function login(payload: LoginRequest) {
  return cifraRequest<unknown>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
