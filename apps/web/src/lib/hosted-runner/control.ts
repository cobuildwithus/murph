import type { HostedRunnerNudgeResult } from "@murphai/hosted-execution";

import { readHostedExecutionControlClientIfConfigured } from "../hosted-execution/control";
import { formatHostedExecutionSafeLogError } from "../hosted-execution/logging";

export async function nudgeHostedRunnerUser(input: {
  timeoutMs?: number;
  userId: string;
}): Promise<HostedRunnerNudgeResult | null> {
  const client = readHostedExecutionControlClientIfConfigured(input.timeoutMs);

  if (!client) {
    return null;
  }

  return await client.nudgeUserRunner(input.userId);
}

export async function nudgeHostedRunnerUserBestEffort(input: {
  context?: string;
  timeoutMs?: number;
  userId: string;
}): Promise<boolean> {
  try {
    const result = await nudgeHostedRunnerUser(input);
    return result?.accepted ?? false;
  } catch (error) {
    console.error(
      input.context
        ? `Hosted runner nudge failed (${input.context}).`
        : "Hosted runner nudge failed.",
      formatHostedExecutionSafeLogError(error),
    );
    return false;
  }
}

export async function nudgeHostedRunnerBestEffort(input: {
  context?: string;
  timeoutMs?: number;
  userId: string;
}): Promise<void> {
  await nudgeHostedRunnerUserBestEffort({
    context: input.context,
    timeoutMs: input.timeoutMs,
    userId: input.userId,
  });
}
