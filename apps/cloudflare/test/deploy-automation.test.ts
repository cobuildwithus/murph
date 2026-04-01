import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  buildHostedWorkerSecretsPayload,
  buildHostedWranglerDeployConfig,
  formatHostedWorkerDeploymentVersionSpecs,
  HOSTED_WORKER_REQUIRED_SECRET_NAMES,
  parseHostedContainerImageListOutput,
  readHostedDeployAutomationEnvironment,
  resolveCloudflareDeployPaths,
  resolveHostedWorkerGradualDeploymentSupport,
  resolveHostedWorkerDeploymentTraffic,
  selectHostedContainerImageTagsForCleanup,
} from "../src/deploy-automation.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const tsxCliPath = require.resolve("tsx/cli");
const renderWorkerSecretsScriptPath = path.resolve(
  import.meta.dirname,
  "../scripts/render-worker-secrets.ts",
);

describe("hosted deploy automation helpers", () => {
  it("builds a generated wrangler config for the native container worker", () => {
    const environment = readHostedDeployAutomationEnvironment({
      AGENTMAIL_BASE_URL: "https://mail.example.test/v0",
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_CONTAINER_INSTANCE_TYPE: "standard-1",
      CF_CONTAINER_MAX_INSTANCES: "250",
      CF_RUNNER_COMMIT_TIMEOUT_MS: "45000",
      CF_WORKER_NAME: "hosted-worker",
      HOSTED_AI_USAGE_BASE_URL: "https://web.example.test",
      HOSTED_EXECUTION_ALLOWED_WEB_CONTROL_HOSTS: "api.example.test",
      HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION: "true",
      HOSTED_EXECUTION_CONTAINER_SLEEP_AFTER: "7m",
      HOSTED_DEVICE_SYNC_CONTROL_BASE_URL: "https://web.example.test",
      HOSTED_SHARE_API_BASE_URL: "https://web.example.test",
      HOSTED_WEB_BASE_URL: "https://web.example.test",
      INSTALL_PADDLEOCR: "1",
      TELEGRAM_BOT_USERNAME: "hosted_bot",
    });
    const config = buildHostedWranglerDeployConfig(environment) as {
      containers: Array<{
        class_name: string;
        image: string;
        image_vars?: Record<string, string>;
        instance_type: string | {
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
        traces: {
          enabled: boolean;
          head_sampling_rate: number;
        };
      };
      vars: Record<string, string>;
      secrets?: { required?: string[] };
    };

    expect(config.name).toBe("hosted-worker");
    expect(config.main).toBe("../src/index.ts");
    expect(config.containers).toEqual([
      {
        class_name: "RunnerContainer",
        image: "../../../Dockerfile.cloudflare-hosted-runner",
        instance_type: "standard-1",
        image_vars: {
          INSTALL_PADDLEOCR: "1",
        },
        max_instances: 250,
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
    expect(config.observability).toEqual({
      enabled: true,
      head_sampling_rate: 1,
      traces: {
        enabled: true,
        head_sampling_rate: 0.1,
      },
    });
    expect(config.vars.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS).toBe("45000");
    expect(config.vars.HOSTED_EXECUTION_ALLOWED_WEB_CONTROL_HOSTS).toBe("api.example.test");
    expect(config.vars.HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION).toBe("true");
    expect(config.vars.HOSTED_EXECUTION_CONTAINER_SLEEP_AFTER).toBe("7m");
    expect(config.vars.HOSTED_AI_USAGE_BASE_URL).toBe("https://web.example.test");
    expect(config.vars.HOSTED_DEVICE_SYNC_CONTROL_BASE_URL).toBe("https://web.example.test");
    expect(config.vars.HOSTED_SHARE_API_BASE_URL).toBe("https://web.example.test");
    expect(config.vars.HOSTED_WEB_BASE_URL).toBe("https://web.example.test");
    expect(config.vars.AGENTMAIL_BASE_URL).toBe("https://mail.example.test/v0");
    expect(config.vars.TELEGRAM_BOT_USERNAME).toBe("hosted_bot");
    expect(config.vars.HOSTED_EXECUTION_RUNNER_BASE_URL).toBeUndefined();
    expect(config.secrets?.required).toEqual([...HOSTED_WORKER_REQUIRED_SECRET_NAMES]);
  });

  it("ignores removed deploy alias inputs and keeps only canonical worker vars", () => {
    const environment = readHostedDeployAutomationEnvironment({
      AGENTMAIL_API_BASE_URL: "https://legacy-mail.example.test/v0",
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
      PARSER_FFMPEG_PATH: "/usr/local/bin/ffmpeg",
    });

    expect(environment.workerVars).toEqual({
      HOSTED_EXECUTION_CONTAINER_SLEEP_AFTER: "5m",
    });
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
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: "bundle-key",
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      HOSTED_EXECUTION_INTERNAL_TOKEN: "internal-token",
      HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
      HOSTED_EXECUTION_SIGNING_SECRET: "signing-secret",
      HOSTED_SHARE_INTERNAL_TOKEN: "share-token",
      OPENAI_API_KEY: "sk-user",
      TELEGRAM_BOT_TOKEN: "bot-token",
    })).toEqual({
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: "bundle-key",
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      HOSTED_EXECUTION_INTERNAL_TOKEN: "internal-token",
      HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
      HOSTED_EXECUTION_SIGNING_SECRET: "signing-secret",
      HOSTED_SHARE_INTERNAL_TOKEN: "share-token",
      OPENAI_API_KEY: "sk-user",
      TELEGRAM_BOT_TOKEN: "bot-token",
    });
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

      await execFileAsync(
        process.execPath,
        [tsxCliPath, renderWorkerSecretsScriptPath, outputPath],
        {
          cwd: path.resolve(import.meta.dirname, "..", ".."),
          env: {
            HOME: process.env.HOME,
            PATH: process.env.PATH,
            TMPDIR: process.env.TMPDIR,
            ...requiredSecrets,
          },
        },
      );

      expect(JSON.parse(await readFile(outputPath, "utf8"))).toEqual(requiredSecrets);
      expect((await stat(path.dirname(outputPath))).mode & 0o777).toBe(0o700);
      expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("builds a gradual canary split against the current stable version", () => {
    expect(resolveHostedWorkerDeploymentTraffic({
      candidateVersionId: "version-b",
      currentDeploymentVersions: [
        {
          percentage: 100,
          versionId: "version-a",
        },
      ],
      rolloutPercentage: 10,
    })).toEqual([
      {
        percentage: 90,
        versionId: "version-a",
      },
      {
        percentage: 10,
        versionId: "version-b",
      },
    ]);
  });

  it("preserves deployment order when promoting an already-active canary", () => {
    const traffic = resolveHostedWorkerDeploymentTraffic({
      candidateVersionId: "version-b",
      currentDeploymentVersions: [
        {
          percentage: 80,
          versionId: "version-a",
        },
        {
          percentage: 20,
          versionId: "version-b",
        },
      ],
      rolloutPercentage: 50,
    });

    expect(traffic).toEqual([
      {
        percentage: 50,
        versionId: "version-a",
      },
      {
        percentage: 50,
        versionId: "version-b",
      },
    ]);
    expect(formatHostedWorkerDeploymentVersionSpecs(traffic)).toEqual([
      "version-a@50",
      "version-b@50",
    ]);
  });

  it("rejects introducing a third version into an already gradual deployment", () => {
    expect(() =>
      resolveHostedWorkerDeploymentTraffic({
        candidateVersionId: "version-c",
        currentDeploymentVersions: [
          {
            percentage: 80,
            versionId: "version-a",
          },
          {
            percentage: 20,
            versionId: "version-b",
          },
        ],
        rolloutPercentage: 10,
      }),
    ).toThrowError(/already splits traffic between two versions/u);
  });

  it("allows gradual deployments for the current checked-in Durable Object migration set", () => {
    const config = buildHostedWranglerDeployConfig(readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
    })) as Record<string, unknown>;

    expect(resolveHostedWorkerGradualDeploymentSupport(config)).toEqual({
      directDeployRequiredReason: null,
      gradualDeploymentsSupported: true,
      migrationTags: ["v1", "v2"],
    });
  });

  it("requires a direct deploy when the rendered config introduces a new Durable Object migration tag", () => {
    const config = buildHostedWranglerDeployConfig(readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
      CF_WORKER_NAME: "hosted-worker",
    })) as {
      migrations: Array<Record<string, unknown>>;
    };

    config.migrations = [
      ...config.migrations,
      {
        new_sqlite_classes: ["FutureRunnerDurableObject"],
        tag: "v3",
      },
    ];

    expect(resolveHostedWorkerGradualDeploymentSupport(config)).toEqual({
      directDeployRequiredReason:
        "Rendered Wrangler config includes unsupported Durable Object migration tag(s) `v3` for gradual versions/deployments. Use HOSTED_EXECUTION_DEPLOYMENT_MODE=direct for the migration rollout first.",
      gradualDeploymentsSupported: false,
      migrationTags: ["v1", "v2", "v3"],
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
