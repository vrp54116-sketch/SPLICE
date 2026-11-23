import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft, Check, Download,
  FileText, Film, Heart, Info, Layers, RefreshCw,
  Scissors, ShieldCheck, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ClipRecord, RepairAction, RepairPlan, ShieldParam } from '@shared/types';
import { RIGHTS_HUE } from '@shared/types';
import { useApp, canDownload } from '../store/useApp';
import { api, assetUrl } from '../lib/api';
import { sound } from '../lib/sound';
import { markDownloaded } from '../components/Shell';
import { Card, EmptyState, Eyebrow, FlameBadge, InfoNote, Modal, ShieldBadge, Tip, Toggle } from '../components/ui';
import { motionPrefs } from '../components/Shell';

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`;
const ACTION_LABEL: Record<RepairAction, string> = {
  mute_music: 'Mute original bed', replace_music: 'Replace with safe loop', trim_span: 'Trim flagged span',
  blur_roi: 'Blur detected ROI', crop_overlay: 'Crop overlay/bars', add_attribution: 'Add attribution',
  add_voiceover: 'Add original commentary', regenerate_meta: 'Regenerate metadata',
};

export function Editor() {
  const { clips, activeClipId, navigate, updateClip } = useApp();
  const clip = clips.find((c) => c.id === activeClipId);
  const [tab, setTab] = useState<'edit' | 'rights' | 'transcript' | 'versions'>('edit');
  const [playing, setPlaying] = useState(false);
  const [trim, setTrim] = useState({ start: 0, end: 30 });
  const [note, setNote] = useState('');
  const [plans, setPlans] = useState<RepairPlan[]>([]);
  const [selectedPlans, setSelectedPlans] = useState<RepairAction[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gate, setGate] = useState<ClipRecord | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!clip) return;
    setTrim({ start: clip.start, end: clip.end });
    setNote(''); setSelectedPlans([]); setConfirm(false);
    void refreshPlans(clip);
    // Re-run only when the selected clip changes; refreshPlans is a stable helper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip?.id]);

  const refreshPlans = async (c: ClipRecord) => {
    // Demo clips have no server-side report; their evidence is local by design.
    if (c.demo) { setPlans(localPlans(c)); return; }
    try {
      const r = await api<{ plans: RepairPlan[] }>('/api/rights/repair', { clipId: c.id, actions: ['mute_music'], confirmation: false });
      setPlans(r.plans);
    } catch { setPlans(localPlans(c)); }
  };

  const localPlans = (c: ClipRecord): RepairPlan[] => {
    const out: RepairPlan[] = [];
    for (const p of c.report.params) {
      if (p.hardBlock && p.id.startsWith('A')) out.push({ action: 'replace_music', reason: `Addresses ${p.id}: ${p.evidence}`, clears: ['A1', 'A2', 'A4'] });
      if (p.hardBlock && p.id.startsWith('V')) out.push({ action: 'blur_roi', reason: `Addresses ${p.id}: ${p.evidence}`, clears: ['V1', 'V5'], requiresConfirmation: true });
      if (p.mitigation && p.id === 'T1') out.push({ action: 'add_attribution', reason: 'Include the required attribution in your description.', clears: ['T1'] });
      if (p.id === 'X1' && p.value) out.push({ action: 'add_voiceover', reason: 'Original commentary can mitigate the transform-only signal.', clears: ['X1'] });
    }
    return out.filter((p, i, arr) => arr.findIndex((x) => x.action === p.action) === i);
  };

  const applyRepair = async () => {
    if (!clip || !selectedPlans.length) return;
    if (selectedPlans.some((a) => plans.find((p) => p.action === a)?.requiresConfirmation) && !confirm) { toast.error('Confirm that you have the right to modify this source.'); return; }
    setBusy(true);
    try {
      const r = await api<{ confirmation: boolean }>('/api/rights/repair', { clipId: clip.id, actions: selectedPlans, confirmation: confirm });
      updateClip(clip.id, { confirmation: r.confirmation, improved: true } as Partial<ClipRecord>);
      sound.play('medal'); toast.success(`${selectedPlans.length} repair${selectedPlans.length === 1 ? '' : 's'} queued`, { description: 'Re-run the pipeline to render repaired versions.' });
      setSelectedPlans([]); setConfirm(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Repair could not be applied.'); }
    finally { setBusy(false); }
  };

  const recut = async () => {
    if (!clip) return;
    setBusy(true);
    try {
      const r = await api<{ jobId: string; note: string }>(`/api/jobs/${clip.jobId}/recut`, { clipId: clip.id, start: trim.start, end: trim.end, note });
      useApp.getState().setJob(r.jobId, null);
      useApp.getState().setActiveProject(clip.jobId);
      sound.play('start'); toast.success('Recut queued', { description: 'Watch it in Processing.' });
      navigate('processing');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Recut unavailable for this clip.';
      toast.error(msg, { description: 'Demo clips and expired server jobs cannot be recut.' });
    } finally { setBusy(false); }
  };

  const download = (c: ClipRecord) => {
    if (!canDownload(c)) { setGate(c); sound.play('blocked'); return; }
    if (c.status === 'review' && !c.confirmation) { setGate(c); return; }
    const a = document.createElement('a'); a.href = assetUrl(c.assetId); a.download = `${c.title.replace(/[^a-z0-9-_]+/gi, '-')}.mp4`; a.click();
    markDownloaded(); sound.play('paste'); toast.success('Download started');
  };

  const transcriptWords = useMemo(() => clip?.transcript.words ?? [], [clip]);

  if (!clip) return <div className="py-16"><EmptyState icon={Film} title="No clip selected" body="Open a clip from Results or the Library to edit it." action={<button className="btn btn-primary" onClick={() => navigate('results')}>Go to Results</button>} /></div>;

  const report = clip.report;
  const span = Math.max(1, clip.end - clip.start);
  const startPct = Math.max(0, Math.min(100, (trim.start - clip.start) / span * 100));
  const endPct = Math.max(0, Math.min(100, (trim.end - clip.start) / span * 100));

  return <div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <button className="icon-btn border border-line" aria-label="Back to results" onClick={() => navigate('results')}><ArrowLeft size={16} /></button>
        <div className="min-w-0"><Eyebrow>Editor · cut {String(clip.rank).padStart(2, '0')}</Eyebrow><h1 className="display truncate text-xl font-bold sm:text-2xl">{clip.title}</h1></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ShieldBadge tier={report.tier} risk={report.risk} /><FlameBadge score={clip.virality} />
        <Tip label={clip.favorite ? 'Unfavorite' : 'Favorite'}><button className="icon-btn border border-line" aria-label="Favorite" onClick={() => updateClip(clip.id, { favorite: !clip.favorite })}><Heart size={16} className={clip.favorite ? 'fill-splice text-splice' : ''} /></button></Tip>
        <button className="btn btn-primary" onClick={() => download(clip)}><Download size={15} />{canDownload(clip) ? 'Download' : 'Locked'}</button>
      </div>
    </div>

    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        <Card className="!p-0">
          <div className="relative mx-auto aspect-[9/16] max-h-[62vh] w-full max-w-[360px] overflow-hidden rounded-t-xl bg-black">
            {clip.assetId && !clip.demo ? <video ref={videoRef} className="h-full w-full object-contain" src={assetUrl(clip.assetId)} controls playsInline preload="metadata"
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
              : <div className="grid h-full place-items-center bg-[linear-gradient(160deg,#3A120C,#18202B_60%,#0A0D12)]">
                <div className="text-center"><Film size={38} className="mx-auto text-ivory/30" /><div className="mt-3 text-[11px] text-muted">Demo preview · no server asset</div></div>
              </div>}
            <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md border border-ivory/15 bg-black/60 px-2 py-1 font-mono text-[10px] backdrop-blur">
              <span className={`h-1.5 w-1.5 rounded-full ${playing ? 'bg-acid' : 'bg-muted'}`} />{clip.aspect} · {clip.configSnapshot.resolution}p
            </div>
          </div>
          <div className="border-t border-line p-3">
            <div className="mb-2 flex items-center justify-between text-[11px]"><span className="text-muted">Source span</span><span className="mono">{fmt(trim.start)} → {fmt(trim.end)}</span></div>
            <div className="relative h-10 rounded-md border border-line bg-bg">
              <div className="absolute inset-y-0 left-0 bg-splice/20" style={{ width: `${startPct}%` }} />
              <div className="absolute inset-y-0 right-0 bg-splice/20" style={{ width: `${100 - endPct}%` }} />
              <div className="absolute inset-y-0 border-x-2 border-splice bg-splice/10" style={{ left: `${startPct}%`, width: `${Math.max(1, endPct - startPct)}%` }} />
              <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] text-muted">source timeline</div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-[10px] text-muted">In <input className="field mono !min-h-8" type="number" step="0.1" min={clip.start} max={trim.end - 1} value={Number(trim.start.toFixed(1))} onChange={(e) => setTrim((t) => ({ ...t, start: Math.max(clip.start, Math.min(Number(e.target.value), t.end - 1)) }))} /></label>
              <label className="text-[10px] text-muted">Out <input className="field mono !min-h-8" type="number" step="0.1" max={clip.end} min={trim.start + 1} value={Number(trim.end.toFixed(1))} onChange={(e) => setTrim((t) => ({ ...t, end: Math.min(clip.end, Math.max(Number(e.target.value), t.start + 1)) }))} /></label>
            </div>
            <div className="mt-2 flex items-center gap-2"><input className="field flex-1" placeholder="Note for the recut (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn !min-h-9" onClick={recut} disabled={busy}><Scissors size={14} />{busy ? 'Queuing…' : 'Recut'}</button></div>
          </div>
        </Card>

        <Card>
          <div className="mb-3 flex gap-1 border-b border-line">
            {([['edit', 'Why this cut', Sparkles], ['rights', 'CLAIM SHIELD', ShieldCheck], ['transcript', 'Transcript', FileText], ['versions', 'Versions', Layers]] as const).map(([id, label, Icon]) => (
              <button key={id} className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-semibold ${tab === id ? 'border-b-2 border-splice text-text' : 'text-muted hover:text-text'}`} onClick={() => setTab(id)}><Icon size={13} />{label}</button>
            ))}
          </div>

          {tab === 'edit' && <div className="space-y-4">
            <div><div className="label">Hook card</div><div className="rounded-lg border border-splice/30 bg-splice-deep/30 p-3 text-[15px] font-semibold text-ivory">{clip.hook}</div></div>
            <div><div className="label">Why this moment</div><p className="text-[13px] leading-relaxed text-muted">{clip.why}</p></div>
            <div><div className="label">Improvements applied</div><ul className="space-y-1">{clip.improvements.map((x, i) => <li key={i} className="flex gap-2 text-[12px] text-muted"><Check size={13} className="mt-0.5 shrink-0 text-acid" />{x}</li>)}</ul></div>
            <div className="rounded-lg border border-line bg-bg p-3 text-[11px] leading-relaxed text-muted"><Info size={13} className="mr-1 inline text-cyan" />The virality score is a local heuristic, not a prediction. Scores reflect speech density, energy, novelty and completeness — nothing is sent to a ranking service.</div>
          </div>}

          {tab === 'rights' && <div className="space-y-4">
            <div className={`rounded-lg border p-3 ${report.tier === 'CLEAR' ? 'border-acid/40 bg-acid/5' : report.tier === 'REVIEW' ? 'border-amber/40 bg-amber/5' : 'border-danger/40 bg-danger/5'}`}>
              <div className="flex items-center justify-between"><span className="display text-lg">{report.tier}</span><span className="mono text-[13px]">risk {report.risk}/100</span></div>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">{report.explanation}</p>
              {report.forcedAttribution && <div className="mt-2 text-[11px] text-amber">Required attribution: {report.forcedAttribution}</div>}
            </div>
            <div><div className="label">All 16 detector parameters</div>
              <div className="space-y-1.5">{report.params.map((p) => <ParamRow key={p.id} p={p} />)}</div>
            </div>
            <div><div className="label">Audio heatmap · flagged windows</div>
              <div className="flex h-12 items-end gap-0.5 rounded-md border border-line bg-bg p-1">{report.audioHeatmap.map((h, i) => <div key={i} title={`${h.start}-${h.end}s · ${(h.level * 100).toFixed(0)}%${h.flagged ? ' · flagged' : ''}`}
                className={`flex-1 rounded-sm ${h.flagged ? 'bg-danger' : 'bg-cyan/50'}`} style={{ height: `${Math.max(8, h.level * 100)}%` }} />)}</div>
            </div>
            <div className="hairline" />
            <div><div className="label">Legal repairs · best-effort only</div>
              <div className="space-y-2">{(plans.length ? plans : localPlans(clip)).map((p) => <label key={p.action} className={`flex cursor-pointer gap-2 rounded-lg border p-3 ${selectedPlans.includes(p.action) ? 'border-splice bg-splice-deep/20' : 'border-line bg-bg hover:border-cyan/40'}`}>
                <input type="checkbox" className="mt-0.5 accent-[var(--splice)]" checked={selectedPlans.includes(p.action)} onChange={() => { sound.play('click'); setSelectedPlans((s) => s.includes(p.action) ? s.filter((x) => x !== p.action) : [...s, p.action]); }} />
                <span className="min-w-0"><span className="block text-[12px] font-semibold">{ACTION_LABEL[p.action]}</span><span className="block text-[11px] text-muted">{p.reason}</span><span className="mt-1 block font-mono text-[10px] text-cyan">clears {p.clears.join(', ')}</span></span>
              </label>)}</div>
              {(plans.length ? plans : localPlans(clip)).some((p) => p.requiresConfirmation && selectedPlans.includes(p.action)) &&
                <div className="mt-2"><Toggle checked={confirm} onChange={setConfirm} label="I confirm I may modify this source" description="Required for watermark ROI blur. CLAIM SHIELD does not grant rights." /></div>}
              <button className="btn btn-primary mt-3 w-full" onClick={() => void applyRepair()} disabled={!selectedPlans.length || busy}><RefreshCw size={14} />{busy ? 'Applying…' : 'Apply repairs'}</button>
            </div>
            <InfoNote tone="danger"><strong>Read this.</strong> CLAIM SHIELD is best-effort prevention. It cannot remove copyright, bypass Content ID, or guarantee monetization. The platform's detection is final. Never use these tools to evade detection on content you do not own.</InfoNote>
          </div>}

          {tab === 'transcript' && <div className="space-y-3">
            <div className="flex items-center justify-between"><span className="text-[11px] text-muted">{clip.transcript.mode === 'none' ? 'No transcript — no words were invented' : `${transcriptWords.length} timed words · ${clip.transcript.mode}`}</span><span className="chip">karaoke captions</span></div>
            <div className="flex flex-wrap gap-1.5 rounded-lg border border-line bg-bg p-3">{transcriptWords.length ? transcriptWords.map((w, i) => <button key={i} className="rounded border border-line bg-overlay px-1.5 py-0.5 text-[12px] hover:border-cyan" title={`${fmt(w.start)} → ${fmt(w.end)}`}
              onClick={() => { if (videoRef.current) { videoRef.current.currentTime = Math.max(0, w.start - clip.start); void videoRef.current.play(); } }}>{w.w}</button>)
              : <span className="text-[12px] text-muted">This source had no usable transcript in zero-key mode. Captions only burn real detected words; none were fabricated.</span>}
            </div>
          </div>}

          {tab === 'versions' && <div className="space-y-2">
            {clip.versions.map((v) => <div key={v.version} className="flex items-center justify-between rounded-lg border border-line bg-bg p-3">
              <div><div className="text-[12px] font-semibold">Version {v.version}</div><div className="mono text-[10px] text-muted">{new Date(v.createdAt).toLocaleString()}</div></div>
              <div className="flex gap-2"><span className="chip">{v.reportId}</span>{v.assetId && <a className="btn !min-h-7 !px-2" href={assetUrl(v.assetId)} download><Download size={12} />v{v.version}</a>}</div>
            </div>)}
            <div className="rounded-lg border border-dashed border-line p-3 text-center text-[11px] text-muted">Recut or repair to create a new version. Past versions stay in your local library.</div>
          </div>}
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <Eyebrow>Selection</Eyebrow>
          <div className="mt-2 space-y-2 text-[12px]">
            <Row k="Rank" v={`#${clip.rank}`} /><Row k="Duration" v={`${Math.round(clip.duration)}s`} />
            <Row k="Aspect" v={clip.aspect} /><Row k="Captions" v={clip.captionStyle} />
            <Row k="Source" v={clip.sourceTitle} /><Row k="Created" v={new Date(clip.createdAt).toLocaleDateString()} />
            <Row k="Status" v={clip.status} />
          </div>
        </Card>
        <Card>
          <Eyebrow>Next steps</Eyebrow>
          <div className="mt-2 space-y-2">
            <button className="btn w-full justify-start" onClick={() => navigate('results')}><ArrowLeft size={14} />Back to all clips</button>
            <button className="btn w-full justify-start" onClick={() => { useApp.getState().setActiveProject(null); navigate('results'); }}><Layers size={14} />Open in Library</button>
            <button className="btn btn-primary w-full justify-start" onClick={() => download(clip)}><Download size={14} />Download this cut</button>
          </div>
        </Card>
        <Card className="bg-splice-deep/20">
          <Eyebrow>Best-effort rights</Eyebrow>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">Every download is gated on the server. BLOCKED assets return <span className="mono text-danger">403 RIGHTS_BLOCKED</span> — no client trick can override it.</p>
        </Card>
      </div>
    </div>

    <Modal open={Boolean(gate)} onClose={() => setGate(null)} title="Download locked by CLAIM SHIELD"
      footer={<><button className="btn" onClick={() => setGate(null)}>Close</button>{gate?.status === 'review' && <button className="btn btn-primary" onClick={() => { if (gate) updateClip(gate.id, { confirmation: true }); const a = document.createElement('a'); a.href = assetUrl(gate!.assetId); a.download = 'splice-clip.mp4'; a.click(); setGate(null); }}>Confirm & download</button>}</>}>
      <p>{gate?.report.tier === 'BLOCKED' ? 'This clip contains hard-stop signals. The server refuses the download — review the Rights tab and run a legal repair instead.' : 'Confirm you have the rights to publish this REVIEW clip. Your confirmation is stored locally.'}</p>
    </Modal>
  </div>;
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-1.5"><span className="text-muted">{k}</span><span className="truncate text-right font-medium capitalize">{v}</span></div>;
}

function ParamRow({ p }: { p: ShieldParam }) {
  const color = RIGHTS_HUE[p.id] ?? '#8B94A7';
  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={motionPrefs()} className="rounded-lg border border-line bg-bg p-2.5">
    <div className="flex items-center gap-2"><span className="grid h-6 w-7 place-items-center rounded font-mono text-[10px] font-bold text-[#0A0D12]" style={{ background: color }}>{p.id}</span>
      <span className="font-mono text-[11px] text-muted">w{p.weight}</span>
      {p.hardBlock && <span className="badge !bg-danger !text-white">HARD STOP</span>}
      {p.mitigation && <span className="badge !bg-acid !text-[#0A0D12]">MITIGATION</span>}
      <span className="mono ml-auto text-[11px]">{(p.value * 100).toFixed(0)}%</span>
    </div>
    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full" style={{ width: `${p.value * 100}%`, background: color }} /></div>
    <div className="mt-1.5 text-[11px] leading-relaxed text-muted">{p.evidence}</div>
  </motion.div>;
}
