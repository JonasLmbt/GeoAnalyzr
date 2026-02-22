const esbuild = require("esbuild");

const outFile = process.argv[2] || "geoanalyzr.user.js";

const banner = `// ==UserScript==
// @name         GeoAnalyzr
// @namespace    geoanalyzr
// @author       JonasLmbt
// @version      2.1.1
// @updateURL    https://raw.githubusercontent.com/JonasLmbt/GeoAnalyzr/master/geoanalyzr.user.js
// @downloadURL  https://raw.githubusercontent.com/JonasLmbt/GeoAnalyzr/master/geoanalyzr.user.js
// @match        https://www.geoguessr.com/*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      www.geoguessr.com
// @connect      game-server.geoguessr.com
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
