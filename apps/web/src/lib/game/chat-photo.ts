import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import * as z from "@murphai/contracts/zod-runtime";
import type { HostedExecutionConversationMessageWake } from "@murphai/hosted-execution/contracts";
import type { HostedGamePhoto, HostedGameToolResponse } from "@murphai/hosted-execution/runtime-control";
import { getPrisma } from "../prisma";
import { mediaKeyPrefixFor } from "./access";
import { putGameMedia } from "./media";
import { readGamePhotoPostingStateTx, runGameCommand } from "./service";
import { addDays, dayStartInstant } from "./time";
import { downloadGameChatPhoto, gamePhotoAttachment } from "./chat-photo-media";

const offerSchema = z.object({
  v: z.literal(1), gameId: z.string(), containerMemberId: z.string(), sourceMessageRef: z.string(),
  attachmentOrdinal: z.number().int().positive(), dayIndex: z.number().int().nonnegative(),
  expiresAt: z.string(), resolutionMessageRef: z.string().nullable(),
}).strict();
type Offer = z.infer<typeof offerSchema>;
type PhotoResult = HostedGameToolResponse["result"];
type Input = {
  actor: string; containerMemberId: string; playerMemberIds: readonly string[]; messageRef: string; photo: HostedGamePhoto;
  authorize: (tx: Prisma.TransactionClient, messageRef: string) => Promise<{ actor: string | null; wake: HostedExecutionConversationMessageWake | null }>;
};
const rejected = (error: string): PhotoResult => ({ status: "rejected", error });

/** The model selects accepted message refs only; the host owns sender, bytes and day. */
export async function handleGameChatPhoto(input: Input): Promise<PhotoResult> {
  const prepared = await getPrisma().$transaction((tx) => preparePhotoTx(input, tx));
  if ("result" in prepared) return prepared.result;
  let stored: string;
  try {
    const media = await downloadGameChatPhoto(prepared.source);
    stored = await putGameMedia({ ...media, prefix: mediaKeyPrefixFor(input.actor) });
  } catch { return rejected("photo_unavailable_resend_or_use_app"); }
  const entryId = photoEntryId(input, prepared.offer);
  const result = await runGameCommand({
    actorMemberId: input.actor, chatContainerMemberId: input.containerMemberId, chatPlayerMemberIds: input.playerMemberIds,
    command: { type: "post", gameId: input.photo.gameId, entryId, kind: "photo", mediaKeys: [stored] },
    postGuard: { dayIndex: prepared.offer.dayIndex, replaceEntryId: input.photo.replaceEntryId ?? null },
    beforeMutationTx: async (tx) => {
      await requireSourceActor(input, tx, prepared.offer.sourceMessageRef);
      if (Date.parse(prepared.offer.expiresAt) <= Date.now()) throw new Error("Game photo request expired.");
      if (!input.photo.sourceMessageRef) {
        const profile = await tx.gameProfile.findUnique({ where: { memberId: input.actor }, select: { chatPhotoOffer: true } });
        const pending = offerSchema.safeParse(profile?.chatPhotoOffer);
        if (!pending.success || !sameOfferSource(pending.data, prepared.offer) || pending.data.resolutionMessageRef !== null && pending.data.resolutionMessageRef !== input.messageRef) throw new Error("Game photo selection changed.");
      }
      await tx.gameProfile.update({ where: { memberId: input.actor }, data: {
        chatPhotoIntroducedAt: new Date(), chatPhotoOffer: { ...prepared.offer, resolutionMessageRef: input.messageRef },
      } });
    },
  });
  if (!result.ok) return rejected(result.error.code);
  return { status: "ok", photoOutcome: "saved" };
}

async function preparePhotoTx(input: Input, tx: Prisma.TransactionClient): Promise<{ result: PhotoResult } | { offer: Offer; source: NonNullable<ReturnType<typeof gamePhotoAttachment>> }> {
  await requireSourceActor(input, tx, input.messageRef);
  await tx.$queryRaw`SELECT member_id FROM game_profile WHERE member_id = ${input.actor} FOR UPDATE`;
  const profile = await tx.gameProfile.findUnique({ where: { memberId: input.actor }, select: { chatPhotoIntroducedAt: true, chatPhotoOffer: true } });
  if (!profile) return { result: rejected("game_player_unavailable") };
  if (input.photo.operation === "dismiss") {
    await tx.gameProfile.update({ where: { memberId: input.actor }, data: { chatPhotoOffer: Prisma.DbNull } });
    return { result: { status: "ok", photoOutcome: "dismissed" } satisfies PhotoResult };
  }
  const posting = await readGamePhotoPostingStateTx(tx, input.photo.gameId, input.actor);
  if (!posting || posting.checkInKind === "heart_rate") return { result: rejected("photo_check_in_unavailable") };
  if (!posting.scheduled) return { result: rejected("not_a_scheduled_day") };
  const selection = await selectGamePhoto(input, tx, profile.chatPhotoOffer, posting);
  if ("result" in selection) return selection;
  if (input.photo.operation === "offer") return recordPhotoIntroduction(input, tx, profile.chatPhotoIntroducedAt, posting, selection.offer);
  const entryId = photoEntryId(input, selection.offer);
  const already = await tx.gameEntry.findUnique({ where: { id: entryId }, select: { memberId: true, withdrawnAt: true, dayIndex: true } });
  if (already?.memberId === input.actor) return { result: already.withdrawnAt === null && already.dayIndex === posting.dayIndex ? { status: "ok", photoOutcome: "saved" } : rejected("photo_already_used_choose_another") };
  if (posting.currentEntryId !== (input.photo.replaceEntryId ?? null)) return { result: rejected("replacement_confirmation_required") };
  if (posting.attemptsRemaining === 0) return { result: rejected("RETAKE_USED") };
  return selection;
}

type Posting = NonNullable<Awaited<ReturnType<typeof readGamePhotoPostingStateTx>>>;
type Selection = { result: PhotoResult } | { offer: Offer; source: NonNullable<ReturnType<typeof gamePhotoAttachment>> };
async function selectGamePhoto(input: Input, tx: Prisma.TransactionClient, saved: unknown, posting: Posting): Promise<Selection> {
  const existing = offerSchema.safeParse(saved);
  const previous = existing.success ? existing.data : null;
  if (Boolean(input.photo.sourceMessageRef) !== Boolean(input.photo.attachmentOrdinal)) return { result: rejected("select_a_photo") };
  const sourceMessageRef = input.photo.sourceMessageRef ?? previous?.sourceMessageRef;
  const attachmentOrdinal = input.photo.attachmentOrdinal ?? previous?.attachmentOrdinal;
  if (!sourceMessageRef || !attachmentOrdinal) return { result: rejected("select_a_photo") };
  if (!input.photo.sourceMessageRef && !isUsablePendingOffer(previous, input, posting)) return { result: rejected("photo_offer_expired") };
  const wake = await requireSourceActor(input, tx, sourceMessageRef);
  const source = wake ? gamePhotoAttachment(wake, attachmentOrdinal) : null;
  if (!source || !wake) return { result: rejected("photo_unavailable_resend_or_use_app") };
  const dayStartsAt = dayStartInstant(addDays(posting.player.dayOne!, posting.dayIndex), posting.player.timeZone).getTime();
  const receivedAt = Date.parse(wake.occurredAt);
  if (!Number.isFinite(receivedAt) || receivedAt < dayStartsAt || receivedAt > posting.now.getTime()) return { result: rejected("photo_is_not_from_current_game_day") };
  const offer: Offer = { v: 1, gameId: input.photo.gameId, containerMemberId: input.containerMemberId,
    sourceMessageRef, attachmentOrdinal, dayIndex: posting.dayIndex,
    expiresAt: input.photo.sourceMessageRef ? new Date(Math.min(posting.now.getTime() + 30 * 60_000, dayStartInstant(addDays(posting.player.dayOne!, posting.dayIndex + 1), posting.player.timeZone).getTime())).toISOString() : previous!.expiresAt,
    resolutionMessageRef: null };
  return { offer, source };
}

function isUsablePendingOffer(previous: Offer | null, input: Input, posting: Posting): boolean {
  return previous !== null && previous.gameId === input.photo.gameId && previous.containerMemberId === input.containerMemberId
    && previous.dayIndex === posting.dayIndex && Date.parse(previous.expiresAt) > posting.now.getTime()
    && (previous.resolutionMessageRef === null || previous.resolutionMessageRef === input.messageRef);
}

async function recordPhotoIntroduction(input: Input, tx: Prisma.TransactionClient, introduced: Date | null, posting: Posting, offer: Offer): Promise<{ result: PhotoResult }> {
  if (introduced !== null || posting.currentEntryId !== null || offer.sourceMessageRef !== input.messageRef) return { result: { status: "ok", photoOutcome: "suppressed" } };
  // A failed model delivery does not retry this optional introduction and nag the member.
  await tx.gameProfile.update({ where: { memberId: input.actor }, data: { chatPhotoIntroducedAt: posting.now, chatPhotoOffer: offer } });
  return { result: { status: "ok", photoOutcome: "offer" } };
}

function photoEntryId(input: Input, offer: Offer): string {
  return `gce_${createHash("sha256").update(JSON.stringify([input.photo.gameId, input.actor, offer.sourceMessageRef, offer.attachmentOrdinal])).digest("hex").slice(0, 48)}`;
}

async function requireSourceActor(input: Input, tx: Prisma.TransactionClient, messageRef: string) {
  const current = await input.authorize(tx, input.messageRef);
  const source = messageRef === input.messageRef ? current : await input.authorize(tx, messageRef);
  if (current.actor !== input.actor || source.actor !== input.actor || !source.wake) throw new Error("Game photo sender authority changed.");
  return source.wake;
}

function sameOfferSource(first: Offer, second: Offer) {
  return first.gameId === second.gameId && first.containerMemberId === second.containerMemberId
    && first.sourceMessageRef === second.sourceMessageRef && first.attachmentOrdinal === second.attachmentOrdinal
    && first.dayIndex === second.dayIndex && Date.parse(first.expiresAt) > Date.now();
}
