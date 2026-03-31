import path from "node:path";

export const VAULT_ENV = "VAULT";
export const VAULT_ENV_KEYS = [VAULT_ENV] as const;
export const WEB_LAUNCH_CWD_ENV = "WEB_LAUNCH_CWD";
export const WEB_LAUNCH_CWD_ENV_KEYS = [
  WEB_LAUNCH_CWD_ENV,
] as const;

export function getConfiguredVaultRoot(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): string | null {
  const trimmed = getEnvValue(env, VAULT_ENV_KEYS);
  if (!trimmed) {
    return null;
  }

  return path.resolve(resolveLaunchCwd(env, cwd), trimmed);
}

export function resolveLaunchCwd(
  env: Record<string, string | undefined>,
  cwd: string,
): string {
  const configured = getEnvValue(env, WEB_LAUNCH_CWD_ENV_KEYS);
  if (!configured) {
    return cwd;
  }

  return path.resolve(cwd, configured);
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
