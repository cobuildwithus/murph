import type { PrismaClient } from "@prisma/client";

import {
  formatHostedExecutionSafeLogError,
} from "../hosted-execution/logging";
import {
  signalHostedMailboxAppendRuntime,
} from "../hosted-orchestration/signal-runtime";
import { getPrisma } from "../prisma";

export interface HostedMemberActivationRuntimeWakeBestEffortResult {
  accepted: boolean;
  configured: boolean;
  errorCode: string | null;
  mailboxItemIdPresent: boolean;
  signalAccepted: boolean | null;
  workflowIdPresent: boolean | null;
}

export async function signalHostedMemberActivationRuntimeWakeBestEffortResult(
  input: {
    hostedExecutionEventId: string;
    mailboxItemId?: string | null;
    memberId: string;
    prisma?: PrismaClient;
    source: string;
    timeoutMs?: number;
  },
): Promise<HostedMemberActivationRuntimeWakeBestEffortResult> {
  const prisma = input.prisma ?? getPrisma();
  const activationMailboxItem = input.mailboxItemId
    ? {
      id: input.mailboxItemId,
      userId: input.memberId,
    }
    : await prisma.hostedMailboxItem.findFirst({
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

  try {
    const signalPromise = signalHostedMailboxAppendRuntime({
      expectedUserId: activationMailboxItem.userId,
      mailboxItemId: activationMailboxItem.id,
      prisma,
      source: input.source,
    });
    const signal = await withActivationRuntimeWakeTimeout(signalPromise, input.timeoutMs);

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
        mailboxItemIdPresent: true,
        signalAccepted: null,
        workflowIdPresent: null,
      };
    }

    console.error(
      "Hosted member activation mailbox wake signal failed.",
      formatHostedExecutionSafeLogError(error),
    );
    return {
      accepted: false,
      configured: true,
      errorCode: error instanceof Error && error.name ? error.name : "UnknownError",
      mailboxItemIdPresent: true,
      signalAccepted: null,
      workflowIdPresent: null,
    };
  }
}

function isHostedRuntimeTemporalNotConfiguredError(error: unknown): boolean {
  return error instanceof Error &&
    error.message === "Hosted runtime Temporal client is not configured.";
}

async function withActivationRuntimeWakeTimeout<T>(
  signalPromise: Promise<T>,
  timeoutMs: number | undefined,
): Promise<T> {
  const normalizedTimeoutMs = normalizeActivationRuntimeWakeTimeoutMs(timeoutMs);
  if (normalizedTimeoutMs === null) {
    return await signalPromise;
  }

  signalPromise.catch(() => undefined);

  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      signalPromise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(createActivationRuntimeWakeTimeoutError(normalizedTimeoutMs));
        }, normalizedTimeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
  }
}

function normalizeActivationRuntimeWakeTimeoutMs(timeoutMs: number | undefined): number | null {
  if (
    typeof timeoutMs !== "number" ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    return null;
  }

  return Math.ceil(timeoutMs);
}

function createActivationRuntimeWakeTimeoutError(timeoutMs: number): Error {
  const error = new Error(`Hosted member activation runtime wake timed out after ${timeoutMs}ms.`);
  error.name = "TimeoutError";
  return error;
}
