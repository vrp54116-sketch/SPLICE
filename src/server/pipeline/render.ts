import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import { runChecked } from '../lib/util';
import type { Aspect, BackgroundId, MusicId, OffloadResult, ProjectConfig, RepairAction, Span as MediaSpan, Transcript, Word } from '@shared/types';
export type Span = MediaSpan;
import { cues, toAss, type CaptionOptions } from './captions';

export const FFMPEG = process.env.FFMPEG_BIN ?? 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_BIN ?? 'ffprobe';

const filterCache = new Map<string, boolean>();
export async function hasFilter(name: string): Promise<boolean> {
  if (filterCache.has(name)) return filterCache.get(name)!;
  try {
    const r = await runChecked(FFMPEG, ['-hide_banner', '-filters'], { timeoutMs: 10_000 });
    const ok = new RegExp(`^\\s*\\S+\\s+${name}\\s`, 'm').test(r.stdout);
    filterCache.set(name, ok);
    return ok;
  } catch { filterCache.set(name, false); return false; }
}

/** drawtext caption chain for ffmpeg builds without libass. Real burned captions. */
function drawtextCaptions(opts: CaptionOptions & { transcript: Transcript; hookText?: string }, work: string): { filters: string[]; files: string[] } {
  const list = cues(opts.transcript.words, opts.start, opts.end, 4);
  const files: string[] = [];
  const filters: string[] = [];
  const size = Math.round((opts.width < 800 ? 32 : 46) * Math.min(1, opts.width / 720));
  let i = 0;
  for (const cue of list) {
    const s = Math.max(0, cue.start - opts.start), e = cue.end - opts.start;
    if (e - s < 0.2) continue;
    const file = path.join(work, `cue_${i++}.txt`);
    fs.writeFileSync(file, cue.words.map((w) => w.w).join(' ').replace(/\s+/g, ' ').trim());
    files.push(file);
    const fade = `if(lt(t\\,${s.toFixed(2)}+0.18)\\,(t-${s.toFixed(2)})/0.18\\,1)`;
    filters.push(`drawtext=textfile=${escPath(file)}:fontsize=${size}:fontcolor=white:box=1:boxcolor=black@0.62:boxborderw=10:x=(w-text_w)/2:y=h-h/5:alpha=${fade}:enable='between(t\\,${s.toFixed(2)}\\,${e.toFixed(2)})'`);
  }
  if (opts.hookText) {
    const file = path.join(work, 'hook.txt');
    fs.writeFileSync(file, opts.hookText.slice(0, 74));
    files.push(file);
    filters.push(`drawtext=textfile=${escPath(file)}:fontsize=${Math.round(size * 1.15)}:fontcolor=0x00EAEA:box=1:boxcolor=0x3A120C@0.85:boxborderw=14:x=(w-text_w)/2:y=h/7:enable='lt(t\\,3)'`);
  }
  return { filters, files };
}

export interface MediaInfo {
  duration: number; width: number; height: number; fps: number;
  hasVideo: boolean; hasAudio: boolean; codec: string;
  letterbox: number; pillarbox: number; thumbnail: string;
}

export async function probe(input: string, thumbnailPath?: string): Promise<MediaInfo> {
  const r = await runChecked(FFPROBE, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,codec_name',
    '-show_entries', 'format=duration', '-of', 'json', input,
  ], { timeoutMs: 60_000 });
  const j = JSON.parse(r.stdout) as { streams?: Array<{ width?: number; height?: number; r_frame_rate?: string; codec_name?: string }>; format?: { duration?: string } };
  const v = j.streams?.[0];
  const [num, den] = (v?.r_frame_rate ?? '30/1').split('/').map(Number);
  const duration = Number(j.format?.duration ?? 0);
  let letterbox = 0, pillarbox = 0;
  if (v?.width && v?.height) {
    try {
      const cd = await runChecked(FFMPEG, ['-hide_banner', '-i', input, '-vf', 'cropdetect=limit=24:round=2:reset=0', '-an', '-t', '12', '-f', 'null', '-'], { timeoutMs: 90_000 });
      const crops = [...cd.stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
      if (crops.length) {
        const vals = crops.map((m) => ({ w: Number(m[1]), h: Number(m[2]), x: Number(m[3]), y: Number(m[4]) }));
        const median = vals.sort((a, b) => a.w * a.h - b.w * b.h)[Math.floor(vals.length / 2)]!;
        letterbox = Math.max(0, (v.height - median.h) / v.height);
        pillarbox = Math.max(0, (v.width - median.w) / v.width);
      }
    } catch { /* no bars detected */ }
  }
  if (thumbnailPath) {
    try {
      await runChecked(FFMPEG, ['-y', '-ss', String(Math.min(2, duration / 2)), '-i', input, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', thumbnailPath], { timeoutMs: 60_000 });
    } catch { /* thumbnail optional */ }
  }
  const audio = await runChecked(FFPROBE, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'json', input], { timeoutMs: 30_000 }).catch(() => ({ stdout: '{"streams":[]}' }));
  const hasAudio = (JSON.parse(audio.stdout) as { streams?: unknown[] }).streams?.length ? true : false;
  return {
    duration, width: v?.width ?? 0, height: v?.height ?? 0,
    fps: den ? (num ?? 30) / den : 30, hasVideo: Boolean(v), hasAudio,
    codec: v?.codec_name ?? 'unknown', letterbox, pillarbox, thumbnail: thumbnailPath ?? '',
  };
}

export async function makeProxy(input: string, out: string, duration: number): Promise<void> {
  await runChecked(FFMPEG, [
    '-y', '-i', input, '-t', String(Math.min(duration, 120)),
    '-vf', 'scale=-2:540', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
  ], { timeoutMs: 20 * 60_000 });
}

export async function extractAudio(input: string, out: string, start = 0, end?: number): Promise<void> {
  const args = ['-y', '-ss', String(start), '-i', input];
  if (end !== undefined) args.push('-t', String(end - start));
  args.push('-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 's16le', out);
  await runChecked(FFMPEG, args, { timeoutMs: 20 * 60_000 });
}

export async function detectShots(input: string): Promise<Span[]> {
  try {
    const r = await runChecked(FFMPEG, [
      '-hide_banner', '-i', input, '-vf', "select='gt(scene,0.35)',showinfo", '-an', '-f', 'null', '-',
    ], { timeoutMs: 20 * 60_000 });
    const times = [...r.stderr.matchAll(/pts_time:([0-9.]+)/g)].map((m) => Number(m[1]));
    return times.map((t, i) => ({ start: t, end: times[i + 1] ?? t + 8, score: 0.35 }));
  } catch { return []; }
}

/* ------------------------------------------------------- backgrounds */

const FILTERS: Record<BackgroundId, { filter: string; fps?: number }> = {
  plasma: { filter: 'gradients=s=1080x1920:c0=0xFF4D2E:c1=0x22D3EE:c2=0xFF3DBE:c3=0x0A0D12:speed=0.03', fps: 24 },
  mandelbrot: { filter: 'mandelbrot=s=1080x1920:rate=0.02:maxiter=40', fps: 24 },
  life: { filter: 'life=s=1080x1920:mold=10:r=24:ratio=0.15:death_color=#0A0D12:life_color=#22D3EE', fps: 24 },
  cellauto: { filter: 'cellauto=s=1080x1920:rule=110:scroll=1:rate=24', fps: 24 },
  starfield: { filter: 'nullsrc=s=1080x1920,geq=lum=255*gt(random(0),0.997):cb=128:cr=128', fps: 24 },
  kinetic: { filter: 'testsrc2=s=1080x1920:rate=24,hue=h=t*12', fps: 24 },
  inkbloom: { filter: 'gradients=s=1080x1920:c0=0x10151D:c1=0xFF3DBE:c2=0x18202B:c3=0x0A0D12:speed=0.02,gblur=sigma=12', fps: 24 },
  tapenoise: { filter: 'nullsrc=s=1080x1920,geq=lum=' + '"16*random(0)"' + ':cb=128:cr=128,noise=alls=18:allf=t', fps: 24 },
};

export async function renderBackground(id: BackgroundId, seconds: number, width: number, height: number): Promise<string> {
  const key = `${id}_${width}x${height}_${Math.min(60, Math.ceil(seconds))}`;
  const dir = path.join(config.scratch, 'backgrounds');
  await fsp.mkdir(dir, { recursive: true });
  const out = path.join(dir, `${key}.mp4`);
  if (fs.existsSync(out)) { try { const t = Date.now(); fs.utimesSync(out, t / 1000, t / 1000); } catch { /* ignore */ } return out; }
  const spec = FILTERS[id] ?? FILTERS.plasma;
  await runChecked(FFMPEG, [
    '-y', '-f', 'lavfi', '-i', spec.filter, '-t', String(Math.min(60, Math.ceil(seconds))),
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p', '-an', out,
  ], { timeoutMs: 10 * 60_000 });
  return out;
}

/* ------------------------------------------------------------- crop */

function cropCommands(offload: OffloadResult | undefined, span: Span, inputW: number, inputH: number, mode: ProjectConfig['reframe'], manual?: { x: number; y: number; zoom: number }): string {
  const aspectRatio = 9 / 16;
  let cw = Math.min(inputW, Math.round(inputH * aspectRatio));
  let ch = Math.min(inputH, Math.round(cw / aspectRatio));
  if (cw < 2 || ch < 2) { cw = inputW; ch = inputH; }
  const baseX = Math.round((inputW - cw) / 2), baseY = Math.round((inputH - ch) / 2);
  const zoom = manual?.zoom ?? 1;
  cw = Math.max(2, Math.round(cw / zoom)); ch = Math.max(2, Math.round(ch / zoom));
  const lines: string[] = [];
  const push = (t: number, x: number, y: number) => {
    lines.push(`${t.toFixed(2)} crop@reframe w ${cw};`);
    lines.push(`${t.toFixed(2)} crop@reframe h ${ch};`);
    lines.push(`${t.toFixed(2)} crop@reframe x ${Math.max(0, Math.min(inputW - cw, Math.round(x)))};`);
    lines.push(`${t.toFixed(2)} crop@reframe y ${Math.max(0, Math.min(inputH - ch, Math.round(y)))};`);
  };
  if (mode === 'manual' && manual) {
    push(0, baseX + (manual.x / 100) * Math.max(1, inputW - cw), baseY + (manual.y / 100) * Math.max(1, inputH - ch));
  } else if (mode === 'face' && offload?.frames.length) {
    const points = offload.frames.filter((f) => f.t >= span.start && f.t <= span.end && f.faces.length);
    if (points.length) {
      for (const f of points) {
        const face = f.faces.sort((a, b) => b.score - a.score)[0]!;
        const cx = inputW * (face.x + face.w / 2), cy = inputH * (face.y + face.h / 2);
        push(Math.max(0, f.t - span.start), cx - cw / 2, cy - ch / 2 - ch * 0.08);
      }
      return lines.join('\n') + '\n';
    }
    push(0, baseX, baseY);
  } else {
    push(0, baseX, baseY);
  }
  return lines.join('\n') + '\n';
}

/* ------------------------------------------------------------ render */

export interface RenderParams {
  input: string;
  output: string;
  span: Span;
  config: ProjectConfig;
  transcript: Transcript;
  offload?: OffloadResult;
  media: MediaInfo;
  applied: RepairAction[];
  hookText?: string;
  voiceoverPath?: string;
  backgroundPath?: string;
  attribution?: string;
}

function escPath(p: string) { return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'"); }

export function dimensions(aspect: Aspect, resolution: number) {
  const base = resolution === 1080 ? 1080 : resolution === 720 ? 720 : 480;
  if (aspect === '9:16') return { w: base, h: Math.round(base * 16 / 9 / 2) * 2 };
  if (aspect === '16:9') return { w: Math.round(base * 16 / 9 / 2) * 2, h: base };
  return { w: base, h: base };
}

export async function renderClip(p: RenderParams): Promise<string> {
  const { w, h } = dimensions(p.config.aspect, p.config.resolution);
  const duration = Math.max(1, p.span.end - p.span.start);
  const work = path.dirname(p.output);
  await fsp.mkdir(work, { recursive: true });

  const cmdPath = path.join(work, `crop_${path.basename(p.output)}.cmd`);
  fs.writeFileSync(cmdPath, cropCommands(p.offload, p.span, p.media.width, p.media.height, p.config.reframe, p.config.manualCrop));
  const useAss = await hasFilter('ass');
  const assPath = path.join(work, `subs_${path.basename(p.output)}.ass`);
  if (useAss) fs.writeFileSync(assPath, toAss(p.transcript, {
    style: p.config.captionStyle, width: w, height: h, start: p.span.start, end: p.span.end,
    hook: p.config.autoHook ? p.hookText : undefined,
  }));
  const dt = useAss ? null : drawtextCaptions({ transcript: p.transcript, style: p.config.captionStyle, width: w, height: h, start: p.span.start, end: p.span.end, hookText: p.config.autoHook ? p.hookText : undefined }, work);

  const args: string[] = ['-y', '-ss', p.span.start.toFixed(3), '-i', p.input];
  let videoLabel = '0:v';
  let audioLabel = '0:a';
  const filterParts: string[] = [];

  // reframe crop (sendcmd) → scale to output
  filterParts.push(`[0:v]fps=30,setpts=PTS-STARTPTS,sendcmd=f=${escPath(cmdPath)},crop@reframe=w=iw:h=ih:x=0:y=0,scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}[base]`);
  videoLabel = 'base';

  if (p.config.splitScreen && p.backgroundPath) {
    args.push('-stream_loop', '-1', '-i', p.backgroundPath);
    const ratio = Math.max(0.35, Math.min(0.85, p.config.splitRatio));
    const mainW = Math.round((w * ratio) / 2) * 2;
    filterParts.push(`[1:v]scale=${w}:${h},fps=30,trim=duration=${duration},setpts=PTS-STARTPTS[bg]`);
    filterParts.push(`[${videoLabel}]scale=${mainW}:${h}:force_original_aspect_ratio=increase,crop=${mainW}:${h}[fg]`);
    filterParts.push(`[bg][fg]overlay=x=${w - mainW}:y=0:shortest=1[composed]`);
    videoLabel = 'composed';
  }

  // Legal repairs applied to the actual pixels
  if (p.applied.includes('blur_roi')) {
    filterParts.push(`[${videoLabel}]split=2[vmain][vroi]`);
    filterParts.push(`[vroi]crop=iw*0.30:ih*0.18:0:0,boxblur=18:2[vblur]`);
    filterParts.push(`[vmain][vblur]overlay=0:0[blurred]`);
    videoLabel = 'blurred';
  }
  if (p.applied.includes('crop_overlay')) {
    const inset = Math.round(Math.min(0.12, 0.1) * Math.min(w, h));
    filterParts.push(`[${videoLabel}]crop=${w - inset * 2}:${h - inset * 2}:${inset}:${inset},scale=${w}:${h}[cropped]`);
    videoLabel = 'cropped';
  }

  // Burned captions (word-level karaoke + hook card). Fonts resolve via fontconfig;
  // fallback ensures text always renders on minimal images.
  if (useAss) {
    const fontDir = process.env.SPLICE_FONT_DIR ?? '/usr/share/fonts';
    filterParts.push(`[${videoLabel}]ass=filename=${escPath(assPath)}:fontsdir=${escPath(fontDir)}:force_style='FontName=DejaVu Sans'[captioned]`);
  } else if (dt && dt.filters.length) {
    filterParts.push(`[${videoLabel}]${dt.filters.join(',')}[captioned]`);
  } else {
    filterParts.push(`[${videoLabel}]null[captioned]`);
  }
  videoLabel = 'captioned';
  filterParts.push(`[${videoLabel}]format=yuv420p[vout]`);
  videoLabel = 'vout';

  // Audio graph
  const musicId: MusicId = p.config.musicMood ?? 'lofi';
  const hasSourceAudio = p.media.hasAudio && !p.applied.includes('mute_music') && !p.applied.includes('replace_music');
  if (hasSourceAudio) {
    filterParts.push('[0:a]aresample=48000,asetpts=PTS-STARTPTS,atrim=duration=' + duration + '[voice]');
  } else {
    filterParts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${duration}[voice]`);
  }
  let voice = 'voice';
  if (p.voiceoverPath && fs.existsSync(p.voiceoverPath)) {
    args.push('-i', p.voiceoverPath);
    filterParts.push(`[${args.length - 1}:a]aresample=48000,volume=1.3,atrim=duration=${duration}[vo]`);
    filterParts.push(`[${voice}][vo]amix=inputs=2:duration=first:dropout_transition=0[voiced]`);
    voice = 'voiced';
  }
  if (p.config.music || p.applied.includes('replace_music')) {
    const musicFile = path.join(process.cwd(), 'public', 'audio', `${musicId}.wav`);
    args.push('-stream_loop', '-1', '-i', musicFile);
    const mi = args.filter((a) => a === '-i').length - 1;
    const vol = Math.max(0, Math.min(1, p.config.musicVolume ?? 0.25));
    filterParts.push(`[${mi}:a]aresample=48000,volume=${vol.toFixed(3)},atrim=duration=${duration}[music]`);
    filterParts.push(`[music][${voice}]sidechaincompress=threshold=0.02:ratio=4:attack=20:release=260[ducked]`);
    filterParts.push(`[${voice}][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`);
    audioLabel = 'aout';
  } else {
    filterParts.push(`[${voice}]anull[aout]`);
    audioLabel = 'aout';
  }

  args.push('-filter_complex', filterParts.join(';'));
  args.push('-map', `[${videoLabel}]`, '-map', `[${audioLabel}]`);
  args.push('-t', String(duration));
  args.push('-c:v', 'libx264', '-preset', process.env.SPLICE_PRESET ?? 'veryfast', '-crf', p.config.resolution === 1080 ? '23' : '25');
  args.push('-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000');
  args.push('-movflags', '+faststart', '-max_muxing_queue_size', '1024', p.output);

  try {
    await runChecked(FFMPEG, args, { timeoutMs: 30 * 60_000 });
  } catch (e) {
    console.error('splice render filter failed:', e instanceof Error ? e.message.slice(-3000) : String(e).slice(-3000));
    // Retry once with a plain passthrough for environments with unusual build flags.
    const simple = [...args];
    const idx = simple.indexOf('-filter_complex');
    if (idx >= 0) simple.splice(idx, 2);
    const mapIdx = simple.indexOf('-map');
    if (mapIdx >= 0) simple.splice(mapIdx, 4, '-map', '0:v:0', '-map', '0:a:0?');
    await runChecked(FFMPEG, simple, { timeoutMs: 30 * 60_000 }).catch(() => { throw e; });
  }

  // Best-effort cleanup of only our generated helper files.
  await Promise.all([
    fsp.rm(cmdPath, { force: true }), fsp.rm(assPath, { force: true }),
    ...(dt?.files.map((f) => fsp.rm(f, { force: true })) ?? []),
  ]);
  return p.output;
}

export async function makeThumb(video: string, out: string): Promise<void> {
  await runChecked(FFMPEG, ['-y', '-ss', '0.5', '-i', video, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '5', out], { timeoutMs: 60_000 }).catch(() => { /* optional */ });
}

export function wordRange(transcript: Transcript, span: Span): Word[] {
  return transcript.words.filter((w) => w.end > span.start && w.start < span.end);
}
