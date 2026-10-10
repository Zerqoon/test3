# GOAT Clan Bot

A complete English Discord bot for the GOAT Roblox clan, version **2.6.1**. To update **Zerqoon/test3** and the existing Railway service, start with **COMMUNITY-START-PL.md**, **UPDATE_V2_PL.md** and **UPLOAD-GITHUB.ps1**. Full hosting instructions are in **RAILWAY_SETUP_PL.md**; local setup is in **START_HERE_PL.md**.

## Recruitment controls

- `/clan-off` pauses new clan applications and removes the Clan Application button. The embed shows **Recruitment Closed** and keeps the real occupied/reserved count. Existing conversations remain available.
- `/open-ticket count:0` marks the clan **full · 20/20** and removes the application button. `/open-ticket count:5` sets **five free places**, so the button displays **15/20**. The integer range is **0–20**. Active undecided applications already reserve places and keep their tickets and votes when the count is changed.
- `/clan-status` privately shows occupied places, reserved applications, free places and panel synchronization. The panel itself shows current availability.

Each new application reserves one of 20 places atomically. Acceptance converts its reservation into an occupied place exactly once; rejection or withdrawal frees it. At 20 occupied or reserved places, the panel shows **Clan Full · 20/20** and removes the application button. It returns after a place is released, unless manually paused. Reservations and settings survive redeploys. Stale forms and reopen requests recheck capacity and the blacklist. Existing undecided applications are reserved on upgrade; set the actual number of free places after updating, since the bot cannot infer current clan membership.

The compact **GOAT · Ticket Center** uses full-width application and Support sections, clear status/count lines and a small GOAT thumbnail. Upgrades edit the existing panel, including an old panel with no buttons. Support availability remains independent of clan capacity.

Role **1557809384166391918** blocks clan applications and all GIFs. `tickets.clanBlacklistRoleIds` and `linkFilter.gifBlockedRoleIds` configure these restrictions. The GIF restriction wins over approved providers, staff and role exceptions, and the otherwise unrestricted channel **1557577086351179866**. Support follows its opening hours; ordinary text, screenshots and approved non-GIF links remain available. Deletion feedback expires after ten seconds. Access checks remain private.

## Support hours, staff exceptions and community messages

Support opening is available daily from **3 PM–10 PM (Europe/Warsaw)**, with daylight saving time handled automatically. The Support button is removed outside those hours and appears automatically at 3 PM while the bot is online. A click or modal submitted outside the window is checked again on the server. Existing conversations are not closed at 10 PM.

Staff can use `/support-open user:@member reason:Follow-up` with an optional `username`. It opens private Support outside the window and bypasses the member cooldown/hourly limit. Fresh staff access, bot exclusion, one active ticket per member and the server queue cap still apply. An existing application or Support conversation is returned instead of duplicated. The staff member and reason are saved and logged.

Closed tickets have no controls. `/ticket reopen [id]` restores a conversation; `/ticket delete confirm:True [id]` removes a closed channel only after its transcript has been delivered. An omitted ID means the current ticket channel.

English rules are maintained as one three-embed message in **1557875144855396353**. Startup repairs the same message; `/rules-refresh` refreshes it manually. Bot-owned recovery markers and stored message IDs prevent duplicate rules posts. Human messages are never edited or removed.

Boost thank-you embeds go to **1558251766770962453**. `/boost-preview [user]` is private. Discord boost system messages (including level-up variants) identify additional boosts. A first-boost member update supplies a fallback after 20 seconds; correlated events and retries do not duplicate the thank-you. Existing boosters are not thanked again on startup. To detect further boosts from a member who is already boosting, enable boost notifications in **Server Settings → Overview → System Messages Channel** and let GOAT view that channel. Delivery uses the persistent log queue.

`timezone`, `tickets.supportHours`, `boosts` and `rules` in `config.json` control these features. The bot must stay online for scheduled panel edits and future notifications.

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
- Separate message, ticket, membership and administration log channels. Readable channel types and permission names, native audit actors, account creation / join dates, edits, deletions and GIFs. A 700-millisecond window groups up to five embeds per message within Discord limits. Routine bot changes and unchanged history reports are quiet by default. Large evidence receives TXT attachments. Persistent frozen batches retain their contents during retry and restart. Independent log channels progress separately when another route is slow; /goat-status shows delivery errors. Raw Gateway updates and deletions cover uncached channels/messages; saved partial fields are merged without erasing evidence. Human messages in log channels are covered too, while lightweight bot markers prevent loops. Preview enrichment is saved quietly. Invalid payloads are isolated so subsequent healthy logs in the same channel can progress. /message-logs status, test and retry diagnose permissions, confirm delivery and retry retained evidence.
- Live invite / link / GIF filtering checks new messages and edits before username archiving. Everyone can use Tenor, Giphy and KLIPY (including clips and static.klipy.com media). Other GIFs require a configured role exception or channel **1557577086351179866**, which allows GIFs from any source. GIF exceptions do not bypass Discord invite restrictions or unrelated link rules. YouTube, TikTok and Roblox links remain allowed. Staff and configured owners retain their full exemption. Every blocked message is removed, with one readable Message Log and TXT evidence. The member receives a short English warning, mentioning only that member, deleted after **10 seconds**. Repeated attempts within the cooldown share one warning. Deletion, warning publication and timed cleanup have independent persistent workers; stale unpublished warnings expire instead of arriving hours later. Role overrides from `/link-filter allow-role` and `remove-role` survive redeploys. Fresh member roles and message contents are checked before deletion.
- Embeds use their own titles without an automatic GOAT prefix/footer. The nickname suffix ` | GOAT`, artwork and bot identity remain. `/embed` opens a five-field native form for title, embed message, text outside the embed, HTTPS image URL and hex color. The command accepts an optional destination channel and native role / user ping pickers. Only the explicitly selected role and user can be pinged; typed @everyone never triggers a ping. Fresh configured access is required. Durable publishing jobs retry after a failed send or restart; repeated form submissions do not create an extra message.
- Native giveaway modal with a mandatory role picker, one public entry button, private withdrawal button, duration parser, host preview, selected-role ping, persistent entries, secure random draws, fresh role checks, rerolls, cancellation, winner announcements and DMs. Duplicate entry presses give no extra chance. The scheduler resumes saved draws after a restart.
- Persistent human autorole jobs backfill existing members and cover future joins without per-member log spam. Only members joining after this version's first start qualify for the clan-role Roblox @username reminder; it pings just that member and its stored 60-second deletion survives restarts.
- Readable Clan Application and Support panels with a large banner, prominent Roblox username, status and handler. Public opening requires a Roblox username modal. Staff may open Support with an optional username using `/support-open`. One active ticket per member across both categories, persisted five-minute cooldown, three submissions per hour and a server queue limit. Application instructions use one embed with four screenshot requirements, a 24/7 AFK availability question and the supplied example. Privacy, claims, participants, reopen / close and delivery-gated deletion are retained. Ticket Logs show the actual conversation in a readable embed with complete paginated TXT evidence.
- Application voting starts only when staff press **Start Vote** beside **Close**, or use /ticket-start-vote. The 3-minute deadline begins at that action. Three Yes immediately accept; three No immediately reject. At the deadline, the strict majority of votes cast decides without a turnout minimum. A tie or no votes awaits manual review. Each human server member other than the applicant has one changeable vote, with no role requirement or later membership recheck. The public panel shows the applicant nickname and a prominent Roblox username. The result is saved and the vote acknowledged before ticket closure, transcript capture or DM delivery; interrupted completion resumes after restart. Manual decisions use /ticket-approve and /ticket-reject; their old buttons are removed.
- Daily / weekly / monthly / all-time activity based on the Europe/Warsaw calendar, plus paginated leaderboards. Historical import resumes per channel and fills accessible offline gaps on startup / periodic sync. Counts remain after an observed deletion.
- ` | GOAT` server nickname tag for the configured clan role. Uses the current upper display name and preserves the original nickname for restoration after role removal.
- A new grant of role **1552474081054564402** sends a private Roblox **@username** reminder with a button for **1556640581613260810**. Initial role holders are recorded without bulk DMs. The activation date, role observations and send queue persist across updates; duplicate events and remove/readd do not resend a completed reminder. Fresh audit role grants also cover uncached members. Closed DMs are recorded privately.
- Full HD (1920 x 1080) native welcome canvas in GOAT cyan, white and mint, with the original pet artwork, a large circular avatar, readable display name and live member count. Portraits use a centered crop. Long names fit inside the card; unavailable avatars use the GOAT monogram. `/welcome-preview` shows the same design used for new joins.
- Ban / temporary ban / timeout / untimeout / unban / warning / case records. Timeouts are native Discord timeouts. Temporary unbans verify the original case reason marker so a later external ban is not accidentally removed.
- Exact configured access checks on every privileged command, modal and button. Owner fallback works without a staff role. Workers start before the full member preload; background indexing and member synchronization do not delay command acknowledgement. Public bot panels never list access identities or privileged role IDs. Discord’s own role hierarchy and channel restrictions still apply.

## Commands

Public: `/messages`, `/leaderboard` (alias `/leadboard`), `/help`, eligible giveaway entry / private withdrawal buttons, and Clan Application / Support ticket opening buttons. Ticket owners can close their conversations. Closed tickets have no buttons; only staff can reopen or delete them through commands.

Activity commands and the initial `/help` publish responses in the channel. `/help` has Activity, Tickets, Giveaways and Tools buttons; category instructions are private and do not edit the shared panel. Commands are registered with an explicit null default permission mask; server integration overrides and the Discord Use Application Commands permission still apply.

Restricted: `/support-open`, `/rules-refresh`, `/boost-preview`, `/ticket` (panel, list, add, remove, close, reopen, delete, start-vote, approve, reject, repair), `/message-logs`, `/link-filter`, `/embed`, `/giveway-create` (and `/giveaway-create`), `/giveaway-list`, `/giveaway-end`, `/giveaway-reroll`, `/giveaway-cancel`, `/ban`, `/unban`, `/mute`, `/unmute`, `/warn`, `/warnings`, `/case`, `/history-sync`, `/username-retry`, `/username-remove`, `/nickname-sync`, `/welcome-preview`, `/goat-status`, `/autorole-sync`, `/ticket-panel`, `/ticket-list`, `/ticket-add`, `/ticket-remove`, `/ticket-close`, `/ticket-start-vote`, `/ticket-approve`, `/ticket-reject`, `/ticket-repair`. Ticket claims, manual application decisions and deletion are also restricted.

Privileged slash commands are registered without a default Discord permission mask, so a configured owner who loses their role can still invoke them. Authorization is checked against current server roles on every action. Unauthorized users receive only a private generic refusal. Normal registration replaces this application's guild commands; it does not modify another bot's commands or clear global commands.

## Ticket and log defaults

| Purpose | Channel |
| --- | --- |
| Ticket panel | `1557384522713276488` |
| Application voting | `1557433699572777000` |
| Message edits / deletes / GIFs, including ticket messages | `1557439487813091358` |
| Ticket lifecycle and conversation summaries | `1557439533979803678` |
| Joins / leaves with user ID and account dates | `1557439665378959491` |
| Role / channel / other administration | `1557440463974436956` |
| Automatic boost thank-you | `1558251766770962453` |
| English community rules | `1557875144855396353` |

`config.json` controls the ticket cooldown and hourly / active limits, logging batch window, and voting channel / enable switch. Voting uses a fixed 180-second timer and a three-vote instant threshold. Legacy `durationSeconds`, `minimumVotes` and `voterRoleIds` values are accepted for configuration compatibility but do not change these new rules. Community voting is for Clan Application; Support stays a private help conversation. Roblox usernames are supplied by applicants and syntax-checked; this is not proof of Roblox account ownership. Acceptance does not assign a clan role automatically. Closed ticket channels remain read-only until staff delete them after evidence delivery. Existing ticket messages and the panel are refreshed on update. Undecided ballots from the old automatic system pause until Start Vote; saved votes remain, while an already committed decision continues its closure and DM.

## Message log and link filter checks

After deploying, confirm `/goat-status` shows **2.6.1**. Run `/message-logs test`; it sends one embed directly to **1557439487813091358**, independently of the delivery queue. `/message-logs status` privately shows the active version, destination, required channel permissions, latest edit/delete event times, pending evidence and delivery errors. Repair the reported access and use `/message-logs retry` if an older batch is waiting.

The bot needs **View Channel**, **Send Messages**, **Embed Links**, **Attach Files** and **Read Message History** in the message log channel. It needs access to source channels, **Manage Messages** to delete prohibited messages, and **Message Content Intent** enabled in Developer Portal. Raw Gateway capture cannot receive events from inaccessible channels or reconstruct content Discord never supplied. Already observed deleted text is retained; deletions from before installation/offline are not recoverable.

`linkFilter.allowedDomains` includes `giphy.com`, `gph.is`, `tenor.com`, `klipy.com`, `tiktok.com`, `youtube.com`, `youtu.be`, and `roblox.com`, including real subdomains. `gifProviderDomains` is the single provider list used by filtering and GIF logs; add a GIF service there and in `allowedDomains`. `allowApprovedGifs: true` permits approved providers for members without a GIF restriction. `unrestrictedGifChannelIds` selects channels that permit every GIF for members without a GIF restriction. `notifications` controls warnings, their 10-second lifetime, cooldown and maximum publication delay. Matching checks the destination hostname rather than the visible link label; fake suffixes and `youtube.com@evil.example` are rejected. Official TikTok/YouTube short domains are allowed. Arbitrary redirects/shorteners and their final network destinations are not followed.

Use `/link-filter allow-role role:...` to permit GIFs and `/link-filter remove-role role:...` to revoke that exception. `/link-filter status` is private. `gifAllowedRoleIds` supplies initial config defaults; command overrides survive redeployment, including removal of a default. These roles permit direct GIF links outside the whitelist and GIF attachments; they do not permit invitations or other unrelated links. Staff access uses the existing two configured roles and owner ID. The filter only deletes: it does not issue automatic bans/timeouts. Normal PNG/JPG screenshots are allowed. The filter covers new messages and edits, without sweeping older history.

## Data and operational behavior

`DATABASE_PATH` is the persistent source of truth: `data/goat.sqlite` locally and `/app/data/goat.sqlite` in the documented Railway setup. Keep it when updating. WAL mode, full SQLite synchronization and parameterized queries are enabled. A renewable lease allows one running bot instance per database. Use a persistent Docker volume / hosting disk.

Backfill sees accessible existing messages. Discord cannot supply messages deleted before observation, removed channels or unavailable private threads. Statistics report import coverage; activity-gated giveaway entries wait while an import is running. Counts cover human messages, not bot / webhook messages. Calendar values are current periods, not rolling 24-hour / 7-day / 30-day windows.

Deletion audit logs do not include a specific message ID. The bot clearly labels any matching executor as an audit candidate rather than asserting an unverified actor. Audit logs are the source for exact role / channel / moderation actors. Closed DMs are recorded without preventing a moderation action, giveaway result or application decision.

Default message snapshot retention is unlimited (`logging.retainMessageContentDays: 0`). Store the database and log channels with access suitable for your server. Imported old username submissions intentionally become bot-owned messages. Ticket conversation TXT files preserve text and observed deletions, but their external Discord attachment links may expire. Discord server owners and members with Administrator bypass channel overwrites, including private ticket channels.

Delivery uses stored message IDs, reconciliation against bot footer IDs, and Discord nonces. Discord REST and local disk cannot form one distributed transaction; an abrupt failure in the send/record boundary can require reconciliation. Discord nonces deduplicate recent sends; a very long uncertain network outage can still require manual DM reconciliation. Winner selections, unique entries, application votes and application decisions are durable. In-flight work interrupted by a process stop resumes from the last saved state.

## Validation and tools

```sh
npm test
npm run doctor
npm run preview
npm run backup
```

**237 tests pass.** They cover persistent hosting configuration, authorization, duration limits, DST periods, deduplication, archive safety, history recovery, clean audit formatting, log grouping and restart retries, human autoroles, new-join-only reminders, timed deletion recovery, private ticket overwrites, fresh access checks, participant repair, plain-text conversation pagination, required username forms, cross-category anti-spam, unique changeable votes, manual vote start, exact 180-second restart-safe deadlines, three-vote instant outcomes, majority without quorum, ties, retained votes after departure, slow-channel isolation, partial edit / delete evidence, public command replies, custom embed modal / selected-only mentions / validation / authorization / queued-delivery recovery, manual authorization and decision / DM restart recovery, delete-before-delivery protection, migration, giveaway roles and draw recovery, and temporary-ban protection. Version 2.4 adds provider/clip recognition, mixed-source rejection, the requested GIF channel exception, ten-second warnings, coalescing, nonce recovery, independent cleanup, role-grant DMs without backfill, audit/raw event deduplication, blocked/transient DM handling, migration, unbranded embeds, help pages and grouped ticket commands. Local tests use Discord API doubles; no live server or hosting login was supplied.

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
