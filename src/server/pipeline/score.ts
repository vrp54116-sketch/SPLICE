/** Zero-key editorial scoring: speech density, energy, laughter/applause,
 *  hooks in EN+HI, sentence completeness, silence gaps — plus rights-aware selection. */
import type { Moment, OffloadResult, ProjectConfig, ShieldReport, Transcript } from '@shared/types';
import { clamp } from '../lib/util';
import type { FrameFeatures } from './dsp';
import type { Span } from './rights';

const HOOK_EN = /\b(why|how|what|when|secret|truth|never|always|first|last|best|worst|crazy|insane|shocking|wait|stop|imagine|turns out|nobody|everyone|actually|because|here'?s|this is|i found|you need)\b/gi;
const HOOK_HI = /\b(kyun|kaise|kya|kab|sach|raaz|pahle|aakhiri|sabse|bura|accha|интересно|सच|क्यों|कैसे|क्या|शायद|अब|यह|देखो|सुनो)\b/giu;
const LAUGH = /\b(ha+|haha|lol|lmao|hahaha)\b/gi;

interface ScoreInput {
  transcript: Transcript;
  frames: FrameFeatures[];
  shots: Span[];
  offload?: OffloadResult;
  duration: number;
  config: ProjectConfig;
  targetSeconds: number;
  risks?: Array<{ span: Span; report: ShieldReport; repairable: boolean }>;
}

function wordsIn(words: Transcript['words'], span: Span) {
  return words.filter((w) => w.end > span.start && w.start < span.end).sort((a, b) => a.start - b.start);
}

function sentenceBoundaryTimes(words: Transcript['words']): number[] {
  const edges: number[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    if (/[.!?।]$/.test(words[i]!.w.trim())) edges.push(words[i]!.end);
  }
  return edges;
}

function snapEdge(t: number, candidates: number[], tolerance: number, bounds: Span): number {
  let best = t;
  let dist = Infinity;
  for (const c of candidates) {
    if (c < bounds.start || c > bounds.end) continue;
    const d = Math.abs(c - t);
    if (d < dist) { dist = d; best = c; }
  }
  return dist <= tolerance ? best : clamp(t, bounds.start, bounds.end);
}

function analyzeWindow(input: ScoreInput, span: Span) {
  const words = wordsIn(input.transcript.words, span);
  const text = words.map((w) => w.w).join(' ');
  const len = Math.max(0.1, span.end - span.start);
  const speechSeconds = words.reduce((a, w) => a + Math.min(w.end, span.end) - Math.max(w.start, span.start), 0);
  const speechDensity = clamp(speechSeconds / len, 0, 1);
  const sel = input.frames.filter((f) => f.t >= span.start && f.t <= span.end);
  const rms = sel.length ? sel.reduce((a, f) => a + f.rms, 0) / sel.length : 0;
  const flux = sel.length ? sel.reduce((a, f) => a + f.flux, 0) / sel.length : 0;
  const meanRms = sel.length ? sel.reduce((a, f) => a + f.rms, 0) / sel.length : 0;
  const sd = sel.length ? Math.sqrt(sel.reduce((a, f) => a + (f.rms - meanRms) ** 2, 0) / sel.length) : 0;
  const energyPeaks = sel.filter((f) => f.rms > meanRms + 1.2 * sd).length / Math.max(1, sel.length);
  const laughter = (text.match(LAUGH) ?? []).length / 3;
  const applause = sel.filter((f) => f.flux > flux * 2.2 && f.bands[2] + f.bands[3] > f.bands[0] + f.bands[1]).length / Math.max(1, sel.length);
  const hooks = (text.match(HOOK_EN) ?? []).length + (text.match(HOOK_HI) ?? []).length;
  const complete = /[.!?।]\s*$/.test(text.trim()) ? 1 : 0;
  const gaps = words.slice(1).reduce((acc, w, i) => acc + Math.max(0, w.start - words[i]!.end > 0.4 ? w.start - words[i]!.end : 0), 0);
  const novelty = input.offload?.frames
    ? new Set(input.offload.frames.filter((f) => f.t >= span.start && f.t <= span.end).map((f) => f.phash.slice(0, 8))).size / Math.max(1, Math.ceil(len * 2))
    : 0.5;

  const w = input.config.feedbackWeights ?? { energy: 1, speech: 1, novelty: 1 };
  const virality = clamp(
    speechDensity * 28 * w.speech +
    Math.min(1, rms * 14) * 12 * w.energy +
    energyPeaks * 12 +
    Math.min(1, laughter + applause) * 14 +
    Math.min(3, hooks) / 3 * 20 +
    complete * 8 +
    novelty * 10 * w.novelty -
    clamp(gaps / len, 0, 1) * 10,
    4, 99
  );
  return { text, speechDensity, metrics: { speechDensity, energy: rms, novelty, laughter: laughter + applause, completeness: complete } as Moment['metrics'], virality };
}

function clipTypeBoost(type: ProjectConfig['clipType'], text: string): number {
  const patterns: Record<string, RegExp> = {
    funny: LAUGH, podcast: /\(laughs?\)|joke|funny|wait wait/i,
    tutorial: /\b(step|first|now|next|how to|let me show)\b/i,
    motivational: /\b(believe|never give up|keep going|you can|today is)\b/i,
    product: /\b(buy|price|review|feature|product|link)\b/i,
    phrase: /["“][^"”]{3,}["”]|that('s| is) the/gi,
    trailer: /\b(trailer|coming soon|premiere)\b/i,
  };
  const re = patterns[type];
  if (!re) return 0;
  try { return Math.min(1, (text.match(re) ?? []).length / 2) * 8; } catch { return 0; }
}

export function findMoments(input: ScoreInput, llmMoments: Array<{ start: number; end: number; title: string; hook: string; why: string; score: number; improvements: string[] }> = []): Moment[] {
  const { duration, config, targetSeconds } = input;
  const window = { start: config.timeframe.start, end: Math.min(config.timeframe.end, duration) };
  const sentenceEdgeTimes = sentenceBoundaryTimes(input.transcript.words);
  const shotEdges = [...input.shots.flatMap((s) => [s.start, s.end]), window.start, window.end];
  const edges = [...new Set([...sentenceEdgeTimes, ...shotEdges])].sort((a, b) => a - b);
  const tolerance = targetSeconds * 0.2;

  const candidates: Span[] = [];
  if (llmMoments.length) {
    for (const m of llmMoments) candidates.push({ start: clamp(m.start, window.start, window.end), end: clamp(m.end, window.start, window.end) });
  }
  // Sliding windows snapped to edges, every ~40% of target, across the timeframe.
  const stride = Math.max(2, targetSeconds * 0.4);
  for (let t = window.start; t + targetSeconds * 0.5 <= window.end; t += stride) {
    candidates.push({ start: t, end: Math.min(window.end, t + targetSeconds) });
  }
  if (!candidates.length) candidates.push({ start: window.start, end: window.end });

  const moments: Moment[] = [];
  const seen = new Set<string>();
  for (const raw of candidates) {
    if (raw.end - raw.start < Math.min(8, targetSeconds * 0.5)) continue;
    const span: Span = {
      start: snapEdge(raw.start, edges, tolerance, window),
      end: snapEdge(raw.end, edges, tolerance, window),
    };
    if (span.end - span.start < 8) continue;
    const key = `${Math.round(span.start / 5)}:${Math.round(span.end / 5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = analyzeWindow(input, span);
    const llm = llmMoments.find((m) => Math.abs(m.start - raw.start) < targetSeconds * 0.5);
    const risk = input.risks?.find((r) => r.span.start <= span.start && r.span.end >= span.end);
    let safety = risk ? clamp(100 - risk.report.risk, 0, 100) : 75;
    if (risk && !risk.repairable && (risk.report.risk > 30 || risk.report.tier !== 'CLEAR')) safety -= 45;
    const baseVirality = clamp(a.virality + (llm?.score ?? 50) * 0.35 + clipTypeBoost(config.clipType, a.text), 1, 99);
    const final = config.rightsPolicy === 'strict' ? baseVirality * 0.6 + safety * 0.4 : baseVirality;
    const improvements = llm?.improvements?.length ? llm.improvements : buildImprovements(a, span, input);
    moments.push({
      id: `m_${Math.round(span.start)}_${Math.round(span.end)}`,
      start: span.start, end: span.end,
      title: llm?.title || deriveTitle(a.text, config.language),
      hook: llm?.hook || deriveHook(a.text),
      why: llm?.why || `Dense speech (${(a.metrics.speechDensity * 100).toFixed(0)}%), ${a.metrics.laughter > 0 ? 'laughter/applause peaks, ' : ''}a clear hook and a complete thought make this span hold attention.`,
      score: Math.round(final), safety: Math.round(safety), improvements,
      source: llm ? 'llm' : 'heuristic', metrics: a.metrics,
    });
  }
  // Exclude spans with unrepairable high-risk music or active overlay.
  const filtered = moments.filter((m) => {
    const r = input.risks?.find((x) => x.span.start <= m.start && x.span.end >= m.end);
    if (!r) return true;
    const a2 = r.report.params.find((p) => p.id === 'A2');
    const v1 = r.report.params.find((p) => p.id === 'V1');
    const v2 = r.report.params.find((p) => p.id === 'V2');
    if (!r.repairable && ((a2?.coverage ?? 0) > 0.3 || (v1?.value ?? 0) > 0.4 || (v2?.value ?? 0) > 0.4)) return false;
    return true;
  });
  const chosen = (filtered.length ? filtered : moments)
    .sort((x, y) => y.score - x.score)
    .slice(0, clamp(config.clipCount, 1, 12))
    .sort((x, y) => x.start - y.start);
  return chosen;
}

function buildImprovements(a: ReturnType<typeof analyzeWindow>, span: Span, input: ScoreInput): string[] {
  const out: string[] = [];
  if (a.speechDensity < 0.45) out.push('Tighten the opening pause — start on the first spoken word.');
  if (a.metrics.completeness < 1) out.push('Extend to the next sentence edge so the thought lands.');
  if (a.metrics.laughter < 0.1 && input.config.clipType === 'funny') out.push('Try a neighbouring window with a stronger reaction.');
  if (span.end - span.start > 60) out.push('A shorter cut may raise the hook-to-payoff ratio.');
  if (!out.length) out.push('Lead with the hook line in the first caption card.');
  return out;
}

function deriveTitle(text: string, language: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const words = clean.split(' ').slice(0, 6).join(' ');
  return language === 'hi' || language === 'hinglish' ? words || 'एक पल' : words || 'The moment';
}

function deriveHook(text: string): string {
  const sentence = text.split(/(?<=[.!?।])\s+/)[0] ?? text;
  return sentence.slice(0, 110).trim();
}
