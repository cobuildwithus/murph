import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runHostedWorkerDeployment,
  type DeploymentStatusPayload,
  type HostedWorkerDeploymentResult,
} from "./deploy-worker-version.shared.js";
import { assertPreparedDeployArtifacts, readRunnerBundleManifest } from "./deploy-artifacts.js";
import {
  parseJsonValue,
  requireConfiguredString,
} from "./deploy-automation/shared.ts";
import { assertHostedDeployEnvironmentAsync } from "./deploy-preflight.js";
import { assertHostedWebProtocolAdmission } from "./deploy-web-protocol.ts";
import { resolveDeployWorkerCliPaths } from "./deploy-worker-version-paths.js";
import { prepareSmallRunnerNamespaceBootstrap, stageHostedRunnerRelease } from "./stage-runner-release.ts";
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
        const retainServingRunner = input.containerRolloutMode === "worker-only";
        // Retaining an image does not attest an older protocol requirement.
        // Worker-only deployments must preserve the same Web consumer floor.
        const admitWeb = () => assertHostedWebProtocolAdmission(env);
        const assertActivationAllowed = async (expectedLiveVersion: string): Promise<void> => {
          await admitWeb();
          // Recheck Worker identity after the bounded Web I/O, not before it.
          await assertLiveVersion(input.workerName, input.configPath, expectedLiveVersion);
        };
        await admitWeb();
        const containerProvider = createCloudflareContainerProvider({
          accountId: requireConfiguredString(env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID"),
          apiToken: requireConfiguredString(env.CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN"),
        });
        const releaseProvider = createRunnerReleaseProvider({
          accountId: requireConfiguredString(env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID"),
          apiToken: requireConfiguredString(env.CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN"),
        });
        const current = await readCurrentDeployment(input.workerName, input.configPath);
        let currentVersionId = requireSingleLiveVersion(current);
        let currentVersion = await releaseProvider.readWorkerVersion(input.workerName, currentVersionId);
        const bootstrapPath = await prepareSmallRunnerNamespaceBootstrap({
          allowed: env.CF_BOOTSTRAP_SMALL_RUNNER === "true" && !retainServingRunner,
          configPath: input.configPath, currentVersion, currentVersionId,
          listApplications: containerProvider.listApplications,
        });
        if (bootstrapPath) {
          const retainedContainers = await readRenderedContainerIdentities(bootstrapPath);
          const before = await readCloudflareContainerApplicationIdentities(
            retainedContainers, containerProvider.listApplications, "before", containerProvider.readRollout,
          );
          await assertActivationAllowed(currentVersionId);
          const output = await runWranglerLoggedCaptured([
            "deploy", "--config", bootstrapPath, "--name", input.workerName, "--containers-rollout=none",
            ...(input.includeSecrets ? ["--secrets-file", input.secretsFilePath] : []),
          ]);
          currentVersionId = parseWranglerWorkerVersionId(`${output.stdout}\n${output.stderr}`);
          await assertLiveVersion(input.workerName, input.configPath, currentVersionId);
          const after = await readCloudflareContainerApplicationIdentities(
            retainedContainers, containerProvider.listApplications, "after", containerProvider.readRollout,
          );
          buildContainerReleaseEntries({ before, after,
            actions: retainedContainers.map(entry => ({ ...entry, action: "unchanged" })),
          });
          currentVersion = await releaseProvider.readWorkerVersion(input.workerName, currentVersionId);
        }
        const { releaseSha } = await readRunnerBundleManifest(runnerBundleDir);
        const preparedConfigPath = await prepareHostedContainerDeployImage({
          accountId: requireConfiguredString(env.CLOUDFLARE_ACCOUNT_ID, "CLOUDFLARE_ACCOUNT_ID"),
          configPath: input.configPath,
          ...(retainServingRunner ? {} : { release: { currentVersion, releaseSha, listApplications: containerProvider.listApplications } }),
        });
        await applyHostedTransientLifecycleRules({ deployRoot, source: env });
        const staged = await stageHostedRunnerRelease({
          configPath: preparedConfigPath,
          currentVersion, releaseSha, retainServingRunner,
          currentVersionId,
          listApplications: containerProvider.listApplications,
        });
        const renderedContainers = await readRenderedContainerIdentities(staged.configPath);
        await assertLiveVersion(input.workerName, input.configPath, currentVersionId);
        const uploadVersion = async (configPath: string): Promise<string> => {
          const output = await runWranglerLoggedCaptured([
            "versions", "upload", "--config", configPath, "--name", input.workerName,
            "--message", input.deploymentMessage, "--tag", input.versionTag,
            ...(input.includeSecrets ? ["--secrets-file", input.secretsFilePath] : []),
          ]);
          return parseWranglerWorkerVersionId(`${output.stdout}\n${output.stderr}`);
        };
        const activateVersion = async (configPath: string, versionId: string, expectedLiveVersion: string): Promise<void> => {
          await assertActivationAllowed(expectedLiveVersion);
          await runWranglerLogged([
            "versions", "deploy", `${versionId}@100%`, "--yes", "--config", configPath,
            "--name", input.workerName, "--message", input.deploymentMessage,
          ]);
          await assertLiveVersion(input.workerName, input.configPath, versionId);
        };
        const stageVersionId = await uploadVersion(staged.configPath);
        await assertLiveVersion(input.workerName, input.configPath, currentVersionId);
        // One-time retirement is drain-proven and happens before increasing the
        // serving ceiling. Never refill the retired application on a retry.
        for (const retirement of staged.retirements) {
          await releaseProvider.assertDrained(retirement.applicationId);
          await assertActivationAllowed(currentVersionId);
          await releaseProvider.retireApplication(retirement);
        }
        const before = await readCloudflareContainerApplicationIdentities(
          renderedContainers, containerProvider.listApplications, "before", containerProvider.readRollout,
        );
        const serving = staged.applications.find(application => application.name === staged.activeApplicationName);
        if (serving?.applicationId) await releaseProvider.assertCapacity({
          applicationId: serving.applicationId, specification: serving.specification,
        });
        // Prove the isolated artifact before making the compatibility reader live.
        for (const application of staged.applications.filter(application => application.className === "DeploySmokeRunnerContainer")) {
          await assertActivationAllowed(currentVersionId);
          await releaseProvider.admitApplication(application);
          await releaseProvider.assertApplicationReady({ ...application, listApplications: containerProvider.listApplications });
        }
        await activateVersion(staged.configPath, stageVersionId, currentVersionId);
        if (serving) {
          // This endpoint cannot allocate member slots, even if an older Worker
          // receives the request during edge propagation (it returns 404).
          await runSmokeHostedDeploy({
            phase: "artifact",
            source: {
              ...env,
              HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER: "true",
              HOSTED_EXECUTION_SMOKE_DIRECT_R2_PRESIGNED_PUT: "true",
              HOSTED_EXECUTION_SMOKE_VERSION_ID: stageVersionId,
              HOSTED_EXECUTION_SMOKE_RUNNER_MANIFEST_PATH: path.join(runnerBundleDir, ".murph-runner-bundle-manifest.json"),
            },
          });
          await assertActivationAllowed(stageVersionId);
          const rolloutSteps = input.containerRolloutMode === "gradual"
            ? [10, 25, 50, 100].slice(-Math.min(serving.specification.max_instances, 4)) : [100];
          await releaseProvider.admitApplication({ ...serving,
            rolloutStepPercentage: rolloutSteps.length === 1 ? 100 : rolloutSteps,
          });
          await releaseProvider.assertApplicationReady({ ...serving, listApplications: containerProvider.listApplications,
            rolloutStepCount: rolloutSteps.length });
        }
        // Small runners carry member work: their old image needs the same
        // compatibility reader before native mutation as the normal fleet.
        for (const application of staged.applications.filter(application => application.className === "SmallRunnerContainer")) {
          if (application.applicationId) await releaseProvider.assertCapacity({
            applicationId: application.applicationId, specification: application.specification,
          });
          await assertActivationAllowed(stageVersionId);
          await releaseProvider.admitApplication({ ...application, rolloutStepPercentage: 100 });
          await releaseProvider.assertApplicationReady({ ...application, listApplications: containerProvider.listApplications });
        }
        const prepared = await readCloudflareContainerApplicationIdentities(
          renderedContainers, containerProvider.listApplications, "after", containerProvider.readRollout,
        );
        // Receipts describe the completed native effect, including resumed
        // rollouts whose mutation was accepted during an earlier deploy attempt.
        const actions: WranglerContainerAction[] = renderedContainers.map(container => {
          const previous = before.find(entry => entry.applicationName === container.applicationName);
          const current = prepared.find(entry => entry.applicationName === container.applicationName);
          if (!current || (!staged.workerOnly && current.activeRollout)) throw new Error("Native runner distribution is incomplete.");
          const unchanged = previous && previous.version === current.version && previous.image === current.image
            && JSON.stringify(previous.activeRollout) === JSON.stringify(current.activeRollout);
          return { ...container, action: !previous ? "created" : unchanged ? "unchanged" : "modified" };
        });
        const containers = buildContainerReleaseEntries({ actions, before, after: prepared });
        await runSmokeHostedDeploy({
          source: {
            ...env,
            HOSTED_EXECUTION_RUNNER_DEPLOYMENT: JSON.stringify(staged.deployment),
            HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER: "true",
            HOSTED_EXECUTION_SMOKE_VERSION_ID: stageVersionId,
            HOSTED_EXECUTION_SMOKE_RUNNER_MANIFEST_PATH: path.join(runnerBundleDir, ".murph-runner-bundle-manifest.json"),
          },
        });
        await assertLiveVersion(input.workerName, input.configPath, stageVersionId);
        const workerVersionId = staged.workerOnly ? stageVersionId : await uploadVersion(staged.promotionConfigPath);
        if (!staged.workerOnly) await activateVersion(staged.promotionConfigPath, workerVersionId, stageVersionId);
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
    console.log("Deployed Cloudflare Worker with native runner rollout evidence.");
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
