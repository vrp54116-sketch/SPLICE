import { useMemo, type ElementType } from 'react';
import { motion } from 'motion/react';
import { Activity, BarChart3, CircleCheck, Clock3, Film, Flame, Gauge, LockKeyhole, ShieldCheck, TrendingUp } from 'lucide-react';
import { useApp } from '../store/useApp';
import { Card, Eyebrow, InfoNote, StatTile } from '../components/ui';
import { motionPrefs } from '../components/Shell';

export function Stats() {
  const { clips, projects, settings } = useApp();

  const stats = useMemo(() => {
    const tiers = { CLEAR: 0, REVIEW: 0, BLOCKED: 0 };
    for (const c of clips) tiers[c.report.tier]++;
    const scores = clips.map((c) => c.virality);
    const risks = clips.map((c) => c.report.risk);
    const avg = (a: number[]) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0;
    const minutes = Math.round(clips.reduce((a, c) => a + c.duration, 0) / 60);
    const byDay = new Map<string, number>();
    for (const c of clips) { const d = new Date(c.createdAt).toLocaleDateString(); byDay.set(d, (byDay.get(d) ?? 0) + 1); }
    const buckets = Array.from({ length: 5 }, (_, i) => scores.filter((s) => s >= i * 20 && s < (i + 1) * 20).length);
    const params = new Map<string, number>();
    for (const c of clips) for (const p of c.report.params) if (p.value > 0) params.set(p.id, (params.get(p.id) ?? 0) + 1);
    return { tiers, avgScore: avg(scores), avgRisk: avg(risks), minutes, byDay: [...byDay.entries()].slice(-10), buckets, params: [...params.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6) };
  }, [clips]);

  const maxBucket = Math.max(1, ...stats.buckets);
  const maxDay = Math.max(1, ...stats.byDay.map(([, n]) => n));

  return <div>
    <div className="mb-5"><Eyebrow>Studio stats · local analytics</Eyebrow><h1 className="display mt-1 text-[clamp(24px,4vw,38px)] font-bold">The numbers, honestly.</h1>
      <p className="mt-1 text-[13px] text-muted">Everything here is computed in your browser from your own library. Nothing is tracked or phoned home.</p></div>

    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile label="Clips" value={clips.length} icon={Film} />
      <StatTile label="Minutes" value={stats.minutes} suffix="min" icon={Clock3} />
      <StatTile label="Avg score" value={stats.avgScore} suffix="/100" icon={Flame} />
      <StatTile label="Avg risk" value={stats.avgRisk} suffix="/100" icon={ShieldCheck} />
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <Eyebrow>Virality distribution</Eyebrow><h3 className="display mb-4 mt-1 text-lg">How the cuts scored</h3>
        <div className="flex h-44 items-end gap-2">
          {stats.buckets.map((n, i) => <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <motion.div initial={{ height: 0 }} animate={{ height: `${Math.max(2, n / maxBucket * 130)}px` }} transition={{ ...motionPrefs(), delay: i * .05 }}
              className="w-full rounded-t-md" style={{ background: ['#FF5C5C', '#FFB020', '#22D3EE', '#A8E635', '#FF4D2E'][i] }} />
            <span className="mono text-[9px] text-muted">{i * 20}–{(i + 1) * 20}</span>
          </div>)}
        </div>
        <div className="mt-2 text-[11px] text-muted">Heuristic scores — an estimate of hold potential, not a prediction of views.</div>
      </Card>

      <Card>
        <Eyebrow>CLAIM SHIELD</Eyebrow><h3 className="display mb-4 mt-1 text-lg">Risk tiers</h3>
        <div className="space-y-3">
          {(['CLEAR', 'REVIEW', 'BLOCKED'] as const).map((t) => {
            const n = stats.tiers[t]; const pct = clips.length ? n / clips.length * 100 : 0;
            const color = t === 'CLEAR' ? 'var(--acid)' : t === 'REVIEW' ? 'var(--amber)' : 'var(--danger)';
            return <div key={t}><div className="mb-1 flex items-center justify-between text-[12px]"><span className="flex items-center gap-1.5">{t === 'CLEAR' ? <CircleCheck size={13} /> : t === 'BLOCKED' ? <LockKeyhole size={13} /> : <ShieldCheck size={13} />}{t}</span><span className="mono">{n} · {pct.toFixed(0)}%</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-line"><motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={motionPrefs()} className="h-full rounded-full" style={{ background: color }} /></div></div>;
          })}
        </div>
        <div className="mt-4 rounded-lg border border-line bg-bg p-3 text-[11px] leading-relaxed text-muted"><strong className="text-ivory">Best-effort screen.</strong> These tiers are a prevention signal, not a copyright determination. Platform detection is final.</div>
      </Card>

      <Card>
        <Eyebrow>Activity</Eyebrow><h3 className="display mb-4 mt-1 text-lg">Clips over time</h3>
        {stats.byDay.length ? <div className="flex h-40 items-end gap-1.5">{stats.byDay.map(([d, n]) => <div key={d} className="flex flex-1 flex-col items-center gap-1" title={`${d}: ${n} clips`}>
          <div className="w-full rounded-t bg-gradient-to-t from-splice-deep to-splice" style={{ height: `${Math.max(4, n / maxDay * 120)}px` }} />
          <span className="mono text-[8px] text-muted">{d.slice(5)}</span>
        </div>)}</div> : <div className="py-10 text-center text-[12px] text-muted">No activity yet.</div>}
      </Card>

      <Card>
        <Eyebrow>Detectors</Eyebrow><h3 className="display mb-4 mt-1 text-lg">What fired most</h3>
        {stats.params.length ? <div className="space-y-2">{stats.params.map(([id, n]) => <div key={id} className="flex items-center gap-2 text-[12px]">
          <span className="mono w-8 font-bold text-splice">{id}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-cyan" style={{ width: `${Math.min(100, n / Math.max(1, clips.length) * 100)}%` }} /></div>
          <span className="mono w-6 text-right text-muted">{n}</span>
        </div>)}</div> : <div className="py-10 text-center text-[12px] text-muted">No detector signals recorded.</div>}
        <div className="mt-4 text-[11px] text-muted">Counts of parameters with a non-zero value across all clips in this browser.</div>
      </Card>
    </div>

    <div className="mt-5 grid gap-3 sm:grid-cols-3">
      <Mini icon={BarChart3} label="Projects" value={projects.length} />
      <Mini icon={Activity} label="Game best" value={settings.gameBest} />
      <Mini icon={Gauge} label="Local workspace" value={1} />
    </div>
    <div className="mt-5"><InfoNote><TrendingUp size={13} className="mr-1 inline text-cyan" />Stats refresh automatically as you add clips. Demo clips are included and badged in the Library.</InfoNote></div>
  </div>;
}

function Mini({ icon: Icon, label, value }: { icon: ElementType; label: string; value: number }) {
  return <Card className="flex items-center gap-3 !p-3"><span className="grid h-9 w-9 place-items-center rounded-md bg-overlay text-cyan"><Icon size={16} /></span><div><div className="text-[10px] uppercase tracking-wider text-muted">{label}</div><div className="display text-xl">{value}</div></div></Card>;
}
