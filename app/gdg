const normalizeSeq = (value) =>
  Number.isInteger(value) && value >= 0 ? value : 0;

export function getLatestRealtimeSeq(messages, topic, fallbackSeq = 0) {
  return messages.reduce(
    (highest, message) =>
      message?.topic === topic
        ? Math.max(highest, normalizeSeq(message.seq))
        : highest,
    normalizeSeq(fallbackSeq),
  );
}

export function getLatestIncomingRealtimeSeq(messages, topic, selfUserId) {
  return messages.reduce(
    (highest, message) =>
      message?.topic === topic &&
      typeof message.from === "string" &&
      message.from !== selfUserId
        ? Math.max(highest, normalizeSeq(message.seq))
        : highest,
    0,
  );
}

export function getRealtimeUnreadCount(
  messages,
  topic,
  selfUserId,
  readSeq = 0,
  latestSeq = 0,
) {
  const normalizedReadSeq = normalizeSeq(readSeq);
  let incomingAfterRead = 0;
  let ownAfterRead = 0;

  for (const message of messages) {
    const seq = normalizeSeq(message?.seq);
    if (message?.topic !== topic || seq <= normalizedReadSeq) continue;

    if (typeof message.from === "string" && message.from === selfUserId) {
      ownAfterRead += 1;
    } else if (typeof message.from === "string") {
      incomingAfterRead += 1;
    }
  }

  const serverUnreadEstimate = Math.max(
    0,
    normalizeSeq(latestSeq) - normalizedReadSeq - ownAfterRead,
  );

  return Math.max(incomingAfterRead, serverUnreadEstimate);
}
