import "server-only";

import type { PrismaClient } from "@prisma/client";

import { ComputerUseService } from "../computer-use/service";
import { PrismaComputerUseStore } from "../computer-use/store";
import { getPrisma } from "../prisma";
import {
  drainHostedAccountDeletionCleanupBatch,
  type HostedAccountDeletionCleanupBatchResult,
} from "../hosted-privacy/account-deletion-cleanup";
import { normalizeHostedRetentionDate } from "./cleanup";

export interface HostedExternalRetentionCleanupResult {
  accountDeletionCleanup: HostedAccountDeletionCleanupBatchResult;
  expiredComputerRunsCleanedUp: number;
}

export async function runHostedExternalRetentionCleanup(input: {
  now?: Date | string;
  prisma?: PrismaClient;
} = {}): Promise<HostedExternalRetentionCleanupResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = normalizeHostedRetentionDate(input.now ?? new Date());
  const accountDeletionCleanup = await drainHostedAccountDeletionCleanupBatch({
    now,
    prisma,
  });
  const expiredComputerRunsCleanedUp = await new ComputerUseService({
    now: () => now,
    store: new PrismaComputerUseStore(prisma),
  }).cleanupExpiredRuns({ now }).then((result) => result.expiredRuns);

  return {
    accountDeletionCleanup,
    expiredComputerRunsCleanedUp,
  };
}
