import type { PipelineConfig, BuildSnapshot } from '../types/ado';

export async function getCredentials(): Promise<{ orgUrl: string; pat: string } | null> {
  const result = await chrome.storage.local.get(['ado_org_url', 'ado_pat']);
  if (!result.ado_org_url || !result.ado_pat) return null;
  return { orgUrl: result.ado_org_url as string, pat: result.ado_pat as string };
}

export async function saveCredentials(orgUrl: string, pat: string): Promise<void> {
  await chrome.storage.local.set({ ado_org_url: orgUrl, ado_pat: pat });
}

export async function getPipelineConfigs(): Promise<PipelineConfig[]> {
  const result = await chrome.storage.local.get('pipeline_configs');
  return (result.pipeline_configs as PipelineConfig[]) ?? [];
}

export async function setPipelineConfigs(configs: PipelineConfig[]): Promise<void> {
  await chrome.storage.local.set({ pipeline_configs: configs });
}

export async function getBuildSnapshots(): Promise<BuildSnapshot[]> {
  const result = await chrome.storage.local.get('build_snapshots');
  return (result.build_snapshots as BuildSnapshot[]) ?? [];
}

export async function setBuildSnapshots(snapshots: BuildSnapshot[]): Promise<void> {
  await chrome.storage.local.set({ build_snapshots: snapshots });
}

const DISMISSED_BUILDS_KEY = 'dismissed_builds';

export async function getDismissedBuilds(): Promise<number[]> {
  const result = await chrome.storage.local.get(DISMISSED_BUILDS_KEY);
  return (result[DISMISSED_BUILDS_KEY] as number[]) ?? [];
}

export async function dismissBuild(buildId: number): Promise<void> {
  const current = await getDismissedBuilds();
  if (!current.includes(buildId)) {
    await chrome.storage.local.set({ [DISMISSED_BUILDS_KEY]: [...current, buildId] });
  }
}

export async function undismissBuild(buildId: number): Promise<void> {
  const current = await getDismissedBuilds();
  await chrome.storage.local.set({
    [DISMISSED_BUILDS_KEY]: current.filter(id => id !== buildId),
  });
}

const LAST_POLLED_KEY = 'last_polled_at';

export async function getLastPolledAt(): Promise<number | null> {
  const result = await chrome.storage.local.get(LAST_POLLED_KEY);
  return (result[LAST_POLLED_KEY] as number) ?? null;
}

export async function setLastPolledAt(ts: number): Promise<void> {
  await chrome.storage.local.set({ [LAST_POLLED_KEY]: ts });
}
