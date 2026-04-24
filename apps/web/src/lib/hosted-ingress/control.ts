import type { HostedRunNudgeResult } from "@murphai/hosted-execution";

import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";
import { formatHostedExecutionSafeLogError } from "../hosted-execution/logging";

export async function nudgeHostedRunUser(input: {
  timeoutMs?: number;
  userId: string;
}): Promise<HostedRunNudgeResult | null> {
  const client = readHostedExecutionControlClientIfConfigured(input.timeoutMs);

  if (!client) {
    return null;
  }

  return await client.nudgeUserRun(input.userId);
}

export async function nudgeHostedRunUserBestEffort(input: {
  context?: string;
  timeoutMs?: number;
  userId: string;
}): Promise<boolean> {
  try {
    const result = await nudgeHostedRunUser(input);
    return result?.accepted ?? false;
  } catch (error) {
    console.error(
      input.context
        ? `Hosted run nudge failed (${input.context}).`
        : "Hosted run nudge failed.",
      formatHostedExecutionSafeLogError(error),
    );
    return false;
  }
}

export async function nudgeHostedRunBestEffort(input: {
  context?: string;
  timeoutMs?: number;
  userId: string;
}): Promise<void> {
  await nudgeHostedRunUserBestEffort({
    context: input.context,
    timeoutMs: input.timeoutMs,
    userId: input.userId,
  });
}
