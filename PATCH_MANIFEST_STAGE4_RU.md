[PATCH_MANIFEST_STAGE4_RU.md](https://github.com/user-attachments/files/30708391/PATCH_MANIFEST_STAGE4_RU.md)
# Manifest frontend-пакета Stage 4

Основа сравнения: каталог `stage4_baseline`, снятый до начала Stage 4. Ниже перечислены только исходники, тесты и документация. Generated-каталоги и файлы (`node_modules`, `.next`, `out`, `*.tsbuildinfo`) не входят в пакет.

## Заменить существующие файлы

- `app/cifra-api.ts`
- `app/cifra-realtime.ts`
- `app/globals.css`
- `app/page.tsx`
- `tests/rbac-mfa-integration.test.mjs`
- `tests/realtime-page-backend-source.test.mjs`
- `tests/stage1-integration-contract.test.mjs`
- `tests/stage7d-web-ux.test.mjs`
- `tests/typography-contract.test.mjs`

## Добавить новые файлы

- `app/directory-release-policy.mjs`
- `app/error.tsx`
- `app/session-recovery-policy.mjs`
- `docs/STAGE4_RELEASE_READINESS_RU.md`
- `PATCH_MANIFEST_STAGE4_RU.md`
- `tests/stage4-directory-release.test.mjs`
- `tests/stage4-history-pagination.test.mjs`
- `tests/stage4-runtime-recovery.test.mjs`

## Не переносить

- `node_modules/`
- `.next/`
- `out/`
- `tsconfig.tsbuildinfo` и любые другие generated `*.tsbuildinfo`

Остальные файлы относительно `stage4_baseline` не заменяются.
