export interface AdoProject {
  id: string;
  name: string;
  url: string;
}

export interface AdoBuild {
  id: number;
  buildNumber: string;
  status: string;       // "completed" | "inProgress" | "notStarted" | "cancelling"
  result?: string;      // "succeeded" | "failed" | "canceled" | "partiallySucceeded" — only set when completed
  sourceBranch: string;
  startTime?: string;
  finishTime?: string;
  definition: { id: number; name: string };
}

export interface AdoTimelineRecord {
  id: string;
  name: string;
  type: string;         // "Stage" | "Phase" | "Job" | "Task"
  state: string;        // "pending" | "inProgress" | "completed"
  result?: string;      // "succeeded" | "failed" | "canceled" | "skipped"
  order: number;
}

export interface AdoApproval {
  id: string;
  status: string;       // "pending" | "approved" | "rejected"
  pipeline: {
    id: string;         // pipeline DEFINITION id (string) — NOT the build/run id
    name: string;
    owner: {            // the specific build run this approval gates
      id: number;       // build run id (e.g. 450785)
      name: string;
    };
  };
  stage?: { name: string };
  steps?: Array<{ assignedApprover?: { id: string; displayName: string }; status: string }>;
  blockedApprovers?: Array<{ id: string; displayName: string }>;
  createdOn: string;
}

export interface AdoListResponse<T> {
  count: number;
  value: T[];
}

export interface StageConfig {
  stageName: string;
  notifyOnComplete: boolean;
  notifyOnApprovalNeeded: boolean;
}

export interface PipelineConfig {
  org: string;
  project: string;
  pipelineId: number;
  pipelineName: string;
  stages: StageConfig[];
  lastBuildId?: number;
}

export interface StageSnapshot {
  state: string;
  result?: string;
  approvalPending: boolean;
}

export interface BuildSnapshot {
  pipelineId: number;
  buildId: number;
  stages: Record<string, StageSnapshot>;
}
