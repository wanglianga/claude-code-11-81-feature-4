// 公开几何地图：绘制沟槽中心线/边线、探测点 3 米缓冲范围，以及公开包络（圆形）和结论类别。
// 只使用公开账中的泛化包络，不绘制内部原始坐标；内部审计视图单独标注。
import { useMemo } from 'react';
import type { PublicEnvelope, TrenchTruth } from '../domain/types';

const W = 820;
const H = 340;
const PAD = 24;
const DATA_W = 200;
const VIEW_MIN_Y = 10;
const VIEW_MAX_Y = 80;

function proj(p: { x: number; y: number }): { x: number; y: number } {
  return {
    x: PAD + (p.x / DATA_W) * (W - 2 * PAD),
    y: H - PAD - ((p.y - VIEW_MIN_Y) / (VIEW_MAX_Y - VIEW_MIN_Y)) * (H - 2 * PAD),
  };
}

function polyline(points: { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${proj(p).x.toFixed(1)},${proj(p).y.toFixed(1)}`).join(' ');
}

/** 缓冲带：中心线上下各外扩 widthM/2 + bufferM 的闭合多边形 */
function bufferBand(trench: TrenchTruth): { x: number; y: number }[] {
  const half = trench.widthM / 2 + trench.bufferM;
  const xs = trench.centerline.points.map((p) => p.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const y = trench.centerline.points[0].y;
  return [
    { x: minX, y: y - half },
    { x: maxX, y: y - half },
    { x: maxX, y: y + half },
    { x: minX, y: y + half },
  ];
}

/** 沟槽边线（宽度两侧） */
function edgeLines(trench: TrenchTruth): [{ x: number; y: number }[], { x: number; y: number }[]] {
  const half = trench.widthM / 2;
  const y = trench.centerline.points[0].y;
  const xs = trench.centerline.points.map((p) => p.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  return [
    [{ x: minX, y: y - half }, { x: maxX, y: y - half }],
    [{ x: minX, y: y + half }, { x: maxX, y: y + half }],
  ];
}

const SCALE_X = (W - 2 * PAD) / DATA_W;

export interface PublicPointMarker {
  pointId: string;
  envelope: PublicEnvelope;
  conclusion: 'safe_zone' | 'possibly_intersects';
  /** 可选：内部真值坐标（仅内部审计视图传入） */
  internalCoord?: { x: number; y: number };
}

interface PublicMapProps {
  trench: TrenchTruth;
  markers: PublicPointMarker[];
  showInternalTruth?: boolean;
  title?: string;
}

export function PublicGeometryMap({ trench, markers, showInternalTruth = false, title }: PublicMapProps) {
  const band = useMemo(() => bufferBand(trench), [trench]);
  const edges = useMemo(() => edgeLines(trench), [trench]);

  const bandPath = `${polyline(band)} Z`;

  const colorOf = (c: PublicPointMarker['conclusion']) => (c === 'safe_zone' ? '#047857' : '#b91c1c');

  return (
    <div className="map-wrap">
      {title && <div className="small" style={{ marginBottom: 4 }}>{title}</div>}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="公开几何地图">
        <rect x={0} y={0} width={W} height={H} fill="#fbfdff" />
        {/* 禁挖缓冲带 */}
        <path d={bandPath} fill="rgba(220,38,38,0.10)" stroke="#dc2626" strokeWidth={1.2} strokeDasharray="6 4" />
        <text {...proj({ x: 2, y: trench.centerline.points[0].y + trench.widthM / 2 + trench.bufferM + 2.5 })} fontSize={10.5} fill="#dc2626">
          探测点 3 米缓冲范围（沟槽边线外 3 米内 = 进入缓冲）
        </text>
        {/* 沟槽边线 */}
        {edges.map((e, i) => (
          <path key={i} d={polyline(e)} fill="none" stroke="#7c2d12" strokeWidth={2} />
        ))}
        {/* 沟槽中心线 */}
        <path d={polyline(trench.centerline.points)} fill="none" stroke="#9a3412" strokeWidth={1} strokeDasharray="4 4" />
        <text {...proj({ x: 4, y: trench.centerline.points[0].y - 1.4 })} fontSize={10.5} fill="#9a3412">沟槽 {trench.id}（宽 {trench.widthM}m）</text>

        {/* 公开包络 */}
        {markers.map((m) => {
          const c = proj(m.envelope.center);
          const r = m.envelope.halfWidthM * SCALE_X;
          const color = colorOf(m.conclusion);
          const label = m.conclusion === 'safe_zone' ? '安全区' : '可能相交/待核';
          return (
            <g key={m.pointId}>
              <circle cx={c.x} cy={c.y} r={r} fill={`${color}18`} stroke={color} strokeWidth={1.6} />
              <circle cx={c.x} cy={c.y} r={2.6} fill={color} />
              <text x={c.x + r + 4} y={c.y + 3} fontSize={10.5} fill={color}>
                {m.pointId}·{label}
              </text>
              {showInternalTruth && m.internalCoord && (
                <>
                  <circle cx={proj(m.internalCoord).x} cy={proj(m.internalCoord).y} r={3} fill="#1d4ed8" />
                  <line x1={c.x} y1={c.y} x2={proj(m.internalCoord).x} y2={proj(m.internalCoord).y} stroke="#1d4ed8" strokeWidth={1} strokeDasharray="2 2" />
                </>
              )}
            </g>
          );
        })}
      </svg>
      <div className="legend">
        <span style={{ ['--c' as string]: '#7c2d12' }}>
          <i style={{ display: 'inline-block', width: 14, height: 3, background: '#7c2d12', marginRight: 5, borderRadius: 2 }} />沟槽边线
        </span>
        <span style={{ ['--c' as string]: '#dc2626' }}>
          <i style={{ display: 'inline-block', width: 14, height: 8, background: 'rgba(220,38,38,0.18)', border: '1px dashed #dc2626', marginRight: 5, borderRadius: 2 }} />探测点 3 米缓冲范围
        </span>
        <span style={{ ['--c' as string]: '#047857' }}>
          <i style={{ display: 'inline-block', width: 12, height: 12, background: 'rgba(4,120,87,0.15)', border: '1px solid #047857', marginRight: 5, borderRadius: '50%' }} />安全区结论
        </span>
        <span style={{ ['--c' as string]: '#b91c1c' }}>
          <i style={{ display: 'inline-block', width: 12, height: 12, background: 'rgba(185,28,28,0.15)', border: '1px solid #b91c1c', marginRight: 5, borderRadius: '50%' }} />可能相交 / 待核
        </span>
        {showInternalTruth && (
          <span style={{ ['--c' as string]: '#1d4ed8' }}>
            <i style={{ display: 'inline-block', width: 8, height: 8, background: '#1d4ed8', marginRight: 5, borderRadius: '50%' }} />内部真值（仅审计视图）
          </span>
        )}
      </div>
    </div>
  );
}
