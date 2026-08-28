import type { BuildSnapshot, MonitoringKey, StageSnapshot } from '../types/ado';
import { monitoringKeyEquals } from '../types/ado';
import { getBuildSnapshots, setBuildSnapshots } from '../utils/storage';

export type { BuildSnapshot, StageSnapshot };

export async function getSnapshot(key: MonitoringKey): Promise<BuildSnapshot | null> {
  const all = await getBuildSnapshots();
  return all.find(snapshot => monitoringKeyEquals(snapshot, key)) ?? null;
}

export async function saveSnapshot(snapshot: BuildSnapshot): Promise<void> {
  const all = await getBuildSnapshots();
  const idx = all.findIndex(existing => monitoringKeyEquals(existing, snapshot));
  if (idx >= 0) all[idx] = snapshot;
  else all.push(snapshot);
  await setBuildSnapshots(all);
}

export async function clearSnapshot(key: MonitoringKey): Promise<void> {
  const all = await getBuildSnapshots();
  await setBuildSnapshots(all.filter(snapshot => !monitoringKeyEquals(snapshot, key)));
}
