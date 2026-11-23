/** WebAudio synthesis. No audio files. Lazy context on first gesture, ON by default. */
type Sound = 'click' | 'paste' | 'start' | 'tick' | 'ready' | 'blocked' | 'flap' | 'perfect' | 'medal' | 'fail';

class SoundEngine {
  ctx: AudioContext | null = null;
  enabled = true;
  private last = 0;

  constructor() {
    try { this.enabled = localStorage.getItem('splice_sound') !== 'off'; } catch { /* ignore */ }
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend(); else if (this.enabled) void this.ctx.resume();
    });
  }

  ensure() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) this.ctx = new Ctor();
    }
    if (this.ctx?.state === 'suspended' && !document.hidden) void this.ctx.resume();
    return this.ctx;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    try { localStorage.setItem('splice_sound', on ? 'on' : 'off'); } catch { /* ignore */ }
    if (on) this.ensure();
  }

  private tone(freq: number, duration: number, type: OscillatorType, gain: number, when = 0, glide?: number) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t + duration);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start(t); osc.stop(t + duration + 0.02);
  }

  private noise(duration: number, gain: number, when = 0, hp = 1200) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const len = Math.floor(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t);
  }

  play(s: Sound) {
    if (!this.enabled) return;
    const now = performance.now();
    if (s === 'tick' && now - this.last < 200) return;
    this.last = now;
    switch (s) {
      case 'click': this.tone(520, .045, 'triangle', .045); break;
      case 'paste': this.tone(523, .09, 'sine', .08); this.tone(784, .14, 'sine', .08, .09); break;
      case 'start':
        this.noise(.45, .10, 0, 400);
        for (let i = 0; i < 7; i++) this.tone(180 + i * 60, .04, 'square', .035, i * .055);
        break;
      case 'tick': this.tone(880, .035, 'sine', .04); break;
      case 'ready':
        [523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, .38, 'sine', .09, i * .11));
        break;
      case 'blocked': this.tone(110, .28, 'sawtooth', .11, 0, 55); this.noise(.18, .05, 0, 200); break;
      case 'flap': this.tone(320, .07, 'square', .05, 0, 180); break;
      case 'perfect': this.tone(1046, .12, 'sine', .09); this.tone(1568, .18, 'sine', .07, .08); break;
      case 'medal': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, .3, 'triangle', .08, i * .1)); break;
      case 'fail': this.tone(220, .35, 'sawtooth', .09, 0, 70); break;
    }
  }
}

export const sound = new SoundEngine();
