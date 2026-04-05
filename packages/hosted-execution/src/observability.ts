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

export type HostedExecutionErrorCode =
  | "authorization_error"
  | "configuration_error"
  | "durable_commit_error"
  | "durable_finalize_error"
  | "invalid_request"
  | "range_error"
  | "reference_error"
  | "runner_http_error"
  | "runtime_error"
  | "syntax_error"
  | "timeout"
  | "type_error"
  | "uri_error";

const HOSTED_EXECUTION_SAFE_ERROR_NAMES = new Set([
  "AbortError",
  "Error",
  "EvalError",
  "HostedExecutionConfigurationError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);

const HOSTED_EXECUTION_MAX_OPERATOR_MESSAGE_LENGTH = 200;
const HOSTED_EXECUTION_SAFE_CONFIGURATION_MESSAGE_PATTERNS = [
  /^(?:[A-Z][A-Z0-9_]{1,127}|CF_[A-Z0-9_]{1,127}|HOSTED_[A-Z0-9_]{1,127}|DEVICE_SYNC_[A-Z0-9_]{1,127})\s+(?:must be|is)\s+configured(?:\s+for [A-Za-z0-9 ._/-]+)?\.?$/u,
  /^Native hosted execution requires a RunnerContainer binding\.$/u,
];
const HOSTED_EXECUTION_NAMED_ERROR_CODES = {
  RangeError: "range_error",
  ReferenceError: "reference_error",
  SyntaxError: "syntax_error",
  TypeError: "type_error",
  URIError: "uri_error",
} as const satisfies Record<string, HostedExecutionErrorCode>;
const HOSTED_EXECUTION_ERROR_SUMMARIES = {
  authorization_error: "Hosted execution authorization failed.",
  configuration_error: "Hosted execution configuration is invalid.",
  durable_commit_error: "Hosted execution failed before recording a durable commit.",
  durable_finalize_error: "Hosted execution failed while finalizing a committed run.",
  invalid_request: "Hosted execution rejected an invalid request.",
  range_error: "Hosted execution runtime failed.",
  reference_error: "Hosted execution runtime failed.",
  runner_http_error: "Hosted runner container returned an HTTP error.",
  runtime_error: "Hosted execution runtime failed.",
  syntax_error: "Hosted execution runtime failed.",
  timeout: "Hosted execution timed out.",
  type_error: "Hosted execution runtime failed.",
  uri_error: "Hosted execution runtime failed.",
} as const satisfies Record<HostedExecutionErrorCode, string>;

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

export function normalizeHostedExecutionOperatorMessage(message: string): string {
  const normalized = redactHostedExecutionText(message)
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  if (normalized.length === 0) {
    return "Hosted execution event.";
  }

  if (normalized.length <= HOSTED_EXECUTION_MAX_OPERATOR_MESSAGE_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, HOSTED_EXECUTION_MAX_OPERATOR_MESSAGE_LENGTH - 1).trimEnd()}…`;
}

export function deriveHostedExecutionErrorCode(error: unknown): HostedExecutionErrorCode {
  const name = error instanceof Error ? error.name : "";
  const message = normalizeHostedExecutionErrorMessage(error).toLowerCase();

  if (
    name === "HostedExecutionConfigurationError"
    || hostedExecutionMessageIncludesAny(message, [
      "not configured",
      "configuration",
      "missing token",
      "requires a runnercontainer binding",
      "must be configured",
    ])
  ) {
    return "configuration_error";
  }

  if (hostedExecutionMessageIncludesAny(message, ["durable commit"])) {
    return "durable_commit_error";
  }

  if (hostedExecutionMessageIncludesAny(message, ["durable finalize", "finalize"])) {
    return "durable_finalize_error";
  }

  if (hostedExecutionMessageIncludesAny(message, ["returned http"])) {
    return "runner_http_error";
  }

  if (hostedExecutionMessageIncludesAny(message, ["authorization", "unauthorized", "forbidden"])) {
    return "authorization_error";
  }

  if (
    hostedExecutionMessageIncludesAny(message, [
      "invalid json",
      "invalid request",
      "request body must be a json object",
      "must be a json object",
      "malformed",
    ])
  ) {
    return "invalid_request";
  }

  if (
    name === "AbortError"
    || hostedExecutionMessageIncludesAny(message, ["abort", "timed out", "timeout"])
  ) {
    return "timeout";
  }

  return readHostedExecutionNamedErrorCode(name) ?? "runtime_error";
}

export function summarizeHostedExecutionError(error: unknown): string {
  const message = normalizeHostedExecutionErrorMessage(error);
  const errorCode = deriveHostedExecutionErrorCode(error);

  if (errorCode === "configuration_error") {
    return readHostedExecutionSafeConfigurationMessage(message)
      ?? HOSTED_EXECUTION_ERROR_SUMMARIES.configuration_error;
  }

  if (errorCode === "runner_http_error") {
    const status = extractHostedExecutionHttpStatus(message);
    return status
      ? `Hosted runner container returned HTTP ${status}.`
      : HOSTED_EXECUTION_ERROR_SUMMARIES.runner_http_error;
  }

  return summarizeHostedExecutionErrorCode(errorCode)
    ?? HOSTED_EXECUTION_ERROR_SUMMARIES.runtime_error;
}

export function summarizeHostedExecutionErrorCode(
  errorCode: string | null | undefined,
): string | null {
  if (!errorCode) {
    return null;
  }

  return isHostedExecutionErrorCode(errorCode)
    ? HOSTED_EXECUTION_ERROR_SUMMARIES[errorCode]
    : HOSTED_EXECUTION_ERROR_SUMMARIES.runtime_error;
}

export function buildHostedExecutionStructuredLogRecord(
  input: HostedExecutionStructuredLogInput,
): HostedExecutionStructuredLogRecord {
  const error = input.error;
  const errorName = readHostedExecutionSafeErrorName(error);
  return {
    attempt: input.run?.attempt ?? null,
    component: input.component,
    ...(error === undefined ? {} : {
      errorCode: deriveHostedExecutionErrorCode(error),
      errorMessage: summarizeHostedExecutionError(error),
      ...(errorName ? { errorName } : {}),
    }),
    eventId: input.dispatch?.eventId ?? input.eventId ?? null,
    level: input.level ?? (error === undefined ? "info" : "error"),
    message: normalizeHostedExecutionOperatorMessage(input.message),
    phase: input.phase,
    runId: input.run?.runId ?? null,
    schema: "murph.hosted-execution.log.v1",
    time: input.time ?? new Date().toISOString(),
    userId: input.userId ?? null,
  };
}

function shouldEmitHostedExecutionStructuredLogToStdIo(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const override = env.MURPH_HOSTED_EXECUTION_STDIO_LOGS?.trim().toLowerCase();

  if (override === "1" || override === "true" || override === "yes" || override === "on") {
    return true;
  }

  if (override === "0" || override === "false" || override === "no" || override === "off") {
    return false;
  }

  return env.VITEST !== "true";
}

export function emitHostedExecutionStructuredLog(
  input: HostedExecutionStructuredLogInput,
): HostedExecutionStructuredLogRecord {
  const record = buildHostedExecutionStructuredLogRecord(input);

  if (!shouldEmitHostedExecutionStructuredLogToStdIo()) {
    return record;
  }

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

function hostedExecutionMessageIncludesAny(
  message: string,
  fragments: readonly string[],
): boolean {
  return fragments.some((fragment) => message.includes(fragment));
}

function readHostedExecutionNamedErrorCode(name: string): HostedExecutionErrorCode | null {
  return hasOwn(HOSTED_EXECUTION_NAMED_ERROR_CODES, name)
    ? HOSTED_EXECUTION_NAMED_ERROR_CODES[name]
    : null;
}

function isHostedExecutionErrorCode(value: string): value is HostedExecutionErrorCode {
  return hasOwn(HOSTED_EXECUTION_ERROR_SUMMARIES, value);
}

function hasOwn<ObjectType extends object, Key extends PropertyKey>(
  object: ObjectType,
  key: Key,
): key is Extract<Key, keyof ObjectType> {
  return Object.hasOwn(object, key);
}

function readHostedExecutionSafeErrorName(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const name = error.name.trim();
  return HOSTED_EXECUTION_SAFE_ERROR_NAMES.has(name) ? name : null;
}

function extractHostedExecutionHttpStatus(message: string): string | null {
  const match = /\bhttp\s+(\d{3})\b/iu.exec(message);
  return match?.[1] ?? null;
}

function readHostedExecutionSafeConfigurationMessage(message: string): string | null {
  const normalized = normalizeHostedExecutionOperatorMessage(message);

  return HOSTED_EXECUTION_SAFE_CONFIGURATION_MESSAGE_PATTERNS.some((pattern) => pattern.test(normalized))
    ? normalized
    : null;
}

function redactHostedExecutionText(value: string): string {
  return value
    .replace(
      /\b(authorization)\b\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]+\b/giu,
      (_match, key: string) => `${key}=Bearer [redacted]`,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/giu, "Bearer [redacted]")
    .replace(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/gu, "[redacted-email]")
    .replace(
      /\b(authorization)\b\s*[:=]\s*(?!Bearer\b)(?:"[^"]+"|'[^']+'|\S+)/giu,
      (_match, key: string) => `${key}=[redacted]`,
    )
    .replace(
      /\b((?:[A-Z][A-Z0-9_]*_)?(?:token|secret|password|passcode|api[_-]?key|cookie|set-cookie))\b\s*[:=]\s*(?:"[^"]+"|'[^']+'|\S+)/giu,
      "$1=[redacted]",
    )
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted-token]");
}
