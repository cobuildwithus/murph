import "server-only";

import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { HostedNativeMemberAuth } from "../better-auth/native-auth";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import { assertGameMemberAuthCurrentForRead, assertGameMemberAuthCurrentTx } from "../game/http/auth";
import { progressMediaStore, purgeProgressMedia } from "../game/progress/media-store";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";
import { findVisibleHealthPost } from "./audience";
import { openHealthPhoto, openHealthTexts, sealHealthPhoto, sealHealthTexts } from "./crypto";

type CleanupDb = Pick<PrismaClient, "healthPostAttachment">;
const maxUnpublishedPhotos = 20;
const keySelect = { id: true, memberId: true, storageKeyEncrypted: true } as const;
const keyField = (memberId: string, id: string, value: string) => ({
  memberId, table: "health_post_attachment", rowId: id, field: "storage_key", value,
} as const);
const missing = () => hostedOnboardingError({
  code: "HEALTH_PHOTO_NOT_FOUND", httpStatus: 404, message: "That photo is unavailable.",
});
const conflict = () => hostedOnboardingError({
  code: "HEALTH_PHOTO_CONFLICT", httpStatus: 409, message: "That photo has changed. Choose another photo.",
});

async function withUploadAuthority<T>(auth: HostedNativeMemberAuth, run: (tx: Prisma.TransactionClient) => Promise<T>) {
  return getPrisma().$transaction(async tx => {
    // Current session proof locks the member, fencing registration against account suspension.
    await assertGameMemberAuthCurrentTx(auth, tx);
    await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma: tx });
    return run(tx);
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

/** Reserved keys survive failed uploads. The same owner and UUID can retry the store's immutable write. */
export async function uploadHealthPhoto(auth: HostedNativeMemberAuth, id: string, bytes: Uint8Array): Promise<void> {
  const memberId = auth.member.id;
  const proposedKey = `progress/${randomBytes(16).toString("hex")}.jpg`;
  const [sealedKey] = await sealHealthTexts([keyField(memberId, id, proposedKey)]);
  const row = await withUploadAuthority(auth, async tx => {
    const reserved = { id, memberId, storageKeyEncrypted: sealedKey! };
    const created = await tx.healthPostAttachment.createMany({ data: [{ ...reserved, status: "pending" }], skipDuplicates: true });
    if (!created.count) {
      return tx.healthPostAttachment.findFirst({ where: { id, memberId, status: { not: "retired" } }, select: keySelect });
    }
    // The member lock serializes reservations. An excess insert rolls back before any bytes reach storage.
    const unpublished = await tx.healthPostAttachment.count({
      where: { memberId, postId: null, status: { in: ["pending", "ready"] } }, take: maxUnpublishedPhotos + 1,
    });
    if (unpublished > maxUnpublishedPhotos) throw hostedOnboardingError({
      code: "HEALTH_PHOTO_LIMIT", httpStatus: 409, message: "Post or discard an uploaded photo before adding another.",
    });
    return reserved;
  });
  if (!row) throw conflict();
  const key = row.storageKeyEncrypted === sealedKey ? proposedKey
    : (await openHealthTexts([keyField(memberId, row.id, row.storageKeyEncrypted)]))[0]!;
  const envelope = await sealHealthPhoto({ memberId, id: row.id, value: bytes });
  await progressMediaStore().putProgressPic({
    userId: memberId, mediaId: key, envelope, hash: createHash("sha256").update(bytes).digest("hex"),
  });
  await withUploadAuthority(auth, async tx => {
    const identity = { id: row.id, memberId, storageKeyEncrypted: row.storageKeyEncrypted };
    const changed = await tx.healthPostAttachment.updateMany({ where: { ...identity, status: "pending" }, data: { status: "ready" } });
    if (changed.count) return;
    if (!await tx.healthPostAttachment.findFirst({ where: { ...identity, status: { in: ["ready", "published"] } }, select: { id: true } })) throw conflict();
  });
}

/** Called by the post creator in the same transaction as its insert. */
export async function publishHealthAttachmentTx(tx: Prisma.TransactionClient, memberId: string, postId: string, id: string) {
  const result = await tx.healthPostAttachment.updateMany({
    where: { memberId, id, postId: null, status: "ready" }, data: { postId, status: "published" },
  });
  if (!result.count) throw conflict();
}

export async function retireHealthPostAttachmentTx(tx: Prisma.TransactionClient, memberId: string, postId: string) {
  await tx.healthPostAttachment.updateMany({ where: { memberId, postId, status: "published" }, data: { status: "retired" } });
}

/** The caller has already retired each row. A failed purge keeps that exact key available for replay. */
async function purgeRows(db: CleanupDb, rows: readonly { id: string; memberId: string; storageKeyEncrypted: string }[]) {
  const keys = await openHealthTexts(rows.map(row => keyField(row.memberId, row.id, row.storageKeyEncrypted)));
  for (const [index, row] of rows.entries()) {
    await purgeProgressMedia(row.memberId, keys[index]!);
    await db.healthPostAttachment.deleteMany({ where: { ...row, status: "retired" } });
  }
}

export async function purgeRetiredHealthAttachments(memberId: string, postId: string) {
  const db = getPrisma();
  const rows = await db.healthPostAttachment.findMany({ where: { memberId, postId, status: "retired" }, select: keySelect, take: 1 });
  await purgeRows(db, rows);
}

/** The composer can discard an unfinished upload even after consent withdrawal. Published photos retire with their post. */
export async function discardHealthPhoto(auth: HostedNativeMemberAuth, id: string) {
  const memberId = auth.member.id, db = getPrisma();
  const row = await db.$transaction(async tx => {
    await assertGameMemberAuthCurrentTx(auth, tx);
    const row = await tx.healthPostAttachment.findFirst({ where: { id, memberId }, select: { ...keySelect, postId: true } });
    if (!row) return null;
    if (row.postId) throw hostedOnboardingError({
      code: "HEALTH_PHOTO_PUBLISHED", httpStatus: 409, message: "Delete the post to remove its photo.",
    });
    const retired = await tx.healthPostAttachment.updateMany({ where: row, data: { status: "retired" } });
    if (!retired.count) throw conflict();
    return row;
  });
  if (row) await purgeRows(db, [row]);
}

export async function readHealthPhoto(auth: HostedNativeMemberAuth, id: string): Promise<Uint8Array> {
  const db = getPrisma(), viewerId = auth.member.id;
  const row = await db.healthPostAttachment.findFirst({ where: { id, status: "published" }, select: { ...keySelect, postId: true } });
  if (!row?.postId) throw missing();
  const postId = row.postId;
  const post = await findVisibleHealthPost(db, viewerId, postId);
  if (!post || post.authorMemberId !== row.memberId) throw missing();

  const [key] = await openHealthTexts([keyField(row.memberId, row.id, row.storageKeyEncrypted)]);
  const stored = await progressMediaStore().readProgressPic({ userId: row.memberId, mediaId: key! });
  if (!stored) throw missing();
  const bytes = await openHealthPhoto({ memberId: row.memberId, id: row.id, value: stored.envelope });
  try {
    await db.$transaction(async tx => {
      await assertGameMemberAuthCurrentForRead(auth, tx);
      const bound = await tx.healthPostAttachment.findFirst({ where: { ...row, status: "published" }, select: { id: true } });
      const current = bound && await findVisibleHealthPost(tx, viewerId, postId);
      if (!current || current.authorMemberId !== row.memberId || current.version !== post.version) throw missing();
    });
    return bytes;
  } catch (error) {
    bytes.fill(0);
    throw error;
  }
}

/** Account suspension has fenced new registrations. Purge a bounded page before any cascade or key destruction. */
export async function deleteHealthAttachmentsForAccount(memberIds: readonly string[], db: CleanupDb) {
  const pageSize = 50;
  for (const memberId of memberIds) {
    const rows = await db.healthPostAttachment.findMany({
      where: { memberId }, orderBy: { id: "asc" }, take: pageSize + 1, select: keySelect,
    });
    if (rows.length === 0) continue;
    const page = rows.slice(0, pageSize);
    await db.healthPostAttachment.updateMany({ where: { memberId, id: { in: page.map(row => row.id) } }, data: { status: "retired" } });
    await purgeRows(db, page);
    if (rows.length > pageSize) throw hostedOnboardingError({
      code: "HEALTH_PHOTO_CLEANUP_PENDING", httpStatus: 503, retryable: true,
      message: "Photo cleanup is underway. Retry account deletion.",
    });
  }
}
