import { createHash } from "node:crypto";

import {
  buildHostedExecutionSafeErrorDiagnostics,
  buildHostedExecutionRuntimeTimerWake,
  deriveHostedExecutionErrorCode,
  sanitizeHostedExecutionStructuredLogDetails,
  sanitizeHostedExecutionStructuredLogText,
  type HostedExecutionSystemWake,
  type HostedExecutionRedactedLogEntry,
  type HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";
import {
  HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX,
  HOSTED_RUNTIME_GROUP_SENDER_HANDLE_MAX_CODE_POINTS,
  type HostedRuntimeGroupToolLinqThreadContext,
  type HostedRuntimeGroupToolRequest,
  type HostedRuntimeGroupToolResponse,
  type HostedRuntimeGroupToolSelfOptOutContext,
  type HostedRuntimeProductFeedbackRecord,
  type HostedRuntimeUsageReferralSourceContext,
  type HostedWorkspaceCheckpointReason,
  type HostedRuntimeRedactedJson,
  type HostedRuntimeRedactedObject,
  type HostedRuntimeRedactedScalar,
} from "@murphai/hosted-execution/runtime-control";
import type { AssistantUsageRecord } from "@murphai/hosted-execution/assistant-usage";
import {
  buildHostedVaultShareProjectionScopeKey,
} from "@murphai/hosted-execution/vault-share";
import {
  HOSTED_ASSISTANT_TURN_TIMING_SCHEMA,
  HOSTED_ASSISTANT_TURN_TIMING_TYPE,
  MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID,
  MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
  applyMurphManagedAutomations,
  getAssistantCronAutomationTimingProjection,
  getAssistantCronStatus,
  isCanonicalOnboardingFirstPersonalReadAutomationSaveRequest,
  readAssistantOnboardingState,
  recordHostedMailboxAssistantInputItem,
  readAssistantInputEvent,
  readAssistantOutboxIntent,
  refreshAssistantContextSnapshotBestEffort,
  refreshReminderAvailability,
  resolveAssistantCronDefaultTimeZoneProjection,
  scheduleDeviceActivityTriggeredAutomations,
  upsertAssistantInputEvent,
  type AssistantCronStatusOptions,
  type AssistantAutomationTimingVerificationIssue,
  type AssistantBeforeProviderAcceptedInputsHook,
  type AssistantAutomationOperationScope,
  type AssistantExecutionContext,
  type AssistantHostedGroupPermissionOfferTool,
  type AssistantHostedGroupSharedReader,
  type AssistantHostedImageGenerationLauncher,
  type AssistantInputEventRecord,
  type AssistantProviderStartCriticalPathContext,
  type MurphManagedAutomationDiagnosticStage,
  type MurphOnboardingFollowupDiagnostic,
  type AssistantTurnEnvironment,
  type HostedAssistantTurnTimingStage,
  stampAssistantProviderStartCriticalPath,
} from "@murphai/assistant-engine";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import {
  AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG,
  AUTOMATION_SUPPORT_SERIES_TAG_PREFIX,
  automationRouteSchema,
  buildAutomationSupportSeriesTag,
  type AutomationRoute,
} from "@murphai/contracts";
import {
  AutomationAvailabilityConflictBlockError,
  patchAutomation,
  reconcileAutomationSupportSeries,
  resolveAutomationUpsertSlug,
  showAutomation,
  stripAutomationAvailabilityConflictBlock,
  upsertAutomation,
  type AutomationRecord,
} from "@murphai/core";
import {
  findAssistantAutoReplyDeliveryIntentIds,
} from "@murphai/assistant-engine/assistant-automation";
import {
  maintainAssistantAutoReplyRouteState,
} from "@murphai/assistant-engine/assistant-runtime-residue";
import {
  resolveDeliveryCandidates,
} from "@murphai/assistant-engine/assistant-channel-adapters";
import type { DeviceSyncJobFailureEventOrigin } from "@murphai/device-syncd/types";
import {
  isDeviceConnectSourceAvailableForConnection,
  listConfiguredDeviceSyncConnectTargets,
  listConfiguredDeviceSyncReconnectTargets,
} from "@murphai/device-syncd/connect-config";
import {
  type AssistantCurrentDeliveryRoute,
  getAssistantAutomationRouteDeliverabilityIssue,
  normalizeAssistantRouteString,
  resolveAssistantDeliveryRouteConversationKey,
  resolveAssistantDeliveryRouteWithCurrentRoute,
} from "@murphai/operator-config/assistant/current-delivery-route";

import {
  fetchCompleteHostedDeviceSyncRuntimeSnapshot,
} from "./device-sync-snapshot-pagination.ts";
import {
  collectHostedAssistantDeliverySideEffects,
  createHostedAssistantProgressDeliveryDependencies,
  drainHostedPreparedAssistantDeliveries,
  prepareHostedAssistantDeliveryEffectsForDispatch,
  queueHostedAssistantPendingMessageVolumeReceiptsForVault,
  resetHostedPreparedAssistantDeliveryEffects,
  resolveHostedAssistantOutboxNextWakeAt,
  type HostedAssistantDeliveryPreparation,
} from "./callbacks.ts";
import {
  buildHostedLinqChannelEnv,
  createHostedAssistantChannelTypingDependencies,
} from "./channel-activity.ts";
import {
  createHostedAssistantTurnEnvironment,
} from "./environment.ts";
import {
  createHostedBackgroundMaintenanceCancellation,
} from "./background-maintenance-cancellation.ts";
import {
  hydrateHostedExecutionDefaultTarget,
  prepareHostedAssistantAutomationForWake,
} from "./context.ts";
import {
  readHostedAssistantInputCurrentDeliveryRoute,
  resolveUnambiguousCurrentDeliveryRoute,
} from "./current-delivery-route.ts";
import {
  runHostedAssistantAutomationLane,
} from "./maintenance.ts";
import {
  isHostedDeviceSyncMaintenanceModuleLoadError,
  loadHostedDeviceSyncMaintenanceModule,
} from "./device-sync-maintenance-import.ts";
import {
  buildHostedDeviceSyncStatusPrompt,
  type HostedDeviceSyncStatusPromptReconnectTarget,
} from "./device-sync-status-prompt.ts";
import {
  createHostedGroupParticipantDisplayNameReader,
  createHostedGroupSharedReader,
  normalizeHostedGroupSharedProjectionScopes,
} from "./group-shared-reader.ts";
import {
  resolveHostedOldestAssistantInputOccurredAt,
  resolveHostedOldestPendingAssistantInputAt,
  resolveHostedPendingAssistantInputWakeAt,
} from "./pending-assistant-input.ts";
import {
  enqueueHostedPendingAssistantInputId,
} from "./pending-input-index.ts";
import {
  drainHostedProviderCleanupAfterCommit,
  recordHostedProviderCleanupAfterDelivery,
  resolveHostedProviderCleanupScheduledWakeAt,
  type HostedProviderCleanupCheckpoint,
  type HostedProviderCleanupPlan,
  prepareHostedProviderCleanupPlan,
} from "./provider-cleanup.ts";
import { normalizeHostedFutureWakeAt } from "./wake-time.ts";
import {
  prepareHostedSystemMailboxItemForCheckpoint,
  recordHostedDeviceSyncDirtyPostCheckpointRecord,
  recordHostedSystemMailboxItemAfterCheckpoint,
  resolveHostedSystemMailboxNextWakeAt,
  resolveHostedSystemMailboxNextWakeCandidate,
  type HostedSystemMailboxCheckpointPreparation,
  type HostedSystemMailboxPendingItem,
  type HostedSystemMailboxRouteAction,
} from "./system-mailbox.ts";
import type {
  HostedAssistantLinqDeliveryContext,
} from "./linq-delivery-context.ts";
import type {
  HostedAssistantEmailDeliveryContext,
} from "./email-delivery-context.ts";
import type {
  HostedRuntimePlatform,
  HostedRuntimeDeviceSyncMessagingReturnTarget,
} from "./platform.ts";
import type {
  HostedAssistantDeliveryOutcome,
  HostedAssistantWorkspaceRuntimeJobInput,
  HostedDeviceSyncDirtyProcessedPostCheckpointRecord,
  HostedMaintenanceMetrics,
  HostedRestoredExecutionContext,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import {
  buildHostedRuntimeLogContextFields,
  summarizeHostedRuntimeStatusCounts,
  toHostedRuntimeLogCode,
  writeHostedRuntimeLogBestEffort,
} from "./runtime-logs.ts";
import type {
  HostedWorkspaceDurableCheckpointEffect,
  HostedWorkspaceDurableCheckpointEffectContext,
  HostedWorkspaceRunnerAssistantPhaseInput,
  HostedWorkspaceRunnerAssistantPhasePostCheckpoint,
  HostedWorkspaceRunnerAssistantPhaseResult,
} from "./workspace-runner.ts";
import {
  HOSTED_ASSISTANT_WAKE_REASON,
  HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
  HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
  createHostedRuntimeWakeCandidate,
  hostedRuntimeWakeReasonUsesAssistantPhase,
  selectHostedRuntimeWakeCandidate,
  type HostedRuntimeWakeCandidate,
} from "./wake-candidates.ts";

const HOSTED_DEVICE_SYNC_DIRTY_ACK_FAILURE_RETRY_DELAY_MS = 60_000;
const HOSTED_OUTBOX_DELIVERY_ERROR_LOG_LIMIT = 16;
const OUTBOX_DELIVERY_FAILED_INPUT_PREFIX = "outbox-delivery-failed";
const OUTBOX_DELIVERY_FAILED_PAYLOAD_SCHEMA =
  "murph.outbox-delivery-failed.v1";
const OUTBOX_DELIVERY_FAILED_WAKE_SCHEMA =
  "murph.hosted-runtime-outbox-delivery.v1";
const ASSISTANT_INPUT_EVENT_SAFE_TOKEN_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,191}$/u;

const HOSTED_RUNTIME_REDACTED_TEXT_MAX_LENGTH = 2048;
const HOSTED_RUNTIME_BLOCKED_LOG_KEY_PARTS = [
  "payload",
  "preview",
  "prompt",
  "transcript",
  "vault",
] as const;
const HOSTED_RUNTIME_SECRET_VALUE_KEY_PARTS = [
  "authorization",
  "cookie",
  "password",
  "secret",
  "token",
] as const;
const HOSTED_RUNTIME_ERROR_DESCRIPTION_KEY_PARTS = [
  "cause",
  "detail",
  "error",
  "exception",
  "failure",
  "message",
  "reason",
  "status",
] as const;
const HOSTED_RUNTIME_ALLOWED_LOG_KEY_NAMES = new Set([
  "localPathPreview",
]);
const HOSTED_ASSISTANT_AUTOMATION_DETAIL_MAX_KEYS = 40;
const HOSTED_ASSISTANT_CRON_STATUS_RETRY_DELAY_MS = 30_000;
const HOSTED_ASSISTANT_CRON_STATUS_YIELD_POLL_MS = 100;
const ASSISTANT_AUTOMATION_DELIVERY_AUTHORITY_STALE =
  "ASSISTANT_AUTOMATION_DELIVERY_AUTHORITY_STALE";
const HOSTED_MANAGED_AUTOMATION_SETUP_RETRY_DELAY_MS = 30_000;
const HOSTED_MANAGED_AUTOMATION_SETUP_FAILURE_RETRY_DELAYS_MS = [
  30_000,
  120_000,
  600_000,
] as const;
const HOSTED_MANAGED_AUTOMATION_SETUP_RETRY_ATTEMPT_STATUS_KEY =
  "murphManagedAutomationSetupRetryAttempt";
const HOSTED_MANAGED_AUTOMATION_SETUP_TRANSIENT_ERROR_CODES = new Set([
  "EAGAIN",
  "EAI_AGAIN",
  "EBUSY",
  "ECONNRESET",
  "EINTR",
  "EMFILE",
  "ENFILE",
  "ETIMEDOUT",
]);
const HOSTED_SKIPPED_DEVICE_SYNC_RETRY_DELAY_MS = 30_000;
const HOSTED_DEFERRED_PENDING_ASSISTANT_INPUT_RETRY_DELAY_MS = 30_000;
const HOSTED_DEVICE_SYNC_STATUS_PROMPT_TIMEOUT_MS = 1_000;
const HOSTED_MEMBER_CHANNEL_UPDATE_ROUTE_ACTIONS = ["apply-member-channels-update"] as const;
const HOSTED_MEMBER_PREFERENCE_PRE_PLANNING_ROUTE_ACTIONS = [
  "apply-member-preferences",
] as const;
const HOSTED_POST_FOREGROUND_MEMBER_MAINTENANCE_ROUTE_ACTIONS = [
  "apply-member-activation",
  "apply-member-action",
] as const;
const HOSTED_POST_FOREGROUND_MEMBER_MAINTENANCE_WAKE_KINDS = [
  "member.activated",
  "member.action.requested",
] as const;
const HOSTED_SHADOWED_DEVICE_SYNC_ROUTE_ACTIONS = [
  "run-device-sync-wake",
] as const;
const HOSTED_SHADOWED_DEVICE_SYNC_WAKE_KINDS = [
  "device-sync.wake",
] as const;
const HOSTED_GROUP_ROOM_MODEL_PRE_PLANNING_ROUTE_ACTIONS = [
  "initialize-group-room-model",
] as const;
const HOSTED_FOREGROUND_CAUSAL_ROUTE_ACTIONS = [
  "apply-runtime-control-request",
  "continue-assistant-ask",
] as const;
const HOSTED_FOREGROUND_CAUSAL_WAKE_KINDS = [
  "runtime.pending-effects-reconcile-requested",
  "assistant.ask.completed",
] as const;
const HOSTED_PRE_CHECKPOINT_CAUSAL_ROUTE_ACTIONS = [
  "apply-runtime-control-request",
] as const;
const HOSTED_PRE_CHECKPOINT_CAUSAL_WAKE_KINDS = [
  "runtime.pending-effects-reconcile-requested",
] as const;
const HOSTED_PRE_CHECKPOINT_EXTERNAL_COMPLETION_ROUTE_ACTIONS = [
  "dispatch-assistant-notification",
] as const;
const HOSTED_PRE_CHECKPOINT_EXTERNAL_COMPLETION_WAKE_KINDS = [
  "assistant.notification.requested",
] as const;
const HOSTED_PHONE_CALL_RESULT_MAILBOX_DEDUPE_KEY_PREFIX =
  "assistant.notification.requested:phone-call-result:";
const HOSTED_PRE_CHECKPOINT_EXTERNAL_COMPLETION_DEDUPE_KEY_PREFIXES = [
  HOSTED_PHONE_CALL_RESULT_MAILBOX_DEDUPE_KEY_PREFIX,
  "assistant.notification.requested:usage-referral-reward:",
  "aask_done_",
  "aask_private_",
] as const;
const HOSTED_PRE_CHECKPOINT_ASSISTANT_ASK_COMPLETION_ROUTE_ACTIONS = [
  "continue-assistant-ask",
] as const;
const HOSTED_PRE_CHECKPOINT_ASSISTANT_ASK_COMPLETION_WAKE_KINDS = [
  "assistant.ask.completed",
] as const;
const HOSTED_ASSISTANT_ASK_COMPLETION_FIRST_ATTEMPT_ALERT_MS = 60_000;
const HOSTED_MEMBER_PREFERENCE_PRE_PLANNING_MAX_ITEMS = 10;

export interface HostedWorkspaceRuntimeAssistantPhaseInput
  extends HostedWorkspaceRunnerAssistantPhaseInput {
  foregroundCausalOnly?: boolean;
  deviceSyncMessagingReturnTarget?: HostedRuntimeDeviceSyncMessagingReturnTarget | null;
  request: HostedAssistantWorkspaceRuntimeJobInput["request"];
  restored: HostedRestoredExecutionContext;
  runtime: Pick<
    NormalizedHostedAssistantRuntimeConfig,
    "commitTimeoutMs" | "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
  >;
  runtimeEnv: Readonly<Record<string, string>>;
  beforeProviderAcceptedInputs?: AssistantBeforeProviderAcceptedInputsHook | null;
  providerStartCriticalPath?: AssistantProviderStartCriticalPathContext | null;
  currentAssistantInputId?: () => string | null;
  imageGenerationLauncher?: AssistantHostedImageGenerationLauncher | null;
  stagedDirtyAcks?: readonly HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] | null;
  suppressDirtyPendingFetch?: boolean;
  signal?: AbortSignal | null;
}

export type HostedWorkspaceRuntimeAssistantPhase = (
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
) => Promise<HostedWorkspaceRunnerAssistantPhaseResult>;

type HostedUsageReferralLinqService = "imessage" | "rcs" | "sms";

/**
 * The chat-scoped murph.group actions need the raw Linq chat id and the
 * thread-route egress authority, which live only in wake-derived delivery
 * contexts (the web DB stores hashed lookup keys). Inject them here so the
 * model never supplies its own thread target.
 *
 * Aggregate current-turn sender handles used by shared reads are injected the
 * same way. Participant-specific effects arrive with exact accepted-message
 * evidence already resolved by assistant-engine, so this wrapper does not
 * infer one owner from the whole turn.
 */
export function createHostedGroupToolWithCurrentTurnContext(input: {
  currentDeliveryRoute?: AssistantCurrentDeliveryRoute | null;
  emailDeliveryContexts?: readonly HostedAssistantEmailDeliveryContext[] | null;
  groupEmailIngress?: boolean;
  groupToolPort: NonNullable<HostedRuntimePlatform["groupToolPort"]>;
  linqDeliveryContexts: readonly HostedAssistantLinqDeliveryContext[];
  linqService?: HostedUsageReferralLinqService | null;
  telegramSenderHandles?: readonly string[];
}): NonNullable<HostedRuntimePlatform["groupToolPort"]> {
  const emailIngressPresent = input.groupEmailIngress === true
    || (input.emailDeliveryContexts?.length ?? 0) > 0;
  return {
    directAttachmentRouteStatus() {
      const linqRoute = resolveHostedDirectToolLinqRouteContext(
        input.linqDeliveryContexts,
      );
      if (linqRoute?.service === "imessage") {
        return { status: "ok" };
      }
      return {
        status: "unavailable",
        unavailableReason: linqRoute?.service === "sms"
          ? "sms_attachments_unsupported"
          : "direct_attachment_route_unavailable",
      };
    },
    async request(request, context) {
      const forwardRequest = (forwardedRequest: HostedRuntimeGroupToolRequest) =>
        context
          ? input.groupToolPort.request(forwardedRequest, context)
          : input.groupToolPort.request(forwardedRequest);
      if (
        emailIngressPresent
        && request.action !== "read_current"
        && request.action !== "read_usage"
        && request.action !== "read_shared"
      ) {
        return buildHostedGroupEmailRestrictedActionUnavailable(request);
      }
      if (request.action === "read_shared") {
        const sharedReadRequest = {
          action: request.action,
          projectionScopes: request.projectionScopes,
        };
        // Hosted email reply aliases authenticate a route, not the human From
        // header, so email ingress never carries sender evidence.
        const senderHandles = emailIngressPresent
          ? {}
          : resolveHostedGroupToolSenderHandles({
              linqDeliveryContexts: input.linqDeliveryContexts,
              telegramSenderHandles: input.telegramSenderHandles ?? [],
            });
        return await forwardRequest({
          ...sharedReadRequest,
          ...senderHandles,
        });
      }
      if (
        request.action === "read_usage_referral"
        || request.action === "arm_usage_referral"
        || request.action === "cancel_usage_referral"
      ) {
        const participant = request.action === "read_usage_referral"
          ? request.participant
          : null;
        const senderHandles = emailIngressPresent
          ? {}
          : participant?.source === "linq"
          ? { linqSenderHandles: [participant.senderHandle] }
          : participant?.source === "telegram"
          ? { telegramSenderHandles: [participant.senderHandle] }
          : resolveHostedGroupToolSenderHandles({
              linqDeliveryContexts: input.linqDeliveryContexts,
              telegramSenderHandles: input.telegramSenderHandles ?? [],
            });
        const sourceContext = resolveHostedUsageReferralSourceContext(
          input.currentDeliveryRoute,
          input.linqService,
        );
        const referralRequest = request.action === "read_usage_referral"
          ? { action: request.action }
          : request.action === "arm_usage_referral"
            ? {
              action: request.action,
              policyCodes: request.policyCodes,
            }
            : {
              action: request.action,
              policyCode: request.policyCode,
            };
        return await forwardRequest({
          ...referralRequest,
          ...senderHandles,
          ...(request.action !== "cancel_usage_referral"
            ? sourceContext
            : {}),
        });
      }
      if (
        request.action === "read_chat_participants"
      ) {
        const linqRoute = resolveHostedGroupToolLinqRouteContext(
          input.linqDeliveryContexts,
        );
        return await forwardRequest(
          linqRoute
            ? { ...request, linqThread: linqRoute.thread }
            : request,
        );
      }
      if (request.action === "post_join_offer") {
        const linqRoute = resolveHostedGroupToolLinqRouteContext(
          input.linqDeliveryContexts,
        );
        if (linqRoute?.service === "imessage") {
          return await forwardRequest({
            ...request,
            linqThread: linqRoute.thread,
          });
        }
        if (
          linqRoute?.service === "sms"
          || isHostedGroupToolTelegramGroupRoute(input.currentDeliveryRoute)
        ) {
          return await forwardRequest(
            buildHostedGroupJoinLinkFallbackRequest(request),
          );
        }
        return await forwardRequest(request);
      }
      if (
        request.action === "share_contact_card"
        && request.contactCardImageUrl !== undefined
      ) {
        const linqRoute = resolveHostedDirectToolLinqRouteContext(
          input.linqDeliveryContexts,
        );
        if (linqRoute?.service === "imessage") {
          return await forwardRequest({
            ...request,
            directLinqChatId: linqRoute.chatId,
          });
        }
        return linqRoute?.service === "sms"
          ? buildHostedGroupSmsUnsupportedResponse(request)
          : {
            action: "share_contact_card",
            result: {
              status: "unavailable",
              unavailableReason: "direct_attachment_route_unavailable",
            },
          };
      }
      if (
        request.action !== "update_display_name"
        && request.action !== "post_disclosure_request"
        && request.action !== "preflight_set_chat_avatar"
        && request.action !== "set_chat_avatar"
        && request.action !== "share_contact_card"
      ) {
        return await forwardRequest(request);
      }
      const linqRoute = resolveHostedGroupToolLinqRouteContext(
        input.linqDeliveryContexts,
      );
      if (linqRoute?.service === "imessage") {
        return await forwardRequest({
          ...request,
          linqThread: linqRoute.thread,
        });
      }
      return linqRoute?.service === "sms"
        ? buildHostedGroupSmsUnsupportedResponse(request)
        : await forwardRequest(request);
    },
  };
}

function isHostedGroupToolTelegramGroupRoute(
  route: AssistantCurrentDeliveryRoute | null | undefined,
): boolean {
  return normalizeAssistantRouteString(route?.channel)?.toLowerCase()
      === "telegram"
    && route?.threadIsDirect === false;
}

function buildHostedGroupJoinLinkFallbackRequest(
  request: Extract<HostedRuntimeGroupToolRequest, { action: "post_join_offer" }>,
): Extract<HostedRuntimeGroupToolRequest, { action: "create_join_link" }> {
  const joinOffer = request.joinOffer;
  if (!joinOffer) {
    return { action: "create_join_link" };
  }
  const projectionScopes = joinOffer.projectionScopes;
  const projectionKinds = joinOffer.projectionKinds;
  const joinLink = {
    ...(joinOffer.displayName
      ? { displayName: joinOffer.displayName }
      : {}),
    ...(projectionScopes !== undefined && projectionScopes !== null
      ? {
        requestedVaultShareProjectionScopes: [
          ...projectionScopes,
        ],
      }
      : projectionKinds !== undefined && projectionKinds !== null
        ? {
          requestedVaultShareProjectionKinds: [
            ...projectionKinds,
          ],
        }
        : {}),
  };
  return Object.keys(joinLink).length > 0
    ? { action: "create_join_link", joinLink }
    : { action: "create_join_link" };
}

type HostedRuntimeGroupSmsUnsupportedRequest = Extract<
  HostedRuntimeGroupToolRequest,
  {
    action:
      | "post_disclosure_request"
      | "preflight_set_chat_avatar"
      | "set_chat_avatar"
      | "share_contact_card"
      | "update_display_name";
  }
>;

function buildHostedGroupSmsUnsupportedResponse(
  request: HostedRuntimeGroupSmsUnsupportedRequest,
): HostedRuntimeGroupToolResponse {
  switch (request.action) {
    case "update_display_name":
      return {
        action: request.action,
        result: {
          group: null,
          status: "unavailable",
          unavailableReason: "sms_chat_customization_unsupported",
        },
      };
    case "preflight_set_chat_avatar":
    case "set_chat_avatar":
      return {
        action: request.action,
        result: {
          status: "unavailable",
          unavailableReason: "sms_chat_customization_unsupported",
        },
      };
    case "share_contact_card":
      return {
        action: request.action,
        result: {
          status: "unavailable",
          unavailableReason: "sms_attachments_unsupported",
        },
      };
    case "post_disclosure_request":
      return {
        action: request.action,
        result: {
          status: "unavailable",
          unavailableReason: "sms_reactions_unsupported",
        },
      };
  }
}

function resolveHostedUsageReferralSourceContext(
  route: AssistantCurrentDeliveryRoute | null | undefined,
  linqService: HostedUsageReferralLinqService | null | undefined,
): HostedRuntimeUsageReferralSourceContext {
  const channel = normalizeAssistantRouteString(route?.channel)?.toLowerCase();
  const threadId = normalizeAssistantRouteString(route?.threadId);
  if (
    (channel !== "linq" && channel !== "telegram")
    || !threadId
    || !/^hid_[a-f0-9]{32}$/u.test(threadId)
    || typeof route?.threadIsDirect !== "boolean"
  ) {
    return {};
  }
  return {
    sourceConversation: {
      channel,
      ...(channel === "linq" && linqService ? { linqService } : {}),
      threadId,
      threadIsDirect: route.threadIsDirect,
    },
  };
}

function buildHostedGroupEmailRestrictedActionUnavailable(
  request: Exclude<
    HostedRuntimeGroupToolRequest,
    {
      action:
        | "read_current"
        | "read_shared"
        | "read_usage";
    }
  >,
): HostedRuntimeGroupToolResponse {
  const unavailableReason = "authenticated_sender_required";
  switch (request.action) {
    case "ask":
    case "record_current_sender_daily_metric":
    case "ask_member":
      return {
        action: request.action,
        result: { status: "unavailable", unavailableReason },
      };
    case "ask_current_sender":
      return {
        action: "ask_current_sender",
        result: { status: "unavailable", unavailableReason },
      };
    case "list_memberships":
      return {
        action: request.action,
        result: { memberships: null, status: "unavailable", unavailableReason },
      };
    case "create_join_link":
    case "post_join_offer":
    case "update_display_name":
      return {
        action: request.action,
        result: { group: null, status: "unavailable", unavailableReason },
      };
    case "read_chat_name":
      return {
        action: request.action,
        result: { displayName: null, status: "unavailable", unavailableReason },
      };
    case "read_chat_participants":
      return {
        action: request.action,
        result: { participants: null, status: "unavailable", unavailableReason },
      };
    case "read_participant_display_names":
      return {
        action: request.action,
        result: { status: "unavailable", unavailableReason },
      };
    case "create_signup_referral_link":
    case "preflight_set_chat_avatar":
    case "set_chat_avatar":
    case "share_contact_card":
    case "leave_membership":
    case "post_disclosure_request":
    case "revoke_disclosure_grant":
    case "prepare_next_group":
    case "read_next_group":
    case "cancel_next_group":
    case "revoke_own_email_share":
    case "prepare_email":
      return {
        action: request.action,
        result: { status: "unavailable", unavailableReason },
      };
    case "arm_usage_referral":
    case "cancel_usage_referral":
    case "read_usage_referral":
      return {
        action: request.action,
        result: {
          referral: null,
          status: "unavailable",
          unavailableReason,
        },
      };
  }
}

/**
 * Picks the one channel whose handles may be matched this turn. A group runtime
 * is bound to a single provider thread, so evidence from two channels is a
 * contradiction and fails closed rather than letting Web guess which index to
 * match against.
 */
function resolveHostedGroupToolSenderHandles(input: {
  linqDeliveryContexts: readonly HostedAssistantLinqDeliveryContext[];
  telegramSenderHandles: readonly string[];
}): { linqSenderHandles?: string[]; telegramSenderHandles?: string[] } {
  const linqHandles = resolveHostedGroupToolLinqSenderHandles(
    input.linqDeliveryContexts,
  );
  const telegramHandles = [...new Set(input.telegramSenderHandles)]
    .filter((handle) =>
      [...handle].length <= HOSTED_RUNTIME_GROUP_SENDER_HANDLE_MAX_CODE_POINTS
    )
    .slice(0, HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX);
  if (linqHandles.length > 0 && telegramHandles.length > 0) {
    return {};
  }
  if (linqHandles.length > 0) {
    return { linqSenderHandles: linqHandles };
  }
  return telegramHandles.length > 0
    ? { telegramSenderHandles: telegramHandles }
    : {};
}

function resolveHostedGroupToolLinqSenderHandles(
  contexts: readonly HostedAssistantLinqDeliveryContext[],
): string[] {
  // Use only route-authorized Linq group inputs. Hosted email reply aliases
  // authenticate a route, not the human From header, and never enter here.
  const linqRoute = resolveHostedGroupToolLinqRouteContext(contexts);
  if (!linqRoute) {
    return [];
  }
  const eligible = new Set<string>();
  for (const context of contexts) {
    const authority = context.routeAuthority;
    const service = normalizeHostedGroupToolLinqService(context.service);
    if (
      !authority
      || authority.channel !== linqRoute.thread.authority.channel
      || authority.containerMemberId !== linqRoute.thread.authority.containerMemberId
      || authority.threadId !== linqRoute.thread.authority.threadId
      || service !== linqRoute.service
      || context.threadIsDirect !== false
    ) {
      continue;
    }
    const senderHandle = context.directRecipientPhoneNumber?.trim();
    if (
      !senderHandle
      || [...senderHandle].length
        > HOSTED_RUNTIME_GROUP_SENDER_HANDLE_MAX_CODE_POINTS
    ) {
      continue;
    }
    eligible.add(senderHandle);
  }
  return [...eligible].slice(0, HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX);
}

type HostedGroupToolLinqService = "imessage" | "sms";

type HostedGroupToolLinqRouteContext = {
  service: HostedGroupToolLinqService;
  thread: HostedRuntimeGroupToolLinqThreadContext;
};

/**
 * Direct home conversations are owned by `hostedMemberRouting`, not by the
 * group thread-route store, and one chat may never live in both. So a direct
 * route carries only the trusted host's exact chat id and service; Web
 * revalidates it against the direct owner at the send boundary. Fabricating a
 * thread-route authority here would assert an owner that cannot exist.
 */
type HostedDirectToolLinqRouteContext = {
  chatId: string;
  service: HostedGroupToolLinqService;
};

function resolveHostedDirectToolLinqRouteContext(
  contexts: readonly HostedAssistantLinqDeliveryContext[],
): HostedDirectToolLinqRouteContext | null {
  const eligible = new Map<string, HostedDirectToolLinqRouteContext>();
  let hasInvalidCandidate = false;
  for (const context of contexts) {
    if (context.threadIsDirect !== true) {
      if (context.threadIsDirect !== false) {
        hasInvalidCandidate = true;
      }
      continue;
    }
    const service = normalizeHostedGroupToolLinqService(context.service);
    const chatId = normalizeAssistantRouteString(context.target);
    if (!service || !chatId) {
      hasInvalidCandidate = true;
      continue;
    }
    const routeKey = JSON.stringify([chatId, service]);
    if (!eligible.has(routeKey)) {
      eligible.set(routeKey, { chatId, service });
    }
  }
  if (hasInvalidCandidate || eligible.size !== 1) {
    return null;
  }
  return [...eligible.values()][0] ?? null;
}

function resolveHostedGroupToolLinqRouteContext(
  contexts: readonly HostedAssistantLinqDeliveryContext[],
): HostedGroupToolLinqRouteContext | null {
  const eligible = new Map<string, HostedGroupToolLinqRouteContext>();
  let hasInvalidAuthoritativeCandidate = false;
  for (const context of contexts) {
    const authority = context.routeAuthority;
    if (!authority || context.threadIsDirect === true) {
      continue;
    }
    if (context.threadIsDirect !== false) {
      hasInvalidAuthoritativeCandidate = true;
      continue;
    }
    const service = normalizeHostedGroupToolLinqService(context.service);
    if (
      !service
      || authority.channel !== "linq"
      || authority.containerMemberId.trim().length === 0
      || authority.threadId.trim().length === 0
    ) {
      hasInvalidAuthoritativeCandidate = true;
      continue;
    }
    const routeKey = JSON.stringify([
      authority.channel,
      authority.containerMemberId,
      authority.threadId,
      service,
    ]);
    if (!eligible.has(routeKey)) {
      eligible.set(routeKey, {
        service,
        thread: {
          authority: {
            ...(authority.accountLookupKey === undefined
              ? {}
              : { accountLookupKey: authority.accountLookupKey }),
            channel: authority.channel,
            containerMemberId: authority.containerMemberId,
            threadId: authority.threadId,
          },
          chatId: authority.threadId,
        },
      });
    }
  }

  // An incomplete candidate, service mismatch, or second authorized route
  // makes the provider target ambiguous. Fail closed rather than choosing
  // iMessage or SMS by iteration order during a provider re-key or mixed batch.
  if (hasInvalidAuthoritativeCandidate || eligible.size !== 1) {
    return null;
  }
  return [...eligible.values()][0] ?? null;
}

function normalizeHostedGroupToolLinqService(
  service: string | null | undefined,
): HostedGroupToolLinqService | null {
  const normalized = service?.trim().toLowerCase();
  return normalized === "imessage" || normalized === "sms"
    ? normalized
    : null;
}

function resolveHostedInitialLinqDeliveryContexts(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): readonly HostedAssistantLinqDeliveryContext[] {
  if (input.initialAssistantInputBatch) {
    return input.initialAssistantInputBatch.linqDeliveryContexts;
  }
  const importResult = input.initialMailboxImport.importResult;
  if (importResult.linqDeliveryContexts && importResult.linqDeliveryContexts.length > 0) {
    return importResult.linqDeliveryContexts;
  }
  return importResult.latestLinqDeliveryContext
    ? [importResult.latestLinqDeliveryContext]
    : [];
}

function resolveHostedCurrentLinqDeliveryContexts(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
  initialContexts: readonly HostedAssistantLinqDeliveryContext[],
): readonly HostedAssistantLinqDeliveryContext[] {
  const latestContexts = input.latestAssistantInputBatch?.()?.linqDeliveryContexts ?? [];
  return latestContexts.length === 0
    ? initialContexts
    : [...initialContexts, ...latestContexts];
}

function readHostedInitialAssistantInputIds(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): readonly string[] {
  return input.initialAssistantInputBatch?.assistantInputIds
    ?? input.initialMailboxImport.importResult.assistantInputIds
    ?? [];
}

function createHostedAssistantAutomationOperationScope(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
  redactedLogEntries: HostedExecutionRedactedLogEntry[],
): AssistantAutomationOperationScope {
  return {
    async runAutoReplyGroup<T>(scopeInput: {
      executionContext: AssistantExecutionContext;
      inputIds: readonly string[];
      operation(
        executionContext: AssistantExecutionContext,
        turnEnvironment: AssistantTurnEnvironment | null,
        providerStartCriticalPath?:
          AssistantProviderStartCriticalPathContext | null,
      ): Promise<T>;
      providerStartCriticalPath?: AssistantProviderStartCriticalPathContext | null;
      turnEnvironment: AssistantTurnEnvironment | null;
    }): Promise<T> {
      const durableContext = await resolveHostedAssistantInputIdsOperationContext({
        inputIds: scopeInput.inputIds,
        memberId: input.request.userId,
        vaultRoot: input.restored.vaultRoot,
      });
      const route = durableContext.route;
      const groupScopedExecutionContext = scopeHostedGroupToolToAssistantOperation({
        currentDeliveryRoute: route,
        emailDeliveryContexts: [],
        executionContext: scopeInput.executionContext,
        groupSharedReadAvailable: route?.threadIsDirect === false,
        groupEmailIngress:
          normalizeAssistantRouteString(route?.channel)?.toLowerCase() === "email"
          && route?.threadIsDirect === false,
        groupToolPort: input.runtime.platform.groupToolPort ?? null,
        linqDeliveryContexts: durableContext.linqDeliveryContexts,
        linqService: durableContext.linqService,
        runtimeMemberId: input.request.userId,
        telegramSenderHandles: durableContext.telegramSenderHandles,
        vaultRoot: input.restored.vaultRoot,
      });
      const scopedExecutionContext = scopeHostedAutomationToolToAssistantOperation({
        executionContext: groupScopedExecutionContext,
        redactedLogEntries,
        route,
        vaultRoot: input.restored.vaultRoot,
      });
      const providerStartCriticalPath = stampAssistantProviderStartCriticalPath(
        scopeInput.providerStartCriticalPath,
        "automationGroupAndOperationScopeDoneAtMonotonicMs",
      );
      return await scopeInput.operation(
        scopedExecutionContext,
        scopeInput.turnEnvironment,
        providerStartCriticalPath,
      );
    },
  };
}

async function resolveHostedAssistantInputIdsOperationContext(input: {
  inputIds: readonly string[];
  memberId: string;
  vaultRoot: string;
}): Promise<{
  linqDeliveryContexts: HostedAssistantLinqDeliveryContext[];
  linqService: HostedUsageReferralLinqService | null;
  route: AssistantCurrentDeliveryRoute | null;
  telegramSenderHandles: string[];
}> {
  const routes: AssistantCurrentDeliveryRoute[] = [];
  const linqDeliveryContexts: HostedAssistantLinqDeliveryContext[] = [];
  const linqServices: Array<HostedUsageReferralLinqService | null> = [];
  const telegramSenderHandles: string[] = [];
  if (input.inputIds.length === 0) {
    return { linqDeliveryContexts, linqService: null, route: null, telegramSenderHandles };
  }
  for (const inputId of input.inputIds) {
    try {
      const event = await readAssistantInputEvent({
        inputId,
        vault: input.vaultRoot,
      });
      const route = readHostedAssistantInputCurrentDeliveryRoute({
        conversation: event?.conversation ?? null,
        replyTarget: event?.replyTarget ?? null,
      });
      if (!route || typeof route.threadIsDirect !== "boolean") {
        return {
          linqDeliveryContexts: [],
          linqService: null,
          route: null,
          telegramSenderHandles: [],
        };
      }
      routes.push(route);
      if (normalizeAssistantRouteString(route.channel)?.toLowerCase() === "linq") {
        linqServices.push(readHostedAssistantInputUsageReferralLinqService(event));
      }
      const linqDeliveryContext = readHostedAssistantInputLinqDeliveryContext({
        event,
        memberId: input.memberId,
      });
      if (linqDeliveryContext) {
        linqDeliveryContexts.push(linqDeliveryContext);
      }
      const telegramSenderHandle = readHostedAssistantInputTelegramGroupSenderHandle(event);
      if (telegramSenderHandle) {
        telegramSenderHandles.push(telegramSenderHandle);
      }
    } catch {
      return {
        linqDeliveryContexts: [],
        linqService: null,
        route: null,
        telegramSenderHandles: [],
      };
    }
  }
  const route = resolveUnambiguousCurrentDeliveryRoute(routes);
  if (!route || typeof route.threadIsDirect !== "boolean") {
    return {
      linqDeliveryContexts: [],
      linqService: null,
      route: null,
      telegramSenderHandles: [],
    };
  }
  return {
    linqDeliveryContexts,
    linqService: resolveUnambiguousHostedUsageReferralLinqService(linqServices),
    route,
    telegramSenderHandles,
  };
}

function readHostedAssistantInputUsageReferralLinqService(
  event: AssistantInputEventRecord | null,
): HostedUsageReferralLinqService | null {
  const sourceMetadata = event?.sourceMetadata;
  if (
    !event
    || sourceMetadata?.kind !== "linq"
    || event.conversation?.source !== "linq"
    || typeof event.conversation.threadIsDirect !== "boolean"
    || event.replyTarget?.channel !== "linq"
  ) {
    return null;
  }
  const service = normalizeAssistantRouteString(sourceMetadata.service)?.toLowerCase();
  return service === "imessage" || service === "rcs" || service === "sms"
    ? service
    : null;
}

function resolveUnambiguousHostedUsageReferralLinqService(
  services: readonly (HostedUsageReferralLinqService | null)[],
): HostedUsageReferralLinqService | null {
  let resolved: HostedUsageReferralLinqService | null = null;
  for (const service of services) {
    if (!service || (resolved && resolved !== service)) {
      return null;
    }
    resolved = service;
  }
  return resolved;
}

/**
 * Telegram group attribution evidence for one accepted input. Gated exactly
 * like the Linq delivery context: route-authorized, non-direct, and with the
 * source channel agreeing with the reply target.
 */
function readHostedAssistantInputTelegramGroupSenderHandle(
  event: AssistantInputEventRecord | null,
): string | null {
  const sourceMetadata = event?.sourceMetadata;
  if (
    !event
    || sourceMetadata?.kind !== "telegram"
    || sourceMetadata.externalThreadRouteAuthorityPresent !== true
    || event.conversation?.threadIsDirect !== false
    || event.replyTarget?.channel !== "telegram"
  ) {
    return null;
  }
  return normalizeAssistantRouteString(sourceMetadata.senderHandle);
}

function readHostedAssistantInputLinqDeliveryContext(input: {
  event: AssistantInputEventRecord | null;
  memberId: string;
}): HostedAssistantLinqDeliveryContext | null {
  const event = input.event;
  const sourceMetadata = event?.sourceMetadata;
  const replyTarget = event?.replyTarget;
  // Admit Linq events from either thread shape and carry the event's real
  // value through. Group consumers select `false` and require the external
  // thread-route authority these events carry. A direct home conversation
  // structurally cannot have that authority — its route lives in
  // `hostedMemberRouting` — so it is admitted on the trusted reply target
  // alone and revalidated against its own owner at the Web send boundary.
  if (
    !event
    || sourceMetadata?.kind !== "linq"
    || typeof event.conversation?.threadIsDirect !== "boolean"
    || replyTarget?.channel !== "linq"
  ) {
    return null;
  }
  const threadIsDirect = event.conversation.threadIsDirect;
  if (
    !threadIsDirect
    && sourceMetadata.externalThreadRouteAuthorityPresent !== true
  ) {
    return null;
  }
  const threadId = normalizeAssistantRouteString(replyTarget.threadId);
  if (!threadId) {
    return null;
  }
  return {
    directRecipientPhoneNumber:
      normalizeAssistantRouteString(sourceMetadata.senderHandle),
    fromPhoneNumber: null,
    replyToMessageId: normalizeAssistantRouteString(replyTarget.messageId),
    // Only a group thread carries external thread-route authority. Leaving it
    // null for a direct conversation keeps the group resolvers structurally
    // unable to select it.
    routeAuthority: threadIsDirect
      ? null
      : {
        channel: "linq",
        containerMemberId: input.memberId,
        threadId,
      },
    service: normalizeAssistantRouteString(sourceMetadata.service),
    target: threadId,
    threadIsDirect,
  };
}

function scopeHostedGroupToolToAssistantOperation(input: {
  currentDeliveryRoute: AssistantCurrentDeliveryRoute | null;
  emailDeliveryContexts: readonly HostedAssistantEmailDeliveryContext[];
  executionContext: AssistantExecutionContext;
  groupSharedReadAvailable: boolean;
  groupEmailIngress: boolean;
  groupToolPort: NonNullable<HostedRuntimePlatform["groupToolPort"]> | null;
  linqDeliveryContexts: readonly HostedAssistantLinqDeliveryContext[];
  linqService: HostedUsageReferralLinqService | null;
  runtimeMemberId: string;
  telegramSenderHandles?: readonly string[];
  vaultRoot: string;
}): AssistantExecutionContext {
  const scopedGroupToolPort = input.groupToolPort
    ? createHostedGroupToolWithCurrentTurnContext({
        currentDeliveryRoute: input.currentDeliveryRoute,
        emailDeliveryContexts: input.emailDeliveryContexts,
        groupEmailIngress: input.groupEmailIngress,
        groupToolPort: input.groupToolPort,
        linqDeliveryContexts: input.linqDeliveryContexts,
        linqService: input.linqService,
        telegramSenderHandles: input.telegramSenderHandles ?? [],
      })
    : null;
  const sharedScopedExecutionContext = scopeHostedGroupSharedReaderToAssistantOperation({
    executionContext: input.executionContext,
    groupSharedReadAvailable: input.groupSharedReadAvailable,
    groupToolPort: scopedGroupToolPort,
  });
  if (!sharedScopedExecutionContext.hosted) {
    return sharedScopedExecutionContext;
  }
  const routeChannel = normalizeAssistantRouteString(
    input.currentDeliveryRoute?.channel,
  )?.toLowerCase();
  const routeConversationKey =
    routeChannel === "linq"
    && input.currentDeliveryRoute?.threadIsDirect === false
      ? resolveAssistantDeliveryRouteConversationKey({
          ...input.currentDeliveryRoute,
          channel: routeChannel,
        })
      : null;
  const groupParticipantDisplayNameReader =
    input.groupSharedReadAvailable && routeConversationKey && input.groupToolPort
      ? createHostedGroupParticipantDisplayNameReader({
          groupToolPort: input.groupToolPort,
          routeConversationKey,
          runtimeMemberId: input.runtimeMemberId,
          vaultRoot: input.vaultRoot,
        })
      : null;
  return {
    hosted: {
      ...sharedScopedExecutionContext.hosted,
      ...(groupParticipantDisplayNameReader
        ? { groupParticipantDisplayNameReader }
        : {}),
      ...(scopedGroupToolPort ? { groupTool: scopedGroupToolPort } : {}),
    },
  };
}

function scopeHostedGroupSharedReaderToAssistantOperation(input: {
  executionContext: AssistantExecutionContext;
  groupSharedReadAvailable: boolean;
  groupToolPort: NonNullable<HostedRuntimePlatform["groupToolPort"]> | null;
}): AssistantExecutionContext {
  if (!input.executionContext.hosted) {
    return input.executionContext;
  }
  const {
    groupSharedReader: _unscopedGroupSharedReader,
    ...hostedWithoutGroupSharedReader
  } = input.executionContext.hosted;
  void _unscopedGroupSharedReader;
  return {
    hosted: {
      ...hostedWithoutGroupSharedReader,
      ...(input.groupSharedReadAvailable
        ? {
            groupSharedReader: createHostedGroupSharedReader({
              groupToolPort: input.groupToolPort,
            }),
          }
        : {}),
    },
  };
}

const HOSTED_SCHEDULED_GROUP_PERMISSION_OFFER_UNAVAILABLE =
  "scheduled_group_permission_offer_unavailable";

function createHostedScheduledGroupTools(input: {
  channel: string;
  containerMemberId: string;
  groupToolPort: NonNullable<HostedRuntimePlatform["groupToolPort"]> | null;
  target: string;
  threadIsDirect: boolean;
}): {
  groupPermissionOfferTool?: AssistantHostedGroupPermissionOfferTool;
  groupSharedReader: AssistantHostedGroupSharedReader;
  groupTool: NonNullable<
    NonNullable<AssistantExecutionContext["hosted"]>["groupTool"]
  >;
} | null {
  const channel = input.channel.trim().toLowerCase();
  const containerMemberId = normalizeAssistantRouteString(input.containerMemberId);
  const target = normalizeAssistantRouteString(input.target);
  if (
    (channel !== "linq" && channel !== "telegram")
    || input.threadIsDirect !== false
    || !containerMemberId
    || !target
    || !input.groupToolPort
  ) {
    return null;
  }

  // Scheduled routes deliberately use the first-party link on both Linq and
  // Telegram. The durable automation route does not preserve whether a Linq
  // thread is iMessage or SMS, and the link is the common consent surface.
  // This state belongs to one scheduled group model operation. It proves a
  // missing grant from the model-triggered read and prevents repeated offers.
  const observedNotGrantedScopeKeys = new Set<string>();
  let permissionOfferAttempted = false;
  const unobservedGroupSharedReader = createHostedGroupSharedReader({
    groupToolPort: input.groupToolPort,
  });
  const groupSharedReader: AssistantHostedGroupSharedReader = {
    async request(request) {
      const result = await unobservedGroupSharedReader.request(request);
      if (result.status !== "ok") {
        observedNotGrantedScopeKeys.clear();
        return result;
      }
      observedNotGrantedScopeKeys.clear();
      for (const member of result.members) {
        for (const projection of member.projections) {
          if (projection.grantStatus === "not_granted") {
            observedNotGrantedScopeKeys.add(projection.projectionScopeKey);
          }
        }
      }
      return result;
    },
  };

  const groupPermissionOfferTool: AssistantHostedGroupPermissionOfferTool = {
    async request(request) {
      if (permissionOfferAttempted) {
        return buildHostedScheduledGroupPermissionOfferUnavailable();
      }
      permissionOfferAttempted = true;

      const projectionScopes = normalizeHostedGroupSharedProjectionScopes(
        request.projectionScopes,
      );
      if (
        !input.groupToolPort
        || !projectionScopes
        || projectionScopes.some((projectionScope) =>
          !observedNotGrantedScopeKeys.has(
            buildHostedVaultShareProjectionScopeKey(projectionScope),
          )
        )
      ) {
        return buildHostedScheduledGroupPermissionOfferUnavailable();
      }

      try {
        const response = await input.groupToolPort.request({
          action: "create_join_link",
          joinLink: {
            requestedVaultShareProjectionScopes: projectionScopes,
          },
        });
        return response.action === "create_join_link"
          ? response
          : buildHostedScheduledGroupPermissionOfferUnavailable();
      } catch {
        return buildHostedScheduledGroupPermissionOfferUnavailable();
      }
    },
  };

  return {
    groupPermissionOfferTool,
    groupSharedReader,
    groupTool: input.groupToolPort,
  };
}

function buildHostedScheduledGroupPermissionOfferUnavailable(): Extract<
  HostedRuntimeGroupToolResponse,
  { action: "create_join_link" }
> {
  return {
    action: "create_join_link",
    result: {
      group: null,
      status: "unavailable",
      unavailableReason: HOSTED_SCHEDULED_GROUP_PERMISSION_OFFER_UNAVAILABLE,
    },
  };
}

type HostedAssistantAutomationTool = NonNullable<
  NonNullable<AssistantExecutionContext["hosted"]>["automationTool"]
>;

function scopeHostedAutomationToolToAssistantOperation(input: {
  executionContext: AssistantExecutionContext;
  redactedLogEntries: HostedExecutionRedactedLogEntry[];
  route: AssistantCurrentDeliveryRoute | null;
  vaultRoot: string;
}): AssistantExecutionContext {
  const hosted = input.executionContext.hosted;
  if (!hosted) {
    return input.executionContext;
  }

  const { automationTool: _unscopedAutomationTool, ...hostedWithoutAutomation } = hosted;
  void _unscopedAutomationTool;
  const automationTool = input.route
    && typeof input.route.threadIsDirect === "boolean"
    && !(
      normalizeAssistantRouteString(input.route.channel)?.toLowerCase() === "email"
      && input.route.threadIsDirect === false
    )
    ? createHostedAssistantAutomationTool({
        redactedLogEntries: input.redactedLogEntries,
        route: input.route,
        vaultRoot: input.vaultRoot,
      })
    : null;

  return {
    hosted: {
      ...hostedWithoutAutomation,
      ...(automationTool ? { automationTool } : {}),
    },
  };
}

function createHostedAssistantAutomationTool(input: {
  redactedLogEntries: HostedExecutionRedactedLogEntry[];
  route: AssistantCurrentDeliveryRoute;
  vaultRoot: string;
}): HostedAssistantAutomationTool {
  const currentRoute = automationRouteSchema.parse(
    resolveAssistantDeliveryRouteWithCurrentRoute({}, input.route),
  );
  let onboardingFirstReadCompletionTransitionConsumed = false;
  return {
    async request(request, context) {
      context?.signal?.throwIfAborted();
      if (request.action === "reconcile") {
        const result = await reconcileAutomationSupportSeries({
          desiredAutomationIds: request.desiredAutomationIds,
          supportSeriesTag: buildAutomationSupportSeriesTag(
            request.supportSeriesId,
          ),
          vaultRoot: input.vaultRoot,
        });
        context?.signal?.throwIfAborted();
        return {
          action: "reconcile",
          archivedCount: result.archivedCount,
          matchedCount: result.matchedCount,
          missingDesiredAutomationIds: result.missingDesiredAutomationIds,
          supportSeriesId: request.supportSeriesId,
          unchangedCount: result.unchangedCount,
        };
      }
      if (request.action === "save") {
        const requestedSlug = resolveAutomationUpsertSlug({
          slug: request.slug,
          title: request.title,
        });
        const existingTarget = request.automationId
          ? await showAutomation({
              automationId: request.automationId,
              vaultRoot: input.vaultRoot,
            })
          : null;
        const targetsOnboardingFirstRead =
          request.automationId ===
            MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_ID
          || requestedSlug ===
            MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG
          || existingTarget?.slug ===
            MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG;
        if (targetsOnboardingFirstRead) {
          if (
            context?.onboardingFirstReadCompletionTransition !== true
            || !isCanonicalOnboardingFirstPersonalReadAutomationSaveRequest(
              request,
            )
            || currentRoute.threadIsDirect !== true
            || onboardingFirstReadCompletionTransitionConsumed
          ) {
            throw new VaultCliError(
              "invalid_option",
              "The onboarding first read can be created only once during its answered-completion transition.",
            );
          }
          onboardingFirstReadCompletionTransitionConsumed = true;
          const onboardingState = await readAssistantOnboardingState(
            input.vaultRoot,
          );
          const existingFirstRead = existingTarget
            ?? await showAutomation({
              slug: MURPH_ONBOARDING_FIRST_PERSONAL_READ_AUTOMATION_SLUG,
              vaultRoot: input.vaultRoot,
            });
          if (
            onboardingState.status !== "completed"
            || onboardingState.completedReason !== "user_answered"
            || existingFirstRead !== null
          ) {
            throw new VaultCliError(
              "invalid_option",
              "The onboarding first read can be created only once during its answered-completion transition.",
            );
          }
        }
        const status = request.status ?? "active";
        assertActiveHostedAutomationRoute({
          route: currentRoute,
          status,
        });
        const result = await upsertAutomation({
          ...(request.activeUntil === undefined
            ? {}
            : { activeUntil: request.activeUntil }),
          ...(request.assistantTargetOverride === undefined
            ? {}
            : { assistantTargetOverride: request.assistantTargetOverride }),
          ...(request.automationId ? { automationId: request.automationId } : {}),
          continuityPolicy: request.continuityPolicy ?? "preserve",
          ...(request.contextReferences === undefined
            ? {}
            : { contextReferences: [...request.contextReferences] }),
          createOnly: true,
          instructions: stripHostedAssistantAvailabilityConflictBlock(
            request.instructions,
          ),
          ...(request.plannedOccurrenceOffsetMs === undefined
            ? {}
            : { plannedOccurrenceOffsetMs: request.plannedOccurrenceOffsetMs }),
          route: currentRoute,
          schedule: request.schedule,
          ...(request.slug ? { slug: request.slug } : {}),
          status,
          ...(request.summary === undefined ? {} : { summary: request.summary }),
          ...(request.supportKind === undefined
            ? {}
            : { supportKind: request.supportKind }),
          ...(
            request.supportSeriesId === undefined && request.tags === undefined
              ? {}
              : {
                  tags: normalizeHostedAutomationSupportTags({
                    supportSeriesId: request.supportSeriesId,
                    tags: request.tags,
                  }),
                }
          ),
          title: request.title,
          vaultRoot: input.vaultRoot,
        });
        return await buildHostedAutomationToolResponse({
          action: "save",
          redactedLogEntries: input.redactedLogEntries,
          result,
          routeBinding: "current_conversation",
          vaultRoot: input.vaultRoot,
        });
      }

      const existing = await showAutomation({
        automationId: request.lookup,
        slug: request.lookup,
        vaultRoot: input.vaultRoot,
      });
      if (!existing) {
        throw new VaultCliError(
          "automation_not_found",
          "Automation was not found.",
        );
      }
      context?.signal?.throwIfAborted();
      if (request.action === "inspect") {
        return await buildHostedAutomationToolResponse({
          action: "inspect",
          record: existing,
          routeBinding: "preserved",
          vaultRoot: input.vaultRoot,
        });
      }
      const route = request.retargetToCurrentConversation === true
        ? currentRoute
        : existing.route;
      assertActiveHostedAutomationRoute({
        route,
        status: request.status ?? existing.status,
      });
      const result = await patchAutomation({
        ...(request.activeUntil === undefined
          ? {}
          : { activeUntil: request.activeUntil }),
        ...(request.assistantTargetOverride === undefined
          ? {}
          : { assistantTargetOverride: request.assistantTargetOverride }),
        ...(request.continuityPolicy === undefined
          ? {}
          : { continuityPolicy: request.continuityPolicy }),
        ...(request.contextReferences === undefined
          ? {}
          : { contextReferences: [...request.contextReferences] }),
        expectedUpdatedAt: request.expectedUpdatedAt,
        ...(request.instructions === undefined
          ? {}
          : {
              instructions: stripHostedAssistantAvailabilityConflictBlock(
                request.instructions,
              ),
            }),
        ...(request.plannedOccurrenceOffsetMs === undefined
          ? {}
          : { plannedOccurrenceOffsetMs: request.plannedOccurrenceOffsetMs }),
        lookup: request.lookup,
        ...(request.retargetToCurrentConversation === true
          ? { route: currentRoute }
          : {}),
        ...(request.schedule === undefined ? {} : { schedule: request.schedule }),
        ...(request.slug === undefined ? {} : { slug: request.slug }),
        ...(request.status === undefined ? {} : { status: request.status }),
        ...(request.summary === undefined ? {} : { summary: request.summary }),
        ...(request.supportKind === undefined
          ? {}
          : { supportKind: request.supportKind }),
        ...(
          request.supportSeriesId === undefined && request.tags === undefined
            ? {}
            : {
                tags: normalizeHostedAutomationSupportTags({
                  existingTags: existing.tags,
                  supportSeriesId: request.supportSeriesId,
                  tags: request.tags,
                }),
              }
        ),
        ...(request.title === undefined ? {} : { title: request.title }),
        vaultRoot: input.vaultRoot,
      });
      return await buildHostedAutomationToolResponse({
        action: "patch",
        redactedLogEntries: input.redactedLogEntries,
        result,
        routeBinding: request.retargetToCurrentConversation === true
          ? "current_conversation"
          : "preserved",
        vaultRoot: input.vaultRoot,
      });
    },
  };
}

function stripHostedAssistantAvailabilityConflictBlock(
  instructions: string,
): string {
  try {
    return stripAutomationAvailabilityConflictBlock(instructions);
  } catch (error) {
    if (error instanceof AutomationAvailabilityConflictBlockError) {
      throw new VaultCliError("invalid_option", error.message);
    }
    throw error;
  }
}

function buildHostedAutomationTimingVerificationLogEntry(input: {
  action: "patch" | "save";
  issues: readonly AssistantAutomationTimingVerificationIssue[];
  recovered: boolean;
  stage: "initial" | "readback";
}): HostedExecutionRedactedLogEntry {
  return {
    component: "automation.tool",
    level: "info",
    message: input.recovered
      ? "Hosted automation timing verification recovered after automatic readback."
      : "Hosted automation timing verification was incomplete.",
    phase: "timing-verification",
    redacted: {
      ...(input.recovered
        ? {}
        : { errorCode: "ASSISTANT_AUTOMATION_TIMING_UNVERIFIED" }),
      automationTimingVerificationAction: input.action,
      automationTimingVerificationIssues: [...input.issues],
      automationTimingVerificationRecovered: input.recovered,
      automationTimingVerificationStage: input.stage,
      schema: "murph.hosted-automation-timing-verification.v1",
      type: "automation.timing-verification",
    },
  };
}

function normalizeHostedAutomationSupportTags(input: {
  existingTags?: readonly string[];
  supportSeriesId?: string;
  tags?: readonly string[];
}): string[] {
  if (
    input.tags?.some((tag) =>
      tag === AUTOMATION_SUPPORT_SERIES_RECONCILED_ARCHIVE_TAG
      || tag.startsWith(AUTOMATION_SUPPORT_SERIES_TAG_PREFIX)
    )
  ) {
    throw new VaultCliError(
      "invalid_option",
      "Reserved automation support tags must be set through supportSeriesId.",
    );
  }

  const existingSupportSeriesTag = input.existingTags?.find((tag) =>
    tag.startsWith(AUTOMATION_SUPPORT_SERIES_TAG_PREFIX)
  );
  const supportSeriesTag = input.supportSeriesId === undefined
    ? existingSupportSeriesTag
    : buildAutomationSupportSeriesTag(input.supportSeriesId);
  const tags = [...(input.tags ?? input.existingTags ?? [])]
    .filter((tag) => !tag.startsWith(AUTOMATION_SUPPORT_SERIES_TAG_PREFIX));
  return supportSeriesTag === undefined ? tags : [...tags, supportSeriesTag];
}

function assertActiveHostedAutomationRoute(input: {
  route: AutomationRoute;
  status: "active" | "archived" | "paused";
}): void {
  if (input.status !== "active") {
    return;
  }
  const issue = getAssistantAutomationRouteDeliverabilityIssue(
    input.route,
    "hosted",
  );
  if (issue) {
    throw new VaultCliError("invalid_option", issue.message);
  }
}

type HostedAutomationToolResponseInput =
  | {
      action: "inspect";
      record: AutomationRecord;
      routeBinding: "preserved";
      vaultRoot: string;
    }
  | {
      action: "patch" | "save";
      redactedLogEntries: HostedExecutionRedactedLogEntry[];
      result: Awaited<ReturnType<typeof upsertAutomation>>;
      routeBinding: "current_conversation" | "preserved";
      vaultRoot: string;
    };

async function projectHostedAutomationResponseFields(input: {
  record: AutomationRecord;
  vaultRoot: string;
}) {
  const schedule = input.record.schedule;
  let effectiveTimeZone =
    schedule.kind === "cron" || schedule.kind === "dailyLocal"
      ? schedule.timeZone ?? null
      : null;
  let nextOccurrenceAt: string | null = null;
  const timingVerificationIssues = new Set<
    AssistantAutomationTimingVerificationIssue
  >();
  let defaultTimeZone: string | undefined;
  if (schedule.kind !== "deviceActivity") {
    const timeZoneProjection = await resolveAssistantCronDefaultTimeZoneProjection(
      input.vaultRoot,
    );
    defaultTimeZone = timeZoneProjection.timeZone;
    if (
      (schedule.kind === "cron" || schedule.kind === "dailyLocal")
      && effectiveTimeZone === null
    ) {
      effectiveTimeZone = timeZoneProjection.timeZone;
      if (!timeZoneProjection.vaultTimeZoneVerified) {
        timingVerificationIssues.add("default_timezone_unverified");
      }
    }
  }
  if (
    input.record.status !== "archived"
    && schedule.kind !== "deviceActivity"
  ) {
    try {
      if (defaultTimeZone === undefined) {
        throw new Error("Automation timing projection requires a default timezone.");
      }
      const projection = await getAssistantCronAutomationTimingProjection(
        input.vaultRoot,
        input.record.relativePath,
        defaultTimeZone,
      );
      const { job } = projection;
      nextOccurrenceAt = projection.nextOccurrenceAt;
      if (!projection.occurrenceVerified) {
        timingVerificationIssues.add(
          projection.occurrenceUnverifiedReason ?? "projection_unavailable",
        );
      }
      if (
        job.updatedAt !== input.record.updatedAt
        || JSON.stringify(job.schedule) !== JSON.stringify(schedule)
      ) {
        timingVerificationIssues.add("record_readback_mismatch");
      }
    } catch {
      timingVerificationIssues.add("projection_unavailable");
    }
  }
  const timingVerificationIssueList = [...timingVerificationIssues];
  return {
    automationId: input.record.automationId,
    contextReferences: [...input.record.contextReferences],
    effectiveTimeZone,
    lookupId: input.record.slug,
    nextOccurrenceAt,
    schedule,
    status: input.record.status,
    timingVerificationIssues: timingVerificationIssueList,
    timingVerified: timingVerificationIssueList.length === 0,
    updatedAt: input.record.updatedAt,
  };
}

async function buildHostedAutomationToolResponse(
  input: HostedAutomationToolResponseInput,
): Promise<Awaited<ReturnType<HostedAssistantAutomationTool["request"]>>> {
  const record = input.action === "inspect" ? input.record : input.result.record;
  const responseFields = await projectHostedAutomationResponseFields({
    record,
    vaultRoot: input.vaultRoot,
  });
  if (input.action === "inspect") {
    return {
      action: "inspect" as const,
      ...responseFields,
      routeBinding: "preserved" as const,
    };
  }

  const response: HostedAssistantAutomationWriteResponse = {
    action: input.action,
    ...responseFields,
    created: input.result.created,
    routeBinding: input.routeBinding,
  };
  if (response.timingVerified) {
    return response;
  }
  input.redactedLogEntries.push(
    buildHostedAutomationTimingVerificationLogEntry({
      action: input.action,
      issues: response.timingVerificationIssues ?? [],
      recovered: false,
      stage: "initial",
    }),
  );

  let readbackResponse = response;
  try {
    const readbackRecord = await showAutomation({
      automationId: record.automationId,
      vaultRoot: input.vaultRoot,
    });
    if (!readbackRecord) {
      readbackResponse = markHostedAutomationTimingUnverified(
        response,
        "record_readback_mismatch",
      );
    } else {
      const readbackFields = await projectHostedAutomationResponseFields({
        record: readbackRecord,
        vaultRoot: input.vaultRoot,
      });
      const projectedReadback: HostedAssistantAutomationWriteResponse = {
        action: input.action,
        ...readbackFields,
        created: input.result.created,
        routeBinding: input.routeBinding,
      };
      const recordChanged =
        readbackRecord.updatedAt !== record.updatedAt
        || JSON.stringify(readbackRecord.schedule)
          !== JSON.stringify(record.schedule);
      readbackResponse = recordChanged
        ? markHostedAutomationTimingUnverified(
            projectedReadback,
            "record_readback_mismatch",
          )
        : projectedReadback;
    }
  } catch {
    readbackResponse = markHostedAutomationTimingUnverified(
      response,
      "projection_unavailable",
    );
  }
  input.redactedLogEntries.push(
    buildHostedAutomationTimingVerificationLogEntry({
      action: input.action,
      issues: readbackResponse.timingVerificationIssues ?? [],
      recovered: readbackResponse.timingVerified,
      stage: "readback",
    }),
  );
  return readbackResponse;
}

type HostedAssistantAutomationWriteResponse = Extract<
  Awaited<ReturnType<HostedAssistantAutomationTool["request"]>>,
  { action: "patch" | "save" }
>;

function markHostedAutomationTimingUnverified(
  response: HostedAssistantAutomationWriteResponse,
  issue: AssistantAutomationTimingVerificationIssue,
): HostedAssistantAutomationWriteResponse {
  return {
    ...response,
    nextOccurrenceAt: null,
    timingVerificationIssues: [...new Set([
      ...(response.timingVerificationIssues ?? []),
      issue,
    ])],
    timingVerified: false,
  };
}

export async function runHostedWorkspaceAssistantPhase(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): Promise<HostedWorkspaceRunnerAssistantPhaseResult> {
  const providerStartCriticalPath = stampAssistantProviderStartCriticalPath(
    input.providerStartCriticalPath,
    "assistantPhaseStartedAtMonotonicMs",
  );
  const assistantPhaseStartedAt = Date.now();
  const channelAbortController = new AbortController();
  const releaseChannelAbortRelay = relayHostedAssistantPhaseAbortSignal(
    input.signal ?? null,
    channelAbortController,
  );
  const wake = buildHostedExecutionRuntimeTimerWake({
    eventId: `hosted-workspace-invocation:${input.request.attemptId}:assistant`,
    occurredAt: new Date().toISOString(),
    triggerKind: "runtime_timer",
    userId: input.request.userId,
  });
  const recordDeferredUsage = (
    record: AssistantUsageRecord,
    providerRequestAcceptedInputIds?: readonly string[],
  ): Promise<void> => {
    input.recordDeferredUsage?.(
      record,
      providerRequestAcceptedInputIds,
    );
    return Promise.resolve();
  };
  const usageRecorder =
    input.runtime.platform.usageRecordPort && input.recordDeferredUsage
      ? { recordUsage: recordDeferredUsage }
      : null;
  if (input.foregroundCausalOnly === true) {
    try {
      const systemMailboxMaintenance = await runSystemMailboxMaintenancePhase({
        executionContext: {
          hosted: {
            memberId: input.request.userId,
            ...(usageRecorder ? { usageRecorder } : {}),
            userEnvKeys: Object.keys(input.runtime.userEnv),
          },
        },
        hasFreshConversationInput: false,
        input,
        pendingAssistantInputWakeAt: null,
        wake,
      });
      if (!systemMailboxMaintenance.result) {
        return withHostedRuntimeWakeCandidate({
          result: { progressed: false },
          wake: createExistingHostedAssistantWorkspaceWakeCandidate(input),
        });
      }
      return withHostedDeviceSyncMaintenanceRan(
        systemMailboxMaintenance.result,
        systemMailboxMaintenance.deviceSyncMaintenanceRan,
      );
    } finally {
      releaseChannelAbortRelay();
      channelAbortController.abort();
    }
  }
  const deviceConnectProviders = resolveHostedWorkspaceDeviceConnectProviders(input.runtime);
  const deviceTool = resolveHostedWorkspaceDeviceTool({
    deviceConnectProviders,
    input,
  });
  const clinicalRecordsConnectLinkTool =
    resolveHostedClinicalRecordsConnectLinkTool(input.runtime.platform.clinicalRecordsPort);
  const initialLinqDeliveryContexts = resolveHostedInitialLinqDeliveryContexts(input);
  const initialAssistantInputIds = readHostedInitialAssistantInputIds(input);
  const initialLinqLatencyTraceContext = {
    assistantInputIds: initialAssistantInputIds,
    latencyTracePort: input.runtime.platform.latencyTracePort,
    runtimeAttemptId: input.request.attemptId,
    source: "linq" as const,
  };
  const productFeedbackCandidates = new Map<
    string,
    HostedRuntimeProductFeedbackRecord
  >();
  if (shouldWriteHostedDeviceConnectContextLog({ deviceConnectProviders, input })) {
    void writeHostedDeviceConnectRuntimeLog({
      deviceConnectProviders,
      input,
      issueLinkAvailable: deviceTool !== undefined && deviceConnectProviders.length > 0,
      stage: "context",
      status: deviceTool ? "available" : "unavailable",
    }).catch(() => undefined);
  }
  const executionTargetHydrateStartedAt = Date.now();
  const executionContext: AssistantExecutionContext = await hydrateHostedExecutionDefaultTarget(
    {
      hosted: {
        actionApprovalPort: input.runtime.platform.actionApprovalPort ?? null,
        ...(input.currentAssistantInputId
          ? {
              currentAssistantInputId: input.currentAssistantInputId,
            }
          : {}),
        assistantConfigurationTool:
          input.runtime.platform.assistantConfigurationToolPort ?? null,
        connectedApps: input.runtime.platform.connectedApps ?? null,
        ...(clinicalRecordsConnectLinkTool ? { clinicalRecordsConnectLinkTool } : {}),
        physicalNotes: input.runtime.platform.physicalNotes ?? null,
        phoneCalls: input.runtime.platform.phoneCalls ?? null,
        progressDeliveryDependencies: createHostedAssistantProgressDeliveryDependencies({
          effectsPort: input.runtime.platform.effectsPort,
          forwardedEnv: input.runtime.forwardedEnv,
          latencyTrace: {
            latencyTracePort: input.runtime.platform.latencyTracePort,
            runtimeAttemptId: input.request.attemptId,
            source: "linq",
          },
          linqDeliveryContexts: initialLinqDeliveryContexts,
          platform: input.runtime.platform,
          platformEnv: input.runtime.platformEnv,
          providerFetch: input.runtime.platform.providerFetch ?? null,
          publicInternetFetch: input.runtime.platform.publicInternetFetch ?? null,
          signal: channelAbortController.signal,
          userEnv: input.runtime.userEnv,
          wake,
        }),
        channelTypingDependencies: createHostedAssistantChannelTypingDependencies({
          forwardedEnv: input.runtime.forwardedEnv,
          latencyTraceContext: initialLinqLatencyTraceContext,
          linqDeliveryContexts: initialLinqDeliveryContexts,
          platformEnv: input.runtime.platformEnv,
          providerFetch: input.runtime.platform.providerFetch ?? null,
          signal: channelAbortController.signal,
          userEnv: input.runtime.userEnv,
        }),
        deviceConnectProviders,
        ...(deviceTool ? { deviceTool } : {}),
        ...(input.runtime.platform.familyPlanToolPort
          ? { familyPlanTool: input.runtime.platform.familyPlanToolPort }
          : {}),
        ...(input.runtime.platform.labsToolPort
          ? { labsTool: input.runtime.platform.labsToolPort }
          : {}),
        ...(input.runtime.platform.assistantPersonalizationToolPort
          ? {
              personalizationTool:
                input.runtime.platform.assistantPersonalizationToolPort,
            }
          : {}),
        ...(input.runtime.platform.planUsageToolPort
          ? { planUsageTool: input.runtime.platform.planUsageToolPort }
          : {}),
        ...(input.runtime.platform.imessageContactToolPort
          ? { imessageContactTool: input.runtime.platform.imessageContactToolPort }
          : {}),
        ...(input.runtime.platform.privateImageUrlPublisher
          ? {
              privateImageUrlPublisher:
                input.runtime.platform.privateImageUrlPublisher,
            }
          : {}),
        ...(input.runtime.platform.subscriptionToolPort
          ? { subscriptionTool: input.runtime.platform.subscriptionToolPort }
          : {}),
        ...(input.materializeWorkspaceArtifacts
          ? { materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts }
          : {}),
        ...(input.imageGenerationLauncher
          ? { imageGenerationLauncher: input.imageGenerationLauncher }
          : {}),
        ...(input.persistGeneratedImageCapture
          ? {
              persistGeneratedImageCapture:
                input.persistGeneratedImageCapture,
            }
          : {}),
        ...(input.runtime.platform.productFeedbackPort
          ? {
              productFeedbackCandidateSink: {
                acceptProductFeedbackCandidate(
                  feedback: HostedRuntimeProductFeedbackRecord,
                ) {
                  productFeedbackCandidates.set(
                    feedback.idempotencyKey,
                    feedback,
                  );
                },
                // Support escalations are recorded through the Web callback
                // inside the turn so the member-facing "queued" confirmation is
                // backed by a durable record; they never join the best-effort
                // post-delivery candidate flush.
                async deliverProductSupportEscalation(
                  feedback: HostedRuntimeProductFeedbackRecord,
                ) {
                  const port = input.runtime.platform.productFeedbackPort;
                  if (!port) {
                    throw new Error(
                      "Hosted product feedback port unavailable for support escalation.",
                    );
                  }
                  const response = await port.recordProductFeedback(feedback);
                  return { recorded: response.recorded };
                },
              },
            }
          : {}),
        memberId: input.request.userId,
        createScheduledGroupTools: ({ channel, target, threadIsDirect }) =>
          createHostedScheduledGroupTools({
            channel,
            containerMemberId: input.request.userId,
            groupToolPort: input.runtime.platform.groupToolPort ?? null,
            target,
            threadIsDirect,
          }),
        providerFetch: input.runtime.platform.providerFetch ?? null,
        publicInternetFetch: input.runtime.platform.publicInternetFetch ?? null,
        resolveScheduledExternalThreadRoute: async ({
          channel,
          signal,
          target,
        }) => {
          const assertAuthority =
            input.runtime.platform.effectsPort.assertExternalThreadRouteAuthority;
          if (!assertAuthority) {
            throw new VaultCliError(
              "ASSISTANT_EXTERNAL_THREAD_ROUTE_AUTHORITY_UNAVAILABLE",
              "Hosted group delivery requires live thread route authority before provider work.",
              { retryable: true },
            );
          }
          const authority = {
            channel,
            containerMemberId: input.request.userId,
            threadId: target,
          } as const;
          await assertAuthority(authority, { signal });
          return authority;
        },
        resolveScheduledLinqRoute: async ({
          fromPhoneNumber,
          homeRouteFallbackAllowed,
          signal,
          target,
          targetKind,
        }) => {
          const assertEngagement =
            input.runtime.platform.effectsPort.assertLinqRecentInboundEngagement;
          if (!assertEngagement) {
            throw new VaultCliError(
              "ASSISTANT_LINQ_ENGAGEMENT_ASSERT_UNAVAILABLE",
              "Hosted Linq delivery requires an egress authority assertion before provider work.",
              { retryable: true },
            );
          }
          const authority = await assertEngagement({
            authorityCheckOnly: true,
            ...(fromPhoneNumber ? { fromPhoneNumber } : {}),
            homeRouteFallbackAllowed,
            target,
            targetKind,
          }, { signal });
          const resolvedRoute = authority?.resolvedRoute;
          if (
            !resolvedRoute
            || resolvedRoute.targetKind !== "thread"
            || typeof resolvedRoute.threadIsDirect !== "boolean"
          ) {
            throw new VaultCliError(
              "ASSISTANT_LINQ_AUDIENCE_AUTHORITY_UNAVAILABLE",
              "Hosted Linq delivery requires direct or group authority before provider work.",
              { retryable: true },
            );
          }
          const conversationThreadId =
            resolvedRoute.conversationThreadId?.trim() ?? "";
          return {
            ...(conversationThreadId ? { conversationThreadId } : {}),
            ...(authority.deliveryBlockCode
              ? { deliveryBlockCode: authority.deliveryBlockCode }
              : {}),
            ...(authority.deliveryPosture
              ? { deliveryPosture: authority.deliveryPosture }
              : {}),
            target: resolvedRoute.target,
            threadIsDirect: resolvedRoute.threadIsDirect,
          };
        },
        ...(usageRecorder ? { usageRecorder } : {}),
        userEnvKeys: Object.keys(input.runtime.userEnv),
      },
    },
    {
      homeDirectory: input.restored.operatorHomeRoot,
      runtimeEnv: input.runtimeEnv,
    },
  );
  const executionTargetHydrateMs = elapsedSince(executionTargetHydrateStartedAt);
  const assistantAutomationRedactedLogEntries: HostedExecutionRedactedLogEntry[] = [];
  const automationOperationScope = createHostedAssistantAutomationOperationScope(
    input,
    assistantAutomationRedactedLogEntries,
  );
  try {
    const hasFreshConversationInput = hasFreshHostedConversationInput(input);
    const systemMailboxMaintenanceStartedAt = Date.now();
    const systemMailboxMaintenance = await runSystemMailboxMaintenancePhase({
      executionContext,
      hasFreshConversationInput,
      input,
      wake,
    });
    const systemMailboxMaintenanceMs = elapsedSince(systemMailboxMaintenanceStartedAt);
    const hasAssistantInputAtPassStart =
      hasFreshConversationInput
      || systemMailboxMaintenance.pendingAssistantInputWakeAt !== null;
    const preManagedAutomationWakeAt = await resolvePreAutomationLaneAssistantWakeAt({
      hasAssistantInputAtPassStart,
      input,
      pendingAssistantInputWakeAt: systemMailboxMaintenance.pendingAssistantInputWakeAt,
    });
    if (preManagedAutomationWakeAt) {
      return withHostedDeviceSyncMaintenanceRan(
        mergeContinuingSystemMailboxAssistantPhaseResult({
          assistantResult: buildPreAutomationLaneSkippedAssistantWakeResult({
            wakeAt: preManagedAutomationWakeAt,
          }),
          systemMailboxResult: systemMailboxMaintenance.result,
        }),
        systemMailboxMaintenance.deviceSyncMaintenanceRan,
      );
    }
    const managedAutomationsResult = hasFreshConversationInput
      || systemMailboxMaintenance.pendingAssistantInputWakeAt !== null
      ? null
      : mergeHostedAssistantPhaseResults(
          await applyHostedManagedAutomationsBestEffort({
            input,
            retryStableKeyFailure: false,
          }),
          await refreshHostedReminderAvailabilityBestEffort({ input }),
        );
    const shouldContinueAssistantLane = systemMailboxMaintenance.continueAssistantLane
      || managedAutomationsResult !== null;
    if (
      systemMailboxMaintenance.result
      && !shouldContinueAssistantLane
    ) {
      return await finalizeHostedBackgroundMaintenanceResult({
        backgroundMaintenanceYielded: systemMailboxMaintenance.backgroundMaintenanceYielded,
        initialProviderCleanupCheckpoint:
          systemMailboxMaintenance.initialProviderCleanupCheckpoint,
        input,
        result: withHostedDeviceSyncMaintenanceRan(
          systemMailboxMaintenance.result,
          systemMailboxMaintenance.deviceSyncMaintenanceRan,
        ),
        wake,
      });
    }
    let continuingSystemMailboxDrainsProviderCleanup =
      systemMailboxMaintenance.result?.checkpointReason === "outbox_sending";
    let continuingSystemMailboxResult =
      shouldContinueAssistantLane
        ? mergeHostedAssistantPhaseResults(systemMailboxMaintenance.result, managedAutomationsResult)
        : managedAutomationsResult;
    let deviceSyncMaintenanceRan = systemMailboxMaintenance.deviceSyncMaintenanceRan;
    const mergeContinuingSystemMailboxResult = (
      assistantResult: HostedWorkspaceRunnerAssistantPhaseResult,
    ): HostedWorkspaceRunnerAssistantPhaseResult =>
      withHostedDeviceSyncMaintenanceRan(
        mergeContinuingSystemMailboxAssistantPhaseResult({
          assistantResult,
          systemMailboxResult: continuingSystemMailboxResult,
        }),
        deviceSyncMaintenanceRan,
      );

    const groupRoomModelInitialization =
      hasFreshConversationInput
        ? await runRequiredGroupRoomModelInitializationPhase({
          executionContext,
          input,
        })
        : {
            continueAssistantLane: true,
            result: null,
          };
    if (groupRoomModelInitialization.result) {
      if (!groupRoomModelInitialization.continueAssistantLane) {
        return mergeContinuingSystemMailboxResult(
          groupRoomModelInitialization.result,
        );
      }

      continuingSystemMailboxResult = mergeHostedAssistantPhaseResults(
        continuingSystemMailboxResult,
        groupRoomModelInitialization.result,
      );
    }

    const memberPreferencesPrePlanningStartedAt = Date.now();
    const memberPreferencesPrePlanning =
      hasFreshConversationInput
        ? await runPrePlanningSystemMailboxPhase({
          allowedRouteActions: HOSTED_MEMBER_PREFERENCE_PRE_PLANNING_ROUTE_ACTIONS,
          executionContext,
          input,
        })
        : {
            continueAssistantLane: true,
            result: null,
          };
    const memberPreferencesPrePlanningMs = elapsedSince(
      memberPreferencesPrePlanningStartedAt,
    );
    if (memberPreferencesPrePlanning.result) {
      if (!memberPreferencesPrePlanning.continueAssistantLane) {
        return mergeContinuingSystemMailboxResult(memberPreferencesPrePlanning.result);
      }

      continuingSystemMailboxResult = mergeHostedAssistantPhaseResults(
        continuingSystemMailboxResult,
        memberPreferencesPrePlanning.result,
      );
    }

    const freshAssistantInputIds = readHostedInitialAssistantInputIds(input);
    const shouldReadDeviceSyncStatusPromptForBackgroundWork = async (options: {
      managedAutomationsResult: HostedWorkspaceRunnerAssistantPhaseResult | null;
      systemMailboxMaintenance: Awaited<ReturnType<typeof runSystemMailboxMaintenancePhase>>;
    }): Promise<boolean> => {
      if (input.shouldYieldBackgroundMaintenance?.() === true) {
        return false;
      }

      if (
        options.systemMailboxMaintenance.continueAssistantLane
        || options.managedAutomationsResult !== null
      ) {
        return true;
      }

      return await hasDueHostedAssistantCronJob(input);
    };
    const buildBackgroundDeviceSyncStatusPrompt = (options: {
      managedAutomationsResult: HostedWorkspaceRunnerAssistantPhaseResult | null;
      systemMailboxMaintenance: Awaited<ReturnType<typeof runSystemMailboxMaintenancePhase>>;
    }) => async (): Promise<string | null> => {
      if (!await shouldReadDeviceSyncStatusPromptForBackgroundWork(options)) {
        return null;
      }

      const cancellation = createHostedBackgroundMaintenanceCancellation({
        signal: channelAbortController.signal,
        shouldYield: input.shouldYieldBackgroundMaintenance ?? null,
        timeoutMs: HOSTED_DEVICE_SYNC_STATUS_PROMPT_TIMEOUT_MS,
      });

      try {
        const deviceSyncStatusPrompt = await buildHostedDeviceSyncStatusPrompt({
          deviceSyncPort: input.runtime.platform.deviceSyncPort ?? null,
          reconnectTargets: resolveHostedWorkspaceDeviceReconnectTargets(input.runtime),
          signal: cancellation.signal,
        });
        if (
          input.shouldYieldBackgroundMaintenance?.() === true
          || !deviceSyncStatusPrompt
        ) {
          return null;
        }

        return deviceSyncStatusPrompt;
      } finally {
        cancellation.dispose();
      }
    };
    const runAutomationLane = async (options: {
      managedAutomationsResult: HostedWorkspaceRunnerAssistantPhaseResult | null;
      systemMailboxMaintenance: Awaited<ReturnType<typeof runSystemMailboxMaintenancePhase>>;
    }) => {
      productFeedbackCandidates.clear();
      const automationLaneStartedAt = Date.now();
      const automationBootstrapStartedAt = Date.now();
      const assistantRuntimeState = await prepareHostedAssistantAutomationForWake(
        input.restored.vaultRoot,
        wake,
        buildHostedAssistantAutomationBootstrapEnv(input),
        input.runtime.resolvedConfig,
        {
          operatorHomeRoot: input.restored.operatorHomeRoot,
        },
      );
      if (!assistantAutomationScheduleTrackingStarted) {
        input.clearAssistantAutomationScheduleChanged?.();
        assistantAutomationScheduleTrackingStarted = true;
      }
      const automationBootstrapMs = elapsedSince(automationBootstrapStartedAt);
      const buildBackgroundDynamicContextPrompt =
        assistantRuntimeState?.assistantConfigured === true
          ? buildBackgroundDeviceSyncStatusPrompt({
            managedAutomationsResult: options.managedAutomationsResult,
            systemMailboxMaintenance: options.systemMailboxMaintenance,
          })
          : undefined;
      const assistantMetrics = await (async () => {
        try {
          const metrics = await runHostedAssistantAutomationLane({
            assistantRuntimeState,
            ...(buildBackgroundDynamicContextPrompt
              ? { buildBackgroundDynamicContextPrompt }
              : {}),
            executionContext,
            freshAssistantInputIds,
            idleCheckpointDelayMs: input.request.idleCheckpointDelayMs,
            now: new Date(resolveHostedAssistantPhaseNowMs(input)),
            operationScope: automationOperationScope,
            requestId: `hosted-workspace-invocation:${input.request.attemptId}:assistant`,
            runtime: {
              commitTimeoutMs: input.runtime.commitTimeoutMs,
              forwardedEnv: input.runtime.forwardedEnv,
              platform: input.platform,
              platformEnv: input.runtime.platformEnv,
              resolvedConfig: input.runtime.resolvedConfig,
            },
            operatorHomeRoot: input.restored.operatorHomeRoot,
            preProviderPhase: {
              automationBootstrapMs,
              executionTargetHydrateMs,
              memberPreferencesPrePlanningMs,
              systemMailboxMaintenanceMs,
              workspaceAssistantPreAutomationMs: elapsedSince(assistantPhaseStartedAt),
            },
            ...(providerStartCriticalPath
              ? { providerStartCriticalPath }
              : {}),
            runtimeAttemptId: input.request.attemptId,
            runtimeEnv: input.runtimeEnv,
            ...(input.beforeProviderAcceptedInputs
              ? { beforeProviderAcceptedInputs: input.beforeProviderAcceptedInputs }
              : {}),
            shouldYieldBackgroundMaintenance:
              input.shouldYieldBackgroundMaintenance ?? null,
            signal: input.signal ?? undefined,
            vaultRoot: input.restored.vaultRoot,
            wake,
          });
          return metrics;
        } catch (error) {
          const failureLogEntries =
            readHostedAssistantAutomationFailureRedactedLogEntries(error);
          const redactedLogEntries = [
            ...assistantAutomationRedactedLogEntries,
            ...failureLogEntries,
          ];
          if (redactedLogEntries.length > 0) {
            await writeHostedAssistantAutomationDetailRuntimeLogs({
              assistantMetrics: {
                redactedLogEntries,
              },
              input,
            });
          }
          throw error;
        }
      })();
      assistantAutomationRedactedLogEntries.push(
        ...(assistantMetrics.redactedLogEntries ?? []),
      );
      writeHostedAssistantTurnTimingRuntimeLog({
        currentTurnDeliveryIntentCount:
          assistantMetrics.assistantAutomationCurrentTurnDeliveryIntentIds?.length ?? 0,
        elapsedMs: elapsedSince(assistantPhaseStartedAt),
        input,
        stage: "automation-pass-finished",
        stepElapsedMs: elapsedSince(automationLaneStartedAt),
      });
      return {
        ...assistantMetrics,
        ...(productFeedbackCandidates.size === 0
          ? {}
          : {
              assistantAutomationProductFeedbackCandidates:
                [...productFeedbackCandidates.values()],
            }),
        ...(assistantAutomationRedactedLogEntries.length === 0
          ? {}
          : { redactedLogEntries: [...assistantAutomationRedactedLogEntries] }),
      };
    };
    let assistantAutomationScheduleTrackingStarted = false;
    const preAutomationLaneWakeAt = await resolvePreAutomationLaneAssistantWakeAt({
      hasAssistantInputAtPassStart,
      input,
      pendingAssistantInputWakeAt: systemMailboxMaintenance.pendingAssistantInputWakeAt,
    });
    if (preAutomationLaneWakeAt) {
      return mergeContinuingSystemMailboxResult(
        buildPreAutomationLaneSkippedAssistantWakeResult({
          wakeAt: preAutomationLaneWakeAt,
        }),
      );
    }

    let assistantMetrics = await runAutomationLane({
      managedAutomationsResult,
      systemMailboxMaintenance,
    });
    let currentTurnDeliveryIntentIds =
      assistantMetrics.assistantAutomationCurrentTurnDeliveryIntentIds ?? [];
    let foregroundAssistantPass = isHostedForegroundAssistantDeliveryPass({
      assistantMetrics,
      currentTurnDeliveryIntentIds,
      hasFreshConversationInput,
      input,
    });
    let assistantNextWakeAt = resolveHostedAssistantAutomationNextWakeAt({
      input,
      nextWakeAt: assistantMetrics.nextWakeAt,
    });
    let assistantNextWakeReason = resolveHostedAssistantAutomationNextWakeReason({
      assistantNextWakeAt,
      assistantOutboxOnlyNextWakeAt:
        assistantMetrics.assistantAutomationOutboxOnlyNextWakeAt ?? null,
    });
    const deferredPendingSystemMailboxMaintenance =
      await runBackgroundMaintenanceAfterDeferredPendingAssistantInput({
        assistantMetrics,
        assistantNextWakeAt,
        executionContext,
        foregroundAssistantPass,
        hasFreshConversationInput,
        input,
        systemMailboxMaintenance,
        wake,
      });
    if (deferredPendingSystemMailboxMaintenance) {
      continuingSystemMailboxDrainsProviderCleanup =
        continuingSystemMailboxDrainsProviderCleanup
        || deferredPendingSystemMailboxMaintenance.result?.checkpointReason === "outbox_sending";
      continuingSystemMailboxResult = mergeHostedAssistantPhaseResults(
        continuingSystemMailboxResult,
        deferredPendingSystemMailboxMaintenance.result,
      );
      deviceSyncMaintenanceRan = deviceSyncMaintenanceRan
        || deferredPendingSystemMailboxMaintenance.deviceSyncMaintenanceRan;
    }
    let backgroundMaintenanceYielded =
      systemMailboxMaintenance.backgroundMaintenanceYielded
      || (deferredPendingSystemMailboxMaintenance?.backgroundMaintenanceYielded
        ?? false);
    if (deferredPendingSystemMailboxMaintenance?.continueAssistantLane === true) {
      const deferredPreAutomationLaneWakeAt =
        await resolvePreAutomationLaneAssistantWakeAt({
          hasAssistantInputAtPassStart: hasFreshConversationInput,
          input,
          pendingAssistantInputWakeAt:
            deferredPendingSystemMailboxMaintenance.pendingAssistantInputWakeAt,
        });
      if (deferredPreAutomationLaneWakeAt) {
        return mergeContinuingSystemMailboxResult(
          buildPreAutomationLaneSkippedAssistantWakeResult({
            wakeAt: deferredPreAutomationLaneWakeAt,
          }),
        );
      }

      assistantMetrics = await runAutomationLane({
        managedAutomationsResult: null,
        systemMailboxMaintenance: deferredPendingSystemMailboxMaintenance,
      });
      currentTurnDeliveryIntentIds =
        assistantMetrics.assistantAutomationCurrentTurnDeliveryIntentIds ?? [];
      foregroundAssistantPass = isHostedForegroundAssistantDeliveryPass({
        assistantMetrics,
        currentTurnDeliveryIntentIds,
        hasFreshConversationInput,
        input,
      });
      assistantNextWakeAt = resolveHostedAssistantAutomationNextWakeAt({
        input,
        nextWakeAt: assistantMetrics.nextWakeAt,
      });
      assistantNextWakeReason = resolveHostedAssistantAutomationNextWakeReason({
        assistantNextWakeAt,
        assistantOutboxOnlyNextWakeAt:
          assistantMetrics.assistantAutomationOutboxOnlyNextWakeAt ?? null,
      });
      backgroundMaintenanceYielded =
        backgroundMaintenanceYielded
        || deferredPendingSystemMailboxMaintenance.backgroundMaintenanceYielded;
    }
    const shadowedDeviceSyncMaintenance =
      await runShadowedDeviceSyncAfterNoProgressAssistantWake({
        assistantMetrics,
        executionContext,
        foregroundAssistantPass,
        hasFreshConversationInput,
        input,
        systemMailboxMaintenance,
        wake,
      });
    if (shadowedDeviceSyncMaintenance) {
      continuingSystemMailboxDrainsProviderCleanup =
        continuingSystemMailboxDrainsProviderCleanup
        || shadowedDeviceSyncMaintenance.result?.checkpointReason === "outbox_sending";
      continuingSystemMailboxResult = mergeHostedAssistantPhaseResults(
        continuingSystemMailboxResult,
        shadowedDeviceSyncMaintenance.result,
      );
      deviceSyncMaintenanceRan = deviceSyncMaintenanceRan
        || shadowedDeviceSyncMaintenance.deviceSyncMaintenanceRan;
      backgroundMaintenanceYielded = backgroundMaintenanceYielded
        || shadowedDeviceSyncMaintenance.backgroundMaintenanceYielded;
    }
    const deviceSyncFollowUpWake = await resolveHostedDeviceSyncFollowUpWake({
      deviceSyncMaintenanceRan,
      input,
      pendingAssistantInputWakeAt: systemMailboxMaintenance.pendingAssistantInputWakeAt,
    });
    const systemMailboxWake = await resolveHostedSystemMailboxNextWakeCandidate({
      vaultRoot: input.restored.vaultRoot,
    });
    const systemMailboxWakeAt = systemMailboxWake.at;
    const initialProviderCleanupCheckpoint =
      deferredPendingSystemMailboxMaintenance?.initialProviderCleanupCheckpoint
      ?? systemMailboxMaintenance.initialProviderCleanupCheckpoint;
    const providerCleanupPlan = await prepareHostedProviderCleanupPlan({
      deferred:
        backgroundMaintenanceYielded
        || foregroundAssistantPass
        || input.shouldYieldBackgroundMaintenance?.() === true,
      idleCheckpointDelayMs: input.request.idleCheckpointDelayMs,
      initialCheckpoint: initialProviderCleanupCheckpoint,
      nowMs: resolveHostedAssistantPhaseNowMs(input),
      shouldYield: input.shouldYieldBackgroundMaintenance ?? null,
      terminalCleanupMessageIds:
        assistantMetrics.assistantAutomationTerminalLinqCleanup ?? null,
      vaultRoot: input.restored.vaultRoot,
    });
    const providerCleanupOwnedByPostCheckpointDelivery =
      postCheckpointDeliveryResultOwnsProviderCleanup(continuingSystemMailboxResult);
    const currentLinqDeliveryContexts = resolveHostedCurrentLinqDeliveryContexts(
      input,
      initialLinqDeliveryContexts,
    );
    if (foregroundAssistantPass) {
      const foregroundCronReconciliationWake =
        input.assistantAutomationScheduleChanged?.() === true
          ? createHostedRuntimeWakeCandidate(
              new Date(resolveHostedAssistantPhaseNowMs(input)).toISOString(),
              HOSTED_ASSISTANT_WAKE_REASON,
            )
          : assistantMetrics.assistantAutomationCronStatusDeferred === true
            ? createExistingHostedAssistantWorkspaceWakeCandidate(input)
            : null;
      writeHostedAssistantTurnTimingRuntimeLog({
        currentTurnDeliveryIntentCount: currentTurnDeliveryIntentIds.length,
        elapsedMs: elapsedSince(assistantPhaseStartedAt),
        foregroundAssistantPass,
        input,
        stage: "foreground-delivery-phase-started",
      });
      const foregroundAssistantPhaseStartedAt = Date.now();
      const writeForegroundAssistantFinishedTiming = () => {
        writeHostedAssistantTurnTimingRuntimeLog({
          currentTurnDeliveryIntentCount: currentTurnDeliveryIntentIds.length,
          elapsedMs: elapsedSince(assistantPhaseStartedAt),
          foregroundAssistantPass,
          input,
          stage: "foreground-delivery-phase-finished",
          stepElapsedMs: elapsedSince(foregroundAssistantPhaseStartedAt),
        });
      };
      const foregroundAssistantResult = await runForegroundAssistantReplyPhase({
        assistantMetrics,
        currentTurnDeliveryIntentIds,
        foregroundCronReconciliationWake,
        foregroundWorkspaceWake: createFutureExistingHostedAssistantWorkspaceWakeCandidate(input),
        input,
        linqDeliveryContexts: currentLinqDeliveryContexts,
        providerCleanupPlan,
        skippedDeviceSyncWake: deviceSyncFollowUpWake,
        systemMailboxWake,
        systemMailboxWakeAt,
        wake,
      });
      const foregroundAfterCheckpoint = foregroundAssistantResult.afterCheckpoint;
      const timedForegroundAssistantResult =
        foregroundAfterCheckpoint
          ? {
              ...foregroundAssistantResult,
              afterCheckpoint: async () => {
                try {
                  return await foregroundAfterCheckpoint();
                } finally {
                  writeForegroundAssistantFinishedTiming();
                }
              },
            }
          : foregroundAssistantResult;
      if (!foregroundAssistantResult.afterCheckpoint) {
        writeForegroundAssistantFinishedTiming();
      }
      const foregroundResult = mergeContinuingSystemMailboxResult(
        withFreshHostedManagedAutomationsAfterCheckpoint({
          input,
          result: timedForegroundAssistantResult,
        }),
      );
      const result = await withHostedAutoReplyRouteMaintenanceAfterDelivery({
        input,
        result: withPostForegroundMemberMaintenanceAfterCheckpoint({
          executionContext,
          input,
          result: foregroundResult,
          wake,
        }),
      });
      if (providerCleanupPlan.stateQueued && !result.progressed) {
        return {
          ...result,
          checkpointReason: "provider_cleanup",
          progressed: true,
        };
      }
      return result;
    }
    const assistantCronWakeAfterPass =
      shouldResolveHostedAssistantCronWakeAfterAssistantPass({
        assistantMetrics,
        input,
      })
        ? await resolveHostedAssistantCronWakeStateBestEffort(input)
        : null;
    const assistantCronWakeAfterPassCandidate = assistantCronWakeAfterPass
      ? resolveHostedAssistantCronWakeCandidate({
          phaseInput: input,
          state: assistantCronWakeAfterPass,
        })
      : null;
    const providerCleanupDue = providerCleanupOwnedByPostCheckpointDelivery
      ? false
      : providerCleanupPlan.due;
    const providerCleanupStateQueued = providerCleanupOwnedByPostCheckpointDelivery
      ? false
      : providerCleanupPlan.stateQueued;
    const deliveryEffects = await collectHostedAssistantDeliverySideEffects({
      actionApprovalPort: input.runtime.platform.actionApprovalPort ?? null,
      includeBackgroundDueIntents:
        input.shouldYieldBackgroundMaintenance?.() !== true,
      messageVolumeReceiptPort: input.runtime.platform.effectsPort,
      preferredIntentIds: currentTurnDeliveryIntentIds,
      vaultRoot: input.restored.vaultRoot,
    });
    const deliveryEffectsPreparation = await prepareHostedAssistantDeliveryEffectsForDispatch({
      assistantDeliveryEffects: deliveryEffects,
      linqDeliveryContexts: currentLinqDeliveryContexts,
      vaultRoot: input.restored.vaultRoot,
    });

    if (
      shouldFastDispatchAssistantDeliveryEffects({
        assistantMetrics,
        deliveryEffects,
        input,
      })
    ) {
      const fastDispatchBaseNextWake = selectHostedRuntimeWakeCandidate([
        resolveHostedFastDispatchBaseNextWake({
          assistantMetrics,
          input,
          skippedDeviceSyncWake: deviceSyncFollowUpWake,
          systemMailboxWake,
          systemMailboxWakeAt,
        }),
        assistantCronWakeAfterPassCandidate,
      ]);
      const postDelivery = await drainHostedPostCheckpointDelivery({
        assistantMetrics,
        assistantDeliveryEffects: deliveryEffects,
        assistantDeliveryPreparation: deliveryEffectsPreparation,
        baseNextWake: fastDispatchBaseNextWake,
        checkpointReason: "outbox_receipt",
        canConsumeWorkspaceAssistantWake: true,
        input,
        postDeliveryReconciliationWake:
          assistantCronWakeAfterPass?.available === true
            ? assistantCronWakeAfterPass.wake
            : null,
        providerCleanupPlan,
        redactedStatus: null,
        shouldYieldBackgroundDrain: input.shouldYieldBackgroundMaintenance ?? null,
        wake,
      });
      const nextWakeAt = postDelivery.nextWakeAt ?? null;
      const wakeStateProgressed = hostedAssistantWakeStateProgressed({
        assistantMetrics,
        input,
        nextWakeAt,
        skippedDeviceSyncWakeAt: deviceSyncFollowUpWake?.at ?? null,
      });
      const progressed = assistantMetricsProgressed({
        ...assistantMetrics,
        nextWakeAt,
      }, deliveryEffects.length)
        || wakeStateProgressed
        || providerCleanupStateQueued;
      await writeHostedAssistantAutomationDetailRuntimeLogs({
        assistantMetrics,
        input,
      });
      await writeHostedAssistantPassRuntimeLog({
        assistantMetrics,
        deliveryEffectCount: deliveryEffects.length,
        input,
        nextWakeAt,
        progressed,
        systemMailboxWakeAt,
      });
      const phaseProgressed = progressed || providerCleanupDue;
      const redactedStatus = {
        ...buildHostedWorkspaceAssistantPhaseRedactedStatus({
          deliveryEffectCount: deliveryEffects.length,
          nextWakeAt,
          outboxTerminalizedSendingCount: 0,
          progressed: phaseProgressed,
          systemMailboxPrepared: 0,
          systemMailboxRetryableFailed: 0,
        }),
        ...(postDelivery.redactedStatus ?? {}),
      };
      if (!phaseProgressed) {
        return await withHostedAutoReplyRouteMaintenanceAfterDelivery({
          input,
          result: mergeContinuingSystemMailboxResult({
            ...(nextWakeAt ? { nextWakeAt } : {}),
            ...(shouldExposeHostedAssistantPhaseNextWakeReason(postDelivery.nextWakeReason)
              ? { nextWakeReason: postDelivery.nextWakeReason }
              : {}),
            progressed: false,
            redactedStatus,
          }),
        });
      }
      return await withHostedAutoReplyRouteMaintenanceAfterDelivery({
        input,
        result: mergeContinuingSystemMailboxResult({
          checkpointReason: postDelivery.checkpointReason,
          nextWakeAt,
          ...(shouldExposeHostedAssistantPhaseNextWakeReason(postDelivery.nextWakeReason)
            ? { nextWakeReason: postDelivery.nextWakeReason }
            : {}),
          progressed: true,
          redactedStatus,
        }),
      });
    }

    const outboxWakeAt = await resolveHostedAssistantOutboxNextWakeAt({
      vaultRoot: input.restored.vaultRoot,
    });
    const providerCleanupScheduledWakeAt =
      await resolveHostedProviderCleanupScheduledWakeAt({
        nowMs: resolveHostedAssistantPhaseNowMs(input),
        vaultRoot: input.restored.vaultRoot,
      });
    const nextWake = selectHostedRuntimeWakeCandidate([
      createHostedRuntimeWakeCandidate(assistantNextWakeAt, assistantNextWakeReason),
      assistantCronWakeAfterPassCandidate,
      deviceSyncFollowUpWake,
      createHostedRuntimeWakeCandidate(
        outboxWakeAt,
        HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
      ),
      systemMailboxWake,
      createHostedRuntimeWakeCandidate(
        providerCleanupScheduledWakeAt,
        HOSTED_ASSISTANT_WAKE_REASON,
      ),
    ]);
    const nextWakeAt = nextWake.at;
    const wakeStateProgressed = hostedAssistantWakeStateProgressed({
      assistantMetrics,
      input,
      nextWakeAt,
      skippedDeviceSyncWakeAt: deviceSyncFollowUpWake?.at ?? null,
    });
    const progressed = assistantMetricsProgressed({
      ...assistantMetrics,
      nextWakeAt,
    }, deliveryEffects.length)
      || wakeStateProgressed
      || providerCleanupStateQueued;
    await writeHostedAssistantAutomationDetailRuntimeLogs({
      assistantMetrics,
      input,
    });
    await writeHostedAssistantPassRuntimeLog({
      assistantMetrics,
      deliveryEffectCount: deliveryEffects.length,
      input,
      nextWakeAt,
      progressed,
      systemMailboxWakeAt,
    });
    const hasPostCommitProviderCleanup = providerCleanupDue
      || deliveryEffects.length > 0
      || providerCleanupStateQueued;

    const phaseProgressed = progressed || providerCleanupDue;
    const redactedStatus = buildHostedWorkspaceAssistantPhaseRedactedStatus({
      deliveryEffectCount: deliveryEffects.length,
      nextWakeAt,
      outboxTerminalizedSendingCount: 0,
      progressed: phaseProgressed,
      systemMailboxPrepared: 0,
      systemMailboxRetryableFailed: 0,
    });
    if (!phaseProgressed) {
      return await withHostedAutoReplyRouteMaintenanceAfterDelivery({
        input,
        result: mergeContinuingSystemMailboxResult({
          ...(nextWakeAt ? { nextWakeAt } : {}),
          ...(shouldExposeHostedAssistantPhaseNextWakeReason(nextWake.reason)
            ? { nextWakeReason: nextWake.reason }
            : {}),
          progressed: false,
          redactedStatus,
        }),
      });
    }

    const result = mergeContinuingSystemMailboxResult({
      ...(hasPostCommitProviderCleanup
        ? {
            afterCheckpointKeepsForegroundImportLoop: true,
            afterCheckpoint: async () => {
              assertHostedAssistantPhaseLiveness(input.signal);
              const baseNextWake = selectHostedRuntimeWakeCandidate([
                createHostedRuntimeWakeCandidate(assistantNextWakeAt, assistantNextWakeReason),
                assistantCronWakeAfterPassCandidate,
                deviceSyncFollowUpWake,
                systemMailboxWake,
                createHostedRuntimeWakeCandidate(
                  continuingSystemMailboxResult?.nextWakeAt ?? null,
                  continuingSystemMailboxResult?.nextWakeReason ?? "assistant",
                ),
              ]);
              const baseNextWakeAt = baseNextWake.at;
              if (
                deliveryEffects.length === 0
                && !providerCleanupDue
                && !providerCleanupStateQueued
              ) {
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: baseNextWakeAt,
                  nextWakeReason: baseNextWake.reason,
                  redactedStatus: {
                    nextWakeAt: baseNextWakeAt,
                  },
                };
              }
              return await drainHostedPostCheckpointDelivery({
                assistantMetrics,
                assistantDeliveryEffects: deliveryEffects,
                assistantDeliveryPreparation: deliveryEffectsPreparation,
                baseNextWake,
                checkpointReason: deliveryEffects.length > 0 ? "outbox_receipt" : "provider_cleanup",
                canConsumeWorkspaceAssistantWake: true,
                input,
                postDeliveryReconciliationWake:
                  assistantCronWakeAfterPass?.available === true
                    ? assistantCronWakeAfterPass.wake
                    : null,
                providerCleanupPlan,
                redactedStatus: null,
                shouldYieldBackgroundDrain: input.shouldYieldBackgroundMaintenance ?? null,
                wake,
              });
            },
          }
        : {}),
      checkpointReason: deliveryEffects.length > 0
        ? "outbox_sending"
        : providerCleanupStateQueued
          ? "provider_cleanup"
          : resolveHostedAssistantTimerCheckpointReason({
              assistantMetrics: {
                ...assistantMetrics,
                nextWakeAt,
              },
              providerCleanupDue,
              terminalLinqCleanupDue: providerCleanupStateQueued,
              wakeStateProgressed,
            }),
      nextWakeAt,
      ...(shouldExposeHostedAssistantPhaseNextWakeReason(nextWake.reason)
        ? { nextWakeReason: nextWake.reason }
        : {}),
      progressed: true,
      redactedStatus,
    });
    return await withHostedAutoReplyRouteMaintenanceAfterDelivery({
      input,
      result,
    });
  } finally {
    releaseChannelAbortRelay();
    channelAbortController.abort();
  }
}

function hasFreshHostedConversationInput(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  return readHostedInitialAssistantInputIds(input).length > 0;
}

function hasFreshHostedMailboxInput(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  return input.initialMailboxImport.importResult.fetchedCount > 0;
}

async function refreshHostedReminderAvailabilityBestEffort(input: {
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): Promise<HostedWorkspaceRunnerAssistantPhaseResult | null> {
  if (input.input.shouldYieldBackgroundMaintenance?.() === true) {
    return null;
  }

  const nowMs = resolveHostedAssistantPhaseNowMs(input.input);
  const maintenanceSignal = input.input.backgroundMaintenanceSignal
    ?? input.input.signal
    ?? null;
  let result: Awaited<ReturnType<typeof refreshReminderAvailability>>;
  try {
    result = await refreshReminderAvailability({
      connectedApps: input.input.runtime.platform.connectedApps ?? null,
      now: new Date(nowMs),
      shouldYield: input.input.shouldYieldBackgroundMaintenance ?? null,
      signal: maintenanceSignal,
      vaultRoot: input.input.restored.vaultRoot,
    });
  } catch (error) {
    input.input.signal?.throwIfAborted();
    if (
      maintenanceSignal?.aborted
      && input.input.shouldYieldBackgroundMaintenance?.() === true
    ) {
      return {
        checkpointReason: "assistant_runtime_commit",
        nextWakeAt: new Date(
          nowMs + HOSTED_MANAGED_AUTOMATION_SETUP_RETRY_DELAY_MS,
        ).toISOString(),
        nextWakeReason: "assistant",
        progressed: true,
        redactedStatus: {
          reminderAvailabilityMaintenanceYielded: true,
        },
      };
    }
    maintenanceSignal?.throwIfAborted();
    const failure = buildHostedRuntimeFailureDiagnostics(
      error,
      "Hosted reminder availability maintenance failed.",
      { includeSafeIdentity: true },
    );
    await writeHostedRuntimeLogBestEffort({
      entry: {
        ...buildHostedRuntimeLogContextFields({
          attemptId: input.input.request.attemptId,
          leaseGeneration: input.input.request.leaseGeneration,
          workspaceVersion: input.input.request.workspaceVersion,
        }),
        component: "runtime",
        errorCode: failure.errorCode,
        eventCode: "runner.error",
        level: "warn",
        phase: "error",
        redactedJson: {
          ...failure.redactedJson,
          reminderAvailabilityMaintenanceFailed: true,
        },
      },
      platform: input.input.runtime.platform,
    });
    return null;
  }

  if (result.failed > 0) {
    await writeHostedRuntimeLogBestEffort({
      entry: {
        ...buildHostedRuntimeLogContextFields({
          attemptId: input.input.request.attemptId,
          leaseGeneration: input.input.request.leaseGeneration,
          workspaceVersion: input.input.request.workspaceVersion,
        }),
        component: "runtime",
        eventCode: "runner.error",
        level: "warn",
        phase: "error",
        redactedJson: {
          reminderAvailabilityMaintenanceAttempted: result.attempted,
          reminderAvailabilityMaintenanceFailed: result.failed,
          reminderAvailabilityMaintenanceRefreshed: result.refreshed,
        },
      },
      platform: input.input.runtime.platform,
    });
  }
  const nextWakeAt = result.yielded === true
    ? new Date(
      nowMs + HOSTED_MANAGED_AUTOMATION_SETUP_RETRY_DELAY_MS,
    ).toISOString()
    : result.nextRefreshAt;
  if (result.refreshed === 0 && nextWakeAt === null) {
    return null;
  }

  return {
    checkpointReason: "assistant_runtime_commit",
    ...(nextWakeAt ? { nextWakeAt, nextWakeReason: "assistant" } : {}),
    progressed: true,
    redactedStatus: {
      reminderAvailabilityMaintenanceAttempted: result.attempted,
      reminderAvailabilityMaintenanceFailed: result.failed,
      reminderAvailabilityMaintenanceRefreshed: result.refreshed,
      reminderAvailabilityMaintenanceYielded: result.yielded === true,
    },
  };
}

async function applyHostedManagedAutomationsBestEffort(input: {
  defaultRoute?: AutomationRoute | null;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  retryStableKeyFailure: boolean;
}): Promise<HostedWorkspaceRunnerAssistantPhaseResult | null> {
  if (input.input.shouldYieldBackgroundMaintenance?.() === true) {
    return null;
  }

  let diagnosticStage: MurphManagedAutomationDiagnosticStage | null = null;
  const onboardingFollowupDiagnostics: MurphOnboardingFollowupDiagnostic[] = [];
  let result: Awaited<ReturnType<typeof applyMurphManagedAutomations>>;
  try {
    result = await applyMurphManagedAutomations({
      now: new Date(resolveHostedAssistantPhaseNowMs(input.input)),
      onDiagnosticStage(stage) {
        diagnosticStage = stage;
      },
      onOnboardingFollowupDiagnostic(diagnostic) {
        onboardingFollowupDiagnostics.push(diagnostic);
      },
      operatorHomeRoot: input.input.restored.operatorHomeRoot,
      ...(input.defaultRoute !== undefined
        ? { defaultRoute: input.defaultRoute }
        : {}),
      routeValidationProfile: "hosted",
      runtimeEnv: input.input.runtimeEnv,
      shouldYield: input.input.shouldYieldBackgroundMaintenance ?? null,
      vaultRoot: input.input.restored.vaultRoot,
    });
  } catch (error) {
    const failure = buildHostedRuntimeFailureDiagnostics(
      error,
      "Hosted managed automation setup failed.",
      { includeSafeIdentity: true },
    );
    await writeHostedRuntimeLogBestEffort({
      entry: {
        ...buildHostedRuntimeLogContextFields({
          attemptId: input.input.request.attemptId,
          leaseGeneration: input.input.request.leaseGeneration,
          workspaceVersion: input.input.request.workspaceVersion,
        }),
        component: "runtime",
        errorCode: failure.errorCode,
        eventCode: "runner.error",
        level: "warn",
        phase: "error",
        redactedJson: {
          ...failure.redactedJson,
          ...buildHostedManagedAutomationStageDiagnostics(diagnosticStage),
          murphManagedAutomationFailed: true,
        },
      },
      platform: input.input.runtime.platform,
    });
    return buildHostedManagedAutomationFailureResult({
      error,
      input: input.input,
      redactedStatus: {
        murphManagedAutomationFailed: true,
      },
    });
  }

  if (result.experimentLifecycleFailure !== undefined) {
    // The pass still delivered every automation that does not depend on the
    // experiment scan, so this is reported and not treated as a failed setup.
    const failure = buildHostedRuntimeFailureDiagnostics(
      result.experimentLifecycleFailure,
      "Hosted managed automation experiment lifecycle staging failed.",
      { includeSafeIdentity: true },
    );
    await writeHostedRuntimeLogBestEffort({
      entry: {
        ...buildHostedRuntimeLogContextFields({
          attemptId: input.input.request.attemptId,
          leaseGeneration: input.input.request.leaseGeneration,
          workspaceVersion: input.input.request.workspaceVersion,
        }),
        component: "runtime",
        errorCode: failure.errorCode,
        eventCode: "runner.error",
        level: "warn",
        phase: "error",
        redactedJson: {
          ...failure.redactedJson,
          ...buildHostedManagedAutomationStageDiagnostics({
            stage: "experiment_lifecycle",
          }),
          murphManagedAutomationExperimentLifecycleFailed: true,
        },
      },
      platform: input.input.runtime.platform,
    });

    // A transient filesystem or lock failure is still owned by the existing
    // bounded setup-retry ladder. Degrading the stage must not swallow those
    // and report a successful pass, or a time-bound experiment seed is never
    // installed and its one-shot goes stale unrecoverably.
    if (
      isHostedManagedAutomationSetupRetryableError(result.experimentLifecycleFailure)
    ) {
      return buildHostedManagedAutomationFailureResult({
        error: result.experimentLifecycleFailure,
        input: input.input,
        redactedStatus: {
          murphManagedAutomationCreated: result.created,
          murphManagedAutomationExperimentLifecycleFailed: true,
          murphManagedAutomationSkipped: result.skipped,
          murphManagedAutomationUpdated: result.updated,
        },
      });
    }
  }

  if (result.yielded === true) {
    return {
      checkpointReason: "assistant_runtime_commit",
      nextWakeAt: new Date(
        resolveHostedAssistantPhaseNowMs(input.input)
          + HOSTED_MANAGED_AUTOMATION_SETUP_RETRY_DELAY_MS,
      ).toISOString(),
      progressed: true,
      redactedStatus: {
        murphManagedAutomationCreated: result.created,
        murphManagedAutomationSkipped: result.skipped,
        murphManagedAutomationUpdated: result.updated,
        murphManagedAutomationYielded: true,
      },
    };
  }

  if (result.stableKeyRetryNeeded === true) {
    const stableKeyFailure = result.stableKeyFailure ?? new Error(
      "Hosted managed automation stable-key setup requested a retry without a failure.",
    );
    const failure = buildHostedRuntimeFailureDiagnostics(
      stableKeyFailure,
      "Hosted managed automation stable-key setup failed.",
      { includeSafeIdentity: true },
    );
    await writeHostedRuntimeLogBestEffort({
      entry: {
        ...buildHostedRuntimeLogContextFields({
          attemptId: input.input.request.attemptId,
          leaseGeneration: input.input.request.leaseGeneration,
          workspaceVersion: input.input.request.workspaceVersion,
        }),
        component: "runtime",
        errorCode: failure.errorCode,
        eventCode: "runner.error",
        level: "warn",
        phase: "error",
        redactedJson: {
          ...failure.redactedJson,
          murphManagedAutomationCreated: result.created,
          murphManagedAutomationFailed: true,
          murphManagedAutomationSkipped: result.skipped,
          murphManagedAutomationUpdated: result.updated,
        },
      },
      platform: input.input.runtime.platform,
    });
    const changed = result.created + result.updated;
    const retryable = isHostedManagedAutomationSetupRetryableError(
      stableKeyFailure,
    );
    if (retryable || input.retryStableKeyFailure || changed > 0) {
      const retryAttempt = readHostedManagedAutomationSetupRetryAttempt(
        input.input,
      );
      if (!retryable && changed === 0 && retryAttempt === 0) {
        return null;
      }
      return buildHostedManagedAutomationFailureResult({
        error: stableKeyFailure,
        input: input.input,
        redactedStatus: {
          murphManagedAutomationCreated: result.created,
          murphManagedAutomationFailed: true,
          murphManagedAutomationSkipped: result.skipped,
          murphManagedAutomationUpdated: result.updated,
        },
      });
    }
    return null;
  }

  const changed = result.created + result.updated;
  const retryAttempt = readHostedManagedAutomationSetupRetryAttempt(input.input);
  if (changed === 0 && retryAttempt === 0) {
    return null;
  }

  const onboardingFollowupDiagnostic =
    onboardingFollowupDiagnostics.at(-1) ?? null;
  if (
    onboardingFollowupDiagnostic
    && onboardingFollowupDiagnostic.action !== "unchanged"
  ) {
    await writeHostedRuntimeLogBestEffort({
      entry: {
        ...buildHostedRuntimeLogContextFields({
          attemptId: input.input.request.attemptId,
          leaseGeneration: input.input.request.leaseGeneration,
          workspaceVersion: input.input.request.workspaceVersion,
        }),
        component: "runtime",
        eventCode: "assistant.onboarding_followup_reconciled",
        level: "info",
        phase: "invoke",
        redactedJson: buildHostedOnboardingFollowupDiagnostic(
          onboardingFollowupDiagnostic,
        ),
      },
      platform: input.input.runtime.platform,
    });
  }

  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields({
        attemptId: input.input.request.attemptId,
        leaseGeneration: input.input.request.leaseGeneration,
        workspaceVersion: input.input.request.workspaceVersion,
      }),
      component: "runtime",
      eventCode: "assistant.pass_finished",
      level: "info",
      phase: "invoke",
      redactedJson: {
        murphManagedAutomationCreated: result.created,
        murphManagedAutomationFailed: false,
        [HOSTED_MANAGED_AUTOMATION_SETUP_RETRY_ATTEMPT_STATUS_KEY]: 0,
        murphManagedAutomationSetupRetryExhausted: false,
        murphManagedAutomationSetupRetryable: false,
        murphManagedAutomationSkipped: result.skipped,
        murphManagedAutomationUpdated: result.updated,
      },
    },
    platform: input.input.runtime.platform,
  });

  return {
    checkpointReason: "assistant_runtime_commit",
    progressed: true,
    redactedStatus: {
      murphManagedAutomationCreated: result.created,
      murphManagedAutomationFailed: false,
      [HOSTED_MANAGED_AUTOMATION_SETUP_RETRY_ATTEMPT_STATUS_KEY]: 0,
      murphManagedAutomationSetupRetryExhausted: false,
      murphManagedAutomationSetupRetryable: false,
      murphManagedAutomationSkipped: result.skipped,
      murphManagedAutomationUpdated: result.updated,
    },
  };
}

function buildHostedManagedAutomationStageDiagnostics(
  diagnostic: MurphManagedAutomationDiagnosticStage | null,
): HostedRuntimeRedactedJson {
  if (!diagnostic) {
    return {
      murphManagedAutomationStage: "start",
    };
  }

  return {
    murphManagedAutomationStage: diagnostic.stage,
    ...(diagnostic.seedCount === undefined
      ? {}
      : { murphManagedAutomationSeedCount: diagnostic.seedCount }),
    ...(diagnostic.seedPosition === undefined
      ? {}
      : { murphManagedAutomationSeedPosition: diagnostic.seedPosition }),
  };
}

function buildHostedOnboardingFollowupDiagnostic(
  diagnostic: MurphOnboardingFollowupDiagnostic,
): HostedRuntimeRedactedJson {
  return {
    onboardingFollowupAction: diagnostic.action,
    onboardingFollowupActiveUntil: diagnostic.activeUntil,
    onboardingFollowupFirstOccurrenceAt: diagnostic.firstOccurrenceAt,
    onboardingFollowupOpportunityDays: diagnostic.opportunityDays,
    onboardingFollowupPreviousScheduleKind:
      diagnostic.previousScheduleKind,
    onboardingFollowupScheduleKind: diagnostic.scheduleKind,
    onboardingStateCreatedAt: diagnostic.onboardingStateCreatedAt,
    onboardingStateSource: diagnostic.onboardingStateSource,
    onboardingStateStatus: diagnostic.onboardingStateStatus,
    onboardingStateUpdatedAt: diagnostic.onboardingStateUpdatedAt,
  };
}

function buildHostedManagedAutomationFailureResult(input: {
  error: unknown;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  redactedStatus: Record<string, boolean | number>;
}): HostedWorkspaceRunnerAssistantPhaseResult {
  const retryable = isHostedManagedAutomationSetupRetryableError(input.error);
  const previousRetryAttempt = readHostedManagedAutomationSetupRetryAttempt(
    input.input,
  );
  const retryDelayMs = retryable
    ? HOSTED_MANAGED_AUTOMATION_SETUP_FAILURE_RETRY_DELAYS_MS[previousRetryAttempt]
    : undefined;
  const retryAttempt = retryDelayMs === undefined
    ? previousRetryAttempt
    : previousRetryAttempt + 1;
  return {
    checkpointReason: "assistant_runtime_commit",
    ...(retryDelayMs === undefined
      ? {}
      : {
          nextWakeAt: new Date(
            resolveHostedAssistantPhaseNowMs(input.input) + retryDelayMs,
          ).toISOString(),
        }),
    progressed: true,
    redactedStatus: {
      ...input.redactedStatus,
      [HOSTED_MANAGED_AUTOMATION_SETUP_RETRY_ATTEMPT_STATUS_KEY]: retryAttempt,
      murphManagedAutomationSetupRetryExhausted:
        retryable && retryDelayMs === undefined,
      murphManagedAutomationSetupRetryable: retryable,
    },
  };
}

function readHostedManagedAutomationSetupRetryAttempt(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): number {
  const attempt = readHostedRuntimeRedactedNumber(
    input.workspace?.redactedStatus,
    HOSTED_MANAGED_AUTOMATION_SETUP_RETRY_ATTEMPT_STATUS_KEY,
  );
  return Number.isSafeInteger(attempt) && attempt > 0
    ? Math.min(
        attempt,
        HOSTED_MANAGED_AUTOMATION_SETUP_FAILURE_RETRY_DELAYS_MS.length,
      )
    : 0;
}

function isHostedManagedAutomationSetupRetryableError(error: unknown): boolean {
  if (error instanceof VaultCliError) {
    return error.context?.retryable === true;
  }
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  const code = error.code;
  return typeof code === "string"
    && HOSTED_MANAGED_AUTOMATION_SETUP_TRANSIENT_ERROR_CODES.has(code);
}

function withFreshHostedManagedAutomationsAfterCheckpoint(input: {
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  result: HostedWorkspaceRunnerAssistantPhaseResult;
}): HostedWorkspaceRunnerAssistantPhaseResult {
  const assistantInputIds = readHostedInitialAssistantInputIds(input.input);
  if (assistantInputIds.length === 0 || input.result.progressed !== true) {
    return input.result;
  }

  return {
    ...input.result,
    afterCheckpoint: composeHostedAssistantPhaseAfterCheckpoint({
      callbacks: [
        input.result.afterCheckpoint,
        async () => await applyFreshHostedManagedAutomationsAfterCheckpoint({
          input: input.input,
        }),
      ],
    }),
  };
}

async function withHostedAutoReplyRouteMaintenanceAfterDelivery(input: {
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  result: HostedWorkspaceRunnerAssistantPhaseResult;
}): Promise<HostedWorkspaceRunnerAssistantPhaseResult> {
  if (!input.result.afterCheckpoint) {
    const changed = await maintainHostedAutoReplyRouteState(input.input);
    if (!changed || input.result.progressed === true) {
      return input.result;
    }
    return {
      ...input.result,
      checkpointReason: "assistant_runtime_commit",
      progressed: true,
    };
  }

  const afterDeliveryCheckpoint = input.result.afterCheckpoint;
  return {
    ...input.result,
    afterCheckpoint: async () => {
      const postDelivery = await afterDeliveryCheckpoint();
      const changed = await maintainHostedAutoReplyRouteState(input.input);
      return postDelivery ?? (changed
        ? { checkpointReason: "assistant_runtime_commit" }
        : null);
    },
    afterCheckpointKeepsForegroundImportLoop: true,
  };
}

async function maintainHostedAutoReplyRouteState(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): Promise<boolean> {
  if (input.shouldYieldBackgroundMaintenance?.() === true) {
    return false;
  }
  const maintenanceSignal = input.backgroundMaintenanceSignal
    ?? input.signal
    ?? null;
  try {
    const result = await maintainAssistantAutoReplyRouteState({
      shouldYield: input.shouldYieldBackgroundMaintenance ?? null,
      signal: maintenanceSignal,
      vault: input.restored.vaultRoot,
    });
    return result.changed;
  } catch (error) {
    input.signal?.throwIfAborted();
    if (
      maintenanceSignal?.aborted
      && input.shouldYieldBackgroundMaintenance?.() === true
    ) {
      return false;
    }
    const failure = buildHostedRuntimeFailureDiagnostics(
      error,
      "Hosted auto-reply route maintenance failed.",
    );
    await writeHostedRuntimeLogBestEffort({
      entry: {
        ...buildHostedRuntimeLogContextFields({
          attemptId: input.request.attemptId,
          leaseGeneration: input.request.leaseGeneration,
          workspaceVersion: input.request.workspaceVersion,
        }),
        component: "runtime",
        errorCode: failure.errorCode,
        eventCode: "runner.error",
        level: "warn",
        phase: "error",
        redactedJson: {
          ...failure.redactedJson,
          autoReplyRouteMaintenanceFailed: true,
        },
      },
      platform: input.runtime.platform,
    });
  }
  return false;
}

async function applyFreshHostedManagedAutomationsAfterCheckpoint(input: {
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): Promise<HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null> {
  if (input.input.shouldYieldBackgroundMaintenance?.() === true) {
    return null;
  }

  const defaultRoute = await resolveHostedManagedAutomationDefaultRouteBestEffort({
    input: input.input,
  });
  if (!defaultRoute) {
    return null;
  }

  const result = await applyHostedManagedAutomationsBestEffort({
    defaultRoute,
    input: input.input,
    retryStableKeyFailure: true,
  });
  if (!result || result.progressed !== true) {
    return null;
  }

  const assistantCronWake =
    await resolveHostedAssistantCronWakeStateBestEffort(input.input, {
      interruptOnBackgroundYield: true,
    });
  const cronNextWakeAt = assistantCronWake.available
    ? assistantCronWake.wake?.at ?? null
    : new Date(
        resolveHostedAssistantPhaseNowMs(input.input)
          + HOSTED_ASSISTANT_CRON_STATUS_RETRY_DELAY_MS,
      ).toISOString();
  const hasManagedNextWakeAt = Object.hasOwn(result, "nextWakeAt");
  const nextWake = selectHostedRuntimeWakeCandidate([
    createHostedRuntimeWakeCandidate(
      cronNextWakeAt,
      assistantCronWake.wake?.reason ?? HOSTED_ASSISTANT_WAKE_REASON,
    ),
    createHostedRuntimeWakeCandidate(
      hasManagedNextWakeAt ? result.nextWakeAt ?? null : null,
      result.nextWakeReason ?? HOSTED_ASSISTANT_WAKE_REASON,
    ),
    // When this post-checkpoint result owns a wake it replaces the phase
    // result's wake in the workspace runner, so it must not drop the
    // scheduled wake owned by hosted-provider-cleanup.json.
    createHostedRuntimeWakeCandidate(
      await resolveHostedProviderCleanupScheduledWakeAt({
        nowMs: resolveHostedAssistantPhaseNowMs(input.input),
        vaultRoot: input.input.restored.vaultRoot,
      }),
      HOSTED_ASSISTANT_WAKE_REASON,
    ),
  ]);
  const hasNextWakeAt = cronNextWakeAt !== null || hasManagedNextWakeAt;

  return {
    checkpointReason: result.checkpointReason,
    ...(hasNextWakeAt ? { nextWakeAt: nextWake.at } : {}),
    ...(shouldExposeHostedAssistantPhaseNextWakeReason(nextWake.reason)
      ? { nextWakeReason: nextWake.reason }
      : {}),
    ...(result.redactedStatus ? { redactedStatus: result.redactedStatus } : {}),
  };
}

async function resolveHostedManagedAutomationDefaultRouteBestEffort(input: {
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): Promise<AutomationRoute | null> {
  const assistantInputIds = readHostedInitialAssistantInputIds(input.input);
  if (assistantInputIds.length === 0) {
    return null;
  }

  const routes: AssistantCurrentDeliveryRoute[] = [];
  for (const inputId of assistantInputIds) {
    if (!inputId) {
      continue;
    }

    try {
      const event = await readAssistantInputEvent({
        inputId,
        vault: input.input.restored.vaultRoot,
      });
      if (!event) {
        return null;
      }
      if (event.replyTarget === null) {
        return null;
      }
      const route = readHostedAssistantInputCurrentDeliveryRoute({
        conversation: event.conversation ?? null,
        replyTarget: event.replyTarget ?? null,
      });
      if (!route) {
        return null;
      }
      routes.push(route);
    } catch {
      return null;
    }
  }

  const route = resolveUnambiguousCurrentDeliveryRoute(routes);
  if (!route) {
    return null;
  }

  return {
    channel: route.channel,
    deliverySource: null,
    deliveryTarget: route.deliveryTarget,
    identityId: route.identityId ?? null,
    participantId: route.participantId ?? null,
    threadId: route.threadId ?? null,
    ...(typeof route.threadIsDirect === "boolean"
      ? { threadIsDirect: route.threadIsDirect }
      : {}),
  };
}

function isHostedForegroundAssistantDeliveryPass(input: {
  assistantMetrics: Awaited<ReturnType<typeof runHostedAssistantAutomationLane>>;
  currentTurnDeliveryIntentIds: readonly string[];
  hasFreshConversationInput: boolean;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): boolean {
  return input.currentTurnDeliveryIntentIds.length > 0
    || input.hasFreshConversationInput
    || input.assistantMetrics.activeTurnInputIngested === true;
}

function mergeHostedAssistantPhaseResults(
  first: HostedWorkspaceRunnerAssistantPhaseResult | null,
  second: HostedWorkspaceRunnerAssistantPhaseResult | null,
): HostedWorkspaceRunnerAssistantPhaseResult | null {
  if (!first) {
    return second;
  }
  if (!second) {
    return first;
  }

  return mergeContinuingSystemMailboxAssistantPhaseResult({
    assistantResult: second,
    systemMailboxResult: first,
  });
}

function postCheckpointDeliveryResultOwnsProviderCleanup(
  result: HostedWorkspaceRunnerAssistantPhaseResult | null,
): boolean {
  return result?.afterCheckpointKeepsForegroundImportLoop === true;
}

function mergePendingAssistantInputMaintenanceResult(input: {
  pendingAttemptResult: HostedWorkspaceRunnerAssistantPhaseResult;
  systemMailboxResult: HostedWorkspaceRunnerAssistantPhaseResult | null;
}): HostedWorkspaceRunnerAssistantPhaseResult {
  return mergeContinuingSystemMailboxAssistantPhaseResult({
    assistantResult: input.pendingAttemptResult,
    systemMailboxResult: stripHostedAssistantPhaseWake(input.systemMailboxResult),
  });
}

function stripHostedAssistantPhaseWake(
  result: HostedWorkspaceRunnerAssistantPhaseResult | null,
): HostedWorkspaceRunnerAssistantPhaseResult | null {
  if (!result) {
    return null;
  }

  const stripped: HostedWorkspaceRunnerAssistantPhaseResult = { ...result };
  delete stripped.invocationLocalAssistantWakeAt;
  delete stripped.nextWakeAt;
  delete stripped.nextWakeReason;
  if (result.afterCheckpoint) {
    stripped.afterCheckpoint = async () =>
      stripHostedAssistantPostCheckpointWake(await result.afterCheckpoint?.());
  }
  return stripped;
}

function stripHostedAssistantPostCheckpointWake(
  result: HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null | void,
): HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null {
  if (!result) {
    return null;
  }

  const stripped: HostedWorkspaceRunnerAssistantPhasePostCheckpoint = { ...result };
  delete stripped.nextWakeAt;
  delete stripped.nextWakeReason;
  return stripped;
}

function mergeContinuingSystemMailboxAssistantPhaseResult(input: {
  assistantResult: HostedWorkspaceRunnerAssistantPhaseResult;
  systemMailboxResult: HostedWorkspaceRunnerAssistantPhaseResult | null;
}): HostedWorkspaceRunnerAssistantPhaseResult {
  if (!input.systemMailboxResult) {
    return input.assistantResult;
  }

  const hasNextWakeAt = Object.hasOwn(input.systemMailboxResult, "nextWakeAt")
    || Object.hasOwn(input.assistantResult, "nextWakeAt");
  const nextWake = selectHostedRuntimeWakeCandidate([
    createHostedRuntimeWakeCandidate(
      input.systemMailboxResult.nextWakeAt ?? null,
      input.systemMailboxResult.nextWakeReason ?? "assistant",
    ),
    createHostedRuntimeWakeCandidate(
      input.assistantResult.nextWakeAt ?? null,
      input.assistantResult.nextWakeReason ?? "assistant",
    ),
  ]);
  const redactedStatus = mergeHostedRuntimeRedactedStatus(
    input.systemMailboxResult.redactedStatus,
    input.assistantResult.redactedStatus,
  );
  const stagedDirtyAcks = mergeHostedDeviceSyncStagedDirtyAcks(
    input.systemMailboxResult.stagedDirtyAcks,
    input.assistantResult.stagedDirtyAcks,
  );
  const browserVaultReplicaRefreshRequested =
    input.systemMailboxResult.browserVaultReplicaRefreshRequested === true
    || input.assistantResult.browserVaultReplicaRefreshRequested === true;
  const deviceSyncMaintenanceRan =
    input.systemMailboxResult.deviceSyncMaintenanceRan === true
    || input.assistantResult.deviceSyncMaintenanceRan === true;
  const afterCheckpointKeepsForegroundImportLoop =
    input.systemMailboxResult.afterCheckpointKeepsForegroundImportLoop === true
    || input.assistantResult.afterCheckpointKeepsForegroundImportLoop === true;
  const foregroundPrioritySystemCompletionProcessed =
    input.systemMailboxResult.foregroundPrioritySystemCompletionProcessed === true
    || input.assistantResult.foregroundPrioritySystemCompletionProcessed === true;
  const afterCheckpoint = composeHostedAssistantPhaseAfterCheckpoint({
    callbacks: [
      input.systemMailboxResult.afterCheckpoint,
      input.assistantResult.afterCheckpoint,
    ],
  });

  const progressedResult = input.assistantResult.progressed === true
    ? input.assistantResult
    : input.systemMailboxResult.progressed === true
    ? input.systemMailboxResult
    : null;
  // The foreground reply phase only ever reports its failed-reply count on the
  // assistant-lane result; carry it through the system-mailbox merge so the
  // workspace runner can gate the durable conversation consumed ack.
  const foregroundReplyFailed = input.assistantResult.foregroundReplyFailed;
  const invocationLocalAssistantWakeAt =
    input.assistantResult.invocationLocalAssistantWakeAt ?? null;
  if (progressedResult) {
    return {
      ...(afterCheckpoint ? { afterCheckpoint } : {}),
      ...(browserVaultReplicaRefreshRequested
        ? { browserVaultReplicaRefreshRequested: true }
        : {}),
      ...(deviceSyncMaintenanceRan ? { deviceSyncMaintenanceRan: true } : {}),
      ...(afterCheckpointKeepsForegroundImportLoop
        ? { afterCheckpointKeepsForegroundImportLoop: true }
        : {}),
      checkpointReason: progressedResult.checkpointReason,
      ...(foregroundReplyFailed === undefined ? {} : { foregroundReplyFailed }),
      ...(foregroundPrioritySystemCompletionProcessed
        ? { foregroundPrioritySystemCompletionProcessed: true }
        : {}),
      ...(invocationLocalAssistantWakeAt
        ? { invocationLocalAssistantWakeAt }
        : {}),
      ...(hasNextWakeAt ? { nextWakeAt: nextWake.at } : {}),
      ...(shouldExposeHostedAssistantPhaseNextWakeReason(nextWake.reason)
        ? { nextWakeReason: nextWake.reason }
        : {}),
      progressed: true,
      ...(redactedStatus ? { redactedStatus } : {}),
      ...withHostedDeviceSyncStagedDirtyAcks(stagedDirtyAcks),
    };
  }

  return {
    ...(browserVaultReplicaRefreshRequested
      ? { browserVaultReplicaRefreshRequested: true }
      : {}),
    ...(deviceSyncMaintenanceRan ? { deviceSyncMaintenanceRan: true } : {}),
    ...(foregroundReplyFailed === undefined ? {} : { foregroundReplyFailed }),
    ...(foregroundPrioritySystemCompletionProcessed
      ? { foregroundPrioritySystemCompletionProcessed: true }
      : {}),
    ...(invocationLocalAssistantWakeAt
      ? { invocationLocalAssistantWakeAt }
      : {}),
    ...(hasNextWakeAt ? { nextWakeAt: nextWake.at } : {}),
    ...(shouldExposeHostedAssistantPhaseNextWakeReason(nextWake.reason)
      ? { nextWakeReason: nextWake.reason }
      : {}),
    progressed: false,
    ...(redactedStatus ? { redactedStatus } : {}),
    ...withHostedDeviceSyncStagedDirtyAcks(stagedDirtyAcks),
  };
}

function withHostedDeviceSyncMaintenanceRan(
  result: HostedWorkspaceRunnerAssistantPhaseResult,
  deviceSyncMaintenanceRan: boolean,
): HostedWorkspaceRunnerAssistantPhaseResult {
  return deviceSyncMaintenanceRan
    ? { ...result, deviceSyncMaintenanceRan: true }
    : result;
}

async function finalizeHostedBackgroundMaintenanceResult(input: {
  backgroundMaintenanceYielded: boolean;
  initialProviderCleanupCheckpoint: HostedProviderCleanupCheckpoint | null;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  result: HostedWorkspaceRunnerAssistantPhaseResult;
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>;
}): Promise<HostedWorkspaceRunnerAssistantPhaseResult> {
  const providerCleanupPlan = await prepareHostedProviderCleanupPlan({
    deferred:
      input.backgroundMaintenanceYielded
      || input.input.shouldYieldBackgroundMaintenance?.() === true,
    idleCheckpointDelayMs: input.input.request.idleCheckpointDelayMs,
    initialCheckpoint: input.initialProviderCleanupCheckpoint,
    nowMs: resolveHostedAssistantPhaseNowMs(input.input),
    shouldYield: input.input.shouldYieldBackgroundMaintenance ?? null,
    vaultRoot: input.input.restored.vaultRoot,
  });
  const result = input.result;
  if (
    !providerCleanupPlan.requiresCheckpoint
    || postCheckpointDeliveryResultOwnsProviderCleanup(result)
  ) {
    return result;
  }

  const afterCheckpoint = result.afterCheckpoint ?? null;
  const drainProviderCleanupAfterCheckpoint = async (
    baseNextWake: HostedRuntimeWakeCandidate,
  ) => {
    assertHostedAssistantPhaseLiveness(input.input.signal);
    return await drainHostedPostCheckpointDelivery({
      assistantDeliveryEffects: [],
      baseNextWake,
      checkpointReason: "provider_cleanup",
      canConsumeWorkspaceAssistantWake: false,
      input: input.input,
      providerCleanupPlan,
      redactedStatus: null,
      shouldYieldBackgroundDrain: input.input.shouldYieldBackgroundMaintenance ?? null,
      wake: input.wake,
    });
  };
  const afterProviderCleanupCheckpoint = async () => {
    const postCheckpoint = afterCheckpoint ? await afterCheckpoint() : null;
    const baseNextWake = postCheckpoint
      ? createHostedRuntimeWakeCandidate(
          postCheckpoint.nextWakeAt ?? null,
          postCheckpoint.nextWakeReason ?? HOSTED_ASSISTANT_WAKE_REASON,
        )
      : createHostedRuntimeWakeCandidate(
          result.nextWakeAt ?? null,
          result.nextWakeReason ?? HOSTED_ASSISTANT_WAKE_REASON,
        );
    const providerCleanup = await drainProviderCleanupAfterCheckpoint(baseNextWake);
    return postCheckpoint
      ? mergeHostedAssistantPhasePostCheckpoint(postCheckpoint, providerCleanup)
      : providerCleanup;
  };

  return {
    ...result,
    afterCheckpoint: afterProviderCleanupCheckpoint,
    // The appended post-checkpoint step can drain provider cleanup, so keep
    // the foreground import loop alive: a fresh message arriving mid-drain
    // must be importable so the drain's yield hook preempts instead of the
    // wake being consumed with the loop already stopped (Hosted Foreground
    // Priority).
    afterCheckpointKeepsForegroundImportLoop: true,
    checkpointReason: result.progressed === true
      ? result.checkpointReason ?? "assistant_runtime_commit"
      : "provider_cleanup",
    progressed: true,
  };
}

function composeHostedAssistantPhaseAfterCheckpoint(input: {
  callbacks: readonly HostedWorkspaceRunnerAssistantPhaseResult["afterCheckpoint"][];
}): HostedWorkspaceRunnerAssistantPhaseResult["afterCheckpoint"] {
  const activeCallbacks = input.callbacks.filter(
    (callback): callback is NonNullable<
      HostedWorkspaceRunnerAssistantPhaseResult["afterCheckpoint"]
    > => callback !== null && callback !== undefined,
  );
  if (activeCallbacks.length === 0) {
    return null;
  }

  return async () => {
    let merged: HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null = null;
    for (const callback of activeCallbacks) {
      const result = await callback();
      if (!result) {
        continue;
      }
      merged = mergeHostedAssistantPhasePostCheckpoint(merged, result);
    }
    return merged;
  };
}

function mergeHostedAssistantPhasePostCheckpoint(
  previous: HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null,
  current: HostedWorkspaceRunnerAssistantPhasePostCheckpoint,
): HostedWorkspaceRunnerAssistantPhasePostCheckpoint {
  if (!previous) {
    return current;
  }

  const hasNextWakeAt = Object.hasOwn(previous, "nextWakeAt")
    || Object.hasOwn(current, "nextWakeAt");
  const nextWake = selectHostedRuntimeWakeCandidate([
    createHostedRuntimeWakeCandidate(
      previous.nextWakeAt ?? null,
      previous.nextWakeReason ?? "assistant",
    ),
    createHostedRuntimeWakeCandidate(
      current.nextWakeAt ?? null,
      current.nextWakeReason ?? "assistant",
    ),
  ]);
  const redactedStatus = mergeHostedRuntimeRedactedStatus(
    previous.redactedStatus,
    current.redactedStatus,
  );
  const afterDurableCheckpoint = composeHostedAssistantPhaseDurableCheckpointEffects(
    previous.afterDurableCheckpoint ?? null,
    current.afterDurableCheckpoint ?? null,
  );

  return {
    ...(afterDurableCheckpoint ? { afterDurableCheckpoint } : {}),
    checkpointReason: current.checkpointReason,
    ...(hasNextWakeAt ? { nextWakeAt: nextWake.at } : {}),
    ...(shouldExposeHostedAssistantPhaseNextWakeReason(nextWake.reason)
      ? { nextWakeReason: nextWake.reason }
      : {}),
    ...(redactedStatus ? { redactedStatus } : {}),
  };
}

function composeHostedAssistantPhaseDurableCheckpointEffects(
  first: HostedWorkspaceRunnerAssistantPhasePostCheckpoint["afterDurableCheckpoint"] | null,
  second: HostedWorkspaceRunnerAssistantPhasePostCheckpoint["afterDurableCheckpoint"] | null,
): HostedWorkspaceRunnerAssistantPhasePostCheckpoint["afterDurableCheckpoint"] | null {
  const effects = [
    ...listHostedAssistantPhaseDurableCheckpointEffects(first),
    ...listHostedAssistantPhaseDurableCheckpointEffects(second),
  ];
  if (effects.length === 0) {
    return null;
  }
  return effects;
}

function listHostedAssistantPhaseDurableCheckpointEffects(
  effect: HostedWorkspaceRunnerAssistantPhasePostCheckpoint["afterDurableCheckpoint"] | null,
): HostedWorkspaceDurableCheckpointEffect[] {
  if (!effect) {
    return [];
  }
  return typeof effect === "function" ? [effect] : [...effect];
}

interface DeferredHostedDeviceSyncDirtyPostCheckpointRecord {
  afterDurableCheckpoint: NonNullable<
    HostedWorkspaceRunnerAssistantPhasePostCheckpoint["afterDurableCheckpoint"]
  >;
  nextWakeAt: string | null;
  redactedStatus: HostedRuntimeRedactedJson;
}

interface DeferredHostedSystemMailboxPostCheckpointRecord {
  afterDurableCheckpoint: NonNullable<
    HostedWorkspaceRunnerAssistantPhasePostCheckpoint["afterDurableCheckpoint"]
  >;
  redactedStatus: HostedRuntimeRedactedJson;
  statusCallback: {
    failed: number;
    nextWakeAt: string | null;
    nextWakeReason?: string | null;
    recorded: number;
  };
}

function shouldDeferHostedSystemMailboxRecordAfterDurableCheckpoint(
  input: HostedSystemMailboxPendingItem,
): boolean {
  return input.postCheckpointRecord?.kind === "codex-auth.updated"
    || input.postCheckpointRecord?.kind === "vault-share.projection";
}

function deferHostedDeviceSyncDirtyPostCheckpointRecord(input: Parameters<
  typeof recordHostedDeviceSyncDirtyPostCheckpointRecord
>[0]): DeferredHostedDeviceSyncDirtyPostCheckpointRecord {
  const afterDurableCheckpoint: HostedWorkspaceDurableCheckpointEffect = Object.assign(
    async () => {
      try {
        const result = await recordHostedDeviceSyncDirtyPostCheckpointRecord(input);
        return result.nextWakeAt
          ? {
              nextWakeAt: result.nextWakeAt,
              nextWakeReason: HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
            }
          : null;
      } catch (error) {
        const failure = buildHostedRuntimeFailureDiagnostics(
          error,
          "Hosted device-sync dirty checkpoint ack failed.",
        );
        const nextWakeAt = resolveHostedDeviceSyncDirtyAckFailureWakeAt(input.record);
        await writeHostedRuntimeLogBestEffort({
          entry: {
            component: "device-sync",
            errorCode: failure.errorCode,
            eventCode: "device-sync.dirty_ack_persistence_failed",
            level: "warn",
            phase: "checkpoint",
            redactedJson: {
              ...failure.redactedJson,
              failureEventOrigin: "checkpoint" satisfies DeviceSyncJobFailureEventOrigin,
              nextWakeAtPresent: true,
            },
          },
          platform: input.runtime.platform,
        });
        return {
          nextWakeAt,
          nextWakeReason: HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
        };
      }
    },
    {
      vaultShareProjectionFailureWake: {
        nextWakeAt: resolveHostedDeviceSyncDirtyAckFailureWakeAt(input.record),
        nextWakeReason: HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
        requiresFollowUpCheckpoint: true,
      },
    },
  );
  return {
    afterDurableCheckpoint,
    nextWakeAt: input.record.nextWakeAt ?? null,
    redactedStatus: {
      hostedDeviceSyncDirtyAckDeferred: true,
      hostedDeviceSyncDirtyAckRecorded: false,
      hostedDeviceSyncDirtyStillPending: true,
    },
  };
}

function deferHostedSystemMailboxPostCheckpointRecord(input: Parameters<
  typeof recordHostedSystemMailboxItemAfterCheckpoint
>[0] & {
  followUpWakeAt: string;
}): DeferredHostedSystemMailboxPostCheckpointRecord {
  const { followUpWakeAt, ...recordInput } = input;
  const requiresVaultShareProjectionResult =
    recordInput.item.postCheckpointRecord?.kind === "vault-share.projection";
  const afterDurableCheckpoint: HostedWorkspaceDurableCheckpointEffect = Object.assign(
    async (context?: HostedWorkspaceDurableCheckpointEffectContext) => {
      const result = await recordHostedSystemMailboxItemAfterCheckpoint({
        ...recordInput,
        ...(requiresVaultShareProjectionResult && context?.vaultShareProjectionResult
          ? { vaultShareProjectionResult: context.vaultShareProjectionResult }
          : {}),
      });
      if (result.failed > 0) {
        return {
          nextWakeAt: result.nextWakeAt,
          nextWakeReason: result.nextWakeReason ?? "assistant",
          requiresFollowUpCheckpoint: true,
        };
      }
      return {
        nextWakeAt: followUpWakeAt,
        nextWakeReason: "assistant",
        requiresFollowUpCheckpoint: true,
      };
    },
    requiresVaultShareProjectionResult
      ? {
          requiresVaultShareProjectionResult: true,
          vaultShareProjectionFailureWake: {
            nextWakeAt: followUpWakeAt,
            nextWakeReason: "assistant",
            requiresFollowUpCheckpoint: true,
          },
        }
      : {},
  );
  return {
    afterDurableCheckpoint,
    redactedStatus: {
      hostedSystemMailboxRecordDeferred: true,
    },
    statusCallback: {
      failed: 0,
      nextWakeAt: null,
      recorded: 0,
    },
  };
}

function resolveHostedDeviceSyncDirtyAckFailureWakeAt(input: Parameters<
  typeof recordHostedDeviceSyncDirtyPostCheckpointRecord
>[0]["record"]): string {
  return input.nextWakeAt
    ?? new Date(Date.now() + HOSTED_DEVICE_SYNC_DIRTY_ACK_FAILURE_RETRY_DELAY_MS).toISOString();
}

function mergeHostedRuntimeRedactedStatus(
  first: HostedRuntimeRedactedJson | null | undefined,
  second: HostedRuntimeRedactedJson | null | undefined,
): HostedRuntimeRedactedJson | null {
  if (!first && !second) {
    return null;
  }

  const merged: HostedRuntimeRedactedJson = {
    ...(first ?? {}),
    ...(second ?? {}),
  };
  const systemMailboxPrepared =
    readHostedRuntimeRedactedNumber(first, "hostedSystemMailboxPrepared")
    + readHostedRuntimeRedactedNumber(second, "hostedSystemMailboxPrepared");
  const systemMailboxRetryableFailed =
    readHostedRuntimeRedactedNumber(first, "hostedSystemMailboxRetryableFailed")
    + readHostedRuntimeRedactedNumber(second, "hostedSystemMailboxRetryableFailed");
  if (systemMailboxPrepared > 0) {
    merged.hostedSystemMailboxPrepared = systemMailboxPrepared;
  }
  if (systemMailboxRetryableFailed > 0) {
    merged.hostedSystemMailboxRetryableFailed = systemMailboxRetryableFailed;
  }
  if (
    first?.hostedAssistantProgressed === true
    || second?.hostedAssistantProgressed === true
  ) {
    merged.hostedAssistantProgressed = true;
  }

  return merged;
}

function readHostedRuntimeRedactedNumber(
  value: HostedRuntimeRedactedJson | null | undefined,
  key: string,
): number {
  const field = value?.[key];
  return typeof field === "number" ? field : 0;
}

function shouldContinueAssistantLaneAfterSystemMailboxPreparation(
  systemMailboxPreparation: NonNullable<
    Awaited<ReturnType<typeof prepareHostedSystemMailboxItemForCheckpoint>>
  >,
): boolean {
  return "item" in systemMailboxPreparation
    && systemMailboxPreparation.status === "processed"
    && systemMailboxPreparation.item.routeAction === "apply-runtime-control-request"
    && systemMailboxPreparation.item.wake.kind === "runtime.manual-requested";
}

function isCausalPendingEffectsReconciliation(
  systemMailboxPreparation: HostedSystemMailboxPreparation,
): systemMailboxPreparation is HostedCausalPendingEffectsReconciliationPreparation {
  // This wake names one already-persisted approval effect. Finishing that exact
  // continuation is part of the member's foreground action, not a background
  // scan that should yield to a later chat message.
  return "item" in systemMailboxPreparation
    && (
      systemMailboxPreparation.status === "processed"
      || systemMailboxPreparation.status === "recording"
    )
    && systemMailboxPreparation.item.routeAction === "apply-runtime-control-request"
    && systemMailboxPreparation.item.wake.kind
      === "runtime.pending-effects-reconcile-requested";
}

function isForegroundCausalSystemMailboxPreparation(
  preparation: HostedSystemMailboxPreparation,
): preparation is HostedForegroundCausalSystemMailboxPreparation {
  if (isCausalPendingEffectsReconciliation(preparation)) {
    return true;
  }

  return "item" in preparation
    && (
      preparation.status === "processed"
      || preparation.status === "recording"
    )
    && preparation.item.routeAction === "continue-assistant-ask"
    && preparation.item.wake.kind === "assistant.ask.completed";
}

function isPhoneCallResultSystemMailboxPreparation(
  preparation: HostedSystemMailboxPreparation,
): boolean {
  return "item" in preparation
    && preparation.item.routeAction === "dispatch-assistant-notification"
    && preparation.item.wake.kind === "assistant.notification.requested"
    && preparation.item.mailboxDedupeKey.startsWith(
      HOSTED_PHONE_CALL_RESULT_MAILBOX_DEDUPE_KEY_PREFIX,
    );
}

function isForegroundPrioritySystemCompletionProcessed(
  preparation: HostedSystemMailboxPreparation,
): boolean {
  return preparation.status === "processed"
    && preparation.item.routeAction === "dispatch-assistant-notification"
    && preparation.item.wake.kind === "assistant.notification.requested"
    && HOSTED_PRE_CHECKPOINT_EXTERNAL_COMPLETION_DEDUPE_KEY_PREFIXES.some(
      (prefix) => preparation.item.mailboxDedupeKey.startsWith(prefix),
    );
}

type HostedAssistantDeliveryEffects = Awaited<
  ReturnType<typeof collectHostedAssistantDeliverySideEffects>
>;
interface HostedPreparedAssistantDeliveryEffects {
  effects: HostedAssistantDeliveryEffects;
  preparation: HostedAssistantDeliveryPreparation | null;
}
type HostedAssistantMetrics = Awaited<ReturnType<typeof runHostedAssistantAutomationLane>>;
type HostedDeviceSyncWakeMetrics = HostedMaintenanceMetrics;
type HostedDeviceActivityAutomationScheduleResult =
  Awaited<ReturnType<typeof scheduleDeviceActivityTriggeredAutomations>>;
type HostedSystemMailboxPreparation = NonNullable<
  Awaited<ReturnType<typeof prepareHostedSystemMailboxItemForCheckpoint>>
>;
type HostedCausalPendingEffectsReconciliationPreparation = Extract<
  HostedSystemMailboxPreparation,
  { status: "processed" | "recording" }
> & {
  item: HostedSystemMailboxPendingItem & {
    wake: Extract<
      HostedSystemMailboxPendingItem["wake"],
      { kind: "runtime.pending-effects-reconcile-requested" }
    >;
  };
};
type HostedForegroundCausalSystemMailboxPreparation = Extract<
  HostedSystemMailboxPreparation,
  { status: "processed" | "recording" }
>;
type HostedAssistantCronStatus = Awaited<ReturnType<typeof getAssistantCronStatus>>;

interface HostedAssistantCronWakeState {
  available: boolean;
  dueNow: boolean;
  wake: HostedRuntimeWakeCandidate | null;
}

function createUnavailableHostedAssistantCronWakeState(): HostedAssistantCronWakeState {
  return {
    available: false,
    dueNow: false,
    wake: null,
  };
}

function isBrowserVaultReplicaRefreshSystemMailboxPreparation(
  systemMailboxPreparation: HostedSystemMailboxPreparation,
): boolean {
  return "item" in systemMailboxPreparation
    && systemMailboxPreparation.status === "processed"
    && systemMailboxPreparation.item.routeAction === "apply-runtime-control-request"
    && systemMailboxPreparation.item.wake.kind === "runtime.browser-vault-refresh-requested";
}

function mergeHostedDeviceSyncStagedDirtyAcks(
  ...groups: readonly (readonly HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] | null | undefined)[]
): HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] {
  return groups.flatMap((group) => group ?? []);
}

function withHostedDeviceSyncStagedDirtyAcks(
  records: readonly HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] | null | undefined,
): { stagedDirtyAcks: readonly HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] } | Record<string, never> {
  return records && records.length > 0
    ? { stagedDirtyAcks: records }
    : {};
}

function emptyHostedDeviceActivityAutomationScheduleResult(): HostedDeviceActivityAutomationScheduleResult {
  return {
    matched: 0,
    nextWakeAt: null,
    scheduled: 0,
  };
}

function createHostedDeviceActivityAutomationWakeCandidate(
  result: HostedDeviceActivityAutomationScheduleResult | null,
): HostedRuntimeWakeCandidate | null {
  return createHostedRuntimeWakeCandidate(
    result?.nextWakeAt ?? null,
    HOSTED_ASSISTANT_WAKE_REASON,
  );
}

function resolveHostedAssistantCronWakeState(
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput,
  cronStatus: HostedAssistantCronStatus,
): HostedAssistantCronWakeState {
  const nowMs = resolveHostedAssistantPhaseNowMs(phaseInput);
  const dueNow = cronStatus.dueJobs > 0;
  if (dueNow) {
    return {
      available: true,
      dueNow: true,
      wake: createHostedRuntimeWakeCandidate(
        new Date(nowMs).toISOString(),
        HOSTED_ASSISTANT_WAKE_REASON,
      ),
    };
  }

  return {
    available: true,
    dueNow: false,
    wake: createHostedRuntimeWakeCandidate(
      resolveHostedAssistantAutomationNextWakeAt({
        input: phaseInput,
        nextWakeAt: cronStatus.nextRunAt,
      }),
      HOSTED_ASSISTANT_WAKE_REASON,
    ),
  };
}

// Best-effort because this read is wake reconciliation for background lanes:
// due cron should run the assistant lane now, future cron should stay armed,
// and a transient status-read failure must not break unrelated maintenance.
async function resolveHostedAssistantCronWakeStateBestEffort(
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput,
  options: { interruptOnBackgroundYield?: boolean } = {},
): Promise<HostedAssistantCronWakeState> {
  const shouldInterruptOnYield = options.interruptOnBackgroundYield === true
    && typeof phaseInput.shouldYieldBackgroundMaintenance === "function";
  if (
    shouldInterruptOnYield
    && phaseInput.shouldYieldBackgroundMaintenance?.() === true
  ) {
    return createUnavailableHostedAssistantCronWakeState();
  }

  const statusPromise = getAssistantCronStatus(
    phaseInput.restored.vaultRoot,
    buildHostedAssistantCronStatusOptions(phaseInput),
  )
    .then((cronStatus) => resolveHostedAssistantCronWakeState(phaseInput, cronStatus))
    .catch(() => createUnavailableHostedAssistantCronWakeState());
  if (!shouldInterruptOnYield) {
    return await statusPromise;
  }

  try {
    return await resolveHostedAssistantCronWakeStateOrYield({
      phaseInput,
      statusPromise,
    });
  } catch {
    return createUnavailableHostedAssistantCronWakeState();
  }
}

async function resolveHostedAssistantCronWakeStateOrYield(input: {
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput;
  statusPromise: Promise<HostedAssistantCronWakeState>;
}): Promise<HostedAssistantCronWakeState> {
  let yieldTimer: ReturnType<typeof setInterval> | null = null;
  try {
    const yieldPromise = new Promise<HostedAssistantCronWakeState>((resolve) => {
      const resolveIfYielded = () => {
        if (input.phaseInput.shouldYieldBackgroundMaintenance?.() === true) {
          resolve(createUnavailableHostedAssistantCronWakeState());
        }
      };
      resolveIfYielded();
      yieldTimer = setInterval(
        resolveIfYielded,
        HOSTED_ASSISTANT_CRON_STATUS_YIELD_POLL_MS,
      );
      yieldTimer.unref?.();
    });
    return await Promise.race([input.statusPromise, yieldPromise]);
  } finally {
    if (yieldTimer) {
      clearInterval(yieldTimer);
    }
  }
}

function resolveHostedAssistantCronWakeCandidate(input: {
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput;
  state: HostedAssistantCronWakeState;
}): HostedRuntimeWakeCandidate | null {
  if (input.state.available) {
    return input.state.wake;
  }

  return createExistingHostedAssistantWorkspaceWakeCandidate(input.phaseInput);
}

function createExistingHostedAssistantWorkspaceWakeCandidate(
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput,
): HostedRuntimeWakeCandidate | null {
  const wakeAt = phaseInput.workspace?.nextWakeAt ?? null;
  const wakeReason = phaseInput.workspace?.nextWakeReason ?? null;
  if (!hostedRuntimeWakeReasonUsesAssistantPhase(wakeReason)) {
    return null;
  }

  return createHostedRuntimeWakeCandidate(
    wakeAt,
    wakeReason ?? HOSTED_ASSISTANT_WAKE_REASON,
  );
}

function createFutureExistingHostedAssistantWorkspaceWakeCandidate(
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput,
): HostedRuntimeWakeCandidate | null {
  const candidate = createExistingHostedAssistantWorkspaceWakeCandidate(phaseInput);
  return createHostedRuntimeWakeCandidate(
    normalizeHostedFutureWakeAt(
      candidate?.at ?? null,
      resolveHostedAssistantPhaseNowMs(phaseInput),
    ),
    candidate?.reason ?? HOSTED_ASSISTANT_WAKE_REASON,
  );
}

function withHostedAssistantCronWakeCandidate(input: {
  assistantCronWake: HostedRuntimeWakeCandidate | null;
  result: HostedWorkspaceRunnerAssistantPhaseResult;
}): HostedWorkspaceRunnerAssistantPhaseResult {
  return withHostedRuntimeWakeCandidate({
    result: input.result,
    wake: input.assistantCronWake,
  });
}

function withHostedRuntimeWakeCandidate(input: {
  result: HostedWorkspaceRunnerAssistantPhaseResult;
  wake: HostedRuntimeWakeCandidate | null;
}): HostedWorkspaceRunnerAssistantPhaseResult {
  const currentWake = Object.hasOwn(input.result, "nextWakeAt")
    || Object.hasOwn(input.result, "nextWakeReason")
    ? createHostedRuntimeWakeCandidate(
        input.result.nextWakeAt ?? null,
        input.result.nextWakeReason ?? "assistant",
      )
    : null;
  const nextWake = selectHostedRuntimeWakeCandidate([
    currentWake,
    input.wake,
  ]);
  if (!nextWake.at && !currentWake?.at) {
    return input.result;
  }

  const selectedExistingWake =
    currentWake?.at === nextWake.at
    && currentWake.reason === nextWake.reason
    && Object.hasOwn(input.result, "nextWakeReason");
  const nextWakeReason = selectedExistingWake
    ? input.result.nextWakeReason ?? "assistant"
    : shouldExposeHostedAssistantPhaseNextWakeReason(nextWake.reason)
      ? nextWake.reason
      : null;
  const result = { ...input.result };
  delete result.nextWakeAt;
  delete result.nextWakeReason;
  const nextResult: HostedWorkspaceRunnerAssistantPhaseResult = {
    ...result,
    ...(nextWake.at ? { nextWakeAt: nextWake.at } : {}),
    ...(nextWakeReason
      ? { nextWakeReason }
      : {}),
  };
  return nextResult;
}

async function resolveHostedBackgroundMaintenanceWakeCandidate(input: {
  assistantCronWake?: HostedRuntimeWakeCandidate | null;
  deviceActivityAutomation?: HostedDeviceActivityAutomationScheduleResult | null;
  deviceSyncFollowUpWake?: HostedRuntimeWakeCandidate | null;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  pendingAssistantInputWakeAt?: string | null;
  systemMailboxWake?: HostedRuntimeWakeCandidate | null;
  systemMailboxWakeAt?: string | null;
}): Promise<HostedRuntimeWakeCandidate> {
  const outboxWakeAt = await resolveHostedAssistantOutboxNextWakeAt({
    vaultRoot: input.input.restored.vaultRoot,
  });
  const providerCleanupWakeAt = await resolveHostedProviderCleanupScheduledWakeAt({
    nowMs: resolveHostedAssistantPhaseNowMs(input.input),
    vaultRoot: input.input.restored.vaultRoot,
  });
  const systemMailboxWake = Object.hasOwn(input, "systemMailboxWake")
    ? input.systemMailboxWake ?? null
    : Object.hasOwn(input, "systemMailboxWakeAt")
      ? createHostedRuntimeWakeCandidate(input.systemMailboxWakeAt ?? null, "assistant")
      : await resolveHostedSystemMailboxNextWakeCandidate({
          vaultRoot: input.input.restored.vaultRoot,
        });

  return selectHostedRuntimeWakeCandidate([
    input.deviceSyncFollowUpWake,
    createHostedRuntimeWakeCandidate(
      outboxWakeAt,
      HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
    ),
    systemMailboxWake,
    createHostedRuntimeWakeCandidate(input.pendingAssistantInputWakeAt ?? null, "assistant"),
    createHostedDeviceActivityAutomationWakeCandidate(input.deviceActivityAutomation ?? null),
    input.assistantCronWake,
    createHostedRuntimeWakeCandidate(providerCleanupWakeAt, "assistant"),
  ]);
}

function shouldPreflightHostedAssistantCronWakeBeforeSystemMailbox(
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  const wakeAt = phaseInput.workspace?.nextWakeAt ?? null;
  if (!wakeAt) {
    return false;
  }
  const wakeReason = phaseInput.workspace?.nextWakeReason ?? null;
  if (wakeReason !== null && wakeReason !== HOSTED_ASSISTANT_WAKE_REASON) {
    return false;
  }

  const wakeTimeMs = Date.parse(wakeAt);
  return Number.isFinite(wakeTimeMs)
    && wakeTimeMs <= resolveHostedAssistantPhaseNowMs(phaseInput);
}

function systemMailboxPreparationRanDeviceSync(
  systemMailboxPreparation: HostedSystemMailboxPreparation,
): boolean {
  return "item" in systemMailboxPreparation
    && systemMailboxPreparation.item.routeAction === "run-device-sync-wake";
}

function shouldRunIdleDeviceSyncMaintenance(input: {
  pendingAssistantInputBlocksMaintenance: boolean;
  pendingAssistantInputWakeAt: string | null;
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput;
  shouldYieldAfterSystemMailboxPreparation: boolean;
  systemMailboxPreparation: HostedSystemMailboxPreparation | null;
}): boolean {
  if (
    input.pendingAssistantInputWakeAt
    && input.pendingAssistantInputBlocksMaintenance
  ) {
    return false;
  }
  if (input.shouldYieldAfterSystemMailboxPreparation) {
    return false;
  }
  if (!hasHostedDeviceSyncRuntimeConfigured(input.phaseInput)) {
    return false;
  }

  const preparation = input.systemMailboxPreparation;
  if (preparation?.status === "retryable_failed") {
    return false;
  }

  if (
    preparation
    && "item" in preparation
    && preparation.item.routeAction === "run-device-sync-wake"
  ) {
    return false;
  }

  return isDueHostedDeviceSyncReconcileAlarm(input.phaseInput);
}

async function runIdleDeviceSyncWakeLaneBestEffort(input: {
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput;
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>;
}): Promise<HostedDeviceSyncWakeMetrics> {
  try {
    const {
      runHostedDeviceSyncWakeLane,
    } = await loadHostedDeviceSyncMaintenanceModule();
    return await runHostedDeviceSyncWakeLane({
      deviceSyncPort: input.phaseInput.runtime.platform.deviceSyncPort ?? null,
      platformEnv: input.phaseInput.runtime.platformEnv,
      runtimeLogPlatform: input.phaseInput.runtime.platform,
      resolvedConfig: input.phaseInput.runtime.resolvedConfig,
      ...(input.phaseInput.shouldYieldBackgroundMaintenance
        ? { shouldYieldDeviceSync: input.phaseInput.shouldYieldBackgroundMaintenance }
        : {}),
      signal: input.phaseInput.signal ?? null,
      skipDirtyPendingFetch: input.phaseInput.suppressDirtyPendingFetch ?? false,
      stagedDirtyAcks: input.phaseInput.stagedDirtyAcks ?? null,
      timeoutMs: input.phaseInput.runtime.commitTimeoutMs,
      vaultRoot: input.phaseInput.restored.vaultRoot,
      wake: input.wake,
    });
  } catch (error) {
    const retryAt = new Date(
      resolveHostedAssistantPhaseNowMs(input.phaseInput)
        + HOSTED_SKIPPED_DEVICE_SYNC_RETRY_DELAY_MS,
    ).toISOString();
    await writeHostedIdleDeviceSyncFailureRuntimeLog({
      error,
      input: input.phaseInput,
      retryAt,
    });
    return {
      deviceSyncProcessed: 0,
      deviceSyncSkipped: true,
      nextWakeAt: retryAt,
      nextWakeReason: HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
      parserProcessed: 0,
      postCheckpointRecord: null,
    };
  }
}

async function scheduleDeviceActivityAutomationsAfterDeviceSyncBestEffort(input: {
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput;
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>;
}): Promise<HostedDeviceActivityAutomationScheduleResult> {
  try {
    return await scheduleDeviceActivityTriggeredAutomations({
      now: () => new Date(resolveHostedAssistantPhaseNowMs(input.phaseInput)).toISOString(),
      signal: input.phaseInput.signal ?? undefined,
      vault: input.phaseInput.restored.vaultRoot,
    });
  } catch (error) {
    await writeHostedDeviceActivityAutomationScheduleFailureRuntimeLog({
      error,
      input: input.phaseInput,
      wake: input.wake,
    });
    return emptyHostedDeviceActivityAutomationScheduleResult();
  }
}

async function writeHostedIdleDeviceSyncFailureRuntimeLog(input: {
  error: unknown;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  retryAt: string;
}): Promise<void> {
  const failure = buildHostedRuntimeFailureDiagnostics(
    input.error,
    "Hosted idle device-sync maintenance failed.",
  );
  const moduleLoadErrorCode = isHostedDeviceSyncMaintenanceModuleLoadError(input.error)
    ? input.error.code
    : null;
  await writeHostedRuntimeLogBestEffort({
    entry: {
      component: "device-sync",
      errorCode: moduleLoadErrorCode
        ? toHostedRuntimeLogCode(moduleLoadErrorCode)
        : failure.errorCode,
      eventCode: moduleLoadErrorCode
        ? "device-sync.module_load_failed"
        : "device-sync.maintenance_failed",
      level: "warn",
      phase: "idle",
      redactedJson: {
        ...failure.redactedJson,
        errorMessagePresent: input.error instanceof Error
          ? input.error.message.length > 0
          : input.error !== null && input.error !== undefined,
        failureEventOrigin: "idle_maintenance" satisfies DeviceSyncJobFailureEventOrigin,
        idleMaintenanceFailed: true,
        retryAt: input.retryAt,
      },
    },
    platform: input.input.runtime.platform,
  });
}

async function writeHostedDeviceActivityAutomationScheduleFailureRuntimeLog(input: {
  error: unknown;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>;
}): Promise<void> {
  const failure = buildHostedRuntimeFailureDiagnostics(
    input.error,
    "Hosted device activity automation scheduling failed.",
  );
  await writeHostedRuntimeLogBestEffort({
    entry: {
      component: "runtime",
      errorCode: failure.errorCode,
      eventCode: "assistant.device_activity_automation_failed",
      level: "warn",
      phase: "idle",
      redactedJson: {
        deviceActivityAutomationScheduleFailed: true,
        ...failure.redactedJson,
        errorMessagePresent: input.error instanceof Error
          ? input.error.message.length > 0
          : input.error !== null && input.error !== undefined,
        failureEventOrigin: "device_activity_automation" satisfies DeviceSyncJobFailureEventOrigin,
        wakeKind: input.wake.kind,
      },
    },
    platform: input.input.runtime.platform,
  });
}

function buildIdleDeviceSyncOnlyAssistantPhaseResult(input: {
  assistantCronWake: HostedRuntimeWakeCandidate | null;
  backgroundWake: HostedRuntimeWakeCandidate | null;
  deviceActivityAutomation: HostedDeviceActivityAutomationScheduleResult | null;
  dirtyDeviceSyncMetrics: HostedDeviceSyncWakeMetrics;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  pendingAssistantInputWakeAt: string | null;
}): HostedWorkspaceRunnerAssistantPhaseResult {
  const dirtyDeviceSyncWake = selectHostedRuntimeWakeCandidate([
    createHostedRuntimeWakeCandidate(
      input.dirtyDeviceSyncMetrics.nextWakeAt,
      input.dirtyDeviceSyncMetrics.nextWakeReason ?? HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
    ),
    createHostedRuntimeWakeCandidate(
      input.dirtyDeviceSyncMetrics.postCheckpointRecord?.nextWakeAt ?? null,
      HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
    ),
    createHostedDeviceActivityAutomationWakeCandidate(input.deviceActivityAutomation),
    input.assistantCronWake,
    input.backgroundWake,
    createHostedRuntimeWakeCandidate(
      input.pendingAssistantInputWakeAt,
      HOSTED_ASSISTANT_WAKE_REASON,
    ),
  ]);
  const nextWakeAt = dirtyDeviceSyncWake.at;
  const dirtyPostCheckpoint = input.dirtyDeviceSyncMetrics.postCheckpointRecord
    ? deferHostedDeviceSyncDirtyPostCheckpointRecord({
        record: input.dirtyDeviceSyncMetrics.postCheckpointRecord,
        runtime: input.input.runtime,
      })
    : null;
  return {
    ...(dirtyPostCheckpoint
      ? {
          afterCheckpoint: async () => {
            assertHostedAssistantPhaseLiveness(input.input.signal);
            return {
              afterDurableCheckpoint: dirtyPostCheckpoint.afterDurableCheckpoint,
              checkpointReason: "assistant_runtime_commit",
              nextWakeAt,
              ...(shouldExposeHostedAssistantPhaseNextWakeReason(dirtyDeviceSyncWake.reason)
                ? { nextWakeReason: dirtyDeviceSyncWake.reason }
                : {}),
              redactedStatus: dirtyPostCheckpoint.redactedStatus,
            };
          },
        }
      : {}),
    checkpointReason: "assistant_runtime_commit",
    nextWakeAt,
    ...(dirtyDeviceSyncWake.reason ? { nextWakeReason: dirtyDeviceSyncWake.reason } : {}),
    progressed: true,
    redactedStatus: buildHostedWorkspaceAssistantPhaseRedactedStatus({
      deliveryEffectCount: 0,
      nextWakeAt,
      outboxTerminalizedSendingCount: 0,
      progressed: true,
      systemMailboxPrepared: 0,
      systemMailboxRetryableFailed: 0,
    }),
    ...withHostedDeviceSyncStagedDirtyAcks(input.dirtyDeviceSyncMetrics.stagedDirtyAcks),
  };
}

async function runBackgroundMaintenanceAfterDeferredPendingAssistantInput(input: {
  assistantMetrics: HostedAssistantMetrics;
  assistantNextWakeAt: string | null;
  executionContext: AssistantExecutionContext;
  foregroundAssistantPass: boolean;
  hasFreshConversationInput: boolean;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  systemMailboxMaintenance: Awaited<ReturnType<typeof runSystemMailboxMaintenancePhase>>;
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>;
}): Promise<Awaited<ReturnType<typeof runSystemMailboxMaintenancePhase>> | null> {
  if (!shouldRunBackgroundMaintenanceAfterDeferredPendingAssistantInput(input)) {
    return null;
  }

  const pendingAssistantInputWakeAt = resolveDeferredPendingAssistantInputWakeAt(input);
  const maintenance = await runSystemMailboxMaintenancePhase({
    executionContext: input.executionContext,
    hasFreshConversationInput: input.hasFreshConversationInput,
    input: input.input,
    pendingAssistantInputBlocksMaintenance: false,
    pendingAssistantInputWakeAt,
    wake: input.wake,
  });
  return withDeferredPendingAssistantInputWake({
    maintenance,
    pendingAssistantInputWakeAt,
  });
}

async function runShadowedDeviceSyncAfterNoProgressAssistantWake(input: {
  assistantMetrics: HostedAssistantMetrics;
  executionContext: AssistantExecutionContext;
  foregroundAssistantPass: boolean;
  hasFreshConversationInput: boolean;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  systemMailboxMaintenance: Awaited<ReturnType<typeof runSystemMailboxMaintenancePhase>>;
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>;
}): Promise<Awaited<ReturnType<typeof runSystemMailboxMaintenancePhase>> | null> {
  if (!shouldRunShadowedDeviceSyncAfterNoProgressAssistantWake(input)) {
    return null;
  }

  const maintenance = await runSystemMailboxMaintenancePhase({
    backgroundRouteActions: HOSTED_SHADOWED_DEVICE_SYNC_ROUTE_ACTIONS,
    backgroundWakeKinds: HOSTED_SHADOWED_DEVICE_SYNC_WAKE_KINDS,
    executionContext: input.executionContext,
    hasFreshConversationInput: false,
    input: input.input,
    pendingAssistantInputBlocksMaintenance: false,
    pendingAssistantInputWakeAt: null,
    wake: input.wake,
  });
  return maintenance.result ? maintenance : null;
}

function shouldRunShadowedDeviceSyncAfterNoProgressAssistantWake(input: {
  assistantMetrics: HostedAssistantMetrics;
  foregroundAssistantPass: boolean;
  hasFreshConversationInput: boolean;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  systemMailboxMaintenance: Awaited<ReturnType<typeof runSystemMailboxMaintenancePhase>>;
}): boolean {
  if (
    input.hasFreshConversationInput
    || input.foregroundAssistantPass
    || input.systemMailboxMaintenance.pendingAssistantInputWakeAt !== null
    || input.systemMailboxMaintenance.result !== null
    || input.systemMailboxMaintenance.deviceSyncMaintenanceRan
    || input.input.shouldYieldBackgroundMaintenance?.() === true
    || !isDueHostedLegacyDeviceSyncRecoveryAlarm(input.input)
  ) {
    return false;
  }

  return (
    input.assistantMetrics.activeTurnInputIngested !== true
    && input.assistantMetrics.assistantAutomationProgressed !== true
    && (input.assistantMetrics.assistantAutomationCurrentTurnDeliveryIntentIds?.length ?? 0)
      === 0
  );
}

function withPostForegroundMemberMaintenanceAfterCheckpoint(input: {
  executionContext: AssistantExecutionContext;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  result: HostedWorkspaceRunnerAssistantPhaseResult;
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>;
}): HostedWorkspaceRunnerAssistantPhaseResult {
  if (
    input.result.progressed !== true
    || input.result.foregroundReplyFailed !== 0
  ) {
    return input.result;
  }

  return {
    ...input.result,
    afterCheckpointKeepsForegroundImportLoop: true,
    afterCheckpoint: composeHostedAssistantPhaseAfterCheckpoint({
      callbacks: [
        input.result.afterCheckpoint,
        async () => {
          const maintenance = await runSystemMailboxMaintenancePhase({
            exclusiveRouteActions:
              HOSTED_POST_FOREGROUND_MEMBER_MAINTENANCE_ROUTE_ACTIONS,
            exclusiveWakeKinds:
              HOSTED_POST_FOREGROUND_MEMBER_MAINTENANCE_WAKE_KINDS,
            executionContext: input.executionContext,
            hasFreshConversationInput: false,
            input: input.input,
            pendingAssistantInputBlocksMaintenance: false,
            pendingAssistantInputWakeAt: null,
            wake: input.wake,
          });
          return deferPostForegroundMemberMaintenanceResult(maintenance.result);
        },
      ],
    }),
  };
}

function deferPostForegroundMemberMaintenanceResult(
  result: HostedWorkspaceRunnerAssistantPhaseResult | null,
): HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null {
  if (!result || result.progressed !== true) {
    return null;
  }

  const recordAfterCheckpoint = result.afterCheckpoint ?? null;
  return {
    ...(recordAfterCheckpoint
      ? {
          afterDurableCheckpoint: async () => {
            const recorded = await recordAfterCheckpoint();
            if (!recorded) {
              return null;
            }
            return {
              nextWakeAt: recorded.nextWakeAt ?? null,
              nextWakeReason: recorded.nextWakeReason ?? "assistant",
              requiresFollowUpCheckpoint: true,
            };
          },
        }
      : {}),
    checkpointReason: result.checkpointReason,
    ...(Object.hasOwn(result, "nextWakeAt")
      ? { nextWakeAt: result.nextWakeAt ?? null }
      : {}),
    ...(result.nextWakeReason ? { nextWakeReason: result.nextWakeReason } : {}),
    ...(result.redactedStatus ? { redactedStatus: result.redactedStatus } : {}),
  };
}

function withDeferredPendingAssistantInputWake(input: {
  maintenance: Awaited<ReturnType<typeof runSystemMailboxMaintenancePhase>>;
  pendingAssistantInputWakeAt: string | null;
}): Awaited<ReturnType<typeof runSystemMailboxMaintenancePhase>> {
  const pendingWakeResult = buildDeferredPendingAssistantInputWakeResult({
    pendingAssistantInputWakeAt: input.pendingAssistantInputWakeAt,
  });
  if (!pendingWakeResult) {
    return input.maintenance;
  }

  return {
    ...input.maintenance,
    result: mergeHostedAssistantPhaseResults(
      input.maintenance.result,
      pendingWakeResult,
    ),
  };
}

function buildDeferredPendingAssistantInputWakeResult(input: {
  pendingAssistantInputWakeAt: string | null;
}): HostedWorkspaceRunnerAssistantPhaseResult | null {
  if (!input.pendingAssistantInputWakeAt) {
    return null;
  }

  return {
    nextWakeAt: input.pendingAssistantInputWakeAt,
    progressed: false,
  };
}

async function resolvePreAutomationLaneAssistantWakeAt(
  input: {
    hasAssistantInputAtPassStart: boolean;
    input: HostedWorkspaceRuntimeAssistantPhaseInput;
    pendingAssistantInputWakeAt?: string | null;
  },
): Promise<string | null> {
  if (input.hasAssistantInputAtPassStart) {
    return null;
  }

  if (input.input.shouldYieldBackgroundMaintenance?.() === true) {
    return new Date(resolveHostedAssistantPhaseNowMs(input.input)).toISOString();
  }

  if (input.pendingAssistantInputWakeAt) {
    return input.pendingAssistantInputWakeAt;
  }

  return await resolvePendingAssistantInputWakeAt(input.input);
}

function buildPreAutomationLaneSkippedAssistantWakeResult(input: {
  wakeAt: string;
}): HostedWorkspaceRunnerAssistantPhaseResult {
  return {
    nextWakeAt: input.wakeAt,
    nextWakeReason: "assistant",
    progressed: false,
  };
}

async function runPrePlanningSystemMailboxPhase(input: {
  allowedRouteActions: readonly HostedSystemMailboxRouteAction[];
  executionContext: AssistantExecutionContext;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): Promise<{
  continueAssistantLane: boolean;
  result: HostedWorkspaceRunnerAssistantPhaseResult | null;
}> {
  let result: HostedWorkspaceRunnerAssistantPhaseResult | null = null;
  let processed = 0;
  const maxItems = HOSTED_MEMBER_PREFERENCE_PRE_PLANNING_MAX_ITEMS;

  for (let itemIndex = 0; itemIndex < maxItems; itemIndex += 1) {
    assertHostedAssistantPhaseLiveness(input.input.signal);
    const now = new Date(resolveHostedAssistantPhaseNowMs(input.input)).toISOString();
    const pendingWake = await resolveHostedSystemMailboxNextWakeCandidate({
      allowedRouteActions: input.allowedRouteActions,
      now: () => now,
      vaultRoot: input.input.restored.vaultRoot,
    });
    if (!pendingWake.at) {
      return {
        continueAssistantLane: true,
        result,
      };
    }
    if (!hostedAssistantPhaseWakeIsDueAt(pendingWake.at, now)) {
      return {
        continueAssistantLane: true,
        result: mergeHostedAssistantPhaseResults(
          result,
          buildPrePlanningMemberPreferencesMailboxPendingResult({
            nextWakeAt: pendingWake.at,
            processed,
            redactedStatus: {
              hostedMemberPreferencesPrePlanningPending: 1,
              hostedMemberPreferencesPrePlanningProcessed: processed,
            },
          }),
        ),
      };
    }

    const preparation = await prepareHostedSystemMailboxItemForCheckpoint({
      allowedRouteActions: input.allowedRouteActions,
      executionContext: input.executionContext,
      now: () => now,
      operatorHomeRoot: input.input.restored.operatorHomeRoot,
      runtime: input.input.runtime,
      runtimeEnv: input.input.runtimeEnv,
      vaultRoot: input.input.restored.vaultRoot,
    });
    if (!preparation) {
      return {
        continueAssistantLane: true,
        result,
      };
    }

    if (preparation.status === "retryable_failed") {
      return {
        continueAssistantLane: true,
        result: mergeHostedAssistantPhaseResults(
          result,
          buildPrePlanningMemberPreferencesMailboxRetryResult({
            nextWakeAt: preparation.nextWakeAt,
            processed,
            preparation,
          }),
        ),
      };
    }

    processed += preparation.status === "processed" ? 1 : 0;
    result = mergeHostedAssistantPhaseResults(
      result,
      buildPrePlanningMemberPreferencesMailboxProcessedResult({
        input: input.input,
        preparation,
        processed,
      }),
    );
  }

  const now = new Date(resolveHostedAssistantPhaseNowMs(input.input)).toISOString();
  const pendingWake = await resolveHostedSystemMailboxNextWakeCandidate({
    allowedRouteActions: input.allowedRouteActions,
    now: () => now,
    vaultRoot: input.input.restored.vaultRoot,
  });
  if (!pendingWake.at) {
    return {
      continueAssistantLane: true,
      result,
    };
  }

  return {
    continueAssistantLane: !hostedAssistantPhaseWakeIsDueAt(pendingWake.at, now),
    result: mergeHostedAssistantPhaseResults(
      result,
      buildPrePlanningMemberPreferencesMailboxPendingResult({
        nextWakeAt: pendingWake.at,
        processed,
        redactedStatus: {
          hostedMemberPreferencesPrePlanningPageLimit: maxItems,
          hostedMemberPreferencesPrePlanningPending: 1,
          hostedMemberPreferencesPrePlanningProcessed: processed,
        },
      }),
    ),
  };
}

async function runRequiredGroupRoomModelInitializationPhase(input: {
  executionContext: AssistantExecutionContext;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): Promise<{
  continueAssistantLane: boolean;
  result: HostedWorkspaceRunnerAssistantPhaseResult | null;
}> {
  const now = new Date(resolveHostedAssistantPhaseNowMs(input.input)).toISOString();
  const pendingWake = await resolveHostedSystemMailboxNextWakeCandidate({
    allowedRouteActions: HOSTED_GROUP_ROOM_MODEL_PRE_PLANNING_ROUTE_ACTIONS,
    now: () => now,
    vaultRoot: input.input.restored.vaultRoot,
  });
  if (!pendingWake.at) {
    return {
      continueAssistantLane: true,
      result: null,
    };
  }
  if (!hostedAssistantPhaseWakeIsDueAt(pendingWake.at, now)) {
    return {
      continueAssistantLane: false,
      result: {
        nextWakeAt: pendingWake.at,
        nextWakeReason: "assistant",
        progressed: false,
        redactedStatus: {
          hostedGroupRoomModelInitializationPending: 1,
        },
      },
    };
  }

  const preparation = await prepareHostedSystemMailboxItemForCheckpoint({
    allowedRouteActions: HOSTED_GROUP_ROOM_MODEL_PRE_PLANNING_ROUTE_ACTIONS,
    executionContext: input.executionContext,
    now: () => now,
    operatorHomeRoot: input.input.restored.operatorHomeRoot,
    runtime: input.input.runtime,
    runtimeEnv: input.input.runtimeEnv,
    vaultRoot: input.input.restored.vaultRoot,
  });
  if (!preparation) {
    const currentPendingWake = await resolveHostedSystemMailboxNextWakeCandidate({
      allowedRouteActions: HOSTED_GROUP_ROOM_MODEL_PRE_PLANNING_ROUTE_ACTIONS,
      now: () => now,
      vaultRoot: input.input.restored.vaultRoot,
    });
    if (currentPendingWake.at) {
      return {
        continueAssistantLane: false,
        result: {
          nextWakeAt: currentPendingWake.at,
          nextWakeReason: "assistant",
          progressed: false,
          redactedStatus: {
            hostedGroupRoomModelInitializationPending: 1,
          },
        },
      };
    }
    return {
      continueAssistantLane: true,
      result: null,
    };
  }
  if (preparation.status === "retryable_failed") {
    return {
      continueAssistantLane: false,
      result: {
        checkpointReason: "system_mailbox_receipt",
        nextWakeAt: preparation.nextWakeAt,
        nextWakeReason: "assistant",
        progressed: true,
        redactedStatus: {
          hostedGroupRoomModelInitializationErrorCode: preparation.errorCode,
          hostedGroupRoomModelInitializationRetryableFailed: 1,
        },
      },
    };
  }

  return {
    continueAssistantLane: true,
    result: {
      checkpointReason: "system_mailbox_receipt",
      progressed: true,
      redactedStatus: {
        hostedGroupRoomModelInitializationProcessed: 1,
      },
    },
  };
}

function buildPrePlanningMemberPreferencesMailboxProcessedResult(input: {
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  preparation: Extract<HostedSystemMailboxPreparation, { item: HostedSystemMailboxPendingItem }>;
  processed: number;
}): HostedWorkspaceRunnerAssistantPhaseResult {
  const afterCheckpoint = input.preparation.item.postCheckpointRecord
    ? async (): Promise<HostedWorkspaceRunnerAssistantPhasePostCheckpoint> => {
      const record = await recordHostedSystemMailboxItemAfterCheckpoint({
        item: input.preparation.item,
        operatorHomeRoot: input.input.restored.operatorHomeRoot,
        runtime: input.input.runtime,
        vaultRoot: input.input.restored.vaultRoot,
      });
      return {
        checkpointReason: "system_mailbox_receipt",
        nextWakeAt: record.nextWakeAt,
        ...(record.nextWakeReason ? { nextWakeReason: record.nextWakeReason } : {}),
        redactedStatus: {
          hostedMemberPreferencesPrePlanningRecordFailed: record.failed,
          hostedMemberPreferencesPrePlanningRecorded: record.recorded,
        },
      };
    }
    : undefined;

  return {
    ...(afterCheckpoint ? { afterCheckpoint } : {}),
    checkpointReason: "system_mailbox_receipt",
    progressed: true,
    redactedStatus: {
      hostedMemberPreferencesPrePlanningProcessed: input.processed,
    },
  };
}

function buildPrePlanningMemberPreferencesMailboxRetryResult(input: {
  nextWakeAt: string;
  preparation: Extract<HostedSystemMailboxPreparation, { status: "retryable_failed" }>;
  processed: number;
}): HostedWorkspaceRunnerAssistantPhaseResult {
  return {
    checkpointReason: "system_mailbox_receipt",
    nextWakeAt: input.nextWakeAt,
    nextWakeReason: "assistant",
    progressed: true,
    redactedStatus: {
      hostedMemberPreferencesPrePlanningErrorCode: input.preparation.errorCode,
      hostedMemberPreferencesPrePlanningProcessed: input.processed,
      hostedMemberPreferencesPrePlanningRetryableFailed: 1,
    },
  };
}

function buildPrePlanningMemberPreferencesMailboxPendingResult(input: {
  nextWakeAt: string;
  processed: number;
  redactedStatus: HostedRuntimeRedactedObject;
}): HostedWorkspaceRunnerAssistantPhaseResult {
  return {
    nextWakeAt: input.nextWakeAt,
    nextWakeReason: "assistant",
    progressed: false,
    redactedStatus: input.redactedStatus,
  };
}

function hostedAssistantPhaseWakeIsDueAt(wakeAt: string, now: string): boolean {
  const wakeMs = Date.parse(wakeAt);
  const nowMs = Date.parse(now);
  return !Number.isFinite(wakeMs) || !Number.isFinite(nowMs) || wakeMs <= nowMs;
}

function shouldRunBackgroundMaintenanceAfterDeferredPendingAssistantInput(input: {
  assistantMetrics: HostedAssistantMetrics;
  assistantNextWakeAt: string | null;
  foregroundAssistantPass: boolean;
  hasFreshConversationInput: boolean;
  systemMailboxMaintenance: Awaited<ReturnType<typeof runSystemMailboxMaintenancePhase>>;
}): boolean {
  if (
    input.hasFreshConversationInput
    || input.foregroundAssistantPass
    || !input.systemMailboxMaintenance.pendingAssistantInputWakeAt
  ) {
    return false;
  }

  if (input.assistantNextWakeAt !== null) {
    return true;
  }

  return input.assistantMetrics.assistantAutomationProgressed !== true;
}

function resolveDeferredPendingAssistantInputWakeAt(input: {
  assistantMetrics: HostedAssistantMetrics;
  assistantNextWakeAt: string | null;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): string | null {
  if (input.assistantNextWakeAt !== null) {
    return input.assistantNextWakeAt;
  }

  if (input.assistantMetrics.assistantAutomationProgressed === true) {
    return null;
  }

  return new Date(
    resolveHostedAssistantPhaseNowMs(input.input)
      + HOSTED_DEFERRED_PENDING_ASSISTANT_INPUT_RETRY_DELAY_MS,
  ).toISOString();
}

async function runSystemMailboxMaintenancePhase(input: {
  backgroundRouteActions?: readonly HostedSystemMailboxRouteAction[];
  backgroundWakeKinds?: readonly HostedExecutionSystemWake["kind"][];
  exclusiveRouteActions?: readonly HostedSystemMailboxRouteAction[];
  exclusiveWakeKinds?: readonly HostedExecutionSystemWake["kind"][];
  executionContext: AssistantExecutionContext;
  hasFreshConversationInput: boolean;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  pendingAssistantInputBlocksMaintenance?: boolean;
  pendingAssistantInputWakeAt?: string | null;
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>;
}): Promise<{
  backgroundMaintenanceYielded: boolean;
  continueAssistantLane: boolean;
  deviceSyncMaintenanceRan: boolean;
  initialProviderCleanupCheckpoint: HostedProviderCleanupCheckpoint | null;
  pendingAssistantInputWakeAt: string | null;
  result: HostedWorkspaceRunnerAssistantPhaseResult | null;
}> {
  const phaseInput = input.input;
  const hasPendingAssistantInputWakeOverride = Object.hasOwn(
    input,
    "pendingAssistantInputWakeAt",
  );
  let pendingAssistantInputWakeAt = hasPendingAssistantInputWakeOverride
    ? input.pendingAssistantInputWakeAt ?? null
    : await resolvePendingAssistantInputWakeAt(phaseInput, {
        inspectOnly: input.hasFreshConversationInput,
      });
  const assistantAskCompletionOccurredBefore = pendingAssistantInputWakeAt === null
    ? undefined
    : input.hasFreshConversationInput
    ? await resolveHostedOldestAssistantInputOccurredAt({
        assistantInputIds: readHostedInitialAssistantInputIds(phaseInput),
        signal: phaseInput.signal ?? null,
        vaultRoot: phaseInput.restored.vaultRoot,
      })
    : await resolveHostedOldestPendingAssistantInputAt({
        signal: phaseInput.signal ?? null,
        vaultRoot: phaseInput.restored.vaultRoot,
      });
  const hasExclusiveSelection = input.exclusiveRouteActions !== undefined
    || input.exclusiveWakeKinds !== undefined;
  const hasBackgroundSelection = input.backgroundRouteActions !== undefined
    || input.backgroundWakeKinds !== undefined;
  let foregroundCausalPreparation = hasExclusiveSelection
    ? await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions: input.exclusiveRouteActions ?? null,
        allowedWakeKinds: input.exclusiveWakeKinds ?? null,
        executionContext: input.executionContext,
        ...(phaseInput.now ? { now: phaseInput.now } : {}),
        operatorHomeRoot: phaseInput.restored.operatorHomeRoot,
        runtime: phaseInput.runtime,
        runtimeEnv: phaseInput.runtimeEnv,
        signal: phaseInput.signal ?? null,
        shouldYieldBackgroundMaintenance: null,
        vaultRoot: phaseInput.restored.vaultRoot,
      })
    : (
      pendingAssistantInputWakeAt !== null
      || phaseInput.foregroundCausalOnly === true
    )
      ? await prepareHostedSystemMailboxItemForCheckpoint({
          allowedRouteActions: phaseInput.foregroundCausalOnly === true
            ? HOSTED_PRE_CHECKPOINT_CAUSAL_ROUTE_ACTIONS
            : HOSTED_FOREGROUND_CAUSAL_ROUTE_ACTIONS,
          allowedWakeKinds: phaseInput.foregroundCausalOnly === true
            ? HOSTED_PRE_CHECKPOINT_CAUSAL_WAKE_KINDS
            : HOSTED_FOREGROUND_CAUSAL_WAKE_KINDS,
          ...(assistantAskCompletionOccurredBefore === undefined
            ? {}
            : { assistantAskCompletionOccurredBefore }),
          executionContext: input.executionContext,
          ...(phaseInput.now ? { now: phaseInput.now } : {}),
          operatorHomeRoot: phaseInput.restored.operatorHomeRoot,
          runtime: phaseInput.runtime,
          runtimeEnv: phaseInput.runtimeEnv,
          signal: phaseInput.signal ?? null,
          shouldYieldBackgroundMaintenance: null,
          vaultRoot: phaseInput.restored.vaultRoot,
        })
      : null;
  if (hasExclusiveSelection && foregroundCausalPreparation === null) {
    return {
      backgroundMaintenanceYielded: false,
      continueAssistantLane: false,
      deviceSyncMaintenanceRan: false,
      initialProviderCleanupCheckpoint: null,
      pendingAssistantInputWakeAt,
      result: null,
    };
  }
  if (
    phaseInput.foregroundCausalOnly === true
    && foregroundCausalPreparation === null
  ) {
    pendingAssistantInputWakeAt = await resolvePendingAssistantInputWakeAt(
      phaseInput,
      { inspectOnly: true },
    );
    const preCheckpointCompletionOccurredBefore =
      pendingAssistantInputWakeAt === null
        ? undefined
        : await resolveHostedOldestPendingAssistantInputAt({
            signal: phaseInput.signal ?? null,
            vaultRoot: phaseInput.restored.vaultRoot,
          });
    foregroundCausalPreparation =
      await prepareHostedSystemMailboxItemForCheckpoint({
        allowedRouteActions:
          HOSTED_PRE_CHECKPOINT_ASSISTANT_ASK_COMPLETION_ROUTE_ACTIONS,
        allowedWakeKinds:
          HOSTED_PRE_CHECKPOINT_ASSISTANT_ASK_COMPLETION_WAKE_KINDS,
        ...(preCheckpointCompletionOccurredBefore === undefined
          ? {}
          : {
              assistantAskCompletionOccurredBefore:
                preCheckpointCompletionOccurredBefore,
            }),
        executionContext: input.executionContext,
        ...(phaseInput.now ? { now: phaseInput.now } : {}),
        operatorHomeRoot: phaseInput.restored.operatorHomeRoot,
        runtime: phaseInput.runtime,
        runtimeEnv: phaseInput.runtimeEnv,
        signal: phaseInput.signal ?? null,
        shouldYieldBackgroundMaintenance: null,
        vaultRoot: phaseInput.restored.vaultRoot,
      });
  }
  if (
    phaseInput.foregroundCausalOnly === true
    && foregroundCausalPreparation === null
    && pendingAssistantInputWakeAt === null
  ) {
    foregroundCausalPreparation =
      await prepareHostedSystemMailboxItemForCheckpoint({
        allowedMailboxDedupeKeyPrefixes:
          HOSTED_PRE_CHECKPOINT_EXTERNAL_COMPLETION_DEDUPE_KEY_PREFIXES,
        allowedRouteActions:
          HOSTED_PRE_CHECKPOINT_EXTERNAL_COMPLETION_ROUTE_ACTIONS,
        allowedWakeKinds:
          HOSTED_PRE_CHECKPOINT_EXTERNAL_COMPLETION_WAKE_KINDS,
        executionContext: input.executionContext,
        ...(phaseInput.now ? { now: phaseInput.now } : {}),
        operatorHomeRoot: phaseInput.restored.operatorHomeRoot,
        runtime: phaseInput.runtime,
        runtimeEnv: phaseInput.runtimeEnv,
        signal: phaseInput.signal ?? null,
        shouldYieldBackgroundMaintenance: null,
        vaultRoot: phaseInput.restored.vaultRoot,
      });
  }
  const foregroundCausalAttempted = foregroundCausalPreparation !== null;
  if (
    phaseInput.foregroundCausalOnly === true
    && !foregroundCausalAttempted
  ) {
    return {
      backgroundMaintenanceYielded: false,
      continueAssistantLane: false,
      deviceSyncMaintenanceRan: false,
      initialProviderCleanupCheckpoint: null,
      pendingAssistantInputWakeAt,
      result: null,
    };
  }
  if (
    (
      input.hasFreshConversationInput
      || input.input.shouldYieldBackgroundMaintenance?.() === true
    )
    && !foregroundCausalAttempted
  ) {
    return {
      backgroundMaintenanceYielded: false,
      continueAssistantLane: false,
      deviceSyncMaintenanceRan: false,
      initialProviderCleanupCheckpoint: null,
      pendingAssistantInputWakeAt,
      result: null,
    };
  }

  let initialProviderCleanupCheckpoint: HostedProviderCleanupCheckpoint | null = null;
  let assistantCronWakeState: HostedAssistantCronWakeState | null = null;
  const readAssistantCronWakeState = async (): Promise<HostedAssistantCronWakeState> => {
    if (assistantCronWakeState) {
      return assistantCronWakeState;
    }
    const state = await resolveHostedAssistantCronWakeStateBestEffort(phaseInput);
    if (state.available) {
      assistantCronWakeState = state;
    }
    return state;
  };
  const invalidateAssistantCronWakeState = (): void => {
    assistantCronWakeState = null;
  };
  const pendingAssistantInputBlocksMaintenance =
    input.pendingAssistantInputBlocksMaintenance ?? true;
  if (
    pendingAssistantInputWakeAt
    && pendingAssistantInputBlocksMaintenance
    && !foregroundCausalAttempted
  ) {
    return {
      backgroundMaintenanceYielded: false,
      continueAssistantLane: false,
      deviceSyncMaintenanceRan: false,
      initialProviderCleanupCheckpoint,
      pendingAssistantInputWakeAt,
      result: null,
    };
  }

  if (
    pendingAssistantInputBlocksMaintenance
    && !foregroundCausalAttempted
    && !hasBackgroundSelection
    && shouldPreflightHostedAssistantCronWakeBeforeSystemMailbox(phaseInput)
  ) {
    const preflightAssistantCronWakeState = await readAssistantCronWakeState();
    if (preflightAssistantCronWakeState.dueNow) {
      return {
        backgroundMaintenanceYielded: false,
        continueAssistantLane: true,
        deviceSyncMaintenanceRan: false,
        initialProviderCleanupCheckpoint,
        pendingAssistantInputWakeAt: null,
        result: null,
      };
    }
  }

  const memberPreferencesPrePlanning = foregroundCausalAttempted
    || hasBackgroundSelection
    ? {
        continueAssistantLane: true,
        result: null,
      }
    : await runPrePlanningSystemMailboxPhase({
        allowedRouteActions: HOSTED_MEMBER_PREFERENCE_PRE_PLANNING_ROUTE_ACTIONS,
        executionContext: input.executionContext,
        input: phaseInput,
      });
  const mergeMemberPreferencesPrePlanningResult = (
    result: HostedWorkspaceRunnerAssistantPhaseResult | null,
  ): HostedWorkspaceRunnerAssistantPhaseResult | null =>
    mergeHostedAssistantPhaseResults(
      memberPreferencesPrePlanning.result,
      result,
    );
  if (
    memberPreferencesPrePlanning.result
    && !memberPreferencesPrePlanning.continueAssistantLane
  ) {
    return {
      backgroundMaintenanceYielded: false,
      continueAssistantLane: false,
      deviceSyncMaintenanceRan: false,
      initialProviderCleanupCheckpoint,
      pendingAssistantInputWakeAt,
      result: memberPreferencesPrePlanning.result,
    };
  }

  const systemMailboxPreparation = foregroundCausalPreparation
    ?? await prepareHostedSystemMailboxItemForCheckpoint({
      ...(input.backgroundRouteActions
        ? { allowedRouteActions: input.backgroundRouteActions }
        : {}),
      ...(input.backgroundWakeKinds
        ? { allowedWakeKinds: input.backgroundWakeKinds }
        : {}),
      executionContext: input.executionContext,
      operatorHomeRoot: phaseInput.restored.operatorHomeRoot,
      runtime: phaseInput.runtime,
      runtimeEnv: phaseInput.runtimeEnv,
      signal: phaseInput.signal ?? null,
      shouldYieldBackgroundMaintenance:
        phaseInput.shouldYieldBackgroundMaintenance ?? null,
      vaultRoot: phaseInput.restored.vaultRoot,
    });
  const shouldYieldAfterSystemMailboxPreparation = !hasExclusiveSelection
    && phaseInput.shouldYieldBackgroundMaintenance?.() === true;
  const foregroundCausalPreparationSelected =
    systemMailboxPreparation !== null
    && isForegroundCausalSystemMailboxPreparation(systemMailboxPreparation);
  const backgroundMaintenanceYielded =
    shouldYieldAfterSystemMailboxPreparation
    && !foregroundCausalPreparationSelected;
  if (!hasPendingAssistantInputWakeOverride && !pendingAssistantInputWakeAt) {
    pendingAssistantInputWakeAt = await resolvePendingAssistantInputWakeAt(phaseInput);
  }
  if (!systemMailboxPreparation && hasBackgroundSelection) {
    return {
      backgroundMaintenanceYielded,
      continueAssistantLane: false,
      deviceSyncMaintenanceRan: false,
      initialProviderCleanupCheckpoint,
      pendingAssistantInputWakeAt,
      result: null,
    };
  }
  const shouldRunDirtyDeviceSyncWorkSource = shouldRunIdleDeviceSyncMaintenance({
    phaseInput,
    pendingAssistantInputBlocksMaintenance,
    pendingAssistantInputWakeAt,
    shouldYieldAfterSystemMailboxPreparation,
    systemMailboxPreparation,
  });
  const dirtyDeviceSyncMetrics = shouldRunDirtyDeviceSyncWorkSource
    && phaseInput.foregroundCausalOnly !== true
    && !foregroundCausalAttempted
    ? await runIdleDeviceSyncWakeLaneBestEffort({
        phaseInput,
        wake: input.wake,
      })
    : null;
  const dirtyDeviceActivityAutomation = dirtyDeviceSyncMetrics &&
      !dirtyDeviceSyncMetrics.deviceSyncSkipped &&
      phaseInput.shouldYieldBackgroundMaintenance?.() !== true
    ? await scheduleDeviceActivityAutomationsAfterDeviceSyncBestEffort({
      phaseInput,
      wake: input.wake,
    })
    : null;
  if (dirtyDeviceSyncMetrics && !dirtyDeviceSyncMetrics.deviceSyncSkipped) {
    invalidateAssistantCronWakeState();
  }
  if (!systemMailboxPreparation) {
    if (pendingAssistantInputWakeAt && pendingAssistantInputBlocksMaintenance) {
      return {
        backgroundMaintenanceYielded,
        continueAssistantLane: false,
        deviceSyncMaintenanceRan: false,
        initialProviderCleanupCheckpoint,
        pendingAssistantInputWakeAt,
        result: mergeMemberPreferencesPrePlanningResult(null),
      };
    }
    const queuedMessageVolumeReceipts =
      phaseInput.foregroundCausalOnly !== true
      && !backgroundMaintenanceYielded
        ? await queueHostedAssistantPendingMessageVolumeReceiptsForVault({
            effectsPort: phaseInput.runtime.platform.effectsPort,
            now: new Date(resolveHostedAssistantPhaseNowMs(phaseInput)),
            vaultRoot: phaseInput.restored.vaultRoot,
          })
        : 0;
    if (dirtyDeviceSyncMetrics) {
      const dirtyAssistantCronWakeState = await readAssistantCronWakeState();
      const assistantCronWake = resolveHostedAssistantCronWakeCandidate({
        phaseInput,
        state: dirtyAssistantCronWakeState,
      });
      const backgroundWake = await resolveHostedBackgroundMaintenanceWakeCandidate({
        assistantCronWake,
        deviceActivityAutomation: dirtyDeviceActivityAutomation,
        input: phaseInput,
        pendingAssistantInputWakeAt,
      });
      return {
        backgroundMaintenanceYielded,
        continueAssistantLane: dirtyAssistantCronWakeState.dueNow,
        deviceSyncMaintenanceRan: !dirtyDeviceSyncMetrics.deviceSyncSkipped,
        initialProviderCleanupCheckpoint,
        pendingAssistantInputWakeAt,
        result: mergeMemberPreferencesPrePlanningResult(
          buildIdleDeviceSyncOnlyAssistantPhaseResult({
            assistantCronWake,
            backgroundWake,
            deviceActivityAutomation: dirtyDeviceActivityAutomation,
            dirtyDeviceSyncMetrics,
            input: phaseInput,
            pendingAssistantInputWakeAt,
          }),
        ),
      };
    }
    const contextSnapshotRefresh =
      await runAssistantContextSnapshotIdleRefreshBestEffort({
        phaseInput,
      });
    if (contextSnapshotRefresh) {
      const contextAssistantCronWakeState = await readAssistantCronWakeState();
      const assistantCronWake = resolveHostedAssistantCronWakeCandidate({
        phaseInput,
        state: contextAssistantCronWakeState,
      });
      const backgroundWake = await resolveHostedBackgroundMaintenanceWakeCandidate({
        assistantCronWake,
        input: phaseInput,
        pendingAssistantInputWakeAt,
      });
      return {
        backgroundMaintenanceYielded,
        continueAssistantLane: false,
        deviceSyncMaintenanceRan: false,
        initialProviderCleanupCheckpoint,
        pendingAssistantInputWakeAt,
        result: mergeMemberPreferencesPrePlanningResult(
          withHostedRuntimeWakeCandidate({
            wake: backgroundWake,
            result: contextSnapshotRefresh,
          }),
        ),
      };
    }

    if (queuedMessageVolumeReceipts > 0) {
      const backgroundWake = await resolveHostedBackgroundMaintenanceWakeCandidate({
        input: phaseInput,
        pendingAssistantInputWakeAt,
      });
      return {
        backgroundMaintenanceYielded,
        continueAssistantLane: false,
        deviceSyncMaintenanceRan: false,
        initialProviderCleanupCheckpoint,
        pendingAssistantInputWakeAt,
        result: mergeMemberPreferencesPrePlanningResult({
          checkpointReason: "outbox_receipt",
          ...(backgroundWake.at ? { nextWakeAt: backgroundWake.at } : {}),
          ...(shouldExposeHostedAssistantPhaseNextWakeReason(backgroundWake.reason)
            ? { nextWakeReason: backgroundWake.reason }
            : {}),
          progressed: true,
        }),
      };
    }

    return {
      backgroundMaintenanceYielded,
      continueAssistantLane: false,
      deviceSyncMaintenanceRan: false,
      initialProviderCleanupCheckpoint,
      pendingAssistantInputWakeAt,
      result: mergeMemberPreferencesPrePlanningResult(null),
    };
  }
  const systemMailboxDeliveryEffects =
    shouldCollectSystemMailboxDeliveryEffects({
      preparation: systemMailboxPreparation,
      shouldYieldAfterSystemMailboxPreparation,
    })
      ? await collectHostedAssistantDeliverySideEffects({
        actionApprovalPort: phaseInput.runtime.platform.actionApprovalPort ?? null,
        includeBackgroundDueIntents: phaseInput.foregroundCausalOnly !== true,
        messageVolumeReceiptPort: phaseInput.runtime.platform.effectsPort,
        preferredEffectIds: resolveHostedSystemMailboxPreferredEffectIds(
          systemMailboxPreparation,
        ),
        preferredIntentIds: resolveHostedSystemMailboxPreferredIntentIds(
          systemMailboxPreparation,
        ),
        vaultRoot: phaseInput.restored.vaultRoot,
      })
      : [];
  const systemMailboxDeliveryEffectsForDispatch =
    phaseInput.foregroundCausalOnly === true
      ? systemMailboxDeliveryEffects.filter(
          (effect) => effect.payload.transportIdempotent === true,
        )
      : systemMailboxDeliveryEffects;
  const deferredSystemMailboxDeliveryWakeAt =
    systemMailboxDeliveryEffectsForDispatch.length
      < systemMailboxDeliveryEffects.length
      ? await resolveHostedAssistantOutboxNextWakeAt({
          vaultRoot: phaseInput.restored.vaultRoot,
        })
      : null;
  const foregroundCausalDeliveryOwnsThisPass =
    isForegroundCausalSystemMailboxPreparation(systemMailboxPreparation)
    && systemMailboxDeliveryEffectsForDispatch.length > 0;
  const foregroundCausalPreparationCompletedWithoutDelivery =
    isForegroundCausalSystemMailboxPreparation(systemMailboxPreparation)
    && systemMailboxDeliveryEffectsForDispatch.length === 0;
  const nonIdempotentPhoneCallResultEffectIds =
    isPhoneCallResultSystemMailboxPreparation(systemMailboxPreparation)
      ? systemMailboxDeliveryEffectsForDispatch
          .filter((effect) => effect.payload.transportIdempotent !== true)
          .map((effect) => effect.effectId)
      : [];
  let systemMailboxDeliveryPreparation: HostedAssistantDeliveryPreparation | null = null;
  if (systemMailboxDeliveryEffectsForDispatch.length > 0) {
    systemMailboxDeliveryPreparation = await prepareHostedAssistantDeliveryEffectsForDispatch({
      assistantDeliveryEffects: systemMailboxDeliveryEffectsForDispatch,
      ...(nonIdempotentPhoneCallResultEffectIds.length > 0
        ? {
            selectedNonIdempotentEffectIds:
              nonIdempotentPhoneCallResultEffectIds,
          }
        : {}),
      vaultRoot: phaseInput.restored.vaultRoot,
    });
  }
  const systemMailboxWake = systemMailboxPreparation.status === "retryable_failed"
    ? createHostedRuntimeWakeCandidate(
        systemMailboxPreparation.nextWakeAt,
        systemMailboxPreparation.nextWakeReason ?? "assistant",
      )
    : phaseInput.foregroundCausalOnly === true
      ? null
      : await resolveHostedSystemMailboxNextWakeCandidate({
          vaultRoot: phaseInput.restored.vaultRoot,
        });
  const systemMailboxWakeAt = systemMailboxWake?.at ?? null;
  const rawSystemMailboxMetricsWakeAt = "metrics" in systemMailboxPreparation
    ? systemMailboxPreparation.metrics.nextWakeAt ?? null
    : null;
  const systemMailboxMetricsWakeReason = resolveHostedSystemMailboxMetricsWakeReason({
    metricsWakeAt: rawSystemMailboxMetricsWakeAt,
    systemMailboxPreparation,
  });
  const systemMailboxMetricsWakeAt = resolveHostedSystemMailboxMetricsWakeAt({
    input: phaseInput,
    metricsWakeAt: rawSystemMailboxMetricsWakeAt,
    metricsWakeReason: systemMailboxMetricsWakeReason,
  });
  const systemMailboxDeviceSyncRan =
    systemMailboxPreparationRanDeviceSync(systemMailboxPreparation);
  if (systemMailboxDeviceSyncRan) {
    invalidateAssistantCronWakeState();
  }
  const deviceSyncMaintenanceRan =
    systemMailboxDeviceSyncRan
    || (dirtyDeviceSyncMetrics !== null && !dirtyDeviceSyncMetrics.deviceSyncSkipped);
  const cleanupPlan: HostedProviderCleanupPlan =
    phaseInput.foregroundCausalOnly === true
      ? {
          checkpoint: null,
          deferred: true,
          due: false,
          requiresCheckpoint: false,
          stateQueued: false,
        }
      : await prepareHostedProviderCleanupPlan({
          deferred:
            shouldYieldAfterSystemMailboxPreparation
            || phaseInput.shouldYieldBackgroundMaintenance?.() === true,
          idleCheckpointDelayMs: phaseInput.request.idleCheckpointDelayMs,
          nowMs: resolveHostedAssistantPhaseNowMs(phaseInput),
          shouldYield: phaseInput.shouldYieldBackgroundMaintenance ?? null,
          vaultRoot: phaseInput.restored.vaultRoot,
        });
  initialProviderCleanupCheckpoint = cleanupPlan.checkpoint;
  const deviceSyncFollowUpWake = phaseInput.foregroundCausalOnly === true
    ? null
    : await resolveHostedDeviceSyncFollowUpWake({
        deviceSyncMaintenanceRan,
        input: phaseInput,
        pendingAssistantInputWakeAt,
      });
  const systemAssistantCronWakeState = phaseInput.foregroundCausalOnly === true
    ? {
        available: true,
        dueNow: false,
        wake: null,
      }
    : await readAssistantCronWakeState();
  const systemAssistantCronWake = resolveHostedAssistantCronWakeCandidate({
    phaseInput,
    state: systemAssistantCronWakeState,
  });
  const dirtyDeviceSyncWake = dirtyDeviceSyncMetrics
    ? selectHostedRuntimeWakeCandidate([
        createHostedRuntimeWakeCandidate(
          dirtyDeviceSyncMetrics.nextWakeAt,
          HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
        ),
        createHostedRuntimeWakeCandidate(
          dirtyDeviceSyncMetrics.postCheckpointRecord?.nextWakeAt ?? null,
          HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
        ),
        createHostedDeviceActivityAutomationWakeCandidate(dirtyDeviceActivityAutomation),
      ])
    : null;
  const dirtyDeviceSyncWakeAt = dirtyDeviceSyncWake?.at ?? null;
  const backgroundWake = phaseInput.foregroundCausalOnly === true
    ? createHostedRuntimeWakeCandidate(null, null)
    : await resolveHostedBackgroundMaintenanceWakeCandidate({
        assistantCronWake: systemAssistantCronWake,
        deviceActivityAutomation: dirtyDeviceActivityAutomation,
        deviceSyncFollowUpWake,
        input: phaseInput,
        pendingAssistantInputWakeAt,
        systemMailboxWake,
      });
  const nextWake = selectHostedRuntimeWakeCandidate([
    backgroundWake,
    createHostedRuntimeWakeCandidate(
      deferredSystemMailboxDeliveryWakeAt,
      HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
    ),
    createHostedRuntimeWakeCandidate(systemMailboxMetricsWakeAt, systemMailboxMetricsWakeReason),
    dirtyDeviceSyncWake,
    phaseInput.foregroundCausalOnly === true
      ? createExistingHostedAssistantWorkspaceWakeCandidate(phaseInput)
      : null,
  ]);
  const nextWakeAt = nextWake.at;
  const shouldRecordSystemMailbox = systemMailboxPreparation.status === "processed"
    || systemMailboxPreparation.status === "recording";
  const browserVaultReplicaRefreshRequested =
    isBrowserVaultReplicaRefreshSystemMailboxPreparation(systemMailboxPreparation);
  const foregroundPrioritySystemCompletionProcessed =
    isForegroundPrioritySystemCompletionProcessed(systemMailboxPreparation);
  const shouldRunPostSystemCheckpoint = shouldRecordSystemMailbox
    || cleanupPlan.requiresCheckpoint
    || (dirtyDeviceSyncMetrics?.postCheckpointRecord ?? null) !== null;
  const clinicalOutcomeRecordPending =
    "item" in systemMailboxPreparation
    && systemMailboxPreparation.item.postCheckpointRecord?.kind
      === "clinical-records.outcome-recorded";
  const assistantAskCompletionFirstAttemptDelayed =
    wasHostedAssistantAskCompletionFirstAttemptDelayed(
      systemMailboxPreparation,
    );
  if ("metrics" in systemMailboxPreparation) {
    await writeHostedAssistantAutomationDetailRuntimeLogs({
      assistantMetrics: systemMailboxPreparation.metrics,
      input: phaseInput,
    });
  }
  await writeHostedSystemMailboxRuntimeLog({
    assistantAskCompletionFirstAttemptDelayed,
    attemptCount: systemMailboxPreparation.status === "retryable_failed"
      ? systemMailboxPreparation.attemptCount
      : systemMailboxPreparation.item.attemptCount,
    errorCode: systemMailboxPreparation.status === "retryable_failed"
      ? systemMailboxPreparation.errorCode
      : null,
    errorMessage: systemMailboxPreparation.status === "retryable_failed"
      ? systemMailboxPreparation.errorMessage
      : null,
    input: phaseInput,
    legacyUsageReferralAuthorityClassification:
      systemMailboxPreparation.status === "retryable_failed"
        ? systemMailboxPreparation.legacyUsageReferralAuthorityClassification
        : null,
    nextWakeAt,
    recorded: null,
    recordFailed: null,
    routeAction: systemMailboxPreparation.status === "retryable_failed"
      ? systemMailboxPreparation.routeAction
      : systemMailboxPreparation.item.routeAction,
    status: systemMailboxPreparation.status,
    wakeKind: systemMailboxPreparation.status === "retryable_failed"
      ? systemMailboxPreparation.wakeKind
      : systemMailboxPreparation.item.wake.kind,
  });

  return {
    backgroundMaintenanceYielded,
    continueAssistantLane: phaseInput.foregroundCausalOnly === true
      ? false
      : !foregroundCausalDeliveryOwnsThisPass
        && (
          foregroundCausalAttempted
          || foregroundCausalPreparationCompletedWithoutDelivery
          || systemAssistantCronWakeState.dueNow
          || backgroundMaintenanceYielded
          || shouldContinueAssistantLaneAfterSystemMailboxPreparation(systemMailboxPreparation)
        ),
    initialProviderCleanupCheckpoint,
    pendingAssistantInputWakeAt,
    result: mergeMemberPreferencesPrePlanningResult({
      ...(browserVaultReplicaRefreshRequested
        ? { browserVaultReplicaRefreshRequested: true }
        : {}),
      ...(foregroundPrioritySystemCompletionProcessed
        ? { foregroundPrioritySystemCompletionProcessed: true }
        : {}),
      ...(shouldRunPostSystemCheckpoint
        ? {
            ...(systemMailboxDeliveryEffectsForDispatch.length > 0
              || clinicalOutcomeRecordPending
              ? { afterCheckpointKeepsForegroundImportLoop: true }
              : {}),
            afterCheckpoint: async () => {
              assertHostedAssistantPhaseLiveness(phaseInput.signal);
              return await runSystemMailboxPostCheckpointPhase({
                dirtyDeviceSyncMetrics,
                dirtyDeviceSyncWake,
                dirtyDeviceActivityAutomation,
                assistantCronWakeState: systemAssistantCronWakeState,
                deferredSystemMailboxDeliveryWakeAt,
                input: phaseInput,
                pendingAssistantInputWakeAt,
                providerCleanupPlan: cleanupPlan,
                deviceSyncFollowUpWake,
                readAssistantCronWakeState,
                systemMailboxMetricsWakeAt,
                systemMailboxMetricsWakeReason,
                systemMailboxDeliveryPreparation,
                systemMailboxDeliveryEffects:
                  systemMailboxDeliveryEffectsForDispatch,
                systemMailboxDeliveryIsForegroundCausal:
                  foregroundCausalDeliveryOwnsThisPass,
                systemMailboxPreparation,
                systemMailboxWake,
                systemMailboxWakeAt,
                wake: input.wake,
              });
            },
          }
        : {}),
      checkpointReason: resolveHostedSystemMailboxCheckpointReason({
        shouldRecordSystemMailbox,
        systemMailboxDeliveryEffectCount:
          systemMailboxDeliveryEffectsForDispatch.length,
        systemMailboxPreparation,
      }),
      ...(nextWakeAt ? { nextWakeAt } : {}),
      ...(shouldExposeHostedAssistantPhaseNextWakeReason(nextWake.reason)
        ? { nextWakeReason: nextWake.reason }
        : {}),
      progressed: true,
      redactedStatus: {
        ...buildHostedWorkspaceAssistantPhaseRedactedStatus({
          deliveryEffectCount: systemMailboxDeliveryEffects.length,
          nextWakeAt,
          outboxTerminalizedSendingCount: 0,
          progressed: true,
          systemMailboxPrepared:
            systemMailboxPreparation.status === "retryable_failed"
              || systemMailboxPreparation.status === "preempted"
              ? 0
              : 1,
          systemMailboxRetryableFailed:
            systemMailboxPreparation.status === "retryable_failed" ? 1 : 0,
        }),
        ...(browserVaultReplicaRefreshRequested
          ? { hostedBrowserVaultReplicaRefreshRequested: true }
          : {}),
        ...(assistantAskCompletionFirstAttemptDelayed
          ? { hostedAssistantAskCompletionFirstAttemptDelayed: true }
          : {}),
      },
      ...withHostedDeviceSyncStagedDirtyAcks(
        mergeHostedDeviceSyncStagedDirtyAcks(
          dirtyDeviceSyncMetrics?.stagedDirtyAcks,
        ),
      ),
    }),
    deviceSyncMaintenanceRan,
  };
}

async function runAssistantContextSnapshotIdleRefreshBestEffort(input: {
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput;
}): Promise<HostedWorkspaceRunnerAssistantPhaseResult | null> {
  if (input.phaseInput.shouldYieldBackgroundMaintenance?.() === true) {
    return null;
  }

  const refresh = await refreshAssistantContextSnapshotBestEffort({
    now: () => new Date(resolveHostedAssistantPhaseNowMs(input.phaseInput)).toISOString(),
    shouldYield: input.phaseInput.shouldYieldBackgroundMaintenance ?? null,
    signal: input.phaseInput.signal ?? null,
    vaultRoot: input.phaseInput.restored.vaultRoot,
  });
  if (refresh.skipped) {
    return null;
  }

  const nextWakeAt = refresh.pendingDirtyDomains.length > 0
    ? new Date(resolveHostedAssistantPhaseNowMs(input.phaseInput)).toISOString()
    : null;
  return {
    checkpointReason: "assistant_runtime_commit",
    ...(nextWakeAt ? { nextWakeAt, nextWakeReason: "assistant" } : {}),
    progressed: true,
    redactedStatus: {
      ...buildHostedWorkspaceAssistantPhaseRedactedStatus({
        deliveryEffectCount: 0,
        nextWakeAt,
        outboxTerminalizedSendingCount: 0,
        progressed: true,
        systemMailboxPrepared: 0,
        systemMailboxRetryableFailed: 0,
      }),
      assistantContextSnapshotPendingDirtyDomainCount:
        refresh.pendingDirtyDomains.length,
      assistantContextSnapshotRefreshAttempted: true,
      assistantContextSnapshotRefreshed: refresh.refreshed,
    },
  };
}

async function runSystemMailboxPostCheckpointPhase(input: {
  assistantCronWakeState: HostedAssistantCronWakeState;
  deferredSystemMailboxDeliveryWakeAt: string | null;
  deviceSyncFollowUpWake: HostedRuntimeWakeCandidate | null;
  dirtyDeviceActivityAutomation: HostedDeviceActivityAutomationScheduleResult | null;
  dirtyDeviceSyncMetrics: HostedDeviceSyncWakeMetrics | null;
  dirtyDeviceSyncWake: HostedRuntimeWakeCandidate | null;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  pendingAssistantInputWakeAt: string | null;
  providerCleanupPlan: HostedProviderCleanupPlan;
  readAssistantCronWakeState: () => Promise<HostedAssistantCronWakeState>;
  systemMailboxMetricsWakeAt: string | null;
  systemMailboxMetricsWakeReason: string | null;
  systemMailboxDeliveryEffects: HostedAssistantDeliveryEffects;
  systemMailboxDeliveryIsForegroundCausal: boolean;
  systemMailboxDeliveryPreparation: HostedAssistantDeliveryPreparation | null;
  systemMailboxPreparation: NonNullable<
    Awaited<ReturnType<typeof prepareHostedSystemMailboxItemForCheckpoint>>
  >;
  systemMailboxWake: HostedRuntimeWakeCandidate | null;
  systemMailboxWakeAt: string | null;
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>;
}): Promise<HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null> {
  const foregroundCausalOnly = input.input.foregroundCausalOnly === true;
  const assistantCronWakeState = foregroundCausalOnly
    || input.assistantCronWakeState.available
    ? input.assistantCronWakeState
    : await input.readAssistantCronWakeState();
  const assistantCronWake = resolveHostedAssistantCronWakeCandidate({
    phaseInput: input.input,
    state: assistantCronWakeState,
  });

  if ("item" in input.systemMailboxPreparation) {
    const statusCallbackInput = {
      item: input.systemMailboxPreparation.item,
      operatorHomeRoot: input.input.restored.operatorHomeRoot,
      runtime: input.input.runtime,
      vaultRoot: input.input.restored.vaultRoot,
    };
    const deferredSystemMailboxRecord =
      shouldDeferHostedSystemMailboxRecordAfterDurableCheckpoint(
        input.systemMailboxPreparation.item,
      )
        ? deferHostedSystemMailboxPostCheckpointRecord({
            ...statusCallbackInput,
            followUpWakeAt: new Date(resolveHostedAssistantPhaseNowMs(input.input)).toISOString(),
          })
        : null;
    const clinicalOutcomeCancellation =
      input.systemMailboxPreparation.item.postCheckpointRecord?.kind
        === "clinical-records.outcome-recorded"
        ? createHostedBackgroundMaintenanceCancellation({
            signal: input.input.signal ?? null,
            shouldYield: input.input.shouldYieldBackgroundMaintenance ?? null,
            timeoutMs: null,
          })
        : null;
    let statusCallback: Awaited<
      ReturnType<typeof recordHostedSystemMailboxItemAfterCheckpoint>
    >;
    try {
      statusCallback = deferredSystemMailboxRecord
        ? deferredSystemMailboxRecord.statusCallback
        : await recordHostedSystemMailboxItemAfterCheckpoint({
            ...statusCallbackInput,
            ...(clinicalOutcomeCancellation?.signal
              ? { signal: clinicalOutcomeCancellation.signal }
              : {}),
          });
    } finally {
      clinicalOutcomeCancellation?.dispose();
    }
    const dirtyPostCheckpoint = input.dirtyDeviceSyncMetrics?.postCheckpointRecord
      ? deferHostedDeviceSyncDirtyPostCheckpointRecord({
          record: input.dirtyDeviceSyncMetrics.postCheckpointRecord,
          runtime: input.input.runtime,
        })
      : null;
    const afterDurableCheckpoint = composeHostedAssistantPhaseDurableCheckpointEffects(
      deferredSystemMailboxRecord?.afterDurableCheckpoint ?? null,
      dirtyPostCheckpoint?.afterDurableCheckpoint ?? null,
    );
    const dirtyPostCheckpointWakeAt = dirtyPostCheckpoint?.nextWakeAt ?? null;
    const backgroundWake = foregroundCausalOnly
      ? createHostedRuntimeWakeCandidate(null, null)
      : await resolveHostedBackgroundMaintenanceWakeCandidate({
          assistantCronWake,
          deviceActivityAutomation: input.dirtyDeviceActivityAutomation,
          deviceSyncFollowUpWake: input.deviceSyncFollowUpWake,
          input: input.input,
          pendingAssistantInputWakeAt: input.pendingAssistantInputWakeAt,
          systemMailboxWake: createHostedRuntimeWakeCandidate(
            statusCallback.nextWakeAt,
            statusCallback.nextWakeReason ?? "assistant",
          ),
        });
    const statusNextWake = selectHostedRuntimeWakeCandidate([
      createHostedRuntimeWakeCandidate(
        statusCallback.nextWakeAt,
        statusCallback.nextWakeReason ?? "assistant",
      ),
      backgroundWake,
      createHostedRuntimeWakeCandidate(
        input.deferredSystemMailboxDeliveryWakeAt,
        HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
      ),
      input.dirtyDeviceSyncWake,
      createHostedRuntimeWakeCandidate(
        dirtyPostCheckpointWakeAt,
        HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
      ),
      createHostedRuntimeWakeCandidate(
        input.systemMailboxMetricsWakeAt,
        input.systemMailboxMetricsWakeReason,
      ),
      foregroundCausalOnly
        ? createExistingHostedAssistantWorkspaceWakeCandidate(input.input)
        : null,
    ]);
    const statusNextWakeAt = statusNextWake.at;
    const statusNextWakeReason = statusNextWake.reason;
    const dirtyRedactedStatus: HostedRuntimeRedactedJson = dirtyPostCheckpoint
      ? dirtyPostCheckpoint.redactedStatus
      : {};
    const systemMailboxRecordRedactedStatus: HostedRuntimeRedactedJson =
      deferredSystemMailboxRecord?.redactedStatus ?? {};
    await writeHostedSystemMailboxRuntimeLog({
      attemptCount: input.systemMailboxPreparation.item.attemptCount,
      errorCode: statusCallback.errorCode ?? null,
      errorMessage: statusCallback.errorMessage ?? null,
      input: input.input,
      legacyUsageReferralAuthorityClassification: null,
      nextWakeAt: statusNextWakeAt,
      recorded: statusCallback.recorded,
      recordFailed: statusCallback.failed,
      routeAction: input.systemMailboxPreparation.item.routeAction,
      status: deferredSystemMailboxRecord ? "recording" : "recorded",
      wakeKind: input.systemMailboxPreparation.item.wake.kind,
    });
    if (input.systemMailboxDeliveryEffects.length > 0) {
      const preparedDispatchIntentIds = new Set(
        input.systemMailboxDeliveryPreparation?.preparedDispatches.map(
          (dispatch) => dispatch.intentId,
        ) ?? [],
      );
      const deliveryRequiresDurableCheckpoint =
        input.systemMailboxDeliveryEffects.some((effect) =>
          effect.payload.transportIdempotent !== true
          && preparedDispatchIntentIds.has(effect.effectId)
        );
      const deliveryInput = {
        assistantDeliveryEffects: input.systemMailboxDeliveryEffects,
        assistantDeliveryPreparation: input.systemMailboxDeliveryPreparation,
        baseNextWake: {
          at: statusNextWakeAt,
          reason: statusNextWakeReason,
        },
        checkpointReason: "outbox_receipt" as const,
        canConsumeWorkspaceAssistantWake: false,
        input: input.input,
        providerCleanupPlan: input.providerCleanupPlan,
        redactedStatus: {
          ...dirtyRedactedStatus,
          ...systemMailboxRecordRedactedStatus,
          hostedSystemMailboxRecordFailed: statusCallback.failed,
          hostedSystemMailboxRecorded: statusCallback.recorded,
        },
        shouldYieldBackgroundDrain: input.systemMailboxDeliveryIsForegroundCausal
          ? null
          : input.input.shouldYieldBackgroundMaintenance ?? null,
        wake: input.systemMailboxPreparation.item.wake,
      };
      if (deliveryRequiresDurableCheckpoint) {
        const deferredDelivery = deferHostedDeliveryUntilDurableCheckpoint(
          deliveryInput,
        );
        const deferredAfterDurableCheckpoint =
          composeHostedAssistantPhaseDurableCheckpointEffects(
            afterDurableCheckpoint,
            deferredDelivery,
          );
        return {
          ...(deferredAfterDurableCheckpoint
            ? { afterDurableCheckpoint: deferredAfterDurableCheckpoint }
            : {}),
          checkpointReason: "outbox_sending",
          nextWakeAt: statusNextWakeAt,
          nextWakeReason: statusNextWakeReason,
          redactedStatus: deliveryInput.redactedStatus,
        };
      }
      return await drainHostedPostCheckpointDelivery({
        afterDurableCheckpoint,
        ...deliveryInput,
      });
    }
    return {
      ...(afterDurableCheckpoint ? { afterDurableCheckpoint } : {}),
      checkpointReason: "system_mailbox_receipt",
      nextWakeAt: statusNextWakeAt,
      nextWakeReason: statusNextWakeReason,
      redactedStatus: {
        ...dirtyRedactedStatus,
        ...systemMailboxRecordRedactedStatus,
        hostedSystemMailboxRecordFailed: statusCallback.failed,
        hostedSystemMailboxRecorded: statusCallback.recorded,
      },
    };
  }

  const dirtyPostCheckpoint = input.dirtyDeviceSyncMetrics?.postCheckpointRecord
    ? deferHostedDeviceSyncDirtyPostCheckpointRecord({
        record: input.dirtyDeviceSyncMetrics.postCheckpointRecord,
        runtime: input.input.runtime,
      })
    : null;
  const dirtyPostCheckpointWakeAt = dirtyPostCheckpoint?.nextWakeAt ?? null;

  if (!dirtyPostCheckpoint) {
    return null;
  }

  const backgroundWake = await resolveHostedBackgroundMaintenanceWakeCandidate({
    assistantCronWake,
    deviceActivityAutomation: input.dirtyDeviceActivityAutomation,
    deviceSyncFollowUpWake: input.deviceSyncFollowUpWake,
    input: input.input,
    pendingAssistantInputWakeAt: input.pendingAssistantInputWakeAt,
    systemMailboxWake: input.systemMailboxWake,
  });
  const dirtyNextWake = selectHostedRuntimeWakeCandidate([
    backgroundWake,
    input.dirtyDeviceSyncWake,
    createHostedRuntimeWakeCandidate(
      dirtyPostCheckpoint.nextWakeAt,
      HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
    ),
  ]);
  const dirtyNextWakeAt = dirtyNextWake.at;
  return {
    ...(dirtyPostCheckpoint
      ? { afterDurableCheckpoint: dirtyPostCheckpoint.afterDurableCheckpoint }
      : {}),
    checkpointReason: "assistant_runtime_commit",
    nextWakeAt: dirtyNextWakeAt,
    nextWakeReason: dirtyNextWake.reason,
    redactedStatus: {
      ...dirtyPostCheckpoint.redactedStatus,
      nextWakeAt: dirtyNextWakeAt,
    },
  };
}

function deferHostedDeliveryUntilDurableCheckpoint(
  input: Parameters<typeof drainHostedPostCheckpointDelivery>[0],
): HostedWorkspaceDurableCheckpointEffect {
  return async () => {
    const postDelivery = await drainHostedPostCheckpointDelivery(input);
    return {
      nextWakeAt: postDelivery.nextWakeAt ?? null,
      nextWakeReason: postDelivery.nextWakeReason ?? null,
      redactedStatus: postDelivery.redactedStatus ?? null,
      requiresFollowUpCheckpoint: true,
    };
  };
}

function resolveHostedSystemMailboxMetricsWakeReason(input: {
  metricsWakeAt: string | null;
  systemMailboxPreparation: NonNullable<
    Awaited<ReturnType<typeof prepareHostedSystemMailboxItemForCheckpoint>>
  >;
}): string | null {
  if (!input.metricsWakeAt || !("item" in input.systemMailboxPreparation)) {
    return null;
  }

  if ("metrics" in input.systemMailboxPreparation) {
    const metricsWakeReason = input.systemMailboxPreparation.metrics.nextWakeReason ?? null;
    if (metricsWakeReason) {
      return metricsWakeReason;
    }
  }

  return input.systemMailboxPreparation.item.routeAction === "run-device-sync-wake"
    ? HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON
    : null;
}

function resolveHostedSystemMailboxMetricsWakeAt(input: {
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  metricsWakeAt: string | null;
  metricsWakeReason: string | null;
}): string | null {
  const futureWakeAt = resolveHostedAssistantAutomationNextWakeAt({
    input: input.input,
    nextWakeAt: input.metricsWakeAt,
  });
  if (futureWakeAt) {
    return futureWakeAt;
  }

  if (
    input.metricsWakeReason !== HOSTED_ASSISTANT_WAKE_REASON
  ) {
    return null;
  }

  const wakeMs = Date.parse(input.metricsWakeAt ?? "");
  if (!Number.isFinite(wakeMs)) {
    return null;
  }

  const nowMs = resolveHostedAssistantPhaseNowMs(input.input);
  return wakeMs <= nowMs ? new Date(nowMs).toISOString() : null;
}

async function collectForegroundDeliveryEffects(input: {
  actionApprovalPort: HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["actionApprovalPort"];
  linqDeliveryContexts?: readonly HostedAssistantLinqDeliveryContext[] | null;
  messageVolumeReceiptPort: HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["effectsPort"];
  preferredIntentIds: readonly string[];
  vaultRoot: string;
}): Promise<HostedPreparedAssistantDeliveryEffects> {
  const deliveryEffects = await collectHostedAssistantDeliverySideEffects({
    actionApprovalPort: input.actionApprovalPort ?? null,
    includeBackgroundDueIntents: false,
    messageVolumeReceiptPort: input.messageVolumeReceiptPort,
    preferredIntentIds: input.preferredIntentIds,
    vaultRoot: input.vaultRoot,
  });
  const preparation = await prepareHostedAssistantDeliveryEffectsForDispatch({
    assistantDeliveryEffects: deliveryEffects,
    linqDeliveryContexts: input.linqDeliveryContexts ?? null,
    vaultRoot: input.vaultRoot,
  });
  return {
    effects: deliveryEffects,
    preparation,
  };
}

async function runForegroundAssistantReplyPhase(input: {
  assistantMetrics: HostedAssistantMetrics;
  currentTurnDeliveryIntentIds: readonly string[];
  foregroundCronReconciliationWake: HostedRuntimeWakeCandidate | null;
  foregroundWorkspaceWake: HostedRuntimeWakeCandidate | null;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  providerCleanupPlan: HostedProviderCleanupPlan;
  skippedDeviceSyncWake: HostedRuntimeWakeCandidate | null;
  systemMailboxWake: HostedRuntimeWakeCandidate | null;
  systemMailboxWakeAt: string | null;
  linqDeliveryContexts: readonly HostedAssistantLinqDeliveryContext[];
  wake: ReturnType<typeof buildHostedExecutionRuntimeTimerWake>;
}): Promise<HostedWorkspaceRunnerAssistantPhaseResult> {
  const foregroundReplyFailed = input.assistantMetrics.assistantAutomationReplyFailed ?? 0;
  const preparedDeliveryEffects = await collectForegroundDeliveryEffects({
    actionApprovalPort: input.input.runtime.platform.actionApprovalPort ?? null,
    linqDeliveryContexts: input.linqDeliveryContexts,
    messageVolumeReceiptPort: input.input.runtime.platform.effectsPort,
    preferredIntentIds: input.currentTurnDeliveryIntentIds,
    vaultRoot: input.input.restored.vaultRoot,
  });
  const deliveryEffects = preparedDeliveryEffects.effects;
  const assistantNextWakeAt = resolveHostedAssistantAutomationNextWakeAt({
    input: input.input,
    nextWakeAt: input.assistantMetrics.nextWakeAt,
  });
  const assistantNextWakeReason = resolveHostedAssistantAutomationNextWakeReason({
    assistantNextWakeAt,
    assistantOutboxOnlyNextWakeAt:
      input.assistantMetrics.assistantAutomationOutboxOnlyNextWakeAt ?? null,
  });
  const selectedInputWakeAt = resolveHostedAssistantAutomationNextWakeAt({
    input: input.input,
    nextWakeAt: input.assistantMetrics.assistantAutomationSelectedInputWakeAt ?? null,
  });
  const invocationLocalAssistantWake = selectedInputWakeAt
    ? { invocationLocalAssistantWakeAt: selectedInputWakeAt }
    : {};

  if (
    shouldFastDispatchAssistantDeliveryEffects({
      assistantMetrics: input.assistantMetrics,
      deliveryEffects,
      input: input.input,
    })
  ) {
    const fastDispatchBaseNextWake = resolveHostedFastDispatchBaseNextWake({
      assistantMetrics: input.assistantMetrics,
      foregroundCronReconciliationWake: input.foregroundCronReconciliationWake,
      foregroundWorkspaceWake: input.foregroundWorkspaceWake,
      input: input.input,
      skippedDeviceSyncWake: input.skippedDeviceSyncWake,
      systemMailboxWake: input.systemMailboxWake,
      systemMailboxWakeAt: input.systemMailboxWakeAt,
    });
    const postDelivery = await drainHostedPostCheckpointDelivery({
      assistantMetrics: input.assistantMetrics,
      assistantDeliveryEffects: deliveryEffects,
      assistantDeliveryPreparation: preparedDeliveryEffects.preparation,
      baseNextWake: fastDispatchBaseNextWake,
      checkpointReason: "outbox_receipt",
      canConsumeWorkspaceAssistantWake: true,
      input: input.input,
      linqDeliveryContexts: input.linqDeliveryContexts,
      postDeliveryReconciliationWake: input.foregroundCronReconciliationWake,
      providerCleanupPlan: input.providerCleanupPlan,
      redactedStatus: null,
      wake: input.wake,
    });
    const nextWakeAt = postDelivery.nextWakeAt ?? null;
    const wakeStateProgressed = hostedAssistantWakeStateProgressed({
      assistantMetrics: input.assistantMetrics,
      input: input.input,
      nextWakeAt,
      skippedDeviceSyncWakeAt: input.skippedDeviceSyncWake?.at ?? null,
    });
    const progressed = assistantMetricsProgressed({
      ...input.assistantMetrics,
      nextWakeAt,
    }, deliveryEffects.length)
      || wakeStateProgressed;
    await writeHostedAssistantAutomationDetailRuntimeLogs({
      assistantMetrics: input.assistantMetrics,
      input: input.input,
    });
    await writeHostedAssistantPassRuntimeLog({
      assistantMetrics: input.assistantMetrics,
      deliveryEffectCount: deliveryEffects.length,
      input: input.input,
      nextWakeAt,
      progressed,
      systemMailboxWakeAt: input.systemMailboxWakeAt,
    });
    const redactedStatus = {
      ...buildHostedWorkspaceAssistantPhaseRedactedStatus({
        deliveryEffectCount: deliveryEffects.length,
        nextWakeAt,
        outboxTerminalizedSendingCount: 0,
        progressed,
        systemMailboxPrepared: 0,
        systemMailboxRetryableFailed: 0,
      }),
      ...(postDelivery.redactedStatus ?? {}),
    };
    if (!progressed) {
      return {
        foregroundReplyFailed,
        ...invocationLocalAssistantWake,
        ...(nextWakeAt ? { nextWakeAt } : {}),
        ...(shouldExposeHostedAssistantPhaseNextWakeReason(postDelivery.nextWakeReason)
          ? { nextWakeReason: postDelivery.nextWakeReason }
          : {}),
        progressed: false,
        redactedStatus,
      };
    }
    return {
      checkpointReason: postDelivery.checkpointReason,
      foregroundReplyFailed,
      ...invocationLocalAssistantWake,
      nextWakeAt,
      ...(shouldExposeHostedAssistantPhaseNextWakeReason(postDelivery.nextWakeReason)
        ? { nextWakeReason: postDelivery.nextWakeReason }
        : {}),
      progressed: true,
      redactedStatus,
    };
  }

  const outboxWakeAt = await resolveHostedAssistantOutboxNextWakeAt({
    vaultRoot: input.input.restored.vaultRoot,
  });
  const providerCleanupScheduledWakeAt =
    await resolveHostedProviderCleanupScheduledWakeAt({
      nowMs: resolveHostedAssistantPhaseNowMs(input.input),
      vaultRoot: input.input.restored.vaultRoot,
  });
  const nextWake = selectHostedRuntimeWakeCandidate([
    createHostedRuntimeWakeCandidate(assistantNextWakeAt, assistantNextWakeReason),
    input.foregroundCronReconciliationWake,
    input.foregroundWorkspaceWake,
    input.skippedDeviceSyncWake,
    createHostedRuntimeWakeCandidate(
      outboxWakeAt,
      HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
    ),
    input.systemMailboxWake,
    createHostedRuntimeWakeCandidate(
      providerCleanupScheduledWakeAt,
      HOSTED_ASSISTANT_WAKE_REASON,
    ),
  ]);
  const nextWakeAt = nextWake.at;
  const wakeStateProgressed = hostedAssistantWakeStateProgressed({
    assistantMetrics: input.assistantMetrics,
    input: input.input,
    nextWakeAt,
    skippedDeviceSyncWakeAt: input.skippedDeviceSyncWake?.at ?? null,
  });
  const progressed = assistantMetricsProgressed({
    ...input.assistantMetrics,
    nextWakeAt,
  }, deliveryEffects.length)
    || wakeStateProgressed;
  await writeHostedAssistantAutomationDetailRuntimeLogs({
    assistantMetrics: input.assistantMetrics,
    input: input.input,
  });
  await writeHostedAssistantPassRuntimeLog({
    assistantMetrics: input.assistantMetrics,
    deliveryEffectCount: deliveryEffects.length,
    input: input.input,
    nextWakeAt,
    progressed,
    systemMailboxWakeAt: input.systemMailboxWakeAt,
  });
  const hasPostCommitProviderCleanup = deliveryEffects.length > 0;

  const redactedStatus = buildHostedWorkspaceAssistantPhaseRedactedStatus({
    deliveryEffectCount: deliveryEffects.length,
    nextWakeAt,
    outboxTerminalizedSendingCount: 0,
    progressed,
    systemMailboxPrepared: 0,
    systemMailboxRetryableFailed: 0,
  });
  if (!progressed) {
    return {
      foregroundReplyFailed,
      ...invocationLocalAssistantWake,
      ...(nextWakeAt ? { nextWakeAt } : {}),
      ...(shouldExposeHostedAssistantPhaseNextWakeReason(nextWake.reason)
        ? { nextWakeReason: nextWake.reason }
        : {}),
      progressed: false,
      redactedStatus,
    };
  }

  return {
    ...(hasPostCommitProviderCleanup
      ? {
          afterCheckpointKeepsForegroundImportLoop: true,
          afterCheckpoint: async () => {
            assertHostedAssistantPhaseLiveness(input.input.signal);
            const baseNextWake = selectHostedRuntimeWakeCandidate([
              createHostedRuntimeWakeCandidate(assistantNextWakeAt, assistantNextWakeReason),
              input.foregroundWorkspaceWake,
              input.skippedDeviceSyncWake,
              input.systemMailboxWake,
            ]);
            const postDelivery = await drainHostedPostCheckpointDelivery({
              assistantMetrics: input.assistantMetrics,
              assistantDeliveryEffects: deliveryEffects,
              assistantDeliveryPreparation: preparedDeliveryEffects.preparation,
              baseNextWake,
              checkpointReason: "outbox_receipt",
              canConsumeWorkspaceAssistantWake: true,
              input: input.input,
              linqDeliveryContexts: input.linqDeliveryContexts,
              postDeliveryReconciliationWake: input.foregroundCronReconciliationWake,
              providerCleanupPlan: input.providerCleanupPlan,
              redactedStatus: null,
              wake: input.wake,
            });
            return postDelivery;
          },
        }
      : {}),
    checkpointReason: deliveryEffects.length > 0
      ? "outbox_sending"
      : resolveHostedAssistantTimerCheckpointReason({
          assistantMetrics: {
            ...input.assistantMetrics,
            nextWakeAt,
          },
          providerCleanupDue: false,
          terminalLinqCleanupDue: false,
          wakeStateProgressed,
        }),
    foregroundReplyFailed,
    ...invocationLocalAssistantWake,
    nextWakeAt,
    ...(shouldExposeHostedAssistantPhaseNextWakeReason(nextWake.reason)
      ? { nextWakeReason: nextWake.reason }
      : {}),
    progressed: true,
    redactedStatus,
  };
}

type HostedProviderCleanupPostCheckpointWake =
  Parameters<typeof drainHostedPreparedAssistantDeliveries>[0]["wake"];

async function runHostedProviderCleanupPostCheckpointStep(input: {
  assistantDeliveryOutcomes: readonly HostedAssistantDeliveryOutcome[];
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput;
  providerCleanupPlan: HostedProviderCleanupPlan;
  shouldYieldBackgroundDrain?: (() => boolean) | null;
  wake: HostedProviderCleanupPostCheckpointWake;
}): Promise<{
  redactedStatus: HostedRuntimeRedactedJson;
  wake: HostedRuntimeWakeCandidate | null;
}> {
  const providerCleanupDrainDeferred =
    !input.providerCleanupPlan.deferred
    && input.shouldYieldBackgroundDrain?.() === true;
  // Hot drains are reserved for cleanup state already due from an existing
  // durable checkpoint; ids queued in this pass wait for their scheduled wake
  // so provider deletion never precedes the durable snapshot.
  const providerCleanupHotDrainAllowed =
    !input.providerCleanupPlan.deferred && input.providerCleanupPlan.due;
  let providerCleanupNextWakeAt: string | null;
  let providerCleanupRedactedStatus: HostedRuntimeRedactedJson = {};

  if (providerCleanupHotDrainAllowed && !providerCleanupDrainDeferred) {
    // The hot drain deletes only ids already durable in
    // hosted-provider-cleanup.json; current delivery outcomes are appended
    // afterwards through the deferred recording path so they never delete in
    // the invocation that produced them.
    const providerCleanup = await drainHostedProviderCleanupAfterCommit({
      assertLiveness: async () => {
        assertHostedAssistantPhaseLiveness(input.phaseInput.signal);
      },
      checkpoint: input.providerCleanupPlan.checkpoint ?? {
        nextWakeAt: null,
      },
      shouldYield: input.shouldYieldBackgroundDrain ?? null,
      env: buildHostedLinqChannelEnv({
        forwardedEnv: input.phaseInput.runtime.forwardedEnv,
        userEnv: input.phaseInput.runtime.userEnv,
      }) as NodeJS.ProcessEnv,
      fetchImplementation: input.phaseInput.runtime.platform.providerFetch ?? null,
      signal:
        input.phaseInput.backgroundMaintenanceSignal
        ?? input.phaseInput.signal
        ?? null,
      vaultRoot: input.phaseInput.restored.vaultRoot,
      wake: input.wake,
    });
    const recorded = await recordHostedProviderCleanupAfterDelivery({
      idleCheckpointDelayMs: input.phaseInput.request.idleCheckpointDelayMs,
      nowMs: resolveHostedAssistantPhaseNowMs(input.phaseInput),
      outcomes: input.assistantDeliveryOutcomes,
      vaultRoot: input.phaseInput.restored.vaultRoot,
    });
    providerCleanupNextWakeAt = recorded.nextWakeAt ?? providerCleanup.nextWakeAt;
    providerCleanupRedactedStatus = buildHostedProviderCleanupRedactedStatus(providerCleanup);
  } else {
    const providerCleanup = await recordHostedProviderCleanupAfterDelivery({
      idleCheckpointDelayMs: input.phaseInput.request.idleCheckpointDelayMs,
      nowMs: resolveHostedAssistantPhaseNowMs(input.phaseInput),
      outcomes: input.assistantDeliveryOutcomes,
      vaultRoot: input.phaseInput.restored.vaultRoot,
    });
    if (providerCleanupDrainDeferred) {
      // Re-arms any due stored checkpoint and persists the deferred wake
      // into hosted-provider-cleanup.json, the single owner of the wake.
      await prepareHostedProviderCleanupPlan({
        deferred: true,
        idleCheckpointDelayMs: input.phaseInput.request.idleCheckpointDelayMs,
        nowMs: resolveHostedAssistantPhaseNowMs(input.phaseInput),
        vaultRoot: input.phaseInput.restored.vaultRoot,
      });
      providerCleanupRedactedStatus = {
        hostedProviderCleanupYielded: 1,
      };
    }
    providerCleanupNextWakeAt =
      providerCleanup.nextWakeAt
      ?? await resolveHostedProviderCleanupScheduledWakeAt({
        nowMs: resolveHostedAssistantPhaseNowMs(input.phaseInput),
        vaultRoot: input.phaseInput.restored.vaultRoot,
      });
  }

  const providerCleanupWake = createHostedRuntimeWakeCandidate(
    providerCleanupNextWakeAt,
    HOSTED_ASSISTANT_WAKE_REASON,
  );
  return {
    redactedStatus: providerCleanupRedactedStatus,
    wake: providerCleanupWake,
  };
}

async function drainHostedPostCheckpointDelivery(input: {
  afterDurableCheckpoint?: HostedWorkspaceRunnerAssistantPhasePostCheckpoint["afterDurableCheckpoint"] | null;
  assistantMetrics?: HostedAssistantMetrics | null;
  assistantDeliveryEffects: HostedAssistantDeliveryEffects;
  assistantDeliveryPreparation?: HostedAssistantDeliveryPreparation | null;
  baseNextWake: HostedRuntimeWakeCandidate;
  checkpointReason: HostedWorkspaceRunnerAssistantPhasePostCheckpoint["checkpointReason"];
  canConsumeWorkspaceAssistantWake: boolean;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  linqDeliveryContexts?: readonly HostedAssistantLinqDeliveryContext[] | null;
  providerCleanupPlan: HostedProviderCleanupPlan;
  postDeliveryReconciliationWake?: HostedRuntimeWakeCandidate | null;
  redactedStatus: HostedRuntimeRedactedJson | null;
  shouldYieldBackgroundDrain?: (() => boolean) | null;
  wake: Parameters<typeof drainHostedPreparedAssistantDeliveries>[0]["wake"];
}): Promise<HostedWorkspaceRunnerAssistantPhasePostCheckpoint> {
  const hasDeliveryEffects = input.assistantDeliveryEffects.length > 0;
  if (hasDeliveryEffects && input.shouldYieldBackgroundDrain?.() === true) {
    return await yieldHostedBackgroundPostCheckpointDrain(input);
  }

  let memberChannelBarrier: HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null = null;
  try {
    if (hasDeliveryEffects && input.shouldYieldBackgroundDrain?.() === true) {
      return await yieldHostedBackgroundPostCheckpointDrain(input);
    }
    memberChannelBarrier = hasDeliveryEffects
      ? await flushHostedMemberChannelUpdatesBeforeAutoReplyDelivery(input)
      : null;
  } catch (error) {
    await resetHostedPreparedDeliveryForBarrier({
      assistantDeliveryEffects: input.assistantDeliveryEffects,
      assistantDeliveryPreparation: input.assistantDeliveryPreparation ?? null,
      input: input.input,
    });
    const failure = buildHostedRuntimeFailureDiagnostics(
      error,
      "Hosted member-channel pre-dispatch barrier failed.",
    );
    return await buildHostedMemberChannelDeliveryBarrierResult({
      input,
      nextWakeAt: new Date(resolveHostedAssistantPhaseNowMs(input.input)).toISOString(),
      nextWakeReason: "assistant",
      redactedStatus: {
        hostedMemberChannelPreDispatchBarrierFailed: 1,
        hostedMemberChannelPreDispatchBarrierErrorCode: failure.errorCode,
      },
    });
  }
  if (memberChannelBarrier) {
    await resetHostedPreparedDeliveryForBarrier({
      assistantDeliveryEffects: input.assistantDeliveryEffects,
      assistantDeliveryPreparation: input.assistantDeliveryPreparation ?? null,
      input: input.input,
    });
    return memberChannelBarrier;
  }
  if (hasDeliveryEffects && input.shouldYieldBackgroundDrain?.() === true) {
    return await yieldHostedBackgroundPostCheckpointDrain(input);
  }

  let backgroundDeliveryDrainYielded = false;
  let backgroundDeliveryDrainYieldedCount = 0;
  const outcomes = input.assistantDeliveryEffects.length > 0
    ? await drainHostedPreparedAssistantDeliveries({
        actionApprovalPort: input.input.runtime.platform.actionApprovalPort ?? null,
        allowPreparedSending: true,
        assistantDeliveryEffects: input.assistantDeliveryEffects,
        assertLiveness: async () => {
          assertHostedAssistantPhaseLiveness(input.input.signal);
        },
        effectsPort: input.input.platform.effectsPort,
        forwardedEnv: input.input.runtime.forwardedEnv,
        linqDeliveryContexts: input.linqDeliveryContexts ?? null,
        onBackgroundDeliveryYield: ({ yieldedEffectCount }) => {
          backgroundDeliveryDrainYielded = true;
          backgroundDeliveryDrainYieldedCount = Math.max(
            backgroundDeliveryDrainYieldedCount,
            yieldedEffectCount,
          );
        },
        platform: input.input.runtime.platform,
        platformEnv: input.input.runtime.platformEnv,
        preparedDispatches: input.assistantDeliveryPreparation?.preparedDispatches ?? null,
        providerFetch: input.input.runtime.platform.providerFetch ?? null,
        publicInternetFetch: input.input.runtime.platform.publicInternetFetch ?? null,
        shouldYieldBackgroundDelivery: input.shouldYieldBackgroundDrain ?? null,
        signal: input.input.signal ?? null,
        userEnv: input.input.runtime.userEnv,
        vaultRoot: input.input.restored.vaultRoot,
        wake: input.wake,
      })
    : [];
  await recordHostedProductFeedbackAfterMemberDelivery({
    candidates:
      input.assistantMetrics?.assistantAutomationProductFeedbackCandidates ?? [],
    currentTurnDeliveryIntentIds:
      input.assistantMetrics?.assistantAutomationCurrentTurnDeliveryIntentIds ?? [],
    outcomes,
    port: input.input.runtime.platform.productFeedbackPort ?? null,
  });
  if (backgroundDeliveryDrainYielded) {
    await recordHostedProviderCleanupAfterDelivery({
      idleCheckpointDelayMs: input.input.request.idleCheckpointDelayMs,
      nowMs: resolveHostedAssistantPhaseNowMs(input.input),
      outcomes,
      vaultRoot: input.input.restored.vaultRoot,
    });
    const stagedTerminalFailureInputCount =
      await stageHostedTerminalOutboxFailureInputs({
        deliveryEffects: input.assistantDeliveryEffects,
        outcomes,
        vaultRoot: input.input.restored.vaultRoot,
      });
    return await yieldHostedBackgroundPostCheckpointDrain(input, {
      resetPreparedDelivery: false,
      stagedTerminalFailureInputCount,
      yieldedDeliveryCount: backgroundDeliveryDrainYieldedCount,
    });
  }
  const providerCleanup = await runHostedProviderCleanupPostCheckpointStep({
    assistantDeliveryOutcomes: outcomes,
    phaseInput: input.input,
    providerCleanupPlan: input.providerCleanupPlan,
    shouldYieldBackgroundDrain: input.shouldYieldBackgroundDrain ?? null,
    wake: input.wake,
  });
  const stagedTerminalFailureInputCount =
    await stageHostedTerminalOutboxFailureInputs({
      deliveryEffects: input.assistantDeliveryEffects,
      outcomes,
      vaultRoot: input.input.restored.vaultRoot,
    });
  const postDeliveryPendingAssistantInputWakeAt =
    await resolvePendingAssistantInputWakeAt(input.input, { inspectOnly: true });
  const postOutboxWakeAt = await resolveHostedAssistantOutboxNextWakeAt({
    vaultRoot: input.input.restored.vaultRoot,
  });
  const dropConsumedWorkspaceAssistantWake = (
    candidate: HostedRuntimeWakeCandidate | null,
  ): HostedRuntimeWakeCandidate | null =>
    dropConsumedPostDeliveryWorkspaceAssistantWake({
      candidate,
      canConsumeWorkspaceAssistantWake: input.canConsumeWorkspaceAssistantWake,
      phaseInput: input.input,
    });
  const postSystemMailboxWakeAt = await resolveHostedSystemMailboxNextWakeAt({
    vaultRoot: input.input.restored.vaultRoot,
  });
  const postBaseNextWake = dropConsumedWorkspaceAssistantWake(
    resolveHostedPostDeliveryBaseNextWake(input),
  );
  const postDeliveryCronWakeState =
    outcomes.some((outcome) =>
      outcome.deliveryErrorCode === ASSISTANT_AUTOMATION_DELIVERY_AUTHORITY_STALE
    )
      ? await resolveHostedAssistantCronWakeStateBestEffort(input.input)
      : null;
  const postDeliveryCronWake = postDeliveryCronWakeState?.available === true
    ? postDeliveryCronWakeState.wake
    : postDeliveryCronWakeState
      ? createHostedRuntimeWakeCandidate(
          new Date(
            resolveHostedAssistantPhaseNowMs(input.input)
              + HOSTED_ASSISTANT_CRON_STATUS_RETRY_DELAY_MS,
          ).toISOString(),
          HOSTED_ASSISTANT_WAKE_REASON,
        )
      : null;
  const postNextWake = selectHostedRuntimeWakeCandidate([
    postBaseNextWake,
    dropConsumedWorkspaceAssistantWake(postDeliveryCronWake),
    input.postDeliveryReconciliationWake,
    createHostedRuntimeWakeCandidate(
      postOutboxWakeAt,
      HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
    ),
    createHostedRuntimeWakeCandidate(postSystemMailboxWakeAt, "assistant"),
    createHostedRuntimeWakeCandidate(
      postDeliveryPendingAssistantInputWakeAt,
      "assistant",
    ),
    providerCleanup.wake,
  ]);
  const postNextWakeAt = postNextWake.at;
  if (input.assistantDeliveryEffects.length > 0) {
    await writeHostedOutboxDeliveryRuntimeLog({
      deliveryEffects: input.assistantDeliveryEffects,
      input: input.input,
      outcomes,
      postNextWakeAt,
    });
  }

  const sentCount = outcomes.filter((outcome) =>
    outcome.deliveryStatus === "sent"
  ).length;
  const terminalizedSendingCount = outcomes.filter((outcome) =>
    isHostedAssistantDeliveryOutcomeTerminalized(outcome)
  ).length;
  const deliveryRedactedStatus: HostedRuntimeRedactedJson =
    input.assistantDeliveryEffects.length > 0
      ? {
          hostedOutboxDeliveryAttempted: outcomes.length,
          hostedOutboxDeliverySent: sentCount,
          hostedOutboxPendingDeliveryEffects: 0,
          hostedOutboxTerminalizedSending: terminalizedSendingCount,
          hostedOutboxTerminalFailureInputsStaged: stagedTerminalFailureInputCount,
        }
      : {};

  return {
    ...(input.afterDurableCheckpoint ? { afterDurableCheckpoint: input.afterDurableCheckpoint } : {}),
    checkpointReason: input.checkpointReason,
    nextWakeAt: postNextWakeAt,
    nextWakeReason: postNextWake.reason,
    redactedStatus: {
      ...providerCleanup.redactedStatus,
      ...(input.redactedStatus ?? {}),
      ...deliveryRedactedStatus,
      hostedAssistantNextWakeAt: postNextWakeAt,
      nextWakeAt: postNextWakeAt,
    },
  };
}

async function recordHostedProductFeedbackAfterMemberDelivery(input: {
  candidates: readonly HostedRuntimeProductFeedbackRecord[];
  currentTurnDeliveryIntentIds: readonly string[];
  outcomes: readonly HostedAssistantDeliveryOutcome[];
  port: HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["productFeedbackPort"];
}): Promise<void> {
  if (
    !input.port
    || input.candidates.length === 0
    || !input.outcomes.some((outcome) =>
      outcome.deliveryStatus === "sent"
      && input.currentTurnDeliveryIntentIds.includes(outcome.effectId)
    )
  ) {
    return;
  }

  await Promise.allSettled(
    input.candidates.map((candidate) =>
      input.port?.recordProductFeedback(candidate)
    ),
  );
}

async function yieldHostedBackgroundPostCheckpointDrain(
  input: Parameters<typeof drainHostedPostCheckpointDelivery>[0],
  options?: {
    resetPreparedDelivery?: boolean;
    stagedTerminalFailureInputCount?: number;
    yieldedDeliveryCount?: number;
  },
): Promise<HostedWorkspaceRunnerAssistantPhasePostCheckpoint> {
  const resetPreparedDelivery = options?.resetPreparedDelivery !== false;
  if (resetPreparedDelivery && input.assistantDeliveryEffects.length > 0) {
    await resetHostedPreparedDeliveryForBarrier({
      assistantDeliveryEffects: input.assistantDeliveryEffects,
      assistantDeliveryPreparation: input.assistantDeliveryPreparation ?? null,
      input: input.input,
    });
  }
  const postOutboxWakeAt = await resolveHostedAssistantOutboxNextWakeAt({
    vaultRoot: input.input.restored.vaultRoot,
  });
  const nextWake = selectHostedRuntimeWakeCandidate([
    createHostedRuntimeWakeCandidate(
      new Date(resolveHostedAssistantPhaseNowMs(input.input)).toISOString(),
      HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
    ),
    createHostedRuntimeWakeCandidate(
      postOutboxWakeAt,
      HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
    ),
    input.baseNextWake,
  ]);

  return {
    ...(input.afterDurableCheckpoint ? { afterDurableCheckpoint: input.afterDurableCheckpoint } : {}),
    checkpointReason: "assistant_runtime_commit",
    nextWakeAt: nextWake.at,
    nextWakeReason: nextWake.reason,
    redactedStatus: {
      ...(input.redactedStatus ?? {}),
      hostedOutboxDeliveryYielded:
        options?.yieldedDeliveryCount ?? input.assistantDeliveryEffects.length,
      ...(typeof options?.stagedTerminalFailureInputCount === "number"
        ? {
            hostedOutboxTerminalFailureInputsStaged:
              options.stagedTerminalFailureInputCount,
          }
        : {}),
      hostedAssistantNextWakeAt: nextWake.at,
      nextWakeAt: nextWake.at,
    },
  };
}

function resolveHostedPostDeliveryBaseNextWake(
  input: Parameters<typeof drainHostedPostCheckpointDelivery>[0],
): HostedRuntimeWakeCandidate | null {
  const baseNextWake = input.baseNextWake;
  if (!baseNextWake.at) {
    return null;
  }
  if (
    baseNextWake.reason !== null
    && !hostedRuntimeWakeReasonUsesAssistantPhase(baseNextWake.reason)
  ) {
    return baseNextWake;
  }

  const futureWakeAt = normalizeHostedFutureWakeAt(
    baseNextWake.at,
    resolveHostedAssistantPhaseNowMs(input.input),
  );
  if (!futureWakeAt && !input.canConsumeWorkspaceAssistantWake) {
    // A non-consuming drain must keep a due assistant wake armed; normalizing
    // it away here would disarm cron with no later candidate to re-arm it.
    return baseNextWake;
  }
  return createHostedRuntimeWakeCandidate(
    futureWakeAt,
    baseNextWake.reason ?? HOSTED_ASSISTANT_WAKE_REASON,
  );
}

function dropConsumedPostDeliveryWorkspaceAssistantWake(input: {
  candidate: HostedRuntimeWakeCandidate | null;
  canConsumeWorkspaceAssistantWake: boolean;
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput;
}): HostedRuntimeWakeCandidate | null {
  const candidate = input.candidate;
  if (!candidate?.at) {
    return candidate;
  }
  if (!input.canConsumeWorkspaceAssistantWake) {
    return candidate;
  }
  if (!hostedRuntimeWakeReasonUsesAssistantPhase(candidate.reason)) {
    return candidate;
  }
  const workspaceWakeAt = input.phaseInput.workspace?.nextWakeAt ?? null;
  if (candidate.at !== workspaceWakeAt) {
    return candidate;
  }
  const workspaceWakeReason = input.phaseInput.workspace?.nextWakeReason ?? null;
  if (
    workspaceWakeReason !== null
    && !hostedRuntimeWakeReasonUsesAssistantPhase(workspaceWakeReason)
  ) {
    return candidate;
  }

  return isDueHostedAssistantWorkspaceWake(input.phaseInput) ? null : candidate;
}

function isHostedAssistantDeliveryOutcomeTerminalized(
  outcome: HostedAssistantDeliveryOutcome,
): boolean {
  return outcome.retryable !== true
    && outcome.deliveryStatus !== "pending"
    && outcome.deliveryStatus !== "retryable"
    && outcome.deliveryStatus !== "sending";
}

const HOSTED_TERMINAL_OUTBOX_FAILURE_DIRECT_REPLY_CHANNELS = new Set([
  "linq",
  "telegram",
]);

type HostedTerminalOutboxFailureIntent =
  NonNullable<Awaited<ReturnType<typeof readAssistantOutboxIntent>>>;
type HostedTerminalOutboxFailureRoute = Pick<
  AssistantInputEventRecord,
  "conversation" | "replyTarget"
>;

async function stageHostedTerminalOutboxFailureInputs(input: {
  deliveryEffects: HostedAssistantDeliveryEffects;
  outcomes: readonly HostedAssistantDeliveryOutcome[];
  vaultRoot: string;
}): Promise<number> {
  const terminalFailures = input.outcomes.filter((outcome) =>
    shouldStageHostedTerminalOutboxFailureInput(outcome)
  );
  if (terminalFailures.length === 0) {
    return 0;
  }
  const effectsById = new Map(
    input.deliveryEffects.map((effect) => [effect.effectId, effect]),
  );
  let staged = 0;

  for (const outcome of terminalFailures) {
    const intent = await readAssistantOutboxIntent(input.vaultRoot, outcome.effectId);
    const occurredAt = readHostedTerminalOutboxFailureInputOccurredAt(intent);
    if (!occurredAt) {
      continue;
    }
    const route = buildHostedTerminalOutboxFailureRouteFromIntent(intent);
    if (!route) {
      continue;
    }
    const identity = safeHostedAssistantInputTokenOrHash(
      `${OUTBOX_DELIVERY_FAILED_INPUT_PREFIX}:${outcome.effectId}`,
    );
    const text = renderHostedTerminalOutboxFailureSystemNote({
      effect: effectsById.get(outcome.effectId) ?? null,
      outcome,
    });
    const event = await upsertAssistantInputEvent({
      event: {
        content: {
          attachmentDescriptors: [],
          text,
          transcriptText: text,
          userMessageContent: [{ text, type: "text" }],
        },
        conversation: route.conversation,
        occurredAt,
        receivedAt: occurredAt,
        replyTarget: route.replyTarget,
        sourceMetadata: null,
        sourceRef: {
          dedupeKey: identity,
          eventId: identity,
          itemId: identity,
          kind: "hosted-mailbox",
          lane: "system",
          laneSeq: identity,
          payloadSchema: OUTBOX_DELIVERY_FAILED_PAYLOAD_SCHEMA,
          payloadSource: "inline",
          source: "hosted-mailbox",
          wakeSchema: OUTBOX_DELIVERY_FAILED_WAKE_SCHEMA,
        },
      },
      vault: input.vaultRoot,
    });
    await recordHostedMailboxAssistantInputItem({
      inputId: event.inputId,
      mailboxItemId: identity,
      vault: input.vaultRoot,
    });
    await enqueueHostedPendingAssistantInputId({
      inputId: event.inputId,
      vaultRoot: input.vaultRoot,
    });
    staged += 1;
  }

  return staged;
}

function readHostedTerminalOutboxFailureInputOccurredAt(
  intent: HostedTerminalOutboxFailureIntent | null,
): string | null {
  const createdAt = intent?.createdAt ?? null;
  return typeof createdAt === "string" && Number.isFinite(Date.parse(createdAt))
    ? createdAt
    : null;
}

function buildHostedTerminalOutboxFailureRouteFromIntent(
  intent: HostedTerminalOutboxFailureIntent | null,
): HostedTerminalOutboxFailureRoute | null {
  if (intent?.operation) {
    return null;
  }

  const answeredMailboxItemIds = intent?.answeredMailboxItemIds ?? [];
  if (
    answeredMailboxItemIds.length > 0
    && answeredMailboxItemIds.every((mailboxItemId) =>
      mailboxItemId.startsWith(`${OUTBOX_DELIVERY_FAILED_INPUT_PREFIX}:`)
    )
  ) {
    // Failure-note-only replies are terminal evidence. Mixed replies may still
    // owe a real user a failure signal, so they continue staging.
    return null;
  }

  if (intent?.threadIsDirect !== true) {
    return null;
  }

  const channel = normalizeHostedTerminalOutboxFailureDirectReplyChannel(
    intent.channel,
  );
  if (!channel) {
    return null;
  }

  const candidate = resolveDeliveryCandidates({
    bindingDelivery: intent.bindingDelivery,
    explicitTarget: intent.explicitTarget,
  })[0] ?? null;
  if (!candidate || candidate.kind === "participant") {
    return null;
  }

  const replyTargetThreadId = normalizeAssistantRouteString(candidate.target);
  if (!replyTargetThreadId) {
    return null;
  }

  return {
    conversation: {
      accountId: normalizeAssistantRouteString(intent.identityId),
      actorId: normalizeAssistantRouteString(intent.actorId),
      actorIsSelf: false,
      source: channel,
      threadId: normalizeAssistantRouteString(intent.threadId),
      threadIsDirect: true,
    },
    replyTarget: {
      channel,
      messageId: null,
      threadId: replyTargetThreadId,
    },
  };
}

function shouldStageHostedTerminalOutboxFailureInput(
  outcome: HostedAssistantDeliveryOutcome,
): boolean {
  if (outcome.deliveryStatus !== "failed" || outcome.retryable === true) {
    return false;
  }
  if (
    outcome.deliveryErrorCode === ASSISTANT_AUTOMATION_DELIVERY_AUTHORITY_STALE
  ) {
    return false;
  }
  return normalizeHostedTerminalOutboxFailureDirectReplyChannel(
    outcome.deliveryChannel,
  ) !== null;
}

function normalizeHostedTerminalOutboxFailureDirectReplyChannel(
  value: string | null | undefined,
): string | null {
  const channel = normalizeAssistantRouteString(value);
  return channel && HOSTED_TERMINAL_OUTBOX_FAILURE_DIRECT_REPLY_CHANNELS.has(channel)
    ? channel
    : null;
}

function renderHostedTerminalOutboxFailureSystemNote(input: {
  effect: HostedAssistantDeliveryEffects[number] | null;
  outcome: HostedAssistantDeliveryOutcome;
}): string {
  const channel = normalizeHostedFailureNoteToken(
    input.outcome.deliveryChannel ?? input.effect?.payload.channel,
    "unknown",
  );
  const failureCode = normalizeHostedFailureNoteToken(
    input.outcome.deliveryErrorCode,
    "unknown",
  );
  const mediaDescription = renderHostedFailureNoteMedia(input.effect);
  const hasImage = input.effect?.payload.media.some((item) =>
    item.kind === "image" || item.kind === "vault_image"
  ) === true;
  const hasVaultFile = input.effect?.payload.media.some((item) =>
    item.kind === "vault_file"
  ) === true;

  const lines = [
    "System note: The assistant's outgoing message failed to send and was NOT delivered to the user.",
    `channel: ${channel}.`,
    `failure code: ${failureCode}.`,
    `attached media: ${mediaDescription}.`,
  ];
  if (hasVaultFile) {
    lines.push(
      "Any consumed vault-file approval must be re-requested before retrying.",
    );
  }
  if (hasImage) {
    lines.push(
      "Image delivery remains outstanding. A text-only substitute is not equivalent; do not offer or send one as recovery. Any recovery attempt must attach images and stay within the current response-media limit.",
    );
  }
  lines.push("Do not claim the failed message or file was sent.");
  return lines.join(" ");
}

function renderHostedFailureNoteMedia(
  effect: HostedAssistantDeliveryEffects[number] | null,
): string {
  const media = effect?.payload.media ?? [];
  if (media.length === 0) {
    return "none";
  }

  const imageCount = media.filter((item) =>
    item.kind === "image" || item.kind === "vault_image"
  ).length;
  const voiceMemoCount = media.filter((item) => item.kind === "voice_memo").length;
  const descriptions = [
    imageCount > 0 ? `${imageCount} ${imageCount === 1 ? "image" : "images"}` : null,
    voiceMemoCount > 0
      ? `${voiceMemoCount} ${voiceMemoCount === 1 ? "voice memo" : "voice memos"}`
      : null,
    ...media
      .filter((item) => item.kind === "vault_file")
      .map((item) => `vault file "${normalizeHostedFailureNoteFilename(item.filename)}"`),
  ];
  return descriptions.filter((value): value is string => value !== null).join(", ");
}

function normalizeHostedFailureNoteFilename(filename: string): string {
  const normalized = filename.replace(/[\u0000-\u001F\u007F\\/]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return (normalized || "attached file").slice(0, 120);
}

function normalizeHostedFailureNoteToken(
  value: string | null | undefined,
  fallback: string,
): string {
  const normalized = value?.trim() ?? "";
  return /^[A-Za-z0-9_.:-]{1,80}$/u.test(normalized)
    ? normalized
    : fallback;
}

function safeHostedAssistantInputTokenOrHash(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length > 0
    && normalized.length <= 192
    && ASSISTANT_INPUT_EVENT_SAFE_TOKEN_PATTERN.test(normalized)
    && !isUnsafeHostedAssistantInputToken(normalized)
  ) {
    return normalized;
  }

  return `tok_${createHash("sha256").update(normalized || "empty").digest("hex").slice(0, 32)}`;
}

function isUnsafeHostedAssistantInputToken(value: string): boolean {
  return value.includes("://")
    || value.includes("@")
    || value.includes("/")
    || value.toLowerCase().includes("authorization");
}

async function flushHostedMemberChannelUpdatesBeforeAutoReplyDelivery(
  input: Parameters<typeof drainHostedPostCheckpointDelivery>[0],
): Promise<HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null> {
  if (!await hostedDeliveryEffectsContainAutoReply({
    effects: input.assistantDeliveryEffects,
    vaultRoot: input.input.restored.vaultRoot,
  })) {
    return null;
  }

  await input.input.prepareAutoReplyDelivery?.();

  let processed = 0;
  while (true) {
    assertHostedAssistantPhaseLiveness(input.input.signal);
    const preparation = await prepareHostedSystemMailboxItemForCheckpoint({
      allowedRouteActions: HOSTED_MEMBER_CHANNEL_UPDATE_ROUTE_ACTIONS,
      operatorHomeRoot: input.input.restored.operatorHomeRoot,
      runtime: input.input.runtime,
      runtimeEnv: input.input.runtimeEnv,
      vaultRoot: input.input.restored.vaultRoot,
    });
    if (!preparation) {
      break;
    }
    if (preparation.status === "retryable_failed") {
      return await buildHostedMemberChannelDeliveryBarrierResult({
        input,
        nextWakeAt: preparation.nextWakeAt,
        nextWakeReason: "assistant",
        redactedStatus: {
          hostedMemberChannelPreDispatchBlocked: 1,
          hostedMemberChannelPreDispatchErrorCode: preparation.errorCode,
        },
      });
    }
    if (preparation.status === "recording") {
      const record = await recordHostedSystemMailboxItemAfterCheckpoint({
        item: preparation.item,
        operatorHomeRoot: input.input.restored.operatorHomeRoot,
        runtime: input.input.runtime,
        vaultRoot: input.input.restored.vaultRoot,
      });
      if (record.failed > 0) {
        return await buildHostedMemberChannelDeliveryBarrierResult({
          input,
          nextWakeAt: record.nextWakeAt,
          nextWakeReason: record.nextWakeReason ?? "assistant",
          redactedStatus: {
            hostedMemberChannelPreDispatchRecordFailed: record.failed,
          },
        });
      }
    }
    processed += 1;
  }

  const pendingWakeAt = await resolveHostedSystemMailboxNextWakeAt({
    allowedRouteActions: HOSTED_MEMBER_CHANNEL_UPDATE_ROUTE_ACTIONS,
    vaultRoot: input.input.restored.vaultRoot,
  });
  if (!pendingWakeAt) {
    return null;
  }

  return await buildHostedMemberChannelDeliveryBarrierResult({
    input,
    nextWakeAt: pendingWakeAt,
    nextWakeReason: "assistant",
    redactedStatus: {
      hostedMemberChannelPreDispatchPending: 1,
      hostedMemberChannelPreDispatchProcessed: processed,
    },
  });
}

async function hostedDeliveryEffectsContainAutoReply(input: {
  effects: HostedAssistantDeliveryEffects;
  vaultRoot: string;
}): Promise<boolean> {
  const intents = (
    await Promise.all(
      input.effects.map((effect) =>
        readAssistantOutboxIntent(input.vaultRoot, effect.effectId)
      ),
    )
  ).filter((intent): intent is NonNullable<typeof intent> => intent !== null);
  if (intents.length === 0) {
    return false;
  }

  const autoReplyIntentIds = await findAssistantAutoReplyDeliveryIntentIds({
    intents,
    vault: input.vaultRoot,
  });
  return autoReplyIntentIds.size > 0;
}

async function buildHostedMemberChannelDeliveryBarrierResult(input: {
  input: Parameters<typeof drainHostedPostCheckpointDelivery>[0];
  nextWakeAt: string | null;
  nextWakeReason?: string | null;
  redactedStatus: HostedRuntimeRedactedJson;
}): Promise<HostedWorkspaceRunnerAssistantPhasePostCheckpoint> {
  const providerCleanup = await runHostedProviderCleanupPostCheckpointStep({
    assistantDeliveryOutcomes: [],
    phaseInput: input.input.input,
    providerCleanupPlan: input.input.providerCleanupPlan,
    shouldYieldBackgroundDrain: input.input.input.shouldYieldBackgroundMaintenance ?? null,
    wake: input.input.wake,
  });
  const baseNextWake = dropConsumedPostDeliveryWorkspaceAssistantWake({
    candidate: resolveHostedPostDeliveryBaseNextWake(input.input),
    canConsumeWorkspaceAssistantWake: input.input.canConsumeWorkspaceAssistantWake,
    phaseInput: input.input.input,
  });
  const nextWake = selectHostedRuntimeWakeCandidate([
    baseNextWake,
    createHostedRuntimeWakeCandidate(input.nextWakeAt, input.nextWakeReason ?? "assistant"),
    providerCleanup.wake,
  ]);
  return {
    ...(input.input.afterDurableCheckpoint
      ? { afterDurableCheckpoint: input.input.afterDurableCheckpoint }
      : {}),
    checkpointReason: "assistant_runtime_commit",
    nextWakeAt: nextWake.at,
    nextWakeReason: nextWake.reason,
    redactedStatus: {
      ...providerCleanup.redactedStatus,
      ...(input.input.redactedStatus ?? {}),
      ...input.redactedStatus,
      nextWakeAt: nextWake.at,
    },
  };
}

async function resetHostedPreparedDeliveryForBarrier(input: {
  assistantDeliveryEffects: HostedAssistantDeliveryEffects;
  assistantDeliveryPreparation: HostedAssistantDeliveryPreparation | null;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): Promise<void> {
  await resetHostedPreparedAssistantDeliveryEffects({
    effects: input.assistantDeliveryEffects,
    preparedDispatches: input.assistantDeliveryPreparation?.preparedDispatches ?? null,
    vaultRoot: input.input.restored.vaultRoot,
  });
}

function relayHostedAssistantPhaseAbortSignal(
  source: AbortSignal | null,
  controller: AbortController,
): () => void {
  if (!source) {
    return () => undefined;
  }

  const onAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort(source.reason);
    }
  };
  if (source.aborted) {
    onAbort();
    return () => undefined;
  }

  source.addEventListener("abort", onAbort, { once: true });
  return () => {
    source.removeEventListener("abort", onAbort);
  };
}

function assertHostedAssistantPhaseLiveness(signal: AbortSignal | null | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  const reason = signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }
  throw new Error("Hosted workspace assistant phase was aborted.");
}

function resolveHostedAssistantPhaseNowMs(input: {
  now?: (() => string) | null;
}): number {
  const fallbackNowMs = Date.now();
  if (!input.now) {
    return fallbackNowMs;
  }

  const parsed = Date.parse(input.now());
  return Number.isFinite(parsed) ? parsed : fallbackNowMs;
}

async function resolvePendingAssistantInputWakeAt(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
  options: { inspectOnly?: boolean } = {},
): Promise<string | null> {
  return await resolveHostedPendingAssistantInputWakeAt({
    inspectOnly: options.inspectOnly,
    now: input.now,
    vaultRoot: input.restored.vaultRoot,
  });
}

function buildHostedProviderCleanupRedactedStatus(input: {
  attemptedLinqMessageCount: number;
  deletedLinqMessageCount: number;
  failedLinqMessageCount: number;
}): HostedRuntimeRedactedJson {
  return {
    hostedProviderCleanupAttemptedLinqItems: input.attemptedLinqMessageCount,
    hostedProviderCleanupDeletedLinqItems: input.deletedLinqMessageCount,
    hostedProviderCleanupFailedLinqItems: input.failedLinqMessageCount,
  };
}

function isDueHostedDeviceSyncRecoveryAlarm(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  return (
    isDueHostedDeviceSyncReconcileAlarm(input)
    || isDueHostedLegacyDeviceSyncRecoveryAlarm(input)
  );
}

function isDueHostedDeviceSyncReconcileAlarm(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  return (
    isDueHostedWorkspaceAlarm(input)
    && input.workspace?.nextWakeReason === HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON
  );
}

function isDueHostedDeviceSyncReconcileWake(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  return (
    input.workspace?.nextWakeReason === HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON
    && !hasFreshHostedMailboxInput(input)
    && isDueHostedWorkspaceWakeAt(input)
  );
}

function isDueHostedLegacyDeviceSyncRecoveryAlarm(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  return isDueHostedWorkspaceAlarm(input) && isDueHostedLegacyDeviceSyncRecoveryWake(input);
}

function isDueHostedWorkspaceAlarm(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  if (hasFreshHostedMailboxInput(input)) {
    return false;
  }

  return isDueHostedWorkspaceWake(input);
}

function isDueHostedWorkspaceWake(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  if (!input.workspace?.nextWakeAt) {
    return false;
  }

  return isDueHostedWorkspaceWakeAt(input);
}

function isDueHostedWorkspaceWakeAt(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  if (!input.workspace?.nextWakeAt) {
    return false;
  }

  const wakeTime = Date.parse(input.workspace.nextWakeAt);
  return Number.isFinite(wakeTime) && wakeTime <= resolveHostedAssistantPhaseNowMs(input);
}

function isDueHostedAssistantWorkspaceWake(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  const wakeReason = input.workspace?.nextWakeReason ?? null;
  return (
    hostedRuntimeWakeReasonUsesAssistantPhase(wakeReason)
    && isDueHostedWorkspaceWakeAt(input)
  );
}

function isDueHostedLegacyDeviceSyncRecoveryWake(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  if (!hasHostedDeviceSyncRuntimeConfigured(input) || !isDueHostedWorkspaceWakeAt(input)) {
    return false;
  }

  const wakeReason = input.workspace?.nextWakeReason ?? null;
  return wakeReason === null || wakeReason === "assistant";
}

function hasHostedDeviceSyncRuntimeConfigured(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  return input.runtime.resolvedConfig.deviceSync !== null;
}

function buildHostedAssistantAutomationBootstrapEnv(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): Record<string, string> {
  return {
    ...input.runtimeEnv,
    ...input.runtime.forwardedEnv,
    ...input.runtime.userEnv,
  };
}

function resolveSkippedDeviceSyncWake(input: {
  deviceSyncMaintenanceRan: boolean;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  pendingAssistantInputWakeAt: string | null;
}): HostedRuntimeWakeCandidate | null {
  if (input.deviceSyncMaintenanceRan) {
    return null;
  }

  const existingWakeAt = input.input.workspace?.nextWakeAt ?? null;
  const existingWakeReason = input.input.workspace?.nextWakeReason ?? null;
  if (existingWakeReason !== HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON) {
    return null;
  }
  if (!existingWakeAt) {
    return null;
  }

  const wakeTime = Date.parse(existingWakeAt);
  if (!Number.isFinite(wakeTime)) {
    return {
      at: existingWakeAt,
      reason: existingWakeReason,
    };
  }

  const nowMs = resolveHostedAssistantPhaseNowMs(input.input);
  if (wakeTime > nowMs) {
    return {
      at: existingWakeAt,
      reason: existingWakeReason,
    };
  }

  const handledDeviceSyncWake = input.input.deviceSyncWorkspaceWakeHandled ?? null;
  if (
    handledDeviceSyncWake?.nextWakeAt === existingWakeAt
    && handledDeviceSyncWake.nextWakeReason === existingWakeReason
    && !input.pendingAssistantInputWakeAt
    && !shouldRescheduleSkippedDeviceSyncWake(input.input)
  ) {
    return null;
  }

  if (input.pendingAssistantInputWakeAt || shouldRescheduleSkippedDeviceSyncWake(input.input)) {
    return {
      at: new Date(nowMs + HOSTED_SKIPPED_DEVICE_SYNC_RETRY_DELAY_MS).toISOString(),
      reason: existingWakeReason,
    };
  }

  return null;
}

async function resolveHostedDeviceSyncFollowUpWake(input: {
  deviceSyncMaintenanceRan: boolean;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  pendingAssistantInputWakeAt: string | null;
}): Promise<HostedRuntimeWakeCandidate | null> {
  let localDeviceSyncScheduledWake: HostedRuntimeWakeCandidate | null;
  try {
    localDeviceSyncScheduledWake = await resolveHostedLocalDeviceSyncScheduledWake(input.input);
  } catch (error) {
    if (!isHostedDeviceSyncMaintenanceModuleLoadError(error)) {
      throw error;
    }
    await writeHostedDeviceSyncFollowUpWakeProjectionModuleLoadFailureRuntimeLog({
      error,
      input: input.input,
    });
    return null;
  }
  const handledDeviceSyncWake = input.input.deviceSyncWorkspaceWakeHandled ?? null;
  if (
    localDeviceSyncScheduledWake?.at
    && handledDeviceSyncWake !== null
    && handledDeviceSyncWake?.nextWakeAt === input.input.workspace?.nextWakeAt
    && handledDeviceSyncWake.nextWakeReason === input.input.workspace?.nextWakeReason
  ) {
    return localDeviceSyncScheduledWake;
  }

  const skippedDeviceSyncWake = resolveSkippedDeviceSyncWake(input);
  if (
    skippedDeviceSyncWake?.at
    && shouldDropStaleLocalDeviceSyncWakeForSkippedRetry({
      input: input.input,
      localDeviceSyncScheduledWake,
      skippedDeviceSyncWake,
    })
  ) {
    localDeviceSyncScheduledWake = null;
  }
  const selectedDeviceSyncFollowUpWake = selectHostedRuntimeWakeCandidate([
    localDeviceSyncScheduledWake,
    skippedDeviceSyncWake,
  ]);
  return selectedDeviceSyncFollowUpWake.at
    ? selectedDeviceSyncFollowUpWake
    : null;
}

function shouldDropStaleLocalDeviceSyncWakeForSkippedRetry(input: {
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  localDeviceSyncScheduledWake: HostedRuntimeWakeCandidate | null;
  skippedDeviceSyncWake: HostedRuntimeWakeCandidate;
}): boolean {
  if (input.skippedDeviceSyncWake.reason !== HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON) {
    return false;
  }

  const nowMs = resolveHostedAssistantPhaseNowMs(input.input);
  const skippedWakeMs = Date.parse(input.skippedDeviceSyncWake.at ?? "");
  if (!Number.isFinite(skippedWakeMs) || skippedWakeMs <= nowMs) {
    return false;
  }

  const localWakeAt = input.localDeviceSyncScheduledWake?.at ?? null;
  if (!localWakeAt) {
    return false;
  }

  const localWakeMs = Date.parse(localWakeAt);
  return !Number.isFinite(localWakeMs) || localWakeMs <= nowMs;
}

function shouldRescheduleSkippedDeviceSyncWake(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): boolean {
  return (
    !consumedScheduledWorkspaceWake(input)
    || hasFreshHostedConversationInput(input)
    || input.shouldYieldBackgroundMaintenance?.() === true
  );
}

async function writeHostedDeviceSyncFollowUpWakeProjectionModuleLoadFailureRuntimeLog(input: {
  error: unknown;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): Promise<void> {
  const failure = buildHostedRuntimeFailureDiagnostics(
    input.error,
    "Hosted device-sync follow-up wake projection failed to load the maintenance module.",
  );
  const moduleLoadErrorCode = isHostedDeviceSyncMaintenanceModuleLoadError(input.error)
    ? input.error.code
    : null;
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields({
        attemptId: input.input.request.attemptId,
        leaseGeneration: input.input.request.leaseGeneration,
        workspaceVersion: input.input.request.workspaceVersion,
      }),
      component: "device-sync",
      errorCode: moduleLoadErrorCode
        ? toHostedRuntimeLogCode(moduleLoadErrorCode)
        : failure.errorCode,
      eventCode: "device-sync.module_load_failed",
      level: "warn",
      phase: "invoke",
      redactedJson: {
        ...failure.redactedJson,
        errorMessagePresent: input.error instanceof Error
          ? input.error.message.length > 0
          : input.error !== null && input.error !== undefined,
        followUpWakeProjection: true,
        projectionPath: "follow-up-wake",
      },
    },
    platform: input.input.runtime.platform,
  });
}

async function resolveHostedLocalDeviceSyncScheduledWake(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): Promise<HostedRuntimeWakeCandidate | null> {
  if (!hasHostedDeviceSyncRuntimeConfigured(input)) {
    return null;
  }

  const {
    resolveHostedDeviceSyncNextWakeAt,
  } = await loadHostedDeviceSyncMaintenanceModule();
  const nextWakeAt = resolveHostedDeviceSyncNextWakeAt({
    deviceSyncConfig: input.runtime.resolvedConfig.deviceSync,
    platform: input.runtime.platform,
    vaultRoot: input.restored.vaultRoot,
  });
  if (!nextWakeAt) {
    return null;
  }

  return createHostedRuntimeWakeCandidate(
    nextWakeAt,
    HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
  );
}

async function writeHostedSystemMailboxRuntimeLog(input: {
  assistantAskCompletionFirstAttemptDelayed?: boolean;
  attemptCount: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  legacyUsageReferralAuthorityClassification: string | null;
  nextWakeAt: string | null;
  recorded: number | null;
  recordFailed: number | null;
  routeAction: string | null;
  status: "preempted" | "processed" | "recorded" | "recording" | "retryable_failed";
  wakeKind: string | null;
}): Promise<void> {
  const errorCode = toHostedRuntimeLogCode(input.errorCode);
  const safeErrorMessage = input.errorMessage
    ? sanitizeHostedExecutionStructuredLogText(input.errorMessage)
      ?? "Hosted system mailbox processing failed."
    : input.errorCode
      ? "Hosted system mailbox processing failed."
      : null;
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields({
        attemptId: input.input.request.attemptId,
        leaseGeneration: input.input.request.leaseGeneration,
        workspaceVersion: input.input.request.workspaceVersion,
      }),
      ...(input.errorCode ? { errorCode } : {}),
      component: "mailbox",
      eventCode: "mailbox.system_processed",
      level:
        input.assistantAskCompletionFirstAttemptDelayed === true
        || input.status === "retryable_failed"
        || (input.recordFailed ?? 0) > 0
          ? "warn"
          : "info",
      phase: "checkpoint",
      redactedJson: {
        attemptCount: input.attemptCount,
        assistantAskCompletionFirstAttemptDelayed:
          input.assistantAskCompletionFirstAttemptDelayed ?? false,
        errorCode: input.errorCode ? errorCode : null,
        legacyUsageReferralAuthorityClassification:
          input.legacyUsageReferralAuthorityClassification,
        nextWakeAtPresent: input.nextWakeAt !== null,
        recordFailed: input.recordFailed,
        recorded: input.recorded,
        routeAction: input.routeAction,
        ...(safeErrorMessage ? { safeErrorMessage } : {}),
        status: input.status,
        wakeKind: input.wakeKind,
      },
    },
    platform: input.input.platform,
  });
}

function wasHostedAssistantAskCompletionFirstAttemptDelayed(
  preparation: HostedSystemMailboxPreparation,
): boolean {
  if (
    !("item" in preparation)
    || preparation.item.routeAction !== "continue-assistant-ask"
    || preparation.item.wake.kind !== "assistant.ask.completed"
    || preparation.item.attemptCount !== 1
    || preparation.item.lastAttemptAt === null
  ) {
    return false;
  }

  const occurredAtMs = Date.parse(preparation.item.occurredAt);
  const attemptedAtMs = Date.parse(preparation.item.lastAttemptAt);
  return Number.isFinite(occurredAtMs)
    && Number.isFinite(attemptedAtMs)
    && attemptedAtMs - occurredAtMs
      >= HOSTED_ASSISTANT_ASK_COMPLETION_FIRST_ATTEMPT_ALERT_MS;
}

// Hot-path-safe: writeHostedRuntimeLogBestEffort queues info-level entries
// and returns synchronously, so foreground delivery is never blocked on the
// underlying log port write (invariant: "observability writes are never
// user latency", docs/contracts/00-invariants.md § Foreground Reply Critical
// Path).
function writeHostedAssistantTurnTimingRuntimeLog(input: {
  currentTurnDeliveryIntentCount?: number | null;
  elapsedMs: number;
  foregroundAssistantPass?: boolean | null;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  stage: HostedAssistantTurnTimingStage;
  stepElapsedMs?: number | null;
}): void {
  const redactedJson: HostedRuntimeRedactedJson = {
    currentTurnDeliveryIntentCount: input.currentTurnDeliveryIntentCount ?? null,
    detailLabel: "Hosted assistant turn timing milestone captured.",
    foregroundAssistantPass: input.foregroundAssistantPass ?? null,
    schema: HOSTED_ASSISTANT_TURN_TIMING_SCHEMA,
    type: HOSTED_ASSISTANT_TURN_TIMING_TYPE,
    turnTimingElapsedMs: input.elapsedMs,
    turnTimingStage: input.stage,
    ...(input.stepElapsedMs === undefined
      ? {}
      : { turnTimingStepElapsedMs: input.stepElapsedMs }),
  };

  void writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields({
        attemptId: input.input.request.attemptId,
        leaseGeneration: input.input.request.leaseGeneration,
        workspaceVersion: input.input.request.workspaceVersion,
      }),
      component: "assistant",
      eventCode: "assistant.automation_detail",
      level: "info",
      phase: "invoke",
      redactedJson,
    },
    platform: input.input.platform,
  });
}

async function writeHostedAssistantPassRuntimeLog(input: {
  assistantMetrics: Awaited<ReturnType<typeof runHostedAssistantAutomationLane>>;
  deliveryEffectCount: number;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  nextWakeAt: string | null;
  progressed: boolean;
  systemMailboxWakeAt: string | null;
}): Promise<void> {
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields({
        attemptId: input.input.request.attemptId,
        leaseGeneration: input.input.request.leaseGeneration,
        workspaceVersion: input.input.request.workspaceVersion,
      }),
      component: "assistant",
      eventCode: "assistant.pass_finished",
      level: "info",
      phase: "invoke",
      redactedJson: {
        automationLogCount: input.assistantMetrics.redactedLogEntries?.length ?? 0,
        assistantAutomationElapsedMs: input.assistantMetrics.assistantAutomationElapsedMs ?? null,
        assistantAutomationPassElapsedMs:
          input.assistantMetrics.assistantAutomationPassElapsedMs ?? null,
        assistantAutomationCronStatusDeferred:
          input.assistantMetrics.assistantAutomationCronStatusDeferred ?? null,
        assistantAutomationCronStatusElapsedMs:
          input.assistantMetrics.assistantAutomationCronStatusElapsedMs ?? null,
        assistantAutomationPostScanTailElapsedMs:
          input.assistantMetrics.assistantAutomationPostScanTailElapsedMs ?? null,
        assistantAutomationProgressed:
          input.assistantMetrics.assistantAutomationProgressed ?? null,
        assistantAutomationScanElapsedMs:
          input.assistantMetrics.assistantAutomationScanElapsedMs ?? null,
        assistantAutomationTotalElapsedMs:
          input.assistantMetrics.assistantAutomationTotalElapsedMs ?? null,
        assistantInputCandidateListed:
          input.assistantMetrics.assistantInputCandidateListed ?? null,
        assistantInputCandidateQueryCount:
          input.assistantMetrics.assistantInputCandidateQueryCount ?? null,
        deliveryEffectCount: input.deliveryEffectCount,
        deviceSyncElapsedMs: null,
        deviceSyncProcessed: 0,
        deviceSyncSkipped: true,
        deviceSyncDirtyAckPending: false,
        nextWakeAtPresent: input.nextWakeAt !== null,
        parserProcessed: 0,
        progressed: input.progressed,
        readinessElapsedMs: input.assistantMetrics.readinessElapsedMs ?? null,
        systemWakeAtPresent: input.systemMailboxWakeAt !== null,
        totalElapsedMs: input.assistantMetrics.totalElapsedMs ?? null,
      },
    },
    platform: input.input.platform,
  });
}

async function writeHostedAssistantAutomationDetailRuntimeLogs(input: {
  assistantMetrics: {
    redactedLogEntries?: HostedExecutionRedactedLogEntry[] | null;
  };
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): Promise<void> {
  const entries = input.assistantMetrics.redactedLogEntries ?? [];
  for (const [index, entry] of entries.entries()) {
    const redactedJson = buildHostedAssistantAutomationDetailRedactedJson(entry.redacted, {
      detailComponent: entry.component,
      detailEventIdPresent: entry.eventId !== undefined && entry.eventId !== null,
      detailIndex: index,
      detailLabel: entry.message,
      detailPhase: entry.phase,
    });
    const errorCode = resolveHostedAssistantAutomationDetailErrorCode(entry.redacted);
    await writeHostedRuntimeLogBestEffort({
      entry: {
        ...buildHostedRuntimeLogContextFields({
          attemptId: input.input.request.attemptId,
          leaseGeneration: input.input.request.leaseGeneration,
          workspaceVersion: input.input.request.workspaceVersion,
        }),
        component: "assistant",
        ...(errorCode ? { errorCode } : {}),
        eventCode: "assistant.automation_detail",
        level: entry.level,
        phase: "invoke",
        redactedJson,
      },
      platform: input.input.platform,
    });
  }
}

function readHostedAssistantAutomationFailureRedactedLogEntries(
  error: unknown,
): HostedExecutionRedactedLogEntry[] {
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return [];
  }

  const value = (error as {
    hostedAssistantAutomationRedactedLogEntries?: unknown;
  }).hostedAssistantAutomationRedactedLogEntries;
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isHostedExecutionRedactedLogEntry);
}

function isHostedExecutionRedactedLogEntry(
  value: unknown,
): value is HostedExecutionRedactedLogEntry {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { component?: unknown }).component === "string" &&
    typeof (value as { level?: unknown }).level === "string" &&
    typeof (value as { message?: unknown }).message === "string" &&
    typeof (value as { phase?: unknown }).phase === "string"
  );
}

function buildHostedAssistantAutomationDetailRedactedJson(
  redacted: Record<string, unknown> | null | undefined,
  detail: HostedRuntimeRedactedJson,
): HostedRuntimeRedactedJson {
  const output: HostedRuntimeRedactedJson = {};
  const input = redacted ?? {};
  const entries = Object.entries(input);

  for (const [key, value] of entries) {
    if (isAnchorHostedAssistantAutomationDetailKey(key)) {
      maybeCopyHostedAssistantAutomationDetailRedactedEntry(output, key, value);
    }
  }

  for (const [key, value] of entries) {
    if (
      !isAnchorHostedAssistantAutomationDetailKey(key)
      && isPreferredHostedAssistantAutomationDetailKey(key)
    ) {
      maybeCopyHostedAssistantAutomationDetailRedactedEntry(output, key, value);
    }
  }

  for (const [key, value] of entries) {
    if (!isPreferredHostedAssistantAutomationDetailKey(key)) {
      maybeCopyHostedAssistantAutomationDetailRedactedEntry(output, key, value);
    }
  }

  const combined: HostedRuntimeRedactedJson = {
    ...output,
    ...detail,
  };
  if (
    typeof combined.errorCode === "string"
    && typeof combined.safeErrorMessage !== "string"
  ) {
    combined.safeErrorMessage = typeof combined.detailLabel === "string"
      ? sanitizeHostedExecutionStructuredLogText(combined.detailLabel)
        ?? "Hosted assistant automation detail failed."
      : "Hosted assistant automation detail failed.";
  }

  return combined;
}

function isAnchorHostedAssistantAutomationDetailKey(key: string): boolean {
  return key === "errorCode"
    || key === "providerTraceKind"
    || key === "reasoningEffort"
    || key === "safeDetails"
    || key === "safeErrorLength"
    || key === "safeErrorMessage"
    || key === "safeErrorPresent"
    || key === "schema"
    || key === "type";
}

function isPreferredHostedAssistantAutomationDetailKey(key: string): boolean {
  return isAnchorHostedAssistantAutomationDetailKey(key)
    || key.startsWith("assistantNotification")
    || key.startsWith("codexInvalidOutput")
    || key.startsWith("codexResumeFailure")
    || key.startsWith("failure")
    || key.startsWith("routePlanning")
    || key.startsWith("turnTiming");
}

function maybeCopyHostedAssistantAutomationDetailRedactedEntry(
  output: HostedRuntimeRedactedJson,
  key: string,
  value: unknown,
): void {
  if (
    key in output
    || Object.keys(output).length >= HOSTED_ASSISTANT_AUTOMATION_DETAIL_MAX_KEYS
  ) {
    return;
  }

  const redactedValue = normalizeHostedRuntimeRedactedLogValue(key, value);
  if (redactedValue !== undefined) {
    output[key] = redactedValue;
  }
}

function resolveHostedAssistantAutomationDetailErrorCode(
  redacted: Record<string, unknown> | null | undefined,
): string | null {
  const candidate =
    readHostedRuntimeRedactedLogString(redacted, "assistantNotificationProviderErrorCode")
    ?? readHostedRuntimeRedactedLogString(redacted, "assistantNotificationErrorCodeDetail")
    ?? readHostedRuntimeRedactedLogString(redacted, "assistantNotificationErrorCode")
    ?? readHostedRuntimeRedactedLogString(redacted, "errorCode");

  return candidate ? toHostedRuntimeLogCode(candidate) : null;
}

function readHostedRuntimeRedactedLogString(
  redacted: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = redacted?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}

function normalizeHostedRuntimeRedactedLogValue(
  key: string,
  value: unknown,
): HostedRuntimeRedactedJson[string] | undefined {
  if (!isHostedRuntimeLogKeyAllowed(key)) {
    return undefined;
  }

  if (Array.isArray(value)) {
    if (key === "codexActionToolSummaries") {
      return normalizeHostedRuntimeRedactedLogObjectArray(key, value);
    }

    return normalizeHostedRuntimeRedactedLogArray(key, value);
  }

  return normalizeHostedRuntimeRedactedLogScalar(key, value);
}

function normalizeHostedRuntimeRedactedLogObjectArray(
  key: string,
  value: unknown[],
): HostedRuntimeRedactedJson[string] | undefined {
  if (value.length > 16) {
    return undefined;
  }

  const output = value.flatMap((entry) => {
    const normalized = normalizeHostedRuntimeRedactedLogObject(key, entry);
    return normalized === null ? [] : [normalized];
  });
  return output.length > 0 ? output : undefined;
}

function normalizeHostedRuntimeRedactedLogObject(
  parentKey: string,
  value: unknown,
): HostedRuntimeRedactedObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const entries = Object.entries(value);
  if (entries.length > 8) {
    return null;
  }

  const output: HostedRuntimeRedactedObject = {};
  for (const [key, entry] of entries) {
    const normalized = normalizeHostedRuntimeRedactedLogScalar(key, entry);
    if (normalized !== undefined) {
      output[key] = normalized;
    }
  }

  return Object.keys(output).length > 0 && isHostedRuntimeLogKeyAllowed(parentKey)
    ? output
    : null;
}

function normalizeHostedRuntimeRedactedLogArray(
  key: string,
  value: unknown[],
): HostedRuntimeRedactedJson[string] | undefined {
  if (value.length > 16) {
    return undefined;
  }

  const output = value.flatMap((entry) => {
    const normalized = normalizeHostedRuntimeRedactedLogScalar(key, entry);
    return normalized === undefined ? [] : [normalized];
  });
  return output.length > 0 ? output : undefined;
}

function normalizeHostedRuntimeRedactedLogScalar(
  key: string,
  value: unknown,
): HostedRuntimeRedactedScalar | undefined {
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  return redactHostedRuntimeLogString(key, value);
}

function redactHostedRuntimeLogString(key: string, value: string): string | undefined {
  if (isHostedRuntimeSecretValueKey(key) && !isHostedRuntimeErrorDescriptionKey(key)) {
    return "[redacted]";
  }

  const normalized = sanitizeHostedExecutionStructuredLogText(value);
  if (!normalized) {
    return undefined;
  }

  const redacted = normalized
    .replace(/<HOME_DIR>(?:\/[^\s)"']*)?/gu, "<REDACTED_PATH>")
    .replace(/file:\/\/[^\s)"']+/giu, "<REDACTED_PATH>")
    .replace(/\bhttps?:\/\/[^\s)"']+/giu, "<REDACTED_URL>")
    .replace(/(^|[\s(])\/[^\s)"']+/gu, "$1<REDACTED_PATH>")
    .replace(/[A-Za-z]:\\[^\s)"']+/gu, "<REDACTED_PATH>")
    .replace(
      /\b((?:authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|secret|token))\b\s*[:=]\s*(?:Bearer\s+|Basic\s+)?(?:\[[^\]]+\]|[^"',\s}]+)/giu,
      "$1 [redacted]",
    )
    .replace(/\b(Basic|Bearer)\s+(?!\[redacted\])[A-Za-z0-9._~+/=-]+\b/giu, "$1 [redacted]")
    .replace(/\+\d[\d().\s-]{7,}\d/gu, "[redacted-phone]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[redacted-email]")
    .replace(/\s+/gu, " ")
    .trim();
  if (redacted.length === 0) {
    return undefined;
  }

  const bounded = redacted.length <= HOSTED_RUNTIME_REDACTED_TEXT_MAX_LENGTH
    ? redacted
    : `${redacted.slice(0, HOSTED_RUNTIME_REDACTED_TEXT_MAX_LENGTH - 3).trimEnd()}...`;

  return isHostedRuntimeRedactedLogStringValue(bounded) ? bounded : undefined;
}

function isHostedRuntimeLogKeyAllowed(key: string): boolean {
  if (HOSTED_RUNTIME_ALLOWED_LOG_KEY_NAMES.has(key)) {
    return true;
  }

  const normalized = key.toLowerCase();
  return !HOSTED_RUNTIME_BLOCKED_LOG_KEY_PARTS.some((part) =>
    normalized.includes(part)
  );
}

function isHostedRuntimeSecretValueKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return HOSTED_RUNTIME_SECRET_VALUE_KEY_PARTS.some((part) => normalized.includes(part));
}

function isHostedRuntimeErrorDescriptionKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return HOSTED_RUNTIME_ERROR_DESCRIPTION_KEY_PARTS.some((part) =>
    normalized.includes(part)
  );
}

function isHostedRuntimeRedactedLogStringValue(value: string): boolean {
  return !(
    /\/Users\/|file:\/\/|[A-Za-z]:\\|<HOME_DIR>|(^|[\s(])\/[^\s)]+/u.test(value)
    || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(value)
    || /\bhttps?:\/\//iu.test(value)
    || /\+\d[\d().\s-]{7,}\d/u.test(value)
    || /(["']?(?:authorization|secret|token|password|cookie|set-cookie|api[-_]?key)["']?\s*[:=]\s*["']?)([^"',\s}]+)/iu
      .test(value)
    || /\b(Basic|Bearer)\s+[A-Z0-9._~+/=-]+\b/iu.test(value)
    || /\b(?:sk|pk|rk)_(?:live|test)_[A-Z0-9]+\b/iu.test(value)
    || /\bwhsec_[A-Z0-9]+\b/iu.test(value)
  );
}

async function writeHostedOutboxDeliveryRuntimeLog(input: {
  deliveryEffects: HostedAssistantDeliveryEffects;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  outcomes: HostedAssistantDeliveryOutcome[];
  postNextWakeAt: string | null;
}): Promise<void> {
  const statuses = input.outcomes.map((outcome) => outcome.deliveryStatus);
  const sent = input.outcomes.filter((outcome) => outcome.deliveryStatus === "sent").length;
  const retryable = input.outcomes.filter((outcome) => outcome.retryable).length;
  const failed = input.outcomes.filter((outcome) =>
    outcome.deliveryStatus === "failed"
      || outcome.deliveryStatus === "failed_ambiguous"
      || outcome.deliveryStatus === "missing-result"
      || outcome.deliveryStatus === "threw"
  ).length;
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields({
        attemptId: input.input.request.attemptId,
        leaseGeneration: input.input.request.leaseGeneration,
        workspaceVersion: input.input.request.workspaceVersion,
      }),
      component: "outbox",
      eventCode: "outbox.delivery_finished",
      level: failed > 0 || retryable > 0 ? "warn" : "info",
      phase: "outbox",
      redactedJson: {
        ...summarizeHostedRuntimeStatusCounts(statuses),
        attempted: input.outcomes.length,
        deliveryChannelSummary: summarizeHostedOutboxDeliveryCodes(
          input.outcomes.map((outcome) => outcome.deliveryChannel),
        ),
        deliveryErrorCodeSummary: summarizeHostedOutboxDeliveryErrorCodes(
          input.outcomes.map((outcome) => outcome.deliveryErrorCode),
        ),
        ...buildHostedOutboxDeliveryPayloadLogFields(input.deliveryEffects),
        ...buildHostedOutboxDeliveryErrorLogFields(input.outcomes),
        failed,
        journalStatusSummary: summarizeHostedOutboxDeliveryCodes(
          input.outcomes.map((outcome) => outcome.journalStatus),
        ),
        nextWakeAtPresent: input.postNextWakeAt !== null,
        providerMessageIdPresentCount: input.outcomes.filter((outcome) =>
          outcome.providerMessageId !== null
        ).length,
        providerThreadIdPresentCount: input.outcomes.filter((outcome) =>
          outcome.providerThreadId !== null
        ).length,
        retryable,
        sent,
        targetKindSummary: summarizeHostedOutboxDeliveryCodes(
          input.outcomes.map((outcome) => outcome.targetKind),
        ),
      },
    },
    platform: input.input.platform,
  });
}

function buildHostedOutboxDeliveryPayloadLogFields(
  effects: HostedAssistantDeliveryEffects,
): HostedRuntimeRedactedObject {
  const media = effects.flatMap((effect) => effect.payload.media);
  const imageMedia = media.filter((item) =>
    item.kind === "image" || item.kind === "vault_image"
  );
  const mediaCounts = effects.map((effect) => effect.payload.media.length);
  const messageLengths = effects.map((effect) => effect.payload.message.length);
  return {
    imageBearingIntentCount: effects.filter((effect) => effect.payload.media.some((item) =>
      item.kind === "image" || item.kind === "vault_image"
    )).length,
    imageMediaItemCount: imageMedia.length,
    maxMediaItemsPerIntent: Math.max(0, ...mediaCounts),
    maxMessageLength: Math.max(0, ...messageLengths),
    mediaItemCount: media.length,
    mediaKindSummary: summarizeHostedOutboxDeliveryCodes(
      media.map((item) => item.kind),
    ),
    privateImageMediaItemCount:
      imageMedia.filter((item) => item.kind === "vault_image").length,
    publicImageMediaItemCount:
      imageMedia.filter((item) => item.kind === "image").length,
    totalImageAltTextLength: imageMedia.reduce(
      (total, item) => total + (item.alt?.length ?? 0),
      0,
    ),
    totalMessageLength: messageLengths.reduce((total, length) => total + length, 0),
    vaultFileMediaItemCount: media.filter((item) => item.kind === "vault_file").length,
    voiceMemoMediaItemCount: media.filter((item) => item.kind === "voice_memo").length,
  };
}

function summarizeHostedOutboxDeliveryCodes(values: readonly (string | null)[]): string {
  const summary = summarizeHostedRuntimeStatusCounts(
    values.map((value) => toHostedRuntimeLogCode(value ?? "none")),
  ).statusSummary;
  return typeof summary === "string" ? summary : "";
}

function summarizeHostedOutboxDeliveryErrorCodes(values: readonly (string | null)[]): string {
  const summary = summarizeHostedRuntimeStatusCounts(
    values.map(normalizeHostedOutboxDeliveryErrorCode),
  ).statusSummary;
  return typeof summary === "string" ? summary : "";
}

function normalizeHostedOutboxDeliveryErrorCode(value: string | null): string {
  if (!value) {
    return "none";
  }
  const safe = sanitizeHostedExecutionStructuredLogText(value);
  return toHostedRuntimeLogCode(safe);
}

function buildHostedOutboxDeliveryErrorLogFields(
  outcomes: readonly HostedAssistantDeliveryOutcome[],
): HostedRuntimeRedactedJson {
  const deliveryErrorSummaries = outcomes
    .filter(hostedOutboxDeliveryOutcomeNeedsErrorLog)
    .map(buildHostedOutboxDeliveryErrorSummary)
    .slice(0, HOSTED_OUTBOX_DELIVERY_ERROR_LOG_LIMIT);

  return deliveryErrorSummaries.length > 0
    ? { deliveryErrorSummaries }
    : {};
}

function hostedOutboxDeliveryOutcomeNeedsErrorLog(
  outcome: HostedAssistantDeliveryOutcome,
): boolean {
  return outcome.deliveryStatus !== "sent"
    || outcome.deliveryErrorCode !== null
    || outcome.deliveryErrorMessage !== null
    || outcome.deliveryErrorDetails != null;
}

function buildHostedOutboxDeliveryErrorSummary(
  outcome: HostedAssistantDeliveryOutcome,
): HostedRuntimeRedactedObject {
  return {
    deliveryChannel: toHostedRuntimeLogCode(outcome.deliveryChannel ?? "none"),
    deliveryStatus: toHostedRuntimeLogCode(outcome.deliveryStatus),
    deliveryErrorCode: normalizeHostedOutboxDeliveryErrorCode(outcome.deliveryErrorCode),
    deliveryErrorMessage: normalizeHostedOutboxDeliveryErrorMessage(
      outcome.deliveryErrorMessage,
    ) ?? "none",
    journalStatus: toHostedRuntimeLogCode(outcome.journalStatus ?? "none"),
    retryable: outcome.retryable,
    targetKind: toHostedRuntimeLogCode(outcome.targetKind ?? "none"),
    ...buildHostedOutboxDeliveryErrorDetailSummary(outcome.deliveryErrorDetails),
  };
}

function normalizeHostedOutboxDeliveryErrorMessage(
  value: string | null,
): string | null {
  if (!value) {
    return null;
  }

  return redactHostedRuntimeLogString("deliveryErrorMessage", value) ?? "redacted";
}

function buildHostedOutboxDeliveryErrorDetailSummary(
  details: HostedAssistantDeliveryOutcome["deliveryErrorDetails"],
): HostedRuntimeRedactedObject {
  const sanitizedDetails = normalizeHostedOutboxDeliveryErrorDetails(details);
  if (!sanitizedDetails) {
    return {};
  }

  const output: HostedRuntimeRedactedObject = {};
  appendHostedOutboxDeliveryErrorDetail(output, "Status", readFirstHostedOutboxDeliveryErrorDetail(
    sanitizedDetails,
    ["status", "statusCode", "responseStatus", "errorStatus"],
  ));
  appendHostedOutboxDeliveryErrorDetail(output, "ProviderCode", readFirstHostedOutboxDeliveryErrorDetail(
    sanitizedDetails,
    ["errorCode", "errorCodeDetail", "providerErrorCode"],
  ));
  appendHostedOutboxDeliveryErrorDetail(output, "Operation", readFirstHostedOutboxDeliveryErrorDetail(
    sanitizedDetails,
    ["operation", "action"],
  ));
  appendHostedOutboxDeliveryErrorDetail(output, "FailureStage", sanitizedDetails.failureStage);
  appendHostedOutboxDeliveryErrorDetail(output, "Method", sanitizedDetails.method);
  appendHostedOutboxDeliveryErrorDetail(
    output,
    "RequestSummary",
    buildHostedOutboxDeliveryDiagnosticSummary(sanitizedDetails, [
      ["messageLength", "requestMessageLength"],
      ["partCount", "requestMessagePartCount"],
      ["textPartCount", "requestTextPartCount"],
      ["mediaPartCount", "requestMediaPartCount"],
      ["publicUrlMediaPartCount", "requestPublicUrlMediaPartCount"],
      ["attachmentMediaPartCount", "requestAttachmentMediaPartCount"],
      ["bodyShape", "requestBodyShape"],
    ]),
  );
  appendHostedOutboxDeliveryErrorDetail(
    output,
    "ResponseSummary",
    buildHostedOutboxDeliveryDiagnosticSummary(sanitizedDetails, [
      ["kind", "responseBodyKind"],
      ["textLength", "responseBodyTextLength"],
      ["keyCount", "responseBodyKeyCount"],
      ["keySummary", "responseBodyKeySummary"],
      ["stringFieldCount", "responseBodyStringFieldCount"],
      ["stringFieldSummary", "responseBodyStringFieldSummary"],
    ]),
  );
  appendHostedOutboxDeliveryErrorDetail(
    output,
    "ProviderRequestId",
    sanitizedDetails.providerRequestId,
  );
  appendHostedOutboxDeliveryErrorDetail(
    output,
    "ResponseSignature",
    sanitizedDetails.responseBodySha256,
  );
  appendHostedOutboxDeliveryErrorDetail(
    output,
    "TransportErrorName",
    sanitizedDetails.transportErrorName,
  );
  appendHostedOutboxDeliveryErrorDetail(output, "TimedOut", sanitizedDetails.timedOut);
  appendHostedOutboxDeliveryErrorDetail(output, "Description", readFirstHostedOutboxDeliveryErrorDetail(
    sanitizedDetails,
    ["description", "errorDetail", "safeErrorMessage"],
  ));
  appendHostedOutboxDeliveryErrorDetail(output, "ErrorName", readFirstHostedOutboxDeliveryErrorDetail(
    sanitizedDetails,
    ["name", "errorName"],
  ));
  appendHostedOutboxDeliveryErrorDetail(output, "Target", readFirstHostedOutboxDeliveryErrorDetail(
    sanitizedDetails,
    ["target", "targetLabel"],
  ));
  appendHostedOutboxDeliveryErrorDetail(output, "Cause", readFirstHostedOutboxDeliveryErrorDetail(
    sanitizedDetails,
    ["errorCause", "cause"],
  ));
  appendHostedOutboxDeliveryErrorDetail(output, "Retryable", sanitizedDetails.retryable);
  if (Object.keys(output).length < 9) {
    output.deliveryErrorDetailFieldCount = Object.keys(sanitizedDetails).length;
  }
  return output;
}

function buildHostedOutboxDeliveryDiagnosticSummary(
  details: Record<string, HostedRuntimeRedactedScalar>,
  fields: readonly (readonly [label: string, key: string])[],
): string | undefined {
  const summary: Record<string, HostedRuntimeRedactedScalar> = {};
  for (const [label, key] of fields) {
    const value = details[key];
    if (value === undefined) {
      continue;
    }
    const normalized = normalizeHostedOutboxDeliveryErrorDetail(value);
    if (normalized !== null) {
      summary[label] = normalized;
    }
  }
  return Object.keys(summary).length > 0 ? JSON.stringify(summary) : undefined;
}

function normalizeHostedOutboxDeliveryErrorDetails(
  details: HostedAssistantDeliveryOutcome["deliveryErrorDetails"],
): Record<string, HostedRuntimeRedactedScalar> | null {
  if (!details) {
    return null;
  }

  const sanitized = sanitizeHostedExecutionStructuredLogDetails(
    details as HostedExecutionStructuredLogDetails,
  );
  if (!sanitized) {
    return null;
  }

  const output: Record<string, HostedRuntimeRedactedScalar> = {};
  for (const [key, value] of Object.entries(sanitized)) {
    if (
      value === null
      || typeof value === "boolean"
      || typeof value === "number"
      || typeof value === "string"
    ) {
      output[key] = value;
    }
  }

  return Object.keys(output).length > 0 ? output : null;
}

function appendHostedOutboxDeliveryErrorDetail(
  output: HostedRuntimeRedactedObject,
  suffix: string,
  value: HostedRuntimeRedactedScalar | undefined,
): void {
  // A delivery summary always has seven base fields. Keep details to nine so
  // every summary satisfies the hosted runtime parser's 16-key object bound.
  if (value === undefined || Object.keys(output).length >= 9) {
    return;
  }

  const normalized = normalizeHostedOutboxDeliveryErrorDetail(value);
  if (normalized === null) {
    return;
  }

  output[`deliveryErrorDetail${suffix}`] = normalized;
}

function readFirstHostedOutboxDeliveryErrorDetail(
  details: Record<string, HostedRuntimeRedactedScalar>,
  keys: readonly string[],
): HostedRuntimeRedactedScalar | undefined {
  for (const key of keys) {
    if (key in details) {
      return details[key];
    }
  }
  return undefined;
}

function normalizeHostedOutboxDeliveryErrorDetail(
  value: HostedRuntimeRedactedScalar,
): HostedRuntimeRedactedScalar | null {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }

  return redactHostedRuntimeLogString("deliveryErrorDetail", value) ?? null;
}

function consumedScheduledWorkspaceWake(input: HostedWorkspaceRuntimeAssistantPhaseInput): boolean {
  if (hasFreshHostedMailboxInput(input) && !hasFreshHostedConversationInput(input)) {
    return false;
  }
  if (!input.workspace?.nextWakeAt) {
    return false;
  }

  const wakeTime = Date.parse(input.workspace.nextWakeAt);
  return Number.isFinite(wakeTime) && wakeTime <= resolveHostedAssistantPhaseNowMs(input);
}

function hostedAssistantWakeStateProgressed(input: {
  assistantMetrics: Awaited<ReturnType<typeof runHostedAssistantAutomationLane>>;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  nextWakeAt: string | null;
  skippedDeviceSyncWakeAt: string | null;
}): boolean {
  if (input.skippedDeviceSyncWakeAt !== null) {
    const existingWakeAt = input.input.workspace?.nextWakeAt ?? null;
    return (
      hasFreshHostedConversationInput(input.input)
      || input.assistantMetrics.activeTurnInputIngested === true
      || input.skippedDeviceSyncWakeAt !== existingWakeAt
    );
  }

  const existingWakeAt = input.input.workspace?.nextWakeAt ?? null;
  if (input.nextWakeAt === existingWakeAt) {
    return false;
  }

  if (!consumedScheduledWorkspaceWake(input.input)) {
    return (
      input.nextWakeAt !== null
      && !hasFreshHostedConversationInput(input.input)
      && input.assistantMetrics.activeTurnInputIngested !== true
    );
  }

  if (isDueHostedDeviceSyncRecoveryAlarm(input.input)) {
    return true;
  }

  return (
    input.nextWakeAt !== null
    || hasFreshHostedConversationInput(input.input)
    || input.assistantMetrics.activeTurnInputIngested === true
  );
}

function resolveHostedWorkspaceDeviceConnectProviders(
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "resolvedConfig">,
): Array<{ label: string; provider: string }> {
  const providerConfigs = runtime.resolvedConfig.deviceSync?.providerConfigs ?? null;
  if (!providerConfigs) {
    return [];
  }

  return listConfiguredDeviceSyncConnectTargets(providerConfigs)
    .filter((target) =>
      isDeviceConnectSourceAvailableForConnection(target.connectSourceId)
    )
    .map((target) => ({
      label: target.label,
      provider: target.connectTarget,
    }));
}

function resolveHostedWorkspaceDeviceReconnectTargets(
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "resolvedConfig">,
): HostedDeviceSyncStatusPromptReconnectTarget[] {
  const providerConfigs = runtime.resolvedConfig.deviceSync?.providerConfigs ?? null;
  if (!providerConfigs) {
    return [];
  }

  const targets = listConfiguredDeviceSyncReconnectTargets(providerConfigs);
  const publicTargetsByConnectTarget = new Map(
    listConfiguredDeviceSyncConnectTargets(providerConfigs)
      .filter((target) =>
        isDeviceConnectSourceAvailableForConnection(target.connectSourceId)
      )
      .map((target) => [
        target.connectTarget,
        target,
      ]),
  );
  const connectTargetCounts = new Map<string, number>();
  for (const target of targets) {
    connectTargetCounts.set(
      target.connectTarget,
      (connectTargetCounts.get(target.connectTarget) ?? 0) + 1,
    );
  }

  return targets.map((target) => ({
    connectionAvailable: isDeviceConnectSourceAvailableForConnection(
      target.connectSourceId,
    ),
    connectTarget: target.connectTarget,
    connectTargetAmbiguous: (connectTargetCounts.get(target.connectTarget) ?? 0) > 1,
    connectTargetCommandSafe: sameHostedDeviceSyncConnectTarget(
      target,
      publicTargetsByConnectTarget.get(target.connectTarget) ?? null,
    ),
    label: target.label,
    provider: target.provider,
    ...(target.sourceProviderSlug
      ? { sourceProviderSlug: target.sourceProviderSlug }
      : {}),
  }));
}

type HostedDeviceSyncConnectTarget = ReturnType<
  typeof listConfiguredDeviceSyncConnectTargets
>[number];

function sameHostedDeviceSyncConnectTarget(
  left: HostedDeviceSyncConnectTarget,
  right: HostedDeviceSyncConnectTarget | null,
): boolean {
  if (!right) {
    return false;
  }

  return normalizeHostedDeviceSyncConnectTargetKey(left.provider)
      === normalizeHostedDeviceSyncConnectTargetKey(right.provider)
    && normalizeHostedDeviceSyncConnectTargetKey(left.sourceProviderSlug)
      === normalizeHostedDeviceSyncConnectTargetKey(right.sourceProviderSlug);
}

function normalizeHostedDeviceSyncConnectTargetKey(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9_]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  return normalized ? normalized : null;
}

async function hasDueHostedAssistantCronJob(
  input: HostedWorkspaceRuntimeAssistantPhaseInput,
): Promise<boolean> {
  const cronStatus = await getAssistantCronStatus(
    input.restored.vaultRoot,
    buildHostedAssistantCronStatusOptions(input),
  )
    .catch(() => null);
  return (cronStatus?.dueJobs ?? 0) > 0;
}

function buildHostedAssistantCronStatusOptions(
  phaseInput: HostedWorkspaceRuntimeAssistantPhaseInput,
): AssistantCronStatusOptions {
  return {
    shouldYieldBackgroundMaintenance:
      phaseInput.shouldYieldBackgroundMaintenance ?? null,
    turnEnvironment: createHostedAssistantTurnEnvironment({
      operatorHomeRoot: phaseInput.restored.operatorHomeRoot,
      runtimeEnv: phaseInput.runtimeEnv,
      vaultRoot: phaseInput.restored.vaultRoot,
    }),
  };
}

type HostedAssistantDeviceTool = NonNullable<
  NonNullable<AssistantExecutionContext["hosted"]>["deviceTool"]
>;

function resolveHostedWorkspaceDeviceTool(input: {
  deviceConnectProviders: readonly { label: string; provider: string }[];
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): HostedAssistantDeviceTool | undefined {
  const deviceSyncPort = input.input.runtime.platform.deviceSyncPort ?? null;
  if (!deviceSyncPort) {
    return undefined;
  }

  return {
    async request(request, context) {
      context?.signal?.throwIfAborted();
      if (request.action === "list_accounts") {
        const provider = normalizeAssistantRouteString(request.provider);
        const sourceProvider = normalizeAssistantRouteString(request.sourceProvider);
        const snapshot = await fetchCompleteHostedDeviceSyncRuntimeSnapshot({
          deviceSyncPort,
          includeCredentialMaterial: false,
          ...(provider ? { provider } : {}),
          signal: context?.signal ?? null,
          ...(sourceProvider ? { sourceProviderSlug: sourceProvider } : {}),
        });
        return {
          accounts: snapshot.connections.map(({ connection, localState }) => ({
            accountId: connection.id,
            displayName: connection.displayName,
            lastErrorCode: localState.lastErrorCode,
            lastSyncCompletedAt: localState.lastSyncCompletedAt,
            provider: connection.provider,
            status: connection.status,
          })),
          action: request.action,
          provider,
          sourceProvider,
        };
      }

      if (request.action === "reconcile") {
        if (!deviceSyncPort.reconcileAccount) {
          throw new VaultCliError(
            "device_reconcile_unavailable",
            "Device account reconciliation is not available right now.",
          );
        }
        const result = await deviceSyncPort.reconcileAccount({
          connectionId: request.accountId,
          signal: context?.signal ?? null,
        });
        return {
          accountId: result.connectionId,
          action: request.action,
          occurredAt: result.occurredAt,
          status: result.status,
        };
      }

      const provider = resolveHostedDeviceToolConnectProvider({
        configuredProviders: input.deviceConnectProviders,
        requestedProvider: request.provider,
      });
      const messagingReturnTarget = input.input.deviceSyncMessagingReturnTarget ?? null;
      await writeHostedDeviceConnectRuntimeLog({
        deviceConnectProviders: input.deviceConnectProviders,
        input: input.input,
        issueLinkAvailable: true,
        messagingReturnTarget,
        provider,
        stage: "request",
        status: "requested",
      });

      try {
        const result = await deviceSyncPort.createConnectLink({
          connectTarget: provider,
          ...(messagingReturnTarget ? { messagingReturnTarget } : {}),
        });
        await writeHostedDeviceConnectRuntimeLog({
          deviceConnectProviders: input.deviceConnectProviders,
          expiresAtPresent: Boolean(result.expiresAt),
          input: input.input,
          issueLinkAvailable: true,
          messagingReturnTarget,
          provider: result.provider,
          stage: "request",
          status: "issued",
        });
        return {
          action: request.action,
          link: result,
        };
      } catch (error) {
        await writeHostedDeviceConnectRuntimeLog({
          deviceConnectProviders: input.deviceConnectProviders,
          error,
          input: input.input,
          issueLinkAvailable: true,
          messagingReturnTarget,
          provider,
          stage: "request",
          status: "failed",
        });
        throw error;
      }
    },
  };
}

function resolveHostedDeviceToolConnectProvider(input: {
  configuredProviders: readonly { provider: string }[];
  requestedProvider: string;
}): string {
  const requestedKey = normalizeHostedDeviceSyncConnectTargetKey(
    input.requestedProvider,
  );
  const target = input.configuredProviders.find(
    ({ provider }) =>
      normalizeHostedDeviceSyncConnectTargetKey(provider) === requestedKey,
  );
  if (!target) {
    throw new VaultCliError(
      "device_connect_provider_unavailable",
      "That device provider is not available to connect.",
    );
  }
  return target.provider;
}

function resolveHostedClinicalRecordsConnectLinkTool(
  port: HostedWorkspaceRuntimeAssistantPhaseInput["runtime"]["platform"]["clinicalRecordsPort"],
): NonNullable<AssistantExecutionContext["hosted"]>["clinicalRecordsConnectLinkTool"] | undefined {
  const createConnectLink = port?.createConnectLink?.bind(port);
  if (!createConnectLink) {
    return undefined;
  }

  return { createConnectLink };
}

function shouldWriteHostedDeviceConnectContextLog(input: {
  deviceConnectProviders: readonly { label: string; provider: string }[];
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): boolean {
  return input.deviceConnectProviders.length > 0
    || input.input.runtime.platform.deviceSyncPort != null
    || input.input.runtime.resolvedConfig.deviceSync !== null;
}

async function writeHostedDeviceConnectRuntimeLog(input: {
  deviceConnectProviders: readonly { label: string; provider: string }[];
  error?: unknown;
  expiresAtPresent?: boolean;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  issueLinkAvailable: boolean;
  messagingReturnTarget?: string | null;
  provider?: string | null;
  stage: "context" | "request";
  status: "available" | "failed" | "issued" | "requested" | "unavailable";
}): Promise<void> {
  const failure = input.error === undefined
    ? null
    : buildHostedRuntimeFailureDiagnostics(
        input.error,
        "Hosted device connect request failed.",
      );
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields({
        attemptId: input.input.request.attemptId,
        leaseGeneration: input.input.request.leaseGeneration,
        workspaceVersion: input.input.request.workspaceVersion,
      }),
      ...(failure ? { errorCode: failure.errorCode } : {}),
      component: "assistant",
      eventCode: "assistant.device_connect",
      level: input.status === "failed" ? "warn" : "info",
      phase: "invoke",
      redactedJson: {
        deviceConnectIssueLinkAvailable: input.issueLinkAvailable,
        deviceConnectPortPresent: input.input.runtime.platform.deviceSyncPort != null,
        deviceConnectProviderCount: input.deviceConnectProviders.length,
        deviceConnectProviders: input.deviceConnectProviders
          .map((provider) => toHostedRuntimeLogCode(provider.provider))
          .filter((provider) => provider !== "unclassified")
          .slice(0, 16),
        deviceConnectStage: input.stage,
        deviceConnectStatus: input.status,
        ...(failure ? failure.redactedJson : {}),
        ...(input.error === undefined
          ? {}
          : { errorStatus: readHostedDeviceConnectErrorStatus(input.error) }),
        ...(input.expiresAtPresent === undefined
          ? {}
          : { expiresAtPresent: input.expiresAtPresent }),
        ...(input.messagingReturnTarget
          ? { deviceConnectReturnTarget: toHostedRuntimeLogCode(input.messagingReturnTarget) }
          : {}),
        ...(input.provider
          ? { provider: toHostedRuntimeLogCode(input.provider) }
          : {}),
      },
    },
    platform: input.input.platform,
  });
}

function buildHostedRuntimeFailureDiagnostics(
  error: unknown,
  fallbackMessage: string,
  options: { includeSafeIdentity?: boolean } = {},
): {
  errorCode: string;
  redactedJson: HostedRuntimeRedactedJson;
} {
  const diagnostics = buildHostedExecutionSafeErrorDiagnostics(error);
  const diagnosticErrorCode = typeof diagnostics?.errorCode === "string"
    ? diagnostics.errorCode
    : null;
  const diagnosticErrorMessage = typeof diagnostics?.errorMessage === "string"
    ? diagnostics.errorMessage
    : null;
  const errorCode = toHostedRuntimeLogCode(
    diagnosticErrorCode ?? deriveHostedExecutionErrorCode(error),
  );
  const safeErrorMessage = sanitizeHostedExecutionStructuredLogText(
    diagnosticErrorMessage ?? fallbackMessage,
  ) ?? fallbackMessage;
  const redactedJson: HostedRuntimeRedactedJson = {
    errorCode,
    ...(options.includeSafeIdentity === true
      && typeof diagnostics?.errorName === "string"
      ? { errorName: diagnostics.errorName }
      : {}),
    ...(options.includeSafeIdentity === true
      && typeof diagnostics?.errorStatus === "number"
      ? { errorStatus: diagnostics.errorStatus }
      : {}),
    ...(options.includeSafeIdentity === true
      && typeof diagnostics?.errorCodeDetail === "string"
      ? {
          errorCodeDetail: toHostedRuntimeLogCode(diagnostics.errorCodeDetail),
        }
      : {}),
    ...(options.includeSafeIdentity === true
      ? { errorDetailPresent: typeof diagnostics?.errorDetail === "string" }
      : {}),
    safeErrorMessage,
  };

  return {
    errorCode,
    redactedJson,
  };
}

function readHostedDeviceConnectErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  for (const property of ["status", "statusCode", "responseStatus"] as const) {
    const value = Reflect.get(error, property);
    if (
      typeof value === "number"
      && Number.isInteger(value)
      && value >= 100
      && value <= 599
    ) {
      return value;
    }
  }

  return null;
}

function assistantMetricsProgressed(
  metrics: Awaited<ReturnType<typeof runHostedAssistantAutomationLane>>,
  deliveryEffectCount: number,
): boolean {
  return (
    deliveryEffectCount > 0
    || metrics.assistantAutomationProgressed === true
  );
}

function resolveHostedAssistantAutomationNextWakeReason(input: {
  assistantNextWakeAt: string | null;
  assistantOutboxOnlyNextWakeAt: string | null;
}): string | null {
  return input.assistantNextWakeAt !== null
    && input.assistantNextWakeAt === input.assistantOutboxOnlyNextWakeAt
    ? HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON
    : null;
}

function shouldResolveHostedAssistantCronWakeAfterAssistantPass(input: {
  assistantMetrics: Awaited<ReturnType<typeof runHostedAssistantAutomationLane>>;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): boolean {
  if (input.assistantMetrics.assistantAutomationProgressed === true) {
    return true;
  }

  const nextWakeAt = input.assistantMetrics.nextWakeAt ?? null;
  if (!nextWakeAt) {
    return false;
  }

  const nextWakeTimeMs = Date.parse(nextWakeAt);
  return Number.isFinite(nextWakeTimeMs)
    && nextWakeTimeMs <= resolveHostedAssistantPhaseNowMs(input.input);
}

function shouldExposeHostedAssistantPhaseNextWakeReason(reason: string | null | undefined): boolean {
  return reason === HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON
    || reason === HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON;
}

function assistantMetricsCanonicalRuntimeProgressed(
  metrics: Awaited<ReturnType<typeof runHostedAssistantAutomationLane>>,
): boolean {
  return metrics.assistantAutomationProgressed === true;
}

function resolveHostedAssistantTimerCheckpointReason(input: {
  assistantMetrics: Awaited<ReturnType<typeof runHostedAssistantAutomationLane>>;
  providerCleanupDue: boolean;
  terminalLinqCleanupDue: boolean;
  wakeStateProgressed: boolean;
}): HostedWorkspaceCheckpointReason {
  if (
    assistantMetricsCanonicalRuntimeProgressed(input.assistantMetrics)
    || input.wakeStateProgressed
  ) {
    return "canonical_runtime_commit";
  }
  if (input.providerCleanupDue || input.terminalLinqCleanupDue) {
    return "provider_cleanup";
  }
  return "canonical_runtime_commit";
}

function resolveHostedSystemMailboxCheckpointReason(input: {
  shouldRecordSystemMailbox: boolean;
  systemMailboxDeliveryEffectCount: number;
  systemMailboxPreparation: NonNullable<
    Awaited<ReturnType<typeof prepareHostedSystemMailboxItemForCheckpoint>>
  >;
}): HostedWorkspaceCheckpointReason {
  if (input.systemMailboxPreparation.status === "retryable_failed") {
    return "system_mailbox_receipt";
  }
  if (!input.shouldRecordSystemMailbox) {
    return "canonical_runtime_commit";
  }
  if (input.systemMailboxDeliveryEffectCount > 0) {
    return "outbox_sending";
  }
  if (
    "metrics" in input.systemMailboxPreparation
    && input.systemMailboxPreparation.metrics.bootstrapResult !== null
  ) {
    return "activation_bootstrap";
  }
  return "system_mailbox_receipt";
}

function shouldCollectSystemMailboxDeliveryEffects(input: {
  preparation: HostedSystemMailboxCheckpointPreparation;
  shouldYieldAfterSystemMailboxPreparation: boolean;
}): boolean {
  if (
    input.preparation.status !== "processed"
    && !isForegroundCausalSystemMailboxPreparation(input.preparation)
  ) {
    return false;
  }
  if (
    input.shouldYieldAfterSystemMailboxPreparation
    && !isForegroundCausalSystemMailboxPreparation(input.preparation)
  ) {
    return false;
  }

  const item = input.preparation.item;
  if (
    item.routeAction === "dispatch-assistant-notification"
    || item.routeAction === "continue-assistant-ask"
  ) {
    return true;
  }

  if (item.routeAction === "apply-runtime-control-request") {
    return item.wake.kind === "runtime.pending-effects-reconcile-requested";
  }

  return item.routeAction === "apply-member-activation"
    && item.wake.kind === "member.activated"
    && item.wake.signupWelcome != null;
}

function resolveHostedSystemMailboxPreferredEffectIds(
  preparation: HostedSystemMailboxCheckpointPreparation,
): readonly string[] {
  if (!isCausalPendingEffectsReconciliation(preparation)) {
    return [];
  }
  return [preparation.item.wake.effectId];
}

function resolveHostedSystemMailboxPreferredIntentIds(
  preparation: HostedSystemMailboxCheckpointPreparation,
): readonly string[] {
  if (!("metrics" in preparation)) {
    return [];
  }

  return preparation.metrics.deliveryIntentIds ?? [];
}

function shouldFastDispatchAssistantDeliveryEffects(input: {
  assistantMetrics: Awaited<ReturnType<typeof runHostedAssistantAutomationLane>>;
  deliveryEffects: HostedAssistantDeliveryEffects;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
}): boolean {
  return (
    (
      !consumedScheduledWorkspaceWake(input.input)
      || hasFreshHostedConversationInput(input.input)
      || input.assistantMetrics.activeTurnInputIngested === true
    )
    && input.deliveryEffects.length > 0
    && input.deliveryEffects.every((effect) => effect.payload.transportIdempotent === true)
  );
}

function resolveHostedFastDispatchBaseNextWake(input: {
  assistantMetrics: Awaited<ReturnType<typeof runHostedAssistantAutomationLane>>;
  foregroundCronReconciliationWake?: HostedRuntimeWakeCandidate | null;
  foregroundWorkspaceWake?: HostedRuntimeWakeCandidate | null;
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  skippedDeviceSyncWake: HostedRuntimeWakeCandidate | null;
  systemMailboxWake: HostedRuntimeWakeCandidate | null;
  systemMailboxWakeAt: string | null;
}): HostedRuntimeWakeCandidate {
  const skippedDeviceSyncWake = shouldDropHostedFastDispatchSkippedDeviceSyncRetry(input)
    ? null
    : input.skippedDeviceSyncWake;
  const assistantNextWakeAt = resolveHostedAssistantAutomationNextWakeAt({
    input: input.input,
    nextWakeAt: input.assistantMetrics.nextWakeAt,
  });
  const assistantNextWakeReason = resolveHostedAssistantAutomationNextWakeReason({
    assistantNextWakeAt,
    assistantOutboxOnlyNextWakeAt:
      input.assistantMetrics.assistantAutomationOutboxOnlyNextWakeAt ?? null,
  });
  return selectHostedRuntimeWakeCandidate([
    createHostedRuntimeWakeCandidate(assistantNextWakeAt, assistantNextWakeReason),
    input.foregroundCronReconciliationWake ?? null,
    input.foregroundWorkspaceWake ?? null,
    skippedDeviceSyncWake,
    input.systemMailboxWake,
  ]);
}

function shouldDropHostedFastDispatchSkippedDeviceSyncRetry(input: {
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  skippedDeviceSyncWake: HostedRuntimeWakeCandidate | null;
}): boolean {
  if (!input.skippedDeviceSyncWake?.at) {
    return false;
  }
  if (input.skippedDeviceSyncWake.reason === HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON) {
    return false;
  }

  const existingWakeAt = input.input.workspace?.nextWakeAt ?? null;
  if (!existingWakeAt) {
    return false;
  }

  const existingWakeReason = input.input.workspace?.nextWakeReason ?? null;
  if (existingWakeReason !== "assistant" && existingWakeReason !== null) {
    return false;
  }

  const existingWakeTime = Date.parse(existingWakeAt);
  return (
    Number.isFinite(existingWakeTime)
    && existingWakeTime <= resolveHostedAssistantPhaseNowMs(input.input)
    && shouldRescheduleSkippedDeviceSyncWake(input.input)
  );
}

function resolveHostedAssistantAutomationNextWakeAt(input: {
  input: HostedWorkspaceRuntimeAssistantPhaseInput;
  nextWakeAt: string | null;
}): string | null {
  return normalizeHostedFutureWakeAt(
    input.nextWakeAt,
    resolveHostedAssistantPhaseNowMs(input.input),
  );
}

function buildHostedWorkspaceAssistantPhaseRedactedStatus(input: {
  deliveryEffectCount: number;
  nextWakeAt: string | null;
  outboxTerminalizedSendingCount: number;
  progressed: boolean;
  systemMailboxPrepared: number;
  systemMailboxRetryableFailed: number;
}): HostedRuntimeRedactedJson {
  return {
    hostedAssistantNextWakeAt: input.nextWakeAt,
    hostedAssistantProgressed: input.progressed,
    hostedOutboxPendingDeliveryEffects: input.deliveryEffectCount,
    hostedOutboxTerminalizedSending: input.outboxTerminalizedSendingCount,
    hostedSystemMailboxPrepared: input.systemMailboxPrepared,
    hostedSystemMailboxRetryableFailed: input.systemMailboxRetryableFailed,
  };
}

function elapsedSince(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}
