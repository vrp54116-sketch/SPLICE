import { useEffect, useRef, useState, type ElementType } from 'react';
import {
  Activity, Bug, Check, CircleAlert, Database, Download, Heart, KeyRound, RefreshCw,
  RotateCcw, Server, ShieldCheck, Trash2, Upload, Volume2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '../store/useApp';
import { api } from '../lib/api';
import { sound } from '../lib/sound';
import { bytesUsed } from '../lib/db';
import { Card, Eyebrow, InfoNote, Modal, Segmented, Toggle } from '../components/ui';
import type { RightsPolicy } from '@shared/types';

interface Health { status: string; llm: string; asr: string; rights: string; localAsr: boolean; ytdlpVersion: string | null; ffmpeg: string; busy: boolean; queueSize: number; uptime: number; storageLimitGb: number; maxDurationMin: number }

export function Settings() {
  const { settings, setSetting, config, setConfig, clips, projects, restoreDemos, clearLocalData, navigate, brand } = useApp();
  const [health, setHealth] = useState<Health | null>(null);
  const [storage, setStorage] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => { void api<Health>('/api/health').then(setHealth).catch(() => setHealth(null)); void bytesUsed().then(setStorage); };
  useEffect(refresh, []);

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), clips, projects, settings, brand, config }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `splice-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href);
    toast.success('Local data exported');
  };

  const importData = () => {
    try {
      const data = JSON.parse(importText) as { clips?: typeof clips; projects?: typeof projects; settings?: typeof settings; brand?: typeof brand; config?: typeof config };
      if (!Array.isArray(data.clips) || !Array.isArray(data.projects)) throw new Error('Missing clips/projects arrays');
      useApp.setState((s) => ({ ...s, clips: [...data.clips!, ...s.clips.filter((c) => !data.clips!.some((x) => x.id === c.id))], projects: [...data.projects!, ...s.projects.filter((p) => !data.projects!.some((x) => x.id === p.id))], ...(data.settings ? { settings: { ...s.settings, ...data.settings } } : {}), ...(data.brand ? { brand: data.brand } : {}) }));
      setImportOpen(false); setImportText(''); sound.play('ready'); toast.success('Backup imported');
    } catch (e) { toast.error('Could not read that backup', { description: e instanceof Error ? e.message : '' }); }
  };

  return <div>
    <div className="mb-5"><Eyebrow>Settings · the control room</Eyebrow><h1 className="display mt-1 text-[clamp(24px,4vw,38px)] font-bold">Make it yours.</h1>
      <p className="mt-1 text-[13px] text-muted">No account, no subscription, no telemetry. Settings live in this browser.</p></div>

    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <Eyebrow>Profile</Eyebrow><h3 className="display mb-4 mt-1 text-lg">Workspace identity</h3>
        <div className="space-y-3">
          <div><label className="label">Display name</label><input className="field" value={settings.profileName} onChange={(e) => setSetting('profileName', e.target.value)} /></div>
          <div><label className="label">Avatar initials</label><input className="field mono" maxLength={3} value={settings.avatar} onChange={(e) => setSetting('avatar', e.target.value.toUpperCase())} /></div>
          <Toggle checked={settings.sound} onChange={(v) => { setSetting('sound', v); sound.setEnabled(v); }} label="Interface sound" description="WebAudio-synthesized clicks, reels and chimes. No audio files." />
          <Toggle checked={settings.reducedMotion} onChange={(v) => setSetting('reducedMotion', v)} label="Reduce motion" description="Minimize animation. System preference is also respected." />
          <div><label className="label">Rights policy</label>
            <Segmented value={settings.rightsPolicy} options={[{ value: 'strict', label: 'Strict' }, { value: 'balanced', label: 'Balanced' }, { value: 'own_content', label: 'Own content' }]} onChange={(v) => { setSetting('rightsPolicy', v as RightsPolicy); setConfig({ rightsPolicy: v as RightsPolicy }); }} />
            <div className="helper">Strict reduces virality weight and blocks earlier. Own content trusts your attestation more.</div>
          </div>
        </div>
      </Card>

      <Card>
        <Eyebrow>Engine</Eyebrow><h3 className="display mb-4 mt-1 text-lg">What's running</h3>
        <div className="space-y-2 text-[12px]">
          <HealthRow icon={Server} k="Server" v={health?.status ?? 'offline'} ok={health?.status === 'ok'} />
          <HealthRow icon={Activity} k="AI provider" v={health?.llm ?? '—'} />
          <HealthRow icon={Volume2} k="Transcription" v={health?.localAsr ? `${health.asr} · local model` : health?.asr ?? '—'} ok={health?.localAsr} />
          <HealthRow icon={ShieldCheck} k="Rights engine" v={health?.rights ?? '—'} ok={health?.rights !== 'dsp-heuristics'} />
          <HealthRow icon={KeyRound} k="yt-dlp" v={health?.ytdlpVersion ?? 'unavailable'} ok={Boolean(health?.ytdlpVersion)} />
          <HealthRow icon={Bug} k="ffmpeg" v={health?.ffmpeg ?? '—'} />
          <HealthRow icon={RefreshCw} k="Uptime" v={health ? `${Math.floor(health.uptime / 60)}m` : '—'} />
          <HealthRow icon={Database} k="Local storage" v={`${(storage / 1048576).toFixed(1)} MB`} />
        </div>
        <button className="btn mt-4 w-full" onClick={refresh}><RefreshCw size={14} />Refresh engine status</button>
        {health && !health.localAsr && <InfoNote tone="warn">No local ASR model found. Word-level captions only burn real detected words — none are invented. Upload your own transcript via a configured provider on a self-hosted instance.</InfoNote>}
      </Card>

      <Card>
        <Eyebrow>Self-hosting</Eyebrow><h3 className="display mb-4 mt-1 text-lg">Optional API token</h3>
        <div><label className="label">Bearer token (only if the server requires one)</label>
          <input className="field mono" type="password" placeholder="Leave empty for the free default" value={settings.selfHostToken} onChange={(e) => { setSetting('selfHostToken', e.target.value); if (e.target.value) localStorage.setItem('splice_api_token', e.target.value); else localStorage.removeItem('splice_api_token'); }} />
          <div className="helper">Stored only in this browser and sent as a Bearer header. The public free instance needs none.</div>
        </div>
        <div className="mt-4 rounded-lg border border-line bg-bg p-3 font-mono text-[11px] leading-relaxed text-muted">
          docker run -p 3001:3001 splice<br /># or one-click on Render Free via render.yaml
        </div>
      </Card>

      <Card>
        <Eyebrow>Data</Eyebrow><h3 className="display mb-4 mt-1 text-lg">Your library, your backup</h3>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn" onClick={exportData}><Download size={14} />Export backup</button>
          <button className="btn" onClick={() => setImportOpen(true)}><Upload size={14} />Import backup</button>
          <button className="btn" onClick={() => { restoreDemos(); toast.success('Demo pack restored'); }}><RotateCcw size={14} />Restore demos</button>
          <button className="btn btn-danger" onClick={() => setConfirmClear(true)}><Trash2 size={14} />Clear local data</button>
        </div>
        <div className="mt-4 text-[11px] leading-relaxed text-muted">{clips.length} clips · {projects.length} projects in IndexedDB. Clearing removes them from this browser only — it does not touch server files (which expire in 45 minutes anyway).</div>
      </Card>
    </div>

    <Card className="mt-4 bg-splice-deep/20">
      <Eyebrow>The truth about free</Eyebrow>
      <p className="mt-2 max-w-3xl text-[12px] leading-relaxed text-muted">
        SPLICE has no pricing, no login, no quotas, no watermarks, no expiry on your local library and no upsell modals. On Render Free the instance sleeps when idle — the first request after a nap can take a minute. One heavy job runs at a time. Rendered files on the server expire after 45 minutes. CLAIM SHIELD is a best-effort screen, not a copyright removal tool. That's the whole deal.
      </p>
      <div className="mt-3 flex flex-wrap gap-2"><span className="chip"><Check size={12} className="text-acid" />No account</span><span className="chip"><Check size={12} className="text-acid" />No watermark</span><span className="chip"><Check size={12} className="text-acid" />No tracking</span><span className="chip"><Heart size={12} className="text-splice" />Open source</span></div>
    </Card>

    <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import a local backup" footer={<><button className="btn" onClick={() => setImportOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={importData}>Import</button></>}>
      <p className="mb-3">Paste a SPLICE backup JSON. Existing items with the same IDs are kept.</p>
      <textarea className="field mono min-h-40" placeholder='{"version":1,"clips":[...],"projects":[...]}' value={importText} onChange={(e) => setImportText(e.target.value)} />
      <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then(setImportText); }} />
      <button className="btn mt-2 w-full" onClick={() => fileRef.current?.click()}>Choose a backup file</button>
    </Modal>

    <Modal open={confirmClear} onClose={() => setConfirmClear(false)} title="Clear all local data?"
      footer={<><button className="btn" onClick={() => setConfirmClear(false)}>Cancel</button><button className="btn btn-danger" onClick={() => { clearLocalData(); setConfirmClear(false); toast.success('Local library cleared'); navigate('home'); }}><Trash2 size={14} />Clear everything</button></>}>
      <div className="space-y-2"><p>This deletes {clips.length} clips, {projects.length} projects and all saved views from this browser.</p>
        <p className="text-danger">This cannot be undone. Export a backup first if you might want it back.</p></div>
    </Modal>
  </div>;
}

function HealthRow({ icon: Icon, k, v, ok }: { icon: ElementType; k: string; v: string; ok?: boolean }) {
  return <div className="flex items-center justify-between gap-3 border-b border-line/60 pb-2"><span className="flex items-center gap-2 text-muted"><Icon size={13} />{k}</span>
    <span className={`flex items-center gap-1 text-right font-medium ${ok === false ? 'text-amber' : ok === true ? 'text-acid' : ''}`}>{ok === true && <Check size={12} />}{ok === false && <CircleAlert size={12} />}<span className="max-w-[200px] truncate">{v}</span></span></div>;
}
