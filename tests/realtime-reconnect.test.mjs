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
    this.connectionIndex = FakeWebSocket.instances.length;
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
              seq: this.connectionIndex === 0 ? 7 : 9,
              read: 6,
              recv: 7,
              acs: { mode: "JRWPA" },
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
      if (this.connectionIndex === 0) {
        this.replyData(7, "До обрыва");
      } else {
        // Duplicate seq=7 verifies that reconnection cannot duplicate UI messages.
        this.replyData(7, "До обрыва");
        this.replyData(8, "Пропущенное сообщение 1");
        this.replyData(9, "Пропущенное сообщение 2");
      }
      this.reply({
        ctrl: {
          id: packet.sub.id,
          code: 200,
          params: { topic: packet.sub.topic },
        },
      });
    }
  }

  replyData(seq, content) {
    this.reply({
      data: {
        topic: "usrZyXwVuTsR10",
        from: "usrRemotePerson1",
        ts: `2026-07-31T09:0${seq - 7}:00.000Z`,
        seq,
        head: { mime: "text/plain" },
        content,
      },
    });
  }

  close(code = 1000, reason = "") {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", { code, reason });
  }

  drop() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", { code: 1006, reason: "network_lost" });
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

const waitFor = async (predicate, timeoutMs = 1_000) => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("waitFor timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
};

const ticket = (character) => ({
  ticket: character.repeat(43),
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

test("gets a fresh ticket, restores chats, and catches up without duplicates", async () => {
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;

  try {
    const { CifraRealtimeClient } = await loadRealtimeModule();
    const statuses = [];
    const messageSnapshots = [];
    let ticketCalls = 0;
    const client = new CifraRealtimeClient(
      (status) => statuses.push(status),
      () => undefined,
      (messages) => messageSnapshots.push(structuredClone(messages)),
      () => undefined,
      () => undefined,
      { reconnectBaseDelayMs: 0, reconnectMaxDelayMs: 0 },
    );

    await client.connect({
      apiBaseUrl: "https://gateway.example.test",
      accessToken: "access-token",
      deviceId: "device-id",
      ticketProvider: async () => {
        ticketCalls += 1;
        return ticket(ticketCalls === 1 ? "A" : "B");
      },
    });
    await client.subscribeToChat("usrZyXwVuTsR10", { historyLimit: 20 });

    assert.deepEqual(
      client.getChatMessages("usrZyXwVuTsR10").map((message) => message.seq),
      [7],
    );

    FakeWebSocket.instances[0].drop();

    await waitFor(
      () =>
        FakeWebSocket.instances.length === 2 &&
        client.getStatus() === "connected" &&
        client.getChatMessages("usrZyXwVuTsR10").length === 3,
    );

    const reconnectSocket = FakeWebSocket.instances[1];
    const reconnectSubscription = reconnectSocket.sent.find(
      (packet) => packet.sub?.topic === "usrZyXwVuTsR10",
    );
    const reconnectLogin = reconnectSocket.sent.find((packet) => packet.login);

    assert.equal(ticketCalls, 2);
    assert.equal(reconnectLogin.login.secret, btoa("B".repeat(43)));
    assert.deepEqual(reconnectSubscription.sub.get.data, {
      since: 8,
      limit: 20,
    });
    assert.deepEqual(
      client.getChatMessages("usrZyXwVuTsR10").map((message) => message.seq),
      [7, 8, 9],
    );
    assert.equal(
      client.getChatMessages("usrZyXwVuTsR10").filter((message) => message.seq === 7).length,
      1,
    );
    assert.equal(client.isTopicSubscribed("usrZyXwVuTsR10"), true);
    assert.equal(client.getTinodeUserId(), "usrAbCdEfGhI12");
    assert.ok(statuses.includes("reconnecting"));
    assert.equal(messageSnapshots.some((snapshot) => snapshot.length === 0), false);

    client.disconnect();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("explicit logout cancels a scheduled reconnect", async () => {
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;

  try {
    const { CifraRealtimeClient } = await loadRealtimeModule();
    let ticketCalls = 0;
    const client = new CifraRealtimeClient(
      () => undefined,
      () => undefined,
      () => undefined,
      () => undefined,
      () => undefined,
      { reconnectBaseDelayMs: 30, reconnectMaxDelayMs: 30 },
    );

    await client.connect({
      apiBaseUrl: "https://gateway.example.test",
      accessToken: "access-token",
      deviceId: "device-id",
      ticketProvider: async () => {
        ticketCalls += 1;
        return ticket("A");
      },
    });

    FakeWebSocket.instances[0].drop();
    assert.equal(client.getStatus(), "reconnecting");
    client.disconnect();

    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(client.getStatus(), "disconnected");
    assert.equal(FakeWebSocket.instances.length, 1);
    assert.equal(ticketCalls, 1);
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});
