import path from "node:path";

import { VAULT_ENV, WEB_LAUNCH_CWD_ENV, WEB_LAUNCH_CWD_ENV_KEYS, resolveLaunchCwd } from "./vault";

export const FIXTURE_VAULT_EXAMPLE = "../../fixtures/demo-web-vault";
const INIT_CWD_ENV = "INIT_CWD";

export function buildExampleVaultPath(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): string {
  const fixturePath = path.resolve(cwd, FIXTURE_VAULT_EXAMPLE);
  const relativePath = path.relative(resolveLaunchCwd(env, cwd), fixturePath);
  return normalizeDisplayPath(relativePath);
}

export function buildSuggestedCommand(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): string {
  const launchCwd = resolveLaunchCwd(env, cwd);
  const repoRoot = path.resolve(cwd, "../..");
  const command =
    launchCwd === cwd ? "pnpm dev" : launchCwd === repoRoot ? "pnpm local-web:dev" : "pnpm --dir packages/local-web dev";

  return `${VAULT_ENV}=${buildExampleVaultPath(env, cwd)} ${command}`;
}

export function rememberLaunchCwd(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): void {
  if (getEnvValue(env, WEB_LAUNCH_CWD_ENV_KEYS)) {
    return;
  }

  const initCwd = env[INIT_CWD_ENV]?.trim();
  const resolvedLaunchCwd = initCwd ? path.resolve(cwd, initCwd) : cwd;
  env[WEB_LAUNCH_CWD_ENV] = resolvedLaunchCwd;
}

function getEnvValue(
  env: Record<string, string | undefined>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function normalizeDisplayPath(value: string): string {
  if (!value) {
    return ".";
  }

  return value.split(path.sep).join("/");
}
