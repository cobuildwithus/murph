import "server-only";

import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  HOSTED_RUNTIME_GROUP_DISCLOSURE_GRANTS_MAX,
  HOSTED_RUNTIME_GROUP_DISCLOSURE_PERMISSION_TEXT_MAX_CODE_POINTS,
} from "@murphai/hosted-execution/runtime-control";

import {
  createHostedLinqMessageLookupKey,
  createHostedLinqMessageLookupKeyReadCandidates,
} from "../hosted-onboarding/contact-privacy";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";

export const HOSTED_GROUP_DISCLOSURE_PERMISSION_TEXT_MAX_LENGTH =
  HOSTED_RUNTIME_GROUP_DISCLOSURE_PERMISSION_TEXT_MAX_CODE_POINTS;

const HOSTED_GROUP_DISCLOSURE_PERMISSION_DIGEST_DOMAIN =
  "murph.hosted-group-disclosure.permission.v1";
const HOSTED_GROUP_DISCLOSURE_PERMISSION_REQUEST_DOMAIN =
  "murph.hosted-group-disclosure.permission-request.v1";
const HOSTED_GROUP_DISCLOSURE_GRANT_REACTION_DOMAIN =
  "murph.hosted-group-disclosure.grant-reaction.v1";
const HOSTED_GROUP_DISCLOSURE_LOOKUP_CANDIDATE_MAX = 4;
const HOSTED_GROUP_DISCLOSURE_FORBIDDEN_PERMISSION_TEXT =
  /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/u;

export type HostedGroupDisclosureReadClient = PrismaClient | Prisma.TransactionClient;

export type HostedGroupDisclosurePermissionReactionTxResult =
  | { kind: "accepted" }
  | {
      kind: "limit_reached" | "not_found" | "not_group_member" | "wrong_thread";
    };

export interface HostedGroupDisclosureGrantSummary {
  grantId: string;
  groupLabel: string;
  memberId: string;
  permissionText: string;
}

export type HostedGroupDisclosureGrantRevocationTxResult =
  | { kind: "revoked" }
  | { kind: "already_revoked" }
  | { kind: "not_found" };

export interface HostedGroupDisclosureGrantAuthority {
  grantId: string;
  groupRuntimeMemberId: string;
  membershipId: string;
  permissionDigest: string;
  permissionText: string;
  targetMemberId: string;
}

export function canonicalizeHostedGroupDisclosurePermissionText(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidHostedGroupDisclosurePermissionTextError();
  }

  const lineNormalized = value.replaceAll("\r\n", "\n").normalize("NFC");
  if (containsForbiddenHostedGroupDisclosurePermissionCodePoint(lineNormalized)) {
    throw invalidHostedGroupDisclosurePermissionTextError();
  }

  const canonical = lineNormalized.trim();
  const codePointLength = [...canonical].length;
  if (
    codePointLength === 0
    || codePointLength > HOSTED_GROUP_DISCLOSURE_PERMISSION_TEXT_MAX_LENGTH
  ) {
    throw invalidHostedGroupDisclosurePermissionTextError();
  }
  return canonical;
}

export function digestHostedGroupDisclosurePermissionText(value: unknown): string {
  const permissionText = canonicalizeHostedGroupDisclosurePermissionText(value);
  return digestCanonicalHostedGroupDisclosurePermissionText(permissionText);
}

export function createHostedGroupDisclosurePermissionRequestId(input: {
  groupId: string;
  originAssistantInputId: string;
  permissionDigest: string;
}): string {
  const groupId = input.groupId.trim();
  const originAssistantInputId = input.originAssistantInputId.trim();
  const permissionDigest = input.permissionDigest.trim();
  if (!groupId || !originAssistantInputId || !permissionDigest) {
    throw new TypeError("Disclosure permission request authority is required.");
  }
  const digest = createHash("sha256")
    .update(HOSTED_GROUP_DISCLOSURE_PERMISSION_REQUEST_DOMAIN, "utf8")
    .update("\0", "utf8")
    .update(JSON.stringify([groupId, originAssistantInputId, permissionDigest]), "utf8")
    .digest("hex");
  return `hgrpdp_${digest}`;
}

export async function recordHostedGroupDisclosurePermissionTx(input: {
  groupId: string;
  messageId: string | null;
  originAssistantInputId: string;
  permissionText: string;
  postedAt: Date;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const permissionText = canonicalizeHostedGroupDisclosurePermissionText(input.permissionText);
  const permissionDigest = digestCanonicalHostedGroupDisclosurePermissionText(permissionText);
  const permissionId = createHostedGroupDisclosurePermissionRequestId({
    groupId: input.groupId,
    originAssistantInputId: input.originAssistantInputId,
    permissionDigest,
  });
  const messageLookupKey = createHostedLinqMessageLookupKey(input.messageId);
  const messageLookupKeyReadCandidates =
    createHostedLinqMessageLookupKeyReadCandidates(input.messageId);
  if (!messageLookupKey || messageLookupKeyReadCandidates.length === 0) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_DISCLOSURE_MESSAGE_ID_REQUIRED",
      httpStatus: 502,
      message: "Could not bind this disclosure permission to a provider message.",
      retryable: true,
    });
  }

  await lockHostedGroupDisclosureGroupRow(input.tx, input.groupId);
  const group = await input.tx.hostedGroup.findUnique({
    where: { id: input.groupId },
    select: { runtimeMemberId: true },
  });
  if (!group?.runtimeMemberId) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_DISCLOSURE_GROUP_NOT_ACTIVE",
      httpStatus: 410,
      message: "This group is no longer active.",
      retryable: false,
    });
  }

  const existing = await input.tx.hostedGroupDisclosurePermission.findUnique({
    where: { id: permissionId },
    select: {
      groupId: true,
      messageLookupKey: true,
      permissionDigest: true,
      permissionText: true,
    },
  });
  if (existing) {
    if (
      existing.groupId === input.groupId
      && messageLookupKeyReadCandidates.includes(existing.messageLookupKey)
      && existing.permissionDigest === permissionDigest
      && existing.permissionText === permissionText
    ) {
      return;
    }
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_DISCLOSURE_PERMISSION_REQUEST_CONFLICT",
      httpStatus: 409,
      message: "This group turn is already bound to another disclosure request.",
      retryable: false,
    });
  }
  await input.tx.hostedGroupDisclosurePermission.create({
    data: {
      groupId: input.groupId,
      id: permissionId,
      messageLookupKey,
      permissionDigest,
      permissionText,
      postedAt: input.postedAt,
    },
  });
}

export async function acceptHostedGroupDisclosurePermissionReactionTx(input: {
  memberId: string;
  messageLookupKeyReadCandidates: readonly string[];
  now: Date;
  reactionEventId: string;
  threadIdentityLookupKeyReadCandidates: readonly string[];
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupDisclosurePermissionReactionTxResult> {
  const messageLookupKeyReadCandidates = normalizeHostedGroupDisclosureLookupCandidates(
    input.messageLookupKeyReadCandidates,
  );
  const threadIdentityLookupKeyReadCandidates = normalizeHostedGroupDisclosureLookupCandidates(
    input.threadIdentityLookupKeyReadCandidates,
  );
  if (
    messageLookupKeyReadCandidates.length === 0
    || threadIdentityLookupKeyReadCandidates.length === 0
    || input.reactionEventId.trim().length === 0
  ) {
    return { kind: "not_found" };
  }

  const permissionLookups = await input.tx.hostedGroupDisclosurePermission.findMany({
    where: {
      messageLookupKey: { in: messageLookupKeyReadCandidates },
    },
    orderBy: { id: "asc" },
    select: { groupId: true, id: true },
    take: 2,
  });
  if (permissionLookups.length !== 1) {
    return { kind: "not_found" };
  }

  const permissionLookup = permissionLookups[0];
  await lockHostedGroupDisclosureGroupRow(input.tx, permissionLookup.groupId);
  await lockHostedGroupDisclosureMemberRow(input.tx, input.memberId);
  const permission = await input.tx.hostedGroupDisclosurePermission.findUnique({
    where: { id: permissionLookup.id },
    select: {
      group: {
        select: {
          id: true,
          members: {
            where: { memberId: input.memberId },
            select: { createdAt: true, id: true, joinedAt: true },
            take: 1,
          },
          runtimeMemberId: true,
        },
      },
      id: true,
      messageLookupKey: true,
      permissionDigest: true,
      permissionText: true,
    },
  });
  if (
    !permission
    || !messageLookupKeyReadCandidates.includes(permission.messageLookupKey)
    || !hasValidHostedGroupDisclosurePermissionTextAndDigest(permission)
  ) {
    return { kind: "not_found" };
  }

  const groupRuntimeMemberId = permission.group.runtimeMemberId;
  if (!groupRuntimeMemberId) {
    return { kind: "not_found" };
  }
  const route = await input.tx.hostedThreadRoute.findFirst({
    where: {
      channel: "linq",
      containerMemberId: groupRuntimeMemberId,
      threadIdentityLookupKey: { in: threadIdentityLookupKeyReadCandidates },
    },
    select: { containerMemberId: true },
  });
  if (!route) {
    return { kind: "wrong_thread" };
  }

  const membership = permission.group.members[0];
  if (
    !membership
    || input.now < (membership.joinedAt ?? membership.createdAt)
  ) {
    return { kind: "not_group_member" };
  }

  const grantId = createHostedGroupDisclosureReactionGrantId(
    input.reactionEventId,
  );
  const replayedGrant = await input.tx.hostedGroupDisclosureGrant.findUnique({
    where: { id: grantId },
    select: { membershipId: true, permissionId: true },
  });
  if (replayedGrant) {
    return replayedGrant.membershipId === membership.id
      && replayedGrant.permissionId === permission.id
      ? { kind: "accepted" }
      : { kind: "not_found" };
  }

  const existingGrant = await input.tx.hostedGroupDisclosureGrant.findFirst({
    where: {
      membershipId: membership.id,
      permissionId: permission.id,
      revokedAt: null,
    },
    select: { id: true },
  });
  if (existingGrant) {
    return { kind: "accepted" };
  }

  const [activeGroupGrantCount, activeMemberGrantCount] = await Promise.all([
    input.tx.hostedGroupDisclosureGrant.count({
      where: {
        membership: { groupId: permission.group.id },
        permission: { groupId: permission.group.id },
        revokedAt: null,
      },
    }),
    input.tx.hostedGroupDisclosureGrant.count({
      where: {
        membership: { memberId: input.memberId },
        revokedAt: null,
      },
    }),
  ]);
  if (
    activeGroupGrantCount >= HOSTED_RUNTIME_GROUP_DISCLOSURE_GRANTS_MAX
    || activeMemberGrantCount >= HOSTED_RUNTIME_GROUP_DISCLOSURE_GRANTS_MAX
  ) {
    return { kind: "limit_reached" };
  }

  await input.tx.hostedGroupDisclosureGrant.create({
    data: {
      grantedAt: input.now,
      id: grantId,
      membershipId: membership.id,
      permissionId: permission.id,
    },
  });
  return { kind: "accepted" };
}

export async function readActiveHostedGroupDisclosureGrantsForGroup(input: {
  groupId: string;
  prisma?: HostedGroupDisclosureReadClient;
}): Promise<HostedGroupDisclosureGrantSummary[]> {
  const prisma = input.prisma ?? getPrisma();
  const rows = await prisma.hostedGroupDisclosureGrant.findMany({
    where: {
      membership: { groupId: input.groupId },
      permission: { groupId: input.groupId },
      revokedAt: null,
    },
    orderBy: [{ grantedAt: "asc" }, { id: "asc" }],
    select: hostedGroupDisclosureGrantSummarySelect,
    take: HOSTED_RUNTIME_GROUP_DISCLOSURE_GRANTS_MAX,
  });
  return rows.flatMap(projectHostedGroupDisclosureGrantSummary);
}

export async function readActiveHostedGroupDisclosureGrantsForMember(input: {
  memberId: string;
  prisma?: HostedGroupDisclosureReadClient;
}): Promise<HostedGroupDisclosureGrantSummary[]> {
  const prisma = input.prisma ?? getPrisma();
  const rows = await prisma.hostedGroupDisclosureGrant.findMany({
    where: {
      membership: { memberId: input.memberId },
      revokedAt: null,
    },
    orderBy: [{ grantedAt: "asc" }, { id: "asc" }],
    select: hostedGroupDisclosureGrantSummarySelect,
    take: HOSTED_RUNTIME_GROUP_DISCLOSURE_GRANTS_MAX,
  });
  return rows.flatMap(projectHostedGroupDisclosureGrantSummary);
}

export async function revokeHostedGroupDisclosureGrantForMemberTx(input: {
  grantId: string;
  memberId: string;
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupDisclosureGrantRevocationTxResult> {
  const lookup = await input.tx.hostedGroupDisclosureGrant.findUnique({
    where: { id: input.grantId },
    select: {
      membership: { select: { groupId: true, memberId: true } },
      revokedAt: true,
    },
  });
  if (!lookup || lookup.membership.memberId !== input.memberId) {
    return { kind: "not_found" };
  }

  await lockHostedGroupDisclosureGroupRow(input.tx, lookup.membership.groupId);
  await lockHostedGroupDisclosureMemberRow(input.tx, input.memberId);
  if (lookup.revokedAt) {
    return { kind: "already_revoked" };
  }

  const updated = await input.tx.hostedGroupDisclosureGrant.updateMany({
    where: {
      id: input.grantId,
      membership: { memberId: input.memberId },
      revokedAt: null,
    },
    data: { revokedAt: input.now },
  });
  return updated.count === 1 ? { kind: "revoked" } : { kind: "already_revoked" };
}

export async function readHostedGroupDisclosureGrantAuthorityTx(input: {
  expectedGroupRuntimeMemberId?: string | null;
  expectedTargetMemberId?: string | null;
  grantId: string;
  membershipId?: string | null;
  permissionDigest?: string | null;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupDisclosureGrantAuthority | null> {
  const lookup = await input.tx.hostedGroupDisclosureGrant.findUnique({
    where: { id: input.grantId },
    select: {
      membership: { select: { memberId: true } },
      permission: { select: { groupId: true } },
    },
  });
  if (!lookup) {
    return null;
  }

  await lockHostedGroupDisclosureGroupRow(input.tx, lookup.permission.groupId);
  await lockHostedGroupDisclosureMemberRow(input.tx, lookup.membership.memberId);

  const grant = await input.tx.hostedGroupDisclosureGrant.findUnique({
    where: { id: input.grantId },
    select: {
      id: true,
      membership: {
        select: { groupId: true, id: true, memberId: true },
      },
      permission: {
        select: {
          group: {
            select: { id: true, runtimeMemberId: true },
          },
          permissionDigest: true,
          permissionText: true,
        },
      },
      revokedAt: true,
    },
  });
  if (
    !grant
    || grant.revokedAt !== null
    || (
      input.membershipId != null
      && grant.membership.id !== input.membershipId
    )
    || grant.membership.groupId !== grant.permission.group.id
    || grant.membership.memberId !== lookup.membership.memberId
    || grant.permission.group.id !== lookup.permission.groupId
    || (
      input.permissionDigest != null
      && grant.permission.permissionDigest !== input.permissionDigest
    )
    || !hasValidHostedGroupDisclosurePermissionTextAndDigest(grant.permission)
  ) {
    return null;
  }

  const groupRuntimeMemberId = grant.permission.group.runtimeMemberId;
  const targetMemberId = grant.membership.memberId;
  if (
    !groupRuntimeMemberId
    || (
      input.expectedGroupRuntimeMemberId != null
      && groupRuntimeMemberId !== input.expectedGroupRuntimeMemberId
    )
    || (
      input.expectedTargetMemberId != null
      && targetMemberId !== input.expectedTargetMemberId
    )
  ) {
    return null;
  }

  return {
    grantId: grant.id,
    groupRuntimeMemberId,
    membershipId: grant.membership.id,
    permissionDigest: grant.permission.permissionDigest,
    permissionText: grant.permission.permissionText,
    targetMemberId,
  };
}

const hostedGroupDisclosureGrantSummarySelect = {
  id: true,
  membership: {
    select: { groupId: true, memberId: true },
  },
  permission: {
    select: {
      group: { select: { displayName: true, id: true } },
      permissionDigest: true,
      permissionText: true,
    },
  },
} as const satisfies Prisma.HostedGroupDisclosureGrantSelect;

type HostedGroupDisclosureGrantSummaryRow = Prisma.HostedGroupDisclosureGrantGetPayload<{
  select: typeof hostedGroupDisclosureGrantSummarySelect;
}>;

function projectHostedGroupDisclosureGrantSummary(
  row: HostedGroupDisclosureGrantSummaryRow,
): HostedGroupDisclosureGrantSummary[] {
  if (
    row.membership.groupId !== row.permission.group.id
    || !hasValidHostedGroupDisclosurePermissionTextAndDigest(row.permission)
  ) {
    return [];
  }
  return [{
    grantId: row.id,
    groupLabel: hostedGroupDisclosureGroupLabel(row.permission.group.displayName),
    memberId: row.membership.memberId,
    permissionText: row.permission.permissionText,
  }];
}

function digestCanonicalHostedGroupDisclosurePermissionText(permissionText: string): string {
  return createHash("sha256")
    .update(HOSTED_GROUP_DISCLOSURE_PERMISSION_DIGEST_DOMAIN, "utf8")
    .update("\0", "utf8")
    .update(permissionText, "utf8")
    .digest("hex");
}

function createHostedGroupDisclosureReactionGrantId(
  reactionEventId: string,
): string {
  const digest = createHash("sha256")
    .update(HOSTED_GROUP_DISCLOSURE_GRANT_REACTION_DOMAIN, "utf8")
    .update("\0", "utf8")
    .update(reactionEventId, "utf8")
    .digest("hex");
  return `hgrpdg_${digest}`;
}

function hasValidHostedGroupDisclosurePermissionTextAndDigest(input: {
  permissionDigest: string;
  permissionText: string;
}): boolean {
  try {
    const canonical = canonicalizeHostedGroupDisclosurePermissionText(input.permissionText);
    return canonical === input.permissionText
      && digestCanonicalHostedGroupDisclosurePermissionText(canonical) === input.permissionDigest;
  } catch {
    return false;
  }
}

function containsForbiddenHostedGroupDisclosurePermissionCodePoint(value: string): boolean {
  return [...value].some((character) =>
    character !== "\n"
    && HOSTED_GROUP_DISCLOSURE_FORBIDDEN_PERMISSION_TEXT.test(character)
  );
}

function invalidHostedGroupDisclosurePermissionTextError() {
  return hostedOnboardingError({
    code: "HOSTED_GROUP_DISCLOSURE_PERMISSION_TEXT_INVALID",
    httpStatus: 400,
    message:
      `Disclosure permission text must be 1-${HOSTED_GROUP_DISCLOSURE_PERMISSION_TEXT_MAX_LENGTH} characters of plain text.`,
    retryable: false,
  });
}

function normalizeHostedGroupDisclosureLookupCandidates(
  values: readonly (string | null | undefined)[],
): string[] {
  return [...new Set(values
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0))]
    .slice(0, HOSTED_GROUP_DISCLOSURE_LOOKUP_CANDIDATE_MAX);
}

function hostedGroupDisclosureGroupLabel(displayName: string | null): string {
  const normalized = displayName?.trim() ?? "";
  return normalized || "Group";
}

async function lockHostedGroupDisclosureGroupRow(
  tx: Prisma.TransactionClient,
  groupId: string,
): Promise<void> {
  await tx.$queryRaw`select 1 from "hosted_group" where "id" = ${groupId} for update`;
}

async function lockHostedGroupDisclosureMemberRow(
  tx: Prisma.TransactionClient,
  memberId: string,
): Promise<void> {
  await tx.$queryRaw`select 1 from "hosted_member" where "id" = ${memberId} for update`;
}
