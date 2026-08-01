const readIdentity = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const addIdentity = (identities, value) => {
  const identity = readIdentity(value);
  if (identity) identities.add(identity);
};

export const getCallUserIdentities = (user, extraIdentity) => {
  const identities = new Set();
  addIdentity(identities, user?.id);
  addIdentity(identities, user?.backendId);
  addIdentity(identities, user?.realtimeUserId);
  addIdentity(identities, user?.realtime_user_id);
  addIdentity(identities, user?.tinode_uid);
  addIdentity(identities, extraIdentity);
  return identities;
};

export const isSameCallUser = (
  first,
  second,
  firstExtraIdentity,
  secondExtraIdentity,
) => {
  if (!first || !second) return false;
  const firstIdentities = getCallUserIdentities(first, firstExtraIdentity);
  const secondIdentities = getCallUserIdentities(second, secondExtraIdentity);
  for (const identity of firstIdentities) {
    if (secondIdentities.has(identity)) return true;
  }
  return false;
};

export const findCallUserByIdentity = (users, identity) => {
  const normalized = readIdentity(identity);
  if (!normalized || !Array.isArray(users)) return null;
  return (
    users.find((user) => getCallUserIdentities(user).has(normalized)) ?? null
  );
};

export const getDirectCallRestriction = (
  caller,
  target,
  callerRealtimeUserId,
) => {
  if (!caller || !target) return "unknown_participant";
  if (isSameCallUser(caller, target, callerRealtimeUserId)) {
    return "self_call";
  }
  if (caller.role === "employee" && target.role !== "employee") {
    return "privileged_target";
  }
  return null;
};

export const resolveCallParticipants = ({
  caller,
  callerRealtimeUserId,
  participantIds,
  users,
}) => {
  const requestedIds = Array.from(
    new Set(
      (Array.isArray(participantIds) ? participantIds : [])
        .map(readIdentity)
        .filter(Boolean),
    ),
  );
  const callerIdentities = getCallUserIdentities(
    caller,
    callerRealtimeUserId,
  );
  const targets = [];
  let containedSelf = false;

  for (const identity of requestedIds) {
    if (callerIdentities.has(identity)) {
      containedSelf = true;
      continue;
    }

    const target = findCallUserByIdentity(users, identity);
    if (!target) {
      return {
        participantIds: [],
        targets: [],
        restriction: "unknown_participant",
      };
    }

    const restriction = getDirectCallRestriction(
      caller,
      target,
      callerRealtimeUserId,
    );
    if (restriction === "self_call") {
      containedSelf = true;
      continue;
    }
    if (restriction) {
      return { participantIds: [], targets: [], restriction };
    }
    if (!targets.some((person) => person.id === target.id)) {
      targets.push(target);
    }
  }

  if (!targets.length) {
    return {
      participantIds: [],
      targets: [],
      restriction: containedSelf ? "self_call" : "empty_call",
    };
  }

  return {
    participantIds: targets.map((target) => target.id),
    targets,
    restriction: null,
  };
};

export const callRestrictionMessage = (restriction) => {
  if (restriction === "self_call") {
    return "Нельзя позвонить самому себе.";
  }
  if (restriction === "privileged_target") {
    return "Сотрудник может звонить только сотрудникам. Звонки администраторам и модераторам недоступны.";
  }
  if (restriction === "unknown_participant") {
    return "Не удалось определить профиль участника звонка.";
  }
  return "Выберите сотрудника для звонка.";
};
