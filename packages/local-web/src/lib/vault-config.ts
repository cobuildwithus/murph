import path from "node:path";
import { readFile } from "node:fs/promises";
import os from "node:os";

import { getConfiguredVaultRoot } from "./vault";

const OPERATOR_CONFIG_RELATIVE_PATHS = [
  path.join(".murph", "config.json"),
] as const;

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
  for (const relativePath of OPERATOR_CONFIG_RELATIVE_PATHS) {
    try {
      const raw = await readFile(path.join(/* turbopackIgnore: true */ homeDirectory, relativePath), "utf8");
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
        continue;
      }

      if (error instanceof SyntaxError) {
        return null;
      }

      throw error;
    }
  }

  return null;
}
