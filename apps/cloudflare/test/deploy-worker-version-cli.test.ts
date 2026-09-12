import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { syntheticHostedWebProtocolAdmission } from "./helpers/hosted-web-protocol";

const webProtocolMocks = vi.hoisted(() => ({ admit: vi.fn() }));
vi.mock("../scripts/deploy-web-protocol.ts", () => ({ assertHostedWebProtocolAdmission: webProtocolMocks.admit }));

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
  prepareSmallRunnerNamespaceBootstrap: vi.fn(),
  stageHostedRunnerRelease: vi.fn(), readWorkerVersion: vi.fn(), assertDrained: vi.fn(), retireApplication: vi.fn(), assertCapacity: vi.fn(), runSmokeHostedDeploy: vi.fn(), admitApplication: vi.fn(), assertApplicationReady: vi.fn(),
}));
vi.mock("../scripts/stage-runner-release.ts", () => ({
  stageHostedRunnerRelease: releaseMocks.stageHostedRunnerRelease,
  prepareSmallRunnerNamespaceBootstrap: releaseMocks.prepareSmallRunnerNamespaceBootstrap,
}));
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
  it.each(["old-reader", "old-audience", "unavailable", "denied", "malformed", "unknown-version"])("rejects %s before bootstrap, image work, or native mutation", async shape => {
    releaseMocks.prepareSmallRunnerNamespaceBootstrap.mockResolvedValue("synthetic-bootstrap.jsonc");
    await useRealWebAdmission(shape);
    await expect(syntheticDeployment()).rejects.toThrow("Hosted Web protocol admission failed");
    expect(imageMocks.prepareHostedContainerDeployImage).not.toHaveBeenCalled();
    expect(wranglerMocks.runWranglerLoggedCaptured).not.toHaveBeenCalled();
    expect(wranglerMocks.runWranglerLogged).not.toHaveBeenCalled();
    expect(releaseMocks.admitApplication).not.toHaveBeenCalled();
    expect(releaseMocks.retireApplication).not.toHaveBeenCalled();
  });

  it.each(["immediate", "worker-only"] as const)("admits current Web for %s without revision equality", async mode => {
    await useRealWebAdmission("current");
    if (mode === "worker-only") releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath }) => ({
      configPath, promotionConfigPath: configPath, activeApplicationName: "serving", workerOnly: true, applications: [], retirements: [],
    }));
    await syntheticDeployment(mode);
    expect(wranglerMocks.runWranglerLogged).toHaveBeenCalled();
    expect(webProtocolMocks.admit).toHaveBeenCalledWith(expect.anything());
  });

  it("does not mistake retaining the runner for proof that legacy audience is sufficient", async () => {
    await useRealWebAdmission("old-audience");
    releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath }) => ({
      configPath, promotionConfigPath: configPath, activeApplicationName: "serving", workerOnly: true, applications: [], retirements: [],
    }));
    await expect(syntheticDeployment("worker-only")).rejects.toThrow("thread_route_audience");
    expect(wranglerMocks.runWranglerLogged).not.toHaveBeenCalled();
    expect(releaseMocks.admitApplication).not.toHaveBeenCalled();
  });

  it.each(["bootstrap", "retirement", "smoke-application", "compatibility", "serving", "small", "promotion"])("rechecks Web immediately before %s", async boundary => {
    const trace: string[] = [];
    const serving = { name: renderedContainers[0]!.applicationName, className: "RunnerContainer", applicationId: "synthetic-serving", namespaceId: "synthetic-namespace", specification: {} };
    releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath }) => ({
      configPath, promotionConfigPath: `${configPath}.promote`, activeApplicationName: serving.name, workerOnly: false,
      applications: boundary === "serving" ? [serving] : boundary === "small" ? [{ ...serving, name: "synthetic-small", className: "SmallRunnerContainer" }]
        : boundary === "smoke-application" ? [{ ...serving, name: "synthetic-smoke", className: "DeploySmokeRunnerContainer" }] : [],
      retirements: boundary === "retirement" ? [{ name: "synthetic-retired", applicationId: "synthetic-retired", namespaceId: "synthetic-retired" }] : [],
    }));
    if (boundary === "bootstrap") releaseMocks.prepareSmallRunnerNamespaceBootstrap.mockResolvedValue("synthetic-bootstrap.jsonc");
    const failAt = ["serving", "small", "promotion"].includes(boundary) ? 3 : 2;
    await useRealWebAdmission(check => check === failAt ? "old-reader" : "current", () => trace.push("web"));
    wranglerMocks.runWranglerJson.mockImplementation(async () => {
      trace.push("identity");
      return JSON.stringify({ versions: [{ percentage: 100, version_id: "version-direct" }] });
    });
    wranglerMocks.runWranglerLogged.mockImplementation(async args => { if (args[0] === "versions") trace.push("activation"); });
    await expect(syntheticDeployment()).rejects.toThrow("runtime_log_event:runner.processing_finished");
    expect(trace.at(-1)).toBe("web");
    for (let i = 0; i < trace.length; i += 1) {
      if (trace[i] === "activation") expect(trace.slice(i - 2, i)).toEqual(["web", "identity"]);
    }
    expect(trace.filter(event => event === "activation")).toHaveLength(failAt === 3 ? 1 : 0);
    expect(releaseMocks.admitApplication).not.toHaveBeenCalled();
    expect(releaseMocks.retireApplication).not.toHaveBeenCalled();
    if (boundary === "bootstrap") expect(wranglerMocks.runWranglerLoggedCaptured).not.toHaveBeenCalled();
  });

  it("does not reuse admission after a previously successful deployment", async () => {
    await useRealWebAdmission("current");
    await syntheticDeployment();
    const activations = wranglerMocks.runWranglerLogged.mock.calls.length;
    await useRealWebAdmission("old-reader");
    await expect(syntheticDeployment()).rejects.toThrow("runtime_log_event:runner.processing_finished");
    expect(wranglerMocks.runWranglerLogged.mock.calls).toHaveLength(activations);
  });

  it("publishes the retained namespace bootstrap before staging and stops if its receipts change", async () => {
    const trace: string[] = [];
    releaseMocks.prepareSmallRunnerNamespaceBootstrap.mockResolvedValue("/tmp/bootstrap.jsonc");
    wranglerMocks.runWranglerLoggedCaptured.mockImplementation(async args => {
      trace.push(args[0]);
      expect(args).toContain("--containers-rollout=none");
      return { stdout: "deploy", stderr: "" };
    });
    receiptMocks.buildContainerReleaseEntries.mockImplementation(() => {
      trace.push("check retained apps");
      throw new Error("retained native application changed");
    });
    await expect(syntheticDeployment()).rejects.toThrow("retained native application changed");
    expect(trace).toEqual(["deploy", "check retained apps"]);
    expect(imageMocks.prepareHostedContainerDeployImage).not.toHaveBeenCalled();
    expect(releaseMocks.admitApplication).not.toHaveBeenCalled();
  });

  it("activates compatibility before the small rollout and never enables routing after failed convergence", async () => {
    const trace: string[] = [];
    const small = { name: "hosted-worker-smallrunnercontainer", className: "SmallRunnerContainer",
      applicationId: null, namespaceId: "small-namespace", specification: {} };
    releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath }) => ({
      configPath, promotionConfigPath: `${configPath}.promote`, activeApplicationName: "serving",
      workerOnly: false, applications: [small], retirements: [],
    }));
    wranglerMocks.runWranglerLogged.mockImplementation(async args => { if (args[0] === "versions") trace.push("activate"); });
    releaseMocks.admitApplication.mockImplementation(async () => { trace.push("small rollout"); return "created"; });
    releaseMocks.assertApplicationReady.mockRejectedValue(new Error("small image not distributed"));
    await expect(syntheticDeployment()).rejects.toThrow("small image not distributed");
    expect(trace).toEqual(["activate", "small rollout"]);
    expect(wranglerMocks.runWranglerLoggedCaptured).toHaveBeenCalledOnce();
    expect(releaseMocks.admitApplication).toHaveBeenCalledWith({ ...small, rolloutStepPercentage: 100 });
    expect(releaseMocks.runSmokeHostedDeploy).not.toHaveBeenCalled();
  });
  it.each([true, false])("checks the desired existing small capacity before admission (available=%s)", async available => {
    const trace: string[] = [];
    const small = { name: "hosted-worker-smallrunnercontainer", className: "SmallRunnerContainer",
      applicationId: "small-app", namespaceId: "small-namespace", specification: { max_instances: 10 } };
    releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath }) => ({
      configPath, promotionConfigPath: `${configPath}.promote`, activeApplicationName: "serving",
      workerOnly: false, applications: [small], retirements: [],
    }));
    releaseMocks.assertCapacity.mockImplementation(async () => {
      trace.push("quota");
      if (!available) throw new Error("small capacity exceeds account budget");
    });
    releaseMocks.admitApplication.mockImplementation(async () => { trace.push("small rollout"); return "modified"; });
    releaseMocks.assertApplicationReady.mockRejectedValue(new Error("synthetic stop after admission"));
    await expect(syntheticDeployment()).rejects.toThrow(available
      ? "synthetic stop after admission" : "small capacity exceeds account budget");
    expect(releaseMocks.assertCapacity).toHaveBeenCalledExactlyOnceWith({
      applicationId: small.applicationId, specification: small.specification,
    });
    expect(trace).toEqual(available ? ["quota", "small rollout"] : ["quota"]);
    if (!available) expect(releaseMocks.admitApplication).not.toHaveBeenCalled();
  });

  it("retires drained capacity, proves quota, activates compatibility, then rolls the serving image", async () => {
    const trace: string[] = [];
    const deployment = { active: { id: "synthetic-permanent" }, candidate: { id: "synthetic-permanent" }, previous: null };
    const serving = { name: renderedContainers[0]!.applicationName, className: "RunnerContainer", applicationId: "serving-app", namespaceId: "serving-namespace", specification: {} };
    const retirement = { name: "retired-app", applicationId: "retired-id", namespaceId: "retired-namespace" };
    releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath }) => ({ configPath, promotionConfigPath: `${configPath}.promote`, activeApplicationName: serving.name, workerOnly: false, deployment, applications: [serving], retirements: [retirement] }));
    releaseMocks.assertDrained.mockImplementation(async () => { trace.push("drained"); });
    releaseMocks.retireApplication.mockImplementation(async () => { trace.push("retired"); });
    releaseMocks.assertCapacity.mockImplementation(async () => { trace.push("quota"); });
    releaseMocks.admitApplication.mockImplementation(async () => { trace.push("native rollout"); return "modified"; });
    releaseMocks.assertApplicationReady.mockImplementation(async () => { trace.push("distributed"); });
    releaseMocks.runSmokeHostedDeploy.mockImplementation(async input => { trace.push(input.phase === "artifact" ? "artifact smoke" : "serving smoke"); });
    wranglerMocks.runWranglerLogged.mockImplementation(async args => { if (args[0] === "versions") trace.push("activate"); });
    await syntheticDeployment("gradual");
    expect(releaseMocks.runSmokeHostedDeploy).toHaveBeenCalledWith(expect.objectContaining({ source: expect.objectContaining({ HOSTED_EXECUTION_RUNNER_DEPLOYMENT: JSON.stringify(deployment) }) }));
    expect(trace).toEqual(["drained", "retired", "quota", "activate", "artifact smoke", "native rollout", "distributed", "serving smoke", "activate"]);
    expect(releaseMocks.admitApplication).toHaveBeenCalledWith({ ...serving, rolloutStepPercentage: [10, 25, 50, 100] });
  });

  it("leaves the serving image untouched when isolated behavioral smoke fails", async () => {
    const serving = { name: renderedContainers[0]!.applicationName, className: "RunnerContainer", applicationId: "serving-app", namespaceId: "serving-namespace", specification: {} };
    releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath }) => ({ configPath, promotionConfigPath: `${configPath}.promote`, activeApplicationName: serving.name, workerOnly: false, applications: [serving], retirements: [] }));
    releaseMocks.runSmokeHostedDeploy.mockRejectedValue(new Error("candidate shell failed"));
    await expect(syntheticDeployment("gradual")).rejects.toThrow("candidate shell failed");
    expect(releaseMocks.admitApplication).not.toHaveBeenCalled();
    expect(releaseMocks.runSmokeHostedDeploy).toHaveBeenCalledWith(expect.objectContaining({ phase: "artifact" }));
    expect(wranglerMocks.runWranglerLogged.mock.calls.filter(([args]) => args[0] === "versions")).toHaveLength(1);
  });

  it("retains the compatible Worker and pending pair after serving rollout failure", async () => {
    const serving = { name: renderedContainers[0]!.applicationName, className: "RunnerContainer", applicationId: "serving-app", namespaceId: "serving-namespace", specification: {} };
    releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath }) => ({ configPath, promotionConfigPath: `${configPath}.promote`, activeApplicationName: serving.name, workerOnly: false, applications: [serving], retirements: [] }));
    releaseMocks.admitApplication.mockRejectedValue(new Error("lost rollout response"));
    await expect(syntheticDeployment()).rejects.toThrow("lost rollout response");
    expect(wranglerMocks.runWranglerLogged.mock.calls.filter(([args]) => args[0] === "versions")).toHaveLength(1);
    expect(wranglerMocks.runWranglerLoggedCaptured).toHaveBeenCalledOnce();
    expect(releaseMocks.runSmokeHostedDeploy).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ phase: "artifact" }));
  });

  beforeEach(() => {
    webProtocolMocks.admit.mockReset().mockResolvedValue(undefined);
    releaseMocks.prepareSmallRunnerNamespaceBootstrap.mockReset();
    releaseMocks.prepareSmallRunnerNamespaceBootstrap.mockResolvedValue(null);
    releaseMocks.stageHostedRunnerRelease.mockReset();
    releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath }) => ({
      retirements: [], configPath, promotionConfigPath: `${configPath}.promote`,
      activeApplicationName: "hosted-worker-runnercontainer", applications: [], workerOnly: false,
    }));
    releaseMocks.readWorkerVersion.mockReset();
    releaseMocks.readWorkerVersion.mockResolvedValue({});
    releaseMocks.admitApplication.mockReset();
    releaseMocks.admitApplication.mockResolvedValue("created");
    releaseMocks.assertApplicationReady.mockReset();
    releaseMocks.assertApplicationReady.mockResolvedValue(undefined);
    releaseMocks.retireApplication.mockReset();
    releaseMocks.assertCapacity.mockReset();
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
    receiptMocks.buildContainerReleaseEntries.mockReturnValue(releasedContainers);
    receiptMocks.parseWranglerWorkerVersionId.mockReset();
    receiptMocks.parseWranglerWorkerVersionId.mockReturnValue("version-direct");
    receiptMocks.readCloudflareContainerApplicationIdentities.mockReset();
    receiptMocks.readCloudflareContainerApplicationIdentities.mockImplementation(async (containers) => containers.map((entry: { applicationName: string }) => ({ applicationName: entry.applicationName, applicationId: "provider-app-id", image: "image-before", version: 6 })));
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
    expect(receiptMocks.buildContainerReleaseEntries).toHaveBeenCalledOnce();
  });

  it("uploads container metadata before admission without switching traffic", async () => {
    releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath }) => ({
      retirements: [], configPath, promotionConfigPath: `${configPath}.promote`, activeApplicationName: "serving", workerOnly: false,
      applications: [{ name: renderedContainers[0]!.applicationName, className: "DeploySmokeRunnerContainer", applicationId: null, namespaceId: "synthetic-namespace", specification: {} }],
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
      retirements: [], configPath, promotionConfigPath: `${configPath}.promote`, activeApplicationName: "serving", workerOnly: false,
      applications: [{ name: renderedContainers[0]!.applicationName, className: "DeploySmokeRunnerContainer", applicationId: null, namespaceId: "synthetic-namespace", specification: {} }],
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
      retirements: [], configPath, promotionConfigPath: `${configPath}.promote`, activeApplicationName: "serving", workerOnly: mode === "worker-only", applications: [smoke],
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

  it.each(["RunnerContainer", "NextRunnerContainer"])("still blocks retirement of %s when member drain evidence is unavailable", async (className) => {
    releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath }) => ({
      configPath, promotionConfigPath: `${configPath}.promote`, activeApplicationName: "serving", workerOnly: false,
      applications: [],
      retirements: [{ name: renderedContainers[0]!.applicationName, applicationId: "member-app", namespaceId: "member-namespace" }],
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
      retirements: [], configPath, promotionConfigPath: `${configPath}.promote`, activeApplicationName: "serving", workerOnly: true, applications: [],
    }));
    await syntheticDeployment();
    expect(releaseMocks.admitApplication).not.toHaveBeenCalled();
    expect(wranglerMocks.runWranglerLoggedCaptured).toHaveBeenCalledOnce();
    expect(wranglerMocks.runWranglerLoggedCaptured.mock.calls[0]![0].slice(0, 2)).toEqual(["versions", "upload"]);
    expect(wranglerMocks.runWranglerLogged.mock.calls.filter(([args]) => args[0] === "versions")).toHaveLength(1);
    expect(receiptMocks.buildContainerReleaseEntries).toHaveBeenCalledTimes(2);
  });

  it("forwards explicit retention and records only the effective application set", async () => {
    releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath, retainServingRunner }) => {
      expect(retainServingRunner).toBe(true);
      return { retirements: [], configPath: `${configPath}.retained`, promotionConfigPath: `${configPath}.retained`,
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
    expect(receiptMocks.buildContainerReleaseEntries).toHaveBeenCalledWith({ actions, before, after: before });
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

  it("uploads and promotes the immediate release through Worker versions", async () => {
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

async function syntheticDeployment(containerRolloutMode: "gradual" | "immediate" | "worker-only" = "immediate") {
  return runDeployWorkerVersionCli([], {
    deployRoot: "/tmp/repo/apps/cloudflare", log: false,
    env: { CF_WORKER_NAME: "hosted-worker", CF_BUNDLES_BUCKET: "hosted-bundles", CLOUDFLARE_ACCOUNT_ID: "fixture", CLOUDFLARE_API_TOKEN: "fixture" },
    runHostedWorkerDeployment: async ({ dependencies }) => {
      await dependencies.deployDirect({ configPath: "/tmp/config.jsonc", containerRolloutMode, deploymentMessage: "synthetic", includeSecrets: false, secretsFilePath: "/tmp/secrets.json", versionTag: "synthetic", workerName: "hosted-worker" });
      return createDeploymentResult();
    },
  });
}

async function useRealWebAdmission(shape: string | ((check: number) => string), onCheck?: () => void) {
  const { assertHostedWebProtocolAdmission } = await vi.importActual<typeof import("../scripts/deploy-web-protocol.ts")>("../scripts/deploy-web-protocol.ts");
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const signingKey = JSON.stringify(await crypto.subtle.exportKey("jwk", keys.privateKey));
  let checks = 0;
  webProtocolMocks.admit.mockImplementation(env => {
    const responseShape = typeof shape === "function" ? shape(++checks) : shape;
    onCheck?.();
    return assertHostedWebProtocolAdmission({
      ...env, HOSTED_WEB_BASE_URL: "https://web.example.test", HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: signingKey,
    }, { sleep: async () => {}, fetchImpl: async input => {
      if (responseShape === "unavailable") return new Response(null, { status: 503 });
      if (responseShape === "malformed") return new Response("not JSON", { headers: { "cache-control": "no-store", "content-type": "application/json" } });
      const url = new URL(input instanceof Request ? input.url : String(input));
      const evidence = syntheticHostedWebProtocolAdmission(url.searchParams.get("nonce")!);
      if (responseShape === "old-reader") evidence.runtimeLogEventCodes = evidence.runtimeLogEventCodes.filter(code => code !== "runner.processing_finished");
      if (responseShape === "old-audience") evidence.threadRouteAuthority = { direct: { authorized: true }, group: { authorized: true } };
      if (responseShape === "denied") evidence.threadRouteAuthority = { direct: { authorized: false }, group: { authorized: true, threadIsDirect: false } };
      return Response.json(responseShape === "unknown-version" ? { ...evidence, schemaVersion: 2 } : evidence, { headers: { "cache-control": "no-store" } });
    } });
  });
}
