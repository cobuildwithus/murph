import {
  executeReadOnlyAssistantAsk,
  type ReadOnlyAssistantAskInput,
  type ReadOnlyAssistantAskResult,
} from "@murphai/assistant-engine/assistant-ask";
import type {
  HostedExecutionAssistantAskResult,
} from "@murphai/hosted-execution/contracts";

import type {
  HostedRuntimeAssistantAskPort,
} from "./platform.ts";
import {
  claimHostedSystemMailboxItem,
  requeueClaimedHostedSystemMailboxItem,
} from "./system-mailbox.ts";
import {
  removeHostedSystemMailboxPendingItemIfCurrent,
  type HostedSystemMailboxPendingItem,
} from "./system-mailbox-state.ts";

const HOSTED_DETACHED_ASSISTANT_ASK_RETRY_DELAY_MS = 60_000;
const HOSTED_DETACHED_ASSISTANT_ASK_ROUTE_ACTIONS = [
  "run-assistant-ask",
] as const;

type HostedDetachedAssistantAskRunResult = "idle" | "settled";

export interface HostedDetachedAssistantAskController {
  closeAndRequeue(): Promise<void>;
  kick(): void;
  pauseAndRequeue(): Promise<void>;
  resume(): void;
}

export interface HostedDetachedAssistantAskControllerInput {
  assistantAskPort: HostedRuntimeAssistantAskPort | null;
  codexHome: string | null;
  env: Readonly<Record<string, string>>;
  executeAsk?: (
    input: ReadOnlyAssistantAskInput,
  ) => Promise<ReadOnlyAssistantAskResult>;
  now?: () => string;
  onStateMutation(): void;
  vaultRoot: string;
}

export function createHostedDetachedAssistantAskController(
  input: HostedDetachedAssistantAskControllerInput,
): HostedDetachedAssistantAskController {
  const executeAsk = input.executeAsk ?? executeReadOnlyAssistantAsk;
  const now = input.now ?? (() => new Date().toISOString());
  let activeAbortController: AbortController | null = null;
  let activePromise: Promise<HostedDetachedAssistantAskRunResult> | null = null;
  let closed = false;
  let kickRequested = false;
  let paused = false;

  const kick = (): void => {
    if (closed) {
      return;
    }
    if (paused) {
      kickRequested = true;
      return;
    }
    if (activePromise !== null) {
      kickRequested = true;
      return;
    }

    const abortController = new AbortController();
    const completion = runOneHostedDetachedAssistantAsk({
      abortSignal: abortController.signal,
      assistantAskPort: input.assistantAskPort,
      codexHome: input.codexHome,
      env: input.env,
      executeAsk,
      now,
      onStateMutation: input.onStateMutation,
      vaultRoot: input.vaultRoot,
    });
    activeAbortController = abortController;
    activePromise = completion;

    void completion.then(
      (result) => {
        if (activePromise !== completion) {
          return;
        }
        const shouldKick = kickRequested || result === "settled";
        kickRequested = false;
        activeAbortController = null;
        activePromise = null;
        if (!closed && shouldKick) {
          if (paused) {
            kickRequested = true;
          } else {
            kick();
          }
        }
      },
      () => {
        // Preserve the rejected promise for the checkpoint/return barrier.
        // That boundary must fail closed instead of releasing the workspace
        // after a claim-state mutation could not be made durable locally.
      },
    );
  };

  const quiesce = async (): Promise<void> => {
    const completion = activePromise;
    if (!completion) {
      return;
    }
    const abortController = activeAbortController;
    if (abortController && !abortController.signal.aborted) {
      abortController.abort(
        new DOMException("Detached assistant ask paused at a workspace boundary.", "AbortError"),
      );
    }
    await completion;
    if (activePromise === completion) {
      activeAbortController = null;
      activePromise = null;
    }
  };

  return {
    async closeAndRequeue() {
      closed = true;
      paused = true;
      kickRequested = false;
      await quiesce();
    },
    kick,
    async pauseAndRequeue() {
      if (closed) {
        return;
      }
      paused = true;
      await quiesce();
    },
    resume() {
      if (closed || !paused) {
        return;
      }
      paused = false;
      const shouldKick = kickRequested;
      kickRequested = false;
      if (shouldKick) {
        kick();
      }
    },
  };
}

async function runOneHostedDetachedAssistantAsk(input: {
  abortSignal: AbortSignal;
  assistantAskPort: HostedRuntimeAssistantAskPort | null;
  codexHome: string | null;
  env: Readonly<Record<string, string>>;
  executeAsk: (
    input: ReadOnlyAssistantAskInput,
  ) => Promise<ReadOnlyAssistantAskResult>;
  now: () => string;
  onStateMutation(): void;
  vaultRoot: string;
}): Promise<HostedDetachedAssistantAskRunResult> {
  let claimed: HostedSystemMailboxPendingItem | null = null;
  try {
    claimed = await claimHostedSystemMailboxItem({
      allowedRouteActions: HOSTED_DETACHED_ASSISTANT_ASK_ROUTE_ACTIONS,
      now: input.now,
      vaultRoot: input.vaultRoot,
    });
    if (!claimed) {
      return "idle";
    }
    input.onStateMutation();
    if (input.abortSignal.aborted) {
      await requeueHostedDetachedAssistantAsk({
        claimed,
        input,
        nextAttemptAt: null,
      });
      return "settled";
    }
    if (claimed.wake.kind !== "assistant.ask.requested") {
      throw new TypeError(
        "Detached assistant ask route requires an assistant.ask.requested wake.",
      );
    }
    if (!input.assistantAskPort) {
      throw new TypeError("Detached assistant ask requires the assistant ask control port.");
    }

    const requestId = claimed.wake.eventId;
    const prepared = await input.assistantAskPort.request(
      {
        action: "prepare",
        requestId,
      },
      { signal: input.abortSignal },
    );
    if (prepared.action !== "prepare") {
      throw new TypeError("Detached assistant ask prepare returned the wrong action.");
    }
    if (prepared.status === "terminal") {
      await removeHostedDetachedAssistantAsk({ claimed, input });
      return "settled";
    }
    const answer = await input.executeAsk({
      abortSignal: input.abortSignal,
      codexHome: input.codexHome,
      env: { ...input.env },
      now: new Date(input.now()),
      question: prepared.question,
      workspaceRoot: input.vaultRoot,
    });
    const result = normalizeHostedDetachedAssistantAskResult(answer);
    const completed = await input.assistantAskPort.request(
      {
        action: "complete",
        requestId,
        result,
      },
      { signal: input.abortSignal },
    );
    if (completed.action !== "complete") {
      throw new TypeError("Detached assistant ask completion returned the wrong action.");
    }
    await removeHostedDetachedAssistantAsk({ claimed, input });
    return "settled";
  } catch (error) {
    if (!claimed) {
      throw error;
    }
    const aborted = input.abortSignal.aborted;
    await requeueHostedDetachedAssistantAsk({
      claimed,
      error: aborted ? undefined : error,
      input,
      nextAttemptAt: aborted
        ? null
        : new Date(
            Date.parse(input.now()) + HOSTED_DETACHED_ASSISTANT_ASK_RETRY_DELAY_MS,
          ).toISOString(),
    });
    return "settled";
  }
}

async function removeHostedDetachedAssistantAsk(input: {
  claimed: HostedSystemMailboxPendingItem;
  input: Pick<HostedDetachedAssistantAskControllerInput, "onStateMutation" | "vaultRoot">;
}): Promise<void> {
  const removed = await removeHostedSystemMailboxPendingItemIfCurrent({
    item: input.claimed,
    vaultRoot: input.input.vaultRoot,
  });
  if (removed) {
    input.input.onStateMutation();
  }
}

async function requeueHostedDetachedAssistantAsk(input: {
  claimed: HostedSystemMailboxPendingItem;
  error?: unknown;
  input: Pick<HostedDetachedAssistantAskControllerInput, "onStateMutation" | "vaultRoot">;
  nextAttemptAt: string | null;
}): Promise<void> {
  const requeued = await requeueClaimedHostedSystemMailboxItem({
    ...(input.error === undefined ? {} : { error: input.error }),
    item: input.claimed,
    nextAttemptAt: input.nextAttemptAt,
    vaultRoot: input.input.vaultRoot,
  });
  if (requeued) {
    input.input.onStateMutation();
  }
}

function normalizeHostedDetachedAssistantAskResult(
  result: ReadOnlyAssistantAskResult,
): HostedExecutionAssistantAskResult {
  if (result.outcome === "answered") {
    return result;
  }
  return {
    answer: result.answer ?? null,
    outcome: "cannot_answer",
  };
}
