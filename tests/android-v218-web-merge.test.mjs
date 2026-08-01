import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);

test("ports Android 2.1.8 reply gestures and quoted messages to Web", async () => {
  const [page, css] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(page, /replyToId\?: number/);
  assert.match(page, /gesture\.offset = Math\.max\(-72, Math\.min\(0, deltaX\)\)/);
  assert.match(page, /gesture\.offset <= -42/);
  assert.match(page, /setReplyingToMessageId\(messageId\)/);
  assert.match(page, /className="reply-selection"/);
  assert.match(page, /className="message-quote"/);
  assert.match(page, /replyToId: replyingToMessage\?\.id/);
  assert.match(css, /\.message-reply-indicator\s*\{/);
  assert.match(css, /\.reply-selection\s*\{/);
  assert.match(css, /\.message-quote\s*\{/);
});

test("supports copy, dynamic pins and forwarding from message actions", async () => {
  const [page, css] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(page, /forwardedFrom\?: string/);
  assert.match(page, /pinnedAt\?: number/);
  assert.match(page, /\.filter\(\(message\) => message\.pinned\)/);
  assert.doesNotMatch(
    page,
    /message\.id === 2 \|\| message\.id === 5/,
  );
  assert.match(page, /navigator\.clipboard\?\.writeText/);
  assert.match(page, />Скопировать</);
  assert.match(page, /contextMessage\.pinned \? "Открепить" : "Закрепить"/);
  assert.match(page, />Переслать</);
  assert.match(page, /className="bottom-sheet forward-picker-sheet"/);
  assert.match(page, /placeholder="Поиск чата"/);
  assert.match(page, /visibleForwardChats\.map\(\(target\)/);
  assert.match(page, /onForwardMessage\(messageId, target\.id\)/);
  assert.match(page, /forwardedFrom,/);
  assert.match(css, /\.message-context-actions\s*\{/);
  assert.match(css, /\.forward-target-list\s*\{/);
  assert.match(css, /\.forwarded-message-label\s*\{/);
});

test("keeps a persistent dynamic call journal and accepts call events", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /const \[calls, setCalls\] = useState<CallRecord\[]>/);
  assert.match(page, /"cifra-call-history"/);
  assert.match(page, /JSON\.stringify\(calls\.slice\(0, 100\)\)/);
  assert.match(page, /calls=\{calls\}/);
  assert.match(page, /\{visibleCalls\.map\(\(call, index\) =>/);
  assert.match(page, /buildCallRecord\(participantIds, "out", users, chatItems\)/);
  assert.match(page, /\[record, \.\.\.current\]\.slice\(0, 100\)/);
  assert.match(page, /"cifra:incoming-call"/);
  assert.match(page, /detail\.missed \? "missed" : "in"/);
  assert.match(page, /if \(!detail\.missed\) \{/);
});
