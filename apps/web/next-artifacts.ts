import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export const HOSTED_WEB_BUILD_DIST_DIR = ".next";
export const HOSTED_WEB_DEV_DIST_DIR = ".next-dev";
export const HOSTED_WEB_SMOKE_DIST_DIR = ".next-smoke";

const hostedWebDistModeEnvVarName = "NEXT_DIST_DIR_MODE";
const hostedWebSmokeDistMode = "smoke";

export function createHostedWebSmokeEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...environment,
    [hostedWebDistModeEnvVarName]: hostedWebSmokeDistMode,
  };
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
