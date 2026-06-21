import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const wranglerMocks = vi.hoisted(() => ({
  runWranglerJson: vi.fn(),
  runWranglerLogged: vi.fn(),
}));

vi.mock("../scripts/wrangler-runner.js", () => ({
  runWranglerJson: wranglerMocks.runWranglerJson,
  runWranglerLogged: wranglerMocks.runWranglerLogged,
}));

import { runDeployWorkerVersionCli } from "../scripts/deploy-worker-version.cli.js";

describe("runDeployWorkerVersionCli", () => {
  beforeEach(() => {
    wranglerMocks.runWranglerJson.mockReset();
    wranglerMocks.runWranglerLogged.mockReset();
  });

  it("passes app-root deploy artifact paths to the deploy entrypoint", async () => {
    const repoRoot = path.join("/tmp", "repo");
    const deployRoot = path.join(repoRoot, "apps", "cloudflare");
    const runHostedWorkerDeployment = vi.fn(async () => createDeploymentResult());

    await runDeployWorkerVersionCli(
      ["--config", "./.deploy/wrangler.generated.jsonc"],
      {
        deployRoot,
        env: {
          CF_WORKER_NAME: "hosted-worker",
        },
        log: false,
        runHostedWorkerDeployment,
      },
    );

    expect(runHostedWorkerDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        configPath: path.join(deployRoot, ".deploy", "wrangler.generated.jsonc"),
        env: expect.objectContaining({
          CF_WORKER_NAME: "hosted-worker",
        }),
        resultPath: path.join(deployRoot, ".deploy", "deployment-result.json"),
        runnerBundleDir: path.join(deployRoot, ".deploy", "runner-bundle"),
        secretsFilePath: path.join(deployRoot, ".deploy", "worker-secrets.json"),
        workerName: "hosted-worker",
      }),
    );
  });

  it("rejects unsupported deploy args before entering rollout orchestration", async () => {
    const runHostedWorkerDeployment = vi.fn();

    await expect(
      runDeployWorkerVersionCli(["--dry-run"], {
        deployRoot: path.join("/tmp", "repo", "apps", "cloudflare"),
        env: {
          CF_WORKER_NAME: "hosted-worker",
        },
        log: false,
        runHostedWorkerDeployment,
      }),
    ).rejects.toThrow("Unsupported deploy worker argument: --dry-run");

    expect(runHostedWorkerDeployment).not.toHaveBeenCalled();
  });

  it("treats wrangler no-deployments errors as an empty current deployment", async () => {
    wranglerMocks.runWranglerJson.mockRejectedValueOnce(new Error("Worker hosted-worker has no deployments"));

    await runDeployWorkerVersionCli(
      ["--config", "./.deploy/wrangler.generated.jsonc"],
      {
        deployRoot: path.join("/tmp", "repo", "apps", "cloudflare"),
        env: {
          CF_WORKER_NAME: "hosted-worker",
        },
        log: false,
        runHostedWorkerDeployment: async ({ dependencies }) => {
          expect(await dependencies.readCurrentDeployment("hosted-worker", "/tmp/config.jsonc")).toBeNull();

          return createDeploymentResult();
        },
      },
    );

    expect(wranglerMocks.runWranglerJson).toHaveBeenCalledWith([
      "deployments",
      "status",
      "--config",
      "/tmp/config.jsonc",
      "--json",
      "--name",
      "hosted-worker",
    ]);
  });

  it("uses configured gradual container rollout on direct deploys by default", async () => {
    await runDeployWorkerVersionCli(
      ["--config", "./.deploy/wrangler.generated.jsonc"],
      {
        deployRoot: path.join("/tmp", "repo", "apps", "cloudflare"),
        env: {
          CF_BUNDLES_BUCKET: "hosted-bundles",
          CF_WORKER_NAME: "hosted-worker",
        },
        log: false,
        runHostedWorkerDeployment: async ({ dependencies }) => {
          await dependencies.deployDirect({
            containerRolloutMode: "gradual",
            configPath: "/tmp/wrangler.generated.jsonc",
            deploymentMessage: "manual direct deploy",
            includeSecrets: true,
            secretsFilePath: "/tmp/worker-secrets.json",
            versionTag: "manual-version",
            workerName: "hosted-worker",
          });

          return createDeploymentResult();
        },
      },
    );

    expect(wranglerMocks.runWranglerLogged).toHaveBeenCalledWith([
      "deploy",
      "--config",
      "/tmp/wrangler.generated.jsonc",
      "--message",
      "manual direct deploy",
      "--name",
      "hosted-worker",
      "--tag",
      "manual-version",
      "--secrets-file",
      "/tmp/worker-secrets.json",
    ]);
  });

  it("applies R2 lifecycle rules to configured bundles buckets before direct deploys", async () => {
    const deployRoot = path.join("/tmp", "repo", "apps", "cloudflare");

    await runDeployWorkerVersionCli(
      ["--config", "./.deploy/wrangler.generated.jsonc"],
      {
        deployRoot,
        env: {
          CF_BUNDLES_BUCKET: "hosted-bundles",
          CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
          CF_WORKER_NAME: "hosted-worker",
        },
        log: false,
        runHostedWorkerDeployment: async ({ dependencies }) => {
          await dependencies.deployDirect({
            containerRolloutMode: "gradual",
            configPath: "/tmp/wrangler.generated.jsonc",
            deploymentMessage: "manual direct deploy",
            includeSecrets: false,
            secretsFilePath: "/tmp/worker-secrets.json",
            versionTag: "manual-version",
            workerName: "hosted-worker",
          });

          return createDeploymentResult();
        },
      },
    );

    expect(wranglerMocks.runWranglerLogged).toHaveBeenNthCalledWith(
      1,
      [
        "r2",
        "bucket",
        "lifecycle",
        "set",
        "hosted-bundles",
        "--file",
        path.join(deployRoot, "r2-bundles-lifecycle.json"),
      ],
      {
        cwd: deployRoot,
      },
    );
    expect(wranglerMocks.runWranglerLogged).toHaveBeenNthCalledWith(
      2,
      [
        "r2",
        "bucket",
        "lifecycle",
        "set",
        "hosted-bundles-preview",
        "--file",
        path.join(deployRoot, "r2-bundles-lifecycle.json"),
      ],
      {
        cwd: deployRoot,
      },
    );
    expect(wranglerMocks.runWranglerLogged).toHaveBeenNthCalledWith(3, [
      "deploy",
      "--config",
      "/tmp/wrangler.generated.jsonc",
      "--message",
      "manual direct deploy",
      "--name",
      "hosted-worker",
      "--tag",
      "manual-version",
    ]);
  });

  it("passes the immediate container rollout flag only for explicit hotfix deploys", async () => {
    await runDeployWorkerVersionCli(
      ["--config", "./.deploy/wrangler.generated.jsonc"],
      {
        deployRoot: path.join("/tmp", "repo", "apps", "cloudflare"),
        env: {
          CF_BUNDLES_BUCKET: "hosted-bundles",
          CF_WORKER_NAME: "hosted-worker",
        },
        log: false,
        runHostedWorkerDeployment: async ({ dependencies }) => {
          await dependencies.deployDirect({
            containerRolloutMode: "immediate",
            configPath: "/tmp/wrangler.generated.jsonc",
            deploymentMessage: "manual direct deploy",
            includeSecrets: false,
            secretsFilePath: "/tmp/worker-secrets.json",
            versionTag: "manual-version",
            workerName: "hosted-worker",
          });

          return createDeploymentResult();
        },
      },
    );

    expect(wranglerMocks.runWranglerLogged).toHaveBeenCalledWith([
      "deploy",
      "--config",
      "/tmp/wrangler.generated.jsonc",
      "--containers-rollout=immediate",
      "--message",
      "manual direct deploy",
      "--name",
      "hosted-worker",
      "--tag",
      "manual-version",
    ]);
  });

  it("fails deployment-status reads with worker-scoped JSON context", async () => {
    wranglerMocks.runWranglerJson.mockResolvedValueOnce("{not json");

    await expect(
      runDeployWorkerVersionCli(
        ["--config", "./.deploy/wrangler.generated.jsonc"],
        {
          deployRoot: path.join("/tmp", "repo", "apps", "cloudflare"),
          env: {
            CF_WORKER_NAME: "hosted-worker",
          },
          log: false,
          runHostedWorkerDeployment: async ({ dependencies }) => {
            await dependencies.readCurrentDeployment("hosted-worker", "/tmp/config.jsonc");
            throw new Error("Expected readCurrentDeployment to fail.");
          },
        },
      ),
    ).rejects.toThrow(
      "Wrangler deployment status for worker hosted-worker must be valid JSON:",
    );
  });

});

function createDeploymentResult() {
  return {
    finalDeploymentVersions: [],
    smokeVersionId: "version-direct",
    workerName: "hosted-worker",
  };
}
