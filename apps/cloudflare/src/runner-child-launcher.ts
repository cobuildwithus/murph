import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  projectHostedRuntimeToChildEnv,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";

export interface HostedRunnerChildLauncherDirectories {
  cacheRoot: string;
  homeRoot: string;
  huggingFaceRoot: string;
  tempRoot: string;
}

export async function createHostedRunnerChildLauncherDirectories(
  launcherRoot: string,
): Promise<HostedRunnerChildLauncherDirectories> {
  const directories = {
    cacheRoot: path.join(launcherRoot, "cache"),
    homeRoot: path.join(launcherRoot, "home"),
    huggingFaceRoot: path.join(launcherRoot, "hf-home"),
    tempRoot: path.join(launcherRoot, "tmp"),
  } satisfies HostedRunnerChildLauncherDirectories;

  await Promise.all(
    Object.values(directories).map((directory) => mkdir(directory, { recursive: true })),
  );

  return directories;
}

export function createHostedRunnerChildProcessEnv(input: {
  ambientEnv?: Readonly<Record<string, string | undefined>>;
  forwardedEnv: Record<string, string>;
  isTypeScriptChild: boolean;
  launcherDirectories: HostedRunnerChildLauncherDirectories;
}): Record<string, string> {
  const ambientEnv = input.ambientEnv ?? process.env;
  const env = projectHostedRuntimeToChildEnv({
    ambientEnv,
    forwardedEnv: input.forwardedEnv,
    platformTransportEnv: ambientEnv,
  });

  Object.assign(env, {
    HF_HOME: input.launcherDirectories.huggingFaceRoot,
    HOME: input.launcherDirectories.homeRoot,
    TEMP: input.launcherDirectories.tempRoot,
    TMP: input.launcherDirectories.tempRoot,
    TMPDIR: input.launcherDirectories.tempRoot,
    XDG_CACHE_HOME: input.launcherDirectories.cacheRoot,
  });

  if (input.isTypeScriptChild) {
    env.TSX_TSCONFIG_PATH = resolveHostedRunnerTsconfigPath();
  }

  return env;
}

export function resolveHostedRunnerTsconfigPath(): string {
  return fileURLToPath(new URL("../../../tsconfig.base.json", import.meta.url));
}

export function resolveHostedRunnerTsxImportSpecifier(
  moduleRequire: NodeJS.Require = resolveHostedRunnerModuleRequire(),
): string {
  try {
    return pathToFileURL(moduleRequire.resolve("tsx")).href;
  } catch {
    return "tsx";
  }
}

function resolveHostedRunnerModuleRequire(): NodeJS.Require {
  return createRequire(import.meta.url);
}
