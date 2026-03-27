import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHostedWorkerSecretsPayload,
  buildHostedWranglerDeployConfig,
  formatHostedWorkerDeploymentVersionSpecs,
  readHostedDeployAutomationEnvironment,
  resolveCloudflareDeployPaths,
  resolveHostedWorkerGradualDeploymentSupport,
  resolveHostedWorkerDeploymentTraffic,
} from "../src/deploy-automation.js";

describe("hosted deploy automation helpers", () => {
  it("builds a generated wrangler config for the native container worker", () => {
    const environment = readHostedDeployAutomationEnvironment({
      AGENTMAIL_BASE_URL: "https://mail.example.test/v0",
      CF_BUNDLES_BUCKET: "hb-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hb-bundles-preview",
      CF_CONTAINER_MAX_INSTANCES: "250",
      CF_RUNNER_COMMIT_TIMEOUT_MS: "45000",
      CF_WORKER_NAME: "hb-worker",
      INSTALL_PADDLEOCR: "1",
      TELEGRAM_BOT_USERNAME: "hb_bot",
    });
    const config = buildHostedWranglerDeployConfig(environment) as {
      containers: Array<{
        class_name: string;
        image: string;
        image_vars?: Record<string, string>;
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
      secrets: { required: string[] };
      vars: Record<string, string>;
    };

    expect(config.name).toBe("hb-worker");
    expect(config.main).toBe("../src/index.ts");
    expect(config.containers).toEqual([
      {
        class_name: "RunnerContainer",
        image: "../../../Dockerfile.cloudflare-hosted-runner",
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
    expect(config.vars.AGENTMAIL_BASE_URL).toBe("https://mail.example.test/v0");
    expect(config.vars.TELEGRAM_BOT_USERNAME).toBe("hb_bot");
    expect(config.vars.HOSTED_EXECUTION_RUNNER_BASE_URL).toBeUndefined();
    expect(config.secrets.required).toEqual([
      "HOSTED_EXECUTION_SIGNING_SECRET",
      "HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY",
      "HOSTED_EXECUTION_CONTROL_TOKEN",
      "HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN",
    ]);
  });

  it("renders required and optional worker secrets from CI secrets", () => {
    expect(buildHostedWorkerSecretsPayload({
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: "bundle-key",
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
      HOSTED_EXECUTION_SIGNING_SECRET: "signing-secret",
      OPENAI_API_KEY: "sk-user",
      TELEGRAM_BOT_TOKEN: "bot-token",
    })).toEqual({
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: "bundle-key",
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
      HOSTED_EXECUTION_SIGNING_SECRET: "signing-secret",
      OPENAI_API_KEY: "sk-user",
      TELEGRAM_BOT_TOKEN: "bot-token",
    });
  });

  it("accepts the legacy runtime commit-timeout input when the deploy alias is unset", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hb-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hb-bundles-preview",
      CF_WORKER_NAME: "hb-worker",
      HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "45000",
    });

    expect(environment.runnerCommitTimeoutMs).toBe("45000");
  });

  it("treats a blank CF runner commit-timeout as unset and falls back to the runtime input", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hb-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hb-bundles-preview",
      CF_RUNNER_COMMIT_TIMEOUT_MS: "   ",
      CF_WORKER_NAME: "hb-worker",
      HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "45000",
    });

    expect(environment.runnerCommitTimeoutMs).toBe("45000");
  });

  it("does not accept legacy HB_CF deploy variable names", () => {
    expect(() =>
      readHostedDeployAutomationEnvironment({
        HB_CF_BUNDLES_BUCKET: "hb-bundles",
        HB_CF_BUNDLES_PREVIEW_BUCKET: "hb-bundles-preview",
        HB_CF_WORKER_NAME: "hb-worker",
      }),
    ).toThrowError(/CF_BUNDLES_BUCKET must be configured\./u);
  });

  it("defaults generated deploy paths to the cloudflare app directory", () => {
    const paths = resolveCloudflareDeployPaths();

    expect(paths.deployDir.endsWith(path.join("apps", "cloudflare", ".deploy"))).toBe(true);
    expect(paths.workerSecretsPath.endsWith(path.join("apps", "cloudflare", ".deploy", "worker-secrets.json"))).toBe(true);
    expect(paths.wranglerConfigPath.endsWith(path.join("apps", "cloudflare", ".deploy", "wrangler.generated.jsonc"))).toBe(true);
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
      CF_BUNDLES_BUCKET: "hb-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hb-bundles-preview",
      CF_WORKER_NAME: "hb-worker",
    })) as Record<string, unknown>;

    expect(resolveHostedWorkerGradualDeploymentSupport(config)).toEqual({
      directDeployRequiredReason: null,
      gradualDeploymentsSupported: true,
      migrationTags: ["v1", "v2"],
    });
  });

  it("requires a direct deploy when the rendered config introduces a new Durable Object migration tag", () => {
    const config = buildHostedWranglerDeployConfig(readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hb-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hb-bundles-preview",
      CF_WORKER_NAME: "hb-worker",
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
});
