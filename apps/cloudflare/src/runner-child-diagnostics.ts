import type {
  HostedExecutionErrorCode,
  HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";

export type HostedRunnerChildFirstCompletionKind = "child_result" | "close";

const HOSTED_RUNNER_CHILD_FIRST_COMPLETION_KINDS = new Set<string>([
  "child_result",
  "close",
]);

export const HOSTED_EXECUTION_CHILD_RUNTIME_STAGES = [
  "bridge.mailbox-decoder",
  "bridge.options",
  "bridge.platform",
  "bridge.web-control-fetch",
  "runtime.in-process",
  "runtime.not-started",
] as const;

export type HostedExecutionChildRuntimeStage =
  typeof HOSTED_EXECUTION_CHILD_RUNTIME_STAGES[number];

export const HOSTED_EXECUTION_CHILD_RUNTIME_FAILURE_KINDS = [
  "control_plane_fetch",
  "control_plane_http",
  "control_plane_invalid_json",
  "hosted_assistant_configuration",
  "invalid_workspace_port",
  "mailbox_payload_decode_http",
  "mailbox_payload_decode_invalid_json",
  "mailbox_payload_decode_missing_write_fence",
  "missing_mailbox_port",
  "missing_runtime_platform",
  "missing_vault_root",
  "missing_workspace_port",
  "relative_vault_root",
  "runtime_rpc_destroyed",
  "stale_invocation_authority",
  "unclassified_runtime_error",
  "workspace_version_mismatch",
] as const;

export type HostedExecutionChildRuntimeFailureKind =
  typeof HOSTED_EXECUTION_CHILD_RUNTIME_FAILURE_KINDS[number];

export const HOSTED_EXECUTION_CHILD_RUNTIME_FETCH_CAUSE_KINDS = [
  "abort",
  "cloudflare_rpc_destroy",
  "fetch_failed",
  "network",
  "timeout",
  "unknown",
] as const;

export type HostedExecutionChildRuntimeFetchCauseKind =
  typeof HOSTED_EXECUTION_CHILD_RUNTIME_FETCH_CAUSE_KINDS[number];

export const HOSTED_EXECUTION_CHILD_RUNTIME_HTTP_OPERATIONS = [
  "artifact_fetch",
  "artifact_upload",
  "assistant_runtime_issue_export",
  "browser_vault_replica_publish",
  "browser_vault_replica_write",
  "device_sync_connect_link",
  "device_sync_dirty_ack",
  "device_sync_pending_dirty_state",
  "device_sync_runtime_apply",
  "device_sync_runtime_snapshot",
  "email_send",
  "mailbox_fetch",
  "mailbox_payload_decode",
  "mailbox_payload_fetch",
  "raw_email_read",
  "runtime_crypto_context_fetch",
  "runtime_crypto_root_fetch",
  "runtime_internal_request",
  "runtime_log_write",
  "telegram_file_download",
  "telegram_file_lookup",
  "usage_recording",
  "workspace_checkpoint",
  "workspace_read",
] as const;

export type HostedExecutionChildRuntimeHttpOperation =
  typeof HOSTED_EXECUTION_CHILD_RUNTIME_HTTP_OPERATIONS[number];

export const HOSTED_EXECUTION_CHILD_RUNTIME_OBSERVED_PHASES = [
  "cli.bridge",
  "cli.bridge.stop",
  "codex.prepare",
  "foreground.pass",
  "inbox.sidecar",
  "mailbox.import.initial",
  "runtime",
  "runtime.return",
  "workspace.checkpoint.idle_shutdown",
  "workspace.read",
  "workspace.restore",
] as const;

export type HostedExecutionChildRuntimeObservedPhase =
  typeof HOSTED_EXECUTION_CHILD_RUNTIME_OBSERVED_PHASES[number];

export const HOSTED_EXECUTION_CHILD_RUNTIME_OBSERVED_PHASE_STATUSES = [
  "done",
  "fail",
  "start",
] as const;

export type HostedExecutionChildRuntimeObservedPhaseStatus =
  typeof HOSTED_EXECUTION_CHILD_RUNTIME_OBSERVED_PHASE_STATUSES[number];

type HostedExecutionChildRuntimeObservedPhaseTraceEntry = {
  phase: HostedExecutionChildRuntimeObservedPhase;
  position: number;
  status: HostedExecutionChildRuntimeObservedPhaseStatus;
};

const HOSTED_EXECUTION_CHILD_RUNTIME_STAGE_SET = new Set<string>(
  HOSTED_EXECUTION_CHILD_RUNTIME_STAGES,
);
const HOSTED_EXECUTION_CHILD_RUNTIME_FAILURE_KIND_SET = new Set<string>(
  HOSTED_EXECUTION_CHILD_RUNTIME_FAILURE_KINDS,
);
const HOSTED_EXECUTION_CHILD_RUNTIME_HTTP_OPERATION_SET = new Set<string>(
  HOSTED_EXECUTION_CHILD_RUNTIME_HTTP_OPERATIONS,
);
const HOSTED_EXECUTION_CHILD_RUNTIME_FETCH_CAUSE_KIND_SET = new Set<string>(
  HOSTED_EXECUTION_CHILD_RUNTIME_FETCH_CAUSE_KINDS,
);
const HOSTED_EXECUTION_CHILD_RUNTIME_OBSERVED_PHASE_SET = new Set<string>(
  HOSTED_EXECUTION_CHILD_RUNTIME_OBSERVED_PHASES,
);
const HOSTED_EXECUTION_CHILD_RUNTIME_OBSERVED_PHASE_STATUS_SET = new Set<string>(
  HOSTED_EXECUTION_CHILD_RUNTIME_OBSERVED_PHASE_STATUSES,
);
const HOSTED_EXECUTION_CHILD_RUNTIME_PHASE_TRACE_LIMIT = 24;

const HOSTED_EXECUTION_CHILD_RUNTIME_ERROR_CODES = [
  "authorization_error",
  "bundle_archive_validation_error",
  "checkpoint_error",
  "configuration_error",
  "invalid_request",
  "outbox_error",
  "range_error",
  "reference_error",
  "runner_http_error",
  "runtime_error",
  "syntax_error",
  "timeout",
  "type_error",
  "uri_error",
] as const satisfies readonly HostedExecutionErrorCode[];

const HOSTED_EXECUTION_CHILD_RUNTIME_ERROR_CODE_SET = new Set<string>(
  HOSTED_EXECUTION_CHILD_RUNTIME_ERROR_CODES,
);

const HOSTED_EXECUTION_CHILD_RUNTIME_ERROR_NAMES = [
  "AbortError",
  "Error",
  "EvalError",
  "HostedAssistantConfigurationError",
  "HostedBundleArchiveValidationError",
  "HostedExecutionConfigurationError",
  "HostedRuntimeInternalAuthorityRejectedError",
  "HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TimeoutError",
  "TypeError",
  "URIError",
] as const;

const HOSTED_EXECUTION_CHILD_RUNTIME_ERROR_NAME_SET = new Set<string>(
  HOSTED_EXECUTION_CHILD_RUNTIME_ERROR_NAMES,
);

const HOSTED_RUNNER_CHILD_OUTPUT_MARKER_VALUES = [
  "hosted_assistant_config_required",
  "hosted_child_debug_after_run",
  "hosted_child_debug_before_run",
  "hosted_child_debug_run_error",
  "hosted_child_failed_unexpectedly",
  "hosted_child_parse_failed",
  "hosted_child_prepared",
  "ipc_channel_required",
  "module_resolution_failed",
  "syntax_error",
  "tsx_import_failure",
  "uncaught_exception",
] as const;

export type HostedRunnerChildOutputMarker =
  typeof HOSTED_RUNNER_CHILD_OUTPUT_MARKER_VALUES[number];

const HOSTED_RUNNER_CHILD_OUTPUT_MARKERS = new Set<string>(
  HOSTED_RUNNER_CHILD_OUTPUT_MARKER_VALUES,
);

const HOSTED_RUNNER_CHILD_OUTPUT_MARKER_PATTERNS: ReadonlyArray<{
  marker: HostedRunnerChildOutputMarker;
  pattern: RegExp;
}> = [
  {
    marker: "hosted_child_prepared",
    pattern: /Hosted node runner child prepared workspace invocation/iu,
  },
  {
    marker: "hosted_child_parse_failed",
    pattern: /Hosted node runner child failed to parse its bootstrap payload/iu,
  },
  {
    marker: "hosted_child_failed_unexpectedly",
    pattern: /Hosted node runner child failed unexpectedly/iu,
  },
  {
    marker: "hosted_child_debug_before_run",
    pattern: /\[hosted-runner-child:before-run\]/iu,
  },
  {
    marker: "hosted_child_debug_after_run",
    pattern: /\[hosted-runner-child:after-run\]/iu,
  },
  {
    marker: "hosted_child_debug_run_error",
    pattern: /\[hosted-runner-child:run-error\]/iu,
  },
  {
    marker: "hosted_assistant_config_required",
    pattern: /HOSTED_ASSISTANT_CONFIG_REQUIRED/iu,
  },
  {
    marker: "module_resolution_failed",
    pattern: /ERR_MODULE_NOT_FOUND|Cannot find module|Cannot find package/iu,
  },
  {
    marker: "syntax_error",
    pattern: /SyntaxError/iu,
  },
  {
    marker: "tsx_import_failure",
    pattern: /tsx.*(?:ERR_|import|loader|register)|(?:ERR_|import|loader|register).*tsx/iu,
  },
  {
    marker: "ipc_channel_required",
    pattern: /requires an IPC|IPC result channel|IPC runtime wake channel|ERR_IPC_CHANNEL_CLOSED/iu,
  },
  {
    marker: "uncaught_exception",
    pattern: /Uncaught Exception|UnhandledPromiseRejection|unhandled rejection/iu,
  },
];

export function collectHostedRunnerChildOutputMarkers(
  value: string,
): HostedRunnerChildOutputMarker[] {
  const markers = new Set<HostedRunnerChildOutputMarker>();
  for (const { marker, pattern } of HOSTED_RUNNER_CHILD_OUTPUT_MARKER_PATTERNS) {
    if (pattern.test(value)) {
      markers.add(marker);
    }
  }

  return [...markers].sort();
}

export function countHostedRunnerOutputLines(value: string): number {
  const trimmed = value.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\r?\n/u).length;
}

export function readHostedRunnerChildFirstCompletionKind(
  value: unknown,
): HostedRunnerChildFirstCompletionKind | null {
  return typeof value === "string" && isHostedRunnerChildFirstCompletionKind(value)
    ? value
    : null;
}

export function readHostedRunnerChildOutputMarkers(
  value: unknown,
): HostedRunnerChildOutputMarker[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const markers = value
    .flatMap((entry): HostedRunnerChildOutputMarker[] => {
      return typeof entry === "string" && isHostedRunnerChildOutputMarker(entry)
        ? [entry]
        : [];
    })
    .slice(0, 16);

  return markers.length > 0 ? markers : null;
}

export function collectHostedRunnerChildRuntimePhaseDiagnostics(input: {
  stderrTail: string;
  stdoutTail: string;
}): HostedExecutionStructuredLogDetails {
  const trace = collectHostedRunnerChildRuntimePhaseTrace([
    input.stdoutTail,
    input.stderrTail,
  ]);
  if (trace.length === 0) {
    return {};
  }

  trace.sort((left, right) => left.position - right.position);
  const boundedTrace = trace.slice(-HOSTED_EXECUTION_CHILD_RUNTIME_PHASE_TRACE_LIMIT);
  const last = boundedTrace.at(-1)!;

  return {
    runtimeLastPhase: last.phase,
    runtimeLastPhaseOrdinal: boundedTrace.length,
    runtimeLastPhaseStatus: last.status,
    runtimePhaseTrace: boundedTrace.map((entry) => `${entry.phase}:${entry.status}`),
  };
}

export function readHostedRunnerChildRuntimeLastPhase(
  value: unknown,
): HostedExecutionChildRuntimeObservedPhase | null {
  return readAllowedHostedExecutionChildDiagnostic(
    value,
    HOSTED_EXECUTION_CHILD_RUNTIME_OBSERVED_PHASE_SET,
  ) as HostedExecutionChildRuntimeObservedPhase | null;
}

export function readHostedRunnerChildRuntimeLastPhaseStatus(
  value: unknown,
): HostedExecutionChildRuntimeObservedPhaseStatus | null {
  return readAllowedHostedExecutionChildDiagnostic(
    value,
    HOSTED_EXECUTION_CHILD_RUNTIME_OBSERVED_PHASE_STATUS_SET,
  ) as HostedExecutionChildRuntimeObservedPhaseStatus | null;
}

export function readHostedRunnerChildRuntimePhaseTrace(
  value: unknown,
): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const trace = value
    .flatMap((entry): string[] => {
      if (typeof entry !== "string") {
        return [];
      }
      const [phase, status, extra] = entry.split(":");
      if (
        extra !== undefined
        || !readHostedRunnerChildRuntimeLastPhase(phase)
        || !readHostedRunnerChildRuntimeLastPhaseStatus(status)
      ) {
        return [];
      }
      return [`${phase}:${status}`];
    })
    .slice(0, HOSTED_EXECUTION_CHILD_RUNTIME_PHASE_TRACE_LIMIT);

  return trace.length > 0 ? trace : null;
}

export function readHostedRunnerChildRuntimePhaseMetadata(
  record: Record<string, unknown>,
): HostedExecutionStructuredLogDetails {
  const metadata: HostedExecutionStructuredLogDetails = {};

  const runtimeLastPhase = readHostedRunnerChildRuntimeLastPhase(
    record.runtimeLastPhase,
  );
  if (runtimeLastPhase) {
    metadata.runtimeLastPhase = runtimeLastPhase;
  }

  const runtimeLastPhaseStatus = readHostedRunnerChildRuntimeLastPhaseStatus(
    record.runtimeLastPhaseStatus,
  );
  if (runtimeLastPhaseStatus) {
    metadata.runtimeLastPhaseStatus = runtimeLastPhaseStatus;
  }

  const runtimePhaseTrace = readHostedRunnerChildRuntimePhaseTrace(
    record.runtimePhaseTrace,
  );
  if (runtimePhaseTrace) {
    metadata.runtimePhaseTrace = runtimePhaseTrace;
  }

  const runtimeLastPhaseOrdinal = readHostedRunnerChildRuntimePhaseOrdinal(
    record.runtimeLastPhaseOrdinal,
  );
  if (runtimeLastPhaseOrdinal !== null) {
    metadata.runtimeLastPhaseOrdinal = runtimeLastPhaseOrdinal;
  }

  return metadata;
}

export function readHostedExecutionChildRuntimeDiagnosticMetadata(
  record: Record<string, unknown>,
): HostedExecutionStructuredLogDetails {
  const metadata: HostedExecutionStructuredLogDetails = {};

  const childRuntimeStage = readAllowedHostedExecutionChildDiagnostic(
    record.childRuntimeStage,
    HOSTED_EXECUTION_CHILD_RUNTIME_STAGE_SET,
  );
  if (childRuntimeStage) {
    metadata.childRuntimeStage = childRuntimeStage;
  }

  const childRuntimeFailureKind = readAllowedHostedExecutionChildDiagnostic(
    record.childRuntimeFailureKind,
    HOSTED_EXECUTION_CHILD_RUNTIME_FAILURE_KIND_SET,
  );
  if (childRuntimeFailureKind) {
    metadata.childRuntimeFailureKind = childRuntimeFailureKind;
  }

  const childRuntimeHttpOperation = readAllowedHostedExecutionChildDiagnostic(
    record.childRuntimeHttpOperation,
    HOSTED_EXECUTION_CHILD_RUNTIME_HTTP_OPERATION_SET,
  );
  if (childRuntimeHttpOperation) {
    metadata.childRuntimeHttpOperation = childRuntimeHttpOperation;
  }

  const childRuntimeFetchCauseKind = readAllowedHostedExecutionChildDiagnostic(
    record.childRuntimeFetchCauseKind,
    HOSTED_EXECUTION_CHILD_RUNTIME_FETCH_CAUSE_KIND_SET,
  );
  if (childRuntimeFetchCauseKind) {
    metadata.childRuntimeFetchCauseKind = childRuntimeFetchCauseKind;
  }

  const childRuntimeFetchCauseName = readHostedExecutionChildRuntimeErrorName(
    record.childRuntimeFetchCauseName,
  );
  if (childRuntimeFetchCauseName) {
    metadata.childRuntimeFetchCauseName = childRuntimeFetchCauseName;
  }

  const childRuntimeErrorName = readHostedExecutionChildRuntimeErrorName(
    record.childRuntimeErrorName,
  );
  if (childRuntimeErrorName) {
    metadata.childRuntimeErrorName = childRuntimeErrorName;
  }

  const childRuntimeErrorCode = readHostedExecutionChildRuntimeErrorCode(
    record.childRuntimeErrorCode,
  );
  if (childRuntimeErrorCode) {
    metadata.childRuntimeErrorCode = childRuntimeErrorCode;
  }

  const childRuntimeErrorStatus = record.childRuntimeErrorStatus;
  if (
    typeof childRuntimeErrorStatus === "number"
    && Number.isInteger(childRuntimeErrorStatus)
    && childRuntimeErrorStatus >= 100
    && childRuntimeErrorStatus <= 599
  ) {
    metadata.childRuntimeErrorStatus = childRuntimeErrorStatus;
  }

  const childRuntimeFetchTimeoutMs = record.childRuntimeFetchTimeoutMs;
  if (
    typeof childRuntimeFetchTimeoutMs === "number"
    && Number.isInteger(childRuntimeFetchTimeoutMs)
    && childRuntimeFetchTimeoutMs >= 0
    && childRuntimeFetchTimeoutMs <= 3_600_000
  ) {
    metadata.childRuntimeFetchTimeoutMs = childRuntimeFetchTimeoutMs;
  }

  for (const key of [
    "childRuntimeFetchCallerSignalAborted",
    "childRuntimeFetchRequestSignalAborted",
    "childRuntimeFetchTimeoutSignalAborted",
  ] as const) {
    const value = record[key];
    if (typeof value === "boolean") {
      metadata[key] = value;
    }
  }

  return metadata;
}

export function readHostedExecutionChildRuntimeErrorName(value: unknown): string | null {
  return readAllowedHostedExecutionChildDiagnostic(
    value,
    HOSTED_EXECUTION_CHILD_RUNTIME_ERROR_NAME_SET,
  );
}

export function readHostedExecutionChildRuntimeErrorCode(
  value: unknown,
): HostedExecutionErrorCode | null {
  const code = readAllowedHostedExecutionChildDiagnostic(
    value,
    HOSTED_EXECUTION_CHILD_RUNTIME_ERROR_CODE_SET,
  );
  return code as HostedExecutionErrorCode | null;
}

function isHostedRunnerChildFirstCompletionKind(
  value: string,
): value is HostedRunnerChildFirstCompletionKind {
  return HOSTED_RUNNER_CHILD_FIRST_COMPLETION_KINDS.has(value);
}

function isHostedRunnerChildOutputMarker(
  value: string,
): value is HostedRunnerChildOutputMarker {
  return HOSTED_RUNNER_CHILD_OUTPUT_MARKERS.has(value);
}

function readAllowedHostedExecutionChildDiagnostic(
  value: unknown,
  allowed: Set<string>,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return allowed.has(normalized) ? normalized : null;
}

function collectHostedRunnerChildRuntimePhaseTrace(
  values: readonly string[],
): HostedExecutionChildRuntimeObservedPhaseTraceEntry[] {
  const trace: HostedExecutionChildRuntimeObservedPhaseTraceEntry[] = [];
  let position = 0;
  for (const value of values) {
    for (const line of value.split(/\r?\n/u)) {
      const parsed = parseHostedRunnerChildRuntimePhaseLine(line);
      if (!parsed) {
        continue;
      }
      trace.push({
        ...parsed,
        position,
      });
      position += 1;
    }
  }
  return trace;
}

function parseHostedRunnerChildRuntimePhaseLine(
  line: string,
): Omit<HostedExecutionChildRuntimeObservedPhaseTraceEntry, "position"> | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || !trimmed.startsWith("{")) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record.schema !== "murph.hosted-execution.log.v1"
    || record.component !== "runtime"
    || record.message !== "Hosted workspace runtime phase boundary."
  ) {
    return null;
  }
  const details = record.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return null;
  }
  const detailRecord = details as Record<string, unknown>;
  const phase = readHostedRunnerChildRuntimeLastPhase(detailRecord.runtimePhase);
  const status = readHostedRunnerChildRuntimeLastPhaseStatus(
    detailRecord.runtimePhaseStatus,
  );
  if (!phase || !status) {
    return null;
  }

  return {
    phase,
    status,
  };
}

function readHostedRunnerChildRuntimePhaseOrdinal(value: unknown): number | null {
  return typeof value === "number"
      && Number.isSafeInteger(value)
      && value >= 1
      && value <= HOSTED_EXECUTION_CHILD_RUNTIME_PHASE_TRACE_LIMIT
    ? value
    : null;
}
