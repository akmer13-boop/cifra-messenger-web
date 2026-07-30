# Возможные ошибки при подключении CIFRA Web

## Amvera и сборка

### `503 Service Unavailable`

Причины: выбран серверный тип приложения, нет статического artifact, осталась
старая команда запуска или публикация ещё не завершена.

Проверка:

- окружение Amvera: `Node → Browser 22`;
- `amvera.yml` находится в корне ZIP;
- build завершился успешно;
- создан `out/index.html`;
- в Artifacts опубликовано правило `"out/*": /`;
- `containerPort` и `npm start` не заданы.

После смены типа проекта безопаснее создать новое Browser‑приложение и
загрузить ZIP туда.

### `Cannot find module '@tailwindcss/postcss'`

Собирается старый revision или кэш. В этой версии Tailwind не используется,
зависимости нет, а `postcss.config.mjs` содержит пустой список plugins.
Очистите build cache/Artifacts и запустите полную пересборку из нового ZIP.

### `npm ci` сообщает lock mismatch / `Invalid Version`

Используйте Node 22 и npm 10, указанные в `amvera.yml` и `packageManager`.
В `.npmrc` уже включён совместимый `legacy-peer-deps=true` для optional WASM
binding Next.js. Не выполняйте произвольное `npm update` перед deployment.

## Сеть

### `NETWORK_ERROR` / «Не удалось подключиться к серверу CIFRA»

- локальный Gateway недоступен из сети браузера;
- корпоративный DNS не резолвится;
- пользователь не подключён к VPN;
- firewall блокирует 443;
- в runtime‑config указан внутренний Docker hostname.

Браузер должен обращаться к публичному для корпоративной сети адресу
`https://messenger.company.local`, а не к `gateway:6060`.

### CORS

Если WEB и API на разных origin, добавьте точный WEB origin в
`CORS_ORIGINS`. Не используйте `*` с credentials. Рекомендуемый вариант —
same‑origin reverse proxy и пустой `apiBaseUrl`.

### Mixed content

HTTPS‑страница не может обращаться к `http://` или `ws://`. Используйте
HTTPS/WSS снаружи; HTTP/WS допустимы только между внутренними контейнерами.

### WebSocket закрывается / нет `101`

Проверьте `Upgrade`, `Connection`, HTTP/1.1, proxy timeout,
`PUBLIC_TINODE_WS_URL`, доступность Tinode и совпадение shared secret.
Прямой порт Tinode наружу не публикуется.

## Авторизация и MFA

### `MFA_CODE_INVALID`

- неверный TOTP;
- часы сервера/телефона расходятся;
- secret в authenticator не совпадает с secret resolver;
- фактор отсутствует или revoked.

Синхронизируйте NTP и проверьте активную запись `mfa_factors`, не выводя сам
секрет в логи.

### `MFA_CHALLENGE_INVALID`

Challenge истёк (в данной сборке 300 секунд), уже использован либо превышены
5 попыток. Вернитесь к логину и создайте новый challenge.

### Привилегированный пользователь никогда не проходит MFA

Роль назначена, но TOTP factor не provisioned. Выполните защищённую
`provision:mfa` процедуру. Назначение роли и создание MFA‑фактора — разные
операции.

### `STEP_UP_REQUIRED`

Для изменения ролей, статуса и критичных операций MFA должна быть недавней
(`STEP_UP_MAX_AGE_SECONDS`, обычно 300). В текущем контракте отдельного
step‑up endpoint нет: выйдите и войдите заново с MFA.

### `AUTH_REQUIRED`, refresh reuse или внезапный logout

Refresh token ротируется. Два параллельных клиента не должны повторно
использовать старый token. WEB сериализует refresh, но копии вкладки могут
иметь отдельные сессии. При reuse Gateway отзывает token family — выполните
новый вход и проверьте возможную компрометацию.

### `ACCOUNT_UNAVAILABLE` / `423`

Учётная запись blocked/disabled/archived, временный пароль истёк либо устройство
отозвано. Состояние исправляет администратор, а не frontend.

### Форма смены временного пароля не закрывается

Gateway вернул `must_change_password: true`, поэтому это штатная блокировка.
Новый пароль должен пройти серверную политику (не менее 12 символов и без
логина пользователя). При `CURRENT_PASSWORD_INVALID` проверьте именно
временный пароль. После успешной смены Gateway отзывает все сессии — повторный
вход является ожидаемым поведением.

## RBAC и сотрудники

### `ROLE_REQUIRED` / `403`

Роль из UI не выдаёт права. Проверьте `/api/v1/auth/context` и реальные
`user_roles`. Модератор намеренно не может менять сотрудников или роли.

### `LAST_ADMIN_*` / `409`

Нельзя отключить последнего активного администратора или снять с него
`admin`. Сначала назначьте второго активного администратора с MFA.

### `IF_MATCH_REQUIRED` / `428` или version conflict

PATCH профиля требует актуальный `If-Match`. Обновите каталог и повторите
операцию с новой `version`; не затирайте параллельные изменения.

### `IDEMPOTENCY_KEY_REQUIRED`

Create/disable/password reset требуют уникальный `Idempotency-Key`. WEB‑клиент
его отправляет. Ошибка обычно означает ручной запрос или proxy, удаливший
заголовок.

## Backend и база

### Gateway readiness `503`

Проверьте PostgreSQL, применённые migrations, Tinode, secret refs, права на
media volume и обязательные production gates. Liveness `200` при readiness
`503` означает, что процесс жив, но зависимость не готова.

### `secret_ref` не разрешается

Файл не смонтирован в тот же путь внутри Gateway, env отсутствует или у
пользователя контейнера нет read permission. Используйте абсолютный
`file:/run/secrets/...` и права только на чтение.

### Ошибки migration `0003/0004`

Не запускайте `0004`, пока не выполнены backfill, `verify 0003` и Tinode
smoke. Перед повтором изучите runbook backend; не применяйте `down` в
production.

### pgAdmin не открывается

`cifrapgadmin` — отдельный опциональный image и не часть Gateway. Не
публикуйте его в интернет; разрешайте доступ только из админской сети/VPN и
не используйте общий пароль.

## Диагностические данные для обращения

Передайте администратору:

- время и timezone;
- HTTP status;
- безопасный `error.code`;
- `request_id`;
- endpoint без токенов и паролей;
- роль из `/api/v1/auth/context`;
- build version WEB/backend.

Никогда не отправляйте access/refresh token, пароль, TOTP secret, DSN,
Tinode API key или signing key.
