import type {
  HostedExecutionRunnerResult,
  HostedIngressEnvelope,
  HostedRunCleanupTarget,
} from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import type {
  HostedAssistantDeliveryOutcome,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  deleteHostedLinqMessages,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";

import type { R2BucketLike } from "../bundle-store.js";
import { deleteHostedEmailRawMessage } from "../hosted-email.ts";
import type { HostedUserCryptoContext } from "../user-key-store.js";
import type { RunnerPendingCleanupState } from "./types.js";

interface RunnerCleanupDependencies {
  bucket: R2BucketLike;
  clearPendingRunCleanup(runId: string): Promise<void>;
  readPendingRunCleanup(runId: string): Promise<RunnerPendingCleanupState | null>;
  readUserCrypto(userId: string): Promise<HostedUserCryptoContext>;
  resolveRunnerRuntimeEnv(userId: string | null): Promise<Record<string, string>>;
  writePendingRunCleanup(
    runId: string,
    cleanup: RunnerPendingCleanupState | null,
  ): Promise<void>;
}

export class RunnerCleanupService {
  constructor(
    private readonly dependencies: RunnerCleanupDependencies,
  ) {}

  async cleanupTransientWakeDataBestEffortForRunDrain(input: {
    assistantDeliveryOutcomes?: readonly HostedAssistantDeliveryOutcome[] | null;
    cleanupTargets?: readonly HostedRunCleanupTarget[] | null;
    runId?: string | null;
    userId?: string | null;
    wakes: readonly HostedIngressEnvelope[];
  }): Promise<void> {
    let pendingCleanup: RunnerPendingCleanupState | null = null;
    let remainingPendingCleanup: RunnerPendingCleanupState | null = null;
    let canClearPendingCleanup = input.runId == null;
    if (input.runId) {
      try {
        pendingCleanup = await this.dependencies.readPendingRunCleanup(input.runId);
        remainingPendingCleanup = cloneRunnerPendingCleanupState(pendingCleanup);
        canClearPendingCleanup = true;
      } catch (error) {
        emitHostedExecutionStructuredLog({
          component: "runner",
          details: {
            runId: input.runId,
          },
          error,
          eventId: input.wakes[0]?.eventId ?? "hosted-run:cleanup",
          level: "warn",
          message: "Hosted pending cleanup sidecar read failed; continuing with in-memory cleanup inputs only.",
          phase: "completed",
          run: null,
          userId: input.userId ?? input.wakes[0]?.userId ?? "unknown",
        });
      }
    }
    if (
      input.wakes.length === 0
      && (!input.cleanupTargets || input.cleanupTargets.length === 0)
      && (!input.assistantDeliveryOutcomes || input.assistantDeliveryOutcomes.length === 0)
      && !pendingCleanup
    ) {
      return;
    }

    for (const wake of input.wakes) {
      await this.deleteTransientWakeDataBestEffort(wake);
    }
    let pendingEmailCleanupConfirmed = true;
    for (const emailMessage of readHostedEmailCleanupTargets(input.cleanupTargets ?? [])) {
      pendingEmailCleanupConfirmed = await this.deletePendingEmailCleanupBestEffort(emailMessage)
        && pendingEmailCleanupConfirmed;
    }
    for (const emailMessage of pendingCleanup?.emailMessages ?? []) {
      pendingEmailCleanupConfirmed = await this.deletePendingEmailCleanupBestEffort(emailMessage)
        && pendingEmailCleanupConfirmed;
    }
    if (remainingPendingCleanup && pendingEmailCleanupConfirmed) {
      remainingPendingCleanup.emailMessages = [];
    }

    const hostedLinqCleanupConfirmed = await this.deleteHostedLinqMessagesBestEffort({
      assistantDeliveryOutcomes: input.assistantDeliveryOutcomes ?? [],
      cleanupTargets: input.cleanupTargets ?? [],
      pendingCleanup,
      userId: input.userId ?? null,
      wakes: input.wakes,
    });
    if (remainingPendingCleanup && hostedLinqCleanupConfirmed) {
      remainingPendingCleanup.linqMessageIds = [];
    }
    if (remainingPendingCleanup) {
      remainingPendingCleanup.telegramMessages = [];
    }

    if (input.runId && canClearPendingCleanup) {
      const retainedPendingCleanup = normalizeRetainedRunnerPendingCleanupState(
        remainingPendingCleanup,
      );
      if (retainedPendingCleanup) {
        const cleanupStateChanged = !sameRunnerPendingCleanupState(
          pendingCleanup,
          retainedPendingCleanup,
        );
        if (cleanupStateChanged) {
          try {
            await this.dependencies.writePendingRunCleanup(input.runId, retainedPendingCleanup);
          } catch (error) {
            emitHostedExecutionStructuredLog({
              component: "runner",
              details: {
                emailMessageCount: retainedPendingCleanup.emailMessages.length,
                linqMessageCount: retainedPendingCleanup.linqMessageIds.length,
                runId: input.runId,
                telegramMessageCount: retainedPendingCleanup.telegramMessages.length,
              },
              error,
              eventId: input.wakes[0]?.eventId ?? "hosted-run:cleanup",
              level: "warn",
              message:
                "Hosted pending cleanup sidecar update failed; leaving the prior retry inputs durable.",
              phase: "completed",
              run: null,
              userId: input.userId ?? input.wakes[0]?.userId ?? "unknown",
            });
            return;
          }
        }
        emitHostedExecutionStructuredLog({
          component: "runner",
          details: {
            emailMessageCount: retainedPendingCleanup.emailMessages.length,
            linqMessageCount: retainedPendingCleanup.linqMessageIds.length,
            runId: input.runId,
            telegramMessageCount: retainedPendingCleanup.telegramMessages.length,
          },
          eventId: input.wakes[0]?.eventId ?? "hosted-run:cleanup",
          level: "warn",
          message:
            "Hosted pending cleanup sidecar retained because cleanup could not be fully confirmed; retry inputs remain durable.",
          phase: "completed",
          run: null,
          userId: input.userId ?? input.wakes[0]?.userId ?? "unknown",
        });
        return;
      }
      try {
        await this.dependencies.clearPendingRunCleanup(input.runId);
      } catch (error) {
        emitHostedExecutionStructuredLog({
          component: "runner",
          details: {
            runId: input.runId,
          },
          error,
          eventId: input.wakes[0]?.eventId ?? "hosted-run:cleanup",
          level: "warn",
          message: "Hosted pending cleanup sidecar clear failed; continuing after best-effort cleanup.",
          phase: "completed",
          run: null,
          userId: input.userId ?? input.wakes[0]?.userId ?? "unknown",
        });
      }
    }
  }

  async persistPendingRunCleanupData(input: {
    assistantDeliveryOutcomes?: readonly HostedAssistantDeliveryOutcome[] | null;
    cleanupTargets?: readonly HostedRunCleanupTarget[] | null;
    committedResult?: HostedExecutionRunnerResult | null;
    runId: string;
    wakes: readonly HostedIngressEnvelope[];
  }): Promise<void> {
    await this.dependencies.writePendingRunCleanup(
      input.runId,
      buildRunnerPendingCleanupState({
        assistantDeliveryOutcomes: input.assistantDeliveryOutcomes ?? [],
        cleanupTargets: input.cleanupTargets ?? [],
        committedResult: input.committedResult ?? null,
        wakes: input.wakes,
      }),
    );
  }

  private async deleteTransientWakeDataBestEffort(
    wake: HostedIngressEnvelope,
  ): Promise<boolean> {
    if (wake.kind !== "conversation.message" || wake.message.channel !== "email") {
      return true;
    }

    try {
      const crypto = await this.dependencies.readUserCrypto(wake.userId);
      await deleteHostedEmailRawMessage({
        bucket: this.dependencies.bucket,
        key: crypto.rootKey,
        keysById: crypto.keysById,
        rawMessageKey: wake.message.rawMessageKey,
        userId: wake.userId,
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          rawMessageKey: wake.message.rawMessageKey,
          wakeChannel: wake.message.channel,
          wakeKind: wake.kind,
        },
        error,
        eventId: wake.eventId,
        level: "warn",
        message: "Hosted wake best-effort raw email cleanup failed; the durable raw message object may need manual cleanup.",
        phase: "completed",
        run: null,
        userId: wake.userId,
      });
      return false;
    }

    return true;
  }

  private async deletePendingEmailCleanupBestEffort(input: {
    eventId: string;
    rawMessageKey: string;
    userId: string;
  }): Promise<boolean> {
    try {
      const crypto = await this.dependencies.readUserCrypto(input.userId);
      await deleteHostedEmailRawMessage({
        bucket: this.dependencies.bucket,
        key: crypto.rootKey,
        keysById: crypto.keysById,
        rawMessageKey: input.rawMessageKey,
        userId: input.userId,
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          rawMessageKey: input.rawMessageKey,
          wakeChannel: "email",
          wakeKind: "conversation.message",
        },
        error,
        eventId: input.eventId,
        level: "warn",
        message: "Hosted wake best-effort raw email cleanup failed; the durable raw message object may need manual cleanup.",
        phase: "completed",
        run: null,
        userId: input.userId,
      });
      return false;
    }

    return true;
  }

  private async deleteHostedLinqMessagesBestEffort(input: {
    assistantDeliveryOutcomes: readonly HostedAssistantDeliveryOutcome[];
    cleanupTargets: readonly HostedRunCleanupTarget[];
    pendingCleanup: RunnerPendingCleanupState | null;
    userId: string | null;
    wakes: readonly HostedIngressEnvelope[];
  }): Promise<boolean> {
    const messageIds = new Set<string>();

    for (const wake of input.wakes) {
      if (wake.kind === "conversation.message" && wake.message.channel === "linq") {
        messageIds.add(wake.message.linqMessage.messageId);
      }
    }
    for (const messageId of input.pendingCleanup?.linqMessageIds ?? []) {
      messageIds.add(messageId);
    }
    for (const cleanupTarget of input.cleanupTargets) {
      if (cleanupTarget.channel === "linq") {
        messageIds.add(cleanupTarget.messageId);
      }
    }

    for (const outcome of input.assistantDeliveryOutcomes) {
      if (!shouldUseHostedDeliveryOutcomeForCleanup(outcome, "linq")) {
        continue;
      }

      for (const messageId of readHostedProviderMessageIds(outcome)) {
        messageIds.add(messageId);
      }
    }

    if (messageIds.size === 0) {
      return true;
    }

    const firstWake = input.wakes[0];
    const cleanupUserId = firstWake?.userId ?? input.userId ?? null;
    try {
      const runtimeEnv = await this.dependencies.resolveRunnerRuntimeEnv(cleanupUserId);
      await deleteHostedLinqMessages({
        env: runtimeEnv,
        messageIds: [...messageIds],
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          messageIdCount: messageIds.size,
          provider: "linq",
        },
        error,
        eventId: firstWake?.eventId ?? "hosted-run:cleanup",
        level: "warn",
        message: "Hosted Linq message cleanup failed; the provider copy may need manual deletion.",
        phase: "completed",
        run: null,
        userId: cleanupUserId ?? "unknown",
      });
      return false;
    }

    return true;
  }

}

function readHostedProviderMessageIds(
  outcome: HostedAssistantDeliveryOutcome,
): string[] {
  if (Array.isArray(outcome.providerMessageIds) && outcome.providerMessageIds.length > 0) {
    return outcome.providerMessageIds;
  }

  return outcome.providerMessageId ? [outcome.providerMessageId] : [];
}

function readHostedEmailCleanupTargets(
  cleanupTargets: readonly HostedRunCleanupTarget[],
): Array<{ eventId: string; rawMessageKey: string; userId: string }> {
  return Array.from(
    new Map(
      cleanupTargets.flatMap((cleanupTarget) => {
        if (cleanupTarget.channel !== "email") {
          return [];
        }

        return [[
          `${cleanupTarget.userId}\u0000${cleanupTarget.rawMessageKey}`,
          {
            eventId: cleanupTarget.eventId,
            rawMessageKey: cleanupTarget.rawMessageKey,
            userId: cleanupTarget.userId,
          },
        ] as const];
      }),
    ).values(),
  );
}

function shouldUseHostedDeliveryOutcomeForCleanup(
  outcome: HostedAssistantDeliveryOutcome,
  channel: string,
): boolean {
  return outcome.deliveryChannel === channel
    && (outcome.deliveryStatus === "sent" || outcome.deliveryStatus === "failed_ambiguous")
    && readHostedProviderMessageIds(outcome).length > 0;
}

function buildRunnerPendingCleanupState(input: {
  assistantDeliveryOutcomes: readonly HostedAssistantDeliveryOutcome[];
  cleanupTargets: readonly HostedRunCleanupTarget[];
  committedResult?: HostedExecutionRunnerResult | null;
  wakes: readonly HostedIngressEnvelope[];
}): RunnerPendingCleanupState {
  const linqMessageIds = new Set<string>();
  const cleanup: RunnerPendingCleanupState = {
    emailMessages: [],
    linqMessageIds: [],
    required: true,
    telegramMessages: [],
  };
  if (input.committedResult) {
    cleanup.committedResult = input.committedResult;
  }

  for (const wake of input.wakes) {
    if (wake.kind !== "conversation.message") {
      continue;
    }

    switch (wake.message.channel) {
      case "email":
        cleanup.emailMessages.push({
          eventId: wake.eventId,
          rawMessageKey: wake.message.rawMessageKey,
          userId: wake.userId,
        });
        break;
      case "linq":
        linqMessageIds.add(wake.message.linqMessage.messageId);
        break;
      default:
        break;
    }
  }

  for (const cleanupTarget of input.cleanupTargets) {
    switch (cleanupTarget.channel) {
      case "email":
        cleanup.emailMessages.push({
          eventId: cleanupTarget.eventId,
          rawMessageKey: cleanupTarget.rawMessageKey,
          userId: cleanupTarget.userId,
        });
        break;
      case "linq":
        linqMessageIds.add(cleanupTarget.messageId);
        break;
    }
  }

  for (const outcome of input.assistantDeliveryOutcomes) {
    if (!shouldUseHostedDeliveryOutcomeForCleanup(outcome, "linq")) {
      continue;
    }

    for (const messageId of readHostedProviderMessageIds(outcome)) {
      linqMessageIds.add(messageId);
    }
  }
  cleanup.emailMessages = Array.from(
    new Map(
      cleanup.emailMessages.map((message) => [
        `${message.userId}\u0000${message.rawMessageKey}`,
        message,
      ]),
    ).values(),
  );
  cleanup.linqMessageIds = [...linqMessageIds];

  return cleanup;
}

function cloneRunnerPendingCleanupState(
  cleanup: RunnerPendingCleanupState | null,
): RunnerPendingCleanupState | null {
  if (!cleanup) {
    return null;
  }

  return {
    ...(cleanup.committedResult ? { committedResult: cleanup.committedResult } : {}),
    emailMessages: cleanup.emailMessages.map((message) => ({ ...message })),
    linqMessageIds: [...cleanup.linqMessageIds],
    required: cleanup.required,
    telegramMessages: cleanup.telegramMessages.map((message) => ({ ...message })),
  };
}

function normalizeRetainedRunnerPendingCleanupState(
  cleanup: RunnerPendingCleanupState | null,
): RunnerPendingCleanupState | null {
  if (!cleanup) {
    return null;
  }

  if (
    cleanup.emailMessages.length === 0
    && cleanup.linqMessageIds.length === 0
    && cleanup.telegramMessages.length === 0
  ) {
    return null;
  }

  return {
    ...cleanup,
    required: true,
  };
}

function sameRunnerPendingCleanupState(
  left: RunnerPendingCleanupState | null,
  right: RunnerPendingCleanupState | null,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}
