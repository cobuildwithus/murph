import {
  parseHostedExecutionDeviceSyncRuntimeApplyRequest,
  parseHostedExecutionDeviceSyncRuntimeSnapshotRequest,
  parseHostedExecutionDeviceSyncWakeHint,
} from "@murphai/device-syncd/hosted-runtime";
import {
  parseHostedExecutionDeviceSyncExpectedConnectedAt,
} from "./device-sync.ts";
import {
  parseAssistantUsageRecord,
} from "../assistant-usage.ts";
import {
  parseHostedAssistantCustomInferenceOverride,
} from "../assistant-inference.ts";
import {
  HOSTED_ASSISTANT_DEFAULT_PROVIDER,
  isHostedAssistantProductModel,
  isHostedAssistantProvider,
  isHostedAssistantReasoningEffort,
  parseHostedAssistantModelOverride,
  parseHostedAssistantProviderOverride,
  parseHostedAssistantReasoningEffortOverride,
  type HostedAssistantProductModel,
  type HostedAssistantProvider,
  type HostedAssistantReasoningEffort,
} from "../assistant-model.ts";
import {
  parseAssistantRuntimeIssueRecord,
} from "@murphai/runtime-state/node/assistant-runtime-issues";
import {
  HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
  HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS,
  type HostedExecutionAcceptedGroupMessageParticipant,
} from "../contracts.ts";
import {
  parseHostedRuntimePendingGroupSetupInput,
} from "../pending-group-setup.ts";
import {
  parseHostedExecutionAssistantAskBoundedText as parseHostedRuntimeGroupAskBoundedText,
  parseHostedExecutionAssistantAskOrigin,
  parseHostedExecutionAssistantAskOriginInputId,
  parseHostedExecutionAssistantAskResult,
} from "../assistant-ask-payload.ts";
import {
  HOSTED_RUNTIME_DEVICE_SYNC_BRIDGE_KINDS,
  HOSTED_PLAN_CODES,
  HOSTED_INGRESS_LATENCY_SOURCES,
  HOSTED_RUNTIME_ASSISTANT_MILESTONES,
  HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_MAX_CODE_POINTS,
  HOSTED_RUNTIME_SIDE_INPUT_UNAVAILABLE_CODES,
  HOSTED_RUNTIME_LATENCY_TRACE_ASSISTANT_INPUT_MAX_IDS,
  HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_KEYS,
  HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS,
  isHostedRuntimeDirectEnsureOrchestrationAttemptId,
  HOSTED_RUNTIME_LATENCY_TRACE_MILESTONES,
  HOSTED_MAILBOX_FETCH_CURSOR_MODES,
  HOSTED_MAILBOX_KINDS,
  HOSTED_MAILBOX_LANES,
  HOSTED_IDLE_CHECKPOINT_TRIGGERS,
  HOSTED_CODEX_AUTH_UPDATE_RESPONSE_STATUSES,
  HOSTED_CANONICAL_WRITE_RECEIPT_REDACTED_STATUS_KEYS,
  HOSTED_RUNTIME_LOG_COMPONENTS,
  HOSTED_RUNTIME_LOG_EVENT_CODES,
  HOSTED_RUNTIME_LOG_LEVELS,
  HOSTED_RUNTIME_LOG_PHASES,
  HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES,
  HOSTED_PRODUCT_FEEDBACK_KINDS,
  HOSTED_PRODUCT_FEEDBACK_SUMMARY_MAX_LENGTH,
  sanitizeHostedProductFeedbackSummary,
  HOSTED_WORKSPACE_CHECKPOINT_CONFLICT_REASONS,
  HOSTED_WORKSPACE_CHECKPOINT_HANDLED_CONVERSATION_ITEM_MAX_IDS,
  HOSTED_WORKSPACE_CHECKPOINT_REASONS,
  HOSTED_WORKSPACE_INVOCATION_PROCESSING_MODES,
  HOSTED_WORKSPACE_INVOCATION_STATUSES,
  type HostedMailboxFetchRequest,
  type HostedMailboxFetchResponse,
  type HostedMailboxItem,
  type HostedMailboxKind,
  type HostedMailboxLane,
  type HostedMailboxLaneConsumed,
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
  type HostedRuntimeLatencyPhaseBreakdown,
  type HostedRuntimeLatencyPhaseBreakdownPhase,
  type HostedRuntimeAssistantMilestone,
  type HostedRuntimeAssistantAskControlRequest,
  type HostedRuntimeAssistantAskControlResponse,
  type HostedRuntimeLatencyTraceAssistantMilestoneEvent,
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
  HOSTED_HEALTH_DATA_CONSENT_STATES,
  type HostedRuntimeHealthDataAdmissionResponse,
  type HostedRuntimeRedactedJson,
  type HostedRuntimeRedactedObject,
  type HostedRuntimeRedactedScalar,
  type HostedRuntimeRedactedValue,
  type HostedRuntimeWebStatusResponse,
  type HostedRuntimeSideInputUnavailable,
  type HostedRuntimeSideInputUnavailableCode,
  type HostedRuntimeUsageRecordRequest,
  type HostedRuntimeUsageRecordResponse,
  type HostedRuntimeFamilyPlanToolRequest,
  type HostedRuntimeFamilyPlanToolResponse,
  type HostedRuntimeFamilyPlanToolStartCheckoutResponse,
  type HostedRuntimeFamilyPlanToolStatusResponse,
  type HostedRuntimeIMessageContactToolRequest,
  type HostedRuntimeIMessageContactToolResponse,
  type HostedPlanCode,
  type HostedRuntimeAssistantConfigurationSnapshot,
  type HostedRuntimeAssistantConfigurationControlRequest,
  type HostedRuntimeAssistantConfigurationToolRequest,
  type HostedRuntimeAssistantConfigurationToolResponse,
  type HostedRuntimeAssistantConfigurationUpdateStatus,
  HOSTED_RUNTIME_GROUP_CHAT_ICON_URL_MAX_LENGTH,
  hostedRuntimeLinqProviderErrorMessageForCode,
  HOSTED_RUNTIME_GROUP_DISCLOSURE_GRANTS_MAX,
  HOSTED_RUNTIME_GROUP_DISCLOSURE_PERMISSION_TEXT_MAX_CODE_POINTS,
  HOSTED_RUNTIME_GROUP_DISPLAY_NAME_MAX_LENGTH,
  HOSTED_RUNTIME_GROUP_JOIN_OFFER_MESSAGE_TEMPLATE_MAX_LENGTH,
  HOSTED_RUNTIME_GROUP_KINDS,
  HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX,
  HOSTED_RUNTIME_GROUP_CONTACT_CARD_SHARE_KEY_MAX_CODE_POINTS,
  HOSTED_RUNTIME_GROUP_SENDER_HANDLE_MAX_CODE_POINTS,
  HOSTED_RUNTIME_GROUP_OWNER_ADVISORY_NAME_MAX_CODE_POINTS,
  HOSTED_RUNTIME_GROUP_MEMBERSHIPS_MAX,
  HOSTED_RUNTIME_GROUP_SHARED_READ_DISPLAY_NAME_MAX_CODE_POINTS,
  HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_MEMBERS,
  HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_PROJECTION_SCOPES,
  HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_RECORDS_PER_PROJECTION,
  HOSTED_RUNTIME_GROUP_SHARED_READ_MEMBER_ID_MAX_CODE_POINTS,
  HOSTED_RUNTIME_GROUP_SHARED_READ_PARTICIPANT_ID_MAX_CODE_POINTS,
  HOSTED_RUNTIME_GROUP_SHARED_READ_SCOPE_KEY_MAX_CODE_POINTS,
  HOSTED_RUNTIME_GROUP_SHARED_READ_UNAVAILABLE_REASON_MAX_CODE_POINTS,
  HOSTED_USAGE_REFERRAL_POLICY_CODES,
  HOSTED_RUNTIME_NEWSLETTER_AUTHORIZED_SHARES_PER_PARTICIPANT_MAX,
  isHostedRuntimeNewsletterAuthorizationProof,
  HOSTED_RUNTIME_NEWSLETTER_HTML_MAX_LENGTH,
  HOSTED_RUNTIME_NEWSLETTER_PARTICIPANTS_MAX,
  HOSTED_RUNTIME_NEWSLETTER_SUBJECT_MAX_LENGTH,
  HOSTED_RUNTIME_NEWSLETTER_TEXT_MAX_LENGTH,
  isHostedRuntimePrivateImageDeliveryUrl,
  type HostedRuntimeGroupChatParticipant,
  type HostedRuntimeGroupCreateJoinLinkRequest,
  type HostedRuntimeGroupDisclosureGrantListEntry,
  type HostedRuntimeGroupDisclosureGrantSummary,
  type HostedRuntimeGroupKind,
  type HostedRuntimeGroupPostJoinOfferRequest,
  type HostedRuntimeGroupUpdateDisplayNameRequest,
  type HostedRuntimeGroupToolLinqThreadContext,
  type HostedRuntimeGroupMembershipSummary,
  type HostedRuntimeGroupParticipantDisplayNameSource,
  type HostedRuntimeGroupMemberAskResult,
  type HostedRuntimeGroupMemberSummary,
  type HostedRuntimeGroupSharedMember,
  type HostedRuntimeGroupSharedProjection,
  type HostedRuntimeGroupSharedReadResult,
  type HostedRuntimeGroupSharedRecord,
  type HostedRuntimeGroupToolSelfOptOutContext,
  type HostedRuntimeGroupToolRequest,
  type HostedRuntimeGroupToolResponse,
  type HostedRuntimeUsageReferralSnapshot,
  type HostedRuntimeUsageReferralSourceConversation,
  type HostedUsageReferralPolicyCode,
  type HostedRuntimeNewsletterAuthorizedShare,
  type HostedRuntimeNewsletterParticipantSummary,
  type HostedRuntimeNewsletterToolRequest,
  type HostedRuntimeNewsletterToolResponse,
  type HostedRuntimeProductFeedbackRecordRequest,
  type HostedRuntimeProductFeedbackRecordResponse,
  type HostedCodexAuthUpdate,
  type HostedCodexAuthUpdateResponse,
  type HostedCodexAuthUpdateResponseStatus,
  type HostedProductFeedbackKind,
  type HostedIngressLatencySource,
  type HostedIdleCheckpointTrigger,
  type HostedWorkspaceCheckpointReason,
  type HostedWorkspaceCheckpointRequest,
  type HostedWorkspaceCheckpointResponse,
  type HostedWorkspaceReadResponse,
  type HostedWorkspaceInvocationBudget,
  type HostedWorkspaceInvocationRequest,
  type HostedWorkspaceInvocationResult,
  type HostedWorkspaceInvocationStatus,
  type HostedWorkspaceState,
} from "../runtime-control.ts";
import type {
  HostedExecutionLinqExternalThreadRouteAuthority,
} from "../contracts.ts";
import {
  HOSTED_VAULT_SHARE_PROJECTION_KINDS,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
  buildHostedVaultShareProjectionScopeKey,
  hostedVaultShareProjectionKindToScope,
  parseHostedVaultShareDeliveryRecord,
  parseHostedVaultShareProjectionScope,
  type HostedVaultShareProjectionScope,
  type HostedVaultShareProjectionKind,
  type HostedVaultShareSelectableProjectionScope,
} from "../vault-share.ts";
import {
  rejectLegacyAliases,
  requireArray,
  requireBoolean,
  requireNumber,
  requireObject,
  readOptionalStringArray,
  requireString,
  readNullableString,
  readOptionalNullableString,
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
const HOSTED_RUNTIME_DIRECT_ID_TEXT_PATTERNS: readonly RegExp[] = [
  /\bhosted-user-runtime:[A-Za-z0-9._:-]+/u,
  /\b(?:member|user)_[A-Za-z0-9._:-]*\d[A-Za-z0-9._:-]*/u,
];
const ROUTE_PLANNING_ELAPSED_MS_REDACTED_KEY_NAMES = new Set([
  "routePlanningActiveExperimentContextElapsedMs",
  "routePlanningAssistantContextSnapshotElapsedMs",
  "routePlanningCliBootstrapElapsedMs",
  "routePlanningElapsedMs",
  "routePlanningFallbackInstructionsElapsedMs",
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
  "routePlanningSlowestStage",
]);
const SAFE_REDACTED_METADATA_KEY_SUFFIXES = [
  "Available",
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
const HOSTED_CANONICAL_WRITE_RECEIPT_REDACTED_STATUS_KEY_SET =
  new Set<string>(HOSTED_CANONICAL_WRITE_RECEIPT_REDACTED_STATUS_KEYS);
const HOSTED_RUNTIME_REDACTED_ARRAY_MAX_LENGTH = 16;
const HOSTED_RUNTIME_REDACTED_OBJECT_MAX_KEYS = 16;
const HOSTED_RUNTIME_REDACTED_OBJECT_ARRAY_KEYS = new Set([
  "codexActionToolSummaries",
  "deliveryErrorSummaries",
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
  "phaseBreakdown",
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
  "phaseBreakdown",
  "providerRequestOrdinal",
  "runtimeAttemptId",
  "source",
  "type",
]);
const HOSTED_RUNTIME_LATENCY_TRACE_ASSISTANT_MILESTONE_KEYS = new Set([
  "assistantInputIds",
  "at",
  "checkpointPublicationExpectedBy",
  "milestone",
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
const HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_KEY_SET = new Set<string>(
  HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_KEYS,
);
const HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEY_SETS: Record<
  HostedRuntimeLatencyPhaseBreakdownPhase,
  ReadonlySet<string>
> = {
  orchestration: new Set(HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS.orchestration),
  dispatch: new Set(HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS.dispatch),
  restore: new Set(HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS.restore),
  boot: new Set(HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS.boot),
  wake: new Set(HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS.wake),
  import: new Set(HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS.import),
  preProvider: new Set(HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS.preProvider),
  assistant: new Set(HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS.assistant),
  provider: new Set(HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEYS.provider),
};
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
  "reason",
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
    ...(record.causalSeq === undefined
      // Legacy-v1 mailbox payloads predate causal tokens. Normalize that
      // compatibility case once at the wire boundary; active rows use an
      // explicit sequence or null and must never inherit the legacy anchor.
      ? { causalSeq: "0" }
      : {
          causalSeq: record.causalSeq === null
            ? null
            : requireNonNegativeBigIntString(
                record.causalSeq,
                "Hosted mailbox item causalSeq",
              ),
        }),
    ...(record.consumedAt === undefined
      ? {}
      : { consumedAt: readNullableString(record.consumedAt, "Hosted mailbox item consumedAt") }),
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
    ...(record.cursorMode === undefined || record.cursorMode === null
      ? {}
      : {
          cursorMode: parseAllowedString(
            record.cursorMode,
            "Hosted mailbox fetch request cursorMode",
            HOSTED_MAILBOX_FETCH_CURSOR_MODES,
          ),
        }),
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
    ...(record.conversationUsageStatus === undefined
      ? {}
      : {
          conversationUsageStatus:
            parseHostedMailboxConversationUsageStatus(
              record.conversationUsageStatus,
            ),
        }),
    ...(record.groupRunningBit === undefined
      ? {}
      : {
          groupRunningBit: record.groupRunningBit === null
            ? null
            : parseHostedGroupRunningBitProjection(record.groupRunningBit),
        }),
    ...(record.consumedSeqByLane === undefined || record.consumedSeqByLane === null
      ? {}
      : {
          consumedSeqByLane: requireArray(
            record.consumedSeqByLane,
            "Hosted mailbox fetch response consumedSeqByLane",
          ).map((entry, index) => parseHostedMailboxLaneConsumed(
            entry,
            `Hosted mailbox fetch response consumedSeqByLane[${index}]`,
          )),
        }),
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

function parseHostedGroupRunningBitProjection(
  value: unknown,
): NonNullable<HostedMailboxFetchResponse["groupRunningBit"]> {
  const record = requireObject(
    value,
    "Hosted mailbox fetch response groupRunningBit",
  );
  const allowedKeys = new Set([
    "expiresAt",
    "publicAlias",
    "requestedBit",
    "schema",
  ]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw new TypeError(
      "Hosted mailbox fetch response groupRunningBit contains unknown fields.",
    );
  }
  if (record.schema !== "murph.group-sponsorship-bit.v1") {
    throw new TypeError(
      "Hosted mailbox fetch response groupRunningBit schema is invalid.",
    );
  }
  const expiresAt = requireString(
    record.expiresAt,
    "Hosted mailbox fetch response groupRunningBit expiresAt",
  );
  if (
    !Number.isFinite(new Date(expiresAt).getTime()) ||
    new Date(expiresAt).toISOString() !== expiresAt
  ) {
    throw new TypeError(
      "Hosted mailbox fetch response groupRunningBit expiresAt must be canonical.",
    );
  }
  const publicAlias = readNullableString(
    record.publicAlias,
    "Hosted mailbox fetch response groupRunningBit publicAlias",
  );
  const requestedBit = requireString(
    record.requestedBit,
    "Hosted mailbox fetch response groupRunningBit requestedBit",
  );
  if (
    (publicAlias && [...publicAlias].length > 80) ||
    [...requestedBit].length < 1 ||
    [...requestedBit].length > 240
  ) {
    throw new TypeError(
      "Hosted mailbox fetch response groupRunningBit text is out of bounds.",
    );
  }
  return {
    expiresAt,
    publicAlias,
    requestedBit,
    schema: "murph.group-sponsorship-bit.v1",
  };
}

function parseHostedMailboxConversationUsageStatus(value: unknown): "low" | null {
  if (value === null || value === "low") {
    return value;
  }

  throw new TypeError(
    "Hosted mailbox fetch response conversationUsageStatus must be low or null.",
  );
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
        ...(record.expectedConnectedAt === undefined
          ? {}
          : {
              expectedConnectedAt: parseHostedExecutionDeviceSyncExpectedConnectedAt(
                record.expectedConnectedAt,
                "Hosted runtime device-sync bridge expectedConnectedAt",
              ),
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
  assertAllowedObjectKeys(
    record,
    new Set(["noticeDeliveryTarget", "usage"]),
    "Hosted runtime usage record request",
  );

  return {
    ...(record.noticeDeliveryTarget === undefined
      ? {}
      : {
          noticeDeliveryTarget: record.noticeDeliveryTarget === null
            ? null
            : parseHostedRuntimeUsageNoticeDeliveryTarget(
                record.noticeDeliveryTarget,
              ),
        }),
    usage: parseAssistantUsageRecord(record.usage),
  };
}

function parseHostedRuntimeUsageNoticeDeliveryTarget(
  value: unknown,
): NonNullable<HostedRuntimeUsageRecordRequest["noticeDeliveryTarget"]> {
  const label = "Hosted runtime usage notice delivery target";
  const record = requireObject(value, label);
  const channel = requireString(record.channel, `${label} channel`);
  if (channel === "linq") {
    assertAllowedObjectKeys(
      record,
      new Set(["channel", "replyToMessageId", "routeAuthority", "target"]),
      label,
    );
    return {
      channel,
      replyToMessageId: readNullableString(
        record.replyToMessageId,
        `${label} replyToMessageId`,
      ),
      routeAuthority: record.routeAuthority === null
        ? null
        : parseHostedRuntimeLinqExternalThreadRouteAuthority(
            record.routeAuthority,
            `${label} routeAuthority`,
          ),
      target: requireString(record.target, `${label} target`),
    };
  }
  if (channel === "telegram") {
    assertAllowedObjectKeys(
      record,
      new Set(["channel", "replyToMessageId", "target"]),
      label,
    );
    return {
      channel,
      replyToMessageId: requireString(
        record.replyToMessageId,
        `${label} replyToMessageId`,
      ),
      target: requireString(record.target, `${label} target`),
    };
  }

  throw new TypeError(`${label} channel is not supported.`);
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

export function parseHostedRuntimeProductFeedbackRecordRequest(
  value: unknown,
): HostedRuntimeProductFeedbackRecordRequest {
  const record = requireObject(value, "Hosted runtime product feedback request");
  assertAllowedObjectKeys(
    record,
    new Set(["feedback"]),
    "Hosted runtime product feedback request",
  );
  const feedback = requireObject(
    record.feedback,
    "Hosted runtime product feedback request feedback",
  );
  assertAllowedObjectKeys(
    feedback,
    new Set([
      "idempotencyKey",
      "kind",
      "relatedChangelogItemIds",
      "summary",
    ]),
    "Hosted runtime product feedback request feedback",
  );
  const idempotencyKey = requireString(
    feedback.idempotencyKey,
    "Hosted runtime product feedback idempotencyKey",
  );
  if (!/^[a-f0-9]{64}$/u.test(idempotencyKey)) {
    throw new TypeError(
      "Hosted runtime product feedback idempotencyKey must be a SHA-256 hex digest.",
    );
  }
  const kind = parseHostedProductFeedbackKind(feedback.kind);
  const summary = parseHostedProductFeedbackSummary(feedback.summary);
  const relatedChangelogItemIds = parseHostedProductFeedbackSlugArray(
    readOptionalStringArray(
      feedback.relatedChangelogItemIds,
      "Hosted runtime product feedback relatedChangelogItemIds",
    ) ?? [],
    {
      itemLabel: "Hosted runtime product feedback related changelog item id",
      label: "Hosted runtime product feedback relatedChangelogItemIds",
      maxLength: 120,
    },
  );
  return {
    feedback: {
      idempotencyKey,
      kind,
      relatedChangelogItemIds,
      summary,
    },
  };
}

export function parseHostedRuntimeProductFeedbackRecordResponse(
  value: unknown,
): HostedRuntimeProductFeedbackRecordResponse {
  const record = requireObject(value, "Hosted runtime product feedback response");
  assertAllowedObjectKeys(
    record,
    new Set(["feedbackId", "recorded"]),
    "Hosted runtime product feedback response",
  );
  return {
    feedbackId: requireString(
      record.feedbackId,
      "Hosted runtime product feedback response feedbackId",
    ),
    recorded: requireBoolean(
      record.recorded,
      "Hosted runtime product feedback response recorded",
    ),
  };
}

export function parseHostedRuntimeAssistantAskControlRequest(
  value: unknown,
): HostedRuntimeAssistantAskControlRequest {
  const record = requireObject(value, "Hosted runtime assistant ask control request");
  const action = requireString(
    record.action,
    "Hosted runtime assistant ask control request action",
  );
  const requestId = parseHostedRuntimeGroupAskBoundedText({
    label: "Hosted runtime assistant ask control request requestId",
    maxCodePoints: HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_MAX_CODE_POINTS,
    value: record.requestId,
  });
  if (action === "prepare") {
    assertAllowedObjectKeys(
      record,
      new Set(["action", "requestId"]),
      "Hosted runtime assistant ask prepare control request",
    );
    return { action, requestId };
  }
  if (action === "complete") {
    assertAllowedObjectKeys(
      record,
      new Set(["action", "requestId", "result"]),
      "Hosted runtime assistant ask complete control request",
    );
    return {
      action,
      requestId,
      result: parseHostedExecutionAssistantAskResult(
        record.result,
        "Hosted runtime assistant ask result",
      ),
    };
  }
  throw new TypeError("Hosted runtime assistant ask control request action is invalid.");
}

export function parseHostedRuntimeAssistantAskControlResponse(
  value: unknown,
): HostedRuntimeAssistantAskControlResponse {
  const record = requireObject(value, "Hosted runtime assistant ask control response");
  const action = requireString(
    record.action,
    "Hosted runtime assistant ask control response action",
  );
  const status = requireString(
    record.status,
    "Hosted runtime assistant ask control response status",
  );
  if (action === "prepare" && status === "ready") {
    const label = "Hosted runtime assistant ask prepare ready control response";
    const question = parseHostedRuntimeGroupAskBoundedText({
      label: "Hosted runtime assistant ask prepare response question",
      maxCodePoints: HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
      value: record.question,
    });
    const targetLabel = record.targetLabel === null
      ? null
      : parseHostedRuntimeGroupAskBoundedText({
          label: "Hosted runtime assistant ask prepare response targetLabel",
          maxCodePoints: HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS,
          value: record.targetLabel,
        });
    if (record.disclosure === undefined) {
      assertAllowedObjectKeys(
        record,
        new Set(["action", "question", "status", "targetLabel"]),
        label,
      );
      return { action, question, status, targetLabel };
    }
    assertAllowedObjectKeys(
      record,
      new Set(["action", "disclosure", "question", "status", "targetLabel"]),
      label,
    );
    const disclosure = requireObject(
      record.disclosure,
      "Hosted runtime assistant ask prepare response disclosure",
    );
    assertAllowedObjectKeys(
      disclosure,
      new Set(["permissionText"]),
      "Hosted runtime assistant ask prepare response disclosure",
    );
    return {
      action,
      disclosure: {
        permissionText: parseHostedRuntimeGroupDisclosurePermissionText(
          disclosure.permissionText,
          "Hosted runtime assistant ask prepare response disclosure permissionText",
        ),
      },
      question,
      status,
      targetLabel,
    };
  }
  if ((action === "prepare" || action === "complete") && status === "terminal") {
    assertAllowedObjectKeys(
      record,
      new Set(["action", "status", "terminalReason"]),
      "Hosted runtime assistant ask terminal control response",
    );
    const terminalReason = requireString(
      record.terminalReason,
      "Hosted runtime assistant ask terminalReason",
    );
    if (terminalReason !== "expired" && terminalReason !== "unavailable") {
      throw new TypeError("Hosted runtime assistant ask terminalReason is invalid.");
    }
    return { action, status, terminalReason };
  }
  if (
    action === "complete"
    && (status === "completed" || status === "already_completed")
  ) {
    assertAllowedObjectKeys(
      record,
      new Set(["action", "status"]),
      "Hosted runtime assistant ask complete control response",
    );
    return { action, status };
  }
  throw new TypeError("Hosted runtime assistant ask control response action/status is invalid.");
}

export function parseHostedRuntimeGroupToolRequest(
  value: unknown,
  options: {
    privateMediaDeliveryOrigin?: string | null;
  } = {},
): HostedRuntimeGroupToolRequest {
  const record = requireObject(value, "Hosted runtime group tool request");
  const action = requireString(record.action, "Hosted runtime group tool request action");
  if (action === "ask") {
    const label = "Hosted runtime group tool ask request";
    assertAllowedObjectKeys(
      record,
      new Set([
        "action",
        "groupLabel",
        "originAssistantInputId",
        "originSessionId",
        "question",
      ]),
      label,
    );
    return {
      action,
      ...(record.groupLabel === undefined
        ? {}
        : {
            groupLabel: record.groupLabel === null
              ? null
              : parseHostedRuntimeGroupAskBoundedText({
                  label: "Hosted runtime group tool ask request groupLabel",
                  maxCodePoints:
                    HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS,
                  value: record.groupLabel,
                }),
          }),
      ...parseHostedRuntimeGroupAssistantAskFields(record, label),
    };
  }
  if (action === "ask_current_sender") {
    const label = "Hosted runtime group tool ask_current_sender request";
    assertAllowedObjectKeys(record, new Set(["action", "origin"]), label);
    const origin = parseHostedExecutionAssistantAskOrigin(
      record.origin,
      `${label} origin`,
    );
    if (origin.kind !== "accepted_input") {
      throw new TypeError(`${label} origin must be an accepted input.`);
    }
    return { action, origin };
  }
  if (action === "ask_member") {
    const label = "Hosted runtime group tool ask_member request";
    const grantId = parseHostedRuntimeGroupDisclosureGrantId(
      record.grantId,
      `${label} grantId`,
    );
    const question = parseHostedRuntimeGroupAskBoundedText({
      label: `${label} question`,
      maxCodePoints: HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
      value: record.question,
    });

    assertAllowedObjectKeys(
      record,
      new Set(["action", "grantId", "origin", "question"]),
      label,
    );
    const origin = parseHostedExecutionAssistantAskOrigin(
      record.origin,
      `${label} origin`,
    );
    return { action, grantId, origin, question };
  }
  if (action === "post_disclosure_request") {
    assertAllowedObjectKeys(
      record,
      new Set([
        "action",
        "linqThread",
        "originAssistantInputId",
        "permissionText",
      ]),
      "Hosted runtime group tool post_disclosure_request request",
    );
    return {
      action,
      ...(record.linqThread === undefined || record.linqThread === null
        ? {}
        : {
            linqThread: parseHostedRuntimeGroupToolLinqThreadContext(
              record.linqThread,
              "Hosted runtime group tool post_disclosure_request request linqThread",
            ),
          }),
      originAssistantInputId: parseHostedExecutionAssistantAskOriginInputId(
        record.originAssistantInputId,
        "Hosted runtime group tool post_disclosure_request request originAssistantInputId",
      ),
      permissionText: parseHostedRuntimeGroupDisclosurePermissionText(
        record.permissionText,
        "Hosted runtime group tool post_disclosure_request request permissionText",
      ),
    };
  }
  if (action === "revoke_disclosure_grant") {
    assertAllowedObjectKeys(
      record,
      new Set(["action", "grantId"]),
      "Hosted runtime group tool revoke_disclosure_grant request",
    );
    return {
      action,
      grantId: parseHostedRuntimeGroupDisclosureGrantId(
        record.grantId,
        "Hosted runtime group tool revoke_disclosure_grant request grantId",
      ),
    };
  }
  if (action === "read_participant_display_names") {
    assertAllowedObjectKeys(
      record,
      new Set(["action", "linqSenderHandles"]),
      "Hosted runtime group tool read_participant_display_names request",
    );
    return {
      action,
      linqSenderHandles: parseHostedRuntimeGroupBoundedHandles(
        record.linqSenderHandles,
        {
          allowEmpty: false,
          label:
            "Hosted runtime group tool read_participant_display_names request linqSenderHandles",
        },
      ),
    };
  }
  if (action === "read_shared") {
    assertAllowedObjectKeys(
      record,
      new Set([
        "action",
        "linqSenderHandles",
        "projectionScopes",
        "telegramSenderHandles",
      ]),
      "Hosted runtime group tool read_shared request",
    );
    const senderHandles = parseHostedRuntimeGroupSenderHandlesRequest(record);
    return {
      action,
      ...senderHandles,
      projectionScopes: parseHostedRuntimeGroupSharedRequestedProjectionScopes(
        record.projectionScopes,
        "Hosted runtime group tool read_shared request projectionScopes",
      ),
    };
  }
  if (action === "create_signup_referral_link") {
    const label = "Hosted runtime group tool create_signup_referral_link request";
    assertAllowedObjectKeys(
      record,
      new Set(["action", "participant"]),
      label,
    );
    return {
      action,
      ...(record.participant !== undefined && record.participant !== null
        ? {
            participant: parseHostedRuntimeGroupToolParticipant(
              record.participant,
              `${label} participant`,
            ),
          }
        : {}),
    };
  }
  if (action === "read_usage_referral") {
    assertAllowedObjectKeys(
      record,
      new Set([
        "action",
        "linqSenderHandles",
        "participant",
        "sourceConversation",
        "telegramSenderHandles",
      ]),
      `Hosted runtime group tool ${action} request`,
    );
    return {
      action,
      ...(record.participant !== undefined && record.participant !== null
        ? {
          participant: parseHostedRuntimeGroupToolParticipant(
            record.participant,
            "Hosted runtime group tool read_usage_referral request participant",
          ),
        }
        : {}),
      ...parseHostedRuntimeGroupSenderHandlesRequest(record),
      ...parseHostedRuntimeUsageReferralSourceContext(record),
    };
  }
  if (action === "cancel_usage_referral") {
    assertAllowedObjectKeys(
      record,
      new Set([
        "action",
        "linqSenderHandles",
        "policyCode",
        "telegramSenderHandles",
      ]),
      "Hosted runtime group tool cancel_usage_referral request",
    );
    return {
      action,
      ...parseHostedRuntimeGroupSenderHandlesRequest(record),
      policyCode: parseHostedRuntimeUsageReferralPolicyCode(
        record.policyCode,
        "Hosted runtime group tool cancel_usage_referral request policyCode",
      ),
    };
  }
  if (action === "arm_usage_referral") {
    assertAllowedObjectKeys(
      record,
      new Set([
        "action",
        "linqSenderHandles",
        "policyCodes",
        "sourceConversation",
        "telegramSenderHandles",
      ]),
      "Hosted runtime group tool arm_usage_referral request",
    );
    const policyCodeValues = requireArray(
      record.policyCodes,
      "Hosted runtime group tool arm_usage_referral request policyCodes",
    );
    if (
      policyCodeValues.length < 1
      || policyCodeValues.length > HOSTED_USAGE_REFERRAL_POLICY_CODES.length
    ) {
      throw new TypeError(
        `Hosted runtime group tool arm_usage_referral request policyCodes must contain between 1 and ${HOSTED_USAGE_REFERRAL_POLICY_CODES.length} entries.`,
      );
    }
    const policyCodes = policyCodeValues.map((policyCode, index) =>
      parseHostedRuntimeUsageReferralPolicyCode(
        policyCode,
        `Hosted runtime group tool arm_usage_referral request policyCodes[${index}]`,
      )
    );
    if (new Set(policyCodes).size !== policyCodes.length) {
      throw new TypeError(
        "Hosted runtime group tool arm_usage_referral request policyCodes must have unique entries.",
      );
    }
    return {
      action,
      ...parseHostedRuntimeGroupSenderHandlesRequest(record),
      ...parseHostedRuntimeUsageReferralSourceContext(record),
      policyCodes,
    };
  }
  if (action === "prepare_next_group") {
    assertAllowedObjectKeys(
      record,
      new Set(["action", "setup"]),
      "Hosted runtime group tool prepare_next_group request",
    );
    return {
      action,
      ...(record.setup === undefined
        ? {}
        : { setup: parseHostedRuntimePendingGroupSetupInput(record.setup) }),
    };
  }
  if (
    action === "read_current"
    || action === "read_next_group"
    || action === "cancel_next_group"
    || action === "read_chat_name"
    || action === "read_usage"
    || action === "list_memberships"
  ) {
    assertAllowedObjectKeys(
      record,
      new Set(["action"]),
      `Hosted runtime group tool ${action} request`,
    );
    return { action };
  }
  if (action === "leave_membership") {
    assertAllowedObjectKeys(
      record,
      new Set(["action", "membershipId"]),
      "Hosted runtime group tool leave_membership request",
    );
    const membershipId = requireString(
      record.membershipId,
      "Hosted runtime group tool leave_membership request membershipId",
    ).trim();
    if (!membershipId) {
      throw new TypeError(
        "Hosted runtime group tool leave_membership request membershipId must not be blank.",
      );
    }
    return { action, membershipId };
  }
  if (action === "update_display_name") {
    assertAllowedObjectKeys(
      record,
      new Set(["action", "updateDisplayName", "linqThread"]),
      "Hosted runtime group tool update_display_name request",
    );
    return {
      action,
      ...(record.linqThread === undefined || record.linqThread === null
        ? {}
        : {
            linqThread: parseHostedRuntimeGroupToolLinqThreadContext(
              record.linqThread,
              "Hosted runtime group tool update_display_name request linqThread",
            ),
          }),
      updateDisplayName: parseHostedRuntimeGroupUpdateDisplayNameRequest(
        record.updateDisplayName,
      ),
    };
  }
  if (action === "create_join_link") {
    assertAllowedObjectKeys(
      record,
      new Set(["action", "joinLink"]),
      "Hosted runtime group tool create_join_link request",
    );
    if (record.joinLink === undefined || record.joinLink === null) {
      return { action };
    }
    return {
      action,
      joinLink: parseHostedRuntimeGroupCreateJoinLinkRequest(record.joinLink),
    };
  }
  if (action === "post_join_offer") {
    assertAllowedObjectKeys(
      record,
      new Set(["action", "joinOffer", "linqThread"]),
      "Hosted runtime group tool post_join_offer request",
    );
    return {
      action,
      ...(record.joinOffer === undefined || record.joinOffer === null
        ? {}
        : { joinOffer: parseHostedRuntimeGroupPostJoinOfferRequest(record.joinOffer) }),
      ...(record.linqThread === undefined || record.linqThread === null
        ? {}
        : {
            linqThread: parseHostedRuntimeGroupToolLinqThreadContext(
              record.linqThread,
              "Hosted runtime group tool post_join_offer request linqThread",
            ),
      }),
    };
  }
  if (action === "set_chat_avatar") {
    assertAllowedObjectKeys(
      record,
      new Set(["action", "groupChatIconUrl", "linqThread"]),
      "Hosted runtime group tool set_chat_avatar request",
    );
    return {
      action,
      groupChatIconUrl: parseHostedRuntimeGroupChatIconUrl(
        record.groupChatIconUrl,
        options.privateMediaDeliveryOrigin,
      ),
      ...(record.linqThread === undefined || record.linqThread === null
        ? {}
        : {
            linqThread: parseHostedRuntimeGroupToolLinqThreadContext(
              record.linqThread,
              "Hosted runtime group tool set_chat_avatar request linqThread",
            ),
      }),
    };
  }
  if (action === "preflight_set_chat_avatar") {
    assertAllowedObjectKeys(
      record,
      new Set(["action", "linqThread"]),
      "Hosted runtime group tool preflight_set_chat_avatar request",
    );
    if (record.linqThread === undefined || record.linqThread === null) {
      return { action };
    }
    return {
      action,
      linqThread: parseHostedRuntimeGroupToolLinqThreadContext(
        record.linqThread,
        "Hosted runtime group tool preflight_set_chat_avatar request linqThread",
      ),
    };
  }
  if (action === "read_chat_participants") {
    assertAllowedObjectKeys(
      record,
      new Set(["action", "linqThread"]),
      "Hosted runtime group tool read_chat_participants request",
    );
    if (record.linqThread === undefined || record.linqThread === null) {
      return { action };
    }
    return {
      action,
      linqThread: parseHostedRuntimeGroupToolLinqThreadContext(
        record.linqThread,
        "Hosted runtime group tool read_chat_participants request linqThread",
      ),
    };
  }
  if (action === "share_contact_card") {
    const label = "Hosted runtime group tool share_contact_card request";
    assertAllowedObjectKeys(
      record,
      new Set([
        "action",
        "contactCardImageUrl",
        "contactCardShareKey",
        "directLinqChatId",
        "linqThread",
      ]),
      label,
    );
    const hasOwn = (key: string): boolean =>
      Object.prototype.hasOwnProperty.call(record, key);
    const hasContactCardImageUrl = hasOwn("contactCardImageUrl");
    const hasContactCardShareKey = hasOwn("contactCardShareKey");
    const hasDirectLinqChatId = hasOwn("directLinqChatId");
    const hasLinqThread = hasOwn("linqThread");
    const personalizedFieldCount = Number(hasContactCardImageUrl)
      + Number(hasContactCardShareKey)
      + Number(hasDirectLinqChatId);

    if (personalizedFieldCount === 0) {
      if (!hasLinqThread || record.linqThread === null) {
        return { action };
      }
      return {
        action,
        linqThread: parseHostedRuntimeGroupToolLinqThreadContext(
          record.linqThread,
          `${label} linqThread`,
        ),
      };
    }

    if (personalizedFieldCount !== 3 || hasLinqThread) {
      throw new TypeError(
        `${label} must be either canonical with optional linqThread, or personalized with contactCardImageUrl, contactCardShareKey, and directLinqChatId only.`,
      );
    }

    return {
      action,
      contactCardImageUrl: parseHostedRuntimeGroupChatIconUrl(
        record.contactCardImageUrl,
        options.privateMediaDeliveryOrigin,
        `${label} contactCardImageUrl`,
      ),
      contactCardShareKey: parseHostedRuntimeGroupAskBoundedText({
        label: `${label} contactCardShareKey`,
        maxCodePoints:
          HOSTED_RUNTIME_GROUP_CONTACT_CARD_SHARE_KEY_MAX_CODE_POINTS,
        value: record.contactCardShareKey,
      }),
      directLinqChatId: parseHostedRuntimeGroupAskBoundedText({
        label: `${label} directLinqChatId`,
        maxCodePoints:
          HOSTED_RUNTIME_GROUP_CONTACT_CARD_SHARE_KEY_MAX_CODE_POINTS,
        value: record.directLinqChatId,
      }),
    };
  }
  if (action === "revoke_own_email_share") {
    assertAllowedObjectKeys(
      record,
      new Set(["action", "participant", "selfOptOut"]),
      "Hosted runtime group tool revoke_own_email_share request",
    );
    if (
      record.participant !== undefined
      && record.participant !== null
      && record.selfOptOut !== undefined
      && record.selfOptOut !== null
    ) {
      throw new TypeError(
        "Hosted runtime group tool revoke_own_email_share request has conflicting participant authorities.",
      );
    }
    if (record.participant !== undefined && record.participant !== null) {
      return {
        action,
        participant: parseHostedRuntimeGroupToolParticipant(
          record.participant,
          "Hosted runtime group tool revoke_own_email_share request participant",
        ),
      };
    }
    if (record.selfOptOut !== undefined && record.selfOptOut !== null) {
      return {
        action,
        selfOptOut: parseHostedRuntimeGroupToolSelfOptOutContext(
          record.selfOptOut,
          "Hosted runtime group tool revoke_own_email_share request selfOptOut",
        ),
      };
    }
    return { action };
  }
  throw new TypeError("Hosted runtime group tool action is not supported.");
}

function parseHostedRuntimeGroupUpdateDisplayNameRequest(
  value: unknown,
): HostedRuntimeGroupUpdateDisplayNameRequest {
  const record = requireObject(
    value,
    "Hosted runtime group tool update_display_name updateDisplayName",
  );
  assertAllowedObjectKeys(
    record,
    new Set(["displayName"]),
    "Hosted runtime group tool update_display_name updateDisplayName",
  );
  const displayName = requireString(
    record.displayName,
    "Hosted runtime group tool update_display_name displayName",
  ).trim().replace(/\s+/gu, " ");
  if (displayName.length === 0) {
    throw new TypeError("Hosted runtime group tool update_display_name displayName must not be blank.");
  }
  if (displayName.length > HOSTED_RUNTIME_GROUP_DISPLAY_NAME_MAX_LENGTH) {
    throw new TypeError("Hosted runtime group tool update_display_name displayName is too long.");
  }
  return { displayName };
}

function parseHostedRuntimeGroupChatIconUrl(
  value: unknown,
  privateMediaDeliveryOrigin?: string | null,
  label = "Hosted runtime group tool set_chat_avatar groupChatIconUrl",
): string {
  const iconUrl = requireString(value, label).trim();
  if (
    iconUrl.length === 0 ||
    iconUrl.length > HOSTED_RUNTIME_GROUP_CHAT_ICON_URL_MAX_LENGTH
  ) {
    throw new TypeError(`${label} is invalid.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(iconUrl);
  } catch {
    throw new TypeError(`${label} is invalid.`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new TypeError(`${label} must be HTTPS.`);
  }
  if (!isHostedRuntimePrivateImageDeliveryUrl(
    parsed,
    privateMediaDeliveryOrigin ?? undefined,
  )) {
    throw new TypeError(`${label} is invalid.`);
  }
  return parsed.toString();
}

function parseHostedRuntimeGroupToolLinqThreadContext(
  value: unknown,
  label: string,
): HostedRuntimeGroupToolLinqThreadContext {
  const record = requireObject(value, label);
  assertAllowedObjectKeys(record, new Set(["authority", "chatId"]), label);
  return {
    authority: parseHostedRuntimeLinqExternalThreadRouteAuthority(
      record.authority,
      `${label} authority`,
    ),
    chatId: requireString(record.chatId, `${label} chatId`),
  };
}

function parseHostedRuntimeGroupPostJoinOfferRequest(
  value: unknown,
): HostedRuntimeGroupPostJoinOfferRequest {
  const record = requireObject(value, "Hosted runtime group tool post_join_offer joinOffer");
  assertAllowedObjectKeys(
    record,
    new Set(["displayName", "messageTemplate", "projectionKinds", "projectionScopes"]),
    "Hosted runtime group tool post_join_offer joinOffer",
  );
  const displayName = parseHostedRuntimeGroupDisplayName(
    record.displayName,
    "Hosted runtime group tool post_join_offer displayName",
  );
  const messageTemplate = record.messageTemplate === undefined || record.messageTemplate === null
    ? null
    : parseHostedRuntimeGroupJoinOfferMessageTemplate(record.messageTemplate);
  return {
    displayName,
    ...(messageTemplate === null ? {} : { messageTemplate }),
    projectionKinds: parseHostedRuntimeGroupProjectionKindArray(
      record.projectionKinds,
      "Hosted runtime group tool post_join_offer projectionKinds",
      HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
    ),
    projectionScopes: parseHostedRuntimeGroupSelectableProjectionScopes(
      record.projectionScopes,
      record.projectionKinds,
      "Hosted runtime group tool post_join_offer projectionScopes",
    ),
  };
}

function parseHostedRuntimeGroupJoinOfferMessageTemplate(value: unknown): string {
  const template = requireString(
    value,
    "Hosted runtime group tool post_join_offer messageTemplate",
  ).trim().replace(/\s+/gu, " ");
  if (
    template.length === 0
    || template.length > HOSTED_RUNTIME_GROUP_JOIN_OFFER_MESSAGE_TEMPLATE_MAX_LENGTH
  ) {
    throw new TypeError(
      `Hosted runtime group tool post_join_offer messageTemplate must be between 1 and ${HOSTED_RUNTIME_GROUP_JOIN_OFFER_MESSAGE_TEMPLATE_MAX_LENGTH} characters.`,
    );
  }
  return template;
}

function parseHostedRuntimeGroupToolParticipant(
  value: unknown,
  label: string,
): HostedExecutionAcceptedGroupMessageParticipant {
  const record = requireObject(value, label);
  assertAllowedObjectKeys(
    record,
    new Set(["assistantInputId", "senderHandle", "source"]),
    label,
  );
  const source = requireString(record.source, `${label} source`);
  if (source !== "linq" && source !== "telegram") {
    throw new TypeError("Hosted runtime group tool participant source is not supported.");
  }
  const assistantInputId = requireString(
    record.assistantInputId,
    `${label} assistantInputId`,
  );
  if (!/^ain_[0-9a-f]{32}$/u.test(assistantInputId)) {
    throw new TypeError("Hosted runtime group tool participant assistantInputId is invalid.");
  }
  const senderHandle = requireString(
    record.senderHandle,
    `${label} senderHandle`,
  ).trim();
  if (senderHandle.length === 0 || senderHandle.length > 512) {
    throw new TypeError(
      "Hosted runtime group tool participant senderHandle is invalid.",
    );
  }
  return {
    assistantInputId,
    senderHandle,
    source,
  };
}

function parseHostedRuntimeGroupToolSelfOptOutContext(
  value: unknown,
  label: string,
): HostedRuntimeGroupToolSelfOptOutContext {
  const record = requireObject(value, label);
  assertAllowedObjectKeys(record, new Set(["senderHandle", "source"]), label);
  const source = requireString(record.source, `${label} source`);
  if (source !== "email" && source !== "linq") {
    throw new TypeError(
      "Hosted runtime group tool self opt-out source is not supported.",
    );
  }
  return {
    senderHandle: requireString(record.senderHandle, `${label} senderHandle`),
    source,
  };
}

function parseHostedRuntimeUsageReferralSourceContext(
  record: Record<string, unknown>,
): { sourceConversation?: HostedRuntimeUsageReferralSourceConversation } {
  if (record.sourceConversation === undefined) {
    return {};
  }
  const source = requireObject(
    record.sourceConversation,
    "Hosted runtime usage referral source conversation",
  );
  assertAllowedObjectKeys(
    source,
    new Set(["channel", "linqService", "threadId", "threadIsDirect"]),
    "Hosted runtime usage referral source conversation",
  );
  const channel = requireString(
    source.channel,
    "Hosted runtime usage referral source conversation channel",
  );
  if (channel !== "linq" && channel !== "telegram") {
    throw new TypeError(
      "Hosted runtime usage referral source conversation channel is invalid.",
    );
  }
  const linqService = source.linqService === undefined
    ? null
    : requireString(
        source.linqService,
        "Hosted runtime usage referral source conversation linqService",
      );
  if (
    linqService !== null
    && (
      channel !== "linq"
      || (
        linqService !== "imessage"
        && linqService !== "rcs"
        && linqService !== "sms"
      )
    )
  ) {
    throw new TypeError(
      "Hosted runtime usage referral source conversation linqService is invalid.",
    );
  }
  return {
    sourceConversation: {
      channel,
      ...(linqService === null ? {} : { linqService }),
      threadId: parseHostedRuntimeUsageReferralBlindedIdentifier(
        source.threadId,
        "Hosted runtime usage referral source conversation threadId",
      ),
      threadIsDirect: requireBoolean(
        source.threadIsDirect,
        "Hosted runtime usage referral source conversation threadIsDirect",
      ),
    },
  };
}

function parseHostedRuntimeUsageReferralBlindedIdentifier(
  value: unknown,
  label: string,
): string {
  const identifier = requireString(value, label);
  if (!/^hid_[a-f0-9]{32}$/u.test(identifier)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return identifier;
}

function parseHostedRuntimeUsageReferralPolicyCode(
  value: unknown,
  label: string,
): HostedUsageReferralPolicyCode {
  const code = requireString(value, label);
  for (const policyCode of HOSTED_USAGE_REFERRAL_POLICY_CODES) {
    if (code === policyCode) {
      return policyCode;
    }
  }
  throw new TypeError(`${label} is not supported.`);
}

/**
 * Reads current-turn sender evidence. Each channel owns its own field because
 * Web matches each against a different member identity index; supplying both is
 * a contradiction and fails closed rather than guessing which one is
 * authoritative.
 */
function parseHostedRuntimeGroupSenderHandlesRequest(
  record: Record<string, unknown>,
): {
  linqSenderHandles?: string[];
  telegramSenderHandles?: string[];
} {
  const linqPresent = record.linqSenderHandles !== undefined
    && record.linqSenderHandles !== null;
  const telegramPresent = record.telegramSenderHandles !== undefined
    && record.telegramSenderHandles !== null;
  if (linqPresent && telegramPresent) {
    throw new TypeError(
      "Hosted runtime group tool read_shared request must not supply sender handles for more than one channel.",
    );
  }
  if (linqPresent) {
    return {
      linqSenderHandles: parseHostedRuntimeGroupBoundedHandles(
        record.linqSenderHandles,
        {
          allowEmpty: false,
          label: "Hosted runtime group tool read_shared request linqSenderHandles",
        },
      ),
    };
  }
  if (telegramPresent) {
    return {
      telegramSenderHandles: parseHostedRuntimeGroupBoundedHandles(
        record.telegramSenderHandles,
        {
          allowEmpty: false,
          label: "Hosted runtime group tool read_shared request telegramSenderHandles",
        },
      ),
    };
  }
  return {};
}

function parseHostedRuntimeGroupCurrentTurnHandles(
  value: unknown,
  label: string,
): string[] {
  return parseHostedRuntimeGroupBoundedHandles(value, {
    allowEmpty: true,
    label,
  });
}

function parseHostedRuntimeGroupBoundedHandles(
  value: unknown,
  options: { allowEmpty: boolean; label: string },
): string[] {
  const { allowEmpty, label } = options;
  const entries = requireArray(value, label);
  if (
    (!allowEmpty && entries.length === 0)
    || entries.length > HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX
  ) {
    throw new TypeError(
      `${label} must contain between ${allowEmpty ? 0 : 1} and ${HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX} entries.`,
    );
  }
  const handles = entries.map((entry, index) =>
    parseHostedRuntimeGroupAskBoundedText({
      label: `${label}[${index}]`,
      maxCodePoints: HOSTED_RUNTIME_GROUP_SENDER_HANDLE_MAX_CODE_POINTS,
      value: entry,
    })
  );
  if (new Set(handles).size !== handles.length) {
    throw new TypeError(`${label} must contain unique entries.`);
  }
  return handles;
}

function parseHostedRuntimeGroupCreateJoinLinkRequest(
  value: unknown,
): HostedRuntimeGroupCreateJoinLinkRequest {
  const record = requireObject(value, "Hosted runtime group tool create_join_link joinLink");
  assertAllowedObjectKeys(
    record,
    new Set([
      "displayName",
      "kind",
      "requestedVaultShareProjectionKinds",
      "requestedVaultShareProjectionScopes",
    ]),
    "Hosted runtime group tool create_join_link joinLink",
  );
  const displayName = parseHostedRuntimeGroupDisplayName(
    record.displayName,
    "Hosted runtime group tool create_join_link displayName",
  );

  return {
    displayName,
    kind: readHostedRuntimeGroupKind(record.kind),
    // Compatibility for old fixed-kind callers.
    requestedVaultShareProjectionKinds: parseHostedRuntimeGroupProjectionKindArray(
      record.requestedVaultShareProjectionKinds,
      "Hosted runtime group tool create_join_link requestedVaultShareProjectionKinds",
      HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
    ),
    // The membership-implied profile-name.v0 kind is never requestable through a join
    // link: the request contract is closed over the individually selectable scopes.
    requestedVaultShareProjectionScopes: parseHostedRuntimeGroupSelectableProjectionScopes(
      record.requestedVaultShareProjectionScopes,
      record.requestedVaultShareProjectionKinds,
      "Hosted runtime group tool create_join_link requestedVaultShareProjectionScopes",
    ),
  };
}

function parseHostedRuntimeGroupDisplayName(
  value: unknown,
  label: string,
): string | null {
  const displayName = readNullableString(value, label);
  if (displayName !== null && displayName.trim().length === 0) {
    throw new TypeError(`${label} must not be blank.`);
  }
  if (displayName !== null && displayName.length > HOSTED_RUNTIME_GROUP_DISPLAY_NAME_MAX_LENGTH) {
    throw new TypeError(`${label} is too long.`);
  }
  return displayName;
}

function parseHostedRuntimeGroupParticipantDisplayNamesResult(
  value: unknown,
): Extract<
  HostedRuntimeGroupToolResponse,
  { action: "read_participant_display_names" }
>["result"] {
  const label =
    "Hosted runtime group tool read_participant_display_names response result";
  const result = requireObject(value, label);
  const status = requireString(result.status, `${label} status`);
  if (status === "unavailable") {
    assertAllowedObjectKeys(
      result,
      new Set(["status", "unavailableReason"]),
      `${label} unavailable`,
    );
    return {
      status,
      unavailableReason: requireString(
        result.unavailableReason,
        `${label} unavailableReason`,
      ),
    };
  }
  if (status !== "ok") {
    throw new TypeError(`${label} status is invalid.`);
  }
  assertAllowedObjectKeys(
    result,
    new Set(["nameMissSenderHandles", "participants", "status"]),
    label,
  );
  const entries = requireArray(result.participants, `${label} participants`);
  if (entries.length > HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX) {
    throw new TypeError(
      `${label} participants must contain at most ${HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX} entries.`,
    );
  }
  const senderHandles = new Set<string>();
  const participants = entries.map((entry, index) => {
    const participantLabel = `${label} participants[${index}]`;
    const participant = requireObject(entry, participantLabel);
    assertAllowedObjectKeys(
      participant,
      new Set(["displayName", "displayNameSource", "senderHandle"]),
      participantLabel,
    );
    const displayName = parseHostedRuntimeGroupDisplayName(
      participant.displayName,
      `${participantLabel} displayName`,
    );
    if (displayName === null) {
      throw new TypeError(`${participantLabel} displayName must not be null.`);
    }
    const senderHandle = parseHostedRuntimeGroupAskBoundedText({
      label: `${participantLabel} senderHandle`,
      maxCodePoints: HOSTED_RUNTIME_GROUP_SENDER_HANDLE_MAX_CODE_POINTS,
      value: participant.senderHandle,
    });
    if (senderHandles.has(senderHandle)) {
      throw new TypeError(`${label} senderHandles must be unique.`);
    }
    senderHandles.add(senderHandle);
    const displayNameSource = participant.displayNameSource === undefined
      ? "profile-name"
      : parseHostedRuntimeGroupParticipantDisplayNameSource(
        participant.displayNameSource,
        `${participantLabel} displayNameSource`,
      );
    return { displayName, displayNameSource, senderHandle };
  });
  const nameMissSenderHandles = result.nameMissSenderHandles === undefined
    ? undefined
    : parseHostedRuntimeGroupBoundedHandles(result.nameMissSenderHandles, {
        allowEmpty: true,
        label: `${label} nameMissSenderHandles`,
      });
  if (
    nameMissSenderHandles?.some((senderHandle) =>
      senderHandles.has(senderHandle)
    )
  ) {
    throw new TypeError(
      `${label} nameMissSenderHandles must not overlap participants.`,
    );
  }
  return {
    ...(nameMissSenderHandles === undefined ? {} : { nameMissSenderHandles }),
    participants,
    status,
  };
}

function parseHostedRuntimeGroupParticipantDisplayNameSource(
  value: unknown,
  label: string,
): HostedRuntimeGroupParticipantDisplayNameSource {
  if (value === "profile-name" || value === "unverified-owner-contact") {
    return value;
  }
  throw new TypeError(`${label} is invalid.`);
}

function readHostedRuntimeGroupKind(value: unknown): HostedRuntimeGroupKind | null {
  if (value === undefined || value === null) return null;
  for (const kind of HOSTED_RUNTIME_GROUP_KINDS) {
    if (value === kind) return kind;
  }
  throw new TypeError("Hosted runtime group tool create_join_link kind is not supported.");
}

interface ParsedHostedRuntimeGroupSharedRequestedScope {
  projectionScope: HostedVaultShareSelectableProjectionScope;
  projectionScopeKey: string;
}

function parseHostedRuntimeGroupSharedReadResult(
  value: unknown,
): HostedRuntimeGroupSharedReadResult {
  const result = requireObject(
    value,
    "Hosted runtime group tool read_shared response result",
  );
  const status = requireString(
    result.status,
    "Hosted runtime group tool read_shared response status",
  );
  if (status === "unavailable") {
    assertAllowedObjectKeys(
      result,
      new Set(["status", "unavailableReason"]),
      "Hosted runtime group tool read_shared unavailable response result",
    );
    return {
      status,
      unavailableReason: parseHostedRuntimeGroupAskBoundedText({
        label: "Hosted runtime group tool read_shared unavailableReason",
        maxCodePoints:
          HOSTED_RUNTIME_GROUP_SHARED_READ_UNAVAILABLE_REASON_MAX_CODE_POINTS,
        value: result.unavailableReason,
      }),
    };
  }
  if (status !== "ok" && status !== "none") {
    throw new TypeError(
      "Hosted runtime group tool read_shared response status is invalid.",
    );
  }

  assertAllowedObjectKeys(
    result,
    new Set(["members", "requestedProjectionScopeKeys", "status"]),
    `Hosted runtime group tool read_shared ${status} response result`,
  );
  const requestedScopes =
    parseHostedRuntimeGroupSharedRequestedProjectionScopeKeys(
      result.requestedProjectionScopeKeys,
    );
  const rawMembers = requireArray(
    result.members,
    "Hosted runtime group tool read_shared response members",
  );
  if (status === "none") {
    if (rawMembers.length !== 0) {
      throw new TypeError(
        "Hosted runtime group tool read_shared none response members must be empty.",
      );
    }
    return {
      members: [],
      requestedProjectionScopeKeys: requestedScopes.map(
        ({ projectionScopeKey }) => projectionScopeKey,
      ),
      status,
    };
  }
  if (rawMembers.length > HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_MEMBERS) {
    throw new TypeError(
      `Hosted runtime group tool read_shared response members must contain at most ${HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_MEMBERS} entries.`,
    );
  }

  const seenMemberIds = new Set<string>();
  const seenParticipantIds = new Set<string>();
  const seenCurrentTurnHandles = new Set<string>();
  const members = rawMembers.map((rawMember, index) => {
    const member = parseHostedRuntimeGroupSharedMember(
      rawMember,
      requestedScopes,
      index,
    );
    if (seenMemberIds.has(member.memberId)) {
      throw new TypeError(
        "Hosted runtime group tool read_shared response memberIds must be unique.",
      );
    }
    seenMemberIds.add(member.memberId);
    if (seenParticipantIds.has(member.participantId)) {
      throw new TypeError(
        "Hosted runtime group tool read_shared response participantIds must be unique.",
      );
    }
    seenParticipantIds.add(member.participantId);
    for (const handle of member.currentTurnHandles) {
      if (seenCurrentTurnHandles.has(handle)) {
        throw new TypeError(
          "Hosted runtime group tool read_shared response currentTurnHandles must be unique across members.",
        );
      }
      seenCurrentTurnHandles.add(handle);
      if (
        seenCurrentTurnHandles.size
        > HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX
      ) {
        throw new TypeError(
          `Hosted runtime group tool read_shared response currentTurnHandles must contain at most ${HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX} entries across all members.`,
        );
      }
    }
    return member;
  });

  return {
    members,
    requestedProjectionScopeKeys: requestedScopes.map(
      ({ projectionScopeKey }) => projectionScopeKey,
    ),
    status,
  };
}

function parseHostedRuntimeGroupSharedRequestedProjectionScopeKeys(
  value: unknown,
): ParsedHostedRuntimeGroupSharedRequestedScope[] {
  const label =
    "Hosted runtime group tool read_shared response requestedProjectionScopeKeys";
  const rawScopeKeys = requireArray(value, label);
  if (
    rawScopeKeys.length === 0
    || rawScopeKeys.length > HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_PROJECTION_SCOPES
  ) {
    throw new TypeError(
      `${label} must contain between 1 and ${HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_PROJECTION_SCOPES} entries.`,
    );
  }

  const seen = new Set<string>();
  return rawScopeKeys.map((rawScopeKey) => {
    const projectionScopeKey = parseHostedRuntimeGroupAskBoundedText({
      label: `${label} entry`,
      maxCodePoints: HOSTED_RUNTIME_GROUP_SHARED_READ_SCOPE_KEY_MAX_CODE_POINTS,
      value: rawScopeKey,
    });
    const projectionScope =
      HOSTED_RUNTIME_GROUP_SHARED_SELECTABLE_PROJECTION_SCOPE_BY_KEY.get(
        projectionScopeKey,
      );
    if (!projectionScope) {
      throw new TypeError(`${label} contains an unsupported projection scope key.`);
    }
    if (seen.has(projectionScopeKey)) {
      throw new TypeError(`${label} must not contain duplicates.`);
    }
    seen.add(projectionScopeKey);
    return { projectionScope, projectionScopeKey };
  });
}

function parseHostedRuntimeGroupSharedMember(
  value: unknown,
  requestedScopes: readonly ParsedHostedRuntimeGroupSharedRequestedScope[],
  index: number,
): HostedRuntimeGroupSharedMember {
  const label = `Hosted runtime group tool read_shared response members[${index}]`;
  const member = requireObject(value, label);
  assertAllowedObjectKeys(
    member,
    new Set([
      "currentTurnHandles",
      "displayName",
      "memberId",
      "participantId",
      "projections",
    ]),
    label,
  );

  const memberId = parseHostedRuntimeGroupAskBoundedText({
    label: `${label}.memberId`,
    maxCodePoints: HOSTED_RUNTIME_GROUP_SHARED_READ_MEMBER_ID_MAX_CODE_POINTS,
    value: member.memberId,
  });
  const participantId = parseHostedRuntimeGroupAskBoundedText({
    label: `${label}.participantId`,
    maxCodePoints: HOSTED_RUNTIME_GROUP_SHARED_READ_PARTICIPANT_ID_MAX_CODE_POINTS,
    value: member.participantId,
  });
  const displayName = member.displayName === null
    ? null
    : parseHostedRuntimeGroupAskBoundedText({
        label: `${label}.displayName`,
        maxCodePoints: HOSTED_RUNTIME_GROUP_SHARED_READ_DISPLAY_NAME_MAX_CODE_POINTS,
        value: member.displayName,
      });
  const currentTurnHandles = parseHostedRuntimeGroupCurrentTurnHandles(
    member.currentTurnHandles,
    `${label}.currentTurnHandles`,
  );
  const rawProjections = requireArray(member.projections, `${label}.projections`);
  if (rawProjections.length !== requestedScopes.length) {
    throw new TypeError(
      `${label}.projections must contain exactly the requested projection scopes.`,
    );
  }

  const requestedScopeKeys = new Set(
    requestedScopes.map(({ projectionScopeKey }) => projectionScopeKey),
  );
  const projectionByKey = new Map<string, HostedRuntimeGroupSharedProjection>();
  for (const [projectionIndex, rawProjection] of rawProjections.entries()) {
    const projection = parseHostedRuntimeGroupSharedProjection(
      rawProjection,
      `${label}.projections[${projectionIndex}]`,
    );
    if (!requestedScopeKeys.has(projection.projectionScopeKey)) {
      throw new TypeError(
        `${label}.projections contains a projection that was not requested.`,
      );
    }
    if (projectionByKey.has(projection.projectionScopeKey)) {
      throw new TypeError(
        `${label}.projections must not contain duplicate projection scopes.`,
      );
    }
    projectionByKey.set(projection.projectionScopeKey, projection);
  }

  const projections = requestedScopes.map(({ projectionScopeKey }) => {
    const projection = projectionByKey.get(projectionScopeKey);
    if (!projection) {
      throw new TypeError(
        `${label}.projections must contain exactly the requested projection scopes.`,
      );
    }
    return projection;
  });

  return {
    currentTurnHandles,
    displayName,
    memberId,
    participantId,
    projections,
  };
}

function parseHostedRuntimeGroupSharedProjection(
  value: unknown,
  label: string,
): HostedRuntimeGroupSharedProjection {
  const projection = requireObject(value, label);
  assertAllowedObjectKeys(
    projection,
    new Set([
      "dataStatus",
      "grantedAt",
      "grantStatus",
      "projectionScope",
      "projectionScopeKey",
      "records",
    ]),
    label,
  );

  const projectionScope = parseHostedRuntimeGroupSharedSelectableProjectionScope(
    projection.projectionScope,
    `${label}.projectionScope`,
  );
  const expectedProjectionScopeKey =
    buildHostedVaultShareProjectionScopeKey(projectionScope);
  const projectionScopeKey = parseHostedRuntimeGroupAskBoundedText({
    label: `${label}.projectionScopeKey`,
    maxCodePoints: HOSTED_RUNTIME_GROUP_SHARED_READ_SCOPE_KEY_MAX_CODE_POINTS,
    value: projection.projectionScopeKey,
  });
  if (projectionScopeKey !== expectedProjectionScopeKey) {
    throw new TypeError(
      `${label}.projectionScopeKey must match projectionScope.`,
    );
  }

  const grantStatus = requireString(projection.grantStatus, `${label}.grantStatus`);
  if (grantStatus !== "granted" && grantStatus !== "not_granted") {
    throw new TypeError(`${label}.grantStatus is invalid.`);
  }
  const dataStatus = requireString(projection.dataStatus, `${label}.dataStatus`);
  if (dataStatus !== "available" && dataStatus !== "missing") {
    throw new TypeError(`${label}.dataStatus is invalid.`);
  }
  const grantedAt = projection.grantedAt === undefined
    ? undefined
    : projection.grantedAt === null
      ? null
      : parseHostedRuntimeGroupCanonicalTimestamp(
          projection.grantedAt,
          `${label}.grantedAt`,
        );
  if (
    grantStatus === "not_granted"
    && grantedAt !== undefined
    && grantedAt !== null
  ) {
    throw new TypeError(`${label} not_granted projections cannot have grantedAt.`);
  }
  if (grantStatus === "granted" && grantedAt === null) {
    throw new TypeError(`${label} granted projections cannot have null grantedAt.`);
  }

  const rawRecords = requireArray(projection.records, `${label}.records`);
  if (
    rawRecords.length >
      HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_RECORDS_PER_PROJECTION
  ) {
    throw new TypeError(
      `${label}.records must contain at most ${HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_RECORDS_PER_PROJECTION} entries.`,
    );
  }
  if (grantStatus === "not_granted" && dataStatus !== "missing") {
    throw new TypeError(
      `${label} not_granted projections must have missing data.`,
    );
  }
  if (dataStatus === "available" && rawRecords.length === 0) {
    throw new TypeError(
      `${label} available projections must contain at least one record.`,
    );
  }
  if (dataStatus === "missing" && rawRecords.length !== 0) {
    throw new TypeError(`${label} missing projections must not contain records.`);
  }

  const seenRecordKeys = new Set<string>();
  const records: HostedRuntimeGroupSharedRecord[] = rawRecords.map(
    (rawRecord, recordIndex) => {
      const recordLabel = `${label}.records[${recordIndex}]`;
      const record = requireObject(rawRecord, recordLabel);
      assertAllowedObjectKeys(
        record,
        new Set(["data", "occurredAt", "recordKey"]),
        recordLabel,
      );
      const parsed = parseHostedVaultShareDeliveryRecord(record, projectionScope);
      if (seenRecordKeys.has(parsed.recordKey)) {
        throw new TypeError(`${label}.records must have unique recordKeys.`);
      }
      seenRecordKeys.add(parsed.recordKey);
      return {
        data: parsed.data,
        occurredAt: parsed.occurredAt,
        recordKey: parsed.recordKey,
      };
    },
  );

  return {
    dataStatus,
    ...(grantedAt === undefined ? {} : { grantedAt }),
    grantStatus,
    projectionScope,
    projectionScopeKey,
    records,
  };
}

function parseHostedRuntimeGroupCanonicalTimestamp(
  value: unknown,
  label: string,
): string {
  const timestamp = requireString(value, label);
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== timestamp) {
    throw new TypeError(`${label} must be a canonical UTC timestamp.`);
  }
  return timestamp;
}

function parseHostedRuntimeGroupMemberAskResult(
  value: unknown,
  action: "ask_current_sender" | "ask_member",
): HostedRuntimeGroupMemberAskResult {
  const label = `Hosted runtime group tool ${action} response result`;
  const result = requireObject(value, label);
  const status = requireString(result.status, `${label} status`);
  if (status === "accepted") {
    assertAllowedObjectKeys(result, new Set(["status"]), label);
    return { status };
  }
  if (status === "completed") {
    assertAllowedObjectKeys(
      result,
      new Set(["answer", "outcome", "status"]),
      label,
    );
    return {
      ...parseHostedExecutionAssistantAskResult(
        { answer: result.answer, outcome: result.outcome },
        `${label} result`,
      ),
      status,
    };
  }
  if (status === "unavailable") {
    assertAllowedObjectKeys(
      result,
      new Set(["status", "unavailableReason"]),
      label,
    );
    return {
      status,
      unavailableReason: parseHostedRuntimeGroupUnavailableReason(
        result,
        `${label} unavailableReason`,
      ),
    };
  }
  throw new TypeError(`${label} status is invalid.`);
}

export function parseHostedRuntimeGroupToolResponse(
  value: unknown,
): HostedRuntimeGroupToolResponse {
  const record = requireObject(value, "Hosted runtime group tool response");
  const action = requireString(record.action, "Hosted runtime group tool response action");
  assertAllowedObjectKeys(record, new Set(["action", "result"]), "Hosted runtime group tool response");

  if (action === "ask_current_sender" || action === "ask_member") {
    return {
      action,
      result: parseHostedRuntimeGroupMemberAskResult(record.result, action),
    };
  }
  if (action === "ask") {
    const result = requireObject(
      record.result,
      "Hosted runtime group tool ask response result",
    );
    const status = requireString(
      result.status,
      "Hosted runtime group tool ask response status",
    );
    if (status === "accepted") {
      assertAllowedObjectKeys(
        result,
        new Set(["status", "targetLabel"]),
        "Hosted runtime group tool ask accepted response result",
      );
      return {
        action,
        result: {
          status,
          targetLabel: result.targetLabel === null
            ? null
            : parseHostedRuntimeGroupAskBoundedText({
                label: "Hosted runtime group tool ask response targetLabel",
                maxCodePoints:
                  HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS,
                value: result.targetLabel,
              }),
        },
      };
    }
    if (status === "clarification_required") {
      assertAllowedObjectKeys(
        result,
        new Set(["groupLabels", "status"]),
        "Hosted runtime group tool ask clarification response result",
      );
      const groupLabels = requireArray(
        result.groupLabels,
        "Hosted runtime group tool ask clarification groupLabels",
      );
      if (
        groupLabels.length === 0
        || groupLabels.length > HOSTED_RUNTIME_GROUP_MEMBERSHIPS_MAX
      ) {
        throw new TypeError(
          `Hosted runtime group tool ask clarification groupLabels must contain between 1 and ${HOSTED_RUNTIME_GROUP_MEMBERSHIPS_MAX} entries.`,
        );
      }
      return {
        action,
        result: {
          groupLabels: groupLabels.map((groupLabel) =>
            parseHostedRuntimeGroupAskBoundedText({
              label: "Hosted runtime group tool ask clarification groupLabel",
              maxCodePoints:
                HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS,
              value: groupLabel,
            })
          ),
          status,
        },
      };
    }
    if (status === "no_groups") {
      assertAllowedObjectKeys(
        result,
        new Set(["status"]),
        "Hosted runtime group tool ask no_groups response result",
      );
      return { action, result: { status } };
    }
    if (status === "unavailable") {
      assertAllowedObjectKeys(
        result,
        new Set(["status", "unavailableReason"]),
        "Hosted runtime group tool ask unavailable response result",
      );
      return {
        action,
        result: {
          status,
          unavailableReason: parseHostedRuntimeGroupUnavailableReason(
            result,
            "Hosted runtime group tool ask unavailableReason",
          ),
        },
      };
    }
  }

  if (action === "post_disclosure_request") {
    const result = requireObject(
      record.result,
      "Hosted runtime group tool post_disclosure_request response result",
    );
    const status = requireString(
      result.status,
      "Hosted runtime group tool post_disclosure_request response status",
    );
    if (status === "sent") {
      assertAllowedObjectKeys(
        result,
        new Set(["status"]),
        "Hosted runtime group tool post_disclosure_request sent response result",
      );
      return { action, result: { status } };
    }
    if (status === "unavailable") {
      assertAllowedObjectKeys(
        result,
        new Set(["status", "unavailableReason"]),
        "Hosted runtime group tool post_disclosure_request unavailable response result",
      );
      return {
        action,
        result: {
          status,
          unavailableReason: parseHostedRuntimeGroupUnavailableReason(
            result,
            "Hosted runtime group tool post_disclosure_request unavailableReason",
          ),
        },
      };
    }
  }

  if (action === "revoke_disclosure_grant") {
    const result = requireObject(
      record.result,
      "Hosted runtime group tool revoke_disclosure_grant response result",
    );
    const status = requireString(
      result.status,
      "Hosted runtime group tool revoke_disclosure_grant response status",
    );
    if (status === "revoked" || status === "already_revoked") {
      assertAllowedObjectKeys(
        result,
        new Set(["status"]),
        "Hosted runtime group tool revoke_disclosure_grant response result",
      );
      return { action, result: { status } };
    }
    if (status === "unavailable") {
      assertAllowedObjectKeys(
        result,
        new Set(["status", "unavailableReason"]),
        "Hosted runtime group tool revoke_disclosure_grant unavailable response result",
      );
      return {
        action,
        result: {
          status,
          unavailableReason: parseHostedRuntimeGroupUnavailableReason(
            result,
            "Hosted runtime group tool revoke_disclosure_grant unavailableReason",
          ),
        },
      };
    }
  }

  if (action === "read_current") {
    const result = requireObject(record.result, "Hosted runtime group tool read_current response result");
    const status = requireString(result.status, "Hosted runtime group tool read_current response status");
    if (status === "ok") {
      assertAllowedObjectKeys(result, new Set(["status", "group"]), "Hosted runtime group tool read_current ok response result");
      return { action, result: { status, group: parseHostedRuntimeGroupSummary(result.group) } };
    }
    if (status === "none") {
      assertAllowedObjectKeys(result, new Set(["status", "group"]), "Hosted runtime group tool read_current none response result");
      return { action, result: { status, group: null } };
    }
    if (status === "unavailable") {
      assertAllowedObjectKeys(result, new Set(["status", "unavailableReason", "group"]), "Hosted runtime group tool read_current unavailable response result");
      return {
        action,
        result: {
          status,
          unavailableReason: requireString(result.unavailableReason, "Hosted runtime group unavailableReason"),
          group: null,
        },
      };
    }
  }

  if (
    action === "prepare_next_group"
    || action === "read_next_group"
    || action === "cancel_next_group"
  ) {
    const label = `Hosted runtime group tool ${action} response result`;
    const result = requireObject(record.result, label);
    const status = requireString(result.status, `${label} status`);
    if (
      (action === "prepare_next_group" || action === "read_next_group")
      && status === "prepared"
    ) {
      assertAllowedObjectKeys(
        result,
        new Set(["expiresAt", "setup", "status"]),
        `${label} prepared`,
      );
      const expiresAt = requireString(result.expiresAt, `${label} expiresAt`);
      const expiresAtDate = new Date(expiresAt);
      if (
        !Number.isFinite(expiresAtDate.getTime())
        || expiresAtDate.toISOString() !== expiresAt
      ) {
        throw new TypeError(`${label} expiresAt must be a canonical timestamp.`);
      }
      return {
        action,
        result: {
          expiresAt,
          setup: parseHostedRuntimePendingGroupSetupInput(result.setup),
          status,
        },
      };
    }
    if (
      (action === "read_next_group" || action === "cancel_next_group")
      && status === "none"
    ) {
      assertAllowedObjectKeys(result, new Set(["status"]), `${label} none`);
      return { action, result: { status } };
    }
    if (action === "cancel_next_group" && status === "canceled") {
      assertAllowedObjectKeys(result, new Set(["status"]), `${label} canceled`);
      return { action, result: { status } };
    }
    if (status === "unavailable") {
      assertAllowedObjectKeys(
        result,
        new Set(["status", "unavailableReason"]),
        `${label} unavailable`,
      );
      return {
        action,
        result: {
          status,
          unavailableReason: parseHostedRuntimeGroupUnavailableReason(
            result,
            `${label} unavailableReason`,
          ),
        },
      };
    }
    throw new TypeError(`${label} status is invalid.`);
  }

  if (action === "read_chat_name") {
    const label = "Hosted runtime group tool read_chat_name response result";
    const result = requireObject(record.result, label);
    const status = requireString(
      result.status,
      "Hosted runtime group tool read_chat_name response status",
    );
    if (status === "ok") {
      assertAllowedObjectKeys(
        result,
        new Set(["displayName", "status"]),
        `${label} ok`,
      );
      const displayName = parseHostedRuntimeGroupDisplayName(
        result.displayName,
        "Hosted runtime group tool read_chat_name displayName",
      );
      if (displayName === null) {
        throw new TypeError(
          "Hosted runtime group tool read_chat_name ok displayName must be present.",
        );
      }
      return { action, result: { displayName, status } };
    }
    if (status === "none") {
      assertAllowedObjectKeys(
        result,
        new Set(["displayName", "status"]),
        `${label} none`,
      );
      if (result.displayName !== null) {
        throw new TypeError(
          "Hosted runtime group tool read_chat_name none displayName must be null.",
        );
      }
      return { action, result: { displayName: null, status } };
    }
    if (status === "unavailable") {
      assertAllowedObjectKeys(
        result,
        new Set(["displayName", "status", "unavailableReason"]),
        `${label} unavailable`,
      );
      if (result.displayName !== null) {
        throw new TypeError(
          "Hosted runtime group tool read_chat_name unavailable displayName must be null.",
        );
      }
      return {
        action,
        result: {
          displayName: null,
          status,
          unavailableReason: parseHostedRuntimeGroupUnavailableReason(
            result,
            "Hosted runtime group tool read_chat_name unavailableReason",
          ),
        },
      };
    }
    throw new TypeError(
      "Hosted runtime group tool read_chat_name response status is invalid.",
    );
  }

  if (action === "read_usage") {
    const result = requireObject(
      record.result,
      "Hosted runtime group tool read_usage response result",
    );
    const status = requireString(
      result.status,
      "Hosted runtime group tool read_usage response status",
    );
    if (status === "ok") {
      assertAllowedObjectKeys(
        result,
        new Set(["status", "usage"]),
        "Hosted runtime group tool read_usage ok response result",
      );
      const usage = requireObject(
        result.usage,
        "Hosted runtime group tool read_usage usage",
      );
      // Temporary rolling-deploy seam. Remove only after no deployed or
      // rollback-eligible Web build emits the immediately preceding shape and
      // every pre-reader warm runner has drained; see apps/cloudflare/DEPLOY.md.
      const isLegacyUsageProjection = [
        "capacityState",
        "periodEnd",
        "remainingPercent",
      ].some((key) => Object.prototype.hasOwnProperty.call(usage, key));
      if (isLegacyUsageProjection) {
        assertAllowedObjectKeys(
          usage,
          new Set([
            "capacityState",
            "fundingUrl",
            "periodEnd",
            "remainingPercent",
          ]),
          "Hosted runtime group tool read_usage legacy usage",
        );
        const capacityState = requireString(
          usage.capacityState,
          "Hosted runtime group tool read_usage legacy capacityState",
        );
        if (
          capacityState !== "healthy"
          && capacityState !== "low"
          && capacityState !== "exhausted"
        ) {
          throw new TypeError(
            "Hosted runtime group tool read_usage legacy capacityState is invalid.",
          );
        }
        const periodEnd = requireString(
          usage.periodEnd,
          "Hosted runtime group tool read_usage legacy periodEnd",
        );
        const periodEndDate = new Date(periodEnd);
        if (
          !Number.isFinite(periodEndDate.getTime())
          || periodEndDate.toISOString() !== periodEnd
        ) {
          throw new TypeError(
            "Hosted runtime group tool read_usage legacy periodEnd must be canonical.",
          );
        }
        const remainingPercent = usage.remainingPercent === undefined
          ? undefined
          : requireNonNegativeInteger(
              usage.remainingPercent,
              "Hosted runtime group tool read_usage legacy remainingPercent",
            );
        if (remainingPercent !== undefined && remainingPercent > 100) {
          throw new TypeError(
            "Hosted runtime group tool read_usage legacy remainingPercent must be at most 100.",
          );
        }
        const fundingUrl = readNullableString(
          usage.fundingUrl,
          "Hosted runtime group tool read_usage legacy fundingUrl",
        );
        return {
          action,
          result: {
            status,
            usage: {
              fundingNeeded: capacityState !== "healthy",
              fundingUrl,
            },
          },
        };
      }
      assertAllowedObjectKeys(
        usage,
        new Set([
          "fundingNeeded",
          "fundingUrl",
          "includedUsageUsedPercent",
          "sponsorshipStatus",
        ]),
        "Hosted runtime group tool read_usage usage",
      );
      if (usage.sponsorshipStatus !== undefined) {
        const legacySponsorshipStatus = requireString(
          usage.sponsorshipStatus,
          "Hosted runtime group tool read_usage sponsorshipStatus",
        );
        if (
          legacySponsorshipStatus !== "not_sponsored"
          && legacySponsorshipStatus !== "sponsored"
        ) {
          throw new TypeError(
            "Hosted runtime group tool read_usage sponsorshipStatus is invalid.",
          );
        }
      }
      if (typeof usage.fundingNeeded !== "boolean") {
        throw new TypeError(
          "Hosted runtime group tool read_usage fundingNeeded must be boolean.",
        );
      }
      const includedUsageUsedPercent =
        usage.includedUsageUsedPercent === undefined
          ? undefined
          : requireNonNegativeInteger(
              usage.includedUsageUsedPercent,
              "Hosted runtime group tool read_usage includedUsageUsedPercent",
            );
      if (
        includedUsageUsedPercent !== undefined
        && includedUsageUsedPercent > 100
      ) {
        throw new TypeError(
          "Hosted runtime group tool read_usage includedUsageUsedPercent must be at most 100.",
        );
      }
      return {
        action,
        result: {
          status,
          usage: {
            fundingNeeded: usage.fundingNeeded,
            fundingUrl: readNullableString(
              usage.fundingUrl,
              "Hosted runtime group tool read_usage fundingUrl",
            ),
            ...(includedUsageUsedPercent === undefined
              ? {}
              : { includedUsageUsedPercent }),
          },
        },
      };
    }
    if (status === "unavailable") {
      assertAllowedObjectKeys(
        result,
        new Set(["status", "unavailableReason", "usage"]),
        "Hosted runtime group tool read_usage unavailable response result",
      );
      if (result.usage !== null) {
        throw new TypeError(
          "Hosted runtime group tool read_usage unavailable usage must be null.",
        );
      }
      return {
        action,
        result: {
          status,
          unavailableReason: requireString(
            result.unavailableReason,
            "Hosted runtime group tool read_usage unavailableReason",
          ),
          usage: null,
        },
      };
    }
  }

  if (action === "read_participant_display_names") {
    return {
      action,
      result: parseHostedRuntimeGroupParticipantDisplayNamesResult(
        record.result,
      ),
    };
  }

  if (
    action === "arm_usage_referral"
    || action === "cancel_usage_referral"
    || action === "read_usage_referral"
  ) {
    const label = `Hosted runtime group tool ${action} response result`;
    const result = requireObject(record.result, label);
    const status = requireString(result.status, `${label} status`);
    if (status === "unavailable") {
      assertAllowedObjectKeys(
        result,
        new Set(["referral", "status", "unavailableReason"]),
        label,
      );
      if (result.referral !== null) {
        throw new TypeError(`${label} referral must be null when unavailable.`);
      }
      return {
        action,
        result: {
          referral: null,
          status,
          unavailableReason: parseHostedRuntimeGroupUnavailableReason(
            result,
            `${label} unavailableReason`,
          ),
        },
      };
    }
    if (status === "ok") {
      assertAllowedObjectKeys(
        result,
        new Set(["outcome", "referral", "status"]),
        label,
      );
      const outcome = requireString(result.outcome, `${label} outcome`);
      const expectedOutcome = action === "arm_usage_referral"
        ? "armed"
        : action === "cancel_usage_referral"
          ? "canceled"
          : "read";
      if (outcome !== expectedOutcome) {
        throw new TypeError(`${label} outcome does not match its action.`);
      }
      return {
        action,
        result: {
          outcome: expectedOutcome,
          referral: parseHostedRuntimeUsageReferralSnapshot(
            result.referral,
            `${label} referral`,
          ),
          status,
        },
      };
    }
    throw new TypeError(`${label} status is not supported.`);
  }

  if (action === "read_shared") {
    return {
      action,
      result: parseHostedRuntimeGroupSharedReadResult(record.result),
    };
  }

  if (action === "list_memberships") {
    const result = requireObject(
      record.result,
      "Hosted runtime group tool list_memberships response result",
    );
    const status = requireString(
      result.status,
      "Hosted runtime group tool list_memberships response status",
    );
    if (status === "ok") {
      assertAllowedObjectKeys(
        result,
        new Set(["disclosureGrants", "status", "memberships", "truncated"]),
        "Hosted runtime group tool list_memberships ok response result",
      );
      return {
        action,
        result: {
          disclosureGrants: result.disclosureGrants === undefined
            ? []
            : parseHostedRuntimeGroupDisclosureGrantListEntries(
                result.disclosureGrants,
                "Hosted runtime group tool list_memberships disclosureGrants",
              ),
          status,
          memberships: parseHostedRuntimeGroupMembershipSummaries(result.memberships),
          truncated: requireBoolean(
            result.truncated,
            "Hosted runtime group tool list_memberships truncated",
          ),
        },
      };
    }
    if (status === "unavailable") {
      assertAllowedObjectKeys(
        result,
        new Set(["status", "unavailableReason", "memberships"]),
        "Hosted runtime group tool list_memberships unavailable response result",
      );
      if (result.memberships !== null) {
        throw new TypeError(
          "Hosted runtime group tool list_memberships unavailable memberships must be null.",
        );
      }
      return {
        action,
        result: {
          status,
          unavailableReason: requireString(
            result.unavailableReason,
            "Hosted runtime group tool list_memberships unavailableReason",
          ),
          memberships: null,
        },
      };
    }
  }

  if (action === "create_signup_referral_link") {
    const label = "Hosted runtime group tool create_signup_referral_link response";
    const result = requireObject(record.result, `${label} result`);
    const status = requireString(result.status, `${label} status`);
    if (status === "ok") {
      assertAllowedObjectKeys(
        result,
        new Set(["expiresAt", "signupUrl", "status"]),
        `${label} ok result`,
      );
      return {
        action,
        result: {
          expiresAt: parseHostedRuntimeGroupCanonicalTimestamp(
            result.expiresAt,
            `${label} expiresAt`,
          ),
          signupUrl: requireString(result.signupUrl, `${label} signupUrl`),
          status,
        },
      };
    }
    if (status === "unavailable") {
      assertAllowedObjectKeys(
        result,
        new Set(["status", "unavailableReason"]),
        `${label} unavailable result`,
      );
      return {
        action,
        result: {
          status,
          unavailableReason: requireString(
            result.unavailableReason,
            `${label} unavailableReason`,
          ),
        },
      };
    }
  }

  if (action === "leave_membership") {
    const result = requireObject(
      record.result,
      "Hosted runtime group tool leave_membership response result",
    );
    const status = requireString(
      result.status,
      "Hosted runtime group tool leave_membership response status",
    );
    if (
      status === "left"
      || status === "already_left"
      || status === "owner_cannot_leave"
    ) {
      assertAllowedObjectKeys(
        result,
        new Set(["status"]),
        "Hosted runtime group tool leave_membership response result",
      );
      return { action, result: { status } };
    }
    if (status === "unavailable") {
      assertAllowedObjectKeys(
        result,
        new Set(["status", "unavailableReason"]),
        "Hosted runtime group tool leave_membership unavailable response result",
      );
      return {
        action,
        result: {
          status,
          unavailableReason: requireString(
            result.unavailableReason,
            "Hosted runtime group tool leave_membership unavailableReason",
          ),
        },
      };
    }
  }

  if (action === "create_join_link") {
    const result = requireObject(record.result, "Hosted runtime group tool create_join_link response result");
    const status = requireString(result.status, "Hosted runtime group tool create_join_link response status");
    if (status === "ok") {
      assertAllowedObjectKeys(result, new Set(["status", "group", "joinUrl", "offeredAt"]), "Hosted runtime group tool create_join_link ok response result");
      const offeredAt = result.offeredAt === undefined
        ? undefined
        : parseHostedRuntimeGroupCanonicalTimestamp(
            result.offeredAt,
            "Hosted runtime group tool create_join_link offeredAt",
          );
      return {
        action,
        result: {
          status,
          group: parseHostedRuntimeGroupSummary(result.group),
          joinUrl: requireString(result.joinUrl, "Hosted runtime group tool create_join_link joinUrl"),
          ...(offeredAt === undefined ? {} : { offeredAt }),
        },
      };
    }
    if (status === "unavailable") {
      assertAllowedObjectKeys(result, new Set(["status", "unavailableReason", "group"]), "Hosted runtime group tool create_join_link unavailable response result");
      return {
        action,
        result: {
          status,
          unavailableReason: requireString(result.unavailableReason, "Hosted runtime group unavailableReason"),
          group: null,
        },
      };
    }
  }

  if (action === "update_display_name") {
    const result = requireObject(record.result, "Hosted runtime group tool update_display_name response result");
    const status = requireString(result.status, "Hosted runtime group tool update_display_name response status");
    if (status === "ok") {
      assertAllowedObjectKeys(result, new Set(["status", "group"]), "Hosted runtime group tool update_display_name ok response result");
      return {
        action,
        result: {
          status,
          group: result.group === null
            ? null
            : parseHostedRuntimeGroupSummary(result.group),
        },
      };
    }
    if (status === "unavailable") {
      assertAllowedObjectKeys(result, new Set(["status", "unavailableReason", "group"]), "Hosted runtime group tool update_display_name unavailable response result");
      return {
        action,
        result: {
          status,
          unavailableReason: requireString(result.unavailableReason, "Hosted runtime group unavailableReason"),
          group: null,
        },
      };
    }
  }

  if (action === "post_join_offer") {
    const result = requireObject(record.result, "Hosted runtime group tool post_join_offer response result");
    const status = requireString(result.status, "Hosted runtime group tool post_join_offer response status");
    if (status === "sent") {
      assertAllowedObjectKeys(result, new Set(["status", "group", "joinUrl", "offeredAt", "offerState"]), "Hosted runtime group tool post_join_offer sent response result");
      const offeredAt = result.offeredAt === undefined
        ? undefined
        : parseHostedRuntimeGroupCanonicalTimestamp(
            result.offeredAt,
            "Hosted runtime group tool post_join_offer offeredAt",
          );
      const offerState = result.offerState === undefined
        ? undefined
        : requireString(
            result.offerState,
            "Hosted runtime group tool post_join_offer offerState",
          );
      if (
        offerState !== undefined
        && offerState !== "existing"
        && offerState !== "posted"
      ) {
        throw new TypeError(
          "Hosted runtime group tool post_join_offer offerState is invalid.",
        );
      }
      if (offeredAt !== undefined && offerState === undefined) {
        throw new TypeError(
          "Hosted runtime group tool post_join_offer offeredAt requires offerState.",
        );
      }
      return {
        action,
        result: {
          status,
          group: parseHostedRuntimeGroupSummary(result.group),
          joinUrl: requireString(result.joinUrl, "Hosted runtime group tool post_join_offer joinUrl"),
          ...(offerState === undefined ? {} : {
            offerState,
            ...(offeredAt === undefined ? {} : { offeredAt }),
          }),
        },
      };
    }
    if (status === "unavailable") {
      assertAllowedObjectKeys(result, new Set(["status", "unavailableReason", "group"]), "Hosted runtime group tool post_join_offer unavailable response result");
      return {
        action,
        result: {
          status,
          unavailableReason: requireString(result.unavailableReason, "Hosted runtime group unavailableReason"),
          group: null,
        },
      };
    }
  }

  if (action === "read_chat_participants") {
    const result = requireObject(record.result, "Hosted runtime group tool read_chat_participants response result");
    const status = requireString(result.status, "Hosted runtime group tool read_chat_participants response status");
    if (status === "ok") {
      assertAllowedObjectKeys(result, new Set(["status", "participants"]), "Hosted runtime group tool read_chat_participants ok response result");
      return {
        action,
        result: {
          status,
          participants: parseHostedRuntimeGroupChatParticipants(result.participants),
        },
      };
    }
    if (status === "unavailable") {
      assertAllowedObjectKeys(result, new Set(["status", "unavailableReason", "participants"]), "Hosted runtime group tool read_chat_participants unavailable response result");
      return {
        action,
        result: {
          status,
          unavailableReason: requireString(result.unavailableReason, "Hosted runtime group unavailableReason"),
          participants: null,
        },
      };
    }
  }

  if (action === "set_chat_avatar") {
    const result = requireObject(record.result, "Hosted runtime group tool set_chat_avatar response result");
    const status = requireString(result.status, "Hosted runtime group tool set_chat_avatar response status");
    if (status === "ok" || status === "requested") {
      assertAllowedObjectKeys(result, new Set(["status"]), "Hosted runtime group tool set_chat_avatar accepted response result");
      return { action, result: { status } };
    }
    if (status === "unavailable") {
      assertAllowedObjectKeys(
        result,
        new Set([
          "status",
          "unavailableReason",
          "providerErrorCode",
        ]),
        "Hosted runtime group tool set_chat_avatar unavailable response result",
      );
      const providerErrorCode = result.providerErrorCode === undefined
        ? undefined
        : requireNumber(
            result.providerErrorCode,
            "Hosted runtime group tool set_chat_avatar providerErrorCode",
          );
      if (
        providerErrorCode !== undefined
        && (
          !Number.isSafeInteger(providerErrorCode)
          || providerErrorCode < 1_000
          || providerErrorCode > 9_999
        )
      ) {
        throw new TypeError(
          "Hosted runtime group tool set_chat_avatar providerErrorCode must be a four-digit integer.",
        );
      }
      const expectedProviderErrorMessage =
        hostedRuntimeLinqProviderErrorMessageForCode(providerErrorCode);
      if (
        providerErrorCode !== undefined
        && expectedProviderErrorMessage === null
      ) {
        throw new TypeError(
          "Hosted runtime group tool set_chat_avatar providerErrorCode must be allowlisted.",
        );
      }
      const unavailableReason = requireString(
        result.unavailableReason,
        "Hosted runtime group unavailableReason",
      );
      if (
        unavailableReason !== "provider_unavailable"
        && providerErrorCode !== undefined
      ) {
        throw new TypeError(
          "Hosted runtime group tool set_chat_avatar provider diagnostics require provider_unavailable.",
        );
      }
      return {
        action,
        result: {
          status,
          unavailableReason,
          ...(providerErrorCode === undefined ? {} : { providerErrorCode }),
          ...(expectedProviderErrorMessage === null
            ? {}
            : { providerErrorMessage: expectedProviderErrorMessage }),
        },
      };
    }
  }

  if (action === "preflight_set_chat_avatar") {
    const result = requireObject(record.result, "Hosted runtime group tool preflight_set_chat_avatar response result");
    const status = requireString(result.status, "Hosted runtime group tool preflight_set_chat_avatar response status");
    if (status === "ok") {
      assertAllowedObjectKeys(result, new Set(["status"]), "Hosted runtime group tool preflight_set_chat_avatar ok response result");
      return { action, result: { status } };
    }
    if (status === "unavailable") {
      assertAllowedObjectKeys(result, new Set(["status", "unavailableReason"]), "Hosted runtime group tool preflight_set_chat_avatar unavailable response result");
      return {
        action,
        result: {
          status,
          unavailableReason: requireString(result.unavailableReason, "Hosted runtime group unavailableReason"),
        },
      };
    }
  }

  if (action === "share_contact_card") {
    const result = requireObject(record.result, "Hosted runtime group tool share_contact_card response result");
    const status = requireString(result.status, "Hosted runtime group tool share_contact_card response status");
    if (status === "sent" || status === "already_shared" || status === "unconfirmed") {
      assertAllowedObjectKeys(result, new Set(["status"]), "Hosted runtime group tool share_contact_card response result");
      return { action, result: { status } };
    }
    if (status === "unavailable") {
      assertAllowedObjectKeys(result, new Set(["status", "unavailableReason"]), "Hosted runtime group tool share_contact_card unavailable response result");
      return {
        action,
        result: {
          status,
          unavailableReason: requireString(result.unavailableReason, "Hosted runtime group unavailableReason"),
        },
      };
    }
  }

  if (action === "revoke_own_email_share") {
    const result = requireObject(record.result, "Hosted runtime group tool revoke_own_email_share response result");
    const status = requireString(result.status, "Hosted runtime group tool revoke_own_email_share response status");
    if (status === "revoked") {
      assertAllowedObjectKeys(result, new Set(["status", "revokedCount"]), "Hosted runtime group tool revoke_own_email_share revoked response result");
      return {
        action,
        result: {
          status,
          revokedCount: requireExactInteger(
            result.revokedCount,
            "Hosted runtime group tool revoke_own_email_share revokedCount",
            1,
          ),
        },
      };
    }
    if (status === "already_removed") {
      assertAllowedObjectKeys(result, new Set(["status", "revokedCount"]), "Hosted runtime group tool revoke_own_email_share already_removed response result");
      requireExactInteger(
        result.revokedCount,
        "Hosted runtime group tool revoke_own_email_share revokedCount",
        0,
      );
      return { action, result: { status, revokedCount: 0 } };
    }
    if (status === "unavailable") {
      assertAllowedObjectKeys(result, new Set(["status", "unavailableReason"]), "Hosted runtime group tool revoke_own_email_share unavailable response result");
      return {
        action,
        result: {
          status,
          unavailableReason: requireString(result.unavailableReason, "Hosted runtime group unavailableReason"),
        },
      };
    }
  }

  throw new TypeError("Hosted runtime group tool response action/status is not supported.");
}

function parseHostedRuntimeUsageReferralSnapshot(
  value: unknown,
  label: string,
): HostedRuntimeUsageReferralSnapshot {
  const record = requireObject(value, label);
  assertAllowedObjectKeys(
    record,
    new Set(["activeMissions", "availablePolicies", "trialCreditNotice"]),
    label,
  );
  const activeMissionValues = requireArray(
    record.activeMissions,
    `${label} activeMissions`,
  );
  if (activeMissionValues.length > HOSTED_USAGE_REFERRAL_POLICY_CODES.length) {
    throw new TypeError(`${label} activeMissions has too many entries.`);
  }
  const activePolicies = new Set<HostedUsageReferralPolicyCode>();
  const activeMissions = activeMissionValues.map((value, index) => {
    const mission = parseHostedRuntimeUsageReferralMissionSnapshot(
      value,
      `${label} activeMissions[${index}]`,
    );
    if (activePolicies.has(mission.policyCode)) {
      throw new TypeError(`${label} activeMissions must have unique policies.`);
    }
    activePolicies.add(mission.policyCode);
    return mission;
  });

  const availablePolicyValues = requireArray(
    record.availablePolicies,
    `${label} availablePolicies`,
  );
  if (availablePolicyValues.length > HOSTED_USAGE_REFERRAL_POLICY_CODES.length) {
    throw new TypeError(`${label} availablePolicies has too many entries.`);
  }
  const seenPolicies = new Set<HostedUsageReferralPolicyCode>();
  const availablePolicies = availablePolicyValues.map((value, index) => {
    const policyLabel = `${label} availablePolicies[${index}]`;
    const policy = requireObject(value, policyLabel);
    assertAllowedObjectKeys(
      policy,
      new Set(["code", "requirementsLabel", "rewardLabel"]),
      policyLabel,
    );
    const code = parseHostedRuntimeUsageReferralPolicyCode(
      policy.code,
      `${policyLabel} code`,
    );
    if (seenPolicies.has(code)) {
      throw new TypeError(`${label} availablePolicies must be unique.`);
    }
    if (activePolicies.has(code)) {
      throw new TypeError(`${label} policy cannot be both active and available.`);
    }
    seenPolicies.add(code);
    return {
      code,
      requirementsLabel: parseHostedRuntimeUsageReferralLabel(
        policy.requirementsLabel,
        `${policyLabel} requirementsLabel`,
      ),
      rewardLabel: parseHostedRuntimeUsageReferralLabel(
        policy.rewardLabel,
        `${policyLabel} rewardLabel`,
      ),
    };
  });
  const trialCreditNotice = record.trialCreditNotice === null
    ? null
    : parseHostedRuntimeUsageReferralLabel(
        record.trialCreditNotice,
        `${label} trialCreditNotice`,
      );

  return { activeMissions, availablePolicies, trialCreditNotice };
}

function parseHostedRuntimeUsageReferralMissionSnapshot(
  value: unknown,
  label: string,
): HostedRuntimeUsageReferralSnapshot["activeMissions"][number] {
  const mission = requireObject(value, label);
  assertAllowedObjectKeys(
    mission,
    new Set([
      "destinationKind",
      "expiresAt",
      "policyCode",
      "rewardLabel",
      "state",
    ]),
    label,
  );
  const destinationKind = requireString(
    mission.destinationKind,
    `${label} destinationKind`,
  );
  if (destinationKind !== "group" && destinationKind !== "personal") {
    throw new TypeError(`${label} destinationKind is invalid.`);
  }
  const state = requireString(mission.state, `${label} state`);
  if (state !== "armed" && state !== "target_bound") {
    throw new TypeError(`${label} state is invalid.`);
  }
  const expiresAt = requireString(mission.expiresAt, `${label} expiresAt`);
  const expiresAtDate = new Date(expiresAt);
  if (
    !Number.isFinite(expiresAtDate.getTime())
    || expiresAtDate.toISOString() !== expiresAt
  ) {
    throw new TypeError(`${label} expiresAt must be a canonical timestamp.`);
  }

  return {
    destinationKind,
    expiresAt,
    policyCode: parseHostedRuntimeUsageReferralPolicyCode(
      mission.policyCode,
      `${label} policyCode`,
    ),
    rewardLabel: parseHostedRuntimeUsageReferralLabel(
      mission.rewardLabel,
      `${label} rewardLabel`,
    ),
    state,
  };
}

function parseHostedRuntimeUsageReferralLabel(
  value: unknown,
  label: string,
): string {
  return parseHostedRuntimeGroupAskBoundedText({
    label,
    maxCodePoints: 500,
    value,
  });
}

export function parseHostedRuntimeNewsletterToolRequest(
  value: unknown,
): HostedRuntimeNewsletterToolRequest {
  const record = requireObject(value, "Hosted runtime newsletter tool request");
  const action = requireString(record.action, "Hosted runtime newsletter tool request action");
  if (action === "prepare") {
    assertAllowedObjectKeys(
      record,
      new Set(["action", "groupId"]),
      "Hosted runtime newsletter tool prepare request",
    );
    // `groupId` is accepted and ignored only for consumer-first deploy skew.
    // Current callers rely on the callback-authenticated runtime member, which
    // maps uniquely to its hosted group.
    if (record.groupId !== undefined) {
      requireString(record.groupId, "Hosted runtime newsletter tool legacy groupId");
    }
    return { action };
  }
  if (action === "send") {
    assertAllowedObjectKeys(
      record,
      new Set(["action", "groupId", "subject", "html", "text"]),
      "Hosted runtime newsletter tool send request",
    );
    const subject = requireString(record.subject, "Hosted runtime newsletter tool subject");
    const html = requireString(record.html, "Hosted runtime newsletter tool html");
    const text = readOptionalNullableString(
      record.text,
      "Hosted runtime newsletter tool text",
    ) ?? null;
    if (subject.trim().length === 0) {
      throw new TypeError("Hosted runtime newsletter tool subject must not be blank.");
    }
    if (subject.length > HOSTED_RUNTIME_NEWSLETTER_SUBJECT_MAX_LENGTH) {
      throw new TypeError("Hosted runtime newsletter tool subject is too long.");
    }
    if (html.trim().length === 0) {
      throw new TypeError("Hosted runtime newsletter tool html must not be blank.");
    }
    if (html.length > HOSTED_RUNTIME_NEWSLETTER_HTML_MAX_LENGTH) {
      throw new TypeError("Hosted runtime newsletter tool html is too long.");
    }
    if (text !== null && text.length > HOSTED_RUNTIME_NEWSLETTER_TEXT_MAX_LENGTH) {
      throw new TypeError("Hosted runtime newsletter tool text is too long.");
    }
    if (record.groupId !== undefined) {
      requireString(record.groupId, "Hosted runtime newsletter tool legacy groupId");
    }
    return {
      action,
      html,
      subject,
      text,
    };
  }

  throw new TypeError("Hosted runtime newsletter tool action is not supported.");
}

export function parseHostedRuntimeNewsletterToolResponse(
  value: unknown,
): HostedRuntimeNewsletterToolResponse {
  const record = requireObject(value, "Hosted runtime newsletter tool response");
  const action = requireString(record.action, "Hosted runtime newsletter tool response action");
  assertAllowedObjectKeys(record, new Set(["action", "result"]), "Hosted runtime newsletter tool response");

  if (action === "prepare") {
    const result = requireObject(record.result, "Hosted runtime newsletter tool prepare response result");
    const status = requireString(result.status, "Hosted runtime newsletter tool prepare response status");
    if (status === "ok") {
      assertAllowedObjectKeys(
        result,
        new Set([
          "authorizationProof",
          "status",
          "groupId",
          "participants",
          "missingEmailParticipants",
        ]),
        "Hosted runtime newsletter tool prepare ok response result",
      );
      return {
        action,
        result: {
          authorizationProof: requireHostedRuntimeNewsletterAuthorizationProof(
            result.authorizationProof,
          ),
          groupId: requireString(result.groupId, "Hosted runtime newsletter tool groupId"),
          missingEmailParticipants: parseHostedRuntimeNewsletterParticipants(
            result.missingEmailParticipants,
            "Hosted runtime newsletter tool missingEmailParticipants",
          ),
          participants: parseHostedRuntimeNewsletterParticipants(
            result.participants,
            "Hosted runtime newsletter tool participants",
          ),
          status,
        },
      };
    }
    if (status === "unavailable") {
      assertAllowedObjectKeys(
        result,
        new Set(["status", "unavailableReason"]),
        "Hosted runtime newsletter tool prepare unavailable response result",
      );
      return {
        action,
        result: {
          status,
          unavailableReason: requireString(
            result.unavailableReason,
            "Hosted runtime newsletter tool unavailableReason",
          ),
        },
      };
    }
  }

  if (action === "send") {
    const result = requireObject(record.result, "Hosted runtime newsletter tool send response result");
    const status = requireString(result.status, "Hosted runtime newsletter tool send response status");
    if (status === "accepted" || status === "sent" || status === "no_recipients") {
      assertAllowedObjectKeys(
        result,
        new Set(["status", "participantCount", "skippedNoEmailMemberIds"]),
        "Hosted runtime newsletter tool send response result",
      );
      const participantCount = requireNumber(
        result.participantCount,
        "Hosted runtime newsletter tool participantCount",
      );
      if (!Number.isInteger(participantCount) || participantCount < 0) {
        throw new TypeError("Hosted runtime newsletter tool participantCount must be a non-negative integer.");
      }
      const skippedNoEmailMemberIds = parseHostedRuntimeNewsletterMemberIds(
        result.skippedNoEmailMemberIds,
        "Hosted runtime newsletter tool skippedNoEmailMemberIds",
      );
      if (status === "no_recipients") {
        if (participantCount !== 0) {
          throw new TypeError("Hosted runtime newsletter tool no_recipients participantCount must be 0.");
        }
        return {
          action,
          result: {
            participantCount: 0,
            skippedNoEmailMemberIds,
            status,
          },
        };
      }
      return {
        action,
        result: {
          participantCount,
          skippedNoEmailMemberIds,
          status,
        },
      };
    }
    if (status === "partial_failure") {
      assertAllowedObjectKeys(
        result,
        new Set([
          "status",
          "failedRecipientCount",
          "participantCount",
          "sentRecipientCount",
          "skippedNoEmailMemberIds",
        ]),
        "Hosted runtime newsletter tool partial_failure response result",
      );
      const participantCount = requireNumber(
        result.participantCount,
        "Hosted runtime newsletter tool participantCount",
      );
      if (!Number.isInteger(participantCount) || participantCount < 0) {
        throw new TypeError("Hosted runtime newsletter tool participantCount must be a non-negative integer.");
      }
      const skippedNoEmailMemberIds = parseHostedRuntimeNewsletterMemberIds(
        result.skippedNoEmailMemberIds,
        "Hosted runtime newsletter tool skippedNoEmailMemberIds",
      );
      const sentRecipientCount = requireNumber(
        result.sentRecipientCount,
        "Hosted runtime newsletter tool sentRecipientCount",
      );
      const failedRecipientCount = requireNumber(
        result.failedRecipientCount,
        "Hosted runtime newsletter tool failedRecipientCount",
      );
      if (!Number.isInteger(sentRecipientCount) || sentRecipientCount < 0) {
        throw new TypeError("Hosted runtime newsletter tool sentRecipientCount must be a non-negative integer.");
      }
      if (!Number.isInteger(failedRecipientCount) || failedRecipientCount < 0) {
        throw new TypeError("Hosted runtime newsletter tool failedRecipientCount must be a non-negative integer.");
      }
      return {
        action,
        result: {
          failedRecipientCount,
          participantCount,
          sentRecipientCount,
          skippedNoEmailMemberIds,
          status,
        },
      };
    }
    if (status === "unavailable") {
      assertAllowedObjectKeys(
        result,
        new Set(["status", "unavailableReason"]),
        "Hosted runtime newsletter tool send unavailable response result",
      );
      return {
        action,
        result: {
          status,
          unavailableReason: requireString(
            result.unavailableReason,
            "Hosted runtime newsletter tool unavailableReason",
          ),
        },
      };
    }
  }

  throw new TypeError("Hosted runtime newsletter tool response action/status is not supported.");
}

function requireHostedRuntimeNewsletterAuthorizationProof(value: unknown): string {
  if (!isHostedRuntimeNewsletterAuthorizationProof(value)) {
    throw new TypeError(
      "Hosted runtime newsletter tool authorizationProof must be a SHA-256 hex digest.",
    );
  }
  return value;
}

function parseHostedRuntimeNewsletterParticipants(
  value: unknown,
  label: string,
): HostedRuntimeNewsletterParticipantSummary[] {
  const entries = requireArray(value, label);
  if (entries.length > HOSTED_RUNTIME_NEWSLETTER_PARTICIPANTS_MAX) {
    throw new TypeError(`${label} must contain at most ${HOSTED_RUNTIME_NEWSLETTER_PARTICIPANTS_MAX} entries.`);
  }
  return entries.map((entry) => {
    const record = requireObject(entry, `${label} entry`);
    assertAllowedObjectKeys(
      record,
      new Set(["authorizedShares", "hasEmail", "memberId"]),
      `${label} entry`,
    );
    return {
      authorizedShares: parseHostedRuntimeNewsletterAuthorizedShares(
        record.authorizedShares,
        `${label} entry authorizedShares`,
      ),
      hasEmail: requireBoolean(record.hasEmail, `${label} entry hasEmail`),
      memberId: requireString(record.memberId, `${label} entry memberId`),
    };
  });
}

function parseHostedRuntimeNewsletterAuthorizedShares(
  value: unknown,
  label: string,
): HostedRuntimeNewsletterAuthorizedShare[] {
  const entries = requireArray(value, label);
  if (entries.length > HOSTED_RUNTIME_NEWSLETTER_AUTHORIZED_SHARES_PER_PARTICIPANT_MAX) {
    throw new TypeError(
      `${label} must contain at most ${HOSTED_RUNTIME_NEWSLETTER_AUTHORIZED_SHARES_PER_PARTICIPANT_MAX} entries.`,
    );
  }
  return entries.map((entry) => {
    const record = requireObject(entry, `${label} entry`);
    assertAllowedObjectKeys(
      record,
      new Set(["projectionScopeKey", "shareId"]),
      `${label} entry`,
    );
    return {
      projectionScopeKey: requireString(
        record.projectionScopeKey,
        `${label} entry projectionScopeKey`,
      ),
      shareId: requireString(record.shareId, `${label} entry shareId`),
    };
  });
}

function parseHostedRuntimeNewsletterMemberIds(
  value: unknown,
  label: string,
): string[] {
  const entries = requireArray(value, label);
  return entries.map((entry) => requireString(entry, `${label} entry`));
}

function parseHostedRuntimeGroupChatParticipants(
  value: unknown,
): HostedRuntimeGroupChatParticipant[] {
  const label = "Hosted runtime group tool read_chat_participants participants";
  const entries = requireArray(value, label);
  if (entries.length > HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX) {
    throw new TypeError(`${label} must contain at most ${HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX} entries.`);
  }
  return entries.map((entry) => {
    const record = requireObject(entry, `${label} entry`);
    assertAllowedObjectKeys(
      record,
      new Set(["handle", "hasOwnMurph", "ownerAdvisoryName"]),
      `${label} entry`,
    );
    return {
      handle: requireString(record.handle, `${label} entry handle`),
      hasOwnMurph: requireBoolean(record.hasOwnMurph, `${label} entry hasOwnMurph`),
      ...(record.ownerAdvisoryName === undefined
        ? {}
        : {
            ownerAdvisoryName: parseHostedRuntimeGroupAskBoundedText({
              label: `${label} entry ownerAdvisoryName`,
              maxCodePoints:
                HOSTED_RUNTIME_GROUP_OWNER_ADVISORY_NAME_MAX_CODE_POINTS,
              value: record.ownerAdvisoryName,
            }),
          }),
    };
  });
}

function parseHostedRuntimeGroupMembershipSummaries(
  value: unknown,
): HostedRuntimeGroupMembershipSummary[] {
  const label = "Hosted runtime group tool list_memberships memberships";
  const entries = requireArray(value, label);
  if (entries.length > HOSTED_RUNTIME_GROUP_MEMBERSHIPS_MAX) {
    throw new TypeError(
      `${label} must contain at most ${HOSTED_RUNTIME_GROUP_MEMBERSHIPS_MAX} entries.`,
    );
  }
  return entries.map((entry) => {
    const record = requireObject(entry, `${label} entry`);
    assertAllowedObjectKeys(
      record,
      new Set([
        "displayName",
        "grantedVaultShareProjectionScopes",
        "kind",
        "memberCount",
        "membershipId",
        "permissionsUrl",
        "requestedVaultShareProjectionScopes",
        "role",
        "sponsorshipUrl",
      ]),
      `${label} entry`,
    );
    const grantedVaultShareProjectionScopes =
      parseHostedRuntimeGroupProjectionScopeArray(
        record.grantedVaultShareProjectionScopes,
        `${label} entry grantedVaultShareProjectionScopes`,
        HOSTED_RUNTIME_GROUP_SUMMARY_PROJECTION_SCOPES,
      );
    if (!grantedVaultShareProjectionScopes) {
      throw new TypeError(
        `${label} entry grantedVaultShareProjectionScopes must be an array.`,
      );
    }
    const requestedVaultShareProjectionScopes =
      parseHostedRuntimeGroupProjectionScopeArray(
        record.requestedVaultShareProjectionScopes,
        `${label} entry requestedVaultShareProjectionScopes`,
        HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
      );
    if (!requestedVaultShareProjectionScopes) {
      throw new TypeError(
        `${label} entry requestedVaultShareProjectionScopes must be an array.`,
      );
    }
    const memberCount = requireNumber(
      record.memberCount,
      `${label} entry memberCount`,
    );
    if (!Number.isInteger(memberCount) || memberCount < 0) {
      throw new TypeError(`${label} entry memberCount must be a non-negative integer.`);
    }
    const membershipId = requireString(
      record.membershipId,
      `${label} entry membershipId`,
    ).trim();
    if (!membershipId) {
      throw new TypeError(`${label} entry membershipId must not be blank.`);
    }
    return {
      displayName: readNullableString(record.displayName, `${label} entry displayName`),
      grantedVaultShareProjectionScopes,
      kind: requireString(record.kind, `${label} entry kind`),
      memberCount,
      membershipId,
      permissionsUrl: readNullableString(
        record.permissionsUrl,
        `${label} entry permissionsUrl`,
      ),
      requestedVaultShareProjectionScopes,
      role: requireString(record.role, `${label} entry role`),
      sponsorshipUrl: readNullableString(
        record.sponsorshipUrl,
        `${label} entry sponsorshipUrl`,
      ),
    };
  });
}

function parseHostedRuntimeGroupProjectionKindArray<
  K extends HostedVaultShareProjectionKind,
>(
  value: unknown,
  label: string,
  allowedKinds: readonly K[],
): K[] | null {
  if (value === undefined || value === null) return null;
  const requested = requireArray(value, label);
  if (requested.length > allowedKinds.length) {
    throw new TypeError(`${label} must contain at most ${allowedKinds.length} entries.`);
  }
  const seen = new Set<K>();
  for (const entry of requested) {
    if (!isAllowedProjectionKind(allowedKinds, entry)) {
      throw new TypeError(`${label} contains an unsupported projection kind.`);
    }
    seen.add(entry);
  }
  return allowedKinds.filter((kind) => seen.has(kind));
}

const HOSTED_RUNTIME_GROUP_SUMMARY_PROJECTION_SCOPES = Object.freeze([
  hostedVaultShareProjectionKindToScope("profile-name.v0"),
  ...HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
] satisfies readonly HostedVaultShareProjectionScope[]);

const HOSTED_RUNTIME_GROUP_SHARED_SELECTABLE_PROJECTION_SCOPE_BY_KEY =
  new Map<string, HostedVaultShareSelectableProjectionScope>(
    HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.map((projectionScope) => [
      buildHostedVaultShareProjectionScopeKey(projectionScope),
      projectionScope,
    ]),
  );

function parseHostedRuntimeGroupSharedRequestedProjectionScopes(
  value: unknown,
  label: string,
): HostedVaultShareSelectableProjectionScope[] {
  const requested = requireArray(value, label);
  if (
    requested.length === 0
    || requested.length > HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_PROJECTION_SCOPES
  ) {
    throw new TypeError(
      `${label} must contain between 1 and ${HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_PROJECTION_SCOPES} entries.`,
    );
  }

  const seen = new Set<string>();
  return requested.map((entry, index) => {
    const projectionScope = parseHostedRuntimeGroupSharedSelectableProjectionScope(
      entry,
      `${label}[${index}]`,
    );
    const projectionScopeKey = buildHostedVaultShareProjectionScopeKey(projectionScope);
    if (seen.has(projectionScopeKey)) {
      throw new TypeError(`${label} must not contain duplicate projection scopes.`);
    }
    seen.add(projectionScopeKey);
    return projectionScope;
  });
}

function parseHostedRuntimeGroupSharedSelectableProjectionScope(
  value: unknown,
  label: string,
): HostedVaultShareSelectableProjectionScope {
  let parsed: HostedVaultShareProjectionScope;
  try {
    parsed = parseHostedVaultShareProjectionScope(value, label);
  } catch (error) {
    throw new TypeError(`${label} must be a supported selectable projection scope.`, {
      cause: error,
    });
  }
  const projectionScopeKey = buildHostedVaultShareProjectionScopeKey(parsed);
  const canonical =
    HOSTED_RUNTIME_GROUP_SHARED_SELECTABLE_PROJECTION_SCOPE_BY_KEY.get(
      projectionScopeKey,
    );
  if (!canonical) {
    throw new TypeError(`${label} must be a supported selectable projection scope.`);
  }
  return canonical;
}

function parseHostedRuntimeGroupSelectableProjectionScopes(
  value: unknown,
  legacyKindsValue: unknown,
  label: string,
): HostedVaultShareSelectableProjectionScope[] | null {
  const scopes = parseHostedRuntimeGroupProjectionScopeArray(
    value,
    label,
    HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
  );
  if (scopes !== null) {
    return scopes;
  }
  const legacyKinds = parseHostedRuntimeGroupProjectionKindArray(
    legacyKindsValue,
    `${label} legacy projectionKinds`,
    HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
  );
  if (legacyKinds === null) {
    return null;
  }
  return legacyKinds.map((projectionKind) => hostedVaultShareProjectionKindToScope(projectionKind));
}

function parseHostedRuntimeGroupProjectionScopeArray<
  K extends HostedVaultShareProjectionScope,
>(
  value: unknown,
  label: string,
  allowedScopes: readonly K[],
): K[] | null {
  if (value === undefined || value === null) return null;
  const requested = requireArray(value, label);
  if (requested.length > allowedScopes.length) {
    throw new TypeError(`${label} must contain at most ${allowedScopes.length} entries.`);
  }
  const allowedScopeByKey = new Map(
    allowedScopes.map((scope) => [buildHostedVaultShareProjectionScopeKey(scope), scope]),
  );
  const seen = new Set<string>();
  for (const entry of requested) {
    let scope: HostedVaultShareProjectionScope;
    try {
      scope = parseHostedVaultShareProjectionScope(entry, `${label} entry`);
    } catch (error) {
      throw new TypeError(
        `${label} contains an unsupported projection scope.`,
        { cause: error },
      );
    }
    const scopeKey = buildHostedVaultShareProjectionScopeKey(scope);
    if (!allowedScopeByKey.has(scopeKey)) {
      throw new TypeError(`${label} contains an unsupported projection scope.`);
    }
    seen.add(scopeKey);
  }
  return allowedScopes.filter((scope) =>
    seen.has(buildHostedVaultShareProjectionScopeKey(scope))
  );
}

function isAllowedProjectionKind<K extends HostedVaultShareProjectionKind>(
  allowedKinds: readonly K[],
  value: unknown,
): value is K {
  return (allowedKinds as readonly unknown[]).includes(value);
}

function legacyProjectionKindsToScopes(
  projectionKinds: readonly HostedVaultShareProjectionKind[],
  label: string,
): HostedVaultShareProjectionScope[] {
  return projectionKinds.map((projectionKind) =>
    parseHostedVaultShareProjectionScope(projectionKind, `${label} ${projectionKind}`)
  );
}

function parseHostedRuntimeGroupAssistantAskFields(
  record: Record<string, unknown>,
  label: string,
): {
  originAssistantInputId: string;
  originSessionId: string;
  question: string;
} {
  return {
    originAssistantInputId: parseHostedExecutionAssistantAskOriginInputId(
      record.originAssistantInputId,
      `${label} originAssistantInputId`,
    ),
    originSessionId: parseHostedRuntimeGroupAskBoundedText({
      label: `${label} originSessionId`,
      maxCodePoints: HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_MAX_CODE_POINTS,
      value: record.originSessionId,
    }),
    question: parseHostedRuntimeGroupAskBoundedText({
      label: `${label} question`,
      maxCodePoints: HOSTED_EXECUTION_ASSISTANT_ASK_QUESTION_MAX_CODE_POINTS,
      value: record.question,
    }),
  };
}

function parseHostedRuntimeGroupUnavailableReason(
  record: Record<string, unknown>,
  label: string,
): string {
  return parseHostedRuntimeGroupAskBoundedText({
    label,
    maxCodePoints: 500,
    value: record.unavailableReason,
  });
}

function parseHostedRuntimeGroupDisclosurePermissionText(
  value: unknown,
  label: string,
): string {
  return parseHostedRuntimeGroupAskBoundedText({
    label,
    maxCodePoints:
      HOSTED_RUNTIME_GROUP_DISCLOSURE_PERMISSION_TEXT_MAX_CODE_POINTS,
    value,
  });
}

function parseHostedRuntimeGroupDisclosureGrantId(
  value: unknown,
  label: string,
): string {
  return parseHostedRuntimeGroupAskBoundedText({
    label,
    maxCodePoints: HOSTED_RUNTIME_ASSISTANT_ASK_REQUEST_ID_MAX_CODE_POINTS,
    value,
  });
}

function parseHostedRuntimeGroupDisclosureGrantSummaries(
  value: unknown,
  label: string,
): HostedRuntimeGroupDisclosureGrantSummary[] {
  return parseHostedRuntimeGroupDisclosureGrantEntries(value, label).map((entry) => {
    const record = requireObject(entry, `${label} entry`);
    assertAllowedObjectKeys(
      record,
      new Set(["grantId", "permissionText"]),
      `${label} entry`,
    );
    return parseHostedRuntimeGroupDisclosureGrantFields(record, `${label} entry`);
  });
}

function parseHostedRuntimeGroupDisclosureGrantListEntries(
  value: unknown,
  label: string,
): HostedRuntimeGroupDisclosureGrantListEntry[] {
  return parseHostedRuntimeGroupDisclosureGrantEntries(value, label).map((entry) => {
    const record = requireObject(entry, `${label} entry`);
    assertAllowedObjectKeys(
      record,
      new Set(["grantId", "groupLabel", "permissionText"]),
      `${label} entry`,
    );
    return {
      ...parseHostedRuntimeGroupDisclosureGrantFields(record, `${label} entry`),
      groupLabel: record.groupLabel === null
        ? null
        : parseHostedRuntimeGroupAskBoundedText({
            label: `${label} entry groupLabel`,
            maxCodePoints:
              HOSTED_EXECUTION_ASSISTANT_ASK_TARGET_LABEL_MAX_CODE_POINTS,
            value: record.groupLabel,
          }),
    };
  });
}

function parseHostedRuntimeGroupDisclosureGrantEntries(
  value: unknown,
  label: string,
): unknown[] {
  const entries = requireArray(value, label);
  if (entries.length > HOSTED_RUNTIME_GROUP_DISCLOSURE_GRANTS_MAX) {
    throw new TypeError(
      `${label} must contain at most ${HOSTED_RUNTIME_GROUP_DISCLOSURE_GRANTS_MAX} entries.`,
    );
  }
  return entries;
}

function parseHostedRuntimeGroupDisclosureGrantFields(
  record: Record<string, unknown>,
  label: string,
): HostedRuntimeGroupDisclosureGrantSummary {
  return {
    grantId: parseHostedRuntimeGroupDisclosureGrantId(
      record.grantId,
      `${label} grantId`,
    ),
    permissionText: parseHostedRuntimeGroupDisclosurePermissionText(
      record.permissionText,
      `${label} permissionText`,
    ),
  };
}

function parseHostedRuntimeGroupSummary(value: unknown) {
  const record = requireObject(value, "Hosted runtime group summary");
  assertAllowedObjectKeys(
    record,
    new Set([
      "displayName",
      "id",
      "kind",
      "memberCount",
      "members",
      "requestedVaultShareProjectionKinds",
      "requestedVaultShareProjectionScopes",
      "status",
    ]),
    "Hosted runtime group summary",
  );
  const requestedVaultShareProjectionKinds =
    parseHostedRuntimeGroupProjectionKindArray(
      record.requestedVaultShareProjectionKinds,
      "Hosted runtime group summary requestedVaultShareProjectionKinds",
      HOSTED_VAULT_SHARE_PROJECTION_KINDS,
    ) ?? [];
  const requestedVaultShareProjectionScopes =
    parseHostedRuntimeGroupProjectionScopeArray(
      record.requestedVaultShareProjectionScopes,
      "Hosted runtime group summary requestedVaultShareProjectionScopes",
      HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
    ) ?? legacyProjectionKindsToScopes(
      requestedVaultShareProjectionKinds,
      "Hosted runtime group summary requestedVaultShareProjectionKinds",
    );
  return {
    displayName: readNullableString(record.displayName, "Hosted runtime group summary displayName"),
    id: requireString(record.id, "Hosted runtime group summary id"),
    kind: requireString(record.kind, "Hosted runtime group summary kind"),
    memberCount: requireNumber(record.memberCount, "Hosted runtime group summary memberCount"),
    members: parseHostedRuntimeGroupMemberSummaries(record.members),
    requestedVaultShareProjectionKinds,
    requestedVaultShareProjectionScopes,
    status: requireString(record.status, "Hosted runtime group summary status"),
  };
}

const HOSTED_RUNTIME_GROUP_MEMBER_SUMMARY_MAX_ENTRIES = 200;

// Optional for deploy skew: a runner updated before web tolerates summaries
// without a roster.
function parseHostedRuntimeGroupMemberSummaries(
  value: unknown,
): HostedRuntimeGroupMemberSummary[] {
  if (value === undefined || value === null) {
    return [];
  }
  const entries = requireArray(value, "Hosted runtime group summary members");
  if (entries.length > HOSTED_RUNTIME_GROUP_MEMBER_SUMMARY_MAX_ENTRIES) {
    throw new TypeError("Hosted runtime group summary members has too many entries.");
  }
  return entries.map((entry) => {
    const record = requireObject(entry, "Hosted runtime group summary member");
    assertAllowedObjectKeys(
      record,
      new Set([
        "disclosureGrants",
        "grantedVaultShareProjectionKinds",
        "grantedVaultShareProjectionScopes",
        "handle",
        "memberId",
        "role",
      ]),
      "Hosted runtime group summary member",
    );
    const grantedVaultShareProjectionKinds =
      parseHostedRuntimeGroupProjectionKindArray(
        record.grantedVaultShareProjectionKinds,
        "Hosted runtime group summary member grantedVaultShareProjectionKinds",
        HOSTED_VAULT_SHARE_PROJECTION_KINDS,
      ) ?? [];
    const grantedVaultShareProjectionScopes =
      parseHostedRuntimeGroupProjectionScopeArray(
        record.grantedVaultShareProjectionScopes,
        "Hosted runtime group summary member grantedVaultShareProjectionScopes",
        HOSTED_RUNTIME_GROUP_SUMMARY_PROJECTION_SCOPES,
      ) ?? legacyProjectionKindsToScopes(
        grantedVaultShareProjectionKinds,
        "Hosted runtime group summary member grantedVaultShareProjectionKinds",
    );
    return {
      disclosureGrants: record.disclosureGrants === undefined
        ? []
        : parseHostedRuntimeGroupDisclosureGrantSummaries(
            record.disclosureGrants,
            "Hosted runtime group summary member disclosureGrants",
          ),
      grantedVaultShareProjectionKinds,
      grantedVaultShareProjectionScopes,
      handle: readNullableString(record.handle, "Hosted runtime group summary member handle"),
      memberId: requireString(record.memberId, "Hosted runtime group summary member memberId"),
      role: requireString(record.role, "Hosted runtime group summary member role"),
    };
  });
}

export function parseHostedRuntimeFamilyPlanToolRequest(
  value: unknown,
): HostedRuntimeFamilyPlanToolRequest {
  const record = requireObject(value, "Hosted runtime family plan tool request");
  const action = requireString(
    record.action,
    "Hosted runtime family plan tool request action",
  );
  if (action === "read_status") {
    assertAllowedObjectKeys(
      record,
      new Set(["action"]),
      "Hosted runtime family plan tool read_status request",
    );
    return {
      action,
    };
  }
  if (action === "start_checkout") {
    assertAllowedObjectKeys(
      record,
      new Set(["action", "invite"]),
      "Hosted runtime family plan tool start_checkout request",
    );
    const invite = record.invite === undefined || record.invite === null
      ? null
      : parseHostedRuntimeFamilyPlanInviteRequest(
          record.invite,
          "Hosted runtime family plan tool start_checkout request invite",
        );
    return invite
      ? {
          action,
          invite,
        }
      : {
          action,
        };
  }
  if (action !== "create_invite") {
    throw new TypeError("Hosted runtime family plan tool action is not supported.");
  }

  assertAllowedObjectKeys(
    record,
    new Set(["action", "invite"]),
    "Hosted runtime family plan tool create_invite request",
  );
  const invite = parseHostedRuntimeFamilyPlanInviteRequest(
    record.invite,
    "Hosted runtime family plan tool create_invite request invite",
  );

  return {
    action,
    invite,
  };
}

export function parseHostedRuntimeIMessageContactToolRequest(
  value: unknown,
): HostedRuntimeIMessageContactToolRequest {
  const record = requireObject(
    value,
    "Hosted runtime iMessage contact tool request",
  );
  assertAllowedObjectKeys(
    record,
    new Set(["assistantInputId"]),
    "Hosted runtime iMessage contact tool request",
  );
  const assistantInputId = requireString(
    record.assistantInputId,
    "Hosted runtime iMessage contact tool assistantInputId",
  );
  if (!/^ain_[0-9a-f]{32}$/u.test(assistantInputId)) {
    throw new TypeError(
      "Hosted runtime iMessage contact tool assistantInputId is invalid.",
    );
  }
  return { assistantInputId };
}

export function parseHostedRuntimeIMessageContactToolResponse(
  value: unknown,
): HostedRuntimeIMessageContactToolResponse {
  const record = requireObject(
    value,
    "Hosted runtime iMessage contact tool response",
  );
  assertAllowedObjectKeys(
    record,
    new Set(["phoneNumber", "status", "verifiedSenderPhoneHint"]),
    "Hosted runtime iMessage contact tool response",
  );
  const status = requireString(
    record.status,
    "Hosted runtime iMessage contact tool response status",
  );
  if (status === "identity_required" || status === "unavailable") {
    if (
      record.phoneNumber !== null
      || record.verifiedSenderPhoneHint !== null
    ) {
      throw new TypeError(
        "Hosted runtime iMessage contact response without a number requires null phoneNumber and verifiedSenderPhoneHint.",
      );
    }
    return {
      phoneNumber: null,
      status,
      verifiedSenderPhoneHint: null,
    };
  }
  if (status !== "assigned" && status !== "existing") {
    throw new TypeError(
      "Hosted runtime iMessage contact tool response status is invalid.",
    );
  }
  const phoneNumber = requireString(
    record.phoneNumber,
    "Hosted runtime iMessage contact tool response phoneNumber",
  );
  if (!/^\+[1-9][0-9]{7,14}$/u.test(phoneNumber)) {
    throw new TypeError(
      "Hosted runtime iMessage contact tool response phoneNumber is invalid.",
    );
  }
  const verifiedSenderPhoneHint = requireString(
    record.verifiedSenderPhoneHint,
    "Hosted runtime iMessage contact tool response verifiedSenderPhoneHint",
  );
  if (!/^\*{3} [0-9]{4}$/u.test(verifiedSenderPhoneHint)) {
    throw new TypeError(
      "Hosted runtime iMessage contact tool response verifiedSenderPhoneHint is invalid.",
    );
  }
  return { phoneNumber, status, verifiedSenderPhoneHint };
}

export function parseHostedRuntimeAssistantConfigurationToolRequest(
  value: unknown,
): HostedRuntimeAssistantConfigurationToolRequest {
  const record = requireObject(
    value,
    "Hosted runtime assistant configuration tool request",
  );
  const action = requireString(
    record.action,
    "Hosted runtime assistant configuration tool request action",
  );
  if (action === "read") {
    assertAllowedObjectKeys(
      record,
      new Set(["action"]),
      "Hosted runtime assistant configuration tool read request",
    );
    return { action };
  }
  if (action !== "update") {
    throw new TypeError(
      "Hosted runtime assistant configuration tool action is not supported.",
    );
  }

  assertAllowedObjectKeys(
    record,
    new Set(["action", "model", "provider", "reasoningEffort"]),
    "Hosted runtime assistant configuration tool update request",
  );
  const model = record.model === undefined
    ? undefined
    : parseHostedRuntimeAssistantProductModel(
        record.model,
        "Hosted runtime assistant configuration tool model",
      );
  const reasoningEffort = record.reasoningEffort === undefined
    ? undefined
    : parseHostedRuntimeAssistantReasoningEffort(
        record.reasoningEffort,
        "Hosted runtime assistant configuration tool reasoningEffort",
      );
  const provider = record.provider === undefined
    ? undefined
    : parseHostedRuntimeAssistantProvider(
        record.provider,
        "Hosted runtime assistant configuration tool provider",
      );
  if (model === undefined) {
    if (provider !== undefined) {
      return reasoningEffort === undefined
        ? { action, provider }
        : { action, provider, reasoningEffort };
    }
    if (reasoningEffort === undefined) {
      throw new TypeError(
        "Hosted runtime assistant configuration update requires a model, provider, or reasoning effort.",
      );
    }
    return { action, reasoningEffort };
  }

  return {
    action,
    model,
    ...(provider === undefined ? {} : { provider }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  };
}

export function parseHostedRuntimeAssistantConfigurationControlRequest(
  value: unknown,
): HostedRuntimeAssistantConfigurationControlRequest {
  const record = requireObject(
    value,
    "Hosted runtime assistant configuration control request",
  );
  const action = requireString(
    record.action,
    "Hosted runtime assistant configuration control request action",
  );
  if (action === "read") {
    assertAllowedObjectKeys(
      record,
      new Set(["action"]),
      "Hosted runtime assistant configuration control read request",
    );
    return { action };
  }
  if (action !== "update") {
    throw new TypeError(
      "Hosted runtime assistant configuration control action is not supported.",
    );
  }

  assertAllowedObjectKeys(
    record,
    new Set(["action", "assistantInputId", "model", "provider", "reasoningEffort"]),
    "Hosted runtime assistant configuration control update request",
  );
  const assistantInputId = requireString(
    record.assistantInputId,
    "Hosted runtime assistant configuration control assistantInputId",
  );
  if (!/^ain_[0-9a-f]{32}$/u.test(assistantInputId)) {
    throw new TypeError(
      "Hosted runtime assistant configuration control assistantInputId is invalid.",
    );
  }
  const changes = parseHostedRuntimeAssistantConfigurationChanges(
    record,
    "Hosted runtime assistant configuration control",
  );
  return { action, assistantInputId, ...changes };
}

function parseHostedRuntimeAssistantConfigurationChanges(
  record: Record<string, unknown>,
  label: string,
):
  | {
      model: HostedAssistantProductModel;
      provider?: HostedAssistantProvider;
      reasoningEffort?: HostedAssistantReasoningEffort;
    }
  | {
      model?: never;
      provider: HostedAssistantProvider;
      reasoningEffort?: HostedAssistantReasoningEffort;
    }
  | {
      model?: never;
      provider?: never;
      reasoningEffort: HostedAssistantReasoningEffort;
    } {
  const model = record.model === undefined
    ? undefined
    : parseHostedRuntimeAssistantProductModel(record.model, `${label} model`);
  const provider = record.provider === undefined
    ? undefined
    : parseHostedRuntimeAssistantProvider(record.provider, `${label} provider`);
  const reasoningEffort = record.reasoningEffort === undefined
    ? undefined
    : parseHostedRuntimeAssistantReasoningEffort(
        record.reasoningEffort,
        `${label} reasoningEffort`,
      );
  if (model === undefined) {
    if (provider !== undefined) {
      return reasoningEffort === undefined
        ? { provider }
        : { provider, reasoningEffort };
    }
    if (reasoningEffort === undefined) {
      throw new TypeError(
        `${label} update requires a model, provider, or reasoning effort.`,
      );
    }
    return { reasoningEffort };
  }
  return {
    model,
    ...(provider === undefined ? {} : { provider }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  };
}

export function parseHostedRuntimeAssistantConfigurationToolResponse(
  value: unknown,
): HostedRuntimeAssistantConfigurationToolResponse {
  const record = requireObject(
    value,
    "Hosted runtime assistant configuration tool response",
  );
  assertAllowedObjectKeys(
    record,
    new Set(["action", "result"]),
    "Hosted runtime assistant configuration tool response",
  );
  const action = requireString(
    record.action,
    "Hosted runtime assistant configuration tool response action",
  );
  const result = requireObject(
    record.result,
    "Hosted runtime assistant configuration tool response result",
  );
  if (action === "read") {
    return {
      action,
      result: parseHostedRuntimeAssistantConfigurationSnapshot(result, {
        extraKeys: [],
      }),
    };
  }
  if (action !== "update") {
    throw new TypeError(
      "Hosted runtime assistant configuration tool response action is not supported.",
    );
  }

  const snapshot = parseHostedRuntimeAssistantConfigurationSnapshot(result, {
    extraKeys: ["appliesAt", "requiredPlan", "status"],
  });
  const appliesAt = requireString(
    result.appliesAt,
    "Hosted runtime assistant configuration tool appliesAt",
  );
  if (appliesAt !== "next_turn") {
    throw new TypeError(
      "Hosted runtime assistant configuration tool appliesAt is not supported.",
    );
  }
  const requiredPlan = result.requiredPlan === null
    ? null
    : requireString(
        result.requiredPlan,
        "Hosted runtime assistant configuration tool requiredPlan",
      );
  if (requiredPlan !== null && requiredPlan !== "edge") {
    throw new TypeError(
      "Hosted runtime assistant configuration tool requiredPlan is not supported.",
    );
  }

  return {
    action,
    result: {
      ...snapshot,
      appliesAt,
      requiredPlan,
      status: parseHostedRuntimeAssistantConfigurationUpdateStatus(
        result.status,
      ),
    },
  };
}

function parseHostedRuntimeAssistantConfigurationSnapshot(
  record: Record<string, unknown>,
  options: { extraKeys: readonly string[] },
): HostedRuntimeAssistantConfigurationSnapshot {
  assertAllowedObjectKeys(
    record,
    new Set([
      "availableModels",
      "availableProviders",
      "availableReasoningEfforts",
      "configurationAvailable",
      "dormantSolPreference",
      "model",
      "provider",
      "reasoningEffort",
      "solAvailable",
      ...options.extraKeys,
    ]),
    "Hosted runtime assistant configuration tool response result",
  );
  const availableModels = requireArray(
    record.availableModels,
    "Hosted runtime assistant configuration availableModels",
  ).map((model) => parseHostedRuntimeAssistantProductModel(
    model,
    "Hosted runtime assistant configuration available model",
  ));
  const configurationAvailable = requireBoolean(
    record.configurationAvailable,
    "Hosted runtime assistant configuration configurationAvailable",
  );
  const hasAvailableProviders = Object.hasOwn(record, "availableProviders");
  const hasProvider = Object.hasOwn(record, "provider");
  if (hasAvailableProviders !== hasProvider) {
    throw new TypeError(
      "Hosted runtime assistant configuration provider fields must be supplied together.",
    );
  }
  const availableProviders = hasAvailableProviders
    ? requireArray(
        record.availableProviders,
        "Hosted runtime assistant configuration availableProviders",
      ).map((provider) => parseHostedRuntimeAssistantProvider(
        provider,
        "Hosted runtime assistant configuration available provider",
      ))
    : configurationAvailable
      ? [HOSTED_ASSISTANT_DEFAULT_PROVIDER]
      : [];
  const availableReasoningEfforts = requireArray(
    record.availableReasoningEfforts,
    "Hosted runtime assistant configuration availableReasoningEfforts",
  ).map((effort) => parseHostedRuntimeAssistantReasoningEffort(
    effort,
    "Hosted runtime assistant configuration available reasoning effort",
  ));

  return {
    availableModels,
    availableProviders,
    availableReasoningEfforts,
    configurationAvailable,
    dormantSolPreference: requireBoolean(
      record.dormantSolPreference,
      "Hosted runtime assistant configuration dormantSolPreference",
    ),
    model: parseHostedRuntimeAssistantProductModel(
      record.model,
      "Hosted runtime assistant configuration model",
    ),
    provider: hasProvider
      ? parseHostedRuntimeAssistantProvider(
          record.provider,
          "Hosted runtime assistant configuration provider",
        )
      : HOSTED_ASSISTANT_DEFAULT_PROVIDER,
    reasoningEffort: parseHostedRuntimeAssistantReasoningEffort(
      record.reasoningEffort,
      "Hosted runtime assistant configuration reasoningEffort",
    ),
    solAvailable: requireBoolean(
      record.solAvailable,
      "Hosted runtime assistant configuration solAvailable",
    ),
  };
}

function parseHostedRuntimeAssistantProvider(value: unknown, label: string) {
  if (!isHostedAssistantProvider(value)) {
    throw new TypeError(`${label} is not supported.`);
  }
  return value;
}

function parseHostedRuntimeAssistantProductModel(value: unknown, label: string) {
  if (!isHostedAssistantProductModel(value)) {
    throw new TypeError(`${label} is not supported.`);
  }
  return value;
}

function parseHostedRuntimeAssistantReasoningEffort(
  value: unknown,
  label: string,
) {
  if (!isHostedAssistantReasoningEffort(value)) {
    throw new TypeError(`${label} is not supported.`);
  }
  return value;
}

function parseHostedRuntimeAssistantConfigurationUpdateStatus(
  value: unknown,
): HostedRuntimeAssistantConfigurationUpdateStatus {
  const status = requireString(
    value,
    "Hosted runtime assistant configuration tool status",
  );
  if (
    status !== "unchanged" &&
    status !== "unavailable" &&
    status !== "updated" &&
    status !== "upgrade_required"
  ) {
    throw new TypeError(
      "Hosted runtime assistant configuration tool status is not supported.",
    );
  }
  return status;
}

function parseHostedRuntimeFamilyPlanInviteRequest(
  value: unknown,
  label: string,
) {
  const invite = requireObject(value, label);
  assertAllowedObjectKeys(
    invite,
    new Set([
      "planCode",
      "targetEmail",
      "targetLabel",
      "targetPhoneNumber",
      "targetTelegramUsername",
    ]),
    label,
  );
  const targetEmail = readOptionalNullableString(
    invite.targetEmail,
    "Hosted runtime family plan invite targetEmail",
  );
  const targetLabel = readOptionalNullableString(
    invite.targetLabel,
    "Hosted runtime family plan invite targetLabel",
  );
  const targetPhoneNumber = readOptionalNullableString(
    invite.targetPhoneNumber,
    "Hosted runtime family plan invite targetPhoneNumber",
  );
  const targetTelegramUsername = readOptionalNullableString(
    invite.targetTelegramUsername,
    "Hosted runtime family plan invite targetTelegramUsername",
  );
  if (!targetPhoneNumber && !targetTelegramUsername && !targetEmail) {
    throw new TypeError(
      "Hosted runtime family plan invite requires a phone number, Telegram username, or email.",
    );
  }

  return {
    ...(invite.planCode === undefined
      ? {}
      : { planCode: parseHostedRuntimePlanCode(invite.planCode) }),
    ...(targetEmail === undefined ? {} : { targetEmail }),
    targetLabel,
    targetPhoneNumber,
    targetTelegramUsername,
  };
}

export function parseHostedRuntimeFamilyPlanToolResponse(
  value: unknown,
): HostedRuntimeFamilyPlanToolResponse {
  const record = requireObject(value, "Hosted runtime family plan tool response");
  const action = requireString(
    record.action,
    "Hosted runtime family plan tool response action",
  );
  if (action === "read_status") {
    assertAllowedObjectKeys(
      record,
      new Set(["action", "result"]),
      "Hosted runtime family plan tool read_status response",
    );
    return {
      action,
      result: parseHostedRuntimeFamilyPlanStatusResponse(record.result),
    };
  }
  if (action === "create_invite") {
    assertAllowedObjectKeys(
      record,
      new Set(["action", "result"]),
      "Hosted runtime family plan tool create_invite response",
    );
    const result = requireObject(
      record.result,
      "Hosted runtime family plan tool create_invite response result",
    );
    assertAllowedObjectKeys(
      result,
      new Set(["invite", "plans", "replyText", "seats"]),
      "Hosted runtime family plan tool create_invite response result",
    );
    const seats = parseHostedRuntimeFamilyPlanSeatStatus(result.seats);
    return {
      action,
      result: {
        invite: parseHostedRuntimeFamilyPlanInvite(result.invite),
        plans: parseHostedRuntimeFamilyPlanPlans(result.plans, seats),
        replyText: requireString(
          result.replyText,
          "Hosted runtime family plan invite replyText",
        ),
        seats,
      },
    };
  }
  if (action === "start_checkout") {
    assertAllowedObjectKeys(
      record,
      new Set(["action", "result"]),
      "Hosted runtime family plan tool start_checkout response",
    );
    return {
      action,
      result: parseHostedRuntimeFamilyPlanStartCheckoutResponse(record.result),
    };
  }
  throw new TypeError("Hosted runtime family plan tool response action is not supported.");
}

export function parseHostedCodexAuthUpdate(
  value: unknown,
): HostedCodexAuthUpdate {
  const record = requireObject(value, "Hosted Codex auth update");
  const phase = requireString(record.phase, "Hosted Codex auth update phase");
  const attemptId = parseHostedCodexAuthAttemptId(record.attemptId);

  if (phase === "device_code") {
    assertAllowedObjectKeys(
      record,
      new Set(["attemptId", "phase", "userCode", "verificationUrl"]),
      "Hosted Codex auth device-code update",
    );
    const userCode = requireString(record.userCode, "Hosted Codex auth update userCode");
    if (userCode.length > 128) {
      throw new TypeError("Hosted Codex auth update userCode is too long.");
    }
    const verificationUrl = requireString(
      record.verificationUrl,
      "Hosted Codex auth update verificationUrl",
    );
    assertHostedCodexAuthVerificationUrl(verificationUrl);
    return {
      attemptId,
      phase,
      userCode,
      verificationUrl,
    };
  }

  if (phase === "connected" || phase === "disconnected" || phase === "failed") {
    assertAllowedObjectKeys(
      record,
      new Set(["attemptId", "phase"]),
      "Hosted Codex auth terminal update",
    );
    return { attemptId, phase };
  }

  throw new TypeError("Hosted Codex auth update phase is not supported.");
}

export function parseHostedCodexAuthUpdateResponse(
  value: unknown,
): HostedCodexAuthUpdateResponse {
  const record = requireObject(value, "Hosted Codex auth update response");
  assertAllowedObjectKeys(
    record,
    new Set(["applied", "status"]),
    "Hosted Codex auth update response",
  );
  const applied = requireBoolean(record.applied, "Hosted Codex auth update response applied");
  const status = record.status === undefined
    ? applied ? "applied" : "superseded"
    : parseHostedCodexAuthUpdateResponseStatus(record.status);
  if ((status === "superseded") === applied) {
    throw new TypeError("Hosted Codex auth update response status conflicts with applied.");
  }
  return {
    applied,
    status,
  };
}

function parseHostedCodexAuthUpdateResponseStatus(
  value: unknown,
): HostedCodexAuthUpdateResponseStatus {
  const status = requireString(value, "Hosted Codex auth update response status");
  if (HOSTED_CODEX_AUTH_UPDATE_RESPONSE_STATUSES.includes(
    status as HostedCodexAuthUpdateResponseStatus,
  )) {
    return status as HostedCodexAuthUpdateResponseStatus;
  }
  throw new TypeError("Hosted Codex auth update response status is not supported.");
}

function parseHostedCodexAuthAttemptId(value: unknown): string {
  const attemptId = requireString(value, "Hosted Codex auth update attemptId");
  if (!/^hca_[A-Za-z0-9_-]{16,64}$/u.test(attemptId)) {
    throw new TypeError("Hosted Codex auth update attemptId is invalid.");
  }
  return attemptId;
}

function assertHostedCodexAuthVerificationUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Hosted Codex auth verificationUrl must be an absolute URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new TypeError("Hosted Codex auth verificationUrl must use HTTPS without credentials.");
  }
  if (url.hostname !== "auth.openai.com") {
    throw new TypeError("Hosted Codex auth verificationUrl must use the OpenAI auth host.");
  }
}

function parseHostedRuntimeLinqExternalThreadRouteAuthority(
  value: unknown,
  label: string,
): HostedExecutionLinqExternalThreadRouteAuthority {
  const record = requireObject(value, label);
  assertAllowedObjectKeys(
    record,
    new Set(["accountLookupKey", "channel", "containerMemberId", "threadId"]),
    label,
  );
  const channel = requireString(record.channel, `${label} channel`);
  if (channel !== "linq") {
    throw new TypeError(`${label} channel must be linq.`);
  }

  // Phase 1 deploy skew: readers tolerate missing accountLookupKey while
  // emitters keep sending it until both web and runner readers are rolled out.
  return {
    ...(record.accountLookupKey === undefined
      ? {}
      : {
          accountLookupKey: readOptionalNullableString(
            record.accountLookupKey,
            `${label} accountLookupKey`,
          ),
        }),
    channel,
    containerMemberId: requireString(record.containerMemberId, `${label} containerMemberId`),
    threadId: requireString(record.threadId, `${label} threadId`),
  };
}

function parseHostedProductFeedbackKind(value: unknown): HostedProductFeedbackKind {
  const kind = requireString(value, "Hosted runtime product feedback kind");
  if (!HOSTED_PRODUCT_FEEDBACK_KINDS.includes(kind as HostedProductFeedbackKind)) {
    throw new TypeError("Hosted runtime product feedback kind is not supported.");
  }
  return kind as HostedProductFeedbackKind;
}

function parseHostedProductFeedbackSummary(value: unknown): string {
  const summary = sanitizeHostedProductFeedbackSummary(
    requireString(value, "Hosted runtime product feedback summary"),
  );
  if (
    summary.length === 0 ||
    summary.length > HOSTED_PRODUCT_FEEDBACK_SUMMARY_MAX_LENGTH
  ) {
    throw new TypeError(
      `Hosted runtime product feedback summary must be between 1 and ${HOSTED_PRODUCT_FEEDBACK_SUMMARY_MAX_LENGTH} characters.`,
    );
  }
  return summary;
}

function parseHostedProductFeedbackSlugArray(
  value: readonly string[],
  options: {
    itemLabel: string;
    label: string;
    maxLength: number;
  },
): string[] {
  const entries = value.map((entry, index) => {
    const slug = requireString(entry, `${options.itemLabel}[${index}]`);
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug) ||
      slug.length > options.maxLength
    ) {
      throw new TypeError(`${options.itemLabel} must be a lowercase slug.`);
    }
    return slug;
  });
  if (entries.length > 7 || new Set(entries).size !== entries.length) {
    throw new TypeError(`${options.label} must contain at most seven unique items.`);
  }
  return entries;
}

function parseHostedRuntimeFamilyPlanStatusResponse(
  value: unknown,
): HostedRuntimeFamilyPlanToolStatusResponse {
  const record = requireObject(value, "Hosted runtime family plan status response");
  assertAllowedObjectKeys(
    record,
    new Set([
      "billingActive",
      "billingStatus",
      "members",
      "owner",
      "pendingInvites",
      "plans",
      "seats",
    ]),
    "Hosted runtime family plan status response",
  );

  const seats = parseHostedRuntimeFamilyPlanSeatStatus(record.seats);
  return {
    billingActive: requireBoolean(
      record.billingActive,
      "Hosted runtime family plan status billingActive",
    ),
    billingStatus: requireString(
      record.billingStatus,
      "Hosted runtime family plan status billingStatus",
    ),
    members: requireArray(
      record.members,
      "Hosted runtime family plan status members",
    ).map(parseHostedRuntimeFamilyPlanMember),
    owner: requireBoolean(
      record.owner,
      "Hosted runtime family plan status owner",
    ),
    pendingInvites: requireArray(
      record.pendingInvites,
      "Hosted runtime family plan status pendingInvites",
    ).map(parseHostedRuntimeFamilyPlanInvite),
    plans: parseHostedRuntimeFamilyPlanPlans(record.plans, seats),
    seats,
  };
}

function parseHostedRuntimeFamilyPlanStartCheckoutResponse(
  value: unknown,
): HostedRuntimeFamilyPlanToolStartCheckoutResponse {
  const record = requireObject(
    value,
    "Hosted runtime family plan tool start_checkout response result",
  );
  assertAllowedObjectKeys(
    record,
    new Set([
      "alreadyActive",
      "billingActive",
      "billingStatus",
      "checkoutUrl",
      "owner",
      "preparedInvite",
      "preparedInviteReplyText",
      "plans",
      "seats",
      "unavailableReason",
    ]),
    "Hosted runtime family plan tool start_checkout response result",
  );
  const unavailableReason = readOptionalNullableString(
    record.unavailableReason,
    "Hosted runtime family plan start_checkout unavailableReason",
  );
  if (unavailableReason !== null && unavailableReason !== "already_sponsored") {
    throw new TypeError(
      "Hosted runtime family plan start_checkout unavailableReason is not supported.",
    );
  }

  const seats = parseHostedRuntimeFamilyPlanSeatStatus(record.seats);
  return {
    alreadyActive: requireBoolean(
      record.alreadyActive,
      "Hosted runtime family plan start_checkout alreadyActive",
    ),
    billingActive: requireBoolean(
      record.billingActive,
      "Hosted runtime family plan start_checkout billingActive",
    ),
    billingStatus: requireString(
      record.billingStatus,
      "Hosted runtime family plan start_checkout billingStatus",
    ),
    checkoutUrl: readNullableString(
      record.checkoutUrl,
      "Hosted runtime family plan start_checkout checkoutUrl",
    ),
    owner: requireBoolean(
      record.owner,
      "Hosted runtime family plan start_checkout owner",
    ),
    preparedInvite: record.preparedInvite === null || record.preparedInvite === undefined
      ? null
      : parseHostedRuntimeFamilyPlanInvite(record.preparedInvite),
    preparedInviteReplyText: readNullableString(
      record.preparedInviteReplyText,
      "Hosted runtime family plan start_checkout preparedInviteReplyText",
    ),
    plans: parseHostedRuntimeFamilyPlanPlans(record.plans, seats),
    seats,
    unavailableReason,
  };
}

function parseHostedRuntimeFamilyPlanSeatStatus(value: unknown) {
  const record = requireObject(value, "Hosted runtime family plan seat status");
  assertAllowedObjectKeys(
    record,
    new Set(["active", "billed", "invited", "max", "min", "remaining", "used"]),
    "Hosted runtime family plan seat status",
  );

  return {
    active: requireNumber(record.active, "Hosted runtime family plan seats active"),
    billed: requireNumber(record.billed, "Hosted runtime family plan seats billed"),
    invited: requireNumber(record.invited, "Hosted runtime family plan seats invited"),
    max: requireNumber(record.max, "Hosted runtime family plan seats max"),
    min: requireNumber(record.min, "Hosted runtime family plan seats min"),
    remaining: requireNumber(
      record.remaining,
      "Hosted runtime family plan seats remaining",
    ),
    used: requireNumber(record.used, "Hosted runtime family plan seats used"),
  };
}

function parseHostedRuntimeFamilyPlanPlans(
  value: unknown,
  legacySeats: ReturnType<typeof parseHostedRuntimeFamilyPlanSeatStatus>,
) {
  if (value === undefined) {
    return {
      edge: { active: 0, billed: 0, invited: 0, remaining: 0, used: 0 },
      pulse: {
        active: legacySeats.active,
        billed: legacySeats.billed,
        invited: legacySeats.invited,
        remaining: legacySeats.remaining,
        used: legacySeats.used,
      },
    };
  }
  const record = requireObject(value, "Hosted runtime family plan plans");
  return Object.fromEntries(HOSTED_PLAN_CODES.map((planCode) => {
    const status = requireObject(
      record[planCode],
      `Hosted runtime family plan ${planCode} status`,
    );
    assertAllowedObjectKeys(
      status,
      new Set(["active", "billed", "invited", "remaining", "used"]),
      `Hosted runtime family plan ${planCode} status`,
    );
    return [planCode, {
      active: requireNumber(status.active, `Hosted runtime family plan ${planCode} active`),
      billed: requireNumber(status.billed, `Hosted runtime family plan ${planCode} billed`),
      invited: requireNumber(status.invited, `Hosted runtime family plan ${planCode} invited`),
      remaining: requireNumber(
        status.remaining,
        `Hosted runtime family plan ${planCode} remaining`,
      ),
      used: requireNumber(status.used, `Hosted runtime family plan ${planCode} used`),
    }];
  })) as Record<HostedPlanCode, {
    active: number;
    billed: number;
    invited: number;
    remaining: number;
    used: number;
  }>;
}

function parseHostedRuntimePlanCode(value: unknown): HostedPlanCode {
  const planCode = requireString(value, "Hosted runtime Family plan code");
  if (HOSTED_PLAN_CODES.includes(planCode as HostedPlanCode)) {
    return planCode as HostedPlanCode;
  }
  throw new TypeError("Hosted runtime Family plan code is not supported.");
}

function parseHostedRuntimeFamilyPlanMember(value: unknown) {
  const record = requireObject(value, "Hosted runtime family plan member");
  assertAllowedObjectKeys(
    record,
    new Set(["isOwner", "label", "planCode", "role", "status"]),
    "Hosted runtime family plan member",
  );

  return {
    isOwner: requireBoolean(
      record.isOwner,
      "Hosted runtime family plan member isOwner",
    ),
    label: readNullableString(
      record.label,
      "Hosted runtime family plan member label",
    ),
    planCode: record.planCode === undefined
      ? "pulse" as const
      : parseHostedRuntimePlanCode(record.planCode),
    role: requireString(record.role, "Hosted runtime family plan member role"),
    status: requireString(record.status, "Hosted runtime family plan member status"),
  };
}

function parseHostedRuntimeFamilyPlanInvite(value: unknown) {
  const record = requireObject(value, "Hosted runtime family plan invite");
  assertAllowedObjectKeys(
    record,
    new Set([
      "acceptUrl",
      "expiresAt",
      "planCode",
      "status",
      "targetLabel",
      "targetPhoneHint",
      "telegramInviteUrl",
    ]),
    "Hosted runtime family plan invite",
  );

  return {
    acceptUrl: readNullableString(
      record.acceptUrl,
      "Hosted runtime family plan invite acceptUrl",
    ),
    expiresAt: requireString(
      record.expiresAt,
      "Hosted runtime family plan invite expiresAt",
    ),
    planCode: record.planCode === undefined
      ? "pulse" as const
      : parseHostedRuntimePlanCode(record.planCode),
    status: requireString(record.status, "Hosted runtime family plan invite status"),
    targetLabel: readNullableString(
      record.targetLabel,
      "Hosted runtime family plan invite targetLabel",
    ),
    targetPhoneHint: readNullableString(
      record.targetPhoneHint,
      "Hosted runtime family plan invite targetPhoneHint",
    ),
    telegramInviteUrl: readNullableString(
      record.telegramInviteUrl,
      "Hosted runtime family plan invite telegramInviteUrl",
    ),
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
    case "assistant_milestone":
      return parseHostedRuntimeLatencyTraceAssistantMilestoneEvent(record);
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
    ...readOptionalHostedRuntimeLatencyPhaseBreakdown(record),
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

function requireOptionalNonNegativeInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
): Record<string, number> {
  if (record[key] === undefined) {
    return {};
  }

  return { [key]: requireNonNegativeInteger(record[key], `${label}.${key}`) };
}

function requireOptionalBoolean(
  record: Record<string, unknown>,
  key: string,
  label: string,
): Record<string, boolean> {
  if (record[key] === undefined) {
    return {};
  }

  return { [key]: requireBoolean(record[key], `${label}.${key}`) };
}

// phaseBreakdown is best-effort diagnostic telemetry, not a core milestone. Parse
// it leniently: if it is malformed (unknown key, non-number/boolean leaf, or an
// older/newer shape during web/runtime deploy skew) drop only the breakdown rather
// than rejecting the whole latency event and losing the essential milestone
// timestamps. Dropping invalid input is also strictly safer for secret-safety than
// salvaging it.
function readOptionalHostedRuntimeLatencyPhaseBreakdown(
  record: Record<string, unknown>,
): { phaseBreakdown?: HostedRuntimeLatencyPhaseBreakdown } {
  if (record.phaseBreakdown === undefined || record.phaseBreakdown === null) {
    return {};
  }
  try {
    return {
      phaseBreakdown: parseHostedRuntimeLatencyPhaseBreakdown(record.phaseBreakdown),
    };
  } catch {
    return {};
  }
}

// Secret-safety trust boundary: this parser is the only path through which a
// phaseBreakdown reaches storage. It rejects unknown keys and all strings except
// the two exact UUID-shaped direct-wake correlation leaves plus the bounded
// runtime lease generation, so secrets/tokens/paths/URLs cannot ride this
// channel into the trace JSON.
function parseHostedRuntimeLatencyPhaseBreakdown(
  value: unknown,
): HostedRuntimeLatencyPhaseBreakdown {
  const label = "Hosted runtime latency phase breakdown";
  const record = requireObject(value, label);
  assertAllowedObjectKeys(
    record,
    HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_KEY_SET,
    label,
  );

  const breakdown: HostedRuntimeLatencyPhaseBreakdown = {
    schemaVersion: requireNonNegativeInteger(
      record.schemaVersion,
      `${label}.schemaVersion`,
    ),
  };

  if (record.orchestration !== undefined) {
    const orchestrationLabel = `${label}.orchestration`;
    const orchestration = requireObject(record.orchestration, orchestrationLabel);
    assertAllowedObjectKeys(
      orchestration,
      HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEY_SETS.orchestration,
      orchestrationLabel,
    );
    breakdown.orchestration = {
      ...requireOptionalNonNegativeInteger(orchestration, "temporalActivityStartedAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "temporalActivityRequestStartedAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "tokenAcquireStartedAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "tokenAcquiredAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "directEnsureRequestStartedAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "directEnsureResponseReceivedAtEpochMs", orchestrationLabel),
      ...requireOptionalDirectEnsureOrchestrationAttemptId(orchestration, "directEnsureOrchestrationAttemptId", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "runtimeControlAuthStartedAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "runtimeControlAuthFinishedAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "cloudflareRouteReceivedAtEpochMs", orchestrationLabel),
      ...requireOptionalDirectEnsureOrchestrationAttemptId(orchestration, "runtimeInvocationOrchestrationAttemptId", orchestrationLabel),
      ...requireOptionalBoolean(orchestration, "triggeredByWebDirect", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "userRunnerRpcStartedAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "runtimeConsentLockAcquiredAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "healthDataAdmissionReadStartedAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "healthDataAdmissionReadFinishedAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "userRunnerEnsureStartedAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "runnerStateBindStartedAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "runnerStateBindFinishedAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "runnerStateReadStartedAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "runnerStateReadFinishedAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "activeFenceObservedAtEpochMs", orchestrationLabel),
      ...requireOptionalBoolean(orchestration, "activeFenceTargetWasPriorVersion", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "activeWakeStartedAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "activeWakeFinishedAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "activeWakeElapsedMs", orchestrationLabel),
      ...requireOptionalBoolean(orchestration, "activeWakeAccepted", orchestrationLabel),
      ...requireOptionalBoolean(orchestration, "activeWakeFoundNoActiveChild", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "replacementFenceClearStartedAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "replacementFenceClearedAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "replacementFenceClearElapsedMs", orchestrationLabel),
      ...requireOptionalBoolean(orchestration, "replacedStaleFence", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "freshStartRequestedAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "freshStartFenceBoundAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "freshStartContainerReadyAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "freshStartInvocationPreparedAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "freshStartInvocationAcceptedAtEpochMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "workspaceReadElapsedMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "runtimeStoreEnsureElapsedMs", orchestrationLabel),
      ...requireOptionalNonNegativeInteger(orchestration, "runtimeInvocationPreparationElapsedMs", orchestrationLabel),
    };
  }

  if (record.dispatch !== undefined) {
    const dispatchLabel = `${label}.dispatch`;
    const dispatch = requireObject(record.dispatch, dispatchLabel);
    assertAllowedObjectKeys(
      dispatch,
      HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEY_SETS.dispatch,
      dispatchLabel,
    );
    breakdown.dispatch = {
      ...requireOptionalNonNegativeInteger(dispatch, "invokeReceivedAtEpochMs", dispatchLabel),
      ...requireOptionalNonNegativeInteger(dispatch, "containerEnsureReadyStartedAtEpochMs", dispatchLabel),
    };
  }

  if (record.restore !== undefined) {
    const restoreLabel = `${label}.restore`;
    const restore = requireObject(record.restore, restoreLabel);
    assertAllowedObjectKeys(
      restore,
      HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEY_SETS.restore,
      restoreLabel,
    );
    breakdown.restore = {
      ...requireOptionalNonNegativeInteger(restore, "sizeGuardMs", restoreLabel),
      ...requireOptionalNonNegativeInteger(restore, "dataKeyUnwrapMs", restoreLabel),
      ...requireOptionalNonNegativeInteger(restore, "scratchPrepareMs", restoreLabel),
      ...requireOptionalNonNegativeInteger(restore, "presignGetMs", restoreLabel),
      ...requireOptionalNonNegativeInteger(restore, "objectFetchMs", restoreLabel),
      ...requireOptionalNonNegativeInteger(restore, "objectFetchResponseHeadersMs", restoreLabel),
      ...requireOptionalNonNegativeInteger(restore, "objectFetchBodyReadMs", restoreLabel),
      ...requireOptionalNonNegativeInteger(restore, "decryptMs", restoreLabel),
      ...requireOptionalNonNegativeInteger(restore, "archiveExtractMs", restoreLabel),
      ...requireOptionalNonNegativeInteger(restore, "durableRootReplaceMs", restoreLabel),
      ...requireOptionalNonNegativeInteger(restore, "cleanupMs", restoreLabel),
      ...requireOptionalNonNegativeInteger(restore, "extractMs", restoreLabel),
      ...requireOptionalNonNegativeInteger(restore, "encryptedBytes", restoreLabel),
      ...requireOptionalNonNegativeInteger(restore, "plainBytes", restoreLabel),
      ...requireOptionalNonNegativeInteger(
        restore,
        "replaySafeReadMaxAttempt",
        restoreLabel,
      ),
    };
  }

  if (record.boot !== undefined) {
    const bootLabel = `${label}.boot`;
    const boot = requireObject(record.boot, bootLabel);
    assertAllowedObjectKeys(
      boot,
      HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEY_SETS.boot,
      bootLabel,
    );
    breakdown.boot = {
      ...requireOptionalNonNegativeInteger(boot, "nodeStartupMs", bootLabel),
      ...requireOptionalBoolean(boot, "restoreWasCold", bootLabel),
    };
  }

  if (record.wake !== undefined) {
    const wakeLabel = `${label}.wake`;
    const wake = requireObject(record.wake, wakeLabel);
    assertAllowedObjectKeys(
      wake,
      HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEY_SETS.wake,
      wakeLabel,
    );
    breakdown.wake = {
      ...requireOptionalNonNegativeInteger(wake, "runtimeWakeNotifiedAtEpochMs", wakeLabel),
      ...requireOptionalNonNegativeInteger(wake, "foregroundWaitResolvedAtEpochMs", wakeLabel),
      ...requireOptionalNonNegativeInteger(wake, "foregroundImportStartedAtEpochMs", wakeLabel),
      ...requireOptionalNonNegativeInteger(wake, "foregroundWakeOrdinal", wakeLabel),
      ...requireOptionalNonNegativeInteger(wake, "activeRuntimePassOrdinal", wakeLabel),
      ...requireOptionalNonNegativeInteger(wake, "activeRuntimePassStartedAtEpochMs", wakeLabel),
      ...requireOptionalBoolean(wake, "activeRuntimePassForeground", wakeLabel),
    };
  }

  if (record.import !== undefined) {
    const importLabel = `${label}.import`;
    const importBreakdown = requireObject(record.import, importLabel);
    assertAllowedObjectKeys(
      importBreakdown,
      HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEY_SETS.import,
      importLabel,
    );
    breakdown.import = {
      ...requireOptionalNonNegativeInteger(importBreakdown, "decodeStartedAtEpochMs", importLabel),
      ...requireOptionalNonNegativeInteger(importBreakdown, "decodeDoneAtEpochMs", importLabel),
      ...requireOptionalNonNegativeInteger(importBreakdown, "autoReplyPreparedAtEpochMs", importLabel),
      ...requireOptionalNonNegativeInteger(importBreakdown, "pendingIndexEnsuredAtEpochMs", importLabel),
      ...requireOptionalNonNegativeInteger(importBreakdown, "stagedAtEpochMs", importLabel),
    };
  }

  if (record.preProvider !== undefined) {
    const preProviderLabel = `${label}.preProvider`;
    const preProvider = requireObject(record.preProvider, preProviderLabel);
    assertAllowedObjectKeys(
      preProvider,
      HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEY_SETS.preProvider,
      preProviderLabel,
    );
    breakdown.preProvider = {
      ...requireOptionalNonNegativeInteger(preProvider, "mailboxImportDoneToAssistantPhaseMs", preProviderLabel),
      ...requireOptionalNonNegativeInteger(preProvider, "workspaceAssistantPreAutomationMs", preProviderLabel),
      ...requireOptionalNonNegativeInteger(preProvider, "automationLaneToAssistantServiceMs", preProviderLabel),
      ...requireOptionalNonNegativeInteger(preProvider, "executionTargetHydrateMs", preProviderLabel),
      ...requireOptionalNonNegativeInteger(preProvider, "systemMailboxMaintenanceMs", preProviderLabel),
      ...requireOptionalNonNegativeInteger(preProvider, "memberPreferencesPrePlanningMs", preProviderLabel),
      ...requireOptionalNonNegativeInteger(preProvider, "automationBootstrapMs", preProviderLabel),
      ...requireOptionalNonNegativeInteger(preProvider, "outboxScanBytesRead", preProviderLabel),
      ...requireOptionalNonNegativeInteger(preProvider, "outboxScanElapsedMs", preProviderLabel),
      ...requireOptionalNonNegativeInteger(preProvider, "outboxScanFilesRead", preProviderLabel),
      ...requireOptionalBoolean(preProvider, "outboxScanPerformed", preProviderLabel),
      ...requireOptionalNonNegativeInteger(preProvider, "receiptScanBytesRead", preProviderLabel),
      ...requireOptionalNonNegativeInteger(preProvider, "receiptScanElapsedMs", preProviderLabel),
      ...requireOptionalNonNegativeInteger(preProvider, "receiptScanFilesRead", preProviderLabel),
      ...requireOptionalNonNegativeInteger(preProvider, "receiptScanLockWaitMs", preProviderLabel),
      ...requireOptionalBoolean(preProvider, "receiptScanPerformed", preProviderLabel),
    };
  }

  if (record.assistant !== undefined) {
    const assistantLabel = `${label}.assistant`;
    const assistant = requireObject(record.assistant, assistantLabel);
    assertAllowedObjectKeys(
      assistant,
      HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEY_SETS.assistant,
      assistantLabel,
    );
    breakdown.assistant = {
      ...requireOptionalNonNegativeInteger(assistant, "linqTypingRequestStartedAtEpochMs", assistantLabel),
      ...requireOptionalNonNegativeInteger(assistant, "linqTypingAcceptedAtEpochMs", assistantLabel),
      ...requireOptionalNonNegativeInteger(assistant, "firstCodexOutputObservedAtEpochMs", assistantLabel),
      ...requireOptionalNonNegativeInteger(assistant, "firstCodexTextObservedAtEpochMs", assistantLabel),
      ...requireOptionalNonNegativeInteger(assistant, "terminalNonReplyCommittedAtEpochMs", assistantLabel),
      ...requireOptionalNonNegativeInteger(assistant, "checkpointPublicationExpectedByEpochMs", assistantLabel),
      ...(assistant.runtimeLeaseGeneration === undefined
        ? {}
        : {
            runtimeLeaseGeneration: requireCanonicalRuntimeLeaseGeneration(
              assistant.runtimeLeaseGeneration,
              `${assistantLabel}.runtimeLeaseGeneration`,
            ),
          }),
    };
  }

  if (record.provider !== undefined) {
    const providerLabel = `${label}.provider`;
    const provider = requireObject(record.provider, providerLabel);
    assertAllowedObjectKeys(
      provider,
      HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_LEAF_KEY_SETS.provider,
      providerLabel,
    );
    breakdown.provider = {
      ...requireOptionalNonNegativeInteger(provider, "assistantServicePreLockMs", providerLabel),
      ...requireOptionalNonNegativeInteger(provider, "codexAppServerInitializeMs", providerLabel),
      ...requireOptionalNonNegativeInteger(provider, "codexAppServerPreProviderMs", providerLabel),
      ...requireOptionalNonNegativeInteger(provider, "codexAppServerSpawnReadyMs", providerLabel),
      ...requireOptionalNonNegativeInteger(provider, "codexAppServerThreadResumeMs", providerLabel),
      ...requireOptionalNonNegativeInteger(provider, "codexAppServerThreadStartMs", providerLabel),
      ...requireOptionalNonNegativeInteger(provider, "codexAppServerWarmReuseMs", providerLabel),
      ...requireOptionalNonNegativeInteger(provider, "codexProcessPreparationMs", providerLabel),
      ...requireOptionalNonNegativeInteger(provider, "turnLockWaitMs", providerLabel),
      ...requireOptionalNonNegativeInteger(provider, "sessionResolveMs", providerLabel),
      ...requireOptionalNonNegativeInteger(provider, "promptBuildMs", providerLabel),
      ...requireOptionalNonNegativeInteger(provider, "admissionMs", providerLabel),
      ...requireOptionalNonNegativeInteger(provider, "preProviderSetupMs", providerLabel),
      ...requireOptionalNonNegativeInteger(provider, "providerPlanAndGateMs", providerLabel),
      ...requireOptionalNonNegativeInteger(provider, "linqEgressGuardMs", providerLabel),
    };
  }

  return breakdown;
}

function requireOptionalDirectEnsureOrchestrationAttemptId<
  Key extends "directEnsureOrchestrationAttemptId" | "runtimeInvocationOrchestrationAttemptId",
>(
  record: Record<string, unknown>,
  key: Key,
  label: string,
): Partial<Record<Key, string>> {
  const value = record[key];
  if (value === undefined) {
    return {};
  }
  if (!isHostedRuntimeDirectEnsureOrchestrationAttemptId(value)) {
    throw new TypeError(`${label}.${key} must be a direct-wake orchestration attempt id.`);
  }
  return { [key]: value } as Record<Key, string>;
}

function parseHostedRuntimeLatencyTraceProviderStartedEvent(
  record: Record<string, unknown>,
): HostedRuntimeLatencyTraceProviderStartedEvent {
  assertAllowedObjectKeys(
    record,
    HOSTED_RUNTIME_LATENCY_TRACE_PROVIDER_STARTED_KEYS,
    "Hosted runtime latency trace provider_started event",
  );
  const assistantInputIds = parseHostedRuntimeLatencyTraceAssistantInputIds(record);

  return {
    assistantInputIds,
    at: requireString(record.at, "Hosted runtime latency trace at"),
    ...readOptionalHostedRuntimeLatencyPhaseBreakdown(record),
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

function parseHostedRuntimeAssistantMilestone(value: unknown): HostedRuntimeAssistantMilestone {
  return parseAllowedString(
    value,
    "Hosted runtime assistant milestone",
    HOSTED_RUNTIME_ASSISTANT_MILESTONES,
  );
}

function parseHostedRuntimeLatencyTraceAssistantMilestoneEvent(
  record: Record<string, unknown>,
): HostedRuntimeLatencyTraceAssistantMilestoneEvent {
  assertAllowedObjectKeys(
    record,
    HOSTED_RUNTIME_LATENCY_TRACE_ASSISTANT_MILESTONE_KEYS,
    "Hosted runtime latency trace assistant_milestone event",
  );
  const milestone = parseHostedRuntimeAssistantMilestone(record.milestone);
  const checkpointPublicationExpectedBy =
    record.checkpointPublicationExpectedBy === undefined
      ? undefined
      : readNullableString(
          record.checkpointPublicationExpectedBy,
          "Hosted runtime latency trace checkpointPublicationExpectedBy",
        );
  if (
    checkpointPublicationExpectedBy !== undefined
    && checkpointPublicationExpectedBy !== null
    && milestone !== "terminal_non_reply_committed"
  ) {
    throw new TypeError(
      "Hosted runtime latency trace checkpointPublicationExpectedBy requires terminal_non_reply_committed.",
    );
  }

  return {
    assistantInputIds: parseHostedRuntimeLatencyTraceAssistantInputIds(record),
    at: requireString(record.at, "Hosted runtime latency trace at"),
    ...(checkpointPublicationExpectedBy === undefined
      ? {}
      : { checkpointPublicationExpectedBy }),
    milestone,
    ...(record.runtimeAttemptId === undefined
      ? {}
      : {
          runtimeAttemptId: readNullableString(
            record.runtimeAttemptId,
            "Hosted runtime latency trace runtimeAttemptId",
          ),
        }),
    source: parseHostedIngressLatencySource(record.source),
    type: "assistant_milestone",
  };
}

function parseHostedRuntimeLatencyTraceAssistantInputIds(
  record: Record<string, unknown>,
): string[] {
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
  return assistantInputIds;
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
    ...(record.inboxMediaRetentionWakeAt === undefined
      ? {}
      : {
          inboxMediaRetentionWakeAt: readNullableString(
            record.inboxMediaRetentionWakeAt,
            "Hosted workspace state inboxMediaRetentionWakeAt",
          ),
        }),
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
            HOSTED_CANONICAL_WRITE_RECEIPT_REDACTED_STATUS_KEY_SET,
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
  const hostedAssistantCustomInferenceOverride =
    record.hostedAssistantCustomInferenceOverride === undefined
      || record.hostedAssistantCustomInferenceOverride === null
      ? null
      : parseHostedAssistantCustomInferenceOverride(
          record.hostedAssistantCustomInferenceOverride,
        );
  const hostedAssistantModelOverride = parseHostedAssistantModelOverride(
    record.hostedAssistantModelOverride,
  );
  const hostedAssistantProviderOverride = parseHostedAssistantProviderOverride(
    record.hostedAssistantProviderOverride,
  );
  const hostedAssistantReasoningEffortOverride =
    parseHostedAssistantReasoningEffortOverride(
      record.hostedAssistantReasoningEffortOverride,
    );
  const platformAiUsageAllowed = record.platformAiUsageAllowed === undefined
    ? null
    : requireBoolean(
        record.platformAiUsageAllowed,
        "Hosted workspace read response platformAiUsageAllowed",
      );

  return {
    fetchedAt: requireString(record.fetchedAt, "Hosted workspace read response fetchedAt"),
    ...(hostedAssistantCustomInferenceOverride
      ? { hostedAssistantCustomInferenceOverride }
      : {}),
    ...(hostedAssistantModelOverride
      ? { hostedAssistantModelOverride }
      : {}),
    ...(hostedAssistantProviderOverride
      ? { hostedAssistantProviderOverride }
      : {}),
    ...(hostedAssistantReasoningEffortOverride
      ? { hostedAssistantReasoningEffortOverride }
      : {}),
    ...(platformAiUsageAllowed === null ? {} : { platformAiUsageAllowed }),
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
    ...(record.handledConversationMailboxItemIds === undefined
      ? {}
      : {
          handledConversationMailboxItemIds:
            parseHostedWorkspaceCheckpointHandledConversationMailboxItemIds(
              record.handledConversationMailboxItemIds,
            ),
        }),
    ...(record.idleCheckpointTrigger === undefined
      ? {}
      : {
          idleCheckpointTrigger: parseHostedIdleCheckpointTrigger(
            record.idleCheckpointTrigger,
          ),
        }),
    leaseGeneration: requireNonNegativeBigIntString(
      record.leaseGeneration,
      "Hosted workspace checkpoint request leaseGeneration",
    ),
    ...(record.inboxMediaRetentionWakeAt === undefined
      ? {}
      : {
          inboxMediaRetentionWakeAt: readNullableString(
            record.inboxMediaRetentionWakeAt,
            "Hosted workspace checkpoint request inboxMediaRetentionWakeAt",
          ),
        }),
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
            HOSTED_CANONICAL_WRITE_RECEIPT_REDACTED_STATUS_KEY_SET,
          ),
        }),
    ...(record.runtimeWakePendingAtCheckpoint === undefined
      ? {}
      : {
          runtimeWakePendingAtCheckpoint: requireBoolean(
            record.runtimeWakePendingAtCheckpoint,
            "Hosted workspace checkpoint request runtimeWakePendingAtCheckpoint",
          ),
        }),
    snapshotRef: parseHostedExecutionSnapshotRef(
      record.snapshotRef === undefined ? null : record.snapshotRef,
      "Hosted workspace checkpoint request snapshotRef",
    ),
  };
}

function parseHostedWorkspaceCheckpointHandledConversationMailboxItemIds(
  value: unknown,
): string[] {
  const itemIds = requireArray(
    value,
    "Hosted workspace checkpoint handledConversationMailboxItemIds",
  ).map((entry, index) => {
    const itemId = requireString(
      entry,
      `Hosted workspace checkpoint handledConversationMailboxItemIds[${index}]`,
    );
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,191}$/u.test(itemId)) {
      throw new TypeError(
        `Hosted workspace checkpoint handledConversationMailboxItemIds[${index}] must be a mailbox item id.`,
      );
    }
    return itemId;
  });
  if (
    itemIds.length
      > HOSTED_WORKSPACE_CHECKPOINT_HANDLED_CONVERSATION_ITEM_MAX_IDS
  ) {
    throw new TypeError(
      `Hosted workspace checkpoint handledConversationMailboxItemIds must contain at most ${HOSTED_WORKSPACE_CHECKPOINT_HANDLED_CONVERSATION_ITEM_MAX_IDS} ids.`,
    );
  }
  if (new Set(itemIds).size !== itemIds.length) {
    throw new TypeError(
      "Hosted workspace checkpoint handledConversationMailboxItemIds must not contain duplicates.",
    );
  }
  return itemIds;
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
    ...(record.checkpointConflictReason === undefined
      ? {}
      : {
          checkpointConflictReason: parseNullableAllowedString(
            record.checkpointConflictReason,
            "Hosted workspace checkpoint response checkpointConflictReason",
            HOSTED_WORKSPACE_CHECKPOINT_CONFLICT_REASONS,
          ),
        }),
    ...(record.conversationInputAhead === undefined
      ? {}
      : {
          conversationInputAhead: requireBoolean(
            record.conversationInputAhead,
            "Hosted workspace checkpoint response conversationInputAhead",
          ),
        }),
    ...(record.replacedSnapshotRef === undefined
      ? {}
      : {
          replacedSnapshotRef: parseHostedExecutionSnapshotRef(
            record.replacedSnapshotRef,
            "Hosted workspace checkpoint response replacedSnapshotRef",
          ),
        }),
    workspace: parseHostedWorkspaceState(record.workspace),
  };
}

export function parseHostedBrowserVaultReplicaPublishRequest(
  value: unknown,
): HostedBrowserVaultReplicaPublishRequest {
  const record = requireObject(value, "Hosted browser-vault replica publish request");
  assertAllowedObjectKeys(
    record,
    new Set(["replicaRef"]),
    "Hosted browser-vault replica publish request",
  );
  const replicaRef = parseHostedBrowserVaultReplicaRef(
    record.replicaRef,
    "Hosted browser-vault replica publish request replicaRef",
  );

  if (!replicaRef) {
    throw new TypeError(
      "Hosted browser-vault replica publish request replicaRef must not be null.",
    );
  }

  return {
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

  const parsed: HostedRuntimeLogEntry = {
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

  return normalizeHostedRuntimeFailureLogEntry(parsed);
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

export function parseHostedRuntimeHealthDataAdmissionResponse(
  value: unknown,
): HostedRuntimeHealthDataAdmissionResponse {
  const record = requireObject(
    value,
    "Hosted runtime health-data admission response",
  );
  const consentState = parseAllowedString(
    record.consentState,
    "Hosted runtime health-data admission response consentState",
    HOSTED_HEALTH_DATA_CONSENT_STATES,
  );
  const processingAllowed = requireBoolean(
    record.processingAllowed,
    "Hosted runtime health-data admission response processingAllowed",
  );
  if (processingAllowed && consentState === "revoked") {
    throw new TypeError(
      "Hosted runtime health-data admission response cannot allow processing after consent revocation.",
    );
  }

  return {
    consentState,
    processingAllowed,
    userId: requireString(
      record.userId,
      "Hosted runtime health-data admission response userId",
    ),
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
    ...(record.processingMode === undefined
      ? {}
      : {
          processingMode: parseNullableAllowedString(
            record.processingMode,
            "Hosted workspace invocation request processingMode",
            HOSTED_WORKSPACE_INVOCATION_PROCESSING_MODES,
          ),
        }),
    ...(record.providerEgressToken === undefined
      ? {}
      : {
          providerEgressToken: readNullableString(
            record.providerEgressToken,
            "Hosted workspace invocation request providerEgressToken",
          ),
        }),
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
  if (
    record.immediateRecheckRequested !== undefined
    && record.immediateRecheckRequested !== true
  ) {
    throw new TypeError(
      "Hosted workspace invocation result immediateRecheckRequested must be true when present.",
    );
  }
  const status = parseHostedWorkspaceInvocationStatus(record.status);

  return {
    ...(record.immediateRecheckRequested === true
      ? { immediateRecheckRequested: true as const }
      : {}),
    ...(nextWakeAt === undefined ? {} : { nextWakeAt }),
    ...(nextWakeReason === undefined ? {} : { nextWakeReason }),
    ...(record.redactedStatus === undefined
      ? {}
      : {
          redactedStatus: parseHostedRuntimeRedactedJson(
            record.redactedStatus,
            "Hosted workspace invocation result redactedStatus",
            HOSTED_CANONICAL_WRITE_RECEIPT_REDACTED_STATUS_KEY_SET,
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

function parseHostedIdleCheckpointTrigger(value: unknown): HostedIdleCheckpointTrigger {
  return parseAllowedString(
    value,
    "Hosted idle checkpoint trigger",
    HOSTED_IDLE_CHECKPOINT_TRIGGERS,
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

function parseHostedMailboxLaneConsumed(
  value: unknown,
  label: string,
): HostedMailboxLaneConsumed {
  const record = requireObject(value, label);

  return {
    consumedSeq: requireNonNegativeBigIntString(record.consumedSeq, `${label}.consumedSeq`),
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

function parseNullableAllowedString<T extends string>(
  value: unknown,
  label: string,
  allowed: readonly T[],
): T | null {
  if (value === null || value === undefined) {
    return null;
  }

  return parseAllowedString(value, label, allowed);
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

function requireExactInteger(value: unknown, label: string, expected: number): number {
  const parsed = requireNonNegativeInteger(value, label);
  if (parsed !== expected) {
    throw new TypeError(`${label} must be ${expected}.`);
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

function requireCanonicalRuntimeLeaseGeneration(
  value: unknown,
  label: string,
): string {
  const text = requireString(value, label);
  if (text.length > 20 || !/^(?:0|[1-9]\d*)$/u.test(text)) {
    throw new TypeError(`${label} must be a canonical runtime lease generation.`);
  }
  return text;
}

function readNullableNonNegativeBigIntString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireNonNegativeBigIntString(value, label);
}

export function parseHostedRuntimeRedactedJson(
  value: unknown,
  label: string,
  reservedKeys?: ReadonlySet<string>,
): HostedRuntimeRedactedJson | null {
  if (value === null || value === undefined) {
    return null;
  }

  const record = requireObject(value, label);
  const entries = Object.entries(record);
  const parsed: HostedRuntimeRedactedJson = {};

  const ordinaryEntryCount = reservedKeys
    ? entries.filter(([key]) => !reservedKeys.has(key)).length
    : entries.length;
  if (ordinaryEntryCount > HOSTED_RUNTIME_REDACTED_JSON_MAX_KEYS) {
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

function normalizeHostedRuntimeFailureLogEntry(
  entry: HostedRuntimeLogEntry,
): HostedRuntimeLogEntry {
  const redactedJson = entry.redactedJson ?? null;
  const redactedErrorCode = readHostedRuntimeRedactedStringValue(redactedJson, "errorCode");
  const errorCode = entry.errorCode ?? redactedErrorCode;
  const normalized = errorCode && entry.errorCode !== errorCode
    ? { ...entry, errorCode }
    : entry;

  if (!isHostedRuntimeFailureLogEntry(normalized)) {
    return normalized;
  }

  if (!normalized.errorCode) {
    throw new TypeError(
      "Hosted runtime warn/error failure log entries must include a machine-readable errorCode.",
    );
  }
  if (!hasHostedRuntimeFailureSummary(normalized.redactedJson ?? null)) {
    throw new TypeError(
      "Hosted runtime warn/error failure log entries must include a redacted safe error message, detail, cause, or summary.",
    );
  }

  return normalized;
}

function isHostedRuntimeFailureLogEntry(entry: HostedRuntimeLogEntry): boolean {
  return entry.level === "error"
    || entry.phase === "error"
    || entry.eventCode === "runner.error"
    || entry.eventCode === "checkpoint.snapshot_failed"
    || entry.eventCode === "mailbox.parser_drain_failed"
    || entry.eventCode === "mailbox.parser_jobs_failed"
    || entry.eventCode === "device-sync.job_failed"
    || entry.eventCode === "device-sync.module_load_failed"
    || (entry.eventCode === "assistant.device_connect" && entry.level === "warn")
    || (entry.eventCode === "assistant.automation_detail"
      && entry.level === "warn"
      && Boolean(entry.errorCode));
}

function hasHostedRuntimeFailureSummary(
  redactedJson: HostedRuntimeRedactedJson | null,
): boolean {
  if (!redactedJson) {
    return false;
  }

  for (const [key, value] of Object.entries(redactedJson)) {
    if (isHostedRuntimeFailureSummaryKey(key) && hasHostedRuntimeFailureSummaryValue(value)) {
      return true;
    }
  }

  return false;
}

function isHostedRuntimeFailureSummaryKey(key: string): boolean {
  return key === "safeErrorMessage"
    || key === "safeErrorDetail"
    || key === "safeErrorCause"
    || key === "errorSummary"
    || key === "failureSummary"
    || key === "failureSummaries"
    || /(?:ErrorMessage|ErrorDetail|ErrorCause|ErrorStatusText)$/u.test(key);
}

function hasHostedRuntimeFailureSummaryValue(
  value: HostedRuntimeRedactedValue,
): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => typeof entry === "string" && entry.trim().length > 0);
  }

  return false;
}

function readHostedRuntimeRedactedStringValue(
  redactedJson: HostedRuntimeRedactedJson | null,
  key: string,
): string | null {
  const value = redactedJson?.[key];
  if (typeof value !== "string") {
    return null;
  }

  assertSafeHostedRuntimeLogString(value, `Hosted runtime log entry redactedJson.${key}`);
  return value;
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

  if (
    /\/Users\/|file:\/\/|[A-Za-z]:\\|<HOME_DIR>|(^|[\s("'])\/(?:Users|home|root|tmp|var|private|mnt|app)\/[^\s)"']+/u
      .test(value)
  ) {
    throw new TypeError(`${label} must not contain a local filesystem path.`);
  }
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(value)) {
    throw new TypeError(`${label} must not contain an email address.`);
  }
  if (/\bhttps?:\/\//iu.test(value)) {
    throw new TypeError(`${label} must not contain a URL.`);
  }
  if (/(?:\+\d[\d().\s-]{7,}\d|\(\d{3}\)\s*\d{3}[-.\s]\d{4}\b|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b)/u.test(value)) {
    throw new TypeError(`${label} must not contain a phone number.`);
  }
  if (HOSTED_RUNTIME_DIRECT_ID_TEXT_PATTERNS.some((pattern) => pattern.test(value))) {
    throw new TypeError(`${label} must not contain a direct identifier.`);
  }
  if (
    /(["']?(?:authorization|secret|token|password|cookie|set-cookie|api[-_]?key)["']?\s*[:=]\s*)(?!(?:(?:Basic|Bearer)\s+)?\[redacted\](?=$|\s|[,.;:)}\]](?=$|\s)))["']?([^"',\s}]+)/iu
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
