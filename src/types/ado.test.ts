import { monitoringKeyToString, parseMonitoringKeyString, toMonitoringKey, type BuildSnapshot, type DismissedBuild, type MonitoringKey, type PipelineConfig } from './ado';

const BASE_KEY: MonitoringKey = {
  org: 'my-org',
  project: 'My Project',
  pipelineId: 12,
  buildId: 34,
};

describe('monitoring key helpers', () => {
  it('serializes pipeline configs, snapshots, and dismissed records to the same canonical key', () => {
    const config: PipelineConfig = {
      ...BASE_KEY,
      pipelineName: 'Deploy',
      stages: [],
    };
    const snapshot: BuildSnapshot = {
      ...BASE_KEY,
      stages: {},
      buildStatus: 'completed',
      buildFinishedAt: Date.now(),
      lastSuccessfulPollAt: Date.now(),
    };
    const dismissed: DismissedBuild = {
      ...BASE_KEY,
      dismissedAt: Date.now(),
    };

    expect(monitoringKeyToString(config)).toBe(monitoringKeyToString(snapshot));
    expect(monitoringKeyToString(snapshot)).toBe(monitoringKeyToString(dismissed));
    expect(parseMonitoringKeyString(monitoringKeyToString(dismissed))).toEqual(BASE_KEY);
  });

  it('projects only the four monitoring key fields', () => {
    expect(
      toMonitoringKey({
        ...BASE_KEY,
        extra: 'ignored',
      } as MonitoringKey & { extra: string })
    ).toEqual(BASE_KEY);
  });
});
