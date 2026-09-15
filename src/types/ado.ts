export interface AdoProject {
	id: string;
	name: string;
	url: string;
}

export interface AdoBuild {
	id: number;
	buildNumber: string;
	status: string; // "completed" | "inProgress" | "notStarted" | "cancelling"
	result?: string; // "succeeded" | "failed" | "canceled" | "partiallySucceeded" — only set when completed
	sourceBranch: string;
	startTime?: string;
	finishTime?: string;
	definition: { id: number; name: string };
}

export interface AdoTimelineRecord {
	id: string;
	name: string;
	type: string; // "Stage" | "Phase" | "Job" | "Task"
	state: string; // "pending" | "inProgress" | "completed"
	result?: string; // "succeeded" | "failed" | "canceled" | "skipped"
	order: number;
}

export interface AdoApproval {
	id: string;
	status: string; // "pending" | "approved" | "rejected"
	pipeline: {
		id: string; // pipeline DEFINITION id (string) — NOT the build/run id
		name: string;
		owner: {
			// the specific build run this approval gates
			id: number | string; // build run id (e.g. 450785); ADO may serialize it as a string
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

export type NormalizedOrg = string;

export interface MonitoringKey {
	org: NormalizedOrg;
	project: string;
	pipelineId: number;
	buildId: number;
}

export type MonitoringKeyLike = Pick<MonitoringKey, "org" | "project" | "pipelineId" | "buildId">;

export interface PipelineConfig extends MonitoringKey {
	pipelineName: string;
	stages: StageConfig[];
}

export interface StageSnapshot {
	state: string;
	result?: string;
	approvalPending: boolean;
}

export interface BuildSnapshot extends MonitoringKey {
	stages: Record<string, StageSnapshot>;
	buildStatus?: string;
	buildFinishedAt?: number;
	lastSuccessfulPollAt?: number;
}

export interface DismissedBuild extends MonitoringKey {
	dismissedAt: number;
}

export interface StoredDismissedBuild extends MonitoringKey {
	dismissedAt?: number;
}

export function toMonitoringKey(value: MonitoringKeyLike): MonitoringKey {
	return {
		org: value.org,
		project: value.project,
		pipelineId: value.pipelineId,
		buildId: value.buildId,
	};
}

export function monitoringKeyEquals(a: MonitoringKey, b: MonitoringKey): boolean {
	return a.org === b.org && a.project === b.project && a.pipelineId === b.pipelineId && a.buildId === b.buildId;
}

export function monitoringKeyToString(value: MonitoringKeyLike): string {
	const key = toMonitoringKey(value);
	return JSON.stringify({
		org: key.org,
		project: key.project,
		pipelineId: key.pipelineId,
		buildId: key.buildId,
	});
}

export function parseMonitoringKeyString(serialized: string): MonitoringKey | null {
	try {
		const parsed = JSON.parse(serialized) as Partial<MonitoringKeyLike> | null;
		if (
			!parsed ||
			typeof parsed.org !== "string" ||
			typeof parsed.project !== "string" ||
			typeof parsed.pipelineId !== "number" ||
			typeof parsed.buildId !== "number"
		) {
			return null;
		}

		return toMonitoringKey(parsed as MonitoringKeyLike);
	} catch {
		return null;
	}
}
