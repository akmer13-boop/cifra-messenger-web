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
              read: 5,
              recv: 6,
              acs: { mode: "JRWPA" },
            },
            {
              topic: "chnNoReadAccess1",
              acs: { mode: "J" },
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

    if (packet.sub?.topic === "usrZyXwVuTsR10") {
      // History may arrive before the final ctrl response to {sub}.
      this.reply({
        data: {
          topic: "usrZyXwVuTsR10",
          from: "usrOtherPerson12",
          ts: "2026-07-30T20:00:00.000Z",
          seq: 7,
          head: { mime: "text/plain" },
          content: "Привет из Tinode",
        },
      });
      this.reply({
        ctrl: {
          id: packet.sub.id,
          code: 200,
          params: { topic: "usrZyXwVuTsR10" },
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

test("subscribes to one discovered chat and captures data arriving before ctrl", async () => {
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

    await Promise.all([
      client.subscribeToChat("usrZyXwVuTsR10", { historyLimit: 20 }),
      client.subscribeToChat("usrZyXwVuTsR10", { historyLimit: 20 }),
    ]);

    const socket = FakeWebSocket.instances[0];
    const chatSubscriptions = socket.sent.filter(
      (packet) => packet.sub?.topic === "usrZyXwVuTsR10",
    );

    assert.equal(chatSubscriptions.length, 1);
    assert.deepEqual(chatSubscriptions[0].sub.get, {
      what: "desc data",
      data: { limit: 20 },
    });
    assert.equal(client.isTopicSubscribed("usrZyXwVuTsR10"), true);
    assert.deepEqual(client.getChatMessages("usrZyXwVuTsR10"), [
      {
        topic: "usrZyXwVuTsR10",
        seq: 7,
        from: "usrOtherPerson12",
        timestamp: "2026-07-30T20:00:00.000Z",
        head: { mime: "text/plain" },
        content: "Привет из Tinode",
      },
    ]);
    assert.equal(snapshots.length, 1);

    await assert.rejects(
      () => client.subscribeToChat("grpUnknownTopic1"),
      (error) => error?.code === "tinode_chat_topic_unknown",
    );
    await assert.rejects(
      () => client.subscribeToChat("chnNoReadAccess1"),
      (error) => error?.code === "tinode_chat_read_access_denied",
    );

    client.disconnect();
    assert.deepEqual(client.getChatMessages(), []);
    assert.deepEqual(snapshots.at(-1), []);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});

test("parses only valid Tinode data packets", async () => {
  const { parseTinodeChatMessage } = await loadRealtimeModule();

  assert.equal(parseTinodeChatMessage("not-json"), null);
  assert.equal(
    parseTinodeChatMessage(JSON.stringify({ data: { topic: "me" } })),
    null,
  );
  assert.equal(
    parseTinodeChatMessage(
      JSON.stringify({
        data: {
          topic: "usrZyXwVuTsR10",
          seq: 0,
          ts: "2026-07-30T20:00:00.000Z",
          content: "invalid seq",
        },
      }),
    ),
    null,
  );
  assert.deepEqual(
    parseTinodeChatMessage(
      JSON.stringify({
        data: {
          topic: "grpAbCdEfGhI12",
          from: "usrAbCdEfGhI12",
          ts: "2026-07-30T20:01:00.000Z",
          seq: 8,
          content: { txt: "structured" },
        },
      }),
    ),
    {
      topic: "grpAbCdEfGhI12",
      seq: 8,
      from: "usrAbCdEfGhI12",
      timestamp: "2026-07-30T20:01:00.000Z",
      content: { txt: "structured" },
    },
  );
});
