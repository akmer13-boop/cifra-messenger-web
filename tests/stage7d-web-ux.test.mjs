import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);

test("hides the organization role switcher from employees", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /\{role !== "employee" \? \([\s\S]*?className=\{`role-preview/);
});

test("keeps reply context until accepted and publishes a real quoted reply", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /const result = await onSend\(value, \{[\s\S]*?replyToText:/);
  assert.match(
    page,
    /if \(result !== "sent"\) \{[\s\S]*?setSendError\([\s\S]*?return;[\s\S]*?setDraft\(\(current\) =>/,
  );
  assert.match(page, /publishText\(chatId, normalizedText, \{[\s\S]*?replyToAuthorId:/);
  assert.match(page, /repliedMessage \|\| message\.replyPreview/);
});

test("creates backend groups asynchronously and shows creation errors", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /const createGroup = async \(/);
  assert.match(page, /resolveRealtimeMemberIds\(users, memberIds\)/);
  assert.match(page, /realtimeClient\.createGroup\(name, members\.resolved\)/);
  assert.match(page, /className="group-creation-error"/);
});

test("deduplicates realtime people, keeps the current user visible, and removes Tinode wording", async () => {
  const page = await readFile(pageUrl, "utf8");
  assert.match(page, /mergeRealtimeParticipantsIntoDirectory\(/);
  assert.match(page, /person\.id === "self"/);
  assert.doesNotMatch(page, /["'`]([^"'`]*Tinode[^"'`]*)["'`]/);
});

test("filters mock calls in backend mode and offers the mirror glass theme", async () => {
  const [page, css] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);
  assert.match(page, /filterCallsForRuntime\(runtimeMode, calls, users\)/);
  assert.match(page, /runtimeMode=\{authMode\}/);
  assert.match(page, /title: "Зеркальная"/);
  assert.match(page, /Сине-серебристое зеркало · мягкие переливы/);
  assert.match(css, /\.theme-mirror\s*\{/);
  assert.match(css, /\.theme-mirror\s*\{[^}]*--page:\s*#061625/s);
  assert.match(css, /\.theme-mirror\s*\{[^}]*--muted:\s*#aabccb/s);
  assert.match(css, /backdrop-filter:\s*blur\(28px\)/);
  assert.match(css, /@keyframes mirror-shimmer/);
  assert.match(css, /@keyframes mirror-reflection/);
  assert.match(css, /@keyframes mirror-waves/);
  assert.match(css, /@keyframes mirror-sheen/);
});
