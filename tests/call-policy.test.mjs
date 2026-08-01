import assert from "node:assert/strict";
import test from "node:test";

import {
  callRestrictionMessage,
  getDirectCallRestriction,
  resolveCallParticipants,
} from "../app/call-policy.mjs";

const self = {
  id: "self",
  backendId: "backend-self",
  realtimeUserId: "usrCurrent0001",
  role: "employee",
};
const employee = {
  id: "employee-1",
  backendId: "backend-employee-1",
  realtimeUserId: "usrEmployee01",
  role: "employee",
};
const admin = {
  id: "admin-1",
  realtimeUserId: "usrAdmin00001",
  role: "admin",
};
const moderator = {
  id: "moderator-1",
  realtimeUserId: "usrModerator1",
  role: "moderator",
};
const users = [self, employee, admin, moderator];

test("forbids calls to the current user through every known identity", () => {
  for (const identity of ["self", "backend-self", "usrCurrent0001"]) {
    const result = resolveCallParticipants({
      caller: self,
      callerRealtimeUserId: "usrCurrent0001",
      participantIds: [identity],
      users,
    });
    assert.equal(result.restriction, "self_call");
    assert.deepEqual(result.participantIds, []);
  }
  assert.equal(
    callRestrictionMessage("self_call"),
    "Нельзя позвонить самому себе.",
  );
});

test("allows an employee to call another employee", () => {
  assert.equal(getDirectCallRestriction(self, employee), null);
  const result = resolveCallParticipants({
    caller: self,
    callerRealtimeUserId: "usrCurrent0001",
    participantIds: ["usrEmployee01"],
    users,
  });
  assert.equal(result.restriction, null);
  assert.deepEqual(result.participantIds, ["employee-1"]);
});

test("forbids an employee from calling admins and moderators", () => {
  assert.equal(
    getDirectCallRestriction(self, admin),
    "privileged_target",
  );
  assert.equal(
    getDirectCallRestriction(self, moderator),
    "privileged_target",
  );
  assert.match(
    callRestrictionMessage("privileged_target"),
    /администраторам и модераторам недоступны/,
  );
});

test("keeps privileged callers unrestricted except for self calls", () => {
  const privilegedCaller = { ...admin, id: "self" };
  assert.equal(getDirectCallRestriction(privilegedCaller, employee), null);
  assert.equal(getDirectCallRestriction(privilegedCaller, moderator), null);
  assert.equal(
    getDirectCallRestriction(privilegedCaller, privilegedCaller),
    "self_call",
  );
});

test("removes self from a group call but rejects a privileged target", () => {
  const allowedGroup = resolveCallParticipants({
    caller: self,
    callerRealtimeUserId: "usrCurrent0001",
    participantIds: ["usrCurrent0001", "usrEmployee01"],
    users,
  });
  assert.equal(allowedGroup.restriction, null);
  assert.deepEqual(allowedGroup.participantIds, ["employee-1"]);

  const forbiddenGroup = resolveCallParticipants({
    caller: self,
    callerRealtimeUserId: "usrCurrent0001",
    participantIds: ["employee-1", "moderator-1"],
    users,
  });
  assert.equal(forbiddenGroup.restriction, "privileged_target");
  assert.deepEqual(forbiddenGroup.participantIds, []);
});

test("fails closed when a call participant cannot be resolved", () => {
  const result = resolveCallParticipants({
    caller: self,
    callerRealtimeUserId: "usrCurrent0001",
    participantIds: ["usrUnknown0001"],
    users,
  });
  assert.equal(result.restriction, "unknown_participant");
});
