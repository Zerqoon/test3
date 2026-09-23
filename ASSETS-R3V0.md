# R3V0 Fantasy Asset Pack

The renderer now actively uses local clan-themed graphics from `assets/branding/ui/`.
All original generated graphics are also preserved in `assets/branding/generated/`.

## Runtime UI assets
- `background.png` — fantasy kingdom background
- `frame-main.png` — crystal frame overlay
- `frame-chart.png` — contribution chart frame
- `panel-texture.png` — panel texture
- `platform.png` — glowing crown/platform ornament
- `crystals.png` — crystal cluster
- `crystal-cat-combo.png` — crystals + mascot decoration
- `pet-angel.png` — angel cube mascot
- `pet-bat.png` — dark bat mascot
- `pet-cat.png` — crystal cat mascot
- `coins.png` — paw coin pile
- `pillar.png` — crystal/castle pillar
- `header-ornament.png` — upper crown ornament
- `side-ornament.png` — side tower ornament
- `icons-sheet.png` — crown/star/paw/chart/crystal/trophy icon atlas

## Renderer integration
`src/canvas/renderers.ts` loads these files at runtime. It uses the fantasy background, decorative pillars, crystal overlays, mascots, coins, frames, clan logo, player headshot in a circular frame, and a glowing vertical bar chart for contribution history.

The build already copies the complete `assets/` directory into `dist/assets`, and Docker copies `assets/` into the runtime image.
