import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHostedRunnerEnvironment,
  buildHostedWorkerSecretsPayload,
  buildHostedWranglerDeployConfig,
  formatEnvFile,
  readHostedDeployAutomationEnvironment,
  resolveCloudflareDeployPaths,
} from "../src/deploy-automation.js";

describe("hosted deploy automation helpers", () => {
  it("builds a generated wrangler config with required secrets validation", () => {
    const environment = readHostedDeployAutomationEnvironment({
      CF_BUNDLES_BUCKET: "hb-bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "hb-bundles-preview",
      CF_PUBLIC_BASE_URL: "https://hb-worker.example.workers.dev/",
      CF_RUNNER_BASE_URL: "https://hb-runner.example.internal/",
      CF_WORKER_NAME: "hb-worker",
    });
    const config = buildHostedWranglerDeployConfig(environment) as {
      main: string;
      name: string;
      secrets: { required: string[] };
      vars: Record<string, string>;
    };

    expect(config.name).toBe("hb-worker");
    expect(config.main).toBe("../src/index.ts");
    expect(config.vars.HOSTED_EXECUTION_CLOUDFLARE_BASE_URL).toBe(
      "https://hb-worker.example.workers.dev",
    );
    expect(config.vars.HOSTED_EXECUTION_RUNNER_BASE_URL).toBe(
      "https://hb-runner.example.internal",
    );
    expect(config.secrets.required).toEqual([
      "HOSTED_EXECUTION_SIGNING_SECRET",
      "HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY",
      "HOSTED_EXECUTION_CONTROL_TOKEN",
      "HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN",
    ]);
  });

  it("renders the worker secret payload from CI secrets", () => {
    expect(buildHostedWorkerSecretsPayload({
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: "bundle-key",
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
      HOSTED_EXECUTION_SIGNING_SECRET: "signing-secret",
    })).toEqual({
      HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: "bundle-key",
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
      HOSTED_EXECUTION_SIGNING_SECRET: "signing-secret",
    });
  });

  it("renders the hosted runner env with defaults and provider passthrough", () => {
    const env = buildHostedRunnerEnvironment({
      CF_ALLOWED_USER_ENV_KEYS: " OPENAI_API_KEY, LINQ_API_TOKEN ",
      CF_ALLOWED_USER_ENV_PREFIXES: " HB_USER_, TELEGRAM_ ",
      CF_RUNNER_COMMIT_TIMEOUT_MS: "45000",
      HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "15000",
      HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
      LINQ_API_TOKEN: "linq-token",
      OPENAI_API_KEY: "sk-user",
      PORT: "9090",
      TELEGRAM_BOT_TOKEN: "bot-token",
      WHISPER_MODEL: "small",
    });

    expect(env).toMatchObject({
      HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS: "OPENAI_API_KEY, LINQ_API_TOKEN",
      HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES: "HB_USER_, TELEGRAM_",
      HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "45000",
      HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
      LINQ_API_TOKEN: "linq-token",
      NODE_ENV: "production",
      OPENAI_API_KEY: "sk-user",
      PORT: "9090",
      TELEGRAM_BOT_TOKEN: "bot-token",
      WHISPER_MODEL: "small",
    });
    expect(formatEnvFile(env)).toContain("HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN=runner-token");
  });

  it("accepts the legacy runtime commit-timeout input when the deploy alias is unset", () => {
    const env = buildHostedRunnerEnvironment({
      HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "45000",
      HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
    });

    expect(env.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS).toBe("45000");
  });

  it("treats a blank CF runner commit-timeout as unset and falls back to the runtime input", () => {
    const env = buildHostedRunnerEnvironment({
      CF_RUNNER_COMMIT_TIMEOUT_MS: "   ",
      HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "45000",
      HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
    });

    expect(env.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS).toBe("45000");
  });

  it("does not accept legacy HB_CF deploy variable names", () => {
    expect(() =>
      readHostedDeployAutomationEnvironment({
        HB_CF_BUNDLES_BUCKET: "hb-bundles",
        HB_CF_BUNDLES_PREVIEW_BUCKET: "hb-bundles-preview",
        HB_CF_PUBLIC_BASE_URL: "https://hb-worker.example.workers.dev/",
        HB_CF_RUNNER_BASE_URL: "https://hb-runner.example.internal/",
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
        CF_RUNNER_BASE_URL: "https://hb-runner.example.internal",
        CF_WORKER_NAME: "hb-worker",
      }),
    ).toThrowError(/CF_PUBLIC_BASE_URL must be an https URL\./u);
  });

  it("ignores legacy HB_CF runner aliases when rendering runner env", () => {
    const env = buildHostedRunnerEnvironment({
      HB_CF_ALLOWED_USER_ENV_KEYS: "OPENAI_API_KEY",
      HB_CF_ALLOWED_USER_ENV_PREFIXES: "HB_USER_",
      HB_CF_RUNNER_COMMIT_TIMEOUT_MS: "45000",
      HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
    });

    expect(env.HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS).toBeUndefined();
    expect(env.HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES).toBeUndefined();
    expect(env.HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS).toBe("30000");
  });

  it("rejects invalid runner commit-timeout overrides", () => {
    expect(() =>
      buildHostedRunnerEnvironment({
        CF_RUNNER_COMMIT_TIMEOUT_MS: "0",
        HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN: "runner-token",
      }),
    ).toThrowError(
      /CF_RUNNER_COMMIT_TIMEOUT_MS or HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS must be a positive integer string\./u,
    );
  });

  it("defaults generated deploy paths to the cloudflare app directory", () => {
    const paths = resolveCloudflareDeployPaths();

    expect(paths.deployDir.endsWith(path.join("apps", "cloudflare", ".deploy"))).toBe(true);
    expect(paths.runnerEnvPath.endsWith(path.join("apps", "cloudflare", ".deploy", "runner.env"))).toBe(true);
    expect(paths.workerSecretsPath.endsWith(path.join("apps", "cloudflare", ".deploy", "worker-secrets.json"))).toBe(true);
    expect(paths.wranglerConfigPath.endsWith(path.join("apps", "cloudflare", ".deploy", "wrangler.generated.jsonc"))).toBe(true);
  });
});
