const esbuild = require("esbuild");

const outFile = process.argv[2] || "geoanalyzr.user.js";
const isDev = /(^|[\\/])geoanalyzr\.dev\.user\.js$/i.test(outFile);

const banner = `// ==UserScript==
// @name         ${isDev ? "GeoAnalyzr (Dev)" : "GeoAnalyzr"}
// @namespace    ${isDev ? "geoanalyzr-dev" : "geoanalyzr"}
// @author       JonasLmbt
// @version      2.2.12
// @updateURL    ${isDev ? "https://raw.githubusercontent.com/JonasLmbt/GeoAnalyzr/master/geoanalyzr.dev.user.js" : "https://github.com/JonasLmbt/GeoAnalyzr/releases/latest/download/geoanalyzr.user.js"}
// @downloadURL  ${isDev ? "https://raw.githubusercontent.com/JonasLmbt/GeoAnalyzr/master/geoanalyzr.dev.user.js" : "https://github.com/JonasLmbt/GeoAnalyzr/releases/latest/download/geoanalyzr.user.js"}
// @icon         https://raw.githubusercontent.com/JonasLmbt/GeoAnalyzr/master/images/logo.svg
// @match        https://www.geoguessr.com/*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      www.geoguessr.com
// @connect      game-server.geoguessr.com
// @connect      github.com
// @connect      raw.githubusercontent.com
// @connect      cdn.jsdelivr.net
// @connect      api.bigdatacloud.net
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
