# KUSH

Маршруты по Петербургу на сегодня с бронированием. Сайт живёт на Netlify и обновляется сам после каждого изменения в этом репозитории.

## Где что лежит

- `index.html` — весь сайт: экраны, база мест, подбор маршрута.
- `img/` — свои фото мест. Имя файла = id места, формат jpg (например `solids.jpg`). Список id — в таблице «KUSH: места и фото».
- `netlify/functions/api.mjs` — сервер: бот в Telegram, уведомления, заявки, поддержка, ИИ.
- `netlify.toml` — настройки Netlify.
- `fonts/` — шрифты Unbounded и Onest.

## Переменные в Netlify

`TG_BOT_TOKEN`, `TG_ADMIN_ID`, `TG_SECRET` — бот. `ANTHROPIC_API_KEY` — ИИ (по желанию). `BOT_BOOKING=off` — выключить «Бот бронирует».
После смены переменных нужен новый деплой: Deploys → Trigger deploy.

## Как добавить фото

На github.com откройте папку `img` → Add file → Upload files → перетащите фото → Commit changes. Через минуту фото на сайте.
