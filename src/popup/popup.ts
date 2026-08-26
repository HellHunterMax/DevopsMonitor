import {
  getCredentials,
  getPipelineConfigs,
  setPipelineConfigs,
  getBuildSnapshots,
  getDismissedBuilds,
  dismissBuild,
  undismissBuild,
} from '../utils/storage';
import { AdoClient } from '../api/ado-client';
import { getTimeline, getBuild } from '../api/pipelines';
import { parseAdoBuildUrl } from '../utils/url-builder';
import type { PipelineConfig, StageConfig, BuildSnapshot } from '../types/ado';

function setStatus(msg: string, type: 'info' | 'error' | 'success' = 'info'): void {
  const el = document.getElementById('status')!;
  el.textContent = msg;
  el.className = `status ${type === 'info' ? '' : type}`;
}

function show(id: string): void { document.getElementById(id)?.classList.remove('hidden'); }

function renderMonitoredList(configs: PipelineConfig[], snapshots: BuildSnapshot[]): void {
  const container = document.getElementById('pipeline-list')!;
  container.innerHTML = '';
  if (configs.length === 0) {
    container.innerHTML = '<p style="color:#999;font-size:12px;">Open a pipeline build page in Azure DevOps to add monitoring.</p>';
    return;
  }
  for (const config of configs) {
    const snapshot = snapshots.find(s => s.pipelineId === config.pipelineId);
    const watchedStages = config.stages.map(s => s.stageName).join(', ');
    const buildInfo = snapshot ? `Build #${snapshot.buildId}` : 'No build tracked yet';
    const item = document.createElement('div');
    item.className = 'pipeline-item';
    item.innerHTML = `
      <div>
        <div class="pipeline-name">${config.pipelineName}</div>
        <div class="stage-status">${config.project} · ${buildInfo}</div>
        <div class="stage-status">Watching: ${watchedStages || 'none'}</div>
      </div>
      <button class="remove-btn" data-id="${config.pipelineId}" title="Stop monitoring">&#x2715;</button>
    `;
    container.appendChild(item);
  }
  container.querySelectorAll<HTMLElement>('.remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const all = await getPipelineConfigs();
      await setPipelineConfigs(all.filter(c => c.pipelineId !== id));
      await renderAll();
    });
  });
}

async function renderAll(): Promise<void> {
  const [configs, snapshots] = await Promise.all([
    getPipelineConfigs(),
    getBuildSnapshots(),
  ]);
  renderMonitoredList(configs, snapshots);
  show('monitored');
}

// Renders State A: already monitoring this pipeline
function renderStateA(
  pipelineName: string,
  project: string,
  pipelineId: number,
  stages: StageConfig[],
  onStop: () => void
): void {
  const header = document.getElementById('ctx-pipeline-header')!;
  header.innerHTML = `<div class="ctx-pipeline-name">&#x2705; Monitoring active</div>`;

  const body = document.getElementById('ctx-body')!;
  const watchedStages = stages.map(s => s.stageName).join(', ');
  body.innerHTML = `
    <div class="ctx-already"><strong>${pipelineName}</strong> &middot; ${project}</div>
    <div class="ctx-watching">Watching: ${watchedStages || 'none'}</div>
  `;

  const stopBtn = document.createElement('button');
  stopBtn.className = 'btn-secondary';
  stopBtn.textContent = 'Stop Monitoring';
  stopBtn.addEventListener('click', onStop);
  body.appendChild(stopBtn);
}

// Renders State B: build dismissed
function renderStateB(
  pipelineName: string,
  buildId: number,
  onMonitor: () => void
): void {
  const header = document.getElementById('ctx-pipeline-header')!;
  header.innerHTML = `<div class="ctx-pipeline-name">&#x1F6AB; Not monitoring this build</div>`;

  const body = document.getElementById('ctx-body')!;
  body.innerHTML = `
    <div class="ctx-already"><strong>${pipelineName}</strong> &middot; Build #${buildId}</div>
  `;

  const monitorBtn = document.createElement('button');
  monitorBtn.textContent = 'Monitor this build';
  monitorBtn.addEventListener('click', async () => {
    await undismissBuild(buildId);
    onMonitor();
  });
  body.appendChild(monitorBtn);
}

// Renders State C: stage picker
function renderStateC(
  pipelineName: string,
  branch: string,
  stages: string[],
  buildId: number,
  onSave: (selectedStages: string[]) => void
): void {
  const header = document.getElementById('ctx-pipeline-header')!;
  header.innerHTML = `
    <div class="ctx-pipeline-name">${pipelineName}</div>
    <div class="ctx-branch">Branch: ${branch}</div>
  `;

  const body = document.getElementById('ctx-body')!;
  body.innerHTML = '<p class="section-label" style="margin-top:8px;">Select stages to monitor:</p>';

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
    await dismissBuild(buildId);
    window.close();
  });
  body.appendChild(dismissBtn);
}

async function initContextFlow(pat: string): Promise<boolean> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabUrl = tabs[0]?.url ?? '';
  const ctx = parseAdoBuildUrl(tabUrl);
  if (!ctx) return false;

  console.log('[DevOps Notifier] Detected ADO build page:', ctx);

  // Use orgUrl from the tab URL + stored PAT — avoids stored orgUrl mismatch
  const client = new AdoClient(ctx.orgUrl, pat);

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

    const [allConfigs, dismissedBuilds] = await Promise.all([
      getPipelineConfigs(),
      getDismissedBuilds(),
    ]);

    const existing = allConfigs.find(c => c.pipelineId === pipelineId && c.project === ctx.project);
    const isDismissed = dismissedBuilds.includes(ctx.buildId);

    show('context-monitor');
    setStatus('');

    if (existing) {
      // State A: already monitoring
      renderStateA(pipelineName, ctx.project, pipelineId, existing.stages, async () => {
        const configs = await getPipelineConfigs();
        await setPipelineConfigs(configs.filter(c => !(c.pipelineId === pipelineId && c.project === ctx.project)));
        await renderAll();
        renderStateC(pipelineName, branch, stages, ctx.buildId, saveAndShowStateA);
      });
    } else if (isDismissed) {
      // State B: dismissed
      renderStateB(pipelineName, ctx.buildId, () => {
        renderStateC(pipelineName, branch, stages, ctx.buildId, saveAndShowStateA);
      });
    } else {
      // State C: picker
      renderStateC(pipelineName, branch, stages, ctx.buildId, saveAndShowStateA);
    }

    async function saveAndShowStateA(selectedStages: string[]): Promise<void> {
      const stageConfigs: StageConfig[] = selectedStages.map(stageName => ({
        stageName,
        notifyOnComplete: true,
        notifyOnApprovalNeeded: true,
      }));
      const newConfig: PipelineConfig = {
        org: ctx!.org,
        project: ctx!.project,
        pipelineId,
        pipelineName,
        stages: stageConfigs,
      };
      const configs = await getPipelineConfigs();
      const idx = configs.findIndex(c => c.pipelineId === pipelineId && c.project === ctx!.project);
      if (idx >= 0) configs[idx] = newConfig;
      else configs.push(newConfig);
      await setPipelineConfigs(configs);
      renderStateA(pipelineName, ctx!.project, pipelineId, stageConfigs, async () => {
        const refreshed = await getPipelineConfigs();
        await setPipelineConfigs(refreshed.filter(c => !(c.pipelineId === pipelineId && c.project === ctx!.project)));
        await renderAll();
        renderStateC(pipelineName, branch, stages, ctx!.buildId, saveAndShowStateA);
      });
      await renderAll();
    }

    return true;
  } catch (err) {
    console.error('[DevOps Notifier] Context flow error:', err);
    return false;
  }
}

async function init(): Promise<void> {
  const creds = await getCredentials();
  if (!creds) {
    show('no-credentials');
    document.getElementById('open-options-btn')?.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  await renderAll();

  const handled = await initContextFlow(creds.pat);
  if (!handled) {
    setStatus('');
  }
}

document.addEventListener('DOMContentLoaded', init);
