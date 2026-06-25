import type {
  HostedExecutionManagedAutomationSeedRequestedWake,
} from "@murphai/hosted-execution";

import {
  seedHostedManagedAutomationsBestEffort,
  resolveHostedManagedAutomationSeedNextWakeAt,
} from "../managed-automation-seeding.ts";
import type {
  NormalizedHostedAssistantRuntimeConfig,
} from "../models.ts";
import { HOSTED_ASSISTANT_WAKE_REASON } from "../wake-candidates.ts";
import { buildHostedAssistantAutomationRoute } from "./automation-route.ts";
import {
  createNoopMailboxEffect,
  type HostedMailboxOutcome,
} from "./mailbox-outcome.ts";

export async function executeHostedManagedAutomationSeedWake(input: {
  operatorHomeRoot: string | null;
  runtime: Pick<NormalizedHostedAssistantRuntimeConfig, "platform">;
  runtimeEnv: Readonly<Record<string, string>>;
  shouldYieldBackgroundMaintenance?: (() => boolean) | null;
  vaultRoot: string;
  wake: HostedExecutionManagedAutomationSeedRequestedWake;
}): Promise<HostedMailboxOutcome> {
  const nowMs = Date.now();
  const seedResult = await seedHostedManagedAutomationsBestEffort({
    defaultRoute: buildHostedAssistantAutomationRoute(input.wake.route),
    nowMs,
    operatorHomeRoot: input.operatorHomeRoot,
    runtimeEnv: input.runtimeEnv,
    runtimeLog: {
      context: null,
      platform: input.runtime.platform,
    },
    shouldYieldBackgroundMaintenance: input.shouldYieldBackgroundMaintenance ?? null,
    vaultRoot: input.vaultRoot,
  });
  const nextWakeAt = seedResult
    ? await resolveHostedManagedAutomationSeedNextWakeAt({
        nowMs,
        vaultRoot: input.vaultRoot,
      })
    : null;

  return createNoopMailboxEffect({
    conversationMetrics: null,
    mailboxLane: "managed-automation-seed",
    nextWakeAt,
    nextWakeReason: nextWakeAt ? HOSTED_ASSISTANT_WAKE_REASON : null,
  });
}
