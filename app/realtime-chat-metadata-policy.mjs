import { normalizeSafeAvatarUrl } from "./avatar-policy.mjs";

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const readString = (source, keys) => {
  if (!isRecord(source)) return undefined;

  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, 120);
    }
  }

  return undefined;
};

export const getRealtimeTopicType = (topic) =>
  typeof topic === "string" && topic.startsWith("chn")
    ? "channel"
    : typeof topic === "string" && topic.startsWith("grp")
      ? "group"
      : "direct";

export const getRealtimeDisplayName = (
  publicValue,
  privateValue,
  fallback,
) =>
  readString(publicValue, ["fn", "title", "name"]) ||
  readString(privateValue, ["title", "name", "comment"]) ||
  fallback;

const readRawString = (source, keys) => {
  if (!isRecord(source)) return undefined;

  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
};

const normalizeImageSource = (value) => {
  if (typeof value === "string") {
    return normalizeSafeAvatarUrl(value);
  }

  if (!isRecord(value)) return undefined;

  const directUrl = readRawString(value, ["ref", "url", "src"]);
  const normalizedUrl = normalizeSafeAvatarUrl(directUrl);
  if (normalizedUrl) return normalizedUrl;

  const data = readRawString(value, ["data"]);
  const type = readRawString(value, ["type", "mime"]);
  if (!data) return undefined;

  const normalizedData = normalizeSafeAvatarUrl(data);
  if (normalizedData) return normalizedData;

  if (/^image\/(?:png|jpe?g|webp|avif)$/i.test(type ?? "")) {
    return normalizeSafeAvatarUrl(`data:${type};base64,${data}`);
  }

  return undefined;
};

export const getRealtimeAvatarUrl = (publicValue, privateValue) => {
  for (const source of [publicValue, privateValue]) {
    if (!isRecord(source)) continue;

    for (const key of ["photo", "avatar", "avatarUrl", "image"]) {
      const normalized = normalizeImageSource(source[key]);
      if (normalized) return normalized;
    }
  }

  return undefined;
};

export const getRealtimeInitials = (title) => {
  const initials = String(title ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("ru"))
    .join("");

  return initials || "RT";
};

export const buildRealtimeParticipantProfiles = (metadata, selfUserId) => {
  if (!metadata || !Array.isArray(metadata.participants)) return [];

  const seen = new Set();
  const profiles = [];

  for (const participant of metadata.participants) {
    if (
      !isRecord(participant) ||
      typeof participant.userId !== "string" ||
      !participant.userId ||
      participant.userId === selfUserId ||
      seen.has(participant.userId)
    ) {
      continue;
    }

    seen.add(participant.userId);
    const name = getRealtimeDisplayName(
      participant.public,
      participant.private,
      participant.userId,
    );
    const username = readString(participant.public, [
      "username",
      "login",
      "handle",
    ]);
    profiles.push({
      id: participant.userId,
      name,
      ...(username ? { username } : {}),
      avatar: getRealtimeInitials(name),
      avatarUrl: getRealtimeAvatarUrl(
        participant.public,
        participant.private,
      ),
      online: participant.online === true,
    });
  }

  return profiles;
};

export const projectRealtimeChatMetadata = (
  subscription,
  metadata,
  selfUserId,
) => {
  const topic = subscription?.topic ?? metadata?.topic ?? "";
  const type = metadata?.kind ?? getRealtimeTopicType(topic);
  const title = getRealtimeDisplayName(
    metadata?.public ?? subscription?.public,
    metadata?.private ?? subscription?.private,
    type === "channel"
      ? "Канал"
      : type === "group"
        ? "Групповой чат"
        : "Личный чат",
  );
  const participants = buildRealtimeParticipantProfiles(metadata, selfUserId);

  return {
    title,
    avatar: getRealtimeInitials(title),
    avatarUrl: getRealtimeAvatarUrl(
      metadata?.public ?? subscription?.public,
      metadata?.private ?? subscription?.private,
    ),
    type,
    kind: type === "direct" ? "personal" : "group",
    memberIds: participants.map((participant) => participant.id),
    participants,
  };
};
