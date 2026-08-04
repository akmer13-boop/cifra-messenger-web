# Patch Stage 3: куда положить каждый файл

Корень назначения — каталог frontend-репозитория `cifra-messenger-web`, в котором лежит `package.json`. Пути ниже окончательные.

## Заменить существующие файлы Stage 2

- `app/cifra-api.ts`
- `app/cifra-realtime.ts`
- `lib/media/contracts.ts`
- `lib/media/crypto.ts`
- `lib/media/device-key-store.ts`
- `lib/media/media-upload-coordinator.ts`
- `lib/media/protocol.mjs`
- `tests/realtime-publish-text.test.mjs`
- `tests/stage2-media-contract.test.mjs`
- `tsconfig.json`
- `docs/STAGE2_MEDIA_PIPELINE_RU.md`
- `README.md`

## Добавить новые файлы

- `lib/media/cifra-crypto-v1.mjs`
- `lib/media/cifra-crypto-v1.d.mts`
- `lib/media/message-crypto.ts`
- `tests/cifra-crypto-v1.test.mjs`
- `tests/stage3-contract-parsers.test.mjs`
- `tests/stage3-integration-contract.test.mjs`
- `tests/stage3-media-roundtrip.test.mjs`
- `tests/fixtures/crypto-golden-vectors.json`
- `tests/fixtures/compliance-rsa-oaep-fixture.json`
- `docs/STAGE3_CRYPTO_MEDIA_RU.md`
- `PATCH_MANIFEST_STAGE3_RU.md`

## Не переносить

- backend snapshot/ZIP;
- `node_modules`, `.next`, `out`, `tsconfig.tsbuildinfo`;
- реальные/staging private compliance keys, raw DEK, tokens или staging credentials.

`tests/fixtures/compliance-rsa-oaep-fixture.json` переносить нужно: это официальный публичный test-only vector из backend snapshot. Его известный test private JWK используется только в Node regression test, не импортируется runtime-кодом и не является staging/production ключом.

## Проверка

Из корня frontend:

```bash
npm ci
npm run check
```

Не подключать `publishPrepared()` в `app/page.tsx` и не выполнять deploy до закрытия backend gates из `docs/STAGE3_CRYPTO_MEDIA_RU.md`.
