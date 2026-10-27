// Lofi radio made on the spot with WebAudio: jazzy 7th/9th chords on a soft electric piano, a round bass, a lazy
// swung beat, a few bell notes into an echo, vinyl crackle, tape wobble. Nobody's music, so nothing to license, and it
// never repeats. Each "track" is a new key, progression, tempo and beat; ~2.5 minutes, then the next one.
const NAMES = ["yuzu bath", "warm water", "onsen nights", "sleepy river", "petal drift", "matcha rain", "slow afternoon",
  "capy dreams", "steam & stars", "moss pillow", "lantern glow", "sunday soak", "duckling waltz", "foggy pines", "after the rain"];
const CHORDS = { maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], dom7: [0, 4, 7, 10], maj9: [0, 4, 7, 11, 14], m9: [0, 3, 7, 10, 14], dom9: [0, 4, 7, 10, 14] };
const PROGS = [
  [[2, "m9"], [7, "dom9"], [0, "maj9"], [9, "m7"]],
  [[0, "maj7"], [9, "m9"], [2, "m7"], [7, "dom9"]],
  [[5, "maj9"], [4, "m7"], [2, "m9"], [0, "maj7"]],
  [[9, "m9"], [5, "maj7"], [0, "maj9"], [7, "dom7"]],
  [[0, "maj9"], [5, "maj9"], [4, "m7"], [9, "m9"]],
  [[9, "m9"], [2, "m9"], [7, "dom9"], [0, "maj7"]],
  [[5, "maj7"], [7, "dom9"], [4, "m7"], [9, "m9"]],
];
// 16 steps: 1 = hit, values are velocity
const BEATS = [
  { k: [1, 0, 0, 0, 0, 0, 0, 0.6, 0, 0, 1, 0, 0, 0, 0, 0], s: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.3] },
  { k: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0.7, 1, 0, 0, 0, 0, 0], s: [0, 0, 0, 0, 1, 0, 0, 0.25, 0, 0, 0, 0, 1, 0, 0, 0] },
  { k: [1, 0, 0, 0.5, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0.5, 0], s: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0.3, 1, 0, 0, 0] },
];
const mtof = m => 440 * 2 ** ((m - 69) / 12);
const pick = a => a[(Math.random() * a.length) | 0];

export function createLofi(opts = {}) {
  let ctx = null, out, epBus, bassBus, drumBus, bellBus, delay, noiseBuf, vinyl, playing = false, timer = null;
  let gate = null, track = null, nextBarAt = 0, bar = 0, onTrack = null, volume = 0.7;

  function setup() {
    ctx = opts.context || new (window.AudioContext || window.webkitAudioContext)();   // an OfflineAudioContext renders a soundtrack
    out = ctx.createGain(); out.gain.value = 0;
    // tape wobble: a slowly modulated short delay bends the pitch of everything a little
    const wow = ctx.createDelay(0.05); wow.delayTime.value = 0.012;
    const wowLfo = ctx.createOscillator(), wowAmt = ctx.createGain();
    wowLfo.frequency.value = 0.35; wowAmt.gain.value = 0.0018; wowLfo.connect(wowAmt).connect(wow.delayTime); wowLfo.start();
    const warm = ctx.createBiquadFilter(); warm.type = "lowpass"; warm.frequency.value = 7000;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
    const mix = ctx.createGain();
    mix.connect(wow).connect(warm).connect(comp).connect(out).connect(ctx.destination);

    epBus = ctx.createGain(); epBus.gain.value = 0.32;
    const epLp = ctx.createBiquadFilter(); epLp.type = "lowpass"; epLp.frequency.value = 2200;
    const trem = ctx.createGain(), tremLfo = ctx.createOscillator(), tremAmt = ctx.createGain();
    tremLfo.frequency.value = 4.2; tremAmt.gain.value = 0.12; tremLfo.connect(tremAmt).connect(trem.gain); tremLfo.start();
    epBus.connect(epLp).connect(trem).connect(mix);

    bassBus = ctx.createGain(); bassBus.gain.value = 0.42;
    const bLp = ctx.createBiquadFilter(); bLp.type = "lowpass"; bLp.frequency.value = 420;
    bassBus.connect(bLp).connect(mix);

    drumBus = ctx.createGain(); drumBus.gain.value = 0.55;
    const dLp = ctx.createBiquadFilter(); dLp.type = "lowpass"; dLp.frequency.value = 4200;
    drumBus.connect(dLp).connect(mix);

    bellBus = ctx.createGain(); bellBus.gain.value = 0.11;
    delay = ctx.createDelay(2); const fb = ctx.createGain(); fb.gain.value = 0.38;
    const dl = ctx.createBiquadFilter(); dl.type = "lowpass"; dl.frequency.value = 2500;
    bellBus.connect(mix); bellBus.connect(delay); delay.connect(dl).connect(fb).connect(delay); dl.connect(mix);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // vinyl: soft hiss + random pops, looped
    const vb = ctx.createBuffer(1, ctx.sampleRate * 5, ctx.sampleRate), vd = vb.getChannelData(0);
    let lp = 0;
    for (let i = 0; i < vd.length; i++) {
      lp = lp * 0.97 + (Math.random() * 2 - 1) * 0.03;
      vd[i] = lp * 0.5 + (Math.random() < 0.00035 ? (Math.random() * 2 - 1) * 0.9 : 0);
    }
    vinyl = ctx.createBufferSource(); vinyl.buffer = vb; vinyl.loop = true;
    const vg = ctx.createGain(); vg.gain.value = 0.18;
    vinyl.connect(vg).connect(mix); vinyl.start();
  }

  // each track plays through its own gates into the shared buses, so "next" can silence what's already scheduled
  function newGate() {
    const old = gate;
    if (old) {
      for (const g of Object.values(old)) g.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      setTimeout(() => { for (const g of Object.values(old)) g.disconnect() }, 3000);
    }
    gate = {};
    for (const [k, bus] of Object.entries({ ep: epBus, bass: bassBus, drum: drumBus, bell: bellBus })) {
      gate[k] = ctx.createGain(); gate[k].connect(bus);
    }
  }

  function newTrack() {
    const key = (Math.random() * 12) | 0;
    track = {
      name: pick(NAMES), no: 100 + ((Math.random() * 900) | 0), key, prog: pick(PROGS), beat: pick(BEATS),
      bpm: 70 + ((Math.random() * 14) | 0), swing: 0.12 + Math.random() * 0.08, bars: 40 + ((Math.random() * 8) | 0) * 2,
      melody: Math.random() < 0.8,
    };
    bar = 0;
    delay.delayTime.value = (60 / track.bpm) * 0.75;      // dotted eighth
    if (onTrack) onTrack(trackTitle());
  }
  const trackTitle = () => track ? `${track.name} · #${track.no}` : "";

  // --- voices ---
  function ep(m, t, dur, vel) {
    const f = mtof(m), g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.012);
    g.gain.exponentialRampToValueAtTime(vel * 0.35, t + 0.9);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.25);
    g.connect(gate.ep);
    const parts = [[f, "sine", 1], [f * 2.002, "sine", 0.22], [f, "triangle", 0.18]];
    for (const [fr, type, a] of parts) {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = type; o.frequency.value = fr; og.gain.value = a;
      o.connect(og).connect(g); o.start(t); o.stop(t + dur + 1.5);
    }
  }
  function bass(m, t, dur) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "triangle"; o.frequency.value = mtof(m);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9, t + 0.02);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.08);
    o.connect(g).connect(gate.bass); o.start(t); o.stop(t + dur + 0.6);
  }
  function bell(m, t) {
    for (const [mul, a] of [[1, 1], [3.01, 0.15]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = mtof(m) * mul;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(a, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(g).connect(gate.bell); o.start(t); o.stop(t + 1.7);
    }
  }
  function kick(t, v) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(g).connect(gate.drum); o.start(t); o.stop(t + 0.45);
  }
  function noise(t, v, type, freq, q, len) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; s.playbackRate.value = 0.8 + Math.random() * 0.4;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(f).connect(g).connect(gate.drum); s.start(t, Math.random() * 0.5); s.stop(t + len + 0.02);
  }
  const snare = (t, v) => { noise(t, v * 0.55, "bandpass", 1900, 0.7, 0.22); noise(t, v * 0.3, "lowpass", 400, 1, 0.09) };
  const hat = (t, v) => noise(t, v * 0.12, "highpass", 7500, 0.5, 0.045);

  // one bar: chord on 1 (and sometimes a push on the "and" of 3), bass, beat, a few melody notes
  function scheduleBar(t0) {
    const tr = track, beat = 60 / tr.bpm, step = beat / 4;
    const [deg, type] = tr.prog[bar % tr.prog.length];
    let root = 48 + ((tr.key + deg) % 12);
    if (root > 53) root -= 12;
    const notes = CHORDS[type].map(i => root + 12 + i).map(n => n > 76 ? n - 12 : n);
    const strum = 0.018;
    notes.forEach((n, i) => ep(n, t0 + i * strum + Math.random() * 0.01, beat * 2.6, 0.22 + Math.random() * 0.05));
    if (Math.random() < 0.45) notes.slice(1).forEach((n, i) => ep(n, t0 + beat * 2.5 + i * strum, beat * 1.2, 0.14));
    bass(root - 12, t0, beat * 1.6);
    bass(root - 12 + (Math.random() < 0.5 ? 7 : 0), t0 + beat * 2.5, beat * 0.9);
    const intro = bar < 2;                                   // the first two bars without drums
    for (let i = 0; i < 16; i++) {
      const t = t0 + i * step + (i % 2 ? tr.swing * step : 0);
      if (intro) continue;
      if (tr.beat.k[i]) kick(t, tr.beat.k[i] * 0.9);
      if (tr.beat.s[i]) snare(t, tr.beat.s[i]);
      if (i % 2 === 0 || Math.random() < 0.18) hat(t, i % 4 === 0 ? 1 : 0.6 + Math.random() * 0.3);
    }
    if (tr.melody && bar % 2 === 1 && !intro) {
      const scale = [0, 2, 4, 7, 9].map(i => 72 + ((tr.key + i) % 12));
      let t = t0 + beat * (Math.random() < 0.5 ? 0.5 : 1);
      for (let n = 0, c = 2 + ((Math.random() * 3) | 0); n < c && t < t0 + beat * 4; n++) {
        bell(pick(scale), t);
        t += step * pick([2, 3, 4, 6]);
      }
    }
    bar++;
    return t0 + beat * 4;
  }

  // a lookahead scheduler; long lookahead so a background tab (timers ≥1 s) still plays without gaps
  function tick() {
    const ahead = ctx.currentTime + 1.6;
    while (nextBarAt < ahead) {
      if (bar >= track.bars) newTrack();
      nextBarAt = scheduleBar(nextBarAt);
    }
  }

  return {
    // offline (opts.context is an OfflineAudioContext): schedule the first `seconds`, fading out at the end, then render
    renderTo(seconds) {
      setup(); newGate(); newTrack();
      out.gain.value = volume;
      out.gain.setTargetAtTime(0, seconds - 1.6, 0.45);
      nextBarAt = 0.05;
      while (nextBarAt < seconds) { if (bar >= track.bars) newTrack(); nextBarAt = scheduleBar(nextBarAt) }
      return ctx.startRendering();
    },
    get playing() { return playing },
    get title() { return trackTitle() },
    set onTrack(fn) { onTrack = fn },
    // without a user gesture the browser may keep the context suspended: then sound starts on unlock()
    get blocked() { return !!ctx && ctx.state !== "running" },
    unlock() { if (ctx && playing) ctx.resume().catch(() => {}) },
    play() {
      if (!ctx) { setup(); newGate(); newTrack(); nextBarAt = ctx.currentTime + 0.15 }
      ctx.resume().catch(() => {});                       // not awaited: it stays pending until a gesture
      if (nextBarAt < ctx.currentTime) nextBarAt = ctx.currentTime + 0.1;
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setTargetAtTime(volume, ctx.currentTime, 0.4);
      playing = true;
      clearInterval(timer); timer = setInterval(tick, 200); tick();
    },
    pause() {
      if (!ctx || !playing) return;
      playing = false;
      out.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      clearInterval(timer);
      setTimeout(() => { if (!playing) ctx.suspend() }, 600);
    },
    // next track: what's scheduled of the old one fades out, the new one starts at once
    next() {
      if (!ctx) return;
      newGate(); newTrack();
      nextBarAt = ctx.currentTime + 0.4;
    },
    setVolume(v) { volume = v; if (ctx && playing) out.gain.setTargetAtTime(v, ctx.currentTime, 0.1) },
  };
}
