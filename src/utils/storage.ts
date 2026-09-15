import type {
	BuildSnapshot,
	DismissedBuild,
	MonitoringKey,
	NormalizedOrg,
	PipelineConfig,
	StageConfig,
	StageSnapshot,
	StoredDismissedBuild,
} from "../types/ado";
import { monitoringKeyEquals, monitoringKeyToString } from "../types/ado";

const CREDENTIAL_KEYS = ["ado_org_url", "ado_pat"] as const;
const PIPELINE_CONFIGS_KEY = "pipeline_configs";
const BUILD_SNAPSHOTS_KEY = "build_snapshots";
const DISMISSED_BUILDS_KEY = "dismissed_builds";
const LAST_POLLED_KEY = "last_polled_at";

type StorageMap = Record<string, unknown>;

export function normalizeOrgSlug(org: string): NormalizedOrg {
	return org
		.trim()
		.replace(/^\/+|\/+$/g, "")
		.toLowerCase();
}

export function normalizeAdoOrgUrl(orgUrl: string): string | null {
	try {
		const url = new URL(orgUrl);
		if (url.hostname.toLowerCase() !== "dev.azure.com") return null;

		const parts = url.pathname.split("/").filter(Boolean);
		if (parts.length !== 1) return null;

		const org = normalizeOrgSlug(decodeURIComponent(parts[0]));
		if (!org) return null;

		return `https://dev.azure.com/${encodeURIComponent(org)}`;
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is StorageMap {
	return typeof value === "object" && value !== null;
}

function asPositiveInt(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function normalizeStageConfig(value: unknown): StageConfig | null {
	if (!isRecord(value) || typeof value.stageName !== "string" || !value.stageName.trim()) {
		return null;
	}

	return {
		stageName: value.stageName,
		notifyOnComplete: Boolean(value.notifyOnComplete),
		notifyOnApprovalNeeded: Boolean(value.notifyOnApprovalNeeded),
	};
}

function normalizeStageConfigs(value: unknown): StageConfig[] {
	if (!Array.isArray(value)) return [];
	return value.map(normalizeStageConfig).filter((stage): stage is StageConfig => stage !== null);
}

function normalizeStageSnapshot(value: unknown): StageSnapshot | null {
	if (!isRecord(value) || typeof value.state !== "string" || !value.state.trim()) {
		return null;
	}

	return {
		state: value.state,
		result: typeof value.result === "string" ? value.result : undefined,
		approvalPending: Boolean(value.approvalPending),
	};
}

function normalizeStageSnapshots(value: unknown): Record<string, StageSnapshot> {
	if (!isRecord(value)) return {};

	const normalized: Record<string, StageSnapshot> = {};
	for (const [stageName, snapshot] of Object.entries(value)) {
		const next = normalizeStageSnapshot(snapshot);
		if (next) {
			normalized[stageName] = next;
		}
	}
	return normalized;
}

function normalizeMonitoringKey(value: unknown): MonitoringKey | null {
	if (!isRecord(value)) return null;

	const org = typeof value.org === "string" ? normalizeOrgSlug(value.org) : "";
	const project = typeof value.project === "string" ? value.project.trim() : "";
	const pipelineId = asPositiveInt(value.pipelineId);
	const buildId = asPositiveInt(value.buildId);

	if (!org || !project || !pipelineId || !buildId) {
		return null;
	}

	return {
		org,
		project,
		pipelineId,
		buildId,
	};
}

function normalizePipelineConfig(value: unknown): PipelineConfig | null {
	if (!isRecord(value)) return null;

	const key = normalizeMonitoringKey({
		org: value.org,
		project: value.project,
		pipelineId: value.pipelineId,
		buildId: value.buildId,
	});
	const pipelineName = typeof value.pipelineName === "string" ? value.pipelineName.trim() : "";

	if (!key || !pipelineName) {
		return null;
	}

	return {
		...key,
		pipelineName,
		stages: normalizeStageConfigs(value.stages),
	};
}

function normalizeBuildSnapshot(value: unknown): BuildSnapshot | null {
	if (!isRecord(value)) return null;

	const key = normalizeMonitoringKey(value);
	if (!key) return null;

	const buildStatus = typeof value.buildStatus === "string" && value.buildStatus.trim() ? value.buildStatus : undefined;
	const buildFinishedAt = typeof value.buildFinishedAt === "number" && Number.isFinite(value.buildFinishedAt)
		? value.buildFinishedAt
		: undefined;
	const lastSuccessfulPollAt = typeof value.lastSuccessfulPollAt === "number" && Number.isFinite(value.lastSuccessfulPollAt)
		? value.lastSuccessfulPollAt
		: undefined;

	return {
		...key,
		stages: normalizeStageSnapshots(value.stages),
		buildStatus,
		buildFinishedAt,
		lastSuccessfulPollAt,
	};
}

function normalizeDismissedBuild(value: unknown): StoredDismissedBuild | null {
	const key = normalizeMonitoringKey(value);
	if (!key) return null;

	if (!isRecord(value)) {
		return key;
	}

	const dismissedAt = typeof value.dismissedAt === "number" && Number.isFinite(value.dismissedAt)
		? value.dismissedAt
		: undefined;

	return dismissedAt === undefined ? key : { ...key, dismissedAt };
}

function dedupeByKey<T extends MonitoringKey>(items: T[]): T[] {
	const deduped = new Map<string, T>();
	for (const item of items) {
		deduped.set(monitoringKeyToString(item), item);
	}
	return [...deduped.values()];
}

export async function getCredentials(): Promise<{ orgUrl: string; pat: string } | null> {
	const result = await chrome.storage.local.get([...CREDENTIAL_KEYS]);
	if (!result.ado_org_url || !result.ado_pat) return null;

	const orgUrlRaw = typeof result.ado_org_url === "string" ? result.ado_org_url : "";
	const orgUrl = normalizeAdoOrgUrl(orgUrlRaw) ?? orgUrlRaw.trim();
	const pat = typeof result.ado_pat === "string" ? result.ado_pat : "";
	if (!orgUrl || !pat) return null;

	return { orgUrl, pat };
}

export async function saveCredentials(orgUrl: string, pat: string): Promise<void> {
	const normalizedOrgUrl = normalizeAdoOrgUrl(orgUrl) ?? orgUrl.trim();
	await chrome.storage.local.set({ ado_org_url: normalizedOrgUrl, ado_pat: pat });
}

export async function getPipelineConfigs(): Promise<PipelineConfig[]> {
	const result = await chrome.storage.local.get(PIPELINE_CONFIGS_KEY);
	if (!Array.isArray(result[PIPELINE_CONFIGS_KEY])) {
		return [];
	}

	return dedupeByKey(result[PIPELINE_CONFIGS_KEY].map(normalizePipelineConfig).filter((config): config is PipelineConfig => config !== null));
}

export async function setPipelineConfigs(configs: PipelineConfig[]): Promise<void> {
	await chrome.storage.local.set({
		[PIPELINE_CONFIGS_KEY]: dedupeByKey(configs.map(normalizePipelineConfig).filter((config): config is PipelineConfig => config !== null)),
	});
}

export async function getBuildSnapshots(): Promise<BuildSnapshot[]> {
	const result = await chrome.storage.local.get(BUILD_SNAPSHOTS_KEY);
	if (!Array.isArray(result[BUILD_SNAPSHOTS_KEY])) {
		return [];
	}

	return dedupeByKey(result[BUILD_SNAPSHOTS_KEY].map(normalizeBuildSnapshot).filter((snapshot): snapshot is BuildSnapshot => snapshot !== null));
}

export async function setBuildSnapshots(snapshots: BuildSnapshot[]): Promise<void> {
	await chrome.storage.local.set({
		[BUILD_SNAPSHOTS_KEY]: dedupeByKey(snapshots.map(normalizeBuildSnapshot).filter((snapshot): snapshot is BuildSnapshot => snapshot !== null)),
	});
}

export async function getDismissedBuilds(): Promise<StoredDismissedBuild[]> {
	const result = await chrome.storage.local.get(DISMISSED_BUILDS_KEY);
	if (!Array.isArray(result[DISMISSED_BUILDS_KEY])) {
		return [];
	}

	const deduped = new Map<string, StoredDismissedBuild>();
	for (const record of result[DISMISSED_BUILDS_KEY].map(normalizeDismissedBuild).filter((key): key is StoredDismissedBuild => key !== null)) {
		const serializedKey = monitoringKeyToString(record);
		const existing = deduped.get(serializedKey);
		if (!existing) {
			deduped.set(serializedKey, record);
			continue;
		}

		const existingDismissedAt = typeof existing.dismissedAt === "number" ? existing.dismissedAt : Number.NEGATIVE_INFINITY;
		const recordDismissedAt = typeof record.dismissedAt === "number" ? record.dismissedAt : Number.NEGATIVE_INFINITY;
		deduped.set(serializedKey, recordDismissedAt >= existingDismissedAt ? record : existing);
	}

	return [...deduped.values()];
}

export async function setDismissedBuilds(builds: StoredDismissedBuild[]): Promise<void> {
	await chrome.storage.local.set({
		[DISMISSED_BUILDS_KEY]: builds
			.map(normalizeDismissedBuild)
			.filter((build): build is StoredDismissedBuild => build !== null),
	});
}

export async function dismissBuild(key: MonitoringKey, dismissedAt = Date.now()): Promise<void> {
	const current = await getDismissedBuilds();
	if (!current.some((item) => monitoringKeyEquals(item, key))) {
		await setDismissedBuilds([...current, { ...key, dismissedAt } satisfies DismissedBuild]);
	}
}

export async function undismissBuild(key: MonitoringKey): Promise<void> {
	const current = await getDismissedBuilds();
	await setDismissedBuilds(current.filter((item) => !monitoringKeyEquals(item, key)));
}

export async function getLastPolledAt(): Promise<number | null> {
	const result = await chrome.storage.local.get(LAST_POLLED_KEY);
	return (result[LAST_POLLED_KEY] as number) ?? null;
}

export async function setLastPolledAt(ts: number): Promise<void> {
	await chrome.storage.local.set({ [LAST_POLLED_KEY]: ts });
}
