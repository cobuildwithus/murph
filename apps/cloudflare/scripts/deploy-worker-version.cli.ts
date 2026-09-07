import { mkdir, readFile, writeFile } from "node:fs/promises";
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
import { stageHostedRunnerRelease } from "./stage-runner-release.ts";
import { createRunnerReleaseProvider } from "./runner-release-provider.ts";
import { runSmokeHostedDeploy } from "./smoke-hosted-deploy.shared.ts";
import { prepareHostedContainerDeployImage } from "./prepare-container-deploy-image.ts";
import {
  createCloudflareContainerProvider,
  buildContainerReleaseEntries,
  type WranglerContainerAction,
  parseWranglerWorkerVersionId,
  readCloudflareContainerApplicationIdentities,
  readRenderedContainerIdentities,
  waitForCloudflareContainerReleaseEntries,
} from "./container-release-receipt.js";
import {
  buildHostedLifecycleWranglerArgs,
  resolveHostedLifecycleBucketNames,
} from "./r2-lifecycle.js";
import {
  runWranglerJson,
  runWranglerLogged,
  runWranglerLoggedCaptured,
} from "./wrangler-runner.js";

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
        const preparedConfigPath = await prepareHostedContainerDeployImage({
          accountId: requireConfiguredString(env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID"),
          configPath: input.configPath,
        });

        await applyHostedTransientLifecycleRules({
          deployRoot,
          source: env,
        });
        const renderedContainers = await readRenderedContainerIdentities(input.configPath);
        const containerProvider = createCloudflareContainerProvider({
          accountId: requireConfiguredString(env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID"),
          apiToken: requireConfiguredString(env.CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN"),
        });
        const releaseProvider = createRunnerReleaseProvider({
          accountId: requireConfiguredString(env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID"),
          apiToken: requireConfiguredString(env.CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN"),
        });
        const current = await readCurrentDeployment(input.workerName, input.configPath);
        const currentVersionId = requireSingleLiveVersion(current);
        const staged = await stageHostedRunnerRelease({
          configPath: preparedConfigPath,
          currentVersion: await releaseProvider.readWorkerVersion(input.workerName, currentVersionId),
          currentVersionId,
          listApplications: containerProvider.listApplications,
        });
        await assertLiveVersion(input.workerName, input.configPath, currentVersionId);
        const before = await readCloudflareContainerApplicationIdentities(
          renderedContainers, containerProvider.listApplications, "before", containerProvider.readRollout,
        );
        const actions: WranglerContainerAction[] = renderedContainers.map((container) => ({ ...container, action: "unchanged" }));
        // Native admission, including quota rejection, completes before any Worker upload.
        for (const application of staged.applications) {
          const entry = actions.find((entry) => entry.applicationName === application.name);
          if (!entry || application.name === staged.activeApplicationName) throw new Error("Invalid inactive runner application plan.");
          if (application.applicationId) await releaseProvider.assertDrained(application.applicationId);
          const action = await releaseProvider.admitApplication(application);
          entry.action = action;
          await releaseProvider.assertApplicationReady({ ...application, listApplications: containerProvider.listApplications });
        }
        const containers = await waitForCloudflareContainerReleaseEntries({
          actions, before, expectedContainers: renderedContainers,
          listApplications: containerProvider.listApplications, readRollout: containerProvider.readRollout,
        });
        const prepared = await readCloudflareContainerApplicationIdentities(
          renderedContainers, containerProvider.listApplications, "after", containerProvider.readRollout,
        );
        await assertLiveVersion(input.workerName, input.configPath, currentVersionId);
        const uploadAndActivate = async (configPath: string, expectedLiveVersion: string): Promise<string> => {
          const output = await runWranglerLoggedCaptured([
            "versions", "upload", "--config", configPath, "--name", input.workerName,
            "--message", input.deploymentMessage, "--tag", input.versionTag,
            ...(input.includeSecrets ? ["--secrets-file", input.secretsFilePath] : []),
          ]);
          const versionId = parseWranglerWorkerVersionId(`${output.stdout}\n${output.stderr}`);
          await assertLiveVersion(input.workerName, input.configPath, expectedLiveVersion);
          await runWranglerLogged([
            "versions", "deploy", `${versionId}@100%`, "--yes", "--config", configPath,
            "--name", input.workerName, "--message", input.deploymentMessage,
          ]);
          await assertLiveVersion(input.workerName, input.configPath, versionId);
          return versionId;
        };
        const stageVersionId = await uploadAndActivate(staged.configPath, currentVersionId);
        await runSmokeHostedDeploy({
          source: {
            ...env,
            HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER: "true",
            HOSTED_EXECUTION_SMOKE_VERSION_ID: stageVersionId,
            HOSTED_EXECUTION_SMOKE_RUNNER_MANIFEST_PATH: path.join(runnerBundleDir, ".murph-runner-bundle-manifest.json"),
          },
        });
        await assertLiveVersion(input.workerName, input.configPath, stageVersionId);
        const workerVersionId = staged.workerOnly ? stageVersionId
          : await uploadAndActivate(staged.promotionConfigPath, stageVersionId);
        const after = await readCloudflareContainerApplicationIdentities(
          renderedContainers, containerProvider.listApplications, "after", containerProvider.readRollout,
        );
        // Version publication must not create or update any native application.
        buildContainerReleaseEntries({ before: prepared, after, actions: actions.map((entry) => ({ ...entry, action: "unchanged" })) });
        await writeFile(input.configPath, await readFile(staged.promotionConfigPath, "utf8"), "utf8");
        return { containers, workerVersionId };
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
    console.log("Deployed Cloudflare Worker after native runner admission.");
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

function requireSingleLiveVersion(deployment: DeploymentStatusPayload | null): string {
  if (deployment?.versions.length !== 1 || deployment.versions[0]?.percentage !== 100) {
    throw new Error("Staged runner deployment requires one authoritative live Worker version.");
  }
  return deployment.versions[0].version_id;
}

async function assertLiveVersion(workerName: string, configPath: string, expected: string): Promise<void> {
  if (requireSingleLiveVersion(await readCurrentDeployment(workerName, configPath)) !== expected) {
    throw new Error("Live Worker changed during runner preparation; promotion stopped.");
  }
}
