import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);
const layoutUrl = new URL("../app/layout.tsx", import.meta.url);

function relativeLuminance(hex) {
  const channels = hex
    .replace("#", "")
    .match(/.{2}/g)
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4,
    );
  return (
    0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  );
}

function contrastRatio(first, second) {
  const light = Math.max(relativeLuminance(first), relativeLuminance(second));
  const dark = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (light + 0.05) / (dark + 0.05);
}

test("keeps removed chat and call labels out of the interface", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.doesNotMatch(page, /Пространство CIFRA/);
  assert.doesNotMatch(page, /Создать ссылку на звонок/);
  assert.doesNotMatch(page, />Изменить<\/button>/);
  assert.doesNotMatch(page, /Медиа из переписки/);
});

test("includes searchable participant and group-call flows", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /placeholder="Найти контакт"/);
  assert.match(page, /placeholder="Найти участника"/);
  assert.match(page, /Групповой звонок/);
  assert.match(page, /Создать звонок/);
  assert.match(page, /selectedParticipantIds\.length < 2/);
});

test("keeps media in a three-column grid and aligns chat filters", async () => {
  const css = await readFile(cssUrl, "utf8");

  assert.match(
    css,
    /\.conversation-media-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s,
  );
  assert.match(
    css,
    /@media \(max-width: 360px\)[\s\S]*?\.filter-strip\s*\{[^}]*padding-left:\s*16px/s,
  );
});

test("places contact data above the conversation media grid", async () => {
  const page = await readFile(pageUrl, "utf8");
  const profileStart = page.indexOf('{activePanel === "profile"');
  const profileEnd = page.indexOf(
    '{activePanel === "participants"',
    profileStart,
  );
  const profilePanel = page.slice(profileStart, profileEnd);

  assert.ok(profileStart >= 0 && profileEnd > profileStart);
  assert.ok(
    profilePanel.indexOf('className="conversation-contact-card"') <
      profilePanel.indexOf('className="profile-section-heading"'),
  );
});

test("does not show online dots in the group-call contact picker", async () => {
  const page = await readFile(pageUrl, "utf8");
  const listStart = page.indexOf('className="group-call-contact-list"');
  const listEnd = page.indexOf('className="create-call-button"', listStart);
  const groupCallList = page.slice(listStart, listEnd);

  assert.ok(listStart >= 0 && listEnd > listStart);
  assert.doesNotMatch(groupCallList, /online=\{person\.online\}/);
});

test("shows the real participant list and derives counts from chat membership", async () => {
  const page = await readFile(pageUrl, "utf8");
  const settingsStart = page.indexOf('{activePanel === "settings" ? (');
  const settingsEnd = page.indexOf(
    '{activePanel === "pinned"',
    settingsStart,
  );
  const settingsPanel = page.slice(settingsStart, settingsEnd);

  assert.ok(settingsStart >= 0 && settingsEnd > settingsStart);
  assert.match(page, /const formatParticipantCount = \(count: number\)/);
  assert.match(
    page,
    /chat\.kind === "group" \? \(chat\.memberIds \?\? \[\]\) : \[chat\.id\]/,
  );
  assert.match(page, /const conversationMembers = conversationParticipantIds/);
  assert.match(page, /onAddParticipants\(selectedParticipantIds\)/);
  assert.match(page, /const addChatParticipants = \(/);
  assert.match(
    page,
    /new Set\(\[\.\.\.\(chat\.memberIds \?\? \[\]\), \.\.\.participantIds\]\)/,
  );
  assert.match(settingsPanel, /className="settings-participant-list"/);
  assert.match(settingsPanel, /conversationMembers\.map\(\(participant\)/);
  assert.doesNotMatch(page, /8 участников в сети/);
  assert.doesNotMatch(page, /const conversationParticipants/);
});

test("offers four persistent profile themes and keeps blue notifications", async () => {
  const [page, css] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(page, /type Theme = "navy" \| "black" \| "sage" \| "gray"/);
  assert.match(page, /Сменить тему/);
  assert.match(page, /Шалфейная/);
  assert.match(page, /Серая/);
  assert.match(page, /storedTheme === "sage"/);
  assert.match(page, /storedTheme === "gray"/);
  assert.match(css, /\.theme-sage\s*\{[^}]*--accent-deep:\s*#99cc99/s);
  assert.match(css, /\.theme-gray\s*\{[^}]*--muted:\s*#999999/s);
  assert.match(css, /\.theme-sage\s*\{[^}]*--notification:\s*#0b73d9/s);
  assert.match(css, /\.theme-gray\s*\{[^}]*--notification:\s*#0b73d9/s);
});

test("keeps notification badge text at WCAG AA contrast", async () => {
  const css = await readFile(cssUrl, "utf8");
  const notificationColor = css.match(
    /:root\s*\{[\s\S]*?--notification:\s*(#[0-9a-f]{6})/i,
  )?.[1];

  assert.ok(notificationColor);
  assert.ok(
    contrastRatio("#ffffff", notificationColor) >= 4.5,
    `White text contrast is too low on ${notificationColor}`,
  );
});

test("keeps the iPhone standalone metadata and disables automatic data links", async () => {
  const layout = await readFile(layoutUrl, "utf8");

  assert.match(layout, /appleWebApp:\s*\{/);
  assert.match(layout, /statusBarStyle: "black-translucent"/);
  assert.match(layout, /title: "CIFRA"/);
  assert.match(layout, /formatDetection:\s*\{/);
  assert.match(layout, /telephone: false/);
  assert.match(layout, /viewportFit: "cover"/);
});
