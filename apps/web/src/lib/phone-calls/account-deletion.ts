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
    "count" | "findMany" | "updateMany"
  >;
};

export async function stopHostedPhoneCallsForAccountDeletion(input: {
  memberIds: readonly string[];
  prisma: HostedPhoneCallAccountDeletionStore;
  runtime?: RetellPhoneCallAccountDeletionRuntime;
}): Promise<void> {
  const calls = await input.prisma.hostedPhoneCall.findMany({
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
      OR: [
        { status: { in: [...HOSTED_PHONE_CALL_ACTIVE_STATUSES] } },
        {
          analyzedAt: null,
          endedAt: null,
          provider: "retell",
          providerCallId: { not: null },
          status: "failed",
        },
      ],
    },
  });
  if (calls.length === 0) {
    return;
  }
  const runtime = input.runtime ?? createRetellPhoneCallAccountDeletionRuntime();
  let cleanupFailure: unknown;

  for (const call of calls) {
    const providerCallId = call.providerCallId;
    if (!providerCallId) {
      continue;
    }
    cleanupFailure = await stopProviderCallAndPersistTerminal({
      call: {
        ...call,
        providerCallId,
      },
      prisma: input.prisma,
      runtime,
    }) ?? cleanupFailure;
  }

  for (const call of calls) {
    if (call.providerCallId) {
      continue;
    }
    if (!isHostedPhoneCallReadyForProviderReconciliation(call)) {
      cleanupFailure ??= new Error("Phone call provider authority is still pending.");
      continue;
    }

    let resolution: Awaited<ReturnType<RetellPhoneCallAccountDeletionRuntime["resolveProviderCall"]>>;
    try {
      resolution = await runtime.resolveProviderCall(call.id);
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

    try {
      await input.prisma.hostedPhoneCall.updateMany({
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
    } catch (error) {
      cleanupFailure ??= error;
    }
    cleanupFailure = await stopProviderCallAndPersistTerminal({
      call: {
        ...call,
        providerCallId: resolution.providerCallId,
        status: resolution.state === "found" ? "calling" : "failed",
      },
      persistProviderCallId: true,
      prisma: input.prisma,
      runtime,
    }) ?? cleanupFailure;
  }

  if (cleanupFailure !== undefined) {
    throw phoneCallCleanupError(cleanupFailure);
  }
}

async function stopProviderCallAndPersistTerminal(input: {
  call: {
    analyzedAt: Date | null;
    endedAt: Date | null;
    id: string;
    provider: string;
    providerCallId: string;
    status: "starting" | "calling" | "ended" | "completed" | "needs_user" | "failed";
  };
  persistProviderCallId?: boolean;
  prisma: HostedPhoneCallAccountDeletionStore;
  runtime: RetellPhoneCallAccountDeletionRuntime;
}): Promise<unknown | undefined> {
  try {
    await input.runtime.stopIfActive(input.call.providerCallId);
    await input.prisma.hostedPhoneCall.updateMany({
      data: {
        endedAt: new Date(),
        ...(input.persistProviderCallId
          ? { providerCallId: input.call.providerCallId }
          : {}),
        status: isHostedPhoneCallProviderCleanupPending(input.call)
          ? "failed"
          : "ended",
      },
      where: {
        id: input.call.id,
        status: {
          in: [...HOSTED_PHONE_CALL_ACTIVE_STATUSES, "failed"],
        },
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
      OR: [
        { status: { in: [...HOSTED_PHONE_CALL_ACTIVE_STATUSES] } },
        {
          analyzedAt: null,
          endedAt: null,
          provider: "retell",
          providerCallId: { not: null },
          status: "failed",
        },
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
    message: "We could not safely end your active phone calls. Retry account deletion, or contact support if it keeps failing.",
    retryable: true,
  });
}
