import path from "node:path";

export const HEALTHYBOB_VAULT_ENV = "HEALTHYBOB_VAULT";
export const HEALTHYBOB_WEB_LAUNCH_CWD_ENV = "HEALTHYBOB_WEB_LAUNCH_CWD";
export const FIXTURE_VAULT_EXAMPLE = "../../fixtures/demo-web-vault";

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

  return path.resolve(getLaunchCwd(env, cwd), trimmed);
}

export function buildExampleVaultPath(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): string {
  const fixturePath = path.resolve(cwd, FIXTURE_VAULT_EXAMPLE);
  const relativePath = path.relative(getLaunchCwd(env, cwd), fixturePath);
  return normalizeDisplayPath(relativePath);
}

export function buildSuggestedCommand(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): string {
  const launchCwd = getLaunchCwd(env, cwd);
  const repoRoot = path.resolve(cwd, "../..");
  const command =
    launchCwd === cwd ? "pnpm dev" : launchCwd === repoRoot ? "pnpm web:dev" : "pnpm --dir packages/web dev";

  return `${HEALTHYBOB_VAULT_ENV}=${buildExampleVaultPath(env, cwd)} ${command}`;
}

export function rememberLaunchCwd(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): void {
  if (typeof env[HEALTHYBOB_WEB_LAUNCH_CWD_ENV] === "string") {
    return;
  }

  env[HEALTHYBOB_WEB_LAUNCH_CWD_ENV] = cwd;
}

function getLaunchCwd(
  env: Record<string, string | undefined>,
  cwd: string,
): string {
  const configured = env[HEALTHYBOB_WEB_LAUNCH_CWD_ENV];
  if (typeof configured !== "string" || configured.trim().length === 0) {
    return cwd;
  }

  return path.resolve(cwd, configured);
}

function normalizeDisplayPath(value: string): string {
  if (!value) {
    return ".";
  }

  return value.split(path.sep).join("/");
}
