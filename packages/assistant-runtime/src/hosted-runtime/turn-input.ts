import {
  AssistantActiveTurnInputCheckpointRejectedError,
  AssistantActiveTurnInputUnavailableError,
  createStoreBackedAssistantInputSource,
  type AssistantInputSource,
  type AssistantTurnInputRefreshResult,
} from "@murphai/assistant-engine";
import {
  emitHostedExecutionStructuredLog,
  type HostedRuntimeEvent,
} from "@murphai/hosted-execution";
import type { InboxServices } from "@murphai/inbox-services";

import type {
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import {
  HostedMailboxImportCheckpointConflictError,
  HostedMailboxImportCheckpointUserMismatchError,
} from "./mailbox-checkpoint.ts";

type HostedTurnInputInboxServices = InboxServices;

export function createHostedAutomationInboxServices(
  inboxServices: HostedTurnInputInboxServices,
): HostedTurnInputInboxServices {
  return inboxServices;
}

export function createHostedAssistantInputSource(input: {
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

  if (!refreshMailboxForActiveTurnInput && !checkpointActiveTurnInput) {
    return baseSource;
  }
  if (!refreshMailboxForActiveTurnInput || !checkpointActiveTurnInput) {
    throw new TypeError(
      "Hosted active-turn input requires both mailbox refresh and acceptance checkpoint ports.",
    );
  }

  return {
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
