"use client";
// ZECKED sound effects: a sweet "candy" pack, synthesized with Web Audio (no files, instant, tiny).
// Bubble pops that climb a happy scale when you tap in a row (like a combo), marimba notes, sparkly
// bells and a jelly "boing", all through a soft room reverb. Light haptics where supported.
// Silent until the app mounts <Sfx /> (the website never plays sounds) and until the first gesture.

type Sound =
  | "tap" // tabs, chips, small toggles
  | "pop" // buttons
  | "select" // picking an option
  | "type" // a key/digit going in
  | "success" // something saved / sealed / funded
  | "lock" // a call locked in, a stash sealed
  | "wrong" // a wrong guess
  | "error" // something failed
  | "coin" // ZEC arrived
  | "notify" // a toast or live event
  | "whoosh" // sheets, big transitions
  | "confetti" // party popper + bubbles
  | "win"; // you ZECKED it

/** Every sound, in the order the /sounds board lists them. */
export const SOUNDS: Sound[] = ["tap", "pop", "select", "type", "success", "lock", "wrong", "error", "coin", "notify", "whoosh", "confetti", "win"];

const MUTE_KEY = "zk:sfx-muted";
let enabled = false;
let muted = false;
let ctx: AudioContext | null = null;
let dry: GainNode | null = null;
let wet: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
const last: Partial<Record<Sound, number>> = {};

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Called once by <Sfx />: turns sounds on for this surface. */
export function enableSfx() {
  enabled = true;
  muted = readMuted();
}

export function isMuted() {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {}
  if (!m) sfx("success");
}

/** A soft room: decaying stereo noise as the reverb's impulse response. */
function roomImpulse(c: AudioContext, seconds = 1.3) {
  const len = Math.floor(c.sampleRate * seconds);
  const ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  return ir;
}

/** Browsers only allow audio after a gesture: <Sfx /> calls this from pointerdown/keydown/touchend/click.
 *  Until the first gesture, sfx() stays silent (no AudioContext is created). */
export function unlockAudio() {
  if (!enabled || typeof window === "undefined") return;
  try {
    if (!ctx) {
      // iOS: mix with the user's music and respect the silent switch, like any polite app UI.
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = "ambient";
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC({ latencyHint: "interactive" });
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 3;
      const master = ctx.createGain();
      master.gain.value = 0.7;
      master.connect(comp).connect(ctx.destination);
      // Voices feed a dry bus and a reverb send; the mix is mostly dry with a sweet tail.
      dry = ctx.createGain();
      dry.gain.value = 0.85;
      dry.connect(master);
      const verb = ctx.createConvolver();
      verb.buffer = roomImpulse(ctx);
      const tone = ctx.createBiquadFilter();
      tone.type = "lowpass";
      tone.frequency.value = 6500;
      wet = ctx.createGain();
      wet.gain.value = 0.26;
      wet.connect(verb).connect(tone).connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const n = noiseBuf.getChannelData(0);
      for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    ctx = null;
  }
}

function vibrate(pattern: number | number[]) {
  try {
    if (!muted && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(pattern);
  } catch {}
}

/* ---------- voices ---------- */

/** Route a voice to the dry bus and the reverb (send 0..1+). */
function out(node: AudioNode, send = 1) {
  node.connect(dry!);
  if (send > 0) {
    const s = ctx!.createGain();
    s.gain.value = send;
    node.connect(s).connect(wet!);
  }
}

function env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function osc(type: OscillatorType, f: number, t: number, stop: number) {
  const o = ctx!.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  o.start(t);
  o.stop(stop + 0.05);
  return o;
}

/** "Bloop": a sine that swoops up fast, the classic candy bubble pop. */
function bubble(t: number, f: number, vol = 0.3, len = 0.11, send = 0.8) {
  const o = osc("sine", f, t, t + len);
  o.frequency.exponentialRampToValueAtTime(f * 2.3, t + len * 0.42);
  const g = ctx!.createGain();
  env(g, t, vol, 0.004, len);
  o.connect(g);
  out(g, send);
}

/** Marimba-ish mallet: warm fundamental, a bright strike partial, and a soft octave. */
function mallet(t: number, f: number, vol = 0.25, decay = 0.38, send = 1) {
  const g = ctx!.createGain();
  env(g, t, vol, 0.003, decay);
  osc("sine", f, t, t + decay).connect(g);
  const g2 = ctx!.createGain();
  env(g2, t, vol * 0.35, 0.002, decay * 0.22);
  osc("sine", f * 3.98, t, t + decay * 0.3).connect(g2);
  const g3 = ctx!.createGain();
  env(g3, t, vol * 0.12, 0.001, decay * 0.5);
  osc("triangle", f * 2, t, t + decay * 0.6).connect(g3);
  out(g, send);
  out(g2, send);
  out(g3, send);
}

/** Glassy little bell, for sparkles. */
function bell(t: number, f: number, vol = 0.07, decay = 0.5) {
  const g = ctx!.createGain();
  env(g, t, vol, 0.002, decay);
  osc("sine", f, t, t + decay).connect(g);
  const g2 = ctx!.createGain();
  env(g2, t, vol * 0.4, 0.002, decay * 0.4);
  osc("sine", f * 2.76, t, t + decay * 0.5).connect(g2);
  out(g, 1.2);
  out(g2, 1.2);
}

function sparkle(t: number, count = 4, spread = 0.07) {
  const notes = [2093, 2349.3, 2637, 3136, 3520, 4186];
  for (let i = 0; i < count; i++) bell(t + i * spread * (0.7 + Math.random() * 0.6), notes[Math.floor(Math.random() * notes.length)], 0.05 + Math.random() * 0.03);
}

function hiss(t: number, len: number, from: number, to: number, vol = 0.12) {
  const src = ctx!.createBufferSource();
  src.buffer = noiseBuf;
  const fl = ctx!.createBiquadFilter();
  fl.type = "bandpass";
  fl.Q.value = 0.9;
  fl.frequency.setValueAtTime(from, t);
  fl.frequency.exponentialRampToValueAtTime(to, t + len);
  const g = ctx!.createGain();
  env(g, t, vol, len * 0.3, len * 0.7);
  src.connect(fl).connect(g);
  out(g, 0.6);
  src.start(t, Math.random() * 0.4);
  src.stop(t + len + 0.05);
}

/** Cartoon jelly "boing": a wobbling pitch drop. */
function boing(t: number) {
  const o = osc("sine", 420, t, t + 0.42);
  o.frequency.exponentialRampToValueAtTime(170, t + 0.36);
  const lfo = osc("sine", 16, t, t + 0.42);
  const depth = ctx!.createGain();
  depth.gain.value = 28;
  lfo.connect(depth).connect(o.frequency);
  const g = ctx!.createGain();
  env(g, t, 0.36, 0.006, 0.4);
  o.connect(g);
  out(g, 0.5);
  mallet(t + 0.02, 130.8, 0.26, 0.16, 0.2);
}

/* ---------- scale & combo ---------- */

// C major pentatonic, bright register: taps in a row climb it like a combo.
const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760];
let combo = 0;
let lastTapAt = 0;
function comboNote() {
  const now = performance.now();
  combo = now - lastTapAt < 900 ? Math.min(combo + 1, PENTA.length - 1) : 0;
  lastTapAt = now;
  return PENTA[combo];
}
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

const RECIPES: Record<Sound, (t: number) => void> = {
  tap: (t) => bubble(t, comboNote(), 0.42, 0.085, 0.5),
  pop: (t) => {
    const f = comboNote();
    bubble(t, f * 0.75, 0.55, 0.12);
    mallet(t + 0.01, f * 1.5, 0.17, 0.22, 0.6);
  },
  select: (t) => {
    mallet(t, 1318.51, 0.22, 0.25);
    mallet(t + 0.065, 1760, 0.22, 0.3);
  },
  type: (t) => bubble(t, pick(PENTA.slice(4)) * 1.5, 0.22, 0.05, 0.3),
  success: (t) => {
    [1046.5, 1318.51, 1567.98, 2093].forEach((f, i) => mallet(t + i * 0.075, f, 0.2, 0.45));
    sparkle(t + 0.28, 4);
  },
  lock: (t) => {
    mallet(t, 196, 0.34, 0.2, 0.3); // wooden clack
    bubble(t, 330, 0.18, 0.09, 0.3);
    mallet(t + 0.09, 1567.98, 0.16, 0.5);
    sparkle(t + 0.16, 2);
  },
  wrong: (t) => boing(t),
  error: (t) => {
    mallet(t, 659.25, 0.18, 0.28);
    mallet(t + 0.12, 523.25, 0.18, 0.4);
  },
  coin: (t) => {
    mallet(t, 1975.5, 0.17, 0.18);
    mallet(t + 0.08, 2637, 0.2, 0.6);
    sparkle(t + 0.12, 3, 0.05);
  },
  notify: (t) => {
    bell(t, 1760, 0.12, 0.7);
    bell(t + 0.11, 2637, 0.1, 0.9);
  },
  whoosh: (t) => {
    hiss(t, 0.32, 500, 4200, 0.1);
    sparkle(t + 0.2, 2);
  },
  confetti: (t) => {
    // the popper, then a fizz of bubbles and glitter
    bubble(t, 220, 0.36, 0.14, 0.6);
    hiss(t, 0.16, 1800, 7000, 0.14);
    for (let i = 0; i < 12; i++) bubble(t + 0.05 + Math.random() * 0.55, pick(PENTA) * (Math.random() < 0.5 ? 1 : 2), 0.06 + Math.random() * 0.07, 0.07, 0.7);
    sparkle(t + 0.2, 6, 0.08);
  },
  win: (t) => {
    // a quick climb up the scale, a big sparkly chord, glitter
    const run = [523.25, 659.25, 783.99, 880, 1046.5, 1318.51, 1567.98, 1760, 2093];
    run.forEach((f, i) => mallet(t + i * 0.05, f, 0.15, 0.3));
    const top = t + run.length * 0.05 + 0.04;
    [1046.5, 1318.51, 1567.98, 2093].forEach((f) => mallet(top, f, 0.16, 1.1));
    bubble(top, 392, 0.2, 0.16);
    sparkle(top + 0.05, 9, 0.07);
    RECIPES.confetti(top + 0.1);
  },
};

const HAPTIC: Partial<Record<Sound, number | number[]>> = {
  pop: 8,
  select: 6,
  lock: [14, 30, 8],
  wrong: [30, 40, 30],
  error: [40],
  success: [10, 40, 10],
  coin: [8, 30, 8],
  win: [20, 50, 20, 50, 40],
  confetti: [12, 30, 12],
};

/** Minimum gap per sound so rapid taps don't stack into noise. */
const GAP: Partial<Record<Sound, number>> = { tap: 35, pop: 45, type: 25, notify: 300, confetti: 600, win: 1200, coin: 250 };

export function sfx(name: Sound) {
  if (!enabled || muted || typeof window === "undefined") return;
  const now = performance.now();
  if (now - (last[name] ?? -1e9) < (GAP[name] ?? 60)) return;
  last[name] = now;
  const c = ctx;
  if (!c || !dry || !wet) return; // no gesture yet
  const h = HAPTIC[name];
  if (h) vibrate(h);
  const play = () => {
    try {
      RECIPES[name](c.currentTime + 0.005);
    } catch {}
  };
  if (c.state === "running") play();
  // The very first gesture unlocks audio asynchronously: play as soon as it is running.
  else void c.resume().then(() => c.state === "running" && play(), () => {});
}

export type { Sound };
