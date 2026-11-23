import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useApp } from '../store/useApp';
import { sound } from '../lib/sound';

interface Gate { x: number; gapY: number; scored: boolean }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; hue: number }
interface State {
  y: number; vy: number; gates: Gate[]; score: number; combo: number; best: number;
  running: boolean; over: boolean; particles: Particle[]; shake: number; t: number;
  medal: '' | 'Bronze' | 'Silver' | 'Gold'; perfect: number;
}

const GRAVITY = 1800, FLAP = -520;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function SpliceGame({ celebrating = false }: { celebrating?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const state = useRef<State>({ y: 0, vy: 0, gates: [], score: 0, combo: 0, best: 0, running: false, over: false, particles: [], shake: 0, t: 0, medal: '', perfect: 0 });
  const [ui, setUi] = useState({ score: 0, best: 0, over: false, paused: true, medal: '', combo: 0, perfect: false });
  const [muted, setMuted] = useState(!sound.enabled);
  const pausedByUser = useRef(false);
  const lastUi = useRef(0);

  useEffect(() => { state.current.best = useApp.getState().settings.gameBest; setUi((u) => ({ ...u, best: state.current.best })); }, []);

  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    let raf = 0, last = performance.now(), W = 320, H = 420, dpr = 1;
    const resize = () => {
      dpr = Math.min(devicePixelRatio || 1, 2);
      W = wrap.clientWidth; H = wrap.clientHeight;
      canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
      canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize(); addEventListener('resize', resize);

    const reset = () => {
      const s = state.current;
      s.y = H / 2; s.vy = 0; s.gates = [{ x: W + 60, gapY: H / 2, scored: false }];
      s.score = 0; s.combo = 0; s.over = false; s.running = true; s.particles = []; s.shake = 0; s.medal = ''; s.perfect = 0;
      pausedByUser.current = false;
      setUi({ score: 0, best: s.best, over: false, paused: false, medal: '', combo: 0, perfect: false });
    };
    (window as unknown as { __spliceGameReset?: () => void }).__spliceGameReset = reset;

    const flap = () => {
      const s = state.current;
      if (s.over) { reset(); return; }
      if (!s.running) return;
      s.vy = FLAP; sound.play('flap');
    };
    (window as unknown as { __spliceGameFlap?: () => void }).__spliceGameFlap = flap;
    (window as unknown as { __spliceGameToggle?: () => void }).__spliceGameToggle = () => {
      const s = state.current;
      pausedByUser.current = !pausedByUser.current;
      setUi((u) => ({ ...u, paused: pausedByUser.current }));
      void s;
    };

    const drawClapper = (x: number, y: number, angle: number) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
      ctx.fillStyle = '#10151D'; ctx.strokeStyle = '#F4F1EA'; ctx.lineWidth = 2;
      ctx.fillRect(-15, -11, 30, 22); ctx.strokeRect(-15, -11, 30, 22);
      ctx.fillStyle = '#FF4D2E'; ctx.fillRect(-15, -11, 30, 6);
      ctx.fillStyle = '#0A0D12';
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-12 + i * 8, -11); ctx.lineTo(-8 + i * 8, -5); ctx.lineTo(-4 + i * 8, -11); ctx.fill(); }
      ctx.restore();
    };

    const frame = (now: number) => {
      const dt = Math.min(.032, (now - last) / 1000); last = now;
      const s = state.current;
      if (!document.hidden && s.running && !pausedByUser.current && !celebrating) {
        s.t += dt;
        s.vy += GRAVITY * dt; s.y += s.vy * dt;
        const speed = 160 + Math.min(100, s.score * 2.2);
        const gap = 190 - Math.min(50, s.score * 1.2);
        for (const g of s.gates) {
          g.x -= speed * dt;
          if (!g.scored && g.x < 34) {
            g.scored = true;
            const center = g.gapY;
            const off = Math.abs(s.y - center);
            if (off < 34 && s.y > center - gap / 2 && s.y < center + gap / 2) {
              s.combo++; s.perfect++; s.score += 2 + Math.min(3, s.combo);
              s.particles.push(...Array.from({ length: 16 }, (_, i) => ({ x: 34, y: s.y, vx: Math.random() * 160 + 40, vy: (Math.random() - .5) * 220, life: .7, hue: [10, 48, 185, 315][i % 4]! })));
              s.shake = 5; sound.play('perfect');
            } else if (s.y > center - gap / 2 && s.y < center + gap / 2) {
              s.score += 1; s.combo = 0; sound.play('tick');
            } else { s.over = true; sound.play('fail'); }
            s.medal = s.score >= 50 ? 'Gold' : s.score >= 25 ? 'Silver' : s.score >= 10 ? 'Bronze' : '';
            if (s.score > s.best) { s.best = s.score; useApp.getState().setSetting('gameBest', s.score); }
          }
        }
        s.gates = s.gates.filter((g) => g.x > -50);
        const lastGate = s.gates.at(-1);
        if (!lastGate || lastGate.x < W - 190) {
          s.gates.push({ x: W + 20, gapY: clamp(lastGate ? lastGate.gapY + (Math.random() - .5) * 130 : H / 2, gap / 2 + 40, H - gap / 2 - 40), scored: false });
        }
        if (s.y > H - 12 || s.y < 12) { s.over = true; sound.play('fail'); }
        s.particles = s.particles.filter((p) => { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; return p.life > 0; });
        s.shake *= .86;
        if (s.medal && ['Bronze', 'Silver', 'Gold'].includes(s.medal) && s.perfect === 3) sound.play('medal');
      }

      // render
      ctx.save();
      if (s.shake > .2) ctx.translate((Math.random() - .5) * s.shake, (Math.random() - .5) * s.shake);
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#0A0D12'); bg.addColorStop(.6, '#10151D'); bg.addColorStop(1, '#1a1010');
      ctx.fillStyle = bg; ctx.fillRect(-10, -10, W + 20, H + 20);
      // parallax studio windows
      for (let layer = 0; layer < 3; layer++) {
        const oy = (s.t * (6 + layer * 7)) % 80;
        ctx.fillStyle = ['rgba(255,77,46,.04)', 'rgba(34,211,238,.035)', 'rgba(255,61,190,.03)'][layer]!;
        for (let y = -80 + oy; y < H; y += 80) ctx.fillRect(0, y, W, 26);
      }
      // filmstrip gates
      for (const g of s.gates) {
        const gh = gapFor(s.score);
        ctx.fillStyle = '#070A0E'; ctx.fillRect(g.x, 0, 44, g.gapY - gh / 2); ctx.fillRect(g.x, g.gapY + gh / 2, 44, H);
        ctx.fillStyle = '#FF4D2E'; ctx.fillRect(g.x, g.gapY - gh / 2 - 3, 44, 3); ctx.fillRect(g.x, g.gapY + gh / 2, 44, 3);
        ctx.fillStyle = 'rgba(244,241,234,.22)';
        for (let y = 8; y < g.gapY - gh / 2; y += 18) ctx.fillRect(g.x + 18, y, 8, 8);
        for (let y = g.gapY + gh / 2 + 10; y < H; y += 18) ctx.fillRect(g.x + 18, y, 8, 8);
      }
      for (const p of s.particles) {
        ctx.globalAlpha = clamp(p.life / .7, 0, 1);
        ctx.fillStyle = `hsl(${p.hue} 90% 60%)`; ctx.fillRect(p.x, p.y, 4, 4);
      }
      ctx.globalAlpha = 1;
      drawClapper(34, s.y, clamp(s.vy / 900, -.5, 1.1));
      ctx.restore();

      if (now - lastUi.current > 120) {
        lastUi.current = now;
        setUi({ score: s.score, best: s.best, over: s.over, paused: pausedByUser.current || !s.running, medal: s.medal, combo: s.combo, perfect: s.perfect > 0 });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); flap(); }
      if (e.key.toLowerCase() === 'p') (window as unknown as { __spliceGameToggle?: () => void }).__spliceGameToggle?.();
      if (e.key.toLowerCase() === 'r') reset();
    };
    addEventListener('keydown', onKey);
    const onClick = () => flap();
    canvas.addEventListener('pointerdown', onClick);
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize); removeEventListener('keydown', onKey); canvas.removeEventListener('pointerdown', onClick); };
  }, [celebrating]);

  const reset = () => (window as unknown as { __spliceGameReset?: () => void }).__spliceGameReset?.();

  return <div className="panel overflow-hidden">
    <div className="flex items-center justify-between border-b border-line px-3 py-2">
      <div className="flex items-center gap-2"><span className="rec-dot" /><span className="display text-[13px]">SPLICE!</span><span className="chip">clapper vs. gates</span></div>
      <button className="icon-btn !h-8 !w-8" aria-label={muted ? 'Unmute game' : 'Mute game'} onClick={() => { sound.setEnabled(muted); setMuted(!muted); }}>{muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</button>
    </div>
    <div ref={wrapRef} className="relative h-[360px] w-full sm:h-[420px]" style={{ touchAction: 'manipulation' }}>
      <canvas ref={canvasRef} className="block" aria-label="Splice! flapping clapperboard game" />
      <div className="pointer-events-none absolute left-3 top-3 font-mono text-[11px] text-muted">
        <div>SCORE <span className="text-ivory">{ui.score}</span></div><div>BEST <span className="text-acid">{ui.best}</span></div>
        {ui.combo > 1 && <div className="text-cyan">COMBO ×{ui.combo}</div>}
      </div>
      {ui.perfect && !ui.over && <div className="pointer-events-none absolute left-1/2 top-16 -translate-x-1/2 rounded-full border border-acid/50 bg-acid/10 px-3 py-1 font-mono text-[11px] text-acid stamp-in">Perfect splice!</div>}
      {(!ui.paused && !ui.over) && <div className="pointer-events-none absolute bottom-2 left-0 right-0 text-center font-mono text-[10px] text-muted/70">SPACE / click to flap · P pause · R restart</div>}
      {(ui.over || celebrating) && <div className="absolute inset-0 grid place-items-center bg-black/65 backdrop-blur-sm">
        <div className="text-center">
          {celebrating ? <><div className="stamp-in display text-3xl font-bold text-acid">CLIPS READY</div><div className="mt-1 text-[12px] text-muted">Your cuts are waiting in Results.</div></> : <><div className="display text-2xl font-bold">Game over</div><div className="mono mt-1 text-[12px] text-muted">score {ui.score} · best {ui.best}</div>
            {ui.medal && <div className="mt-2 text-[13px] text-amber">{ui.medal} medal</div>}
            <button className="btn btn-primary mx-auto mt-4" onClick={reset}>Play again</button></>}
        </div>
      </div>}
      {ui.paused && !ui.over && !celebrating && <div className="absolute inset-0 grid place-items-center bg-black/55">
        <div className="text-center"><div className="display text-xl">{ui.score === 0 ? 'Ready to splice?' : 'Paused'}</div><div className="mt-1 text-[11px] text-muted">Tap the filmstrip or press Space</div>
          <button className="btn btn-primary mx-auto mt-4" onClick={() => { if (ui.score === 0) reset(); else (window as unknown as { __spliceGameToggle?: () => void }).__spliceGameToggle?.(); }}>{ui.score === 0 ? 'Start' : 'Resume'}</button>
        </div>
      </div>}
    </div>
  </div>;
}

const gapFor = (score: number) => 190 - Math.min(50, score * 1.2);
