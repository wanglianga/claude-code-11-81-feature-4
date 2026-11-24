import { describe, expect, it } from 'vitest';
import {
  PUBLIC_POLICIES,
  buildMaskingRecords,
  buildPublicGeometryVersion,
  envelopeBufferClearance,
  nextPublicVersionId,
  pointBufferClearance,
  pointToTrenchEdgeDistance,
  publicViewOf,
  scanPublicLeaks,
  uniformHalfWidth,
} from './publicGeometry';
import { internalGeometryV1, internalGeometryV2, trenchTruth } from './publicSample';
import type { PublicGeometryVersion } from './types';

const v1 = internalGeometryV1();

async function build(
  existing: PublicGeometryVersion[] = [],
  opts: { mode?: 'fixed_grid' | 'risk_adaptive'; rollback?: boolean; internal?: ReturnType<typeof internalGeometryV1> } = {},
) {
  return buildPublicGeometryVersion({
    internal: opts.internal ?? v1,
    policy: PUBLIC_POLICIES[opts.mode ?? 'fixed_grid'],
    existing,
    rollback: opts.rollback,
  });
}

describe('探测点距 3 米禁挖缓冲的几何口径', () => {
  it('DP-01 估计距沟槽边线 3.4 米、误差 ±0.8 米，误差包络覆盖 2.6–4.2 米并跨缓冲外沿', () => {
    const trench = trenchTruth();
    const dp1 = v1.points.find((p) => p.id === 'DP-01')!;
    const edge = pointToTrenchEdgeDistance(dp1.coord, trench);
    expect(edge).toBeCloseTo(3.4, 3);
    expect(edge - dp1.errorM).toBeCloseTo(2.6, 3);
    expect(edge + dp1.errorM).toBeCloseTo(4.2, 3);
    // 估计点本身在缓冲外 0.4 米，但误差包络下沿 2.6 < 3，不能据点估计宣称安全
    expect(pointBufferClearance(dp1.coord, trench, trench.bufferM)).toBeCloseTo(0.4, 3);
    expect(edge - dp1.errorM).toBeLessThan(trench.bufferM);
  });
});

describe('两路公开几何：固定网格 vs 风险自适应', () => {
  it('固定网格：全设施统一 6 米格网与统一包络半宽，且都判 DP-01 为待核并阻断精确位置', async () => {
    const pub = await build([], { mode: 'fixed_grid' });
    expect(pub.verdicts.every((v) => v.envelope.cellM === 6)).toBe(true);
    expect(new Set(pub.verdicts.map((v) => v.envelope.halfWidthM)).size).toBe(1);
    const dp1 = pub.verdicts.find((v) => v.pointId === 'DP-01')!;
    expect(dp1.intersectsBuffer).toBe(true);
    expect(dp1.exactBlocked).toBe(true);
    expect(dp1.publicConclusion).toBe('possibly_intersects');
    expect(dp1.envelope.halfWidthM).toBeCloseTo(uniformHalfWidth(6, 0.8), 6);
  });

  it('风险自适应：高风险边界保留细网格，远离缓冲处粗网格；DP-04 可判安全区而固定网格只能判可能相交', async () => {
    const fixed = await build([], { mode: 'fixed_grid' });
    const adaptive = await build([], { mode: 'risk_adaptive' });
    const a1 = adaptive.verdicts.find((v) => v.pointId === 'DP-01')!;
    const a4 = adaptive.verdicts.find((v) => v.pointId === 'DP-04')!;
    const f4 = fixed.verdicts.find((v) => v.pointId === 'DP-04')!;
    // 高风险带 DP-01 保留 1 米细网格
    expect(a1.envelope.cellM).toBe(1);
    expect(a1.intersectsBuffer).toBe(true);
    expect(a1.exactBlocked).toBe(true);
    // DP-04 在缓冲外 2.5 米：自适应细网格给出安全区，固定粗网格覆盖缓冲只能给“可能相交”
    expect(a4.envelope.cellM).toBe(1);
    expect(a4.publicConclusion).toBe('safe_zone');
    expect(f4.publicConclusion).toBe('possibly_intersects');
    // 风险依据被记录（内部审计字段，不进公开视图）
    expect(adaptive.riskBasis.find((r) => r.pointId === 'DP-01')!.criterion).toContain('高风险');
    const view = publicViewOf(adaptive);
    expect(view).not.toHaveProperty('riskBasis');
    for (const p of view.points) expect(p.envelope).not.toHaveProperty('riskClass');
  });

  it('公开结论只由包络相交决定，不随内部待核状态变化（DP-01 与 DP-03 均待核但结论同为可能相交）', async () => {
    const pub = await build([], { mode: 'fixed_grid' });
    const dp1 = pub.verdicts.find((v) => v.pointId === 'DP-01')!;
    const dp3 = pub.verdicts.find((v) => v.pointId === 'DP-03')!;
    expect(dp1.publicConclusion).toBe('possibly_intersects');
    expect(dp3.publicConclusion).toBe('possibly_intersects');
    expect(v1.points.find((p) => p.id === 'DP-01')!.verifyState).toBe('pending');
    expect(v1.points.find((p) => p.id === 'DP-03')!.verifyState).toBe('pending');
  });

  it('两路都只对包络完全在缓冲外的 DP-02 发布安全区结论', async () => {
    for (const mode of ['fixed_grid', 'risk_adaptive'] as const) {
      const pub = await build([], { mode });
      const dp2 = pub.verdicts.find((v) => v.pointId === 'DP-02')!;
      const chk = envelopeBufferClearance(dp2.envelope.center, dp2.envelope.halfWidthM, trenchTruth(), 3);
      expect(chk.intersects).toBe(false);
      expect(dp2.publicConclusion).toBe('safe_zone');
      expect(dp2.exactBlocked).toBe(false);
    }
  });
});

describe('字段遮蔽与泄露扫描', () => {
  it('每个探测点登记坐标/精度/责任人/待核状态/备注的遮蔽记录且全部阻断', () => {
    const records = buildMaskingRecords(v1.points);
    expect(records).toHaveLength(v1.points.length * 5);
    expect(records.every((r) => r.blocked)).toBe(true);
    expect(records.some((r) => r.field === 'coord')).toBe(true);
    expect(records.some((r) => r.field === 'owner')).toBe(true);
    expect(records.some((r) => r.field === 'errorM')).toBe(true);
  });

  it('公开视图不含原始坐标、责任人、单点精度与风险依据', async () => {
    const pub = await build([], { mode: 'risk_adaptive' });
    const json = JSON.stringify(publicViewOf(pub));
    expect(scanPublicLeaks(json, v1.points)).toEqual([]);
    expect(json).not.toContain('巡线员');
    // 遮蔽记录的 field 名可公开（仅审计字段名），但任何单点精度值都不得出现
    expect(json).not.toContain('"errorM":0.8');
    expect(json).not.toContain('"errorM":0.5');
    expect(json).not.toContain('"internalClearanceM"');
    // 公开视图保留遮蔽审计记录本身，便于核对遮蔽原因
    expect(json).toContain('责任人属内部信息');
  });
});

describe('差异验收：公开几何 vs 内部真值', () => {
  it('全部点满足保守、方向一致、无精确泄露，DP-01 内部包络已跨缓冲', async () => {
    const pub = await build([], { mode: 'fixed_grid' });
    expect(pub.summary.acceptanceFailures).toBe(0);
    expect(pub.acceptance.every((a) => a.conservative && a.consistent && !a.leaksExact)).toBe(true);
    const dp1 = pub.acceptance.find((a) => a.pointId === 'DP-01')!;
    expect(dp1.internalEnvelopeMarginM).toBeLessThan(0); // 2.6–4.2 跨 3 米
    expect(dp1.publicIntersects).toBe(true);
    const dp2 = pub.acceptance.find((a) => a.pointId === 'DP-02')!;
    expect(dp2.internalEnvelopeMarginM).toBeGreaterThan(0);
    expect(dp2.publicIntersects).toBe(false);
  });

  it('DP-03 已在缓冲带内，批量两路都判相交并阻断', async () => {
    for (const mode of ['fixed_grid', 'risk_adaptive'] as const) {
      const pub = await build([], { mode });
      const dp3 = pub.verdicts.find((v) => v.pointId === 'DP-03')!;
      expect(pub.acceptance.find((a) => a.pointId === 'DP-03')!.internalInside).toBe(true);
      expect(dp3.intersectsBuffer).toBe(true);
      expect(dp3.exactBlocked).toBe(true);
    }
  });
});

describe('版本与回退：回退生成新的公开差异版本', () => {
  it('内部版本回退生成新公开版本号，并显式记录差异与前序版本', async () => {
    const p1 = await build([], { mode: 'risk_adaptive' }); // IG-v1 -> PG-0001
    const p2 = await build([p1], { mode: 'risk_adaptive', internal: internalGeometryV2() }); // IG-v2 -> PG-0002
    expect(p2.publicVersionId).toBe('PG-0002');
    expect(p2.diff.comparedTo).toBe('PG-0001');
    expect(p2.diff.changed.some((c) => c.pointId === 'DP-01')).toBe(true);

    // 内部回退到 IG-v1，必须生成新的 PG-0003，不得沿用 PG-0002 或“最新”标记
    const p3 = await build([p1, p2], { mode: 'risk_adaptive', rollback: true }); // internal defaults to IG-v1
    expect(p3.publicVersionId).toBe('PG-0003');
    expect(p3.publicVersionId).not.toBe(p2.publicVersionId);
    expect(p3.regeneratedFromRollback).toBe(true);
    expect(p3.basedOnInternalVersion).toBe('IG-v1');
    expect(p3.derivedFromPublicId).toBe('PG-0002');
    expect(p3.diff.comparedTo).toBe('PG-0002');
    expect(p3.notes.join(' ')).toContain('回退');
    // 差异版本相对 PG-0001 的结论方向应回到 IG-v1 状态
    expect(p3.verdicts.find((v) => v.pointId === 'DP-04')!.publicConclusion).toBe('safe_zone');
    expect(p3.verdicts.find((v) => v.pointId === 'DP-03')!.publicConclusion).toBe('possibly_intersects');
  });

  it('版本号单调递增，不会复用旧号', () => {
    const mk = (id: string) => ({ publicVersionId: id }) as PublicGeometryVersion;
    expect(nextPublicVersionId([])).toBe('PG-0001');
    expect(nextPublicVersionId([mk('PG-0001')])).toBe('PG-0002');
    expect(nextPublicVersionId([mk('PG-0001'), mk('PG-0002')])).toBe('PG-0003');
  });
});
