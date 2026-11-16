import 'server-only';
import { randomBytes, createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { hostedProgressPicObjectKey } from '@murphai/hosted-execution/storage-paths';
import { readHostedExecutionControlClientIfConfigured } from '../../hosted-execution/control';
import { openHostedUserSecureBoxBytes, sealHostedUserSecureBoxBytes } from '../../hosted-crypto/secure-box';
import { hostedOnboardingError } from '../../hosted-onboarding/errors';
import { getPrisma } from '../../prisma';
import { openProgress, openProgressMany, sealProgress } from './crypto';
import type { BeforeProgressMutation } from './state';
import type { PicUploadQuery } from './contract';

const MAX_PROGRESS_PICS = 10_000;
const metaTarget = (memberId: string, rowId: string) => ({ memberId, rowId, table: 'game_progress_pic', field: 'meta' } as const);
const bytesTarget = (userId: string, key: string) => ({ userId, lane: 'hosted-member-private-field', scope: 'game-progress',
  aad: { purpose: 'game-progress', table: 'game_progress_pic', rowId: key, field: 'bytes' } } as const);
const notFound = () => hostedOnboardingError({ code: 'PROGRESS_PIC_NOT_FOUND', httpStatus: 404, message: 'That picture is not available.' });
const conflict = () => hostedOnboardingError({ code: 'PROGRESS_PIC_CONFLICT', httpStatus: 409, message: 'That picture was already used or deleted.' });
function storage() {
  const control = readHostedExecutionControlClientIfConfigured();
  if (!control) throw hostedOnboardingError({ code: 'PROGRESS_PIC_UNAVAILABLE', httpStatus: 503, retryable: true, message: 'Pictures could not load. Try again.' });
  return control;
}

/** Account cleanup also crosses this boundary, outside the picture HTTP wrapper. */
async function purgePicture(memberId: string, storageKey: string): Promise<void> {
  try {
    await storage().purgeRuntimeResource({ userId: memberId, resource: { kind: 'game_progress_pic',
      objectKey: hostedProgressPicObjectKey({ userId: memberId, mediaId: storageKey }) } });
  } catch {
    throw hostedOnboardingError({ code: 'PROGRESS_PIC_UNAVAILABLE', httpStatus: 503, retryable: true,
      message: 'Pictures could not be deleted. Try again.' });
  }
}

/** Create ownership before uploading, under the same member fence as account deletion. */
export async function putProgressPic(memberId: string, input: PicUploadQuery, bytes: Uint8Array, beforeMutationTx: BeforeProgressMutation): Promise<void> {
  const db = getPrisma(), control = storage();
  const storageKey = `progress/${randomBytes(16).toString('hex')}.jpg`;
  const metaEncrypted = await sealProgress(metaTarget(memberId, input.id), { measureId: input.measureId });
  const row = await db.$transaction(async tx => {
    await beforeMutationTx(tx);
    await tx.gameProgressPic.createMany({ data: [{ id: input.id, memberId, storageKey, takenAt: new Date(input.takenAt), metaEncrypted }], skipDuplicates: true });
    return tx.gameProgressPic.findFirst({ where: { id: input.id, memberId, retiredAt: null } });
  });
  if (!row) throw conflict();
  const meta = await openProgress<{ measureId: string }>(metaTarget(memberId, row.id), row.metaEncrypted);
  if (meta.measureId !== input.measureId || row.takenAt.getTime() !== Date.parse(input.takenAt)) throw conflict();
  const envelope = await sealHostedUserSecureBoxBytes({ ...bytesTarget(memberId, row.storageKey), value: bytes });
  await control.putProgressPic({ userId: memberId, mediaId: row.storageKey, envelope, hash: createHash('sha256').update(bytes).digest('hex') });
  if (!await db.gameProgressPic.findFirst({ where: { id: input.id, memberId, retiredAt: null }, select: { id: true } })) throw conflict();
}

export async function readProgressPic(memberId: string, id: string): Promise<Uint8Array> {
  const db = getPrisma();
  const row = await db.gameProgressPic.findFirst({ where: { id, memberId, retiredAt: null }, select: { storageKey: true } });
  if (!row) throw notFound();
  const stored = await storage().readProgressPic({ userId: memberId, mediaId: row.storageKey });
  if (!stored) throw notFound();
  const bytes = await openHostedUserSecureBoxBytes({ ...bytesTarget(memberId, row.storageKey), value: stored.envelope });
  if (!await db.gameProgressPic.findFirst({ where: { id, memberId, retiredAt: null }, select: { id: true } })) throw notFound();
  return bytes;
}

export async function deleteProgressPic(memberId: string, id: string, beforeMutationTx: BeforeProgressMutation): Promise<void> {
  const db = getPrisma();
  const row = await db.$transaction(async tx => {
    await beforeMutationTx(tx);
    const owned = await tx.gameProgressPic.findFirst({ where: { id, memberId }, select: { storageKey: true } });
    if (!owned) throw notFound();
    await tx.gameProgressPic.updateMany({ where: { id, memberId, retiredAt: null }, data: { retiredAt: new Date() } });
    return owned;
  });
  await purgePicture(memberId, row.storageKey);
}

/** The view computes chart positions from its own cumulative points. No totals are persisted here. */
export async function readProgressPics(memberId: string) {
  const rows = await getPrisma().gameProgressPic.findMany({ where: { memberId, retiredAt: null },
    select: { id: true, takenAt: true, metaEncrypted: true }, orderBy: [{ takenAt: 'asc' }, { id: 'asc' }], take: MAX_PROGRESS_PICS + 1 });
  if (rows.length > MAX_PROGRESS_PICS) return { incomplete: true, pics: [] };
  const metadata = await openProgressMany<{ measureId: string }>(rows.map(row => ({ ...metaTarget(memberId, row.id), value: row.metaEncrypted })));
  return { incomplete: false, pics: rows.map((row, i) => ({ id: row.id, takenAt: row.takenAt, measureId: metadata[i]!.measureId })) };
}

/** Called after account suspension, before member cascades. Tombstones outlive both rows and keys. */
export async function deleteProgressPicsForAccount(memberIds: readonly string[], db: { gameProgressPic: Pick<PrismaClient['gameProgressPic'], 'findMany' | 'deleteMany'> }): Promise<void> {
  for (const memberId of memberIds) {
    const rows = await db.gameProgressPic.findMany({ where: { memberId }, select: { id: true, storageKey: true }, orderBy: { id: 'asc' }, take: MAX_PROGRESS_PICS + 1 });
    if (rows.length > MAX_PROGRESS_PICS) throw hostedOnboardingError({ code: 'PROGRESS_PIC_DELETION_INCOMPLETE', httpStatus: 503,
      retryable: true, message: 'Picture cleanup could not load completely. Your account has not been deleted.' });
    for (const row of rows) await purgePicture(memberId, row.storageKey);
    if (rows.length) await db.gameProgressPic.deleteMany({ where: { memberId, id: { in: rows.map(row => row.id) } } });
  }
}
