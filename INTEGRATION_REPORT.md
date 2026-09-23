# R3V0 PS99 — Integration Report 1.3.0

This package is the unified project created from the base bot and the tactical renderer package.

## Integrated

- tactical `src/canvas/renderers.ts` is now the renderer used by the bot;
- `assets/tactical/graffiti.png` is included in the production asset tree;
- `/player history`, `/history <player>` and `/battle player` pass the real Roblox user ID to the renderer;
- the history card receives a real TOP 3 leaderboard computed from the current clan roster;
- `/player info` now also renders the standalone tactical player card;
- the ordinary Roblox avatar remains available as the Discord embed thumbnail;
- the standalone card and history card use the same player identity, clan data and battle context;
- legacy renderer helper exports were retained as compatibility wrappers;
- the existing API, SQLite history, whitelist, scheduler, RAP, mastery and deployment logic were left in place.

## Assets and deployment

`npm run build` already copies the complete `assets/` directory to `dist/assets`. The Dockerfile also copies `assets/` to the runtime image, so `assets/tactical/graffiti.png` is available both locally and on Railway.

The tactical renderer uses its built-in sans-serif fallback when optional custom font files are absent. The supplied Docker image installs DejaVu system fonts.

## Verification performed during merge

- every TypeScript file was parsed/transpiled with the TypeScript compiler without syntax diagnostics;
- all relative imports under `src/` were checked and resolve to existing project files;
- integration points for player ID, leaderboard and player card are present in the Discord handler.

A full dependency-backed `npm install` / `npm run typecheck` could not be executed in the build sandbox because the npm registry was unreachable (`EAI_AGAIN`). The package keeps the original dependency declarations and is intended to run the normal install/build sequence in an environment with npm registry access.
