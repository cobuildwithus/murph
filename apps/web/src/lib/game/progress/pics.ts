import 'server-only';
import { randomBytes, createHash } from 'node:crypto';
import { formatTimeZoneDateTimeParts } from '@murphai/contracts';
import type { PrismaClient } from '@prisma/client';
import { openHostedUserSecureBoxBytes, sealHostedUserSecureBoxBytes } from '../../hosted-crypto/secure-box';
import { runWithHostedDomainRootUnwrapCache } from '../../hosted-crypto/domain-root-unwrap-cache';
import { hostedOnboardingError } from '../../hosted-onboarding/errors';
import { getPrisma } from '../../prisma';
import { progressEffect } from './http';
import { openProgress, openProgressMany, sealProgress } from './crypto';
import type { BeforeProgressMutation } from './state';
import type { Day, Pic, PicUploadQuery } from './contract';
import { progressMediaStore, purgeProgressMedia } from './media-store';

export function picturePin(pic: { id: string; takenAt: Date }, points: readonly [Day, number][], timeZone: string): Pic {
  const takenOn = formatTimeZoneDateTimeParts(pic.takenAt, timeZone).dayKey;
  return { id: pic.id, takenOn, at: points.filter(([day]) => day <= takenOn).at(-1)?.[1] ?? 0 };
}

const MAX_PROGRESS_PICS = 10_000;
const metaTarget = (memberId: string, rowId: string) => ({ memberId, rowId, table: 'game_progress_pic', field: 'meta' } as const);
const bytesTarget = (userId: string, key: string) => ({ userId, lane: 'hosted-member-private-field', scope: 'game-progress',
  aad: { purpose: 'game-progress', table: 'game_progress_pic', rowId: key, field: 'bytes' } } as const);
const notFound = () => hostedOnboardingError({ code: 'PROGRESS_PIC_NOT_FOUND', httpStatus: 404, message: 'That picture is not available.' });
const conflict = () => hostedOnboardingError({ code: 'PROGRESS_PIC_CONFLICT', httpStatus: 409, message: 'That picture was already used or deleted.' });
type PictureRow = { id: string; metaEncrypted: string; takenAt: Date };
type PictureMeta = { measureId: string };

async function openPictureMeta(memberId: string, row: PictureRow): Promise<PictureMeta> {
  const open = (id: string) => openProgress<PictureMeta>(metaTarget(memberId, id), row.metaEncrypted);
  try {
    return await open(row.id);
  } catch (error) {
    // Older clients registered an uppercase UUID before Postgres normalized it.
    const oldId = row.id.toUpperCase();
    if (oldId === row.id) throw error;
    return open(oldId);
  }
}

/** Create ownership before uploading, under the same member fence as account deletion. */
export async function putProgressPic(memberId: string, input: PicUploadQuery, bytes: Uint8Array, beforeMutationTx: BeforeProgressMutation): Promise<void> {
  const db = getPrisma(), control = progressMediaStore();
  const storageKey = `progress/${randomBytes(16).toString('hex')}.jpg`;
  // PostgreSQL returns UUIDs in lowercase when the metadata is reopened.
  const metaEncrypted = await progressEffect('seal_picture_metadata', () =>
    sealProgress(metaTarget(memberId, input.id.toLowerCase()), { measureId: input.measureId }));
  const row = await progressEffect('register_picture', () => db.$transaction(async tx => {
    await beforeMutationTx(tx);
    await tx.gameProgressPic.createMany({ data: [{ id: input.id, memberId, storageKey, stagingSince: new Date(), takenAt: new Date(input.takenAt), metaEncrypted }], skipDuplicates: true });
    return tx.gameProgressPic.findFirst({ where: { id: input.id, memberId, retiredAt: null } });
  }));
  if (!row) throw conflict();
  const meta = await progressEffect('open_picture_metadata', () =>
    openPictureMeta(memberId, row));
  if (meta.measureId !== input.measureId || row.takenAt.getTime() !== Date.parse(input.takenAt)) throw conflict();
  const envelope = await progressEffect('seal_picture_bytes', () =>
    sealHostedUserSecureBoxBytes({ ...bytesTarget(memberId, row.storageKey), value: bytes }));
  await progressEffect('stage_picture', () => control.putProgressPic({
    userId: memberId, mediaId: row.storageKey, envelope, hash: createHash('sha256').update(bytes).digest('hex'),
  }));
  const live = await progressEffect('recheck_picture', () =>
    db.gameProgressPic.updateMany({ where: { id: input.id, memberId, retiredAt: null }, data: { stagingSince: null, metaEncrypted } }));
  if (!live.count) throw conflict();
}

export async function readProgressPic(memberId: string, id: string): Promise<Uint8Array> {
  const db = getPrisma();
  const row = await db.gameProgressPic.findFirst({ where: { id, memberId, retiredAt: null, stagingSince: null }, select: { storageKey: true } });
  if (!row) throw notFound();
  const stored = await progressMediaStore().readProgressPic({ userId: memberId, mediaId: row.storageKey });
  if (!stored) throw notFound();
  const bytes = await openHostedUserSecureBoxBytes({ ...bytesTarget(memberId, row.storageKey), value: stored.envelope });
  try {
    if (!await db.gameProgressPic.findFirst({ where: { id, memberId, retiredAt: null, stagingSince: null }, select: { id: true } })) throw notFound();
    return bytes;
  } catch (error) { bytes.fill(0); throw error; }
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
  await purgeProgressMedia(memberId, row.storageKey);
}

/** The view computes chart positions from its own cumulative points. No totals are persisted here. */
export async function readProgressPics(memberId: string) {
  const rows = await getPrisma().gameProgressPic.findMany({ where: { memberId, retiredAt: null, stagingSince: null },
    select: { id: true, takenAt: true, metaEncrypted: true }, orderBy: [{ takenAt: 'asc' }, { id: 'asc' }], take: MAX_PROGRESS_PICS + 1 });
  if (rows.length > MAX_PROGRESS_PICS) return { incomplete: true, pics: [] };
  return runWithHostedDomainRootUnwrapCache(async () => {
    const pins = await readPictureMetadata(memberId, rows);
    return { incomplete: pins.length !== rows.length, pics: pins };
  });
}

async function readPictureMetadata(memberId: string, rows: PictureRow[]) {
  const pin = (row: PictureRow, meta: PictureMeta) => ({ id: row.id, takenAt: row.takenAt, measureId: meta.measureId });
  try {
    const metadata = await openProgressMany<PictureMeta>(rows.map(row => ({ ...metaTarget(memberId, row.id), value: row.metaEncrypted })), true);
    return rows.map((row, index) => pin(row, metadata[index]));
  } catch {
    // Preserve readable pins and reuse the request's cached roots on the recovery path.
    const pics = [];
    for (const row of rows) {
      const meta = await openPictureMeta(memberId, row).catch(() => null);
      if (meta) pics.push(pin(row, meta));
    }
    return pics;
  }
}

/** Called after account suspension, before member cascades. Tombstones outlive both rows and keys. */
export async function deleteProgressPicsForAccount(memberIds: readonly string[], db: { gameProgressPic: Pick<PrismaClient['gameProgressPic'], 'findMany' | 'deleteMany'> }): Promise<void> {
  for (const memberId of memberIds) {
    const rows = await db.gameProgressPic.findMany({ where: { memberId }, select: { id: true, storageKey: true }, orderBy: { id: 'asc' }, take: MAX_PROGRESS_PICS + 1 });
    if (rows.length > MAX_PROGRESS_PICS) throw hostedOnboardingError({ code: 'PROGRESS_PIC_DELETION_INCOMPLETE', httpStatus: 503,
      retryable: true, message: 'Picture cleanup could not load completely. Your account has not been deleted.' });
    for (const row of rows) await purgeProgressMedia(memberId, row.storageKey);
    if (rows.length) await db.gameProgressPic.deleteMany({ where: { memberId, id: { in: rows.map(row => row.id) } } });
  }
}
