/** Two image targets; the deployment selects one only after its readiness proof. */
export type HostedRunnerBank = "primary" | "next";

export interface HostedRunnerRelease {
  bank: HostedRunnerBank;
  executionIdentity?: string;
  releaseSha?: string;
  bundleFingerprint: string;
  id: string;
  sourceFingerprint: string;
}

export interface HostedRunnerDeployment {
  active: HostedRunnerRelease;
  candidate: HostedRunnerRelease | null;
  previous: HostedRunnerRelease | null;
}

type Environment = Readonly<Record<string, unknown>>;

export function readHostedRunnerDeployment(source: Environment): HostedRunnerDeployment | null {
  const raw = source.HOSTED_EXECUTION_RUNNER_DEPLOYMENT;
  if (raw === undefined) return null;
  if (typeof raw !== "string") throw invalidDeployment();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw invalidDeployment(); }
  if (!isRecord(value) || !isRelease(value.active)
    || (value.candidate !== null && !isRelease(value.candidate))
    || (value.previous !== null && !isRelease(value.previous))
    || (value.candidate !== null && value.previous !== null)) throw invalidDeployment();
  const other = value.candidate ?? value.previous;
  if (other && (other.bank === value.active.bank || other.id === value.active.id)) {
    throw invalidDeployment();
  }
  return { active: value.active, candidate: value.candidate, previous: value.previous };
}

export function readHostedRunnerActiveReleaseId(source: Environment): string | null {
  const scoped = source.HOSTED_EXECUTION_RUNNER_RELEASE_ID;
  if (typeof scoped === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(scoped)) return scoped;
  return readHostedRunnerDeployment(source)?.active.id ?? null;
}

export function scopeHostedRunnerReleaseEnvironment<T extends Environment>(
  source: T,
  target: HostedRunnerBank | "candidate",
): T {
  const deployment = readHostedRunnerDeployment(source);
  if (!deployment) return source;
  const release = target === "candidate"
    ? deployment.candidate ?? deployment.active
    : [deployment.active, deployment.candidate, deployment.previous]
      .find((entry) => entry?.bank === target);
  if (!release) throw new Error("Hosted runner image target has no release identity.");
  return {
    ...source,
    HOSTED_EXECUTION_RUNNER_RELEASE_ID: release.id,
    HOSTED_EXECUTION_RUNNER_BUNDLE_FINGERPRINT: release.bundleFingerprint,
    HOSTED_EXECUTION_RUNNER_SOURCE_FINGERPRINT: release.sourceFingerprint,
  };
}

export function readHostedRunnerBankFromName(name: string): HostedRunnerBank {
  return /^runner--v-next-[A-Za-z0-9_-]+--[a-f0-9]{32}$/u.test(name) ? "next" : "primary";
}

function isRelease(value: unknown): value is HostedRunnerRelease {
  return isRecord(value)
    && (value.releaseSha === undefined || (typeof value.releaseSha === "string" && /^[a-f0-9]{40}$/u.test(value.releaseSha)))
    && (value.executionIdentity === undefined || (typeof value.executionIdentity === "string" && /^[a-f0-9]{64}$/u.test(value.executionIdentity)))
    && (value.bank === "primary" || value.bank === "next")
    && typeof value.id === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value.id)
    && (value.bank === "next" ? value.id.startsWith("next-") : !value.id.startsWith("next-"))
    && typeof value.bundleFingerprint === "string" && /^[a-f0-9]{64}$/u.test(value.bundleFingerprint)
    && typeof value.sourceFingerprint === "string" && /^[a-f0-9]{64}$/u.test(value.sourceFingerprint);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidDeployment(): Error {
  return new Error("Hosted runner deployment identity is invalid.");
}
