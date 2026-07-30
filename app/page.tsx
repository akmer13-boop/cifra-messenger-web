"use client";

import {
  Archive,
  ArchiveRestore,
  AtSign,
  BatteryFull,
  Bell,
  BellOff,
  Camera,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  FileText,
  Forward,
  Image as ImageIcon,
  LockKeyhole,
  LogIn,
  LogOut,
  Mail,
  MessageCircle,
  Mic,
  MicOff,
  MoreHorizontal,
  Pause,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Pin,
  Play,
  Plus,
  Reply,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Signal,
  Smile,
  SquarePen,
  Trash2,
  UserRound,
  UserRoundCog,
  UsersRound,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  Wifi,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  hydrateChatsWithMessages,
  sortChatsByActivity,
  withLatestDeliveryStatus,
  withLatestMessage,
} from "./chat-list-policy.mjs";
import {
  canAuditChats,
  canManageUsers,
  primaryRole,
  roleDisplayName,
  roleShortName,
  wireRole,
} from "./auth-policy.mjs";
import {
  CifraApiClient,
  CifraApiError,
  loadRuntimeConfig,
  type AuthSession,
  type BackendUser,
  type CorporateRole,
  type LoginOutcome,
  type RuntimeMode,
  type UserRole,
} from "./cifra-api";

import {
  CifraRealtimeClient,
  CifraRealtimeError,
  type RealtimeChatMessage,
  type RealtimeChatReceipt,
  type RealtimeChatSubscription,
  type RealtimeStatus,
} from "./cifra-realtime";

import {
  clampSwipeOffset,
  getSwipeActionState,
  snapSwipeOffset,
} from "./swipe-policy.mjs";

type Tab = "chats" | "teams" | "calls" | "profile";
type Filter = string;
type Theme = "navy" | "black" | "sage" | "gray" | "sunset";
type RealtimeChatObserverStatus =
  | "idle"
  | "subscribing"
  | "subscribed"
  | "error";
type RealtimePublishStatus =
  | "idle"
  | "publishing"
  | "published"
  | "error";
type ChatPanel =
  | "attachments"
  | "emoji"
  | "profile"
  | "participants"
  | "settings"
  | "pinned"
  | "media"
  | "search"
  | null;
type ActiveChatPanel = Exclude<ChatPanel, null>;
type EmojiCategory = "Недавние" | "Люди" | "Работа" | "Символы";
type MediaCategory = "Фото и видео" | "Файлы";
type ProfilePanel = "notifications" | "storage" | "theme" | null;
type NotificationMode = "on" | "off" | "hour";
type MessageDeliveryStatus = "sent" | "delivered" | "read";
type IncomingMessageDetail = {
  chatId: string;
  id?: number;
  text?: string;
  voice?: string;
  author?: string;
  time?: string;
  replyToId?: number;
  forwardedFrom?: string;
};
type IncomingCallDetail = {
  participantIds: string[];
  missed?: boolean;
};
type SendMessageOptions = {
  replyToId?: number;
  forwardedFrom?: string;
  voice?: string;
};

type Chat = {
  id: string;
  title: string;
  subtitle: string;
  time: string;
  unread: number;
  avatar: string;
  gradient: string;
  kind: "work" | "personal" | "group";
  lastActivityOrder: number;
  lastMessageId?: number;
  lastMessageSide?: "in" | "out";
  lastDeliveryStatus?: MessageDeliveryStatus;
  online?: boolean;
  pinned?: boolean;
  muted?: boolean;
  archived?: boolean;
  deleted?: boolean;
  memberIds?: string[];
};

type Message = {
  id: number;
  side: "in" | "out";
  text?: string;
  time: string;
  voice?: string;
  author?: string;
  deliveryStatus?: MessageDeliveryStatus;
  replyToId?: number;
  forwardedFrom?: string;
  pinned?: boolean;
  pinnedAt?: number;
};

type CallRecord = {
  participantIds: string[];
  name: string;
  detail: string;
  type: "in" | "out" | "missed";
  avatar: string;
  gradient: string;
};

type MessengerUser = {
  id: string;
  backendId?: string;
  backendVersion?: number;
  backendRoles?: CorporateRole[];
  name: string;
  email: string;
  username: string;
  phone: string;
  avatar: string;
  avatarUrl?: string;
  gradient: string;
  role: UserRole;
  online: boolean;
  position: string;
};

type ConversationMediaItem = {
  label: string;
  type: "image" | "video";
  tone: string;
  duration?: string;
};

type PreviewContent = {
  title: string;
  subtitle: string;
  kind: "image" | "video" | "file";
  tone?: string;
};

const defaultFilters = [
  "Все",
  "Рабочие",
  "Личные",
  "Группы",
  "Непрочитанные",
] as const;

const themeOptions: {
  id: Theme;
  title: string;
  description: string;
  symbol: string;
}[] = [
  {
    id: "navy",
    title: "Темно-синяя",
    description: "Основная тема",
    symbol: "🌌",
  },
  {
    id: "black",
    title: "Чёрная",
    description: "Максимальный контраст",
    symbol: "●",
  },
  {
    id: "sage",
    title: "Шалфейная",
    description: "Мягкий цвет · #99CC99",
    symbol: "●",
  },
  {
    id: "gray",
    title: "Серая",
    description: "Нейтральный цвет · #999999",
    symbol: "●",
  },
  {
    id: "sunset",
    title: "Закат CIFRA",
    description: "Солнечный градиент",
    symbol: "✦",
  },
];

const initialChatSeeds: Chat[] = [
  {
    id: "product",
    title: "Команда продукта",
    subtitle: "Марк: Макеты готовы к просмотру",
    time: "15:42",
    unread: 4,
    lastActivityOrder: 9,
    avatar: "CF",
    gradient: "linear-gradient(145deg, #102c52, #255d96)",
    kind: "group",
    pinned: true,
    memberIds: ["anna", "ilya", "natalia"],
  },
  {
    id: "anna",
    title: "Анна Смирнова",
    subtitle: "Договорились, отправлю сегодня",
    time: "14:18",
    unread: 2,
    lastActivityOrder: 8,
    avatar: "АС",
    gradient: "linear-gradient(145deg, #6366f1, #a78bfa)",
    kind: "work",
    online: true,
  },
  {
    id: "ilya",
    title: "Илья Орлов",
    subtitle: "🎙 Голосовое сообщение",
    time: "13:54",
    unread: 0,
    lastActivityOrder: 7,
    avatar: "ИО",
    gradient: "linear-gradient(145deg, #0ea5e9, #67e8f9)",
    kind: "work",
  },
  {
    id: "design",
    title: "Дизайн · CIFRA",
    subtitle: "Наталья: Обновила компоненты",
    time: "12:06",
    unread: 7,
    lastActivityOrder: 6,
    avatar: "UI",
    gradient: "linear-gradient(145deg, #e879f9, #fb7185)",
    kind: "group",
    muted: true,
    memberIds: ["anna", "natalia", "maria"],
  },
  {
    id: "maria",
    title: "Мария",
    subtitle: "Фотография",
    time: "Вчера",
    unread: 0,
    lastActivityOrder: 5,
    avatar: "М",
    gradient: "linear-gradient(145deg, #f59e0b, #fb7185)",
    kind: "personal",
  },
  {
    id: "hr",
    title: "HR · Объявления",
    subtitle: "Новый график на август",
    time: "Вс",
    unread: 0,
    lastActivityOrder: 4,
    avatar: "HR",
    gradient: "linear-gradient(145deg, #164e75, #2563eb)",
    kind: "group",
    pinned: true,
    memberIds: ["olga", "ekaterina", "elena"],
  },
  {
    id: "alexey",
    title: "Алексей Романов",
    subtitle: "Вернусь с ответом после встречи",
    time: "Пт",
    unread: 0,
    lastActivityOrder: 3,
    avatar: "АР",
    gradient: "linear-gradient(145deg, #1d4ed8, #60a5fa)",
    kind: "work",
    archived: true,
    muted: true,
  },
  {
    id: "ekaterina",
    title: "Екатерина Белова",
    subtitle: "Отправила итоговый документ",
    time: "Чт",
    unread: 0,
    lastActivityOrder: 2,
    avatar: "ЕБ",
    gradient: "linear-gradient(145deg, #7c3aed, #c084fc)",
    kind: "work",
    archived: true,
    muted: true,
  },
  {
    id: "dmitry",
    title: "Дмитрий Соколов",
    subtitle: "Спасибо, всё получил",
    time: "Ср",
    unread: 0,
    lastActivityOrder: 1,
    avatar: "ДС",
    gradient: "linear-gradient(145deg, #075985, #38bdf8)",
    kind: "work",
    archived: true,
    muted: true,
  },
];

const initialMessages: Message[] = [
  {
    id: 1,
    side: "in",
    author: "Марк",
    text: "Коллеги, собрал новую структуру мобильного приложения.",
    time: "15:31",
  },
  {
    id: 2,
    side: "in",
    author: "Марк",
    text: "Посмотрите главный экран и переписку. Нужно понять, достаточно ли привычна логика.",
    time: "15:32",
    pinned: true,
    pinnedAt: 2,
  },
  {
    id: 3,
    side: "out",
    text: "Да, структура понятная. По ощущениям близко к Telegram, но визуально уже CIFRA.",
    time: "15:37",
    deliveryStatus: "read",
  },
  {
    id: 4,
    side: "in",
    author: "Анна",
    voice: "0:18",
    time: "15:40",
  },
  {
    id: 5,
    side: "in",
    author: "Марк",
    text: "Макеты готовы к просмотру",
    time: "15:42",
    pinned: true,
    pinnedAt: 5,
  },
];

const initialMessagesByChat: Record<string, Message[]> = {
  product: initialMessages,
  anna: [
    {
      id: 101,
      side: "in",
      author: "Анна",
      text: "Договорились, отправлю сегодня.",
      time: "14:16",
    },
    {
      id: 102,
      side: "out",
      text: "Хорошо, жду файл.",
      time: "14:18",
      deliveryStatus: "read",
    },
  ],
  ilya: [
    {
      id: 201,
      side: "in",
      author: "Илья",
      voice: "0:12",
      time: "13:54",
    },
  ],
  design: [
    {
      id: 301,
      side: "in",
      author: "Наталья",
      text: "Обновила компоненты и состояния кнопок.",
      time: "12:06",
    },
  ],
  maria: [
    {
      id: 401,
      side: "in",
      author: "Мария",
      text: "Отправила фотографию.",
      time: "Вчера",
    },
  ],
  hr: [
    {
      id: 501,
      side: "in",
      author: "Ольга",
      text: "Новый график на август опубликован.",
      time: "Вс",
    },
  ],
  alexey: [
    {
      id: 601,
      side: "in",
      author: "Алексей",
      text: "Вернусь с ответом после встречи.",
      time: "Пт",
    },
  ],
  ekaterina: [
    {
      id: 701,
      side: "in",
      author: "Екатерина",
      text: "Отправила итоговый документ.",
      time: "Чт",
    },
  ],
  dmitry: [
    {
      id: 801,
      side: "in",
      author: "Дмитрий",
      text: "Спасибо, всё получил.",
      time: "Ср",
    },
  ],
};

const initialChats: Chat[] = hydrateChatsWithMessages(
  initialChatSeeds,
  initialMessagesByChat,
);

const initialUsers: MessengerUser[] = [
  {
    id: "self",
    name: "Cifra Razrabotka",
    email: "cifra@company.ru",
    username: "cifra",
    phone: "+7 900 123-45-67",
    avatar: "КР",
    gradient: "linear-gradient(145deg, #102c52, #2d659d)",
    role: "admin",
    online: true,
    position: "Администратор",
  },
  {
    id: "anna",
    name: "Анна Смирнова",
    email: "anna@company.ru",
    username: "anna.s",
    phone: "+7 901 105-24-18",
    avatar: "АС",
    gradient: "linear-gradient(145deg, #6366f1, #a78bfa)",
    role: "employee",
    online: true,
    position: "Дизайн продукта",
  },
  {
    id: "ilya",
    name: "Илья Орлов",
    email: "ilya@company.ru",
    username: "ilya.o",
    phone: "+7 901 312-67-09",
    avatar: "ИО",
    gradient: "linear-gradient(145deg, #0e7490, #38bdf8)",
    role: "employee",
    online: false,
    position: "iOS-разработка",
  },
  {
    id: "maria",
    name: "Мария Волкова",
    email: "maria@company.ru",
    username: "maria.v",
    phone: "+7 901 733-11-08",
    avatar: "МВ",
    gradient: "linear-gradient(145deg, #f59e0b, #fb7185)",
    role: "employee",
    online: false,
    position: "Коммуникации",
  },
  {
    id: "natalia",
    name: "Наталья Морозова",
    email: "natalia@company.ru",
    username: "natalia.m",
    phone: "+7 901 891-43-20",
    avatar: "НМ",
    gradient: "linear-gradient(145deg, #b453c6, #f472b6)",
    role: "employee",
    online: true,
    position: "UI/UX-дизайн",
  },
  {
    id: "alexey",
    name: "Алексей Романов",
    email: "alexey@company.ru",
    username: "alexey.r",
    phone: "+7 901 224-16-40",
    avatar: "АР",
    gradient: "linear-gradient(145deg, #1d4ed8, #60a5fa)",
    role: "employee",
    online: true,
    position: "Руководитель продукта",
  },
  {
    id: "ekaterina",
    name: "Екатерина Белова",
    email: "ekaterina@company.ru",
    username: "ekaterina.b",
    phone: "+7 901 477-25-13",
    avatar: "ЕБ",
    gradient: "linear-gradient(145deg, #7c3aed, #c084fc)",
    role: "employee",
    online: false,
    position: "Бизнес-аналитик",
  },
  {
    id: "dmitry",
    name: "Дмитрий Соколов",
    email: "dmitry@company.ru",
    username: "dmitry.s",
    phone: "+7 901 628-40-51",
    avatar: "ДС",
    gradient: "linear-gradient(145deg, #075985, #38bdf8)",
    role: "employee",
    online: true,
    position: "Backend-разработка",
  },
  {
    id: "olga",
    name: "Ольга Кузнецова",
    email: "olga@company.ru",
    username: "olga.k",
    phone: "+7 901 774-08-62",
    avatar: "ОК",
    gradient: "linear-gradient(145deg, #be123c, #fb7185)",
    role: "employee",
    online: false,
    position: "HR-партнёр",
  },
  {
    id: "sergey",
    name: "Сергей Павлов",
    email: "sergey@company.ru",
    username: "sergey.p",
    phone: "+7 901 319-82-07",
    avatar: "СП",
    gradient: "linear-gradient(145deg, #0369a1, #38bdf8)",
    role: "employee",
    online: true,
    position: "Android-разработка",
  },
  {
    id: "victoria",
    name: "Виктория Лебедева",
    email: "victoria@company.ru",
    username: "victoria.l",
    phone: "+7 901 902-53-41",
    avatar: "ВЛ",
    gradient: "linear-gradient(145deg, #a21caf, #e879f9)",
    role: "employee",
    online: false,
    position: "Контент-менеджер",
  },
  {
    id: "artem",
    name: "Артём Новиков",
    email: "artem@company.ru",
    username: "artem.n",
    phone: "+7 901 448-70-35",
    avatar: "АН",
    gradient: "linear-gradient(145deg, #b45309, #fbbf24)",
    role: "employee",
    online: true,
    position: "QA-инженер",
  },
  {
    id: "ksenia",
    name: "Ксения Фёдорова",
    email: "ksenia@company.ru",
    username: "ksenia.f",
    phone: "+7 901 553-98-24",
    avatar: "КФ",
    gradient: "linear-gradient(145deg, #4338ca, #818cf8)",
    role: "employee",
    online: false,
    position: "Project-менеджер",
  },
  {
    id: "pavel",
    name: "Павел Крылов",
    email: "pavel@company.ru",
    username: "pavel.k",
    phone: "+7 901 681-29-46",
    avatar: "ПК",
    gradient: "linear-gradient(145deg, #1e40af, #60a5fa)",
    role: "employee",
    online: true,
    position: "DevOps-инженер",
  },
  {
    id: "elena",
    name: "Елена Соколова",
    email: "elena@company.ru",
    username: "elena.s",
    phone: "+7 901 836-17-59",
    avatar: "ЕС",
    gradient: "linear-gradient(145deg, #9f1239, #f472b6)",
    role: "employee",
    online: false,
    position: "Юрист",
  },
];

function backendUserToMessenger(
  user: BackendUser,
  currentUserId: string,
): MessengerUser {
  const name = `${user.first_name} ${user.last_name}`.trim();
  const avatar = [user.first_name, user.last_name]
    .map((part) => part.trim().charAt(0).toLocaleUpperCase("ru"))
    .join("")
    .slice(0, 2);
  const colorIndex = Array.from(user.id).reduce(
    (sum, character) => sum + character.charCodeAt(0),
    0,
  ) % 5;
  const gradients = [
    "linear-gradient(145deg, #102c52, #2d659d)",
    "linear-gradient(145deg, #6366f1, #a78bfa)",
    "linear-gradient(145deg, #0e7490, #38bdf8)",
    "linear-gradient(145deg, #b453c6, #f472b6)",
    "linear-gradient(145deg, #b45309, #fbbf24)",
  ];
  return {
    id: user.id === currentUserId ? "self" : user.id,
    backendId: user.id,
    backendVersion: user.version,
    backendRoles: user.roles,
    name,
    email: user.email ?? "",
    username: user.login,
    phone: user.phone ?? "",
    avatar: avatar || "CF",
    gradient: gradients[colorIndex] ?? gradients[0],
    role: primaryRole(user.roles) as UserRole,
    online: user.status === "active",
    position:
      user.job_title ??
      user.department ??
      roleDisplayName(primaryRole(user.roles)),
  };
}

function corporateRolesFor(role: UserRole): CorporateRole[] {
  return role === "employee"
    ? ["employee"]
    : ["employee", wireRole(role) as CorporateRole];
}

const initialCallHistory: CallRecord[] = [
  {
    participantIds: ["anna"],
    name: "Анна Смирнова",
    detail: "Сегодня, 14:02 · 4 мин",
    type: "out",
    avatar: "АС",
    gradient: "linear-gradient(145deg, #6366f1, #a78bfa)",
  },
  {
    participantIds: ["anna", "ilya", "natalia"],
    name: "Команда продукта",
    detail: "Сегодня, 11:30 · 28 мин",
    type: "in",
    avatar: "CF",
    gradient: "linear-gradient(145deg, #102c52, #255d96)",
  },
  {
    participantIds: ["ilya"],
    name: "Илья Орлов",
    detail: "Вчера, 18:46",
    type: "missed",
    avatar: "ИО",
    gradient: "linear-gradient(145deg, #0ea5e9, #67e8f9)",
  },
  {
    participantIds: ["maria"],
    name: "Мария",
    detail: "Вчера, 16:10 · 12 мин",
    type: "out",
    avatar: "М",
    gradient: "linear-gradient(145deg, #f59e0b, #fb7185)",
  },
];

const emojiCategories: EmojiCategory[] = [
  "Недавние",
  "Люди",
  "Работа",
  "Символы",
];
const mediaCategories: MediaCategory[] = ["Фото и видео", "Файлы"];

const conversationMediaItems: readonly ConversationMediaItem[] = [
  { label: "Макет", type: "image", tone: "ocean" },
  { label: "Экран", type: "image", tone: "violet" },
  { label: "Демо", type: "video", tone: "blue", duration: "0:18" },
  { label: "Схема", type: "image", tone: "graphite" },
  { label: "Команда", type: "image", tone: "rose" },
  { label: "Прототип", type: "video", tone: "indigo", duration: "0:42" },
  { label: "Навигация", type: "image", tone: "cyan" },
  { label: "Профиль", type: "image", tone: "navy" },
  { label: "Обзор", type: "video", tone: "purple", duration: "1:06" },
  { label: "Галерея", type: "image", tone: "sky" },
  { label: "Встреча", type: "video", tone: "slate", duration: "0:27" },
  { label: "Релиз", type: "image", tone: "royal" },
];

const formatChatCount = (count: number) => {
  const lastTwo = count % 100;
  const last = count % 10;
  const word =
    lastTwo >= 11 && lastTwo <= 14
      ? "чатов"
      : last === 1
        ? "чат"
        : last >= 2 && last <= 4
          ? "чата"
          : "чатов";
  return `${count} ${word}`;
};

const formatParticipantCount = (count: number) => {
  const lastTwo = count % 100;
  const last = count % 10;
  const word =
    lastTwo >= 11 && lastTwo <= 14
      ? "участников"
      : last === 1
        ? "участник"
        : last >= 2 && last <= 4
          ? "участника"
          : "участников";
  return `${count} ${word}`;
};

const formatMessageTime = () =>
  new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

const formatRealtimeTimestamp = (value?: string) => {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";

  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
};

const isRealtimeRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const readRealtimeLabel = (
  source: Readonly<Record<string, unknown>> | undefined,
  keys: readonly string[],
) => {
  if (!source) return undefined;

  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
};

const getRealtimeChatTitle = (
  subscription: RealtimeChatSubscription,
) =>
  readRealtimeLabel(subscription.public, ["fn", "title", "name"]) ||
  readRealtimeLabel(subscription.private, ["title", "name", "comment"]) ||
  (subscription.topic.startsWith("grp")
    ? "Групповой чат Tinode"
    : subscription.topic.startsWith("chn")
      ? "Канал Tinode"
      : "Личный чат Tinode");

const getRealtimeAvatar = (title: string) => {
  const initials = title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("ru"))
    .join("");

  return initials || "RT";
};

const getRealtimeMessageText = (content: unknown) => {
  if (typeof content === "string") {
    return content.trim() || undefined;
  }

  if (isRealtimeRecord(content)) {
    const text = content["txt"];
    if (typeof text === "string" && text.trim()) {
      return text.trim();
    }
  }

  return undefined;
};

const getRealtimeReceiptSeq = (
  receipts: readonly RealtimeChatReceipt[],
  topic: string,
  what: "recv" | "read",
  selfUserId: string,
) =>
  receipts.reduce(
    (highest, receipt) =>
      receipt.topic === topic &&
      receipt.what === what &&
      receipt.from !== selfUserId
        ? Math.max(highest, receipt.seq)
        : highest,
    0,
  );

const buildRealtimeUiMessage = (
  message: RealtimeChatMessage,
  selfUserId: string,
): Message | null => {
  const text = getRealtimeMessageText(message.content);
  if (!text) return null;

  const outgoing = message.from === selfUserId;

  return {
    id: message.seq,
    side: outgoing ? "out" : "in",
    text,
    time: formatRealtimeTimestamp(message.timestamp) || formatMessageTime(),
    ...(outgoing ? { deliveryStatus: "sent" as const } : {}),
    ...(!outgoing && message.from ? { author: message.from } : {}),
  };
};

const withRealtimeReceiptStatus = (
  projected: Message | null,
  message: RealtimeChatMessage,
  selfUserId: string,
  receipts: readonly RealtimeChatReceipt[],
): Message | null => {
  if (!projected || projected.side !== "out") {
    return projected;
  }

  const remoteReadSeq = getRealtimeReceiptSeq(
    receipts,
    message.topic,
    "read",
    selfUserId,
  );
  const remoteReceivedSeq = getRealtimeReceiptSeq(
    receipts,
    message.topic,
    "recv",
    selfUserId,
  );

  return {
    ...projected,
    deliveryStatus:
      message.seq <= remoteReadSeq
        ? "read"
        : message.seq <= remoteReceivedSeq
          ? "delivered"
          : "sent",
  };
};

const getMessageSnippet = (message: Message) =>
  message.text?.trim() ||
  `Голосовое сообщение${message.voice ? ` · ${message.voice}` : ""}`;

const haveSameParticipants = (first: string[], second: string[]) => {
  const firstIds = new Set(first.filter((id) => id !== "self"));
  const secondIds = new Set(second.filter((id) => id !== "self"));
  return (
    firstIds.size === secondIds.size &&
    [...firstIds].every((id) => secondIds.has(id))
  );
};

const buildCallRecord = (
  participantIds: string[],
  type: CallRecord["type"],
  users: MessengerUser[],
  chats: Chat[],
): CallRecord | null => {
  const ids = Array.from(
    new Set(participantIds.filter((id) => id && id !== "self")),
  );
  if (!ids.length) return null;

  const people = ids
    .map((id) => users.find((user) => user.id === id))
    .filter((user): user is MessengerUser => Boolean(user));
  const matchingGroup = chats.find(
    (chat) =>
      chat.kind === "group" &&
      haveSameParticipants(chat.memberIds ?? [], ids),
  );
  const directPerson = people.length === 1 ? people[0] : undefined;
  const firstNames = people.map((person) => person.name.split(" ")[0]);
  const name = matchingGroup
    ? matchingGroup.title
    : directPerson
      ? directPerson.name
      : firstNames.length <= 2
        ? firstNames.join(", ")
        : `${firstNames.slice(0, 2).join(", ")} и ещё ${firstNames.length - 2}`;
  const avatar =
    matchingGroup?.avatar ??
    directPerson?.avatar ??
    people
      .slice(0, 2)
      .map((person) => person.name[0]?.toLocaleUpperCase("ru"))
      .join("") ??
    "CF";
  const gradient =
    matchingGroup?.gradient ??
    directPerson?.gradient ??
    "linear-gradient(145deg, #1d4ed8, #7c3aed)";

  return {
    participantIds: ids,
    name: name || "Групповой звонок",
    detail: `Сегодня, ${formatMessageTime()}`,
    type,
    avatar: avatar || "CF",
    gradient,
  };
};

const isCallRecord = (value: unknown): value is CallRecord => {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<CallRecord>;
  return (
    Array.isArray(record.participantIds) &&
    record.participantIds.every((id) => typeof id === "string") &&
    typeof record.name === "string" &&
    typeof record.detail === "string" &&
    (record.type === "in" ||
      record.type === "out" ||
      record.type === "missed") &&
    typeof record.avatar === "string" &&
    typeof record.gradient === "string"
  );
};

const emojiSets: Record<EmojiCategory, string[]> = {
  Недавние: ["😀", "😂", "😍", "🤝", "👍", "🔥", "🎉", "💙", "👏", "✅", "👀", "💡", "🚀", "🙏"],
  Люди: ["😀", "😄", "😂", "😍", "😎", "🤔", "🙏", "👏", "👍", "👀", "🤝", "🙌", "💪", "👋"],
  Работа: ["💻", "📎", "📌", "🗂️", "📊", "✅", "💡", "🚀", "⚡", "🛠️", "🧩", "🗓️", "✍️", "🔔"],
  Символы: ["💙", "❤️", "⭐", "✨", "🔥", "🎉", "⚡", "✅", "❗", "❓", "➕", "➡️", "🔒", "🔗"],
};

const chatPanelMeta: Record<
  ActiveChatPanel,
  { dialogLabel: string; title: string }
> = {
  attachments: { dialogLabel: "Вложения", title: "Добавить" },
  emoji: { dialogLabel: "Эмодзи и реакции", title: "Эмодзи и реакции" },
  profile: { dialogLabel: "Профиль пользователя", title: "Профиль" },
  participants: { dialogLabel: "Участники беседы", title: "Участники" },
  settings: { dialogLabel: "Меню беседы", title: "Меню беседы" },
  pinned: { dialogLabel: "Закреплённые сообщения", title: "Закрепы" },
  media: {
    dialogLabel: "Фото, видео и файлы",
    title: "Фото, видео и файлы",
  },
  search: { dialogLabel: "Поиск по беседе", title: "Поиск по беседе" },
};

function Avatar({
  label,
  gradient,
  imageUrl,
  size = "medium",
  online = false,
}: {
  label: string;
  gradient: string;
  imageUrl?: string;
  size?: "small" | "medium" | "large" | "hero";
  online?: boolean;
}) {
  return (
    <span
      className={`avatar avatar-${size}`}
      style={{ background: gradient } as CSSProperties}
      aria-hidden="true"
    >
      {imageUrl ? (
        <span
          className="avatar-photo"
          style={{ backgroundImage: `url("${imageUrl}")` }}
        />
      ) : (
        label
      )}
      {online ? <i className="online-dot" /> : null}
    </span>
  );
}

function ConversationMediaGrid({
  limit,
  onOpen,
}: {
  limit?: number;
  onOpen: (item: ConversationMediaItem, index: number) => void;
}) {
  const items =
    typeof limit === "number"
      ? conversationMediaItems.slice(0, limit)
      : conversationMediaItems;

  return (
    <div className="conversation-media-grid" aria-label="Фото и видео из чата">
      {items.map((item, index) => (
        <button
          type="button"
          className={`media-tile media-tone-${item.tone}`}
          key={`${item.label}-${index}`}
          aria-label={`Открыть ${item.type === "video" ? "видео" : "фото"}: ${item.label}`}
          onClick={() => onOpen(item, index)}
        >
          <span className="media-tile-icon">
            {item.type === "video" ? (
              <Video size={18} />
            ) : (
              <ImageIcon size={18} />
            )}
          </span>
          <small>{item.label}</small>
          {item.duration ? <time>{item.duration}</time> : null}
        </button>
      ))}
    </div>
  );
}

function StatusBar() {
  return (
    <div className="status-bar" aria-hidden="true">
      <span>9:41</span>
      <span className="status-icons">
        <Signal size={15} strokeWidth={2.4} />
        <Wifi size={15} strokeWidth={2.4} />
        <BatteryFull size={18} strokeWidth={2.2} />
      </span>
    </div>
  );
}

function ConfirmDialog({
  title,
  description,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="confirm-backdrop"
      role="presentation"
      onClick={onCancel}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="confirm-icon">
          <Trash2 size={22} />
        </span>
        <strong>{title}</strong>
        <p>{description}</p>
        <div className="confirm-actions">
          <button type="button" onClick={onCancel} autoFocus>
            Нет
          </button>
          <button type="button" className="confirm-danger" onClick={onConfirm}>
            Да
          </button>
        </div>
      </div>
    </div>
  );
}

function ContentPreview({
  content,
  onClose,
}: {
  content: PreviewContent;
  onClose: () => void;
}) {
  const Icon =
    content.kind === "video"
      ? Video
      : content.kind === "file"
        ? FileText
        : ImageIcon;

  return (
    <div
      className="content-preview-backdrop"
      role="presentation"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div
        className="content-preview"
        role="dialog"
        aria-modal="true"
        aria-label={`Просмотр: ${content.title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="content-preview-header">
          <span>
            <strong>{content.title}</strong>
            <small>{content.subtitle}</small>
          </span>
          <button
            type="button"
            aria-label="Закрыть просмотр"
            onClick={onClose}
            autoFocus
          >
            <X size={18} />
          </button>
        </div>
        <div
          className={`content-preview-stage ${
            content.tone ? `media-tone-${content.tone}` : ""
          }`}
        >
          <Icon size={42} />
          <span>
            {content.kind === "video"
              ? "Предпросмотр видео"
              : content.kind === "file"
                ? "Предпросмотр файла"
                : "Предпросмотр изображения"}
          </span>
        </div>
      </div>
    </div>
  );
}

function SignedOutView({
  onCredentials,
  onVerifyMfa,
}: {
  onCredentials: (login: string, password: string) => Promise<LoginOutcome>;
  onVerifyMfa: (
    login: string,
    challengeToken: string,
    code: string,
  ) => Promise<void>;
}) {
  const [step, setStep] = useState<"credentials" | "mfa">("credentials");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState(false);
  const canSubmitCredentials =
    login.trim().length > 0 && password.length > 0 && !busy;
  const canSubmitMfa = /^\d{6}$/.test(mfaCode) && !busy;

  return (
    <section className="view signed-out-view" aria-label="Авторизация CIFRA">
      <span className="auth-glow auth-glow-one" aria-hidden="true" />
      <span className="auth-glow auth-glow-two" aria-hidden="true" />

      <div className={`auth-card ${step === "mfa" ? "auth-card-mfa" : ""}`}>
        <div className="auth-brand-lockup" aria-label="CIFRA Messenger">
          <span className="auth-brand-mark">C</span>
          <span>
            <strong>CIFRA</strong>
            {step === "credentials" ? (
              <small>Корпоративный мессенджер</small>
            ) : null}
          </span>
        </div>

        {step === "credentials" ? (
          <>
            <div className="auth-heading">
              <h1>Добро пожаловать</h1>
            </div>

            <form
              className="auth-form"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!canSubmitCredentials) return;
                setBusy(true);
                setAuthError("");
                try {
                  const outcome = await onCredentials(login, password);
                  if (outcome.kind === "mfa_required") {
                    setChallengeToken(outcome.challengeToken);
                    setPassword("");
                    setMfaCode("");
                    setStep("mfa");
                  }
                } catch (error) {
                  setAuthError(authErrorMessage(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="auth-field">
                <span>Логин</span>
                <span className="auth-input">
                  <AtSign size={18} aria-hidden="true" />
                  <input
                    name="login"
                    type="text"
                    value={login}
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="Введите логин"
                    onChange={(event) => {
                      setLogin(event.target.value);
                      setAuthError("");
                    }}
                    autoFocus
                    disabled={busy}
                    required
                  />
                </span>
              </label>

              <label className="auth-field">
                <span>Пароль</span>
                <span className="auth-input">
                  <LockKeyhole size={18} aria-hidden="true" />
                  <input
                    name="password"
                    type={passwordVisible ? "text" : "password"}
                    value={password}
                    autoComplete="current-password"
                    placeholder="Введите пароль"
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setAuthError("");
                    }}
                    disabled={busy}
                    required
                  />
                  <button
                    type="button"
                    className="auth-password-toggle"
                    aria-label={
                      passwordVisible ? "Скрыть пароль" : "Показать пароль"
                    }
                    aria-pressed={passwordVisible}
                    onClick={() => setPasswordVisible((current) => !current)}
                    disabled={busy}
                  >
                    {passwordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </span>
              </label>

              {authError ? (
                <p className="auth-error" role="alert">
                  {authError}
                </p>
              ) : null}

              <button
                type="submit"
                className="auth-submit"
                disabled={!canSubmitCredentials}
              >
                <LogIn size={19} />
                Войти
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="auth-mfa-symbol" aria-hidden="true">
              <ShieldCheck size={26} />
            </div>
            <div className="auth-heading auth-mfa-heading">
              <h1>Подтвердите вход</h1>
              <p>Введите шестизначный код двухфакторной авторизации</p>
            </div>

            <form
              className="auth-form"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!canSubmitMfa) return;
                setBusy(true);
                setAuthError("");
                try {
                  await onVerifyMfa(login, challengeToken, mfaCode);
                } catch (error) {
                  setAuthError(authErrorMessage(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="auth-field">
                <span>Код подтверждения</span>
                <span
                  className={`auth-input auth-code-input ${
                    authError ? "auth-input-error" : ""
                  }`}
                >
                  <input
                    name="mfa-code"
                    type="text"
                    value={mfaCode}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    autoComplete="one-time-code"
                    aria-invalid={Boolean(authError)}
                    placeholder="000000"
                    onChange={(event) => {
                      setMfaCode(
                        event.target.value.replace(/\D/g, "").slice(0, 6),
                      );
                      setAuthError("");
                    }}
                    autoFocus
                    disabled={busy}
                    required
                  />
                </span>
              </label>

              {authError ? (
                <p className="auth-error" role="alert">
                  {authError}
                </p>
              ) : null}

              <button
                type="submit"
                className="auth-submit"
                disabled={!canSubmitMfa}
              >
                <ShieldCheck size={19} />
                Подтвердить вход
              </button>

              <button
                type="button"
                className="auth-back"
                onClick={() => {
                  setMfaCode("");
                  setChallengeToken("");
                  setAuthError("");
                  setStep("credentials");
                }}
                disabled={busy}
              >
                <ChevronLeft size={17} />
                Вернуться к логину
              </button>
            </form>
          </>
        )}
      </div>
    </section>
  );
}

function authErrorMessage(error: unknown): string {
  if (error instanceof CifraApiError) {
    if (error.code === "STEP_UP_REQUIRED") {
      return "Для операции требуется повторный вход с MFA.";
    }
    return error.requestId
      ? `${error.message} · запрос ${error.requestId}`
      : error.message;
  }
  return error instanceof Error
    ? error.message
    : "Не удалось выполнить вход";
}

function PasswordChangeOverlay({
  login,
  onChangePassword,
}: {
  login: string;
  onChangePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<void>;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= 12 &&
    newPassword === confirmation &&
    !busy;

  return (
    <div
      className="password-change-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Обязательная смена временного пароля"
    >
      <div className="auth-card password-change-card">
        <div className="auth-mfa-symbol" aria-hidden="true">
          <LockKeyhole size={26} />
        </div>
        <div className="auth-heading auth-mfa-heading">
          <h1>Смените временный пароль</h1>
          <p>
            Для учётной записи @{login} необходимо установить постоянный
            пароль.
          </p>
        </div>
        <form
          className="auth-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!canSubmit) return;
            setBusy(true);
            setError("");
            try {
              await onChangePassword(currentPassword, newPassword);
            } catch (changeError) {
              setError(authErrorMessage(changeError));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="auth-field">
            <span>Текущий пароль</span>
            <span className="auth-input">
              <LockKeyhole size={18} aria-hidden="true" />
              <input
                type="password"
                value={currentPassword}
                autoComplete="current-password"
                onChange={(event) => {
                  setCurrentPassword(event.target.value);
                  setError("");
                }}
                disabled={busy}
                autoFocus
                required
              />
            </span>
          </label>
          <label className="auth-field">
            <span>Новый пароль · минимум 12 символов</span>
            <span className="auth-input">
              <LockKeyhole size={18} aria-hidden="true" />
              <input
                type="password"
                value={newPassword}
                autoComplete="new-password"
                onChange={(event) => {
                  setNewPassword(event.target.value);
                  setError("");
                }}
                disabled={busy}
                minLength={12}
                required
              />
            </span>
          </label>
          <label className="auth-field">
            <span>Повторите новый пароль</span>
            <span
              className={`auth-input ${
                confirmation && confirmation !== newPassword
                  ? "auth-input-error"
                  : ""
              }`}
            >
              <CheckCheck size={18} aria-hidden="true" />
              <input
                type="password"
                value={confirmation}
                autoComplete="new-password"
                onChange={(event) => {
                  setConfirmation(event.target.value);
                  setError("");
                }}
                disabled={busy}
                minLength={12}
                required
              />
            </span>
          </label>
          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            className="auth-submit"
            disabled={!canSubmit}
          >
            <ShieldCheck size={19} />
            Сменить пароль
          </button>
          <p className="password-change-note">
            После смены сервер отзовёт текущую сессию и вернёт вас ко входу.
          </p>
        </form>
      </div>
    </div>
  );
}

function SwipeableChatRow({
  chat,
  onOpen,
  onToggleMute,
  onDelete,
  onToggleArchive,
  onTogglePin,
  pinEnabled = true,
  pinLimitReached,
  onPinLimitReached,
}: {
  chat: Chat;
  onOpen: () => void;
  onToggleMute: () => void;
  onDelete: () => void;
  onToggleArchive: () => void;
  onTogglePin: () => void;
  pinEnabled?: boolean;
  pinLimitReached: boolean;
  onPinLimitReached: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const [rowWidth, setRowWidth] = useState(1);
  const dragStartX = useRef<number | null>(null);
  const dragStartOffset = useRef(0);
  const currentOffset = useRef(0);
  const rowWidthRef = useRef(1);
  const moved = useRef(false);
  const {
    ratio: swipeRatio,
    swipingLeft,
    swipingRight,
    showMute,
    showDelete,
    showArchive,
    showPin,
  } = getSwipeActionState(offset, rowWidth, pinEnabled);
  const actionsOpen = showMute || showPin;
  const deliveryStatusLabel =
    chat.lastMessageSide === "out" && chat.lastDeliveryStatus
      ? chat.lastDeliveryStatus === "sent"
        ? "Отправлено"
        : chat.lastDeliveryStatus === "delivered"
          ? "Доставлено"
          : "Прочитано"
      : null;

  const updateOffset = (value: number) => {
    currentOffset.current = value;
    setOffset(value);
  };

  const startSwipe = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const width = event.currentTarget.getBoundingClientRect().width;
    rowWidthRef.current = Math.max(width, 1);
    setRowWidth(Math.max(width, 1));
    dragStartX.current = event.clientX;
    dragStartOffset.current = currentOffset.current;
    moved.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveSwipe = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragStartX.current === null) return;
    const delta = event.clientX - dragStartX.current;
    if (Math.abs(delta) > 5) moved.current = true;
    updateOffset(
      clampSwipeOffset(dragStartOffset.current + delta, rowWidthRef.current),
    );
  };

  const finishSwipe = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragStartX.current === null) return;
    dragStartX.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    updateOffset(
      snapSwipeOffset(
        currentOffset.current,
        rowWidthRef.current,
        pinEnabled,
      ),
    );
  };

  return (
    <div
      className={`swipe-chat-shell ${actionsOpen ? "is-open" : ""}`}
      data-swipe-direction={
        swipingLeft ? "left" : swipingRight ? "right" : "none"
      }
      data-swipe-progress={swipeRatio.toFixed(2)}
      data-swipe-limit="0.40"
    >
      <div
        className="swipe-pin-actions"
        aria-hidden={!showPin}
        style={{ width: `${swipingRight ? swipeRatio * 100 : 0}%` }}
      >
        <button
          type="button"
          className={`swipe-pin ${chat.pinned ? "is-unpin" : "is-pin"}`}
          aria-label={
            chat.pinned
              ? `Открепить чат: ${chat.title}`
              : `Закрепить чат: ${chat.title}`
          }
          tabIndex={showPin ? 0 : -1}
          onClick={() => {
            if (!chat.pinned && pinLimitReached) {
              onPinLimitReached();
            } else {
              onTogglePin();
            }
            updateOffset(0);
          }}
        >
          <Pin size={20} />
        </button>
      </div>
      <div
        className="swipe-actions"
        aria-hidden={!showMute}
        style={{ width: `${swipingLeft ? swipeRatio * 100 : 0}%` }}
      >
        <button
          type="button"
          className={`swipe-mute ${showMute ? "is-visible" : ""}`}
          aria-label={
            chat.muted
              ? `Включить уведомления: ${chat.title}`
              : `Выключить уведомления: ${chat.title}`
          }
          tabIndex={showMute ? 0 : -1}
          onClick={() => {
            onToggleMute();
            updateOffset(0);
          }}
        >
          <BellOff size={20} />
        </button>
        <button
          type="button"
          className={`swipe-delete ${showDelete ? "is-visible" : ""}`}
          aria-label={`Удалить чат: ${chat.title}`}
          tabIndex={showDelete ? 0 : -1}
          onClick={() => {
            updateOffset(0);
            onDelete();
          }}
        >
          <Trash2 size={20} />
        </button>
        <button
          type="button"
          className={`swipe-archive ${showArchive ? "is-visible" : ""}`}
          aria-label={
            chat.archived
              ? `Вернуть из архива: ${chat.title}`
              : `Перенести в архив: ${chat.title}`
          }
          tabIndex={showArchive ? 0 : -1}
          onClick={() => {
            onToggleArchive();
            updateOffset(0);
          }}
        >
          {chat.archived ? (
            <ArchiveRestore size={20} />
          ) : (
            <Archive size={20} />
          )}
        </button>
      </div>
      <button
        type="button"
        className={`chat-row ${chat.unread ? "has-unread" : ""}`}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={startSwipe}
        onPointerMove={moveSwipe}
        onPointerUp={finishSwipe}
        onPointerCancel={finishSwipe}
        onClick={(event) => {
          if (moved.current) {
            event.preventDefault();
            moved.current = false;
            return;
          }
          if (actionsOpen) {
            updateOffset(0);
            return;
          }
          onOpen();
        }}
        aria-label={`${chat.title}. ${chat.subtitle}.${deliveryStatusLabel ? ` ${deliveryStatusLabel}.` : ""} Проведите влево для уведомлений, удаления и архива${pinEnabled ? " или вправо для закрепления" : ""}`}
      >
        <Avatar
          label={chat.avatar}
          gradient={chat.gradient}
          online={chat.online}
        />
        <span className="chat-copy">
          <span className="chat-title-line">
            <strong>{chat.title}</strong>
            <time>{chat.time}</time>
          </span>
          <span className="chat-preview-line">
            <small>{chat.subtitle}</small>
            <span className="chat-meta">
              {deliveryStatusLabel ? (
                <span
                  className={`chat-delivery-status is-${chat.lastDeliveryStatus}`}
                  aria-label={deliveryStatusLabel}
                  title={deliveryStatusLabel}
                >
                  {chat.lastDeliveryStatus === "sent" ? (
                    <Check size={15} strokeWidth={2.35} aria-hidden="true" />
                  ) : (
                    <CheckCheck
                      size={15}
                      strokeWidth={2.35}
                      aria-hidden="true"
                    />
                  )}
                </span>
              ) : null}
              {chat.pinned ? <Pin size={13} /> : null}
              {chat.muted ? <BellOff size={13} /> : null}
              {chat.unread ? <i>{chat.unread}</i> : null}
            </span>
          </span>
        </span>
      </button>
    </div>
  );
}

function TabBar({
  active,
  onChange,
  notificationsEnabled,
  unreadCount,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
  notificationsEnabled: boolean;
  unreadCount: number;
}) {
  const items: {
    id: Tab;
    label: string;
    icon: typeof MessageCircle;
    badge?: number;
  }[] = [
    {
      id: "chats",
      label: "Чаты",
      icon: MessageCircle,
      badge: unreadCount,
    },
    { id: "teams", label: "Люди", icon: UsersRound },
    { id: "calls", label: "Звонки", icon: Phone },
    { id: "profile", label: "Профиль", icon: UserRound },
  ];

  return (
    <nav className="tab-bar" aria-label="Основная навигация">
      <span className="desktop-nav-brand" aria-label="CIFRA">
        C
      </span>
      {items.map((item) => {
        const Icon = item.icon;
        const selected = item.id === active;
        return (
          <button
            key={item.id}
            type="button"
            className={`tab-button ${selected ? "is-active" : ""}`}
            onClick={() => onChange(item.id)}
            aria-current={selected ? "page" : undefined}
          >
            <span className="tab-icon-wrap">
              <Icon size={21} strokeWidth={selected ? 2.5 : 2} />
              {item.badge && !selected && notificationsEnabled ? (
                <i className="mini-badge">{item.badge}</i>
              ) : null}
            </span>
            <span>{item.label}</span>
          </button>
        );
      })}
      <span className="desktop-nav-version" aria-hidden="true">
        WEB
      </span>
    </nav>
  );
}

function ChatsView({
  chats,
  users,
  role,
  onOpenChat,
  onMessageUser,
  onCallUser,
  onCompose,
  onToggleMute,
  onArchiveChat,
  onUnarchiveChat,
  onTogglePin,
  onDeleteChat,
}: {
  chats: Chat[];
  users: MessengerUser[];
  role: UserRole;
  onOpenChat: (id: string) => void;
  onMessageUser: (id: string) => void;
  onCallUser: (id: string) => void;
  onCompose: () => void;
  onToggleMute: (id: string) => void;
  onArchiveChat: (id: string) => void;
  onUnarchiveChat: (id: string) => void;
  onTogglePin: (id: string) => void;
  onDeleteChat: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("Все");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [pendingDeleteChatId, setPendingDeleteChatId] = useState<string | null>(
    null,
  );
  const [categories, setCategories] = useState<Filter[]>([
    ...defaultFilters,
  ]);
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [pinLimitVisible, setPinLimitVisible] = useState(false);
  const [customCategoryChats, setCustomCategoryChats] = useState<
    Record<string, string[]>
  >({});
  const activeFilter =
    !canAuditChats(role) && filter === "Удалённые" ? "Все" : filter;

  const isBuiltInCategory = (category: string) =>
    category === "Удалённые" ||
    defaultFilters.some((item) => item === category);

  const availableCategories = canAuditChats(role)
    ? [...categories, "Удалённые"]
    : categories;
  const archivedChats = sortChatsByActivity(
    chats.filter((chat) => chat.archived && !chat.deleted),
  );
  const pinnedCount = chats.filter(
    (chat) => chat.pinned && !chat.archived && !chat.deleted,
  ).length;
  const pendingDeleteChat = chats.find(
    (chat) => chat.id === pendingDeleteChatId,
  );
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const matchingUsers = useMemo(
    () =>
      normalizedQuery && activeFilter !== "Удалённые"
        ? users.filter(
            (user) =>
              user.id !== "self" &&
              `${user.name} ${user.username}`
                .toLocaleLowerCase("ru")
                .includes(normalizedQuery),
          )
        : [],
    [activeFilter, normalizedQuery, users],
  );

  const visibleChats = useMemo(() => {
    const customChatIds = customCategoryChats[activeFilter] ?? [];
    return sortChatsByActivity(
      chats.filter((chat) => {
        const matchesQuery =
          !normalizedQuery ||
          `${chat.title} ${chat.subtitle}`
            .toLocaleLowerCase("ru")
            .includes(normalizedQuery);
        const matchesFilter =
          activeFilter === "Удалённые"
            ? canAuditChats(role) && Boolean(chat.deleted)
            : !chat.archived &&
              !chat.deleted &&
              (activeFilter === "Все" ||
                (activeFilter === "Рабочие" && chat.kind === "work") ||
                (activeFilter === "Личные" && chat.kind === "personal") ||
                (activeFilter === "Группы" && chat.kind === "group") ||
                (activeFilter === "Непрочитанные" && chat.unread > 0) ||
                (!isBuiltInCategory(activeFilter) &&
                  customChatIds.includes(chat.id)));
        return matchesQuery && matchesFilter;
      }),
    );
  }, [activeFilter, chats, customCategoryChats, normalizedQuery, role]);

  const addCategory = () => {
    const value = newCategory.trim().replace(/\s+/g, " ");
    if (!value) return;
    const existing = categories.find(
      (category) =>
        category.toLocaleLowerCase("ru") === value.toLocaleLowerCase("ru"),
    );
    if (existing) {
      setEditingCategory(existing);
      setFilter(existing);
      setNewCategory("");
      return;
    }
    setCategories((current) => [...current, value]);
    setCustomCategoryChats((current) => ({ ...current, [value]: [] }));
    setEditingCategory(value);
    setFilter(value);
    setNewCategory("");
  };

  const moveCategory = (category: string, direction: -1 | 1) => {
    setCategories((current) => {
      const index = current.indexOf(category);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const removeCategory = (category: string) => {
    if (isBuiltInCategory(category)) return;
    setCategories((current) => current.filter((item) => item !== category));
    setCustomCategoryChats((current) => {
      const next = { ...current };
      delete next[category];
      return next;
    });
    if (filter === category) setFilter("Все");
    if (editingCategory === category) setEditingCategory(null);
  };

  const toggleChatInCategory = (category: string, chatId: string) => {
    setCustomCategoryChats((current) => {
      const assigned = current[category] ?? [];
      return {
        ...current,
        [category]: assigned.includes(chatId)
          ? assigned.filter((id) => id !== chatId)
          : [...assigned, chatId],
      };
    });
  };

  return (
    <section className="view chats-view">
      {archiveOpen ? (
        <header className="archive-header">
          <button
            type="button"
            className="back-button"
            aria-label="Назад к чатам"
            onClick={() => setArchiveOpen(false)}
          >
            <ChevronLeft size={25} />
            <span>Чаты</span>
          </button>
          <strong>Архив</strong>
          <span className="archive-header-spacer" />
        </header>
      ) : (
        <header className="large-header">
          <div>
            <h1>Чаты</h1>
          </div>
          <button
            className="round-action"
            type="button"
            aria-label="Новое сообщение"
            onClick={onCompose}
          >
            <SquarePen size={20} />
          </button>
        </header>
      )}

      {!archiveOpen ? (
        <>
          <label className="search-field">
            <Search size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск"
              aria-label="Поиск по чатам"
            />
            {query ? (
              <button
                type="button"
                aria-label="Очистить поиск"
                onClick={() => setQuery("")}
              >
                <X size={15} />
              </button>
            ) : null}
          </label>

          <div
            className="filter-strip"
            aria-label="Категории чатов"
            title="Проведите влево или вправо для прокрутки"
          >
            {availableCategories.map((item) => (
              <button
                key={item}
                type="button"
                className={activeFilter === item ? "is-active" : ""}
                onClick={() => setFilter(item)}
              >
                {item}
              </button>
            ))}
            <button
              type="button"
              className="category-add-chip"
              aria-label="Добавить категорию"
              onClick={() => setCategorySheetOpen(true)}
            >
              <Plus size={18} />
            </button>
          </div>
        </>
      ) : null}

      <div className="scroll-area chat-scroll">
        {archiveOpen ? (
          <div className="archive-content">
            <div className="archive-explainer">
              <Archive size={18} />
              <span>
                <strong>Чаты останутся здесь без уведомлений</strong>
                <small>Вернуть чат можно через меню беседы</small>
              </span>
            </div>
            <div className="chat-list">
              {archivedChats.map((chat) => (
                <SwipeableChatRow
                  key={chat.id}
                  chat={chat}
                  onOpen={() => onOpenChat(chat.id)}
                  onToggleMute={() => onToggleMute(chat.id)}
                  onDelete={() => setPendingDeleteChatId(chat.id)}
                  onToggleArchive={() => onUnarchiveChat(chat.id)}
                  onTogglePin={() => undefined}
                  pinEnabled={false}
                  pinLimitReached={false}
                  onPinLimitReached={() => undefined}
                />
              ))}
              {!archivedChats.length ? (
                <div className="empty-state">
                  <Archive size={28} />
                  <strong>Архив пуст</strong>
                  <span>Перенесите чат через меню беседы</span>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            {activeFilter === "Все" && !query ? (
              <button
                className="archive-row"
                type="button"
                aria-label={`Открыть архив. ${formatChatCount(archivedChats.length)}`}
                onClick={() => setArchiveOpen(true)}
              >
                <span className="archive-icon">
                  <Archive size={19} />
                </span>
                <span>
                  <strong>Архив</strong>
                  <small>
                    {formatChatCount(archivedChats.length)} без уведомлений
                  </small>
                </span>
                <ChevronRight size={17} />
              </button>
            ) : null}

            {query && matchingUsers.length ? (
              <section
                className="chat-people-results"
                aria-label="Найденные сотрудники"
              >
                <span className="chat-results-heading">Сотрудники</span>
                {matchingUsers.map((person) => (
                  <div className="chat-search-person-row" key={person.id}>
                    <Avatar
                      label={person.avatar}
                      gradient={person.gradient}
                      imageUrl={person.avatarUrl}
                      size="small"
                      online={person.online}
                    />
                    <span className="chat-search-person-copy">
                      <strong>{person.name}</strong>
                      <small>{person.position}</small>
                    </span>
                    <span className="chat-search-person-actions">
                      <button
                        type="button"
                        aria-label={`Написать: ${person.name}`}
                        title="Написать"
                        onClick={() => onMessageUser(person.id)}
                      >
                        <MessageCircle size={17} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Позвонить: ${person.name}`}
                        title="Позвонить"
                        onClick={() => onCallUser(person.id)}
                      >
                        <Phone size={17} />
                      </button>
                    </span>
                  </div>
                ))}
              </section>
            ) : null}

            {pinLimitVisible ? (
              <div className="pin-limit-note" role="status">
                <span className="pin-limit-icon">
                  <Pin size={16} />
                </span>
                <span>
                  <strong>Лимит закреплений</strong>
                  <small>Можно закрепить не более 3 чатов или бесед</small>
                </span>
                <button
                  type="button"
                  aria-label="Закрыть сообщение"
                  onClick={() => setPinLimitVisible(false)}
                >
                  <X size={16} />
                </button>
              </div>
            ) : null}

            <div className="chat-list">
              {query && matchingUsers.length && visibleChats.length ? (
                <span className="chat-results-heading">Чаты</span>
              ) : null}
              {visibleChats.map((chat) =>
                chat.deleted ? (
                  <button
                    type="button"
                    className="chat-row deleted-chat-row"
                    key={chat.id}
                    onClick={() => onOpenChat(chat.id)}
                  >
                    <Avatar
                      label={chat.avatar}
                      gradient={chat.gradient}
                      online={chat.online}
                    />
                    <span className="chat-copy">
                      <span className="chat-title-line">
                        <strong>{chat.title}</strong>
                        <time>Удалён</time>
                      </span>
                      <span className="chat-preview-line">
                        <small>{chat.subtitle}</small>
                        <span className="deleted-chat-badge">
                          Видно администратору
                        </span>
                      </span>
                    </span>
                  </button>
                ) : (
                  <SwipeableChatRow
                    key={chat.id}
                    chat={chat}
                    onOpen={() => onOpenChat(chat.id)}
                    onToggleMute={() => onToggleMute(chat.id)}
                    onDelete={() => setPendingDeleteChatId(chat.id)}
                    onToggleArchive={() => onArchiveChat(chat.id)}
                    onTogglePin={() => {
                      setPinLimitVisible(false);
                      onTogglePin(chat.id);
                    }}
                    pinLimitReached={!chat.pinned && pinnedCount >= 3}
                    onPinLimitReached={() => setPinLimitVisible(true)}
                  />
                ),
              )}
              {!visibleChats.length && !matchingUsers.length ? (
                <div className="empty-state">
                  {activeFilter === "Удалённые" ? (
                    <Trash2 size={28} />
                  ) : (
                    <Search size={28} />
                  )}
                  <strong>
                    {activeFilter === "Удалённые"
                      ? "Удалённых чатов нет"
                      : isBuiltInCategory(activeFilter)
                        ? "Ничего не найдено"
                        : "В категории пока нет чатов"}
                  </strong>
                  <span>
                    {activeFilter === "Удалённые"
                      ? "Удалённые переписки появятся здесь"
                      : isBuiltInCategory(activeFilter)
                        ? "Попробуйте другой запрос или фильтр"
                        : "Выберите чаты в настройках категории"}
                  </span>
                  {!isBuiltInCategory(activeFilter) ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCategory(activeFilter);
                        setCategorySheetOpen(true);
                      }}
                    >
                      Настроить категорию
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>

      {categorySheetOpen ? (
        <div
          className="sheet-backdrop"
          role="presentation"
          onClick={() => setCategorySheetOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setCategorySheetOpen(false);
          }}
        >
          <div
            className="bottom-sheet category-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Управление категориями"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="sheet-handle" />
            <div className="sheet-title">
              <span>
                <strong>Категории чатов</strong>
                <small>Прокручивайте строку и меняйте порядок</small>
              </span>
              <button
                type="button"
                aria-label="Закрыть"
                onClick={() => setCategorySheetOpen(false)}
                autoFocus
              >
                <X size={18} />
              </button>
            </div>

            <form
              className="category-create"
              onSubmit={(event) => {
                event.preventDefault();
                addCategory();
              }}
            >
              <input
                value={newCategory}
                maxLength={18}
                placeholder="Название категории"
                aria-label="Название новой категории"
                onChange={(event) => setNewCategory(event.target.value)}
              />
              <button type="submit" disabled={!newCategory.trim()}>
                Добавить
              </button>
            </form>

            <div className="category-manager-list">
              {categories.map((category, index) => (
                <div
                  key={category}
                  className={`category-manager-row ${
                    editingCategory === category ? "is-selected" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="category-name-button"
                    onClick={() =>
                      setEditingCategory(
                        editingCategory === category ? null : category,
                      )
                    }
                  >
                    <span>{category}</span>
                    <small>
                      {isBuiltInCategory(category)
                        ? "Системная"
                        : `${(customCategoryChats[category] ?? []).length} чатов`}
                    </small>
                  </button>
                  <span className="category-order-actions">
                    <button
                      type="button"
                      aria-label={`Переместить ${category} влево`}
                      disabled={index === 0}
                      onClick={() => moveCategory(category, -1)}
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Переместить ${category} вправо`}
                      disabled={index === categories.length - 1}
                      onClick={() => moveCategory(category, 1)}
                    >
                      <ChevronRight size={18} />
                    </button>
                    {!isBuiltInCategory(category) ? (
                      <button
                        type="button"
                        className="category-remove"
                        aria-label={`Удалить категорию ${category}`}
                        onClick={() => removeCategory(category)}
                      >
                        <X size={17} />
                      </button>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>

            {editingCategory && !isBuiltInCategory(editingCategory) ? (
              <div className="category-chat-picker">
                <span className="settings-label">
                  ЧАТЫ В КАТЕГОРИИ «{editingCategory.toUpperCase()}»
                </span>
                {chats
                  .filter((chat) => !chat.archived && !chat.deleted)
                  .map((chat) => {
                  const selected = (
                    customCategoryChats[editingCategory] ?? []
                  ).includes(chat.id);
                  return (
                    <button
                      type="button"
                      key={chat.id}
                      aria-pressed={selected}
                      onClick={() =>
                        toggleChatInCategory(editingCategory, chat.id)
                      }
                    >
                      <Avatar
                        label={chat.avatar}
                        gradient={chat.gradient}
                        size="small"
                      />
                      <span>{chat.title}</span>
                      <i className={selected ? "is-selected" : ""}>
                        {selected ? <CheckCheck size={16} /> : null}
                      </i>
                    </button>
                  );
                  })}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {pendingDeleteChat ? (
        <ConfirmDialog
          title="Вы действительно хотите удалить чат?"
          description={`Переписка «${pendingDeleteChat.title}» исчезнет из списка. Администратор сможет просмотреть её в разделе «Удалённые».`}
          onCancel={() => setPendingDeleteChatId(null)}
          onConfirm={() => {
            onDeleteChat(pendingDeleteChat.id);
            setPendingDeleteChatId(null);
          }}
        />
      ) : null}
    </section>
  );
}

function ChatView({
  chat,
  chats,
  users,
  role,
  messages,
  onBack,
  onSend,
  onClear,
  onCall,
  onToggleMute,
  onArchive,
  onUnarchive,
  onDelete,
  onAddParticipants,
  onTogglePinnedMessage,
  onForwardMessage,
}: {
  chat: Chat;
  chats: Chat[];
  users: MessengerUser[];
  role: UserRole;
  messages: Message[];
  onBack: () => void;
  onSend: (text: string, options?: SendMessageOptions) => void;
  onClear: () => void;
  onCall: () => void;
  onToggleMute: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
  onAddParticipants: (participantIds: string[]) => void;
  onTogglePinnedMessage: (messageId: number) => void;
  onForwardMessage: (messageId: number, targetChatId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [replyingToMessageId, setReplyingToMessageId] = useState<
    number | null
  >(null);
  const [contextMessageId, setContextMessageId] = useState<number | null>(
    null,
  );
  const [forwardMessageId, setForwardMessageId] = useState<number | null>(
    null,
  );
  const [forwardQuery, setForwardQuery] = useState("");
  const [forwardFilter, setForwardFilter] = useState("Все");
  const [messageSwipe, setMessageSwipe] = useState<{
    id: number | null;
    offset: number;
  }>({ id: null, offset: 0 });
  const [actionNotice, setActionNotice] = useState("");
  const [activePanel, setActivePanel] = useState<ChatPanel>(null);
  const [recording, setRecording] = useState(false);
  const [joinApproval, setJoinApproval] = useState(false);
  const [emojiCategory, setEmojiCategory] =
    useState<EmojiCategory>("Недавние");
  const [mediaCategory, setMediaCategory] =
    useState<MediaCategory>("Фото и видео");
  const [messageSearch, setMessageSearch] = useState("");
  const [addingParticipants, setAddingParticipants] = useState(false);
  const [participantQuery, setParticipantQuery] = useState("");
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<
    string[]
  >([]);
  const [participantsAdded, setParticipantsAdded] = useState(0);
  const [settingsContentTab, setSettingsContentTab] = useState<
    "media" | "files"
  >("media");
  const [chatPatternEnabled, setChatPatternEnabled] = useState(true);
  const [clearArmed, setClearArmed] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [playingVoiceId, setPlayingVoiceId] = useState<number | null>(null);
  const [previewContent, setPreviewContent] =
    useState<PreviewContent | null>(null);
  const [panelReturnTarget, setPanelReturnTarget] = useState<
    "settings" | "profile"
  >("settings");
  const panelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const actionNoticeTimerRef = useRef<number | null>(null);
  const messageGestureRef = useRef<{
    id: number;
    pointerId: number;
    startX: number;
    startY: number;
    offset: number;
    swiping: boolean;
  } | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const profileUser = users.find((user) => user.id === chat.id);
  const conversationParticipantIds = Array.from(
    new Set([
      "self",
      ...(chat.kind === "group" ? (chat.memberIds ?? []) : [chat.id]),
    ]),
  );
  const conversationMembers = conversationParticipantIds
    .map((id) => users.find((user) => user.id === id))
    .filter((user): user is MessengerUser => Boolean(user));
  const conversationMemberIdSet = new Set(
    conversationMembers.map((user) => user.id),
  );
  const participantCountLabel = formatParticipantCount(
    conversationMembers.length,
  );
  const onlineParticipantCount = conversationMembers.filter(
    (user) => user.online,
  ).length;
  const conversationStatus =
    chat.kind === "group"
      ? `${participantCountLabel} · ${onlineParticipantCount} в сети`
      : profileUser?.online
        ? "в сети"
        : "не в сети";
  const panelsReturningToMenu: ActiveChatPanel[] = [
    "participants",
    "media",
    "search",
  ];
  const replyingToMessage = messages.find(
    (message) => message.id === replyingToMessageId,
  );
  const contextMessage = messages.find(
    (message) => message.id === contextMessageId,
  );
  const forwardMessage = messages.find(
    (message) => message.id === forwardMessageId,
  );

  useEffect(
    () => () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
      if (actionNoticeTimerRef.current !== null) {
        window.clearTimeout(actionNoticeTimerRef.current);
      }
    },
    [],
  );

  const openPanel = (panel: ActiveChatPanel, trigger: HTMLButtonElement) => {
    panelTriggerRef.current = trigger;
    setActivePanel(panel);
  };

  const closePanel = () => {
    setActivePanel(null);
    setClearArmed(false);
    setAddingParticipants(false);
    setParticipantQuery("");
    setSelectedParticipantIds([]);
    window.requestAnimationFrame(() => panelTriggerRef.current?.focus());
  };

  const openAttachmentPicker = (
    inputRef: { current: HTMLInputElement | null },
  ) => {
    setActivePanel(null);
    setClearArmed(false);
    inputRef.current?.click();
  };

  const normalizedMessageSearch = messageSearch
    .trim()
    .toLocaleLowerCase("ru");
  const matchingMessages = messages.filter((message) =>
    `${message.author ?? ""} ${message.forwardedFrom ?? ""} ${message.text ?? ""} ${message.voice ?? ""}`
      .toLocaleLowerCase("ru")
      .includes(normalizedMessageSearch),
  );
  const pinnedMessages = messages
    .filter((message) => message.pinned)
    .sort(
      (first, second) =>
        (second.pinnedAt ?? second.id) - (first.pinnedAt ?? first.id),
    );
  const normalizedForwardQuery = forwardQuery
    .trim()
    .toLocaleLowerCase("ru");
  const visibleForwardChats = sortChatsByActivity(
    chats.filter((target) => {
      if (target.deleted || target.archived) return false;
      const matchesQuery =
        !normalizedForwardQuery ||
        `${target.title} ${target.subtitle}`
          .toLocaleLowerCase("ru")
          .includes(normalizedForwardQuery);
      const matchesFilter =
        forwardFilter === "Все" ||
        (forwardFilter === "Рабочие" && target.kind === "work") ||
        (forwardFilter === "Личные" && target.kind === "personal") ||
        (forwardFilter === "Группы" && target.kind === "group") ||
        (forwardFilter === "Непрочитанные" && target.unread > 0);
      return matchesQuery && matchesFilter;
    }),
  );
  const normalizedParticipantQuery = participantQuery
    .trim()
    .toLocaleLowerCase("ru");
  const availableParticipantContacts = users.filter(
    (user) =>
      user.id !== "self" &&
      !conversationMemberIdSet.has(user.id) &&
      (!normalizedParticipantQuery ||
        `${user.name} ${user.position}`
          .toLocaleLowerCase("ru")
          .includes(normalizedParticipantQuery)),
  );

  const toggleParticipantSelection = (id: string) => {
    setSelectedParticipantIds((current) =>
      current.includes(id)
        ? current.filter((participantId) => participantId !== id)
        : [...current, id],
    );
  };

  const showActionNotice = (message: string) => {
    setActionNotice(message);
    if (actionNoticeTimerRef.current !== null) {
      window.clearTimeout(actionNoticeTimerRef.current);
    }
    actionNoticeTimerRef.current = window.setTimeout(() => {
      setActionNotice("");
      actionNoticeTimerRef.current = null;
    }, 1800);
  };

  const getMessageAuthorLabel = (message: Message) =>
    message.side === "out"
      ? "Вы"
      : message.author || profileUser?.name || chat.title;

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current === null) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const openMessageContext = (messageId: number) => {
    clearLongPressTimer();
    messageGestureRef.current = null;
    setMessageSwipe({ id: null, offset: 0 });
    setContextMessageId(messageId);
  };

  const beginMessageGesture = (
    event: ReactPointerEvent<HTMLDivElement>,
    messageId: number,
  ) => {
    if (!event.isPrimary || event.button !== 0) return;
    clearLongPressTimer();
    messageGestureRef.current = {
      id: messageId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offset: 0,
      swiping: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.pointerType !== "mouse") {
      longPressTimerRef.current = window.setTimeout(() => {
        openMessageContext(messageId);
      }, 520);
    }
  };

  const moveMessageGesture = (
    event: ReactPointerEvent<HTMLDivElement>,
    messageId: number,
  ) => {
    const gesture = messageGestureRef.current;
    if (!gesture || gesture.id !== messageId) return;

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) {
      clearLongPressTimer();
    }
    if (
      !gesture.swiping &&
      deltaX < -8 &&
      Math.abs(deltaX) > Math.abs(deltaY)
    ) {
      gesture.swiping = true;
    }
    if (!gesture.swiping) return;

    event.preventDefault();
    gesture.offset = Math.max(-72, Math.min(0, deltaX));
    setMessageSwipe({ id: messageId, offset: gesture.offset });
  };

  const finishMessageGesture = (
    event: ReactPointerEvent<HTMLDivElement>,
    messageId: number,
    cancelled = false,
  ) => {
    clearLongPressTimer();
    const gesture = messageGestureRef.current;
    if (!gesture || gesture.id !== messageId) return;
    const shouldReply = !cancelled && gesture.swiping && gesture.offset <= -42;
    messageGestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setMessageSwipe({ id: null, offset: 0 });
    if (shouldReply) {
      setReplyingToMessageId(messageId);
      window.requestAnimationFrame(() => composerInputRef.current?.focus());
    }
  };

  const copyMessage = async (message: Message) => {
    const content = getMessageSnippet(message);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        const temporaryInput = document.createElement("textarea");
        temporaryInput.value = content;
        temporaryInput.style.position = "fixed";
        temporaryInput.style.opacity = "0";
        document.body.append(temporaryInput);
        temporaryInput.select();
        document.execCommand("copy");
        temporaryInput.remove();
      }
      showActionNotice("Сообщение скопировано");
    } catch {
      showActionNotice("Не удалось скопировать сообщение");
    }
    setContextMessageId(null);
  };

  const closeForwardPicker = () => {
    setForwardMessageId(null);
    setForwardQuery("");
    setForwardFilter("Все");
  };

  const confirmParticipants = () => {
    if (!selectedParticipantIds.length) return;
    onAddParticipants(selectedParticipantIds);
    setParticipantsAdded(selectedParticipantIds.length);
    setSelectedParticipantIds([]);
    setParticipantQuery("");
    setAddingParticipants(false);
  };

  const submitMessage = () => {
    const value = draft.trim();
    if (!value) return;
    onSend(value, {
      replyToId: replyingToMessage?.id,
    });
    setDraft("");
    setReplyingToMessageId(null);
    window.requestAnimationFrame(() => composerInputRef.current?.focus());
  };

  const handleVoice = () => {
    if (recording) {
      setRecording(false);
      onSend("", {
        voice: "0:07",
        replyToId: replyingToMessage?.id,
      });
      setReplyingToMessageId(null);
      return;
    }
    setRecording(true);
  };

  const handleAttachment = (
    event: ChangeEvent<HTMLInputElement>,
    kind: "gallery" | "camera" | "file",
  ) => {
    const selectedFiles = Array.from(event.currentTarget.files ?? []);
    if (!selectedFiles.length) return;

    if (kind === "gallery") {
      onSend(
        selectedFiles.length === 1
          ? `🖼️ ${selectedFiles[0].name}`
          : `🖼️ Медиафайлы · ${selectedFiles.length}`,
        { replyToId: replyingToMessage?.id },
      );
    } else if (kind === "camera") {
      onSend(`📷 ${selectedFiles[0].name}`, {
        replyToId: replyingToMessage?.id,
      });
    } else {
      onSend(`📎 ${selectedFiles[0].name}`, {
        replyToId: replyingToMessage?.id,
      });
    }

    setReplyingToMessageId(null);
    event.currentTarget.value = "";
  };

  const openMediaPreview = (item: ConversationMediaItem) => {
    setPreviewContent({
      title: item.label,
      subtitle:
        item.type === "video"
          ? `Видео${item.duration ? ` · ${item.duration}` : ""}`
          : "Изображение из переписки",
      kind: item.type,
      tone: item.tone,
    });
  };

  const jumpToMessage = (messageId: number) => {
    closePanel();
    window.requestAnimationFrame(() => {
      document
        .getElementById(`message-${messageId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  return (
    <section className="view conversation-view">
      <header className="compact-header">
        <button
          type="button"
          className="back-button"
          onClick={onBack}
          aria-label="Назад к чатам"
        >
          <ChevronLeft size={25} />
          <span>Чаты</span>
        </button>
        <button
          type="button"
          className="chat-person"
          aria-label={
            chat.kind === "group"
              ? "Информация о беседе"
              : "Профиль пользователя"
          }
          aria-expanded={activePanel === "profile"}
          onClick={(event) => {
            setPanelReturnTarget("profile");
            openPanel("profile", event.currentTarget);
          }}
        >
          <Avatar
            label={chat.avatar}
            gradient={chat.gradient}
            size="small"
            online={chat.online}
          />
          <span>
            <strong>{chat.title}</strong>
            <small>{conversationStatus}</small>
          </span>
        </button>
        <div className="header-actions">
          <button
            type="button"
            aria-label={
              chat.deleted
                ? "Звонок недоступен для удалённого чата"
                : "Видеозвонок"
            }
            disabled={chat.deleted}
            onClick={onCall}
          >
            <Video size={20} />
          </button>
          <button
            type="button"
            aria-label="Меню беседы"
            aria-expanded={activePanel === "settings"}
            onClick={(event) => {
              setPanelReturnTarget("settings");
              openPanel("settings", event.currentTarget);
            }}
          >
            <MoreHorizontal size={22} />
          </button>
        </div>
      </header>

      {pinnedMessages.length ? (
        <button
          type="button"
          className="pinned-bar"
          aria-expanded={activePanel === "pinned"}
          onClick={(event) => openPanel("pinned", event.currentTarget)}
        >
          <span className="pin-accent" />
          <span>
            <small>Закреплённое сообщение</small>
            <strong>
              {pinnedMessages[0].text ??
                `Голосовое сообщение · ${pinnedMessages[0].voice}`}
            </strong>
          </span>
          <Pin size={16} />
        </button>
      ) : null}

      <div className="message-canvas">
        {chatPatternEnabled ? <div className="pattern" aria-hidden="true" /> : null}
        <div className="day-chip">Сегодня</div>
        <div className="security-chip">
          <LockKeyhole size={12} />
          Сообщения защищены
        </div>
        <div className="message-stack">
          {messages.map((message) => {
            const repliedMessage = message.replyToId
              ? messages.find((item) => item.id === message.replyToId)
              : undefined;
            const swipeOffset =
              messageSwipe.id === message.id ? messageSwipe.offset : 0;

            return (
              <div
                className={`message-swipe-shell message-shell-${message.side} ${
                  swipeOffset ? "is-swiping" : ""
                }`}
                key={message.id}
                id={`message-${message.id}`}
              >
                <span
                  className="message-reply-indicator"
                  aria-hidden="true"
                  style={{
                    opacity: Math.min(Math.abs(swipeOffset) / 42, 1),
                    transform: `translateY(-50%) scale(${0.78 + Math.min(Math.abs(swipeOffset) / 72, 1) * 0.22})`,
                  }}
                >
                  <Reply size={18} />
                </span>
                <div
                  className={`message-row message-${message.side}`}
                  style={{ transform: `translateX(${swipeOffset}px)` }}
                  onPointerDown={(event) =>
                    beginMessageGesture(event, message.id)
                  }
                  onPointerMove={(event) =>
                    moveMessageGesture(event, message.id)
                  }
                  onPointerUp={(event) =>
                    finishMessageGesture(event, message.id)
                  }
                  onPointerCancel={(event) =>
                    finishMessageGesture(event, message.id, true)
                  }
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openMessageContext(message.id);
                  }}
                  aria-label="Свайпните влево, чтобы ответить"
                >
                  <div
                    className={`message-bubble ${
                      message.voice ? "voice-bubble" : ""
                    }`}
                  >
                    {message.forwardedFrom ? (
                      <span className="forwarded-message-label">
                        <Forward size={13} />
                        Переслано от {message.forwardedFrom}
                      </span>
                    ) : null}
                    {repliedMessage ? (
                      <button
                        type="button"
                        className="message-quote"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => jumpToMessage(repliedMessage.id)}
                        aria-label={`Перейти к сообщению: ${getMessageSnippet(repliedMessage)}`}
                      >
                        <i />
                        <span>
                          <strong>{getMessageAuthorLabel(repliedMessage)}</strong>
                          <small>{getMessageSnippet(repliedMessage)}</small>
                        </span>
                      </button>
                    ) : null}
                    {message.author ? (
                      <strong className="message-author">{message.author}</strong>
                    ) : null}
                    {message.voice ? (
                      <div className="voice-content">
                        <button
                          type="button"
                          className={
                            playingVoiceId === message.id ? "is-playing" : ""
                          }
                          aria-label={
                            playingVoiceId === message.id
                              ? "Поставить голосовое на паузу"
                              : "Воспроизвести голосовое"
                          }
                          aria-pressed={playingVoiceId === message.id}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() =>
                            setPlayingVoiceId((current) =>
                              current === message.id ? null : message.id,
                            )
                          }
                        >
                          {playingVoiceId === message.id ? (
                            <Pause size={13} fill="currentColor" />
                          ) : (
                            <Play size={13} fill="currentColor" />
                          )}
                        </button>
                        <span className="waveform" aria-hidden="true">
                          {Array.from({ length: 19 }).map((_, index) => (
                            <i
                              key={index}
                              style={{
                                height: `${8 + ((index * 7) % 19)}px`,
                              }}
                            />
                          ))}
                        </span>
                        <small>{message.voice}</small>
                      </div>
                    ) : (
                      <span>{message.text}</span>
                    )}
                    <time>
                      {message.time}
                      {message.pinned ? (
                        <Pin
                          className="message-pinned-mark"
                          size={11}
                          aria-label="Закреплено"
                        />
                      ) : null}
                      {message.side === "out" && message.deliveryStatus ? (
                        <span
                          className={`message-delivery-status is-${message.deliveryStatus}`}
                          role="img"
                          aria-label={
                            message.deliveryStatus === "sent"
                              ? "Отправлено"
                              : message.deliveryStatus === "delivered"
                                ? "Доставлено"
                                : "Прочитано"
                          }
                        >
                          {message.deliveryStatus === "sent" ? (
                            <Check
                              size={14}
                              strokeWidth={2.3}
                              aria-hidden="true"
                            />
                          ) : (
                            <CheckCheck
                              size={14}
                              strokeWidth={2.3}
                              aria-hidden="true"
                            />
                          )}
                        </span>
                      ) : null}
                    </time>
                  </div>
                </div>
                <button
                  type="button"
                  className="message-actions-trigger"
                  aria-label="Действия с сообщением"
                  aria-expanded={contextMessageId === message.id}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => openMessageContext(message.id)}
                >
                  <MoreHorizontal size={17} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {chat.deleted ? (
        <div className="deleted-chat-readonly">
          <Trash2 size={18} />
          <span>
            <strong>Удалённый чат</strong>
            <small>История доступна администратору только для просмотра</small>
          </span>
        </div>
      ) : (
      <>
        {replyingToMessage ? (
          <div className="reply-selection" role="status">
            <i />
            <span>
              <strong>
                Ответ: {getMessageAuthorLabel(replyingToMessage)}
              </strong>
              <small>{getMessageSnippet(replyingToMessage)}</small>
            </span>
            <button
              type="button"
              aria-label="Отменить ответ"
              onClick={() => setReplyingToMessageId(null)}
            >
              <X size={16} />
            </button>
          </div>
        ) : null}
        <div className={`composer-wrap ${recording ? "is-recording" : ""}`}>
        <input
          ref={galleryInputRef}
          hidden
          type="file"
          accept="image/*,video/*"
          multiple
          onChange={(event) => handleAttachment(event, "gallery")}
        />
        <input
          ref={cameraInputRef}
          hidden
          type="file"
          accept="image/*,video/*"
          capture="environment"
          onChange={(event) => handleAttachment(event, "camera")}
        />
        <input
          ref={fileInputRef}
          hidden
          type="file"
          onChange={(event) => handleAttachment(event, "file")}
        />
        {recording ? (
          <div className="recording-panel">
            <i />
            <strong>0:07</strong>
            <span>Нажмите, чтобы отправить</span>
          </div>
        ) : (
          <>
            <button
              type="button"
              className="media-composer-button attachment-menu-button"
              aria-label="Добавить вложение"
              aria-expanded={activePanel === "attachments"}
              onClick={(event) =>
                openPanel("attachments", event.currentTarget)
              }
            >
              <Plus size={24} />
            </button>
            <div className="composer-input">
              <textarea
                ref={composerInputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Сообщение"
                rows={1}
                aria-label="Текст сообщения"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submitMessage();
                  }
                }}
              />
              <button
                type="button"
                aria-label="Эмодзи"
                aria-expanded={activePanel === "emoji"}
                onClick={(event) => openPanel("emoji", event.currentTarget)}
              >
                <Smile size={20} />
              </button>
            </div>
          </>
        )}
        <button
          type="button"
          className="send-button"
          aria-label={draft ? "Отправить" : recording ? "Завершить запись" : "Записать голосовое"}
          onClick={draft ? submitMessage : handleVoice}
        >
          {draft ? <Send size={19} /> : <Mic size={20} />}
        </button>
        </div>
      </>
      )}

      {actionNotice ? (
        <div className="chat-action-toast" role="status">
          {actionNotice}
        </div>
      ) : null}

      {contextMessage ? (
        <div
          className="sheet-backdrop message-context-backdrop"
          role="presentation"
          onClick={() => setContextMessageId(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setContextMessageId(null);
          }}
        >
          <div
            className="bottom-sheet message-context-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Действия с сообщением"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="sheet-handle" />
            <div className="message-context-preview">
              <small>{getMessageAuthorLabel(contextMessage)}</small>
              <strong>{getMessageSnippet(contextMessage)}</strong>
            </div>
            <div className="message-context-actions">
              <button
                type="button"
                onClick={() => void copyMessage(contextMessage)}
              >
                <Copy size={20} />
                <span>Скопировать</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onTogglePinnedMessage(contextMessage.id);
                  setContextMessageId(null);
                  showActionNotice(
                    contextMessage.pinned
                      ? "Сообщение откреплено"
                      : "Сообщение закреплено",
                  );
                }}
              >
                <Pin size={20} />
                <span>
                  {contextMessage.pinned ? "Открепить" : "Закрепить"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setContextMessageId(null);
                  setForwardMessageId(contextMessage.id);
                }}
              >
                <Forward size={20} />
                <span>Переслать</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {forwardMessage ? (
        <div
          className="sheet-backdrop forward-picker-backdrop"
          role="presentation"
          onClick={closeForwardPicker}
          onKeyDown={(event) => {
            if (event.key === "Escape") closeForwardPicker();
          }}
        >
          <div
            className="bottom-sheet forward-picker-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Переслать сообщение"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="sheet-handle" />
            <div className="sheet-title forward-picker-title">
              <span>
                <strong>Переслать</strong>
                <small>Выберите чат</small>
              </span>
              <button
                type="button"
                aria-label="Закрыть пересылку"
                onClick={closeForwardPicker}
                autoFocus
              >
                <X size={18} />
              </button>
            </div>

            <div className="forward-source-preview">
              <Forward size={17} />
              <span>
                <small>Пересылаемое сообщение</small>
                <strong>{getMessageSnippet(forwardMessage)}</strong>
              </span>
            </div>

            <label className="search-field panel-search forward-search">
              <Search size={18} />
              <input
                value={forwardQuery}
                onChange={(event) => setForwardQuery(event.target.value)}
                placeholder="Поиск чата"
                aria-label="Поиск чата для пересылки"
              />
              {forwardQuery ? (
                <button
                  type="button"
                  aria-label="Очистить поиск чатов"
                  onClick={() => setForwardQuery("")}
                >
                  <X size={15} />
                </button>
              ) : null}
            </label>

            <div className="forward-filter-strip" aria-label="Фильтр чатов">
              {defaultFilters.map((filter) => (
                <button
                  type="button"
                  key={filter}
                  className={forwardFilter === filter ? "is-active" : ""}
                  aria-pressed={forwardFilter === filter}
                  onClick={() => setForwardFilter(filter)}
                >
                  {filter}
                </button>
              ))}
            </div>

            <div className="forward-target-list">
              {visibleForwardChats.map((target) => (
                <button
                  type="button"
                  className="forward-target-row"
                  key={target.id}
                  aria-label={`Переслать в ${target.title}`}
                  onClick={() => {
                    const messageId = forwardMessage.id;
                    closeForwardPicker();
                    onForwardMessage(messageId, target.id);
                  }}
                >
                  <Avatar
                    label={target.avatar}
                    gradient={target.gradient}
                    online={target.online}
                  />
                  <span>
                    <strong>{target.title}</strong>
                    <small>{target.subtitle}</small>
                  </span>
                  <Forward size={18} />
                </button>
              ))}
              {!visibleForwardChats.length ? (
                <div className="panel-empty">
                  <Search size={22} />
                  <span>Чаты не найдены</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {activePanel ? (
        <div
          className="sheet-backdrop"
          role="presentation"
          onClick={closePanel}
          onKeyDown={(event) => {
            if (event.key === "Escape") closePanel();
          }}
        >
          <div
            className={`bottom-sheet chat-sheet chat-sheet-${activePanel}`}
            role="dialog"
            aria-modal="true"
            aria-label={chatPanelMeta[activePanel].dialogLabel}
            onClick={(event) => event.stopPropagation()}
          >
            <span className="sheet-handle" />
            <div className="sheet-title">
              <span className="sheet-title-main">
                {panelsReturningToMenu.includes(activePanel) ? (
                  <button
                    type="button"
                    className="sheet-back-button"
                    aria-label={
                      panelReturnTarget === "profile"
                        ? "Назад к профилю"
                        : "Назад к меню беседы"
                    }
                    onClick={() => {
                      setClearArmed(false);
                      setAddingParticipants(false);
                      setParticipantQuery("");
                      setSelectedParticipantIds([]);
                      setActivePanel(panelReturnTarget);
                    }}
                  >
                    <ChevronLeft size={18} />
                  </button>
                ) : null}
                <strong>{chatPanelMeta[activePanel].title}</strong>
              </span>
              <button
                type="button"
                aria-label="Закрыть"
                onClick={closePanel}
                autoFocus
              >
                <X size={18} />
              </button>
            </div>

            {activePanel === "attachments" ? (
              <div className="attachment-grid">
                {[
                  {
                    label: "Галерея",
                    description: "Фото и видео",
                    icon: ImageIcon,
                    className: "purple",
                    inputRef: galleryInputRef,
                  },
                  {
                    label: "Камера",
                    description: "Снять фото или видео",
                    icon: Camera,
                    className: "blue",
                    inputRef: cameraInputRef,
                  },
                  {
                    label: "Файл",
                    description: "Документ или архив",
                    icon: FileText,
                    className: "orange",
                    inputRef: fileInputRef,
                  },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      type="button"
                      key={item.label}
                      onClick={() => openAttachmentPicker(item.inputRef)}
                    >
                      <i className={item.className}>
                        <Icon size={23} />
                      </i>
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.description}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {activePanel === "emoji" ? (
              <>
                <div className="emoji-categories" aria-label="Категории эмодзи">
                  {emojiCategories.map((category) => (
                    <button
                      type="button"
                      key={category}
                      className={emojiCategory === category ? "is-active" : ""}
                      aria-pressed={emojiCategory === category}
                      onClick={() => setEmojiCategory(category)}
                    >
                      {category}
                    </button>
                  ))}
                </div>
                <div className="emoji-grid">
                  {emojiSets[emojiCategory].map((emoji) => (
                    <button
                      type="button"
                      key={emoji}
                      aria-label={`Добавить ${emoji}`}
                      onClick={() => {
                        setDraft((current) => `${current}${emoji}`);
                        closePanel();
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {activePanel === "profile" ? (
              <div className="conversation-profile">
                <div className="conversation-profile-hero">
                  <Avatar
                    label={profileUser?.avatar ?? chat.avatar}
                    gradient={profileUser?.gradient ?? chat.gradient}
                    imageUrl={profileUser?.avatarUrl}
                    size="hero"
                    online={profileUser?.online ?? chat.online}
                  />
                  <h2>{profileUser?.name ?? chat.title}</h2>
                  <span>
                    {profileUser
                      ? `@${profileUser.username}`
                      : "Корпоративная беседа"}
                  </span>
                  <small>
                    {profileUser?.position ?? conversationStatus}
                  </small>
                </div>

                {role === "employee" ? (
                  <div
                    className="employee-profile-actions"
                    aria-label="Действия с беседой"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setPanelReturnTarget("profile");
                        setMediaCategory("Файлы");
                        setActivePanel("media");
                      }}
                    >
                      <span className="tool-emoji">📄</span>
                      <strong>Файлы</strong>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPanelReturnTarget("profile");
                        setActivePanel("participants");
                      }}
                    >
                      <span className="tool-emoji">👥</span>
                      <strong>Участники</strong>
                    </button>
                  </div>
                ) : null}

                {profileUser ? (
                  <div className="conversation-contact-card">
                    <div>
                      <Mail size={18} />
                      <span>
                        <strong>{profileUser.email}</strong>
                        <small>Рабочая почта</small>
                      </span>
                    </div>
                    <div>
                      <Phone size={18} />
                      <span>
                        <strong>{profileUser.phone}</strong>
                        <small>Рабочий номер</small>
                      </span>
                    </div>
                  </div>
                ) : null}

                <div className="profile-section-heading">
                  <strong>Фото и видео</strong>
                  <button
                    type="button"
                    onClick={() => {
                      setPanelReturnTarget("profile");
                      setMediaCategory("Фото и видео");
                      setActivePanel("media");
                    }}
                  >
                    Показать все
                  </button>
                </div>
                <ConversationMediaGrid onOpen={openMediaPreview} />
              </div>
            ) : null}

            {activePanel === "participants" ? (
              <>
                {addingParticipants ? (
                  <div className="participant-picker">
                    <label className="search-field panel-search">
                      <Search size={18} />
                      <input
                        value={participantQuery}
                        onChange={(event) =>
                          setParticipantQuery(event.target.value)
                        }
                        placeholder="Найти контакт"
                        aria-label="Поиск контакта для добавления"
                        autoFocus
                      />
                      {participantQuery ? (
                        <button
                          type="button"
                          aria-label="Очистить поиск контактов"
                          onClick={() => setParticipantQuery("")}
                        >
                          <X size={15} />
                        </button>
                      ) : null}
                    </label>
                    <div className="participant-contact-list">
                      {availableParticipantContacts.map((person) => {
                        const selected = selectedParticipantIds.includes(
                          person.id,
                        );
                        return (
                          <button
                            type="button"
                            key={person.id}
                            className={selected ? "is-selected" : ""}
                            aria-pressed={selected}
                            onClick={() =>
                              toggleParticipantSelection(person.id)
                            }
                          >
                            <Avatar
                              label={person.avatar}
                              gradient={person.gradient}
                              imageUrl={person.avatarUrl}
                            />
                            <span>
                              <strong>{person.name}</strong>
                              <small>{person.position}</small>
                            </span>
                            <i>
                              {selected ? (
                                <CheckCheck size={16} />
                              ) : (
                                <Plus size={18} />
                              )}
                            </i>
                          </button>
                        );
                      })}
                      {!availableParticipantContacts.length ? (
                        <div className="panel-empty">
                          <Search size={22} />
                          <span>Подходящих контактов нет</span>
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="add-selected-participants"
                      disabled={!selectedParticipantIds.length}
                      onClick={confirmParticipants}
                    >
                      Добавить · {selectedParticipantIds.length}
                    </button>
                  </div>
                ) : (
                  <>
                    {chat.kind === "group" && !chat.deleted ? (
                      <button
                        type="button"
                        className="add-participant"
                        onClick={() => {
                          setParticipantsAdded(0);
                          setAddingParticipants(true);
                        }}
                      >
                        <span>➕</span>
                        <strong>Добавить участников</strong>
                      </button>
                    ) : null}
                    {participantsAdded ? (
                      <div className="participant-success" role="status">
                        <CheckCheck size={17} />
                        Добавлено участников: {participantsAdded}
                      </div>
                    ) : null}
                    <div className="participant-list">
                      {conversationMembers.map((participant) => (
                        <div
                          className="participant-row"
                          key={participant.id}
                        >
                          <Avatar
                            label={participant.avatar}
                            gradient={participant.gradient}
                            imageUrl={participant.avatarUrl}
                            online={participant.online}
                          />
                          <span className="participant-copy">
                            <strong>{participant.name}</strong>
                            <small>
                              {participant.id === "self"
                                ? `Вы · ${participant.position}`
                                : participant.online
                                  ? "В сети"
                                  : participant.position}
                            </small>
                          </span>
                          <button
                            type="button"
                            aria-label={`Написать: ${participant.name}`}
                            onClick={() => {
                              setDraft((current) =>
                                `${current}${current ? " " : ""}@${participant.name.split(" ")[0]} `,
                              );
                              closePanel();
                            }}
                          >
                            <MessageCircle size={18} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : null}

            {activePanel === "settings" ? (
              <div className="conversation-menu">
                <button
                  type="button"
                  className="conversation-menu-profile"
                  onClick={() => setActivePanel("profile")}
                >
                  <Avatar
                    label={profileUser?.avatar ?? chat.avatar}
                    gradient={profileUser?.gradient ?? chat.gradient}
                    imageUrl={profileUser?.avatarUrl}
                    size="large"
                    online={profileUser?.online ?? chat.online}
                  />
                  <span>
                    <strong>{profileUser?.name ?? chat.title}</strong>
                    <small>
                      {profileUser
                        ? `@${profileUser.username} · ${profileUser.position}`
                        : conversationStatus}
                    </small>
                  </span>
                  <ChevronRight size={18} />
                </button>

                <div
                  className={`conversation-quick-tools ${
                    role === "employee" ? "is-two-column" : ""
                  }`}
                  aria-label="Инструменты беседы"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setPanelReturnTarget("settings");
                      setMediaCategory("Файлы");
                      setActivePanel("media");
                    }}
                  >
                    <span className="tool-emoji">📄</span>
                    <strong>Файлы</strong>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPanelReturnTarget("settings");
                      setAddingParticipants(false);
                      setActivePanel("participants");
                    }}
                  >
                    <span className="tool-emoji">👥</span>
                    <strong>Участники</strong>
                  </button>
                  {canAuditChats(role) ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPanelReturnTarget("settings");
                        setActivePanel("search");
                      }}
                    >
                      <span className="tool-emoji">🔎</span>
                      <strong>Поиск</strong>
                    </button>
                  ) : null}
                </div>

                {chat.kind === "group" ? (
                  <section
                    className="settings-participants"
                    aria-labelledby="settings-participants-title"
                  >
                    <div className="settings-participants-heading">
                      <span>
                        <strong id="settings-participants-title">
                          Участники
                        </strong>
                        <small>{conversationStatus}</small>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setPanelReturnTarget("settings");
                          setAddingParticipants(false);
                          setActivePanel("participants");
                        }}
                      >
                        Управлять
                      </button>
                    </div>
                    <div
                      className="settings-participant-list"
                      aria-label={`Список участников: ${participantCountLabel}`}
                    >
                      {conversationMembers.map((participant) => (
                        <div
                          className="settings-participant-row"
                          key={participant.id}
                        >
                          <Avatar
                            label={participant.avatar}
                            gradient={participant.gradient}
                            imageUrl={participant.avatarUrl}
                            size="small"
                            online={participant.online}
                          />
                          <span>
                            <strong>{participant.name}</strong>
                            <small>
                              {participant.id === "self"
                                ? `Вы · ${participant.position}`
                                : participant.online
                                  ? "В сети"
                                  : participant.position}
                            </small>
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {chat.deleted ? (
                  <div className="deleted-settings-note">
                    <Trash2 size={18} />
                    <span>
                      <strong>Режим просмотра</strong>
                      <small>
                        Удалённый чат нельзя изменить или очистить
                      </small>
                    </span>
                  </div>
                ) : (
                  <>
                    <span className="conversation-settings-label">
                      НАСТРОЙКИ БЕСЕДЫ
                    </span>
                    <div className="conversation-settings">
                  <button
                    type="button"
                    aria-pressed={!chat.muted}
                    onClick={onToggleMute}
                  >
                    <span className="tool-emoji">🔔</span>
                    <span>
                      <strong>Уведомления</strong>
                      <small>Звук и отметки новых сообщений</small>
                    </span>
                    <span
                      className={`ios-switch ${
                        !chat.muted ? "is-on" : ""
                      }`}
                      aria-hidden="true"
                    >
                      <i />
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={joinApproval}
                    onClick={() => setJoinApproval((current) => !current)}
                  >
                    <span className="tool-emoji">🛡️</span>
                    <span>
                      <strong>Одобрение участников</strong>
                      <small>Новые участники только по заявке</small>
                    </span>
                    <span
                      className={`ios-switch ${joinApproval ? "is-on" : ""}`}
                      aria-hidden="true"
                    >
                      <i />
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={chatPatternEnabled}
                    onClick={() =>
                      setChatPatternEnabled((current) => !current)
                    }
                  >
                    <span className="tool-emoji">🖼️</span>
                    <span>
                      <strong>Фон переписки</strong>
                      <small>
                        {chatPatternEnabled
                          ? "Фирменный узор CIFRA"
                          : "Однотонный фон"}
                      </small>
                    </span>
                    <span
                      className={`ios-switch ${
                        chatPatternEnabled ? "is-on" : ""
                      }`}
                      aria-hidden="true"
                    >
                      <i />
                    </span>
                  </button>
                  {!chat.deleted ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (chat.archived) {
                          onUnarchive();
                        } else {
                          onArchive();
                        }
                        closePanel();
                        onBack();
                      }}
                    >
                      <span className="tool-emoji">
                        {chat.archived ? "↩️" : "🗄️"}
                      </span>
                      <span>
                        <strong>
                          {chat.archived
                            ? "Вернуть из архива"
                            : "Перенести в архив"}
                        </strong>
                        <small>
                          {chat.archived
                            ? "Чат снова появится в общем списке"
                            : "Чат переместится в раздел «Архив»"}
                        </small>
                      </span>
                      {chat.archived ? (
                        <ArchiveRestore size={17} />
                      ) : (
                        <Archive size={17} />
                      )}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={clearArmed ? "is-danger-armed" : ""}
                    onClick={() => {
                      if (clearArmed) {
                        onClear();
                        setClearArmed(false);
                        closePanel();
                      } else {
                        setClearArmed(true);
                      }
                    }}
                  >
                    <span className="tool-emoji">🧹</span>
                    <span>
                      <strong>Очистить историю</strong>
                      <small>
                        {clearArmed
                          ? "Нажмите ещё раз для подтверждения"
                          : "Сообщения и локальные файлы"}
                      </small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                  {!chat.deleted ? (
                    <button
                      type="button"
                      className="conversation-delete-button"
                      onClick={() => {
                        setActivePanel(null);
                        setDeleteConfirmOpen(true);
                      }}
                    >
                      <span className="tool-emoji">🗑️</span>
                      <span>
                        <strong>Удалить чат</strong>
                        <small>Потребуется подтверждение</small>
                      </span>
                      <Trash2 size={17} />
                    </button>
                  ) : null}
                    </div>
                  </>
                )}

                <div className="conversation-shared-content">
                  <div className="conversation-content-tabs">
                    <button
                      type="button"
                      className={
                        settingsContentTab === "media" ? "is-active" : ""
                      }
                      aria-pressed={settingsContentTab === "media"}
                      onClick={() => setSettingsContentTab("media")}
                    >
                      Фото и видео
                    </button>
                    <button
                      type="button"
                      className={
                        settingsContentTab === "files" ? "is-active" : ""
                      }
                      aria-pressed={settingsContentTab === "files"}
                      onClick={() => setSettingsContentTab("files")}
                    >
                      Файлы
                    </button>
                  </div>
                  {settingsContentTab === "media" ? (
                    <ConversationMediaGrid
                      limit={9}
                      onOpen={openMediaPreview}
                    />
                  ) : (
                    <div className="profile-file-list">
                      {[
                        ["📄", "CIFRA_UI.pdf", "8,4 МБ · сегодня"],
                        ["🧩", "Навигация.fig", "12,1 МБ · вчера"],
                        ["📊", "План_релиза.xlsx", "2,6 МБ · вчера"],
                      ].map(([emoji, name, meta]) => (
                        <button
                          type="button"
                          key={name}
                          onClick={() =>
                            setPreviewContent({
                              title: name,
                              subtitle: meta,
                              kind: "file",
                            })
                          }
                        >
                          <span className="tool-emoji">{emoji}</span>
                          <span>
                            <strong>{name}</strong>
                            <small>{meta}</small>
                          </span>
                          <ChevronRight size={17} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {activePanel === "pinned" ? (
              <div className="pinned-list">
                {pinnedMessages.map((message, index) => (
                  <button
                    type="button"
                    className="pinned-item"
                    key={message.id}
                    onClick={() => jumpToMessage(message.id)}
                  >
                    <span className="tool-emoji">
                      {index === 0 ? "📌" : "✅"}
                    </span>
                    <span>
                      <strong>
                        {message.text ??
                          `Голосовое сообщение · ${message.voice}`}
                      </strong>
                      <small>
                        {getMessageAuthorLabel(message)} · сегодня,{" "}
                        {message.time}
                      </small>
                    </span>
                    <ChevronRight size={17} />
                  </button>
                ))}
              </div>
            ) : null}

            {activePanel === "media" ? (
              <div className="media-panel">
                <div className="media-tabs" aria-label="Тип вложений">
                  {mediaCategories.map((category) => (
                    <button
                      type="button"
                      key={category}
                      className={mediaCategory === category ? "is-active" : ""}
                      aria-pressed={mediaCategory === category}
                      onClick={() => setMediaCategory(category)}
                    >
                      {category}
                    </button>
                  ))}
                </div>
                {mediaCategory === "Фото и видео" ? (
                  <ConversationMediaGrid onOpen={openMediaPreview} />
                ) : (
                  <div className="media-file-list">
                    {[
                      "CIFRA_UI.pdf",
                      "Навигация.fig",
                      "План_релиза.xlsx",
                      "Требования.docx",
                    ].map((item) => (
                      <button
                        type="button"
                        key={item}
                        onClick={() =>
                          setPreviewContent({
                            title: item,
                            subtitle: "Файл из переписки",
                            kind: "file",
                          })
                        }
                      >
                        <span className="tool-emoji">📄</span>
                        <span>
                          <strong>{item}</strong>
                          <small>Добавлено сегодня</small>
                        </span>
                        <ChevronRight size={17} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {activePanel === "search" ? (
              <div className="message-search-panel">
                <label className="search-field panel-search">
                  <Search size={18} />
                  <input
                    value={messageSearch}
                    onChange={(event) => setMessageSearch(event.target.value)}
                    placeholder="Сообщение или автор"
                    aria-label="Поиск по сообщениям"
                  />
                </label>
                <div className="message-search-results" aria-live="polite">
                  {matchingMessages.length ? (
                    matchingMessages.map((message) => (
                      <button
                        type="button"
                        key={message.id}
                        onClick={() => jumpToMessage(message.id)}
                      >
                        <span>
                          <strong>{message.author ?? "Вы"}</strong>
                          <small>{message.time}</small>
                        </span>
                        <p>{message.text ?? `Голосовое сообщение · ${message.voice}`}</p>
                      </button>
                    ))
                  ) : (
                    <div className="panel-empty">
                      <Search size={22} />
                      <span>Совпадений нет</span>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {deleteConfirmOpen ? (
        <ConfirmDialog
          title="Вы действительно хотите удалить чат?"
          description={`Переписка «${chat.title}» исчезнет из списка. Администратор сможет просмотреть её в разделе «Удалённые».`}
          onCancel={() => setDeleteConfirmOpen(false)}
          onConfirm={() => {
            setDeleteConfirmOpen(false);
            onDelete();
            onBack();
          }}
        />
      ) : null}

      {previewContent ? (
        <ContentPreview
          content={previewContent}
          onClose={() => setPreviewContent(null)}
        />
      ) : null}
    </section>
  );
}

function TeamsView({
  users,
  role,
  onMessage,
  onOpenUser,
}: {
  users: MessengerUser[];
  role: UserRole;
  onMessage: (id: string) => void;
  onOpenUser: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [organizationOpen, setOrganizationOpen] = useState(false);
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const visibleUsers = users.filter(
    (user) =>
      user.id !== "self" &&
      (!normalizedQuery ||
        `${user.name} ${user.position}`
          .toLocaleLowerCase("ru")
          .includes(normalizedQuery)),
  );

  return (
    <section className="view">
      <header className="large-header">
        <div>
          <h1>Сотрудники</h1>
        </div>
        <span className={`access-chip access-chip-${role}`}>
          {role === "employee" ? (
            <UserRound size={14} />
          ) : (
            <ShieldCheck size={14} />
          )}
          {roleShortName(role)}
        </span>
      </header>

      <div className="scroll-area team-scroll">
        <button
          type="button"
          className="workspace-card"
          disabled={role === "employee"}
          aria-label={
            role !== "employee"
              ? `Открыть контакты организации CIFRA. ${users.length} контактов`
              : `Организация CIFRA. ${users.length} контактов`
          }
          onClick={() => setOrganizationOpen(true)}
        >
          <span className="workspace-mark">C</span>
          <div>
            <small>ВАША ОРГАНИЗАЦИЯ</small>
            <strong>CIFRA</strong>
            <span>{users.length} контактов · корпоративное пространство</span>
          </div>
          {role !== "employee" ? (
            <ChevronRight size={22} />
          ) : (
            <ShieldCheck size={22} />
          )}
        </button>

        <label className="search-field team-search-field">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найти сотрудника"
            aria-label="Найти сотрудника"
          />
          {query ? (
            <button
              type="button"
              aria-label="Очистить поиск сотрудников"
              onClick={() => setQuery("")}
            >
              <X size={15} />
            </button>
          ) : null}
        </label>

        <div className="section-heading">
          <strong>Сотрудники</strong>
        </div>

        <div className="people-list">
          {visibleUsers.map((person) => (
            <button
              type="button"
              className="person-row"
              key={person.id}
              onClick={() =>
                role !== "employee"
                  ? onOpenUser(person.id)
                  : onMessage(person.id)
              }
              aria-label={
                role !== "employee"
                  ? `Открыть профиль: ${person.name}`
                  : `Написать: ${person.name}`
              }
            >
              <Avatar
                label={person.avatar}
                gradient={person.gradient}
                imageUrl={person.avatarUrl}
                online={person.online}
              />
              <span>
                <strong>{person.name}</strong>
                <small>
                  {person.position} · {person.online ? "в сети" : "не в сети"}
                </small>
              </span>
              {role !== "employee" ? (
                <ChevronRight size={19} />
              ) : (
                <MessageCircle size={19} />
              )}
            </button>
          ))}
          {!visibleUsers.length ? (
            <div className="panel-empty">
              <Search size={22} />
              <span>Сотрудники не найдены</span>
            </div>
          ) : null}
        </div>
      </div>

      {organizationOpen && role !== "employee" ? (
        <div
          className="sheet-backdrop"
          role="presentation"
          onClick={() => setOrganizationOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOrganizationOpen(false);
          }}
        >
          <div
            className="bottom-sheet organization-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Контакты организации CIFRA"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="sheet-handle" />
            <div className="sheet-title">
              <span>
                <strong>Ваша организация</strong>
                <small>{users.length} контактов в CIFRA</small>
              </span>
              <button
                type="button"
                aria-label="Закрыть"
                onClick={() => setOrganizationOpen(false)}
                autoFocus
              >
                <X size={18} />
              </button>
            </div>
            <div className="organization-contact-list">
              {users.map((person) => (
                <button
                  type="button"
                  key={person.id}
                  onClick={() => {
                    setOrganizationOpen(false);
                    onOpenUser(person.id);
                  }}
                  aria-label={`Открыть профиль: ${person.name}`}
                >
                  <Avatar
                    label={person.avatar}
                    gradient={person.gradient}
                    imageUrl={person.avatarUrl}
                    online={person.online}
                  />
                  <span>
                    <strong>{person.name}</strong>
                    <small>
                      {person.position} · {person.email}
                    </small>
                  </span>
                  <ChevronRight size={18} />
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function CallsView({
  calls,
  users,
  onCall,
}: {
  calls: CallRecord[];
  users: MessengerUser[];
  onCall: (participantIds: string[]) => void;
}) {
  const [groupCallOpen, setGroupCallOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<
    string[]
  >([]);
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const visibleContacts = users.filter(
    (user) =>
      user.id !== "self" &&
      (!normalizedQuery ||
        `${user.name} ${user.position}`
          .toLocaleLowerCase("ru")
          .includes(normalizedQuery)),
  );

  const toggleParticipant = (id: string) => {
    setSelectedParticipantIds((current) =>
      current.includes(id)
        ? current.filter((participantId) => participantId !== id)
        : [...current, id],
    );
  };

  const closeGroupCall = () => {
    setGroupCallOpen(false);
    setQuery("");
    setSelectedParticipantIds([]);
  };

  return (
    <section className="view">
      <header className="large-header">
        <div>
          <h1>Звонки</h1>
        </div>
      </header>

      <button
        type="button"
        className="call-link-card group-call-entry"
        aria-expanded={groupCallOpen}
        onClick={() => setGroupCallOpen(true)}
      >
        <span>
          <UsersRound size={21} />
        </span>
        <div>
          <strong>Групповой звонок</strong>
          <small>Выберите участников из контактов</small>
        </div>
        <ChevronRight size={17} />
      </button>

      <div className="section-heading calls-heading">
        <strong>Недавние</strong>
      </div>

      <div className="scroll-area call-list">
        {calls.map((call, index) => (
          <button
            type="button"
            className="call-row"
            key={`${call.type}-${call.name}-${call.detail}-${index}`}
            onClick={() => onCall(call.participantIds)}
            aria-label={`Позвонить: ${call.name}`}
          >
            <Avatar label={call.avatar} gradient={call.gradient} />
            <span className="call-copy">
              <strong className={call.type === "missed" ? "missed" : ""}>
                {call.name}
              </strong>
              <small>
                {call.type === "in" ? (
                  <PhoneIncoming size={14} />
                ) : call.type === "missed" ? (
                  <PhoneMissed size={14} />
                ) : (
                  <PhoneOutgoing size={14} />
                )}
                {call.detail}
              </small>
            </span>
            <span className="info-button" aria-hidden="true">
              <Phone size={18} />
            </span>
          </button>
        ))}
      </div>

      {groupCallOpen ? (
        <div
          className="sheet-backdrop"
          role="presentation"
          onClick={closeGroupCall}
          onKeyDown={(event) => {
            if (event.key === "Escape") closeGroupCall();
          }}
        >
          <div
            className="bottom-sheet group-call-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Выбор участников группового звонка"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="sheet-handle" />
            <div className="sheet-title">
              <span>
                <strong>Групповой звонок</strong>
                <small>
                  {selectedParticipantIds.length
                    ? `Выбрано: ${selectedParticipantIds.length}`
                    : "Выберите минимум двух участников"}
                </small>
              </span>
              <button
                type="button"
                aria-label="Закрыть"
                onClick={closeGroupCall}
              >
                <X size={18} />
              </button>
            </div>

            <label className="search-field compact-search group-call-search">
              <Search size={17} />
              <input
                value={query}
                placeholder="Найти участника"
                aria-label="Поиск участника звонка"
                onChange={(event) => setQuery(event.target.value)}
                autoFocus
              />
              {query ? (
                <button
                  type="button"
                  aria-label="Очистить поиск участников"
                  onClick={() => setQuery("")}
                >
                  <X size={15} />
                </button>
              ) : null}
            </label>

            {selectedParticipantIds.length ? (
              <div
                className="group-call-selected"
                aria-label="Выбранные участники"
              >
                {selectedParticipantIds.map((id) => {
                  const person = users.find((user) => user.id === id);
                  if (!person) return null;
                  return (
                    <button
                      type="button"
                      key={id}
                      aria-label={`Убрать участника: ${person.name}`}
                      onClick={() => toggleParticipant(id)}
                    >
                      <Avatar
                        label={person.avatar}
                        gradient={person.gradient}
                        imageUrl={person.avatarUrl}
                        size="small"
                      />
                      <small>{person.name.split(" ")[0]}</small>
                      <X size={12} />
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="group-call-contact-list">
              {visibleContacts.map((person) => {
                const selected = selectedParticipantIds.includes(person.id);
                return (
                  <button
                    type="button"
                    key={person.id}
                    className={selected ? "is-selected" : ""}
                    aria-pressed={selected}
                    onClick={() => toggleParticipant(person.id)}
                  >
                    <Avatar
                      label={person.avatar}
                      gradient={person.gradient}
                      imageUrl={person.avatarUrl}
                    />
                    <span>
                      <strong>{person.name}</strong>
                      <small>
                        {person.online ? "В сети" : person.position}
                      </small>
                    </span>
                    <i>
                      {selected ? (
                        <CheckCheck size={17} />
                      ) : (
                        <Plus size={19} />
                      )}
                    </i>
                  </button>
                );
              })}
              {!visibleContacts.length ? (
                <div className="panel-empty">
                  <Search size={22} />
                  <span>Контакты не найдены</span>
                </div>
              ) : null}
            </div>

            <button
              type="button"
              className="create-call-button"
              disabled={selectedParticipantIds.length < 2}
              onClick={() => {
                onCall(selectedParticipantIds);
                closeGroupCall();
              }}
            >
              <Phone size={18} />
              Создать звонок
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ProfileView({
  user,
  role,
  theme,
  notificationMode,
  authMode,
  onRoleChange,
  onThemeChange,
  onNotificationModeChange,
  onEditProfile,
  onAvatarChange,
  onLogout,
}: {
  user: MessengerUser;
  role: UserRole;
  theme: Theme;
  notificationMode: NotificationMode;
  authMode: RuntimeMode;
  onRoleChange: (role: UserRole) => void;
  onThemeChange: (theme: Theme) => void;
  onNotificationModeChange: (mode: NotificationMode) => void;
  onEditProfile: () => void;
  onAvatarChange: (avatarUrl: string) => void;
  onLogout: () => void;
}) {
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [activePanel, setActivePanel] = useState<ProfilePanel>(null);
  const [storageTab, setStorageTab] = useState<"media" | "files">("media");
  const [previewContent, setPreviewContent] =
    useState<PreviewContent | null>(null);

  const notificationStatus =
    notificationMode === "on"
      ? "Включены для всех чатов"
      : notificationMode === "hour"
        ? "Отключены на 1 час"
        : "Отключены";
  const currentTheme =
    themeOptions.find((option) => option.id === theme) ?? themeOptions[0];

  const handleAvatarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.currentTarget.files ?? []);
    if (!file) return;
    onAvatarChange(URL.createObjectURL(file));
    event.currentTarget.value = "";
  };

  return (
    <section className="view profile-view">
      <header className="profile-nav">
        <span>Профиль</span>
        <button
          type="button"
          aria-label={
            role === "admin" ? "Изменить данные профиля" : "Изменить аватар"
          }
          onClick={() =>
            role === "admin"
              ? onEditProfile()
              : avatarInputRef.current?.click()
          }
        >
          {role === "admin" ? "Изменить данные" : "Изменить аватар"}
        </button>
      </header>

      <div className="scroll-area profile-scroll">
        <input
          ref={avatarInputRef}
          hidden
          type="file"
          accept="image/*"
          onChange={handleAvatarChange}
        />

        <div
          className={`role-preview ${
            authMode === "backend" ? "role-preview-readonly" : ""
          }`}
          aria-label={
            authMode === "demo"
              ? "Демо роли пользователя"
              : "Роль пользователя"
          }
        >
          <span>
            <strong>
              {authMode === "demo" ? "Демо доступа" : "Доступ организации"}
            </strong>
            <small>
              {authMode === "demo"
                ? "Переключатель только для проверки прототипа"
                : "Роль назначена сервером и не меняется в профиле"}
            </small>
          </span>
          <div role="group" aria-label="Выбрать роль">
            <button
              type="button"
              className={role === "admin" ? "is-active" : ""}
              aria-pressed={role === "admin"}
              onClick={() => onRoleChange("admin")}
              disabled={authMode === "backend"}
            >
              Админ
            </button>
            <button
              type="button"
              className={role === "moderator" ? "is-active" : ""}
              aria-pressed={role === "moderator"}
              onClick={() => onRoleChange("moderator")}
              disabled={authMode === "backend"}
            >
              Модератор
            </button>
            <button
              type="button"
              className={role === "employee" ? "is-active" : ""}
              aria-pressed={role === "employee"}
              onClick={() => onRoleChange("employee")}
              disabled={authMode === "backend"}
            >
              Сотрудник
            </button>
          </div>
        </div>

        <div className="profile-hero">
          <Avatar
            label={user.avatar}
            gradient={user.gradient}
            imageUrl={user.avatarUrl}
            size="hero"
            online
          />
          <h1>{user.name}</h1>
          <span className={`role-badge role-badge-${role}`}>
            {role === "employee" ? (
              <UserRound size={14} />
            ) : (
              <ShieldCheck size={14} />
            )}
            {roleDisplayName(role)}
          </span>
          <small>в сети</small>
        </div>

        <div className="profile-card identity-card">
          <div>
            <AtSign size={19} />
            <span>
              <strong>@{user.username}</strong>
              <small>Имя пользователя</small>
            </span>
          </div>
          <div>
            <Mail size={19} />
            <span>
              <strong>{user.email}</strong>
              <small>Рабочая почта</small>
            </span>
          </div>
          <div>
            <Phone size={19} />
            <span>
              <strong>{user.phone}</strong>
              <small>Рабочий номер</small>
            </span>
          </div>
        </div>

        {role !== "admin" ? (
          <div className="profile-lock-note">
            <ShieldCheck size={18} />
            <span>
              <strong>Данные защищены ролью</strong>
              <small>
                {role === "moderator"
                  ? "Модератор работает с аудитом без изменения сотрудников"
                  : "Сотрудник может изменить только свою аватарку"}
              </small>
            </span>
          </div>
        ) : null}

        <span className="settings-label">НАСТРОЙКИ</span>
        <div className="profile-card settings-card">
          <button
            type="button"
            aria-expanded={activePanel === "notifications"}
            onClick={() => setActivePanel("notifications")}
          >
            <i className="notification-blue">
              <Bell size={18} />
            </i>
            <span className="setting-copy">
              <strong>Уведомления</strong>
              <small>{notificationStatus}</small>
            </span>
            <ChevronRight size={17} />
          </button>
          <button
            type="button"
            aria-expanded={activePanel === "storage"}
            onClick={() => setActivePanel("storage")}
          >
            <i className="purple">
              <Settings2 size={18} />
            </i>
            <span className="setting-copy">
              <strong>Данные и память</strong>
              <small>Медиа и файлы на устройстве</small>
            </span>
            <ChevronRight size={17} />
          </button>
        </div>

        <span className="settings-label">ТЕМА ОФОРМЛЕНИЯ</span>
        <div className="profile-card settings-card theme-settings-card">
          <button
            type="button"
            aria-expanded={activePanel === "theme"}
            onClick={() => setActivePanel("theme")}
          >
            <span
              className={`theme-preview theme-preview-${currentTheme.id}`}
              aria-hidden="true"
            >
              {currentTheme.symbol}
            </span>
            <span className="setting-copy">
              <strong>Выбрать тему</strong>
              <small>{currentTheme.title}</small>
            </span>
            <ChevronRight size={17} />
          </button>
        </div>

        <button type="button" className="logout-button" onClick={onLogout}>
          <LogOut size={18} />
          Выйти
        </button>
      </div>

      {activePanel ? (
        <div
          className="sheet-backdrop"
          role="presentation"
          onClick={() => setActivePanel(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setActivePanel(null);
          }}
        >
          <div
            className="bottom-sheet profile-settings-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={
              activePanel === "notifications"
                ? "Настройки уведомлений"
                : activePanel === "storage"
                  ? "Данные и память"
                  : "Тема оформления"
            }
            onClick={(event) => event.stopPropagation()}
          >
            <span className="sheet-handle" />
            <div className="sheet-title">
              <strong>
                {activePanel === "notifications"
                  ? "Уведомления"
                  : activePanel === "storage"
                    ? "Данные и память"
                    : "Тема оформления"}
              </strong>
              <button
                type="button"
                aria-label="Закрыть"
                onClick={() => setActivePanel(null)}
                autoFocus
              >
                <X size={18} />
              </button>
            </div>

            {activePanel === "notifications" ? (
              <div className="notification-options">
                {[
                  {
                    id: "on" as NotificationMode,
                    icon: "🔔",
                    title: "Включить уведомления",
                    description: "Все чаты, группы и звонки",
                  },
                  {
                    id: "hour" as NotificationMode,
                    icon: "🕐",
                    title: "Отключить все на 1 час",
                    description: "Включатся автоматически через час",
                  },
                  {
                    id: "off" as NotificationMode,
                    icon: "🔕",
                    title: "Отключить все",
                    description: "До ручного включения",
                  },
                ].map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    className={
                      notificationMode === option.id ? "is-selected" : ""
                    }
                    aria-pressed={notificationMode === option.id}
                    onClick={() => onNotificationModeChange(option.id)}
                  >
                    <span className="tool-emoji">{option.icon}</span>
                    <span>
                      <strong>{option.title}</strong>
                      <small>{option.description}</small>
                    </span>
                    <i>
                      {notificationMode === option.id ? (
                        <CheckCheck size={15} />
                      ) : null}
                    </i>
                  </button>
                ))}
              </div>
            ) : activePanel === "storage" ? (
              <div className="storage-panel">
                <div className="storage-summary">
                  <span className="tool-emoji">📱</span>
                  <span>
                    <strong>156 МБ на устройстве</strong>
                    <small>18 медиафайлов · 6 документов</small>
                  </span>
                </div>
                <div className="storage-tabs" aria-label="Тип сохранённых данных">
                  <button
                    type="button"
                    className={storageTab === "media" ? "is-active" : ""}
                    aria-pressed={storageTab === "media"}
                    onClick={() => setStorageTab("media")}
                  >
                    Медиафайлы
                  </button>
                  <button
                    type="button"
                    className={storageTab === "files" ? "is-active" : ""}
                    aria-pressed={storageTab === "files"}
                    onClick={() => setStorageTab("files")}
                  >
                    Файлы
                  </button>
                </div>
                {storageTab === "media" ? (
                  <div className="storage-media-grid">
                    {[
                      ["Главный экран", "24,8 МБ"],
                      ["Компоненты", "18,2 МБ"],
                      ["Фото команды", "12,7 МБ"],
                      ["Видеокружок", "31,4 МБ"],
                    ].map(([name, size], index) => (
                      <button
                        type="button"
                        key={name}
                        onClick={() =>
                          setPreviewContent({
                            title: name,
                            subtitle: `${size} · сохранено на устройство`,
                            kind: name === "Видеокружок" ? "video" : "image",
                            tone: conversationMediaItems[index]?.tone,
                          })
                        }
                      >
                        <ImageIcon size={23} />
                        <span>
                          <strong>{name}</strong>
                          <small>{size}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="storage-file-list">
                    {[
                      ["📄", "CIFRA_UI.pdf", "8,4 МБ"],
                      ["🧩", "Навигация.fig", "12,1 МБ"],
                      ["📊", "План_релиза.xlsx", "2,6 МБ"],
                      ["📎", "Требования.docx", "1,9 МБ"],
                    ].map(([icon, name, size]) => (
                      <button
                        type="button"
                        key={name}
                        onClick={() =>
                          setPreviewContent({
                            title: name,
                            subtitle: `${size} · сохранено на устройство`,
                            kind: "file",
                          })
                        }
                      >
                        <span className="tool-emoji">{icon}</span>
                        <span>
                          <strong>{name}</strong>
                          <small>{size} · сохранено на устройство</small>
                        </span>
                        <ChevronRight size={17} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div
                className="theme-picker theme-sheet-picker"
                aria-label="Выбор темы оформления"
              >
                {themeOptions.map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    className={`theme-option-${option.id} ${
                      theme === option.id ? "is-active" : ""
                    }`}
                    aria-pressed={theme === option.id}
                    onClick={() => {
                      onThemeChange(option.id);
                      setActivePanel(null);
                    }}
                  >
                    <span
                      className={`theme-preview theme-preview-${option.id}`}
                      aria-hidden="true"
                    >
                      {option.symbol}
                    </span>
                    <span>
                      <strong>{option.title}</strong>
                      <small>{option.description}</small>
                    </span>
                    <i />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {previewContent ? (
        <ContentPreview
          content={previewContent}
          onClose={() => setPreviewContent(null)}
        />
      ) : null}
    </section>
  );
}

function AdminUserSheet({
  user,
  readOnly,
  onClose,
  onSave,
  onMessage,
  onCall,
  onAudit,
  onDelete,
}: {
  user: MessengerUser;
  readOnly: boolean;
  onClose: () => void;
  onSave: (user: MessengerUser) => void | Promise<void>;
  onMessage: (id: string) => void;
  onCall: (id: string) => void;
  onAudit: (user: MessengerUser) => void;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<MessengerUser>(user);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const normalizedDraft: MessengerUser = {
    ...draft,
    name: draft.name.trim(),
    email: draft.email.trim(),
    username: draft.username.trim().replace(/^@+/, ""),
    phone: draft.phone.trim(),
  };
  const canSave =
    normalizedDraft.name.length >= 2 &&
    (!normalizedDraft.email ||
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedDraft.email)) &&
    normalizedDraft.username.length >= 2 &&
    (!normalizedDraft.phone || normalizedDraft.phone.length >= 7);

  const updateField = (
    field: "name" | "email" | "username" | "phone",
    value: string,
  ) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const handleAvatarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.currentTarget.files ?? []);
    if (!file) return;
    setDraft((current) => ({
      ...current,
      avatarUrl: URL.createObjectURL(file),
    }));
    event.currentTarget.value = "";
  };

  return (
    <div
      className="sheet-backdrop"
      role="presentation"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div
        className="bottom-sheet admin-user-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${readOnly ? "Просмотреть" : "Редактировать"} профиль: ${user.name}`}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="sheet-handle" />
        <div className="sheet-title">
          <span className="sheet-title-main">
            <UserRoundCog size={19} />
            <strong>Профиль сотрудника</strong>
          </span>
          <button type="button" aria-label="Закрыть" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="admin-profile-hero">
          <Avatar
            label={draft.avatar}
            gradient={draft.gradient}
            imageUrl={draft.avatarUrl}
            size="large"
            online={draft.online}
          />
          <span>
            <strong>{draft.name}</strong>
            <small>{draft.position}</small>
          </span>
          {!readOnly ? (
            <>
              <button
                type="button"
                className="avatar-edit-button"
                aria-label="Изменить аватар сотрудника"
                onClick={() => avatarInputRef.current?.click()}
              >
                <Camera size={18} />
              </button>
              <input
                ref={avatarInputRef}
                hidden
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
              />
            </>
          ) : null}
        </div>

        {user.id !== "self" ? (
          <div
            className="admin-contact-actions"
            aria-label="Связаться с сотрудником"
          >
            <button
              type="button"
              onClick={() => onMessage(user.id)}
              aria-label={`Написать: ${user.name}`}
            >
              <MessageCircle size={19} />
              <span>
                <strong>Написать</strong>
                <small>Открыть личный чат</small>
              </span>
            </button>
            <button
              type="button"
              onClick={() => onCall(user.id)}
              aria-label={`Позвонить: ${user.name}`}
            >
              <Phone size={19} />
              <span>
                <strong>Позвонить</strong>
                <small>Начать звонок</small>
              </span>
            </button>
          </div>
        ) : null}

        <div className="profile-editor-fields">
          <label>
            <span>Имя</span>
            <input
              value={draft.name}
              onChange={(event) => updateField("name", event.target.value)}
              disabled={readOnly}
              autoFocus
            />
          </label>
          <label>
            <span>Рабочая почта</span>
            <input
              type="email"
              value={draft.email}
              onChange={(event) => updateField("email", event.target.value)}
              disabled={readOnly}
            />
          </label>
          <label>
            <span>Логин</span>
            <input
              value={draft.username}
              onChange={(event) => updateField("username", event.target.value)}
              disabled={readOnly || Boolean(user.backendId)}
            />
          </label>
          <label>
            <span>Телефон</span>
            <input
              type="tel"
              value={draft.phone}
              onChange={(event) => updateField("phone", event.target.value)}
              disabled={readOnly}
            />
          </label>
        </div>

        <div className="admin-role-picker">
          <span>
            <strong>Роль сотрудника</strong>
            <small>
              {readOnly
                ? "Модератор видит назначение без права изменения"
                : "Изменение роли фиксируется сервером в журнале аудита"}
            </small>
          </span>
          <div role="group" aria-label="Назначить роль сотрудника">
            {(["employee", "moderator", "admin"] as const).map(
              (availableRole) => (
                <button
                  type="button"
                  key={availableRole}
                  className={
                    draft.role === availableRole ? "is-active" : ""
                  }
                  aria-pressed={draft.role === availableRole}
                  disabled={readOnly || user.id === "self"}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      role: availableRole,
                    }))
                  }
                >
                  {roleShortName(availableRole)}
                </button>
              ),
            )}
          </div>
        </div>

        <div className="admin-actions">
          {!readOnly ? (
            <button
              type="button"
              className="save-profile-button"
              disabled={!canSave || saving}
              onClick={async () => {
                setSaving(true);
                setSaveError("");
                try {
                  await onSave(normalizedDraft);
                } catch (error) {
                  setSaveError(authErrorMessage(error));
                } finally {
                  setSaving(false);
                }
              }}
            >
              <CheckCheck size={18} />
              {saving ? "Сохранение…" : "Сохранить изменения"}
            </button>
          ) : null}
          {saveError ? (
            <p className="admin-save-error" role="alert">
              {saveError}
            </p>
          ) : null}
          {user.id !== "self" ? (
            <>
              <button
                type="button"
                className="audit-entry-button"
                onClick={() => onAudit(user)}
              >
                <Eye size={18} />
                <span>
                  <strong>Открыть переписки — режим аудита</strong>
                  <small>Только чтение · действие попадёт в журнал</small>
                </span>
                <ChevronRight size={17} />
              </button>
              {!readOnly ? (
                <button
                  type="button"
                  className="delete-contact-button"
                  onClick={() => setDeleteConfirmOpen(true)}
                >
                  <Trash2 size={18} />
                  Удалить контакт
                </button>
              ) : null}
            </>
          ) : null}
        </div>

        {deleteConfirmOpen && !readOnly ? (
          <ConfirmDialog
            title="Вы действительно хотите удалить контакт?"
            description={`Контакт «${draft.name}» будет удалён из организации CIFRA.`}
            onCancel={() => setDeleteConfirmOpen(false)}
            onConfirm={async () => {
              setSaveError("");
              try {
                await onDelete(user.id);
                setDeleteConfirmOpen(false);
              } catch (error) {
                setDeleteConfirmOpen(false);
                setSaveError(authErrorMessage(error));
              }
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function AuditOverlay({
  user,
  viewerRole,
  chats,
  messagesByChat,
  onClose,
}: {
  user: MessengerUser;
  viewerRole: UserRole;
  chats: Chat[];
  messagesByChat: Record<string, Message[]>;
  onClose: () => void;
}) {
  const [selectedAuditChatId, setSelectedAuditChatId] = useState<string | null>(
    null,
  );
  const selectedAuditChat = chats.find(
    (chat) => chat.id === selectedAuditChatId,
  );
  const selectedAuditMessages = selectedAuditChatId
    ? (messagesByChat[selectedAuditChatId] ?? [])
    : [];

  return (
    <div
      className="audit-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Режим аудита: ${user.name}`}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        if (selectedAuditChat) setSelectedAuditChatId(null);
        else onClose();
      }}
    >
      <header className="audit-header">
        {selectedAuditChat ? (
          <button
            type="button"
            className="audit-back"
            onClick={() => setSelectedAuditChatId(null)}
            aria-label="Назад к перепискам"
          >
            <ChevronLeft size={24} />
          </button>
        ) : (
          <span className="audit-header-spacer" />
        )}
        <span>
          <strong>{selectedAuditChat?.title ?? user.name}</strong>
          <small>Контролируемый просмотр</small>
        </span>
        <button
          type="button"
          className="audit-close"
          onClick={onClose}
          aria-label="Закрыть режим аудита"
        >
          <X size={19} />
        </button>
      </header>

      <div className="audit-banner">
        <span className="audit-badge">
          <Eye size={14} /> Режим аудита
        </span>
        <p>
          {viewerRole === "moderator" ? "Модератор" : "Администратор"}{" "}
          просматривает данные в режиме только для чтения.
          Действие записано в журнал, отправка сообщений отключена.
        </p>
        <small>Сеанс AUD-2026-0727 · журналирование включено</small>
      </div>

      {selectedAuditChat ? (
        <div className="audit-conversation">
          <div className="audit-message-list">
            {selectedAuditMessages.length ? (
              selectedAuditMessages.map((message) => (
                <div
                  key={message.id}
                  className={`audit-message audit-message-${message.side}`}
                >
                  <span>
                    {message.author ? <strong>{message.author}</strong> : null}
                    <p>
                      {message.text ??
                        `🎙 Голосовое сообщение · ${message.voice}`}
                    </p>
                    <time>{message.time}</time>
                  </span>
                </div>
              ))
            ) : (
              <div className="panel-empty">
                <MessageCircle size={23} />
                <span>В этой переписке нет сообщений</span>
              </div>
            )}
          </div>
          <div className="audit-readonly">
            <ShieldCheck size={17} />
            <span>
              <strong>Только чтение</strong>
              <small>Отправка от имени пользователя недоступна</small>
            </span>
          </div>
        </div>
      ) : (
        <div className="audit-chat-list">
          <span className="settings-label">ПЕРЕПИСКИ ПОЛЬЗОВАТЕЛЯ</span>
          {chats.map((chat) => (
            <button
              type="button"
              key={chat.id}
              onClick={() => setSelectedAuditChatId(chat.id)}
            >
              <Avatar
                label={chat.avatar}
                gradient={chat.gradient}
                online={chat.online}
              />
              <span>
                <strong>{chat.title}</strong>
                <small>
                  {chat.deleted ? "Удалён · " : ""}
                  {chat.subtitle}
                </small>
              </span>
              <ChevronRight size={18} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ComposeSheet({
  users,
  onClose,
  onSelect,
  onCreateGroup,
}: {
  users: MessengerUser[];
  onClose: () => void;
  onSelect: (id: string) => void;
  onCreateGroup: (name: string, memberIds: string[]) => void;
}) {
  const [step, setStep] = useState<"message" | "members" | "details">(
    "message",
  );
  const [query, setQuery] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const availableUsers = users.filter(
    (user) =>
      user.id !== "self" &&
      (!normalizedQuery ||
        `${user.name} ${user.position}`
          .toLocaleLowerCase("ru")
          .includes(normalizedQuery)),
  );

  const toggleMember = (id: string) => {
    setSelectedMemberIds((current) =>
      current.includes(id)
        ? current.filter((memberId) => memberId !== id)
        : [...current, id],
    );
  };

  return (
    <div
      className="sheet-backdrop"
      role="presentation"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div
        className={`bottom-sheet compose-sheet compose-step-${step}`}
        role="dialog"
        aria-modal="true"
        aria-label={
          step === "message"
            ? "Новое сообщение"
            : step === "members"
              ? "Выбор участников группы"
              : "Создание группы"
        }
        onClick={(event) => event.stopPropagation()}
      >
        <span className="sheet-handle" />
        <div className="sheet-title">
          <span className="sheet-title-main">
            {step !== "message" ? (
              <button
                type="button"
                className="sheet-back-button"
                aria-label="Назад"
                onClick={() => {
                  setQuery("");
                  setStep(step === "details" ? "members" : "message");
                }}
              >
                <ChevronLeft size={18} />
              </button>
            ) : null}
            <strong>
              {step === "message"
                ? "Новое сообщение"
                : step === "members"
                  ? "Участники"
                  : "Новая группа"}
            </strong>
          </span>
          <button type="button" aria-label="Закрыть" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {step !== "details" ? (
          <label className="search-field compact-search">
            <Search size={17} />
            <input
              value={query}
              placeholder={
                step === "message" ? "Кому написать?" : "Найти участника"
              }
              aria-label={
                step === "message"
                  ? "Поиск контакта"
                  : "Поиск участника группы"
              }
              onChange={(event) => setQuery(event.target.value)}
              autoFocus
            />
            {query ? (
              <button
                type="button"
                aria-label="Очистить поиск"
                onClick={() => setQuery("")}
              >
                <X size={15} />
              </button>
            ) : null}
          </label>
        ) : null}

        {step === "message" ? (
          <>
            <button
              type="button"
              className="quick-create"
              onClick={() => {
                setQuery("");
                setStep("members");
              }}
            >
              <i>
                <UsersRound size={19} />
              </i>
              <span>Создать группу</span>
              <ChevronRight size={17} />
            </button>
            <span className="contact-letter">КОНТАКТЫ</span>
            <div className="compose-contact-list">
              {availableUsers.length ? (
                availableUsers.map((person) => (
                  <button
                    type="button"
                    className="person-row sheet-person"
                    key={person.id}
                    onClick={() => onSelect(person.id)}
                  >
                    <Avatar
                      label={person.avatar}
                      gradient={person.gradient}
                      imageUrl={person.avatarUrl}
                      online={person.online}
                    />
                    <span>
                      <strong>{person.name}</strong>
                      <small>
                        {person.online ? "В сети" : person.position}
                      </small>
                    </span>
                  </button>
                ))
              ) : (
                <div className="panel-empty">
                  <Search size={22} />
                  <span>Контакты не найдены</span>
                </div>
              )}
            </div>
          </>
        ) : step === "members" ? (
          <>
            <div className="group-member-list">
              {availableUsers.length ? (
                availableUsers.map((person) => {
                  const selected = selectedMemberIds.includes(person.id);
                  return (
                    <button
                      type="button"
                      key={person.id}
                      className={selected ? "is-selected" : ""}
                      aria-pressed={selected}
                      onClick={() => toggleMember(person.id)}
                    >
                      <Avatar
                        label={person.avatar}
                        gradient={person.gradient}
                        imageUrl={person.avatarUrl}
                        online={person.online}
                      />
                      <span>
                        <strong>{person.name}</strong>
                        <small>{person.position}</small>
                      </span>
                      <i>{selected ? <CheckCheck size={16} /> : null}</i>
                    </button>
                  );
                })
              ) : (
                <div className="panel-empty">
                  <Search size={22} />
                  <span>Участники не найдены</span>
                </div>
              )}
            </div>
            <button
              type="button"
              className="group-next-button"
              disabled={selectedMemberIds.length < 2}
              onClick={() => {
                setQuery("");
                setStep("details");
              }}
            >
              Далее · {selectedMemberIds.length}
            </button>
          </>
        ) : (
          <div className="group-details">
            <span className="group-avatar-preview">
              <UsersRound size={28} />
            </span>
            <label>
              <span>Название группы</span>
              <input
                value={groupName}
                maxLength={40}
                placeholder="Например, Проект CIFRA"
                aria-label="Название группы"
                onChange={(event) => setGroupName(event.target.value)}
                autoFocus
              />
            </label>
            <div className="selected-member-strip" aria-label="Выбранные участники">
              {selectedMemberIds.map((id) => {
                const person = users.find((user) => user.id === id);
                if (!person) return null;
                return (
                  <span key={id}>
                    <Avatar
                      label={person.avatar}
                      gradient={person.gradient}
                      imageUrl={person.avatarUrl}
                      size="small"
                    />
                    <small>{person.name.split(" ")[0]}</small>
                  </span>
                );
              })}
            </div>
            <button
              type="button"
              className="create-group-button"
              disabled={!groupName.trim()}
              onClick={() =>
                onCreateGroup(groupName.trim(), selectedMemberIds)
              }
            >
              <UsersRound size={18} />
              Создать группу
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CallOverlay({
  users,
  participantIds,
  onClose,
}: {
  users: MessengerUser[];
  participantIds: string[];
  onClose: () => void;
}) {
  const [micOn, setMicOn] = useState(true);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const callParticipants = participantIds
    .map((id) => users.find((user) => user.id === id))
    .filter((user): user is MessengerUser => Boolean(user));
  const isGroupCall = callParticipants.length > 1;

  return (
    <div
      className="call-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Звонок"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="call-ambient call-ambient-one" />
      <div className="call-ambient call-ambient-two" />
      <button
        type="button"
        className="call-close"
        onClick={onClose}
        aria-label="Закрыть звонок"
        autoFocus
      >
        <ChevronLeft size={25} />
      </button>
      <span className="encrypted-call">
        <ShieldCheck size={13} /> защищённый звонок
      </span>
      <div className="call-person">
        {isGroupCall ? (
          <div className="group-call-avatars" aria-hidden="true">
            {callParticipants.slice(0, 3).map((person) => (
              <Avatar
                key={person.id}
                label={person.avatar}
                gradient={person.gradient}
                imageUrl={person.avatarUrl}
                size="large"
              />
            ))}
          </div>
        ) : (
          <Avatar
            label={callParticipants[0]?.avatar ?? "АС"}
            gradient={
              callParticipants[0]?.gradient ??
              "linear-gradient(145deg, #6366f1, #a78bfa)"
            }
            imageUrl={callParticipants[0]?.avatarUrl}
            size="hero"
          />
        )}
        <h2>
          {isGroupCall
            ? "Групповой звонок"
            : callParticipants[0]?.name ?? "Анна Смирнова"}
        </h2>
        <p>
          {isGroupCall
            ? `${callParticipants.length} участников · соединение…`
            : "Соединение…"}
        </p>
      </div>
      <div className="call-controls">
        <button
          type="button"
          className={!micOn ? "is-off" : ""}
          aria-pressed={micOn}
          aria-label={micOn ? "Выключить микрофон" : "Включить микрофон"}
          onClick={() => setMicOn((current) => !current)}
        >
          {micOn ? <Mic size={23} /> : <MicOff size={23} />}
          <span>{micOn ? "Микрофон" : "Без звука"}</span>
        </button>
        <button
          type="button"
          className={!speakerOn ? "is-off" : ""}
          aria-pressed={speakerOn}
          aria-label={speakerOn ? "Выключить динамик" : "Включить динамик"}
          onClick={() => setSpeakerOn((current) => !current)}
        >
          {speakerOn ? <Volume2 size={23} /> : <VolumeX size={23} />}
          <span>{speakerOn ? "Динамик" : "Тихо"}</span>
        </button>
        <button
          type="button"
          className={!cameraOn ? "is-off" : ""}
          aria-pressed={cameraOn}
          aria-label={cameraOn ? "Выключить камеру" : "Включить камеру"}
          onClick={() => setCameraOn((current) => !current)}
        >
          {cameraOn ? <Video size={23} /> : <VideoOff size={23} />}
          <span>{cameraOn ? "Камера" : "Без видео"}</span>
        </button>
      </div>
      <button type="button" className="hangup-button" onClick={onClose} aria-label="Завершить звонок">
        <Phone size={27} />
      </button>
    </div>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("chats");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [chatItems, setChatItems] = useState<Chat[]>(initialChats);
  const [messagesByChat, setMessagesByChat] =
    useState<Record<string, Message[]>>(initialMessagesByChat);
  const deliveryTimersRef = useRef<number[]>([]);
  const activitySequenceRef = useRef(initialChats.length);
  const [composeOpen, setComposeOpen] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [callParticipantIds, setCallParticipantIds] = useState<string[]>([]);
  const [calls, setCalls] = useState<CallRecord[]>(initialCallHistory);
  const [callHistoryReady, setCallHistoryReady] = useState(false);
  const [theme, setTheme] = useState<Theme>("navy");
  const [notificationMode, setNotificationMode] =
    useState<NotificationMode>("on");
  const [notificationUntil, setNotificationUntil] = useState<number | null>(
    null,
  );
  const apiClientRef = useRef<CifraApiClient | null>(null);
  const realtimeClientRef = useRef<CifraRealtimeClient | null>(null);
  const realtimeUiTopicRef = useRef<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] =
    useState<RealtimeStatus>("disconnected");
  const [realtimeSubscriptions, setRealtimeSubscriptions] = useState<
    readonly RealtimeChatSubscription[]
  >([]);
  const [realtimeMessages, setRealtimeMessages] = useState<
    readonly RealtimeChatMessage[]
  >([]);
  const [realtimeReceipts, setRealtimeReceipts] = useState<
    readonly RealtimeChatReceipt[]
  >([]);
  const [realtimeUserId, setRealtimeUserId] = useState<string | null>(null);
  const [realtimeObservedTopic, setRealtimeObservedTopic] = useState<
    string | null
  >(null);
  const [realtimeChatStatus, setRealtimeChatStatus] =
    useState<RealtimeChatObserverStatus>("idle");
  const [realtimePublishStatus, setRealtimePublishStatus] =
    useState<RealtimePublishStatus>("idle");
  const [realtimePublishedSeq, setRealtimePublishedSeq] = useState<
    number | null
  >(null);
  const [authMode, setAuthMode] = useState<RuntimeMode>("demo");
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [role, setRole] = useState<UserRole>("admin");
  const [users, setUsers] = useState<MessengerUser[]>(initialUsers);
  const [selectedProfileUserId, setSelectedProfileUserId] = useState<
    string | null
  >(null);
  const [auditUserId, setAuditUserId] = useState<string | null>(null);

  const activateSession = useCallback((session: AuthSession) => {
    setAuthSession(session);
    setRole(session.role);
    setSessionActive(true);
    setUsers((current) =>
      current.map((user) =>
        user.id === "self"
          ? {
              ...user,
              username: session.login,
              role: session.role,
              backendId:
                session.context.user_id ===
                "00000000-0000-4000-8000-000000000001"
                  ? undefined
                  : session.context.user_id,
              backendRoles: session.context.roles,
            }
          : user,
      ),
    );
  }, []);

  const syncBackendDirectory = useCallback(
    async (client: CifraApiClient, session: AuthSession) => {
      if (client.mode !== "backend") return;
      const page = await client.listUsers();
      if (page.items.length === 0) return;
      setUsers(
        page.items.map((user) =>
          backendUserToMessenger(user, session.context.user_id),
        ),
      );
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void loadRuntimeConfig()
      .then(async (config) => {
        if (cancelled) return;
        const client = new CifraApiClient(config);
        apiClientRef.current = client;
        setAuthMode(config.mode);
        const restored = await client.restoreSession();
        if (cancelled || !restored) return;
        activateSession(restored);
        await syncBackendDirectory(client, restored);
      })
      .catch(() => {
        // The sign-in form will display a precise error on the next attempt.
      });
    return () => {
      cancelled = true;
    };
  }, [activateSession, syncBackendDirectory]);
  useEffect(() => {
    const apiClient = apiClientRef.current;

    if (
      !sessionActive ||
      !authSession ||
      authSession.context.must_change_password ||
      !apiClient ||
      apiClient.mode !== "backend"
    ) {
      realtimeClientRef.current?.disconnect();
      realtimeClientRef.current = null;
      setRealtimeStatus("disconnected");
      setRealtimeSubscriptions([]);
      setRealtimeMessages([]);
      setRealtimeReceipts([]);
      setRealtimeUserId(null);
      setRealtimeObservedTopic(null);
      setRealtimeChatStatus("idle");
      setRealtimePublishStatus("idle");
      setRealtimePublishedSeq(null);
      return;
    }

    const realtimeClient = new CifraRealtimeClient(
      (status) => {
        setRealtimeStatus(status);
        if (status !== "connected") {
          setRealtimeUserId(null);
        }
      },
      (subscriptions) => {
        setRealtimeSubscriptions([...subscriptions]);
      },
      (messages) => {
        setRealtimeMessages([...messages]);
      },
      (receipts) => {
        setRealtimeReceipts([...receipts]);
      },
    );

    realtimeClientRef.current?.disconnect();
    realtimeClientRef.current = realtimeClient;

    let cancelled = false;

    void realtimeClient
      .connect({
        apiBaseUrl: apiClient.config.apiBaseUrl,
        accessToken: authSession.tokens.access_token,
        deviceId: apiClient.currentDeviceId,
      })
      .then((userId) => {
        if (cancelled) {
          realtimeClient.disconnect();
          return;
        }

        setRealtimeUserId(userId);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        if (
          error instanceof CifraRealtimeError &&
          error.code === "realtime_connection_cancelled"
        ) {
          setRealtimeStatus("disconnected");
          return;
        }

        setRealtimeStatus("error");
      });

    return () => {
      cancelled = true;
      realtimeClient.disconnect();

      if (realtimeClientRef.current === realtimeClient) {
        realtimeClientRef.current = null;
      }
    };
  }, [authSession, sessionActive]);
  useEffect(() => {
    const realtimeClient = realtimeClientRef.current;

    if (
      !sessionActive ||
      realtimeStatus !== "connected" ||
      !realtimeClient
    ) {
      setRealtimeObservedTopic(null);
      setRealtimeChatStatus("idle");
      setRealtimePublishStatus("idle");
      setRealtimePublishedSeq(null);
      return;
    }

    const subscription = realtimeSubscriptions.find(
      (candidate) =>
        !candidate.access?.mode ||
        candidate.access.mode.includes("R"),
    );

    if (!subscription) {
      setRealtimeObservedTopic(null);
      setRealtimeChatStatus("idle");
      setRealtimePublishStatus("idle");
      setRealtimePublishedSeq(null);
      return;
    }

    let cancelled = false;
    setRealtimeObservedTopic(subscription.topic);
    setRealtimeChatStatus("subscribing");
    setRealtimePublishStatus("idle");
    setRealtimePublishedSeq(null);

    void realtimeClient
      .subscribeToChat(subscription.topic, {
        historyLimit: 20,
      })
      .then(() => {
        if (!cancelled) {
          setRealtimeChatStatus("subscribed");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRealtimeChatStatus("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [realtimeStatus, realtimeSubscriptions, sessionActive]);
  useEffect(() => {
    const previousTopic = realtimeUiTopicRef.current;
    const activeTopic =
      sessionActive &&
      realtimeChatStatus === "subscribed" &&
      realtimeObservedTopic &&
      realtimeUserId
        ? realtimeObservedTopic
        : null;

    if (!activeTopic || !realtimeUserId) {
      if (previousTopic) {
        setChatItems((current) =>
          current.filter((chat) => chat.id !== previousTopic),
        );
        setSelectedChatId((current) =>
          current === previousTopic ? null : current,
        );
        setMessagesByChat((current) => {
          const next = { ...current };
          delete next[previousTopic];
          return next;
        });
        realtimeUiTopicRef.current = null;
      }
      return;
    }

    const subscription = realtimeSubscriptions.find(
      (candidate) => candidate.topic === activeTopic,
    );
    if (!subscription) return;

    const projectedMessages = realtimeMessages
      .filter((message) => message.topic === activeTopic)
      .map((message) =>
        withRealtimeReceiptStatus(
          buildRealtimeUiMessage(message, realtimeUserId),
          message,
          realtimeUserId,
          realtimeReceipts,
        ),
      )
      .filter((message): message is Message => Boolean(message));
    const latestMessage = projectedMessages.at(-1);
    const title = getRealtimeChatTitle(subscription);
    const realtimeChat: Chat = {
      id: activeTopic,
      title,
      subtitle: latestMessage
        ? getMessageSnippet(latestMessage)
        : "Реальный чат Tinode",
      time:
        latestMessage?.time ||
        formatRealtimeTimestamp(
          subscription.touchedAt || subscription.updatedAt,
        ),
      unread: 0,
      avatar: getRealtimeAvatar(title),
      gradient: "linear-gradient(145deg, #0f766e, #2563eb)",
      kind:
        activeTopic.startsWith("grp") || activeTopic.startsWith("chn")
          ? "group"
          : "work",
      lastActivityOrder:
        1_000_000 +
        (latestMessage?.id || subscription.seq || 0),
      ...(latestMessage
        ? {
            lastMessageId: latestMessage.id,
            lastMessageSide: latestMessage.side,
            ...(latestMessage.deliveryStatus
              ? { lastDeliveryStatus: latestMessage.deliveryStatus }
              : {}),
          }
        : {}),
      ...(typeof subscription.online === "boolean"
        ? { online: subscription.online }
        : {}),
    };

    setMessagesByChat((current) => ({
      ...current,
      [activeTopic]: projectedMessages,
    }));
    setChatItems((current) => {
      const withoutRealtimeTopics = current.filter(
        (chat) =>
          chat.id !== activeTopic &&
          (!previousTopic || chat.id !== previousTopic),
      );
      return [realtimeChat, ...withoutRealtimeTopics];
    });
    if (previousTopic && previousTopic !== activeTopic) {
      setSelectedChatId((current) =>
        current === previousTopic ? activeTopic : current,
      );
    }
    realtimeUiTopicRef.current = activeTopic;
  }, [
    realtimeChatStatus,
    realtimeMessages,
    realtimeObservedTopic,
    realtimeReceipts,
    realtimeSubscriptions,
    realtimeUserId,
    sessionActive,
  ]);
  useEffect(() => {
    const realtimeClient = realtimeClientRef.current;
    const topic = realtimeObservedTopic;
    const userId = realtimeUserId;

    if (
      !sessionActive ||
      realtimeStatus !== "connected" ||
      realtimeChatStatus !== "subscribed" ||
      !realtimeClient ||
      !topic ||
      !userId ||
      selectedChatId !== topic
    ) {
      return;
    }

    const markLatestIncomingAsRead = () => {
      if (document.visibilityState === "hidden") {
        return;
      }

      const latestIncomingSeq = realtimeMessages.reduce(
        (highest, message) =>
          message.topic === topic &&
          message.from &&
          message.from !== userId
            ? Math.max(highest, message.seq)
            : highest,
        0,
      );

      if (latestIncomingSeq > 0) {
        try {
          realtimeClient.markRead(topic, latestIncomingSeq);
        } catch {
          // Connection cleanup may race with a visibility change.
        }
      }
    };

    markLatestIncomingAsRead();
    document.addEventListener(
      "visibilitychange",
      markLatestIncomingAsRead,
    );

    return () => {
      document.removeEventListener(
        "visibilitychange",
        markLatestIncomingAsRead,
      );
    };
  }, [
    realtimeChatStatus,
    realtimeMessages,
    realtimeObservedTopic,
    realtimeStatus,
    realtimeUserId,
    selectedChatId,
    sessionActive,
  ]);

  useEffect(() => {
    let frameId: number | undefined;
    try {
      const storedTheme = window.localStorage.getItem("cifra-theme");
      if (
        storedTheme === "navy" ||
        storedTheme === "black" ||
        storedTheme === "sage" ||
        storedTheme === "gray" ||
        storedTheme === "sunset"
      ) {
        frameId = window.requestAnimationFrame(() => setTheme(storedTheme));
      }
    } catch {
      // The prototype still works when browser storage is unavailable.
    }
    return () => {
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
    };
  }, []);

  useEffect(() => {
    let storedCalls: CallRecord[] | null = null;
    try {
      const rawHistory = window.localStorage.getItem("cifra-call-history");
      if (rawHistory) {
        const parsed: unknown = JSON.parse(rawHistory);
        if (Array.isArray(parsed) && parsed.every(isCallRecord)) {
          storedCalls = parsed.slice(0, 100);
        }
      }
    } catch {
      // Keep the bundled call history when browser storage is unavailable.
    }
    const frameId = window.requestAnimationFrame(() => {
      if (storedCalls) setCalls(storedCalls);
      setCallHistoryReady(true);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  useEffect(() => {
    if (!callHistoryReady) return;
    try {
      window.localStorage.setItem(
        "cifra-call-history",
        JSON.stringify(calls.slice(0, 100)),
      );
    } catch {
      // The current session still keeps the updated call history.
    }
  }, [callHistoryReady, calls]);

  useEffect(() => {
    const deliveryTimers = deliveryTimersRef.current;
    return () => {
      deliveryTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    const handleIncomingMessage = (event: Event) => {
      const detail = (event as CustomEvent<IncomingMessageDetail>).detail;
      if (!detail || typeof detail.chatId !== "string") return;

      const targetChat = chatItems.find(
        (chat) => chat.id === detail.chatId && !chat.deleted,
      );
      if (!targetChat) return;

      const text =
        typeof detail.text === "string" ? detail.text.trim() : undefined;
      const voice =
        typeof detail.voice === "string" ? detail.voice.trim() : undefined;
      if (!text && !voice) return;

      const incomingMessage: Message = {
        id: detail.id ?? Date.now(),
        side: "in",
        text,
        voice,
        author:
          typeof detail.author === "string"
            ? detail.author.trim()
            : undefined,
        time:
          typeof detail.time === "string" && detail.time.trim()
            ? detail.time.trim()
            : formatMessageTime(),
        replyToId:
          typeof detail.replyToId === "number"
            ? detail.replyToId
            : undefined,
        forwardedFrom:
          typeof detail.forwardedFrom === "string" &&
          detail.forwardedFrom.trim()
            ? detail.forwardedFrom.trim()
            : undefined,
      };
      const activityOrder = ++activitySequenceRef.current;

      setMessagesByChat((current) => ({
        ...current,
        [detail.chatId]: [
          ...(current[detail.chatId] ?? []),
          incomingMessage,
        ],
      }));
      setChatItems((current) =>
        current.map((chat) =>
          chat.id === detail.chatId
            ? withLatestMessage(
                chat,
                incomingMessage,
                activityOrder,
                selectedChatId !== detail.chatId,
              )
            : chat,
        ),
      );
    };

    window.addEventListener("cifra:incoming-message", handleIncomingMessage);
    return () =>
      window.removeEventListener(
        "cifra:incoming-message",
        handleIncomingMessage,
      );
  }, [chatItems, selectedChatId]);

  useEffect(() => {
    const handleIncomingCall = (event: Event) => {
      const detail = (event as CustomEvent<IncomingCallDetail>).detail;
      if (
        !detail ||
        !Array.isArray(detail.participantIds) ||
        !detail.participantIds.every((id) => typeof id === "string")
      ) {
        return;
      }
      const type: CallRecord["type"] = detail.missed ? "missed" : "in";
      const record = buildCallRecord(
        detail.participantIds,
        type,
        users,
        chatItems,
      );
      if (!record) return;

      setCalls((current) => [record, ...current].slice(0, 100));
      if (!detail.missed) {
        setCallParticipantIds(record.participantIds);
        setCallOpen(true);
      }
    };

    window.addEventListener("cifra:incoming-call", handleIncomingCall);
    return () =>
      window.removeEventListener("cifra:incoming-call", handleIncomingCall);
  }, [chatItems, users]);

  useEffect(() => {
    let frameId: number | undefined;
    try {
      const storedMode = window.localStorage.getItem(
        "cifra-notification-mode",
      );
      const storedUntil = Number(
        window.localStorage.getItem("cifra-notification-until"),
      );
      if (storedMode === "off") {
        frameId = window.requestAnimationFrame(() =>
          setNotificationMode("off"),
        );
      } else if (storedMode === "hour" && storedUntil > Date.now()) {
        frameId = window.requestAnimationFrame(() => {
          setNotificationMode("hour");
          setNotificationUntil(storedUntil);
        });
      } else {
        window.localStorage.setItem("cifra-notification-mode", "on");
        window.localStorage.removeItem("cifra-notification-until");
      }
    } catch {
      // Notifications keep their default when browser storage is unavailable.
    }
    return () => {
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
    };
  }, []);

  useEffect(() => {
    if (notificationMode !== "hour" || notificationUntil === null) return;
    const remaining = notificationUntil - Date.now();
    const timeoutId = window.setTimeout(() => {
      setNotificationMode("on");
      setNotificationUntil(null);
      try {
        window.localStorage.setItem("cifra-notification-mode", "on");
        window.localStorage.removeItem("cifra-notification-until");
      } catch {
        // The in-memory timer still restores notifications.
      }
    }, Math.max(remaining, 0));
    return () => window.clearTimeout(timeoutId);
  }, [notificationMode, notificationUntil]);

  useEffect(() => {
    const colors: Record<Theme, string> = {
      navy: "#071426",
      black: "#030405",
      sage: "#18261d",
      gray: "#1b1b1b",
      sunset: "#1f214d",
    };
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", colors[theme]);
  }, [theme]);

  const changeTheme = (nextTheme: Theme) => {
    setTheme(nextTheme);
    try {
      window.localStorage.setItem("cifra-theme", nextTheme);
    } catch {
      // Keep the selected theme for the current session.
    }
  };

  const changeNotificationMode = (nextMode: NotificationMode) => {
    const until = nextMode === "hour" ? Date.now() + 60 * 60 * 1000 : null;
    setNotificationMode(nextMode);
    setNotificationUntil(until);
    try {
      window.localStorage.setItem("cifra-notification-mode", nextMode);
      if (until) {
        window.localStorage.setItem(
          "cifra-notification-until",
          String(until),
        );
      } else {
        window.localStorage.removeItem("cifra-notification-until");
      }
    } catch {
      // Keep the selected notification mode for the current session.
    }
  };

  const selectedChat =
    chatItems.find((chat) => chat.id === selectedChatId) ?? chatItems[0];
  const selectedMessages = selectedChat
    ? (messagesByChat[selectedChat.id] ?? [])
    : [];
  const currentUser = users.find((user) => user.id === "self") ?? users[0];
  const selectedProfileUser = users.find(
    (user) => user.id === selectedProfileUserId,
  );
  const auditUser = users.find((user) => user.id === auditUserId);
  const unreadChatCount = chatItems.reduce(
    (total, chat) => total + (chat.deleted ? 0 : chat.unread),
    0,
  );

  const openChat = (id: string) => {
    setChatItems((current) =>
      current.map((chat) =>
        chat.id === id && chat.unread > 0 ? { ...chat, unread: 0 } : chat,
      ),
    );
    setSelectedChatId(id);
    setComposeOpen(false);
  };

  const openUserChat = (id: string) => {
    const directChat = chatItems.find((chat) => chat.id === id);
    if (directChat) {
      openChat(directChat.id);
      return;
    }
    const user = users.find((person) => person.id === id);
    if (!user) return;
    const newChat: Chat = {
      id: user.id,
      title: user.name,
      subtitle: "Новая переписка",
      time: "Сейчас",
      unread: 0,
      lastActivityOrder: ++activitySequenceRef.current,
      avatar: user.avatar,
      gradient: user.gradient,
      kind: "work",
      online: user.online,
    };
    setChatItems((current) => [newChat, ...current]);
    setMessagesByChat((current) => ({ ...current, [newChat.id]: [] }));
    openChat(newChat.id);
  };

  const getApiClient = async (): Promise<CifraApiClient> => {
    if (apiClientRef.current) return apiClientRef.current;
    const config = await loadRuntimeConfig();
    const client = new CifraApiClient(config);
    apiClientRef.current = client;
    setAuthMode(config.mode);
    return client;
  };

  const loginWithCredentials = async (
    login: string,
    password: string,
  ): Promise<LoginOutcome> => {
    const client = await getApiClient();
    const outcome = await client.login(login, password);
    if (outcome.kind === "authenticated") {
      activateSession(outcome.session);
      void syncBackendDirectory(client, outcome.session).catch(() => {
        // Authentication remains valid if the directory is temporarily unavailable.
      });
    }
    return outcome;
  };

  const verifyMfa = async (
    login: string,
    challengeToken: string,
    code: string,
  ): Promise<void> => {
    const client = await getApiClient();
    const session = await client.verifyMfa(login, challengeToken, code);
    activateSession(session);
    void syncBackendDirectory(client, session).catch(() => {
      // Authentication remains valid if the directory is temporarily unavailable.
    });
  };

  const logout = async (): Promise<void> => {
  realtimeClientRef.current?.disconnect();
  realtimeClientRef.current = null;
  setRealtimeStatus("disconnected");
  setRealtimeSubscriptions([]);
  setRealtimeMessages([]);
  setRealtimeReceipts([]);
  setRealtimeUserId(null);
  setRealtimeObservedTopic(null);
  setRealtimeChatStatus("idle");
  setRealtimePublishStatus("idle");
  setRealtimePublishedSeq(null);

  try {
    await apiClientRef.current?.logout();
  } finally {
    setAuthSession(null);
    setSessionActive(false);
    setComposeOpen(false);
    setCallOpen(false);
    setSelectedProfileUserId(null);
    setAuditUserId(null);
  }
};

  const changeOwnPassword = async (
    currentPassword: string,
    newPassword: string,
  ): Promise<void> => {
    const client = await getApiClient();
    await client.changePassword(currentPassword, newPassword);
    setAuthSession(null);
    setSessionActive(false);
    setComposeOpen(false);
    setCallOpen(false);
    setSelectedProfileUserId(null);
    setAuditUserId(null);
  };

  const changeRole = (nextRole: UserRole) => {
    if (authMode !== "demo") return;
    setRole(nextRole);
    setSelectedProfileUserId(null);
    setAuditUserId(null);
  };

  const updateUser = async (updatedUser: MessengerUser): Promise<void> => {
    const original = users.find((user) => user.id === updatedUser.id);
    let persistedUser = updatedUser;
    if (
      authMode === "backend" &&
      authSession &&
      original?.backendId &&
      original.backendVersion &&
      apiClientRef.current
    ) {
      let backendUser: BackendUser | null = null;
      const profileChanged =
        original.name !== updatedUser.name ||
        original.email !== updatedUser.email ||
        original.phone !== updatedUser.phone;
      if (profileChanged) {
        const [firstName = "", ...lastNameParts] = updatedUser.name
          .trim()
          .split(/\s+/);
        const lastName = lastNameParts.join(" ");
        if (!firstName || !lastName) {
          throw new CifraApiError(
            "Укажите имя и фамилию",
            400,
            "VALIDATION_ERROR",
          );
        }
        backendUser = await apiClientRef.current.updateUser(
          original.backendId,
          original.backendVersion,
          {
            first_name: firstName,
            last_name: lastName,
            email: updatedUser.email || null,
            phone: updatedUser.phone || null,
            reason: "Изменение профиля через CIFRA Web",
          },
        );
      }
      if (original.role !== updatedUser.role) {
        backendUser = await apiClientRef.current.setUserRoles(
          original.backendId,
          corporateRolesFor(updatedUser.role),
          "Изменение роли через CIFRA Web",
        );
      }
      if (backendUser) {
        persistedUser = backendUserToMessenger(
          backendUser,
          authSession.context.user_id,
        );
      }
    }
    setUsers((current) =>
      current.map((user) =>
        user.id === persistedUser.id ? persistedUser : user,
      ),
    );
    setChatItems((current) =>
      current.map((chat) =>
        chat.id === persistedUser.id
          ? {
              ...chat,
              title: persistedUser.name,
              avatar: persistedUser.avatar,
              gradient: persistedUser.gradient,
              online: persistedUser.online,
            }
          : chat,
      ),
    );
    setSelectedProfileUserId(null);
  };

  const deleteContact = async (id: string): Promise<void> => {
    const target = users.find((user) => user.id === id);
    if (
      authMode === "backend" &&
      target?.backendId &&
      apiClientRef.current
    ) {
      await apiClientRef.current.disableUser(
        target.backendId,
        "Отключение сотрудника через CIFRA Web",
      );
    }
    setUsers((current) => current.filter((user) => user.id !== id));
    setChatItems((current) =>
      current.map((chat) =>
        chat.id === id
          ? {
              ...chat,
              pinned: false,
              deleted: true,
              archived: false,
              muted: true,
            }
          : chat,
      ),
    );
    setSelectedProfileUserId(null);
  };

  const toggleChatMute = (id: string) => {
    setChatItems((current) =>
      current.map((chat) =>
        chat.id === id ? { ...chat, muted: !chat.muted } : chat,
      ),
    );
  };

  const archiveChat = (id: string) => {
    setChatItems((current) =>
      current.map((chat) =>
        chat.id === id
          ? {
              ...chat,
              pinned: false,
              archived: true,
              deleted: false,
              muted: true,
            }
          : chat,
      ),
    );
  };

  const unarchiveChat = (id: string) => {
    setChatItems((current) =>
      current.map((chat) =>
        chat.id === id ? { ...chat, archived: false } : chat,
      ),
    );
  };

  const deleteChat = (id: string) => {
    setChatItems((current) =>
      current.map((chat) =>
        chat.id === id
          ? {
              ...chat,
              pinned: false,
              deleted: true,
              archived: false,
              muted: true,
            }
          : chat,
      ),
    );
  };

  const addChatParticipants = (id: string, participantIds: string[]) => {
    setChatItems((current) =>
      current.map((chat) => {
        if (chat.id !== id || chat.kind !== "group") return chat;
        return {
          ...chat,
          memberIds: Array.from(
            new Set([...(chat.memberIds ?? []), ...participantIds]),
          ).filter((participantId) => participantId !== "self"),
        };
      }),
    );
  };

  const toggleChatPin = (id: string) => {
    setChatItems((current) => {
      const selected = current.find((chat) => chat.id === id);
      if (!selected || selected.archived || selected.deleted) return current;

      const pinnedCount = current.filter(
        (chat) => chat.pinned && !chat.archived && !chat.deleted,
      ).length;
      if (!selected.pinned && pinnedCount >= 3) return current;

      return current.map((chat) =>
        chat.id === id ? { ...chat, pinned: !chat.pinned } : chat,
      );
    });
  };

  const createGroup = (name: string, memberIds: string[]) => {
    const newChat: Chat = {
      id: `group-${Date.now()}`,
      title: name,
      subtitle: `${memberIds.length + 1} участников · группа создана`,
      time: "Сейчас",
      unread: 0,
      lastActivityOrder: ++activitySequenceRef.current,
      avatar: name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toLocaleUpperCase("ru"))
        .join(""),
      gradient: "linear-gradient(145deg, #1d4ed8, #7c3aed)",
      kind: "group",
      memberIds,
    };
    setChatItems((current) => [newChat, ...current]);
    setMessagesByChat((current) => ({ ...current, [newChat.id]: [] }));
    setComposeOpen(false);
    setSelectedChatId(newChat.id);
  };

  const updateOwnAvatar = (avatarUrl: string) => {
    setUsers((current) =>
      current.map((user) =>
        user.id === "self" ? { ...user, avatarUrl } : user,
      ),
    );
  };

  const sendMessage = (
    chatId: string,
    text: string,
    options: SendMessageOptions = {},
  ) => {
    const normalizedText = text.trim();
    const voice = options.voice?.trim();
    if (!normalizedText && !voice) return false;

    const realtimeClient = realtimeClientRef.current;

    if (
      realtimeClient &&
      chatId === realtimeObservedTopic &&
      realtimeStatus === "connected" &&
      realtimeChatStatus === "subscribed" &&
      realtimeClient.isTopicSubscribed(chatId)
    ) {
      if (
        !normalizedText ||
        voice ||
        options.replyToId !== undefined ||
        options.forwardedFrom
      ) {
        setRealtimePublishStatus("error");
        return false;
      }

      setRealtimePublishStatus("publishing");
      setRealtimePublishedSeq(null);

      void realtimeClient
        .publishText(chatId, normalizedText)
        .then((result) => {
          setRealtimePublishedSeq(result.seq);
          setRealtimePublishStatus("published");
        })
        .catch(() => {
          setRealtimePublishStatus("error");
        });

      return true;
    }

    const now = formatMessageTime();
    const messageId = Date.now();
    const outgoingMessage: Message = {
      id: messageId,
      side: "out",
      text: normalizedText || undefined,
      voice,
      time: now,
      deliveryStatus: "sent",
      replyToId: options.replyToId,
      forwardedFrom: options.forwardedFrom,
    };
    const activityOrder = ++activitySequenceRef.current;

    setMessagesByChat((current) => ({
      ...current,
      [chatId]: [
        ...(current[chatId] ?? []),
        outgoingMessage,
      ],
    }));
    setChatItems((current) =>
      current.map((chat) =>
        chat.id === chatId
          ? withLatestMessage(chat, outgoingMessage, activityOrder)
          : chat,
      ),
    );

    const updateDeliveryStatus = (deliveryStatus: MessageDeliveryStatus) => {
      setMessagesByChat((current) => ({
        ...current,
        [chatId]: (current[chatId] ?? []).map((message) =>
          message.id === messageId ? { ...message, deliveryStatus } : message,
        ),
      }));
      setChatItems((current) =>
        current.map((chat) =>
          chat.id === chatId
            ? withLatestDeliveryStatus(chat, messageId, deliveryStatus)
            : chat,
        ),
      );
    };

    const deliveredTimer = window.setTimeout(
      () => updateDeliveryStatus("delivered"),
      700,
    );
    const readTimer = window.setTimeout(
      () => updateDeliveryStatus("read"),
      1800,
    );
    deliveryTimersRef.current.push(deliveredTimer, readTimer);
    return true;
  };

  const togglePinnedMessage = (chatId: string, messageId: number) => {
    setMessagesByChat((current) => ({
      ...current,
      [chatId]: (current[chatId] ?? []).map((message) =>
        message.id === messageId
          ? {
              ...message,
              pinned: !message.pinned,
              pinnedAt: message.pinned ? undefined : Date.now(),
            }
          : message,
      ),
    }));
  };

  const forwardMessage = (
    sourceChatId: string,
    messageId: number,
    targetChatId: string,
  ) => {
    const sourceMessage = (messagesByChat[sourceChatId] ?? []).find(
      (message) => message.id === messageId,
    );
    const sourceChat = chatItems.find((chat) => chat.id === sourceChatId);
    if (!sourceMessage || !sourceChat) return;

    const forwardedFrom =
      sourceMessage.forwardedFrom ||
      sourceMessage.author ||
      (sourceMessage.side === "out" ? currentUser.name : sourceChat.title);
    const sent = sendMessage(targetChatId, sourceMessage.text ?? "", {
      voice: sourceMessage.voice,
      forwardedFrom,
    });
    if (sent) openChat(targetChatId);
  };

  const clearMessages = (chatId: string) => {
    setMessagesByChat((current) => ({ ...current, [chatId]: [] }));
    setChatItems((current) =>
      current.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              subtitle: "Нет сообщений",
              time: "",
              lastMessageId: undefined,
              lastMessageSide: undefined,
              lastDeliveryStatus: undefined,
            }
          : chat,
      ),
    );
  };

  const startCall = (participantIds: string[] = []) => {
    const record = buildCallRecord(participantIds, "out", users, chatItems);
    if (!record) return;
    setCalls((current) => [record, ...current].slice(0, 100));
    setCallParticipantIds(record.participantIds);
    setCallOpen(true);
  };

    return (
    <main
      className={`prototype-shell theme-${theme}`}
      data-realtime-status={realtimeStatus}
      data-realtime-topic-count={realtimeSubscriptions.length}
      data-realtime-chat-status={realtimeChatStatus}
      data-realtime-observed-topic={realtimeObservedTopic ?? ""}
      data-realtime-message-count={
        realtimeObservedTopic
          ? realtimeMessages.filter(
              (message) => message.topic === realtimeObservedTopic,
            ).length
          : 0
      }
      data-realtime-publish-status={realtimePublishStatus}
      data-realtime-published-seq={realtimePublishedSeq ?? ""}
      data-realtime-receipt-count={realtimeReceipts.length}
      data-realtime-remote-recv-seq={
        realtimeObservedTopic && realtimeUserId
          ? getRealtimeReceiptSeq(
              realtimeReceipts,
              realtimeObservedTopic,
              "recv",
              realtimeUserId,
            )
          : 0
      }
      data-realtime-remote-read-seq={
        realtimeObservedTopic && realtimeUserId
          ? getRealtimeReceiptSeq(
              realtimeReceipts,
              realtimeObservedTopic,
              "read",
              realtimeUserId,
            )
          : 0
      }
      data-realtime-ui-topic={realtimeUiTopicRef.current ?? ""}
      data-realtime-ui-message-count={
        realtimeUiTopicRef.current
          ? (messagesByChat[realtimeUiTopicRef.current]?.length ?? 0)
          : 0
      }
    >
      <div className="device-stage">
        <div className="device-glow" />
        <div className="iphone">
          <div className="dynamic-island" aria-hidden="true" />
          <div
            className={`app-screen ${
              sessionActive && selectedChatId ? "chat-open" : ""
            }`}
          >
            <StatusBar />
            <div className="view-host">
              {!sessionActive ? (
                <SignedOutView
                  onCredentials={loginWithCredentials}
                  onVerifyMfa={verifyMfa}
                />
              ) : authSession?.context.must_change_password ? null : (
                <div
                  className={`web-workspace web-workspace-${activeTab} ${
                    selectedChatId ? "is-chat-open" : ""
                  }`}
                >
                  {activeTab === "chats" ? (
                    <>
                      <section
                        className="chat-directory"
                        aria-label="Список чатов"
                      >
                        <ChatsView
                          chats={chatItems}
                          users={users}
                          role={role}
                          onOpenChat={openChat}
                          onMessageUser={openUserChat}
                          onCallUser={(id) => startCall([id])}
                          onCompose={() => setComposeOpen(true)}
                          onToggleMute={toggleChatMute}
                          onArchiveChat={archiveChat}
                          onUnarchiveChat={unarchiveChat}
                          onTogglePin={toggleChatPin}
                          onDeleteChat={deleteChat}
                        />
                      </section>

                      <section
                        className="conversation-stage"
                        aria-label="Область переписки"
                      >
                        {selectedChatId ? (
                          <ChatView
                            key={selectedChat.id}
                            chat={selectedChat}
                            chats={chatItems}
                            users={users}
                            role={role}
                            messages={selectedMessages}
                            onBack={() => setSelectedChatId(null)}
                            onSend={(text, options) =>
                              sendMessage(selectedChat.id, text, options)
                            }
                            onClear={() => clearMessages(selectedChat.id)}
                            onCall={() =>
                              startCall(
                                selectedChat.kind === "group"
                                  ? (selectedChat.memberIds ?? [])
                                  : users.some(
                                        (user) =>
                                          user.id === selectedChat.id,
                                      )
                                    ? [selectedChat.id]
                                    : [],
                              )
                            }
                            onToggleMute={() =>
                              toggleChatMute(selectedChat.id)
                            }
                            onArchive={() => archiveChat(selectedChat.id)}
                            onUnarchive={() => unarchiveChat(selectedChat.id)}
                            onDelete={() => deleteChat(selectedChat.id)}
                            onAddParticipants={(participantIds) =>
                              addChatParticipants(
                                selectedChat.id,
                                participantIds,
                              )
                            }
                            onTogglePinnedMessage={(messageId) =>
                              togglePinnedMessage(
                                selectedChat.id,
                                messageId,
                              )
                            }
                            onForwardMessage={(messageId, targetChatId) =>
                              forwardMessage(
                                selectedChat.id,
                                messageId,
                                targetChatId,
                              )
                            }
                          />
                        ) : (
                          <div className="desktop-chat-empty">
                            <span aria-hidden="true">
                              <MessageCircle size={34} />
                            </span>
                            <h2>CIFRA Messenger</h2>
                            <p>
                              Выберите чат слева, чтобы открыть переписку.
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                const firstChat = chatItems.find(
                                  (chat) => !chat.deleted && !chat.archived,
                                );
                                if (firstChat) openChat(firstChat.id);
                              }}
                            >
                              Открыть первый чат
                            </button>
                          </div>
                        )}
                      </section>
                    </>
                  ) : (
                    <section
                      className="section-stage"
                      aria-label={
                        activeTab === "teams"
                          ? "Люди"
                          : activeTab === "calls"
                            ? "Звонки"
                            : "Профиль"
                      }
                    >
                      {activeTab === "teams" ? (
                        <TeamsView
                          users={users}
                          role={role}
                          onMessage={openUserChat}
                          onOpenUser={(id) => {
                            if (role !== "employee") {
                              setSelectedProfileUserId(id);
                            }
                          }}
                        />
                      ) : activeTab === "calls" ? (
                        <CallsView
                          calls={calls}
                          users={users}
                          onCall={startCall}
                        />
                      ) : (
                        <ProfileView
                          user={currentUser}
                          role={role}
                          theme={theme}
                          notificationMode={notificationMode}
                          authMode={authMode}
                          onRoleChange={changeRole}
                          onThemeChange={changeTheme}
                          onNotificationModeChange={changeNotificationMode}
                          onEditProfile={() => {
                            if (role === "admin") {
                              setSelectedProfileUserId("self");
                            }
                          }}
                          onAvatarChange={updateOwnAvatar}
                          onLogout={() => void logout()}
                        />
                      )}
                    </section>
                  )}
                </div>
              )}
            </div>

            {sessionActive &&
            !authSession?.context.must_change_password ? (
              <TabBar
                active={activeTab}
                notificationsEnabled={notificationMode === "on"}
                unreadCount={unreadChatCount}
                onChange={(tab) => {
                  setActiveTab(tab);
                  setSelectedChatId(null);
                }}
              />
            ) : null}

            <div className="home-indicator" aria-hidden="true" />

            {sessionActive &&
            !authSession?.context.must_change_password &&
            composeOpen ? (
              <ComposeSheet
                users={users}
                onClose={() => setComposeOpen(false)}
                onSelect={openUserChat}
                onCreateGroup={createGroup}
              />
            ) : null}

            {sessionActive &&
            !authSession?.context.must_change_password &&
            callOpen ? (
              <CallOverlay
                users={users}
                participantIds={callParticipantIds}
                onClose={() => {
                  setCallOpen(false);
                  setCallParticipantIds([]);
                }}
              />
            ) : null}

            {sessionActive &&
            authSession?.context.must_change_password ? (
              <PasswordChangeOverlay
                login={authSession.login}
                onChangePassword={changeOwnPassword}
              />
            ) : null}

            {sessionActive &&
            !authSession?.context.must_change_password &&
            role !== "employee" &&
            selectedProfileUser ? (
              <AdminUserSheet
                key={selectedProfileUser.id}
                user={selectedProfileUser}
                readOnly={!canManageUsers(role)}
                onClose={() => setSelectedProfileUserId(null)}
                onSave={updateUser}
                onDelete={deleteContact}
                onMessage={(id) => {
                  setSelectedProfileUserId(null);
                  openUserChat(id);
                }}
                onCall={(id) => {
                  setSelectedProfileUserId(null);
                  startCall([id]);
                }}
                onAudit={(user) => {
                  setSelectedProfileUserId(null);
                  setAuditUserId(user.id);
                }}
              />
            ) : null}

            {sessionActive &&
            !authSession?.context.must_change_password &&
            canAuditChats(role) &&
            auditUser ? (
              <AuditOverlay
                key={auditUser.id}
                user={auditUser}
                viewerRole={role}
                chats={chatItems}
                messagesByChat={messagesByChat}
                onClose={() => setAuditUserId(null)}
              />
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
