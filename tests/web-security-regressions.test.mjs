import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const apiUrl = new URL("../app/cifra-api.ts", import.meta.url);

test("starts fail-closed and never persists auth tokens in Web Storage", async () => {
  const [page, api] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(apiUrl, "utf8"),
  ]);

  assert.match(page, /useState<RuntimeMode>\("backend"\)/);
  assert.match(page, /useState<Chat\[]>\(\[\]\)/);
  assert.match(page, /useState<MessengerUser\[]>\(\[\]\)/);
  assert.match(api, /Tokens intentionally live in memory only/);
  assert.doesNotMatch(api, /sessionStorage\.setItem/);
  assert.doesNotMatch(api, /localStorage\.setItem\([^\n]*token/i);
});

test("renders explicit backend retry states instead of demo empty fallbacks", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /type DirectoryStatus = "idle" \| "loading" \| "ready" \| "empty" \| "error"/);
  assert.match(page, /realtimeListStatus === "reconnecting"/);
  assert.match(page, /Не удалось загрузить чаты/);
  assert.match(page, /Каталог сотрудников пуст/);
  assert.match(page, /onRetryRealtime=\{retryRealtime\}/);
  assert.match(page, /onRetryDirectory=\{retryBackendDirectory\}/);
});

test("keeps account lifecycle separate from presence and secures compose modal", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /Account lifecycle status is not presence/);
  assert.doesNotMatch(page, /online: user\.status === "active"/);
  assert.match(page, /element\.inert = true/);
  assert.match(page, /previouslyFocused\?\.focus\(\)/);
  assert.match(page, /event\.key !== "Tab"/);
});

test("validates avatar uploads and revokes owned blob URLs", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /validateAvatarFile\(file\)/);
  assert.match(page, /URL\.revokeObjectURL\(avatarPreviewUrlRef\.current\)/);
  assert.match(page, /releaseOwnedAvatarUrls/);
  assert.match(page, /image\/png,image\/jpeg,image\/webp,image\/avif/);
});
