import type { AdoListResponse, AdoBuild, AdoTimelineRecord } from '../types/ado';
import { AdoClient } from './ado-client';

export async function getBuilds(
  client: AdoClient,
  project: string,
  pipelineId: number,
  top = 1
): Promise<AdoBuild[]> {
  const data = await client.get<AdoListResponse<AdoBuild>>(
    `${client.orgUrl}/${project}/_apis/build/builds?definitions=${pipelineId}&$top=${top}&api-version=7.1`
  );
  return data.value;
}

export async function getBuild(client: AdoClient, project: string, buildId: number): Promise<AdoBuild> {
  return client.get<AdoBuild>(
    `${client.orgUrl}/${project}/_apis/build/builds/${buildId}?api-version=7.1`
  );
}

export async function getTimeline(
  client: AdoClient,
  project: string,
  buildId: number
): Promise<AdoTimelineRecord[]> {
  const data = await client.get<{ records: AdoTimelineRecord[] }>(
    `${client.orgUrl}/${project}/_apis/build/builds/${buildId}/timeline?api-version=7.1`
  );
  return data.records ?? [];
}
