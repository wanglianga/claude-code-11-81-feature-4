import { useMemo, useState } from 'react';
import { useApp } from '../state/store';
import { Badge, Banner, Empty } from '../components/ui';
import { PublicGeometryMap, type PublicPointMarker } from '../components/PublicGeometryMap';
import { PUBLIC_POLICIES, buildAcceptanceRows } from '../domain/publicGeometry';
import { internalVersions } from '../domain/publicSample';
import type { GeneralizeMode, PublicGeometryVersion, PublicPointVerdict } from '../domain/types';

const MODE_LABEL: Record<GeneralizeMode, string> = {
  fixed_grid: '固定比例尺网格泛化',
  risk_adaptive: '施工风险自适应模糊',
};

const CONCLUSION_LABEL: Record<PublicPointVerdict['publicConclusion'], string> = {
  safe_zone: '安全区（可发布）',
  possibly_intersects: '可能相交（待核）',
};

function conclusionTone(c: PublicPointVerdict['publicConclusion']): 'ok' | 'warn' {
  return c === 'safe_zone' ? 'ok' : 'warn';
}

function markerOf(v: PublicPointVerdict, internalCoord?: { x: number; y: number }): PublicPointMarker {
  return { pointId: v.pointId, envelope: v.envelope, conclusion: v.publicConclusion, internalCoord };
}

export function PublicGeometryPage() {
  const { state, publishPublicVersion, clearPublicVersions } = useApp();
  const [internalId, setInternalId] = useState('IG-v1');
  const [compareInternalId, setCompareInternalId] = useState('IG-v1');
  const [rollbackMode, setRollbackMode] = useState<GeneralizeMode>('risk_adaptive');
  const [showTruth, setShowTruth] = useState(false);

  const versions = state.publicVersions;
  const latestOf = useMemo(() => {
    const map: Partial<Record<GeneralizeMode, PublicGeometryVersion>> = {};
    for (const v of versions) map[v.mode] = v; // 版本号有序，后写覆盖 => 最新
    return map;
  }, [versions]);

  const internals = internalVersions();
  const selectedInternal = internals.find((v) => v.internalVersionId === internalId) ?? internals[0];
  const lastOverall = versions.at(-1) ?? null;
  // 回退：把内部版本退到早于当前公开账所依据的版本，强制生成新的公开差异版本
  const canRollback =
    lastOverall !== null && internals.findIndex((v) => v.internalVersionId === lastOverall.basedOnInternalVersion) > 0;

  const coordOf = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const p of selectedInternal.points) m.set(p.id, p.coord);
    return m;
  }, [selectedInternal]);

  const renderRoute = (mode: GeneralizeMode) => {
    const v = latestOf[mode];
    if (!v) {
      return (
        <Empty
          text={`尚未以「${MODE_LABEL[mode]}」派生公开版本，点击下方按钮生成`}
        />
      );
    }
    return (
      <>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>
            {MODE_LABEL[mode]} <Badge tone="info">{v.publicVersionId}</Badge>
            {v.regeneratedFromRollback && <Badge tone="warn">回退差异版本</Badge>}
          </h3>
          <span className="small">
            依据内部版本 <span className="mono">{v.basedOnInternalVersion}</span>
            {v.derivedFromPublicId ? ` · 源自 ${v.derivedFromPublicId}` : ' · 首版'}
          </span>
        </div>
        <PublicGeometryMap
          trench={selectedInternal.trench}
          markers={v.verdicts.map((x) => markerOf(x, showTruth ? coordOf.get(x.pointId) : undefined))}
          showInternalTruth={showTruth}
          title={`公开包络（圆）与 3 米禁挖缓冲带（红色虚线内）；只公开结论类别与泛化包络${showTruth ? '；蓝点=内部真值，仅本地审计可见' : ''}`}
        />
        <table style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>设施点</th><th>公开结论</th><th>格网(m)</th><th>包络半宽(m)</th>
              <th>包络到缓冲外沿(m)</th><th>精确位置</th><th>风险档（内部）</th>
            </tr>
          </thead>
          <tbody>
            {v.verdicts.map((p) => (
              <tr key={p.pointId}>
                <td className="mono">{p.pointId}<div className="small">{p.facility}</div></td>
                <td><Badge tone={conclusionTone(p.publicConclusion)}>{CONCLUSION_LABEL[p.publicConclusion]}</Badge></td>
                <td>{p.envelope.cellM}</td>
                <td>{p.envelope.halfWidthM}</td>
                <td>{p.envelopeToBufferM}</td>
                <td>{p.exactBlocked ? <Badge tone="block">已阻断</Badge> : <Badge tone="ok">仅安全区结论</Badge>}</td>
                <td>{p.envelope.riskClass === 'high' ? '高风险带' : '常规'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small" style={{ marginTop: 8 }}>
          规则：包络与 3 米缓冲相交 → 只给“可能相交（待核）”并阻断精确位置；包络完全在缓冲外 → 才发布不含原始坐标的安全区结论。
          公开账不披露单点精度、责任人与待核坐标，遮蔽记录见本页“字段遮蔽审计”。
        </p>
      </>
    );
  };

  return (
    <div>
      <div className="header">
        <h2>⑪ 公开几何发布（误差包络与遮蔽）</h2>
        <span className="meta">探测点周围 3 米禁挖缓冲带：公开账只暴露泛化包络与结论，原始精度/责任人/待核坐标留在内部账</span>
      </div>

      <Banner tone="info">
        样例：DP-01 估计距沟槽边线 <strong>3.4 米</strong>、定位误差 <strong>±0.8 米</strong>且待现场复核，
        其误差包络覆盖 <strong>2.6–4.2 米</strong>，跨越 3 米缓冲外沿——不能据点估计宣称安全。
        两路方案都必须把包络与缓冲相交视为待核并阻断精确位置；只有包络完全在缓冲外才可发布安全区结论。
      </Banner>

      <div className="panel">
        <h3>发布控制</h3>
        <div className="row">
          <label className="small">内部真值版本：</label>
          <select value={internalId} onChange={(e) => setInternalId(e.target.value)}>
            {internals.map((v) => <option key={v.internalVersionId} value={v.internalVersionId}>{v.internalVersionId} · {v.label}</option>)}
          </select>
          <button className="act" disabled={state.busy} onClick={() => publishPublicVersion('fixed_grid', internalId)}>
            生成固定网格公开版本
          </button>
          <button className="act" disabled={state.busy} onClick={() => publishPublicVersion('risk_adaptive', internalId)}>
            生成风险自适应公开版本
          </button>
          <select value={rollbackMode} onChange={(e) => setRollbackMode(e.target.value as GeneralizeMode)}>
            {(Object.keys(MODE_LABEL) as GeneralizeMode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
          </select>
          <button
            className="ghost"
            disabled={state.busy || !canRollback}
            title={canRollback ? '内部版本回退将生成新的公开差异版本' : '当前公开账已是内部首版，无可回退项'}
            onClick={() => publishPublicVersion(rollbackMode, internals[0].internalVersionId, true)}
          >
            内部版本回退 → 生成新公开差异版本
          </button>
          <label className="small" style={{ marginLeft: 8 }}>
            <input type="checkbox" checked={showTruth} onChange={(e) => setShowTruth(e.target.checked)} /> 叠加内部真值（仅审计）
          </label>
          <button className="ghost" disabled={state.busy || versions.length === 0} onClick={clearPublicVersions}>清空公开版本账</button>
        </div>
        <p className="small" style={{ marginTop: 8 }}>
          回退不会复用旧版本号或“最新”标记：每次发布都生成单调递增的 <span className="mono">PG-xxxx</span>，并记录相对前一公开版本的差异（见下方版本账）。
        </p>
      </div>

      <div className="panel">
        <h3>固定比例尺网格泛化</h3>
        <p className="small">
          统一 {PUBLIC_POLICIES.fixed_grid.cellM} 米格网、全设施一致的包络半宽，最容易审计；代价是靠近缓冲的 DP-04（缓冲外 2.5 米）显示单元跨越边界，施工方只能得到“可能相交”。
          判定口径：探测点到沟槽边线距离 &lt; 3 米，等价于沟槽进入该点周围 3 米禁挖缓冲带；图上红色虚线带即沟槽边线外 3 米范围（由公开沟槽几何得到，不泄露探测点坐标）。
        </p>
        {renderRoute('fixed_grid')}
      </div>

      <div className="panel">
        <h3>施工风险自适应模糊</h3>
        <p className="small">
          高风险边界（净距 ≤ {PUBLIC_POLICIES.risk_adaptive.riskMarginM} 米）保留 {PUBLIC_POLICIES.risk_adaptive.fineCellM} 米细网格的保守包络，远离缓冲处泛化至 {PUBLIC_POLICIES.risk_adaptive.coarseCellM} 米；判别更有用，但必须记录风险依据并防止反推精确坐标。
        </p>
        {renderRoute('risk_adaptive')}
      </div>

      {latestOf.risk_adaptive && (
        <div className="panel">
          <h3>自适应风险依据（内部审计，不对外发布）</h3>
          <table>
            <thead><tr><th>设施点</th><th>风险档</th><th>内部净距(m)</th><th>判定依据</th></tr></thead>
            <tbody>
              {latestOf.risk_adaptive.riskBasis.map((r) => (
                <tr key={r.pointId}>
                  <td className="mono">{r.pointId}</td>
                  <td>{r.riskClass === 'high' ? <Badge tone="block">高风险</Badge> : <Badge tone="gray">常规</Badge>}</td>
                  <td>{r.internalClearanceM}</td>
                  <td style={{ maxWidth: 520 }}>{r.criterion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <h3>字段遮蔽审计</h3>
        <p className="small">下列字段在派生公开账时被遮蔽；原始坐标、单点精度、责任人与待核坐标一律阻断，不进入公开视图。</p>
        {versions.length === 0 ? (
          <Empty text="生成公开版本后在此查看逐字段遮蔽记录" />
        ) : (
          <MaskingTable versions={versions} />
        )}
      </div>

      <div className="panel">
        <h3>验收：公开几何 / 相交结果 vs 内部真值</h3>
        <div className="row" style={{ marginBottom: 8 }}>
          <label className="small">对照内部版本：</label>
          <select value={compareInternalId} onChange={(e) => setCompareInternalId(e.target.value)}>
            {internals.map((v) => <option key={v.internalVersionId} value={v.internalVersionId}>{v.internalVersionId}</option>)}
          </select>
        </div>
        <AcceptanceTables versions={latestOf.fixed_grid ? [latestOf.fixed_grid, latestOf.risk_adaptive].filter(Boolean) as PublicGeometryVersion[] : []} compareInternalId={compareInternalId} />
      </div>

      <div className="panel">
        <h3>公开版本账与差异</h3>
        {versions.length === 0 ? (
          <Empty text="尚无公开几何版本" />
        ) : (
          <table>
            <thead><tr><th>版本</th><th>模式</th><th>依据内部版本</th><th>源自</th><th>回退?</th><th>安全区/待核</th><th>差异</th><th>生成时间</th></tr></thead>
            <tbody>
              {[...versions].reverse().map((v) => (
                <tr key={v.publicVersionId}>
                  <td className="mono">{v.publicVersionId}</td>
                  <td>{MODE_LABEL[v.mode]}</td>
                  <td className="mono">{v.basedOnInternalVersion}</td>
                  <td className="mono">{v.derivedFromPublicId ?? '—'}</td>
                  <td>{v.regeneratedFromRollback ? <Badge tone="warn">是</Badge> : <span className="small">否</span>}</td>
                  <td>{v.summary.safeCount} 安全区 / {v.summary.pendingCount} 待核</td>
                  <td className="small" style={{ maxWidth: 360 }}>{diffText(v)}</td>
                  <td className="small">{v.createdAt.slice(0, 19).replace('T', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function diffText(v: PublicGeometryVersion): string {
  const d = v.diff;
  if (!d.comparedTo) return `首版，含 ${d.added.length} 个点`;
  const parts: string[] = [];
  if (d.added.length) parts.push(`新增 ${d.added.join('、')}`);
  if (d.removed.length) parts.push(`移除 ${d.removed.join('、')}`);
  for (const c of d.changed) {
    if (c.fromConclusion !== c.toConclusion) {
      parts.push(`${c.pointId}：${CONCLUSION_LABEL[c.fromConclusion]} → ${CONCLUSION_LABEL[c.toConclusion]}`);
    } else {
      parts.push(`${c.pointId}：结论不变，公开包络调整（半宽 ${c.fromHalfWidthM} → ${c.toHalfWidthM} 米）`);
    }
  }
  return parts.length ? `对比 ${d.comparedTo}：${parts.join('；')}` : `对比 ${d.comparedTo}：无公开可见变化`;
}

function MaskingTable({ versions }: { versions: PublicGeometryVersion[] }) {
  // 用最近版本的遮蔽记录展示（字段与原因对所有点一致）
  const v = versions.at(-1)!;
  return (
    <table>
      <thead><tr><th>对象</th><th>字段</th><th>可见形式</th><th>遮蔽原因</th><th>处置</th></tr></thead>
      <tbody>
        {v.maskingRecords.map((m, i) => (
          <tr key={i}>
            <td className="mono">{m.subjectId}</td>
            <td className="mono">{m.field}</td>
            <td style={{ maxWidth: 300 }}>{m.visibleForm}</td>
            <td className="small" style={{ maxWidth: 300 }}>{m.reason}</td>
            <td>{m.blocked ? <Badge tone="block">阻断发布</Badge> : <span className="small">—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AcceptanceTables({ versions, compareInternalId }: { versions: PublicGeometryVersion[]; compareInternalId: string }) {
  const internal = internalVersions().find((v) => v.internalVersionId === compareInternalId);
  if (!internal || versions.length === 0) {
    return <Empty text="先生成公开版本后再验收" />;
  }
  // 以内部真值重新计算逐点差异（防止公开账与当前对照内部版本错配）
  return (
    <>
      {versions.map((v) => {
        const rows = buildAcceptanceRows(v.verdicts, internal);
        const failures = rows.filter((a) => !a.conservative || !a.consistent || a.leaksExact).length;
        const match = v.basedOnInternalVersion === compareInternalId;
        return (
          <div key={v.publicVersionId} style={{ marginBottom: 14 }}>
            <div className="row" style={{ marginBottom: 6 }}>
              <strong>{v.publicVersionId}</strong>
              <Badge tone="info">{MODE_LABEL[v.mode]}</Badge>
              {match
                ? <Badge tone="ok">与对照内部版本一致</Badge>
                : <Badge tone="warn">公开版本基于 {v.basedOnInternalVersion}，与对照 {compareInternalId} 不一致</Badge>}
              <span className="small">验收失败 {failures} 项</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>点</th><th>内部边线距(m)</th><th>内部缓冲余量(m)</th><th>内部误差包络余量(m)</th>
                  <th>公开包络到缓冲(m)</th><th>公开判相交</th><th>泛化位移(m)</th><th>保守</th><th>方向一致</th><th>泄露精确坐标</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.pointId}>
                    <td className="mono">{a.pointId}</td>
                    <td>{a.internalEdgeDistanceM}</td>
                    <td>{a.internalClearanceM}</td>
                    <td>{a.internalEnvelopeMarginM}</td>
                    <td>{a.envelopeClearanceM}</td>
                    <td>{a.publicIntersects ? <Badge tone="warn">是</Badge> : <Badge tone="ok">否</Badge>}</td>
                    <td>{a.generalizationShiftM}</td>
                    <td>{a.conservative ? <Badge tone="ok">是</Badge> : <Badge tone="block">否</Badge>}</td>
                    <td>{a.consistent ? <Badge tone="ok">是</Badge> : <Badge tone="block">否</Badge>}</td>
                    <td>{a.leaksExact ? <Badge tone="block">是</Badge> : <Badge tone="ok">否</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small" style={{ marginTop: 4 }}>
              验收口径：公开包络必须覆盖真实点（保守）、内部误差包络进入缓冲时公开侧必须判相交（方向一致）、泛化中心不得与真实坐标重合（不泄露）。
            </p>
          </div>
        );
      })}
    </>
  );
}
