export const RUNNER_BROWSER_VAULT_REFRESH_SOURCE_STATE_HASH_HEADER =
  "x-hosted-browser-vault-refresh-source-state-hash";

export const RUNNER_BROWSER_VAULT_REFRESH_LEASE_GENERATION = "0";

export function buildRunnerBrowserVaultRefreshAttemptId(sourceStateHash: string): string {
  return `browser-vault-refresh:${sourceStateHash}`;
}

export function writeRunnerBrowserVaultRefreshHeaders(
  headers: Headers,
  input: {
    sourceStateHash: string;
  },
): void {
  headers.set(RUNNER_BROWSER_VAULT_REFRESH_SOURCE_STATE_HASH_HEADER, input.sourceStateHash);
}

export function readRunnerBrowserVaultRefreshSourceStateHash(request: Request): string | null {
  const value = request.headers.get(RUNNER_BROWSER_VAULT_REFRESH_SOURCE_STATE_HASH_HEADER);
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
