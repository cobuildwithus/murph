import type {
  HostedExecutionErrorCode,
  HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";
import {
  HOSTED_BUNDLE_ARCHIVE_VALIDATION_CAUSES,
} from "./hosted-bundle-validation-cause.js";
import {
  HOSTED_WORKSPACE_SNAPSHOT_PROCESS_LABELS,
  HOSTED_WORKSPACE_SNAPSHOT_PROCESS_STDERR_MARKERS,
} from "./workspace-snapshot-local.js";

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
  "bundle_archive_validation",
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

export const HOSTED_EXECUTION_CHILD_RUNTIME_ERROR_MESSAGE_KINDS = [
  "artifact_fetch_exhausted_retries",
  "artifact_fetch_http_failure",
  "canonical_write_receipt_action_invalid",
  "canonical_write_receipt_artifact_size_mismatch",
  "canonical_write_receipt_artifact_unavailable",
  "canonical_write_receipt_content_ref_invalid",
  "canonical_write_receipt_fields_invalid",
  "canonical_write_receipt_schema_invalid",
  "codex_continuity_manifest_invalid_json",
  "codex_continuity_manifest_invalid_rollout_path",
  "codex_continuity_manifest_missing",
  "codex_continuity_manifest_missing_rollout",
  "codex_continuity_manifest_missing_rollout_state",
  "codex_continuity_manifest_schema_mismatch",
  "codex_continuity_manifest_thread_invalid",
  "codex_continuity_rollout_missing",
  "codex_continuity_rollout_sha_mismatch",
  "codex_continuity_rollout_size_mismatch",
  "codex_continuity_unmanifested_home_file",
  "workspace_snapshot_archive_manifest_mismatch",
  "workspace_snapshot_data_key_unwrap_http_failure",
  "workspace_snapshot_data_key_unwrap_invalid_json",
  "workspace_snapshot_data_key_unwrap_invalid_response",
  "workspace_snapshot_data_key_unwrap_missing_data_key",
  "workspace_snapshot_encrypted_digest_mismatch",
  "workspace_snapshot_encrypted_object_too_small",
  "workspace_snapshot_encrypted_size_mismatch",
  "workspace_snapshot_direct_r2_upload_request_failure",
  "workspace_snapshot_fetch_body_unavailable",
  "workspace_snapshot_fetch_byte_count_mismatch",
  "workspace_snapshot_fetch_content_length_mismatch",
  "workspace_snapshot_fetch_http_failure",
  "workspace_snapshot_fetch_request_failure",
  "workspace_snapshot_object_unavailable",
  "workspace_snapshot_plaintext_digest_mismatch",
  "workspace_snapshot_presign_get_http_failure",
  "workspace_snapshot_presign_get_invalid_json",
  "workspace_snapshot_presign_get_invalid_response",
  "workspace_snapshot_restore_archive_streams_unavailable",
  "workspace_snapshot_restored_state_mismatch",
  "workspace_snapshot_tar_command_failed",
  "workspace_snapshot_tar_entry_count_unsafe",
  "workspace_snapshot_tar_entry_format_unsupported",
  "workspace_snapshot_tar_entry_size_unsafe",
  "workspace_snapshot_tar_entry_type_unsafe",
  "workspace_snapshot_zstd_command_failed",
] as const;

export type HostedExecutionChildRuntimeErrorMessageKind =
  typeof HOSTED_EXECUTION_CHILD_RUNTIME_ERROR_MESSAGE_KINDS[number];

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
  "runtime_latency_trace",
  "runtime_log_write",
  "telegram_file_download",
  "telegram_file_lookup",
  "usage_recording",
  "workspace_checkpoint",
  "workspace_snapshot_complete",
  "workspace_snapshot_data_key_unwrap",
  "workspace_snapshot_direct_r2_upload",
  "workspace_snapshot_fetch",
  "workspace_snapshot_presign_get",
  "workspace_snapshot_presign_put",
  "workspace_snapshot_session_abort",
  "workspace_snapshot_session_start",
  "workspace_read",
] as const;

export type HostedExecutionChildRuntimeHttpOperation =
  typeof HOSTED_EXECUTION_CHILD_RUNTIME_HTTP_OPERATIONS[number];

const HOSTED_WORKSPACE_SNAPSHOT_RESTORE_STEPS = new Set<string>([
  "archive_restore",
  "data_key_unwrap",
  "object_fetch",
  "presign_get",
  "scratch_prepare",
  "size_guard",
]);
const HOSTED_WORKSPACE_SNAPSHOT_PROCESS_LABEL_SET = new Set<string>(
  HOSTED_WORKSPACE_SNAPSHOT_PROCESS_LABELS,
);
const HOSTED_WORKSPACE_SNAPSHOT_PROCESS_STDERR_MARKER_SET = new Set<string>(
  HOSTED_WORKSPACE_SNAPSHOT_PROCESS_STDERR_MARKERS,
);

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

const HOSTED_EXECUTION_CHILD_RUNTIME_BUNDLE_ARCHIVE_OPERATIONS = new Set<string>([
  "cleanup-authoritative-next",
  "runner-input",
  "runner-output",
]);
const HOSTED_EXECUTION_CHILD_RUNTIME_BUNDLE_ARCHIVE_VALIDATION_CAUSES = new Set<string>([
  ...HOSTED_BUNDLE_ARCHIVE_VALIDATION_CAUSES,
]);

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
const HOSTED_EXECUTION_CHILD_RUNTIME_ERROR_MESSAGE_KIND_SET = new Set<string>(
  HOSTED_EXECUTION_CHILD_RUNTIME_ERROR_MESSAGE_KINDS,
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

const HOSTED_EXECUTION_CHILD_RUNTIME_ERROR_MESSAGE_KIND_EXACT:
  ReadonlyArray<readonly [string, HostedExecutionChildRuntimeErrorMessageKind]> = [
    [
      "Hosted artifact fetch exhausted retry attempts.",
      "artifact_fetch_exhausted_retries",
    ],
    [
      "Hosted canonical write receipt artifact is unavailable.",
      "canonical_write_receipt_artifact_unavailable",
    ],
    [
      "Hosted canonical write receipt artifact size does not match its log ref.",
      "canonical_write_receipt_artifact_size_mismatch",
    ],
    [
      "Hosted canonical write receipt schema is invalid.",
      "canonical_write_receipt_schema_invalid",
    ],
    [
      "Hosted canonical write receipt fields are invalid.",
      "canonical_write_receipt_fields_invalid",
    ],
    [
      "Hosted canonical write receipt action is invalid.",
      "canonical_write_receipt_action_invalid",
    ],
    [
      "Hosted canonical write receipt action target is invalid.",
      "canonical_write_receipt_action_invalid",
    ],
    [
      "Hosted canonical text write receipt action is invalid.",
      "canonical_write_receipt_action_invalid",
    ],
    [
      "Hosted canonical JSONL append receipt action is invalid.",
      "canonical_write_receipt_action_invalid",
    ],
    [
      "Hosted canonical raw write receipt action is invalid.",
      "canonical_write_receipt_action_invalid",
    ],
    [
      "Hosted canonical raw write receipt action is missing content.",
      "canonical_write_receipt_action_invalid",
    ],
    [
      "Hosted canonical delete receipt action is invalid.",
      "canonical_write_receipt_action_invalid",
    ],
    [
      "Hosted canonical write receipt action kind is invalid.",
      "canonical_write_receipt_action_invalid",
    ],
    [
      "Hosted canonical write receipt content ref is invalid.",
      "canonical_write_receipt_content_ref_invalid",
    ],
    [
      "Hosted Codex continuity manifest is missing after restore.",
      "codex_continuity_manifest_missing",
    ],
    [
      "Hosted Codex continuity manifest contains an invalid rollout path.",
      "codex_continuity_manifest_invalid_rollout_path",
    ],
    [
      "Hosted Codex continuity rollout was not restored as a regular file.",
      "codex_continuity_rollout_missing",
    ],
    [
      "Hosted Codex continuity rollout byte size mismatch after restore.",
      "codex_continuity_rollout_size_mismatch",
    ],
    [
      "Hosted Codex continuity rollout SHA-256 mismatch after restore.",
      "codex_continuity_rollout_sha_mismatch",
    ],
    [
      "Hosted Codex continuity manifest is missing restored session rollout state.",
      "codex_continuity_manifest_missing_rollout_state",
    ],
    [
      "Hosted Codex continuity manifest is missing a restored session rollout.",
      "codex_continuity_manifest_missing_rollout",
    ],
    [
      "Hosted Codex continuity restore included an unmanifested Codex home file.",
      "codex_continuity_unmanifested_home_file",
    ],
    [
      "Hosted Codex continuity manifest is not valid JSON.",
      "codex_continuity_manifest_invalid_json",
    ],
    [
      "Hosted Codex continuity manifest schema mismatch.",
      "codex_continuity_manifest_schema_mismatch",
    ],
    [
      "Hosted Codex continuity manifest thread entry is invalid.",
      "codex_continuity_manifest_thread_invalid",
    ],
    [
      "Hosted workspace snapshot data key unwrap returned invalid JSON.",
      "workspace_snapshot_data_key_unwrap_invalid_json",
    ],
    [
      "Hosted workspace snapshot data key unwrap response must be an object.",
      "workspace_snapshot_data_key_unwrap_invalid_response",
    ],
    [
      "Hosted workspace snapshot data key unwrap response dataKey is required.",
      "workspace_snapshot_data_key_unwrap_missing_data_key",
    ],
    [
      "Hosted workspace snapshot presign download returned invalid JSON.",
      "workspace_snapshot_presign_get_invalid_json",
    ],
    [
      "Hosted workspace snapshot presign response must be an object.",
      "workspace_snapshot_presign_get_invalid_response",
    ],
    [
      "Hosted workspace snapshot encrypted object is unavailable.",
      "workspace_snapshot_object_unavailable",
    ],
    [
      "Hosted workspace snapshot fetch response body is unavailable.",
      "workspace_snapshot_fetch_body_unavailable",
    ],
    [
      "Hosted workspace snapshot fetch content-length does not match its ref.",
      "workspace_snapshot_fetch_content_length_mismatch",
    ],
    [
      "Hosted workspace snapshot fetch byte count does not match its ref.",
      "workspace_snapshot_fetch_byte_count_mismatch",
    ],
    [
      "Hosted workspace snapshot encrypted size does not match its ref.",
      "workspace_snapshot_encrypted_size_mismatch",
    ],
    [
      "Hosted workspace snapshot encrypted digest does not match its ref.",
      "workspace_snapshot_encrypted_digest_mismatch",
    ],
    [
      "Hosted workspace snapshot encrypted object is too small.",
      "workspace_snapshot_encrypted_object_too_small",
    ],
    [
      "Hosted workspace snapshot plaintext archive digest does not match its ref.",
      "workspace_snapshot_plaintext_digest_mismatch",
    ],
    [
      "Hosted workspace snapshot archive manifest does not match its ref.",
      "workspace_snapshot_archive_manifest_mismatch",
    ],
    [
      "Hosted workspace snapshot tar entry count is unsafe.",
      "workspace_snapshot_tar_entry_count_unsafe",
    ],
    [
      "Hosted workspace snapshot tar entry type is unsafe.",
      "workspace_snapshot_tar_entry_type_unsafe",
    ],
    [
      "Hosted workspace snapshot tar entry format is unsupported.",
      "workspace_snapshot_tar_entry_format_unsupported",
    ],
    [
      "Hosted workspace snapshot tar entry size is unsafe.",
      "workspace_snapshot_tar_entry_size_unsafe",
    ],
    [
      "Hosted workspace snapshot restore archive streams are unavailable.",
      "workspace_snapshot_restore_archive_streams_unavailable",
    ],
    [
      "Hosted workspace snapshot restored state does not match its ref.",
      "workspace_snapshot_restored_state_mismatch",
    ],
  ];

const HOSTED_EXECUTION_CHILD_RUNTIME_ERROR_MESSAGE_KIND_PATTERNS:
  ReadonlyArray<{
    kind: HostedExecutionChildRuntimeErrorMessageKind;
    pattern: RegExp;
  }> = [
    {
      kind: "artifact_fetch_http_failure",
      pattern: /^Hosted artifact fetch failed with HTTP \d{3}\./u,
    },
    {
      kind: "workspace_snapshot_data_key_unwrap_http_failure",
      pattern: /^Hosted workspace snapshot data key unwrap failed with HTTP \d{3}\./u,
    },
    {
      kind: "workspace_snapshot_presign_get_http_failure",
      pattern: /^Hosted workspace snapshot presign download failed with HTTP \d{3}\./u,
    },
    {
      kind: "workspace_snapshot_fetch_http_failure",
      pattern: /^Hosted workspace snapshot fetch failed with HTTP \d{3}\./u,
    },
    {
      kind: "workspace_snapshot_fetch_request_failure",
      pattern: /^Hosted workspace snapshot fetch(?: response body read)? request failed(?:\.|:)/u,
    },
    {
      kind: "workspace_snapshot_direct_r2_upload_request_failure",
      pattern: /^Hosted workspace snapshot direct R2 upload request failed(?:\.|:)/u,
    },
    {
      kind: "workspace_snapshot_zstd_command_failed",
      pattern: /^Hosted workspace snapshot zstd command failed with /u,
    },
    {
      kind: "workspace_snapshot_tar_command_failed",
      pattern: /^Hosted workspace snapshot tar command failed with /u,
    },
  ];

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

export function collectHostedRunnerChildStructuredRuntimeDiagnostics(input: {
  stderrTail: string;
  stdoutTail: string;
}): HostedExecutionStructuredLogDetails {
  const metadata: HostedExecutionStructuredLogDetails = {};
  for (const details of collectHostedRunnerChildStructuredLogDetails([
    input.stdoutTail,
    input.stderrTail,
  ])) {
    Object.assign(metadata, readHostedRunnerChildWorkspaceSnapshotDiagnostics(details));
  }
  return metadata;
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

  const childRuntimeWorkspaceSnapshotRestoreStep =
    readAllowedHostedExecutionChildDiagnostic(
      record.childRuntimeWorkspaceSnapshotRestoreStep,
      HOSTED_WORKSPACE_SNAPSHOT_RESTORE_STEPS,
    );
  if (childRuntimeWorkspaceSnapshotRestoreStep) {
    metadata.childRuntimeWorkspaceSnapshotRestoreStep =
      childRuntimeWorkspaceSnapshotRestoreStep;
  }

  const childRuntimeWorkspaceSnapshotProcessLabel =
    readAllowedHostedExecutionChildDiagnostic(
      record.childRuntimeWorkspaceSnapshotProcessLabel,
      HOSTED_WORKSPACE_SNAPSHOT_PROCESS_LABEL_SET,
    );
  if (childRuntimeWorkspaceSnapshotProcessLabel) {
    metadata.childRuntimeWorkspaceSnapshotProcessLabel =
      childRuntimeWorkspaceSnapshotProcessLabel;
  }

  const childRuntimeWorkspaceSnapshotProcessSignal =
    readHostedWorkspaceSnapshotProcessSignal(
      record.childRuntimeWorkspaceSnapshotProcessSignal,
    );
  if (childRuntimeWorkspaceSnapshotProcessSignal) {
    metadata.childRuntimeWorkspaceSnapshotProcessSignal =
      childRuntimeWorkspaceSnapshotProcessSignal;
  }

  for (const key of [
    "childRuntimeWorkspaceSnapshotProcessExitCode",
    "childRuntimeWorkspaceSnapshotProcessStderrBytes",
    "childRuntimeWorkspaceSnapshotProcessStderrLineCount",
  ] as const) {
    const value = readHostedWorkspaceSnapshotProcessDiagnosticCount(record[key]);
    if (value !== null) {
      metadata[key] = value;
    }
  }

  const childRuntimeWorkspaceSnapshotProcessStderrMarkers =
    readHostedWorkspaceSnapshotProcessStderrMarkers(
      record.childRuntimeWorkspaceSnapshotProcessStderrMarkers,
    );
  if (childRuntimeWorkspaceSnapshotProcessStderrMarkers.length > 0) {
    metadata.childRuntimeWorkspaceSnapshotProcessStderrMarkers =
      childRuntimeWorkspaceSnapshotProcessStderrMarkers;
  }

  const childRuntimeWorkspaceSnapshotProcessStderrErrorDetail =
    readHostedWorkspaceSnapshotProcessErrorDetail(
      record.childRuntimeWorkspaceSnapshotProcessStderrErrorDetail,
    );
  if (childRuntimeWorkspaceSnapshotProcessStderrErrorDetail) {
    metadata.childRuntimeWorkspaceSnapshotProcessStderrErrorDetail =
      childRuntimeWorkspaceSnapshotProcessStderrErrorDetail;
  }

  const childRuntimeFetchCauseKind = readAllowedHostedExecutionChildDiagnostic(
    record.childRuntimeFetchCauseKind,
    HOSTED_EXECUTION_CHILD_RUNTIME_FETCH_CAUSE_KIND_SET,
  );
  if (childRuntimeFetchCauseKind) {
    metadata.childRuntimeFetchCauseKind = childRuntimeFetchCauseKind;
  }

  const childRuntimeErrorMessageKind =
    readHostedExecutionChildRuntimeErrorMessageKind(
      record.childRuntimeErrorMessageKind,
    );
  if (childRuntimeErrorMessageKind) {
    metadata.childRuntimeErrorMessageKind = childRuntimeErrorMessageKind;
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

  const childRuntimeBundleArchiveOperation = readAllowedHostedExecutionChildDiagnostic(
    record.childRuntimeBundleArchiveOperation,
    HOSTED_EXECUTION_CHILD_RUNTIME_BUNDLE_ARCHIVE_OPERATIONS,
  );
  if (childRuntimeBundleArchiveOperation) {
    metadata.childRuntimeBundleArchiveOperation = childRuntimeBundleArchiveOperation;
  }

  const childRuntimeBundleArchiveValidationCause = readAllowedHostedExecutionChildDiagnostic(
    record.childRuntimeBundleArchiveValidationCause,
    HOSTED_EXECUTION_CHILD_RUNTIME_BUNDLE_ARCHIVE_VALIDATION_CAUSES,
  );
  if (childRuntimeBundleArchiveValidationCause) {
    metadata.childRuntimeBundleArchiveValidationCause =
      childRuntimeBundleArchiveValidationCause;
  }

  const childRuntimeBundleRefSize = record.childRuntimeBundleRefSize;
  if (
    typeof childRuntimeBundleRefSize === "number"
    && Number.isSafeInteger(childRuntimeBundleRefSize)
    && childRuntimeBundleRefSize >= 0
    && childRuntimeBundleRefSize <= 1024 * 1024 * 1024
  ) {
    metadata.childRuntimeBundleRefSize = childRuntimeBundleRefSize;
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
    "childRuntimeBundleRefKeyPresent",
    "childRuntimeBundleRefPresent",
    "childRuntimeFetchCallerSignalAborted",
    "childRuntimeFetchRequestSignalAborted",
    "childRuntimeFetchTimeoutSignalAborted",
    "childRuntimeWorkspaceSnapshotProcessStderrTruncated",
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

export function readHostedExecutionChildRuntimeErrorMessageKind(
  value: unknown,
): HostedExecutionChildRuntimeErrorMessageKind | null {
  const kind = readAllowedHostedExecutionChildDiagnostic(
    value,
    HOSTED_EXECUTION_CHILD_RUNTIME_ERROR_MESSAGE_KIND_SET,
  );
  return kind as HostedExecutionChildRuntimeErrorMessageKind | null;
}

export function classifyHostedExecutionChildRuntimeErrorMessageKind(
  message: string,
): HostedExecutionChildRuntimeErrorMessageKind | null {
  const normalized = message.trim();
  for (const [candidate, kind] of HOSTED_EXECUTION_CHILD_RUNTIME_ERROR_MESSAGE_KIND_EXACT) {
    if (normalized === candidate) {
      return kind;
    }
  }
  for (const { kind, pattern } of HOSTED_EXECUTION_CHILD_RUNTIME_ERROR_MESSAGE_KIND_PATTERNS) {
    if (pattern.test(normalized)) {
      return kind;
    }
  }
  return null;
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

function readHostedWorkspaceSnapshotProcessDiagnosticCount(
  value: unknown,
): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 1024 * 1024
    ? value
    : null;
}

function readHostedWorkspaceSnapshotProcessSignal(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z0-9]+$/u.test(value)
    ? value
    : null;
}

function readHostedWorkspaceSnapshotProcessStderrMarkers(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const markers = new Set<string>();
  for (const entry of value) {
    const marker = readAllowedHostedExecutionChildDiagnostic(
      entry,
      HOSTED_WORKSPACE_SNAPSHOT_PROCESS_STDERR_MARKER_SET,
    );
    if (marker) {
      markers.add(marker);
    }
  }
  return [...markers].sort();
}

function readHostedWorkspaceSnapshotProcessErrorDetail(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 8192
    ? normalized
    : null;
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

function collectHostedRunnerChildStructuredLogDetails(
  values: readonly string[],
): Record<string, unknown>[] {
  const details: Record<string, unknown>[] = [];
  for (const value of values) {
    for (const line of value.split(/\r?\n/u)) {
      const record = parseHostedRunnerChildStructuredLogLine(line);
      if (!record) {
        continue;
      }
      details.push(record);
    }
  }
  return details;
}

function parseHostedRunnerChildStructuredLogLine(
  line: string,
): Record<string, unknown> | null {
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
  if (record.schema !== "murph.hosted-execution.log.v1") {
    return null;
  }
  const details = record.details;
  if (
    !details
    || typeof details !== "object"
    || Array.isArray(details)
  ) {
    return null;
  }

  return details as Record<string, unknown>;
}

function readHostedRunnerChildWorkspaceSnapshotDiagnostics(
  record: Record<string, unknown>,
): HostedExecutionStructuredLogDetails {
  const metadata: HostedExecutionStructuredLogDetails = {};

  const restoreStep = readAllowedHostedExecutionChildDiagnostic(
    record.workspaceSnapshotRestoreStep,
    HOSTED_WORKSPACE_SNAPSHOT_RESTORE_STEPS,
  );
  if (restoreStep) {
    metadata.childRuntimeWorkspaceSnapshotRestoreStep = restoreStep;
  }

  const processLabel = readAllowedHostedExecutionChildDiagnostic(
    record.workspaceSnapshotProcessLabel,
    HOSTED_WORKSPACE_SNAPSHOT_PROCESS_LABEL_SET,
  );
  if (processLabel) {
    metadata.childRuntimeWorkspaceSnapshotProcessLabel = processLabel;
  }

  const processSignal = readHostedWorkspaceSnapshotProcessSignal(
    record.workspaceSnapshotProcessSignal,
  );
  if (processSignal) {
    metadata.childRuntimeWorkspaceSnapshotProcessSignal = processSignal;
  }

  for (const [sourceKey, targetKey] of [
    [
      "workspaceSnapshotProcessExitCode",
      "childRuntimeWorkspaceSnapshotProcessExitCode",
    ],
    [
      "workspaceSnapshotProcessStderrBytes",
      "childRuntimeWorkspaceSnapshotProcessStderrBytes",
    ],
    [
      "workspaceSnapshotProcessStderrLineCount",
      "childRuntimeWorkspaceSnapshotProcessStderrLineCount",
    ],
  ] as const) {
    const value = readHostedWorkspaceSnapshotProcessDiagnosticCount(record[sourceKey]);
    if (value !== null) {
      metadata[targetKey] = value;
    }
  }

  const stderrMarkers = readHostedWorkspaceSnapshotProcessStderrMarkers(
    record.workspaceSnapshotProcessStderrMarkers,
  );
  if (stderrMarkers.length > 0) {
    metadata.childRuntimeWorkspaceSnapshotProcessStderrMarkers = stderrMarkers;
  }

  const stderrErrorDetail = readHostedWorkspaceSnapshotProcessErrorDetail(
    record.workspaceSnapshotProcessStderrErrorDetail,
  );
  if (stderrErrorDetail) {
    metadata.childRuntimeWorkspaceSnapshotProcessStderrErrorDetail =
      stderrErrorDetail;
  }

  if (typeof record.workspaceSnapshotProcessStderrTruncated === "boolean") {
    metadata.childRuntimeWorkspaceSnapshotProcessStderrTruncated =
      record.workspaceSnapshotProcessStderrTruncated;
  }

  return metadata;
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
