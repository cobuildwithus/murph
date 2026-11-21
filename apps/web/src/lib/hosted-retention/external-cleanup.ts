import "server-only";

import type { PrismaClient } from "@prisma/client";

import { resumeConfirmedAccountDeletion } from "../hosted-privacy/account-data-service";
import { ComputerUseService } from "../computer-use/service";
import { PrismaComputerUseStore } from "../computer-use/store";
import { getPrisma } from "../prisma";
import {
  drainHostedAccountDeletionCleanupBatch,
  type HostedAccountDeletionCleanupBatchResult,
} from "../hosted-privacy/account-deletion-cleanup";
import { runHostedRuntimeResourceCleanup } from "../hosted-execution/runtime-resource-cleanup";
import { redriveHostedHealthDataConsentCleanups, redriveHostedHealthDataConsentStops } from "../hosted-privacy/health-data-consent-withdrawal";
import { sweepHostedLinqGroupLeaves } from "../hosted-routing/linq-group-leave";
import { normalizeHostedRetentionDate } from "./cleanup";

export interface HostedExternalRetentionCleanupResult {
  confirmedAccountDeletion: Awaited<ReturnType<typeof resumeConfirmedAccountDeletion>>;
  healthDataConsentStopRedrive: Awaited<ReturnType<typeof redriveHostedHealthDataConsentStops>>;
  healthDataConsentCleanupRedrive: Awaited<ReturnType<typeof redriveHostedHealthDataConsentCleanups>>;
  accountDeletionCleanup: HostedAccountDeletionCleanupBatchResult;
  runtimeResourceCleanup: Awaited<ReturnType<typeof runHostedRuntimeResourceCleanup>>;
  expiredComputerRunsCleanedUp: number;
  linqGroupLeaveAttempts: number;
}

export async function runHostedExternalRetentionCleanup(input: {
  now?: Date | string;
  prisma?: PrismaClient;
  request: Request;
}): Promise<HostedExternalRetentionCleanupResult> {
  const prisma = input.prisma ?? getPrisma();
  const healthDataConsentStopRedrive = await redriveHostedHealthDataConsentStops({ prisma });
  const now = normalizeHostedRetentionDate(input.now ?? new Date());
  const linqGroupLeaveAttempts = await sweepHostedLinqGroupLeaves({ prisma, now });
  const accountDeletionCleanup = await drainHostedAccountDeletionCleanupBatch({
    now,
    prisma,
  });
  const expiredComputerRunsCleanedUp = await new ComputerUseService({
    now: () => now,
    store: new PrismaComputerUseStore(prisma),
  }).cleanupExpiredRuns({ now }).then((result) => result.expiredRuns);

  const runtimeResourceCleanup = await runHostedRuntimeResourceCleanup({ now, prisma });
  const healthDataConsentCleanupRedrive = await redriveHostedHealthDataConsentCleanups({ now, prisma, request: input.request });

  const confirmedAccountDeletion = await resumeConfirmedAccountDeletion({ now, prisma, request: input.request });
  return {
    confirmedAccountDeletion,
    linqGroupLeaveAttempts,
    healthDataConsentStopRedrive,
    healthDataConsentCleanupRedrive,
    runtimeResourceCleanup,
    accountDeletionCleanup,
    expiredComputerRunsCleanedUp,
  };
}
