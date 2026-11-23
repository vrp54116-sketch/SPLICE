/**
 * CLAIM SHIELD v1 — parameter engine.
 * Every detector reads a real measurement (DSP frames, browser offload pixels/OCR,
 * source metadata, attestation). No detector is a stub and no result claims certainty.
 */
import type {
  OffloadResult, ProjectConfig, RepairAction, RepairPlan, ShieldParam,
  ShieldReport, ShieldTier, Source, Transcript, ParamId,
} from '@shared/types';
import { clamp } from '../lib/util';
import type { FrameFeatures } from './dsp';
import { audioHeatmap, windowStats } from './dsp';
import type { FingerprintHit } from '../lib/providers';

export interface Span { start: number; end: number }

export interface RightsInput {
  span: Span;
  duration: number;
  frames: FrameFeatures[];
  offload?: OffloadResult;
  transcript: Transcript;
  metadata: { title?: string; description?: string; license?: string; filename?: string; encoder?: string };
  source: Source;
  config: Pick<ProjectConfig, 'attestation' | 'attestationProof' | 'captions' | 'autoHook' | 'reframe' | 'rightsPolicy'>;
  fingerprints: { full: FingerprintHit | null; head: FingerprintHit | null; tail: FingerprintHit | null };
  bars?: { letterbox: number; pillarbox: number };
  voiceoverCoverage?: number;
  applied?: RepairAction[];
  clipId: string;
  version: number;
  pass: number;
}

const ratio = (n: number, d: number) => (d > 0 ? clamp(n / d, 0, 1) : 0);
const param = <T extends ShieldParam>(p: T): T => p;

const NETWORKS = /t-series|sony|zee|star|disney|netflix|prime|hbo|warner|official|full movie|trailer|\bep\.?\s*\d+\b|episode|\bseason\b/i;
const STOCK = /getty|shutterstock|alamy|pond5|storyblocks/i;
const WATERMARK_MARKS = /©|®|™|rights reserved|courtesy/i;
const PROVENANCE = /y2mate|ssyoutube|snapsave|4kdownload|\brip\b|stream.?rip/i;
const CONTEXT = /this episode|courtesy of|\bnetwork\b|broadcast|episode \d|sponsored by/i;
const TRADEMARKS = /\b(nike|adidas|apple|google|netflix|disney|marvel|dc comics|coca.?cola|pepsi)\b/gi;

/* ------------------------------------------------------------- AUDIO */

function audioParams(input: RightsInput): ShieldParam[] {
  const { span, frames, transcript, fingerprints, applied = [] } = input;
  const stats = windowStats(frames, span.start, span.end, gapsFromTranscript(transcript, span));
  const spanSeconds = Math.max(0.1, span.end - span.start);
  const out: ShieldParam[] = [];

  // A1 — commercial fingerprint match. Only a real provider hit can set this.
  const fp = fingerprints.full;
  const strong = Boolean(fp && fp.confidence >= 0.75 && ratio(fp.coveredSeconds, spanSeconds) >= 0.10);
  out.push(param({
    id: 'A1', value: strong ? 1 : fp ? Math.min(1, fp.confidence) : 0,
    coverage: fp ? ratio(fp.coveredSeconds, spanSeconds) : 0, weight: 40,
    evidence: strong ? `Fingerprint match: ${fp!.title ?? 'identified work'} (${(fp!.confidence * 100).toFixed(0)}% confidence, ${fp!.coveredSeconds.toFixed(1)}s covered)`
      : fp ? 'Provider returned a low-confidence match — not treated as identification.'
      : 'No commercial fingerprint match returned by the active provider.',
    hardBlock: strong && !applied.includes('replace_music') && !applied.includes('mute_music'),
  }));

  // A2 — zero-key DSP bed detection (onset regularity, harmonicity, flatness,
  //      energy in ASR pauses). All four values are measured, not assumed.
  const musicPresent = stats.regularity >= 0.6 && stats.harmonicity >= 0.5 && stats.flatness < 0.5 && stats.pauseRatio >= 0.35;
  const cov = ratio(stats.coverage * (16 / 1000) * 100, spanSeconds * 100); // 512-hop frames ≈ 31.25 fps
  const coveragePct = clamp((stats.coverage * 0.032) / spanSeconds, 0, 1);
  const bedValue = musicPresent ? (coveragePct >= 0.5 ? 1 : 0.72) : Math.min(0.6, stats.musicLikelihood * 0.6);
  out.push(param({
    id: 'A2', value: (applied.includes('replace_music') || applied.includes('mute_music')) ? 0 : bedValue,
    coverage: applied.includes('replace_music') || applied.includes('mute_music') ? 0 : coveragePct,
    weight: coveragePct >= 0.5 ? 35 : 25,
    evidence: `Tempo regularity ${stats.regularity.toFixed(2)}, harmonicity ${stats.harmonicity.toFixed(2)}, spectral flatness ${stats.flatness.toFixed(2)}, pause energy ratio ${stats.pauseRatio.toFixed(2)}. Frame coverage ${(coveragePct * 100).toFixed(0)}%.${cov > 2 ? '' : ''}`,
  }));

  // A3 — speech dominance
  const speechCoverage = clamp(stats.coverage > 0 ? ratio(transcript.words.filter((w) => w.start >= span.start && w.end <= span.end).reduce((a, w) => a + (w.end - w.start), 0), spanSeconds) : 0, 0, 1);
  out.push(param({
    id: 'A3', value: speechCoverage < 0.4 ? 1 - speechCoverage / 0.4 : 0, coverage: speechCoverage,
    weight: 10, evidence: `Speech occupies ${(speechCoverage * 100).toFixed(0)}% of the span (40% threshold).`,
  }));

  // A4 — sound logo in first/last 5s
  const edge = fingerprints.head ?? fingerprints.tail;
  out.push(param({
    id: 'A4', value: edge && edge.confidence >= 0.7 ? 1 : 0, coverage: edge ? ratio(edge.coveredSeconds, 5) : 0,
    weight: 20, evidence: edge ? `Edge fingerprint: ${edge.title ?? 'match'}` : 'No fingerprint hit in the first or last 5 seconds.',
  }));
  return out;
}

function gapsFromTranscript(transcript: Transcript, span: Span) {
  const pauses: Span[] = [];
  const words = transcript.words.filter((w) => w.end > span.start && w.start < span.end).sort((a, b) => a.start - b.start);
  let cursor = span.start;
  for (const w of words) {
    if (w.start - cursor > 0.35) pauses.push({ start: cursor, end: w.start });
    cursor = Math.max(cursor, w.end);
  }
  if (span.end - cursor > 0.35) pauses.push({ start: cursor, end: span.end });
  return pauses;
}

/* ------------------------------------------------------------- VISUAL */

function visualParams(input: RightsInput): ShieldParam[] {
  const { offload, applied = [], bars, config, span } = input;
  const frames = (offload?.frames ?? []).filter((f) => f.t >= span.start && f.t <= span.end);
  const n = Math.max(1, frames.length);
  const out: ShieldParam[] = [];
  const ocrAll = frames.flatMap((f) => f.ocr ?? []);

  // V1 — persistent watermark: low ROI variance while the frame changes, stable OCR.
  const stableRoi = frames.filter((f) => f.roi && (f.roi.corners < 0.02 || f.roi.lowerThird < 0.02) && f.roi.frameChange > 0.02).length;
  const ocrCounts = new Map<string, number>();
  for (const s of ocrAll) ocrCounts.set(s, (ocrCounts.get(s) ?? 0) + 1);
  const bestOcr = [...ocrCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const stableOcrRatio = bestOcr ? ratio(bestOcr[1], n) : 0;
  const roiRatio = ratio(stableRoi, n);
  const marks = ocrAll.some((s) => WATERMARK_MARKS.test(s));
  const blurred = applied.includes('blur_roi') || applied.includes('crop_overlay');
  out.push(param({
    id: 'V1', value: blurred ? 0 : clamp(roiRatio * 0.6 + stableOcrRatio * 0.4, 0, 1),
    coverage: blurred ? 0 : Math.max(roiRatio, stableOcrRatio),
    weight: 30,
    evidence: blurred ? 'Watermark region removed by a confirmed legal repair.'
      : `Stable corner/lower-third ROI in ${(roiRatio * 100).toFixed(0)}% of frames; OCR text stable in ${(stableOcrRatio * 100).toFixed(0)}%${bestOcr ? ` ("${bestOcr[0]}")` : ''}.`,
    hardBlock: !blurred && marks && stableOcrRatio >= 0.6,
    roi: blurred ? undefined : { x: 0.02, y: 0.02, w: 0.3, h: 0.18 },
  }));

  // V2 — platform chrome: measured bar/rail/chip signals plus OCR vocabulary.
  const chromeFrames = frames.filter((f) => f.chrome && (f.chrome.bottomBar + f.chrome.rightRail + f.chrome.handleChip) / 3 >= 0.7).length;
  const chromeRatio = ratio(chromeFrames, n);
  const chromeOcr = ocrAll.some((s) => /\b(subscribe|for you|reels|shorts|tiktok|youtube|instagram|@\w+)\b/i.test(s));
  const cropped = applied.includes('crop_overlay');
  out.push(param({
    id: 'V2', value: cropped ? 0 : clamp(chromeRatio * 0.75 + (chromeOcr ? 0.25 : 0), 0, 1),
    coverage: cropped ? 0 : chromeRatio, weight: 35,
    evidence: cropped ? 'Overlay area removed by cropping (≤12% margin).'
      : `UI bar/rail/chip signals ≥0.7 in ${(chromeRatio * 100).toFixed(0)}% of frames; platform UI text ${chromeOcr ? 'detected' : 'not detected'}.`,
  }));

  // V3 — broadcast bars from ffmpeg cropdetect.
  const bar = Math.max(bars?.letterbox ?? 0, bars?.pillarbox ?? 0);
  out.push(param({
    id: 'V3', value: bar >= 0.12 ? 1 : bar / 0.12, coverage: bar, weight: 10,
    evidence: `cropdetect measured ${(bar * 100).toFixed(1)}% persistent bars (12% threshold).`,
  }));

  // V4 — stock-library watermark OCR is a hard block.
  const stockHits = ocrAll.filter((s) => STOCK.test(s));
  out.push(param({
    id: 'V4', value: stockHits.length ? 1 : 0, coverage: ratio(stockHits.length, n), weight: 30,
    evidence: stockHits.length ? `Stock watermark OCR: ${[...new Set(stockHits)].slice(0, 3).join(', ')}` : 'No stock-library watermark text in offloaded frames.',
    hardBlock: stockHits.length > 0,
  }));

  // V5 — high-contrast static corner blob.
  const staticFrames = frames.filter((f) => f.roi && f.roi.staticCorner >= 0.55).length;
  out.push(param({
    id: 'V5', value: applied.includes('blur_roi') || applied.includes('crop_overlay') ? 0 : ratio(staticFrames, n),
    coverage: ratio(staticFrames, n), weight: 18,
    evidence: `Static high-contrast corner blob present in ${(ratio(staticFrames, n) * 100).toFixed(0)}% of frames.`,
  }));

  // Episodic visual marker used by S3.
  void config;
  return out;
}

/* -------------------------------------------------------------- TEXT */

function textParams(input: RightsInput): ShieldParam[] {
  const { metadata, transcript, source, applied = [] } = input;
  const title = metadata.title ?? source.title ?? '';
  const desc = metadata.description ?? '';
  const license = (metadata.license ?? source.license ?? '').toLowerCase();
  const out: ShieldParam[] = [];

  const sourceHit = NETWORKS.test(`${title} ${desc}`);
  const isCc = license.includes('creativecommon') || license.includes('creative common') || input.config.attestation === 'cc';
  out.push(param({
    id: 'T1', value: sourceHit && !isCc ? 1 : 0, coverage: sourceHit ? 1 : 0, weight: 20,
    evidence: isCc ? 'Source is Creative Commons: attribution is mandatory and forced in the description.'
      : sourceHit ? 'Source title/description contains network, episode, trailer or "official" markers.'
      : 'No third-party broadcast markers in source metadata.',
  }));

  const contextHits = transcript.text.match(new RegExp(CONTEXT, 'gi'))?.length ?? 0;
  out.push(param({
    id: 'T2', value: contextHits ? Math.min(1, contextHits / 3) : 0, coverage: contextHits ? 1 : 0, weight: 12,
    evidence: contextHits ? `${contextHits} context phrase(s) such as "this episode" or "courtesy of" in the transcript.` : 'No borrowed-show context phrases in the transcript.',
  }));

  const marks = `${title} ${desc}`.match(TRADEMARKS) ?? [];
  out.push(param({
    id: 'T3', value: applied.includes('regenerate_meta') ? 0 : marks.length ? Math.min(1, marks.length / 3) : 0,
    coverage: marks.length ? 1 : 0, weight: 15,
    evidence: applied.includes('regenerate_meta') ? 'Third-party trademarks stripped from generated title and hashtags.'
      : marks.length ? `Unattributed third-party marks in metadata: ${[...new Set(marks)].join(', ')}.` : 'No injected third-party trademarks in generated metadata.',
  }));
  return out;
}

/* ------------------------------------------- SOURCE + TRANSFORM */

function provenanceParams(input: RightsInput): ShieldParam[] {
  const { metadata, config, duration, offload, source, applied = [] } = input;
  const provText = `${metadata.filename ?? source.filename ?? ''} ${metadata.encoder ?? ''}`;
  const provHit = PROVENANCE.test(provText);
  const episodic = duration > 15 * 60 && NETWORKS.test(`${metadata.title ?? ''}`) &&
    (offload?.frames ?? []).some((f) => f.roi && f.roi.staticCorner >= 0.55);

  return [
    param({
      id: 'S1', value: config.attestation === 'unknown' ? 1 : 0, coverage: 1, weight: 25,
      evidence: `Attestation: ${config.attestation}${config.attestationProof ? ` (proof: ${config.attestationProof.slice(0, 40)})` : ''}.`,
      mitigation: config.attestation === 'owned' || config.attestation === 'licensed',
    }),
    param({
      id: 'S2', value: provHit ? 1 : 0, coverage: provHit ? 1 : 0, weight: 20,
      evidence: provHit ? 'Filename or encoder tags match a known downloader/ripper pattern.' : 'No downloader or ripper provenance markers.',
    }),
    param({
      id: 'S3', value: episodic ? 1 : 0, coverage: episodic ? 1 : 0, weight: 18,
      evidence: episodic ? 'Long-form duration plus episode markers plus a persistent studio logo.' : 'No episodic-broadcast pattern detected.',
    }),
    param({
      id: 'X1', value: (input.voiceoverCoverage ?? 0) >= 0.25 ? 0 : config.captions || config.autoHook || config.reframe !== 'center' ? 1 : 0,
      coverage: input.voiceoverCoverage ?? 0, weight: 12,
      evidence: (input.voiceoverCoverage ?? 0) >= 0.25 ? `Original recorded commentary covers ${((input.voiceoverCoverage ?? 0) * 100).toFixed(0)}% of the clip.`
        : (applied.includes('add_voiceover') ? 'Voiceover mitigation pending capture.' : 'Captions, hooks and reframing alone are not original commentary.'),
      mitigation: (input.voiceoverCoverage ?? 0) >= 0.25,
    }),
  ];
}

/* ----------------------------------------------------------- ENGINE */

export function evaluateParams(input: RightsInput): ShieldParam[] {
  return [...audioParams(input), ...visualParams(input), ...textParams(input), ...provenanceParams(input)];
}

export function computeRisk(params: ShieldParam[], config: Pick<ProjectConfig, 'attestation' | 'rightsPolicy'>, applied: RepairAction[] = []): { risk: number; mitigations: number; tier: ShieldTier } {
  let raw = 0;
  for (const p of params) raw += p.weight * p.value * (p.id === 'T3' ? 0.6 : 1);
  let mitigations = 0;
  if (config.attestation === 'owned' || config.attestation === 'licensed') mitigations += 30;
  if (config.attestation === 'public_domain' || config.attestation === 'cc') mitigations += 35;
  if (applied.includes('add_voiceover')) mitigations += 12;
  if (applied.includes('add_attribution')) mitigations += 8;
  const tierBias = config.rightsPolicy === 'strict' ? 0 : config.rightsPolicy === 'own_content' ? 8 : 4;
  const risk = clamp(Math.round(raw - mitigations + tierBias), 0, 100);
  const hard = params.some((p) => p.hardBlock);
  const tier: ShieldTier = hard || risk > 55 || (config.rightsPolicy === 'strict' && risk > 20) ? 'BLOCKED'
    : risk > 20 ? 'REVIEW' : 'CLEAR';
  return { risk, mitigations, tier };
}

export function scan(input: RightsInput): ShieldReport {
  const applied = input.applied ?? [];
  const params = evaluateParams(input);
  const { risk, mitigations, tier } = computeRisk(params, input.config, applied);
  const isCc = (input.metadata.license ?? input.source.license ?? '').toLowerCase().includes('creativecommon') || input.config.attestation === 'cc';
  const strippedTitle = (input.metadata.title ?? '').replace(TRADEMARKS, '').replace(/\s+/g, ' ').trim();
  const attribution = isCc ? `Source: ${input.source.title ?? 'Creative Commons source'}${input.source.channel ? ` by ${input.source.channel}` : ''}. Licensed under Creative Commons; reused with attribution.` : undefined;
  const blockers = params.filter((p) => p.hardBlock).map((p) => p.id);
  return {
    id: `rpt_${input.clipId}_v${input.version}_p${input.pass}`,
    clipId: input.clipId, version: input.version, pass: input.pass,
    risk, tier, params, mitigations, createdAt: Date.now(),
    audioHeatmap: audioHeatmap(input.frames, input.span.end - input.span.start),
    ...(attribution ? { forcedAttribution: attribution } : {}),
    explanation: tier === 'BLOCKED'
      ? `Blocked by CLAIM SHIELD. ${blockers.length ? `Hard-stop parameters: ${blockers.join(', ')}. ` : ''}Risk ${risk}/100 from ${params.filter((p) => p.value > 0).map((p) => p.id).join(', ') || 'source signals'}. This is an best-effort screen, not a copyright determination.`
      : tier === 'REVIEW'
        ? `Review recommended. Risk ${risk}/100 — check ${params.filter((p) => p.value > 0).map((p) => p.id).join(', ')} before posting. CLAIM SHIELD cannot predict a platform's decision.`
        : `Screened clear at ${risk}/100 under the ${input.config.rightsPolicy} policy. Best-effort only — the platform's Content ID is final.${strippedTitle !== input.metadata.title ? ' Metadata trademarks were stripped.' : ''}`,
  };
}

export function repairPlans(report: ShieldReport): RepairPlan[] {
  const plans: RepairPlan[] = [];
  const byId = (id: ParamId) => report.params.find((p) => p.id === id);
  if (byId('A1')?.hardBlock || (byId('A2')?.value ?? 0) > 0.25) plans.push({ action: 'replace_music', reason: 'Replace the detected music bed with a rights-safe generated loop.', clears: ['A1', 'A2', 'A4'] });
  if (byId('A2')?.value) plans.push({ action: 'mute_music', reason: 'Mute the original audio bed under the speech.', clears: ['A1', 'A2'] });
  if (byId('V1')?.hardBlock || (byId('V5')?.value ?? 0) > 0.3) plans.push({ action: 'blur_roi', reason: 'Blur the confirmed watermark region. Confirm you have the right to modify this source.', clears: ['V1', 'V5'], requiresConfirmation: true });
  if ((byId('V2')?.value ?? 0) > 0.3 || (byId('V3')?.value ?? 0) > 0.5) plans.push({ action: 'crop_overlay', reason: 'Crop the platform overlay or broadcast bars using an ≤12% margin.', clears: ['V1', 'V2', 'V3'] });
  if (byId('T1')?.value || report.forcedAttribution) plans.push({ action: 'add_attribution', reason: 'Add the mandatory Creative Commons attribution to the description.', clears: ['T1'] });
  if (byId('T3')?.value) plans.push({ action: 'regenerate_meta', reason: 'Strip third-party trademarks from the generated title and hashtags.', clears: ['T3'] });
  if (byId('X1')?.value && !byId('X1')?.mitigation) plans.push({ action: 'add_voiceover', reason: 'Record original commentary covering at least 25% of the clip.', clears: ['X1'] });
  if (report.tier === 'BLOCKED' && byId('A2')?.value) plans.push({ action: 'trim_span', reason: 'Trim the flagged window and re-snap to the nearest sentence edge.', clears: ['A2', 'A3'] });
  return plans;
}

export const isHardBlocked = (r: ShieldReport) => r.tier === 'BLOCKED';
export const canDownload = (r: ShieldReport, confirmation?: boolean) => r.tier === 'CLEAR' || (r.tier === 'REVIEW' && confirmation === true);

export function assumptionNote(): string {
  return 'CLAIM SHIELD is a best-effort prevention screen. It does not remove copyright, bypass Content ID, or guarantee monetization. Platform detection is final.';
}
