import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight, Check, CircleCheck, Clock3, Film, FolderOpen, Heart, Layers3,
  MoreHorizontal, Plus, RotateCcw, Search, Sparkles, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useApp, type SavedView } from '../store/useApp';
import { Card, EmptyState, Eyebrow, FlameBadge, Modal, ShieldBadge, Tip } from '../components/ui';
import { motionPrefs } from '../components/Shell';

export function Library() {
  const { projects, clips, savedViews, addView, removeView, deleteClips, pendingUndo, undoDelete, restoreDemos, setActiveProject, setActiveClip, navigate, updateClip } = useApp();
  const [tab, setTab] = useState<'clips' | 'projects'>('clips');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('All');
  const [sort, setSort] = useState('Newest');
  const [selected, setSelected] = useState<string[]>([]);
  const [viewOpen, setViewOpen] = useState(false);
  const [viewName, setViewName] = useState('');

  const shownClips = useMemo(() => clips.filter((c) => {
    const term = q.toLowerCase();
    if (term && !`${c.title} ${c.hook} ${c.sourceTitle} ${c.report.tier}`.toLowerCase().includes(term)) return false;
    if (filter === 'Favorites' && !c.favorite) return false;
    if (filter === 'Cleared' && c.status !== 'ready') return false;
    if (filter === 'Needs review' && c.status !== 'review') return false;
    if (filter === 'Blocked' && c.status !== 'blocked') return false;
    if (filter === 'Demo' && !c.demo) return false;
    return true;
  }).sort((a, b) => sort === 'Score' ? b.virality - a.virality : sort === 'Risk' ? a.report.risk - b.report.risk : sort === 'Title' ? a.title.localeCompare(b.title) : b.createdAt - a.createdAt), [clips, q, filter, sort]);

  const applyView = (v: SavedView) => { setFilter(v.filter); setSort(v.sort); setQ(''); toast.info(`View “${v.name}” applied`); };

  return <div>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><Eyebrow>Library · your local archive</Eyebrow><h1 className="display mt-1 text-[clamp(24px,4vw,38px)] font-bold">Everything you made.</h1>
        <p className="mt-1 text-[13px] text-muted">Stored in IndexedDB on this device. No account, no sync, no expiry for your metadata.</p></div>
      <button className="btn btn-primary" onClick={() => navigate('configure')}><Plus size={15} />New project</button>
    </div>

    {pendingUndo && <div className="mb-4 flex items-center justify-between rounded-lg border border-amber/40 bg-amber/5 p-3 text-[12px]">
      <span>{pendingUndo.clips.length} clip{pendingUndo.clips.length === 1 ? '' : 's'} deleted.</span>
      <button className="btn !min-h-8 !px-2" onClick={undoDelete}><RotateCcw size={13} />Undo</button>
    </div>}

    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="flex gap-1 rounded-lg border border-line bg-bg p-1">
        {(['clips', 'projects'] as const).map((t) => <button key={t} className={`rounded-md px-3 py-1.5 text-[12px] font-semibold capitalize ${tab === t ? 'bg-splice text-[#0A0D12]' : 'text-muted'}`} onClick={() => setTab(t)}>{t}</button>)}
      </div>
      <div className="relative min-w-[180px] flex-1"><Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <input className="field !pl-8" placeholder="Search the archive…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <select className="field !w-auto !min-h-10" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter clips">
        {['All', 'Favorites', 'Cleared', 'Needs review', 'Blocked', 'Demo'].map((f) => <option key={f}>{f}</option>)}
      </select>
      <select className="field !w-auto !min-h-10" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort clips">
        {['Newest', 'Score', 'Risk', 'Title'].map((f) => <option key={f}>{f}</option>)}
      </select>
      <button className="btn !px-2" onClick={() => setViewOpen(true)}><Layers3 size={14} />Views</button>
    </div>

    <div className="mb-4 flex flex-wrap gap-1.5">
      {savedViews.map((v) => <button key={v.id} className="chip hover:border-cyan" onClick={() => applyView(v)}>{v.name}<MoreHorizontal size={12} onClick={(e) => { e.stopPropagation(); removeView(v.id); }} /></button>)}
      <button className="chip border-dashed" onClick={() => setViewOpen(true)}><Plus size={12} />Save view</button>
    </div>

    {selected.length > 0 && <div className="mb-4 flex items-center gap-2 rounded-lg border border-cyan/40 bg-cyan/5 p-3 text-[12px]">
      <span className="text-cyan">{selected.length} selected</span>
      <button className="btn btn-danger !min-h-8 !px-2" onClick={() => { deleteClips(selected); setSelected([]); }}><Trash2 size={13} />Delete</button>
      <button className="btn btn-ghost !min-h-8 !px-2" onClick={() => setSelected([])}>Clear</button>
    </div>}

    {tab === 'clips' && (shownClips.length === 0 ? <EmptyState icon={Film} title="Nothing in this view" body="Adjust the search or filter, or seed the demo pack again from Settings." action={<button className="btn" onClick={() => { setQ(''); setFilter('All'); }}>Reset filters</button>} />
      : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shownClips.map((c, i) => <motion.div key={c.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...motionPrefs(), delay: Math.min(.25, i * .025) }}>
          <div className="panel group overflow-hidden">
            <div className="relative aspect-video overflow-hidden bg-[#0d1219]">
              <div className="absolute inset-0 bg-[linear-gradient(130deg,#3A120C,#18202B_60%,#0d1219)]" />
              <div className="sprocket absolute inset-0 opacity-20" />
              <button className="absolute left-2 top-2" onClick={() => setSelected((s) => s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id])} aria-label="Select">
                <span className={`grid h-5 w-5 place-items-center rounded border ${selected.includes(c.id) ? 'border-cyan bg-cyan text-[#0A0D12]' : 'border-ivory/50 bg-black/40'}`}>{selected.includes(c.id) && <Check size={12} />}</span>
              </button>
              <div className="absolute right-2 top-2"><ShieldBadge tier={c.report.tier} risk={c.report.risk} small /></div>
              <button className="absolute inset-0 grid place-items-center" onClick={() => { setActiveClip(c.id); navigate('editor'); }} aria-label={`Edit ${c.title}`}>
                <span className="grid h-10 w-10 place-items-center rounded-full border border-ivory/30 bg-black/50 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100"><ArrowRight size={17} /></span>
              </button>
              {c.demo && <span className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9px] text-amber">DEMO</span>}
            </div>
            <div className="p-3">
              <div className="flex items-start justify-between gap-1"><div className="min-w-0"><div className="truncate text-[13px] font-semibold">{c.title}</div><div className="truncate text-[11px] text-muted">{c.sourceTitle}</div></div>
                <Tip label={c.favorite ? 'Unfavorite' : 'Favorite'}><button className="icon-btn !h-7 !w-7" onClick={() => updateClip(c.id, { favorite: !c.favorite })}><Heart size={14} className={c.favorite ? 'fill-splice text-splice' : ''} /></button></Tip>
              </div>
              <div className="mt-2 flex items-center justify-between"><FlameBadge score={c.virality} /><span className="mono text-[10px] text-muted">{Math.round(c.duration)}s · {new Date(c.createdAt).toLocaleDateString()}</span></div>
            </div>
          </div>
        </motion.div>)}
      </div>)}

    {tab === 'projects' && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((p) => <Card key={p.id} className="cursor-pointer hover:border-splice/50" onClick={() => { setActiveProject(p.id); if (p.status === 'processing') navigate('processing'); else navigate('results'); }}>
        <div className="flex items-start justify-between"><span className="grid h-9 w-9 place-items-center rounded-md bg-splice-deep"><FolderOpen size={17} className="text-splice" /></span>
          <span className={`badge ${p.status === 'done' ? 'badge-clear' : p.status === 'processing' ? 'badge-review' : 'badge-blocked'}`}>{p.status}</span></div>
        <div className="mt-3 truncate text-[14px] font-semibold">{p.title}</div>
        <div className="truncate text-[11px] text-muted">{p.sourceTitle}</div>
        <div className="mt-3 flex items-center justify-between text-[11px] text-muted"><span className="flex items-center gap-1"><CircleCheck size={12} className="text-acid" />{p.clipIds.length} clips</span><span className="flex items-center gap-1"><Clock3 size={12} />{new Date(p.createdAt).toLocaleDateString()}</span></div>
        {p.demo && <span className="mt-1 inline-block font-mono text-[9px] text-amber">DEMO</span>}
      </Card>)}
      {!projects.length && <EmptyState icon={FolderOpen} title="No projects yet" body="Start from a file or URL to see it here." action={<button className="btn btn-primary" onClick={() => navigate('configure')}>New project</button>} />}
    </div>}

    <Modal open={viewOpen} onClose={() => setViewOpen(false)} title="Saved views"
      footer={<><button className="btn" onClick={() => setViewOpen(false)}>Close</button><button className="btn btn-primary" onClick={() => { if (viewName.trim()) { addView({ id: `view_${Date.now()}`, name: viewName.trim(), filter, sort }); setViewName(''); setViewOpen(false); toast.success('View saved'); } }}>Save current view</button></>}>
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2"><input className="field" placeholder="View name" value={viewName} onChange={(e) => setViewName(e.target.value)} /><span className="flex items-center text-[11px] text-muted">Current: {filter} · {sort}</span></div>
        {savedViews.map((v) => <div key={v.id} className="flex items-center justify-between rounded-lg border border-line bg-bg p-2.5">
          <span className="text-[13px]">{v.name}<span className="ml-2 text-[10px] text-muted">{v.filter} · {v.sort}</span></span>
          <div className="flex gap-1"><button className="btn !min-h-7 !px-2" onClick={() => { applyView(v); setViewOpen(false); }}>Apply</button>
            <button className="icon-btn !h-7 !w-7" aria-label="Delete view" onClick={() => removeView(v.id)}><Trash2 size={13} /></button></div>
        </div>)}
        {!savedViews.length && <div className="py-5 text-center text-[12px] text-muted">No saved views yet.</div>}
        <button className="btn w-full" onClick={() => { restoreDemos(); toast.success('Demo pack restored'); setViewOpen(false); }}><Sparkles size={14} />Restore demo pack</button>
      </div>
    </Modal>
  </div>;
}
