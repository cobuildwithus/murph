import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const wranglerMocks = vi.hoisted(() => ({
  runWranglerJson: vi.fn(),
  runWranglerLogged: vi.fn(),
  runWranglerLoggedCaptured: vi.fn(),
}));
const receiptMocks = vi.hoisted(() => ({
  buildContainerReleaseEntries: vi.fn(),
  createCloudflareContainerApplicationLister: vi.fn(),
  parseWranglerContainerActions: vi.fn(),
  parseWranglerWorkerVersionId: vi.fn(),
  readCloudflareContainerApplicationIdentities: vi.fn(),
  readRenderedContainerIdentities: vi.fn(),
}));

vi.mock("../scripts/wrangler-runner.js", () => ({
  runWranglerJson: wranglerMocks.runWranglerJson,
  runWranglerLogged: wranglerMocks.runWranglerLogged,
  runWranglerLoggedCaptured: wranglerMocks.runWranglerLoggedCaptured,
}));
vi.mock("../scripts/container-release-receipt.js", () => ({
  buildContainerReleaseEntries: receiptMocks.buildContainerReleaseEntries,
  createCloudflareContainerApplicationLister:
    receiptMocks.createCloudflareContainerApplicationLister,
  parseWranglerContainerActions: receiptMocks.parseWranglerContainerActions,
  parseWranglerWorkerVersionId: receiptMocks.parseWranglerWorkerVersionId,
  readCloudflareContainerApplicationIdentities:
    receiptMocks.readCloudflareContainerApplicationIdentities,
  readRenderedContainerIdentities: receiptMocks.readRenderedContainerIdentities,
}));

import { runDeployWorkerVersionCli } from "../scripts/deploy-worker-version.cli.js";

describe("runDeployWorkerVersionCli", () => {
  beforeEach(() => {
    wranglerMocks.runWranglerJson.mockReset();
    wranglerMocks.runWranglerLogged.mockReset();
    wranglerMocks.runWranglerLoggedCaptured.mockReset();
    wranglerMocks.runWranglerLoggedCaptured.mockResolvedValue({ stderr: "", stdout: "deploy" });
    receiptMocks.buildContainerReleaseEntries.mockReset();
    receiptMocks.buildContainerReleaseEntries.mockReturnValue(releasedContainers);
    receiptMocks.createCloudflareContainerApplicationLister.mockReset();
    receiptMocks.createCloudflareContainerApplicationLister.mockReturnValue(vi.fn());
    receiptMocks.parseWranglerContainerActions.mockReset();
    receiptMocks.parseWranglerContainerActions.mockReturnValue([]);
    receiptMocks.parseWranglerWorkerVersionId.mockReset();
    receiptMocks.parseWranglerWorkerVersionId.mockReturnValue("version-direct");
    receiptMocks.readCloudflareContainerApplicationIdentities.mockReset();
    receiptMocks.readCloudflareContainerApplicationIdentities.mockResolvedValue([]);
    receiptMocks.readRenderedContainerIdentities.mockReset();
    receiptMocks.readRenderedContainerIdentities.mockResolvedValue(renderedContainers);
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

  it("builds a receipt around the exact direct deploy", async () => {
    const env = {
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CLOUDFLARE_ACCOUNT_ID: "account-fixture",
      CLOUDFLARE_API_TOKEN: "token-fixture",
      CF_WORKER_NAME: "hosted-worker",
    };
    const listApplications = vi.fn();
    const before = [{
      applicationId: "provider-app-id",
      applicationName: "hosted-worker-runnercontainer",
      image: "image-before",
      version: 6,
    }];
    const after = [{
      applicationId: "provider-app-id",
      applicationName: "hosted-worker-runnercontainer",
      image: "image-after",
      version: 7,
    }];
    const actions = [{
      action: "modified",
      applicationName: "hosted-worker-runnercontainer",
      className: "RunnerContainer",
    }];
    receiptMocks.createCloudflareContainerApplicationLister.mockReturnValue(listApplications);
    receiptMocks.readCloudflareContainerApplicationIdentities
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    receiptMocks.parseWranglerContainerActions.mockReturnValue(actions);

    await runDeployWorkerVersionCli(
      ["--config", "./.deploy/wrangler.generated.jsonc"],
      {
        deployRoot: path.join("/tmp", "repo", "apps", "cloudflare"),
        env,
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

    expect(wranglerMocks.runWranglerLoggedCaptured).toHaveBeenCalledWith([
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
    expect(receiptMocks.readRenderedContainerIdentities).toHaveBeenCalledWith(
      "/tmp/wrangler.generated.jsonc",
    );
    expect(receiptMocks.createCloudflareContainerApplicationLister).toHaveBeenCalledWith({
      accountId: "account-fixture",
      apiToken: "token-fixture",
    });
    expect(receiptMocks.readCloudflareContainerApplicationIdentities)
      .toHaveBeenNthCalledWith(1, renderedContainers, listApplications, "before");
    expect(receiptMocks.parseWranglerContainerActions).toHaveBeenCalledWith(
      "deploy\n",
      renderedContainers,
    );
    expect(receiptMocks.parseWranglerWorkerVersionId).toHaveBeenCalledWith("deploy\n");
    expect(receiptMocks.readCloudflareContainerApplicationIdentities)
      .toHaveBeenNthCalledWith(2, renderedContainers, listApplications, "after");
    expect(receiptMocks.buildContainerReleaseEntries).toHaveBeenCalledWith({
      actions,
      after,
      before,
    });
  });

  it("applies R2 lifecycle rules to configured bundles buckets before direct deploys", async () => {
    const deployRoot = path.join("/tmp", "repo", "apps", "cloudflare");
    const trace: string[] = [];
    wranglerMocks.runWranglerLogged.mockImplementation(async (args: string[]) => {
      trace.push(args[0] ?? "unknown");
    });
    wranglerMocks.runWranglerLoggedCaptured.mockImplementation(async () => {
      trace.push("deploy");
      return { stderr: "", stdout: "deploy" };
    });

    await runDeployWorkerVersionCli(
      ["--config", "./.deploy/wrangler.generated.jsonc"],
      {
        deployRoot,
        env: {
          CF_BUNDLES_BUCKET: "hosted-bundles",
          CF_BUNDLES_PREVIEW_BUCKET: "hosted-bundles-preview",
          CLOUDFLARE_ACCOUNT_ID: "account-fixture",
          CLOUDFLARE_API_TOKEN: "token-fixture",
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
    expect(wranglerMocks.runWranglerLoggedCaptured).toHaveBeenCalledWith([
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
    expect(trace).toEqual(["r2", "r2", "deploy"]);
  });

  it("passes the immediate container rollout flag only for explicit hotfix deploys", async () => {
    await runDeployWorkerVersionCli(
      ["--config", "./.deploy/wrangler.generated.jsonc"],
      {
        deployRoot: path.join("/tmp", "repo", "apps", "cloudflare"),
        env: {
          CF_BUNDLES_BUCKET: "hosted-bundles",
          CLOUDFLARE_ACCOUNT_ID: "account-fixture",
          CLOUDFLARE_API_TOKEN: "token-fixture",
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

    expect(wranglerMocks.runWranglerLoggedCaptured).toHaveBeenCalledWith([
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
    containerReleaseReceipt: {
      containers: releasedContainers,
      schemaVersion: 1 as const,
      versionTag: "manual-version",
      workerVersionId: "version-direct",
    },
    finalDeploymentVersions: [],
    smokeVersionId: "version-direct",
    workerName: "hosted-worker",
  };
}

const renderedContainers = [
  {
    applicationName: "hosted-worker-runnercontainer",
    className: "RunnerContainer",
  },
] as const;

const releasedContainers = [
  {
    applicationName: "hosted-worker-runnercontainer",
    className: "RunnerContainer",
    disposition: "unchanged",
    imageSha256: "a".repeat(64),
    version: 7,
  },
] as const;
