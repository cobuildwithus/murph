import type {
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";
import {
  MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE,
} from "@murphai/contracts";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  buildHostedAssistantDeliveryEffect,
  type HostedAssistantDeliveryPayload,
  type HostedAssistantDeliveryEffect,
  type HostedAssistantDeliveryPhase,
} from "@murphai/hosted-execution/side-effects";
import {
  beginAssistantOutboxIntentMirrorPreparedDispatch,
  dispatchAssistantOutboxIntent,
  listAssistantOutboxIntents,
  markAssistantOutboxIntentMirrorTerminalById,
  normalizeAssistantDeliveryError,
  sendTelegramMessage,
  sendWhatsAppMessage,
  readAssistantOutboxIntentMirrorState,
  resetAssistantOutboxPreparedDispatchById,
  shouldDispatchAssistantOutboxIntent,
  type AssistantChannelDelivery,
  type AssistantHostedProgressDeliveryDependencies,
  type AssistantOutboxPreparedDispatchState,
} from "@murphai/assistant-engine";
import type {
  AssistantOutboxIntent,
} from "@murphai/operator-config/assistant-cli-contracts";
import {
  assistantChannelDeliverySchema,
} from "@murphai/operator-config/assistant-cli-contracts";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";

import type {
  HostedAssistantDeliveryOutcome,
} from "./models.ts";
import type {
  HostedRuntimeEffectsPort,
} from "./platform.ts";
import {
  buildHostedLinqChannelEnv,
  buildHostedTelegramChannelEnv,
  buildHostedWhatsAppChannelEnv,
} from "./channel-activity.ts";
import {
  sendHostedProviderLinqMessage,
} from "../hosted-provider-effects.ts";
import {
  buildHostedAssistantLinqDeliveryContextFromWake,
  resolveHostedAssistantLinqDeliveryContextForRequest,
  type HostedAssistantLinqDeliveryContext,
} from "./linq-delivery-context.ts";
import {
  requireHostedProviderFetchDependencies,
} from "./provider-fetch.ts";

const HOSTED_MAX_BACKGROUND_DELIVERY_EFFECTS = 1;
const HOSTED_ASSISTANT_DELIVERY_BOUNDARY = "hosted_runtime_outbox";
const HOSTED_NON_IDEMPOTENT_CONFIRMATION_GRACE_MS = 2 * 60 * 1000;
const HOSTED_SENDING_STALE_RECONCILIATION_MS = 10 * 60 * 1000;

type HostedAssistantDeliveryDetails = Record<string, boolean | null | string>;

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
  const intents = await listAssistantOutboxIntents(request.vaultRoot);
  const preferredIntentOrder = new Map(
    request.preferredIntentIds.map((intentId, index) => [intentId, index] as const),
  );

  const candidates: AssistantOutboxIntent[] = [];
  const nowIso = now.toISOString();
  for (const intent of intents) {
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
  const prefix = "signup-welcome:";
  if (!payload.idempotencyKey.startsWith(prefix)) {
    return false;
  }
  const tokenTarget = payload.idempotencyKey.slice(prefix.length);
  return (
    tokenTarget.length > 0
    && !tokenTarget.includes(":")
    && payload.message === MURPH_ASSISTANT_SIGNUP_WELCOME_MESSAGE
  );
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
  return compareHostedAssistantSteeredSegmentOrder(left, right)
    || compareHostedAssistantDeliveryCandidateCreatedAt(left, right)
    || left.intentId.localeCompare(right.intentId);
}

function compareHostedAssistantDeliveryCandidateCreatedAt(
  left: AssistantOutboxIntent,
  right: AssistantOutboxIntent,
): number {
  return readHostedAssistantDeliveryCandidateCreatedAt(left)
    .localeCompare(readHostedAssistantDeliveryCandidateCreatedAt(right));
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
      if (!Number.isFinite(nextAttemptMs) || nextAttemptMs <= now.getTime()) {
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
  return effect.payload.transportIdempotent
    || isHostedSignupWelcomeDeliveryPayload(effect.payload);
}

export function createHostedAssistantProgressDeliveryDependencies(input: {
  forwardedEnv?: Readonly<Record<string, string>>;
  linqDeliveryContext?: HostedAssistantLinqDeliveryContext | null;
  providerFetch?: typeof fetch | null;
  signal?: AbortSignal | null;
  userEnv?: Readonly<Record<string, string>>;
  wake?: HostedRuntimeEvent | null;
}): AssistantHostedProgressDeliveryDependencies {
  const linqEnv = buildHostedLinqChannelEnv({
    forwardedEnv: input.forwardedEnv ?? {},
    userEnv: input.userEnv ?? {},
  }) as NodeJS.ProcessEnv;

  return {
    ...(input.signal ? { signal: input.signal } : {}),
    sendLinq: createHostedAssistantLinqSendDependency({
      linqEnv,
      linqDeliveryContext: input.linqDeliveryContext
        ?? (input.wake ? buildHostedAssistantLinqDeliveryContextFromWake(input.wake) : null),
      providerFetch: input.providerFetch ?? null,
      signal: input.signal ?? null,
    }),
  };
}

export async function drainHostedPreparedAssistantDeliveries(input: {
  allowPreparedSending?: boolean;
  effectsPort: HostedRuntimeEffectsPort;
  assistantDeliveryEffects: HostedAssistantDeliveryEffect[];
  assertLiveness?: () => Promise<void>;
  forwardedEnv?: Readonly<Record<string, string>>;
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
  const linqEnv = buildHostedLinqChannelEnv({
    forwardedEnv: input.forwardedEnv ?? {},
    userEnv: input.userEnv ?? {},
  }) as NodeJS.ProcessEnv;
  const whatsAppEnv = buildHostedWhatsAppChannelEnv({
    forwardedEnv: input.forwardedEnv ?? {},
    platformEnv: input.platformEnv,
  }) as NodeJS.ProcessEnv;
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
        wake: input.wake,
        effectsPort: input.effectsPort,
        allowPreparedSending: ownsPreparedDispatch,
        assertLiveness: input.assertLiveness,
        assistantDeliveryEffect,
        signal: input.signal ?? null,
        linqEnv,
        preparedDispatch: ownsPreparedDispatch ? preparedDispatch : null,
        telegramEnv,
        whatsAppEnv,
        providerFetch: input.providerFetch ?? null,
        userId: input.wake.userId,
        vaultRoot: input.vaultRoot,
      });
    } catch (error) {
      await resetHostedPreparedDeliveryEffects({
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
      const successorResetAt = await resolveHostedAssistantSuccessorResetAt({
        effect: assistantDeliveryEffect,
        vaultRoot: input.vaultRoot,
      });
      await resetHostedPreparedDeliveryEffects({
        effects: input.assistantDeliveryEffects
          .slice(index + 1)
          .filter((effect) =>
            readHostedAssistantDeliveryEffectBoundaryKey(effect) === boundaryKey
          ),
        minimumNextAttemptAt: successorResetAt,
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
  return input.effect.deliveryPhase === "foreground_current_turn"
    && input.outcome.deliveryStatus !== "sent"
    && input.outcome.retryable === true;
}

async function resetHostedPreparedDeliveryEffects(input: {
  effects: readonly HostedAssistantDeliveryEffect[];
  minimumNextAttemptAt?: Date | null;
  preparedDispatchByIntentId: ReadonlyMap<string, HostedAssistantDeliveryPreparedDispatch>;
  vaultRoot: string;
}): Promise<void> {
  for (const effect of input.effects) {
    const preparedDispatch =
      input.preparedDispatchByIntentId.get(effect.effectId) ?? null;
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

async function resolveHostedAssistantSuccessorResetAt(input: {
  effect: HostedAssistantDeliveryEffect;
  vaultRoot: string;
}): Promise<Date> {
  const now = new Date();
  const mirrorState = await readAssistantOutboxIntentMirrorState({
    intentId: input.effect.effectId,
    now,
    sendingGraceMs: HOSTED_NON_IDEMPOTENT_CONFIRMATION_GRACE_MS,
    vault: input.vaultRoot,
  });
  const nextAttemptAt = mirrorState.intent?.nextAttemptAt;
  const nextAttemptAtMs = typeof nextAttemptAt === "string"
    ? Date.parse(nextAttemptAt)
    : Number.NaN;
  return Number.isFinite(nextAttemptAtMs)
    ? new Date(Math.max(nextAttemptAtMs, now.getTime()))
    : now;
}

async function deliverHostedPreparedAssistantDelivery(input: {
  allowPreparedSending: boolean;
  wake: HostedRuntimeEvent;
  effectsPort: HostedRuntimeEffectsPort;
  assertLiveness?: () => Promise<void>;
  assistantDeliveryEffect: HostedAssistantDeliveryEffect;
  signal: AbortSignal | null;
  linqEnv: NodeJS.ProcessEnv;
  preparedDispatch: HostedAssistantDeliveryPreparedDispatch | null;
  telegramEnv: NodeJS.ProcessEnv;
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
    const dispatched = await dispatchAssistantOutboxIntent({
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
        sendLinq: createHostedAssistantLinqSendDependency({
          assertLiveness: input.assertLiveness,
          linqEnv: input.linqEnv,
          linqDeliveryContext: input.wake
            ? buildHostedAssistantLinqDeliveryContextFromWake(input.wake)
            : null,
          onProviderDispatchEntered: () => {
            providerDispatchEntered = true;
          },
          providerFetch: input.providerFetch,
          signal: input.signal,
        }),
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

function createHostedAssistantLinqSendDependency(input: {
  assertLiveness?: () => Promise<void>;
  linqDeliveryContext?: HostedAssistantLinqDeliveryContext | null;
  linqEnv: NodeJS.ProcessEnv;
  onProviderDispatchEntered?: () => void;
  providerFetch: typeof fetch | null;
  signal: AbortSignal | null;
}): NonNullable<AssistantHostedProgressDeliveryDependencies["sendLinq"]> {
  return async (request) => {
    await assertHostedDeliveryLiveNow(input);
    const deliveryContext = resolveHostedAssistantLinqDeliveryContextForRequest({
      context: input.linqDeliveryContext ?? null,
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
    const signal = mergeHostedAssistantLinqSignals(input.signal, request.signal);
    const dependencies = requireHostedProviderFetchDependencies({
      env: input.linqEnv,
      fetchImplementation: input.providerFetch,
      ...(signal ? { signal } : {}),
    }, "Hosted assistant Linq delivery");
    input.onProviderDispatchEntered?.();
    const result = await sendHostedProviderLinqMessage({
      directRecipientPhoneNumber,
      fromPhoneNumber,
      idempotencyKey: request.idempotencyKey ?? null,
      media: request.media ?? null,
      message: request.message,
      replyToMessageId: request.replyToMessageId ?? null,
      target: request.target,
      targetKind: request.targetKind ?? null,
    }, dependencies);
    await assertHostedDeliveryLiveNow(input);
    return result;
  };
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
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError: failure,
        deliveryStatus: "failed",
        wake: input.wake,
        effect: input.assistantDeliveryEffect,
        retryable: false,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: failure.code,
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
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError: ambiguousError,
        deliveryStatus: "failed_ambiguous",
        wake: input.wake,
        effect: input.assistantDeliveryEffect,
        retryable: false,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: ambiguousError.code,
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
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError: retryableError,
        deliveryStatus: "retryable",
        wake: input.wake,
        effect: input.assistantDeliveryEffect,
        retryable: true,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: retryableError.code,
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
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError: confirmationPending,
        deliveryStatus: "sending",
        wake: input.wake,
        effect: input.assistantDeliveryEffect,
        retryable: true,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: confirmationPending.code,
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
  deliveryStatus:
    | "failed"
    | "failed_ambiguous"
    | "missing-result"
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

  const deliveryError = dispatchResult.deliveryError
    ? normalizeAssistantDeliveryError(dispatchResult.deliveryError)
    : normalizeHostedAssistantDeliveryMirrorFailure({
        fallbackMessage: "The assistant outbox mirror did not produce a delivery result.",
        lastError: dispatchResult.intent.lastError,
      });

  switch (dispatchResult.intent.status) {
    case "failed":
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError,
        deliveryStatus: "failed",
        wake: input.wake,
        effect: assistantDeliveryEffect,
        retryable: false,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: deliveryError.code,
        deliveryErrorMessage: deliveryError.message,
        deliveryStatus: "failed",
        effect: assistantDeliveryEffect,
        retryable: false,
      });
    case "retryable":
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError,
        deliveryStatus: "retryable",
        wake: input.wake,
        effect: assistantDeliveryEffect,
        retryable: true,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: deliveryError.code,
        deliveryErrorMessage: deliveryError.message,
        deliveryStatus: "retryable",
        effect: assistantDeliveryEffect,
        retryable: true,
      });
    case "sending":
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError,
        deliveryStatus: "sending",
        wake: input.wake,
        effect: assistantDeliveryEffect,
        retryable: true,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: deliveryError.code,
        deliveryErrorMessage: deliveryError.message,
        deliveryStatus: "sending",
        effect: assistantDeliveryEffect,
        retryable: true,
      });
    case "pending":
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError,
        deliveryStatus: "retryable",
        wake: input.wake,
        effect: assistantDeliveryEffect,
        retryable: true,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: deliveryError.code,
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
        deliveryStatus: "failed_ambiguous",
        wake: input.wake,
        effect: assistantDeliveryEffect,
        retryable: false,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: ambiguousError.code,
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
    | "replyToMessageId"
    | "sessionId"
    | "subject"
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
    sessionId: intent.sessionId,
    threadId: intent.threadId ?? null,
    threadIsDirect: intent.threadIsDirect ?? null,
    transportIdempotent: intent.deliveryTransportIdempotent,
    turnId: intent.turnId,
    kind: "message" as const,
    media: intent.media ?? [],
    message: intent.message,
    subject: intent.subject ?? null,
    replyToMessageId: intent.replyToMessageId ?? null,
  };

  assertSupportedHostedAssistantDeliveryPayload(payload);
  return payload;
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

function buildHostedAssistantDeliveryOutcome(input: {
  delivery?: AssistantChannelDelivery | null;
  deliveryErrorCode?: string | null;
  deliveryErrorMessage?: string | null;
  deliveryStatus: HostedAssistantDeliveryOutcome["deliveryStatus"];
  effect: HostedAssistantDeliveryEffect;
  retryable: boolean;
}): HostedAssistantDeliveryOutcome {
  const cleanupMessages = readAssistantDeliveryCleanupMessages(input.delivery ?? null);
  const cleanupTargetAliases = readAssistantDeliveryCleanupTargetAliases(
    input.delivery ?? null,
  );
  return {
    deliveryChannel: input.delivery?.channel ?? null,
    deliveryErrorCode: input.deliveryErrorCode ?? null,
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
    providerMessageId: input.delivery?.providerMessageId ?? null,
    ...(input.delivery?.providerMessageIds && input.delivery.providerMessageIds.length > 0
      ? {
          providerMessageIds: [...input.delivery.providerMessageIds],
        }
      : {}),
    providerThreadId: input.delivery?.providerThreadId ?? null,
    retryable: input.retryable,
    target: input.delivery?.target ?? null,
    targetKind: input.delivery?.targetKind ?? null,
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
  lastError: { code: string | null; message: string } | null;
}): {
  code: string | null;
  message: string;
} {
  return {
    code: input.lastError?.code ?? null,
    message: input.lastError?.message ?? input.fallbackMessage,
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
