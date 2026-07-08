import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  HOSTED_WEB_DEV_DIST_DIR,
  HOSTED_WEB_SMOKE_DIST_DIR,
  webDir,
} from "./constants.ts";

export function resolveHostedWebDevDistDirName(env: NodeJS.ProcessEnv): string {
  const baseDistDir = env.NEXT_DIST_DIR_MODE === "smoke"
    ? HOSTED_WEB_SMOKE_DIST_DIR
    : HOSTED_WEB_DEV_DIST_DIR;
  const configuredSuffix = env.NEXT_DIST_DIR_SUFFIX?.trim();

  if (!configuredSuffix) {
    return baseDistDir;
  }

  const normalizedSuffix = configuredSuffix.toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalizedSuffix)) {
    throw new Error("NEXT_DIST_DIR_SUFFIX must use lowercase letters, digits, and hyphens only.");
  }

  return `${baseDistDir}-${normalizedSuffix}`;
}

export function resolveHostedWebDevDistDir(env: NodeJS.ProcessEnv): string {
  return path.join(webDir, resolveHostedWebDevDistDirName(env));
}

export async function shouldUseHostedWebProductionStart(input: {
  distDir?: string;
  env: NodeJS.ProcessEnv;
}): Promise<boolean> {
  if (!usesHostedLocalProductionWebProfile(input.env)) {
    return false;
  }

  const nextDistDirMode = input.env.NEXT_DIST_DIR_MODE?.trim();
  if (nextDistDirMode !== "smoke") {
    return false;
  }

  // This gate intentionally stays a harness-owned decision over explicit
  // process env plus the prepared dist path. CI re-extracts the production
  // web dist per scenario; source freshness is producer-owned so this helper
  // does not try to become a partial Next build cache invalidator.
  const buildId = await readFile(path.join(
    input.distDir ?? resolveHostedWebDevDistDir(input.env),
    "BUILD_ID",
  ), "utf8").catch(() => null);
  return buildId !== null && buildId.trim().length > 0;
}

function usesHostedLocalProductionWebProfile(env: NodeJS.ProcessEnv): boolean {
  const profile = env.MURPH_HOSTED_LOCAL_PROFILE?.trim();
  return profile === "e2e:stub" || profile === "e2e:live";
}
