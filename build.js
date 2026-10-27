// Builds Capybara for Sojo hosting: public/ (page, styles, the bundled client with three.js and the Sojo SDK, card
// picture) and worker/dist (the Worker with the Pond Durable Object).
//   node build.js                         — build
//   npm run dev                           — build + wrangler dev on http://localhost:8787/?dev=<name>
//   npx -y --prefer-online @sojogg/cli@latest deploy   — upload to the dev URL (not done yet: the user's call)
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");

const OUT = path.join(__dirname, "public");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.cpSync(path.join(__dirname, "static"), OUT, { recursive: true });         // page, styles, assets/ (art/fetch-assets.js)
const card = path.join(__dirname, "art", "card-x.png");               // 1200×628 X card, from art/shoot.js
if (fs.existsSync(card)) fs.copyFileSync(card, path.join(OUT, "card-x.png"));

const esbuild = require.resolve("esbuild/bin/esbuild");
const run = args => execFileSync(process.execPath, [esbuild, ...args], { stdio: "inherit" });
run([path.join(__dirname, "client", "main.js"), "--bundle", "--format=iife", "--minify", "--target=es2020", "--outfile=" + path.join(OUT, "app.js")]);
// Worker: npm imports bundled into one module (hosting uploads only files next to main)
run([path.join(__dirname, "worker", "src.js"), "--bundle", "--format=esm", "--platform=neutral", "--main-fields=module,main", "--minify",
  "--outfile=" + path.join(__dirname, "worker", "dist", "index.js")]);

const files = fs.readdirSync(OUT, { recursive: true }).filter(f => fs.statSync(path.join(OUT, f)).isFile());
console.log("public/:", files.length, "files,", (files.reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0) / 1e6).toFixed(1), "MB");
