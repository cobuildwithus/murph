import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const fileMocks = vi.hoisted(() => ({ readFile: vi.fn(async () => "{}"), writeFile: vi.fn(async () => {}) }));
vi.mock("node:fs/promises", async () => ({
  ...await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises"),
  ...fileMocks,
}));
const wranglerMocks = vi.hoisted(() => ({
  runWranglerJson: vi.fn(),
  runWranglerLogged: vi.fn(),
  runWranglerLoggedCaptured: vi.fn(),
}));
vi.mock("../scripts/deploy-artifacts.js", async () => ({
  ...await vi.importActual<typeof import("../scripts/deploy-artifacts.js")>("../scripts/deploy-artifacts.js"),
  readRunnerBundleManifest: vi.fn(async () => ({ releaseSha: "1".repeat(40) })),
}));
const imageMocks = vi.hoisted(() => ({ prepareHostedContainerDeployImage: vi.fn() }));
vi.mock("../scripts/prepare-container-deploy-image.ts", () => imageMocks);
const releaseMocks = vi.hoisted(() => ({
  stageHostedRunnerRelease: vi.fn(), readWorkerVersion: vi.fn(), assertDrained: vi.fn(), runSmokeHostedDeploy: vi.fn(), admitApplication: vi.fn(), assertApplicationReady: vi.fn(),
}));
vi.mock("../scripts/stage-runner-release.ts", () => ({ stageHostedRunnerRelease: releaseMocks.stageHostedRunnerRelease }));
vi.mock("../scripts/runner-release-provider.ts", () => ({ createRunnerReleaseProvider: () => releaseMocks }));
vi.mock("../scripts/smoke-hosted-deploy.shared.ts", () => ({ runSmokeHostedDeploy: releaseMocks.runSmokeHostedDeploy }));
const receiptMocks = vi.hoisted(() => ({
  createCloudflareContainerProvider: vi.fn(),
  buildContainerReleaseEntries: vi.fn(),
  parseWranglerWorkerVersionId: vi.fn(),
  readCloudflareContainerApplicationIdentities: vi.fn(),
  readRenderedContainerIdentities: vi.fn(),
  waitForCloudflareContainerReleaseEntries: vi.fn(),
}));

vi.mock("../scripts/wrangler-runner.js", () => ({
  runWranglerJson: wranglerMocks.runWranglerJson,
  runWranglerLogged: wranglerMocks.runWranglerLogged,
  runWranglerLoggedCaptured: wranglerMocks.runWranglerLoggedCaptured,
}));
vi.mock("../scripts/container-release-receipt.js", () => ({
  createCloudflareContainerProvider: receiptMocks.createCloudflareContainerProvider,
  buildContainerReleaseEntries: receiptMocks.buildContainerReleaseEntries,
  parseWranglerWorkerVersionId: receiptMocks.parseWranglerWorkerVersionId,
  readCloudflareContainerApplicationIdentities:
    receiptMocks.readCloudflareContainerApplicationIdentities,
  readRenderedContainerIdentities: receiptMocks.readRenderedContainerIdentities,
  waitForCloudflareContainerReleaseEntries:
    receiptMocks.waitForCloudflareContainerReleaseEntries,
}));

import { runDeployWorkerVersionCli } from "../scripts/deploy-worker-version.cli.js";

describe("runDeployWorkerVersionCli", () => {
  beforeEach(() => {
    releaseMocks.stageHostedRunnerRelease.mockReset();
    releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath }) => ({
      configPath, promotionConfigPath: `${configPath}.promote`,
      activeApplicationName: "hosted-worker-runnercontainer", applications: [], workerOnly: false,
    }));
    releaseMocks.readWorkerVersion.mockReset();
    releaseMocks.readWorkerVersion.mockResolvedValue({});
    releaseMocks.admitApplication.mockReset();
    releaseMocks.admitApplication.mockResolvedValue("created");
    releaseMocks.assertApplicationReady.mockReset();
    releaseMocks.assertApplicationReady.mockResolvedValue(undefined);
    releaseMocks.assertDrained.mockReset();
    releaseMocks.assertDrained.mockResolvedValue(undefined);
    releaseMocks.runSmokeHostedDeploy.mockReset();
    releaseMocks.runSmokeHostedDeploy.mockResolvedValue(undefined);
    imageMocks.prepareHostedContainerDeployImage.mockReset();
    imageMocks.prepareHostedContainerDeployImage.mockImplementation(async ({ configPath }) => configPath);
    wranglerMocks.runWranglerJson.mockReset();
    wranglerMocks.runWranglerJson.mockResolvedValue(JSON.stringify({ versions: [{ percentage: 100, version_id: "version-direct" }] }));
    wranglerMocks.runWranglerLogged.mockReset();
    wranglerMocks.runWranglerLoggedCaptured.mockReset();
    wranglerMocks.runWranglerLoggedCaptured.mockResolvedValue({ stderr: "", stdout: "deploy" });
    receiptMocks.createCloudflareContainerProvider.mockReset();
    receiptMocks.createCloudflareContainerProvider.mockReturnValue({
      listApplications: vi.fn(),
      readRollout: vi.fn(),
    });
    receiptMocks.buildContainerReleaseEntries.mockReset();
    receiptMocks.parseWranglerWorkerVersionId.mockReset();
    receiptMocks.parseWranglerWorkerVersionId.mockReturnValue("version-direct");
    receiptMocks.readCloudflareContainerApplicationIdentities.mockReset();
    receiptMocks.readCloudflareContainerApplicationIdentities.mockResolvedValue([]);
    receiptMocks.readRenderedContainerIdentities.mockReset();
    receiptMocks.readRenderedContainerIdentities.mockResolvedValue(renderedContainers);
    receiptMocks.waitForCloudflareContainerReleaseEntries.mockReset();
    receiptMocks.waitForCloudflareContainerReleaseEntries.mockResolvedValue(releasedContainers);
  });

  it("does not activate a Worker while its image is still publishing or after publication fails", async () => {
    let rejectPublication!: (error: Error) => void;
    imageMocks.prepareHostedContainerDeployImage.mockImplementation(() => new Promise<string>((_resolve, reject) => {
      rejectPublication = reject;
    }));
    const deployment = runDeployWorkerVersionCli([], {
      deployRoot: "/tmp/repo/apps/cloudflare",
      env: {
        CF_WORKER_NAME: "hosted-worker",
        CF_BUNDLES_BUCKET: "hosted-bundles",
        CLOUDFLARE_ACCOUNT_ID: "account-fixture",
        CLOUDFLARE_API_TOKEN: "token-fixture",
      },
      log: false,
      runHostedWorkerDeployment: async ({ dependencies }) => {
        await dependencies.deployDirect({
          configPath: "/tmp/repo/apps/cloudflare/.deploy/wrangler.generated.jsonc",
          containerRolloutMode: "immediate",
          deploymentMessage: "synthetic release",
          includeSecrets: true,
          secretsFilePath: "/tmp/worker-secrets.json",
          versionTag: "synthetic-release",
          workerName: "hosted-worker",
        });
        return createDeploymentResult();
      },
    });
    const failure = deployment.catch((error: unknown) => error);
    await vi.waitFor(() => expect(imageMocks.prepareHostedContainerDeployImage).toHaveBeenCalledOnce());
    expect(wranglerMocks.runWranglerLoggedCaptured).not.toHaveBeenCalled();
    rejectPublication(new Error("synthetic image publication failed"));
    expect(await failure).toEqual(new Error("synthetic image publication failed"));
    expect(wranglerMocks.runWranglerLoggedCaptured).not.toHaveBeenCalled();
    expect(receiptMocks.waitForCloudflareContainerReleaseEntries).not.toHaveBeenCalled();
  });

  it.each(["pending", "failed"])("does not promote when candidate readiness is %s", async (state) => {
    let rejectSmoke!: (error: Error) => void;
    releaseMocks.runSmokeHostedDeploy.mockImplementation(() => new Promise<void>((_resolve, reject) => { rejectSmoke = reject; }));
    const deployment = runDeployWorkerVersionCli([], {
      deployRoot: "/tmp/repo/apps/cloudflare", log: false,
      env: { CF_WORKER_NAME: "hosted-worker", CF_BUNDLES_BUCKET: "hosted-bundles", CLOUDFLARE_ACCOUNT_ID: "fixture", CLOUDFLARE_API_TOKEN: "fixture" },
      runHostedWorkerDeployment: async ({ dependencies }) => {
        await dependencies.deployDirect({ configPath: "/tmp/config.jsonc", containerRolloutMode: "immediate", deploymentMessage: "synthetic", includeSecrets: false, secretsFilePath: "/tmp/secrets.json", versionTag: "synthetic", workerName: "hosted-worker" });
        return createDeploymentResult();
      },
    });
    const failure = deployment.catch((error: unknown) => error);
    await vi.waitFor(() => expect(releaseMocks.runSmokeHostedDeploy).toHaveBeenCalledOnce());
    expect(wranglerMocks.runWranglerLoggedCaptured).toHaveBeenCalledTimes(1);
    expect(wranglerMocks.runWranglerLoggedCaptured.mock.calls[0]![0]).toContain("/tmp/config.jsonc");
    rejectSmoke(new Error(state === "failed" ? "candidate image never became ready" : "synthetic cancelled preparation"));
    expect(await failure).toBeInstanceOf(Error);
    expect(wranglerMocks.runWranglerLoggedCaptured).toHaveBeenCalledTimes(1);
    expect(receiptMocks.waitForCloudflareContainerReleaseEntries).toHaveBeenCalledOnce();
  });

  it("uploads container metadata before admission without switching traffic", async () => {
    releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath }) => ({
      configPath, promotionConfigPath: `${configPath}.promote`, activeApplicationName: "serving", workerOnly: false,
      applications: [{ name: renderedContainers[0]!.applicationName, className: "RunnerContainer", applicationId: null, namespaceId: "synthetic-namespace", specification: {} }],
    }));
    let containerEnabled = false;
    wranglerMocks.runWranglerLoggedCaptured.mockImplementation(async () => {
      containerEnabled = true;
      return { stdout: "deploy", stderr: "" };
    });
    releaseMocks.admitApplication.mockImplementation(async () => {
      if (!containerEnabled) throw new Error("DURABLE_OBJECT_NOT_CONTAINER_ENABLED");
      expect(wranglerMocks.runWranglerLogged.mock.calls.some(([args]) => args[0] === "versions")).toBe(false);
      return "created";
    });
    await syntheticDeployment();
    const activationIndex = wranglerMocks.runWranglerLogged.mock.calls.findIndex(([args]) => args[0] === "versions");
    expect(releaseMocks.assertApplicationReady.mock.invocationCallOrder[0]).toBeLessThan(wranglerMocks.runWranglerLogged.mock.invocationCallOrder[activationIndex]!);
  });

  it.each(["upload failure", "serving version changed"])("stops before native mutation after %s", async (failure) => {
    wranglerMocks.runWranglerLoggedCaptured.mockImplementation(async () => {
      if (failure === "upload failure") throw new Error(failure);
      wranglerMocks.runWranglerJson.mockResolvedValue(JSON.stringify({ versions: [{ percentage: 100, version_id: "unexpected-version" }] }));
      return { stdout: "deploy", stderr: "" };
    });
    await expect(syntheticDeployment()).rejects.toThrow();
    expect(releaseMocks.admitApplication).not.toHaveBeenCalled();
    expect(releaseMocks.assertApplicationReady).not.toHaveBeenCalled();
    expect(wranglerMocks.runWranglerLogged.mock.calls.some(([args]) => args[0] === "versions")).toBe(false);
    expect(releaseMocks.runSmokeHostedDeploy).not.toHaveBeenCalled();
  });

  it.each(["quota rejection", "pending distribution"])("keeps serving traffic unchanged during native %s", async (failure) => {
    releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath }) => ({
      configPath, promotionConfigPath: `${configPath}.promote`, activeApplicationName: "serving", workerOnly: false,
      applications: [{ name: renderedContainers[0]!.applicationName, className: "RunnerContainer", applicationId: null, namespaceId: "synthetic-namespace", specification: {} }],
    }));
    let reject!: (error: Error) => void;
    const operation = failure === "quota rejection" ? releaseMocks.admitApplication : releaseMocks.assertApplicationReady;
    operation.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    const pending = syntheticDeployment().catch((error: unknown) => error);
    await vi.waitFor(() => expect(operation).toHaveBeenCalledOnce());
    expect(wranglerMocks.runWranglerLoggedCaptured).toHaveBeenCalledOnce();
    expect(wranglerMocks.runWranglerLogged.mock.calls.some(([args]) => args[0] === "versions")).toBe(false);
    reject(new Error(failure));
    expect(await pending).toEqual(new Error(failure));
    expect(wranglerMocks.runWranglerLogged.mock.calls.some(([args]) => args[0] === "versions")).toBe(false);
    expect(wranglerMocks.runWranglerLoggedCaptured).toHaveBeenCalledOnce();
  });

  it.each(["immediate", "worker-only"] as const)("rolls dedicated smoke without member drain admission in %s mode", async (mode) => {
    const smoke = { name: "hosted-worker-smoke", className: "DeploySmokeRunnerContainer", applicationId: "smoke-app", namespaceId: "smoke-namespace", specification: {} };
    receiptMocks.readRenderedContainerIdentities.mockResolvedValue([{ applicationName: smoke.name, className: smoke.className }]);
    releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath }) => ({
      configPath, promotionConfigPath: `${configPath}.promote`, activeApplicationName: "serving", workerOnly: mode === "worker-only", applications: [smoke],
    }));
    releaseMocks.assertDrained.mockRejectedValue(new Error("synthetic member drain endpoint unavailable"));
    await syntheticDeployment(mode);
    expect(releaseMocks.assertDrained).not.toHaveBeenCalled();
    expect(releaseMocks.admitApplication).toHaveBeenCalledWith(smoke);
    expect(releaseMocks.assertApplicationReady).toHaveBeenCalledOnce();
    const activationIndex = wranglerMocks.runWranglerLogged.mock.calls.findIndex(([args]) => args[0] === "versions");
    expect(releaseMocks.assertApplicationReady.mock.invocationCallOrder[0]).toBeLessThan(wranglerMocks.runWranglerLogged.mock.invocationCallOrder[activationIndex]!);
    expect(releaseMocks.runSmokeHostedDeploy).toHaveBeenCalledOnce();
  });

  it.each(["RunnerContainer", "NextRunnerContainer"])("still blocks reuse of %s when member drain evidence is unavailable", async (className) => {
    releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath }) => ({
      configPath, promotionConfigPath: `${configPath}.promote`, activeApplicationName: "serving", workerOnly: false,
      applications: [{ name: renderedContainers[0]!.applicationName, className, applicationId: "member-app", namespaceId: "member-namespace", specification: {} }],
    }));
    releaseMocks.assertDrained.mockRejectedValue(new Error("synthetic member drain endpoint unavailable"));
    await expect(syntheticDeployment()).rejects.toThrow("member drain endpoint unavailable");
    expect(releaseMocks.assertDrained).toHaveBeenCalledWith("member-app");
    expect(releaseMocks.admitApplication).not.toHaveBeenCalled();
    expect(wranglerMocks.runWranglerLoggedCaptured).toHaveBeenCalledOnce();
    expect(wranglerMocks.runWranglerLogged.mock.calls.some(([args]) => args[0] === "versions")).toBe(false);
  });

  it("publishes an unchanged execution release once, with no container mutation", async () => {
    releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath }) => ({
      configPath, promotionConfigPath: `${configPath}.promote`, activeApplicationName: "serving", workerOnly: true, applications: [],
    }));
    await syntheticDeployment();
    expect(releaseMocks.admitApplication).not.toHaveBeenCalled();
    expect(wranglerMocks.runWranglerLoggedCaptured).toHaveBeenCalledOnce();
    expect(wranglerMocks.runWranglerLoggedCaptured.mock.calls[0]![0].slice(0, 2)).toEqual(["versions", "upload"]);
    expect(wranglerMocks.runWranglerLogged.mock.calls.filter(([args]) => args[0] === "versions")).toHaveLength(1);
    expect(receiptMocks.buildContainerReleaseEntries).toHaveBeenCalledOnce();
  });

  it("forwards explicit retention and records only the effective application set", async () => {
    releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath, retainServingRunner }) => {
      expect(retainServingRunner).toBe(true);
      return { configPath: `${configPath}.retained`, promotionConfigPath: `${configPath}.retained`,
        activeApplicationName: "serving", workerOnly: true, applications: [] };
    });
    await runDeployWorkerVersionCli([], {
      deployRoot: "/tmp/synthetic-deploy", log: false,
      env: { CF_BUNDLES_BUCKET: "synthetic-bundles", CF_WORKER_NAME: "hosted-worker", CLOUDFLARE_ACCOUNT_ID: "account-fixture", CLOUDFLARE_API_TOKEN: "token-fixture" },
      runHostedWorkerDeployment: async ({ dependencies }) => {
        await dependencies.deployDirect({ configPath: "/tmp/generated.jsonc", containerRolloutMode: "worker-only",
          deploymentMessage: "synthetic", includeSecrets: false, secretsFilePath: "/tmp/secrets.json",
          versionTag: "synthetic", workerName: "hosted-worker" });
        return createDeploymentResult();
      },
    });
    expect(imageMocks.prepareHostedContainerDeployImage.mock.calls[0]![0]).not.toHaveProperty("release");
    expect(receiptMocks.readRenderedContainerIdentities).toHaveBeenCalledWith("/tmp/generated.jsonc.retained");
    expect(releaseMocks.runSmokeHostedDeploy).toHaveBeenCalledOnce();
    expect(wranglerMocks.runWranglerLoggedCaptured).toHaveBeenCalledOnce();
    expect(fileMocks.writeFile).toHaveBeenCalledWith("/tmp/generated.jsonc", "{}", "utf8");
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
    imageMocks.prepareHostedContainerDeployImage.mockResolvedValueOnce("/tmp/wrangler.image-prepared.jsonc");
    const env = {
      CF_BUNDLES_BUCKET: "hosted-bundles",
      CLOUDFLARE_ACCOUNT_ID: "account-fixture",
      CLOUDFLARE_API_TOKEN: "token-fixture",
      CF_WORKER_NAME: "hosted-worker",
    };
    const listApplications = vi.fn();
    const readRollout = vi.fn();
    const before = [{
      applicationId: "provider-app-id",
      applicationName: "hosted-worker-runnercontainer",
      image: "image-before",
      version: 6,
    }];
    const actions = [{
      action: "unchanged",
      applicationName: "hosted-worker-runnercontainer",
      className: "RunnerContainer",
    }];
    receiptMocks.createCloudflareContainerProvider.mockReturnValue({
      listApplications,
      readRollout,
    });
    receiptMocks.readCloudflareContainerApplicationIdentities.mockResolvedValueOnce(before);


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
      "versions", "upload",
      "--config",
      "/tmp/wrangler.image-prepared.jsonc",
      "--name",
      "hosted-worker",
      "--message",
      "manual direct deploy",
      "--tag",
      "manual-version",
      "--secrets-file",
      "/tmp/worker-secrets.json",
    ]);
    expect(receiptMocks.readRenderedContainerIdentities).toHaveBeenCalledWith(
      "/tmp/wrangler.image-prepared.jsonc",
    );
    expect(receiptMocks.createCloudflareContainerProvider).toHaveBeenCalledWith({
      accountId: "account-fixture",
      apiToken: "token-fixture",
    });
    expect(receiptMocks.readCloudflareContainerApplicationIdentities)
      .toHaveBeenNthCalledWith(
        1,
        renderedContainers,
        listApplications,
        "before",
        readRollout,
      );
    expect(receiptMocks.parseWranglerWorkerVersionId).toHaveBeenCalledWith("deploy\n");
    expect(receiptMocks.waitForCloudflareContainerReleaseEntries).toHaveBeenCalledWith({
      actions,
      before,
      expectedContainers: renderedContainers,
      listApplications,
      readRollout,
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
      "versions", "upload",
      "--config",
      "/tmp/wrangler.generated.jsonc",
      "--name",
      "hosted-worker",
      "--message",
      "manual direct deploy",
      "--tag",
      "manual-version",
    ]);
    expect(trace).toEqual(["r2", "r2", "deploy", "versions", "deploy", "versions"]);
  });

  it("prepares the inactive image immediately and promotes without a container rollout", async () => {
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
      "versions", "upload",
      "--config",
      "/tmp/wrangler.generated.jsonc",
      "--name",
      "hosted-worker",
      "--message",
      "manual direct deploy",
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

async function syntheticDeployment(containerRolloutMode: "immediate" | "worker-only" = "immediate") {
  return runDeployWorkerVersionCli([], {
    deployRoot: "/tmp/repo/apps/cloudflare", log: false,
    env: { CF_WORKER_NAME: "hosted-worker", CF_BUNDLES_BUCKET: "hosted-bundles", CLOUDFLARE_ACCOUNT_ID: "fixture", CLOUDFLARE_API_TOKEN: "fixture" },
    runHostedWorkerDeployment: async ({ dependencies }) => {
      await dependencies.deployDirect({ configPath: "/tmp/config.jsonc", containerRolloutMode, deploymentMessage: "synthetic", includeSecrets: false, secretsFilePath: "/tmp/secrets.json", versionTag: "synthetic", workerName: "hosted-worker" });
      return createDeploymentResult();
    },
  });
}
