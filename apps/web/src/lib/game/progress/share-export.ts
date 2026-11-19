import 'server-only';
import { runWithFreshHostedDomainRootUnwrapCache } from '../../hosted-crypto/domain-root-unwrap-cache';
import { openHostedUserSecureBoxBytes } from '../../hosted-crypto/secure-box';
import { hostedOnboardingError } from '../../hosted-onboarding/errors';
import { getPrisma } from '../../prisma';
import { progressMediaStore, progressShareBytesTarget } from './media-store';
import { progressEffect } from './http';
import { openSharePhoto } from './share-photo';

/** The approved account export owns authorization, including rechecks during download. */
export async function prepareProgressShareExport(memberId: string, assertCurrent: () => Promise<void>) {
  const db = getPrisma();
  const rows = await db.gameProgressShare.findMany({ where: { memberId },
    select: { awardLookup: true, storageKey: true, createdAt: true },
    orderBy: [{ awardLookup: 'asc' }, { createdAt: 'asc' }], take: 10_001 });
  if (rows.length > 10_000) throw hostedOnboardingError({ code: 'PROGRESS_SHARE_EXPORT_INCOMPLETE', httpStatus: 503,
    retryable: true, message: 'Picture export could not load completely. Try again.' });
  return async function* records() {
    for (const row of rows) {
      yield await runWithFreshHostedDomainRootUnwrapCache(() => progressEffect('export_share', async () => {
        await assertCurrent();
        const current = await db.gameProgressShare.findUnique({ where: { storageKey: row.storageKey }, select: { status: true, failureCode: true } });
        if (!current) throw exportUnavailable();
        const record = { awardId: row.awardLookup, createdAt: row.createdAt.toISOString(), status: current.status, failureCode: current.failureCode };
        if (current.status !== 'ready') return JSON.stringify({ progressShare: { ...record, jpegBase64: null } }) + '\n';
        const stored = await progressMediaStore().readProgressPic({ userId: memberId, mediaId: row.storageKey });
        if (!stored) throw exportUnavailable();
        const bytes = await openHostedUserSecureBoxBytes({ ...progressShareBytesTarget(memberId, row.storageKey), value: stored.envelope });
        try {
          await assertCurrent();
          const live = await db.gameProgressShare.findUnique({ where: { storageKey: row.storageKey }, select: { status: true } });
          if (live?.status !== 'ready') throw exportUnavailable();
          return JSON.stringify({ progressShare: { ...record, jpegBase64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64') } }) + '\n';
        } finally { bytes.fill(0); }
      }));
    }
    // The medal photo's current copy, the one Change uses: the member's own photo, prepared for pictures.
    const photo = await db.gameProgressSharePhoto.findFirst({ where: { memberId, status: 'current' }, select: { storageKey: true, createdAt: true } });
    if (photo) yield await runWithFreshHostedDomainRootUnwrapCache(() => progressEffect('export_share_photo', async () => {
      await assertCurrent();
      const bytes = await openSharePhoto(memberId, photo.storageKey);
      if (!bytes) throw exportUnavailable();
      try {
        await assertCurrent();
        return JSON.stringify({ progressSharePhoto: { createdAt: photo.createdAt.toISOString(), jpegBase64: bytes.toString('base64') } }) + '\n';
      } finally { bytes.fill(0); }
    }));
  };
}

function exportUnavailable() {
  return hostedOnboardingError({ code: 'PROGRESS_SHARE_EXPORT_UNAVAILABLE', httpStatus: 503,
    retryable: true, message: 'Picture export changed or could not load. Try again.' });
}
