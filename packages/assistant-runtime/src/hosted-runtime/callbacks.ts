import {
  buildHostedAssistantDeliverySideEffect,
  parseHostedExecutionSideEffects,
  type HostedExecutionDispatchRequest,
  type HostedExecutionRunnerResult,
  type HostedExecutionSideEffect,
  type HostedExecutionSideEffectRecord,
} from "@murph/hosted-execution";
import {
  createHostedEmailChannelDependencies,
} from "../hosted-email.ts";
import {
  dispatchAssistantOutboxIntent,
  listAssistantOutboxIntents,
  shouldDispatchAssistantOutboxIntent,
  type AssistantChannelDelivery,
  type AssistantOutboxDispatchHooks,
} from "@murph/assistant-services/outbox";

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
    committedResult: {
      bundles: {
        agentState: request.bundles.agentState,
        vault: request.bundles.vault,
      },
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
  result: HostedExecutionRunnerResult;
  sideEffects: HostedExecutionSideEffect[];
  runtime: {
    commitBaseUrl: string;
    commitTimeoutMs: number | null;
  };
}): Promise<void> {
  if (!input.commit) {
    return;
  }

  const response = await (input.fetchImpl ?? fetch)(
    buildHostedRunnerCommitUrl(
      input.runtime.commitBaseUrl,
      input.dispatch.eventId,
      "commit",
    ).toString(),
    {
      body: JSON.stringify({
        currentBundleRefs: input.commit.bundleRefs,
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
  finalResult: HostedExecutionRunnerResult;
  runtime: {
    commitBaseUrl: string;
    commitTimeoutMs: number | null;
  };
}): Promise<void> {
  if (!input.commit || sameHostedExecutionBundles(input.committedResult, input.finalResult)) {
    return;
  }

  const response = await (input.fetchImpl ?? fetch)(
    buildHostedRunnerCommitUrl(
      input.runtime.commitBaseUrl,
      input.dispatch.eventId,
      "finalize",
    ).toString(),
    {
      body: JSON.stringify({
        bundles: input.finalResult.bundles,
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
  emailBaseUrl: string;
  fetchImpl?: typeof fetch;
  sideEffectsBaseUrl: string;
  sideEffects: HostedExecutionSideEffect[];
  vaultRoot: string;
}): Promise<void> {
  for (const sideEffect of input.sideEffects) {
    await dispatchHostedCommittedSideEffect({
      commit: input.commit,
      commitTimeoutMs: input.commitTimeoutMs,
      emailBaseUrl: input.emailBaseUrl,
      fetchImpl: input.fetchImpl,
      sideEffect,
      sideEffectsBaseUrl: input.sideEffectsBaseUrl,
      userId: input.dispatch.event.userId,
      vaultRoot: input.vaultRoot,
    });
  }
}

async function dispatchHostedCommittedSideEffect(input: {
  commit: HostedExecutionCommitCallback;
  commitTimeoutMs: number | null;
  emailBaseUrl: string;
  fetchImpl?: typeof fetch;
  sideEffect: HostedExecutionSideEffect;
  sideEffectsBaseUrl: string;
  userId: string;
  vaultRoot: string;
} | {
  commit: null;
  commitTimeoutMs: number | null;
  emailBaseUrl: string;
  fetchImpl?: typeof fetch;
  sideEffect: HostedExecutionSideEffect;
  sideEffectsBaseUrl: string;
  userId: string;
  vaultRoot: string;
}): Promise<void> {
  await dispatchAssistantOutboxIntent({
    dependencies: createHostedEmailChannelDependencies({
      emailBaseUrl: input.emailBaseUrl,
      fetchImpl: input.fetchImpl,
      timeoutMs: input.commitTimeoutMs,
    }),
    dispatchHooks: input.commit
      ? createHostedAssistantDeliveryDispatchHooks({
          commit: input.commit,
          commitTimeoutMs: input.commitTimeoutMs,
          fetchImpl: input.fetchImpl,
          sideEffectsBaseUrl: input.sideEffectsBaseUrl,
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
  sideEffectsBaseUrl: string;
  userId: string;
}): AssistantOutboxDispatchHooks {
  return {
    persistDeliveredIntent: async ({ delivery, intent }: {
      delivery: AssistantChannelDelivery;
      intent: {
        dedupeKey: string;
        intentId: string;
      };
      vault: string;
    }) => {
      await callHostedRunnerSideEffectJournal({
        commit: input.commit,
        commitTimeoutMs: input.commitTimeoutMs,
        fetchImpl: input.fetchImpl,
        method: "PUT",
        record: {
          delivery,
          effectId: intent.intentId,
          fingerprint: intent.dedupeKey,
          intentId: intent.intentId,
          kind: "assistant.delivery",
          recordedAt: delivery.sentAt,
        },
        sideEffectsBaseUrl: input.sideEffectsBaseUrl,
        userId: input.userId,
      });
    },
    resolveDeliveredIntent: async ({ intent }: {
      intent: {
        dedupeKey: string;
        intentId: string;
      };
      vault: string;
    }) => {
      const record = await callHostedRunnerSideEffectJournal({
        commit: input.commit,
        commitTimeoutMs: input.commitTimeoutMs,
        fetchImpl: input.fetchImpl,
        method: "GET",
        sideEffect: buildHostedAssistantDeliverySideEffect({
          dedupeKey: intent.dedupeKey,
          intentId: intent.intentId,
        }),
        sideEffectsBaseUrl: input.sideEffectsBaseUrl,
        userId: input.userId,
      });

      if (record?.kind !== "assistant.delivery") {
        return null;
      }

      return {
        channel: record.delivery.channel,
        idempotencyKey:
          (record.delivery as { idempotencyKey?: string | null }).idempotencyKey ?? null,
        messageLength: record.delivery.messageLength,
        sentAt: record.delivery.sentAt,
        target: record.delivery.target,
        targetKind: record.delivery.targetKind,
      } satisfies AssistantChannelDelivery;
    },
  };
}

async function callHostedRunnerSideEffectJournal(input:
  | {
      commit: HostedExecutionCommitCallback;
      commitTimeoutMs: number | null;
      fetchImpl?: typeof fetch;
      method: "GET";
      sideEffect: HostedExecutionSideEffect;
      sideEffectsBaseUrl: string;
      userId: string;
    }
  | {
      commit: HostedExecutionCommitCallback;
      commitTimeoutMs: number | null;
      fetchImpl?: typeof fetch;
      method: "PUT";
      record: HostedExecutionSideEffectRecord;
      sideEffectsBaseUrl: string;
      userId: string;
    }): Promise<HostedExecutionSideEffectRecord | null> {
  const sideEffect = input.method === "GET"
    ? input.sideEffect
    : buildHostedAssistantDeliverySideEffect({
        dedupeKey: input.record.fingerprint,
        intentId: input.record.intentId,
      });
  const url = buildHostedRunnerSideEffectUrl(input.sideEffectsBaseUrl, sideEffect.effectId);
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

  const payload = (await response.json()) as {
    effectId: string;
    record: HostedExecutionSideEffectRecord | null;
  };

  return payload.record;
}

function buildHostedRunnerCommitUrl(
  baseUrl: string,
  eventId: string,
  action: "commit" | "finalize",
): URL {
  return new URL(`/events/${encodeURIComponent(eventId)}/${action}`, baseUrl);
}

function buildHostedRunnerSideEffectUrl(baseUrl: string, effectId: string): URL {
  return new URL(`/effects/${encodeURIComponent(effectId)}`, baseUrl);
}

function sameHostedExecutionBundles(
  left: HostedExecutionRunnerResult,
  right: HostedExecutionRunnerResult,
): boolean {
  return (
    left.bundles.agentState === right.bundles.agentState
    && left.bundles.vault === right.bundles.vault
  );
}

function createHostedRunnerSideEffectJournalError(
  input:
    | {
        method: "GET";
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
  const effectId = input.method === "GET" ? input.sideEffect.effectId : input.record.effectId;
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
