import type { BuildSnapshot, MonitoringKey, NormalizedOrg, PipelineConfig, StageConfig, StageSnapshot } from "../types/ado";
import { monitoringKeyEquals, monitoringKeyToString } from "../types/ado";

const CREDENTIAL_KEYS = ["ado_org_url", "ado_pat"] as const;
const PIPELINE_CONFIGS_KEY = "pipeline_configs";
const BUILD_SNAPSHOTS_KEY = "build_snapshots";
const DISMISSED_BUILDS_KEY = "dismissed_builds";
const LAST_POLLED_KEY = "last_polled_at";
const STORAGE_SCHEMA_VERSION_KEY = "storage_schema_version";
const CURRENT_STORAGE_SCHEMA_VERSION = 2;

let schemaReadyPromise: Promise<void> | null = null;

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
		buildId: value.buildId ?? value.lastBuildId,
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

interface ConfigLookups {
	byKey: Map<string, PipelineConfig>;
	byPipelineId: Map<number, PipelineConfig[]>;
}

function buildConfigLookups(configs: PipelineConfig[]): ConfigLookups {
	const byKey = new Map<string, PipelineConfig>();
	const byPipelineId = new Map<number, PipelineConfig[]>();

	for (const config of configs) {
		const key = `${config.pipelineId}::${config.buildId}`;
		byKey.set(key, config);

		if (!byPipelineId.has(config.pipelineId)) {
			byPipelineId.set(config.pipelineId, []);
		}
		byPipelineId.get(config.pipelineId)!.push(config);
	}

	return { byKey, byPipelineId };
}

function normalizeBuildSnapshot(value: unknown, lookups: ConfigLookups): BuildSnapshot | null {
	if (!isRecord(value)) return null;

	const directKey = normalizeMonitoringKey(value);
	const pipelineId = asPositiveInt(value.pipelineId);
	const buildId = asPositiveInt(value.buildId);

	let key = directKey;
	if (!key && pipelineId && buildId) {
		const compositeKey = `${pipelineId}::${buildId}`;
		const exactMatch = lookups.byKey.get(compositeKey);
		if (exactMatch) {
			key = {
				org: exactMatch.org,
				project: exactMatch.project,
				pipelineId,
				buildId,
			};
		} else {
			const pipelineMatches = lookups.byPipelineId.get(pipelineId);
			if (pipelineMatches && pipelineMatches.length === 1) {
				key = {
					org: pipelineMatches[0].org,
					project: pipelineMatches[0].project,
					pipelineId,
					buildId,
				};
			}
		}
	}

	if (!key) {
		return null;
	}

	return {
		...key,
		stages: normalizeStageSnapshots(value.stages),
	};
}

function dedupeByKey<T extends MonitoringKey>(items: T[]): T[] {
	const deduped = new Map<string, T>();
	for (const item of items) {
		deduped.set(monitoringKeyToString(item), item);
	}
	return [...deduped.values()];
}

async function ensureStorageSchema(): Promise<void> {
	if (!schemaReadyPromise) {
		schemaReadyPromise = migrateStorageSchema();
	}
	await schemaReadyPromise;
}

async function migrateStorageSchema(): Promise<void> {
	const stored = await chrome.storage.local.get([STORAGE_SCHEMA_VERSION_KEY, ...CREDENTIAL_KEYS, PIPELINE_CONFIGS_KEY, BUILD_SNAPSHOTS_KEY, DISMISSED_BUILDS_KEY]);

	if (stored[STORAGE_SCHEMA_VERSION_KEY] === CURRENT_STORAGE_SCHEMA_VERSION) {
		return;
	}

	const updates: StorageMap = {
		[STORAGE_SCHEMA_VERSION_KEY]: CURRENT_STORAGE_SCHEMA_VERSION,
	};

	if (typeof stored.ado_org_url === "string") {
		const normalizedOrgUrl = normalizeAdoOrgUrl(stored.ado_org_url);
		if (normalizedOrgUrl) {
			updates.ado_org_url = normalizedOrgUrl;
		}
	}

	const pipelineConfigs = Array.isArray(stored[PIPELINE_CONFIGS_KEY]) ? dedupeByKey(stored[PIPELINE_CONFIGS_KEY].map(normalizePipelineConfig).filter((config): config is PipelineConfig => config !== null)) : [];
	updates[PIPELINE_CONFIGS_KEY] = pipelineConfigs;

	const configLookups = buildConfigLookups(pipelineConfigs);
	const buildSnapshots = Array.isArray(stored[BUILD_SNAPSHOTS_KEY]) ? dedupeByKey(stored[BUILD_SNAPSHOTS_KEY].map((snapshot) => normalizeBuildSnapshot(snapshot, configLookups)).filter((snapshot): snapshot is BuildSnapshot => snapshot !== null)) : [];
	updates[BUILD_SNAPSHOTS_KEY] = buildSnapshots;

	const dismissedRaw = stored[DISMISSED_BUILDS_KEY];
	if (Array.isArray(dismissedRaw)) {
		const hasLegacyNumbers = dismissedRaw.some((item) => typeof item === "number");
		updates[DISMISSED_BUILDS_KEY] = hasLegacyNumbers ? [] : dedupeByKey(dismissedRaw.map(normalizeMonitoringKey).filter((item): item is MonitoringKey => item !== null));
	} else {
		updates[DISMISSED_BUILDS_KEY] = [];
	}

	await chrome.storage.local.set(updates);
}

export async function getCredentials(): Promise<{ orgUrl: string; pat: string } | null> {
	await ensureStorageSchema();

	const result = await chrome.storage.local.get([...CREDENTIAL_KEYS]);
	if (!result.ado_org_url || !result.ado_pat) return null;

	const orgUrl = typeof result.ado_org_url === "string" ? result.ado_org_url : "";
	const pat = typeof result.ado_pat === "string" ? result.ado_pat : "";
	if (!orgUrl || !pat) return null;

	return { orgUrl, pat };
}

export async function saveCredentials(orgUrl: string, pat: string): Promise<void> {
	const normalizedOrgUrl = normalizeAdoOrgUrl(orgUrl) ?? orgUrl.trim();
	await chrome.storage.local.set({ ado_org_url: normalizedOrgUrl, ado_pat: pat });
}

export async function getPipelineConfigs(): Promise<PipelineConfig[]> {
	await ensureStorageSchema();

	const result = await chrome.storage.local.get(PIPELINE_CONFIGS_KEY);
	if (!Array.isArray(result[PIPELINE_CONFIGS_KEY])) {
		return [];
	}

	return dedupeByKey(result[PIPELINE_CONFIGS_KEY].map(normalizePipelineConfig).filter((config): config is PipelineConfig => config !== null));
}

export async function setPipelineConfigs(configs: PipelineConfig[]): Promise<void> {
	await ensureStorageSchema();
	await chrome.storage.local.set({
		[PIPELINE_CONFIGS_KEY]: dedupeByKey(configs.map(normalizePipelineConfig).filter((config): config is PipelineConfig => config !== null)),
	});
}

export async function getBuildSnapshots(): Promise<BuildSnapshot[]> {
	await ensureStorageSchema();

	const configs = await getPipelineConfigs();
	const configLookups = buildConfigLookups(configs);
	const result = await chrome.storage.local.get(BUILD_SNAPSHOTS_KEY);
	if (!Array.isArray(result[BUILD_SNAPSHOTS_KEY])) {
		return [];
	}

	return dedupeByKey(result[BUILD_SNAPSHOTS_KEY].map((snapshot) => normalizeBuildSnapshot(snapshot, configLookups)).filter((snapshot): snapshot is BuildSnapshot => snapshot !== null));
}

export async function setBuildSnapshots(snapshots: BuildSnapshot[]): Promise<void> {
	await ensureStorageSchema();
	const configs = await getPipelineConfigs();
	const configLookups = buildConfigLookups(configs);

	await chrome.storage.local.set({
		[BUILD_SNAPSHOTS_KEY]: dedupeByKey(snapshots.map((snapshot) => normalizeBuildSnapshot(snapshot, configLookups)).filter((snapshot): snapshot is BuildSnapshot => snapshot !== null)),
	});
}

export async function getDismissedBuilds(): Promise<MonitoringKey[]> {
	await ensureStorageSchema();

	const result = await chrome.storage.local.get(DISMISSED_BUILDS_KEY);
	if (!Array.isArray(result[DISMISSED_BUILDS_KEY])) {
		return [];
	}

	return dedupeByKey(result[DISMISSED_BUILDS_KEY].map(normalizeMonitoringKey).filter((key): key is MonitoringKey => key !== null));
}

export async function dismissBuild(key: MonitoringKey): Promise<void> {
	const current = await getDismissedBuilds();
	if (!current.some((item) => monitoringKeyEquals(item, key))) {
		await chrome.storage.local.set({ [DISMISSED_BUILDS_KEY]: [...current, key] });
	}
}

export async function undismissBuild(key: MonitoringKey): Promise<void> {
	const current = await getDismissedBuilds();
	await chrome.storage.local.set({
		[DISMISSED_BUILDS_KEY]: current.filter((item) => !monitoringKeyEquals(item, key)),
	});
}

export async function getLastPolledAt(): Promise<number | null> {
	const result = await chrome.storage.local.get(LAST_POLLED_KEY);
	return (result[LAST_POLLED_KEY] as number) ?? null;
}

export async function setLastPolledAt(ts: number): Promise<void> {
	await chrome.storage.local.set({ [LAST_POLLED_KEY]: ts });
}
