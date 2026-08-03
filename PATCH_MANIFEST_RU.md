[PATCH_MANIFEST_RU.md](https://github.com/user-attachments/files/30653608/PATCH_MANIFEST_RU.md)
# Состав patch Stage 1

Архив содержит только новые и изменённые файлы относительно переданного Web ZIP. `node_modules`, `.next`, `out`, логи и другие результаты локальной сборки не включены.

## Применение

1. Подтвердить в canonical Git, что исходная точка соответствует snapshot `d5657a4b199b852e6db271018f7d9016ec6bf452`.
2. Создать frontend-ветку отдельно от backend.
3. Распаковать архив в корень `cifra-messenger-web` с сохранением путей.
4. Запустить `npm ci`, затем `npm run check`.
5. Не выполнять deploy до отдельного разрешения и снятия перечисленных в `docs/STAGE1_FRONTEND_INTEGRATION_RU.md` блокеров.

## Файлы

- `.env.example`
- `.gitignore`
- `PATCH_MANIFEST_RU.md`
- `app/cifra-api.ts`
- `app/cifra-realtime.ts`
- `app/directory-pagination-policy.mjs`
- `app/globals.css`
- `app/message-send-policy.mjs`
- `app/page.tsx`
- `docs/STAGE1_FRONTEND_INTEGRATION_RU.md`
- `package.json`
- `tests/directory-pagination-policy.test.mjs`
- `tests/interaction-contract.test.mjs`
- `tests/message-send-policy.test.mjs`
- `tests/realtime-page-backend-source.test.mjs`
- `tests/realtime-page-chat-observer.test.mjs`
- `tests/realtime-page-render-messages.test.mjs`
- `tests/realtime-same-origin.test.mjs`
- `tests/stage1-integration-contract.test.mjs`
- `tests/stage7d-web-ux.test.mjs`
- `tests/web-security-regressions.test.mjs`

`package-lock.json` не менялся.
