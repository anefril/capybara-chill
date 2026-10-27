// The page: the 3D world, the lofi radio, Sojo sign-in, farming (start → beat every 30 s while the tab is visible),
// the points counter, the scratch request, the leaderboard.
import { init } from "@sojogg/sdk/client";
import { createWorld } from "./scene.js";
import { createLofi } from "./lofi.js";

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = n => Math.floor(n).toLocaleString("en-US");
const short = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + "M" : n >= 1e4 ? (n / 1e3).toFixed(1) + "k" : fmt(n);
const X_HANDLE = "NukeKevDev";
const BEAT_MS = 30_000;

// --- Sojo; on localhost ?dev=<name> stands in for it (the local Worker takes "dev:<name>" tokens, "royal" in the name = Royal)
const devName = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).get("dev");
function fakeSojo(name) {
  const me = { sub: "dev-" + name, handle: name, name, pfp: "", perks: name.includes("royal") ? ["supporter"] : [] };
  return {
    me: async () => me, token: async () => "dev:" + name, onChange: fn => { setTimeout(() => fn(me)); return () => {} },
    signIn: async () => me, supporter: async () => ({ status: me.perks.length ? "yes" : "no" }), subscribe: async () => null,
    ui() { return this }, track() {}, share() {}, x: { post() {}, follow() {} },
  };
}
let sojo = null;
try { sojo = devName ? fakeSojo(devName) : init({ game: "capybara", ui: { corner: "top-left", inset: 8 } }) } catch (e) { console.warn("sojo:", e.message) }
const track = (ev, props) => { try { sojo && sojo.track(ev, props) } catch {} };

// --- world ---
const world = createWorld($("cv"));
if (devName) Object.assign(window, { __world: world, __createLofi: createLofi });   // local look checks and the promo video (shot.js, video/)
const bubble = $("bubble");
world.onFrame = p => {           // the scratch bubble follows the capybara's head on screen
  bubble.style.left = ((p.x + 1) / 2 * 100) + "%";
  bubble.style.top = ((1 - p.y) / 2 * 100) + "%";
};

// --- radio ---
const radio = createLofi();
const bPlay = $("r-play"), rTitle = $("r-title");
radio.onTrack = t => { rTitle.textContent = t };
const drawRadio = () => { $("radio").classList.toggle("on", radio.playing); bPlay.setAttribute("aria-label", radio.playing ? "Pause radio" : "Play radio") };
bPlay.onclick = () => { radio.playing ? radio.pause() : radio.play(); drawRadio() };
$("r-next").onclick = () => { if (!radio.playing) radio.play(); else radio.next(); drawRadio() };
$("r-fold").onclick = () => { const r = $("radio"); r.classList.toggle("fold"); $("r-fold").setAttribute("aria-label", r.classList.contains("fold") ? "Show the player" : "Hide the player") };
$("r-vol").oninput = e => { radio.setVolume(+e.target.value); e.target.style.setProperty("--v", e.target.value * 100 + "%") };
// the radio is on from the start. A browser that blocks sound until the viewer does something gets it on their first
// tap, click or key anywhere (the hint shows only then); whoever doesn't want it presses pause
const tap = $("tap");
radio.play();
drawRadio();
tap.hidden = true;
setTimeout(() => { tap.hidden = !radio.blocked }, 400);
const GESTURES = ["pointerdown", "keydown", "touchstart"];
function unlock() {
  radio.unlock();
  tap.hidden = true;
  if (!radio.blocked) for (const e of GESTURES) removeEventListener(e, unlock, true);
}
for (const e of GESTURES) addEventListener(e, unlock, true);

// --- farming ---
const ptsEl = $("pts"), subEl = $("sub"), farmEl = $("farm"), bIn = $("signin"), bRoyal = $("royal"), toast = $("toast");
let me = null, royal = false, sess = null, st = null, stAt = 0, shown = 0, busy = false;

async function api(path, body = {}) {
  const token = await sojo.token();
  if (!token) throw Object.assign(new Error("signed out"), { soft: true });
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  return j;
}

function apply(r) {
  st = r; stAt = performance.now();
  royal = r.mult > 1;
  world.capy.setWantPet(r.need_pet);
  drawFarm();
}

async function start() {
  if (!me || busy) return;
  busy = true;
  try { const r = await api("/api/start"); sess = r.sess; toast.hidden = true; apply(r); track("capy.farm") }
  catch (e) { if (!e.soft) console.warn("start:", e.message) }
  busy = false;
}

async function beat(pet = false) {
  if (!sess || busy || document.visibilityState !== "visible") return;
  busy = true;
  try {
    const r = await api("/api/beat", { sess, pet });
    if (r.replaced) { sess = null; st = null; world.capy.setWantPet(false); toast.hidden = false; drawFarm() }
    else apply(r);
  } catch (e) { if (!e.soft) console.warn("beat:", e.message) }
  busy = false;
}
setInterval(() => beat(), BEAT_MS);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") beat() });
$("toast-go").onclick = start;

world.onPet = () => {
  track("capy.pet");
  if (st && st.need_pet) beat(true);
};

// the counter runs between beats at the expected rate; it never goes back
const farming = () => st && !st.paused;
function drawFarm() {
  farmEl.classList.toggle("in", !!me);
  farmEl.classList.toggle("live", !!farming());
  farmEl.classList.toggle("paused", !!(st && st.paused));
  bIn.hidden = !!me;
  bRoyal.hidden = !me || royal;
  $("mult").hidden = !royal;
  bubble.hidden = !(st && st.need_pet);
  bubble.textContent = st && st.paused ? "farming paused — scratch me!" : "scratch me? 🫳";
  bubble.classList.toggle("paused", !!(st && st.paused));
}
function tickCounter() {
  if (st) {
    const extra = farming() ? (st.est || st.rate) * Math.min(BEAT_MS * 1.5, performance.now() - stAt) / 60000 : 0;
    shown = Math.max(shown, st.total + extra);
    ptsEl.textContent = fmt(shown);
    const mineEl = !lb.hidden && lbList.querySelector("li.me i");
    if (mineEl) mineEl.textContent = short(liveMine());
    subEl.textContent = farming() ? "" : "paused · scratch Capy";        // farming: just the number
  } else if (me) {
    ptsEl.textContent = "—";
    subEl.textContent = sess === null && !toast.hidden ? "farming in another tab" : "connecting…";
  } else {
    ptsEl.textContent = "0";
    subEl.textContent = "sign in to farm points";
  }
  requestAnimationFrame(tickCounter);
}
requestAnimationFrame(tickCounter);

if (sojo) {
  sojo.onChange(next => {
    const was = me && me.sub;
    me = next;
    royal = !!(me && me.perks && me.perks.includes("supporter"));
    if (!me) { sess = null; st = null; shown = 0 }
    drawFarm();
    if (me && me.sub !== was) { shown = 0; start() }
  });
}
bIn.onclick = () => sojo && sojo.signIn();
bRoyal.onclick = async () => {
  if (!sojo) return;
  const s = await sojo.subscribe();
  if (s) { royal = true; drawFarm(); start() }       // a fresh token carries the perk: the next minute counts x1.25
};
drawFarm();

// --- leaderboard ---
const lb = $("lb"), lbList = $("lb-list"), lbFoot = $("lb-foot"), lbMe = $("lb-me");
let board = "today";
const liveMine = () => !st ? 0 : board === "all" ? shown : st.today + (shown - st.total);
async function loadBoard() {
  lbList.innerHTML = '<li class="dim">…</li>';
  try {
    const j = await (await fetch("/api/board?b=" + board)).json();
    // the server pays out once a minute; the player's own row shows the same live number as the counter, and is there
    // from the first second (not only after the first payout)
    if (me && st && !j.top.some(r => r.handle === me.handle)) j.top.push({ handle: me.handle, pfp: me.pfp || "", royal, pts: 0 });
    lbList.innerHTML = j.top.length ? j.top.map((r, i) => {
      const h = r.handle || "anon", av = r.pfp ? `<img src="${esc(r.pfp)}" alt="">` : `<span class="av">${esc(h[0].toUpperCase())}</span>`;
      const cls = [r.royal && "royal", i < 3 && "p" + (i + 1), me && r.handle === me.handle && "me"].filter(Boolean).join(" ");
      const pts = me && r.handle === me.handle ? Math.max(r.pts, liveMine()) : r.pts;
      return `<li class="${cls}"><b>${i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</b>${av}<span class="h">${r.royal ? "👑 " : ""}@${esc(h)}</span><i>${short(pts)}</i></li>`;
    }).join("") : '<li class="dim">nobody yet — be the first capy friend</li>';
    lbFoot.textContent = `${j.online} chilling now`;
    const rank = st && (board === "all" ? st.rank_all : st.rank);
    lbMe.textContent = rank ? `you're #${rank}` : "";
  } catch { lbList.innerHTML = '<li class="dim">couldn\'t load</li>' }
}
for (const b of document.querySelectorAll("#lb-tabs button")) b.onclick = () => {
  board = b.dataset.b;
  for (const o of document.querySelectorAll("#lb-tabs button")) o.classList.toggle("on", o === b);
  loadBoard();
};
const shade = $("lb-shade");
$("lb-open").onclick = () => { lb.hidden = shade.hidden = false; loadBoard(); track("capy.board") };
$("lb-x").onclick = shade.onclick = () => { lb.hidden = shade.hidden = true };
$("share").onclick = () => sojo && sojo.share({ text: "I'm chilling with a capybara in a hot spring right inside an X post 🍊♨️", url: location.origin });
$("follow").onclick = () => sojo && sojo.x.follow(X_HANDLE);
$("help").onclick = () => { $("how").hidden = !$("how").hidden };

// time of day: the player's clock, or a fixed morning / day / evening / night, remembered on this device (?t= wins)
const SKIES = [["your clock", "🕰️", null], ["morning", "🌅", 6.4], ["day", "☀️", 13], ["evening", "🌇", 17.8], ["night", "🌙", 22.5]];
const bSky = $("sky"), urlHour = parseFloat(new URLSearchParams(location.search).get("t"));
let sky = 0;
if (!isNaN(urlHour)) SKIES[0][2] = urlHour;                     // ?t= stands in for "your clock", so cycling comes back to it
else try { sky = Math.max(0, SKIES.findIndex(s => s[0] === localStorage.getItem("capy.sky"))) } catch {}
const showSky = () => {
  const [name, icon] = SKIES[sky];
  bSky.querySelector("b").textContent = icon;
  bSky.setAttribute("aria-label", "Time of day: " + name);      // no title: the browser's tooltip looked out of place
};
if (sky) world.setHour(SKIES[sky][2]);
showSky();
bSky.onclick = () => {
  sky = (sky + 1) % SKIES.length;
  world.setHour(SKIES[sky][2]);
  showSky();
  try { localStorage.setItem("capy.sky", SKIES[sky][0]) } catch {}
  track("capy.sky", { sky: SKIES[sky][0] });
};

// the × (top centre) hides everything but the capybara (and its ask for a scratch); the faint eye in its place brings it back
const bZen = $("zen");
bZen.onclick = () => {
  const zen = document.body.classList.toggle("zen");
  bZen.setAttribute("aria-label", zen ? "Show the interface" : "Hide the interface");
  try { sojo && sojo.ui(!zen) } catch {}
};

// fullscreen: X's player frame allows it on desktop; where the browser can't (iPhone Safari) the button stays hidden
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
const root = document.documentElement, bFull = $("full");
if (document.fullscreenEnabled || document.webkitFullscreenEnabled) {
  bFull.hidden = false;
  document.body.classList.add("has-fs");
  bFull.onclick = () => {
    if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
  };
  for (const ev of ["fullscreenchange", "webkitfullscreenchange"]) document.addEventListener(ev, () => document.body.classList.toggle("fs", !!fsEl()));
}
