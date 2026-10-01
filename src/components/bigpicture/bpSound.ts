/**
 * Big Picture's interface sounds, synthesized with Web Audio so there are no
 * files to ship: a soft tick when the focus moves, confirm and back cues, a
 * swipe between sections, and the entry and exit themes. Those two are
 * musical rather than effects: soft bells rising with the logo (the red 9,
 * then the 5) over a warm swell, resolving into a D major chord in a small
 * room, and the same bells falling on the way out.
 */

export type BpSound =
  | 'move'
  | 'select'
  | 'back'
  | 'tab'
  | 'open'
  | 'close'
  | 'edge'
  | 'toggle'
  | 'page'
  | 'launch'
  | 'ready'
  | 'enter'
  | 'enterShort'
  | 'exit';

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let room: AudioNode | null = null;
let enabled = true;
let lastMove = 0;

export function setSoundsEnabled(on: boolean): void {
  enabled = on;
}

function audio(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext({ latencyHint: 'interactive' });
    } catch {
      return null;
    }
    // A gentle limiter keeps stacked cues (fast scrolling) from clipping.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 12;
    limiter.ratio.value = 6;
    out = ctx.createGain();
    out.gain.value = 0.7;
    out.connect(limiter).connect(ctx.destination);
  }
  // Starts suspended until the page had a user gesture; any later cue resumes it.
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

/** Creates the audio context during the gesture that opened Big Picture. */
export function primeSounds(): void {
  audio();
}

interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  to?: number;
  at?: number;
  dur: number;
  gain: number;
  attack?: number;
}

function tone(c: AudioContext, { type = 'sine', freq, to, at = 0, dur, gain, attack = 0.005 }: ToneOpts): void {
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env).connect(out!);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

interface NoiseOpts {
  at?: number;
  dur: number;
  gain: number;
  from: number;
  to: number;
  q?: number;
  filter?: BiquadFilterType;
  attack?: number;
}

function noise(
  c: AudioContext,
  { at = 0, dur, gain, from, to, q = 1, filter = 'bandpass', attack = 0.01 }: NoiseOpts,
): void {
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t0 = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const band = c.createBiquadFilter();
  band.type = filter;
  band.Q.value = q;
  band.frequency.setValueAtTime(from, t0);
  band.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + Math.max(attack, 0.005));
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(band).connect(env).connect(out!);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

/** A soft pad chord (the game is up). */
function chord(c: AudioContext, notes: number[], at: number, dur: number, gain: number): void {
  notes.forEach((freq, i) => {
    tone(c, { type: 'triangle', freq, at: at + i * 0.035, dur, gain, attack: 0.09 });
    tone(c, { type: 'sine', freq: freq * 2, at: at + i * 0.035, dur: dur * 0.6, gain: gain * 0.35, attack: 0.05 });
  });
}

/** A small, dark room the themes ring out in (a generated impulse response). */
function roomInput(c: AudioContext): AudioNode {
  if (!room) {
    const seconds = 2.4;
    const length = Math.floor(c.sampleRate * seconds);
    const ir = c.createBuffer(2, length, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      let dark = 0;
      for (let i = 0; i < length; i++) {
        // Decaying noise, smoothed so the tail is warm rather than hissy.
        dark = dark * 0.55 + (Math.random() * 2 - 1) * 0.45;
        data[i] = dark * (1 - i / length) ** 3.4;
      }
    }
    const convolver = c.createConvolver();
    convolver.buffer = ir;
    const predelay = c.createDelay(0.1);
    predelay.delayTime.value = 0.022;
    const wet = c.createGain();
    wet.gain.value = 0.85;
    predelay.connect(convolver).connect(wet).connect(out!);
    room = predelay;
  }
  return room;
}

/** Sends a voice to the output, placed left or right, with some of it to the room. */
function place(c: AudioContext, node: AudioNode, pan: number, send: number): void {
  const panner = c.createStereoPanner();
  panner.pan.value = pan;
  node.connect(panner).connect(out!);
  if (send > 0) {
    const toRoom = c.createGain();
    toRoom.gain.value = send;
    panner.connect(toRoom).connect(roomInput(c));
  }
}

interface BellOpts {
  freq: number;
  at?: number;
  dur?: number;
  gain: number;
  pan?: number;
  send?: number;
}

/** A soft mallet bell (two-operator FM): bright as it is struck, mellow as it rings. */
function bell(c: AudioContext, { freq, at = 0, dur = 1.6, gain, pan = 0, send = 0.45 }: BellOpts): void {
  const t0 = c.currentTime + at;
  const carrier = c.createOscillator();
  carrier.frequency.value = freq;
  const modulator = c.createOscillator();
  modulator.frequency.value = freq * 2;
  const depth = c.createGain();
  depth.gain.setValueAtTime(freq * 1.6, t0);
  depth.gain.exponentialRampToValueAtTime(freq * 0.04, t0 + dur * 0.45);
  modulator.connect(depth).connect(carrier.frequency);
  const env = c.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(gain, t0 + 0.005);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  carrier.connect(env);
  place(c, env, pan, send);
  carrier.start(t0);
  modulator.start(t0);
  carrier.stop(t0 + dur + 0.05);
  modulator.stop(t0 + dur + 0.05);
}

interface PadOpts {
  notes: number[];
  at?: number;
  attack: number;
  hold: number;
  release: number;
  gain: number;
  /** Low-pass opening up from `dark` to `bright` with the attack, closing on release. */
  dark: number;
  bright: number;
  send?: number;
}

/** A warm, slightly detuned chord that swells in and dies away. */
function pad(c: AudioContext, { notes, at = 0, attack, hold, release, gain, dark, bright, send = 0.55 }: PadOpts): void {
  const t0 = c.currentTime + at;
  const peak = t0 + attack;
  const end = peak + hold + release;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.4;
  filter.frequency.setValueAtTime(dark, t0);
  filter.frequency.exponentialRampToValueAtTime(bright, peak);
  filter.frequency.setValueAtTime(bright, peak + hold);
  filter.frequency.exponentialRampToValueAtTime(dark, end);
  const env = c.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(gain / notes.length, peak);
  env.gain.setValueAtTime(gain / notes.length, peak + hold);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  filter.connect(env);
  place(c, env, 0, send);
  for (const freq of notes) {
    for (const [type, detune] of [['triangle', -5], ['sine', 6]] as const) {
      const osc = c.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(t0);
      osc.stop(end + 0.05);
    }
  }
}

/** Notes of the themes (D major). */
const D3 = 146.83;
const A3 = 220;
const D4 = 293.66;
const FS4 = 369.99;
const A4 = 440;
const D5 = 587.33;
const E5 = 659.26;
const A5 = 880;
const D6 = 1174.66;

export function playSound(name: BpSound): void {
  const c = audio();
  if (!c || !out) return;
  switch (name) {
    case 'move': {
      // Holding a direction repeats fast; keep it a texture, not a buzz.
      const now = performance.now();
      if (now - lastMove < 55) return;
      lastMove = now;
      tone(c, { freq: 1320, to: 1180, dur: 0.05, gain: 0.045 });
      tone(c, { type: 'triangle', freq: 2640, dur: 0.025, gain: 0.012 });
      break;
    }
    case 'select':
      tone(c, { type: 'triangle', freq: 660, dur: 0.08, gain: 0.08 });
      tone(c, { type: 'triangle', freq: 990, at: 0.05, dur: 0.14, gain: 0.07 });
      break;
    case 'back':
      tone(c, { type: 'triangle', freq: 760, to: 500, dur: 0.12, gain: 0.07 });
      break;
    case 'tab':
      noise(c, { dur: 0.13, gain: 0.05, from: 700, to: 3400, q: 0.8 });
      tone(c, { freq: 1180, at: 0.03, dur: 0.05, gain: 0.03 });
      break;
    case 'open':
      tone(c, { freq: 440, to: 700, dur: 0.16, gain: 0.07 });
      noise(c, { dur: 0.14, gain: 0.025, from: 1200, to: 4000, q: 0.7 });
      break;
    case 'close':
      tone(c, { freq: 640, to: 400, dur: 0.14, gain: 0.06 });
      break;
    case 'edge':
      tone(c, { freq: 150, to: 110, dur: 0.08, gain: 0.08 });
      break;
    case 'toggle':
      tone(c, { type: 'square', freq: 880, dur: 0.03, gain: 0.02 });
      tone(c, { freq: 1320, at: 0.03, dur: 0.06, gain: 0.04 });
      break;
    case 'page':
      noise(c, { dur: 0.1, gain: 0.05, from: 3200, to: 900, filter: 'highpass', q: 0.5, attack: 0.004 });
      break;
    case 'launch':
      tone(c, { type: 'sawtooth', freq: 110, to: 440, dur: 0.7, gain: 0.025, attack: 0.2 });
      tone(c, { freq: 220, to: 880, dur: 0.7, gain: 0.05, attack: 0.2 });
      noise(c, { dur: 0.8, gain: 0.05, from: 300, to: 5000, q: 0.6, attack: 0.3 });
      break;
    case 'ready':
      chord(c, [523.25, 659.25, 783.99], 0, 0.9, 0.05);
      break;
    case 'enter':
      // A low swell while the layer opens and the lockup starts drawing…
      pad(c, { notes: [D3, A3], attack: 0.6, hold: 0.45, release: 0.9, gain: 0.065, dark: 260, bright: 1300 });
      // …a bell as the red 9 drops in, with a soft felt knock under it…
      bell(c, { freq: A4, at: 0.74, dur: 1.9, gain: 0.09, pan: -0.15 });
      tone(c, { freq: 110, to: 82, at: 0.74, dur: 0.32, gain: 0.08, attack: 0.004 });
      // …two more, higher, while the 5 draws itself…
      bell(c, { freq: D5, at: 1.08, dur: 1.7, gain: 0.07, pan: 0.15 });
      bell(c, { freq: A5, at: 1.36, dur: 1.8, gain: 0.05, pan: 0.3 });
      // …and the chord the logo settles on, with a little air above it.
      pad(c, { notes: [D3, A3, FS4, E5], at: 1.44, attack: 0.16, hold: 0.5, release: 1.7, gain: 0.1, dark: 600, bright: 2600 });
      pad(c, { notes: [D6, A5 * 2], at: 1.5, attack: 0.35, hold: 0.3, release: 1.4, gain: 0.014, dark: 3000, bright: 6000, send: 0.9 });
      break;
    case 'enterShort':
      bell(c, { freq: D5, dur: 1.4, gain: 0.05, pan: -0.1 });
      bell(c, { freq: A5, at: 0.09, dur: 1.5, gain: 0.04, pan: 0.15 });
      pad(c, { notes: [D3, A3, FS4], at: 0.1, attack: 0.12, hold: 0.25, release: 1.3, gain: 0.06, dark: 500, bright: 2200 });
      break;
    case 'exit':
      // The way in, turned around: the bells fall back and the chord closes.
      bell(c, { freq: A5, dur: 0.8, gain: 0.025, pan: 0.15 });
      bell(c, { freq: D5, at: 0.1, dur: 0.95, gain: 0.032, pan: -0.1 });
      pad(c, { notes: [D4, A3], at: 0.04, attack: 0.08, hold: 0.1, release: 0.6, gain: 0.035, dark: 300, bright: 1800 });
      break;
  }
}
