# GeoAnalyzr

GeoAnalyzr ist ein Tampermonkey-Userscript zur Analyse deiner GeoGuessr-Spiele.  
Es synchronisiert deinen Feed, lädt fehlende Round-Details nach und bietet dir Auswertungen sowie Excel-Export.

## Voraussetzungen

Für die Nutzung:
- Ein Browser mit Tampermonkey (z. B. Chrome/Edge/Firefox)
- Ein GeoGuessr-Account

Für die Entwicklung:
- Node.js (aktuelle LTS-Version empfohlen)
- npm
- Git

## Installation (als Nutzer)

1. Öffne diese Datei im Browser:
   - `https://raw.githubusercontent.com/JonasLmbt/GeoAnalyzr/main/geoanalyzr.user.js`
2. Tampermonkey zeigt den Install-Dialog an.
3. Installieren klicken.

## Auto-Updates

Das Script enthält bereits:
- `@updateURL`
- `@downloadURL`

Damit erkennt Tampermonkey neue Versionen automatisch, sobald du eine neue Version in `main` veröffentlichst.

## Nutzung

1. GeoGuessr öffnen und einloggen.
2. Das GeoAnalyzr-Panel öffnen.
3. `Fetch Data` ausführen, um neue Spiele und fehlende Details zu laden.
4. Optional `_ncfa` Token setzen, um vollständigere Daten zu bekommen.
5. Analysen öffnen oder Excel exportieren.

## Entwicklung

Repository klonen:

```bash
git clone https://github.com/JonasLmbt/GeoAnalyzr.git
cd GeoAnalyzr
npm install
```

Builds:

```bash
# Dev-Build (dist/userscript.user.js)
npm run build:dev

# Release-Build (geoanalyzr.user.js)
npm run build:release

# Beide Builds
npm run build
```

Watch-Modus:

```bash
npm run watch
```

## `_ncfa` Cookie finden

1. GeoGuessr im Browser öffnen und einloggen.
2. DevTools öffnen (`F12` / `Ctrl+Shift+I`, auf Mac `Cmd+Option+I`).
3. Zum Tab `Network` wechseln.
4. Seite neu laden.
5. Nach `stats` filtern.
6. Einen `stats`-Request öffnen.
7. In den Request-Headers die Cookie `_ncfa` suchen.
8. Nur den Wert kopieren (nach `=` bis vor `;`).

## Sicherheit und Datenschutz

- GeoAnalyzr nutzt **keine externe Datenbank** und sendet keine Analysedaten an eigene Server.
- Daten werden lokal im Browser (IndexedDB) gespeichert.
- Der `_ncfa`-Token wird lokal gespeichert, damit du ihn nicht ständig neu eingeben musst.
- Mit `Reset Database` kannst du lokale Daten jederzeit löschen.

## Acknowledgements

- [GeoInsights by Safwan Sipai](https://github.com/SafwanSipai/geo-insight)
- [GeoGuessr API guide](https://efisha.com/2022/04/18/geoguessr-api-endpoints/)
- [Fetching the _ncfa cookie](https://github.com/EvickaStudio/GeoGuessr-API?tab=readme-ov-file#authentication)
