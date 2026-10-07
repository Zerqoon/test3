# GOAT Clan Bot

A complete English Discord bot for the GOAT Roblox clan. For **GitHub + Railway**, read **RAILWAY_SETUP_PL.md**. Local setup and the command guide are in **START_HERE_PL.md**.

## GitHub + Railway

Put the contents of this project folder in the root of a GitHub repository. Connect that repository to a Railway service. Railway detects the supplied `Dockerfile`, installs the locked dependencies, builds TypeScript and starts the bot with its Docker command. The included GitHub Actions workflow builds and runs the behavioral tests on pushes and pull requests; it needs no Discord token.

Attach a persistent volume at **`/app/data`**. Set these service variables before deploying:

| Variable | Value |
| --- | --- |
| `DISCORD_TOKEN` | Your Discord bot token |
| `DATABASE_PATH` | `/app/data/goat.sqlite` |
| `RAILWAY_RUN_UID` | `0` |
| `LOG_LEVEL` | `info` (optional) |

Railway mounts volumes as root; `RAILWAY_RUN_UID=0` allows this image to write to the volume. Run one replica, disable Serverless sleeping, and configure a restart policy suitable for a continuously running worker. Leave HTTP healthchecks unset; this bot connects to Discord's gateway and does not serve a website. Guild and application IDs are detected automatically.

On Railway, startup refuses a missing volume or a database path outside its mount, so a redeploy cannot silently switch to an ephemeral database. If `DATABASE_PATH` is omitted, the bot uses `RAILWAY_VOLUME_MOUNT_PATH` when supplied by the platform. Backups are written beside the database in `backups/`, keeping Railway copies on the volume too.

## Run

Use Node.js **24.15+** (24 LTS). Enable **Server Members Intent** and **Message Content Intent** in the Developer Portal. Invite the bot with `bot` and `applications.commands`; the supplied setup uses Administrator. Move its role above the members it must rename or moderate.

```sh
npm ci
```

Copy `.env.example` to `.env` and set `DISCORD_TOKEN` locally. Channel and access configuration is already supplied. Guild and application IDs are detected automatically during normal startup.

```sh
npm run build
npm start
```

On Windows, **START-GOAT.bat** handles installation, compilation and launch. With Docker, use `docker compose up -d --build` after configuring `.env`.

## Features

- Immutable username channel: original upper Discord display name as title, author avatar, original text, ID and timestamp. Successful bot publication is persisted before deleting the source. Attachments are copied within the configured limits; unsupported / oversized copies preserve the source and report the problem.
- Detailed audit logs: joins, account age, leaves, role changes, channel and role administration, permissions, timeouts, bans, edits, deletions and GIF content. Long evidence is retained as TXT files in the log channel. Persistent outbox retries delivery failures.
- Native giveaway modal with a role picker, duration parser, host preview, selected-role ping, persistent entries, secure random draws, role revalidation, rerolls, cancellation, winner announcements and DMs. Duplicate entry presses give no extra chance. The scheduler resumes saved draws rather than drawing again after a restart.
- Daily / weekly / monthly / all-time activity based on the Europe/Warsaw calendar, plus paginated leaderboards. Historical import resumes per channel and fills accessible offline gaps on startup / periodic sync. Counts remain after an observed deletion.
- ` | GOAT` server nickname tag for the configured clan role. Uses the current upper display name and preserves the original nickname for restoration after role removal.
- Native canvas welcome card using the supplied GOAT artwork, a dark overlay, central member avatar, display name and current member count.
- Ban / temporary ban / timeout / untimeout / unban / warning / case records. Timeouts are native Discord timeouts. Temporary unbans verify the original case reason marker so a later external ban is not accidentally removed.
- Exact configured access checks on every privileged command, modal and button. Owner fallback works without a staff role. Public bot panels never list access identities or privileged role IDs. Discord’s own role hierarchy and channel restrictions still apply.

## Commands

Public: `/messages`, `/leaderboard`, `/help`, giveaway entry / leave buttons.

Restricted: `/giveway-create` (and `/giveaway-create`), `/giveaway-list`, `/giveaway-end`, `/giveaway-reroll`, `/giveaway-cancel`, `/ban`, `/unban`, `/mute`, `/unmute`, `/warn`, `/warnings`, `/case`, `/history-sync`, `/username-retry`, `/username-remove`, `/nickname-sync`, `/welcome-preview`, `/goat-status`.

Privileged slash commands are registered without a default Discord permission mask, so a configured owner who loses their role can still invoke them. Authorization is checked against current server roles on every action. Unauthorized users receive only a private generic refusal. Normal registration replaces this application's guild commands; it does not modify another bot's commands or clear global commands.

## Data and operational behavior

`DATABASE_PATH` is the persistent source of truth: `data/goat.sqlite` locally and `/app/data/goat.sqlite` in the documented Railway setup. Keep it when updating. WAL mode, full SQLite synchronization and parameterized queries are enabled. A renewable lease allows one running bot instance per database. Use a persistent Docker volume / hosting disk.

Backfill sees accessible existing messages. Discord cannot supply messages deleted before observation, removed channels or unavailable private threads. Statistics report import coverage; activity-gated giveaway entries wait while an import is running. Counts cover human messages, not bot / webhook messages. Calendar values are current periods, not rolling 24-hour / 7-day / 30-day windows.

Deletion audit logs do not include a specific message ID. The bot clearly labels any matching executor as an audit candidate rather than asserting an unverified actor. Audit logs are the source for exact role / channel / moderation actors. Closed DMs are recorded without preventing the moderation action or giveaway result.

Default message snapshot retention is unlimited (`logging.retainMessageContentDays: 0`). Store the database and log channel with access suitable for your server. Imported old username submissions intentionally become bot-owned messages on the configured channel.

Delivery uses stored message IDs, reconciliation against bot footer IDs, and Discord nonces. Discord REST and local disk cannot form one distributed transaction; an abrupt failure in the send/record boundary can require reconciliation. Winner selections and unique entries are durable. In-flight work interrupted by a process stop resumes from the last saved state.

## Validation and tools

```sh
npm test
npm run doctor
npm run preview
npm run backup
```

Tests exercise persistent Railway storage configuration, authorization, duration limits, DST periods, persistent message deduplication, archive failure safety, native modal structure, lease recovery, history pagination recovery, log retries, role pings, entry uniqueness, restart-safe draws, eligibility and temporary-ban protection. Local tests use Discord API doubles. They do not log in to a real Discord server.

## Layout

`src/core`: configuration, storage, access checks, lease, message snapshots and shared formatting. `src/services`: history, immutable usernames, logs, audit, giveaways, moderation, nicknames and canvas. `src/events`: gateway routing. `src/commands`: slash definitions and guarded interactions. `scripts`: registration, diagnostics, preview and backup. `tests`: local behavioral checks. `assets`: supplied GOAT banner and bundled DejaVu font with its license.

## Primary references

- Discord gateway / privileged intents: https://docs.discord.com/developers/events/gateway
- Modal and role-select components: https://docs.discord.com/developers/components/reference
- Audit logs: https://docs.discord.com/developers/resources/audit-log
- discord.js 14.27: https://discord.js.org/docs/packages/discord.js/14.27.0
- Built-in SQLite: https://nodejs.org/docs/latest-v24.x/api/sqlite.html
- Railway GitHub deployment: https://docs.railway.com/quick-start
- Railway Dockerfile detection: https://docs.railway.com/builds/dockerfiles
- Railway volume permissions: https://docs.railway.com/volumes

User-supplied artwork is included for this project. Font license: `assets/fonts/LICENSE-DejaVu.txt`.
