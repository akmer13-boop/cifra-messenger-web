import { primaryRole, wireRole } from "./auth-policy.mjs";

export type RuntimeMode = "demo" | "backend";
export type CorporateRole = "employee" | "admin" | "security_moderator";
export type UserRole = "employee" | "admin" | "moderator";

export interface RuntimeConfig {
  mode: RuntimeMode;
  apiBaseUrl: string;
  requestTimeoutMs: number;
  demoMfaCode: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  session_id: string;
  must_change_password: boolean;
}

export interface AuthContext {
  user_id: string;
  session_id: string;
  roles: CorporateRole[];
  must_change_password: boolean;
}

export interface AuthSession {
  login: string;
  tokens: AuthTokens;
  context: AuthContext;
  role: UserRole;
}

export interface MfaChallenge {
  kind: "mfa_required";
  challengeToken: string;
  expiresIn: number;
}

export interface AuthenticatedLogin {
  kind: "authenticated";
  session: AuthSession;
}

export type LoginOutcome = MfaChallenge | AuthenticatedLogin;

export interface BackendUser {
  id: string;
  /** Forward-compatible identity fields for a backend directory projection. */
  realtime_user_id?: string | null;
  tinode_uid?: string | null;
  login: string;
  first_name: string;
  last_name: string;
  middle_name: string | null;
  email: string | null;
  phone: string | null;
  department: string | null;
  job_title: string | null;
  status:
    | "active"
    | "inactive"
    | "blocked"
    | "deleted"
    | "invited"
    | "disabled"
    | "archived";
  roles: CorporateRole[];
  version: number;
  created_at: string;
  updated_at: string;
}

export interface UserPage {
  items: BackendUser[];
  next_cursor: string | null;
}

export interface ComplianceMessageMetadata {
  topic_id: string;
  seq: number;
  sender_id: string | null;
  client_msg_id: string | null;
  kind: string;
  created_at: string;
  deleted_at: string | null;
}

export interface ComplianceSearchResponse {
  items: ComplianceMessageMetadata[];
  next_cursor?: string | null;
  protected_text_search_available?: false;
}

export interface ComplianceSearchInput {
  reason: string;
  author_id?: string;
  topic_id?: string;
  limit?: number;
  cursor?: string;
}

export interface CreateUserInput {
  login: string;
  first_name: string;
  last_name: string;
  middle_name?: string;
  email?: string;
  phone?: string;
  department?: string;
  job_title?: string;
  roles?: CorporateRole[];
  temporary_password?: string;
}

export interface UpdateUserInput {
  first_name?: string;
  last_name?: string;
  middle_name?: string | null;
  email?: string | null;
  phone?: string | null;
  department?: string | null;
  job_title?: string | null;
  status?: "active" | "inactive" | "blocked" | "archived";
  reason: string;
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
    request_id?: string;
    retryable?: boolean;
  };
}

interface StoredSession {
  login: string;
  tokens: AuthTokens;
  context: AuthContext;
}

const SESSION_KEY = "cifra-auth-session-v1";
const DEVICE_KEY = "cifra-browser-device-id-v1";
const REFRESHABLE_ACCESS_ERRORS = new Set([
  "AUTH_REQUIRED",
  "ACCESS_TOKEN_INVALID",
]);
const DEFAULT_CONFIG: RuntimeConfig = {
  mode: "demo",
  apiBaseUrl: "",
  requestTimeoutMs: 15_000,
  demoMfaCode: "111111",
};

let runtimeConfigPromise: Promise<RuntimeConfig> | null = null;

export class CifraApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
    readonly retryable = false,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CifraApiError";
  }
}

export function loadRuntimeConfig(): Promise<RuntimeConfig> {
  runtimeConfigPromise ??= fetch("/cifra-runtime-config.json", {
    cache: "no-store",
  })
    .then(async (response) => {
      if (!response.ok) return DEFAULT_CONFIG;
      const raw = (await response.json()) as Partial<RuntimeConfig>;
      if (raw.mode !== "demo" && raw.mode !== "backend") {
        throw new Error("Некорректный mode в cifra-runtime-config.json");
      }
      return {
        mode: raw.mode,
        apiBaseUrl: normalizeApiBase(raw.apiBaseUrl ?? ""),
        requestTimeoutMs: clampTimeout(raw.requestTimeoutMs),
        demoMfaCode:
          typeof raw.demoMfaCode === "string" && raw.demoMfaCode
            ? raw.demoMfaCode
            : DEFAULT_CONFIG.demoMfaCode,
      };
    })
    .catch((error: unknown) => {
      if (error instanceof Error && error.message.includes("mode")) {
        throw error;
      }
      return DEFAULT_CONFIG;
    });
  return runtimeConfigPromise;
}

export class CifraApiClient {
  private session: AuthSession | null = null;
  private refreshInFlight: Promise<AuthSession> | null = null;

  constructor(readonly config: RuntimeConfig) {}
  
get currentDeviceId(): string {
  return browserDevice().id;
}
  get mode(): RuntimeMode {
    return this.config.mode;
  }

  get currentSession(): AuthSession | null {
    return this.session;
  }

  async login(login: string, password: string): Promise<LoginOutcome> {
    const normalizedLogin = login.trim();
    if (this.mode === "demo") {
      if (!normalizedLogin || !password) {
        throw new CifraApiError(
          "Введите логин и пароль",
          400,
          "VALIDATION_ERROR",
        );
      }
      return {
        kind: "mfa_required",
        challengeToken: `demo:${normalizedLogin}`,
        expiresIn: 300,
      };
    }

    const response = await this.fetchJson<
      | AuthTokens
      | {
          mfa_required: true;
          challenge_token: string;
          expires_in: number;
        }
    >("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        login: normalizedLogin,
        password,
        device: browserDevice(),
      }),
    });
    if ("mfa_required" in response) {
      return {
        kind: "mfa_required",
        challengeToken: response.challenge_token,
        expiresIn: response.expires_in,
      };
    }
    return {
      kind: "authenticated",
      session: await this.acceptTokens(normalizedLogin, response),
    };
  }

  async verifyMfa(
    login: string,
    challengeToken: string,
    code: string,
  ): Promise<AuthSession> {
    if (this.mode === "demo") {
      if (code !== this.config.demoMfaCode) {
        throw new CifraApiError(
          "Неверный код. Попробуйте ещё раз.",
          401,
          "MFA_CODE_INVALID",
        );
      }
      const role = demoRoleForLogin(login);
      const wireRoles = role === "employee"
        ? ["employee"]
        : ["employee", wireRole(role)];
      const session: AuthSession = {
        login,
        role,
        tokens: {
          access_token: "demo-access-token",
          refresh_token: "demo-refresh-token",
          token_type: "Bearer",
          expires_in: 86_400,
          session_id: "00000000-0000-4000-8000-000000000001",
          must_change_password: false,
        },
        context: {
          user_id: "00000000-0000-4000-8000-000000000001",
          session_id: "00000000-0000-4000-8000-000000000001",
          roles: wireRoles as CorporateRole[],
          must_change_password: false,
        },
      };
      this.setSession(session);
      return session;
    }

    const tokens = await this.fetchJson<AuthTokens>(
      "/api/v1/auth/mfa/verify",
      {
        method: "POST",
        body: JSON.stringify({
          challenge_token: challengeToken,
          code,
        }),
      },
    );
    return this.acceptTokens(login, tokens);
  }

  async restoreSession(): Promise<AuthSession | null> {
    const stored = readStoredSession();
    if (!stored) return null;
    if (this.mode === "demo") {
      const restored: AuthSession = {
        ...stored,
        role: primaryRole(stored.context.roles) as UserRole,
      };
      this.session = restored;
      return restored;
    }
    this.session = {
      ...stored,
      role: primaryRole(stored.context.roles) as UserRole,
    };
    try {
      const context = await this.authorizedFetch<AuthContext>(
        "/api/v1/auth/context",
      );
      const restored = {
        ...this.session,
        context,
        role: primaryRole(context.roles) as UserRole,
      };
      this.setSession(restored);
      return restored;
    } catch (error) {
      if (error instanceof CifraApiError && error.status === 401) {
        try {
          return await this.refresh();
        } catch {
          this.clearSession();
          return null;
        }
      }
      throw error;
    }
  }

  async logout(): Promise<void> {
    const active = this.session;
    try {
      if (this.mode === "backend" && active) {
        await this.authorizedFetch<void>("/api/v1/auth/logout", {
          method: "POST",
        });
      }
    } finally {
      this.clearSession();
    }
  }

  async listUsers(query = ""): Promise<UserPage> {
    const params = new URLSearchParams({ limit: "100" });
    if (query.trim()) params.set("query", query.trim());
    return this.request<UserPage>(`/api/v1/users?${params.toString()}`);
  }

  async createUser(input: CreateUserInput): Promise<BackendUser> {
    return this.request<BackendUser>("/api/v1/admin/users", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(input),
    });
  }

  async updateUser(
    userId: string,
    version: number,
    input: UpdateUserInput,
  ): Promise<BackendUser> {
    return this.request<BackendUser>(
      `/api/v1/admin/users/${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        headers: { "If-Match": String(version) },
        body: JSON.stringify(input),
      },
    );
  }

  async setUserRoles(
    userId: string,
    roles: CorporateRole[],
    reason: string,
  ): Promise<BackendUser> {
    return this.request<BackendUser>(
      `/api/v1/admin/users/${encodeURIComponent(userId)}/roles`,
      {
        method: "PUT",
        body: JSON.stringify({ roles, reason }),
      },
    );
  }

  async disableUser(userId: string, reason: string): Promise<BackendUser> {
    return this.request<BackendUser>(
      `/api/v1/admin/users/${encodeURIComponent(userId)}/disable`,
      {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ reason }),
      },
    );
  }

  async changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await this.request<void>("/api/v1/auth/password/change", {
      method: "POST",
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });
    this.clearSession();
  }

  async issueRealtimeTicket(): Promise<unknown> {
    return this.request<unknown>("/api/v1/realtime/tickets", {
      method: "POST",
      body: JSON.stringify({ channel: "tinode" }),
    });
  }

  async searchComplianceMetadata(
    input: ComplianceSearchInput,
  ): Promise<ComplianceSearchResponse> {
    return this.request<ComplianceSearchResponse>(
      "/api/v1/compliance/search",
      {
        method: "POST",
        body: JSON.stringify({
          ...input,
          reason: input.reason.trim().slice(0, 500),
          limit: Math.min(200, Math.max(1, input.limit ?? 200)),
        }),
      },
    );
  }

  async request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    try {
      return await this.authorizedFetch<T>(path, init);
    } catch (error) {
      if (
        error instanceof CifraApiError &&
        error.status === 401 &&
        REFRESHABLE_ACCESS_ERRORS.has(error.code) &&
        this.session?.tokens.refresh_token
      ) {
        await this.refresh();
        return this.authorizedFetch<T>(path, init);
      }
      throw error;
    }
  }

  private async acceptTokens(
    login: string,
    tokens: AuthTokens,
  ): Promise<AuthSession> {
    const context = await this.fetchJson<AuthContext>(
      "/api/v1/auth/context",
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      },
    );
    const session: AuthSession = {
      login,
      tokens,
      context,
      role: primaryRole(context.roles) as UserRole,
    };
    this.setSession(session);
    return session;
  }

  private async refresh(): Promise<AuthSession> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const current = this.session;
    if (!current) {
      throw new CifraApiError(
        "Сессия не найдена",
        401,
        "AUTH_REQUIRED",
      );
    }
    this.refreshInFlight = this.fetchJson<AuthTokens>("/api/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({
        refresh_token: current.tokens.refresh_token,
      }),
    })
      .then((tokens) => this.acceptTokens(current.login, tokens))
      .catch((error: unknown) => {
        this.clearSession();
        throw error;
      })
      .finally(() => {
        this.refreshInFlight = null;
      });
    return this.refreshInFlight;
  }

  private authorizedFetch<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    if (!this.session) {
      return Promise.reject(
        new CifraApiError(
          "Требуется авторизация",
          401,
          "AUTH_REQUIRED",
        ),
      );
    }
    return this.fetchJson<T>(path, {
      ...init,
      headers: {
        ...headersToObject(init.headers),
        Authorization: `Bearer ${this.session.tokens.access_token}`,
      },
    });
  }

  private async fetchJson<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      this.config.requestTimeoutMs,
    );
    try {
      const response = await fetch(`${this.config.apiBaseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...headersToObject(init.headers),
        },
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await parseErrorBody(response);
        throw new CifraApiError(
          body.error?.message ?? `Ошибка сервера (${response.status})`,
          response.status,
          body.error?.code ?? "HTTP_ERROR",
          body.error?.request_id,
          body.error?.retryable ?? false,
          body.error?.details ?? {},
        );
      }
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof CifraApiError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new CifraApiError(
          "Сервер не ответил вовремя",
          0,
          "REQUEST_TIMEOUT",
          undefined,
          true,
        );
      }
      throw new CifraApiError(
        "Не удалось подключиться к серверу CIFRA",
        0,
        "NETWORK_ERROR",
        undefined,
        true,
      );
    } finally {
      window.clearTimeout(timeout);
    }
  }

  private setSession(session: AuthSession): void {
    this.session = session;
    try {
      window.sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          login: session.login,
          tokens: session.tokens,
          context: session.context,
        } satisfies StoredSession),
      );
    } catch {
      // The in-memory session remains active until this tab is closed.
    }
  }

  private clearSession(): void {
    this.session = null;
    try {
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // The in-memory session has already been cleared.
    }
  }
}

function normalizeApiBase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  return trimmed.replace(/\/+$/, "");
}

function clampTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_CONFIG.requestTimeoutMs;
  return Math.min(60_000, Math.max(3_000, Math.round(value as number)));
}

function headersToObject(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(new Headers(headers).entries());
}

async function parseErrorBody(response: Response): Promise<ApiErrorBody> {
  try {
    return (await response.json()) as ApiErrorBody;
  } catch {
    return {};
  }
}

function browserDevice(): {
  id: string;
  name: string;
  platform: "web";
} {
  let id = "";
  try {
    id = window.localStorage.getItem(DEVICE_KEY) ?? "";
    if (id.length < 8) {
      id = crypto.randomUUID();
      window.localStorage.setItem(DEVICE_KEY, id);
    }
  } catch {
    id = crypto.randomUUID();
  }
  const browser = navigator.userAgent.includes("Firefox")
    ? "Firefox"
    : navigator.userAgent.includes("Edg/")
      ? "Edge"
      : navigator.userAgent.includes("Chrome")
        ? "Chrome"
        : navigator.userAgent.includes("Safari")
          ? "Safari"
          : "Браузер";
  return { id, name: `${browser} · CIFRA Web`, platform: "web" };
}

function readStoredSession(): StoredSession | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<StoredSession>;
    if (
      !stored.login ||
      !stored.tokens?.access_token ||
      !stored.tokens.refresh_token ||
      !Array.isArray(stored.context?.roles)
    ) {
      window.sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return stored as StoredSession;
  } catch {
    return null;
  }
}

function demoRoleForLogin(login: string): UserRole {
  const normalized = login.trim().toLocaleLowerCase("ru");
  if (normalized.includes("moderator") || normalized.includes("модератор")) {
    return "moderator";
  }
  if (normalized.includes("employee") || normalized.includes("сотрудник")) {
    return "employee";
  }
  return "admin";
}
