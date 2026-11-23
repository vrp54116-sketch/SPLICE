import { useEffect, useRef, useState, type ElementType } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight, CircleAlert, CircleCheck, Clapperboard, Clock3, Cpu, Gauge, Loader2,
  Radio, ShieldCheck, Sparkles, X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ClipRecord, JobEvent, JobState } from '@shared/types';
import { useApp } from '../store/useApp';
import { api, sse } from '../lib/api';
import { sound } from '../lib/sound';
import { Card, Eyebrow, InfoNote, ShieldBadge } from '../components/ui';
import { SpliceGame } from '../game/SpliceGame';
import { motionPrefs } from '../components/Shell';

const PHASES: Array<{ id: JobState['phase']; label: string; icon: ElementType; blurb: string }> = [
  { id: 'ingest', label: 'Ingest', icon: Clapperboard, blurb: 'Reading the source and making a proxy' },
  { id: 'transcribe', label: 'Transcribe', icon: Radio, blurb: 'Finding the words and sentence boundaries' },
  { id: 'analyze', label: 'Analyze', icon: Cpu, blurb: 'Shots, audio energy and browser offload' },
  { id: 'score', label: 'Score', icon: Sparkles, blurb: 'Ranking moments and screening rights' },
  { id: 'render', label: 'Render', icon: Clapperboard, blurb: 'Cutting, captions and 1080p encode' },
  { id: 'rights', label: 'CLAIM SHIELD', icon: ShieldCheck, blurb: 'Final rights scan and repair pass' },
  { id: 'ready', label: 'Ready', icon: CircleCheck, blurb: 'Clips are in your library' },
];

const fmtEta = (s: number) => s > 0 ? `${Math.ceil(s)}s left` : 'calculating…';

export function Processing() {
  const { activeJobId, jobState, setJob, addClips, updateProject, navigate, activeProjectId } = useApp();
  const [ingested, setIngested] = useState(false);
  const [toastDone, setToastDone] = useState(false);
  const lastPhase = useRef('');

  useEffect(() => {
    if (!activeJobId) return;
    let finished = false;
    const stop = sse<JobEvent>(`/api/jobs/${activeJobId}/events`, (_name, ev) => {
      const state = ev.state;
      setJob(activeJobId, state);
      if (state.phase !== lastPhase.current) { lastPhase.current = state.phase; if (state.phase === 'ready') sound.play('ready'); }
      if (ev.type === 'done' && !finished) {
        finished = true;
        const clips = (ev.payload as ClipRecord[] | undefined) ?? state.clips ?? [];
        addClips(clips);
        if (activeProjectId) updateProject(activeProjectId, { status: clips.length ? 'done' : 'error', clipIds: clips.map((c) => c.id) });
        if (!toastDone) { setToastDone(true); toast.success(`${clips.length} clip${clips.length === 1 ? '' : 's'} ready`, { description: 'CLAIM SHIELD screened every cut.' }); }
        setIngested(true);
      }
    });
    return stop;
  }, [activeJobId, setJob, addClips, updateProject, activeProjectId, toastDone]);

  // Poll fallback if SSE was missed (e.g. proxy rebuffer / reconnect).
  useEffect(() => {
    if (!activeJobId || jobState && ['ready', 'error', 'canceled'].includes(jobState.phase)) return;
    const t = setInterval(async () => {
      try {
        const s = await api<JobState>(`/api/jobs/${activeJobId}`);
        setJob(activeJobId, s);
      } catch { /* ignore */ }
    }, 4000);
    return () => clearInterval(t);
  }, [activeJobId, jobState, setJob]);

  const cancel = async () => {
    if (!activeJobId) return;
    try { await api(`/api/jobs/${activeJobId}/cancel`, {}); setJob(activeJobId, { ...(jobState ?? {} as JobState), phase: 'canceled', pct: 100, message: 'Stopped — no background processes left running' }); sound.play('blocked'); toast.info('Job canceled'); }
    catch { toast.error('Could not cancel — the job may already be finished.'); }
  };

  const s = jobState;
  const isFinal = s && ['ready', 'error', 'canceled'].includes(s.phase);
  const failed = s?.phase === 'error';
  const ready = s?.phase === 'ready';
  const activeIndex = PHASES.findIndex((p) => p.id === s?.phase);

  return <div>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <Eyebrow>Processing · the cutting room</Eyebrow>
        <h1 className="display mt-1 text-[clamp(24px,4vw,38px)] font-bold">{ready ? 'Cut, printed and screened.' : failed ? 'The reel jammed.' : 'The reel is turning.'}</h1>
        <p className="mt-1 text-[13px] text-muted">One heavy job at a time on the free tier — you can watch progress live. Nothing is charged, metered or watermarked.</p>
      </div>
      {!s && <InfoNote tone="warn">No active job. Start one from New project.</InfoNote>}
      {s && !isFinal && <button className="btn btn-danger" onClick={() => void cancel()}><X size={15} />Cancel job</button>}
      {ready && <button className="btn btn-primary border-beam" onClick={() => navigate('results')}>View results <ArrowRight size={16} /></button>}
    </div>

    {failed && s?.error && <Card className="mb-5 border-danger/40">
      <div className="flex gap-3">
        <CircleAlert size={20} className="mt-0.5 shrink-0 text-danger" />
        <div>
          <div className="font-mono text-[12px] font-bold text-danger">{s.error.code}</div>
          <div className="mt-1 text-[13px] font-semibold">{s.error.message}</div>
          <div className="mt-2 rounded-lg border border-line bg-bg p-3 text-[12px] leading-relaxed text-muted"><strong className="text-ivory">What to do:</strong> {s.error.remedy}</div>
          <div className="mt-3 flex gap-2">
            <button className="btn" onClick={() => navigate('configure')}>Back to Configure</button>
            <button className="btn" onClick={() => useApp.getState().openDrawer('help')}>Search all error codes</button>
          </div>
        </div>
      </div>
    </Card>}

    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Card>
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${isFinal ? ready ? 'bg-acid' : 'bg-danger' : 'rec-dot'}`} />
              <span className="font-mono text-[12px]">{s?.message ?? 'Waiting for a job'}</span></div>
            <span className="display text-2xl">{s?.pct ?? 0}%</span>
          </div>
          <div className="mb-6 h-2 overflow-hidden rounded-full bg-line">
            <motion.div className={`h-full ${failed ? 'bg-danger' : 'bg-gradient-to-r from-splice via-amber to-acid'}`}
              animate={{ width: `${s?.pct ?? 0}%` }} transition={{ duration: .5 }} />
          </div>
          <div className="space-y-1.5">
            {PHASES.map((p, i) => {
              const done = i < activeIndex || ready;
              const active = i === activeIndex && !isFinal;
              const Icon = p.icon;
              return <motion.div key={p.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ ...motionPrefs(), delay: i * .03 }}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${active ? 'border-splice/60 bg-splice-deep/30' : done ? 'border-acid/20 bg-acid/5' : 'border-line/60 bg-bg/40'}`}>
                <span className={`grid h-8 w-8 place-items-center rounded-md ${active ? 'bg-splice text-[#0A0D12]' : done ? 'bg-acid/15 text-acid' : 'bg-overlay text-muted'}`}>
                  {done ? <CircleCheck size={16} /> : active ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}
                </span>
                <span className="min-w-0 flex-1"><span className={`block text-[13px] font-semibold ${active || done ? 'text-text' : 'text-muted'}`}>{p.label}</span><span className="block truncate text-[11px] text-muted">{p.blurb}</span></span>
                <span className="mono text-[10px] text-muted">{String(i + 1).padStart(2, '0')}/{PHASES.length}</span>
              </motion.div>;
            })}
          </div>
        </Card>

        {s && <div className="grid grid-cols-3 gap-3">
          <MiniStat icon={Gauge} label="Speed" value={s.speed ? `${s.speed.toFixed(1)}×` : '—'} />
          <MiniStat icon={Clock3} label="ETA" value={isFinal ? 'done' : fmtEta(s.eta)} />
          <MiniStat icon={Radio} label="Queue" value={s.queuePosition ? `#${s.queuePosition}` : 'active'} />
        </div>}

        {ready && s?.clips && <Card>
          <Eyebrow>First look</Eyebrow><h3 className="display mb-3 mt-1 text-lg">{s.clips.length} clip{s.clips.length === 1 ? '' : 's'} cleared for review</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {s.clips.slice(0, 6).map((c) => <button key={c.id} className="flex items-center gap-3 rounded-lg border border-line bg-bg p-2 text-left hover:border-splice/50"
              onClick={() => { useApp.getState().setActiveClip(c.id); navigate('editor'); }}>
              {c.thumbId ? <img src={`/api/assets/${c.thumbId}`} alt="" className="h-12 w-9 rounded object-cover" /> : <span className="grid h-12 w-9 place-items-center rounded bg-splice-deep"><Clapperboard size={14} className="text-splice" /></span>}
              <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold">{c.title}</span><span className="mono block text-[10px] text-muted">▲{c.virality} · {Math.round(c.duration)}s</span></span>
              <ShieldBadge tier={c.report.tier} risk={c.report.risk} small />
            </button>)}
          </div>
        </Card>}
      </div>

      <div className="space-y-5">
        <SpliceGame celebrating={Boolean(ready && ingested)} />
        <Card>
          <Eyebrow>Honest notes</Eyebrow>
          <div className="mt-2 space-y-2 text-[12px] leading-relaxed text-muted">
            <p><strong className="text-ivory">Ephemeral by design.</strong> Rendered files live on the server for 45 minutes, then expire. Download what you need — your library metadata stays in this browser.</p>
            <p><strong className="text-ivory">Zero keys required.</strong> Without provider keys, transcription uses heuristics and captions come only from real detected words. No words are invented.</p>
            <p><strong className="text-ivory">Best-effort rights.</strong> CLAIM SHIELD is a prevention screen, not a copyright ruling. The platform's detection is final.</p>
          </div>
        </Card>
      </div>
    </div>
  </div>;
}

function MiniStat({ icon: Icon, label, value }: { icon: ElementType; label: string; value: string }) {
  return <Card className="!p-3"><div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted"><Icon size={12} />{label}</div><div className="mono mt-1 text-[14px] font-semibold">{value}</div></Card>;
}
