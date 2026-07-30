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
      this.reply({
        meta: {
          id: packet.sub.id,
          topic: "me",
          sub: [
            {
              topic: "usrZyXwVuTsR10",
              seq: 7,
              read: 7,
              recv: 7,
              acs: { mode: "JRWPA" },
            },
            {
              topic: "grpReadOnlyTopic1",
              acs: { mode: "JR" },
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
      return;
    }

    if (packet.sub?.topic) {
      this.reply({
        ctrl: {
          id: packet.sub.id,
          topic: packet.sub.topic,
          code: 200,
          params: { topic: packet.sub.topic },
        },
      });
      return;
    }

    if (packet.pub?.topic === "usrZyXwVuTsR10") {
      // Tinode may echo {data} before the final {ctrl} for {pub}.
      this.reply({
        data: {
          topic: "usrZyXwVuTsR10",
          from: "usrAbCdEfGhI12",
          ts: "2026-07-30T21:05:00.000Z",
          seq: 8,
          head: { mime: "text/plain" },
          content: packet.pub.content,
        },
      });
      this.reply({
        ctrl: {
          id: packet.pub.id,
          topic: "usrZyXwVuTsR10",
          code: 200,
          text: "ok",
          ts: "2026-07-30T21:05:00.000Z",
          params: { seq: 8 },
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

test("publishes plain text to an attached writable Tinode topic and returns server seq", async () => {
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
    const snapshots = [];
    const client = new CifraRealtimeClient(
      () => undefined,
      () => undefined,
      (messages) => snapshots.push(structuredClone(messages)),
    );

    await client.connect({
      apiBaseUrl: "https://gateway.example.test",
      accessToken: "access-token",
      deviceId: "device-id",
    });
    await client.subscribeToChat("usrZyXwVuTsR10");

    const result = await client.publishText(
      "usrZyXwVuTsR10",
      "  Сообщение через Tinode  ",
    );

    assert.deepEqual(result, {
      topic: "usrZyXwVuTsR10",
      seq: 8,
      timestamp: "2026-07-30T21:05:00.000Z",
    });

    const socket = FakeWebSocket.instances[0];
    const published = socket.sent.find((packet) => packet.pub);
    assert.deepEqual(published.pub, {
      id: published.pub.id,
      topic: "usrZyXwVuTsR10",
      noecho: false,
      head: { mime: "text/plain" },
      content: "Сообщение через Tinode",
    });

    assert.deepEqual(client.getChatMessages("usrZyXwVuTsR10"), [
      {
        topic: "usrZyXwVuTsR10",
        seq: 8,
        from: "usrAbCdEfGhI12",
        timestamp: "2026-07-30T21:05:00.000Z",
        head: { mime: "text/plain" },
        content: "Сообщение через Tinode",
      },
    ]);
    assert.equal(snapshots.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});

test("rejects empty, unknown, read-only, and unattached publish targets", async () => {
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

    await assert.rejects(
      () => client.publishText("usrZyXwVuTsR10", "   "),
      (error) => error?.code === "tinode_publish_text_empty",
    );
    await assert.rejects(
      () => client.publishText("grpUnknownTopic1", "text"),
      (error) => error?.code === "tinode_chat_topic_unknown",
    );
    await assert.rejects(
      () => client.publishText("grpReadOnlyTopic1", "text"),
      (error) => error?.code === "tinode_chat_write_access_denied",
    );
    await assert.rejects(
      () => client.publishText("usrZyXwVuTsR10", "text"),
      (error) => error?.code === "tinode_chat_not_subscribed",
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});
