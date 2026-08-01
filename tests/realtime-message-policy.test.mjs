import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRealtimeTextPayload,
  parseRealtimeMessageContent,
} from "../app/realtime-message-policy.mjs";

test("keeps plain realtime messages as text/plain", () => {
  assert.deepEqual(buildRealtimeTextPayload("  Привет  "), {
    head: { mime: "text/plain" },
    content: "Привет",
  });
  assert.deepEqual(parseRealtimeMessageContent("Привет", {}), {
    text: "Привет",
  });
});

test("builds and parses a Tinode Drafty reply quote", () => {
  const payload = buildRealtimeTextPayload("Отвечаю", {
    id: 42,
    author: "Иван Морозов",
    authorId: "usrMorozov01",
    text: "Исходное сообщение",
  });

  assert.equal(payload.head.mime, "text/x-drafty");
  assert.equal(payload.head["x-cifra-reply-seq"], 42);
  assert.equal(payload.content.txt, "Иван Морозов Исходное сообщение Отвечаю");
  assert.equal(payload.content.fmt.some((format) => format.tp === "QQ"), true);
  assert.equal(
    payload.content.fmt.filter((format) => format.tp === "BR").length,
    2,
  );
  assert.deepEqual(payload.content.ent, [
    { tp: "MN", data: { val: "usrMorozov01" } },
  ]);

  assert.deepEqual(parseRealtimeMessageContent(payload.content, payload.head), {
    text: "Отвечаю",
    replyToId: 42,
    replyPreview: {
      author: "Иван Морозов",
      text: "Исходное сообщение",
    },
  });
});

test("parses the earlier newline-based quote payload for compatibility", () => {
  const content = {
    txt: "Иван Морозов\nИсходное сообщение\nОтвечаю",
    fmt: [{ at: 0, len: 31, tp: "QQ" }],
  };
  assert.deepEqual(
    parseRealtimeMessageContent(content, { "x-cifra-reply-seq": "42" }),
    {
      text: "Отвечаю",
      replyToId: 42,
      replyPreview: {
        author: "Иван Морозов",
        text: "Исходное сообщение",
      },
    },
  );
});

test("rejects empty realtime message payloads", () => {
  assert.equal(buildRealtimeTextPayload("   "), null);
  assert.equal(parseRealtimeMessageContent({ txt: "" }, {}), null);
});
