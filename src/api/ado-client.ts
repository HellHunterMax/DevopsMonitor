import { getCredentials } from '../utils/storage';

export class AdoClient {
  constructor(
    public readonly orgUrl: string,
    private readonly pat: string
  ) {}

  private authHeader(): Record<string, string> {
    return { Authorization: 'Basic ' + btoa(':' + this.pat) };
  }

  async get<T>(url: string): Promise<T> {
    const response = await fetch(url, { headers: this.authHeader() });
    if (!response.ok) {
      throw new Error(`ADO API error ${response.status}: ${response.statusText} — ${url}`);
    }
    return response.json() as Promise<T>;
  }
}

export async function createClient(): Promise<AdoClient | null> {
  const creds = await getCredentials();
  if (!creds) return null;
  return new AdoClient(creds.orgUrl, creds.pat);
}
