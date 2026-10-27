// Local look check against `npm run dev`: screenshots at a few hours and sizes, console errors printed.
//   node shot.js [base] [hours...]   → shot-<w>x<h>-<hour>.png;  CLOSE=1 — the camera right by the capybara, LB=1 — the leaderboard open
const path = require("path");
const { chromium } = require("playwright");
const BASE = process.argv[2] || "http://127.0.0.1:8787/";
const HOURS = process.argv.slice(3).length ? process.argv.slice(3) : ["8", "13", "18.7", "23"];
const SIZES = [[480, 300], [960, 600]];
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE)).ok) break } catch {} await sleep(500) }
  const browser = await chromium.launch({ headless: false, args: ["--use-angle=d3d11"] });
  for (const [w, h] of SIZES) for (const hr of HOURS) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on("console", m => { if (m.type() === "error" || m.type() === "warning") console.log(`[${w}x${h} t=${hr}] ${m.type()}: ${m.text()}`) });
    page.on("pageerror", e => console.log(`[${w}x${h} t=${hr}] pageerror: ${e.message}`));
    await page.goto(`${BASE}?dev=capyfan&t=${hr}${process.env.Q || ""}`);
    await sleep(2500);
    if (process.env.CLOSE) {
      await page.evaluate(() => { const w = window.__world; w.controls.minDistance = 0.5; w.controls.target.set(-0.45, 0.4, 0.55); w.camera.position.set(0.5, 0.75, 2.1) });
      await sleep(1500);
    }
    if (process.env.LB) { await page.click("#lb-open"); await sleep(900) }
    await page.screenshot({ path: path.join(__dirname, `shot-${w}x${h}-${hr}${process.env.CLOSE ? "-close" : ""}${process.env.LB ? "-lb" : ""}.png`) });
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1) });
