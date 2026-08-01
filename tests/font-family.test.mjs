import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("uses Arial as the global application font", () => {
  assert.match(
    css,
    /body\s*\{[\s\S]*?font-family:\s*Arial,\s*Helvetica,\s*sans-serif;/,
  );
  assert.doesNotMatch(
    css,
    /body\s*\{[\s\S]*?font-family:[\s\S]*?var\(--font-geist-sans\)/,
  );
});

test("form controls inherit the global Arial font", () => {
  assert.match(
    css,
    /button,\s*\ninput,\s*\ntextarea\s*\{[\s\S]*?font:\s*inherit;/,
  );
});
