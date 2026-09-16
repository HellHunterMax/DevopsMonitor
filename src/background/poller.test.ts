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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function notificationIdPattern(logicalId: string): RegExp {
  return new RegExp(`^${escapeRegExp(logicalId)}::\\d+::\\d+$`);
}

function expectNotificationCreated(logicalId: string, options: Record<string, unknown>): void {
  expect(chrome.notifications.create).toHaveBeenCalledWith(
    expect.stringMatching(notificationIdPattern(logicalId)),
    expect.objectContaining(options)
  );
}

function expectNthNotificationCreated(
  callNumber: number,
  logicalId: string,
  options: Record<string, unknown>
): void {
  expect(chrome.notifications.create).toHaveBeenNthCalledWith(
    callNumber,
    expect.stringMatching(notificationIdPattern(logicalId)),
    expect.objectContaining(options)
  );
}

function expectNotificationNotCreated(logicalId: string): void {
  expect(chrome.notifications.create).not.toHaveBeenCalledWith(
    expect.stringMatching(notificationIdPattern(logicalId)),
    expect.any(Object)
  );
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
    const finishTime = '2026-08-28T10:00:00Z';

    installFetchMap({
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}?`]: () => jsonResponse(createBuild({ finishTime })),
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}/timeline?`]: () =>
        jsonResponse({ records: [createStage()] }),
      [`/${PROJECT}/_apis/pipelines/approvals?`]: () => jsonResponse({ value: [] }),
    });

    const before = Date.now();
    await poller.runPoll();
    const after = Date.now();

    expectNotificationCreated(`${PIPELINE_ID}-${BUILD_ID}-Prod-complete`, {
      title: '✅ Deploy',
      message: 'Prod: succeeded',
    });

    await expect(storage.getBuildSnapshots()).resolves.toEqual([
      expect.objectContaining({
        org: 'my-org',
        project: PROJECT,
        pipelineId: PIPELINE_ID,
        buildId: BUILD_ID,
        buildStatus: 'completed',
        buildFinishedAt: Date.parse(finishTime),
        lastSuccessfulPollAt: expect.any(Number),
        stages: {
          Prod: {
            state: 'completed',
            result: 'succeeded',
            approvalPending: false,
          },
        },
      }),
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
    expectNotificationCreated(`${PIPELINE_ID}-${BUILD_ID}-Prod-approval`, {
      title: 'Approval needed - Deploy',
      message: 'Prod is waiting for your approval',
    });
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

    expectNotificationCreated(`${PIPELINE_ID}-${BUILD_ID}-Prod-approval`, {
      message: 'Prod is waiting for your approval',
    });
  });

  it('matches approvals when ADO serializes the build owner id as a string', async () => {
    const { storage, poller } = await loadModules();
    await storage.saveCredentials(ORG_URL, 'secret');
    await storage.setPipelineConfigs([createConfig()]);

    installFetchMap({
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}?`]: () =>
        jsonResponse(createBuild({ status: 'inProgress', result: undefined })),
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}/timeline?`]: () =>
        jsonResponse({ records: [createStage({ state: 'pending', result: undefined })] }),
      [`/${PROJECT}/_apis/pipelines/approvals?`]: () =>
        jsonResponse({
          value: [
            createApproval({
              pipeline: {
                id: String(PIPELINE_ID),
                name: 'Deploy',
                owner: {
                  id: String(BUILD_ID),
                  name: '20260828.1',
                },
              },
            }),
          ],
        }),
    });

    await poller.runPoll();

    expectNotificationCreated(`${PIPELINE_ID}-${BUILD_ID}-Prod-approval`, {
      message: 'Prod is waiting for your approval',
    });
  });

  it('does not treat pending timeline state as approval when the approvals API returns no matches', async () => {
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

    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  it('does not infer a stage-less approval while an earlier stage is still in progress', async () => {
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
      // Stage-less approval payload — do not attribute it to a future stage when an earlier
      // stage is still running, because that future stage is not actually "next up" yet.
      [`/${PROJECT}/_apis/pipelines/approvals?`]: () => jsonResponse({ value: [createApproval()] }),
    });

    await poller.runPoll();

    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  it('does not notify for downstream pending stages in a normal sequential build with zero approvals', async () => {
    const { storage, poller } = await loadModules();
    await storage.saveCredentials(ORG_URL, 'secret');
    await storage.setPipelineConfigs([
      createConfig({
        stages: [
          { stageName: 'Build', notifyOnComplete: true, notifyOnApprovalNeeded: true },
          { stageName: 'Run tests', notifyOnComplete: true, notifyOnApprovalNeeded: true },
          { stageName: 'Prod', notifyOnComplete: true, notifyOnApprovalNeeded: true },
        ],
      }),
    ]);

    installFetchMap({
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}?`]: () =>
        jsonResponse(createBuild({ status: 'inProgress', result: undefined })),
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}/timeline?`]: () =>
        jsonResponse({
          records: [
            createStage({ name: 'Build', state: 'inProgress', result: undefined, order: 1 }),
            createStage({ id: 'stage-2', name: 'Run tests', state: 'pending', result: undefined, order: 2 }),
            createStage({ id: 'stage-3', name: 'Prod', state: 'pending', result: undefined, order: 3 }),
          ],
        }),
      [`/${PROJECT}/_apis/pipelines/approvals?`]: () => jsonResponse({ value: [] }),
    });

    await poller.runPoll();

    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  it('maps a stage-less approval to only the single next-up pending stage in a sequential build', async () => {
    const { storage, poller } = await loadModules();
    await storage.saveCredentials(ORG_URL, 'secret');
    await storage.setPipelineConfigs([
      createConfig({
        stages: [
          { stageName: 'Build', notifyOnComplete: false, notifyOnApprovalNeeded: true },
          { stageName: 'Acceptance', notifyOnComplete: false, notifyOnApprovalNeeded: true },
          { stageName: 'Prod', notifyOnComplete: false, notifyOnApprovalNeeded: true },
        ],
      }),
    ]);

    installFetchMap({
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}?`]: () =>
        jsonResponse(createBuild({ status: 'inProgress', result: undefined })),
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}/timeline?`]: () =>
        jsonResponse({
          records: [
            createStage({ name: 'Build', state: 'completed', result: 'succeeded', order: 1 }),
            createStage({ id: 'stage-2', name: 'Acceptance', state: 'pending', result: undefined, order: 2 }),
            createStage({ id: 'stage-3', name: 'Prod', state: 'pending', result: undefined, order: 3 }),
          ],
        }),
      [`/${PROJECT}/_apis/pipelines/approvals?`]: () => jsonResponse({ value: [createApproval()] }),
    });

    await poller.runPoll();

    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    expectNotificationCreated(`${PIPELINE_ID}-${BUILD_ID}-Acceptance-approval`, {
      message: 'Acceptance is waiting for your approval',
    });
    expectNotificationNotCreated(`${PIPELINE_ID}-${BUILD_ID}-Prod-approval`);
  });

  it('maps a stage-less approval to all parallel next-up stages after a skipped predecessor', async () => {
    const { storage, poller } = await loadModules();
    await storage.saveCredentials(ORG_URL, 'secret');
    await storage.setPipelineConfigs([
      createConfig({
        stages: [
          { stageName: 'Smoke', notifyOnComplete: false, notifyOnApprovalNeeded: true },
          { stageName: 'Deploy West', notifyOnComplete: false, notifyOnApprovalNeeded: true },
          { stageName: 'Deploy East', notifyOnComplete: false, notifyOnApprovalNeeded: true },
          { stageName: 'Prod', notifyOnComplete: false, notifyOnApprovalNeeded: true },
        ],
      }),
    ]);

    installFetchMap({
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}?`]: () =>
        jsonResponse(createBuild({ status: 'inProgress', result: undefined })),
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}/timeline?`]: () =>
        jsonResponse({
          records: [
            createStage({ name: 'Smoke', state: 'completed', result: 'skipped', order: 1 }),
            createStage({ id: 'stage-2', name: 'Deploy West', state: 'pending', result: undefined, order: 2 }),
            createStage({ id: 'stage-3', name: 'Deploy East', state: 'pending', result: undefined, order: 2 }),
            createStage({ id: 'stage-4', name: 'Prod', state: 'pending', result: undefined, order: 3 }),
          ],
        }),
      [`/${PROJECT}/_apis/pipelines/approvals?`]: () => jsonResponse({ value: [createApproval()] }),
    });

    await poller.runPoll();

    expect(chrome.notifications.create).toHaveBeenCalledTimes(2);
    expectNotificationCreated(`${PIPELINE_ID}-${BUILD_ID}-Deploy West-approval`, {
      message: 'Deploy West is waiting for your approval',
    });
    expectNotificationCreated(`${PIPELINE_ID}-${BUILD_ID}-Deploy East-approval`, {
      message: 'Deploy East is waiting for your approval',
    });
    expectNotificationNotCreated(`${PIPELINE_ID}-${BUILD_ID}-Prod-approval`);
  });

  it('keeps stage-less approvals constrained to next-up stages when mixed with named approvals', async () => {
    const { storage, poller } = await loadModules();
    await storage.saveCredentials(ORG_URL, 'secret');
    await storage.setPipelineConfigs([
      createConfig({
        stages: [
          { stageName: 'Build', notifyOnComplete: false, notifyOnApprovalNeeded: true },
          { stageName: 'Acceptance', notifyOnComplete: false, notifyOnApprovalNeeded: true },
          { stageName: 'Prod', notifyOnComplete: false, notifyOnApprovalNeeded: true },
          { stageName: 'Post-check', notifyOnComplete: false, notifyOnApprovalNeeded: true },
        ],
      }),
    ]);

    installFetchMap({
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}?`]: () =>
        jsonResponse(createBuild({ status: 'inProgress', result: undefined })),
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}/timeline?`]: () =>
        jsonResponse({
          records: [
            createStage({ name: 'Build', state: 'completed', result: 'succeeded', order: 1 }),
            createStage({ id: 'stage-2', name: 'Acceptance', state: 'pending', result: undefined, order: 2 }),
            createStage({ id: 'stage-3', name: 'Prod', state: 'pending', result: undefined, order: 3 }),
            createStage({ id: 'stage-4', name: 'Post-check', state: 'pending', result: undefined, order: 4 }),
          ],
        }),
      [`/${PROJECT}/_apis/pipelines/approvals?`]: () =>
        jsonResponse({
          value: [createApproval(), createApproval({ id: 'approval-2', stage: { name: 'Prod' } })],
        }),
    });

    await poller.runPoll();

    expect(chrome.notifications.create).toHaveBeenCalledTimes(2);
    expectNotificationCreated(`${PIPELINE_ID}-${BUILD_ID}-Acceptance-approval`, {
      message: 'Acceptance is waiting for your approval',
    });
    expectNotificationCreated(`${PIPELINE_ID}-${BUILD_ID}-Prod-approval`, {
      message: 'Prod is waiting for your approval',
    });
    expectNotificationNotCreated(`${PIPELINE_ID}-${BUILD_ID}-Post-check-approval`);
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

  it('re-notifies the same monitored build after its snapshot is cleared and uses a fresh chrome notification id', async () => {
    const { storage, state, poller } = await loadModules();
    await storage.saveCredentials(ORG_URL, 'secret');
    await storage.setPipelineConfigs([createConfig()]);

    installFetchMap({
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}?`]: () => jsonResponse(createBuild()),
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}/timeline?`]: () =>
        jsonResponse({ records: [createStage()] }),
      [`/${PROJECT}/_apis/pipelines/approvals?`]: () => jsonResponse({ value: [] }),
    });

    await poller.runPoll();
    await state.clearSnapshot(createConfig());
    await poller.runPoll();

    expect(chrome.notifications.create).toHaveBeenCalledTimes(2);
    expectNthNotificationCreated(1, `${PIPELINE_ID}-${BUILD_ID}-Prod-complete`, {
      title: '✅ Deploy',
      message: 'Prod: succeeded',
    });
    expectNthNotificationCreated(2, `${PIPELINE_ID}-${BUILD_ID}-Prod-complete`, {
      title: '✅ Deploy',
      message: 'Prod: succeeded',
    });

    const [firstNotificationId, secondNotificationId] = (
      chrome.notifications.create as jest.Mock
    ).mock.calls.map(([notificationId]) => notificationId as string);
    expect(firstNotificationId).not.toBe(secondNotificationId);
  });

  it('uses distinct notification ids for different build runs of the same pipeline', async () => {
    const { storage, poller } = await loadModules();
    await storage.saveCredentials(ORG_URL, 'secret');
    await storage.setPipelineConfigs([
      createConfig(),
      createConfig({ buildId: BUILD_ID + 1 }),
    ]);

    installFetchMap({
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}?`]: () => jsonResponse(createBuild()),
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID}/timeline?`]: () =>
        jsonResponse({ records: [createStage()] }),
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID + 1}?`]: () =>
        jsonResponse(createBuild({ id: BUILD_ID + 1, buildNumber: '20260828.2' })),
      [`/${PROJECT}/_apis/build/builds/${BUILD_ID + 1}/timeline?`]: () =>
        jsonResponse({ records: [createStage()] }),
      [`/${PROJECT}/_apis/pipelines/approvals?`]: () => jsonResponse({ value: [] }),
    });

    await poller.runPoll();

    expect(chrome.notifications.create).toHaveBeenCalledTimes(2);
    expectNthNotificationCreated(1, `${PIPELINE_ID}-${BUILD_ID}-Prod-complete`, {
      title: '✅ Deploy',
      message: 'Prod: succeeded',
    });
    expectNthNotificationCreated(2, `${PIPELINE_ID}-${BUILD_ID + 1}-Prod-complete`, {
      title: '✅ Deploy',
      message: 'Prod: succeeded',
    });
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
