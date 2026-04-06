import path from "node:path";

import {
  formatHostedWorkerDeploymentVersionSpecs,
  resolveHostedWorkerGradualDeploymentSupport,
  resolveHostedWorkerDeploymentTraffic,
} from "../src/deploy-automation/deployment-traffic.js";

type EnvSource = Readonly<Record<string, string | undefined>>;

export type DeploymentMode = "direct" | "gradual";

export interface DeploymentStatusPayload {
  created_on: string;
  versions: Array<{
    percentage: number;
    version_id: string;
  }>;
}

export interface HostedWorkerDeploymentResult {
  candidateVersionId: string | null;
  currentDeploymentVersions: Array<{
    percentage: number;
    versionId: string;
  }> | null;
  finalDeploymentVersions: Array<{
    percentage: number;
    versionId: string;
  }>;
  mode: DeploymentMode;
  rolloutPercentage: number | null;
  smokeVersionId: string | null;
  uploadedVersionId: string | null;
  workerName: string;
}

export interface HostedWorkerDeploymentDependencies {
  deployDirect(input: {
    configPath: string;
    deploymentMessage: string;
    includeSecrets: boolean;
    secretsFilePath: string;
    versionTag: string;
    workerName: string;
  }): Promise<void>;
  deployVersions(input: {
    configPath: string;
    deploymentMessage: string;
    versionSpecs: string[];
    workerName: string;
  }): Promise<void>;
  mkdir(target: string, options: {
    recursive: boolean;
  }): Promise<unknown>;
  readCurrentDeployment(workerName: string, configPath: string): Promise<DeploymentStatusPayload | null>;
  readRenderedDeployConfig(configPath: string): Promise<Record<string, unknown>>;
  uploadVersion(input: {
    configPath: string;
    includeSecrets: boolean;
    message: string;
    secretsFilePath: string;
    tag: string;
    workerName: string;
  }): Promise<string>;
  writeFile(
    target: string,
    content: string,
    options?: {
      encoding: BufferEncoding;
      flag?: string;
    },
  ): Promise<void>;
}

interface HostedWorkerDeploymentSettingsBase {
  deploymentMessage: string;
  includeSecrets: boolean;
  versionTag: string;
}

interface HostedWorkerDirectDeploymentSettings extends HostedWorkerDeploymentSettingsBase {
  mode: "direct";
}

interface HostedWorkerGradualDeploymentSettings extends HostedWorkerDeploymentSettingsBase {
  existingVersionId: string | null;
  mode: "gradual";
  rolloutPercentage: number;
  versionMessage: string;
}

type HostedWorkerDeploymentSettings =
  | HostedWorkerDirectDeploymentSettings
  | HostedWorkerGradualDeploymentSettings;

export async function runHostedWorkerDeployment(input: {
  configPath: string;
  dependencies: HostedWorkerDeploymentDependencies;
  env?: EnvSource;
  resultPath: string;
  secretsFilePath: string;
  workerName: string;
}): Promise<HostedWorkerDeploymentResult> {
  const env = input.env ?? process.env;
  const deploymentSettings = resolveHostedWorkerDeploymentSettings(env, () => new Date());

  await input.dependencies.mkdir(path.dirname(input.resultPath), { recursive: true });

  let result: HostedWorkerDeploymentResult;

  if (deploymentSettings.mode === "direct") {
    result = await runDirectDeployment({
      configPath: input.configPath,
      dependencies: input.dependencies,
      deploymentMessage: deploymentSettings.deploymentMessage,
      includeSecrets: deploymentSettings.includeSecrets,
      secretsFilePath: input.secretsFilePath,
      versionTag: deploymentSettings.versionTag,
      workerName: input.workerName,
    });
  } else {
    result = await runGradualDeployment({
      configPath: input.configPath,
      dependencies: input.dependencies,
      deploymentMessage: deploymentSettings.deploymentMessage,
      existingVersionId: deploymentSettings.existingVersionId,
      includeSecrets: deploymentSettings.includeSecrets,
      rolloutPercentage: deploymentSettings.rolloutPercentage,
      secretsFilePath: input.secretsFilePath,
      versionMessage: deploymentSettings.versionMessage,
      versionTag: deploymentSettings.versionTag,
      workerName: input.workerName,
    });
  }

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
  includeSecrets: boolean;
  secretsFilePath: string;
  versionTag: string;
  workerName: string;
}): Promise<HostedWorkerDeploymentResult> {
  await input.dependencies.deployDirect({
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

  return {
    candidateVersionId: finalDeploymentVersions[0]?.versionId ?? null,
    currentDeploymentVersions: null,
    finalDeploymentVersions,
    mode: "direct",
    rolloutPercentage: null,
    smokeVersionId: null,
    uploadedVersionId: null,
    workerName: input.workerName,
  };
}

async function runGradualDeployment(input: {
  configPath: string;
  dependencies: HostedWorkerDeploymentDependencies;
  deploymentMessage: string;
  existingVersionId: string | null;
  includeSecrets: boolean;
  rolloutPercentage: number;
  secretsFilePath: string;
  versionMessage: string;
  versionTag: string;
  workerName: string;
}): Promise<HostedWorkerDeploymentResult> {
  const deploymentConfig = await input.dependencies.readRenderedDeployConfig(input.configPath);
  const gradualDeploymentSupport = resolveHostedWorkerGradualDeploymentSupport(deploymentConfig);

  if (!gradualDeploymentSupport.gradualDeploymentsSupported) {
    throw new Error(
      gradualDeploymentSupport.directDeployRequiredReason
      ?? "The rendered Wrangler config requires a direct deploy.",
    );
  }

  const currentDeployment = await input.dependencies.readCurrentDeployment(
    input.workerName,
    input.configPath,
  );

  if (!currentDeployment) {
    throw new Error(
      "No current Cloudflare deployment exists yet. Use HOSTED_EXECUTION_DEPLOYMENT_MODE=direct for the first deploy or for Durable Object migration rollouts.",
    );
  }

  if (input.existingVersionId && input.includeSecrets) {
    console.warn(
      "HOSTED_EXECUTION_INCLUDE_SECRETS is ignored when HOSTED_EXECUTION_DEPLOY_VERSION_ID is provided because no new version upload is created.",
    );
  }

  const uploadedVersionId = input.existingVersionId
    ? null
    : await input.dependencies.uploadVersion({
        configPath: input.configPath,
        includeSecrets: input.includeSecrets,
        message: input.versionMessage,
        secretsFilePath: input.secretsFilePath,
        tag: input.versionTag,
        workerName: input.workerName,
      });
  const candidateVersionId = input.existingVersionId ?? uploadedVersionId;

  if (!candidateVersionId) {
    throw new Error("Expected a candidate version id after upload or explicit version selection.");
  }

  const currentDeploymentVersions = mapDeploymentVersions(currentDeployment);
  const versionTraffic = resolveHostedWorkerDeploymentTraffic({
    candidateVersionId,
    currentDeploymentVersions,
    rolloutPercentage: input.rolloutPercentage,
  });

  await input.dependencies.deployVersions({
    configPath: input.configPath,
    deploymentMessage: input.deploymentMessage,
    versionSpecs: formatHostedWorkerDeploymentVersionSpecs(versionTraffic),
    workerName: input.workerName,
  });

  const finalDeployment = await requireCurrentDeployment(
    input.dependencies,
    input.workerName,
    input.configPath,
  );

  return {
    candidateVersionId,
    currentDeploymentVersions,
    finalDeploymentVersions: mapDeploymentVersions(finalDeployment),
    mode: "gradual",
    rolloutPercentage: input.rolloutPercentage,
    smokeVersionId: candidateVersionId,
    uploadedVersionId,
    workerName: input.workerName,
  };
}

function resolveHostedWorkerDeploymentSettings(
  env: EnvSource,
  now: () => Date,
): HostedWorkerDeploymentSettings {
  const mode = readDeploymentMode(env.HOSTED_EXECUTION_DEPLOYMENT_MODE);
  const includeSecrets = readBooleanEnv(env.HOSTED_EXECUTION_INCLUDE_SECRETS, true);
  const deployContext = normalizeString(env.HOSTED_EXECUTION_DEPLOY_CONTEXT)
    ?? normalizeString(env.GITHUB_REF_NAME)
    ?? "manual";
  const versionTag = normalizeString(env.HOSTED_EXECUTION_DEPLOY_TAG)
    ?? buildDefaultVersionTag(env, now);
  const deploymentMessageOverride = normalizeString(env.HOSTED_EXECUTION_DEPLOYMENT_MESSAGE);

  if (mode === "direct") {
    return {
      deploymentMessage: deploymentMessageOverride ?? `${deployContext} direct deploy ${versionTag}`,
      includeSecrets,
      mode,
      versionTag,
    };
  }

  const rolloutPercentage = readRolloutPercentage(env.HOSTED_EXECUTION_GRADUAL_ROLLOUT_PERCENTAGE);
  const versionMessage = normalizeString(env.HOSTED_EXECUTION_VERSION_MESSAGE)
    ?? `${deployContext} version ${versionTag}`;

  return {
    deploymentMessage: deploymentMessageOverride ?? `${deployContext} rollout ${rolloutPercentage}% ${versionTag}`,
    existingVersionId: normalizeString(env.HOSTED_EXECUTION_DEPLOY_VERSION_ID),
    includeSecrets,
    mode,
    rolloutPercentage,
    versionMessage,
    versionTag,
  };
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

function readDeploymentMode(value: string | undefined): DeploymentMode {
  const normalized = normalizeString(value);

  if (!normalized) {
    return "gradual";
  }

  if (normalized === "direct" || normalized === "gradual") {
    return normalized;
  }

  throw new Error("HOSTED_EXECUTION_DEPLOYMENT_MODE must be 'direct' or 'gradual'.");
}

function readRolloutPercentage(value: string | undefined): number {
  const normalized = normalizeString(value) ?? "10";
  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new Error("HOSTED_EXECUTION_GRADUAL_ROLLOUT_PERCENTAGE must be an integer between 0 and 100.");
  }

  return parsed;
}

function readBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  const normalized = normalizeString(value);

  if (!normalized) {
    return fallback;
  }

  if (normalized === "1" || normalized === "true") {
    return true;
  }

  if (normalized === "0" || normalized === "false") {
    return false;
  }

  throw new Error("Boolean env values must be one of: 1, 0, true, false.");
}

function normalizeString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildDefaultVersionTag(
  env: EnvSource,
  now: () => Date,
): string {
  const sha = normalizeString(env.GITHUB_SHA);

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
  const outputPath = normalizeString(env.GITHUB_OUTPUT);

  if (!outputPath) {
    return;
  }

  const lines = [
    `candidate_version_id=${result.candidateVersionId ?? ""}`,
    `deployment_mode=${result.mode}`,
    `final_version_traffic=${JSON.stringify(result.finalDeploymentVersions)}`,
    `smoke_version_id=${result.smokeVersionId ?? ""}`,
    `uploaded_version_id=${result.uploadedVersionId ?? ""}`,
  ];

  await dependencies.writeFile(outputPath, `${lines.join("\n")}\n`, {
    encoding: "utf8",
    flag: "a",
  });
}
