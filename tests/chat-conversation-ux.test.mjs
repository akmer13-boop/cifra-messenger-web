import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("incoming messages render a visible read receipt", () => {
  assert.match(
    page,
    /message\.side === "in" \? "read" : message\.deliveryStatus/,
  );
});

test("conversation keeps a bottom sentinel and retries scroll after layout settles", () => {
  assert.match(page, /const messageEndRef = useRef<HTMLDivElement \| null>\(null\)/);
  assert.match(page, /messageEndRef\.current\?\.scrollIntoView/);
  assert.match(page, /\[80, 280\]\.map/);
  assert.match(page, /className="message-list-end"/);
});

test("composer textarea never exposes browser scrollbar arrows", () => {
  assert.match(css, /\.composer-input textarea \{[\s\S]*overflow-y: hidden;/);
  assert.match(css, /\.composer-input textarea::\-webkit-scrollbar \{[\s\S]*display: none;/);
});
