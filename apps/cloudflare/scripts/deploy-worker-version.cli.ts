import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
import {
  buildHostedLifecycleWranglerArgs,
  resolveHostedLifecycleBucketNames,
} from "./r2-lifecycle.js";
import { runWranglerJson, runWranglerLogged } from "./wrangler-runner.js";

type EnvSource = Readonly<Record<string, string | undefined>>;

export async function runDeployWorkerVersionCli(
  argv: string[],
  options: {
    deployRoot?: string;
    env?: Readonly<Record<string, string | undefined>>;
    log?: boolean;
    runHostedWorkerDeployment?: typeof runHostedWorkerDeployment;
  } = {},
): Promise<HostedWorkerDeploymentResult> {
  const deployRoot = resolveDeployRoot(options.deployRoot);
  const { configPath, resultPath, runnerBundleDir, secretsFilePath } = resolveDeployWorkerCliPaths(argv, {
    deployRoot,
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

        await applyHostedTransientLifecycleRules({
          deployRoot,
          source: env,
        });
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
    console.log("Deployed Cloudflare Worker with direct Wrangler.");
    console.log(`Smoke version: ${result.smokeVersionId}`);
  }

  return result;
}

async function applyHostedTransientLifecycleRules(input: {
  deployRoot: string;
  source: EnvSource;
}): Promise<void> {
  const lifecycleConfigPath = path.join(input.deployRoot, "r2-bundles-lifecycle.json");

  for (const bucketName of resolveHostedLifecycleBucketNames(input.source)) {
    await runWranglerLogged(
      buildHostedLifecycleWranglerArgs({
        bucketName,
        lifecycleConfigPath,
      }),
      {
        cwd: input.deployRoot,
      },
    );
  }
}

function resolveDeployRoot(deployRoot: string | undefined): string {
  if (deployRoot) {
    return path.resolve(deployRoot);
  }

  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
