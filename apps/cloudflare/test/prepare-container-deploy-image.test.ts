import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ build: vi.fn(), push: vi.fn() }));
vi.mock("node:child_process", async () => ({ ...await vi.importActual<typeof import("node:child_process")>("node:child_process"), execFile: mocks.build }));
vi.mock("../scripts/wrangler-runner.ts", () => ({ runWranglerLoggedCaptured: mocks.push }));
import { prepareHostedContainerDeployImage } from "../scripts/prepare-container-deploy-image.ts";
import { stageHostedRunnerRelease } from "../scripts/stage-runner-release.ts";
import { runnerApplicationSpecification } from "../scripts/runner-release-application.ts";
import { createRunnerReleaseProvider } from "../scripts/runner-release-provider.ts";
import { writeRunnerBundleManifest, runnerBundleManifestFileName } from "../scripts/deploy-artifacts.ts";

const accountId = "a".repeat(32);
const digest = `sha256:${"b".repeat(64)}`;
let directory: string;
let configPath: string;
const config = {
  name: "synthetic-worker",
  main: "../src/index.ts",
  vars: { HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT: "expected-bundle" },
  containers: ["RunnerContainer", "DeploySmokeRunnerContainer", "StandbyRunnerContainer"].map((className) => ({
    class_name: className,
    image: "../../../Dockerfile.cloudflare-hosted-runner",
    image_build_context: "..",
    max_instances: className === "StandbyRunnerContainer" ? 0 : 1,
  })),
};

describe("container image publication before Worker activation", () => {
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "murph-image-prepublish-"));
    configPath = path.join(directory, "wrangler.generated.jsonc");
    await writeFile(configPath, JSON.stringify(config));
    mocks.build.mockReset();
    mocks.build.mockImplementation((_command, _args, _options, callback) => callback(null, "", ""));
    mocks.push.mockReset();
    mocks.push.mockResolvedValue({ stdout: `prepared: digest: ${digest} size: 1234\n`, stderr: "" });
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it("builds once, publishes once, and pins every fleet to the proven digest without changing other config", async () => {
    const preparedPath = await prepareHostedContainerDeployImage({ accountId, configPath });
    const prepared = JSON.parse(await readFile(preparedPath, "utf8"));
    expect(path.dirname(preparedPath)).toBe(path.dirname(configPath));
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual(config);
    expect(prepared).toEqual({
      ...config,
      containers: config.containers.map(({ image_build_context: _context, ...container }) => ({
        ...container,
        image: `registry.cloudflare.com/${accountId}/synthetic-worker@${digest}`,
      })),
    });
    expect(mocks.build).toHaveBeenCalledOnce();
    expect(mocks.push).toHaveBeenCalledOnce();
    expect(mocks.build.mock.invocationCallOrder[0]).toBeLessThan(mocks.push.mock.invocationCallOrder[0]!);
    const args = mocks.build.mock.calls[0]![1] as string[];
    expect(args).toEqual([
      "build", "--platform", "linux/amd64", "--file",
      path.resolve(directory, config.containers[0]!.image),
      "--tag", expect.stringMatching(/^synthetic-worker:prepared-/u),
      path.resolve(directory, ".."),
    ]);
    expect(mocks.push).toHaveBeenCalledWith(["containers", "push", args[6], "--config", configPath]);
  });

  it("never publishes if the validated image cannot build", async () => {
    mocks.build.mockImplementation((_command, _args, _options, callback) => callback(new Error("synthetic build failure")));
    await expect(prepareHostedContainerDeployImage({ accountId, configPath }))
      .rejects.toThrow("Runner image build failed before Worker activation.");
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it.each(["", `digest: ${digest} size: 1\ndigest: sha256:${"c".repeat(64)} size: 1`])(
    "rejects missing or ambiguous immutable publication evidence", async (stdout) => {
      mocks.push.mockResolvedValue({ stdout, stderr: "" });
      await expect(prepareHostedContainerDeployImage({ accountId, configPath }))
        .rejects.toThrow("did not prove one immutable digest");
    },
  );

  it("fails before build when fleet image inputs differ", async () => {
    await writeFile(configPath, JSON.stringify({ ...config, containers: [
      config.containers[0], { ...config.containers[1], image: "another-dockerfile" },
    ] }));
    await expect(prepareHostedContainerDeployImage({ accountId, configPath }))
      .rejects.toThrow("share one validated image build");
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it.each(["primary", "next"] as const)("builds a full release after Worker-only retention of a legacy %s image", async (bank) => {
    const classes = ["RunnerContainer", "NextRunnerContainer", "DeploySmokeRunnerContainer", "StandbyRunnerContainer"];
    const rendered = { ...config,
      vars: { HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT: "b".repeat(64), HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT: "c".repeat(64) },
      containers: classes.map((class_name) => ({ ...config.containers[0], class_name, instance_type: "standard-1", ssh: { enabled: false }, rollout_active_grace_period: 300 })),
    };
    await writeFile(configPath, JSON.stringify(rendered));
    const active = { bank, id: `${bank}-legacy-retained`, bundleFingerprint: "d".repeat(64), sourceFingerprint: "e".repeat(64) };
    const currentVersion = { resources: { bindings: [
      { type: "plain_text", name: "HOSTED_EXECUTION_RUNNER_DEPLOYMENT", text: JSON.stringify({ active, candidate: null, previous: null }) },
      ...classes.map((class_name) => ({ type: "durable_object_namespace", class_name, namespace_id: `namespace-${class_name}` })),
    ] } };
    const oldImage = "registry.example.test/runner:legacy-tag";
    const listApplications = vi.fn(async (name: string) => [{ id: name, name, max_instances: 1, configuration: { image: oldImage } }]);
    const releaseSha = "1".repeat(40);
    const preparedPath = await prepareHostedContainerDeployImage({ accountId, configPath, release: { currentVersion, releaseSha, listApplications } });
    expect(mocks.build).toHaveBeenCalledOnce();
    expect(mocks.push).toHaveBeenCalledOnce();
    expect(listApplications).not.toHaveBeenCalled(); // Legacy provenance cannot authorize image reuse.
    const staged = await stageHostedRunnerRelease({ configPath: preparedPath, currentVersionId: "worker-retained", currentVersion, releaseSha, listApplications });
    expect(staged.deployment.active).toEqual(active);
    expect(staged.deployment.candidate?.bank).toBe(bank === "primary" ? "next" : "primary");
    expect(staged.deployment.candidate?.releaseSha).toBe(releaseSha);
    expect(staged.workerOnly).toBe(false);
    const servingClass = bank === "primary" ? "RunnerContainer" : "NextRunnerContainer";
    expect(staged.applications.map((entry) => entry.className)).not.toContain(servingClass);
    const stagedConfig = JSON.parse(await readFile(staged.configPath, "utf8"));
    expect(stagedConfig.containers.find((entry: { class_name: string }) => entry.class_name === servingClass).image).toBe(oldImage);
    expect(staged.applications.every((entry) => entry.specification.configuration.image.endsWith(`@${digest}`))).toBe(true);
  });

  it("resumes the admitted image across a real manifest rebuild with different timestamps", async () => {
    const releaseSha = "1".repeat(40);
    const bundleDir = await mkdtemp(path.join(directory, "bundle-"));
    await writeFile(path.join(bundleDir, "entry.js"), "export const synthetic = true;\n");
    const manifestPath = path.join(bundleDir, runnerBundleManifestFileName);
    const manifest = await writeRunnerBundleManifest(bundleDir, { releaseSha, now: () => new Date("2026-01-01T00:00:00Z") });
    const classes = ["RunnerContainer", "NextRunnerContainer", "DeploySmokeRunnerContainer", "StandbyRunnerContainer"];
    const rendered = {
      ...config,
      vars: { HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT: manifest.bundleFingerprint, HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT: manifest.sourceFingerprint },
      containers: classes.map((class_name) => ({ ...config.containers[0], class_name, instance_type: "standard-1", ssh: { enabled: false }, rollout_active_grace_period: 300 })),
    };
    await writeFile(configPath, JSON.stringify(rendered));
    const active = { bank: "primary", id: "primary-old", bundleFingerprint: "a".repeat(64), sourceFingerprint: "b".repeat(64) };
    const version = (deployment: unknown) => ({ resources: { bindings: [
      { type: "plain_text", name: "HOSTED_EXECUTION_RUNNER_DEPLOYMENT", text: JSON.stringify(deployment) },
      ...classes.map((class_name) => ({ type: "durable_object_namespace", class_name, namespace_id: `namespace-${class_name}` })),
    ] } });
    // Docker is a boundary double: COPY includes the actual manifest bytes.
    mocks.push.mockImplementation(async () => ({ stdout: `digest: sha256:${createHash("sha256").update(await readFile(manifestPath)).digest("hex")} size: 1234`, stderr: "" }));
    const listPrevious = async (name: string) => [{ id: name, name, max_instances: 1, configuration: { image: `registry.example.test/old@sha256:${"a".repeat(64)}` } }];
    const firstImage = await prepareHostedContainerDeployImage({ accountId, configPath });
    const first = await stageHostedRunnerRelease({ configPath: firstImage, currentVersionId: "worker-old", currentVersion: version({ active, candidate: null, previous: null }), releaseSha, listApplications: listPrevious });
    const prepared = JSON.parse(await readFile(firstImage, "utf8"));
    const specification = runnerApplicationSpecification(prepared.containers[1], false);
    const listApplications = async (name: string) => [{
      ...specification, id: name, name,
      durable_objects: { namespace_id: `namespace-${classes.find((className) => name === `${config.name}-${className}`.toLowerCase())}` },
    }];
    const currentVersion = version(first.deployment);
    const rebuilt = await writeRunnerBundleManifest(bundleDir, { releaseSha, now: () => new Date("2026-01-02T00:00:00Z") });
    expect(rebuilt.generatedAt).not.toBe(manifest.generatedAt);
    expect(rebuilt.bundleFingerprint).toBe(manifest.bundleFingerprint);
    expect(rebuilt.sourceFingerprint).toBe(manifest.sourceFingerprint);
    const changedImage = await prepareHostedContainerDeployImage({ accountId, configPath });
    await expect(stageHostedRunnerRelease({ configPath: changedImage, currentVersionId: "worker-staged", currentVersion, releaseSha, listApplications })).rejects.toThrow("different candidate");
    mocks.build.mockClear();
    mocks.push.mockClear();
    const resumedImage = await prepareHostedContainerDeployImage({ accountId, configPath, release: { currentVersion, releaseSha, listApplications } });
    expect(JSON.parse(await readFile(resumedImage, "utf8")).containers).toEqual(prepared.containers);
    const resumed = await stageHostedRunnerRelease({ configPath: resumedImage, currentVersionId: "worker-staged", currentVersion, releaseSha, listApplications });
    expect(resumed.deployment).toEqual(first.deployment);
    expect(resumed.applications).toEqual([]);
    expect(resumed.workerOnly).toBe(false); // The caller must still smoke before promotion.
    expect(resumed.deployment.candidate?.releaseSha).toBe(releaseSha);
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();

    const promotedVersion = version({ active: first.deployment.candidate, candidate: null, previous: active });
    const unchangedImage = await prepareHostedContainerDeployImage({ accountId, configPath, release: { currentVersion: promotedVersion, releaseSha, listApplications } });
    const unchanged = await stageHostedRunnerRelease({ configPath: unchangedImage, currentVersionId: "worker-promoted", currentVersion: promotedVersion, releaseSha, listApplications });
    expect(unchanged.workerOnly).toBe(true);
    expect(unchanged.applications).toEqual([]);

    for (const changed of [
      { ...rendered, vars: { ...rendered.vars, HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT: "0".repeat(64) } },
      { ...rendered, containers: rendered.containers.map((entry) => ({ ...entry, max_instances: 2 })) },
    ]) {
      await writeFile(configPath, JSON.stringify(changed));
      await expect(prepareHostedContainerDeployImage({ accountId, configPath, release: { currentVersion, releaseSha, listApplications } })).rejects.toThrow("different candidate");
    }
    await writeFile(configPath, JSON.stringify(rendered));
    await expect(prepareHostedContainerDeployImage({ accountId, configPath, release: { currentVersion, releaseSha: "2".repeat(40), listApplications } })).rejects.toThrow("different candidate");
    await expect(prepareHostedContainerDeployImage({ accountId, configPath, release: { currentVersion, releaseSha, listApplications: async (name) => (await listApplications(name)).map((entry) => ({ ...entry, durable_objects: { namespace_id: "wrong-namespace" } })) } })).rejects.toThrow("authoritative live configuration");
    expect(mocks.build).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("reconciles a committed native create whose response was lost before legacy staging was replaced", async () => {
    const releaseSha = "1".repeat(40);
    const classes = ["RunnerContainer", "NextRunnerContainer", "DeploySmokeRunnerContainer", "StandbyRunnerContainer"];
    const rendered = { ...config,
      vars: { HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT: "b".repeat(64), HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT: "c".repeat(64) },
      containers: classes.map((class_name) => ({ ...config.containers[0], class_name, instance_type: "standard-1", ssh: { enabled: false }, rollout_active_grace_period: 300 })),
    };
    await writeFile(configPath, JSON.stringify(rendered));
    const active = { bank: "primary", id: "primary-old", bundleFingerprint: "d".repeat(64), sourceFingerprint: "e".repeat(64) };
    // Exact legacy record shape emitted by the shipped pre-admission staging writer.
    const legacy = { active, previous: null, candidate: { bank: "next", id: "next-legacy", bundleFingerprint: "f".repeat(64), sourceFingerprint: "a".repeat(64) } };
    const currentVersion = { resources: { bindings: [
      { type: "plain_text", name: "HOSTED_EXECUTION_RUNNER_DEPLOYMENT", text: JSON.stringify(legacy) },
      ...classes.map((class_name) => ({ type: "durable_object_namespace", class_name, namespace_id: `namespace-${class_name}` })),
    ] } };
    const native = new Map<string, Record<string, unknown>>(classes.filter((className) => className !== "NextRunnerContainer").map((className) => {
      const name = `${config.name}-${className}`.toLowerCase();
      return [name, { id: name, name, max_instances: 1, configuration: { image: `registry.example.test/old@sha256:${"a".repeat(64)}` } }];
    }));
    const servingBefore = JSON.stringify(native.get(`${config.name}-runnercontainer`));
    const listApplications = async (name: string) => native.has(name) ? [native.get(name)] : [];
    const calls: string[] = [];
    const provider = createRunnerReleaseProvider({ accountId, apiToken: "synthetic-token", fetchImpl: async (url, init) => {
      const pathname = new URL(String(url)).pathname;
      const method = init?.method ?? "GET";
      calls.push(`${method} ${pathname.split("/").at(-1)}`);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (method === "POST" && pathname.endsWith("/applications")) {
        native.set(body.name, { ...body, id: body.name });
        throw new Error("synthetic lost native-create response");
      }
      const id = pathname.split("/").at(-1)!;
      if (method === "PATCH") native.set(id, { ...native.get(id), ...body });
      const result = pathname.endsWith("/instances") ? { instances: [] } : native.get(id) ?? { id: "synthetic-rollout" };
      return Response.json({ success: true, result });
    } });
    const prepare = async () => stageHostedRunnerRelease({
      configPath: await prepareHostedContainerDeployImage({ accountId, configPath, release: { currentVersion, releaseSha, listApplications } }),
      currentVersionId: "legacy-staging-worker", currentVersion, releaseSha, listApplications,
    });
    const first = await prepare();
    const application = first.applications[0]!;
    expect(application.applicationId).toBeNull();
    await expect(provider.admitApplication(application)).rejects.toThrow("Authoritative runner release state is unavailable");
    expect(native.has(application.name)).toBe(true);
    const retry = await prepare();
    expect(retry.deployment.active).toEqual(active);
    expect(retry.deployment.candidate?.id).not.toBe(legacy.candidate.id);
    expect(retry.workerOnly).toBe(false);
    expect(retry.applications.some((entry) => entry.name === retry.activeApplicationName)).toBe(false);
    const retryApplication = retry.applications[0]!;
    expect(retryApplication.applicationId).toBe(application.name);
    await provider.assertDrained(retryApplication.applicationId!);
    await provider.admitApplication(retryApplication);
    await provider.assertApplicationReady({ ...retryApplication, listApplications });
    expect(calls.filter((entry) => entry === "POST applications")).toHaveLength(1);
    expect(calls.slice(-4)).toEqual([`GET instances`, `GET ${application.name}`, `PATCH ${application.name}`, "POST rollouts"]);
    expect(JSON.stringify(native.get(`${config.name}-runnercontainer`))).toBe(servingBefore);
    expect(currentVersion.resources.bindings[0]).toMatchObject({ text: JSON.stringify(legacy) });
  });
});
