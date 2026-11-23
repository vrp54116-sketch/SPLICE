import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowDownToLine, Check, Download, FileArchive, Film, Heart,
  LayoutGrid, List, PackageOpen, Play, Search, ShieldAlert, SlidersHorizontal,
  Sparkles, Star, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ClipRecord, ShieldTier } from '@shared/types';
import { useApp, canDownload } from '../store/useApp';
import { api, assetUrl } from '../lib/api';
import { sound } from '../lib/sound';
import { markDownloaded } from '../components/Shell';
import { Card, EmptyState, Eyebrow, FlameBadge, Modal, ShieldBadge, Tip } from '../components/ui';
import { motionPrefs } from '../components/Shell';

type SortKey = 'score' | 'newest' | 'risk' | 'duration';
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function Results() {
  const { clips, activeProjectId, projects, setActiveClip, navigate, deleteClips, pendingUndo, undoDelete, updateClip } = useApp();
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState<'ALL' | ShieldTier>('ALL');
  const [sort, setSort] = useState<SortKey>('score');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selected, setSelected] = useState<string[]>([]);
  const [kitOpen, setKitOpen] = useState(false);
  const [kit, setKit] = useState<{ kit: Array<{ metadata: { title: string; description: string; hashtags: string[]; platform: string }; mp4: string; srt: string }>; ics: string } | null>(null);
  const [gateClip, setGateClip] = useState<ClipRecord | null>(null);

  const project = projects.find((p) => p.id === activeProjectId);
  const inScope = useMemo(() => {
    const base = project ? clips.filter((c) => project.clipIds.includes(c.id)) : clips;
    return base;
  }, [clips, project]);

  const shown = useMemo(() => {
    const q = query.toLowerCase();
    return inScope
      .filter((c) => tier === 'ALL' || c.report.tier === tier)
      .filter((c) => !q || `${c.title} ${c.hook} ${c.sourceTitle} ${c.report.tier}`.toLowerCase().includes(q))
      .sort((a, b) => sort === 'score' ? b.virality - a.virality : sort === 'risk' ? a.report.risk - b.report.risk : sort === 'duration' ? b.duration - a.duration : b.createdAt - a.createdAt);
  }, [inScope, tier, query, sort]);

  const toggleSelect = (id: string) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);

  const download = (c: ClipRecord) => {
    if (!canDownload(c)) { setGateClip(c); sound.play('blocked'); return; }
    if (c.status === 'review' && !c.confirmation) { setGateClip(c); return; }
    const a = document.createElement('a'); a.href = assetUrl(c.assetId); a.download = `${c.title.replace(/[^a-z0-9-_]+/gi, '-')}.mp4`; document.body.appendChild(a); a.click(); a.remove();
    markDownloaded(); sound.play('paste'); toast.success('Download started', { description: 'The server copy expires in 45 minutes.' });
  };

  const confirmAndDownload = () => {
    if (!gateClip) return;
    updateClip(gateClip.id, { confirmation: true });
    const a = document.createElement('a'); a.href = assetUrl(gateClip.assetId); a.download = `${gateClip.title.replace(/[^a-z0-9-_]+/gi, '-')}.mp4`; a.click();
    markDownloaded(); setGateClip(null); sound.play('paste'); toast.success('Download started with your confirmation recorded locally.');
  };

  const makeKit = async () => {
    const ids = selected.length ? selected : shown.filter((c) => canDownload(c)).map((c) => c.id);
    if (!ids.length) { toast.error('Select at least one cleared clip.'); return; }
    try { const r = await api<NonNullable<typeof kit>>('/api/publish/kit', { clipIds: ids, platform: 'youtube' }); setKit(r); setKitOpen(true); sound.play('paste'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not build the kit.'); }
  };

  return <div>
    <div className="mb-5">
      <Eyebrow>Results · the contact sheet</Eyebrow>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-[clamp(24px,4vw,38px)] font-bold">{project ? project.title : 'All clips'}</h1>
          <p className="mt-1 text-[13px] text-muted">{shown.length} clip{shown.length === 1 ? '' : 's'} · every cut screened by CLAIM SHIELD before it reached this page.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={() => void makeKit()}><FileArchive size={15} />Publish Kit</button>
          <button className="btn btn-primary" onClick={() => navigate('configure')}><Sparkles size={15} />New batch</button>
        </div>
      </div>
    </div>

    {pendingUndo && <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber/40 bg-amber/5 p-3 text-[12px]">
      <span>{pendingUndo.clips.length} clip{pendingUndo.clips.length === 1 ? '' : 's'} deleted from your local library.</span>
      <button className="btn !min-h-8 !px-2" onClick={undoDelete}>Undo</button>
    </div>}

    <Card className="mb-5 !p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1"><Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input className="field !pl-8" placeholder="Search titles, hooks, tiers…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <div className="flex gap-1 rounded-lg border border-line bg-bg p-1">
          {(['ALL', 'CLEAR', 'REVIEW', 'BLOCKED'] as const).map((t) => <button key={t} className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold ${tier === t ? 'bg-splice text-[#0A0D12]' : 'text-muted hover:text-text'}`} onClick={() => setTier(t)}>{t}</button>)}
        </div>
        <div className="flex items-center gap-1"><SlidersHorizontal size={14} className="text-muted" />
          <select className="field !min-h-8 !w-auto !py-1" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort clips">
            <option value="score">Highest score</option><option value="newest">Newest</option><option value="risk">Lowest risk</option><option value="duration">Longest</option>
          </select>
        </div>
        <div className="flex gap-1"><button className="icon-btn border border-line" aria-label="Grid view" onClick={() => setView('grid')}><LayoutGrid size={15} /></button>
          <button className="icon-btn border border-line" aria-label="List view" onClick={() => setView('list')}><List size={15} /></button></div>
      </div>
      {selected.length > 0 && <div className="mt-2 flex items-center gap-2 border-t border-line pt-2 text-[12px]">
        <span className="text-cyan">{selected.length} selected</span>
        <button className="btn !min-h-7 !px-2" onClick={() => void makeKit()}><PackageOpen size={13} />Kit</button>
        <button className="btn btn-danger !min-h-7 !px-2" onClick={() => { deleteClips(selected); setSelected([]); }}><Trash2 size={13} />Delete</button>
        <button className="btn btn-ghost !min-h-7 !px-2" onClick={() => setSelected([])}>Clear</button>
      </div>}
    </Card>

    {shown.length === 0 && <EmptyState icon={Film} title="No clips match this view" body="Try a different tier, search term, or sort. Cleared clips are ready to download." action={<button className="btn" onClick={() => { setTier('ALL'); setQuery(''); }}>Clear filters</button>} />}

    {view === 'grid' ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {shown.map((c, i) => <motion.div key={c.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...motionPrefs(), delay: Math.min(.3, i * .03) }}>
        <div className={`panel group overflow-hidden transition-colors ${selected.includes(c.id) ? 'border-cyan' : 'hover:border-splice/60'}`}>
          <div className="relative aspect-[9/13] overflow-hidden bg-[#0d1219]">
            {c.thumbId ? <img src={assetUrl(c.thumbId)} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
              : <div className="grid h-full place-items-center bg-[linear-gradient(160deg,#3A120C,#18202B)]"><Film size={30} className="text-ivory/40" /></div>}
            <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/85 to-transparent" />
            <button className="absolute left-2 top-2" onClick={() => toggleSelect(c.id)} aria-label={selected.includes(c.id) ? 'Deselect' : 'Select'}>
              <span className={`grid h-5 w-5 place-items-center rounded border ${selected.includes(c.id) ? 'border-cyan bg-cyan text-[#0A0D12]' : 'border-ivory/50 bg-black/40'}`}>{selected.includes(c.id) && <Check size={13} />}</span>
            </button>
            <div className="absolute right-2 top-2 flex flex-col items-end gap-1"><ShieldBadge tier={c.report.tier} risk={c.report.risk} small /><FlameBadge score={c.virality} /></div>
            <button className="absolute bottom-2 left-2 right-2 grid h-9 place-items-center rounded-md border border-ivory/20 bg-black/50 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100"
              onClick={() => { setActiveClip(c.id); navigate('editor'); }}>
              <Play size={16} className="text-ivory" />
            </button>
            {c.favorite && <Star size={13} className="absolute bottom-2 right-2 fill-amber text-amber" />}
            <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] group-hover:opacity-0">{fmt(c.duration)}</span>
          </div>
          <div className="p-3">
            <div className="truncate text-[13px] font-semibold">{c.title}</div>
            <div className="mt-0.5 truncate text-[11px] text-muted">{c.sourceTitle}</div>
            <div className="mt-3 flex items-center gap-1.5">
              <button className="btn btn-primary flex-1 !min-h-8 !px-2" onClick={() => download(c)}><Download size={13} />{canDownload(c) ? 'Download' : 'Locked'}</button>
              <Tip label="Open editor"><button className="icon-btn border border-line !h-8 !w-8" onClick={() => { setActiveClip(c.id); navigate('editor'); }}><SlidersHorizontal size={14} /></button></Tip>
              <Tip label={c.favorite ? 'Unfavorite' : 'Favorite'}><button className="icon-btn border border-line !h-8 !w-8" onClick={() => updateClip(c.id, { favorite: !c.favorite })}><Heart size={14} className={c.favorite ? 'fill-splice text-splice' : ''} /></button></Tip>
            </div>
          </div>
        </div>
      </motion.div>)}
    </div> : <Card className="!p-0">
      <div className="hidden grid-cols-[40px_1fr_90px_80px_80px_120px] gap-2 border-b border-line px-3 py-2 text-[10px] uppercase tracking-wider text-muted sm:grid">
        <span /><span>Clip</span><span>Score</span><span>Shield</span><span>Length</span><span className="text-right">Actions</span>
      </div>
      {shown.map((c) => <div key={c.id} className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-line/50 px-3 py-2.5 last:border-0 hover:bg-overlay/40 sm:grid-cols-[40px_1fr_90px_80px_80px_120px]">
        <button className="hidden sm:block" onClick={() => toggleSelect(c.id)} aria-label="Select"><span className={`grid h-4 w-4 place-items-center rounded border ${selected.includes(c.id) ? 'border-cyan bg-cyan text-[#0A0D12]' : 'border-line'}`}>{selected.includes(c.id) && <Check size={11} />}</span></button>
        <button className="min-w-0 text-left" onClick={() => { setActiveClip(c.id); navigate('editor'); }}><span className="block truncate text-[13px] font-medium">{c.title}</span><span className="block truncate text-[11px] text-muted">{c.sourceTitle} · {c.report.tier}</span></button>
        <span className="hidden font-mono text-[12px] sm:block">▲{c.virality}</span>
        <span className="hidden sm:block"><ShieldBadge tier={c.report.tier} risk={c.report.risk} small /></span>
        <span className="hidden font-mono text-[12px] text-muted sm:block">{fmt(c.duration)}</span>
        <div className="flex justify-end gap-1"><button className="icon-btn !h-8 !w-8" aria-label="Download" onClick={() => download(c)}><Download size={14} /></button>
          <button className="icon-btn !h-8 !w-8" aria-label="Edit" onClick={() => { setActiveClip(c.id); navigate('editor'); }}><SlidersHorizontal size={14} /></button></div>
      </div>)}
    </Card>}

    <Modal open={Boolean(gateClip)} onClose={() => setGateClip(null)} title="CLAIM SHIELD confirmation"
      footer={<><button className="btn" onClick={() => setGateClip(null)}>Cancel</button><button className="btn btn-primary" onClick={confirmAndDownload}><ArrowDownToLine size={15} />I understand — download</button></>}>
      {gateClip && <div className="space-y-3">
        <div className="flex items-center gap-2"><ShieldAlert size={18} className="text-amber" /><span className="font-semibold">{gateClip.title}</span></div>
        <p>This clip scored <strong>{gateClip.report.risk}/100</strong> risk (<strong>{gateClip.report.tier}</strong>). {gateClip.report.tier === 'BLOCKED' ? 'Hard-stop parameters were found — server download is blocked and this confirmation cannot override it.' : 'Review the evidence in the Editor before publishing.'}</p>
        <p className="text-muted">By continuing you confirm you have the rights to publish this clip. CLAIM SHIELD is best-effort prevention; it does not remove copyright or guarantee platform approval. Nothing is sent anywhere.</p>
      </div>}
    </Modal>

    <Modal open={kitOpen && Boolean(kit)} onClose={() => { setKitOpen(false); setKit(null); }} title="Publish Kit — no account required">
      {kit && <div className="space-y-3">
        <div className="rounded-lg border border-acid/40 bg-acid/5 p-3 text-[12px] text-acid">Kit built for {kit.kit.length} clip{kit.kit.length === 1 ? '' : 's'}. Download the MP4s and captions below, then import them into your own scheduler.</div>
        {kit.kit.map((k, i) => <div key={i} className="rounded-lg border border-line bg-bg p-3">
          <div className="truncate text-[12px] font-semibold">{k.metadata.title}</div>
          <div className="mt-1 text-[11px] text-muted">{k.metadata.description}</div>
          <div className="mt-1 font-mono text-[10px] text-cyan">{k.metadata.hashtags.join(' ')}</div>
          <div className="mt-2 flex gap-2"><a className="btn !min-h-7 !px-2" href={k.mp4} download>MP4</a><a className="btn !min-h-7 !px-2" href={k.srt} download>SRT</a></div>
        </div>)}
        <div className="flex justify-end gap-2"><a className="btn" href={`data:text/calendar;charset=utf-8,${encodeURIComponent(kit.ics)}`} download="splice-schedule.ics"><Download size={14} />.ics schedule</a>
          <button className="btn btn-primary" onClick={() => { setKitOpen(false); setKit(null); }}>Done</button></div>
      </div>}
    </Modal>
  </div>;
}
