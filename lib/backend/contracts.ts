export type DevicePlatform =
  | "ios"
  | "android"
  | "web"
  | "desktop"
  | "unknown";

export type LoginRequest = {
  login: string;
  password: string;
  device: {
    id: string;
    name: string;
    platform: DevicePlatform;
  };
};

export type CifraUser = {
  id: string;
  displayName: string;
  username: string;
  email?: string;
  phone?: string;
  role: "admin" | "moderator" | "employee";
  online?: boolean;
};

export type CifraChat = {
  id: string;
  title: string;
  type: "direct" | "group";
  memberIds: string[];
  unreadCount: number;
  pinned: boolean;
  muted: boolean;
  archived: boolean;
};

export type CifraMessage = {
  id: string;
  clientMessageId: string;
  chatId: string;
  senderId: string;
  text?: string;
  createdAt: string;
  status: "sending" | "sent" | "delivered" | "read" | "failed";
};

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};
