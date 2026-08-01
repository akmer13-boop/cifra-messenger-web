const USER_TOPIC_PATTERN = /^usr[A-Za-z0-9_-]{8,125}$/;

const PROFILE_ALIAS_KEYS = [
  "fn",
  "title",
  "name",
  "username",
  "login",
  "handle",
  "email",
];

const readString = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const addIdentity = (identities, value) => {
  const normalized = readString(value);
  if (normalized) identities.add(normalized);
};

const normalizeAlias = (value) =>
  readString(value)
    ?.normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replace(/^@+/, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");

const addAlias = (aliases, value) => {
  const normalized = normalizeAlias(value);
  if (normalized) aliases.add(normalized);

  const raw = readString(value);
  if (raw?.includes("@")) {
    const localPart = normalizeAlias(raw.split("@")[0]);
    if (localPart) aliases.add(localPart);
  }
};

const addProfileAliases = (aliases, profile) => {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return;
  }

  for (const key of PROFILE_ALIAS_KEYS) {
    addAlias(aliases, profile[key]);
  }
};

const aliasesIntersect = (left, right) => {
  for (const alias of left) {
    if (right.has(alias)) return true;
  }
  return false;
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

const getUserAliases = (user) => {
  const aliases = new Set();
  addAlias(aliases, user?.name);
  addAlias(aliases, user?.username);
  addAlias(aliases, user?.email);
  addProfileAliases(aliases, user?.public);
  addProfileAliases(aliases, user?.private);
  return aliases;
};

const getChatAliases = (chat) => {
  const aliases = new Set();
  addAlias(aliases, chat?.title);
  addAlias(aliases, chat?.username);
  addAlias(aliases, chat?.email);
  addProfileAliases(aliases, chat?.public);
  addProfileAliases(aliases, chat?.private);

  for (const profile of Array.isArray(chat?.realtimeProfiles)
    ? chat.realtimeProfiles
    : []) {
    addProfileAliases(aliases, profile);
  }

  return aliases;
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

  const userAliases = getUserAliases(user);
  if (userAliases.size === 0) return null;
  const aliasMatches = directChats.filter((chat) =>
    aliasesIntersect(userAliases, getChatAliases(chat)),
  );
  return aliasMatches.length === 1 ? aliasMatches[0] : null;
};

export const findDirectRealtimeTopicForUser = (
  subscriptions,
  metadata,
  user,
  selfUserId,
) => {
  const metadataByTopic = new Map(
    (Array.isArray(metadata) ? metadata : [])
      .filter((entry) => entry && typeof entry.topic === "string")
      .map((entry) => [entry.topic, entry]),
  );

  const candidates = (Array.isArray(subscriptions) ? subscriptions : [])
    .filter(
      (subscription) =>
        subscription &&
        USER_TOPIC_PATTERN.test(subscription.topic) &&
        subscription.topic !== selfUserId,
    )
    .flatMap((subscription) => {
      const topicMetadata = metadataByTopic.get(subscription.topic);
      if (
        topicMetadata?.kind === "group" ||
        topicMetadata?.kind === "channel"
      ) {
        return [];
      }

      const participants = Array.isArray(topicMetadata?.participants)
        ? topicMetadata.participants
        : [];
      return [
        {
          id: subscription.topic,
          kind: "personal",
          realtimeType: "direct",
          memberIds: Array.from(
            new Set([
              subscription.topic,
              ...participants.flatMap((participant) =>
                typeof participant?.userId === "string"
                  ? [participant.userId]
                  : [],
              ),
            ]),
          ),
          realtimeProfiles: [
            subscription.public,
            subscription.private,
            topicMetadata?.public,
            topicMetadata?.private,
            ...participants.flatMap((participant) => [
              participant?.public,
              participant?.private,
            ]),
          ],
        },
      ];
    });

  return findDirectChatForUser(candidates, user)?.id ?? null;
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
