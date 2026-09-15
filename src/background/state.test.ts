import type { BuildSnapshot, MonitoringKey } from '../types/ado';

const KEY_ONE: MonitoringKey = {
  org: 'my-org',
  project: 'My Project',
  pipelineId: 12,
  buildId: 34,
};

const KEY_TWO: MonitoringKey = {
  ...KEY_ONE,
  buildId: 35,
};

const SNAPSHOT_ONE: BuildSnapshot = {
  ...KEY_ONE,
  stages: {
    Prod: {
      state: 'completed',
      result: 'succeeded',
      approvalPending: false,
    },
  },
};

const SNAPSHOT_TWO: BuildSnapshot = {
  ...KEY_TWO,
  stages: {
    Prod: {
      state: 'pending',
      approvalPending: true,
    },
  },
};

async function loadStateModule() {
  jest.resetModules();
  return import('./state');
}

async function seedConfigs(): Promise<void> {
  const storage = await import('../utils/storage');
  await storage.setPipelineConfigs([
    {
      ...KEY_ONE,
      pipelineName: 'Deploy',
      stages: [
        {
          stageName: 'Prod',
          notifyOnComplete: true,
          notifyOnApprovalNeeded: true,
        },
      ],
    },
    {
      ...KEY_TWO,
      pipelineName: 'Deploy 2',
      stages: [
        {
          stageName: 'Prod',
          notifyOnComplete: true,
          notifyOnApprovalNeeded: true,
        },
      ],
    },
  ]);
}

describe('background state', () => {
  it('saves and retrieves snapshots by the full monitoring key', async () => {
    const state = await loadStateModule();
    await seedConfigs();

    await state.saveSnapshot(SNAPSHOT_ONE);
    await state.saveSnapshot(SNAPSHOT_TWO);

    await expect(state.getSnapshot(KEY_ONE)).resolves.toEqual(SNAPSHOT_ONE);
    await expect(state.getSnapshot(KEY_TWO)).resolves.toEqual(SNAPSHOT_TWO);
  });

  it('updates an existing snapshot without affecting other builds', async () => {
    const state = await loadStateModule();
    await seedConfigs();

    await state.saveSnapshot(SNAPSHOT_ONE);
    await state.saveSnapshot(SNAPSHOT_TWO);
    await state.saveSnapshot({
      ...SNAPSHOT_ONE,
      stages: {
        Prod: {
          state: 'completed',
          result: 'failed',
          approvalPending: false,
        },
      },
    });

    await expect(state.getSnapshot(KEY_ONE)).resolves.toMatchObject({
      buildId: 34,
      stages: {
        Prod: {
          result: 'failed',
        },
      },
    });
    await expect(state.getSnapshot(KEY_TWO)).resolves.toEqual(SNAPSHOT_TWO);
  });

  it('clears snapshots by exact key only', async () => {
    const state = await loadStateModule();
    await seedConfigs();

    await state.saveSnapshot(SNAPSHOT_ONE);
    await state.saveSnapshot(SNAPSHOT_TWO);

    await state.clearSnapshot(KEY_ONE);

    await expect(state.getSnapshot(KEY_ONE)).resolves.toBeNull();
    await expect(state.getSnapshot(KEY_TWO)).resolves.toEqual(SNAPSHOT_TWO);
  });
});
