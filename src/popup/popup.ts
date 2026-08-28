import {
  getCredentials,
  getPipelineConfigs,
  setPipelineConfigs,
  getBuildSnapshots,
  getDismissedBuilds,
  dismissBuild,
  undismissBuild,
  getLastPolledAt,
  normalizeAdoOrgUrl,
  normalizeOrgSlug,
} from '../utils/storage';
import { AdoClient } from '../api/ado-client';
import { getTimeline, getBuild } from '../api/pipelines';
import { parseAdoBuildUrl } from '../utils/url-builder';
import { clearSnapshot } from '../background/state';
import {
  monitoringKeyEquals,
  type BuildSnapshot,
  type MonitoringKey,
  type PipelineConfig,
  type StageConfig,
} from '../types/ado';

function setStatus(msg: string, type: 'info' | 'error' | 'success' = 'info'): void {
  const el = document.getElementById('status')!;
  el.textContent = msg;
  el.className = `status ${type === 'info' ? '' : type}`;
}

function show(id: string): void { document.getElementById(id)?.classList.remove('hidden'); }

function clear(el: Element): void {
  el.replaceChildren();
}

function textEl<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className: string,
  text: string
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tagName);
  el.className = className;
  el.textContent = text;
  return el;
}

function buildMonitoringKey(config: PipelineConfig): MonitoringKey {
  return {
    org: config.org,
    project: config.project,
    pipelineId: config.pipelineId,
    buildId: config.buildId,
  };
}

function appendStrongLeadLine(
  container: HTMLElement,
  className: string,
  strongText: string,
  suffixText: string
): void {
  const line = document.createElement('div');
  line.className = className;

  const strong = document.createElement('strong');
  strong.textContent = strongText;

  line.append(strong, suffixText);
  container.appendChild(line);
}

function getOrgLabel(orgUrl: string): string {
  try {
    const org = new URL(orgUrl).pathname.split('/').filter(Boolean)[0];
    return org ? decodeURIComponent(org) : orgUrl;
  } catch {
    return orgUrl;
  }
}

function renderMonitoredList(configs: PipelineConfig[], snapshots: BuildSnapshot[]): void {
  const container = document.getElementById('pipeline-list')!;
  clear(container);

  if (configs.length === 0) {
    const empty = document.createElement('p');
    empty.style.color = '#999';
    empty.style.fontSize = '12px';
    empty.textContent = 'Open a pipeline build page in Azure DevOps to add monitoring.';
    container.appendChild(empty);
    return;
  }

  for (const config of configs) {
    const configKey = buildMonitoringKey(config);
    const snapshot = snapshots.find(s => monitoringKeyEquals(s, configKey));
    const watchedStages = config.stages.map(s => s.stageName).join(', ');
    const buildInfo = snapshot ? `Build #${snapshot.buildId}` : 'No build tracked yet';

    const item = document.createElement('div');
    item.className = 'pipeline-item';

    const details = document.createElement('div');
    details.append(
      textEl('div', 'pipeline-name', config.pipelineName),
      textEl('div', 'stage-status', `${config.project} · ${buildInfo}`),
      textEl('div', 'stage-status', `Watching: ${watchedStages || 'none'}`)
    );

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.title = 'Stop monitoring';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', async () => {
      const all = await getPipelineConfigs();
      await setPipelineConfigs(
        all.filter(c => !monitoringKeyEquals(c, configKey))
      );
      await renderAll();
    });

    item.append(details, removeBtn);
    container.appendChild(item);
  }
}

async function renderAll(): Promise<void> {
  const [configs, snapshots] = await Promise.all([
    getPipelineConfigs(),
    getBuildSnapshots(),
  ]);
  renderMonitoredList(configs, snapshots);
  show('monitored');
}

function renderContextMessage(title: string, message: string, detail?: string): void {
  const header = document.getElementById('ctx-pipeline-header')!;
  clear(header);
  header.appendChild(textEl('div', 'ctx-pipeline-name', title));

  const body = document.getElementById('ctx-body')!;
  clear(body);
  body.appendChild(textEl('div', 'ctx-already', message));

  if (detail) {
    body.appendChild(textEl('div', 'ctx-watching', detail));
  }
}

// Renders State A: already monitoring this build
function renderStateA(
  pipelineName: string,
  project: string,
  stages: StageConfig[],
  onStop: () => void
): void {
  const header = document.getElementById('ctx-pipeline-header')!;
  clear(header);
  header.appendChild(textEl('div', 'ctx-pipeline-name', '✅ Monitoring active'));

  const body = document.getElementById('ctx-body')!;
  clear(body);
  const watchedStages = stages.map(s => s.stageName).join(', ');

  appendStrongLeadLine(body, 'ctx-already', pipelineName, ` · ${project}`);
  body.appendChild(textEl('div', 'ctx-watching', `Watching: ${watchedStages || 'none'}`));

  const stopBtn = document.createElement('button');
  stopBtn.className = 'btn-secondary';
  stopBtn.textContent = 'Stop Monitoring';
  stopBtn.addEventListener('click', onStop);
  body.appendChild(stopBtn);
}

// Renders State B: build dismissed
function renderStateB(
  pipelineName: string,
  monitoringKey: MonitoringKey,
  onMonitor: () => void
): void {
  const header = document.getElementById('ctx-pipeline-header')!;
  clear(header);
  header.appendChild(textEl('div', 'ctx-pipeline-name', '🚫 Not monitoring this build'));

  const body = document.getElementById('ctx-body')!;
  clear(body);
  appendStrongLeadLine(body, 'ctx-already', pipelineName, ` · Build #${monitoringKey.buildId}`);

  const monitorBtn = document.createElement('button');
  monitorBtn.textContent = 'Monitor this build';
  monitorBtn.addEventListener('click', async () => {
    await undismissBuild(monitoringKey);
    onMonitor();
  });
  body.appendChild(monitorBtn);
}

// Renders State C: stage picker
function renderStateC(
  pipelineName: string,
  branch: string,
  stages: string[],
  monitoringKey: MonitoringKey,
  onSave: (selectedStages: string[]) => void
): void {
  const header = document.getElementById('ctx-pipeline-header')!;
  clear(header);
  header.append(
    textEl('div', 'ctx-pipeline-name', pipelineName),
    textEl('div', 'ctx-branch', `Branch: ${branch}`)
  );

  const body = document.getElementById('ctx-body')!;
  clear(body);

  const label = textEl('p', 'section-label', 'Select stages to monitor:');
  label.style.marginTop = '8px';
  body.appendChild(label);

  const pills = document.createElement('div');
  pills.className = 'stage-pills';
  const selected = new Set<string>();

  for (const stage of stages) {
    const pill = document.createElement('button');
    pill.className = 'stage-pill';
    pill.textContent = stage;
    pill.addEventListener('click', () => {
      if (selected.has(stage)) {
        selected.delete(stage);
        pill.classList.remove('selected');
      } else {
        selected.add(stage);
        pill.classList.add('selected');
      }
      startBtn.disabled = selected.size === 0;
    });
    pills.appendChild(pill);
  }
  body.appendChild(pills);

  const startBtn = document.createElement('button');
  startBtn.textContent = 'Start Monitoring';
  startBtn.disabled = true;
  startBtn.addEventListener('click', () => onSave(Array.from(selected)));
  body.appendChild(startBtn);

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'btn-secondary';
  dismissBtn.textContent = "Don't monitor this build";
  dismissBtn.addEventListener('click', async () => {
    await dismissBuild(monitoringKey);
    window.close();
  });
  body.appendChild(dismissBtn);
}

async function initContextFlow(credentials: { orgUrl: string; pat: string }): Promise<boolean> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabUrl = tabs[0]?.url ?? '';
  const ctx = parseAdoBuildUrl(tabUrl);
  if (!ctx) return false;

  console.log('[DevOps Notifier] Detected ADO build page:', ctx);

  const configuredOrgUrl = normalizeAdoOrgUrl(credentials.orgUrl);
  const activeOrgUrl = normalizeAdoOrgUrl(ctx.orgUrl);

  if (!configuredOrgUrl) {
    show('context-monitor');
    setStatus('');
    renderContextMessage(
      '🚫 Monitoring unavailable',
      'DevopsMonitor’s configured org URL is invalid.',
      'Open Options and save a valid Azure DevOps org before monitoring this build.'
    );
    return true;
  }

  if (!activeOrgUrl || configuredOrgUrl !== activeOrgUrl) {
    show('context-monitor');
    setStatus('');
    renderContextMessage(
      '🚫 Wrong Azure DevOps org',
      `This page belongs to org ${ctx.org}, but DevopsMonitor is configured for ${getOrgLabel(configuredOrgUrl)}.`,
      'Switch to the configured org or update Options.'
    );
    return true;
  }

  const client = new AdoClient(configuredOrgUrl, credentials.pat);

  setStatus('Loading build info...');
  try {
    const [build, records] = await Promise.all([
      getBuild(client, ctx.project, ctx.buildId),
      getTimeline(client, ctx.project, ctx.buildId),
    ]);

    const stages = records
      .filter(r => r.type === 'Stage')
      .sort((a, b) => a.order - b.order)
      .map(r => r.name);

    if (stages.length === 0) return false;

    const pipelineId = build.definition.id;
    const pipelineName = build.definition.name;
    const branch = build.sourceBranch.replace('refs/heads/', '');
    const monitoringKey: MonitoringKey = {
      org: normalizeOrgSlug(ctx.org),
      project: ctx.project,
      pipelineId,
      buildId: ctx.buildId,
    };

    const [allConfigs, dismissedBuilds] = await Promise.all([
      getPipelineConfigs(),
      getDismissedBuilds(),
    ]);

    const existing = allConfigs.find(config => monitoringKeyEquals(config, monitoringKey));
    const isDismissed = dismissedBuilds.some(key => monitoringKeyEquals(key, monitoringKey));

    show('context-monitor');
    setStatus('');

    if (existing) {
      // State A: already monitoring
      renderStateA(pipelineName, ctx.project, existing.stages, async () => {
        const configs = await getPipelineConfigs();
        await setPipelineConfigs(
          configs.filter(c => !monitoringKeyEquals(c, monitoringKey))
        );
        await renderAll();
        renderStateC(pipelineName, branch, stages, monitoringKey, saveAndShowStateA);
      });
    } else if (isDismissed) {
      // State B: dismissed
      renderStateB(pipelineName, monitoringKey, () => {
        renderStateC(pipelineName, branch, stages, monitoringKey, saveAndShowStateA);
      });
    } else {
      // State C: picker
      renderStateC(pipelineName, branch, stages, monitoringKey, saveAndShowStateA);
    }

    async function saveAndShowStateA(selectedStages: string[]): Promise<void> {
      const stageConfigs: StageConfig[] = selectedStages.map(stageName => ({
        stageName,
        notifyOnComplete: true,
        notifyOnApprovalNeeded: true,
      }));
      const newConfig: PipelineConfig = {
        ...monitoringKey,
        pipelineName,
        stages: stageConfigs,
      };
      const configs = await getPipelineConfigs();
      const idx = configs.findIndex(config => monitoringKeyEquals(config, monitoringKey));
      const previousConfig = idx >= 0 ? configs[idx] : null;
      if (idx >= 0) configs[idx] = newConfig;
      else configs.push(newConfig);
      await setPipelineConfigs(configs);
      // Clear any stale snapshot for this monitored build so the first poll on the new
      // build starts clean — prevents old approvalPending state suppressing notifications.
      await clearSnapshot(previousConfig ?? monitoringKey);
      renderStateA(pipelineName, ctx!.project, stageConfigs, async () => {
        const refreshed = await getPipelineConfigs();
        await setPipelineConfigs(
          refreshed.filter(c => !monitoringKeyEquals(c, monitoringKey))
        );
        await renderAll();
        renderStateC(pipelineName, branch, stages, monitoringKey, saveAndShowStateA);
      });
      await renderAll();
    }

    return true;
  } catch (err) {
    console.error('[DevOps Notifier] Context flow error:', err);
    return false;
  }
}

export async function init(): Promise<void> {
  // Wire gear icon regardless of credentials state
  document.getElementById('options-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  const creds = await getCredentials();
  if (!creds) {
    show('no-credentials');
    document.getElementById('open-options-btn')?.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  await renderAll();
  await initPollStatusBar();

  const handled = await initContextFlow(creds);
  if (!handled) {
    setStatus('');
  }
}

document.addEventListener('DOMContentLoaded', init);

// ---------------------------------------------------------------------------
// Poll status bar
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 30_000; // matches the 0.5-minute alarm in service-worker.ts

function formatSecondsAgo(ms: number): string {
  const secs = Math.floor((Date.now() - ms) / 1000);
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s ago`;
}

function updatePollStatusBar(lastPolledAt: number | null): void {
  const lastEl = document.getElementById('poll-last')!;
  const nextEl = document.getElementById('poll-next')!;

  if (!lastPolledAt) {
    lastEl.textContent = 'Last polled: never';
    nextEl.textContent = 'Next: —';
    return;
  }

  lastEl.textContent = `Last polled: ${formatSecondsAgo(lastPolledAt)}`;
  const msSinceLast = Date.now() - lastPolledAt;
  const msUntilNext = Math.max(0, POLL_INTERVAL_MS - msSinceLast);
  const secsUntilNext = Math.ceil(msUntilNext / 1000);
  nextEl.textContent = secsUntilNext <= 0 ? 'Next: any moment' : `Next: ~${secsUntilNext}s`;
}

async function initPollStatusBar(): Promise<void> {
  const bar = document.getElementById('poll-status-bar')!;
  bar.classList.remove('hidden');

  let lastPolledAt = await getLastPolledAt();
  updatePollStatusBar(lastPolledAt);

  // Tick every second
  const timer = setInterval(async () => {
    lastPolledAt = await getLastPolledAt();
    updatePollStatusBar(lastPolledAt);
  }, 1000);

  // Clean up on popup close
  window.addEventListener('unload', () => clearInterval(timer));

  // Poll Now button
  const btn = document.getElementById('poll-now-btn') as HTMLButtonElement;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Polling…';
    try {
      await chrome.runtime.sendMessage({ type: 'FORCE_POLL' });
      lastPolledAt = await getLastPolledAt();
      updatePollStatusBar(lastPolledAt);
      await renderAll();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Poll Now';
    }
  });
}