import "server-only";
import type { Prisma } from "@prisma/client";
import type { HostedNativeMemberAuth } from "../better-auth/native-auth";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import { assertGameMemberAuthCurrentTx } from "../game/http/auth";
import { invalidGameRequest } from "../game/http/errors";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";
import { findVisibleHealthPost } from "./audience";
import { sealHealthTexts } from "./crypto";
import { publishHealthAttachmentTx, purgeRetiredHealthAttachments, retireHealthPostAttachmentTx } from "./media";
import { CHEER_WINDOW_MS, prepareHealthNotification, sendHealthNotificationAfterCommit } from "./notifications";
import { assertHealthSetCurrent, resolveHealthCards, type HealthCardSelection } from "./wins";

type Tx = Prisma.TransactionClient;
type Auth = HostedNativeMemberAuth;
type Content = { caption?: string | null; setRevision?: string; cards?: readonly HealthCardSelection[] };
type Comment = { id: string; visibility?: "everyone" | "poster"; body: string };
const postReceipt = { id: true, authorMemberId: true, deletedAt: true, version: true } as const;
const notFound = () => hostedOnboardingError({ code: "HEALTH_NOT_FOUND", httpStatus: 404, message: "That item is unavailable." });
const conflict = () => hostedOnboardingError({ code: "HEALTH_WRITE_CONFLICT", httpStatus: 409, message: "That item has changed." });

function replayPost(row: { id: string; authorMemberId: string; deletedAt: Date | null; version: number }, actor: string) {
  if (row.authorMemberId !== actor || row.deletedAt) throw conflict();
  return { id: row.id, version: row.version };
}

async function preparePostContent(auth: Auth, id: string, input: Content) {
  const memberId = auth.member.id;
  if (input.cards?.length && !input.setRevision) throw invalidGameRequest("Choose cards from a current set.");
  const resolved = input.cards?.length && input.setRevision
    ? await resolveHealthCards(auth, input.setRevision, input.cards)
    : null;
  const target = { memberId, table: "health_post", rowId: id } as const;
  const caption = input.caption?.trim();
  const sealed = await sealHealthTexts([
    ...(resolved?.cards.map((card, index) => ({ ...target, field: `card:${index}` as const, value: JSON.stringify(card) })) ?? []),
    ...(caption ? [{ ...target, field: "caption" as const, value: caption }] : []),
  ]);
  return {
    data: {
      ...(input.cards !== undefined ? { cardsEncrypted: sealed.slice(0, resolved?.cards.length ?? 0) } : {}),
      ...(input.caption !== undefined ? { captionEncrypted: caption ? sealed[sealed.length - 1]! : null } : {}),
    },
    checkSet: async (tx: Tx) => {
      if (resolved && input.setRevision) await assertHealthSetCurrent(tx, memberId, resolved.day, input.setRevision);
    },
  };
}

/** An acknowledged retry does not depend on the original set still being current. */
export async function createHealthPost(auth: Auth, input: Content & { id: string; attachmentId?: string }) {
  const db = getPrisma(), memberId = auth.member.id, id = input.id.toLowerCase();
  const previous = await db.healthPost.findUnique({ where: { id }, select: { id: true } });
  if (previous) {
    return db.$transaction(async tx => {
      await assertGameMemberAuthCurrentTx(auth, tx);
      const current = await tx.healthPost.findUnique({ where: { id }, select: postReceipt });
      if (!current) throw conflict();
      return replayPost(current, memberId);
    });
  }
  if (!input.caption?.trim() && !input.cards?.length && !input.attachmentId) throw invalidGameRequest("Add words, a card, or a photo.");
  await assertBrowserVaultMemberAuthority({ memberId, prisma: db });
  const content = await preparePostContent(auth, id, input);
  return db.$transaction(async tx => {
    await assertGameMemberAuthCurrentTx(auth, tx);
    await assertBrowserVaultMemberAuthority({ memberId, prisma: tx });
    const inserted = await tx.healthPost.createMany({ data: [{ id, authorMemberId: memberId, ...content.data }], skipDuplicates: true });
    if (!inserted.count) {
      const row = await tx.healthPost.findUniqueOrThrow({ where: { id }, select: postReceipt });
      return replayPost(row, memberId);
    }
    // A conflict rolls back the post. The shared set lock spans publication through commit.
    await content.checkSet(tx);
    if (input.attachmentId) await publishHealthAttachmentTx(tx, memberId, id, input.attachmentId.toLowerCase());
    return { id, version: 1 };
  });
}

export async function patchHealthPost(auth: Auth, postId: string, input: Content & { expectedVersion: number }) {
  const db = getPrisma(), memberId = auth.member.id, id = postId.toLowerCase();
  if (input.caption === undefined && input.cards === undefined) throw invalidGameRequest("Choose an edit.");
  await assertBrowserVaultMemberAuthority({ memberId, prisma: db });
  const current = await db.healthPost.findFirst({ where: { id, authorMemberId: memberId, deletedAt: null }, select: { version: true } });
  if (!current) throw notFound();
  if (input.expectedVersion !== current.version) throw conflict();
  const content = await preparePostContent(auth, id, input);
  return db.$transaction(async tx => {
    await assertGameMemberAuthCurrentTx(auth, tx);
    await assertBrowserVaultMemberAuthority({ memberId, prisma: tx });
    await content.checkSet(tx);
    const updated = await tx.healthPost.updateMany({ where: { id, authorMemberId: memberId, deletedAt: null, version: input.expectedVersion },
      data: { ...content.data, version: { increment: 1 } } });
    if (!updated.count) throw conflict();
    if (await tx.healthPost.findFirst({ where: { id, captionEncrypted: null, cardsEncrypted: { isEmpty: true }, attachment: null },
      select: { id: true } })) throw invalidGameRequest("Keep words, a card, or a photo.");
    return { id, version: input.expectedVersion + 1 };
  });
}

export async function deleteHealthPost(auth: Auth, postId: string): Promise<void> {
  const db = getPrisma(), memberId = auth.member.id, id = postId.toLowerCase();
  await db.$transaction(async tx => {
    await assertGameMemberAuthCurrentTx(auth, tx);
    const owned = await tx.healthPost.findFirst({ where: { id, authorMemberId: memberId }, select: { id: true } });
    if (!owned) throw notFound();
    const now = new Date();
    const changed = await tx.healthPost.updateMany({ where: { id, authorMemberId: memberId, deletedAt: null },
      data: { deletedAt: now, captionEncrypted: null, cardsEncrypted: [], version: { increment: 1 } } });
    if (changed.count) {
      await tx.healthPostComment.updateMany({ where: { postId: id, deletedAt: null }, data: { deletedAt: now, bodyEncrypted: null } });
      await tx.healthPostCheer.deleteMany({ where: { postId: id } });
      await retireHealthPostAttachmentTx(tx, memberId, id);
    }
  });
  // The durable retirement survives a failed purge. Replaying DELETE resumes cleanup.
  await purgeRetiredHealthAttachments(memberId, id);
}

async function lockVisiblePost(tx: Tx, actor: string, postId: string) {
  // Serialize with deletion before checking liveness. An FK alone permits children of a tombstone.
  await tx.$queryRaw`SELECT id FROM health_post WHERE id = ${postId}::uuid FOR NO KEY UPDATE`;
  const post = await findVisibleHealthPost(tx, actor, postId);
  if (!post) throw notFound();
  return post;
}

export async function setHealthCheer(auth: Auth, postId: string, enabled: boolean): Promise<void> {
  const actor = auth.member.id;
  const notification = await getPrisma().$transaction(async tx => {
    await assertGameMemberAuthCurrentTx(auth, tx);
    if (!enabled) {
      // The owner can retract an existing cheer after a hide or consent withdrawal.
      const removed = await tx.healthPostCheer.deleteMany({ where: { postId, memberId: actor } });
      if (!removed.count && !await findVisibleHealthPost(tx, actor, postId)) throw notFound();
      return null;
    }
    const post = await lockVisiblePost(tx, actor, postId);
    const now = new Date();
    const inserted = await tx.healthPostCheer.createMany({ data: [{ postId, memberId: actor, createdAt: now }], skipDuplicates: true });
    if (!inserted.count || actor === post.authorMemberId) return null;
    const claimed = await tx.healthPost.updateMany({ where: { id: postId, deletedAt: null, OR: [
      { cheerPushClaimedAt: null }, { cheerPushClaimedAt: { lte: new Date(now.getTime() - CHEER_WINDOW_MS) } },
    ] }, data: { cheerPushClaimedAt: now } });
    if (!claimed.count) return null;
    return prepareHealthNotification(tx, { actor, postId, memberId: post.authorMemberId, subject: { kind: "cheer" }, claimedAt: now });
  });
  sendHealthNotificationAfterCommit(notification);
}

export async function createHealthComment(auth: Auth, postId: string, input: Comment) {
  const db = getPrisma(), actor = auth.member.id, id = input.id.toLowerCase(), target = postId.toLowerCase();
  if (!await findVisibleHealthPost(db, actor, target)) throw notFound();
  await assertBrowserVaultMemberAuthority({ memberId: actor, prisma: db });
  const existing = await db.healthPostComment.findUnique({ where: { id }, select: { id: true } });
  // A retry needs only its immutable receipt, including after a failed key-service request.
  const [bodyEncrypted] = existing ? [] : await sealHealthTexts([
    { memberId: actor, table: "health_post_comment", field: "body", rowId: id, value: input.body },
  ]);
  const notification = await db.$transaction(async tx => {
    await assertGameMemberAuthCurrentTx(auth, tx);
    await assertBrowserVaultMemberAuthority({ memberId: actor, prisma: tx });
    const post = await lockVisiblePost(tx, actor, target);
    const now = new Date();
    const inserted = bodyEncrypted && await tx.healthPostComment.createMany({ data: [{
      id, authorMemberId: actor, postId: target, visibility: input.visibility ?? "everyone", bodyEncrypted,
      pushClaimedAt: actor === post.authorMemberId ? null : now,
    }], skipDuplicates: true });
    if (!inserted || !inserted.count) {
      const prior = await tx.healthPostComment.findUnique({ where: { id }, select: { postId: true, authorMemberId: true, deletedAt: true } });
      if (!prior || prior.postId !== target || prior.authorMemberId !== actor || prior.deletedAt) throw conflict();
      return null;
    }
    return prepareHealthNotification(tx, { actor, postId: target, memberId: post.authorMemberId, subject: { kind: "comment", commentId: id }, claimedAt: now });
  });
  sendHealthNotificationAfterCommit(notification);
  return { id };
}

/** Owners can withdraw after consent, membership, or audience changes. */
export async function deleteHealthComment(auth: Auth, id: string): Promise<void> {
  await getPrisma().$transaction(async tx => {
    await assertGameMemberAuthCurrentTx(auth, tx);
    const own = await tx.healthPostComment.findFirst({ where: { id, authorMemberId: auth.member.id }, select: { id: true } });
    if (!own) throw notFound();
    await tx.healthPostComment.updateMany({ where: { id, authorMemberId: auth.member.id, deletedAt: null },
      data: { deletedAt: new Date(), bodyEncrypted: null } });
  });
}
