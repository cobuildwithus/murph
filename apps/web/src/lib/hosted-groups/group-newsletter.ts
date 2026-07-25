import "server-only";

import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  buildHostedExecutionGroupNewsletterEmailNeededWake,
  type HostedExecutionDirectRoute,
} from "@murphai/hosted-execution";
import {
  HOSTED_RUNTIME_NEWSLETTER_AUTHORIZED_SHARES_PER_PARTICIPANT_MAX,
} from "@murphai/hosted-execution/runtime-control";
import { normalizeHostedEmailAddress } from "@murphai/runtime-state";

import { appendHostedMailboxEnvelopeTx } from "../hosted-mailbox/store";
import { hasHostedRuntimeActiveAccess } from "../hosted-mailbox/runtime-access";
import {
  readHostedMemberVerifiedEmailSnapshots,
} from "../hosted-onboarding/hosted-member-store";
import {
  readHostedMemberRoutingState,
} from "../hosted-onboarding/hosted-member-routing-store";
import {
  activeHostedMemberAccessWhere,
  hasActiveHostedMemberAccess,
  hostedMemberAccessSelect,
  hostedMemberPersonAccessSelect,
  readActiveHostedMemberAccess,
} from "../hosted-onboarding/member-access";
import { isHostedMemberSuspended } from "../hosted-onboarding/entitlement";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS } from "../hosted-onboarding/shared";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import {
  resolveHostedMemberDirectRoute,
} from "../hosted-routing/member-direct-route";
import { getPrisma } from "../prisma";

export interface HostedGroupNewsletterParticipant {
  authorizedShares: HostedGroupNewsletterAuthorizedShare[];
  hasEmail: boolean;
  memberId: string;
}

interface HostedGroupNewsletterAuthorizationParticipant
  extends HostedGroupNewsletterParticipant {
  emailIdentity: string | null;
}

export interface HostedGroupNewsletterAuthorizedShare {
  projectionScopeKey: string;
  shareId: string;
}

export interface HostedGroupNewsletterEmailRecipient {
  address: string;
  memberId: string;
}

export type HostedGroupNewsletterPreparationResult =
  | {
      authorizationProof: string;
      groupId: string;
      missingEmailParticipants: HostedGroupNewsletterParticipant[];
      participants: HostedGroupNewsletterParticipant[];
      status: "ok";
    }
  | {
      status: "unavailable";
      unavailableReason: string;
    };

type ReadClient = PrismaClient;

const hostedGroupNewsletterMemberAccessSelect =
  Prisma.validator<Prisma.HostedMemberSelect>()({
    ...hostedMemberAccessSelect,
    id: true,
    threadContainer: {
      select: {
        owner: {
          select: hostedMemberPersonAccessSelect,
        },
        participants: {
          select: { participantMemberId: true },
          take: 1,
          where: {
            participant: activeHostedMemberAccessWhere(),
            removedAt: null,
          },
        },
      },
    },
  });

type HostedGroupNewsletterMemberAccess = Prisma.HostedMemberGetPayload<{
  select: typeof hostedGroupNewsletterMemberAccessSelect;
}>;

export async function enqueueHostedGroupNewsletterEmailNeededNudgeIfNeededBestEffort(input: {
  groupId: string;
  memberId: string;
  prisma?: ReadClient;
}): Promise<void> {
  const prisma = input.prisma ?? getPrisma();
  try {
    const group = await prisma.hostedGroup.findFirst({
      where: {
        id: input.groupId,
        members: {
          some: { memberId: input.memberId },
        },
      },
      select: {
        displayName: true,
        id: true,
        runtimeMemberId: true,
      },
    });
    if (!group?.runtimeMemberId) {
      return;
    }
    if (!await hasHostedRuntimeActiveAccess(group.runtimeMemberId, { prisma })) {
      return;
    }

    const emailGrant = await prisma.hostedVaultShare.findFirst({
      where: {
        destinationMemberId: group.runtimeMemberId,
        grantorMemberId: input.memberId,
        projectionKind: "group-email.v0",
        status: "granted",
      },
      select: { grantorMemberId: true },
    });
    if (!emailGrant) {
      return;
    }
    if (!await readActiveHostedMemberAccess({ memberId: input.memberId, prisma })) {
      return;
    }

    const [emailSnapshot] = await readHostedMemberVerifiedEmailSnapshots({
      memberIds: [input.memberId],
      prisma,
    });
    const address = normalizeHostedEmailAddress(
      emailSnapshot?.verifiedEmail?.address ?? null,
    );
    if (address) {
      return;
    }

    await appendGroupNewsletterEmailNeededWakeBestEffort({
      groupDisplayName: group.displayName ?? null,
      groupId: group.id,
      memberId: input.memberId,
      prisma,
    });
  } catch {
    // Joining should not fail because a private missing-email nudge could not be evaluated.
  }
}

export async function prepareHostedGroupNewsletterParticipants(input: {
  prisma?: ReadClient;
  runtimeMemberId: string;
}): Promise<HostedGroupNewsletterPreparationResult> {
  const nudgeSnapshot = await readHostedGroupNewsletterParticipantEmailFacts(input);
  if (nudgeSnapshot.status !== "ok") {
    return nudgeSnapshot;
  }

  if (
    nudgeSnapshot.participants.some((participant) =>
      participant.authorizedShares.length
      > HOSTED_RUNTIME_NEWSLETTER_AUTHORIZED_SHARES_PER_PARTICIPANT_MAX
    )
  ) {
    return {
      status: "unavailable",
      unavailableReason: "authorization_snapshot_too_large",
    };
  }
  const nudgeParticipants = nudgeSnapshot.participants.map((participant) => ({
    authorizedShares: participant.authorizedShares,
    emailIdentity: participant.emailIdentity,
    hasEmail: participant.address !== null,
    memberId: participant.memberId,
  }));
  await enqueueMissingNewsletterEmailWakesBestEffort({
    groupDisplayName: nudgeSnapshot.groupDisplayName,
    groupId: nudgeSnapshot.groupId,
    missingMemberIds: nudgeParticipants
      .filter((participant) => !participant.hasEmail)
      .map((participant) => participant.memberId),
    prisma: input.prisma ?? getPrisma(),
  });

  const resolved = await readHostedGroupNewsletterParticipantEmailFacts(input);
  if (resolved.status !== "ok") {
    return resolved;
  }
  if (
    resolved.participants.some((participant) =>
      participant.authorizedShares.length
      > HOSTED_RUNTIME_NEWSLETTER_AUTHORIZED_SHARES_PER_PARTICIPANT_MAX
    )
  ) {
    return {
      status: "unavailable",
      unavailableReason: "authorization_snapshot_too_large",
    };
  }
  const authorizationParticipants = resolved.participants.map((participant) => ({
    authorizedShares: participant.authorizedShares,
    emailIdentity: participant.emailIdentity,
    hasEmail: participant.address !== null,
    memberId: participant.memberId,
  }));
  const participants = authorizationParticipants.map(
    toHostedGroupNewsletterParticipant,
  );

  return {
    authorizationProof: buildHostedGroupNewsletterAuthorizationProof({
      groupId: resolved.groupId,
      participants: authorizationParticipants,
    }),
    groupId: resolved.groupId,
    missingEmailParticipants: participants.filter((participant) => !participant.hasEmail),
    participants,
    status: "ok",
  };
}

export async function readHostedGroupNewsletterEmailRecipients(input: {
  expectedNewsletterAuthorizationProof?: string | null;
  groupId: string;
  prisma?: ReadClient;
  runtimeMemberId: string;
}): Promise<
  | {
      recipients: HostedGroupNewsletterEmailRecipient[];
      status: "ok";
    }
  | {
      status: "unavailable";
      unavailableReason: string;
    }
> {
  const resolved = await readHostedGroupNewsletterParticipantEmailFacts(input);
  if (resolved.status !== "ok") {
    return resolved;
  }

  if (
    input.expectedNewsletterAuthorizationProof
    && input.expectedNewsletterAuthorizationProof
      !== buildHostedGroupNewsletterAuthorizationProof({
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
      unavailableReason: "newsletter_authorization_changed",
    };
  }

  const recipients: HostedGroupNewsletterEmailRecipient[] = [];
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

async function readHostedGroupNewsletterParticipantEmailFacts(input: {
  groupId?: string;
  prisma?: ReadClient;
  runtimeMemberId: string;
}): Promise<
  | {
      groupDisplayName: string | null;
      groupId: string;
      participants: Array<{
        address: string | null;
        authorizedShares: HostedGroupNewsletterAuthorizedShare[];
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
      displayName: true,
      members: {
        orderBy: { createdAt: "asc" },
        select: { memberId: true },
      },
    },
  });
  if (!group) {
    return { status: "unavailable", unavailableReason: "group_not_found" };
  }

  const memberIds = group.members.map((member) => member.memberId);
  const accessRecords = await prisma.hostedMember.findMany({
    where: {
      id: {
        in: memberIds,
      },
    },
    select: hostedGroupNewsletterMemberAccessSelect,
  });
  const activeMemberIdSet = new Set(
    accessRecords
      .filter(hasHostedGroupNewsletterMemberActiveAccess)
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
  // and every grant coherent even if Prisma splits nested relation loading.
  const canonicalGroup = await prisma.$transaction(async (tx) =>
    await tx.hostedGroup.findFirst({
      where: {
        ...(input.groupId ? { id: input.groupId } : {}),
        runtimeMemberId: input.runtimeMemberId,
      },
      select: {
        id: true,
        displayName: true,
        members: {
          orderBy: { createdAt: "asc" },
          select: {
            member: {
              select: {
                ...hostedGroupNewsletterMemberAccessSelect,
                emailAuthorization: {
                  select: {
                    verifiedEmailLookupKey: true,
                    verifiedEmailVerifiedAt: true,
                  },
                },
                vaultSharesGranted: {
                  orderBy: { projectionScopeKey: "asc" },
                  where: {
                    destinationMemberId: input.runtimeMemberId,
                    status: "granted",
                  },
                  select: {
                    id: true,
                    projectionKind: true,
                    projectionScopeKey: true,
                  },
                },
              },
            },
          },
        },
        runtimeMember: {
          select: hostedGroupNewsletterMemberAccessSelect,
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
    || !hasHostedGroupNewsletterMemberActiveAccess(canonicalGroup.runtimeMember)
  ) {
    return { status: "unavailable", unavailableReason: "runtime_inactive" };
  }

  const participants: Array<{
    address: string | null;
    authorizedShares: HostedGroupNewsletterAuthorizedShare[];
    emailIdentity: string | null;
    memberId: string;
  }> = [];
  for (const { member } of canonicalGroup.members) {
    if (!hasHostedGroupNewsletterMemberActiveAccess(member)) {
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
            identity: buildHostedGroupNewsletterEmailIdentity({
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
    groupDisplayName: canonicalGroup.displayName ?? null,
    groupId: canonicalGroup.id,
    participants,
    status: "ok",
  };
}

function hasHostedGroupNewsletterMemberActiveAccess(
  member: HostedGroupNewsletterMemberAccess,
): boolean {
  if (hasActiveHostedMemberAccess(member)) {
    return true;
  }
  return !isHostedMemberSuspended(member.suspendedAt)
    && Boolean(member.threadContainer?.participants.length);
}

function buildHostedGroupNewsletterAuthorizationProof(input: {
  groupId: string;
  participants: readonly HostedGroupNewsletterAuthorizationParticipant[];
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

function toHostedGroupNewsletterParticipant(
  participant: HostedGroupNewsletterAuthorizationParticipant,
): HostedGroupNewsletterParticipant {
  return {
    authorizedShares: participant.authorizedShares,
    hasEmail: participant.hasEmail,
    memberId: participant.memberId,
  };
}

function buildHostedGroupNewsletterEmailIdentity(input: {
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

async function enqueueMissingNewsletterEmailWakesBestEffort(input: {
  groupDisplayName: string | null;
  groupId: string;
  missingMemberIds: readonly string[];
  prisma: ReadClient;
}): Promise<void> {
  for (const memberId of input.missingMemberIds) {
    await appendGroupNewsletterEmailNeededWakeBestEffort({
      groupDisplayName: input.groupDisplayName,
      groupId: input.groupId,
      memberId,
      prisma: input.prisma,
    });
  }
}

async function appendGroupNewsletterEmailNeededWakeBestEffort(input: {
  groupDisplayName: string | null;
  groupId: string;
  memberId: string;
  prisma: ReadClient;
}): Promise<void> {
  const eventId = buildGroupNewsletterEmailNeededEventId({
    groupId: input.groupId,
    memberId: input.memberId,
  });
  try {
    const directRoute = await readHostedMemberDirectNewsletterNudgeRoute({
      memberId: input.memberId,
      prisma: input.prisma,
    });
    if (!directRoute) {
      return;
    }

    const appended = await input.prisma.$transaction(async (tx) =>
      appendHostedMailboxEnvelopeTx({
        envelope: buildHostedExecutionGroupNewsletterEmailNeededWake({
          directRoute,
          eventId,
          groupDisplayName: input.groupDisplayName,
          groupId: input.groupId,
          memberId: input.memberId,
          occurredAt: new Date().toISOString(),
        }),
        tx,
      })
    );
    if (!appended.inserted) {
      return;
    }
    try {
      await signalHostedMailboxAppendRuntime({
        expectedUserId: input.memberId,
        mailboxItemId: appended.item.id,
      });
    } catch {
      // The mailbox item is durable; the destination runtime will observe it later.
    }
  } catch {
    // Missing-email private nudges are best-effort and must not fail the caller.
  }
}

async function readHostedMemberDirectNewsletterNudgeRoute(input: {
  memberId: string;
  prisma: ReadClient;
}): Promise<HostedExecutionDirectRoute | null> {
  const routing = await readHostedMemberRoutingState({
    memberId: input.memberId,
    prisma: input.prisma,
  });

  return resolveHostedMemberDirectRoute(routing);
}

function buildGroupNewsletterEmailNeededEventId(input: {
  groupId: string;
  memberId: string;
}): string {
  return `group-newsletter.email-needed:${input.memberId}:${input.groupId}`;
}
