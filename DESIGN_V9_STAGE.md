# R3V0 Canvas V9 — Clan Stage

The Player History renderer was rebuilt around a new composition instead of stacking generated frames.

## Layout
- compact branded header with R3V0 logo, timeframe and live status,
- one large left Clan Stage card containing the circular player avatar and the R3V0 scene,
- R3V0 logo is the hero focal point, supported by the platform, two pets, pillars and restrained crystal accents,
- three clean statistic cards on the right: Clan Position, Contribution and Performance,
- one full-width Contribution History chart at the bottom using glowing vertical bars.

## Asset usage
The renderer intentionally does not place every decorative PNG everywhere. It uses the fantasy background, clan logo, pillars, platform, angel pet, bat pet, crystals and coins where they improve hierarchy. The complete generated asset pack remains in `assets/branding/` and `assets/branding/ui/`.

## Compatibility
The public renderer exports and existing `renderHistory(...)` signature remain compatible with the bot.
