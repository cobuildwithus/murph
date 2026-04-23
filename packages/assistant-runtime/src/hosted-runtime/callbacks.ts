import type {
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  buildHostedAssistantDeliveryEffect,
  parseHostedAssistantDeliveryEffects,
  type HostedAssistantDeliveryPayload,
  type HostedAssistantDeliveryEffect,
} from "@murphai/hosted-execution/side-effects";
import {
  createAssistantDeliveryAmbiguousError,
  dispatchAssistantOutboxIntent,
  listAssistantOutboxIntents,
  markAssistantOutboxIntentMirrorTerminalById,
  normalizeAssistantDeliveryError,
  readAssistantOutboxIntentMirrorState,
  shouldDispatchAssistantOutboxIntent,
  type AssistantChannelDelivery,
} from "@murphai/assistant-engine";
import type {
  AssistantOutboxIntent,
} from "@murphai/operator-config/assistant-cli-contracts";
import {
  assistantChannelDeliverySchema,
} from "@murphai/operator-config/assistant-cli-contracts";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";

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
  effectsPort: HostedRuntimeEffectsPort;
  assistantDeliveryEffects: HostedAssistantDeliveryEffect[];
  vaultRoot: string;
  wake: HostedRuntimeEvent;
}): Promise<HostedAssistantDeliveryOutcome[]> {
  const outcomes: HostedAssistantDeliveryOutcome[] = [];
  for (const assistantDeliveryEffect of input.assistantDeliveryEffects) {
    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: buildHostedAssistantDeliveryDetails({
        effectFingerprint: assistantDeliveryEffect.fingerprint,
        effectId: assistantDeliveryEffect.effectId,
        userId: input.wake.userId,
      }),
      wake: input.wake,
      message: "Hosted assistant delivery starting.",
      phase: "side-effects.draining",
      userId: input.wake.userId,
    });
    outcomes.push(await deliverHostedCommittedAssistantDelivery({
      wake: input.wake,
      effectsPort: input.effectsPort,
      assistantDeliveryEffect,
      userId: input.wake.userId,
      vaultRoot: input.vaultRoot,
    }));
  }

  return outcomes;
}

async function deliverHostedCommittedAssistantDelivery(input: {
  wake: HostedRuntimeEvent;
  effectsPort: HostedRuntimeEffectsPort;
  assistantDeliveryEffect: HostedAssistantDeliveryEffect;
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
  try {
    const mirrorOutcome = await maybeResolveHostedAssistantDeliveryFromMirror({
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

          return await input.effectsPort.sendEmail({
            identityId: request.identityId ?? null,
            message: request.message,
            subject: request.subject ?? null,
            target: request.target,
            targetKind: request.targetKind,
          });
        },
      },
      intentId: input.assistantDeliveryEffect.effectId,
      now,
      vault: input.vaultRoot,
    });
    return await buildHostedAssistantDeliveryDispatchResult({
      assistantDeliveryEffect: input.assistantDeliveryEffect,
      dispatchResult: dispatched,
      userId: input.userId,
      vaultRoot: input.vaultRoot,
      wake: input.wake,
    });
  } catch (error) {
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
      message: "Hosted assistant delivery threw during post-commit delivery.",
      phase: "side-effects.draining",
      userId: input.userId,
    });
    throw enrichedError;
  }
}

async function maybeResolveHostedAssistantDeliveryFromMirror(input: {
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
      const ambiguousError = createAssistantDeliveryAmbiguousError(
        intent.lastError ?? {
          code: "ASSISTANT_DELIVERY_AMBIGUOUS",
          message: "The assistant outbox mirror recorded an abandoned delivery attempt.",
        },
      );
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

      if (isHostedDeliveryTransportIdempotent(input.assistantDeliveryEffect)) {
        return null;
      }

      const ambiguousError = createAssistantDeliveryAmbiguousError(
        intent.lastError ?? {
          code: "ASSISTANT_DELIVERY_AMBIGUOUS",
          message:
            "The assistant outbox mirror remained in sending state past the confirmation grace window.",
        },
      );
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
        wake: input.wake,
        effect: input.assistantDeliveryEffect,
        retryable: false,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: ambiguousError.code,
        deliveryErrorMessage: ambiguousError.message,
        deliveryStatus: "failed_ambiguous",
        effect: input.assistantDeliveryEffect,
        retryable: false,
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
        deliveryStatus: "sent",
        failureDomain: "delivery",
        retryable: false,
        targetKind: input.delivery.targetKind,
      },
      userId: input.userId,
    }),
    wake: input.wake,
    message: "Hosted assistant delivery sent successfully during post-commit delivery.",
    phase: "side-effects.draining",
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
        deliveryStatus: input.deliveryStatus,
        failureDomain: "delivery",
        retryable: input.retryable,
      },
      userId: input.userId,
    }),
    wake: input.wake,
    level: input.retryable ? "warn" : "error",
    message: `Hosted assistant delivery finished with ${input.deliveryStatus} status during post-commit delivery.`,
    phase: "side-effects.draining",
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

  if (
    dispatchResult.intent.status === "retryable"
    && !isHostedDeliveryTransportIdempotent(assistantDeliveryEffect)
    && dispatchResult.intent.lastError?.code === "ASSISTANT_DELIVERY_CONFIRMATION_PENDING"
  ) {
    const ambiguousError = createAssistantDeliveryAmbiguousError(
      dispatchResult.deliveryError ?? dispatchResult.intent.lastError,
    );
    await syncHostedAssistantDeliveryTerminalMirror({
      effect: assistantDeliveryEffect,
      error: ambiguousError,
      status: "abandoned",
      userId: input.userId,
      vaultRoot: input.vaultRoot,
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
      const ambiguousError = createAssistantDeliveryAmbiguousError(dispatchResult.intent.lastError);
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
    | "deliveryTransportIdempotent"
    | "explicitTarget"
    | "identityId"
    | "intentId"
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
    explicitTarget: intent.explicitTarget ?? null,
    idempotencyKey: intent.deliveryIdempotencyKey ?? `assistant-outbox:${intent.intentId}`,
    identityId: intent.identityId ?? null,
    message: intent.message,
    subject: intent.subject ?? null,
    replyToMessageId: intent.replyToMessageId ?? null,
    sessionId: intent.sessionId,
    threadId: intent.threadId ?? null,
    threadIsDirect: intent.threadIsDirect ?? null,
    transportIdempotent: intent.deliveryTransportIdempotent || intent.channel === "linq",
    turnId: intent.turnId,
  };

  assertSupportedHostedAssistantDeliveryPayload(payload);
  return payload;
}

function isHostedDeliveryTransportIdempotent(
  effect: Pick<HostedAssistantDeliveryEffect, "payload">,
): boolean {
  return effect.payload.transportIdempotent;
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
  return {
    deliveryChannel: input.delivery?.channel ?? null,
    deliveryErrorCode: input.deliveryErrorCode ?? null,
    deliveryErrorMessage: input.deliveryErrorMessage ?? null,
    deliveryStatus: input.deliveryStatus,
    effectFingerprint: input.effect.fingerprint,
    effectId: input.effect.effectId,
    journalMethod: null,
    journalStatus: null,
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
