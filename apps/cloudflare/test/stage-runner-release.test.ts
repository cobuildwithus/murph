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
  containers: classes.map((class_name) => ({ class_name, image, max_instances: class_name === "DeploySmokeRunnerContainer" ? 1 : class_name === "RunnerContainer" ? 12 : 0, instance_type: "standard-1", ssh: { enabled: false }, rollout_active_grace_period: 300 })),
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
  durable_objects: { namespace_id: `namespace-${classes.find(value => name.endsWith(`-${value.toLowerCase()}`))}` },
  max_instances: name.endsWith("-deploysmokerunnercontainer") ? 1 : 10, constraints: { regions: ["ENAM"] }, rollout_active_grace_period: 300,
}];

describe("runner deployment staging", () => {
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "murph-release-stage-"));
    await writeFile(path.join(directory, "source.json"), JSON.stringify(config));
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it.each([false, true])("keeps the released capacity within one member fleet (reversed=%s)", async (reversed) => {
    const active = reversed ? next : primary;
    const previous = reversed ? primary : next;
    await writeFile(path.join(directory, "source.json"), JSON.stringify({ ...config,
      containers: config.containers.map((entry) => ({ ...entry,
        max_instances: entry.class_name === "DeploySmokeRunnerContainer" ? 1
          : entry.class_name === "StandbyRunnerContainer" ? 0 : 748,
      })),
    }));
    const staged = await stageHostedRunnerRelease({ releaseSha: "1".repeat(40),
      configPath: path.join(directory, "source.json"), currentVersionId: "worker-live",
      currentVersion: version({ active, candidate: null, previous }),
      listApplications: async (name) => (await listApplications(name)).map((entry) => ({ ...entry,
        max_instances: name.endsWith("-deploysmokerunnercontainer") ? 1
          : name.endsWith("-standbyrunnercontainer") ? 0 : 324,
      })),
    });
    const released: { containers: Array<{ max_instances: number }> } = JSON.parse(
      await readFile(staged.promotionConfigPath, "utf8"),
    );
    expect(released.containers.reduce((total, entry) => total + entry.max_instances, 0)).toBe(749);
  });

  it.each([false, true])("keeps allocation identity while preparing an image in the serving namespace (reversed=%s)", async (reversed) => {
    const active = reversed ? next : primary;
    const previous = reversed ? primary : next;
    const staged = await stageHostedRunnerRelease({ releaseSha: "1".repeat(40),
      configPath: path.join(directory, "source.json"), currentVersionId: "worker-live",
      currentVersion: version({ active, candidate: null, previous }), listApplications,
    });
    const stage = JSON.parse(await readFile(staged.configPath, "utf8"));
    const promotion = JSON.parse(await readFile(staged.promotionConfigPath, "utf8"));
    const activeClass = reversed ? "NextRunnerContainer" : "RunnerContainer";
    const inactiveClass = reversed ? "RunnerContainer" : "NextRunnerContainer";
    expect(staged.applications.map((entry) => entry.className)).toEqual(["DeploySmokeRunnerContainer", activeClass]);
    expect(staged.retirements).toEqual([expect.objectContaining({ name: `synthetic-worker-${inactiveClass.toLowerCase()}` })]);
    expect(preparedIdentity(staged.deployment.candidate)).toEqual(preparedIdentity(active));
    expect(staged.applications[0]?.specification.configuration.image).toBe(image);
    const prepared = JSON.parse(stage.vars.HOSTED_EXECUTION_RUNNER_DEPLOYMENT);
    const promoted = JSON.parse(promotion.vars.HOSTED_EXECUTION_RUNNER_DEPLOYMENT);
    expect(prepared.active).toEqual(active);
    expect(promoted).toEqual({ active: prepared.candidate, candidate: null, previous });
    expect(promotion.containers).toEqual(stage.containers);
    expect(staged.applications[0]?.applicationId).toContain("id-");
  });

  it("bootstraps from the existing Worker fingerprint without changing its release identity", async () => {
    const staged = await stageHostedRunnerRelease({ releaseSha: "1".repeat(40),
      configPath: path.join(directory, "source.json"), currentVersionId: "worker-live",
      currentVersion: version(),
      listApplications: async (name) => name.endsWith("-nextrunnercontainer") ? [] : listApplications(name),
    });
    expect(staged.deployment.active).toEqual({ ...primary, id: "worker-live" });
    expect(staged.deployment.candidate?.bank).toBe("primary");
    expect(staged.deployment.candidate?.id).toBe("worker-live");
    expect(staged.retirements).toEqual([]);
  });

  it("preserves allocation identity for an identical image with a changed capacity ceiling", async () => {
    const specification = runnerApplicationSpecification(config.containers[0]!, false);
    const active = { ...primary, releaseSha: "1".repeat(40), bundleFingerprint: config.vars.HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT, sourceFingerprint: config.vars.HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT, executionIdentity: runnerApplicationExecutionIdentity(specification) };
    const deployment = { active, candidate: null, previous: next };
    const staged = await stageHostedRunnerRelease({ releaseSha: "1".repeat(40), configPath: path.join(directory, "source.json"), currentVersionId: "new-worker-attempt", currentVersion: version(deployment), listApplications: async (name) => (await listApplications(name)).map(entry => ({ ...entry, ...specification, max_instances: name.endsWith("-deploysmokerunnercontainer") ? 1 : 10 })) });
    expect(staged.workerOnly).toBe(false);
    expect(staged.applications.map(entry => entry.className)).toEqual(["DeploySmokeRunnerContainer", "RunnerContainer"]);
    expect(staged.deployment).toEqual(deployment);
  });

  it("resumes the exact pending candidate and rejects a conflicting admitted image", async () => {
    const first = await stageHostedRunnerRelease({ releaseSha: "1".repeat(40), configPath: path.join(directory, "source.json"), currentVersionId: "worker-live", currentVersion: version(), listApplications });
    const second = await stageHostedRunnerRelease({ releaseSha: "1".repeat(40), configPath: path.join(directory, "source.json"), currentVersionId: "staged-worker", currentVersion: version(first.deployment), listApplications });
    expect(second.deployment).toEqual(first.deployment);
    await writeFile(path.join(directory, "source.json"), JSON.stringify({ ...config, vars: { ...config.vars, HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT: "a".repeat(64) } }));
    await expect(stageHostedRunnerRelease({ releaseSha: "1".repeat(40), configPath: path.join(directory, "source.json"), currentVersionId: "staged-worker", currentVersion: version(first.deployment), listApplications })).rejects.toThrow("different candidate");
  });

  it("reuses already admitted pending inventory after an interrupted staging smoke", async () => {
    const first = await stageHostedRunnerRelease({ releaseSha: "1".repeat(40), configPath: path.join(directory, "source.json"), currentVersionId: "worker-live", currentVersion: version(), listApplications });
    const specification = runnerApplicationSpecification(config.containers[0]!, false);
    const resumed = await stageHostedRunnerRelease({ releaseSha: "1".repeat(40), configPath: path.join(directory, "source.json"), currentVersionId: "staged-worker", currentVersion: version(first.deployment), listApplications: async (name) => (await listApplications(name)).map(entry => ({ ...entry, ...specification, max_instances: name.endsWith("-deploysmokerunnercontainer") ? 1 : 10 })) });
    expect(resumed.deployment).toEqual(first.deployment);
    expect(resumed.applications.map(entry => entry.className)).toEqual(["DeploySmokeRunnerContainer", "RunnerContainer"]);
    expect(resumed.workerOnly).toBe(false);
  });

  it.each([false, true])("retains the serving fleet across artifact changes (reversed=%s)", async (reversed) => {
    const active = reversed ? next : primary;
    const previous = reversed ? primary : next;
    const retainedConfig = { ...config, containers: config.containers.map((entry) => ({
      ...entry, max_instances: entry.class_name === "DeploySmokeRunnerContainer" ? 1 : 12,
    })) };
    await writeFile(path.join(directory, "source.json"), JSON.stringify(retainedConfig));
    const staged = await stageHostedRunnerRelease({
      releaseSha: "2".repeat(40), retainServingRunner: true,
      configPath: path.join(directory, "source.json"), currentVersionId: "worker-live",
      currentVersion: version({ active, candidate: null, previous }),
      listApplications: async (name) => (await listApplications(name)).map((entry) => ({
        ...entry, max_instances: name.endsWith("-deploysmokerunnercontainer") ? 1 : 10,
      })),
    });
    const effective = JSON.parse(await readFile(staged.promotionConfigPath, "utf8"));
    expect(staged.workerOnly).toBe(true);
    expect(staged.deployment).toEqual({ active, candidate: null, previous });
    expect(staged.applications.map((entry) => entry.className)).toEqual(["DeploySmokeRunnerContainer"]);
    expect(staged.applications[0]?.specification.max_instances).toBe(1);
    expect(effective.containers.filter((entry: { class_name: string }) => entry.class_name !== "DeploySmokeRunnerContainer"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ max_instances: 10, image: "registry.example.test/previous@sha256:old" })]));
    expect(effective.containers.filter((entry: { class_name: string }) => entry.class_name !== "DeploySmokeRunnerContainer")
      .every((entry: { max_instances: number; image: string }) => entry.max_instances === 10 && entry.image !== image)).toBe(true);
  });

  it.each([false, true])("preserves the pending compatibility pair on a Worker-only release (exists=%s)", async (exists) => {
    await writeFile(path.join(directory, "source.json"), JSON.stringify({ ...config,
      containers: config.containers.map((entry) => ({ ...entry, max_instances: entry.class_name === "DeploySmokeRunnerContainer" ? 1 : 12 })),
    }));
    const staged = await stageHostedRunnerRelease({
      releaseSha: "2".repeat(40), retainServingRunner: true,
      configPath: path.join(directory, "source.json"), currentVersionId: "worker-live",
      currentVersion: version({ active: primary, candidate: next, previous: null }),
      listApplications: async (name) => !exists && name.endsWith("-nextrunnercontainer") ? []
        : (await listApplications(name)).map((entry) => ({ ...entry, max_instances: name.endsWith("-deploysmokerunnercontainer") ? 1 : 10 })),
    });
    expect(staged.deployment).toEqual({ active: primary, candidate: next, previous: null });
    const effective = JSON.parse(await readFile(staged.configPath, "utf8"));
    expect(effective.containers.some((entry: { class_name: string }) => entry.class_name === "NextRunnerContainer")).toBe(exists);
    expect(staged.applications.map((entry) => entry.className)).toEqual(["DeploySmokeRunnerContainer"]);
  });

  it("refuses a Worker-only release that would expand the smoke application", async () => {
    await writeFile(path.join(directory, "source.json"), JSON.stringify({ ...config, containers: config.containers.map(entry => ({ ...entry, max_instances: 12 })) }));
    await expect(stageHostedRunnerRelease({ releaseSha: "2".repeat(40), retainServingRunner: true,
      configPath: path.join(directory, "source.json"), currentVersionId: "worker-live",
      currentVersion: version({ active: primary, candidate: null, previous: null }), listApplications,
    })).rejects.toThrow("authoritative live configuration");
  });

  it("requires preexisting namespace bindings before a native candidate can be created", async () => {
    const currentVersion = version();
    currentVersion.resources.bindings = currentVersion.resources.bindings.filter((binding) => !("class_name" in binding && binding.class_name === "NextRunnerContainer"));
    await expect(stageHostedRunnerRelease({ releaseSha: "1".repeat(40), configPath: path.join(directory, "source.json"), currentVersionId: "worker-live", currentVersion, listApplications })).rejects.toThrow("authoritative live configuration");
  });

  it("fails closed when the live target's image identity cannot be established", async () => {
    await expect(stageHostedRunnerRelease({ releaseSha: "1".repeat(40),
      configPath: path.join(directory, "source.json"), currentVersionId: "worker-live",
      currentVersion: version(), listApplications: async () => [],
    })).rejects.toThrow("authoritative live configuration");
  });
});

function preparedIdentity(release: { bank: string; id: string } | null) { return release && { bank: release.bank, id: release.id }; }
