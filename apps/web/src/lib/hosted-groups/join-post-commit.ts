import type { PrismaClient } from "@prisma/client";
import type { HostedGroupJoinAcceptanceResult, HostedGroupJoinAcceptanceTxResult } from "./group-store";
import { materializePendingHostedGroupJoinConfirmationsBestEffort, signalHostedGroupJoinConfirmationRuntimeBestEffort } from "./group-join-confirmation";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { createHostedPostCommitDeadline, readHostedPostCommitRemainingMs, waitForHostedPostCommitOperation } from "../hosted-onboarding/bounded-post-commit";

/** Durable work is committed already; waking the publisher is best effort. */
export async function finishHostedGroupJoin(input: {
  result: HostedGroupJoinAcceptanceTxResult; memberId: string; prisma: PrismaClient; signal?: AbortSignal;
}): Promise<HostedGroupJoinAcceptanceResult> {
  const { result, memberId, prisma, signal } = input;
  const { joinConfirmationSignal, projectionMaintenanceSignal, ...responseResult } = result;
  const postCommitDeadlineMs = createHostedPostCommitDeadline(undefined);
  const projectionWake = projectionMaintenanceSignal
    ? runHostedGroupJoinPostCommitBestEffort({
        deadlineMs: postCommitDeadlineMs,
        operation: (abortSignal) => signalHostedMailboxAppendRuntime({
          abortSignal,
          expectedUserId: projectionMaintenanceSignal.memberId,
          knownCheckpoint: {
            lane: projectionMaintenanceSignal.lane,
            laneSeq: projectionMaintenanceSignal.laneSeq,
            userId: projectionMaintenanceSignal.memberId,
          },
          mailboxItemId: projectionMaintenanceSignal.mailboxItemId,
        }),
      })
    : null;
  if (joinConfirmationSignal) {
    await signalHostedGroupJoinConfirmationRuntimeBestEffort({
      ...joinConfirmationSignal,
      prisma,
      signal,
      timeoutMs: readHostedPostCommitRemainingMs(postCommitDeadlineMs),
    });
  }
  await materializePendingHostedGroupJoinConfirmationsBestEffort({
    memberId,
    membershipId: result.membershipId,
    prisma,
    signal,
    timeoutMs: readHostedPostCommitRemainingMs(postCommitDeadlineMs),
  });
  await projectionWake;
  return responseResult;
}

async function runHostedGroupJoinPostCommitBestEffort(input: {
  deadlineMs: number;
  operation: (signal: AbortSignal) => Promise<unknown>;
}): Promise<void> {
  try {
    await waitForHostedPostCommitOperation({
      deadlineMs: input.deadlineMs,
      operation: input.operation,
    });
  } catch {
    // The durable join, grants, and mailbox items remain available for a later wake.
  }
}

