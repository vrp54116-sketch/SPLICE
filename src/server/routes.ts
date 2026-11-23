import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { config, modes, publicEnv } from './config';
import { AppError, fail, typedError } from './errors';
import { assertDownloadable, getAsset } from './lib/assets';
import { downloadVideo, probeUrl, validateVideoUrl, ytdlpVersion } from './lib/importer';
import { cancelJob, createJob, getJob, queue, step, errorJob, subscribe } from './lib/jobs';
import { completeUpload, fileForRef, initUpload, writeChunk } from './lib/uploads';
import { probe } from './pipeline/render';
import { runPipeline } from './pipeline/pipeline';
import { repairPlans, scan, type RightsInput } from './pipeline/rights';
import { analyzeFrames, pcmToFloat } from './pipeline/dsp';
import { extractAudio } from './pipeline/render';
import { BACKGROUNDS, MUSIC, type OffloadResult, type ProjectConfig, type ShieldReport } from '@shared/types';
import { keysFromHeader } from './lib/keys';
import { listKeyFailures } from './lib/keyStatus';
import { testProvider } from './lib/providers';
import { uid, safeName } from './lib/util';

const S = {
  initUpload: z.object({ name: z.string().min(1).max(255), size: z.number().int().positive(), hash: z.string().regex(/^[a-f0-9]{64}$/) }),
  chunk: z.object({ id: z.string().min(1), index: z.number().int().nonnegative(), hash: z.string().regex(/^[a-f0-9]{64}$/) }),
  complete: z.object({ id: z.string().min(1) }),
  url: z.object({ url: z.string().min(4).max(2048) }),
  probe: z.object({ ref: z.string().min(1), url: z.string().url().optional() }),
  createProject: z.object({
    projectId: z.string().optional(),
    config: z.custom<ProjectConfig>((v) => Boolean(v && typeof v === 'object')),
  }),
  evidence: z.object({ sourceRef: z.string().min(1), offload: z.custom<OffloadResult>((v) => Boolean(v && typeof v === 'object')) }),
  rightsAnalyze: z.object({
    clipId: z.string().min(1), span: z.object({ start: z.number().nonnegative(), end: z.number().positive() }),
    config: z.custom<ProjectConfig>((v) => Boolean(v && typeof v === 'object')),
  }),
  rightsRepair: z.object({ clipId: z.string().min(1), actions: z.array(z.enum(['mute_music', 'replace_music', 'trim_span', 'blur_roi', 'crop_overlay', 'add_attribution', 'add_voiceover', 'regenerate_meta'])).min(1), confirmation: z.boolean().optional() }),
  recut: z.object({ clipId: z.string().min(1), start: z.number().nonnegative(), end: z.number().positive(), note: z.string().optional() }),
  publish: z.object({ clipIds: z.array(z.string().min(1)).min(1), platform: z.string().optional() }),
  keyTest: z.object({ provider: z.enum(['tokenharbor', 'groq', 'gemini', 'openai-compatible', 'deepgram', 'assemblyai', 'audd', 'acrcloud']) }),
};

const evidence = new Map<string, OffloadResult>();
const reports = new Map<string, ShieldReport>();
const confirmations = new Map<string, boolean>();

function json<T>(reply: FastifyReply, code: number, body: T) { return reply.code(code).send(body); }

const keysFor = (req: FastifyRequest) => keysFromHeader(req.headers['x-splice-keys']);

function guard(req: FastifyRequest) {
  if (!config.apiToken) return;
  const h = req.headers.authorization;
  if (h !== `Bearer ${config.apiToken}`) fail('PRIVATE', 'This server requires an API token. Set it in Settings.');
}

export async function registerRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/api/') && !req.url.startsWith('/api/health')) guard(req);
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return json(reply, 403, { error: err.toJSON() });
    const t = typedError(err);
    const status = t.code === 'RIGHTS_BLOCKED' ? 403 : t.code === 'RATE_LIMIT' ? 429 : t.code === 'SERVER_BUSY' ? 503 : 400;
    return json(reply, status, { error: t });
  });

  const probeHits = new Map<string, number[]>();
  app.get('/api/health', async (req) => ({
    status: 'ok',
    ytdlpVersion: await ytdlpVersion(),
    ffmpeg: (await import('./pipeline/render')).FFMPEG,
    busy: queue.pending > 0 || queue.size > 0,
    queueSize: queue.size,
    ...modes(keysFor(req)),
    keyFailures: listKeyFailures(),
    localAsr: (await import('./lib/providers')).localAsrAvailable(),
    uptime: Math.round((Date.now() - config.startedAt) / 1000),
    storageLimitGb: config.maxUploadGb,
    maxDurationMin: 120,
  }));
  app.get('/api/modes', async (req) => ({ ...publicEnv(keysFor(req)), ...modes(keysFor(req)) }));

  app.post('/api/keys/test', async (req) => {
    const b = S.keyTest.parse(req.body);
    try {
      await testProvider(b.provider, keysFor(req));
      return { ok: true, provider: b.provider, message: 'Working' };
    } catch (e) {
      fail('KEY_INVALID', `${b.provider} key is not working: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  /* ------------------------------------------------------------- upload */
  app.post('/api/upload/init', async (req, reply) => {
    const b = S.initUpload.parse(req.body);
    return json(reply, 200, initUpload(b.name, b.size, b.hash));
  });
  app.post('/api/upload/chunk', async (req, reply) => {
    const b = S.chunk.parse(req.body);
    const data = Buffer.isBuffer(req.body) ? req.body : ((req.body as { data?: string }).data ? Buffer.from((req.body as { data: string }).data, 'base64') : Buffer.alloc(0));
    const body = (req.body as Record<string, unknown>);
    const chunk = typeof body.chunk === 'string' ? Buffer.from(body.chunk, 'base64') : data;
    if (!chunk.length) fail('VALIDATION', 'Send the chunk bytes as base64 in the `chunk` field.');
    return json(reply, 200, await writeChunk(b.id, b.index, b.hash, chunk));
  });
  app.post('/api/upload/complete', async (req, reply) => {
    const b = S.complete.parse(req.body);
    const up = await completeUpload(b.id);
    const info = await probe(up.path);
    if (info.duration > 120 * 60) fail('TOO_LARGE', 'This file is longer than 120 minutes. Upload a trimmed copy.');
    return json(reply, 200, { ref: up.ref, name: up.name, duration: info.duration, width: info.width, height: info.height, hasAudio: info.hasAudio });
  });

  /* ------------------------------------------------------------- import */
  app.post('/api/import', async (req, reply) => {
    const b = S.url.parse(req.body);
    validateVideoUrl(b.url);
    const meta = await probeUrl(b.url);
    return json(reply, 200, { ...meta, url: b.url });
  });
  app.post('/api/probe', async (req, reply) => {
    const b = S.probe.parse(req.body);
    const ip = req.ip;
    const now = Date.now();
    const hits = (probeHits.get(ip) ?? []).filter((t) => now - t < 60_000);
    if (hits.length >= config.probeRate) fail('RATE_LIMIT', 'Ten probes per minute is the limit. Wait a moment and retry.');
    hits.push(now); probeHits.set(ip, hits);
    if (b.url) {
      const meta = await probeUrl(b.url);
      return json(reply, 200, { kind: 'youtube', ...meta, url: b.url });
    }
    const file = await fileForRef(b.ref);
    const info = await probe(file);
    return json(reply, 200, { kind: 'upload', ref: b.ref, duration: info.duration, width: info.width, height: info.height, hasAudio: info.hasAudio, letterbox: info.letterbox, pillarbox: info.pillarbox });
  });

  /* -------------------------------------------------------------- jobs */
  app.post('/api/projects', async (req, reply) => {
    const b = S.createProject.parse(req.body);
    const cfg = b.config;
    if (!cfg?.source) fail('VALIDATION', 'A source is required. Upload a file or paste a video URL.');
    if (!cfg.attestation) fail('RIGHTS_BLOCKED', 'Choose a source attestation before starting.');
    const job = createJob(b.projectId);
    const keys = keysFor(req);
    void queue.add(async () => {
      try {
        step(job.id, 'ingest', 1, 'Fetching source');
        let mediaPath: string, meta: { title?: string; channel?: string; license?: string; description?: string } = {};
        if (cfg.source.kind === 'youtube') {
          const url = cfg.source.url ?? cfg.source.ref;
          const imported = await downloadVideo(url);
          mediaPath = imported.path;
          meta = { title: imported.title, channel: imported.channel, license: imported.license, description: imported.description };
        } else {
          mediaPath = await fileForRef(cfg.source.ref);
          meta = { title: cfg.source.filename };
        }
        const info = await probe(mediaPath);
        const saved = evidence.get(cfg.source.ref);
        if (saved) cfg.source.offload = saved;
        const clips = await runPipeline(job, cfg, mediaPath, info, meta, keys);
        void clips;
      } catch (e) {
        if (!job.controller.signal.aborted) errorJob(job.id, typedError(e));
      }
    }).catch((e) => errorJob(job.id, typedError(e)));
    return json(reply, 202, { jobId: job.id, queuePosition: queue.size + 1 });
  });

  app.get('/api/jobs/:id', async (req) => {
    const job = getJob((req.params as { id: string }).id);
    if (!job) fail('NOT_FOUND', 'Job not found. It may have expired after 45 minutes.');
    return job!.state;
  });
  app.get('/api/jobs/:id/events', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!getJob(id)) fail('NOT_FOUND', 'Job not found.');
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive', 'x-accel-buffering': 'no',
    });
    reply.raw.write(': connected\n\n');
    const send = (event: string, data: unknown) => { try { reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ } };
    const unsub = subscribe(id, (e) => send(e.type === 'state' ? 'state' : e.type, e));
    const hb = setInterval(() => { try { reply.raw.write(': heartbeat\n\n'); } catch { /* closed */ } }, 15_000);
    req.raw.on('close', () => { clearInterval(hb); unsub(); try { reply.raw.end(); } catch { /* ignore */ } });
    return reply;
  });
  app.post('/api/jobs/:id/cancel', async (req) => {
    const ok = cancelJob((req.params as { id: string }).id);
    if (!ok) fail('NOT_FOUND', 'Job not found.');
    return { ok: true };
  });
  app.post('/api/jobs/:id/recut', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const b = S.recut.parse(req.body);
    const old = getJob(id);
    if (!old) fail('NOT_FOUND', 'Job not found.');
    const cfg = (old.state.clips?.find((c) => c.id === b.clipId)?.configSnapshot) as ProjectConfig | undefined;
    if (!cfg) fail('NOT_FOUND', 'This clip has no configuration snapshot to recut.');
    cfg.timeframe = { start: Math.max(0, b.start - 1), end: b.end + 1 };
    const job = createJob(old.state.projectId);
    const keys = keysFor(req);
    void queue.add(async () => {
      try {
        const mediaPath = cfg.source.kind === 'youtube' ? (await downloadVideo(cfg.source.url ?? cfg.source.ref)).path : await fileForRef(cfg.source.ref);
        const info = await probe(mediaPath);
        await runPipeline(job, cfg, mediaPath, info, { title: cfg.source.title }, keys);
      } catch (e) { if (!job.controller.signal.aborted) errorJob(job.id, typedError(e)); }
    });
    return json(reply, 202, { jobId: job.id, note: b.note ?? 'Recut from the editor' });
  });

  /* ------------------------------------------------------------ assets */
  app.get('/api/assets/:id', async (req, reply) => {
    const rec = getAsset((req.params as { id: string }).id);
    assertDownloadable(rec);
    const stat = await fsp.stat(rec.path);
    const range = req.headers.range;
    const name = rec.name ?? path.basename(rec.path);
    reply.header('accept-ranges', 'bytes');
    reply.header('content-disposition', `inline; filename="${safeName(name)}"`);
    reply.header('x-content-type-options', 'nosniff');
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      if (!m) fail('VALIDATION', 'Malformed range header.');
      const start = Math.min(stat.size - 1, Number(m[1]));
      const end = Math.min(stat.size - 1, m[2] ? Number(m[2]) : start + 4 * 1024 * 1024);
      reply.code(206).header('content-range', `bytes ${start}-${end}/${stat.size}`).header('content-length', String(end - start + 1)).type(rec.mime);
      return reply.send(fs.createReadStream(rec.path, { start, end }));
    }
    reply.header('content-length', String(stat.size)).type(rec.mime);
    return reply.send(fs.createReadStream(rec.path));
  });

  /* ------------------------------------------------------ rights API */
  app.post('/api/rights/evidence', async (req, reply) => {
    const b = S.evidence.parse(req.body);
    evidence.set(b.sourceRef, b.offload);
    return json(reply, 200, { ok: true, frames: b.offload.frames.length, engine: b.offload.engine });
  });
  app.post('/api/rights/analyze', async (req, reply) => {
    const b = S.rightsAnalyze.parse(req.body);
    const cfg = b.config;
    const audio = path.join(config.scratch, `analyze-${uid()}.pcm`);
    const ref = cfg.source.kind === 'youtube' ? cfg.source.ref : cfg.source.ref;
    try {
      const file = cfg.source.kind === 'youtube' ? (await downloadVideo(cfg.source.url ?? ref)).path : await fileForRef(ref);
      await extractAudio(file, audio);
      const frames = analyzeFrames(pcmToFloat(await fsp.readFile(audio)));
      const input: RightsInput = {
        span: b.span, duration: b.span.end, frames,
        offload: evidence.get(ref) ?? cfg.source.offload,
        transcript: { words: [], text: '', mode: 'none' },
        metadata: { title: cfg.source.title, license: cfg.source.license, filename: cfg.source.filename ?? cfg.source.url },
        source: cfg.source, config: cfg,
        fingerprints: { full: null, head: null, tail: null },
        clipId: b.clipId, version: 1, pass: 1,
      };
      const report = scan(input);
      reports.set(b.clipId, report);
      return json(reply, 200, report);
    } finally { await fsp.rm(audio, { force: true }); }
  });
  app.post('/api/rights/repair', async (req, reply) => {
    const b = S.rightsRepair.parse(req.body);
    const report = reports.get(b.clipId);
    if (!report) fail('NOT_FOUND', 'No rights report for this clip yet. Run an analysis first.');
    if (b.confirmation) confirmations.set(b.clipId, true);
    return json(reply, 200, { actions: b.actions, plans: repairPlans(report), confirmation: confirmations.get(b.clipId) === true });
  });
  app.get('/api/rights/report/:clipId', async (req) => {
    const report = reports.get((req.params as { clipId: string }).clipId);
    if (!report) fail('NOT_FOUND', 'No saved rights report for this clip.');
    return report;
  });
  app.get('/api/rights/list', async () => [...reports.values()]);

  /* ----------------------------------------------------------- extras */
  app.get('/api/backgrounds', async () => BACKGROUNDS);
  app.get('/api/music', async () => MUSIC);
  app.get('/api/captions/:id', async (req, reply) => {
    const rec = getAsset((req.params as { id: string }).id);
    assertDownloadable(rec);
    const fmt = String((req.query as { fmt?: string }).fmt ?? 'srt');
    if (!['srt', 'vtt', 'ass'].includes(fmt)) fail('VALIDATION', 'Use fmt=srt, vtt or ass.');
    return reply.type(fmt === 'vtt' ? 'text/vtt' : 'text/plain').send(await fsp.readFile(rec.path));
  });

  app.post('/api/publish/kit', async (req, reply) => {
    const b = S.publish.parse(req.body);
    const kit = [];
    for (const id of b.clipIds) {
      const rec = getAsset(id);
      assertDownloadable(rec);
      kit.push({
        clipId: rec.rights?.clipId ?? id,
        mp4: `/api/assets/${rec.id}`,
        srt: `/api/captions/${id}?fmt=srt`,
        cover: `/api/assets/${id}`,
        metadata: {
          title: safeName(rec.name ?? 'splice-clip'),
          description: reportForKi(rec.rights?.clipId),
          hashtags: ['#shorts', '#splice'],
          platform: b.platform ?? 'youtube',
        },
      });
    }
    return json(reply, 200, { kit, ics: buildIcs(kit), note: 'Import this kit into your own scheduler. No account required.' });
  });
  app.post('/api/publish/youtube', async (req) => {
    S.publish.parse(req.body);
    if (!config.youtube.clientId || !config.youtube.clientSecret) fail('ENGINE_UNAVAILABLE', 'No YouTube OAuth credentials are configured. Export a Publish Kit instead — the app works fully without them.');
    fail('ENGINE_UNAVAILABLE', 'Upload requires a completed OAuth token exchange for this instance. Use the Publish Kit path for a fully free, accountless workflow.');
  });
}

function reportForKi(clipId?: string) {
  const r = clipId ? reports.get(clipId) : undefined;
  return r?.forcedAttribution ? `${r.forcedAttribution}\n\nMade with SPLICE.` : 'Made with SPLICE.';
}
function buildIcs(kit: Array<{ metadata: { title: string } }>) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SPLICE//Social Scheduler//EN'];
  kit.forEach((k, i) => {
    const d = new Date(Date.now() + (i + 1) * 86400000).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    lines.push('BEGIN:VEVENT', `UID:splice-${uid()}@local`, `DTSTAMP:${d}`, `DTSTART:${d}`, `SUMMARY:${k.metadata.title}`, 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
