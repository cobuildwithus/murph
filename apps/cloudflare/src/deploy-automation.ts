import path from "node:path";
import { fileURLToPath } from "node:url";

export const HOSTED_WORKER_REQUIRED_SECRET_NAMES = [
  "HOSTED_EXECUTION_SIGNING_SECRET",
  "HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY",
  "HOSTED_EXECUTION_CONTROL_TOKEN",
  "HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN",
] as const;

const HOSTED_WORKER_OPTIONAL_SECRET_NAMES = [
  "AGENTMAIL_API_KEY",
  "HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEYRING_JSON",
  "ANTHROPIC_API_KEY",
  "DEVICE_SYNC_SECRET",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "LINQ_API_TOKEN",
  "LINQ_WEBHOOK_SECRET",
  "MISTRAL_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "OURA_CLIENT_ID",
  "OURA_CLIENT_SECRET",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "TOGETHER_API_KEY",
  "WHOOP_CLIENT_ID",
  "WHOOP_CLIENT_SECRET",
  "XAI_API_KEY",
] as const;

const HOSTED_WORKER_OPTIONAL_VAR_NAMES = [
  "AGENTMAIL_BASE_URL",
  "DEVICE_SYNC_PUBLIC_BASE_URL",
  "FFMPEG_COMMAND",
  "HOSTED_EXECUTION_ALLOWED_WEB_CONTROL_HOSTS",
  "HOSTED_EXECUTION_CONTAINER_SLEEP_AFTER",
  "LINQ_API_BASE_URL",
  "PDFTOTEXT_COMMAND",
  "TELEGRAM_API_BASE_URL",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_FILE_BASE_URL",
  "WHISPER_COMMAND",
  "WHISPER_MODEL_PATH",
] as const;

const HOSTED_CONTAINER_IMAGE_VAR_NAMES = [
  "INSTALL_PADDLEOCR",
] as const;

const DEFAULT_DEPLOY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONTAINER_INSTANCE_TYPE = "basic";
const DEFAULT_CONTAINER_MAX_INSTANCES = 50;
const DEFAULT_CONTAINER_SLEEP_AFTER = "5m";
const DEFAULT_LOG_HEAD_SAMPLING_RATE = 1;
const DEFAULT_TRACE_HEAD_SAMPLING_RATE = 0.1;
const HOSTED_WORKER_GRADUAL_DEPLOYMENT_SAFE_MIGRATION_TAGS = new Set(["v1", "v2"]);
const NAMED_CONTAINER_INSTANCE_TYPES = new Set([
  "basic",
  "dev",
  "lite",
  "standard",
  "standard-1",
  "standard-2",
  "standard-3",
  "standard-4",
] as const);

type NamedContainerInstanceType =
  | "basic"
  | "dev"
  | "lite"
  | "standard"
  | "standard-1"
  | "standard-2"
  | "standard-3"
  | "standard-4";

export interface HostedContainerCustomInstanceType {
  disk_mb: number;
  memory_mib: number;
  vcpu: number;
}

export type HostedContainerInstanceType =
  | NamedContainerInstanceType
  | HostedContainerCustomInstanceType;

export interface HostedDeployAutomationEnvironment {
  allowedUserEnvKeys: string | null;
  allowedUserEnvPrefixes: string | null;
  bundlesBucketName: string;
  bundlesPreviewBucketName: string;
  bundleEncryptionKeyId: string;
  compatibilityDate: string;
  containerInstanceType: HostedContainerInstanceType;
  containerMaxInstances: number;
  defaultAlarmDelayMs: string;
  imageVars: Record<string, string>;
  logHeadSamplingRate: number;
  maxEventAttempts: string;
  retryDelayMs: string;
  runnerCommitTimeoutMs: string;
  runnerTimeoutMs: string;
  traceHeadSamplingRate: number;
  workerName: string;
  workerVars: Record<string, string>;
}

export interface HostedWorkerDeploymentVersionTraffic {
  percentage: number;
  versionId: string;
}

export interface HostedWorkerGradualDeploymentSupport {
  directDeployRequiredReason: string | null;
  gradualDeploymentsSupported: boolean;
  migrationTags: string[];
}

export interface HostedContainerImageListing {
  name: string;
  tags: string[];
}

export interface HostedContainerImageTagReference {
  image: string;
  repository: string;
  tag: string;
}

type EnvSource = Readonly<Record<string, string | undefined>>;

export function readHostedDeployAutomationEnvironment(
  source: EnvSource = process.env,
): HostedDeployAutomationEnvironment {
  return {
    allowedUserEnvKeys: normalizeString(source.CF_ALLOWED_USER_ENV_KEYS),
    allowedUserEnvPrefixes: normalizeString(source.CF_ALLOWED_USER_ENV_PREFIXES),
    bundlesBucketName: requireString(source.CF_BUNDLES_BUCKET, "CF_BUNDLES_BUCKET"),
    bundlesPreviewBucketName: requireString(
      source.CF_BUNDLES_PREVIEW_BUCKET,
      "CF_BUNDLES_PREVIEW_BUCKET",
    ),
    bundleEncryptionKeyId: normalizeString(source.CF_BUNDLE_KEY_ID) ?? "v1",
    compatibilityDate: normalizeString(source.CF_COMPATIBILITY_DATE) ?? "2026-03-27",
    containerInstanceType: normalizeContainerInstanceType(
      source.CF_CONTAINER_INSTANCE_TYPE,
      DEFAULT_CONTAINER_INSTANCE_TYPE,
      "CF_CONTAINER_INSTANCE_TYPE",
    ),
    containerMaxInstances: normalizePositiveInteger(
      source.CF_CONTAINER_MAX_INSTANCES,
      DEFAULT_CONTAINER_MAX_INSTANCES,
      "CF_CONTAINER_MAX_INSTANCES",
    ),
    defaultAlarmDelayMs: normalizePositiveIntegerString(
      source.CF_DEFAULT_ALARM_DELAY_MS,
      "21600000",
      "CF_DEFAULT_ALARM_DELAY_MS",
    ),
    imageVars: readPresentStringMap(source, HOSTED_CONTAINER_IMAGE_VAR_NAMES),
    logHeadSamplingRate: normalizeSamplingRate(
      source.CF_LOG_HEAD_SAMPLING_RATE,
      DEFAULT_LOG_HEAD_SAMPLING_RATE,
      "CF_LOG_HEAD_SAMPLING_RATE",
    ),
    maxEventAttempts: normalizePositiveIntegerString(
      source.CF_MAX_EVENT_ATTEMPTS,
      "3",
      "CF_MAX_EVENT_ATTEMPTS",
    ),
    retryDelayMs: normalizePositiveIntegerString(
      source.CF_RETRY_DELAY_MS,
      "30000",
      "CF_RETRY_DELAY_MS",
    ),
    runnerCommitTimeoutMs: normalizePositiveIntegerString(
      normalizeString(source.CF_RUNNER_COMMIT_TIMEOUT_MS) ?? "30000",
      "30000",
      "CF_RUNNER_COMMIT_TIMEOUT_MS",
    ),
    runnerTimeoutMs: normalizePositiveIntegerString(
      source.CF_RUNNER_TIMEOUT_MS,
      "60000",
      "CF_RUNNER_TIMEOUT_MS",
    ),
    traceHeadSamplingRate: normalizeSamplingRate(
      source.CF_TRACE_HEAD_SAMPLING_RATE,
      DEFAULT_TRACE_HEAD_SAMPLING_RATE,
      "CF_TRACE_HEAD_SAMPLING_RATE",
    ),
    workerName: requireString(source.CF_WORKER_NAME, "CF_WORKER_NAME"),
    workerVars: readHostedWorkerVars(source),
  };
}

export function buildHostedWranglerDeployConfig(
  environment: HostedDeployAutomationEnvironment,
): Record<string, unknown> {
  const vars: Record<string, string> = {
    HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY_ID: environment.bundleEncryptionKeyId,
    HOSTED_EXECUTION_DEFAULT_ALARM_DELAY_MS: environment.defaultAlarmDelayMs,
    HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS: environment.maxEventAttempts,
    HOSTED_EXECUTION_RETRY_DELAY_MS: environment.retryDelayMs,
    HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: environment.runnerCommitTimeoutMs,
    HOSTED_EXECUTION_RUNNER_TIMEOUT_MS: environment.runnerTimeoutMs,
    ...environment.workerVars,
  };

  if (environment.allowedUserEnvKeys) {
    vars.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS = environment.allowedUserEnvKeys;
  }

  if (environment.allowedUserEnvPrefixes) {
    vars.HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES = environment.allowedUserEnvPrefixes;
  }

  return {
    $schema: "../node_modules/wrangler/config-schema.json",
    name: environment.workerName,
    main: "../src/index.ts",
    compatibility_date: environment.compatibilityDate,
    compatibility_flags: ["nodejs_compat"],
    containers: [
      {
        class_name: "RunnerContainer",
        image: "../../../Dockerfile.cloudflare-hosted-runner",
        instance_type: environment.containerInstanceType,
        ...(Object.keys(environment.imageVars).length > 0
          ? {
              image_vars: environment.imageVars,
            }
          : {}),
        max_instances: environment.containerMaxInstances,
      },
    ],
    durable_objects: {
      bindings: [
        {
          name: "USER_RUNNER",
          class_name: "UserRunnerDurableObject",
        },
        {
          name: "RUNNER_CONTAINER",
          class_name: "RunnerContainer",
        },
      ],
    },
    migrations: [
      {
        tag: "v1",
        new_sqlite_classes: ["UserRunnerDurableObject"],
      },
      {
        tag: "v2",
        new_sqlite_classes: ["RunnerContainer"],
      },
    ],
    r2_buckets: [
      {
        binding: "BUNDLES",
        bucket_name: environment.bundlesBucketName,
        preview_bucket_name: environment.bundlesPreviewBucketName,
      },
    ],
    observability: {
      enabled: true,
      head_sampling_rate: environment.logHeadSamplingRate,
      traces: {
        enabled: true,
        head_sampling_rate: environment.traceHeadSamplingRate,
      },
    },
    secrets: {
      required: [...HOSTED_WORKER_REQUIRED_SECRET_NAMES],
    },
    vars,
  };
}

function readHostedWorkerVars(source: EnvSource): Record<string, string> {
  const normalized: Record<string, string | undefined> = {};

  for (const key of HOSTED_WORKER_OPTIONAL_VAR_NAMES) {
    const resolved = normalizeString(source[key]);
    normalized[key] = resolved
      ?? (key === "HOSTED_EXECUTION_CONTAINER_SLEEP_AFTER" ? DEFAULT_CONTAINER_SLEEP_AFTER : undefined);
  }

  return readPresentStringMap(normalized, HOSTED_WORKER_OPTIONAL_VAR_NAMES);
}

export function resolveHostedWorkerDeploymentTraffic(input: {
  candidateVersionId: string;
  currentDeploymentVersions: HostedWorkerDeploymentVersionTraffic[];
  rolloutPercentage: number;
}): HostedWorkerDeploymentVersionTraffic[] {
  const rolloutPercentage = normalizeRolloutPercentage(input.rolloutPercentage);
  const currentDeploymentVersions = input.currentDeploymentVersions.map((version) => ({
    percentage: normalizeRolloutPercentage(version.percentage),
    versionId: version.versionId,
  }));

  if (currentDeploymentVersions.length === 0) {
    throw new Error(
      "Gradual deployments require an existing deployment. Use a direct deploy for the first rollout.",
    );
  }

  if (currentDeploymentVersions.length > 2) {
    throw new Error("Cloudflare gradual deployments support at most two active versions.");
  }

  const candidateIndex = currentDeploymentVersions.findIndex(
    ({ versionId }) => versionId === input.candidateVersionId,
  );

  if (currentDeploymentVersions.length === 1) {
    const [currentVersion] = currentDeploymentVersions;

    if (currentVersion.versionId === input.candidateVersionId) {
      if (rolloutPercentage !== 100) {
        throw new Error(
          "The candidate version is already 100% deployed. Select a different candidate or use a 100% rollout.",
        );
      }

      return [currentVersion];
    }

    if (rolloutPercentage === 100) {
      return [
        {
          percentage: 100,
          versionId: input.candidateVersionId,
        },
      ];
    }

    return [
      {
        percentage: 100 - rolloutPercentage,
        versionId: currentVersion.versionId,
      },
      {
        percentage: rolloutPercentage,
        versionId: input.candidateVersionId,
      },
    ];
  }

  if (candidateIndex === -1) {
    throw new Error(
      "The current deployment already splits traffic between two versions. Finish or roll back that deployment before introducing a new candidate version.",
    );
  }

  const remainingPercentage = 100 - rolloutPercentage;
  const nextTraffic = currentDeploymentVersions.map((version, index) => ({
    percentage: index === candidateIndex ? rolloutPercentage : remainingPercentage,
    versionId: version.versionId,
  }));

  if (rolloutPercentage === 100) {
    return [
      {
        percentage: 100,
        versionId: input.candidateVersionId,
      },
    ];
  }

  return nextTraffic;
}

export function formatHostedWorkerDeploymentVersionSpecs(
  traffic: HostedWorkerDeploymentVersionTraffic[],
): string[] {
  return traffic.map(({ percentage, versionId }) => `${versionId}@${percentage}`);
}

export function resolveHostedWorkerGradualDeploymentSupport(
  config: Record<string, unknown>,
): HostedWorkerGradualDeploymentSupport {
  const migrationTags = readHostedWorkerMigrationTags(config);
  const unsupportedMigrationTags = migrationTags.filter(
    (tag) => !HOSTED_WORKER_GRADUAL_DEPLOYMENT_SAFE_MIGRATION_TAGS.has(tag),
  );

  if (unsupportedMigrationTags.length > 0) {
    return {
      directDeployRequiredReason: [
        "Rendered Wrangler config includes unsupported Durable Object migration tag(s)",
        unsupportedMigrationTags.map((tag) => `\`${tag}\``).join(", "),
        "for gradual versions/deployments.",
        "Use HOSTED_EXECUTION_DEPLOYMENT_MODE=direct for the migration rollout first.",
      ].join(" "),
      gradualDeploymentsSupported: false,
      migrationTags,
    };
  }

  return {
    directDeployRequiredReason: null,
    gradualDeploymentsSupported: true,
    migrationTags,
  };
}

export function buildHostedWorkerSecretsPayload(
  source: EnvSource = process.env,
): Record<string, string> {
  return {
    ...readRequiredStringMap(source, HOSTED_WORKER_REQUIRED_SECRET_NAMES),
    ...readPresentStringMap(source, HOSTED_WORKER_OPTIONAL_SECRET_NAMES),
  };
}

export function resolveCloudflareDeployPaths(baseDir = DEFAULT_DEPLOY_ROOT): {
  deployDir: string;
  workerSecretsPath: string;
  wranglerConfigPath: string;
} {
  const deployDir = path.join(baseDir, ".deploy");

  return {
    deployDir,
    workerSecretsPath: path.join(deployDir, "worker-secrets.json"),
    wranglerConfigPath: path.join(deployDir, "wrangler.generated.jsonc"),
  };
}

export function parseHostedContainerImageListOutput(
  output: string,
): HostedContainerImageListing[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(output) as unknown;
  } catch (error) {
    throw new Error(
      `Cloudflare image list output must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Cloudflare image list output must be an array.");
  }

  return parsed.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Cloudflare image list entry ${index} must be an object.`);
    }

    const record = entry as Record<string, unknown>;
    const name = requireString(
      typeof record.name === "string" ? record.name : undefined,
      `Cloudflare image list entry ${index} name`,
    );
    const tags = Array.isArray(record.tags)
      ? record.tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0 && !tag.startsWith("sha256"))
      : [];

    return [{
      name,
      tags,
    }];
  });
}

export function selectHostedContainerImageTagsForCleanup(input: {
  images: HostedContainerImageListing[];
  keepPerRepository: number;
}): HostedContainerImageTagReference[] {
  if (!Number.isInteger(input.keepPerRepository) || input.keepPerRepository < 0) {
    throw new Error("keepPerRepository must be a non-negative integer.");
  }

  return input.images.flatMap((image) => {
    const sortedTags = [...new Set(image.tags)].sort((left, right) => right.localeCompare(left));
    const tagsToDelete = sortedTags.slice(input.keepPerRepository);

    return tagsToDelete.map((tag) => ({
      image: `${image.name}:${tag}`,
      repository: image.name,
      tag,
    }));
  });
}

function normalizePositiveInteger(
  value: string | undefined,
  fallback: number,
  label: string,
): number {
  const normalized = normalizeString(value);

  if (!normalized) {
    return fallback;
  }

  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

function normalizeContainerInstanceType(
  value: string | undefined,
  fallback: HostedContainerInstanceType,
  label: string,
): HostedContainerInstanceType {
  const normalized = normalizeString(value);

  if (!normalized) {
    return fallback;
  }

  if (NAMED_CONTAINER_INSTANCE_TYPES.has(normalized as NamedContainerInstanceType)) {
    return normalized as NamedContainerInstanceType;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error(
      `${label} must be one of ${Array.from(NAMED_CONTAINER_INSTANCE_TYPES).join(", ")} or a JSON object with vcpu, memory_mib, and disk_mb.`,
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(`${label} custom values must be a JSON object.`);
  }

  const vcpu = requirePositiveNumber(parsed.vcpu, `${label}.vcpu`);
  const memory_mib = requirePositiveNumber(parsed.memory_mib, `${label}.memory_mib`);
  const disk_mb = requirePositiveNumber(parsed.disk_mb, `${label}.disk_mb`);
  const unknownKeys = Object.keys(parsed).filter(
    (key) => key !== "disk_mb" && key !== "memory_mib" && key !== "vcpu",
  );

  if (unknownKeys.length > 0) {
    throw new Error(`${label} custom values include unsupported keys: ${unknownKeys.join(", ")}.`);
  }

  return {
    disk_mb,
    memory_mib,
    vcpu,
  };
}

function normalizePositiveIntegerString(
  value: string | undefined,
  fallback: string,
  label: string,
): string {
  const normalized = normalizeString(value) ?? fallback;
  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer string.`);
  }

  return String(parsed);
}

function normalizeSamplingRate(
  value: string | undefined,
  fallback: number,
  label: string,
): number {
  const normalized = normalizeString(value);

  if (!normalized) {
    return fallback;
  }

  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${label} must be a number between 0 and 1.`);
  }

  return parsed;
}

function requirePositiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }

  return value;
}

function normalizeRolloutPercentage(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error("Hosted rollout percentages must be integers between 0 and 100.");
  }

  return value;
}

function normalizeString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function requireString(value: string | undefined, label: string): string {
  const normalized = normalizeString(value);

  if (!normalized) {
    throw new Error(`${label} must be configured.`);
  }

  return normalized;
}

function readHostedWorkerMigrationTags(config: Record<string, unknown>): string[] {
  const migrations = config.migrations;

  if (!Array.isArray(migrations)) {
    return [];
  }

  return migrations.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const tag = "tag" in entry ? normalizeString(String(entry.tag)) : null;
    return tag ? [tag] : [];
  });
}

function readPresentStringMap(
  source: EnvSource,
  keys: readonly string[],
): Record<string, string> {
  const entries = keys.flatMap((key) => {
    const value = normalizeString(source[key]);
    return value ? [[key, value] as const] : [];
  });

  return Object.fromEntries(entries);
}

function readRequiredStringMap(
  source: EnvSource,
  keys: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    keys.map((key) => [key, requireString(source[key], key)]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
