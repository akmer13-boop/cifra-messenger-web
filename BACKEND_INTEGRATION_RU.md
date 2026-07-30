# Подключение CIFRA Web к локальному бэкенду компании

Инструкция относится к комплекту:

- CIFRA Web v22;
- `cifragateway`;
- `ciframigrate`;
- `cifra-worker`;
- `cifra-tinode`;
- PostgreSQL 16;
- при необходимости `cifrapgadmin`.

## 1. Что уже связано

WEB использует точные маршруты вложенного Gateway:

| Операция | Endpoint |
|---|---|
| логин | `POST /api/v1/auth/login` |
| проверка TOTP | `POST /api/v1/auth/mfa/verify` |
| ротация токенов | `POST /api/v1/auth/refresh` |
| выход | `POST /api/v1/auth/logout` |
| роли текущей сессии | `GET /api/v1/auth/context` |
| смена временного/собственного пароля | `POST /api/v1/auth/password/change` |
| каталог | `GET /api/v1/users` |
| создание сотрудника | `POST /api/v1/admin/users` |
| профиль/статус | `PATCH /api/v1/admin/users/{id}` |
| назначение ролей | `PUT /api/v1/admin/users/{id}/roles` |
| отключение | `POST /api/v1/admin/users/{id}/disable` |

Клиент передаёт обязательные `Idempotency-Key` и `If-Match`, обрабатывает
safe error envelope, обновляет access/refresh pair и не доверяет локальному
переключателю роли в backend‑режиме.

## 2. Рекомендуемая схема локального контура

```text
браузер
  │ https://messenger.company.local
  ▼
корпоративный reverse proxy
  ├── /, assets           → статический CIFRA Web
  ├── /api/v1/*           → Gateway :6060
  └── /api/v1/tinode      → Gateway WebSocket proxy
                              ├── PostgreSQL 16
                              ├── Worker
                              └── Tinode 0.25.3
```

WEB и API должны быть доступны под одним HTTPS‑origin. Тогда
`apiBaseUrl` остаётся пустым, CORS не требуется, а WSS автоматически идёт
через тот же домен.

## 3. Подготовка локального сервера

Минимум:

- Linux x86_64;
- Docker Engine и Docker Compose v2;
- 4 CPU, 8 GB RAM для тестового контура;
- постоянные тома PostgreSQL, Tinode и media;
- корпоративный DNS;
- TLS‑сертификат корпоративного CA или публичного центра;
- закрытый secret store либо root‑only secret files.

Распакуйте интеграционный ZIP в отдельную директорию. В нём уже находятся
`web-source`, пять backend‑директорий, OpenAPI и шаблоны локального контура.

## 4. Runtime‑конфигурация WEB

В `web-source/public/cifra-runtime-config.json` должно быть:

```json
{
  "mode": "backend",
  "apiBaseUrl": "",
  "requestTimeoutMs": 15000,
  "demoMfaCode": ""
}
```

После изменения выполните:

```bash
cd web-source
npm ci
npm run check
```

Статический результат появится в `web-source/out`.

## 5. Настройка Gateway

Возьмите полный перечень из `backend/cifragateway/.env.example`. Критичные
значения:

```env
APP_ENV=production
APP_HOST=0.0.0.0
APP_PORT=6060
PUBLIC_BASE_URL=https://messenger.company.local
POSTGRES_DSN=postgres://...
SESSION_SIGNING_KEY_REF=file:/run/secrets/session-signing-key
TINODE_HTTP_URL=http://tinode:6060
TINODE_WS_URL=ws://tinode:6060/v0/channels
PUBLIC_TINODE_WS_URL=wss://messenger.company.local/api/v1/tinode
TINODE_API_KEY_REF=file:/run/secrets/tinode-api-key
TINODE_AUTH_SHARED_SECRET_REF=file:/run/secrets/tinode-auth-shared-secret
CORS_ORIGINS=https://messenger.company.local
RESET_DB=false
```

Не помещайте реальные значения в ZIP, Git, compose YAML или скриншоты.
`RESET_DB` в staging/production всегда остаётся `false`.

Tinode требует новую API key/salt pair из официального keygen версии 0.25.3.
Demo‑pair из image запрещена. Точные ограничения форматов описаны в
`backend/cifragateway/docs/ENVIRONMENT.md`.

## 6. Миграции и порядок запуска

Перед первым запуском и каждым обновлением сделайте backup PostgreSQL.

Для вложенной версии backend применяется управляемая последовательность:

```bash
node dist/cli/migrate.js up 0001
node dist/cli/migrate.js up 0002

node dist/cli/migrate.js preflight 0003
node dist/cli/migrate.js up 0003
node dist/cli/migrate.js backfill 0003
node dist/cli/migrate.js verify 0003
```

Миграцию `0004` выполняйте только после успешного Tinode smoke и по процедуре
из `backend/cifragateway/docs/OPERATIONS.md`. WEB и Worker не должны запускать
миграции автоматически.

## 7. Первый администратор и MFA

Gateway уже требует MFA для ролей `admin` и `security_moderator`. Первый
администратор создаётся одноразовой командой `bootstrap:admin`:

```env
BOOTSTRAP_ADMIN_LOGIN=<login>
BOOTSTRAP_ADMIN_PASSWORD=<temporary-strong-password>
BOOTSTRAP_ADMIN_FIRST_NAME=<name>
BOOTSTRAP_ADMIN_LAST_NAME=<surname>
BOOTSTRAP_ADMIN_TOTP_SECRET_REF=file:/run/secrets/mfa/admin.totp
```

```bash
npm run bootstrap:admin
```

TOTP secret не печатается и не хранится в базе открытым текстом: база содержит
только ссылку `env:` или `file:`. Секрет должен быть добавлен в приложение
аутентификатора пользователя через защищённый корпоративный процесс.

Если Gateway возвращает `must_change_password: true`, WEB блокирует остальные
экраны и показывает форму обязательной смены временного пароля. После
успешного `POST /api/v1/auth/password/change` Gateway отзывает активные сессии,
поэтому пользователь должен войти повторно уже с новым паролем.

Во вложенном backend нет публичного endpoint самостоятельной регистрации
MFA. Это намеренно закрытый контур. Для нового модератора фактор назначается
администратором через включённую в интеграционный архив one‑shot команду
`npm run provision:mfa`; её переменные и пример запуска находятся в корневом
`LOCAL_SERVER_RUNBOOK_RU.md`.

Без активной строки `mfa_factors` логин привилегированной роли всегда дойдёт
до challenge, но любой код будет отклонён.

## 8. Роли

| Gateway role | WEB | Разрешено |
|---|---|---|
| `employee` | Сотрудник | собственные чаты и корпоративный каталог |
| `admin` | Администратор | user mutations, роли, settings, audit/compliance |
| `security_moderator` | Модератор | audit/compliance и скрытый просмотр; без user mutations |

Администратор назначает модератора в карточке сотрудника. WEB отправляет роли
`["employee", "security_moderator"]`. Gateway проверяет недавнюю MFA,
аудитирует изменение и защищает инвариант последнего активного администратора.

## 9. Reverse proxy

В интеграционном ZIP есть готовый Nginx‑шаблон. Обязательные параметры:

```nginx
location /api/v1/tinode {
    proxy_pass http://gateway:6060;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}

location /api/ {
    proxy_pass http://gateway:6060;
}
```

Для `/cifra-runtime-config.json` отключите cache. Иначе браузер может
продолжить demo‑режим после переключения.

## 10. Проверка после подключения

```bash
curl -fsS https://messenger.company.local/health.json
curl -fsS https://messenger.company.local/health/live
curl -fsS https://messenger.company.local/health/ready
```

Затем проверьте:

1. `employee` входит без MFA;
2. `admin` получает challenge и входит с TOTP;
3. `security_moderator` получает challenge;
4. пользователь с временным паролем не проходит дальше формы смены пароля;
5. после смены пароля старая сессия отозвана, новый вход работает;
6. модератор видит аудит, но не может изменить сотрудника;
7. администратор меняет роль; операция появляется в audit;
8. access token обновляется через rotating refresh;
9. logout отзывает сессию;
10. WebSocket `/api/v1/tinode` отвечает `101 Switching Protocols`;
11. входящие/исходящие сообщения обновляют preview, ticks и позицию чата.

## 11. Ограничение текущего backend

Техническое задание backend рекомендует для WEB `HttpOnly + Secure +
SameSite` cookie, но фактический вложенный API возвращает refresh token в JSON.
Для совместимости текущий клиент хранит пару только в `sessionStorage`, не в
`localStorage`, и очищает её при logout. Перед production security review
рекомендуется добавить same‑origin BFF/cookie‑режим в Gateway. CSP, защита от
XSS и TLS обязательны уже сейчас.

Полный список диагностик: `POSSIBLE_ERRORS_RU.md`.
