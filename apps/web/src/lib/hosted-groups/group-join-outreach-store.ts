import "server-only";

import type { Prisma } from "@prisma/client";

import { sha256Hex } from "../primitives";
import {
  createHostedLinqChatLookupKey,
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

export async function claimHostedGroupJoinOutreachReplyContextTx(input: {
  linqChatId: string;
  now: Date;
  participantPhoneNumber: string;
  tx: Prisma.TransactionClient;
}): Promise<{ joinCode: string } | null> {
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
  if (
    participantPhoneLookupKeys.length === 0
    || linqChatLookupKeys.length === 0
  ) {
    return null;
  }

  const outreach = await input.tx.hostedGroupJoinOutreach.findFirst({
    orderBy: [
      { requestedAt: "asc" },
      { id: "asc" },
    ],
    where: {
      participantPhoneLookupKey: { in: participantPhoneLookupKeys },
      sentAt: { not: null },
      skippedAt: null,
      OR: [
        { linqChatLookupKey: { in: linqChatLookupKeys } },
        { linqChatLookupKey: null },
      ],
    },
    select: {
      groupId: true,
      id: true,
      linqChatLookupKey: true,
      offerId: true,
    },
  });
  if (!outreach) {
    return null;
  }

  await input.tx.hostedGroupJoinOutreach.updateMany({
    where: {
      id: outreach.id,
      skippedAt: null,
    },
    data: {
      ...(outreach.linqChatLookupKey
        ? {}
        : { linqChatLookupKey: createHostedLinqChatLookupKey(input.linqChatId) }),
      repliedAt: input.now,
    },
  });

  const offer = await input.tx.hostedGroupJoinOffer.findFirst({
    where: {
      groupId: outreach.groupId,
      id: outreach.offerId,
      revokedAt: null,
    },
    select: {
      group: {
        select: {
          joinCode: true,
          runtimeMemberId: true,
        },
      },
    },
  });
  const joinCode = offer?.group?.runtimeMemberId
    ? offer.group.joinCode?.trim() ?? null
    : null;
  return joinCode ? { joinCode } : null;
}
