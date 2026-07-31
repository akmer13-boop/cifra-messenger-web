# Stage 7C — финальная интеграция Web ↔ Tinode

## Цель

Безопасно слить готовую ветку Web realtime в staging-интеграцию, дождаться сборки Amvera и проверить работу двумя реальными пользователями. Этот этап не включает развёртывание нового backend и не требует запуска миграций.

## Фиксированные ветки

- исходная ветка: `feature-stage7c-web-real-messages`;
- целевая ветка PR: `integration-backend-stage7b-web`;
- `main` не изменять;
- Amvera должна продолжать отслеживать `integration-backend-stage7b-web`.

## Ограничения безопасности

- `ciframigrate-staging` держать остановленным;
- не запускать миграции `0003` и `0004` в рамках Stage 7C;
- не менять секреты, пароли, PostgreSQL, Tinode, Gateway и Worker;
- не менять runtime-конфигурацию Web;
- не выводить access token, refresh token и realtime-ticket в отчёт или снимки экрана;
- использовать `Create a merge commit`, без squash и rebase.

## Проверка перед PR

1. В ветке отсутствуют временные дубликаты `app/sd` и `app/gdg`.
2. Документ `docs/STAGE7C_TWO_USER_ACCEPTANCE_RU.md` начинается с заголовка, а не со ссылки на вложение.
3. Автоматические тесты проходят полностью.
4. В PR нет изменений `main`, backend, миграций и конфигурации сервисов Amvera.
5. Base PR выбран как `integration-backend-stage7b-web`, head — `feature-stage7c-web-real-messages`.

## Безопасная последовательность внедрения

1. Создать PR из `feature-stage7c-web-real-messages` в `integration-backend-stage7b-web`.
2. Проверить отсутствие конфликтов и просмотреть список изменённых файлов.
3. Дождаться зелёного результата всех доступных CI-проверок.
4. Выполнить `Create a merge commit`.
5. Убедиться, что Amvera начала сборку ветки `integration-backend-stage7b-web`.
6. Дождаться успешной сборки и запуска Web.
7. Проверить runtime-конфигурацию и подключение WebSocket.
8. Провести двухпользовательскую проверку по `STAGE7C_TWO_USER_ACCEPTANCE_RU.md`.
9. Зафиксировать результат в таблице ниже.

## Проверка staging

Адрес Web:

```text
https://cifraweb-staging-ilyaman.amvera.io
```

Ожидаемая runtime-конфигурация:

```json
{
  "mode": "backend",
  "apiBaseUrl": "https://cifragateway-staging-ilyaman.amvera.io",
  "requestTimeoutMs": 15000,
  "demoMfaCode": ""
}
```

Ожидаемый CORS Origin Gateway:

```text
https://cifraweb-staging-ilyaman.amvera.io
```

Без `/` в конце.

Минимальная браузерная проверка:

```js
document.querySelector("main")?.getAttribute("data-realtime-status")
```

Ожидаемый результат:

```text
connected
```

## Критерии приёмки

Stage 7C принимается, когда одновременно выполнено следующее:

- сборка Web в Amvera успешна;
- оба пользователя получают `data-realtime-status = connected`;
- список содержит только реальные Tinode-чаты в backend-режиме;
- сообщения A → B и B → A доставляются по одному разу;
- статусы доходят до `sent`, `delivered`, `read`;
- истории разных topics не смешиваются;
- после обрыва сети выполняется reconnect с новым ticket;
- пропущенные сообщения догружаются без дублей;
- logout очищает realtime-состояние;
- повторный вход не показывает данные предыдущего пользователя;
- `main` не изменён;
- `ciframigrate-staging` остаётся остановленным.

## Протокол результата

| Проверка | Результат | Примечание |
|---|---|---|
| PR без конфликтов | ☐ | |
| CI успешно | ☐ | |
| Merge commit выполнен | ☐ | |
| Amvera build успешно | ☐ | |
| WebSocket connected у A | ☐ | |
| WebSocket connected у B | ☐ | |
| A → B | ☐ | |
| B → A | ☐ | |
| delivered/read | ☐ | |
| Несколько topics | ☐ | |
| Reconnect | ☐ | |
| Догрузка без дублей | ☐ | |
| Logout и повторный вход | ☐ | |
| `ciframigrate-staging` остановлен | ☐ | |

## Откат

При критической ошибке не трогать `main`, backend и миграции. Откатить только Web staging на предыдущий успешный commit ветки `integration-backend-stage7b-web`, затем повторно проверить runtime-конфигурацию и состояние `ciframigrate-staging`.
