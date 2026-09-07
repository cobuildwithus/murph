import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stageHostedRunnerRelease } from "../scripts/stage-runner-release.ts";

let directory: string;
const primary = { bank: "primary", id: "primary-old", bundleFingerprint: "a".repeat(64), sourceFingerprint: "b".repeat(64) };
const next = { bank: "next", id: "next-old", bundleFingerprint: "c".repeat(64), sourceFingerprint: "d".repeat(64) };
const classes = ["RunnerContainer", "NextRunnerContainer", "DeploySmokeRunnerContainer", "StandbyRunnerContainer"];
const image = `registry.cloudflare.com/${"a".repeat(32)}/synthetic@sha256:${"e".repeat(64)}`;
const config = {
  name: "synthetic-worker", main: "../src/index.ts",
  vars: { HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT: "e".repeat(64), HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT: "f".repeat(64) },
  containers: classes.map((class_name) => ({ class_name, image, max_instances: 12, instance_type: "standard-1" })),
};
function version(deployment?: unknown) {
  const vars: Record<string, string> = {
    HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT: primary.bundleFingerprint,
    HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT: primary.sourceFingerprint,
    ...(deployment ? { HOSTED_EXECUTION_RUNNER_DEPLOYMENT: JSON.stringify(deployment) } : {}),
  };
  return { resources: { bindings: Object.entries(vars).map(([name, text]) => ({ name, text, type: "plain_text" })) } };
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
    expect(stage.containers.find((entry: { class_name: string }) => entry.class_name === activeClass))
      .toMatchObject({ image: "registry.example.test/previous@sha256:old", max_instances: 10, rollout_kind: "none" });
    expect(stage.containers.find((entry: { class_name: string }) => entry.class_name === candidateClass))
      .toMatchObject({ image, max_instances: 12 });
    const prepared = JSON.parse(stage.vars.HOSTED_EXECUTION_RUNNER_DEPLOYMENT);
    const promoted = JSON.parse(promotion.vars.HOSTED_EXECUTION_RUNNER_DEPLOYMENT);
    expect(prepared.active).toEqual(active);
    expect(promoted).toEqual({ active: prepared.candidate, candidate: null, previous: active });
    expect(promotion.containers).toEqual(stage.containers.map((entry: Record<string, unknown>) => ({ ...entry, rollout_kind: "none" })));
    expect(staged.mustDrainCandidate).toBe(true);
  });

  it("bootstraps from the existing Worker fingerprint without changing its release identity", async () => {
    const staged = await stageHostedRunnerRelease({
      configPath: path.join(directory, "source.json"), currentVersionId: "worker-live",
      currentVersion: version(),
      listApplications: async (name) => name.endsWith("-nextrunnercontainer") ? [] : listApplications(name),
    });
    expect(staged.deployment.active).toEqual({ ...primary, id: "worker-live" });
    expect(staged.deployment.candidate?.bank).toBe("next");
    expect(staged.mustDrainCandidate).toBe(false);
    expect(staged.candidateApplicationId).toBeNull();
  });

  it("fails closed when the live target's image identity cannot be established", async () => {
    await expect(stageHostedRunnerRelease({
      configPath: path.join(directory, "source.json"), currentVersionId: "worker-live",
      currentVersion: version(), listApplications: async () => [],
    })).rejects.toThrow("authoritative live configuration");
  });
});
