# Local validation

Validated on Node.js v24.19.0 with discord.js 14.27.0.

- Strict TypeScript compilation: passed.
- Behavioral tests: **20 passed, 0 failed**.
- Native giveaway modal: four labelled text inputs plus an optional role selector; 22 slash command definitions serialized successfully.
- Welcome renderer: produced the bundled 1200 × 675 PNG and was visually inspected.
- Local doctor: valid configuration, banner and font present, guild auto-detection enabled.
- Railway environment simulation: rejects missing volumes and database paths outside the mount; accepts the configured volume and passes diagnostics.
- Native SQLite backup: produced a backup inside the simulated volume; reopened the backup and verified stored data.
- GitHub workflow YAML and required Docker build inputs: validated locally. Workflow runs Node 24, compilation, tests and diagnostics without a Discord token.

The tests cover Railway database path resolution and persistent-volume safeguards, duration formats and bounds, Warsaw/DST boundaries, owner and role authorization, nickname formatting, database persistence and deduplication, copy-before-delete safety, retry behavior, native modal structure, single-instance lease recovery, historical pagination recovery, log outbox persistence, selected-role pings, entry uniqueness, fresh role checks, interrupted draw recovery, winner delivery deduplication and temporary-ban protection / recovery.

Discord requests in tests use local API doubles. No token was supplied, so login, real server permission configuration, live gateway behavior and actual DM delivery have not been tested on a Discord server. Docker and Windows launcher are included; their platform deployment has not been executed in this Linux validation environment. GitHub Actions and actual Railway hosting have not been run under a connected account.
