import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedWorkerSecretsPayload,
  buildHostedWranglerDeployConfig,
  HOSTED_WORKER_OPTIONAL_VAR_NAMES,
  HOSTED_WORKER_REQUIRED_SECRET_NAMES,
  HOSTED_WORKER_REQUIRED_VAR_NAMES,
  parseHostedContainerImageListOutput,
  readHostedDeployAutomationEnvironment,
  resolveCloudflareDeployPaths,
  selectHostedContainerImageTagsForCleanup,
} from "../scripts/deploy-automation.js";
import { HOSTED_WORKER_OPTIONAL_SECRET_NAMES } from "../scripts/deploy-automation/worker-secret-names.ts";
import { renderWorkerSecretsFile } from "../scripts/render-worker-secrets.ts";
import { hostedLocalRunnerBaseImageTag } from "../scripts/runner-base-image-contract.ts";
import { verifyHostedWebComputerCapabilities } from "../scripts/verify-web-computer-capabilities.ts";
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
  "VENICE_API_KEY",
  "VLLM_API_KEY",
  "XAI_API_KEY",
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
  HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION:
    "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1",
  HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
    "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----",
  HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cloudflare-automation:v1",
  HOSTED_CRYPTO_ENV: "production",
  HOSTED_R2_PRESIGN_ACCOUNT_ID: "r2-account-test",
  HOSTED_R2_PRESIGN_BUCKET_NAME: "hosted-bundles",
} as const;
const REQUIRED_R2_PRESIGN_WORKER_SECRETS = {
  HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "r2-access-fixture",
  HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "r2-signing-fixture",
} as const;
const VALID_TEST_SSH_ED25519_PUBLIC_KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB";

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
      HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "180000",
      HOSTED_ASSISTANT_APPROVAL_POLICY: "never",
      HOSTED_ASSISTANT_MODEL: "gpt-5.5",
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
      version_metadata?: {
        binding: string;
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
      },
      {
        class_name: "DeploySmokeRunnerContainer",
        image: "../../../Dockerfile.cloudflare-hosted-runner",
        image_build_context: "..",
        instance_type: "standard-1",
        max_instances: 1,
        rollout_active_grace_period: 300,
        rollout_step_percentage: [100],
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
      {
        class_name: "DeploySmokeRunnerContainer",
        name: "RUNNER_CONTAINER_SMOKE",
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
    ]);
    expect(config.compatibility_flags).toEqual(["nodejs_compat"]);
    expect(config.placement).toEqual({ mode: "smart" });
    expect(config).not.toHaveProperty("queues");
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
    expect(config.vars.HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION).toContain("cryptoKeyVersions/1");
    expect(config.vars.HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM).toContain("BEGIN PUBLIC KEY");
    expect(config.vars.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID).toBe("cloudflare-automation:v2");
    expect(config.vars.HOSTED_CRYPTO_ENV).toBe("production");
    expect(config.vars.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID).toBe("callback:v2");
    expect(config.vars.HOSTED_ASSISTANT_APPROVAL_POLICY).toBe("never");
    expect(config.vars.HOSTED_ASSISTANT_MODEL).toBe("gpt-5.5");
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
    expect(config.vars.AGENTMAIL_BASE_URL).toBeUndefined();
    expect(config.vars.TELEGRAM_BOT_USERNAME).toBe("hosted_bot");
    expect(config.vars.HOSTED_EXECUTION_RUNNER_BASE_URL).toBeUndefined();
    expect(config.secrets?.required).toEqual([...HOSTED_WORKER_REQUIRED_SECRET_NAMES]);
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

  it("can omit the optional hosted email send binding for deploy tokens without that permission", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_HOSTED_EMAIL_SEND_BINDING_ENABLED: "false",
      CF_WORKER_NAME: "hosted-worker",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
      HOSTED_EMAIL_DEFAULT_SUBJECT: "Murph note",
      HOSTED_EMAIL_DOMAIN: "mail.example.test",
      HOSTED_EMAIL_FROM_ADDRESS: "assistant@mail.example.test",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
    });
    const config = buildHostedWranglerDeployConfig(environment) as {
      send_email?: unknown;
      vars: Record<string, string>;
    };

    expect(config).not.toHaveProperty("send_email");
    expect(config.vars.HOSTED_EMAIL_DEFAULT_SUBJECT).toBe("Murph note");
    expect(config.vars.HOSTED_EMAIL_DOMAIN).toBe("mail.example.test");
    expect(config.vars.HOSTED_EMAIL_FROM_ADDRESS).toBe("assistant@mail.example.test");
    expect(config.vars.HOSTED_EMAIL_LOCAL_PART).toBe("assistant");
  });

  it("keeps the checked-in wrangler scaffold aligned with generated container sizing and durable object config", async () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "murph-hosted",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
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
      version_metadata?: {
        binding: string;
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
      version_metadata?: {
        binding: string;
      };
    };

    expect(checkedInConfig.containers).toHaveLength(generatedConfig.containers.length);
    for (const [index, generatedContainer] of generatedConfig.containers.entries()) {
      expect(checkedInConfig.containers[index]).toMatchObject({
        class_name: generatedContainer.class_name,
        instance_type: generatedContainer.instance_type,
        max_instances: generatedContainer.max_instances,
        rollout_active_grace_period: generatedContainer.rollout_active_grace_period,
        rollout_step_percentage: generatedContainer.rollout_step_percentage,
      });
    }
    expect(checkedInConfig.durable_objects.bindings).toEqual(generatedConfig.durable_objects.bindings);
    expect(checkedInConfig.migrations).toEqual(generatedConfig.migrations);
    expect(checkedInConfig.placement).toEqual(generatedConfig.placement);
    expect(checkedInConfig).not.toHaveProperty("queues");
    expect(generatedConfig).not.toHaveProperty("queues");
    expect(checkedInConfig.version_metadata).toEqual(generatedConfig.version_metadata);
  });

  it("keeps the checked-in wrangler scaffold vars aligned with default-rendered deploy vars", async () => {
    // Guards the drift class where a scaffold var (e.g. the runner idle TTL)
    // is edited in source but real deploys silently keep shipping another
    // value. Required vars are exempt: the scaffold holds placeholders and
    // deploys supply them from the GitHub environment.
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "murph-hosted",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
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

  it("keeps the hosted deploy workflow env surface, defaults, and summary aligned", async () => {
    const workflow = await readFile(
      new URL("../../../.github/workflows/deploy-cloudflare-hosted.yml", import.meta.url),
      "utf8",
    );
    const workflowEnvBindings = new Map(
      [
        ...workflow.matchAll(
          /^\s{6}([A-Z0-9_]+):\s+\$\{\{\s*(?:inputs\.[^|}\n]+\|\|\s*)?(vars|secrets)\.[^\n]+$/gmu,
        ),
      ].map((match) => [match[1] ?? "", match[2] ?? ""] as const),
    );

    for (const expectedLine of [
      "CF_CONTAINER_INSTANCE_TYPE: ${{ vars.CF_CONTAINER_INSTANCE_TYPE || '{\"vcpu\":1,\"memory_mib\":3072,\"disk_mb\":6000}' }}",
      "CF_CONTAINER_MAX_INSTANCES: ${{ vars.CF_CONTAINER_MAX_INSTANCES || '1000' }}",
      "CF_CONTAINER_SSH_KEY_NAME: ${{ vars.CF_CONTAINER_SSH_KEY_NAME }}",
      "CF_CONTAINER_SSH_PUBLIC_KEY: ${{ vars.CF_CONTAINER_SSH_PUBLIC_KEY }}",
      "CF_WEB_CONTROL_TIMEOUT_MS: ${{ vars.CF_WEB_CONTROL_TIMEOUT_MS }}",
      "HOSTED_EXECUTION_CONTAINER_ROLLOUT: ${{ inputs.container_rollout }}",
      "HOSTED_EXECUTION_DEPLOY_CONTEXT: ${{ inputs.environment }}",
      "HOSTED_EXECUTION_RUNNER_ENV_PROFILES: ${{ vars.HOSTED_EXECUTION_RUNNER_ENV_PROFILES || 'exa,hosted-email,linq,mapbox,telegram,whatsapp' }}",
      "HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: ${{ inputs.runner_idle_ttl_ms || vars.HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS }}",
      "HOSTED_EXECUTION_SMOKE_DIRECT_R2_PRESIGNED_PUT: ${{ inputs.container_rollout == 'immediate' && 'true' || 'false' }}",
      "HOSTED_EXECUTION_SMOKE_LIVE_MODEL_TURN: ${{ inputs.live_model_turn && 'true' || 'false' }}",
      'HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER: "true"',
      "live_model_turn:",
      "description: Run one real gpt-5.4-nano turn in the deployed container smoke",
      'HOSTED_EXECUTION_SMOKE_RUNNER_MAX_ATTEMPTS: "300"',
      'HOSTED_EXECUTION_SMOKE_RUNNER_RETRY_DELAY_MS: "3000"',
      "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: ${{ vars.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID }}",
      "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: ${{ secrets.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK }}",
      "HOSTED_WEB_PRODUCTION_BASE_URL: ${{ vars.HOSTED_WEB_PRODUCTION_BASE_URL }}",
      "DEPLOY_SUMMARY_CONTAINER_ROLLOUT: ${{ inputs.container_rollout }}",
      "DEPLOY_SUMMARY_ENVIRONMENT: ${{ inputs.environment }}",
      "DEPLOY_SUMMARY_FINAL_VERSION_TRAFFIC: ${{ steps.deploy.outputs.final_version_traffic || 'not-deployed' }}",
      "DEPLOY_SUMMARY_RUNNER_IDLE_TTL_MS: ${{ inputs.runner_idle_ttl_ms || 'environment default' }}",
      "DEPLOY_SUMMARY_SMOKE_USER_ID: ${{ inputs.smoke_user_id || 'not-set' }}",
      "printf -- '- Container rollout: `%s`\\n' \"${DEPLOY_SUMMARY_CONTAINER_ROLLOUT}\"",
      "printf -- '- Runner idle TTL override: `%s`\\n' \"${DEPLOY_SUMMARY_RUNNER_IDLE_TTL_MS}\"",
      "printf -- '- Smoke user id: `%s`\\n' \"${DEPLOY_SUMMARY_SMOKE_USER_ID}\"",
      "MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY: 1",
      "MURPH_RUNNER_BUNDLE_PACK_CONCURRENCY: 4",
      'MURPH_HOSTED_LOCAL_E2E_FAST_GATE: "1"',
      "runs-on: blacksmith-4vcpu-ubuntu-2404",
      "name: Codex cache-prefix E2E gate",
      "skip_predeploy_e2e:",
      "description: Skip predeploy hosted-local E2E gates",
      "runner_idle_ttl_ms:",
      "description: Optional runner container idle TTL override in milliseconds",
      "if: ${{ !inputs.skip_predeploy_e2e && github.ref == 'refs/heads/main' && github.ref_protected }}",
      "if: ${{ inputs.deploy_worker && !inputs.skip_predeploy_e2e && github.ref == 'refs/heads/main' && github.ref_protected }}",
      "if: ${{ inputs.deploy_worker && inputs.skip_predeploy_e2e && inputs.container_rollout == 'immediate' && github.ref == 'refs/heads/main' && github.ref_protected }}",
      "if: ${{ !cancelled() && ((inputs.skip_predeploy_e2e && !inputs.deploy_worker && needs.codex-auth-deploy-guard.result == 'success') || (inputs.skip_predeploy_e2e && inputs.deploy_worker && inputs.container_rollout == 'immediate' && needs.immediate-build-prep-gate.result == 'success') || (!inputs.skip_predeploy_e2e && needs.codex-auth-deploy-guard.result == 'success' && needs.codex-cache-prefix-gate.result == 'success' && needs.linq-delivery-gate.result == 'success' && needs.linq-scheduled-reminder-gate.result == 'success' && (!inputs.deploy_worker || needs.cloudflare-runner-smoke-gate.result == 'success'))) }}",
      "name: Linq delivery E2E gate",
      "name: Linq scheduled reminder E2E gate",
      "name: Cloudflare verify and runner smoke gate",
      "name: Immediate deploy build prep",
      "pnpm hosted-local e2e codex-gateway-prefix --profile e2e:live 2>&1 \\",
      "pnpm hosted-local e2e linq-delivery 2>&1 \\",
      "pnpm hosted-local e2e linq-scheduled-reminder 2>&1 \\",
      "cloudflare-hosted-deploy-codex-cache-prefix-logs",
      "cloudflare-hosted-deploy-linq-delivery-logs",
      "cloudflare-hosted-deploy-linq-scheduled-reminder-logs",
      "- linq-delivery-gate",
      "- linq-scheduled-reminder-gate",
      "- cloudflare-runner-smoke-gate",
      "- immediate-build-prep-gate",
      "name: Start Postgres",
      "docker run \\",
      "--name \"${postgres_container}\"",
      "--publish 5432:5432",
      "docker exec \"${postgres_container}\" pg_isready -U postgres -d murph_test",
      "name: Stop Postgres",
      "runs-on: ubuntu-24.04",
      "uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6",
      "uses: pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320 # v5",
      "uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6",
      "uses: actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f # v6",
      "uses: actions/download-artifact@018cc2cf5baa6db3ef3c5f8a56943fffe632ef53 # v6",
      "packages: read",
      "name: Login to GHCR",
      "name: Login to GHCR for runner model image",
      "docker login ghcr.io -u \"${{ github.actor }}\" --password-stdin",
      "continuing with anonymous pulls and local rebuild fallback",
      "name: Prepare runner bundle and base image",
      "run: pnpm --dir apps/cloudflare runner:bundle && pnpm --dir apps/cloudflare runner:docker:base -- --force",
      "name: Prepare immediate runner bundle and base image",
      "run: pnpm --dir apps/cloudflare runner:docker:base -- --force",
      "name: Save immediate build artifacts",
      "tar --hard-dereference -czf .artifacts/cloudflare-hosted-deploy/runner-bundle.tar.gz \\",
      `docker save ${hostedLocalRunnerBaseImageTag} \\`,
      "name: Upload immediate build handoff",
      "cloudflare-hosted-immediate-build-${{ github.sha }}",
      "name: Download immediate build handoff",
      "name: Restore immediate build handoff",
      "name: Validate immediate runner bundle manifest",
      "resolve_handoff_archive() {",
      'bundle_archive="$(',
      'runner_base_archive="$(',
      "BUNDLE_ARCHIVE=\"${bundle_archive}\" python3 <<'PY'",
      "with tarfile.open(archive_path, \"r:gz\") as archive:",
      "normalize_bundle_path(member.linkname, \"hardlink target\")",
      'bundle_root="$(realpath -m "${restore_staging}/runner-bundle")"',
      'link_target="$(readlink "${link_path}")"',
      "Unsafe runner bundle symlink target.",
      "tar --no-same-owner --no-same-permissions -xzf \"${bundle_archive}\" \\",
      "gzip -dc \"${runner_base_archive}\" | docker load",
      "name: Render Worker secrets",
      "if: ${{ inputs.deploy_worker && inputs.sync_worker_secrets }}",
      "run: pnpm --dir apps/cloudflare deploy:secrets:render",
      "name: Run hosted Codex auth deploy guard",
      "if: ${{ !(inputs.deploy_worker && inputs.skip_predeploy_e2e && inputs.container_rollout == 'immediate') }}",
      'MURPH_RUN_HOSTED_CODEX_AUTH_E2E: "1"',
      'npm_prefix="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/hosted-codex-auth-guard-npm"',
      'npm install --prefix "${npm_prefix}" --global --omit=dev --no-audit --no-fund --ignore-scripts "@openai/codex@${codex_cli_version}"',
      'export PATH="${npm_prefix}/bin:${PATH}"',
      "codex --version",
      "pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-codex-config.test.ts",
      "name: Validate generated Worker deploy bundle",
      "--dry-run",
      "predeploy-${GITHUB_SHA::12}",
      "Deploy commit SHA: ${checked_out_sha}",
      "Expected GitHub SHA: ${GITHUB_SHA}",
      "name: Run focused Cloudflare checks and smoke runner container image",
      "pnpm --dir apps/cloudflare verify:parallel &",
      "pnpm --dir apps/cloudflare runner:docker:smoke:prepared-base &",
      "name: Run focused Cloudflare checks",
      "if: ${{ !inputs.deploy_worker }}",
      "name: Show generated artifact paths",
      "run: pnpm --dir apps/cloudflare verify:parallel",
      "run: pnpm --dir apps/cloudflare deploy:config:render && pnpm --dir apps/cloudflare runner:bundle",
      "run: pnpm --dir apps/cloudflare runner:bundle:manifest:validate",
      "run: pnpm --dir apps/cloudflare deploy:config:render && pnpm --dir apps/cloudflare runner:bundle:manifest:refresh",
    ]) {
      expect(workflow).toContain(expectedLine);
    }
    expect(workflow).not.toContain("Rebuild deploy artifacts for upload");
    expect(workflow).not.toContain("name: Smoke runner container image");
    expect(workflow).not.toContain("uses: docker/setup-buildx-action@v4");
    expect(workflow).not.toContain("uses: docker/build-push-action@v7");
    expect(workflow).not.toContain("uses: useblacksmith/setup-docker-builder");
    expect(workflow).not.toContain("uses: useblacksmith/build-push-action");
    expect(workflow).not.toContain("cache-from: type=gha,scope=cloudflare-runner-base");
    expect(workflow).not.toContain("cache-to: type=gha,mode=max,scope=cloudflare-runner-base");
    expect(workflow).not.toContain("CF_RUNNER_DESTROY_TIMEOUT_MS");
    expect(workflow).not.toContain("HOSTED_EXECUTION_AUTOMATION_RECIPIENT");
    expect(workflow).not.toContain("run: pnpm --dir apps/cloudflare deploy:artifacts");
    const prepareArtifactsStepIndex = workflow.indexOf("- name: Prepare deploy artifacts");
    const blacksmithPrepareRunnerStepIndex = workflow.indexOf(
      "- name: Prepare runner bundle and base image",
    );
    const hostedCodexAuthGuardStepIndex = workflow.indexOf(
      "- name: Run hosted Codex auth deploy guard",
    );
    const validateDeployEnvStepIndex = workflow.indexOf(
      "- name: Validate required deploy environment",
    );
    const prepareRunnerBaseImageStepIndex = workflow.indexOf("- name: Prepare runner base image");
    const parallelChecksAndSmokeStepIndex = workflow.indexOf(
      "- name: Run focused Cloudflare checks and smoke runner container image",
    );
    const immediateBuildPrepJobStartIndex = workflow.indexOf("  immediate-build-prep-gate:");
    const immediateUploadHandoffStepIndex = workflow.indexOf(
      "- name: Upload immediate build handoff",
    );
    const immediateDownloadHandoffStepIndex = workflow.indexOf(
      "- name: Download immediate build handoff",
    );
    const immediateManifestRefreshStepIndex = workflow.indexOf(
      "- name: Render deploy config for immediate handoff",
    );
    const immediateManifestValidateStepIndex = workflow.indexOf(
      "- name: Validate immediate runner bundle manifest",
    );
    const immediateManifestValidateCommandIndex = workflow.indexOf(
      "runner:bundle:manifest:validate",
    );
    const immediateManifestRefreshCommandIndex = workflow.indexOf(
      "runner:bundle:manifest:refresh",
    );
    const validateGeneratedDeployBundleStepIndex = workflow.indexOf(
      "- name: Validate generated Worker deploy bundle",
    );
    const renderWorkerSecretsStepIndex = workflow.indexOf("- name: Render Worker secrets");
    const deployWorkerStepIndex = workflow.indexOf("- name: Deploy Worker");
    expect(prepareArtifactsStepIndex).toBeGreaterThanOrEqual(0);
    expect(blacksmithPrepareRunnerStepIndex).toBeGreaterThanOrEqual(0);
    expect(hostedCodexAuthGuardStepIndex).toBeGreaterThanOrEqual(0);
    expect(validateDeployEnvStepIndex).toBeGreaterThanOrEqual(0);
    expect(prepareRunnerBaseImageStepIndex).toBeGreaterThanOrEqual(0);
    expect(parallelChecksAndSmokeStepIndex).toBeGreaterThanOrEqual(0);
    expect(immediateBuildPrepJobStartIndex).toBeGreaterThanOrEqual(0);
    expect(immediateUploadHandoffStepIndex).toBeGreaterThanOrEqual(0);
    expect(immediateDownloadHandoffStepIndex).toBeGreaterThanOrEqual(0);
    expect(immediateManifestRefreshStepIndex).toBeGreaterThanOrEqual(0);
    expect(immediateManifestValidateStepIndex).toBeGreaterThanOrEqual(0);
    expect(immediateManifestValidateCommandIndex).toBeGreaterThanOrEqual(0);
    expect(immediateManifestRefreshCommandIndex).toBeGreaterThanOrEqual(0);
    expect(validateGeneratedDeployBundleStepIndex).toBeGreaterThanOrEqual(0);
    expect(renderWorkerSecretsStepIndex).toBeGreaterThanOrEqual(0);
    expect(deployWorkerStepIndex).toBeGreaterThanOrEqual(0);
    expect(blacksmithPrepareRunnerStepIndex).toBeLessThan(parallelChecksAndSmokeStepIndex);
    expect(parallelChecksAndSmokeStepIndex).toBeLessThan(hostedCodexAuthGuardStepIndex);
    expect(hostedCodexAuthGuardStepIndex).toBeLessThan(validateDeployEnvStepIndex);
    expect(immediateBuildPrepJobStartIndex).toBeLessThan(validateDeployEnvStepIndex);
    expect(immediateDownloadHandoffStepIndex).toBeLessThan(validateDeployEnvStepIndex);
    expect(immediateManifestValidateStepIndex).toBeLessThan(validateDeployEnvStepIndex);
    expect(prepareArtifactsStepIndex).toBeLessThan(prepareRunnerBaseImageStepIndex);
    expect(immediateManifestRefreshStepIndex).toBeLessThan(validateGeneratedDeployBundleStepIndex);
    expect(immediateManifestValidateCommandIndex).toBeLessThan(
      immediateManifestRefreshCommandIndex,
    );
    expect(prepareRunnerBaseImageStepIndex).toBeLessThan(validateGeneratedDeployBundleStepIndex);
    expect(validateGeneratedDeployBundleStepIndex).toBeLessThan(deployWorkerStepIndex);
    const cloudflareRunnerSmokeGateStartIndex = workflow.indexOf("  cloudflare-runner-smoke-gate:");
    const deployJobStartIndex = workflow.indexOf("\n  deploy:", immediateBuildPrepJobStartIndex);
    expect(cloudflareRunnerSmokeGateStartIndex).toBeGreaterThanOrEqual(0);
    expect(deployJobStartIndex).toBeGreaterThan(immediateBuildPrepJobStartIndex);
    expect(workflow.slice(cloudflareRunnerSmokeGateStartIndex, deployJobStartIndex)).not.toContain(
      "\n    environment:",
    );
    expect(workflow.slice(cloudflareRunnerSmokeGateStartIndex, deployJobStartIndex)).not.toContain(
      "\n    secrets:",
    );
    expect(workflow).toContain(
      "- name: Show generated artifact paths\n        if: ${{ inputs.deploy_worker }}\n        run: ls -lah apps/cloudflare/.deploy",
    );
    expect([
      ...workflow.matchAll(/^        run: pnpm --dir apps\/cloudflare deploy:config:render && pnpm --dir apps\/cloudflare runner:bundle$/gmu),
    ]).toHaveLength(1);
    expect([
      ...workflow.matchAll(/runs-on: blacksmith-4vcpu-ubuntu-2404/gmu),
    ]).toHaveLength(1);
    expect(workflow).toContain(
      "name: Immediate deploy build prep\n    if: ${{ inputs.deploy_worker && inputs.skip_predeploy_e2e && inputs.container_rollout == 'immediate' && github.ref == 'refs/heads/main' && github.ref_protected }}\n    runs-on: blacksmith-4vcpu-ubuntu-2404",
    );
    expect([...workflow.matchAll(/^    runs-on: ubuntu-24\.04$/gmu)]).toHaveLength(6);
    expect(workflow).not.toMatch(/inputs\.deploy_worker.{0,160}blacksmith-4vcpu-ubuntu-2404/u);
    expect([
      ...workflow.matchAll(/docker run \\/gmu),
    ]).toHaveLength(3);
    expect([...workflow.matchAll(/^      - name: Login to GHCR$/gmu)]).toHaveLength(3);
    expect([
      ...workflow.matchAll(/^      - name: Login to GHCR for runner model image$/gmu),
    ]).toHaveLength(3);
    expect([
      ...workflow.matchAll(/continuing with anonymous pulls and local rebuild fallback/gmu),
    ]).toHaveLength(3);
    expect(workflow).not.toContain("services:");
    expect(workflow).toContain('          )"\n          if [[ -z "${latest_log}" ]]; then');
    for (const name of HOSTED_WORKER_REQUIRED_SECRET_NAMES) {
      expect(workflowEnvBindings.get(name)).toBeUndefined();
      expect(workflow).toContain(`${name}: \${{ secrets.${name} }}`);
    }
    const renderWorkerSecretsStep = workflow.slice(
      renderWorkerSecretsStepIndex,
      workflow.indexOf("\n      - name:", renderWorkerSecretsStepIndex + 1),
    );
    const deployWorkerStep = workflow.slice(
      deployWorkerStepIndex,
      workflow.indexOf("\n      - name:", deployWorkerStepIndex + 1),
    );
    for (const name of HOSTED_WORKER_REQUIRED_SECRET_NAMES) {
      expect(deployWorkerStep).toContain(`${name}: \${{ secrets.${name} }}`);
    }
    const validateDeployEnvStep = workflow.slice(
      validateDeployEnvStepIndex,
      workflow.indexOf("\n      - name:", validateDeployEnvStepIndex + 1),
    );
    for (const name of HOSTED_WORKER_REQUIRED_SECRET_NAMES) {
      expect(validateDeployEnvStep).toContain(`${name}: \${{ secrets.${name} }}`);
    }
    for (const name of HOSTED_WORKER_REQUIRED_VAR_NAMES) {
      expect(workflowEnvBindings.get(name)).toBe("vars");
    }
    for (const name of HOSTED_WORKER_OPTIONAL_VAR_NAMES) {
      expect(workflowEnvBindings.get(name)).toBe("vars");
    }
    for (const name of HOSTED_WORKER_OPTIONAL_SECRET_NAMES) {
      expect(workflowEnvBindings.get(name)).toBeUndefined();
      expect(renderWorkerSecretsStep).toContain(`${name}: \${{ secrets.${name} }}`);
      expect(deployWorkerStep).toContain(`${name}: \${{ secrets.${name} }}`);
    }
    for (const name of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"] as const) {
      expect(workflowEnvBindings.get(name)).toBeUndefined();
      expect(workflow).toContain(`${name}: \${{ secrets.${name} }}`);
    }
    expect(
      [...workflowEnvBindings.keys()].filter((name) => name.startsWith("HOSTED_ASSISTANT_")).sort(),
    ).toEqual(
      HOSTED_WORKER_OPTIONAL_VAR_NAMES
        .filter((name) => name.startsWith("HOSTED_ASSISTANT_"))
        .sort(),
    );
    for (const name of LEGACY_HOSTED_ASSISTANT_PROVIDER_SECRET_NAMES) {
      expect(workflowEnvBindings.get(name)).toBeUndefined();
      expect(workflow).not.toContain(`${name}:`);
    }
    for (const name of REMOVED_HOSTED_ASSISTANT_VAR_NAMES) {
      expect(workflowEnvBindings.get(name)).toBeUndefined();
      expect(workflow).not.toContain(`${name}:`);
    }
    expect([
      ...workflow.matchAll(/pnpm --dir apps\/cloudflare verify:parallel/gmu),
    ]).toHaveLength(2);
    expect(findMutableActionRefs(workflow)).toEqual([]);
    expect(findRunCommandsWithGitHubInputInterpolation(workflow)).toEqual([]);
    expect(workflow).toContain("printf -- '- Container max instances: `%s`\\n' \"${CF_CONTAINER_MAX_INSTANCES}\"");
    expect(workflow).toContain(
      "Native container image: base prepared from \\`Dockerfile.cloudflare-hosted-runner-base\\`; app layer built from \\`Dockerfile.cloudflare-hosted-runner\\` during deploy",
    );
  });

  it("verifies production hosted web computer-use capabilities before Worker deploys", async () => {
    const requests: Request[] = [];

    await verifyHostedWebComputerCapabilities({
      env: {
        HOSTED_WEB_PRODUCTION_BASE_URL: "https://web.example.test",
      },
      fetchImpl: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);

        return Response.json({
          computerUse: {
            profileMode: "member",
          },
          ok: true,
          service: "hosted-web",
        });
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://web.example.test/api/internal/health");
    expect(requests[0]?.method).toBe("GET");
    const headerNames: string[] = [];
    requests[0]?.headers.forEach((_value, key) => headerNames.push(key));
    expect(headerNames).toEqual([]);
  });

  it.each([
    {
      expectedError: "Hosted web computer-use capability check is missing computerUse.profileMode=member",
      name: "missing computer-use capability",
      response: () => Response.json({
        ok: true,
        service: "hosted-web",
      }),
    },
    {
      expectedError: "Hosted web computer-use capability check is missing computerUse.profileMode=member",
      name: "old computer capabilities shape",
      response: () => Response.json({
        memberScopedProfileRequired: true,
      }),
    },
    {
      expectedError: "Hosted web computer-use capability check returned invalid JSON",
      name: "invalid JSON",
      response: () => new Response("{not json", {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      }),
    },
    {
      expectedError: "Hosted web computer-use capability check failed with HTTP 503",
      name: "non-2xx health response",
      response: () => new Response("unavailable", { status: 503 }),
    },
  ])("rejects stale hosted web computer-use capabilities: $name", async ({
    expectedError,
    response,
  }) => {
    await expect(verifyHostedWebComputerCapabilities({
      env: {
        HOSTED_WEB_PRODUCTION_BASE_URL: "https://web.example.test",
      },
      fetchImpl: async () => response(),
    })).rejects.toThrow(expectedError);
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
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "exa,hosted-email,linq,mapbox,telegram,whatsapp",
      HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "1200000",
      HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "production",
    });
  });

  it("keeps the immediate deploy script on the default runner idle TTL", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };
    const immediateDeployScript = packageJson.scripts?.["cf:deploy:immediate"];
    const workflowInputs = new Map(
      [...(immediateDeployScript ?? "").matchAll(/(?:^|\s)-f\s+([^=\s]+)=([^\s]+)/gu)].map(
        (match) => [match[1] ?? "", match[2] ?? ""] as const,
      ),
    );

    expect(workflowInputs.get("runner_idle_ttl_ms")).toBe("300000");
    expect(immediateDeployScript).not.toContain("runner_idle_ttl_ms=43200000");
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

  it("defaults runner env profiles to the full hosted integration set", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
    });

    expect(environment.workerVars.HOSTED_EXECUTION_RUNNER_ENV_PROFILES).toBe(
      "exa,hosted-email,linq,mapbox,telegram,whatsapp",
    );
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

  it("renders an optional local container SSH public key without preserving comments", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_CONTAINER_SSH_KEY_NAME: "debug-key",
      CF_CONTAINER_SSH_PUBLIC_KEY: `${VALID_TEST_SSH_ED25519_PUBLIC_KEY} local-comment`,
      CF_WORKER_NAME: "hosted-worker",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
    });
    const config = buildHostedWranglerDeployConfig(environment) as {
      compatibility_flags: string[];
      containers: Array<{
        authorized_keys?: Array<{ name: string; public_key: string }>;
        ssh?: { enabled: boolean };
      }>;
    };

    expect(config.compatibility_flags).toEqual(["nodejs_compat", "containers_pid_namespace"]);
    expect(config.containers).toHaveLength(2);
    for (const container of config.containers) {
      expect(container.ssh).toEqual({ enabled: true });
      expect(container.authorized_keys).toEqual([{
        name: "debug-key",
        public_key: VALID_TEST_SSH_ED25519_PUBLIC_KEY,
      }]);
    }
  });

  it("rejects non-Ed25519 container SSH public keys", () => {
    expect(() =>
      readHostedDeployAutomationEnvironment({
        CF_BUNDLES_BUCKET: "hosted-bundles",
        CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
        CF_CONTAINER_SSH_PUBLIC_KEY:
          "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCinvalid",
        CF_WORKER_NAME: "hosted-worker",
        ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
      }),
    ).toThrowError(/CF_CONTAINER_SSH_PUBLIC_KEY must be an ssh-ed25519 public key\./u);
  });

  it("rejects malformed Ed25519 container SSH public key bodies", () => {
    expect(() =>
      readHostedDeployAutomationEnvironment({
        CF_BUNDLES_BUCKET: "hosted-bundles",
        CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
        CF_CONTAINER_SSH_PUBLIC_KEY:
          "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMurphContainerDebugKey000000000000000",
        CF_WORKER_NAME: "hosted-worker",
        ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
      }),
    ).toThrowError(/CF_CONTAINER_SSH_PUBLIC_KEY must be an ssh-ed25519 public key\./u);
  });

  it("rejects container SSH key names that are not neutral slugs", () => {
    expect(() =>
      readHostedDeployAutomationEnvironment({
        CF_BUNDLES_BUCKET: "hosted-bundles",
        CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
        CF_CONTAINER_SSH_KEY_NAME: "Debug Key",
        CF_CONTAINER_SSH_PUBLIC_KEY: VALID_TEST_SSH_ED25519_PUBLIC_KEY,
        CF_WORKER_NAME: "hosted-worker",
        ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
      }),
    ).toThrowError(/CF_CONTAINER_SSH_KEY_NAME must be a neutral lowercase slug/u);
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
    const legacyHostedAssistantProviderSecrets = Object.fromEntries(
      LEGACY_HOSTED_ASSISTANT_PROVIDER_SECRET_NAMES.map((name) => [
        name,
        `${name.toLowerCase()}-legacy`,
      ]),
    );

    expect(buildHostedWorkerSecretsPayload({
      AGENTMAIL_API_KEY: "agentmail-secret",
      GARMIN_API_BASE_URL: "https://apis.garmin.com/wellness-api/rest",
      GARMIN_CLIENT_ID: "garmin-client-id",
      GARMIN_CLIENT_SECRET: "garmin-client-secret",
      ...legacyHostedAssistantProviderSecrets,
      HOSTED_EMAIL_SIGNING_SECRET: "email-signing-secret",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private-jwk",
      HOSTED_LOG_FINGERPRINT_SECRET: "log-fingerprint-secret",
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
      WHATSAPP_ACCESS_TOKEN: "whatsapp-token",
      WHATSAPP_PHONE_NUMBER_ID: "whatsapp-phone-number-id",
      OPENAI_API_KEY: "openai-key",
    })).toEqual({
      HOSTED_EMAIL_SIGNING_SECRET: "email-signing-secret",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private-jwk",
      HOSTED_LOG_FINGERPRINT_SECRET: "log-fingerprint-secret",
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
      WHATSAPP_ACCESS_TOKEN: "whatsapp-token",
      WHATSAPP_PHONE_NUMBER_ID: "whatsapp-phone-number-id",
      OPENAI_API_KEY: "openai-key",
    });
  });

  it("omits legacy direct Garmin env from worker secret payloads", () => {
    const payload = buildHostedWorkerSecretsPayload({
      GARMIN_CLIENT_ID: "garmin-client-id",
      GARMIN_CLIENT_SECRET: "garmin-client-secret",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private-jwk",
      HOSTED_LOG_FINGERPRINT_SECRET: "log-fingerprint-secret",
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
      HOSTED_ASSISTANT_BASE_URL: "https://legacy-provider.example.test/v1",
      HOSTED_ASSISTANT_MODEL: "gpt-5.5",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ASSISTANT_PROVIDER_NAME: "legacy-provider",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private-jwk",
      HOSTED_LOG_FINGERPRINT_SECRET: "log-fingerprint-secret",
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
      HOSTED_ASSISTANT_BASE_URL: "https://legacy-provider.example.test/v1",
      HOSTED_ASSISTANT_PROVIDER_NAME: "legacy-provider",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private-jwk",
      HOSTED_LOG_FINGERPRINT_SECRET: "log-fingerprint-secret",
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
      HOSTED_ASSISTANT_API_KEY_ENV: "OPENAI_ENTERPRISE_API_KEY",
      HOSTED_ASSISTANT_MODEL: "gpt-5.5",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private-jwk",
      HOSTED_LOG_FINGERPRINT_SECRET: "log-fingerprint-secret",
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
      HOSTED_ASSISTANT_MODEL: "gpt-5.5",
      HOSTED_ASSISTANT_PROVIDER: "openai",
    }).workerVars.HOSTED_ASSISTANT_API_KEY_ENV).toBeUndefined();

    expect(readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
      ...REQUIRED_HOSTED_CRYPTO_WORKER_VARS,
      HOSTED_ASSISTANT_API_KEY_ENV: "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
      HOSTED_ASSISTANT_MODEL: "gpt-5.5",
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
