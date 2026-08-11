import "server-only";

import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  HOSTED_RUNTIME_GROUP_EMAIL_AUTHORIZED_SHARES_PER_PARTICIPANT_MAX,
  HOSTED_RUNTIME_GROUP_EMAIL_PARTICIPANTS_MAX,
} from "@murphai/hosted-execution/runtime-control";
import { normalizeHostedEmailAddress } from "@murphai/runtime-state";

import { hasHostedRuntimeActiveAccess } from "../hosted-mailbox/runtime-access";
import {
  readHostedMemberVerifiedEmailSnapshots,
} from "../hosted-onboarding/hosted-member-store";
import {
  activeHostedMemberAccessWhere,
  hasActiveHostedMemberAccess,
  hostedMemberAccessSelect,
  hostedMemberPersonAccessSelect,
} from "../hosted-onboarding/member-access";
import { isHostedMemberSuspended } from "../hosted-onboarding/entitlement";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../hosted-onboarding/shared";
import {
  hostedHealthDataConsentNotRevokedWhere,
  HOSTED_HEALTH_DATA_CONSENT_SCOPE,
  resolveHostedHealthDataConsentState,
} from "../legal/consent";
import { getPrisma } from "../prisma";
import {
  activeHostedThreadContainerParticipantWhere,
} from "./thread-container-participant-access";

export interface HostedGroupEmailParticipant {
  authorizedShares: HostedGroupEmailAuthorizedShare[];
  hasEmail: boolean;
  memberId: string;
}

interface HostedGroupEmailAuthorizationParticipant
  extends HostedGroupEmailParticipant {
  emailIdentity: string | null;
}

export interface HostedGroupEmailAuthorizedShare {
  projectionScopeKey: string;
  shareId: string;
}

export interface HostedGroupEmailRecipient {
  address: string;
  memberId: string;
}

export type HostedGroupEmailPreparationResult =
  | {
      authorizationProof: string;
      groupId: string;
      missingEmailParticipants: HostedGroupEmailParticipant[];
      participants: HostedGroupEmailParticipant[];
      status: "ok";
    }
  | {
      status: "unavailable";
      unavailableReason: string;
    };

type ReadClient = PrismaClient;

const HOSTED_GROUP_EMAIL_MEMBER_QUERY_TAKE =
  HOSTED_RUNTIME_GROUP_EMAIL_PARTICIPANTS_MAX + 1;
// The selected relation also carries the exact group-email.v0 authorization
// grant, so retain that row plus the first over-limit authorized-share row.
const HOSTED_GROUP_EMAIL_SHARE_QUERY_TAKE =
  HOSTED_RUNTIME_GROUP_EMAIL_AUTHORIZED_SHARES_PER_PARTICIPANT_MAX + 2;

function buildHostedGroupEmailMemberAccessSelect(now: Date) {
  return Prisma.validator<Prisma.HostedMemberSelect>()({
    ...hostedMemberAccessSelect,
    consentGrants: {
      select: {
        scope: true,
        status: true,
      },
      where: {
        scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE,
      },
    },
    id: true,
    threadContainer: {
      select: {
        owner: {
          select: {
            ...hostedMemberPersonAccessSelect,
            consentGrants: {
              select: {
                scope: true,
                status: true,
              },
              where: {
                scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE,
              },
            },
          },
        },
        participants: {
          select: { participantMemberId: true },
          take: 1,
          where: {
            ...activeHostedThreadContainerParticipantWhere({ now }),
            participant: {
              AND: [
                activeHostedMemberAccessWhere(),
                hostedHealthDataConsentNotRevokedWhere(),
              ],
            },
          },
        },
      },
    },
  });
}

type HostedGroupEmailMemberAccess = Prisma.HostedMemberGetPayload<{
  select: ReturnType<typeof buildHostedGroupEmailMemberAccessSelect>;
}>;

export async function prepareHostedGroupEmail(input: {
  prisma?: ReadClient;
  runtimeMemberId: string;
}): Promise<HostedGroupEmailPreparationResult> {
  const resolved = await readHostedGroupEmailParticipantEmailFacts(input);
  if (resolved.status !== "ok") {
    return resolved;
  }
  const authorizationParticipants = resolved.participants.map((participant) => ({
    authorizedShares: participant.authorizedShares,
    emailIdentity: participant.emailIdentity,
    hasEmail: participant.address !== null,
    memberId: participant.memberId,
  }));
  const participants = authorizationParticipants.map(
    toHostedGroupEmailParticipant,
  );

  return {
    authorizationProof: buildHostedGroupEmailAuthorizationProof({
      groupId: resolved.groupId,
      participants: authorizationParticipants,
    }),
    groupId: resolved.groupId,
    missingEmailParticipants: participants.filter((participant) => !participant.hasEmail),
    participants,
    status: "ok",
  };
}

export async function readHostedGroupEmailRecipients(input: {
  expectedGroupEmailAuthorizationProof?: string | null;
  groupId: string;
  prisma?: ReadClient;
  runtimeMemberId: string;
}): Promise<
  | {
      recipients: HostedGroupEmailRecipient[];
      status: "ok";
    }
  | {
      status: "unavailable";
      unavailableReason: string;
    }
> {
  const resolved = await readHostedGroupEmailParticipantEmailFacts(input);
  if (resolved.status !== "ok") {
    return resolved;
  }

  if (
    input.expectedGroupEmailAuthorizationProof
    && input.expectedGroupEmailAuthorizationProof
      !== buildHostedGroupEmailAuthorizationProof({
        groupId: resolved.groupId,
        participants: resolved.participants.map((participant) => ({
          authorizedShares: participant.authorizedShares,
          emailIdentity: participant.emailIdentity,
          hasEmail: participant.address !== null,
          memberId: participant.memberId,
        })),
      })
  ) {
    return {
      status: "unavailable",
      unavailableReason: "group_email_authorization_changed",
    };
  }

  const recipients: HostedGroupEmailRecipient[] = [];
  const seenAddresses = new Set<string>();
  for (const participant of resolved.participants) {
    if (!participant.address || seenAddresses.has(participant.address)) {
      continue;
    }
    seenAddresses.add(participant.address);
    recipients.push({
      address: participant.address,
      memberId: participant.memberId,
    });
  }

  return { recipients, status: "ok" };
}

async function readHostedGroupEmailParticipantEmailFacts(input: {
  groupId?: string;
  prisma?: ReadClient;
  runtimeMemberId: string;
}): Promise<
  | {
      groupId: string;
      participants: Array<{
        address: string | null;
        authorizedShares: HostedGroupEmailAuthorizedShare[];
        emailIdentity: string | null;
        memberId: string;
      }>;
      status: "ok";
    }
  | {
      status: "unavailable";
      unavailableReason: string;
    }
> {
  const prisma = input.prisma ?? getPrisma();
  const now = new Date();
  const memberAccessSelect = buildHostedGroupEmailMemberAccessSelect(now);
  if (!await hasHostedRuntimeActiveAccess(input.runtimeMemberId, { prisma })) {
    return { status: "unavailable", unavailableReason: "runtime_inactive" };
  }

  const group = await prisma.hostedGroup.findFirst({
    where: {
      ...(input.groupId ? { id: input.groupId } : {}),
      runtimeMemberId: input.runtimeMemberId,
    },
    select: {
      id: true,
      members: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { memberId: true },
        take: HOSTED_GROUP_EMAIL_MEMBER_QUERY_TAKE,
      },
    },
  });
  if (!group) {
    return { status: "unavailable", unavailableReason: "group_not_found" };
  }
  if (group.members.length > HOSTED_RUNTIME_GROUP_EMAIL_PARTICIPANTS_MAX) {
    return {
      status: "unavailable",
      unavailableReason: "authorization_snapshot_too_large",
    };
  }

  const memberIds = group.members.map((member) => member.memberId);
  const accessRecords = await prisma.hostedMember.findMany({
    where: {
      id: {
        in: memberIds,
      },
    },
    select: memberAccessSelect,
  });
  const activeMemberIdSet = new Set(
    accessRecords
      .filter(hasHostedGroupEmailMemberActiveAccess)
      .map((member) => member.id),
  );
  const activeMemberIds = memberIds.filter((memberId) =>
    activeMemberIdSet.has(memberId)
  );
  const emailSnapshots = await readHostedMemberVerifiedEmailSnapshots({
    memberIds: activeMemberIds,
    prisma,
  });
  const verifiedEmailByMemberId = new Map(
    emailSnapshots.map((snapshot) =>
      [snapshot.memberId, snapshot.verifiedEmail] as const
    ),
  );
  const candidates = new Map<string, {
    address: string | null;
    verifiedEmailLookupKey: string | null;
    verifiedEmailVerifiedAt: Date | null;
  }>();
  for (const memberId of activeMemberIds) {
    const verifiedEmail = verifiedEmailByMemberId.get(memberId) ?? null;
    candidates.set(memberId, {
      address: normalizeHostedEmailAddress(
        verifiedEmail?.address ?? null,
      ),
      verifiedEmailLookupKey: verifiedEmail?.lookupKey ?? null,
      verifiedEmailVerifiedAt: verifiedEmail?.verifiedAt ?? null,
    });
  }

  // This is the final awaited authority read. Its late repeatable-read snapshot
  // keeps group binding, membership, active access, verified-email identity,
  // and the admitted grant snapshot coherent even if Prisma splits nested
  // relation loading.
  const canonicalGroup = await prisma.$transaction(async (tx) =>
    await tx.hostedGroup.findFirst({
      where: {
        ...(input.groupId ? { id: input.groupId } : {}),
        runtimeMemberId: input.runtimeMemberId,
      },
      select: {
        id: true,
        members: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            member: {
              select: {
                ...memberAccessSelect,
                emailAuthorization: {
                  select: {
                    verifiedEmailLookupKey: true,
                    verifiedEmailVerifiedAt: true,
                  },
                },
                vaultSharesGranted: {
                  orderBy: [
                    { projectionScopeKey: "asc" },
                    { id: "asc" },
                  ],
                  where: {
                    destinationMemberId: input.runtimeMemberId,
                    status: "granted",
                  },
                  select: {
                    id: true,
                    projectionKind: true,
                    projectionScopeKey: true,
                  },
                  take: HOSTED_GROUP_EMAIL_SHARE_QUERY_TAKE,
                },
              },
            },
          },
          take: HOSTED_GROUP_EMAIL_MEMBER_QUERY_TAKE,
        },
        runtimeMember: {
          select: memberAccessSelect,
        },
      },
    }), {
    ...HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
  if (!canonicalGroup) {
    return { status: "unavailable", unavailableReason: "group_not_found" };
  }
  if (
    !canonicalGroup.runtimeMember
    || !hasHostedGroupEmailMemberActiveAccess(canonicalGroup.runtimeMember)
  ) {
    return { status: "unavailable", unavailableReason: "runtime_inactive" };
  }
  if (
    canonicalGroup.members.length
    > HOSTED_RUNTIME_GROUP_EMAIL_PARTICIPANTS_MAX
  ) {
    return {
      status: "unavailable",
      unavailableReason: "authorization_snapshot_too_large",
    };
  }

  // Check the bounded share snapshot before testing email authorization. When
  // the snapshot is over budget, a later group-email.v0 row may be outside the
  // cap, so skipping first would turn an unknown authorization into success.
  for (const { member } of canonicalGroup.members) {
    if (!hasHostedGroupEmailMemberActiveAccess(member)) {
      continue;
    }
    if (
      member.vaultSharesGranted.filter((grant) =>
        grant.projectionKind !== "group-email.v0"
      ).length
      > HOSTED_RUNTIME_GROUP_EMAIL_AUTHORIZED_SHARES_PER_PARTICIPANT_MAX
    ) {
      return {
        status: "unavailable",
        unavailableReason: "authorization_snapshot_too_large",
      };
    }
  }

  const participants: Array<{
    address: string | null;
    authorizedShares: HostedGroupEmailAuthorizedShare[];
    emailIdentity: string | null;
    memberId: string;
  }> = [];
  for (const { member } of canonicalGroup.members) {
    if (!hasHostedGroupEmailMemberActiveAccess(member)) {
      continue;
    }
    if (!member.vaultSharesGranted.some((grant) =>
      grant.projectionKind === "group-email.v0"
    )) {
      continue;
    }

    const candidate = candidates.get(member.id) ?? null;
    const verifiedEmail = member.emailAuthorization;
    const emailUnchanged =
      candidate?.address
      && candidate.verifiedEmailLookupKey
      && candidate.verifiedEmailVerifiedAt
      && verifiedEmail?.verifiedEmailLookupKey === candidate.verifiedEmailLookupKey
      && verifiedEmail.verifiedEmailVerifiedAt?.getTime()
        === candidate.verifiedEmailVerifiedAt.getTime()
        ? {
            address: candidate.address,
            identity: buildHostedGroupEmailIdentity({
              lookupKey: candidate.verifiedEmailLookupKey,
              verifiedAt: candidate.verifiedEmailVerifiedAt,
            }),
          }
        : null;
    participants.push({
      address: emailUnchanged?.address ?? null,
      authorizedShares: member.vaultSharesGranted
        .filter((grant) => grant.projectionKind !== "group-email.v0")
        .map((grant) => ({
          projectionScopeKey: grant.projectionScopeKey,
          shareId: grant.id,
        })),
      emailIdentity: emailUnchanged?.identity ?? null,
      memberId: member.id,
    });
  }

  return {
    groupId: canonicalGroup.id,
    participants,
    status: "ok",
  };
}

function hasHostedGroupEmailMemberActiveAccess(
  member: HostedGroupEmailMemberAccess,
): boolean {
  if (resolveHostedHealthDataConsentState(member.consentGrants) === "revoked") {
    return false;
  }
  if (
    member.threadContainer
    && resolveHostedHealthDataConsentState(
      member.threadContainer.owner.consentGrants,
    ) === "revoked"
  ) {
    return member.threadContainer.participants.length > 0;
  }
  if (hasActiveHostedMemberAccess(member)) {
    return true;
  }
  return !isHostedMemberSuspended(member.suspendedAt)
    && Boolean(member.threadContainer?.participants.length);
}

function buildHostedGroupEmailAuthorizationProof(input: {
  groupId: string;
  participants: readonly HostedGroupEmailAuthorizationParticipant[];
}): string {
  const canonical = {
    groupId: input.groupId,
    participants: input.participants
      .map((participant) => ({
        authorizedShares: participant.authorizedShares
          .map(({ projectionScopeKey, shareId }) => ({ projectionScopeKey, shareId }))
          .sort((left, right) =>
            left.projectionScopeKey.localeCompare(right.projectionScopeKey)
            || left.shareId.localeCompare(right.shareId)
          ),
        emailIdentity: participant.emailIdentity,
        hasEmail: participant.hasEmail,
        memberId: participant.memberId,
      }))
      .sort((left, right) => left.memberId.localeCompare(right.memberId)),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function toHostedGroupEmailParticipant(
  participant: HostedGroupEmailAuthorizationParticipant,
): HostedGroupEmailParticipant {
  return {
    authorizedShares: participant.authorizedShares,
    hasEmail: participant.hasEmail,
    memberId: participant.memberId,
  };
}

function buildHostedGroupEmailIdentity(input: {
  lookupKey: string;
  verifiedAt: Date;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      lookupKey: input.lookupKey,
      verifiedAt: input.verifiedAt.toISOString(),
    }))
    .digest("hex");
}
