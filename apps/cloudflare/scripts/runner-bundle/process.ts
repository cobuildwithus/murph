import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolvePnpmCommand } from "../wrangler-runner.js";

const PACKAGE_MANAGER_ENV_KEYS = new Set([
  "CI",
  "COMSPEC",
  "GITHUB_ACTIONS",
  "NODE_EXTRA_CA_CERTS",
  "PATH",
  "PATHEXT",
  "RUNNER_ARCH",
  "RUNNER_OS",
  "RUNNER_TEMP",
  "RUNNER_TOOL_CACHE",
  "SHELL",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "WINDIR",
]);

function resolveNpmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export async function runPnpmCommand(
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<void> {
  await runProcess(resolvePnpmCommand(), args, options);
}

export async function runNpmCommand(
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<void> {
  await runProcess(resolveNpmCommand(), args, options);
}

async function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<void> {
  const processEnv = await createPackageManagerProcessEnv(options.env);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: processEnv.env,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `${command} exited with code ${code ?? "unknown"}.`,
        ),
      );
    });
  }).finally(processEnv.cleanup);
}

export async function createPackageManagerProcessEnv(
  explicitEnv: NodeJS.ProcessEnv | undefined,
  source: NodeJS.ProcessEnv = process.env,
): Promise<{
  cleanup: () => Promise<void>;
  env: NodeJS.ProcessEnv;
}> {
  const homeDir = await mkdtemp(
    path.join(tmpdir(), "murph-package-manager-env-"),
  );
  const isolatedEnv = await createIsolatedPackageManagerHomeEnv(homeDir);
  const reusableCorepackHome = resolveReusableCorepackHome(source);
  const packageManagerEnv = reusableCorepackHome
    ? {
        ...isolatedEnv,
        COREPACK_HOME: reusableCorepackHome,
      }
    : isolatedEnv;

  return {
    cleanup: async () => {
      await rm(homeDir, { force: true, recursive: true });
    },
    env: buildPackageManagerProcessEnv({
      ...packageManagerEnv,
      ...explicitEnv,
    }, source),
  };
}

async function createIsolatedPackageManagerHomeEnv(
  homeDir: string,
): Promise<NodeJS.ProcessEnv> {
  const configDir = path.join(homeDir, "config");
  const dataDir = path.join(homeDir, "data");
  const cacheDir = path.join(homeDir, "cache");
  const appDataDir = path.join(configDir, "appdata");
  const corepackDir = path.join(cacheDir, "corepack");
  const localAppDataDir = path.join(dataDir, "localappdata");
  const npmCacheDir = path.join(cacheDir, "npm");
  const pnpmHomeDir = path.join(dataDir, "pnpm-home");
  const pnpmStoreDir = path.join(dataDir, "pnpm-store");
  const userConfigPath = path.join(homeDir, ".npmrc");

  await Promise.all([
    mkdir(appDataDir, { recursive: true }),
    mkdir(corepackDir, { recursive: true }),
    mkdir(localAppDataDir, { recursive: true }),
    mkdir(npmCacheDir, { recursive: true }),
    mkdir(pnpmHomeDir, { recursive: true }),
    mkdir(pnpmStoreDir, { recursive: true }),
  ]);
  await writeFile(userConfigPath, "", "utf8");

  return {
    APPDATA: appDataDir,
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    COREPACK_HOME: corepackDir,
    HOME: homeDir,
    LOCALAPPDATA: localAppDataDir,
    NPM_CONFIG_CACHE: npmCacheDir,
    NPM_CONFIG_USERCONFIG: userConfigPath,
    PNPM_HOME: pnpmHomeDir,
    PNPM_STORE_DIR: pnpmStoreDir,
    USERPROFILE: homeDir,
    XDG_CACHE_HOME: cacheDir,
    XDG_CONFIG_HOME: configDir,
    XDG_DATA_HOME: dataDir,
    npm_config_cache: npmCacheDir,
    npm_config_store_dir: pnpmStoreDir,
    npm_config_userconfig: userConfigPath,
  };
}

function resolveReusableCorepackHome(source: NodeJS.ProcessEnv): string | null {
  const configuredCorepackHome = source.COREPACK_HOME?.trim();

  if (configuredCorepackHome) {
    return configuredCorepackHome;
  }

  const xdgCacheHome = source.XDG_CACHE_HOME?.trim();

  if (xdgCacheHome) {
    return path.join(xdgCacheHome, "node", "corepack");
  }

  const homeDir = source.HOME?.trim() || source.USERPROFILE?.trim();

  if (!homeDir) {
    return null;
  }

  return path.join(homeDir, ".cache", "node", "corepack");
}

export function buildPackageManagerProcessEnv(
  explicitEnv: NodeJS.ProcessEnv | undefined,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const key of PACKAGE_MANAGER_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  if (explicitEnv) {
    for (const [key, value] of Object.entries(explicitEnv)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
  }

  return env;
}
