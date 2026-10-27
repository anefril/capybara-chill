// Capybara on Sojo hosting. The Worker checks the player's token and hands the request to Pond — one Durable Object
// that knows who is chilling right now and, once a minute, pays each of them — within the daily pool.
// Static files come from env.ASSETS. Bundled by esbuild (build.js) into worker/dist.
import { verifySojoToken, sendSojoEvents } from "@sojogg/sdk/server";

// Everyone farms at the same fixed rate (Royal x1.25), so the first players can't run off with the pool. The pool
// (10M a day) is only a ceiling: each minute may give out at most 1/1440 of it; once the crowd's fixed rates add up to
// more (~70 people online), that minute's slice is split by weight instead. The day never gives out more than POOL
const POOL = 10_000_000, DAY_MS = 86_400_000;
const RATE = 100;                          // points a minute per player
const TICK_MS = 60_000;
const BEAT_GRACE = 75_000;                 // a session is online if it beat this recently (the client beats every 30 s)
const ROYAL_WEIGHT = 1.25;
// anti-AFK: every 8–15 minutes the capybara asks for a scratch; not petted within PET_GRACE — farming pauses until it is
const PET_MIN = 8 * 60_000, PET_MAX = 15 * 60_000, PET_GRACE = 120_000;
const BOARD_N = 50;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});
const dayOf = ms => new Date(ms).toISOString().slice(0, 10);   // the pool's day is UTC
const petDue = now => now + PET_MIN + Math.random() * (PET_MAX - PET_MIN);

// Sojo's hosting can't reach id.sojo.gg from inside the Worker (522, seen 27.10.2026 on DOOM and here): every sign-in
// check hung 20 s and failed with jwks_unavailable. Their public keys are fetched as usual first (1.5 s); if that fails,
// a copy taken from https://id.sojo.gg/jwks.json and /jwks-test.json is used. If Sojo rotates keys, refresh the copy.
const JWKS_COPY = {
  "https://id.sojo.gg/jwks.json": { keys: [{ kty: "OKP", crv: "Ed25519", x: "Uc5kPIH5lfCGb3kFnjUzTEm6nEMngFS8YE9HuHFTO1o", kid: "k1", alg: "EdDSA", use: "sig" }] },
  "https://id.sojo.gg/jwks-test.json": { keys: [{ kty: "OKP", crv: "Ed25519", x: "-4scZhaMI3I98OFvP7HZegdkV6w86BdpzX8iHod4kRA", kid: "t-1", alg: "EdDSA", use: "sig" }] },
};
async function jwksFetch(u, init) {
  try { const r = await fetch(u, { ...init, signal: AbortSignal.timeout(1500) }); if (r.ok) return r } catch {}
  if (JWKS_COPY[u]) return new Response(JSON.stringify(JWKS_COPY[u]), { headers: { "content-type": "application/json" } });
  throw new Error("jwks unreachable");
}

async function player(env, token) {
  if (typeof token !== "string" || !token) throw Object.assign(new Error("no token"), { status: 401 });
  // wrangler dev only (wrangler.toml sets LOCAL_DEV; sojo.json never does): "dev:<name>" tokens, "royal" in the name = Royal
  if (env.LOCAL_DEV === "1" && token.startsWith("dev:")) {
    const h = token.slice(4).replace(/[^\w]/g, "").slice(0, 15) || "dev";
    return { sub: "dev-" + h, h, p: "", perks: h.includes("royal") ? ["supporter"] : [] };
  }
  try { return await verifySojoToken(token, { aud: env.SOJO_GAME, allowTest: env.SOJO_ENV === "dev", fetch: jwksFetch }) }
  catch (e) { throw Object.assign(new Error("bad token: " + (e.code || e.message)), { status: 401 }) }
}

async function events(env, list) {
  if (env.LOCAL_DEV === "1") return;
  try { await sendSojoEvents(list, { serverKey: env.SOJO_SERVER_KEY }) } catch (e) { console.warn("events:", e.message) }
}

const pond = env => env.POND.get(env.POND.idFromName("pond"));
const ask = (env, body) => pond(env).fetch("https://pond/", { method: "POST", body: JSON.stringify(body) });

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === "/api/board" && req.method === "GET") {      // public: top + pool stats, no sign-in
      const board = url.searchParams.get("b") === "all" ? "all" : "today";
      return ask(env, { op: "board", board });
    }
    if (url.pathname === "/api/start" || url.pathname === "/api/beat") {
      if (req.method !== "POST") return json({ error: "method" }, 405);
      const body = await req.json().catch(() => ({}));
      let me;
      try { me = await player(env, body.token) } catch (e) { return json({ error: e.message }, e.status || 500) }
      const who = { sub: me.sub, handle: me.h || "", pfp: me.p || "", royal: (me.perks || []).includes("supporter") };
      if (url.pathname === "/api/start") {
        ctx.waitUntil(events(env, [{ ev: "capy.start", sub: me.sub }]));
        return ask(env, { op: "start", ...who });
      }
      return ask(env, { op: "beat", ...who, sess: String(body.sess || ""), pet: !!body.pet });
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);
    return env.ASSETS.fetch(req);
  },
};

// One instance for the whole game ("pond"). Points live in its SQLite; who's online lives in memory — if the object
// restarts, the next beat of each tab brings its session back.
export class Pond {
  constructor(state, env) {
    this.state = state;
    this.sql = state.storage.sql;
    this.sessions = new Map();               // sub → { sess, beat, petDue, royal, handle, pfp, rate }
    this.lastTick = Date.now();
    this.cache = {};                         // board → { at, body }
    this.sql.exec(`CREATE TABLE IF NOT EXISTS players(sub TEXT PRIMARY KEY, handle TEXT, pfp TEXT, royal INTEGER,
      total REAL NOT NULL DEFAULT 0, today REAL NOT NULL DEFAULT 0, day TEXT, minutes INTEGER NOT NULL DEFAULT 0)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS players_total ON players(total DESC)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS players_today ON players(day, today DESC)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS days(day TEXT PRIMARY KEY, emitted REAL NOT NULL DEFAULT 0)`);
    // who's online and when the last minute was paid live in SQLite too: on Sojo's hosting the object sleeps between
    // beats and wakes up empty (27.10.2026: points stopped after the first two minutes)
    this.sql.exec(`CREATE TABLE IF NOT EXISTS sessions(sub TEXT PRIMARY KEY, sess TEXT, beat INTEGER, pet_due INTEGER, royal INTEGER,
      handle TEXT, pfp TEXT, rate REAL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v REAL)`);
    for (const r of this.sql.exec(`SELECT * FROM sessions`).toArray())
      this.sessions.set(r.sub, { sess: r.sess, beat: r.beat, petDue: r.pet_due, royal: !!r.royal, handle: r.handle, pfp: r.pfp, rate: r.rate || 0 });
    const lt = this.sql.exec(`SELECT v FROM meta WHERE k = 'lastTick'`).toArray()[0];
    this.lastTick = lt ? lt.v : Date.now();
    // stored at once: the object wakes fresh for nearly every request, and a clock started anew each time never reaches
    // a minute (27.10.2026: sinceTick 0 on every beat, nothing paid)
    if (!lt) this.sql.exec(`INSERT OR REPLACE INTO meta(k, v) VALUES('lastTick', ?)`, this.lastTick);
  }

  save(sub, s) {
    this.sql.exec(`INSERT OR REPLACE INTO sessions(sub, sess, beat, pet_due, royal, handle, pfp, rate) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      sub, s.sess, s.beat, Math.round(s.petDue), s.royal ? 1 : 0, s.handle, s.pfp, s.rate || 0);
  }

  async fetch(req) {
    const a = await req.json();
    // minutes are paid out here, on the players' own requests (a beat every 30 s): the alarm on Sojo's hosting didn't fire
    // (27.10.2026 — signed-in players farmed, the board stayed empty). The alarm stays as a backup
    const now = Date.now();
    if (now - this.lastTick >= TICK_MS) this.tick(now);
    if (a.op === "board") return this.board(a.board);
    if (a.op === "start") return this.start(a);
    if (a.op === "beat") return this.beat(a);
    return json({ error: "op" }, 400);
  }

  upsert(a) {
    this.sql.exec(`INSERT INTO players(sub, handle, pfp, royal) VALUES(?, ?, ?, ?)
      ON CONFLICT(sub) DO UPDATE SET handle = excluded.handle, pfp = excluded.pfp, royal = excluded.royal`,
      a.sub, a.handle, a.pfp, a.royal ? 1 : 0);
  }

  // a new tab (or device) takes the farm over: the older one's beats come back "replaced"
  async start(a) {
    const now = Date.now();
    this.upsert(a);
    const old = this.sessions.get(a.sub);
    const s = { sess: crypto.randomUUID(), beat: now, petDue: old ? old.petDue : petDue(now), royal: a.royal, handle: a.handle, pfp: a.pfp, rate: 0 };
    this.sessions.set(a.sub, s);
    this.save(a.sub, s);
    await this.ensureAlarm();
    return json({ sess: s.sess, ...this.status(a.sub, s, now) });
  }

  async beat(a) {
    const now = Date.now();
    let s = this.sessions.get(a.sub);
    if (s && s.sess !== a.sess) return json({ replaced: true });
    if (!s) {                                  // the object restarted: take the tab's session back
      if (!a.sess) return json({ replaced: true });
      s = { sess: a.sess, beat: now, petDue: petDue(now), royal: a.royal, handle: a.handle, pfp: a.pfp, rate: 0 };
      this.sessions.set(a.sub, s);
      this.upsert(a);
    }
    // a pet only counts once the capybara asked: petting all the time doesn't push the next ask away
    if (a.pet && now >= s.petDue) s.petDue = petDue(now);
    if (s.royal !== a.royal || s.handle !== a.handle || s.pfp !== a.pfp) { Object.assign(s, { royal: a.royal, handle: a.handle, pfp: a.pfp }); this.upsert(a) }
    s.beat = now;
    this.save(a.sub, s);
    await this.ensureAlarm();
    return json(this.status(a.sub, s, now));
  }

  status(sub, s, now) {
    const day = dayOf(now);
    const row = this.sql.exec(`SELECT total, today, day FROM players WHERE sub = ?`, sub).toArray()[0] || { total: 0, today: 0, day };
    const today = row.day === day ? row.today : 0;
    const above = (q, ...v) => this.sql.exec(q, ...v).toArray()[0].n;
    return {
      total: row.total, today,
      rank: today > 0 ? 1 + above(`SELECT COUNT(*) AS n FROM players WHERE day = ? AND today > ?`, day, today) : 0,
      rank_all: row.total > 0 ? 1 + above(`SELECT COUNT(*) AS n FROM players WHERE total > ?`, row.total) : 0,
      rate: s.rate,                            // points this player got in the last minute
      est: this.estimate(s, now),              // what the next minute should bring, at today's crowd
      mult: s.royal ? ROYAL_WEIGHT : 1,
      online: this.online(now).length,
      need_pet: now >= s.petDue,
      paused: now >= s.petDue + PET_GRACE,
    };
  }

  online(now) {
    return [...this.sessions.entries()].filter(([, s]) => now - s.beat < BEAT_GRACE && now < s.petDue + PET_GRACE);
  }
  estimate(s, now) {
    if (now >= s.petDue + PET_GRACE || POOL - this.emitted(dayOf(now)) <= 0) return 0;
    const on = this.online(now);
    const W = on.reduce((w, [, o]) => w + (o.royal ? ROYAL_WEIGHT : 1), 0) + (on.some(([, o]) => o === s) ? 0 : (s.royal ? ROYAL_WEIGHT : 1));
    return Math.min(RATE, POOL / 1440 / W) * (s.royal ? ROYAL_WEIGHT : 1);
  }
  emitted(day) {
    const r = this.sql.exec(`SELECT emitted FROM days WHERE day = ?`, day).toArray()[0];
    return r ? r.emitted : 0;
  }

  async ensureAlarm() {
    if (this.alarmSet) return;
    if (!(await this.state.storage.getAlarm())) await this.state.storage.setAlarm(Date.now() + TICK_MS);
    this.alarmSet = true;
  }

  async alarm() {
    const now = Date.now();
    if (now - this.lastTick >= TICK_MS * 0.9) this.tick(now);
    if (this.sessions.size) await this.state.storage.setAlarm(now + TICK_MS);
    else this.alarmSet = false;
  }

  // each player gets RATE × weight for the time elapsed, unless that adds up to more than the minute's slice
  // (POOL × elapsed / day, never past what is left of the day) — then the slice is split by weight.
  // At most two minutes' worth at once: a long quiet spell doesn't print a burst
  tick(now) {
    const day = dayOf(now);
    const elapsed = Math.min(this.lastTick ? now - this.lastTick : TICK_MS, 2 * TICK_MS);
    this.lastTick = now;
    this.sql.exec(`INSERT OR REPLACE INTO meta(k, v) VALUES('lastTick', ?)`, now);
    for (const [sub, s] of this.sessions) if (now - s.beat > 10 * 60_000) { this.sessions.delete(sub); this.sql.exec(`DELETE FROM sessions WHERE sub = ?`, sub) }
    for (const s of this.sessions.values()) s.rate = 0;
    const on = this.online(now);
    if (on.length) {
      const slice = Math.min(POOL * elapsed / DAY_MS, POOL - this.emitted(day));
      if (slice > 0) {
        const W = on.reduce((w, [, s]) => w + (s.royal ? ROYAL_WEIGHT : 1), 0);
        const perWeight = Math.min(RATE * elapsed / TICK_MS, slice / W);
        this.state.storage.transactionSync(() => {
          for (const [sub, s] of on) {
            const got = perWeight * (s.royal ? ROYAL_WEIGHT : 1);
            s.rate = got * TICK_MS / elapsed;
            this.save(sub, s);
            this.sql.exec(`UPDATE players SET today = CASE WHEN day = ? THEN today ELSE 0 END + ?, day = ?,
              total = total + ?, minutes = minutes + 1 WHERE sub = ?`, day, got, day, got, sub);
          }
          this.sql.exec(`INSERT INTO days(day, emitted) VALUES(?, ?) ON CONFLICT(day) DO UPDATE SET emitted = emitted + excluded.emitted`, day, perWeight * W);
        });
      }
    }
    this.cache = {};
  }

  board(board) {
    const now = Date.now(), c = this.cache[board];
    if (c && now - c.at < 10_000) return json(c.body);
    const day = dayOf(now);
    const rows = board === "all"
      ? this.sql.exec(`SELECT handle, pfp, royal, total AS pts FROM players WHERE total > 0 ORDER BY total DESC LIMIT ?`, BOARD_N).toArray()
      : this.sql.exec(`SELECT handle, pfp, royal, today AS pts FROM players WHERE day = ? AND today > 0 ORDER BY today DESC LIMIT ?`, day, BOARD_N).toArray();
    const body = {
      board, top: rows.map(r => ({ handle: r.handle, pfp: r.pfp, royal: !!r.royal, pts: r.pts })),
      online: this.online(now).length, day,
    };
    this.cache[board] = { at: now, body };
    return json(body);
  }
}
