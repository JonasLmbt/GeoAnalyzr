const esbuild = require("esbuild");

const outFile = process.argv[2] || "geoanalyzr.user.js";
const isDev = /(^|[\\/])geoanalyzr\.dev\.user\.js$/i.test(outFile);

const version = isDev ? "2.3.20-dev" : "2.3.15";

const devExtraGrants = isDev
  ? `// @grant        GM_getValue
// @grant        GM_setValue`
  : "";

const devExtraConnect = isDev
  ? `// @connect      sync.geoanalyzr.lmbt.app`
  : "";

const banner = `// ==UserScript==
// @name         ${isDev ? "GeoAnalyzr (Dev)" : "GeoAnalyzr"}
// @namespace    ${isDev ? "geoanalyzr-dev" : "geoanalyzr"}
// @author       JonasLmbt
// @version      ${version}
// @updateURL    ${isDev ? "https://raw.githubusercontent.com/JonasLmbt/GeoAnalyzr/master/geoanalyzr.dev.user.js" : "https://github.com/JonasLmbt/GeoAnalyzr/releases/latest/download/geoanalyzr.user.js"}
// @downloadURL  ${isDev ? "https://raw.githubusercontent.com/JonasLmbt/GeoAnalyzr/master/geoanalyzr.dev.user.js" : "https://github.com/JonasLmbt/GeoAnalyzr/releases/latest/download/geoanalyzr.user.js"}
// @icon         https://raw.githubusercontent.com/JonasLmbt/GeoAnalyzr/master/images/logo.svg
// @match        https://www.geoguessr.com/*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
${devExtraGrants}
// @connect      www.geoguessr.com
// @connect      game-server.geoguessr.com
${devExtraConnect}
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
    entryPoints: ["src/main.ts"],
    bundle: true,
    format: "iife",
    outfile: outFile,
    banner: { js: banner }
  })
  .catch(() => process.exit(1));
