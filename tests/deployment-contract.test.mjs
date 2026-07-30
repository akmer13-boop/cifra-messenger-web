import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageUrl = new URL("../package.json", import.meta.url);
const amveraUrl = new URL("../amvera.yml", import.meta.url);
const pageUrl = new URL("../app/page.tsx", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);
const postcssUrl = new URL("../postcss.config.mjs", import.meta.url);

test("uses a static Next.js export for Amvera Browser", async () => {
  const [packageSource, amvera] = await Promise.all([
    readFile(packageUrl, "utf8"),
    readFile(amveraUrl, "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.equal(packageJson.scripts.build, "next build");
  assert.equal(packageJson.scripts.start, undefined);
  assert.equal(packageJson.dependencies.vinext, undefined);
  assert.equal(packageJson.devDependencies?.wrangler, undefined);

  assert.match(amvera, /environment:\s*node/);
  assert.match(amvera, /name:\s*browser/);
  assert.match(amvera, /"out\/\*":\s*\//);
  assert.doesNotMatch(amvera, /run:/);
  assert.doesNotMatch(amvera, /containerPort:/);
});

test("contains desktop split view and mobile chat navigation contracts", async () => {
  const [page, css] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(page, /web-workspace web-workspace-\$\{activeTab\}/);
  assert.match(page, /className="chat-directory"/);
  assert.match(page, /className="conversation-stage"/);
  assert.match(page, /className="desktop-chat-empty"/);
  assert.match(
    page,
    /sessionActive &&\s*!authSession\?\.context\.must_change_password \? \(\s*<TabBar/,
  );

  assert.match(css, /@media \(min-width: 901px\)/);
  assert.match(
    css,
    /\.web-workspace-chats\s*\{[^}]*grid-template-columns:/s,
  );
  assert.match(
    css,
    /\.web-workspace\.is-chat-open \.chat-directory\s*\{[^}]*display: none/s,
  );
  assert.match(
    css,
    /\.app-screen\.chat-open \.tab-bar\s*\{[^}]*display: none/s,
  );
});

test("overwrites stale Tailwind PostCSS configuration", async () => {
  const [packageSource, css, postcss] = await Promise.all([
    readFile(packageUrl, "utf8"),
    readFile(cssUrl, "utf8"),
    readFile(postcssUrl, "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.equal(packageJson.devDependencies?.["@tailwindcss/postcss"], undefined);
  assert.doesNotMatch(css, /@import\s+["']tailwindcss["']/);
  assert.doesNotMatch(postcss, /@tailwindcss\/postcss/);
  assert.match(postcss, /plugins:\s*\{\}/);
});
