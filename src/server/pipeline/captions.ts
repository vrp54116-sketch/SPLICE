import type { CaptionStyle, Transcript, Word } from '@shared/types';

const STYLE: Record<CaptionStyle, { font: string; size: number; primary: string; secondary: string; outline: string; back: string; bold: number; italic: number; anim: string; align: number }> = {
  classic: { font: 'Space Grotesk', size: 58, primary: '&H00EAF1F4', secondary: '&H00FF4D2E', outline: '&H00000000', back: '&H90000000', bold: 0, italic: 0, anim: '', align: 2 },
  'cyan-slide': { font: 'Space Grotesk', size: 60, primary: '&H00EEFFFF', secondary: '&H0022D3EE', outline: '&H000A0D12', back: '&H8022D3EE', bold: -1, italic: 0, anim: '\\t(0,180,\\fscx112\\fscy112)\\t(180,300,\\fscx100\\fscy100)', align: 2 },
  'italic-red': { font: 'Space Grotesk', size: 64, primary: '&H002E4DFF', secondary: '&H00FFFFFF', outline: '&H00000000', back: '&H80000000', bold: -1, italic: -1, anim: '\\t(0,200,\\fscx108)', align: 2 },
  'cream-blue': { font: 'Unbounded', size: 46, primary: '&H00EAF1F4', secondary: '&H00FFB000', outline: '&H00121D2A', back: '&HE01A2740', bold: -1, italic: 0, anim: '', align: 2 },
  'red-spin': { font: 'Unbounded', size: 52, primary: '&H002E4DFF', secondary: '&H00FFFFFF', outline: '&H00000000', back: '&H903A120C', bold: -1, italic: 0, anim: '\\t(0,260,\\frz8)\\t(260,420,\\frz0)', align: 2 },
  'violet-glow': { font: 'Unbounded', size: 56, primary: '&H00FFF0FF', secondary: '&H00FF3DBE', outline: '&H00280E30', back: '&H90280E30', bold: -1, italic: 0, anim: '\\t(0,300,\\blur3)\\t(300,450,\\blur0)', align: 2 },
  'blue-glow': { font: 'Unbounded', size: 56, primary: '&H00F0FFFF', secondary: '&H0022D3EE', outline: '&H000A1A22', back: '&H900A1A22', bold: -1, italic: 0, anim: '\\t(0,300,\\blur4)\\t(300,450,\\blur0)', align: 2 },
  'toxic-green': { font: 'Space Grotesk', size: 62, primary: '&H0035E6A8', secondary: '&H00FF4D2E', outline: '&H00000000', back: '&H900A1200', bold: -1, italic: 0, anim: '\\t(0,120,\\fscx106\\fscy96)\\t(120,220,\\fscx100\\fscy100)', align: 2 },
  'neon-punch': { font: 'Unbounded', size: 58, primary: '&H00FFF0FA', secondary: '&H00FF3DBE', outline: '&H003A0C2A', back: '&H903A0C2A', bold: -1, italic: 0, anim: '\\t(0,150,\\fscx130\\fscy130)\\t(150,300,\\fscx100\\fscy100)', align: 2 },
  'karaoke-pop': { font: 'Space Grotesk', size: 62, primary: '&H00F4F1EA', secondary: '&H00A8E635', outline: '&H00000000', back: '&H90000000', bold: -1, italic: 0, anim: '\\t(0,150,\\fscy115)\\t(150,260,\\fscy100)', align: 2 },
  'minimal-mono': { font: 'IBM Plex Mono', size: 44, primary: '&H00F4F1EA', secondary: '&H008B94A7', outline: '&H00000000', back: '&H00000000', bold: 0, italic: 0, anim: '', align: 2 },
  'hinglish-bold': { font: 'Unbounded', size: 54, primary: '&H00F4F1EA', secondary: '&H00FFB020', outline: '&H00000000', back: '&H903A120C', bold: -1, italic: 0, anim: '\\t(0,200,\\fscx110)', align: 2 },
};

const assTime = (t: number) => {
  const cs = Math.max(0, Math.round(t * 100));
  return `${String(Math.floor(cs / 360000)).padStart(1, '0')}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};

const srtTime = (t: number) => {
  const ms = Math.max(0, Math.round(t * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};

const vttTime = (t: number) => srtTime(t).replace(',', '.');
const clean = (s: string) => s.replace(/\{[^}]*\}/g, '').replace(/\\N/g, ' ').trim();

export interface CaptionOptions {
  style: CaptionStyle;
  width: number;
  height: number;
  start: number;
  end: number;
  hook?: string;
  maxWords?: number;
}

/** Group words into readable caption cues. */
export function cues(words: Word[], start: number, end: number, maxWords = 4): Array<{ start: number; end: number; words: Word[] }> {
  const sel = words.filter((w) => w.end > start && w.start < end).sort((a, b) => a.start - b.start);
  const out: Array<{ start: number; end: number; words: Word[] }> = [];
  let cur: Word[] = [];
  for (const w of sel) {
    if (cur.length && (cur.length >= maxWords || w.start - cur[0]!.start > 2.4)) {
      out.push({ start: cur[0]!.start, end: cur[cur.length - 1]!.end, words: cur });
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) out.push({ start: cur[0]!.start, end: cur[cur.length - 1]!.end, words: cur });
  return out;
}

export function toAss(transcript: Transcript, opts: CaptionOptions): string {
  const s = STYLE[opts.style] ?? STYLE.classic;
  const scale = Math.min(opts.width / 1080, opts.height / 1920);
  const size = Math.round(s.size * (opts.width < 800 ? 0.85 : 1));
  const marginV = Math.round(190 * scale);
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${opts.width}
PlayResY: ${opts.height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${s.font},${size},${s.primary},${s.secondary},${s.outline},${s.back},${s.bold},${s.italic},0,0,100,100,0,0,1,4,2,${s.align},50,50,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines: string[] = [];
  list: for (const cue of cues(transcript.words, opts.start, opts.end)) {
    const relStart = cue.start - opts.start, relEnd = cue.end - opts.start;
    if (relEnd - relStart < 0.15) continue;
    let karaoke = '';
    for (const w of cue.words) {
      const cs = Math.max(1, Math.round((Math.min(w.end, cue.end) - Math.max(w.start, cue.start)) * 100));
      const text = clean(w.w).replace(/,/g, '\\,').replace(/:/g, '\\:');
      karaoke += `{\\k${cs}}${text} `;
      if (karaoke.length > 900) break list;
    }
    lines.push(`Dialogue: 0,${assTime(relStart)},${assTime(relEnd)},Default,,0,0,0,,${s.anim}${karaoke.trim()}`);
  }
  if (opts.hook) {
    lines.push(`Dialogue: 1,${assTime(0)},${assTime(Math.min(3, opts.end - opts.start))},Default,,0,0,0,,{\\pos(${(opts.width / 2).toFixed(0)},${(opts.height * 0.17).toFixed(0)})\\an5\\fscx115\\fscy115\\c&H002E4DFF&}${clean(opts.hook).slice(0, 74).replace(/,/g, '\\,')}`);
  }
  return header + lines.join('\n') + '\n';
}

export function toSrt(transcript: Transcript, opts: CaptionOptions): string {
  return cues(transcript.words, opts.start, opts.end).map((c, i) =>
    `${i + 1}\n${srtTime(c.start - opts.start)} --> ${srtTime(c.end - opts.start)}\n${c.words.map((w) => clean(w.w)).join(' ')}\n`
  ).join('\n');
}

export function toVtt(transcript: Transcript, opts: CaptionOptions): string {
  return 'WEBVTT\n\n' + cues(transcript.words, opts.start, opts.end).map((c) =>
    `${vttTime(c.start - opts.start)} --> ${vttTime(c.end - opts.start)}\n${c.words.map((w) => clean(w.w)).join(' ')}\n`
  ).join('\n');
}
