// 公开几何发布：把内部设施探测点真值派生为“不含原始坐标、统一精度、可审计”的公开版本。
//
// 约束（与题目叙事一致）：
// 1) 公开账不得暴露探测精度、责任人或待核坐标；原始坐标只留在内部账。
// 2) 两路方案（固定比例尺网格泛化 / 施工风险自适应模糊）都必须：
//    - 以保守误差包络覆盖真实点位；
//    - 只要包络与“探测点周围 3 米禁挖缓冲带”相交，就判为待核并阻止精确位置发布；
//    - 只有包络完全在缓冲外，才发布“不含原始坐标的安全区结论”。
//    判定等价式：探测点到沟槽边线距离 d < 3 米 ⇔ 沟槽进入以该点为圆心、半径 3 米的禁挖缓冲带。
//    因此本模块以沟槽边线为基准计算“缓冲余量 = d − 3”，并在公开地图上用沟槽边线外 3 米范围
//    作为该缓冲带的等价可视化（沟槽几何为公开量，绘制它不泄露探测点坐标）。
// 3) 内部版本回退必须生成“新的公开差异版本”，不得沿用“最新”标记。
import type {
  AcceptanceRow,
  DetectionPointTruth,
  GeneralizeMode,
  InternalGeometryVersion,
  MaskingRecord,
  Point,
  PublicEnvelope,
  PublicGeometryVersion,
  PublicPointVerdict,
  PublicRiskAudit,
  PublicVersionDiff,
  PublicZonePolicy,
  TrenchTruth,
} from './types';
import { closestPointOnSegment, distance, round3 } from './geometry';
import { stableHash } from './hash';

/** 禁挖缓冲带半径（米），题目样例为 3 米 */
export const DETECTION_BUFFER_M = 3;

/** 统一公开精度下限（米）：所有设施一致，避免按精度差异反推设施类别 */
export const UNIFORM_PRECISION_M = 0.2;

// ---------------------------------------------------------------------------
// 几何：点到沟槽边线的距离
// ---------------------------------------------------------------------------

/** 点到沟槽中心折线的最短距离 */
function pointToCenterline(p: Point, trench: TrenchTruth): number {
  let best = Infinity;
  const pts = trench.centerline.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const q = closestPointOnSegment(p, pts[i], pts[i + 1]);
    best = Math.min(best, distance(p, q));
  }
  return best;
}

/**
 * 点到沟槽边线（而非中心线）的距离：中心线距离减去半宽。
 * 样例沟槽为直线段，端部效应可忽略；非直线段按最近段近似，足够支撑本虚构样例。
 */
export function pointToTrenchEdgeDistance(p: Point, trench: TrenchTruth): number {
  return round3(pointToCenterline(p, trench) - trench.widthM / 2);
}

/** 点到“禁挖缓冲带外沿”的余量（米）：边线距离 − 缓冲半径；负=已在缓冲带内 */
export function pointBufferClearance(p: Point, trench: TrenchTruth, bufferM: number): number {
  return round3(pointToTrenchEdgeDistance(p, trench) - bufferM);
}

// ---------------------------------------------------------------------------
// 泛化与误差包络
// ---------------------------------------------------------------------------

/** 单元格中心（网格以原点为基准，确定性可审计） */
export function quantizeToCell(p: Point, cellM: number): { center: Point; shiftM: number } {
  const cx = Math.floor(p.x / cellM) * cellM + cellM / 2;
  const cy = Math.floor(p.y / cellM) * cellM + cellM / 2;
  let center: Point = { x: round3(cx), y: round3(cy) };
  let shiftM = distance(p, center);
  // 防止点位恰好落在网格中心：确定性微移（仍在半对角线内，保守性不受影响）
  if (shiftM < 1e-6) {
    center = { x: round3(center.x + 0.25 * cellM), y: round3(center.y + 0.25 * cellM) };
    shiftM = distance(p, center);
  }
  return { center, shiftM };
}

function halfDiagonal(cellM: number): number {
  return (cellM * Math.SQRT2) / 2;
}

/** 全样例最大定位误差：作为统一包络冗余，所有设施共用，避免披露单点精度 */
export function globalMaxError(points: DetectionPointTruth[]): number {
  return round3(Math.max(0, ...points.map((p) => p.errorM)));
}

/** 某一网格尺寸下统一对外公布的包络半宽（与具体设施无关） */
export function uniformHalfWidth(cellM: number, maxErrorM: number): number {
  return round3(halfDiagonal(cellM) + maxErrorM + UNIFORM_PRECISION_M);
}

/** 自适应风险档：按内部净距判定高/低风险带（依据写入内部审计，公开仅给粗档位） */
export function riskClassOf(internalClearanceM: number, policy: PublicZonePolicy): 'high' | 'low' {
  return internalClearanceM <= policy.riskMarginM ? 'high' : 'low';
}

export function cellSizeFor(
  point: DetectionPointTruth,
  trench: TrenchTruth,
  policy: PublicZonePolicy,
): { cellM: number; riskClass: 'high' | 'low'; basis: string } {
  const clearance = pointBufferClearance(point.coord, trench, trench.bufferM);
  if (policy.mode === 'fixed_grid') {
    return {
      cellM: policy.cellM,
      riskClass: 'low',
      basis: `固定比例尺网格：统一 ${policy.cellM} 米格网，精度一致、易审计`,
    };
  }
  const cls = riskClassOf(clearance, policy);
  const cellM = cls === 'high' ? policy.fineCellM : policy.coarseCellM;
  return {
    cellM,
    riskClass: cls,
    basis:
      cls === 'high'
        ? `施工高风险带（内部净距 ${clearance} 米 ≤ 阈值 ${policy.riskMarginM} 米）：保留 ${cellM} 米细网格的保守包络`
        : `远离缓冲（内部净距 ${clearance} 米 > 阈值 ${policy.riskMarginM} 米）：加大泛化至 ${cellM} 米格网`,
  };
}

/** 包络是否与禁挖缓冲带相交（保守：包络最小边距 < 缓冲半径） */
export function envelopeBufferClearance(
  center: Point,
  halfWidthM: number,
  trench: TrenchTruth,
  bufferM: number,
): { clearanceM: number; intersects: boolean } {
  const clearanceM = round3(pointToTrenchEdgeDistance(center, trench) - halfWidthM - bufferM);
  return { clearanceM, intersects: clearanceM < 0 };
}

// ---------------------------------------------------------------------------
// 遮蔽记录
// ---------------------------------------------------------------------------

/** 每个探测点必须遮蔽的内部字段及可见形式 */
export function buildMaskingRecords(points: DetectionPointTruth[]): MaskingRecord[] {
  const fields: { field: MaskingRecord['field']; reason: string; visibleForm: string }[] = [
    { field: 'coord', reason: '原始/校正坐标（含待核坐标）不得进入公开账', visibleForm: '泛化单元中心（已量化到公开格网，非原始坐标）' },
    { field: 'errorM', reason: '探测精度不得公开，否则可按精度差异识别设施', visibleForm: '统一公开包络半宽（全设施一致）' },
    { field: 'owner', reason: '责任人属内部信息，不得公开', visibleForm: '（已遮蔽，不对外呈现）' },
    { field: 'verifyState', reason: '内部复核状态不得公开，否则可与坐标组合泄露现场结论', visibleForm: '（不公开；是否须现场复核由包络相交结论统一给出）' },
    { field: 'internalNote', reason: '内部备注可能含精确位置线索', visibleForm: '（已遮蔽，不对外呈现）' },
  ];
  const out: MaskingRecord[] = [];
  for (const p of points) {
    for (const f of fields) {
      out.push({ subjectId: p.id, field: f.field, reason: f.reason, visibleForm: f.visibleForm, blocked: true });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 公开判定与验收
// ---------------------------------------------------------------------------

function buildVerdict(
  point: DetectionPointTruth,
  trench: TrenchTruth,
  policy: PublicZonePolicy,
  maxErrorM: number,
): { verdict: PublicPointVerdict; audit: PublicRiskAudit } {
  const { cellM, riskClass, basis } = cellSizeFor(point, trench, policy);
  const { center } = quantizeToCell(point.coord, cellM);
  const halfWidthM = uniformHalfWidth(cellM, maxErrorM);
  const { clearanceM, intersects } = envelopeBufferClearance(center, halfWidthM, trench, trench.bufferM);

  // 结论只由包络是否与缓冲相交决定，不依赖内部待核状态（避免泄露未公开的复核状态）。
  // 相交即待核：无论内部是否已验证，都不得发布精确位置。
  const publicConclusion: PublicPointVerdict['publicConclusion'] = intersects
    ? 'possibly_intersects'
    : 'safe_zone';

  const envelope: PublicEnvelope = {
    center,
    cellM,
    halfWidthM,
    basis: policy.mode,
    riskClass,
  };

  const notes: string[] = [
    `公开包络半宽 ${halfWidthM} 米 = 格网半对角线 ${round3(halfDiagonal(cellM))} + 统一误差冗余 ${maxErrorM + UNIFORM_PRECISION_M}（全设施一致）`,
    intersects
      ? '包络与 3 米禁挖缓冲带相交：施工方只能得到“可能相交”，须待现场复核，禁止发布精确位置'
      : '包络完全位于 3 米禁挖缓冲带之外：可发布不含原始坐标的安全区结论',
  ];
  if (point.verifyState === 'pending') notes.push('内部真值仍标记为待现场复核');

  return {
    verdict: {
      pointId: point.id,
      facility: point.facility,
      envelope,
      envelopeToBufferM: clearanceM,
      intersectsBuffer: intersects,
      publicConclusion,
      exactBlocked: intersects,
      notes,
    },
    audit: { pointId: point.id, riskClass, criterion: basis, internalClearanceM: pointBufferClearance(point.coord, trench, trench.bufferM) },
  };
}

/** 用指定内部真值版本对一组公开判定做逐点验收（支持页面上切换对照版本） */
export function buildAcceptanceRows(
  verdicts: Pick<PublicPointVerdict, 'pointId' | 'envelope' | 'envelopeToBufferM' | 'intersectsBuffer'>[],
  internal: InternalGeometryVersion,
): AcceptanceRow[] {
  return internal.points.map((p) => {
    const v = verdicts.find((x) => x.pointId === p.id);
    if (!v) {
      return {
        pointId: p.id,
        internalEdgeDistanceM: pointToTrenchEdgeDistance(p.coord, internal.trench),
        internalClearanceM: pointBufferClearance(p.coord, internal.trench, internal.trench.bufferM),
        internalEnvelopeMarginM: round3(pointToTrenchEdgeDistance(p.coord, internal.trench) - p.errorM - internal.trench.bufferM),
        envelopeClearanceM: Number.POSITIVE_INFINITY,
        internalInside: pointBufferClearance(p.coord, internal.trench, internal.trench.bufferM) < 0,
        publicIntersects: false,
        generalizationShiftM: 0,
        conservative: false,
        consistent: false,
        leaksExact: true,
        note: '公开版本中缺少该点，无法验收',
      };
    }
    return buildAcceptanceRow(p, internal.trench, v);
  });
}

export function buildAcceptanceRow(
  point: DetectionPointTruth,
  trench: TrenchTruth,
  verdict: Pick<PublicPointVerdict, 'pointId' | 'envelope' | 'envelopeToBufferM' | 'intersectsBuffer'>,
): AcceptanceRow {
  const edge = pointToTrenchEdgeDistance(point.coord, trench);
  const internalClearance = round3(edge - trench.bufferM);
  const internalEnvelopeMargin = round3(edge - point.errorM - trench.bufferM);
  const shift = distance(point.coord, verdict.envelope.center);
  // 保守性：公开包络必须覆盖真实点（半宽 ≥ 泛化位移 + 该点误差）
  const conservative = verdict.envelope.halfWidthM + 1e-9 >= shift + point.errorM;
  // 一致性：内部误差包络可能进入缓冲（margin<0）时，公开侧必须判为相交，不得漏报
  const consistent = !(internalEnvelopeMargin < 0 && !verdict.intersectsBuffer);
  const leaksExact = shift < 1e-9;
  return {
    pointId: point.id,
    internalEdgeDistanceM: edge,
    internalClearanceM: internalClearance,
    internalEnvelopeMarginM: internalEnvelopeMargin,
    envelopeClearanceM: verdict.envelopeToBufferM,
    internalInside: internalClearance < 0,
    publicIntersects: verdict.intersectsBuffer,
    generalizationShiftM: round3(shift),
    conservative,
    consistent,
    leaksExact,
    note: leakNote(verdict, internalEnvelopeMargin, conservative, consistent, leaksExact),
  };
}

function leakNote(
  v: Pick<PublicPointVerdict, 'intersectsBuffer'>,
  margin: number,
  conservative: boolean,
  consistent: boolean,
  leaksExact: boolean,
): string {
  const parts: string[] = [];
  if (!conservative) parts.push('公开包络未覆盖真实点（不保守）');
  if (!consistent) parts.push('内部误差包络可进入缓冲但公开侧判为安全（漏报）');
  if (leaksExact) parts.push('泛化中心与真实坐标重合（可反推）');
  if (parts.length === 0) {
    parts.push(
      v.intersectsBuffer
        ? `内部包络余量 ${margin} 米已跨缓冲，公开侧保守判为可能相交`
        : `内部包络余量 ${margin} 米完全在缓冲外，公开侧发布安全区`,
    );
  }
  return parts.join('；');
}

// ---------------------------------------------------------------------------
// 版本与差异
// ---------------------------------------------------------------------------

export function nextPublicVersionId(existing: PublicGeometryVersion[]): string {
  const n = existing.length + 1;
  return `PG-${String(n).padStart(4, '0')}`;
}

export function diffPublicVersions(
  prev: PublicGeometryVersion | null,
  nextVerdicts: PublicPointVerdict[],
): PublicVersionDiff {
  if (!prev) {
    return { comparedTo: null, added: nextVerdicts.map((v) => v.pointId), removed: [], changed: [] };
  }
  const prevById = new Map(prev.verdicts.map((v) => [v.pointId, v]));
  const nextById = new Map(nextVerdicts.map((v) => [v.pointId, v]));
  const added = nextVerdicts.filter((v) => !prevById.has(v.pointId)).map((v) => v.pointId);
  const removed = prev.verdicts.filter((v) => !nextById.has(v.pointId)).map((v) => v.pointId);
  const changed: PublicVersionDiff['changed'] = [];
  for (const v of nextVerdicts) {
    const old = prevById.get(v.pointId);
    if (!old) continue;
    if (
      old.publicConclusion !== v.publicConclusion ||
      old.envelope.halfWidthM !== v.envelope.halfWidthM ||
      old.envelope.center.x !== v.envelope.center.x ||
      old.envelope.center.y !== v.envelope.center.y
    ) {
      changed.push({
        pointId: v.pointId,
        fromConclusion: old.publicConclusion,
        toConclusion: v.publicConclusion,
        fromHalfWidthM: old.envelope.halfWidthM,
        toHalfWidthM: v.envelope.halfWidthM,
      });
    }
  }
  return { comparedTo: prev.publicVersionId, added, removed, changed };
}

export interface BuildPublicOptions {
  internal: InternalGeometryVersion;
  policy: PublicZonePolicy;
  /** 已有公开账（用于生成单调递增的新版本号，绝不复用旧号或“最新”标记） */
  existing: PublicGeometryVersion[];
  /** 是否由内部版本回退触发：回退必须生成新的公开差异版本 */
  rollback?: boolean;
  /** 上一公开版本（用于计算差异），缺省取 existing 最后一条 */
  previous?: PublicGeometryVersion | null;
}

export async function buildPublicGeometryVersion(opts: BuildPublicOptions): Promise<PublicGeometryVersion> {
  const { internal, policy, existing } = opts;
  const previous = opts.previous ?? existing.at(-1) ?? null;
  const maxErrorM = globalMaxError(internal.points);

  const verdicts: PublicPointVerdict[] = [];
  const riskAudit: PublicRiskAudit[] = [];
  for (const p of internal.points) {
    const { verdict, audit } = buildVerdict(p, internal.trench, policy, maxErrorM);
    verdicts.push(verdict);
    riskAudit.push(audit);
  }
  const acceptance = buildAcceptanceRows(verdicts, internal);
  const maskingRecords = buildMaskingRecords(internal.points);

  const truthRefHash = await stableHash({
    trench: internal.trench,
    points: internal.points.map((p) => ({ id: p.id, coord: p.coord, errorM: p.errorM, owner: p.owner })),
  });

  const summary = {
    safeCount: verdicts.filter((v) => v.publicConclusion === 'safe_zone').length,
    pendingCount: verdicts.filter((v) => v.publicConclusion !== 'safe_zone').length,
    blockedExactCount: verdicts.filter((v) => v.exactBlocked).length,
    acceptanceFailures: acceptance.filter((a) => !a.conservative || !a.consistent || a.leaksExact).length,
  };

  return {
    publicVersionId: nextPublicVersionId(existing),
    basedOnInternalVersion: internal.internalVersionId,
    derivedFromPublicId: previous?.publicVersionId ?? null,
    mode: policy.mode,
    policy,
    bufferM: internal.trench.bufferM,
    envelopeVersion: 'envelope-rule-v1',
    verdicts,
    maskingRecords,
    acceptance,
    riskBasis: riskAudit,
    diff: diffPublicVersions(previous, verdicts),
    regeneratedFromRollback: Boolean(opts.rollback),
    truthRefHash,
    createdAt: new Date().toISOString(),
    summary,
    notes: [
      opts.rollback
        ? `内部版本由 ${previous?.basedOnInternalVersion ?? '未知'} 回退至 ${internal.internalVersionId}，已生成新的公开差异版本 ${nextPublicVersionId(existing)}（未沿用旧版本或“最新”标记）`
        : `由内部版本 ${internal.internalVersionId} 派生公开版本，模式 ${policy.mode === 'fixed_grid' ? '固定比例尺网格' : '施工风险自适应'}（${policy.mode}）`,
      '公开账仅含泛化包络与结论类别，原始坐标、探测精度与责任人保留在内部账并登记遮蔽原因',
    ],
  };
}

// ---------------------------------------------------------------------------
// 公开视图（剥离内部审计字段）与泄露扫描
// ---------------------------------------------------------------------------

/** 对外发布的可视子集：去掉风险依据与内部验收距离，仅留结论类别与泛化包络 */
export interface PublicView {
  publicVersionId: string;
  basedOnInternalVersion: string;
  derivedFromPublicId: string | null;
  mode: GeneralizeMode;
  bufferM: number;
  envelopeVersion: string;
  regeneratedFromRollback: boolean;
  points: {
    pointId: string;
    facility: string;
    /** 公开包络：不含风险档与内部依据，避免由档位反推精确坐标 */
    envelope: { center: Point; cellM: number; halfWidthM: number; basis: GeneralizeMode };
    bufferedIntersects: boolean;
    conclusion: PublicPointVerdict['publicConclusion'];
    exactPositionBlocked: boolean;
  }[];
  maskingRecords: { subjectId: string; field: string; reason: string; visibleForm: string }[];
  diff: PublicVersionDiff;
  summary: PublicGeometryVersion['summary'];
}

export function publicViewOf(v: PublicGeometryVersion): PublicView {
  return {
    publicVersionId: v.publicVersionId,
    basedOnInternalVersion: v.basedOnInternalVersion,
    derivedFromPublicId: v.derivedFromPublicId,
    mode: v.mode,
    bufferM: v.bufferM,
    envelopeVersion: v.envelopeVersion,
    regeneratedFromRollback: v.regeneratedFromRollback,
    points: v.verdicts.map((p) => ({
      pointId: p.pointId,
      facility: p.facility,
      envelope: {
        center: p.envelope.center,
        cellM: p.envelope.cellM,
        halfWidthM: p.envelope.halfWidthM,
        basis: p.envelope.basis,
      },
      bufferedIntersects: p.intersectsBuffer,
      conclusion: p.publicConclusion,
      exactPositionBlocked: p.exactBlocked,
    })),
    maskingRecords: v.maskingRecords.map((m) => ({
      subjectId: m.subjectId,
      field: m.field,
      reason: m.reason,
      visibleForm: m.visibleForm,
    })),
    diff: v.diff,
    summary: v.summary,
  };
}

/** 扫描公开视图是否泄露原始坐标 / 责任人 / 单点精度 */
export function scanPublicLeaks(publicJson: string, points: DetectionPointTruth[]): string[] {
  const leaks: string[] = [];
  for (const p of points) {
    if (p.owner && publicJson.includes(p.owner)) leaks.push(`${p.id}: 责任人「${p.owner}」出现在公开视图`);
    const pair = JSON.stringify({ x: p.coord.x, y: p.coord.y });
    if (publicJson.includes(pair)) leaks.push(`${p.id}: 原始坐标 ${pair} 出现在公开视图`);
    const errLiteral = `"errorM":${JSON.stringify(p.errorM)}`;
    if (publicJson.includes(errLiteral)) leaks.push(`${p.id}: 单点精度 ${p.errorM} 出现在公开视图`);
  }
  return leaks;
}

// ---------------------------------------------------------------------------
// 默认方案
// ---------------------------------------------------------------------------

/** 两路方案：固定比例尺网格泛化 / 施工风险自适应模糊 */
export const PUBLIC_POLICIES: Record<GeneralizeMode, PublicZonePolicy> = {
  fixed_grid: {
    mode: 'fixed_grid',
    cellM: 6,
    fineCellM: 6,
    coarseCellM: 6,
    riskMarginM: 0,
    uniformPrecisionM: UNIFORM_PRECISION_M,
  },
  risk_adaptive: {
    mode: 'risk_adaptive',
    cellM: 6,
    fineCellM: 1,
    coarseCellM: 6,
    // 高风险带阈值：缓冲外超过 2.5 米内视为施工高风险，保留细网格
    riskMarginM: 2.5,
    uniformPrecisionM: UNIFORM_PRECISION_M,
  },
};

export function allModes(): GeneralizeMode[] {
  return ['fixed_grid', 'risk_adaptive'];
}
