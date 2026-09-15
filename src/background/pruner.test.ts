import type { BuildSnapshot, DismissedBuild, MonitoringKey, PipelineConfig, StoredDismissedBuild } from '../types/ado';
import {
  pruneMonitoringState,
  readMonitoringState,
  runStaleDataPrune,
  type MonitoringStateData,
} from './state';

type LifecycleSnapshot = BuildSnapshot;
type DismissedBuildRecord = DismissedBuild;

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

const BASE_KEY: MonitoringKey = {
  org: 'my-org',
  project: 'My Project',
  pipelineId: 12,
  buildId: 34,
};

function createKey(overrides: Partial<MonitoringKey> = {}): MonitoringKey {
  return {
    ...BASE_KEY,
    ...overrides,
  };
}

function createConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  const keyOverrides = overrides as Partial<MonitoringKey>;

  return {
    ...createKey(keyOverrides),
    pipelineName: 'Deploy',
    stages: [
      {
        stageName: 'Prod',
        notifyOnComplete: true,
        notifyOnApprovalNeeded: true,
      },
    ],
    ...overrides,
  };
}

function createSnapshot(overrides: Partial<LifecycleSnapshot> = {}): LifecycleSnapshot {
  const keyOverrides = overrides as Partial<MonitoringKey>;

  return {
    ...createKey(keyOverrides),
    stages: {
      Prod: {
        state: 'completed',
        result: 'succeeded',
        approvalPending: false,
      },
    },
    buildStatus: 'completed',
    ...overrides,
  };
}

function createDismissedBuild(overrides: Partial<DismissedBuildRecord> = {}): DismissedBuildRecord {
  const keyOverrides = overrides as Partial<MonitoringKey>;

  return {
    ...createKey(keyOverrides),
    dismissedAt: Date.now(),
    ...overrides,
  };
}

function createLegacyDismissedBuild(overrides: Partial<StoredDismissedBuild> = {}): StoredDismissedBuild {
  const keyOverrides = overrides as Partial<MonitoringKey>;

  return {
    ...createKey(keyOverrides),
    ...overrides,
  };
}

function createState(overrides: Partial<MonitoringStateData> = {}): MonitoringStateData {
  return {
    pipelineConfigs: [],
    buildSnapshots: [],
    dismissedBuilds: [],
    lastPolledAt: Date.now(),
    ...overrides,
  };
}

describe('stale-data prune scenarios', () => {
  const frozenNow = new Date('2026-09-15T09:00:50.000Z');

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(frozenNow);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('prunes a monitored build and its snapshot once completion is older than 12 hours', async () => {
    const staleBuild = createConfig();
    const staleSnapshot = createSnapshot({
      buildFinishedAt: Date.now() - TWELVE_HOURS_MS - 1,
      lastSuccessfulPollAt: Date.now() - 60_000,
    });

    const result = pruneMonitoringState(
      Date.now(),
      createState({
        pipelineConfigs: [staleBuild],
        buildSnapshots: [staleSnapshot],
      })
    );

    expect(result.changed).toBe(true);
    expect(result.nextState.pipelineConfigs).toEqual([]);
    expect(result.nextState.buildSnapshots).toEqual([]);
  });

  it('retains a monitored build completed less than 12 hours ago', async () => {
    const retainedBuild = createConfig();
    const retainedSnapshot = createSnapshot({
      buildFinishedAt: Date.now() - TWELVE_HOURS_MS + 1,
      lastSuccessfulPollAt: Date.now() - 60_000,
    });

    const result = pruneMonitoringState(
      Date.now(),
      createState({
        pipelineConfigs: [retainedBuild],
        buildSnapshots: [retainedSnapshot],
      })
    );

    expect(result.changed).toBe(false);
    expect(result.nextState.pipelineConfigs).toEqual([retainedBuild]);
    expect(result.nextState.buildSnapshots).toEqual([retainedSnapshot]);
  });

  it('never prunes in-progress or approval-pending monitored builds, even with very old timestamps', async () => {
    const inProgressConfig = createConfig();
    const approvalPendingConfig = createConfig({ buildId: 35, pipelineName: 'Deploy Approval' });
    const veryOld = Date.now() - TWELVE_HOURS_MS - 7 * 24 * 60 * 60 * 1000;

    const result = pruneMonitoringState(
      Date.now(),
      createState({
        pipelineConfigs: [inProgressConfig, approvalPendingConfig],
        buildSnapshots: [
          createSnapshot({
            buildStatus: 'inProgress',
            buildFinishedAt: veryOld,
            lastSuccessfulPollAt: veryOld,
          }),
          createSnapshot({
            buildId: 35,
            buildStatus: 'inProgress',
            buildFinishedAt: veryOld,
            lastSuccessfulPollAt: veryOld,
            stages: {
              Prod: {
                state: 'pending',
                approvalPending: true,
              },
            },
          }),
        ],
      })
    );

    expect(result.changed).toBe(false);
    expect(result.nextState.pipelineConfigs).toHaveLength(2);
    expect(result.nextState.buildSnapshots).toHaveLength(2);
  });

  it('falls back to lastSuccessfulPollAt when a terminal build lacks a usable finishTime', async () => {
    const oldFallbackConfig = createConfig();
    const recentFallbackConfig = createConfig({ buildId: 36, pipelineName: 'Deploy Recent' });

    const result = pruneMonitoringState(
      Date.now(),
      createState({
        pipelineConfigs: [oldFallbackConfig, recentFallbackConfig],
        buildSnapshots: [
          createSnapshot({
            buildFinishedAt: Number.NaN,
            lastSuccessfulPollAt: Date.now() - TWELVE_HOURS_MS - 1,
          }),
          createSnapshot({
            buildId: 36,
            buildFinishedAt: undefined,
            lastSuccessfulPollAt: Date.now() - 60_000,
          }),
        ],
      })
    );

    expect(result.nextState.pipelineConfigs).toEqual([recentFallbackConfig]);
    expect(result.nextState.buildSnapshots).toEqual([
      expect.objectContaining({ buildId: 36, lastSuccessfulPollAt: Date.now() - 60_000 }),
    ]);
  });

  it('always prunes orphan snapshots, regardless of age or lifecycle metadata', async () => {
    const result = pruneMonitoringState(
      Date.now(),
      createState({
        buildSnapshots: [
          createSnapshot({
            buildId: 99,
            buildFinishedAt: Date.now(),
          }),
          createSnapshot({
            buildId: 100,
            buildStatus: undefined,
            buildFinishedAt: undefined,
            lastSuccessfulPollAt: undefined,
          }),
        ],
      })
    );

    expect(result.changed).toBe(true);
    expect(result.nextState.buildSnapshots).toEqual([]);
  });

  it('never deletes the current snapshot while its monitored build is still retained', async () => {
    const retainedBuild = createConfig();
    const retainedSnapshot = createSnapshot({
      buildFinishedAt: Date.now() - TWELVE_HOURS_MS + 5 * 60 * 1000,
      lastSuccessfulPollAt: Date.now() - 60_000,
    });

    const result = pruneMonitoringState(
      Date.now(),
      createState({
        pipelineConfigs: [retainedBuild],
        buildSnapshots: [retainedSnapshot],
      })
    );

    expect(result.nextState.pipelineConfigs).toEqual([retainedBuild]);
    expect(result.nextState.buildSnapshots).toEqual([retainedSnapshot]);
  });

  it('expires dismissed builds exactly 12 hours after dismissedAt, independent of build state', async () => {
    const exactlyExpired = createDismissedBuild({
      buildId: 44,
      dismissedAt: Date.now() - TWELVE_HOURS_MS,
    });
    const stillRetained = createDismissedBuild({
      buildId: 45,
      dismissedAt: Date.now() - TWELVE_HOURS_MS + 1,
    });

    const result = pruneMonitoringState(
      Date.now(),
      createState({
        pipelineConfigs: [
          createConfig({ buildId: 200, pipelineName: 'Active Build' }),
        ],
        buildSnapshots: [
          createSnapshot({
            buildId: 200,
            buildStatus: 'inProgress',
            buildFinishedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
            lastSuccessfulPollAt: Date.now() - 60_000,
          }),
        ],
        dismissedBuilds: [exactlyExpired, stillRetained],
      })
    );

    expect(result.nextState.dismissedBuilds).toEqual([stillRetained]);
    expect(result.nextState.pipelineConfigs).toHaveLength(1);
    expect(result.nextState.buildSnapshots).toHaveLength(1);
  });

  it('drops legacy dismissed builds without dismissedAt on the first prune pass', async () => {
    const legacyRecord = createLegacyDismissedBuild({
      buildId: 46,
      dismissedAt: undefined,
    });

    const result = pruneMonitoringState(
      Date.now(),
      createState({
        dismissedBuilds: [legacyRecord],
      })
    );

    expect(result.changed).toBe(true);
    expect(result.nextState.dismissedBuilds).toEqual([]);
  });

  it('retains legacy snapshots without lifecycle metadata until a later successful poll refreshes them', async () => {
    const legacyConfig = createConfig();
    const legacySnapshot = createSnapshot({
      buildStatus: undefined,
      buildFinishedAt: undefined,
      lastSuccessfulPollAt: undefined,
    });

    const result = pruneMonitoringState(
      Date.now(),
      createState({
        pipelineConfigs: [legacyConfig],
        buildSnapshots: [legacySnapshot],
      })
    );

    expect(result.changed).toBe(false);
    expect(result.nextState.pipelineConfigs).toEqual([legacyConfig]);
    expect(result.nextState.buildSnapshots).toEqual([legacySnapshot]);
  });

  it('is idempotent and safe to run repeatedly without deleting additional non-stale items', async () => {
    const staleConfig = createConfig();
    const retainedConfig = createConfig({ buildId: 47, pipelineName: 'Retained Build' });
    const dismissedBuild = createDismissedBuild({
      buildId: 48,
      dismissedAt: Date.now() - 10 * 60 * 1000,
    });

    const firstResult = pruneMonitoringState(
      Date.now(),
      createState({
        pipelineConfigs: [staleConfig, retainedConfig],
        buildSnapshots: [
          createSnapshot({
            buildFinishedAt: Date.now() - TWELVE_HOURS_MS - 1,
            lastSuccessfulPollAt: Date.now() - 60_000,
          }),
          createSnapshot({
            buildId: 47,
            buildFinishedAt: Date.now() - TWELVE_HOURS_MS + 1,
            lastSuccessfulPollAt: Date.now() - 60_000,
          }),
        ],
        dismissedBuilds: [dismissedBuild],
      })
    );

    const secondResult = pruneMonitoringState(Date.now(), firstResult.nextState);

    expect(firstResult.nextState.pipelineConfigs).toEqual([retainedConfig]);
    expect(firstResult.nextState.buildSnapshots).toEqual([
      expect.objectContaining({ buildId: 47 }),
    ]);
    expect(firstResult.nextState.dismissedBuilds).toEqual([dismissedBuild]);
    expect(secondResult.changed).toBe(false);
    expect(secondResult.nextState).toEqual(firstResult.nextState);
  });

  it('runStaleDataPrune persists pruned snapshots and drops legacy dismissed records through the real storage-backed state API', async () => {
    await chrome.storage.local.set({
      pipeline_configs: [createConfig({ buildId: 60, pipelineName: 'Fresh Build' })],
      build_snapshots: [
        createSnapshot({
          buildId: 60,
          buildFinishedAt: Date.now() - 60_000,
          lastSuccessfulPollAt: Date.now() - 60_000,
        }),
        createSnapshot({
          buildId: 61,
          buildFinishedAt: Date.now() - TWELVE_HOURS_MS - 1,
          lastSuccessfulPollAt: Date.now() - TWELVE_HOURS_MS - 1,
        }),
      ],
      dismissed_builds: [
        createLegacyDismissedBuild({ buildId: 62, dismissedAt: undefined }),
        createDismissedBuild({ buildId: 63, dismissedAt: Date.now() - TWELVE_HOURS_MS - 1 }),
      ],
      last_polled_at: Date.now(),
    });

    const nextState = await runStaleDataPrune(Date.now());
    const rereadState = await readMonitoringState();

    expect(nextState.pipelineConfigs).toEqual([
      expect.objectContaining({ buildId: 60, pipelineName: 'Fresh Build' }),
    ]);
    expect(nextState.buildSnapshots).toEqual([
      expect.objectContaining({ buildId: 60 }),
    ]);
    expect(nextState.dismissedBuilds).toEqual([]);
    expect(rereadState).toEqual(nextState);
  });
});

describe('service-worker stale-data cleanup triggers', () => {
  afterEach(() => {
    jest.unmock('./poller');
    jest.unmock('./notifier');
    jest.unmock('./state');
  });

  async function loadServiceWorkerWithMocks() {
    jest.resetModules();
    (chrome.alarms.get as jest.Mock).mockImplementation(
      (_name: string, callback?: (alarm?: chrome.alarms.Alarm) => void) => callback?.(undefined)
    );
    (chrome.alarms.clear as jest.Mock).mockImplementation(
      (_name: string, callback?: (wasCleared: boolean) => void) => callback?.(true)
    );

    const runPoll = jest.fn().mockResolvedValue(undefined);
    const sendTestNotification = jest.fn().mockResolvedValue(undefined);
    const handleNotificationClick = jest.fn().mockResolvedValue(undefined);
    const runStaleDataPrune = jest.fn().mockResolvedValue(undefined);

    jest.doMock('./poller', () => ({
      runPoll,
    }));
    jest.doMock('./notifier', () => ({
      sendTestNotification,
      handleNotificationClick,
    }));
    jest.doMock('./state', () => ({
      runStaleDataPrune,
    }));

    require('./service-worker');

    return {
      runPoll,
      runStaleDataPrune,
    };
  }

  async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  function getMockCalls(fn: unknown): unknown[][] {
    return (fn as jest.Mock).mock.calls;
  }

  it('registers an hourly prune alarm and runs cleanup on install and startup', async () => {
    const { runStaleDataPrune, runPoll } = await loadServiceWorkerWithMocks();

    expect(chrome.runtime.onInstalled.hasListeners()).toBe(true);
    expect(chrome.runtime.onStartup.hasListeners()).toBe(true);

    (
      chrome.runtime.onInstalled as typeof chrome.runtime.onInstalled & {
        callListeners: (details: chrome.runtime.InstalledDetails) => void;
      }
    ).callListeners({ reason: 'install' } as chrome.runtime.InstalledDetails);
    await flushPromises();
    (
      chrome.runtime.onStartup as typeof chrome.runtime.onStartup & {
        callListeners: () => void;
      }
    ).callListeners();
    await flushPromises();

    expect(getMockCalls(chrome.alarms.create)).toContainEqual([
      'devops-prune',
      { periodInMinutes: 60 },
    ]);
    expect(runStaleDataPrune).toHaveBeenCalledTimes(2);
    expect(runPoll).toHaveBeenCalledTimes(1);
  });

  it('runs stale-data cleanup from the prune alarm path', async () => {
    const { runStaleDataPrune } = await loadServiceWorkerWithMocks();

    expect(chrome.alarms.onAlarm.hasListeners()).toBe(true);

    (
      chrome.alarms.onAlarm as typeof chrome.alarms.onAlarm & {
        callListeners: (alarm: chrome.alarms.Alarm) => void;
      }
    ).callListeners({
      name: 'devops-prune',
      scheduledTime: Date.now(),
      periodInMinutes: 60,
    } as chrome.alarms.Alarm);
    await flushPromises();

    expect(runStaleDataPrune).toHaveBeenCalledTimes(1);
  });
});
