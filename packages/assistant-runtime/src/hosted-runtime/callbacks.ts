import {
  buildHostedAssistantDeliveryPreparedRecord,
  buildHostedAssistantDeliverySentRecord,
  buildHostedAssistantDeliverySideEffect,
  parseHostedExecutionSideEffects,
  type HostedExecutionDispatchRequest,
  type HostedExecutionRunnerResult,
  type HostedExecutionSideEffect,
  type HostedExecutionSideEffectRecord,
} from "@murphai/hosted-execution";
import type { GatewayProjectionSnapshot } from "@murphai/gateway-core";
import {
  dispatchAssistantOutboxIntent,
  listAssistantOutboxIntents,
  normalizeAssistantDeliveryError,
  shouldDispatchAssistantOutboxIntent,
  type AssistantChannelDelivery,
  type AssistantOutboxDispatchHooks,
  type AssistantOutboxIntent,
} from "@murphai/assistant-engine";

import type {
  HostedCommittedExecutionState,
  HostedExecutionCommitCallback,
  HostedAssistantRuntimeJobRequest,
} from "./models.ts";
import type {
  HostedRuntimeEffectsPort,
} from "./platform.ts";

const HOSTED_MAX_COMMITTED_SIDE_EFFECTS = 20;

export function resumeHostedCommittedExecution(
  request: HostedAssistantRuntimeJobRequest,
): HostedCommittedExecutionState {
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
    committedSideEffects: parseHostedExecutionSideEffects(
      request.resume!.committedResult.sideEffects,
    ),
  };
}

export async function commitHostedExecutionResult(input: {
  commit: HostedExecutionCommitCallback | null;
  dispatch: HostedExecutionDispatchRequest;
  effectsPort: HostedRuntimeEffectsPort;
  gatewayProjectionSnapshot?: GatewayProjectionSnapshot | null;
  result: HostedExecutionRunnerResult;
  sideEffects: HostedExecutionSideEffect[];
}): Promise<void> {
  if (!input.commit) {
    return;
  }

  try {
    await input.effectsPort.commit({
      eventId: input.dispatch.eventId,
      payload: {
        currentBundleRef: input.commit.bundleRef,
        gatewayProjectionSnapshot: input.gatewayProjectionSnapshot ?? null,
        ...input.result,
        sideEffects: input.sideEffects,
      },
    });
  } catch (error) {
    throw new Error(
      `Hosted runner durable commit failed for ${input.dispatch.event.userId}/${input.dispatch.eventId}.`,
      { cause: error },
    );
  }
}

export async function collectHostedExecutionSideEffects(
  vaultRoot: string,
): Promise<HostedExecutionSideEffect[]> {
  const now = new Date();
  const intents = await listAssistantOutboxIntents(vaultRoot);

  return intents
    .filter((intent: Awaited<ReturnType<typeof listAssistantOutboxIntents>>[number]) =>
      shouldDispatchAssistantOutboxIntent(intent, now),
    )
    .slice(0, HOSTED_MAX_COMMITTED_SIDE_EFFECTS)
    .map((intent: Awaited<ReturnType<typeof listAssistantOutboxIntents>>[number]) =>
      buildHostedAssistantDeliverySideEffect({
        dedupeKey: intent.dedupeKey,
        intentId: intent.intentId,
      }),
    );
}

export async function drainHostedCommittedSideEffectsAfterCommit(input: {
  commit: HostedExecutionCommitCallback | null;
  dispatch: HostedExecutionDispatchRequest;
  effectsPort: HostedRuntimeEffectsPort;
  sideEffects: HostedExecutionSideEffect[];
  vaultRoot: string;
}): Promise<void> {
  for (const sideEffect of input.sideEffects) {
    await dispatchHostedCommittedSideEffect({
      commit: input.commit,
      effectsPort: input.effectsPort,
      sideEffect,
      userId: input.dispatch.event.userId,
      vaultRoot: input.vaultRoot,
    });
  }
}

async function dispatchHostedCommittedSideEffect(input: {
  commit: HostedExecutionCommitCallback;
  effectsPort: HostedRuntimeEffectsPort;
  sideEffect: HostedExecutionSideEffect;
  userId: string;
  vaultRoot: string;
} | {
  commit: null;
  effectsPort: HostedRuntimeEffectsPort;
  sideEffect: HostedExecutionSideEffect;
  userId: string;
  vaultRoot: string;
}): Promise<void> {
  await dispatchAssistantOutboxIntent({
    dependencies: {
      sendEmail: (request) => input.effectsPort.sendEmail(request),
    },
    dispatchHooks: input.commit
      ? createHostedAssistantDeliveryDispatchHooks({
          commit: input.commit,
          effectsPort: input.effectsPort,
          userId: input.userId,
        })
      : undefined,
    intentId: input.sideEffect.intentId,
    vault: input.vaultRoot,
  });
}

function createHostedAssistantDeliveryDispatchHooks(input: {
  commit: HostedExecutionCommitCallback;
  effectsPort: HostedRuntimeEffectsPort;
  userId: string;
}): AssistantOutboxDispatchHooks {
  return {
    clearPreparedIntent: async ({ intent }: {
      intent: AssistantOutboxIntent;
      vault: string;
    }) => {
      await callHostedRunnerSideEffectJournal({
        commit: input.commit,
        effectsPort: input.effectsPort,
        method: "DELETE",
        sideEffect: buildHostedAssistantDeliverySideEffect({
          dedupeKey: intent.dedupeKey,
          intentId: intent.intentId,
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
        commit: input.commit,
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
      await callHostedRunnerSideEffectJournal({
        commit: input.commit,
        effectsPort: input.effectsPort,
        method: "PUT",
        record: buildHostedAssistantDeliveryPreparedRecord({
          dedupeKey: intent.dedupeKey,
          intentId: intent.intentId,
          recordedAt: intent.lastAttemptAt ?? new Date().toISOString(),
        }),
        userId: input.userId,
      });
    },
    resolveDeliveredIntent: async ({ intent }: {
      intent: AssistantOutboxIntent;
      vault: string;
    }) => {
      const sideEffect = buildHostedAssistantDeliverySideEffect({
        dedupeKey: intent.dedupeKey,
        intentId: intent.intentId,
      });
      const record = await callHostedRunnerSideEffectJournal({
        commit: input.commit,
        effectsPort: input.effectsPort,
        method: "GET",
        sideEffect,
        userId: input.userId,
      });

      if (record?.kind !== "assistant.delivery") {
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
        throw createHostedAssistantDeliveryConfirmationPendingError({
          effectId: intent.intentId,
          userId: input.userId,
        });
      }

      try {
        await persistHostedAssistantDeliveryRecord({
          commit: input.commit,
          delivery: localDelivery,
          effectsPort: input.effectsPort,
          intent,
          userId: input.userId,
        });
      } catch (error) {
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
  commit: HostedExecutionCommitCallback;
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

  await callHostedRunnerSideEffectJournal({
    commit: input.commit,
    effectsPort: input.effectsPort,
    method: "PUT",
    record: buildHostedAssistantDeliverySentRecord({
      dedupeKey: input.intent.dedupeKey,
      delivery: {
        ...input.delivery,
        idempotencyKey: input.delivery.idempotencyKey,
      },
      intentId: input.intent.intentId,
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

async function callHostedRunnerSideEffectJournal(input:
  | {
      commit: HostedExecutionCommitCallback;
      effectsPort: HostedRuntimeEffectsPort;
      method: "DELETE" | "GET";
      sideEffect: HostedExecutionSideEffect;
      userId: string;
    }
  | {
      commit: HostedExecutionCommitCallback;
      effectsPort: HostedRuntimeEffectsPort;
      method: "PUT";
      record: HostedExecutionSideEffectRecord;
      userId: string;
    }): Promise<HostedExecutionSideEffectRecord | null> {
  const sideEffect = input.method === "PUT"
    ? buildHostedAssistantDeliverySideEffect({
        dedupeKey: input.record.fingerprint,
        intentId: input.record.intentId,
      })
    : input.sideEffect;
  try {
    switch (input.method) {
      case "DELETE":
        await input.effectsPort.deletePreparedSideEffect({
          effectId: sideEffect.effectId,
          fingerprint: sideEffect.fingerprint,
          kind: sideEffect.kind,
        });
        return null;
      case "GET":
        return await input.effectsPort.readSideEffect({
          effectId: sideEffect.effectId,
          fingerprint: sideEffect.fingerprint,
          kind: sideEffect.kind,
        });
      case "PUT":
        return await input.effectsPort.writeSideEffect(input.record);
    }
  } catch (error) {
    throw createHostedRunnerSideEffectJournalError(input, null, error);
  }
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
    deliveryMayHaveSucceeded: true;
    retryable: true;
  };

  error.code = "ASSISTANT_DELIVERY_CONFIRMATION_PENDING";
  error.context = {
    retryable: true,
    status: null,
  };
  error.deliveryMayHaveSucceeded = true;
  error.retryable = true;
  if (input.cause !== undefined) {
    error.cause = input.cause;
  }
  return error;
}

function createHostedRunnerSideEffectJournalError(
  input:
    | {
        method: "DELETE" | "GET";
        sideEffect: HostedExecutionSideEffect;
        userId: string;
      }
    | {
        method: "PUT";
        record: HostedExecutionSideEffectRecord;
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
  retryable: true;
} {
  const effectId = input.method === "PUT" ? input.record.effectId : input.sideEffect.effectId;
  const error = new Error(
    status === null
      ? `Hosted runner side-effect journal ${input.method} failed for ${input.userId}/${effectId}.`
      : `Hosted runner side-effect journal ${input.method} failed for ${input.userId}/${effectId} with HTTP ${status}.`,
  ) as Error & {
    code: string;
    context: {
      retryable: true;
      status: number | null;
    };
    cause?: unknown;
    retryable: true;
  };

  error.code = "HOSTED_SIDE_EFFECT_JOURNAL_FAILED";
  error.context = {
    retryable: true,
    status,
  };
  error.retryable = true;
  if (cause !== undefined) {
    error.cause = cause;
  }
  return error;
}
