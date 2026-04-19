import type { HostedExecutionWakeDrainResult } from "@murphai/hosted-execution/contracts";
import type { PrismaClient } from "@prisma/client";

import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";
import { formatHostedExecutionSafeLogError } from "../hosted-execution/logging";
import {
  readHostedWakeTarget,
} from "./lifecycle";
import { getPrisma } from "../prisma";

export async function triggerHostedWakeUser(input: {
  targetSeqHint?: string | null;
  timeoutMs?: number;
  userId: string;
}): Promise<HostedExecutionWakeDrainResult | null> {
  const client = readHostedExecutionControlClientIfConfigured(input.timeoutMs);

  if (!client) {
    return null;
  }

  return await client.wakeUser(input.userId, {
    ...(input.targetSeqHint === undefined ? {} : { targetSeqHint: input.targetSeqHint }),
  });
}

export async function triggerHostedWakeUserBestEffort(input: {
  context?: string;
  targetSeqHint?: string | null;
  timeoutMs?: number;
  userId: string;
}): Promise<boolean> {
  try {
    const result = await triggerHostedWakeUser(input);

    if (!result) {
      return false;
    }

    return input.targetSeqHint == null || result.targetReached;
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

export async function handoffHostedExecutionWakeBestEffort(input: {
  context?: string;
  defer?: (drain: () => Promise<void>) => Promise<void> | void;
  eventId: string;
  prisma?: PrismaClient;
  timeoutMs?: number;
  userId: string;
}): Promise<void> {
  try {
    const prisma = input.prisma ?? getPrisma();
    const target = await readHostedWakeTarget({
      eventId: input.eventId,
      prisma,
      userId: input.userId,
    });

    if (!target) {
      return;
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
      return;
    }

    await nudge();
  } catch (error) {
    console.error(
      input.context
        ? `Hosted wake handoff failed (${input.context}).`
        : "Hosted wake handoff failed.",
      formatHostedExecutionSafeLogError(error),
    );
  }
}
