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

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  sent = [];
  listeners = new Map();

  constructor(url) {
    this.url = url;
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
        ctrl: {
          id: packet.hi.id,
          code: 201,
          params: { ver: "0.25" },
        },
      });
      return;
    }

    if (packet.login) {
      this.reply({
        ctrl: {
          id: packet.login.id,
          code: 200,
          params: {
            user: "usrAbCdEfGhI12",
            authlvl: "auth",
          },
        },
      });
      return;
    }

    if (packet.sub?.topic === "me") {
      // The metadata intentionally arrives before ctrl. The client must not lose it.
      this.reply({
        meta: {
          id: packet.sub.id,
          topic: "me",
          sub: [
            {
              topic: "usrZyXwVuTsR10",
              updated: "2026-07-30T18:00:00.000Z",
              touched: "2026-07-30T18:05:00.000Z",
              seq: 12,
              read: 10,
              recv: 11,
              online: true,
              acs: {
                want: "JRWPA",
                given: "JRWPA",
                mode: "JRWPA",
              },
              public: { fn: "Иван Иванов" },
              private: { archived: false },
            },
            {
              topic: "grpAbCdEfGhI12",
              seq: 4,
              read: 4,
              recv: 4,
              public: { fn: "Проектная группа" },
            },
            {
              topic: "me",
            },
            {
              topic: "invalid topic",
            },
          ],
        },
      });
      this.reply({
        ctrl: {
          id: packet.sub.id,
          code: 200,
          params: { topic: "me" },
        },
      });
    }
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", {});
  }

  reply(packet) {
    queueMicrotask(() => {
      this.emit("message", { data: JSON.stringify(packet) });
    });
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

test("captures real chat topic ids from meta.sub on the me topic", async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;

  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      ticket: "A".repeat(43),
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
    }),
  });
  globalThis.WebSocket = FakeWebSocket;

  try {
    const { CifraRealtimeClient } = await loadRealtimeModule();
    const snapshots = [];
    const client = new CifraRealtimeClient(
      () => undefined,
      (subscriptions) => snapshots.push(structuredClone(subscriptions)),
    );

    await client.connect({
      apiBaseUrl: "https://gateway.example.test",
      accessToken: "access-token",
      deviceId: "device-id",
    });

    assert.deepEqual(client.getChatTopicIds(), [
      "usrZyXwVuTsR10",
      "grpAbCdEfGhI12",
    ]);
    assert.deepEqual(client.getChatSubscriptions(), [
      {
        topic: "usrZyXwVuTsR10",
        updatedAt: "2026-07-30T18:00:00.000Z",
        touchedAt: "2026-07-30T18:05:00.000Z",
        seq: 12,
        read: 10,
        recv: 11,
        online: true,
        access: {
          want: "JRWPA",
          given: "JRWPA",
          mode: "JRWPA",
        },
        public: { fn: "Иван Иванов" },
        private: { archived: false },
      },
      {
        topic: "grpAbCdEfGhI12",
        seq: 4,
        read: 4,
        recv: 4,
        public: { fn: "Проектная группа" },
      },
    ]);
    assert.equal(snapshots.length, 1);

    client.disconnect();
    assert.deepEqual(client.getChatTopicIds(), []);
    assert.deepEqual(snapshots.at(-1), []);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});

test("parses only valid Tinode chat subscriptions", async () => {
  const { parseTinodeChatSubscriptions } = await loadRealtimeModule();

  assert.equal(parseTinodeChatSubscriptions("not-json"), null);
  assert.equal(
    parseTinodeChatSubscriptions(JSON.stringify({ ctrl: { code: 200 } })),
    null,
  );
  assert.deepEqual(
    parseTinodeChatSubscriptions(
      JSON.stringify({
        meta: {
          topic: "me",
          sub: [
            { topic: "chnAbCdEfGhI12", seq: 0 },
            { topic: "fnd" },
          ],
        },
      }),
    ),
    [{ topic: "chnAbCdEfGhI12", seq: 0 }],
  );
});
