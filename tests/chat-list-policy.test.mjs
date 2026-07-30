import assert from "node:assert/strict";
import test from "node:test";

import {
  getChatPreview,
  sortChatsByActivity,
  withLatestDeliveryStatus,
  withLatestMessage,
} from "../app/chat-list-policy.mjs";

const baseChat = {
  id: "anna",
  kind: "work",
  subtitle: "Старое сообщение",
  time: "12:00",
  unread: 0,
  lastActivityOrder: 1,
};

test("uses the actual latest outgoing message in the chat row", () => {
  const message = {
    id: 10,
    side: "out",
    text: "Отправлю документ сегодня",
    time: "14:22",
    deliveryStatus: "sent",
  };

  const updated = withLatestMessage(baseChat, message, 8);

  assert.equal(updated.subtitle, "Вы: Отправлю документ сегодня");
  assert.equal(updated.time, "14:22");
  assert.equal(updated.lastMessageId, 10);
  assert.equal(updated.lastMessageSide, "out");
  assert.equal(updated.lastDeliveryStatus, "sent");
  assert.equal(updated.lastActivityOrder, 8);
});

test("formats incoming direct, group and voice previews correctly", () => {
  assert.equal(
    getChatPreview(
      { side: "in", author: "Анна", text: "Документ готов" },
      "work",
    ),
    "Документ готов",
  );
  assert.equal(
    getChatPreview(
      { side: "in", author: "Марк", text: "Макеты готовы" },
      "group",
    ),
    "Марк: Макеты готовы",
  );
  assert.equal(
    getChatPreview({ side: "in", author: "Илья", voice: "0:12" }, "work"),
    "🎙 Голосовое сообщение",
  );
  assert.equal(
    getChatPreview(
      { side: "out", text: "Проверю", replyToId: 10 },
      "work",
    ),
    "Вы: ↩ Проверю",
  );
  assert.equal(
    getChatPreview(
      {
        side: "in",
        author: "Марк",
        text: "Макеты готовы",
        forwardedFrom: "Анна",
      },
      "group",
    ),
    "Марк: ↪ Макеты готовы",
  );
});

test("incoming messages increase unread state and move the chat by activity", () => {
  const incoming = withLatestMessage(
    baseChat,
    {
      id: 11,
      side: "in",
      author: "Анна",
      text: "Проверьте обновление",
      time: "14:25",
    },
    9,
    true,
  );
  const other = { ...baseChat, id: "ilya", lastActivityOrder: 3 };

  assert.equal(incoming.unread, 1);
  assert.deepEqual(
    sortChatsByActivity([other, incoming]).map((chat) => chat.id),
    ["anna", "ilya"],
  );
});

test("keeps pinned chats first and sorts each section by latest activity", () => {
  const chats = [
    { id: "old", pinned: false, lastActivityOrder: 1 },
    { id: "latest", pinned: false, lastActivityOrder: 10 },
    { id: "pinned-old", pinned: true, lastActivityOrder: 2 },
    { id: "pinned-latest", pinned: true, lastActivityOrder: 7 },
  ];

  assert.deepEqual(
    sortChatsByActivity(chats).map((chat) => chat.id),
    ["pinned-latest", "pinned-old", "latest", "old"],
  );
});

test("updates a row status only while that outgoing message remains latest", () => {
  const outgoing = withLatestMessage(
    baseChat,
    {
      id: 12,
      side: "out",
      text: "Сообщение",
      time: "14:30",
      deliveryStatus: "sent",
    },
    10,
  );
  const delivered = withLatestDeliveryStatus(outgoing, 12, "delivered");
  const read = withLatestDeliveryStatus(delivered, 12, "read");

  assert.equal(delivered.lastDeliveryStatus, "delivered");
  assert.equal(read.lastDeliveryStatus, "read");
  assert.equal(withLatestDeliveryStatus(read, 999, "sent"), read);
});
