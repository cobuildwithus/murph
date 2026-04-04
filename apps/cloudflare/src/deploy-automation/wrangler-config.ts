import path from "node:path";
import { fileURLToPath } from "node:url";

import type { HostedDeployAutomationEnvironment } from "./environment.ts";
import { HOSTED_WORKER_REQUIRED_SECRET_NAMES } from "./secrets.ts";

const DEFAULT_DEPLOY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

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
