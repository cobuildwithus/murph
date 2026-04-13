import type {
  HostedExecutionDispatchRequest,
} from "@murphai/hosted-execution/contracts";
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
} from "./models.ts";
import type {
  HostedRuntimeEffectsPort,
} from "./platform.ts";

const HOSTED_MAX_COMMITTED_ASSISTANT_DELIVERY_EFFECTS = 20;

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
}): Promise<void> {
  for (const assistantDeliveryEffect of input.assistantDeliveryEffects) {
    await dispatchHostedCommittedAssistantDelivery({
      effectsPort: input.effectsPort,
      assistantDeliveryEffect,
      userId: input.dispatch.event.userId,
      vaultRoot: input.vaultRoot,
    });
  }
}

async function dispatchHostedCommittedAssistantDelivery(input: {
  effectsPort: HostedRuntimeEffectsPort;
  assistantDeliveryEffect: HostedAssistantDeliveryEffect;
  userId: string;
  vaultRoot: string;
}): Promise<void> {
  await dispatchAssistantOutboxIntent({
    dependencies: {
      sendEmail: (request: Parameters<HostedRuntimeEffectsPort["sendEmail"]>[0]) =>
        input.effectsPort.sendEmail(request),
    },
    dispatchHooks: createHostedAssistantDeliveryDispatchHooks({
      effectsPort: input.effectsPort,
      userId: input.userId,
    }),
    intentId: input.assistantDeliveryEffect.effectId,
    vault: input.vaultRoot,
  });
}

function createHostedAssistantDeliveryDispatchHooks(input: {
  effectsPort: HostedRuntimeEffectsPort;
  userId: string;
}): AssistantOutboxDispatchHooks {
  return {
    clearPreparedIntent: async ({ intent }: {
      intent: AssistantOutboxIntent;
      vault: string;
    }) => {
      await callHostedAssistantDeliveryJournal({
        effectsPort: input.effectsPort,
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
      method: "DELETE" | "GET";
      sideEffect: HostedAssistantDeliveryEffect;
      userId: string;
    }
  | {
      effectsPort: HostedRuntimeEffectsPort;
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
    switch (input.method) {
      case "DELETE":
        await deletePreparedAssistantDelivery(input.effectsPort, {
          effectId: sideEffect.effectId,
          fingerprint: sideEffect.fingerprint,
        });
        return null;
      case "GET":
        return await readAssistantDeliveryRecord(input.effectsPort, {
          effectId: sideEffect.effectId,
          fingerprint: sideEffect.fingerprint,
        });
      case "PUT":
        return await writeAssistantDeliveryRecord(input.effectsPort, input.record);
    }
  } catch (error) {
    throw createHostedAssistantDeliveryJournalError(input, null, error);
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
