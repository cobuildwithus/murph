import { Prisma, type PrismaClient } from "@prisma/client";

import { createHostedLinqChatLookupKey, createHostedLinqChatLookupKeyReadCandidates } from "./contact-privacy";
import {
  getHostedLinqChatHandles,
  isHostedLinqAttachmentSendPrepareFailure,
  sendHostedLinqAttachmentMessage,
  shareHostedLinqContactCard,
} from "./linq-client";
import {
  buildMurphHostedLinqContactCardVcf,
  fetchMurphHostedLinqContactCardVcfPhoto,
  getHostedLinqContactCard,
  MURPH_CONTACT_CARD_VCF_CONTENT_TYPE,
  MURPH_CONTACT_CARD_VCF_FILE_NAME,
  resolveMurphHostedLinqContactCardBackupPhoneNumber,
} from "./linq-contact-card";
import { normalizePhoneNumber } from "./phone";

type HostedLinqContactCardSharePersistenceClient =
  {
    hostedLinqContactCardShare: {
      create(input: HostedLinqContactCardShareCreateInput): Promise<unknown>;
      findMany(input: HostedLinqContactCardShareFindManyInput):
        Promise<HostedLinqContactCardShareExisting[]>;
      updateMany(input: HostedLinqContactCardShareUpdateManyInput):
        Promise<{ count: number }>;
    };
  };

type HostedLinqContactCardShareExisting = {
  lastContactCardShareAttemptedAt: Date | null;
  linqChatLookupKey: string;
};

type HostedLinqContactCardShareCreateInput = {
  data: {
    lastContactCardShareAttemptedAt: Date;
    linqChatLookupKey: string;
    memberId: string;
  };
};

type HostedLinqContactCardShareUpdateManyInput = {
  data: {
    lastContactCardShareAttemptedAt?: Date | null;
    memberId?: string;
  };
  where: Record<string, unknown>;
};

type HostedLinqContactCardShareFindManyInput = {
  select: {
    lastContactCardShareAttemptedAt: true;
    linqChatLookupKey: true;
  };
  where: {
    linqChatLookupKey: {
      in: string[];
    };
  };
};

// Sized to the runtime turn-retry horizon, not a user-visible cooldown. The
// hosted turn retries up to 6 times and this send is not journaled, so a
// duplicate contact-card share firing (a retried/replayed turn, or a
// coalesced wake burst) must collapse to one card. A genuine human re-request
// arrives minutes later, after the card is already in the chat, so 90s is
// imperceptible to it while still covering the retry backoff.
const HOSTED_LINQ_CONTACT_CARD_SHARE_THROTTLE_MS = 90 * 1000;

type HostedLinqContactCardShareSkipReason =
  | "missing_chat_id"
  | "recent_attempt";

type HostedLinqContactCardShareDecision =
  | {
      action: "share";
    }
  | {
      action: "skip";
      reason: HostedLinqContactCardShareSkipReason;
    };

type HostedLinqContactCardShareReserveDecision =
  | { action: "share"; attemptedAt: Date }
  | Extract<HostedLinqContactCardShareDecision, { action: "skip" }>;

/**
 * Shared per-chat share throttle. Callers own their eligibility/authority
 * checks; this only dedupes duplicate attempts within one turn/wake (one per
 * chat per 90 seconds). A requested re-share outside that window must go
 * through.
 */
export async function reserveHostedLinqContactCardShareAttempt(input: {
  chatId: string;
  memberId: string;
  now?: Date;
  prisma: HostedLinqContactCardSharePersistenceClient;
}): Promise<HostedLinqContactCardShareReserveDecision> {
  const now = input.now ?? new Date();
  const chatLookup = resolveHostedLinqContactCardShareLookup(input.chatId);
  if (!chatLookup) {
    return {
      action: "skip",
      reason: "missing_chat_id",
    };
  }

  const attemptBefore = new Date(
    now.getTime() - HOSTED_LINQ_CONTACT_CARD_SHARE_THROTTLE_MS,
  );
  const existingRows = await input.prisma.hostedLinqContactCardShare.findMany({
    where: {
      linqChatLookupKey: {
        in: [...chatLookup.readCandidates],
      },
    },
    select: {
      lastContactCardShareAttemptedAt: true,
      linqChatLookupKey: true,
    },
  });

  if (existingRows.length === 0) {
    return await createHostedLinqContactCardShareAttemptReservation({
      chatLookupKey: chatLookup.writeKey,
      memberId: input.memberId,
      now,
      prisma: input.prisma,
    });
  }

  const hasRecentAttempt = existingRows.some((row) =>
    row.lastContactCardShareAttemptedAt
    && row.lastContactCardShareAttemptedAt > attemptBefore,
  );
  if (hasRecentAttempt) {
    return {
      action: "skip",
      reason: "recent_attempt",
    };
  }

  const currentReservation = existingRows.find((row) =>
    row.linqChatLookupKey === chatLookup.writeKey
  );
  if (!currentReservation) {
    return await createHostedLinqContactCardShareAttemptReservation({
      chatLookupKey: chatLookup.writeKey,
      memberId: input.memberId,
      now,
      prisma: input.prisma,
    });
  }

  const reserved = await input.prisma.hostedLinqContactCardShare.updateMany({
    where: {
      linqChatLookupKey: chatLookup.writeKey,
      OR: [
        { lastContactCardShareAttemptedAt: null },
        { lastContactCardShareAttemptedAt: { lte: attemptBefore } },
      ],
    },
    data: {
      lastContactCardShareAttemptedAt: now,
      memberId: input.memberId,
    },
  });

  if (reserved.count !== 1) {
    return {
      action: "skip",
      reason: "recent_attempt",
    };
  }

  return {
    action: "share",
    attemptedAt: now,
  };
}

function resolveHostedLinqContactCardShareLookup(
  chatId: string,
): { readCandidates: readonly string[]; writeKey: string } | null {
  const writeKey = createHostedLinqChatLookupKey(chatId);
  const readCandidates = createHostedLinqChatLookupKeyReadCandidates(chatId);
  if (!writeKey || readCandidates.length === 0) {
    return null;
  }
  return {
    readCandidates,
    writeKey,
  };
}

async function createHostedLinqContactCardShareAttemptReservation(input: {
  chatLookupKey: string;
  memberId: string;
  now: Date;
  prisma: HostedLinqContactCardSharePersistenceClient;
}): Promise<HostedLinqContactCardShareReserveDecision> {
  try {
    await input.prisma.hostedLinqContactCardShare.create({
      data: {
        lastContactCardShareAttemptedAt: input.now,
        linqChatLookupKey: input.chatLookupKey,
        memberId: input.memberId,
      },
    });
  } catch (error) {
    if (isPrismaUniqueViolation(error)) {
      return {
        action: "skip",
        reason: "recent_attempt",
      };
    }
    throw error;
  }

  return {
    action: "share",
    attemptedAt: input.now,
  };
}

/**
 * Undo a reservation whose share provably never reached the provider (for
 * example the attachment upload failed before the message send started).
 * Matching on the exact reservation instant keeps a concurrent newer
 * reservation untouched. Ambiguous send failures must NOT release.
 */
export async function releaseHostedLinqContactCardShareAttempt(input: {
  attemptedAt: Date;
  chatId: string;
  memberId: string;
  prisma: HostedLinqContactCardSharePersistenceClient;
}): Promise<void> {
  const chatLookup = resolveHostedLinqContactCardShareLookup(input.chatId);
  if (!chatLookup) {
    return;
  }
  await input.prisma.hostedLinqContactCardShare.updateMany({
    where: {
      lastContactCardShareAttemptedAt: input.attemptedAt,
      linqChatLookupKey: chatLookup.writeKey,
      memberId: input.memberId,
    },
    data: {
      lastContactCardShareAttemptedAt: null,
    },
  });
}

function isPrismaUniqueViolation(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Automatic first-contact shares stay iMessage-only. Group and direct threads
 * are both eligible; the per-chat reservation in this module is the volume
 * guard.
 */
export function isHostedLinqContactCardAutoShareEligible(eligibility: {
  service: string | null;
}): boolean {
  return eligibility.service?.trim().toLowerCase() === "imessage";
}

export type MurphHostedLinqContactCardVcfShareOutcome =
  | { status: "already_shared" }
  | { status: "sent" }
  | {
      status: "skipped";
      reason: "line_unresolved" | "missing_chat_id" | "provider_unavailable";
    }
  | { status: "failed"; reason: "send_failed"; error: unknown };

export type MurphHostedLinqNativeContactCardShareOutcome =
  | { status: "already_shared" }
  | { status: "sent" }
  | {
      status: "skipped";
      reason:
        | "line_card_has_image"
        | "line_card_unverified"
        | "missing_chat_id";
    }
  | { status: "failed"; reason: "send_failed"; error: unknown };

/**
 * Share the sending line's provider contact card into a Linq chat. Callers own
 * eligibility and thread authority; this first verifies that the chat's own
 * sending-line card is image-free, then owns the shared per-chat reservation
 * and the single native provider POST. Unverifiable cards skip fail-soft. Any
 * native provider failure is ambiguous, so the reservation stays in place to
 * avoid a blind duplicate.
 *
 * This is a deliberately simple, best-effort guard, not an authoritative proof.
 * Native `share_contact_card` is a bodyless POST, so Linq chooses which card to
 * push and our preflight GET cannot be atomically bound to that effect; on an
 * ambiguous roster the wrong self line could be read. We accept that residual
 * risk in exchange for minimal complexity, because the real fix is Linq
 * exposing a provider-enforced image-free share (in progress) plus operators
 * clearing existing line-card images (the hourly reconcile normalizes the name
 * but never clears images, and the API cannot clear them).
 *
 * When the line card has an image or cannot be verified, this share is skipped
 * for that delivery by explicit product decision, not a silent drop: the
 * text-first member still received the signup reply and can add Murph via the
 * web contact-card picker, and the automatic native share self-heals for future
 * contacts once the line-card image is removed. The skip is logged by the
 * caller. This trade favors a simple, maintainable path over guaranteeing an
 * automatic card for every member during the image-cleanup window.
 */
export async function shareMurphHostedLinqNativeContactCardToChat(input: {
  chatId: string;
  memberId: string;
  now?: Date;
  prisma: HostedLinqContactCardSharePersistenceClient;
  signal?: AbortSignal;
}): Promise<MurphHostedLinqNativeContactCardShareOutcome> {
  try {
    const handles = await getHostedLinqChatHandles({
      chatId: input.chatId,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const linePhoneNumber = normalizePhoneNumber(
      handles.find((handle) => handle.isMe)?.handle ?? null,
    );
    if (!linePhoneNumber) {
      return { status: "skipped", reason: "line_card_unverified" };
    }

    const lineCard = await getHostedLinqContactCard({
      phoneNumber: linePhoneNumber,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!lineCard) {
      return { status: "skipped", reason: "line_card_unverified" };
    }
    if (lineCard.imageUrl !== null) {
      return { status: "skipped", reason: "line_card_has_image" };
    }
  } catch {
    return { status: "skipped", reason: "line_card_unverified" };
  }

  const reservation = await reserveHostedLinqContactCardShareAttempt({
    chatId: input.chatId,
    memberId: input.memberId,
    ...(input.now ? { now: input.now } : {}),
    prisma: input.prisma,
  });
  if (reservation.action !== "share") {
    return reservation.reason === "recent_attempt"
      ? { status: "already_shared" }
      : { status: "skipped", reason: reservation.reason };
  }

  try {
    await shareHostedLinqContactCard({
      chatId: input.chatId,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    return { status: "failed", reason: "send_failed", error };
  }

  return { status: "sent" };
}

/**
 * Share Murph's first-party vCard into a Linq chat as an attachment. This is
 * the discretionary group-tool mechanism and never calls Linq's native
 * contact-card share. Callers own eligibility and thread authority; this owns
 * line resolution, the per-chat throttle reservation, the build and send, and
 * releasing the reservation when a failure provably never reached the chat.
 * Send failures are returned, not thrown.
 */
export async function shareMurphHostedLinqContactCardVcfToChat(input: {
  chatId: string;
  idempotencyKeyPrefix: string;
  memberId: string;
  now?: Date;
  prisma: PrismaClient;
  signal?: AbortSignal;
}): Promise<MurphHostedLinqContactCardVcfShareOutcome> {
  let linePhoneNumber: string | null = null;
  let rosterPresent = false;
  try {
    const handles = await getHostedLinqChatHandles({
      chatId: input.chatId,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    rosterPresent = handles.length > 0;
    linePhoneNumber = normalizePhoneNumber(
      handles.find((handle) => handle.isMe)?.handle ?? null,
    );
  } catch {
    return { status: "skipped", reason: "provider_unavailable" };
  }
  if (!rosterPresent) {
    return { status: "skipped", reason: "provider_unavailable" };
  }
  if (!linePhoneNumber) {
    return { status: "skipped", reason: "line_unresolved" };
  }

  const reservation = await reserveHostedLinqContactCardShareAttempt({
    chatId: input.chatId,
    memberId: input.memberId,
    ...(input.now ? { now: input.now } : {}),
    prisma: input.prisma,
  });
  if (reservation.action !== "share") {
    return reservation.reason === "recent_attempt"
      ? { status: "already_shared" }
      : { status: "skipped", reason: reservation.reason };
  }

  const [photo, backupPhoneNumber] = await Promise.all([
    fetchMurphHostedLinqContactCardVcfPhoto(),
    resolveMurphHostedLinqContactCardBackupPhoneNumber({
      excludePhoneNumber: linePhoneNumber,
      prisma: input.prisma,
    }),
  ]);
  const vcf = buildMurphHostedLinqContactCardVcf({
    backupPhoneNumber,
    phoneNumber: linePhoneNumber,
    photo,
  });
  try {
    await sendHostedLinqAttachmentMessage({
      bytes: new Uint8Array(Buffer.from(vcf, "utf8")),
      chatId: input.chatId,
      contentType: MURPH_CONTACT_CARD_VCF_CONTENT_TYPE,
      fileName: MURPH_CONTACT_CARD_VCF_FILE_NAME,
      // Chat id + reservation instant: retries of this reservation dedupe at
      // the provider while a later requested re-share stays a distinct send.
      // The chat id is Linq's own identifier, so no new exposure.
      idempotencyKey: `${input.idempotencyKeyPrefix}:${input.chatId}:${reservation.attemptedAt.getTime()}`,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    if (isHostedLinqAttachmentSendPrepareFailure(error)) {
      // Nothing reached the chat; free the throttle reservation so a later
      // retry is not locked out. Ambiguous message-send failures keep it.
      try {
        await releaseHostedLinqContactCardShareAttempt({
          attemptedAt: reservation.attemptedAt,
          chatId: input.chatId,
          memberId: input.memberId,
          prisma: input.prisma,
        });
      } catch {
        // Best effort: a stuck reservation only delays the next attempt.
      }
    }
    return { status: "failed", reason: "send_failed", error };
  }

  return { status: "sent" };
}
