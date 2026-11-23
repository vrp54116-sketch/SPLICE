/**
 * CLAIM SHIELD DSP. Pure TypeScript radix-2 FFT, no native deps.
 * Input is 16 kHz mono s16le PCM produced by ffmpeg.
 */

export const SAMPLE_RATE = 16_000;
const FRAME = 1024;
const HOP = 512;

export function pcmToFloat(buf: Buffer): Float32Array {
  const n = Math.floor(buf.length / 2);
  const out = new Float32Array(n);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

/** In-place iterative radix-2 Cooley–Tukey. re/im length must be power of two. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error('FFT length must be a power of two');
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]!, ui = im[i + k]!;
        const vr = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci;
        const vi = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

const hann = (i: number, n: number) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));

export interface FrameFeatures {
  t: number; rms: number; flux: number; flatness: number; harmonicity: number; centroid: number;
  bands: [number, number, number, number];
}

export function analyzeFrames(samples: Float32Array): FrameFeatures[] {
  const count = Math.max(1, Math.floor((samples.length - FRAME) / HOP));
  const out: FrameFeatures[] = [];
  let prevMag: Float32Array | null = null;
  for (let f = 0; f < count; f++) {
    const off = f * HOP;
    const re = new Float32Array(FRAME), im = new Float32Array(FRAME);
    let energy = 0;
    for (let i = 0; i < FRAME; i++) {
      const s = samples[off + i] ?? 0;
      re[i] = s * hann(i, FRAME);
      energy += s * s;
    }
    fft(re, im);
    const bins = FRAME / 2;
    const mag = new Float32Array(bins);
    let sum = 0, logSum = 0, weighted = 0, flux = 0;
    const bands: [number, number, number, number] = [0, 0, 0, 0];
    for (let k = 0; k < bins; k++) {
      const m = Math.hypot(re[k]!, im[k]!);
      mag[k] = m;
      sum += m;
      if (m > 1e-9) logSum += Math.log(m);
      weighted += k * m;
      if (k < bins * 0.08) bands[0] += m;
      else if (k < bins * 0.25) bands[1] += m;
      else if (k < bins * 0.55) bands[2] += m;
      else bands[3] += m;
      if (prevMag) flux += Math.max(0, m - prevMag[k]!);
    }
    prevMag = mag;
    const gm = Math.exp(logSum / bins);
    const flatness = sum > 1e-9 ? Math.min(1, gm / (sum / bins)) : 0;
    // normalized autocorrelation peak in lag 2..80 => 200..8000 Hz pitch period
    let best = 0, bestLag = 0;
    for (let lag = 2; lag < 80; lag++) {
      let c = 0;
      for (let i = 0; i < FRAME - lag; i += 2) c += (samples[off + i] ?? 0) * (samples[off + i + lag] ?? 0);
      if (c > best) { best = c; bestLag = lag; }
    }
    let total = 1e-9;
    for (let i = 0; i < FRAME; i += 2) total += (samples[off + i] ?? 0) ** 2;
    out.push({
      t: off / SAMPLE_RATE,
      rms: Math.sqrt(energy / FRAME),
      flux: flux / bins,
      flatness,
      harmonicity: bestLag > 0 ? Math.min(1, Math.max(0, best / total)) : 0,
      centroid: sum > 1e-9 ? (weighted / sum) * (SAMPLE_RATE / FRAME) : 0,
      bands,
    });
  }
  return out;
}

/** Autocorrelation regularity of the onset envelope at beat-rate lags. */
export function tempoRegularity(frames: FrameFeatures[]): number {
  const fps = SAMPLE_RATE / HOP;
  const env = frames.map((f) => f.flux);
  const mean = env.reduce((a, b) => a + b, 0) / Math.max(1, env.length);
  const x = env.map((v) => v - mean);
  // lags 0.30s .. 1.0s => 90..180 BPM
  let best = 0;
  for (let seconds = 30 / 90; seconds <= 1.0 + 1e-9; seconds += 1 / 60) {
    const lag = Math.round(seconds * fps);
    if (lag < 2 || lag >= x.length / 3) continue;
    let num = 0, d1 = 0, d2 = 0;
    for (let i = 0; i + lag < x.length; i++) { num += x[i]! * x[i + lag]!; d1 += x[i]! ** 2; d2 += x[i + lag]! ** 2; }
    const r = num / Math.sqrt(Math.max(1e-9, d1 * d2));
    if (r > best) best = r;
  }
  return Math.min(1, Math.max(0, best));
}

export interface WindowStats {
  rms: number; flux: number; flatness: number; harmonicity: number;
  musicLikelihood: number; coverage: number; peaks: number;
  regularity: number; pauseRatio: number;
}

export function windowStats(frames: FrameFeatures[], start: number, end: number, pauses: Array<{ start: number; end: number }> = {} as never): WindowStats {
  const sel = frames.filter((f) => f.t >= start && f.t < end);
  if (!sel.length) return { rms: 0, flux: 0, flatness: 0, harmonicity: 0, musicLikelihood: 0, coverage: 0, peaks: 0, regularity: 0, pauseRatio: 0 };
  const avg = (fn: (f: FrameFeatures) => number) => sel.reduce((a, f) => a + fn(f), 0) / sel.length;
  const rms = avg((f) => f.rms), flux = avg((f) => f.flux), flatness = avg((f) => f.flatness), harmonicity = avg((f) => f.harmonicity);
  const regular = tempoRegularity(sel);
  const pauseList = Array.isArray(pauses) ? pauses : [];
  const inPause = sel.filter((f) => pauseList.some((p) => f.t >= p.start && f.t < p.end));
  let pauseRatio = 0;
  if (inPause.length && sel.length) {
    const pEnergy = inPause.reduce((a, f) => a + f.rms, 0) / inPause.length;
    pauseRatio = rms > 1e-6 ? Math.min(1, pEnergy / rms) : 0;
  }
  const musicLikelihood = Math.min(1,
    (regular >= 0.6 ? 0.35 : regular * 0.35) +
    (harmonicity >= 0.5 ? 0.25 : harmonicity * 0.4) +
    (flatness < 0.35 ? 0.2 : (1 - flatness) * 0.18) +
    (pauseRatio >= 0.35 ? 0.2 : pauseRatio * 0.4)
  );
  const loud = sel.map((f) => f.rms);
  const meanRms = loud.reduce((a, b) => a + b, 0) / loud.length;
  const sd = Math.sqrt(loud.reduce((a, b) => a + (b - meanRms) ** 2, 0) / loud.length);
  const peaks = loud.filter((v) => v > meanRms + 1.3 * sd && v > 0.02).length;
  return { rms, flux, flatness, harmonicity, musicLikelihood, coverage: sel.length, peaks, regularity: regular, pauseRatio };
}

export function audioHeatmap(frames: FrameFeatures[], duration: number, bucketSeconds = 1) {
  const out: Array<{ start: number; end: number; level: number; flagged: boolean }> = [];
  for (let t = 0; t < duration; t += bucketSeconds) {
    const sel = frames.filter((f) => f.t >= t && f.t < t + bucketSeconds);
    const level = sel.length ? sel.reduce((a, f) => a + f.rms, 0) / sel.length : 0;
    out.push({ start: t, end: Math.min(duration, t + bucketSeconds), level, flagged: level > 0.055 });
  }
  return out;
}
