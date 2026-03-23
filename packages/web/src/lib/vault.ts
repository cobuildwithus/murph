import path from "node:path";
import { readFile } from "node:fs/promises";
import os from "node:os";

export const HEALTHYBOB_VAULT_ENV = "HEALTHYBOB_VAULT";
export const HEALTHYBOB_WEB_LAUNCH_CWD_ENV = "HEALTHYBOB_WEB_LAUNCH_CWD";
export const FIXTURE_VAULT_EXAMPLE = "../../fixtures/demo-web-vault";
const INIT_CWD_ENV = "INIT_CWD";
const OPERATOR_CONFIG_RELATIVE_PATH = path.join(".healthybob", "config.json");

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

export async function resolveConfiguredVaultRoot(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): Promise<string | null> {
  const explicitVaultRoot = getConfiguredVaultRoot(env, cwd);
  if (explicitVaultRoot) {
    return explicitVaultRoot;
  }

  return await resolveSavedDefaultVaultRoot(env);
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

  const initCwd = env[INIT_CWD_ENV]?.trim();
  env[HEALTHYBOB_WEB_LAUNCH_CWD_ENV] = initCwd ? path.resolve(cwd, initCwd) : cwd;
}

async function resolveSavedDefaultVaultRoot(
  env: Record<string, string | undefined>,
): Promise<string | null> {
  const operatorHomeDirectory = resolveOperatorHomeDirectory(env);
  const operatorConfig = await readOperatorConfig(operatorHomeDirectory);
  if (!operatorConfig?.defaultVault) {
    return null;
  }

  return expandConfiguredVaultPath(
    operatorConfig.defaultVault,
    operatorHomeDirectory,
  );
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

function resolveOperatorHomeDirectory(
  env: Record<string, string | undefined>,
): string {
  const configuredHome = env.HOME?.trim();
  return path.resolve(configuredHome && configuredHome.length > 0 ? configuredHome : os.homedir());
}

function expandConfiguredVaultPath(
  configuredPath: string,
  homeDirectory: string,
): string {
  if (configuredPath === "~") {
    return homeDirectory;
  }

  if (configuredPath.startsWith("~/")) {
    return path.join(homeDirectory, configuredPath.slice(2));
  }

  return path.resolve(configuredPath);
}

async function readOperatorConfig(
  homeDirectory: string,
): Promise<{ defaultVault: string | null } | null> {
  try {
    const raw = await readFile(path.join(homeDirectory, OPERATOR_CONFIG_RELATIVE_PATH), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const defaultVault = "defaultVault" in parsed ? parsed.defaultVault : null;
    return {
      defaultVault: typeof defaultVault === "string" && defaultVault.trim().length > 0 ? defaultVault : null,
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }

    if (error instanceof SyntaxError) {
      return null;
    }

    throw error;
  }
}
