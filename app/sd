const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const hasReadAccess = (subscription) => {
  const mode = subscription?.access?.mode;
  return typeof mode !== "string" || mode.includes("R");
};

export const getReadableRealtimeSubscriptions = (subscriptions) => {
  if (!Array.isArray(subscriptions)) return [];

  const seen = new Set();
  const readable = [];

  for (const subscription of subscriptions) {
    if (
      !isRecord(subscription) ||
      typeof subscription.topic !== "string" ||
      !subscription.topic.trim() ||
      seen.has(subscription.topic) ||
      !hasReadAccess(subscription)
    ) {
      continue;
    }

    seen.add(subscription.topic);
    readable.push(subscription);
  }

  return readable;
};

export const resolveRealtimeObservedTopic = (
  selectedChatId,
  observedTopic,
  attachedTopics,
) => {
  const topics = Array.isArray(attachedTopics)
    ? attachedTopics.filter(
        (topic, index, values) =>
          typeof topic === "string" &&
          topic.length > 0 &&
          values.indexOf(topic) === index,
      )
    : [];

  if (typeof selectedChatId === "string" && topics.includes(selectedChatId)) {
    return selectedChatId;
  }

  if (typeof observedTopic === "string" && topics.includes(observedTopic)) {
    return observedTopic;
  }

  return topics[0] ?? null;
};
