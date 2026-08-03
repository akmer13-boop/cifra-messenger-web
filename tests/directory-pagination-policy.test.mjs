import assert from "node:assert/strict";
import test from "node:test";

import { collectDirectoryPages } from "../app/directory-pagination-policy.mjs";

const user = (id) => ({ id, login: `user-${id}` });

test("loads 250 directory users across cursor pages and removes duplicates", async () => {
  const allUsers = Array.from({ length: 250 }, (_, index) => user(String(index)));
  const requestedCursors = [];
  const pageByCursor = new Map([
    [null, { items: allUsers.slice(0, 100), next_cursor: "page-2" }],
    [
      "page-2",
      { items: [allUsers[25], ...allUsers.slice(100, 200)], next_cursor: "page-3" },
    ],
    ["page-3", { items: allUsers.slice(200), next_cursor: null }],
  ]);

  const result = await collectDirectoryPages(async (cursor) => {
    requestedCursors.push(cursor);
    return pageByCursor.get(cursor);
  });

  assert.deepEqual(requestedCursors, [null, "page-2", "page-3"]);
  assert.equal(result.items.length, 250);
  assert.equal(new Set(result.items.map(({ id }) => id)).size, 250);
  assert.equal(result.next_cursor, null);
});

test("fails closed when the backend repeats a directory cursor", async () => {
  await assert.rejects(
    collectDirectoryPages(async () => ({
      items: [],
      next_cursor: "same-cursor",
    })),
    /cursor cycle detected/,
  );
});

test("fails closed at the configured directory page limit", async () => {
  await assert.rejects(
    collectDirectoryPages(
      async (cursor) => ({
        items: [],
        next_cursor: cursor === null ? "page-2" : "page-3",
      }),
      { maxPages: 2 },
    ),
    /page limit exceeded/,
  );
});
