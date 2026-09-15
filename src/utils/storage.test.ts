import type { BuildSnapshot, MonitoringKey, PipelineConfig } from '../types/ado';

const BASE_KEY: MonitoringKey = {
  org: 'my-org',
  project: 'My Project',
  pipelineId: 12,
  buildId: 34,
};

const BASE_CONFIG: PipelineConfig = {
  ...BASE_KEY,
  pipelineName: 'Deploy',
  stages: [
    {
      stageName: 'Prod',
      notifyOnComplete: true,
      notifyOnApprovalNeeded: true,
    },
  ],
};

const BASE_SNAPSHOT: BuildSnapshot = {
  ...BASE_KEY,
  stages: {
    Prod: {
      state: 'completed',
      result: 'succeeded',
      approvalPending: false,
    },
  },
};

async function loadStorageModule() {
  jest.resetModules();
  return import('./storage');
}

describe('storage utils', () => {
  it('reads and writes credentials', async () => {
    const storage = await loadStorageModule();

    await storage.saveCredentials('https://dev.azure.com/My-Org/', 'secret');

    await expect(storage.getCredentials()).resolves.toEqual({
      orgUrl: 'https://dev.azure.com/my-org',
      pat: 'secret',
    });
  });

  it('reads and writes pipeline configs', async () => {
    const storage = await loadStorageModule();

    await storage.setPipelineConfigs([BASE_CONFIG]);

    await expect(storage.getPipelineConfigs()).resolves.toEqual([BASE_CONFIG]);
  });

  it('reads and writes build snapshots', async () => {
    const storage = await loadStorageModule();
    await storage.setPipelineConfigs([BASE_CONFIG]);

    await storage.setBuildSnapshots([BASE_SNAPSHOT]);

    await expect(storage.getBuildSnapshots()).resolves.toEqual([BASE_SNAPSHOT]);
  });

  it('discards pipeline configs that only match the removed legacy lastBuildId shape', async () => {
    const storage = await loadStorageModule();

    await chrome.storage.local.set({
      pipeline_configs: [
        {
          org: BASE_KEY.org,
          project: BASE_KEY.project,
          pipelineId: BASE_KEY.pipelineId,
          lastBuildId: BASE_KEY.buildId,
          pipelineName: BASE_CONFIG.pipelineName,
          stages: BASE_CONFIG.stages,
        },
      ],
    });

    await expect(storage.getPipelineConfigs()).resolves.toEqual([]);
  });

  it('discards build snapshots missing the full monitoring key instead of reconstructing legacy shapes', async () => {
    const storage = await loadStorageModule();

    await chrome.storage.local.set({
      build_snapshots: [
        {
          pipelineId: BASE_KEY.pipelineId,
          buildId: BASE_KEY.buildId,
          stages: BASE_SNAPSHOT.stages,
        },
      ],
    });

    await expect(storage.getBuildSnapshots()).resolves.toEqual([]);
  });

  it('dismisses and undismisses builds using the composite monitoring key', async () => {
    const storage = await loadStorageModule();

    await storage.dismissBuild(BASE_KEY);
    await storage.dismissBuild(BASE_KEY);
    expect(await storage.getDismissedBuilds()).toEqual([
      expect.objectContaining(BASE_KEY),
    ]);
    expect((await storage.getDismissedBuilds())[0]?.dismissedAt).toEqual(expect.any(Number));

    await storage.undismissBuild(BASE_KEY);
    expect(await storage.getDismissedBuilds()).toEqual([]);
  });

  it('returns defaults when keys are missing', async () => {
    const storage = await loadStorageModule();

    await expect(storage.getCredentials()).resolves.toBeNull();
    await expect(storage.getPipelineConfigs()).resolves.toEqual([]);
    await expect(storage.getBuildSnapshots()).resolves.toEqual([]);
    await expect(storage.getDismissedBuilds()).resolves.toEqual([]);
    await expect(storage.getLastPolledAt()).resolves.toBeNull();
  });

  it('propagates rejected chrome.storage.local calls', async () => {
    const storage = await loadStorageModule();

    (chrome.storage.local.get as jest.Mock).mockRejectedValueOnce(new Error('get failed'));
    await expect(storage.getCredentials()).rejects.toThrow('get failed');

    (chrome.storage.local.set as jest.Mock).mockRejectedValueOnce(new Error('set failed'));
    await expect(storage.saveCredentials('https://dev.azure.com/my-org', 'secret')).rejects.toThrow('set failed');
  });
});
