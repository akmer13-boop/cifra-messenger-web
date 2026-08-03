[STAGE1_FRONTEND_INTEGRATION_RU.md](https://github.com/user-attachments/files/30653657/STAGE1_FRONTEND_INTEGRATION_RU.md)
# Stage 1: безопасная база frontend-интеграции

Дата локальной сборки: 2026-08-03. Изменения подготовлены без операций в Git, без deploy, без изменения backend и без создания staging-аккаунтов.

## Зафиксированный вход

- Web snapshot из ZIP: `d5657a4b199b852e6db271018f7d9016ec6bf452` (значение ZIP comment, должно быть подтверждено в canonical Git перед созданием ветки).
- SHA-256 исходного ZIP: `344005189a9cfcbbe2ab6d4fc123f782f14083ae1221cb92285e4930a3eda7f7`.
- SHA-256 `package-lock.json`: `96d8c8544bd23fc6ceef6ec9f25c08b76d6a8a5b89ded3a82be6b11356e8ce45`.
- Backend revision из handoff: `efb6219553e3666bb9f2867ea32e5e16ec32d4e0`.
- SHA-256 backend handoff: `0dab4fbfc849f0c96aec42b1d4497cf9b1ace81be1f7dd077ddd8e19a6165c10`.

## Что сделано

1. Добавлена совместимость с `NEXT_PUBLIC_DATA_MODE=api` и `NEXT_PUBLIC_CIFRA_API_URL`. Runtime JSON остаётся запасным и управляемым способом конфигурации.
2. Исправлен same-origin realtime: пустой `apiBaseUrl` вычисляется относительно origin страницы. Проверки HTTPS → WSS, отсутствия ticket/token в URL и запрета внутренних Amvera run-hostnames сохранены.
3. Каталог теперь проходит все страницы `next_cursor`, дедуплицирует сотрудников, обнаруживает цикл cursor и ограничивает число страниц.
4. Текущий пользователь определяется только по backend session identity. Первый сотрудник каталога больше не может стать `self`; при отсутствии текущего пользователя используется безопасная проекция активной сессии.
5. Отправка текста стала асинхронной: composer очищается только после подтверждённого Tinode `seq`. Во время отправки повторное нажатие заблокировано; reject сохраняет черновик и reply context. При неопределённом результате после отправки frame слепой retry запрещён, потому что сообщение могло быть принято сервером.
6. В backend-режиме отключена имитация голосовых, вложений и звонков. Demo-режим сохранён только для локальной демонстрации.
7. Добавлены поведенческие и контрактные тесты Stage 1; `npm run check` теперь всегда включает TypeScript.

## Почему WebSocket env не подключён напрямую

Рабочий клиент уже использует `/api/v1/realtime/tickets`: Gateway выдаёт короткоживущий ticket вместе с разрешённым WSS endpoint. Прямое использование `NEXT_PUBLIC_CIFRA_WS_URL` или `NEXT_PUBLIC_TINODE_WS_URL` обошло бы этот security boundary. Значения можно оставить в конфигурации staging, но источником endpoint остаётся подписанный ответ Gateway.

## Что сознательно не входит в Stage 1

- encrypted media upload/download, chunked AES-256-GCM и Range playback;
- voice recording и voice-message publish;
- resume/retry upload и защита от дубля после потерянного ACK;
- WebRTC calls, push, Service Worker background upload;
- deploy `cifraweb-staging`, запуск сервиса, аккаунты A/B/C и общий чат.

Интерфейс не изображает перечисленные функции работающими в backend-режиме.

## Блокеры Stage 2 (media/voice)

До реализации нужны подтверждённые backend-артефакты:

- актуальные OpenAPI и обе JSON Schema;
- authenticated capabilities response/schema;
- crypto golden vectors (`WEB-GATE-CRYPTO-01`);
- точный контракт получения recipient media DEK;
- точный `client_msg_id` contract и серверная дедупликация;
- письменное решение product owner, что voice входит в Web scope (`WEB-SCOPE-VOICE-01`);
- поддерживаемые MIME/codecs, duration/size/parts limits.

Без golden vectors результат media crypto нельзя маркировать PASS. Без `client_msg_id` нельзя безопасно делать автоматический retry после неопределённого результата publish.

## Порядок после снятия блокеров

1. Реализовать crypto/media boundaries и unit/integration tests локально.
2. Передать frontend patch/ветку на review.
3. Только после отдельного разрешения развернуть frontend-ветку на `https://cifraweb-staging-ilyaman.amvera.io`.
4. Подготовить dedicated A/B/C, общий direct/group chat и capability matrix.
5. Выполнить двухпользовательский upload → processing → ready → publish → encrypted Range → decrypt → playback, затем network break → resume без дубля.

`localhost:3000` не используется для живой staging-проверки, потому что он не разрешён staging CORS.

## Локальная верификация

Среда проверки: Node `v24.14.0`, npm `11.9.0`. Команда `npm run check` запущена с предоставленными staging `NEXT_PUBLIC_*`:

- ESLint: PASS;
- TypeScript: PASS;
- tests: `160/160` PASS;
- Next.js production static build: PASS;
- `npm audit --audit-level=high`: `0 vulnerabilities`.

Живые Gateway/Tinode/media сценарии не запускались: официальный frontend staging остановлен, localhost отсутствует в CORS allowlist, dedicated аккаунты и общий чат не предоставлены.
