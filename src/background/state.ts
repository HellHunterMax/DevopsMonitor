import type { BuildSnapshot, StageSnapshot } from '../types/ado';
import { getBuildSnapshots, setBuildSnapshots } from '../utils/storage';

export type { BuildSnapshot, StageSnapshot };

export async function getSnapshot(pipelineId: number): Promise<BuildSnapshot | null> {
  const all = await getBuildSnapshots();
  return all.find(s => s.pipelineId === pipelineId) ?? null;
}

export async function saveSnapshot(snapshot: BuildSnapshot): Promise<void> {
  const all = await getBuildSnapshots();
  const idx = all.findIndex(s => s.pipelineId === snapshot.pipelineId);
  if (idx >= 0) all[idx] = snapshot;
  else all.push(snapshot);
  await setBuildSnapshots(all);
}
