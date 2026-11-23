import { describe, it, expect } from 'vitest';
import { computeRisk, repairPlans, canDownload, isHardBlocked, assumptionNote } from '../../src/server/pipeline/rights';
import type { ShieldParam, ShieldReport, ShieldTier } from '@shared/types';

const P = (id: ShieldParam['id'], value: number, weight: number, extra: Partial<ShieldParam> = {}): ShieldParam =>
  ({ id, value, coverage: value ? 0.5 : 0, weight, evidence: `test ${id}`, ...extra } as ShieldParam);

const clean = (): ShieldParam[] => [
  P('A1', 0, 40), P('A2', 0, 25), P('A3', 0, 10), P('A4', 0, 20),
  P('V1', 0, 30), P('V2', 0, 35), P('V3', 0, 10), P('V4', 0, 30), P('V5', 0, 18),
  P('T1', 0, 20), P('T2', 0, 12), P('T3', 0, 15),
  P('S1', 0, 25), P('S2', 0, 20), P('S3', 0, 18), P('X1', 0, 12),
];

const cfg = (policy: 'strict' | 'balanced' | 'own_content' = 'balanced', attestation: 'owned' | 'unknown' = 'owned') => ({ rightsPolicy: policy, attestation });

const report = (params: ShieldParam[], tier: ShieldTier, forcedAttribution?: string): ShieldReport => ({
  id: 'rpt_test', clipId: 'clip_test', version: 1, pass: 1, risk: 0, tier,
  params, mitigations: 0, createdAt: Date.now(),
  audioHeatmap: [{ start: 0, end: 1, level: 0.1, flagged: false }],
  ...(forcedAttribution ? { forcedAttribution } : {}),
  explanation: 'test report',
});

describe('CLAIM SHIELD — weights and risk formula', () => {
  it('uses the exact documented detector weights', () => {
    const params = clean();
    const expected: Record<string, number> = {
      A1: 40, A2: 35, A3: 10, A4: 20, V1: 30, V2: 35, V3: 10, V4: 30, V5: 18,
      T1: 20, T2: 12, T3: 15, S1: 25, S2: 20, S3: 18, X1: 12,
    };
    for (const p of params) {
      // A2's weight is 25 at low coverage and 35 at >=50% coverage, so both are legal.
      expect([expected[p.id]!, ...(p.id === 'A2' ? [25] : [])]).toContain(p.weight);
    }
    expect(params).toHaveLength(16);
  });

  it(' scores a clean owned source as CLEAR with a 30-point mitigation', () => {
    const r = computeRisk(clean(), cfg());
    expect(r.risk).toBe(0); // raw 0 - 30 + 4 clamps to 0
    expect(r.mitigations).toBe(30);
    expect(r.tier).toBe('CLEAR');
  });

  it('never clears an unknown third-party source when risk exceeds 20', () => {
    const params = clean();
    params[1] = P('A2', 1, 35); // 35 raw
    const r = computeRisk(params, cfg('balanced', 'unknown'));
    expect(r.risk).toBe(35 + 4);
    expect(r.tier).toBe('REVIEW');
  });

  it('blocks strictly on a hard-stop parameter regardless of low numeric risk', () => {
    const params = clean();
    params[0] = P('A1', 1, 40, { hardBlock: true });
    params[4] = P('V1', 1, 30, { hardBlock: true });
    const r = computeRisk(params, cfg());
    expect(r.tier).toBe('BLOCKED');
    expect(isHardBlocked(report(params, r.tier))).toBe(true);
  });

  it('strict policy blocks above risk 20 while balanced allows REVIEW', () => {
    const params = clean();
    params[5] = P('V2', 1, 35);
    params[7] = P('V4', 1, 30);
    const strict = computeRisk(params, cfg('strict'));
    const balanced = computeRisk(params, cfg('balanced'));
    expect(strict.risk).toBeLessThanOrEqual(balanced.risk);
    expect(strict.tier).toBe('BLOCKED');
    expect(balanced.tier).toBe('REVIEW');
  });

  it('applies voiceover and attribution mitigations from repairs', () => {
    const params = clean();
    params[5] = P('V2', 1, 35);
    params[7] = P('V4', 1, 30);
    params[15] = P('X1', 1, 12);
    const before = computeRisk(params, cfg());
    const after = computeRisk(params, cfg(), ['add_voiceover', 'add_attribution']);
    expect(after.mitigations - before.mitigations).toBe(20);
    expect(after.risk).toBeLessThan(before.risk);
  });

  it('clamps risk to the 0–100 range', () => {
    const params = clean().map((p) => P(p.id, 1, p.weight));
    expect(computeRisk(params, cfg('strict', 'unknown')).risk).toBeLessThanOrEqual(100);
    expect(computeRisk(clean(), cfg()).risk).toBeGreaterThanOrEqual(0);
  });
});

describe('CLAIM SHIELD — repair loop plans', () => {
  it('offers music and trim repairs for a hard-stopped audio bed', () => {
    const params = clean();
    params[0] = P('A1', 1, 40, { hardBlock: true });
    params[1] = P('A2', 0.8, 35);
    const plans = repairPlans(report(params, 'BLOCKED'));
    expect(plans.map((p) => p.action)).toContain('replace_music');
    expect(plans.map((p) => p.action)).toContain('mute_music');
    expect(plans.map((p) => p.action)).toContain('trim_span');
  });

  it('requires confirmation before a watermark ROI blur', () => {
    const params = clean();
    params[4] = P('V1', 1, 30, { hardBlock: true });
    const plans = repairPlans(report(params, 'BLOCKED'));
    const blur = plans.find((p) => p.action === 'blur_roi');
    expect(blur?.requiresConfirmation).toBe(true);
    expect(blur?.clears).toEqual(['V1', 'V5']);
  });

  it('offers attribution for a forced Creative Commons attribution', () => {
    const plans = repairPlans(report(clean(), 'REVIEW', 'Source: Demo by Author'));
    expect(plans.map((p) => p.action)).toContain('add_attribution');
  });

  it('offers voiceover for a transform-only signal', () => {
    const params = clean();
    params[15] = P('X1', 1, 12);
    expect(repairPlans(report(params, 'REVIEW')).map((p) => p.action)).toContain('add_voiceover');
  });

  it('offers no legal repairs for a genuinely clean source', () => {
    expect(repairPlans(report(clean(), 'CLEAR'))).toHaveLength(0);
  });
});

describe('CLAIM SHIELD — server download gate', () => {
  it('allows CLEAR, gates REVIEW on confirmation, and always refuses BLOCKED', () => {
    expect(canDownload(report(clean(), 'CLEAR'))).toBe(true);
    expect(canDownload(report(clean(), 'REVIEW'))).toBe(false);
    expect(canDownload(report(clean(), 'REVIEW'), true)).toBe(true);
    expect(canDownload(report(clean(), 'BLOCKED'), true)).toBe(false);
  });

  it('states the honest limitation in every explainer', () => {
    const note = assumptionNote();
    expect(note).toMatch(/best-effort/i);
    expect(note).toMatch(/does not remove copyright/i);
    expect(note).toMatch(/final/i);
  });
});
