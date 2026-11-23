import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type {
  ClipRecord, Moment, OffloadResult, ProjectConfig, RepairAction, ShieldReport, Span, Transcript, ShieldTier,
} from '@shared/types';
import { config } from '../config';
import { fail } from '../errors';
import { putAsset, putBufferAsset } from '../lib/assets';
import { finishJob, progress, step, type Job } from '../lib/jobs';
import { fingerprint, localAsrAvailable, suggestMoments, transcribe, asrMode } from '../lib/providers';
import { uid } from '../lib/util';
import { analyzeFrames, pcmToFloat, type FrameFeatures } from './dsp';
import { sampleFrames } from './frames';
import { extractAudio, makeProxy, makeThumb, renderBackground, renderClip, type MediaInfo } from './render';
import { repairPlans, scan, type RightsInput } from './rights';
import { findMoments } from './score';
import { toSrt, toVtt } from './captions';

interface SourceMeta {
  title?: string; channel?: string; license?: string; description?: string; url?: string;
}

const slicePcm = (src: string, dst: string, start: number, end: number) => {
  const buf = fs.readFileSync(src);
  const from = Math.max(0, Math.floor(start * 16000 * 2));
  const to = Math.min(buf.length, Math.ceil(end * 16000 * 2));
  fs.writeFileSync(dst, buf.subarray(from, to));
};

const OFFLOAD_FALLBACK = (frames: Awaited<ReturnType<typeof sampleFrames>>): OffloadResult => ({
  frames: frames.map((f) => ({ ...f, saliency: f.saliency ?? { x: 0.5, y: 0.5 } })),
  engine: 'fallback', faceEngine: 'frame-diff saliency (server)', ocrEngine: 'unavailable — no browser offload',
});

export async function runPipeline(job: Job, cfg: ProjectConfig, mediaPath: string, media: MediaInfo, sourceMeta: SourceMeta): Promise<ClipRecord[]> {
  const dir = path.join(config.scratch, 'jobs', job.id);
  await fsp.mkdir(dir, { recursive: true });
  const signal = job.controller.signal;
  if (signal.aborted) fail('EXTRACT_FAILED', 'Job stopped before ingest.');

  // 1 — INGEST -----------------------------------------------------------
  step(job.id, 'ingest', 1, 'Fetching and preparing source');
  const proxy = path.join(dir, 'proxy.mp4');
  await makeProxy(mediaPath, proxy, media.duration);
  if (signal.aborted) fail('EXTRACT_FAILED', 'Job stopped during preparation.');

  // 2 — TRANSCRIBE -------------------------------------------------------
  step(job.id, 'transcribe', 2, 'Listening for words');
  const fullPcm = path.join(dir, 'full.pcm');
  await extractAudio(mediaPath, fullPcm, 0, Math.min(media.duration, 7200));
  let transcript: Transcript = { words: [], text: '', mode: 'none' };
  try {
    if (asrMode() !== 'local-basic' || localAsrAvailable()) transcript = await transcribe(fullPcm, cfg.language, signal);
    else progress(job.id, { message: 'Local basic transcription unavailable — scoring from audio, shots and offload only.' });
  } catch (e) {
    progress(job.id, { message: 'Transcription engine unavailable — continuing with audio-only scoring and no invented captions.' });
    void e;
  }

  // 3 — ANALYZE ----------------------------------------------------------
  step(job.id, 'analyze', 3, 'Finding shots and reading frames');
  const frames: FrameFeatures[] = analyzeFrames(pcmToFloat(await fsp.readFile(fullPcm)));
  const offload: OffloadResult = cfg.source.offload ?? OFFLOAD_FALLBACK(await sampleFrames(proxy, 2));
  const shots = await import('./render').then((m) => m.detectShots(proxy));

  // 4 — SCORE ------------------------------------------------------------
  step(job.id, 'score', 4, 'Finding the best moments');
  const window = { start: cfg.timeframe.start, end: Math.min(cfg.timeframe.end, media.duration) };
  const target = targetSeconds(cfg);
  const coarse = coarseSpans(window, target);
  const fingerprints = await fingerprintsFor(fullPcm, window);
  const baseRightsInput = (span: Span, clipId: string, version: number, pass: number, applied: RepairAction[] = [], off = offload, fr = frames): RightsInput => ({
    span, duration: media.duration, frames: fr, offload: off, transcript,
    metadata: { title: sourceMeta.title, description: sourceMeta.description, license: sourceMeta.license, filename: cfg.source.filename || cfg.source.url },
    source: cfg.source, config: cfg, fingerprints,
    bars: { letterbox: media.letterbox, pillarbox: media.pillarbox },
    applied, clipId, version, pass,
    voiceoverCoverage: cfg.voiceoverRef ? 0.3 : 0,
  });
  const risks = coarse.map((span) => {
    const report = scan(baseRightsInput(span, 'pre_' + Math.round(span.start), 1, 0));
    return { span, report, repairable: repairPlans(report).length > 0 };
  });
  const llm = await suggestMoments({
    transcript, shots, duration: media.duration, count: cfg.clipCount,
    targetSeconds: target, clipType: cfg.clipType, language: cfg.language,
  });
  const moments = findMoments({
    transcript, frames, shots, offload, duration: media.duration, config: cfg, targetSeconds: target, risks,
  }, llm.moments);
  if (!moments.length) fail('EXTRACT_FAILED', 'No usable moments were found in the requested timeframe. Widen the timeframe or choose a different clip type.');

  // 5 + 6 — RENDER & RIGHTS ---------------------------------------------
  const clips: ClipRecord[] = [];
  let background: string | undefined;
  if (cfg.splitScreen && cfg.backgrounds.length) {
    const dim = dimensionsFor(cfg);
    background = await renderBackground(cfg.backgrounds[0]!, target, dim.w, dim.h);
  }

  for (let i = 0; i < moments.length; i++) {
    if (signal.aborted) fail('EXTRACT_FAILED', 'Job stopped during rendering.');
    const m = moments[i]!;
    step(job.id, 'render', 5, `Rendering clip ${i + 1} of ${moments.length}`, Math.round(((i + 0.2) / moments.length) * 78) + 8);
    const clipId = `clip_${uid()}`;
    const pre = risks.find((r) => r.span.start <= m.start && r.span.end >= m.end)?.report
      ?? scan(baseRightsInput({ start: m.start, end: m.end }, clipId, 1, 0));
    const applied: RepairAction[] = [];
    for (const plan of repairPlans(pre)) {
      if (plan.requiresConfirmation && cfg.rightsPolicy !== 'own_content') continue;
      applied.push(plan.action);
    }
    if (pre.tier === 'BLOCKED' && pre.params.some((p) => p.hardBlock && !repairPlans(pre).some((r) => r.clears.includes(p.id)))) {
      // Hard-blocked and unrepairable: record it as blocked but do not deliver the video.
      const report = scan(baseRightsInput({ start: m.start, end: m.end }, clipId, 1, 0, applied));
      const stub = await writeClip(job.id, m, i + 1, cfg, transcript, '', '', report, sourceMeta, applied, media, true);
      clips.push(stub);
      continue;
    }

    let report: ShieldReport = pre;
    let output = '';
    for (let pass = 1; pass <= 3; pass++) {
      step(job.id, 'rights', 6, `CLAIM SHIELD pass ${pass} of 3`, Math.round(((i + 0.6 + pass * 0.1) / moments.length) * 78) + 8);
      output = path.join(dir, `${clipId}_v${pass}.mp4`);
      await renderClip({
        input: mediaPath, output, span: { start: m.start, end: m.end }, config: cfg,
        transcript, offload, media, applied, hookText: m.hook,
        voiceoverPath: cfg.voiceoverRef ? await voiceoverPath(cfg.voiceoverRef) : undefined,
        backgroundPath: background,
      });
      // Re-scan the ACTUAL rendered file: its audio and its pixels.
      const renderedPcm = path.join(dir, `${clipId}_v${pass}.pcm`);
      await extractAudio(output, renderedPcm, 0, m.end - m.start);
      const renderedFrames = analyzeFrames(pcmToFloat(await fsp.readFile(renderedPcm)));
      const renderedOffload = OFFLOAD_FALLBACK(await sampleFrames(output, 2));
      const carriedOcr = offload.frames.filter((f) => f.t >= m.start && f.t <= m.end && !applied.includes('blur_roi') && !applied.includes('crop_overlay')).flatMap((f) => f.ocr ?? []);
      for (const f of renderedOffload.frames) f.ocr = [...new Set(carriedOcr)].slice(0, 5);
      report = scan(baseRightsInput({ start: 0, end: m.end - m.start }, clipId, pass, pass, applied, renderedOffload, renderedFrames));
      if (report.tier === 'CLEAR') break;
      if (pass > 1 && Math.abs(report.risk - (clips.at(-1)?.report.risk ?? 100)) < 5) break;
      const plans = repairPlans(report).filter((p) => !p.requiresConfirmation || cfg.rightsPolicy === 'own_content');
      const next = plans[0];
      if (!next || applied.includes(next.action)) break;
      applied.push(next.action);
      if (next.action === 'trim_span') {
        const sentence = m.end - Math.min(3, (m.end - m.start) * 0.12);
        m.end = Math.max(m.start + 8, sentence);
      }
    }
    clips.push(await writeClip(job.id, m, i + 1, cfg, transcript, output, '', report, sourceMeta, applied, media, false));
    progress(job.id, { pct: Math.round(((i + 1) / moments.length) * 78) + 20, message: `Clip ${i + 1} of ${moments.length} screened ${report.tier.toLowerCase()}` });
  }

  finishJob(job.id, clips);
  return clips;
}

async function voiceoverPath(ref: string): Promise<string | undefined> {
  // Uploaded commentary is stored as an upload ref; the browser posts it via /api/upload.
  try { return await import('../lib/uploads').then((m) => m.fileForRef(ref)); } catch { return undefined; }
}

function dimensionsFor(cfg: ProjectConfig) {
  const base = cfg.resolution;
  if (cfg.aspect === '9:16') return { w: base, h: Math.round(base * 16 / 9 / 2) * 2 };
  if (cfg.aspect === '16:9') return { w: Math.round(base * 16 / 9 / 2) * 2, h: base };
  return { w: base, h: base };
}

function targetSeconds(cfg: ProjectConfig): number {
  return cfg.duration === 'short' ? 28 : cfg.duration === 'medium' ? 50 : cfg.duration === 'long' ? 100 : cfg.duration === 'extended' ? 160 : 55;
}

function coarseSpans(window: Span, target: number): Span[] {
  const out: Span[] = [];
  for (let t = window.start; t + target * 0.7 <= window.end; t += Math.max(3, target * 0.6)) out.push({ start: t, end: Math.min(window.end, t + target) });
  if (!out.length) out.push({ ...window });
  return out.slice(0, 40);
}

async function fingerprintsFor(pcm: string, window: Span) {
  const head = path.join(path.dirname(pcm), 'head.pcm'), tail = path.join(path.dirname(pcm), 'tail.pcm');
  slicePcm(pcm, head, window.start, Math.min(window.start + 5, window.start + 60));
  slicePcm(pcm, tail, Math.max(window.start, window.end - 5), window.end);
  return {
    full: await fingerprint(pcm, window),
    head: await fingerprint(head, { start: window.start, end: window.start + 5 }),
    tail: await fingerprint(tail, { start: window.end - 5, end: window.end }),
  };
}

function tierStatus(tier: ShieldTier): ClipRecord['status'] {
  return tier === 'CLEAR' ? 'ready' : tier === 'REVIEW' ? 'review' : 'blocked';
}

async function writeClip(
  jobId: string, m: Moment, rank: number, cfg: ProjectConfig, transcript: Transcript,
  videoPath: string, _unused: string, report: ShieldReport, sourceMeta: SourceMeta,
  _applied: RepairAction[], media: MediaInfo, blocked: boolean,
): Promise<ClipRecord> {
  const clipId = report.clipId;
  const duration = Math.max(1, m.end - m.start);
  const asset = videoPath
    ? await putAsset(videoPath, 'video', {
      name: `${cfg.filenameTemplate.replace(/\{title\}/g, m.title).replace(/\{rank\}/g, String(rank)).replace(/[^a-z0-9\-_.]/gi, '-')}.mp4`,
      rights: { tier: report.tier, confirmation: report.tier === 'REVIEW' ? cfg.rightsPolicy !== 'strict' : undefined, clipId },
    })
    : null;
  const thumbPath = path.join(path.dirname(videoPath || path.join(config.scratch, 'jobs', jobId)), `${clipId}_thumb.jpg`);
  if (videoPath) await makeThumb(videoPath, thumbPath);
  const thumb = videoPath && fs.existsSync(thumbPath)
    ? putBufferAsset(await fsp.readFile(thumbPath), 'thumb', '.jpg', { rights: { tier: blocked ? 'BLOCKED' : report.tier, clipId } }) : null;
  const srt = putBufferAsset(Buffer.from(toSrt(transcript, { style: cfg.captionStyle, width: 1080, height: 1920, start: m.start, end: m.end })), 'caption', '.srt', { rights: { tier: report.tier, clipId } });
  const vtt = putBufferAsset(Buffer.from(toVtt(transcript, { style: cfg.captionStyle, width: 1080, height: 1920, start: m.start, end: m.end })), 'caption', '.vtt', { rights: { tier: report.tier, clipId } });
  const rptAsset = putBufferAsset(Buffer.from(JSON.stringify(report, null, 2)), 'report', '.json', { rights: { tier: report.tier, clipId } });

  void srt; void vtt; void rptAsset; void media;
  return {
    id: clipId, jobId, version: report.version, rank,
    title: m.title, hook: m.hook, why: m.why, improvements: m.improvements,
    virality: m.score, start: m.start, end: m.end, duration,
    aspect: cfg.aspect, captionStyle: cfg.captionStyle,
    assetId: asset?.id ?? '', thumbId: thumb?.id ?? '',
    transcript: { words: transcript.words.filter((w) => w.end > m.start && w.start < m.end).map((w) => ({ ...w, start: w.start - m.start, end: w.end - m.start })), text: transcript.text, mode: transcript.mode },
    report,
    status: blocked ? 'blocked' : tierStatus(report.tier),
    favorite: false, published: false, demo: false, createdAt: Date.now(),
    sourceTitle: sourceMeta.title ?? cfg.source.filename ?? 'Imported video',
    configSnapshot: cfg,
    versions: asset ? [{ version: report.version, assetId: asset.id, reportId: report.id, createdAt: Date.now() }] : [],
  };
}
