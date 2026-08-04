import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssUrl = new URL("../app/globals.css", import.meta.url);

test("every declared font size includes the one-pixel web increase", async () => {
  const css = await readFile(cssUrl, "utf8");
  const declarations = [...css.matchAll(/font-size:\s*([^;]+);/g)].map(
    ([, value]) => value.trim(),
  );

  assert.ok(declarations.length >= 247);

  for (const value of declarations) {
    assert.match(value, /^calc\(.+\s\+\s1px\)$/);
  }
});
