import "server-only";

import type {
  HostedRuntimeLogEntry,
} from "@murphai/hosted-execution/runtime-control";

import {
  shouldWriteHostedRuntimeLogsToDedicatedDatabase,
} from "./database";
import {
  recordHostedRuntimeLogs as recordDedicatedHostedRuntimeLogs,
} from "./store";
import {
  recordHostedRuntimeLogs as recordLegacyHostedRuntimeLogs,
} from "../hosted-workspace/store";

/**
 * The explicit rollout mode controls only new writes. Local development and
 * unit tests default to the legacy Prisma writer, while production can stage
 * the cleanup-aware isolated owner before switching writes to it.
 */
export async function writeHostedRuntimeLogs(input: {
  entries: readonly HostedRuntimeLogEntry[];
  userId: string;
}): Promise<number> {
  if (shouldWriteHostedRuntimeLogsToDedicatedDatabase()) {
    return recordDedicatedHostedRuntimeLogs(input);
  }

  return recordLegacyHostedRuntimeLogs({
    entries: input.entries.map((entry) => ({
      at: entry.at,
      component: entry.component,
      eventCode: entry.eventCode,
      level: entry.level,
      phase: entry.phase,
      ...(entry.attemptId === undefined ? {} : { attemptId: entry.attemptId }),
      ...(entry.checkpointVersion === undefined
        ? {}
        : { checkpointVersion: entry.checkpointVersion }),
      ...(entry.errorCode === undefined ? {} : { errorCode: entry.errorCode }),
      ...(entry.leaseGeneration === undefined
        ? {}
        : { leaseGeneration: entry.leaseGeneration }),
      ...(entry.mailboxLane === undefined ? {} : { mailboxLane: entry.mailboxLane }),
      ...(entry.mailboxSeqEnd === undefined
        ? {}
        : { mailboxSeqEnd: entry.mailboxSeqEnd }),
      ...(entry.mailboxSeqStart === undefined
        ? {}
        : { mailboxSeqStart: entry.mailboxSeqStart }),
      ...(entry.outboxIntentRef === undefined
        ? {}
        : { outboxIntentRef: entry.outboxIntentRef }),
      ...(entry.redactedJson === undefined ? {} : { redacted: entry.redactedJson }),
      ...(entry.workspaceVersion === undefined
        ? {}
        : { workspaceVersion: entry.workspaceVersion }),
    })),
    userId: input.userId,
  });
}
