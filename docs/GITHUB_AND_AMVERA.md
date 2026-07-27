# Загрузка в GitHub и запуск в Amvera

## Вариант A — новый репозиторий через браузер

1. Скачайте ZIP и распакуйте его.
2. В GitHub нажмите **New repository**.
3. Назовите репозиторий `cifra-messenger-web`.
4. Выберите **Private**.
5. Не добавляйте README, `.gitignore` и лицензию: они уже находятся в архиве.
6. Откройте созданный репозиторий: **Add file → Upload files**.
7. Перетащите содержимое распакованной папки, а не сам ZIP.
8. Проверьте, что `package.json` и `Dockerfile` лежат в корне.
9. Нажмите **Commit changes**.

## Вариант B — через Git в PowerShell

Создайте пустой приватный репозиторий, затем в распакованной папке:

```powershell
git init
git add .
git commit -m "CIFRA Messenger Web v11"
git branch -M main
git remote add origin https://github.com/ВАШ_ЛОГИН/cifra-messenger-web.git
git push -u origin main
```

Если репозиторий уже содержит код, не перезаписывайте `main`. Создайте ветку:

```powershell
git switch -c import-v11
git add .
git commit -m "Import CIFRA Messenger Web v11"
git push -u origin import-v11
```

После проверки объедините её Pull Request-ом.

## Рекомендуемые ветки

- `stage` — подключена к тестовому frontend-приложению;
- `main` — только проверенная production-версия.

Изменения сначала попадают в `stage`, проходят тесты, затем Pull Request-ом
переходят в `main`.

## Локальная проверка перед отправкой

```bash
npm ci
npm run check
```

## Развёртывание frontend в Amvera

В корне уже есть `Dockerfile`, поэтому отдельный `amvera.yaml` не требуется.

1. Создайте отдельное приложение `cifra-web-stage`.
2. Подключите ветку `stage` репозитория.
3. Добавьте frontend-переменные окружения из `.env.example`.
4. Выполните сборку и откройте HTTPS-адрес.
5. Для production создайте отдельное приложение `cifra-web-prod` и подключите
   ветку `main`.

Frontend, Gateway, Worker, Tinode и PostgreSQL не нужно запускать одним
контейнером. На Amvera это отдельные приложения/ресурсы.

## Подключение к backend stage

На frontend stage задайте:

```env
NEXT_PUBLIC_DATA_MODE=mock
NEXT_PUBLIC_CIFRA_API_URL=https://АДРЕС-GATEWAY-STAGE
NEXT_PUBLIC_CIFRA_WS_URL=wss://АДРЕС-GATEWAY-STAGE/ws
NEXT_PUBLIC_TINODE_WS_URL=wss://АДРЕС-TINODE-STAGE/v0/channels
```

Оставьте `mock`, пока реальные адаптеры не подключены. Само изменение режима на
`api` не заменяет демонстрационные данные автоматически.

## Что проверить после развёртывания

- сайт открывается на ПК, iPhone Safari и Android Chrome;
- HTTPS не вызывает mixed-content ошибок;
- safe-area не перекрывает верх/низ интерфейса;
- health Gateway доступен;
- WSS-подключения разрешают origin frontend;
- stage не использует production-БД;
- в настройках GitHub и Amvera нет секретов в открытом виде;
- Docker health check проходит.
