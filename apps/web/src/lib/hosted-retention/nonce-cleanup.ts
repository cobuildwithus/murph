import "server-only";

import type { PrismaClient } from "@prisma/client";

import { getPrisma } from "../prisma";
import { deleteExpiredHostedBrowserAssertionNonces } from "./browser-assertion-nonces";
import {
  deleteExpiredHostedCallbackRequestNonces,
  normalizeHostedRetentionDate,
} from "./cleanup";

export interface HostedNonceRetentionCleanupResult {
  expiredBrowserAssertionNoncesDeleted: number;
  expiredCallbackRequestNoncesDeleted: number;
}

export async function runHostedNonceRetentionCleanup(input: {
  now?: Date | string;
  prisma?: PrismaClient;
} = {}): Promise<HostedNonceRetentionCleanupResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = normalizeHostedRetentionDate(input.now ?? new Date());
  // Finish the small browser-nonce lane before the high-volume callback
  // catch-up budget so a saturated callback backlog cannot starve it.
  const expiredBrowserAssertionNoncesDeleted =
    await deleteExpiredHostedBrowserAssertionNonces({ now, prisma });
  const expiredCallbackRequestNoncesDeleted =
    await deleteExpiredHostedCallbackRequestNonces({ prisma });

  return {
    expiredBrowserAssertionNoncesDeleted,
    expiredCallbackRequestNoncesDeleted,
  };
}
