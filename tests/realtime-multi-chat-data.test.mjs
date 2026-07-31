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
  static instances = [];

  readyState = FakeWebSocket.CONNECTING;
  sent = [];
  listeners = new Map();

  constructor(url) {
    this.url = url;
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
      this.reply({ ctrl: { id: packet.hi.id, code: 201, params: { ver: "0.25" } } });
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
          id: packet.sub.id,
          topic: "me",
          sub: [
            { topic: "usrZyXwVuTsR10", seq: 4, read: 2, acs: { mode: "JRWPA" } },
            { topic: "grpAbCdEfGhI12", seq: 8, read: 7, acs: { mode: "JRWPA" } },
          ],
        },
      });
      this.reply({ ctrl: { id: packet.sub.id, code: 200, params: { topic: "me" } } });
      return;
    }

    if (packet.sub?.topic === "usrZyXwVuTsR10") {
      this.reply({
        data: {
          topic: "usrZyXwVuTsR10",
          from: "usrOtherPerson12",
          ts: "2026-07-31T08:00:00.000Z",
          seq: 4,
          content: "Личное сообщение",
        },
      });
      this.reply({ ctrl: { id: packet.sub.id, code: 200, params: { topic: packet.sub.topic } } });
      return;
    }

    if (packet.sub?.topic === "grpAbCdEfGhI12") {
      this.reply({
        data: {
          topic: "grpAbCdEfGhI12",
          from: "usrGroupMember1",
          ts: "2026-07-31T08:01:00.000Z",
          seq: 8,
          content: "Групповое сообщение",
        },
      });
      this.reply({ ctrl: { id: packet.sub.id, code: 200, params: { topic: packet.sub.topic } } });
    }
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", {});
  }

  reply(packet) {
    queueMicrotask(() => this.emit("message", { data: JSON.stringify(packet) }));
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

test("subscribes to multiple discovered chats concurrently and keeps history separated", async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;

  FakeWebSocket.instances = [];
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
    const client = new CifraRealtimeClient();

    await client.connect({
      apiBaseUrl: "https://gateway.example.test",
      accessToken: "access-token",
      deviceId: "device-id",
    });

    await Promise.all([
      client.subscribeToChat("usrZyXwVuTsR10", { historyLimit: 20 }),
      client.subscribeToChat("grpAbCdEfGhI12", { historyLimit: 20 }),
    ]);

    assert.equal(client.isTopicSubscribed("usrZyXwVuTsR10"), true);
    assert.equal(client.isTopicSubscribed("grpAbCdEfGhI12"), true);
    assert.equal(client.getChatMessages("usrZyXwVuTsR10").length, 1);
    assert.equal(client.getChatMessages("grpAbCdEfGhI12").length, 1);
    assert.deepEqual(
      client.getChatMessages().map((message) => [message.topic, message.seq]),
      [
        ["grpAbCdEfGhI12", 8],
        ["usrZyXwVuTsR10", 4],
      ],
    );

    const socket = FakeWebSocket.instances[0];
    assert.equal(
      socket.sent.filter((packet) => packet.sub?.topic === "usrZyXwVuTsR10").length,
      1,
    );
    assert.equal(
      socket.sent.filter((packet) => packet.sub?.topic === "grpAbCdEfGhI12").length,
      1,
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});
