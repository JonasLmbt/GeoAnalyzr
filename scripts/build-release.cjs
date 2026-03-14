const esbuild = require("esbuild");

const outFile = process.argv[2] || "geoanalyzr.user.js";
const isDev = /(^|[\\/])geoanalyzr\.dev\.user\.js$/i.test(outFile);
const isSyncOnly = /(^|[\\/])geoanalyzr\.sync\.user\.js$/i.test(outFile);
const isLocal = !isDev && !isSyncOnly;

const version = isDev ? "2.3.21-dev" : "2.3.21";

const syncExtraGrants = isDev || isSyncOnly
  ? `// @grant        GM_getValue
// @grant        GM_setValue`
  : "";

const syncExtraConnect = isDev || isSyncOnly
  ? `// @connect      sync.geoanalyzr.lmbt.app
// @connect      geoanalyzr.lmbt.app`
  : "";

const banner = `// ==UserScript==
// @name         ${isDev ? "GeoAnalyzr (Dev)" : isSyncOnly ? "GeoAnalyzr Sync" : "GeoAnalyzr (Local)"}
// @namespace    ${isDev ? "geoanalyzr-dev" : isSyncOnly ? "geoanalyzr-sync" : "geoanalyzr"}
// @author       JonasLmbt
// @version      ${version}
// @updateURL    ${isDev ? "https://raw.githubusercontent.com/JonasLmbt/GeoAnalyzr/master/geoanalyzr.dev.user.js" : isSyncOnly ? "https://github.com/JonasLmbt/GeoAnalyzr/releases/latest/download/geoanalyzr.sync.user.js" : "https://github.com/JonasLmbt/GeoAnalyzr/releases/latest/download/geoanalyzr.user.js"}
// @downloadURL  ${isDev ? "https://raw.githubusercontent.com/JonasLmbt/GeoAnalyzr/master/geoanalyzr.dev.user.js" : isSyncOnly ? "https://github.com/JonasLmbt/GeoAnalyzr/releases/latest/download/geoanalyzr.sync.user.js" : "https://github.com/JonasLmbt/GeoAnalyzr/releases/latest/download/geoanalyzr.user.js"}
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
    entryPoints: [isSyncOnly ? "src/mainSyncOnly.ts" : "src/main.ts"],
    bundle: true,
    format: "iife",
    outfile: outFile,
    banner: { js: banner },
    define: {
      __GA_VARIANT__: JSON.stringify(isDev ? "dev" : isSyncOnly ? "sync" : "local")
    }
  })
  .catch(() => process.exit(1));
