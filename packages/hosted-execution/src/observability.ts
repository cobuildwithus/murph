export const HOSTED_EXECUTION_RUN_PHASES = [
  "claimed",
  "dispatch.running",
  "container.starting",
  "container.ready",
  "runtime.starting",
  "commit.recorded",
  "side-effects.draining",
  "finalize.recorded",
  "completed",
  "retry.scheduled",
  "failed",
  "poisoned",
] as const;

export type HostedExecutionRunPhase = (typeof HOSTED_EXECUTION_RUN_PHASES)[number];

export const HOSTED_EXECUTION_RUN_LEVELS = ["info", "warn", "error"] as const;

export type HostedExecutionRunLevel = (typeof HOSTED_EXECUTION_RUN_LEVELS)[number];

export interface HostedExecutionRunContext {
  attempt: number;
  runId: string;
  startedAt: string;
}

export interface HostedExecutionRunStatus extends HostedExecutionRunContext {
  eventId: string;
  phase: HostedExecutionRunPhase;
  updatedAt: string;
}

export interface HostedExecutionTimelineEntry {
  at: string;
  attempt: number;
  component: string;
  errorCode?: string | null;
  eventId: string;
  level: HostedExecutionRunLevel;
  message: string;
  phase: HostedExecutionRunPhase;
  runId: string;
}

export interface HostedExecutionStructuredLogRecord {
  attempt: number | null;
  component: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  errorName?: string | null;
  eventId: string | null;
  level: HostedExecutionRunLevel;
  message: string;
  phase: HostedExecutionRunPhase;
  runId: string | null;
  schema: "murph.hosted-execution.log.v1";
  time: string;
  userId: string | null;
}

interface HostedExecutionDispatchLike {
  event?: {
    userId?: string | null;
  } | null;
  eventId?: string | null;
}

export interface HostedExecutionStructuredLogInput {
  component: string;
  dispatch?: HostedExecutionDispatchLike | null;
  error?: unknown;
  eventId?: string | null;
  level?: HostedExecutionRunLevel;
  message: string;
  phase: HostedExecutionRunPhase;
  run?: HostedExecutionRunContext | null;
  time?: string;
  userId?: string | null;
}

export function isHostedExecutionRunPhase(value: unknown): value is HostedExecutionRunPhase {
  return typeof value === "string" && HOSTED_EXECUTION_RUN_PHASES.includes(
    value as HostedExecutionRunPhase,
  );
}

export function isHostedExecutionRunLevel(value: unknown): value is HostedExecutionRunLevel {
  return typeof value === "string" && HOSTED_EXECUTION_RUN_LEVELS.includes(
    value as HostedExecutionRunLevel,
  );
}

export function normalizeHostedExecutionErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : error.name;
  }

  const message = String(error).trim();
  return message.length > 0 ? message : "Unknown hosted execution error.";
}

export function deriveHostedExecutionErrorCode(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  const message = normalizeHostedExecutionErrorMessage(error).toLowerCase();

  if (
    name === "HostedExecutionConfigurationError"
    || message.includes("not configured")
    || message.includes("configuration")
    || message.includes("missing token")
  ) {
    return "configuration_error";
  }

  if (message.includes("durable commit")) {
    return "durable_commit_error";
  }

  if (message.includes("durable finalize") || message.includes("finalize")) {
    return "durable_finalize_error";
  }

  if (message.includes("returned http")) {
    return "runner_http_error";
  }

  if (message.includes("unauthorized") || message.includes("forbidden")) {
    return "authorization_error";
  }

  if (
    message.includes("invalid json")
    || message.includes("invalid request")
    || message.includes("request body must be a json object")
    || message.includes("malformed")
  ) {
    return "invalid_request";
  }

  if (
    name === "AbortError"
    || message.includes("abort")
    || message.includes("timed out")
    || message.includes("timeout")
  ) {
    return "timeout";
  }

  const normalizedName = normalizeHostedExecutionErrorCodeFragment(name);
  if (normalizedName && normalizedName !== "error") {
    return normalizedName;
  }

  return "runtime_error";
}

export function buildHostedExecutionStructuredLogRecord(
  input: HostedExecutionStructuredLogInput,
): HostedExecutionStructuredLogRecord {
  const error = input.error;
  return {
    attempt: input.run?.attempt ?? null,
    component: input.component,
    ...(error === undefined ? {} : {
      errorCode: deriveHostedExecutionErrorCode(error),
      errorMessage: sanitizeHostedExecutionLogMessage(normalizeHostedExecutionErrorMessage(error)),
      errorName: error instanceof Error ? error.name : null,
    }),
    eventId: input.dispatch?.eventId ?? input.eventId ?? null,
    level: input.level ?? (error === undefined ? "info" : "error"),
    message: input.message,
    phase: input.phase,
    runId: input.run?.runId ?? null,
    schema: "murph.hosted-execution.log.v1",
    time: input.time ?? new Date().toISOString(),
    userId: input.userId ?? input.dispatch?.event?.userId ?? null,
  };
}

export function emitHostedExecutionStructuredLog(
  input: HostedExecutionStructuredLogInput,
): HostedExecutionStructuredLogRecord {
  const record = buildHostedExecutionStructuredLogRecord(input);
  const payload = JSON.stringify(record);

  switch (record.level) {
    case "error":
      console.error(payload);
      break;
    case "warn":
      console.warn(payload);
      break;
    default:
      console.info(payload);
      break;
  }

  return record;
}

function normalizeHostedExecutionErrorCodeFragment(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .replace(/_{2,}/gu, "_");

  return normalized.length > 0 ? normalized : null;
}

function sanitizeHostedExecutionLogMessage(message: string): string {
  return message
    .replace(/\b(authorization\s*:\s*)(?:bearer\s+)?([^\s,;]+)/giu, "$1<redacted>")
    .replace(/\b(bearer\s+)([^\s,;]+)/giu, "$1<redacted>")
    .replace(
      /\b(authorization|api[-_ ]?key|token|secret|password|cookie|set-cookie)(\s*[:=]\s*)([^\s,;]+)/giu,
      "$1$2<redacted>",
    );
}
