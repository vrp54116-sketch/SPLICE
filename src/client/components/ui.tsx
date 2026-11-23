import React, { useEffect, useId, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown, CircleAlert, LockKeyhole, ShieldCheck, X } from 'lucide-react';
import type { ShieldTier } from '@shared/types';
import { sound } from '../lib/sound';

export function Card({ children, className = '', pad = true, ...rest }: React.HTMLAttributes<HTMLDivElement> & { pad?: boolean }) {
  return <div className={`panel ${pad ? 'p-4' : ''} ${className}`} {...rest}>{children}</div>;
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-muted"><span className="h-1.5 w-1.5 rotate-45 bg-splice" />{children}</div>;
}

export function SectionTitle({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return <div className="mb-4 flex items-end justify-between gap-4">
    <div>
      <h2 className="display text-xl font-semibold sm:text-2xl">{title}</h2>
      {sub && <p className="mt-1 max-w-2xl text-[13px] text-muted">{sub}</p>}
    </div>
    {right}
  </div>;
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  const id = useId();
  return <div className="flex items-center justify-between gap-4 py-1.5">
    <div className="min-w-0">
      <label htmlFor={id} className="mb-0 cursor-pointer text-[13px] font-semibold text-text">{label}</label>
      {description && <div className="helper">{description}</div>}
    </div>
    <button id={id} type="button" role="switch" aria-checked={checked} aria-label={label}
      className="switch" data-on={checked} onClick={() => { sound.play('click'); onChange(!checked); }} />
  </div>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string; hint?: string }>; onChange: (v: T) => void; label?: string }) {
  return <div>
    {label && <div className="label">{label}</div>}
    <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-bg p-1" role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" title={o.hint} aria-pressed={value === o.value}
        onClick={() => { sound.play('click'); onChange(o.value); }}
        className={`min-h-[34px] flex-1 rounded-md px-2.5 text-[12px] font-semibold transition-colors ${value === o.value ? 'bg-splice text-[#0A0D12]' : 'text-muted hover:bg-overlay hover:text-text'}`}>
        {o.label}
      </button>)}
    </div>
  </div>;
}

export function ShieldBadge({ tier, risk, small }: { tier: ShieldTier; risk: number; small?: boolean }) {
  const cls = tier === 'CLEAR' ? 'badge-clear' : tier === 'REVIEW' ? 'badge-review' : 'badge-blocked';
  const Icon = tier === 'CLEAR' ? ShieldCheck : tier === 'REVIEW' ? CircleAlert : LockKeyhole;
  return <span className={`badge ${cls}`} title={`CLAIM SHIELD risk ${risk}/100 — best-effort screen`}>
    <Icon size={small ? 11 : 13} strokeWidth={2.5} />{tier}
  </span>;
}

export function FlameBadge({ score }: { score: number }) {
  const color = score >= 85 ? 'var(--acid)' : score >= 70 ? 'var(--amber)' : 'var(--danger)';
  return <span className="badge" style={{ color, background: 'rgba(10,13,18,.7)', border: `1px solid ${color}55` }} title={`Virality score ${score}/100 — heuristic estimate, not a prediction`}>
    <span aria-hidden>▲</span>{score} <span className="opacity-70">viral</span>
  </span>;
}

/** Tiny local animated number — no external component dependency. */
export function NumberFlow({ value }: { value: number }) {
  const [shown, setShown] = React.useState(value);
  const shownRef = React.useRef(value);
  useEffect(() => {
    const from = shownRef.current;
    const delta = value - from;
    if (!delta) { shownRef.current = value; setShown(value); return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / 420);
      const v = Math.round(from + delta * (1 - Math.pow(1 - k, 3)));
      shownRef.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span>{shown}</span>;
}

export function StatTile({ label, value, suffix, icon: Icon }: { label: string; value: number; suffix?: string; icon?: React.ElementType }) {
  return <Card className="relative overflow-hidden">
    <div className="flex items-center justify-between text-muted">
      <span className="text-[11px] font-semibold uppercase tracking-[.12em]">{label}</span>
      {Icon && <Icon size={15} />}
    </div>
    <div className="mt-2 flex items-baseline gap-1">
      <span className="stat-number"><NumberFlow value={value} /></span>
      {suffix && <span className="text-[12px] text-muted">{suffix}</span>}
    </div>
  </Card>;
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`shimmer rounded-lg bg-overlay ${className}`} />;
}

export function EmptyState({ icon: Icon, title, body, action }: { icon: React.ElementType; title: string; body: string; action?: React.ReactNode }) {
  return <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-14 text-center">
    <div className="mb-3 rounded-full border border-line bg-overlay p-3 text-splice"><Icon size={22} /></div>
    <h3 className="display text-base">{title}</h3>
    <p className="mt-1 max-w-sm text-[13px] text-muted">{body}</p>
    {action && <div className="mt-4">{action}</div>}
  </div>;
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>('button,[href],input,textarea,select,[tabindex]:not([tabindex="-1"])')].filter((el) => !el.hasAttribute('disabled'));
        if (!items.length) return;
        const first = items[0]!, last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('button,input,textarea')?.focus());
    return () => { document.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [open, onClose]);
  return <AnimatePresence>{open && <motion.div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <motion.div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="panel-raised w-full max-w-lg p-5 shadow-2xl" initial={{ y: 16, scale: .98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 8, opacity: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
      <div className="mb-4 flex items-center justify-between"><h3 className="display text-lg">{title}</h3><button className="icon-btn" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></div>
      <div className="text-[13px] text-muted">{children}</div>
      {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
    </motion.div>
  </motion.div>}</AnimatePresence>;
}

export function Drawer({ open, onClose, title, side = 'right', children }: { open: boolean; onClose: () => void; title: string; side?: 'left' | 'right'; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('button,input')?.focus());
    return () => { document.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [open, onClose]);
  return <AnimatePresence>{open && <motion.div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
    <motion.aside ref={ref} role="dialog" aria-modal="true" aria-label={title}
      className={`fixed top-0 bottom-0 w-full max-w-[420px] overflow-y-auto border-line bg-surface p-5 ${side === 'right' ? 'right-0 border-l' : 'left-0 border-r'}`}
      initial={{ x: side === 'right' ? '100%' : '-100%' }} animate={{ x: 0 }} exit={{ x: side === 'right' ? '100%' : '-100%' }} transition={{ type: 'spring', stiffness: 380, damping: 36 }}>
      <div className="mb-5 flex items-center justify-between"><h3 className="display text-lg">{title}</h3><button className="icon-btn" aria-label="Close panel" onClick={onClose}><X size={18} /></button></div>
      {children}
    </motion.aside>
  </motion.div>}</AnimatePresence>;
}

export function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return <span className="group/tip relative inline-flex" tabIndex={0} aria-label={label}>
    {children}
    <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-overlay px-2 py-1 text-[10px] text-text opacity-0 shadow-lg transition-opacity group-hover/tip:opacity-100 group-focus/tip:opacity-100">{label}</span>
  </span>;
}

export function SelectSearch<T extends string>({ value, options, onChange, placeholder = 'Search…' }: { value: T; options: Array<{ value: T; label: string; hint?: string }>; onChange: (v: T) => void; placeholder?: string }) {
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const filtered = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  const current = options.find((o) => o.value === value);
  return <div className="relative">
    <button type="button" className="field flex items-center justify-between text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
      <span className={current ? '' : 'text-muted'}>{current?.label ?? placeholder}</span><ChevronDown size={15} className="text-muted" />
    </button>
    {open && <div className="panel-raised absolute z-40 mt-1 max-h-60 w-full overflow-auto p-1 shadow-2xl">
      <input autoFocus className="field mb-1" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
      {filtered.map((o) => <button key={o.value} type="button" className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-overlay"
        onClick={() => { onChange(o.value); setOpen(false); setQ(''); sound.play('click'); }}>
        <span>{o.label}</span>{o.value === value && <Check size={14} className="text-acid" />}
      </button>)}
      {!filtered.length && <div className="px-2 py-3 text-center text-[12px] text-muted">No matches</div>}
    </div>}
  </div>;
}

export function InfoNote({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'warn' | 'danger' }) {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? 'var(--amber)' : 'var(--cyan)';
  return <div className="flex gap-2.5 rounded-lg border p-3 text-[12px] leading-relaxed text-muted" style={{ borderColor: `${color}44`, background: `${color}0d` }}>
    <CircleAlert size={15} className="mt-0.5 shrink-0" style={{ color }} /><div>{children}</div>
  </div>;
}
