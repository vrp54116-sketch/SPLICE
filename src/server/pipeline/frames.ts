/** Raw RGB frame sampling from an encoded video, for re-scanning real rendered output. */
import { runChecked, clamp, uid } from '../lib/util';
import { FFMPEG } from './render';
import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';
import type { OffloadFrame } from '@shared/types';

const W = 160, H = 284;

export async function sampleFrames(video: string, fps = 2): Promise<OffloadFrame[]> {
  const tmp = path.join(os.tmpdir(), `splice-frames-${uid()}.raw`);
  try {
    await runChecked(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', video,
      '-vf', `fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=disable,format=rgb24`,
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', tmp,
    ], { timeoutMs: 10 * 60_000 });
    return await parseFrames(await fsp.readFile(tmp), fps);
  } finally { await fsp.rm(tmp, { force: true }); }
}

async function parseFrames(buf: Buffer, fps = 2): Promise<OffloadFrame[]> {
  const frameBytes = W * H * 3;
  const count = Math.floor(buf.length / frameBytes);
  const out: OffloadFrame[] = [];
  let prev: Buffer | null = null;
  for (let i = 0; i < count; i++) {
    const data = buf.subarray(i * frameBytes, (i + 1) * frameBytes);
    const mean = (x0: number, y0: number, x1: number, y1: number) => {
      let s = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const idx = (y * W + x) * 3;
        s += (data[idx]! + data[idx + 1]! + data[idx + 2]!) / 3; n++;
      }
      return s / Math.max(1, n);
    };
    const variance = (x0: number, y0: number, x1: number, y1: number) => {
      const m = mean(x0, y0, x1, y1);
      let s = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const idx = (y * W + x) * 3;
        const v = (data[idx]! + data[idx + 1]! + data[idx + 2]!) / 3;
        s += (v - m) ** 2; n++;
      }
      return s / Math.max(1, n) / (255 * 255);
    };
    let frameChange = 0;
    if (prev) {
      for (let j = 0; j < data.length; j += 27) frameChange += Math.abs(data[j]! - prev[j]!);
      frameChange = clamp(frameChange / (data.length / 27) / 255, 0, 1);
    }
    const bottom = mean(8, H - 12, W - 8, H - 4);
    const above = mean(8, H - 32, W - 8, H - 20);
    const right = mean(W - 14, 40, W - 3, H - 60);
    const left = mean(3, 40, 14, H - 60);
    out.push({
      t: i / fps,
      faces: [], ocr: [], phash: hash(data), saliency: { x: W / 2, y: H / 2 },
      chrome: {
        bottomBar: clamp(Math.abs(bottom - above) / 90, 0, 1),
        rightRail: clamp(Math.abs(right - left) / 90, 0, 1),
        handleChip: clamp((variance(W - 44, 10, W - 4, 40) > 0.01 ? 0.85 : 0.1), 0, 1),
      },
      roi: {
        corners: variance(0, 0, Math.round(W * 0.28), Math.round(H * 0.12)),
        lowerThird: variance(0, Math.round(H * 0.74), Math.round(W * 0.6), Math.round(H * 0.9)),
        frameChange,
        staticCorner: variance(0, 0, Math.round(W * 0.3), Math.round(H * 0.22)) < 0.004 ? 0.9 : 0.1,
      },
      bars: {
        letterbox: clamp(mean(0, 0, W, 6) < 12 && mean(0, H - 6, W, H) < 12 ? 0.14 : 0, 0, 1),
        pillarbox: clamp(mean(0, 0, 6, H) < 12 && mean(W - 6, 0, W, H) < 12 ? 0.14 : 0, 0, 1),
      },
    });
    prev = data;
  }
  return out;
}

function hash(data: Buffer): string {
  let h = 2166136261;
  for (let i = 0; i < data.length; i += 31) { h ^= data[i]!; h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
