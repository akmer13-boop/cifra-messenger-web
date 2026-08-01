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

class GroupSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  readyState = GroupSocket.CONNECTING;
  sent = [];
  listeners = new Map();

  constructor(url) {
    this.url = url;
    GroupSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = GroupSocket.OPEN;
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
      return this.reply({
        ctrl: { id: packet.sub.id, code: 200, params: { topic: "me" } },
      });
    }
    if (packet.sub?.topic?.startsWith("new")) {
      return this.reply({
        ctrl: {
          id: packet.sub.id,
          topic: "grpCreated01",
          code: 200,
          params: { topic: "grpCreated01" },
        },
      });
    }
    if (packet.set?.sub?.user) {
      return this.reply({
        ctrl: {
          id: packet.set.id,
          topic: packet.set.topic,
          code: 200,
        },
      });
    }
  }

  close() {
    this.readyState = GroupSocket.CLOSED;
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

test("creates a real group topic and invites selected realtime users", async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  GroupSocket.instances = [];
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
  globalThis.WebSocket = GroupSocket;

  try {
    const { CifraRealtimeClient } = await loadRealtimeModule();
    const client = new CifraRealtimeClient();
    await client.connect({
      apiBaseUrl: "https://gateway.example.test",
      accessToken: "access",
      deviceId: "device",
    });

    const result = await client.createGroup("Проект Север", [
      "usrMemberOne01",
      "usrMemberTwo02",
    ]);

    assert.deepEqual(result, {
      topic: "grpCreated01",
      invitedUserIds: ["usrMemberOne01", "usrMemberTwo02"],
      failedUserIds: [],
    });

    const packets = GroupSocket.instances[0].sent;
    const create = packets.find((packet) => packet.sub?.topic?.startsWith("new"));
    assert.equal(create.sub.set.desc.public.fn, "Проект Север");
    assert.equal(create.sub.get.what, "desc sub");

    const invites = packets.filter((packet) => packet.set?.sub?.user);
    assert.deepEqual(
      invites.map((packet) => packet.set.sub.user),
      ["usrMemberOne01", "usrMemberTwo02"],
    );
    assert.equal(invites.every((packet) => packet.set.sub.mode === "JRWPS"), true);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  }
});
