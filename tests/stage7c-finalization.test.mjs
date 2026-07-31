import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const pagePath = new URL("../app/page.tsx", import.meta.url);

const acceptancePath = new URL(
  "../docs/STAGE7C_TWO_USER_ACCEPTANCE_RU.md",
  import.meta.url,
);

for (const accidentalPath of ["../app/sd", "../app/gdg"]) {
  test(`temporary duplicate ${accidentalPath} is absent`, () => {
    assert.equal(existsSync(new URL(accidentalPath, import.meta.url)), false);
  });
}

test("two-user acceptance document starts with its Stage 7C heading", () => {
  const contents = readFileSync(acceptancePath, "utf8");
  assert.match(contents, /^# Stage 7C — проверка Web ↔ Tinode двумя пользователями\r?\n/);
});

test("page imports getChatPreview from chat-list-policy", () => {
  const contents = readFileSync(pagePath, "utf8");
  assert.match(
    contents,
    /import\s*\{[\s\S]*?\bgetChatPreview\b[\s\S]*?\}\s*from\s*["']\.\/chat-list-policy\.mjs["'];/,
  );
});
