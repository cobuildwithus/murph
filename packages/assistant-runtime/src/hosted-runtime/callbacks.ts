import type {
  HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution/contracts";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  buildHostedAssistantDeliveryEffect,
  buildHostedAssistantDeliveryPreparedRecord,
  buildHostedAssistantDeliverySentRecord,
  parseHostedAssistantDeliveryEffects,
  type HostedAssistantDeliveryRecord,
  type HostedAssistantDeliveryEffect,
} from "@murphai/hosted-execution/side-effects";
import {
  dispatchAssistantOutboxIntent,
  listAssistantOutboxIntents,
  normalizeAssistantDeliveryError,
  shouldDispatchAssistantOutboxIntent,
  type AssistantChannelDelivery,
  type AssistantOutboxDispatchHooks,
} from "@murphai/assistant-engine";
import type { AssistantOutboxIntent } from "@murphai/operator-config/assistant-cli-contracts";

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
  try {
    const dispatched = await dispatchAssistantOutboxIntent({
      dependencies: {
        sendEmail: (request: Parameters<HostedRuntimeEffectsPort["sendEmail"]>[0]) =>
          input.effectsPort.sendEmail(request),
      },
      dispatchHooks: createHostedAssistantDeliveryDispatchHooks({
        effectsPort: input.effectsPort,
        journalTrace,
        userId: input.userId,
      }),
      intentId: input.assistantDeliveryEffect.effectId,
      vault: input.vaultRoot,
    });

    if (!dispatched || typeof dispatched !== "object" || !("intent" in dispatched)) {
      emitHostedExecutionStructuredLog({
        component: "assistant-delivery",
        details: buildHostedAssistantDeliveryDetails({
          effectFingerprint: input.assistantDeliveryEffect.fingerprint,
          effectId: input.assistantDeliveryEffect.effectId,
          extra: {
            deliveryStatus: "missing-result",
            failureDomain: "dispatch",
            retryable: true,
          },
          userId: input.userId,
        }),
        dispatch: input.dispatch,
        level: "warn",
        message: "Hosted assistant delivery dispatch returned no result.",
        phase: "side-effects.draining",
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryStatus: "missing-result",
        effect: input.assistantDeliveryEffect,
        journalTrace,
        retryable: true,
      });
    }

    emitHostedExecutionStructuredLog({
      component: "assistant-delivery",
      details: buildHostedAssistantDeliveryDetails({
        effectFingerprint: input.assistantDeliveryEffect.fingerprint,
        effectId: input.assistantDeliveryEffect.effectId,
        extra: {
          dispatchedIntentStatus: dispatched.intent.status,
          deliveryErrorCode: dispatched.deliveryError?.code ?? null,
          deliveryErrorMessage: dispatched.deliveryError?.message ?? null,
          retryable: dispatched.intent.status === "pending"
            || dispatched.intent.status === "retryable"
            || dispatched.intent.status === "sending",
        },
        userId: input.userId,
      }),
      dispatch: input.dispatch,
      level: dispatched.intent.status === "sent" ? "info" : "warn",
      message: "Hosted assistant delivery dispatch finished.",
      phase: "side-effects.draining",
      userId: input.userId,
    });

    if (dispatched.intent.status === "sent" && dispatched.intent.delivery) {
      emitHostedAssistantDeliveryDispatchSuccess({
        delivery: dispatched.intent.delivery,
        dispatch: input.dispatch,
        effect: input.assistantDeliveryEffect,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        delivery: dispatched.intent.delivery,
        deliveryStatus: "sent",
        effect: input.assistantDeliveryEffect,
        journalTrace,
        retryable: false,
      });
    }

    if (dispatched.intent.status !== "sent") {
      emitHostedAssistantDeliveryDispatchOutcome({
        deliveryError: dispatched.deliveryError,
        dispatch: input.dispatch,
        effect: input.assistantDeliveryEffect,
        intentStatus: dispatched.intent.status,
        userId: input.userId,
      });
      return buildHostedAssistantDeliveryOutcome({
        deliveryErrorCode: dispatched.deliveryError?.code ?? null,
        deliveryErrorMessage: dispatched.deliveryError?.message ?? null,
        deliveryStatus: dispatched.intent.status,
        effect: input.assistantDeliveryEffect,
        journalTrace,
        retryable: dispatched.intent.status === "pending"
          || dispatched.intent.status === "retryable"
          || dispatched.intent.status === "sending",
      });
    }

    return buildHostedAssistantDeliveryOutcome({
      deliveryStatus: "missing-result",
      effect: input.assistantDeliveryEffect,
      journalTrace,
      retryable: true,
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
  dispatch: HostedExecutionDispatchRequest;
  effect: HostedAssistantDeliveryEffect;
  intentStatus: "abandoned" | "failed" | "pending" | "retryable" | "sending";
  userId: string;
}): void {
  const retryable = input.intentStatus === "pending"
    || input.intentStatus === "retryable"
    || input.intentStatus === "sending";
  emitHostedExecutionStructuredLog({
    component: "assistant-delivery",
    details: buildHostedAssistantDeliveryDetails({
      effectFingerprint: input.effect.fingerprint,
      effectId: input.effect.effectId,
      extra: {
        deliveryErrorCode: input.deliveryError?.code ?? null,
        deliveryErrorMessage: input.deliveryError?.message ?? null,
        deliveryStatus: input.intentStatus,
        failureDomain: "dispatch",
        retryable,
      },
      userId: input.userId,
    }),
    dispatch: input.dispatch,
    level: retryable ? "warn" : "error",
    message: `Hosted assistant delivery finished with ${input.intentStatus} status during post-commit dispatch.`,
    phase: "side-effects.draining",
    userId: input.userId,
  });
}

function createHostedAssistantDeliveryDispatchHooks(input: {
  effectsPort: HostedRuntimeEffectsPort;
  journalTrace: HostedAssistantDeliveryJournalTrace;
  userId: string;
}): AssistantOutboxDispatchHooks {
  return {
    clearPreparedIntent: async ({ intent }: {
      intent: AssistantOutboxIntent;
      vault: string;
    }) => {
      await callHostedAssistantDeliveryJournal({
        effectsPort: input.effectsPort,
        journalTrace: input.journalTrace,
        method: "DELETE",
        sideEffect: buildHostedAssistantDeliveryEffect({
          dedupeKey: intent.dedupeKey,
          effectId: intent.intentId,
        }),
        userId: input.userId,
      });
    },
    persistDeliveredIntent: async ({ delivery, intent }: {
      delivery: AssistantChannelDelivery;
      intent: AssistantOutboxIntent;
      vault: string;
    }) => {
      await persistHostedAssistantDeliveryRecord({
        delivery,
        effectsPort: input.effectsPort,
        intent,
        userId: input.userId,
      });
    },
    prepareDispatchIntent: async ({ intent }: {
      intent: AssistantOutboxIntent;
      vault: string;
    }) => {
      await callHostedAssistantDeliveryJournal({
        effectsPort: input.effectsPort,
        journalTrace: input.journalTrace,
        method: "PUT",
        record: buildHostedAssistantDeliveryPreparedRecord({
          dedupeKey: intent.dedupeKey,
          effectId: intent.intentId,
          recordedAt: intent.lastAttemptAt ?? new Date().toISOString(),
        }),
        userId: input.userId,
      });
    },
    resolveDeliveredIntent: async ({ intent }: {
      intent: AssistantOutboxIntent;
      vault: string;
    }) => {
      const sideEffect = buildHostedAssistantDeliveryEffect({
        dedupeKey: intent.dedupeKey,
        effectId: intent.intentId,
      });
      const record = await callHostedAssistantDeliveryJournal({
        effectsPort: input.effectsPort,
        journalTrace: input.journalTrace,
        method: "GET",
        sideEffect,
        userId: input.userId,
      });

      if (!record) {
        return null;
      }

      if (record.state === "sent") {
        return {
          channel: record.delivery.channel,
          idempotencyKey: record.delivery.idempotencyKey,
          messageLength: record.delivery.messageLength,
          providerMessageId: record.delivery.providerMessageId ?? null,
          providerThreadId: record.delivery.providerThreadId ?? null,
          sentAt: record.delivery.sentAt,
          target: record.delivery.target,
          targetKind: record.delivery.targetKind,
        } satisfies AssistantChannelDelivery;
      }

      const localDelivery = readLocallyRecordedAssistantDelivery(intent);
      if (!localDelivery) {
        emitHostedExecutionStructuredLog({
          component: "assistant-delivery",
          details: buildHostedAssistantDeliveryDetails({
            effectId: intent.intentId,
            extra: {
              journalRecordState: record.state,
              localDeliveryPresent: "false",
              retryable: true,
            },
            userId: input.userId,
          }),
          level: "warn",
          message: "Hosted assistant delivery reconciliation found a prepared journal record but no local delivery.",
          phase: "side-effects.draining",
          userId: input.userId,
        });
        throw createHostedAssistantDeliveryConfirmationPendingError({
          effectId: intent.intentId,
          userId: input.userId,
        });
      }

      try {
        await persistHostedAssistantDeliveryRecord({
          delivery: localDelivery,
          effectsPort: input.effectsPort,
          intent,
          userId: input.userId,
        });
      } catch (error) {
        emitHostedExecutionStructuredLog({
          component: "assistant-delivery",
          details: buildHostedAssistantDeliveryDetails({
            effectId: intent.intentId,
            extra: {
              journalRecordState: record.state,
              localDeliveryPresent: "true",
              retryable: true,
            },
            userId: input.userId,
          }),
          error,
          level: "warn",
          message: "Hosted assistant delivery reconciliation could not persist the local send.",
          phase: "side-effects.draining",
          userId: input.userId,
        });
        throw createHostedAssistantDeliveryConfirmationPendingError({
          cause: error,
          effectId: intent.intentId,
          userId: input.userId,
        });
      }

      return localDelivery;
    },
  };
}

async function persistHostedAssistantDeliveryRecord(input: {
  delivery: AssistantChannelDelivery;
  effectsPort: HostedRuntimeEffectsPort;
  intent: Pick<AssistantOutboxIntent, "dedupeKey" | "intentId">;
  userId: string;
}): Promise<void> {
  if (!input.delivery.idempotencyKey) {
    throw new Error(
      "Hosted assistant delivery side effects require a non-empty idempotencyKey.",
    );
  }

  await callHostedAssistantDeliveryJournal({
    effectsPort: input.effectsPort,
    journalTrace: {
      lastMethod: null,
      lastStatus: null,
    },
    method: "PUT",
    record: buildHostedAssistantDeliverySentRecord({
      dedupeKey: input.intent.dedupeKey,
      delivery: {
        ...input.delivery,
        idempotencyKey: input.delivery.idempotencyKey,
      },
      effectId: input.intent.intentId,
    }),
    userId: input.userId,
  });
}

function readLocallyRecordedAssistantDelivery(
  intent: Pick<AssistantOutboxIntent, "delivery" | "deliveryIdempotencyKey">,
): AssistantChannelDelivery | null {
  if (!intent.delivery) {
    return null;
  }

  const idempotencyKey = intent.delivery.idempotencyKey ?? intent.deliveryIdempotencyKey;
  if (!idempotencyKey) {
    return null;
  }

  return {
    ...intent.delivery,
    idempotencyKey,
  };
}

async function callHostedAssistantDeliveryJournal(input:
  | {
      effectsPort: HostedRuntimeEffectsPort;
      journalTrace: HostedAssistantDeliveryJournalTrace;
      method: "DELETE" | "GET";
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
    ? buildHostedAssistantDeliveryEffect({
        dedupeKey: input.record.fingerprint,
        effectId: input.record.effectId,
      })
    : input.sideEffect;
  try {
    input.journalTrace.lastMethod = input.method;
    input.journalTrace.lastStatus = null;

    let result: HostedAssistantDeliveryRecord | null;
    switch (input.method) {
      case "DELETE":
        await deletePreparedAssistantDelivery(input.effectsPort, {
          effectId: sideEffect.effectId,
          fingerprint: sideEffect.fingerprint,
        });
        result = null;
        break;
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

async function deletePreparedAssistantDelivery(
  effectsPort: HostedRuntimeEffectsPort,
  input: Pick<HostedAssistantDeliveryEffect, "effectId" | "fingerprint">,
): Promise<void> {
  await effectsPort.deletePreparedAssistantDelivery(input);
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

function createHostedAssistantDeliveryConfirmationPendingError(input: {
  cause?: unknown;
  effectId: string;
  userId: string;
}): Error & {
  code: string;
  context: {
    retryable: true;
    status: null;
  };
  details: Record<string, boolean | null | string>;
  deliveryMayHaveSucceeded: true;
  retryable: true;
} {
  const detail = input.cause ? normalizeAssistantDeliveryError(input.cause).message : null;
  const error = new Error(
    detail
      ? `Hosted assistant delivery may have succeeded already for ${input.userId}/${input.effectId} and must be reconciled before resend. ${detail}`
      : `Hosted assistant delivery may have succeeded already for ${input.userId}/${input.effectId} and must be reconciled before resend.`,
  ) as Error & {
    code: string;
    context: {
      retryable: true;
      status: null;
    };
    cause?: unknown;
    details: Record<string, boolean | null | string>;
    deliveryMayHaveSucceeded: true;
    retryable: true;
  };

  error.code = "ASSISTANT_DELIVERY_CONFIRMATION_PENDING";
  error.context = {
    retryable: true,
    status: null,
  };
  error.details = buildHostedAssistantDeliveryDetails({
    effectId: input.effectId,
    extra: {
      deliveryMayHaveSucceeded: true,
      failureDomain: "confirmation_pending",
      retryable: true,
    },
    userId: input.userId,
  });
  error.deliveryMayHaveSucceeded = true;
  error.retryable = true;
  if (input.cause !== undefined) {
    error.cause = input.cause;
  }
  return error;
}

function createHostedAssistantDeliveryJournalError(
  input:
    | {
        method: "DELETE" | "GET";
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
