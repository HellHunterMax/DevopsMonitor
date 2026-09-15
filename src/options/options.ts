import {
  getCredentials,
  saveCredentials,
  getPipelineConfigs,
  setPipelineConfigs,
  getBuildSnapshots,
  setBuildSnapshots,
  getDismissedBuilds,
  undismissBuild,
} from '../utils/storage';
import { AdoClient } from '../api/ado-client';
import { monitoringKeyToString, type AdoListResponse, type AdoProject } from '../types/ado';
import { runStaleDataPrune } from '../background/state';

const MONITORING_STORAGE_KEYS = new Set([
  'pipeline_configs',
  'build_snapshots',
  'dismissed_builds',
  'last_polled_at',
]);

function getEl<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function showResult(message: string, type: 'success' | 'error'): void {
  const resultEl = getEl<HTMLDivElement>('result');
  resultEl.textContent = message;
  resultEl.className = type;
}

async function renderStorageOverview(): Promise<void> {
  const [creds, pipelines, snapshots, dismissed] = await Promise.all([
    getCredentials(),
    getPipelineConfigs(),
    getBuildSnapshots(),
    getDismissedBuilds(),
  ]);

  // ── Credentials row ────────────────────────────────────────────────────────
  const credBody = getEl<HTMLElement>('storage-creds-body');
  credBody.innerHTML = '';
  if (creds) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>Organization URL</td>
      <td class="mono">${escHtml(creds.orgUrl)}</td>
      <td></td>
    `;
    credBody.appendChild(tr);
    const tr2 = document.createElement('tr');
    tr2.innerHTML = `
      <td>PAT</td>
      <td class="mono">••••••••••••••••</td>
      <td></td>
    `;
    credBody.appendChild(tr2);
  } else {
    credBody.innerHTML = '<tr><td colspan="3" class="empty-row">No credentials saved</td></tr>';
  }

  // ── Pipelines ──────────────────────────────────────────────────────────────
  const pipBody = getEl<HTMLElement>('storage-pipelines-body');
  pipBody.innerHTML = '';
  if (pipelines.length === 0) {
    pipBody.innerHTML = '<tr><td colspan="3" class="empty-row">No builds monitored</td></tr>';
  } else {
    for (const p of pipelines) {
      const tr = document.createElement('tr');
      const key = encodeURIComponent(monitoringKeyToString(p));
      tr.innerHTML = `
        <td>${escHtml(p.pipelineName)}</td>
        <td class="mono">${escHtml(p.org)} · ${escHtml(p.project)} · #${p.pipelineId} · build ${p.buildId}</td>
        <td>
          <button class="tbl-del-btn" data-type="pipeline" data-key="${key}" title="Remove">✕</button>
        </td>
      `;
      pipBody.appendChild(tr);
    }
  }

  // ── Snapshots ──────────────────────────────────────────────────────────────
  const snapBody = getEl<HTMLElement>('storage-snapshots-body');
  snapBody.innerHTML = '';
  if (snapshots.length === 0) {
    snapBody.innerHTML = '<tr><td colspan="3" class="empty-row">No snapshots stored</td></tr>';
  } else {
    for (const s of snapshots) {
      const stageNames = Object.keys(s.stages).join(', ') || '—';
      const tr = document.createElement('tr');
      const key = encodeURIComponent(monitoringKeyToString(s));
      tr.innerHTML = `
        <td>${escHtml(s.org)} · ${escHtml(s.project)} · Pipeline ${s.pipelineId}</td>
        <td class="mono">Build #${s.buildId} · ${escHtml(stageNames)}</td>
        <td>
          <button class="tbl-del-btn" data-type="snapshot" data-key="${key}" title="Remove">✕</button>
        </td>
      `;
      snapBody.appendChild(tr);
    }
  }

  // ── Dismissed builds ──────────────────────────────────────────────────────
  const dismBody = getEl<HTMLElement>('storage-dismissed-body');
  dismBody.innerHTML = '';
  if (dismissed.length === 0) {
    dismBody.innerHTML = '<tr><td colspan="2" class="empty-row">No dismissed builds</td></tr>';
  } else {
    for (const key of dismissed) {
      const tr = document.createElement('tr');
      const serializedKey = encodeURIComponent(monitoringKeyToString(key));
      tr.innerHTML = `
        <td class="mono">${escHtml(key.org)} · ${escHtml(key.project)} · #${key.pipelineId} · build ${key.buildId}</td>
        <td>
          <button class="tbl-del-btn" data-type="dismissed" data-key="${serializedKey}" title="Remove">✕</button>
        </td>
      `;
      dismBody.appendChild(tr);
    }
  }

  // Wire row-level delete buttons
  document.querySelectorAll<HTMLButtonElement>('.tbl-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const type = btn.dataset.type;
      if (type === 'pipeline') {
        const key = decodeURIComponent(btn.dataset.key ?? '');
        const all = await getPipelineConfigs();
        await setPipelineConfigs(all.filter(p => monitoringKeyToString(p) !== key));
      } else if (type === 'snapshot') {
        const key = decodeURIComponent(btn.dataset.key ?? '');
        const all = await getBuildSnapshots();
        await setBuildSnapshots(all.filter(s => monitoringKeyToString(s) !== key));
      } else if (type === 'dismissed') {
        const key = decodeURIComponent(btn.dataset.key ?? '');
        const all = await getDismissedBuilds();
        const dismissed = all.find(item => monitoringKeyToString(item) === key);
        if (dismissed) {
          await undismissBuild(dismissed);
        }
      }
      await renderStorageOverview();
    });
  });
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', async () => {
  const orgUrlInput = getEl<HTMLInputElement>('org-url');
  const patInput = getEl<HTMLInputElement>('pat');
  const testBtn = getEl<HTMLButtonElement>('test-btn');
  const form = getEl<HTMLFormElement>('options-form');

  const saved = await getCredentials();
  if (saved) {
    orgUrlInput.value = saved.orgUrl;
    patInput.value = saved.pat;
  }

  const refreshOnStorageChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void => {
    if (areaName === 'local' && Object.keys(changes).some(key => MONITORING_STORAGE_KEYS.has(key))) {
      void renderStorageOverview();
    }
  };
  chrome.storage.onChanged.addListener(refreshOnStorageChange);
  window.addEventListener('unload', () => chrome.storage.onChanged.removeListener(refreshOnStorageChange));

  testBtn.addEventListener('click', async () => {
    const orgUrl = orgUrlInput.value.trim();
    const pat = patInput.value.trim();
    if (!orgUrl || !pat) {
      showResult('Please enter both Organization URL and PAT before testing.', 'error');
      return;
    }
    testBtn.disabled = true;
    testBtn.textContent = 'Testing…';
    try {
      const client = new AdoClient(orgUrl, pat);
      const data = await client.get<AdoListResponse<AdoProject>>(`${orgUrl}/_apis/projects?api-version=7.1`);
      const projects = data.value;
      showResult(`✓ Connected — found ${projects.length} projects. Required PAT scopes: Build (read), Environments (read)`, 'success');
    } catch (err) {
      showResult(`❌ Connection failed: ${(err as Error).message}`, 'error');
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = 'Test Connection';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const orgUrl = orgUrlInput.value.trim();
    const pat = patInput.value.trim();
    if (!orgUrl || !pat) {
      showResult('Both fields are required.', 'error');
      return;
    }
    await saveCredentials(orgUrl, pat);
    showResult('✅ Credentials saved successfully.', 'success');
  });

  getEl<HTMLButtonElement>('test-notif-btn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'TEST_NOTIFICATION' });
    showResult('📬 Test notification sent — check your Windows notification area.', 'success');
  });

  // ── Storage Overview ────────────────────────────────────────────────────────
  await runStaleDataPrune();
  await renderStorageOverview();

  getEl<HTMLButtonElement>('clear-credentials-btn').addEventListener('click', async () => {
    if (!confirm('Delete saved credentials? You will need to re-enter them.')) return;
    await chrome.storage.local.remove(['ado_org_url', 'ado_pat']);
    orgUrlInput.value = '';
    patInput.value = '';
    showResult('Credentials cleared.', 'success');
    await renderStorageOverview();
  });

  getEl<HTMLButtonElement>('clear-pipelines-btn').addEventListener('click', async () => {
    if (!confirm('Remove all monitored builds?')) return;
    await setPipelineConfigs([]);
    await renderStorageOverview();
  });

  getEl<HTMLButtonElement>('clear-snapshots-btn').addEventListener('click', async () => {
    if (!confirm('Clear all build snapshots? This resets change-detection state.')) return;
    await setBuildSnapshots([]);
    await renderStorageOverview();
  });

  getEl<HTMLButtonElement>('clear-dismissed-btn').addEventListener('click', async () => {
    if (!confirm('Clear dismissed builds list?')) return;
    await chrome.storage.local.remove(['dismissed_builds']);
    await renderStorageOverview();
  });
});
