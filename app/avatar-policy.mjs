const ALLOWED_AVATAR_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
]);

export const MAX_AVATAR_FILE_BYTES = 5 * 1024 * 1024;

let allowedHttpsOrigins = new Set();

const getPageOrigin = () => {
  try {
    return typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : undefined;
  } catch {
    return undefined;
  }
};

const parseOrigin = (value) => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
};

export const configureAvatarAllowedOrigins = (origins) => {
  allowedHttpsOrigins = new Set(
    (Array.isArray(origins) ? origins : [])
      .map(parseOrigin)
      .filter(Boolean),
  );
};

const isSafeDataImage = (value) =>
  value.length <= Math.ceil((MAX_AVATAR_FILE_BYTES * 4) / 3) + 128 &&
  /^data:image\/(?:png|jpe?g|webp|avif);base64,[a-z0-9+/]+=*$/i.test(value);

export const normalizeSafeAvatarUrl = (value, options = {}) => {
  if (typeof value !== "string") return undefined;

  const normalized = value.trim();
  if (
    !normalized ||
    /[\u0000-\u001f\u007f"'\\]/.test(normalized) ||
    normalized.startsWith("//")
  ) {
    return undefined;
  }

  if (isSafeDataImage(normalized)) return normalized;

  if (
    normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../")
  ) {
    return normalized;
  }

  const pageOrigin = options.pageOrigin ?? getPageOrigin();
  try {
    const url = new URL(normalized);
    if (url.protocol === "blob:") {
      return pageOrigin && url.origin === pageOrigin ? normalized : undefined;
    }
    if (pageOrigin && url.origin === pageOrigin) return normalized;
    if (url.protocol !== "https:") return undefined;
    return allowedHttpsOrigins.has(url.origin) ? normalized : undefined;
  } catch {
    return undefined;
  }
};

export const validateAvatarFile = (file) => {
  if (!file || typeof file !== "object") {
    return "Выберите изображение.";
  }
  if (!ALLOWED_AVATAR_MIME_TYPES.has(String(file.type).toLowerCase())) {
    return "Поддерживаются PNG, JPEG, WebP и AVIF.";
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return "Файл изображения пуст или повреждён.";
  }
  if (file.size > MAX_AVATAR_FILE_BYTES) {
    return "Размер аватара не должен превышать 5 МБ.";
  }
  return null;
};
