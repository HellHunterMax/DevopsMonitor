import type { AdoApproval } from '../types/ado';
import { AdoClient } from './ado-client';

export async function getPendingApprovals(client: AdoClient, project: string): Promise<AdoApproval[]> {
  try {
    const data = await client.get<{ value: AdoApproval[] }>(
      `${client.orgUrl}/${project}/_apis/pipelines/approvals?state=pending&api-version=7.1-preview.1`
    );
    return data.value ?? [];
  } catch {
    // Approvals API may not be available on all ADO versions — fail silently
    return [];
  }
}
