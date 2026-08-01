import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);

test("all outgoing call entry points pass through the central policy", async () => {
  const page = await readFile(pageUrl, "utf8");
  const start = page.indexOf("const startCall =");
  const end = page.indexOf("const selectedChatCallParticipants", start);
  const handler = page.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(handler, /resolveCallParticipants\(\{/);
  assert.match(handler, /caller: currentUser/);
  assert.match(handler, /callerRealtimeUserId: realtimeUserId/);
  assert.match(handler, /callRestrictionMessage\(resolved\.restriction\)/);
  assert.match(page, /onCallUser=\{\(id\) => startCall\(\[id\]\)\}/);
  assert.match(page, /onCall=\{startCall\}/);
  assert.match(page, /onCall=\{\(id\) => \{[\s\S]*?startCall\(\[id\]\)/);
});

test("restricted call actions are disabled before an employee can press them", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(
    page,
    /const callRestriction = getDirectCallRestriction\([\s\S]*?currentUser,[\s\S]*?person/,
  );
  assert.match(page, /disabled=\{Boolean\(callRestriction\)\}/);
  assert.match(
    page,
    /const visibleContacts = users\.filter\([\s\S]*?!getDirectCallRestriction\(currentUser, user\)/,
  );
  assert.match(
    page,
    /disabled=\{chat\.deleted \|\| Boolean\(callUnavailableReason\)\}/,
  );
});
