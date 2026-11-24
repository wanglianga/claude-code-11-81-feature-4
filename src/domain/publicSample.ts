// 公开几何样例：内部设施探测点真值与沟槽（施工开挖）真值。
// 样例叙事：DP-01 的估计位置距沟槽边线 3.4 米（估计），定位误差 ±0.8 米，且位置仍待现场复核；
// 其误差包络覆盖 2.6–4.2 米，跨越 3 米禁挖缓冲外沿，因此不能据点估计宣称安全。
// 坐标、误差、责任人均为虚构内部真值，绝不允许直接进入公开账。
import type { DetectionPointTruth, InternalGeometryVersion, TrenchTruth } from './types';

/** 施工沟槽：中心线沿 x 轴 y=40，宽度 2 米（边线 y=39 / y=41），禁挖缓冲 3 米（外沿 y=36 / y=44） */
export function trenchTruth(): TrenchTruth {
  return {
    id: 'T-2026-07',
    centerline: { points: [{ x: 0, y: 40 }, { x: 200, y: 40 }] },
    widthM: 2,
    bufferM: 3,
    zone: 'Z-A',
  };
}

function pointsV1(): DetectionPointTruth[] {
  return [
    // 关键样例：估计距边线 3.4 米、误差 ±0.8 米、待现场复核；包络 2.6–4.2 米跨 3 米缓冲外沿
    { id: 'DP-01', facility: '燃气阀门', coord: { x: 30, y: 35.6 }, errorM: 0.8, verifyState: 'pending', owner: '巡线员-李工', internalNote: '位置待现场复核，不得对外发布坐标' },
    // 远离缓冲：内部包络完全在外，两路均应发布安全区
    { id: 'DP-02', facility: '给水阀门', coord: { x: 70, y: 20 }, errorM: 0.5, verifyState: 'verified', owner: '巡线员-王工', internalNote: '已复核，距沟槽边线 19 米' },
    // 已在缓冲带内：两路均须判为相交并阻断精确位置
    { id: 'DP-03', facility: '热力阀门', coord: { x: 100, y: 37.6 }, errorM: 0.6, verifyState: 'pending', owner: '巡线员-赵工', internalNote: '位于缓冲带内，严禁机械开挖' },
    // 缓冲外 2.5 米：自适应细网格可给安全区，固定粗网格会覆盖缓冲只能给“可能相交”
    { id: 'DP-04', facility: '排水阀门', coord: { x: 130, y: 46.5 }, errorM: 0.7, verifyState: 'verified', owner: '巡线员-钱工', internalNote: '距沟槽边线 5.5 米，缓冲外 2.5 米' },
  ];
}

/** 内部版本 v1：现场复核前的基准 */
export function internalGeometryV1(): InternalGeometryVersion {
  return {
    internalVersionId: 'IG-v1',
    label: '2026-07 现场复核前：DP-01 待核，其余按最近一次探测',
    trench: trenchTruth(),
    points: pointsV1(),
    createdAt: '2026-07-02T09:00:00.000Z',
  };
}

/** 内部版本 v2：DP-01 复核后向沟槽移动（进入缓冲），DP-03 已复核，DP-04 微调 */
export function internalGeometryV2(): InternalGeometryVersion {
  const points = pointsV1().map((p) => {
    if (p.id === 'DP-01') return { ...p, coord: { x: 30, y: 36.6 }, errorM: 0.8, verifyState: 'pending' as const, internalNote: '复核结果仍待确认，位置更靠近沟槽' };
    if (p.id === 'DP-03') return { ...p, verifyState: 'verified' as const, internalNote: '已复核，仍位于缓冲带内' };
    return p;
  });
  return {
    internalVersionId: 'IG-v2',
    label: '2026-07 复核进展：DP-01 向沟槽靠近，DP-03 完成复核',
    trench: trenchTruth(),
    points,
    createdAt: '2026-07-09T09:00:00.000Z',
  };
}

export function internalVersions(): InternalGeometryVersion[] {
  return [internalGeometryV1(), internalGeometryV2()];
}
