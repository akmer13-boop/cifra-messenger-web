const TERMINAL_REFRESH_ERRORS = new Map([
  ["AUTH_REQUIRED", "expired"],
  ["REFRESH_TOKEN_INVALID", "expired"],
  ["REFRESH_ROTATION_CONFLICT", "expired"],
  ["REFRESH_TOKEN_REUSE", "revoked"],
  ["SESSION_EXPIRED", "expired"],
  ["SESSION_REVOKED", "revoked"],
  ["ACCOUNT_UNAVAILABLE", "account_unavailable"],
]);

const TERMINAL_AUTHORIZED_ERRORS = new Map([
  ["SESSION_EXPIRED", "expired"],
  ["SESSION_REVOKED", "revoked"],
  ["ACCOUNT_UNAVAILABLE", "account_unavailable"],
]);

/**
 * @param {{code?: unknown}|null|undefined} error
 * @param {"authorized"|"refresh"|"after_refresh"} source
 * @returns {"expired"|"revoked"|"account_unavailable"|null}
 */
export function classifySessionInvalidation(error, source) {
  if (!error || typeof error.code !== "string") return null;
  return (
    source === "authorized"
      ? TERMINAL_AUTHORIZED_ERRORS.get(error.code)
      : TERMINAL_REFRESH_ERRORS.get(error.code)
  ) ?? null;
}

/**
 * @param {"expired"|"revoked"|"account_unavailable"} reason
 */
export function sessionInvalidationMessage(reason) {
  if (reason === "account_unavailable") {
    return "Доступ к учётной записи ограничен. Обратитесь к администратору и войдите снова.";
  }
  if (reason === "revoked") {
    return "Сессия завершена сервером. Войдите снова.";
  }
  return "Сессия истекла. Войдите снова.";
}
