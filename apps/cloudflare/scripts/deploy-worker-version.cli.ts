import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  runHostedWorkerDeployment,
  type DeploymentStatusPayload,
  type HostedWorkerDeploymentResult,
} from "./deploy-worker-version.shared.js";
import { assertPreparedDeployArtifacts } from "./deploy-artifacts.js";
import {
  parseJsonValue,
  requireConfiguredString,
} from "./deploy-automation/shared.ts";
import { assertHostedDeployEnvironmentAsync } from "./deploy-preflight.js";
import { resolveDeployWorkerCliPaths } from "./deploy-worker-version-paths.js";
import { runWranglerJson, runWranglerLogged } from "./wrangler-runner.js";

export async function runDeployWorkerVersionCli(
  argv: string[],
  options: {
    deployRoot?: string;
    env?: Readonly<Record<string, string | undefined>>;
    log?: boolean;
    runHostedWorkerDeployment?: typeof runHostedWorkerDeployment;
  } = {},
): Promise<HostedWorkerDeploymentResult> {
  const { configPath, resultPath, runnerBundleDir, secretsFilePath } = resolveDeployWorkerCliPaths(argv, {
    deployRoot: options.deployRoot,
  });
  const env = options.env ?? process.env;
  const workerName = requireConfiguredString(env.CF_WORKER_NAME, "CF_WORKER_NAME");

  const result = await (options.runHostedWorkerDeployment ?? runHostedWorkerDeployment)({
    configPath,
    dependencies: {
      async deployDirect(input) {
        const containerRolloutArgs = input.containerRolloutMode === "immediate"
          ? ["--containers-rollout=immediate"]
          : [];

        await runWranglerLogged([
          "deploy",
          "--config",
          input.configPath,
          ...containerRolloutArgs,
          "--message",
          input.deploymentMessage,
          "--name",
          input.workerName,
          "--tag",
          input.versionTag,
          ...(input.includeSecrets ? ["--secrets-file", input.secretsFilePath] : []),
        ]);
      },
      mkdir,
      readCurrentDeployment,
      validateDeployEnvironment: async (input) => {
        await assertHostedDeployEnvironmentAsync(input.source, {
          deployWorker: input.deployWorker,
        });
      },
      validatePreparedArtifacts: assertPreparedDeployArtifacts,
      writeFile,
    },
    env,
    resultPath,
    runnerBundleDir,
    secretsFilePath,
    workerName,
  });

  if (options.log ?? true) {
    console.log("Rendered Cloudflare deployment result.");
    if (result.candidateVersionId) {
      console.log(`Candidate version: ${result.candidateVersionId}`);
    }
  }

  return result;
}

async function readCurrentDeployment(
  currentWorkerName: string,
  currentConfigPath: string,
): Promise<DeploymentStatusPayload | null> {
  try {
    const stdout = await runWranglerJson([
      "deployments",
      "status",
      "--config",
      currentConfigPath,
      "--json",
      "--name",
      currentWorkerName,
    ]);

    return parseJsonValue<DeploymentStatusPayload>(
      stdout,
      `Wrangler deployment status for worker ${currentWorkerName}`,
    );
  } catch (error) {
    if (isWranglerNoDeploymentsError(error)) {
      return null;
    }

    throw error;
  }
}

function isWranglerNoDeploymentsError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("has no deployments");
}
