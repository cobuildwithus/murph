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
  const expiredCallbackRequestNoncesDeleted =
    await deleteExpiredHostedCallbackRequestNonces({ prisma });
  const expiredBrowserAssertionNoncesDeleted =
    await deleteExpiredHostedBrowserAssertionNonces({ now, prisma });

  return {
    expiredBrowserAssertionNoncesDeleted,
    expiredCallbackRequestNoncesDeleted,
  };
}
