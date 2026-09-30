"use client";
// ZECKED sound effects: tiny synthesized sounds (Web Audio, no files), plus light haptics where the
// device supports them. Everything is a no-op until the app mounts <Sfx /> (the website stays silent),
// and until the first user gesture (browsers keep audio locked before that).

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
  | "confetti" // party popper + crackle
  | "win"; // you ZECKED it

const MUTE_KEY = "zk:sfx-muted";
let enabled = false;
let muted = false;
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
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
  if (!m) sfx("pop");
}

/** Browsers only allow audio after a gesture: call this from the first pointerdown/keydown. */
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
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(comp).connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
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

/* ---------- synth building blocks ---------- */

function tone(
  t: number,
  { f0, f1 = f0, dur, type = "sine", vol = 0.5, attack = 0.004 }: { f0: number; f1?: number; dur: number; type?: OscillatorType; vol?: number; attack?: number },
) {
  const c = ctx!;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(t: number, { dur, vol = 0.3, freq = 2000, q = 1, type = "bandpass", f1 }: { dur: number; vol?: number; freq?: number; q?: number; type?: BiquadFilterType; f1?: number }) {
  const c = ctx!;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const fl = c.createBiquadFilter();
  fl.type = type;
  fl.frequency.setValueAtTime(freq, t);
  if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
  fl.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(fl).connect(g).connect(master!);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

const jitter = (x: number, amt = 0.04) => x * (1 + (Math.random() * 2 - 1) * amt);

const RECIPES: Record<Sound, (t: number) => void> = {
  tap: (t) => {
    tone(t, { f0: jitter(1250), f1: 700, dur: 0.045, vol: 0.18 });
  },
  pop: (t) => {
    tone(t, { f0: jitter(820), f1: 260, dur: 0.09, vol: 0.42 });
    noise(t, { dur: 0.018, vol: 0.12, freq: 3200, q: 0.8 });
  },
  select: (t) => {
    tone(t, { f0: jitter(660), dur: 0.06, type: "triangle", vol: 0.28 });
    tone(t + 0.055, { f0: jitter(990), dur: 0.08, type: "triangle", vol: 0.26 });
  },
  type: (t) => {
    tone(t, { f0: jitter(1800, 0.08), f1: 1200, dur: 0.025, type: "triangle", vol: 0.12 });
  },
  success: (t) => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(t + i * 0.07, { f0: f, dur: 0.22, type: "triangle", vol: 0.3 }));
  },
  lock: (t) => {
    tone(t, { f0: 180, f1: 70, dur: 0.16, vol: 0.6 });
    noise(t, { dur: 0.05, vol: 0.28, freq: 1400, q: 1.2 });
    tone(t + 0.09, { f0: 1320, dur: 0.12, type: "triangle", vol: 0.16 });
  },
  wrong: (t) => {
    tone(t, { f0: 240, f1: 150, dur: 0.14, type: "square", vol: 0.14 });
    tone(t + 0.13, { f0: 190, f1: 110, dur: 0.2, type: "square", vol: 0.13 });
  },
  error: (t) => {
    tone(t, { f0: 160, dur: 0.22, type: "sawtooth", vol: 0.09 });
    tone(t, { f0: 164, dur: 0.22, type: "sawtooth", vol: 0.09 });
  },
  coin: (t) => {
    tone(t, { f0: 987.77, dur: 0.08, type: "square", vol: 0.12 });
    tone(t + 0.075, { f0: 1318.5, dur: 0.32, type: "square", vol: 0.12 });
    tone(t + 0.075, { f0: 2637, dur: 0.2, type: "sine", vol: 0.08 });
  },
  notify: (t) => {
    tone(t, { f0: 880, dur: 0.1, type: "sine", vol: 0.22 });
    tone(t + 0.09, { f0: 1174.7, dur: 0.16, type: "sine", vol: 0.2 });
  },
  whoosh: (t) => {
    noise(t, { dur: 0.28, vol: 0.16, freq: 400, f1: 3200, q: 0.9 });
  },
  confetti: (t) => {
    // the pop of the popper, then paper crackle falling
    noise(t, { dur: 0.12, vol: 0.5, freq: 900, f1: 5000, q: 0.7 });
    tone(t, { f0: 420, f1: 120, dur: 0.12, vol: 0.4 });
    for (let i = 0; i < 26; i++) {
      const at = t + 0.06 + Math.random() * 0.9;
      noise(at, { dur: 0.02 + Math.random() * 0.03, vol: 0.05 + Math.random() * 0.1, freq: 2500 + Math.random() * 5000, q: 2 });
    }
  },
  win: (t) => {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(t + i * 0.085, { f0: f, dur: 0.3, type: "triangle", vol: 0.28 }));
    [2093, 2637, 3136].forEach((f, i) => tone(t + 0.45 + i * 0.06, { f0: f, dur: 0.5, type: "sine", vol: 0.07 }));
    RECIPES.confetti(t + 0.4);
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
const GAP: Partial<Record<Sound, number>> = { tap: 40, pop: 50, type: 25, notify: 300, confetti: 600, win: 1200, coin: 250 };

export function sfx(name: Sound) {
  if (!enabled || muted || typeof window === "undefined") return;
  const now = performance.now();
  if (now - (last[name] ?? -1e9) < (GAP[name] ?? 60)) return;
  last[name] = now;
  const h = HAPTIC[name];
  if (h) vibrate(h);
  unlockAudio();
  const c = ctx;
  if (!c || !master) return;
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
