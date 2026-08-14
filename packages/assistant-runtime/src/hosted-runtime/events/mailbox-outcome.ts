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
  conversationMetrics: HostedConversationWakeMetrics | null;
  deliveryIntentIds?: readonly string[] | null;
  mailboxLane: HostedMailboxLane;
  nextWakeAt?: HostedMailboxOutcome["nextWakeAt"];
  nextWakeReason?: HostedMailboxOutcome["nextWakeReason"];
  postCheckpointRecord?: HostedMailboxOutcome["postCheckpointRecord"];
  providerSetupContinuationAccepted?: boolean | null;
  redactedLogEntries?: HostedExecutionRedactedLogEntry[];
}): HostedMailboxOutcome {
  return {
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
    ...(input.providerSetupContinuationAccepted === undefined
      ? {}
      : {
          providerSetupContinuationAccepted:
            input.providerSetupContinuationAccepted,
        }),
    redactedLogEntries: input.redactedLogEntries ?? [],
  };
}
