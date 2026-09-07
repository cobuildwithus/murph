import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runnerApplicationExecutionIdentity, runnerApplicationSpecification } from "../scripts/runner-release-application.ts";
import { stageHostedRunnerRelease } from "../scripts/stage-runner-release.ts";

let directory: string;
const primary = { bank: "primary", id: "primary-old", bundleFingerprint: "a".repeat(64), sourceFingerprint: "b".repeat(64) };
const next = { bank: "next", id: "next-old", bundleFingerprint: "c".repeat(64), sourceFingerprint: "d".repeat(64) };
const classes = ["RunnerContainer", "NextRunnerContainer", "DeploySmokeRunnerContainer", "StandbyRunnerContainer"];
const image = `registry.cloudflare.com/${"a".repeat(32)}/synthetic@sha256:${"e".repeat(64)}`;
const config = {
  name: "synthetic-worker", main: "../src/index.ts",
  vars: { HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT: "e".repeat(64), HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT: "f".repeat(64) },
  containers: classes.map((class_name) => ({ class_name, image, max_instances: 12, instance_type: "standard-1", ssh: { enabled: false }, rollout_active_grace_period: 300 })),
};
function version(deployment?: unknown) {
  const vars: Record<string, string> = {
    HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT: primary.bundleFingerprint,
    HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT: primary.sourceFingerprint,
    ...(deployment ? { HOSTED_EXECUTION_RUNNER_DEPLOYMENT: JSON.stringify(deployment) } : {}),
  };
  return { resources: { bindings: [...Object.entries(vars).map(([name, text]) => ({ name, text, type: "plain_text" })), ...classes.map((class_name) => ({ type: "durable_object_namespace", class_name, namespace_id: `namespace-${class_name}` }))] } };
}
const listApplications = async (name: string) => [{
  id: `id-${name}`, name,
  configuration: { image: "registry.example.test/previous@sha256:old", vcpu: 2, memory_mib: 4096, disk: { size_mb: 6000 } },
  max_instances: 10, constraints: { regions: ["ENAM"] }, rollout_active_grace_period: 300,
}];

describe("runner deployment staging", () => {
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "murph-release-stage-"));
    await writeFile(path.join(directory, "source.json"), JSON.stringify(config));
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it.each([false, true])("freezes the live application while preparing the opposite target (reversed=%s)", async (reversed) => {
    const active = reversed ? next : primary;
    const previous = reversed ? primary : next;
    const staged = await stageHostedRunnerRelease({
      configPath: path.join(directory, "source.json"), currentVersionId: "worker-live",
      currentVersion: version({ active, candidate: null, previous }), listApplications,
    });
    const stage = JSON.parse(await readFile(staged.configPath, "utf8"));
    const promotion = JSON.parse(await readFile(staged.promotionConfigPath, "utf8"));
    const activeClass = reversed ? "NextRunnerContainer" : "RunnerContainer";
    const candidateClass = reversed ? "RunnerContainer" : "NextRunnerContainer";
    expect(staged.applications.map((entry) => entry.className)).toEqual([candidateClass, "DeploySmokeRunnerContainer"]);
    expect(staged.applications.some((entry) => entry.className === activeClass)).toBe(false);
    expect(staged.applications[0]?.specification.configuration.image).toBe(image);
    const prepared = JSON.parse(stage.vars.HOSTED_EXECUTION_RUNNER_DEPLOYMENT);
    const promoted = JSON.parse(promotion.vars.HOSTED_EXECUTION_RUNNER_DEPLOYMENT);
    expect(prepared.active).toEqual(active);
    expect(promoted).toEqual({ active: prepared.candidate, candidate: null, previous: active });
    expect(promotion.containers).toEqual(stage.containers);
    expect(staged.applications[0]?.applicationId).toContain("id-");
  });

  it("bootstraps from the existing Worker fingerprint without changing its release identity", async () => {
    const staged = await stageHostedRunnerRelease({
      configPath: path.join(directory, "source.json"), currentVersionId: "worker-live",
      currentVersion: version(),
      listApplications: async (name) => name.endsWith("-nextrunnercontainer") ? [] : listApplications(name),
    });
    expect(staged.deployment.active).toEqual({ ...primary, id: "worker-live" });
    expect(staged.deployment.candidate?.bank).toBe("next");
    expect(staged.applications[0]?.applicationId).toBeNull();
  });

  it("preserves release identity and skips native mutations for an identical execution image", async () => {
    const specification = runnerApplicationSpecification(config.containers[0]!, false);
    const active = { ...primary, bundleFingerprint: config.vars.HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT, sourceFingerprint: config.vars.HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT, executionIdentity: runnerApplicationExecutionIdentity(specification) };
    const deployment = { active, candidate: null, previous: next };
    const staged = await stageHostedRunnerRelease({ configPath: path.join(directory, "source.json"), currentVersionId: "new-worker-attempt", currentVersion: version(deployment), listApplications: async (name) => [{ ...specification, id: `id-${name}`, name }] });
    expect(staged.workerOnly).toBe(true);
    expect(staged.applications).toEqual([]);
    expect(staged.deployment).toEqual(deployment);
  });

  it("resumes the exact pending candidate and rejects a conflicting admitted image", async () => {
    const first = await stageHostedRunnerRelease({ configPath: path.join(directory, "source.json"), currentVersionId: "worker-live", currentVersion: version(), listApplications });
    const second = await stageHostedRunnerRelease({ configPath: path.join(directory, "source.json"), currentVersionId: "staged-worker", currentVersion: version(first.deployment), listApplications });
    expect(second.deployment).toEqual(first.deployment);
    await writeFile(path.join(directory, "source.json"), JSON.stringify({ ...config, vars: { ...config.vars, HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT: "a".repeat(64) } }));
    await expect(stageHostedRunnerRelease({ configPath: path.join(directory, "source.json"), currentVersionId: "staged-worker", currentVersion: version(first.deployment), listApplications })).rejects.toThrow("different candidate");
  });

  it("reuses already admitted pending inventory after an interrupted staging smoke", async () => {
    const first = await stageHostedRunnerRelease({ configPath: path.join(directory, "source.json"), currentVersionId: "worker-live", currentVersion: version(), listApplications });
    const specification = runnerApplicationSpecification(config.containers[0]!, false);
    const resumed = await stageHostedRunnerRelease({ configPath: path.join(directory, "source.json"), currentVersionId: "staged-worker", currentVersion: version(first.deployment), listApplications: async (name) => [{ ...specification, id: `id-${name}`, name }] });
    expect(resumed.deployment).toEqual(first.deployment);
    expect(resumed.applications).toEqual([]);
    expect(resumed.workerOnly).toBe(false);
  });

  it("requires preexisting namespace bindings before a native candidate can be created", async () => {
    const currentVersion = version();
    currentVersion.resources.bindings = currentVersion.resources.bindings.filter((binding) => !("class_name" in binding && binding.class_name === "NextRunnerContainer"));
    await expect(stageHostedRunnerRelease({ configPath: path.join(directory, "source.json"), currentVersionId: "worker-live", currentVersion, listApplications })).rejects.toThrow("authoritative live configuration");
  });

  it("fails closed when the live target's image identity cannot be established", async () => {
    await expect(stageHostedRunnerRelease({
      configPath: path.join(directory, "source.json"), currentVersionId: "worker-live",
      currentVersion: version(), listApplications: async () => [],
    })).rejects.toThrow("authoritative live configuration");
  });
});
