import type {
  HostedExecutionStructuredLogDetails,
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";
import {
  compareIsoTimestampsAscending as compareHostedIsoTimestampsAscending,
} from "@murphai/contracts";
import {
  emitHostedExecutionStructuredLog,
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
  HostedActionApprovalResult,
} from "@murphai/hosted-execution/action-approval";
import {
  applyAssistantVaultFileSendApprovalResult,
  beginAssistantOutboxIntentMirrorPreparedDispatch,
  buildAssistantVaultFileSendApprovalRequest,
  deferAssistantVaultFileApprovalCheck,
  dispatchAssistantOutboxIntent,
  findAssistantAutoReplyDeliveryIntentIds,
  hasAssistantAutoReplyChannel,
  listAssistantOutboxIntents,
  markAssistantOutboxIntentMirrorTerminalById,
  normalizeAssistantDeliveryError,
  readAssistantAutomationState,
  readAssistantOutboxIntent,
  readAssistantVaultFileMedia,
  readVerifiedAssistantVaultFileBytes,
  sendTelegramMessage,
  sendWhatsAppMessage,
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
  sendTelegramImageMessage,
} from "@murphai/assistant-engine/assistant-channel-runtime";
import type {
  AssistantDeliveryError,
  AssistantOutboxIntent,
  AssistantResponseMedia,
} from "@murphai/operator-config/assistant-cli-contracts";
import {
  setTelegramMessageReaction,
} from "@murphai/operator-config/telegram-runtime";
import {
  assistantChannelDeliverySchema,
} from "@murphai/operator-config/assistant-cli-contracts";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import {
  createAssistantDeliveryTerminalError,
} from "@murphai/operator-config/assistant/delivery-failure";

import type {
  HostedAssistantDeliveryErrorDetails,
  HostedAssistantDeliveryOutcome,
} from "./models.ts";
import type {
  HostedRuntimeActionApprovalPort,
  HostedRuntimeEffectsPort,
  HostedRuntimeLinqDeliveryOutcomeRequest,
  HostedRuntimeLinqEngagementKind,
  HostedRuntimeLinqSendResponse,
  HostedRuntimeProviderTargetKind,
} from "./platform.ts";
import {
  buildHostedLinqChannelEnv,
  buildHostedTelegramChannelEnv,
  buildHostedTelegramVoiceMemoChannelEnv,
  buildHostedWhatsAppChannelEnv,
} from "./channel-activity.ts";
import {
  sendHostedProviderLinqMessage,
  sendHostedProviderLinqVoiceMemo,
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

const HOSTED_MAX_BACKGROUND_DELIVERY_EFFECTS = 1;
// Bounds the per-collect approval reconciliation work so a backlog of
// pending vault-file approvals cannot stall foreground delivery with an
// unbounded series of web-control round trips. Preferred (current-turn)
// intents are always reconciled; beyond those we additionally reconcile
// only the N most-recently-updated `awaiting_approval` intents to catch
// fresh user decisions on the shoulder-tap wake.
const HOSTED_MAX_FOREGROUND_APPROVAL_RECONCILE = 4;
const HOSTED_ASSISTANT_DELIVERY_BOUNDARY = "hosted_runtime_outbox";
const HOSTED_NON_IDEMPOTENT_CONFIRMATION_GRACE_MS = 2 * 60 * 1000;
const HOSTED_SENDING_STALE_RECONCILIATION_MS = 10 * 60 * 1000;
const HOSTED_LINQ_DELIVERY_OUTCOME_WRITE_TIMEOUT_MS = 2_000;
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
  preferredIntentIds?: readonly string[];
  vaultRoot: string;
}

export async function collectHostedAssistantDeliverySideEffects(
  input: CollectHostedAssistantDeliverySideEffectsInput,
): Promise<HostedAssistantDeliveryEffect[]> {
  const request = {
    includeBackgroundDueIntents: input.includeBackgroundDueIntents,
    preferredIntentIds: input.preferredIntentIds ?? [],
    vaultRoot: input.vaultRoot,
  };
  const now = new Date();
  const storedIntents = await listAssistantOutboxIntents(request.vaultRoot);
  const reconcileTargetIds = selectHostedAssistantApprovalReconcileTargets({
    preferredIntentIds: request.preferredIntentIds,
    storedIntents,
  });
  const reconciliationByIntentId = new Map<
    string,
    { blocked: boolean; intent: AssistantOutboxIntent }
  >();
  for (const intent of storedIntents) {
    if (!reconcileTargetIds.has(intent.intentId)) {
      continue;
    }
    const reconciliation = await reconcileHostedAssistantVaultFileApproval({
      actionApprovalPort: input.actionApprovalPort ?? null,
      intent,
      missingApprovalPort: "block",
      now,
      vaultRoot: request.vaultRoot,
    });
    reconciliationByIntentId.set(reconciliation.intent.intentId, reconciliation);
  }
  const intents: AssistantOutboxIntent[] = storedIntents.map((intent) =>
    reconciliationByIntentId.get(intent.intentId)?.intent ?? intent,
  );
  const approvalBlockedIntentIds = new Set<string>(
    Array.from(reconciliationByIntentId.values())
      .filter((reconciliation) => reconciliation.blocked)
      .map((reconciliation) => reconciliation.intent.intentId),
  );
  const preferredIntentOrder = new Map(
    request.preferredIntentIds.map((intentId, index) => [intentId, index] as const),
  );

  const candidates: AssistantOutboxIntent[] = [];
  const nowIso = now.toISOString();
  for (const intent of intents) {
    if (approvalBlockedIntentIds.has(intent.intentId)) {
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
    await abandonStaleSignupWelcomeBackgroundCandidatesAfterForegroundReply({
      backgroundCandidates,
      foregroundCandidates,
      vaultRoot: request.vaultRoot,
    });
  const cappedBackgroundCandidates = filteredBackgroundCandidates.slice(
    0,
    Math.max(
      0,
      HOSTED_MAX_BACKGROUND_DELIVERY_EFFECTS - foregroundCandidates.length,
    ),
  );
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
 * Bounds the set of intents reconciled per collect. The dispatch preflight
 * gate is the security invariant; this pass exists only so freshly-decided
 * approvals transition out of
 * `awaiting_approval` promptly. Reconciling every stored intent would add an
 * O(n) sequence of web-control round trips to the foreground delivery path.
 */
function selectHostedAssistantApprovalReconcileTargets(input: {
  preferredIntentIds: readonly string[];
  storedIntents: readonly AssistantOutboxIntent[];
}): Set<string> {
  const targets = new Set<string>(input.preferredIntentIds);
  const recent = [...input.storedIntents]
    .filter((intent) =>
      intent.status === "awaiting_approval"
      && !targets.has(intent.intentId)
    )
    .sort((left, right) =>
      compareHostedIsoTimestampsAscending(right.updatedAt, left.updatedAt)
    )
    .slice(0, HOSTED_MAX_FOREGROUND_APPROVAL_RECONCILE);
  for (const intent of recent) {
    targets.add(intent.intentId);
  }
  return targets;
}

async function reconcileHostedAssistantVaultFileApproval(input: {
  actionApprovalPort: HostedRuntimeActionApprovalPort | null;
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

  let approval: HostedActionApprovalResult;
  try {
    approval = await input.actionApprovalPort.request(approvalRequest);
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

async function persistHostedAssistantVaultFileApprovalState(input: {
  current: AssistantOutboxIntent;
  next: AssistantOutboxIntent;
  vaultRoot: string;
}): Promise<AssistantOutboxIntent> {
  if (input.next === input.current) {
    return input.current;
  }

  return await saveAssistantOutboxIntentIfUnchanged({
    expectedDedupeKey: input.current.dedupeKey,
    expectedStatus: input.current.status,
    expectedUpdatedAt: input.current.updatedAt,
    intent: input.next,
    vault: input.vaultRoot,
  });
}

async function abandonStaleSignupWelcomeBackgroundCandidatesAfterForegroundReply(input: {
  backgroundCandidates: readonly AssistantOutboxIntent[];
  foregroundCandidates: readonly AssistantOutboxIntent[];
  vaultRoot: string;
}): Promise<AssistantOutboxIntent[]> {
  const foregroundRecipientKeys = new Set<string>();
  for (const intent of input.foregroundCandidates) {
    const payload = buildHostedAssistantDeliveryPayloadFromIntent(intent);
    for (const key of buildHostedAssistantDeliveryRecipientKeys(payload)) {
      foregroundRecipientKeys.add(key);
    }
  }

  if (foregroundRecipientKeys.size === 0) {
    return [...input.backgroundCandidates];
  }

  const retained: AssistantOutboxIntent[] = [];
  for (const intent of input.backgroundCandidates) {
    const payload = buildHostedAssistantDeliveryPayloadFromIntent(intent);
    if (
      isHostedSignupWelcomeDeliveryPayload(payload)
      && hostedAssistantDeliveryRecipientKeysOverlap(payload, foregroundRecipientKeys)
    ) {
      await markAssistantOutboxIntentMirrorTerminalById({
        error: new VaultCliError(
          "ASSISTANT_STALE_SIGNUP_WELCOME_SUPPRESSED",
          "Stale signup welcome suppressed after a foreground reply for the same route.",
        ),
        intentId: intent.intentId,
        status: "abandoned",
        vault: input.vaultRoot,
      });
      continue;
    }
    retained.push(intent);
  }
  return retained;
}

function isHostedSignupWelcomeDeliveryPayload(
  payload: HostedAssistantDeliveryPayload,
): boolean {
  return isHostedSignupWelcomeDeliveryIdempotencyKey(payload.idempotencyKey);
}

function isHostedSignupWelcomeDeliveryIdempotencyKey(
  idempotencyKey: string | null | undefined,
): boolean {
  const prefix = "signup-welcome:";
  const normalized = idempotencyKey?.trim() ?? "";
  if (!normalized.startsWith(prefix)) {
    return false;
  }
  const tokenTarget = normalized.slice(prefix.length);
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
    payload.threadId ? `${channel}:thread:${payload.threadId}` : null,
    payload.explicitTarget ? `${channel}:explicit:${payload.explicitTarget}` : null,
    payload.bindingDeliveryTarget
      ? `${channel}:binding:${payload.bindingDeliveryKind ?? "unknown"}:${
          payload.bindingDeliveryTarget
        }`
      : null,
    payload.actorId ? `${channel}:actor:${payload.actorId}` : null,
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
  preparedDispatchToken: string;
  previousDispatchState: AssistantOutboxPreparedDispatchState;
}

function readHostedAssistantDeliveryBoundaryKey(
  intent: AssistantOutboxIntent,
): string {
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

function compareHostedAssistantSteeredSegmentOrder(
  left: AssistantOutboxIntent,
  right: AssistantOutboxIntent,
): number {
  const leftKey = left.deliveryIdempotencyKey ?? null;
  const rightKey = right.deliveryIdempotencyKey ?? null;
  const leftSegment = readHostedAssistantSteeredSegmentOrder(left);
  const rightSegment = readHostedAssistantSteeredSegmentOrder(right);
  if (leftSegment && rightSegment && leftSegment.groupKey === rightSegment.groupKey) {
    return leftSegment.ordinal - rightSegment.ordinal;
  }
  if (
    leftSegment
    && !rightSegment
    && shouldHostedAssistantSegmentPrecedeNonSegment(leftSegment, rightKey)
  ) {
    return -1;
  }
  if (
    rightSegment
    && !leftSegment
    && shouldHostedAssistantSegmentPrecedeNonSegment(rightSegment, leftKey)
  ) {
    return 1;
  }
  return 0;
}

interface HostedAssistantSteeredSegmentOrder {
  groupKey: string;
  kind: "fallback" | "generated";
  ordinal: number;
}

function readHostedAssistantSteeredSegmentOrder(
  intent: AssistantOutboxIntent,
): HostedAssistantSteeredSegmentOrder | null {
  const deliveryIdempotencyKey = intent.deliveryIdempotencyKey ?? null;
  if (!deliveryIdempotencyKey) {
    return null;
  }
  const match = /^(.*):segment:([0-9]+)$/.exec(deliveryIdempotencyKey);
  if (match?.[1] && match[2]) {
    const ordinal = Number.parseInt(match[2], 10);
    return Number.isSafeInteger(ordinal)
      ? { groupKey: match[1], kind: "generated", ordinal }
      : null;
  }
  const fallbackPrefix = `assistant-segment:${intent.turnId}:`;
  if (!deliveryIdempotencyKey.startsWith(fallbackPrefix)) {
    return null;
  }
  const ordinalText = deliveryIdempotencyKey.slice(fallbackPrefix.length);
  if (!/^[0-9]+$/.test(ordinalText)) {
    return null;
  }
  const ordinal = Number.parseInt(ordinalText, 10);
  return Number.isSafeInteger(ordinal)
    ? { groupKey: `assistant-segment:${intent.turnId}`, kind: "fallback", ordinal }
    : null;
}

function shouldHostedAssistantSegmentPrecedeNonSegment(
  segment: HostedAssistantSteeredSegmentOrder,
  deliveryIdempotencyKey: string | null,
): boolean {
  if (segment.kind === "generated") {
    return deliveryIdempotencyKey === segment.groupKey;
  }
  return deliveryIdempotencyKey === null;
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
    || compareHostedAssistantSteeredSegmentOrder(left, right)
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
  for (const intent of intents) {
    const wakeAt = resolveHostedAssistantOutboxIntentWakeAt(intent, now);
    if (wakeAt) {
      return wakeAt;
    }
  }
  return null;
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
  now?: () => string;
  vaultRoot: string;
}): Promise<HostedAssistantDeliveryPreparation> {
  const startedAt = (input.now ?? (() => new Date().toISOString()))();
  const preparedDispatches: HostedAssistantDeliveryPreparedDispatch[] = [];
  for (const effect of input.assistantDeliveryEffects) {
    if (!shouldPrepareHostedAssistantDeliveryEffectForDispatch(effect)) {
      continue;
    }
    const prepared = await beginAssistantOutboxIntentMirrorPreparedDispatch({
      deliveryIdempotencyKey: effect.payload.idempotencyKey,
      deliveryTransportIdempotent: effect.payload.transportIdempotent,
      intentId: effect.effectId,
      startedAt,
      vault: input.vaultRoot,
    });
    if (prepared?.ownsDispatch === true && prepared.preparedDispatchToken) {
      preparedDispatches.push({
        intentId: effect.effectId,
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
): boolean {
  return !hasHostedAssistantVaultFileMedia(effect.payload)
    && (effect.payload.transportIdempotent
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

export function createHostedAssistantProgressDeliveryDependencies(input: {
  effectsPort?: Pick<
    HostedRuntimeEffectsPort,
    "assertLinqRecentInboundEngagement" | "recordLinqDeliveryOutcome" | "sendEmail"
  > | null;
  forwardedEnv?: Readonly<Record<string, string>>;
  linqDeliveryContext?: HostedAssistantLinqDeliveryContext | null;
  linqDeliveryContexts?: readonly HostedAssistantLinqDeliveryContext[] | null;
  platformEnv?: Readonly<Record<string, string>>;
  providerFetch?: typeof fetch | null;
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
      providerFetch: input.providerFetch ?? null,
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
  platformEnv?: Readonly<Record<string, string>>;
  preparedDispatches?: readonly HostedAssistantDeliveryPreparedDispatch[] | null;
  providerFetch?: typeof fetch | null;
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
  const whatsAppEnv = buildHostedWhatsAppChannelEnv({
    forwardedEnv: input.forwardedEnv ?? {},
    platformEnv: input.platformEnv,
  }) as NodeJS.ProcessEnv;
  const linqDeliveryContexts = resolveHostedAssistantLinqDeliveryContexts({
    context: input.linqDeliveryContext ?? null,
    contexts: input.linqDeliveryContexts ?? null,
    wake: input.wake,
  });
  const outcomes: HostedAssistantDeliveryOutcome[] = [];
  const blockedForegroundDeliveryKeys = new Set<string>();
  const preparedDispatchByIntentId = new Map(
    (input.preparedDispatches ?? []).map((preparedDispatch) => [
      preparedDispatch.intentId,
      preparedDispatch,
    ]),
  );
  for (let index = 0; index < input.assistantDeliveryEffects.length; index += 1) {
    const assistantDeliveryEffect = input.assistantDeliveryEffects[index];
    if (!assistantDeliveryEffect) {
      continue;
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
    try {
      const preparedDispatch =
        preparedDispatchByIntentId.get(assistantDeliveryEffect.effectId) ?? null;
      const ownsPreparedDispatch =
        input.allowPreparedSending === true
        && preparedDispatch !== null;
      outcome = await deliverHostedPreparedAssistantDelivery({
        actionApprovalPort: input.actionApprovalPort ?? null,
        wake: input.wake,
        effectsPort: input.effectsPort,
        allowPreparedSending: ownsPreparedDispatch,
        assertLiveness: input.assertLiveness,
        assistantDeliveryEffect,
        signal: input.signal ?? null,
        linqEnv,
        linqDeliveryContexts,
        preparedDispatch: ownsPreparedDispatch ? preparedDispatch : null,
        telegramEnv,
        telegramVoiceMemoEnv,
        whatsAppEnv,
        providerFetch: input.providerFetch ?? null,
        userId: input.wake.userId,
        vaultRoot: input.vaultRoot,
      });
    } catch (error) {
      await resetHostedPreparedAssistantDeliveryEffects({
        effects: input.assistantDeliveryEffects.slice(index + 1),
        preparedDispatchByIntentId,
        vaultRoot: input.vaultRoot,
      });
      throw error;
    }
    outcomes.push(outcome);
    if (shouldBlockLaterHostedAssistantForegroundDeliveries({
      effect: assistantDeliveryEffect,
      outcome,
    })) {
      const boundaryKey = readHostedAssistantDeliveryEffectBoundaryKey(
        assistantDeliveryEffect,
      );
      blockedForegroundDeliveryKeys.add(boundaryKey);
      await resetHostedPreparedAssistantDeliveryEffects({
        effects: input.assistantDeliveryEffects
          .slice(index + 1)
          .filter((effect) =>
            readHostedAssistantDeliveryEffectBoundaryKey(effect) === boundaryKey
          ),
        preparedDispatchByIntentId,
        vaultRoot: input.vaultRoot,
      });
    }
  }

  return outcomes;
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

function isHostedLinqTransportFailure(error: unknown): boolean {
  return error instanceof VaultCliError
    && error.code === "LINQ_API_REQUEST_FAILED"
    && error.context?.failureStage === "transport";
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
      deliveryIdempotencyKey: effect.payload.idempotencyKey,
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

async function deliverHostedPreparedAssistantDelivery(input: {
  actionApprovalPort: HostedRuntimeActionApprovalPort | null;
  allowPreparedSending: boolean;
  wake: HostedRuntimeEvent;
  effectsPort: HostedRuntimeEffectsPort;
  assertLiveness?: () => Promise<void>;
  assistantDeliveryEffect: HostedAssistantDeliveryEffect;
  signal: AbortSignal | null;
  linqEnv: NodeJS.ProcessEnv;
  linqDeliveryContexts: readonly HostedAssistantLinqDeliveryContext[];
  preparedDispatch: HostedAssistantDeliveryPreparedDispatch | null;
  telegramEnv: NodeJS.ProcessEnv;
  telegramVoiceMemoEnv: NodeJS.ProcessEnv;
  whatsAppEnv: NodeJS.ProcessEnv;
  providerFetch: typeof fetch | null;
  userId: string;
  vaultRoot: string;
}): Promise<HostedAssistantDeliveryOutcome> {
  const now = new Date();
  const mirrorState = await readAssistantOutboxIntentMirrorState({
    intentId: input.assistantDeliveryEffect.effectId,
    now,
    sendingGraceMs: HOSTED_NON_IDEMPOTENT_CONFIRMATION_GRACE_MS,
    vault: input.vaultRoot,
  });
  let providerDispatchEntered = false;
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
    const dispatched = await dispatchAssistantOutboxIntent({
      dispatchHooks: {
        preflightDispatchIntent: async ({ intent, now: preflightNow, vault }) =>
          preflightHostedAssistantVaultFileDispatch({
            actionApprovalPort: input.actionApprovalPort,
            intent,
            now: preflightNow,
            vaultRoot: vault,
          }),
      },
      dependencies: {
        sendEmail: async (request) => {
          if (request.targetKind === "participant") {
            throw new VaultCliError(
              "ASSISTANT_HOSTED_EMAIL_PARTICIPANT_UNSUPPORTED",
              "Hosted email participant delivery is not supported. Use an explicit recipient or a serialized thread target.",
            );
          }

          await assertHostedDeliveryLiveNow(input);
          providerDispatchEntered = true;
          // The binding identityId is a privacy-blinded conversation identifier,
          // never a sender address. Hosted email always sends from the
          // config-owned sender, so it is intentionally not forwarded.
          const result = await input.effectsPort.sendEmail({
            idempotencyKey: request.idempotencyKey ?? null,
            message: request.message,
            replyToMessageId: request.replyToMessageId ?? null,
            subject: request.subject ?? null,
            target: request.target,
            targetKind: request.targetKind,
          });
          await assertHostedDeliveryLiveNow(input);
          return result;
        },
        sendTelegram: async (request) => {
          await assertHostedDeliveryLiveNow(input);
          const dependencies = requireHostedProviderFetchDependencies({
            env: input.telegramEnv,
            fetchImplementation: input.providerFetch,
            ...(input.signal ? { signal: input.signal } : {}),
          }, "Hosted assistant Telegram delivery");
          providerDispatchEntered = true;
          const result = await sendTelegramMessage(request, dependencies);
          await assertHostedDeliveryLiveNow(input);
          return result;
        },
        sendTelegramImage: async (request) => {
          await assertHostedDeliveryLiveNow(input);
          const dependencies = requireHostedProviderFetchDependencies({
            env: input.telegramEnv,
            fetchImplementation: input.providerFetch,
            ...(request.signal ?? input.signal
              ? { signal: request.signal ?? input.signal ?? undefined }
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
          await assertHostedDeliveryLiveNow(input);
          const dependencies = requireHostedProviderFetchDependencies({
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
          env: input.telegramVoiceMemoEnv,
          fetchImplementation: createHostedProviderFetchBoundary({
            assertLive: () => assertHostedDeliveryLiveNow(input),
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
          effectsPort: input.effectsPort,
          expectedDedupeKey: input.assistantDeliveryEffect.fingerprint,
          intentId: input.assistantDeliveryEffect.effectId,
          linqEnv: input.linqEnv,
          linqDeliveryContexts: input.linqDeliveryContexts,
          onProviderDispatchEntered: () => {
            providerDispatchEntered = true;
          },
          providerFetch: input.providerFetch,
          signal: input.signal,
          vaultRoot: input.vaultRoot,
        }),
        sendLinqVoiceMemo: createHostedAssistantLinqVoiceMemoSendDependency({
          assertLiveness: input.assertLiveness,
          effectsPort: input.effectsPort,
          linqEnv: input.linqEnv,
          linqDeliveryContexts: input.linqDeliveryContexts,
          onProviderDispatchEntered: () => {
            providerDispatchEntered = true;
          },
          intentId: input.assistantDeliveryEffect.effectId,
          providerFetch: input.providerFetch,
          signal: input.signal,
        }),
        setLinqMessageReaction: async (request) => {
          await assertHostedDeliveryLiveNow(input);
          const deliveryContext = resolveHostedAssistantLinqReactionDeliveryContextFromCandidatesForRequest({
            contexts: input.linqDeliveryContexts,
            target: request.target,
            targetMessageId: request.targetMessageId,
          });
          await assertHostedAssistantLinqRecentInboundEngagementForDelivery({
            deliveryContext,
            directRecipientPhoneNumber: deliveryContext?.directRecipientPhoneNumber ?? null,
            effectsPort: input.effectsPort,
            fromPhoneNumber: deliveryContext?.fromPhoneNumber ?? null,
            idempotencyKey: input.assistantDeliveryEffect.payload.idempotencyKey ?? null,
            intentId: input.assistantDeliveryEffect.effectId,
            replyToMessageId: request.targetMessageId,
            signal: input.signal,
            target: request.target,
            targetKind: "thread",
          });
          let reactionProviderDispatchEntered = false;
          const result = await setHostedProviderLinqMessageReaction({
            reaction: request.reaction,
            targetMessageId: request.targetMessageId,
          }, {
            env: input.linqEnv,
            fetchImplementation: input.providerFetch,
            onProviderDispatchEntered: () => {
              providerDispatchEntered = true;
              reactionProviderDispatchEntered = true;
            },
            ...(input.signal ? { signal: input.signal } : {}),
          }).catch((error: unknown) => {
            if (
              reactionProviderDispatchEntered &&
              isHostedLinqTransportFailure(error)
            ) {
              throw markHostedDeliveryMayHaveSucceeded(error);
            }
            throw error;
          });
          try {
            await assertHostedDeliveryLiveNow(input);
          } catch (error) {
            throw markHostedDeliveryMayHaveSucceeded(error);
          }
          return {
            ...result,
            target: request.target,
          };
        },
        sendWhatsApp: async (request) => {
          await assertHostedDeliveryLiveNow(input);
          const dependencies = requireHostedProviderFetchDependencies({
            env: input.whatsAppEnv,
            fetchImplementation: input.providerFetch,
            ...(input.signal ? { signal: input.signal } : {}),
          }, "Hosted assistant WhatsApp delivery");
          providerDispatchEntered = true;
          const result = await sendWhatsAppMessage(request, dependencies);
          await assertHostedDeliveryLiveNow(input);
          return result;
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
      return await buildHostedAssistantDeliveryDispatchResult({
        assistantDeliveryEffect: input.assistantDeliveryEffect,
        dispatchResult: resetDispatchResult,
        userId: input.userId,
        vaultRoot: input.vaultRoot,
        wake: input.wake,
      });
    }
    assertHostedDeliveryLiveness(input.signal);
    return await buildHostedAssistantDeliveryDispatchResult({
      assistantDeliveryEffect: input.assistantDeliveryEffect,
      dispatchResult: dispatched,
      userId: input.userId,
      vaultRoot: input.vaultRoot,
      wake: input.wake,
    });
  } catch (error) {
    if (input.preparedDispatch && shouldResetHostedPreparedDeliveryOnPreProviderAbort({
      assistantDeliveryEffect: input.assistantDeliveryEffect,
      mirrorState,
      providerDispatchEntered,
      signal: input.signal,
    })) {
      await resetAssistantOutboxPreparedDispatchById({
        deliveryIdempotencyKey: input.assistantDeliveryEffect.payload.idempotencyKey,
        deliveryTransportIdempotent: input.assistantDeliveryEffect.payload.transportIdempotent,
        intentId: input.assistantDeliveryEffect.effectId,
        preparedDispatchToken: input.preparedDispatch?.preparedDispatchToken ?? null,
        resetAt: new Date(),
        ...(input.preparedDispatch?.previousDispatchState
          ? { restoreDispatchState: input.preparedDispatch.previousDispatchState }
          : {}),
        vault: input.vaultRoot,
      });
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
    mirrorState: input.mirrorState,
    providerDispatchEntered: input.providerDispatchEntered,
    signal: input.signal,
  })) {
    return null;
  }

  const reset = await resetAssistantOutboxPreparedDispatchById({
    deliveryIdempotencyKey: input.assistantDeliveryEffect.payload.idempotencyKey,
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
  mirrorState: Awaited<ReturnType<typeof readAssistantOutboxIntentMirrorState>>;
  providerDispatchEntered: boolean;
  signal: AbortSignal | null;
}): boolean {
  return input.signal?.aborted === true
    && input.mirrorState.sendingStartedAt !== null
    && !input.mirrorState.intent?.delivery
    && input.mirrorState.intent?.deliveryConfirmationPending !== true
    && !input.providerDispatchEntered;
}

function createHostedProviderFetchBoundary(input: {
  assertLive?: () => Promise<void>;
  onTelegramVoiceMemoDispatchEntered?: () => void;
  operation: string;
  providerFetch: typeof fetch | null;
}): typeof fetch {
  return (async (request, init) => {
    await input.assertLive?.();
    const fetchImplementation = requireHostedProviderFetch(
      input.providerFetch,
      input.operation,
    );
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

function createHostedAssistantLinqSendDependency(input: {
  actionApprovalPort?: HostedRuntimeActionApprovalPort | null;
  assertLiveness?: () => Promise<void>;
  effectsPort?: Pick<
    HostedRuntimeEffectsPort,
    "assertLinqRecentInboundEngagement" | "recordLinqDeliveryOutcome"
  > | null;
  expectedDedupeKey?: string | null;
  intentId?: string | null;
  linqDeliveryContexts?: readonly HostedAssistantLinqDeliveryContext[] | null;
  linqEnv: NodeJS.ProcessEnv;
  onProviderDispatchEntered?: () => void;
  providerFetch: typeof fetch | null;
  signal: AbortSignal | null;
  vaultRoot?: string | null;
}): NonNullable<AssistantHostedProgressDeliveryDependencies["sendLinq"]> {
  return async (request) => {
    await assertHostedDeliveryLiveNow(input);
    const deliveryContext = resolveHostedAssistantLinqDeliveryContextFromCandidatesForRequest({
      contexts: input.linqDeliveryContexts ?? [],
      replyToMessageId: request.replyToMessageId ?? null,
      target: request.target,
      targetKind: request.targetKind ?? null,
    });
    const directRecipientPhoneNumber =
      normalizeHostedLinqDirectRecipient(request.directRecipientPhoneNumber)
      ?? normalizeHostedLinqDirectRecipient(deliveryContext?.directRecipientPhoneNumber);
    const fromPhoneNumber =
      normalizeHostedLinqDirectRecipient(request.fromPhoneNumber)
      ?? normalizeHostedLinqDirectRecipient(deliveryContext?.fromPhoneNumber);
    const providerTarget = deliveryContext?.target ?? request.target;
    const signal = mergeHostedAssistantLinqSignals(input.signal, request.signal);
    await assertHostedAssistantLinqRecentInboundEngagementForDelivery({
      deliveryContext,
      directRecipientPhoneNumber,
      effectsPort: input.effectsPort ?? null,
      fromPhoneNumber,
      idempotencyKey: request.idempotencyKey ?? null,
      intentId: input.intentId ?? null,
      replyToMessageId: request.replyToMessageId ?? null,
      signal: signal ?? null,
      target: request.target,
      targetKind: request.targetKind ?? null,
    });
    const dependencies = requireHostedProviderFetchDependencies({
      env: input.linqEnv,
      fetchImplementation: input.providerFetch,
      ...(signal ? { signal } : {}),
    }, "Hosted assistant Linq delivery");
    const verifiedVaultFiles = await preloadApprovedHostedAssistantVaultFiles({
      actionApprovalPort: input.actionApprovalPort ?? null,
      expectedDedupeKey: input.expectedDedupeKey ?? null,
      intentId: input.intentId ?? null,
      media: request.media ?? [],
      vaultRoot: input.vaultRoot ?? null,
    });
    const attemptedAt = new Date();
    input.onProviderDispatchEntered?.();
    let result: HostedRuntimeLinqSendResponse;
    try {
      result = await sendHostedProviderLinqMessage({
        directRecipientPhoneNumber,
        fromPhoneNumber,
        idempotencyKey: request.idempotencyKey ?? null,
        media: request.media ?? null,
        message: request.message,
        replyToMessageId: request.replyToMessageId ?? null,
        target: providerTarget,
        targetKind: request.targetKind ?? null,
      }, {
        ...dependencies,
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
      });
    } catch (error) {
      queueHostedAssistantLinqDeliveryOutcomeWrite({
        effectsPort: input.effectsPort ?? null,
        outcome: buildHostedAssistantLinqDeliveryOutcomeRequest({
          attemptedAt,
          deliveryContext,
          failedAt: new Date(),
          failureCode: readHostedAssistantLinqDeliveryFailureCode(error),
          failureReason: null,
          fromPhoneNumber,
          idempotencyKey: request.idempotencyKey ?? null,
          intentId: input.intentId ?? null,
          providerTarget,
          providerThreadId: null,
          result: null,
          target: request.target,
          targetKind: request.targetKind ?? null,
        }),
      });
      throw error;
    }
    queueHostedAssistantLinqDeliveryOutcomeWrite({
      effectsPort: input.effectsPort ?? null,
      outcome: buildHostedAssistantLinqDeliveryOutcomeRequest({
        acceptedAt: new Date(),
        attemptedAt,
        deliveryContext,
        fromPhoneNumber,
        idempotencyKey: request.idempotencyKey ?? null,
        intentId: input.intentId ?? null,
        providerTarget,
        providerThreadId: result.providerThreadId ?? null,
        result,
        target: request.target,
        targetKind: request.targetKind ?? null,
      }),
    });
    await assertHostedDeliveryLiveNow(input);
    return result;
  };
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
  signal: AbortSignal | null;
}): NonNullable<AssistantHostedProgressDeliveryDependencies["sendLinqVoiceMemo"]> {
  return async (request) => {
    await assertHostedDeliveryLiveNow(input);
    const deliveryContext = resolveHostedAssistantLinqDeliveryContextFromCandidatesForRequest({
      contexts: input.linqDeliveryContexts ?? [],
      replyToMessageId: request.replyToMessageId ?? null,
      target: request.target,
      targetKind: request.targetKind ?? null,
    });
    const providerTarget = deliveryContext?.target ?? request.target;
    const signal = mergeHostedAssistantLinqSignals(input.signal, request.signal);
    const dependencies = requireHostedProviderFetchDependencies({
      env: input.linqEnv,
      fetchImplementation: input.providerFetch,
      ...(signal ? { signal } : {}),
    }, "Hosted assistant Linq voice memo delivery");
    await assertHostedAssistantLinqRecentInboundEngagementForDelivery({
      deliveryContext,
      directRecipientPhoneNumber: deliveryContext?.directRecipientPhoneNumber ?? null,
      effectsPort: input.effectsPort ?? null,
      fromPhoneNumber: deliveryContext?.fromPhoneNumber ?? null,
      idempotencyKey: input.intentId ? `linq-voice-memo:${input.intentId}` : null,
      intentId: input.intentId ?? null,
      replyToMessageId: deliveryContext?.replyToMessageId ?? null,
      signal: signal ?? null,
      target: providerTarget,
      targetKind: "thread",
    });
    const attemptedAt = new Date();
    input.onProviderDispatchEntered?.();
    let result: HostedRuntimeLinqSendResponse;
    try {
      result = await sendHostedProviderLinqVoiceMemo({
        attachmentId: request.attachmentId,
        target: providerTarget,
      }, dependencies);
    } catch (error) {
      queueHostedAssistantLinqDeliveryOutcomeWrite({
        effectsPort: input.effectsPort ?? null,
        outcome: buildHostedAssistantLinqDeliveryOutcomeRequest({
          attemptedAt,
          deliveryContext,
          failedAt: new Date(),
          failureCode: readHostedAssistantLinqDeliveryFailureCode(error),
          failureReason: null,
          fromPhoneNumber: deliveryContext?.fromPhoneNumber ?? null,
          idempotencyKey: input.intentId ? `linq-voice-memo:${input.intentId}` : null,
          intentId: input.intentId ?? null,
          providerTarget,
          providerThreadId: null,
          result: null,
          target: providerTarget,
          targetKind: "thread",
        }),
      });
      throw error;
    }
    queueHostedAssistantLinqDeliveryOutcomeWrite({
      effectsPort: input.effectsPort ?? null,
      outcome: buildHostedAssistantLinqDeliveryOutcomeRequest({
        acceptedAt: new Date(),
        attemptedAt,
        deliveryContext,
        fromPhoneNumber: deliveryContext?.fromPhoneNumber ?? null,
        idempotencyKey: input.intentId ? `linq-voice-memo:${input.intentId}` : null,
        intentId: input.intentId ?? null,
        providerTarget,
        providerThreadId: result.providerThreadId ?? null,
        result,
        target: providerTarget,
        targetKind: "thread",
      }),
    });
    await assertHostedDeliveryLiveNow(input);
    return result;
  };
}

function buildHostedAssistantLinqDeliveryOutcomeRequest(input: {
  acceptedAt?: Date | null;
  attemptedAt: Date;
  deliveryContext: HostedAssistantLinqDeliveryContext | null;
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
}): HostedRuntimeLinqDeliveryOutcomeRequest {
  return {
    ...(input.acceptedAt ? { acceptedAt: input.acceptedAt.toISOString() } : {}),
    attemptedAt: input.attemptedAt.toISOString(),
    ...(input.failedAt ? { failedAt: input.failedAt.toISOString() } : {}),
    failureCode: input.failureCode ?? null,
    failureReason: input.failureReason ?? null,
    fromPhoneNumber: input.fromPhoneNumber,
    idempotencyKey: input.idempotencyKey,
    intentId: input.intentId,
    providerMessageId: input.result?.providerMessageId ?? null,
    providerTarget: input.targetKind === "participant" ? null : input.providerTarget,
    providerThreadId: input.result?.providerThreadId ?? input.providerThreadId,
    routeAuthority: input.deliveryContext?.routeAuthority ?? null,
    target: input.targetKind === "participant" ? null : input.target,
    targetKind: input.targetKind,
  };
}

const pendingHostedAssistantLinqDeliveryOutcomeWrites = new Set<Promise<void>>();

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

async function assertHostedAssistantLinqRecentInboundEngagementForDelivery(input: {
  deliveryContext: HostedAssistantLinqDeliveryContext | null;
  directRecipientPhoneNumber: string | null;
  effectsPort?: Pick<HostedRuntimeEffectsPort, "assertLinqRecentInboundEngagement"> | null;
  fromPhoneNumber: string | null;
  idempotencyKey: string | null;
  intentId: string | null;
  replyToMessageId: string | null;
  signal: AbortSignal | null;
  target: string;
  targetKind: string | null;
}): Promise<void> {
  const assertRecentInbound = input.effectsPort?.assertLinqRecentInboundEngagement;
  if (!assertRecentInbound) {
    throw new VaultCliError(
      "ASSISTANT_LINQ_ENGAGEMENT_ASSERT_UNAVAILABLE",
      "Hosted Linq delivery requires recent-recipient-engagement assertion before provider dispatch.",
      { retryable: true },
    );
  }
  const targetKind = normalizeHostedAssistantLinqTargetKind(input.targetKind);
  const currentInbound = input.deliveryContext?.currentInbound ?? null;
  await assertRecentInbound({
    ...(currentInbound ? { currentInbound } : {}),
    directRecipientPhoneNumber: input.directRecipientPhoneNumber,
    engagementKind: readHostedAssistantLinqEngagementKind({
      idempotencyKey: input.idempotencyKey,
      targetKind,
    }),
    fromPhoneNumber: input.fromPhoneNumber,
    idempotencyKey: input.idempotencyKey,
    intentId: input.intentId,
    routeAuthority: input.deliveryContext?.routeAuthority ?? null,
    target: input.deliveryContext?.target ?? input.target,
    targetKind,
  }, {
    signal: input.signal,
  });
}

function normalizeHostedAssistantLinqTargetKind(
  targetKind: string | null,
): HostedRuntimeProviderTargetKind | null {
  return targetKind === "explicit" || targetKind === "participant" || targetKind === "thread"
    ? targetKind
    : null;
}

function readHostedAssistantLinqEngagementKind(input: {
  idempotencyKey: string | null,
  targetKind: HostedRuntimeProviderTargetKind | null,
}): HostedRuntimeLinqEngagementKind {
  return input.targetKind === "participant"
    && isHostedSignupWelcomeDeliveryIdempotencyKey(input.idempotencyKey)
    ? "first_contact"
    : "requires_recent_inbound";
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
    | "bindingDelivery"
    | "channel"
    | "deliveryIdempotencyKey"
    | "deliverySource"
    | "deliveryTransportIdempotent"
    | "explicitTarget"
    | "identityId"
    | "intentId"
    | "media"
    | "message"
    | "subject"
    | "replyToMessageId"
    | "sessionId"
    | "threadId"
    | "threadIsDirect"
    | "turnId"
  >,
): HostedAssistantDeliveryPayload {
  const payload = {
    actorId: intent.actorId ?? null,
    bindingDeliveryKind: intent.bindingDelivery?.kind ?? null,
    bindingDeliveryTarget: intent.bindingDelivery?.target ?? null,
    channel: intent.channel ?? null,
    deliverySourceKey: readHostedAssistantDeliverySourceKey(intent.deliverySource),
    explicitTarget: intent.explicitTarget ?? null,
    idempotencyKey: intent.deliveryIdempotencyKey ?? `assistant-outbox:${intent.intentId}`,
    identityId: intent.identityId ?? null,
    media: normalizeHostedAssistantDeliveryMedia(intent.media),
    message: intent.message,
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
  appendHostedAssistantDeliveryErrorLogValue(output, "Retryable", details.retryable);
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
    "bindingDeliveryKind" | "channel" | "explicitTarget"
  >,
): void {
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
