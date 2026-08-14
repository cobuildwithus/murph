import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveHostedEmailSenderIdentity } from "@murphai/hosted-execution/hosted-email";

import { HOSTED_EMAIL_SEND_BINDING_NAME } from "../../src/hosted-email/constants.ts";
import type { HostedDeployAutomationEnvironment } from "./environment.ts";
import { HOSTED_WORKER_REQUIRED_SECRET_NAMES } from "./secrets.ts";

const DEFAULT_DEPLOY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const RUNNER_CONTAINER_ROLLOUT_ACTIVE_GRACE_PERIOD_SECONDS = 300;
const DEPLOY_SMOKE_CONTAINER_ROLLOUT_ACTIVE_GRACE_PERIOD_SECONDS = 0;
const CONTAINER_ROLLOUT_STEP_PERCENTAGE = [10, 25, 50, 100] as const;
const DEVICE_WEBHOOK_QUEUE_SUFFIX = "device-webhooks";
const DEVICE_WEBHOOK_DLQ_SUFFIX = "device-webhooks-dlq";

function resolveContainerRolloutStepPercentage(maxInstances: number): number[] {
  if (maxInstances >= CONTAINER_ROLLOUT_STEP_PERCENTAGE.length) {
    return [...CONTAINER_ROLLOUT_STEP_PERCENTAGE];
  }

  return CONTAINER_ROLLOUT_STEP_PERCENTAGE.slice(-maxInstances);
}

export function buildHostedWranglerDeployConfig(
  environment: HostedDeployAutomationEnvironment,
  options: {
    runnerBundleManifest?: {
      bundleFingerprint: string;
      sourceFingerprint: string;
    } | null;
  } = {},
): Record<string, unknown> {
  const vars: Record<string, string> = {
    HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS: environment.maxEventAttempts,
    HOSTED_EXECUTION_RETRY_DELAY_MS: environment.retryDelayMs,
    HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: environment.runnerCommitTimeoutMs,
    HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS: environment.runnerReadyTimeoutMs,
    HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS: environment.webControlTimeoutMs,
    ...environment.workerVars,
  };

  if (options.runnerBundleManifest) {
    vars.HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT =
      options.runnerBundleManifest.bundleFingerprint;
    vars.HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT =
      options.runnerBundleManifest.sourceFingerprint;
  }

  if (environment.allowedRunnerSecretKeys) {
    vars.HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS = environment.allowedRunnerSecretKeys;
  }

  const sendEmailBindings = buildHostedEmailSendBindings(environment.workerVars);
  const deviceWebhookQueueName = `${environment.workerName}-${DEVICE_WEBHOOK_QUEUE_SUFFIX}`;
  const deviceWebhookDlqName = `${environment.workerName}-${DEVICE_WEBHOOK_DLQ_SUFFIX}`;
  const buildRunnerContainerConfig = (input: {
    className: string;
    maxInstances: number;
    rolloutActiveGracePeriodSeconds: number;
  }): Record<string, unknown> => {
    const container: Record<string, unknown> = {
      class_name: input.className,
      image: "../../../Dockerfile.cloudflare-hosted-runner",
      image_build_context: "..",
      instance_type: environment.containerInstanceType,
      max_instances: input.maxInstances,
      rollout_active_grace_period: input.rolloutActiveGracePeriodSeconds,
      rollout_step_percentage: resolveContainerRolloutStepPercentage(input.maxInstances),
      ssh: { enabled: false },
    };

    return container;
  };

  return {
    $schema: "../node_modules/wrangler/config-schema.json",
    name: environment.workerName,
    main: "../src/index.ts",
    compatibility_date: environment.compatibilityDate,
    compatibility_flags: ["nodejs_compat", "containers_pid_namespace"],
    placement: {
      mode: "smart",
    },
    containers: [
      buildRunnerContainerConfig({
        className: "RunnerContainer",
        maxInstances: environment.containerMaxInstances,
        rolloutActiveGracePeriodSeconds:
          RUNNER_CONTAINER_ROLLOUT_ACTIVE_GRACE_PERIOD_SECONDS,
      }),
      buildRunnerContainerConfig({
        className: "DeploySmokeRunnerContainer",
        maxInstances: 1,
        rolloutActiveGracePeriodSeconds:
          DEPLOY_SMOKE_CONTAINER_ROLLOUT_ACTIVE_GRACE_PERIOD_SECONDS,
      }),
    ],
    durable_objects: {
      bindings: [
        {
          name: "USER_RUNNER",
          class_name: "UserRunnerDurableObject",
        },
        {
          name: "DATABASE_HEALTH_MONITOR",
          class_name: "DatabaseHealthDurableObject",
        },
        {
          name: "DEVICE_WEBHOOK_QUEUE_MONITOR",
          class_name: "DeviceWebhookQueueHealthDurableObject",
        },
        {
          name: "RUNNER_CONTAINER",
          class_name: "RunnerContainer",
        },
        {
          name: "RUNNER_CONTAINER_SMOKE",
          class_name: "DeploySmokeRunnerContainer",
        },
      ],
    },
    version_metadata: {
      binding: "CF_VERSION_METADATA",
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
      {
        tag: "v3",
        new_sqlite_classes: ["DeploySmokeRunnerContainer"],
      },
      {
        tag: "v4",
        new_sqlite_classes: ["DatabaseHealthDurableObject"],
      },
      {
        tag: "v5",
        new_sqlite_classes: ["DeviceWebhookQueueHealthDurableObject"],
      },
    ],
    triggers: {
      crons: ["*/5 * * * *"],
    },
    queues: {
      producers: [
        {
          binding: "DEVICE_WEBHOOK_QUEUE",
          queue: deviceWebhookQueueName,
        },
        {
          binding: "DEVICE_WEBHOOK_DLQ",
          queue: deviceWebhookDlqName,
        },
      ],
      consumers: [
        {
          dead_letter_queue: deviceWebhookDlqName,
          max_batch_size: 100,
          max_batch_timeout: 5,
          max_concurrency: 1,
          max_retries: 10,
          retry_delay: 30,
          queue: deviceWebhookQueueName,
        },
      ],
    },
    r2_buckets: [
      {
        binding: "BUNDLES",
        bucket_name: environment.bundlesBucketName,
        preview_bucket_name: environment.bundlesPreviewBucketName,
      },
    ],
    analytics_engine_datasets: [
      {
        binding: "HOSTED_RUNTIME_RETRY_ANALYTICS",
        dataset: "murph_hosted_runtime_retries",
      },
    ],
    ai: {
      binding: "AI",
    },
    ...(sendEmailBindings.length > 0
      ? {
          send_email: sendEmailBindings,
        }
      : {}),
    observability: {
      enabled: true,
      head_sampling_rate: environment.logHeadSamplingRate,
      logs: {
        enabled: true,
        invocation_logs: false,
        persist: true,
        head_sampling_rate: environment.logHeadSamplingRate,
      },
      traces: {
        enabled: true,
        persist: true,
        head_sampling_rate: environment.traceHeadSamplingRate,
      },
    },
    secrets: {
      required: [...HOSTED_WORKER_REQUIRED_SECRET_NAMES],
    },
    vars,
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

function buildHostedEmailSendBindings(
  workerVars: Readonly<Record<string, string>>,
): Array<{
  allowed_sender_addresses?: string[];
  name: string;
}> {
  const senderIdentity = resolveHostedEmailSenderIdentity(workerVars);
  if (!senderIdentity) {
    return [];
  }

  return [{
    allowed_sender_addresses: [senderIdentity],
    name: HOSTED_EMAIL_SEND_BINDING_NAME,
  }];
}
