// 地下管网血缘变更工作台 —— 领域类型定义
// 所有坐标为平面投影坐标（虚构地方基准 CGCS2000 / 地方独立坐标），单位由来源包声明。

export type Unit = 'meter' | 'centimeter';
export type CrsKind = 'CGCS2000_3_DEGREE' | 'LOCAL_GRID' | 'BD09'; // 虚构基准集合
export type LineageKind = 'one_to_one' | 'split' | 'merge' | 'unresolved';
export type ValveState = 'open' | 'closed';
export type ChangeType = 'unchanged' | 'geometry' | 'split' | 'merge' | 'unresolved' | 'valve';
export type RecomputeMode = 'slice' | 'full';
export type ReviewStatus = 'draft' | 'approved' | 'rejected' | 'conflict';

/** 二维点 */
export interface Point {
  x: number;
  y: number;
}

/** 管段折线（至少两个点） */
export interface Geometry {
  points: Point[];
}

/** 来源数据包元信息（导入器记录） */
export interface PackageMeta {
  packageId: string;
  fileName: string;
  sha256: string;
  source: string; // 来源单位/系统
  crs: CrsKind;
  epoch: string | null; // 测量历元，如 2026.2；缺失为 null（语义校验项）
  declaredUnit: Unit | null; // 声明单位；误标/缺失为语义校验项
  importedAt: string;
  byteSize: number;
}

/** 语义校验问题：文件哈希正确不能替代语义核验 */
export interface SemanticIssue {
  code: 'EPOCH_MISSING' | 'UNIT_MISLABELED' | 'UNIT_MISSING' | 'UNRESOLVED_LINEAGE' | 'CRS_UNKNOWN';
  severity: 'block' | 'warn';
  entityId?: string;
  message: string;
}

/** 控制点（校正器保存原始/校正坐标与残差） */
export interface ControlPoint {
  id: string;
  zoneId: string; // 分区
  original: Point;
  corrected: Point;
  residual: number; // 残差（米），校正后计算
  note?: string;
}

/** 分区转换误差范围 */
export interface ZoneErrorRange {
  zoneId: string;
  sampleCount: number;
  rms: number; // 中误差（米）
  maxResidual: number;
  band95: number; // 95% 误差带半宽（米），约 1.96 * rms
}

/** 控制点校正集（版本化，规则更新会使旧影响计算失效） */
export interface ControlCorrection {
  correctionId: string;
  basedOnPackage: string;
  controlPoints: ControlPoint[];
  zoneRanges: ZoneErrorRange[];
  transformVersion: string; // 校正规则版本
  ruleFingerprint: string; // 规则指纹，离线更新后比对
  createdAt: string;
}

/** 管段实体 */
export interface PipeSegment {
  id: string;
  tileId: string;
  packageId: string;
  geometry: Geometry;
  material: string;
  diameterMm: number;
  zoneId: string;
}

/** 阀门 */
export interface Valve {
  id: string;
  tileId: string;
  position: Point;
  state: ValveState;
  connectedSegmentIds: string[];
}

/** 实体谱系关系（旧管段 -> 新管段） */
export interface LineageRelation {
  id: string;
  oldSegmentIds: string[];
  newSegmentIds: string[];
  kind: LineageKind;
  evidence: string; // 测量证据描述
  evidenceDistanceM?: number; // 续接端点距离（米）
  confidence: number; // 0~1
}

/** 版本化网络（拓扑重建器输出） */
export interface NetworkVersion {
  networkId: string;
  version: number;
  basedOnPackage: string;
  correctionId: string;
  toleranceM: number; // 端点容差（米）
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  createdAt: string;
}

export interface NetworkNode {
  id: string;
  position: Point;
  kind: 'endpoint' | 'valve' | 'junction';
  valveId?: string;
  tileId: string;
}

export interface NetworkEdge {
  id: string;
  segmentId: string;
  fromNode: string;
  toNode: string;
  tileId: string;
}

/** 施工许可（许可账） */
export interface Permit {
  permitNo: string;
  boundary: Geometry; // 获批空间边界（申请时固化）
  bufferM: number; // 缓冲距离（米），样例为 3 米
  projectPeriod: { start: string; end: string };
  basedOnSegmentVersion: string; // 所依据的管段版本（网络版本号）
  approvedSegmentIds: string[]; // 申请时固化的获批对象，不随现行地图漂移
  lockedAt: string;
}

/** 许可判定结果 */
export interface PermitVerdict {
  permitNo: string;
  stillCovers: boolean; // 是否仍覆盖原获批对象
  minClearanceM: number; // 几何到缓冲边界的最小净距（负=穿越）
  bandTouchesBuffer: boolean; // 95% 误差带是否触及缓冲边界
  status: 'valid' | 'review' | 'blocked';
  reasons: string[];
}

/** 风险模型运行账（固定特征、拓扑、阈值、输入水位） */
export interface ModelRunRecord {
  runId: string;
  modelCode: string;
  featureFingerprint: string; // 输入特征指纹（管网连通特征）
  topologyVersion: number;
  threshold: number; // 风险阈值
  inputWaterLevelM: number; // 输入水位
  segmentScores: Record<string, number>;
  ranAt: string;
}

/** 影响求值单项结果 */
export interface ImpactItem {
  dimension: 'geometry_buffer' | 'entity_lineage' | 'permit_coverage' | 'layer_rebuild';
  targetId: string;
  changed: boolean;
  detail: string;
  blocking: boolean;
}

/** 影响评估报告 */
export interface ImpactReport {
  reportId: string;
  basedOnPackage: string;
  networkVersion: number;
  correctionId: string;
  items: ImpactItem[];
  permitVerdicts: PermitVerdict[];
  changedSegmentIds: string[];
  closureSegmentIds: string[]; // 完整下游闭包（含跨瓦片依赖）
  crossTileDependencies: CrossTileDependency[];
  blockingReasons: string[];
  computedAt: string;
  stale: boolean; // 控制点/拓扑规则更新后置为失效
  staleReason?: string;
}

export interface CrossTileDependency {
  fromTile: string;
  toTile: string;
  viaSegmentId: string;
  viaValveId?: string;
}

/** 重算作业（切片 / 全链） */
export interface RecomputeJob {
  jobId: string;
  mode: RecomputeMode;
  scopeSegmentIds: string[];
  scopeTiles: string[];
  boundaryProof: string; // 切片方案的边界无影响证明；无法证明则扩大整包
  escalatedToFull: boolean;
  preservedReferences: string[]; // 未变区域保留的原发布引用
  resultingNetworkVersion: number;
  reportSnapshot: ImpactReport;
  durationMs: number;
  ranAt: string;
}

/** 发布快照（可回放：输入包、转换、实体关系、许可与模型版本） */
export interface ReleaseSnapshot {
  releaseId: string;
  packageMeta: PackageMeta;
  correction: ControlCorrection;
  lineage: LineageRelation[];
  network: NetworkVersion;
  permits: Permit[];
  modelRun: ModelRunRecord;
  impact: ImpactReport;
  recompute: RecomputeJob;
  status: ReviewStatus;
  blockers: string[];
  publishedAt: string;
  replayHash: string; // 全链路回放指纹
}

/** 离线审阅草案（同步时只合并非冲突草案） */
export interface ReviewDraft {
  draftId: string;
  releaseId: string;
  reviewer: string;
  comment: string;
  status: ReviewStatus;
  updatedAt: string;
  baseReleaseVersion: number; // 草案所基于的发布版本
}

/** 同步状态（模拟服务器） */
export interface SyncState {
  lastSyncAt: string | null;
  serverReleaseVersion: number;
  mergedDrafts: string[];
  conflicts: string[];
}

// ---------------------------------------------------------------------------
// 公开几何发布：设施探测点、误差包络、禁挖缓冲与字段遮蔽
// 内部真值（精确坐标、精度、责任人、待核状态）只留在内部账，公开账只登记派生结果。
// ---------------------------------------------------------------------------

/** 待复核状态：定位误差包络是否覆盖点位，是否需要现场复核 */
export type VerifyState = 'pending' | 'verified';

/** 内部设施探测点真值（严禁直接出现在公开账中） */
export interface DetectionPointTruth {
  id: string;
  facility: string; // 设施类别（公开描述可用，责任人与精度不可）
  /** 内部控制坐标（米），`revealAtM` 之外不得公开 */
  coord: Point;
  /** 定位误差（米，半宽），探测精度 */
  errorM: number;
  verifyState: VerifyState;
  /** 内部责任人 / 台账持有人 */
  owner: string;
  internalNote: string;
}

/** 内部沟槽（施工开挖）真值：折线边线 + 沟槽宽度 */
export interface TrenchTruth {
  id: string;
  /** 沟槽中心线（内部坐标） */
  centerline: Geometry;
  widthM: number;
  bufferM: number; // 禁挖缓冲距离，样例 3 米
  zone: string;
}

/** 公开网格泛化方案 */
export type GeneralizeMode = 'fixed_grid' | 'risk_adaptive';

/** 公开发布策略：固定比例尺网格泛化 或 按施工风险自适应模糊 */
export interface PublicZonePolicy {
  mode: GeneralizeMode;
  /** 固定网格边长（米），仅 fixed_grid 使用 */
  cellM: number;
  /** 自适应：高风险带（包络与缓冲相交风险）保留的细网格边长（米） */
  fineCellM: number;
  /** 自适应：远离缓冲处的粗网格边长（米） */
  coarseCellM: number;
  /** 自适应：判定为高风险的净距阈值（米），= bufferM + 最大误差包络 */
  riskMarginM: number;
  /** 统一的最小公开精度（米），避免不同设施精度不同导致可比对反推 */
  uniformPrecisionM: number;
}

/** 公开误差包络：以泛化后中心与放大后的半宽给出，保守且不含原始坐标 */
export interface PublicEnvelope {
  /** 泛化单元中心（已量化到公开网格） */
  center: Point;
  /** 泛化单元边长（米） */
  cellM: number;
  /** 对外公布的半宽 = 单元半对角线 + 统一包络冗余（不随单点精度变化） */
  halfWidthM: number;
  /** 该包络来源：网格泛化 / 风险自适应 */
  basis: GeneralizeMode;
  /** 风险档位（粗粒度，避免由包络反推出内部净距） */
  riskClass: 'high' | 'low';
}

/** 风险档位判定依据（内部审计，不进入公开视图） */
export interface PublicRiskAudit {
  pointId: string;
  riskClass: 'high' | 'low';
  criterion: string;
  /** 内部净距（米），仅审计用 */
  internalClearanceM: number;
}

/** 隐藏字段记录：哪个字段、为何被遮蔽、遮蔽后可见形式 */
export interface MaskingRecord {
  subjectId: string; // DP-xx
  field: string; // 'coord' | 'errorM' | 'owner' | 'verifyState' | 'internalNote'
  reason: string;
  visibleForm: string; // 公开账中实际可见的形式
  blocked: boolean; // 是否必须阻断（原始坐标/精度/责任人一律 block）
}

/** 单个设施探测点的公开判定 */
export interface PublicPointVerdict {
  pointId: string;
  facility: string;
  envelope: PublicEnvelope;
  /** 包络到 3 米禁挖缓冲外沿的最近距离（米）；负值表示包络进入缓冲带 */
  envelopeToBufferM: number;
  /** 包络是否与缓冲带相交（相交=施工方只能得到“可能相交”） */
  intersectsBuffer: boolean;
  /** 公开侧能得到的结论（仅由包络相交判定，不依赖内部待核状态） */
  publicConclusion: 'safe_zone' | 'possibly_intersects';
  /** 是否阻断精确位置发布 */
  exactBlocked: boolean;
  notes: string[];
}

/** 内部与公开的差异验收（逐点比较） */
export interface AcceptanceRow {
  pointId: string;
  /** 内部真值：估计点到沟槽边线的距离（米） */
  internalEdgeDistanceM: number;
  /** 内部真值：点到缓冲外沿的距离（米），负=已在缓冲内 */
  internalClearanceM: number;
  /** 内部误差包络到缓冲外沿的余量（米），验证样例 2.6–4.2 米跨缓冲 */
  internalEnvelopeMarginM: number;
  /** 公开包络到缓冲外沿的最近距离（米） */
  envelopeClearanceM: number;
  /** 内部点是否在缓冲内 */
  internalInside: boolean;
  /** 公开包络是否与缓冲相交 */
  publicIntersects: boolean;
  /** 泛化位移（米）：公开中心与内部坐标距离，验证不泄露精确坐标 */
  generalizationShiftM: number;
  /** 公开包络半宽是否不小于误差 + 精度（保守性） */
  conservative: boolean;
  /** 结论方向是否一致（包络相交应覆盖内部穿越/待核） */
  consistent: boolean;
  /** 是否存在精确坐标泄露 */
  leaksExact: boolean;
  note: string;
}

/** 公开版本相对前一版本的差异（回退时用于生成公开差异版本） */
export interface PublicVersionDiff {
  comparedTo: string | null;
  added: string[];
  removed: string[];
  changed: {
    pointId: string;
    fromConclusion: PublicPointVerdict['publicConclusion'];
    toConclusion: PublicPointVerdict['publicConclusion'];
    fromHalfWidthM: number;
    toHalfWidthM: number;
  }[];
}

/** 一条公开几何版本的完整登记 */
export interface PublicGeometryVersion {
  publicVersionId: string; // PG-... 不含“最新”标记，回退会生成新号
  basedOnInternalVersion: string; // 所依据的内部版本号
  derivedFromPublicId: string | null; // 回退时指向前一个公开版本
  mode: GeneralizeMode;
  policy: PublicZonePolicy;
  bufferM: number;
  envelopeVersion: string; // 误差包络规则版本
  verdicts: PublicPointVerdict[];
  maskingRecords: MaskingRecord[];
  acceptance: AcceptanceRow[];
  /** 风险自适应依据（内部审计，公开视图会剥离） */
  riskBasis: PublicRiskAudit[];
  /** 相对前一公开版本的差异（回退时体现“新的公开差异版本”） */
  diff: PublicVersionDiff;
  /** 是否因回退生成（回退必须生成新的公开差异版本） */
  regeneratedFromRollback: boolean;
  /** 公开账保留的内部关联仅做审计哈希，不含原始坐标 */
  truthRefHash: string;
  createdAt: string;
  summary: {
    safeCount: number;
    pendingCount: number;
    blockedExactCount: number;
    acceptanceFailures: number;
  };
  notes: string[];
}

/** 内部几何版本（供回退演示；不直接公开） */
export interface InternalGeometryVersion {
  internalVersionId: string; // IG-v1 / IG-v2
  label: string;
  trench: TrenchTruth;
  points: DetectionPointTruth[];
  createdAt: string;
}
