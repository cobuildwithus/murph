import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { syntheticHostedWebProtocolAdmission } from "./helpers/hosted-web-protocol";

const webProtocolMocks = vi.hoisted(() => ({ admit: vi.fn() }));
vi.mock("../scripts/deploy-web-protocol.ts", () => ({ assertHostedWebProtocolAdmission: webProtocolMocks.admit }));

const fileMocks = vi.hoisted(() => ({
  readFile: vi.fn<(filePath: unknown, ...args: unknown[]) => Promise<string>>(async () => "{}"),
  writeFile: vi.fn<(filePath: unknown, content: unknown, ...args: unknown[]) => Promise<void>>(async () => {}),
}));
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
  stageHostedRunnerRelease: vi.fn(), readWorkerVersion: vi.fn(), readRecentWorkerVersionIds: vi.fn(), removeRetiredInferenceSecrets: vi.fn(), assertDrained: vi.fn(), retireApplication: vi.fn(), assertCapacity: vi.fn(), runSmokeHostedDeploy: vi.fn(), admitApplication: vi.fn(), assertApplicationReady: vi.fn(),
}));
vi.mock("../scripts/stage-runner-release.ts", () => ({
  stageHostedRunnerRelease: releaseMocks.stageHostedRunnerRelease,
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
import { runHostedWorkerDeployment } from "../scripts/deploy-worker-version.shared.js";

const recoveryVersionId = "11111111-1111-4111-8111-111111111111";
const recoveryEnv = {
  HOSTED_EXECUTION_RECOVERY_VERSION_ID: recoveryVersionId,
  HOSTED_EXECUTION_RECOVERY_VERSION_TAG: "trusted-upload",
};

describe("runDeployWorkerVersionCli", () => {
  it.each(["old-reader", "old-audience", "unavailable", "denied", "malformed", "unknown-version"])("rejects %s before image work or native mutation", async shape => {
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

  it.each(["retirement", "smoke-application", "compatibility", "serving", "promotion"])("rechecks Web immediately before %s", async boundary => {
    const trace: string[] = [];
    const serving = { name: renderedContainers[0]!.applicationName, className: "RunnerContainer", applicationId: "synthetic-serving", namespaceId: "synthetic-namespace", specification: {} };
    releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath }) => ({
      configPath, promotionConfigPath: `${configPath}.promote`, activeApplicationName: serving.name, workerOnly: false,
      applications: boundary === "serving" ? [serving]
        : boundary === "smoke-application" ? [{ ...serving, name: "synthetic-smoke", className: "DeploySmokeRunnerContainer" }] : [],
      retirements: boundary === "retirement" ? [{ name: "synthetic-retired", applicationId: "synthetic-retired", namespaceId: "synthetic-retired" }] : [],
    }));
    const failAt = ["serving", "promotion"].includes(boundary) ? 3 : 2;
    await useRealWebAdmission(check => check === failAt ? "old-reader" : "current", () => trace.push("web"));
    wranglerMocks.runWranglerJson.mockImplementation(async () => {
      trace.push("identity");
      return JSON.stringify({ versions: [{ percentage: 100, version_id: syntheticLiveVersion() }] });
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
  });

  it("does not reuse admission after a previously successful deployment", async () => {
    await useRealWebAdmission("current");
    await syntheticDeployment();
    const activations = wranglerMocks.runWranglerLogged.mock.calls.length;
    await useRealWebAdmission("old-reader");
    await expect(syntheticDeployment()).rejects.toThrow("runtime_log_event:runner.processing_finished");
    expect(wranglerMocks.runWranglerLogged.mock.calls).toHaveLength(activations);
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
    fileMocks.readFile.mockReset().mockResolvedValue("{}");
    fileMocks.writeFile.mockReset().mockResolvedValue(undefined);
    webProtocolMocks.admit.mockReset().mockResolvedValue(undefined);
    releaseMocks.stageHostedRunnerRelease.mockReset();
    releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath }) => ({
      retirements: [], configPath, promotionConfigPath: `${configPath}.promote`,
      activeApplicationName: "hosted-worker-runnercontainer", applications: [], workerOnly: false,
    }));
    releaseMocks.readWorkerVersion.mockReset();
    releaseMocks.readWorkerVersion.mockImplementation(async (_worker, id) => ({ id, resources: { bindings: [] } }));
    releaseMocks.readRecentWorkerVersionIds.mockReset().mockImplementation(async () => [
      ...[receiptMocks.parseWranglerWorkerVersionId, releaseMocks.removeRetiredInferenceSecrets].flatMap(mock =>
        mock.mock.results.filter(result => result.type === "return").map((result, index) => ({ id: result.value, order: mock.mock.invocationCallOrder[index]! }))
      ).sort((a, b) => b.order - a.order).map(result => result.id),
      "version-direct",
    ].slice(0, 2));
    releaseMocks.removeRetiredInferenceSecrets.mockReset().mockImplementation(() => `patched-version-${releaseMocks.removeRetiredInferenceSecrets.mock.calls.length}`);
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
    wranglerMocks.runWranglerJson.mockImplementation(async () => JSON.stringify({ versions: [{ percentage: 100, version_id: syntheticLiveVersion() }] }));
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
    receiptMocks.parseWranglerWorkerVersionId.mockImplementation(() => `uploaded-version-${receiptMocks.parseWranglerWorkerVersionId.mock.calls.length}`);
    receiptMocks.readCloudflareContainerApplicationIdentities.mockReset();
    receiptMocks.readCloudflareContainerApplicationIdentities.mockImplementation(async (containers) => containers.map((entry: { applicationName: string }) => ({ applicationName: entry.applicationName, applicationId: "provider-app-id", image: "image-before", version: 6 })));
    receiptMocks.readRenderedContainerIdentities.mockReset();
    receiptMocks.readRenderedContainerIdentities.mockResolvedValue(renderedContainers);
    receiptMocks.waitForCloudflareContainerReleaseEntries.mockReset();
    receiptMocks.waitForCloudflareContainerReleaseEntries.mockResolvedValue(releasedContainers);
  });

  it.each([false, true])("checks stage and promotion secret inventories before activation with synchronization=%s", async includeSecrets => {
    const retained = [{ name: "OPENAI_API_KEY", type: "secret_text" }, { name: "OPTIONAL_SECRET", type: "secret_text" }];
    const trace: string[] = [];
    const readHistory = releaseMocks.readRecentWorkerVersionIds.getMockImplementation()!;
    releaseMocks.readRecentWorkerVersionIds.mockImplementation(async () => {
      const ids = await readHistory();
      trace.push(`history:${ids.join(",")}`);
      return ids;
    });
    let liveVersion = "version-direct";
    releaseMocks.readWorkerVersion.mockImplementation(async (_worker, versionId) => {
      trace.push(`inventory:${versionId}`);
      return { id: versionId, resources: { bindings: versionId === "version-direct"
        ? [...retained, { name: "VENICE_API_KEY", type: "secret_text" }, { name: "VERCEL_AI_API_KEY", type: "secret_text" }]
        : [...retained, ...(includeSecrets ? [{ name: "NEW_SECRET", type: "secret_text" }] : [])] } };
    });
    fileMocks.readFile.mockImplementation(async filePath => String(filePath).endsWith("secrets.json")
      ? JSON.stringify({ OPENAI_API_KEY: "synthetic-rotation", NEW_SECRET: "synthetic-new" }) : "{}");
    receiptMocks.parseWranglerWorkerVersionId.mockReturnValueOnce("stage-version").mockReturnValueOnce("final-version");
    wranglerMocks.runWranglerJson.mockImplementation(async () => JSON.stringify({ versions: [{ percentage: 100, version_id: liveVersion }] }));
    wranglerMocks.runWranglerLogged.mockImplementation(async args => {
      if (args[0] === "versions") {
        liveVersion = args[2].split("@")[0];
        trace.push(`activate:${liveVersion}`);
      }
    });
    await syntheticDeployment("immediate", {}, includeSecrets);
    expect(trace).toEqual([
      "inventory:version-direct", "history:version-direct",
      "history:stage-version,version-direct", "inventory:stage-version", "activate:stage-version",
      "history:stage-version,version-direct", "history:final-version,stage-version",
      "inventory:final-version", "activate:final-version",
    ]);
    expect(releaseMocks.removeRetiredInferenceSecrets).not.toHaveBeenCalled();
    for (const [args] of wranglerMocks.runWranglerLoggedCaptured.mock.calls) {
      expect(args.includes("--secrets-file")).toBe(includeSecrets);
    }
  });

  it.each(["stage", "promotion"])("rejects an unrelated inactive latest version before the %s upload", async boundary => {
    const readHistory = releaseMocks.readRecentWorkerVersionIds.getMockImplementation()!;
    releaseMocks.readRecentWorkerVersionIds.mockImplementation(async () => (
      releaseMocks.readRecentWorkerVersionIds.mock.calls.length === (boundary === "stage" ? 1 : 3)
        ? ["unrelated-inactive-version", "version-direct"] : readHistory()
    ));
    await expect(syntheticDeployment()).rejects.toThrow("inheritance source changed before upload");
    expect(wranglerMocks.runWranglerLoggedCaptured).toHaveBeenCalledTimes(boundary === "stage" ? 0 : 1);
    expect(wranglerMocks.runWranglerLogged.mock.calls.filter(([args]) => args[0] === "versions")).toHaveLength(boundary === "stage" ? 0 : 1);
    expect(releaseMocks.admitApplication).not.toHaveBeenCalled();
    expect(releaseMocks.retireApplication).not.toHaveBeenCalled();
  });

  it.each([
    { HOSTED_EXECUTION_RECOVERY_VERSION_ID: recoveryVersionId },
    { HOSTED_EXECUTION_RECOVERY_VERSION_TAG: "trusted-upload" },
    { ...recoveryEnv, HOSTED_EXECUTION_RECOVERY_VERSION_ID: "11111111" },
    { ...recoveryEnv, HOSTED_EXECUTION_RECOVERY_VERSION_ID: ` ${recoveryVersionId}` },
    { ...recoveryEnv, HOSTED_EXECUTION_RECOVERY_VERSION_TAG: " " },
    { ...recoveryEnv, HOSTED_EXECUTION_RECOVERY_VERSION_TAG: " trusted-upload" },
    { HOSTED_EXECUTION_RECOVERY_VERSION_ID: " ", HOSTED_EXECUTION_RECOVERY_VERSION_TAG: " " },
  ])("rejects partial or malformed recovery identity before any deployment work: %j", async env => {
    await expect(syntheticDeployment("worker-only", env, true)).rejects.toThrow("exact full version UUID");
    expect(webProtocolMocks.admit).not.toHaveBeenCalled();
    expect(releaseMocks.readWorkerVersion).not.toHaveBeenCalled();
    expect(imageMocks.prepareHostedContainerDeployImage).not.toHaveBeenCalled();
    expect(wranglerMocks.runWranglerLoggedCaptured).not.toHaveBeenCalled();
  });

  it.each([
    ["immediate", true], ["gradual", true], ["worker-only", false],
  ] as const)("rejects recovery with mode=%s and synchronized secrets=%s", async (mode, includeSecrets) => {
    await expect(syntheticDeployment(mode, recoveryEnv, includeSecrets)).rejects.toThrow("worker-only rollout with synchronized secrets");
    expect(releaseMocks.readWorkerVersion).not.toHaveBeenCalled();
    expect(wranglerMocks.runWranglerLogged).not.toHaveBeenCalled();
  });

  it("treats both empty recovery inputs as an ordinary deployment", async () => {
    await syntheticDeployment("immediate", {
      HOSTED_EXECUTION_RECOVERY_VERSION_ID: "", HOSTED_EXECUTION_RECOVERY_VERSION_TAG: "",
    });
    expect(releaseMocks.readWorkerVersion.mock.calls.map(([, id]) => id))
      .toEqual(["version-direct", "uploaded-version-1", "uploaded-version-2"]);
  });

  it("refuses recovery without a sole authoritative live version at 100%", async () => {
    configureRecoveryUpload();
    wranglerMocks.runWranglerJson.mockResolvedValueOnce(JSON.stringify({ versions: [
      { version_id: "version-direct", percentage: 90 }, { version_id: recoveryVersionId, percentage: 10 },
    ] }));
    await expect(syntheticDeployment("worker-only", recoveryEnv, true)).rejects.toThrow("one authoritative live Worker version");
    expect(releaseMocks.readWorkerVersion).not.toHaveBeenCalled();
    expect(imageMocks.prepareHostedContainerDeployImage).not.toHaveBeenCalled();
  });

  it("rejects an untrusted recovery tag before image or lifecycle work", async () => {
    configureRecoveryUpload();
    await expect(syntheticDeployment("worker-only", { ...recoveryEnv, HOSTED_EXECUTION_RECOVERY_VERSION_TAG: "other-upload" }, true))
      .rejects.toThrow("version identity or tag differs");
    expect(imageMocks.prepareHostedContainerDeployImage).not.toHaveBeenCalled();
    expect(wranglerMocks.runWranglerLogged).not.toHaveBeenCalled();
    expect(wranglerMocks.runWranglerLoggedCaptured).not.toHaveBeenCalled();
  });

  it.each(["initial", "pre-upload", "post-upload", "pre-patch", "post-patch", "live"])("rejects recovery source drift at %s without activation", async boundary => {
    configureRecoveryUpload();
    const readHistory = releaseMocks.readRecentWorkerVersionIds.getMockImplementation()!;
    releaseMocks.readRecentWorkerVersionIds.mockImplementation(async () => {
      const ids = await readHistory();
      const calls = releaseMocks.readRecentWorkerVersionIds.mock.calls.length;
      if (calls === ["initial", "pre-upload", "post-upload", "pre-patch", "post-patch"].indexOf(boundary) + 1) {
        return boundary === "initial" || boundary === "pre-upload" || boundary === "post-upload"
          ? [ids[0], "foreign-version"] : ["foreign-version", ids[0]];
      }
      return ids;
    });
    if (boundary === "live") wranglerMocks.runWranglerJson.mockResolvedValueOnce(JSON.stringify({ versions: [{ percentage: 100, version_id: "version-direct" }] }))
      .mockResolvedValue(JSON.stringify({ versions: [{ percentage: 100, version_id: "different-live-version" }] }));
    await expect(syntheticDeployment("worker-only", recoveryEnv, true)).rejects.toThrow(/changed|history/);
    expect(wranglerMocks.runWranglerLoggedCaptured).toHaveBeenCalledTimes(["initial", "pre-upload", "live"].includes(boundary) ? 0 : 1);
    expect(wranglerMocks.runWranglerLogged.mock.calls.some(([args]) => args[0] === "versions")).toBe(false);
    expect(releaseMocks.admitApplication).not.toHaveBeenCalled();
    expect(releaseMocks.retireApplication).not.toHaveBeenCalled();
    if (boundary === "initial") expect(imageMocks.prepareHostedContainerDeployImage).not.toHaveBeenCalled();
  });

  it("uploads fresh code from the explicitly verified secret source and returns only the patched version", async () => {
    const currentVersion = configureRecoveryUpload();
    const result = await runDeployWorkerVersionCli([], {
      deployRoot: "/tmp/repo/apps/cloudflare", log: false,
      env: { ...recoveryEnv, CF_WORKER_NAME: "hosted-worker", CF_BUNDLES_BUCKET: "hosted-bundles",
        CLOUDFLARE_ACCOUNT_ID: "fixture", CLOUDFLARE_API_TOKEN: "fixture",
        HOSTED_EXECUTION_CONTAINER_ROLLOUT: "worker-only", HOSTED_EXECUTION_INCLUDE_SECRETS: "true",
        HOSTED_EXECUTION_DEPLOY_TAG: "fresh-release" },
      runHostedWorkerDeployment: input => runHostedWorkerDeployment({ ...input, dependencies: {
        ...input.dependencies, mkdir: async () => undefined,
        validateDeployEnvironment: async () => undefined, validatePreparedArtifacts: async () => undefined,
      } }),
    });
    expect(releaseMocks.stageHostedRunnerRelease).toHaveBeenCalledWith(expect.objectContaining({
      currentVersion, currentVersionId: "version-direct", retainServingRunner: true,
    }));
    expect(wranglerMocks.runWranglerLoggedCaptured).toHaveBeenCalledExactlyOnceWith(expect.arrayContaining([
      "versions", "upload", "--secrets-file", "/tmp/repo/apps/cloudflare/.deploy/worker-secrets.json", "--tag", "fresh-release",
    ]));
    expect(releaseMocks.readRecentWorkerVersionIds.mock.settledResults.map(result => result.value)).toEqual([
      [recoveryVersionId, "version-direct"], [recoveryVersionId, "version-direct"],
      ["uploaded-version-1", recoveryVersionId], ["uploaded-version-1", recoveryVersionId],
      ["patched-version-1", "uploaded-version-1"],
    ]);
    expect(wranglerMocks.runWranglerLogged.mock.calls.filter(([args]) => args[0] === "versions").map(([args]) => args[2]))
      .toEqual(["patched-version-1@100%"]);
    expect(result).toMatchObject({ smokeVersionId: "patched-version-1",
      containerReleaseReceipt: { workerVersionId: "patched-version-1", versionTag: "fresh-release" },
      finalDeploymentVersions: [{ percentage: 100, versionId: "patched-version-1" }],
    });
  });

  it.each([
    ["stage", "intervening"], ["stage", "newer"],
    ["promotion", "intervening"], ["promotion", "newer"],
  ])("rejects an %s upload with an %s unrelated version before activation", async (boundary, drift) => {
    const readHistory = releaseMocks.readRecentWorkerVersionIds.getMockImplementation()!;
    releaseMocks.readRecentWorkerVersionIds.mockImplementation(async () => {
      const ids = await readHistory();
      if (releaseMocks.readRecentWorkerVersionIds.mock.calls.length !== (boundary === "stage" ? 2 : 4)) return ids;
      return drift === "intervening" ? [ids[0], "unrelated-inactive-version"] : ["unrelated-inactive-version", ids[0]];
    });
    await expect(syntheticDeployment()).rejects.toThrow("version history changed during upload");
    expect(wranglerMocks.runWranglerLoggedCaptured).toHaveBeenCalledTimes(boundary === "stage" ? 1 : 2);
    expect(wranglerMocks.runWranglerLogged.mock.calls.filter(([args]) => args[0] === "versions")).toHaveLength(boundary === "stage" ? 0 : 1);
    expect(releaseMocks.admitApplication).not.toHaveBeenCalled();
    expect(releaseMocks.retireApplication).not.toHaveBeenCalled();
    // The upload may have persisted. A retry must not silently adopt that inactive version.
    const uploads = wranglerMocks.runWranglerLoggedCaptured.mock.calls.length;
    await expect(syntheticDeployment()).rejects.toThrow("inheritance source changed before upload");
    expect(wranglerMocks.runWranglerLoggedCaptured).toHaveBeenCalledTimes(uploads);
  });

  it.each([1, 2])("fails closed when version history read %s is unavailable", async failedRead => {
    const readHistory = releaseMocks.readRecentWorkerVersionIds.getMockImplementation()!;
    releaseMocks.readRecentWorkerVersionIds.mockImplementation(async () => {
      if (releaseMocks.readRecentWorkerVersionIds.mock.calls.length === failedRead) throw new Error("history unavailable");
      return readHistory();
    });
    await expect(syntheticDeployment()).rejects.toThrow("history unavailable");
    expect(wranglerMocks.runWranglerLoggedCaptured).toHaveBeenCalledTimes(failedRead - 1);
    expect(wranglerMocks.runWranglerLogged.mock.calls.some(([args]) => args[0] === "versions")).toBe(false);
    expect(releaseMocks.admitApplication).not.toHaveBeenCalled();
    expect(releaseMocks.retireApplication).not.toHaveBeenCalled();
  });

  it.each([false, true])("patches retired secrets once and promotes the verified version with synchronization=%s", async includeSecrets => {
    const retained = [
      { name: "OPENAI_API_KEY", type: "secret_text" }, { name: "OPTIONAL_SECRET", type: "secret_text" },
      { name: "SHARED_SIGNING_SECRET", type: "secret_text" }, { name: "CRYPTO_KEY", type: "secret_key" },
    ];
    fileMocks.readFile.mockImplementation(async filePath => String(filePath).endsWith("secrets.json")
      ? JSON.stringify({ OPENAI_API_KEY: "synthetic-rotation", NEW_SECRET: "synthetic-new" }) : "{}");
    releaseMocks.readWorkerVersion.mockImplementation(async (_worker, id) => ({ id, resources: { bindings: [
      ...retained,
      ...(id === "version-direct" || id === "uploaded-version-1" ? [{ name: "VENICE_API_KEY", type: "secret_text" }, { name: "VERCEL_AI_API_KEY", type: "secret_text" }] : []),
      ...(includeSecrets && id !== "version-direct" ? [{ name: "NEW_SECRET", type: "secret_text" }] : []),
    ] } }));
    await syntheticDeployment("immediate", {}, includeSecrets);
    expect(releaseMocks.removeRetiredInferenceSecrets).toHaveBeenCalledExactlyOnceWith({
      workerName: "hosted-worker", versionMessage: "synthetic", versionTag: "synthetic",
    });
    expect(releaseMocks.readRecentWorkerVersionIds.mock.settledResults.map(result => result.value)).toEqual([
      ["version-direct"], ["uploaded-version-1", "version-direct"],
      ["uploaded-version-1", "version-direct"], ["patched-version-1", "uploaded-version-1"],
      ["patched-version-1", "uploaded-version-1"], ["uploaded-version-2", "patched-version-1"],
    ]);
    expect(wranglerMocks.runWranglerLogged.mock.calls.filter(([args]) => args[0] === "versions").map(([args]) => args[2]))
      .toEqual(["patched-version-1@100%", "uploaded-version-2@100%"]);
    expect(releaseMocks.runSmokeHostedDeploy).toHaveBeenCalledWith(expect.objectContaining({
      source: expect.objectContaining({ HOSTED_EXECUTION_SMOKE_VERSION_ID: "patched-version-1" }),
    }));
    expect(wranglerMocks.runWranglerLoggedCaptured.mock.calls.map(([args]) => args[3]))
      .toEqual(["/tmp/config.jsonc", "/tmp/config.jsonc.promote"]);
  });

  it.each(["before-patch", "intervening", "newer", "same-id", "patch-error", "inventory"])("stops %s secret retirement before pending native mutation or activation", async failure => {
    releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath }) => ({
      configPath, promotionConfigPath: `${configPath}.promote`, activeApplicationName: "serving", workerOnly: false,
      applications: [{ name: "serving", className: "RunnerContainer", applicationId: "serving-app", namespaceId: "serving-namespace", specification: {} }],
      retirements: [{ name: "retired", applicationId: "retired-app", namespaceId: "retired-namespace" }],
    }));
    releaseMocks.readWorkerVersion.mockImplementation(async (_worker, id) => ({ id, resources: { bindings:
      id === "patched-version-1" && failure !== "inventory" ? [] : [{ name: "VENICE_API_KEY", type: "secret_text" }],
    } }));
    const readHistory = releaseMocks.readRecentWorkerVersionIds.getMockImplementation()!;
    releaseMocks.readRecentWorkerVersionIds.mockImplementation(async () => {
      const ids = await readHistory();
      const call = releaseMocks.readRecentWorkerVersionIds.mock.calls.length;
      if (failure === "before-patch" && call === 3) return ["foreign-version", ids[0]];
      if (failure === "intervening" && call === 4) return [ids[0], "foreign-version"];
      if (failure === "newer" && call === 4) return ["foreign-version", ids[0]];
      return ids;
    });
    if (failure === "same-id") releaseMocks.removeRetiredInferenceSecrets.mockReturnValue("uploaded-version-1");
    if (failure === "patch-error") releaseMocks.removeRetiredInferenceSecrets.mockRejectedValue(new Error("patch unavailable"));
    await expect(syntheticDeployment()).rejects.toThrow(failure === "before-patch" ? "changed before secret retirement"
      : failure === "patch-error" ? "patch unavailable" : failure === "inventory" ? "secret inventory differs" : "history changed during secret retirement");
    expect(releaseMocks.removeRetiredInferenceSecrets).toHaveBeenCalledTimes(failure === "before-patch" ? 0 : 1);
    expect(releaseMocks.admitApplication).not.toHaveBeenCalled();
    expect(releaseMocks.retireApplication).not.toHaveBeenCalled();
    expect(wranglerMocks.runWranglerLogged.mock.calls.some(([args]) => args[0] === "versions")).toBe(false);
  });

  it("returns the patched version for a worker-only release", async () => {
    releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath }) => ({
      configPath, promotionConfigPath: configPath, activeApplicationName: "serving", workerOnly: true, applications: [], retirements: [],
    }));
    releaseMocks.readWorkerVersion.mockImplementation(async (_worker, id) => ({ id, resources: { bindings:
      id === "patched-version-1" ? [] : [{ name: "VERCEL_AI_API_KEY", type: "secret_text" }],
    } }));
    await syntheticDeployment("worker-only");
    expect(wranglerMocks.runWranglerLoggedCaptured).toHaveBeenCalledOnce();
    expect(releaseMocks.removeRetiredInferenceSecrets).toHaveBeenCalledOnce();
    expect(wranglerMocks.runWranglerLogged.mock.calls.filter(([args]) => args[0] === "versions").map(([args]) => args[2]))
      .toEqual(["patched-version-1@100%"]);
  });

  it.each(["stage", "promotion"])("stops before %s activation if the uploaded secret inventory changed", async boundary => {
    let reads = 0;
    releaseMocks.readWorkerVersion.mockImplementation(async (_worker, id) => {
      reads += 1;
      return { id, resources: { bindings: reads === (boundary === "stage" ? 2 : 3)
        ? [{ name: "UNEXPECTED_SECRET", type: "secret_text" }] : [] } };
    });
    await expect(syntheticDeployment()).rejects.toThrow("secret inventory differs");
    expect(wranglerMocks.runWranglerLogged.mock.calls.filter(([args]) => args[0] === "versions")).toHaveLength(boundary === "stage" ? 0 : 1);
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
    expect(wranglerMocks.runWranglerLoggedCaptured.mock.calls[0]![0]).toContainEqual("/tmp/config.jsonc");
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
    expect(releaseMocks.readRecentWorkerVersionIds.mock.settledResults.map(result => result.value)).toEqual([
      ["version-direct"], ["uploaded-version-1", "version-direct"],
    ]);
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

async function syntheticDeployment(containerRolloutMode: "gradual" | "immediate" | "worker-only" = "immediate", extraEnv: Record<string, string | undefined> = {}, includeSecrets = false) {
  return runDeployWorkerVersionCli([], {
    deployRoot: "/tmp/repo/apps/cloudflare", log: false,
    env: { CF_WORKER_NAME: "hosted-worker", CF_BUNDLES_BUCKET: "hosted-bundles", CLOUDFLARE_ACCOUNT_ID: "fixture", CLOUDFLARE_API_TOKEN: "fixture", ...extraEnv },
    runHostedWorkerDeployment: async ({ dependencies }) => {
      await dependencies.deployDirect({ configPath: "/tmp/config.jsonc", containerRolloutMode, deploymentMessage: "synthetic", includeSecrets, secretsFilePath: "/tmp/secrets.json", versionTag: "synthetic", workerName: "hosted-worker" });
      return createDeploymentResult();
    },
  });
}

function configureRecoveryUpload() {
  const retained = [{ name: "OPENAI_API_KEY", type: "secret_text" }, { name: "OPTIONAL_SECRET", type: "secret_text" },
    { name: "CRYPTO_KEY", type: "secret_key" }];
  const retired = [{ name: "VENICE_API_KEY", type: "secret_text" }, { name: "VERCEL_AI_API_KEY", type: "secret_text" }];
  const currentVersion = { id: "version-direct", resources: { bindings: [...retained, ...retired] } };
  releaseMocks.readWorkerVersion.mockImplementation(async (_worker, id) => id === "version-direct" ? currentVersion : {
    id, annotations: { "workers/tag": "trusted-upload" }, resources: { bindings: [
      ...retained, ...(id === "patched-version-1" ? [] : retired),
      ...(id === recoveryVersionId ? [] : [{ name: "NEW_SECRET", type: "secret_text" }]),
    ] },
  });
  const readHistory = releaseMocks.readRecentWorkerVersionIds.getMockImplementation()!;
  releaseMocks.readRecentWorkerVersionIds.mockImplementation(async () => {
    const ids: string[] = await readHistory();
    return ids[0] === "version-direct" ? [recoveryVersionId, "version-direct"]
      : ids.map(id => id === "version-direct" ? recoveryVersionId : id);
  });
  releaseMocks.stageHostedRunnerRelease.mockImplementation(async ({ configPath }) => ({
    configPath, promotionConfigPath: configPath, activeApplicationName: "serving", workerOnly: true, applications: [], retirements: [],
  }));
  fileMocks.readFile.mockImplementation(async filePath => String(filePath).endsWith("secrets.json")
    ? JSON.stringify({ OPENAI_API_KEY: "synthetic-rotation", NEW_SECRET: "synthetic-new" })
    : JSON.stringify({ secrets: { required: ["OPENAI_API_KEY", "CRYPTO_KEY"] } }));
  return currentVersion;
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

function syntheticLiveVersion(): string {
  const activation = wranglerMocks.runWranglerLogged.mock.calls.filter(([args]) => args[0] === "versions").at(-1);
  return activation ? activation[0][2].split("@")[0] : "version-direct";
}
