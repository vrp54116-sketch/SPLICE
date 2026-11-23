import { useMemo } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, CircleCheck, Clapperboard, Clock3, Film, LockKeyhole, Play, Plus, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '../store/useApp';
import { Card, Eyebrow, SectionTitle, StatTile, Tip } from '../components/ui';
import { sound } from '../lib/sound';
import { motionPrefs } from '../components/Shell';
import type { ClipRecord, ProjectRecord } from '@shared/types';

function ProjectCard({ p, clips }: { p: ProjectRecord; clips: ClipRecord[] }) {
  const navigate = useApp((s) => s.navigate);
  const badge = p.demo ? 'DEMO' : p.status.toUpperCase();
  const count = clips.filter((c) => p.clipIds.includes(c.id)).length;
  const cleared = clips.filter((c) => p.clipIds.includes(c.id) && c.status === 'ready').length;
  return <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={motionPrefs()}>
    <button className="panel group w-full overflow-hidden text-left transition-colors hover:border-splice/60" onClick={() => { if (clips.length) { useApp.getState().setActiveProject(p.id); navigate('results'); } else navigate('configure'); }}>
      <div className="relative h-28 overflow-hidden bg-[#0d1219]">
        <div className="absolute inset-0 opacity-80" style={{ background: `linear-gradient(125deg, #3A120C, #18202B 55%, ${p.demo ? '#1b2740' : '#0d1219'})` }} />
        <div className="sprocket absolute inset-0 opacity-20" />
        <div className="absolute inset-0 grid place-items-center"><Clapperboard size={30} className="text-ivory/70 transition-transform group-hover:scale-110" /></div>
        <span className="absolute left-3 top-3 rounded bg-black/60 px-2 py-0.5 font-mono text-[9px] font-bold tracking-widest text-amber">{badge}</span>
        <span className="absolute bottom-3 right-3 rounded bg-black/70 px-2 py-0.5 font-mono text-[10px]">{count} clips</span>
      </div>
      <div className="p-3.5">
        <div className="truncate text-[14px] font-semibold">{p.title}</div>
        <div className="mt-0.5 truncate text-[11px] text-muted">{p.sourceTitle}</div>
        <div className="mt-3 flex items-center justify-between text-[11px] text-muted">
          <span className="flex items-center gap-1"><CircleCheck size={12} className="text-acid" />{cleared} cleared</span>
          <span className="flex items-center gap-1">Continue <ArrowRight size={12} className="transition-transform group-hover:translate-x-1" /></span>
        </div>
      </div>
    </button>
  </motion.div>;
}

export function Home() {
  const { projects, clips, navigate, settings } = useApp();
  const minutes = useMemo(() => Math.round(clips.reduce((a, c) => a + c.duration, 0) / 60), [clips]);
  const cleared = clips.filter((c) => c.status === 'ready').length;
  const blocked = clips.filter((c) => c.status === 'blocked').length;
  const recent = [...clips].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const processing = projects.filter((p) => p.status === 'processing');

  return <div>
    <section className="relative mb-6 overflow-hidden rounded-2xl border border-line bg-surface/60 px-5 py-8 sm:px-9 sm:py-12">
      <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-splice/20 blur-[90px]" />
      <div className="absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-magenta/10 blur-[90px]" />
      <div className="sprocket absolute right-0 top-0 h-8 w-full opacity-20" />
      <div className="relative max-w-2xl">
        <Eyebrow>Midnight splice lab · free forever</Eyebrow>
        <h1 className="display mt-3 text-[clamp(28px,5vw,58px)] font-bold leading-[1.02]">
          Long video in.<br /><span className="text-splice">Shorts out.</span>
        </h1>
        <p className="mt-4 max-w-lg text-[14px] leading-relaxed text-muted">
          Drop a file or paste a link. SPLICE finds the moments, cuts them, captions them — then CLAIM SHIELD screens every clip before you download. No account, no quota, no watermark.
        </p>
        <div className="mt-6 flex flex-wrap gap-2.5">
          <button className="btn btn-primary border-beam" onClick={() => { sound.play('start'); navigate('configure'); }}><Plus size={17} />New project</button>
          <button className="btn" onClick={() => { navigate('library'); toast.info('Demo clips are badged DEMO in the Library.'); }}><Play size={15} />Explore demos</button>
        </div>
        <div className="mt-5 flex flex-wrap gap-2 text-[11px] text-muted">
          <span className="chip"><ShieldCheck size={12} className="text-acid" />Best-effort rights screen</span>
          <span className="chip"><Sparkles size={12} className="text-cyan" />Works with zero API keys</span>
          <span className="chip"><Clock3 size={12} className="text-amber" />Ephemeral server files</span>
        </div>
      </div>
    </section>

    <div className="mb-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile label="Minutes processed" value={minutes} suffix="min" icon={Film} />
      <StatTile label="Clips made" value={clips.length} icon={Clapperboard} />
      <StatTile label="Cleared" value={cleared} icon={CircleCheck} />
      <StatTile label="Blocked" value={blocked} icon={LockKeyhole} />
    </div>

    <div className="mb-8">
      <SectionTitle title="Continue where you left off" sub="Your last three projects, stored locally on this device." right={<button className="btn btn-ghost text-[12px]" onClick={() => navigate('library')}>All projects <ArrowRight size={14} /></button>} />
      {processing.length > 0 && <div className="mb-3 rounded-lg border border-amber/40 bg-amber/5 p-3 text-[12px] text-amber">A job is still processing. <button className="font-semibold underline" onClick={() => navigate('processing')}>Open Processing →</button></div>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.slice(0, 3).map((p) => <ProjectCard key={p.id} p={p} clips={clips} />)}
      </div>
    </div>

    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <SectionTitle title="Recent activity" sub="Newest clips across all projects." />
        <div className="space-y-1">
          {recent.map((c) => <button key={c.id} className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-overlay"
            onClick={() => { useApp.getState().setActiveClip(c.id); navigate('results'); }}>
            <span className="grid h-9 w-9 place-items-center rounded-md bg-splice-deep"><Film size={15} className="text-splice" /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{c.title}</span><span className="block truncate text-[11px] text-muted">{c.sourceTitle} · {Math.round(c.duration)}s</span></span>
            <span className="font-mono text-[11px] text-muted">▲{c.virality}</span>
            <Tip label={`CLAIM SHIELD risk ${c.report.risk}/100`}><span className={`h-2 w-2 rounded-full ${c.status === 'ready' ? 'bg-acid' : c.status === 'review' ? 'bg-amber' : 'bg-danger'}`} /></Tip>
          </button>)}
          {!recent.length && <div className="py-8 text-center text-[12px] text-muted">No clips yet. Start a project to see activity here.</div>}
        </div>
      </Card>
      <Card className="relative overflow-hidden">
        <div className="tape-divider absolute inset-x-0 top-0" />
        <SectionTitle title="Current setup" sub="Honest about what is active right now." />
        <div className="space-y-2 text-[12px]">
          <Row k="Profile" v={settings.profileName} />
          <Row k="Rights policy" v={configPolicy()} />
          <Row k="Sound" v={settings.sound ? 'On' : 'Off'} />
          <Row k="Motion" v={settings.reducedMotion ? 'Reduced' : 'Full'} />
        </div>
        <div className="mt-4 rounded-lg border border-line bg-bg p-3 text-[11px] leading-relaxed text-muted">
          Server files expire after 45 minutes. Your library and settings live in this browser's IndexedDB — nothing is uploaded to an account.
        </div>
      </Card>
    </div>
  </div>;
}

function configPolicy() { return useApp.getState().config.rightsPolicy; }
function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex items-center justify-between border-b border-line/60 pb-2"><span className="text-muted">{k}</span><span className="font-medium capitalize">{v}</span></div>;
}
