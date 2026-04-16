import type {
  HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution/contracts";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  buildHostedAssistantDeliveryEffect,
  buildHostedAssistantDeliveryFailedRecord,
  buildHostedAssistantDeliverySendingRecord,
  buildHostedAssistantDeliverySentRecord,
  parseHostedAssistantDeliveryEffects,
  type HostedAssistantDeliveryPayload,
  type HostedAssistantDeliveryRecord,
  type HostedAssistantDeliveryAttempt,
  type HostedAssistantDeliveryEffect,
} from "@murphai/hosted-execution/side-effects";
import {
  type AssistantOutboxDispatchPayload,
  beginAssistantOutboxIntentMirrorDispatch,
  createAssistantDeliveryAmbiguousError,
  errorImpliesAssistantDeliveryMayHaveSucceeded,
  isAssistantOutboxRetryableError,
  listAssistantOutboxIntents,
  markAssistantOutboxIntentMirrorRetryableById,
  markAssistantOutboxIntentMirrorTerminalById,
  markAssistantOutboxIntentSentById,
  normalizeAssistantDeliveryError,
  saveAssistantSession,
  sendAssistantOutboxPayload,
  shouldDispatchAssistantOutboxIntent,
  type AssistantChannelDelivery,
} from "@murphai/assistant-engine";
import type {
  AssistantOutboxIntent,
  AssistantSession,
} from "@murphai/operator-config/assistant-cli-contracts";
import {
  assistantChannelDeliverySchema,
} from "@murphai/operator-config/assistant-cli-contracts";

import type {
  HostedCommittedExecutionState,
  HostedAssistantRuntimeJobRequest,
  HostedAssistantDeliveryOutcome,
} from "./models.ts";
import type {
  HostedRuntimeEffectsPort,
} from "./platform.ts";

const HOSTED_MAX_COMMITTED_ASSISTANT_DELIVERY_EFFECTS = 20;
const HOSTED_ASSISTANT_DELIVERY_BOUNDARY = "hosted_runtime_finalize";
const HOSTED_NON_IDEMPOTENT_CONFIRMATION_GRACE_MS = 2 * 60 * 1000;

type HostedAssistantDeliveryDetails = Record<string, boolean | null | string>;
type HostedAssistantDeliveryJournalTrace = {
  lastMethod: "DELETE" | "GET" | "PUT" | null;
  lastStatus: number | null;
};

export function resumeHostedCommittedExecution(
  request: HostedAssistantRuntimeJobRequest,
): HostedCommittedExecutionState {
  const committedAssistantDeliveryEffects = parseHostedAssistantDeliveryEffects(
    request.resume!.committedResult.assistantDeliveryEffects,
  );

  return {
    committedGatewayProjectionSnapshot: {
      schema: "murph.gateway-projection-snapshot.v1",
      generatedAt: new Date().toISOString(),
      conversations: [],
      messages: [],
      permissions: [],
    },
    committedResult: {
      bundle: request.bundle,
      result: request.resume!.committedResult.result,
    },
    committedAssistantDeliveryEffects,
  };
}

export async function collectHostedAssistantDeliverySideEffects(
  vaultRoot: string,
): Promise<HostedAssistantDeliveryEffect[]> {
  const now = new Date();
  const intents = await listAssistantOutboxIntents(vaultRoot);

  return intents
    .filter((intent: Awaited<ReturnType<typeof listAssistantOutboxIntents>>[number]) =>
      shouldDispatchAssistantOutboxIntent(intent, now),
    )
    .slice(0, HOSTED_MAX_COMMITTED_ASSISTANT_DELIVERY_EFFECTS)
    .map((intent: Awaited<ReturnType<typeof listAssistantOutboxIntents>>[number]) =>
      buildHostedAssistantDeliveryEffect({
        dedupeKey: intent.dedupeKey,
        effectId: intent.intentId,
        payload: buildHostedAssistantDeliveryPayloadFromIntent(intent),
      }),
    );
}

export async function drainHostedCommittedAssistantDeliveriesAfterCommit(input: {
  dispatch: HostedExecutionDispatchRequest;
  effectsPort: HostedRuntimeEffectsPort;
  assistantDeliveryEffects: HostedAssistantDeliveryEffect[];
  vaultRoot: string;
}): Promise<HostedAssistantDeliveryOutcome[]> {
  const outcomes: HostedAssistantDeliveryOutcome[] = [];
  for (const assistantDeliveryEffect of input.assistantDeliveryEffects) {
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: buildHostedAssistantDeliveryDetails({
        effectFingerprint: assistantDeliveryEffect.fingerprint,
        effectId: assistantDeliveryEffect.effectId,
        userId: input.dispatch.event.userId,
      }),
      dispatch: input.dispatch,
      message: "Hosted assistant delivery dispatch starting.",
      phase: "side-effects.draining",
      userId: input.dispatch.event.userId,
    });
    outcomes.push(await dispatchHostedCommittedAssistantDelivery({
      dispatch: input.dispatch,
      effectsPort: input.effectsPort,
      assistantDeliveryEffect,
      userId: input.dispatch.event.userId,
      vaultRoot: input.vaultRoot,
    }));
  }

  return outcomes;
}

async function dispatchHostedCommittedAssistantDelivery(input: {
  dispatch: HostedExecutionDispatchRequest;
  effectsPort: HostedRuntimeEffectsPort;
  assistantDeliveryEffect: HostedAssistantDeliveryEffect;
  userId: string;
  vaultRoot: string;
}): Promise<HostedAssistantDeliveryOutcome> {
  const journalTrace: HostedAssistantDeliveryJournalTrace = {
    lastMethod: null,
    lastStatus: null,
  };
  let attempt: HostedAssistantDeliveryAttempt | null = null;
  let deliveryMayHaveSucceeded = false;
  try {
    const existingRecord = await callHostedAssistantDeliveryJournal({
      effectsPort: input.effectsPort,
      journalTrace,
      method: "GET",
      sideEffect: input.assistantDeliveryEffect,
      userId: input.userId,
    });

    if (existingRecord?.state === "sent") {
      await syncHostedAssistantDeliverySentMirror({
        delivery: buildAssistantChannelDeliveryFromHostedReceipt(existingRecord.delivery),
        effect: input.assistantDeliveryEffect,
        userId: input.userId,
        vaultRoot: input.vaultRoot,
      });
      emitHostedAssistantDeliveryDispatchSuccess({
        delivery: buildAssistantChannelDeliveryFromHostedReceipt(existingRecord.delivery),
        dispatch: input.dispatch,
        effect: input.assistantDeliveryEffect,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        delivery: buildAssistantChannelDeliveryFromHostedReceipt(existingRecord.delivery),
        deliveryStatus: "sent",
        effect: input.assistantDeliveryEffect,
        journalTrace,
        retryable: false,
      });
    }

    if (existingRecord?.state === "failed_ambiguous") {
      const ambiguousError = createAssistantDeliveryAmbiguousError(existingRecord.failure);
      await syncHostedAssistantDeliveryTerminalMirror({
        effect: input.assistantDeliveryEffect,
        error: ambiguousError,
        status: "abandoned",
        userId: input.userId,
        vaultRoot: input.vaultRoot,
      });
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError: ambiguousError,
        deliveryStatus: "failed_ambiguous",
        dispatch: input.dispatch,
        effect: input.assistantDeliveryEffect,
        retryable: false,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: ambiguousError.code,
        deliveryErrorMessage: ambiguousError.message,
        deliveryStatus: "failed_ambiguous",
        effect: input.assistantDeliveryEffect,
        journalTrace,
        retryable: false,
      });
    }

    if (
      existingRecord?.state === "failed"
      && !isHostedDeliveryTransportIdempotent(input.assistantDeliveryEffect)
    ) {
      const failedError = Object.assign(new Error(existingRecord.failure.message), {
        code: existingRecord.failure.code,
      });
      await syncHostedAssistantDeliveryTerminalMirror({
        effect: input.assistantDeliveryEffect,
        error: failedError,
        status: "failed",
        userId: input.userId,
        vaultRoot: input.vaultRoot,
      });
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError: {
          code: existingRecord.failure.code,
          message: existingRecord.failure.message,
        },
        deliveryStatus: "failed",
        dispatch: input.dispatch,
        effect: input.assistantDeliveryEffect,
        retryable: false,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: existingRecord.failure.code,
        deliveryErrorMessage: existingRecord.failure.message,
        deliveryStatus: "failed",
        effect: input.assistantDeliveryEffect,
        journalTrace,
        retryable: false,
      });
    }

    if (
      existingRecord?.state === "sending"
      && !isHostedSendingRecordStale(existingRecord)
    ) {
      await syncHostedAssistantDeliverySendingMirror({
        effect: input.assistantDeliveryEffect,
        startedAt: existingRecord.attempt.startedAt,
        userId: input.userId,
        vaultRoot: input.vaultRoot,
      });
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError: null,
        deliveryStatus: "sending",
        dispatch: input.dispatch,
        effect: input.assistantDeliveryEffect,
        retryable: true,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryStatus: "sending",
        effect: input.assistantDeliveryEffect,
        journalTrace,
        retryable: true,
      });
    }

    if (
      existingRecord?.state === "sending"
      && isHostedSendingRecordStale(existingRecord)
      && !isHostedDeliveryTransportIdempotent(input.assistantDeliveryEffect)
    ) {
      const ambiguousError = createAssistantDeliveryAmbiguousError({
        code: "ASSISTANT_DELIVERY_AMBIGUOUS",
        message:
          "The hosted delivery journal remained in sending state past the confirmation grace window.",
      });
      await persistHostedAssistantDeliveryAmbiguousRecord({
        attempt: existingRecord.attempt,
        effectsPort: input.effectsPort,
        journalTrace,
        effect: input.assistantDeliveryEffect,
        reason: ambiguousError,
        userId: input.userId,
      });
      await syncHostedAssistantDeliveryTerminalMirror({
        effect: input.assistantDeliveryEffect,
        error: ambiguousError,
        status: "abandoned",
        userId: input.userId,
        vaultRoot: input.vaultRoot,
      });
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError: ambiguousError,
        deliveryStatus: "failed_ambiguous",
        dispatch: input.dispatch,
        effect: input.assistantDeliveryEffect,
        retryable: false,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: ambiguousError.code,
        deliveryErrorMessage: ambiguousError.message,
        deliveryStatus: "failed_ambiguous",
        effect: input.assistantDeliveryEffect,
        journalTrace,
        retryable: false,
      });
    }

    attempt = buildHostedAssistantDeliveryAttemptFromEffect(
      input.assistantDeliveryEffect,
      new Date().toISOString(),
    );
    await callHostedAssistantDeliveryJournal({
      effectsPort: input.effectsPort,
      journalTrace,
      method: "PUT",
      record: buildHostedAssistantDeliverySendingRecord({
        attempt,
        dedupeKey: input.assistantDeliveryEffect.fingerprint,
        effectId: input.assistantDeliveryEffect.effectId,
      }),
      userId: input.userId,
    });
    await syncHostedAssistantDeliverySendingMirror({
      effect: input.assistantDeliveryEffect,
      startedAt: attempt.startedAt,
      userId: input.userId,
      vaultRoot: input.vaultRoot,
    });

    const delivered = await sendAssistantOutboxPayload({
      dependencies: {
        sendEmail: (request: Parameters<HostedRuntimeEffectsPort["sendEmail"]>[0]) =>
          input.effectsPort.sendEmail(request),
      },
      payload: buildAssistantOutboxDispatchPayload(input.assistantDeliveryEffect.payload),
      vault: input.vaultRoot,
    });
    const delivery = assistantChannelDeliverySchema.parse({
      ...delivered.delivery,
      idempotencyKey:
        delivered.delivery.idempotencyKey
        ?? input.assistantDeliveryEffect.payload.idempotencyKey,
    });
    deliveryMayHaveSucceeded = true;

    await callHostedAssistantDeliveryJournal({
      effectsPort: input.effectsPort,
      journalTrace,
      method: "PUT",
      record: buildHostedAssistantDeliverySentRecord({
        dedupeKey: input.assistantDeliveryEffect.fingerprint,
        delivery: {
          ...delivery,
          idempotencyKey:
            delivery.idempotencyKey
            ?? input.assistantDeliveryEffect.payload.idempotencyKey,
        },
        effectId: input.assistantDeliveryEffect.effectId,
      }),
      userId: input.userId,
    });
    await syncHostedAssistantDeliverySentMirror({
      delivery,
      effect: input.assistantDeliveryEffect,
      userId: input.userId,
      vaultRoot: input.vaultRoot,
    });
    if (delivered.session) {
      await bestEffortSaveHostedAssistantDeliverySession({
        dispatch: input.dispatch,
        effect: input.assistantDeliveryEffect,
        session: delivered.session,
        userId: input.userId,
        vaultRoot: input.vaultRoot,
      });
    }

    emitHostedAssistantDeliveryDispatchSuccess({
      delivery,
      dispatch: input.dispatch,
      effect: input.assistantDeliveryEffect,
      userId: input.userId,
    });
    return buildHostedAssistantDeliveryOutcome({
      delivery,
      deliveryStatus: "sent",
      effect: input.assistantDeliveryEffect,
      journalTrace,
      retryable: false,
    });
  } catch (error) {
    const deliveryError = normalizeAssistantDeliveryError(error);
    const retryable = deliveryMayHaveSucceeded
      ? isHostedDeliveryTransportIdempotent(input.assistantDeliveryEffect)
      : isAssistantOutboxRetryableError(error);
    const ambiguousNonIdempotent = attempt
      && (deliveryMayHaveSucceeded || errorImpliesAssistantDeliveryMayHaveSucceeded(error))
      && !isHostedDeliveryTransportIdempotent(input.assistantDeliveryEffect)
      && !isHostedAssistantDeliveryJournalFailure(error);

    if (attempt && ambiguousNonIdempotent) {
      const ambiguousError = createAssistantDeliveryAmbiguousError(error);
      await persistHostedAssistantDeliveryAmbiguousRecord({
        attempt,
        effectsPort: input.effectsPort,
        journalTrace,
        effect: input.assistantDeliveryEffect,
        reason: ambiguousError,
        userId: input.userId,
      });
      await syncHostedAssistantDeliveryTerminalMirror({
        effect: input.assistantDeliveryEffect,
        error: ambiguousError,
        status: "abandoned",
        userId: input.userId,
        vaultRoot: input.vaultRoot,
      });
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError: ambiguousError,
        deliveryStatus: "failed_ambiguous",
        dispatch: input.dispatch,
        effect: input.assistantDeliveryEffect,
        retryable: false,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: ambiguousError.code,
        deliveryErrorMessage: ambiguousError.message,
        deliveryStatus: "failed_ambiguous",
        effect: input.assistantDeliveryEffect,
        journalTrace,
        retryable: false,
      });
    }

    if (attempt && !isHostedAssistantDeliveryJournalFailure(error)) {
      await persistHostedAssistantDeliveryFailureRecord({
        attempt,
        effectsPort: input.effectsPort,
        error: deliveryError,
        journalTrace,
        effect: input.assistantDeliveryEffect,
        userId: input.userId,
      });
      if (retryable) {
        await syncHostedAssistantDeliveryRetryableMirror({
          effect: input.assistantDeliveryEffect,
          error,
          userId: input.userId,
          vaultRoot: input.vaultRoot,
        });
      } else {
        await syncHostedAssistantDeliveryTerminalMirror({
          effect: input.assistantDeliveryEffect,
          error,
          status: "failed",
          userId: input.userId,
          vaultRoot: input.vaultRoot,
        });
      }
      const deliveryStatus = retryable ? "retryable" : "failed";
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError,
        deliveryStatus,
        dispatch: input.dispatch,
        effect: input.assistantDeliveryEffect,
        retryable,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: deliveryError.code,
        deliveryErrorMessage: deliveryError.message,
        deliveryStatus,
        effect: input.assistantDeliveryEffect,
        journalTrace,
        retryable,
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
          failureDomain: "dispatch",
          retryable: readHostedAssistantDeliveryRetryableFlag(error),
        },
        userId: input.userId,
      }),
      dispatch: input.dispatch,
      error: enrichedError,
      message: "Hosted assistant delivery threw during post-commit dispatch.",
      phase: "side-effects.draining",
      userId: input.userId,
    });
    throw enrichedError;
  }
}

function emitHostedAssistantDeliveryDispatchSuccess(input: {
  delivery: AssistantChannelDelivery;
  dispatch: HostedExecutionDispatchRequest;
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
        deliveryStatus: "sent",
        failureDomain: "dispatch",
        retryable: false,
        targetKind: input.delivery.targetKind,
      },
      userId: input.userId,
    }),
    dispatch: input.dispatch,
    message: "Hosted assistant delivery sent successfully during post-commit dispatch.",
    phase: "side-effects.draining",
    userId: input.userId,
  });
}

function emitHostedAssistantDeliveryDispatchOutcome(input: {
  deliveryError: { code: string | null; message: string } | null;
  deliveryStatus: "failed" | "failed_ambiguous" | "retryable" | "sending";
  dispatch: HostedExecutionDispatchRequest;
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
        deliveryStatus: input.deliveryStatus,
        failureDomain: "dispatch",
        retryable: input.retryable,
      },
      userId: input.userId,
    }),
    dispatch: input.dispatch,
    level: input.retryable ? "warn" : "error",
    message: `Hosted assistant delivery finished with ${input.deliveryStatus} status during post-commit dispatch.`,
    phase: "side-effects.draining",
    userId: input.userId,
  });
}

async function persistHostedAssistantDeliveryAmbiguousRecord(input: {
  attempt: HostedAssistantDeliveryAttempt;
  effectsPort: HostedRuntimeEffectsPort;
  effect: HostedAssistantDeliveryEffect;
  journalTrace: HostedAssistantDeliveryJournalTrace;
  reason: ReturnType<typeof createAssistantDeliveryAmbiguousError>;
  userId: string;
}): Promise<void> {
  await callHostedAssistantDeliveryJournal({
    effectsPort: input.effectsPort,
    journalTrace: input.journalTrace,
    method: "PUT",
    record: buildHostedAssistantDeliveryFailedRecord({
      attempt: input.attempt,
      dedupeKey: input.effect.fingerprint,
      effectId: input.effect.effectId,
      failure: {
        code: input.reason.code,
        failedAt: new Date().toISOString(),
        message: input.reason.message,
      },
      state: "failed_ambiguous",
    }),
    userId: input.userId,
  });
}

async function persistHostedAssistantDeliveryFailureRecord(input: {
  attempt: HostedAssistantDeliveryAttempt;
  effectsPort: HostedRuntimeEffectsPort;
  error: { code: string | null; message: string };
  journalTrace: HostedAssistantDeliveryJournalTrace;
  effect: HostedAssistantDeliveryEffect;
  userId: string;
}): Promise<void> {
  await callHostedAssistantDeliveryJournal({
    effectsPort: input.effectsPort,
    journalTrace: input.journalTrace,
    method: "PUT",
    record: buildHostedAssistantDeliveryFailedRecord({
      attempt: input.attempt,
      dedupeKey: input.effect.fingerprint,
      effectId: input.effect.effectId,
      failure: {
        code: input.error.code,
        failedAt: new Date().toISOString(),
        message: input.error.message,
      },
    }),
    userId: input.userId,
  });
}

function buildHostedAssistantDeliveryPayloadFromIntent(
  intent: Pick<
    AssistantOutboxIntent,
    | "actorId"
    | "bindingDelivery"
    | "channel"
    | "deliveryIdempotencyKey"
    | "deliveryTransportIdempotent"
    | "explicitTarget"
    | "identityId"
    | "intentId"
    | "message"
    | "replyToMessageId"
    | "sessionId"
    | "threadId"
    | "threadIsDirect"
    | "turnId"
  >,
): HostedAssistantDeliveryPayload {
  return {
    actorId: intent.actorId ?? null,
    bindingDeliveryKind: intent.bindingDelivery?.kind ?? null,
    bindingDeliveryTarget: intent.bindingDelivery?.target ?? null,
    channel: intent.channel ?? null,
    explicitTarget: intent.explicitTarget ?? null,
    idempotencyKey: intent.deliveryIdempotencyKey ?? `assistant-outbox:${intent.intentId}`,
    identityId: intent.identityId ?? null,
    message: intent.message,
    replyToMessageId: intent.replyToMessageId ?? null,
    sessionId: intent.sessionId,
    threadId: intent.threadId ?? null,
    threadIsDirect: intent.threadIsDirect ?? null,
    transportIdempotent: intent.deliveryTransportIdempotent || intent.channel === "linq",
    turnId: intent.turnId,
  };
}

function buildAssistantOutboxDispatchPayload(
  payload: HostedAssistantDeliveryPayload,
): AssistantOutboxDispatchPayload {
  return {
    actorId: payload.actorId,
    bindingDelivery: payload.bindingDeliveryKind && payload.bindingDeliveryTarget
      ? {
          kind: payload.bindingDeliveryKind,
          target: payload.bindingDeliveryTarget,
        }
      : null,
    channel: payload.channel,
    deliveryIdempotencyKey: payload.idempotencyKey,
    explicitTarget: payload.explicitTarget,
    identityId: payload.identityId,
    message: payload.message,
    replyToMessageId: payload.replyToMessageId,
    sessionId: payload.sessionId,
    threadId: payload.threadId,
    threadIsDirect: payload.threadIsDirect,
    turnId: payload.turnId,
  };
}

function buildHostedAssistantDeliveryAttemptFromEffect(
  effect: HostedAssistantDeliveryEffect,
  startedAt: string,
): HostedAssistantDeliveryAttempt {
  return {
    channel: effect.payload.channel ?? null,
    idempotencyKey: effect.payload.idempotencyKey,
    messageLength: effect.payload.message.length,
    providerMessageId: null,
    providerThreadId: null,
    startedAt,
    target: effect.payload.explicitTarget ?? effect.payload.bindingDeliveryTarget ?? null,
    targetKind: effect.payload.explicitTarget
      ? "explicit"
      : effect.payload.bindingDeliveryKind ?? null,
  };
}

function buildAssistantChannelDeliveryFromHostedReceipt(
  receipt: Extract<HostedAssistantDeliveryRecord, { state: "sent" }>["delivery"],
): AssistantChannelDelivery {
  return {
    channel: receipt.channel,
    idempotencyKey: receipt.idempotencyKey,
    messageLength: receipt.messageLength,
    providerMessageId: receipt.providerMessageId,
    providerThreadId: receipt.providerThreadId,
    sentAt: receipt.sentAt,
    target: receipt.target,
    targetKind: receipt.targetKind,
  };
}

function isHostedDeliveryTransportIdempotent(
  effect: Pick<HostedAssistantDeliveryEffect, "payload">,
): boolean {
  return effect.payload.transportIdempotent;
}

function isHostedSendingRecordStale(
  record: Extract<HostedAssistantDeliveryRecord, { state: "sending" }>,
): boolean {
  const startedAtMs = Date.parse(record.attempt.startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return true;
  }

  return Date.now() - startedAtMs >= HOSTED_NON_IDEMPOTENT_CONFIRMATION_GRACE_MS;
}

async function syncHostedAssistantDeliverySendingMirror(input: {
  effect: HostedAssistantDeliveryEffect;
  startedAt: string;
  userId: string;
  vaultRoot: string;
}): Promise<void> {
  await bestEffortHostedAssistantDeliveryMirror({
    effect: input.effect,
    step: "sending",
    userId: input.userId,
    work: async () => {
      await beginAssistantOutboxIntentMirrorDispatch({
        deliveryIdempotencyKey: input.effect.payload.idempotencyKey,
        deliveryTransportIdempotent: input.effect.payload.transportIdempotent,
        intentId: input.effect.effectId,
        startedAt: input.startedAt,
        vault: input.vaultRoot,
      });
    },
  });
}

async function syncHostedAssistantDeliveryRetryableMirror(input: {
  effect: HostedAssistantDeliveryEffect;
  error: unknown;
  userId: string;
  vaultRoot: string;
}): Promise<void> {
  await bestEffortHostedAssistantDeliveryMirror({
    effect: input.effect,
    step: "retryable",
    userId: input.userId,
    work: async () => {
      await markAssistantOutboxIntentMirrorRetryableById({
        error: input.error,
        intentId: input.effect.effectId,
        vault: input.vaultRoot,
      });
    },
  });
}

async function syncHostedAssistantDeliveryTerminalMirror(input: {
  effect: HostedAssistantDeliveryEffect;
  error: unknown;
  status: "abandoned" | "failed";
  userId: string;
  vaultRoot: string;
}): Promise<void> {
  await bestEffortHostedAssistantDeliveryMirror({
    effect: input.effect,
    step: input.status,
    userId: input.userId,
    work: async () => {
      await markAssistantOutboxIntentMirrorTerminalById({
        error: input.error,
        intentId: input.effect.effectId,
        status: input.status,
        vault: input.vaultRoot,
      });
    },
  });
}

async function syncHostedAssistantDeliverySentMirror(input: {
  delivery: AssistantChannelDelivery;
  effect: HostedAssistantDeliveryEffect;
  userId: string;
  vaultRoot: string;
}): Promise<void> {
  await bestEffortHostedAssistantDeliveryMirror({
    effect: input.effect,
    step: "sent",
    userId: input.userId,
    work: async () => {
      await markAssistantOutboxIntentSentById({
        delivery: input.delivery,
        intentId: input.effect.effectId,
        vault: input.vaultRoot,
      });
    },
  });
}

async function bestEffortHostedAssistantDeliveryMirror(input: {
  effect: HostedAssistantDeliveryEffect;
  step: string;
  userId: string;
  work: () => Promise<void>;
}): Promise<void> {
  try {
    await input.work();
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: buildHostedAssistantDeliveryDetails({
        effectFingerprint: input.effect.fingerprint,
        effectId: input.effect.effectId,
        extra: {
          failureDomain: "mirror",
          mirrorStep: input.step,
          retryable: true,
        },
        userId: input.userId,
      }),
      error,
      level: "warn",
      message: "Hosted assistant delivery local mirror update failed.",
      phase: "side-effects.draining",
      userId: input.userId,
    });
  }
}

async function bestEffortSaveHostedAssistantDeliverySession(input: {
  dispatch: HostedExecutionDispatchRequest;
  effect: HostedAssistantDeliveryEffect;
  session: AssistantSession;
  userId: string;
  vaultRoot: string;
}): Promise<void> {
  try {
    await saveAssistantSession(input.vaultRoot, input.session);
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: buildHostedAssistantDeliveryDetails({
        effectFingerprint: input.effect.fingerprint,
        effectId: input.effect.effectId,
        extra: {
          failureDomain: "session",
          retryable: true,
        },
        userId: input.userId,
      }),
      dispatch: input.dispatch,
      error,
      level: "warn",
      message: "Hosted assistant delivery session persistence failed after send.",
      phase: "side-effects.draining",
      userId: input.userId,
    });
  }
}

function isHostedAssistantDeliveryJournalFailure(error: unknown): boolean {
  return readStringProperty(error, "code") === "HOSTED_SIDE_EFFECT_JOURNAL_FAILED";
}

async function callHostedAssistantDeliveryJournal(input:
  | {
      effectsPort: HostedRuntimeEffectsPort;
      journalTrace: HostedAssistantDeliveryJournalTrace;
      method: "GET";
      sideEffect: HostedAssistantDeliveryEffect;
      userId: string;
    }
  | {
      effectsPort: HostedRuntimeEffectsPort;
      journalTrace: HostedAssistantDeliveryJournalTrace;
      method: "PUT";
      record: HostedAssistantDeliveryRecord;
      userId: string;
    }): Promise<HostedAssistantDeliveryRecord | null> {
  const sideEffect = input.method === "PUT"
    ? {
        effectId: input.record.effectId,
        fingerprint: input.record.fingerprint,
      }
    : input.sideEffect;
  try {
    input.journalTrace.lastMethod = input.method;
    input.journalTrace.lastStatus = null;

    let result: HostedAssistantDeliveryRecord | null;
    switch (input.method) {
      case "GET":
        result = await readAssistantDeliveryRecord(input.effectsPort, {
          effectId: sideEffect.effectId,
          fingerprint: sideEffect.fingerprint,
        });
        break;
      case "PUT":
        result = await writeAssistantDeliveryRecord(input.effectsPort, input.record);
        break;
    }

    return result;
  } catch (error) {
    input.journalTrace.lastMethod = input.method;
    input.journalTrace.lastStatus = readHostedAssistantDeliveryJournalStatus(error);
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: buildHostedAssistantDeliveryDetails({
        effectFingerprint: sideEffect.fingerprint,
        effectId: sideEffect.effectId,
        extra: {
          failureDomain: "journal",
          journalMethod: input.method,
          retryable: true,
        },
        userId: input.userId,
      }),
      error,
      level: "warn",
      message: `Hosted assistant delivery journal ${input.method} failed.`,
      phase: "side-effects.draining",
      userId: input.userId,
    });
    throw createHostedAssistantDeliveryJournalError(
      input,
      readHostedAssistantDeliveryJournalStatus(error),
      error,
    );
  }
}

async function readAssistantDeliveryRecord(
  effectsPort: HostedRuntimeEffectsPort,
  input: Pick<HostedAssistantDeliveryEffect, "effectId" | "fingerprint">,
): Promise<HostedAssistantDeliveryRecord | null> {
  return await effectsPort.readAssistantDeliveryRecord(input);
}

async function writeAssistantDeliveryRecord(
  effectsPort: HostedRuntimeEffectsPort,
  record: HostedAssistantDeliveryRecord,
): Promise<HostedAssistantDeliveryRecord> {
  return await effectsPort.writeAssistantDeliveryRecord(record);
}

function createHostedAssistantDeliveryJournalError(
  input:
    | {
        method: "GET";
        sideEffect: HostedAssistantDeliveryEffect;
        userId: string;
      }
    | {
        method: "PUT";
        record: HostedAssistantDeliveryRecord;
        userId: string;
      },
  status: number | null,
  cause?: unknown,
): Error & {
  code: string;
  context: {
    retryable: true;
    status: number | null;
  };
  details: Record<string, boolean | null | string>;
  retryable: true;
} {
  const effectId = input.method === "PUT" ? input.record.effectId : input.sideEffect.effectId;
  const causeDetail = cause ? normalizeAssistantDeliveryError(cause).message : null;
  const error = new Error(
    [
      status === null
        ? `Hosted runner side-effect journal ${input.method} failed for ${input.userId}/${effectId}.`
        : `Hosted runner side-effect journal ${input.method} failed for ${input.userId}/${effectId} with HTTP ${status}.`,
      causeDetail && !causeDetail.startsWith("Hosted runner side-effect journal")
        ? causeDetail
        : null,
    ].filter((part) => typeof part === "string" && part.length > 0).join(" "),
  ) as Error & {
    code: string;
    context: {
      retryable: true;
      status: number | null;
    };
    cause?: unknown;
    details: Record<string, boolean | null | string>;
    retryable: true;
  };

  error.code = "HOSTED_SIDE_EFFECT_JOURNAL_FAILED";
  error.context = {
    retryable: true,
    status,
  };
  error.details = buildHostedAssistantDeliveryDetails({
    effectId,
    extra: {
      failureDomain: "journal",
      journalMethod: input.method,
      retryable: true,
      status: status === null ? null : String(status),
    },
    userId: input.userId,
  });
  error.retryable = true;
  if (cause !== undefined) {
    error.cause = cause;
  }
  return error;
}

function readHostedAssistantDeliveryJournalStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  if ("status" in error && typeof error.status === "number") {
    return error.status;
  }

  if ("statusCode" in error && typeof error.statusCode === "number") {
    return error.statusCode;
  }

  if ("cause" in error) {
    return readHostedAssistantDeliveryJournalStatus(error.cause);
  }

  return null;
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
  journalTrace: HostedAssistantDeliveryJournalTrace;
  retryable: boolean;
}): HostedAssistantDeliveryOutcome {
  return {
    deliveryChannel: input.delivery?.channel ?? null,
    deliveryErrorCode: input.deliveryErrorCode ?? null,
    deliveryErrorMessage: input.deliveryErrorMessage ?? null,
    deliveryStatus: input.deliveryStatus,
    effectFingerprint: input.effect.fingerprint,
    effectId: input.effect.effectId,
    journalMethod: input.journalTrace.lastMethod,
    journalStatus: input.journalTrace.lastStatus === null ? null : String(input.journalTrace.lastStatus),
    providerMessageId: input.delivery?.providerMessageId ?? null,
    providerThreadId: input.delivery?.providerThreadId ?? null,
    retryable: input.retryable,
    target: input.delivery?.target ?? null,
    targetKind: input.delivery?.targetKind ?? null,
  };
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

function readStringProperty(error: unknown, property: string): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  if (!(property in error) || typeof error[property as keyof typeof error] !== "string") {
    return null;
  }

  return error[property as keyof typeof error] as string;
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
