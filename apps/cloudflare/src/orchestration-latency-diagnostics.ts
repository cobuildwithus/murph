import type {
  HostedRuntimeLatencyPhaseBreakdown,
} from "@murphai/hosted-execution/runtime-control";

export type HostedRuntimeOrchestrationLatencyDiagnostics = NonNullable<
  HostedRuntimeLatencyPhaseBreakdown["orchestration"]
>;

type HeaderRecord = Readonly<Record<string, string | readonly string[] | undefined>>;

const ORCHESTRATION_NUMERIC_KEYS = [
  "temporalActivityStartedAtEpochMs",
  "temporalActivityRequestStartedAtEpochMs",
  "cloudflareRouteReceivedAtEpochMs",
  "userRunnerEnsureStartedAtEpochMs",
  "activeWakeStartedAtEpochMs",
  "activeWakeFinishedAtEpochMs",
  "replacementFenceClearedAtEpochMs",
  "freshStartRequestedAtEpochMs",
  "freshStartFenceBoundAtEpochMs",
  "freshStartContainerReadyAtEpochMs",
  "freshStartInvocationPreparedAtEpochMs",
  "freshStartInvocationAcceptedAtEpochMs",
] as const;

const ORCHESTRATION_BOOLEAN_KEYS = [
  "activeWakeAccepted",
  "replacedStaleFence",
] as const;

const ORCHESTRATION_HEADER_BY_KEY: Record<
  keyof HostedRuntimeOrchestrationLatencyDiagnostics,
  string
> = {
  activeWakeAccepted: "x-orchestration-active-wake-accepted",
  activeWakeFinishedAtEpochMs: "x-orchestration-active-wake-finished-at-ms",
  activeWakeStartedAtEpochMs: "x-orchestration-active-wake-started-at-ms",
  cloudflareRouteReceivedAtEpochMs: "x-orchestration-cloudflare-route-received-at-ms",
  freshStartContainerReadyAtEpochMs: "x-orchestration-fresh-start-container-ready-at-ms",
  freshStartFenceBoundAtEpochMs: "x-orchestration-fresh-start-fence-bound-at-ms",
  freshStartInvocationAcceptedAtEpochMs: "x-orchestration-fresh-start-invocation-accepted-at-ms",
  freshStartInvocationPreparedAtEpochMs: "x-orchestration-fresh-start-invocation-prepared-at-ms",
  freshStartRequestedAtEpochMs: "x-orchestration-fresh-start-requested-at-ms",
  replacedStaleFence: "x-orchestration-replaced-stale-fence",
  replacementFenceClearedAtEpochMs: "x-orchestration-replacement-fence-cleared-at-ms",
  temporalActivityRequestStartedAtEpochMs: "x-orchestration-temporal-activity-request-started-at-ms",
  temporalActivityStartedAtEpochMs: "x-orchestration-temporal-activity-started-at-ms",
  userRunnerEnsureStartedAtEpochMs: "x-orchestration-user-runner-ensure-started-at-ms",
};

export function sanitizeHostedRuntimeOrchestrationLatencyDiagnostics(
  value: unknown,
): HostedRuntimeOrchestrationLatencyDiagnostics | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const diagnostics: HostedRuntimeOrchestrationLatencyDiagnostics = {};
  for (const key of ORCHESTRATION_NUMERIC_KEYS) {
    const raw = record[key];
    if (isSafeEpochMs(raw)) {
      diagnostics[key] = raw;
    }
  }
  for (const key of ORCHESTRATION_BOOLEAN_KEYS) {
    const raw = record[key];
    if (typeof raw === "boolean") {
      diagnostics[key] = raw;
    }
  }
  return Object.keys(diagnostics).length > 0 ? diagnostics : null;
}

export function buildHostedRuntimeOrchestrationLatencyHeaders(
  diagnostics: HostedRuntimeOrchestrationLatencyDiagnostics | null | undefined,
): Record<string, string> {
  if (!diagnostics) {
    return {};
  }

  const headers: Record<string, string> = {};
  for (const key of ORCHESTRATION_NUMERIC_KEYS) {
    const value = diagnostics[key];
    if (isSafeEpochMs(value)) {
      headers[ORCHESTRATION_HEADER_BY_KEY[key]] = String(value);
    }
  }
  for (const key of ORCHESTRATION_BOOLEAN_KEYS) {
    const value = diagnostics[key];
    if (typeof value === "boolean") {
      headers[ORCHESTRATION_HEADER_BY_KEY[key]] = value ? "1" : "0";
    }
  }
  return headers;
}

export function readHostedRuntimeOrchestrationLatencyHeaders(
  headers: HeaderRecord,
): HostedRuntimeOrchestrationLatencyDiagnostics | null {
  const diagnostics: HostedRuntimeOrchestrationLatencyDiagnostics = {};
  for (const key of ORCHESTRATION_NUMERIC_KEYS) {
    const value = readHeaderEpochMs(headers, ORCHESTRATION_HEADER_BY_KEY[key]);
    if (value !== null) {
      diagnostics[key] = value;
    }
  }
  for (const key of ORCHESTRATION_BOOLEAN_KEYS) {
    const value = readHeaderBoolean(headers, ORCHESTRATION_HEADER_BY_KEY[key]);
    if (value !== null) {
      diagnostics[key] = value;
    }
  }
  return Object.keys(diagnostics).length > 0 ? diagnostics : null;
}

function readHeaderEpochMs(headers: HeaderRecord, name: string): number | null {
  const raw = readSingleHeader(headers, name);
  if (raw === null || !/^\d+$/u.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return isSafeEpochMs(value) ? value : null;
}

function readHeaderBoolean(headers: HeaderRecord, name: string): boolean | null {
  const raw = readSingleHeader(headers, name);
  if (raw === "1") {
    return true;
  }
  if (raw === "0") {
    return false;
  }
  return null;
}

function readSingleHeader(headers: HeaderRecord, name: string): string | null {
  const raw = headers[name];
  if (typeof raw === "string") {
    return raw.trim();
  }
  return null;
}

function isSafeEpochMs(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
