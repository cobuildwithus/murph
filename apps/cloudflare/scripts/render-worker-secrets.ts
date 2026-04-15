import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildHostedWorkerSecretsPayload,
  resolveCloudflareDeployPaths,
} from "./deploy-automation.js";

const DEPLOY_SECRET_DIRECTORY_MODE = 0o700;
const DEPLOY_SECRET_FILE_MODE = 0o600;

export async function renderWorkerSecretsFile(input: {
  outputPath?: string;
  source?: NodeJS.ProcessEnv;
} = {}): Promise<string> {
  const deployPaths = resolveCloudflareDeployPaths();
  const outputPath = input.outputPath
    ? path.resolve(process.cwd(), input.outputPath)
    : deployPaths.workerSecretsPath;
  const outputDirectory = path.dirname(outputPath);
  const shouldApplySecureDirectoryMode = outputDirectory === deployPaths.deployDir
    || !(await pathExists(outputDirectory));

  await mkdir(outputDirectory, { recursive: true, mode: DEPLOY_SECRET_DIRECTORY_MODE });
  if (shouldApplySecureDirectoryMode) {
    await chmod(outputDirectory, DEPLOY_SECRET_DIRECTORY_MODE);
  }
  await writeFile(
    outputPath,
    `${JSON.stringify(buildHostedWorkerSecretsPayload(input.source), null, 2)}\n`,
    {
      encoding: "utf8",
      mode: DEPLOY_SECRET_FILE_MODE,
    },
  );
  await chmod(outputPath, DEPLOY_SECRET_FILE_MODE);

  return outputPath;
}

if (isEntrypoint(import.meta.url)) {
  const outputPath = await renderWorkerSecretsFile({
    outputPath: process.argv[2],
  });
  console.log(`Rendered Cloudflare worker secrets payload to ${outputPath}`);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT",
  );
}

function isEntrypoint(moduleUrl: string): boolean {
  return Boolean(process.argv[1] && moduleUrl === pathToFileURL(process.argv[1]).href);
}
