import {
  buildHostedAssistantDeliveryPreparedRecord,
  buildHostedAssistantDeliverySentRecord,
  buildHostedAssistantDeliverySideEffect,
  buildHostedExecutionRunnerCommitPath,
  buildHostedExecutionRunnerFinalizePath,
  buildHostedExecutionRunnerSideEffectPath,
  parseHostedExecutionSideEffects,
  type HostedExecutionDispatchRequest,
  type HostedExecutionRunnerResult,
  type HostedExecutionSideEffect,
  type HostedExecutionSideEffectRecord,
} from "@murphai/hosted-execution";
import type { GatewayProjectionSnapshot } from "@murphai/gateway-core";
import {
  createHostedEmailChannelDependencies,
} from "../hosted-email.ts";
import {
  dispatchAssistantOutboxIntent,
  listAssistantOutboxIntents,
  shouldDispatchAssistantOutboxIntent,
  type AssistantChannelDelivery,
  type AssistantOutboxDispatchHooks,
  type AssistantOutboxIntent,
} from "@murphai/assistant-core";
import { normalizeAssistantDeliveryError } from "@murphai/assistant-core/assistant-outbox";

import type {
  HostedCommittedExecutionState,
  HostedExecutionCommitCallback,
  HostedAssistantRuntimeJobRequest,
} from "./models.ts";
import { readHostedRunnerCommitTimeoutMs } from "./timeouts.ts";

export { readHostedRunnerCommitTimeoutMs } from "./timeouts.ts";

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
  fetchImpl?: typeof fetch;
  gatewayProjectionSnapshot?: GatewayProjectionSnapshot | null;
  result: HostedExecutionRunnerResult;
  sideEffects: HostedExecutionSideEffect[];
  runtime: {
    resultsBaseUrl: string;
    commitTimeoutMs: number | null;
  };
}): Promise<void> {
  if (!input.commit) {
    return;
  }

  const response = await (input.fetchImpl ?? fetch)(
    buildHostedRunnerCommitUrl(
      input.runtime.resultsBaseUrl,
      input.dispatch.eventId,
      "commit",
    ).toString(),
    {
      body: JSON.stringify({
        currentBundleRef: input.commit.bundleRef,
        gatewayProjectionSnapshot: input.gatewayProjectionSnapshot ?? null,
        ...input.result,
        sideEffects: input.sideEffects,
      }),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
      signal: AbortSignal.timeout(readHostedRunnerCommitTimeoutMs(input.runtime.commitTimeoutMs)),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Hosted runner durable commit failed for ${input.dispatch.event.userId}/${input.dispatch.eventId} with HTTP ${response.status}.`,
    );
  }
}

export async function finalizeHostedExecutionResult(input: {
  commit: HostedExecutionCommitCallback | null;
  committedResult: HostedExecutionRunnerResult;
  dispatch: HostedExecutionDispatchRequest;
  fetchImpl?: typeof fetch;
  finalGatewayProjectionSnapshot?: GatewayProjectionSnapshot | null;
  finalResult: HostedExecutionRunnerResult;
  runtime: {
    resultsBaseUrl: string;
    commitTimeoutMs: number | null;
  };
}): Promise<void> {
  if (!input.commit || sameHostedExecutionBundles(input.committedResult, input.finalResult)) {
    return;
  }

  const response = await (input.fetchImpl ?? fetch)(
    buildHostedRunnerCommitUrl(
      input.runtime.resultsBaseUrl,
      input.dispatch.eventId,
      "finalize",
    ).toString(),
    {
      body: JSON.stringify({
        bundle: input.finalResult.bundle,
        gatewayProjectionSnapshot: input.finalGatewayProjectionSnapshot ?? null,
      }),
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      method: "POST",
      signal: AbortSignal.timeout(readHostedRunnerCommitTimeoutMs(input.runtime.commitTimeoutMs)),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Hosted runner durable finalize failed for ${input.dispatch.event.userId}/${input.dispatch.eventId} with HTTP ${response.status}.`,
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
  commitTimeoutMs: number | null;
  dispatch: HostedExecutionDispatchRequest;
  fetchImpl?: typeof fetch;
  resultsBaseUrl: string;
  sideEffects: HostedExecutionSideEffect[];
  vaultRoot: string;
}): Promise<void> {
  for (const sideEffect of input.sideEffects) {
    await dispatchHostedCommittedSideEffect({
      commit: input.commit,
      commitTimeoutMs: input.commitTimeoutMs,
      fetchImpl: input.fetchImpl,
      resultsBaseUrl: input.resultsBaseUrl,
      sideEffect,
      userId: input.dispatch.event.userId,
      vaultRoot: input.vaultRoot,
    });
  }
}

async function dispatchHostedCommittedSideEffect(input: {
  commit: HostedExecutionCommitCallback;
  commitTimeoutMs: number | null;
  fetchImpl?: typeof fetch;
  resultsBaseUrl: string;
  sideEffect: HostedExecutionSideEffect;
  userId: string;
  vaultRoot: string;
} | {
  commit: null;
  commitTimeoutMs: number | null;
  fetchImpl?: typeof fetch;
  resultsBaseUrl: string;
  sideEffect: HostedExecutionSideEffect;
  userId: string;
  vaultRoot: string;
}): Promise<void> {
  await dispatchAssistantOutboxIntent({
    dependencies: createHostedEmailChannelDependencies({
      resultsBaseUrl: input.resultsBaseUrl,
      fetchImpl: input.fetchImpl,
      timeoutMs: input.commitTimeoutMs,
    }),
    dispatchHooks: input.commit
      ? createHostedAssistantDeliveryDispatchHooks({
          commit: input.commit,
          commitTimeoutMs: input.commitTimeoutMs,
          fetchImpl: input.fetchImpl,
          resultsBaseUrl: input.resultsBaseUrl,
          userId: input.userId,
        })
      : undefined,
    intentId: input.sideEffect.intentId,
    vault: input.vaultRoot,
  });
}

function createHostedAssistantDeliveryDispatchHooks(input: {
  commit: HostedExecutionCommitCallback;
  commitTimeoutMs: number | null;
  fetchImpl?: typeof fetch;
  resultsBaseUrl: string;
  userId: string;
}): AssistantOutboxDispatchHooks {
  return {
    clearPreparedIntent: async ({ intent }: {
      intent: AssistantOutboxIntent;
      vault: string;
    }) => {
      await callHostedRunnerSideEffectJournal({
        commit: input.commit,
        commitTimeoutMs: input.commitTimeoutMs,
        fetchImpl: input.fetchImpl,
        method: "DELETE",
        sideEffect: buildHostedAssistantDeliverySideEffect({
          dedupeKey: intent.dedupeKey,
          intentId: intent.intentId,
        }),
        resultsBaseUrl: input.resultsBaseUrl,
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
        commitTimeoutMs: input.commitTimeoutMs,
        delivery,
        fetchImpl: input.fetchImpl,
        intent,
        resultsBaseUrl: input.resultsBaseUrl,
        userId: input.userId,
      });
    },
    prepareDispatchIntent: async ({ intent }: {
      intent: AssistantOutboxIntent;
      vault: string;
    }) => {
      await callHostedRunnerSideEffectJournal({
        commit: input.commit,
        commitTimeoutMs: input.commitTimeoutMs,
        fetchImpl: input.fetchImpl,
        method: "PUT",
        record: buildHostedAssistantDeliveryPreparedRecord({
          dedupeKey: intent.dedupeKey,
          intentId: intent.intentId,
          recordedAt: intent.lastAttemptAt ?? new Date().toISOString(),
        }),
        resultsBaseUrl: input.resultsBaseUrl,
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
        commitTimeoutMs: input.commitTimeoutMs,
        fetchImpl: input.fetchImpl,
        method: "GET",
        sideEffect,
        resultsBaseUrl: input.resultsBaseUrl,
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
          commitTimeoutMs: input.commitTimeoutMs,
          delivery: localDelivery,
          fetchImpl: input.fetchImpl,
          intent,
          resultsBaseUrl: input.resultsBaseUrl,
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
  commitTimeoutMs: number | null;
  delivery: AssistantChannelDelivery;
  fetchImpl?: typeof fetch;
  intent: Pick<AssistantOutboxIntent, "dedupeKey" | "intentId">;
  resultsBaseUrl: string;
  userId: string;
}): Promise<void> {
  if (!input.delivery.idempotencyKey) {
    throw new Error(
      "Hosted assistant delivery side effects require a non-empty idempotencyKey.",
    );
  }

  await callHostedRunnerSideEffectJournal({
    commit: input.commit,
    commitTimeoutMs: input.commitTimeoutMs,
    fetchImpl: input.fetchImpl,
    method: "PUT",
    record: buildHostedAssistantDeliverySentRecord({
      dedupeKey: input.intent.dedupeKey,
      delivery: {
        ...input.delivery,
        idempotencyKey: input.delivery.idempotencyKey,
      },
      intentId: input.intent.intentId,
    }),
    resultsBaseUrl: input.resultsBaseUrl,
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
      commitTimeoutMs: number | null;
      fetchImpl?: typeof fetch;
      method: "DELETE" | "GET";
      sideEffect: HostedExecutionSideEffect;
      resultsBaseUrl: string;
      userId: string;
    }
  | {
      commit: HostedExecutionCommitCallback;
      commitTimeoutMs: number | null;
      fetchImpl?: typeof fetch;
      method: "PUT";
      record: HostedExecutionSideEffectRecord;
      resultsBaseUrl: string;
      userId: string;
    }): Promise<HostedExecutionSideEffectRecord | null> {
  const sideEffect = input.method === "PUT"
    ? buildHostedAssistantDeliverySideEffect({
        dedupeKey: input.record.fingerprint,
        intentId: input.record.intentId,
      })
    : input.sideEffect;
  const url = buildHostedRunnerSideEffectUrl(input.resultsBaseUrl, sideEffect.effectId);
  url.searchParams.set("fingerprint", sideEffect.fingerprint);
  url.searchParams.set("kind", sideEffect.kind);

  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(url.toString(), {
      body: input.method === "PUT" ? JSON.stringify(input.record) : undefined,
      headers: {
        ...(input.method === "PUT"
          ? {
              "content-type": "application/json; charset=utf-8",
            }
          : {}),
      },
      method: input.method,
      signal: AbortSignal.timeout(readHostedRunnerCommitTimeoutMs(input.commitTimeoutMs)),
    });
  } catch (error) {
    throw createHostedRunnerSideEffectJournalError(input, null, error);
  }

  if (!response.ok) {
    throw createHostedRunnerSideEffectJournalError(input, response.status);
  }

  if (input.method === "DELETE") {
    return null;
  }

  const payload = (await response.json()) as {
    effectId: string;
    record: HostedExecutionSideEffectRecord | null;
  };

  return payload.record;
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

function buildHostedRunnerCommitUrl(
  baseUrl: string,
  eventId: string,
  action: "commit" | "finalize",
): URL {
  return new URL(
    action === "commit"
      ? buildHostedExecutionRunnerCommitPath(eventId)
      : buildHostedExecutionRunnerFinalizePath(eventId),
    baseUrl,
  );
}

function buildHostedRunnerSideEffectUrl(baseUrl: string, effectId: string): URL {
  return new URL(buildHostedExecutionRunnerSideEffectPath(effectId), baseUrl);
}

function sameHostedExecutionBundles(
  left: HostedExecutionRunnerResult,
  right: HostedExecutionRunnerResult,
): boolean {
  return left.bundle === right.bundle;
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
