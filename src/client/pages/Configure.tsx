import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight, Check, ChevronDown, CircleCheck, FileVideo, Link2, Loader2,
  Pause, Play, RotateCcw, Shuffle, UploadCloud, WandSparkles, X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  BACKGROUNDS, CAPTION_STYLES, MUSIC, type Aspect, type BackgroundId, type CaptionStyle,
  type DurationBucket, type Language, type MusicId, type ProjectConfig, type Source,
} from '@shared/types';
import { useApp } from '../store/useApp';
import { api, ApiError } from '../lib/api';
import { sound } from '../lib/sound';
import { analyzeVideo } from '../offload/vision';
import { Card, Eyebrow, InfoNote, Segmented, SelectSearch, ShieldBadge, Toggle } from '../components/ui';
import { motionPrefs } from '../components/Shell';

const CLIP_TYPES = [
  { value: 'viral', label: 'Viral Clips' }, { value: 'phrase', label: 'Memorable Phrases' },
  { value: 'topic', label: 'Topic Clips' }, { value: 'trailer', label: 'Trailer' },
  { value: 'funny', label: 'Funny Moments' }, { value: 'podcast', label: 'Podcast Jokes' },
  { value: 'tutorial', label: 'Tutorial Steps' }, { value: 'motivational', label: 'Motivational' },
  { value: 'storytime', label: 'Storytime' }, { value: 'product', label: 'Product Highlights' },
  { value: 'speaker', label: 'Speaker Insights' },
] as const;
const LANGUAGES = [
  { value: 'auto', label: 'Auto-detect' }, { value: 'en', label: 'English' }, { value: 'hi', label: 'Hindi' },
  { value: 'hinglish', label: 'Hinglish' }, { value: 'es', label: 'Spanish' }, { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' }, { value: 'it', label: 'Italian' }, { value: 'pt', label: 'Portuguese' },
  { value: 'ja', label: 'Japanese' }, { value: 'ko', label: 'Korean' }, { value: 'ar', label: 'Arabic' },
] as const;
const ATTESTATIONS = [
  { value: 'owned', label: 'I own this — I made it or hold the rights', hint: 'Risk −30' },
  { value: 'licensed', label: 'Licensed, with proof available', hint: 'Risk −30' },
  { value: 'public_domain', label: 'Public domain', hint: 'Risk −35' },
  { value: 'cc', label: 'Creative Commons — attribution required', hint: 'Risk −35, forced attribution' },
  { value: 'unknown', label: 'Third-party source, rights unknown', hint: 'Risk +25' },
] as const;

function parseTime(v: string): number | null {
  const s = v.trim(); if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const p = s.split(':').map(Number);
  if (p.some((n) => !Number.isFinite(n)) || p.length > 3) return null;
  return p.reduce((a, n) => a * 60 + n, 0);
}
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

async function sha256(buf: ArrayBuffer | Uint8Array) {
  const d = await crypto.subtle.digest('SHA-256', buf as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface UploadState { status: 'idle' | 'uploading' | 'paused' | 'done' | 'error'; sent: number; total: number; error?: string; id?: string }
const CHUNK = 8 * 1024 * 1024;

function SourcePanel({ source, onChange }: { source: Source; onChange: (s: Source) => void }) {
  const [tab, setTab] = useState<'upload' | 'youtube'>(source.kind);
  const [url, setUrl] = useState(source.url ?? '');
  const [probing, setProbing] = useState(false);
  const [preview, setPreview] = useState<{ title: string; channel: string; duration: number; thumbnail: string; license: string; note?: string } | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [upload, setUpload] = useState<UploadState>({ status: 'idle', sent: 0, total: 0 });
  const [offload, setOffload] = useState<{ frame: number; total: number; phase: string } | null>(null);
  const paused = useRef(false);
  const fileRef = useRef<File | null>(null);

  const probe = async (ref: string, link?: string) => {
    const info = await api<{ duration: number }>('/api/probe', { ref, ...(link ? { url: link } : {}) });
    const app = useApp.getState();
    app.setConfig({ timeframe: { start: 0, end: Math.max(1, Math.min(info.duration, app.config.timeframe.end || info.duration)) } });
    toast.success(`Probed ${fmt(info.duration)} source`);
  };

  const doUpload = async (file: File, fromIndex = 0, id?: string) => {
    fileRef.current = file;
    paused.current = false;
    setUpload({ status: 'uploading', sent: fromIndex * CHUNK, total: file.size, id });
    try {
      let uploadId = id;
      if (!uploadId) {
        const init = await api<{ id: string }>('/api/upload/init', { name: file.name, size: file.size, hash: await sha256(await file.arrayBuffer()) });
        uploadId = init.id;
      }
      for (let i = fromIndex; i < Math.ceil(file.size / CHUNK); i++) {
        while (paused.current) await new Promise((r) => setTimeout(r, 150));
        const chunk = file.slice(i * CHUNK, Math.min(file.size, (i + 1) * CHUNK));
        const p = await api<{ received: number }>('/api/upload/chunk', { id: uploadId!, index: i, hash: await sha256(await chunk.arrayBuffer()), chunk: btoa(String.fromCharCode(...new Uint8Array(await chunk.arrayBuffer()))) });
        setUpload((u) => ({ ...u, sent: p.received }));
      }
      const done = await api<{ ref: string; duration: number }>('/api/upload/complete', { id: uploadId! });
      setUpload({ status: 'done', sent: file.size, total: file.size, id: uploadId });
      onChange({ kind: 'upload', ref: done.ref, filename: file.name, duration: done.duration });
      sound.play('paste');
      await probe(done.ref);
      await runOffload(file, done.ref);
    } catch (e) {
      setUpload((u) => ({ ...u, status: 'error', error: e instanceof ApiError ? e.error.message : 'Upload failed' }));
    }
  };

  const runOffload = async (file: File, ref: string) => {
    setOffload({ frame: 0, total: 1, phase: 'Loading browser analysers' });
    try {
      const result = await analyzeVideo(file, (p) => setOffload(p));
      await api('/api/rights/evidence', { sourceRef: ref, offload: result });
      onChange({ kind: 'upload', ref, filename: file.name, ...(useApp.getState().config.source.duration ? { duration: useApp.getState().config.source.duration } : {}), offload: result });
      setOffload(null);
      toast.success(`Browser analysis complete · ${result.frames.length} frames`, { description: result.faceEngine });
    } catch (e) { setOffload(null); toast.warning('Browser offload unavailable — server fallback will read pixels instead.', { description: e instanceof Error ? e.message : '' }); }
  };

  const doProbe = async () => {
    if (!url.trim()) return;
    setProbing(true); setUrlError(null); setPreview(null);
    try {
      const p = await api<{ title: string; channel: string; duration: number; thumbnail: string; license: string; note?: string; url: string }>('/api/import', { url: url.trim() });
      setPreview(p);
      sound.play('paste');
      const ref = p.url;
      onChange({ kind: 'youtube', ref, url, title: p.title, channel: p.channel, duration: p.duration, thumbnail: p.thumbnail, license: p.license });
      const app = useApp.getState();
      app.setConfig({ timeframe: { start: 0, end: Math.max(1, Math.min(p.duration, app.config.timeframe.end || p.duration)) } });
      toast.success('Link ready', { description: p.note ?? `${fmt(p.duration)} · ${p.channel}` });
    } catch (e) { setUrlError(e instanceof ApiError ? e.error.remedy : 'Could not read this link.'); sound.play('blocked'); }
    finally { setProbing(false); }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) { setTab('upload'); void doUpload(f); }
  };

  return <div>
    <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg border border-line bg-bg p-1">
      {(['upload', 'youtube'] as const).map((t) => <button key={t} className={`min-h-[38px] rounded-md text-[13px] font-semibold ${tab === t ? 'bg-splice text-[#0A0D12]' : 'text-muted hover:text-text'}`} onClick={() => { setTab(t); sound.play('click'); }}>
        {t === 'upload' ? 'Upload file' : 'YouTube URL'}
      </button>)}
    </div>

    {tab === 'upload' && <div>
      <label className="flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-line bg-bg/60 px-4 py-8 text-center hover:border-splice/60" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <input type="file" accept="video/mp4,video/quicktime,video/x-matroska,video/webm,video/x-msvideo,.m4v" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void doUpload(f); }} />
        <UploadCloud size={28} className="mb-3 text-splice" />
        <span className="text-[14px] font-semibold">Drop a video here</span>
        <span className="mt-1 text-[12px] text-muted">mp4 · mov · mkv · webm · m4v · avi · up to 2 GB / 120 min</span>
        <span className="mt-4 rounded-md border border-line px-3 py-1.5 text-[12px]">Choose file</span>
      </label>
      {upload.status !== 'idle' && <div className="mt-3 rounded-lg border border-line bg-bg p-3">
        <div className="mb-2 flex items-center justify-between gap-2 text-[12px]">
          <span className="flex min-w-0 items-center gap-2"><FileVideo size={14} className="text-cyan" /><span className="truncate">{fileRef.current?.name}</span></span>
          <span className="mono text-muted">{(upload.sent / 1048576).toFixed(1)} / {(upload.total / 1048576).toFixed(1)} MB</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-line"><motion.div className="h-full bg-splice" animate={{ width: `${upload.total ? upload.sent / upload.total * 100 : 0}%` }} transition={{ duration: .2 }} /></div>
        <div className="mt-2 flex items-center gap-2">
          {upload.status === 'uploading' && <button className="btn !min-h-[30px] !px-2" onClick={() => { paused.current = true; setUpload((u) => ({ ...u, status: 'paused' })); }}><Pause size={13} />Pause</button>}
          {upload.status === 'paused' && <button className="btn btn-primary !min-h-[30px] !px-2" onClick={() => { const f = fileRef.current; if (f) void doUpload(f, Math.floor(upload.sent / CHUNK), upload.id); }}><Play size={13} />Resume</button>}
          {upload.status === 'done' && <span className="flex items-center gap-1.5 text-[12px] text-acid"><CircleCheck size={14} />Uploaded and probed</span>}
          {upload.status === 'error' && <span className="text-[12px] text-danger">{upload.error}</span>}
        </div>
      </div>}
      {offload && <div className="mt-2 flex items-center gap-2 text-[11px] text-cyan"><Loader2 size={13} className="animate-spin" />{offload.phase} · {offload.frame}/{offload.total} frames</div>}
    </div>}

    {tab === 'youtube' && <div>
      <label htmlFor="url-input" className="label">Video or Short URL</label>
      <div className="flex gap-2">
        <input id="url-input" className="field" placeholder="https://www.youtube.com/watch?v=…" value={url}
          onChange={(e) => { setUrl(e.target.value); setUrlError(null); if (source.kind === 'youtube' && source.url !== e.target.value) onChange({ kind: 'youtube', ref: e.target.value, url: e.target.value }); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void doProbe(); }} />
        <button className="btn btn-primary !px-3" onClick={() => void doProbe()} disabled={probing} aria-label="Probe URL">{probing ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}</button>
      </div>
      <div className="helper">Live streams are not supported. Playlists resolve to the first video with a note.</div>
      {urlError && <div className="mt-2 rounded-lg border border-danger/40 bg-danger/5 p-3 text-[12px] leading-relaxed text-danger">{urlError}</div>}
      {preview && <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={motionPrefs()} className="mt-3 flex gap-3 rounded-lg border border-acid/40 bg-acid/5 p-3">
        {preview.thumbnail && <img src={preview.thumbnail} alt="" className="h-20 w-32 shrink-0 rounded object-cover" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2"><div className="truncate text-[13px] font-semibold">{preview.title}</div><button className="icon-btn !h-7 !w-7" aria-label="Remove link" onClick={() => { setPreview(null); setUrl(''); onChange({ kind: 'upload', ref: '', filename: '' }); }}><X size={14} /></button></div>
          <div className="mt-1 text-[11px] text-muted">{preview.channel} · {fmt(preview.duration)}</div>
          {preview.license && <div className="mt-1 text-[10px] text-cyan">License: {preview.license}</div>}
          {preview.note && <div className="mt-1 text-[10px] text-amber">{preview.note}</div>}
          <div className="mt-1 flex items-center gap-1 text-[11px] text-acid"><Check size={12} />Ready to cut</div>
        </div>
      </motion.div>}
    </div>}
  </div>;
}

function Timeframe() {
  const { config, setConfig } = useApp();
  const duration = Math.max(60, config.source.duration ?? 600);
  const [sText, setSText] = useState(fmt(config.timeframe.start));
  const [eText, setEText] = useState(fmt(config.timeframe.end));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setSText(fmt(config.timeframe.start)); setEText(fmt(config.timeframe.end)); }, [config.timeframe.start, config.timeframe.end]);
  const valid = (s: number, e: number) => e - s >= 60 && s >= 0 && e <= duration + 1;
  const apply = (s: number, e: number) => { if (!valid(s, e)) { setInvalid(true); setTimeout(() => setInvalid(false), 500); return; } setInvalid(false); setConfig({ timeframe: { start: s, end: e } }); };
  const onText = () => { const s = parseTime(sText), e = parseTime(eText); if (s === null || e === null) { setInvalid(true); setTimeout(() => setInvalid(false), 500); return; } apply(s, e); };
  return <div className={invalid ? 'animate-[shake_.3s]' : ''}>
    <div className="mb-2 flex items-center justify-between"><span className="label !mb-0">Processing timeframe</span><span className="mono text-[10px] text-cyan">Processing {fmt(config.timeframe.start)}–{fmt(config.timeframe.end)} of {fmt(duration)}</span></div>
    <div className="relative h-8">
      <div className="absolute left-0 right-0 top-3 h-2 rounded-full bg-line" />
      <div className="absolute top-3 h-2 rounded-full bg-splice" style={{ left: `${config.timeframe.start / duration * 100}%`, right: `${100 - config.timeframe.end / duration * 100}%` }} />
      <input type="range" min={0} max={duration} value={config.timeframe.start} aria-label="Timeframe start"
        onChange={(e) => { const v = Number(e.target.value); if (v < config.timeframe.end - 60) apply(v, config.timeframe.end); }}
        className="range-thumb pointer-events-none absolute inset-x-0 top-0 h-8 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ivory" />
      <input type="range" min={0} max={duration} value={config.timeframe.end} aria-label="Timeframe end"
        onChange={(e) => { const v = Number(e.target.value); if (v > config.timeframe.start + 60) apply(config.timeframe.start, v); }}
        className="range-thumb pointer-events-none absolute inset-x-0 top-0 h-8 w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-splice" />
    </div>
    <div className="mt-2 grid grid-cols-2 gap-2">
      <input className="field mono" aria-label="Start time" value={sText} onChange={(e) => setSText(e.target.value)} onBlur={onText} onKeyDown={(e) => { if (e.key === 'Enter') onText(); }} placeholder="10 or 2:30" />
      <input className="field mono" aria-label="End time" value={eText} onChange={(e) => setEText(e.target.value)} onBlur={onText} onKeyDown={(e) => { if (e.key === 'Enter') onText(); }} placeholder="10 or 2:30" />
    </div>
    <div className={`helper ${invalid ? '!text-danger' : ''}`}>{invalid ? 'Minimum 1 minute — and the end must be after the start.' : 'Accepts “10” or “2:30”. Boundaries snap to sentence and shot edges.'}</div>
  </div>;
}

function CaptionCarousel() {
  const { config, setConfig } = useApp();
  return <div>
    <div className="label">Caption style · {CAPTION_STYLES.find((s) => s.id === config.captionStyle)?.label}</div>
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
      {CAPTION_STYLES.map((s) => <button key={s.id} onClick={() => { setConfig({ captionStyle: s.id as CaptionStyle }); sound.play('click'); }}
        aria-pressed={config.captionStyle === s.id} title={s.description}
        className={`relative h-[82px] w-[124px] shrink-0 overflow-hidden rounded-lg border ${config.captionStyle === s.id ? 'border-splice' : 'border-line hover:border-cyan/60'}`}
        style={{ background: `linear-gradient(135deg, ${['#3A120C', '#0d2430', '#2a0c1f', '#111c2e'][CAPTION_STYLES.indexOf(s) % 4]}, #0A0D12)` }}>
        <span className="absolute inset-0 opacity-20" style={{ background: 'repeating-linear-gradient(90deg, transparent 0 14px, #fff 14px 15px)' }} />
        <span className="caption-preview absolute bottom-3 left-2 right-2 text-center text-[10px] font-bold" data-style={s.id}>{s.label}</span>
      </button>)}
    </div>
    <div className="helper">{CAPTION_STYLES.find((s) => s.id === config.captionStyle)?.description}</div>
  </div>;
}

function BackgroundGrid() {
  const { config, setConfig } = useApp();
  const toggle = (id: BackgroundId) => {
    const has = config.backgrounds.includes(id);
    setConfig({ backgrounds: has ? config.backgrounds.filter((b) => b !== id) : [...config.backgrounds, id] });
  };
  return <div>
    <div className="label">Procedural backgrounds · none selected = random per clip</div>
    <div className="grid grid-cols-4 gap-2">
      {BACKGROUNDS.map((b) => <button key={b.id} onClick={() => toggle(b.id)} aria-pressed={config.backgrounds.includes(b.id)} title={b.label}
        className={`relative aspect-[9/16] overflow-hidden rounded-md border text-left ${config.backgrounds.includes(b.id) ? 'border-splice' : 'border-line hover:border-cyan/50'}`}
        style={{ background: `linear-gradient(${155 + BACKGROUNDS.indexOf(b) * 20}deg, #FF4D2E33, #22D3EE22 45%, #FF3DBE22)` }}>
        <span className="absolute inset-0 opacity-30" style={{ backgroundImage: `repeating-${b.category === 'Retro' ? 'linear-gradient(0deg,#fff2 0 2px,transparent 2px 6px)' : 'radial-gradient(circle,#fff3 1px,transparent 2px)'}`, backgroundSize: '8px 8px' }} />
        {config.backgrounds.includes(b.id) && <Check size={13} className="absolute right-1 top-1 text-acid" />}
        <span className="absolute bottom-1 left-1 right-1 truncate text-[8px] font-semibold text-ivory/90">{b.label}</span>
      </button>)}
    </div>
    <div className="mt-1 flex flex-wrap gap-1">{['All', 'Satisfying', 'Abstract', 'Retro'].map((c) => <span key={c} className="chip">{c}</span>)}</div>
  </div>;
}

function SplitMock() {
  const { config } = useApp();
  const ratio = Math.round(config.splitRatio * 100);
  return <div className="relative mx-auto h-40 w-[90px] overflow-hidden rounded-lg border border-line bg-[#0A0D12]">
    <div className="absolute inset-y-0 right-0" style={{ width: `${ratio}%`, background: 'linear-gradient(160deg,#3A120C,#FF4D2E55,#18202B)' }}>
      <div className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ivory/60" />
    </div>
    <div className="absolute inset-y-0 left-0 grid place-items-center" style={{ width: `${100 - ratio}%`, background: 'repeating-linear-gradient(45deg,#22D3EE18 0 8px,transparent 8px 16px)' }}>
      <span className="font-mono text-[10px] text-cyan">{ratio}%</span>
    </div>
    <div className="absolute bottom-1 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-ivory/40" />
  </div>;
}

function ManualCrop() {
  const { config, setConfig } = useApp();
  const crop = config.manualCrop ?? { x: 30, y: 30, zoom: 1.2 };
  const ref = useRef<HTMLDivElement>(null);
  const drag = (e: React.PointerEvent) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100));
    const y = Math.max(0, Math.min(100, (e.clientY - r.top) / r.height * 100));
    setConfig({ manualCrop: { ...crop, x: Math.round(x), y: Math.round(y) } });
  };
  return <div>
    <div ref={ref} onPointerDown={drag} onPointerMove={(e) => { if (e.buttons === 1) drag(e); }} className="relative mx-auto h-32 w-[76px] cursor-crosshair overflow-hidden rounded-md border border-line bg-[linear-gradient(135deg,#18202B,#3A120C)]">
      <div className="absolute h-[72%] w-[58%] border-2 border-cyan" style={{ left: `${crop.x * .4}%`, top: `${crop.y * .4}%` }} />
      <div className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-ivory/50" />
    </div>
    <div className="mt-2 grid grid-cols-3 gap-1.5">
      <label className="text-[10px] text-muted">X <input className="field !min-h-8" type="number" min={0} max={100} value={crop.x} onChange={(e) => setConfig({ manualCrop: { ...crop, x: Number(e.target.value) } })} /></label>
      <label className="text-[10px] text-muted">Y <input className="field !min-h-8" type="number" min={0} max={100} value={crop.y} onChange={(e) => setConfig({ manualCrop: { ...crop, y: Number(e.target.value) } })} /></label>
      <label className="text-[10px] text-muted">Zoom <input className="field !min-h-8" type="number" step={0.1} min={1} max={3} value={crop.zoom} onChange={(e) => setConfig({ manualCrop: { ...crop, zoom: Number(e.target.value) } })} /></label>
    </div>
  </div>;
}

export function Configure() {
  const { config, setConfig, resetConfig, navigate, settings, addProject } = useApp();
  const [customTab, setCustomTab] = useState<'templates' | 'custom'>('templates');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; remedy: string } | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const ready = Boolean(config.source.ref) && Boolean(config.attestation) && !(config.source.kind === 'upload' && !config.source.ref);
  const target = config.duration === 'short' ? 28 : config.duration === 'medium' ? 50 : config.duration === 'long' ? 100 : config.duration === 'extended' ? 160 : 55;
  const span = Math.max(0, config.timeframe.end - config.timeframe.start);
  const estimate = ready ? Math.max(1, Math.min(config.clipCount, Math.floor(span / Math.max(8, target * .6)))) : 0;
  const safeName = (config.filenameTemplate.replace(/\{title\}/g, 'clip').replace(/\{rank\}/g, '1').replace(/[^a-z0-9\-_.]/gi, '-').replace(/-+/g, '-') || 'splice') + '.mp4';

  const start = async () => {
    if (!ready) { toast.error('Add a source and choose an attestation first.'); return; }
    setSubmitting(true); setError(null); sound.play('start');
    try {
      const projectId = `p_${Date.now().toString(36)}`;
      const res = await api<{ jobId: string }>('/api/projects', { projectId, config: { ...config, rightsPolicy: settings.rightsPolicy } });
      addProject({ id: projectId, title: config.source.title || config.source.filename || 'New project', createdAt: Date.now(), sourceTitle: config.source.title || config.source.filename || 'Imported video', status: 'processing', clipIds: [], demo: false, config });
      useApp.getState().setJob(res.jobId, null);
      useApp.getState().setActiveProject(projectId);
      navigate('processing');
    } catch (e) {
      const err = e instanceof ApiError ? e.error : { message: 'Could not start the job.', remedy: 'Check the source and retry.' };
      setError(err); sound.play('blocked');
    } finally { setSubmitting(false); }
  };

  const randomize = () => {
    const types = CLIP_TYPES.map((t) => t.value);
    const styles = CAPTION_STYLES.map((s) => s.id);
    setConfig({
      clipType: types[Math.floor(Math.random() * types.length)]!,
      captionStyle: styles[Math.floor(Math.random() * styles.length)]!,
      clipCount: 1 + Math.floor(Math.random() * 6),
      duration: (['auto', 'short', 'medium', 'long'] as DurationBucket[])[Math.floor(Math.random() * 4)]!,
      aspect: (['9:16', '16:9', '1:1'] as Aspect[])[Math.floor(Math.random() * 3)]!,
      music: Math.random() > .6,
      musicMood: MUSIC[Math.floor(Math.random() * MUSIC.length)]!.id as MusicId,
      backgrounds: Math.random() > .5 ? [BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)]!.id] : [],
    });
    sound.play('click'); toast.info('Controls randomized');
  };

  const exportConfig = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'splice-config.json'; a.click(); URL.revokeObjectURL(a.href);
    toast.success('Config exported');
  };

  const controls = <div className="space-y-5">
    <Card>
      <Eyebrow>1 · Source</Eyebrow><h3 className="display mb-3 mt-1 text-lg">What are we cutting?</h3>
      <SourcePanel source={config.source} onChange={(s) => setConfig({ source: s })} />
    </Card>

    <Card>
      <Eyebrow>2 · Provenance</Eyebrow><h3 className="display mb-1 mt-1 text-lg">Your attestation</h3>
      <div className="helper mb-3">Required. Attestations are best-effort signals in CLAIM SHIELD, not legal advice.</div>
      <SelectSearch value={config.attestation as 'owned'} options={ATTESTATIONS as unknown as Array<{ value: 'owned'; label: string }>} onChange={(v) => setConfig({ attestation: v as ProjectConfig['attestation'] })} placeholder="Choose an attestation" />
      {config.attestation === 'licensed' && <input className="field mt-2" placeholder="Proof reference (kept local)" value={config.attestationProof ?? ''} onChange={(e) => setConfig({ attestationProof: e.target.value })} />}
      {config.attestation === 'unknown' && <div className="mt-2"><InfoNote tone="warn">Unknown third-party sources add +25 risk. CLAIM SHIELD will block hard-stop spans and you cannot bypass the server gate.</InfoNote></div>}
    </Card>

    <Card>
      <Eyebrow>3 · Edit plan</Eyebrow><h3 className="display mb-3 mt-1 text-lg">Shape the cut</h3>
      <div className="space-y-4">
        <div>
          <div className="mb-2 flex gap-1 border-b border-line">
            {(['templates', 'custom'] as const).map((t) => <button key={t} className={`px-3 py-2 text-[12px] font-semibold ${customTab === t ? 'border-b-2 border-splice text-text' : 'text-muted'}`} onClick={() => setCustomTab(t)}>{t === 'templates' ? 'Templates' : 'Custom prompt'}</button>)}
          </div>
          {customTab === 'templates' ? <SelectSearch value={config.clipType as 'viral'} options={CLIP_TYPES as unknown as Array<{ value: 'viral'; label: string }>} onChange={(v) => setConfig({ clipType: v as ProjectConfig['clipType'] })} />
            : <textarea className="field min-h-[84px]" placeholder="Describe the kind of moments you want…" value={config.customPrompt ?? ''} onChange={(e) => setConfig({ customPrompt: e.target.value, clipType: 'custom' })} />}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><span className="label">Clip count · {config.clipCount}</span><div className="flex items-center gap-2">
            <button className="icon-btn border border-line" aria-label="Fewer clips" onClick={() => setConfig({ clipCount: Math.max(1, config.clipCount - 1) })}>−</button>
            <input type="range" min={1} max={12} value={config.clipCount} aria-label="Clip count" onChange={(e) => setConfig({ clipCount: Number(e.target.value) })} className="w-full accent-[var(--splice)]" />
            <button className="icon-btn border border-line" aria-label="More clips" onClick={() => setConfig({ clipCount: Math.min(12, config.clipCount + 1) })}>+</button>
          </div></div>
          <Segmented label="Resolution" value={String(config.resolution) as '1080' | '720' | '480'} options={[{ value: '1080', label: '1080p' }, { value: '720', label: '720p' }, { value: '480', label: '480p' }]} onChange={(v) => setConfig({ resolution: Number(v) as 1080 | 720 | 480 })} />
        </div>
        <Segmented label="Duration" value={config.duration} options={[{ value: 'auto', label: 'Auto' }, { value: 'short', label: '0–30s' }, { value: 'medium', label: '30–60s' }, { value: 'long', label: '1–2min' }, { value: 'extended', label: '2–3min' }]} onChange={(v) => setConfig({ duration: v as DurationBucket })} />
        <Segmented label="Aspect ratio" value={config.aspect} options={[{ value: '9:16', label: '9:16', hint: 'Stories, Shorts, Reels, TikTok' }, { value: '16:9', label: '16:9', hint: 'YouTube, landscape' }, { value: '1:1', label: '1:1', hint: 'Feed posts' }]} onChange={(v) => setConfig({ aspect: v as Aspect })} />
        <div className="helper">{config.aspect === '9:16' ? 'Platform hint: Shorts / Reels / TikTok' : config.aspect === '16:9' ? 'Platform hint: YouTube / landscape feeds' : 'Platform hint: square feed posts'}</div>
        <div><span className="label">Language</span><SelectSearch value={config.language as 'auto'} options={LANGUAGES as unknown as Array<{ value: 'auto'; label: string }>} onChange={(v) => setConfig({ language: v as Language })} /></div>
        <Timeframe />
      </div>
    </Card>

    <Card>
      <Eyebrow>4 · Presentation</Eyebrow><h3 className="display mb-3 mt-1 text-lg">Make it yours</h3>
      <div className="space-y-4">
        <Toggle checked={config.captions} onChange={(v) => setConfig({ captions: v })} label="Captions" description="Burned word-level karaoke captions. No external subtitle files needed." />
        {config.captions && <CaptionCarousel />}
        <div className="hairline" />
        <Toggle checked={config.autoHook} onChange={(v) => setConfig({ autoHook: v })} label="Auto hook card" description="A bold opening card built from the moment's hook line." />
        {config.autoHook && <div><span className="label">Hook tone</span><SelectSearch value={config.hookTone as 'bold'} options={['bold', 'curious', 'provocative', 'calm', 'urgent'].map((v) => ({ value: v as 'bold', label: v[0]!.toUpperCase() + v.slice(1) }))} onChange={(v) => setConfig({ hookTone: v })} /></div>}
        <div className="hairline" />
        <Segmented label="Reframe mode" value={config.reframe} options={[{ value: 'face', label: 'Face-track' }, { value: 'center', label: 'Center' }, { value: 'manual', label: 'Manual' }]} onChange={(v) => setConfig({ reframe: v as ProjectConfig['reframe'] })} />
        {config.reframe === 'manual' && <ManualCrop />}
        <div className="hairline" />
        <Toggle checked={config.music} onChange={(v) => setConfig({ music: v })} label="AI music" description="A rights-safe generated loop, ducked under speech." />
        {config.music && <div className="grid grid-cols-2 gap-3">
          <SelectSearch value={config.musicMood as 'lofi'} options={MUSIC.map((m) => ({ value: m.id as 'lofi', label: m.label }))} onChange={(v) => setConfig({ musicMood: v as MusicId })} />
          <div><span className="label">Volume · {Math.round(config.musicVolume * 100)}%</span><input type="range" min={0} max={1} step={0.05} value={config.musicVolume} aria-label="Music volume" onChange={(e) => setConfig({ musicVolume: Number(e.target.value) })} className="w-full accent-[var(--splice)]" /></div>
        </div>}
        <div className="hairline" />
        <Toggle checked={config.splitScreen} onChange={(v) => setConfig({ splitScreen: v })} label="Split screen" description="Put your clip beside a procedural, rights-safe background." />
        {config.splitScreen && <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
          <BackgroundGrid />
          <div className="flex flex-col items-center"><SplitMock /><input type="range" min={0.35} max={0.85} step={0.05} value={config.splitRatio} aria-label="Split ratio" onChange={(e) => setConfig({ splitRatio: Number(e.target.value) })} className="mt-2 w-full accent-[var(--splice)]" /><span className="helper">Split ratio</span></div>
        </div>}
      </div>
    </Card>

    <Card>
      <Eyebrow>5 · Safety & output</Eyebrow><h3 className="display mb-3 mt-1 text-lg">Guardrails</h3>
      <div className="space-y-4">
        <Segmented label="Rights policy" value={config.rightsPolicy} options={[{ value: 'strict', label: 'Strict' }, { value: 'balanced', label: 'Balanced' }, { value: 'own_content', label: 'Own content' }]} onChange={(v) => setConfig({ rightsPolicy: v as ProjectConfig['rightsPolicy'] })} />
        <div className="helper">Strict re-ranks with virality × 0.6 + safety × 0.4 and blocks above 20 risk.</div>
        <div><span className="label">Filename template</span><input className="field mono" value={config.filenameTemplate} onChange={(e) => setConfig({ filenameTemplate: e.target.value })} /><div className="helper">Output: <span className="mono text-cyan">{safeName}</span></div></div>
        <InfoNote>Titles, captions and cropping do not remove copyright. CLAIM SHIELD is best-effort prevention, not a guarantee.</InfoNote>
      </div>
    </Card>
  </div>;

  const summary = <div className="space-y-3">
    <div className="flex items-center justify-between"><span className="text-[11px] uppercase tracking-wider text-muted">Live summary</span><ShieldBadge tier="REVIEW" risk={config.rightsPolicy === 'strict' ? 18 : 34} small /></div>
    <div className="grid grid-cols-2 gap-2 text-[12px]">
      <Sum k="Estimated clips" v={String(estimate)} />
      <Sum k="Minutes" v={(estimate * target / 60).toFixed(1)} />
      <Sum k="Output" v={`${config.resolution}p · ${config.aspect}`} />
      <Sum k="Clip type" v={CLIP_TYPES.find((t) => t.value === config.clipType)?.label ?? 'Custom'} />
      <Sum k="Captions" v={config.captions ? config.captionStyle : 'Off'} />
      <Sum k="Music" v={config.music ? config.musicMood : 'Off'} />
      <Sum k="Policy" v={config.rightsPolicy} />
      <Sum k="Timeframe" v={`${fmt(config.timeframe.start)}–${fmt(config.timeframe.end)}`} />
    </div>
    <div className="rounded-lg border border-line bg-bg p-2.5"><div className="label !mb-1">Filename</div><div className="mono truncate text-[12px] text-cyan">{safeName}</div></div>
    {error && <div className="rounded-lg border border-danger/40 bg-danger/5 p-3 text-[12px]">
      <div className="font-semibold text-danger">{error.message}</div><div className="mt-1 text-muted">{error.remedy}</div>
    </div>}
    <div className="grid grid-cols-3 gap-2">
      <button className="btn btn-primary border-beam col-span-3 !min-h-[46px] text-[14px]" onClick={() => void start()} disabled={submitting || !ready}>
        {submitting ? <Loader2 size={17} className="animate-spin" /> : <WandSparkles size={17} />}{submitting ? 'Starting…' : 'Get Clips'}
      </button>
      <button className="btn !px-2" onClick={() => { resetConfig(); toast.info('Controls reset'); }}><RotateCcw size={14} />Reset</button>
      <button className="btn !px-2" onClick={randomize}><Shuffle size={14} />Randomize</button>
      <button className="btn !px-2" onClick={exportConfig}><ArrowRight size={14} />Export</button>
    </div>
    <div className="helper">Nothing leaves this device except the source you choose to process and the transcript/metadata sent to a configured AI provider.</div>
  </div>;

  return <div>
    <SectionHeader />
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div>{controls}</div>
      <aside className="hidden lg:block"><div className="sticky top-[72px] panel p-4">{summary}</div></aside>
    </div>
    <div className={`fixed bottom-16 left-0 right-0 z-30 border-t border-line bg-surface/95 p-3 backdrop-blur md:hidden ${summaryOpen ? '' : ''}`}>
      <button className="flex w-full items-center justify-between" onClick={() => setSummaryOpen((v) => !v)}>
        <span className="text-[12px] font-semibold">{estimate} clips · {config.resolution}p · {config.aspect}</span><ChevronDown size={16} className={summaryOpen ? 'rotate-180' : ''} />
      </button>
      {summaryOpen && <div className="mt-3 max-h-[60vh] overflow-auto">{summary}</div>}
      {!summaryOpen && <button className="btn btn-primary mt-2 w-full" onClick={() => void start()} disabled={!ready}>Get Clips</button>}
    </div>
  </div>;
}

function Sum({ k, v }: { k: string; v: string }) {
  return <div className="rounded-md border border-line/70 bg-bg/60 p-2"><div className="text-[10px] text-muted">{k}</div><div className="truncate text-[12px] font-semibold capitalize">{v}</div></div>;
}

function SectionHeader() {
  return <div className="mb-5">
    <Eyebrow>Configure · cyan bay</Eyebrow>
    <h1 className="display mt-1 text-[clamp(24px,4vw,38px)] font-bold">Set the splice.</h1>
    <p className="mt-1 text-[13px] text-muted">Every control updates the summary live. Nothing is locked, metered or behind an account.</p>
    <div className="tape-divider mt-4" />
  </div>;
}
