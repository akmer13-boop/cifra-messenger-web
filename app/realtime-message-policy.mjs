const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const graphemes = (value) => Array.from(String(value ?? ""));
const graphemeLength = (value) => graphemes(value).length;
const sliceGraphemes = (value, start, end) =>
  graphemes(value).slice(start, end).join("");

const normalizeText = (value, limit = 500) =>
  typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, limit)
    : "";

const getReplySeq = (head) => {
  if (!isRecord(head)) return undefined;
  const value = head["x-cifra-reply-seq"];
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return parsed > 0 ? parsed : undefined;
  }
  return undefined;
};

const getValidFormats = (content) =>
  Array.isArray(content?.fmt)
    ? content.fmt.filter(
        (format) =>
          isRecord(format) &&
          Number.isInteger(format.at) &&
          Number.isInteger(format.len),
      )
    : [];

const parseQuote = (content) => {
  if (!isRecord(content) || typeof content.txt !== "string") return null;
  const formats = getValidFormats(content);
  const quote = formats.find(
    (format) =>
      format.tp === "QQ" &&
      format.at >= 0 &&
      format.len > 0,
  );
  if (!quote) return null;

  const quoteStart = quote.at;
  const quoteEnd = quote.at + quote.len;
  const quoteBreak = formats.find(
    (format) =>
      format.tp === "BR" &&
      format.at >= quoteStart &&
      format.at < quoteEnd,
  );
  const trailingBreak = formats.find(
    (format) =>
      format.tp === "BR" && format.at === quoteEnd,
  );

  let author = "Сообщение";
  let quotedText = "Ответ на сообщение";

  if (quoteBreak) {
    author =
      normalizeText(
        sliceGraphemes(content.txt, quoteStart, quoteBreak.at),
        120,
      ) || "Сообщение";
    quotedText =
      normalizeText(
        sliceGraphemes(
          content.txt,
          quoteBreak.at + Math.max(quoteBreak.len, 1),
          quoteEnd,
        ),
        280,
      ) || "Ответ на сообщение";
  } else {
    const legacyQuoteText = sliceGraphemes(
      content.txt,
      quoteStart,
      quoteEnd,
    ).trim();
    const [authorLine = "Сообщение", ...bodyLines] =
      legacyQuoteText.split(/\r?\n/);
    author = normalizeText(authorLine, 120) || "Сообщение";
    quotedText =
      normalizeText(bodyLines.join(" "), 280) ||
      normalizeText(legacyQuoteText.slice(authorLine.length), 280) ||
      "Ответ на сообщение";
  }

  const messageStart =
    quoteEnd + (trailingBreak ? Math.max(trailingBreak.len, 1) : 0);
  const messageText = `${sliceGraphemes(content.txt, 0, quoteStart)} ${sliceGraphemes(content.txt, messageStart)}`
    .replace(/^\s+/, "")
    .trim();

  return {
    messageText,
    replyPreview: { author, text: quotedText },
  };
};

export const parseRealtimeMessageContent = (content, head) => {
  if (typeof content === "string") {
    const text = content.trim();
    return text ? { text } : null;
  }

  if (!isRecord(content) || typeof content.txt !== "string") return null;

  const quote = parseQuote(content);
  const text = (quote?.messageText || content.txt).trim();
  if (!text) return null;

  const replyToId = getReplySeq(head);
  return {
    text,
    ...(replyToId ? { replyToId } : {}),
    ...(quote?.replyPreview ? { replyPreview: quote.replyPreview } : {}),
  };
};

export const buildRealtimeTextPayload = (text, reply) => {
  const normalizedText = normalizeText(text, 10_000);
  if (!normalizedText) return null;

  const replyId =
    Number.isInteger(reply?.id) && reply.id > 0 ? reply.id : undefined;
  const replyAuthor = normalizeText(reply?.author, 120);
  const replyText = normalizeText(reply?.text, 280);

  if (!replyId || !replyAuthor || !replyText) {
    return {
      head: { mime: "text/plain" },
      content: normalizedText,
    };
  }

  // This mirrors Tinode Drafty.quote + appendLineBreak + append:
  // author mention, BR, quoted body wrapped with QQ, BR, new message.
  const authorLength = graphemeLength(replyAuthor);
  const quoteText = `${replyAuthor} ${replyText}`;
  const quoteLength = graphemeLength(quoteText);
  const content = {
    txt: `${quoteText} ${normalizedText}`,
    fmt: [
      { at: authorLength, len: 1, tp: "BR" },
      { at: 0, len: quoteLength, tp: "QQ" },
      { at: quoteLength, len: 1, tp: "BR" },
    ],
  };

  const replyAuthorId = normalizeText(reply?.authorId, 120);
  if (replyAuthorId) {
    content.fmt.unshift({
      at: 0,
      len: authorLength,
      key: 0,
    });
    content.ent = [
      {
        tp: "MN",
        data: { val: replyAuthorId },
      },
    ];
  }

  return {
    head: {
      mime: "text/x-drafty",
      "x-cifra-reply-seq": replyId,
    },
    content,
  };
};
