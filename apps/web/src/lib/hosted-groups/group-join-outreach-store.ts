import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import { sha256Hex } from "../primitives";
import {
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
} from "../hosted-onboarding/contact-privacy";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import { generateHostedGroupJoinOutreachId } from "../hosted-onboarding/shared";
import {
  decryptHostedGroupJoinOutreachPhoneNumber,
  encryptHostedGroupJoinOutreachPhoneNumber,
} from "./group-join-outreach-phone-codec";

type HostedGroupJoinOutreachMutationClient =
  Pick<PrismaClient, "hostedGroupJoinOutreach">;
type HostedGroupJoinOutreachDrainLockClient =
  Pick<Prisma.TransactionClient, "$executeRaw">;
type HostedGroupJoinOutreachReplyAuthorityClient =
  Pick<
    Prisma.TransactionClient,
    "$executeRaw" | "hostedGroupJoinOffer" | "hostedGroupJoinOutreach"
  >;

const HOSTED_GROUP_JOIN_OUTREACH_REACTION_REMOVED_REASON = "reaction_removed";

export async function acquireHostedGroupJoinOutreachDrainLockTx(
  tx: HostedGroupJoinOutreachDrainLockClient,
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext('hosted_group_join_outreach_drain'))
  `;
}

export type EnqueueHostedGroupJoinOutreachTxResult =
  | { kind: "already_recorded"; outreachId: string }
  | { kind: "enqueued"; outreachId: string };

export async function enqueueHostedGroupJoinOutreachTx(input: {
  groupId: string;
  offerId: string;
  participantPhoneNumber: string;
  requestedAt: Date;
  tx: Prisma.TransactionClient;
}): Promise<EnqueueHostedGroupJoinOutreachTxResult> {
  const participantPhoneNumber = normalizePhoneNumber(input.participantPhoneNumber);
  if (!participantPhoneNumber) {
    throw new TypeError("Hosted group join outreach requires a phone number.");
  }

  const participantPhoneLookupKey = createHostedPhoneLookupKey(
    participantPhoneNumber,
  );
  const participantPhoneLookupKeyReadCandidates =
    createHostedPhoneLookupKeyReadCandidates(participantPhoneNumber);
  if (!participantPhoneLookupKey) {
    throw new TypeError("Hosted group join outreach requires a phone lookup key.");
  }

  // The database sees only a one-way digest, never the participant phone.
  const idempotencyLockKey = sha256Hex(
    `${input.offerId}\0${participantPhoneNumber}`,
  );
  await input.tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext('hosted_group_join_outreach'),
      hashtext(${idempotencyLockKey})
    )
  `;

  const existing = await input.tx.hostedGroupJoinOutreach.findFirst({
    where: {
      offerId: input.offerId,
      participantPhoneLookupKey: {
        in: participantPhoneLookupKeyReadCandidates,
      },
    },
    select: { id: true },
  });
  if (existing) {
    return { kind: "already_recorded", outreachId: existing.id };
  }

  const outreachId = generateHostedGroupJoinOutreachId();
  const created = await input.tx.hostedGroupJoinOutreach.createMany({
    data: [{
      groupId: input.groupId,
      id: outreachId,
      nextAttemptAt: input.requestedAt,
      offerId: input.offerId,
      participantPhoneEncrypted: encryptHostedGroupJoinOutreachPhoneNumber({
        outreachId,
        phoneNumber: participantPhoneNumber,
      }),
      participantPhoneLookupKey,
      requestedAt: input.requestedAt,
    }],
    skipDuplicates: true,
  });
  if (created.count === 1) {
    return { kind: "enqueued", outreachId };
  }

  const concurrent = await input.tx.hostedGroupJoinOutreach.findFirst({
    where: {
      offerId: input.offerId,
      participantPhoneLookupKey: {
        in: participantPhoneLookupKeyReadCandidates,
      },
    },
    select: { id: true },
  });
  if (!concurrent) {
    throw new Error(
      "Hosted group join outreach conflict did not preserve an idempotency row.",
    );
  }
  return { kind: "already_recorded", outreachId: concurrent.id };
}

export type RevokeHostedGroupJoinOutreachTxResult =
  | { kind: "dispatch_started" }
  | { kind: "not_pending" }
  | { kind: "revoked" };

/**
 * Terminalizes a not-yet-dispatched outreach when the participant removes the
 * reaction that created it.
 *
 * Removal is the only obvious undo at this entry point, so a withdrawal that
 * lands before the sweep must prevent the private text. Writing the terminal row
 * even when none exists yet is deliberate: providers can deliver a removal ahead
 * of its own delayed add, and the shared unique offer-participant identity then
 * makes the late add converge on this already-recorded refusal instead of
 * sending. Once dispatch has started there is nothing to revoke, and the same
 * terminal row keeps a later re-like from opening a second thread.
 */
export async function revokeHostedGroupJoinOutreachForRemovedReactionTx(input: {
  allowMissingRowTombstone: boolean;
  groupId: string;
  now: Date;
  offerId: string;
  participantPhoneNumber: string;
  tx: Prisma.TransactionClient;
}): Promise<RevokeHostedGroupJoinOutreachTxResult> {
  const participantPhoneNumber = normalizePhoneNumber(
    input.participantPhoneNumber,
  );
  if (!participantPhoneNumber) {
    return { kind: "not_pending" };
  }

  const participantPhoneLookupKey = createHostedPhoneLookupKey(
    participantPhoneNumber,
  );
  const participantPhoneLookupKeyReadCandidates =
    createHostedPhoneLookupKeyReadCandidates(participantPhoneNumber);
  if (!participantPhoneLookupKey) {
    return { kind: "not_pending" };
  }

  await input.tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext('hosted_group_join_outreach'),
      hashtext(${sha256Hex(`${input.offerId}\0${participantPhoneNumber}`)})
    )
  `;

  const existing = await input.tx.hostedGroupJoinOutreach.findFirst({
    where: {
      offerId: input.offerId,
      participantPhoneLookupKey: {
        in: participantPhoneLookupKeyReadCandidates,
      },
    },
    select: { dispatchStartedAt: true, id: true, sentAt: true, skippedAt: true },
  });

  if (existing) {
    if (existing.dispatchStartedAt || existing.sentAt) {
      return { kind: "dispatch_started" };
    }
    if (existing.skippedAt) {
      return { kind: "not_pending" };
    }
    await input.tx.hostedGroupJoinOutreach.updateMany({
      where: {
        dispatchStartedAt: null,
        id: existing.id,
        sentAt: null,
        skippedAt: null,
      },
      data: {
        skipReason: HOSTED_GROUP_JOIN_OUTREACH_REACTION_REMOVED_REASON,
        skippedAt: input.now,
      },
    });
    return { kind: "revoked" };
  }

  // Only a recipient who could actually have been texted needs the
  // remove-before-add tombstone. Writing one for a refused region would store an
  // encrypted phone for someone this feature declines before accepting any work.
  if (!input.allowMissingRowTombstone) {
    return { kind: "not_pending" };
  }

  const outreachId = generateHostedGroupJoinOutreachId();
  await input.tx.hostedGroupJoinOutreach.createMany({
    data: [{
      groupId: input.groupId,
      id: outreachId,
      nextAttemptAt: input.now,
      offerId: input.offerId,
      participantPhoneEncrypted: encryptHostedGroupJoinOutreachPhoneNumber({
        outreachId,
        phoneNumber: participantPhoneNumber,
      }),
      participantPhoneLookupKey,
      requestedAt: input.now,
      skipReason: HOSTED_GROUP_JOIN_OUTREACH_REACTION_REMOVED_REASON,
      skippedAt: input.now,
    }],
    skipDuplicates: true,
  });
  return { kind: "revoked" };
}

export function readHostedGroupJoinOutreachParticipantPhone(input: {
  encrypted: string;
  outreachId: string;
}): string | null {
  try {
    return normalizePhoneNumber(
      decryptHostedGroupJoinOutreachPhoneNumber({
        encrypted: input.encrypted,
        outreachId: input.outreachId,
      }),
    );
  } catch {
    return null;
  }
}

export async function readHostedGroupJoinOutreachReplyContextTx(input: {
  linqChatId: string;
  participantPhoneNumber: string;
  recipientPhoneNumber: string | null;
  tx: Prisma.TransactionClient;
}): Promise<{ joinCode: string; outreachId: string } | null> {
  const participantPhoneNumber = normalizePhoneNumber(
    input.participantPhoneNumber,
  );
  if (!participantPhoneNumber) {
    return null;
  }

  const participantPhoneLookupKeys = createHostedPhoneLookupKeyReadCandidates(
    participantPhoneNumber,
  );
  const linqChatLookupKeys = createHostedLinqChatLookupKeyReadCandidates(
    input.linqChatId,
  );
  const recipientPhoneLookupKeys = createHostedPhoneLookupKeyReadCandidates(
    input.recipientPhoneNumber,
  );
  if (
    participantPhoneLookupKeys.length === 0
    || linqChatLookupKeys.length === 0
  ) {
    return null;
  }

  const outreaches = await input.tx.hostedGroupJoinOutreach.findMany({
    orderBy: [
      { sentAt: "desc" },
      { requestedAt: "desc" },
      { id: "desc" },
    ],
    where: {
      participantPhoneLookupKey: { in: participantPhoneLookupKeys },
      repliedAt: null,
      sentAt: { not: null },
      skippedAt: null,
      OR: [
        { linqChatLookupKey: { in: linqChatLookupKeys } },
        ...(recipientPhoneLookupKeys.length > 0
          ? [{
              linqChatLookupKey: null,
              phoneNumberLookupKey: { in: recipientPhoneLookupKeys },
            }]
          : []),
      ],
    },
    select: {
      groupId: true,
      id: true,
      linqChatLookupKey: true,
      offerId: true,
    },
  });
  if (outreaches.length === 0) {
    return null;
  }

  const offers = await input.tx.hostedGroupJoinOffer.findMany({
    where: {
      id: { in: outreaches.map((outreach) => outreach.offerId) },
      revokedAt: null,
    },
    select: {
      groupId: true,
      id: true,
      group: {
        select: {
          joinCode: true,
          runtimeMemberId: true,
        },
      },
    },
  });
  const validOfferByOutreachKey = new Map(
    offers.flatMap((offer) => {
      const joinCode = offer.group.runtimeMemberId
        ? offer.group.joinCode?.trim() ?? null
        : null;
      return joinCode
        ? [[`${offer.id}\0${offer.groupId}`, joinCode] as const]
        : [];
    }),
  );
  const isValid = (candidate: (typeof outreaches)[number]) =>
    validOfferByOutreachKey.has(`${candidate.offerId}\0${candidate.groupId}`);
  const outreach =
    outreaches.find((candidate) =>
      candidate.linqChatLookupKey !== null
      && linqChatLookupKeys.includes(candidate.linqChatLookupKey)
      && isValid(candidate)
    )
    ?? outreaches.find((candidate) =>
      candidate.linqChatLookupKey === null && isValid(candidate)
    );
  if (!outreach) {
    return null;
  }

  const joinCode = validOfferByOutreachKey.get(
    `${outreach.offerId}\0${outreach.groupId}`,
  );
  return joinCode
    ? { joinCode, outreachId: outreach.id }
    : null;
}

export async function isHostedGroupJoinOutreachReplyDeliveryAuthorizedTx(input: {
  groupJoinCode: string;
  outreachId: string;
  tx: HostedGroupJoinOutreachReplyAuthorityClient;
}): Promise<boolean> {
  await acquireHostedGroupJoinOutreachDrainLockTx(input.tx);

  const outreach = await input.tx.hostedGroupJoinOutreach.findUnique({
    where: { id: input.outreachId },
    select: {
      groupId: true,
      offerId: true,
      repliedAt: true,
      sentAt: true,
      skippedAt: true,
    },
  });
  if (
    !outreach
    || !outreach.sentAt
    || outreach.repliedAt
    || outreach.skippedAt
  ) {
    return false;
  }

  const offer = await input.tx.hostedGroupJoinOffer.findUnique({
    where: { id: outreach.offerId },
    select: {
      groupId: true,
      revokedAt: true,
      group: {
        select: {
          joinCode: true,
          runtimeMemberId: true,
        },
      },
    },
  });
  return Boolean(
    offer
    && offer.groupId === outreach.groupId
    && !offer.revokedAt
    && offer.group.runtimeMemberId
    && offer.group.joinCode?.trim() === input.groupJoinCode.trim(),
  );
}

export async function consumeHostedGroupJoinOutreachReplyContextTx(input: {
  outreachId: string;
  repliedAt: Date;
  tx: HostedGroupJoinOutreachMutationClient;
}): Promise<boolean> {
  const consumed = await input.tx.hostedGroupJoinOutreach.updateMany({
    where: {
      id: input.outreachId,
      repliedAt: null,
      sentAt: { not: null },
      skippedAt: null,
    },
    data: {
      repliedAt: input.repliedAt,
    },
  });
  return consumed.count === 1;
}

export async function reopenHostedGroupJoinOutreachReplyContextTx(input: {
  outreachId: string;
  repliedAt: Date;
  tx: HostedGroupJoinOutreachMutationClient;
}): Promise<boolean> {
  const reopened = await input.tx.hostedGroupJoinOutreach.updateMany({
    where: {
      id: input.outreachId,
      repliedAt: input.repliedAt,
      sentAt: { not: null },
      skippedAt: null,
    },
    data: {
      repliedAt: null,
    },
  });
  return reopened.count === 1;
}
