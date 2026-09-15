import { readFileSync } from 'fs';
import { join } from 'path';

import type { AdoBuild, AdoTimelineRecord, MonitoringKey, PipelineConfig } from '../types/ado';

const CONFIGURED_ORG_URL = 'https://dev.azure.com/my-org';
const PROJECT = 'My Project';
const PIPELINE_ID = 12;
const BUILD_ID = 77;

function createMonitoringKey(overrides: Partial<MonitoringKey> = {}): MonitoringKey {
  return {
    org: 'my-org',
    project: PROJECT,
    pipelineId: PIPELINE_ID,
    buildId: BUILD_ID,
    ...overrides,
  };
}

function createConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
  return {
    ...createMonitoringKey(),
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
    status: 'inProgress',
    sourceBranch: 'refs/heads/main',
    definition: {
      id: PIPELINE_ID,
      name: 'Deploy',
    },
    ...overrides,
  };
}

function createTimelineRecords(stageNames: string[] = ['Prod']): AdoTimelineRecord[] {
  return stageNames.map((name, index) => ({
    id: `stage-${index + 1}`,
    name,
    type: 'Stage',
    state: 'pending',
    order: index + 1,
  }));
}

function buildUrl(buildId = BUILD_ID, org = 'my-org', project = PROJECT): string {
  return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_build/results?buildId=${buildId}`;
}

function renderPopupDom(): void {
  const popupHtmlPath = join(__dirname, 'popup.html');
  document.documentElement.innerHTML = readFileSync(popupHtmlPath, 'utf8');
}

async function flushPromises(times = 8): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

async function clickAndFlush(button: HTMLButtonElement): Promise<void> {
  button.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  await flushPromises(20);
}

async function loadPopup(options: {
  build?: AdoBuild;
  records?: AdoTimelineRecord[];
  setupStorage?: (storage: typeof import('../utils/storage')) => Promise<void>;
  tabUrl?: string;
} = {}) {
  jest.resetModules();
  renderPopupDom();

  const adoClientCtor = jest.fn().mockImplementation(function mockAdoClient(this: { orgUrl: string; pat: string }, orgUrl: string, pat: string) {
    this.orgUrl = orgUrl;
    this.pat = pat;
  });
  const getBuild = jest.fn().mockResolvedValue(options.build ?? createBuild());
  const getTimeline = jest.fn().mockResolvedValue(options.records ?? createTimelineRecords());

  jest.doMock('../api/ado-client', () => ({ AdoClient: adoClientCtor }));
  jest.doMock('../api/pipelines', () => ({ getBuild, getTimeline }));

  const storage = await import('../utils/storage');
  if (options.setupStorage) {
    await options.setupStorage(storage);
  }
  (chrome.tabs.query as jest.Mock).mockResolvedValue(
    options.tabUrl === undefined ? [] : ([{ id: 1, url: options.tabUrl }] as chrome.tabs.Tab[])
  );
  (chrome.runtime.sendMessage as jest.Mock).mockResolvedValue({ ok: true });

  const popup = await import('./popup');
  await popup.init();
  await flushPromises(20);

  return { storage, adoClientCtor, getBuild, getTimeline };
}

describe('popup', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    Object.defineProperty(globalThis, 'alert', {
      configurable: true,
      writable: true,
      value: jest.fn(),
    });
  });

  afterEach(() => {
    window.dispatchEvent(new Event('unload'));
  });

  it('loads the shipped popup template copy', async () => {
    await loadPopup();

    expect(document.querySelector('.section-label')?.textContent).toBe('Monitored builds');
  });

  it('renders State A for an exact monitored build match', async () => {
    const { adoClientCtor } = await loadPopup({
      tabUrl: buildUrl(),
      build: createBuild({ definition: { id: PIPELINE_ID, name: 'Exact Deploy' } }),
      setupStorage: async (storage) => {
        await storage.saveCredentials(CONFIGURED_ORG_URL, 'secret');
        await storage.setPipelineConfigs([
          createConfig({
            buildId: BUILD_ID + 1,
            stages: [{ stageName: 'Wrong Build', notifyOnComplete: true, notifyOnApprovalNeeded: true }],
          }),
          createConfig({
            buildId: BUILD_ID,
            pipelineName: 'Exact Deploy',
            stages: [{ stageName: 'Prod', notifyOnComplete: true, notifyOnApprovalNeeded: true }],
          }),
        ]);
      },
    });

    expect(adoClientCtor).toHaveBeenCalledWith(CONFIGURED_ORG_URL, 'secret');
    expect(document.getElementById('ctx-pipeline-header')?.textContent).toContain('✅ Monitoring active');
    expect(document.getElementById('ctx-body')?.textContent).toContain('Exact Deploy');
    expect(document.getElementById('ctx-body')?.textContent).toContain('Watching: Prod');
    expect(document.getElementById('ctx-body')?.textContent).not.toContain('Wrong Build');
  });

  it('renders State B only for the exact dismissed build identity', async () => {
    await loadPopup({
      tabUrl: buildUrl(),
      build: createBuild({ definition: { id: PIPELINE_ID, name: 'Deploy' } }),
      setupStorage: async (storage) => {
        await storage.saveCredentials(CONFIGURED_ORG_URL, 'secret');
        await storage.setPipelineConfigs([
          createConfig({
            buildId: BUILD_ID + 1,
            pipelineName: 'Another Build',
          }),
        ]);
        await storage.dismissBuild(createMonitoringKey({ buildId: BUILD_ID }));
      },
    });

    expect(document.getElementById('ctx-pipeline-header')?.textContent).toContain('🚫 Not monitoring this build');
    expect(document.getElementById('ctx-body')?.textContent).toContain(`Build #${BUILD_ID}`);
    expect(document.getElementById('ctx-body')?.textContent).toContain('Monitor this build');
  });

  it('renders State C when only near-miss identities exist', async () => {
    await loadPopup({
      tabUrl: buildUrl(),
      build: createBuild({ definition: { id: PIPELINE_ID, name: 'Fresh Deploy' }, sourceBranch: 'refs/heads/release/main' }),
      records: createTimelineRecords(['Stage 1', 'Stage 2']),
      setupStorage: async (storage) => {
        await storage.saveCredentials(CONFIGURED_ORG_URL, 'secret');
        await storage.setPipelineConfigs([
          createConfig({ buildId: BUILD_ID + 1, pipelineName: 'Different Build' }),
          createConfig({ org: 'other-org', buildId: BUILD_ID, pipelineName: 'Different Org' }),
        ]);
        await storage.dismissBuild(createMonitoringKey({ buildId: BUILD_ID + 2 }));
      },
    });

    expect(document.getElementById('ctx-pipeline-header')?.textContent).toContain('Fresh Deploy');
    expect(document.getElementById('ctx-pipeline-header')?.textContent).toContain('Branch: release/main');
    expect(document.getElementById('ctx-body')?.textContent).toContain('Select stages to monitor:');
    expect(document.getElementById('ctx-body')?.textContent).toContain("Don't monitor this build");
    expect(document.getElementById('ctx-body')?.textContent).not.toContain('✅ Monitoring active');
  });

  it('blocks same-PAT reuse on the wrong org before constructing an ADO client or fetching', async () => {
    const { adoClientCtor, getBuild, getTimeline } = await loadPopup({
      tabUrl: buildUrl(BUILD_ID, 'other-org'),
      setupStorage: async (storage) => {
        await storage.saveCredentials(CONFIGURED_ORG_URL, 'secret');
      },
    });

    expect(adoClientCtor).not.toHaveBeenCalled();
    expect(getBuild).not.toHaveBeenCalled();
    expect(getTimeline).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(document.getElementById('ctx-pipeline-header')?.textContent).toContain('🚫 Wrong Azure DevOps org');
    expect(document.getElementById('ctx-body')?.textContent).toContain('This page belongs to org other-org');
    expect(document.getElementById('ctx-body')?.textContent).toContain('configured for my-org');
  });

  it('removes a monitored item from the saved list with the exact build identity', async () => {
    const { storage } = await loadPopup({
      setupStorage: async (storage) => {
        await storage.saveCredentials(CONFIGURED_ORG_URL, 'secret');
        await storage.setPipelineConfigs([
          createConfig({ pipelineName: 'Keep Me', buildId: BUILD_ID + 1 }),
          createConfig({ pipelineName: 'Remove Me', buildId: BUILD_ID }),
        ]);
      },
    });

    const removeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.remove-btn'));
    const removeMeButton = removeButtons.find(button =>
      button.parentElement?.textContent?.includes('Remove Me')
    );

    expect(removeMeButton).toBeDefined();
    await clickAndFlush(removeMeButton!);

    await expect(storage.getPipelineConfigs()).resolves.toEqual([
      expect.objectContaining({ pipelineName: 'Keep Me', buildId: BUILD_ID + 1 }),
    ]);
    expect(document.getElementById('pipeline-list')?.textContent).toContain('Keep Me');
    expect(document.getElementById('pipeline-list')?.textContent).not.toContain('Remove Me');
  });

  it('stops monitoring the active build and persists the exact state change back to the picker', async () => {
    const { storage } = await loadPopup({
      tabUrl: buildUrl(),
      build: createBuild({ definition: { id: PIPELINE_ID, name: 'Deploy' } }),
      records: createTimelineRecords(['Prod', 'QA']),
      setupStorage: async (storage) => {
        await storage.saveCredentials(CONFIGURED_ORG_URL, 'secret');
        await storage.setPipelineConfigs([createConfig({ pipelineName: 'Deploy' })]);
      },
    });

    const stopButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button =>
      button.textContent === 'Stop Monitoring'
    );

    expect(stopButton).toBeDefined();
    await clickAndFlush(stopButton!);

    await expect(storage.getPipelineConfigs()).resolves.toEqual([]);
    expect(document.getElementById('ctx-pipeline-header')?.textContent).toContain('Deploy');
    expect(document.getElementById('ctx-body')?.textContent).toContain('Select stages to monitor:');
    expect(document.getElementById('ctx-body')?.textContent).toContain('Start Monitoring');
  });

  it('renders hostile strings literally without creating executable DOM', async () => {
    const hostilePipeline = '<script>alert(1)</script> "deploy" <tag>';
    const hostileStage = '<img src=x onerror=alert(1)>';
    const quotedStage = `qa <angle> "quotes" 'single'`;

    await loadPopup({
      tabUrl: buildUrl(BUILD_ID + 1),
      build: createBuild({
        id: BUILD_ID + 1,
        definition: { id: PIPELINE_ID, name: hostilePipeline },
        sourceBranch: `refs/heads/${quotedStage}`,
      }),
      records: createTimelineRecords([hostileStage, quotedStage]),
      setupStorage: async (storage) => {
        await storage.saveCredentials(CONFIGURED_ORG_URL, 'secret');
        await storage.setPipelineConfigs([
          createConfig({
            pipelineName: hostilePipeline,
            stages: [
              { stageName: hostileStage, notifyOnComplete: true, notifyOnApprovalNeeded: true },
              { stageName: quotedStage, notifyOnComplete: true, notifyOnApprovalNeeded: true },
            ],
          }),
        ]);
      },
    });

    const monitoredText = document.getElementById('pipeline-list')?.textContent ?? '';
    const contextText = document.getElementById('context-monitor')?.textContent ?? '';

    expect(monitoredText).toContain(hostilePipeline);
    expect(monitoredText).toContain(hostileStage);
    expect(monitoredText).toContain(quotedStage);
    expect(contextText).toContain(hostilePipeline);
    expect(contextText).toContain(`Branch: ${quotedStage}`);
    expect(contextText).toContain(hostileStage);
    expect(contextText).toContain(quotedStage);
    expect(document.getElementById('context-monitor')?.querySelector('script')).toBeNull();
    expect(document.getElementById('context-monitor')?.querySelector('img')).toBeNull();
    expect(document.getElementById('pipeline-list')?.querySelector('script')).toBeNull();
    expect(document.getElementById('pipeline-list')?.querySelector('img')).toBeNull();
    expect(document.querySelectorAll('[onerror]')).toHaveLength(0);
    expect(globalThis.alert).not.toHaveBeenCalled();
  });
});
