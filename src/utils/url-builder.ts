export function buildBuildUrl(orgUrl: string, project: string, buildId: number): string {
  return `${orgUrl.replace(/\/+$/, '')}/${encodeURIComponent(project)}/_build/results?buildId=${buildId}`;
}

export interface AdoBuildPageContext {
  orgUrl: string;
  org: string;
  project: string;
  buildId: number;
}

export function parseAdoBuildUrl(url: string): AdoBuildPageContext | null {
  try {
    const u = new URL(url);
    if (u.hostname !== 'dev.azure.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    // parts: [org, project, '_build', 'results']
    if (parts.length < 4 || parts[2] !== '_build') return null;
    const buildId = parseInt(u.searchParams.get('buildId') ?? '', 10);
    if (isNaN(buildId)) return null;
    const org = decodeURIComponent(parts[0]);
    const project = decodeURIComponent(parts[1]);
    return {
      orgUrl: `https://dev.azure.com/${org}`,
      org,
      project,
      buildId,
    };
  } catch {
    return null;
  }
}
