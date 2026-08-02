import { primaryRole, wireRole } from "./auth-policy.mjs";

export type RuntimeMode = "demo" | "backend";
export type CorporateRole = "employee" | "admin" | "security_moderator";
export type UserRole = "employee" | "admin" | "moderator";

export interface RuntimeConfig {
  mode: RuntimeMode;
  apiBaseUrl: string;
  requestTimeoutMs: number;
  demoMfaCode: string;
  avatarAllowedOrigins: string[];
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

type LoginResponse =
  | AuthTokens
  | {
      mfa_required: true;
      challenge_token: string;
      expires_in: number;
    };

type JsonParser<T> = (value: unknown) => T;

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

const LEGACY_SESSION_KEY = "cifra-auth-session-v1";
const DEVICE_KEY = "cifra-browser-device-id-v1";
const REFRESHABLE_ACCESS_ERRORS = new Set([
  "AUTH_REQUIRED",
  "ACCESS_TOKEN_INVALID",
]);
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_DEMO_MFA_CODE = "111111";

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
      if (!response.ok) {
        throw new CifraApiError(
          "Не удалось загрузить конфигурацию CIFRA",
          response.status,
          "RUNTIME_CONFIG_UNAVAILABLE",
          undefined,
          response.status >= 500,
        );
      }
      const raw = await response.json();
      if (!isRecord(raw)) {
        throw new CifraApiError(
          "Некорректный формат конфигурации CIFRA",
          0,
          "RUNTIME_CONFIG_INVALID",
        );
      }
      if (raw.mode !== "demo" && raw.mode !== "backend") {
        throw new CifraApiError(
          "Некорректный mode в cifra-runtime-config.json",
          0,
          "RUNTIME_CONFIG_INVALID",
        );
      }
      const mode = raw.mode;
      return {
        mode,
        apiBaseUrl: normalizeApiBase(
          typeof raw.apiBaseUrl === "string" ? raw.apiBaseUrl : "",
        ),
        requestTimeoutMs: clampTimeout(
          typeof raw.requestTimeoutMs === "number"
            ? raw.requestTimeoutMs
            : undefined,
        ),
        demoMfaCode:
          mode === "demo"
            ? typeof raw.demoMfaCode === "string" && raw.demoMfaCode
              ? raw.demoMfaCode
              : DEFAULT_DEMO_MFA_CODE
            : "",
        avatarAllowedOrigins: parseAvatarAllowedOrigins(
          raw.avatarAllowedOrigins,
        ),
      };
    })
    .catch((error: unknown) => {
      runtimeConfigPromise = null;
      if (error instanceof CifraApiError) {
        throw error;
      }
      throw new CifraApiError(
        "Не удалось загрузить конфигурацию CIFRA",
        0,
        "RUNTIME_CONFIG_UNAVAILABLE",
        undefined,
        true,
      );
    });
  return runtimeConfigPromise;
}

export class CifraApiClient {
  private session: AuthSession | null = null;
  private refreshInFlight: Promise<AuthSession> | null = null;

  constructor(readonly config: RuntimeConfig) {
    purgeLegacyStoredSession();
  }

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

    const response = await this.fetchJson<LoginResponse>(
      "/api/v1/auth/login",
      {
        method: "POST",
        body: JSON.stringify({
          login: normalizedLogin,
          password,
          device: browserDevice(),
        }),
      },
      parseLoginResponse,
    );
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
          access_token: `demo:${crypto.randomUUID()}`,
          refresh_token: `demo:${crypto.randomUUID()}`,
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
      parseAuthTokens,
    );
    return this.acceptTokens(login, tokens);
  }

  async restoreSession(): Promise<AuthSession | null> {
    // Tokens intentionally live in memory only. A page reload requires a new
    // sign-in until the Gateway exposes an HttpOnly cookie/BFF session.
    return this.session;
  }

  async logout(): Promise<void> {
    const active = this.session;
    try {
      if (this.mode === "backend" && active) {
        await this.authorizedFetch<void>(
          "/api/v1/auth/logout",
          { method: "POST" },
          parseVoid,
        );
      }
    } finally {
      this.clearSession();
    }
  }

  async listUsers(query = ""): Promise<UserPage> {
    const params = new URLSearchParams({ limit: "100" });
    if (query.trim()) params.set("query", query.trim());
    return this.request<UserPage>(
      `/api/v1/users?${params.toString()}`,
      {},
      parseUserPage,
    );
  }

  async createUser(input: CreateUserInput): Promise<BackendUser> {
    return this.request<BackendUser>(
      "/api/v1/admin/users",
      {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(input),
      },
      parseBackendUser,
    );
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
      parseBackendUser,
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
      parseBackendUser,
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
      parseBackendUser,
    );
  }

  async changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    await this.request<void>(
      "/api/v1/auth/password/change",
      {
        method: "POST",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      },
      parseVoid,
    );
    this.clearSession();
  }

  async issueRealtimeTicket(): Promise<unknown> {
    return this.request<Record<string, unknown>>(
      "/api/v1/realtime/tickets",
      {
        method: "POST",
        body: JSON.stringify({ channel: "tinode" }),
      },
      parseJsonRecord,
    );
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
      parseComplianceSearchResponse,
    );
  }

  async request<T>(
    path: string,
    init: RequestInit,
    parseJson: JsonParser<T>,
  ): Promise<T> {
    try {
      return await this.authorizedFetch<T>(path, init, parseJson);
    } catch (error) {
      if (
        error instanceof CifraApiError &&
        error.status === 401 &&
        REFRESHABLE_ACCESS_ERRORS.has(error.code) &&
        this.session?.tokens.refresh_token
      ) {
        await this.refresh();
        return this.authorizedFetch<T>(path, init, parseJson);
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
      parseAuthContext,
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
    this.refreshInFlight = this.fetchJson<AuthTokens>(
      "/api/v1/auth/refresh",
      {
        method: "POST",
        body: JSON.stringify({
          refresh_token: current.tokens.refresh_token,
        }),
      },
      parseAuthTokens,
    )
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
    init: RequestInit,
    parseJson: JsonParser<T>,
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
    return this.fetchJson<T>(
      path,
      {
        ...init,
        headers: {
          ...headersToObject(init.headers),
          Authorization: `Bearer ${this.session.tokens.access_token}`,
        },
      },
      parseJson,
    );
  }

  private async fetchJson<T>(
    path: string,
    init: RequestInit,
    parseJson: JsonParser<T>,
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
      if (response.status === 204) return parseJson(undefined);
      return parseJson(await response.json());
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
  }

  private clearSession(): void {
    this.session = null;
  }
}

function normalizeApiBase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "";
  return trimmed.replace(/\/+$/, "");
}

function clampTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.min(60_000, Math.max(3_000, Math.round(value as number)));
}

function parseAvatarAllowedOrigins(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const origins = value.flatMap((item) => {
    if (typeof item !== "string") return [];
    try {
      const url = new URL(item.trim());
      return url.protocol === "https:" ? [url.origin] : [];
    } catch {
      return [];
    }
  });
  return Array.from(new Set(origins));
}

function headersToObject(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(new Headers(headers).entries());
}

async function parseErrorBody(response: Response): Promise<ApiErrorBody> {
  try {
    const value = await response.json();
    if (!isRecord(value) || !isRecord(value.error)) return {};
    const error = value.error;
    return {
      error: {
        ...(typeof error.code === "string" ? { code: error.code } : {}),
        ...(typeof error.message === "string" ? { message: error.message } : {}),
        ...(isRecord(error.details) ? { details: error.details } : {}),
        ...(typeof error.request_id === "string"
          ? { request_id: error.request_id }
          : {}),
        ...(typeof error.retryable === "boolean"
          ? { retryable: error.retryable }
          : {}),
      },
    };
  } catch {
    return {};
  }
}

function parseLoginResponse(value: unknown): LoginResponse {
  const record = requireRecord(value, "ответ входа");
  if (record.mfa_required === true) {
    return {
      mfa_required: true,
      challenge_token: requireString(record, "challenge_token", "ответ входа"),
      expires_in: requireNumber(record, "expires_in", "ответ входа"),
    };
  }
  return parseAuthTokens(record);
}

function parseAuthTokens(value: unknown): AuthTokens {
  const record = requireRecord(value, "токены авторизации");
  const tokenType = requireString(record, "token_type", "токены авторизации");
  if (tokenType !== "Bearer") {
    throw contractError("токены авторизации", "token_type");
  }
  return {
    access_token: requireString(record, "access_token", "токены авторизации"),
    refresh_token: requireString(record, "refresh_token", "токены авторизации"),
    token_type: tokenType,
    expires_in: requireNumber(record, "expires_in", "токены авторизации"),
    session_id: requireString(record, "session_id", "токены авторизации"),
    must_change_password: requireBoolean(
      record,
      "must_change_password",
      "токены авторизации",
    ),
  };
}

function parseAuthContext(value: unknown): AuthContext {
  const record = requireRecord(value, "контекст авторизации");
  return {
    user_id: requireString(record, "user_id", "контекст авторизации"),
    session_id: requireString(record, "session_id", "контекст авторизации"),
    roles: parseCorporateRoles(record.roles, "контекст авторизации"),
    must_change_password: requireBoolean(
      record,
      "must_change_password",
      "контекст авторизации",
    ),
  };
}

function parseUserPage(value: unknown): UserPage {
  const record = requireRecord(value, "каталог пользователей");
  if (!Array.isArray(record.items)) {
    throw contractError("каталог пользователей", "items");
  }
  return {
    items: record.items.map(parseBackendUser),
    next_cursor: readNullableString(
      record,
      "next_cursor",
      "каталог пользователей",
    ),
  };
}

function parseBackendUser(value: unknown): BackendUser {
  const record = requireRecord(value, "пользователь");
  const status = requireString(record, "status", "пользователь");
  if (!isBackendUserStatus(status)) {
    throw contractError("пользователь", "status");
  }
  return {
    id: requireString(record, "id", "пользователь"),
    realtime_user_id: readOptionalNullableString(
      record,
      "realtime_user_id",
      "пользователь",
    ),
    tinode_uid: readOptionalNullableString(record, "tinode_uid", "пользователь"),
    login: requireString(record, "login", "пользователь"),
    first_name: requireString(record, "first_name", "пользователь"),
    last_name: requireString(record, "last_name", "пользователь"),
    middle_name: readNullableString(record, "middle_name", "пользователь"),
    email: readNullableString(record, "email", "пользователь"),
    phone: readNullableString(record, "phone", "пользователь"),
    department: readNullableString(record, "department", "пользователь"),
    job_title: readNullableString(record, "job_title", "пользователь"),
    status,
    roles: parseCorporateRoles(record.roles, "пользователь"),
    version: requireNumber(record, "version", "пользователь"),
    created_at: requireString(record, "created_at", "пользователь"),
    updated_at: requireString(record, "updated_at", "пользователь"),
  };
}

function parseComplianceSearchResponse(
  value: unknown,
): ComplianceSearchResponse {
  const record = requireRecord(value, "результаты аудита");
  if (!Array.isArray(record.items)) {
    throw contractError("результаты аудита", "items");
  }
  return {
    items: record.items.map((item) => {
      const message = requireRecord(item, "метаданные сообщения");
      return {
        topic_id: requireString(message, "topic_id", "метаданные сообщения"),
        seq: requireNumber(message, "seq", "метаданные сообщения"),
        sender_id: readNullableString(
          message,
          "sender_id",
          "метаданные сообщения",
        ),
        client_msg_id: readNullableString(
          message,
          "client_msg_id",
          "метаданные сообщения",
        ),
        kind: requireString(message, "kind", "метаданные сообщения"),
        created_at: requireString(
          message,
          "created_at",
          "метаданные сообщения",
        ),
        deleted_at: readNullableString(
          message,
          "deleted_at",
          "метаданные сообщения",
        ),
      };
    }),
    ...(record.next_cursor === undefined
      ? {}
      : {
          next_cursor: readNullableString(
            record,
            "next_cursor",
            "результаты аудита",
          ),
        }),
    ...(record.protected_text_search_available === false
      ? { protected_text_search_available: false as const }
      : {}),
  };
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  return requireRecord(value, "ответ сервера");
}

function parseVoid(value: unknown): void {
  if (value !== undefined && value !== null && !isRecord(value)) {
    throw contractError("пустой ответ", "body");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(
  value: unknown,
  resource: string,
): Record<string, unknown> {
  if (!isRecord(value)) throw contractError(resource, "body");
  return value;
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  resource: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw contractError(resource, key);
  }
  return value;
}

function requireNumber(
  record: Record<string, unknown>,
  key: string,
  resource: string,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw contractError(resource, key);
  }
  return value;
}

function requireBoolean(
  record: Record<string, unknown>,
  key: string,
  resource: string,
): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw contractError(resource, key);
  return value;
}

function readNullableString(
  record: Record<string, unknown>,
  key: string,
  resource: string,
): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string") throw contractError(resource, key);
  return value;
}

function readOptionalNullableString(
  record: Record<string, unknown>,
  key: string,
  resource: string,
): string | null | undefined {
  if (!(key in record)) return undefined;
  return readNullableString(record, key, resource);
}

function parseCorporateRoles(
  value: unknown,
  resource: string,
): CorporateRole[] {
  if (!Array.isArray(value) || !value.every(isCorporateRole)) {
    throw contractError(resource, "roles");
  }
  return [...value];
}

function isCorporateRole(value: unknown): value is CorporateRole {
  return (
    value === "employee" ||
    value === "admin" ||
    value === "security_moderator"
  );
}

function isBackendUserStatus(
  value: string,
): value is BackendUser["status"] {
  return [
    "active",
    "inactive",
    "blocked",
    "deleted",
    "invited",
    "disabled",
    "archived",
  ].includes(value);
}

function contractError(resource: string, field: string): CifraApiError {
  return new CifraApiError(
    `Сервер вернул некорректные данные: ${resource}`,
    502,
    "API_CONTRACT_MISMATCH",
    undefined,
    false,
    { field },
  );
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

function purgeLegacyStoredSession(): void {
  try {
    window.sessionStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    // Storage may be unavailable; no new secrets are written there.
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
