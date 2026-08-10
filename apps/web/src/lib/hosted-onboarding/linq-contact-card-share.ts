import { Prisma, type PrismaClient } from "@prisma/client";

import { createHostedLinqChatLookupKey, createHostedLinqChatLookupKeyReadCandidates } from "./contact-privacy";
import {
  getHostedLinqChatHandles,
  HOSTED_LINQ_ATTACHMENT_SEND_ATTEMPT_TIMEOUT_MS,
  isHostedLinqAttachmentSendPrepareFailure,
  isHostedLinqIdempotencyKeyReuseFailure,
  isHostedLinqUnconfirmedAcknowledgementFailure,
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

// A personalized send must reach a terminal result inside the runner's
// 30-second web-control hop, or the turn reports something the send owner never
// decided. That hop starts before Web is entered, so callback verification,
// nonce consumption, transit, and the response return all spend it too. This
// budget is the handler's share of it and deliberately leaves the rest.
export const HOSTED_LINQ_PERSONALIZED_CONTACT_CARD_OPERATION_BUDGET_MS = 20 * 1000;

/**
 * The two deadlines a personalized send runs against, derived from one budget
 * so they cannot drift apart. Reaching the pre-send deadline *is* the admission
 * check for the irreversible POST: it is placed so that whatever remains is
 * enough for the send and its one permitted reconciliation. Everything the
 * pre-send deadline bounds provably precedes the POST, so expiring under it
 * always means nothing was sent.
 */
export function resolveHostedLinqPersonalizedContactCardDeadlines(
  startedAtMs: number,
): { operationDeadlineAt: number; preSendDeadlineAt: number } {
  const operationDeadlineAt = startedAtMs
    + HOSTED_LINQ_PERSONALIZED_CONTACT_CARD_OPERATION_BUDGET_MS;
  return {
    operationDeadlineAt,
    preSendDeadlineAt: operationDeadlineAt
      - 2 * HOSTED_LINQ_ATTACHMENT_SEND_ATTEMPT_TIMEOUT_MS,
  };
}

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
 * checks; this dedupes duplicate attempts within one turn/wake per chat. A
 * requested re-share outside the window must go through.
 *
 * This is a wall-clock window, so it can only own dedupe for sends whose
 * whole attempt fits inside it. A caller whose attempt can outlive the window
 * must carry its own stable send identity instead.
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
      reason:
        | "line_unresolved"
        | "missing_chat_id"
        | "photo_unavailable"
        | "provider_unavailable";
    }
  // The provider may have accepted this card and the send owner could not
  // establish which. Only a per-request send can report it, because only that
  // key identifies the one request the member is waiting on.
  | { status: "unconfirmed" }
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
 * eligibility and thread authority; this preflight binds the chat to exactly
 * one active self handle, requires an active provider card whose normalized
 * phone number matches that line, and requires `image_url` to be explicitly
 * present and parse to null. It then owns the shared per-chat reservation and
 * the single native provider POST. Unverifiable cards skip fail-soft. Any
 * native provider failure is ambiguous, so the reservation stays in place to
 * avoid a blind duplicate.
 *
 * Native `share_contact_card` is a bodyless POST, so Linq selects the card at
 * send time and the preflight GET cannot be atomically bound to that effect.
 * This hardened preflight is therefore a strong best-effort check, not a
 * mathematical guarantee.
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
    const activeSelfHandles = handles.filter((handle) =>
      handle.isMe && handle.status?.trim().toLowerCase() === "active",
    );
    if (activeSelfHandles.length !== 1) {
      return { status: "skipped", reason: "line_card_unverified" };
    }
    const linePhoneNumber = normalizePhoneNumber(activeSelfHandles[0]?.handle);
    if (!linePhoneNumber) {
      return { status: "skipped", reason: "line_card_unverified" };
    }

    const lineCard = await getHostedLinqContactCard({
      phoneNumber: linePhoneNumber,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (
      !lineCard
      || lineCard.isActive !== true
      || normalizePhoneNumber(lineCard.phoneNumber) !== linePhoneNumber
      || lineCard.imageUrlPresent !== true
    ) {
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

type MurphHostedLinqContactCardVcfShareInput = {
  chatId: string;
  idempotencyKeyPrefix: string;
  memberId: string;
  now?: Date;
  /**
   * Absolute deadline owned by the caller, so it also covers the work that
   * happens before this function is entered. A personalized send that is not
   * given one starts its own budget here.
   */
  operationDeadlineAt?: number;
  prisma: PrismaClient;
  signal?: AbortSignal;
} & (
  | { imageUrl: string; shareKey: string }
  | { imageUrl?: never; shareKey?: never }
);

/**
 * Share Murph's first-party vCard into a Linq chat as an attachment. This is
 * the discretionary group-tool mechanism and never calls Linq's native
 * contact-card share. Callers own eligibility and thread authority. Canonical
 * sends retain the shared reservation; personalized sends carry one stable
 * accepted-request provider identity instead. Send failures are returned, not
 * thrown.
 */
export async function shareMurphHostedLinqContactCardVcfToChat(
  input: MurphHostedLinqContactCardVcfShareInput,
): Promise<MurphHostedLinqContactCardVcfShareOutcome> {
  let personalized: { imageUrl: string; shareKey: string } | null = null;
  if (input.imageUrl !== undefined || input.shareKey !== undefined) {
    if (input.imageUrl === undefined || input.shareKey === undefined) {
      throw new TypeError(
        "Personalized contact-card imageUrl and shareKey must be provided together.",
      );
    }
    personalized = {
      imageUrl: input.imageUrl,
      shareKey: input.shareKey,
    };
  }
  const deadlines = personalized
    ? resolveHostedLinqPersonalizedContactCardDeadlines(
      input.operationDeadlineAt
        === undefined
        ? Date.now()
        : input.operationDeadlineAt
          - HOSTED_LINQ_PERSONALIZED_CONTACT_CARD_OPERATION_BUDGET_MS,
    )
    : null;
  const preSendDeadline = deadlines
    ? AbortSignal.timeout(Math.max(0, deadlines.preSendDeadlineAt - Date.now()))
    : null;
  const preSendSignal = preSendDeadline
    ? (input.signal ? AbortSignal.any([input.signal, preSendDeadline]) : preSendDeadline)
    : input.signal;
  const preSendSignalOption = preSendSignal ? { signal: preSendSignal } : {};

  // A personalized card is saved over the member's working Murph contact, so
  // an obsolete or ambiguous line is worse than no card. Require exactly one
  // active self handle, matching the native line-card path.
  let linePhoneNumber: string | null = null;
  let rosterPresent = false;
  try {
    const handles = await getHostedLinqChatHandles({
      chatId: input.chatId,
      ...preSendSignalOption,
    });
    rosterPresent = handles.length > 0;
    if (personalized) {
      const activeSelfHandles = handles.filter((handle) =>
        handle.isMe && handle.status?.trim().toLowerCase() === "active",
      );
      linePhoneNumber = activeSelfHandles.length === 1
        ? normalizePhoneNumber(activeSelfHandles[0]?.handle ?? null)
        : null;
    } else {
      linePhoneNumber = normalizePhoneNumber(
        handles.find((handle) => handle.isMe)?.handle ?? null,
      );
    }
  } catch {
    return { status: "skipped", reason: "provider_unavailable" };
  }
  if (!rosterPresent) {
    return { status: "skipped", reason: "provider_unavailable" };
  }
  if (!linePhoneNumber) {
    return { status: "skipped", reason: "line_unresolved" };
  }

  let reservation: Extract<
    HostedLinqContactCardShareReserveDecision,
    { action: "share" }
  > | null = null;
  if (!personalized) {
    const decision = await reserveHostedLinqContactCardShareAttempt({
      chatId: input.chatId,
      memberId: input.memberId,
      ...(input.now ? { now: input.now } : {}),
      prisma: input.prisma,
    });
    if (decision.action !== "share") {
      return decision.reason === "recent_attempt"
        ? { status: "already_shared" }
        : { status: "skipped", reason: decision.reason };
    }
    reservation = decision;
  }

  const [photo, backupPhoneNumber] = await Promise.all([
    personalized
      ? fetchMurphHostedLinqContactCardVcfPhoto({
          imageUrl: personalized.imageUrl,
          ...preSendSignalOption,
        })
      : fetchMurphHostedLinqContactCardVcfPhoto(
          input.signal ? { signal: input.signal } : {},
        ),
    resolveMurphHostedLinqContactCardBackupPhoneNumber({
      excludePhoneNumber: linePhoneNumber,
      prisma: input.prisma,
    }),
  ]);
  // The backup-number read consumes no signal, so the deadline is checked here
  // rather than assumed. Nothing has reached the chat yet.
  if (personalized && preSendDeadline?.aborted) {
    return { status: "skipped", reason: "provider_unavailable" };
  }
  if (personalized && !photo) {
    return { status: "skipped", reason: "photo_unavailable" };
  }

  const idempotencyKey = personalized
    ? `${input.idempotencyKeyPrefix}:${input.chatId}:${personalized.shareKey}`
    : reservation
      ? `${input.idempotencyKeyPrefix}:${input.chatId}:${reservation.attemptedAt.getTime()}`
      : null;
  if (!idempotencyKey) {
    throw new Error("Contact-card send identity is unavailable.");
  }

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
      idempotencyKey,
      // The attachment create and upload are still before the message POST, so
      // they carry the tighter deadline, including their response bodies. The
      // POST and its reconciliation keep the caller signal: the whole point is
      // to let an irreversible send finish and be reported honestly.
      ...(deadlines
        ? {
          prepareDeadlineAt: deadlines.preSendDeadlineAt,
          sendDeadlineAt: deadlines.operationDeadlineAt,
        }
        : {}),
      ...(preSendSignal ? { prepareSignal: preSendSignal } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    // A replay re-creates the attachment, so Linq may prove the stable key was
    // already accepted by rejecting the changed body under that key.
    if (personalized && isHostedLinqIdempotencyKeyReuseFailure(error)) {
      return { status: "already_shared" };
    }
    if (personalized && isHostedLinqUnconfirmedAcknowledgementFailure(error)) {
      return { status: "unconfirmed" };
    }
    if (reservation && isHostedLinqAttachmentSendPrepareFailure(error)) {
      // Nothing reached the chat; free the canonical throttle reservation so a
      // later retry is not locked out. Ambiguous message-send failures keep it.
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
