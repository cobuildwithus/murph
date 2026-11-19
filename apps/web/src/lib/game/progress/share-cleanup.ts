import 'server-only';
import type { Prisma, PrismaClient } from '@prisma/client';
import { hostedOnboardingError } from '../../hosted-onboarding/errors';
import { purgeProgressMedia } from './media-store';

const MAX_SHARES = 10_000;
type ShareCleanupDb = { gameProgressShare: Pick<PrismaClient['gameProgressShare'], 'findMany' | 'updateMany'> };
type ShareOwner = { memberId: string };
type PhotoDb = { gameProgressSharePhoto: Pick<PrismaClient['gameProgressSharePhoto'], 'findMany' | 'updateMany' | 'deleteMany'> };

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

// The medal photo's copies (share-photo.ts). Rows are forgotten only once their bytes are purged.

/** Turn off: the caller holds the member fence and purges after commit. */
export async function retireSharePhotosTx(tx: Prisma.TransactionClient, memberId: string): Promise<void> {
  await tx.gameProgressSharePhoto.updateMany({ where: { memberId, status: { not: 'retired' } }, data: { status: 'retired' } });
}

/** Purges each retired copy, then forgets it. Tombstones keep a deleted key from coming back. */
export async function purgeRetiredSharePhotos(memberId: string, db: PhotoDb): Promise<void> {
  for (;;) {
    const rows = await db.gameProgressSharePhoto.findMany({ where: { memberId, status: 'retired' }, select: { storageKey: true }, take: 100 });
    if (rows.length === 0) return;
    for (const { storageKey } of rows) {
      await purgeProgressMedia(memberId, storageKey);
      await db.gameProgressSharePhoto.deleteMany({ where: { storageKey, status: 'retired' } });
    }
  }
}

/** Suspension has fenced admission. Purge every copy before member cascades. */
export async function deleteSharePhotosForAccount(memberIds: readonly string[], db: PhotoDb): Promise<void> {
  for (const memberId of memberIds) {
    await db.gameProgressSharePhoto.updateMany({ where: { memberId }, data: { status: 'retired' } });
    await purgeRetiredSharePhotos(memberId, db);
  }
}
