import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedWorkerSecretsPayload,
  buildHostedWranglerDeployConfig,
  HOSTED_WORKER_REQUIRED_SECRET_NAMES,
  HOSTED_WORKER_REQUIRED_VAR_NAMES,
  parseHostedContainerImageListOutput,
  readHostedDeployAutomationEnvironment,
  resolveCloudflareDeployPaths,
  selectHostedContainerImageTagsForCleanup,
} from "../scripts/deploy-automation.js";
import { renderWorkerSecretsFile } from "../scripts/render-worker-secrets.ts";
import { buildHostedRunnerContainerPlatformEnv } from "../src/runner-env.ts";
import { parseJsoncObject } from "./helpers/jsonc.js";

afterEach(() => {
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
});

async function importRenderWorkerSecretsWithMockedAccess(
  blockedPath: string,
): Promise<typeof import("../scripts/render-worker-secrets.ts")> {
  vi.resetModules();
  vi.doMock("node:fs/promises", async () => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );

    return {
      ...actual,
      access: async (targetPath: string) => {
        if (targetPath === blockedPath) {
          const error = new Error("permission denied") as NodeJS.ErrnoException;
          error.code = "EACCES";
          throw error;
        }

        return await actual.access(targetPath);
      },
    };
  });

  return await import("../scripts/render-worker-secrets.ts");
}

const LEGACY_HOSTED_ASSISTANT_PROVIDER_SECRET_NAMES = [
  "ANTHROPIC_API_KEY",
  "CEREBRAS_API_KEY",
  "DEEPSEEK_API_KEY",
  "FIREWORKS_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "HF_TOKEN",
  "HUGGINGFACEHUB_API_TOKEN",
  "HUGGINGFACE_API_KEY",
  "HUGGING_FACE_HUB_TOKEN",
  "LITELLM_PROXY_API_KEY",
  "LM_STUDIO_API_KEY",
  "MISTRAL_API_KEY",
  "NVIDIA_API_KEY",
  "NGC_API_KEY",
  "OLLAMA_API_KEY",
  "OPENROUTER_API_KEY",
  "PERPLEXITY_API_KEY",
  "TOGETHER_API_KEY",
  "VLLM_API_KEY",
  // XAI_API_KEY left this list when xAI became a real intercepted provider
  // (x_search); it is now an optional worker secret.
] as const;

const REMOVED_HOSTED_ASSISTANT_VAR_NAMES = [
  "HOSTED_ASSISTANT_API_KEY_ENV",
  "HOSTED_ASSISTANT_BASE_URL",
  "HOSTED_ASSISTANT_CODEX_COMMAND",
  "HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS",
  "HOSTED_ASSISTANT_OSS",
  "HOSTED_ASSISTANT_PROFILE",
  "HOSTED_ASSISTANT_PROVIDER_NAME",
] as const;

const REQUIRED_HOSTED_CRYPTO_WORKER_VARS = {
  CF_PUBLIC_BASE_URL: "https://murph-hosted.cobuildwithus.workers.dev",
  HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION:
    "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1",
  HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
    "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----",
  HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cloudflare-automation:v1",
  HOSTED_CRYPTO_ENV: "production",
  HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_ID: "branch-test",
  HOSTED_DATABASE_ALERT_PLANETSCALE_BRANCH_NAME: "main",
  HOSTED_DATABASE_ALERT_PLANETSCALE_DATABASE_NAME: "database-test",
  HOSTED_DATABASE_ALERT_PLANETSCALE_ORGANIZATION: "org-test",
  HOSTED_R2_PRESIGN_ACCOUNT_ID: "r2-account-test",
  HOSTED_R2_PRESIGN_BUCKET_NAME: "hosted-bundles",
} as const;
const REQUIRED_R2_PRESIGN_WORKER_SECRETS = {
  HOSTED_DATABASE_ALERT_LINQ_CHAT_ID: "chat-test",
  HOSTED_DATABASE_ALERT_LINQ_SECONDARY_CHAT_ID: "chat-secondary-test",
  HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN: "metrics-token-test",
  HOSTED_DATABASE_ALERT_PLANETSCALE_SERVICE_TOKEN_ID: "metrics-token-id-test",
  HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "r2-access-fixture",
  HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "r2-signing-fixture",
  LINQ_API_TOKEN: "linq-token-test",
} as const;
const REQUIRED_PRIVATE_IMAGE_WORKER_SECRET = {
  HOSTED_PRIVATE_MEDIA_CAPABILITY_SECRET: "images-signing-fixture",
} as const;

function expectedRequiredHostedCryptoWorkerVars(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(REQUIRED_HOSTED_CRYPTO_WORKER_VARS)
      .filter(([name]) => !name.startsWith("CF_BUNDLES_")),
  );
}

function findRunCommandsWithGitHubInputInterpolation(
  workflow: string,
): Array<{ body: string; line: number }> {
  const lines = workflow.split("\n");
  const findings: Array<{ body: string; line: number }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const runMatch = /^(\s*)run:\s*(.*)$/u.exec(line);
    if (!runMatch) {
      continue;
    }

    const runIndent = runMatch[1]?.length ?? 0;
    const rest = runMatch[2]?.trimEnd() ?? "";
    let body = rest;

    if (rest === "|" || rest === ">") {
      const bodyLines: string[] = [];
      for (let bodyIndex = index + 1; bodyIndex < lines.length; bodyIndex += 1) {
        const bodyLine = lines[bodyIndex] ?? "";
        const bodyIndent = bodyLine.match(/^\s*/u)?.[0].length ?? 0;
        if (bodyLine.trim() !== "" && bodyIndent <= runIndent) {
          break;
        }
        bodyLines.push(bodyLine);
      }
      body = bodyLines.join("\n");
    }

    if (body.includes("${{ inputs.")) {
      findings.push({
        body,
        line: index + 1,
      });
    }
  }

  return findings;
}

function findMutableActionRefs(workflow: string): Array<{ line: number; ref: string; uses: string }> {
  const findings: Array<{ line: number; ref: string; uses: string }> = [];
  const lines = workflow.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = /^\s*-?\s*uses:\s+([^@\s]+)@([^\s#]+)/u.exec(line);
    if (!match) {
      continue;
    }

    const ref = match[2] ?? "";
    if (!/^[a-f0-9]{40}$/u.test(ref)) {
      findings.push({
        line: index + 1,
        ref,
        uses: match[1] ?? "",
      });
    }
  }

  return findings;
}

describe("hosted deploy automation helpers", () => {
  it("builds a generated wrangler config for the native container worker", () => {
    const authorityVerifyKeyringJson = JSON.stringify({
      "projects/example/locations/global/keyRings/hosted/cryptoKeys/authority/cryptoKeyVersions/2": {
        keyVersionName:
          "projects/example/locations/global/keyRings/hosted/cryptoKeys/authority/cryptoKeyVersions/2",
        publicKeyPem: "-----BEGIN PUBLIC KEY-----\nstandby\n-----END PUBLIC KEY-----\n",
        status: "verify_only",
      },
    });
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_CONTAINER_INSTANCE_TYPE: "standard-1",
      CF_CONTAINER_MAX_INSTANCES: "250",
      CF_RUNNER_COMMIT_TIMEOUT_MS: "45000",
      CF_RUNNER_READY_TIMEOUT_MS: "65000",
      CF_WORKER_NAME: "hosted-worker",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
      HOSTED_WEB_BASE_URL: "https://web.example.test",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cloudflare-automation:v2",
      HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON: authorityVerifyKeyringJson,
      HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "180000",
      HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS: "60000",
      HOSTED_PHYSICAL_NOTES_ENABLED: "true",
      HOSTED_ASSISTANT_APPROVAL_POLICY: "never",
      HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ASSISTANT_REASONING_EFFORT: "medium",
      HOSTED_ASSISTANT_SANDBOX: "danger-full-access",
      HOSTED_EMAIL_DEFAULT_SUBJECT: "Murph note",
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "callback:v2",
      TELEGRAM_BOT_USERNAME: "hosted_bot",
    });
    const config = buildHostedWranglerDeployConfig(environment) as {
      ai?: {
        binding: string;
      };
      containers: Array<{
        class_name: string;
        image: string;
        image_build_context: string;
        instance_type: string | {
          disk_mb: number;
          memory_mib: number;
          vcpu: number;
        };
        max_instances: number;
        rollout_active_grace_period: number;
        rollout_step_percentage: number[];
        ssh: { enabled: boolean };
      }>;
      durable_objects: {
        bindings: Array<{
          class_name: string;
          name: string;
        }>;
      };
      analytics_engine_datasets: Array<{
        binding: string;
        dataset: string;
      }>;
      main: string;
      migrations: Array<{
        new_sqlite_classes: string[];
        tag: string;
      }>;
      compatibility_flags: string[];
      name: string;
      observability: {
        enabled: boolean;
        head_sampling_rate: number;
        logs: {
          enabled: boolean;
          head_sampling_rate: number;
          invocation_logs: boolean;
          persist: boolean;
        };
        traces: {
          enabled: boolean;
          head_sampling_rate: number;
          persist: boolean;
        };
      };
      placement: {
        mode: string;
      };
      queues: {
        consumers: Array<{
          dead_letter_queue: string;
          max_batch_size: number;
          max_batch_timeout: number;
          max_concurrency: number;
          max_retries: number;
          queue: string;
          retry_delay: number;
        }>;
        producers: Array<{ binding: string; queue: string }>;
      };
      r2_buckets: Array<{
        binding: string;
        bucket_name: string;
        preview_bucket_name: string;
      }>;
      send_email?: Array<{
        allowed_sender_addresses?: string[];
        name: string;
      }>;
      vars: Record<string, string>;
      secrets?: { required?: string[] };
      version_metadata?: {
        binding: string;
      };
      triggers: {
        crons: string[];
      };
    };

    expect(config.name).toBe("hosted-worker");
    expect(config.main).toBe("../src/index.ts");
    expect(config.containers).toEqual([
      {
        class_name: "RunnerContainer",
        image: "../../../Dockerfile.cloudflare-hosted-runner",
        image_build_context: "..",
        instance_type: "standard-1",
        max_instances: 250,
        rollout_active_grace_period: 300,
        rollout_step_percentage: [10, 25, 50, 100],
        ssh: { enabled: false },
      },
      {
        class_name: "DeploySmokeRunnerContainer",
        image: "../../../Dockerfile.cloudflare-hosted-runner",
        image_build_context: "..",
        instance_type: "standard-1",
        max_instances: 1,
        rollout_active_grace_period: 0,
        rollout_step_percentage: [100],
        ssh: { enabled: false },
      },
    ]);
    expect(config.durable_objects.bindings).toEqual([
      {
        class_name: "UserRunnerDurableObject",
        name: "USER_RUNNER",
      },
      {
        class_name: "DatabaseHealthDurableObject",
        name: "DATABASE_HEALTH_MONITOR",
      },
      {
        class_name: "DeviceWebhookQueueHealthDurableObject",
        name: "DEVICE_WEBHOOK_QUEUE_MONITOR",
      },
      {
        class_name: "RunnerContainer",
        name: "RUNNER_CONTAINER",
      },
      {
        class_name: "DeploySmokeRunnerContainer",
        name: "RUNNER_CONTAINER_SMOKE",
      },
    ]);
    expect(config.analytics_engine_datasets).toEqual([
      {
        binding: "HOSTED_RUNTIME_RETRY_ANALYTICS",
        dataset: "murph_hosted_runtime_retries",
      },
    ]);
    expect(config.migrations).toEqual([
      {
        new_sqlite_classes: ["UserRunnerDurableObject"],
        tag: "v1",
      },
      {
        new_sqlite_classes: ["RunnerContainer"],
        tag: "v2",
      },
      {
        new_sqlite_classes: ["DeploySmokeRunnerContainer"],
        tag: "v3",
      },
      {
        new_sqlite_classes: ["DatabaseHealthDurableObject"],
        tag: "v4",
      },
      {
        new_sqlite_classes: ["DeviceWebhookQueueHealthDurableObject"],
        tag: "v5",
      },
    ]);
    expect(config).toMatchObject({
      triggers: {
        crons: ["*/5 * * * *"],
      },
    });
    expect(config.compatibility_flags).toEqual([
      "nodejs_compat",
      "containers_pid_namespace",
    ]);
    expect(config.placement).toEqual({ mode: "smart" });
    expect(config.r2_buckets).toEqual([
      {
        binding: "BUNDLES",
        bucket_name: "hosted-bundles",
        preview_bucket_name: "hosted-bundles-preview",
      },
    ]);
    expect(config.queues).toEqual({
      consumers: [
        {
          dead_letter_queue: "hosted-worker-device-webhooks-dlq",
          max_batch_size: 100,
          max_batch_timeout: 5,
          max_concurrency: 1,
          max_retries: 10,
          queue: "hosted-worker-device-webhooks",
          retry_delay: 30,
        },
      ],
      producers: [
        {
          binding: "DEVICE_WEBHOOK_QUEUE",
          queue: "hosted-worker-device-webhooks",
        },
        {
          binding: "DEVICE_WEBHOOK_DLQ",
          queue: "hosted-worker-device-webhooks-dlq",
        },
      ],
    });
    expect(config.version_metadata).toEqual({ binding: "CF_VERSION_METADATA" });
    expect(config.observability).toEqual({
      enabled: true,
      head_sampling_rate: 1,
      logs: {
        enabled: true,
        invocation_logs: false,
        persist: true,
        head_sampling_rate: 1,
      },
      traces: {
        enabled: true,
        persist: true,
        head_sampling_rate: 1,
      },
    });
    expect(config.vars.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS).toBe("45000");
    expect(config.vars.HOSTED_EXECUTION_RUNNER_READY_TIMEOUT_MS).toBe("65000");
    expect(config.vars.HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS).toBe("30000");
    expect(config.vars.HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS).toBe("180000");
    expect(config.vars.HOSTED_EXECUTION_RUNNER_LIFECYCLE_REEVALUATION_MS).toBe("60000");
    expect(config.vars.HOSTED_PHYSICAL_NOTES_ENABLED).toBe("true");
    expect(config.vars.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION).toContain("cryptoKeyVersions/1");
    expect(config.vars.HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM).toContain("BEGIN PUBLIC KEY");
    expect(config.vars.HOSTED_CRYPTO_AUTHORITY_VERIFY_KEYRING_JSON).toBe(
      authorityVerifyKeyringJson,
    );
    expect(config.vars.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID).toBe("cloudflare-automation:v2");
    expect(config.vars.HOSTED_CRYPTO_ENV).toBe("production");
    expect(config.vars.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID).toBe("callback:v2");
    expect(config.vars.HOSTED_ASSISTANT_APPROVAL_POLICY).toBe("never");
    expect(config.vars.HOSTED_ASSISTANT_MODEL).toBe("gpt-5.6-terra");
    expect(config.vars.HOSTED_ASSISTANT_PROVIDER).toBe("openai");
    expect(config.vars.HOSTED_ASSISTANT_REASONING_EFFORT).toBe("medium");
    expect(config.vars.HOSTED_ASSISTANT_SANDBOX).toBe("danger-full-access");
    expect(config.vars.HOSTED_EMAIL_DEFAULT_SUBJECT).toBe("Murph note");
    expect(config.vars.HOSTED_EMAIL_DOMAIN).toBe("mail.example.test");
    expect(config.vars.HOSTED_EMAIL_FROM_ADDRESS).toBe("assistant@mail.example.test");
    expect(config.vars.HOSTED_EMAIL_LOCAL_PART).toBe("assistant");
    expect(config.send_email).toEqual([
      {
        allowed_sender_addresses: ["assistant@mail.example.test"],
        name: "HOSTED_EMAIL",
      },
    ]);
    expect(config.ai).toEqual({ binding: "AI" });
    expect(config.vars.HOSTED_WEB_BASE_URL).toBe("https://web.example.test");
    expect(config.vars.TELEGRAM_BOT_USERNAME).toBe("hosted_bot");
    expect(config.vars.HOSTED_EXECUTION_RUNNER_BASE_URL).toBeUndefined();
    expect(config.secrets?.required).toEqual([...HOSTED_WORKER_REQUIRED_SECRET_NAMES]);
  });

  it("passes an explicit preview OIDC environment through to generated Worker vars", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles-staging",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-staging",
      CF_WORKER_NAME: "hosted-worker-staging",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
      HOSTED_R2_PRESIGN_BUCKET_NAME: "hosted-bundles-staging",
      HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "preview",
    });

    const config = buildHostedWranglerDeployConfig(environment) as {
      vars: Record<string, string>;
    };

    expect(environment.workerVars.HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT).toBe("preview");
    expect(config.vars.HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT).toBe("preview");
  });

  it("rejects partial numeric deploy automation values", () => {
    for (const runnerReadyTimeout of ["60000ms", "1e3"]) {
      expect(() =>
        readHostedDeployAutomationEnvironment({
          CF_BUNDLES_BUCKET: "hosted-bundles",
          CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
          CF_RUNNER_READY_TIMEOUT_MS: runnerReadyTimeout,
          CF_WORKER_NAME: "hosted-worker",
          ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
        }),
      ).toThrow(/CF_RUNNER_READY_TIMEOUT_MS must be a positive integer/u);
    }
  });

  it("binds generated deploy config to the prepared runner fingerprints", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
    });
    const config = buildHostedWranglerDeployConfig(environment, {
      runnerBundleManifest: {
        bundleFingerprint: "bundle-fingerprint",
        sourceFingerprint: "source-fingerprint",
      },
    }) as { vars: Record<string, string> };

    expect(config.vars.HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT)
      .toBe("bundle-fingerprint");
    expect(config.vars.HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT)
      .toBe("source-fingerprint");
  });

  it("keeps the checked-in wrangler scaffold aligned with generated container sizing and durable object config", async () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "murph-hosted-bundles-enam",
      CF_BUNDLES_PREVIEW_BUCKET: "murph-hosted-bundles-preview-enam",
      CF_WORKER_NAME: "murph-hosted",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
      HOSTED_R2_PRESIGN_BUCKET_NAME: "murph-hosted-bundles-enam",
    });
    const generatedConfig = buildHostedWranglerDeployConfig(environment) as {
      containers: Array<{
        class_name: string;
        instance_type: {
          disk_mb: number;
          memory_mib: number;
          vcpu: number;
        };
        max_instances: number;
        rollout_active_grace_period?: number;
        rollout_step_percentage?: number[];
        ssh: { enabled: boolean };
      }>;
      durable_objects: {
        bindings: Array<{
          class_name: string;
          name: string;
        }>;
      };
      analytics_engine_datasets: Array<{
        binding: string;
        dataset: string;
      }>;
      migrations: Array<{
        new_sqlite_classes: string[];
        tag: string;
      }>;
      placement: {
        mode: string;
      };
      queues: {
        consumers: unknown[];
        producers: unknown[];
      };
      r2_buckets: Array<{
        binding: string;
        bucket_name: string;
        preview_bucket_name: string;
      }>;
      version_metadata?: {
        binding: string;
      };
      triggers: {
        crons: string[];
      };
    };
    const checkedInConfig = parseJsoncObject(
      await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    ) as {
      containers: Array<{
        class_name: string;
        instance_type: {
          disk_mb: number;
          memory_mib: number;
          vcpu: number;
        };
        max_instances: number;
        rollout_active_grace_period?: number;
        rollout_step_percentage?: number[];
        ssh: { enabled: boolean };
      }>;
      durable_objects: {
        bindings: Array<{
          class_name: string;
          name: string;
        }>;
      };
      analytics_engine_datasets: Array<{
        binding: string;
        dataset: string;
      }>;
      migrations: Array<{
        new_sqlite_classes: string[];
        tag: string;
      }>;
      placement: {
        mode: string;
      };
      queues: {
        consumers: unknown[];
        producers: unknown[];
      };
      r2_buckets: Array<{
        binding: string;
        bucket_name: string;
        preview_bucket_name: string;
      }>;
      version_metadata?: {
        binding: string;
      };
      triggers: {
        crons: string[];
      };
    };

    const expectedDefaultInstanceType = {
      disk_mb: 6000,
      memory_mib: 6144,
      vcpu: 2,
    };
    expect(generatedConfig.containers.map(({ instance_type }) => instance_type)).toEqual([
      expectedDefaultInstanceType,
      expectedDefaultInstanceType,
    ]);
    expect(checkedInConfig.containers).toHaveLength(generatedConfig.containers.length);
    for (const [index, generatedContainer] of generatedConfig.containers.entries()) {
      expect(generatedContainer.ssh).toEqual({ enabled: false });
      expect(checkedInConfig.containers[index]).toMatchObject({
        class_name: generatedContainer.class_name,
        instance_type: generatedContainer.instance_type,
        max_instances: generatedContainer.max_instances,
        rollout_active_grace_period: generatedContainer.rollout_active_grace_period,
        rollout_step_percentage: generatedContainer.rollout_step_percentage,
        ssh: generatedContainer.ssh,
      });
    }
    expect(checkedInConfig.durable_objects.bindings).toEqual(generatedConfig.durable_objects.bindings);
    expect(checkedInConfig.analytics_engine_datasets).toEqual(
      generatedConfig.analytics_engine_datasets,
    );
    expect(checkedInConfig.migrations).toEqual(generatedConfig.migrations);
    expect(checkedInConfig.placement).toEqual(generatedConfig.placement);
    expect(checkedInConfig.r2_buckets).toEqual(generatedConfig.r2_buckets);
    expect(checkedInConfig.queues).toEqual(generatedConfig.queues);
    expect(checkedInConfig.version_metadata).toEqual(generatedConfig.version_metadata);
    expect(checkedInConfig.triggers).toEqual(generatedConfig.triggers);
  });

  it("keeps the checked-in wrangler scaffold vars aligned with default-rendered deploy vars", async () => {
    // Guards the drift class where a scaffold var (e.g. the runner idle TTL)
    // is edited in source but real deploys silently keep shipping another
    // value. Required vars are exempt: the scaffold holds placeholders and
    // deploys supply them from the GitHub environment.
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "murph-hosted-bundles-enam",
      CF_BUNDLES_PREVIEW_BUCKET: "murph-hosted-bundles-preview-enam",
      CF_WORKER_NAME: "murph-hosted",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
      HOSTED_R2_PRESIGN_BUCKET_NAME: "murph-hosted-bundles-enam",
    });
    const generatedConfig = buildHostedWranglerDeployConfig(environment) as {
      vars: Record<string, string>;
    };
    const checkedInConfig = parseJsoncObject(
      await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    ) as {
      vars: Record<string, string>;
    };
    const requiredVarNames = new Set<string>(HOSTED_WORKER_REQUIRED_VAR_NAMES);
    const scaffoldDefaultVars = Object.fromEntries(
      Object.entries(checkedInConfig.vars).filter(([key]) => !requiredVarNames.has(key)),
    );

    expect(Object.keys(scaffoldDefaultVars).length).toBeGreaterThan(0);
    for (const [key, scaffoldValue] of Object.entries(scaffoldDefaultVars)) {
      expect(
        { [key]: generatedConfig.vars[key] },
        `wrangler.jsonc scaffold var ${key} must match the value default deploys render`,
      ).toEqual({ [key]: scaffoldValue });
    }
  });

  it("ignores removed deploy alias inputs and keeps only canonical worker vars", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
      PARSER_FFMPEG_PATH: "/usr/local/bin/ffmpeg",
    });

    expect(environment.workerVars).toEqual({
      ...expectedRequiredHostedCryptoWorkerVars(),
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "exa,hosted-email,linq,mapbox,telegram",
      HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "600000",
      HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "production",
    });
  });

  it("passes explicit runner env profiles through to worker vars", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "telegram,mapbox",
    });

    expect(environment.workerVars.HOSTED_EXECUTION_RUNNER_ENV_PROFILES).toBe("telegram,mapbox");
  });

  it("preserves exact Android gate semantics through generated Worker config", () => {
    for (const [rawValue, expectedValue] of [
      [undefined, undefined],
      ["", undefined],
      ["0", undefined],
      ["true", undefined],
      [" 1 ", undefined],
      ["1 ", undefined],
      ["\n1", undefined],
      ["1", "1"],
    ] as const) {
      const environment = readHostedDeployAutomationEnvironment({
        CF_BUNDLES_BUCKET: "hosted-bundles",
        CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
        CF_WORKER_NAME: "hosted-worker",
        ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
        ...(rawValue === undefined
          ? {}
          : { MURPH_ANDROID_APP_ENABLED: rawValue }),
      });
      const config = buildHostedWranglerDeployConfig(environment) as {
        vars: Record<string, string>;
      };
      const platformEnv = buildHostedRunnerContainerPlatformEnv(config.vars);

      expect(environment.workerVars.MURPH_ANDROID_APP_ENABLED).toBe(expectedValue);
      expect(config.vars.MURPH_ANDROID_APP_ENABLED).toBe(expectedValue);
      expect(platformEnv.MURPH_ANDROID_APP_ENABLED).toBe(expectedValue);
    }
  });

  it("defaults runner env profiles to the full hosted integration set", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
    });

    expect(environment.workerVars.HOSTED_EXECUTION_RUNNER_ENV_PROFILES).toBe(
      "exa,hosted-email,linq,mapbox,telegram",
    );
    expect(environment.runnerReadyTimeoutMs).toBe("90000");
  });

  it("accepts a custom JSON container instance type for generated deploy config", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_CONTAINER_INSTANCE_TYPE: "{\"vcpu\":0.5,\"memory_mib\":2048,\"disk_mb\":8192}",
      CF_WORKER_NAME: "hosted-worker",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
    });

    expect(environment.containerInstanceType).toEqual({
      disk_mb: 8192,
      memory_mib: 2048,
      vcpu: 0.5,
    });
  });

  it("keeps container SSH disabled when retired SSH inputs are still present", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_CONTAINER_SSH_KEY_NAME: "debug-key",
      CF_CONTAINER_SSH_PUBLIC_KEY: "ssh-ed25519 retired-key-material",
      CF_WORKER_NAME: "hosted-worker",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
    });
    const config = buildHostedWranglerDeployConfig(environment) as {
      compatibility_flags: string[];
      containers: Array<{
        authorized_keys?: Array<{ name: string; public_key: string }>;
        ssh: { enabled: boolean };
      }>;
    };

    expect(environment).not.toHaveProperty("containerSshKey");
    expect(config.compatibility_flags).toEqual([
      "nodejs_compat",
      "containers_pid_namespace",
    ]);
    expect(config.containers).toHaveLength(2);
    for (const container of config.containers) {
      expect(container.ssh).toEqual({ enabled: false });
      expect(container).not.toHaveProperty("authorized_keys");
    }
  });

  it("rejects invalid custom container instance JSON", () => {
    expect(() =>
      readHostedDeployAutomationEnvironment({
        CF_BUNDLES_BUCKET: "hosted-bundles",
        CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
        CF_CONTAINER_INSTANCE_TYPE: "{\"vcpu\":0.5,\"memory_mib\":2048}",
        CF_WORKER_NAME: "hosted-worker",
        ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
      }),
    ).toThrowError(/CF_CONTAINER_INSTANCE_TYPE\.disk_mb must be a positive number\./u);
  });

  it("renders required and optional worker secrets from CI secrets", () => {
    const automationPrivateKeyringJson = JSON.stringify({
      "cloudflare-automation:v2": {
        privateJwk: {
          crv: "P-256",
          d: "standby-private-coordinate",
          kty: "EC",
          x: "standby-x-coordinate",
          y: "standby-y-coordinate",
        },
        recipient: "cloudflare-automation-secret",
        recipientKeyId: "cloudflare-automation:v2",
        status: "decrypt_only",
      },
    });
    const legacyHostedAssistantProviderSecrets = Object.fromEntries(
      LEGACY_HOSTED_ASSISTANT_PROVIDER_SECRET_NAMES.map((name) => [
        name,
        `${name.toLowerCase()}-legacy`,
      ]),
    );

    expect(buildHostedWorkerSecretsPayload({
      ...REQUIRED_PRIVATE_IMAGE_WORKER_SECRET,
      GARMIN_API_BASE_URL: "https://apis.garmin.com/wellness-api/rest",
      GARMIN_CLIENT_ID: "garmin-client-id",
      GARMIN_CLIENT_SECRET: "garmin-client-secret",
      ...legacyHostedAssistantProviderSecrets,
      HOSTED_EMAIL_SIGNING_SECRET: "email-signing-secret",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private-jwk",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON:
        automationPrivateKeyringJson,
      HOSTED_LOG_FINGERPRINT_SECRET: "log-fingerprint-secret",
      HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
        "provider-egress-signing-secret",
      ...REQUIRED_R2_PRESIGN_WORKER_SECRETS,
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
      JUNCTION_API_KEY: "junction-api-key",
      JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
      JUNCTION_WEBHOOK_SECRET: "junction-webhook-secret",
      MAPBOX_ACCESS_TOKEN: "mapbox-token",
      MURPH_DATA_API_KEY: "data-api-key",
      STRAVA_CLIENT_ID: "strava-client-id",
      STRAVA_CLIENT_SECRET: "strava-client-secret",
      TELEGRAM_BOT_TOKEN: "bot-token",
      TELEGRAM_WEBHOOK_SECRET: "telegram-webhook-secret",
      WHATSAPP_ACCESS_TOKEN: "removed-whatsapp-token",
      WHATSAPP_APP_SECRET: "removed-whatsapp-app-secret",
      WHATSAPP_PHONE_NUMBER_ID: "removed-whatsapp-phone-number-id",
      WHATSAPP_VERIFY_TOKEN: "removed-whatsapp-verify-token",
      OPENAI_API_KEY: "openai-key",
      VENICE_API_KEY: "venice-key",
    })).toEqual({
      ...REQUIRED_PRIVATE_IMAGE_WORKER_SECRET,
      HOSTED_EMAIL_SIGNING_SECRET: "email-signing-secret",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private-jwk",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON:
        automationPrivateKeyringJson,
      HOSTED_LOG_FINGERPRINT_SECRET: "log-fingerprint-secret",
      HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
        "provider-egress-signing-secret",
      ...REQUIRED_R2_PRESIGN_WORKER_SECRETS,
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
      JUNCTION_API_KEY: "junction-api-key",
      JUNCTION_CLIENT_USER_ID_SECRET: "junction-client-user-id-secret",
      JUNCTION_WEBHOOK_SECRET: "junction-webhook-secret",
      MAPBOX_ACCESS_TOKEN: "mapbox-token",
      MURPH_DATA_API_KEY: "data-api-key",
      STRAVA_CLIENT_ID: "strava-client-id",
      STRAVA_CLIENT_SECRET: "strava-client-secret",
      TELEGRAM_BOT_TOKEN: "bot-token",
      OPENAI_API_KEY: "openai-key",
      VENICE_API_KEY: "venice-key",
    });
  });

  it("omits legacy direct Garmin env from worker secret payloads", () => {
    const payload = buildHostedWorkerSecretsPayload({
      ...REQUIRED_PRIVATE_IMAGE_WORKER_SECRET,
      GARMIN_CLIENT_ID: "garmin-client-id",
      GARMIN_CLIENT_SECRET: "garmin-client-secret",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private-jwk",
      HOSTED_LOG_FINGERPRINT_SECRET: "log-fingerprint-secret",
      HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
        "provider-egress-signing-secret",
      ...REQUIRED_R2_PRESIGN_WORKER_SECRETS,
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
      MURPH_DATA_API_KEY: "data-api-key",
      OPENAI_API_KEY: "openai-key",
    });

    expect(payload.GARMIN_CLIENT_ID).toBeUndefined();
    expect(payload.GARMIN_CLIENT_SECRET).toBeUndefined();
  });

  it("keeps only known hosted assistant provider env names in deploy automation", () => {
    const providerSecretsPayload = buildHostedWorkerSecretsPayload({
      ...REQUIRED_PRIVATE_IMAGE_WORKER_SECRET,
      HOSTED_ASSISTANT_BASE_URL: "https://legacy-provider.example.test/v1",
      HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ASSISTANT_PROVIDER_NAME: "legacy-provider",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private-jwk",
      HOSTED_LOG_FINGERPRINT_SECRET: "log-fingerprint-secret",
      HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
        "provider-egress-signing-secret",
      ...REQUIRED_R2_PRESIGN_WORKER_SECRETS,
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
      MURPH_DATA_API_KEY: "data-api-key",
      OPENAI_API_KEY: "openai-key",
    });
    expect(providerSecretsPayload).toMatchObject({
      OPENAI_API_KEY: "openai-key",
    });
    expect(providerSecretsPayload.HOSTED_ASSISTANT_BASE_URL).toBeUndefined();
    expect(providerSecretsPayload.HOSTED_ASSISTANT_MODEL).toBeUndefined();
    expect(providerSecretsPayload.HOSTED_ASSISTANT_PROVIDER).toBeUndefined();
    expect(providerSecretsPayload.HOSTED_ASSISTANT_PROVIDER_NAME).toBeUndefined();

    const platformSecretsPayload = buildHostedWorkerSecretsPayload({
      ...REQUIRED_PRIVATE_IMAGE_WORKER_SECRET,
      HOSTED_ASSISTANT_BASE_URL: "https://legacy-provider.example.test/v1",
      HOSTED_ASSISTANT_PROVIDER_NAME: "legacy-provider",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private-jwk",
      HOSTED_LOG_FINGERPRINT_SECRET: "log-fingerprint-secret",
      HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
        "provider-egress-signing-secret",
      ...REQUIRED_R2_PRESIGN_WORKER_SECRETS,
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
      MURPH_DATA_API_KEY: "data-api-key",
      OPENAI_API_KEY: "openai-key",
    });
    expect(platformSecretsPayload).toMatchObject({
      OPENAI_API_KEY: "openai-key",
    });
    expect(platformSecretsPayload.HOSTED_ASSISTANT_BASE_URL).toBeUndefined();
    expect(platformSecretsPayload.HOSTED_ASSISTANT_PROVIDER_NAME).toBeUndefined();

    expect(buildHostedWorkerSecretsPayload({
      ...REQUIRED_PRIVATE_IMAGE_WORKER_SECRET,
      HOSTED_ASSISTANT_API_KEY_ENV: "OPENAI_ENTERPRISE_API_KEY",
      HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private-jwk",
      HOSTED_LOG_FINGERPRINT_SECRET: "log-fingerprint-secret",
      HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
        "provider-egress-signing-secret",
      ...REQUIRED_R2_PRESIGN_WORKER_SECRETS,
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
      MURPH_DATA_API_KEY: "data-api-key",
      OPENAI_API_KEY: "openai-key",
      OPENAI_ENTERPRISE_API_KEY: "enterprise-openai-key",
    }).OPENAI_ENTERPRISE_API_KEY).toBeUndefined();

    expect(readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
      HOSTED_ASSISTANT_API_KEY_ENV: "OPENAI_ENTERPRISE_API_KEY",
      HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
      HOSTED_ASSISTANT_PROVIDER: "openai",
    }).workerVars.HOSTED_ASSISTANT_API_KEY_ENV).toBeUndefined();

    expect(readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
      HOSTED_ASSISTANT_API_KEY_ENV: "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
      HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
      HOSTED_ASSISTANT_PROVIDER: "openai",
    }).workerVars.HOSTED_ASSISTANT_API_KEY_ENV).toBeUndefined();
  });

  it("does not accept legacy HB_CF deploy variable names", () => {
    expect(() =>
      readHostedDeployAutomationEnvironment({
        HB_CF_BUNDLES_BUCKET: "hosted-bundles",
        HB_CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
        HB_CF_WORKER_NAME: "hosted-worker",
      }),
    ).toThrowError(/CF_BUNDLES_BUCKET must be configured\./u);
  });

  it("requires the presign bucket to match the canonical R2 binding", () => {
    expect(() => readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
      HOSTED_R2_PRESIGN_BUCKET_NAME: "hosted-bundles-enam",
    })).toThrow("HOSTED_R2_PRESIGN_BUCKET_NAME must match CF_BUNDLES_BUCKET");
  });

  it("defaults generated deploy paths to the cloudflare app directory", () => {
    const paths = resolveCloudflareDeployPaths();

    expect(paths.deployDir.endsWith(path.join("apps", "cloudflare", ".deploy"))).toBe(true);
    expect(paths.workerSecretsPath.endsWith(path.join("apps", "cloudflare", ".deploy", "worker-secrets.json"))).toBe(true);
    expect(paths.wranglerConfigPath.endsWith(path.join("apps", "cloudflare", ".deploy", "wrangler.generated.jsonc"))).toBe(true);
  });

  it("renders worker secrets into private files and directories", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "murph-worker-secrets-"));
    try {
      const outputPath = path.join(tempRoot, "nested", "worker-secrets.json");
      const requiredSecrets = Object.fromEntries(
        HOSTED_WORKER_REQUIRED_SECRET_NAMES.map((name) => [name, `${name.toLowerCase()}-value`]),
      );

      await renderWorkerSecretsFile({
        outputPath,
        source: requiredSecrets,
      });

      expect(JSON.parse(await readFile(outputPath, "utf8"))).toEqual(requiredSecrets);
      expect((await stat(path.dirname(outputPath))).mode & 0o777).toBe(0o700);
      expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("rethrows non-ENOENT access errors while probing worker secrets output directories", async () => {
    const tempRoot = path.join(tmpdir(), "murph-worker-secrets-blocked");
    const blockedDirectory = path.join(tempRoot, "nested");
    const { renderWorkerSecretsFile: renderWithMockedAccess } =
      await importRenderWorkerSecretsWithMockedAccess(blockedDirectory);

    await expect(
      renderWithMockedAccess({
        outputPath: path.join(blockedDirectory, "worker-secrets.json"),
      }),
    ).rejects.toMatchObject({
      code: "EACCES",
    });
  });

  it("parses wrangler container image JSON output and drops digest tags", () => {
    expect(parseHostedContainerImageListOutput(JSON.stringify([
      {
        name: "hosted-runner",
        tags: ["manual-2026-03-27T00-00-00-000Z", "sha256-deadbeef", "manual-2026-03-26T00-00-00-000Z"],
      },
    ]))).toEqual([
      {
        name: "hosted-runner",
        tags: ["manual-2026-03-27T00-00-00-000Z", "manual-2026-03-26T00-00-00-000Z"],
      },
    ]);
  });

  it("selects lexicographically older container tags for cleanup per repository", () => {
    expect(selectHostedContainerImageTagsForCleanup({
      images: [
        {
          name: "hosted-runner",
          tags: [
            "manual-2026-03-27T00-00-00-000Z",
            "manual-2026-03-26T00-00-00-000Z",
            "manual-2026-03-25T00-00-00-000Z",
          ],
        },
        {
          name: "murph-preview",
          tags: [
            "manual-2026-03-27T10-00-00-000Z",
            "manual-2026-03-26T10-00-00-000Z",
          ],
        },
      ],
      keepPerRepository: 1,
    })).toEqual([
      {
        image: "hosted-runner:manual-2026-03-26T00-00-00-000Z",
        repository: "hosted-runner",
        tag: "manual-2026-03-26T00-00-00-000Z",
      },
      {
        image: "hosted-runner:manual-2026-03-25T00-00-00-000Z",
        repository: "hosted-runner",
        tag: "manual-2026-03-25T00-00-00-000Z",
      },
      {
        image: "murph-preview:manual-2026-03-26T10-00-00-000Z",
        repository: "murph-preview",
        tag: "manual-2026-03-26T10-00-00-000Z",
      },
    ]);
  });

  it("keeps the canonical R2 deploy surface free of retired migration controls", async () => {
    const deployGuide = await readFile(new URL("../DEPLOY.md", import.meta.url), "utf8");
    const docsIndex = await readFile(
      new URL("../../../agent-docs/index.md", import.meta.url),
      "utf8",
    );
    const deployPreflight = await readFile(
      new URL("../scripts/deploy-preflight.ts", import.meta.url),
      "utf8",
    );
    const currentSurfaces = [deployGuide, docsIndex, deployPreflight].join("\n");

    expect(deployGuide).toContain("- `CF_BUNDLES_BUCKET`");
    expect(deployGuide).toContain("- `CF_BUNDLES_PREVIEW_BUCKET`");
    expect(deployGuide).toContain(
      "Any Worker release that references the retired OC binding or fallback is below the physical-retirement rollback floor and must not be restored.",
    );
    expect(deployPreflight).toContain('"CF_BUNDLES_BUCKET"');
    expect(deployPreflight).toContain('"CF_BUNDLES_PREVIEW_BUCKET"');
    expect(currentSurfaces).not.toContain("CF_BUNDLES_RETIRING_OC");
    expect(currentSurfaces).not.toContain("all four configured R2 bucket names");
    expect(currentSurfaces).not.toContain("deletion-only binding");
    expect(currentSurfaces).not.toContain("deletion-only retirement bindings");
    expect(currentSurfaces).not.toContain("one-time single-region retirement release");
    expect(currentSurfaces).not.toContain("account-deletion maintenance guard");
    expect(currentSurfaces).not.toContain("exact retired production and preview OC buckets");
  });

  it("keeps the daily-report rollback floor after transient mailbox state drains", async () => {
    const deployGuide = await readFile(new URL("../DEPLOY.md", import.meta.url), "utf8");
    const groupChallengeContract = await readFile(
      new URL("../../../agent-docs/product-specs/group-challenge-data-diagnostics.md", import.meta.url),
      "utf8",
    );
    const sectionStart = deployGuide.indexOf("Member-reported daily metrics add the");
    const sectionEnd = deployGuide.indexOf("The scheduled Linq authority release", sectionStart);
    const contractStart = groupChallengeContract.indexOf("Member-reported daily metrics use");
    const contractEnd = groupChallengeContract.indexOf("## Acceptance cases", contractStart);
    expect(sectionStart).toBeGreaterThan(-1);
    expect(sectionEnd).toBeGreaterThan(sectionStart);
    expect(contractStart).toBeGreaterThan(-1);
    expect(contractEnd).toBeGreaterThan(contractStart);

    const dailyReportRollout = deployGuide.slice(sectionStart, sectionEnd);
    const dailyReportContract = groupChallengeContract.slice(contractStart, contractEnd);
    expect(dailyReportRollout).toContain("hard rollback floor");
    expect(dailyReportRollout).toContain("after the transient mailbox item drains");
    expect(dailyReportRollout).toMatch(/never roll the runner below this\s+floor afterward/u);
    expect(dailyReportRollout).toContain("existing meal-photo import");
    expect(dailyReportRollout).toContain("projection rebuild");
    expect(dailyReportRollout).toContain("no event rewrite");
    expect(dailyReportContract).toContain("`apps/cloudflare/DEPLOY.md` is the authoritative rollout and");
    expect(dailyReportContract).toContain("permanent contracts/query/runner rollback floor");
    expect(dailyReportContract).toMatch(/independent of retained, pending, unconsumed, or\s+drained mailbox work/u);

    for (const owner of [dailyReportRollout, dailyReportContract]) {
      expect(owner).not.toContain("rollback floor while any report is retained or unconsumed");
      expect(owner).not.toContain("until the retained population has drained");
    }
  });
});
