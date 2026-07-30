export const corporateRoles = Object.freeze([
  "employee",
  "admin",
  "security_moderator",
]);

export const userRoles = Object.freeze([
  "employee",
  "admin",
  "moderator",
]);

export const appPermissions = Object.freeze([
  "users.read",
  "users.create",
  "users.update",
  "users.delete",
  "roles.manage",
  "chats.view_all",
  "chats.moderate",
]);

const rolePermissions = Object.freeze({
  employee: Object.freeze(["users.read"]),
  admin: appPermissions,
  moderator: Object.freeze([
    "users.read",
    "chats.view_all",
    "chats.moderate",
  ]),
});

export function roleFromWire(role) {
  if (role === "security_moderator" || role === "moderator") {
    return "moderator";
  }
  if (role === "admin") return "admin";
  return "employee";
}

export function wireRole(role) {
  return role === "moderator" ? "security_moderator" : role;
}

export function primaryRole(roles) {
  const normalized = new Set(roles.map(roleFromWire));
  if (normalized.has("admin")) return "admin";
  if (normalized.has("moderator")) return "moderator";
  return "employee";
}

export function roleDisplayName(role) {
  if (role === "admin") return "Администратор";
  if (role === "moderator") return "Модератор";
  return "Сотрудник";
}

export function roleShortName(role) {
  if (role === "admin") return "Админ";
  if (role === "moderator") return "Модератор";
  return "Сотрудник";
}

export function requiresMfa(role) {
  return role === "admin" || role === "moderator";
}

export function permissionsFor(roles) {
  return [
    ...new Set(
      roles.flatMap((role) => rolePermissions[roleFromWire(role)] ?? []),
    ),
  ];
}

export function hasPermission(roles, permission) {
  return permissionsFor(roles).includes(permission);
}

export function canManageUsers(role) {
  return hasPermission([role], "users.update");
}

export function canAuditChats(role) {
  return hasPermission([role], "chats.view_all");
}
