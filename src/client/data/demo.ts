import type { ClipRecord, ProjectRecord, ShieldReport } from '@shared/types';

const baseReport = (clipId: string, tier: 'CLEAR' | 'REVIEW' | 'BLOCKED', risk: number): ShieldReport => ({
  id: `rpt_${clipId}`, clipId, version: 1, pass: 1, risk, tier, createdAt: Date.now() - 86400000,
  mitigations: tier === 'CLEAR' ? 30 : 0,
  params: [
    { id: 'A1', value: tier === 'BLOCKED' ? 1 : 0, coverage: tier === 'BLOCKED' ? 0.32 : 0, weight: 40, evidence: tier === 'BLOCKED' ? 'Fingerprint match: Demo Network Theme (88% confidence, 9.6s covered)' : 'No commercial fingerprint match returned by the active provider.', ...(tier === 'BLOCKED' ? { hardBlock: true } : {}) },
    { id: 'A2', value: tier === 'CLEAR' ? 0.15 : 0.72, coverage: tier === 'CLEAR' ? 0.12 : 0.44, weight: 25, evidence: 'Tempo regularity 0.71, harmonicity 0.62, flatness 0.21, pause energy ratio 0.41.' },
    { id: 'A3', value: 0, coverage: 0.82, weight: 10, evidence: 'Speech occupies 82% of the span (40% threshold).' },
    { id: 'V1', value: tier === 'BLOCKED' ? 0.9 : 0.05, coverage: tier === 'BLOCKED' ? 0.78 : 0.02, weight: 30, evidence: tier === 'BLOCKED' ? 'Stable OCR "© DEMO NETWORK" in 78% of frames.' : 'No stable watermark ROI in offloaded frames.', ...(tier === 'BLOCKED' ? { hardBlock: true } : {}) },
    { id: 'V2', value: 0, coverage: 0, weight: 35, evidence: 'UI bar/rail/chip signals ≥0.7 in 0% of frames.' },
    { id: 'V3', value: 0, coverage: 0, weight: 10, evidence: 'cropdetect measured 0.0% persistent bars.' },
    { id: 'V4', value: 0, coverage: 0, weight: 30, evidence: 'No stock-library watermark text in offloaded frames.' },
    { id: 'V5', value: 0.1, coverage: 0.1, weight: 18, evidence: 'Static corner blob present in 10% of frames.' },
    { id: 'T1', value: 0, coverage: 0, weight: 20, evidence: 'No third-party broadcast markers in source metadata.' },
    { id: 'T2', value: 0, coverage: 0, weight: 12, evidence: 'No borrowed-show context phrases in the transcript.' },
    { id: 'T3', value: 0, coverage: 0, weight: 15, evidence: 'No injected third-party trademarks in generated metadata.' },
    { id: 'S1', value: 0, coverage: 1, weight: 25, evidence: 'Attestation: owned (proof: demo license).', mitigation: true },
    { id: 'S2', value: 0, coverage: 0, weight: 20, evidence: 'No downloader or ripper provenance markers.' },
    { id: 'S3', value: 0, coverage: 0, weight: 18, evidence: 'No episodic-broadcast pattern detected.' },
    { id: 'X1', value: 1, coverage: 0, weight: 12, evidence: 'Captions, hooks and reframing alone are not original commentary.' },
  ],
  audioHeatmap: Array.from({ length: 20 }, (_, i) => ({ start: i, end: i + 1, level: 0.02 + (i % 5) * 0.008, flagged: i === 7 || i === 8 })),
  explanation: tier === 'BLOCKED' ? 'Blocked by CLAIM SHIELD. Hard-stop parameters: A1, V1. Best-effort screen, not a copyright determination.' : 'Screened clear under the balanced policy. Best-effort only — the platform’s Content ID is final.',
});

const cfg = {
  source: { kind: 'upload' as const, ref: 'demo', filename: 'demo.mp4' },
  attestation: 'owned' as const, clipType: 'viral' as const, clipCount: 3, duration: 'short' as const,
  aspect: '9:16' as const, language: 'en' as const, timeframe: { start: 0, end: 120 },
  captions: true, captionStyle: 'classic' as const, autoHook: true, hookTone: 'bold',
  reframe: 'face' as const, music: false, musicMood: 'lofi' as const, musicVolume: 0.2,
  splitScreen: false, backgrounds: [], splitRatio: 0.55, rightsPolicy: 'balanced' as const,
  resolution: 1080 as const, filenameTemplate: 'splice-{rank}',
};

const mkClip = (id: string, rank: number, title: string, hook: string, virality: number, tier: 'CLEAR' | 'REVIEW' | 'BLOCKED', jobId: string): ClipRecord => ({
  id, jobId, version: 1, rank, title, hook,
  why: 'Dense speech, a clean question hook and a complete thought make this span hold attention for the full cut.',
  improvements: ['Lead with the hook line in the first caption card.', 'Trim the opening pause by 0.4s.'],
  virality, start: rank * 24, end: rank * 24 + 30, duration: 30, aspect: '9:16', captionStyle: 'classic',
  assetId: '', thumbId: '', transcript: {
    words: ['The', 'part', 'nobody', 'tells', 'you', 'about', 'this', 'is', 'what', 'happens', 'next'].map((w, i) => ({ w, start: i * 0.6, end: i * 0.6 + 0.5 })),
    text: 'The part nobody tells you about this is what happens next.', mode: 'local-basic',
  },
  report: baseReport(id, tier, tier === 'CLEAR' ? 8 : tier === 'REVIEW' ? 34 : 78),
  status: tier === 'CLEAR' ? 'ready' : tier === 'REVIEW' ? 'review' : 'blocked',
  favorite: false, published: false, demo: true, createdAt: Date.now() - 86400000 * (4 - rank),
  sourceTitle: 'Studio Demo Reel', configSnapshot: cfg,
  versions: [{ version: 1, assetId: '', reportId: `rpt_${id}`, createdAt: Date.now() - 86400000 }],
});

export const demoProjects: ProjectRecord[] = [
  { id: 'demo_p1', title: 'Studio Demo Reel', createdAt: Date.now() - 3600000, sourceTitle: 'Studio Demo Reel', status: 'done', clipIds: ['demo_c1', 'demo_c2', 'demo_c3'], demo: true, config: cfg },
  { id: 'demo_p2', title: 'Weekend Edit Batch', createdAt: Date.now() - 86400000, sourceTitle: 'Weekend raw footage', status: 'done', clipIds: ['demo_c4', 'demo_c5'], demo: true, config: cfg },
  { id: 'demo_p3', title: 'Claim Shield Lab', createdAt: Date.now() - 172800000, sourceTitle: 'Rights test fixture', status: 'done', clipIds: ['demo_c6'], demo: true, config: cfg },
];

export const demoClips: ClipRecord[] = [
  mkClip('demo_c1', 1, 'The part nobody tells you', 'The part nobody tells you about this…', 92, 'CLEAR', 'demo_p1'),
  mkClip('demo_c2', 2, 'What happens next', 'What happens next is surprisingly simple.', 78, 'CLEAR', 'demo_p1'),
  mkClip('demo_c3', 3, 'Three small changes', 'Three small changes, one big difference.', 71, 'REVIEW', 'demo_p1'),
  mkClip('demo_c4', 1, 'Batch one highlight', 'Here is the moment we kept coming back to.', 84, 'CLEAR', 'demo_p2'),
  mkClip('demo_c5', 2, 'The long answer', 'The long answer, in thirty seconds.', 67, 'CLEAR', 'demo_p2'),
  mkClip('demo_c6', 1, 'Rights test — watermarked', 'A demo clip showing a blocked shield report.', 88, 'BLOCKED', 'demo_p3'),
];
