import path from "node:path";

import {
  normalizeOptionalString,
  readBooleanEnv,
} from "./deploy-automation/shared.ts";

type EnvSource = Readonly<Record<string, string | undefined>>;

export type ContainerRolloutMode = "gradual" | "immediate";

export interface DeploymentStatusPayload {
  created_on: string;
  versions: Array<{
    percentage: number;
    version_id: string;
  }>;
}

export interface HostedWorkerDeploymentResult {
  finalDeploymentVersions: Array<{
    percentage: number;
    versionId: string;
  }>;
  smokeVersionId: string;
  workerName: string;
}

export interface HostedWorkerDeploymentDependencies {
  deployDirect(input: {
    containerRolloutMode: ContainerRolloutMode;
    configPath: string;
    deploymentMessage: string;
    includeSecrets: boolean;
    secretsFilePath: string;
    versionTag: string;
    workerName: string;
  }): Promise<void>;
  mkdir(target: string, options: {
    recursive: boolean;
  }): Promise<unknown>;
  readCurrentDeployment(workerName: string, configPath: string): Promise<DeploymentStatusPayload | null>;
  validatePreparedArtifacts(input: {
    configPath: string;
    includeSecrets: boolean;
    runnerBundleDir: string;
    secretsFilePath: string;
    source?: EnvSource;
  }): Promise<void>;
  validateDeployEnvironment(input: {
    deployWorker: true;
    source: EnvSource;
  }): Promise<void>;
  writeFile(
    target: string,
    content: string,
    options?: {
      encoding: BufferEncoding;
      flag?: string;
    },
  ): Promise<void>;
}

interface HostedWorkerDeploymentSettings {
  containerRolloutMode: ContainerRolloutMode;
  deploymentMessage: string;
  includeSecrets: boolean;
  versionTag: string;
}

const DEFAULT_CONTAINER_ROLLOUT_BY_CONTEXT: Readonly<Record<string, ContainerRolloutMode>> = {
  production: "immediate",
};
const DEFAULT_CONTAINER_ROLLOUT_MODE: ContainerRolloutMode = "gradual";

export async function runHostedWorkerDeployment(input: {
  configPath: string;
  dependencies: HostedWorkerDeploymentDependencies;
  env?: EnvSource;
  resultPath: string;
  runnerBundleDir: string;
  secretsFilePath: string;
  workerName: string;
}): Promise<HostedWorkerDeploymentResult> {
  const env = input.env ?? process.env;
  const deploymentSettings = resolveHostedWorkerDeploymentSettings(env, () => new Date());

  await input.dependencies.validateDeployEnvironment({
    deployWorker: true,
    source: env,
  });
  await input.dependencies.validatePreparedArtifacts({
    configPath: input.configPath,
    includeSecrets: deploymentSettings.includeSecrets,
    runnerBundleDir: input.runnerBundleDir,
    secretsFilePath: input.secretsFilePath,
    source: env,
  });
  await input.dependencies.mkdir(path.dirname(input.resultPath), { recursive: true });

  const result = await runDirectDeployment({
    configPath: input.configPath,
    dependencies: input.dependencies,
    deploymentMessage: deploymentSettings.deploymentMessage,
    containerRolloutMode: deploymentSettings.containerRolloutMode,
    includeSecrets: deploymentSettings.includeSecrets,
    secretsFilePath: input.secretsFilePath,
    versionTag: deploymentSettings.versionTag,
    workerName: input.workerName,
  });

  await input.dependencies.writeFile(
    input.resultPath,
    `${JSON.stringify(result, null, 2)}\n`,
    { encoding: "utf8" },
  );
  await writeGitHubOutputs(input.dependencies, env, result);
  return result;
}

async function runDirectDeployment(input: {
  configPath: string;
  dependencies: HostedWorkerDeploymentDependencies;
  deploymentMessage: string;
  containerRolloutMode: ContainerRolloutMode;
  includeSecrets: boolean;
  secretsFilePath: string;
  versionTag: string;
  workerName: string;
}): Promise<HostedWorkerDeploymentResult> {
  await input.dependencies.deployDirect({
    containerRolloutMode: input.containerRolloutMode,
    configPath: input.configPath,
    deploymentMessage: input.deploymentMessage,
    includeSecrets: input.includeSecrets,
    secretsFilePath: input.secretsFilePath,
    versionTag: input.versionTag,
    workerName: input.workerName,
  });

  const finalDeployment = await requireCurrentDeployment(
    input.dependencies,
    input.workerName,
    input.configPath,
  );
  const finalDeploymentVersions = mapDeploymentVersions(finalDeployment);
  const smokeVersionId = requireSmokeVersionId(finalDeploymentVersions);

  return {
    finalDeploymentVersions,
    smokeVersionId,
    workerName: input.workerName,
  };
}

function resolveSmokeVersionId(
  versions: ReadonlyArray<{ percentage: number; versionId: string }>,
): string | null {
  const fullTrafficVersion = versions.find((version) => version.percentage === 100);

  return fullTrafficVersion?.versionId ?? null;
}

function requireSmokeVersionId(
  versions: ReadonlyArray<{ percentage: number; versionId: string }>,
): string {
  const smokeVersionId = resolveSmokeVersionId(versions);

  if (!smokeVersionId) {
    throw new Error("Direct deploy did not report a 100% Worker version for smoke.");
  }

  return smokeVersionId;
}

function resolveHostedWorkerDeploymentSettings(
  env: EnvSource,
  now: () => Date,
): HostedWorkerDeploymentSettings {
  const includeSecrets = readBooleanEnv(env.HOSTED_EXECUTION_INCLUDE_SECRETS, true);
  const deployContext = normalizeOptionalString(env.HOSTED_EXECUTION_DEPLOY_CONTEXT)
    ?? normalizeOptionalString(env.GITHUB_REF_NAME)
    ?? "manual";
  const versionTag = normalizeOptionalString(env.HOSTED_EXECUTION_DEPLOY_TAG)
    ?? buildDefaultVersionTag(env, now);
  const deploymentMessageOverride = normalizeOptionalString(env.HOSTED_EXECUTION_DEPLOYMENT_MESSAGE);

  return {
    containerRolloutMode: readContainerRolloutMode(
      env.HOSTED_EXECUTION_CONTAINER_ROLLOUT,
      DEFAULT_CONTAINER_ROLLOUT_BY_CONTEXT[deployContext] ?? DEFAULT_CONTAINER_ROLLOUT_MODE,
    ),
    deploymentMessage: deploymentMessageOverride ?? `${deployContext} direct deploy ${versionTag}`,
    includeSecrets,
    versionTag,
  };
}

function readContainerRolloutMode(
  value: string | undefined,
  defaultMode: ContainerRolloutMode,
): ContainerRolloutMode {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return defaultMode;
  }

  if (normalized === "gradual" || normalized === "immediate") {
    return normalized;
  }

  throw new Error("HOSTED_EXECUTION_CONTAINER_ROLLOUT must be 'gradual' or 'immediate'.");
}

async function requireCurrentDeployment(
  dependencies: HostedWorkerDeploymentDependencies,
  workerName: string,
  configPath: string,
): Promise<DeploymentStatusPayload> {
  const deployment = await dependencies.readCurrentDeployment(workerName, configPath);

  if (!deployment) {
    throw new Error("Wrangler did not return a current deployment after deploy.");
  }

  return deployment;
}

function mapDeploymentVersions(
  deployment: DeploymentStatusPayload,
): Array<{ percentage: number; versionId: string }> {
  return deployment.versions.map((version) => ({
    percentage: version.percentage,
    versionId: version.version_id,
  }));
}

function buildDefaultVersionTag(
  env: EnvSource,
  now: () => Date,
): string {
  const sha = normalizeOptionalString(env.GITHUB_SHA);

  if (sha) {
    return `git-${sha.slice(0, 12)}`;
  }

  return `manual-${now().toISOString().replaceAll(/[:.]/g, "-")}`;
}

async function writeGitHubOutputs(
  dependencies: HostedWorkerDeploymentDependencies,
  env: EnvSource,
  result: HostedWorkerDeploymentResult,
): Promise<void> {
  const outputPath = normalizeOptionalString(env.GITHUB_OUTPUT);

  if (!outputPath) {
    return;
  }

  const lines = [
    `final_version_traffic=${JSON.stringify(result.finalDeploymentVersions)}`,
    `smoke_version_id=${result.smokeVersionId}`,
  ];

  await dependencies.writeFile(outputPath, `${lines.join("\n")}\n`, {
    encoding: "utf8",
    flag: "a",
  });
}
