import { buildBuildUrl, parseAdoBuildUrl } from './url-builder';

describe('url-builder', () => {
  it('builds a valid Azure DevOps build URL', () => {
    expect(buildBuildUrl('https://dev.azure.com/my-org', 'My Project', 42))
      .toBe('https://dev.azure.com/my-org/My%20Project/_build/results?buildId=42');
  });

  it('parses encoded org and project names', () => {
    expect(
      parseAdoBuildUrl('https://dev.azure.com/My%20Org/My%20Project/_build/results?buildId=42')
    ).toEqual({
      orgUrl: 'https://dev.azure.com/My Org',
      org: 'My Org',
      project: 'My Project',
      buildId: 42,
    });
  });

  it('returns null for non-Azure DevOps URLs', () => {
    expect(parseAdoBuildUrl('https://example.com/project/_build/results?buildId=42')).toBeNull();
  });

  it('returns null when buildId is missing or invalid', () => {
    expect(parseAdoBuildUrl('https://dev.azure.com/my-org/my-project/_build/results')).toBeNull();
    expect(
      parseAdoBuildUrl('https://dev.azure.com/my-org/my-project/_build/results?buildId=nope')
    ).toBeNull();
  });
});
