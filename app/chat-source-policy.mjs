const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const normalizeTopicIds = (topicIds) => {
  if (!topicIds || typeof topicIds[Symbol.iterator] !== "function") {
    return [];
  }

  return Array.from(
    new Set(
      Array.from(topicIds).filter(
        (topic) => typeof topic === "string" && topic.trim().length > 0,
      ),
    ),
  );
};

export const isBackendChatMode = (mode) => mode === "backend";

export const canUseLocalChatFallback = (mode) =>
  !isBackendChatMode(mode);

export const filterChatsForRuntimeMode = (mode, chats, realtimeTopicIds) => {
  const source = Array.isArray(chats) ? chats : [];
  if (!isBackendChatMode(mode)) return source;

  const allowedTopics = new Set(normalizeTopicIds(realtimeTopicIds));
  return source.filter(
    (chat) =>
      isRecord(chat) &&
      typeof chat.id === "string" &&
      allowedTopics.has(chat.id),
  );
};

export const filterMessagesForRuntimeMode = (
  mode,
  messagesByChat,
  realtimeTopicIds,
) => {
  const source = isRecord(messagesByChat) ? messagesByChat : {};
  if (!isBackendChatMode(mode)) return source;

  const allowedTopics = normalizeTopicIds(realtimeTopicIds);
  return Object.fromEntries(
    allowedTopics
      .filter((topic) => Object.hasOwn(source, topic))
      .map((topic) => [topic, source[topic]]),
  );
};

export const keepSelectedChatForRuntimeMode = (
  mode,
  selectedChatId,
  realtimeTopicIds,
) => {
  if (!isBackendChatMode(mode)) return selectedChatId ?? null;
  if (typeof selectedChatId !== "string") return null;

  return normalizeTopicIds(realtimeTopicIds).includes(selectedChatId)
    ? selectedChatId
    : null;
};
