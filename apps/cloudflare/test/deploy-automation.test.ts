import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHostedWorkerSecretsPayload,
  buildHostedWranglerDeployConfig,
  readHostedDeployAutomationEnvironment,
  resolveCloudflareDeployPaths,
} from "../src/deploy-automation.js";

describe("hosted deploy automation helpers", () => {
  it("builds a generated wrangler config for the native container worker", () => {
    const environment = readHostedDeployAutomationEnvironment({
      AGENTMAIL_BASE_URL: "https://mail.example.test/v0",
      CF_BUNDLES_BUCKET: "hb-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hb-bundles-preview",
      CF_CONTAINER_MAX_INSTANCES: "250",
      CF_PUBLIC_BASE_URL: "https://hb-worker.example.workers.dev/",
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
      main: string;
      name: string;
      secrets: { required: string[] };
      vars: Record<string, string>;
    };

    expect(config.name).toBe("hb-worker");
    expect(config.main).toBe("../src/index.ts");
    expect(config.containers).toEqual([
      {
        class_name: "UserRunnerDurableObject",
        image: "../../../Dockerfile.cloudflare-hosted-runner",
        image_vars: {
          INSTALL_PADDLEOCR: "1",
        },
        max_instances: 250,
      },
    ]);
    expect(config.vars.HOSTED_EXECUTION_CLOUDFLARE_BASE_URL).toBe(
      "https://hb-worker.example.workers.dev",
    );
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
      CF_PUBLIC_BASE_URL: "https://hb-worker.example.workers.dev/",
      CF_WORKER_NAME: "hb-worker",
      HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "45000",
    });

    expect(environment.runnerCommitTimeoutMs).toBe("45000");
  });

  it("treats a blank CF runner commit-timeout as unset and falls back to the runtime input", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hb-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hb-bundles-preview",
      CF_PUBLIC_BASE_URL: "https://hb-worker.example.workers.dev/",
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
        HB_CF_PUBLIC_BASE_URL: "https://hb-worker.example.workers.dev/",
        HB_CF_WORKER_NAME: "hb-worker",
      }),
    ).toThrowError(/CF_BUNDLES_BUCKET must be configured\./u);
  });

  it("rejects non-https deploy URLs outside localhost", () => {
    expect(() =>
      readHostedDeployAutomationEnvironment({
        CF_BUNDLES_BUCKET: "hb-bundles",
        CF_BUNDLES_PREVIEW_BUCKET: "hb-bundles-preview",
        CF_PUBLIC_BASE_URL: "http://hb-worker.example.workers.dev",
        CF_WORKER_NAME: "hb-worker",
      }),
    ).toThrowError(/CF_PUBLIC_BASE_URL must be an https URL\./u);
  });

  it("defaults generated deploy paths to the cloudflare app directory", () => {
    const paths = resolveCloudflareDeployPaths();

    expect(paths.deployDir.endsWith(path.join("apps", "cloudflare", ".deploy"))).toBe(true);
    expect(paths.workerSecretsPath.endsWith(path.join("apps", "cloudflare", ".deploy", "worker-secrets.json"))).toBe(true);
    expect(paths.wranglerConfigPath.endsWith(path.join("apps", "cloudflare", ".deploy", "wrangler.generated.jsonc"))).toBe(true);
  });
});
