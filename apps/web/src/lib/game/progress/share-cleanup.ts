import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';
import { hostedOnboardingError } from '../../hosted-onboarding/errors';
import { purgeProgressMedia } from './media-store';

const MAX_SHARES = 10_000;
type ShareCleanupDb = { gameProgressShare: Pick<PrismaClient['gameProgressShare'], 'findMany' | 'updateMany'> };
type ShareOwner = { memberId: string };

async function readShareKeys(db: ShareCleanupDb, where: ShareOwner): Promise<string[]> {
  const rows = await db.gameProgressShare.findMany({ where, select: { storageKey: true },
    orderBy: { awardLookup: 'asc' }, take: MAX_SHARES + 1 });
  if (rows.length > MAX_SHARES) throw hostedOnboardingError({ code: 'PROGRESS_SHARE_DELETION_INCOMPLETE', httpStatus: 503,
    retryable: true, message: 'Picture cleanup could not load completely. Try again.' });
  return rows.map(row => row.storageKey);
}

/** Caller holds the member fence. Retired rows retain keys for explicit cleanup replay. */
export async function retireProgressSharesTx(tx: Prisma.TransactionClient, where: ShareOwner): Promise<string[]> {
  const keys = await readShareKeys(tx, where);
  await tx.gameProgressShare.updateMany({ where, data: { status: 'retired' } });
  return keys;
}

export async function purgeProgressShares(memberId: string, keys: readonly string[]): Promise<void> {
  for (const key of keys) await purgeProgressMedia(memberId, key);
}

/** Suspension has fenced admission. Purge all derived keys before member cascades. */
export async function deleteProgressSharesForAccount(memberIds: readonly string[], db: ShareCleanupDb): Promise<void> {
  const collections: { memberId: string; keys: string[] }[] = [];
  for (const memberId of memberIds) collections.push({ memberId, keys: await readShareKeys(db, { memberId }) });
  for (const { memberId, keys } of collections) {
    await db.gameProgressShare.updateMany({ where: { memberId }, data: { status: 'retired' } });
    await purgeProgressShares(memberId, keys);
  }
}
