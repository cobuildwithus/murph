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
  "stale_invocation_authority",
  "unclassified_runtime_error",
  "workspace_version_mismatch",
] as const;

export type HostedExecutionChildRuntimeFailureKind =
  typeof HOSTED_EXECUTION_CHILD_RUNTIME_FAILURE_KINDS[number];

const HOSTED_EXECUTION_CHILD_RUNTIME_STAGE_SET = new Set<string>(
  HOSTED_EXECUTION_CHILD_RUNTIME_STAGES,
);
const HOSTED_EXECUTION_CHILD_RUNTIME_FAILURE_KIND_SET = new Set<string>(
  HOSTED_EXECUTION_CHILD_RUNTIME_FAILURE_KINDS,
);

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
