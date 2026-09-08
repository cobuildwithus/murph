import { createHash } from "node:crypto";
import { isObjectRecord } from "./deploy-automation/shared.ts";

/** The deployed renderer's explicit native configuration, shared by identity and admission. */
export function runnerApplicationSpecification(container: Record<string, unknown>, logsEnabled: boolean) {
  const image = container.image;
  const size = container.instance_type;
  if (typeof image !== "string" || !/@sha256:[a-f0-9]{64}$/u.test(image)
    || !Number.isSafeInteger(container.max_instances) || Number(container.max_instances) < 0) throw invalid();
  const resources = typeof size === "string" ? { instance_type: size }
    : isObjectRecord(size) ? {
      vcpu: positive(size.vcpu), memory_mib: positive(size.memory_mib), disk: { size_mb: positive(size.disk_mb) },
    } : null;
  if (!resources || container.scheduling_policy !== undefined || container.affinities !== undefined
    || container.configuration !== undefined || container.authorized_keys !== undefined
    || container.trusted_user_ca_keys !== undefined) throw invalid();
  const constraints = runnerApplicationConstraints(container.constraints);
  const ssh = container.ssh;
  if (!isObjectRecord(ssh) || ssh.enabled !== false || Object.keys(ssh).length !== 1) throw invalid();
  const grace = container.rollout_active_grace_period;
  if (!Number.isSafeInteger(grace) || Number(grace) < 0) throw invalid();
  return {
    scheduling_policy: "default",
    configuration: {
      image, ...resources, observability: { logs: { enabled: logsEnabled } }, wrangler_ssh: { enabled: false },
    },
    max_instances: Number(container.max_instances),
    constraints,
    rollout_active_grace_period: Number(grace),
  };
}

export type RunnerApplicationSpecification = ReturnType<typeof runnerApplicationSpecification>;

export function runnerApplicationExecutionIdentity(specification: RunnerApplicationSpecification): string {
  return createHash("sha256").update(JSON.stringify(specification)).digest("hex");
}

/** Compare only requested native fields; provider timestamps and defaults are not release identity. */
export function runnerApplicationMatches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(actual)
    && actual.length === expected.length && expected.every((value, index) => runnerApplicationMatches(actual[index], value));
  if (isObjectRecord(expected)) {
    if (!isObjectRecord(actual)) return false;
    const desired = expandNamedConfiguration(expected);
    const observed = expandNamedConfiguration(actual);
    return Object.entries(desired).every(([key, value]) => runnerApplicationMatches(observed[key], value));
  }
  return actual === expected;
}

// Pinned Wrangler 4.90's native preset sizes. The API returns expanded resources.
const NATIVE_PRESETS: Readonly<Record<string, readonly [number, number, number]>> = {
  lite: [0.0625, 256, 2000], dev: [0.0625, 256, 2000], basic: [0.25, 1024, 4000],
  standard: [0.5, 4096, 8000], "standard-1": [0.5, 4096, 8000],
  "standard-2": [1, 6144, 12000], "standard-3": [2, 8192, 16000], "standard-4": [4, 12288, 20000],
};

function expandNamedConfiguration(value: Record<string, unknown>): Record<string, unknown> {
  if (typeof value.instance_type !== "string") return value;
  const resources = NATIVE_PRESETS[value.instance_type];
  if (!resources) throw invalid();
  const { instance_type: _type, ...rest } = value;
  return { vcpu: resources[0], memory_mib: resources[1], disk: { size_mb: resources[2] }, ...rest };
}

function runnerApplicationConstraints(constraints: unknown): { tiers: number[]; regions?: unknown } {
  if (constraints === undefined) return { tiers: [1, 2] };
  if (!isObjectRecord(constraints) || Object.keys(constraints).some((key) => key !== "regions")
    || !Array.isArray(constraints.regions) || constraints.regions.some((region) => typeof region !== "string")) throw invalid();
  return { tiers: [1, 2], regions: constraints.regions };
}

function positive(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw invalid();
  return value;
}

function invalid(): Error {
  return new Error("Runner application configuration is outside the supported deployment contract.");
}
