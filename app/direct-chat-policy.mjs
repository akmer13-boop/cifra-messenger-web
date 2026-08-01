const USER_TOPIC_PATTERN = /^usr[A-Za-z0-9_-]{8,125}$/;

const readString = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const addIdentity = (identities, value) => {
  const normalized = readString(value);
  if (normalized) identities.add(normalized);
};

const getUserIdentities = (user) => {
  const identities = new Set();
  addIdentity(identities, user?.id);
  addIdentity(identities, user?.backendId);
  addIdentity(identities, user?.realtimeUserId);
  addIdentity(identities, user?.realtime_user_id);
  addIdentity(identities, user?.tinode_uid);
  return identities;
};

export const resolveRealtimeUserId = (user) => {
  for (const identity of getUserIdentities(user)) {
    if (USER_TOPIC_PATTERN.test(identity)) return identity;
  }
  return null;
};

export const chatContainsUser = (chat, user) => {
  if (!chat || chat.deleted || !user) return false;

  const identities = getUserIdentities(user);
  if (identities.size === 0) return false;
  if (identities.has(chat.id)) return true;

  return Array.isArray(chat.memberIds)
    ? chat.memberIds.some((memberId) => identities.has(memberId))
    : false;
};

export const findDirectChatForUser = (chats, user) => {
  if (!Array.isArray(chats) || !user) return null;

  const directChats = chats.filter(
    (chat) =>
      chat &&
      !chat.deleted &&
      chat.kind !== "group" &&
      chat.realtimeType !== "group" &&
      chat.realtimeType !== "channel",
  );
  const identityMatch = directChats.find((chat) =>
    chatContainsUser(chat, user),
  );
  if (identityMatch) return identityMatch;

  const normalizedName = readString(user?.name)
    ?.toLocaleLowerCase("ru")
    .replace(/\s+/g, " ");
  if (!normalizedName) return null;
  const titleMatches = directChats.filter(
      (chat) =>
        readString(chat.title)
          ?.toLocaleLowerCase("ru")
          .replace(/\s+/g, " ") === normalizedName,
  );
  return titleMatches.length === 1 ? titleMatches[0] : null;
};

export const filterChatsForAuditUser = (chats, user) =>
  (Array.isArray(chats) ? chats : []).filter((chat) =>
    chatContainsUser(chat, user),
  );

const normalizeSearchTerm = (value) => {
  const normalized = readString(value)?.replace(/[\u0000-\u001f\u007f]/g, "");
  return normalized?.slice(0, 96) || undefined;
};

export const buildRealtimeDirectoryQueries = (user) => {
  const queries = [];
  const addQuery = (value) => {
    const normalized = normalizeSearchTerm(value);
    if (normalized && !queries.includes(normalized)) queries.push(normalized);
  };

  const username = normalizeSearchTerm(user?.username)?.replace(/^@+/, "");
  const email = normalizeSearchTerm(user?.email)?.toLocaleLowerCase("ru");

  if (username) {
    addQuery(`basic:${username}`);
    addQuery(`login:${username}`);
    addQuery(username);
  }
  if (email) {
    addQuery(`email:${email}`);
    addQuery(email);
  }

  return queries;
};
