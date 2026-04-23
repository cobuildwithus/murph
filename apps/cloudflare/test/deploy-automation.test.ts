import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedWorkerSecretsPayload,
  buildHostedWranglerDeployConfig,
  HOSTED_WORKER_REQUIRED_SECRET_NAMES,
  parseHostedContainerImageListOutput,
  readHostedDeployAutomationEnvironment,
  resolveCloudflareDeployPaths,
  selectHostedContainerImageTagsForCleanup,
} from "../scripts/deploy-automation.js";
import { HOSTED_WORKER_OPTIONAL_SECRET_NAMES } from "../scripts/deploy-automation/worker-secret-names.ts";
import { HOSTED_WORKER_OPTIONAL_VAR_NAMES } from "../scripts/deploy-automation/worker-optional-vars.ts";
import { renderWorkerSecretsFile } from "../scripts/render-worker-secrets.ts";

afterEach(() => {
  vi.doUnmock("node:fs/promises");
  vi.resetModules();
});

function parseJsoncObject(rawConfig: string): Record<string, unknown> {
  return JSON.parse(
    rawConfig
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n")
      .replace(/,\s*([}\]])/gu, "$1"),
  ) as Record<string, unknown>;
}

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

describe("hosted deploy automation helpers", () => {
  it("builds a generated wrangler config for the native container worker", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_CONTAINER_INSTANCE_TYPE: "standard-1",
      CF_CONTAINER_MAX_INSTANCES: "250",
      CF_RUNNER_COMMIT_TIMEOUT_MS: "45000",
      CF_RUNNER_READY_TIMEOUT_MS: "65000",
      CF_WORKER_NAME: "hosted-worker",
      HOSTED_WEB_BASE_URL: "https://web.example.test",
      HOSTED_AI_USAGE_BILLING_MODE: "stripe_meter",
      HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED: "true",
      HOSTED_EXECUTION_AUTOMATION_RECIPIENT_KEY_ID: "automation:v2",
      HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "180000",
      HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_KEY_ID: "tee-automation:v1",
      HOSTED_WAKE_ENCRYPTION_KEY_VERSION: "wake:v2",
      HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS: "openai",
      HOSTED_ASSISTANT_ZERO_DATA_RETENTION: "true",
      HOSTED_EMAIL_DEFAULT_SUBJECT: "Murph note",
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "callback:v2",
      MURPH_WEB_SEARCH_MAX_RESULTS: "8",
      MURPH_WEB_SEARCH_PROVIDER: "brave",
      MURPH_WEB_SEARCH_TIMEOUT_MS: "10000",
      TELEGRAM_BOT_USERNAME: "hosted_bot",
    });
    const config = buildHostedWranglerDeployConfig(environment) as {
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
      }>;
      durable_objects: {
        bindings: Array<{
          class_name: string;
          name: string;
        }>;
      };
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
      send_email?: Array<{
        allowed_sender_addresses?: string[];
        name: string;
      }>;
      vars: Record<string, string>;
      secrets?: { required?: string[] };
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
      },
    ]);
    expect(config.durable_objects.bindings).toEqual([
      {
        class_name: "UserRunnerDurableObject",
        name: "USER_RUNNER",
      },
      {
        class_name: "RunnerContainer",
        name: "RUNNER_CONTAINER",
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
    ]);
    expect(config.compatibility_flags).toEqual(["nodejs_compat"]);
    expect(config.placement).toEqual({ mode: "smart" });
    expect(config.observability).toEqual({
      enabled: true,
      head_sampling_rate: 1,
      logs: {
        enabled: true,
        invocation_logs: true,
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
    expect(config.vars.HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS).toBe("180000");
    expect(config.vars.HOSTED_AI_USAGE_BILLING_MODE).toBe("stripe_meter");
    expect(config.vars.HOSTED_AI_USAGE_VERCEL_STRIPE_BILLING_ENABLED).toBe("true");
    expect(config.vars.HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_KEY_ID).toBe("tee-automation:v1");
    expect(config.vars.HOSTED_WAKE_ENCRYPTION_KEY_VERSION).toBe("wake:v2");
    expect(config.vars.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID).toBe("callback:v2");
    expect(config.vars.HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS).toBe("openai");
    expect(config.vars.HOSTED_ASSISTANT_ZERO_DATA_RETENTION).toBe("true");
    expect(config.vars.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_KEY_ID).toBe("automation:v2");
    expect(config.vars.MURPH_WEB_FETCH_ENABLED).toBe("true");
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
    expect(config.vars.HOSTED_WEB_BASE_URL).toBe("https://web.example.test");
    expect(config.vars.AGENTMAIL_BASE_URL).toBeUndefined();
    expect(config.vars.MURPH_WEB_SEARCH_MAX_RESULTS).toBe("8");
    expect(config.vars.MURPH_WEB_SEARCH_PROVIDER).toBe("brave");
    expect(config.vars.MURPH_WEB_SEARCH_TIMEOUT_MS).toBe("10000");
    expect(config.vars.TELEGRAM_BOT_USERNAME).toBe("hosted_bot");
    expect(config.vars.HOSTED_EXECUTION_RUNNER_BASE_URL).toBeUndefined();
    expect(config.secrets?.required).toEqual([...HOSTED_WORKER_REQUIRED_SECRET_NAMES]);
  });

  it("keeps the checked-in wrangler scaffold aligned with generated container sizing and durable object config", async () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
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
      }>;
      durable_objects: {
        bindings: Array<{
          class_name: string;
          name: string;
        }>;
      };
      migrations: Array<{
        new_sqlite_classes: string[];
        tag: string;
      }>;
      placement: {
        mode: string;
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
      }>;
      durable_objects: {
        bindings: Array<{
          class_name: string;
          name: string;
        }>;
      };
      migrations: Array<{
        new_sqlite_classes: string[];
        tag: string;
      }>;
      placement: {
        mode: string;
      };
    };

    expect(checkedInConfig.containers).toHaveLength(1);
    expect(checkedInConfig.containers[0]).toMatchObject({
      class_name: generatedConfig.containers[0]?.class_name,
      instance_type: generatedConfig.containers[0]?.instance_type,
      max_instances: generatedConfig.containers[0]?.max_instances,
      rollout_active_grace_period: generatedConfig.containers[0]?.rollout_active_grace_period,
      rollout_step_percentage: generatedConfig.containers[0]?.rollout_step_percentage,
    });
    expect(checkedInConfig.durable_objects.bindings).toEqual(generatedConfig.durable_objects.bindings);
    expect(checkedInConfig.migrations).toEqual(generatedConfig.migrations);
    expect(checkedInConfig.placement).toEqual(generatedConfig.placement);
  });

  it("keeps the hosted deploy workflow env surface, fallback defaults, and summary aligned", async () => {
    const workflow = await readFile(
      new URL("../../../.github/workflows/deploy-cloudflare-hosted.yml", import.meta.url),
      "utf8",
    );
    const workflowEnvBindings = new Map(
      [
        ...workflow.matchAll(
          /^\s{6}([A-Z0-9_]+):\s+\$\{\{\s*(vars|secrets)\.[^\n]+$/gmu,
        ),
      ].map((match) => [match[1] ?? "", match[2] ?? ""] as const),
    );

    for (const expectedLine of [
      "CF_CONTAINER_INSTANCE_TYPE: ${{ vars.CF_CONTAINER_INSTANCE_TYPE || '{\"vcpu\":1,\"memory_mib\":3072,\"disk_mb\":6000}' }}",
      "CF_CONTAINER_MAX_INSTANCES: ${{ vars.CF_CONTAINER_MAX_INSTANCES || '1000' }}",
      "HOSTED_EXECUTION_RUNNER_ENV_PROFILES: ${{ vars.HOSTED_EXECUTION_RUNNER_ENV_PROFILES || 'hosted-email,linq,mapbox,telegram' }}",
    ]) {
      expect(workflow).toContain(expectedLine);
    }
    for (const name of HOSTED_WORKER_REQUIRED_SECRET_NAMES) {
      expect(workflowEnvBindings.get(name)).toBe("secrets");
    }
    for (const name of HOSTED_WORKER_OPTIONAL_VAR_NAMES) {
      expect(workflowEnvBindings.get(name)).toBe("vars");
    }
    for (const name of HOSTED_WORKER_OPTIONAL_SECRET_NAMES) {
      expect(workflowEnvBindings.get(name)).toBe("secrets");
    }
    expect(workflow).toContain('echo "- Container max instances: \\`${CF_CONTAINER_MAX_INSTANCES}\\`"');
  });

  it("ignores removed deploy alias inputs and keeps only canonical worker vars", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
      PARSER_FFMPEG_PATH: "/usr/local/bin/ffmpeg",
    });

    expect(environment.workerVars).toEqual({
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "hosted-email,linq,mapbox,telegram",
      MURPH_WEB_FETCH_ENABLED: "true",
    });
  });

  it("lets operators explicitly disable hosted web reads", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
      MURPH_WEB_FETCH_ENABLED: "false",
    });

    expect(environment.workerVars.MURPH_WEB_FETCH_ENABLED).toBe("false");
  });

  it("passes explicit runner env profiles through to worker vars", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "telegram,mapbox",
    });

    expect(environment.workerVars.HOSTED_EXECUTION_RUNNER_ENV_PROFILES).toBe("telegram,mapbox");
  });

  it("defaults runner env profiles to the full hosted integration set", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
    });

    expect(environment.workerVars.HOSTED_EXECUTION_RUNNER_ENV_PROFILES).toBe(
      "hosted-email,linq,mapbox,telegram",
    );
  });

  it("accepts a custom JSON container instance type for generated deploy config", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_CONTAINER_INSTANCE_TYPE: "{\"vcpu\":0.5,\"memory_mib\":2048,\"disk_mb\":8192}",
      CF_WORKER_NAME: "hosted-worker",
    });

    expect(environment.containerInstanceType).toEqual({
      disk_mb: 8192,
      memory_mib: 2048,
      vcpu: 0.5,
    });
  });

  it("rejects invalid custom container instance JSON", () => {
    expect(() =>
      readHostedDeployAutomationEnvironment({
        CF_BUNDLES_BUCKET: "hosted-bundles",
        CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
        CF_CONTAINER_INSTANCE_TYPE: "{\"vcpu\":0.5,\"memory_mib\":2048}",
        CF_WORKER_NAME: "hosted-worker",
      }),
    ).toThrowError(/CF_CONTAINER_INSTANCE_TYPE\.disk_mb must be a positive number\./u);
  });

  it("renders required and optional worker secrets from CI secrets", () => {
    expect(buildHostedWorkerSecretsPayload({
      AGENTMAIL_API_KEY: "agentmail-secret",
      BRAVE_API_KEY: "brave-key",
      CEREBRAS_API_KEY: "cerebras-key",
      DEEPSEEK_API_KEY: "deepseek-key",
      FIREWORKS_API_KEY: "fireworks-key",
      GARMIN_CLIENT_ID: "garmin-client-id",
      GARMIN_CLIENT_SECRET: "garmin-client-secret",
      HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY: "stripe-restricted-key",
      HOSTED_EMAIL_SIGNING_SECRET: "email-signing-secret",
      HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK: "automation-private-jwk",
      HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_KEYRING_JSON: "{\"automation:v1\":{}}",
      HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK: "automation-public-jwk",
      HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "bundle-key",
      HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON: "{\"v0\":\"old-key\"}",
      HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK: "recovery-public-jwk",
      HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK: "tee-automation-public-jwk",
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
      HOSTED_WAKE_ENCRYPTION_KEY: "hosted-ingress-encryption-key",
      HOSTED_WAKE_ENCRYPTION_KEYRING_JSON: "{\"v0\":\"old-wake-key\"}",
      HF_TOKEN: "hf-token",
      HUGGINGFACEHUB_API_TOKEN: "huggingfacehub-token",
      HUGGINGFACE_API_KEY: "huggingface-api-key",
      HUGGING_FACE_HUB_TOKEN: "hugging-face-hub-token",
      LITELLM_PROXY_API_KEY: "litellm-proxy-key",
      LM_STUDIO_API_KEY: "lm-studio-key",
      MAPBOX_ACCESS_TOKEN: "mapbox-token",
      NVIDIA_API_KEY: "nvidia-key",
      NGC_API_KEY: "ngc-key",
      OLLAMA_API_KEY: "ollama-key",
      OPENAI_API_KEY: "sk-user",
      PERPLEXITY_API_KEY: "perplexity-key",
      STRAVA_CLIENT_ID: "strava-client-id",
      STRAVA_CLIENT_SECRET: "strava-client-secret",
      TELEGRAM_BOT_TOKEN: "bot-token",
      TELEGRAM_WEBHOOK_SECRET: "telegram-webhook-secret",
      VERCEL_AI_API_KEY: "vercel-ai-gateway-key",
      VLLM_API_KEY: "vllm-key",
    })).toEqual({
      BRAVE_API_KEY: "brave-key",
      CEREBRAS_API_KEY: "cerebras-key",
      DEEPSEEK_API_KEY: "deepseek-key",
      FIREWORKS_API_KEY: "fireworks-key",
      GARMIN_CLIENT_ID: "garmin-client-id",
      GARMIN_CLIENT_SECRET: "garmin-client-secret",
      HOSTED_AI_USAGE_STRIPE_RESTRICTED_ACCESS_KEY: "stripe-restricted-key",
      HOSTED_EMAIL_SIGNING_SECRET: "email-signing-secret",
      HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK: "automation-private-jwk",
      HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_KEYRING_JSON: "{\"automation:v1\":{}}",
      HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK: "automation-public-jwk",
      HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "bundle-key",
      HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON: "{\"v0\":\"old-key\"}",
      HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK: "recovery-public-jwk",
      HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK: "tee-automation-public-jwk",
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
      HOSTED_WAKE_ENCRYPTION_KEY: "hosted-ingress-encryption-key",
      HOSTED_WAKE_ENCRYPTION_KEYRING_JSON: "{\"v0\":\"old-wake-key\"}",
      HF_TOKEN: "hf-token",
      HUGGINGFACEHUB_API_TOKEN: "huggingfacehub-token",
      HUGGINGFACE_API_KEY: "huggingface-api-key",
      HUGGING_FACE_HUB_TOKEN: "hugging-face-hub-token",
      LITELLM_PROXY_API_KEY: "litellm-proxy-key",
      LM_STUDIO_API_KEY: "lm-studio-key",
      MAPBOX_ACCESS_TOKEN: "mapbox-token",
      NVIDIA_API_KEY: "nvidia-key",
      NGC_API_KEY: "ngc-key",
      OLLAMA_API_KEY: "ollama-key",
      OPENAI_API_KEY: "sk-user",
      PERPLEXITY_API_KEY: "perplexity-key",
      STRAVA_CLIENT_ID: "strava-client-id",
      STRAVA_CLIENT_SECRET: "strava-client-secret",
      TELEGRAM_BOT_TOKEN: "bot-token",
      VERCEL_AI_API_KEY: "vercel-ai-gateway-key",
      VLLM_API_KEY: "vllm-key",
    });
  });

  it("keeps only known hosted assistant provider env names in deploy automation", () => {
    expect(buildHostedWorkerSecretsPayload({
      HOSTED_ASSISTANT_API_KEY_ENV: "OPENAI_API_KEY",
      HOSTED_ASSISTANT_MODEL: "gpt-4.1-mini",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ASSISTANT_ZERO_DATA_RETENTION: "true",
      HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK: "automation-private-jwk",
      HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK: "automation-public-jwk",
      HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "bundle-key",
      HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK: "recovery-public-jwk",
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
      HOSTED_WAKE_ENCRYPTION_KEY: "hosted-ingress-encryption-key",
      OPENAI_API_KEY: "sk-user",
    })).toMatchObject({
      OPENAI_API_KEY: "sk-user",
    });

    expect(buildHostedWorkerSecretsPayload({
      HOSTED_ASSISTANT_API_KEY_ENV: "OPENAI_ENTERPRISE_API_KEY",
      HOSTED_ASSISTANT_MODEL: "gpt-4.1-mini",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK: "automation-private-jwk",
      HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK: "automation-public-jwk",
      HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "bundle-key",
      HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK: "recovery-public-jwk",
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-private-jwk",
      HOSTED_WAKE_ENCRYPTION_KEY: "hosted-ingress-encryption-key",
      OPENAI_ENTERPRISE_API_KEY: "sk-enterprise",
    }).OPENAI_ENTERPRISE_API_KEY).toBeUndefined();

    expect(readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
      HOSTED_ASSISTANT_API_KEY_ENV: "OPENAI_ENTERPRISE_API_KEY",
      HOSTED_ASSISTANT_MODEL: "gpt-4.1-mini",
      HOSTED_ASSISTANT_PROVIDER: "openai",
    }).workerVars.HOSTED_ASSISTANT_API_KEY_ENV).toBeUndefined();

    expect(readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
      HOSTED_ASSISTANT_API_KEY_ENV: "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
      HOSTED_ASSISTANT_MODEL: "gpt-4.1-mini",
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
});
