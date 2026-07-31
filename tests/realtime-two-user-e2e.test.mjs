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

const ALICE = "usrA0000000001";
const BOB = "usrB0000000002";
const DIRECT = "usrDirect00001";
const GROUP = "grpTeam0000001";

function makeTicket(letter) {
  return {
    ticket: letter.repeat(43),
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
  };
}

class SharedTinodeServer {
  constructor() {
    this.sockets = new Set();
    this.messages = new Map([
      [DIRECT, []],
      [GROUP, []],
    ]);
    this.connectionCount = new Map();
    this.subscriptionRequests = [];
  }

  register(socket) {
    this.sockets.add(socket);
  }

  unregister(socket) {
    this.sockets.delete(socket);
  }

  userForTicket(ticket) {
    if (ticket.startsWith("A") || ticket.startsWith("C") || ticket.startsWith("E")) {
      return ALICE;
    }
    if (ticket.startsWith("B") || ticket.startsWith("D") || ticket.startsWith("F")) {
      return BOB;
    }
    throw new Error(`Unknown fake ticket: ${ticket.slice(0, 1)}`);
  }

  topicsForUser(userId) {
    return userId === ALICE || userId === BOB ? [DIRECT, GROUP] : [];
  }

  topicMessages(topic) {
    return this.messages.get(topic) ?? [];
  }

  topicSeq(topic) {
    return this.topicMessages(topic).at(-1)?.seq ?? 0;
  }

  receive(socket, packet) {
    if (packet.hi) {
      socket.reply({
        ctrl: {
          id: packet.hi.id,
          code: 201,
          params: { ver: "0.25" },
        },
      });
      return;
    }

    if (packet.login) {
      const ticket = atob(packet.login.secret);
      const userId = this.userForTicket(ticket);
      socket.userId = userId;
      const count = (this.connectionCount.get(userId) ?? 0) + 1;
      this.connectionCount.set(userId, count);
      socket.userConnectionIndex = count;
      socket.reply({
        ctrl: {
          id: packet.login.id,
          code: 200,
          params: { user: userId, authlvl: "auth" },
        },
      });
      return;
    }

    if (packet.sub?.topic === "me") {
      const subscriptions = this.topicsForUser(socket.userId).map((topic) => ({
        topic,
        seq: this.topicSeq(topic),
        read: 0,
        recv: 0,
        acs: { mode: "JRWPA" },
      }));
      socket.reply({
        meta: {
          id: packet.sub.id,
          topic: "me",
          sub: subscriptions,
        },
      });
      socket.reply({
        ctrl: {
          id: packet.sub.id,
          code: 200,
          params: { topic: "me" },
        },
      });
      return;
    }

    if (packet.sub?.topic) {
      const topic = packet.sub.topic;
      socket.topics.add(topic);
      const since = packet.sub.get?.data?.since;
      const limit = packet.sub.get?.data?.limit ?? 20;
      this.subscriptionRequests.push({
        userId: socket.userId,
        connectionIndex: socket.userConnectionIndex,
        topic,
        since,
        limit,
      });

      socket.reply({
        meta: {
          id: packet.sub.id,
          topic,
          desc: {
            public: {
              fn: topic === GROUP ? "Команда проекта" : "Личный чат",
            },
          },
          sub: [ALICE, BOB].map((userId) => ({
            user: userId,
            acs: { mode: "JRWPA" },
            public: { fn: userId === ALICE ? "Алиса" : "Борис" },
          })),
        },
      });

      const history = this.topicMessages(topic).filter((message) =>
        Number.isInteger(since) ? message.seq >= since : true,
      );
      const boundedHistory = history.slice(-limit);

      if (Number.isInteger(since) && since > 1) {
        const duplicate = this.topicMessages(topic).find(
          (message) => message.seq === since - 1,
        );
        if (duplicate) socket.reply({ data: duplicate });
      }

      for (const message of boundedHistory) {
        socket.reply({ data: message });
      }

      socket.reply({
        ctrl: {
          id: packet.sub.id,
          code: 200,
          params: { topic },
        },
      });
      return;
    }

    if (packet.pub) {
      const topic = packet.pub.topic;
      const messages = this.topicMessages(topic);
      const message = {
        topic,
        from: socket.userId,
        ts: new Date(Date.now() + messages.length * 1_000).toISOString(),
        seq: messages.length + 1,
        head: packet.pub.head,
        content: packet.pub.content,
      };
      messages.push(message);
      this.messages.set(topic, messages);

      for (const target of this.sockets) {
        if (target.readyState === FakeWebSocket.OPEN && target.topics.has(topic)) {
          target.reply({ data: message });
        }
      }

      socket.reply({
        ctrl: {
          id: packet.pub.id,
          code: 202,
          timestamp: message.ts,
          params: { seq: message.seq },
        },
      });
      return;
    }

    if (packet.note) {
      for (const target of this.sockets) {
        if (
          target !== socket &&
          target.readyState === FakeWebSocket.OPEN &&
          target.topics.has(packet.note.topic)
        ) {
          target.reply({
            info: {
              topic: packet.note.topic,
              from: socket.userId,
              what: packet.note.what,
              seq: packet.note.seq,
            },
          });
        }
      }
    }
  }
}

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static server;
  static instances = [];

  readyState = FakeWebSocket.CONNECTING;
  listeners = new Map();
  sent = [];
  topics = new Set();
  userId = null;
  userConnectionIndex = 0;

  constructor(url) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    FakeWebSocket.server.register(this);
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
    FakeWebSocket.server.receive(this, packet);
  }

  close(code = 1000, reason = "") {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    FakeWebSocket.server.unregister(this);
    this.emit("close", { code, reason });
  }

  drop() {
    this.close(1006, "network_drop");
  }

  reply(packet) {
    queueMicrotask(() => {
      if (this.readyState === FakeWebSocket.OPEN) {
        this.emit("message", { data: JSON.stringify(packet) });
      }
    });
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

const flushMessages = () => new Promise((resolve) => setImmediate(resolve));

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Timed out waiting for realtime condition");
}

function createClient(CifraRealtimeClient, diagnostics) {
  return new CifraRealtimeClient(
    () => undefined,
    () => undefined,
    () => undefined,
    () => undefined,
    () => undefined,
    {
      reconnectBaseDelayMs: 0,
      reconnectMaxDelayMs: 0,
      onDiagnostics: (value) => diagnostics.push(structuredClone(value)),
    },
  );
}

test("two real users exchange messages, receipts, recover after reconnect, and start a clean new session", async () => {
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.server = new SharedTinodeServer();
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;

  try {
    const { CifraRealtimeClient } = await loadRealtimeModule();
    const aliceDiagnostics = [];
    const bobDiagnostics = [];
    const alice = createClient(CifraRealtimeClient, aliceDiagnostics);
    const bob = createClient(CifraRealtimeClient, bobDiagnostics);
    let aliceTicketIndex = 0;
    let bobTicketIndex = 0;

    await Promise.all([
      alice.connect({
        apiBaseUrl: "https://gateway.example.test",
        accessToken: "alice-access",
        deviceId: "alice-device",
        ticketProvider: async () => makeTicket(["A", "C", "E"][aliceTicketIndex++]),
      }),
      bob.connect({
        apiBaseUrl: "https://gateway.example.test",
        accessToken: "bob-access",
        deviceId: "bob-device",
        ticketProvider: async () => makeTicket(["B", "D", "F"][bobTicketIndex++]),
      }),
    ]);

    await Promise.all([
      alice.subscribeToChat(DIRECT, { historyLimit: 20 }),
      alice.subscribeToChat(GROUP, { historyLimit: 20 }),
      bob.subscribeToChat(DIRECT, { historyLimit: 20 }),
      bob.subscribeToChat(GROUP, { historyLimit: 20 }),
    ]);

    assert.equal(alice.getTinodeUserId(), ALICE);
    assert.equal(bob.getTinodeUserId(), BOB);
    assert.equal(alice.getDiagnostics().connectionGeneration, 1);
    assert.equal(bob.getDiagnostics().connectionGeneration, 1);

    const directPublish = await alice.publishText(DIRECT, "Сообщение от Алисы");
    await waitFor(
      () =>
        alice.getChatMessages(DIRECT).length === 1 &&
        bob.getChatMessages(DIRECT).length === 1,
    );

    assert.equal(directPublish.seq, 1);
    assert.equal(bob.getChatMessages(DIRECT)[0].content, "Сообщение от Алисы");
    assert.equal(alice.getChatMessages(GROUP).length, 0);
    assert.equal(bob.getChatMessages(GROUP).length, 0);

    await waitFor(
      () =>
        alice
          .getChatReceipts(DIRECT)
          .some((receipt) => receipt.from === BOB && receipt.what === "recv" && receipt.seq === 1),
    );
    assert.equal(bob.markRead(DIRECT, 1), true);
    await waitFor(
      () =>
        alice
          .getChatReceipts(DIRECT)
          .some((receipt) => receipt.from === BOB && receipt.what === "read" && receipt.seq === 1),
    );

    await bob.publishText(GROUP, "Сообщение в группе");
    await waitFor(
      () =>
        alice.getChatMessages(GROUP).length === 1 &&
        bob.getChatMessages(GROUP).length === 1,
    );
    assert.equal(alice.getChatMessages(DIRECT).length, 1);
    assert.equal(bob.getChatMessages(DIRECT).length, 1);

    const aliceFirstSocket = FakeWebSocket.instances.find(
      (socket) => socket.userId === ALICE && socket.userConnectionIndex === 1,
    );
    assert.ok(aliceFirstSocket);
    aliceFirstSocket.drop();
    await waitFor(() => alice.getStatus() === "reconnecting");

    await bob.publishText(DIRECT, "Первое сообщение во время обрыва");
    await bob.publishText(DIRECT, "Второе сообщение во время обрыва");

    await waitFor(
      () =>
        alice.getStatus() === "connected" &&
        alice.getChatMessages(DIRECT).length === 3,
    );

    assert.deepEqual(
      alice.getChatMessages(DIRECT).map((message) => message.seq),
      [1, 2, 3],
    );
    assert.equal(
      alice.getChatMessages(DIRECT).filter((message) => message.seq === 1).length,
      1,
    );
    assert.equal(alice.getDiagnostics().connectionGeneration, 2);
    assert.equal(alice.getDiagnostics().reconnectSuccessCount, 1);
    assert.equal(alice.getDiagnostics().duplicateMessageCount, 2);
    assert.equal(alice.getDiagnostics().lastError, undefined);

    const reconnectRequest = FakeWebSocket.server.subscriptionRequests.find(
      (request) =>
        request.userId === ALICE &&
        request.connectionIndex === 2 &&
        request.topic === DIRECT,
    );
    assert.deepEqual(
      { since: reconnectRequest?.since, limit: reconnectRequest?.limit },
      { since: 2, limit: 20 },
    );

    const socketCountBeforeLogout = FakeWebSocket.instances.length;
    alice.disconnect();
    await flushMessages();
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(alice.getStatus(), "disconnected");
    assert.equal(alice.getTinodeUserId(), null);
    assert.deepEqual(alice.getChatMessages(), []);
    assert.deepEqual(alice.getChatReceipts(), []);
    assert.deepEqual(alice.getChatMetadata(), []);
    assert.deepEqual(alice.getChatSubscriptions(), []);
    assert.deepEqual(alice.getDiagnostics(), {
      connectionGeneration: 0,
      reconnectSuccessCount: 0,
      duplicateMessageCount: 0,
    });
    assert.equal(FakeWebSocket.instances.length, socketCountBeforeLogout);

    const aliceFreshDiagnostics = [];
    const aliceFresh = createClient(CifraRealtimeClient, aliceFreshDiagnostics);
    await aliceFresh.connect({
      apiBaseUrl: "https://gateway.example.test",
      accessToken: "alice-access-fresh",
      deviceId: "alice-device-fresh",
      ticketProvider: async () => makeTicket("E"),
    });
    await Promise.all([
      aliceFresh.subscribeToChat(DIRECT, { historyLimit: 20 }),
      aliceFresh.subscribeToChat(GROUP, { historyLimit: 20 }),
    ]);

    assert.deepEqual(
      aliceFresh.getChatMessages(DIRECT).map((message) => message.seq),
      [1, 2, 3],
    );
    assert.deepEqual(
      aliceFresh.getChatMessages(GROUP).map((message) => message.seq),
      [1],
    );
    assert.equal(aliceFresh.getDiagnostics().connectionGeneration, 1);
    assert.equal(aliceFresh.getDiagnostics().reconnectSuccessCount, 0);
    assert.equal(aliceFresh.getDiagnostics().duplicateMessageCount, 0);
    assert.ok(aliceDiagnostics.some((value) => value.reconnectSuccessCount === 1));
    assert.ok(bobDiagnostics.some((value) => value.connectionGeneration === 1));
    assert.ok(aliceFreshDiagnostics.some((value) => value.connectionGeneration === 1));

    aliceFresh.disconnect();
    bob.disconnect();
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});
