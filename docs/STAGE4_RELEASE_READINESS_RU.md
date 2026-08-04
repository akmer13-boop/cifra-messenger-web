[STAGE4_RELEASE_READINESS_RU.md](https://github.com/user-attachments/files/30708346/STAGE4_RELEASE_READINESS_RU.md)
# Stage 4: frontend release-readiness для пилота 500–1000 сотрудников

Дата локальной реализации: 2026-08-04. Пакет подготовлен только в рабочем frontend-каталоге. GitHub, merge, deploy, staging и backend не изменялись. Новые backend endpoints не требуются.

Stage 4 закрывает риски большого каталога, глубокой Tinode-истории и восстановления интерфейса. Это code-level готовность frontend, а не разрешение на запуск 500–1000 одновременных пользователей: нагрузочная и staging-приёмка перечислены отдельно ниже.

## Каталог и поиск

- При входе Web получает только первую страницу `GET /api/v1/users?limit=100`; весь каталог больше не является обязательным условием открытия приложения.
- Следующая страница запрашивается по opaque `next_cursor` при приближении к концу списка либо по кнопке «Показать ещё».
- Текущий пользователь `self` сохраняется в каталоге даже при пустой первой странице, ошибке или отсутствии его записи в серверной выдаче.
- Строка поиска нормализуется и ограничивается 96 символами. В backend-режиме поиск выполняется сервером через `query` и тот же cursor contract, а не фильтрует только уже загруженные 100 записей.
- Новый query немедленно отменяет старый запрос через `AbortController`, сбрасывает старый cursor/result и меняет request epoch. Запоздавший ответ не может перезаписать актуальную выдачу.
- Страницы объединяются по user ID. Повторённый либо циклический cursor останавливает пагинацию fail-closed.
- Основной список сотрудников и списки выбора участников используют windowing без новой зависимости. В тестах на 500 и 1000 записей одновременно остаётся не более 20 строк DOM при заданном viewport.

Backend обязан сохранять действующий контракт `items + next_cursor`, поддерживать `query`, считать cursor opaque и не повторять cursor. Отдельного `total` в контракте нет, поэтому число контактов в карточке означает число уже загруженных записей, а не гарантированный размер всей организации.

## Глубокая история сообщений

Текущий Tinode wire уже позволяет загружать старые данные без нового REST endpoint. Для прикреплённого readable topic Web отправляет:

```json
{
  "get": {
    "topic": "<topic>",
    "what": "data",
    "data": { "before": 51, "limit": 50 }
  }
}
```

- `before` всегда равен минимальному локальному `seq`; UI запрашивает 50 сообщений, а клиент жёстко ограничивает любую страницу диапазоном до 100.
- Запрос разрешён только для известного, readable и реально subscribed topic при открытом WebSocket.
- Одновременные запросы одной страницы одного topic объединяются в один Promise.
- Данные другого topic игнорируются; сообщения дедуплицируются по `(topic, seq)` и хранятся в порядке `seq`.
- Пагинация завершается на `seq=1`, пустой/короткой странице либо уже исчерпанном topic. Повтор страницы не добавляет дубли и не продолжает бесконечный цикл.
- Перед реальным prepend UI запоминает `scrollHeight` и `scrollTop`, затем восстанавливает положение в `useLayoutEffect`. Пустая, дублирующаяся или ошибочная страница очищает snapshot; защитный таймер не позволяет применить его к более позднему realtime-сообщению.
- Пользователь видит состояния загрузки, начала переписки и безопасную кнопку retry.

Поведенческий FakeWebSocket-тест проверяет page wire, topic scope, bounded limit, coalescing, deduplication и загрузку истории до `seq=1`.

## Runtime recovery и сессия

- `app/error.tsx` перехватывает ошибку route UI и предлагает `reset()` либо полную перезагрузку.
- Экран не показывает `message`, `stack`, `cause`, токены или request payload. Для поддержки выводится только очищенный Next digest длиной до 128 символов.
- Первый `AUTH_REQUIRED`/`ACCESS_TOKEN_INVALID` авторизованного запроса по-прежнему проходит штатный refresh path.
- `NETWORK_ERROR`, timeout, отмена запроса и realtime reconnect не закрывают сессию и не превращаются в logout.
- Сессия локально завершается только после явного `SESSION_EXPIRED`, `SESSION_REVOKED`, `ACCOUNT_UNAVAILABLE` либо окончательного отказа refresh (`REFRESH_TOKEN_INVALID`, reuse/rotation conflict и аналогичный terminal response).
- После ротации новая token pair принимается до обновления auth context. Временный сетевой сбой context не заставит повторно использовать уже погашенный refresh token.
- При terminal response Web останавливает realtime, отменяет каталог, очищает пользовательские UI-данные и показывает понятное состояние повторного входа. Обычный пользовательский logout остаётся отдельным сценарием.
- Access/refresh token по-прежнему живут только в памяти; reload требует нового входа до появления HttpOnly cookie/BFF-сессии.

## Локальная проверка

На Node `v24.14.0` выполнен:

```bash
npm run check
```

- ESLint: PASS;
- TypeScript: PASS;
- Web tests: `199/199` PASS;
- Next.js 16.2.12 static production build: PASS.

Покрытие Stage 4 включает каталоги 500/1000, cursor cycle, stale search epoch, bounded DOM window, Tinode older-history wire/dedup/topic scope/scroll cleanup, session classifier и безопасный error boundary. Локальный PASS не подменяет браузерную staging-приёмку.

## Что Stage 4 намеренно не включает

- `publishPrepared()` и incoming receiver UI для файлов/голосовых не включены. Сохраняются подтверждённые gates Stage 3: исторический sender signing key/identity, атомарный commit+dedupe и staging migration `0006`.
- Звонки в backend-режиме не объявляются рабочими: WebRTC/signaling — отдельный этап.
- Не добавлены push delivery, централизованный crash collector и offline message cache.
- Не доказана backend/infrastructure ёмкость на 500–1000 одновременных сессий: нужны нагрузочные профили REST, WebSocket/Tinode, PostgreSQL/Redis/media worker, лимиты Amvera и мониторинг SLO.
- Не выполнены deploy и двухпрофильная staging-приёмка. Нужны разрешённый frontend origin, два dedicated аккаунта, общий writable чат и тест reconnect/history на реальном Tinode.

Только после этих проверок Stage 4 можно использовать как часть решения о пилотном доступе. Сам frontend-пакет не заменяет security review, backend readiness и operational runbook.
