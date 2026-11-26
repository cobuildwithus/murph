import "server-only";
import type { Prisma } from "@prisma/client";
import { after } from "next/server";
import type { HostedNativeMemberAuth } from "../better-auth/native-auth";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import type { ClientUnits } from "../companion/client-info";
import { assertGameMemberAuthCurrentTx } from "../game/http/auth";
import { invalidGameRequest } from "../game/http/errors";
import { ArtSkipped } from "../game/progress/place-art";
import type { AreaPainting } from "../game/progress/place-art-make";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { describeKnownLoggedErrorType } from "../http";
import { getPrisma } from "../prisma";
import { findVisibleHealthPost } from "./audience";
import { type CachedHealthCandidate, type FrozenHealthCard, type HealthCardSelection, resolveRecordedSelection } from "./card-options";
import { openHealthTexts, sealHealthTexts } from "./crypto";
import type { RecordedActivity } from "./engine/types";
import { assertHealthRecordEnabled, healthRecordCapability } from "./flag";
import { publishHealthAttachmentTx, purgeRetiredHealthAttachments, retireHealthPostAttachmentTx } from "./media";
import { CHEER_WINDOW_MS, prepareHealthNotification, sendHealthNotificationAfterCommit } from "./notifications";
import { postedCardKeys } from "./posted-card-keys";
import { prepareHealthActivity, storeRecordedActivityTx } from "./recorded-activities";
import { assertHealthSetCurrent, resolveHealthCards } from "./wins";

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

async function resolvePostCards(auth: Auth, input: Content, candidates: readonly CachedHealthCandidate[] = []) {
  if (!input.cards?.length) return { cards: input.cards === undefined ? undefined : [], day: undefined };
  const winSelections = input.cards.filter(pick => !pick.candidateId.startsWith("activity:"));
  if (winSelections.length && !input.setRevision) throw invalidGameRequest("Choose cards from a current set.");
  const wins = winSelections.length && input.setRevision
    ? await resolveHealthCards(auth, input.setRevision, winSelections)
    : undefined;
  const cards = input.cards.map(pick => {
    if (!pick.candidateId.startsWith("activity:")) {
      const frozen = wins?.cards.find(card => card.id === pick.candidateId);
      if (!frozen) throw invalidGameRequest("Choose a card from this set.");
      return frozen;
    }
    return resolveRecordedSelection(candidates, pick);
  }).filter(card => card !== null);
  return { cards, day: wins?.day };
}

async function sealPostContent(memberId: string, id: string, caption: string | null | undefined, cards?: readonly FrozenHealthCard[]) {
  const target = { memberId, table: "health_post", rowId: id } as const;
  const text = caption?.trim();
  const sealed = await sealHealthTexts([
    ...(cards ?? []).map((card, index) => ({ ...target, field: `card:${index}`, value: JSON.stringify(card) })),
    ...(text ? [{ ...target, field: "caption", value: text }] : []),
  ]);
  return {
    ...(cards !== undefined ? {
      cardsEncrypted: sealed.slice(0, cards.length),
      postedCardKeys: [...postedCardKeys(memberId, cards.map(card => card.id)).values()],
    } : {}),
    ...(caption !== undefined ? { captionEncrypted: text ? sealed[sealed.length - 1]! : null } : {}),
  };
}

async function openFrozenCards(memberId: string, id: string, encrypted: string[]) {
  const target = { memberId, table: "health_post", rowId: id } as const;
  const opened = await openHealthTexts(encrypted.map((value, index) => ({ ...target, field: `card:${index}`, value })));
  return opened.map(text => JSON.parse(text) as FrozenHealthCard);
}

// Card ciphertext is bound to its array position. Re-seal the retained specs at their new positions.
async function removeFrozenCards(memberId: string, id: string, encrypted: string[], removeIds: readonly string[]) {
  const opened = await openFrozenCards(memberId, id, encrypted);
  const remove = new Set(removeIds);
  const keep = opened.filter(card => !remove.has(card.id));
  if (opened.length - keep.length !== remove.size) throw invalidGameRequest("Choose a card on this post.");
  return keep;
}

function routePainting(cards: readonly FrozenHealthCard[]): AreaPainting | null {
  for (const { spec } of cards) {
    if (spec.kind === "activity_route" && spec.chart.type === "route_map" && spec.chart.art) {
      return { key: spec.chart.art.key, frame: spec.chart.frame };
    }
  }
  return null;
}

function paintRouteAfterCommit(memberId: string, postId: string, painting: AreaPainting) {
  const paint = async () => {
    const { ensureAreaArt } = await import("../game/progress/place-art-make");
    const db = getPrisma();
    // The insert committed the selected route card at version 1.
    let verifiedVersion = 1;
    const currentVersion = async () => {
      if (process.env.MURPH_HEALTH_PAINTED_RUNS !== "true" || !healthRecordCapability(memberId)?.route) throw new ArtSkipped();
      const current = await findVisibleHealthPost(db, memberId, postId);
      if (current?.authorMemberId !== memberId) throw new ArtSkipped();
      return current.version;
    };
    await ensureAreaArt(painting, memberId, async () => {
      const version = await currentVersion();
      if (version === verifiedVersion) return;
      // Caption edits and removal of other cards may leave the route card intact.
      const row = await db.healthPost.findFirst({ where: { id: postId, version, deletedAt: null, authorMemberId: memberId },
        select: { cardsEncrypted: true } });
      if (!row || routePainting(await openFrozenCards(memberId, postId, row.cardsEncrypted))?.key !== painting.key) throw new ArtSkipped();
      if (await currentVersion() !== version) throw new ArtSkipped();
      verifiedVersion = version;
    });
  };
  try {
    after(() => paint().catch((error: unknown) => {
      if (!(error instanceof ArtSkipped)) console.error("Health wins area painting failed.", { errorClass: describeKnownLoggedErrorType(error) });
    }));
  } catch {
    // A runtime without after() still returns the committed receipt and uses the native map.
  }
}

/** An acknowledged retry does not depend on the original set still being current. */
export async function createHealthPost(
  auth: Auth, input: Content & { id: string; attachmentId?: string; activity?: RecordedActivity }, units: ClientUnits = "us",
) {
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
  // After the replay branch, so a committed post still returns its receipt if the flag is turned off.
  if (input.activity) assertHealthRecordEnabled(memberId, input.activity.route ? "route" : "timed");
  await assertBrowserVaultMemberAuthority({ memberId, prisma: db });
  const recording = input.activity ? await prepareHealthActivity(auth, input.activity, units) : undefined;
  const { cards, day } = await resolvePostCards(auth, input, recording?.candidates);
  if (!input.caption?.trim() && !cards?.length && !input.attachmentId) throw invalidGameRequest("Add words, a card, or a photo.");
  const data = await sealPostContent(memberId, id, input.caption, cards);
  const { receipt, created } = await db.$transaction(async tx => {
    await assertGameMemberAuthCurrentTx(auth, tx);
    await assertBrowserVaultMemberAuthority({ memberId, prisma: tx });
    const inserted = await tx.healthPost.createMany({ data: [{ id, authorMemberId: memberId, ...data }], skipDuplicates: true });
    if (!inserted.count) {
      const row = await tx.healthPost.findUniqueOrThrow({ where: { id }, select: postReceipt });
      return { receipt: replayPost(row, memberId), created: false };
    }
    // A conflict rolls back the post. The shared set lock spans publication through commit.
    if (day && input.setRevision) await assertHealthSetCurrent(tx, memberId, day, input.setRevision);
    if (recording) await storeRecordedActivityTx(tx, recording.prepared, id);
    if (input.attachmentId) await publishHealthAttachmentTx(tx, memberId, id, input.attachmentId.toLowerCase());
    return { receipt: { id, version: 1 }, created: true };
  });
  if (created && input.activity?.route && process.env.MURPH_HEALTH_PAINTED_RUNS === "true") {
    const painting = routePainting(cards ?? []);
    if (painting) paintRouteAfterCommit(memberId, id, painting);
  }
  return receipt;
}

export async function patchHealthPost(auth: Auth, postId: string, input: Content & { expectedVersion: number; removeCardIds?: readonly string[] }) {
  const db = getPrisma(), memberId = auth.member.id, id = postId.toLowerCase();
  if (input.caption === undefined && input.cards === undefined && !input.removeCardIds?.length) throw invalidGameRequest("Choose an edit.");
  await assertBrowserVaultMemberAuthority({ memberId, prisma: db });
  const current = await db.healthPost.findFirst({ where: { id, authorMemberId: memberId, deletedAt: null }, select: {
    version: true, activity: { select: { id: true } }, cardsEncrypted: Boolean(input.removeCardIds),
  } });
  if (!current) throw notFound();
  if (input.expectedVersion !== current.version) throw conflict();
  if (current.activity && input.cards?.length) throw invalidGameRequest("You can remove cards from a recorded post.");
  if (input.removeCardIds && !current.activity) throw invalidGameRequest("Choose cards from the current set to edit this post.");
  const { cards, day } = input.removeCardIds
    ? { cards: await removeFrozenCards(memberId, id, current.cardsEncrypted, input.removeCardIds), day: undefined }
    : await resolvePostCards(auth, input);
  const data = await sealPostContent(memberId, id, input.caption, cards);
  return db.$transaction(async tx => {
    await assertGameMemberAuthCurrentTx(auth, tx);
    await assertBrowserVaultMemberAuthority({ memberId, prisma: tx });
    if (day && input.setRevision) await assertHealthSetCurrent(tx, memberId, day, input.setRevision);
    const updated = await tx.healthPost.updateMany({ where: { id, authorMemberId: memberId, deletedAt: null, version: input.expectedVersion },
      data: { ...data, version: { increment: 1 } } });
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
      data: { deletedAt: now, captionEncrypted: null, cardsEncrypted: [], postedCardKeys: [], version: { increment: 1 } } });
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
    await assertBrowserVaultMemberAuthority({ memberId: actor, prisma: tx });
    if (!enabled) {
      // The viewer can retract an existing cheer after a hide.
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
