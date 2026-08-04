import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  classifySessionInvalidation,
  sessionInvalidationMessage,
} from "../app/session-recovery-policy.mjs";

const apiUrl = new URL("../app/cifra-api.ts", import.meta.url);
const errorUrl = new URL("../app/error.tsx", import.meta.url);
const pageUrl = new URL("../app/page.tsx", import.meta.url);

test("keeps transport and reconnect failures inside the active session", () => {
  for (const code of [
    "NETWORK_ERROR",
    "REQUEST_TIMEOUT",
    "REQUEST_CANCELLED",
    "realtime_not_connected",
  ]) {
    assert.equal(classifySessionInvalidation({ code }, "authorized"), null);
    assert.equal(classifySessionInvalidation({ code }, "refresh"), null);
  }
  assert.equal(
    classifySessionInvalidation({ code: "AUTH_REQUIRED" }, "authorized"),
    null,
    "the first authorized 401 must attempt refresh, not force logout",
  );
});

test("invalidates only an explicitly terminal session or rejected refresh", () => {
  assert.equal(
    classifySessionInvalidation({ code: "SESSION_REVOKED" }, "authorized"),
    "revoked",
  );
  assert.equal(
    classifySessionInvalidation({ code: "ACCOUNT_UNAVAILABLE" }, "authorized"),
    "account_unavailable",
  );
  assert.equal(
    classifySessionInvalidation({ code: "AUTH_REQUIRED" }, "after_refresh"),
    "expired",
  );
  assert.equal(
    classifySessionInvalidation({ code: "REFRESH_TOKEN_INVALID" }, "refresh"),
    "expired",
  );
  assert.equal(
    classifySessionInvalidation({ code: "REFRESH_TOKEN_REUSE" }, "refresh"),
    "revoked",
  );
  assert.equal(
    classifySessionInvalidation(
      { code: "REFRESH_ROTATION_CONFLICT" },
      "refresh",
    ),
    "expired",
  );
  assert.match(sessionInvalidationMessage("expired"), /Сессия истекла/);
  assert.match(sessionInvalidationMessage("revoked"), /завершена сервером/);
});

test("wires one-shot session invalidation to a safe re-login state", async () => {
  const [api, page] = await Promise.all([
    readFile(apiUrl, "utf8"),
    readFile(pageUrl, "utf8"),
  ]);

  assert.match(api, /onSessionInvalidated\(listener: SessionInvalidationListener\)/);
  assert.match(api, /this\.invalidateIfTerminal\(error, "refresh"\)/);
  assert.match(api, /this\.setSession\(\{ \.\.\.current, tokens \}\)/);
  assert.doesNotMatch(
    api,
    /\.catch\(\(error: unknown\) => \{\s*this\.clearSession\(\)/,
  );
  assert.match(page, /client\.onSessionInvalidated\(\s*handleSessionInvalidated/);
  assert.match(page, /setSessionNotice\(sessionInvalidationMessage\(reason\)\)/);
  assert.match(page, /notice=\{sessionNotice\}/);
});

test("runtime error boundary exposes only a bounded digest and offers recovery", async () => {
  const source = await readFile(errorUrl, "utf8");

  assert.match(source, /error\.digest\?\.trim\(\)/);
  assert.match(source, /\^\[A-Za-z0-9\._-\]\{1,128\}\$/);
  assert.match(source, /onClick=\{reset\}/);
  assert.match(source, /window\.location\.reload\(\)/);
  assert.doesNotMatch(source, /error\.(?:message|stack|cause)/);
  assert.doesNotMatch(source, /console\.(?:log|error|warn)/);
});
