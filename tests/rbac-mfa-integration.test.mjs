import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canAuditChats,
  canManageUsers,
  permissionsFor,
  primaryRole,
  requiresMfa,
  roleFromWire,
  wireRole,
} from "../app/auth-policy.mjs";

const apiUrl = new URL("../app/cifra-api.ts", import.meta.url);
const pageUrl = new URL("../app/page.tsx", import.meta.url);
const runtimeUrl = new URL(
  "../public/cifra-runtime-config.backend.example.json",
  import.meta.url,
);

test("maps APK/backend roles without granting moderator admin mutations", () => {
  assert.equal(roleFromWire("security_moderator"), "moderator");
  assert.equal(wireRole("moderator"), "security_moderator");
  assert.equal(
    primaryRole(["employee", "security_moderator"]),
    "moderator",
  );
  assert.equal(primaryRole(["employee", "admin"]), "admin");
  assert.equal(requiresMfa("admin"), true);
  assert.equal(requiresMfa("moderator"), true);
  assert.equal(requiresMfa("employee"), false);
  assert.equal(canAuditChats("moderator"), true);
  assert.equal(canManageUsers("moderator"), false);
  assert.equal(canManageUsers("admin"), true);
  assert.deepEqual(permissionsFor(["moderator"]), [
    "users.read",
    "chats.view_all",
    "chats.moderate",
  ]);
});

test("uses the exact supplied gateway authentication contract", async () => {
  const api = await readFile(apiUrl, "utf8");

  assert.match(api, /"\/api\/v1\/auth\/login"/);
  assert.match(api, /"\/api\/v1\/auth\/mfa\/verify"/);
  assert.match(api, /"\/api\/v1\/auth\/refresh"/);
  assert.match(api, /"\/api\/v1\/auth\/logout"/);
  assert.match(api, /"\/api\/v1\/auth\/context"/);
  assert.match(api, /"\/api\/v1\/auth\/password\/change"/);
  assert.match(api, /challenge_token: challengeToken/);
  assert.match(api, /refresh_token: current\.tokens\.refresh_token/);
  assert.match(api, /REFRESHABLE_ACCESS_ERRORS\.has\(error\.code\)/);
  assert.match(api, /this\.invalidateIfTerminal\(error, "refresh"\)/);
  assert.match(api, /this\.setSession\(\{ \.\.\.current, tokens \}\)/);
  assert.match(api, /platform: "web"/);
  assert.match(api, /"Idempotency-Key": crypto\.randomUUID\(\)/);
  assert.match(api, /"If-Match": String\(version\)/);
});

test("keeps production mode explicit and role assignment server-backed", async () => {
  const [page, runtimeSource] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(runtimeUrl, "utf8"),
  ]);
  const runtime = JSON.parse(runtimeSource);

  assert.equal(runtime.mode, "backend");
  assert.equal(runtime.apiBaseUrl, "");
  assert.match(page, /role === "moderator"/);
  assert.match(page, /setUserRoles\(/);
  assert.match(page, /corporateRolesFor\(updatedUser\.role\)/);
  assert.match(page, /readOnly=\{!canManageUsers\(role\)\}/);
  assert.match(page, /canAuditChats\(role\)/);
  assert.match(page, /authSession\?\.context\.must_change_password/);
  assert.match(
    page,
    /authSession\?\.context\.must_change_password \? null : \(/,
  );
  assert.match(page, /<PasswordChangeOverlay/);
});
