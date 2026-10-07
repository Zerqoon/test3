# GOAT Clan Bot

A complete English Discord bot for the GOAT Roblox clan, version **2.0.0**. To update **Zerqoon/test3** and the existing Railway service, start with **UPDATE_V2_PL.md** and **UPLOAD-GITHUB.ps1**. Full hosting instructions are in **RAILWAY_SETUP_PL.md**; local setup is in **START_HERE_PL.md**.

## GitHub + Railway

For the existing **Zerqoon/test3** repository, the upload script replaces **R3V0-Discord-Bot-v2** and installs a workflow at the repository root. Railway **Root Directory** must be **`/R3V0-Discord-Bot-v2`**. Railway detects the supplied `Dockerfile`, installs the locked dependencies, builds TypeScript and starts the bot with its Docker command. The workflow builds and runs behavioral tests without a Discord token. A separate repository can also contain this project's files at its root and use the bundled standard workflow.

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
- Detailed audit logs with readable channel types and permission names, native audit actors, joins and account age, role / channel administration, edits, deletions and GIFs. An 8-second window groups up to five embeds per message within Discord limits. Routine bot changes and unchanged history reports are quiet by default. Large evidence receives TXT attachments. Persistent frozen batches retain their contents during retry and restart.
- Native giveaway modal with a mandatory role picker, one public entry button, private withdrawal button, duration parser, host preview, selected-role ping, persistent entries, secure random draws, fresh role checks, rerolls, cancellation, winner announcements and DMs. Duplicate entry presses give no extra chance. The scheduler resumes saved draws after a restart.
- Persistent human autorole jobs backfill existing members and cover future joins without per-member log spam. Only members joining after this version's first start qualify for the clan-role Roblox @username reminder; it pings just that member and its stored 60-second deletion survives restarts.
- Private Clan Application and Support tickets with the supplied GOAT artwork, application screenshot example and four-item checklist. Atomic private channel creation, one active ticket per kind and member, staff claims, explicit participants, close reason modals, reopening, dedicated Ticket Logs and paginated HTML transcripts. Channel deletion waits for confirmed transcript delivery; permanent delivery receipts survive log cleanup.
- Daily / weekly / monthly / all-time activity based on the Europe/Warsaw calendar, plus paginated leaderboards. Historical import resumes per channel and fills accessible offline gaps on startup / periodic sync. Counts remain after an observed deletion.
- ` | GOAT` server nickname tag for the configured clan role. Uses the current upper display name and preserves the original nickname for restoration after role removal.
- Native canvas welcome card using the supplied GOAT artwork, a dark overlay, central member avatar, display name and current member count.
- Ban / temporary ban / timeout / untimeout / unban / warning / case records. Timeouts are native Discord timeouts. Temporary unbans verify the original case reason marker so a later external ban is not accidentally removed.
- Exact configured access checks on every privileged command, modal and button. Owner fallback works without a staff role. Public bot panels never list access identities or privileged role IDs. Discord’s own role hierarchy and channel restrictions still apply.

## Commands

Public: `/messages`, `/leaderboard`, `/help`, eligible giveaway entry / private withdrawal buttons, and Clan Application / Support ticket opening buttons. Ticket owners can close and reopen their own tickets.

Restricted: `/giveway-create` (and `/giveaway-create`), `/giveaway-list`, `/giveaway-end`, `/giveaway-reroll`, `/giveaway-cancel`, `/ban`, `/unban`, `/mute`, `/unmute`, `/warn`, `/warnings`, `/case`, `/history-sync`, `/username-retry`, `/username-remove`, `/nickname-sync`, `/welcome-preview`, `/goat-status`, `/autorole-sync`, `/ticket-panel`, `/ticket-list`, `/ticket-add`, `/ticket-remove`, `/ticket-close`, `/ticket-repair`. Ticket claims and deletion are also restricted.

Privileged slash commands are registered without a default Discord permission mask, so a configured owner who loses their role can still invoke them. Authorization is checked against current server roles on every action. Unauthorized users receive only a private generic refusal. Normal registration replaces this application's guild commands; it does not modify another bot's commands or clear global commands.

## Data and operational behavior

`DATABASE_PATH` is the persistent source of truth: `data/goat.sqlite` locally and `/app/data/goat.sqlite` in the documented Railway setup. Keep it when updating. WAL mode, full SQLite synchronization and parameterized queries are enabled. A renewable lease allows one running bot instance per database. Use a persistent Docker volume / hosting disk.

Backfill sees accessible existing messages. Discord cannot supply messages deleted before observation, removed channels or unavailable private threads. Statistics report import coverage; activity-gated giveaway entries wait while an import is running. Counts cover human messages, not bot / webhook messages. Calendar values are current periods, not rolling 24-hour / 7-day / 30-day windows.

Deletion audit logs do not include a specific message ID. The bot clearly labels any matching executor as an audit candidate rather than asserting an unverified actor. Audit logs are the source for exact role / channel / moderation actors. Closed DMs are recorded without preventing the moderation action or giveaway result.

Default message snapshot retention is unlimited (`logging.retainMessageContentDays: 0`). Store the database and log channels with access suitable for your server. Imported old username submissions intentionally become bot-owned messages. Ticket transcripts preserve text and observed deletions, but their external Discord attachment links may expire. Discord server owners and members with Administrator bypass channel overwrites, including private ticket channels.

Delivery uses stored message IDs, reconciliation against bot footer IDs, and Discord nonces. Discord REST and local disk cannot form one distributed transaction; an abrupt failure in the send/record boundary can require reconciliation. Winner selections and unique entries are durable. In-flight work interrupted by a process stop resumes from the last saved state.

## Validation and tools

```sh
npm test
npm run doctor
npm run preview
npm run backup
```

**39 tests pass.** They cover persistent hosting configuration, authorization, duration limits, DST periods, deduplication, archive safety, history recovery, clean audit formatting, log grouping and restart retries, human autoroles, new-join-only reminders, timed deletion recovery, private ticket overwrites, fresh access checks, participant repair, transcript pagination and escaping, delete-before-delivery protection, migration, giveaway roles and draw recovery, and temporary-ban protection. Local tests use Discord API doubles; no live server or hosting login was supplied.

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
