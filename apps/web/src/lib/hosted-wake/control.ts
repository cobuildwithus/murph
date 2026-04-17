import type { PrismaClient } from "@prisma/client";

import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";
import { formatHostedExecutionSafeLogError } from "../hosted-execution/logging";
import {
  drainHostedExecutionOutboxBestEffort,
  readHostedExecutionScheduledDispatchTarget,
} from "../hosted-execution/outbox";
import { getPrisma } from "../prisma";

export async function triggerHostedWakeUser(input: {
  targetSeqHint?: string | null;
  timeoutMs?: number;
  userId: string;
}): Promise<boolean> {
  const client = readHostedExecutionControlClientIfConfigured(input.timeoutMs);

  if (!client) {
    return false;
  }

  await client.wakeUser(input.userId, {
    ...(input.targetSeqHint === undefined ? {} : { targetSeqHint: input.targetSeqHint }),
  });

  return true;
}

export async function triggerHostedWakeUserBestEffort(input: {
  context?: string;
  targetSeqHint?: string | null;
  timeoutMs?: number;
  userId: string;
}): Promise<boolean> {
  try {
    return await triggerHostedWakeUser(input);
  } catch (error) {
    console.error(
      input.context
        ? `Hosted wake handoff failed (${input.context}).`
        : "Hosted wake handoff failed.",
      formatHostedExecutionSafeLogError(error),
    );
    return false;
  }
}

export async function handoffHostedExecutionScheduledEventBestEffort(input: {
  context?: string;
  defer?: (drain: () => Promise<void>) => Promise<void> | void;
  eventId: string;
  outboxLimit?: number;
  prisma?: PrismaClient;
  timeoutMs?: number;
}): Promise<"missing" | "outbox" | "wake"> {
  const prisma = input.prisma ?? getPrisma();
  const target = await readHostedExecutionScheduledDispatchTarget({
    eventId: input.eventId,
    prisma,
  });

  if (!target) {
    return "missing";
  }

  if (target.route === "outbox") {
    const drain = () => drainHostedExecutionOutboxBestEffort({
      eventIds: [input.eventId],
      limit: input.outboxLimit ?? 1,
      prisma,
    });

    if (input.defer) {
      await input.defer(drain);
    } else {
      await drain();
    }

    return "outbox";
  }

  const nudge = () => triggerHostedWakeUserBestEffort({
    context: input.context,
    targetSeqHint: target.seq ?? null,
    timeoutMs: input.timeoutMs,
    userId: target.userId,
  });

  if (input.defer) {
    await input.defer(async () => {
      await nudge();
    });
  } else {
    await nudge();
  }

  return "wake";
}
