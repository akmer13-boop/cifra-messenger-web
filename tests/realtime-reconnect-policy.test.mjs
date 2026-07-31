import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadRealtimeModule() {
  const source = await readFile(
    new URL("../app/cifra-realtime.ts", import.meta.url),
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  return import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
}

test("uses bounded exponential backoff for realtime reconnects", async () => {
  const { getRealtimeReconnectDelay } = await loadRealtimeModule();

  assert.equal(getRealtimeReconnectDelay(0), 1_000);
  assert.equal(getRealtimeReconnectDelay(1), 2_000);
  assert.equal(getRealtimeReconnectDelay(4), 16_000);
  assert.equal(getRealtimeReconnectDelay(5), 30_000);
  assert.equal(getRealtimeReconnectDelay(20), 30_000);
  assert.equal(getRealtimeReconnectDelay(-1, 250, 2_000), 250);
  assert.equal(getRealtimeReconnectDelay(3, 0, 0), 0);
});

test("requests only missing Tinode history after the last local sequence", async () => {
  const { buildTinodeHistoryQuery } = await loadRealtimeModule();
  const topic = "grpAbCdEfGhI12";
  const messages = [
    {
      topic,
      seq: 7,
      timestamp: "2026-07-31T09:00:00.000Z",
      content: "Последнее сохранённое",
    },
    {
      topic: "usrZyXwVuTsR10",
      seq: 50,
      timestamp: "2026-07-31T09:01:00.000Z",
      content: "Другой чат",
    },
  ];

  assert.deepEqual(buildTinodeHistoryQuery(topic, 20, [], 100), {
    limit: 20,
  });
  assert.deepEqual(buildTinodeHistoryQuery(topic, 20, messages, 9), {
    since: 8,
    limit: 20,
  });
  assert.deepEqual(buildTinodeHistoryQuery(topic, 20, messages, 200), {
    since: 8,
    limit: 100,
  });
});
