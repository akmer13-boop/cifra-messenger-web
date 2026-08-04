import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const TOPIC = "usrHistoryPeer01";
const OTHER_TOPIC = "grpOtherTopic01";

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

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  readyState = FakeWebSocket.CONNECTING;
  listeners = new Map();
  sent = [];

  constructor() {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit("open", {});
    });
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(raw) {
    const packet = JSON.parse(raw);
    this.sent.push(packet);
    if (packet.hi) {
      this.reply({
        ctrl: { id: packet.hi.id, code: 201, params: { ver: "0.25" } },
      });
      return;
    }
    if (packet.login) {
      this.reply({
        ctrl: {
          id: packet.login.id,
          code: 200,
          params: { user: "usrAbCdEfGhI12", authlvl: "auth" },
        },
      });
      return;
    }
    if (packet.sub?.topic === "me") {
      this.reply({
        meta: {
          topic: "me",
          sub: [{ topic: TOPIC, seq: 120, acs: { mode: "JRWPA" } }],
        },
      });
      this.reply({ ctrl: { id: packet.sub.id, code: 200 } });
      return;
    }
    if (packet.sub?.topic === TOPIC) {
      for (let seq = 101; seq <= 120; seq += 1) this.replyData(TOPIC, seq);
      this.replyData(TOPIC, 110); // transport duplicate must not duplicate state
      this.reply({ ctrl: { id: packet.sub.id, code: 200, topic: TOPIC } });
      return;
    }
    if (packet.get?.topic === TOPIC && packet.get.what === "data") {
      const { before, limit } = packet.get.data;
      const first = Math.max(1, before - limit);
      this.replyData(OTHER_TOPIC, 1); // must never leak across topic scope
      for (let seq = first; seq < before; seq += 1) {
        this.replyData(TOPIC, seq);
      }
      this.replyData(TOPIC, first); // page duplicate is deduplicated
      this.reply({ ctrl: { id: packet.get.id, code: 200, topic: TOPIC } });
    }
  }

  replyData(topic, seq) {
    this.reply({
      data: {
        topic,
        seq,
        from: "usrHistorySender1",
        ts: new Date(Date.UTC(2026, 7, 4, 9, 0, seq)).toISOString(),
        head: { mime: "text/plain" },
        content: `message-${seq}`,
      },
    });
  }

  reply(packet) {
    queueMicrotask(() =>
      this.emit("message", { data: JSON.stringify(packet) }),
    );
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", {});
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const ticket = () => ({
  ticket: "H".repeat(43),
  expires_in: 60,
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  channel: "tinode",
  endpoint: {
    url: "wss://tinode.example.test/v0/channels",
    protocol: "tinode",
    auth_scheme: "cifra",
    ticket_transport: "login_secret",
    ticket_encoding: "base64",
  },
});

test("loads bounded older Tinode pages, scopes topic, deduplicates and stops at seq 1", async () => {
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;
  try {
    const { CifraRealtimeClient } = await loadRealtimeModule();
    const client = new CifraRealtimeClient();
    await client.connect({
      apiBaseUrl: "https://gateway.example.test",
      accessToken: "access-token",
      deviceId: "device-id",
      ticketProvider: async () => ticket(),
    });
    await client.subscribeToChat(TOPIC, { historyLimit: 20 });

    const [first, sameRequest] = await Promise.all([
      client.loadOlderMessages(TOPIC, 50),
      client.loadOlderMessages(TOPIC, 50),
    ]);
    assert.deepEqual(first, sameRequest);
    assert.equal(first.before, 101);
    assert.equal(first.receivedCount, 50);
    assert.equal(first.addedCount, 50);
    assert.equal(first.oldestSeq, 51);
    assert.equal(first.hasMore, true);

    const second = await client.loadOlderMessages(TOPIC, 500);
    assert.equal(second.before, 51);
    assert.equal(second.receivedCount, 50);
    assert.equal(second.oldestSeq, 1);
    assert.equal(second.hasMore, false);

    const third = await client.loadOlderMessages(TOPIC, 50);
    assert.equal(third.addedCount, 0);
    assert.equal(third.hasMore, false);
    assert.deepEqual(
      client.getChatMessages(TOPIC).map(({ seq }) => seq),
      Array.from({ length: 120 }, (_, index) => index + 1),
    );
    assert.equal(client.getChatMessages(OTHER_TOPIC).length, 0);

    const historyPackets = FakeWebSocket.instances[0].sent.filter(
      (packet) => packet.get?.topic === TOPIC,
    );
    assert.equal(historyPackets.length, 2);
    assert.deepEqual(historyPackets[0].get.data, { before: 101, limit: 50 });
    assert.deepEqual(historyPackets[1].get.data, { before: 51, limit: 100 });
    client.disconnect();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("older-history query is bounded and never crosses the requested topic", async () => {
  const { buildTinodeOlderHistoryQuery } = await loadRealtimeModule();
  const messages = [
    { topic: TOPIC, seq: 44 },
    { topic: TOPIC, seq: 61 },
    { topic: OTHER_TOPIC, seq: 2 },
  ];
  assert.deepEqual(buildTinodeOlderHistoryQuery(TOPIC, 500, messages), {
    before: 44,
    limit: 100,
  });
  assert.equal(
    buildTinodeOlderHistoryQuery(TOPIC, 50, [{ topic: TOPIC, seq: 1 }]),
    null,
  );
});

test("history UI preserves scroll only for a real prepend and bounds stale snapshots", async () => {
  const page = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /useLayoutEffect\(\(\) => \{[\s\S]*?canvas\.scrollTop =[\s\S]*?canvas\.scrollHeight - pending\.scrollHeight/);
  assert.match(page, /if \(result\.addedCount === 0\) \{\s*pendingHistoryScrollRef\.current = null/);
  assert.match(page, /historyRestoreTimerRef\.current = window\.setTimeout\([\s\S]*?pendingHistoryScrollRef\.current = null;[\s\S]*?750/);
  assert.match(page, /catch \{\s*pendingHistoryScrollRef\.current = null;/);
  assert.match(page, /if \(skipAutoScrollRef\.current\) \{[\s\S]*?return;/);
});
