import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import type { HostedVaultShareProjectionKind } from "@murphai/hosted-execution/vault-share";

import { assertHostedLaunchRequiredConsentGranted } from "../legal/consent";
import { hasHostedRuntimeActiveAccess } from "../hosted-mailbox/runtime-access";
import { assertHostedMemberNotSuspended } from "../hosted-onboarding/entitlement";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  generateHostedGroupId,
  generateHostedGroupMemberId,
  generateHostedGroupJoinCode,
} from "../hosted-onboarding/shared";
import { normalizeNullableString } from "../primitives";
import { getPrisma } from "../prisma";
import {
  grantHostedVaultShareTx,
  readActiveHostedVaultShareProjectionKinds,
  revokeHostedVaultSharesWithCleanupTx,
  type HostedVaultShareCleanupSignal,
} from "../hosted-vault-share/share-grant-store";
import {
  emptyHostedGroupJoinPolicy,
  mergeHostedGroupJoinPolicy,
  normalizeHostedVaultShareProjectionKinds,
  projectHostedVaultShareProjectionDisplays,
  readHostedGroupJoinPolicy,
  type HostedVaultShareProjectionDisplay,
} from "./join-policy";
import { normalizeHostedGroupKind, type HostedGroupKind } from "./types";

export type HostedGroupsReadClient = PrismaClient | Prisma.TransactionClient;

export interface HostedGroupSummary {
  displayName: string | null;
  id: string;
  kind: string;
  memberCount: number;
  requestedVaultShareProjectionKinds: HostedVaultShareProjectionKind[];
  status: string;
}

export interface HostedGroupJoinView {
  activeVaultShareProjectionKinds: HostedVaultShareProjectionKind[];
  displayName: string | null;
  id: string;
  kind: string;
  memberCount: number;
  requestedVaultShareProjections: HostedVaultShareProjectionDisplay[];
  status: "active";
  viewerMembershipStatus: string | null;
}

export interface HostedGroupJoinAcceptanceResult {
  alreadyMember: boolean;
  grantedVaultShareProjectionKinds: HostedVaultShareProjectionKind[];
  groupId: string;
  membershipId: string;
  revokedVaultShareProjectionKinds: HostedVaultShareProjectionKind[];
}

export interface HostedGroupJoinAcceptanceTxResult
  extends HostedGroupJoinAcceptanceResult {
  vaultShareCleanupSignals: HostedVaultShareCleanupSignal[];
}

const HOSTED_GROUP_VAULT_SHARE_SOURCE = "hosted-group.join";
export const HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_PER_GRANTOR_PROJECTION = 25;
export const HOSTED_GROUP_VAULT_SHARE_DESTINATION_LIMIT_PER_PROJECTION = 100;

export async function ensureHostedGroupForThreadContainerTx(input: {
  tx: Prisma.TransactionClient;
  containerMemberId: string;
  displayName?: string | null;
  kind?: HostedGroupKind | string | null;
  now: Date;
  requestedVaultShareProjectionKinds?: readonly HostedVaultShareProjectionKind[] | null;
}): Promise<HostedGroupSummary> {
  await lockHostedThreadContainerRow(input.tx, input.containerMemberId);
  const container = await input.tx.hostedThreadContainer.findUnique({
    where: { memberId: input.containerMemberId },
    select: { memberId: true, ownerMemberId: true },
  });
  if (!container) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_THREAD_CONTAINER_NOT_FOUND",
      httpStatus: 404,
      message: "This hosted runtime is not a connected group chat.",
    });
  }
  if (!(await hasHostedRuntimeActiveAccess(container.memberId, { prisma: input.tx }))) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_RUNTIME_INACTIVE",
      httpStatus: 403,
      message: "This group chat runtime is not active.",
    });
  }

  const requested = normalizeHostedVaultShareProjectionKinds(
    input.requestedVaultShareProjectionKinds ?? [],
  );
  const existing = await input.tx.hostedGroup.findUnique({
    where: { runtimeMemberId: container.memberId },
    select: { id: true },
  });
  if (existing) {
    await lockHostedGroupRow(input.tx, existing.id);
    await ensureHostedGroupOwnerMembershipTx(input.tx, {
      groupId: existing.id,
      memberId: container.ownerMemberId,
      now: input.now,
    });
    if (requested.length > 0) {
      await mergeHostedGroupRequestedProjectionsTx(input.tx, {
        groupId: existing.id,
        requestedVaultShareProjectionKinds: requested,
      });
    }
    const summary = await readHostedGroupSummaryById(input.tx, existing.id);
    if (!summary) {
      throw hostedOnboardingError({
        code: "HOSTED_GROUP_NOT_ACTIVE",
        httpStatus: 410,
        message: "This hosted group is not active.",
      });
    }
    return summary;
  }

  const created = await input.tx.hostedGroup.create({
    data: {
      id: generateHostedGroupId(),
      displayName: normalizeHostedGroupDisplayName(input.displayName ?? null),
      joinPolicyJson: requested.length > 0
        ? {
            ...emptyHostedGroupJoinPolicy(),
            requestedVaultShareProjectionKinds: requested,
          }
        : undefined,
      kind: normalizeHostedGroupKind(input.kind),
      ownerMemberId: container.ownerMemberId,
      runtimeMemberId: container.memberId,
    },
    select: { id: true },
  });
  await ensureHostedGroupOwnerMembershipTx(input.tx, {
    groupId: created.id,
    memberId: container.ownerMemberId,
    now: input.now,
  });

  const summary = await readHostedGroupSummaryById(input.tx, created.id);
  if (!summary) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_CREATE_FAILED",
      httpStatus: 500,
      message: "Could not create this hosted group.",
    });
  }
  return summary;
}

export async function readHostedGroupByRuntimeMemberId(input: {
  prisma?: HostedGroupsReadClient;
  runtimeMemberId: string;
}): Promise<HostedGroupSummary | null> {
  const prisma = input.prisma ?? getPrisma();
  const group = await prisma.hostedGroup.findUnique({
    where: { runtimeMemberId: input.runtimeMemberId },
    select: { id: true },
  });
  return group ? readHostedGroupSummaryById(prisma, group.id) : null;
}

export async function createOrReadHostedGroupJoinLinkTx(input: {
  tx: Prisma.TransactionClient;
  actorMemberId: string;
  groupId: string;
  now: Date;
}): Promise<{ joinCode: string }> {
  await lockHostedGroupRow(input.tx, input.groupId);
  const group = await input.tx.hostedGroup.findUnique({
    where: { id: input.groupId },
    select: { id: true, joinCode: true, ownerMemberId: true },
  });
  if (!group) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_NOT_ACTIVE",
      httpStatus: 410,
      message: "This hosted group is not active.",
    });
  }
  if (group.ownerMemberId !== input.actorMemberId) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_OWNER_REQUIRED",
      httpStatus: 403,
      message: "Only the group owner can create a join link.",
    });
  }
  if (group.joinCode) {
    return { joinCode: group.joinCode };
  }
  const updated = await input.tx.hostedGroup.update({
    where: { id: group.id },
    data: { joinCode: generateHostedGroupJoinCode(), joinCodeCreatedAt: input.now },
    select: { joinCode: true },
  });
  if (!updated.joinCode) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_JOIN_LINK_CREATE_FAILED",
      httpStatus: 500,
      message: "Could not create a group join link.",
    });
  }
  return { joinCode: updated.joinCode };
}

export async function createHostedGroupJoinLinkForOwnedThreadContainerTx(input: {
  tx: Prisma.TransactionClient;
  actorMemberId: string;
  containerMemberId: string;
  displayName?: string | null;
  kind?: HostedGroupKind | string | null;
  now: Date;
  requestedVaultShareProjectionKinds?: readonly HostedVaultShareProjectionKind[] | null;
}): Promise<{
  group: HostedGroupSummary;
  joinCode: string;
}> {
  await lockHostedThreadContainerRow(input.tx, input.containerMemberId);
  const container = await input.tx.hostedThreadContainer.findUnique({
    where: { memberId: input.containerMemberId },
    select: { ownerMemberId: true },
  });
  if (!container) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_THREAD_CONTAINER_NOT_FOUND",
      httpStatus: 404,
      message: "This hosted runtime is not a connected group chat.",
    });
  }
  if (container.ownerMemberId !== input.actorMemberId) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_OWNER_REQUIRED",
      httpStatus: 403,
      message: "Only the group owner can create a join link.",
    });
  }

  const group = await ensureHostedGroupForThreadContainerTx({
    containerMemberId: input.containerMemberId,
    displayName: input.displayName ?? null,
    kind: input.kind ?? null,
    now: input.now,
    requestedVaultShareProjectionKinds:
      input.requestedVaultShareProjectionKinds ?? [],
    tx: input.tx,
  });
  const link = await createOrReadHostedGroupJoinLinkTx({
    actorMemberId: input.actorMemberId,
    groupId: group.id,
    now: input.now,
    tx: input.tx,
  });

  return {
    group,
    joinCode: link.joinCode,
  };
}

export async function readHostedGroupJoinView(input: {
  joinCode: string;
  memberId?: string | null;
  prisma?: HostedGroupsReadClient;
}): Promise<HostedGroupJoinView | null> {
  const prisma = input.prisma ?? getPrisma();
  const viewerMemberId = normalizeNullableString(input.memberId) ?? "__anonymous_hosted_group_viewer__";
  const group = await prisma.hostedGroup.findUnique({
    where: { joinCode: input.joinCode },
    select: {
      displayName: true,
      id: true,
      joinPolicyJson: true,
      kind: true,
      runtimeMemberId: true,
      _count: { select: { members: true } },
      members: {
        where: { memberId: viewerMemberId },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!group) {
    return null;
  }

  const policy = readHostedGroupJoinPolicy(group.joinPolicyJson);
  const activeVaultShareProjectionKinds = input.memberId && group.runtimeMemberId
    ? await readActiveHostedVaultShareProjectionKinds({
        destinationMemberId: group.runtimeMemberId,
        grantorMemberId: input.memberId,
        prisma,
        projectionKinds: policy.requestedVaultShareProjectionKinds,
        source: HOSTED_GROUP_VAULT_SHARE_SOURCE,
      })
    : [];

  return {
    activeVaultShareProjectionKinds,
    displayName: group.displayName,
    id: group.id,
    kind: group.kind,
    memberCount: group._count.members,
    requestedVaultShareProjections: projectHostedVaultShareProjectionDisplays(
      policy.requestedVaultShareProjectionKinds,
    ),
    status: "active",
    viewerMembershipStatus: group.members.length > 0 ? "active" : null,
  };
}

export async function acceptHostedGroupJoinCodeTx(input: {
  tx: Prisma.TransactionClient;
  joinCode: string;
  memberId: string;
  now: Date;
  selectedVaultShareProjectionKinds?: readonly HostedVaultShareProjectionKind[] | null;
}): Promise<HostedGroupJoinAcceptanceTxResult> {
  const groupLookup = await input.tx.hostedGroup.findUnique({
    where: { joinCode: input.joinCode },
    select: { id: true },
  });
  if (!groupLookup) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_JOIN_LINK_NOT_FOUND",
      httpStatus: 404,
      message: "This group link is no longer valid.",
    });
  }
  await lockHostedGroupRow(input.tx, groupLookup.id);
  const group = await input.tx.hostedGroup.findUnique({
    where: { id: groupLookup.id },
    select: { id: true, joinPolicyJson: true, runtimeMemberId: true },
  });
  if (!group) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_NOT_ACTIVE",
      httpStatus: 410,
      message: "This group is no longer active.",
    });
  }
  await lockHostedMemberRow(input.tx, input.memberId);
  const member = await input.tx.hostedMember.findUnique({
    where: { id: input.memberId },
    select: { suspendedAt: true },
  });
  if (!member) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_JOIN_MEMBER_NOT_FOUND",
      httpStatus: 404,
      message: "Your Murph account could not be found.",
    });
  }
  assertHostedMemberNotSuspended(member);

  const selected = normalizeHostedVaultShareProjectionKinds(
    input.selectedVaultShareProjectionKinds ?? [],
  );
  const policy = readHostedGroupJoinPolicy(group.joinPolicyJson);
  const requestedSet = new Set(policy.requestedVaultShareProjectionKinds);
  for (const projectionKind of selected) {
    if (!requestedSet.has(projectionKind)) {
      throw hostedOnboardingError({
        code: "HOSTED_GROUP_PERMISSION_NOT_REQUESTED",
        httpStatus: 400,
        message: "That permission was not requested by this group.",
      });
    }
  }
  if (selected.length > 0) {
    if (!group.runtimeMemberId) {
      throw hostedOnboardingError({
        code: "HOSTED_GROUP_RUNTIME_REQUIRED",
        httpStatus: 409,
        message: "This group cannot receive shared health data yet.",
      });
    }
    await assertHostedGroupRuntimeDestinationTx(input.tx, group.runtimeMemberId);
    await assertHostedLaunchRequiredConsentGranted({ memberId: input.memberId, prisma: input.tx });
  }

  const existingMembership = await input.tx.hostedGroupMember.findUnique({
    where: { groupId_memberId: { groupId: group.id, memberId: input.memberId } },
    select: { id: true },
  });
  let membershipId: string;
  let alreadyMember = false;
  if (!existingMembership) {
    const created = await input.tx.hostedGroupMember.create({
      data: {
        id: generateHostedGroupMemberId(),
        groupId: group.id,
        joinedAt: input.now,
        memberId: input.memberId,
        role: "member",
      },
      select: { id: true },
    });
    membershipId = created.id;
  } else {
    alreadyMember = true;
    membershipId = existingMembership.id;
  }

  const grantedVaultShareProjectionKinds: HostedVaultShareProjectionKind[] = [];
  const revokedVaultShareProjectionKinds: HostedVaultShareProjectionKind[] = [];
  const vaultShareCleanupSignals: HostedVaultShareCleanupSignal[] = [];
  if (group.runtimeMemberId && policy.requestedVaultShareProjectionKinds.length > 0) {
    for (const projectionKind of policy.requestedVaultShareProjectionKinds) {
      if (selected.includes(projectionKind)) {
        await assertHostedGroupVaultShareGrantLimitTx(input.tx, {
          destinationMemberId: group.runtimeMemberId,
          grantorMemberId: input.memberId,
          projectionKind,
        });
        const grant = await grantHostedVaultShareTx({
          destinationMemberId: group.runtimeMemberId,
          grantorMemberId: input.memberId,
          now: input.now,
          projectionKind,
          source: HOSTED_GROUP_VAULT_SHARE_SOURCE,
          tx: input.tx,
        });
        if (grant.status !== "foreign-active-grant") {
          grantedVaultShareProjectionKinds.push(projectionKind);
        }
      } else {
        const revoked = await revokeHostedVaultSharesWithCleanupTx({
          destinationMemberId: group.runtimeMemberId,
          grantorMemberId: input.memberId,
          now: input.now,
          projectionKinds: [projectionKind],
          source: HOSTED_GROUP_VAULT_SHARE_SOURCE,
          tx: input.tx,
        });
        vaultShareCleanupSignals.push(...revoked.cleanupSignals);
        if (revoked.revokedCount > 0) {
          revokedVaultShareProjectionKinds.push(projectionKind);
        }
      }
    }
  }

  return {
    alreadyMember,
    grantedVaultShareProjectionKinds,
    groupId: group.id,
    membershipId,
    revokedVaultShareProjectionKinds,
    vaultShareCleanupSignals,
  };
}

async function ensureHostedGroupOwnerMembershipTx(
  tx: Prisma.TransactionClient,
  input: { groupId: string; memberId: string; now: Date },
): Promise<void> {
  await tx.hostedGroupMember.upsert({
    create: {
      id: generateHostedGroupMemberId(),
      groupId: input.groupId,
      joinedAt: input.now,
      memberId: input.memberId,
      role: "owner",
    },
    update: {
      joinedAt: input.now,
      role: "owner",
    },
    where: { groupId_memberId: { groupId: input.groupId, memberId: input.memberId } },
  });
}

async function mergeHostedGroupRequestedProjectionsTx(
  tx: Prisma.TransactionClient,
  input: {
    groupId: string;
    requestedVaultShareProjectionKinds: readonly HostedVaultShareProjectionKind[];
  },
): Promise<void> {
  const group = await tx.hostedGroup.findUnique({
    where: { id: input.groupId },
    select: { joinPolicyJson: true, runtimeMemberId: true },
  });
  if (!group) throw hostedOnboardingError({ code: "HOSTED_GROUP_NOT_FOUND", httpStatus: 404, message: "Hosted group not found." });
  if (input.requestedVaultShareProjectionKinds.length > 0) {
    if (!group.runtimeMemberId) {
      throw hostedOnboardingError({
        code: "HOSTED_GROUP_RUNTIME_REQUIRED",
        httpStatus: 409,
        message: "Requested group permissions require a group runtime.",
      });
    }
    await assertHostedGroupRuntimeDestinationTx(tx, group.runtimeMemberId);
  }
  const merged = mergeHostedGroupJoinPolicy({
    existing: group.joinPolicyJson,
    requestedVaultShareProjectionKinds: input.requestedVaultShareProjectionKinds,
  });
  await tx.hostedGroup.update({
    where: { id: input.groupId },
    data: {
      joinPolicyJson: merged.requestedVaultShareProjectionKinds.length > 0
        ? toHostedGroupJoinPolicyJson(merged)
        : undefined,
    },
  });
}

function toHostedGroupJoinPolicyJson(policy: ReturnType<typeof mergeHostedGroupJoinPolicy>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(policy)) as Prisma.InputJsonValue;
}

async function readHostedGroupSummaryById(
  prisma: HostedGroupsReadClient,
  groupId: string,
): Promise<HostedGroupSummary | null> {
  const group = await prisma.hostedGroup.findUnique({
    where: { id: groupId },
    select: {
      displayName: true,
      id: true,
      joinPolicyJson: true,
      kind: true,
      _count: { select: { members: true } },
    },
  });
  if (!group) return null;
  return {
    displayName: group.displayName,
    id: group.id,
    kind: group.kind,
    memberCount: group._count.members,
    requestedVaultShareProjectionKinds:
      readHostedGroupJoinPolicy(group.joinPolicyJson).requestedVaultShareProjectionKinds,
    status: "active",
  };
}

async function assertHostedGroupRuntimeDestinationTx(
  tx: Prisma.TransactionClient,
  runtimeMemberId: string,
): Promise<void> {
  const container = await tx.hostedThreadContainer.findUnique({
    where: { memberId: runtimeMemberId },
    select: { memberId: true },
  });
  if (!container || !(await hasHostedRuntimeActiveAccess(runtimeMemberId, { prisma: tx }))) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_RUNTIME_UNSUPPORTED",
      httpStatus: 409,
      message: "This group cannot receive shared health data yet.",
    });
  }
}

async function assertHostedGroupVaultShareGrantLimitTx(
  tx: Prisma.TransactionClient,
  input: {
    destinationMemberId: string;
    grantorMemberId: string;
    projectionKind: HostedVaultShareProjectionKind;
  },
): Promise<void> {
  const existing = await tx.hostedVaultShare.findUnique({
    where: {
      grantorMemberId_projectionKind_destinationMemberId: {
        destinationMemberId: input.destinationMemberId,
        grantorMemberId: input.grantorMemberId,
        projectionKind: input.projectionKind,
      },
    },
    select: { status: true },
  });

  if (existing?.status === "granted") {
    return;
  }

  const activeGroupGrantCount = await tx.hostedVaultShare.count({
    where: {
      grantorMemberId: input.grantorMemberId,
      projectionKind: input.projectionKind,
      source: HOSTED_GROUP_VAULT_SHARE_SOURCE,
      status: "granted",
    },
  });

  if (activeGroupGrantCount >= HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_PER_GRANTOR_PROJECTION) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_REACHED",
      httpStatus: 409,
      message:
        "You have reached the group health-sharing limit for this permission. Turn off this permission in another group before sharing it here.",
      retryable: false,
    });
  }

  const activeDestinationGrantCount = await tx.hostedVaultShare.count({
    where: {
      destinationMemberId: input.destinationMemberId,
      projectionKind: input.projectionKind,
      source: HOSTED_GROUP_VAULT_SHARE_SOURCE,
      status: "granted",
    },
  });

  if (
    activeDestinationGrantCount
    >= HOSTED_GROUP_VAULT_SHARE_DESTINATION_LIMIT_PER_PROJECTION
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_VAULT_SHARE_DESTINATION_LIMIT_REACHED",
      httpStatus: 409,
      message:
        "This group has reached the health-sharing limit for this permission. Turn off this permission for another member before adding it here.",
      retryable: false,
    });
  }
}

async function lockHostedGroupRow(tx: Prisma.TransactionClient, groupId: string): Promise<void> {
  await tx.$queryRaw`select 1 from "hosted_group" where "id" = ${groupId} for update`;
}

async function lockHostedMemberRow(tx: Prisma.TransactionClient, memberId: string): Promise<void> {
  await tx.$queryRaw`select 1 from "hosted_member" where "id" = ${memberId} for update`;
}

async function lockHostedThreadContainerRow(
  tx: Prisma.TransactionClient,
  memberId: string,
): Promise<void> {
  await tx.$queryRaw`select 1 from "hosted_thread_container" where "member_id" = ${memberId} for update`;
}

function normalizeHostedGroupDisplayName(value: string | null | undefined): string | null {
  const normalized = normalizeNullableString(value);
  if (!normalized) return null;
  return normalized.length > 120 ? normalized.slice(0, 120) : normalized;
}
