import {
  AssistantActiveTurnInputCheckpointRejectedError,
  AssistantActiveTurnInputUnavailableError,
  assistantInputCandidateFromStoredEvent,
  compareAssistantInputCursors,
  createStoreBackedAssistantInputSource,
  readAssistantInputEvent,
  type AssistantInputCandidate,
  type AssistantInputCandidateQuery,
  type AssistantInputSource,
  type AssistantTurnInputRefreshResult,
} from "@murphai/assistant-engine";
import {
  emitHostedExecutionStructuredLog,
  type HostedRuntimeEvent,
} from "@murphai/hosted-execution";

import type {
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import {
  HostedMailboxImportCheckpointConflictError,
  HostedMailboxImportCheckpointUserMismatchError,
} from "./mailbox-checkpoint.ts";

export function createHostedAssistantInputSource(input: {
  preferredInputIds?: readonly string[] | null;
  requestId: string;
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "forwardedEnv" | "platform" | "platformEnv">;
  vaultRoot: string;
  wake: HostedRuntimeEvent;
}): AssistantInputSource {
  const refreshMailboxForActiveTurnInput =
    input.runtime.platform.refreshMailboxForActiveTurnInput ?? null;
  const checkpointActiveTurnInput =
    input.runtime.platform.checkpointActiveTurnInput ?? null;
  const baseSource = createStoreBackedAssistantInputSource({
    vault: input.vaultRoot,
  });
  let source: AssistantInputSource = baseSource;

  if (
    (refreshMailboxForActiveTurnInput && !checkpointActiveTurnInput)
    || (!refreshMailboxForActiveTurnInput && checkpointActiveTurnInput)
  ) {
    throw new TypeError(
      "Hosted active-turn input requires both mailbox refresh and acceptance checkpoint ports.",
    );
  }

  if (refreshMailboxForActiveTurnInput && checkpointActiveTurnInput) {
    source = {
      async checkpointAcceptedInput(checkpointInput) {
        try {
          await checkpointActiveTurnInput({
            ...checkpointInput,
            requestId: input.requestId,
          });
        } catch (error) {
          throw normalizeHostedActiveTurnInputUnavailableError(error) ?? error;
        }
      },
      async refresh(refreshInput) {
        let mailboxRefresh: AssistantTurnInputRefreshResult | null = null;

        if (
          refreshInput.phase === "input_available"
          || refreshInput.phase === "request_boundary"
          || refreshInput.phase === "commit_barrier"
        ) {
          try {
            mailboxRefresh = await refreshMailboxForActiveTurnInput({
              requestId: input.requestId,
            });
          } catch (error) {
            emitHostedExecutionStructuredLog({
              component: "runtime",
              details: {
                requestId: input.requestId,
              },
              error,
              level: "warn",
              message: "Hosted assistant mailbox refresh failed during active turn input admission.",
              phase: "wake.running",
              wake: input.wake,
            });
            throw normalizeHostedActiveTurnInputUnavailableError(error) ?? error;
          }
        }

        const baseResult = await baseSource.refresh(refreshInput);
        return mergeHostedTurnInputRefreshResult({
          baseResult,
          mailboxRefresh,
        });
      },
      listInputCandidates(query) {
        return baseSource.listInputCandidates(query);
      },
      listNewConversationInputs(query) {
        return baseSource.listNewConversationInputs(query);
      },
    };
  }

  const preferredInputIds = [...new Set(input.preferredInputIds ?? [])];
  if (preferredInputIds.length === 0) {
    return source;
  }

  return {
    ...source,
    async listInputCandidates(query) {
      const preferred = await listPreferredAssistantInputCandidates({
        preferredInputIds,
        query,
        vaultRoot: input.vaultRoot,
      });
      if (preferred.length === 0) {
        return source.listInputCandidates(query);
      }
      return {
        inputs: preferred,
        nextCursor: preferred[preferred.length - 1]?.event.cursor ?? query.afterCursor ?? null,
      };
    },
  };
}

async function listPreferredAssistantInputCandidates(input: {
  preferredInputIds: readonly string[];
  query: AssistantInputCandidateQuery;
  vaultRoot: string;
}): Promise<AssistantInputCandidate[]> {
  const knownInputIds = new Set(input.query.knownInputIds ?? []);
  const limit = normalizePreferredAssistantInputLimit(input.query.limit);
  const candidates: AssistantInputCandidate[] = [];

  for (const inputId of input.preferredInputIds) {
    if (knownInputIds.has(inputId)) {
      continue;
    }
    const event = await readAssistantInputEvent({
      inputId,
      vault: input.vaultRoot,
    });
    if (!event) {
      continue;
    }
    const candidate = assistantInputCandidateFromStoredEvent(event);
    if (
      input.query.sourceId
      && candidate.event.source !== input.query.sourceId
    ) {
      continue;
    }
    if (
      input.query.afterCursor
      && compareAssistantInputCursors(candidate.event.cursor, input.query.afterCursor) <= 0
    ) {
      continue;
    }
    candidates.push(candidate);
  }

  return candidates
    .sort((left, right) => compareAssistantInputCursors(left.event.cursor, right.event.cursor))
    .slice(0, limit);
}

function normalizePreferredAssistantInputLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 100;
  }
  return Math.max(1, Math.trunc(value));
}

function normalizeHostedActiveTurnInputUnavailableError(
  error: unknown,
): AssistantActiveTurnInputUnavailableError | null {
  if (error instanceof AssistantActiveTurnInputUnavailableError) {
    return error;
  }

  if (
    error instanceof HostedMailboxImportCheckpointConflictError ||
    error instanceof HostedMailboxImportCheckpointUserMismatchError
  ) {
    return new AssistantActiveTurnInputCheckpointRejectedError(
      "Active turn input checkpoint was rejected; aborting this workspace phase so it can retry from durable state.",
    );
  }

  return null;
}

function mergeHostedTurnInputRefreshResult(input: {
  baseResult: AssistantTurnInputRefreshResult;
  mailboxRefresh: AssistantTurnInputRefreshResult | null;
}): AssistantTurnInputRefreshResult {
  if (input.baseResult.progressed) {
    return input.baseResult;
  }

  if (input.mailboxRefresh?.progressed) {
    return input.mailboxRefresh;
  }

  if (
    input.mailboxRefresh
    && input.mailboxRefresh.reason !== "no_new_input"
    && input.mailboxRefresh.reason !== "no_port"
  ) {
    return input.mailboxRefresh;
  }

  return input.baseResult;
}
