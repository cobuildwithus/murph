import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  buildHostedVaultShareProjectionScopeKey,
  hostedVaultShareProjectionKindToScope,
  isHostedVaultShareFixedProjectionKind,
  parseHostedVaultShareProjectionScope,
  type HostedVaultShareProjectionKind,
  type HostedVaultShareProjectionScope,
} from "@murphai/hosted-execution/vault-share";

import { assertHostedLaunchRequiredConsentGranted } from "../legal/consent";
import { hasHostedRuntimeActiveAccess } from "../hosted-mailbox/runtime-access";
import { createHostedLinqMessageLookupKey } from "../hosted-onboarding/contact-privacy";
import { assertHostedMemberNotSuspended } from "../hosted-onboarding/entitlement";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  generateHostedGroupId,
  generateHostedGroupJoinOfferId,
  generateHostedGroupMemberId,
  generateHostedGroupJoinCode,
} from "../hosted-onboarding/shared";
import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { toHostedOnboardingLogIdSuffix } from "../hosted-onboarding/logging";
import { normalizeNullableString } from "../primitives";
import { getPrisma } from "../prisma";
import {
  grantHostedVaultShareTx,
  readActiveHostedVaultShareProjectionScopes,
  revokeHostedVaultSharesWithCleanupTx,
  type HostedVaultShareCleanupSignal,
} from "../hosted-vault-share/share-grant-store";
import {
  emptyHostedGroupJoinPolicy,
  mergeHostedGroupJoinPolicy,
  normalizeHostedVaultShareProjectionKinds,
  normalizeHostedVaultShareProjectionScopes,
  projectHostedVaultShareProjectionDisplays,
  readHostedGroupJoinPolicy,
  type HostedVaultShareProjectionDisplay,
} from "./join-policy";
import { normalizeHostedGroupKind, type HostedGroupKind } from "./types";

export type HostedGroupsReadClient = PrismaClient | Prisma.TransactionClient;

export interface HostedGroupMemberRosterEntry {
  grantedVaultShareProjectionKinds: HostedVaultShareProjectionKind[];
  grantedVaultShareProjectionScopes: HostedVaultShareProjectionScope[];
  handle: string | null;
  memberId: string;
  role: string;
}

export interface HostedGroupSummary {
  displayName: string | null;
  id: string;
  kind: string;
  memberCount: number;
  members: HostedGroupMemberRosterEntry[];
  requestedVaultShareProjectionKinds: HostedVaultShareProjectionKind[];
  requestedVaultShareProjectionScopes: HostedVaultShareProjectionScope[];
  status: string;
}

export interface HostedGroupJoinView {
  activeVaultShareProjectionKinds: HostedVaultShareProjectionKind[];
  activeVaultShareProjectionScopes: HostedVaultShareProjectionScope[];
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
  grantedVaultShareProjectionScopes: HostedVaultShareProjectionScope[];
  groupId: string;
  membershipId: string;
  revokedVaultShareProjectionKinds: HostedVaultShareProjectionKind[];
  revokedVaultShareProjectionScopes: HostedVaultShareProjectionScope[];
}

export interface HostedGroupJoinAcceptanceTxResult
  extends HostedGroupJoinAcceptanceResult {
  vaultShareCleanupSignals: HostedVaultShareCleanupSignal[];
}

export interface HostedGroupJoinOfferBindingTxResult {
  groupId: string;
  messageIdSuffix: string | null;
  messageLookupKey: string;
  projectionKinds: HostedVaultShareProjectionKind[];
  projectionScopes: HostedVaultShareProjectionScope[];
}

export interface HostedGroupJoinOfferAcceptanceTxResult
  extends HostedGroupJoinAcceptanceTxResult {
  joinCode: string;
  messageLookupKey: string;
  selectedVaultShareProjectionKinds: HostedVaultShareProjectionKind[];
  selectedVaultShareProjectionScopes: HostedVaultShareProjectionScope[];
}

export type HostedGroupMemberEmailShareRevocationTxResult =
  | {
      groupId: string;
      kind: "ok";
      revokedCount: number;
      vaultShareCleanupSignals: HostedVaultShareCleanupSignal[];
    }
  | {
      kind: "group_not_found" | "not_group_member";
      revokedCount: 0;
      vaultShareCleanupSignals: [];
    };

export const HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_PER_GRANTOR_PROJECTION = 25;
export const HOSTED_GROUP_VAULT_SHARE_DESTINATION_LIMIT_PER_PROJECTION = 100;
const DEFAULT_HOSTED_GROUP_REQUESTED_VAULT_SHARE_PROJECTION_KINDS = [
  "group-email.v0",
] as const satisfies readonly HostedVaultShareProjectionKind[];
const DEFAULT_HOSTED_GROUP_REQUESTED_VAULT_SHARE_PROJECTION_SCOPES =
  DEFAULT_HOSTED_GROUP_REQUESTED_VAULT_SHARE_PROJECTION_KINDS.map((projectionKind) =>
    hostedVaultShareProjectionKindToScope(projectionKind)
  );

export async function ensureHostedGroupForThreadContainerTx(input: {
  tx: Prisma.TransactionClient;
  containerMemberId: string;
  displayName?: string | null;
  kind?: HostedGroupKind | string | null;
  now: Date;
  requestedVaultShareProjectionScopes?: readonly HostedVaultShareProjectionScope[] | null;
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

  const requested = normalizeHostedVaultShareProjectionScopes(
    input.requestedVaultShareProjectionScopes
      ?? fixedProjectionKindsToScopes(input.requestedVaultShareProjectionKinds ?? []),
  );
  const createdRequested = normalizeHostedVaultShareProjectionScopes([
    ...DEFAULT_HOSTED_GROUP_REQUESTED_VAULT_SHARE_PROJECTION_SCOPES,
    ...requested,
  ]);
  const existing = await input.tx.hostedGroup.findUnique({
    where: { runtimeMemberId: container.memberId },
    select: { displayName: true, id: true },
  });
  if (existing) {
    await lockHostedGroupRow(input.tx, existing.id);
    const normalizedDisplayName = normalizeHostedGroupDisplayName(input.displayName ?? null);
    if (existing.displayName === null && normalizedDisplayName !== null) {
      await input.tx.hostedGroup.update({
        where: { id: existing.id },
        data: { displayName: normalizedDisplayName },
        select: { id: true },
      });
    }
    await ensureHostedGroupOwnerMembershipTx(input.tx, {
      groupId: existing.id,
      memberId: container.ownerMemberId,
      now: input.now,
    });
    await grantHostedGroupMembershipProfileNameTx(input.tx, {
      groupRuntimeMemberId: container.memberId,
      memberId: container.ownerMemberId,
      now: input.now,
    });
    if (createdRequested.length > 0) {
      await mergeHostedGroupRequestedProjectionsTx(input.tx, {
        groupId: existing.id,
        requestedVaultShareProjectionScopes: createdRequested,
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
      joinPolicyJson: createdRequested.length > 0
        ? toHostedGroupJoinPolicyJson({
            ...emptyHostedGroupJoinPolicy(),
            requestedVaultShareProjectionKinds: createdRequested.map((scope) => scope.projectionKind),
            requestedVaultShareProjectionScopes: createdRequested,
          })
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
  await grantHostedGroupMembershipProfileNameTx(input.tx, {
    groupRuntimeMemberId: container.memberId,
    memberId: container.ownerMemberId,
    now: input.now,
  });
  await grantHostedGroupMembershipEmailTx(input.tx, {
    groupRuntimeMemberId: container.memberId,
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

export async function updateHostedGroupDisplayNameByRuntimeMemberIdTx(input: {
  displayName: string;
  runtimeMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupSummary | null> {
  const displayName = normalizeNullableString(input.displayName)?.replace(/\s+/gu, " ") ?? null;
  if (!displayName) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_DISPLAY_NAME_REQUIRED",
      httpStatus: 400,
      message: "Hosted group display name is required.",
      retryable: false,
    });
  }
  if (displayName.length > 120) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_DISPLAY_NAME_TOO_LONG",
      httpStatus: 400,
      message: "Hosted group display name is too long.",
      retryable: false,
    });
  }

  const group = await input.tx.hostedGroup.findUnique({
    where: { runtimeMemberId: input.runtimeMemberId },
    select: { id: true },
  });
  if (!group) return null;

  await lockHostedGroupRow(input.tx, group.id);
  await input.tx.hostedGroup.update({
    where: { id: group.id },
    data: { displayName },
    select: { id: true },
  });
  return readHostedGroupSummaryById(input.tx, group.id);
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
  await revokeHostedGroupJoinOffersTx(input.tx, {
    groupId: group.id,
    now: input.now,
  });
  const updated = await input.tx.hostedGroup.update({
    where: { id: group.id },
    data: {
      joinCode: generateHostedGroupJoinCode(),
      joinCodeCreatedAt: input.now,
    },
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
  requestedVaultShareProjectionScopes?: readonly HostedVaultShareProjectionScope[] | null;
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
    requestedVaultShareProjectionKinds: input.requestedVaultShareProjectionKinds ?? [],
    requestedVaultShareProjectionScopes: input.requestedVaultShareProjectionScopes ?? null,
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
  const activeVaultShareProjectionScopes = input.memberId && group.runtimeMemberId
    ? await readActiveHostedVaultShareProjectionScopes({
        destinationMemberId: group.runtimeMemberId,
        grantorMemberId: input.memberId,
        prisma,
        projectionScopes: policy.requestedVaultShareProjectionScopes,
      })
    : [];

  return {
    activeVaultShareProjectionKinds: activeVaultShareProjectionScopes.map((scope) =>
      scope.projectionKind
    ),
    activeVaultShareProjectionScopes,
    displayName: group.displayName,
    id: group.id,
    kind: group.kind,
    memberCount: group._count.members,
    requestedVaultShareProjections: projectHostedVaultShareProjectionDisplays(
      policy.requestedVaultShareProjectionScopes,
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
  selectedVaultShareProjectionScopes?: readonly HostedVaultShareProjectionScope[] | null;
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
  return acceptHostedGroupJoinTx({
    additiveOnly: false,
    groupId: groupLookup.id,
    memberId: input.memberId,
    now: input.now,
    policyProjectionScopes: null,
    selectedVaultShareProjectionScopes:
      input.selectedVaultShareProjectionScopes
      ?? fixedProjectionKindsToScopes(input.selectedVaultShareProjectionKinds ?? []),
    tx: input.tx,
  });
}

export async function recordHostedGroupJoinOfferTx(input: {
  groupId: string;
  messageId: string | null;
  postedAt: Date;
  projectionKinds?: readonly HostedVaultShareProjectionKind[] | null;
  projectionScopes?: readonly HostedVaultShareProjectionScope[] | null;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupJoinOfferBindingTxResult> {
  const messageLookupKey = createHostedLinqMessageLookupKey(input.messageId);
  if (!messageLookupKey) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_JOIN_OFFER_MESSAGE_ID_REQUIRED",
      httpStatus: 502,
      message: "Could not bind this group offer to a provider message.",
      retryable: true,
    });
  }
  const projectionScopes = normalizeHostedVaultShareProjectionScopes(
    input.projectionScopes && input.projectionScopes.length > 0
      ? input.projectionScopes
      : fixedProjectionKindsToScopes(input.projectionKinds ?? []),
  );
  const projectionKinds = [...new Set(projectionScopes.map((scope) => scope.projectionKind))];
  await lockHostedGroupRow(input.tx, input.groupId);
  const group = await input.tx.hostedGroup.findUnique({
    where: { id: input.groupId },
    select: { joinCode: true },
  });
  if (!group?.joinCode) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_JOIN_OFFER_NOT_FOUND",
      httpStatus: 404,
      message: "This group offer is no longer active.",
      retryable: false,
    });
  }
  await input.tx.hostedGroupJoinOffer.create({
    data: {
      id: generateHostedGroupJoinOfferId(),
      groupId: input.groupId,
      messageIdSuffix: toHostedOnboardingLogIdSuffix(input.messageId),
      messageLookupKey,
      postedAt: input.postedAt,
      projectionKindsJson: toHostedGroupJoinOfferProjectionScopesJson(projectionScopes),
    },
  });

  return {
    groupId: input.groupId,
    messageIdSuffix: toHostedOnboardingLogIdSuffix(input.messageId),
    messageLookupKey,
    projectionKinds,
    projectionScopes,
  };
}

export async function acceptHostedGroupJoinOfferTx(input: {
  memberId: string;
  messageLookupKeyReadCandidates: readonly string[];
  now: Date;
  threadIdentityLookupKeyReadCandidates: readonly string[];
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupJoinOfferAcceptanceTxResult> {
  const messageLookupKeyReadCandidates = normalizeHostedGroupLookupKeyCandidates(
    input.messageLookupKeyReadCandidates,
  );
  const threadIdentityLookupKeyReadCandidates = normalizeHostedGroupLookupKeyCandidates(
    input.threadIdentityLookupKeyReadCandidates,
  );
  if (
    messageLookupKeyReadCandidates.length === 0
    || threadIdentityLookupKeyReadCandidates.length === 0
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_JOIN_OFFER_NOT_FOUND",
      httpStatus: 404,
      message: "This group offer is no longer active.",
      retryable: false,
    });
  }
  const offerLookup = await input.tx.hostedGroupJoinOffer.findFirst({
    where: {
      messageLookupKey: {
        in: messageLookupKeyReadCandidates,
      },
    },
    select: { groupId: true },
  });
  if (!offerLookup) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_JOIN_OFFER_NOT_FOUND",
      httpStatus: 404,
      message: "This group offer is no longer active.",
      retryable: false,
    });
  }
  await lockHostedGroupRow(input.tx, offerLookup.groupId);
  const offer = await input.tx.hostedGroupJoinOffer.findFirst({
    where: {
      messageLookupKey: {
        in: messageLookupKeyReadCandidates,
      },
      revokedAt: null,
    },
    select: {
      groupId: true,
      messageLookupKey: true,
      projectionKindsJson: true,
      revokedAt: true,
      group: {
        select: {
          id: true,
          joinCode: true,
          runtimeMemberId: true,
        },
      },
    },
  });
  if (!offer) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_JOIN_OFFER_REVOKED",
      httpStatus: 410,
      message: "This group offer has been revoked.",
      retryable: false,
    });
  }
  const group = offer.group;
  if (!group?.joinCode) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_JOIN_OFFER_NOT_FOUND",
      httpStatus: 404,
      message: "This group offer is no longer active.",
      retryable: false,
    });
  }
  if (!group.runtimeMemberId) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_NOT_ACTIVE",
      httpStatus: 410,
      message: "This group is no longer active.",
      retryable: false,
    });
  }
  const route = await input.tx.hostedThreadRoute.findFirst({
    where: {
      channel: "linq",
      containerMemberId: group.runtimeMemberId,
      threadIdentityLookupKey: {
        in: threadIdentityLookupKeyReadCandidates,
      },
    },
    select: { containerMemberId: true },
  });
  if (!route) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_JOIN_OFFER_NOT_FOUND",
      httpStatus: 404,
      message: "This group offer is no longer active.",
      retryable: false,
    });
  }

  const selectedVaultShareProjectionScopes = normalizeHostedVaultShareProjectionScopes(
    offer.projectionKindsJson,
  );
  const selectedVaultShareProjectionKinds = [
    ...new Set(selectedVaultShareProjectionScopes.map((scope) => scope.projectionKind)),
  ];
  const accepted = await acceptHostedGroupJoinTx({
    additiveOnly: true,
    groupId: group.id,
    memberId: input.memberId,
    now: input.now,
    policyProjectionScopes: selectedVaultShareProjectionScopes,
    selectedVaultShareProjectionScopes,
    tx: input.tx,
  });

  return {
    ...accepted,
    joinCode: group.joinCode,
    messageLookupKey: offer.messageLookupKey,
    selectedVaultShareProjectionKinds,
    selectedVaultShareProjectionScopes,
  };
}

function normalizeHostedGroupLookupKeyCandidates(
  values: readonly (string | null | undefined)[],
): string[] {
  return [...new Set(values
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0))];
}

async function revokeHostedGroupJoinOffersTx(
  tx: Prisma.TransactionClient,
  input: { groupId: string; now: Date },
): Promise<void> {
  await tx.hostedGroupJoinOffer.updateMany({
    where: {
      groupId: input.groupId,
      revokedAt: null,
    },
    data: {
      revokedAt: input.now,
    },
  });
}

async function acceptHostedGroupJoinTx(input: {
  additiveOnly: boolean;
  groupId: string;
  memberId: string;
  now: Date;
  policyProjectionScopes: readonly HostedVaultShareProjectionScope[] | null;
  selectedVaultShareProjectionScopes: readonly HostedVaultShareProjectionScope[];
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupJoinAcceptanceTxResult> {
  await lockHostedGroupRow(input.tx, input.groupId);
  const group = await input.tx.hostedGroup.findUnique({
    where: { id: input.groupId },
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

  const selected = normalizeHostedVaultShareProjectionScopes(
    input.selectedVaultShareProjectionScopes,
  );
  const requestedProjectionScopes = input.policyProjectionScopes
    ? normalizeHostedVaultShareProjectionScopes(input.policyProjectionScopes)
    : readHostedGroupJoinPolicy(group.joinPolicyJson).requestedVaultShareProjectionScopes;
  const requestedSet = new Set(
    requestedProjectionScopes.map((scope) => buildHostedVaultShareProjectionScopeKey(scope)),
  );
  const selectedSet = new Set(
    selected.map((scope) => buildHostedVaultShareProjectionScopeKey(scope)),
  );
  for (const projectionScope of selected) {
    if (!requestedSet.has(buildHostedVaultShareProjectionScopeKey(projectionScope))) {
      throw hostedOnboardingError({
        code: "HOSTED_GROUP_PERMISSION_NOT_REQUESTED",
        httpStatus: 400,
        message: "That permission was not requested by this group.",
      });
    }
  }
  // Membership itself binds to the durable group runtime, not just the
  // sharing branch: a stale link must not admit members after the group
  // runtime or owner loses active access.
  if (!group.runtimeMemberId) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_NOT_ACTIVE",
      httpStatus: 410,
      message: "This group is no longer active.",
    });
  }
  await assertHostedGroupRuntimeDestinationTx(input.tx, group.runtimeMemberId);
  // Joining always shares the typed profile display name, so the launch consent
  // gate applies to every join, not only joins that select health projections.
  await assertHostedLaunchRequiredConsentGranted({ memberId: input.memberId, prisma: input.tx });

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
  const grantedVaultShareProjectionScopes: HostedVaultShareProjectionScope[] = [];
  const revokedVaultShareProjectionScopes: HostedVaultShareProjectionScope[] = [];
  const vaultShareCleanupSignals: HostedVaultShareCleanupSignal[] = [];
  await grantHostedGroupMembershipProfileNameTx(input.tx, {
    groupRuntimeMemberId: group.runtimeMemberId,
    memberId: input.memberId,
    now: input.now,
  });
  grantedVaultShareProjectionKinds.push("profile-name.v0");
  grantedVaultShareProjectionScopes.push(hostedVaultShareProjectionKindToScope("profile-name.v0"));
  if (requestedProjectionScopes.length > 0) {
    for (const projectionScope of requestedProjectionScopes) {
      const projectionScopeKey = buildHostedVaultShareProjectionScopeKey(projectionScope);
      if (selectedSet.has(projectionScopeKey)) {
        await assertHostedGroupVaultShareGrantLimitTx(input.tx, {
          destinationMemberId: group.runtimeMemberId,
          grantorMemberId: input.memberId,
          projectionScope,
        });
        await grantHostedVaultShareTx({
          destinationMemberId: group.runtimeMemberId,
          grantorMemberId: input.memberId,
          now: input.now,
          projectionScope,
          tx: input.tx,
        });
        grantedVaultShareProjectionKinds.push(projectionScope.projectionKind);
        grantedVaultShareProjectionScopes.push(projectionScope);
      } else if (!input.additiveOnly) {
        const revoked = await revokeHostedVaultSharesWithCleanupTx({
          destinationMemberId: group.runtimeMemberId,
          grantorMemberId: input.memberId,
          now: input.now,
          projectionScopes: [projectionScope],
          tx: input.tx,
        });
        vaultShareCleanupSignals.push(...revoked.cleanupSignals);
        if (revoked.revokedCount > 0) {
          revokedVaultShareProjectionKinds.push(projectionScope.projectionKind);
          revokedVaultShareProjectionScopes.push(projectionScope);
        }
      }
    }
  }

  return {
    alreadyMember,
    grantedVaultShareProjectionKinds,
    grantedVaultShareProjectionScopes,
    groupId: group.id,
    membershipId,
    revokedVaultShareProjectionKinds,
    revokedVaultShareProjectionScopes,
    vaultShareCleanupSignals,
  };
}

export async function revokeHostedGroupMemberEmailShareTx(input: {
  groupRuntimeMemberId: string;
  memberId: string;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupMemberEmailShareRevocationTxResult> {
  const group = await input.tx.hostedGroup.findUnique({
    where: { runtimeMemberId: input.groupRuntimeMemberId },
    select: { id: true, runtimeMemberId: true },
  });
  if (!group?.runtimeMemberId) {
    return {
      kind: "group_not_found",
      revokedCount: 0,
      vaultShareCleanupSignals: [],
    };
  }
  await lockHostedGroupRow(input.tx, group.id);
  await lockHostedMemberRow(input.tx, input.memberId);
  const membership = await input.tx.hostedGroupMember.findUnique({
    where: {
      groupId_memberId: {
        groupId: group.id,
        memberId: input.memberId,
      },
    },
    select: { id: true },
  });
  if (!membership) {
    return {
      kind: "not_group_member",
      revokedCount: 0,
      vaultShareCleanupSignals: [],
    };
  }

  const revoked = await revokeHostedVaultSharesWithCleanupTx({
    destinationMemberId: group.runtimeMemberId,
    grantorMemberId: input.memberId,
    now: input.now,
    projectionScopes: [hostedVaultShareProjectionKindToScope("group-email.v0")],
    tx: input.tx,
  });

  return {
    groupId: group.id,
    kind: "ok",
    revokedCount: revoked.revokedCount,
    vaultShareCleanupSignals: revoked.cleanupSignals,
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
    requestedVaultShareProjectionScopes: readonly HostedVaultShareProjectionScope[];
  },
): Promise<void> {
  const group = await tx.hostedGroup.findUnique({
    where: { id: input.groupId },
    select: { joinPolicyJson: true, runtimeMemberId: true },
  });
  if (!group) throw hostedOnboardingError({ code: "HOSTED_GROUP_NOT_FOUND", httpStatus: 404, message: "Hosted group not found." });
  if (input.requestedVaultShareProjectionScopes.length > 0) {
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
    requestedVaultShareProjectionScopes: input.requestedVaultShareProjectionScopes,
  });
  await tx.hostedGroup.update({
    where: { id: input.groupId },
    data: {
      joinPolicyJson: merged.requestedVaultShareProjectionScopes.length > 0
        ? toHostedGroupJoinPolicyJson(merged)
        : undefined,
    },
  });
}

function toHostedGroupJoinPolicyJson(policy: ReturnType<typeof mergeHostedGroupJoinPolicy>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(policy)) as Prisma.InputJsonValue;
}

function toHostedGroupJoinOfferProjectionScopesJson(
  projectionScopes: readonly HostedVaultShareProjectionScope[],
): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(normalizeHostedVaultShareProjectionScopes(projectionScopes))) as Prisma.InputJsonValue;
}

function fixedProjectionKindsToScopes(
  projectionKinds: readonly HostedVaultShareProjectionKind[],
): HostedVaultShareProjectionScope[] {
  return normalizeHostedVaultShareProjectionKinds(projectionKinds)
    .filter(isHostedVaultShareFixedProjectionKind)
    .map((projectionKind) => hostedVaultShareProjectionKindToScope(projectionKind));
}

function parseHostedGroupVaultShareRowProjectionScope(row: {
  projectionKind: string;
  projectionScopeJson: unknown;
  projectionScopeKey: string;
}): HostedVaultShareProjectionScope | null {
  try {
    const scope = parseHostedVaultShareProjectionScope(
      row.projectionScopeJson ?? row.projectionKind,
      "Hosted group vault-share row projection scope",
    );
    if (
      scope.projectionKind !== row.projectionKind
      || buildHostedVaultShareProjectionScopeKey(scope) !== row.projectionScopeKey
    ) {
      return null;
    }
    return scope;
  } catch {
    return null;
  }
}

/**
 * Group membership implies exactly one automatic share: the member's typed profile
 * display name, so the group runtime can introduce members without re-asking anyone.
 * Health projections stay individually selected on the join page.
 */
async function grantHostedGroupMembershipProfileNameTx(
  tx: Prisma.TransactionClient,
  input: { groupRuntimeMemberId: string; memberId: string; now: Date },
): Promise<void> {
  await grantHostedGroupMembershipProjectionTx(tx, {
    ...input,
    projectionScope: hostedVaultShareProjectionKindToScope("profile-name.v0"),
  });
}

async function grantHostedGroupMembershipEmailTx(
  tx: Prisma.TransactionClient,
  input: { groupRuntimeMemberId: string; memberId: string; now: Date },
): Promise<void> {
  await grantHostedGroupMembershipProjectionTx(tx, {
    ...input,
    projectionScope: hostedVaultShareProjectionKindToScope("group-email.v0"),
  });
}

async function grantHostedGroupMembershipProjectionTx(
  tx: Prisma.TransactionClient,
  input: {
    groupRuntimeMemberId: string;
    memberId: string;
    now: Date;
    projectionScope: HostedVaultShareProjectionScope;
  },
): Promise<void> {
  await assertHostedGroupVaultShareGrantLimitTx(tx, {
    destinationMemberId: input.groupRuntimeMemberId,
    grantorMemberId: input.memberId,
    projectionScope: input.projectionScope,
  });
  await grantHostedVaultShareTx({
    destinationMemberId: input.groupRuntimeMemberId,
    grantorMemberId: input.memberId,
    now: input.now,
    projectionScope: input.projectionScope,
    tx,
  });
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
      runtimeMemberId: true,
      members: {
        orderBy: { createdAt: "asc" },
        select: { memberId: true, role: true },
      },
    },
  });
  if (!group) return null;
  const policy = readHostedGroupJoinPolicy(group.joinPolicyJson);
  return {
    displayName: group.displayName,
    id: group.id,
    kind: group.kind,
    memberCount: group.members.length,
    members: await readHostedGroupMemberRoster(prisma, {
      members: group.members,
      runtimeMemberId: group.runtimeMemberId,
    }),
    requestedVaultShareProjectionKinds: policy.requestedVaultShareProjectionKinds,
    requestedVaultShareProjectionScopes: policy.requestedVaultShareProjectionScopes,
    status: "active",
  };
}

/**
 * Server-derived roster that joins the group's three identity namespaces for the
 * runtime: membership (member id + role), the chat layer (the member's verified
 * phone handle), and data sharing (which projection kinds this member currently
 * grants to this group's runtime). Derived on read; no new persisted state.
 */
async function readHostedGroupMemberRoster(
  prisma: HostedGroupsReadClient,
  input: {
    members: readonly { memberId: string; role: string }[];
    runtimeMemberId: string | null;
  },
): Promise<HostedGroupMemberRosterEntry[]> {
  if (input.members.length === 0) {
    return [];
  }

  const grantsByMemberId = new Map<string, HostedVaultShareProjectionScope[]>();
  if (input.runtimeMemberId) {
    const grants = await prisma.hostedVaultShare.findMany({
      where: {
        destinationMemberId: input.runtimeMemberId,
        grantorMemberId: { in: input.members.map((member) => member.memberId) },
        status: "granted",
      },
      select: {
        grantorMemberId: true,
        projectionKind: true,
        projectionScopeJson: true,
        projectionScopeKey: true,
      },
    });
    for (const grant of grants) {
      const scope = parseHostedGroupVaultShareRowProjectionScope(grant);
      if (!scope) {
        continue;
      }
      const scopes = grantsByMemberId.get(grant.grantorMemberId) ?? [];
      scopes.push(scope);
      grantsByMemberId.set(grant.grantorMemberId, scopes);
    }
  }

  return await Promise.all(input.members.map(async (member) => {
    const identity = await readHostedMemberIdentity({
      memberId: member.memberId,
      prisma,
    });
    const grantedVaultShareProjectionScopes =
      grantsByMemberId.get(member.memberId) ?? [];
    return {
      grantedVaultShareProjectionKinds: [
        ...new Set(grantedVaultShareProjectionScopes.map((scope) => scope.projectionKind)),
      ],
      grantedVaultShareProjectionScopes,
      handle: identity?.phoneNumber ?? null,
      memberId: member.memberId,
      role: member.role,
    };
  }));
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
    projectionScope: HostedVaultShareProjectionScope;
  },
): Promise<void> {
  const projectionScopeKey = buildHostedVaultShareProjectionScopeKey(input.projectionScope);
  const existing = await tx.hostedVaultShare.findUnique({
    where: {
      grantorMemberId_projectionScopeKey_destinationMemberId: {
        destinationMemberId: input.destinationMemberId,
        grantorMemberId: input.grantorMemberId,
        projectionScopeKey,
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
      projectionScopeKey,
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
      projectionScopeKey,
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
