import { useMemo, useState } from 'react';
import { CalendarDays, Check, Clock3, Download, Globe2, Plus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useApp, canDownload } from '../store/useApp';
import { api } from '../lib/api';
import { sound } from '../lib/sound';
import { Card, EmptyState, Eyebrow, InfoNote, Modal } from '../components/ui';

interface Slot { id: string; clipId: string; platform: string; date: string; time: string; note: string }
const PLATFORMS = ['YouTube Shorts', 'TikTok', 'Instagram Reels', 'X', 'LinkedIn'];

export function Scheduler() {
  const { clips, setActiveClip, navigate } = useApp();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [open, setOpen] = useState(false);
  const [kitOpen, setKitOpen] = useState(false);
  const [kit, setKit] = useState<{ kit: Array<{ mp4: string; srt: string; metadata: { title: string; description: string; hashtags: string[] } }>; ics: string } | null>(null);
  const [draft, setDraft] = useState<Slot>({ id: '', clipId: '', platform: PLATFORMS[0]!, date: new Date().toISOString().slice(0, 10), time: '18:00', note: '' });

  const add = () => {
    if (!draft.clipId) { toast.error('Choose a clip first.'); return; }
    setSlots((s) => [...s, { ...draft, id: `slot_${Date.now()}` }]);
    setOpen(false); setDraft({ ...draft, clipId: '', note: '' }); sound.play('paste'); toast.success('Slot added locally');
  };

  const buildKit = async () => {
    const ids = slots.map((s) => s.clipId).filter((id) => canDownload(clips.find((c) => c.id === id)!));
    if (!ids.length) { toast.error('Add at least one cleared clip to a slot.'); return; }
    try { const r = await api<typeof kit>('/api/publish/kit', { clipIds: ids, platform: 'local' }); setKit(r); setKitOpen(true); sound.play('ready'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not build the kit.'); }
  };

  const csv = useMemo(() => ['clip,platform,date,time,note', ...slots.map((s) => {
    const c = clips.find((x) => x.id === s.clipId);
    return `"${(c?.title ?? '').replace(/"/g, '""')}",${s.platform},${s.date},${s.time},"${s.note.replace(/"/g, '""')}"`;
  })].join('\n'), [slots, clips]);

  const download = (name: string, href: string) => { const a = document.createElement('a'); a.href = href; a.download = name; a.click(); };

  return <div>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><Eyebrow>Social scheduler · plan, don't upload</Eyebrow><h1 className="display mt-1 text-[clamp(24px,4vw,38px)] font-bold">Plan the drop.</h1>
        <p className="mt-1 text-[13px] text-muted">Build a local schedule and export assets + an .ics file. No OAuth, no account, no upload to a scheduler service.</p></div>
      <div className="flex gap-2"><button className="btn" onClick={() => download('splice-schedule.csv', `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`)}><Download size={15} />CSV</button>
        <button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={15} />Add slot</button></div>
    </div>

    <InfoNote tone="warn">SPLICE does not connect to your social accounts. Direct YouTube upload requires OAuth credentials this free build intentionally omits. The Publish Kit gives you every asset and metadata to post yourself.</InfoNote>

    <div className="mt-5">
      {slots.length === 0 ? <EmptyState icon={CalendarDays} title="No slots planned" body="Add a clip, pick a platform and a time. Everything stays in this browser until you export it." action={<button className="btn btn-primary" onClick={() => setOpen(true)}>Add the first slot</button>} />
        : <div className="space-y-2">{slots.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).map((s) => {
          const c = clips.find((x) => x.id === s.clipId);
          return <Card key={s.id} className="flex flex-wrap items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-md bg-splice-deep"><CalendarDays size={17} className="text-splice" /></div>
            <div className="min-w-[160px] flex-1"><div className="truncate text-[13px] font-semibold">{c?.title ?? 'Removed clip'}</div><div className="text-[11px] text-muted">{s.note || 'No note'}</div></div>
            <span className="chip"><Globe2 size={12} />{s.platform}</span>
            <span className="chip mono"><Clock3 size={12} />{s.date} {s.time}</span>
            <div className="flex gap-1"><button className="btn !min-h-8 !px-2" onClick={() => { if (c) { setActiveClip(c.id); navigate('editor'); } }}>Edit clip</button>
              <button className="icon-btn !h-8 !w-8" aria-label="Remove slot" onClick={() => setSlots((x) => x.filter((y) => y.id !== s.id))}><Trash2 size={14} /></button></div>
          </Card>;
        })}</div>}
    </div>

    {slots.length > 0 && <Card className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="display text-lg">Publish Kit</h3><p className="text-[12px] text-muted">Exports cleared clips with captions, metadata and a calendar file.</p></div>
        <button className="btn btn-primary" onClick={() => void buildKit()}><Upload size={15} />Build kit</button></div>
    </Card>}

    <Modal open={open} onClose={() => setOpen(false)} title="Add a schedule slot" footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={add}><Check size={15} />Add slot</button></>}>
      <div className="space-y-3">
        <div><label className="label">Clip</label><select className="field" value={draft.clipId} onChange={(e) => setDraft({ ...draft, clipId: e.target.value })}>
          <option value="">Choose a clip…</option>{clips.filter((c) => canDownload(c)).map((c) => <option key={c.id} value={c.id}>{c.title} · {c.report.tier}</option>)}
        </select></div>
        <div><label className="label">Platform</label><select className="field" value={draft.platform} onChange={(e) => setDraft({ ...draft, platform: e.target.value })}>{PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select></div>
        <div className="grid grid-cols-2 gap-2"><div><label className="label">Date</label><input type="date" className="field" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></div>
          <div><label className="label">Time</label><input type="time" className="field" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} /></div></div>
        <div><label className="label">Note</label><input className="field" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="Caption idea, hashtags…" /></div>
      </div>
    </Modal>

    <Modal open={kitOpen && Boolean(kit)} onClose={() => { setKitOpen(false); setKit(null); }} title="Your publish kit">
      {kit && <div className="space-y-3">
        {kit.kit.map((k, i) => <div key={i} className="rounded-lg border border-line bg-bg p-3">
          <div className="truncate text-[12px] font-semibold">{k.metadata.title}</div>
          <div className="mt-1 text-[11px] text-muted">{k.metadata.description}</div>
          <div className="mt-2 flex gap-2"><a className="btn !min-h-7 !px-2" href={k.mp4} download>MP4</a><a className="btn !min-h-7 !px-2" href={k.srt} download>SRT</a></div>
        </div>)}
        <div className="flex justify-end gap-2"><button className="btn" onClick={() => download('splice-schedule.ics', `data:text/calendar;charset=utf-8,${encodeURIComponent(kit.ics)}`)}><CalendarDays size={14} />.ics</button>
          <button className="btn btn-primary" onClick={() => { setKitOpen(false); setKit(null); }}>Done</button></div>
      </div>}
    </Modal>
  </div>;
}
