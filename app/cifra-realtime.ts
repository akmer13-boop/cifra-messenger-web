import type { CifraMessageEnvelope } from "../lib/media/contracts";

type RealtimeReplyPayload = {
  readonly id?: number;
  readonly text?: string;
  readonly author?: string;
  readonly authorId?: string;
};

const normalizeRealtimeText = (value: unknown, limit: number): string =>
  typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, limit)
    : "";

const realtimeGraphemes = (value: string): string[] => Array.from(value);

const buildRealtimeTextPayload = (
  text: string,
  reply: RealtimeReplyPayload,
): {
  readonly head: Readonly<Record<string, unknown>>;
  readonly content: unknown;
} | null => {
  const normalizedText = normalizeRealtimeText(text, 10_000);
  if (!normalizedText) return null;

  const replyId =
    Number.isInteger(reply.id) && Number(reply.id) > 0
      ? Number(reply.id)
      : undefined;
  const replyAuthor = normalizeRealtimeText(reply.author, 120);
  const replyText = normalizeRealtimeText(reply.text, 280);

  if (!replyId || !replyAuthor || !replyText) {
    return {
      head: { mime: "text/plain" },
      content: normalizedText,
    };
  }

  const quoteText = `${replyAuthor}\n${replyText}`;
  const format: Array<Record<string, unknown>> = [
    {
      at: 0,
      len: realtimeGraphemes(quoteText).length,
      tp: "QQ",
    },
  ];
  const content: Record<string, unknown> = {
    txt: `${quoteText}\n${normalizedText}`,
    fmt: format,
  };
  const replyAuthorId = normalizeRealtimeText(reply.authorId, 120);
  if (replyAuthorId) {
    format.unshift({
      at: 0,
      len: realtimeGraphemes(replyAuthor).length,
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

export type RealtimeStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface RealtimeTicketResponse {
  readonly ticket: string;
  readonly expires_in: number;
  readonly expires_at: string;
  readonly channel: "tinode";
  readonly endpoint: {
    readonly url: string;
    readonly protocol: "tinode";
    readonly auth_scheme: "cifra";
    readonly ticket_transport: "login_secret";
    readonly ticket_encoding: "base64";
  };
}

interface TinodeControl {
  readonly id?: string;
  readonly topic?: string;
  readonly code: number;
  readonly text?: string;
  readonly timestamp?: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface RealtimeConnectParams {
  readonly apiBaseUrl: string;
  readonly accessToken: string;
  readonly deviceId: string;
  readonly ticketProvider?: () => Promise<unknown>;
}

export interface RealtimeChatSubscription {
  readonly topic: string;
  readonly updatedAt?: string;
  readonly touchedAt?: string;
  readonly seq?: number;
  readonly read?: number;
  readonly recv?: number;
  readonly online?: boolean;
  readonly access?: {
    readonly want?: string;
    readonly given?: string;
    readonly mode?: string;
  };
  readonly public?: Readonly<Record<string, unknown>>;
  readonly private?: Readonly<Record<string, unknown>>;
}

export type RealtimeChatKind = "direct" | "group" | "channel";

export interface RealtimeChatParticipant {
  readonly userId: string;
  readonly online?: boolean;
  readonly access?: {
    readonly want?: string;
    readonly given?: string;
    readonly mode?: string;
  };
  readonly public?: Readonly<Record<string, unknown>>;
  readonly private?: Readonly<Record<string, unknown>>;
}

export interface RealtimeChatMetadata {
  readonly topic: string;
  readonly kind: RealtimeChatKind;
  readonly public?: Readonly<Record<string, unknown>>;
  readonly private?: Readonly<Record<string, unknown>>;
  readonly participants?: readonly RealtimeChatParticipant[];
}

export interface RealtimeChatMessage {
  readonly topic: string;
  readonly seq: number;
  readonly from?: string;
  readonly timestamp: string;
  readonly head?: Readonly<Record<string, unknown>>;
  readonly content: unknown;
}

export interface RealtimeChatSubscribeOptions {
  readonly historyLimit?: number;
}

export interface RealtimeHistoryPageResult {
  readonly topic: string;
  readonly before: number;
  readonly receivedCount: number;
  readonly addedCount: number;
  readonly oldestSeq: number | null;
  readonly hasMore: boolean;
}

export interface RealtimePublishTextResult {
  readonly topic: string;
  readonly seq: number;
  readonly timestamp?: string;
}

export type RealtimePublishEnvelopeResult = RealtimePublishTextResult;

export interface RealtimePublishTextOptions {
  readonly replyToId?: number;
  readonly replyToText?: string;
  readonly replyToAuthor?: string;
  readonly replyToAuthorId?: string;
}

export interface RealtimeCreateGroupResult {
  readonly topic: string;
  readonly invitedUserIds: readonly string[];
  readonly failedUserIds: readonly string[];
}

export interface RealtimeOpenDirectResult {
  readonly topic: string;
  readonly peerUserId: string;
  readonly created: boolean;
}

export type RealtimeReceiptKind = "recv" | "read";

export interface RealtimeChatReceipt {
  readonly topic: string;
  readonly from: string;
  readonly what: RealtimeReceiptKind;
  readonly seq: number;
}

type RealtimeStatusListener = (
  status: RealtimeStatus,
  error?: string,
) => void;

type RealtimeSubscriptionsListener = (
  subscriptions: readonly RealtimeChatSubscription[],
) => void;

type RealtimeMessagesListener = (
  messages: readonly RealtimeChatMessage[],
) => void;

type RealtimeReceiptsListener = (
  receipts: readonly RealtimeChatReceipt[],
) => void;

type RealtimeMetadataListener = (
  metadata: readonly RealtimeChatMetadata[],
) => void;

export interface RealtimeDiagnostics {
  readonly connectionGeneration: number;
  readonly reconnectSuccessCount: number;
  readonly duplicateMessageCount: number;
  readonly lastError?: string;
}

export interface RealtimeClientOptions {
  readonly reconnectBaseDelayMs?: number;
  readonly reconnectMaxDelayMs?: number;
  readonly onDiagnostics?: (diagnostics: RealtimeDiagnostics) => void;
}

interface TinodeSubscriptionBatch {
  readonly topic: string;
  readonly requestId?: string;
  readonly subscriptions: readonly RealtimeChatSubscription[];
}

export interface TinodeDirectoryResults {
  readonly requestId?: string;
  readonly userIds: readonly string[];
}

const REQUEST_TIMEOUT_MS = 15_000;
const TINODE_VERSION = "0.25";

export class CifraRealtimeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CifraRealtimeError";
  }
}

export class CifraRealtimeClient {
  private socket: WebSocket | null = null;
  private status: RealtimeStatus = "disconnected";
  private connectPromise: Promise<string> | null = null;
  private tinodeUserId: string | null = null;
  private subscribedTopics = new Set<string>();
  private chatSubscriptions = new Map<
    string,
    RealtimeChatSubscription
  >();
  private chatMessages = new Map<string, RealtimeChatMessage>();
  private chatReceipts = new Map<string, RealtimeChatReceipt>();
  private chatMetadata = new Map<string, RealtimeChatMetadata>();
  private localReceiptProgress = new Map<
    string,
    { recv: number; read: number }
  >();
  private chatSubscribePromises = new Map<string, Promise<void>>();
  private directOpenPromises = new Map<
    string,
    Promise<RealtimeOpenDirectResult>
  >();
  private attachingTopics = new Set<string>();
  private desiredChatSubscriptions = new Map<string, number>();
  private connectionParams: RealtimeConnectParams | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private reconnectEnabled = false;
  private connectionAttempt = 0;
  private connectionGeneration = 0;
  private reconnectSuccessCount = 0;
  private duplicateMessageCount = 0;
  private lastError: string | undefined;
  private directorySearchQueue: Promise<void> = Promise.resolve();
  private historyLoadPromises = new Map<
    string,
    Promise<RealtimeHistoryPageResult>
  >();
  private exhaustedHistoryTopics = new Set<string>();

  constructor(
    private readonly onStatus: RealtimeStatusListener = () => undefined,
    private readonly onSubscriptions: RealtimeSubscriptionsListener =
      () => undefined,
    private readonly onMessages: RealtimeMessagesListener =
      () => undefined,
    private readonly onReceipts: RealtimeReceiptsListener =
      () => undefined,
    private readonly onMetadata: RealtimeMetadataListener =
      () => undefined,
    private readonly options: RealtimeClientOptions = {},
  ) {}

  getStatus(): RealtimeStatus {
    return this.status;
  }

  getTinodeUserId(): string | null {
    return this.tinodeUserId;
  }

  getDiagnostics(): RealtimeDiagnostics {
    return {
      connectionGeneration: this.connectionGeneration,
      reconnectSuccessCount: this.reconnectSuccessCount,
      duplicateMessageCount: this.duplicateMessageCount,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  getSubscribedTopics(): readonly string[] {
    return Array.from(this.subscribedTopics);
  }

  isTopicSubscribed(topic: string): boolean {
    return this.subscribedTopics.has(topic);
  }

  getChatSubscriptions(): readonly RealtimeChatSubscription[] {
    return Array.from(this.chatSubscriptions.values());
  }

  getChatTopicIds(): readonly string[] {
    return Array.from(this.chatSubscriptions.keys());
  }

  getChatMetadata(topic?: string): readonly RealtimeChatMetadata[] {
    return Array.from(this.chatMetadata.values())
      .filter((metadata) => !topic || metadata.topic === topic)
      .sort((left, right) => left.topic.localeCompare(right.topic));
  }

  getChatMessages(topic?: string): readonly RealtimeChatMessage[] {
    return Array.from(this.chatMessages.values())
      .filter((message) => !topic || message.topic === topic)
      .sort((left, right) => {
        const topicOrder = left.topic.localeCompare(right.topic);
        return topicOrder !== 0 ? topicOrder : left.seq - right.seq;
      });
  }

  getChatReceipts(topic?: string): readonly RealtimeChatReceipt[] {
    return Array.from(this.chatReceipts.values())
      .filter((receipt) => !topic || receipt.topic === topic)
      .sort((left, right) => {
        const topicOrder = left.topic.localeCompare(right.topic);
        if (topicOrder !== 0) return topicOrder;

        const fromOrder = left.from.localeCompare(right.from);
        if (fromOrder !== 0) return fromOrder;

        return left.what.localeCompare(right.what);
      });
  }

  isConnected(): boolean {
    return (
      this.status === "connected" &&
      this.socket?.readyState === WebSocket.OPEN
    );
  }

  async connect(params: RealtimeConnectParams): Promise<string> {
    if (this.isConnected() && this.tinodeUserId) {
      return this.tinodeUserId;
    }

    this.connectionParams = params;
    this.reconnectEnabled = true;
    this.cancelReconnectTimer();

    return this.startConnection(params, false);
  }

  async subscribeToChat(
    topic: string,
    options: RealtimeChatSubscribeOptions = {},
  ): Promise<void> {
    if (!isChatTopicName(topic)) {
      throw new CifraRealtimeError("tinode_chat_topic_invalid");
    }

    const subscription = this.chatSubscriptions.get(topic);

    if (!subscription) {
      throw new CifraRealtimeError("tinode_chat_topic_unknown");
    }

    if (
      subscription.access?.mode &&
      !subscription.access.mode.includes("R")
    ) {
      throw new CifraRealtimeError("tinode_chat_read_access_denied");
    }

    const socket = this.socket;

    if (
      !this.isConnected() ||
      !socket ||
      socket.readyState !== WebSocket.OPEN
    ) {
      throw new CifraRealtimeError("realtime_not_connected");
    }

    const historyLimit = normalizeHistoryLimit(options.historyLimit);

    if (this.subscribedTopics.has(topic)) {
      this.desiredChatSubscriptions.set(topic, historyLimit);
      return;
    }

    const pending = this.chatSubscribePromises.get(topic);

    if (pending) {
      return pending;
    }

    this.attachingTopics.add(topic);

    const subscribePromise = this.subscribeToChatInternal(
      socket,
      topic,
      historyLimit,
    ).then(() => {
      this.desiredChatSubscriptions.set(topic, historyLimit);
    }).finally(() => {
      if (this.chatSubscribePromises.get(topic) === subscribePromise) {
        this.chatSubscribePromises.delete(topic);
      }
      this.attachingTopics.delete(topic);
    });

    this.chatSubscribePromises.set(topic, subscribePromise);
    return subscribePromise;
  }

  async findUserByDirectoryQueries(
    queries: readonly string[],
  ): Promise<string | null> {
    const normalizedQueries = Array.from(
      new Set(
        queries
          .filter((query): query is string => typeof query === "string")
          .map((query) => query.trim().slice(0, 96))
          .filter(Boolean),
      ),
    );

    if (normalizedQueries.length === 0) return null;

    const search = this.directorySearchQueue.then(() =>
      this.findUserInDirectoryInternal(normalizedQueries),
    );
    this.directorySearchQueue = search.then(
      () => undefined,
      () => undefined,
    );
    return search;
  }

  async loadOlderMessages(
    topic: string,
    historyLimit = 50,
  ): Promise<RealtimeHistoryPageResult> {
    if (!isChatTopicName(topic)) {
      throw new CifraRealtimeError("tinode_chat_topic_invalid");
    }
    const subscription = this.chatSubscriptions.get(topic);
    if (!subscription) {
      throw new CifraRealtimeError("tinode_chat_topic_unknown");
    }
    if (subscription.access?.mode && !subscription.access.mode.includes("R")) {
      throw new CifraRealtimeError("tinode_chat_read_access_denied");
    }
    const socket = this.socket;
    if (!this.isConnected() || !socket || socket.readyState !== WebSocket.OPEN) {
      throw new CifraRealtimeError("realtime_not_connected");
    }
    if (!this.subscribedTopics.has(topic)) {
      throw new CifraRealtimeError("tinode_chat_not_subscribed");
    }

    const pending = this.historyLoadPromises.get(topic);
    if (pending) return pending;

    const messages = this.getChatMessages(topic);
    const query = buildTinodeOlderHistoryQuery(
      topic,
      historyLimit,
      messages,
      subscription.seq,
    );
    if (!query || this.exhaustedHistoryTopics.has(topic)) {
      return {
        topic,
        before: query?.before ?? 1,
        receivedCount: 0,
        addedCount: 0,
        oldestSeq: getOldestTopicSeq(messages, topic),
        hasMore: false,
      };
    }

    const request = this.loadOlderMessagesInternal(
      socket,
      topic,
      query,
    ).finally(() => {
      if (this.historyLoadPromises.get(topic) === request) {
        this.historyLoadPromises.delete(topic);
      }
    });
    this.historyLoadPromises.set(topic, request);
    return request;
  }

  async openDirectConversation(
    peerUserId: string,
    options: RealtimeChatSubscribeOptions = {},
  ): Promise<RealtimeOpenDirectResult> {
    if (!isUserTopicName(peerUserId)) {
      throw new CifraRealtimeError("tinode_direct_user_invalid");
    }
    if (peerUserId === this.tinodeUserId) {
      throw new CifraRealtimeError("tinode_direct_self_forbidden");
    }

    const existing = this.chatSubscriptions.get(peerUserId);
    if (existing) {
      await this.subscribeToChat(peerUserId, options);
      return {
        topic: peerUserId,
        peerUserId,
        created: false,
      };
    }

    const pending = this.directOpenPromises.get(peerUserId);
    if (pending) return pending;

    const openPromise = this.openDirectConversationInternal(
      peerUserId,
      normalizeHistoryLimit(options.historyLimit),
    ).finally(() => {
      if (this.directOpenPromises.get(peerUserId) === openPromise) {
        this.directOpenPromises.delete(peerUserId);
      }
    });
    this.directOpenPromises.set(peerUserId, openPromise);
    return openPromise;
  }

  async publishText(
    topic: string,
    text: string,
    options: RealtimePublishTextOptions = {},
  ): Promise<RealtimePublishTextResult> {
    if (!isChatTopicName(topic)) {
      throw new CifraRealtimeError("tinode_chat_topic_invalid");
    }

    const normalizedText = text.trim();

    if (!normalizedText) {
      throw new CifraRealtimeError("tinode_publish_text_empty");
    }

    const subscription = this.chatSubscriptions.get(topic);

    if (!subscription) {
      throw new CifraRealtimeError("tinode_chat_topic_unknown");
    }

    if (
      subscription.access?.mode &&
      !subscription.access.mode.includes("W")
    ) {
      throw new CifraRealtimeError("tinode_chat_write_access_denied");
    }

    const socket = this.socket;

    if (
      !this.isConnected() ||
      !socket ||
      socket.readyState !== WebSocket.OPEN
    ) {
      throw new CifraRealtimeError("realtime_not_connected");
    }

    if (!this.subscribedTopics.has(topic)) {
      throw new CifraRealtimeError("tinode_chat_not_subscribed");
    }

    const payload = buildRealtimeTextPayload(normalizedText, {
      id: options.replyToId,
      text: options.replyToText,
      author: options.replyToAuthor,
      authorId: options.replyToAuthorId,
    });

    if (!payload) {
      throw new CifraRealtimeError("tinode_publish_text_empty");
    }

    const requestId = createPacketId("pub-text");
    const controlPromise = waitForControl(socket, requestId);

    socket.send(
      JSON.stringify({
        pub: {
          id: requestId,
          topic,
          noecho: false,
          head: payload.head,
          content: payload.content,
        },
      }),
    );

    const control = await controlPromise;

    if (this.socket !== socket) {
      throw new CifraRealtimeError("realtime_connection_cancelled");
    }

    if (control.code < 200 || control.code >= 300) {
      throw new CifraRealtimeError("tinode_publish_rejected");
    }

    const seq = parsePositiveInteger(control.params?.["seq"]);

    if (seq === null) {
      throw new CifraRealtimeError("tinode_publish_seq_missing");
    }

    return {
      topic,
      seq,
      ...(control.timestamp
        ? { timestamp: control.timestamp }
        : {}),
    };
  }

  async publishMessageEnvelope(
    topic: string,
    envelopeInput: CifraMessageEnvelope,
  ): Promise<RealtimePublishEnvelopeResult> {
    if (!isChatTopicName(topic)) {
      throw new CifraRealtimeError("tinode_chat_topic_invalid");
    }
    const subscription = this.chatSubscriptions.get(topic);
    if (!subscription) {
      throw new CifraRealtimeError("tinode_chat_topic_unknown");
    }
    if (subscription.access?.mode && !subscription.access.mode.includes("W")) {
      throw new CifraRealtimeError("tinode_chat_write_access_denied");
    }
    const socket = this.socket;
    if (!this.isConnected() || !socket || socket.readyState !== WebSocket.OPEN) {
      throw new CifraRealtimeError("realtime_not_connected");
    }
    if (!this.subscribedTopics.has(topic)) {
      throw new CifraRealtimeError("tinode_chat_not_subscribed");
    }
    // The crypto boundary produces this value through prepareMediaEnvelope(),
    // which applies the normative strict parser before returning. Keeping this
    // transport module import-free also lets it run in the isolated realtime
    // harness used by the client tests.
    const envelope = envelopeInput;
    const requestId = createPacketId(`pub-cifra-${envelope.client_msg_id}`);
    const controlPromise = waitForControl(socket, requestId);
    socket.send(JSON.stringify({
      pub: {
        id: requestId,
        topic,
        noecho: false,
        head: {
          mime: "application/vnd.cifra.envelope+json",
          "x-cifra-client-msg-id": envelope.client_msg_id,
        },
        content: envelope,
      },
    }));
    const control = await controlPromise;
    if (this.socket !== socket) {
      throw new CifraRealtimeError("realtime_connection_cancelled");
    }
    if (control.code < 200 || control.code >= 300) {
      throw new CifraRealtimeError("tinode_publish_rejected");
    }
    const seq = parsePositiveInteger(control.params?.["seq"]);
    if (seq === null) {
      throw new CifraRealtimeError("tinode_publish_seq_missing");
    }
    return {
      topic,
      seq,
      ...(control.timestamp ? { timestamp: control.timestamp } : {}),
    };
  }

  async createGroup(
    name: string,
    memberUserIds: readonly string[],
  ): Promise<RealtimeCreateGroupResult> {
    const normalizedName = name.trim().slice(0, 80);
    const normalizedMembers = Array.from(
      new Set(
        memberUserIds.filter(
          (userId) =>
            typeof userId === "string" &&
            /^usr[A-Za-z0-9_-]+$/.test(userId) &&
            userId !== this.tinodeUserId,
        ),
      ),
    );

    if (!normalizedName) {
      throw new CifraRealtimeError("tinode_group_name_empty");
    }

    if (normalizedMembers.length < 2) {
      throw new CifraRealtimeError("tinode_group_members_insufficient");
    }

    const socket = this.socket;
    if (
      !this.isConnected() ||
      !socket ||
      socket.readyState !== WebSocket.OPEN
    ) {
      throw new CifraRealtimeError("realtime_not_connected");
    }

    const provisionalTopic = `new${Date.now().toString(36)}${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const requestId = createPacketId("sub-new-group");
    const controlPromise = waitForControl(socket, requestId);

    socket.send(
      JSON.stringify({
        sub: {
          id: requestId,
          topic: provisionalTopic,
          set: {
            desc: {
              public: { fn: normalizedName },
            },
          },
          get: {
            what: "desc sub",
            sub: { limit: 100 },
          },
        },
      }),
    );

    const control = await controlPromise;
    if (this.socket !== socket) {
      throw new CifraRealtimeError("realtime_connection_cancelled");
    }
    if (control.code < 200 || control.code >= 300) {
      throw new CifraRealtimeError("tinode_group_create_rejected");
    }

    const returnedTopic =
      typeof control.params?.["topic"] === "string"
        ? control.params["topic"]
        : control.topic;
    if (
      typeof returnedTopic !== "string" ||
      !/^grp[A-Za-z0-9_-]+$/.test(returnedTopic)
    ) {
      throw new CifraRealtimeError("tinode_group_topic_missing");
    }

    const invitedUserIds: string[] = [];
    const failedUserIds: string[] = [];

    for (const userId of normalizedMembers) {
      const inviteId = createPacketId("set-group-member");
      const inviteControlPromise = waitForControl(socket, inviteId);
      socket.send(
        JSON.stringify({
          set: {
            id: inviteId,
            topic: returnedTopic,
            sub: {
              user: userId,
              mode: "JRWPS",
            },
          },
        }),
      );

      try {
        const inviteControl = await inviteControlPromise;
        if (inviteControl.code >= 200 && inviteControl.code < 300) {
          invitedUserIds.push(userId);
        } else {
          failedUserIds.push(userId);
        }
      } catch {
        failedUserIds.push(userId);
      }
    }

    const timestamp = control.timestamp || new Date().toISOString();
    this.subscribedTopics.add(returnedTopic);
    this.desiredChatSubscriptions.set(returnedTopic, 20);
    this.chatSubscriptions.set(returnedTopic, {
      topic: returnedTopic,
      updatedAt: timestamp,
      touchedAt: timestamp,
      access: { mode: "JRWPS" },
      public: { fn: normalizedName },
    });
    this.chatMetadata.set(returnedTopic, {
      topic: returnedTopic,
      kind: "group",
      public: { fn: normalizedName },
      participants: invitedUserIds.map((userId) => ({ userId })),
    });
    this.onSubscriptions(this.getChatSubscriptions());
    this.onMetadata(this.getChatMetadata());

    return {
      topic: returnedTopic,
      invitedUserIds,
      failedUserIds,
    };
  }

  markReceived(topic: string, seq: number): boolean {
    return this.sendReceipt(topic, "recv", seq);
  }

  markRead(topic: string, seq: number): boolean {
    return this.sendReceipt(topic, "read", seq);
  }

  private sendReceipt(
    topic: string,
    what: RealtimeReceiptKind,
    seq: number,
  ): boolean {
    if (!isChatTopicName(topic)) {
      throw new CifraRealtimeError("tinode_chat_topic_invalid");
    }

    const normalizedSeq = parsePositiveInteger(seq);

    if (normalizedSeq === null) {
      throw new CifraRealtimeError("tinode_receipt_seq_invalid");
    }

    const subscription = this.chatSubscriptions.get(topic);

    if (!subscription && !this.attachingTopics.has(topic)) {
      throw new CifraRealtimeError("tinode_chat_topic_unknown");
    }

    if (
      subscription?.access?.mode &&
      !subscription.access.mode.includes("R")
    ) {
      throw new CifraRealtimeError("tinode_chat_read_access_denied");
    }

    const socket = this.socket;

    if (
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      (this.status !== "connected" && this.status !== "reconnecting")
    ) {
      throw new CifraRealtimeError("realtime_not_connected");
    }

    if (
      !this.subscribedTopics.has(topic) &&
      !this.attachingTopics.has(topic)
    ) {
      throw new CifraRealtimeError("tinode_chat_not_subscribed");
    }

    const progress = this.localReceiptProgress.get(topic) ?? {
      recv: 0,
      read: 0,
    };

    if (
      (what === "recv" &&
        normalizedSeq <= Math.max(progress.recv, progress.read)) ||
      (what === "read" && normalizedSeq <= progress.read)
    ) {
      return false;
    }

    socket.send(
      JSON.stringify({
        note: {
          topic,
          what,
          seq: normalizedSeq,
        },
      }),
    );

    this.localReceiptProgress.set(topic, {
      recv: Math.max(progress.recv, normalizedSeq),
      read:
        what === "read"
          ? Math.max(progress.read, normalizedSeq)
          : progress.read,
    });

    return true;
  }

  disconnect(): void {
    this.reconnectEnabled = false;
    this.connectionParams = null;
    this.cancelReconnectTimer();
    this.connectionAttempt += 1;
    this.connectPromise = null;
    this.reconnectAttempt = 0;
    this.connectionGeneration = 0;
    this.reconnectSuccessCount = 0;
    this.duplicateMessageCount = 0;
    this.lastError = undefined;

    const socket = this.socket;

    this.socket = null;
    this.tinodeUserId = null;
    this.subscribedTopics.clear();
    this.chatSubscribePromises.clear();
    this.attachingTopics.clear();
    this.desiredChatSubscriptions.clear();
    this.localReceiptProgress.clear();
    this.clearChatSubscriptions();
    this.clearChatMessages();
    this.clearChatReceipts();
    this.clearChatMetadata();

    if (
      socket &&
      socket.readyState !== WebSocket.CLOSED &&
      socket.readyState !== WebSocket.CLOSING
    ) {
      socket.close(1000, "client_logout");
    }

    this.setStatus("disconnected");
  }

  private async connectInternal(
    params: RealtimeConnectParams,
    attempt: number,
    isReconnect: boolean,
  ): Promise<string> {
    const previousSocket = this.socket;
    const previousUserId = this.tinodeUserId;

    this.socket = null;
    if (!isReconnect) {
      this.tinodeUserId = null;
      this.desiredChatSubscriptions.clear();
      this.localReceiptProgress.clear();
      this.clearChatSubscriptions();
      this.clearChatMessages();
      this.clearChatReceipts();
      this.clearChatMetadata();
    }
    this.subscribedTopics.clear();
    this.chatSubscribePromises.clear();
    this.attachingTopics.clear();

    if (
      previousSocket &&
      previousSocket.readyState !== WebSocket.CLOSED &&
      previousSocket.readyState !== WebSocket.CLOSING
    ) {
      previousSocket.close(1000, "client_reconnect");
    }

    this.setStatus(isReconnect ? "reconnecting" : "connecting");

    let attemptSocket: WebSocket | null = null;

    try {
      const ticket = await issueRealtimeTicketForConnection(params);

      this.ensureActiveAttempt(attempt);

      validateEndpointSecurity(
        ticket.endpoint.url,
        ticket.ticket,
        params.accessToken,
        params.apiBaseUrl,
      );

      const socket = new WebSocket(ticket.endpoint.url);
      attemptSocket = socket;
      this.socket = socket;

      await waitForSocketOpen(socket);
      this.ensureActiveAttempt(attempt, socket);

      const hiId = createPacketId("hi");

      const hiControlPromise = waitForControl(socket, hiId);

      socket.send(
        JSON.stringify({
          hi: {
            id: hiId,
            ver: TINODE_VERSION,
            ua: "CIFRA-Web/0.1",
            dev: params.deviceId,
            lang: "ru",
            platf: "web",
          },
        }),
      );

      const hiControl = await hiControlPromise;
      this.ensureActiveAttempt(attempt, socket);

      if (
        hiControl.code !== 201 ||
        hiControl.params?.["ver"] !== TINODE_VERSION
      ) {
        throw new CifraRealtimeError("tinode_hi_rejected");
      }

      const loginId = createPacketId("login");

      const loginControlPromise = waitForControl(socket, loginId);

      socket.send(
        JSON.stringify({
          login: {
            id: loginId,
            scheme: "cifra",
            secret: btoa(ticket.ticket),
          },
        }),
      );

      const loginControl = await loginControlPromise;
      this.ensureActiveAttempt(attempt, socket);

      const user = loginControl.params?.["user"];
      const authLevel = loginControl.params?.["authlvl"];

      if (
        loginControl.code !== 200 ||
        typeof user !== "string" ||
        !/^usr[A-Za-z0-9_-]{11}$/.test(user) ||
        authLevel !== "auth"
      ) {
        throw new CifraRealtimeError("tinode_login_rejected");
      }

      if (isReconnect && previousUserId && previousUserId !== user) {
        throw new CifraRealtimeError("tinode_reconnect_user_mismatch");
      }

      if (
        loginControl.params &&
        ("token" in loginControl.params ||
          "expires" in loginControl.params)
      ) {
        throw new CifraRealtimeError(
          "tinode_reusable_token_exposed",
        );
      }

      const onTinodeMessage = (event: MessageEvent) => {
        if (
          this.socket !== socket ||
          typeof event.data !== "string"
        ) {
          return;
        }

        const batch = parseTinodeSubscriptionBatch(event.data);

        if (batch?.topic === "me") {
          this.upsertChatSubscriptions(batch.subscriptions);
          return;
        }

        const metadata = parseTinodeChatMetadata(event.data);

        if (
          metadata &&
          (this.subscribedTopics.has(metadata.topic) ||
            this.attachingTopics.has(metadata.topic))
        ) {
          this.upsertChatMetadata(metadata);
        }

        const receipt = parseTinodeChatReceipt(event.data);

        if (
          receipt &&
          (this.subscribedTopics.has(receipt.topic) ||
            this.attachingTopics.has(receipt.topic))
        ) {
          this.upsertChatReceipt(receipt);
          return;
        }

        const message = parseTinodeChatMessage(event.data);

        if (
          message &&
          (this.subscribedTopics.has(message.topic) ||
            this.attachingTopics.has(message.topic))
        ) {
          this.upsertChatMessage(message);

          if (
            message.from &&
            message.from !== this.tinodeUserId
          ) {
            this.markReceived(message.topic, message.seq);
          }
        }
      };

      socket.addEventListener("message", onTinodeMessage);

      const meSubId = createPacketId("sub-me");
      const meSubControlPromise = waitForControl(socket, meSubId);

      socket.send(
        JSON.stringify({
          sub: {
            id: meSubId,
            topic: "me",
            get: {
              what: "desc sub",
            },
          },
        }),
      );

      const meSubControl = await meSubControlPromise;
      this.ensureActiveAttempt(attempt, socket);

      if (meSubControl.code < 200 || meSubControl.code >= 300) {
        throw new CifraRealtimeError(
          "tinode_me_subscription_rejected",
        );
      }

      this.subscribedTopics.add("me");

      socket.addEventListener("close", () => {
        if (this.socket !== socket) {
          return;
        }

        this.socket = null;
        this.subscribedTopics.clear();
        this.chatSubscribePromises.clear();
        this.attachingTopics.clear();

        if (this.reconnectEnabled && this.connectionParams) {
          this.scheduleReconnect("websocket_closed");
          return;
        }

        this.tinodeUserId = null;
        this.setStatus("disconnected");
      });

      socket.addEventListener("error", () => {
        if (this.socket !== socket) {
          return;
        }

        if (
          this.reconnectEnabled &&
          socket.readyState !== WebSocket.CLOSED &&
          socket.readyState !== WebSocket.CLOSING
        ) {
          socket.close(1011, "websocket_failed");
          return;
        }

        this.setStatus("error", "websocket_failed");
      });

      this.ensureActiveAttempt(attempt, socket);
      this.tinodeUserId = user;

      if (isReconnect) {
        await this.restoreDesiredChatSubscriptions(socket);
        this.ensureActiveAttempt(attempt, socket);
      }

      this.reconnectAttempt = 0;
      this.connectionGeneration += 1;
      if (isReconnect) {
        this.reconnectSuccessCount += 1;
      }
      this.setStatus("connected");

      return user;
    } catch (error) {
      const socket = attemptSocket;

      if (this.socket === socket) {
        this.socket = null;
        if (!isReconnect) {
          this.tinodeUserId = null;
          this.localReceiptProgress.clear();
          this.clearChatSubscriptions();
          this.clearChatMessages();
          this.clearChatReceipts();
          this.clearChatMetadata();
        }
        this.subscribedTopics.clear();
        this.chatSubscribePromises.clear();
        this.attachingTopics.clear();
      }

      if (
        socket &&
        socket.readyState !== WebSocket.CLOSED &&
        socket.readyState !== WebSocket.CLOSING
      ) {
        socket.close(1000, "connection_failed");
      }

      const code =
        error instanceof CifraRealtimeError
          ? error.code
          : "realtime_connection_failed";

      const cancelled =
        attempt !== this.connectionAttempt ||
        (error instanceof CifraRealtimeError &&
          error.code === "realtime_connection_cancelled");

      if (!cancelled) {
        this.setStatus(isReconnect ? "reconnecting" : "error", code);
      }

      throw error;
    }
  }

  private startConnection(
    params: RealtimeConnectParams,
    isReconnect: boolean,
  ): Promise<string> {
    if (this.connectPromise) {
      return this.connectPromise;
    }

    const attempt = ++this.connectionAttempt;
    const connectPromise = this.connectInternal(
      params,
      attempt,
      isReconnect,
    ).finally(() => {
      if (this.connectPromise === connectPromise) {
        this.connectPromise = null;
      }
    });

    this.connectPromise = connectPromise;
    return connectPromise;
  }

  private scheduleReconnect(error?: string): void {
    if (
      !this.reconnectEnabled ||
      !this.connectionParams ||
      this.reconnectTimer ||
      this.connectPromise
    ) {
      return;
    }

    const delay = getRealtimeReconnectDelay(
      this.reconnectAttempt,
      this.options.reconnectBaseDelayMs,
      this.options.reconnectMaxDelayMs,
    );
    this.reconnectAttempt += 1;
    this.setStatus("reconnecting", error);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const params = this.connectionParams;

      if (!this.reconnectEnabled || !params) {
        return;
      }

      void this.startConnection(params, true).catch(() => {
        if (this.reconnectEnabled) {
          this.scheduleReconnect("realtime_reconnect_failed");
        }
      });
    }, delay);
  }

  private cancelReconnectTimer(): void {
    if (!this.reconnectTimer) {
      return;
    }

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private async restoreDesiredChatSubscriptions(
    socket: WebSocket,
  ): Promise<void> {
    const subscriptions = Array.from(
      this.desiredChatSubscriptions.entries(),
    ).filter(([topic]) => {
      const subscription = this.chatSubscriptions.get(topic);
      return (
        subscription &&
        (!subscription.access?.mode ||
          subscription.access.mode.includes("R"))
      );
    });

    const results = await Promise.allSettled(
      subscriptions.map(async ([topic, historyLimit]) => {
        this.attachingTopics.add(topic);
        try {
          await this.subscribeToChatInternal(
            socket,
            topic,
            historyLimit,
          );
        } finally {
          this.attachingTopics.delete(topic);
        }
      }),
    );

    if (
      results.some((result) => result.status === "rejected") &&
      results.every((result) => result.status === "rejected")
    ) {
      throw new CifraRealtimeError(
        "tinode_chat_restore_rejected",
      );
    }
  }

  private async findUserInDirectoryInternal(
    queries: readonly string[],
  ): Promise<string | null> {
    const socket = this.socket;
    if (
      !this.isConnected() ||
      !socket ||
      socket.readyState !== WebSocket.OPEN
    ) {
      throw new CifraRealtimeError("realtime_not_connected");
    }

    if (!this.subscribedTopics.has("fnd")) {
      const subscribeId = createPacketId("sub-fnd");
      const subscribeControlPromise = waitForControl(socket, subscribeId);
      socket.send(
        JSON.stringify({
          sub: { id: subscribeId, topic: "fnd" },
        }),
      );
      const subscribeControl = await subscribeControlPromise;
      if (this.socket !== socket) {
        throw new CifraRealtimeError("realtime_connection_cancelled");
      }
      if (subscribeControl.code < 200 || subscribeControl.code >= 300) {
        throw new CifraRealtimeError("tinode_directory_subscription_rejected");
      }
      this.subscribedTopics.add("fnd");
    }

    for (const query of queries) {
      const setId = createPacketId("set-fnd-query");
      const setControlPromise = waitForControl(socket, setId);
      socket.send(
        JSON.stringify({
          set: {
            id: setId,
            topic: "fnd",
            desc: { public: query },
          },
        }),
      );
      const setControl = await setControlPromise;
      if (setControl.code < 200 || setControl.code >= 300) continue;

      const getId = createPacketId("get-fnd-results");
      const resultsPromise = waitForDirectoryResults(socket, getId);
      socket.send(
        JSON.stringify({
          get: {
            id: getId,
            topic: "fnd",
            what: "sub",
          },
        }),
      );
      const results = await resultsPromise;
      if (this.socket !== socket) {
        throw new CifraRealtimeError("realtime_connection_cancelled");
      }
      const matches = results.userIds.filter(
        (userId) => userId !== this.tinodeUserId,
      );
      if (matches.length === 1) return matches[0];
    }

    return null;
  }

  private async openDirectConversationInternal(
    peerUserId: string,
    historyLimit: number,
  ): Promise<RealtimeOpenDirectResult> {
    const socket = this.socket;
    if (
      !this.isConnected() ||
      !socket ||
      socket.readyState !== WebSocket.OPEN
    ) {
      throw new CifraRealtimeError("realtime_not_connected");
    }

    const requestId = createPacketId("sub-direct");
    const controlPromise = waitForControl(socket, requestId);
    this.attachingTopics.add(peerUserId);

    try {
      socket.send(
        JSON.stringify({
          sub: {
            id: requestId,
            topic: peerUserId,
            set: { sub: { mode: "JRWPA" } },
            get: {
              what: "desc sub data",
              sub: { limit: 100 },
              data: { limit: historyLimit },
            },
          },
        }),
      );

      const control = await controlPromise;
      if (this.socket !== socket) {
        throw new CifraRealtimeError("realtime_connection_cancelled");
      }
      if (control.code < 200 || control.code >= 300) {
        throw new CifraRealtimeError("tinode_direct_subscription_rejected");
      }

      const timestamp = control.timestamp || new Date().toISOString();
      const access = parseTinodeAccess(control.params?.["acs"]) ?? {
        mode: "JRWPA",
      };
      this.subscribedTopics.add(peerUserId);
      this.desiredChatSubscriptions.set(peerUserId, historyLimit);
      this.upsertChatSubscriptions([
        {
          topic: peerUserId,
          updatedAt: timestamp,
          touchedAt: timestamp,
          access,
        },
      ]);
      this.upsertChatMetadata({
        topic: peerUserId,
        kind: "direct",
        participants: [{ userId: peerUserId }],
      });

      return {
        topic: peerUserId,
        peerUserId,
        created: true,
      };
    } finally {
      this.attachingTopics.delete(peerUserId);
    }
  }

  private async loadOlderMessagesInternal(
    socket: WebSocket,
    topic: string,
    query: { readonly before: number; readonly limit: number },
  ): Promise<RealtimeHistoryPageResult> {
    const requestId = createPacketId("get-history");
    const existingKeys = new Set(
      this.getChatMessages(topic).map(
        (message) => `${message.topic}:${message.seq}`,
      ),
    );
    const pagePromise = waitForHistoryPage(
      socket,
      requestId,
      topic,
      query.before,
    );

    socket.send(
      JSON.stringify({
        get: {
          id: requestId,
          topic,
          what: "data",
          data: query,
        },
      }),
    );

    const page = await pagePromise;
    if (this.socket !== socket) {
      throw new CifraRealtimeError("realtime_connection_cancelled");
    }
    if (page.control.code < 200 || page.control.code >= 300) {
      throw new CifraRealtimeError("tinode_history_page_rejected");
    }

    const receivedKeys = new Set(
      page.messages.map((message) => `${message.topic}:${message.seq}`),
    );
    const addedCount = Array.from(receivedKeys).filter(
      (key) => !existingKeys.has(key),
    ).length;
    if (page.messages.length > 0 && addedCount === 0) {
      throw new CifraRealtimeError("tinode_history_page_repeated");
    }

    const oldestSeq = getOldestTopicSeq(this.getChatMessages(topic), topic);
    if (addedCount > 0 && (oldestSeq === null || oldestSeq >= query.before)) {
      throw new CifraRealtimeError("tinode_history_page_invalid");
    }

    const hasMore =
      page.messages.length === query.limit &&
      oldestSeq !== null &&
      oldestSeq > 1;
    if (!hasMore) this.exhaustedHistoryTopics.add(topic);

    return {
      topic,
      before: query.before,
      receivedCount: page.messages.length,
      addedCount,
      oldestSeq,
      hasMore,
    };
  }

  private async subscribeToChatInternal(
    socket: WebSocket,
    topic: string,
    historyLimit: number,
  ): Promise<void> {
    const requestId = createPacketId("sub-chat");
    const controlPromise = waitForControl(socket, requestId);

    socket.send(
      JSON.stringify({
        sub: {
          id: requestId,
          topic,
          get: {
            what: "desc sub data",
            sub: {
              limit: 100,
            },
            data: buildTinodeHistoryQuery(
              topic,
              historyLimit,
              this.getChatMessages(topic),
              this.chatSubscriptions.get(topic)?.seq,
            ),
          },
        },
      }),
    );

    const control = await controlPromise;

    if (this.socket !== socket) {
      throw new CifraRealtimeError("realtime_connection_cancelled");
    }

    if (control.code < 200 || control.code >= 300) {
      throw new CifraRealtimeError(
        "tinode_chat_subscription_rejected",
      );
    }

    this.subscribedTopics.add(topic);
  }

  private upsertChatSubscriptions(
    subscriptions: readonly RealtimeChatSubscription[],
  ): void {
    if (subscriptions.length === 0) {
      return;
    }

    for (const subscription of subscriptions) {
      this.chatSubscriptions.set(
        subscription.topic,
        subscription,
      );
    }

    this.onSubscriptions(this.getChatSubscriptions());
  }

  private upsertChatMetadata(metadata: RealtimeChatMetadata): void {
    const current = this.chatMetadata.get(metadata.topic);
    const next: RealtimeChatMetadata = {
      topic: metadata.topic,
      kind: metadata.kind,
      ...(metadata.public
        ? { public: metadata.public }
        : current?.public
          ? { public: current.public }
          : {}),
      ...(metadata.private
        ? { private: metadata.private }
        : current?.private
          ? { private: current.private }
          : {}),
      ...(metadata.participants
        ? {
            participants: mergeTinodeChatParticipants(
              current?.participants,
              metadata.participants,
            ),
          }
        : current?.participants
          ? { participants: current.participants }
          : {}),
    };

    this.chatMetadata.set(metadata.topic, next);
    this.onMetadata(this.getChatMetadata());
  }

  private upsertChatMessage(message: RealtimeChatMessage): void {
    const key = `${message.topic}:${message.seq}`;

    if (this.chatMessages.has(key)) {
      this.duplicateMessageCount += 1;
      this.emitDiagnostics();
      return;
    }

    this.chatMessages.set(key, message);
    this.onMessages(this.getChatMessages());
  }

  private upsertChatReceipt(receipt: RealtimeChatReceipt): void {
    const key = `${receipt.topic}:${receipt.from}:${receipt.what}`;
    const current = this.chatReceipts.get(key);

    if (current && current.seq >= receipt.seq) {
      return;
    }

    this.chatReceipts.set(key, receipt);
    this.onReceipts(this.getChatReceipts());
  }

  private clearChatMessages(): void {
    this.historyLoadPromises.clear();
    this.exhaustedHistoryTopics.clear();
    if (this.chatMessages.size === 0) {
      return;
    }

    this.chatMessages.clear();
    this.onMessages([]);
  }

  private clearChatSubscriptions(): void {
    if (this.chatSubscriptions.size === 0) {
      return;
    }

    this.chatSubscriptions.clear();
    this.onSubscriptions([]);
  }

  private clearChatReceipts(): void {
    if (this.chatReceipts.size === 0) {
      return;
    }

    this.chatReceipts.clear();
    this.onReceipts([]);
  }

  private clearChatMetadata(): void {
    if (this.chatMetadata.size === 0) {
      return;
    }

    this.chatMetadata.clear();
    this.onMetadata([]);
  }

  private ensureActiveAttempt(
    attempt: number,
    socket?: WebSocket,
  ): void {
    if (attempt === this.connectionAttempt) {
      return;
    }

    if (
      socket &&
      socket.readyState !== WebSocket.CLOSED &&
      socket.readyState !== WebSocket.CLOSING
    ) {
      socket.close(1000, "connection_cancelled");
    }

    throw new CifraRealtimeError(
      "realtime_connection_cancelled",
    );
  }

  private setStatus(
    status: RealtimeStatus,
    error?: string,
  ): void {
    this.status = status;
    if (error) {
      this.lastError = error;
    } else if (status === "connected" || status === "disconnected") {
      this.lastError = undefined;
    }
    this.onStatus(status, error);
    this.emitDiagnostics();
  }

  private emitDiagnostics(): void {
    this.options.onDiagnostics?.(this.getDiagnostics());
  }
}

async function issueRealtimeTicketForConnection(
  params: RealtimeConnectParams,
): Promise<RealtimeTicketResponse> {
  if (!params.ticketProvider) {
    return issueRealtimeTicket(
      params.apiBaseUrl,
      params.accessToken,
    );
  }

  const payload = await params.ticketProvider();

  if (!isRealtimeTicketResponse(payload)) {
    throw new CifraRealtimeError(
      "realtime_ticket_response_invalid",
    );
  }

  validateTicketExpiry(payload);
  return payload;
}

export async function issueRealtimeTicket(
  apiBaseUrl: string,
  accessToken: string,
): Promise<RealtimeTicketResponse> {
  if (!accessToken.trim()) {
    throw new CifraRealtimeError("access_token_missing");
  }

  const baseUrl = apiBaseUrl.replace(/\/+$/, "");
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${baseUrl}/api/v1/realtime/tickets`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          channel: "tinode",
        }),
        redirect: "error",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new CifraRealtimeError(
        `realtime_ticket_http_${response.status}`,
      );
    }

    const payload: unknown = await response.json();

    if (!isRealtimeTicketResponse(payload)) {
      throw new CifraRealtimeError(
        "realtime_ticket_response_invalid",
      );
    }

    validateTicketExpiry(payload);

    return payload;
  } catch (error) {
    if (
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      throw new CifraRealtimeError(
        "realtime_ticket_request_timeout",
      );
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function isRealtimeTicketResponse(
  value: unknown,
): value is RealtimeTicketResponse {
  if (!isRecord(value) || !isRecord(value["endpoint"])) {
    return false;
  }

  const endpoint = value["endpoint"];

  return (
    typeof value["ticket"] === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(value["ticket"]) &&
    typeof value["expires_in"] === "number" &&
    value["expires_in"] >= 5 &&
    value["expires_in"] <= 120 &&
    typeof value["expires_at"] === "string" &&
    value["channel"] === "tinode" &&
    typeof endpoint["url"] === "string" &&
    endpoint["protocol"] === "tinode" &&
    endpoint["auth_scheme"] === "cifra" &&
    endpoint["ticket_transport"] === "login_secret" &&
    endpoint["ticket_encoding"] === "base64"
  );
}

function validateTicketExpiry(
  ticket: RealtimeTicketResponse,
): void {
  const expiresAt = Date.parse(ticket.expires_at);
  const now = Date.now();

  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    expiresAt >
      now + ticket.expires_in * 1_000 + 5_000
  ) {
    throw new CifraRealtimeError(
      "realtime_ticket_expiry_invalid",
    );
  }
}

export function resolveApiSecurityUrl(
  apiBaseUrl: string,
  pageOrigin: string,
): URL {
  const normalizedApiBase = apiBaseUrl.trim();
  const normalizedPageOrigin = pageOrigin.trim();

  if (normalizedApiBase) {
    return normalizedPageOrigin
      ? new URL(normalizedApiBase, normalizedPageOrigin)
      : new URL(normalizedApiBase);
  }
  if (normalizedPageOrigin) {
    return new URL(normalizedPageOrigin);
  }
  throw new TypeError(
    "same-origin API configuration requires page origin",
  );
}

export function validateEndpointSecurity(
  endpointValue: string,
  ticket: string,
  accessToken: string,
  apiBaseUrl: string,
  pageOrigin =
    typeof window === "undefined" ? "" : window.location.origin,
): void {
  let endpoint: URL;

  try {
    endpoint = new URL(endpointValue);
  } catch {
    throw new CifraRealtimeError(
      "realtime_endpoint_invalid",
    );
  }

  if (
    endpoint.protocol !== "ws:" &&
    endpoint.protocol !== "wss:"
  ) {
    throw new CifraRealtimeError(
      "realtime_endpoint_protocol_invalid",
    );
  }

  let apiUrl: URL;

  try {
    apiUrl = resolveApiSecurityUrl(apiBaseUrl, pageOrigin);
  } catch {
    throw new CifraRealtimeError(
      "realtime_api_base_invalid",
    );
  }

  if (
    apiUrl.protocol === "https:" &&
    endpoint.protocol !== "wss:"
  ) {
    throw new CifraRealtimeError(
      "realtime_endpoint_tls_required",
    );
  }

  if (
    endpoint.href.includes(ticket) ||
    endpoint.href.includes(accessToken)
  ) {
    throw new CifraRealtimeError(
      "secret_exposed_in_websocket_url",
    );
  }

  if (
    /(?:^|\.)amvera-[a-z0-9-]*-run-[a-z0-9-]*(?:\.|$)/i.test(
      endpoint.hostname,
    )
  ) {
    throw new CifraRealtimeError(
      "internal_realtime_endpoint_exposed",
    );
  }
}

function waitForSocketOpen(
  socket: WebSocket,
): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new CifraRealtimeError(
          "websocket_open_timeout",
        ),
      );
    }, REQUEST_TIMEOUT_MS);

    const onOpen = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(
        new CifraRealtimeError(
          "websocket_open_failed",
        ),
      );
    };

    const onClose = () => {
      cleanup();
      reject(
        new CifraRealtimeError(
          "websocket_closed_before_open",
        ),
      );
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };

    socket.addEventListener("open", onOpen);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

function waitForControl(
  socket: WebSocket,
  expectedId: string,
): Promise<TinodeControl> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new CifraRealtimeError(
          "tinode_control_timeout",
        ),
      );
    }, REQUEST_TIMEOUT_MS);

    const onMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") {
        return;
      }

      const control = parseTinodeControl(event.data);

      if (!control || control.id !== expectedId) {
        return;
      }

      cleanup();
      resolve(control);
    };

    const onError = () => {
      cleanup();
      reject(
        new CifraRealtimeError(
          "websocket_failed",
        ),
      );
    };

    const onClose = () => {
      cleanup();
      reject(
        new CifraRealtimeError(
          "websocket_closed_before_control",
        ),
      );
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };

    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

function waitForHistoryPage(
  socket: WebSocket,
  expectedId: string,
  expectedTopic: string,
  before: number,
): Promise<{
  control: TinodeControl;
  messages: RealtimeChatMessage[];
}> {
  return new Promise((resolve, reject) => {
    const messages = new Map<number, RealtimeChatMessage>();
    const timer = setTimeout(() => {
      cleanup();
      reject(new CifraRealtimeError("tinode_history_page_timeout"));
    }, REQUEST_TIMEOUT_MS);

    const onMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      const message = parseTinodeChatMessage(event.data);
      if (
        message &&
        message.topic === expectedTopic &&
        message.seq < before
      ) {
        messages.set(message.seq, message);
        return;
      }

      const control = parseTinodeControl(event.data);
      if (!control || control.id !== expectedId) return;
      cleanup();
      resolve({
        control,
        messages: Array.from(messages.values()).sort(
          (left, right) => left.seq - right.seq,
        ),
      });
    };

    const onError = () => {
      cleanup();
      reject(new CifraRealtimeError("websocket_failed"));
    };
    const onClose = () => {
      cleanup();
      reject(
        new CifraRealtimeError("websocket_closed_before_history_page"),
      );
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };

    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

function waitForDirectoryResults(
  socket: WebSocket,
  expectedId: string,
): Promise<TinodeDirectoryResults> {
  return new Promise((resolve, reject) => {
    let results: TinodeDirectoryResults | null = null;
    let controlAccepted = false;
    let emptyResultsTimer: ReturnType<typeof setTimeout> | null = null;
    const timeoutTimer = setTimeout(() => {
      cleanup();
      reject(new CifraRealtimeError("tinode_directory_timeout"));
    }, REQUEST_TIMEOUT_MS);

    const finish = (value: TinodeDirectoryResults) => {
      cleanup();
      resolve(value);
    };

    const onMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;

      const batch = parseTinodeDirectoryResults(event.data);
      if (
        batch &&
        (!batch.requestId || batch.requestId === expectedId)
      ) {
        results = batch;
        if (controlAccepted) finish(batch);
        return;
      }

      const control = parseTinodeControl(event.data);
      if (!control || control.id !== expectedId) return;
      if (control.code < 200 || control.code >= 300) {
        cleanup();
        reject(new CifraRealtimeError("tinode_directory_search_rejected"));
        return;
      }

      controlAccepted = true;
      if (results) {
        finish(results);
        return;
      }

      emptyResultsTimer = setTimeout(
        () => finish({ requestId: expectedId, userIds: [] }),
        50,
      );
    };

    const onError = () => {
      cleanup();
      reject(new CifraRealtimeError("websocket_failed"));
    };

    const onClose = () => {
      cleanup();
      reject(new CifraRealtimeError("websocket_closed_before_directory"));
    };

    const cleanup = () => {
      clearTimeout(timeoutTimer);
      if (emptyResultsTimer) clearTimeout(emptyResultsTimer);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      socket.removeEventListener("close", onClose);
    };

    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.addEventListener("close", onClose);
  });
}

export function parseTinodeChatReceipt(
  raw: string,
): RealtimeChatReceipt | null {
  try {
    const parsed: unknown = JSON.parse(raw);

    if (!isRecord(parsed)) {
      return null;
    }

    if (isRecord(parsed["info"])) {
      const info = parsed["info"];
      const topic = info["topic"];
      const from = info["from"];
      const what = info["what"];
      const seq = parsePositiveInteger(info["seq"]);

      if (
        typeof topic === "string" &&
        isChatTopicName(topic) &&
        typeof from === "string" &&
        isUserTopicName(from) &&
        (what === "recv" || what === "read") &&
        seq !== null
      ) {
        return {
          topic,
          from,
          what,
          seq,
        };
      }
    }

    if (isRecord(parsed["pres"])) {
      const pres = parsed["pres"];
      const source = pres["src"];
      const topic = pres["topic"];
      const actor = pres["act"];
      const what = pres["what"];
      const seq = parsePositiveInteger(pres["seq"]);
      const receiptTopic =
        typeof source === "string" && isChatTopicName(source)
          ? source
          : typeof topic === "string" && isChatTopicName(topic)
            ? topic
            : null;

      if (
        receiptTopic &&
        typeof actor === "string" &&
        isUserTopicName(actor) &&
        (what === "recv" || what === "read") &&
        seq !== null
      ) {
        return {
          topic: receiptTopic,
          from: actor,
          what,
          seq,
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function parseTinodeChatMessage(
  raw: string,
): RealtimeChatMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);

    if (!isRecord(parsed) || !isRecord(parsed["data"])) {
      return null;
    }

    const data = parsed["data"];
    const topic = data["topic"];
    const seq = parsePositiveInteger(data["seq"]);
    const timestamp = parseIsoDate(data["ts"]);
    const from = data["from"];

    if (
      typeof topic !== "string" ||
      !isChatTopicName(topic) ||
      seq === null ||
      !timestamp ||
      !Object.prototype.hasOwnProperty.call(data, "content") ||
      (from !== undefined &&
        (typeof from !== "string" || !isUserTopicName(from)))
    ) {
      return null;
    }

    return {
      topic,
      seq,
      timestamp,
      ...(typeof from === "string" ? { from } : {}),
      ...(isRecord(data["head"]) ? { head: data["head"] } : {}),
      content: data["content"],
    };
  } catch {
    return null;
  }
}

export function parseTinodeChatMetadata(
  raw: string,
): RealtimeChatMetadata | null {
  try {
    const parsed: unknown = JSON.parse(raw);

    if (!isRecord(parsed) || !isRecord(parsed["meta"])) {
      return null;
    }

    const meta = parsed["meta"];
    const topic = meta["topic"];

    if (typeof topic !== "string" || !isChatTopicName(topic)) {
      return null;
    }

    const desc = isRecord(meta["desc"]) ? meta["desc"] : undefined;
    const rawSubscriptions = Array.isArray(meta["sub"])
      ? meta["sub"]
      : undefined;
    const publicValue = desc && isRecord(desc["public"])
      ? desc["public"]
      : undefined;
    const privateValue = desc && isRecord(desc["private"])
      ? desc["private"]
      : undefined;
    const participants = rawSubscriptions
      ? rawSubscriptions
          .map(parseTinodeChatParticipant)
          .filter(
            (participant): participant is RealtimeChatParticipant =>
              participant !== null,
          )
      : undefined;

    const kind = getRealtimeChatKind(topic);
    const directParticipants =
      kind === "direct"
        ? [
            {
              ...(participants?.find(
                (participant) => participant.userId === topic,
              ) ?? { userId: topic }),
              ...(publicValue ? { public: publicValue } : {}),
            } satisfies RealtimeChatParticipant,
            ...(participants?.filter(
              (participant) => participant.userId !== topic,
            ) ?? []),
          ]
        : participants;

    if (!desc && !rawSubscriptions) {
      return null;
    }

    return {
      topic,
      kind,
      ...(publicValue ? { public: publicValue } : {}),
      ...(privateValue ? { private: privateValue } : {}),
      ...(directParticipants ? { participants: directParticipants } : {}),
    };
  } catch {
    return null;
  }
}

export function parseTinodeDirectoryResults(
  raw: string,
): TinodeDirectoryResults | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed["meta"])) return null;

    const meta = parsed["meta"];
    if (meta["topic"] !== "fnd" || !Array.isArray(meta["sub"])) {
      return null;
    }

    const userIds = Array.from(
      new Set(
        meta["sub"].flatMap((entry) => {
          if (!isRecord(entry)) return [];
          const candidate =
            typeof entry["user"] === "string"
              ? entry["user"]
              : typeof entry["topic"] === "string"
                ? entry["topic"]
                : "";
          return isUserTopicName(candidate) ? [candidate] : [];
        }),
      ),
    );

    return {
      ...(typeof meta["id"] === "string"
        ? { requestId: meta["id"] }
        : {}),
      userIds,
    };
  } catch {
    return null;
  }
}

function parseTinodeChatParticipant(
  value: unknown,
): RealtimeChatParticipant | null {
  if (
    !isRecord(value) ||
    typeof value["user"] !== "string" ||
    !isUserTopicName(value["user"])
  ) {
    return null;
  }

  const access = parseTinodeAccess(value["acs"]);

  return {
    userId: value["user"],
    ...(typeof value["online"] === "boolean"
      ? { online: value["online"] }
      : {}),
    ...(access ? { access } : {}),
    ...(isRecord(value["public"]) ? { public: value["public"] } : {}),
    ...(isRecord(value["private"]) ? { private: value["private"] } : {}),
  };
}


function mergeTinodeChatParticipants(
  current: readonly RealtimeChatParticipant[] | undefined,
  incoming: readonly RealtimeChatParticipant[],
): readonly RealtimeChatParticipant[] {
  if (incoming.length === 0 || !current?.length) {
    return incoming;
  }

  const merged = new Map(
    current.map((participant) => [participant.userId, participant]),
  );

  for (const participant of incoming) {
    const previous = merged.get(participant.userId);
    merged.set(participant.userId, {
      userId: participant.userId,
      ...(participant.online !== undefined
        ? { online: participant.online }
        : previous?.online !== undefined
          ? { online: previous.online }
          : {}),
      ...(participant.access
        ? { access: participant.access }
        : previous?.access
          ? { access: previous.access }
          : {}),
      ...(participant.public
        ? { public: participant.public }
        : previous?.public
          ? { public: previous.public }
          : {}),
      ...(participant.private
        ? { private: participant.private }
        : previous?.private
          ? { private: previous.private }
          : {}),
    });
  }

  return Array.from(merged.values());
}

function getRealtimeChatKind(topic: string): RealtimeChatKind {
  return topic.startsWith("chn")
    ? "channel"
    : topic.startsWith("grp")
      ? "group"
      : "direct";
}

export function parseTinodeChatSubscriptions(
  raw: string,
): readonly RealtimeChatSubscription[] | null {
  return parseTinodeSubscriptionBatch(raw)?.subscriptions ?? null;
}

function parseTinodeSubscriptionBatch(
  raw: string,
): TinodeSubscriptionBatch | null {
  try {
    const parsed: unknown = JSON.parse(raw);

    if (
      !isRecord(parsed) ||
      !isRecord(parsed["meta"])
    ) {
      return null;
    }

    const meta = parsed["meta"];

    if (
      typeof meta["topic"] !== "string" ||
      !Array.isArray(meta["sub"])
    ) {
      return null;
    }

    const subscriptions = meta["sub"]
      .map(parseTinodeChatSubscription)
      .filter(
        (subscription): subscription is RealtimeChatSubscription =>
          subscription !== null,
      );

    return {
      topic: meta["topic"],
      ...(typeof meta["id"] === "string"
        ? { requestId: meta["id"] }
        : {}),
      subscriptions,
    };
  } catch {
    return null;
  }
}

function parseTinodeChatSubscription(
  value: unknown,
): RealtimeChatSubscription | null {
  if (
    !isRecord(value) ||
    typeof value["topic"] !== "string" ||
    !isChatTopicName(value["topic"])
  ) {
    return null;
  }

  const access = parseTinodeAccess(value["acs"]);
  const updatedAt = parseIsoDate(value["updated"]);
  const touchedAt = parseIsoDate(value["touched"]);
  const seq = parseNonNegativeInteger(value["seq"]);
  const read = parseNonNegativeInteger(value["read"]);
  const recv = parseNonNegativeInteger(value["recv"]);

  return {
    topic: value["topic"],
    ...(updatedAt ? { updatedAt } : {}),
    ...(touchedAt ? { touchedAt } : {}),
    ...(seq !== null ? { seq } : {}),
    ...(read !== null ? { read } : {}),
    ...(recv !== null ? { recv } : {}),
    ...(typeof value["online"] === "boolean"
      ? { online: value["online"] }
      : {}),
    ...(access ? { access } : {}),
    ...(isRecord(value["public"])
      ? { public: value["public"] }
      : {}),
    ...(isRecord(value["private"])
      ? { private: value["private"] }
      : {}),
  };
}

function parseTinodeAccess(
  value: unknown,
): RealtimeChatSubscription["access"] | null {
  if (!isRecord(value)) {
    return null;
  }

  const want =
    typeof value["want"] === "string"
      ? value["want"]
      : undefined;
  const given =
    typeof value["given"] === "string"
      ? value["given"]
      : undefined;
  const mode =
    typeof value["mode"] === "string"
      ? value["mode"]
      : undefined;

  if (!want && !given && !mode) {
    return null;
  }

  return {
    ...(want ? { want } : {}),
    ...(given ? { given } : {}),
    ...(mode ? { mode } : {}),
  };
}

function parseIsoDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return Number.isFinite(Date.parse(value)) ? value : null;
}

function parseNonNegativeInteger(
  value: unknown,
): number | null {
  return Number.isInteger(value) && Number(value) >= 0
    ? Number(value)
    : null;
}

function parsePositiveInteger(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0
    ? Number(value)
    : null;
}

export function getRealtimeReconnectDelay(
  attempt: number,
  baseDelayMs = 1_000,
  maxDelayMs = 30_000,
): number {
  const safeAttempt = Number.isInteger(attempt)
    ? Math.max(0, Number(attempt))
    : 0;
  const safeBase = Number.isFinite(baseDelayMs)
    ? Math.max(0, Number(baseDelayMs))
    : 1_000;
  const safeMax = Number.isFinite(maxDelayMs)
    ? Math.max(safeBase, Number(maxDelayMs))
    : 30_000;

  return Math.min(safeMax, safeBase * 2 ** safeAttempt);
}

export function buildTinodeHistoryQuery(
  topic: string,
  historyLimit: number,
  messages: readonly RealtimeChatMessage[],
  serverSeq?: number,
): { readonly since?: number; readonly limit: number } {
  const normalizedLimit = normalizeHistoryLimit(historyLimit);
  const latestLocalSeq = messages.reduce(
    (latest, message) =>
      message.topic === topic &&
      Number.isInteger(message.seq) &&
      message.seq > latest
        ? message.seq
        : latest,
    0,
  );

  if (latestLocalSeq === 0) {
    return { limit: normalizedLimit };
  }

  const normalizedServerSeq = parseNonNegativeInteger(serverSeq) ?? 0;
  const missingCount = Math.max(0, normalizedServerSeq - latestLocalSeq);

  return {
    since: latestLocalSeq + 1,
    limit: Math.min(100, Math.max(normalizedLimit, missingCount)),
  };
}

export function buildTinodeOlderHistoryQuery(
  topic: string,
  historyLimit: number,
  messages: readonly RealtimeChatMessage[],
  serverSeq?: number,
): { readonly before: number; readonly limit: number } | null {
  if (!isChatTopicName(topic)) {
    throw new CifraRealtimeError("tinode_chat_topic_invalid");
  }
  const limit = normalizeHistoryLimit(historyLimit);
  const oldestLocalSeq = getOldestTopicSeq(messages, topic);
  const normalizedServerSeq = parseNonNegativeInteger(serverSeq) ?? 0;
  const before = oldestLocalSeq ?? (normalizedServerSeq > 0
    ? normalizedServerSeq + 1
    : null);
  if (before === null || before <= 1) return null;
  return { before, limit };
}

function getOldestTopicSeq(
  messages: readonly RealtimeChatMessage[],
  topic: string,
): number | null {
  let oldest: number | null = null;
  for (const message of messages) {
    if (message.topic !== topic || !Number.isInteger(message.seq)) continue;
    if (oldest === null || message.seq < oldest) oldest = message.seq;
  }
  return oldest;
}

function normalizeHistoryLimit(value: number | undefined): number {
  if (!Number.isInteger(value)) {
    return 20;
  }

  return Math.min(100, Math.max(1, Number(value)));
}

function isUserTopicName(value: string): boolean {
  return /^usr[A-Za-z0-9_-]{8,125}$/.test(value);
}

function isChatTopicName(value: string): boolean {
  return /^(?:usr|grp|chn)[A-Za-z0-9_-]{8,125}$/.test(value);
}

function parseTinodeControl(
  raw: string,
): TinodeControl | null {
  try {
    const parsed: unknown = JSON.parse(raw);

    if (
      !isRecord(parsed) ||
      !isRecord(parsed["ctrl"])
    ) {
      return null;
    }

    const ctrl = parsed["ctrl"];

    if (typeof ctrl["code"] !== "number") {
      return null;
    }

    const timestamp = parseIsoDate(ctrl["ts"]);

    return {
      ...(typeof ctrl["id"] === "string"
        ? { id: ctrl["id"] }
        : {}),
      ...(typeof ctrl["topic"] === "string"
        ? { topic: ctrl["topic"] }
        : {}),
      code: ctrl["code"],
      ...(typeof ctrl["text"] === "string"
        ? { text: ctrl["text"] }
        : {}),
      ...(timestamp ? { timestamp } : {}),
      ...(isRecord(ctrl["params"])
        ? { params: ctrl["params"] }
        : {}),
    };
  } catch {
    return null;
  }
}

function createPacketId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}
