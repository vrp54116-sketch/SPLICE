import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  BarChart3, BookOpen, Clapperboard, ClapperboardIcon, Command, Film, FolderHeart, Grid2X2,
  HelpCircle, Home, Keyboard, Layers3, Library, Menu, Plus, Settings as SettingsIcon, ShieldCheck,
  Sparkles, Volume2, VolumeX, WandSparkles, X,
} from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { useApp, type Page } from '../store/useApp';
import { api } from '../lib/api';
import { sound } from '../lib/sound';
import { bytesUsed } from '../lib/db';
import { Drawer, Modal } from './ui';

const NAV: Array<{ group: string; items: Array<{ id: Page | 'shortcuts' | 'help'; label: string; icon: React.ElementType }> }> = [
  { group: 'Studio', items: [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'processing', label: 'Processing', icon: Clapperboard },
    { id: 'library', label: 'Library', icon: Library },
  ]},
  { group: 'Tools', items: [
    { id: 'brand', label: 'Brand Templates', icon: Sparkles },
    { id: 'scheduler', label: 'Social Scheduler', icon: Layers3 },
    { id: 'stats', label: 'Studio Stats', icon: BarChart3 },
  ]},
  { group: 'Workspace', items: [
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
    { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
    { id: 'help', label: 'Help', icon: HelpCircle },
  ]},
];

const TITLES: Record<Page, string> = {
  home: 'Home', configure: 'New project', processing: 'Processing', results: 'Results',
  editor: 'Editor', library: 'Library', brand: 'Brand Templates', scheduler: 'Social Scheduler',
  stats: 'Studio Stats', settings: 'Settings',
};

function DustMotes() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    let raf = 0;
    const motes = Array.from({ length: 40 }, () => ({
      x: Math.random() * innerWidth, y: Math.random() * innerHeight,
      r: Math.random() * 1.6 + .3, vy: -(Math.random() * .18 + .05), vx: (Math.random() - .5) * .12,
      a: Math.random() * .4 + .1,
    }));
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
      // Intrinsic buffer is in device pixels; the CSS box must stay in CSS pixels
      // or the canvas widens the layout viewport on mobile (and at dpr > 1).
      canvas.style.width = `${innerWidth}px`; canvas.style.height = `${innerHeight}px`;
    };
    resize(); addEventListener('resize', resize);
    const draw = () => {
      if (!document.hidden) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#F4F1EA';
        for (const m of motes) {
          m.y += m.vy; m.x += m.vx;
          if (m.y < -10) { m.y = canvas.height / Math.min(devicePixelRatio, 1.5) + 10; m.x = Math.random() * innerWidth; }
          ctx.globalAlpha = m.a;
          ctx.beginPath(); ctx.arc(m.x * Math.min(devicePixelRatio, 1.5), m.y * Math.min(devicePixelRatio, 1.5), m.r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={ref} className="dust" aria-hidden />;
}

function BootScreen({ onDone }: { onDone: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  const [dots, setDots] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    const d = setInterval(() => setDots((v) => (v + 1) % 4), 400);
    let done = false;
    const ping = async () => {
      try { await api('/api/health'); if (!done) { done = true; setTimeout(onDone, 350); } }
      catch { if (!done) setTimeout(ping, 700); }
    };
    void ping();
    return () => { clearInterval(t); clearInterval(d); done = true; };
  }, [onDone]);
  const leader = Math.min(9, Math.floor(elapsed / 1.2));
  return <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-[#05070A]">
    <div className="mb-8 text-center">
      <div className="display text-3xl font-bold tracking-tighter sm:text-5xl">SPLICE<span className="text-splice">.</span></div>
      <div className="mt-2 font-mono text-[11px] tracking-[.3em] text-muted">MIDNIGHT SPLICE LAB</div>
    </div>
    <div className="relative h-40 w-40 overflow-hidden rounded-lg border-2 border-line bg-black sm:h-52 sm:w-52">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="display text-7xl font-bold text-ivory" key={leader}>{9 - leader > 0 ? 9 - leader : '•'}</div>
      </div>
      <div className="absolute inset-0" style={{ background: 'conic-gradient(from 0deg, transparent 0 25%, rgba(255,77,46,.12) 25% 26%, transparent 26% 50%, rgba(255,77,46,.12) 50% 51%, transparent 51%)' }} />
      <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-ivory/20" />
      <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-ivory/20" />
    </div>
    <div className="mt-7 flex items-center gap-2 font-mono text-[12px] text-muted">
      <span className="rec-dot" /> Warming the projector{'.'.repeat(dots)}
    </div>
    <div className="mt-2 font-mono text-[10px] text-muted/60">{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')} · first boot can take a moment on the free tier</div>
  </div>;
}

function Sidebar() {
  const { page, navigate, collapsedRail, toggleRail, projects, clips, settings, setMobileNav } = useApp();
  const [editing, setEditing] = useState(false);
  const [storage, setStorage] = useState(0);
  useEffect(() => { void bytesUsed().then(setStorage); }, [clips.length]);
  const busy = projects.filter((p) => p.status === 'processing').length;
  return <aside className={`fixed left-0 top-0 z-50 hidden h-screen flex-col border-r border-line bg-surface/95 backdrop-blur md:flex ${collapsedRail ? 'w-16' : 'w-[var(--rail)]'}`} style={{ width: collapsedRail ? 64 : undefined }}>
    <div className={`flex h-14 items-center border-b border-line px-4 ${collapsedRail ? 'justify-center' : 'justify-between'}`}>
      {!collapsedRail && <button className="display text-[17px] font-bold tracking-tight" onClick={() => navigate('home')}>SPLICE<span className="text-splice">.</span></button>}
      <button className="icon-btn" aria-label={collapsedRail ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggleRail}>{collapsedRail ? <Menu size={18} /> : <X size={16} />}</button>
    </div>
    <div className="sprocket h-2 opacity-30" />
    <nav className="flex-1 overflow-y-auto px-2 py-4" aria-label="Main navigation">
      {NAV.map((group) => <div key={group.group} className="mb-4">
        {!collapsedRail && <div className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[.14em] text-muted/60">{group.group}</div>}
        {group.items.map(({ id, label, icon: Icon }) => {
          const active = page === id;
          return <button key={id} type="button" title={label} aria-current={active ? 'page' : undefined}
            onClick={() => { if (id === 'shortcuts' || id === 'help') useApp.getState().openDrawer(id); else navigate(id as Page); setMobileNav(false); sound.play('click'); }}
            className={`mb-0.5 flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left text-[13px] font-medium transition-colors ${active ? 'bg-splice-deep text-ivory' : 'text-muted hover:bg-overlay hover:text-text'} ${collapsedRail ? 'justify-center' : ''}`}>
            <Icon size={17} className={active ? 'text-splice' : ''} />
            {!collapsedRail && <span className="flex-1 truncate">{label}</span>}
            {!collapsedRail && id === 'processing' && busy > 0 && <span className="rounded-full bg-splice px-1.5 py-0.5 font-mono text-[10px] text-[#0A0D12]">{busy}</span>}
          </button>;
        })}
      </div>)}
    </nav>
    <div className="border-t border-line p-3">
      {!collapsedRail && <div className="mb-3 rounded-lg border border-line bg-overlay/70 p-2.5">
        {editing ? <input autoFocus className="field" defaultValue={settings.profileName} onBlur={(e) => { useApp.getState().setSetting('profileName', e.target.value || 'Local editor'); setEditing(false); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          : <button className="flex w-full items-center gap-2 text-left" onClick={() => setEditing(true)} title="Edit workspace profile">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-splice-deep font-mono text-[11px] text-splice">{settings.avatar}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold">{settings.profileName}</span><span className="block text-[10px] text-muted">Local workspace</span></span>
          </button>}
      </div>}
      {!collapsedRail && <div className="mb-2 flex items-center gap-2 text-[11px] text-muted"><ShieldCheck size={13} className="text-acid" />CLAIM SHIELD on</div>}
      <div className={`font-mono text-[10px] leading-relaxed text-muted/70 ${collapsedRail ? 'text-center' : ''}`}>
        Free forever · no account{!collapsedRail && <><br />{(storage / 1048576).toFixed(1)} MB local storage</>}
      </div>
    </div>
  </aside>;
}

function TopBar() {
  const { page, openDrawer, setSetting, config, navigate } = useApp();
  const [soundOn, setSoundOn] = useState(sound.enabled);
  return <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-line bg-bg/85 px-3 backdrop-blur-md sm:px-5">
    <button className="icon-btn md:hidden" aria-label="Open navigation" onClick={() => useApp.getState().setMobileNav(true)}><Menu size={19} /></button>
    <div className="flex min-w-0 items-center gap-2 text-[12px] text-muted">
      <Film size={15} className="text-splice" /><span className="hidden sm:inline">SPLICE</span><span className="opacity-40">/</span>
      <span className="truncate font-semibold text-text">{TITLES[page]}</span>
    </div>
    <div className="ml-auto flex items-center gap-1.5">
      <button className="hidden items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11px] text-muted hover:text-text sm:flex" onClick={() => openDrawer('palette')} aria-label="Open command palette">
        <Command size={13} /><span className="font-mono">⌘K</span>
      </button>
      <button className="icon-btn" aria-label={soundOn ? 'Mute interface sound' : 'Unmute interface sound'} title={`Sound ${soundOn ? 'on' : 'off'}`}
        onClick={() => { sound.setEnabled(!soundOn); setSoundOn(!soundOn); setSetting('sound', !soundOn); }}>
        {soundOn ? <Volume2 size={17} className="text-cyan" /> : <VolumeX size={17} />}
      </button>
      <button className="chip hidden lg:inline-flex" onClick={() => navigate('settings')} title="Current rights policy — change in Settings">
        <ShieldCheck size={12} className="text-acid" />Policy: {config.rightsPolicy}
      </button>
      <button className="btn btn-primary !min-h-[36px] !px-3" onClick={() => { navigate('configure'); sound.play('start'); }}>
        <Plus size={16} /><span className="hidden sm:inline">New project</span>
      </button>
    </div>
  </header>;
}

function BottomTabs() {
  const { page, navigate, openDrawer } = useApp();
  const items = [
    { id: 'home' as const, icon: Home, label: 'Home' },
    { id: 'configure' as const, icon: ClapperboardIcon, label: 'New' },
    { id: 'library' as const, icon: Grid2X2, label: 'Library' },
    { id: 'stats' as const, icon: BarChart3, label: 'Stats' },
    { id: 'settings' as const, icon: SettingsIcon, label: 'Settings' },
  ];
  return <nav className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="Mobile navigation">
    {items.map(({ id, icon: Icon, label }) => <button key={id} onClick={() => navigate(id)} aria-current={page === id ? 'page' : undefined}
      className={`flex min-w-[64px] flex-col items-center gap-1 py-2 text-[10px] ${page === id ? 'text-splice' : 'text-muted'}`}><Icon size={18} />{label}</button>)}
    <button onClick={() => openDrawer('help')} className="flex min-w-[64px] flex-col items-center gap-1 py-2 text-[10px] text-muted"><BookOpen size={18} />Help</button>
  </nav>;
}

function MobileNavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { page, navigate, settings } = useApp();
  return <Drawer open={open} onClose={onClose} title="Navigation" side="left">
    <div className="mb-5 flex items-center gap-3 rounded-lg border border-line bg-overlay p-3">
      <span className="grid h-10 w-10 place-items-center rounded-md bg-splice-deep font-mono text-splice">{settings.avatar}</span>
      <div><div className="font-semibold">{settings.profileName}</div><div className="text-[11px] text-muted">Local workspace · free forever</div></div>
    </div>
    {NAV.flatMap((g) => g.items).map(({ id, label, icon: Icon }) => <button key={id}
      onClick={() => { if (id === 'shortcuts' || id === 'help') useApp.getState().openDrawer(id); else navigate(id as Page); onClose(); }}
      className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-[13px] ${page === id ? 'bg-splice-deep' : 'hover:bg-overlay'}`}>
      <Icon size={17} />{label}
    </button>)}
  </Drawer>;
}

export function Shell({ children, onBoot }: { children: React.ReactNode; onBoot: () => void }) {
  const { collapsedRail, mobileNav, setMobileNav, drawer, openDrawer } = useApp();
  const [boot, setBoot] = useState(true);
  const section = useApp((s) => s.page);
  useEffect(() => { document.body.dataset.section = ['configure'].includes(section) ? 'configure' : ['results', 'editor'].includes(section) ? 'results' : 'home'; }, [section]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openDrawer('palette'); }
      if (e.key === 'Escape') openDrawer(null);
      if (e.key === '?' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) openDrawer('help');
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [openDrawer]);
  return <>
    {boot && <BootScreen onDone={() => { setBoot(false); onBoot(); }} />}
    <DustMotes />
    <div className="scanlines" aria-hidden />
    <Sidebar />
    <MobileNavDrawer open={mobileNav} onClose={() => setMobileNav(false)} />
    <div className={`min-h-screen transition-[padding] ${collapsedRail ? 'md:pl-16' : 'md:pl-[var(--rail)]'}`}>
      <TopBar />
      <main className="mx-auto w-full max-w-[1600px] px-3 pb-28 pt-5 sm:px-5 md:pb-10 lg:px-7">{children}</main>
    </div>
    <BottomTabs />
    <Toaster theme="dark" position="bottom-right" richColors closeButton toastOptions={{ className: '!bg-overlay !border-line !text-text' }} />
    <Drawer open={drawer === 'shortcuts'} onClose={() => openDrawer(null)} title="Keyboard shortcuts">
      <ShortcutList />
    </Drawer>
    <Drawer open={drawer === 'help'} onClose={() => openDrawer(null)} title="Help & troubleshooting">
      <HelpContent />
    </Drawer>
    <Drawer open={drawer === 'palette'} onClose={() => openDrawer(null)} title="Command palette">
      <CommandPaletteContent />
    </Drawer>
    <RatingModal />
  </>;
}

function ShortcutList() {
  const rows = [
    ['⌘ V', 'Focus the URL paste field'], ['Enter', 'Probe a pasted link'], ['⌘ K', 'Command palette'],
    ['Esc', 'Close the open panel'], ['⌘ Z', 'Undo in the editor'], ['Space', 'Flap in Splice!'],
    ['P', 'Pause the game'], ['R', 'Restart the game'], ['?', 'Open this help'],
  ];
  return <div className="space-y-1">{rows.map(([k, v]) => <div key={k} className="flex items-center justify-between gap-4 rounded-lg border border-line bg-overlay/50 px-3 py-2.5">
    <span className="text-[13px]">{v}</span><kbd className="rounded border border-line bg-bg px-2 py-0.5 font-mono text-[11px] text-cyan">{k}</kbd>
  </div>)}</div>;
}

const REMEDY_ROWS: Array<[string, string]> = [
  ['BOT_BLOCKED', 'Add YT_COOKIES_B64 (base64 Netscape cookies) and optionally YT_PROXY. The importer retries tv → web_safari → android automatically. Uploading directly always works.'],
  ['LIVE_UNSUPPORTED', 'Live streams cannot be imported. Wait for the broadcast to finish, then paste the finished video URL.'],
  ['AGE_RESTRICTED', 'Add YouTube cookies or upload the file directly from a browser where you are signed in.'],
  ['GEO_BLOCKED', 'Set YT_PROXY to a region where the video is available, or upload directly.'],
  ['TOO_LARGE', 'Files are capped at 2 GB and 120 minutes. Trim or downscale locally first.'],
  ['RIGHTS_BLOCKED', 'Open the clip’s Rights tab, review the per-parameter evidence and run a legal repair. CLAIM SHIELD is a best-effort screen, not a copyright ruling.'],
  ['SERVER_BUSY', 'One heavy job runs at a time on the free tier. The queue position is shown live; the next job starts automatically.'],
  ['ENGINE_UNAVAILABLE', 'Rebuild the Docker image so ffmpeg and yt-dlp are installed. Browser offload needs a modern Chromium-based browser.'],
];

function HelpContent() {
  const [q, setQ] = useState('');
  const rows = REMEDY_ROWS.filter(([c, r]) => `${c} ${r}`.toLowerCase().includes(q.toLowerCase()));
  return <div className="space-y-4">
    <input className="field" placeholder="Search an error code or symptom…" value={q} onChange={(e) => setQ(e.target.value)} />
    <div className="space-y-2">{rows.map(([c, r]) => <div key={c} className="rounded-lg border border-line bg-bg p-3">
      <div className="mb-1 font-mono text-[11px] font-semibold text-splice">{c}</div><div className="text-[12px] leading-relaxed text-muted">{r}</div>
    </div>)}</div>
    <div className="rounded-lg border border-line bg-splice-deep/40 p-3 text-[12px] leading-relaxed text-muted">
      <strong className="text-ivory">The rights truth.</strong> CLAIM SHIELD is best-effort prevention. It does not remove copyright, bypass Content ID, or guarantee monetization. Platform detection is final.
    </div>
  </div>;
}

function CommandPaletteContent() {
  const { navigate, config, addView } = useApp();
  const [q, setQ] = useState('');
  const commands = useMemo(() => [
    { label: 'New project', run: () => navigate('configure'), icon: Plus },
    { label: 'Paste a video link and probe', run: () => { navigate('configure'); setTimeout(() => document.getElementById('url-input')?.focus(), 200); }, icon: Command },
    { label: 'Go to Home', run: () => navigate('home'), icon: Home },
    { label: 'Go to Library', run: () => navigate('library'), icon: Library },
    { label: 'Go to Processing', run: () => navigate('processing'), icon: Clapperboard },
    { label: 'Go to Studio Stats', run: () => navigate('stats'), icon: BarChart3 },
    { label: 'Toggle interface sound', run: () => { sound.setEnabled(!sound.enabled); toast.success(`Sound ${sound.enabled ? 'off' : 'on'}`); }, icon: Volume2 },
    { label: 'Export current config', run: () => {
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'splice-config.json'; a.click(); URL.revokeObjectURL(a.href);
    }, icon: WandSparkles },
    { label: 'Open Settings', run: () => navigate('settings'), icon: SettingsIcon },
    { label: 'Seed saved view: High score', run: () => { addView({ id: `view_${Date.now()}`, name: 'High score copy', filter: 'All', sort: 'Score' }); toast.success('Saved view added'); }, icon: FolderHeart },
  ], [navigate, config, addView]);
  const filtered = commands.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));
  return <div>
    <input autoFocus className="field mb-3" placeholder="Type a command…" value={q} onChange={(e) => setQ(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' && filtered[0]) { filtered[0].run(); useApp.getState().openDrawer(null); } }} />
    <div>{filtered.map((c) => <button key={c.label} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] hover:bg-overlay" onClick={() => { c.run(); useApp.getState().openDrawer(null); }}>
      <c.icon size={16} className="text-splice" />{c.label}</button>)}</div>
    {!filtered.length && <div className="py-8 text-center text-[12px] text-muted">No command matched. Try “new”, “library” or “sound”.</div>}
  </div>;
}

function RatingModal() {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const check = () => setOpen(localStorage.getItem('splice_downloaded') === '1' && !localStorage.getItem('splice_rated'));
    check(); addEventListener('storage', check);
    const t = setTimeout(check, 1500);
    return () => { removeEventListener('storage', check); clearTimeout(t); };
  }, []);
  const rate = (v: string) => { localStorage.setItem('splice_rated', v); setDone(true); setTimeout(() => setOpen(false), 350); toast.success('Thanks — local scoring weights updated.'); };
  return <Modal open={open && !done} onClose={() => setOpen(false)} title="How were those clips?">
    <p className="mb-4">Your answer tunes the local scoring weights. Nothing leaves this device.</p>
    <div className="grid grid-cols-2 gap-2">
      {['Not quite', 'Pretty good', 'Loved them', 'Maybe later'].map((v) => <button key={v} className="btn" onClick={() => rate(v)}>{v}</button>)}
    </div>
  </Modal>;
}

export function markDownloaded() { localStorage.setItem('splice_downloaded', '1'); }

export function motionPrefs() {
  const reduced = useApp.getState().settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
  return reduced ? { duration: .14 } : { type: 'spring' as const, stiffness: 360, damping: 30 };
}

export { motion };
