const esbuild = require("esbuild");

const outFile = process.argv[2] || "geoanalyzr.user.js";
const isDev = /(^|[\\/])geoanalyzr\.dev\.user\.js$/i.test(outFile);
const isSyncOnly = /(^|[\\/])geoanalyzr\.sync\.user\.js$/i.test(outFile);
const isLocal = !isDev && !isSyncOnly;

const stableVersion = "2.4.9";
const devVersion = "2.4.10-dev";
const version = isDev ? devVersion : stableVersion;

// GitHub "releases/latest/download/..." can point to a release that doesn't include the assets,
// which breaks installation/auto-updates. Raw GitHub URLs are always backed by the repo contents.
const rawBase = "https://raw.githubusercontent.com/JonasLmbt/GeoAnalyzr/master";

// Server sync and device linking need these grants/permissions in all variants that can sync.
const syncExtraGrants = isDev || isSyncOnly || isLocal
  ? `// @grant        GM_getValue
// @grant        GM_setValue`
  : "";

const syncExtraConnect = isDev || isSyncOnly || isLocal
  ? `// @connect      sync.geoanalyzr.lmbt.app
// @connect      geoanalyzr.lmbt.app`
  : "";

const banner = `// ==UserScript==
// @name         ${isDev ? "GeoAnalyzr (Dev)" : isSyncOnly ? "GeoAnalyzr (Minimal)" : "GeoAnalyzr"}
// @namespace    ${isDev ? "geoanalyzr-dev" : isSyncOnly ? "geoanalyzr-sync" : "geoanalyzr"}
// @author       JonasLmbt
// @version      ${version}
// @updateURL    ${isDev ? `${rawBase}/geoanalyzr.dev.user.js` : isSyncOnly ? `${rawBase}/geoanalyzr.sync.user.js` : `${rawBase}/geoanalyzr.user.js`}
// @downloadURL  ${isDev ? `${rawBase}/geoanalyzr.dev.user.js` : isSyncOnly ? `${rawBase}/geoanalyzr.sync.user.js` : `${rawBase}/geoanalyzr.user.js`}
// @icon         https://raw.githubusercontent.com/JonasLmbt/GeoAnalyzr/master/images/logo.svg
// @match        https://www.geoguessr.com/*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
${syncExtraGrants}
// @connect      www.geoguessr.com
// @connect      game-server.geoguessr.com
${syncExtraConnect}
// @connect      github.com
// @connect      raw.githubusercontent.com
// @connect      media.githubusercontent.com
// @connect      objects.githubusercontent.com
// @connect      cdn.jsdelivr.net
// @connect      api.bigdatacloud.net
// @connect      api-bdc.io
// @connect      www.geoboundaries.org
// ==/UserScript==`;

esbuild
  .build({
    // Minimal should be a copy of stable UI, just without the analysis tab.
    // (Feature is disabled via __GA_VARIANT__ === "sync" inside the UI.)
    entryPoints: ["src/main.ts"],
    bundle: true,
    format: "iife",
    outfile: outFile,
    banner: { js: banner },
    define: {
      __GA_VARIANT__: JSON.stringify(isDev ? "dev" : isSyncOnly ? "sync" : "local")
    }
  })
  .catch(() => process.exit(1));
