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
    instances: 0,
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
  if (isObjectRecord(expected)) return isObjectRecord(actual)
    && Object.entries(expected).every(([key, value]) => runnerApplicationMatches(actual[key], value));
  return actual === expected;
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
