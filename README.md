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

## Installation (User)

1. Open this file in your browser:
   - Stable (recommended): <https://github.com/JonasLmbt/GeoAnalyzr/releases/latest/download/geoanalyzr.user.js>
   - Dev (tracks `master`, for testing): <https://raw.githubusercontent.com/JonasLmbt/GeoAnalyzr/master/geoanalyzr.dev.user.js>
2. Tampermonkey will show the install dialog.
3. Click install.

## Usage

1. Open GeoGuessr and log in.
2. Click the GeoAnalyzr icon in the bottom-left corner to open the panel.
3. Run `Fetch Data` to sync new games and fetch missing details.
4. Open analysis or export to Excel.

![GeoAnalyzr panel entry point](images/geoanalyzr.png)

## Support & Ideas (Discord)

If you need support or want to suggest new analysis ideas / features, join my Discord server:

- https://discord.gg/ks5gh7MXhd

## Auto Updates

The script already includes:
- `@updateURL`
- `@downloadURL`

Tampermonkey can therefore detect and install updates automatically.

## Security and Privacy

- GeoAnalyzr does **not** use an external database and does not send analysis data to custom servers.
- Data is stored locally in your browser (IndexedDB).
- You can remove local data at any time using `Reset Database`.

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

# Build both
npm run build
```

Watch mode:

```bash
npm run watch
```

## Acknowledgements

- [GeoInsights by Safwan Sipai](https://github.com/SafwanSipai/geo-insight)
- [GeoGuessr API guide](https://efisha.com/2022/04/18/geoguessr-api-endpoints/)
