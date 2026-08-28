import type { AdoApproval } from '../types/ado';
import { AdoClient } from './ado-client';

export async function getPendingApprovals(client: AdoClient, project: string): Promise<AdoApproval[]> {
  try {
    const data = await client.get<{ value: AdoApproval[] }>(
      `${client.orgUrl}/${project}/_apis/pipelines/approvals?status=pending&api-version=7.1-preview.1`
    );
    const results = data.value ?? [];
    console.log(`[DevOps Notifier] getPendingApprovals: ${results.length} pending approvals for project "${project}"`);
    if (results.length > 0) {
      console.log('[DevOps Notifier] Approval objects:', JSON.stringify(results, null, 2));
    }
    return results;
  } catch (err) {
    // Approvals API may not be available on all ADO versions — fail silently
    console.warn('[DevOps Notifier] getPendingApprovals failed (ignored):', err);
    return [];
  }
}
