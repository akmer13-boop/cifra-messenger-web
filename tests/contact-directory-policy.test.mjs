import assert from "node:assert/strict";
import test from "node:test";

import {
  filterCallsForRuntime,
  mergeRealtimeParticipantsIntoDirectory,
  resolveRealtimeMemberIds,
} from "../app/contact-directory-policy.mjs";

const backendUsers = [
  {
    id: "self",
    backendId: "backend-fillipov",
    name: "m fillipov",
    username: "m.fillipov",
    email: "fillipov@example.test",
    position: "Сотрудник",
  },
  {
    id: "backend-morozov",
    backendId: "backend-morozov",
    name: "i morozov",
    username: "i.morozov",
    email: "morozov@example.test",
    position: "Сотрудник",
  },
];

test("merges a realtime participant into the backend employee instead of duplicating it", () => {
  const result = mergeRealtimeParticipantsIntoDirectory(
    backendUsers,
    new Set(),
    [
      {
        id: "usrMorozov01",
        name: "i morozov",
        username: "i.morozov",
        avatar: "IM",
        online: true,
      },
      {
        id: "usrNewPerson02",
        name: "Новый сотрудник",
        username: "new.person",
        avatar: "НС",
        online: false,
      },
    ],
  );

  assert.equal(result.users.filter((user) => user.name === "i morozov").length, 1);
  assert.equal(
    result.users.find((user) => user.name === "i morozov")?.realtimeUserId,
    "usrMorozov01",
  );
  assert.equal(result.users.some((user) => user.id === "self"), true);
  assert.equal(
    result.users.find((user) => user.id === "usrNewPerson02")?.position,
    "Сотрудник",
  );
  assert.deepEqual([...result.participantIds].sort(), [
    "usrMorozov01",
    "usrNewPerson02",
  ]);
});

test("resolves selected directory rows to realtime user ids", () => {
  const merged = mergeRealtimeParticipantsIntoDirectory(
    backendUsers,
    new Set(),
    [
      {
        id: "usrMorozov01",
        name: "i morozov",
        username: "i.morozov",
        avatar: "IM",
        online: true,
      },
    ],
  );
  assert.deepEqual(
    resolveRealtimeMemberIds(merged.users, ["backend-morozov"]),
    { resolved: ["usrMorozov01"], unresolved: [] },
  );
});

test("hides mock call records in backend mode but keeps real participant calls", () => {
  const users = [
    ...backendUsers,
    { id: "usrMorozov01", realtimeUserId: "usrMorozov01" },
  ];
  const calls = [
    { participantIds: ["anna"], name: "Mock" },
    { participantIds: ["backend-morozov"], name: "Real backend" },
    { participantIds: ["usrMorozov01"], name: "Real realtime" },
  ];

  assert.deepEqual(
    filterCallsForRuntime("backend", calls, users).map((call) => call.name),
    ["Real backend", "Real realtime"],
  );
  assert.equal(filterCallsForRuntime("demo", calls, users).length, 3);
});

test("does not flash built-in demo calls before backend directory sync", () => {
  const demoOnlyUsers = [
    { id: "anna", name: "Анна" },
    { id: "ilya", name: "Илья" },
  ];
  const calls = [
    { participantIds: ["anna"], name: "Анна" },
    { participantIds: ["ilya"], name: "Илья" },
  ];
  assert.deepEqual(filterCallsForRuntime("backend", calls, demoOnlyUsers), []);
});
