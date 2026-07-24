import { Prisma, type PrismaClient } from "@prisma/client";

import { createHostedLinqChatLookupKey, createHostedLinqChatLookupKeyReadCandidates } from "./contact-privacy";
import {
  getHostedLinqChatHandles,
  isHostedLinqAttachmentSendPrepareFailure,
  sendHostedLinqAttachmentMessage,
} from "./linq-client";
import {
  buildMurphHostedLinqContactCardVcf,
  fetchMurphHostedLinqContactCardVcfPhoto,
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
// duplicate `share_contact_card` firing (a retried/replayed turn, or a
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
 * chat per 90 seconds). Every share is an intentional assistant decision, so
 * a requested re-share outside that window must go through.
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
 * Automatic shares stay iMessage-only: the `.vcf` renders there as a native
 * tappable contact bubble, while SMS/MMS delivery of a vCard attachment is
 * unproven for pooled lines. Group and direct threads are both eligible; the
 * per-chat reservation in this module is the volume guard.
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

/**
 * Share Murph's first-party vCard into a Linq chat as an attachment. This is
 * the only provider-side contact-card share mechanism: it never calls Linq's
 * native contact-card share, so a member-chosen avatar photo can not be
 * overwritten. Callers own eligibility and thread authority; this owns line
 * resolution, the per-chat throttle reservation, the build and send, and
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
