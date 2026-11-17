import { Prisma, type PrismaClient } from "@prisma/client";

/** A routine Junction daily-total batch waits this long before its wake. */
export const HOSTED_DEVICE_SYNC_ROUTINE_WAKE_DEFER_MS = 30 * 60_000;

/**
 * A quiet member who texts or opens the app is quiet no longer. Pull any
 * daily-window device batch forward so the next recovery sweep releases it.
 * Routine 30-minute batches keep their own timing.
 */
export async function pullForwardHostedDeviceSyncQuietDeferrals(input: {
  now: Date;
  prisma: PrismaClient | Prisma.TransactionClient;
  userId: string;
}): Promise<void> {
  await input.prisma.$executeRaw(Prisma.sql`
    UPDATE "device_sync_dirty_connection"
    SET "wake_deferred_until" = ${input.now}
    WHERE "user_id" = ${input.userId}
      AND "wake_deferred_until" > ${new Date(
        input.now.getTime() + HOSTED_DEVICE_SYNC_ROUTINE_WAKE_DEFER_MS,
      )}
  `);
}
