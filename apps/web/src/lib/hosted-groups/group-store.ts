import "server-only";

import { resolveDeviceConnectSourceById } from "@murphai/device-syncd/connect-config";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  HOSTED_RUNTIME_GROUP_MEMBERSHIPS_MAX,
  HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_MEMBERS,
  type HostedRuntimeGroupSharedReadResult,
  type HostedRuntimeGroupSharedRecord,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_MAX_SOURCES,
  HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_RECORD_KEY,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
  hostedVaultShareProjectionKindToScope,
  isHostedVaultShareFixedProjectionKind,
  parseHostedVaultShareDeliveryRecord,
  parseHostedVaultShareProjectionScope,
  type HostedVaultShareDeviceSyncSource,
  type HostedVaultShareDeviceSyncSourceStatus,
  type HostedVaultShareProjectionKind,
  type HostedVaultShareProjectionScope,
  type HostedVaultShareSelectableProjectionScope,
} from "@murphai/hosted-execution/vault-share";

import {
  formatHostedDeviceSyncSourceLabel,
} from "../device-sync/provider-label";
import {
  assertHostedHistoricalLaunchConsentGranted,
  assertHostedLaunchRequiredConsentGranted,
  hostedHealthDataConsentNotRevokedWhere,
} from "../legal/consent";
import { hasHostedRuntimeActiveAccess } from "../hosted-mailbox/runtime-access";
import {
  createHostedEmailLookupKeyReadCandidates,
  createHostedPhoneLookupKeyReadCandidates,
  createHostedTelegramUserLookupKeyReadCandidates,
} from "../hosted-onboarding/contact-privacy";
import {
  createHostedGroupOfferMessageLookupKey,
  readHostedGroupOfferMessageIdSuffix,
  type HostedGroupOfferChannel,
  type HostedGroupOfferMessageBinding,
} from "./offer-message-binding";
import { assertHostedMemberNotSuspended } from "../hosted-onboarding/entitlement";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { activeHostedMemberAccessWhere } from "../hosted-onboarding/member-access";
import {
  generateHostedGroupId,
  generateHostedGroupJoinOfferGeneration,
  generateHostedGroupJoinOfferId,
  generateHostedGroupMemberId,
  generateHostedGroupJoinCode,
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
} from "../hosted-onboarding/shared";
import { normalizeNullableString } from "../primitives";
import { getPrisma } from "../prisma";
import {
  grantHostedVaultShareTx,
  readActiveHostedVaultShareProjectionScopes,
  revokeHostedVaultSharesTx,
} from "../hosted-vault-share/share-grant-store";
import {
  decryptHostedVaultShareProjectionSnapshots,
  type HostedVaultShareProjectionSnapshotEntry,
} from "../hosted-vault-share/projection-snapshot";
import { parseHostedVaultShareRowProjectionScope } from "../hosted-vault-share/row-projection-scope";
import {
  includeLegacyHostedGroupSleepProjectionScopes,
  includeSourceAwareHostedGroupSleepProjectionScopes,
  legacyHostedGroupSleepProjectionScope,
  mergeHostedGroupJoinPolicy,
  normalizeHostedVaultShareProjectionKinds,
  normalizeHostedVaultShareProjectionScopes,
  projectHostedVaultShareProjectionDisplays,
  readHostedGroupJoinPolicy,
  sourceAwareHostedGroupSleepProjectionScope,
  type HostedVaultShareProjectionDisplay,
} from "./join-policy";
import {
  appendHostedGroupJoinConfirmationTx,
  type HostedGroupJoinConfirmationOrigin,
  type HostedGroupJoinConfirmationSignal,
} from "./group-join-confirmation";
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

export interface HostedGroupMembershipReadSummary {
  displayName: string | null;
  grantedVaultShareProjectionScopes: HostedVaultShareProjectionScope[];
  kind: string;
  memberCount: number;
  membershipId: string;
  ownerJoinCode: string | null;
  requestedVaultShareProjectionScopes: HostedVaultShareProjectionScope[];
  role: string;
  runtimeMemberId: string | null;
}

export interface HostedGroupMembershipReadResult {
  memberships: HostedGroupMembershipReadSummary[];
  truncated: boolean;
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
  viewerCanLeave: boolean;
  viewerMembershipId: string | null;
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
  joinConfirmationSignal?: HostedGroupJoinConfirmationSignal;
}

export interface HostedGroupJoinOfferBindingTxResult {
  groupId: string;
  messageIdSuffix: string | null;
  messageLookupKey: string;
  projectionKinds: HostedVaultShareProjectionKind[];
  projectionScopes: HostedVaultShareProjectionScope[];
}

export type HostedGroupJoinOfferPostPreparation =
  | { kind: "active_offer" }
  | {
      offerGeneration: string;
      joinCode: string;
      kind: "post";
    }
  | { kind: "unavailable" };

export interface HostedGroupJoinOfferAcceptanceTxResult
  extends HostedGroupJoinAcceptanceTxResult {
  joinCode: string;
  messageLookupKey: string;
  selectedVaultShareProjectionKinds: HostedVaultShareProjectionKind[];
  selectedVaultShareProjectionScopes: HostedVaultShareProjectionScope[];
}

export interface HostedGroupJoinOfferTarget {
  displayName: string | null;
  groupId: string;
  joinCode: string;
  messageLookupKey: string;
  offerId: string;
  projectionKindsJson: Prisma.JsonValue;
  runtimeMemberId: string;
}

export type HostedGroupMemberEmailShareRevocationTxResult =
  | {
      groupId: string;
      kind: "ok";
      revokedCount: number;
    }
  | {
      kind: "group_not_found" | "not_group_member";
      revokedCount: 0;
    };

export type HostedGroupMemberLeaveTxResult =
  | { kind: "left" }
  | { kind: "already_left" | "group_not_found" | "owner_cannot_leave" };

export type HostedGroupMemberLeaveSelector =
  | { joinCode: string; membershipId?: never }
  | { joinCode?: never; membershipId: string };

export const HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_PER_GRANTOR_PROJECTION = 25;
export const HOSTED_GROUP_VAULT_SHARE_DESTINATION_LIMIT_PER_PROJECTION = 100;
export const HOSTED_GROUP_ACTIVE_JOIN_OFFER_SCAN_MAX = 64;

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
    await replaceHostedGroupRequestedProjectionsTx(input.tx, {
      groupId: existing.id,
      now: input.now,
      requestedVaultShareProjectionScopes: requested,
    });
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

  const requestedPolicy = mergeHostedGroupJoinPolicy({
    existing: null,
    offerGeneration: generateHostedGroupJoinOfferGeneration(),
    requestedVaultShareProjectionScopes: requested,
  });
  const created = await input.tx.hostedGroup.create({
    data: {
      id: generateHostedGroupId(),
      displayName: normalizeHostedGroupDisplayName(input.displayName ?? null),
      joinPolicyJson: toHostedGroupJoinPolicyJson(requestedPolicy),
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
  const groupId = await readHostedGroupIdByRuntimeMemberId({
    prisma,
    runtimeMemberId: input.runtimeMemberId,
  });
  return groupId ? readHostedGroupSummaryById(prisma, groupId) : null;
}

const HOSTED_GROUP_SHARED_READ_PROFILE_NAME_SCOPE =
  hostedVaultShareProjectionKindToScope("profile-name.v0");
const HOSTED_GROUP_SHARED_READ_PROFILE_NAME_SCOPE_KEY =
  buildHostedVaultShareProjectionScopeKey(
    HOSTED_GROUP_SHARED_READ_PROFILE_NAME_SCOPE,
  );
const HOSTED_GROUP_SHARED_READ_DEVICE_SCOPE_KEY =
  buildHostedVaultShareProjectionScopeKey(
    hostedVaultShareProjectionKindToScope(
      HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_PROJECTION_KIND,
    ),
  );
const HOSTED_GROUP_SHARED_READ_SELECTABLE_SCOPE_KEYS = new Set(
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.map(
    buildHostedVaultShareProjectionScopeKey,
  ),
);
// Three requested scopes plus profile name, with at most two additional v1
// sleep counterparts needed to let frozen v0 workflows consume a v1 grant's
// narrower canonical value.
const HOSTED_GROUP_SHARED_READ_MAX_GRANTS =
  HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_MEMBERS * 6;
const HOSTED_GROUP_SHARED_READ_MAX_DEVICE_CONNECTIONS =
  HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_MEMBERS
  * HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_MAX_SOURCES;

interface HostedGroupSharedDeviceConnectionSnapshot {
  lastSyncCompletedAt: Date | null;
  lastSyncErrorAt: Date | null;
  provider: string;
  setupPhase: string | null;
  sources: Array<{
    sourceProviderSlug: string;
    status: string;
    updatedAt: Date;
  }>;
  status: string;
  updatedAt: Date;
  userId: string;
}

interface HostedGroupSharedMemberSource {
  id: string;
  member: {
    emailAuthorization: {
      verifiedEmailLookupKey: string | null;
      verifiedEmailVerifiedAt: Date | null;
    } | null;
    identity: {
      phoneLookupKey: string | null;
      phoneNumberVerifiedAt: Date | null;
    } | null;
    routing?: {
      telegramUserLookupKey: string | null;
    } | null;
  };
  memberId: string;
}

interface HostedGroupSharedProjectionGrantEntry {
  destinationMemberId: string;
  grantedAt: Date;
  grantorMemberId: string;
  id: string;
  projectionKind: string;
  projectionScope: HostedVaultShareProjectionScope;
  projectionScopeKey: string;
}

interface HostedGroupSharedProjectionSnapshotEntry
  extends HostedGroupSharedProjectionGrantEntry {
  ciphertext: string | null | undefined;
}

type HostedGroupSharedReadCapture =
  | {
      status: "ok";
      connections: HostedGroupSharedDeviceConnectionSnapshot[];
      grants: HostedGroupSharedProjectionGrantEntry[];
      members: Array<{
        currentTurnHandles: string[];
        memberId: string;
        participantId: string;
      }>;
      shares: HostedGroupSharedProjectionSnapshotEntry[];
    }
  | { status: "none" }
  | { status: "unavailable"; unavailableReason: string };

type HostedGroupParticipantDisplayNamesCapture =
  | {
      matchedMembers: Array<{
        memberId: string;
        senderHandles: string[];
      }>;
      shares: HostedVaultShareProjectionSnapshotEntry[];
      status: "ok";
      unmatchedSenderHandles: string[];
    }
  | { status: "unavailable"; unavailableReason: string };

export type HostedGroupParticipantDisplayNameCandidatesResult =
  | {
      candidates: Array<{
        profileDisplayName: string | null;
        senderHandle: string;
      }>;
      status: "ok";
    }
  | { status: "unavailable"; unavailableReason: string };

/**
 * Resolves exact current-turn Linq handles against current, unsuspended group
 * members and decrypts only membership-implied profile-name snapshots. A
 * uniquely matched member without a profile name and a handle with no member
 * match remain explicit candidates for the existing owner-address-book
 * advisory boundary. Ambiguous member matches remain excluded. This
 * intentionally does not traverse selectable health grants or device state.
 */
export async function readHostedGroupParticipantDisplayNameCandidatesByRuntimeMemberId(
  input: {
    linqSenderHandles: readonly string[];
    prisma?: PrismaClient;
    runtimeMemberId: string;
  },
): Promise<HostedGroupParticipantDisplayNameCandidatesResult> {
  const prisma = input.prisma ?? getPrisma();
  const capture =
    await prisma.$transaction<HostedGroupParticipantDisplayNamesCapture>(
      async (tx) => {
        const group = await tx.hostedGroup.findUnique({
          where: { runtimeMemberId: input.runtimeMemberId },
          select: {
            members: {
              where: {
                joinedAt: { not: null },
              },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              take: HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_MEMBERS + 1,
              select: {
                id: true,
                member: {
                  select: {
                    emailAuthorization: {
                      select: {
                        verifiedEmailLookupKey: true,
                        verifiedEmailVerifiedAt: true,
                      },
                    },
                    identity: {
                      select: {
                        phoneLookupKey: true,
                        phoneNumberVerifiedAt: true,
                      },
                    },
                    suspendedAt: true,
                  },
                },
                memberId: true,
              },
            },
          },
        });
        if (
          !await hasHostedRuntimeActiveAccess(input.runtimeMemberId, {
            prisma: tx,
          })
        ) {
          return {
            status: "unavailable",
            unavailableReason: "runtime_inactive",
          };
        }
        const groupMembers = group?.members ?? [];
        if (
          groupMembers.length > HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_MEMBERS
        ) {
          return {
            status: "unavailable",
            unavailableReason: "participant_names_snapshot_too_large",
          };
        }

        const {
          handlesByParticipantId,
          unmatchedSenderHandles,
        } = matchHostedGroupCurrentTurnLinqSenderHandles(
          groupMembers,
          input.linqSenderHandles,
        );
        const matchedMembers = groupMembers.flatMap((member) => {
          if (member.member.suspendedAt !== null) {
            return [];
          }
          const senderHandles = handlesByParticipantId.get(member.id);
          return senderHandles
            ? [{ memberId: member.memberId, senderHandles }]
            : [];
        });
        const memberIds = matchedMembers.map((member) => member.memberId);
        const rows = memberIds.length === 0
          ? []
          : await tx.hostedVaultShare.findMany({
              orderBy: [{ grantorMemberId: "asc" }, { id: "asc" }],
              select: {
                destinationMemberId: true,
                grantorMemberId: true,
                id: true,
                projectionKind: true,
                projectionScopeJson: true,
                projectionScopeKey: true,
                projectionSnapshotCiphertext: true,
              },
              take: memberIds.length + 1,
              where: {
                destinationMemberId: input.runtimeMemberId,
                grantorMemberId: { in: memberIds },
                projectionScopeKey:
                  HOSTED_GROUP_SHARED_READ_PROFILE_NAME_SCOPE_KEY,
                status: "granted",
              },
            });
        if (rows.length > memberIds.length) {
          return {
            status: "unavailable",
            unavailableReason: "participant_names_authority_invalid",
          };
        }

        const matchedMemberIds = new Set(memberIds);
        const shareMemberIds = new Set<string>();
        const shares: HostedVaultShareProjectionSnapshotEntry[] = [];
        for (const row of rows) {
          const projectionScope = parseHostedVaultShareRowProjectionScope(row);
          if (
            !projectionScope
            || row.destinationMemberId !== input.runtimeMemberId
            || !matchedMemberIds.has(row.grantorMemberId)
            || row.projectionScopeKey
              !== HOSTED_GROUP_SHARED_READ_PROFILE_NAME_SCOPE_KEY
            || projectionScope.projectionKind !== "profile-name.v0"
            || shareMemberIds.has(row.grantorMemberId)
          ) {
            return {
              status: "unavailable",
              unavailableReason: "participant_names_authority_invalid",
            };
          }
          shareMemberIds.add(row.grantorMemberId);
          shares.push({
            ciphertext: row.projectionSnapshotCiphertext,
            destinationMemberId: row.destinationMemberId,
            grantorMemberId: row.grantorMemberId,
            id: row.id,
            projectionKind: row.projectionKind,
            projectionScope,
            projectionScopeKey: row.projectionScopeKey,
          });
        }
        return {
          matchedMembers,
          shares,
          status: "ok",
          unmatchedSenderHandles,
        };
      },
      {
        ...HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );
  if (capture.status === "unavailable") {
    return capture;
  }

  try {
    const snapshots = await decryptHostedVaultShareProjectionSnapshots({
      entries: capture.shares,
      prisma,
    });
    const displayNamesByMemberId = new Map<string, string>();
    for (const [index, share] of capture.shares.entries()) {
      const records = snapshots[index];
      if (records === undefined || records === null) {
        throw new Error("Hosted group participant name snapshot is missing.");
      }
      const displayName = readHostedGroupSharedProfileName(records);
      if (displayName) {
        displayNamesByMemberId.set(share.grantorMemberId, displayName);
      }
    }
    return {
      candidates: [
        ...capture.matchedMembers.flatMap((member) =>
          member.senderHandles.map((senderHandle) => ({
            profileDisplayName:
              displayNamesByMemberId.get(member.memberId) ?? null,
            senderHandle,
          }))
        ),
        ...capture.unmatchedSenderHandles.map((senderHandle) => ({
          profileDisplayName: null,
          senderHandle,
        })),
      ],
      status: "ok",
    };
  } catch {
    return {
      status: "unavailable",
      unavailableReason: "participant_names_unavailable",
    };
  }
}

/**
 * Captures current group membership, unsuspended consented grants, encrypted snapshots
 * readable under current access, and only the narrow device connection evidence
 * authorized by a readable device-status grant in one repeatable-read transaction.
 * Snapshot decryption happens after the transaction so key access cannot extend the
 * database authority window.
 */
export async function readHostedGroupSharedDataByRuntimeMemberId(input: {
  linqSenderHandles?: readonly string[];
  prisma?: PrismaClient;
  telegramSenderHandles?: readonly string[];
  projectionScopes: readonly HostedVaultShareSelectableProjectionScope[];
  runtimeMemberId: string;
}): Promise<HostedRuntimeGroupSharedReadResult> {
  const prisma = input.prisma ?? getPrisma();
  const projectionScopes = parseHostedGroupSharedReadProjectionScopes(
    input.projectionScopes,
  );
  const requestedProjectionScopeKeys = projectionScopes.map(
    buildHostedVaultShareProjectionScopeKey,
  );
  const authorityProjectionScopeKeys = includeSourceAwareHostedGroupSleepProjectionScopes(
    projectionScopes,
  ).map(buildHostedVaultShareProjectionScopeKey);
  const authorityScopeKeys = [
    ...authorityProjectionScopeKeys,
    HOSTED_GROUP_SHARED_READ_PROFILE_NAME_SCOPE_KEY,
  ];
  const now = new Date();

  const capture = await prisma.$transaction<HostedGroupSharedReadCapture>(
    async (tx) => {
      const group = await tx.hostedGroup.findUnique({
        where: { runtimeMemberId: input.runtimeMemberId },
        select: {
          members: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_MEMBERS + 1,
            select: {
              id: true,
              member: {
                select: {
                  emailAuthorization: {
                    select: {
                      verifiedEmailLookupKey: true,
                      verifiedEmailVerifiedAt: true,
                    },
                  },
                  identity: {
                    select: {
                      phoneLookupKey: true,
                      phoneNumberVerifiedAt: true,
                    },
                  },
                  routing: {
                    select: {
                      telegramUserLookupKey: true,
                    },
                  },
                },
              },
              memberId: true,
            },
          },
        },
      });
      if (!group) {
        return { status: "none" };
      }
      if (!await hasHostedRuntimeActiveAccess(input.runtimeMemberId, { prisma: tx })) {
        return { status: "unavailable", unavailableReason: "runtime_inactive" };
      }

      if (group.members.length > HOSTED_RUNTIME_GROUP_SHARED_READ_MAX_MEMBERS) {
        return {
          status: "unavailable",
          unavailableReason: "shared_data_snapshot_too_large",
        };
      }
      const currentTurnHandlesByParticipantId =
        matchHostedGroupCurrentTurnSenderHandles(group.members, {
          linqSenderHandles: input.linqSenderHandles ?? [],
          telegramSenderHandles: input.telegramSenderHandles ?? [],
        });
      const members = group.members.map((member) => ({
        currentTurnHandles:
          currentTurnHandlesByParticipantId.get(member.id) ?? [],
        memberId: member.memberId,
        participantId: member.id,
      }));

      const memberIds = members.map((member) => member.memberId);
      const grantRows = memberIds.length === 0
        ? []
        : await tx.hostedVaultShare.findMany({
            orderBy: [
              { grantorMemberId: "asc" },
              { projectionScopeKey: "asc" },
              { id: "asc" },
            ],
            select: {
              destinationMemberId: true,
              grantedAt: true,
              grantorMemberId: true,
              id: true,
              projectionKind: true,
              projectionScopeJson: true,
              projectionScopeKey: true,
            },
            take: HOSTED_GROUP_SHARED_READ_MAX_GRANTS + 1,
            where: {
              destinationMemberId: input.runtimeMemberId,
              grantor: {
                AND: [
                  { suspendedAt: null },
                  hostedHealthDataConsentNotRevokedWhere(),
                ],
              },
              grantorMemberId: { in: memberIds },
              projectionScopeKey: { in: authorityScopeKeys },
              status: "granted",
            },
          });
      if (grantRows.length > HOSTED_GROUP_SHARED_READ_MAX_GRANTS) {
        return {
          status: "unavailable",
          unavailableReason: "shared_data_snapshot_too_large",
        };
      }

      const grants: HostedGroupSharedProjectionGrantEntry[] = [];
      for (const row of grantRows) {
        const projectionScope = parseHostedVaultShareRowProjectionScope(row);
        if (!projectionScope) {
          return {
            status: "unavailable",
            unavailableReason: "shared_data_authority_invalid",
          };
        }
        grants.push({
          destinationMemberId: row.destinationMemberId,
          grantedAt: row.grantedAt,
          grantorMemberId: row.grantorMemberId,
          id: row.id,
          projectionKind: row.projectionKind,
          projectionScope,
          projectionScopeKey: row.projectionScopeKey,
        });
      }

      const snapshotRows = grants.length === 0
        ? []
        : await tx.hostedVaultShare.findMany({
            orderBy: [{ id: "asc" }],
            select: {
              id: true,
              projectionSnapshotCiphertext: true,
            },
            take: HOSTED_GROUP_SHARED_READ_MAX_GRANTS + 1,
            where: {
              grantor: {
                AND: [
                  activeHostedMemberAccessWhere(),
                  hostedHealthDataConsentNotRevokedWhere(),
                ],
              },
              id: { in: grants.map((grant) => grant.id) },
            },
          });
      if (snapshotRows.length > HOSTED_GROUP_SHARED_READ_MAX_GRANTS) {
        return {
          status: "unavailable",
          unavailableReason: "shared_data_snapshot_too_large",
        };
      }
      const grantsById = new Map(grants.map((grant) => [grant.id, grant]));
      const shares: HostedGroupSharedProjectionSnapshotEntry[] = [];
      const deviceMemberIds = new Set<string>();
      for (const row of snapshotRows) {
        const grant = grantsById.get(row.id);
        if (!grant) {
          return {
            status: "unavailable",
            unavailableReason: "shared_data_authority_invalid",
          };
        }
        shares.push({
          ...grant,
          ciphertext: row.projectionSnapshotCiphertext,
        });
        if (grant.projectionScopeKey === HOSTED_GROUP_SHARED_READ_DEVICE_SCOPE_KEY) {
          deviceMemberIds.add(grant.grantorMemberId);
        }
      }

      const deviceMemberIdList = [...deviceMemberIds];
      const connections = deviceMemberIdList.length === 0
        ? []
        : await tx.deviceConnection.findMany({
            orderBy: [
              { userId: "asc" },
              { connectedAt: "asc" },
              { createdAt: "asc" },
              { id: "asc" },
            ],
            select: {
              lastSyncCompletedAt: true,
              lastSyncErrorAt: true,
              provider: true,
              setupPhase: true,
              sources: {
                orderBy: [
                  { lastSeenAt: "asc" },
                  { createdAt: "asc" },
                  { id: "asc" },
                  { sourceProviderSlug: "asc" },
                ],
                select: {
                  sourceProviderSlug: true,
                  status: true,
                  updatedAt: true,
                },
                take: HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_MAX_SOURCES + 1,
              },
              status: true,
              updatedAt: true,
              userId: true,
            },
            take: HOSTED_GROUP_SHARED_READ_MAX_DEVICE_CONNECTIONS + 1,
            where: { userId: { in: deviceMemberIdList } },
          });
      if (
        connections.length > HOSTED_GROUP_SHARED_READ_MAX_DEVICE_CONNECTIONS
        || connections.some((connection) =>
          connection.sources.length
          > HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_MAX_SOURCES
        )
      ) {
        return {
          status: "unavailable",
          unavailableReason: "shared_data_snapshot_too_large",
        };
      }

      return { connections, grants, members, shares, status: "ok" };
    },
    {
      ...HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    },
  );

  if (capture.status === "none") {
    return { members: [], requestedProjectionScopeKeys, status: "none" };
  }
  if (capture.status === "unavailable") {
    return capture;
  }

  try {
    const encryptedShares = capture.shares.filter((share) =>
      share.projectionScopeKey !== HOSTED_GROUP_SHARED_READ_DEVICE_SCOPE_KEY
    );
    const decryptedSnapshots = await decryptHostedVaultShareProjectionSnapshots({
      entries: encryptedShares,
      prisma,
    });
    const recordsByMemberAndScope = new Map<
      string,
      Map<string, HostedRuntimeGroupSharedRecord[] | null>
    >();
    for (const [index, share] of encryptedShares.entries()) {
      const snapshot = decryptedSnapshots[index];
      if (snapshot === undefined) {
        throw new Error("Hosted group shared snapshot result is missing.");
      }
      const records = snapshot?.map(({ data, occurredAt, recordKey }) => ({
        data,
        occurredAt,
        recordKey,
      })) ?? null;
      const memberRecords = recordsByMemberAndScope.get(share.grantorMemberId)
        ?? new Map<string, HostedRuntimeGroupSharedRecord[] | null>();
      memberRecords.set(share.projectionScopeKey, records);
      recordsByMemberAndScope.set(share.grantorMemberId, memberRecords);
    }

    const readableGrantIds = new Set(capture.shares.map((share) => share.id));
    const grantsByMember = new Map<
      string,
      Map<string, HostedGroupSharedProjectionGrantEntry>
    >();
    for (const grant of capture.grants) {
      const memberGrants = grantsByMember.get(grant.grantorMemberId)
        ?? new Map<string, HostedGroupSharedProjectionGrantEntry>();
      if (memberGrants.has(grant.projectionScopeKey)) {
        throw new Error("Hosted group shared authority contains duplicate grants.");
      }
      memberGrants.set(grant.projectionScopeKey, grant);
      grantsByMember.set(grant.grantorMemberId, memberGrants);
    }

    const connectionsByMember = new Map<string, HostedGroupSharedDeviceConnectionSnapshot[]>();
    for (const connection of capture.connections) {
      const connections = connectionsByMember.get(connection.userId) ?? [];
      connections.push(connection);
      connectionsByMember.set(connection.userId, connections);
    }

    const members = capture.members.map(({
      currentTurnHandles,
      memberId,
      participantId,
    }) => {
      const memberGrants = grantsByMember.get(memberId);
      const storedRecords = recordsByMemberAndScope.get(memberId);
      const profileRecords = storedRecords?.get(
        HOSTED_GROUP_SHARED_READ_PROFILE_NAME_SCOPE_KEY,
      ) ?? null;
      const displayName = readHostedGroupSharedProfileName(profileRecords);

      return {
        currentTurnHandles,
        displayName,
        memberId,
        participantId,
        projections: projectionScopes.map((projectionScope, index) => {
          const projectionScopeKey = requestedProjectionScopeKeys[index];
          if (!projectionScopeKey) {
            throw new Error("Hosted group shared requested scope key is missing.");
          }
          const exactGrant = memberGrants?.get(projectionScopeKey);
          const sourceAwareFallbackScope = sourceAwareHostedGroupSleepProjectionScope(
            projectionScope,
          );
          const sourceAwareFallbackScopeKey = sourceAwareFallbackScope
            ? buildHostedVaultShareProjectionScopeKey(sourceAwareFallbackScope)
            : null;
          const grant = exactGrant ?? (sourceAwareFallbackScopeKey
            ? memberGrants?.get(sourceAwareFallbackScopeKey)
            : undefined);
          if (!grant) {
            return {
              dataStatus: "missing" as const,
              grantedAt: null,
              grantStatus: "not_granted" as const,
              projectionScope,
              projectionScopeKey,
              records: [],
            };
          }

          const grantScopeKey = grant.projectionScopeKey;
          const hasReadableShare = readableGrantIds.has(grant.id);
          const records = projectionScopeKey === HOSTED_GROUP_SHARED_READ_DEVICE_SCOPE_KEY
            ? hasReadableShare
              ? [buildHostedGroupSharedDeviceSyncRecord({
                  connections: connectionsByMember.get(memberId) ?? [],
                  now,
                  projectionScope,
                })]
              : null
            : storedRecords?.get(grantScopeKey) ?? null;
          const normalizedRecords = !exactGrant && sourceAwareFallbackScope
            ? projectHostedGroupSourceAwareSleepRecordsToLegacy(
                records ?? [],
                projectionScope,
              )
            : records ?? [];
          return {
            dataStatus: hasReadableShare && records === null
              ? "pending" as const
              : normalizedRecords.length > 0
                ? "available" as const
                : "missing" as const,
            grantedAt: grant.grantedAt.toISOString(),
            grantStatus: "granted" as const,
            projectionScope,
            projectionScopeKey,
            records: normalizedRecords,
          };
        }),
      };
    });

    return { members, requestedProjectionScopeKeys, status: "ok" };
  } catch {
    return {
      status: "unavailable",
      unavailableReason: "shared_data_unavailable",
    };
  }
}

function parseHostedGroupSharedReadProjectionScopes(
  projectionScopes: readonly HostedVaultShareSelectableProjectionScope[],
): HostedVaultShareSelectableProjectionScope[] {
  if (projectionScopes.length < 1 || projectionScopes.length > 3) {
    throw new TypeError("Hosted group shared read projection scope count is invalid.");
  }
  const seen = new Set<string>();
  return projectionScopes.map((value) => {
    const scope = parseHostedVaultShareProjectionScope(
      value,
      "Hosted group shared read projection scope",
    );
    const key = buildHostedVaultShareProjectionScopeKey(scope);
    if (!HOSTED_GROUP_SHARED_READ_SELECTABLE_SCOPE_KEYS.has(key) || seen.has(key)) {
      throw new TypeError("Hosted group shared read projection scope is invalid.");
    }
    seen.add(key);
    return scope;
  });
}

function projectHostedGroupSourceAwareSleepRecordsToLegacy(
  records: readonly HostedRuntimeGroupSharedRecord[],
  projectionScope: HostedVaultShareSelectableProjectionScope,
): HostedRuntimeGroupSharedRecord[] {
  return records.map((record) => {
    if (
      !("date" in record.data)
      || !("metricKey" in record.data)
      || !("unit" in record.data)
      || !("value" in record.data)
    ) {
      throw new TypeError("Source-aware sleep fallback record is invalid.");
    }
    const parsed = parseHostedVaultShareDeliveryRecord({
      data: {
        date: record.data.date,
        metricKey: record.data.metricKey,
        ...("provisional" in record.data && record.data.provisional === true
          ? { provisional: true }
          : {}),
        unit: record.data.unit,
        value: record.data.value,
      },
      occurredAt: record.occurredAt,
      recordKey: record.recordKey,
    }, projectionScope);
    return {
      data: parsed.data,
      occurredAt: parsed.occurredAt,
      recordKey: parsed.recordKey,
    };
  });
}

function readHostedGroupSharedProfileName(
  records: readonly HostedRuntimeGroupSharedRecord[] | null,
): string | null {
  const record = records?.[0];
  if (
    !record
    || record.recordKey !== "profile-name"
    || !("displayName" in record.data)
    || typeof record.data.displayName !== "string"
  ) {
    return null;
  }
  return record.data.displayName;
}

function buildHostedGroupSharedDeviceSyncRecord(input: {
  connections: readonly HostedGroupSharedDeviceConnectionSnapshot[];
  now: Date;
  projectionScope: HostedVaultShareSelectableProjectionScope;
}): HostedRuntimeGroupSharedRecord {
  const observedAt = `${input.now.toISOString().slice(0, 10)}T00:00:00.000Z`;
  const sources = buildHostedGroupSharedDeviceSyncSources(
    input.connections,
    input.now,
  );
  const record = parseHostedVaultShareDeliveryRecord({
    data: { observedAt, sources },
    occurredAt: observedAt,
    recordKey: HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_RECORD_KEY,
  }, input.projectionScope);
  return {
    data: record.data,
    occurredAt: record.occurredAt,
    recordKey: record.recordKey,
  };
}

function buildHostedGroupSharedDeviceSyncSources(
  connections: readonly HostedGroupSharedDeviceConnectionSnapshot[],
  now: Date,
): HostedVaultShareDeviceSyncSource[] {
  const sourcesByLabel = new Map<string, HostedVaultShareDeviceSyncSource>();
  for (const connection of connections) {
    const connectionStatus = resolveHostedGroupSharedConnectionStatus(connection);
    const sourceRows = connection.sources.length > 0
      ? connection.sources.map((source) => ({
          label: formatHostedDeviceSyncSourceLabel(source.sourceProviderSlug),
          status: resolveHostedGroupSharedSourceStatus(
            source.status,
            connectionStatus,
          ),
          updatedAt: source.updatedAt,
        }))
      : [{
          label: resolveHostedGroupSharedDeviceProviderLabel(connection.provider),
          status: connectionStatus,
          updatedAt: connection.updatedAt,
        }];
    for (const source of sourceRows) {
      const label = source.label.trim();
      if (!label || label.toLocaleLowerCase("en-US") === "junction") {
        throw new TypeError("Hosted group shared device source label is invalid.");
      }
      const key = label.toLocaleLowerCase("en-US");
      const candidate: HostedVaultShareDeviceSyncSource = {
        connectionSyncJobCompletedAt: toHostedGroupSharedNonFutureTimestamp(
          connection.lastSyncCompletedAt,
          now,
        ),
        label,
        status: source.status,
        statusObservedAt: toHostedGroupSharedStatusTimestamp(
          latestDate(connection.updatedAt, source.updatedAt),
          now,
        ),
      };
      // The query orders connection and source generations oldest-to-newest.
      // Keep the later complete observation for a repeated public label.
      sourcesByLabel.set(key, candidate);
    }
  }
  const sources = [...sourcesByLabel.values()].sort((left, right) =>
    left.label.localeCompare(right.label, "en-US")
  );
  if (sources.length > HOSTED_VAULT_SHARE_DEVICE_SYNC_STATUS_MAX_SOURCES) {
    throw new TypeError("Hosted group shared device source count exceeds the limit.");
  }
  return sources;
}

function resolveHostedGroupSharedDeviceProviderLabel(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "junction") {
    return "Wearable source";
  }
  return resolveDeviceConnectSourceById(normalized)?.label ?? "Connected source";
}

function resolveHostedGroupSharedConnectionStatus(
  connection: HostedGroupSharedDeviceConnectionSnapshot,
): HostedVaultShareDeviceSyncSourceStatus {
  if (connection.status === "disconnected") return "disconnected";
  if (connection.status === "reauthorization_required") return "needs-reconnect";
  if (connection.setupPhase === "pending_link" || connection.setupPhase === "link_returned") {
    return "setting-up";
  }
  if (connection.setupPhase === "failed") return "needs-attention";
  if (
    connection.lastSyncErrorAt
    && (!connection.lastSyncCompletedAt
      || connection.lastSyncErrorAt > connection.lastSyncCompletedAt)
  ) {
    return "needs-attention";
  }
  return connection.status === "active" ? "connected" : "needs-attention";
}

function resolveHostedGroupSharedSourceStatus(
  sourceStatus: string,
  connectionStatus: HostedVaultShareDeviceSyncSourceStatus,
): HostedVaultShareDeviceSyncSourceStatus {
  if (connectionStatus !== "connected") return connectionStatus;
  if (sourceStatus === "connected") return "connected";
  if (sourceStatus === "disconnected") return "disconnected";
  if (sourceStatus === "reauthorization_required") return "needs-reconnect";
  return "needs-attention";
}

function latestDate(left: Date, right: Date): Date {
  return left > right ? left : right;
}

function toHostedGroupSharedNonFutureTimestamp(
  value: Date | null,
  now: Date,
): string | null {
  return value && value <= now ? value.toISOString() : null;
}

function toHostedGroupSharedStatusTimestamp(value: Date, now: Date): string {
  return (value <= now ? value : now).toISOString();
}

export async function readHostedGroupIdByRuntimeMemberId(input: {
  prisma?: HostedGroupsReadClient;
  runtimeMemberId: string;
}): Promise<string | null> {
  const prisma = input.prisma ?? getPrisma();
  const group = await prisma.hostedGroup.findUnique({
    where: { runtimeMemberId: input.runtimeMemberId },
    select: { id: true },
  });
  return group?.id ?? null;
}

export async function readHostedGroupMembershipsForMember(input: {
  memberId: string;
  prisma?: HostedGroupsReadClient;
}): Promise<HostedGroupMembershipReadResult> {
  const prisma = input.prisma ?? getPrisma();
  const rows = await prisma.hostedGroupMember.findMany({
    where: { memberId: input.memberId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: HOSTED_RUNTIME_GROUP_MEMBERSHIPS_MAX + 1,
    select: {
      id: true,
      role: true,
      group: {
        select: {
          displayName: true,
          joinCode: true,
          joinPolicyJson: true,
          kind: true,
          runtimeMemberId: true,
          _count: { select: { members: true } },
        },
      },
    },
  });
  const selectedRows = rows.slice(0, HOSTED_RUNTIME_GROUP_MEMBERSHIPS_MAX);
  const runtimeMemberIds = selectedRows
    .map((row) => row.group.runtimeMemberId)
    .filter((runtimeMemberId): runtimeMemberId is string => Boolean(runtimeMemberId));
  const grantRows = runtimeMemberIds.length === 0
    ? []
    : await prisma.hostedVaultShare.findMany({
        where: {
          destinationMemberId: { in: runtimeMemberIds },
          grantorMemberId: input.memberId,
          status: "granted",
        },
        orderBy: [
          { destinationMemberId: "asc" },
          { projectionScopeKey: "asc" },
        ],
        select: {
          destinationMemberId: true,
          projectionKind: true,
          projectionScopeJson: true,
          projectionScopeKey: true,
        },
      });
  const scopesByRuntimeMemberId = new Map<string, HostedVaultShareProjectionScope[]>();
  for (const grantRow of grantRows) {
    const scope = parseHostedVaultShareRowProjectionScope(grantRow);
    if (!scope) {
      continue;
    }
    const scopes = scopesByRuntimeMemberId.get(grantRow.destinationMemberId) ?? [];
    scopes.push(scope);
    scopesByRuntimeMemberId.set(grantRow.destinationMemberId, scopes);
  }

  return {
    memberships: selectedRows.map((row) => {
      const policy = readHostedGroupJoinPolicy(row.group.joinPolicyJson);
      const grantedVaultShareProjectionScopes = row.group.runtimeMemberId
        ? scopesByRuntimeMemberId.get(row.group.runtimeMemberId) ?? []
        : [];
      return {
        displayName: row.group.displayName,
        grantedVaultShareProjectionScopes,
        kind: row.group.kind,
        memberCount: row.group._count.members,
        membershipId: row.id,
        ownerJoinCode: row.role === "owner" ? row.group.joinCode : null,
        requestedVaultShareProjectionScopes: policy.requestedVaultShareProjectionScopes,
        role: row.role,
        runtimeMemberId: row.group.runtimeMemberId,
      };
    }),
    truncated: rows.length > HOSTED_RUNTIME_GROUP_MEMBERSHIPS_MAX,
  };
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
      ownerMemberId: true,
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
  const offeredProjectionScopes = normalizeHostedVaultShareProjectionScopes(
    policy.requestedVaultShareProjectionScopes,
  );
  const activeVaultShareProjectionScopes = normalizeHostedVaultShareProjectionScopes(
    input.memberId && group.runtimeMemberId
      ? await readActiveHostedVaultShareProjectionScopes({
          destinationMemberId: group.runtimeMemberId,
          grantorMemberId: input.memberId,
          prisma,
          ...(group.members.length > 0
            ? {}
            : {
                projectionScopes: includeLegacyHostedGroupSleepProjectionScopes(
                  offeredProjectionScopes,
                ),
              }),
        })
      : [],
  );
  const visibleProjectionScopes = group.members.length > 0
    ? normalizeHostedVaultShareProjectionScopes([
        ...offeredProjectionScopes,
        ...activeVaultShareProjectionScopes,
      ])
    : offeredProjectionScopes;

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
      visibleProjectionScopes,
    ),
    status: "active",
    viewerCanLeave: group.members.length > 0 && group.ownerMemberId !== input.memberId,
    viewerMembershipId: group.members[0]?.id ?? null,
    viewerMembershipStatus: group.members.length > 0 ? "active" : null,
  };
}

export async function acceptHostedGroupJoinCodeTx(input: {
  confirmationPublicBaseUrl?: string | null;
  tx: Prisma.TransactionClient;
  joinCode: string;
  memberId: string;
  now: Date;
  expectedMembershipId: string | null;
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
    confirmationPublicBaseUrl: input.confirmationPublicBaseUrl ?? null,
    expectedMembershipId: input.expectedMembershipId,
    groupId: groupLookup.id,
    joinOrigin: "web",
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
  expectedOfferGeneration: string;
  groupId: string;
  message: HostedGroupOfferMessageBinding;
  postedAt: Date;
  projectionKinds?: readonly HostedVaultShareProjectionKind[] | null;
  projectionScopes?: readonly HostedVaultShareProjectionScope[] | null;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupJoinOfferBindingTxResult> {
  const messageLookupKey = createHostedGroupOfferMessageLookupKey(input.message);
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
    select: { joinCode: true, joinPolicyJson: true },
  });
  if (!group?.joinCode) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_JOIN_OFFER_NOT_FOUND",
      httpStatus: 404,
      message: "This group offer is no longer active.",
      retryable: false,
    });
  }
  const policy = readHostedGroupJoinPolicy(group.joinPolicyJson);
  if (
    policy.offerGeneration !== input.expectedOfferGeneration
    || !hostedGroupProjectionScopeSetsEqual(
      policy.requestedVaultShareProjectionScopes,
      projectionScopes,
    )
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_JOIN_OFFER_STALE",
      httpStatus: 409,
      message: "This group offer was replaced before it could be activated.",
      retryable: false,
    });
  }
  const binding = {
    groupId: input.groupId,
    messageIdSuffix: readHostedGroupOfferMessageIdSuffix(input.message),
    messageLookupKey,
    projectionKinds,
    projectionScopes,
  };
  const existing = await input.tx.hostedGroupJoinOffer.findUnique({
    where: { messageLookupKey },
    select: {
      groupId: true,
      projectionKindsJson: true,
      revokedAt: true,
    },
  });
  if (existing) {
    assertHostedGroupJoinOfferBindingMatches({
      existing,
      groupId: input.groupId,
      projectionScopes,
    });
    return binding;
  }

  await input.tx.hostedGroupJoinOffer.create({
    data: {
      id: generateHostedGroupJoinOfferId(),
      groupId: input.groupId,
      messageIdSuffix: binding.messageIdSuffix,
      messageLookupKey,
      postedAt: input.postedAt,
      projectionKindsJson: toHostedGroupJoinOfferProjectionScopesJson(projectionScopes),
    },
  });

  return binding;
}

/**
 * Resolves the durable no-repost state for one canonical permission snapshot.
 * The group row lock keeps policy generation and active-offer reads in one
 * transaction. The generation participates in provider idempotency and must
 * still match when the provider message is bound after the intentional gap.
 */
export async function prepareHostedGroupJoinOfferPostTx(input: {
  groupId: string;
  now: Date;
  projectionScopes: readonly HostedVaultShareProjectionScope[];
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupJoinOfferPostPreparation> {
  const projectionScopes = normalizeHostedVaultShareProjectionScopes(
    input.projectionScopes,
  );
  if (
    projectionScopes.length !== input.projectionScopes.length
    || !hostedGroupProjectionScopeSetsEqual(projectionScopes, input.projectionScopes)
  ) {
    return { kind: "unavailable" };
  }

  await lockHostedGroupRow(input.tx, input.groupId);
  const group = await input.tx.hostedGroup.findUnique({
    where: { id: input.groupId },
    select: { joinCode: true, joinPolicyJson: true },
  });
  if (!group?.joinCode) {
    return { kind: "unavailable" };
  }
  const policy = readHostedGroupJoinPolicy(group.joinPolicyJson);
  if (
    !policy.offerGeneration
    || !hostedGroupProjectionScopeSetsEqual(
      policy.requestedVaultShareProjectionScopes,
      projectionScopes,
    )
  ) {
    return { kind: "unavailable" };
  }

  const offers = await input.tx.hostedGroupJoinOffer.findMany({
    where: {
      groupId: input.groupId,
      revokedAt: null,
    },
    select: { projectionKindsJson: true },
    take: HOSTED_GROUP_ACTIVE_JOIN_OFFER_SCAN_MAX + 1,
  });
  if (offers.length > HOSTED_GROUP_ACTIVE_JOIN_OFFER_SCAN_MAX) {
    return { kind: "unavailable" };
  }
  let allActiveOffersMatch = offers.length > 0;
  for (const offer of offers) {
    const storedScopes = parseHostedGroupJoinOfferProjectionScopes(
      offer.projectionKindsJson,
    );
    if (!storedScopes) {
      return { kind: "unavailable" };
    }
    if (!hostedGroupProjectionScopeSetsEqual(storedScopes, projectionScopes)) {
      allActiveOffersMatch = false;
    }
  }
  if (allActiveOffersMatch) {
    return { kind: "active_offer" };
  }

  if (offers.length > 0) {
    await revokeHostedGroupJoinOffersTx(input.tx, {
      groupId: input.groupId,
      now: input.now,
    });
  }

  return {
    joinCode: group.joinCode,
    kind: "post",
    offerGeneration: policy.offerGeneration,
  };
}

export async function readHostedGroupJoinOfferTargetTx(input: {
  channel: HostedGroupOfferChannel;
  messageLookupKeyReadCandidates: readonly string[];
  threadIdentityLookupKeyReadCandidates: readonly string[];
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupJoinOfferTarget> {
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
      groupId: offerLookup.groupId,
      messageLookupKey: {
        in: messageLookupKeyReadCandidates,
      },
      revokedAt: null,
    },
    select: {
      id: true,
      messageLookupKey: true,
      projectionKindsJson: true,
      group: {
        select: {
          displayName: true,
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
      channel: input.channel,
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

  return {
    displayName: group.displayName,
    groupId: group.id,
    joinCode: group.joinCode,
    messageLookupKey: offer.messageLookupKey,
    offerId: offer.id,
    projectionKindsJson: offer.projectionKindsJson,
    runtimeMemberId: group.runtimeMemberId,
  };
}

export async function acceptHostedGroupJoinOfferTx(input: {
  channel: HostedGroupOfferChannel;
  confirmationPublicBaseUrl?: string | null;
  memberId: string;
  messageLookupKeyReadCandidates: readonly string[];
  now: Date;
  threadIdentityLookupKeyReadCandidates: readonly string[];
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupJoinOfferAcceptanceTxResult> {
  const offer = await readHostedGroupJoinOfferTargetTx({
    channel: input.channel,
    messageLookupKeyReadCandidates: input.messageLookupKeyReadCandidates,
    threadIdentityLookupKeyReadCandidates:
      input.threadIdentityLookupKeyReadCandidates,
    tx: input.tx,
  });
  const selectedVaultShareProjectionScopes = normalizeHostedVaultShareProjectionScopes(
    offer.projectionKindsJson,
  );
  const selectedVaultShareProjectionKinds = [
    ...new Set(selectedVaultShareProjectionScopes.map((scope) => scope.projectionKind)),
  ];
  const accepted = await acceptHostedGroupJoinTx({
    additiveOnly: true,
    confirmationPublicBaseUrl: input.confirmationPublicBaseUrl ?? null,
    groupId: offer.groupId,
    joinOrigin: "group_chat_reaction",
    memberId: input.memberId,
    now: input.now,
    policyProjectionScopes: selectedVaultShareProjectionScopes,
    selectedVaultShareProjectionScopes,
    tx: input.tx,
  });

  return {
    ...accepted,
    joinCode: offer.joinCode,
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
  confirmationPublicBaseUrl: string | null;
  expectedMembershipId?: string | null;
  groupId: string;
  joinOrigin: HostedGroupJoinConfirmationOrigin;
  memberId: string;
  now: Date;
  policyProjectionScopes: readonly HostedVaultShareProjectionScope[] | null;
  selectedVaultShareProjectionScopes: readonly HostedVaultShareProjectionScope[];
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupJoinAcceptanceTxResult> {
  await lockHostedGroupRow(input.tx, input.groupId);
  const group = await input.tx.hostedGroup.findUnique({
    where: { id: input.groupId },
    select: {
      displayName: true,
      id: true,
      joinCode: true,
      joinPolicyJson: true,
      runtimeMemberId: true,
    },
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

  const existingMembership = await input.tx.hostedGroupMember.findUnique({
    where: { groupId_memberId: { groupId: group.id, memberId: input.memberId } },
    select: { id: true },
  });
  if (
    input.expectedMembershipId !== undefined
    && (existingMembership?.id ?? null) !== input.expectedMembershipId
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_MEMBERSHIP_CHANGED",
      httpStatus: 409,
      message: "Your group membership changed. Reload this page and try again.",
      retryable: false,
    });
  }

  const selected = normalizeHostedVaultShareProjectionScopes(
    input.selectedVaultShareProjectionScopes,
  );
  const storedPolicy = readHostedGroupJoinPolicy(group.joinPolicyJson);
  const policyRequestedProjectionScopes = input.policyProjectionScopes
    ? normalizeHostedVaultShareProjectionScopes(input.policyProjectionScopes)
    : normalizeHostedVaultShareProjectionScopes(
        storedPolicy.requestedVaultShareProjectionScopes,
      );
  const activeManageableProjectionScopes = existingMembership
    && input.joinOrigin === "web"
    && !input.additiveOnly
    && input.policyProjectionScopes === null
    && group.runtimeMemberId
    ? await readActiveHostedVaultShareProjectionScopes({
        destinationMemberId: group.runtimeMemberId,
        grantorMemberId: input.memberId,
        prisma: input.tx,
      })
    : [];
  const requestedProjectionScopes = normalizeHostedVaultShareProjectionScopes([
    ...policyRequestedProjectionScopes,
    ...activeManageableProjectionScopes,
  ]);
  const allowedSelectedSet = new Set(
    includeLegacyHostedGroupSleepProjectionScopes(requestedProjectionScopes)
      .map((scope) => buildHostedVaultShareProjectionScopeKey(scope)),
  );
  const selectedSet = new Set(
    selected.map((scope) => buildHostedVaultShareProjectionScopeKey(scope)),
  );
  for (const projectionScope of selected) {
    if (!allowedSelectedSet.has(buildHostedVaultShareProjectionScopeKey(projectionScope))) {
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
  // Joining always shares the memory-backed preferred display name, so the launch consent
  // gate applies to every join, not only joins that select health projections.
  // Chat-reaction joins have no consent UI, so a historical grant is enough there;
  // members with no grant at all still fail closed. Web joins render the consent
  // card inline and keep requiring the current document versions.
  if (input.joinOrigin === "group_chat_reaction") {
    await assertHostedHistoricalLaunchConsentGranted({ memberId: input.memberId, prisma: input.tx });
  } else {
    await assertHostedLaunchRequiredConsentGranted({ memberId: input.memberId, prisma: input.tx });
  }

  const storedPolicyScopeKeys = new Set(
    storedPolicy.requestedVaultShareProjectionScopes.map(
      buildHostedVaultShareProjectionScopeKey,
    ),
  );
  const selectedPolicyAdditions = input.policyProjectionScopes === null
    ? selected.filter((projectionScope) => {
        const legacyProjectionScope = legacyHostedGroupSleepProjectionScope(
          projectionScope,
        );
        return legacyProjectionScope !== null
          && storedPolicyScopeKeys.has(
            buildHostedVaultShareProjectionScopeKey(legacyProjectionScope),
          )
          && !storedPolicyScopeKeys.has(
            buildHostedVaultShareProjectionScopeKey(projectionScope),
          );
      })
    : [];
  if (selectedPolicyAdditions.length > 0) {
    const mergedPolicy = mergeHostedGroupJoinPolicy({
      existing: group.joinPolicyJson,
      requestedVaultShareProjectionScopes: selectedPolicyAdditions,
    });
    await input.tx.hostedGroup.update({
      where: { id: group.id },
      data: { joinPolicyJson: toHostedGroupJoinPolicyJson(mergedPolicy) },
    });
  }

  let membershipId: string;
  let alreadyMember = false;
  if (!existingMembership) {
    const created = await input.tx.hostedGroupMember.create({
      data: {
        id: generateHostedGroupMemberId(),
        groupId: group.id,
        joinConfirmationEligibleAt: group.joinCode ? input.now : null,
        joinConfirmationOrigin: group.joinCode ? input.joinOrigin : null,
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
      const legacyProjectionScope = legacyHostedGroupSleepProjectionScope(projectionScope);
      const legacyProjectionScopeKey = legacyProjectionScope
        ? buildHostedVaultShareProjectionScopeKey(legacyProjectionScope)
        : null;
      if (selectedSet.has(projectionScopeKey)) {
        if (legacyProjectionScope) {
          const revokedCount = await revokeHostedVaultSharesTx({
            destinationMemberId: group.runtimeMemberId,
            grantorMemberId: input.memberId,
            now: input.now,
            projectionScopes: [legacyProjectionScope],
            tx: input.tx,
          });
          if (revokedCount > 0) {
            revokedVaultShareProjectionKinds.push(legacyProjectionScope.projectionKind);
            revokedVaultShareProjectionScopes.push(legacyProjectionScope);
          }
        }
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
        const revokedCount = await revokeHostedVaultSharesTx({
          destinationMemberId: group.runtimeMemberId,
          grantorMemberId: input.memberId,
          now: input.now,
          projectionScopes: [projectionScope],
          tx: input.tx,
        });
        if (revokedCount > 0) {
          revokedVaultShareProjectionKinds.push(projectionScope.projectionKind);
          revokedVaultShareProjectionScopes.push(projectionScope);
        }
        if (
          legacyProjectionScope
          && legacyProjectionScopeKey
          && !selectedSet.has(legacyProjectionScopeKey)
        ) {
          const legacyRevokedCount = await revokeHostedVaultSharesTx({
            destinationMemberId: group.runtimeMemberId,
            grantorMemberId: input.memberId,
            now: input.now,
            projectionScopes: [legacyProjectionScope],
            tx: input.tx,
          });
          if (legacyRevokedCount > 0) {
            revokedVaultShareProjectionKinds.push(legacyProjectionScope.projectionKind);
            revokedVaultShareProjectionScopes.push(legacyProjectionScope);
          }
        }
      }
    }
  }

  const joinConfirmationResult = !alreadyMember
    && group.joinCode
    ? await appendHostedGroupJoinConfirmationTx({
        groupDisplayName: group.displayName,
        joinCode: group.joinCode,
        joinOrigin: input.joinOrigin,
        memberId: input.memberId,
        membershipId,
        occurredAt: input.now,
        publicBaseUrl: input.confirmationPublicBaseUrl,
        tx: input.tx,
      })
    : null;
  if (joinConfirmationResult && joinConfirmationResult.kind !== "deferred") {
    await input.tx.hostedGroupMember.update({
      data: {
        joinConfirmationEligibleAt: null,
        joinConfirmationOrigin: null,
      },
      where: { id: membershipId },
    });
  }
  const joinConfirmationSignal = joinConfirmationResult?.kind === "appended"
    ? joinConfirmationResult.signal
    : null;

  return {
    alreadyMember,
    grantedVaultShareProjectionKinds,
    grantedVaultShareProjectionScopes,
    groupId: group.id,
    ...(joinConfirmationSignal ? { joinConfirmationSignal } : {}),
    membershipId,
    revokedVaultShareProjectionKinds,
    revokedVaultShareProjectionScopes,
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
    };
  }

  const revokedCount = await revokeHostedVaultSharesTx({
    destinationMemberId: group.runtimeMemberId,
    grantorMemberId: input.memberId,
    now: input.now,
    projectionScopes: [hostedVaultShareProjectionKindToScope("group-email.v0")],
    tx: input.tx,
  });

  return {
    groupId: group.id,
    kind: "ok",
    revokedCount,
  };
}

export async function leaveHostedGroupMemberTx(
  input: {
    memberId: string;
    now: Date;
    tx: Prisma.TransactionClient;
  } & HostedGroupMemberLeaveSelector,
): Promise<HostedGroupMemberLeaveTxResult> {
  let groupLookup: { id: string } | null;
  if (input.membershipId !== undefined) {
    const selectedMembership = await input.tx.hostedGroupMember.findUnique({
      where: { id: input.membershipId },
      select: { groupId: true, memberId: true },
    });
    if (!selectedMembership || selectedMembership.memberId !== input.memberId) {
      return { kind: "already_left" };
    }
    groupLookup = { id: selectedMembership.groupId };
  } else {
    groupLookup = await input.tx.hostedGroup.findUnique({
      where: { joinCode: input.joinCode },
      select: { id: true },
    });
    if (!groupLookup) {
      return { kind: "group_not_found" };
    }
  }

  await lockHostedGroupRow(input.tx, groupLookup.id);
  const group = await input.tx.hostedGroup.findUnique({
    where: { id: groupLookup.id },
    select: { id: true, ownerMemberId: true, runtimeMemberId: true },
  });
  if (!group) {
    return { kind: "group_not_found" };
  }

  await lockHostedMemberRow(input.tx, input.memberId);
  if (group.ownerMemberId === input.memberId) {
    return { kind: "owner_cannot_leave" };
  }

  const membership = await input.tx.hostedGroupMember.findUnique({
    where: {
      groupId_memberId: {
        groupId: group.id,
        memberId: input.memberId,
      },
    },
    select: { id: true },
  });
  // A membership id is also the replay fence for private-assistant requests.
  // Never let a stale request remove a membership created by a later rejoin.
  if (input.membershipId !== undefined && membership?.id !== input.membershipId) {
    return { kind: "already_left" };
  }

  const revokedCount = group.runtimeMemberId
    ? await revokeHostedVaultSharesTx({
        destinationMemberId: group.runtimeMemberId,
        grantorMemberId: input.memberId,
        now: input.now,
        tx: input.tx,
      })
    : 0;

  if (membership) {
    await input.tx.hostedGroupMember.delete({ where: { id: membership.id } });
  }
  if (!membership && revokedCount === 0) {
    return { kind: "already_left" };
  }

  return { kind: "left" };
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

async function replaceHostedGroupRequestedProjectionsTx(
  tx: Prisma.TransactionClient,
  input: {
    groupId: string;
    now: Date;
    requestedVaultShareProjectionScopes: readonly HostedVaultShareProjectionScope[];
  },
): Promise<void> {
  const group = await tx.hostedGroup.findUnique({
    where: { id: input.groupId },
    select: { joinPolicyJson: true, runtimeMemberId: true },
  });
  if (!group) throw hostedOnboardingError({ code: "HOSTED_GROUP_NOT_FOUND", httpStatus: 404, message: "Hosted group not found." });
  const requested = normalizeHostedVaultShareProjectionScopes(
    input.requestedVaultShareProjectionScopes,
  );
  const existing = readHostedGroupJoinPolicy(group.joinPolicyJson);
  if (hostedGroupProjectionScopeSetsEqual(
    existing.requestedVaultShareProjectionScopes,
    requested,
  ) && existing.offerGeneration !== null) {
    return;
  }
  if (requested.length > 0) {
    if (!group.runtimeMemberId) {
      throw hostedOnboardingError({
        code: "HOSTED_GROUP_RUNTIME_REQUIRED",
        httpStatus: 409,
        message: "Requested group permissions require a group runtime.",
      });
    }
    await assertHostedGroupRuntimeDestinationTx(tx, group.runtimeMemberId);
  }
  const replacement = mergeHostedGroupJoinPolicy({
    existing: null,
    offerGeneration: generateHostedGroupJoinOfferGeneration(),
    requestedVaultShareProjectionScopes: requested,
  });
  await tx.hostedGroup.update({
    where: { id: input.groupId },
    data: {
      joinPolicyJson: toHostedGroupJoinPolicyJson(replacement),
    },
  });
  await revokeHostedGroupJoinOffersTx(tx, {
    groupId: input.groupId,
    now: input.now,
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

function parseHostedGroupJoinOfferProjectionScopes(
  value: unknown,
): HostedVaultShareProjectionScope[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const parsedScopeKeys = new Set<string>();
  for (const entry of value) {
    let projectionScope: HostedVaultShareProjectionScope;
    try {
      projectionScope = parseHostedVaultShareProjectionScope(
        entry,
        "Hosted group join-offer projection scope",
      );
    } catch {
      return null;
    }
    parsedScopeKeys.add(buildHostedVaultShareProjectionScopeKey(projectionScope));
  }
  const projectionScopes = normalizeHostedVaultShareProjectionScopes(value);
  const normalizedScopeKeys = new Set(
    projectionScopes.map(buildHostedVaultShareProjectionScopeKey),
  );
  if (
    parsedScopeKeys.size !== normalizedScopeKeys.size
    || [...parsedScopeKeys].some((scopeKey) => !normalizedScopeKeys.has(scopeKey))
  ) {
    return null;
  }
  return projectionScopes;
}

function hostedGroupProjectionScopeSetsEqual(
  left: readonly HostedVaultShareProjectionScope[],
  right: readonly HostedVaultShareProjectionScope[],
): boolean {
  const leftScopeKeys = new Set(left.map(buildHostedVaultShareProjectionScopeKey));
  const rightScopeKeys = new Set(right.map(buildHostedVaultShareProjectionScopeKey));
  return leftScopeKeys.size === rightScopeKeys.size
    && [...leftScopeKeys].every((scopeKey) => rightScopeKeys.has(scopeKey));
}

function assertHostedGroupJoinOfferBindingMatches(input: {
  existing: {
    groupId: string;
    projectionKindsJson: unknown;
    revokedAt: Date | null;
  };
  groupId: string;
  projectionScopes: readonly HostedVaultShareProjectionScope[];
}): void {
  const existingProjectionScopes = parseHostedGroupJoinOfferProjectionScopes(
    input.existing.projectionKindsJson,
  );
  if (
    input.existing.groupId === input.groupId
    && input.existing.revokedAt === null
    && existingProjectionScopes !== null
    && hostedGroupProjectionScopeSetsEqual(
      existingProjectionScopes,
      input.projectionScopes,
    )
  ) {
    return;
  }
  throw hostedOnboardingError({
    code: "HOSTED_GROUP_JOIN_OFFER_BINDING_CONFLICT",
    httpStatus: 409,
    message: "The provider message is already bound to a different group offer.",
    retryable: false,
  });
}

function fixedProjectionKindsToScopes(
  projectionKinds: readonly HostedVaultShareProjectionKind[],
): HostedVaultShareProjectionScope[] {
  return normalizeHostedVaultShareProjectionKinds(projectionKinds)
    .filter(isHostedVaultShareFixedProjectionKind)
    .map((projectionKind) => hostedVaultShareProjectionKindToScope(projectionKind));
}

/**
 * Group membership implies exactly one automatic share: the member's memory-backed
 * preferred display name, so the group runtime can introduce members without re-asking anyone.
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
 * Server-derived roster that joins group membership and current data-sharing
 * grants. Chat attribution is intentionally confined to the lazy read_shared
 * operation, so this legacy summary never reads or reveals member handles.
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

  const memberIds = input.members.map((member) => member.memberId);
  const grants = input.runtimeMemberId
    ? await prisma.hostedVaultShare.findMany({
        where: {
          destinationMemberId: input.runtimeMemberId,
          grantorMemberId: { in: memberIds },
          status: "granted",
        },
        select: {
          grantorMemberId: true,
          projectionKind: true,
          projectionScopeJson: true,
          projectionScopeKey: true,
        },
      })
    : [];
  const grantsByMemberId = new Map<string, HostedVaultShareProjectionScope[]>();
  for (const grant of grants) {
    const scope = parseHostedVaultShareRowProjectionScope(grant);
    if (!scope) {
      continue;
    }
    const scopes = grantsByMemberId.get(grant.grantorMemberId) ?? [];
    scopes.push(scope);
    grantsByMemberId.set(grant.grantorMemberId, scopes);
  }

  return input.members.map((member) => {
    const grantedVaultShareProjectionScopes =
      grantsByMemberId.get(member.memberId) ?? [];
    return {
      grantedVaultShareProjectionKinds: [
        ...new Set(grantedVaultShareProjectionScopes.map((scope) => scope.projectionKind)),
      ],
      grantedVaultShareProjectionScopes,
      handle: null,
      memberId: member.memberId,
      role: member.role,
    };
  });
}

/**
 * Resolves current-turn sender handles to at most one current membership each.
 *
 * Matching is strictly scoped to the sending channel's identity index. A
 * Telegram user id is a bare digit string that would otherwise normalize into a
 * valid phone-number lookup key and could match an unrelated member's verified
 * phone, so cross-channel matching is never attempted.
 */
function matchHostedGroupCurrentTurnSenderHandles(
  members: readonly HostedGroupSharedMemberSource[],
  senderHandles: {
    linqSenderHandles: readonly string[];
    telegramSenderHandles: readonly string[];
  },
): Map<string, string[]> {
  const matchedHandlesByParticipantId = new Map<string, string[]>();
  const linqPresent = senderHandles.linqSenderHandles.length > 0;
  const telegramPresent = senderHandles.telegramSenderHandles.length > 0;
  if (linqPresent && telegramPresent) {
    return matchedHandlesByParticipantId;
  }
  if (linqPresent) {
    return matchHostedGroupCurrentTurnLinqSenderHandles(
      members,
      senderHandles.linqSenderHandles,
    ).handlesByParticipantId;
  }
  for (const senderHandle of new Set(senderHandles.telegramSenderHandles)) {
    const matchedMembers =
      matchHostedGroupTelegramSenderHandle(members, senderHandle);
    if (matchedMembers.length !== 1) {
      continue;
    }
    const participantId = matchedMembers[0]?.id;
    if (!participantId) {
      continue;
    }
    const matchedHandles =
      matchedHandlesByParticipantId.get(participantId) ?? [];
    matchedHandles.push(senderHandle);
    matchedHandlesByParticipantId.set(participantId, matchedHandles);
  }

  return matchedHandlesByParticipantId;
}

function matchHostedGroupCurrentTurnLinqSenderHandles(
  members: readonly HostedGroupSharedMemberSource[],
  senderHandles: readonly string[],
): {
  handlesByParticipantId: Map<string, string[]>;
  unmatchedSenderHandles: string[];
} {
  const handlesByParticipantId = new Map<string, string[]>();
  const unmatchedSenderHandles: string[] = [];
  for (const senderHandle of new Set(senderHandles)) {
    const matchedMembers =
      matchHostedGroupLinqSenderHandle(members, senderHandle);
    if (matchedMembers.length === 0) {
      unmatchedSenderHandles.push(senderHandle);
      continue;
    }
    if (matchedMembers.length !== 1) {
      continue;
    }
    const participantId = matchedMembers[0]?.id;
    if (!participantId) {
      continue;
    }
    const matchedHandles = handlesByParticipantId.get(participantId) ?? [];
    matchedHandles.push(senderHandle);
    handlesByParticipantId.set(participantId, matchedHandles);
  }
  return { handlesByParticipantId, unmatchedSenderHandles };
}

function matchHostedGroupLinqSenderHandle(
  members: readonly HostedGroupSharedMemberSource[],
  senderHandle: string,
): HostedGroupSharedMemberSource[] {
  const emailLookupKeys = new Set(
    createHostedEmailLookupKeyReadCandidates(senderHandle),
  );
  const phoneLookupKeys = new Set(
    createHostedPhoneLookupKeyReadCandidates(senderHandle),
  );
  return members.filter((member) => {
    const emailAuthorization = member.member.emailAuthorization;
    const identity = member.member.identity;
    return Boolean(
      emailAuthorization?.verifiedEmailVerifiedAt
      && emailAuthorization.verifiedEmailLookupKey
      && emailLookupKeys.has(emailAuthorization.verifiedEmailLookupKey),
    ) || Boolean(
      identity?.phoneNumberVerifiedAt
      && identity.phoneLookupKey
      && phoneLookupKeys.has(identity.phoneLookupKey),
    );
  });
}

function matchHostedGroupTelegramSenderHandle(
  members: readonly HostedGroupSharedMemberSource[],
  senderHandle: string,
): HostedGroupSharedMemberSource[] {
  const telegramUserLookupKeys = new Set(
    createHostedTelegramUserLookupKeyReadCandidates(senderHandle),
  );
  return members.filter((member) => {
    const routing = member.member.routing;
    return Boolean(
      routing?.telegramUserLookupKey
      && telegramUserLookupKeys.has(routing.telegramUserLookupKey),
    );
  });
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

export async function lockHostedGroupRow(
  tx: Prisma.TransactionClient,
  groupId: string,
): Promise<void> {
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
