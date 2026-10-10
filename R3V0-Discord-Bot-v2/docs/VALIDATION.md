# Local validation

GOAT **2.6.1**, SQLite schema **9**. Node.js **24.19.0**, discord.js **14.27.0**.

- Strict TypeScript compilation: passed.
- Complete behavioral suite: **237 passed, 0 failed**.
- Local doctor: valid configuration; **44** slash command definitions serialized; requested Support hours and community channels present.
- Visual check: local Discord-style rendering of the real panel payload at 1680, 390 and 320 pixels; open, paused and full states inspected without horizontal overflow. This is a layout preview, not a screenshot from the live Discord server.
- Windows scripts: FIX-GOAT-INSTALL.ps1, INSTALL-AND-UPLOAD-GOAT.ps1 and UPLOAD-GITHUB.ps1 parsed without syntax errors. They accept the new complete ZIP and validate the new services.

Version 2.6 checks exact 3 PM and 10 PM boundaries, next-day opening, Warsaw DST changes in March and October, unchanged panel IDs, no repeated edits within a window, no empty component rows, full versus manually closed clan intake, stale Support clicks and forms, existing conversations after hours, button removal on closure, recovery of a panel with no buttons, staff exceptions, fresh access, owner fallback, bot exclusion, username validation, privacy overwrites, one active conversation, concurrent opening, retained server queue limits, cooldown exceptions, creation recovery after interrupted sends, staff-only reopening and transcript-gated command deletion.

Version 2.6.1 adds nine checks: `count:0` through the real command router, private full-clan confirmations and logs, retained reservations and active votes, accepted/rejected capacity updates, stale application forms, reopening after zero, SQLite restart persistence, independent Support hours while full, recovery of an old panel with no buttons, member authorization and embed size limits. The slash definition and service both accept integers 0–20. The application button is removed at zero; Support follows its own schedule.

Community checks cover each boost system-message type, individual messages, repeated Gateway events, member/message event ordering, additional boosts, delayed member fallback, existing-booster exclusion, foreign guilds, bot exclusion, persistent delivery retries, real Gateway member-event routing, Discord embed length limits, all requested rule content and platform links, one managed rules message, restarts, refreshes, deletion recovery, publication nonces, failed sends and preservation of unrelated human messages.

The original application voting, clan reservations, GIF restrictions, role DMs, giveaway, moderation, username, audit/logging, history, deployment safeguards, Value API and Welcome Canvas checks remain in the suite. Tests reflect the new hidden-button behavior rather than the old disabled-button behavior.

Discord calls use local API doubles. Real Discord login, Gateway delivery, live channel permissions, server posting, GitHub upload, Railway deployment, Docker execution and Windows execution were not performed. The PowerShell result is syntax validation, not execution on Windows. A configured bot token, correct channel permissions and persistent storage are still required when running the project.
