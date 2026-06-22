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
  mailboxLane: HostedMailboxLane;
  nextWakeAt?: HostedMailboxOutcome["nextWakeAt"];
  nextWakeReason?: HostedMailboxOutcome["nextWakeReason"];
  postCheckpointRecord?: HostedMailboxOutcome["postCheckpointRecord"];
  redactedLogEntries?: HostedExecutionRedactedLogEntry[];
}): HostedMailboxOutcome {
  return {
    conversationMetrics: input.conversationMetrics,
    nextWakeAt: input.nextWakeAt ?? null,
    ...(input.nextWakeReason === undefined
      ? {}
      : { nextWakeReason: input.nextWakeReason ?? null }),
    mailboxLane: input.mailboxLane,
    postCheckpointRecord: input.postCheckpointRecord ?? null,
    redactedLogEntries: input.redactedLogEntries ?? [],
  };
}

