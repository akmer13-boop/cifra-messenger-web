[STAGE7C_TWO_USER_ACCEPTANCE_RU.md](https://github.com/user-attachments/files/30586626/STAGE7C_TWO_USER_ACCEPTANCE_RU.md)
# Stage 7C — проверка Web ↔ Tinode двумя пользователями

Документ предназначен для финальной проверки staging после безопасного слияния Step 14. На Step 13 автоматические тесты используют два независимых клиента и общий имитатор Tinode. Это проверяет клиентскую логику, но не заменяет проверку реальных сервисов Amvera.

## Ограничения безопасности

- `main` не изменять.
- Amvera до Step 14 оставлять на `integration-backend-stage7b-web`.
- `ciframigrate-staging` держать остановленным.
- Не вставлять access token, refresh token или realtime-ticket в консоль, снимки экрана и отчёт.
- Для проверки использовать два отдельных тестовых аккаунта и два изолированных браузерных профиля.

## Что уже проверяет автоматический тест

Автоматический сценарий создаёт двух независимых пользователей и проверяет:

1. отдельную авторизацию и отдельные realtime-сессии;
2. общий личный чат и общий групповой чат;
3. отправку текста в обе стороны;
4. серверный `seq` и разделение истории по topic;
5. `recv` и `read` от второго пользователя;
6. обрыв WebSocket у одного пользователя;
7. новый ticket и повторную авторизацию;
8. догрузку двух сообщений, отправленных во время обрыва;
9. подавление повторного `{data}` с тем же `topic + seq`;
10. отсутствие повторного подключения после logout;
11. очистку сообщений, metadata, receipts и подписок;
12. чистый повторный вход без данных предыдущей сессии.

## Диагностика в браузере

На корневом элементе `<main>` доступны безопасные атрибуты:

- `data-realtime-status`;
- `data-realtime-user-id`;
- `data-realtime-session-ready`;
- `data-realtime-connection-generation`;
- `data-realtime-reconnect-success-count`;
- `data-realtime-duplicate-message-count`;
- `data-realtime-last-error`;
- `data-realtime-selected-topic`;
- `data-realtime-message-count`;
- `data-realtime-remote-recv-seq`;
- `data-realtime-remote-read-seq`.

Они не содержат access token, refresh token или realtime-ticket.

Для просмотра состояния откройте DevTools → Console и выполните:

```js
const root = document.querySelector("main");
Object.fromEntries(
  [...root.attributes]
    .filter(({ name }) => name.startsWith("data-realtime-"))
    .map(({ name, value }) => [name, value]),
);
```

## Ручной сценарий после развёртывания Step 14

### 1. Вход

Откройте staging в двух изолированных профилях браузера:

- окно A — пользователь A;
- окно B — пользователь B.

Ожидается в обоих окнах:

```text
data-realtime-status = connected
data-realtime-session-ready = true
data-realtime-connection-generation = 1
data-realtime-reconnect-success-count = 0
data-realtime-last-error = пусто
```

`data-realtime-user-id` должен быть заполнен и различаться у пользователей.

### 2. Сообщение A → B

1. Откройте один и тот же личный чат.
2. Пользователь A отправляет уникальный текст, например `A-13-001`.
3. У пользователя B сообщение появляется один раз.
4. B открывает чат.

Ожидается:

- у A сообщение получает серверный статус `sent`;
- затем `delivered` после `recv` пользователя B;
- затем `read` после открытия чата пользователем B;
- `data-realtime-remote-recv-seq` и `data-realtime-remote-read-seq` у A не меньше `data-realtime-published-seq`.

### 3. Сообщение B → A

Повторите сценарий в обратную сторону с текстом `B-13-001`.

### 4. Разделение чатов

1. Откройте второй чат или группу.
2. Отправьте `GROUP-13-001`.
3. Вернитесь в первый чат.

Ожидается: сообщение второго topic не появляется в первом чате, непрочитанные и последнее сообщение считаются отдельно.

### 5. Обрыв сети и восстановление

1. В окне A включите DevTools → Network → Offline либо временно отключите сеть.
2. Дождитесь `data-realtime-status = reconnecting`.
3. В окне B отправьте два сообщения: `OFFLINE-13-001` и `OFFLINE-13-002`.
4. Верните сеть в окне A.

Ожидается:

```text
data-realtime-status = connected
data-realtime-connection-generation = 2
data-realtime-reconnect-success-count = 1
data-realtime-last-error = пусто
```

Оба пропущенных сообщения должны появиться один раз и в правильном порядке. `data-realtime-duplicate-message-count` может увеличиться, если сервер повторно прислал уже известный `topic + seq`; это означает, что клиент обнаружил и подавил дубль. В интерфейсе повторов быть не должно.

### 6. Logout и повторный вход

1. Выйдите из аккаунта A.
2. Убедитесь, что экран авторизации открыт.
3. Войдите в том же профиле другим тестовым пользователем.

Ожидается:

- старый `data-realtime-user-id` не сохраняется;
- старый выбранный topic не открывается;
- старые сообщения, metadata и receipts не видны;
- новая сессия начинается с `data-realtime-connection-generation = 1`.

## Критерии приёмки Step 13

Step 13 считается готовым для перехода к Step 14, когда:

- все автоматические тесты проходят;
- TypeScript/TSX не содержит синтаксических ошибок;
- в DOM нет секретов;
- logout очищает realtime-состояние и выбранный чат;
- подготовлен ручной сценарий для реального staging.

Фактическая проверка двух реальных аккаунтов и сервисов Amvera фиксируется после развёртывания Step 14.
