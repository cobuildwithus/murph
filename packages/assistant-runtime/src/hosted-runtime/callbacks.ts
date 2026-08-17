import { createHash } from "node:crypto";

import type {
  HostedExecutionAssistantNotificationRoute,
  HostedExecutionLinqExternalThreadRouteAuthority,
  HostedExecutionResolvedLinqDeliveryRoute,
  HostedExecutionStructuredLogDetails,
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";
import {
  compareIsoTimestampsAscending as compareHostedIsoTimestampsAscending,
} from "@murphai/contracts";
import {
  buildHostedExecutionSafeErrorDiagnostics,
  createHostedExecutionPrivateAssistantAskCompletionDeliveryKey,
  createHostedExecutionReviewedAssistantAskCompletionDeliveryKey,
  emitHostedExecutionStructuredLog,
  HOSTED_EXECUTION_ASSISTANT_ASK_CANNOT_ANSWER_RESPONSE,
  HOSTED_EXECUTION_PRIVATE_ASSISTANT_ASK_COMPLETION_DELIVERY_KEY_PREFIX,
  HOSTED_EXECUTION_REVIEWED_ASSISTANT_ASK_COMPLETION_DELIVERY_KEY_PREFIX,
  sanitizeHostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";
import {
  buildHostedAssistantDeliveryEffect,
  type HostedAssistantDeliveryMedia,
  type HostedAssistantDeliveryPayload,
  type HostedAssistantDeliveryEffect,
  type HostedAssistantDeliveryPhase,
} from "@murphai/hosted-execution/side-effects";
import type {
  HostedActionApprovalObservation,
  HostedActionApprovalResult,
} from "@murphai/hosted-execution/action-approval";
import {
  parseHostedActionApprovalCycleOwnerKey,
  parseHostedActionApprovalOutcomeEffectId,
} from "@murphai/hosted-execution/action-approval";
import {
  applyAssistantVaultFileSendApprovalResult,
  beginAssistantOutboxIntentMirrorPreparedDispatch,
  buildAssistantVaultFileSendApprovalRequest,
  compareAssistantOutboxDeliverySequenceOrder,
  createAssistantOutboxIntent,
  deferAssistantVaultFileApprovalCheck,
  dispatchAssistantOutboxIntent,
  findAssistantAutoReplyDeliveryIntentIds,
  hasAssistantAutoReplyChannel,
  isAssistantOutboxReplyBubbleSuccessor,
  listAssistantCronPendingDeliveryIntentIds,
  listAssistantOutboxIntents,
  markAssistantOutboxIntentMirrorTerminalById,
  normalizeAssistantDeliveryError,
  persistAssistantPrivateCompletionContinuityAfterDelivery,
  readAssistantAutomationState,
  readAssistantOutboxIntent,
  readAssistantVaultFileMedia,
  readVerifiedAssistantVaultFileBytes,
  readVerifiedAssistantVaultImageBytes,
  sendTelegramMessage,
  readAssistantOutboxIntentMirrorState,
  resetAssistantOutboxPreparedDispatchById,
  saveAssistantOutboxIntentIfUnchanged,
  shouldDispatchAssistantOutboxIntent,
  type AssistantChannelDelivery,
  type AssistantHostedProgressDeliveryDependencies,
  type AssistantOutboxDispatchPreflightResult,
  type AssistantOutboxPreparedDispatchState,
} from "@murphai/assistant-engine";
import {
  parseHostedEmailThreadTarget,
  serializeHostedEmailThreadTarget,
} from "@murphai/runtime-state";
import {
  sendTelegramImageMessage,
  sendTelegramRichMessage,
} from "@murphai/assistant-engine/assistant-channel-runtime";
import type {
  AssistantDeliveryError,
  AssistantOutboxIntent,
  AssistantResponseMedia,
  AssistantVaultImageResponseMedia,
} from "@murphai/operator-config/assistant-cli-contracts";
import {
  setTelegramMessageReaction,
} from "@murphai/operator-config/telegram-runtime";
import {
  assistantChannelDeliverySchema,
} from "@murphai/operator-config/assistant-cli-contracts";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import {
  createAssistantDeliveryBlockedError,
  createAssistantDeliveryTerminalError,
} from "@murphai/operator-config/assistant/delivery-failure";

import type {
  HostedAssistantDeliveryErrorDetails,
  HostedAssistantDeliveryOutcome,
} from "./models.ts";
import type {
  HostedRuntimeActionApprovalPort,
  HostedRuntimeAssistantAskPrivateCompletionAuthority,
  HostedRuntimeEffectsPort,
  HostedRuntimeLinqDeliveryOutcomeRequest,
  HostedRuntimeLinqRecentInboundEngagementResult,
  HostedRuntimeLinqSendResponse,
  HostedRuntimePlatform,
  HostedRuntimeProviderTargetKind,
} from "./platform.ts";
import {
  toHostedRuntimeLogCode,
  writeHostedRuntimeLogBestEffort,
} from "./runtime-logs.ts";
import {
  buildHostedLinqChannelEnv,
  buildHostedTelegramChannelEnv,
  buildHostedTelegramVoiceMemoChannelEnv,
} from "./channel-activity.ts";
import {
  looksLikeHostedProviderRedactedLinqTarget,
  sendHostedProviderLinqMessage,
  sendHostedProviderLinqVoiceMemo,
  sendHostedProviderLinqChatAction,
  setHostedProviderLinqMessageReaction,
} from "../hosted-provider-effects.ts";
import {
  buildHostedAssistantLinqDeliveryContextFromWake,
  resolveHostedAssistantLinqDeliveryContextFromCandidatesForRequest,
  resolveHostedAssistantLinqReactionDeliveryContextFromCandidatesForRequest,
  type HostedAssistantLinqDeliveryContext,
} from "./linq-delivery-context.ts";
import {
  requireHostedProviderFetch,
  requireHostedProviderFetchDependencies,
} from "./provider-fetch.ts";
import {
  recordHostedAssistantMilestonesBestEffort,
  type HostedAssistantMilestoneTraceContext,
} from "./assistant-latency-trace.ts";

const HOSTED_MAX_BACKGROUND_DELIVERY_EFFECTS = 1;
// Bounds due approval reconciliation so a backlog cannot stall delivery with
// an unbounded series of web-control round trips.
const HOSTED_MAX_DUE_APPROVAL_RECONCILE = 4;
const HOSTED_ASSISTANT_DELIVERY_BOUNDARY = "hosted_runtime_outbox";
const HOSTED_NON_IDEMPOTENT_CONFIRMATION_GRACE_MS = 2 * 60 * 1000;
const HOSTED_SENDING_STALE_RECONCILIATION_MS = 10 * 60 * 1000;
const HOSTED_LINQ_DELIVERY_OUTCOME_WRITE_TIMEOUT_MS = 2_000;
const HOSTED_LINQ_REPLY_BUBBLE_PAUSE_MS = 1_500;
const HOSTED_PHONE_CALL_RESULT_DELIVERY_KEY_PREFIX = "phone-call-result:";
const HOSTED_TELEGRAM_VOICE_MEMO_DELIVERY_OPERATION =
  "Hosted assistant Telegram voice memo delivery";
type HostedAssistantDeliveryDetails = Record<string, boolean | number | null | string>;

interface HostedAssistantDeliveryBoundaryFields {
  actorId: string | null;
  bindingDeliveryKind: string | null;
  bindingDeliveryTarget: string | null;
  channel: string | null;
  deliverySourceKey: string | null;
  explicitTarget: string | null;
  identityId: string | null;
  sessionId: string;
  threadId: string | null;
  threadIsDirect: boolean | null;
  turnId: string;
}

export interface CollectHostedAssistantDeliverySideEffectsInput {
  actionApprovalPort?: HostedRuntimeActionApprovalPort | null;
  includeBackgroundDueIntents: boolean;
  preferredEffectIds?: readonly string[];
  preferredIntentIds?: readonly string[];
  vaultRoot: string;
}

export async function collectHostedAssistantDeliverySideEffects(
  input: CollectHostedAssistantDeliverySideEffectsInput,
): Promise<HostedAssistantDeliveryEffect[]> {
  const request = {
    includeBackgroundDueIntents: input.includeBackgroundDueIntents,
    preferredEffectIds: input.preferredEffectIds ?? [],
    preferredIntentIds: input.preferredIntentIds ?? [],
    vaultRoot: input.vaultRoot,
  };
  const now = new Date();
  const storedIntents = await listAssistantOutboxIntents(request.vaultRoot);
  const reconcileTargets = selectHostedAssistantApprovalReconcileTargets({
    includeBackgroundDueIntents: request.includeBackgroundDueIntents,
    now,
    preferredEffectIds: request.preferredEffectIds,
    storedIntents,
  });
  const reconciliationByIntentId = new Map<
    string,
    { blocked: boolean; intent: AssistantOutboxIntent }
  >();
  for (const intent of storedIntents) {
    if (!reconcileTargets.has(intent.intentId)) {
      continue;
    }
    const reconciliation = await reconcileHostedAssistantVaultFileApproval({
      actionApprovalPort: input.actionApprovalPort ?? null,
      expectedApprovalCycle: reconcileTargets.get(intent.intentId) ?? null,
      intent,
      missingApprovalPort: "block",
      now,
      vaultRoot: request.vaultRoot,
    });
    reconciliationByIntentId.set(reconciliation.intent.intentId, reconciliation);
  }
  const approvalReconciledIntents: AssistantOutboxIntent[] = storedIntents.map(
    (intent) => reconciliationByIntentId.get(intent.intentId)?.intent ?? intent,
  );
  const causalOnly = request.preferredEffectIds.length > 0;
  const blockedGroupEmailRecipientIntentIds = causalOnly
    ? new Set<string>()
    : await reconcileHostedGroupEmailRecipientParents({
        intents: approvalReconciledIntents,
        vaultRoot: request.vaultRoot,
      });
  const intents = approvalReconciledIntents;
  const approvalBlockedIntentIds = new Set<string>(
    Array.from(reconciliationByIntentId.values())
      .filter((reconciliation) => reconciliation.blocked)
      .map((reconciliation) => reconciliation.intent.intentId),
  );
  const preferredIntentIds = [
    ...new Set([
      ...(causalOnly ? reconcileTargets.keys() : []),
      ...request.preferredIntentIds,
    ]),
  ];
  const preferredIntentOrder = new Map(
    preferredIntentIds.map((intentId, index) => [intentId, index] as const),
  );

  const candidates: AssistantOutboxIntent[] = [];
  const nowIso = now.toISOString();
  for (const intent of intents) {
    if (causalOnly && !reconcileTargets.has(intent.intentId)) {
      continue;
    }
    if (intent.status === "awaiting_approval") {
      continue;
    }
    if (approvalBlockedIntentIds.has(intent.intentId)) {
      continue;
    }
    if (blockedGroupEmailRecipientIntentIds.has(intent.intentId)) {
      continue;
    }
    let sendingWakeAt: string | null = null;
    if (intent.status === "sending") {
      sendingWakeAt = resolveHostedAssistantOutboxIntentWakeAt(intent, now);
      if (!sendingWakeAt || sendingWakeAt > nowIso) {
        continue;
      }
    }

    if (
      intent.status === "retryable"
      && !intent.deliveryTransportIdempotent
      && intent.lastError?.code === "ASSISTANT_DELIVERY_CONFIRMATION_PENDING"
      && !readHostedAcceptedLinqReactionDeliveryAwaitingConsume(intent)
    ) {
      continue;
    }

    if (
      !sendingWakeAt
      && !shouldDispatchAssistantOutboxIntent(intent, now)
    ) {
      continue;
    }

    candidates.push(intent);
  }

  const preferredBoundaryOrder = buildPreferredHostedAssistantDeliveryBoundaryOrder({
    candidates,
    preferredIntentOrder,
  });
  const candidateIntentIds = new Set(candidates.map((intent) => intent.intentId));
  const selectableCandidateIds =
    buildSelectableHostedAssistantDeliveryCandidateIds({
      candidateIntentIds,
      intents,
      now,
    });
  const foregroundCandidates = candidates
    .filter((intent) => {
      const boundaryKey = readHostedAssistantDeliveryBoundaryKey(intent);
      return (
        selectableCandidateIds.has(intent.intentId)
        && (
          preferredIntentOrder.has(intent.intentId)
          || preferredBoundaryOrder.has(boundaryKey)
        )
      );
    })
    .sort((left, right) =>
      compareHostedAssistantForegroundDeliveryCandidateIntents({
        left,
        preferredIntentOrder,
        right,
        preferredBoundaryOrder,
      })
    );
  const backgroundCandidates = request.includeBackgroundDueIntents
    ? candidates
        .filter((intent) => {
          const boundaryKey = readHostedAssistantDeliveryBoundaryKey(intent);
          return (
            selectableCandidateIds.has(intent.intentId)
            && !preferredIntentOrder.has(intent.intentId)
            && !preferredBoundaryOrder.has(boundaryKey)
          );
        })
        .sort(compareHostedAssistantDeliveryCandidateIntents)
    : [];
  const filteredBackgroundCandidates =
    await abandonStaleSignupWelcomeCandidatesAfterReplyEvidence({
      backgroundCandidates,
      causalOnly,
      foregroundCandidates,
      intents,
      vaultRoot: request.vaultRoot,
    });
  // The scheduled-delivery cohort is derived from durable owner state at
  // every call, so it survives foreground preemption: whichever pass drains
  // next re-selects the whole remainder. Membership is either a cron job's
  // persisted pendingDeliveryIntentId (direct scheduled deliveries, including
  // local jobs whose authority is intentionally null) or a durable
  // automationAuthority on the intent itself (canonical scheduled outputs and
  // the recipient children that group email fanout copies it to after the
  // parent manifest clears the job reference). Provider entry still
  // revalidates that authority before any irreversible send. Cohort members
  // keep their comparator position and background classification; only
  // unrelated backlog competes for the single background slot.
  const scheduledCohortIntentIds = new Set(
    filteredBackgroundCandidates.length > 0
      ? await listAssistantCronPendingDeliveryIntentIds(request.vaultRoot)
      : [],
  );
  let backgroundBacklogBudget = Math.max(
    0,
    HOSTED_MAX_BACKGROUND_DELIVERY_EFFECTS - foregroundCandidates.length,
  );
  const cappedBackgroundCandidates: AssistantOutboxIntent[] = [];
  for (const intent of filteredBackgroundCandidates) {
    if (
      scheduledCohortIntentIds.has(intent.intentId)
      || intent.automationAuthority != null
    ) {
      cappedBackgroundCandidates.push(intent);
      continue;
    }
    if (backgroundBacklogBudget > 0) {
      cappedBackgroundCandidates.push(intent);
      backgroundBacklogBudget -= 1;
    }
  }
  const effects = [
    ...foregroundCandidates.map((intent) =>
      buildHostedAssistantDeliveryEffectFromIntent(intent, "foreground_current_turn")
    ),
    ...cappedBackgroundCandidates.map((intent) =>
      buildHostedAssistantDeliveryEffectFromIntent(intent, "background_retry")
    ),
  ];

  return effects;
}

/**
 * Reconciles only causally named or due approval work. Foreground delivery
 * identities are not approval-state identities, and must not replace a parked
 * effect's durable fallback wake before it is due.
 */
interface HostedAssistantApprovalCycleIdentity {
  approvalGeneration: string | null;
  approvalId: string;
  expiresAt: string;
  ownerKey: string;
}

function selectHostedAssistantApprovalReconcileTargets(input: {
  includeBackgroundDueIntents: boolean;
  now: Date;
  preferredEffectIds: readonly string[];
  storedIntents: readonly AssistantOutboxIntent[];
}): Map<string, HostedAssistantApprovalCycleIdentity | null> {
  const targets = new Map<
    string,
    HostedAssistantApprovalCycleIdentity | null
  >();
  if (input.preferredEffectIds.length > 0) {
    for (const effectId of input.preferredEffectIds) {
      const cycle = parseHostedActionApprovalOutcomeEffectId(effectId);
      if (!cycle) {
        continue;
      }
      const intent = input.storedIntents.find((candidate) =>
        candidate.status === "awaiting_approval"
        && candidate.deliveryIdempotencyKey === cycle.ownerKey
      );
      if (intent) {
        targets.set(intent.intentId, {
          approvalGeneration: cycle.approvalGeneration,
          approvalId: cycle.approvalId,
          expiresAt: cycle.expiresAt,
          ownerKey: cycle.ownerKey,
        });
        return targets;
      }
    }
    return targets;
  }
  if (!input.includeBackgroundDueIntents) {
    return targets;
  }

  const nowIso = input.now.toISOString();
  const due = [...input.storedIntents]
    .filter((intent) =>
      intent.status === "awaiting_approval"
      && !targets.has(intent.intentId)
      && (resolveHostedAssistantOutboxIntentWakeAt(intent, input.now) ?? nowIso)
        <= nowIso
    )
    .sort((left, right) =>
      compareHostedIsoTimestampsAscending(
        resolveHostedAssistantOutboxIntentWakeAt(left, input.now) ?? nowIso,
        resolveHostedAssistantOutboxIntentWakeAt(right, input.now) ?? nowIso,
      )
    );
  let selectedCycleOwners = 0;
  let selectedLegacyOwners = 0;
  for (const intent of due) {
    const cycle = parseHostedActionApprovalCycleOwnerKey(
      intent.deliveryIdempotencyKey,
    );
    if (!cycle) {
      if (selectedLegacyOwners < HOSTED_MAX_DUE_APPROVAL_RECONCILE) {
        targets.set(intent.intentId, null);
        selectedLegacyOwners += 1;
      }
      continue;
    }
    if (selectedCycleOwners < HOSTED_MAX_DUE_APPROVAL_RECONCILE) {
      targets.set(intent.intentId, {
        approvalGeneration: null,
        ...cycle,
      });
      selectedCycleOwners += 1;
    }
    if (
      selectedCycleOwners >= HOSTED_MAX_DUE_APPROVAL_RECONCILE
      && selectedLegacyOwners >= HOSTED_MAX_DUE_APPROVAL_RECONCILE
    ) {
      break;
    }
  }
  return targets;
}

async function reconcileHostedAssistantVaultFileApproval(input: {
  actionApprovalPort: HostedRuntimeActionApprovalPort | null;
  expectedApprovalCycle: HostedAssistantApprovalCycleIdentity | null;
  intent: AssistantOutboxIntent;
  missingApprovalPort: "block" | "skip";
  now: Date;
  vaultRoot: string;
}): Promise<{ blocked: boolean; intent: AssistantOutboxIntent }> {
  let file: ReturnType<typeof readAssistantVaultFileMedia>;
  try {
    file = readAssistantVaultFileMedia(input.intent);
  } catch (error) {
    const failed = await markAssistantOutboxIntentMirrorTerminalById({
      error,
      intentId: input.intent.intentId,
      status: "failed",
      vault: input.vaultRoot,
    });
    return {
      blocked: true,
      intent: failed ?? input.intent,
    };
  }
  if (!file) {
    return { blocked: false, intent: input.intent };
  }
  if (
    input.intent.status === "sent"
    || input.intent.status === "failed"
    || input.intent.status === "abandoned"
  ) {
    return { blocked: false, intent: input.intent };
  }

  if (!input.actionApprovalPort) {
    if (input.missingApprovalPort === "skip") {
      return {
        blocked: true,
        intent: input.intent,
      };
    }

    const deferred = deferAssistantVaultFileApprovalCheck({
      intent: input.intent,
      now: input.now,
    });
    return {
      blocked: true,
      intent: await persistHostedAssistantVaultFileApprovalState({
        current: input.intent,
        next: deferred,
        vaultRoot: input.vaultRoot,
      }),
    };
  }

  if (
    file.approvalId
    && file.approvalGeneration
    && input.intent.status !== "awaiting_approval"
  ) {
    return { blocked: false, intent: input.intent };
  }

  if (
    input.intent.status === "awaiting_approval"
    && !input.expectedApprovalCycle
  ) {
    const updatedAt = input.now.toISOString();
    const hasExactApprovedGeneration = Boolean(
      file.approvalId && file.approvalGeneration,
    );
    const normalized: AssistantOutboxIntent = hasExactApprovedGeneration
      ? {
          ...input.intent,
          lastError: null,
          nextAttemptAt: updatedAt,
          status: "pending",
          updatedAt,
        }
      : {
          ...input.intent,
          lastError: {
            code: "ASSISTANT_VAULT_FILE_APPROVAL_OWNER_INVALID",
            message: "Vault-file delivery approval did not have a valid cycle owner.",
          },
          nextAttemptAt: null,
          status: "abandoned",
          updatedAt,
        };
    const persisted = await persistHostedAssistantVaultFileApprovalState({
      current: input.intent,
      next: normalized,
      vaultRoot: input.vaultRoot,
    });
    return {
      blocked: persisted.status !== "pending",
      intent: persisted,
    };
  }

  let approvalRequest: ReturnType<typeof buildAssistantVaultFileSendApprovalRequest>;
  try {
    approvalRequest = buildAssistantVaultFileSendApprovalRequest(input.intent);
  } catch (error) {
    const failed = await markAssistantOutboxIntentMirrorTerminalById({
      error: createAssistantDeliveryTerminalError(
        "ASSISTANT_VAULT_FILE_APPROVAL_TARGET_INVALID",
        "Secure vault-file approval could not be requested because the delivery target is invalid.",
        { cause: error instanceof Error ? error.message : String(error) },
      ),
      intentId: input.intent.intentId,
      status: "failed",
      vault: input.vaultRoot,
    });
    return {
      blocked: true,
      intent: failed ?? input.intent,
    };
  }

  let approval: HostedActionApprovalObservation;
  try {
    approval = await input.actionApprovalPort.read(approvalRequest);
  } catch {
    const deferred = deferAssistantVaultFileApprovalCheck({
      intent: input.intent,
      now: input.now,
    });
    return {
      blocked: true,
      intent: await persistHostedAssistantVaultFileApprovalState({
        current: input.intent,
        next: deferred,
        vaultRoot: input.vaultRoot,
      }),
    };
  }

  if (
    input.expectedApprovalCycle
    && approval.cycleOwnerKey !== input.expectedApprovalCycle.ownerKey
  ) {
    const superseded: AssistantOutboxIntent = {
      ...input.intent,
      lastError: {
        code: "ASSISTANT_VAULT_FILE_APPROVAL_SUPERSEDED",
        message: "Vault-file delivery approval was superseded by a newer approval cycle.",
      },
      nextAttemptAt: null,
      status: "abandoned",
      updatedAt: input.now.toISOString(),
    };
    return {
      blocked: true,
      intent: await persistHostedAssistantVaultFileApprovalState({
        current: input.intent,
        next: superseded,
        vaultRoot: input.vaultRoot,
      }),
    };
  }

  if (
    input.expectedApprovalCycle
    && (
      approval.approvalId !== input.expectedApprovalCycle.approvalId
      || (
        approval.status === "approved"
        && input.expectedApprovalCycle.approvalGeneration !== null
        && approval.approvalGeneration
          !== input.expectedApprovalCycle.approvalGeneration
      )
    )
  ) {
    return { blocked: true, intent: input.intent };
  }

  const reconciled = applyAssistantVaultFileSendApprovalResult({
    approval,
    intent: input.intent,
    now: input.now,
  });
  const persisted = await persistHostedAssistantVaultFileApprovalState({
    current: input.intent,
    next: reconciled,
    vaultRoot: input.vaultRoot,
  });
  return {
    blocked:
      approval.status !== "approved"
      || persisted.status === "awaiting_approval",
    intent: persisted,
  };
}

async function preflightHostedAssistantVaultFileDispatch(input: {
  actionApprovalPort: HostedRuntimeActionApprovalPort | null;
  intent: AssistantOutboxIntent;
  now: Date;
  vaultRoot: string;
}): Promise<AssistantOutboxDispatchPreflightResult> {
  const reconciled = await reconcileHostedAssistantVaultFileApproval({
    actionApprovalPort: input.actionApprovalPort,
    expectedApprovalCycle: readHostedAssistantApprovalCycleIdentity(input.intent),
    intent: input.intent,
    missingApprovalPort: "block",
    now: input.now,
    vaultRoot: input.vaultRoot,
  });
  if (!reconciled.blocked) {
    return { action: "continue" };
  }

  return {
    action: reconciled.intent.status === "awaiting_approval" ? "defer" : "stop",
    intent: reconciled.intent,
  };
}

async function preflightHostedAssistantDispatch(input: {
  actionApprovalPort: HostedRuntimeActionApprovalPort | null;
  effectsPort: Pick<HostedRuntimeEffectsPort, "assertLinqRecentInboundEngagement">;
  intent: AssistantOutboxIntent;
  linqDeliveryContexts: readonly HostedAssistantLinqDeliveryContext[];
  now: Date;
  payload: HostedAssistantDeliveryPayload;
  signal: AbortSignal | null;
  vaultRoot: string;
}): Promise<AssistantOutboxDispatchPreflightResult> {
  const vaultFile = await preflightHostedAssistantVaultFileDispatch({
    actionApprovalPort: input.actionApprovalPort,
    intent: input.intent,
    now: input.now,
    vaultRoot: input.vaultRoot,
  });
  if (vaultFile.action !== "continue") {
    return vaultFile;
  }

  if (isHostedPrivateAssistantAskCompletionIntent(input.intent)) {
    try {
      requireHostedPrivateAssistantAskCompletionProof(input.intent);
      assertHostedPrivateAssistantAskCompletionPayloadMatchesIntent({
        intent: input.intent,
        payload: input.payload,
      });
      // Web owns the terminal boundary. Even an expired local attempt must
      // reach its live authority check so Web can persist the group fallback.
      return { action: "continue" };
    } catch (error) {
      const failed = await markAssistantOutboxIntentMirrorTerminalById({
        error,
        intentId: input.intent.intentId,
        onlyCurrentStatuses: ["pending", "retryable"],
        status: "failed",
        vault: input.vaultRoot,
      });
      return {
        action: "stop",
        intent: failed ?? input.intent,
      };
    }
  }

  if (!isHostedReviewedAssistantAskCompletionIntent(input.intent)) {
    return { action: "continue" };
  }
  const completionExpiresAt =
    requireHostedReviewedAssistantAskCompletionExpiresAt(input.intent);
  if (
    input.intent.message
      === HOSTED_EXECUTION_ASSISTANT_ASK_CANNOT_ANSWER_RESPONSE
    && !isHostedReviewedAssistantAskFallbackPayload(input.intent)
  ) {
    await persistHostedAssistantAskFallbackSupersession({
      intentId: input.intent.intentId,
      now: input.now,
      vaultRoot: input.vaultRoot,
    });
    return { action: "continue" };
  }
  if (
    !isHostedReviewedAssistantAskFallbackPayload(input.intent)
    && Date.parse(completionExpiresAt) <= input.now.getTime()
  ) {
    await persistHostedAssistantAskFallbackSupersession({
      intentId: input.intent.intentId,
      now: input.now,
      vaultRoot: input.vaultRoot,
    });
    return { action: "continue" };
  }
  const target = input.payload.explicitTarget
    ?? input.payload.bindingDeliveryTarget;
  const targetKind = input.payload.explicitTarget
    ? "explicit"
    : input.payload.bindingDeliveryKind;
  if (input.payload.channel === "telegram") {
    return { action: "continue" };
  }
  if (!target || !targetKind || input.payload.channel !== "linq") {
    throw new VaultCliError(
      "ASSISTANT_ASK_COMPLETION_ROUTE_UNAVAILABLE",
      "Reviewed Assistant Ask completion requires its original Linq route.",
      { retryable: false },
    );
  }
  const deliveryContext =
    resolveHostedAssistantLinqDeliveryContextFromCandidatesForRequest({
      contexts: input.linqDeliveryContexts,
      replyToMessageId: input.payload.replyToMessageId,
      target,
      targetKind,
    });
  const engagement =
    await assertHostedAssistantLinqRecentInboundEngagementForDelivery({
      answeredMailboxItemIds: input.intent.answeredMailboxItemIds,
      assistantAskCompletionExpiresAt: completionExpiresAt,
      assistantAskFallback:
        isHostedReviewedAssistantAskFallbackPayload(input.intent),
      authorityCheckOnly: true,
      directRecipientPhoneNumber:
        normalizeHostedLinqDirectRecipient(
          deliveryContext?.directRecipientPhoneNumber,
        ),
      effectsPort: input.effectsPort,
      fromPhoneNumber:
        normalizeHostedLinqDirectRecipient(deliveryContext?.fromPhoneNumber),
      homeRouteFallbackAllowed: false,
      idempotencyKey: input.intent.deliveryIdempotencyKey,
      intentId: input.intent.intentId,
      replyToMessageId: input.intent.replyToMessageId,
      signal: input.signal,
      target: deliveryContext?.target ?? target,
      targetKind,
    });
  if (engagement.assistantAskFallbackRequired === true) {
    await persistHostedAssistantAskFallbackSupersession({
      intentId: input.intent.intentId,
      now: input.now,
      vaultRoot: input.vaultRoot,
    });
  }
  return { action: "continue" };
}

function isHostedPrivateAssistantAskCompletionIntent(
  intent: AssistantOutboxIntent,
): boolean {
  return intent.deliveryIdempotencyKey?.startsWith(
    HOSTED_EXECUTION_PRIVATE_ASSISTANT_ASK_COMPLETION_DELIVERY_KEY_PREFIX,
  ) === true;
}

function isHostedReviewedAssistantAskCompletionIntent(
  intent: AssistantOutboxIntent,
): boolean {
  return (intent.channel === "linq" || intent.channel === "telegram")
    && intent.operation === null
    && intent.deliveryIdempotencyKey?.startsWith(
      HOSTED_EXECUTION_REVIEWED_ASSISTANT_ASK_COMPLETION_DELIVERY_KEY_PREFIX,
    ) === true;
}

function requireHostedPrivateAssistantAskCompletionProof(
  intent: AssistantOutboxIntent,
): HostedRuntimeAssistantAskPrivateCompletionAuthority {
  const completionId = intent.answeredMailboxItemIds[0] ?? null;
  const expiresAt = intent.reviewedAssistantAskCompletionExpiresAt ?? null;
  const idempotencyKey = intent.deliveryIdempotencyKey;
  const route = readHostedPrivateAssistantAskCompletionRoute(intent);
  if (
    !completionId
    || intent.answeredMailboxItemIds.length !== 1
    || !idempotencyKey
    || createHostedExecutionPrivateAssistantAskCompletionDeliveryKey(
      completionId,
    ) !== idempotencyKey
    || !expiresAt
    || !Number.isFinite(Date.parse(expiresAt))
    || !route
    || intent.threadIsDirect !== true
    || intent.media.length !== 0
    || intent.card !== null
    || intent.emailHtml != null
    || intent.subject !== null
    || intent.operation !== null
    || intent.externalThreadRouteAuthority != null
    || intent.automationAuthority != null
  ) {
    throw new VaultCliError(
      "ASSISTANT_ASK_PRIVATE_COMPLETION_OUTBOX_PROOF_INVALID",
      "Private Assistant Ask completion outbox proof is invalid.",
      { retryable: false },
    );
  }
  return {
    answeredMailboxItemIds: [completionId],
    assistantAskCompletionExpiresAt: expiresAt,
    idempotencyKey,
    responseTextDigest: createHostedPrivateAssistantAskResponseTextDigest(
      intent.message,
    ),
    route,
  };
}

function readHostedPrivateAssistantAskCompletionRoute(
  intent: AssistantOutboxIntent,
): HostedExecutionAssistantNotificationRoute | null {
  if (
    (intent.channel !== "linq" && intent.channel !== "telegram")
    || !intent.bindingDelivery
    || intent.explicitTarget !== null
  ) {
    return null;
  }
  const delivery = intent.bindingDelivery;
  if (
    intent.channel === "telegram"
    && (delivery.kind !== "thread" || intent.deliverySource !== null)
  ) {
    return null;
  }
  if (
    intent.channel === "linq"
    && (
      (delivery.kind !== "thread" && delivery.kind !== "participant")
      || (
        delivery.kind === "participant"
        && intent.deliverySource?.kind !== "linq"
      )
      || (delivery.kind === "thread" && intent.deliverySource !== null)
    )
  ) {
    return null;
  }
  return {
    actorId: intent.actorId,
    channel: intent.channel,
    delivery: {
      kind: delivery.kind,
      ...(intent.deliverySource?.kind === "linq"
        ? {
            source: {
              fromPhoneNumber: intent.deliverySource.fromPhoneNumber,
              kind: "linq" as const,
            },
          }
        : {}),
      target: delivery.target,
    },
    identityId: intent.identityId,
    threadId: intent.threadId,
    threadIsDirect: intent.threadIsDirect,
  };
}

function assertHostedPrivateAssistantAskCompletionPayloadMatchesIntent(input: {
  intent: AssistantOutboxIntent;
  payload: HostedAssistantDeliveryPayload;
}): void {
  const route = readHostedPrivateAssistantAskCompletionRoute(input.intent);
  if (
    !route
    || input.payload.channel !== input.intent.channel
    || input.payload.idempotencyKey !== input.intent.deliveryIdempotencyKey
    || input.payload.message !== input.intent.message
    || input.payload.media.length !== 0
    || input.payload.card != null
    || input.payload.answeredMailboxItemIds.length !== 1
    || input.payload.answeredMailboxItemIds[0]
      !== input.intent.answeredMailboxItemIds[0]
    || input.payload.actorId !== route.actorId
    || input.payload.bindingDeliveryKind !== route.delivery.kind
    || input.payload.bindingDeliveryTarget !== route.delivery.target
    || input.payload.explicitTarget !== null
    || input.payload.identityId !== route.identityId
    || input.payload.threadId !== route.threadId
    || input.payload.threadIsDirect !== true
  ) {
    throw new VaultCliError(
      "ASSISTANT_ASK_PRIVATE_COMPLETION_TRANSPORT_INVALID",
      "Private Assistant Ask completion must use its exact direct text-only route.",
      { retryable: false },
    );
  }
}

function createHostedPrivateAssistantAskResponseTextDigest(
  message: string,
): string {
  return createHash("sha256").update(message).digest("hex");
}

function requireHostedReviewedAssistantAskCompletionExpiresAt(
  intent: AssistantOutboxIntent,
): string {
  const completionId = intent.answeredMailboxItemIds[0] ?? null;
  const expiresAt = intent.reviewedAssistantAskCompletionExpiresAt ?? null;
  if (
    !completionId
    || intent.answeredMailboxItemIds.length !== 1
    || !intent.deliveryIdempotencyKey
    || createHostedExecutionReviewedAssistantAskCompletionDeliveryKey(
      completionId,
    ) !== intent.deliveryIdempotencyKey
    || !expiresAt
    || !Number.isFinite(Date.parse(expiresAt))
  ) {
    throw new VaultCliError(
      "ASSISTANT_ASK_COMPLETION_OUTBOX_PROOF_INVALID",
      "Reviewed Assistant Ask completion outbox proof is invalid.",
      { retryable: false },
    );
  }
  return expiresAt;
}

function isHostedReviewedAssistantAskFallbackPayload(input: {
  media?: readonly AssistantResponseMedia[] | null;
  message: string;
}): boolean {
  return input.message
      === HOSTED_EXECUTION_ASSISTANT_ASK_CANNOT_ANSWER_RESPONSE
    && (input.media?.length ?? 0) === 0;
}

async function persistHostedAssistantAskFallbackSupersession(input: {
  intentId: string;
  now: Date;
  vaultRoot: string;
}): Promise<AssistantOutboxIntent> {
  const current = await readAssistantOutboxIntent(
    input.vaultRoot,
    input.intentId,
  );
  if (!current) {
    throw new VaultCliError(
      "ASSISTANT_ASK_COMPLETION_OUTBOX_MISSING",
      "Reviewed Assistant Ask completion outbox state is unavailable.",
      { retryable: true },
    );
  }
  requireHostedReviewedAssistantAskCompletionExpiresAt(current);
  if (isHostedReviewedAssistantAskFallbackPayload(current)) {
    return current;
  }
  const updatedAt = input.now.toISOString();
  const { intent: persisted } = await saveAssistantOutboxIntentIfUnchanged({
    expectedDedupeKey: current.dedupeKey,
    expectedStatus: current.status,
    expectedUpdatedAt: current.updatedAt,
    intent: {
      ...current,
      card: null,
      media: [],
      message: HOSTED_EXECUTION_ASSISTANT_ASK_CANNOT_ANSWER_RESPONSE,
      updatedAt,
    },
    vault: input.vaultRoot,
  });
  if (!isHostedReviewedAssistantAskFallbackPayload(persisted)) {
    throw new VaultCliError(
      "ASSISTANT_ASK_COMPLETION_FALLBACK_PERSIST_PENDING",
      "Reviewed Assistant Ask completion fallback persistence must retry before delivery.",
      { retryable: true },
    );
  }
  return persisted;
}

function readHostedAssistantApprovalCycleIdentity(
  intent: AssistantOutboxIntent,
): HostedAssistantApprovalCycleIdentity | null {
  const cycle = parseHostedActionApprovalCycleOwnerKey(
    intent.deliveryIdempotencyKey,
  );
  return cycle
    ? {
        approvalGeneration: null,
        ...cycle,
      }
    : null;
}

async function persistHostedAssistantVaultFileApprovalState(input: {
  current: AssistantOutboxIntent;
  next: AssistantOutboxIntent;
  vaultRoot: string;
}): Promise<AssistantOutboxIntent> {
  if (input.next === input.current) {
    return input.current;
  }

  return (await saveAssistantOutboxIntentIfUnchanged({
    expectedDedupeKey: input.current.dedupeKey,
    expectedStatus: input.current.status,
    expectedUpdatedAt: input.current.updatedAt,
    intent: input.next,
    vault: input.vaultRoot,
  })).intent;
}

async function abandonStaleSignupWelcomeCandidatesAfterReplyEvidence(input: {
  backgroundCandidates: readonly AssistantOutboxIntent[];
  causalOnly: boolean;
  foregroundCandidates: readonly AssistantOutboxIntent[];
  intents: readonly AssistantOutboxIntent[];
  vaultRoot: string;
}): Promise<AssistantOutboxIntent[]> {
  const welcomeCandidates = (
    input.causalOnly ? input.backgroundCandidates : input.intents
  ).filter(isHostedSignupWelcomeSupersessionCandidate);
  if (welcomeCandidates.length === 0) {
    return [...input.backgroundCandidates];
  }

  const possibleHistoricalReplies = input.intents.filter((intent) =>
    isHostedAssistantAcceptedReplyEvidenceStatus(intent.status)
    && !isHostedSignupWelcomeIntent(intent)
    && welcomeCandidates.some((welcome) =>
      hostedAssistantReplySupersedesSignupWelcome({ reply: intent, welcome })
    )
  );
  const autoReplyIntentIds = possibleHistoricalReplies.length > 0
    ? await findAssistantAutoReplyDeliveryIntentIds({
        intents: possibleHistoricalReplies,
        vault: input.vaultRoot,
      })
    : new Set<string>();
  const replyEvidenceByIntentId = new Map<string, AssistantOutboxIntent>();
  for (const intent of input.foregroundCandidates) {
    if (
      isHostedAssistantAcceptedReplyEvidenceStatus(intent.status)
      && !isHostedSignupWelcomeIntent(intent)
    ) {
      replyEvidenceByIntentId.set(intent.intentId, intent);
    }
  }
  for (const intent of possibleHistoricalReplies) {
    if (autoReplyIntentIds.has(intent.intentId)) {
      replyEvidenceByIntentId.set(intent.intentId, intent);
    }
  }

  const abandonedWelcomeIntentIds = new Set<string>();
  for (const welcome of welcomeCandidates) {
    if (
      [...replyEvidenceByIntentId.values()].some((reply) =>
        hostedAssistantReplySupersedesSignupWelcome({ reply, welcome })
      )
    ) {
      const terminalIntent = await markAssistantOutboxIntentMirrorTerminalById({
        error: new VaultCliError(
          "ASSISTANT_STALE_SIGNUP_WELCOME_SUPPRESSED",
          "Stale signup welcome suppressed after a newer reply for the same route.",
        ),
        intentId: welcome.intentId,
        onlyCurrentStatuses: ["pending", "retryable"],
        status: "abandoned",
        vault: input.vaultRoot,
      });
      if (terminalIntent?.status === "abandoned") {
        abandonedWelcomeIntentIds.add(welcome.intentId);
      }
    }
  }
  return input.backgroundCandidates.filter(
    (intent) => !abandonedWelcomeIntentIds.has(intent.intentId),
  );
}

function isHostedSignupWelcomeSupersessionCandidate(
  intent: AssistantOutboxIntent,
): boolean {
  return (intent.status === "pending" || intent.status === "retryable")
    && isHostedSignupWelcomeIntent(intent);
}

function isHostedSignupWelcomeIntent(intent: AssistantOutboxIntent): boolean {
  return isHostedSignupWelcomeDeliveryPayload(
    buildHostedAssistantDeliveryPayloadFromIntent(intent),
  );
}

function isHostedAssistantAcceptedReplyEvidenceStatus(
  status: AssistantOutboxIntent["status"],
): boolean {
  return status === "pending"
    || status === "sending"
    || status === "retryable"
    || status === "sent";
}

function hostedAssistantReplySupersedesSignupWelcome(input: {
  reply: AssistantOutboxIntent;
  welcome: AssistantOutboxIntent;
}): boolean {
  if (
    input.reply.intentId === input.welcome.intentId
    || compareHostedIsoTimestampsAscending(
      input.reply.createdAt,
      input.welcome.createdAt,
    ) < 0
  ) {
    return false;
  }

  return hostedAssistantReplyTargetsSignupWelcomeRecipient(
    buildHostedAssistantDeliveryPayloadFromIntent(input.reply),
    buildHostedAssistantDeliveryPayloadFromIntent(input.welcome),
  );
}

function hostedAssistantReplyTargetsSignupWelcomeRecipient(
  reply: HostedAssistantDeliveryPayload,
  welcome: HostedAssistantDeliveryPayload,
): boolean {
  const welcomeRouteKeys = new Set(
    buildHostedAssistantDeliveryRouteKeys(welcome),
  );
  if (
    buildHostedAssistantDeliveryRouteKeys(reply).some((key) =>
      welcomeRouteKeys.has(key)
    )
  ) {
    return true;
  }

  const replyActorId = reply.actorId?.trim() || null;
  const welcomeActorId = welcome.actorId?.trim() || null;
  return reply.channel?.trim() === "linq"
    && welcome.channel?.trim() === "linq"
    && welcome.bindingDeliveryKind === "participant"
    && reply.threadIsDirect === true
    && welcome.threadIsDirect === true
    && replyActorId !== null
    && replyActorId === welcomeActorId;
}

const HOSTED_SIGNUP_WELCOME_DELIVERY_IDEMPOTENCY_PREFIX = "signup-welcome:";
const HOSTED_LINQ_APP_CARD_REJECTED_FAILURE_CODE =
  "ASSISTANT_LINQ_APP_CARD_REJECTED";
const HOSTED_LINQ_RICH_LINK_PARTIAL_DELIVERY_FAILURE_CODE =
  "ASSISTANT_LINQ_RICH_LINK_PARTIAL_DELIVERY";

function isHostedSignupWelcomeDeliveryPayload(
  payload: HostedAssistantDeliveryPayload,
): boolean {
  return isHostedSignupWelcomeDeliveryIdempotencyKey(payload.idempotencyKey);
}

function isHostedSignupWelcomeDeliveryIdempotencyKey(
  idempotencyKey: string | null | undefined,
): boolean {
  const normalized = idempotencyKey?.trim() ?? "";
  if (!normalized.startsWith(HOSTED_SIGNUP_WELCOME_DELIVERY_IDEMPOTENCY_PREFIX)) {
    return false;
  }
  const tokenTarget = normalized.slice(
    HOSTED_SIGNUP_WELCOME_DELIVERY_IDEMPOTENCY_PREFIX.length,
  );
  return tokenTarget.length > 0 && !tokenTarget.includes(":");
}

function hostedAssistantDeliveryRecipientKeysOverlap(
  payload: HostedAssistantDeliveryPayload,
  keys: ReadonlySet<string>,
): boolean {
  return buildHostedAssistantDeliveryRecipientKeys(payload).some((key) => keys.has(key));
}

function buildHostedAssistantDeliveryRecipientKeys(
  payload: HostedAssistantDeliveryPayload,
): string[] {
  const channel = payload.channel?.trim() || null;
  if (!channel) {
    return [];
  }

  return [
    ...buildHostedAssistantDeliveryRouteKeys(payload),
    payload.actorId ? `${channel}:actor:${payload.actorId}` : null,
  ].filter((key): key is string => key !== null);
}

function buildHostedAssistantDeliveryRouteKeys(
  payload: HostedAssistantDeliveryPayload,
): string[] {
  const channel = payload.channel?.trim() || null;
  if (!channel) {
    return [];
  }

  return [
    payload.threadId ? `${channel}:thread:${payload.threadId}` : null,
    payload.explicitTarget ? `${channel}:explicit:${payload.explicitTarget}` : null,
    payload.bindingDeliveryTarget
      ? `${channel}:binding:${payload.bindingDeliveryKind ?? "unknown"}:${
          payload.bindingDeliveryTarget
        }`
      : null,
  ].filter((key): key is string => key !== null);
}

function buildHostedAssistantDeliveryEffectFromIntent(
  intent: AssistantOutboxIntent,
  deliveryPhase: HostedAssistantDeliveryPhase,
): HostedAssistantDeliveryEffect {
  return buildHostedAssistantDeliveryEffect({
    dedupeKey: intent.dedupeKey,
    deliveryPhase,
    effectId: intent.intentId,
    payload: buildHostedAssistantDeliveryPayloadFromIntent(intent),
  });
}

function readPreferredHostedAssistantDeliveryIntentOrder(
  intent: AssistantOutboxIntent,
  preferredIntentOrder: ReadonlyMap<string, number>,
): number {
  return preferredIntentOrder.get(intent.intentId) ?? Number.MAX_SAFE_INTEGER;
}

function readPreferredHostedAssistantDeliveryOrder(
  intent: AssistantOutboxIntent,
  preferredIntentOrder: ReadonlyMap<string, number>,
  preferredBoundaryOrder: ReadonlyMap<string, number>,
): number {
  return Math.min(
    readPreferredHostedAssistantDeliveryIntentOrder(intent, preferredIntentOrder),
    readPreferredHostedAssistantDeliveryBoundaryOrder(intent, preferredBoundaryOrder),
  );
}

function readPreferredHostedAssistantDeliveryBoundaryOrder(
  intent: AssistantOutboxIntent,
  preferredBoundaryOrder: ReadonlyMap<string, number>,
): number {
  return preferredBoundaryOrder.get(
    readHostedAssistantDeliveryBoundaryKey(intent),
  ) ?? Number.MAX_SAFE_INTEGER;
}

function buildPreferredHostedAssistantDeliveryBoundaryOrder(input: {
  candidates: readonly AssistantOutboxIntent[];
  preferredIntentOrder: ReadonlyMap<string, number>;
}): Map<string, number> {
  const order = new Map<string, number>();
  for (const intent of input.candidates) {
    const intentOrder = input.preferredIntentOrder.get(intent.intentId);
    if (intentOrder === undefined) {
      continue;
    }
    const key = readHostedAssistantDeliveryBoundaryKey(intent);
    const previous = order.get(key);
    if (previous === undefined || intentOrder < previous) {
      order.set(key, intentOrder);
    }
  }
  return order;
}

function buildSelectableHostedAssistantDeliveryCandidateIds(input: {
  candidateIntentIds: ReadonlySet<string>;
  intents: readonly AssistantOutboxIntent[];
  now: Date;
}): Set<string> {
  const selectableIntentIds = new Set<string>();
  for (const boundaryIntents of groupHostedAssistantDeliveryBoundaryIntents(
    input.intents,
  ).values()) {
    for (const intent of boundaryIntents) {
      if (input.candidateIntentIds.has(intent.intentId)) {
        selectableIntentIds.add(intent.intentId);
        continue;
      }
      if (intent.status === "awaiting_approval") {
        // Approval is an authorization wait, not an outbound-message
        // predecessor. Keep its fallback in next-wake calculation, but do not
        // hide a ready approval-link reply queued later on the same boundary.
        continue;
      }
      if (resolveHostedAssistantOutboxIntentWakeAt(intent, input.now)) {
        break;
      }
      continue;
    }
  }
  return selectableIntentIds;
}

function groupHostedAssistantDeliveryBoundaryIntents(
  intents: readonly AssistantOutboxIntent[],
): Map<string, AssistantOutboxIntent[]> {
  const grouped = new Map<string, AssistantOutboxIntent[]>();
  for (const intent of intents) {
    const key = readHostedAssistantDeliveryBoundaryKey(intent);
    const boundaryIntents = grouped.get(key);
    if (boundaryIntents) {
      boundaryIntents.push(intent);
    } else {
      grouped.set(key, [intent]);
    }
  }
  for (const boundaryIntents of grouped.values()) {
    boundaryIntents.sort(compareHostedAssistantDeliveryBoundaryIntents);
  }
  return grouped;
}

export interface HostedAssistantDeliveryPreparation {
  preparedDispatches: readonly HostedAssistantDeliveryPreparedDispatch[];
}

export interface HostedAssistantDeliveryPreparedDispatch {
  intentId: string;
  linqDeliveryContext?: HostedAssistantLinqDeliveryContext | null;
  preparedDispatchToken: string;
  previousDispatchState: AssistantOutboxPreparedDispatchState;
}

function readHostedAssistantDeliveryBoundaryKey(
  intent: AssistantOutboxIntent,
): string {
  const groupEmailBoundaryKey = readHostedGroupEmailDeliveryBoundaryKey({
    deliveryIdempotencyKey: intent.deliveryIdempotencyKey,
    explicitTarget: intent.explicitTarget,
    turnId: intent.turnId,
  });
  if (groupEmailBoundaryKey) {
    return groupEmailBoundaryKey;
  }
  return formatHostedAssistantDeliveryBoundaryKey({
    actorId: intent.actorId ?? null,
    bindingDeliveryKind: intent.bindingDelivery?.kind ?? null,
    bindingDeliveryTarget: intent.bindingDelivery?.target ?? null,
    channel: intent.channel ?? null,
    deliverySourceKey: readHostedAssistantDeliverySourceKey(intent.deliverySource),
    explicitTarget: intent.explicitTarget ?? null,
    identityId: intent.identityId ?? null,
    sessionId: intent.sessionId,
    threadId: intent.threadId ?? null,
    threadIsDirect: intent.threadIsDirect ?? null,
    turnId: intent.turnId,
  });
}

function readHostedAssistantDeliveryEffectBoundaryKey(
  effect: HostedAssistantDeliveryEffect,
): string {
  const groupEmailBoundaryKey = readHostedGroupEmailDeliveryBoundaryKey({
    deliveryIdempotencyKey: effect.payload.idempotencyKey,
    explicitTarget: effect.payload.explicitTarget,
    turnId: effect.payload.turnId,
  });
  if (groupEmailBoundaryKey) {
    return groupEmailBoundaryKey;
  }
  return formatHostedAssistantDeliveryBoundaryKey({
    actorId: effect.payload.actorId,
    bindingDeliveryKind: effect.payload.bindingDeliveryKind,
    bindingDeliveryTarget: effect.payload.bindingDeliveryTarget,
    channel: effect.payload.channel,
    deliverySourceKey: effect.payload.deliverySourceKey,
    explicitTarget: effect.payload.explicitTarget,
    identityId: effect.payload.identityId,
    sessionId: effect.payload.sessionId,
    threadId: effect.payload.threadId,
    threadIsDirect: effect.payload.threadIsDirect,
    turnId: effect.payload.turnId,
  });
}

function readHostedGroupEmailDeliveryBoundaryKey(input: {
  deliveryIdempotencyKey: string | null | undefined;
  explicitTarget: string | null | undefined;
  turnId: string;
}): string | null {
  const deliveryIdempotencyKey = input.deliveryIdempotencyKey?.trim() ?? "";
  if (!isHostedGroupEmailDeliveryIdempotencyKey(deliveryIdempotencyKey)) {
    return null;
  }
  const target = parseHostedEmailThreadTarget(input.explicitTarget);
  if (target?.targetKind !== "group") {
    return null;
  }
  return JSON.stringify(["group-email", deliveryIdempotencyKey, input.turnId]);
}

function isHostedGroupEmailDeliveryIdempotencyKey(value: string): boolean {
  return value.startsWith("group-email-effect:")
    || value.startsWith("group-newsletter:");
}

async function reconcileHostedGroupEmailRecipientParents(input: {
  intents: readonly AssistantOutboxIntent[];
  vaultRoot: string;
}): Promise<Set<string>> {
  const parentsByBoundary = new Map<string, AssistantOutboxIntent>();
  for (const intent of input.intents) {
    const target = parseHostedEmailThreadTarget(intent.explicitTarget);
    const boundaryKey = readHostedGroupEmailDeliveryBoundaryKey({
      deliveryIdempotencyKey: intent.deliveryIdempotencyKey,
      explicitTarget: intent.explicitTarget,
      turnId: intent.turnId,
    });
    if (
      boundaryKey
      && target?.targetKind === "group"
      && !target.recipientMemberId
    ) {
      parentsByBoundary.set(boundaryKey, intent);
    }
  }

  const blockedRecipientIntentIds = new Set<string>();
  for (const intent of input.intents) {
    const target = parseHostedEmailThreadTarget(intent.explicitTarget);
    const boundaryKey = readHostedGroupEmailDeliveryBoundaryKey({
      deliveryIdempotencyKey: intent.deliveryIdempotencyKey,
      explicitTarget: intent.explicitTarget,
      turnId: intent.turnId,
    });
    if (!boundaryKey || !target?.recipientMemberId) {
      continue;
    }

    const parent = parentsByBoundary.get(boundaryKey);
    if (parent?.status === "sent") {
      continue;
    }
    blockedRecipientIntentIds.add(intent.intentId);
    if (parent && isActiveHostedAssistantOutboxIntent(parent)) {
      continue;
    }
    if (!isActiveHostedAssistantOutboxIntent(intent)) {
      continue;
    }

    await markAssistantOutboxIntentMirrorTerminalById({
      error: new VaultCliError(
        "ASSISTANT_GROUP_EMAIL_PARENT_UNAVAILABLE",
        "Group email recipient delivery was abandoned because its parent manifest was not sent.",
      ),
      intentId: intent.intentId,
      onlyCurrentStatuses: ["awaiting_approval", "pending", "retryable", "sending"],
      status: "abandoned",
      vault: input.vaultRoot,
    });
  }
  return blockedRecipientIntentIds;
}

function isActiveHostedAssistantOutboxIntent(
  intent: AssistantOutboxIntent,
): boolean {
  return (
    intent.status === "awaiting_approval"
    || intent.status === "pending"
    || intent.status === "retryable"
    || intent.status === "sending"
  );
}

function formatHostedAssistantDeliveryBoundaryKey(
  fields: HostedAssistantDeliveryBoundaryFields,
): string {
  return JSON.stringify([
    fields.turnId,
    fields.sessionId,
    fields.channel,
    fields.identityId,
    fields.actorId,
    fields.bindingDeliveryKind,
    fields.bindingDeliveryTarget,
    fields.deliverySourceKey,
    fields.explicitTarget,
    fields.threadId,
    fields.threadIsDirect,
  ]);
}

function readHostedAssistantDeliverySourceKey(
  deliverySource: AssistantOutboxIntent["deliverySource"] | null | undefined,
): string | null {
  if (deliverySource?.kind !== "linq") {
    return null;
  }
  return `linq:${deliverySource.fromPhoneNumber.trim()}`;
}

function compareHostedAssistantForegroundDeliveryCandidateIntents(input: {
  left: AssistantOutboxIntent;
  preferredBoundaryOrder: ReadonlyMap<string, number>;
  preferredIntentOrder: ReadonlyMap<string, number>;
  right: AssistantOutboxIntent;
}): number {
  const preferredOrderDelta =
    readPreferredHostedAssistantDeliveryOrder(
      input.left,
      input.preferredIntentOrder,
      input.preferredBoundaryOrder,
    )
    - readPreferredHostedAssistantDeliveryOrder(
      input.right,
      input.preferredIntentOrder,
      input.preferredBoundaryOrder,
    );
  if (preferredOrderDelta !== 0) {
    return preferredOrderDelta;
  }

  if (
    readHostedAssistantDeliveryBoundaryKey(input.left)
    === readHostedAssistantDeliveryBoundaryKey(input.right)
  ) {
    return compareHostedAssistantDeliveryBoundaryIntents(input.left, input.right);
  }

  return compareHostedAssistantDeliveryCandidateIntents(input.left, input.right);
}

function compareHostedAssistantDeliveryCandidateIntents(
  left: AssistantOutboxIntent,
  right: AssistantOutboxIntent,
): number {
  if (
    readHostedAssistantDeliveryBoundaryKey(left)
    === readHostedAssistantDeliveryBoundaryKey(right)
  ) {
    return compareHostedAssistantDeliveryBoundaryIntents(left, right);
  }

  const priorityDelta =
    readHostedAssistantDeliveryCandidatePriority(left)
    - readHostedAssistantDeliveryCandidatePriority(right);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  const createdAtDelta = compareHostedAssistantDeliveryCandidateCreatedAt(left, right);
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }
  return left.intentId.localeCompare(right.intentId);
}

function compareHostedAssistantDeliveryBoundaryIntents(
  left: AssistantOutboxIntent,
  right: AssistantOutboxIntent,
): number {
  return compareHostedAssistantDeliveryOperationOrder(left, right)
    || compareAssistantOutboxDeliverySequenceOrder(left, right)
    || compareHostedAssistantDeliveryCandidateCreatedAt(left, right)
    || left.intentId.localeCompare(right.intentId);
}

function compareHostedAssistantDeliveryOperationOrder(
  left: AssistantOutboxIntent,
  right: AssistantOutboxIntent,
): number {
  return readHostedAssistantDeliveryOperationPriority(left)
    - readHostedAssistantDeliveryOperationPriority(right);
}

function readHostedAssistantDeliveryOperationPriority(
  intent: AssistantOutboxIntent,
): number {
  if (intent.operation?.kind !== "message-reaction") {
    return 1;
  }
  return intent.deliveryTransportIdempotent ? 0 : 2;
}

function compareHostedAssistantDeliveryCandidateCreatedAt(
  left: AssistantOutboxIntent,
  right: AssistantOutboxIntent,
): number {
  return compareHostedIsoTimestampsAscending(
    readHostedAssistantDeliveryCandidateCreatedAt(left),
    readHostedAssistantDeliveryCandidateCreatedAt(right),
  );
}

function readHostedAssistantDeliveryCandidatePriority(
  intent: AssistantOutboxIntent,
): number {
  switch (intent.status) {
    case "pending":
      return 0;
    case "retryable":
      return 1;
    case "sending":
      return 2;
    default:
      return 3;
  }
}

function readHostedAssistantDeliveryCandidateCreatedAt(
  intent: AssistantOutboxIntent,
): string {
  return typeof intent.createdAt === "string" ? intent.createdAt : "";
}

export async function resolveHostedAssistantOutboxNextWakeAt(input: {
  now?: Date;
  vaultRoot: string;
}): Promise<string | null> {
  const now = input.now ?? new Date();
  const intents = await listAssistantOutboxIntents(input.vaultRoot);
  let wakeAt: string | null = null;

  for (const boundaryIntents of groupHostedAssistantDeliveryBoundaryIntents(
    intents,
  ).values()) {
    const candidate = resolveHostedAssistantDeliveryBoundaryWakeAt(
      boundaryIntents,
      now,
    );
    if (!candidate) {
      continue;
    }
    if (!wakeAt || candidate < wakeAt) {
      wakeAt = candidate;
    }
  }

  return wakeAt;
}

function resolveHostedAssistantDeliveryBoundaryWakeAt(
  intents: readonly AssistantOutboxIntent[],
  now: Date,
): string | null {
  let approvalFallbackWakeAt: string | null = null;
  for (const intent of intents) {
    const wakeAt = resolveHostedAssistantOutboxIntentWakeAt(intent, now);
    if (!wakeAt) {
      continue;
    }
    if (intent.status === "awaiting_approval") {
      if (!approvalFallbackWakeAt || wakeAt < approvalFallbackWakeAt) {
        approvalFallbackWakeAt = wakeAt;
      }
      continue;
    }
    return approvalFallbackWakeAt && approvalFallbackWakeAt < wakeAt
      ? approvalFallbackWakeAt
      : wakeAt;
  }
  return approvalFallbackWakeAt;
}

function resolveHostedAssistantOutboxIntentWakeAt(
  intent: AssistantOutboxIntent,
  now: Date,
): string | null {
  switch (intent.status) {
    case "awaiting_approval":
    case "pending":
    case "retryable": {
      if (
        intent.status === "retryable"
        && !intent.deliveryTransportIdempotent
        && intent.lastError?.code === "ASSISTANT_DELIVERY_CONFIRMATION_PENDING"
        && !readHostedAcceptedLinqReactionDeliveryAwaitingConsume(intent)
      ) {
        return null;
      }
      const nextAttemptMs = intent.nextAttemptAt ? Date.parse(intent.nextAttemptAt) : Number.NaN;
      if (!Number.isFinite(nextAttemptMs)) {
        return now.toISOString();
      }
      return new Date(nextAttemptMs).toISOString();
    }
    case "sending": {
      const startedAtMs = intent.lastAttemptAt ? Date.parse(intent.lastAttemptAt) : Number.NaN;
      if (!Number.isFinite(startedAtMs)) {
        return now.toISOString();
      }
      if (!intent.deliveryTransportIdempotent) {
        const graceWakeMs = startedAtMs + HOSTED_NON_IDEMPOTENT_CONFIRMATION_GRACE_MS;
        if (graceWakeMs > now.getTime()) {
          return new Date(graceWakeMs).toISOString();
        }
      }
      const wakeMs = startedAtMs + HOSTED_SENDING_STALE_RECONCILIATION_MS;
      return new Date(Math.max(wakeMs, now.getTime())).toISOString();
    }
    default:
      return null;
  }
}

export async function prepareHostedAssistantDeliveryEffectsForDispatch(input: {
  assistantDeliveryEffects: HostedAssistantDeliveryEffect[];
  selectedNonIdempotentEffectIds?: readonly string[];
  linqDeliveryContext?: HostedAssistantLinqDeliveryContext | null;
  linqDeliveryContexts?: readonly HostedAssistantLinqDeliveryContext[] | null;
  now?: () => string;
  vaultRoot: string;
}): Promise<HostedAssistantDeliveryPreparation> {
  const startedAt = (input.now ?? (() => new Date().toISOString()))();
  const preparedDispatches: HostedAssistantDeliveryPreparedDispatch[] = [];
  const selectedNonIdempotentEffectIds = new Set(
    input.selectedNonIdempotentEffectIds ?? [],
  );
  const linqDeliveryContexts = resolveHostedAssistantLinqDeliveryContexts({
    context: input.linqDeliveryContext ?? null,
    contexts: input.linqDeliveryContexts ?? null,
  });
  for (const effect of input.assistantDeliveryEffects) {
    if (!shouldPrepareHostedAssistantDeliveryEffectForDispatch(
      effect,
      selectedNonIdempotentEffectIds.has(effect.effectId),
    )) {
      continue;
    }
    const linqDeliveryContext = resolveHostedAssistantLinqDeliveryContextForEffect({
      contexts: linqDeliveryContexts,
      effect,
    });
    const prepared = await beginAssistantOutboxIntentMirrorPreparedDispatch({
      deliveryIdempotencyKey: effect.payload.idempotencyKey,
      deliveryTransportIdempotent: effect.payload.transportIdempotent,
      ...(linqDeliveryContext?.routeAuthority
        ? { externalThreadRouteAuthority: linqDeliveryContext.routeAuthority }
        : {}),
      ...(linqDeliveryContext?.service
        ? { externalThreadService: linqDeliveryContext.service }
        : {}),
      intentId: effect.effectId,
      startedAt,
      vault: input.vaultRoot,
    });
    if (prepared?.ownsDispatch === true && prepared.preparedDispatchToken) {
      const preparedLinqDeliveryContext = linqDeliveryContext
        ?? buildHostedAssistantLinqDeliveryContextFromPreparedIntent({
          effect,
          intent: prepared.intent,
        });
      preparedDispatches.push({
        intentId: effect.effectId,
        ...(preparedLinqDeliveryContext
          ? { linqDeliveryContext: preparedLinqDeliveryContext }
          : {}),
        preparedDispatchToken: prepared.preparedDispatchToken,
        previousDispatchState: prepared.previousDispatchState,
      });
    }
  }
  return {
    preparedDispatches,
  };
}

function shouldPrepareHostedAssistantDeliveryEffectForDispatch(
  effect: HostedAssistantDeliveryEffect,
  explicitlyPrepareNonIdempotent: boolean,
): boolean {
  return !hasHostedAssistantVaultFileMedia(effect.payload)
    && (explicitlyPrepareNonIdempotent
      || effect.payload.transportIdempotent
      || isHostedAssistantReactionOnlyEffect(effect)
      || hasHostedAssistantVoiceMemoMedia(effect.payload)
      || isHostedSignupWelcomeDeliveryPayload(effect.payload));
}

function hasHostedAssistantVoiceMemoMedia(
  payload: HostedAssistantDeliveryPayload,
): boolean {
  return payload.media.some((item) => item.kind === "voice_memo");
}

function hasHostedAssistantVaultFileMedia(
  payload: HostedAssistantDeliveryPayload,
): boolean {
  return payload.media.some((item) => item.kind === "vault_file");
}

function resolveHostedAssistantLinqDeliveryContextForEffect(input: {
  contexts: readonly HostedAssistantLinqDeliveryContext[];
  effect: HostedAssistantDeliveryEffect;
}): HostedAssistantLinqDeliveryContext | null {
  for (const target of readHostedAssistantDeliveryPayloadTargets(input.effect.payload)) {
    const context = resolveHostedAssistantLinqDeliveryContextFromCandidatesForRequest({
      contexts: input.contexts,
      replyToMessageId: input.effect.payload.replyToMessageId,
      target: target.target,
      targetKind: target.targetKind,
    });
    if (context) {
      return context;
    }
  }

  return null;
}

function buildHostedAssistantLinqDeliveryContextFromPreparedIntent(input: {
  effect: HostedAssistantDeliveryEffect;
  intent: Pick<
    AssistantOutboxIntent,
    "externalThreadRouteAuthority" | "externalThreadService"
  >;
}): HostedAssistantLinqDeliveryContext | null {
  const authority = input.intent.externalThreadRouteAuthority ?? null;
  if (!authority || authority.channel !== "linq") {
    return null;
  }
  const routeAuthority: HostedExecutionLinqExternalThreadRouteAuthority = {
    ...authority,
    channel: "linq",
  };

  return {
    directRecipientPhoneNumber: null,
    fromPhoneNumber: null,
    replyToMessageId: input.effect.payload.replyToMessageId,
    routeAuthority,
    service: input.intent.externalThreadService ?? null,
    target: routeAuthority.threadId,
    threadIsDirect: input.effect.payload.threadIsDirect,
  };
}

export function createHostedAssistantProgressDeliveryDependencies(input: {
  effectsPort?: Pick<
    HostedRuntimeEffectsPort,
    "assertLinqRecentInboundEngagement" | "recordLinqDeliveryOutcome" | "sendEmail"
  > | null;
  forwardedEnv?: Readonly<Record<string, string>>;
  latencyTrace?: Omit<HostedAssistantMilestoneTraceContext, "assistantInputIds"> | null;
  linqDeliveryContext?: HostedAssistantLinqDeliveryContext | null;
  linqDeliveryContexts?: readonly HostedAssistantLinqDeliveryContext[] | null;
  platform?: Pick<HostedRuntimePlatform, "logPort"> | null;
  platformEnv?: Readonly<Record<string, string>>;
  providerFetch?: typeof fetch | null;
  publicInternetFetch?: typeof fetch | null;
  signal?: AbortSignal | null;
  userEnv?: Readonly<Record<string, string>>;
  wake?: HostedRuntimeEvent | null;
}): AssistantHostedProgressDeliveryDependencies {
  const telegramEnv = buildHostedTelegramChannelEnv({
    forwardedEnv: input.forwardedEnv ?? {},
    platformEnv: input.platformEnv,
  }) as NodeJS.ProcessEnv;
  const linqEnv = buildHostedLinqChannelEnv({
    forwardedEnv: input.forwardedEnv ?? {},
    userEnv: input.userEnv ?? {},
  }) as NodeJS.ProcessEnv;
  const linqDeliveryContexts = resolveHostedAssistantLinqDeliveryContexts({
    context: input.linqDeliveryContext ?? null,
    contexts: input.linqDeliveryContexts ?? null,
    wake: input.wake ?? null,
  });

  return {
    ...(input.signal ? { signal: input.signal } : {}),
    sendTelegram: createHostedAssistantTelegramSendDependency({
      providerFetch: input.providerFetch ?? null,
      signal: input.signal ?? null,
      telegramEnv,
    }),
    sendTelegramImage: createHostedAssistantTelegramImageSendDependency({
      providerFetch: input.providerFetch ?? null,
      signal: input.signal ?? null,
      telegramEnv,
    }),
    sendLinq: createHostedAssistantLinqSendDependency({
      effectsPort: input.effectsPort ?? null,
      linqEnv,
      linqDeliveryContexts,
      platform: input.platform ?? null,
      onProviderAccepted: ({
        acceptedAssistantInputIds,
        acceptedAt,
      }) => {
        recordHostedAssistantMilestonesBestEffort({
          context:
            input.latencyTrace && acceptedAssistantInputIds.length > 0
              ? {
                  ...input.latencyTrace,
                  assistantInputIds: acceptedAssistantInputIds,
                }
              : null,
          milestones: [{
            at: acceptedAt.toISOString(),
            milestone: "progress_update_accepted",
          }],
        });
      },
      providerFetch: input.providerFetch ?? null,
      publicInternetFetch: input.publicInternetFetch ?? null,
      signal: input.signal ?? null,
    }),
    sendLinqVoiceMemo: createHostedAssistantLinqVoiceMemoSendDependency({
      effectsPort: input.effectsPort ?? null,
      linqEnv,
      linqDeliveryContexts,
      providerFetch: input.providerFetch ?? null,
      signal: input.signal ?? null,
    }),
    ...(input.effectsPort
      ? {
          sendEmail: createHostedAssistantEmailSendDependency({
            effectsPort: input.effectsPort,
          }),
        }
      : {}),
  };
}

function createHostedAssistantTelegramSendDependency(input: {
  providerFetch: typeof fetch | null;
  signal: AbortSignal | null;
  telegramEnv: NodeJS.ProcessEnv;
}): NonNullable<AssistantHostedProgressDeliveryDependencies["sendTelegram"]> {
  return async (request) => {
    const dependencies = requireHostedProviderFetchDependencies({
      env: input.telegramEnv,
      fetchImplementation: input.providerFetch,
      ...(request.signal ?? input.signal
        ? { signal: request.signal ?? input.signal ?? undefined }
        : {}),
    }, "Hosted assistant Telegram progress delivery");
    return await sendTelegramMessage({
      idempotencyKey: request.idempotencyKey ?? null,
      message: request.message,
      replyToMessageId: request.replyToMessageId ?? null,
      target: request.target,
    }, dependencies);
  };
}

function createHostedAssistantTelegramImageSendDependency(input: {
  providerFetch: typeof fetch | null;
  signal: AbortSignal | null;
  telegramEnv: NodeJS.ProcessEnv;
}): NonNullable<AssistantHostedProgressDeliveryDependencies["sendTelegramImage"]> {
  return async (request) => {
    const dependencies = requireHostedProviderFetchDependencies({
      env: input.telegramEnv,
      fetchImplementation: input.providerFetch,
      ...(request.signal ?? input.signal
        ? { signal: request.signal ?? input.signal ?? undefined }
        : {}),
    }, "Hosted assistant Telegram image delivery");
    return await sendTelegramImageMessage({
      idempotencyKey: request.idempotencyKey ?? null,
      media: request.media,
      message: request.message,
      replyToMessageId: request.replyToMessageId ?? null,
      target: request.target,
    }, dependencies);
  };
}

function createHostedAssistantEmailSendDependency(input: {
  effectsPort: Pick<HostedRuntimeEffectsPort, "sendEmail">;
}): NonNullable<AssistantHostedProgressDeliveryDependencies["sendEmail"]> {
  return async (request) => {
    if (request.targetKind === "participant") {
      throw new VaultCliError(
        "ASSISTANT_HOSTED_EMAIL_PARTICIPANT_UNSUPPORTED",
        "Hosted email participant delivery is not supported. Use an explicit recipient or a serialized thread target.",
      );
    }

    return await input.effectsPort.sendEmail({
      idempotencyKey: request.idempotencyKey ?? null,
      message: request.message,
      replyToMessageId: request.replyToMessageId ?? null,
      subject: request.subject ?? null,
      target: request.target,
      targetKind: request.targetKind,
    });
  };
}

export async function drainHostedPreparedAssistantDeliveries(input: {
  actionApprovalPort?: HostedRuntimeActionApprovalPort | null;
  allowPreparedSending?: boolean;
  effectsPort: HostedRuntimeEffectsPort;
  assistantDeliveryEffects: HostedAssistantDeliveryEffect[];
  assertLiveness?: () => Promise<void>;
  forwardedEnv?: Readonly<Record<string, string>>;
  linqDeliveryContext?: HostedAssistantLinqDeliveryContext | null;
  linqDeliveryContexts?: readonly HostedAssistantLinqDeliveryContext[] | null;
  onBackgroundDeliveryYield?: (input: {
    yieldedEffectCount: number;
  }) => void;
  platform?: Pick<HostedRuntimePlatform, "logPort"> | null;
  platformEnv?: Readonly<Record<string, string>>;
  preparedDispatches?: readonly HostedAssistantDeliveryPreparedDispatch[] | null;
  providerFetch?: typeof fetch | null;
  publicInternetFetch?: typeof fetch | null;
  shouldYieldBackgroundDelivery?: (() => boolean) | null;
  signal?: AbortSignal | null;
  userEnv?: Readonly<Record<string, string>>;
  vaultRoot: string;
  wake: HostedRuntimeEvent;
}): Promise<HostedAssistantDeliveryOutcome[]> {
  const telegramEnv = buildHostedTelegramChannelEnv({
    forwardedEnv: input.forwardedEnv ?? {},
    platformEnv: input.platformEnv,
  }) as NodeJS.ProcessEnv;
  const telegramVoiceMemoEnv = buildHostedTelegramVoiceMemoChannelEnv({
    forwardedEnv: input.forwardedEnv ?? {},
    platformEnv: input.platformEnv,
  }) as NodeJS.ProcessEnv;
  const linqEnv = buildHostedLinqChannelEnv({
    forwardedEnv: input.forwardedEnv ?? {},
    userEnv: input.userEnv ?? {},
  }) as NodeJS.ProcessEnv;
  const linqDeliveryContexts = resolveHostedAssistantLinqDeliveryContexts({
    context: input.linqDeliveryContext ?? null,
    contexts: input.linqDeliveryContexts ?? null,
    wake: input.wake,
  });
  const outcomes: HostedAssistantDeliveryOutcome[] = [];
  const blockedForegroundDeliveryKeys = new Set<string>();
  const linqTypingStopDrain = createHostedLinqTypingStopDrain();
  const preparedDispatchByIntentId = new Map(
    (input.preparedDispatches ?? []).map((preparedDispatch) => [
      preparedDispatch.intentId,
      preparedDispatch,
    ]),
  );
  let pendingTypingStopEffectIndex = 0;
  try {
    for (let index = 0; index < input.assistantDeliveryEffects.length; index += 1) {
      pendingTypingStopEffectIndex = index;
      const assistantDeliveryEffect = input.assistantDeliveryEffects[index];
      if (!assistantDeliveryEffect) {
        continue;
      }
      if (await maybeYieldHostedPreparedAssistantDeliveryDrain({
        effects: input.assistantDeliveryEffects.slice(index),
        input,
        preparedDispatchByIntentId,
      })) {
        recordHostedLinqTypingStopStillPendingEffects({
          effects: input.assistantDeliveryEffects.slice(index),
          linqDeliveryContexts,
          preparedDispatchByIntentId,
          state: linqTypingStopDrain,
        });
        break;
      }
      if (blockedForegroundDeliveryKeys.has(
        readHostedAssistantDeliveryEffectBoundaryKey(assistantDeliveryEffect),
      )) {
        continue;
      }
      emitHostedExecutionStructuredLog({
        component: "assistant-delivery",
        details: buildHostedAssistantDeliveryDetails({
          effectFingerprint: assistantDeliveryEffect.fingerprint,
          effectId: assistantDeliveryEffect.effectId,
          extra: {
            deliveryPhase: assistantDeliveryEffect.deliveryPhase,
            eventType: assistantDeliveryEffect.deliveryPhase === "foreground_current_turn"
              ? "assistant.delivery.foreground_started"
              : "assistant.delivery.background_started",
          },
          userId: input.wake.userId,
        }),
        wake: input.wake,
        message: assistantDeliveryEffect.deliveryPhase === "foreground_current_turn"
          ? "Hosted assistant foreground delivery starting."
          : "Hosted assistant background delivery starting.",
        phase: "outbox",
        userId: input.wake.userId,
      });
      let outcome: HostedAssistantDeliveryOutcome;
      const preparedDispatch =
        preparedDispatchByIntentId.get(assistantDeliveryEffect.effectId) ?? null;
      const ownsPreparedDispatch =
        input.allowPreparedSending === true
        && preparedDispatch !== null;
      const effectLinqDeliveryContexts =
        preparedDispatch?.linqDeliveryContext
          ? [preparedDispatch.linqDeliveryContext, ...linqDeliveryContexts]
          : linqDeliveryContexts;
      let currentEffectTypingStopRecorded = false;
      try {
        outcome = await deliverHostedPreparedAssistantDelivery({
          actionApprovalPort: input.actionApprovalPort ?? null,
          wake: input.wake,
          effectsPort: input.effectsPort,
          allowPreparedSending: ownsPreparedDispatch,
          assertLiveness: input.assertLiveness,
          assistantDeliveryEffect,
          signal: input.signal ?? null,
          shouldYieldBackgroundDelivery: input.shouldYieldBackgroundDelivery ?? null,
          linqEnv,
          linqDeliveryContexts,
          platform: input.platform ?? null,
          preparedDispatch: ownsPreparedDispatch ? preparedDispatch : null,
          telegramEnv,
          telegramVoiceMemoEnv,
          providerFetch: input.providerFetch ?? null,
          publicInternetFetch: input.publicInternetFetch ?? null,
          userId: input.wake.userId,
          vaultRoot: input.vaultRoot,
          onTerminalLinqTypingStopFailure: (terminalOutcome) => {
            recordHostedLinqTypingStopOutcome({
              assistantDeliveryEffect,
              linqDeliveryContexts: effectLinqDeliveryContexts,
              outcome: terminalOutcome,
              state: linqTypingStopDrain,
            });
            currentEffectTypingStopRecorded = true;
          },
        });
      } catch (error) {
        pendingTypingStopEffectIndex = currentEffectTypingStopRecorded
          ? index + 1
          : index;
        const remainingEffects = input.assistantDeliveryEffects.slice(index + 1);
        await resetHostedPreparedAssistantDeliveryEffects({
          effects: remainingEffects,
          preparedDispatchByIntentId,
          vaultRoot: input.vaultRoot,
        });
        if (isHostedBackgroundDeliveryDeferredError(error)) {
          recordHostedLinqTypingStopStillPendingEffects({
            effects: input.assistantDeliveryEffects.slice(pendingTypingStopEffectIndex),
            linqDeliveryContexts,
            preparedDispatchByIntentId,
            state: linqTypingStopDrain,
          });
          input.onBackgroundDeliveryYield?.({
            yieldedEffectCount: input.assistantDeliveryEffects.length - index,
          });
          break;
        }
        throw error;
      }
      outcomes.push(outcome);
      recordHostedLinqTypingStopOutcome({
        assistantDeliveryEffect,
        linqDeliveryContexts: effectLinqDeliveryContexts,
        outcome,
        state: linqTypingStopDrain,
      });
      pendingTypingStopEffectIndex = index + 1;
      if (await maybeYieldHostedPreparedAssistantDeliveryDrain({
        effects: input.assistantDeliveryEffects.slice(index + 1),
        input,
        preparedDispatchByIntentId,
      })) {
        recordHostedLinqTypingStopStillPendingEffects({
          effects: input.assistantDeliveryEffects.slice(index + 1),
          linqDeliveryContexts,
          preparedDispatchByIntentId,
          state: linqTypingStopDrain,
        });
        break;
      }
      if (shouldBlockLaterHostedAssistantForegroundDeliveries({
        effect: assistantDeliveryEffect,
        outcome,
      })) {
        const boundaryKey = readHostedAssistantDeliveryEffectBoundaryKey(
          assistantDeliveryEffect,
        );
        const blockedEffects = input.assistantDeliveryEffects
          .slice(index + 1)
          .filter((effect) =>
            readHostedAssistantDeliveryEffectBoundaryKey(effect) === boundaryKey
          );
        blockedForegroundDeliveryKeys.add(boundaryKey);
        recordHostedLinqTypingStopStillPendingEffects({
          effects: blockedEffects,
          linqDeliveryContexts,
          preparedDispatchByIntentId,
          state: linqTypingStopDrain,
        });
        await resetHostedPreparedAssistantDeliveryEffects({
          effects: blockedEffects,
          preparedDispatchByIntentId,
          vaultRoot: input.vaultRoot,
        });
      }
      const nextEffect = input.assistantDeliveryEffects[index + 1] ?? null;
      if (shouldPauseBeforeNextHostedAssistantReplyBubble({
        currentEffect: assistantDeliveryEffect,
        nextEffect,
        outcome,
      })) {
        try {
          await waitForHostedAssistantReplyBubblePause(input.signal ?? null);
        } catch (error) {
          await resetHostedPreparedAssistantDeliveryEffects({
            effects: input.assistantDeliveryEffects.slice(index + 1),
            preparedDispatchByIntentId,
            vaultRoot: input.vaultRoot,
          });
          throw error;
        }
      }
    }
  } catch (error) {
    recordHostedLinqTypingStopStillPendingEffects({
      effects: input.assistantDeliveryEffects.slice(pendingTypingStopEffectIndex),
      linqDeliveryContexts,
      preparedDispatchByIntentId,
      state: linqTypingStopDrain,
    });
    throw error;
  } finally {
    flushHostedLinqTypingStopDrain({
      env: linqEnv,
      providerFetch: input.providerFetch ?? null,
      state: linqTypingStopDrain,
    });
  }

  return outcomes;
}

function shouldPauseBeforeNextHostedAssistantReplyBubble(input: {
  currentEffect: HostedAssistantDeliveryEffect;
  nextEffect: HostedAssistantDeliveryEffect | null;
  outcome: HostedAssistantDeliveryOutcome;
}): boolean {
  if (input.outcome.deliveryStatus !== "sent" || !input.nextEffect) {
    return false;
  }
  if (
    input.currentEffect.deliveryPhase !== "foreground_current_turn"
    || input.nextEffect.deliveryPhase !== "foreground_current_turn"
    || isHostedAssistantReactionOnlyEffect(input.currentEffect)
    || isHostedAssistantReactionOnlyEffect(input.nextEffect)
  ) {
    return false;
  }
  const currentChannel = normalizeHostedAssistantDeliveryChannel(
    input.currentEffect.payload.channel,
  )?.toLowerCase();
  const nextChannel = normalizeHostedAssistantDeliveryChannel(
    input.nextEffect.payload.channel,
  )?.toLowerCase();
  if (currentChannel !== "linq" || nextChannel !== "linq") {
    return false;
  }
  if (
    readHostedAssistantDeliveryEffectBoundaryKey(input.currentEffect)
    !== readHostedAssistantDeliveryEffectBoundaryKey(input.nextEffect)
  ) {
    return false;
  }
  return isAssistantOutboxReplyBubbleSuccessor(
    {
      deliveryIdempotencyKey: input.currentEffect.payload.idempotencyKey,
      turnId: input.currentEffect.payload.turnId,
    },
    {
      deliveryIdempotencyKey: input.nextEffect.payload.idempotencyKey,
      turnId: input.nextEffect.payload.turnId,
    },
  );
}

function waitForHostedAssistantReplyBubblePause(
  signal: AbortSignal | null,
): Promise<void> {
  assertHostedDeliveryLiveness(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      try {
        assertHostedDeliveryLiveness(signal);
      } catch (error) {
        reject(error);
      }
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, HOSTED_LINQ_REPLY_BUBBLE_PAUSE_MS);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
    }
  });
}

async function maybeYieldHostedPreparedAssistantDeliveryDrain(input: {
  effects: readonly HostedAssistantDeliveryEffect[];
  input: Pick<
    Parameters<typeof drainHostedPreparedAssistantDeliveries>[0],
    "onBackgroundDeliveryYield" | "shouldYieldBackgroundDelivery" | "vaultRoot"
  >;
  preparedDispatchByIntentId: ReadonlyMap<string, HostedAssistantDeliveryPreparedDispatch>;
}): Promise<boolean> {
  if (input.input.shouldYieldBackgroundDelivery?.() !== true) {
    return false;
  }

  await resetHostedPreparedAssistantDeliveryEffects({
    effects: input.effects,
    preparedDispatchByIntentId: input.preparedDispatchByIntentId,
    vaultRoot: input.input.vaultRoot,
  });
  input.input.onBackgroundDeliveryYield?.({
    yieldedEffectCount: input.effects.length,
  });
  return true;
}

function shouldBlockLaterHostedAssistantForegroundDeliveries(input: {
  effect: HostedAssistantDeliveryEffect;
  outcome: HostedAssistantDeliveryOutcome;
}): boolean {
  if (input.effect.deliveryPhase !== "foreground_current_turn") {
    return false;
  }
  if (isHostedAssistantReactionOnlyEffect(input.effect)) {
    return false;
  }
  if (input.outcome.deliveryStatus === "sent") {
    return false;
  }
  return input.outcome.retryable === true
    || input.outcome.deliveryStatus === "pending";
}

function markHostedDeliveryMayHaveSucceeded(error: unknown): unknown {
  if (typeof error === "object" && error !== null) {
    return Object.assign(error, {
      deliveryMayHaveSucceeded: true,
    });
  }

  return Object.assign(new Error("Hosted provider delivery may have succeeded."), {
    deliveryMayHaveSucceeded: true,
  });
}

function markHostedLinqAttachmentReservationMayHaveSucceeded(
  error: unknown,
): unknown {
  const markedError = typeof error === "object" && error !== null
    ? error
    : new Error("Hosted Linq attachment reservation may have succeeded.");
  return Object.assign(markedError, {
    deliveryMayHaveSucceeded: true,
    linqAttachmentReservationMayHaveSucceeded: true,
  });
}

function markHostedDeliveryPreProviderRetryable(error: unknown): unknown {
  if (typeof error === "object" && error !== null) {
    return Object.assign(error, {
      deliveryMayHaveSucceeded: false,
      retryable: true,
    });
  }

  return Object.assign(new Error("Hosted provider delivery did not start."), {
    deliveryMayHaveSucceeded: false,
    retryable: true,
  });
}

function markHostedDeliveryPreProvider(error: unknown): unknown {
  if (typeof error === "object" && error !== null) {
    return Object.assign(error, {
      deliveryMayHaveSucceeded: false,
    });
  }

  return Object.assign(new Error("Hosted provider delivery did not start."), {
    deliveryMayHaveSucceeded: false,
  });
}

function markHostedPhoneCallResultRouteRevocationRetryable(input: {
  error: unknown;
  idempotencyKey: string | null | undefined;
}): unknown {
  const idempotencyKey = input.idempotencyKey?.trim() ?? "";
  if (
    !idempotencyKey.startsWith(HOSTED_PHONE_CALL_RESULT_DELIVERY_KEY_PREFIX)
    || idempotencyKey.length === HOSTED_PHONE_CALL_RESULT_DELIVERY_KEY_PREFIX.length
    || typeof input.error !== "object"
    || input.error === null
    || !("code" in input.error)
    || input.error.code !== "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED"
  ) {
    return input.error;
  }

  return markHostedDeliveryPreProviderRetryable(input.error);
}

function createHostedEmailGroupRecipientAmbiguityError(): VaultCliError & {
  deliveryMayHaveSucceeded: true;
  retryable: false;
} {
  const error = new VaultCliError(
    "ASSISTANT_EMAIL_GROUP_FANOUT_INCOMPLETE",
    "Group email recipient delivery may have started; automatic retry is disabled to avoid duplicate email.",
  );

  return Object.assign(error, {
    deliveryMayHaveSucceeded: true as const,
    retryable: false as const,
  });
}

function hostedEmailResultProvesProviderWasSkipped(
  result: Awaited<ReturnType<HostedRuntimeEffectsPort["sendEmail"]>>,
): boolean {
  const delivery = result?.delivery;
  return Boolean(
    delivery
    && delivery.sentCount === 0
    && delivery.failedCount === 0
    && delivery.skippedCount > 0,
  );
}

function hostedDeliveryErrorProvesProviderWasSkipped(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "deliveryMayHaveSucceeded" in error
    && error.deliveryMayHaveSucceeded === false,
  );
}

function isHostedLinqProviderOutcomeAmbiguous(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  if (hostedDeliveryErrorProvesProviderWasSkipped(error)) {
    return false;
  }
  if (
    error instanceof VaultCliError
    && error.code === "LINQ_API_REQUEST_FAILED"
    && error.context?.operation === "create_attachment_upload"
  ) {
    const method = error.context.method;
    const status = error.context.status;
    if (method === "PUT") {
      return false;
    }
    if (
      method === "POST"
      && error.context.failureStage === "http"
      && typeof status === "number"
      && status >= 200
      && status <= 299
    ) {
      return true;
    }
    if (
      method === "POST"
      && error.context.failureStage === "http"
      && typeof status === "number"
      && status >= 400
      && status <= 499
      && status !== 408
    ) {
      return false;
    }
  }
  if (
    "deliveryMayHaveSucceeded" in error
    && error.deliveryMayHaveSucceeded === true
  ) {
    return true;
  }
  if (
    "code" in error
    && error.code === "ASSISTANT_DELIVERY_CONFIRMATION_PENDING"
  ) {
    return true;
  }
  if (error instanceof SyntaxError) {
    return true;
  }
  if (!(error instanceof VaultCliError) || error.code !== "LINQ_API_REQUEST_FAILED") {
    return false;
  }
  if (error.context?.failureStage === "transport") {
    return true;
  }
  const status = error.context?.status;
  return typeof status !== "number" || status === 408 || status >= 500;
}

class HostedBackgroundDeliveryYieldedError extends VaultCliError {
  constructor() {
    super(
      "HOSTED_BACKGROUND_DELIVERY_YIELDED",
      "Hosted background delivery yielded to fresh foreground input.",
      {
        assistantDeliveryFailureClass: "transient",
        assistantDeliveryResumeTrigger: "fresh_foreground_input",
        retryable: true,
      },
    );
  }
}

function isHostedBackgroundDeliveryYieldedError(
  error: unknown,
): error is HostedBackgroundDeliveryYieldedError {
  return error instanceof HostedBackgroundDeliveryYieldedError;
}

function isHostedBackgroundDeliveryDeferredError(error: unknown): boolean {
  if (isHostedBackgroundDeliveryYieldedError(error)) {
    return true;
  }
  if (!hostedDeliveryErrorProvesProviderWasSkipped(error)) {
    return false;
  }

  const errorRecord = error as Record<string, unknown>;
  const context =
    typeof errorRecord.context === "object" && errorRecord.context !== null
      ? errorRecord.context as Record<string, unknown>
      : null;
  return (
    errorRecord.assistantDeliveryResumeTrigger
    ?? context?.assistantDeliveryResumeTrigger
  ) === "fresh_foreground_input";
}

function assertHostedBackgroundDeliveryNotYielded(input: {
  shouldYieldBackgroundDelivery?: (() => boolean) | null;
}): void {
  if (input.shouldYieldBackgroundDelivery?.() === true) {
    throw markHostedDeliveryPreProviderRetryable(
      new HostedBackgroundDeliveryYieldedError(),
    );
  }
}

async function assertHostedDeliveryCanEnterProvider(input: {
  assertLiveness?: () => Promise<void>;
  shouldYieldBackgroundDelivery?: (() => boolean) | null;
  signal: AbortSignal | null;
}): Promise<void> {
  await assertHostedDeliveryLiveNow(input);
  assertHostedBackgroundDeliveryNotYielded(input);
}

async function assertHostedTelegramThreadRouteAuthorityAtProviderEntry(input: {
  assistantDeliveryEffect: HostedAssistantDeliveryEffect;
  delivery?: {
    media: readonly AssistantResponseMedia[];
    message: string;
  };
  effectsPort: HostedRuntimeEffectsPort;
  intent: AssistantOutboxIntent | null;
  signal: AbortSignal | null;
  target: string | null;
  userId: string;
  vaultRoot: string;
}): Promise<string | null> {
  const payload = input.assistantDeliveryEffect.payload;
  if (
    normalizeHostedAssistantDeliveryChannel(payload.channel)?.toLowerCase()
      !== "telegram"
  ) {
    return null;
  }

  const privateCompletion = input.intent
    && isHostedPrivateAssistantAskCompletionIntent(input.intent)
    ? input.intent
    : null;
  if (privateCompletion) {
    const target = input.target?.trim() ?? "";
    if (!input.delivery || input.delivery.media.length !== 0 || !target) {
      throw new VaultCliError(
        "ASSISTANT_ASK_PRIVATE_COMPLETION_TRANSPORT_INVALID",
        "Private Assistant Ask completion must use the text-only Telegram transport.",
        { retryable: false },
      );
    }
    return target;
  }

  const reviewedCompletion = input.intent
    && isHostedReviewedAssistantAskCompletionIntent(input.intent)
    ? input.intent
    : null;
  const authority = input.intent?.externalThreadRouteAuthority ?? null;
  if (
    !authority
    && !reviewedCompletion
    && (
      payload.threadIsDirect === true
      || !input.intent?.automationAuthority
    )
  ) {
    return null;
  }
  if (!authority) {
    if (!input.intent?.automationAuthority && !reviewedCompletion) {
      return null;
    }
    throw new VaultCliError(
      "ASSISTANT_EXTERNAL_THREAD_ROUTE_AUTHORITY_UNAVAILABLE",
      "Hosted group delivery requires live thread route authority before provider work.",
      { retryable: reviewedCompletion === null },
    );
  }

  const target = input.target?.trim() ?? "";
  if (
    authority.channel !== "telegram"
    || authority.containerMemberId !== input.userId
    || authority.threadId !== target
  ) {
    throw new VaultCliError(
      "ASSISTANT_EXTERNAL_THREAD_ROUTE_AUTHORITY_STALE",
      "Hosted group delivery route authority no longer matches its provider target.",
    );
  }

  const assertAuthority = input.effectsPort.assertExternalThreadRouteAuthority;
  if (!assertAuthority) {
    throw new VaultCliError(
      "ASSISTANT_EXTERNAL_THREAD_ROUTE_AUTHORITY_UNAVAILABLE",
      "Hosted group delivery requires live thread route authority before provider work.",
      { retryable: true },
    );
  }
  if (
    reviewedCompletion
    && (
      !input.delivery
      || input.delivery.media.length !== 0
      || payload.media.length !== 0
    )
  ) {
    throw new VaultCliError(
      "ASSISTANT_ASK_COMPLETION_TRANSPORT_INVALID",
      "Reviewed Assistant Ask completion must use the text-only Telegram transport.",
      { retryable: false },
    );
  }
  const completionExpiresAt = reviewedCompletion
    ? await prepareHostedReviewedAssistantAskProviderEntry({
        intentId: reviewedCompletion.intentId,
        media: input.delivery?.media ?? [],
        message: input.delivery?.message ?? "",
        now: new Date(),
        vaultRoot: input.vaultRoot,
      })
    : null;
  const completionIdempotencyKey =
    reviewedCompletion?.deliveryIdempotencyKey ?? null;
  const assertion = await assertAuthority(authority, {
    ...(reviewedCompletion && completionExpiresAt && completionIdempotencyKey
      ? {
          assistantAskCompletion: {
            answeredMailboxItemIds: reviewedCompletion.answeredMailboxItemIds,
            assistantAskCompletionExpiresAt: completionExpiresAt,
            assistantAskFallback:
              isHostedReviewedAssistantAskFallbackPayload(reviewedCompletion),
            idempotencyKey: completionIdempotencyKey,
          },
        }
      : {}),
    signal: input.signal,
  }).catch((error: unknown) => {
    throw markHostedPhoneCallResultRouteRevocationRetryable({
      error,
      idempotencyKey: input.intent?.deliveryIdempotencyKey,
    });
  });
  if (assertion?.assistantAskFallbackRequired === true) {
    if (!reviewedCompletion) {
      throw new VaultCliError(
        "ASSISTANT_ASK_COMPLETION_AUTHORITY_INVALID",
        "Assistant Ask fallback authority requires a reviewed completion.",
        { retryable: false },
      );
    }
    await persistHostedAssistantAskFallbackSupersession({
      intentId: reviewedCompletion.intentId,
      now: new Date(),
      vaultRoot: input.vaultRoot,
    });
    throw new VaultCliError(
      "ASSISTANT_ASK_COMPLETION_FALLBACK_RETRY",
      "Reviewed Assistant Ask completion changed to its safe fallback before provider delivery.",
      { retryable: true },
    );
  }
  return target;
}

async function resolveHostedDirectEmailRecipientAtProviderEntry(input: {
  assistantDeliveryEffect: HostedAssistantDeliveryEffect;
  effectsPort: HostedRuntimeEffectsPort;
  signal: AbortSignal | null;
  target: string;
  targetKind: "explicit" | "thread";
}): Promise<string> {
  const payload = input.assistantDeliveryEffect.payload;
  if (
    normalizeHostedAssistantDeliveryChannel(payload.channel)?.toLowerCase()
      !== "email"
    || payload.threadIsDirect !== true
  ) {
    return input.target;
  }

  const hostedEmailThreadTarget = input.targetKind === "thread"
    ? parseHostedEmailThreadTarget(input.target)
    : null;
  if (hostedEmailThreadTarget?.targetKind === "group") {
    return input.target;
  }

  const resolveRecipient =
    input.effectsPort.resolveCurrentVerifiedEmailRecipient;
  if (!resolveRecipient) {
    throw markHostedDeliveryPreProviderRetryable(new VaultCliError(
      "ASSISTANT_EMAIL_AUDIENCE_AUTHORITY_UNAVAILABLE",
      "Hosted direct email delivery requires current verified-email authority before provider work.",
      { retryable: true },
    ));
  }
  const recipient =
    (await resolveRecipient({ signal: input.signal }))?.trim() ?? "";
  if (!recipient) {
    throw markHostedDeliveryPreProviderRetryable(new VaultCliError(
      "ASSISTANT_EMAIL_AUDIENCE_AUTHORITY_UNAVAILABLE",
      "Hosted direct email delivery requires current verified-email authority before provider work.",
      { retryable: true },
    ));
  }
  if (input.targetKind === "explicit") {
    return recipient;
  }
  if (!hostedEmailThreadTarget) {
    return input.target;
  }

  return serializeHostedEmailThreadTarget({
    ...hostedEmailThreadTarget,
    cc: [],
    to: [recipient],
  });
}

function isHostedAssistantReactionOnlyEffect(
  effect: HostedAssistantDeliveryEffect,
): boolean {
  return (
    effect.payload.channel === "linq"
      || effect.payload.channel === "telegram"
  )
    && effect.payload.message.length === 0
    && effect.payload.media.length === 0
    && effect.payload.replyToMessageId !== null;
}

type HostedLinqTypingStopDrainState = Map<
  string,
  {
    sent: boolean;
    stillPending: boolean;
    terminalFailure: boolean;
  }
>;

function createHostedLinqTypingStopDrain(): HostedLinqTypingStopDrainState {
  return new Map();
}

function recordHostedLinqTypingStopOutcome(input: {
  assistantDeliveryEffect: HostedAssistantDeliveryEffect;
  linqDeliveryContexts: readonly HostedAssistantLinqDeliveryContext[];
  outcome: HostedAssistantDeliveryOutcome;
  state: HostedLinqTypingStopDrainState;
}): void {
  const target = resolveHostedLinqTypingStopTargetForEffect({
    assistantDeliveryEffect: input.assistantDeliveryEffect,
    linqDeliveryContexts: input.linqDeliveryContexts,
  });
  if (!target) {
    return;
  }
  if (
    input.outcome.deliveryStatus !== "sent"
    && !hostedAssistantDeliveryOutcomeShouldStopLinqTyping(input.outcome)
  ) {
    readHostedLinqTypingStopDrainEntry(input.state, target).stillPending = true;
    return;
  }

  const entry = readHostedLinqTypingStopDrainEntry(input.state, target);
  if (input.outcome.deliveryStatus === "sent") {
    entry.sent = true;
    return;
  }

  entry.terminalFailure = true;
}

function recordHostedLinqTypingStopStillPendingEffects(input: {
  effects: readonly HostedAssistantDeliveryEffect[];
  linqDeliveryContexts: readonly HostedAssistantLinqDeliveryContext[];
  preparedDispatchByIntentId: ReadonlyMap<string, HostedAssistantDeliveryPreparedDispatch>;
  state: HostedLinqTypingStopDrainState;
}): void {
  for (const effect of input.effects) {
    const preparedDispatch =
      input.preparedDispatchByIntentId.get(effect.effectId) ?? null;
    const linqDeliveryContexts = preparedDispatch?.linqDeliveryContext
      ? [preparedDispatch.linqDeliveryContext, ...input.linqDeliveryContexts]
      : input.linqDeliveryContexts;
    const target = resolveHostedLinqTypingStopTargetForEffect({
      assistantDeliveryEffect: effect,
      linqDeliveryContexts,
    });
    if (!target) {
      continue;
    }
    readHostedLinqTypingStopDrainEntry(input.state, target).stillPending = true;
  }
}

function flushHostedLinqTypingStopDrain(input: {
  env: NodeJS.ProcessEnv;
  providerFetch: typeof fetch | null;
  state: HostedLinqTypingStopDrainState;
}): void {
  for (const [target, entry] of input.state) {
    if (
      !entry.terminalFailure
      || entry.sent
      || entry.stillPending
    ) {
      continue;
    }

    // This skips the recent-inbound send guard intentionally: typing_stop carries
    // no message content, targets only the bound outbox delivery context, and
    // cannot exist for guard-blocked routes because typing start is guard-gated.
    void sendHostedProviderLinqChatAction({
      action: "typing_stop",
      target,
    }, {
      env: input.env,
      fetchImplementation: input.providerFetch,
    }).catch(() => undefined);
  }
}

function readHostedLinqTypingStopDrainEntry(
  state: HostedLinqTypingStopDrainState,
  target: string,
): {
  sent: boolean;
  stillPending: boolean;
  terminalFailure: boolean;
} {
  const existing = state.get(target);
  if (existing) {
    return existing;
  }
  const entry = {
    sent: false,
    stillPending: false,
    terminalFailure: false,
  };
  state.set(target, entry);
  return entry;
}

function resolveHostedLinqTypingStopTargetForEffect(input: {
  assistantDeliveryEffect: HostedAssistantDeliveryEffect;
  linqDeliveryContexts: readonly HostedAssistantLinqDeliveryContext[];
}): string | null {
  if (isHostedAssistantReactionOnlyEffect(input.assistantDeliveryEffect)) {
    return null;
  }
  const channel = normalizeHostedAssistantDeliveryChannel(
    input.assistantDeliveryEffect.payload.channel,
  )?.toLowerCase();
  if (channel !== "linq") {
    return null;
  }

  return resolveHostedLinqTypingStopTarget({
    assistantDeliveryEffect: input.assistantDeliveryEffect,
    linqDeliveryContexts: input.linqDeliveryContexts,
  });
}

function hostedAssistantDeliveryOutcomeShouldStopLinqTyping(
  outcome: HostedAssistantDeliveryOutcome | null,
): boolean {
  return outcome?.deliveryStatus === "failed"
    || outcome?.deliveryStatus === "failed_ambiguous"
    || outcome?.deliveryStatus === "missing-result";
}

function resolveHostedLinqTypingStopTarget(input: {
  assistantDeliveryEffect: HostedAssistantDeliveryEffect;
  linqDeliveryContexts: readonly HostedAssistantLinqDeliveryContext[];
}): string | null {
  const payload = input.assistantDeliveryEffect.payload;
  const payloadTarget = readHostedAssistantDeliveryPayloadTarget(payload);
  const deliveryContext = payloadTarget.target
    ? resolveHostedAssistantLinqDeliveryContextFromCandidatesForRequest({
      contexts: input.linqDeliveryContexts,
      replyToMessageId: payload.replyToMessageId,
      target: payloadTarget.target,
      targetKind: payloadTarget.targetKind,
    })
    : null;
  return deliveryContext?.target ?? payloadTarget.target;
}

export async function resetHostedPreparedAssistantDeliveryEffects(input: {
  effects: readonly HostedAssistantDeliveryEffect[];
  minimumNextAttemptAt?: Date | null;
  preparedDispatchByIntentId?: ReadonlyMap<string, HostedAssistantDeliveryPreparedDispatch>;
  preparedDispatches?: readonly HostedAssistantDeliveryPreparedDispatch[] | null;
  vaultRoot: string;
}): Promise<void> {
  const preparedDispatchByIntentId = input.preparedDispatchByIntentId
    ?? new Map(
      (input.preparedDispatches ?? []).map((preparedDispatch) => [
        preparedDispatch.intentId,
        preparedDispatch,
      ]),
    );
  for (const effect of input.effects) {
    const preparedDispatch =
      preparedDispatchByIntentId.get(effect.effectId) ?? null;
    if (!preparedDispatch) {
      continue;
    }
    await resetAssistantOutboxPreparedDispatchById({
      deliveryTransportIdempotent: effect.payload.transportIdempotent,
      intentId: effect.effectId,
      ...(input.minimumNextAttemptAt
        ? { minimumNextAttemptAt: input.minimumNextAttemptAt }
        : {}),
      preparedDispatchToken: preparedDispatch.preparedDispatchToken,
      resetAt: new Date(),
      ...(preparedDispatch.previousDispatchState
        ? { restoreDispatchState: preparedDispatch.previousDispatchState }
        : {}),
      vault: input.vaultRoot,
    });
  }
}

type HostedAcceptedLinqReactionDelivery = Extract<
  AssistantChannelDelivery,
  { kind: "message-reaction" }
>;

interface HostedAcceptedLinqReactionTiming {
  acceptedAt: Date;
  attemptedAt: Date;
}

function hostedLinqReactionRequiresExactConsumeConfirmation(
  intent: AssistantOutboxIntent,
): boolean {
  return intent.channel === "linq"
    && intent.operation?.kind === "message-reaction"
    && intent.answeredMailboxItemIds.length > 0;
}

function readHostedAcceptedLinqReactionDeliveryAwaitingConsume(
  intent: AssistantOutboxIntent,
): HostedAcceptedLinqReactionDelivery | null {
  const delivery = intent.delivery;
  if (
    !hostedLinqReactionRequiresExactConsumeConfirmation(intent)
    || delivery?.kind !== "message-reaction"
    || delivery.channel !== "linq"
    || delivery.reaction !== intent.operation?.reaction
    || delivery.targetMessageId !== intent.replyToMessageId
    || !(
      delivery.idempotencyKey?.trim()
      || intent.deliveryIdempotencyKey?.trim()
    )
  ) {
    return null;
  }

  return delivery;
}

function buildHostedAcceptedLinqReactionOutcomeFromIntent(input: {
  intent: AssistantOutboxIntent;
  linqDeliveryContexts: readonly HostedAssistantLinqDeliveryContext[];
  timing: HostedAcceptedLinqReactionTiming | null;
}): {
  delivery: HostedAcceptedLinqReactionDelivery;
  outcome: HostedRuntimeLinqDeliveryOutcomeRequest;
} | null {
  const delivery = readHostedAcceptedLinqReactionDeliveryAwaitingConsume(
    input.intent,
  );
  if (!delivery) {
    return null;
  }

  const deliveryContext =
    resolveHostedAssistantLinqReactionDeliveryContextFromCandidatesForRequest({
      contexts: input.linqDeliveryContexts,
      target: delivery.target,
      targetMessageId: delivery.targetMessageId,
    });
  const idempotencyKey =
    delivery.idempotencyKey?.trim()
    || input.intent.deliveryIdempotencyKey?.trim()
    || null;
  if (!idempotencyKey) {
    return null;
  }
  const acceptedAt = input.timing?.acceptedAt ?? new Date(delivery.sentAt);
  const attemptedAt = input.timing?.attemptedAt ?? acceptedAt;

  return {
    delivery,
    outcome: buildHostedAssistantLinqDeliveryOutcomeRequest({
      acceptedAt,
      answeredMailboxItemIds: input.intent.answeredMailboxItemIds,
      attemptedAt,
      fromPhoneNumber: deliveryContext?.fromPhoneNumber ?? null,
      idempotencyKey,
      intentId: input.intent.intentId,
      providerTarget: delivery.target,
      providerThreadId: null,
      result: null,
      target: delivery.target,
      targetKind: delivery.targetKind,
      threadIsDirect:
        input.intent.threadIsDirect
        ?? deliveryContext?.threadIsDirect
        ?? null,
    }),
  };
}

async function confirmHostedAcceptedLinqReactionDelivery(input: {
  effectsPort: Pick<HostedRuntimeEffectsPort, "recordLinqDeliveryOutcome">;
  intent: AssistantOutboxIntent;
  linqDeliveryContexts: readonly HostedAssistantLinqDeliveryContext[];
  timing: HostedAcceptedLinqReactionTiming | null;
}): Promise<HostedAcceptedLinqReactionDelivery | null> {
  if (!hostedLinqReactionRequiresExactConsumeConfirmation(input.intent)) {
    return null;
  }
  const confirmation = buildHostedAcceptedLinqReactionOutcomeFromIntent(input);
  if (!confirmation) {
    throw markHostedDeliveryMayHaveSucceeded(new VaultCliError(
      "ASSISTANT_LINQ_REACTION_DELIVERY_RECEIPT_INVALID",
      "Accepted Linq reaction exact-consume confirmation requires its durable provider receipt.",
      { retryable: true },
    ));
  }

  try {
    await recordHostedAssistantLinqDeliveryOutcomeRequired({
      effectsPort: input.effectsPort,
      outcome: confirmation.outcome,
    });
  } catch (error) {
    throw markHostedDeliveryMayHaveSucceeded(error);
  }
  return confirmation.delivery;
}

async function deliverHostedPreparedAssistantDelivery(input: {
  actionApprovalPort: HostedRuntimeActionApprovalPort | null;
  allowPreparedSending: boolean;
  wake: HostedRuntimeEvent;
  effectsPort: HostedRuntimeEffectsPort;
  assertLiveness?: () => Promise<void>;
  assistantDeliveryEffect: HostedAssistantDeliveryEffect;
  signal: AbortSignal | null;
  shouldYieldBackgroundDelivery: (() => boolean) | null;
  linqEnv: NodeJS.ProcessEnv;
  linqDeliveryContexts: readonly HostedAssistantLinqDeliveryContext[];
  platform: Pick<HostedRuntimePlatform, "logPort"> | null;
  preparedDispatch: HostedAssistantDeliveryPreparedDispatch | null;
  telegramEnv: NodeJS.ProcessEnv;
  telegramVoiceMemoEnv: NodeJS.ProcessEnv;
  providerFetch: typeof fetch | null;
  publicInternetFetch: typeof fetch | null;
  userId: string;
  vaultRoot: string;
  onTerminalLinqTypingStopFailure?: (
    outcome: HostedAssistantDeliveryOutcome,
  ) => void;
}): Promise<HostedAssistantDeliveryOutcome> {
  const now = new Date();
  const mirrorState = await readAssistantOutboxIntentMirrorState({
    intentId: input.assistantDeliveryEffect.effectId,
    now,
    sendingGraceMs: HOSTED_NON_IDEMPOTENT_CONFIRMATION_GRACE_MS,
    vault: input.vaultRoot,
  });
  const linqDeliveryContexts = input.preparedDispatch?.linqDeliveryContext
    ? [input.preparedDispatch.linqDeliveryContext, ...input.linqDeliveryContexts]
    : input.linqDeliveryContexts;
  let providerDispatchEntered = false;
  let acceptedLinqReactionTiming: HostedAcceptedLinqReactionTiming | null = null;
  try {
    assertHostedDeliveryLiveness(input.signal);
    const mirrorOutcome = await maybeResolveHostedAssistantDeliveryFromMirror({
      allowPreparedSending: input.allowPreparedSending,
      assistantDeliveryEffect: input.assistantDeliveryEffect,
      mirrorState,
      now,
      userId: input.userId,
      vaultRoot: input.vaultRoot,
      wake: input.wake,
    });
    if (mirrorOutcome) {
      return mirrorOutcome;
    }

    assertHostedDeliveryLiveness(input.signal);
    assertSupportedHostedAssistantDeliveryPayload(input.assistantDeliveryEffect.payload);
    const disabledAutoReplyOutcome = await maybeFailHostedDisabledAutoReplyDelivery({
      assistantDeliveryEffect: input.assistantDeliveryEffect,
      mirrorState,
      userId: input.userId,
      vaultRoot: input.vaultRoot,
      wake: input.wake,
    });
    if (disabledAutoReplyOutcome) {
      return disabledAutoReplyOutcome;
    }
    assertHostedBackgroundDeliveryNotYielded(input);
    const telegramAuthorityBoundTarget =
      normalizeHostedAssistantDeliveryChannel(
        input.assistantDeliveryEffect.payload.channel,
      )?.toLowerCase() === "telegram"
      && mirrorState.intent?.externalThreadRouteAuthority?.channel === "telegram"
        ? mirrorState.intent.externalThreadRouteAuthority.threadId
        : null;
    const dispatched = await dispatchAssistantOutboxIntent({
      dispatchHooks: {
        persistDeliveredIntent: async ({ intent }) => {
          await confirmHostedAcceptedLinqReactionDelivery({
            effectsPort: input.effectsPort,
            intent,
            linqDeliveryContexts,
            timing: acceptedLinqReactionTiming,
          });
        },
        preflightDispatchIntent: async ({ intent, now: preflightNow, vault }) => {
          if (readHostedAcceptedLinqReactionDeliveryAwaitingConsume(intent)) {
            return { action: "continue" };
          }
          return preflightHostedAssistantDispatch({
            actionApprovalPort: input.actionApprovalPort,
            effectsPort: input.effectsPort,
            intent,
            linqDeliveryContexts,
            now: preflightNow,
            payload: input.assistantDeliveryEffect.payload,
            signal: input.signal,
            vaultRoot: vault,
          });
        },
        resolveDeliveredIntent: async ({ intent }) => {
          if (intent.delivery === null) {
            return null;
          }
          return confirmHostedAcceptedLinqReactionDelivery({
            effectsPort: input.effectsPort,
            intent,
            linqDeliveryContexts,
            timing: null,
          });
        },
        shouldRethrowDispatchError: ({ error }) =>
          input.preparedDispatch !== null
          && isHostedBackgroundDeliveryDeferredError(error),
      },
      dependencies: {
        sendEmail: async (request) => {
          if (request.targetKind === "participant") {
            throw new VaultCliError(
              "ASSISTANT_HOSTED_EMAIL_PARTICIPANT_UNSUPPORTED",
              "Hosted email participant delivery is not supported. Use an explicit recipient or a serialized thread target.",
            );
          }

          await assertHostedDeliveryCanEnterProvider(input);
          const providerTarget =
            await resolveHostedDirectEmailRecipientAtProviderEntry({
              assistantDeliveryEffect: input.assistantDeliveryEffect,
              effectsPort: input.effectsPort,
              signal: input.signal,
              target: request.target,
              targetKind: request.targetKind,
            });
          const hostedEmailThreadTarget = request.targetKind === "thread"
            ? parseHostedEmailThreadTarget(request.target)
            : null;
          const plansGroupFanout = Boolean(
            hostedEmailThreadTarget?.targetKind === "group"
            && !hostedEmailThreadTarget.recipientMemberId,
          );
          const sendsGroupRecipient = Boolean(
            hostedEmailThreadTarget?.targetKind === "group"
            && hostedEmailThreadTarget.recipientMemberId,
          );
          providerDispatchEntered = !plansGroupFanout;
          // The binding identityId is a privacy-blinded conversation identifier,
          // never a sender address. Hosted email always sends from the
          // config-owned sender, so it is intentionally not forwarded.
          let result: Awaited<ReturnType<HostedRuntimeEffectsPort["sendEmail"]>>;
          try {
            result = await input.effectsPort.sendEmail({
              html: input.assistantDeliveryEffect.payload.emailHtml ?? null,
              idempotencyKey: request.idempotencyKey ?? null,
              message: request.message,
              groupEmailAuthorizationProof:
                input.assistantDeliveryEffect.payload.groupEmailAuthorizationProof ?? null,
              planGroupFanout: true,
              replyToMessageId: request.replyToMessageId ?? null,
              subject: request.subject ?? null,
              target: providerTarget,
              targetKind: request.targetKind,
            });
          } catch (error) {
            if (plansGroupFanout) {
              providerDispatchEntered = false;
              if (!hostedDeliveryErrorProvesProviderWasSkipped(error)) {
                throw markHostedDeliveryPreProviderRetryable(error);
              }
            } else if (hostedDeliveryErrorProvesProviderWasSkipped(error)) {
              providerDispatchEntered = false;
            } else if (sendsGroupRecipient) {
              throw createHostedEmailGroupRecipientAmbiguityError();
            }
            throw error;
          }
          const providerWasSkipped =
            sendsGroupRecipient && hostedEmailResultProvesProviderWasSkipped(result);
          if (providerWasSkipped) {
            providerDispatchEntered = false;
          }
          if (result?.fanoutRecipientMemberIds) {
            await persistHostedEmailGroupFanoutIntents({
              assistantDeliveryEffect: input.assistantDeliveryEffect,
              fanoutRecipientMemberIds: result.fanoutRecipientMemberIds,
              fanoutTarget: result.target,
              vaultRoot: input.vaultRoot,
            });
          }
          try {
            await assertHostedDeliveryLiveNow(input);
          } catch (error) {
            if (sendsGroupRecipient && !providerWasSkipped) {
              throw createHostedEmailGroupRecipientAmbiguityError();
            }
            throw error;
          }
          return result;
        },
        sendTelegram: async (request) => {
          await assertHostedDeliveryCanEnterProvider(input);
          const privateCompletion = mirrorState.intent
            && isHostedPrivateAssistantAskCompletionIntent(mirrorState.intent)
            ? mirrorState.intent
            : null;
          if (privateCompletion) {
            await assertHostedPrivateAssistantAskCompletionAtProviderEntry({
              actualRoute: {
                actorId: input.assistantDeliveryEffect.payload.actorId,
                channel: "telegram",
                delivery: { kind: "thread", target: request.target },
                identityId: input.assistantDeliveryEffect.payload.identityId,
                threadId: input.assistantDeliveryEffect.payload.threadId,
                threadIsDirect:
                  input.assistantDeliveryEffect.payload.threadIsDirect,
              },
              effectsPort: input.effectsPort,
              intentId: privateCompletion.intentId,
              media: [],
              message: request.message,
              now: new Date(),
              signal: input.signal,
              vaultRoot: input.vaultRoot,
            });
          }
          const authorityBoundTarget =
            await assertHostedTelegramThreadRouteAuthorityAtProviderEntry({
              assistantDeliveryEffect: input.assistantDeliveryEffect,
              delivery: {
                media: [],
                message: request.message,
              },
              effectsPort: input.effectsPort,
              intent: mirrorState.intent,
              signal: input.signal,
              target: request.target,
              userId: input.userId,
              vaultRoot: input.vaultRoot,
            });
          const providerFetch = privateCompletion
              ? createHostedProviderFetchBoundary({
                assertProviderEntryLive: async () => {
                  try {
                    await assertHostedDeliveryCanEnterProvider(input);
                    await assertHostedPrivateAssistantAskCompletionAtProviderEntry({
                      actualRoute: {
                        actorId: input.assistantDeliveryEffect.payload.actorId,
                        channel: "telegram",
                        delivery: {
                          kind: "thread",
                          target: request.target,
                        },
                        identityId:
                          input.assistantDeliveryEffect.payload.identityId,
                        threadId: input.assistantDeliveryEffect.payload.threadId,
                        threadIsDirect:
                          input.assistantDeliveryEffect.payload.threadIsDirect,
                      },
                      effectsPort: input.effectsPort,
                      intentId: privateCompletion.intentId,
                      media: [],
                      message: request.message,
                      now: new Date(),
                      signal: input.signal,
                      vaultRoot: input.vaultRoot,
                    });
                  } catch (error) {
                    throw markHostedDeliveryPreProvider(error);
                  }
                },
                onProviderDispatchEntered: () => {
                  providerDispatchEntered = true;
                },
                operation: "Hosted private Assistant Ask Telegram delivery",
                providerFetch: input.providerFetch,
              })
            : input.providerFetch;
          const dependencies = requireHostedProviderFetchDependencies({
            ...(authorityBoundTarget ? { authorityBoundTarget } : {}),
            env: input.telegramEnv,
            fetchImplementation: providerFetch,
            ...(input.signal ? { signal: input.signal } : {}),
          }, "Hosted assistant Telegram delivery");
          if (!privateCompletion) {
            providerDispatchEntered = true;
          }
          const result = await sendTelegramMessage(request, dependencies);
          await assertHostedDeliveryLiveNow(input);
          return result;
        },
        sendTelegramRich: async (request) => {
          await assertHostedDeliveryCanEnterProvider(input);
          const privateCompletion = mirrorState.intent
            && isHostedPrivateAssistantAskCompletionIntent(mirrorState.intent)
            ? mirrorState.intent
            : null;
          if (privateCompletion) {
            await assertHostedPrivateAssistantAskCompletionAtProviderEntry({
              actualRoute: {
                actorId: input.assistantDeliveryEffect.payload.actorId,
                channel: "telegram",
                delivery: { kind: "thread", target: request.target },
                identityId: input.assistantDeliveryEffect.payload.identityId,
                threadId: input.assistantDeliveryEffect.payload.threadId,
                threadIsDirect:
                  input.assistantDeliveryEffect.payload.threadIsDirect,
              },
              effectsPort: input.effectsPort,
              intentId: privateCompletion.intentId,
              media: [],
              message: request.fallbackMessage,
              now: new Date(),
              signal: input.signal,
              vaultRoot: input.vaultRoot,
            });
          }
          const authorityBoundTarget =
            await assertHostedTelegramThreadRouteAuthorityAtProviderEntry({
              assistantDeliveryEffect: input.assistantDeliveryEffect,
              delivery: {
                media: [],
                message: request.fallbackMessage,
              },
              effectsPort: input.effectsPort,
              intent: mirrorState.intent,
              signal: input.signal,
              target: request.target,
              userId: input.userId,
              vaultRoot: input.vaultRoot,
            });
          const providerFetch = privateCompletion
            ? createHostedProviderFetchBoundary({
              assertProviderEntryLive: async () => {
                try {
                  await assertHostedDeliveryCanEnterProvider(input);
                  await assertHostedPrivateAssistantAskCompletionAtProviderEntry({
                    actualRoute: {
                      actorId: input.assistantDeliveryEffect.payload.actorId,
                      channel: "telegram",
                      delivery: {
                        kind: "thread",
                        target: request.target,
                      },
                      identityId:
                        input.assistantDeliveryEffect.payload.identityId,
                      threadId: input.assistantDeliveryEffect.payload.threadId,
                      threadIsDirect:
                        input.assistantDeliveryEffect.payload.threadIsDirect,
                    },
                    effectsPort: input.effectsPort,
                    intentId: privateCompletion.intentId,
                    media: [],
                    message: request.fallbackMessage,
                    now: new Date(),
                    signal: input.signal,
                    vaultRoot: input.vaultRoot,
                  });
                } catch (error) {
                  throw markHostedDeliveryPreProvider(error);
                }
              },
              onProviderDispatchEntered: () => {
                providerDispatchEntered = true;
              },
              operation: "Hosted private Assistant Ask Telegram rich delivery",
              providerFetch: input.providerFetch,
            })
            : input.providerFetch;
          const dependencies = requireHostedProviderFetchDependencies({
            ...(authorityBoundTarget ? { authorityBoundTarget } : {}),
            env: input.telegramEnv,
            fetchImplementation: providerFetch,
            ...(input.signal ? { signal: input.signal } : {}),
          }, "Hosted assistant Telegram rich delivery");
          if (!privateCompletion) {
            providerDispatchEntered = true;
          }
          const result = await sendTelegramRichMessage(request, dependencies);
          await assertHostedDeliveryLiveNow(input);
          return result;
        },
        sendTelegramImage: async (request) => {
          const verifiedVaultImages = await preloadHostedAssistantVaultImages({
            media: request.media,
            vaultRoot: input.vaultRoot,
          });
          await assertHostedDeliveryCanEnterProvider(input);
          const authorityBoundTarget =
            await assertHostedTelegramThreadRouteAuthorityAtProviderEntry({
              assistantDeliveryEffect: input.assistantDeliveryEffect,
              delivery: {
                media: request.media,
                message: request.message,
              },
              effectsPort: input.effectsPort,
              intent: mirrorState.intent,
              signal: request.signal ?? input.signal,
              target: request.target,
              userId: input.userId,
              vaultRoot: input.vaultRoot,
            });
          const dependencies = requireHostedProviderFetchDependencies({
            ...(authorityBoundTarget ? { authorityBoundTarget } : {}),
            env: input.telegramEnv,
            fetchImplementation: input.providerFetch,
            ...(request.signal ?? input.signal
              ? { signal: request.signal ?? input.signal ?? undefined }
              : {}),
            ...(verifiedVaultImages.size > 0
              ? {
                  loadVaultImage: async (
                    media: AssistantVaultImageResponseMedia,
                  ) => {
                    const bytes = verifiedVaultImages.get(
                      buildHostedVaultImageMediaIdentity(media),
                    );
                    if (!bytes) {
                      throw new VaultCliError(
                        "ASSISTANT_VAULT_IMAGE_IDENTITY_CONFLICT",
                        "The prepared private image no longer matches the outbox media.",
                      );
                    }
                    return bytes;
                  },
                }
              : {}),
          }, "Hosted assistant Telegram image delivery");
          providerDispatchEntered = true;
          const result = await sendTelegramImageMessage({
            idempotencyKey: request.idempotencyKey ?? null,
            media: request.media,
            message: request.message,
            replyToMessageId: request.replyToMessageId ?? null,
            target: request.target,
          }, dependencies);
          await assertHostedDeliveryLiveNow(input);
          return result;
        },
        setTelegramMessageReaction: async (request) => {
          await assertHostedDeliveryCanEnterProvider(input);
          const authorityBoundTarget =
            await assertHostedTelegramThreadRouteAuthorityAtProviderEntry({
              assistantDeliveryEffect: input.assistantDeliveryEffect,
              effectsPort: input.effectsPort,
              intent: mirrorState.intent,
              signal: input.signal,
              target: request.target,
              userId: input.userId,
              vaultRoot: input.vaultRoot,
            });
          const dependencies = requireHostedProviderFetchDependencies({
            ...(authorityBoundTarget ? { authorityBoundTarget } : {}),
            env: input.telegramEnv,
            fetchImplementation: input.providerFetch,
            ...(input.signal ? { signal: input.signal } : {}),
          }, "Hosted assistant Telegram reaction delivery");
          providerDispatchEntered = true;
          const result = await setTelegramMessageReaction(request, dependencies);
          await assertHostedDeliveryLiveNow(input);
          return result;
        },
        telegramVoiceMemoRuntime: {
          ...(telegramAuthorityBoundTarget
            ? { authorityBoundTarget: telegramAuthorityBoundTarget }
            : {}),
          env: input.telegramVoiceMemoEnv,
          fetchImplementation: createHostedProviderFetchBoundary({
            assertLive: () => assertHostedDeliveryLiveNow(input),
            assertProviderEntryLive: async () => {
              await assertHostedDeliveryCanEnterProvider(input);
              const target = readHostedAssistantDeliveryPayloadTarget(
                input.assistantDeliveryEffect.payload,
              ).target;
              await assertHostedTelegramThreadRouteAuthorityAtProviderEntry({
                assistantDeliveryEffect: input.assistantDeliveryEffect,
                effectsPort: input.effectsPort,
                intent: mirrorState.intent,
                signal: input.signal,
                target,
                userId: input.userId,
                vaultRoot: input.vaultRoot,
              });
            },
            onTelegramVoiceMemoDispatchEntered: () => {
              providerDispatchEntered = true;
            },
            operation: HOSTED_TELEGRAM_VOICE_MEMO_DELIVERY_OPERATION,
            providerFetch: input.providerFetch,
          }),
          ...(input.signal ? { signal: input.signal } : {}),
        },
        sendLinq: createHostedAssistantLinqSendDependency({
          actionApprovalPort: input.actionApprovalPort,
          assertLiveness: input.assertLiveness,
          deliveryRouteContext: {
            actorId: input.assistantDeliveryEffect.payload.actorId,
            identityId: input.assistantDeliveryEffect.payload.identityId,
            threadId: input.assistantDeliveryEffect.payload.threadId,
            threadIsDirect:
              input.assistantDeliveryEffect.payload.threadIsDirect,
          },
          effectsPort: input.effectsPort,
          expectedDedupeKey: input.assistantDeliveryEffect.fingerprint,
          intentId: input.assistantDeliveryEffect.effectId,
          linqEnv: input.linqEnv,
          linqDeliveryContexts,
          platform: input.platform,
          threadIsDirect: input.assistantDeliveryEffect.payload.threadIsDirect ?? null,
          shouldYieldBackgroundDelivery: input.shouldYieldBackgroundDelivery,
          onProviderDispatchEntered: () => {
            providerDispatchEntered = true;
          },
          onProviderDispatchSettledWithoutEffect: () => {
            providerDispatchEntered = false;
          },
          providerFetch: input.providerFetch,
          publicInternetFetch: input.publicInternetFetch,
          signal: input.signal,
          vaultRoot: input.vaultRoot,
        }),
        sendLinqVoiceMemo: createHostedAssistantLinqVoiceMemoSendDependency({
          assertLiveness: input.assertLiveness,
          effectsPort: input.effectsPort,
          linqEnv: input.linqEnv,
          linqDeliveryContexts,
          threadIsDirect: input.assistantDeliveryEffect.payload.threadIsDirect ?? null,
          shouldYieldBackgroundDelivery: input.shouldYieldBackgroundDelivery,
          onProviderDispatchEntered: () => {
            providerDispatchEntered = true;
          },
          intentId: input.assistantDeliveryEffect.effectId,
          providerFetch: input.providerFetch,
          signal: input.signal,
        }),
        setLinqMessageReaction: async (request) => {
          const deliveryContext = resolveHostedAssistantLinqReactionDeliveryContextFromCandidatesForRequest({
            contexts: linqDeliveryContexts,
            target: request.target,
            targetMessageId: request.targetMessageId,
          });
          const idempotencyKey =
            input.assistantDeliveryEffect.payload.idempotencyKey?.trim() || null;
          const engagement =
            await assertHostedAssistantLinqRecentInboundEngagementForDelivery({
              answeredMailboxItemIds:
                input.assistantDeliveryEffect.payload.answeredMailboxItemIds,
              authorityCheckOnly: true,
              directRecipientPhoneNumber:
                normalizeHostedLinqDirectRecipient(
                  deliveryContext?.directRecipientPhoneNumber,
                ),
              effectsPort: input.effectsPort,
              fromPhoneNumber:
                normalizeHostedLinqDirectRecipient(
                  deliveryContext?.fromPhoneNumber,
                ),
              homeRouteFallbackAllowed: false,
              idempotencyKey,
              intentId: input.assistantDeliveryEffect.effectId,
              replyToMessageId: request.targetMessageId,
              signal: input.signal,
              target: deliveryContext?.target ?? request.target,
              targetKind: "thread",
            });
          const resolvedRoute = requireHostedAssistantLinqResolvedRoute(engagement);
          if (resolvedRoute.targetKind !== "thread") {
            throw new VaultCliError(
              "ASSISTANT_LINQ_REACTION_THREAD_REQUIRED",
              "Hosted Linq reaction delivery requires a resolved thread route.",
              { retryable: false },
            );
          }
          const providerTarget = resolvedRoute.target;
          let attemptedAt: Date | null = null;
          let result: Awaited<ReturnType<typeof setHostedProviderLinqMessageReaction>>;
          try {
            result = await setHostedProviderLinqMessageReaction({
              reaction: request.reaction,
              targetMessageId: request.targetMessageId,
            }, {
              env: input.linqEnv,
              fetchImplementation: createHostedProviderFetchBoundary({
                assertProviderEntryLive: () => assertHostedDeliveryCanEnterProvider(input),
                onProviderDispatchEntered: async () => {
                  await assertHostedAssistantLinqRecentInboundEngagementForDelivery({
                    answeredMailboxItemIds:
                      input.assistantDeliveryEffect.payload.answeredMailboxItemIds,
                    authorityCheckOnly: false,
                    directRecipientPhoneNumber:
                      resolvedRoute.directRecipientPhoneNumber,
                    effectsPort: input.effectsPort,
                    expectedResolvedRoute: resolvedRoute,
                    fromPhoneNumber: resolvedRoute.fromPhoneNumber,
                    homeRouteFallbackAllowed: false,
                    idempotencyKey,
                    intentId: input.assistantDeliveryEffect.effectId,
                    replyToMessageId: request.targetMessageId,
                    providerDispatchRetrySafe: false,
                    signal: input.signal,
                    target: providerTarget,
                    targetKind: "thread",
                  });
                  attemptedAt = new Date();
                  providerDispatchEntered = true;
                },
                operation: "Hosted assistant Linq reaction delivery",
                providerFetch: input.providerFetch,
              }),
              ...(input.signal ? { signal: input.signal } : {}),
            });
          } catch (error) {
            if (!attemptedAt) {
              throw error;
            }
            if (isHostedLinqProviderOutcomeAmbiguous(error)) {
              throw markHostedDeliveryMayHaveSucceeded(error);
            }
            queueHostedAssistantLinqDeliveryOutcomeWrite({
              effectsPort: input.effectsPort,
              outcome: buildHostedAssistantLinqDeliveryOutcomeRequest({
                attemptedAt,
                answeredMailboxItemIds:
                  input.assistantDeliveryEffect.payload.answeredMailboxItemIds,
                failedAt: new Date(),
                failureCode: readHostedAssistantLinqDeliveryFailureCode(error),
                failureReason: readTrustedHostedAssistantLinqDeliveryFailureReason(error),
                fromPhoneNumber: resolvedRoute.fromPhoneNumber,
                idempotencyKey,
                intentId: input.assistantDeliveryEffect.effectId,
                providerTarget,
                providerThreadId: null,
                result: null,
                target: providerTarget,
                targetKind: "thread",
                threadIsDirect: resolvedRoute.threadIsDirect,
              }),
            });
            throw error;
          }
          const acceptedAt = new Date();
          const acceptedAttemptedAt =
            requireHostedLinqProviderAttemptedAt(attemptedAt);
          if (
            input.assistantDeliveryEffect.payload.answeredMailboxItemIds.length
              > 0
          ) {
            acceptedLinqReactionTiming = {
              acceptedAt,
              attemptedAt: acceptedAttemptedAt,
            };
          } else {
            queueHostedAssistantLinqDeliveryOutcomeWrite({
              effectsPort: input.effectsPort,
              outcome: buildHostedAssistantLinqDeliveryOutcomeRequest({
                acceptedAt,
                attemptedAt: acceptedAttemptedAt,
                fromPhoneNumber: resolvedRoute.fromPhoneNumber,
                idempotencyKey,
                intentId: input.assistantDeliveryEffect.effectId,
                providerTarget,
                providerThreadId: null,
                result: null,
                target: providerTarget,
                targetKind: "thread",
                threadIsDirect: resolvedRoute.threadIsDirect,
              }),
            });
            try {
              await assertHostedDeliveryLiveNow(input);
            } catch (error) {
              throw markHostedDeliveryMayHaveSucceeded(error);
            }
          }
          return {
            ...result,
            target: providerTarget,
          };
        },
      },
      intentId: input.assistantDeliveryEffect.effectId,
      now,
      ...(input.allowPreparedSending ? { allowPreparedSending: true } : {}),
      ...(input.allowPreparedSending && input.preparedDispatch
        ? {
            preparedDispatch: {
              deliveryIdempotencyKey: input.assistantDeliveryEffect.payload.idempotencyKey,
              deliveryTransportIdempotent:
                input.assistantDeliveryEffect.payload.transportIdempotent,
              preparedDispatchToken: input.preparedDispatch.preparedDispatchToken,
            },
          }
        : {}),
      vault: input.vaultRoot,
    });
    const resetDispatchResult = await maybeResetHostedPreparedDeliveryAfterPreProviderAbort({
      assistantDeliveryEffect: input.assistantDeliveryEffect,
      dispatchResult: dispatched,
      mirrorState,
      preparedDispatchToken: input.preparedDispatch?.preparedDispatchToken ?? null,
      previousPreparedDispatchState:
        input.preparedDispatch?.previousDispatchState ?? null,
      providerDispatchEntered,
      signal: input.signal,
      vaultRoot: input.vaultRoot,
    });
    if (resetDispatchResult) {
      return buildHostedAssistantDeliveryDispatchResult({
        assistantDeliveryEffect: input.assistantDeliveryEffect,
        dispatchResult: resetDispatchResult,
        userId: input.userId,
        vaultRoot: input.vaultRoot,
        wake: input.wake,
      });
    }
    try {
      await persistAssistantPrivateCompletionContinuityAfterDelivery({
        intent: dispatched.intent,
        vault: input.vaultRoot,
      });
    } catch (error) {
      // Provider delivery and required transport confirmation are already
      // durable. The attended direct-turn owner repairs optional continuity.
      emitHostedExecutionStructuredLog({
        component: "assistant-delivery",
        details: buildHostedAssistantDeliveryDetails({
          effectFingerprint: input.assistantDeliveryEffect.fingerprint,
          effectId: input.assistantDeliveryEffect.effectId,
          extra: {
            failureDomain: "private-continuity",
          },
          userId: input.userId,
        }),
        wake: input.wake,
        error,
        level: "warn",
        message: "Hosted private completion continuity persistence failed.",
        phase: "outbox",
        userId: input.userId,
      });
    }
    assertHostedDeliveryLiveness(input.signal);
    return buildHostedAssistantDeliveryDispatchResult({
      assistantDeliveryEffect: input.assistantDeliveryEffect,
      dispatchResult: dispatched,
      userId: input.userId,
      vaultRoot: input.vaultRoot,
      wake: input.wake,
    });
  } catch (error) {
    const resetPreparedDelivery =
      input.preparedDispatch !== null
      && shouldResetHostedPreparedDeliveryOnPreProviderAbort({
        assistantDeliveryEffect: input.assistantDeliveryEffect,
        error,
        mirrorState,
        providerDispatchEntered,
        signal: input.signal,
      });
    if (input.preparedDispatch && resetPreparedDelivery) {
      await resetAssistantOutboxPreparedDispatchById({
        deliveryTransportIdempotent: input.assistantDeliveryEffect.payload.transportIdempotent,
        intentId: input.assistantDeliveryEffect.effectId,
        preparedDispatchToken: input.preparedDispatch?.preparedDispatchToken ?? null,
        resetAt: new Date(),
        ...(input.preparedDispatch?.previousDispatchState
          ? { restoreDispatchState: input.preparedDispatch.previousDispatchState }
          : {}),
        vault: input.vaultRoot,
      });
    } else if (readHostedAssistantDeliveryRetryableFlag(error) !== true) {
      const deliveryError = normalizeAssistantDeliveryError(error);
      input.onTerminalLinqTypingStopFailure?.(
        buildHostedAssistantDeliveryOutcome({
          deliveryErrorCode: deliveryError.code,
          deliveryErrorDetails: normalizeHostedAssistantDeliveryErrorDetails(deliveryError),
          deliveryErrorMessage: deliveryError.message,
          deliveryStatus: "failed",
          effect: input.assistantDeliveryEffect,
          retryable: false,
        }),
      );
    }
    const enrichedError = attachHostedAssistantDeliveryDispatchDetails(error, {
      effectId: input.assistantDeliveryEffect.effectId,
      fingerprint: input.assistantDeliveryEffect.fingerprint,
      userId: input.userId,
    });
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: buildHostedAssistantDeliveryDetails({
        effectFingerprint: input.assistantDeliveryEffect.fingerprint,
        effectId: input.assistantDeliveryEffect.effectId,
        extra: {
          failureDomain: "delivery",
          retryable: readHostedAssistantDeliveryRetryableFlag(error),
        },
        userId: input.userId,
      }),
      wake: input.wake,
      error: enrichedError,
      message: "Hosted assistant delivery threw.",
      phase: "outbox",
      userId: input.userId,
    });
    throw enrichedError;
  }
}

async function persistHostedEmailGroupFanoutIntents(input: {
  assistantDeliveryEffect: HostedAssistantDeliveryEffect;
  fanoutRecipientMemberIds: readonly string[];
  fanoutTarget: string;
  vaultRoot: string;
}): Promise<void> {
  const threadTarget = parseHostedEmailThreadTarget(input.fanoutTarget);
  if (!threadTarget || threadTarget.targetKind !== "group" || !threadTarget.groupId) {
    throw new TypeError("Hosted email group fanout requires a serialized group thread target.");
  }

  const payload = input.assistantDeliveryEffect.payload;
  let parentIntent: AssistantOutboxIntent | null;
  let existingIntents: AssistantOutboxIntent[];
  try {
    [parentIntent, existingIntents] = await Promise.all([
      readAssistantOutboxIntent(
        input.vaultRoot,
        input.assistantDeliveryEffect.effectId,
      ),
      listAssistantOutboxIntents(input.vaultRoot),
    ]);
  } catch (error) {
    throw markHostedDeliveryPreProviderRetryable(error);
  }
  if (!parentIntent) {
    throw markHostedDeliveryPreProviderRetryable(
      new Error("Hosted email group fanout parent intent is unavailable."),
    );
  }
  for (const memberId of input.fanoutRecipientMemberIds) {
    if (hasNonReplayableHostedGroupEmailRecipientIntent({
      deliveryIdempotencyKey: payload.idempotencyKey,
      intents: existingIntents,
      memberId,
      turnId: payload.turnId,
    })) {
      continue;
    }
    const recipientTarget = serializeHostedEmailThreadTarget({
      ...threadTarget,
      recipientMemberId: memberId,
    });
    try {
      await createAssistantOutboxIntent({
        actorId: payload.actorId,
        answeredMailboxItemIds: payload.answeredMailboxItemIds,
        automationAuthority: parentIntent.automationAuthority ?? null,
        channel: "email",
        dedupeToken: `hosted-email-group-recipient:${input.assistantDeliveryEffect.effectId}:${memberId}`,
        deliveryIdempotencyKey: payload.idempotencyKey,
        deliveryTransportIdempotent: false,
        explicitTarget: recipientTarget,
        identityId: payload.identityId,
        media: [],
        message: payload.message,
        emailHtml: payload.emailHtml ?? null,
        groupEmailAuthorizationProof: payload.groupEmailAuthorizationProof ?? null,
        replyToMessageId: payload.replyToMessageId,
        sessionId: payload.sessionId,
        subject: null,
        threadId: payload.threadId,
        threadIsDirect: false,
        turnId: payload.turnId,
        vault: input.vaultRoot,
      });
    } catch (error) {
      throw markHostedDeliveryPreProviderRetryable(error);
    }
  }
}

function hasNonReplayableHostedGroupEmailRecipientIntent(input: {
  deliveryIdempotencyKey: string;
  intents: readonly AssistantOutboxIntent[];
  memberId: string;
  turnId: string;
}): boolean {
  return input.intents.some((intent) => {
    if (intent.deliveryIdempotencyKey !== input.deliveryIdempotencyKey) {
      return false;
    }
    const target = parseHostedEmailThreadTarget(intent.explicitTarget);
    if (target?.recipientMemberId !== input.memberId) {
      return false;
    }
    if (intent.lastError?.code === "ASSISTANT_DELIVERY_RETRY_EXHAUSTED") {
      return true;
    }
    if (
      isHostedGroupEmailDeliveryIdempotencyKey(input.deliveryIdempotencyKey)
      && intent.turnId !== input.turnId
    ) {
      return false;
    }
    if (
      intent.status === "awaiting_approval"
      || intent.status === "pending"
      || intent.status === "retryable"
      || intent.status === "sending"
      || intent.status === "sent"
    ) {
      return true;
    }
    return intent.lastError?.code === "ASSISTANT_DELIVERY_AMBIGUOUS";
  });
}

async function maybeResetHostedPreparedDeliveryAfterPreProviderAbort(input: {
  assistantDeliveryEffect: HostedAssistantDeliveryEffect;
  dispatchResult: Awaited<ReturnType<typeof dispatchAssistantOutboxIntent>>;
  mirrorState: Awaited<ReturnType<typeof readAssistantOutboxIntentMirrorState>>;
  preparedDispatchToken: string | null;
  previousPreparedDispatchState: AssistantOutboxPreparedDispatchState | null;
  providerDispatchEntered: boolean;
  signal: AbortSignal | null;
  vaultRoot: string;
}): Promise<Awaited<ReturnType<typeof dispatchAssistantOutboxIntent>> | null> {
  if (!input.preparedDispatchToken) {
    return null;
  }
  if (!shouldResetHostedPreparedDeliveryOnPreProviderAbort({
    assistantDeliveryEffect: input.assistantDeliveryEffect,
    error: null,
    mirrorState: input.mirrorState,
    providerDispatchEntered: input.providerDispatchEntered,
    signal: input.signal,
  })) {
    return null;
  }

  const reset = await resetAssistantOutboxPreparedDispatchById({
    deliveryTransportIdempotent: input.assistantDeliveryEffect.payload.transportIdempotent,
    intentId: input.assistantDeliveryEffect.effectId,
    preparedDispatchToken: input.preparedDispatchToken,
    resetAt: new Date(),
    ...(input.previousPreparedDispatchState
      ? { restoreDispatchState: input.previousPreparedDispatchState }
      : {}),
    vault: input.vaultRoot,
  });
  if (!reset) {
    return null;
  }

  return {
    ...input.dispatchResult,
    deliveryError: reset.lastError ?? input.dispatchResult.deliveryError,
    intent: reset,
  };
}

function shouldResetHostedPreparedDeliveryOnPreProviderAbort(input: {
  assistantDeliveryEffect: HostedAssistantDeliveryEffect;
  error: unknown;
  mirrorState: Awaited<ReturnType<typeof readAssistantOutboxIntentMirrorState>>;
  providerDispatchEntered: boolean;
  signal: AbortSignal | null;
}): boolean {
  return (
    input.signal?.aborted === true
    || isHostedBackgroundDeliveryDeferredError(input.error)
  )
    && input.mirrorState.sendingStartedAt !== null
    && !input.mirrorState.intent?.delivery
    && input.mirrorState.intent?.deliveryConfirmationPending !== true
    && !input.providerDispatchEntered;
}

function createHostedProviderFetchBoundary(input: {
  assertLive?: () => Promise<void>;
  assertProviderEntryLive?: () => Promise<void>;
  onProviderDispatchEntered?: () => Promise<void> | void;
  onTelegramVoiceMemoDispatchEntered?: () => void;
  operation: string;
  providerFetch: typeof fetch | null;
}): typeof fetch {
  let providerEntryPromise: Promise<void> | null = null;
  const enterProviderDispatch = () => {
    if (!input.onProviderDispatchEntered) {
      return Promise.resolve();
    }
    providerEntryPromise ??= Promise.resolve().then(
      input.onProviderDispatchEntered,
    );
    return providerEntryPromise;
  };

  return (async (request, init) => {
    await (input.assertProviderEntryLive ?? input.assertLive)?.();
    const fetchImplementation = requireHostedProviderFetch(
      input.providerFetch,
      input.operation,
    );
    await enterProviderDispatch();
    if (
      input.onTelegramVoiceMemoDispatchEntered &&
      isTelegramSendVoiceProviderFetchRequest(request)
    ) {
      input.onTelegramVoiceMemoDispatchEntered();
    }
    const response = await fetchImplementation(request, init);
    await input.assertLive?.();
    return response;
  }) as typeof fetch;
}

function isTelegramSendVoiceProviderFetchRequest(
  request: Parameters<typeof fetch>[0],
): boolean {
  try {
    const url = new URL(readProviderFetchRequestUrl(request));
    return /\/bot[^/]+\/sendVoice$/u.test(url.pathname);
  } catch {
    return false;
  }
}

function readProviderFetchRequestUrl(request: Parameters<typeof fetch>[0]): string {
  if (request instanceof Request) {
    return request.url;
  }
  if (request instanceof URL) {
    return request.toString();
  }
  return String(request);
}

function resolveHostedAssistantLinqDeliveryContexts(input: {
  context?: HostedAssistantLinqDeliveryContext | null;
  contexts?: readonly HostedAssistantLinqDeliveryContext[] | null;
  wake?: HostedRuntimeEvent | null;
}): readonly HostedAssistantLinqDeliveryContext[] {
  if (input.contexts && input.contexts.length > 0) {
    return input.contexts;
  }
  if (input.context) {
    return [input.context];
  }
  const wakeContext = input.wake
    ? buildHostedAssistantLinqDeliveryContextFromWake(input.wake)
    : null;
  return wakeContext ? [wakeContext] : [];
}

// The app-card error-to-text transition happens inside the hosted container,
// whose stdout/stderr never reaches a queryable sink, so the durable runtime
// log is the only operator-visible destination for this warning. The entry is
// projected from an allowlist and never copies error messages: parse-failure
// messages can embed raw provider response text.
function createHostedLinqAppCardFallbackErrorObserver(input: {
  intentId: string | null;
  platform: Pick<HostedRuntimePlatform, "logPort"> | null;
}): (fallbackError: {
  error: unknown;
  reason: "app_card_rejected" | "capability_check_failed";
}) => void {
  return (fallbackError) => {
    if (!input.platform?.logPort) {
      return;
    }
    const diagnostics = buildHostedExecutionSafeErrorDiagnostics(fallbackError.error);
    const errorName = diagnostics?.errorName;
    const errorStatus = diagnostics?.errorStatus;
    const errorCode = diagnostics?.errorCodeDetail ?? diagnostics?.errorCode;
    void writeHostedRuntimeLogBestEffort({
      entry: {
        component: "outbox",
        ...(typeof errorCode === "string"
          ? { errorCode: toHostedRuntimeLogCode(errorCode) }
          : {}),
        eventCode: "outbox.linq_app_card_fallback_error",
        level: "warn",
        ...(input.intentId ? { outboxIntentRef: input.intentId } : {}),
        phase: "outbox",
        redactedJson: {
          fallbackKind: "text",
          reason: fallbackError.reason,
          ...(typeof errorName === "string"
            ? { errorName: toHostedRuntimeLogCode(errorName) }
            : {}),
          ...(typeof errorStatus === "number" ? { errorStatus } : {}),
        },
      },
      platform: input.platform,
    });
  };
}

function createHostedAssistantLinqSendDependency(input: {
  actionApprovalPort?: HostedRuntimeActionApprovalPort | null;
  assertLiveness?: () => Promise<void>;
  deliveryRouteContext?: Pick<
    HostedAssistantDeliveryPayload,
    "actorId" | "identityId" | "threadId" | "threadIsDirect"
  > | null;
  effectsPort?: Pick<
    HostedRuntimeEffectsPort,
    | "assertAssistantAskPrivateCompletionAuthority"
    | "assertLinqRecentInboundEngagement"
    | "recordLinqDeliveryOutcome"
  > | null;
  expectedDedupeKey?: string | null;
  intentId?: string | null;
  linqDeliveryContexts?: readonly HostedAssistantLinqDeliveryContext[] | null;
  linqEnv: NodeJS.ProcessEnv;
  onProviderAccepted?: (input: {
    acceptedAssistantInputIds: readonly string[];
    acceptedAt: Date;
  }) => void;
  onProviderDispatchEntered?: () => void;
  onProviderDispatchSettledWithoutEffect?: () => void;
  platform?: Pick<HostedRuntimePlatform, "logPort"> | null;
  providerFetch: typeof fetch | null;
  publicInternetFetch?: typeof fetch | null;
  shouldYieldBackgroundDelivery?: (() => boolean) | null;
  signal: AbortSignal | null;
  threadIsDirect?: boolean | null;
  vaultRoot?: string | null;
}): NonNullable<AssistantHostedProgressDeliveryDependencies["sendLinq"]> {
  const onAppCardFallbackError = createHostedLinqAppCardFallbackErrorObserver({
    intentId: input.intentId ?? null,
    platform: input.platform ?? null,
  });
  return async (request) => {
    await assertHostedDeliveryLiveNow(input);
    const idempotencyKey = request.idempotencyKey?.trim() || null;
    const privateAssistantAskCompletion = idempotencyKey?.startsWith(
      HOSTED_EXECUTION_PRIVATE_ASSISTANT_ASK_COMPLETION_DELIVERY_KEY_PREFIX,
    ) === true;
    const deliveryContext =
      resolveHostedAssistantLinqDeliveryContextFromCandidatesForRequest({
        contexts: input.linqDeliveryContexts ?? [],
        replyToMessageId: request.replyToMessageId ?? null,
        target: request.target,
        targetKind: request.targetKind ?? null,
      });
    const candidateDirectRecipientPhoneNumber =
      normalizeHostedLinqDirectRecipient(request.directRecipientPhoneNumber)
      ?? normalizeHostedLinqDirectRecipient(deliveryContext?.directRecipientPhoneNumber);
    const candidateFromPhoneNumber =
      normalizeHostedLinqDirectRecipient(request.fromPhoneNumber)
      ?? normalizeHostedLinqDirectRecipient(deliveryContext?.fromPhoneNumber);
    const signal = mergeHostedAssistantLinqSignals(input.signal, request.signal);
    const persistAppCardTextFallback = request.persistAppCardTextFallback;
    const reviewedAssistantAskCompletion = idempotencyKey?.startsWith(
      HOSTED_EXECUTION_REVIEWED_ASSISTANT_ASK_COMPLETION_DELIVERY_KEY_PREFIX,
    ) === true;
    const includesVaultFile =
      request.media?.some((media) => media.kind === "vault_file") === true;
    if (privateAssistantAskCompletion) {
      const routeContext = input.deliveryRouteContext;
      if (!routeContext) {
        throw new VaultCliError(
          "ASSISTANT_ASK_PRIVATE_COMPLETION_ROUTE_UNAVAILABLE",
          "Private Assistant Ask completion route is unavailable.",
          { retryable: false },
        );
      }
      const targetKind = request.targetKind ?? "thread";
      await assertHostedPrivateAssistantAskCompletionAtProviderEntry({
        actualRoute: {
          actorId: routeContext.actorId,
          channel: "linq",
          delivery: {
            kind: targetKind,
            ...(targetKind === "participant" && candidateFromPhoneNumber
              ? {
                  source: {
                    fromPhoneNumber: candidateFromPhoneNumber,
                    kind: "linq" as const,
                  },
                }
              : {}),
            target: deliveryContext?.target ?? request.target,
          },
          identityId: routeContext.identityId,
          threadId: routeContext.threadId,
          threadIsDirect: routeContext.threadIsDirect,
        },
        effectsPort: input.effectsPort ?? null,
        intentId: input.intentId ?? null,
        media: request.media ?? [],
        message: request.message,
        now: new Date(),
        signal: signal ?? null,
        vaultRoot: input.vaultRoot ?? null,
      });
    }
    const engagement =
      await assertHostedAssistantLinqRecentInboundEngagementForDelivery({
        answeredMailboxItemIds: request.answeredMailboxItemIds,
        assistantAskFallback:
          reviewedAssistantAskCompletion
            ? isHostedReviewedAssistantAskFallbackPayload({
                media: request.media,
                message: request.message,
              })
            : undefined,
        authorityCheckOnly: true,
        directRecipientPhoneNumber: candidateDirectRecipientPhoneNumber,
        effectsPort: input.effectsPort ?? null,
        fromPhoneNumber: candidateFromPhoneNumber,
        homeRouteFallbackAllowed: request.homeRouteFallbackAllowed === true,
        idempotencyKey,
        intentId: input.intentId ?? null,
        replyToMessageId: request.replyToMessageId ?? null,
        signal: signal ?? null,
        target: deliveryContext?.target ?? request.target,
        targetKind: request.targetKind ?? null,
      });
    const resolvedRoute = requireHostedAssistantLinqResolvedRoute(engagement);
    const directRecipientPhoneNumber = resolvedRoute.directRecipientPhoneNumber;
    const fromPhoneNumber = resolvedRoute.fromPhoneNumber;
    const providerTarget = resolvedRoute.target;
    const providerTargetKind = resolvedRoute.targetKind;
    const originalParticipantRecipientPhoneNumber =
      resolvedRoute.targetKind === "participant"
        ? resolvedRoute.directRecipientPhoneNumber ?? resolvedRoute.target
        : null;
    if (
      includesVaultFile
      && (
        providerTarget !== request.target
        || providerTargetKind !== (
          request.targetKind === "participant" ? "participant" : "thread"
        )
        || resolvedRoute.threadIsDirect !== input.threadIsDirect
        || (
          providerTargetKind === "thread"
          && looksLikeHostedProviderRedactedLinqTarget(providerTarget)
        )
      )
    ) {
      throw createAssistantDeliveryTerminalError(
        "ASSISTANT_VAULT_FILE_IDENTITY_CONFLICT",
        "Secure vault-file delivery target or audience changed after approval.",
      );
    }
    const verifiedVaultFiles = await preloadApprovedHostedAssistantVaultFiles({
      actionApprovalPort: input.actionApprovalPort ?? null,
      expectedDedupeKey: input.expectedDedupeKey ?? null,
      intentId: input.intentId ?? null,
      media: request.media ?? [],
      vaultRoot: input.vaultRoot ?? null,
    });
    const verifiedVaultImages = await preloadHostedAssistantVaultImages({
      media: request.media ?? [],
      vaultRoot: input.vaultRoot ?? null,
    });
    let providerAttempt: {
      attemptedAt: Date;
      idempotencyKey: string | null;
    } | null = null;
    const hasVerifiedVaultAttachment =
      verifiedVaultFiles.size > 0 || verifiedVaultImages.size > 0;
    const readProviderAttempt = () => providerAttempt;
    const assertPrivateAssistantAskCompletionAtProviderEntry = async () => {
      if (!privateAssistantAskCompletion) {
        return;
      }
      const routeContext = input.deliveryRouteContext;
      if (!routeContext) {
        throw new VaultCliError(
          "ASSISTANT_ASK_PRIVATE_COMPLETION_ROUTE_UNAVAILABLE",
          "Private Assistant Ask completion route is unavailable.",
          { retryable: false },
        );
      }
      await assertHostedPrivateAssistantAskCompletionAtProviderEntry({
        actualRoute: {
          actorId: routeContext.actorId,
          channel: "linq",
          delivery: {
            kind: providerTargetKind ?? "explicit",
            ...(providerTargetKind === "participant" && fromPhoneNumber
              ? {
                  source: {
                    fromPhoneNumber,
                    kind: "linq" as const,
                  },
                }
              : {}),
            target: providerTarget,
          },
          identityId: routeContext.identityId,
          threadId: routeContext.threadId,
          threadIsDirect: routeContext.threadIsDirect,
        },
        effectsPort: input.effectsPort ?? null,
        intentId: input.intentId ?? null,
        media: request.media ?? [],
        message: request.message,
        now: new Date(),
        signal: signal ?? null,
        vaultRoot: input.vaultRoot ?? null,
      });
    };
    const createMessageFetchBoundary = (
      deliveryIdempotencyKey: string | null,
    ): typeof fetch => createHostedProviderFetchBoundary({
      assertProviderEntryLive: async () => {
        try {
          await assertHostedDeliveryCanEnterProvider(input);
          await assertPrivateAssistantAskCompletionAtProviderEntry();
        } catch (error) {
          if (providerAttempt && hasVerifiedVaultAttachment) {
            throw markHostedLinqAttachmentReservationMayHaveSucceeded(error);
          }
          throw markHostedDeliveryPreProvider(error);
        }
      },
      onProviderDispatchEntered: async () => {
        try {
          const reviewedCompletionExpiresAt = reviewedAssistantAskCompletion
            ? await prepareHostedReviewedAssistantAskProviderEntry({
                intentId: input.intentId ?? null,
                media: request.media ?? [],
                message: request.message,
                now: new Date(),
                vaultRoot: input.vaultRoot ?? null,
              })
            : undefined;
          const providerEntry =
            await assertHostedAssistantLinqRecentInboundEngagementForDelivery({
              answeredMailboxItemIds: request.answeredMailboxItemIds,
              assistantAskCompletionExpiresAt: reviewedCompletionExpiresAt,
              assistantAskFallback:
                reviewedAssistantAskCompletion
                  ? isHostedReviewedAssistantAskFallbackPayload({
                      media: request.media,
                      message: request.message,
                    })
                  : undefined,
              authorityCheckOnly: false,
              directRecipientPhoneNumber,
              effectsPort: input.effectsPort ?? null,
              expectedResolvedRoute: resolvedRoute,
              fromPhoneNumber,
              homeRouteFallbackAllowed: false,
              idempotencyKey: deliveryIdempotencyKey,
              intentId: input.intentId ?? null,
              replyToMessageId: request.replyToMessageId ?? null,
              providerDispatchRetrySafe: true,
              signal: signal ?? null,
              target: providerTarget,
              targetKind: providerTargetKind,
            });
          if (providerEntry.assistantAskFallbackRequired === true) {
            if (!input.intentId || !input.vaultRoot) {
              throw new VaultCliError(
                "ASSISTANT_ASK_COMPLETION_OUTBOX_MISSING",
                "Reviewed Assistant Ask completion outbox state is unavailable.",
                { retryable: true },
              );
            }
            await persistHostedAssistantAskFallbackSupersession({
              intentId: input.intentId,
              now: new Date(),
              vaultRoot: input.vaultRoot,
            });
            throw new VaultCliError(
              "ASSISTANT_ASK_COMPLETION_FALLBACK_RETRY",
              "Reviewed Assistant Ask completion changed to its safe fallback before provider delivery.",
              { retryable: true },
            );
          }
          providerAttempt = {
            attemptedAt: new Date(),
            idempotencyKey: deliveryIdempotencyKey,
          };
          input.onProviderDispatchEntered?.();
        } catch (error) {
          if (isHostedLinqProviderOutcomeAmbiguous(error)) {
            throw error;
          }
          if (providerAttempt && hasVerifiedVaultAttachment) {
            throw markHostedLinqAttachmentReservationMayHaveSucceeded(error);
          }
          throw markHostedDeliveryPreProvider(error);
        }
      },
      operation: "Hosted assistant Linq delivery",
      providerFetch: input.providerFetch,
    });
    const capabilityFetch = createHostedProviderFetchBoundary({
      assertProviderEntryLive: async () => {
        try {
          await assertHostedDeliveryCanEnterProvider(input);
          await assertPrivateAssistantAskCompletionAtProviderEntry();
          await assertHostedAssistantLinqRecentInboundEngagementForDelivery({
            answeredMailboxItemIds: request.answeredMailboxItemIds,
            assistantAskFallback:
              reviewedAssistantAskCompletion
                ? isHostedReviewedAssistantAskFallbackPayload({
                    media: request.media,
                    message: request.message,
                  })
                : undefined,
            authorityCheckOnly: true,
            directRecipientPhoneNumber,
            effectsPort: input.effectsPort ?? null,
            expectedResolvedRoute: resolvedRoute,
            fromPhoneNumber,
            homeRouteFallbackAllowed: false,
            idempotencyKey,
            intentId: input.intentId ?? null,
            replyToMessageId: request.replyToMessageId ?? null,
            signal: signal ?? null,
            target: providerTarget,
            targetKind: providerTargetKind,
          });
        } catch (error) {
          throw markHostedDeliveryPreProvider(error);
        }
      },
      operation: "Hosted assistant Linq capability lookup",
      providerFetch: input.providerFetch,
    });
    const fallbackIdempotencyKey = idempotencyKey
      ? `${idempotencyKey}:fallback`
      : null;
    const dependencies = requireHostedProviderFetchDependencies({
      ...(request.card == null
        ? {}
        : {
            appCardCapabilityFetchImplementation: capabilityFetch,
            appCardTextFallbackFetchImplementation:
              createMessageFetchBoundary(fallbackIdempotencyKey),
          }),
      env: input.linqEnv,
      fetchImplementation: createMessageFetchBoundary(idempotencyKey),
      ...(signal ? { signal } : {}),
    }, "Hosted assistant Linq delivery");
    let result: HostedRuntimeLinqSendResponse;
    try {
      result = await sendHostedProviderLinqMessage({
        directRecipientPhoneNumber,
        fromPhoneNumber,
        homeRouteFallbackAllowed:
          !privateAssistantAskCompletion
          && request.homeRouteFallbackAllowed === true,
        idempotencyKey,
        media: request.media ?? null,
        message: request.message,
        ...(request.nativeReplyRequested === true ? { nativeReplyRequested: true } : {}),
        replyToMessageId: request.replyToMessageId ?? null,
        target: providerTarget,
        targetKind: providerTargetKind,
        ...(request.card == null
          ? {}
          : {
              card: request.card,
              threadIsDirect:
                resolvedRoute.threadIsDirect,
            }),
      }, {
        ...dependencies,
        onAppCardFallbackError,
        ...(input.publicInternetFetch
          ? { publicFetchImplementation: input.publicInternetFetch }
          : {}),
        ...(verifiedVaultFiles.size > 0
          ? {
              loadVaultFile: async (media) => {
                const bytes = verifiedVaultFiles.get(
                  buildHostedVaultFileMediaIdentity(media),
                );
                if (!bytes) {
                  throw new VaultCliError(
                    "ASSISTANT_VAULT_FILE_IDENTITY_CONFLICT",
                    "The prepared vault file no longer matches the approved action.",
                  );
                }
                return bytes;
              },
            }
          : {}),
        ...(verifiedVaultImages.size > 0
          ? {
              loadVaultImage: async (media) => {
                const bytes = verifiedVaultImages.get(
                  buildHostedVaultImageMediaIdentity(media),
                );
                if (!bytes) {
                  throw new VaultCliError(
                    "ASSISTANT_VAULT_IMAGE_IDENTITY_CONFLICT",
                    "The prepared private image no longer matches the outbox media.",
                  );
                }
                return bytes;
              },
            }
          : {}),
        ...(persistAppCardTextFallback
          ? {
              persistAppCardTextFallback: async (fallback) => {
                if (
                  providerAttempt
                  && providerAttempt.idempotencyKey !== fallback.idempotencyKey
                ) {
                  await recordHostedAssistantLinqDeliveryOutcomeRequired({
                    effectsPort: input.effectsPort ?? null,
                    outcome: buildHostedAssistantLinqDeliveryOutcomeRequest({
                      attemptedAt: providerAttempt.attemptedAt,
                      answeredMailboxItemIds: [],
                      directRecipientPhoneNumber:
                        originalParticipantRecipientPhoneNumber,
                      failedAt: new Date(),
                      failureCode: HOSTED_LINQ_APP_CARD_REJECTED_FAILURE_CODE,
                      failureReason: null,
                      fromPhoneNumber,
                      idempotencyKey: providerAttempt.idempotencyKey,
                      intentId: input.intentId ?? null,
                      providerTarget,
                      providerThreadId: null,
                      result: null,
                      target: providerTarget,
                      targetKind: providerTargetKind,
                      threadIsDirect:
                        resolvedRoute.threadIsDirect,
                    }),
                  });
                  providerAttempt = null;
                  input.onProviderDispatchSettledWithoutEffect?.();
                }
                await persistAppCardTextFallback(fallback);
              },
            }
          : {}),
      });
    } catch (error) {
      const failedProviderAttempt = readProviderAttempt();
      if (!failedProviderAttempt) {
        throw error;
      }
      const partialRichLinkResult =
        readHostedAssistantLinqRichLinkPartialDeliveryResult(error);
      if (partialRichLinkResult) {
        await recordHostedAssistantLinqDeliveryOutcomeOrQueueBestEffort({
          effectsPort: input.effectsPort ?? null,
          outcome: buildHostedAssistantLinqDeliveryOutcomeRequest({
            attemptedAt: failedProviderAttempt.attemptedAt,
            answeredMailboxItemIds: [],
            directRecipientPhoneNumber: originalParticipantRecipientPhoneNumber,
            failedAt: new Date(),
            failureCode: readHostedAssistantLinqDeliveryFailureCode(error),
            failureReason: null,
            fromPhoneNumber,
            idempotencyKey: failedProviderAttempt.idempotencyKey,
            intentId: input.intentId ?? null,
            providerTarget,
            providerThreadId: partialRichLinkResult.providerThreadId ?? null,
            result: partialRichLinkResult,
            target: providerTarget,
            targetKind: providerTargetKind,
            threadIsDirect:
              resolvedRoute.threadIsDirect,
          }),
        });
        throw markHostedDeliveryMayHaveSucceeded(error);
      }
      if (
        hostedDeliveryErrorProvesProviderWasSkipped(error)
        || isHostedLinqProviderOutcomeAmbiguous(error)
      ) {
        throw markHostedDeliveryMayHaveSucceeded(error);
      }
      queueHostedAssistantLinqDeliveryOutcomeWrite({
        effectsPort: input.effectsPort ?? null,
        outcome: buildHostedAssistantLinqDeliveryOutcomeRequest({
          attemptedAt: failedProviderAttempt.attemptedAt,
          answeredMailboxItemIds: request.answeredMailboxItemIds ?? [],
          directRecipientPhoneNumber: originalParticipantRecipientPhoneNumber,
          failedAt: new Date(),
          failureCode: readHostedAssistantLinqDeliveryFailureCode(error),
          failureReason: readTrustedHostedAssistantLinqDeliveryFailureReason(error),
          fromPhoneNumber,
          idempotencyKey: failedProviderAttempt.idempotencyKey,
          intentId: input.intentId ?? null,
          providerTarget,
          providerThreadId: null,
          result: null,
          target: providerTarget,
          targetKind: providerTargetKind,
          threadIsDirect: resolvedRoute.threadIsDirect,
        }),
      });
      throw error;
    }
    const acceptedAt = new Date();
    const acceptedProviderAttempt = readProviderAttempt();
    const acceptedIdempotencyKey =
      result.idempotencyKey
      ?? acceptedProviderAttempt?.idempotencyKey
      ?? idempotencyKey;
    input.onProviderAccepted?.({
      acceptedAssistantInputIds: request.acceptedAssistantInputIds ?? [],
      acceptedAt,
    });
    await recordHostedAssistantLinqDeliveryOutcomeOrQueueBestEffort({
      effectsPort: input.effectsPort ?? null,
      outcome: buildHostedAssistantLinqDeliveryOutcomeRequest({
        acceptedAt,
        attemptedAt: requireHostedLinqProviderAttemptedAt(
          acceptedProviderAttempt?.attemptedAt ?? null,
        ),
        answeredMailboxItemIds: request.answeredMailboxItemIds ?? [],
        directRecipientPhoneNumber: originalParticipantRecipientPhoneNumber,
        fromPhoneNumber,
        idempotencyKey: acceptedIdempotencyKey,
        intentId: input.intentId ?? null,
        providerTarget,
        providerThreadId: result.providerThreadId ?? null,
        result,
        target: providerTarget,
        targetKind: providerTargetKind,
        threadIsDirect: resolvedRoute.threadIsDirect,
      }),
    });
    await assertHostedDeliveryLiveNow(input);
    return result;
  };
}

async function prepareHostedReviewedAssistantAskProviderEntry(input: {
  intentId: string | null;
  media: readonly AssistantResponseMedia[];
  message: string;
  now: Date;
  vaultRoot: string | null;
}): Promise<string> {
  if (!input.intentId || !input.vaultRoot) {
    throw new VaultCliError(
      "ASSISTANT_ASK_COMPLETION_OUTBOX_MISSING",
      "Reviewed Assistant Ask completion outbox state is unavailable.",
      { retryable: true },
    );
  }
  const current = await readAssistantOutboxIntent(
    input.vaultRoot,
    input.intentId,
  );
  if (!current) {
    throw new VaultCliError(
      "ASSISTANT_ASK_COMPLETION_OUTBOX_MISSING",
      "Reviewed Assistant Ask completion outbox state is unavailable.",
      { retryable: true },
    );
  }
  const expiresAt = requireHostedReviewedAssistantAskCompletionExpiresAt(
    current,
  );
  const currentIsFallback = isHostedReviewedAssistantAskFallbackPayload(current);
  const requestIsFallback = isHostedReviewedAssistantAskFallbackPayload(input);
  const currentContainsFallbackText = current.message
    === HOSTED_EXECUTION_ASSISTANT_ASK_CANNOT_ANSWER_RESPONSE;
  const requestContainsFallbackText = input.message
    === HOSTED_EXECUTION_ASSISTANT_ASK_CANNOT_ANSWER_RESPONSE;
  if (
    (currentContainsFallbackText && !currentIsFallback)
    || (requestContainsFallbackText && !requestIsFallback)
  ) {
    await persistHostedAssistantAskFallbackSupersession({
      intentId: input.intentId,
      now: input.now,
      vaultRoot: input.vaultRoot,
    });
    throw new VaultCliError(
      "ASSISTANT_ASK_COMPLETION_FALLBACK_RETRY",
      "Reviewed Assistant Ask completion changed to its safe fallback before provider delivery.",
      { retryable: true },
    );
  }
  if (current.message !== input.message) {
    throw new VaultCliError(
      currentIsFallback
        ? "ASSISTANT_ASK_COMPLETION_FALLBACK_RETRY"
        : "ASSISTANT_ASK_COMPLETION_OUTBOX_CHANGED",
      "Reviewed Assistant Ask completion outbox changed before provider delivery.",
      { retryable: true },
    );
  }
  if (!currentIsFallback && Date.parse(expiresAt) <= input.now.getTime()) {
    await persistHostedAssistantAskFallbackSupersession({
      intentId: input.intentId,
      now: input.now,
      vaultRoot: input.vaultRoot,
    });
    throw new VaultCliError(
      "ASSISTANT_ASK_COMPLETION_FALLBACK_RETRY",
      "Reviewed Assistant Ask completion changed to its safe fallback before provider delivery.",
      { retryable: true },
    );
  }
  return expiresAt;
}

async function assertHostedPrivateAssistantAskCompletionAtProviderEntry(input: {
  actualRoute: HostedExecutionAssistantNotificationRoute;
  effectsPort: Pick<
    HostedRuntimeEffectsPort,
    "assertAssistantAskPrivateCompletionAuthority"
  > | null;
  intentId: string | null;
  media: readonly AssistantResponseMedia[];
  message: string;
  now: Date;
  signal: AbortSignal | null;
  vaultRoot: string | null;
}): Promise<void> {
  if (!input.intentId || !input.vaultRoot) {
    throw new VaultCliError(
      "ASSISTANT_ASK_PRIVATE_COMPLETION_OUTBOX_MISSING",
      "Private Assistant Ask completion outbox state is unavailable.",
      { retryable: true },
    );
  }
  const current = await readAssistantOutboxIntent(
    input.vaultRoot,
    input.intentId,
  );
  if (!current || !isHostedPrivateAssistantAskCompletionIntent(current)) {
    throw new VaultCliError(
      "ASSISTANT_ASK_PRIVATE_COMPLETION_OUTBOX_MISSING",
      "Private Assistant Ask completion outbox state is unavailable.",
      { retryable: true },
    );
  }
  const proof = requireHostedPrivateAssistantAskCompletionProof(current);
  if (
    input.media.length !== 0
    || current.message !== input.message
    || proof.responseTextDigest
      !== createHostedPrivateAssistantAskResponseTextDigest(input.message)
    || !hostedPrivateAssistantAskCompletionRoutesEqual(
      proof.route,
      input.actualRoute,
    )
  ) {
    throw new VaultCliError(
      "ASSISTANT_ASK_PRIVATE_COMPLETION_OUTBOX_CHANGED",
      "Private Assistant Ask completion changed before provider delivery.",
      { retryable: false },
    );
  }
  const assertAuthority =
    input.effectsPort?.assertAssistantAskPrivateCompletionAuthority;
  if (!assertAuthority) {
    throw new VaultCliError(
      "ASSISTANT_ASK_PRIVATE_COMPLETION_AUTHORITY_UNAVAILABLE",
      "Private Assistant Ask completion requires live delivery authority before provider work.",
      { retryable: true },
    );
  }
  const authority = await assertAuthority(proof, { signal: input.signal });
  if (authority?.assistantAskFallbackRequired === true) {
    throw new VaultCliError(
      "ASSISTANT_ASK_PRIVATE_COMPLETION_FALLBACK_PERSISTED",
      "Private Assistant Ask completion changed to its group fallback before provider delivery.",
      { retryable: false },
    );
  }
}

function hostedPrivateAssistantAskCompletionRoutesEqual(
  left: HostedExecutionAssistantNotificationRoute,
  right: HostedExecutionAssistantNotificationRoute,
): boolean {
  return left.actorId === right.actorId
    && left.channel === right.channel
    && left.delivery.kind === right.delivery.kind
    && left.delivery.target === right.delivery.target
    && (left.delivery.source?.kind ?? null)
      === (right.delivery.source?.kind ?? null)
    && (left.delivery.source?.fromPhoneNumber ?? null)
      === (right.delivery.source?.fromPhoneNumber ?? null)
    && left.identityId === right.identityId
    && left.threadId === right.threadId
    && left.threadIsDirect === right.threadIsDirect;
}

async function preloadHostedAssistantVaultImages(input: {
  media: readonly AssistantResponseMedia[];
  vaultRoot: string | null;
}): Promise<Map<string, Uint8Array>> {
  const vaultImages = input.media.filter(
    (media): media is Extract<AssistantResponseMedia, { kind: "vault_image" }> =>
      media.kind === "vault_image",
  );
  if (vaultImages.length === 0) {
    return new Map();
  }
  if (!input.vaultRoot) {
    throw createAssistantDeliveryTerminalError(
      "ASSISTANT_VAULT_IMAGE_ROOT_UNAVAILABLE",
      "Private image delivery requires the owning vault.",
    );
  }
  const verified = new Map<string, Uint8Array>();
  for (const image of vaultImages) {
    verified.set(
      buildHostedVaultImageMediaIdentity(image),
      await readVerifiedAssistantVaultImageBytes({
        image,
        vaultRoot: input.vaultRoot,
      }),
    );
  }
  return verified;
}

async function preloadApprovedHostedAssistantVaultFiles(input: {
  actionApprovalPort: HostedRuntimeActionApprovalPort | null;
  expectedDedupeKey: string | null;
  intentId: string | null;
  media: readonly AssistantResponseMedia[];
  vaultRoot: string | null;
}): Promise<Map<string, Uint8Array>> {
  const vaultFiles = input.media.filter(
    (media) => media.kind === "vault_file",
  );
  if (vaultFiles.length === 0) {
    return new Map();
  }
  if (
    vaultFiles.length !== 1
    || input.media.length !== 1
    || !input.expectedDedupeKey
    || !input.intentId
    || !input.vaultRoot
  ) {
    throw createAssistantDeliveryTerminalError(
      "ASSISTANT_VAULT_FILE_APPROVAL_INVARIANT_FAILED",
      "Secure vault-file delivery reached provider dispatch without complete approval prerequisites.",
    );
  }

  const intent = await readAssistantOutboxIntent(
    input.vaultRoot,
    input.intentId,
  );
  if (!intent || intent.dedupeKey !== input.expectedDedupeKey) {
    throw new VaultCliError(
      "ASSISTANT_VAULT_FILE_IDENTITY_CONFLICT",
      "The prepared vault-file delivery no longer matches its outbox action.",
    );
  }
  const persistedFile = readAssistantVaultFileMedia(intent);
  if (
    !persistedFile
    || !persistedFile.approvalId
    || !persistedFile.approvalGeneration
    || buildHostedVaultFileMediaIdentity(persistedFile)
      !== buildHostedVaultFileMediaIdentity(vaultFiles[0]!)
  ) {
    throw new VaultCliError(
      "ASSISTANT_VAULT_FILE_IDENTITY_CONFLICT",
      "The prepared vault file no longer matches its persisted outbox action.",
    );
  }

  if (!input.actionApprovalPort) {
    throw createAssistantDeliveryTerminalError(
      "ASSISTANT_VAULT_FILE_APPROVAL_INVARIANT_FAILED",
      "Secure vault-file delivery reached provider dispatch without an approval boundary.",
    );
  }

  let approval: HostedActionApprovalResult;
  try {
    approval = await input.actionApprovalPort.consume({
      approvalGeneration: persistedFile.approvalGeneration,
      consumerId: intent.deliveryIdempotencyKey ?? `assistant-outbox:${intent.intentId}`,
      request: buildAssistantVaultFileSendApprovalRequest(intent),
    });
  } catch (error) {
    throw createAssistantDeliveryTerminalError(
      "ASSISTANT_VAULT_FILE_APPROVAL_INVARIANT_FAILED",
      "Secure vault-file approval could not be consumed at provider dispatch.",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
  if (approval.status === "pending") {
    throw createAssistantDeliveryTerminalError(
      "ASSISTANT_VAULT_FILE_APPROVAL_INVARIANT_FAILED",
      "Vault-file delivery reached provider dispatch while approval was still pending.",
    );
  }
  if (approval.status !== "approved") {
    throw createAssistantDeliveryTerminalError(
      approval.status === "denied"
        ? "ASSISTANT_VAULT_FILE_APPROVAL_DENIED"
        : "ASSISTANT_VAULT_FILE_APPROVAL_EXPIRED",
      approval.status === "denied"
        ? "Vault-file delivery was denied."
        : "Vault-file delivery approval expired.",
    );
  }

  const bytes = await readVerifiedAssistantVaultFileBytes({
    file: persistedFile,
    vaultRoot: input.vaultRoot,
  });
  return new Map([
    [buildHostedVaultFileMediaIdentity(persistedFile), bytes],
  ]);
}

function buildHostedVaultImageMediaIdentity(input: {
  contentType: string;
  filename: string;
  ref: string;
  sha256: string;
  sizeBytes: number;
}): string {
  return JSON.stringify([
    input.ref,
    input.sha256,
    input.filename,
    input.contentType,
    input.sizeBytes,
  ]);
}

function buildHostedVaultFileMediaIdentity(input: {
  approvalGeneration?: string | null;
  approvalId?: string | null;
  contentType: string;
  filename: string;
  ref: string;
  sha256: string;
  sizeBytes: number;
}): string {
  return JSON.stringify([
    input.ref,
    input.sha256,
    input.filename,
    input.contentType,
    input.sizeBytes,
    input.approvalId ?? null,
    input.approvalGeneration ?? null,
  ]);
}

function createHostedAssistantLinqVoiceMemoSendDependency(input: {
  assertLiveness?: () => Promise<void>;
  effectsPort?: Pick<
    HostedRuntimeEffectsPort,
    "assertLinqRecentInboundEngagement" | "recordLinqDeliveryOutcome"
  > | null;
  intentId?: string | null;
  linqDeliveryContexts?: readonly HostedAssistantLinqDeliveryContext[] | null;
  linqEnv: NodeJS.ProcessEnv;
  onProviderDispatchEntered?: () => void;
  providerFetch: typeof fetch | null;
  shouldYieldBackgroundDelivery?: (() => boolean) | null;
  signal: AbortSignal | null;
  threadIsDirect?: boolean | null;
}): NonNullable<AssistantHostedProgressDeliveryDependencies["sendLinqVoiceMemo"]> {
  return async (request) => {
    await assertHostedDeliveryLiveNow(input);
    const deliveryContext =
      resolveHostedAssistantLinqDeliveryContextFromCandidatesForRequest({
        contexts: input.linqDeliveryContexts ?? [],
        replyToMessageId: request.replyToMessageId ?? null,
        target: request.target,
        targetKind: request.targetKind ?? null,
      });
    const signal = mergeHostedAssistantLinqSignals(input.signal, request.signal);
    const idempotencyKey = input.intentId
      ? `linq-voice-memo:${input.intentId}`
      : null;
    const replyToMessageId = request.replyToMessageId ?? null;
    const engagement =
      await assertHostedAssistantLinqRecentInboundEngagementForDelivery({
        answeredMailboxItemIds: request.answeredMailboxItemIds,
        authorityCheckOnly: true,
        directRecipientPhoneNumber:
          normalizeHostedLinqDirectRecipient(deliveryContext?.directRecipientPhoneNumber),
        effectsPort: input.effectsPort ?? null,
        fromPhoneNumber:
          normalizeHostedLinqDirectRecipient(deliveryContext?.fromPhoneNumber),
        homeRouteFallbackAllowed: request.homeRouteFallbackAllowed === true,
        idempotencyKey,
        intentId: input.intentId ?? null,
        replyToMessageId,
        signal: signal ?? null,
        target: deliveryContext?.target ?? request.target,
        targetKind: request.targetKind ?? "thread",
      });
    const resolvedRoute = requireHostedAssistantLinqResolvedRoute(engagement);
    if (resolvedRoute.targetKind !== "thread") {
      throw new VaultCliError(
        "ASSISTANT_LINQ_VOICE_MEMO_THREAD_REQUIRED",
        "Hosted Linq voice memo delivery requires a resolved thread route.",
        { retryable: false },
      );
    }
    const providerTarget = resolvedRoute.target;
    let attemptedAt: Date | null = null;
    const dependencies = requireHostedProviderFetchDependencies({
      env: input.linqEnv,
      fetchImplementation: createHostedProviderFetchBoundary({
        assertProviderEntryLive: () => assertHostedDeliveryCanEnterProvider(input),
        onProviderDispatchEntered: async () => {
          await assertHostedAssistantLinqRecentInboundEngagementForDelivery({
            answeredMailboxItemIds: request.answeredMailboxItemIds,
            authorityCheckOnly: false,
            directRecipientPhoneNumber: resolvedRoute.directRecipientPhoneNumber,
            effectsPort: input.effectsPort ?? null,
            expectedResolvedRoute: resolvedRoute,
            fromPhoneNumber: resolvedRoute.fromPhoneNumber,
            homeRouteFallbackAllowed: false,
            idempotencyKey,
            intentId: input.intentId ?? null,
            replyToMessageId,
            providerDispatchRetrySafe: false,
            signal: signal ?? null,
            target: providerTarget,
            targetKind: "thread",
          });
          attemptedAt = new Date();
          input.onProviderDispatchEntered?.();
        },
        operation: "Hosted assistant Linq voice memo delivery",
        providerFetch: input.providerFetch,
      }),
      ...(signal ? { signal } : {}),
    }, "Hosted assistant Linq voice memo delivery");
    let result: HostedRuntimeLinqSendResponse;
    try {
      result = await sendHostedProviderLinqVoiceMemo({
        attachmentId: request.attachmentId,
        target: providerTarget,
      }, dependencies);
    } catch (error) {
      if (!attemptedAt) {
        throw error;
      }
      if (isHostedLinqProviderOutcomeAmbiguous(error)) {
        throw markHostedDeliveryMayHaveSucceeded(error);
      }
      queueHostedAssistantLinqDeliveryOutcomeWrite({
        effectsPort: input.effectsPort ?? null,
        outcome: buildHostedAssistantLinqDeliveryOutcomeRequest({
          attemptedAt,
          answeredMailboxItemIds: request.answeredMailboxItemIds ?? [],
          failedAt: new Date(),
          failureCode: readHostedAssistantLinqDeliveryFailureCode(error),
          failureReason: null,
          fromPhoneNumber: resolvedRoute.fromPhoneNumber,
          idempotencyKey,
          intentId: input.intentId ?? null,
          providerTarget,
          providerThreadId: null,
          result: null,
          target: providerTarget,
          targetKind: "thread",
          threadIsDirect: resolvedRoute.threadIsDirect,
        }),
      });
      throw error;
    }
    await recordHostedAssistantLinqDeliveryOutcomeOrQueueBestEffort({
      effectsPort: input.effectsPort ?? null,
      outcome: buildHostedAssistantLinqDeliveryOutcomeRequest({
        acceptedAt: new Date(),
        attemptedAt: requireHostedLinqProviderAttemptedAt(attemptedAt),
        answeredMailboxItemIds: request.answeredMailboxItemIds ?? [],
        fromPhoneNumber: resolvedRoute.fromPhoneNumber,
        idempotencyKey,
        intentId: input.intentId ?? null,
        providerTarget,
        providerThreadId: result.providerThreadId ?? null,
        result,
        target: providerTarget,
        targetKind: "thread",
        threadIsDirect: resolvedRoute.threadIsDirect,
      }),
    });
    await assertHostedDeliveryLiveNow(input);
    return result;
  };
}

function buildHostedAssistantLinqDeliveryOutcomeRequest(input: {
  acceptedAt?: Date | null;
  answeredMailboxItemIds?: readonly string[] | null;
  attemptedAt: Date;
  directRecipientPhoneNumber?: string | null;
  failedAt?: Date | null;
  failureCode?: string | null;
  failureReason?: string | null;
  fromPhoneNumber: string | null;
  idempotencyKey: string | null;
  intentId: string | null;
  providerTarget: string | null;
  providerThreadId: string | null;
  result: HostedRuntimeLinqSendResponse | null;
  target: string | null;
  targetKind: HostedRuntimeProviderTargetKind | null;
  threadIsDirect: boolean | null;
}): HostedRuntimeLinqDeliveryOutcomeRequest {
  return {
    ...(input.acceptedAt ? { acceptedAt: input.acceptedAt.toISOString() } : {}),
    ...(input.answeredMailboxItemIds?.length
      ? { answeredMailboxItemIds: [...input.answeredMailboxItemIds] }
      : {}),
    attemptedAt: input.attemptedAt.toISOString(),
    ...(input.targetKind === "participant"
      ? { directRecipientPhoneNumber: input.directRecipientPhoneNumber ?? null }
      : {}),
    ...(input.failedAt ? { failedAt: input.failedAt.toISOString() } : {}),
    failureCode: input.failureCode ?? null,
    failureReason: input.failureReason ?? null,
    fromPhoneNumber: input.fromPhoneNumber,
    idempotencyKey: input.idempotencyKey,
    intentId: input.intentId,
    providerMessageId: input.result?.providerMessageId ?? null,
    ...(input.result?.providerMessageIds?.length
      ? { providerMessageIds: [...input.result.providerMessageIds] }
      : {}),
    providerTarget: input.targetKind === "participant" ? null : input.providerTarget,
    providerThreadId: input.result?.providerThreadId ?? input.providerThreadId,
    target: input.targetKind === "participant" ? null : input.target,
    targetKind: input.targetKind,
    threadIsDirect: input.threadIsDirect,
  };
}

const pendingHostedAssistantLinqDeliveryOutcomeWrites = new Set<Promise<void>>();

async function recordHostedAssistantLinqDeliveryOutcomeOrQueueBestEffort(input: {
  effectsPort?: Pick<HostedRuntimeEffectsPort, "recordLinqDeliveryOutcome"> | null;
  outcome: HostedRuntimeLinqDeliveryOutcomeRequest;
}): Promise<void> {
  if (shouldRequireHostedAssistantLinqDeliveryOutcomeWrite(input.outcome)) {
    try {
      await recordHostedAssistantLinqDeliveryOutcomeRequired(input);
    } catch (error) {
      throw markHostedDeliveryMayHaveSucceeded(error);
    }
    return;
  }

  queueHostedAssistantLinqDeliveryOutcomeWrite(input);
}

function shouldRequireHostedAssistantLinqDeliveryOutcomeWrite(
  outcome: HostedRuntimeLinqDeliveryOutcomeRequest,
): boolean {
  const richLinkPartial = Boolean(outcome.failedAt)
    && outcome.failureCode
      === HOSTED_LINQ_RICH_LINK_PARTIAL_DELIVERY_FAILURE_CODE;
  if (richLinkPartial) {
    return true;
  }

  const providerAccepted = Boolean(outcome.acceptedAt);
  if (!providerAccepted) {
    return false;
  }
  if (outcome.answeredMailboxItemIds?.length) {
    return true;
  }
  if (outcome.targetKind !== "participant") {
    return false;
  }

  if (isHostedSignupWelcomeDeliveryIdempotencyKey(outcome.idempotencyKey)) {
    return true;
  }

  return (outcome.idempotencyKey?.trim() ?? "").startsWith(
    HOSTED_SIGNUP_WELCOME_DELIVERY_IDEMPOTENCY_PREFIX,
  );
}

async function recordHostedAssistantLinqDeliveryOutcomeRequired(input: {
  effectsPort?: Pick<HostedRuntimeEffectsPort, "recordLinqDeliveryOutcome"> | null;
  outcome: HostedRuntimeLinqDeliveryOutcomeRequest;
}): Promise<void> {
  const recordOutcome = input.effectsPort?.recordLinqDeliveryOutcome;
  if (!recordOutcome) {
    throw new VaultCliError(
      "ASSISTANT_LINQ_DELIVERY_OUTCOME_RECORDER_UNAVAILABLE",
      "Accepted Linq delivery with answered mailbox items requires delivery outcome recording.",
      { retryable: true },
    );
  }

  const abortController = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const record = recordOutcome(input.outcome, { signal: abortController.signal });
    void record.catch(() => undefined);
    const timeout = new Promise<"timed_out">((resolve) => {
      timer = setTimeout(() => {
        abortController.abort();
        resolve("timed_out");
      }, HOSTED_LINQ_DELIVERY_OUTCOME_WRITE_TIMEOUT_MS);
      timer.unref?.();
    });
    const result = await Promise.race([
      record.then(() => "recorded" as const),
      timeout,
    ]);
    if (result === "timed_out") {
      throw new VaultCliError(
        "ASSISTANT_LINQ_DELIVERY_OUTCOME_RECORD_TIMED_OUT",
        "Accepted Linq delivery outcome recording timed out before consume state could be stored.",
        {
          retryable: true,
          timeoutMs: HOSTED_LINQ_DELIVERY_OUTCOME_WRITE_TIMEOUT_MS,
        },
      );
    }
  } catch (error) {
    if (
      error instanceof VaultCliError &&
      error.code === "ASSISTANT_LINQ_DELIVERY_OUTCOME_RECORD_TIMED_OUT"
    ) {
      throw error;
    }
    throw new VaultCliError(
      "ASSISTANT_LINQ_DELIVERY_OUTCOME_RECORD_FAILED",
      "Accepted Linq delivery outcome recording failed before consume state could be stored.",
      {
        errorName: error instanceof Error ? error.name : typeof error,
        retryable: true,
      },
    );
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

function queueHostedAssistantLinqDeliveryOutcomeWrite(input: {
  effectsPort?: Pick<HostedRuntimeEffectsPort, "recordLinqDeliveryOutcome"> | null;
  outcome: HostedRuntimeLinqDeliveryOutcomeRequest;
}): void {
  const recordOutcome = input.effectsPort?.recordLinqDeliveryOutcome;
  if (!recordOutcome) {
    return;
  }

  const write = Promise.resolve().then(async () => {
    const abortController = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const record = recordOutcome(input.outcome, { signal: abortController.signal });
      void record.catch(() => undefined);
      const timeout = new Promise<"timed_out">((resolve) => {
        timer = setTimeout(() => {
          abortController.abort();
          resolve("timed_out");
        }, HOSTED_LINQ_DELIVERY_OUTCOME_WRITE_TIMEOUT_MS);
        timer.unref?.();
      });
      const result = await Promise.race([
        record.then(() => "recorded" as const),
        timeout,
      ]);
      if (result === "timed_out") {
        console.warn("Hosted Linq delivery outcome recording timed out.", {
          timeoutMs: HOSTED_LINQ_DELIVERY_OUTCOME_WRITE_TIMEOUT_MS,
        });
      }
    } catch (error) {
      console.warn("Hosted Linq delivery outcome recording failed.", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
      pendingHostedAssistantLinqDeliveryOutcomeWrites.delete(write);
    }
  });
  pendingHostedAssistantLinqDeliveryOutcomeWrites.add(write);
}

export async function drainHostedAssistantLinqDeliveryOutcomeWritesBestEffort(
  options?: { timeoutMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = timeoutMs === undefined
    ? null
    : new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          resolve();
        }, timeoutMs);
        timer.unref?.();
      });

  try {
    let observed: Promise<void>[];
    do {
      observed = Array.from(pendingHostedAssistantLinqDeliveryOutcomeWrites);
      if (observed.length === 0) {
        return;
      }
      const observedSettled = Promise.allSettled(observed).then(() => undefined);
      await (timeout ? Promise.race([observedSettled, timeout]) : observedSettled);
      if (timedOut) {
        console.warn(
          "Hosted Linq delivery outcome drain timed out; queued writes continue in the background.",
          { timeoutMs },
        );
        return;
      }
    } while (observed.some((write) => pendingHostedAssistantLinqDeliveryOutcomeWrites.has(write)));
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

function readHostedAssistantLinqDeliveryFailureCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.trim()) {
      return code.trim();
    }
  }
  return error instanceof Error && error.name !== "Error"
    ? error.name
    : "HOSTED_LINQ_PROVIDER_SEND_FAILED";
}

function readHostedAssistantLinqRichLinkPartialDeliveryResult(
  error: unknown,
): HostedRuntimeLinqSendResponse | null {
  if (
    typeof error !== "object"
    || error === null
    || !("code" in error)
    || error.code !== HOSTED_LINQ_RICH_LINK_PARTIAL_DELIVERY_FAILURE_CODE
  ) {
    return null;
  }
  const providerMessageIds: string[] = [];
  if ("providerMessageIds" in error && Array.isArray(error.providerMessageIds)) {
    for (const value of error.providerMessageIds) {
      const messageId = typeof value === "string" ? value.trim() : "";
      if (messageId && !providerMessageIds.includes(messageId)) {
        providerMessageIds.push(messageId);
      }
    }
  }
  const providerMessageId = readHostedAssistantLinqPartialDeliveryString(
    error,
    "providerMessageId",
  ) ?? providerMessageIds.at(-1) ?? null;
  if (
    providerMessageId
    && !providerMessageIds.includes(providerMessageId)
  ) {
    providerMessageIds.push(providerMessageId);
  }
  return {
    providerMessageId,
    ...(providerMessageIds.length > 0 ? { providerMessageIds } : {}),
    providerThreadId: readHostedAssistantLinqPartialDeliveryString(
      error,
      "providerThreadId",
    ),
    target: readHostedAssistantLinqPartialDeliveryString(error, "target"),
    targetKind: readHostedAssistantLinqPartialDeliveryTargetKind(error),
  };
}

function readHostedAssistantLinqPartialDeliveryString(
  error: object,
  key: "providerMessageId" | "providerThreadId" | "target",
): string | null {
  const value =
    key === "providerMessageId" && "providerMessageId" in error
      ? error.providerMessageId
      : key === "providerThreadId" && "providerThreadId" in error
        ? error.providerThreadId
        : key === "target" && "target" in error
          ? error.target
          : null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readHostedAssistantLinqPartialDeliveryTargetKind(
  error: object,
): HostedRuntimeProviderTargetKind | null {
  if (!("targetKind" in error)) {
    return null;
  }
  const value = error.targetKind;
  return value === "explicit" || value === "participant" || value === "thread"
    ? value
    : null;
}

function requireHostedLinqProviderAttemptedAt(value: Date | null): Date {
  if (!value) {
    throw new Error("Hosted Linq provider returned before dispatch entry.");
  }
  return value;
}

function readTrustedHostedAssistantLinqDeliveryFailureReason(
  error: unknown,
): string | null {
  if (!(error instanceof VaultCliError)) {
    return null;
  }
  const message = error.message.replace(/\s+/gu, " ").trim();
  return message ? message.slice(0, 500) : null;
}

async function assertHostedAssistantLinqRecentInboundEngagementForDelivery(input: {
  answeredMailboxItemIds?: readonly string[] | null;
  assistantAskCompletionExpiresAt?: string;
  assistantAskFallback?: boolean;
  authorityCheckOnly: boolean;
  directRecipientPhoneNumber: string | null;
  effectsPort?: Pick<HostedRuntimeEffectsPort, "assertLinqRecentInboundEngagement"> | null;
  expectedResolvedRoute?: HostedExecutionResolvedLinqDeliveryRoute;
  fromPhoneNumber: string | null;
  homeRouteFallbackAllowed: boolean;
  idempotencyKey: string | null;
  intentId: string | null;
  providerDispatchRetrySafe?: boolean;
  replyToMessageId: string | null;
  signal: AbortSignal | null;
  target: string;
  targetKind: string | null;
}): Promise<HostedRuntimeLinqRecentInboundEngagementResult> {
  const assertRecentInbound = input.effectsPort?.assertLinqRecentInboundEngagement;
  if (!assertRecentInbound) {
    throw new VaultCliError(
      "ASSISTANT_LINQ_ENGAGEMENT_ASSERT_UNAVAILABLE",
      "Hosted Linq delivery requires an egress authority assertion before provider dispatch.",
      { retryable: true },
    );
  }
  const targetKind = normalizeHostedAssistantLinqTargetKind(input.targetKind);
  let result: HostedRuntimeLinqRecentInboundEngagementResult | void;
  try {
    result = await assertRecentInbound({
      ...(input.answeredMailboxItemIds?.length
        ? { answeredMailboxItemIds: [...input.answeredMailboxItemIds] }
        : {}),
      ...(input.assistantAskFallback === undefined
        ? {}
        : { assistantAskFallback: input.assistantAskFallback }),
      ...(input.assistantAskCompletionExpiresAt === undefined
        ? {}
        : {
            assistantAskCompletionExpiresAt:
              input.assistantAskCompletionExpiresAt,
          }),
      authorityCheckOnly: input.authorityCheckOnly,
      directRecipientPhoneNumber: input.directRecipientPhoneNumber,
      ...(input.expectedResolvedRoute
        ? { expectedResolvedRoute: input.expectedResolvedRoute }
        : {}),
      fromPhoneNumber: input.fromPhoneNumber,
      homeRouteFallbackAllowed: input.homeRouteFallbackAllowed,
      idempotencyKey: input.idempotencyKey,
      intentId: input.intentId,
      replyToMessageId: input.replyToMessageId,
      target: input.target,
      targetKind,
    }, {
      signal: input.signal,
    });
  } catch (error) {
    if (
      input.authorityCheckOnly !== true
      && isHostedLinqProviderDispatchAlreadyStartedError(error)
    ) {
      const alreadyStarted = { providerDispatchClaimed: false };
      assertHostedAssistantLinqProviderDispatchClaim({
        providerDispatchRetrySafe: input.providerDispatchRetrySafe === true,
        result: alreadyStarted,
      });
      return alreadyStarted;
    }
    throw markHostedPhoneCallResultRouteRevocationRetryable({
      error,
      idempotencyKey: input.idempotencyKey,
    });
  }
  const normalized = normalizeHostedAssistantLinqEngagementResult(result);
  if (input.authorityCheckOnly !== true && normalized.deliveryBlockCode) {
    const code = `ASSISTANT_LINQ_EGRESS_${
      normalized.deliveryBlockCode.toUpperCase()
    }`;
    if (normalized.deliveryBlockCode === "chat_opted_out") {
      throw createAssistantDeliveryTerminalError(
        code,
        "Hosted Linq delivery is blocked because this chat opted out.",
      );
    }
    throw createAssistantDeliveryBlockedError(
      code,
      "Hosted Linq delivery is blocked by current line or chat health.",
      {
        blockKind: normalized.deliveryBlockCode,
        resume: normalized.deliveryBlockCode === "operator_disabled"
          ? "manual_ops"
          : normalized.deliveryBlockCode === "chat_critical"
            ? "recipient_inbound"
            : "line_health_change",
      },
    );
  }
  if (
    input.authorityCheckOnly !== true
    && normalized.assistantAskFallbackRequired !== true
  ) {
    assertHostedAssistantLinqProviderDispatchClaim({
      providerDispatchRetrySafe: input.providerDispatchRetrySafe === true,
      result: normalized,
    });
  }
  return normalized;
}

function isHostedLinqProviderDispatchAlreadyStartedError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "HOSTED_LINQ_PROVIDER_DISPATCH_ALREADY_STARTED";
}

function assertHostedAssistantLinqProviderDispatchClaim(input: {
  providerDispatchRetrySafe: boolean;
  result: HostedRuntimeLinqRecentInboundEngagementResult;
}): void {
  if (typeof input.result.providerDispatchClaimed !== "boolean") {
    throw new VaultCliError(
      "ASSISTANT_LINQ_PROVIDER_DISPATCH_PROTOCOL_UNAVAILABLE",
      "Hosted Linq delivery requires provider-dispatch claim confirmation before provider entry.",
      { retryable: true },
    );
  }
  if (
    input.result.providerDispatchClaimed === false
    && !input.providerDispatchRetrySafe
  ) {
    throw markHostedDeliveryMayHaveSucceeded(new VaultCliError(
      "ASSISTANT_DELIVERY_CONFIRMATION_PENDING",
      "Hosted Linq provider dispatch may already have started and requires reconciliation.",
      { retryable: false },
    ));
  }
}

function normalizeHostedAssistantLinqEngagementResult(
  result: HostedRuntimeLinqRecentInboundEngagementResult | void,
): HostedRuntimeLinqRecentInboundEngagementResult {
  const normalized: HostedRuntimeLinqRecentInboundEngagementResult = {};
  if (typeof result?.assistantAskFallbackRequired === "boolean") {
    normalized.assistantAskFallbackRequired =
      result.assistantAskFallbackRequired;
  }
  if (result?.deliveryBlockCode) {
    normalized.deliveryBlockCode = result.deliveryBlockCode;
  }
  if (result?.deliveryPosture) {
    normalized.deliveryPosture = result.deliveryPosture;
  }
  if (typeof result?.providerDispatchClaimed === "boolean") {
    normalized.providerDispatchClaimed = result.providerDispatchClaimed;
  }
  const resolvedRoute = normalizeHostedAssistantLinqResolvedRoute(
    result?.resolvedRoute,
  );
  if (resolvedRoute) {
    normalized.resolvedRoute = resolvedRoute;
  }
  return normalized;
}

function requireHostedAssistantLinqResolvedRoute(
  result: HostedRuntimeLinqRecentInboundEngagementResult,
): HostedExecutionResolvedLinqDeliveryRoute {
  const resolvedRoute = normalizeHostedAssistantLinqResolvedRoute(
    result.resolvedRoute,
  );
  if (!resolvedRoute) {
    throw new VaultCliError(
      "ASSISTANT_LINQ_RESOLVED_ROUTE_PROTOCOL_UNAVAILABLE",
      "Hosted Linq delivery requires one canonical send-time route before provider access.",
      { retryable: true },
    );
  }
  return resolvedRoute;
}

function normalizeHostedAssistantLinqResolvedRoute(
  value: HostedExecutionResolvedLinqDeliveryRoute | null | undefined,
): HostedExecutionResolvedLinqDeliveryRoute | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const target = value.target?.trim() ?? "";
  const conversationThreadId = normalizeHostedLinqRouteNullableText(
    value.conversationThreadId,
  );
  const directRecipientPhoneNumber = normalizeHostedLinqDirectRecipient(
    value.directRecipientPhoneNumber,
  );
  const fromPhoneNumber = normalizeHostedLinqDirectRecipient(
    value.fromPhoneNumber,
  );
  if (
    !target
    || !("conversationThreadId" in value)
    || !("directRecipientPhoneNumber" in value)
    || !("fromPhoneNumber" in value)
    || (value.targetKind !== "participant" && value.targetKind !== "thread")
    || typeof value.threadIsDirect !== "boolean"
    || (
      value.conversationThreadId !== null
      && conversationThreadId === null
    )
    || (
      value.directRecipientPhoneNumber !== null
      && directRecipientPhoneNumber === null
    )
    || (value.fromPhoneNumber !== null && fromPhoneNumber === null)
    || (
      value.targetKind === "participant"
      && (
        value.threadIsDirect !== true
        || directRecipientPhoneNumber === null
        || directRecipientPhoneNumber !== target
      )
    )
    || (
      value.targetKind === "thread"
      && value.threadIsDirect === false
      && directRecipientPhoneNumber !== null
    )
  ) {
    return null;
  }
  return {
    conversationThreadId,
    directRecipientPhoneNumber,
    fromPhoneNumber,
    target,
    targetKind: value.targetKind,
    threadIsDirect: value.threadIsDirect,
  };
}

function normalizeHostedLinqRouteNullableText(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeHostedAssistantLinqTargetKind(
  targetKind: string | null,
): HostedRuntimeProviderTargetKind | null {
  return targetKind === "explicit" || targetKind === "participant" || targetKind === "thread"
    ? targetKind
    : null;
}

function normalizeHostedLinqDirectRecipient(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.startsWith("+") ? normalized : null;
}

function mergeHostedAssistantLinqSignals(
  first: AbortSignal | null,
  second: AbortSignal | undefined,
): AbortSignal | undefined {
  if (!first) {
    return second;
  }
  if (!second || first === second) {
    return first;
  }
  return AbortSignal.any([first, second]);
}

async function assertHostedDeliveryLiveNow(input: {
  assertLiveness?: () => Promise<void>;
  signal: AbortSignal | null;
}): Promise<void> {
  assertHostedDeliveryLiveness(input.signal);
  await input.assertLiveness?.();
  assertHostedDeliveryLiveness(input.signal);
}

function assertHostedDeliveryLiveness(signal: AbortSignal | null | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  const reason = signal.reason;
  if (reason instanceof Error) {
    throw reason;
  }
  throw new Error("Hosted assistant delivery was aborted.");
}

async function maybeResolveHostedAssistantDeliveryFromMirror(input: {
  allowPreparedSending?: boolean;
  assistantDeliveryEffect: HostedAssistantDeliveryEffect;
  mirrorState: Awaited<ReturnType<typeof readAssistantOutboxIntentMirrorState>>;
  now: Date;
  userId: string;
  vaultRoot: string;
  wake: HostedRuntimeEvent;
}): Promise<HostedAssistantDeliveryOutcome | null> {
  const intent = input.mirrorState.intent;
  if (!intent) {
    const missingResult = {
      code: "ASSISTANT_DELIVERY_MISSING_RESULT",
      message: "The assistant outbox mirror did not contain the committed delivery intent.",
    };
    emitHostedAssistantDeliveryDispatchOutcome({
      deliveryError: missingResult,
      deliveryStatus: "missing-result",
      wake: input.wake,
      effect: input.assistantDeliveryEffect,
      retryable: false,
      userId: input.userId,
    });
    return buildHostedAssistantDeliveryOutcome({
      deliveryErrorCode: missingResult.code,
      deliveryErrorMessage: missingResult.message,
      deliveryStatus: "missing-result",
      effect: input.assistantDeliveryEffect,
      retryable: false,
    });
  }

  switch (intent.status) {
    case "sent": {
      if (!intent.delivery) {
        return buildHostedAssistantDeliveryOutcome({
          deliveryErrorCode: "ASSISTANT_DELIVERY_MISSING_RESULT",
          deliveryErrorMessage: "The assistant outbox mirror marked the delivery sent without a receipt.",
          deliveryStatus: "missing-result",
          effect: input.assistantDeliveryEffect,
          retryable: false,
        });
      }
      emitHostedAssistantDeliveryDispatchSuccess({
        delivery: intent.delivery,
        wake: input.wake,
        effect: input.assistantDeliveryEffect,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        delivery: intent.delivery,
        deliveryStatus: "sent",
        effect: input.assistantDeliveryEffect,
        retryable: false,
      });
    }
    case "failed": {
      const failure = normalizeHostedAssistantDeliveryMirrorFailure({
        fallbackMessage: "The assistant outbox mirror recorded a terminal delivery failure.",
        lastError: intent.lastError,
      });
      const failureDetails = normalizeHostedAssistantDeliveryErrorDetails(failure);
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError: failure,
        deliveryErrorDetails: failureDetails,
        deliveryStatus: "failed",
        wake: input.wake,
        effect: input.assistantDeliveryEffect,
        retryable: false,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: failure.code,
        deliveryErrorDetails: failureDetails,
        deliveryErrorMessage: failure.message,
        deliveryStatus: "failed",
        effect: input.assistantDeliveryEffect,
        retryable: false,
      });
    }
    case "abandoned": {
      const ambiguousError = normalizeHostedAssistantDeliveryMirrorFailure({
        fallbackMessage: "The assistant outbox mirror recorded an abandoned delivery attempt.",
        lastError: intent.lastError,
      });
      const ambiguousErrorDetails =
        normalizeHostedAssistantDeliveryErrorDetails(ambiguousError);
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError: ambiguousError,
        deliveryErrorDetails: ambiguousErrorDetails,
        deliveryStatus: "failed_ambiguous",
        wake: input.wake,
        effect: input.assistantDeliveryEffect,
        retryable: false,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: ambiguousError.code,
        deliveryErrorDetails: ambiguousErrorDetails,
        deliveryErrorMessage: ambiguousError.message,
        deliveryStatus: "failed_ambiguous",
        delivery: intent.delivery ?? null,
        effect: input.assistantDeliveryEffect,
        retryable: false,
      });
    }
    case "retryable": {
      if (shouldDispatchAssistantOutboxIntent(intent, input.now)) {
        return null;
      }
      const retryableError = normalizeHostedAssistantDeliveryMirrorFailure({
        fallbackMessage: "The assistant outbox mirror scheduled the next retry attempt.",
        lastError: intent.lastError,
      });
      const retryableErrorDetails =
        normalizeHostedAssistantDeliveryErrorDetails(retryableError);
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError: retryableError,
        deliveryErrorDetails: retryableErrorDetails,
        deliveryStatus: "retryable",
        wake: input.wake,
        effect: input.assistantDeliveryEffect,
        retryable: true,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: retryableError.code,
        deliveryErrorDetails: retryableErrorDetails,
        deliveryErrorMessage: retryableError.message,
        deliveryStatus: "retryable",
        effect: input.assistantDeliveryEffect,
        retryable: true,
      });
    }
    case "sending": {
      if (input.allowPreparedSending === true) {
        return null;
      }
      if (!input.mirrorState.sendingPastGraceWindow) {
        emitHostedAssistantDeliveryDispatchOutcome({
          deliveryError: null,
          deliveryStatus: "sending",
          wake: input.wake,
          effect: input.assistantDeliveryEffect,
          retryable: true,
          userId: input.userId,
        });
        return buildHostedAssistantDeliveryOutcome({
          deliveryStatus: "sending",
          effect: input.assistantDeliveryEffect,
          retryable: true,
        });
      }

      if (shouldDispatchAssistantOutboxIntent(intent, input.now)) {
        return null;
      }

      if (isHostedDeliveryTransportIdempotent(input.assistantDeliveryEffect)) {
        return null;
      }

      const confirmationPending = normalizeHostedAssistantDeliveryMirrorFailure({
        fallbackMessage:
          "The assistant outbox mirror remained in sending state past the confirmation grace window.",
        lastError: intent.lastError,
      });
      const confirmationPendingDetails =
        normalizeHostedAssistantDeliveryErrorDetails(confirmationPending);
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError: confirmationPending,
        deliveryErrorDetails: confirmationPendingDetails,
        deliveryStatus: "sending",
        wake: input.wake,
        effect: input.assistantDeliveryEffect,
        retryable: true,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: confirmationPending.code,
        deliveryErrorDetails: confirmationPendingDetails,
        deliveryErrorMessage: confirmationPending.message,
        deliveryStatus: "sending",
        delivery: intent.delivery ?? null,
        effect: input.assistantDeliveryEffect,
        retryable: true,
      });
    }
    default:
      return null;
  }
}

async function maybeFailHostedDisabledAutoReplyDelivery(input: {
  assistantDeliveryEffect: HostedAssistantDeliveryEffect;
  mirrorState: Awaited<ReturnType<typeof readAssistantOutboxIntentMirrorState>>;
  userId: string;
  vaultRoot: string;
  wake: HostedRuntimeEvent;
}): Promise<HostedAssistantDeliveryOutcome | null> {
  const intent = input.mirrorState.intent;
  if (!intent) {
    return null;
  }
  if (readHostedAcceptedLinqReactionDeliveryAwaitingConsume(intent)) {
    return null;
  }
  if (!await hostedAssistantDeliveryIntentIsAutoReply({
    intent,
    vaultRoot: input.vaultRoot,
  })) {
    return null;
  }

  const channel = normalizeHostedAssistantDeliveryChannel(
    intent.channel ?? input.assistantDeliveryEffect.payload.channel,
  );
  if (!channel) {
    return null;
  }

  const automationState = await readAssistantAutomationState(input.vaultRoot);
  if (hasAssistantAutoReplyChannel(automationState.autoReply, channel)) {
    return null;
  }

  const error = new VaultCliError(
    "ASSISTANT_DELIVERY_CHANNEL_DISABLED",
    `Assistant auto-reply delivery over ${channel} is disabled.`,
    { retryable: false },
  );
  const failedIntent = await markAssistantOutboxIntentMirrorTerminalById({
    error,
    intentId: intent.intentId,
    status: "failed",
    vault: input.vaultRoot,
  });
  if (!failedIntent) {
    return buildHostedAssistantDeliveryOutcome({
      deliveryErrorCode: error.code,
      deliveryErrorMessage: error.message,
      deliveryStatus: "failed",
      effect: input.assistantDeliveryEffect,
      retryable: false,
    });
  }

  return await buildHostedAssistantDeliveryDispatchResult({
    assistantDeliveryEffect: input.assistantDeliveryEffect,
    dispatchResult: {
      deliveryError: failedIntent.lastError,
      intent: failedIntent,
      session: null,
    },
    userId: input.userId,
    vaultRoot: input.vaultRoot,
    wake: input.wake,
  });
}

async function hostedAssistantDeliveryIntentIsAutoReply(input: {
  intent: Pick<AssistantOutboxIntent, "intentId" | "turnId">;
  vaultRoot: string;
}): Promise<boolean> {
  const matched = await findAssistantAutoReplyDeliveryIntentIds({
    intents: [input.intent],
    vault: input.vaultRoot,
  });
  return matched.has(input.intent.intentId);
}

function normalizeHostedAssistantDeliveryChannel(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function emitHostedAssistantDeliveryDispatchSuccess(input: {
  delivery: AssistantChannelDelivery;
  wake: HostedRuntimeEvent;
  effect: HostedAssistantDeliveryEffect;
  userId: string;
}): void {
  emitHostedExecutionStructuredLog({
    component: "assistant-delivery",
    details: buildHostedAssistantDeliveryDetails({
      effectFingerprint: input.effect.fingerprint,
      effectId: input.effect.effectId,
      extra: {
        deliveryChannel: input.delivery.channel,
        deliveryPhase: input.effect.deliveryPhase,
        deliveryStatus: "sent",
        eventType: "assistant.delivery.sent",
        failureDomain: "delivery",
        retryable: false,
        targetKind: input.delivery.targetKind,
      },
      userId: input.userId,
    }),
    wake: input.wake,
    message: "Hosted assistant delivery sent.",
    phase: "outbox",
    userId: input.userId,
  });
}

function emitHostedAssistantDeliveryDispatchOutcome(input: {
  deliveryError: { code: string | null; message: string } | null;
  deliveryErrorDetails?: HostedAssistantDeliveryErrorDetails | null;
  deliveryStatus:
    | "failed"
    | "failed_ambiguous"
    | "missing-result"
    | "pending"
    | "retryable"
    | "sending";
  wake: HostedRuntimeEvent;
  effect: HostedAssistantDeliveryEffect;
  retryable: boolean;
  userId: string;
}): void {
  emitHostedExecutionStructuredLog({
    component: "assistant-delivery",
    details: buildHostedAssistantDeliveryDetails({
      effectFingerprint: input.effect.fingerprint,
      effectId: input.effect.effectId,
      extra: {
        deliveryErrorCode: input.deliveryError?.code ?? null,
        deliveryErrorMessage: input.deliveryError?.message ?? null,
        ...buildHostedAssistantDeliveryErrorDetailLogFields(
          input.deliveryErrorDetails ?? null,
        ),
        deliveryPhase: input.effect.deliveryPhase,
        deliveryStatus: input.deliveryStatus,
        failureDomain: "delivery",
        retryable: input.retryable,
      },
      userId: input.userId,
    }),
    wake: input.wake,
    level: input.retryable ? "warn" : "error",
    message: `Hosted assistant delivery finished with ${input.deliveryStatus} status.`,
    phase: "outbox",
    userId: input.userId,
  });
}

async function buildHostedAssistantDeliveryDispatchResult(input: {
  assistantDeliveryEffect: HostedAssistantDeliveryEffect;
  dispatchResult: Awaited<ReturnType<typeof dispatchAssistantOutboxIntent>>;
  userId: string;
  vaultRoot: string;
  wake: HostedRuntimeEvent;
}): Promise<HostedAssistantDeliveryOutcome> {
  const { assistantDeliveryEffect, dispatchResult } = input;
  const delivery = dispatchResult.intent.delivery
    ? assistantChannelDeliverySchema.parse(dispatchResult.intent.delivery)
    : null;

  if (dispatchResult.intent.status === "sent" && delivery) {
    emitHostedAssistantDeliveryDispatchSuccess({
      delivery,
      wake: input.wake,
      effect: assistantDeliveryEffect,
      userId: input.userId,
    });
    return buildHostedAssistantDeliveryOutcome({
      delivery,
      deliveryStatus: "sent",
      effect: assistantDeliveryEffect,
      retryable: false,
    });
  }

  const deliveryErrorSource =
    dispatchResult.deliveryError ?? dispatchResult.intent.lastError;
  const deliveryError = dispatchResult.deliveryError
    ? normalizeAssistantDeliveryError(dispatchResult.deliveryError)
    : normalizeHostedAssistantDeliveryMirrorFailure({
        fallbackMessage: "The assistant outbox mirror did not produce a delivery result.",
        lastError: dispatchResult.intent.lastError,
      });
  const deliveryErrorDetails =
    normalizeHostedAssistantDeliveryErrorDetails(deliveryErrorSource);

  switch (dispatchResult.intent.status) {
    case "failed":
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError,
        deliveryErrorDetails,
        deliveryStatus: "failed",
        wake: input.wake,
        effect: assistantDeliveryEffect,
        retryable: false,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: deliveryError.code,
        deliveryErrorDetails,
        deliveryErrorMessage: deliveryError.message,
        deliveryStatus: "failed",
        effect: assistantDeliveryEffect,
        retryable: false,
      });
    case "awaiting_approval":
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError,
        deliveryErrorDetails,
        deliveryStatus: "pending",
        wake: input.wake,
        effect: assistantDeliveryEffect,
        retryable: false,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: deliveryError.code,
        deliveryErrorDetails,
        deliveryErrorMessage: deliveryError.message,
        deliveryStatus: "pending",
        effect: assistantDeliveryEffect,
        retryable: false,
      });
    case "retryable":
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError,
        deliveryErrorDetails,
        deliveryStatus: "retryable",
        wake: input.wake,
        effect: assistantDeliveryEffect,
        retryable: true,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: deliveryError.code,
        deliveryErrorDetails,
        deliveryErrorMessage: deliveryError.message,
        deliveryStatus: "retryable",
        effect: assistantDeliveryEffect,
        retryable: true,
      });
    case "sending":
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError,
        deliveryErrorDetails,
        deliveryStatus: "sending",
        wake: input.wake,
        effect: assistantDeliveryEffect,
        retryable: true,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: deliveryError.code,
        deliveryErrorDetails,
        deliveryErrorMessage: deliveryError.message,
        deliveryStatus: "sending",
        effect: assistantDeliveryEffect,
        retryable: true,
      });
    case "pending":
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError,
        deliveryErrorDetails,
        deliveryStatus: "retryable",
        wake: input.wake,
        effect: assistantDeliveryEffect,
        retryable: true,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: deliveryError.code,
        deliveryErrorDetails,
        deliveryErrorMessage: deliveryError.message,
        deliveryStatus: "pending",
        effect: assistantDeliveryEffect,
        retryable: true,
      });
    case "abandoned": {
      const ambiguousError = normalizeHostedAssistantDeliveryMirrorFailure({
        fallbackMessage: "The assistant outbox mirror recorded an abandoned delivery attempt.",
        lastError: dispatchResult.intent.lastError,
      });
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError: ambiguousError,
        deliveryErrorDetails,
        deliveryStatus: "failed_ambiguous",
        wake: input.wake,
        effect: assistantDeliveryEffect,
        retryable: false,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: ambiguousError.code,
        deliveryErrorDetails,
        deliveryErrorMessage: ambiguousError.message,
        deliveryStatus: "failed_ambiguous",
        delivery,
        effect: assistantDeliveryEffect,
        retryable: false,
      });
    }
    default:
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: "ASSISTANT_DELIVERY_MISSING_RESULT",
        deliveryErrorMessage: "The assistant outbox mirror did not return a supported delivery state.",
        deliveryStatus: "missing-result",
        effect: assistantDeliveryEffect,
        retryable: false,
      });
  }
}

function buildHostedAssistantDeliveryPayloadFromIntent(
  intent: Pick<
    AssistantOutboxIntent,
    | "actorId"
    | "answeredMailboxItemIds"
    | "bindingDelivery"
    | "card"
    | "channel"
    | "deliveryIdempotencyKey"
    | "deliverySource"
    | "deliveryTransportIdempotent"
    | "emailHtml"
    | "explicitTarget"
    | "identityId"
    | "intentId"
    | "media"
    | "message"
    | "nativeReplyRequested"
    | "groupEmailAuthorizationProof"
    | "newsletterAuthorizationProof"
    | "subject"
    | "replyToMessageId"
    | "sessionId"
    | "threadId"
    | "threadIsDirect"
    | "turnId"
  >,
): HostedAssistantDeliveryPayload {
  const payload: HostedAssistantDeliveryPayload = {
    actorId: intent.actorId ?? null,
    answeredMailboxItemIds: intent.answeredMailboxItemIds ?? [],
    bindingDeliveryKind: intent.bindingDelivery?.kind ?? null,
    bindingDeliveryTarget: intent.bindingDelivery?.target ?? null,
    ...(intent.card == null ? {} : { card: intent.card }),
    channel: intent.channel ?? null,
    deliverySourceKey: readHostedAssistantDeliverySourceKey(intent.deliverySource),
    ...(intent.emailHtml == null ? {} : { emailHtml: intent.emailHtml }),
    explicitTarget: intent.explicitTarget ?? null,
    idempotencyKey: intent.deliveryIdempotencyKey ?? `assistant-outbox:${intent.intentId}`,
    identityId: intent.identityId ?? null,
    media: normalizeHostedAssistantDeliveryMedia(intent.media),
    message: intent.message,
    ...(intent.nativeReplyRequested === true ? { nativeReplyRequested: true } : {}),
    ...(intent.groupEmailAuthorizationProof == null
      && intent.newsletterAuthorizationProof == null
      ? {}
      : {
          groupEmailAuthorizationProof: intent.groupEmailAuthorizationProof
            ?? intent.newsletterAuthorizationProof,
        }),
    subject: intent.subject ?? null,
    replyToMessageId: intent.replyToMessageId ?? null,
    sessionId: intent.sessionId,
    threadId: intent.threadId ?? null,
    threadIsDirect: intent.threadIsDirect ?? null,
    transportIdempotent: intent.deliveryTransportIdempotent,
    turnId: intent.turnId,
  };

  assertSupportedHostedAssistantDeliveryPayload(payload);
  return payload;
}

function normalizeHostedAssistantDeliveryMedia(
  media: AssistantOutboxIntent["media"],
): HostedAssistantDeliveryMedia[] {
  return (media ?? []).map((item) => {
    if (item.kind === "vault_file") {
      return {
        approvalGeneration: item.approvalGeneration,
        approvalId: item.approvalId,
        contentType: item.contentType,
        filename: item.filename,
        kind: item.kind,
        ref: item.ref,
        sha256: item.sha256,
        sizeBytes: item.sizeBytes,
      };
    }
    if (item.kind !== "voice_memo") {
      return item;
    }

    return {
      filename: item.filename,
      kind: "voice_memo",
      transcript: item.transcript ?? null,
      transport: item.transport,
    };
  });
}

function isHostedDeliveryTransportIdempotent(
  effect: Pick<HostedAssistantDeliveryEffect, "payload">,
): boolean {
  return effect.payload.transportIdempotent;
}

function attachHostedAssistantDeliveryDispatchDetails(
  error: unknown,
  input: {
    effectId: string;
    fingerprint: string;
    userId: string;
  },
): unknown {
  if (!error || typeof error !== "object") {
    return error;
  }

  const existingDetails = "details" in error && error.details && typeof error.details === "object"
    ? error.details as Record<string, unknown>
    : null;
  Object.assign(error, {
    details: {
      ...(existingDetails ?? {}),
      ...buildHostedAssistantDeliveryDetails({
        effectFingerprint: input.fingerprint,
        effectId: input.effectId,
        userId: input.userId,
      }),
    },
  });
  return error;
}

function normalizeHostedAssistantDeliveryErrorDetails(
  deliveryError: { diagnosticContext?: unknown } | null | undefined,
): HostedAssistantDeliveryErrorDetails | null {
  const context = readHostedAssistantDeliveryErrorDetailsRecord(
    deliveryError?.diagnosticContext,
  );
  if (!context) {
    return null;
  }

  const sanitized = sanitizeHostedExecutionStructuredLogDetails(context);
  if (!sanitized) {
    return null;
  }

  const details: HostedAssistantDeliveryErrorDetails = {};
  for (const [key, value] of Object.entries(sanitized)) {
    if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
      details[key] = value;
    }
  }

  return Object.keys(details).length > 0 ? details : null;
}

function buildHostedAssistantDeliveryErrorDetailLogFields(
  details: HostedAssistantDeliveryErrorDetails | null,
): HostedAssistantDeliveryDetails {
  if (!details) {
    return {};
  }

  const output: HostedAssistantDeliveryDetails = {};
  appendHostedAssistantDeliveryErrorLogValue(output, "Status", readFirstHostedAssistantDeliveryErrorDetail(
    details,
    ["status", "statusCode", "responseStatus", "errorStatus"],
  ));
  appendHostedAssistantDeliveryErrorLogValue(output, "ProviderCode", readFirstHostedAssistantDeliveryErrorDetail(
    details,
    ["errorCode", "errorCodeDetail", "providerErrorCode"],
  ));
  appendHostedAssistantDeliveryErrorLogValue(output, "Description", readFirstHostedAssistantDeliveryErrorDetail(
    details,
    ["description", "errorDetail", "safeErrorMessage"],
  ));
  appendHostedAssistantDeliveryErrorLogValue(output, "Operation", readFirstHostedAssistantDeliveryErrorDetail(
    details,
    ["operation", "action"],
  ));
  appendHostedAssistantDeliveryErrorLogValue(output, "FailureStage", details.failureStage);
  appendHostedAssistantDeliveryErrorLogValue(output, "Method", details.method);
  appendHostedAssistantDeliveryErrorLogValue(output, "Retryable", details.retryable);
  appendHostedAssistantDeliveryErrorLogValue(output, "TimedOut", details.timedOut);
  appendHostedAssistantDeliveryErrorLogValue(
    output,
    "TransportErrorName",
    details.transportErrorName,
  );
  appendHostedAssistantDeliveryErrorLogValue(output, "ErrorName", readFirstHostedAssistantDeliveryErrorDetail(
    details,
    ["name", "errorName"],
  ));
  appendHostedAssistantDeliveryErrorLogValue(output, "Target", readFirstHostedAssistantDeliveryErrorDetail(
    details,
    ["target", "targetLabel"],
  ));
  appendHostedAssistantDeliveryErrorLogValue(output, "Cause", readFirstHostedAssistantDeliveryErrorDetail(
    details,
    ["errorCause", "cause"],
  ));
  output.deliveryErrorDetailFieldCount = Object.keys(details).length;
  return output;
}

function appendHostedAssistantDeliveryErrorLogValue(
  output: HostedAssistantDeliveryDetails,
  suffix: string,
  value: HostedAssistantDeliveryErrorDetails[string] | undefined,
): void {
  if (value === undefined) {
    return;
  }
  output[`deliveryErrorDetail${suffix}`] = value;
}

function readFirstHostedAssistantDeliveryErrorDetail(
  details: HostedAssistantDeliveryErrorDetails,
  keys: readonly string[],
): HostedAssistantDeliveryErrorDetails[string] | undefined {
  for (const key of keys) {
    if (key in details) {
      return details[key];
    }
  }
  return undefined;
}

function readHostedAssistantDeliveryErrorDetailsRecord(
  value: unknown,
): HostedExecutionStructuredLogDetails | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as HostedExecutionStructuredLogDetails
    : null;
}

function buildHostedAssistantDeliveryOutcome(input: {
  delivery?: AssistantChannelDelivery | null;
  deliveryErrorCode?: string | null;
  deliveryErrorDetails?: HostedAssistantDeliveryErrorDetails | null;
  deliveryErrorMessage?: string | null;
  deliveryStatus: HostedAssistantDeliveryOutcome["deliveryStatus"];
  effect: HostedAssistantDeliveryEffect;
  retryable: boolean;
}): HostedAssistantDeliveryOutcome {
  const cleanupMessages = readAssistantDeliveryCleanupMessages(input.delivery ?? null);
  const cleanupTargetAliases = readAssistantDeliveryCleanupTargetAliases(
    input.delivery ?? null,
  );
  const messageDelivery =
    input.delivery?.kind === "message-reaction" ? null : input.delivery;
  const payloadTarget = readHostedAssistantDeliveryPayloadTarget(input.effect.payload);
  const deliveryChannel =
    input.delivery?.channel
    ?? normalizeHostedAssistantDeliveryChannel(input.effect.payload.channel);
  return {
    deliveryChannel,
    deliveryErrorCode: input.deliveryErrorCode ?? null,
    deliveryErrorDetails: input.deliveryErrorDetails ?? null,
    deliveryErrorMessage: input.deliveryErrorMessage ?? null,
    deliveryStatus: input.deliveryStatus,
    effectFingerprint: input.effect.fingerprint,
    effectId: input.effect.effectId,
    journalMethod: null,
    journalStatus: null,
    ...(cleanupMessages && cleanupMessages.length > 0
      ? {
          cleanupMessages: cleanupMessages.map((cleanupMessage) => ({ ...cleanupMessage })),
        }
      : {}),
    ...(cleanupTargetAliases && cleanupTargetAliases.length > 0
      ? {
          cleanupTargetAliases: [...cleanupTargetAliases],
        }
      : {}),
    providerMessageId: messageDelivery?.providerMessageId ?? null,
    ...(messageDelivery?.providerMessageIds && messageDelivery.providerMessageIds.length > 0
      ? {
          providerMessageIds: [...messageDelivery.providerMessageIds],
        }
      : {}),
    providerThreadId: messageDelivery?.providerThreadId ?? null,
    retryable: input.retryable,
    target: input.delivery?.target ?? payloadTarget.target,
    targetKind: input.delivery?.targetKind ?? payloadTarget.targetKind,
  };
}

function readHostedAssistantDeliveryPayloadTarget(
  payload: HostedAssistantDeliveryPayload,
): { target: string | null; targetKind: string | null } {
  if (payload.explicitTarget) {
    return {
      target: payload.explicitTarget,
      targetKind: "explicit",
    };
  }

  if (payload.bindingDeliveryTarget) {
    return {
      target: payload.bindingDeliveryTarget,
      targetKind: payload.bindingDeliveryKind,
    };
  }

  if (payload.threadId) {
    return {
      target: payload.threadId,
      targetKind: "thread",
    };
  }

  return {
    target: null,
    targetKind: null,
  };
}

function readHostedAssistantDeliveryPayloadTargets(
  payload: HostedAssistantDeliveryPayload,
): Array<{ target: string; targetKind: string | null }> {
  const targets: Array<{ target: string; targetKind: string | null }> = [];
  appendHostedAssistantDeliveryPayloadTarget(targets, payload.explicitTarget, "explicit");
  appendHostedAssistantDeliveryPayloadTarget(
    targets,
    payload.bindingDeliveryTarget,
    payload.bindingDeliveryKind,
  );
  appendHostedAssistantDeliveryPayloadTarget(targets, payload.threadId, "thread");
  return targets;
}

function appendHostedAssistantDeliveryPayloadTarget(
  targets: Array<{ target: string; targetKind: string | null }>,
  target: string | null | undefined,
  targetKind: string | null,
): void {
  const normalized = target?.trim() ?? "";
  if (!normalized || targets.some((item) => item.target === normalized)) {
    return;
  }
  targets.push({
    target: normalized,
    targetKind,
  });
}

function readAssistantDeliveryCleanupMessages(
  delivery: AssistantChannelDelivery | null,
): Array<{ messageId: string; target: string }> | null {
  if (!delivery || !("cleanupMessages" in delivery) || !Array.isArray(delivery.cleanupMessages)) {
    return null;
  }

  const cleanupMessages = Array.from(
    new Map(
      delivery.cleanupMessages.flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }

        const messageId =
          "messageId" in entry && typeof entry.messageId === "string"
            ? entry.messageId.trim()
            : "";
        const target =
          "target" in entry && typeof entry.target === "string"
            ? entry.target.trim()
            : "";
        if (messageId.length === 0 || target.length === 0) {
          return [];
        }

        return [[`${target}\u0000${messageId}`, { messageId, target }] as const];
      }),
    ).values(),
  );

  return cleanupMessages.length > 0 ? cleanupMessages : null;
}

function readAssistantDeliveryCleanupTargetAliases(
  delivery: AssistantChannelDelivery | null,
): readonly string[] | null {
  if (!delivery || !("cleanupTargetAliases" in delivery) || !Array.isArray(delivery.cleanupTargetAliases)) {
    return null;
  }

  return delivery.cleanupTargetAliases;
}

function normalizeHostedAssistantDeliveryMirrorFailure(input: {
  fallbackMessage: string;
  lastError: AssistantDeliveryError | null;
}): AssistantDeliveryError {
  return input.lastError ?? {
    code: null,
    message: input.fallbackMessage,
  };
}

function assertSupportedHostedAssistantDeliveryPayload(
  payload: Pick<
    HostedAssistantDeliveryPayload,
    "bindingDeliveryKind" | "card" | "channel" | "explicitTarget" | "media"
  >,
): void {
  if (payload.card != null && payload.media.length > 0) {
    throw new VaultCliError(
      "ASSISTANT_RESPONSE_CARD_MEDIA_CONFLICT",
      "Assistant delivery cannot combine a response card with media.",
    );
  }

  if (payload.channel !== "email") {
    return;
  }

  if (
    payload.explicitTarget
    || payload.bindingDeliveryKind === "thread"
    || payload.bindingDeliveryKind === null
  ) {
    return;
  }

  throw new VaultCliError(
    "ASSISTANT_HOSTED_EMAIL_PARTICIPANT_UNSUPPORTED",
    "Hosted email participant delivery is not supported. Use an explicit recipient or a serialized thread target.",
  );
}

function readHostedAssistantDeliveryRetryableFlag(error: unknown): boolean | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  if ("retryable" in error && typeof error.retryable === "boolean") {
    return error.retryable;
  }

  if (
    "context" in error
    && error.context
    && typeof error.context === "object"
    && "retryable" in error.context
    && typeof error.context.retryable === "boolean"
  ) {
    return error.context.retryable;
  }

  return null;
}

function buildHostedAssistantDeliveryDetails(input: {
  effectFingerprint?: string;
  effectId: string;
  extra?: HostedAssistantDeliveryDetails;
  userId: string;
}): HostedAssistantDeliveryDetails {
  return {
    assistantDeliveryBoundary: HOSTED_ASSISTANT_DELIVERY_BOUNDARY,
    ...(input.effectFingerprint ? { effectFingerprint: input.effectFingerprint } : {}),
    effectId: input.effectId,
    userId: input.userId,
    ...(input.extra ?? {}),
  };
}
