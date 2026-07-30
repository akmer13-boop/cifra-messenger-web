const DEFAULT_PREVIEW = "Новое сообщение";

function messageContent(message) {
  const text = typeof message?.text === "string" ? message.text.trim() : "";
  const content = text
    ? text
    : message?.voice
      ? "🎙 Голосовое сообщение"
      : DEFAULT_PREVIEW;

  if (message?.forwardedFrom) return `↪ ${content}`;
  if (message?.replyToId != null) return `↩ ${content}`;
  return content;
}

export function getChatPreview(message, chatKind) {
  const content = messageContent(message);

  if (message?.side === "out") {
    return `Вы: ${content}`;
  }

  if (chatKind === "group" && message?.author) {
    return `${message.author}: ${content}`;
  }

  return content;
}

export function withLatestMessage(
  chat,
  message,
  lastActivityOrder,
  incrementUnread = false,
) {
  return {
    ...chat,
    subtitle: getChatPreview(message, chat.kind),
    time: message.time,
    lastActivityOrder,
    lastMessageId: message.id,
    lastMessageSide: message.side,
    lastDeliveryStatus:
      message.side === "out" ? message.deliveryStatus : undefined,
    unread: incrementUnread ? chat.unread + 1 : chat.unread,
  };
}

export function withLatestDeliveryStatus(chat, messageId, deliveryStatus) {
  if (chat.lastMessageId !== messageId || chat.lastMessageSide !== "out") {
    return chat;
  }

  return {
    ...chat,
    lastDeliveryStatus: deliveryStatus,
  };
}

export function hydrateChatsWithMessages(chats, messagesByChat) {
  return chats.map((chat) => {
    const messages = messagesByChat[chat.id] ?? [];
    const latestMessage = messages.at(-1);

    return latestMessage
      ? withLatestMessage(
          chat,
          latestMessage,
          chat.lastActivityOrder ?? 0,
        )
      : chat;
  });
}

export function sortChatsByActivity(chats) {
  return [...chats].sort((first, second) => {
    const pinOrder =
      Number(Boolean(second.pinned)) - Number(Boolean(first.pinned));
    if (pinOrder !== 0) return pinOrder;

    return (
      (second.lastActivityOrder ?? 0) - (first.lastActivityOrder ?? 0)
    );
  });
}
