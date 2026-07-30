import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadRealtimeModule() {
  const source = await readFile(new URL("../app/cifra-realtime.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
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

    if (packet.sub) {
      this.reply({
        ctrl: {
          id: packet.sub.id,
          code: 200,
          params: { topic: packet.sub.topic },
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

test("subscribes to the authenticated user's me topic before reporting connected", async () => {
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
    const statuses = [];
    const client = new CifraRealtimeClient((status) => statuses.push(status));

    const userId = await client.connect({
      apiBaseUrl: "https://gateway.example.test",
      accessToken: "access-token",
      deviceId: "device-id",
    });

    assert.equal(userId, "usrAbCdEfGhI12");
    assert.equal(client.getStatus(), "connected");
    assert.equal(client.isTopicSubscribed("me"), true);
    assert.deepEqual(client.getSubscribedTopics(), ["me"]);
    assert.deepEqual(statuses, ["connecting", "connected"]);

    const socket = client.socket;
    assert.deepEqual(socket.sent.map((packet) => Object.keys(packet)[0]), [
      "hi",
      "login",
      "sub",
    ]);
    assert.deepEqual(socket.sent[2].sub, {
      id: socket.sent[2].sub.id,
      topic: "me",
      get: { what: "desc sub" },
    });

    client.disconnect();
    assert.equal(client.isTopicSubscribed("me"), false);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});
