import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildHostedWorkerSecretsPayload,
  resolveCloudflareDeployPaths,
} from "../src/deploy-automation.js";

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
  const shouldHardenOutputDirectory = outputDirectory === deployPaths.deployDir
    || !(await pathExists(outputDirectory));

  await mkdir(outputDirectory, { recursive: true, mode: DEPLOY_SECRET_DIRECTORY_MODE });
  if (shouldHardenOutputDirectory) {
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
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isEntrypoint(moduleUrl: string): boolean {
  return Boolean(process.argv[1] && moduleUrl === pathToFileURL(process.argv[1]).href);
}
