const normalizeIdentity = (value) =>
  typeof value === "string"
    ? value
        .trim()
        .toLocaleLowerCase("ru")
        .replace(/^@/, "")
        .replace(/[\s._-]+/g, "")
    : "";

const addIdentity = (keys, value) => {
  const normalized = normalizeIdentity(value);
  if (normalized) keys.add(normalized);
};

const getUserIdentityKeys = (user) => {
  const keys = new Set();
  addIdentity(keys, user?.id);
  addIdentity(keys, user?.backendId);
  addIdentity(keys, user?.realtimeUserId);
  addIdentity(keys, user?.username);
  addIdentity(keys, user?.name);
  if (typeof user?.email === "string") {
    addIdentity(keys, user.email);
    addIdentity(keys, user.email.split("@")[0]);
  }
  return keys;
};

const getParticipantIdentityKeys = (participant) => {
  const keys = new Set();
  addIdentity(keys, participant?.id);
  addIdentity(keys, participant?.username);
  addIdentity(keys, participant?.name);
  return keys;
};

const identitiesIntersect = (left, right) => {
  for (const key of left) {
    if (right.has(key)) return true;
  }
  return false;
};

export const mergeRealtimeParticipantsIntoDirectory = (
  users,
  previousParticipantIds,
  participantProfiles,
) => {
  const previousIds = new Set(previousParticipantIds ?? []);
  const retained = (Array.isArray(users) ? users : []).filter(
    (user) =>
      !previousIds.has(user.id) ||
      Boolean(user.backendId) ||
      user.id === "self",
  );
  const next = retained.map((user) => ({ ...user }));
  const participantIds = new Set();

  for (const participant of Array.isArray(participantProfiles)
    ? participantProfiles
    : []) {
    if (!participant || typeof participant.id !== "string") continue;
    participantIds.add(participant.id);

    const participantKeys = getParticipantIdentityKeys(participant);
    const matchedIndex = next.findIndex((user) =>
      identitiesIntersect(getUserIdentityKeys(user), participantKeys),
    );

    if (matchedIndex >= 0) {
      const existing = next[matchedIndex];
      next[matchedIndex] = {
        ...existing,
        realtimeUserId: participant.id,
        online: participant.online === true,
        ...(!existing.avatarUrl && participant.avatarUrl
          ? { avatarUrl: participant.avatarUrl }
          : {}),
      };
      continue;
    }

    next.push({
      id: participant.id,
      realtimeUserId: participant.id,
      name: participant.name,
      email: "",
      username: participant.username || participant.id,
      phone: "",
      avatar: participant.avatar,
      ...(participant.avatarUrl
        ? { avatarUrl: participant.avatarUrl }
        : {}),
      gradient: "linear-gradient(145deg, #0f766e, #2563eb)",
      role: "employee",
      online: participant.online === true,
      position: "Сотрудник",
    });
  }

  const deduplicated = [];
  const seenIdentityKeys = new Set();
  for (const user of next) {
    const keys = getUserIdentityKeys(user);
    const duplicate = Array.from(keys).some((key) => seenIdentityKeys.has(key));
    if (duplicate && user.id !== "self") continue;
    deduplicated.push(user);
    for (const key of keys) seenIdentityKeys.add(key);
  }

  return {
    users: deduplicated,
    participantIds,
  };
};

export const resolveRealtimeMemberIds = (users, memberIds) => {
  const directory = Array.isArray(users) ? users : [];
  const resolved = [];
  const unresolved = [];

  for (const memberId of Array.isArray(memberIds) ? memberIds : []) {
    const user = directory.find((candidate) => candidate.id === memberId);
    const realtimeId =
      user?.realtimeUserId ||
      (typeof user?.id === "string" && user.id.startsWith("usr")
        ? user.id
        : undefined);

    if (realtimeId && !resolved.includes(realtimeId)) {
      resolved.push(realtimeId);
    } else {
      unresolved.push(memberId);
    }
  }

  return { resolved, unresolved };
};

export const filterCallsForRuntime = (mode, calls, users) => {
  if (mode !== "backend") return Array.isArray(calls) ? calls : [];

  const knownIds = new Set();
  for (const user of Array.isArray(users) ? users : []) {
    // In backend mode an ID is considered real only when it came from
    // the backend directory or realtime metadata. This avoids briefly
    // rendering the built-in demo call history before directory sync.
    for (const value of [user.backendId, user.realtimeUserId]) {
      if (typeof value === "string" && value) knownIds.add(value);
    }
  }

  return (Array.isArray(calls) ? calls : []).filter(
    (call) =>
      Array.isArray(call?.participantIds) &&
      call.participantIds.length > 0 &&
      call.participantIds.every((id) => knownIds.has(id)),
  );
};
