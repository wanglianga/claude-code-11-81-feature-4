// 主线程 <-> WebWorker 通信协议
import type { PipelineResult } from '../domain/pipeline';
import type { RawSourcePackage } from '../domain/sampleData';
import type { RecomputeMode, ReviewStatus, ReleaseSnapshot } from '../domain/types';

export interface WorkerRunRequest {
  type: 'runPipeline';
  payload: {
    raw: RawSourcePackage;
    rawText: string;
    networkVersion: number;
    prevResult: PipelineResult | null;
    prevReleaseRefs: [string, string][];
    recomputeMode: RecomputeMode;
    activeTopologyRule: string;
    storedRuleFingerprints: { correction: string; topology: string } | null;
    reviewStatus: ReviewStatus;
  };
}

export interface WorkerReplayRequest {
  type: 'replay';
  payload: { snapshot: ReleaseSnapshot };
}

export interface WorkerCompareRequest {
  type: 'compareModes';
  payload: Omit<WorkerRunRequest['payload'], 'recomputeMode'>;
}

export type WorkerRequest = WorkerRunRequest | WorkerReplayRequest | WorkerCompareRequest;

export interface WorkerProgress {
  phase: string;
  at: number;
}

export type WorkerResponse =
  | { type: 'progress'; payload: WorkerProgress }
  | { type: 'pipelineDone'; payload: PipelineResult }
  | { type: 'compareDone'; payload: { slice: PipelineResult; full: PipelineResult } }
  | { type: 'replayDone'; payload: { ok: boolean; replayHash: string; mismatch: string[] } }
  | { type: 'error'; payload: string };
