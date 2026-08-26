import { getCredentials, saveCredentials } from '../utils/storage';
import { AdoClient } from '../api/ado-client';
import type { AdoListResponse, AdoProject } from '../types/ado';

function getEl<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function showResult(message: string, type: 'success' | 'error'): void {
  const resultEl = getEl<HTMLDivElement>('result');
  resultEl.textContent = message;
  resultEl.className = type;
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
});
