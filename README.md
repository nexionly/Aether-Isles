<div align="center">

<img src="./src/assets/images/title_key_art_1795699734519.jpg" alt="Aether Isles: Skybridge Siege — Floating sky islands linked by ancient stone bridges" width="100%" />

# Aether Isles: Skybridge Siege

**A 2D isometric sky-island real-time strategy game inspired by classic *NetStorm: Islands at War*.**  
Build polyomino sky-bridges across open void, harvest Aether Crystals, command Wind, Rain, and Thunder fortifications, launch flying Sky Fleets, and perform Altar Rituals to claim the archipelago.

[![Play Online](https://img.shields.io/badge/Play%20Online-aether--isles.ai.studio-f0b429?style=for-the-badge)](https://aether-isles.ai.studio)
[![PWA Ready](https://img.shields.io/badge/PWA-Installable%20Offline-2dd4bf?style=for-the-badge)](./vite.config.ts)
[![License: MIT](https://img.shields.io/badge/License-MIT-38bdf8?style=for-the-badge)](./LICENSE)

**Play online in your browser:** [https://aether-isles.ai.studio](https://aether-isles.ai.studio)

</div>

---

## Core Features

### Polyomino Sky-Bridges & Island Supply Lines
- **Tetromino Bridge Queue:** Rotate (`R`) and snap interlocking bridge spans across open sky to connect Aether Vents, neutral Rogue Shrines, and rival fortresses.
- **Severed Bridge Decay:** Cutting an enemy bridge severs power from their High Temple—disconnected spans crack and crumble unless reconnected or sustained by a forward **Aether Relay Outpost**.
- **Structure Reclaim:** Recycle outdated allied structures (`Delete` or the HUD **Reclaim** button) to recover 60% of their Aether cost.

### Three Elemental Aspects & Cross-Aspect Tech Tree
Choose your starting Fury—then unlock your Tier-2 siege weapons, Sky Fleet cruisers, and **rival Furies' structures** through the 3-choice **Altar Knowledge** upgrade picker after sacrificing Priests or shattering rival Temples.

<div align="center">

| <img src="./src/assets/images/fury_wind_emblem_1795699735323.jpg" width="96" alt="Wind Aspect" /> | <img src="./src/assets/images/fury_rain_emblem_1795699736142.jpg" width="96" alt="Rain Aspect" /> | <img src="./src/assets/images/fury_thunder_emblem_1795699736997.jpg" width="96" alt="Thunder Aspect" /> |
| :---: | :---: | :---: |
| **Wind Aspect** | **Rain Aspect** | **Thunder Aspect** |
| Rapid directional Gale Ballistas, Cyclone Spires, piercing Zephyr Lances, and roving Tempest Vortices. | Splash Tidal Mortars, regenerating Glacial Bulwarks, and bio-electric Man-o-War Leviathans. | Bridge-shattering Volt Cannons, chain-lightning Spark Pylons, and high-voltage Arc Spires. |

</div>

### Mobile Sky Fleet & Void-Crossing Airlifts
Launch airborne units directly from the **Sky Fleet** dock tab to fly freely over open sky without bridges:
- **Solar Skiff:** Fast scout and raider that pierces Fog of War and harasses exposed towers and Golems.
- **Aether Dirigible:** Snatches stunned Rogue or rival High Priests and airlifts them over open void straight to your Sacrificial Altar.
- **Tempest Vortex:** Autonomous roaring whirlwind that hunts hostile structures, bridges, and defenders.
- **Sky Leviathan:** Regenerating bio-electric sky cruiser that lashes enemy towers and flyers.

### High Priest Abilities & Special Structures
- **Active High Priest Abilities:** **Recall (`Q`)** to teleport back to your High Temple, **Aegis Ward (`E`)** for 50% damage reduction plus area repair, and **Tempest Surge (`T`)** for an elemental storm burst.
- **Tactical Utility Structures:** **Aether Relay Outpost** (forward power hub), **Sky Observatory Watchtower** (14-tile scouting vision), **Energy Fence Pylons** (link aligned pylons within 5 tiles to block directional fire and zap intruders), and camouflaged **Aether Bridge Mines**.
- **Smart Aether Golems:** Automatically harvest crystals from Aether Vents, auto-repair nearby damaged allied structures and bridges when idle, and haul stunned Priests back to your Altar.

### Customizable Skirmishes & Optional Fog of War
- Battle **1 to 6 AI opponents** across dynamically scaled archipelagos with three locked difficulty tiers (**Initiate**, **Archon**, **Stormlord**).
- Toggle **Optional Fog of War & Scouting**, **Temple Siege**, **Sacred Site Dominance**, and **Aether Overload** victory rules right from the title screen or in-game Rules menu.
- Features a dynamic visual weather cycle transitioning across calm golden-hour skies, light rain with isometric surface ripples, and localized drifting thunderstorm cells with forked lightning.
- Includes a full original soundtrack, spatial Web Audio combat SFX, and full **Progressive Web App (PWA)** offline support for desktop and mobile installation.

---

## Controls & Hotkeys

| Input | Action |
| :--- | :--- |
| **Left / Right / Middle Drag** or **WASD / Arrows** | Pan across the archipelago |
| **Mouse Wheel** or **`+` / `-`** | Zoom camera in / out |
| **`Space`** | Center camera on your High Temple |
| **`P`** | Locate & select your High Priest |
| **`B`** | Select next Sky-Bridge piece |
| **`R`** or **Right-Click** (while placing) | Rotate bridge span or directional turret |
| **`Q` / `E` / `T`** | Cast High Priest abilities (**Recall** / **Aegis Ward** / **Tempest Surge**) |
| **`G`** | Summon an Aether Golem |
| **`Delete` / `Backspace`** | Reclaim selected allied structure for 60% Aether refund |
| **`V`** | Toggle tactical firing-range overlay |
| **`F`** | Cycle simulation speed (`1x` / `2x` / `3x` / `5x`) |
| **`1`–`9`** | Select tool (`1`) or combat structure slots (`2`–`9`) |
| **`Esc`** | Cancel placement or pause game |

---

## Play Online & Running Locally

Play instantly in your browser—no installation required—at **[https://aether-isles.ai.studio](https://aether-isles.ai.studio)**.

To run locally, requires **Node.js 20+** and **npm**:

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

To create a production build:

```bash
npm run build
npm run preview
```

---

## Publishing on GitHub Pages

This repository includes a ready-to-run GitHub Actions workflow at [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) that automatically builds and publishes the game to GitHub Pages whenever you push to `main`.

1. Push this repository to GitHub and make it **Public** (under **Settings → General → Danger Zone → Change visibility**).
2. Go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. Push a commit to `main` (or trigger **Deploy to GitHub Pages** manually in the **Actions** tab).

Your live playable game will automatically be published at:
```text
https://<your-username>.github.io/<your-repository-name>/
```

---

## Tech Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, Lucide Icons
- **Engine & Rendering:** Custom 60fps HTML5 Canvas2D isometric engine, hand-painted bespoke sprite atlas with runtime chroma-keying, custom Web Audio synthesizer & music manager
- **Build & PWA:** Vite, `vite-plugin-pwa` (Workbox offline caching & installable app manifest)

## License

Released under the [MIT License](./LICENSE).
