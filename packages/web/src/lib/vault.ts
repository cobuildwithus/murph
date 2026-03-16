import path from "node:path";

export const HEALTHYBOB_VAULT_ENV = "HEALTHYBOB_VAULT";
export const FIXTURE_VAULT_EXAMPLE = "../../fixtures/minimal-vault";

export function getConfiguredVaultRoot(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): string | null {
  const configured = env[HEALTHYBOB_VAULT_ENV];
  if (typeof configured !== "string") {
    return null;
  }

  const trimmed = configured.trim();
  if (!trimmed) {
    return null;
  }

  return path.resolve(cwd, trimmed);
}

export function buildSuggestedCommand(): string {
  return `${HEALTHYBOB_VAULT_ENV}=${FIXTURE_VAULT_EXAMPLE} pnpm dev`;
}
