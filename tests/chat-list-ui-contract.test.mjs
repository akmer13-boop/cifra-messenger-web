import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageUrl = new URL("../app/page.tsx", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);

test("shows sent, delivered and read status for the latest outgoing chat row", async () => {
  const [page, css] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(page, /chat\.lastMessageSide === "out"/);
  assert.match(
    page,
    /className=\{`chat-delivery-status is-\$\{chat\.lastDeliveryStatus\}`\}/,
  );
  assert.match(page, /chat\.lastDeliveryStatus === "sent"/);
  assert.match(page, /<CheckCheck[\s\S]*aria-hidden="true"/);
  assert.match(
    css,
    /\.chat-delivery-status\.is-read\s*\{[^}]*color:\s*var\(--notification\)/s,
  );
});

test("updates chat rows from both outgoing and incoming message paths", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(
    page,
    /setChatItems\(\(current\) =>[\s\S]*?withLatestMessage\([\s\S]*?incomingMessage/,
  );
  assert.match(
    page,
    /window\.addEventListener\("cifra:incoming-message", handleIncomingMessage\)/,
  );
  assert.match(
    page,
    /withLatestMessage\(chat, outgoingMessage, activityOrder\)/,
  );
  assert.match(
    page,
    /withLatestDeliveryStatus\(chat, messageId, deliveryStatus\)/,
  );
});

test("sorts visible and archived chat rows by activity", async () => {
  const page = await readFile(pageUrl, "utf8");

  assert.match(page, /const archivedChats = sortChatsByActivity\(/);
  assert.match(
    page,
    /const visibleChats = useMemo\(\(\) => \{[\s\S]*?return sortChatsByActivity\(/,
  );
});
