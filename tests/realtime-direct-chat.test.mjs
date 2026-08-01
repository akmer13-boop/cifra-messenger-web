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

class DirectSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  readyState = DirectSocket.CONNECTING;
  sent = [];
  listeners = new Map();

  constructor(url) {
    this.url = url;
    DirectSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = DirectSocket.OPEN;
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
      return this.reply({
        ctrl: { id: packet.hi.id, code: 201, params: { ver: "0.25" } },
      });
    }
    if (packet.login) {
      return this.reply({
        ctrl: {
          id: packet.login.id,
          code: 200,
          params: { user: "usrAbCdEfGhI12", authlvl: "auth" },
        },
      });
    }
    if (packet.sub?.topic === "me") {
      this.reply({ meta: { id: packet.sub.id, topic: "me", sub: [] } });
      return this.reply({ ctrl: { id: packet.sub.id, code: 200 } });
    }
    if (packet.sub?.topic === "fnd") {
      return this.reply({ ctrl: { id: packet.sub.id, code: 200 } });
    }
    if (packet.set?.topic === "fnd") {
      return this.reply({ ctrl: { id: packet.set.id, code: 200 } });
    }
    if (packet.get?.topic === "fnd") {
      this.reply({
        meta: {
          id: packet.get.id,
          topic: "fnd",
          sub: [{ user: "usrZyXwVuTsR10", public: { fn: "Иван Морозов" } }],
        },
      });
      return this.reply({ ctrl: { id: packet.get.id, code: 200 } });
    }
    if (packet.sub?.topic === "usrZyXwVuTsR10") {
      this.reply({
        meta: {
          id: packet.sub.id,
          topic: "usrZyXwVuTsR10",
          desc: { public: { fn: "Иван Морозов" } },
          sub: [{ user: "usrZyXwVuTsR10" }],
        },
      });
      this.reply({
        data: {
          topic: "usrZyXwVuTsR10",
          seq: 1,
          from: "usrZyXwVuTsR10",
          ts: "2026-08-01T10:00:00.000Z",
          content: "Существующая история",
        },
      });
      return this.reply({
        ctrl: {
          id: packet.sub.id,
          topic: "usrZyXwVuTsR10",
          code: 200,
          params: { acs: { mode: "JRWPA" } },
        },
      });
    }
  }

  close() {
    this.readyState = DirectSocket.CLOSED;
    this.emit("close", {});
  }

  reply(packet) {
    queueMicrotask(() =>
      this.emit("message", { data: JSON.stringify(packet) }),
    );
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

test("finds an employee and opens a writable direct conversation with history", async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  DirectSocket.instances = [];
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      ticket: "A".repeat(43),
      expires_in: 60,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      channel: "tinode",
      endpoint: {
        url: "wss://realtime.example.test/v0/channels",
        protocol: "tinode",
        auth_scheme: "cifra",
        ticket_transport: "login_secret",
        ticket_encoding: "base64",
      },
    }),
  });
  globalThis.WebSocket = DirectSocket;

  try {
    const { CifraRealtimeClient } = await loadRealtimeModule();
    const client = new CifraRealtimeClient();
    await client.connect({
      apiBaseUrl: "https://gateway.example.test",
      accessToken: "access",
      deviceId: "device",
    });

    const peer = await client.findUserByDirectoryQueries(["basic:i.morozov"]);
    assert.equal(peer, "usrZyXwVuTsR10");

    const result = await client.openDirectConversation(peer, {
      historyLimit: 20,
    });
    assert.deepEqual(result, {
      topic: "usrZyXwVuTsR10",
      peerUserId: "usrZyXwVuTsR10",
      created: true,
    });
    assert.equal(client.isTopicSubscribed(result.topic), true);
    assert.equal(client.getChatSubscriptions()[0].access.mode, "JRWPA");
    assert.equal(client.getChatMessages(result.topic)[0].content, "Существующая история");

    const directPacket = DirectSocket.instances[0].sent.find(
      (packet) => packet.sub?.topic === "usrZyXwVuTsR10",
    );
    assert.equal(directPacket.sub.set.sub.mode, "JRWPA");
    assert.equal(directPacket.sub.get.what, "desc sub data");
    assert.equal(directPacket.sub.get.data.limit, 20);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});

