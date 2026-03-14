# GeoAnalyzr

GeoAnalyzr is a Tampermonkey userscript for analyzing your GeoGuessr games.
It syncs your feed, fetches missing round details, and provides analysis plus Excel export.

## Requirements

For usage:
- A browser with Tampermonkey (Chrome/Edge/Firefox)
- A GeoGuessr account

For development:
- Node.js (latest LTS recommended)
- npm
- Git

## Installation

GeoAnalyzr is available in three variants:

1) **Local (recommended)** — full dashboard + analysis stored locally in your browser  
2) **Sync-only** — minimal: only a small button to *Fetch + Sync* to the GeoAnalyzr website  
3) **Dev** — testing build that tracks `master`

### 1) Local (recommended)

1. Open this file in your browser:
   - Local: `https://github.com/JonasLmbt/GeoAnalyzr/releases/latest/download/geoanalyzr.user.js`
2. Tampermonkey will show the install dialog.
3. Click install.

### 2) Sync-only (minimal)

1. Open this file in your browser:
   - Sync-only: `https://github.com/JonasLmbt/GeoAnalyzr/releases/latest/download/geoanalyzr.sync.user.js`
2. Install it in Tampermonkey.
3. Open GeoGuessr and click the small GeoAnalyzr icon (bottom-left). It runs **Fetch + Sync**.

Notes:
- No overlay UI, no charts, no analysis window — just syncing.
- If you are not linked yet, it opens a linking tab (Discord login required once).
- It also auto-syncs occasionally in the background (rate-limited).

### 3) Dev (testing)

1. Open:
   - Dev: `https://raw.githubusercontent.com/JonasLmbt/GeoAnalyzr/master/geoanalyzr.dev.user.js`
2. Install it in Tampermonkey.

## Usage

1. Open GeoGuessr and log in.
2. Click the GeoAnalyzr icon in the bottom-left corner to open the panel.
3. Run **Fetch Data** to sync new games and fetch missing details.
4. Open analysis or export to Excel.

![GeoAnalyzr panel entry point](images/geoanalyzr.png)

## Support & Ideas (Discord)

If you need support or want to suggest new analysis ideas / features, join my Discord server:

- `https://discord.gg/ks5gh7MXhd`

## Auto Updates

The scripts include:
- `@updateURL`
- `@downloadURL`

Tampermonkey can therefore detect and install updates automatically.

## Security and Privacy

### Local (recommended)

- The Local script stores data locally in your browser (IndexedDB).
- It does **not** sync your dataset to the GeoAnalyzr website.
- You can remove local data at any time using **Reset Database**.
- You can export/import your dataset via **Settings → Data** (useful for moving browsers).

### Sync-only / Dev (opt-in sync)

- These variants can sync data to the GeoAnalyzr server, but only after your device is linked (Discord OAuth).
- A per-device sync token is stored locally in your browser and sent as `Authorization: Bearer …` over HTTPS.
- You can re-link at any time to issue a new token.

## Development

Clone the repository:

```bash
git clone https://github.com/JonasLmbt/GeoAnalyzr.git
cd GeoAnalyzr
npm install
```

Build commands:

```bash
# Dev build (dist/userscript.user.js)
npm run build:dev

# Release build (geoanalyzr.user.js)
npm run build:release

# Sync-only build (geoanalyzr.sync.user.js)
npm run build:sync

# Build all
npm run build
```

Watch mode:

```bash
npm run watch
```

## Acknowledgements

- [GeoInsights by Safwan Sipai](https://github.com/SafwanSipai/geo-insight)
- [GeoGuessr API guide](https://efisha.com/2022/04/18/geoguessr-api-endpoints/)

