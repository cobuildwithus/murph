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
  const reusablePnpmStoreDir = await resolveReusablePnpmStoreDir(explicitEnv, source);
  const packageManagerEnv = reusableCorepackHome
    ? {
        ...isolatedEnv,
        COREPACK_HOME: reusableCorepackHome,
      }
    : isolatedEnv;
  const packageManagerCacheEnv = reusablePnpmStoreDir
    ? {
        ...packageManagerEnv,
        PNPM_STORE_DIR: reusablePnpmStoreDir,
        npm_config_store_dir: reusablePnpmStoreDir,
      }
    : packageManagerEnv;

  return {
    cleanup: async () => {
      await rm(homeDir, { force: true, recursive: true });
    },
    env: buildPackageManagerProcessEnv({
      ...packageManagerCacheEnv,
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
  const userConfigPath = path.join(homeDir, ".npmrc");

  await Promise.all([
    mkdir(appDataDir, { recursive: true }),
    mkdir(corepackDir, { recursive: true }),
    mkdir(localAppDataDir, { recursive: true }),
    mkdir(npmCacheDir, { recursive: true }),
    mkdir(pnpmHomeDir, { recursive: true }),
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
    USERPROFILE: homeDir,
    XDG_CACHE_HOME: cacheDir,
    XDG_CONFIG_HOME: configDir,
    XDG_DATA_HOME: dataDir,
    npm_config_cache: npmCacheDir,
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

async function resolveReusablePnpmStoreDir(
  explicitEnv: NodeJS.ProcessEnv | undefined,
  source: NodeJS.ProcessEnv,
): Promise<string | null> {
  const configuredStoreDir = readConfiguredPnpmStoreDir(explicitEnv)
    ?? readConfiguredPnpmStoreDir(source);
  if (configuredStoreDir) {
    return configuredStoreDir;
  }

  return await resolvePnpmStorePath(source);
}

function readConfiguredPnpmStoreDir(
  env: NodeJS.ProcessEnv | undefined,
): string | null {
  const configured =
    env?.PNPM_STORE_DIR?.trim()
    || env?.NPM_CONFIG_STORE_DIR?.trim()
    || env?.npm_config_store_dir?.trim();

  return configured || null;
}

async function resolvePnpmStorePath(source: NodeJS.ProcessEnv): Promise<string | null> {
  const env = buildPnpmStorePathProcessEnv(source);

  return await new Promise((resolve, reject) => {
    const child = spawn(resolvePnpmCommand(), ["store", "path", "--silent"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim() || null);
        return;
      }

      reject(new Error(
        `pnpm store path exited with code ${code ?? "unknown"}.${stderr.trim() ? ` ${stderr.trim()}` : ""}`,
      ));
    });
  });
}

function buildPnpmStorePathProcessEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = buildPackageManagerProcessEnv(undefined, source);
  for (const key of [
    "APPDATA",
    "COREPACK_HOME",
    "HOME",
    "LOCALAPPDATA",
    "USERPROFILE",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
  ] as const) {
    const value = source[key]?.trim();
    if (value) {
      env[key] = value;
    }
  }
  env.COREPACK_ENABLE_DOWNLOAD_PROMPT = "0";
  return env;
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
