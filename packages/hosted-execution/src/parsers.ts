import {
  parseHostedVaultShareDeliveryPayload,
  parseHostedVaultShareRevokePayload,
} from "./vault-share.ts";
import {
  buildHostedExecutionVaultShareDeliveryWake,
  buildHostedExecutionVaultShareRevokeWake,
} from "./builders.ts";
import {
  assistantPersonalitySettingIds,
  getEnvironmentInterviewTopicGroup,
  isAssistantPersonalityScore,
  isAssistantPersonalitySettingId,
  isAssistantTonePreference,
  isAssistantVoiceOptionId,
  normalizeStoredAssistantPersonaId,
  normalizeIanaTimeZone,
  parseMemberActionRequestV1,
  parseMemberActionOutcomeV1,
  validateEnvironmentInterviewAnswer,
} from "@murphai/contracts";

import {
  HOSTED_EXECUTION_ASSISTANT_NOTIFICATION_PROMPT_PROFILES,
  HOSTED_EXECUTION_ENVIRONMENT_VOICE_CONTENT_TYPES,
  HOSTED_EXECUTION_ENVIRONMENT_VOICE_MAX_BYTES,
  HOSTED_EXECUTION_MEAL_PHOTO_MAX_BYTES,
  HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_MAX_CHARS,
  isHostedConversationMessageChannel,
  isHostedExecutionWakeKind,
  isHostedLinqConversationContactKind,
} from "./contracts.ts";
import {
  parseHostedClinicalRecordsIdentifier,
} from "./clinical-records-boundary.ts";
import {
  parseHostedExecutionInitialGroupRoomModelMarkdown,
} from "./pending-group-setup.ts";
import {
  parseHostedExecutionDailyMetricReportedPayload,
} from "./daily-metric.ts";

import type {
  HostedExecutionAssistantAskCompletedEvent,
  HostedExecutionAssistantAskRequestedEvent,
  HostedExecutionAssistantNotificationDelivery,
  HostedExecutionAssistantNotificationDeliveryDispatchMode,
  HostedExecutionAssistantNotificationDeliverySource,
  HostedExecutionAssistantNotificationFirstContactPolicy,
  HostedExecutionAssistantNotificationPromptProfile,
  HostedExecutionGroupContextHandoffNotification,
  HostedExecutionPrivateAssistantAskCompletionDeliveryAuthority,
  HostedExecutionPrivateAssistantAskCompletionNotification,
  HostedExecutionClinicalRecordsSyncRequestedEvent,
  HostedExecutionAssistantNotificationRequestedPayload,
  HostedExecutionAssistantNotificationResponsePolicy,
  HostedExecutionMemberActivationSignupWelcome,
  HostedExecutionMemberChannels,
  HostedExecutionMemberChannelsUpdatedEvent,
  HostedExecutionMemberPersonalityPreferences,
  HostedExecutionMemberPreferences,
  HostedExecutionMemberPreferencesUpdatedEvent,
  HostedExecutionEnvironmentVoiceCapturedPayload,
  HostedExecutionEnvironmentInterviewCompletedPayload,
  HostedExecutionMealPhotoCapturedPayload,
  HostedExecutionMemberActionRequestedEvent,
  HostedExecutionMemberActionCompletedEvent,
  HostedExecutionDeviceSyncWakeEvent,
  HostedExecutionDirectRoute,
  HostedExecutionWake,
  HostedExecutionWakeKind,
  HostedExecutionEvent,
  HostedExecutionConversationMessageWake,
  HostedExecutionEmailAttachmentSummary,
  HostedExecutionExternalThreadRouteAuthority,
  HostedExecutionLinqExternalThreadRouteAuthority,
  HostedExecutionTelegramExternalThreadRouteAuthority,
  HostedExecutionLinqConversationMessagePayload,
  HostedExecutionRedactedLogEntry,
  HostedExecutionPlainRuntimeControlWakeKind,
  HostedCodexAuthAction,
} from "./contracts.ts";
import {
  parseHostedExecutionAssistantAskCompletedPayload,
  parseHostedExecutionAssistantAskOriginInputId,
  parseHostedExecutionAssistantAskRequestedPayload,
  parseHostedExecutionAssistantAskTimestamp,
} from "./assistant-ask-payload.ts";
import {
  createHostedExecutionPrivateAssistantAskCompletionDeliveryKey,
} from "./assistant-identifiers.ts";
import type {
  HostedExecutionLogLevel,
} from "./observability.ts";
import {
  isHostedExecutionLogLevel,
} from "./observability.ts";
import {
  buildHostedExecutionAssistantAskCompletedWake,
  buildHostedExecutionAssistantAskRequestedWake,
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionMemberChannelsUpdatedWake,
  buildHostedExecutionMemberPreferencesUpdatedWake,
  buildHostedExecutionEnvironmentVoiceCapturedWake,
  buildHostedExecutionDailyMetricReportedWake,
  buildHostedExecutionEnvironmentInterviewCompletedWake,
  buildHostedExecutionMealPhotoCapturedWake,
  buildHostedExecutionMemberActionRequestedWake,
  buildHostedExecutionMemberActionCompletedWake,
  buildHostedExecutionConversationMessageWake,
  buildHostedExecutionCodexAuthRequestedWake,
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionPendingEffectsReconcileRequestedWake,
  buildHostedExecutionRuntimeControlWake,
  buildHostedExecutionTelegramConversationMessageWake,
} from "./builders.ts";
import {
  rejectLegacyAliases,
  requireArray,
  requireBoolean,
  requireNumber,
  requireObject,
  requireString,
  readNullableNumber,
  readNullableString,
  readNullableStringValue,
  readOptionalNullableString,
  readOptionalStringArray,
} from "./parsers/assertions.ts";
import {
  buildHostedExecutionLayeredSnapshotRef,
  buildHostedExecutionWorkingSnapshotRef,
  isHostedExecutionLayeredSnapshotRef,
  isHostedExecutionWorkingSnapshotRef,
  isHostedWorkspaceSnapshotV2Ref,
  parseHostedExecutionBundlePayload,
  parseHostedExecutionBundleRef,
  parseHostedBrowserVaultReplicaRef,
  parseHostedExecutionSnapshotRef,
  readHostedExecutionSnapshotBaseRef,
  readHostedExecutionSnapshotDeltaRef,
  readHostedExecutionSnapshotHotRef,
} from "./parsers/cursor.ts";
import {
  parseHostedExecutionDeviceSyncExpectedConnectedAt,
  parseHostedExecutionDeviceSyncReason,
  parseHostedExecutionDeviceSyncWakeHint,
} from "./parsers/device-sync.ts";
import { parseHostedExecutionTelegramMessage } from "./parsers/telegram.ts";

export {
  parseHostedExecutionAssistantAskCompletedPayload,
  parseHostedExecutionAssistantAskRequestedPayload,
} from "./assistant-ask-payload.ts";
export {
  parseHostedExecutionDailyMetricReportedPayload,
} from "./daily-metric.ts";
export {
  buildHostedExecutionLayeredSnapshotRef,
  buildHostedExecutionWorkingSnapshotRef,
  isHostedExecutionLayeredSnapshotRef,
  isHostedExecutionWorkingSnapshotRef,
  isHostedWorkspaceSnapshotV2Ref,
  parseHostedExecutionBundlePayload,
  parseHostedExecutionBundleRef,
  parseHostedBrowserVaultReplicaRef,
  parseHostedExecutionSnapshotRef,
  readHostedExecutionSnapshotBaseRef,
  readHostedExecutionSnapshotDeltaRef,
  readHostedExecutionSnapshotHotRef,
} from "./parsers/cursor.ts";
export {
  parseHostedWorkspaceSnapshotV2Ref,
} from "./parsers/workspace-snapshot-v2.ts";
export {
  parseHostedMailboxFetchRequest,
  parseHostedMailboxFetchResponse,
  parseHostedMailboxItem,
  parseHostedMailboxKind,
  parseHostedMailboxLane,
  parseHostedMailboxLaneCounterState,
  parseHostedMailboxPayload,
  parseHostedMailboxPayloadFetchRequest,
  parseHostedMailboxPayloadFetchResponse,
  parseHostedBrowserVaultReplicaPublishRequest,
  parseHostedBrowserVaultReplicaPublishResponse,
  parseHostedRunnerNudgeResult,
  parseHostedRunnerStatusResponse,
  parseHostedRuntimeDeviceSyncBridgeEnvelope,
  parseHostedIngressLatencySource,
  parseHostedRuntimeIssueExportRequest,
  parseHostedRuntimeIssueExportResponse,
  parseHostedCodexAuthUpdate,
  parseHostedCodexAuthUpdateResponse,
  parseHostedRuntimeLatencyTraceEvent,
  parseHostedRuntimeLatencyTraceRequest,
  parseHostedRuntimeLatencyTraceResponse,
  parseHostedRuntimeLogEntry,
  parseHostedRuntimeRedactedJson,
  parseHostedRuntimeLogRequest,
  parseHostedRuntimeLogResponse,
  parseHostedRuntimeUsageRecordRequest,
  parseHostedRuntimeUsageRecordResponse,
  parseHostedRuntimeAssistantAskControlRequest,
  parseHostedRuntimeAssistantAskControlResponse,
  parseHostedRuntimeGroupToolRequest,
  parseHostedRuntimeGroupToolResponse,
  parseHostedRuntimeGroupEmailEffectRequest,
  parseHostedRuntimeGroupEmailEffectResponse,
  parseHostedRuntimeFamilyPlanToolRequest,
  parseHostedRuntimeFamilyPlanToolResponse,
  parseHostedRuntimeIMessageContactToolRequest,
  parseHostedRuntimeIMessageContactToolResponse,
  parseHostedRuntimeAssistantConfigurationControlRequest,
  parseHostedRuntimeAssistantConfigurationToolRequest,
  parseHostedRuntimeAssistantConfigurationToolResponse,
  parseHostedRuntimeProductFeedbackRecordRequest,
  parseHostedRuntimeProductFeedbackRecordResponse,
  parseHostedRuntimeHealthDataAdmissionResponse,
  parseHostedRuntimeWebStatusResponse,
  parseHostedWorkspaceCheckpointRequest,
  parseHostedWorkspaceCheckpointResponse,
  parseHostedWorkspaceReadResponse,
  parseHostedWorkspaceInvocationRequest,
  parseHostedWorkspaceInvocationResult,
  parseHostedWorkspaceState,
} from "./parsers/runtime-control.ts";
export {
  parseHostedRuntimeEnsureProcessingRequest,
  parseHostedRuntimeEnsureProcessingResponse,
  parseHostedRuntimeReconciliationFacts,
  parseHostedRuntimeReconciliationFactsBlocked,
  parseHostedRuntimeReconciliationFactsRequest,
  parseHostedRuntimeReconciliationFactsWorkspace,
  parseHostedRuntimeSignal,
} from "./parsers/orchestration-control.ts";

export function parseHostedExecutionWake(value: unknown): HostedExecutionWake {
  const record = requireObject(value, "Hosted execution wake");
  const kind = parseHostedExecutionWakeKind(record.kind, "Hosted execution wake kind");
  const eventId = requireString(record.eventId, "Hosted execution wake eventId");
  const occurredAt = requireString(record.occurredAt, "Hosted execution wake occurredAt");
  const wireUserId = requireString(record.userId, "Hosted execution wake userId");

  switch (kind) {
    case "conversation.message":
      return buildHostedExecutionConversationMessageWake({
        eventId,
        message: parseHostedExecutionConversationMessagePayload(record.message),
        occurredAt,
        userId: wireUserId,
      });
    case "member.activated":
      return buildHostedExecutionMemberActivatedWake({
        eventId,
        ...(record.initialGroupRoomModelMarkdown === undefined
          ? {}
          : {
              initialGroupRoomModelMarkdown:
                record.initialGroupRoomModelMarkdown === null
                  ? null
                  : requireString(
                      record.initialGroupRoomModelMarkdown,
                      "Hosted execution wake member.activated initialGroupRoomModelMarkdown",
                    ),
            }),
        memberChannels: parseHostedExecutionMemberChannels(
          record.memberChannels,
          "Hosted execution wake member.activated memberChannels",
        ),
        memberId: wireUserId,
        occurredAt,
        ...(record.signupWelcome === undefined
          ? {}
          : {
              signupWelcome: record.signupWelcome === null
                ? null
                : parseHostedExecutionMemberActivationSignupWelcome(
                    record.signupWelcome,
                    "Hosted execution wake member.activated signupWelcome",
                  ),
            }),
        timeZone: parseHostedExecutionOptionalTimeZone(
          record.timeZone,
          "Hosted execution wake member.activated timeZone",
        ),
      });
    case "vault-share.delivery":
      // The builder derives the envelope occurredAt from the delivery record, so a wire
      // envelope timestamp that drifted from the record normalizes back to the record.
      return buildHostedExecutionVaultShareDeliveryWake({
        delivery: parseHostedVaultShareDeliveryPayload(record.delivery),
        eventId,
        memberId: wireUserId,
      });
    case "vault-share.revoke":
      return buildHostedExecutionVaultShareRevokeWake({
        eventId,
        memberId: wireUserId,
        revoke: parseHostedVaultShareRevokePayload(record.revoke),
      });
    case "member.channels.updated":
      return buildHostedExecutionMemberChannelsUpdatedWake({
        eventId,
        memberChannels: parseHostedExecutionMemberChannels(
          record.memberChannels,
          "Hosted execution wake member.channels.updated memberChannels",
        ),
        memberId: wireUserId,
        occurredAt,
      });
    case "member.preferences.updated":
      return buildHostedExecutionMemberPreferencesUpdatedWake({
        ...parsePreferenceCausalMetadata(record),
        eventId,
        memberId: wireUserId,
        occurredAt,
        preferences: parseHostedExecutionMemberPreferences(
          record.preferences,
          "Hosted execution wake member.preferences.updated preferences",
        ),
        ...parsePreferenceRequestedFields(record),
      });
    case "assistant.notification.requested":
      return buildHostedExecutionAssistantNotificationRequestedWake({
        eventId,
        memberId: wireUserId,
        notification: parseHostedExecutionAssistantNotificationRequestedPayload(
          record.notification,
          "Hosted execution wake assistant.notification.requested notification",
        ),
        occurredAt,
      });
    case "assistant.ask.requested":
      assertExactHostedExecutionKeys(record, [
        "ask",
        "eventId",
        "kind",
        "occurredAt",
        "userId",
      ], "Hosted execution assistant.ask.requested wake");
      return buildHostedExecutionAssistantAskRequestedWake({
        ask: parseHostedExecutionAssistantAskRequestedPayload(
          record.ask,
          "Hosted execution assistant.ask.requested wake ask",
        ),
        eventId,
        memberId: wireUserId,
        occurredAt,
      });
    case "assistant.ask.completed":
      assertExactHostedExecutionKeys(record, [
        "ask",
        "eventId",
        "kind",
        "occurredAt",
        "userId",
      ], "Hosted execution assistant.ask.completed wake");
      return buildHostedExecutionAssistantAskCompletedWake({
        ask: parseHostedExecutionAssistantAskCompletedPayload(
          record.ask,
          "Hosted execution assistant.ask.completed wake ask",
        ),
        eventId,
        memberId: wireUserId,
        occurredAt,
      });
    case "clinical-records.sync-requested":
      assertExactHostedClinicalRecordsKeys(
        record,
        ["eventId", "generation", "kind", "occurredAt", "runId", "userId"],
        "Hosted execution wake clinical-records.sync-requested",
      );
      return {
        eventId,
        generation: parseHostedExecutionPositiveGeneration(
          record.generation,
          "Hosted execution wake clinical-records.sync-requested generation",
        ),
        occurredAt,
        kind,
        runId: parseHostedClinicalRecordsIdentifier(record.runId),
        userId: wireUserId,
      };
    case "member.action.requested":
      assertExactHostedExecutionKeys(record, [
        "eventId",
        "kind",
        "occurredAt",
        "request",
        "userId",
      ], "Hosted execution member.action.requested wake");
      return buildHostedExecutionMemberActionRequestedWake({
        eventId,
        memberId: wireUserId,
        occurredAt,
        request: parseMemberActionRequestV1(record.request),
      });
    case "member.action.completed":
      assertExactHostedExecutionKeys(record, [
        "eventId",
        "kind",
        "occurredAt",
        "outcome",
        "userId",
      ], "Hosted execution member.action.completed wake");
      return buildHostedExecutionMemberActionCompletedWake({
        eventId,
        memberId: wireUserId,
        occurredAt,
        outcome: parseMemberActionOutcomeV1(record.outcome),
      });
    case "device-sync.wake":
      return buildHostedExecutionDeviceSyncWake({
        ...(record.connectionId === undefined
          ? {}
          : {
              connectionId: readNullableString(
                record.connectionId,
                "Hosted execution wake device-sync.wake connectionId",
              ),
            }),
        eventId,
        ...(record.expectedConnectedAt === undefined
          ? {}
          : {
              expectedConnectedAt: parseHostedExecutionDeviceSyncExpectedConnectedAt(
                record.expectedConnectedAt,
                "Hosted execution wake device-sync.wake expectedConnectedAt",
              ),
            }),
        ...(record.hint === undefined
          ? {}
          : { hint: parseHostedExecutionDeviceSyncWakeHint(record.hint) }),
        occurredAt,
        ...(record.provider === undefined
          ? {}
          : {
              provider: readNullableString(
                record.provider,
                "Hosted execution wake device-sync.wake provider",
              ),
            }),
        reason: parseHostedExecutionDeviceSyncReason(record.reason),
        userId: wireUserId,
      });
    case "runtime.pending-effects-reconcile-requested":
      assertExactHostedExecutionKeys(record, [
        "effectId",
        "eventId",
        "kind",
        "occurredAt",
        "userId",
      ], "Hosted execution runtime.pending-effects-reconcile-requested wake");
      return buildHostedExecutionPendingEffectsReconcileRequestedWake({
        effectId: requireString(
          record.effectId,
          "Hosted execution runtime.pending-effects-reconcile-requested wake effectId",
        ),
        eventId,
        occurredAt,
        userId: wireUserId,
      });
    case "meal-photo.captured": {
      const mealPhoto = parseHostedExecutionMealPhotoCapturedPayload(record.mealPhoto);
      if (mealPhoto.capturedAt !== occurredAt) {
        throw new TypeError(
          "Hosted execution wake meal-photo.captured occurredAt must match capturedAt.",
        );
      }
      return buildHostedExecutionMealPhotoCapturedWake({
        byteLength: mealPhoto.byteLength,
        captureId: mealPhoto.captureId,
        capturedAt: mealPhoto.capturedAt,
        directRoute: parseHostedExecutionDirectRoute(
          record.directRoute,
          "Hosted execution wake meal-photo.captured directRoute",
        ),
        eventId,
        mealPhotoKey: mealPhoto.mealPhotoKey,
        memberId: wireUserId,
        occurredAt,
        sha256: mealPhoto.sha256,
      });
    }
    case "health.daily-metric.reported": {
      assertExactHostedExecutionKeys(record, [
        "dailyMetric",
        "eventId",
        "kind",
        "occurredAt",
        "userId",
      ], "Hosted execution health.daily-metric.reported wake");
      const dailyMetric = parseHostedExecutionDailyMetricReportedPayload(
        record.dailyMetric,
      );
      return buildHostedExecutionDailyMetricReportedWake({
        ...dailyMetric,
        eventId,
        memberId: wireUserId,
        occurredAt,
      });
    }
    case "environment-voice.captured": {
      assertExactHostedExecutionKeys(record, [
        "environmentVoice",
        "eventId",
        "kind",
        "occurredAt",
        "userId",
      ], "Hosted execution environment-voice.captured wake");
      const environmentVoice =
        parseHostedExecutionEnvironmentVoiceCapturedPayload(
          record.environmentVoice,
        );
      if (environmentVoice.capturedAt !== occurredAt) {
        throw new TypeError(
          "Hosted execution wake environment-voice.captured occurredAt must match capturedAt.",
        );
      }
      return buildHostedExecutionEnvironmentVoiceCapturedWake({
        audioKey: environmentVoice.audioKey,
        byteLength: environmentVoice.byteLength,
        captureId: environmentVoice.captureId,
        capturedAt: environmentVoice.capturedAt,
        contentType: environmentVoice.contentType,
        durationMs: environmentVoice.durationMs,
        eventId,
        memberId: wireUserId,
        occurredAt,
        sha256: environmentVoice.sha256,
      });
    }
    case "environment-interview.completed": {
      assertExactHostedExecutionKeys(record, [
        "environmentInterview",
        "eventId",
        "kind",
        "occurredAt",
        "userId",
      ], "Hosted execution environment-interview.completed wake");
      const environmentInterview =
        parseHostedExecutionEnvironmentInterviewCompletedPayload(
          record.environmentInterview,
        );
      if (environmentInterview.completedAt !== occurredAt) {
        throw new TypeError(
          "Hosted execution wake environment-interview.completed occurredAt must match completedAt.",
        );
      }
      return buildHostedExecutionEnvironmentInterviewCompletedWake({
        completedAt: environmentInterview.completedAt,
        completionId: environmentInterview.completionId,
        eventId,
        memberId: wireUserId,
        occurredAt,
        topics: environmentInterview.topics,
      });
    }
    case "runtime.manual-requested":
    case "runtime.maintenance-requested":
    case "runtime.browser-vault-refresh-requested":
    case "runtime.device-sync-recovery-requested":
    case "runtime.mailbox-lag-observed":
      return buildHostedExecutionRuntimeControlWake({
        eventId,
        kind,
        occurredAt,
        userId: wireUserId,
      });
    case "runtime.codex-auth-requested":
      assertExactHostedExecutionKeys(record, [
        "action",
        "attemptId",
        "eventId",
        "kind",
        "occurredAt",
        "userId",
      ], "Hosted execution runtime.codex-auth-requested wake");
      return buildHostedExecutionCodexAuthRequestedWake({
        action: parseHostedCodexAuthAction(record.action),
        attemptId: parseHostedCodexAuthAttemptId(record.attemptId),
        eventId,
        occurredAt,
        userId: wireUserId,
      });
    default:
      throw new TypeError(`Unsupported hosted execution wake kind: ${kind}`);
  }
}

export function parseHostedExecutionMealPhotoCapturedPayload(
  value: unknown,
): HostedExecutionMealPhotoCapturedPayload {
  const record = requireObject(value, "Hosted execution meal-photo.captured payload");
  assertExactHostedMealPhotoKeys(record);

  const captureId = requireString(
    record.captureId,
    "Hosted execution meal-photo.captured captureId",
  );
  if (!/^[a-f0-9]{64}$/u.test(captureId)) {
    throw new TypeError(
      "Hosted execution meal-photo.captured captureId must be a lowercase SHA-256 digest.",
    );
  }

  const mealPhotoKey = requireString(
    record.mealPhotoKey,
    "Hosted execution meal-photo.captured mealPhotoKey",
  );
  if (
    mealPhotoKey.length > 192
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(mealPhotoKey)
  ) {
    throw new TypeError("Hosted execution meal-photo.captured mealPhotoKey is invalid.");
  }

  const capturedAt = requireString(
    record.capturedAt,
    "Hosted execution meal-photo.captured capturedAt",
  );
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(capturedAt)
    || !Number.isFinite(Date.parse(capturedAt))
  ) {
    throw new TypeError(
      "Hosted execution meal-photo.captured capturedAt must be an ISO timestamp.",
    );
  }

  const byteLength = record.byteLength;
  if (
    typeof byteLength !== "number"
    || !Number.isSafeInteger(byteLength)
    || byteLength <= 0
    || byteLength > HOSTED_EXECUTION_MEAL_PHOTO_MAX_BYTES
  ) {
    throw new TypeError(
      `Hosted execution meal-photo.captured byteLength must be between 1 and ${HOSTED_EXECUTION_MEAL_PHOTO_MAX_BYTES}.`,
    );
  }

  const sha256 = requireString(
    record.sha256,
    "Hosted execution meal-photo.captured sha256",
  );
  if (!/^[a-f0-9]{64}$/u.test(sha256)) {
    throw new TypeError(
      "Hosted execution meal-photo.captured sha256 must be a lowercase SHA-256 digest.",
    );
  }

  return {
    byteLength,
    captureId,
    capturedAt,
    mealPhotoKey,
    sha256,
  };
}

export function parseHostedExecutionEnvironmentVoiceCapturedPayload(
  value: unknown,
): HostedExecutionEnvironmentVoiceCapturedPayload {
  const record = requireObject(
    value,
    "Hosted execution environment-voice.captured payload",
  );
  assertExactHostedEnvironmentVoiceKeys(record);

  const audioKey = requireString(
    record.audioKey,
    "Hosted execution environment-voice.captured audioKey",
  );
  if (!/^[a-f0-9]{40}$/u.test(audioKey)) {
    throw new TypeError(
      "Hosted execution environment-voice.captured audioKey is invalid.",
    );
  }

  const captureId = requireString(
    record.captureId,
    "Hosted execution environment-voice.captured captureId",
  );
  if (!/^[a-f0-9]{64}$/u.test(captureId)) {
    throw new TypeError(
      "Hosted execution environment-voice.captured captureId must be a lowercase SHA-256 digest.",
    );
  }

  const capturedAt = requireString(
    record.capturedAt,
    "Hosted execution environment-voice.captured capturedAt",
  );
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(capturedAt)
    || !Number.isFinite(Date.parse(capturedAt))
  ) {
    throw new TypeError(
      "Hosted execution environment-voice.captured capturedAt must be an ISO timestamp.",
    );
  }

  const byteLength = record.byteLength;
  if (
    typeof byteLength !== "number"
    || !Number.isSafeInteger(byteLength)
    || byteLength <= 0
    || byteLength > HOSTED_EXECUTION_ENVIRONMENT_VOICE_MAX_BYTES
  ) {
    throw new TypeError(
      `Hosted execution environment-voice.captured byteLength must be between 1 and ${HOSTED_EXECUTION_ENVIRONMENT_VOICE_MAX_BYTES}.`,
    );
  }

  const durationMs = record.durationMs;
  if (
    typeof durationMs !== "number"
    || !Number.isSafeInteger(durationMs)
    || durationMs <= 0
    || durationMs > 3 * 60 * 1_000
  ) {
    throw new TypeError(
      "Hosted execution environment-voice.captured durationMs must be between 1 and 180000.",
    );
  }

  const contentType = requireString(
    record.contentType,
    "Hosted execution environment-voice.captured contentType",
  );
  const normalizedContentType =
    HOSTED_EXECUTION_ENVIRONMENT_VOICE_CONTENT_TYPES.find(
      (candidate) => candidate === contentType,
    );
  if (!normalizedContentType) {
    throw new TypeError(
      "Hosted execution environment-voice.captured contentType is invalid.",
    );
  }

  const sha256 = requireString(
    record.sha256,
    "Hosted execution environment-voice.captured sha256",
  );
  if (!/^[a-f0-9]{64}$/u.test(sha256)) {
    throw new TypeError(
      "Hosted execution environment-voice.captured sha256 must be a lowercase SHA-256 digest.",
    );
  }

  return {
    audioKey,
    byteLength,
    captureId,
    capturedAt,
    contentType: normalizedContentType,
    durationMs,
    sha256,
  };
}

export function parseHostedExecutionEnvironmentInterviewCompletedPayload(
  value: unknown,
): HostedExecutionEnvironmentInterviewCompletedPayload {
  const record = requireObject(
    value,
    "Hosted execution environment-interview.completed payload",
  );
  assertExactHostedExecutionKeys(record, [
    "completedAt",
    "completionId",
    "topics",
  ], "Hosted execution environment-interview.completed payload");
  const completedAt = requireString(
    record.completedAt,
    "Hosted execution environment-interview.completed completedAt",
  );
  if (!isIsoTimestamp(completedAt)) {
    throw new TypeError(
      "Hosted execution environment-interview.completed completedAt must be an ISO timestamp.",
    );
  }
  const completionId = requireString(
    record.completionId,
    "Hosted execution environment-interview.completed completionId",
  );
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(completionId)) {
    throw new TypeError(
      "Hosted execution environment-interview.completed completionId must be a UUID v4.",
    );
  }
  const topics = requireArray(
    record.topics,
    "Hosted execution environment-interview.completed topics",
  );
  if (topics.length < 1 || topics.length > 5) {
    throw new TypeError(
      "Hosted execution environment-interview.completed must contain one to five topics.",
    );
  }
  let answerCount = 0;
  const parsedTopics = topics.map((topicValue, topicIndex) => {
    const topic = requireObject(
      topicValue,
      `Hosted execution environment-interview.completed topic ${topicIndex}`,
    );
    assertExactHostedExecutionKeys(topic, [
      "answers",
      "topicId",
    ], `Hosted execution environment-interview.completed topic ${topicIndex}`);
    const topicId = requireString(
      topic.topicId,
      `Hosted execution environment-interview.completed topic ${topicIndex} id`,
    );
    if (!/^[a-z]+(?::[0-9]+)?$/u.test(topicId) || !getEnvironmentInterviewTopicGroup(topicId)) {
      throw new TypeError(
        "Hosted execution environment-interview.completed topic id is invalid.",
      );
    }
    const answers = requireArray(
      topic.answers,
      `Hosted execution environment-interview.completed topic ${topicIndex} answers`,
    );
    if (answers.length < 1 || answers.length > 16) {
      throw new TypeError(
        "Hosted execution environment-interview.completed topic must contain one to sixteen answers.",
      );
    }
    answerCount += answers.length;
    return {
      answers: answers.map((answerValue, answerIndex) => {
        const answer = requireObject(
          answerValue,
          `Hosted execution environment-interview.completed answer ${answerIndex}`,
        );
        assertExactHostedExecutionKeys(answer, [
          "aspectId",
          "indicatorId",
          "note",
          "value",
        ], `Hosted execution environment-interview.completed answer ${answerIndex}`);
        const parsed = {
          aspectId: requireString(answer.aspectId, "Environment interview answer aspectId"),
          indicatorId: requireString(answer.indicatorId, "Environment interview answer indicatorId"),
          ...(answer.note === undefined
            ? {}
            : {
                note: answer.note === null
                  ? null
                  : requireString(
                      answer.note,
                      "Environment interview answer note",
                    ).trim(),
              }),
          value: parseEnvironmentInterviewAnswerValue(answer.value),
        };
        const issue = validateEnvironmentInterviewAnswer(topicId, parsed);
        if (issue) {
          throw new TypeError(issue);
        }
        return parsed;
      }),
      topicId,
    };
  });
  if (answerCount > 32) {
    throw new TypeError(
      "Hosted execution environment-interview.completed contains too many answers.",
    );
  }
  return { completedAt, completionId, topics: parsedTopics };
}

function parseEnvironmentInterviewAnswerValue(
  value: unknown,
): string | number | boolean {
  if (
    typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  throw new TypeError(
    "Hosted execution environment interview answer value is invalid.",
  );
}

function isIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
    && Number.isFinite(Date.parse(value));
}

export function parseHostedExecutionConversationMessagePayload(
  value: unknown,
): HostedExecutionConversationMessageWake["message"] {
  const record = requireObject(value, "Hosted execution conversation.message wake payload");
  const channel = parseHostedConversationMessageChannel(
    record.channel,
    "Hosted execution conversation.message wake payload channel",
  );

  switch (channel) {
    case "linq":
      return parseHostedExecutionLinqConversationMessagePayload(record, channel);
    case "telegram": {
      const routeAuthority = parseOptionalHostedExecutionTelegramExternalThreadRouteAuthority(
        record.routeAuthority,
        "Hosted execution conversation.message wake payload routeAuthority",
      );
      const senderMemberId = parseOptionalHostedExecutionGroupSenderMemberId(
        record.senderMemberId,
      );
      return {
        channel,
        ...(routeAuthority === undefined ? {} : { routeAuthority }),
        ...(senderMemberId === undefined ? {} : { senderMemberId }),
        telegramMessage: parseHostedExecutionTelegramMessage(record.telegramMessage),
      };
    }
    case "email":
      return {
        ...(record.assistantStyleSettingsAuthorized === undefined
          ? {}
          : {
              assistantStyleSettingsAuthorized: requireBoolean(
                record.assistantStyleSettingsAuthorized,
                "Hosted execution conversation.message wake payload assistantStyleSettingsAuthorized",
              ),
            }),
        ...(record.attachmentSummaries === undefined
          ? {}
          : {
              attachmentSummaries: parseHostedExecutionEmailAttachmentSummaries(
                record.attachmentSummaries,
                "Hosted execution conversation.message wake payload attachmentSummaries",
              ),
            }),
        channel,
        ...(record.cc === undefined
          ? {}
          : {
              cc: readOptionalStringArray(
                record.cc,
                "Hosted execution conversation.message wake payload cc",
              ),
            }),
        ...(record.from === undefined
          ? {}
          : {
              from: readOptionalNullableString(
                record.from,
                "Hosted execution conversation.message wake payload from",
              ),
            }),
        identityId: readNullableStringValue(
          record.identityId,
          "Hosted execution conversation.message wake payload identityId",
        ),
        ...(record.messageId === undefined
          ? {}
          : {
              messageId: readOptionalNullableString(
                record.messageId,
                "Hosted execution conversation.message wake payload messageId",
              ),
            }),
        rawMessageKey: requireString(
          record.rawMessageKey,
          "Hosted execution conversation.message wake payload rawMessageKey",
        ),
        ...(record.selfAddress === undefined
          ? {}
          : {
              selfAddress: readOptionalNullableString(
                record.selfAddress,
                "Hosted execution conversation.message wake payload selfAddress",
              ),
            }),
        ...(record.subject === undefined
          ? {}
          : {
              subject: readOptionalNullableString(
                record.subject,
                "Hosted execution conversation.message wake payload subject",
              ),
            }),
        ...(record.textPreview === undefined
          ? {}
          : {
              textPreview: readOptionalNullableString(
                record.textPreview,
                "Hosted execution conversation.message wake payload textPreview",
              ),
            }),
        ...(record.threadKey === undefined
          ? {}
          : {
              threadKey: readOptionalNullableString(
                record.threadKey,
                "Hosted execution conversation.message wake payload threadKey",
              ),
            }),
        ...(record.threadIsDirect === undefined
          ? {}
          : {
              threadIsDirect: record.threadIsDirect === null
                ? null
                : requireBoolean(
                    record.threadIsDirect,
                    "Hosted execution conversation.message wake payload threadIsDirect",
                  ),
            }),
        ...(record.threadTarget === undefined
          ? {}
          : {
              threadTarget: readOptionalNullableString(
                record.threadTarget,
                "Hosted execution conversation.message wake payload threadTarget",
              ),
            }),
        ...(record.to === undefined
          ? {}
          : {
              to: readOptionalStringArray(
                record.to,
                "Hosted execution conversation.message wake payload to",
              ),
            }),
      };
  }
}

function parseHostedExecutionLinqConversationMessagePayload(
  record: Record<string, unknown>,
  channel: "linq",
): HostedExecutionLinqConversationMessagePayload {
  const linqMessage = parseHostedExecutionLinqConversationMessage(
    record.linqMessage,
    "Hosted execution conversation.message wake payload linqMessage",
  );
  const routeAuthority = parseOptionalHostedExecutionLinqExternalThreadRouteAuthority(
    record.routeAuthority,
    "Hosted execution conversation.message wake payload routeAuthority",
  );
  const senderMemberId = parseOptionalHostedExecutionGroupSenderMemberId(
    record.senderMemberId,
  );
  let groupParticipantAdded: true | undefined;
  if (record.groupParticipantAdded !== undefined) {
    if (record.groupParticipantAdded !== true) {
      throw new TypeError(
        "Hosted execution conversation.message wake payload groupParticipantAdded must be true when present.",
      );
    }
    groupParticipantAdded = true;
  }
  const groupReactionContext = record.groupReactionContext === undefined
    ? undefined
    : requireString(
        record.groupReactionContext,
        "Hosted execution conversation.message wake payload groupReactionContext",
      ).trim();
  if (
    groupReactionContext !== undefined
    && (
      groupReactionContext.length === 0
      || groupReactionContext.length > HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_MAX_CHARS
    )
  ) {
    throw new TypeError(
      "Hosted execution conversation.message wake payload groupReactionContext is invalid.",
    );
  }

  if (record.contactLookupKey !== undefined || record.contactKind !== undefined) {
    const contactKind = parseHostedExecutionLinqConversationContactKind(
      record.contactKind,
      "Hosted execution conversation.message wake payload contactKind",
    );
    const contactLookupKey = requireString(
      record.contactLookupKey,
      "Hosted execution conversation.message wake payload contactLookupKey",
    );
    return {
      ...(record.accountLookupKey === undefined
        ? {}
        : {
            accountLookupKey: readOptionalNullableString(
              record.accountLookupKey,
              "Hosted execution conversation.message wake payload accountLookupKey",
            ),
          }),
      channel,
      contactKind,
      contactLookupKey,
      ...(groupParticipantAdded === undefined ? {} : { groupParticipantAdded }),
      ...(groupReactionContext === undefined ? {} : { groupReactionContext }),
      linqMessage,
      ...(record.phoneLookupKey === undefined
        ? {}
        : {
            phoneLookupKey: readOptionalNullableString(
              record.phoneLookupKey,
              "Hosted execution conversation.message wake payload phoneLookupKey",
            ),
          }),
      ...(routeAuthority === undefined ? {} : { routeAuthority }),
      ...(senderMemberId === undefined ? {} : { senderMemberId }),
    };
  }

  const phoneLookupKey = requireString(
    record.phoneLookupKey,
    "Hosted execution conversation.message wake payload phoneLookupKey",
  );
  return {
    ...(record.accountLookupKey === undefined
      ? {}
      : {
          accountLookupKey: readOptionalNullableString(
            record.accountLookupKey,
            "Hosted execution conversation.message wake payload accountLookupKey",
          ),
        }),
    channel,
    contactKind: "phone",
    contactLookupKey: phoneLookupKey,
    ...(groupParticipantAdded === undefined ? {} : { groupParticipantAdded }),
    ...(groupReactionContext === undefined ? {} : { groupReactionContext }),
    linqMessage,
    phoneLookupKey,
    ...(routeAuthority === undefined ? {} : { routeAuthority }),
    ...(senderMemberId === undefined ? {} : { senderMemberId }),
  };
}

function parseOptionalHostedExecutionGroupSenderMemberId(
  value: unknown,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const senderMemberId = requireString(
    value,
    "Hosted execution conversation.message wake payload senderMemberId",
  );
  if (senderMemberId.trim().length === 0 || senderMemberId.trim() !== senderMemberId) {
    throw new TypeError(
      "Hosted execution conversation.message wake payload senderMemberId must be a non-empty normalized string.",
    );
  }
  return senderMemberId;
}

function parseOptionalHostedExecutionExternalThreadRouteAuthority(
  value: unknown,
  label: string,
): HostedExecutionExternalThreadRouteAuthority | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return parseHostedExecutionExternalThreadRouteAuthority(value, label);
}

function parseOptionalHostedExecutionLinqExternalThreadRouteAuthority(
  value: unknown,
  label: string,
): HostedExecutionLinqExternalThreadRouteAuthority | null | undefined {
  const authority = parseOptionalHostedExecutionExternalThreadRouteAuthority(value, label);
  if (!authority) {
    return authority;
  }

  if (authority.channel !== "linq") {
    throw new TypeError(`${label} channel must be linq.`);
  }

  return {
    ...authority,
    channel: "linq",
  };
}

function parseOptionalHostedExecutionTelegramExternalThreadRouteAuthority(
  value: unknown,
  label: string,
): HostedExecutionTelegramExternalThreadRouteAuthority | null | undefined {
  const authority = parseOptionalHostedExecutionExternalThreadRouteAuthority(value, label);
  if (!authority) {
    return authority;
  }
  if (authority.channel !== "telegram") {
    throw new TypeError(`${label} channel must be telegram.`);
  }
  return {
    ...authority,
    channel: "telegram",
  };
}

export function parseHostedExecutionExternalThreadRouteAuthority(
  value: unknown,
  label = "Hosted execution external thread route authority",
): HostedExecutionExternalThreadRouteAuthority {
  const record = requireObject(value, label);
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
    channel: parseHostedExecutionExternalThreadRouteChannel(record.channel, `${label} channel`),
    containerMemberId: requireString(record.containerMemberId, `${label} containerMemberId`),
    threadId: requireString(record.threadId, `${label} threadId`),
  };
}

function parseHostedExecutionExternalThreadRouteChannel(
  value: unknown,
  label: string,
): HostedExecutionExternalThreadRouteAuthority["channel"] {
  const channel = requireString(value, label);
  switch (channel) {
    case "email":
    case "linq":
    case "telegram":
      return channel;
    default:
      throw new TypeError(`${label} is invalid.`);
  }
}

function parseHostedExecutionLinqConversationContactKind(
  value: unknown,
  label: string,
) {
  if (!isHostedLinqConversationContactKind(value)) {
    throw new TypeError(`${label} must be phone or email.`);
  }

  return value;
}

function parseHostedExecutionEmailAttachmentSummaries(
  value: unknown,
  label: string,
): HostedExecutionEmailAttachmentSummary[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value.map((entry, index) => {
    const record = requireObject(entry, `${label}[${index}]`);
    return {
      ...(record.contentType === undefined
        ? {}
        : {
            contentType: readOptionalNullableString(
              record.contentType,
              `${label}[${index}] contentType`,
            ),
          }),
      ...(record.fileName === undefined
        ? {}
        : {
            fileName: readOptionalNullableString(
              record.fileName,
              `${label}[${index}] fileName`,
            ),
          }),
      ...(record.sizeBytes === undefined
        ? {}
        : {
            sizeBytes: readNullableNumber(
              record.sizeBytes,
              `${label}[${index}] sizeBytes`,
            ),
          }),
    };
  });
}

function parseHostedExecutionOptionalTimeZone(
  value: unknown,
  label: string,
): string | null | undefined {
  const timeZone = readOptionalNullableString(value, label);

  if (timeZone === undefined || timeZone === null) {
    return timeZone;
  }

  const normalized = normalizeIanaTimeZone(timeZone);

  if (!normalized) {
    throw new TypeError(`${label} must be a valid IANA timezone.`);
  }

  return normalized;
}

function parseHostedExecutionLinqConversationMessage(
  value: unknown,
  label: string,
): HostedExecutionLinqConversationMessagePayload["linqMessage"] {
  const record = requireObject(value, label);
  if (
    record.affirmativeReaction !== undefined
    && record.affirmativeReaction !== true
  ) {
    throw new TypeError(`${label} affirmativeReaction must be true when present.`);
  }
  return {
    ...(record.affirmativeReaction === undefined
      ? {}
      : { affirmativeReaction: true }),
    chatId: requireString(record.chatId, `${label} chatId`),
    ...(record.editedTextPartIndex === undefined
      ? {}
      : {
          editedTextPartIndex: parseHostedExecutionLinqEditedTextPartIndex(
            record.editedTextPartIndex,
            `${label} editedTextPartIndex`,
          ),
        }),
    ...(record.editedSourceInputId === undefined
      ? {}
      : {
          editedSourceInputId: parseHostedExecutionLinqEditedSourceInputId(
            record.editedSourceInputId,
            `${label} editedSourceInputId`,
          ),
        }),
    from: requireString(record.from, `${label} from`),
    isFromMe: requireBoolean(record.isFromMe, `${label} isFromMe`),
    messageId: requireString(record.messageId, `${label} messageId`),
    parts: requireArray(record.parts, `${label} parts`).map((entry, index) =>
      parseHostedExecutionLinqConversationMessagePart(entry, `${label} parts[${index}]`)
    ),
    ...(record.reactionEligible === undefined
      ? {}
      : {
          reactionEligible: requireBoolean(
            record.reactionEligible,
            `${label} reactionEligible`,
          ),
        }),
    ...(record.replyToMessageId === undefined
      ? {}
      : {
          replyToMessageId: readOptionalNullableString(
            record.replyToMessageId,
            `${label} replyToMessageId`,
          ),
        }),
    ...(record.replyToPartIndex === undefined
      ? {}
      : {
          replyToPartIndex: readNullableNumber(
            record.replyToPartIndex,
            `${label} replyToPartIndex`,
          ),
        }),
    ...(record.service === undefined
      ? {}
      : {
          service: readOptionalNullableString(record.service, `${label} service`),
        }),
    ...(record.threadIsDirect === undefined
      ? {}
      : {
          threadIsDirect: record.threadIsDirect === null
            ? null
            : requireBoolean(record.threadIsDirect, `${label} threadIsDirect`),
        }),
  };
}

function parseHostedExecutionLinqEditedTextPartIndex(
  value: unknown,
  label: string,
): number {
  const index = requireNumber(value, label);
  if (!Number.isSafeInteger(index) || index < 0 || index > 2_147_483_647) {
    throw new TypeError(`${label} must be a non-negative int32.`);
  }
  return index;
}

function parseHostedExecutionLinqEditedSourceInputId(
  value: unknown,
  label: string,
): string {
  const inputId = requireString(value, label);
  if (!/^ain_[0-9a-f]{32}$/u.test(inputId)) {
    throw new TypeError(`${label} must be an opaque assistant input id.`);
  }
  return inputId;
}

function parseHostedExecutionLinqConversationMessagePart(
  value: unknown,
  label: string,
): HostedExecutionLinqConversationMessagePayload["linqMessage"]["parts"][number] {
  const record = requireObject(value, label);
  const type = requireString(record.type, `${label} type`);

  if (type === "text" || type === "link") {
    return {
      type,
      value: requireString(record.value, `${label} value`),
    };
  }

  if (type === "media" || type === "voice_memo") {
    return {
      ...(record.attachmentId === undefined
        ? {}
        : {
            attachmentId: readOptionalNullableString(
              record.attachmentId,
              `${label} attachmentId`,
            ),
          }),
      ...(record.fileName === undefined
        ? {}
        : {
            fileName: readOptionalNullableString(record.fileName, `${label} fileName`),
          }),
      ...(record.mimeType === undefined
        ? {}
        : {
            mimeType: readOptionalNullableString(record.mimeType, `${label} mimeType`),
          }),
      ...(record.size === undefined
        ? {}
        : {
            size: readNullableNumber(record.size, `${label} size`),
          }),
      type,
      ...(record.url === undefined
        ? {}
        : {
            url: readOptionalNullableString(record.url, `${label} url`),
          }),
    };
  }

  throw new TypeError(`${label} type must be "text", "link", "media", or "voice_memo".`);
}

function parseHostedExecutionRedactedLogEntry(
  value: unknown,
  label: string,
): HostedExecutionRedactedLogEntry {
  const record = requireObject(value, label);
  return {
    component: requireString(record.component, `${label} component`),
    ...(record.eventId === undefined
      ? {}
      : {
          eventId: readOptionalNullableString(record.eventId, `${label} eventId`),
        }),
    level: parseHostedExecutionLogLevelValue(record.level, `${label} level`),
    message: requireString(record.message, `${label} message`),
    phase: requireString(record.phase, `${label} phase`),
    ...(record.redacted === undefined
      ? {}
      : {
          redacted: record.redacted === null
            ? null
            : requireObject(record.redacted, `${label} redacted`),
        }),
  };
}

function parseHostedExecutionLogLevelValue(
  value: unknown,
  label: string,
): HostedExecutionLogLevel {
  const level = requireString(value, label);
  if (isHostedExecutionLogLevel(level)) {
    return level;
  }
  throw new TypeError(`${label} must be a valid hosted execution log level.`);
}

export function parseHostedExecutionEvent(value: unknown): HostedExecutionEvent {
  const record = requireObject(value, "Hosted execution event");
  const kind = requireString(record.kind, "Hosted execution event kind");
  const userId = requireString(record.userId, "Hosted execution event userId");

  switch (kind) {
    case "member.activated": {
      const timeZone = parseHostedExecutionOptionalTimeZone(
        record.timeZone,
        "Hosted execution member.activated timeZone",
      );

      return {
        ...(record.initialGroupRoomModelMarkdown === undefined
          ? {}
          : {
              initialGroupRoomModelMarkdown:
                record.initialGroupRoomModelMarkdown === null
                  ? null
                  : parseHostedExecutionInitialGroupRoomModelMarkdown(
                      record.initialGroupRoomModelMarkdown,
                    ),
            }),
        kind,
        memberChannels: parseHostedExecutionMemberChannels(
          record.memberChannels,
          "Hosted execution member.activated memberChannels",
        ),
        ...(record.signupWelcome === undefined
          ? {}
          : {
              signupWelcome: record.signupWelcome === null
                ? null
                : parseHostedExecutionMemberActivationSignupWelcome(
                    record.signupWelcome,
                    "Hosted execution member.activated signupWelcome",
                  ),
            }),
        ...(timeZone === undefined ? {} : { timeZone }),
        userId,
      };
    }
    case "member.channels.updated":
      return {
        kind,
        memberChannels: parseHostedExecutionMemberChannels(
          record.memberChannels,
          "Hosted execution member.channels.updated memberChannels",
        ),
        userId,
      } satisfies HostedExecutionMemberChannelsUpdatedEvent;
    case "member.preferences.updated":
      return {
        ...parsePreferenceCausalMetadata(record),
        kind,
        preferences: parseHostedExecutionMemberPreferences(
          record.preferences,
          "Hosted execution member.preferences.updated preferences",
        ),
        ...parsePreferenceRequestedFields(record),
        userId,
      } satisfies HostedExecutionMemberPreferencesUpdatedEvent;
    case "assistant.notification.requested":
      return {
        kind,
        notification: parseHostedExecutionAssistantNotificationRequestedPayload(
          record.notification,
          "Hosted execution assistant.notification.requested notification",
        ),
        userId,
      };
    case "assistant.ask.requested":
      assertExactHostedExecutionKeys(record, [
        "ask",
        "kind",
        "userId",
      ], "Hosted execution assistant.ask.requested event");
      return {
        ask: parseHostedExecutionAssistantAskRequestedPayload(
          record.ask,
          "Hosted execution assistant.ask.requested event ask",
        ),
        kind,
        userId,
      } satisfies HostedExecutionAssistantAskRequestedEvent;
    case "assistant.ask.completed":
      assertExactHostedExecutionKeys(record, [
        "ask",
        "kind",
        "userId",
      ], "Hosted execution assistant.ask.completed event");
      return {
        ask: parseHostedExecutionAssistantAskCompletedPayload(
          record.ask,
          "Hosted execution assistant.ask.completed event ask",
        ),
        kind,
        userId,
      } satisfies HostedExecutionAssistantAskCompletedEvent;
    case "clinical-records.sync-requested":
      assertExactHostedClinicalRecordsKeys(
        record,
        ["generation", "kind", "runId", "userId"],
        "Hosted execution clinical-records.sync-requested",
      );
      return {
        generation: parseHostedExecutionPositiveGeneration(
          record.generation,
          "Hosted execution clinical-records.sync-requested generation",
        ),
        kind,
        runId: parseHostedClinicalRecordsIdentifier(record.runId),
        userId,
      } satisfies HostedExecutionClinicalRecordsSyncRequestedEvent;
    case "member.action.requested":
      assertExactHostedExecutionKeys(record, [
        "kind",
        "request",
        "userId",
      ], "Hosted execution member.action.requested event");
      return {
        kind,
        request: parseMemberActionRequestV1(record.request),
        userId,
      } satisfies HostedExecutionMemberActionRequestedEvent;
    case "member.action.completed":
      assertExactHostedExecutionKeys(record, [
        "kind",
        "outcome",
        "userId",
      ], "Hosted execution member.action.completed event");
      return {
        kind,
        outcome: parseMemberActionOutcomeV1(record.outcome),
        userId,
      } satisfies HostedExecutionMemberActionCompletedEvent;
    case "device-sync.wake":
      return {
        ...(record.connectionId === undefined
          ? {}
          : {
              connectionId: readNullableString(
                record.connectionId,
                "Hosted execution device-sync.wake connectionId",
              ),
            }),
        ...(record.expectedConnectedAt === undefined
          ? {}
          : {
              expectedConnectedAt: parseHostedExecutionDeviceSyncExpectedConnectedAt(
                record.expectedConnectedAt,
                "Hosted execution device-sync.wake expectedConnectedAt",
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
                "Hosted execution device-sync.wake provider",
              ),
            }),
        reason: parseHostedExecutionDeviceSyncReason(record.reason),
        userId,
      } satisfies HostedExecutionDeviceSyncWakeEvent;
    case "runtime.pending-effects-reconcile-requested":
      assertExactHostedExecutionKeys(record, [
        "effectId",
        "kind",
        "userId",
      ], "Hosted execution runtime.pending-effects-reconcile-requested event");
      return {
        effectId: requireString(
          record.effectId,
          "Hosted execution runtime.pending-effects-reconcile-requested event effectId",
        ),
        kind,
        userId,
      };
    case "runtime.manual-requested":
    case "runtime.maintenance-requested":
    case "runtime.browser-vault-refresh-requested":
    case "runtime.device-sync-recovery-requested":
    case "runtime.mailbox-lag-observed":
      return {
        kind: kind as HostedExecutionPlainRuntimeControlWakeKind,
        userId,
      };
    case "runtime.codex-auth-requested":
      assertExactHostedExecutionKeys(record, [
        "action",
        "attemptId",
        "kind",
        "userId",
      ], "Hosted execution runtime.codex-auth-requested event");
      return {
        action: parseHostedCodexAuthAction(record.action),
        attemptId: parseHostedCodexAuthAttemptId(record.attemptId),
        kind,
        userId,
      };
    default:
      throw new TypeError(`Unsupported hosted execution event kind: ${kind}`);
  }
}

function parseHostedExecutionAssistantNotificationRequestedPayload(
  value: unknown,
  label: string,
): HostedExecutionAssistantNotificationRequestedPayload {
  const record = requireObject(value, label);

  return {
    ...(record.deliveryDedupeToken === undefined
      ? {}
      : {
          deliveryDedupeToken: readNullableString(
            record.deliveryDedupeToken,
            `${label}.deliveryDedupeToken`,
          ),
        }),
    ...(record.deliveryDispatchMode === undefined
      ? {}
      : {
          deliveryDispatchMode: record.deliveryDispatchMode === null
            ? null
            : parseHostedExecutionAssistantNotificationDeliveryDispatchMode(
                record.deliveryDispatchMode,
                `${label}.deliveryDispatchMode`,
              ),
        }),
    ...(record.deliveryIdempotencyKey === undefined
      ? {}
      : {
          deliveryIdempotencyKey: readNullableString(
            record.deliveryIdempotencyKey,
            `${label}.deliveryIdempotencyKey`,
          ),
        }),
    ...(record.externalThreadRouteAuthority === undefined
      ? {}
      : {
          externalThreadRouteAuthority:
            parseOptionalHostedExecutionExternalThreadRouteAuthority(
              record.externalThreadRouteAuthority,
              `${label}.externalThreadRouteAuthority`,
            ),
        }),
    ...(record.firstContact === undefined
      ? {}
      : {
          firstContact: record.firstContact === null
            ? null
            : parseHostedExecutionAssistantNotificationFirstContactPolicy(
                record.firstContact,
                `${label}.firstContact`,
              ),
        }),
    ...(record.groupContextHandoff === undefined
      ? {}
      : {
          groupContextHandoff:
            parseHostedExecutionGroupContextHandoffNotification(
              record.groupContextHandoff,
              `${label}.groupContextHandoff`,
            ),
        }),
    instructions: requireString(record.instructions, `${label}.instructions`),
    ...(record.notificationPromptProfile === undefined
      ? {}
      : {
          notificationPromptProfile: record.notificationPromptProfile === null
            ? null
            : parseHostedExecutionAssistantNotificationPromptProfile(
                record.notificationPromptProfile,
                `${label}.notificationPromptProfile`,
              ),
        }),
    ...(record.privateAssistantAskCompletion === undefined
      ? {}
      : {
          privateAssistantAskCompletion:
            parseHostedExecutionPrivateAssistantAskCompletionNotification(
              record.privateAssistantAskCompletion,
              `${label}.privateAssistantAskCompletion`,
            ),
        }),
    ...(record.responsePolicy === undefined
      ? {}
      : {
          responsePolicy: record.responsePolicy === null
            ? null
            : parseHostedExecutionAssistantNotificationResponsePolicy(
                record.responsePolicy,
                `${label}.responsePolicy`,
              ),
        }),
    route: parseHostedExecutionAssistantNotificationRoute(record.route, `${label}.route`),
  };
}

function parseHostedExecutionGroupContextHandoffNotification(
  value: unknown,
  label: string,
): HostedExecutionGroupContextHandoffNotification {
  const record = requireObject(value, label);
  assertExactHostedExecutionKeys(
    record,
    ["membershipId", "originAssistantInputId"],
    label,
  );
  const membershipId = requireString(
    record.membershipId,
    `${label}.membershipId`,
  );
  if (
    membershipId.trim() !== membershipId
    || !membershipId
    || [...membershipId].length > 256
  ) {
    throw new TypeError(`${label}.membershipId is invalid.`);
  }
  return {
    membershipId,
    originAssistantInputId: parseHostedExecutionAssistantAskOriginInputId(
      record.originAssistantInputId,
      `${label}.originAssistantInputId`,
    ),
  };
}

function parseHostedExecutionPrivateAssistantAskCompletionNotification(
  value: unknown,
  label: string,
): HostedExecutionPrivateAssistantAskCompletionNotification {
  const record = requireObject(value, label);
  assertExactHostedExecutionKeys(record, ["expiresAt", "requestId"], label);
  const requestId = requireString(record.requestId, `${label}.requestId`);
  if (!/^aask_req_[0-9a-f]{64}$/u.test(requestId)) {
    throw new TypeError(`${label}.requestId is invalid.`);
  }
  return {
    expiresAt: parseHostedExecutionAssistantAskTimestamp(
      record.expiresAt,
      `${label}.expiresAt`,
    ),
    requestId,
  };
}

function parseHostedExecutionAssistantNotificationPromptProfile(
  value: unknown,
  label: string,
): HostedExecutionAssistantNotificationPromptProfile {
  const profile = requireString(value, label);
  if (
    HOSTED_EXECUTION_ASSISTANT_NOTIFICATION_PROMPT_PROFILES.includes(
      profile as HostedExecutionAssistantNotificationPromptProfile,
    )
  ) {
    return profile as HostedExecutionAssistantNotificationPromptProfile;
  }
  throw new TypeError(
    `${label} must be one of ${HOSTED_EXECUTION_ASSISTANT_NOTIFICATION_PROMPT_PROFILES.join(", ")}.`,
  );
}

function parseHostedExecutionMemberActivationSignupWelcome(
  value: unknown,
  label: string,
): HostedExecutionMemberActivationSignupWelcome {
  const record = requireObject(value, label);

  return {
    route: parseHostedExecutionAssistantNotificationRoute(record.route, `${label}.route`),
    text: requireString(record.text, `${label}.text`),
  };
}

function parseHostedExecutionAssistantNotificationDeliveryDispatchMode(
  value: unknown,
  label: string,
): HostedExecutionAssistantNotificationDeliveryDispatchMode {
  const mode = requireString(value, label);

  if (mode !== "immediate" && mode !== "queue-only") {
    throw new TypeError(`${label} is invalid.`);
  }

  return mode;
}

function parseHostedExecutionAssistantNotificationResponsePolicy(
  value: unknown,
  label: string,
): HostedExecutionAssistantNotificationResponsePolicy {
  const record = requireObject(value, label);
  const kind = requireString(record.kind, `${label}.kind`);

  switch (kind) {
    case "allow_send_or_skip":
    case "require_send":
      return { kind };
    case "require_send_exact_text":
      return {
        kind,
        text: requireString(record.text, `${label}.text`),
      };
    default:
      throw new TypeError(`${label}.kind is invalid.`);
  }
}

function parseHostedExecutionAssistantNotificationFirstContactPolicy(
  value: unknown,
  label: string,
): HostedExecutionAssistantNotificationFirstContactPolicy {
  const record = requireObject(value, label);

  return {
    markSeenOnDeliveryAccepted: requireBoolean(
      record.markSeenOnDeliveryAccepted,
      `${label}.markSeenOnDeliveryAccepted`,
    ),
  };
}

export function parseHostedExecutionAssistantNotificationRoute(
  value: unknown,
  label: string,
): HostedExecutionAssistantNotificationRequestedPayload["route"] {
  const record = requireObject(value, label);
  const channel = parseHostedConversationMessageChannel(record.channel, `${label}.channel`);

  return {
    actorId: readNullableString(record.actorId, `${label}.actorId`),
    channel,
    delivery: parseHostedExecutionAssistantNotificationDelivery(
      record.delivery,
      `${label}.delivery`,
    ),
    identityId: readNullableString(record.identityId, `${label}.identityId`),
    threadId: readNullableString(record.threadId, `${label}.threadId`),
    threadIsDirect: record.threadIsDirect === null
      ? null
      : requireBoolean(record.threadIsDirect, `${label}.threadIsDirect`),
  };
}

export function parseHostedExecutionPrivateAssistantAskCompletionDeliveryAuthority(
  value: unknown,
  label = "Hosted execution private Assistant Ask completion delivery authority",
): HostedExecutionPrivateAssistantAskCompletionDeliveryAuthority {
  const record = requireObject(value, label);
  assertExactHostedExecutionKeys(record, [
    "answeredMailboxItemIds",
    "assistantAskCompletionExpiresAt",
    "idempotencyKey",
    "responseTextDigest",
    "route",
  ], label);
  const answeredMailboxItemIds = requireArray(
    record.answeredMailboxItemIds,
    `${label}.answeredMailboxItemIds`,
  ).map((entry, index) => requireString(
    entry,
    `${label}.answeredMailboxItemIds[${index}]`,
  ));
  const completionId = answeredMailboxItemIds[0] ?? "";
  if (
    answeredMailboxItemIds.length !== 1
    || !completionId.trim()
    || completionId.trim() !== completionId
    || [...completionId].length > 256
  ) {
    throw new TypeError(`${label}.answeredMailboxItemIds is invalid.`);
  }
  const idempotencyKey = requireString(
    record.idempotencyKey,
    `${label}.idempotencyKey`,
  );
  if (
    idempotencyKey.trim() !== idempotencyKey
    || idempotencyKey
      !== createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(
        completionId,
      )
  ) {
    throw new TypeError(`${label}.idempotencyKey is invalid.`);
  }
  const responseTextDigest = requireString(
    record.responseTextDigest,
    `${label}.responseTextDigest`,
  );
  if (!/^[0-9a-f]{64}$/u.test(responseTextDigest)) {
    throw new TypeError(`${label}.responseTextDigest is invalid.`);
  }
  return {
    answeredMailboxItemIds,
    assistantAskCompletionExpiresAt:
      parseHostedExecutionAssistantAskTimestamp(
        record.assistantAskCompletionExpiresAt,
        `${label}.assistantAskCompletionExpiresAt`,
      ),
    idempotencyKey,
    responseTextDigest,
    route: parseHostedExecutionAssistantNotificationRoute(
      record.route,
      `${label}.route`,
    ),
  };
}

export function parseHostedExecutionDirectRoute(
  value: unknown,
  label = "Hosted execution direct route",
): HostedExecutionDirectRoute {
  const record = requireObject(value, label);
  const channel = requireString(record.channel, `${label}.channel`);
  if (channel === "email") {
    assertExactHostedExecutionKeys(record, ["channel", "deliveryTarget"], label);
    return {
      channel,
      deliveryTarget: requireString(
        record.deliveryTarget,
        `${label}.deliveryTarget`,
      ),
    };
  }
  if (channel === "linq" || channel === "telegram") {
    assertExactHostedExecutionKeys(record, ["channel", "threadId"], label);
    return {
      channel,
      threadId: requireString(record.threadId, `${label}.threadId`),
    };
  }

  throw new TypeError(`${label}.channel is invalid.`);
}

function parseHostedExecutionAssistantNotificationDelivery(
  value: unknown,
  label: string,
): HostedExecutionAssistantNotificationDelivery {
  const record = requireObject(value, label);
  const kind = requireString(record.kind, `${label}.kind`);

  if (kind !== "explicit" && kind !== "participant" && kind !== "thread") {
    throw new TypeError(`${label}.kind is invalid.`);
  }

  return {
    kind,
    ...(record.source === undefined
      ? {}
      : {
          source: record.source === null
            ? null
            : parseHostedExecutionAssistantNotificationDeliverySource(
                record.source,
                `${label}.source`,
              ),
        }),
    target: requireString(record.target, `${label}.target`),
  };
}

function parseHostedExecutionAssistantNotificationDeliverySource(
  value: unknown,
  label: string,
): HostedExecutionAssistantNotificationDeliverySource {
  const record = requireObject(value, label);
  const kind = requireString(record.kind, `${label}.kind`);

  if (kind !== "linq") {
    throw new TypeError(`${label}.kind is invalid.`);
  }

  return {
    fromPhoneNumber: requireString(record.fromPhoneNumber, `${label}.fromPhoneNumber`),
    kind,
  };
}

function parseHostedExecutionMemberChannels(
  value: unknown,
  label: string,
): HostedExecutionMemberChannels {
  const record = requireObject(value, label);

  return {
    email: requireBoolean(record.email, `${label}.email`),
    linq: requireBoolean(record.linq, `${label}.linq`),
    telegram: requireBoolean(record.telegram, `${label}.telegram`),
  };
}

function parseHostedExecutionMemberPreferences(
  value: unknown,
  label: string,
): HostedExecutionMemberPreferences {
  const record = requireObject(value, label);
  const persona = record.persona === undefined
    ? undefined
    : parseHostedExecutionAssistantPersonaPreference(
        record.persona,
        `${label}.persona`,
      );
  const tone = record.tone === undefined
    ? undefined
    : parseHostedExecutionAssistantTonePreference(record.tone, `${label}.tone`);
  const voice = record.voice === undefined
    ? undefined
    : parseHostedExecutionAssistantVoicePreference(record.voice, `${label}.voice`);
  const personality = record.personality === undefined
    ? undefined
    : parseHostedExecutionMemberPersonalityPreferences(
        record.personality,
        `${label}.personality`,
      );

  if (
    persona === undefined
    && tone === undefined
    && voice === undefined
    && personality === undefined
  ) {
    throw new TypeError(`${label} must include persona, tone, voice, or personality.`);
  }

  return {
    ...(persona === undefined ? {} : { persona }),
    ...(personality === undefined ? {} : { personality }),
    ...(tone === undefined ? {} : { tone }),
    ...(voice === undefined ? {} : { voice }),
  };
}

function parseHostedExecutionMemberPersonalityPreferences(
  value: unknown,
  label: string,
): HostedExecutionMemberPersonalityPreferences {
  const record = requireObject(value, label);
  for (const key of Object.keys(record)) {
    if (!isAssistantPersonalitySettingId(key)) {
      throw new TypeError(`${label}.${key} is not a personality setting.`);
    }
  }

  const personality: HostedExecutionMemberPersonalityPreferences = {};
  for (const settingId of assistantPersonalitySettingIds) {
    const score = record[settingId];
    if (score === undefined) {
      continue;
    }
    if (score !== null && !isAssistantPersonalityScore(score)) {
      throw new TypeError(`${label}.${settingId} is invalid.`);
    }
    personality[settingId] = score;
  }

  if (Object.keys(personality).length === 0) {
    throw new TypeError(`${label} must include at least one setting.`);
  }

  return personality;
}

function parseHostedExecutionAssistantPersonaPreference(
  value: unknown,
  label: string,
): HostedExecutionMemberPreferences["persona"] {
  const persona = requireString(value, label);
  const normalizedPersona = normalizeStoredAssistantPersonaId(persona);
  if (!normalizedPersona) {
    throw new TypeError(`${label} is invalid.`);
  }
  return normalizedPersona;
}

function parseHostedExecutionAssistantTonePreference(
  value: unknown,
  label: string,
): HostedExecutionMemberPreferences["tone"] {
  const tone = requireString(value, label);
  if (!isAssistantTonePreference(tone)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return tone;
}

function parseHostedExecutionAssistantVoicePreference(
  value: unknown,
  label: string,
): HostedExecutionMemberPreferences["voice"] {
  const voice = requireString(value, label);
  if (!isAssistantVoiceOptionId(voice)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return voice;
}

function parsePreferenceCausalMetadata(
  record: Record<string, unknown>,
): Pick<
  HostedExecutionMemberPreferencesUpdatedEvent,
  "causalOrigin" | "preferenceCausalSeq"
> {
  const causalOrigin = record.causalOrigin;
  if (
    causalOrigin !== undefined
    && causalOrigin !== "event"
    && causalOrigin !== "turn"
  ) {
    throw new TypeError("Hosted preference causalOrigin is invalid.");
  }
  const preferenceCausalSeq = record.preferenceCausalSeq;
  if (
    preferenceCausalSeq !== undefined
    && (
      typeof preferenceCausalSeq !== "string"
      || !/^(0|[1-9]\d*)$/u.test(preferenceCausalSeq)
    )
  ) {
    throw new TypeError("Hosted preference preferenceCausalSeq is invalid.");
  }
  return {
    ...(causalOrigin === undefined ? {} : { causalOrigin }),
    ...(preferenceCausalSeq === undefined ? {} : { preferenceCausalSeq }),
  };
}

function parsePreferenceRequestedFields(
  record: Record<string, unknown>,
): Pick<HostedExecutionMemberPreferencesUpdatedEvent, "requestedFields"> {
  const value = record.requestedFields;
  if (value === undefined) {
    return {};
  }
  if (
    !Array.isArray(value)
    || value.some(
      (field) => field !== "persona" && field !== "tone" && field !== "voice",
    )
    || new Set(value).size !== value.length
  ) {
    throw new TypeError("Hosted preference requestedFields is invalid.");
  }
  return { requestedFields: [...value] };
}

function parseHostedExecutionWakeKind(value: unknown, label: string): HostedExecutionWakeKind {
  const kind = requireString(value, label);
  if (!isHostedExecutionWakeKind(kind)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return kind;
}

function parseHostedExecutionPositiveGeneration(value: unknown, label: string): number {
  const generation = requireNumber(value, label);
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return generation;
}

function assertExactHostedClinicalRecordsKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${label} contains unsupported field ${JSON.stringify(key)}.`);
    }
  }
}

function parseHostedCodexAuthAction(value: unknown): HostedCodexAuthAction {
  const action = requireString(value, "Hosted Codex auth action");
  if (action === "connect" || action === "disconnect") {
    return action;
  }
  throw new TypeError("Hosted Codex auth action is invalid.");
}

function parseHostedCodexAuthAttemptId(value: unknown): string {
  const attemptId = requireString(value, "Hosted Codex auth attemptId");
  if (!/^hca_[A-Za-z0-9_-]{16,64}$/u.test(attemptId)) {
    throw new TypeError("Hosted Codex auth attemptId is invalid.");
  }
  return attemptId;
}

function assertExactHostedExecutionKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${label} contains unsupported field ${JSON.stringify(key)}.`);
    }
  }
}

function assertExactHostedMealPhotoKeys(record: Record<string, unknown>): void {
  const allowed = new Set([
    "byteLength",
    "captureId",
    "capturedAt",
    "mealPhotoKey",
    "sha256",
  ]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new TypeError(
        `Hosted execution meal-photo.captured payload contains unsupported field ${JSON.stringify(key)}.`,
      );
    }
  }
}

function assertExactHostedEnvironmentVoiceKeys(
  record: Record<string, unknown>,
): void {
  const allowed = new Set([
    "audioKey",
    "byteLength",
    "captureId",
    "capturedAt",
    "contentType",
    "durationMs",
    "sha256",
  ]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new TypeError(
        `Hosted execution environment-voice.captured payload contains unsupported field ${JSON.stringify(key)}.`,
      );
    }
  }
}

function parseHostedConversationMessageChannel(
  value: unknown,
  label: string,
): HostedExecutionConversationMessageWake["message"]["channel"] {
  const channel = requireString(value, label);

  if (!isHostedConversationMessageChannel(channel)) {
    throw new TypeError(`${label} is invalid.`);
  }

  return channel;
}
