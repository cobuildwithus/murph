import type {
  HostedIngressEnvelope,
  HostedRunCleanupTarget,
} from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";

import type { R2BucketLike } from "../bundle-store.js";
import { deleteHostedEmailRawMessage } from "../hosted-email.ts";
import type { HostedUserCryptoContext } from "../user-key-store.js";

interface RunnerCleanupDependencies {
  bucket: R2BucketLike;
  readUserCrypto(userId: string): Promise<HostedUserCryptoContext>;
}

export class RunnerCleanupService {
  constructor(
    private readonly dependencies: RunnerCleanupDependencies,
  ) {}

  async cleanupTransientWakeDataBestEffortForRunDrain(input: {
    cleanupTargets?: readonly HostedRunCleanupTarget[] | null;
    runId?: string | null;
    userId?: string | null;
    wakes: readonly HostedIngressEnvelope[];
  }): Promise<void> {
    const emailCleanupTargets = readHostedEmailCleanupTargets(input.cleanupTargets ?? []);
    if (
      input.wakes.length === 0
      && emailCleanupTargets.length === 0
    ) {
      return;
    }

    for (const wake of input.wakes) {
      await this.deleteTransientWakeDataBestEffort(wake);
    }
    for (const emailMessage of emailCleanupTargets) {
      await this.deletePendingEmailCleanupBestEffort(emailMessage);
    }
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
