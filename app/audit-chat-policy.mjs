import { filterChatsForAuditUser } from "./direct-chat-policy.mjs";

const readTimestamp = (value) => {
  if (typeof value !== "string") return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const formatAuditTime = (value) => {
  const timestamp = readTimestamp(value);
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
};

const shortTopic = (topic) =>
  typeof topic === "string" && topic.length > 14
    ? `${topic.slice(0, 8)}…${topic.slice(-4)}`
    : topic || "без идентификатора";

export const buildLocalAuditDataset = (chats, messagesByChat, user) => {
  const filteredChats = filterChatsForAuditUser(chats, user);
  const filteredMessages = Object.fromEntries(
    filteredChats.map((chat) => [
      chat.id,
      Array.isArray(messagesByChat?.[chat.id]) ? messagesByChat[chat.id] : [],
    ]),
  );

  return {
    chats: filteredChats,
    messagesByChat: filteredMessages,
    metadataOnly: false,
  };
};

export const buildComplianceAuditDataset = (
  items,
  user,
  knownChats = [],
) => {
  const normalizedItems = Array.isArray(items) ? items : [];
  const knownByTopic = new Map(
    (Array.isArray(knownChats) ? knownChats : []).map((chat) => [chat.id, chat]),
  );
  const grouped = new Map();

  for (const item of normalizedItems) {
    if (!item || typeof item.topic_id !== "string" || !item.topic_id) continue;
    const seq = Number.isInteger(item.seq) && item.seq > 0 ? item.seq : 0;
    const key = `${item.topic_id}:${seq}:${item.client_msg_id ?? ""}`;
    const topic = grouped.get(item.topic_id) ?? new Map();
    topic.set(key, item);
    grouped.set(item.topic_id, topic);
  }

  const messagesByChat = {};
  const chats = Array.from(grouped.entries()).map(([topicId, topicItems]) => {
    const sorted = Array.from(topicItems.values()).sort((left, right) => {
      const seqOrder = (left.seq ?? 0) - (right.seq ?? 0);
      return seqOrder || readTimestamp(left.created_at) - readTimestamp(right.created_at);
    });
    const known = knownByTopic.get(topicId);
    const latest = sorted.at(-1);
    messagesByChat[topicId] = sorted.map((item, index) => ({
      id: Number.isInteger(item.seq) && item.seq > 0 ? item.seq : index + 1,
      side:
        item.sender_id && item.sender_id === (user?.backendId ?? user?.id)
          ? "out"
          : "in",
      author:
        item.sender_id === (user?.backendId ?? user?.id)
          ? user?.name
          : "Собеседник",
      text: item.deleted_at
        ? "Сообщение удалено · содержимое недоступно"
        : `${item.kind === "text" ? "Текстовое сообщение" : "Сообщение"} · содержимое защищено текущим compliance API`,
      time: formatAuditTime(item.created_at),
    }));

    return {
      id: topicId,
      title: known?.title ?? `Переписка ${shortTopic(topicId)}`,
      subtitle: `${sorted.length} событий · метаданные`,
      time: formatAuditTime(latest?.created_at),
      unread: 0,
      avatar: known?.avatar ?? "AU",
      avatarUrl: known?.avatarUrl,
      gradient:
        known?.gradient ?? "linear-gradient(145deg, #5f6875, #aeb6c1)",
      kind: known?.kind ?? "work",
      realtimeType: known?.realtimeType,
      lastActivityOrder: readTimestamp(latest?.created_at),
      memberIds: known?.memberIds,
    };
  });

  chats.sort((left, right) => right.lastActivityOrder - left.lastActivityOrder);

  return { chats, messagesByChat, metadataOnly: true };
};

