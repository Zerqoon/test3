# Railway deployment — R3V0 v1.2.0

## RAW Editor

```env
DISCORD_TOKEN=YOUR_TOKEN
DISCORD_CLIENT_ID=YOUR_APPLICATION_ID
DISCORD_GUILD_ID=YOUR_SERVER_ID

MAIN_CLAN=R3V0
DATABASE_PATH=/app/data/bot.db

BIGGAMES_API_BASE=https://ps99.biggamesapi.io
ROBLOX_USERS_API_BASE=https://users.roblox.com
ROBLOX_THUMBNAILS_API_BASE=https://thumbnails.roblox.com

LOG_LEVEL=info
API_TIMEOUT_MS=8000
API_RETRIES=3

TRACKER_ACTIVE_SECONDS=180
TRACKER_IDLE_SECONDS=900
TRACKER_TICK_SECONDS=60

AUTO_DEPLOY_COMMANDS=true
MAX_WHITELIST_CLANS=25
```

## Volume

W Railway dodaj persistent Volume do tej samej usługi i ustaw dokładny Mount Path:

```text
/app/data
```

SQLite będzie wtedy znajdować się tutaj:

```text
/app/data/bot.db
```

`src/database/db.ts` tworzy katalog rekursywnie przed otwarciem bazy.

## Build

Projekt korzysta z Dockerfile i wykonuje:

```text
npm install --include=dev
npm run typecheck
npm run build
npm test
npm run canvas:smoke
npm prune --omit=dev
node dist/index.js
```

Nie ustawiaj własnego Build Command w Railway.

## Pierwsze uruchomienie

Po deployu:

```text
/whitelist add clan:R3V0
/admin set-main-clan clan:R3V0
/admin diagnostics
```

Scheduler wykonuje wymuszony snapshot natychmiast po zdarzeniu Discord `ready`.
