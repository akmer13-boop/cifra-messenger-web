import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  calculateDirectoryWindow,
  createDirectoryRequestEpoch,
  mergeDirectoryPage,
  normalizeDirectoryQuery,
} from "../app/directory-release-policy.mjs";

const user = (id, name = `Employee ${id}`) => ({ id, name });

test("merges ten cursor pages for 1000 employees without duplicates", () => {
  let items = [];
  const seenCursors = new Set();
  let requestedCursor = null;

  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const start = pageNumber * 100;
    const nextCursor = pageNumber === 9 ? null : `page-${pageNumber + 2}`;
    const pageItems = Array.from({ length: 100 }, (_, offset) =>
      user(String(start + offset)),
    );
    if (pageNumber > 0) pageItems.unshift(user("42", "Updated employee"));

    const merged = mergeDirectoryPage(
      items,
      { items: pageItems, next_cursor: nextCursor },
      { requestedCursor, seenCursors },
    );
    items = merged.items;
    if (merged.next_cursor) seenCursors.add(merged.next_cursor);
    requestedCursor = merged.next_cursor;
  }

  assert.equal(items.length, 1000);
  assert.equal(new Set(items.map(({ id }) => id)).size, 1000);
  assert.equal(items.find(({ id }) => id === "42")?.name, "Updated employee");
});

test("fails closed on repeated or cyclic directory cursors", () => {
  assert.throws(
    () =>
      mergeDirectoryPage([], { items: [], next_cursor: "page-2" }, {
        requestedCursor: "page-2",
      }),
    /cursor cycle detected/,
  );
  assert.throws(
    () =>
      mergeDirectoryPage([], { items: [], next_cursor: "page-2" }, {
        requestedCursor: "page-3",
        seenCursors: new Set(["page-2", "page-3"]),
      }),
    /cursor cycle detected/,
  );
});

test("search epoch rejects an older response after query changes", () => {
  const epoch = createDirectoryRequestEpoch();
  const first = epoch.next();
  const second = epoch.next();
  assert.equal(epoch.isCurrent(first), false);
  assert.equal(epoch.isCurrent(second), true);
  epoch.invalidate();
  assert.equal(epoch.isCurrent(second), false);
  assert.equal(normalizeDirectoryQuery("  Анна   Смирнова  "), "Анна Смирнова");
});

test("windowing keeps the rendered slice bounded for 500 and 1000 rows", () => {
  for (const count of [500, 1000]) {
    const first = calculateDirectoryWindow(count, 0, 544, 68, 6);
    const middle = calculateDirectoryWindow(count, 17_000, 544, 68, 6);
    assert.ok(first.end - first.start <= 20);
    assert.ok(middle.end - middle.start <= 20);
    assert.equal(first.totalHeight, count * 68);
    assert.ok(middle.start > 0);
  }
});

test("page integrates cursor API, abortable search and a windowed list", async () => {
  const [page, api] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/cifra-api.ts", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /await client\.listAllUsers\(\)/);
  assert.match(page, /await client\.listUsers\("", null, controller\.signal\)/);
  assert.match(page, /requestEpochRef\.current\.isCurrent\(epoch\)/);
  assert.match(page, /controller\.abort\(\)/);
  assert.match(page, /function WindowedDirectoryList/);
  assert.match(api, /signal\?: AbortSignal/);
  assert.match(api, /REQUEST_CANCELLED/);
});
