import {
  executeConsentedReadOnlyAssistantAsk,
  executeReadOnlyAssistantAsk,
  type ConsentedReadOnlyAssistantAskInput,
  type ReadOnlyAssistantAskProviderUsageEvent,
  type ReadOnlyAssistantAskInput,
  type ReadOnlyAssistantAskResult,
} from "@murphai/assistant-engine/assistant-ask";
import {
  AssistantActiveTurnInputUnavailableError,
} from "@murphai/assistant-engine/assistant-automation";
import {
  ASSISTANT_USAGE_SCHEMA,
  createAssistantUsageId,
  parseAssistantUsageRecord,
  resolveAssistantUsageCredentialSource,
} from "@murphai/hosted-execution/assistant-usage";
import type {
  AssistantHostedGroupSharedReader,
} from "@murphai/assistant-engine";
import {
  readHostedExecutionAssistantAskGroupSenderResponseDestination,
  type HostedExecutionAssistantAskResult,
} from "@murphai/hosted-execution/contracts";

import type {
  HostedRuntimeAssistantAskPort,
  HostedRuntimeUsageRecordPort,
} from "./platform.ts";
import type {
  HostedWorkspaceDurableCheckpointEffect,
} from "./workspace-runner.ts";
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

type HostedDetachedAssistantAskRunResult = "handoff" | "idle" | "settled";

export interface HostedDetachedAssistantAskController {
  closeAndRequeue(): Promise<void>;
  kick(): void;
  pauseAndRequeue(): Promise<void>;
  resume(): void;
}

export interface HostedDetachedAssistantAskControllerInput {
  assistantAskPort: HostedRuntimeAssistantAskPort | null;
  codexHome: string | null;
  createGroupSharedReader?(): AssistantHostedGroupSharedReader | null;
  env: Readonly<Record<string, string>>;
  executeAsk?: (
    input: ReadOnlyAssistantAskInput,
  ) => Promise<ReadOnlyAssistantAskResult>;
  executeConsentedAsk?: (
    input: ConsentedReadOnlyAssistantAskInput,
  ) => Promise<ReadOnlyAssistantAskResult>;
  deferUsageUntilAfterDurableCheckpoint?: (
    effect: HostedWorkspaceDurableCheckpointEffect,
  ) => void;
  memberId?: string;
  model?: string | null;
  modelProvider?: string | null;
  now?: () => string;
  onStateMutation(): void;
  resolveProviderAuthority?(): Promise<"current" | "handoff">;
  usageRecordPort?: HostedRuntimeUsageRecordPort | null;
  userEnvKeys?: readonly string[];
  vaultRoot: string;
}

export function createHostedDetachedAssistantAskController(
  input: HostedDetachedAssistantAskControllerInput,
): HostedDetachedAssistantAskController {
  const executeAsk = input.executeAsk ?? executeReadOnlyAssistantAsk;
  const executeConsentedAsk =
    input.executeConsentedAsk ?? executeConsentedReadOnlyAssistantAsk;
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
      ...(input.createGroupSharedReader
        ? { createGroupSharedReader: input.createGroupSharedReader }
        : {}),
      env: input.env,
      executeAsk,
      executeConsentedAsk,
      deferUsageUntilAfterDurableCheckpoint:
        input.deferUsageUntilAfterDurableCheckpoint ?? null,
      memberId: input.memberId ?? null,
      model: input.model ?? null,
      modelProvider: input.modelProvider ?? null,
      now,
      onStateMutation: input.onStateMutation,
      resolveProviderAuthority: input.resolveProviderAuthority ?? null,
      usageRecordPort: input.usageRecordPort ?? null,
      userEnvKeys: input.userEnvKeys ?? [],
      vaultRoot: input.vaultRoot,
    });
    activeAbortController = abortController;
    activePromise = completion;

    void completion.then(
      (result) => {
        if (activePromise !== completion) {
          return;
        }
        if (result === "handoff") {
          closed = true;
          paused = true;
          kickRequested = false;
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
  createGroupSharedReader?: () => AssistantHostedGroupSharedReader | null;
  env: Readonly<Record<string, string>>;
  executeAsk: (
    input: ReadOnlyAssistantAskInput,
  ) => Promise<ReadOnlyAssistantAskResult>;
  executeConsentedAsk: (
    input: ConsentedReadOnlyAssistantAskInput,
  ) => Promise<ReadOnlyAssistantAskResult>;
  deferUsageUntilAfterDurableCheckpoint: ((
    effect: HostedWorkspaceDurableCheckpointEffect,
  ) => void) | null;
  memberId: string | null;
  model: string | null;
  modelProvider: string | null;
  now: () => string;
  onStateMutation(): void;
  resolveProviderAuthority: (() => Promise<"current" | "handoff">) | null;
  usageRecordPort: HostedRuntimeUsageRecordPort | null;
  userEnvKeys: readonly string[];
  vaultRoot: string;
}): Promise<HostedDetachedAssistantAskRunResult> {
  let claimed: HostedSystemMailboxPendingItem | null = null;
  let providerHandoffRequested = false;
  const providerUsages: ReadOnlyAssistantAskProviderUsageEvent[] = [];
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
    if (input.abortSignal.aborted) {
      await requeueHostedDetachedAssistantAsk({
        claimed,
        input,
        nextAttemptAt: null,
      });
      return "settled";
    }
    const executionInput = {
      abortSignal: input.abortSignal,
      ...(input.resolveProviderAuthority
        ? {
            async beforeProviderEntry() {
              if (
                await input.resolveProviderAuthority?.() === "handoff"
              ) {
                providerHandoffRequested = true;
                throw new AssistantActiveTurnInputUnavailableError(
                  "Assistant provider changed; retrying the ask with the saved provider.",
                );
              }
            },
          }
        : {}),
      codexHome: input.codexHome,
      env: { ...input.env },
      model: input.model,
      modelProvider: input.modelProvider,
      now: new Date(input.now()),
      ...(input.usageRecordPort && input.deferUsageUntilAfterDurableCheckpoint
        ? {
            onProviderUsage(event: ReadOnlyAssistantAskProviderUsageEvent) {
              providerUsages.push(event);
            },
          }
        : {}),
      question: prepared.question,
      workspaceRoot: input.vaultRoot,
    };
    const reviewedPersonalAsk =
      claimed.wake.ask.target.kind !== "joined_group";
    let answer: ReadOnlyAssistantAskResult;
    if (claimed.wake.ask.target.kind !== "joined_group") {
      if (prepared.disclosure === undefined) {
        throw new TypeError(
          "Reviewed personal ask prepare omitted its disclosure context.",
        );
      }
      const currentSenderResponseDestination =
        claimed.wake.ask.target.kind === "group_sender"
        || claimed.wake.ask.target.kind === "group_sender_private"
          ? readHostedExecutionAssistantAskGroupSenderResponseDestination(
              claimed.wake.ask.target,
            )
          : null;
      answer = await input.executeConsentedAsk({
        ...executionInput,
        answerMode: currentSenderResponseDestination === "current_sender"
          ? "direct_recipient"
          : "caller_handoff",
        permissionText: prepared.disclosure.permissionText,
      });
    } else {
      if (prepared.disclosure !== undefined) {
        throw new TypeError(
          "Joined group ask prepare returned unexpected disclosure context.",
        );
      }
      answer = await input.executeAsk({
        ...executionInput,
        ...(input.createGroupSharedReader
          ? { groupSharedReader: input.createGroupSharedReader() }
          : {}),
        requesterParticipantId: claimed.wake.ask.target.membershipId,
      });
    }
    const result = reviewedPersonalAsk && answer.outcome === "cannot_answer"
      ? { answer: null, outcome: "cannot_answer" as const }
      : normalizeHostedDetachedAssistantAskResult(answer);
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
        : providerHandoffRequested
          ? null
          : new Date(
            Date.parse(input.now()) + HOSTED_DETACHED_ASSISTANT_ASK_RETRY_DELAY_MS,
          ).toISOString(),
    });
    return providerHandoffRequested ? "handoff" : "settled";
  } finally {
    if (
      claimed
      && input.usageRecordPort
      && input.deferUsageUntilAfterDurableCheckpoint
      && providerUsages.length > 0
    ) {
      const deferredUsageInput = {
        attemptCount: claimed.attemptCount,
        effectiveEnv: { ...input.env },
        memberId: input.memberId ?? claimed.wake.userId,
        providerUsages: [...providerUsages],
        requestId: claimed.wake.eventId,
        usageRecordPort: input.usageRecordPort,
        userEnvKeys: [...input.userEnvKeys],
      };
      try {
        input.deferUsageUntilAfterDurableCheckpoint(async () => {
          await recordHostedDetachedAssistantAskUsageBestEffort(
            deferredUsageInput,
          );
        });
      } catch (error) {
        warnHostedDetachedAssistantAskUsageFailure(error);
      }
    }
  }
}

async function recordHostedDetachedAssistantAskUsageBestEffort(input: {
  attemptCount: number;
  effectiveEnv: Readonly<Record<string, string>>;
  memberId: string;
  providerUsages: readonly ReadOnlyAssistantAskProviderUsageEvent[];
  requestId: string;
  usageRecordPort: HostedRuntimeUsageRecordPort;
  userEnvKeys: readonly string[];
}): Promise<void> {
  for (const event of input.providerUsages) {
    try {
      const usage = event.usage.usage;
      const turnId = `turn_assistant_ask_${input.requestId}.stage-${event.stage}`;
      const credentialSource = resolveAssistantUsageCredentialSource({
        apiKeyEnv: usage.apiKeyEnv,
        effectiveEnv: input.effectiveEnv,
        provider: event.usage.provider,
        userEnvKeys: input.userEnvKeys,
      });
      const record = parseAssistantUsageRecord({
        apiKeyEnv: usage.apiKeyEnv,
        attemptCount: input.attemptCount,
        baseUrl: usage.baseUrl,
        cacheWriteTokens: usage.cacheWriteTokens,
        cachedInputTokens: usage.cachedInputTokens,
        credentialSource,
        featureKey: "assistant_read_only_ask",
        gatewayTags: [],
        inputTokens: usage.inputTokens,
        memberId: input.memberId,
        occurredAt: event.usage.occurredAt,
        outputTokens: usage.outputTokens,
        provider: event.usage.provider,
        providerName: usage.providerName,
        providerRequestId: usage.providerRequestId,
        providerRequestOrdinal: event.usage.providerRequestOrdinal,
        providerRequestOutcome:
          event.usage.providerRequestOutcome ?? "succeeded",
        rawUsageJson: usage.rawUsageJson,
        rawUsageJsonHash: usage.rawUsageJsonHash,
        reasoningTokens: usage.reasoningTokens,
        reportingUserId: null,
        requestedModel: usage.requestedModel,
        routeId: null,
        schema: ASSISTANT_USAGE_SCHEMA,
        servedModel: usage.servedModel,
        sessionId: input.requestId,
        stripeMeterSource: "murph",
        surface: "hosted-runtime",
        tokenPricingBasis: usage.tokenPricingBasis,
        totalTokens: usage.totalTokens,
        triggerKind: "assistant-ask",
        turnId,
        turnProfileJson: usage.turnProfileJson,
        usageId: createAssistantUsageId({
          attemptCount: input.attemptCount,
          providerRequestOrdinal: event.usage.providerRequestOrdinal,
          turnId,
        }),
        usageExtractionSourcePath: usage.usageExtractionSourcePath,
        usageExtractionVersion: usage.usageExtractionVersion,
      });
      await input.usageRecordPort.recordUsage(record);
    } catch (error) {
      warnHostedDetachedAssistantAskUsageFailure(error);
    }
  }
}

function warnHostedDetachedAssistantAskUsageFailure(error: unknown): void {
  console.warn(
    "Detached Assistant Ask usage recording failed; continuing without retry.",
    {
      errorName: error instanceof Error ? error.name : typeof error,
    },
  );
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
