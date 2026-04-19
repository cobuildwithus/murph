import type { PrismaClient } from "@prisma/client";
import type { HostedExecutionWakeNudgeResult } from "@murphai/hosted-execution";

import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";
import { formatHostedExecutionSafeLogError } from "../hosted-execution/logging";

export async function nudgeHostedWakeUser(input: {
  timeoutMs?: number;
  userId: string;
}): Promise<HostedExecutionWakeNudgeResult | null> {
  const client = readHostedExecutionControlClientIfConfigured(input.timeoutMs);

  if (!client) {
    return null;
  }

  return await client.nudgeUserRunner(input.userId);
}

export async function nudgeHostedWakeUserBestEffort(input: {
  context?: string;
  timeoutMs?: number;
  userId: string;
}): Promise<boolean> {
  try {
    const result = await nudgeHostedWakeUser(input);
    return result?.accepted ?? false;
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
  const nudge = () => nudgeHostedWakeUserBestEffort({
    context: input.context,
    timeoutMs: input.timeoutMs,
    userId: input.userId,
  });

  try {
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

// Compatibility aliases for existing callers/tests while the wake surface
// transitions from drain semantics to simple nudges.
export const triggerHostedWakeUser = nudgeHostedWakeUser;
export const triggerHostedWakeUserBestEffort = nudgeHostedWakeUserBestEffort;
