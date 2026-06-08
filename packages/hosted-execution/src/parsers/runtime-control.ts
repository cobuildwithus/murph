import {
  parseHostedExecutionDeviceSyncRuntimeApplyRequest,
  parseHostedExecutionDeviceSyncRuntimeSnapshotRequest,
  parseHostedExecutionDeviceSyncWakeHint,
} from "@murphai/device-syncd/hosted-runtime";
import {
  parseAssistantUsageRecord,
} from "../assistant-usage.ts";
import {
  parseAssistantRuntimeIssueRecord,
} from "@murphai/runtime-state/node/assistant-runtime-issues";
import {
  HOSTED_RUNTIME_DEVICE_SYNC_BRIDGE_KINDS,
  HOSTED_INGRESS_LATENCY_SOURCES,
  HOSTED_RUNTIME_SIDE_INPUT_UNAVAILABLE_CODES,
  HOSTED_RUNTIME_LATENCY_TRACE_ASSISTANT_INPUT_MAX_IDS,
  HOSTED_RUNTIME_LATENCY_TRACE_MILESTONES,
  HOSTED_MAILBOX_KINDS,
  HOSTED_MAILBOX_LANES,
  HOSTED_RUNTIME_LOG_COMPONENTS,
  HOSTED_RUNTIME_LOG_EVENT_CODES,
  HOSTED_RUNTIME_LOG_LEVELS,
  HOSTED_RUNTIME_LOG_PHASES,
  HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES,
  HOSTED_WORKSPACE_CHECKPOINT_REASONS,
  HOSTED_WORKSPACE_INVOCATION_REASONS,
  HOSTED_WORKSPACE_INVOCATION_STATUSES,
  type HostedMailboxFetchRequest,
  type HostedMailboxFetchResponse,
  type HostedMailboxItem,
  type HostedMailboxKind,
  type HostedMailboxLane,
  type HostedMailboxLaneCounterState,
  type HostedMailboxLaneCursor,
  type HostedMailboxLaneHighWater,
  type HostedMailboxLaneLag,
  type HostedMailboxPayload,
  type HostedMailboxPayloadFetchRequest,
  type HostedMailboxPayloadFetchResponse,
  type HostedBrowserVaultReplicaPublishRequest,
  type HostedBrowserVaultReplicaPublishResponse,
  type HostedRunnerNudgeResult,
  type HostedRunnerStatusResponse,
  type HostedRuntimeDeviceSyncBridgeEnvelope,
  type HostedRuntimeDeviceSyncBridgeKind,
  type HostedRuntimeIssueExportRequest,
  type HostedRuntimeIssueExportResponse,
  type HostedRuntimeLatencyTraceAssistantInputStagedEvent,
  type HostedRuntimeLatencyTraceEvent,
  type HostedRuntimeLatencyTraceMilestone,
  type HostedRuntimeLatencyTraceMilestoneEvent,
  type HostedRuntimeLatencyTraceProviderStartedEvent,
  type HostedRuntimeLatencyTraceRequest,
  type HostedRuntimeLatencyTraceResponse,
  type HostedRuntimeLogComponent,
  type HostedRuntimeLogEntry,
  type HostedRuntimeLogEventCode,
  type HostedRuntimeLogLevel,
  type HostedRuntimeLogPhase,
  type HostedRuntimeLogRequest,
  type HostedRuntimeLogResponse,
  type HostedRuntimeRedactedJson,
  type HostedRuntimeRedactedObject,
  type HostedRuntimeRedactedScalar,
  type HostedRuntimeRedactedValue,
  type HostedRuntimeWebStatusResponse,
  type HostedRuntimeSideInputUnavailable,
  type HostedRuntimeSideInputUnavailableCode,
  type HostedRuntimeUsageRecordRequest,
  type HostedRuntimeUsageRecordResponse,
  type HostedIngressLatencySource,
  type HostedWorkspaceCheckpointReason,
  type HostedWorkspaceCheckpointRequest,
  type HostedWorkspaceCheckpointResponse,
  type HostedWorkspaceReadResponse,
  type HostedWorkspaceInvocationBudget,
  type HostedWorkspaceInvocationReason,
  type HostedWorkspaceInvocationRequest,
  type HostedWorkspaceInvocationResult,
  type HostedWorkspaceInvocationStatus,
  type HostedWorkspaceState,
} from "../runtime-control.ts";
import {
  rejectLegacyAliases,
  requireArray,
  requireBoolean,
  requireNumber,
  requireObject,
  requireString,
  readNullableString,
} from "./assertions.ts";
import {
  parseHostedBrowserVaultReplicaRef,
  parseHostedExecutionSnapshotRef,
} from "./cursor.ts";

const FORBIDDEN_RAW_REDACTED_KEY_NAMES = [
  "address",
  "authorization",
  "body",
  "cookie",
  "email",
  "header",
  "message",
  "path",
  "payload",
  "phone",
  "prompt",
  "raw",
  "secret",
  "text",
  "token",
] as const;
const SAFE_DIAGNOSTIC_TEXT_REDACTED_KEY_NAMES = new Set([
  "authorizationHeaderValue",
  "assistantContextSnapshotRefreshAttempted",
  "assistantContextSnapshotRefreshed",
  "bodyJson",
  "executionContextHosted",
  "failureAssistantProviderErrorBodyMessage",
  "failureAssistantProviderErrorMessage",
  "failureAssistantProviderErrorStatusText",
  "messageContent",
  "messageText",
  "payload",
  "payloadValue",
  "providerHttpStatusText",
  "providerRequestBodyFieldNames",
  "routePlanningActiveExperimentContextElapsedMs",
  "routePlanningAssistantContextSnapshotElapsedMs",
  "routePlanningAnyBootstrapContextPrepared",
  "routePlanningBootstrapContextPrepared",
  "routePlanningFreshThreadFallbackPromptElapsedMs",
  "routePlanningPrimarySystemPromptElapsedMs",
  "safeErrorMessage",
  "tokenPreview",
]);
const BOOLEAN_REDACTED_KEY_NAMES = new Set([
  "assistantContextSnapshotRefreshAttempted",
  "assistantContextSnapshotRefreshed",
]);
const SAFE_DIAGNOSTIC_TEXT_REDACTED_KEY_PATTERN =
  /^[A-Za-z][A-Za-z0-9_.-]{0,127}(?:ErrorMessage|ErrorDetail|ErrorCause|ErrorStatusText)$/u;
const ROUTE_PLANNING_ELAPSED_MS_REDACTED_KEY_NAMES = new Set([
  "routePlanningActiveExperimentContextElapsedMs",
  "routePlanningAssistantContextSnapshotElapsedMs",
  "routePlanningCliBootstrapElapsedMs",
  "routePlanningElapsedMs",
  "routePlanningFallbackInstructionsElapsedMs",
  "routePlanningFreshThreadFallbackPromptElapsedMs",
  "routePlanningMeasuredElapsedMs",
  "routePlanningMemoryOverviewElapsedMs",
  "routePlanningPrimaryInstructionsElapsedMs",
  "routePlanningPrimarySystemPromptElapsedMs",
  "routePlanningResumeBindingElapsedMs",
  "routePlanningSlowestStageElapsedMs",
  "routePlanningSupportedExperimentProtocolsElapsedMs",
  "routePlanningTargetCapabilitiesElapsedMs",
  "routePlanningUnaccountedElapsedMs",
  "routePlanningVaultOverviewElapsedMs",
]);
const ROUTE_PLANNING_STAGE_VALUES = new Set([
  "active_experiment_context",
  "assistant_context_snapshot",
  "cli_bootstrap",
  "fallback_instructions",
  "memory_overview",
  "primary_instructions",
  "resume_binding",
  "supported_experiment_protocols",
  "target_capabilities",
]);
const ROUTE_PLANNING_REDACTED_KEY_NAMES = new Set([
  ...ROUTE_PLANNING_ELAPSED_MS_REDACTED_KEY_NAMES,
  "routePlanningAnyBootstrapContextPrepared",
  "routePlanningBootstrapContextPrepared",
  "routePlanningFreshThreadFallbackPrepared",
  "routePlanningSlowestStage",
]);
const SAFE_REDACTED_METADATA_KEY_SUFFIXES = [
  "Bytes",
  "Code",
  "Codes",
  "Count",
  "Counts",
  "Index",
  "Indexes",
  "Kind",
  "Kinds",
  "Length",
  "Lengths",
  "Ordinal",
  "Ordinals",
  "Present",
  "Seq",
  "Seqs",
  "Size",
  "Sizes",
  "Status",
  "Statuses",
  "Type",
  "Types",
] as const;
const HOSTED_RUNTIME_REDACTED_JSON_MAX_KEYS = 96;
const HOSTED_RUNTIME_REDACTED_ARRAY_MAX_LENGTH = 16;
const HOSTED_RUNTIME_REDACTED_OBJECT_MAX_KEYS = 8;
const HOSTED_RUNTIME_REDACTED_OBJECT_ARRAY_KEYS = new Set([
  "codexActionToolSummaries",
]);
const HOSTED_RUNTIME_REDACTED_STRING_MAX_LENGTH = 2048;
const HOSTED_RUNTIME_LOG_ENTRY_KEYS = new Set([
  "at",
  "attemptId",
  "checkpointVersion",
  "component",
  "errorCode",
  "eventCode",
  "leaseGeneration",
  "level",
  "mailboxLane",
  "mailboxSeqEnd",
  "mailboxSeqStart",
  "outboxIntentRef",
  "phase",
  "redactedJson",
  "workspaceVersion",
]);
const HOSTED_RUNTIME_LATENCY_TRACE_REQUEST_KEYS = new Set([
  "event",
]);
const HOSTED_RUNTIME_LATENCY_TRACE_ASSISTANT_INPUT_STAGED_KEYS = new Set([
  "assistantInputId",
  "at",
  "mailboxItemId",
  "runnerJobAcceptedAt",
  "runtimeAttemptId",
  "runtimePhaseStartedAt",
  "source",
  "type",
  "workspaceRestoreDoneAt",
]);
const HOSTED_RUNTIME_LATENCY_TRACE_PROVIDER_STARTED_KEYS = new Set([
  "assistantInputIds",
  "at",
  "providerRequestOrdinal",
  "runtimeAttemptId",
  "source",
  "type",
]);
const HOSTED_RUNTIME_LATENCY_TRACE_MILESTONE_KEYS = new Set([
  "at",
  "milestone",
  "runtimeAttemptId",
  "source",
  "type",
]);
const HOSTED_WORKSPACE_INVOCATION_REMOVED_FIELDS = [
  "checkpointNextWakeAt",
  "committedSeq",
  "deadlineAt",
  "events",
  "finalizeRequired",
  "inputCommittedSeq",
  "inputCursorVersion",
  "requestedTargetSeq",
  "resumeFinalize",
  "run",
  "runDrain",
  "runId",
  "runToken",
  "source",
  "targetCommittedSeqHint",
  "targetReached",
  "wake",
] as const;
const HOSTED_RUNNER_STATUS_REMOVED_FIELDS = [
  "bundleRef",
  "committedSeq",
  "lastError",
  "lastEventId",
  "nextWakeAt",
  "pendingIngressEventCount",
  "pendingWakeCount",
  "run",
  "runId",
  "timeline",
] as const;

export function parseHostedMailboxItem(value: unknown): HostedMailboxItem {
  const record = requireObject(value, "Hosted mailbox item");

  return {
    createdAt: requireString(record.createdAt, "Hosted mailbox item createdAt"),
    dedupeKey: requireString(record.dedupeKey, "Hosted mailbox item dedupeKey"),
    ...(record.expiresAt === undefined
      ? {}
      : { expiresAt: readNullableString(record.expiresAt, "Hosted mailbox item expiresAt") }),
    id: requireString(record.id, "Hosted mailbox item id"),
    kind: parseHostedMailboxKind(record.kind),
    lane: parseHostedMailboxLane(record.lane),
    laneSeq: requireNonNegativeBigIntString(record.laneSeq, "Hosted mailbox item laneSeq"),
    occurredAt: requireString(record.occurredAt, "Hosted mailbox item occurredAt"),
    ...(record.payloadBytes === undefined
      ? {}
      : {
          payloadBytes: record.payloadBytes === null
            ? null
            : requireNonNegativeInteger(
                record.payloadBytes,
                "Hosted mailbox item payloadBytes",
              ),
        }),
    ...(record.payloadInlineCiphertext === undefined
      ? {}
      : {
          payloadInlineCiphertext: readNullableString(
            record.payloadInlineCiphertext,
            "Hosted mailbox item payloadInlineCiphertext",
          ),
        }),
    ...(record.payloadRef === undefined
      ? {}
      : {
          payloadRef: readNullableString(record.payloadRef, "Hosted mailbox item payloadRef"),
        }),
    payloadSchema: requireString(record.payloadSchema, "Hosted mailbox item payloadSchema"),
    updatedAt: requireString(record.updatedAt, "Hosted mailbox item updatedAt"),
    userId: requireString(record.userId, "Hosted mailbox item userId"),
  };
}

export function parseHostedMailboxPayload(value: unknown): HostedMailboxPayload {
  const record = requireObject(value, "Hosted mailbox payload");

  return {
    createdAt: requireString(record.createdAt, "Hosted mailbox payload createdAt"),
    mailboxItemId: requireString(record.mailboxItemId, "Hosted mailbox payload mailboxItemId"),
    payloadCiphertext: requireString(
      record.payloadCiphertext,
      "Hosted mailbox payload payloadCiphertext",
    ),
    payloadSchema: requireString(record.payloadSchema, "Hosted mailbox payload payloadSchema"),
    userId: requireString(record.userId, "Hosted mailbox payload userId"),
  };
}

export function parseHostedMailboxPayloadFetchRequest(
  value: unknown,
): HostedMailboxPayloadFetchRequest {
  const record = requireObject(value, "Hosted mailbox payload fetch request");

  return {
    dedupeKey: requireString(
      record.dedupeKey,
      "Hosted mailbox payload fetch request dedupeKey",
    ),
    mailboxItemId: requireString(
      record.mailboxItemId,
      "Hosted mailbox payload fetch request mailboxItemId",
    ),
    ...(record.payloadRef === undefined
      ? {}
      : {
          payloadRef: readNullableString(
            record.payloadRef,
            "Hosted mailbox payload fetch request payloadRef",
          ),
        }),
    requestId: requireString(record.requestId, "Hosted mailbox payload fetch request requestId"),
  };
}

export function parseHostedMailboxPayloadFetchResponse(
  value: unknown,
): HostedMailboxPayloadFetchResponse {
  const record = requireObject(value, "Hosted mailbox payload fetch response");
  const payload = record.payload === null ? null : parseHostedMailboxPayload(record.payload);
  const unavailable = parseOptionalHostedRuntimeSideInputUnavailable(
    record.unavailable,
    "Hosted mailbox payload fetch response unavailable",
  );

  assertPayloadOrUnavailable(
    payload,
    unavailable,
    "Hosted mailbox payload fetch response",
  );

  return {
    fetchedAt: requireString(record.fetchedAt, "Hosted mailbox payload fetch response fetchedAt"),
    payload,
    ...(record.unavailable === undefined ? {} : { unavailable }),
  };
}

export function parseHostedMailboxLaneCounterState(
  value: unknown,
): HostedMailboxLaneCounterState {
  const record = requireObject(value, "Hosted mailbox lane counter");

  return {
    lane: parseHostedMailboxLane(record.lane),
    nextSeq: requireNonNegativeBigIntString(
      record.nextSeq,
      "Hosted mailbox lane counter nextSeq",
    ),
    updatedAt: requireString(record.updatedAt, "Hosted mailbox lane counter updatedAt"),
    userId: requireString(record.userId, "Hosted mailbox lane counter userId"),
  };
}

export function parseHostedMailboxFetchRequest(value: unknown): HostedMailboxFetchRequest {
  const record = requireObject(value, "Hosted mailbox fetch request");

  return {
    lanes: requireArray(record.lanes, "Hosted mailbox fetch request lanes")
      .map((entry, index) => parseHostedMailboxLaneCursor(
        entry,
        `Hosted mailbox fetch request lanes[${index}]`,
      )),
    limitPerLane: requirePositiveInteger(
      record.limitPerLane,
      "Hosted mailbox fetch request limitPerLane",
    ),
    requestId: requireString(record.requestId, "Hosted mailbox fetch request requestId"),
  };
}

export function parseHostedMailboxFetchResponse(value: unknown): HostedMailboxFetchResponse {
  const record = requireObject(value, "Hosted mailbox fetch response");

  return {
    fetchedAt: requireString(record.fetchedAt, "Hosted mailbox fetch response fetchedAt"),
    items: requireArray(record.items, "Hosted mailbox fetch response items")
      .map((entry) => parseHostedMailboxItem(entry)),
    maxSeqByLane: requireArray(
      record.maxSeqByLane,
      "Hosted mailbox fetch response maxSeqByLane",
    ).map((entry, index) => parseHostedMailboxLaneHighWater(
      entry,
      `Hosted mailbox fetch response maxSeqByLane[${index}]`,
    )),
    userId: requireString(record.userId, "Hosted mailbox fetch response userId"),
  };
}

export function parseHostedRuntimeDeviceSyncBridgeEnvelope(
  value: unknown,
): HostedRuntimeDeviceSyncBridgeEnvelope {
  const record = requireObject(value, "Hosted runtime device-sync bridge envelope");
  const kind = parseHostedRuntimeDeviceSyncBridgeKind(record.kind);
  const requestId = requireString(record.requestId, "Hosted runtime device-sync bridge requestId");

  switch (kind) {
    case "device-sync.wake":
      return {
        ...(record.connectionId === undefined
          ? {}
          : {
              connectionId: readNullableString(
                record.connectionId,
                "Hosted runtime device-sync bridge connectionId",
              ),
            }),
        ...(record.hint === undefined
          ? {}
          : {
              hint: parseHostedExecutionDeviceSyncWakeHint(record.hint),
            }),
        kind,
        ...(record.provider === undefined
          ? {}
          : {
              provider: readNullableString(
                record.provider,
                "Hosted runtime device-sync bridge provider",
              ),
            }),
        requestId,
      };
    case "device-sync.snapshot":
      return {
        kind,
        request: parseHostedExecutionDeviceSyncRuntimeSnapshotRequest(record.request),
        requestId,
      };
    case "device-sync.apply":
      return {
        kind,
        request: parseHostedExecutionDeviceSyncRuntimeApplyRequest(record.request),
        requestId,
      };
  }
}

export function parseHostedRuntimeUsageRecordRequest(
  value: unknown,
): HostedRuntimeUsageRecordRequest {
  const record = requireObject(value, "Hosted runtime usage record request");

  return {
    usage: parseAssistantUsageRecord(record.usage),
  };
}

export function parseHostedRuntimeUsageRecordResponse(
  value: unknown,
): HostedRuntimeUsageRecordResponse {
  const record = requireObject(value, "Hosted runtime usage record response");

  return {
    recorded: requireBoolean(record.recorded, "Hosted runtime usage record response recorded"),
    usageId: requireString(record.usageId, "Hosted runtime usage record response usageId"),
  };
}

export function parseHostedRuntimeIssueExportRequest(
  value: unknown,
): HostedRuntimeIssueExportRequest {
  const record = requireObject(value, "Hosted runtime issue export request");

  return {
    issues: requireArray(record.issues, "Hosted runtime issue export request issues")
      .map((entry) => parseAssistantRuntimeIssueRecord(entry)),
  };
}

export function parseHostedRuntimeIssueExportResponse(
  value: unknown,
): HostedRuntimeIssueExportResponse {
  const response = parseHostedRuntimeRecordExportResponse(value, "issueIds");

  return {
    issueIds: response.ids,
    recorded: response.recorded,
  };
}

export function parseHostedIngressLatencySource(value: unknown): HostedIngressLatencySource {
  return parseAllowedString(
    value,
    "Hosted ingress latency source",
    HOSTED_INGRESS_LATENCY_SOURCES,
  );
}

export function parseHostedRuntimeLatencyTraceEvent(
  value: unknown,
): HostedRuntimeLatencyTraceEvent {
  const record = requireObject(value, "Hosted runtime latency trace event");
  const type = requireString(record.type, "Hosted runtime latency trace event type");

  switch (type) {
    case "assistant_input_staged":
      return parseHostedRuntimeLatencyTraceAssistantInputStagedEvent(record);
    case "provider_started":
      return parseHostedRuntimeLatencyTraceProviderStartedEvent(record);
    case "runtime_milestone":
      return parseHostedRuntimeLatencyTraceMilestoneEvent(record);
    default:
      throw new TypeError("Hosted runtime latency trace event type is not supported.");
  }
}

export function parseHostedRuntimeLatencyTraceRequest(
  value: unknown,
): HostedRuntimeLatencyTraceRequest {
  const record = requireObject(value, "Hosted runtime latency trace request");
  assertAllowedObjectKeys(
    record,
    HOSTED_RUNTIME_LATENCY_TRACE_REQUEST_KEYS,
    "Hosted runtime latency trace request",
  );

  return {
    event: parseHostedRuntimeLatencyTraceEvent(record.event),
  };
}

export function parseHostedRuntimeLatencyTraceResponse(
  value: unknown,
): HostedRuntimeLatencyTraceResponse {
  const record = requireObject(value, "Hosted runtime latency trace response");

  return {
    matchedCount: requireNonNegativeInteger(
      record.matchedCount,
      "Hosted runtime latency trace response matchedCount",
    ),
    recorded: requireBoolean(
      record.recorded,
      "Hosted runtime latency trace response recorded",
    ),
    unmatchedCount: requireNonNegativeInteger(
      record.unmatchedCount,
      "Hosted runtime latency trace response unmatchedCount",
    ),
  };
}

function parseHostedRuntimeLatencyTraceAssistantInputStagedEvent(
  record: Record<string, unknown>,
): HostedRuntimeLatencyTraceAssistantInputStagedEvent {
  assertAllowedObjectKeys(
    record,
    HOSTED_RUNTIME_LATENCY_TRACE_ASSISTANT_INPUT_STAGED_KEYS,
    "Hosted runtime latency trace assistant_input_staged event",
  );

  return {
    assistantInputId: requireString(
      record.assistantInputId,
      "Hosted runtime latency trace assistantInputId",
    ),
    at: requireString(record.at, "Hosted runtime latency trace at"),
    mailboxItemId: requireString(
      record.mailboxItemId,
      "Hosted runtime latency trace mailboxItemId",
    ),
    ...(record.runnerJobAcceptedAt === undefined
      ? {}
      : {
          runnerJobAcceptedAt: readNullableString(
            record.runnerJobAcceptedAt,
            "Hosted runtime latency trace runnerJobAcceptedAt",
          ),
        }),
    ...(record.runtimeAttemptId === undefined
      ? {}
      : {
          runtimeAttemptId: readNullableString(
            record.runtimeAttemptId,
            "Hosted runtime latency trace runtimeAttemptId",
          ),
        }),
    ...(record.runtimePhaseStartedAt === undefined
      ? {}
      : {
          runtimePhaseStartedAt: readNullableString(
            record.runtimePhaseStartedAt,
            "Hosted runtime latency trace runtimePhaseStartedAt",
          ),
        }),
    source: parseHostedIngressLatencySource(record.source),
    type: "assistant_input_staged",
    ...(record.workspaceRestoreDoneAt === undefined
      ? {}
      : {
          workspaceRestoreDoneAt: readNullableString(
            record.workspaceRestoreDoneAt,
            "Hosted runtime latency trace workspaceRestoreDoneAt",
          ),
        }),
  };
}

function parseHostedRuntimeLatencyTraceProviderStartedEvent(
  record: Record<string, unknown>,
): HostedRuntimeLatencyTraceProviderStartedEvent {
  assertAllowedObjectKeys(
    record,
    HOSTED_RUNTIME_LATENCY_TRACE_PROVIDER_STARTED_KEYS,
    "Hosted runtime latency trace provider_started event",
  );
  const assistantInputIds = requireArray(
    record.assistantInputIds,
    "Hosted runtime latency trace assistantInputIds",
  ).map((entry, index) =>
    requireString(entry, `Hosted runtime latency trace assistantInputIds[${index}]`)
  );

  if (assistantInputIds.length === 0) {
    throw new TypeError("Hosted runtime latency trace assistantInputIds must not be empty.");
  }
  if (assistantInputIds.length > HOSTED_RUNTIME_LATENCY_TRACE_ASSISTANT_INPUT_MAX_IDS) {
    throw new TypeError(
      `Hosted runtime latency trace assistantInputIds must contain at most ${HOSTED_RUNTIME_LATENCY_TRACE_ASSISTANT_INPUT_MAX_IDS} ids.`,
    );
  }

  return {
    assistantInputIds,
    at: requireString(record.at, "Hosted runtime latency trace at"),
    providerRequestOrdinal: requireNonNegativeInteger(
      record.providerRequestOrdinal,
      "Hosted runtime latency trace providerRequestOrdinal",
    ),
    ...(record.runtimeAttemptId === undefined
      ? {}
      : {
          runtimeAttemptId: readNullableString(
            record.runtimeAttemptId,
            "Hosted runtime latency trace runtimeAttemptId",
          ),
        }),
    source: parseHostedIngressLatencySource(record.source),
    type: "provider_started",
  };
}

function parseHostedRuntimeLatencyTraceMilestone(
  value: unknown,
): HostedRuntimeLatencyTraceMilestone {
  return parseAllowedString(
    value,
    "Hosted runtime latency trace milestone",
    HOSTED_RUNTIME_LATENCY_TRACE_MILESTONES,
  );
}

function parseHostedRuntimeLatencyTraceMilestoneEvent(
  record: Record<string, unknown>,
): HostedRuntimeLatencyTraceMilestoneEvent {
  assertAllowedObjectKeys(
    record,
    HOSTED_RUNTIME_LATENCY_TRACE_MILESTONE_KEYS,
    "Hosted runtime latency trace runtime_milestone event",
  );

  return {
    at: requireString(record.at, "Hosted runtime latency trace at"),
    milestone: parseHostedRuntimeLatencyTraceMilestone(record.milestone),
    ...(record.runtimeAttemptId === undefined
      ? {}
      : {
          runtimeAttemptId: readNullableString(
            record.runtimeAttemptId,
            "Hosted runtime latency trace runtimeAttemptId",
          ),
        }),
    source: parseHostedIngressLatencySource(record.source),
    type: "runtime_milestone",
  };
}

export function parseHostedWorkspaceState(value: unknown): HostedWorkspaceState {
  const record = requireObject(value, "Hosted workspace state");

  return {
    ...(record.browserVaultReplicaRef === undefined
      ? {}
      : {
          browserVaultReplicaRef: parseHostedBrowserVaultReplicaRef(
            record.browserVaultReplicaRef,
            "Hosted workspace state browserVaultReplicaRef",
          ),
        }),
    ...(record.checkpointedAt === undefined
      ? {}
      : {
          checkpointedAt: readNullableString(
            record.checkpointedAt,
            "Hosted workspace state checkpointedAt",
          ),
        }),
    createdAt: requireString(record.createdAt, "Hosted workspace state createdAt"),
    ...(record.nextWakeAt === undefined
      ? {}
      : { nextWakeAt: readNullableString(record.nextWakeAt, "Hosted workspace state nextWakeAt") }),
    ...(record.nextWakeReason === undefined
      ? {}
      : {
          nextWakeReason: readNullableString(
            record.nextWakeReason,
            "Hosted workspace state nextWakeReason",
          ),
        }),
    ...(record.redactedStatus === undefined
      ? {}
      : {
          redactedStatus: parseHostedRuntimeRedactedJson(
            record.redactedStatus,
            "Hosted workspace state redactedStatus",
          ),
        }),
    snapshotRef: parseHostedExecutionSnapshotRef(
      record.snapshotRef === undefined ? null : record.snapshotRef,
      "Hosted workspace state snapshotRef",
    ),
    updatedAt: requireString(record.updatedAt, "Hosted workspace state updatedAt"),
    userId: requireString(record.userId, "Hosted workspace state userId"),
    version: requireNonNegativeBigIntString(record.version, "Hosted workspace state version"),
  };
}

export function parseHostedWorkspaceReadResponse(value: unknown): HostedWorkspaceReadResponse {
  const record = requireObject(value, "Hosted workspace read response");

  return {
    fetchedAt: requireString(record.fetchedAt, "Hosted workspace read response fetchedAt"),
    workspace: record.workspace === null ? null : parseHostedWorkspaceState(record.workspace),
  };
}

export function parseHostedWorkspaceCheckpointRequest(
  value: unknown,
): HostedWorkspaceCheckpointRequest {
  const record = requireObject(value, "Hosted workspace checkpoint request");

  return {
    attemptId: requireString(
      record.attemptId,
      "Hosted workspace checkpoint request attemptId",
    ),
    ...(record.browserVaultReplicaRef === undefined
      ? {}
      : {
          browserVaultReplicaRef: parseHostedBrowserVaultReplicaRef(
            record.browserVaultReplicaRef,
            "Hosted workspace checkpoint request browserVaultReplicaRef",
          ),
        }),
    expectedWorkspaceVersion: requireNonNegativeBigIntString(
      record.expectedWorkspaceVersion,
      "Hosted workspace checkpoint request expectedWorkspaceVersion",
    ),
    leaseGeneration: requireNonNegativeBigIntString(
      record.leaseGeneration,
      "Hosted workspace checkpoint request leaseGeneration",
    ),
    ...(record.nextWakeAt === undefined
      ? {}
      : {
          nextWakeAt: readNullableString(
            record.nextWakeAt,
            "Hosted workspace checkpoint request nextWakeAt",
          ),
        }),
    ...(record.nextWakeReason === undefined
      ? {}
      : {
          nextWakeReason: readNullableString(
            record.nextWakeReason,
            "Hosted workspace checkpoint request nextWakeReason",
          ),
        }),
    reason: parseHostedWorkspaceCheckpointReason(record.reason),
    ...(record.redactedStatus === undefined
      ? {}
      : {
          redactedStatus: parseHostedRuntimeRedactedJson(
            record.redactedStatus,
            "Hosted workspace checkpoint request redactedStatus",
          ),
        }),
    snapshotRef: parseHostedExecutionSnapshotRef(
      record.snapshotRef === undefined ? null : record.snapshotRef,
      "Hosted workspace checkpoint request snapshotRef",
    ),
  };
}

export function parseHostedWorkspaceCheckpointResponse(
  value: unknown,
): HostedWorkspaceCheckpointResponse {
  const record = requireObject(value, "Hosted workspace checkpoint response");

  return {
    checkpointed: requireBoolean(
      record.checkpointed,
      "Hosted workspace checkpoint response checkpointed",
    ),
    workspace: parseHostedWorkspaceState(record.workspace),
  };
}

export function parseHostedBrowserVaultReplicaPublishRequest(
  value: unknown,
): HostedBrowserVaultReplicaPublishRequest {
  const record = requireObject(value, "Hosted browser-vault replica publish request");
  const replicaRef = parseHostedBrowserVaultReplicaRef(
    record.replicaRef,
    "Hosted browser-vault replica publish request replicaRef",
  );

  if (!replicaRef) {
    throw new TypeError(
      "Hosted browser-vault replica publish request replicaRef must not be null.",
    );
  }

  const expectedSourceStateHash = Object.hasOwn(record, "expectedSourceStateHash")
    ? requireString(
        record.expectedSourceStateHash,
        "Hosted browser-vault replica publish request expectedSourceStateHash",
      )
    : undefined;

  return {
    ...(expectedSourceStateHash === undefined ? {} : { expectedSourceStateHash }),
    replicaRef,
  };
}

export function parseHostedBrowserVaultReplicaPublishResponse(
  value: unknown,
): HostedBrowserVaultReplicaPublishResponse {
  const record = requireObject(value, "Hosted browser-vault replica publish response");

  return {
    published: requireBoolean(
      record.published,
      "Hosted browser-vault replica publish response published",
    ),
    workspace: record.workspace === null ? null : parseHostedWorkspaceState(record.workspace),
  };
}

export function parseHostedRuntimeLogEntry(value: unknown): HostedRuntimeLogEntry {
  const record = requireObject(value, "Hosted runtime log entry");
  assertNoForbiddenRuntimeLogKeys(record, "Hosted runtime log entry");

  return {
    at: requireString(record.at, "Hosted runtime log entry at"),
    ...(record.attemptId === undefined
      ? {}
      : {
          attemptId: readNullableHostedRuntimeLogString(
            record.attemptId,
            "Hosted runtime log entry attemptId",
          ),
        }),
    ...(record.checkpointVersion === undefined
      ? {}
      : {
          checkpointVersion: record.checkpointVersion === null
            ? null
            : requireNonNegativeBigIntString(
                record.checkpointVersion,
                "Hosted runtime log entry checkpointVersion",
              ),
        }),
    component: parseHostedRuntimeLogComponent(record.component),
    ...(record.errorCode === undefined
      ? {}
      : {
          errorCode: readNullableHostedRuntimeLogString(
            record.errorCode,
            "Hosted runtime log entry errorCode",
          ),
        }),
    eventCode: parseHostedRuntimeLogEventCode(record.eventCode),
    ...(record.leaseGeneration === undefined
      ? {}
      : {
          leaseGeneration: record.leaseGeneration === null
            ? null
            : requireNonNegativeBigIntString(
                record.leaseGeneration,
                "Hosted runtime log entry leaseGeneration",
              ),
        }),
    level: parseHostedRuntimeLogLevel(record.level),
    ...(record.mailboxLane === undefined
      ? {}
      : {
          mailboxLane: record.mailboxLane === null
            ? null
            : parseHostedMailboxLane(record.mailboxLane),
        }),
    ...(record.mailboxSeqEnd === undefined
      ? {}
      : {
          mailboxSeqEnd: record.mailboxSeqEnd === null
            ? null
            : requireNonNegativeBigIntString(
                record.mailboxSeqEnd,
                "Hosted runtime log entry mailboxSeqEnd",
              ),
        }),
    ...(record.mailboxSeqStart === undefined
      ? {}
      : {
          mailboxSeqStart: record.mailboxSeqStart === null
            ? null
            : requireNonNegativeBigIntString(
                record.mailboxSeqStart,
                "Hosted runtime log entry mailboxSeqStart",
              ),
        }),
    ...(record.outboxIntentRef === undefined
      ? {}
      : {
          outboxIntentRef: readNullableHostedRuntimeLogString(
            record.outboxIntentRef,
            "Hosted runtime log entry outboxIntentRef",
          ),
        }),
    phase: parseHostedRuntimeLogPhase(record.phase),
    ...(record.redactedJson === undefined
      ? {}
      : {
          redactedJson: parseHostedRuntimeRedactedJson(
            record.redactedJson,
            "Hosted runtime log entry redactedJson",
          ),
        }),
    ...(record.workspaceVersion === undefined
      ? {}
      : {
          workspaceVersion: record.workspaceVersion === null
            ? null
            : requireNonNegativeBigIntString(
                record.workspaceVersion,
                "Hosted runtime log entry workspaceVersion",
              ),
        }),
  };
}

export function parseHostedRuntimeLogRequest(value: unknown): HostedRuntimeLogRequest {
  const record = requireObject(value, "Hosted runtime log request");
  const entries = requireArray(record.entries, "Hosted runtime log request entries");

  if (entries.length > HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES) {
    throw new TypeError(
      `Hosted runtime log request entries must contain at most ${HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES} entries.`,
    );
  }

  return {
    entries: entries.map((entry) => parseHostedRuntimeLogEntry(entry)),
  };
}

export function parseHostedRuntimeLogResponse(value: unknown): HostedRuntimeLogResponse {
  const record = requireObject(value, "Hosted runtime log response");

  return {
    loggedCount: requireNonNegativeInteger(
      record.loggedCount,
      "Hosted runtime log response loggedCount",
    ),
  };
}

export function parseHostedRunnerNudgeResult(value: unknown): HostedRunnerNudgeResult {
  const record = requireObject(value, "Hosted runner nudge result");
  if ("leaseGeneration" in record) {
    throw new TypeError("Hosted runner nudge result leaseGeneration has been removed.");
  }

  return {
    accepted: requireBoolean(record.accepted, "Hosted runner nudge result accepted"),
    alarmScheduled: requireBoolean(
      record.alarmScheduled,
      "Hosted runner nudge result alarmScheduled",
    ),
    ...(record.immediateDriveStarted === undefined
      ? {}
      : {
          immediateDriveStarted: requireBoolean(
            record.immediateDriveStarted,
            "Hosted runner nudge result immediateDriveStarted",
          ),
        }),
    inFlight: requireBoolean(record.inFlight, "Hosted runner nudge result inFlight"),
    kind: parseHostedRunnerNudgeResultKind(record),
    ...(record.nextAlarmAt === undefined
      ? {}
      : {
          nextAlarmAt: readNullableString(
            record.nextAlarmAt,
            "Hosted runner nudge result nextAlarmAt",
          ),
        }),
  };
}

function parseHostedRunnerNudgeResultKind(
  record: Record<string, unknown>,
): HostedRunnerNudgeResult["kind"] {
  const value = record.kind;
  if (value === undefined) {
    if (
      record.alreadyRunning === true
      || record.immediateDriveStarted === true
      || record.inFlight === true
    ) {
      return "processing-ensured";
    }
    return record.alarmScheduled === true ? "retry-scheduled" : "caught-up";
  }

  return parseHostedRunnerNudgeResultKindValue(value);
}

function parseHostedRunnerNudgeResultKindValue(
  value: unknown,
): HostedRunnerNudgeResult["kind"] {
  if (
    value === "caught-up"
    || value === "processing-ensured"
    || value === "retry-scheduled"
  ) {
    return value;
  }
  throw new TypeError("Hosted runner nudge result kind is invalid.");
}

export function parseHostedRunnerStatusResponse(value: unknown): HostedRunnerStatusResponse {
  const record = requireObject(value, "Hosted runner status response");
  rejectLegacyAliases(
    record,
    "Hosted runner status response",
    Object.fromEntries(HOSTED_RUNNER_STATUS_REMOVED_FIELDS.map((field) => [field, "runtime-control status"])),
  );
  if ("leaseGeneration" in record) {
    throw new TypeError("Hosted runner status response leaseGeneration has been removed.");
  }
  if ("lastRunAt" in record) {
    throw new TypeError("Hosted runner status response lastRunAt has been renamed to lastInvocationAt.");
  }

  return {
    ...(record.heartbeatAt === undefined
      ? {}
      : {
          heartbeatAt: readNullableString(
            record.heartbeatAt,
            "Hosted runner status response heartbeatAt",
          ),
        }),
    inFlight: requireBoolean(record.inFlight, "Hosted runner status response inFlight"),
    ...(record.lastErrorAt === undefined
      ? {}
      : {
          lastErrorAt: readNullableString(
            record.lastErrorAt,
            "Hosted runner status response lastErrorAt",
          ),
        }),
    ...(record.lastErrorCode === undefined
      ? {}
      : {
          lastErrorCode: readNullableString(
            record.lastErrorCode,
            "Hosted runner status response lastErrorCode",
          ),
        }),
    ...(record.lastInvocationAt === undefined
      ? {}
      : {
          lastInvocationAt: readNullableString(
            record.lastInvocationAt,
            "Hosted runner status response lastInvocationAt",
          ),
        }),
    mailboxLag: requireArray(record.mailboxLag, "Hosted runner status response mailboxLag")
      .map((entry, index) => parseHostedMailboxLaneLag(
        entry,
        `Hosted runner status response mailboxLag[${index}]`,
      )),
    ...(record.nextAlarmAt === undefined
      ? {}
      : {
          nextAlarmAt: readNullableString(
            record.nextAlarmAt,
            "Hosted runner status response nextAlarmAt",
          ),
        }),
    ...(record.recentLogs === undefined
      ? {}
      : {
          recentLogs: requireArray(record.recentLogs, "Hosted runner status response recentLogs")
            .map((entry) => parseHostedRuntimeLogEntry(entry)),
        }),
    userId: requireString(record.userId, "Hosted runner status response userId"),
    workspace: record.workspace === null ? null : parseHostedWorkspaceState(record.workspace),
  };
}

export function parseHostedRuntimeWebStatusResponse(value: unknown): HostedRuntimeWebStatusResponse {
  const record = requireObject(value, "Hosted runtime web status response");
  rejectLegacyAliases(
    record,
    "Hosted runtime web status response",
    Object.fromEntries(HOSTED_RUNNER_STATUS_REMOVED_FIELDS.map((field) => [field, "runner status"])),
  );
  if ("leaseGeneration" in record) {
    throw new TypeError("Hosted runtime web status response leaseGeneration has been removed.");
  }
  if ("lastRunAt" in record) {
    throw new TypeError("Hosted runtime web status response lastRunAt has been renamed to lastInvocationAt.");
  }

  return {
    mailboxLag: requireArray(record.mailboxLag, "Hosted runtime web status response mailboxLag")
      .map((entry, index) => parseHostedMailboxLaneLag(
        entry,
        `Hosted runtime web status response mailboxLag[${index}]`,
      )),
    ...(record.recentLogs === undefined
      ? {}
      : {
          recentLogs: requireArray(record.recentLogs, "Hosted runtime web status response recentLogs")
            .map((entry) => parseHostedRuntimeLogEntry(entry)),
        }),
    userId: requireString(record.userId, "Hosted runtime web status response userId"),
    workspace: record.workspace === null ? null : parseHostedWorkspaceState(record.workspace),
  };
}

export function parseHostedWorkspaceInvocationRequest(value: unknown): HostedWorkspaceInvocationRequest {
  const record = requireObject(value, "Hosted workspace invocation request");

  for (const field of HOSTED_WORKSPACE_INVOCATION_REMOVED_FIELDS) {
    rejectHostedWorkspaceInvocationRemovedField(
      record,
      field,
      "Hosted workspace invocation request",
    );
  }
  const reason = parseHostedWorkspaceInvocationReason(record.reason);

  return {
    attemptId: requireString(record.attemptId, "Hosted workspace invocation request attemptId"),
    ...(record.budget === undefined || record.budget === null
      ? {}
      : {
          budget: parseHostedWorkspaceInvocationBudget(
            record.budget,
            "Hosted workspace invocation request budget",
          ),
        }),
    ...(record.idleCheckpointDelayMs === undefined
      ? {}
      : {
          idleCheckpointDelayMs: record.idleCheckpointDelayMs === null
            ? null
            : requirePositiveInteger(
                record.idleCheckpointDelayMs,
                "Hosted workspace invocation request idleCheckpointDelayMs",
              ),
        }),
    leaseGeneration: requireNonNegativeBigIntString(
      record.leaseGeneration,
      "Hosted workspace invocation request leaseGeneration",
    ),
    ...(record.providerEgressToken === undefined
      ? {}
      : {
          providerEgressToken: readNullableString(
            record.providerEgressToken,
            "Hosted workspace invocation request providerEgressToken",
          ),
        }),
    reason,
    userId: requireString(record.userId, "Hosted workspace invocation request userId"),
    ...(record.workspace === undefined
      ? {}
      : {
          workspace: record.workspace === null
            ? null
            : parseHostedWorkspaceState(record.workspace),
        }),
    workspaceVersion: requireNonNegativeBigIntString(
      record.workspaceVersion,
      "Hosted workspace invocation request workspaceVersion",
    ),
  };
}

export function parseHostedWorkspaceInvocationResult(value: unknown): HostedWorkspaceInvocationResult {
  const record = requireObject(value, "Hosted workspace invocation result");
  rejectHostedWorkspaceInvocationRemovedField(
    record,
    "idleShutdownCheckpointed",
    "Hosted workspace invocation result",
  );
  rejectHostedWorkspaceInvocationRemovedField(
    record,
    "idleShutdownCheckpointSkipped",
    "Hosted workspace invocation result",
  );
  rejectHostedWorkspaceInvocationRemovedField(
    record,
    "workspaceCheckpointed",
    "Hosted workspace invocation result",
  );
  const nextWakeAt = record.nextWakeAt === undefined
    ? undefined
    : readNullableString(
        record.nextWakeAt,
        "Hosted workspace invocation result nextWakeAt",
      );
  const nextWakeReason = record.nextWakeReason === undefined
    ? undefined
    : readNullableString(
        record.nextWakeReason,
        "Hosted workspace invocation result nextWakeReason",
      );
  const status = parseHostedWorkspaceInvocationStatus(record.status);

  return {
    ...(nextWakeAt === undefined ? {} : { nextWakeAt }),
    ...(nextWakeReason === undefined ? {} : { nextWakeReason }),
    ...(record.redactedStatus === undefined
      ? {}
      : {
          redactedStatus: parseHostedRuntimeRedactedJson(
            record.redactedStatus,
            "Hosted workspace invocation result redactedStatus",
          ),
        }),
    status,
  };
}

export function parseHostedMailboxLane(value: unknown): HostedMailboxLane {
  return parseAllowedString(value, "Hosted mailbox lane", HOSTED_MAILBOX_LANES);
}

export function parseHostedMailboxKind(value: unknown): HostedMailboxKind {
  return parseAllowedString(value, "Hosted mailbox kind", HOSTED_MAILBOX_KINDS);
}

function parseHostedWorkspaceCheckpointReason(
  value: unknown,
): HostedWorkspaceCheckpointReason {
  return parseAllowedString(
    value,
    "Hosted workspace checkpoint reason",
    HOSTED_WORKSPACE_CHECKPOINT_REASONS,
  );
}

function parseHostedWorkspaceInvocationBudget(
  value: unknown,
  label: string,
): HostedWorkspaceInvocationBudget {
  const record = requireObject(value, label);

  return {
    ...(record.maxMailboxItems === undefined
      ? {}
      : {
          maxMailboxItems: record.maxMailboxItems === null
            ? null
            : requirePositiveInteger(record.maxMailboxItems, `${label}.maxMailboxItems`),
        }),
    ...(record.maxRuntimeMs === undefined
      ? {}
      : {
          maxRuntimeMs: record.maxRuntimeMs === null
            ? null
            : requirePositiveInteger(record.maxRuntimeMs, `${label}.maxRuntimeMs`),
        }),
  };
}

function parseHostedWorkspaceInvocationReason(value: unknown): HostedWorkspaceInvocationReason {
  return parseAllowedString(
    value,
    "Hosted workspace invocation request reason",
    HOSTED_WORKSPACE_INVOCATION_REASONS,
  );
}

function parseHostedWorkspaceInvocationStatus(value: unknown): HostedWorkspaceInvocationStatus {
  return parseAllowedString(
    value,
    "Hosted workspace invocation result status",
    HOSTED_WORKSPACE_INVOCATION_STATUSES,
  );
}

function rejectHostedWorkspaceInvocationRemovedField(
  record: Record<string, unknown>,
  field: string,
  label: string,
): void {
  if (record[field] !== undefined) {
    throw new TypeError(`${label}.${field} is no longer supported.`);
  }
}

function parseHostedRuntimeSideInputUnavailableCode(
  value: unknown,
): HostedRuntimeSideInputUnavailableCode {
  return parseAllowedString(
    value,
    "Hosted runtime side-input unavailable code",
    HOSTED_RUNTIME_SIDE_INPUT_UNAVAILABLE_CODES,
  );
}

function parseHostedRuntimeDeviceSyncBridgeKind(
  value: unknown,
): HostedRuntimeDeviceSyncBridgeKind {
  return parseAllowedString(
    value,
    "Hosted runtime device-sync bridge kind",
    HOSTED_RUNTIME_DEVICE_SYNC_BRIDGE_KINDS,
  );
}

function parseHostedRuntimeLogLevel(value: unknown): HostedRuntimeLogLevel {
  return parseAllowedString(value, "Hosted runtime log level", HOSTED_RUNTIME_LOG_LEVELS);
}

function parseHostedRuntimeLogComponent(value: unknown): HostedRuntimeLogComponent {
  return parseAllowedString(
    value,
    "Hosted runtime log component",
    HOSTED_RUNTIME_LOG_COMPONENTS,
  );
}

function parseHostedRuntimeLogPhase(value: unknown): HostedRuntimeLogPhase {
  return parseAllowedString(value, "Hosted runtime log phase", HOSTED_RUNTIME_LOG_PHASES);
}

function parseHostedRuntimeLogEventCode(value: unknown): HostedRuntimeLogEventCode {
  return parseAllowedString(
    value,
    "Hosted runtime log eventCode",
    HOSTED_RUNTIME_LOG_EVENT_CODES,
  );
}

function parseHostedMailboxLaneCursor(
  value: unknown,
  label: string,
): HostedMailboxLaneCursor {
  const record = requireObject(value, label);

  return {
    importedSeq: requireNonNegativeBigIntString(record.importedSeq, `${label}.importedSeq`),
    lane: parseHostedMailboxLane(record.lane),
  };
}

function parseHostedMailboxLaneHighWater(
  value: unknown,
  label: string,
): HostedMailboxLaneHighWater {
  const record = requireObject(value, label);

  return {
    lane: parseHostedMailboxLane(record.lane),
    maxSeq: requireNonNegativeBigIntString(record.maxSeq, `${label}.maxSeq`),
    ...(record.maxUpdatedAt === undefined
      ? {}
      : {
          maxUpdatedAt: readNullableString(
            record.maxUpdatedAt,
            `${label}.maxUpdatedAt`,
          ),
        }),
  };
}

function parseHostedMailboxLaneLag(value: unknown, label: string): HostedMailboxLaneLag {
  const record = requireObject(value, label);

  return {
    importedSeq: requireNonNegativeBigIntString(record.importedSeq, `${label}.importedSeq`),
    lag: requireNonNegativeBigIntString(record.lag, `${label}.lag`),
    lane: parseHostedMailboxLane(record.lane),
    maxSeq: requireNonNegativeBigIntString(record.maxSeq, `${label}.maxSeq`),
    ...(record.maxUpdatedAt === undefined
      ? {}
      : {
          maxUpdatedAt: readNullableString(
            record.maxUpdatedAt,
            `${label}.maxUpdatedAt`,
          ),
        }),
  };
}

function parseOptionalHostedRuntimeSideInputUnavailable(
  value: unknown,
  label: string,
): HostedRuntimeSideInputUnavailable | null {
  if (value === undefined || value === null) {
    return null;
  }

  const record = requireObject(value, label);

  return {
    code: parseHostedRuntimeSideInputUnavailableCode(record.code),
    retryable: requireBoolean(record.retryable, `${label}.retryable`),
  };
}

function assertPayloadOrUnavailable(
  payload: object | null,
  unavailable: HostedRuntimeSideInputUnavailable | null,
  label: string,
): void {
  if (payload === null && unavailable === null) {
    throw new TypeError(`${label} requires payload or unavailable.`);
  }

  if (payload !== null && unavailable !== null) {
    throw new TypeError(`${label} must not include both payload and unavailable.`);
  }
}

function parseHostedRuntimeRecordExportResponse(
  value: unknown,
  idsFieldName: "issueIds",
): { ids: string[]; recorded: number } {
  const record = requireObject(value, "Hosted runtime record export response");
  const ids = requireArray(
    record[idsFieldName],
    `Hosted runtime record export response ${idsFieldName}`,
  ).map((entry, index) => requireString(
    entry,
    `Hosted runtime record export response ${idsFieldName}[${index}]`,
  ));

  const recorded = requireNonNegativeInteger(
    record.recorded,
    "Hosted runtime record export response recorded",
  );

  if (recorded !== ids.length) {
    throw new TypeError(
      `Hosted runtime record export response recorded must equal ${idsFieldName}.length.`,
    );
  }

  return {
    ids,
    recorded,
  };
}

function parseAllowedString<T extends string>(
  value: unknown,
  label: string,
  allowed: readonly T[],
): T {
  const text = requireString(value, label);

  if (allowed.includes(text as T)) {
    return text as T;
  }

  throw new TypeError(`${label} is not supported.`);
}

function requirePositiveInteger(value: unknown, label: string): number {
  const parsed = requireNonNegativeInteger(value, label);

  if (parsed === 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }

  return parsed;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  const parsed = requireNumber(value, label);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }

  return parsed;
}

function requireNonNegativeBigIntString(value: unknown, label: string): string {
  const text = requireString(value, label);

  if (!/^[0-9]+$/u.test(text)) {
    throw new TypeError(`${label} must be a non-negative base-10 integer string.`);
  }

  return text;
}

function parseHostedRuntimeRedactedJson(
  value: unknown,
  label: string,
): HostedRuntimeRedactedJson | null {
  if (value === null || value === undefined) {
    return null;
  }

  const record = requireObject(value, label);
  const entries = Object.entries(record);
  const parsed: HostedRuntimeRedactedJson = {};

  if (entries.length > HOSTED_RUNTIME_REDACTED_JSON_MAX_KEYS) {
    throw new TypeError(
      `${label} must contain at most ${HOSTED_RUNTIME_REDACTED_JSON_MAX_KEYS} fields.`,
    );
  }

  for (const [key, entryValue] of entries) {
    assertAllowedRedactedKey(key, `${label}.${key}`);
    parsed[key] = parseHostedRuntimeRedactedValue(entryValue, `${label}.${key}`, key);
  }

  return parsed;
}

function parseHostedRuntimeRedactedValue(
  value: unknown,
  label: string,
  key: string,
): HostedRuntimeRedactedValue {
  if (BOOLEAN_REDACTED_KEY_NAMES.has(key)) {
    return parseHostedRuntimeRedactedBoolean(value, label);
  }
  if (ROUTE_PLANNING_ELAPSED_MS_REDACTED_KEY_NAMES.has(key)) {
    return parseHostedRuntimeRedactedElapsedMs(value, label);
  }
  if (key === "routePlanningSlowestStage") {
    return parseHostedRuntimeRedactedRoutePlanningStage(value, label);
  }

  if (Array.isArray(value)) {
    if (value.length > HOSTED_RUNTIME_REDACTED_ARRAY_MAX_LENGTH) {
      throw new TypeError(
        `${label} must contain at most ${HOSTED_RUNTIME_REDACTED_ARRAY_MAX_LENGTH} redacted values.`,
      );
    }

    if (value.some((entry) => entry && typeof entry === "object")) {
      if (!HOSTED_RUNTIME_REDACTED_OBJECT_ARRAY_KEYS.has(key)) {
        throw new TypeError(`${label} must be a shallow redacted scalar or scalar array.`);
      }

      return value.map((entry, index) =>
        parseHostedRuntimeRedactedObject(entry, `${label}[${index}]`));
    }

    return value.map((entry, index) =>
      parseHostedRuntimeRedactedScalar(entry, `${label}[${index}]`));
  }

  return parseHostedRuntimeRedactedScalar(value, label);
}

function parseHostedRuntimeRedactedBoolean(
  value: unknown,
  label: string,
): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  throw new TypeError(`${label} must be a boolean.`);
}

function parseHostedRuntimeRedactedElapsedMs(
  value: unknown,
  label: string,
): number | null {
  if (value === null) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0) {
      return value;
    }
  }

  throw new TypeError(`${label} must be a nonnegative finite number or null.`);
}

function parseHostedRuntimeRedactedRoutePlanningStage(
  value: unknown,
  label: string,
): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value === "string" && ROUTE_PLANNING_STAGE_VALUES.has(value)) {
    return value;
  }

  throw new TypeError(`${label} must be a known route-planning stage or null.`);
}

function parseHostedRuntimeRedactedObject(
  value: unknown,
  label: string,
): HostedRuntimeRedactedObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a redacted object.`);
  }

  const entries = Object.entries(value);
  if (entries.length > HOSTED_RUNTIME_REDACTED_OBJECT_MAX_KEYS) {
    throw new TypeError(
      `${label} must contain at most ${HOSTED_RUNTIME_REDACTED_OBJECT_MAX_KEYS} fields.`,
    );
  }

  const parsed: HostedRuntimeRedactedObject = {};
  for (const [key, entryValue] of entries) {
    assertAllowedRedactedKey(key, `${label}.${key}`);
    parsed[key] = BOOLEAN_REDACTED_KEY_NAMES.has(key)
      ? parseHostedRuntimeRedactedBoolean(entryValue, `${label}.${key}`)
      : parseHostedRuntimeRedactedScalar(entryValue, `${label}.${key}`);
  }

  return parsed;
}

function parseHostedRuntimeRedactedScalar(
  value: unknown,
  label: string,
): HostedRuntimeRedactedScalar {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError(`${label} must be a finite redacted value.`);
    }

    return value;
  }

  if (typeof value === "string") {
    assertSafeRedactedString(value, label);
    return value;
  }

  throw new TypeError(`${label} must be a shallow redacted scalar or scalar array.`);
}

function assertAllowedRedactedKey(key: string, label: string): void {
  if (isSafeDiagnosticTextRedactedKey(key)) {
    return;
  }
  if (key.startsWith("routePlanning") && !ROUTE_PLANNING_REDACTED_KEY_NAMES.has(key)) {
    throw new TypeError(`${label} is not an allowed route-planning diagnostic key.`);
  }

  const normalized = key.toLowerCase();

  for (const forbidden of FORBIDDEN_RAW_REDACTED_KEY_NAMES) {
    if (
      normalized.includes(forbidden)
      && !isSafeRedactedMetadataKey(key)
    ) {
      throw new TypeError(`${label} is not allowed in hosted runtime redacted JSON.`);
    }
  }
}

function isSafeDiagnosticTextRedactedKey(key: string): boolean {
  return SAFE_DIAGNOSTIC_TEXT_REDACTED_KEY_NAMES.has(key)
    || SAFE_DIAGNOSTIC_TEXT_REDACTED_KEY_PATTERN.test(key);
}

function isSafeRedactedMetadataKey(key: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u.test(key)
    && SAFE_REDACTED_METADATA_KEY_SUFFIXES.some((suffix) => key.endsWith(suffix));
}

function assertNoForbiddenRuntimeLogKeys(
  record: Record<string, unknown>,
  label: string,
): void {
  for (const key of Object.keys(record)) {
    if (!HOSTED_RUNTIME_LOG_ENTRY_KEYS.has(key)) {
      throw new TypeError(`${label}.${key} is not allowed in hosted runtime log entries.`);
    }
  }
}

function assertAllowedObjectKeys(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`${label}.${key} is not allowed.`);
    }
  }
}

function assertSafeRedactedString(value: string, label: string): void {
  if (value.length > HOSTED_RUNTIME_REDACTED_STRING_MAX_LENGTH) {
    throw new TypeError(
      `${label} must be at most ${HOSTED_RUNTIME_REDACTED_STRING_MAX_LENGTH} characters.`,
    );
  }

  if (/\/Users\/|file:\/\/|[A-Za-z]:\\|<HOME_DIR>|(^|[\s(])\/[^\s)]+/u.test(value)) {
    throw new TypeError(`${label} must not contain a local filesystem path.`);
  }
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(value)) {
    throw new TypeError(`${label} must not contain an email address.`);
  }
  if (/\+\d[\d().\s-]{7,}\d/u.test(value)) {
    throw new TypeError(`${label} must not contain a phone number.`);
  }
  if (
    /(["']?(?:authorization|secret|token|password|cookie|set-cookie|api[-_]?key)["']?\s*[:=]\s*["']?)([^"',\s}]+)/iu
      .test(value)
    || /\b(Basic|Bearer)\s+[A-Z0-9._~+/=-]+\b/iu.test(value)
    || /\b(?:sk|pk|rk)_(?:live|test)_[A-Z0-9]+\b/iu.test(value)
    || /\bwhsec_[A-Z0-9]+\b/iu.test(value)
  ) {
    throw new TypeError(`${label} must not contain secret-shaped content.`);
  }
}

function readNullableHostedRuntimeLogString(
  value: unknown,
  label: string,
): string | null {
  const text = readNullableString(value, label);

  if (text === null) {
    return null;
  }

  assertSafeHostedRuntimeLogString(text, label);

  return text;
}

function assertSafeHostedRuntimeLogString(value: string, label: string): void {
  assertSafeRedactedString(value, label);

  if (value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)) {
    throw new TypeError(`${label} must be a bounded opaque identifier or code.`);
  }
}
