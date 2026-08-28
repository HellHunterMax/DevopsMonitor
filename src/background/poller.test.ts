import type { AdoApproval, AdoBuild, AdoTimelineRecord, PipelineConfig } from '../types/ado';

const ORG_URL = 'https://dev.azure.com/my-org';
const PROJECT = 'My Project';
const PIPELINE_ID = 12;
const BUILD_ID = 77;

function createConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    org: 'my-org',
    project: PROJECT,
    pipelineId: PIPELINE_ID,
    buildId: BUILD_ID,
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

function createBuild(overrides: Partial<AdoBuild> = {}): AdoBuild {
  return {
    id: BUILD_ID,
    buildNumber: '20260828.1',
    status: 'completed',
    result: 'succeeded',
    sourceBranch: 'refs/heads/main',
    definition: { id: PIPELINE_ID, name: 'Deploy' },
    ...overrides,
  };
}

function createStage(overrides: Partial<AdoTimelineRecord> = {}): AdoTimelineRecord {
  return {
    id: 'stage-1',
    name: 'Prod',
    type: 'Stage',
    state: 'completed',
    result: 'succeeded',
    order: 1,
    ...overrides,
  };
}

function createApproval(overrides: Partial<AdoApproval> = {}): AdoApproval {
  return {
    id: 'approval-1',
    status: 'pending',
    pipeline: {
      id: String(PIPELINE_ID),
      name: 'Deploy',
      owner: {
        id: BUILD_ID,
        name: '20260828.1',
      },
    },
    createdOn: '2026-08-28T09:00:00Z',
    ...overrides,
  };
}

function jsonResponse(
  data: unknown,
  init: { ok?: boolean; status?: number; statusText?: string } = {}
): Promise<Response> {
  return Promise.resolve({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: async () => data,
  } as Response);
}

function installFetchMap(map: Record<string, () => Promise<Response>>): void {
  const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    const matched = Object.entries(map).find(([fragment]) => url.includes(fragment));
    if (!matched) {
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    }

    return matched[1]();
  });
}

async function loadModules() {
  jest.resetModules();
  const storage = await import('../utils/storage');
  const state = await import('./state');
  const poller = await import('./poller');
  return { storage, state, poller };
}

describe('background poller', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('handles the pinned-build happy path, persists snapshots, and updates lastPolledAt', async () => {
    const { storage, poller } = await loadModules();
    await storage.saveCredentials(ORG_URL, 'secret');
    await storage.setPipelineConfigs([createConfig()]);

    installFetchMap({
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}?`]: () => jsonResponse(createBuild()),
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}/timeline?`]: () =>
        jsonResponse({ records: [createStage()] }),
      [`/${PROJECT}/_apis/pipelines/approvals?`]: () => jsonResponse({ value: [] }),
    });

    const before = Date.now();
    await poller.runPoll();
    const after = Date.now();

    expect(chrome.notifications.create).toHaveBeenCalledWith(
      `${PIPELINE_ID}-${BUILD_ID}-Prod-complete`,
      expect.objectContaining({
        title: '✅ Deploy',
        message: 'Prod: succeeded',
      })
    );

    await expect(storage.getBuildSnapshots()).resolves.toEqual([
      {
        org: 'my-org',
        project: PROJECT,
        pipelineId: PIPELINE_ID,
        buildId: BUILD_ID,
        stages: {
          Prod: {
            state: 'completed',
            result: 'succeeded',
            approvalPending: false,
          },
        },
      },
    ]);

    const lastPolledAt = await storage.getLastPolledAt();
    expect(lastPolledAt).not.toBeNull();
    expect(lastPolledAt!).toBeGreaterThanOrEqual(before);
    expect(lastPolledAt!).toBeLessThanOrEqual(after);
  });

  it('keeps the existing snapshot and skips notifications when the pinned build fetch fails', async () => {
    const { storage, poller } = await loadModules();
    await storage.saveCredentials(ORG_URL, 'secret');
    await storage.setPipelineConfigs([createConfig()]);
    await storage.setBuildSnapshots([
      {
        org: 'my-org',
        project: PROJECT,
        pipelineId: PIPELINE_ID,
        buildId: BUILD_ID,
        stages: {
          Prod: {
            state: 'completed',
            result: 'succeeded',
            approvalPending: false,
          },
        },
      },
    ]);

    installFetchMap({
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}?`]: () =>
        jsonResponse({ message: 'Not found' }, { ok: false, status: 404, statusText: 'Not Found' }),
    });

    await poller.runPoll();

    await expect(storage.getBuildSnapshots()).resolves.toEqual([
      {
        org: 'my-org',
        project: PROJECT,
        pipelineId: PIPELINE_ID,
        buildId: BUILD_ID,
        stages: {
          Prod: {
            state: 'completed',
            result: 'succeeded',
            approvalPending: false,
          },
        },
      },
    ]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  it('detects approval needs when the approval payload includes stage names', async () => {
    const { storage, poller } = await loadModules();
    await storage.saveCredentials(ORG_URL, 'secret');
    await storage.setPipelineConfigs([
      createConfig({
        stages: [
          { stageName: 'Prod', notifyOnComplete: true, notifyOnApprovalNeeded: true },
          { stageName: 'QA', notifyOnComplete: true, notifyOnApprovalNeeded: true },
        ],
      }),
    ]);

    installFetchMap({
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}?`]: () =>
        jsonResponse(createBuild({ status: 'inProgress', result: undefined })),
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}/timeline?`]: () =>
        jsonResponse({
          records: [
            createStage({ name: 'Prod', state: 'pending', result: undefined }),
            createStage({ id: 'stage-2', name: 'QA', state: 'inProgress', result: undefined, order: 2 }),
          ],
        }),
      [`/${PROJECT}/_apis/pipelines/approvals?`]: () =>
        jsonResponse({ value: [createApproval({ stage: { name: 'Prod' } })] }),
    });

    await poller.runPoll();

    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      `${PIPELINE_ID}-${BUILD_ID}-Prod-approval`,
      expect.objectContaining({
        title: 'Approval needed - Deploy',
        message: 'Prod is waiting for your approval',
      })
    );
  });

  it('treats stage-less approvals as pending for watched pending stages', async () => {
    const { storage, poller } = await loadModules();
    await storage.saveCredentials(ORG_URL, 'secret');
    await storage.setPipelineConfigs([createConfig()]);

    installFetchMap({
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}?`]: () =>
        jsonResponse(createBuild({ status: 'inProgress', result: undefined })),
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}/timeline?`]: () =>
        jsonResponse({ records: [createStage({ state: 'pending', result: undefined })] }),
      [`/${PROJECT}/_apis/pipelines/approvals?`]: () => jsonResponse({ value: [createApproval()] }),
    });

    await poller.runPoll();

    expect(chrome.notifications.create).toHaveBeenCalledWith(
      `${PIPELINE_ID}-${BUILD_ID}-Prod-approval`,
      expect.objectContaining({
        message: 'Prod is waiting for your approval',
      })
    );
  });

  it('falls back to pending timeline state when the approvals API returns no matches', async () => {
    const { storage, poller } = await loadModules();
    await storage.saveCredentials(ORG_URL, 'secret');
    await storage.setPipelineConfigs([createConfig()]);

    installFetchMap({
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}?`]: () =>
        jsonResponse(createBuild({ status: 'inProgress', result: undefined })),
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}/timeline?`]: () =>
        jsonResponse({ records: [createStage({ state: 'pending', result: undefined })] }),
      [`/${PROJECT}/_apis/pipelines/approvals?`]: () => jsonResponse({ value: [] }),
    });

    await poller.runPoll();

    expect(chrome.notifications.create).toHaveBeenCalledWith(
      `${PIPELINE_ID}-${BUILD_ID}-Prod-approval`,
      expect.any(Object)
    );
  });

  it('does not treat an actively deploying (inProgress) stage as needing approval when a later stage is pending', async () => {
    const { storage, poller } = await loadModules();
    await storage.saveCredentials(ORG_URL, 'secret');
    await storage.setPipelineConfigs([
      createConfig({
        stages: [
          { stageName: 'Test', notifyOnComplete: true, notifyOnApprovalNeeded: true },
          { stageName: 'Acceptance', notifyOnComplete: true, notifyOnApprovalNeeded: true },
        ],
      }),
    ]);

    installFetchMap({
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}?`]: () =>
        jsonResponse(createBuild({ status: 'inProgress', result: undefined })),
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}/timeline?`]: () =>
        jsonResponse({
          records: [
            createStage({ name: 'Test', state: 'inProgress', result: undefined }),
            createStage({ id: 'stage-2', name: 'Acceptance', state: 'pending', result: undefined, order: 2 }),
          ],
        }),
      // Stage-less approval payload — the ambiguous case the fallback heuristic handles.
      [`/${PROJECT}/_apis/pipelines/approvals?`]: () => jsonResponse({ value: [createApproval()] }),
    });

    await poller.runPoll();

    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      `${PIPELINE_ID}-${BUILD_ID}-Acceptance-approval`,
      expect.objectContaining({
        message: 'Acceptance is waiting for your approval',
      })
    );
    expect(chrome.notifications.create).not.toHaveBeenCalledWith(
      `${PIPELINE_ID}-${BUILD_ID}-Test-approval`,
      expect.any(Object)
    );
  });

  it('does not send duplicate completion notifications across unchanged polls', async () => {
    const { storage, poller } = await loadModules();
    await storage.saveCredentials(ORG_URL, 'secret');
    await storage.setPipelineConfigs([createConfig()]);

    installFetchMap({
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}?`]: () => jsonResponse(createBuild()),
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}/timeline?`]: () =>
        jsonResponse({ records: [createStage()] }),
      [`/${PROJECT}/_apis/pipelines/approvals?`]: () => jsonResponse({ value: [] }),
    });

    await poller.runPoll();
    await poller.runPoll();

    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
  });

  it('does not send duplicate approval notifications across unchanged polls', async () => {
    const { storage, poller } = await loadModules();
    await storage.saveCredentials(ORG_URL, 'secret');
    await storage.setPipelineConfigs([createConfig()]);

    installFetchMap({
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}?`]: () =>
        jsonResponse(createBuild({ status: 'inProgress', result: undefined })),
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}/timeline?`]: () =>
        jsonResponse({ records: [createStage({ state: 'pending', result: undefined })] }),
      [`/${PROJECT}/_apis/pipelines/approvals?`]: () => jsonResponse({ value: [createApproval()] }),
    });

    await poller.runPoll();
    await poller.runPoll();

    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
  });
});
