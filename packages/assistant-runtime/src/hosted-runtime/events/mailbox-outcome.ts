import type { HostedExecutionRedactedLogEntry } from "@murphai/hosted-execution";

import type {
  HostedConversationWakeMetrics,
  HostedMailboxEffect,
  HostedMailboxLane,
} from "../models.ts";

export type HostedMailboxOutcome = HostedMailboxEffect & {
  mailboxLane: HostedMailboxLane;
};

export function createNoopMailboxEffect(input: {
  backgroundMaintenanceYielded?: true;
  conversationMetrics: HostedConversationWakeMetrics | null;
  deliveryIntentIds?: readonly string[] | null;
  mailboxLane: HostedMailboxLane;
  nextWakeAt?: HostedMailboxOutcome["nextWakeAt"];
  nextWakeReason?: HostedMailboxOutcome["nextWakeReason"];
  postCheckpointRecord?: HostedMailboxOutcome["postCheckpointRecord"];
  redactedLogEntries?: HostedExecutionRedactedLogEntry[];
}): HostedMailboxOutcome {
  return {
    ...(input.backgroundMaintenanceYielded === true
      ? { backgroundMaintenanceYielded: true as const }
      : {}),
    conversationMetrics: input.conversationMetrics,
    ...(input.deliveryIntentIds === undefined
      ? {}
      : { deliveryIntentIds: input.deliveryIntentIds }),
    nextWakeAt: input.nextWakeAt ?? null,
    ...(input.nextWakeReason === undefined
      ? {}
      : { nextWakeReason: input.nextWakeReason ?? null }),
    mailboxLane: input.mailboxLane,
    postCheckpointRecord: input.postCheckpointRecord ?? null,
    redactedLogEntries: input.redactedLogEntries ?? [],
  };
}
