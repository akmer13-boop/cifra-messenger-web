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
          topic: "grpUnknownTop12",
          desc: { public: { fn: "Неизвестный чат" } },
        },
      });
      this.reply({
        meta: {
          id: packet.sub.id,
          topic: "me",
          sub: [
            {
              topic: "grpAbCdEfGhI12",
              seq: 3,
              acs: { mode: "JRWPA" },
            },
          ],
        },
      });
      this.reply({
        ctrl: { id: packet.sub.id, code: 200, params: { topic: "me" } },
      });
      return;
    }

    if (packet.sub?.topic === "grpAbCdEfGhI12") {
      this.reply({
        meta: {
          topic: "grpAbCdEfGhI12",
          desc: {
            public: {
              fn: "Команда продукта",
              photo: { ref: "https://media.example.test/team.png" },
            },
            private: { comment: "Внутренний проект" },
          },
        },
      });
      this.reply({
        meta: {
          topic: "grpAbCdEfGhI12",
          sub: [
            {
              user: "usrAbCdEfGhI12",
              online: true,
              public: { fn: "Текущий пользователь" },
              acs: { mode: "JRWPA" },
            },
            {
              user: "usrMemberOne12",
              online: true,
              public: { fn: "Иван Петров" },
              acs: { mode: "JR" },
            },
          ],
        },
      });
      this.reply({
        meta: {
          topic: "grpAbCdEfGhI12",
          sub: [
            {
              user: "usrMemberOne12",
              online: false,
            },
          ],
        },
      });
      this.reply({
        ctrl: {
          id: packet.sub.id,
          code: 200,
          params: { topic: "grpAbCdEfGhI12" },
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

test("parses Tinode desc and subscriber metadata", async () => {
  const { parseTinodeChatMetadata } = await loadRealtimeModule();

  assert.deepEqual(
    parseTinodeChatMetadata(
      JSON.stringify({
        meta: {
          topic: "grpAbCdEfGhI12",
          desc: {
            public: { fn: "Команда продукта" },
            private: { comment: "Внутренний проект" },
          },
          sub: [
            {
              user: "usrMemberOne12",
              online: true,
              public: { fn: "Иван Петров" },
              private: { alias: "Иван" },
              acs: { want: "JR", given: "JRW", mode: "JR" },
            },
            { user: "bad" },
          ],
        },
      }),
    ),
    {
      topic: "grpAbCdEfGhI12",
      kind: "group",
      public: { fn: "Команда продукта" },
      private: { comment: "Внутренний проект" },
      participants: [
        {
          userId: "usrMemberOne12",
          online: true,
          access: { want: "JR", given: "JRW", mode: "JR" },
          public: { fn: "Иван Петров" },
          private: { alias: "Иван" },
        },
      ],
    },
  );

  assert.deepEqual(
    parseTinodeChatMetadata(
      JSON.stringify({
        meta: {
          topic: "usrZyXwVuTsR10",
          desc: { public: { fn: "Анна Смирнова" } },
        },
      }),
    ),
    {
      topic: "usrZyXwVuTsR10",
      kind: "direct",
      public: { fn: "Анна Смирнова" },
      participants: [
        {
          userId: "usrZyXwVuTsR10",
          public: { fn: "Анна Смирнова" },
        },
      ],
    },
  );

  assert.equal(
    parseTinodeChatMetadata(JSON.stringify({ meta: { topic: "me", sub: [] } })),
    null,
  );
  assert.equal(
    parseTinodeChatMetadata(
      JSON.stringify({ meta: { topic: "grpAbCdEfGhI12" } }),
    ),
    null,
  );
});

test("requests and merges metadata only for an attached chat", async () => {
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
      () => undefined,
      () => undefined,
      (metadata) => snapshots.push(structuredClone(metadata)),
    );

    await client.connect({
      apiBaseUrl: "https://gateway.example.test",
      accessToken: "access-token",
      deviceId: "device-id",
    });

    assert.deepEqual(client.getChatMetadata(), []);

    await client.subscribeToChat("grpAbCdEfGhI12", { historyLimit: 20 });

    const socket = FakeWebSocket.instances[0];
    const request = socket.sent.find(
      (packet) => packet.sub?.topic === "grpAbCdEfGhI12",
    );
    assert.deepEqual(request.sub.get, {
      what: "desc sub data",
      sub: { limit: 100 },
      data: { limit: 20 },
    });

    assert.deepEqual(client.getChatMetadata("grpAbCdEfGhI12"), [
      {
        topic: "grpAbCdEfGhI12",
        kind: "group",
        public: {
          fn: "Команда продукта",
          photo: { ref: "https://media.example.test/team.png" },
        },
        private: { comment: "Внутренний проект" },
        participants: [
          {
            userId: "usrAbCdEfGhI12",
            online: true,
            access: { mode: "JRWPA" },
            public: { fn: "Текущий пользователь" },
          },
          {
            userId: "usrMemberOne12",
            online: false,
            access: { mode: "JR" },
            public: { fn: "Иван Петров" },
          },
        ],
      },
    ]);
    assert.ok(snapshots.length >= 2);
    assert.notDeepEqual(
      client.getChatMetadata().map((metadata) => metadata.topic),
      ["grpUnknownTop12"],
    );

    client.disconnect();
    assert.deepEqual(snapshots.at(-1), []);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});
