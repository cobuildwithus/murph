import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";

export const SNAPSHOT_SCHEMA_VERSION = "prod-watch.snapshot.v1" as const;
export const ADAPTER_SCHEMA_VERSION = "prod-watch.adapter-evidence.v1" as const;
export const PROVIDER_SCHEMA_VERSION = "prod-watch.provider-evidence.v1" as const;
export const STATE_SCHEMA_VERSION = "prod-watch.state.v1" as const;
export const REDACTION_POLICY_VERSION = "prod-watch.redaction.v1" as const;
export const COLLECTOR_VERSION = "phase-1" as const;

export const WATCH_SOURCES = ["database", "vercel", "cloudflare", "stripe"] as const;
export type WatchSource = (typeof WATCH_SOURCES)[number];
export type ReleaseSource = WatchSource | "repository";
export type SourceStatus = "ok" | "degraded" | "unavailable" | "not_collected";
export type AuthStatus = "ok" | "failed" | "not_required" | "unknown";
export type Severity = "low" | "medium" | "high" | "critical";
export type AutomationClass = "alert_only" | "diagnosis_only" | "remediation_candidate";
export type RunMode = "collect" | "scheduled" | "drill_down";
export type FailureClass = "auth" | "timeout" | "rate_limit" | "schema" | "unavailable" | "internal";
export type CounterUnit = "count" | "ratio" | "bytes" | "milliseconds";
export type IncidentState =
  | "candidate"
  | "claimed_triage"
  | "investigating"
  | "confirmed"
  | "monitor_incomplete"
  | "false_positive"
  | "escalated"
  | "resolved";

const TERMINAL_INCIDENT_STATES = new Set<IncidentState>([
  "false_positive",
  "resolved",
]);
const INCIDENT_TRANSITIONS: Readonly<Record<IncidentState, ReadonlySet<IncidentState>>> = {
  candidate: new Set(["claimed_triage"]),
  claimed_triage: new Set(["investigating", "confirmed", "monitor_incomplete", "false_positive", "escalated"]),
  investigating: new Set(["confirmed", "monitor_incomplete", "false_positive", "escalated"]),
  confirmed: new Set(["escalated", "resolved"]),
  monitor_incomplete: new Set(["investigating", "false_positive", "escalated"]),
  false_positive: new Set(),
  escalated: new Set(["investigating", "confirmed", "false_positive", "resolved"]),
  resolved: new Set(),
};
const MAX_SOURCE_HEALTH = WATCH_SOURCES.length;
const MAX_RELEASE_CONTEXT = 12;
const MAX_COUNTERS = 128;
const MAX_LATENCY = 64;
const MAX_PROVIDER_RELEASE_CONTEXT = 4;
const MAX_PROVIDER_COUNTERS = 32;
const MAX_PROVIDER_LATENCY = 16;
const MAX_PROVIDER_FINGERPRINTS = 8;
const MAX_DATABASE_FINGERPRINTS = 13;
const MAX_FINGERPRINTS = MAX_DATABASE_FINGERPRINTS
  + (WATCH_SOURCES.length - 1) * MAX_PROVIDER_FINGERPRINTS;
const MAX_FAILURES = 8;
const MAX_ANOMALIES = MAX_FAILURES
  + MAX_SOURCE_HEALTH * 2
  + MAX_COUNTERS
  + MAX_LATENCY
  + MAX_FINGERPRINTS;
const MAX_INCIDENTS = 2_000;
const MAX_TRANSITIONS = 32;
const INCIDENT_RETENTION_MS = 180 * 24 * 60 * 60 * 1_000;
const FALSE_POSITIVE_REOPEN_COOLDOWN_MS = 6 * 60 * 60 * 1_000;
const STREAK_RETENTION_MS = 2 * 60 * 60 * 1_000;
const MAX_LOCK_CLAIM_AGE_MS = 10 * 60 * 1_000;
const LOCK_ELECTION_SETTLE_MS = 100;
const SAFE_TOKEN_PATTERN = /^[A-Za-z0-9._:/-]+$/u;
const SIGNAL_CODE_PATTERN = /^[A-Za-z0-9._:/=|-]+$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const LOCAL_PATH_OR_URL_PATTERN = /^(?:\/|~(?:\/|$)|[A-Za-z]:[\\/]|(?:file|https?):|(?:Users|home|mnt|tmp|private|var\/folders)(?:\/|$))/iu;
const PATH_TRAVERSAL_PATTERN = /(?:^|\/)\.\.(?:\/|$)/u;
const OPAQUE_DIRECT_ID_PATTERN = /^(?:(?:cus|ch|pi|in|evt|sub|acct|pm|seti|cs|si|src|txn)_[A-Za-z0-9]{10,}|(?:user|member|attempt|mailbox|workspace|message|thread|request|delivery|capture|upload)_[A-Za-z0-9-]{12,})$/iu;
const SECRET_LIKE_PATTERN = /^(?:sk|rk|pk|whsec|ghp|gho|ghu|github_pat|xox[baprs])[_-][A-Za-z0-9_-]{8,}$/iu;
const JWT_PATTERN = /^[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}$/u;
const NUMERIC_IDENTIFIER_PATTERN = /^\d{8,}$/u;
const RFC3339_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?([Zz]|[+-]\d{2}:\d{2})$/u;
const RELEASE_SHA_PATTERN = /^[a-f0-9]{7,64}$/u;
const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,96}$/u;
const ALLOWED_DIMENSIONS = new Set([
  "component",
  "error_code",
  "event_code",
  "issue_kind",
  "level",
  "operation",
  "phase",
  "runtime",
  "severity",
  "source",
  "surface",
]);
const ALLOWED_METRICS = new Set([
  "assistant_issue_count",
  "db_active_sessions",
  "db_blocked_session_count",
  "db_cache_hit_ratio",
  "db_connection_ratio",
  "db_connections",
  "db_deadlocks_total",
  "db_idle_in_transaction",
  "db_long_transaction_count",
  "db_max_active_transaction_age_ms",
  "db_temp_bytes_total",
  "deployment_error_count",
  "ingress_accepted_count",
  "ingress_incomplete_count",
  "provider_error_count",
  "provider_request_count",
  "provider_timeout_count",
  "runtime_error_count",
  "runtime_event_count",
  "runtime_timeout_count",
]);
const ALLOWED_LATENCY_METRICS = new Set([
  "edge_request_duration_ms",
  "ingress_to_provider_ms",
  "ingress_to_runner_ms",
  "ingress_to_runtime_ms",
  "provider_duration_ms",
]);
const METRIC_UNITS: Readonly<Record<string, CounterUnit>> = {
  assistant_issue_count: "count",
  db_active_sessions: "count",
  db_blocked_session_count: "count",
  db_cache_hit_ratio: "ratio",
  db_connection_ratio: "ratio",
  db_connections: "count",
  db_deadlocks_total: "count",
  db_idle_in_transaction: "count",
  db_long_transaction_count: "count",
  db_max_active_transaction_age_ms: "milliseconds",
  db_temp_bytes_total: "bytes",
  deployment_error_count: "count",
  ingress_accepted_count: "count",
  ingress_incomplete_count: "count",
  provider_error_count: "count",
  provider_request_count: "count",
  provider_timeout_count: "count",
  runtime_error_count: "count",
  runtime_event_count: "count",
  runtime_timeout_count: "count",
};
const RATE_NUMERATOR_METRICS = new Set([
  "deployment_error_count",
  "ingress_incomplete_count",
  "provider_error_count",
  "provider_timeout_count",
  "runtime_error_count",
  "runtime_timeout_count",
]);
const PROVIDER_COUNTER_METRICS = new Set([
  "deployment_error_count",
  "provider_error_count",
  "provider_request_count",
  "provider_timeout_count",
]);
const REQUIRED_PROVIDER_RATE_NUMERATORS = [
  "provider_error_count",
  "provider_timeout_count",
] as const;
const PROVIDER_LATENCY_METRICS = new Set([
  "edge_request_duration_ms",
  "provider_duration_ms",
]);
const SENSITIVE_SIGNAL_PATTERN = /(?:auth|billing|canonical|clinical|consent|corrupt|credential|delet|erasure|health|hipaa|idempot|medical|patient|payment|privacy|replay|stripe|loss)/iu;

export interface SourceHealth {
  source: WatchSource;
  status: SourceStatus;
  auth: AuthStatus;
  coverage: "complete" | "partial" | "none" | "on_demand";
  access: "deterministic" | "mcp_on_demand";
  collectedAt?: string;
  freshnessSeconds?: number;
  errorCode?: string;
}

export interface ReleaseContext {
  source: ReleaseSource;
  runtime: string;
  sha: string;
  observedAt: string;
  deployedAt?: string;
  current: boolean;
}

export interface CounterSummary {
  metric: string;
  dimensions: Record<string, string>;
  unit: CounterUnit;
  current: number;
  previous?: number;
  sampleCount?: number;
  previousSampleCount?: number;
}

export interface LatencySummary {
  metric: string;
  dimensions: Record<string, string>;
  count: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  baselineCount?: number;
  baselineP95Ms?: number;
  baselineP99Ms?: number;
}

export interface FingerprintSummary {
  fingerprint: string;
  source: WatchSource;
  component: string;
  phase: string;
  severity: Severity;
  count: number;
  previousCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  errorCode?: string;
  issueKind?: string;
  releaseSha?: string;
}

export interface CollectorFailure {
  source: WatchSource;
  class: FailureClass;
  code: string;
  retryable: boolean;
}

export interface AnomalyEvidence {
  metric: string;
  current: number;
  baseline?: number;
  threshold: number;
  unit: CounterUnit;
}

export interface AnomalyCandidate {
  fingerprint: string;
  ruleId: string;
  severity: Severity;
  category: "availability" | "latency" | "monitor" | "pressure" | "sensitive";
  source: WatchSource;
  signalCode: string;
  observedAt: string;
  component?: string;
  phase?: string;
  errorCode?: string;
  issueKind?: string;
  releaseSha?: string;
  sourceFingerprint?: string;
  evidence: AnomalyEvidence[];
  deploymentCorrelated: boolean;
  minimumConsecutiveRuns: number;
  automationClass: AutomationClass;
}

export interface ProductionWatchSnapshot {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  collectorVersion: typeof COLLECTOR_VERSION;
  generatedAt: string;
  run: {
    runId: string;
    mode: RunMode;
    dryRun: boolean;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    timeoutMs: number;
    scheduledFor?: string;
    schedulerLagMs?: number;
    skippedOverlap: boolean;
    window: {
      previousStart: string;
      currentStart: string;
      end: string;
      lookbackMinutes: number;
      settlingDelaySeconds: number;
    };
  };
  monitor: {
    status: "healthy" | "partial" | "degraded";
    evidenceComplete: boolean;
    configuredSources: WatchSource[];
    collectedSources: WatchSource[];
  };
  sourceHealth: SourceHealth[];
  releaseContext: ReleaseContext[];
  counters: CounterSummary[];
  latency: LatencySummary[];
  fingerprints: FingerprintSummary[];
  anomalyCandidates: AnomalyCandidate[];
  collectorFailures: CollectorFailure[];
  redaction: {
    policyVersion: typeof REDACTION_POLICY_VERSION;
    rawTextIncluded: false;
    directIdentifiersIncluded: false;
    maxFingerprints: number;
    maxAnomalyCandidates: number;
  };
}

export interface AdapterEvidence {
  schemaVersion: typeof ADAPTER_SCHEMA_VERSION;
  source: WatchSource;
  collectedAt: string;
  status: Exclude<SourceStatus, "not_collected">;
  auth: AuthStatus;
  freshnessSeconds: number;
  releaseContext: ReleaseContext[];
  counters: CounterSummary[];
  latency: LatencySummary[];
  fingerprints: Array<Omit<FingerprintSummary, "fingerprint"> & { rawFingerprint: string }>;
}

export interface ProviderEvidenceEnvelope {
  schemaVersion: typeof PROVIDER_SCHEMA_VERSION;
  generatedAt: string;
  sources: AdapterEvidence[];
  failures: CollectorFailure[];
}

export interface IncidentLease {
  leaseId: string;
  sessionId: string;
  claimedAt: string;
  heartbeatAt: string;
  expiresAt: string;
}

export interface IncidentTransition {
  at: string;
  from?: IncidentState;
  to: IncidentState;
  sessionId?: string;
}

export interface IncidentRecord {
  id: string;
  fingerprint: string;
  state: IncidentState;
  severity: Severity;
  category: AnomalyCandidate["category"];
  automationClass: AutomationClass;
  source: WatchSource;
  ruleId: string;
  signalCode: string;
  component?: string;
  phase?: string;
  errorCode?: string;
  issueKind?: string;
  releaseSha?: string;
  sourceFingerprint?: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  occurrenceCount: number;
  lastEvidence: AnomalyEvidence[];
  owner?: IncidentLease;
  staleLeaseRecoveries: number;
  handlingSessions: string[];
  resolvedAt?: string;
  transitions: IncidentTransition[];
}

export interface ProductionWatchState {
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  updatedAt: string;
  monitor: {
    lastRunAt?: string;
    lastSuccessfulCollectionAt?: string;
    lastCompleteEvidenceAt?: string;
    lastDurationMs?: number;
    lastSchedulerLagMs?: number;
    consecutiveCollectionFailures: number;
    skippedOverlapCount: number;
    configuredSources: WatchSource[];
    sourceFailureStreaks: Partial<Record<WatchSource, number>>;
    lastMonitorStatus?: ProductionWatchSnapshot["monitor"]["status"];
    lastEvidenceComplete?: boolean;
    lastSourceHealth: SourceHealth[];
  };
  anomalyStreaks: Record<string, { count: number; lastSeenAt: string }>;
  cumulativeCounters: Record<string, number>;
  incidents: IncidentRecord[];
}

export interface BuildSnapshotInput {
  now: Date;
  runId: string;
  mode: RunMode;
  dryRun: boolean;
  startedAt: Date;
  timeoutMs: number;
  scheduledFor?: Date;
  schedulerLagMs?: number;
  skippedOverlap: boolean;
  previousStart: Date;
  currentStart: Date;
  end: Date;
  lookbackMinutes: number;
  settlingDelaySeconds: number;
  configuredSources: WatchSource[];
  evidences: AdapterEvidence[];
  failures: CollectorFailure[];
  repositorySha?: string;
  previousCumulativeCounters?: Record<string, number>;
}

export interface LockClaim {
  acquired: boolean;
  release?: () => Promise<void>;
  ownerRunId?: string;
}

export function parseAdapterEvidence(value: unknown): AdapterEvidence {
  const object = readObject(value, "adapter evidence");
  assertExactKeys(object, [
    "auth",
    "collectedAt",
    "counters",
    "fingerprints",
    "freshnessSeconds",
    "latency",
    "releaseContext",
    "schemaVersion",
    "source",
    "status",
  ], "adapter evidence");
  if (object.schemaVersion !== ADAPTER_SCHEMA_VERSION) {
    throw new Error("adapter_schema_version_invalid");
  }

  const source = readWatchSource(object.source, "adapter source");
  const status = readEnum(object.status, ["ok", "degraded", "unavailable"] as const, "adapter status");
  const auth = readEnum(object.auth, ["ok", "failed", "not_required", "unknown"] as const, "adapter auth");
  const collectedAt = readIsoTimestamp(object.collectedAt, "adapter collectedAt");
  const freshnessSeconds = readNonNegativeNumber(object.freshnessSeconds, "adapter freshnessSeconds");
  const releaseContext = readArray(object.releaseContext, "adapter releaseContext", MAX_RELEASE_CONTEXT)
    .map((entry) => parseReleaseContext(entry, source));
  const counters = readArray(object.counters, "adapter counters", MAX_COUNTERS)
    .map(parseCounterSummary);
  const latency = readArray(object.latency, "adapter latency", MAX_LATENCY)
    .map(parseLatencySummary);
  const fingerprints = readArray(object.fingerprints, "adapter fingerprints", MAX_FINGERPRINTS)
    .map((entry) => parseAdapterFingerprint(entry, source));

  assertUniqueBy(releaseContext, (release) => `${release.runtime}${release.sha}`, "release_context_duplicate");
  assertUniqueBy(counters, (counter) => `${counter.metric}${dimensionsKey(counter.dimensions)}`, "counter_duplicate");
  assertUniqueBy(latency, (summary) => `${summary.metric}${dimensionsKey(summary.dimensions)}`, "latency_duplicate");
  assertUniqueBy(fingerprints, (fingerprint) => fingerprint.rawFingerprint, "fingerprint_duplicate");

  if (status === "unavailable" && (
    releaseContext.length > 0
    || counters.length > 0
    || latency.length > 0
    || fingerprints.length > 0
  )) {
    throw new Error("unavailable_adapter_must_be_empty");
  }
  if (auth === "failed" && status !== "unavailable") {
    throw new Error("failed_auth_requires_unavailable_status");
  }
  for (const counter of counters) {
    if (counter.dimensions.source !== source) {
      throw new Error("counter_source_mismatch");
    }
  }
  for (const summary of latency) {
    if (summary.dimensions.source !== source) {
      throw new Error("latency_source_mismatch");
    }
  }

  return {
    schemaVersion: ADAPTER_SCHEMA_VERSION,
    source,
    collectedAt,
    status,
    auth,
    freshnessSeconds,
    releaseContext,
    counters,
    latency,
    fingerprints,
  };
}

export function parseProviderEvidence(value: unknown): ProviderEvidenceEnvelope {
  const object = readObject(value, "provider evidence");
  assertExactKeys(object, ["failures", "generatedAt", "schemaVersion", "sources"], "provider evidence");
  if (object.schemaVersion !== PROVIDER_SCHEMA_VERSION) {
    throw new Error("provider_schema_version_invalid");
  }

  const sources = readArray(object.sources, "provider sources", WATCH_SOURCES.length - 1)
    .map(parseAdapterEvidence);
  const expectedSources = WATCH_SOURCES.filter((source) => source !== "database");
  if (sources.length !== expectedSources.length) {
    throw new Error("provider_sources_incomplete");
  }
  for (const evidence of sources) {
    if (evidence.source === "database") {
      throw new Error("provider_database_source_forbidden");
    }
    if (evidence.releaseContext.length > MAX_PROVIDER_RELEASE_CONTEXT
      || evidence.counters.length > MAX_PROVIDER_COUNTERS
      || evidence.latency.length > MAX_PROVIDER_LATENCY
      || evidence.fingerprints.length > MAX_PROVIDER_FINGERPRINTS) {
      throw new Error("provider_source_evidence_too_large");
    }
    if (evidence.counters.some((counter) => !PROVIDER_COUNTER_METRICS.has(counter.metric))) {
      throw new Error("provider_counter_metric_forbidden");
    }
    if (evidence.counters.some((counter) => (
      counter.sampleCount !== undefined || counter.previousSampleCount !== undefined
    ))) {
      throw new Error("provider_counter_denominator_duplicate");
    }
    if (evidence.latency.some((summary) => !PROVIDER_LATENCY_METRICS.has(summary.metric))) {
      throw new Error("provider_latency_metric_forbidden");
    }
    if (evidence.status === "ok" && evidence.auth !== "ok") {
      throw new Error("provider_ok_auth_unproven");
    }
    if (evidence.status === "ok" && !providerRateEvidenceComplete(evidence)) {
      throw new Error("provider_ok_rate_facts_incomplete");
    }
  }
  const sourceNames = sources.map((source) => source.source);
  if (new Set(sourceNames).size !== sources.length) {
    throw new Error("provider_source_duplicate");
  }
  if (expectedSources.some((source) => !sourceNames.includes(source))) {
    throw new Error("provider_sources_incomplete");
  }

  const failures = readArray(object.failures, "provider failures", MAX_FAILURES).map(parseCollectorFailure);
  if (failures.some((failure) => failure.source === "database")) {
    throw new Error("provider_database_failure_forbidden");
  }
  if (new Set(failures.map((failure) => failure.source)).size !== failures.length) {
    throw new Error("provider_failure_duplicate");
  }
  if (failures.some((failure) => sources.find((source) => source.source === failure.source)?.status === "ok")) {
    throw new Error("provider_failure_requires_non_ok_status");
  }

  return {
    schemaVersion: PROVIDER_SCHEMA_VERSION,
    generatedAt: readIsoTimestamp(object.generatedAt, "provider generatedAt"),
    sources: [...sources].sort((left, right) => left.source.localeCompare(right.source)),
    failures: failures.sort(compareFailures),
  };
}

export function buildSnapshot(input: BuildSnapshotInput): ProductionWatchSnapshot {
  const finishedAt = input.now;
  const evidenceBySource = new Map<WatchSource, AdapterEvidence>();
  for (const evidence of input.evidences) {
    if (!input.configuredSources.includes(evidence.source)) {
      throw new Error(`unexpected_evidence_source_${evidence.source}`);
    }
    if (evidenceBySource.has(evidence.source)) {
      throw new Error(`duplicate_evidence_source_${evidence.source}`);
    }
    evidenceBySource.set(evidence.source, evidence);
  }
  for (const failure of input.failures) {
    if (!input.configuredSources.includes(failure.source)) {
      throw new Error(`unexpected_failure_source_${failure.source}`);
    }
  }

  const sourceHealth: SourceHealth[] = input.configuredSources.map((source) => {
    const evidence = evidenceBySource.get(source);
    const failure = input.failures.find((candidate) => candidate.source === source);
    if (evidence === undefined) {
      const mcpSource = source !== "database";
      return {
        source,
        status: failure === undefined ? "not_collected" : "unavailable",
        auth: failure?.class === "auth" ? "failed" : "unknown",
        coverage: mcpSource && failure === undefined ? "on_demand" : "none",
        access: mcpSource ? "mcp_on_demand" : "deterministic",
        ...(failure === undefined ? {} : { errorCode: failure.code }),
      };
    }
    const providerCollectionProven = source === "database" || providerRateEvidenceComplete(evidence);
    return {
      source,
      status: evidence.status,
      auth: evidence.auth,
      coverage: evidence.status === "ok" && providerCollectionProven
        ? "complete"
        : evidence.status === "unavailable"
          ? "none"
          : "partial",
      access: source === "database" ? "deterministic" : "mcp_on_demand",
      collectedAt: evidence.collectedAt,
      freshnessSeconds: Math.max(
        evidence.freshnessSeconds,
        Math.max(0, finishedAt.getTime() - Date.parse(evidence.collectedAt)) / 1_000,
      ),
      ...(failure === undefined ? {} : { errorCode: failure.code }),
    };
  });

  const failedSources = new Set(input.failures.map((failure) => failure.source));
  const scorableSources = new Set(sourceHealth
    .filter((health) => (
      health.status === "ok"
      && health.coverage === "complete"
      && (health.auth === "ok" || health.auth === "not_required")
      && (health.freshnessSeconds ?? Number.POSITIVE_INFINITY) <= 1_800
      && !failedSources.has(health.source)
    ))
    .map((health) => health.source));
  const scorableEvidence = input.evidences.filter((evidence) => scorableSources.has(evidence.source));

  const releaseContext = scorableEvidence.flatMap((evidence) => evidence.releaseContext);
  if (input.repositorySha !== undefined && RELEASE_SHA_PATTERN.test(input.repositorySha)) {
    releaseContext.push({
      source: "repository",
      runtime: "local_checkout",
      sha: input.repositorySha,
      observedAt: finishedAt.toISOString(),
      current: true,
    });
  }
  releaseContext.sort(compareReleases);

  const counters = enrichCumulativeCounters(
    scorableEvidence.flatMap((evidence) => evidence.counters).sort(compareCounters).slice(0, MAX_COUNTERS),
    input.previousCumulativeCounters ?? {},
  );
  const latency = scorableEvidence
    .flatMap((evidence) => evidence.latency)
    .sort(compareLatency)
    .slice(0, MAX_LATENCY);
  const allFingerprints = scorableEvidence
    .flatMap((evidence) => evidence.fingerprints.map((fingerprint) => ({
      ...fingerprint,
      fingerprint: stableHash(["source-fingerprint", evidence.source, fingerprint.rawFingerprint]),
    })))
    .map(({ rawFingerprint: _rawFingerprint, ...fingerprint }) => fingerprint)
    .sort((left, right) => right.count - left.count
      || left.source.localeCompare(right.source)
      || left.component.localeCompare(right.component)
      || left.phase.localeCompare(right.phase)
      || left.fingerprint.localeCompare(right.fingerprint));
  const failures = [...input.failures].sort(compareFailures).slice(0, MAX_FAILURES);
  const anomalies = selectBoundedAnomalies(evaluateAnomalies({
    now: finishedAt,
    sourceHealth,
    releaseContext,
    counters,
    latency,
    fingerprints: allFingerprints,
    failures,
  }));
  const fingerprints = selectBoundedFingerprints(allFingerprints, anomalies);
  const collectedSources = sourceHealth
    .filter((source) => source.status === "ok" || source.status === "degraded")
    .map((source) => source.source);
  const evidenceComplete = sourceHealth.every(
    (source) => source.coverage === "complete"
      && source.auth !== "failed"
      && (source.freshnessSeconds ?? Number.POSITIVE_INFINITY) <= 1_800,
  );
  const monitorStatus = failures.length > 0 || sourceHealth.some(
    (source) => source.status === "unavailable"
      || source.status === "degraded"
      || source.auth === "failed"
      || (source.freshnessSeconds ?? 0) > 1_800,
  )
    ? "degraded"
    : evidenceComplete
      ? "healthy"
      : "partial";

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    collectorVersion: COLLECTOR_VERSION,
    generatedAt: finishedAt.toISOString(),
    run: {
      runId: normalizeToken(input.runId, 96),
      mode: input.mode,
      dryRun: input.dryRun,
      startedAt: input.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: Math.max(0, finishedAt.getTime() - input.startedAt.getTime()),
      timeoutMs: input.timeoutMs,
      ...(input.scheduledFor === undefined ? {} : { scheduledFor: input.scheduledFor.toISOString() }),
      ...(input.schedulerLagMs === undefined ? {} : { schedulerLagMs: Math.max(0, input.schedulerLagMs) }),
      skippedOverlap: input.skippedOverlap,
      window: {
        previousStart: input.previousStart.toISOString(),
        currentStart: input.currentStart.toISOString(),
        end: input.end.toISOString(),
        lookbackMinutes: input.lookbackMinutes,
        settlingDelaySeconds: input.settlingDelaySeconds,
      },
    },
    monitor: {
      status: monitorStatus,
      evidenceComplete,
      configuredSources: [...input.configuredSources],
      collectedSources,
    },
    sourceHealth,
    releaseContext: releaseContext.slice(0, MAX_RELEASE_CONTEXT),
    counters,
    latency,
    fingerprints,
    anomalyCandidates: anomalies,
    collectorFailures: failures,
    redaction: {
      policyVersion: REDACTION_POLICY_VERSION,
      rawTextIncluded: false,
      directIdentifiersIncluded: false,
      maxFingerprints: MAX_FINGERPRINTS,
      maxAnomalyCandidates: MAX_ANOMALIES,
    },
  };
}

function isMandatoryAnomaly(candidate: AnomalyCandidate): boolean {
  return candidate.category === "sensitive"
    || candidate.severity === "critical"
    || candidate.automationClass === "alert_only";
}

function selectBoundedAnomalies(candidates: AnomalyCandidate[]): AnomalyCandidate[] {
  const mandatory = candidates.filter(isMandatoryAnomaly);
  if (mandatory.length > MAX_ANOMALIES) {
    throw new Error("mandatory_anomaly_capacity_exceeded");
  }
  const selected = new Set(mandatory.map((candidate) => candidate.fingerprint));
  for (const candidate of candidates) {
    if (selected.size >= MAX_ANOMALIES) {
      break;
    }
    selected.add(candidate.fingerprint);
  }
  return candidates.filter((candidate) => selected.has(candidate.fingerprint));
}

function selectBoundedFingerprints(
  fingerprints: FingerprintSummary[],
  anomalies: AnomalyCandidate[],
): FingerprintSummary[] {
  const mandatoryReferences = new Set(
    anomalies
      .filter(isMandatoryAnomaly)
      .flatMap((candidate) => candidate.sourceFingerprint === undefined ? [] : [candidate.sourceFingerprint]),
  );
  const mandatory = fingerprints.filter((fingerprint) => mandatoryReferences.has(fingerprint.fingerprint));
  if (mandatory.length > MAX_FINGERPRINTS) {
    throw new Error("mandatory_fingerprint_capacity_exceeded");
  }
  const selected = new Set(mandatory.map((fingerprint) => fingerprint.fingerprint));
  for (const fingerprint of fingerprints) {
    if (selected.size >= MAX_FINGERPRINTS) {
      break;
    }
    selected.add(fingerprint.fingerprint);
  }
  return fingerprints.filter((fingerprint) => selected.has(fingerprint.fingerprint));
}

export function evaluateAnomalies(input: {
  now: Date;
  sourceHealth: SourceHealth[];
  releaseContext: ReleaseContext[];
  counters: CounterSummary[];
  latency: LatencySummary[];
  fingerprints: FingerprintSummary[];
  failures: CollectorFailure[];
}): AnomalyCandidate[] {
  const anomalies: AnomalyCandidate[] = [];
  const observedAt = input.now.toISOString();

  for (const failure of input.failures) {
    const authFailure = failure.class === "auth";
    anomalies.push(makeAnomaly({
      ruleId: authFailure ? "source_auth_failure" : "source_collection_failure",
      severity: authFailure ? "high" : "medium",
      category: "monitor",
      source: failure.source,
      signalCode: authFailure ? "monitor_source_auth_failed" : "monitor_source_unavailable",
      observedAt,
      evidence: [{ metric: "collector_failure", current: 1, threshold: 1, unit: "count" }],
      minimumConsecutiveRuns: authFailure ? 1 : 2,
      automationClass: "alert_only",
      deploymentCorrelated: false,
    }));
  }

  const sourcesWithFailures = new Set(input.failures.map((failure) => failure.source));
  for (const health of input.sourceHealth) {
    if (!sourcesWithFailures.has(health.source) && (health.auth === "failed" || health.status === "unavailable")) {
      const authFailure = health.auth === "failed";
      anomalies.push(makeAnomaly({
        ruleId: authFailure ? "source_auth_failure" : "source_collection_failure",
        severity: authFailure ? "high" : "medium",
        category: "monitor",
        source: health.source,
        signalCode: authFailure ? "monitor_source_auth_failed" : "monitor_source_unavailable",
        observedAt,
        evidence: [{ metric: "collector_failure", current: 1, threshold: 1, unit: "count" }],
        minimumConsecutiveRuns: authFailure ? 1 : 2,
        automationClass: "alert_only",
        deploymentCorrelated: false,
      }));
    }
    if (!sourcesWithFailures.has(health.source) && health.status === "degraded") {
      anomalies.push(makeAnomaly({
        ruleId: "source_degraded",
        severity: "medium",
        category: "monitor",
        source: health.source,
        signalCode: "monitor_source_degraded",
        observedAt,
        evidence: [{ metric: "source_degraded", current: 1, threshold: 1, unit: "count" }],
        minimumConsecutiveRuns: 2,
        automationClass: "alert_only",
        deploymentCorrelated: false,
      }));
    }
    if (
      (health.status === "ok" || health.status === "degraded")
      && health.freshnessSeconds !== undefined
      && health.freshnessSeconds > 1_800
    ) {
      anomalies.push(makeAnomaly({
        ruleId: "source_stale",
        severity: "medium",
        category: "monitor",
        source: health.source,
        signalCode: "monitor_source_stale",
        observedAt,
        evidence: [{
          metric: "source_freshness_seconds",
          current: health.freshnessSeconds,
          threshold: 1_800,
          unit: "count",
        }],
        minimumConsecutiveRuns: 2,
        automationClass: "alert_only",
        deploymentCorrelated: false,
      }));
    }
  }

  for (const counter of input.counters) {
    if (["provider_error_count", "deployment_error_count"].includes(counter.metric)) {
      const candidate = evaluateRateCounter(withProviderRateDenominator(counter, input.counters), {
        ruleId: "error_rate_regression",
        signalCode: "error_rate_regression",
        minimumCount: 10,
        minimumVolume: 50,
        fixedRate: 0.05,
        minimumRate: 0.02,
        ratio: 3,
        absoluteDelta: 0.01,
      }, observedAt, input.releaseContext);
      if (candidate !== undefined) {
        anomalies.push(candidate);
      }
    }

    if (["provider_timeout_count", "ingress_incomplete_count"].includes(counter.metric)) {
      const candidate = evaluateRateCounter(withProviderRateDenominator(counter, input.counters), {
        ruleId: "timeout_rate_regression",
        signalCode: "timeout_rate_regression",
        minimumCount: 5,
        minimumVolume: 50,
        fixedRate: 0.02,
        minimumRate: 0.01,
        ratio: 3,
        absoluteDelta: 0.005,
      }, observedAt, input.releaseContext);
      if (candidate !== undefined) {
        anomalies.push(candidate);
      }
    }

    if (["runtime_error_count", "runtime_timeout_count", "assistant_issue_count"].includes(counter.metric)) {
      const candidate = evaluateCountCounter(counter, {
        ruleId: counter.metric === "runtime_timeout_count" ? "timeout_count_regression" : "error_count_regression",
        signalCode: counter.metric === "runtime_timeout_count" ? "timeout_count_regression" : "error_count_regression",
        minimumCount: counter.metric === "runtime_timeout_count" ? 5 : 10,
        ratio: 3,
        absoluteDelta: counter.metric === "runtime_timeout_count" ? 5 : 10,
      }, observedAt, input.releaseContext);
      if (candidate !== undefined) {
        anomalies.push(candidate);
      }
    }

    const source = readSourceFromDimensions(counter.dimensions) ?? "database";
    if (counter.metric === "db_connection_ratio" && counter.current >= 0.9) {
      anomalies.push(makeAnomaly({
        fingerprintMetric: counter.metric,
        fingerprintDimensions: counter.dimensions,
        ruleId: "database_connection_pressure",
        severity: counter.current >= 0.95 ? "high" : "medium",
        category: "pressure",
        source,
        signalCode: "database_connection_pressure",
        observedAt,
        evidence: [{ metric: counter.metric, current: counter.current, threshold: 0.9, unit: "ratio" }],
        minimumConsecutiveRuns: 2,
        automationClass: "diagnosis_only",
        deploymentCorrelated: false,
      }));
    }
    if (counter.metric === "db_long_transaction_count" && counter.current >= 1) {
      anomalies.push(makeAnomaly({
        fingerprintMetric: counter.metric,
        fingerprintDimensions: counter.dimensions,
        ruleId: "database_long_transaction",
        severity: "high",
        category: "pressure",
        source,
        signalCode: "database_long_transaction",
        observedAt,
        evidence: [{ metric: counter.metric, current: counter.current, threshold: 1, unit: "count" }],
        minimumConsecutiveRuns: 2,
        automationClass: "diagnosis_only",
        deploymentCorrelated: false,
      }));
    }
    if (counter.metric === "db_blocked_session_count" && counter.current >= 5) {
      anomalies.push(makeAnomaly({
        fingerprintMetric: counter.metric,
        fingerprintDimensions: counter.dimensions,
        ruleId: "database_blocked_sessions",
        severity: "high",
        category: "pressure",
        source,
        signalCode: "database_blocked_sessions",
        observedAt,
        evidence: [{ metric: counter.metric, current: counter.current, threshold: 5, unit: "count" }],
        minimumConsecutiveRuns: 2,
        automationClass: "diagnosis_only",
        deploymentCorrelated: false,
      }));
    }
    if (
      counter.metric === "db_deadlocks_total"
      && counter.previous !== undefined
      && counter.current > counter.previous
    ) {
      anomalies.push(makeAnomaly({
        fingerprintMetric: counter.metric,
        fingerprintDimensions: counter.dimensions,
        ruleId: "database_deadlock_observed",
        severity: "medium",
        category: "pressure",
        source,
        signalCode: "database_deadlock_observed",
        observedAt,
        evidence: [{
          metric: counter.metric,
          current: counter.current - counter.previous,
          baseline: 0,
          threshold: 1,
          unit: "count",
        }],
        minimumConsecutiveRuns: 1,
        automationClass: "diagnosis_only",
        deploymentCorrelated: false,
      }));
    }
  }

  for (const summary of input.latency) {
    if (summary.count < 30) {
      continue;
    }
    const baselineReady = summary.baselineCount !== undefined && summary.baselineCount >= 30;
    const p95Regression = baselineReady
      && summary.baselineP95Ms !== undefined
      && summary.p95Ms >= summary.baselineP95Ms * 2
      && summary.p95Ms - summary.baselineP95Ms >= 2_000;
    const p99Regression = baselineReady
      && summary.baselineP99Ms !== undefined
      && summary.p99Ms >= summary.baselineP99Ms * 2
      && summary.p99Ms - summary.baselineP99Ms >= 5_000;
    const fixedBreach = summary.p95Ms >= 15_000 || summary.p99Ms >= 60_000;
    if (!p95Regression && !p99Regression && !fixedBreach) {
      continue;
    }
    const source = readSourceFromDimensions(summary.dimensions) ?? "database";
    const sensitive = source === "stripe";
    const release = findCorrelatedRelease(input.releaseContext, source, input.now);
    anomalies.push(makeAnomaly({
      fingerprintMetric: summary.metric,
      fingerprintDimensions: summary.dimensions,
      ruleId: "latency_regression",
      severity: sensitive || summary.p99Ms >= 60_000 ? "high" : "medium",
      category: sensitive ? "sensitive" : "latency",
      source,
      signalCode: "latency_regression",
      observedAt,
      component: summary.dimensions.component,
      phase: summary.dimensions.phase,
      releaseSha: release?.sha,
      evidence: [
        {
          metric: `${summary.metric}_p95`,
          current: summary.p95Ms,
          ...(summary.baselineP95Ms === undefined ? {} : { baseline: summary.baselineP95Ms }),
          threshold: fixedBreach ? 15_000 : (summary.baselineP95Ms ?? 0) * 2,
          unit: "milliseconds",
        },
        {
          metric: `${summary.metric}_p99`,
          current: summary.p99Ms,
          ...(summary.baselineP99Ms === undefined ? {} : { baseline: summary.baselineP99Ms }),
          threshold: fixedBreach ? 60_000 : (summary.baselineP99Ms ?? 0) * 2,
          unit: "milliseconds",
        },
      ],
      minimumConsecutiveRuns: 2,
      automationClass: sensitive
        ? "alert_only"
        : release === undefined
          ? "diagnosis_only"
          : "remediation_candidate",
      deploymentCorrelated: release !== undefined,
    }));
  }

  for (const fingerprint of input.fingerprints) {
    const sensitive = fingerprint.source === "stripe" || [
      fingerprint.component,
      fingerprint.errorCode,
      fingerprint.issueKind,
      fingerprint.phase,
    ].some((value) => value !== undefined && SENSITIVE_SIGNAL_PATTERN.test(value));
    const critical = fingerprint.severity === "critical";
    const spike = fingerprint.count >= 5
      && fingerprint.count >= Math.max(fingerprint.previousCount * 3, fingerprint.previousCount + 5);
    if (!sensitive && !critical && !spike) {
      continue;
    }
    const release = fingerprint.releaseSha === undefined
      ? findCorrelatedRelease(input.releaseContext, fingerprint.source, input.now)
      : findReleaseBySha(input.releaseContext, fingerprint.releaseSha, input.now);
    const severity: Severity = critical
      ? "critical"
      : sensitive
        ? fingerprint.severity === "low" ? "high" : fingerprint.severity
        : fingerprint.severity;
    anomalies.push(makeAnomaly({
      ruleId: sensitive ? "sensitive_domain_signal" : critical ? "critical_fingerprint" : "fingerprint_spike",
      severity,
      category: sensitive ? "sensitive" : "availability",
      source: fingerprint.source,
      signalCode: sensitive ? "sensitive_domain_signal" : critical ? "critical_fingerprint" : "fingerprint_spike",
      observedAt,
      component: fingerprint.component,
      phase: fingerprint.phase,
      errorCode: fingerprint.errorCode,
      issueKind: fingerprint.issueKind,
      releaseSha: fingerprint.releaseSha ?? release?.sha,
      sourceFingerprint: fingerprint.fingerprint,
      evidence: [{
        metric: "fingerprint_count",
        current: fingerprint.count,
        baseline: fingerprint.previousCount,
        threshold: sensitive || critical ? 1 : Math.max(fingerprint.previousCount * 3, fingerprint.previousCount + 5),
        unit: "count",
      }],
      minimumConsecutiveRuns: sensitive || critical ? 1 : 2,
      automationClass: sensitive || critical
        ? "alert_only"
        : release === undefined
          ? "diagnosis_only"
          : "remediation_candidate",
      deploymentCorrelated: release !== undefined,
    }));
  }

  return deduplicateAnomalies(anomalies)
    .sort((left, right) => severityRank(right.severity) - severityRank(left.severity)
      || left.fingerprint.localeCompare(right.fingerprint));
}

export function createInitialState(now: Date, configuredSources: WatchSource[]): ProductionWatchState {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    updatedAt: now.toISOString(),
    monitor: {
      consecutiveCollectionFailures: 0,
      skippedOverlapCount: 0,
      configuredSources: [...configuredSources],
      sourceFailureStreaks: {},
      lastSourceHealth: [],
    },
    anomalyStreaks: {},
    cumulativeCounters: {},
    incidents: [],
  };
}

export function parseState(value: unknown): ProductionWatchState {
  const object = readObject(value, "state");
  assertExactKeys(object, [
    "anomalyStreaks",
    "cumulativeCounters",
    "incidents",
    "monitor",
    "schemaVersion",
    "updatedAt",
  ], "state");
  if (object.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new Error("state_schema_version_invalid");
  }
  const monitor = readObject(object.monitor, "state monitor");
  assertExactKeys(monitor, [
    "configuredSources",
    "consecutiveCollectionFailures",
    "lastCompleteEvidenceAt",
    "lastDurationMs",
    "lastEvidenceComplete",
    "lastMonitorStatus",
    "lastRunAt",
    "lastSchedulerLagMs",
    "lastSourceHealth",
    "lastSuccessfulCollectionAt",
    "skippedOverlapCount",
    "sourceFailureStreaks",
  ], "state monitor", true);
  const configuredSources = readArray(monitor.configuredSources, "state configured sources", WATCH_SOURCES.length)
    .map((source) => readWatchSource(source, "state configured source"));
  if (new Set(configuredSources).size !== configuredSources.length) {
    throw new Error("state_configured_source_duplicate");
  }
  if (!configuredSources.includes("database")) {
    throw new Error("state_database_source_required");
  }
  const initial = createInitialState(new Date(readIsoTimestamp(object.updatedAt, "state updatedAt")), configuredSources);
  initial.monitor = {
    ...initial.monitor,
    ...(monitor.lastRunAt === undefined
      ? {}
      : { lastRunAt: readIsoTimestamp(monitor.lastRunAt, "lastRunAt") }),
    ...(monitor.lastSuccessfulCollectionAt === undefined
      ? {}
      : { lastSuccessfulCollectionAt: readIsoTimestamp(monitor.lastSuccessfulCollectionAt, "lastSuccessfulCollectionAt") }),
    ...(monitor.lastCompleteEvidenceAt === undefined
      ? {}
      : { lastCompleteEvidenceAt: readIsoTimestamp(monitor.lastCompleteEvidenceAt, "lastCompleteEvidenceAt") }),
    ...(monitor.lastDurationMs === undefined
      ? {}
      : { lastDurationMs: readNonNegativeNumber(monitor.lastDurationMs, "lastDurationMs") }),
    ...(monitor.lastSchedulerLagMs === undefined
      ? {}
      : { lastSchedulerLagMs: readNonNegativeNumber(monitor.lastSchedulerLagMs, "lastSchedulerLagMs") }),
    consecutiveCollectionFailures: readNonNegativeInteger(
      monitor.consecutiveCollectionFailures,
      "consecutiveCollectionFailures",
    ),
    skippedOverlapCount: readNonNegativeInteger(monitor.skippedOverlapCount, "skippedOverlapCount"),
    configuredSources,
    sourceFailureStreaks: parseSourceFailureStreaks(monitor.sourceFailureStreaks),
    ...(monitor.lastMonitorStatus === undefined
      ? {}
      : { lastMonitorStatus: readEnum(monitor.lastMonitorStatus, ["healthy", "partial", "degraded"] as const, "lastMonitorStatus") }),
    ...(monitor.lastEvidenceComplete === undefined
      ? {}
      : { lastEvidenceComplete: readBoolean(monitor.lastEvidenceComplete, "lastEvidenceComplete") }),
    lastSourceHealth: readArray(monitor.lastSourceHealth, "lastSourceHealth", MAX_SOURCE_HEALTH)
      .map(parseSourceHealth),
  };
  if (new Set(initial.monitor.lastSourceHealth.map((source) => source.source)).size
    !== initial.monitor.lastSourceHealth.length) {
    throw new Error("state_source_health_duplicate");
  }
  if (initial.monitor.lastSourceHealth.some((source) => !configuredSources.includes(source.source))) {
    throw new Error("state_source_health_unconfigured");
  }
  initial.updatedAt = readIsoTimestamp(object.updatedAt, "state updatedAt");
  initial.anomalyStreaks = parseAnomalyStreaks(object.anomalyStreaks);
  initial.cumulativeCounters = parseCumulativeCounters(object.cumulativeCounters);
  if (Object.keys(initial.monitor.sourceFailureStreaks).some((source) => !configuredSources.includes(source as WatchSource))) {
    throw new Error("state_source_failure_streak_unconfigured");
  }
  initial.incidents = readArray(object.incidents, "state incidents", MAX_INCIDENTS).map(parseIncidentRecord);
  assertUniqueBy(initial.incidents, (incident) => incident.id, "state_incident_id_duplicate");
  assertUniqueBy(initial.incidents, (incident) => incident.fingerprint, "state_incident_fingerprint_duplicate");
  return initial;
}

export function updateStateFromSnapshot(
  state: ProductionWatchState,
  snapshot: ProductionWatchSnapshot,
): { state: ProductionWatchState; promotedIncidentIds: string[] } {
  const now = new Date(snapshot.generatedAt);
  const next = structuredClone(state) as ProductionWatchState;
  recoverExpiredLeases(next, now);
  next.updatedAt = snapshot.generatedAt;
  next.monitor.lastRunAt = snapshot.generatedAt;
  next.monitor.lastDurationMs = snapshot.run.durationMs;
  next.monitor.configuredSources = [...snapshot.monitor.configuredSources];
  next.monitor.lastMonitorStatus = snapshot.monitor.status;
  next.monitor.lastEvidenceComplete = snapshot.monitor.evidenceComplete;
  next.monitor.lastSourceHealth = structuredClone(snapshot.sourceHealth) as SourceHealth[];
  if (snapshot.run.schedulerLagMs !== undefined) {
    next.monitor.lastSchedulerLagMs = snapshot.run.schedulerLagMs;
  }
  if (snapshot.run.skippedOverlap) {
    next.monitor.skippedOverlapCount += 1;
  }
  const databaseHealthy = snapshot.sourceHealth.some(
    (source) => source.source === "database" && source.status === "ok",
  );
  next.monitor.consecutiveCollectionFailures = databaseHealthy
    ? 0
    : next.monitor.consecutiveCollectionFailures + 1;
  if (databaseHealthy) {
    next.monitor.lastSuccessfulCollectionAt = snapshot.generatedAt;
  }
  if (snapshot.monitor.evidenceComplete) {
    next.monitor.lastCompleteEvidenceAt = snapshot.generatedAt;
  }
  for (const source of snapshot.monitor.configuredSources) {
    const health = snapshot.sourceHealth.find((candidate) => candidate.source === source);
    const failed = health !== undefined && (
      health.status === "unavailable"
      || health.status === "degraded"
      || health.auth === "failed"
      || (health.freshnessSeconds !== undefined && health.freshnessSeconds > 1_800)
    );
    next.monitor.sourceFailureStreaks[source] = failed
      ? (next.monitor.sourceFailureStreaks[source] ?? 0) + 1
      : 0;
  }

  const previousStreaks = next.anomalyStreaks;
  const newStreaks: ProductionWatchState["anomalyStreaks"] = {};
  const promotedIncidentIds: string[] = [];
  const runWindowMs = snapshot.run.window.lookbackMinutes * 60 * 1_000;
  for (const candidate of snapshot.anomalyCandidates) {
    const previous = previousStreaks[candidate.fingerprint];
    const previousStillAdjacent = previous !== undefined
      && now.getTime() - Date.parse(previous.lastSeenAt) <= runWindowMs * 2 + 60_000;
    const streak = previousStillAdjacent ? previous.count + 1 : 1;
    newStreaks[candidate.fingerprint] = { count: streak, lastSeenAt: snapshot.generatedAt };
    const existing = next.incidents.find((incident) => incident.fingerprint === candidate.fingerprint);
    if (existing !== undefined && !TERMINAL_INCIDENT_STATES.has(existing.state)) {
      existing.lastDetectedAt = snapshot.generatedAt;
      existing.occurrenceCount += 1;
      existing.lastEvidence = candidate.evidence.slice(0, 4);
      existing.severity = maxSeverity(existing.severity, candidate.severity);
      tightenIncidentPolicy(existing, candidate);
      existing.releaseSha ??= candidate.releaseSha;
      existing.sourceFingerprint ??= candidate.sourceFingerprint;
      continue;
    }
    if (streak < candidate.minimumConsecutiveRuns) {
      continue;
    }
    if (existing === undefined) {
      const incident = incidentFromCandidate(candidate, snapshot.generatedAt);
      next.incidents.push(incident);
      promotedIncidentIds.push(incident.id);
    } else {
      const resolvedAt = existing.resolvedAt === undefined ? 0 : Date.parse(existing.resolvedAt);
      const canReopen = existing.state === "resolved"
        || now.getTime() - resolvedAt >= FALSE_POSITIVE_REOPEN_COOLDOWN_MS;
      if (canReopen) {
        const from = existing.state;
        existing.state = "candidate";
        existing.resolvedAt = undefined;
        existing.lastDetectedAt = snapshot.generatedAt;
        existing.occurrenceCount += 1;
        existing.lastEvidence = candidate.evidence.slice(0, 4);
        existing.severity = maxSeverity(existing.severity, candidate.severity);
        tightenIncidentPolicy(existing, candidate);
        existing.releaseSha = candidate.releaseSha ?? existing.releaseSha;
        existing.sourceFingerprint = candidate.sourceFingerprint ?? existing.sourceFingerprint;
        appendTransition(existing, { at: snapshot.generatedAt, from, to: "candidate" });
        promotedIncidentIds.push(existing.id);
      }
    }
  }
  next.anomalyStreaks = Object.fromEntries(
    Object.entries(newStreaks).filter(([, streak]) => now.getTime() - Date.parse(streak.lastSeenAt) <= STREAK_RETENTION_MS),
  );
  next.cumulativeCounters = extractCumulativeCounters(snapshot.counters);
  next.incidents = pruneIncidents(next.incidents, now);
  return { state: next, promotedIncidentIds };
}

export function claimIncident(
  state: ProductionWatchState,
  fingerprint: string,
  sessionId: string,
  now: Date,
  leaseMinutes: number,
): ProductionWatchState {
  assertSessionId(sessionId);
  if (!Number.isInteger(leaseMinutes) || leaseMinutes < 5 || leaseMinutes > 60) {
    throw new Error("lease_minutes_out_of_range");
  }
  const next = structuredClone(state) as ProductionWatchState;
  recoverExpiredLeases(next, now);
  const incident = requireIncident(next, fingerprint);
  if (TERMINAL_INCIDENT_STATES.has(incident.state)) {
    throw new Error("incident_terminal");
  }
  if (incident.owner !== undefined && incident.owner.sessionId !== sessionId) {
    throw new Error("incident_already_claimed");
  }
  const from = incident.state;
  const nextState: IncidentState = incident.state === "candidate" ? "claimed_triage" : incident.state;
  incident.state = nextState;
  incident.owner = {
    leaseId: randomUUID(),
    sessionId,
    claimedAt: now.toISOString(),
    heartbeatAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + leaseMinutes * 60 * 1_000).toISOString(),
  };
  if (!incident.handlingSessions.includes(sessionId)) {
    incident.handlingSessions.push(sessionId);
    incident.handlingSessions = incident.handlingSessions.slice(-8);
  }
  appendTransition(incident, { at: now.toISOString(), from, to: nextState, sessionId });
  next.updatedAt = now.toISOString();
  return next;
}

export function heartbeatIncident(
  state: ProductionWatchState,
  fingerprint: string,
  sessionId: string,
  now: Date,
  leaseMinutes: number,
): ProductionWatchState {
  assertSessionId(sessionId);
  if (!Number.isInteger(leaseMinutes) || leaseMinutes < 5 || leaseMinutes > 60) {
    throw new Error("lease_minutes_out_of_range");
  }
  const next = structuredClone(state) as ProductionWatchState;
  recoverExpiredLeases(next, now);
  const incident = requireIncident(next, fingerprint);
  if (incident.owner?.sessionId !== sessionId) {
    throw new Error("incident_lease_not_owned");
  }
  incident.owner.heartbeatAt = now.toISOString();
  incident.owner.expiresAt = new Date(now.getTime() + leaseMinutes * 60 * 1_000).toISOString();
  next.updatedAt = now.toISOString();
  return next;
}

export function transitionIncident(
  state: ProductionWatchState,
  fingerprint: string,
  sessionId: string,
  target: IncidentState,
  now: Date,
): ProductionWatchState {
  assertSessionId(sessionId);
  const next = structuredClone(state) as ProductionWatchState;
  recoverExpiredLeases(next, now);
  const incident = requireIncident(next, fingerprint);
  if (incident.owner?.sessionId !== sessionId) {
    throw new Error("incident_lease_not_owned");
  }
  if (incident.source !== "database" && target !== "escalated") {
    throw new Error("provider_incident_escalation_only");
  }
  const from = incident.state;
  if (!INCIDENT_TRANSITIONS[from].has(target)) {
    throw new Error(`incident_transition_invalid_${from}_to_${target}`);
  }
  if (TERMINAL_INCIDENT_STATES.has(target)) {
    assertTerminalTransitionAuthority(next, incident, target, now);
  }
  incident.state = target;
  if (TERMINAL_INCIDENT_STATES.has(target)) {
    incident.owner = undefined;
  }
  if (TERMINAL_INCIDENT_STATES.has(target)) {
    incident.resolvedAt = now.toISOString();
  }
  appendTransition(incident, { at: now.toISOString(), from, to: target, sessionId });
  next.updatedAt = now.toISOString();
  return next;
}

function assertTerminalTransitionAuthority(
  state: ProductionWatchState,
  incident: IncidentRecord,
  target: IncidentState,
  now: Date,
): void {
  if (incident.category === "sensitive" || incident.source === "stripe") {
    throw new Error("incident_terminal_escalation_only");
  }
  const { monitor } = state;
  if (
    monitor.lastMonitorStatus !== "healthy"
    || monitor.lastEvidenceComplete !== true
    || monitor.lastRunAt === undefined
    || monitor.lastCompleteEvidenceAt === undefined
    || monitor.lastRunAt !== monitor.lastCompleteEvidenceAt
  ) {
    throw new Error("incident_terminal_evidence_incomplete");
  }
  const evidenceAgeMs = now.getTime() - Date.parse(monitor.lastRunAt);
  if (evidenceAgeMs < 0 || evidenceAgeMs > 10 * 60 * 1_000) {
    throw new Error("incident_terminal_evidence_stale");
  }
  if (
    target === "resolved"
    && Date.parse(monitor.lastCompleteEvidenceAt) <= Date.parse(incident.lastDetectedAt)
  ) {
    throw new Error("incident_resolution_requires_later_clean_evidence");
  }
}

export function filterSnapshotForIncident(
  snapshot: ProductionWatchSnapshot,
  incident: IncidentRecord,
): ProductionWatchSnapshot {
  const metricSignal = parseMetricSignalCode(incident.signalCode);
  const matchesDimensions = (dimensions: Record<string, string>): boolean => {
    const sourceMatch = dimensions.source === incident.source;
    const componentMatch = incident.component === undefined || dimensions.component === incident.component;
    const phaseMatch = incident.phase === undefined || dimensions.phase === incident.phase;
    const errorMatch = incident.errorCode === undefined || dimensions.error_code === incident.errorCode;
    const kindMatch = incident.issueKind === undefined || dimensions.issue_kind === incident.issueKind;
    return sourceMatch && componentMatch && phaseMatch && errorMatch && kindMatch;
  };
  return {
    ...snapshot,
    counters: snapshot.counters.filter((counter) => metricSignal === undefined
      ? matchesDimensions(counter.dimensions)
      : dimensionsKey(counter.dimensions) === metricSignal.dimensionsKey
        && (
          counter.metric === metricSignal.metric
          || counter.metric === rateDenominatorMetric(metricSignal.metric)
        )),
    latency: snapshot.latency.filter((summary) => metricSignal === undefined
      ? matchesDimensions(summary.dimensions)
      : summary.metric === metricSignal.metric
        && dimensionsKey(summary.dimensions) === metricSignal.dimensionsKey),
    fingerprints: snapshot.fingerprints.filter(
      (fingerprint) => fingerprint.fingerprint === incident.sourceFingerprint
        || (
          fingerprint.source === incident.source
          && (incident.component === undefined || fingerprint.component === incident.component)
          && (incident.phase === undefined || fingerprint.phase === incident.phase)
          && (incident.errorCode === undefined || fingerprint.errorCode === incident.errorCode)
        ),
    ),
    anomalyCandidates: snapshot.anomalyCandidates.filter(
      (candidate) => candidate.fingerprint === incident.fingerprint
        || (
          incident.sourceFingerprint !== undefined
          && candidate.source === incident.source
          && candidate.sourceFingerprint === incident.sourceFingerprint
        ),
    ),
  };
}

export function renderActiveIncidents(state: ProductionWatchState): string {
  const active = state.incidents
    .filter((incident) => !TERMINAL_INCIDENT_STATES.has(incident.state))
    .sort((left, right) => severityRank(right.severity) - severityRank(left.severity)
      || Date.parse(left.firstDetectedAt) - Date.parse(right.firstDetectedAt));
  const lines = [
    "# Active production-watch incidents",
    "",
    `Generated: ${state.updatedAt}`,
    "",
  ];
  if (active.length === 0) {
    lines.push("No active incidents.", "");
    return lines.join("\n");
  }
  lines.push(
    "| Incident ID | Source | Severity | State | Fingerprint | Signal | First seen | Last seen | Session | Lease expiry |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const incident of active) {
    lines.push([
      incident.id,
      incident.source,
      incident.severity,
      incident.state,
      incident.fingerprint.slice(0, 16),
      incident.signalCode,
      incident.firstDetectedAt,
      incident.lastDetectedAt,
      incident.owner?.sessionId ?? "—",
      incident.owner?.expiresAt ?? "—",
    ].map(escapeMarkdownCell).join(" | ").replace(/^/u, "| ").replace(/$/u, " |"));
  }
  lines.push("");
  return lines.join("\n");
}

export function renderIncidentHistory(state: ProductionWatchState): string {
  const incidents = [...state.incidents]
    .sort((left, right) => Date.parse(right.lastDetectedAt) - Date.parse(left.lastDetectedAt))
    .slice(0, 200);
  const lines = [
    "# Production-watch incident history",
    "",
    `Generated: ${state.updatedAt}`,
    "",
    "| Incident ID | Source | Fingerprint | Severity | State | Discovered | Last seen | Sessions | Resolved |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const incident of incidents) {
    lines.push([
      incident.id,
      incident.source,
      incident.fingerprint.slice(0, 16),
      incident.severity,
      incident.state,
      incident.firstDetectedAt,
      incident.lastDetectedAt,
      incident.handlingSessions.join(", ") || "—",
      incident.resolvedAt ?? "—",
    ].map(escapeMarkdownCell).join(" | ").replace(/^/u, "| ").replace(/$/u, " |"));
  }
  lines.push("");
  return lines.join("\n");
}

export function renderMonitorStatus(state: ProductionWatchState): string {
  const activeCount = state.incidents.filter((incident) => !TERMINAL_INCIDENT_STATES.has(incident.state)).length;
  const lines = [
    "# Production-watch monitor status",
    "",
    `Updated: ${state.updatedAt}`,
    `Last monitor status: ${state.monitor.lastMonitorStatus ?? "never"}`,
    `Last evidence complete: ${state.monitor.lastEvidenceComplete ?? "unknown"}`,
    `Last run: ${state.monitor.lastRunAt ?? "never"}`,
    `Last successful deterministic collection: ${state.monitor.lastSuccessfulCollectionAt ?? "never"}`,
    `Last complete all-source evidence: ${state.monitor.lastCompleteEvidenceAt ?? "never"}`,
    `Last duration (ms): ${state.monitor.lastDurationMs ?? "unknown"}`,
    `Last scheduler lag (ms): ${state.monitor.lastSchedulerLagMs ?? "unknown"}`,
    `Consecutive collection failures: ${state.monitor.consecutiveCollectionFailures}`,
    `Skipped overlapping ticks: ${state.monitor.skippedOverlapCount}`,
    `Active incidents: ${activeCount}`,
    `Configured sources: ${state.monitor.configuredSources.join(", ")}`,
    "",
  ];
  if (state.monitor.lastSourceHealth.length > 0) {
    lines.push(
      "| Source | Status | Auth | Coverage | Freshness (s) | Error | Failure streak |",
      "| --- | --- | --- | --- | ---: | --- | ---: |",
    );
    for (const source of state.monitor.lastSourceHealth) {
      lines.push([
        source.source,
        source.status,
        source.auth,
        source.coverage,
        source.freshnessSeconds === undefined ? "—" : String(Math.round(source.freshnessSeconds)),
        source.errorCode ?? "—",
        String(state.monitor.sourceFailureStreaks[source.source] ?? 0),
      ].map(escapeMarkdownCell).join(" | ").replace(/^/u, "| ").replace(/$/u, " |"));
    }
    lines.push("");
  }
  return lines.join("\n");
}

export async function readState(statePath: string, configuredSources: WatchSource[], now: Date): Promise<ProductionWatchState> {
  try {
    const raw = await readFile(statePath, "utf8");
    const state = parseState(JSON.parse(raw) as unknown);
    recoverExpiredLeases(state, now);
    return state;
  } catch (error) {
    if (isMissingPathError(error)) {
      return createInitialState(now, configuredSources);
    }
    if (error instanceof SyntaxError) {
      throw new Error("state_json_invalid", { cause: error });
    }
    throw error;
  }
}

export async function atomicWriteText(
  targetPath: string,
  content: string,
  options: { privateDirectory?: boolean } = {},
): Promise<void> {
  const directory = path.dirname(targetPath);
  if (options.privateDirectory === false) {
    await ensureSafeDirectory(directory);
  } else {
    await ensurePrivateDirectory(directory);
  }
  const tempPath = path.join(directory, `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`);
  let renamed = false;
  try {
    const handle = await open(tempPath, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tempPath, targetPath);
    renamed = true;
    await chmod(targetPath, 0o600);
    try {
      const directoryHandle = await open(directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch {
      // Directory fsync is not uniformly supported; the file itself was synced.
    }
  } finally {
    if (!renamed) {
      await rm(tempPath, { force: true });
    }
  }
}

export async function atomicWriteJson(targetPath: string, value: unknown): Promise<void> {
  await atomicWriteText(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function ensurePrivateDirectory(directory: string): Promise<void> {
  await ensureSafeDirectory(directory);
  await chmod(directory, 0o700);
}

async function ensureSafeDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error("runtime_directory_unsafe");
  }
}

export async function acquireDirectoryLock(input: {
  lockPath: string;
  runId: string;
  purpose: string;
  waitMs: number;
  staleMetadataGraceMs?: number;
}): Promise<LockClaim> {
  const startedAt = Date.now();
  const graceMs = input.staleMetadataGraceMs ?? 10_000;
  await ensurePrivateDirectory(input.lockPath);

  const claimId = `${process.pid}-${randomUUID()}`;
  const claimPath = path.join(input.lockPath, `claim-${claimId}.json`);
  await atomicWriteJson(claimPath, {
    schemaVersion: 1,
    pid: process.pid,
    runId: normalizeToken(input.runId, 96),
    purpose: normalizeToken(input.purpose, 64),
    startedAt: new Date().toISOString(),
  });

  let released = false;
  const release = async () => {
    if (released) {
      return;
    }
    released = true;
    await rm(claimPath, { force: true });
  };

  let winnerSince: number | undefined;
  try {
    while (true) {
      const claims = await listLiveLockClaims(input.lockPath, graceMs);
      const winner = claims[0];
      if (winner?.claimId === claimId) {
        winnerSince ??= Date.now();
        if (Date.now() - winnerSince >= LOCK_ELECTION_SETTLE_MS) {
          return { acquired: true, release };
        }
      } else {
        winnerSince = undefined;
        if (Date.now() - startedAt >= input.waitMs) {
          await release();
          return { acquired: false, ...(winner?.runId === undefined ? {} : { ownerRunId: winner.runId }) };
        }
      }
      await sleep(25);
    }
  } catch (error) {
    await release();
    throw error;
  }
}

interface LockClaimMetadata {
  claimId: string;
  pid?: number;
  runId?: string;
  orderMs: number;
  startedAtMs: number;
  stale: boolean;
}

async function listLiveLockClaims(lockPath: string, graceMs: number): Promise<LockClaimMetadata[]> {
  const entries = await readdir(lockPath, { withFileTypes: true });
  const claims: LockClaimMetadata[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith("claim-") || !entry.name.endsWith(".json")) {
      continue;
    }
    const claimPath = path.join(lockPath, entry.name);
    const claim = await readLockClaim(claimPath, entry.name.slice("claim-".length, -".json".length), graceMs);
    if (claim === undefined || claim.stale) {
      await rm(claimPath, { force: true });
      continue;
    }
    claims.push(claim);
  }
  return claims.sort((left, right) => left.orderMs - right.orderMs || left.claimId.localeCompare(right.claimId));
}

async function readLockClaim(
  claimPath: string,
  claimId: string,
  graceMs: number,
): Promise<LockClaimMetadata | undefined> {
  try {
    const metadata = await lstat(claimPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      return {
        claimId,
        orderMs: metadata.ctimeMs,
        startedAtMs: metadata.ctimeMs,
        stale: Date.now() - metadata.ctimeMs >= graceMs,
      };
    }
    try {
      const raw = JSON.parse(await readFile(claimPath, "utf8")) as {
        pid?: unknown;
        runId?: unknown;
        startedAt?: unknown;
      };
      const pid = typeof raw.pid === "number" && Number.isInteger(raw.pid) && raw.pid > 0 ? raw.pid : undefined;
      const runId = typeof raw.runId === "string" ? normalizeToken(raw.runId, 96) : undefined;
      const parsedStartedAt = typeof raw.startedAt === "string" ? Date.parse(raw.startedAt) : Number.NaN;
      const startedAtMs = Number.isFinite(parsedStartedAt) ? parsedStartedAt : metadata.mtimeMs;
      const ageMs = Date.now() - startedAtMs;
      const stale = ageMs > MAX_LOCK_CLAIM_AGE_MS
        || ageMs < -graceMs
        || (pid === undefined
          ? Date.now() - metadata.mtimeMs >= graceMs
          : !isProcessRunning(pid));
      return {
        claimId,
        ...(pid === undefined ? {} : { pid }),
        ...(runId === undefined ? {} : { runId }),
        orderMs: metadata.ctimeMs,
        startedAtMs,
        stale,
      };
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
      return {
        claimId,
        orderMs: metadata.ctimeMs,
        startedAtMs: metadata.ctimeMs,
        stale: Date.now() - metadata.ctimeMs >= graceMs,
      };
    }
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }
    throw error;
  }
}

export function stableHash(parts: Array<string | undefined>): string {
  return createHash("sha256")
    .update(parts.map((part) => part ?? "-").join("\u001f"), "utf8")
    .digest("hex");
}

export function normalizeToken(value: string, maxLength = 64): string {
  const trimmed = value.trim().slice(0, maxLength);
  if (trimmed.length === 0) {
    return "unknown";
  }
  if (SAFE_TOKEN_PATTERN.test(trimmed)) {
    return trimmed;
  }
  const normalized = trimmed.replace(/[^A-Za-z0-9._:/-]+/gu, "_").replace(/^_+|_+$/gu, "");
  return normalized.length > 0 ? normalized.slice(0, maxLength) : "unknown";
}

export function safeErrorCode(error: unknown): string {
  const candidate = error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string"
    ? (error as NodeJS.ErrnoException).code
    : error instanceof Error
      ? error.message
      : undefined;
  if (candidate === undefined) {
    return "internal_error";
  }
  if (candidate.length > 64 || !/^[A-Za-z0-9._-]{1,64}$/u.test(candidate)) {
    return "internal_error";
  }
  const normalized = candidate;
  if (
    UUID_PATTERN.test(normalized)
    || OPAQUE_DIRECT_ID_PATTERN.test(normalized)
    || SECRET_LIKE_PATTERN.test(normalized)
    || JWT_PATTERN.test(normalized)
    || NUMERIC_IDENTIFIER_PATTERN.test(normalized)
  ) {
    return "internal_error";
  }
  return normalized;
}

function evaluateCountCounter(
  counter: CounterSummary,
  rule: {
    ruleId: string;
    signalCode: string;
    minimumCount: number;
    ratio: number;
    absoluteDelta: number;
  },
  observedAt: string,
  releases: ReleaseContext[],
): AnomalyCandidate | undefined {
  if (counter.previous === undefined) {
    return undefined;
  }
  const baseline = counter.previous;
  if (
    counter.current < rule.minimumCount
    || counter.current < baseline * rule.ratio
    || counter.current - baseline < rule.absoluteDelta
  ) {
    return undefined;
  }
  const source = readSourceFromDimensions(counter.dimensions) ?? "database";
  const release = findCorrelatedRelease(releases, source, new Date(observedAt));
  return makeAnomaly({
    fingerprintMetric: counter.metric,
    fingerprintDimensions: counter.dimensions,
    ruleId: rule.ruleId,
    severity: counter.current >= Math.max(50, baseline * 10) ? "high" : "medium",
    category: "availability",
    source,
    signalCode: rule.signalCode,
    observedAt,
    component: counter.dimensions.component,
    phase: counter.dimensions.phase,
    releaseSha: release?.sha,
    evidence: [{
      metric: counter.metric,
      current: counter.current,
      baseline,
      threshold: Math.max(rule.minimumCount, baseline * rule.ratio, baseline + rule.absoluteDelta),
      unit: "count",
    }],
    minimumConsecutiveRuns: 2,
    automationClass: release === undefined ? "diagnosis_only" : "remediation_candidate",
    deploymentCorrelated: release !== undefined,
  });
}

function evaluateRateCounter(
  counter: CounterSummary,
  rule: {
    ruleId: string;
    signalCode: string;
    minimumCount: number;
    minimumVolume: number;
    fixedRate: number;
    minimumRate: number;
    ratio: number;
    absoluteDelta: number;
  },
  observedAt: string,
  releases: ReleaseContext[],
): AnomalyCandidate | undefined {
  if (counter.sampleCount === undefined || counter.sampleCount < rule.minimumVolume || counter.current < rule.minimumCount) {
    return undefined;
  }
  const currentRate = counter.current / Math.max(1, counter.sampleCount);
  const baselineReady = counter.previous !== undefined
    && counter.previousSampleCount !== undefined
    && counter.previousSampleCount >= rule.minimumVolume;
  const baselineRate = baselineReady
    ? (counter.previous ?? 0) / Math.max(1, counter.previousSampleCount ?? 1)
    : undefined;
  const regression = baselineRate === undefined
    ? currentRate >= rule.fixedRate
    : currentRate >= rule.minimumRate
      && currentRate >= baselineRate * rule.ratio
      && currentRate - baselineRate >= rule.absoluteDelta;
  if (!regression) {
    return undefined;
  }
  const source = readSourceFromDimensions(counter.dimensions) ?? "database";
  const sensitive = source === "stripe";
  const release = findCorrelatedRelease(releases, source, new Date(observedAt));
  return makeAnomaly({
    fingerprintMetric: counter.metric,
    fingerprintDimensions: counter.dimensions,
    ruleId: rule.ruleId,
    severity: sensitive || currentRate >= 0.1 ? "high" : "medium",
    category: sensitive ? "sensitive" : "availability",
    source,
    signalCode: rule.signalCode,
    observedAt,
    component: counter.dimensions.component,
    phase: counter.dimensions.phase,
    releaseSha: release?.sha,
    evidence: [{
      metric: `${counter.metric}_rate`,
      current: currentRate,
      ...(baselineRate === undefined ? {} : { baseline: baselineRate }),
      threshold: baselineRate === undefined ? rule.fixedRate : Math.max(rule.minimumRate, baselineRate * rule.ratio),
      unit: "ratio",
    }],
    minimumConsecutiveRuns: 2,
    automationClass: sensitive
      ? "alert_only"
      : release === undefined
        ? "diagnosis_only"
        : "remediation_candidate",
    deploymentCorrelated: release !== undefined,
  });
}

function makeAnomaly(
  input: Omit<AnomalyCandidate, "fingerprint"> & {
    fingerprintMetric?: string;
    fingerprintDimensions?: Record<string, string>;
  },
): AnomalyCandidate {
  const { fingerprintMetric, fingerprintDimensions, ...candidate } = input;
  const signalCode = fingerprintMetric === undefined || fingerprintDimensions === undefined
    ? candidate.signalCode
    : metricSignalCode(fingerprintMetric, fingerprintDimensions);
  const fingerprint = stableHash([
    "incident",
    candidate.ruleId,
    candidate.source,
    candidate.component,
    candidate.phase,
    candidate.errorCode,
    candidate.issueKind,
    candidate.sourceFingerprint,
    fingerprintMetric,
    fingerprintDimensions === undefined ? undefined : dimensionsKey(fingerprintDimensions),
  ]);
  return { ...candidate, signalCode, fingerprint };
}

function deduplicateAnomalies(anomalies: AnomalyCandidate[]): AnomalyCandidate[] {
  const byFingerprint = new Map<string, AnomalyCandidate>();
  for (const anomaly of anomalies) {
    const existing = byFingerprint.get(anomaly.fingerprint);
    if (existing === undefined) {
      byFingerprint.set(anomaly.fingerprint, anomaly);
      continue;
    }
    existing.severity = maxSeverity(existing.severity, anomaly.severity);
    existing.minimumConsecutiveRuns = Math.max(existing.minimumConsecutiveRuns, anomaly.minimumConsecutiveRuns);
    existing.deploymentCorrelated ||= anomaly.deploymentCorrelated;
    existing.releaseSha ??= anomaly.releaseSha;
    for (const evidence of anomaly.evidence) {
      if (existing.evidence.some((candidate) => candidate.metric === evidence.metric)) {
        continue;
      }
      existing.evidence.push(evidence);
      if (existing.evidence.length === 4) {
        break;
      }
    }
  }
  return [...byFingerprint.values()];
}

function findCorrelatedRelease(
  releases: ReleaseContext[],
  source: WatchSource,
  now: Date,
): ReleaseContext | undefined {
  return releases.find((release) => release.source === source
    && release.current
    && release.deployedAt !== undefined
    && now.getTime() - Date.parse(release.deployedAt) >= 0
    && now.getTime() - Date.parse(release.deployedAt) <= 60 * 60 * 1_000);
}

function findReleaseBySha(
  releases: ReleaseContext[],
  sha: string,
  now: Date,
): ReleaseContext | undefined {
  return releases.find((release) => release.sha === sha
    && release.deployedAt !== undefined
    && now.getTime() - Date.parse(release.deployedAt) >= 0
    && now.getTime() - Date.parse(release.deployedAt) <= 60 * 60 * 1_000);
}

function enrichCumulativeCounters(
  counters: CounterSummary[],
  previous: Record<string, number>,
): CounterSummary[] {
  return counters.map((counter) => {
    if (!counter.metric.endsWith("_total")) {
      return counter;
    }
    const key = counterKey(counter);
    const previousValue = previous[key];
    return previousValue === undefined ? counter : { ...counter, previous: previousValue };
  });
}

function extractCumulativeCounters(counters: CounterSummary[]): Record<string, number> {
  return Object.fromEntries(
    counters
      .filter((counter) => counter.metric.endsWith("_total"))
      .map((counter) => [counterKey(counter), counter.current]),
  );
}

function counterKey(counter: CounterSummary): string {
  return stableHash([
    counter.metric,
    ...Object.entries(counter.dimensions).sort(([left], [right]) => left.localeCompare(right)).flat(),
  ]);
}

function compareReleases(left: ReleaseContext, right: ReleaseContext): number {
  return Number(right.current) - Number(left.current)
    || left.source.localeCompare(right.source)
    || left.runtime.localeCompare(right.runtime)
    || Date.parse(right.deployedAt ?? right.observedAt) - Date.parse(left.deployedAt ?? left.observedAt)
    || left.sha.localeCompare(right.sha);
}

function compareCounters(left: CounterSummary, right: CounterSummary): number {
  return left.metric.localeCompare(right.metric)
    || dimensionsKey(left.dimensions).localeCompare(dimensionsKey(right.dimensions));
}

function compareLatency(left: LatencySummary, right: LatencySummary): number {
  return left.metric.localeCompare(right.metric)
    || dimensionsKey(left.dimensions).localeCompare(dimensionsKey(right.dimensions));
}

function compareFailures(left: CollectorFailure, right: CollectorFailure): number {
  return left.source.localeCompare(right.source)
    || left.class.localeCompare(right.class)
    || left.code.localeCompare(right.code);
}

function dimensionsKey(dimensions: Record<string, string>): string {
  return Object.entries(dimensions)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\u001f");
}

function metricSignalCode(metric: string, dimensions: Record<string, string>): string {
  return [
    metric,
    ...Object.entries(dimensions)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`),
  ].join("|");
}

function parseMetricSignalCode(
  signalCode: string,
): { metric: string; dimensions: Record<string, string>; dimensionsKey: string } | undefined {
  const [metric, ...dimensionParts] = signalCode.split("|");
  if (
    dimensionParts.length === 0
    || (!ALLOWED_METRICS.has(metric!) && !ALLOWED_LATENCY_METRICS.has(metric!))
  ) {
    return undefined;
  }
  const dimensions: Record<string, string> = {};
  for (const part of dimensionParts) {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      return undefined;
    }
    const key = part.slice(0, separator);
    const value = part.slice(separator + 1);
    if (!ALLOWED_DIMENSIONS.has(key) || dimensions[key] !== undefined || !SAFE_TOKEN_PATTERN.test(value)) {
      return undefined;
    }
    dimensions[key] = value;
  }
  if (dimensions.source === undefined) {
    return undefined;
  }
  return { metric: metric!, dimensions, dimensionsKey: dimensionsKey(dimensions) };
}

function rateDenominatorMetric(metric: string): string | undefined {
  if (["deployment_error_count", "provider_error_count", "provider_timeout_count"].includes(metric)) {
    return "provider_request_count";
  }
  return metric === "ingress_incomplete_count" ? "ingress_accepted_count" : undefined;
}

function providerRateEvidenceComplete(evidence: AdapterEvidence): boolean {
  if (evidence.status !== "ok" || evidence.auth !== "ok") {
    return false;
  }
  if (evidence.counters.some((counter) => (
    counter.sampleCount !== undefined || counter.previousSampleCount !== undefined
  ))) {
    return false;
  }
  const requests = evidence.counters.filter((counter) => counter.metric === "provider_request_count");
  if (requests.length === 0) {
    return false;
  }
  const requestsByDimensions = new Map(
    requests.map((counter) => [dimensionsKey(counter.dimensions), counter]),
  );
  const numerators = evidence.counters.filter((counter) => (
    counter.metric === "deployment_error_count"
    || counter.metric === "provider_error_count"
    || counter.metric === "provider_timeout_count"
  ));
  for (const request of requests) {
    const key = dimensionsKey(request.dimensions);
    if (REQUIRED_PROVIDER_RATE_NUMERATORS.some((metric) => (
      !numerators.some((counter) => counter.metric === metric && dimensionsKey(counter.dimensions) === key)
    ))) {
      return false;
    }
  }
  return numerators.every((counter) => {
    const request = requestsByDimensions.get(dimensionsKey(counter.dimensions));
    if (request === undefined || counter.current > request.current) {
      return false;
    }
    if ((counter.previous === undefined) !== (request.previous === undefined)) {
      return false;
    }
    return counter.previous === undefined
      || request.previous === undefined
      || counter.previous <= request.previous;
  });
}

function withProviderRateDenominator(
  counter: CounterSummary,
  counters: CounterSummary[],
): CounterSummary {
  if (![
    "deployment_error_count",
    "provider_error_count",
    "provider_timeout_count",
  ].includes(counter.metric)) {
    return counter;
  }
  const {
    sampleCount: _ignoredSampleCount,
    previousSampleCount: _ignoredPreviousSampleCount,
    ...counterWithoutProducerDenominator
  } = counter;
  const request = counters.find((candidate) => (
    candidate.metric === "provider_request_count"
    && dimensionsKey(candidate.dimensions) === dimensionsKey(counter.dimensions)
  ));
  if (request === undefined) {
    return counterWithoutProducerDenominator;
  }
  return {
    ...counterWithoutProducerDenominator,
    sampleCount: request.current,
    ...(counter.previous === undefined || request.previous === undefined
      ? {}
      : { previousSampleCount: request.previous }),
  };
}

function incidentFromCandidate(candidate: AnomalyCandidate, at: string): IncidentRecord {
  return {
    id: `pw_${candidate.fingerprint.slice(0, 20)}`,
    fingerprint: candidate.fingerprint,
    state: "candidate",
    severity: candidate.severity,
    category: candidate.category,
    automationClass: candidate.automationClass,
    source: candidate.source,
    ruleId: candidate.ruleId,
    signalCode: candidate.signalCode,
    ...(candidate.component === undefined ? {} : { component: candidate.component }),
    ...(candidate.phase === undefined ? {} : { phase: candidate.phase }),
    ...(candidate.errorCode === undefined ? {} : { errorCode: candidate.errorCode }),
    ...(candidate.issueKind === undefined ? {} : { issueKind: candidate.issueKind }),
    ...(candidate.releaseSha === undefined ? {} : { releaseSha: candidate.releaseSha }),
    ...(candidate.sourceFingerprint === undefined ? {} : { sourceFingerprint: candidate.sourceFingerprint }),
    firstDetectedAt: at,
    lastDetectedAt: at,
    occurrenceCount: 1,
    lastEvidence: candidate.evidence.slice(0, 4),
    staleLeaseRecoveries: 0,
    handlingSessions: [],
    transitions: [{ at, to: "candidate" }],
  };
}

function tightenIncidentPolicy(incident: IncidentRecord, candidate: AnomalyCandidate): void {
  const automationRank: Readonly<Record<AutomationClass, number>> = {
    remediation_candidate: 0,
    diagnosis_only: 1,
    alert_only: 2,
  };
  const sensitive = incident.category === "sensitive"
    || candidate.category === "sensitive"
    || incident.source === "stripe";
  if (sensitive) {
    incident.category = "sensitive";
    incident.automationClass = "alert_only";
  } else if (automationRank[candidate.automationClass] > automationRank[incident.automationClass]) {
    incident.automationClass = candidate.automationClass;
  }

}

function recoverExpiredLeases(state: ProductionWatchState, now: Date): void {
  for (const incident of state.incidents) {
    if (incident.owner === undefined || Date.parse(incident.owner.expiresAt) > now.getTime()) {
      continue;
    }
    const from = incident.state;
    const sessionId = incident.owner.sessionId;
    incident.owner = undefined;
    if (incident.state === "claimed_triage" || incident.state === "investigating") {
      incident.state = "candidate";
    }
    incident.staleLeaseRecoveries += 1;
    appendTransition(incident, { at: now.toISOString(), from, to: incident.state, sessionId });
  }
}

function pruneIncidents(incidents: IncidentRecord[], now: Date): IncidentRecord[] {
  const active = incidents.filter((incident) => !TERMINAL_INCIDENT_STATES.has(incident.state));
  const terminal = incidents
    .filter((incident) => TERMINAL_INCIDENT_STATES.has(incident.state))
    .filter((incident) => incident.resolvedAt === undefined
      || now.getTime() - Date.parse(incident.resolvedAt) <= INCIDENT_RETENTION_MS)
    .sort((left, right) => Date.parse(right.resolvedAt ?? right.lastDetectedAt) - Date.parse(left.resolvedAt ?? left.lastDetectedAt));
  return [...active, ...terminal].slice(0, MAX_INCIDENTS);
}

function appendTransition(incident: IncidentRecord, transition: IncidentTransition): void {
  incident.transitions.push(transition);
  incident.transitions = incident.transitions.slice(-MAX_TRANSITIONS);
}

function requireIncident(state: ProductionWatchState, fingerprint: string): IncidentRecord {
  const incident = state.incidents.find(
    (candidate) => candidate.fingerprint === fingerprint || candidate.id === fingerprint,
  );
  if (incident === undefined) {
    throw new Error("incident_not_found");
  }
  return incident;
}

function parseReleaseContext(value: unknown, defaultSource?: WatchSource): ReleaseContext {
  const object = readObject(value, "release context");
  assertExactKeys(object, ["current", "deployedAt", "observedAt", "runtime", "sha", "source"], "release context", true);
  const source = object.source === undefined && defaultSource !== undefined
    ? defaultSource
    : readEnum(object.source, [...WATCH_SOURCES, "repository"] as const, "release source");
  if (defaultSource !== undefined && source !== defaultSource) {
    throw new Error("release_source_mismatch");
  }
  const sha = typeof object.sha === "string" ? object.sha.toLowerCase() : "";
  if (!RELEASE_SHA_PATTERN.test(sha)) {
    throw new Error("release_sha_invalid");
  }
  return {
    source,
    runtime: readEvidenceToken(object.runtime, "release runtime", 64),
    sha,
    observedAt: readIsoTimestamp(object.observedAt, "release observedAt"),
    ...(object.deployedAt === undefined ? {} : { deployedAt: readIsoTimestamp(object.deployedAt, "release deployedAt") }),
    current: readBoolean(object.current, "release current"),
  };
}

function parseCounterSummary(value: unknown): CounterSummary {
  const object = readObject(value, "counter");
  assertExactKeys(object, ["current", "dimensions", "metric", "previous", "previousSampleCount", "sampleCount", "unit"], "counter", true);
  const metric = readToken(object.metric, "counter metric", 64);
  if (!ALLOWED_METRICS.has(metric)) {
    throw new Error(`counter_metric_unsupported_${metric}`);
  }
  const unit = readEnum(object.unit, ["count", "ratio", "bytes", "milliseconds"] as const, "counter unit");
  if (unit !== METRIC_UNITS[metric]) {
    throw new Error("counter_unit_invalid");
  }
  const current = readNonNegativeNumber(object.current, "counter current");
  const previous = object.previous === undefined ? undefined : readNonNegativeNumber(object.previous, "counter previous");
  const sampleCount = object.sampleCount === undefined
    ? undefined
    : readNonNegativeNumber(object.sampleCount, "counter sampleCount");
  const previousSampleCount = object.previousSampleCount === undefined
    ? undefined
    : readNonNegativeNumber(object.previousSampleCount, "counter previousSampleCount");
  if (unit === "count" && (![current, previous, sampleCount, previousSampleCount]
    .filter((value): value is number => value !== undefined)
    .every(Number.isInteger))) {
    throw new Error("counter_count_not_integer");
  }
  if (unit === "ratio" && (current > 1 || (previous !== undefined && previous > 1))) {
    throw new Error("counter_ratio_out_of_range");
  }
  if (RATE_NUMERATOR_METRICS.has(metric)) {
    if (sampleCount !== undefined && current > sampleCount) {
      throw new Error("counter_current_exceeds_sample_count");
    }
    if (previous !== undefined && previousSampleCount !== undefined && previous > previousSampleCount) {
      throw new Error("counter_previous_exceeds_sample_count");
    }
  }
  return {
    metric,
    dimensions: parseDimensions(object.dimensions),
    unit,
    current,
    ...(previous === undefined ? {} : { previous }),
    ...(sampleCount === undefined ? {} : { sampleCount }),
    ...(previousSampleCount === undefined ? {} : { previousSampleCount }),
  };
}

function parseLatencySummary(value: unknown): LatencySummary {
  const object = readObject(value, "latency");
  assertExactKeys(object, [
    "baselineCount",
    "baselineP95Ms",
    "baselineP99Ms",
    "count",
    "dimensions",
    "maxMs",
    "metric",
    "p50Ms",
    "p95Ms",
    "p99Ms",
  ], "latency", true);
  const metric = readToken(object.metric, "latency metric", 64);
  if (!ALLOWED_LATENCY_METRICS.has(metric)) {
    throw new Error(`latency_metric_unsupported_${metric}`);
  }
  const p50Ms = readNonNegativeNumber(object.p50Ms, "latency p50");
  const p95Ms = readNonNegativeNumber(object.p95Ms, "latency p95");
  const p99Ms = readNonNegativeNumber(object.p99Ms, "latency p99");
  const maxMs = readNonNegativeNumber(object.maxMs, "latency max");
  if (p50Ms > p95Ms || p95Ms > p99Ms || p99Ms > maxMs) {
    throw new Error("latency_percentiles_invalid");
  }
  return {
    metric,
    dimensions: parseDimensions(object.dimensions),
    count: readNonNegativeInteger(object.count, "latency count"),
    p50Ms,
    p95Ms,
    p99Ms,
    maxMs,
    ...(object.baselineCount === undefined ? {} : { baselineCount: readNonNegativeInteger(object.baselineCount, "latency baseline count") }),
    ...(object.baselineP95Ms === undefined ? {} : { baselineP95Ms: readNonNegativeNumber(object.baselineP95Ms, "latency baseline p95") }),
    ...(object.baselineP99Ms === undefined ? {} : { baselineP99Ms: readNonNegativeNumber(object.baselineP99Ms, "latency baseline p99") }),
  };
}

function parseAdapterFingerprint(
  value: unknown,
  defaultSource: WatchSource,
): Omit<FingerprintSummary, "fingerprint"> & { rawFingerprint: string } {
  const object = readObject(value, "fingerprint");
  assertExactKeys(object, [
    "component",
    "count",
    "errorCode",
    "firstSeenAt",
    "issueKind",
    "lastSeenAt",
    "phase",
    "previousCount",
    "rawFingerprint",
    "releaseSha",
    "severity",
    "source",
  ], "fingerprint", true);
  const source = object.source === undefined ? defaultSource : readWatchSource(object.source, "fingerprint source");
  if (source !== defaultSource) {
    throw new Error("fingerprint_source_mismatch");
  }
  const rawFingerprint = readEvidenceToken(object.rawFingerprint, "fingerprint value", 256);
  return {
    rawFingerprint,
    source,
    component: readEvidenceToken(object.component, "fingerprint component", 64),
    phase: readEvidenceToken(object.phase, "fingerprint phase", 64),
    severity: readEnum(object.severity, ["low", "medium", "high", "critical"] as const, "fingerprint severity"),
    count: readNonNegativeInteger(object.count, "fingerprint count"),
    previousCount: readNonNegativeInteger(object.previousCount, "fingerprint previousCount"),
    firstSeenAt: readIsoTimestamp(object.firstSeenAt, "fingerprint firstSeenAt"),
    lastSeenAt: readIsoTimestamp(object.lastSeenAt, "fingerprint lastSeenAt"),
    ...(object.errorCode === undefined || object.errorCode === null ? {} : { errorCode: readEvidenceToken(object.errorCode, "fingerprint errorCode", 64) }),
    ...(object.issueKind === undefined || object.issueKind === null ? {} : { issueKind: readEvidenceToken(object.issueKind, "fingerprint issueKind", 64) }),
    ...(object.releaseSha === undefined || object.releaseSha === null
      ? {}
      : { releaseSha: readReleaseSha(object.releaseSha, "fingerprint releaseSha") }),
  };
}

function parseCollectorFailure(value: unknown): CollectorFailure {
  const object = readObject(value, "collector failure");
  assertExactKeys(object, ["class", "code", "retryable", "source"], "collector failure");
  return {
    source: readWatchSource(object.source, "failure source"),
    class: readEnum(object.class, ["auth", "timeout", "rate_limit", "schema", "unavailable", "internal"] as const, "failure class"),
    code: readEvidenceToken(object.code, "failure code", 64),
    retryable: readBoolean(object.retryable, "failure retryable"),
  };
}

function parseSourceHealth(value: unknown): SourceHealth {
  const object = readObject(value, "source health");
  assertExactKeys(object, [
    "access",
    "auth",
    "collectedAt",
    "coverage",
    "errorCode",
    "freshnessSeconds",
    "source",
    "status",
  ], "source health", true);
  return {
    source: readWatchSource(object.source, "source health source"),
    status: readEnum(object.status, ["ok", "degraded", "unavailable", "not_collected"] as const, "source health status"),
    auth: readEnum(object.auth, ["ok", "failed", "not_required", "unknown"] as const, "source health auth"),
    coverage: readEnum(object.coverage, ["complete", "partial", "none", "on_demand"] as const, "source health coverage"),
    access: readEnum(object.access, ["deterministic", "mcp_on_demand"] as const, "source health access"),
    ...(object.collectedAt === undefined ? {} : { collectedAt: readIsoTimestamp(object.collectedAt, "source health collectedAt") }),
    ...(object.freshnessSeconds === undefined
      ? {}
      : { freshnessSeconds: readNonNegativeNumber(object.freshnessSeconds, "source health freshnessSeconds") }),
    ...(object.errorCode === undefined ? {} : { errorCode: readEvidenceToken(object.errorCode, "source health errorCode", 64) }),
  };
}

function parseIncidentRecord(value: unknown): IncidentRecord {
  const object = readObject(value, "incident");
  assertExactKeys(object, [
    "automationClass",
    "category",
    "component",
    "errorCode",
    "fingerprint",
    "firstDetectedAt",
    "handlingSessions",
    "id",
    "issueKind",
    "lastDetectedAt",
    "lastEvidence",
    "occurrenceCount",
    "owner",
    "phase",
    "releaseSha",
    "resolvedAt",
    "ruleId",
    "severity",
    "source",
    "sourceFingerprint",
    "staleLeaseRecoveries",
    "state",
    "signalCode",
    "transitions",
  ], "incident", true);
  const state = readEnum(object.state, [
    "candidate",
    "claimed_triage",
    "investigating",
    "confirmed",
    "monitor_incomplete",
    "false_positive",
    "escalated",
    "resolved",
  ] as const, "incident state");
  const owner = object.owner === undefined ? undefined : parseIncidentLease(object.owner);
  const handlingSessions = readArray(object.handlingSessions, "incident handlingSessions", 8)
    .map((session) => readSessionId(session));
  const transitions = readArray(object.transitions, "incident transitions", MAX_TRANSITIONS)
    .map(parseIncidentTransition);
  const occurrenceCount = readNonNegativeInteger(object.occurrenceCount, "incident occurrenceCount");
  const firstDetectedAt = readIsoTimestamp(object.firstDetectedAt, "incident firstDetectedAt");
  const lastDetectedAt = readIsoTimestamp(object.lastDetectedAt, "incident lastDetectedAt");
  const resolvedAt = object.resolvedAt === undefined
    ? undefined
    : readIsoTimestamp(object.resolvedAt, "incident resolvedAt");
  const source = readWatchSource(object.source, "incident source");
  const category = readEnum(
    object.category,
    ["availability", "latency", "monitor", "pressure", "sensitive"] as const,
    "incident category",
  );
  const automationClass = readEnum(
    object.automationClass,
    ["alert_only", "diagnosis_only", "remediation_candidate"] as const,
    "incident automationClass",
  );
  const signalCode = readSignalCode(object.signalCode, "incident signalCode");
  const metricSignal = parseMetricSignalCode(signalCode);
  if (metricSignal !== undefined && metricSignal.dimensions.source !== source) {
    throw new Error("incident_signal_source_mismatch");
  }
  const record: IncidentRecord = {
    id: readToken(object.id, "incident id", 32),
    fingerprint: readHash(object.fingerprint, "incident fingerprint"),
    state,
    severity: readEnum(object.severity, ["low", "medium", "high", "critical"] as const, "incident severity"),
    category,
    automationClass,
    source,
    ruleId: readToken(object.ruleId, "incident ruleId", 64),
    signalCode,
    ...(object.component === undefined ? {} : { component: readEvidenceToken(object.component, "incident component", 64) }),
    ...(object.phase === undefined ? {} : { phase: readEvidenceToken(object.phase, "incident phase", 64) }),
    ...(object.errorCode === undefined ? {} : { errorCode: readEvidenceToken(object.errorCode, "incident errorCode", 64) }),
    ...(object.issueKind === undefined ? {} : { issueKind: readEvidenceToken(object.issueKind, "incident issueKind", 64) }),
    ...(object.releaseSha === undefined ? {} : { releaseSha: readReleaseSha(object.releaseSha, "incident releaseSha") }),
    ...(object.sourceFingerprint === undefined ? {} : { sourceFingerprint: readHash(object.sourceFingerprint, "incident sourceFingerprint") }),
    firstDetectedAt,
    lastDetectedAt,
    occurrenceCount,
    lastEvidence: readArray(object.lastEvidence, "incident lastEvidence", 4).map(parseAnomalyEvidence),
    ...(owner === undefined ? {} : { owner }),
    staleLeaseRecoveries: readNonNegativeInteger(object.staleLeaseRecoveries, "incident staleLeaseRecoveries"),
    handlingSessions,
    ...(resolvedAt === undefined ? {} : { resolvedAt }),
    transitions,
  };

  if (occurrenceCount < 1) {
    throw new Error("incident_occurrence_count_invalid");
  }
  if (Date.parse(firstDetectedAt) > Date.parse(lastDetectedAt)) {
    throw new Error("incident_detection_order_invalid");
  }
  if (new Set(handlingSessions).size !== handlingSessions.length) {
    throw new Error("incident_handling_session_duplicate");
  }
  if (transitions.length === 0 || transitions.at(-1)?.to !== state) {
    throw new Error("incident_transition_tail_invalid");
  }
  const terminal = TERMINAL_INCIDENT_STATES.has(state);
  if (terminal !== (resolvedAt !== undefined)) {
    throw new Error("incident_resolution_state_invalid");
  }
  if (resolvedAt !== undefined && Date.parse(resolvedAt) < Date.parse(lastDetectedAt)) {
    throw new Error("incident_resolution_order_invalid");
  }
  if (terminal && owner !== undefined) {
    throw new Error("terminal_incident_owner_forbidden");
  }
  if ((category === "sensitive" || source === "stripe") && automationClass !== "alert_only") {
    throw new Error("sensitive_incident_must_be_alert_only");
  }
  if (owner !== undefined && !handlingSessions.includes(owner.sessionId)) {
    throw new Error("incident_owner_session_unrecorded");
  }
  return record;
}

function parseIncidentLease(value: unknown): IncidentLease {
  const object = readObject(value, "incident lease");
  assertExactKeys(object, ["claimedAt", "expiresAt", "heartbeatAt", "leaseId", "sessionId"], "incident lease");
  const claimedAt = readIsoTimestamp(object.claimedAt, "lease claimedAt");
  const heartbeatAt = readIsoTimestamp(object.heartbeatAt, "lease heartbeatAt");
  const expiresAt = readIsoTimestamp(object.expiresAt, "lease expiresAt");
  if (Date.parse(claimedAt) > Date.parse(heartbeatAt) || Date.parse(heartbeatAt) >= Date.parse(expiresAt)) {
    throw new Error("incident_lease_time_order_invalid");
  }
  return {
    leaseId: readToken(object.leaseId, "lease id", 64),
    sessionId: readSessionId(object.sessionId),
    claimedAt,
    heartbeatAt,
    expiresAt,
  };
}

function parseIncidentTransition(value: unknown): IncidentTransition {
  const object = readObject(value, "incident transition");
  assertExactKeys(object, ["at", "from", "sessionId", "to"], "incident transition", true);
  const to = readEnum(object.to, [
    "candidate",
    "claimed_triage",
    "investigating",
    "confirmed",
    "monitor_incomplete",
    "false_positive",
    "escalated",
    "resolved",
  ] as const, "transition target");
  return {
    at: readIsoTimestamp(object.at, "transition at"),
    ...(object.from === undefined ? {} : { from: readEnum(object.from, [
      "candidate",
      "claimed_triage",
      "investigating",
      "confirmed",
      "monitor_incomplete",
      "false_positive",
      "escalated",
      "resolved",
    ] as const, "transition source") }),
    to,
    ...(object.sessionId === undefined ? {} : { sessionId: readSessionId(object.sessionId) }),
  };
}

function parseAnomalyEvidence(value: unknown): AnomalyEvidence {
  const object = readObject(value, "anomaly evidence");
  assertExactKeys(object, ["baseline", "current", "metric", "threshold", "unit"], "anomaly evidence", true);
  return {
    metric: readToken(object.metric, "evidence metric", 96),
    current: readNonNegativeNumber(object.current, "evidence current"),
    ...(object.baseline === undefined ? {} : { baseline: readNonNegativeNumber(object.baseline, "evidence baseline") }),
    threshold: readNonNegativeNumber(object.threshold, "evidence threshold"),
    unit: readEnum(object.unit, ["count", "ratio", "bytes", "milliseconds"] as const, "evidence unit"),
  };
}

function parseDimensions(value: unknown): Record<string, string> {
  const object = readObject(value, "dimensions");
  const entries = Object.entries(object);
  if (entries.length > 6) {
    throw new Error("dimensions_too_many");
  }
  const dimensions: Record<string, string> = {};
  for (const [key, rawValue] of entries) {
    if (!ALLOWED_DIMENSIONS.has(key)) {
      throw new Error(`dimension_key_forbidden_${normalizeToken(key)}`);
    }
    dimensions[key] = readEvidenceToken(rawValue, `dimension ${key}`, 64);
  }
  return dimensions;
}

function parseSourceFailureStreaks(value: unknown): Partial<Record<WatchSource, number>> {
  const object = readObject(value, "source failure streaks");
  const result: Partial<Record<WatchSource, number>> = {};
  for (const [key, count] of Object.entries(object)) {
    const source = readWatchSource(key, "source failure streak key");
    result[source] = readNonNegativeInteger(count, "source failure streak");
  }
  return result;
}

function parseAnomalyStreaks(value: unknown): ProductionWatchState["anomalyStreaks"] {
  const object = readObject(value, "anomaly streaks");
  if (Object.keys(object).length > 256) {
    throw new Error("anomaly_streaks_too_many");
  }
  return Object.fromEntries(Object.entries(object).map(([fingerprint, raw]) => {
    const streak = readObject(raw, "anomaly streak");
    assertExactKeys(streak, ["count", "lastSeenAt"], "anomaly streak");
    return [readHash(fingerprint, "anomaly streak fingerprint"), {
      count: readNonNegativeInteger(streak.count, "anomaly streak count"),
      lastSeenAt: readIsoTimestamp(streak.lastSeenAt, "anomaly streak lastSeenAt"),
    }];
  }));
}

function parseCumulativeCounters(value: unknown): Record<string, number> {
  const object = readObject(value, "cumulative counters");
  if (Object.keys(object).length > 32) {
    throw new Error("cumulative_counters_too_many");
  }
  return Object.fromEntries(Object.entries(object).map(([key, count]) => [
    readHash(key, "cumulative counter key"),
    readNonNegativeNumber(count, "cumulative counter value"),
  ]));
}


function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertUniqueBy<T>(values: T[], key: (value: T) => string, errorCode: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    const candidate = key(value);
    if (seen.has(candidate)) {
      throw new Error(errorCode);
    }
    seen.add(candidate);
  }
}

function readObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${normalizeToken(label)}_must_be_object`);
  }
  return value as Record<string, unknown>;
}

function readArray(value: unknown, label: string, maximum: number): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${normalizeToken(label)}_must_be_array`);
  }
  if (value.length > maximum) {
    throw new Error(`${normalizeToken(label)}_too_many`);
  }
  return value;
}

function readToken(value: unknown, label: string, maximum = 64): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maximum
    || value !== value.trim()
    || !SAFE_TOKEN_PATTERN.test(value)
  ) {
    throw new Error(`${normalizeToken(label)}_invalid`);
  }
  return value;
}

function readSignalCode(value: unknown, label: string): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 512
    || value !== value.trim()
    || !SIGNAL_CODE_PATTERN.test(value)
    || (value.includes("|") && parseMetricSignalCode(value) === undefined)
  ) {
    throw new Error(`${normalizeToken(label)}_invalid`);
  }
  return value;
}

function readEvidenceToken(value: unknown, label: string, maximum = 64): string {
  const token = readToken(value, label, maximum);
  if (
    UUID_PATTERN.test(token)
    || LOCAL_PATH_OR_URL_PATTERN.test(token)
    || PATH_TRAVERSAL_PATTERN.test(token)
    || OPAQUE_DIRECT_ID_PATTERN.test(token)
    || SECRET_LIKE_PATTERN.test(token)
    || JWT_PATTERN.test(token)
    || NUMERIC_IDENTIFIER_PATTERN.test(token)
  ) {
    throw new Error(`${normalizeToken(label)}_private_value_forbidden`);
  }
  return token;
}

function readHash(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${normalizeToken(label)}_invalid`);
  }
  return value;
}

function readReleaseSha(value: unknown, label: string): string {
  if (typeof value !== "string" || !RELEASE_SHA_PATTERN.test(value.toLowerCase())) {
    throw new Error(`${normalizeToken(label)}_invalid`);
  }
  return value.toLowerCase();
}

function readWatchSource(value: unknown, label: string): WatchSource {
  return readEnum(value, WATCH_SOURCES, label);
}

function readSourceFromDimensions(dimensions: Record<string, string>): WatchSource | undefined {
  const source = dimensions.source;
  return source !== undefined && (WATCH_SOURCES as readonly string[]).includes(source)
    ? source as WatchSource
    : undefined;
}

function readEnum<const T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`${normalizeToken(label)}_invalid`);
  }
  return value as T[number];
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${normalizeToken(label)}_invalid`);
  }
  return value;
}

function readNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${normalizeToken(label)}_invalid`);
  }
  return value;
}

function readNonNegativeInteger(value: unknown, label: string): number {
  const number = readNonNegativeNumber(value, label);
  if (!Number.isInteger(number)) {
    throw new Error(`${normalizeToken(label)}_invalid`);
  }
  return number;
}

function readIsoTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 32) {
    throw new Error(`${normalizeToken(label)}_invalid`);
  }
  const match = RFC3339_TIMESTAMP_PATTERN.exec(value);
  if (match === null) {
    throw new Error(`${normalizeToken(label)}_invalid`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const zoneValid = zone.toLowerCase() === "z"
    || (Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4, 6)) <= 59);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const maximumDay = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  const calendarValid = month >= 1
    && month <= 12
    && day >= 1
    && day <= maximumDay;
  if (
    !calendarValid
    || hour > 23
    || minute > 59
    || second > 59
    || !zoneValid
    || !Number.isFinite(Date.parse(value))
  ) {
    throw new Error(`${normalizeToken(label)}_invalid`);
  }
  return new Date(value).toISOString();
}

function readSessionId(value: unknown): string {
  if (typeof value !== "string" || !SESSION_ID_PATTERN.test(value)) {
    throw new Error("session_id_invalid");
  }
  return value;
}

function assertSessionId(value: string): void {
  readSessionId(value);
}

function assertExactKeys(
  object: Record<string, unknown>,
  allowed: string[],
  label: string,
  optionalAllowed = false,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(object)) {
    if (!allowedSet.has(key)) {
      throw new Error(`${normalizeToken(label)}_unknown_key_${normalizeToken(key)}`);
    }
  }
  if (!optionalAllowed) {
    for (const key of allowed) {
      if (!(key in object)) {
        throw new Error(`${normalizeToken(label)}_missing_key_${normalizeToken(key)}`);
      }
    }
  }
}

function severityRank(severity: Severity): number {
  return { low: 0, medium: 1, high: 2, critical: 3 }[severity];
}

function maxSeverity(left: Severity, right: Severity): Severity {
  return severityRank(left) >= severityRank(right) ? left : right;
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/[\r\n]+/gu, " ");
}


function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
