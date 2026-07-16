import type { PrismaClient } from "@prisma/client";

import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  createRetellPhoneCallAccountDeletionRuntime,
  type RetellPhoneCallAccountDeletionRuntime,
} from "./retell-runtime";
import {
  HOSTED_PHONE_CALL_ACTIVE_STATUSES,
  isHostedPhoneCallProviderCleanupPending,
  isHostedPhoneCallReadyForProviderReconciliation,
} from "./authority";

type HostedPhoneCallAccountDeletionStore = {
  hostedPhoneCall: Pick<
    PrismaClient["hostedPhoneCall"],
    "count" | "findMany" | "findUnique" | "updateMany"
  >;
};

export const HOSTED_PHONE_CALL_ACCOUNT_DELETION_BATCH_SIZE = 8;
export const HOSTED_PHONE_CALL_ACCOUNT_DELETION_TIMEOUT_MS = 35_000;

export async function deleteHostedPhoneCallsForAccountDeletion(input: {
  memberIds: readonly string[];
  prisma: HostedPhoneCallAccountDeletionStore;
  runtime?: RetellPhoneCallAccountDeletionRuntime;
  signal?: AbortSignal;
}): Promise<void> {
  const signal = input.signal
    ? AbortSignal.any([
        input.signal,
        AbortSignal.timeout(HOSTED_PHONE_CALL_ACCOUNT_DELETION_TIMEOUT_MS),
      ])
    : AbortSignal.timeout(HOSTED_PHONE_CALL_ACCOUNT_DELETION_TIMEOUT_MS);
  signal.throwIfAborted();
  const calls = await input.prisma.hostedPhoneCall.findMany({
    orderBy: [
      { updatedAt: "asc" },
      { id: "asc" },
    ],
    select: {
      analyzedAt: true,
      endedAt: true,
      id: true,
      provider: true,
      providerCallId: true,
      status: true,
      updatedAt: true,
    },
    where: {
      memberId: { in: [...input.memberIds] },
      provider: "retell",
      OR: [
        { providerCallId: { not: null } },
        { status: { in: [...HOSTED_PHONE_CALL_ACTIVE_STATUSES] } },
      ],
    },
    take: HOSTED_PHONE_CALL_ACCOUNT_DELETION_BATCH_SIZE + 1,
  });
  if (calls.length === 0) {
    return;
  }
  const hasMoreCalls = calls.length > HOSTED_PHONE_CALL_ACCOUNT_DELETION_BATCH_SIZE;
  const selectedCalls = calls.slice(0, HOSTED_PHONE_CALL_ACCOUNT_DELETION_BATCH_SIZE);
  const runtime = input.runtime ?? createRetellPhoneCallAccountDeletionRuntime();
  let cleanupFailure: unknown;

  for (const call of selectedCalls) {
    try {
      signal.throwIfAborted();
    } catch (error) {
      cleanupFailure ??= error;
      break;
    }
    const providerCallId = call.providerCallId;
    if (!providerCallId) {
      continue;
    }
    cleanupFailure = await deleteProviderCallAndPersistCompletion({
      call: {
        ...call,
        providerCallId,
      },
      prisma: input.prisma,
      runtime,
      signal,
    }) ?? cleanupFailure;
  }

  for (const call of selectedCalls) {
    if (signal.aborted) {
      cleanupFailure ??= signal.reason;
      break;
    }
    if (call.providerCallId) {
      continue;
    }
    if (!isHostedPhoneCallReadyForProviderReconciliation(call)) {
      cleanupFailure ??= new Error("Phone call provider authority is still pending.");
      continue;
    }

    let resolution: Awaited<ReturnType<RetellPhoneCallAccountDeletionRuntime["resolveProviderCall"]>>;
    try {
      resolution = await runtime.resolveProviderCall(call.id, { signal });
    } catch (error) {
      cleanupFailure ??= error;
      continue;
    }

    if (resolution.state === "not_found") {
      try {
        await input.prisma.hostedPhoneCall.updateMany({
          data: { status: "failed" },
          where: {
            analyzedAt: null,
            endedAt: null,
            id: call.id,
            provider: "retell",
            providerCallId: null,
            status: "starting",
          },
        });
      } catch (error) {
        cleanupFailure ??= error;
      }
      continue;
    }

    let boundCall: Parameters<
      typeof deleteProviderCallAndPersistCompletion
    >[0]["call"] | null = null;
    try {
      const bound = await input.prisma.hostedPhoneCall.updateMany({
        data: {
          providerCallId: resolution.providerCallId,
          status: resolution.state === "found" ? "calling" : "failed",
        },
        where: {
          analyzedAt: null,
          endedAt: null,
          id: call.id,
          provider: "retell",
          providerCallId: null,
          status: "starting",
        },
      });
      if (bound.count > 0) {
        boundCall = {
          ...call,
          providerCallId: resolution.providerCallId,
          status: resolution.state === "found" ? "calling" : "failed",
        };
      } else {
        const current = await input.prisma.hostedPhoneCall.findUnique({
          select: {
            analyzedAt: true,
            endedAt: true,
            id: true,
            provider: true,
            providerCallId: true,
            status: true,
          },
          where: { id: call.id },
        });
        if (
          current
          && current.providerCallId === resolution.providerCallId
          && (
            current.status === "starting"
            || current.status === "calling"
            || isHostedPhoneCallProviderCleanupPending(current)
          )
        ) {
          boundCall = {
            ...current,
            providerCallId: current.providerCallId,
          };
        } else if (
          !current
          || current.providerCallId !== resolution.providerCallId
        ) {
          cleanupFailure ??= new Error(
            "Recovered phone call provider authority could not be persisted.",
          );
        }
      }
    } catch (error) {
      cleanupFailure ??= error;
      continue;
    }
    if (!boundCall) {
      continue;
    }
    cleanupFailure = await deleteProviderCallAndPersistCompletion({
      call: boundCall,
      prisma: input.prisma,
      runtime,
      signal,
    }) ?? cleanupFailure;
  }

  if (hasMoreCalls) {
    cleanupFailure ??= new Error("Phone call cleanup has another bounded batch pending.");
  }

  if (cleanupFailure !== undefined) {
    throw phoneCallCleanupError(cleanupFailure);
  }
}

async function deleteProviderCallAndPersistCompletion(input: {
  call: {
    analyzedAt: Date | null;
    endedAt: Date | null;
    id: string;
    provider: string;
    providerCallId: string;
    status: "starting" | "calling" | "ended" | "completed" | "needs_user" | "failed";
  };
  prisma: HostedPhoneCallAccountDeletionStore;
  runtime: RetellPhoneCallAccountDeletionRuntime;
  signal: AbortSignal;
}): Promise<unknown | undefined> {
  try {
    input.signal.throwIfAborted();
    await input.runtime.deleteProviderCall(input.call.providerCallId, {
      signal: input.signal,
    });
    await input.prisma.hostedPhoneCall.updateMany({
      data: {
        ...(input.call.status === "starting" || input.call.status === "calling"
          ? {
            endedAt: new Date(),
            status: "ended" as const,
          }
          : isHostedPhoneCallProviderCleanupPending(input.call)
            ? {
              endedAt: new Date(),
              status: "failed" as const,
            }
            : {}),
        providerCallId: null,
      },
      where: {
        id: input.call.id,
        providerCallId: input.call.providerCallId,
      },
    });
    return undefined;
  } catch (error) {
    return error;
  }
}

export async function assertHostedPhoneCallsReadyForAccountDeletionTx(input: {
  memberIds: readonly string[];
  prisma: HostedPhoneCallAccountDeletionStore;
}): Promise<void> {
  const activeCallCount = await input.prisma.hostedPhoneCall.count({
    where: {
      memberId: { in: [...input.memberIds] },
      provider: "retell",
      OR: [
        { providerCallId: { not: null } },
        { status: { in: [...HOSTED_PHONE_CALL_ACTIVE_STATUSES] } },
      ],
    },
  });
  if (activeCallCount > 0) {
    throw phoneCallCleanupError();
  }
}

function phoneCallCleanupError(cause?: unknown) {
  return hostedOnboardingError({
    cause,
    code: "ACCOUNT_DELETION_PHONE_CALL_CLEANUP_FAILED",
    httpStatus: 502,
    message: "We could not safely delete your phone-call data. Retry account deletion, or contact support if it keeps failing.",
    retryable: true,
  });
}
