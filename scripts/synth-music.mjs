/**
 * SPLICE rights-safe music generator.
 * Pure PCM math — no samples, no loops from third parties. Produces six 45s
 * seamless mono WAV beds owned by this project. Runs on postinstall.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'audio');
const RATE = 22050;
const SECONDS = 45;
const N = RATE * SECONDS;
const TAU = Math.PI * 2;

const snap = (hz) => Math.max(1, Math.round((hz * SECONDS) / TAU)) * TAU / SECONDS;
const midi = (n) => snap(440 * Math.pow(2, (n - 69) / 12));

function wav(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return buf;
}

function tone(freq, t, type = 'sine') {
  const p = freq * t;
  if (type === 'tri') return 2 / Math.PI * Math.asin(Math.sin(TAU * p));
  if (type === 'saw') return 2 * (p - Math.floor(p + 0.5));
  if (type === 'square') return Math.sin(TAU * p) >= 0 ? 1 : -1;
  return Math.sin(TAU * p);
}

// deterministic PRNG so builds are reproducible
function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

const CHORDS = {
  lofi: [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65], [52, 55, 59, 62]],
  cinematic: [[45, 52, 57, 64], [43, 50, 55, 62], [48, 55, 60, 67], [41, 48, 53, 60]],
  upbeat: [[60, 64, 67, 72], [57, 60, 64, 69], [62, 65, 69, 74], [55, 59, 62, 67]],
  ambient: [[48, 55, 60, 67], [46, 53, 58, 65], [50, 57, 62, 69], [45, 52, 57, 64]],
  tension: [[45, 46, 52, 59], [45, 47, 52, 60], [43, 44, 50, 57], [44, 46, 51, 58]],
  comedy: [[60, 64, 67, 71], [62, 65, 69, 72], [64, 67, 71, 74], [59, 62, 66, 69]],
};

function make(kind, seed) {
  const rand = rng(seed);
  const out = new Float32Array(N);
  const chords = CHORDS[kind];
  const beat = kind === 'upbeat' ? 0.4 : kind === 'comedy' ? 0.3 : 0.6;
  const bps = 1 / beat;
  const notes = [];
  const steps = Math.round(SECONDS / beat);
  const scale = [0, 2, 3, 5, 7, 8, 10, 12];
  for (let i = 0; i < steps; i++) {
    if (kind !== 'ambient' && rand() < 0.22) continue;
    const root = chords[Math.floor(i / 4) % chords.length][0] + 12;
    const deg = scale[Math.floor(rand() * scale.length)];
    notes.push({ t: i * beat, f: midi(root + deg), len: beat * (0.8 + rand() * 1.5), v: 0.10 + rand() * 0.08 });
    if (kind === 'upbeat' && rand() < 0.4) notes.push({ t: i * beat, f: midi(root + 24), len: beat * 0.4, v: 0.05 });
  }
  const bass = chords.map((c, i) => ({ t: i * (SECONDS / chords.length), f: midi(c[0]), len: SECONDS / chords.length }));

  for (let i = 0; i < N; i++) {
    const t = i / RATE;
    let s = 0;
    for (const b of bass) {
      const lt = ((t - b.t) % SECONDS + SECONDS) % SECONDS;
      if (lt < b.len) {
        const env = Math.min(1, lt * 12) * Math.exp(-lt * 0.5);
        s += tone(b.f, lt, 'sine') * env * (kind === 'tension' ? 0.22 : 0.16);
        s += tone(b.f * 2, lt, 'sine') * env * 0.03;
      }
    }
    for (const n of notes) {
      const lt = ((t - n.t) % SECONDS + SECONDS) % SECONDS;
      if (lt < n.len) {
        const env = Math.min(1, lt * 30) * Math.exp(-lt * (kind === 'ambient' ? 1.2 : 2.6));
        const harm = kind === 'cinematic' || kind === 'lofi' ? 'tri' : 'sine';
        s += tone(n.f, lt, harm) * env * n.v;
        if (kind === 'comedy') s += tone(n.f * 1.5, lt, 'sine') * env * n.v * 0.4;
      }
    }
    // chord pad
    const ci = Math.floor(t / (SECONDS / chords.length)) % chords.length;
    for (const note of chords[ci]) {
      const lfo = 0.5 + 0.5 * Math.sin(TAU * snap(0.11) * t);
      s += tone(midi(note), t, 'sine') * (kind === 'tension' ? 0.012 : 0.018) * (0.7 + 0.3 * lfo);
    }
    // percussive click track for rhythmic beds
    if (kind === 'upbeat' || kind === 'comedy' || kind === 'lofi') {
      const phase = (t * bps) % 1;
      if (phase < 0.05) s += (rand() * 2 - 1) * Math.exp(-phase * 90) * 0.14;
    }
    // soft saturation
    s = Math.tanh(s * 1.25) * 0.72;
    // DC-block
    out[i] = s;
  }
  return wav(out);
}

mkdirSync(OUT, { recursive: true });
const specs = [
  ['lofi', 7], ['cinematic', 11], ['upbeat', 13], ['ambient', 17], ['tension', 19], ['comedy', 23],
];
for (const [name, seed] of specs) {
  const file = join(OUT, `${name}.wav`);
  if (!existsSync(file) || process.env.FORCE_MUSIC === '1') {
    writeFileSync(file, make(name, seed));
    console.log(`generated public/audio/${name}.wav`);
  }
}
