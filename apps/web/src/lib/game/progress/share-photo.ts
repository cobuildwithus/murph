import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { openHostedUserSecureBoxBytes, sealHostedUserSecureBoxBytes } from '../../hosted-crypto/secure-box';
import { hostedOnboardingError } from '../../hosted-onboarding/errors';
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS, lockHostedMemberRow } from '../../hosted-onboarding/shared';
import { getPrisma } from '../../prisma';
import { readGameMedia } from '../media';
import { progressMediaStore } from './media-store';
import { purgeRetiredSharePhotos } from './share-cleanup';
import { readProgressShareConsent } from './share-consent';
import { prepareShareJpeg } from './share-image';
import type { BeforeProgressMutation } from './state';

/** Where the medal photo comes from. The server resolves profile and post keys itself. */
export type SharePhotoSource = { from: 'profile' } | { from: 'post'; entryId: string } | { from: 'bytes'; bytes: Uint8Array };

const bytesTarget = (userId: string, key: string) => ({ userId, lane: 'hosted-member-private-field', scope: 'game-progress',
  aad: { purpose: 'game-progress', table: 'game_progress_share_photo', rowId: key, field: 'bytes' } } as const);
const noPhoto = () => hostedOnboardingError({ code: 'PROGRESS_SHARE_PHOTO_NOT_FOUND', httpStatus: 404, message: 'That photo is not available.' });
const unavailable = () => hostedOnboardingError({ code: 'PROGRESS_SHARE_PHOTO_UNAVAILABLE', httpStatus: 503, retryable: true,
  message: 'Your photo could not be saved. Try again.' });
const turnedOff = () => hostedOnboardingError({ code: 'PROGRESS_SHARE_PHOTO_OFF', httpStatus: 409, message: 'Pictures of you are off.' });

function withMember<T>(memberId: string, beforeMutationTx: BeforeProgressMutation, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return getPrisma().$transaction(async tx => {
    await lockHostedMemberRow(tx, memberId);
    await beforeMutationTx(tx);
    if ((await readProgressShareConsent({ memberId, prisma: tx })).decision !== 'allowed') throw turnedOff();
    return run(tx);
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function sourceBytes(memberId: string, source: SharePhotoSource): Promise<Uint8Array> {
  if (source.from === 'bytes') return source.bytes;
  const db = getPrisma();
  const key = source.from === 'profile'
    ? (await db.gameProfile.findUnique({ where: { memberId }, select: { photoKey: true } }))?.photoKey
    : (await db.gameEntry.findFirst({ where: { id: source.entryId, memberId, kind: 'photo', withdrawnAt: null }, select: { mediaKeys: true } }))?.mediaKeys[0];
  if (!key) throw noPhoto();
  const media = await readGameMedia(key).catch(() => { throw unavailable(); });
  if (!media) throw noPhoto();
  return media.bytes;
}

/** The pick: ownership before the store write, then one swap retires every other live copy. */
export async function putSharePhoto(memberId: string, source: SharePhotoSource, beforeMutationTx: BeforeProgressMutation): Promise<void> {
  const original = await sourceBytes(memberId, source);
  let prepared: Buffer;
  try { prepared = await prepareShareJpeg(original); }
  catch { throw unavailable(); }
  finally { original.fill(0); }
  const storageKey = `progress/${randomBytes(16).toString('hex')}.jpg`;
  try {
    await withMember(memberId, beforeMutationTx, tx => tx.gameProgressSharePhoto.create({ data: { storageKey, memberId, status: 'pending' } }));
    const envelope = await sealHostedUserSecureBoxBytes({ ...bytesTarget(memberId, storageKey), value: prepared });
    await progressMediaStore().putProgressPic({ userId: memberId, mediaId: storageKey, envelope, hash: createHash('sha256').update(prepared).digest('hex') });
    await withMember(memberId, beforeMutationTx, async tx => {
      // A Turn off since the insert already retired and purged this copy.
      const mine = await tx.gameProgressSharePhoto.updateMany({ where: { storageKey, status: 'pending' }, data: { status: 'current' } });
      if (mine.count !== 1) throw turnedOff();
      await tx.gameProgressSharePhoto.updateMany({ where: { memberId, status: { not: 'retired' }, storageKey: { not: storageKey } }, data: { status: 'retired' } });
    });
  } catch (error) {
    await getPrisma().gameProgressSharePhoto.updateMany({ where: { storageKey, status: 'pending' }, data: { status: 'retired' } }).catch(() => undefined);
    await purgeRetiredSharePhotos(memberId, getPrisma()).catch(() => undefined);
    throw error;
  } finally { prepared.fill(0); }
  // The pick is saved. A failed purge keeps its retired rows, which the next pick, Turn off or account deletion replays.
  await purgeRetiredSharePhotos(memberId, getPrisma()).catch(() => undefined);
}

/** The current copy's key, while pictures of you are on. */
async function readSharePhotoKey(memberId: string): Promise<string | null> {
  const db = getPrisma();
  if ((await readProgressShareConsent({ memberId, prisma: db })).decision !== 'allowed') return null;
  return (await db.gameProgressSharePhoto.findFirst({ where: { memberId, status: 'current' }, select: { storageKey: true } }))?.storageKey ?? null;
}

/** The stored copy's bytes, already prepared for the image model. Null when the store has no object. */
export async function openSharePhoto(memberId: string, storageKey: string): Promise<Buffer | null> {
  const stored = await progressMediaStore().readProgressPic({ userId: memberId, mediaId: storageKey });
  if (!stored) return null;
  const bytes = await openHostedUserSecureBoxBytes({ ...bytesTarget(memberId, storageKey), value: stored.envelope });
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** GET share-photo: rechecks consent and the selection after decrypting. */
export async function readSharePhoto(memberId: string): Promise<Uint8Array> {
  const key = await readSharePhotoKey(memberId);
  if (!key) throw noPhoto();
  const bytes = await openSharePhoto(memberId, key);
  if (!bytes) throw noPhoto();
  try {
    if (await readSharePhotoKey(memberId) !== key) throw noPhoto();
    return bytes;
  } catch (error) { bytes.fill(0); throw error; }
}
