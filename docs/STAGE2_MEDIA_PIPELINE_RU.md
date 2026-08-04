[STAGE2_MEDIA_PIPELINE_RU.md](https://github.com/user-attachments/files/30692012/STAGE2_MEDIA_PIPELINE_RU.md)
# Stage 2: защищённая загрузка media и запись voice

Дата локальной сборки: 2026-08-03. Это безопасная промежуточная часть Stage 2. Изменения подготовлены локально: без операций в GitHub, без merge, без deploy и без изменения backend.

## Зафиксированный вход

- Web ZIP comment: `802cce1e1b49186774af3cbe99b53ea2621c4980`.
- SHA-256 Web ZIP: `b59c0445c081d8a8432daad15c68648bfce5fca17eb96b02818288dd3587e19b`.
- Backend PR: `akmer13-boop/cifra-messenger-backend#18`.
- Backend PR head, с которым сверены endpoint и media cipher: `efb6219553e3666bb9f2867ea32e5e16ec32d4e0`.
- SHA-256 backend handoff `cifra-media-stg-code.zip`: `4723cdf7714fdb3510de21cd2c216f375daca2e543a8412961b78d7864e3ce70`.

Перед применением patch нужно подтвердить, что frontend-ветка действительно содержит Web snapshot `802cce1e...`. Backend PR в `main` для локальной работы frontend не требуется.

## Что теперь работает

1. Web получает и строго проверяет `GET /api/v1/capabilities`.
2. Браузер создаёт non-extractable ECDH P-256 и ECDSA P-256 private keys. В backend отправляются только public JWK через `PUT /api/v1/devices/{device_id}/crypto-keys`.
3. Непосредственно перед upload запрашивается `GET /api/v1/chats/{topic}/crypto-context`.
4. Для каждого media создаются новый 256-bit DEK и новый 8-byte nonce prefix. DEK оборачивается публичным compliance RSA-OAEP-256 key.
5. После создания upload-сессии файл шифруется в отдельном Web Worker как `AES-256-GCM-CHUNKED-V1`:
   - IV: `prefix8 || uint32be(part_number)`;
   - AAD: canonical JSON с `media_id`, `part_number`, cipher и version;
   - каждая часть: `ciphertext || 16-byte GCM tag`.
6. Ciphertext parts отправляются binary-запросами с `Content-Type: application/octet-stream` и отдельным `Content-SHA256`.
7. После подтверждения части backend удаление локальной ciphertext-части и сохранение нового `nextPart` выполняются одной транзакцией IndexedDB. Состояние не может остаться между этими двумя действиями.
8. После `complete` Web опрашивает `GET /api/v1/media/{id}` до `ready`, `rejected`, `failed` или `expired`.
9. Кнопка микрофона использует настоящий `MediaRecorder`, показывает живой таймер, позволяет остановить/отменить запись, прослушать черновик и запустить защищённую загрузку.
10. В интерфейсе показываются реальные фазы: проверка → создание upload → шифрование → upload → processing → ready/error.

## Retry и resume

- При обрыве сети во время отправки части уже подтверждённые части не отправляются повторно, а неподтверждённые encrypted parts остаются в IndexedDB.
- Кнопка «Повторить / продолжить» начинает с сохранённого `nextPart`.
- После перезагрузки страницы операция в фазе upload или processing возобновляется автоматически при повторном открытии чата.
- Resume-записи изолированы по `user_id + device_id + topic_id`: другой пользователь в том же браузере не увидит и не продолжит чужую операцию.
- Потерянный ответ `complete` безопасно повторяется с тем же `Idempotency-Key`.
- Если вкладка была закрыта во время шифрования, Web просит выбрать исходный файл снова: plaintext и raw DEK специально не сохраняются.
- Одновременно поддерживается одна активная media-операция на открытый чат. Из множественного выбора на этом этапе берётся только первый файл.

## Security boundary

- Plaintext media не отправляется в Gateway и не пишется в IndexedDB.
- Raw media DEK не сохраняется и после импорта очищается из временного byte buffer.
- Private device keys создаются non-extractable; IndexedDB хранит structured-clone `CryptoKey`, а не private JWK или raw bytes.
- Если пользователь закрыл чат или вышел во время запроса разрешения на микрофон, поздно выданный media stream немедленно останавливается и запись не запускается в фоне.
- Access/refresh token не попадает в URL; binary upload идёт через существующий Bearer boundary клиента.
- Нет placeholder key, plaintext fallback, fake crypto и принудительной установки `ready`.

## Что сознательно остаётся заблокированным

Статус `ready` сейчас означает только: ciphertext принят и обработан backend. Он **не означает отправку сообщения в чат**.

До получения финального client crypto handoff не реализованы:

- recipient DEK wrapping для всех устройств из `recipient_keys`;
- точный encrypted media payload и подписанный `CIFRA_CRYPTO_V1` envelope;
- ECDSA IEEE-P1363 signing preimage, подтверждённый официальными golden vectors;
- Tinode publish media/voice и серверная дедупликация неизвестного результата publish;
- сторона B: manifest, encrypted Range download, unwrap DEK, decrypt и playback;
- двухпользовательская staging-приёмка A/B.

Web не создаёт mock-сообщение и явно показывает: «Файл не опубликован в чате и не показан получателю».

Уже получившие `ready` загрузки этого промежуточного этапа предназначены только для проверки upload/processing. Raw DEK не сохраняется, recipient bundle ещё не создаётся, поэтому после подключения финального crypto-контракта исходный файл или голосовое потребуется выбрать/записать и загрузить заново.

## Что увидит пользователь после обновления

- Если staging capabilities возвращают `media.enabled=true`, выбор файла запускает реальный progress вместо старой заглушки.
- Если `voice.enabled=true`, микрофон запрашивает разрешение браузера и начинает реальную запись вместо фиксированных `0:07`.
- Если backend media/voice ещё выключен или compliance/worker не готовы, интерфейс покажет точную ошибку backend. Он не станет изображать функцию работающей.
- После `ready` останется жёлтое предупреждение: в переписке сообщение не появится, а для будущей отправки потребуется повторный выбор исходника.

## Локальная проверка

Проверено на Node `v24.14.0`, npm `11.9.0`:

- ESLint: PASS;
- TypeScript: PASS;
- tests: `174/174` PASS;
- Next.js 16.2.12 production static build: PASS.

В тесты входит фиксированный AES-256-GCM chunk vector для контракта PR #18. Это frontend regression vector, но не замена официальным cross-platform golden vectors.

Текущее вычисление полного SHA-256 использует `file.arrayBuffer()` внутри Web Worker. Оно не блокирует UI, но временно требует память примерно под весь файл; это известное ограничение для слабых мобильных устройств при файлах около backend-лимита.

Живые staging upload/processing не запускались: для этого по-прежнему нужны включённые capabilities, media-worker/compliance key, официальный frontend origin и staging-аккаунты.

## Следующий этап после готовности четырёх пунктов

1. Сверить окончательные OpenAPI/Schema и backend SHA.
2. Подключить официальный recipient DEK/signature contract и golden vectors.
3. Публиковать media envelope только после `status=ready`.
4. Реализовать на стороне B authenticated manifest/Range download, decrypt и playback.
5. Развернуть frontend-ветку на `cifraweb-staging` и выполнить сценарий A/B с обрывом сети и проверкой отсутствия дубля.
