[Uploading STAGE3_CRYPTO_MEDIA_RU.md…]()
# Stage 3: CIFRA crypto envelope и сторона получателя

Дата локальной реализации: 2026-08-04. Изменения подготовлены только в frontend-каталоге; GitHub, merge, deploy и staging не изменялись.

## Зафиксированный backend-вход

- Архив: `cifra-messenger-backend-main(1).zip`.
- SHA-256 архива: `0e56138f1e7d3bf1d26d12fa4d5f7bd278870fc83845554134be7bed9f55b182`.
- `ops/amvera/deployment-lock.json`: backend `main_commit=f93e4fb8fda874133151bbc0436564582e4f84e3`.
- Зафиксированный staging Gateway работает на backend `a6c480320465b21e1b05d085328e0d6089c98886`.
- В lock-файле staging DB подтверждена только версия схемы `0005`.
- Backend `docs/MEDIA_VOICE.md` требует для media/voice последовательно применить `0005`, затем `0006`.

Frontend сверялся с нормативными `docs/CIFRA_CRYPTO_V1.md`, JSON Schemas, OpenAPI, тремя official golden vectors и RSA-OAEP compliance fixture именно из этого архива.

## Что реализовано

### Device и crypto context

- Browser `external_device_id` больше не используется как path UUID crypto endpoint.
- `GET /api/v1/devices` однозначно сопоставляет browser device с внутренним trusted Web device UUID.
- `PUT /api/v1/devices/{device_id}/crypto-keys` использует новый обязательный profile `CIFRA-ECDH-P256-HKDF-SHA256-A256KW`.
- Encryption JWK отправляется ровно как `{kty, crv, x, y, use}`. Ответ регистрации строго проверяет UUID, algorithms, key IDs и обе пары P-256 coordinates.
- `expires_at`, sender device, key epochs, algorithms и exact encryption JWK из topic crypto context проверяются fail-closed.

### Сторона A

После backend `ready` Web:

1. получает manifest и сверяет media/topic/owner/kind/status/version/размеры/chunks;
2. вычисляет нормативный `manifest_sha256`;
3. создаёт отдельный случайный message DEK, nonce, HKDF salt и ephemeral P-256 key;
4. для каждого recipient device выводит KEK через ECDH P-256 + HKDF-SHA256 и оборачивает message DEK через AES-256-KW;
5. создаёт RSA-OAEP-256 compliance copy; поддержаны оба допустимых JWK `key_ops`: `encrypt` и `wrapKey`;
6. шифрует canonical media payload через A256GCM с нормативным content AAD;
7. подписывает canonical signature input через ES256 в формате IEEE-P1363;
8. строит strict `cifra.message/1` envelope с тем же `client_msg_id` для одной попытки публикации;
9. имеет Tinode transport с MIME `application/vnd.cifra.envelope+json` и `x-cifra-client-msg-id`.

### Сторона B

Receiver library умеет:

1. строго разобрать envelope и canonical recipient bundle;
2. найти запись текущего user/device/key;
3. восстановить нормативный sender KDF context по допустимым user/device candidates из полного recipient bundle и проверить AES-KW integrity;
4. расшифровать и строго проверить canonical media payload;
5. импортировать media DEK сразу в non-extractable `CryptoKey`, не возвращая raw DEK наружу;
6. проверить подпись ES256, если backend предоставил правильный исторический sender signing JWK;
7. получить authenticated manifest и ciphertext полным ответом или точными HTTP Range;
8. проверить manifest hash, topic/kind/version/size/MIME, каждый ciphertext SHA-256 и каждый GCM tag;
9. собрать Blob для download/playback, используя MIME, подтверждённый backend inspection, а не только metadata отправителя.

Поведенческий тест выполняет весь путь A → B с несколькими 206 Range: signed envelope, AES-KW unwrap, A256GCM payload, manifest, chunk SHA/GCM и byte-for-byte Blob. Отдельные тесты портят manifest и ciphertext и подтверждают fail-closed отказ.

## Security и retry boundary

- Plaintext и raw DEK не пишутся в IndexedDB/Web Storage.
- Private device keys остаются non-extractable `CryptoKey` в IndexedDB.
- Raw message/media DEK, KEK, ECDH shared secret и расшифрованные byte buffers очищаются после использования; receiver наружу отдаёт non-extractable media key.
- Ciphertext upload можно продолжить в той же или новой вкладке с сохранённого part. Если после reload отсутствует raw media DEK для envelope, операция завершается `MEDIA_RESELECT_REQUIRED`: нужно снова выбрать/записать исходник.
- После успешного publish подготовленный envelope уничтожается и повтор невозможен.
- При потерянном ответе после `socket.send` состояние становится `MEDIA_DELIVERY_UNKNOWN`; автоматический и ручной повтор запрещены, потому что наличие `client_msg_id` само по себе не доказывает server deduplication.
- Повтор разрешён только при однозначной ошибке до отправки либо явном server rejection.

## Почему отправка в UI пока не включена

Stage 3 crypto/media core реализован, но текущий backend snapshot не даёт два обязательных end-to-end свойства. Поля в envelope нельзя выдумать: schema имеет `additionalProperties=false`, а подпись и Gateway validation зависят от точного контракта.

### 1. Независимая проверка отправителя у B

Strict envelope не содержит `sender_user_id`, `sender_device_id`, signing key ID/version. Публичного авторизованного endpoint для получения исторического sender signing key также нет. Gateway проверяет подпись перед forwarding, но Web B не может независимо выбрать правильный ключ и подтвердить подпись.

Backend должен предоставить immutable authenticated committed-message metadata, связывающую `topic + seq/client_msg_id` с `sender_user_id`, `sender_device_id`, signing key ID/version, и авторизованный lookup исторического public signing JWK. Альтернатива — нормативно расширить envelope/schema/signature input и выпустить новые vectors. До этого receiver может иметь только статус `gateway-verified-only`, который UI намеренно не принимает как завершённую E2E-проверку.

### 2. Атомарная deduplication публикации

`MessageIntegrationService.recordCommittedMessage()` реализует unique `(sender_id, topic_id, client_msg_id)`, но в snapshot отсутствует его вызов из runtime. Backend `docs/TINODE_INTEGRATION.md` прямо оставляет production gate на Tinode fork/storage adapter, который должен записывать message metadata в той же transaction, что и Tinode message.

Нужно подключить этот adapter либо предоставить отдельный idempotent publish endpoint с атомарным commit и возвратом исходного `seq` при повторе. До этого неизвестный результат WebSocket publish нельзя безопасно повторять.

### 3. Staging deployment gate

Перед браузерной приёмкой нужно подтвердить:

- staging Gateway соответствует проверенному snapshot/OpenAPI, а не старому backend commit из lock;
- migration `0006` применена и `verify 0006` успешен;
- media worker/compliance key/ClamAV готовы;
- два dedicated staging accounts имеют trusted Web devices и общий writable chat.

## Текущее поведение UI

Файл/voice реально записывается, шифруется, загружается и доходит до backend `ready`. В этой же вкладке также готовится signed envelope. Однако `app/page.tsx` не вызывает `publishPrepared()`: пользователь видит явное предупреждение, сообщение B не создаётся. Receiver library также не подключена к incoming UI до появления проверяемой sender identity.

Это не mock и не ошибка прогресса. Это сознательный fail-closed gate, чтобы не объявлять доставку, подпись и отсутствие дубля доказанными раньше backend-контракта.

## Приёмка после снятия gate

1. A и B входят из двух браузерных профилей.
2. A выбирает/записывает media: progress → processing → ready → publish.
3. B получает strict envelope, проверяет sender signing key, скачивает encrypted Range, проверяет hashes/GCM, расшифровывает и воспроизводит/скачивает файл.
4. Сеть обрывается во время upload: resume продолжается с неподтверждённой части.
5. Сеть обрывается после publish: повтор с тем же `client_msg_id` возвращает исходный `seq`, в Tinode и metadata существует ровно одно сообщение.

До выполнения всех пяти пунктов нельзя маркировать Web media/voice как end-to-end готовые на staging.

## Локальная проверка

`npm run check` завершён успешно на Node `v24.14.0`:

- ESLint: PASS;
- TypeScript: PASS;
- Web tests: `187/187` PASS;
- Next.js 16.2.12 static production build: PASS.

В число тестов входят три official cross-platform golden vectors, обе RSA-OAEP compliance `key_ops` ветки, strict/tamper cases, Tinode envelope transport и полный A→B media Range round-trip. Read-only staging readiness проверена отдельно: `/health/ready` вернул HTTP 200 и `{"status":"ready"}`; unauthenticated `/api/v1/capabilities` ожидаемо вернул 401 `AUTH_REQUIRED`. Authenticated capabilities, migration `0006` и A/B acceptance этим health-check не подтверждены и не выполнялись.
