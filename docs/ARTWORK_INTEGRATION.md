# Artwork integration (Sprint 7)

## Direction

One official mascot. One calm interface. No asset sheets, no decorative woodland UI, no extra poses.

## Source

- Desktop original: `Cheerful Goblin Explorer Mascot.png`
- Preserved: `public/assets/branding/goblin-original.png`
- App assets:
  - `public/assets/branding/goblin-mascot.webp` (primary, ~61 KB, 424×512)
  - `public/assets/branding/goblin-mascot.png` (fallback)
  - `public/assets/branding/goblin-mascot-full.png` (full-res transparent archive)

## Transparency

Background was near-white (`#FEFEFE`). Removal used edge flood-fill + soft fringe despill (Pillow/numpy). QC composites on parchment, forest green, grey, and white are in `docs/assets/mascot-qc-*.png`. Corners are fully transparent; silhouette (ears, goggles, fingers, backpack leaf) preserved.

## Placement

The mascot appears **only** in the Den dashboard welcome card (`GoblinMascot` on `HomePage`).

Removed from: app shell brand, auth, brain dump, overwhelm mode.

## Not used

Previous fantasy asset sheet extractions, illustrated nav/capacity badges, empty-state vignettes, decorative leaves/mushrooms.
