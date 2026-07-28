import "server-only";

import type { Prisma } from "@prisma/client";

import { sha256Hex } from "../primitives";
import {
  createHostedLinqChatLookupKeyReadCandidates,
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
} from "../hosted-onboarding/contact-privacy";
import {
  markHostedLinqDeliverySkippedTx,
} from "../hosted-onboarding/linq-delivery-store";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import { generateHostedGroupJoinOutreachId } from "../hosted-onboarding/shared";
import {
  decryptHostedGroupJoinOutreachPhoneNumber,
  encryptHostedGroupJoinOutreachPhoneNumber,
} from "./group-join-outreach-phone-codec";

type HostedGroupJoinOutreachDrainLockClient =
  Pick<Prisma.TransactionClient, "$executeRaw">;
type HostedGroupJoinOutreachReplyAuthorityClient =
  Pick<
    Prisma.TransactionClient,
    | "$executeRaw"
    | "hostedGroupJoinOutreach"
    | "hostedGroupMember"
    | "hostedLinqDelivery"
  >;

const HOSTED_GROUP_JOIN_OUTREACH_REACTION_REMOVED_REASON = "reaction_removed";
export const HOSTED_GROUP_JOIN_OUTREACH_DELIVERY_SOURCE =
  "hosted_group_join_outreach";
export const HOSTED_GROUP_JOIN_OUTREACH_TEMPLATE = "group_join_outreach";
const HOSTED_GROUP_JOIN_OUTREACH_IDEMPOTENCY_PREFIX = "group-join-outreach:";
const HOSTED_GROUP_JOIN_SIGNUP_DELIVERY_LIVE_STATUSES = [
  "attempted",
  "provider_dispatch_started",
  "accepted",
  "delivered",
] as const;

export function buildHostedGroupJoinOutreachIdempotencyKey(
  outreachId: string,
): string {
  return `${HOSTED_GROUP_JOIN_OUTREACH_IDEMPOTENCY_PREFIX}${outreachId}`;
}

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

  await acquireHostedGroupJoinOutreachDrainLockTx(input.tx);
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
    select: {
      deliveries: {
        orderBy: { attemptedAt: "desc" },
        select: {
          acceptedAt: true,
          deliveredAt: true,
          failedAt: true,
          skippedAt: true,
          status: true,
        },
        where: {
          source: HOSTED_GROUP_JOIN_OUTREACH_DELIVERY_SOURCE,
          template: HOSTED_GROUP_JOIN_OUTREACH_TEMPLATE,
        },
      },
      id: true,
    },
  });

  if (existing) {
    if (existing.deliveries.some((delivery) => delivery.skippedAt === null)) {
      return { kind: "dispatch_started" };
    }
    if (existing.deliveries.length > 0) {
      return { kind: "not_pending" };
    }
    await markHostedGroupJoinOutreachSkippedDeliveryTx({
      now: input.now,
      outreachId: existing.id,
      reason: HOSTED_GROUP_JOIN_OUTREACH_REACTION_REMOVED_REASON,
      tx: input.tx,
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
      id: outreachId,
      nextAttemptAt: input.now,
      offerId: input.offerId,
      participantPhoneEncrypted: encryptHostedGroupJoinOutreachPhoneNumber({
        outreachId,
        phoneNumber: participantPhoneNumber,
      }),
      participantPhoneLookupKey,
      requestedAt: input.now,
    }],
    skipDuplicates: true,
  });
  await markHostedGroupJoinOutreachSkippedDeliveryTx({
    now: input.now,
    outreachId,
    reason: HOSTED_GROUP_JOIN_OUTREACH_REACTION_REMOVED_REASON,
    tx: input.tx,
  });
  return { kind: "revoked" };
}

export async function markHostedGroupJoinOutreachSkippedDeliveryTx(input: {
  now: Date;
  outreachId: string;
  reason: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await markHostedLinqDeliverySkippedTx({
    groupJoinOutreachId: input.outreachId,
    idempotencyKey: buildHostedGroupJoinOutreachIdempotencyKey(input.outreachId),
    prisma: input.tx,
    reason: input.reason,
    skippedAt: input.now,
    source: HOSTED_GROUP_JOIN_OUTREACH_DELIVERY_SOURCE,
    sourceRef: input.outreachId,
    targetKind: "participant",
    template: HOSTED_GROUP_JOIN_OUTREACH_TEMPLATE,
  });
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
  participantMemberId?: string | null;
  participantPhoneNumber: string;
  recipientPhoneNumber: string | null;
  sourceEventId?: string | null;
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

  const deliveries = await input.tx.hostedLinqDelivery.findMany({
    orderBy: [
      { attemptedAt: "desc" },
      { id: "desc" },
    ],
    where: {
      groupJoinOutreach: {
        is: {
          participantPhoneLookupKey: { in: participantPhoneLookupKeys },
        },
      },
      groupJoinOutreachId: { not: null },
      source: HOSTED_GROUP_JOIN_OUTREACH_DELIVERY_SOURCE,
      template: HOSTED_GROUP_JOIN_OUTREACH_TEMPLATE,
      OR: [
        { acceptedAt: { not: null } },
        { deliveredAt: { not: null } },
        { status: { in: ["accepted", "delivered"] } },
      ],
      AND: [{
        OR: [
          { linqChatLookupKey: { in: linqChatLookupKeys } },
          ...(recipientPhoneLookupKeys.length > 0
            ? [{
                linqChatLookupKey: null,
                phoneNumberLookupKey: { in: recipientPhoneLookupKeys },
              }]
            : []),
        ],
      }],
    },
    select: {
      groupJoinOutreachId: true,
      id: true,
      linqChatLookupKey: true,
      phoneNumberLookupKey: true,
      groupJoinOutreach: {
        select: {
          id: true,
          offer: {
            select: {
              revokedAt: true,
              group: {
                select: {
                  id: true,
                  joinCode: true,
                  runtimeMember: {
                    select: {
                      suspendedAt: true,
                    },
                  },
                  runtimeMemberId: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (deliveries.length === 0) {
    return null;
  }

  for (const preferExactChat of [true, false]) {
    for (const delivery of deliveries) {
      const exactChat = delivery.linqChatLookupKey !== null
        && linqChatLookupKeys.includes(delivery.linqChatLookupKey);
      if (preferExactChat !== exactChat) {
        continue;
      }
      const context = await readAvailableHostedGroupJoinOutreachDeliveryContextTx({
        delivery,
        participantMemberId: input.participantMemberId,
        sourceEventId: input.sourceEventId,
        tx: input.tx,
      });
      if (context) {
        return context;
      }
    }
  }

  return null;
}

export async function readHostedGroupJoinOutreachReplyDeliveryContextTx(input: {
  excludeSignupDeliveryId?: string | null;
  memberId?: string | null;
  outreachId: string;
  tx: HostedGroupJoinOutreachReplyAuthorityClient;
}): Promise<
  | { joinCode: string; kind: "already_member" }
  | { joinCode: string; kind: "available" }
  | null
> {
  await acquireHostedGroupJoinOutreachDrainLockTx(input.tx);

  const outreach = await input.tx.hostedGroupJoinOutreach.findFirst({
    where: {
      deliveries: {
        some: {
          source: HOSTED_GROUP_JOIN_OUTREACH_DELIVERY_SOURCE,
          template: HOSTED_GROUP_JOIN_OUTREACH_TEMPLATE,
          OR: [
            { acceptedAt: { not: null } },
            { deliveredAt: { not: null } },
            { status: { in: ["accepted", "delivered"] } },
          ],
        },
      },
      id: input.outreachId,
    },
    select: {
      offer: {
        select: {
          revokedAt: true,
          group: {
            select: {
              id: true,
              joinCode: true,
              runtimeMember: {
                select: {
                  suspendedAt: true,
                },
              },
              runtimeMemberId: true,
            },
          },
        },
      },
    },
  });
  if (!outreach) {
    return null;
  }
  const joinCode = readHostedGroupJoinOutreachOfferJoinCode(outreach.offer);
  if (!joinCode) {
    return null;
  }
  if (await hasHostedGroupMembershipTx({
    groupId: outreach.offer.group.id,
    memberId: input.memberId,
    tx: input.tx,
  })) {
    return { joinCode, kind: "already_member" };
  }
  if (await hasHostedGroupJoinOutreachLiveSignupDeliveryTx({
    excludeDeliveryId: input.excludeSignupDeliveryId,
    outreachId: input.outreachId,
    tx: input.tx,
  })) {
    return null;
  }
  return { joinCode, kind: "available" };
}

async function readAvailableHostedGroupJoinOutreachDeliveryContextTx(input: {
  delivery: {
    groupJoinOutreach: {
      id: string;
      offer: {
        group: {
          id: string;
          joinCode: string | null;
          runtimeMember: {
            suspendedAt: Date | null;
          } | null;
          runtimeMemberId: string | null;
        };
        revokedAt: Date | null;
      };
    } | null;
    groupJoinOutreachId: string | null;
  };
  participantMemberId?: string | null;
  sourceEventId?: string | null;
  tx: HostedGroupJoinOutreachReplyAuthorityClient;
}): Promise<{ joinCode: string; outreachId: string } | null> {
  const outreach = input.delivery.groupJoinOutreach;
  if (!outreach || !input.delivery.groupJoinOutreachId) {
    return null;
  }
  if (await hasHostedGroupMembershipTx({
    groupId: outreach.offer.group.id,
    memberId: input.participantMemberId,
    tx: input.tx,
  })) {
    return null;
  }
  if (await hasHostedGroupJoinOutreachLiveSignupDeliveryTx({
    excludeSourceEventId: input.sourceEventId,
    outreachId: input.delivery.groupJoinOutreachId,
    tx: input.tx,
  })) {
    return null;
  }
  const joinCode = readHostedGroupJoinOutreachOfferJoinCode(outreach.offer);
  return joinCode
    ? { joinCode, outreachId: outreach.id }
    : null;
}

async function hasHostedGroupJoinOutreachLiveSignupDeliveryTx(input: {
  excludeDeliveryId?: string | null;
  excludeSourceEventId?: string | null;
  outreachId: string;
  tx: Pick<Prisma.TransactionClient, "hostedLinqDelivery">;
}): Promise<boolean> {
  const excludeSourceEventId = input.excludeSourceEventId?.trim() ?? "";
  const excludedSourceEventFragment = excludeSourceEventId
    ? `:e${sha256Hex(excludeSourceEventId).slice(0, 32)}`
    : null;
  const delivery = await input.tx.hostedLinqDelivery.findFirst({
    where: {
      ...(input.excludeDeliveryId
        ? { id: { not: input.excludeDeliveryId } }
        : {}),
      groupJoinOutreachId: input.outreachId,
      ...(excludedSourceEventFragment
        ? {
            NOT: {
              sourceRef: { contains: excludedSourceEventFragment },
            },
          }
        : {}),
      template: {
        in: ["invite_signup", "invite_signup_fallback"],
      },
      status: { in: [...HOSTED_GROUP_JOIN_SIGNUP_DELIVERY_LIVE_STATUSES] },
    },
    select: { id: true },
  });
  return Boolean(delivery);
}

async function hasHostedGroupMembershipTx(input: {
  groupId: string;
  memberId?: string | null;
  tx: Pick<Prisma.TransactionClient, "hostedGroupMember">;
}): Promise<boolean> {
  const memberId = input.memberId?.trim() ?? "";
  if (!memberId) {
    return false;
  }
  const membership = await input.tx.hostedGroupMember.findUnique({
    where: {
      groupId_memberId: {
        groupId: input.groupId,
        memberId,
      },
    },
    select: { id: true },
  });
  return Boolean(membership);
}

function readHostedGroupJoinOutreachOfferJoinCode(input: {
  group: {
    joinCode: string | null;
    runtimeMember: {
      suspendedAt: Date | null;
    } | null;
    runtimeMemberId: string | null;
  };
  revokedAt: Date | null;
}): string | null {
  return !input.revokedAt
    && input.group.runtimeMemberId
    && input.group.runtimeMember?.suspendedAt === null
    ? input.group.joinCode?.trim() ?? null
    : null;
}
