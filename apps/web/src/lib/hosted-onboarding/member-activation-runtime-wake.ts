import type { PrismaClient } from "@prisma/client";

import {
  describeHostedExecutionSafeLogErrorCode,
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";
import {
  materializePendingHostedGroupJoinConfirmationsBestEffort,
} from "../hosted-groups/group-join-confirmation";
import {
  signalHostedMailboxAppendRuntime,
} from "../hosted-orchestration/signal-runtime";
import { getPrisma } from "../prisma";
import {
  HOSTED_POST_COMMIT_TIMEOUT_MS,
  createHostedPostCommitDeadline,
  readHostedPostCommitRemainingMs,
  waitForHostedPostCommitOperation,
} from "./bounded-post-commit";

export interface HostedMemberActivationRuntimeWakeBestEffortResult {
  accepted: boolean;
  configured: boolean;
  errorCode: string | null;
  mailboxItemIdPresent: boolean;
  signalAccepted: boolean | null;
  workflowIdPresent: boolean | null;
}

export const HOSTED_MEMBER_ACTIVATION_RUNTIME_WAKE_TIMEOUT_MS =
  HOSTED_POST_COMMIT_TIMEOUT_MS;

export async function signalHostedMemberActivationRuntimeWakeBestEffortResult(
  input: {
    hostedExecutionEventId: string;
    mailboxItemId?: string | null;
    memberId: string;
    prisma?: PrismaClient;
    signal?: AbortSignal;
    source: string;
    timeoutMs?: number;
  },
): Promise<HostedMemberActivationRuntimeWakeBestEffortResult> {
  const prisma = input.prisma ?? getPrisma();
  let mailboxItemIdPresent = Boolean(input.mailboxItemId);
  const deadlineMs = createHostedPostCommitDeadline(input.timeoutMs);
  try {
    const activationMailboxItem = input.mailboxItemId
      ? {
        id: input.mailboxItemId,
        userId: input.memberId,
      }
      : await waitForHostedPostCommitOperation({
          deadlineMs,
          operation: () => prisma.hostedMailboxItem.findFirst({
            orderBy: {
              createdAt: "desc",
            },
            select: {
              id: true,
              userId: true,
            },
            where: {
              dedupeKey: input.hostedExecutionEventId,
              kind: "member.activated",
              userId: input.memberId,
            },
          }),
          signal: input.signal,
        });

    if (!activationMailboxItem) {
      return {
        accepted: false,
        configured: true,
        errorCode: "HOSTED_MEMBER_ACTIVATION_MAILBOX_ITEM_MISSING",
        mailboxItemIdPresent: false,
        signalAccepted: null,
        workflowIdPresent: null,
      };
    }
    mailboxItemIdPresent = true;

    const signal = await waitForHostedPostCommitOperation({
      deadlineMs,
      operation: () => signalHostedMailboxAppendRuntime({
        expectedUserId: activationMailboxItem.userId,
        mailboxItemId: activationMailboxItem.id,
        prisma,
      }),
      signal: input.signal,
    });

    return {
      accepted: true,
      configured: true,
      errorCode: null,
      mailboxItemIdPresent: true,
      signalAccepted: signal.signalAccepted,
      workflowIdPresent: Boolean(signal.workflowId),
    };
  } catch (error) {
    if (isHostedRuntimeTemporalNotConfiguredError(error)) {
      return {
        accepted: false,
      configured: false,
      errorCode: null,
      mailboxItemIdPresent,
        signalAccepted: null,
        workflowIdPresent: null,
      };
    }

    const errorCode = describeHostedExecutionSafeLogErrorCode(error);

    console.error("Hosted member activation mailbox wake signal failed.", {
      ...formatHostedExecutionSafeLogErrorDetails(error, { code: errorCode }),
    });
    return {
      accepted: false,
      configured: true,
      errorCode,
      mailboxItemIdPresent,
      signalAccepted: null,
      workflowIdPresent: null,
    };
  } finally {
    await materializePendingHostedGroupJoinConfirmationsBestEffort({
      memberId: input.memberId,
      prisma,
      ...(input.signal ? { signal: input.signal } : {}),
      timeoutMs: readHostedPostCommitRemainingMs(deadlineMs),
    });
  }
}

function isHostedRuntimeTemporalNotConfiguredError(error: unknown): boolean {
  return error instanceof Error &&
    error.message === "Hosted runtime Temporal client is not configured.";
}
