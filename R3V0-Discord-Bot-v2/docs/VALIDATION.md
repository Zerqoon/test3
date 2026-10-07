# Local validation

Validated on Node.js v24.19.0 with discord.js 14.27.0.

- Strict TypeScript compilation: passed.
- Behavioral tests: **39 passed, 0 failed**.
- Native giveaway modal: four labelled text inputs plus a mandatory role selector; **29** slash command definitions serialized successfully.
- Welcome renderer: produced the bundled 1200 × 675 PNG and was visually inspected.
- Local doctor: valid configuration, GOAT banner, application screenshot example and font present, guild auto-detection enabled.
- Railway environment simulation: rejects missing volumes and database paths outside the mount; accepts the configured volume and passes diagnostics.
- Native SQLite backup: produced a backup inside the simulated volume; reopened the backup and verified stored data.
- GitHub workflow YAML and required Docker build inputs: validated locally. Workflow runs Node 24, compilation, tests and diagnostics without a Discord token.

The tests cover Railway database path resolution and persistent-volume safeguards, duration bounds, Warsaw/DST boundaries, owner and role authorization, nickname formatting, message deduplication, copy-before-delete safety, mandatory role picker, lease and history recovery, selected-role pings, unique giveaway entries, fresh eligibility checks, interrupted draw recovery and temporary-ban protection.

Version 2 checks also cover readable channel / permission logs without raw JSON or default noise, oversized permission evidence, native audit / fallback deduplication, quiet automatic role changes, batched log character limits and destination isolation, frozen retry contents and nonces, GIF enrichment, autorole backfill for humans, hierarchy error recovery, no reminders for pre-existing members, fresh clan-role eligibility, single reminder delivery, deletion at 60 seconds after a service restart, exact private ticket overwrite targets, supplied panel / application assets, double-click / panel restart deduplication, fresh staff authorization and owner fallback, durable participant permission repair, 205-message transcript pagination plus observed deletions, HTML escaping / unsafe URL rejection, retry after failed transcript reads, delete-before-delivery protection, delivery receipt persistence after cleanup, and legacy database migration preserving activity totals.

Discord requests in tests use local API doubles. No token was supplied, so login, real server permission configuration, live gateway behavior and actual DM delivery have not been tested on a Discord server. Docker, the Windows launcher and UPLOAD-GITHUB.ps1 are included; Docker / PowerShell platform execution has not been performed in this Linux environment. GitHub Actions, repository push and actual Railway hosting have not been run under a connected account. The bundled subfolder workflow targets R3V0-Discord-Bot-v2; the upload script installs it at the repository root.
