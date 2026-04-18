import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export const HOSTED_WEB_BUILD_DIST_DIR = ".next";
export const HOSTED_WEB_DEV_DIST_DIR = ".next-dev";
export const HOSTED_WEB_SMOKE_DIST_DIR = ".next-smoke";

const hostedWebDevFileSystemCacheEnvVarName = "MURPH_NEXT_DEV_FILESYSTEM_CACHE";
const hostedWebDistModeEnvVarName = "NEXT_DIST_DIR_MODE";
const hostedWebSmokeDistMode = "smoke";
const hostedWebSmokeDefaultDatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync";

export function createHostedWebSmokeEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...environment,
    DATABASE_URL: environment.DATABASE_URL ?? hostedWebSmokeDefaultDatabaseUrl,
    [hostedWebDistModeEnvVarName]: hostedWebSmokeDistMode,
  };
}

export function isHostedWebSmokeEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment[hostedWebDistModeEnvVarName] === hostedWebSmokeDistMode;
}

export function isHostedWebDevFileSystemCacheEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const normalized = environment[hostedWebDevFileSystemCacheEnvVarName]?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function resolveHostedWebDistDir(
  phase: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (phase !== PHASE_DEVELOPMENT_SERVER) {
    return HOSTED_WEB_BUILD_DIST_DIR;
  }

  return environment[hostedWebDistModeEnvVarName] === hostedWebSmokeDistMode
    ? HOSTED_WEB_SMOKE_DIST_DIR
    : HOSTED_WEB_DEV_DIST_DIR;
}
