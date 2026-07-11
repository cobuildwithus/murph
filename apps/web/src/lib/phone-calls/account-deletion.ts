import type { HostedPhoneCallStatus, PrismaClient } from "@prisma/client";

import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  createRetellPhoneCallAccountDeletionRuntime,
  type RetellPhoneCallAccountDeletionRuntime,
} from "./retell-runtime";

const ACTIVE_PHONE_CALL_STATUSES = ["starting", "calling"] as const satisfies readonly HostedPhoneCallStatus[];

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
      id: true,
      providerCallId: true,
    },
    where: {
      memberId: { in: [...input.memberIds] },
      status: { in: [...ACTIVE_PHONE_CALL_STATUSES] },
    },
  });
  if (calls.length === 0) {
    return;
  }
  if (calls.some((call) => call.providerCallId === null)) {
    throw phoneCallCleanupError();
  }

  const runtime = input.runtime ?? createRetellPhoneCallAccountDeletionRuntime();
  try {
    for (const call of calls) {
      const providerCallId = call.providerCallId;
      if (!providerCallId) {
        throw phoneCallCleanupError();
      }
      await runtime.stopIfActive(providerCallId);
      await input.prisma.hostedPhoneCall.updateMany({
        data: {
          endedAt: new Date(),
          status: "ended",
        },
        where: {
          id: call.id,
          status: { in: [...ACTIVE_PHONE_CALL_STATUSES] },
        },
      });
    }
  } catch (error) {
    throw phoneCallCleanupError(error);
  }
}

export async function assertHostedPhoneCallsReadyForAccountDeletionTx(input: {
  memberIds: readonly string[];
  prisma: HostedPhoneCallAccountDeletionStore;
}): Promise<void> {
  const activeCallCount = await input.prisma.hostedPhoneCall.count({
    where: {
      memberId: { in: [...input.memberIds] },
      status: { in: [...ACTIVE_PHONE_CALL_STATUSES] },
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
