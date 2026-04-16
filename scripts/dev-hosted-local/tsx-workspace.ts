import path from "node:path";

export function ensureHostedLocalWorkspaceTsconfigPath(
  env: NodeJS.ProcessEnv = process.env,
  scriptsDir: string = import.meta.dirname,
): string {
  const existing = env.TSX_TSCONFIG_PATH?.trim();

  if (existing) {
    return existing;
  }

  const resolved = path.resolve(scriptsDir, "../../tsconfig.base.json");
  env.TSX_TSCONFIG_PATH = resolved;
  return resolved;
}
