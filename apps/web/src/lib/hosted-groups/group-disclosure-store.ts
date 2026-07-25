import "server-only";

import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  HOSTED_RUNTIME_GROUP_DISCLOSURE_GRANTS_MAX,
  HOSTED_RUNTIME_GROUP_DISCLOSURE_HISTORY_MAX,
  HOSTED_RUNTIME_GROUP_DISCLOSURE_PERMISSION_TEXT_MAX_CODE_POINTS,
} from "@murphai/hosted-execution/runtime-control";

import {
  createHostedGroupDisclosurePermissionLookupKey,
  createHostedGroupDisclosurePermissionLookupKeyReadCandidates,
  createHostedLinqMessageLookupKey,
  createHostedLinqMessageLookupKeyReadCandidates,
} from "../hosted-onboarding/contact-privacy";
import {
  openHostedUserSecureBoxString,
  openHostedUserSecureBoxStrings,
  sealHostedUserSecureBoxString,
} from "../hosted-crypto/secure-box";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";
import { lockHostedGroupRow } from "./group-store";

export const HOSTED_GROUP_DISCLOSURE_PERMISSION_TEXT_MAX_LENGTH =
  HOSTED_RUNTIME_GROUP_DISCLOSURE_PERMISSION_TEXT_MAX_CODE_POINTS;

const HOSTED_GROUP_DISCLOSURE_PERMISSION_DIGEST_DOMAIN =
  "murph.hosted-group-disclosure.permission.v1";
const HOSTED_GROUP_DISCLOSURE_PERMISSION_REQUEST_DOMAIN =
  "murph.hosted-group-disclosure.permission-request.v1";
const HOSTED_GROUP_DISCLOSURE_PERMISSION_PROVIDER_IDEMPOTENCY_DOMAIN =
  "murph.hosted-group-disclosure.permission-provider-idempotency.v1";
const HOSTED_GROUP_DISCLOSURE_GRANT_REACTION_DOMAIN =
  "murph.hosted-group-disclosure.grant-reaction.v1";
const HOSTED_GROUP_DISCLOSURE_PERMISSION_TEXT_FIELD =
  "permission_text_encrypted";
const HOSTED_GROUP_DISCLOSURE_PERMISSION_TEXT_SCOPE =
  "hosted-group-disclosure-permission:permission-text:v1";
const HOSTED_GROUP_DISCLOSURE_LOOKUP_CANDIDATE_MAX = 4;
const HOSTED_GROUP_DISCLOSURE_FORBIDDEN_PERMISSION_TEXT =
  /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/u;

export type HostedGroupDisclosureReadClient = PrismaClient | Prisma.TransactionClient;

export type HostedGroupDisclosurePermissionReactionTxResult =
  | { kind: "accepted" }
  | {
      kind:
        | "limit_reached"
        | "member_inactive"
        | "not_found"
        | "not_group_member"
        | "wrong_thread";
    };

export type HostedGroupDisclosurePermissionAppendTxResult =
  | { kind: "accepted" }
  | { kind: "limit_reached" };

export type HostedGroupDisclosurePermissionRecordTxResult =
  | { kind: "recorded" }
  | { kind: "limit_reached" };

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

export function digestHostedGroupDisclosurePermissionText(input: {
  groupId: string;
  permissionText: unknown;
}): string {
  const groupId = input.groupId.trim();
  if (!groupId) {
    throw new TypeError("Disclosure permission digest group authority is required.");
  }
  const permissionText = canonicalizeHostedGroupDisclosurePermissionText(
    input.permissionText,
  );
  return digestCanonicalHostedGroupDisclosurePermissionText({
    groupId,
    permissionText,
  });
}

export function createHostedGroupDisclosurePermissionRequestId(input: {
  groupId: string;
  originAssistantInputId: string;
}): string {
  const groupId = input.groupId.trim();
  const originAssistantInputId = input.originAssistantInputId.trim();
  if (!groupId || !originAssistantInputId) {
    throw new TypeError("Disclosure permission request authority is required.");
  }
  const digest = createHash("sha256")
    .update(HOSTED_GROUP_DISCLOSURE_PERMISSION_REQUEST_DOMAIN, "utf8")
    .update("\0", "utf8")
    .update(JSON.stringify([groupId, originAssistantInputId]), "utf8")
    .digest("hex");
  return `hgrpdp_${digest}`;
}

export function createHostedGroupDisclosurePermissionProviderIdempotencyKey(input: {
  consentMessage: string;
  groupId: string;
  originAssistantInputId: string;
}): string {
  const consentMessage = input.consentMessage;
  const groupId = input.groupId.trim();
  const originAssistantInputId = input.originAssistantInputId.trim();
  if (!consentMessage.trim() || !groupId || !originAssistantInputId) {
    throw new TypeError(
      "Disclosure permission provider idempotency input is required.",
    );
  }
  const digest = createHash("sha256")
    .update(
      HOSTED_GROUP_DISCLOSURE_PERMISSION_PROVIDER_IDEMPOTENCY_DOMAIN,
      "utf8",
    )
    .update("\0", "utf8")
    .update(
      JSON.stringify([groupId, originAssistantInputId, consentMessage]),
      "utf8",
    )
    .digest("hex");
  return `group-disclosure:${digest}`;
}

export async function admitHostedGroupDisclosurePermissionAppendTx(input: {
  groupId: string;
  originAssistantInputId: string;
  permissionText: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupDisclosurePermissionAppendTxResult> {
  const permissionText = canonicalizeHostedGroupDisclosurePermissionText(
    input.permissionText,
  );
  const permissionId = createHostedGroupDisclosurePermissionRequestId({
    groupId: input.groupId,
    originAssistantInputId: input.originAssistantInputId,
  });
  await lockHostedGroupRow(input.tx, input.groupId);
  const admission = await readHostedGroupDisclosurePermissionAppendAdmissionAfterLock({
    groupId: input.groupId,
    messageLookupKeyReadCandidates: null,
    permissionId,
    permissionText,
    tx: input.tx,
  });
  return admission.kind === "limit_reached"
    ? { kind: "limit_reached" }
    : { kind: "accepted" };
}

export async function recordHostedGroupDisclosurePermissionTx(input: {
  groupId: string;
  messageId: string | null;
  originAssistantInputId: string;
  permissionText: string;
  postedAt: Date;
  tx: Prisma.TransactionClient;
}): Promise<HostedGroupDisclosurePermissionRecordTxResult> {
  const permissionText = canonicalizeHostedGroupDisclosurePermissionText(input.permissionText);
  const permissionDigest = digestCanonicalHostedGroupDisclosurePermissionText({
    groupId: input.groupId,
    permissionText,
  });
  const permissionId = createHostedGroupDisclosurePermissionRequestId({
    groupId: input.groupId,
    originAssistantInputId: input.originAssistantInputId,
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

  await lockHostedGroupRow(input.tx, input.groupId);
  const admission = await readHostedGroupDisclosurePermissionAppendAdmissionAfterLock({
    groupId: input.groupId,
    messageLookupKeyReadCandidates,
    permissionId,
    permissionText,
    tx: input.tx,
  });
  if (admission.kind === "limit_reached") {
    return { kind: "limit_reached" };
  }
  if (admission.existing) {
    return { kind: "recorded" };
  }
  const permissionTextEncrypted = await sealHostedGroupDisclosurePermissionText({
    permissionId,
    permissionText,
    prisma: input.tx,
    runtimeMemberId: admission.runtimeMemberId,
  });
  await input.tx.hostedGroupDisclosurePermission.create({
    data: {
      groupId: input.groupId,
      id: permissionId,
      messageLookupKey,
      permissionDigest,
      permissionTextEncrypted,
      postedAt: input.postedAt,
    },
  });
  return { kind: "recorded" };
}

async function readHostedGroupDisclosurePermissionAppendAdmissionAfterLock(input: {
  groupId: string;
  messageLookupKeyReadCandidates: readonly string[] | null;
  permissionId: string;
  permissionText: string;
  tx: Prisma.TransactionClient;
}): Promise<
  | { existing: boolean; kind: "accepted"; runtimeMemberId: string }
  | { kind: "limit_reached" }
> {
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
    where: { id: input.permissionId },
    select: {
      groupId: true,
      messageLookupKey: true,
      permissionDigest: true,
      permissionTextEncrypted: true,
    },
  });
  if (existing) {
    const messageMatches = input.messageLookupKeyReadCandidates === null
      || input.messageLookupKeyReadCandidates.includes(existing.messageLookupKey);
    if (existing.groupId === input.groupId && messageMatches) {
      const existingPermissionText = await openHostedGroupDisclosurePermissionText({
        groupId: input.groupId,
        permissionDigest: existing.permissionDigest,
        permissionId: input.permissionId,
        permissionTextEncrypted: existing.permissionTextEncrypted,
        prisma: input.tx,
        runtimeMemberId: group.runtimeMemberId,
      });
      if (
        existingPermissionText === input.permissionText
      ) {
        return {
          existing: true,
          kind: "accepted",
          runtimeMemberId: group.runtimeMemberId,
        };
      }
    }
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_DISCLOSURE_PERMISSION_REQUEST_CONFLICT",
      httpStatus: 409,
      message: "This group turn is already bound to another disclosure request.",
      retryable: false,
    });
  }

  const permissionHistoryCount =
    await input.tx.hostedGroupDisclosurePermission.count({
      where: { groupId: input.groupId },
    });
  if (permissionHistoryCount >= HOSTED_RUNTIME_GROUP_DISCLOSURE_HISTORY_MAX) {
    return { kind: "limit_reached" };
  }
  return {
    existing: false,
    kind: "accepted",
    runtimeMemberId: group.runtimeMemberId,
  };
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
  await lockHostedGroupRow(input.tx, permissionLookup.groupId);
  await lockHostedMemberRow(input.tx, input.memberId);
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
      permissionTextEncrypted: true,
    },
  });
  if (
    !permission
    || !messageLookupKeyReadCandidates.includes(permission.messageLookupKey)
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

  // A grant created here outlives a lapse in access and governs private data, so
  // current access is validated at this durable-effect boundary rather than by
  // the caller: only here is the reacted-to message proven to be this member's
  // disclosure request, and the member row is already locked above, so the fact
  // cannot change under the grant write.
  if (!await readActiveHostedMemberAccess({
    memberId: input.memberId,
    prisma: input.tx,
  })) {
    return { kind: "member_inactive" };
  }

  const permissionText = await openHostedGroupDisclosurePermissionText({
    groupId: permission.group.id,
    permissionDigest: permission.permissionDigest,
    permissionId: permission.id,
    permissionTextEncrypted: permission.permissionTextEncrypted,
    prisma: input.tx,
    runtimeMemberId: groupRuntimeMemberId,
  });
  if (!permissionText) {
    return { kind: "not_found" };
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

  const existingOrSupersedingGrant = await input.tx.hostedGroupDisclosureGrant.findFirst({
    where: {
      membershipId: membership.id,
      permissionId: permission.id,
      OR: [
        { revokedAt: null },
        { revokedAt: { gte: input.now } },
      ],
    },
    select: { id: true },
  });
  if (existingOrSupersedingGrant) {
    return { kind: "accepted" };
  }

  const [groupGrantHistoryCount, memberGrantHistoryCount] = await Promise.all([
    input.tx.hostedGroupDisclosureGrant.count({
      where: {
        membership: { groupId: permission.group.id },
        permission: { groupId: permission.group.id },
      },
    }),
    input.tx.hostedGroupDisclosureGrant.count({
      where: {
        membership: { memberId: input.memberId },
      },
    }),
  ]);
  if (
    groupGrantHistoryCount >= HOSTED_RUNTIME_GROUP_DISCLOSURE_HISTORY_MAX
    || memberGrantHistoryCount >= HOSTED_RUNTIME_GROUP_DISCLOSURE_HISTORY_MAX
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
  return projectHostedGroupDisclosureGrantSummaries({ prisma, rows });
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
  return projectHostedGroupDisclosureGrantSummaries({ prisma, rows });
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

  await lockHostedGroupRow(input.tx, lookup.membership.groupId);
  await lockHostedMemberRow(input.tx, input.memberId);
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

  await lockHostedGroupRow(input.tx, lookup.permission.groupId);
  await lockHostedMemberRow(input.tx, lookup.membership.memberId);

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
          id: true,
          permissionDigest: true,
          permissionTextEncrypted: true,
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

  const permissionText = await openHostedGroupDisclosurePermissionText({
    groupId: grant.permission.group.id,
    permissionDigest: grant.permission.permissionDigest,
    permissionId: grant.permission.id,
    permissionTextEncrypted: grant.permission.permissionTextEncrypted,
    prisma: input.tx,
    runtimeMemberId: groupRuntimeMemberId,
  });
  if (!permissionText) {
    return null;
  }

  return {
    grantId: grant.id,
    groupRuntimeMemberId,
    membershipId: grant.membership.id,
    permissionDigest: grant.permission.permissionDigest,
    permissionText,
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
      group: { select: { displayName: true, id: true, runtimeMemberId: true } },
      id: true,
      permissionDigest: true,
      permissionTextEncrypted: true,
    },
  },
} as const satisfies Prisma.HostedGroupDisclosureGrantSelect;

type HostedGroupDisclosureGrantSummaryRow = Prisma.HostedGroupDisclosureGrantGetPayload<{
  select: typeof hostedGroupDisclosureGrantSummarySelect;
}>;

async function projectHostedGroupDisclosureGrantSummaries(input: {
  prisma: HostedGroupDisclosureReadClient;
  rows: HostedGroupDisclosureGrantSummaryRow[];
}): Promise<HostedGroupDisclosureGrantSummary[]> {
  const structurallyAuthorizedRows = input.rows.flatMap((row) => {
    const runtimeMemberId = row.permission.group.runtimeMemberId;
    if (
      row.membership.groupId !== row.permission.group.id
      || !runtimeMemberId
    ) {
      return [];
    }
    return [{ row, runtimeMemberId }];
  });
  if (structurallyAuthorizedRows.length === 0) {
    return [];
  }
  const permissionTexts = await openHostedUserSecureBoxStrings({
    entries: structurallyAuthorizedRows.map(({ row, runtimeMemberId }) => ({
      aad: buildHostedGroupDisclosurePermissionTextAad(row.permission.id),
      scope: HOSTED_GROUP_DISCLOSURE_PERMISSION_TEXT_SCOPE,
      userId: runtimeMemberId,
      value: row.permission.permissionTextEncrypted,
    })),
    lane: "hosted-member-private-field",
    prisma: input.prisma,
  });
  return structurallyAuthorizedRows.flatMap(({ row }, index) => {
    const permissionText = permissionTexts[index];
    if (
      !permissionText
      || !hasValidHostedGroupDisclosurePermissionTextAndDigest({
        groupId: row.permission.group.id,
        permissionDigest: row.permission.permissionDigest,
        permissionText,
      })
    ) {
      return [];
    }
    return [{
      grantId: row.id,
      groupLabel: hostedGroupDisclosureGroupLabel(row.permission.group.displayName),
      memberId: row.membership.memberId,
      permissionText,
    }];
  });
}

function digestCanonicalHostedGroupDisclosurePermissionText(input: {
  groupId: string;
  permissionText: string;
}): string {
  const permissionDigest = createHostedGroupDisclosurePermissionLookupKey(
    JSON.stringify([
      HOSTED_GROUP_DISCLOSURE_PERMISSION_DIGEST_DOMAIN,
      input.groupId,
      input.permissionText,
    ]),
  );
  if (!permissionDigest) {
    throw new TypeError("Disclosure permission digest input is required.");
  }
  return permissionDigest;
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
  groupId: string;
  permissionDigest: string;
  permissionText: string;
}): boolean {
  try {
    const canonical = canonicalizeHostedGroupDisclosurePermissionText(input.permissionText);
    return canonical === input.permissionText
      && createHostedGroupDisclosurePermissionLookupKeyReadCandidates(
        JSON.stringify([
          HOSTED_GROUP_DISCLOSURE_PERMISSION_DIGEST_DOMAIN,
          input.groupId,
          canonical,
        ]),
      ).includes(input.permissionDigest);
  } catch {
    return false;
  }
}

async function sealHostedGroupDisclosurePermissionText(input: {
  permissionId: string;
  permissionText: string;
  prisma: HostedGroupDisclosureReadClient;
  runtimeMemberId: string;
}): Promise<string> {
  const encrypted = await sealHostedUserSecureBoxString({
    aad: buildHostedGroupDisclosurePermissionTextAad(input.permissionId),
    lane: "hosted-member-private-field",
    prisma: input.prisma,
    scope: HOSTED_GROUP_DISCLOSURE_PERMISSION_TEXT_SCOPE,
    userId: input.runtimeMemberId,
    value: input.permissionText,
  });
  if (!encrypted) {
    throw new Error("Hosted group disclosure permission encryption returned no value.");
  }
  return encrypted;
}

async function openHostedGroupDisclosurePermissionText(input: {
  groupId: string;
  permissionDigest: string;
  permissionId: string;
  permissionTextEncrypted: string;
  prisma: HostedGroupDisclosureReadClient;
  runtimeMemberId: string;
}): Promise<string | null> {
  const permissionText = await openHostedUserSecureBoxString({
    aad: buildHostedGroupDisclosurePermissionTextAad(input.permissionId),
    lane: "hosted-member-private-field",
    prisma: input.prisma,
    scope: HOSTED_GROUP_DISCLOSURE_PERMISSION_TEXT_SCOPE,
    userId: input.runtimeMemberId,
    value: input.permissionTextEncrypted,
  });
  if (
    !permissionText
    || !hasValidHostedGroupDisclosurePermissionTextAndDigest({
      groupId: input.groupId,
      permissionDigest: input.permissionDigest,
      permissionText,
    })
  ) {
    return null;
  }
  return permissionText;
}

function buildHostedGroupDisclosurePermissionTextAad(permissionId: string) {
  return {
    field: HOSTED_GROUP_DISCLOSURE_PERMISSION_TEXT_FIELD,
    purpose: "hosted-group-disclosure-permission-private-content",
    rowId: permissionId,
    table: "hosted_group_disclosure_permission",
  } as const;
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
