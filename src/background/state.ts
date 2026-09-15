import type { BuildSnapshot, DismissedBuild, MonitoringKey, PipelineConfig, StageSnapshot, StoredDismissedBuild } from "../types/ado";
import { monitoringKeyEquals, monitoringKeyToString } from "../types/ado";
import {
	getBuildSnapshots,
	getDismissedBuilds,
	getLastPolledAt,
	getPipelineConfigs,
} from "../utils/storage";

export type { BuildSnapshot, DismissedBuild, StageSnapshot };

export interface MonitoringStateData {
	pipelineConfigs: PipelineConfig[];
	buildSnapshots: BuildSnapshot[];
	dismissedBuilds: StoredDismissedBuild[];
	lastPolledAt: number | null;
}

export interface PruneResult {
	nextState: MonitoringStateData;
	changed: boolean;
}

const PIPELINE_CONFIGS_KEY = "pipeline_configs";
const BUILD_SNAPSHOTS_KEY = "build_snapshots";
const DISMISSED_BUILDS_KEY = "dismissed_builds";
const LAST_POLLED_KEY = "last_polled_at";
const STALE_RETENTION_MS = 12 * 60 * 60 * 1000;

function isFiniteTimestamp(value: number | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function hasLifecycleMetadata(snapshot: BuildSnapshot): boolean {
	return Boolean(snapshot.buildStatus) && isFiniteTimestamp(snapshot.lastSuccessfulPollAt);
}

function getWatchedStageNames(config: PipelineConfig): Set<string> {
	return new Set(config.stages.map((stage) => stage.stageName.toLowerCase()));
}

export function upsertSnapshotInCollection(snapshots: BuildSnapshot[], snapshot: BuildSnapshot): BuildSnapshot[] {
	const next = [...snapshots];
	const idx = next.findIndex((existing) => monitoringKeyEquals(existing, snapshot));
	if (idx >= 0) {
		next[idx] = snapshot;
	} else {
		next.push(snapshot);
	}
	return next;
}

export function removeSnapshotFromCollection(snapshots: BuildSnapshot[], key: MonitoringKey): BuildSnapshot[] {
	return snapshots.filter((snapshot) => !monitoringKeyEquals(snapshot, key));
}

export function pruneMonitoringState(now: number, state: MonitoringStateData): PruneResult {
	const cutoff = now - STALE_RETENTION_MS;
	const snapshotsByKey = new Map(state.buildSnapshots.map((snapshot) => [monitoringKeyToString(snapshot), snapshot]));
	const retainedConfigKeys = new Set<string>();

	const dismissedBuilds = state.dismissedBuilds.filter(
		(record) => isFiniteTimestamp(record.dismissedAt) && record.dismissedAt > cutoff
	);

	const pipelineConfigs = state.pipelineConfigs.filter((config) => {
		const serializedKey = monitoringKeyToString(config);
		const snapshot = snapshotsByKey.get(serializedKey);
		if (!snapshot) {
			retainedConfigKeys.add(serializedKey);
			return true;
		}

		if (!hasLifecycleMetadata(snapshot)) {
			retainedConfigKeys.add(serializedKey);
			return true;
		}

		const watchedStages = getWatchedStageNames(config);
		const approvalPending = Object.entries(snapshot.stages).some(
			([stageName, stageSnapshot]) =>
				watchedStages.has(stageName.toLowerCase()) && stageSnapshot.approvalPending
		);

		if (approvalPending || snapshot.buildStatus !== "completed") {
			retainedConfigKeys.add(serializedKey);
			return true;
		}

		const terminalAnchor = isFiniteTimestamp(snapshot.buildFinishedAt)
			? snapshot.buildFinishedAt
			: snapshot.lastSuccessfulPollAt;
		if (!isFiniteTimestamp(terminalAnchor) || terminalAnchor > cutoff) {
			retainedConfigKeys.add(serializedKey);
			return true;
		}

		return false;
	});

	const buildSnapshots = state.buildSnapshots.filter((snapshot) => retainedConfigKeys.has(monitoringKeyToString(snapshot)));

	const nextState: MonitoringStateData = {
		pipelineConfigs,
		buildSnapshots,
		dismissedBuilds,
		lastPolledAt: state.lastPolledAt,
	};

	return {
		nextState,
		changed:
			pipelineConfigs.length !== state.pipelineConfigs.length ||
			buildSnapshots.length !== state.buildSnapshots.length ||
			dismissedBuilds.length !== state.dismissedBuilds.length,
	};
}

export async function readMonitoringState(): Promise<MonitoringStateData> {
	const [pipelineConfigs, buildSnapshots, dismissedBuilds, lastPolledAt] = await Promise.all([
		getPipelineConfigs(),
		getBuildSnapshots(),
		getDismissedBuilds(),
		getLastPolledAt(),
	]);

	return {
		pipelineConfigs,
		buildSnapshots,
		dismissedBuilds,
		lastPolledAt,
	};
}

async function writeMonitoringState(next: MonitoringStateData): Promise<void> {
	await chrome.storage.local.set({
		[PIPELINE_CONFIGS_KEY]: next.pipelineConfigs,
		[BUILD_SNAPSHOTS_KEY]: next.buildSnapshots,
		[DISMISSED_BUILDS_KEY]: next.dismissedBuilds,
		[LAST_POLLED_KEY]: next.lastPolledAt,
	});
}

export async function runStaleDataPrune(now = Date.now()): Promise<MonitoringStateData> {
	const currentState = await readMonitoringState();
	const pruned = pruneMonitoringState(now, currentState);
	if (pruned.changed) {
		await writeMonitoringState(pruned.nextState);
	}
	return pruned.nextState;
}

export async function getSnapshot(key: MonitoringKey): Promise<BuildSnapshot | null> {
	const snapshots = await getBuildSnapshots();
	return snapshots.find((snapshot) => monitoringKeyEquals(snapshot, key)) ?? null;
}

export async function saveSnapshot(snapshot: BuildSnapshot): Promise<void> {
	const snapshots = await getBuildSnapshots();
	await chrome.storage.local.set({
		[BUILD_SNAPSHOTS_KEY]: upsertSnapshotInCollection(snapshots, snapshot),
	});
}

export async function clearSnapshot(key: MonitoringKey): Promise<void> {
	const snapshots = await getBuildSnapshots();
	await chrome.storage.local.set({
		[BUILD_SNAPSHOTS_KEY]: removeSnapshotFromCollection(snapshots, key),
	});
}
