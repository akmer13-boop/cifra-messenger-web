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
              read: 0,
              recv: 0,
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
      // History may arrive before the final ctrl for the attachment.
      this.reply({
        data: {
          topic: "usrZyXwVuTsR10",
          from: "usrRemotePerson1",
          ts: "2026-07-30T21:40:00.000Z",
          seq: 7,
          head: { mime: "text/plain" },
          content: "Сообщение для receipt",
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

const flushMessages = () => new Promise((resolve) => setImmediate(resolve));

test("sends recv/read notes and captures remote Tinode receipts", async () => {
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
    const receiptSnapshots = [];
    const client = new CifraRealtimeClient(
      () => undefined,
      () => undefined,
      () => undefined,
      (receipts) => receiptSnapshots.push(structuredClone(receipts)),
    );

    await client.connect({
      apiBaseUrl: "https://gateway.example.test",
      accessToken: "access-token",
      deviceId: "device-id",
    });
    await client.subscribeToChat("usrZyXwVuTsR10");

    const socket = FakeWebSocket.instances[0];
    const notesAfterAttach = socket.sent.filter((packet) => packet.note);
    assert.deepEqual(notesAfterAttach, [
      {
        note: {
          topic: "usrZyXwVuTsR10",
          what: "recv",
          seq: 7,
        },
      },
    ]);

    assert.equal(client.markReceived("usrZyXwVuTsR10", 7), false);
    assert.equal(client.markRead("usrZyXwVuTsR10", 7), true);
    assert.equal(client.markRead("usrZyXwVuTsR10", 7), false);

    const notes = socket.sent.filter((packet) => packet.note);
    assert.deepEqual(notes.at(-1), {
      note: {
        topic: "usrZyXwVuTsR10",
        what: "read",
        seq: 7,
      },
    });

    socket.reply({
      info: {
        topic: "usrZyXwVuTsR10",
        from: "usrRemotePerson1",
        what: "recv",
        seq: 8,
      },
    });
    socket.reply({
      info: {
        topic: "usrZyXwVuTsR10",
        from: "usrRemotePerson1",
        what: "read",
        seq: 8,
      },
    });
    socket.reply({
      info: {
        topic: "usrZyXwVuTsR10",
        from: "usrRemotePerson1",
        what: "recv",
        seq: 6,
      },
    });
    await flushMessages();

    const receipts = client.getChatReceipts("usrZyXwVuTsR10");
    assert.equal(receipts.length, 2);
    assert.deepEqual(
      receipts.find((receipt) => receipt.what === "recv"),
      {
        topic: "usrZyXwVuTsR10",
        from: "usrRemotePerson1",
        what: "recv",
        seq: 8,
      },
    );
    assert.deepEqual(
      receipts.find((receipt) => receipt.what === "read"),
      {
        topic: "usrZyXwVuTsR10",
        from: "usrRemotePerson1",
        what: "read",
        seq: 8,
      },
    );
    assert.equal(receiptSnapshots.length, 2);

    client.disconnect();
    assert.deepEqual(client.getChatReceipts(), []);
    assert.deepEqual(receiptSnapshots.at(-1), []);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});

test("parses only valid info/pres receipt packets", async () => {
  const { parseTinodeChatReceipt } = await loadRealtimeModule();

  assert.equal(parseTinodeChatReceipt("not-json"), null);
  assert.equal(
    parseTinodeChatReceipt(
      JSON.stringify({
        info: {
          topic: "usrZyXwVuTsR10",
          from: "usrRemotePerson1",
          what: "kp",
          seq: 8,
        },
      }),
    ),
    null,
  );
  assert.deepEqual(
    parseTinodeChatReceipt(
      JSON.stringify({
        info: {
          topic: "usrZyXwVuTsR10",
          from: "usrRemotePerson1",
          what: "read",
          seq: 8,
        },
      }),
    ),
    {
      topic: "usrZyXwVuTsR10",
      from: "usrRemotePerson1",
      what: "read",
      seq: 8,
    },
  );
  assert.deepEqual(
    parseTinodeChatReceipt(
      JSON.stringify({
        pres: {
          topic: "me",
          src: "usrZyXwVuTsR10",
          act: "usrRemotePerson1",
          what: "recv",
          seq: 9,
        },
      }),
    ),
    {
      topic: "usrZyXwVuTsR10",
      from: "usrRemotePerson1",
      what: "recv",
      seq: 9,
    },
  );
});
