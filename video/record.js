// Promo video for X: 1080×1350, ~16 s. A sunset push-in on the capybara with a title, the HUD and a pet with hearts,
// a pull-back to an end card. The soundtrack is the game's own lofi radio rendered offline (no dropouts) and muxed in.
// Runs against the local server (npm run dev): ?dev= exposes the world and the radio to the page.
// Recorded with Playwright (visible window: headless draws WebGL white), encoded with ffmpeg (ffmpeg-static).
//   node video/record.js [base]   → video/out/capybara.mp4
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const { chromium } = require("playwright");
const ffmpeg = require("ffmpeg-static");

const BASE = process.argv[2] || "http://127.0.0.1:8787/";
const OUT = path.join(__dirname, "out"), W = 1080, H = 1350, SECONDS = 16;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// what the page runs: the camera path, the overlays, the pet. Times in seconds from start()
const DIRECTOR = `(() => {
  const w = window.__world, cam = w.camera, ctl = w.controls;
  Object.assign(ctl, { minDistance: 0.2, maxDistance: 50, minPolarAngle: 0.05, maxPolarAngle: 1.6, minAzimuthAngle: -Infinity, maxAzimuthAngle: Infinity, enableDamping: false });
  const css = document.createElement("style");
  css.textContent = \`
    .hidehud #farm, .hidehud #radio, .hidehud #acts, .hidehud #full, .hidehud #tap { opacity: 0 }
    #farm, #radio, #acts, #full { transition: opacity .8s }
    #tap, #bubble { display: none !important }
    .cap { position: fixed; left: 0; right: 0; text-align: center; z-index: 50; pointer-events: none; opacity: 0; transition: opacity .7s, transform .7s;
      font: 600 64px/1.12 Fredoka, Nunito, sans-serif; color: #fff8ec; text-shadow: 0 3px 18px #2a120088, 0 1px 2px #0006; transform: translateY(12px) }
    .cap.on { opacity: 1; transform: none }
    .cap small { display: block; font-size: 34px; font-weight: 500; margin-top: 10px; color: #ffe2bf }
    #hand { position: fixed; z-index: 60; font-size: 96px; pointer-events: none; transition: left 1s cubic-bezier(.4,0,.2,1), top 1s cubic-bezier(.4,0,.2,1), transform .15s;
      filter: drop-shadow(0 6px 10px #0005); opacity: 0 }
    #endcard { position: fixed; inset: 0; z-index: 70; display: grid; place-content: center; text-align: center; gap: 22px; opacity: 0; transition: opacity 1s;
      background: radial-gradient(ellipse at 50% 45%, #2a160acc, #120804ee); color: #fff8ec; font-family: Fredoka, Nunito, sans-serif }
    #endcard.on { opacity: 1 }
    #endcard b { font-size: 96px; font-weight: 600; line-height: 1 }
    #endcard span { font-size: 44px; font-weight: 500; color: #ffd9a8 }
    #endcard i { font-style: normal; font-size: 52px; font-weight: 600; color: #fff; background: #f08a0e; border-radius: 999px; padding: 14px 40px; box-shadow: 0 6px 0 #b8640a, 0 0 50px #ff9a3a66 }\`;
  document.head.append(css);
  const cap = (html, top) => { const d = document.createElement("div"); d.className = "cap"; d.innerHTML = html; d.style.top = top + "px"; document.body.append(d); return d };
  const title = cap("a capybara<br>in a hot spring ♨️", 150);
  const sub = cap("farm points just by<br>keeping it company 🍊", 150);
  const hand = Object.assign(document.createElement("div"), { id: "hand", textContent: "🫳" });
  const end = document.createElement("div"); end.id = "endcard";
  end.innerHTML = "<b>Capybara Chill</b><span>lofi · sakura · points while you chill</span><i>play it in the post 👇</i><span>capybara.sojo.gg</span>";
  document.body.append(hand, end);
  document.body.classList.add("hidehud");

  const V = (x, y, z) => ({ x, y, z });
  const lerp = (a, b, k) => V(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
  const ease = k => k < 0 ? 0 : k > 1 ? 1 : k * k * (3 - 2 * k);
  // keyframes: [time, camera, target]
  const KEYS = [
    [0, V(5.5, 3.6, 10.5), V(0, 1.2, -3)],
    [6, V(1.1, 1.05, 3.4), V(-0.25, 0.5, 0.3)],
    [10.5, V(0.7, 1.0, 3.0), V(-0.3, 0.5, 0.3)],
    [16, V(-2.2, 2.6, 7.5), V(0, 1.0, -2.5)],
  ];
  let t0 = 0, petted = false;
  const at = t => {
    let i = 0; while (i < KEYS.length - 2 && t > KEYS[i + 1][0]) i++;
    const [a, ca, ta] = KEYS[i], [b, cb, tb] = KEYS[i + 1], k = ease((t - a) / (b - a));
    return [lerp(ca, cb, k), lerp(ta, tb, k)];
  };
  const tick = now => {
    const t = (now - t0) / 1000;
    const [c, tg] = at(Math.min(t, 16));
    cam.position.set(c.x, c.y, c.z); ctl.target.set(tg.x, tg.y, tg.z);
    title.classList.toggle("on", t > 0.6 && t < 5.2);
    document.body.classList.toggle("hidehud", t < 6 || t > 11.5);
    sub.classList.toggle("on", t > 6.4 && t < 10.8);
    // the hand comes in, pets the capybara (hearts), leaves
    const head = new w.camera.position.constructor();
    w.capy.headWorld(head); head.project(cam);
    const hx = (head.x + 1) / 2 * innerWidth - 40, hy = (1 - head.y) / 2 * innerHeight + 10;
    if (t > 7 && t < 10) { hand.style.opacity = 1; hand.style.left = (t < 7.6 ? innerWidth + 40 : hx) + "px"; hand.style.top = (t < 7.6 ? innerHeight * 0.75 : hy) + "px" }
    else if (t >= 10) { hand.style.left = innerWidth + 60 + "px"; hand.style.opacity = t > 10.8 ? 0 : 1 }
    if (t > 8.6 && !petted) { petted = true; w.capy.pet(); hand.style.transform = "rotate(-18deg) scale(.92)"; setTimeout(() => hand.style.transform = "", 300);
      setTimeout(() => { w.capy.pet(); hand.style.transform = "rotate(-18deg) scale(.92)"; setTimeout(() => hand.style.transform = "", 300) }, 600) }
    end.classList.toggle("on", t > 12.2);
    if (t < 17) requestAnimationFrame(tick);
  };
  window.__start = () => { t0 = performance.now(); requestAnimationFrame(tick) };
})()`;

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}?dev=capyfan&t=17.8`);
  await page.waitForFunction(() => window.__world && window.__createLofi, null, { timeout: 60000 });
  await sleep(4000);                                       // models, fonts, env map

  // soundtrack: the radio rendered offline to WAV, handed back as base64
  const wav = await page.evaluate(async sec => {
    const rate = 44100, off = new OfflineAudioContext(2, Math.ceil(rate * sec), rate);
    const buf = await window.__createLofi({ context: off }).renderTo(sec);
    const n = buf.length, data = new DataView(new ArrayBuffer(44 + n * 4));
    const str = (o, s) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
    str(0, "RIFF"); data.setUint32(4, 36 + n * 4, true); str(8, "WAVEfmt "); data.setUint32(16, 16, true); data.setUint16(20, 1, true);
    data.setUint16(22, 2, true); data.setUint32(24, rate, true); data.setUint32(28, rate * 4, true); data.setUint16(32, 4, true); data.setUint16(34, 16, true);
    str(36, "data"); data.setUint32(40, n * 4, true);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    for (let i = 0; i < n; i++) {
      data.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
      data.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
    }
    let bin = ""; const u8 = new Uint8Array(data.buffer);
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(bin);
  }, SECONDS);
  fs.writeFileSync(path.join(OUT, "audio.wav"), Buffer.from(wav, "base64"));

  await page.evaluate(DIRECTOR);
  await sleep(300);
  const started = Date.now();
  await page.evaluate(() => window.__start());
  await sleep(SECONDS * 1000 + 600);
  const tail = (Date.now() - started) / 1000;
  const video = await page.video().path();
  await ctx.close();
  await browser.close();
  // the recorder drops frames while the page is busy (the soundtrack render), so its clock runs short of the wall clock:
  // cut from the end, where the timing is known, not from the start
  const probe = (() => { try { execFileSync(ffmpeg, ["-i", video], { stdio: "pipe" }) } catch (e) { return String(e.stderr) } })();
  const [, hh, mm, ss] = probe.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const trim = Math.max(0, hh * 3600 + mm * 60 + +ss - tail);

  const out = path.join(OUT, "capybara.mp4");
  execFileSync(ffmpeg, ["-y", "-ss", trim.toFixed(2), "-i", video, "-i", path.join(OUT, "audio.wav"), "-t", String(SECONDS),
    "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out], { stdio: "inherit" });
  console.log("→", out, (fs.statSync(out).size / 1e6).toFixed(1), "MB");
})().catch(e => { console.error(e.message); process.exit(1) });
