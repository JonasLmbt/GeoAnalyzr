const { execSync } = require("child_process");
const { stableVersion } = require("./version.cjs");

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

run(`git add geoanalyzr.user.js geoanalyzr.dev.user.js geoanalyzr.sync.user.js`);
run(`git commit -m "chore: release v${stableVersion}"`);
run(`git push`);

console.log(`Released v${stableVersion}`);
