import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareSmallRunnerNamespaceBootstrap, stageHostedRunnerRelease } from "../scripts/stage-runner-release.ts";
import { runnerApplicationSpecification } from "../scripts/runner-release-application.ts";

const oldImage = `registry.example.test/runner@sha256:${"a".repeat(64)}`;
const newImage = `registry.example.test/runner@sha256:${"b".repeat(64)}`;
const active = { bank: "primary", id: "primary-release", image: oldImage,
  bundleFingerprint: "c".repeat(64), sourceFingerprint: "d".repeat(64) };
const classes = ["RunnerContainer", "DeploySmokeRunnerContainer", "SmallRunnerContainer"];
const config = {
  name: "synthetic-worker", observability: { logs: { enabled: true } },
  vars: { HOSTED_EXECUTION_SMALL_RUNNER_ENABLED: "true",
    HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT: "e".repeat(64),
    HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT: "f".repeat(64) },
  durable_objects: { bindings: classes.map(class_name => ({ name: class_name.toUpperCase(), class_name })) },
  migrations: [{ tag: "v9", new_sqlite_classes: ["SmallRunnerContainer"] }],
  containers: classes.map(class_name => ({ class_name, image: newImage,
    instance_type: class_name === "SmallRunnerContainer"
      ? { vcpu: 1, memory_mib: 3072, disk_mb: 6000 } : { vcpu: 2, memory_mib: 6144, disk_mb: 6000 },
    max_instances: class_name === "RunnerContainer" ? 12 : class_name === "SmallRunnerContainer" ? 10 : 1,
    rollout_active_grace_period: 300, rollout_step_percentage: [100], ssh: { enabled: false },
  })),
};

function version(smallNamespace: boolean, candidate: unknown = null) {
  const vars = { HOSTED_EXECUTION_RUNNER_DEPLOYMENT: JSON.stringify({ active, candidate, previous: null }),
    HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT: active.bundleFingerprint,
    HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT: active.sourceFingerprint };
  return { resources: { bindings: [
    ...Object.entries(vars).map(([name, text]) => ({ type: "plain_text", name, text })),
    ...classes.filter(name => smallNamespace || name !== "SmallRunnerContainer")
      .map(class_name => ({ type: "durable_object_namespace", class_name, namespace_id: `ns-${class_name}` })),
  ] } };
}

function native(className: string) {
  return { id: `app-${className}`, name: `synthetic-worker-${className.toLowerCase()}`,
    durable_objects: { namespace_id: `ns-${className}` }, scheduling_policy: "default",
    configuration: { image: oldImage, vcpu: className === "SmallRunnerContainer" ? 1 : 2,
      memory_mib: className === "SmallRunnerContainer" ? 3072 : 6144, disk: { size_mb: 6000 },
      observability: { logs: { enabled: true } }, wrangler_ssh: { enabled: false } },
    max_instances: className === "RunnerContainer" ? 10 : 1,
    constraints: { tiers: [1, 2] }, rollout_active_grace_period: 300,
  };
}
function listApplications(smallExists = false) {
  return async (name: string) => classes.filter(className => (smallExists || className !== "SmallRunnerContainer")
    && name === `synthetic-worker-${className.toLowerCase()}`).map(native);
}

describe("small runner protected deployment", () => {
  let directory: string;
  let configPath: string;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "murph-small-deploy-"));
    configPath = path.join(directory, "config.json");
    await writeFile(configPath, JSON.stringify(config));
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it("provisions only the namespace with routing off and exact serving images and capacities", async () => {
    const output = await prepareSmallRunnerNamespaceBootstrap({ allowed: true, configPath,
      currentVersion: version(false), currentVersionId: "worker-live", listApplications: listApplications() });
    expect(output).not.toBeNull();
    const bootstrap = JSON.parse(await readFile(output!, "utf8"));
    expect(bootstrap.vars.HOSTED_EXECUTION_SMALL_RUNNER_ENABLED).toBe("false");
    expect(JSON.parse(bootstrap.vars.HOSTED_EXECUTION_RUNNER_DEPLOYMENT).active).toEqual(active);
    expect(bootstrap.containers.map((entry: { class_name: string }) => entry.class_name))
      .toEqual(["RunnerContainer", "DeploySmokeRunnerContainer"]);
    expect(bootstrap.containers[0]).toMatchObject({ image: oldImage, max_instances: 10,
      instance_type: { vcpu: 2, memory_mib: 6144, disk_mb: 6000 } });
    expect(bootstrap.containers[1].image).toBe(oldImage);
    expect(bootstrap.durable_objects).toEqual(config.durable_objects);
    expect(bootstrap.migrations).toEqual(config.migrations);
  });

  it("requires explicit provisioning and becomes a no-op once the namespace exists", async () => {
    const input = { allowed: false, configPath, currentVersion: version(false),
      currentVersionId: "worker-live", listApplications: listApplications() };
    await expect(prepareSmallRunnerNamespaceBootstrap(input)).rejects.toThrow("CF_BOOTSTRAP_SMALL_RUNNER=true");
    await expect(prepareSmallRunnerNamespaceBootstrap({ ...input, currentVersion: version(true) })).resolves.toBeNull();
  });

  it("preserves a native image tag during namespace-only provisioning without admitting tagged releases", async () => {
    const image = "registry.example.test/runner:retained-release";
    const output = await prepareSmallRunnerNamespaceBootstrap({ allowed: true, configPath,
      currentVersion: version(false), currentVersionId: "worker-live",
      listApplications: async name => (await listApplications()(name)).map(entry => ({ ...entry,
        configuration: { ...entry.configuration, image } })),
    });
    const bootstrap = JSON.parse(await readFile(output!, "utf8"));
    expect(bootstrap.containers.map((entry: { image: string }) => entry.image)).toEqual([image, image]);
    expect(bootstrap.vars.HOSTED_EXECUTION_SMALL_RUNNER_ENABLED).toBe("false");
    expect(() => runnerApplicationSpecification({ ...config.containers[0], image }, true))
      .toThrow("outside the supported deployment contract");
    expect(() => runnerApplicationSpecification({ ...config.containers[0], image }, true, `${image}-different`))
      .toThrow("outside the supported deployment contract");
    expect(() => runnerApplicationSpecification({ ...config.containers[0], image, max_instances: -1 }, true, image))
      .toThrow("outside the supported deployment contract");
  });

  it("refuses provisioning during an incomplete image transition", async () => {
    await expect(prepareSmallRunnerNamespaceBootstrap({ allowed: true, configPath,
      currentVersion: version(false, { ...active, image: newImage }), currentVersionId: "worker-live",
      listApplications: listApplications() })).rejects.toThrow("candidate release is pending");
  });

  it("does not provision against a mismatched native namespace", async () => {
    await expect(prepareSmallRunnerNamespaceBootstrap({ allowed: true, configPath,
      currentVersion: version(false), currentVersionId: "worker-live",
      listApplications: async name => (await listApplications()(name)).map(entry => ({ ...entry,
        durable_objects: { namespace_id: "ns-unrelated" } })),
    })).rejects.toThrow("authoritative live configuration");
  });

  it.each([false, true])("admits the small image before enabling selection (existing=%s)", async exists => {
    const staged = await stageHostedRunnerRelease({ configPath, currentVersion: version(true),
      currentVersionId: "worker-live", releaseSha: "1".repeat(40), listApplications: listApplications(exists) });
    const small = staged.applications.find(entry => entry.className === "SmallRunnerContainer");
    expect(small).toMatchObject({ applicationId: exists ? "app-SmallRunnerContainer" : null,
      namespaceId: "ns-SmallRunnerContainer", specification: { max_instances: 10,
        configuration: { image: newImage, vcpu: 1, memory_mib: 3072, disk: { size_mb: 6000 } } } });
    const stage = JSON.parse(await readFile(staged.configPath, "utf8"));
    const promotion = JSON.parse(await readFile(staged.promotionConfigPath, "utf8"));
    expect(stage.vars.HOSTED_EXECUTION_SMALL_RUNNER_ENABLED).toBe("false");
    expect(promotion.vars.HOSTED_EXECUTION_SMALL_RUNNER_ENABLED).toBe("true");
    expect(promotion.containers[0].instance_type.vcpu).toBe(2);
  });

  it("retains the small image for worker-only changes but cannot introduce the application", async () => {
    const input = { configPath, currentVersion: version(true), currentVersionId: "worker-live",
      releaseSha: "1".repeat(40), retainServingRunner: true, listApplications: listApplications() };
    await expect(stageHostedRunnerRelease(input)).rejects.toThrow("full container deployment");
    const staged = await stageHostedRunnerRelease({ ...input, listApplications: listApplications(true) });
    expect(staged.applications.map(entry => entry.className)).toEqual(["DeploySmokeRunnerContainer"]);
    const retained = JSON.parse(await readFile(staged.configPath, "utf8"));
    expect(retained.containers[2]).toMatchObject({ image: oldImage,
      instance_type: { vcpu: 1, memory_mib: 3072, disk_mb: 6000 } });
  });
});
