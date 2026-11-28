import "server-only";
import { Prisma } from "@prisma/client";
import { after } from "next/server";
import type { HostedNativeMemberAuth } from "../better-auth/native-auth";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import type { ClientUnits } from "../companion/client-info";
import { lockGamePair } from "../game/blocks";
import { assertGameMemberAuthCurrentTx, requireCurrentTermsFor } from "../game/http/auth";
import { invalidGameRequest } from "../game/http/errors";
import { ArtSkipped } from "../game/progress/place-art";
import type { AreaPainting } from "../game/progress/place-art-make";
import { redeemGameTicketTx } from "../game/service";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { describeKnownLoggedErrorType } from "../http";
import { getPrisma } from "../prisma";
import { admitActivityName } from "./activity-name";
import { findVisibleHealthPost, visibleHealthCommentOnPostSql } from "./audience";
import { type CachedHealthCandidate, type FrozenHealthCard, type HealthCardSelection, resolveRecordedSelection } from "./card-options";
import { openHealthTexts, sealHealthTexts } from "./crypto";
import type { RecordedActivity } from "./engine/types";
import { assertHealthRecordEnabled, healthRecordCapability } from "./flag";
import { publishHealthAttachmentTx, purgeRetiredHealthAttachments, retireHealthPostAttachmentTx } from "./media";
import { CHEER_WINDOW_MS, commentNotificationTargets, prepareHealthNotifications, sendHealthNotificationsAfterCommit } from "./notifications";
import { assertPayoffCurrentTx, preparePayoffSelection } from "./payoff";
import { postedCardKeys } from "./posted-card-keys";
import { prepareHealthActivity, storeRecordedActivityTx } from "./recorded-activities";
import { hasExternalCardEdit, isPayoffPick, isSeeYoursPick, validPayoffPost } from "./request";
import { resolveSeeYoursSelection } from "./see-yours";
import { assertHealthSetCurrent, resolveHealthCards } from "./wins";

type Tx = Prisma.TransactionClient;
type Auth = HostedNativeMemberAuth;
type Content = { caption?: string | null; setRevision?: string; cards?: readonly HealthCardSelection[] };
type CreatePost = Content & { id: string; attachmentId?: string; activity?: RecordedActivity };
type CreateCardContext = { recorded?: readonly CachedHealthCandidate[]; units: ClientUnits; signal?: AbortSignal };
type Comment = { id: string; body: string } & (
  | { replyTo?: undefined; visibility?: "everyone" | "poster" }
  | { replyTo: string; visibility?: unknown }
);
const postReceipt = { id: true, authorMemberId: true, deletedAt: true, version: true } as const;
const notFound = () => hostedOnboardingError({ code: "HEALTH_NOT_FOUND", httpStatus: 404, message: "That item is unavailable." });
const conflict = () => hostedOnboardingError({ code: "HEALTH_WRITE_CONFLICT", httpStatus: 409, message: "That item has changed." });
const payoffExists = () => hostedOnboardingError({ code: "HEALTH_PAYOFF_EXISTS", httpStatus: 409, message: "This game already has a payoff post." });

function replayPost(row: { id: string; authorMemberId: string; deletedAt: Date | null; version: number }, actor: string) {
  if (row.authorMemberId !== actor || row.deletedAt) throw conflict();
  return { id: row.id, version: row.version };
}

async function resolvePostCards(auth: Auth, input: Content, create?: CreateCardContext) {
  if (!input.cards?.length) return { cards: input.cards === undefined ? undefined : [], day: undefined };
  const minePicks = input.cards.filter(isSeeYoursPick);
  if (minePicks.length > 1 || (minePicks.length && !create)) throw invalidGameRequest("Choose one See yours card when creating a post.");
  const winSelections = input.cards.filter(pick => !pick.candidateId.startsWith("activity:") && !isSeeYoursPick(pick));
  if (winSelections.length && !input.setRevision) throw invalidGameRequest("Choose cards from a current set.");
  const wins = winSelections.length && input.setRevision
    ? await resolveHealthCards(auth, input.setRevision, winSelections)
    : undefined;
  const bySelector = new Map(wins?.cards.map(card => [card.id, card]));
  const mine = minePicks[0];
  if (mine && create) {
    const frozen = await resolveSeeYoursSelection(auth, mine, create.units, create.signal);
    if (bySelector.has(frozen.id)) throw invalidGameRequest("Choose each card only once.");
    bySelector.set(mine.candidateId, frozen);
  }
  const cards = input.cards.map(pick => {
    if (pick.candidateId.startsWith("activity:")) return resolveRecordedSelection(create?.recorded ?? [], pick);
    const frozen = bySelector.get(pick.candidateId);
    if (!frozen) throw invalidGameRequest("Choose a card from this set.");
    return frozen;
  }).filter(card => card !== null);
  return { cards, day: wins?.day };
}

async function resolveCreateCards(auth: Auth, input: CreatePost, create: CreateCardContext) {
  const pick = input.cards?.find(isPayoffPick);
  if (!pick) return { ...await resolvePostCards(auth, input, create), payoff: null };
  if (!validPayoffPost(input)) throw invalidGameRequest("Choose one payoff card with its preview and a photo.");
  const payoff = await preparePayoffSelection(auth.member.id, pick);
  await requireCurrentTermsFor(auth.member.id, { type: "redeem" });
  return { cards: [payoff.card], day: undefined, payoff };
}

async function lockPayoffForPostTx(tx: Tx, memberId: string, id: string, payoff: Awaited<ReturnType<typeof preparePayoffSelection>>) {
  // Blocks take the pair lock before the game lock. Corrections and departures take the game lock.
  await lockGamePair(tx, memberId, payoff.debtorMemberId);
  await tx.$queryRaw`SELECT id FROM game WHERE id = ${payoff.gameId} FOR UPDATE`;
  const accepted = await tx.healthPost.findUnique({ where: { id }, select: postReceipt });
  if (accepted) return replayPost(accepted, memberId);
  await assertPayoffCurrentTx(tx, memberId, payoff);
  return null;
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
  auth: Auth, input: CreatePost, units: ClientUnits = "us", signal?: AbortSignal,
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
  if (input.activity) {
    assertHealthRecordEnabled(memberId, input.activity.route ? "route" : "timed");
    if (input.activity.name !== undefined) admitActivityName(input.activity.name, "recording");
  }
  await assertBrowserVaultMemberAuthority({ memberId, prisma: db });
  const recording = input.activity ? await prepareHealthActivity(auth, input.activity, units) : undefined;
  const { cards, day, payoff } = await resolveCreateCards(auth, input, { recorded: recording?.candidates, units, signal });
  if (!input.caption?.trim() && !cards?.length && !input.attachmentId) throw invalidGameRequest("Add words, a card, or a photo.");
  const data = await sealPostContent(memberId, id, input.caption, cards);
  const { receipt, created } = await db.$transaction(async tx => {
    await assertGameMemberAuthCurrentTx(auth, tx);
    await assertBrowserVaultMemberAuthority({ memberId, prisma: tx });
    if (payoff) {
      const replay = await lockPayoffForPostTx(tx, memberId, id, payoff);
      if (replay) return { receipt: replay, created: false };
    }
    const inserted = await tx.healthPost.createMany({ data: [{ id, authorMemberId: memberId, gameId: payoff?.gameId, ...data }], skipDuplicates: true });
    if (!inserted.count) {
      const row = await tx.healthPost.findUnique({ where: { id }, select: postReceipt });
      if (!row) throw payoff ? payoffExists() : conflict();
      return { receipt: replayPost(row, memberId), created: false };
    }
    // A conflict rolls back the post. The shared set lock spans publication through commit.
    if (day && input.setRevision) await assertHealthSetCurrent(tx, memberId, day, input.setRevision);
    if (recording) await storeRecordedActivityTx(tx, recording.prepared, id);
    if (input.attachmentId) await publishHealthAttachmentTx(tx, memberId, id, input.attachmentId.toLowerCase());
    if (payoff) await redeemGameTicketTx(tx, { actor: memberId, gameId: payoff.gameId, ticketId: payoff.ticketId });
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
    version: true, gameId: true, activity: { select: { id: true } }, cardsEncrypted: Boolean(input.removeCardIds),
  } });
  if (!current) throw notFound();
  if (input.expectedVersion !== current.version) throw conflict();
  if (current.gameId !== null && (input.cards !== undefined || input.removeCardIds !== undefined || input.setRevision !== undefined)) {
    throw invalidGameRequest("Only the caption can change on a payoff post.");
  }
  if (hasExternalCardEdit(input)) throw invalidGameRequest("Create a new post to share this card.");
  if (current.activity && input.cards?.length) throw invalidGameRequest("You can remove cards from a recorded post.");
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
  const notifications = await getPrisma().$transaction(async tx => {
    await assertGameMemberAuthCurrentTx(auth, tx);
    await assertBrowserVaultMemberAuthority({ memberId: actor, prisma: tx });
    if (!enabled) {
      // The viewer can retract an existing cheer after a hide.
      const removed = await tx.healthPostCheer.deleteMany({ where: { postId, memberId: actor } });
      if (!removed.count && !await findVisibleHealthPost(tx, actor, postId)) throw notFound();
      return [];
    }
    const post = await lockVisiblePost(tx, actor, postId);
    const now = new Date();
    const inserted = await tx.healthPostCheer.createMany({ data: [{ postId, memberId: actor, createdAt: now }], skipDuplicates: true });
    if (!inserted.count || actor === post.authorMemberId) return [];
    const claimed = await tx.healthPost.updateMany({ where: { id: postId, deletedAt: null, OR: [
      { cheerPushClaimedAt: null }, { cheerPushClaimedAt: { lte: new Date(now.getTime() - CHEER_WINDOW_MS) } },
    ] }, data: { cheerPushClaimedAt: now } });
    if (!claimed.count) return [];
    return prepareHealthNotifications(tx, { actor, postId, subject: { kind: "cheer" }, claimedAt: now },
      [{ memberId: post.authorMemberId, reason: "cheer" }]);
  });
  sendHealthNotificationsAfterCommit(notifications);
}

function publicReplyVisibility(visibility: unknown) {
  if (visibility !== undefined && visibility !== "everyone") throw invalidGameRequest("A reply to a public comment is visible to everyone on the post.");
  return "everyone" as const;
}

async function commentAudience(tx: Tx, actor: string, poster: string, postId: string, input: Comment) {
  if (input.replyTo === undefined) return { visibility: input.visibility ?? "everyone", recipientMemberId: null, parentAuthorId: null };
  // Comment withdrawal does not lock the post. Hold the visible parent through insertion.
  const [parent] = await tx.$queryRaw<Array<{ author: string; visibility: string; recipient: string | null }>>`
    SELECT c.author_member_id AS author, c.visibility, c.recipient_member_id AS recipient FROM health_post_comment c
    WHERE c.id = ${input.replyTo}::uuid AND c.post_id = ${postId}::uuid
      AND ${visibleHealthCommentOnPostSql(actor, Prisma.sql`${poster}::text`)}
    FOR SHARE OF c`;
  if (!parent) throw notFound();
  if (parent.visibility === "everyone") {
    return { visibility: publicReplyVisibility(input.visibility), recipientMemberId: null, parentAuthorId: parent.author };
  }
  if (parent.recipient === null) {
    if (actor !== poster || parent.author === poster) throw notFound();
    return { visibility: "poster", recipientMemberId: parent.author, parentAuthorId: parent.author };
  }
  if (actor !== parent.recipient) throw notFound();
  return { visibility: "poster", recipientMemberId: null, parentAuthorId: parent.author };
}

async function checkCommentReplay(tx: Tx, prior: {
  postId: string; authorMemberId: string; parentCommentId: string | null; visibility: string;
  recipientMemberId: string | null; deletedAt: Date | null;
}, actor: string, postId: string, input: Comment) {
  if (prior.postId !== postId || prior.authorMemberId !== actor || prior.deletedAt) throw conflict();
  if (prior.parentCommentId !== null) {
    if (prior.parentCommentId !== input.replyTo?.toLowerCase()) throw conflict();
    // The same parent fixes the audience, including when a legacy client submitted "everyone" privately.
    if (prior.visibility === "everyone") publicReplyVisibility(input.visibility);
    return;
  }
  if (!input.replyTo && prior.recipientMemberId === null) return;
  // Old private answers stored only their recipient. A withdrawn original still proves that receipt.
  if (!input.replyTo || !prior.recipientMemberId || !await tx.healthPostComment.findFirst({
    where: { id: input.replyTo, postId, visibility: "poster", recipientMemberId: null, authorMemberId: prior.recipientMemberId },
    select: { id: true },
  })) throw conflict();
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
  const notifications = await db.$transaction(async tx => {
    await assertGameMemberAuthCurrentTx(auth, tx);
    await assertBrowserVaultMemberAuthority({ memberId: actor, prisma: tx });
    const post = await lockVisiblePost(tx, actor, target);
    const prior = await tx.healthPostComment.findUnique({ where: { id }, select: {
      postId: true, authorMemberId: true, parentCommentId: true, visibility: true, recipientMemberId: true, deletedAt: true,
    } });
    if (prior) {
      await checkCommentReplay(tx, prior, actor, target, input);
      return [];
    }
    if (!bodyEncrypted) throw conflict();
    const { visibility, recipientMemberId, parentAuthorId } = await commentAudience(tx, actor, post.authorMemberId, target, input);
    const targets = commentNotificationTargets(actor, post.authorMemberId, parentAuthorId, recipientMemberId);
    const now = new Date();
    const inserted = await tx.healthPostComment.createMany({ data: [{
      id, authorMemberId: actor, postId: target, recipientMemberId, bodyEncrypted,
      parentCommentId: input.replyTo, visibility, pushClaimedAt: targets.length ? now : null,
    }], skipDuplicates: true });
    // Same-post writers hold the parent lock, so an insert collision here belongs to another post.
    if (!inserted.count) throw conflict();
    return prepareHealthNotifications(tx, { actor, postId: target, subject: { kind: "comment", commentId: id }, claimedAt: now }, targets);
  });
  sendHealthNotificationsAfterCommit(notifications);
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
