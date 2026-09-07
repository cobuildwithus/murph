import { describe, expect, it } from "vitest";
import { runnerApplicationExecutionIdentity, runnerApplicationSpecification } from "../scripts/runner-release-application.ts";

const container = {
  image: `registry.example.test/runner@sha256:${"a".repeat(64)}`,
  instance_type: { vcpu: 2, memory_mib: 4096, disk_mb: 6000 },
  max_instances: 12, ssh: { enabled: false }, rollout_active_grace_period: 300,
};

describe("rendered runner to native application contract", () => {
  it("preserves custom CPU, memory, decimal disk sizing, placement and capacity", () => {
    expect(runnerApplicationSpecification(container, true)).toEqual({
      configuration: { image: container.image, vcpu: 2, memory_mib: 4096, disk: { size_mb: 6000 }, observability: { logs: { enabled: true } }, wrangler_ssh: { enabled: false } },
      constraints: { tiers: [1, 2] }, scheduling_policy: "default", instances: 0,
      max_instances: 12, rollout_active_grace_period: 300,
    });
    expect(runnerApplicationSpecification({ ...container, constraints: { regions: ["ENAM"] } }, true).constraints).toEqual({ tiers: [1, 2], regions: ["ENAM"] });
  });

  it.each([
    { image: "mutable-image:latest" },
    { instance_type: { vcpu: 0, memory_mib: 4096, disk_mb: 6000 } },
    { constraints: { cities: ["example"] } },
    { ssh: { enabled: true } },
    { max_instances: -1 },
    { configuration: { image: "override" } },
  ])("rejects unsupported or incomplete execution configuration before admission: %j", (override) => {
    expect(() => runnerApplicationSpecification({ ...container, ...override }, true)).toThrow("supported deployment contract");
  });

  it("keeps image and resource changes in execution identity, excluding namespace and attempt names", () => {
    const identity = runnerApplicationExecutionIdentity(runnerApplicationSpecification(container, true));
    expect(runnerApplicationExecutionIdentity(runnerApplicationSpecification({ ...container, class_name: "NextRunnerContainer", name: "another-bank" }, true))).toBe(identity);
    for (const override of [
      { image: `registry.example.test/runner@sha256:${"b".repeat(64)}` },
      { max_instances: 13 },
      { instance_type: { ...container.instance_type, vcpu: 4 } },
    ]) expect(runnerApplicationExecutionIdentity(runnerApplicationSpecification({ ...container, ...override }, true))).not.toBe(identity);
  });
});
