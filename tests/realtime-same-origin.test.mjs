import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const realtimeUrl = new URL("../app/cifra-realtime.ts", import.meta.url);

async function loadRealtimeModule() {
  const source = await readFile(realtimeUrl, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
}

test("resolves an empty API base against the page origin", async () => {
  const { resolveApiSecurityUrl } = await loadRealtimeModule();
  const resolved = resolveApiSecurityUrl(
    "",
    "https://cifraweb-staging-ilyaman.amvera.io",
  );

  assert.equal(
    resolved.origin,
    "https://cifraweb-staging-ilyaman.amvera.io",
  );
});

test("resolves relative API paths and rejects an originless empty base", async () => {
  const { resolveApiSecurityUrl } = await loadRealtimeModule();
  assert.equal(
    resolveApiSecurityUrl("/gateway", "https://web.example.test").href,
    "https://web.example.test/gateway",
  );
  assert.throws(() => resolveApiSecurityUrl("", ""), /requires page origin/);
});

test("same-origin validation retains TLS and secret leak guards", async () => {
  const realtime = await readFile(realtimeUrl, "utf8");

  assert.match(realtime, /resolveApiSecurityUrl\(apiBaseUrl, pageOrigin\)/);
  assert.match(realtime, /apiUrl\.protocol === "https:"/);
  assert.match(realtime, /endpoint\.protocol !== "wss:"/);
  assert.match(realtime, /secret_exposed_in_websocket_url/);
  assert.match(realtime, /internal_realtime_endpoint_exposed/);
});
