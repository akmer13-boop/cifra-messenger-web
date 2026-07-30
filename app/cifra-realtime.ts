export type RealtimeStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface RealtimeTicketResponse {
  readonly ticket: string;
  readonly expires_in: number;
  readonly expires_at: string;
  readonly channel: "tinode";
  readonly endpoint: {
    readonly url: string;
    readonly protocol: "tinode";
    readonly auth_scheme: "cifra";
    readonly ticket_transport: "login_secret";
    readonly ticket_encoding: "base64";
  };
}

interface TinodeControl {
  readonly id?: string;
  readonly code: number;
  readonly text?: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface RealtimeConnectParams {
  readonly apiBaseUrl: string;
  readonly accessToken: string;
  readonly deviceId: string;
}

type RealtimeStatusListener = (
  status: RealtimeStatus,
  error?: string,
) => void;

const REQUEST_TIMEOUT_MS = 15_000;
const TINODE_VERSION = "0.25";

export class CifraRealtimeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CifraRealtimeError";
  }
}

export class CifraRealtimeClient {
  private socket: WebSocket | null = null;
  private status: RealtimeStatus = "disconnected";
  private connectPromise: Promise<string> | null = null;
  private tinodeUserId: string | null = null;
  private connectionAttempt = 0;

  constructor(
    private readonly onStatus: RealtimeStatusListener = () => undefined,
  ) {}

  getStatus(): RealtimeStatus {
    return this.status;
  }

  getTinodeUserId(): string | null {
    return this.tinodeUserId;
  }

  isConnected(): boolean {
    return (
      this.status === "connected" &&
      this.socket?.readyState === WebSocket.OPEN
    );
  }

  async connect(params: RealtimeConnectParams): Promise<string> {
    if (this.isConnected() && this.tinodeUserId) {
      return this.tinodeUserId;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    const attempt = ++this.connectionAttempt;
    const connectPromise = this.connectInternal(params, attempt).finally(() => {
      if (this.connectPromise === connectPromise) {
        this.connectPromise = null;
      }
    });

    this.connectPromise = connectPromise;
    return connectPromise;
  }

  disconnect(): void {
    this.connectionAttempt += 1;
    this.connectPromise = null;

    const socket = this.socket;

    this.socket = null;
    this.tinodeUserId = null;

    if (
      socket &&
      socket.readyState !== WebSocket.CLOSED &&
      socket.readyState !== WebSocket.CLOSING
    ) {
      socket.close(1000, "client_logout");
    }

    this.setStatus("disconnected");
  }

  private async connectInternal(
    params: RealtimeConnectParams,
    attempt: number,
  ): Promise<string> {
    const previousSocket = this.socket;

    this.socket = null;
    this.tinodeUserId = null;

    if (
      previousSocket &&
      previousSocket.readyState !== WebSocket.CLOSED &&
      previousSocket.readyState !== WebSocket.CLOSING
    ) {
      previousSocket.close(1000, "client_reconnect");
    }

    this.setStatus("connecting");

    let attemptSocket: WebSocket | null = null;

    try {
      const ticket = await issueRealtimeTicket(
        params.apiBaseUrl,
        params.accessToken,
      );

      this.ensureActiveAttempt(attempt);

      validateEndpointSecurity(
        ticket.endpoint.url,
        ticket.ticket,
        params.accessToken,
        params.apiBaseUrl,
      );

      const socket = new WebSocket(ticket.endpoint.url);
      attemptSocket = socket;
      this.socket = socket;

      await waitForSocketOpen(socket);
      this.ensureActiveAttempt(attempt, socket);

      const hiId = createPacketId("hi");

      const hiControlPromise = waitForControl(socket, hiId);

      socket.send(
        JSON.stringify({
          hi: {
            id: hiId,
            ver: TINODE_VERSION,
            ua: "CIFRA-Web/0.1",
            dev: params.deviceId,
            lang: "ru",
            platf: "web",
          },
        }),
      );

      const hiControl = await hiControlPromise;
      this.ensureActiveAttempt(attempt, socket);

      if (
        hiControl.code !== 201 ||
        hiControl.params?.["ver"] !== TINODE_VERSION
      ) {
        throw new CifraRealtimeError("tinode_hi_rejected");
      }

      const loginId = createPacketId("login");

      const loginControlPromise = waitForControl(socket, loginId);

      socket.send(
        JSON.stringify({
          login: {
            id: loginId,
            scheme: "cifra",
            secret: btoa(ticket.ticket),
          },
        }),
      );

      const loginControl = await loginControlPromise;
      this.ensureActiveAttempt(attempt, socket);

      const user = loginControl.params?.["user"];
      const authLevel = loginControl.params?.["authlvl"];

      if (
        loginControl.code !== 200 ||
        typeof user !== "string" ||
        !/^usr[A-Za-z0-9_-]{11}$/.test(user) ||
        authLevel !== "auth"
      ) {
        throw new CifraRealtimeError("tinode_login_rejected");
      }

      if (
        loginControl.params &&
        ("token" in loginControl.params ||
          "expires" in loginControl.params)
      ) {
        throw new CifraRealtimeError(
          "tinode_reusable_token_exposed",
        );
      }

      socket.addEventListener("close", () => {
        if (this.socket === socket) {
          this.socket = null;
          this.tinodeUserId = null;
          this.setStatus("disconnected");
        }
      });

      socket.addEventListener("error", () => {
        if (this.socket === socket) {
          this.setStatus("error", "websocket_failed");
        }
      });

      this.ensureActiveAttempt(attempt, socket);
      this.tinodeUserId = user;
      this.setStatus("connected");

      return user;
    } catch (error) {
      const socket = attemptSocket;

      if (this.socket === socket) {
        this.socket = null;
        this.tinodeUserId = null;
      }

      if (
        socket &&
        socket.readyState !== WebSocket.CLOSED &&
        socket.readyState !== WebSocket.CLOSING
      ) {
        socket.close(1000, "connection_failed");
      }

      const code =
        error instanceof CifraRealtimeError
          ? error.code
          : "realtime_connection_failed";

      const cancelled =
        attempt !== this.connectionAttempt ||
        (error instanceof CifraRealtimeError &&
          error.code === "realtime_connection_cancelled");

      if (!cancelled) {
        this.setStatus("error", code);
      }

      throw error;
    }
  }

  private ensureActiveAttempt(
    attempt: number,
    socket?: WebSocket,
  ): void {
    if (attempt === this.connectionAttempt) {
      return;
    }

    if (
      socket &&
      socket.readyState !== WebSocket.CLOSED &&
      socket.readyState !== WebSocket.CLOSING
    ) {
      socket.close(1000, "connection_cancelled");
    }

    throw new CifraRealtimeError(
      "realtime_connection_cancelled",
    );
  }

  private setStatus(
    status: RealtimeStatus,
    error?: string,
  ): void {
    this.status = status;
    this.onStatus(status, error);
  }
}

export async function issueRealtimeTicket(
  apiBaseUrl: string,
  accessToken: string,
): Promise<RealtimeTicketResponse> {
  if (!accessToken.trim()) {
    throw new CifraRealtimeError("access_token_missing");
  }

  const baseUrl = apiBaseUrl.replace(/\/+$/, "");
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${baseUrl}/api/v1/realtime/tickets`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          channel: "tinode",
        }),
        redirect: "error",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new CifraRealtimeError(
        `realtime_ticket_http_${response.status}`,
      );
    }

    const payload: unknown = await response.json();

    if (!isRealtimeTicketResponse(payload)) {
      throw new CifraRealtimeError(
        "realtime_ticket_response_invalid",
      );
    }

    validateTicketExpiry(payload);

    return payload;
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      throw new CifraRealtimeError(
        "realtime_ticket_request_timeout",
      );
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function isRealtimeTicketResponse(
  value: unknown,
): value is RealtimeTicketResponse {
  if (!isRecord(value) || !isRecord(value["endpoint"])) {
    return false;
  }

  const endpoint = value["endpoint"];

  return (
    typeof value["ticket"] === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(value["ticket"]) &&
    typeof value["expires_in"] === "number" &&
    value["expires_in"] >= 5 &&
    value["expires_in"] <= 120 &&
    typeof value["expires_at"] === "string" &&
    value["channel"] === "tinode" &&
    typeof endpoint["url"] === "string" &&
    endpoint["protocol"] === "tinode" &&
    endpoint["auth_scheme"] === "cifra" &&
    endpoint["ticket_transport"] === "login_secret" &&
    endpoint["ticket_encoding"] === "base64"
  );
}

function validateTicketExpiry(
  ticket: RealtimeTicketResponse,
): void {
  const expiresAt = Date.parse(ticket.expires_at);
  const now = Date.now();

  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    expiresAt >
      now + ticket.expires_in * 1_000 + 5_000
  ) {
    throw new CifraRealtimeError(
      "realtime_ticket_expiry_invalid",
    );
  }
}

function validateEndpointSecurity(
  endpointValue: string,
  ticket: string,
  accessToken: string,
  apiBaseUrl: string,
): void {
  let endpoint: URL;

  try {
    endpoint = new URL(endpointValue);
  } catch {
    throw new CifraRealtimeError(
      "realtime_endpoint_invalid",
    );
  }

  if (
    endpoint.protocol !== "ws:" &&
    endpoint.protocol !== "wss:"
  ) {
    throw new CifraRealtimeError(
      "realtime_endpoint_protocol_invalid",
    );
  }

  const apiUrl = new URL(apiBaseUrl);

  if (
    apiUrl.protocol === "https:" &&
    endpoint.protocol !== "wss:"
  ) {
    throw new CifraRealtimeError(
      "realtime_endpoint_tls_required",
    );
  }

  if (
    endpoint.href.includes(ticket) ||
    endpoint.href.includes(accessToken)
  ) {
    throw new CifraRealtimeError(
      "secret_exposed_in_websocket_url",
    );
  }

  if (
    /(?:^|\.)amvera-[a-z0-9-]*-run-[a-z0-9-]*(?:\.|$)/i.test(
      endpoint.hostname,
    )
  ) {
    throw new CifraRealtimeError(
      "internal_realtime_endpoint_exposed",
    );
  }
}

function waitForSocketOpen(
  socket: WebSocket,
): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new CifraRealtimeError(
          "websocket_open_timeout",
        ),
      );
    }, REQUEST_TIMEOUT_MS);

    const onOpen = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(
        new CifraRealtimeError(
          "websocket_open_failed",
        ),
      );
    };

    const onClose = () => {
      cleanup();
      reject(
        new CifraRealtimeError(
          "websocket_closed_before_open",
        ),
      );
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

function waitForControl(
  socket: WebSocket,
  expectedId: string,
): Promise<TinodeControl> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new CifraRealtimeError(
          "tinode_control_timeout",
        ),
      );
    }, REQUEST_TIMEOUT_MS);

    const onMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") {
        return;
      }

      const control = parseTinodeControl(event.data);

      if (!control || control.id !== expectedId) {
        return;
      }

      cleanup();
      resolve(control);
    };

    const onError = () => {
      cleanup();
      reject(
        new CifraRealtimeError(
          "websocket_failed",
        ),
      );
    };

    const onClose = () => {
      cleanup();
      reject(
        new CifraRealtimeError(
          "websocket_closed_before_control",
        ),
      );
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };

    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

function parseTinodeControl(
  raw: string,
): TinodeControl | null {
  try {
    const parsed: unknown = JSON.parse(raw);

    if (
      !isRecord(parsed) ||
      !isRecord(parsed["ctrl"])
    ) {
      return null;
    }

    const ctrl = parsed["ctrl"];

    if (typeof ctrl["code"] !== "number") {
      return null;
    }

    return {
      ...(typeof ctrl["id"] === "string"
        ? { id: ctrl["id"] }
        : {}),
      code: ctrl["code"],
      ...(typeof ctrl["text"] === "string"
        ? { text: ctrl["text"] }
        : {}),
      ...(isRecord(ctrl["params"])
        ? { params: ctrl["params"] }
        : {}),
    };
  } catch {
    return null;
  }
}

function createPacketId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}
