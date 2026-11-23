import { useRef, useState } from 'react';
import { Check, ImagePlus, RotateCcw, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { CAPTION_STYLES, type CaptionStyle } from '@shared/types';
import { useApp } from '../store/useApp';
import { sound } from '../lib/sound';
import { Card, Eyebrow, InfoNote, Segmented, Tip } from '../components/ui';

const SWATCHES = ['#FF4D2E', '#22D3EE', '#FF3DBE', '#A8E635', '#FFB020', '#F4F1EA', '#3A120C', '#10151D'];

export function Brand() {
  const { brand, setBrand, config, setConfig } = useApp();
  const [draft, setDraft] = useState(brand);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const put = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => { setDraft((d) => ({ ...d, [k]: v })); setSaved(false); };

  const loadLogo = (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('Keep the logo under 2 MB.'); return; }
    const r = new FileReader();
    r.onload = () => { put('logoDataUrl', String(r.result)); sound.play('paste'); };
    r.readAsDataURL(file);
  };

  const save = () => {
    setBrand(draft);
    setConfig({ brand: { ...draft }, captionStyle: draft.captionPreset });
    setSaved(true); sound.play('ready'); toast.success('Brand template saved', { description: 'It will be offered on new projects.' });
  };

  return <div>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><Eyebrow>Brand templates · the identity lab</Eyebrow><h1 className="display mt-1 text-[clamp(24px,4vw,38px)] font-bold">Your stamp on every cut.</h1>
        <p className="mt-1 text-[13px] text-muted">A brand template is a local preset: colors, caption preset, logo and opening/closing text.</p></div>
      <div className="flex gap-2"><button className="btn" onClick={() => { setDraft(brand); toast.info('Draft reset'); }}><RotateCcw size={14} />Reset</button>
        <button className="btn btn-primary" onClick={save}>{saved ? <Check size={15} /> : <Save size={15} />}{saved ? 'Saved' : 'Save template'}</button></div>
    </div>

    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        <Card>
          <Eyebrow>Identity</Eyebrow><h3 className="display mb-4 mt-1 text-lg">The basics</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">Brand name</label><input className="field" value={draft.name} maxLength={40} onChange={(e) => put('name', e.target.value)} /></div>
            <div><label className="label">Caption preset</label>
              <select className="field" value={draft.captionPreset} onChange={(e) => put('captionPreset', e.target.value as CaptionStyle)}>
                {CAPTION_STYLES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select></div>
          </div>
          <div className="mt-4"><label className="label">Logo (optional, kept local)</label>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => loadLogo(e.target.files?.[0])} />
            <div className="flex items-center gap-3">
              <button className="flex h-20 w-20 flex-col items-center justify-center rounded-lg border border-dashed border-line bg-bg text-muted hover:border-splice/60" onClick={() => fileRef.current?.click()}>
                {draft.logoDataUrl ? <img src={draft.logoDataUrl} alt="Brand logo" className="h-full w-full rounded-lg object-contain p-1" /> : <><ImagePlus size={20} /><span className="mt-1 text-[9px]">Upload</span></>}
              </button>
              <div className="text-[11px] text-muted">PNG, JPG or SVG up to 2 MB.<br />Stored in your browser, never uploaded.</div>
              {draft.logoDataUrl && <button className="icon-btn" aria-label="Remove logo" onClick={() => put('logoDataUrl', undefined)}><X size={15} /></button>}
            </div>
          </div>
        </Card>

        <Card>
          <Eyebrow>Palette</Eyebrow><h3 className="display mb-4 mt-1 text-lg">Two colors, your call</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <ColorField label="Primary" value={draft.primary} onChange={(v) => put('primary', v)} />
            <ColorField label="Accent" value={draft.accent} onChange={(v) => put('accent', v)} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">{SWATCHES.map((c) => <Tip key={c} label={c}><button className="h-7 w-7 rounded-full border-2 border-line hover:scale-110" style={{ background: c }} onClick={() => put('primary', c)} aria-label={`Use ${c}`} /></Tip>)}</div>
        </Card>

        <Card>
          <Eyebrow>Cards</Eyebrow><h3 className="display mb-4 mt-1 text-lg">Opening & closing</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">Intro text</label><input className="field" maxLength={74} placeholder="You won't believe what happens…" value={draft.introText ?? ''} onChange={(e) => put('introText', e.target.value)} /><div className="helper">Rendered as the auto-hook card when enabled.</div></div>
            <div><label className="label">Outro text</label><input className="field" maxLength={74} placeholder="Follow for more" value={draft.outroText ?? ''} onChange={(e) => put('outroText', e.target.value)} /><div className="helper">A short end card burned into the last second.</div></div>
          </div>
          <div className="mt-4"><Segmented label="Apply caption preset to new projects" value={draft.captionPreset === config.captionStyle ? 'yes' : 'no'} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} onChange={(v) => { if (v === 'yes') setConfig({ captionStyle: draft.captionPreset }); }} /></div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="!p-0 overflow-hidden">
          <div className="border-b border-line p-3 text-[11px] uppercase tracking-wider text-muted">Live preview · 9:16</div>
          <div className="relative mx-auto my-4 aspect-[9/16] w-[210px] overflow-hidden rounded-lg border border-line" style={{ background: `linear-gradient(160deg, ${draft.primary}55, #10151D 50%, ${draft.accent}33)` }}>
            <div className="sprocket absolute inset-0 opacity-20" />
            {draft.logoDataUrl && <img src={draft.logoDataUrl} alt="" className="absolute left-3 top-3 h-9 w-9 rounded object-contain" />}
            <div className="absolute left-3 top-16 display text-sm font-bold">{draft.name}</div>
            <div className="absolute inset-x-3 bottom-16 rounded px-2 py-1 text-center text-[11px] font-bold text-white" style={{ background: `${draft.primary}cc` }}>{draft.introText || 'Your hook appears here'}</div>
            <div className="absolute inset-x-3 bottom-6 text-center text-[9px] font-semibold" style={{ color: draft.accent }}>{draft.outroText || 'Your outro text'}</div>
          </div>
        </Card>
        <InfoNote><strong className="text-ivory">No hidden branding.</strong> SPLICE never adds a watermark. Brand templates are previews and local presets only — they do not alter the CLAIM SHIELD score.</InfoNote>
        <Card>
          <Eyebrow>Tip</Eyebrow>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">Keep captions on. Burned-in word-level captions are the single strongest retention signal in the heuristic scorer — and they are drawn locally, not fetched.</p>
        </Card>
      </div>
    </div>
  </div>;
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <div><label className="label">{label}</label><div className="flex items-center gap-2">
    <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-10 w-12 cursor-pointer rounded border border-line bg-bg" aria-label={`${label} color picker`} />
    <input className="field mono" value={value} onChange={(e) => onChange(e.target.value)} />
  </div></div>;
}
