import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

import { isHostedMemberSuspended } from "../hosted-onboarding/entitlement";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { hasActiveHostedLinqManagedLine } from "../hosted-onboarding/linq-line-store";
import {
  readHostedRuntimeAiAccessDecision,
} from "../hosted-onboarding/member-access";
import { generateHostedRandomPrefixedId, normalizeNullableString } from "../primitives";
import { getPrisma } from "../prisma";

export const HOSTED_PENDING_GROUP_SETUP_TTL_MS = 30 * 60 * 1_000;
export const HOSTED_PENDING_GROUP_SETUP_MAX_PARTICIPANT_MEMBERS = 32;

const HOSTED_PENDING_GROUP_SETUP_CHANNEL = "linq" as const;

export type HostedPendingGroupSetupChannel =
  typeof HOSTED_PENDING_GROUP_SETUP_CHANNEL;

export interface HostedPendingGroupSetupSnapshot {
  armedAt: Date;
  channel: HostedPendingGroupSetupChannel;
  expiresAt: Date;
  id: string;
  ownerMemberId: string;
  recipientPhoneLookupKey: string;
}

interface HostedPendingGroupSetupRow {
  armedAt: Date;
  expiresAt: Date;
  id: string;
  ownerMemberId: string;
  recipientPhoneLookupKey: string;
}

export interface HostedPendingGroupSetupCandidate {
  id: string;
  ownerMemberId: string;
}

export type HostedPendingGroupSetupCandidateSelection =
  | {
      candidate: HostedPendingGroupSetupCandidate;
      kind: "selected";
      reason: "only_candidate" | "sender_wins_conflict";
    }
  | {
      kind: "none";
      reason: "ambiguous" | "no_candidates";
    };

export type HostedPendingGroupSetupClaimReason =
  | "ambiguous"
  | "claim_raced"
  | "no_candidates"
  | "only_candidate"
  | "sender_wins_conflict";

export type HostedPendingGroupSetupClaimResult =
  | {
      claimToken: HostedPendingGroupSetupRestoreToken;
      kind: "claimed";
      reason: Extract<
        HostedPendingGroupSetupClaimReason,
        "only_candidate" | "sender_wins_conflict"
      >;
      setup: HostedPendingGroupSetupSnapshot;
    }
  | {
      kind: "none";
      reason: Extract<
        HostedPendingGroupSetupClaimReason,
        "ambiguous" | "claim_raced" | "no_candidates"
      >;
    };

export type HostedPendingGroupSetupRestoreToken = HostedPendingGroupSetupRow;

export async function armHostedPendingGroupSetupTx(input: {
  now?: Date;
  ownerMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedPendingGroupSetupSnapshot> {
  const ownerMemberId = requireNonEmptyString(
    input.ownerMemberId,
    "pending group setup owner member id",
  );
  const now = requireValidDate(input.now ?? new Date(), "pending group setup armed at");
  const expiresAt = new Date(now.getTime() + HOSTED_PENDING_GROUP_SETUP_TTL_MS);

  const owner = await input.tx.hostedMember.findUnique({
    select: { id: true, suspendedAt: true },
    where: { id: ownerMemberId },
  });
  const routing = await input.tx.hostedMemberRouting.findUnique({
    select: { linqRecipientPhoneLookupKey: true },
    where: { memberId: ownerMemberId },
  });
  const recipientPhoneLookupKey = normalizeNullableString(
    routing?.linqRecipientPhoneLookupKey,
  );
  if (
    !owner
    || isHostedMemberSuspended(owner.suspendedAt)
    || !recipientPhoneLookupKey
    || !(await hasActiveHostedLinqManagedLine({
      phoneNumberLookupKeys: [recipientPhoneLookupKey],
      prisma: input.tx,
    }))
    || !(await readHostedRuntimeAiAccessDecision({
      memberId: ownerMemberId,
      now,
      prisma: input.tx,
    })).allowed
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_PENDING_GROUP_SETUP_ACTIVE_LINQ_MEMBER_REQUIRED",
      httpStatus: 403,
      message: "An active Murph member with a current Linq line is required to prepare a group.",
      retryable: false,
    });
  }

  const id = generateHostedRandomPrefixedId("hpgs");
  const rows = await input.tx.$queryRaw<HostedPendingGroupSetupRow[]>(Prisma.sql`
    INSERT INTO "hosted_pending_group_setup" (
      "id", "owner_member_id", "channel", "recipient_phone_lookup_key",
      "armed_at", "expires_at", "created_at", "updated_at"
    )
    VALUES (
      ${id}, ${ownerMemberId}, ${HOSTED_PENDING_GROUP_SETUP_CHANNEL},
      ${recipientPhoneLookupKey}, ${now}, ${expiresAt}, ${now}, ${now}
    )
    ON CONFLICT ("owner_member_id") DO UPDATE SET
      "id" = EXCLUDED."id",
      "channel" = EXCLUDED."channel",
      "recipient_phone_lookup_key" = EXCLUDED."recipient_phone_lookup_key",
      "armed_at" = EXCLUDED."armed_at",
      "expires_at" = EXCLUDED."expires_at",
      "created_at" = EXCLUDED."created_at",
      "updated_at" = EXCLUDED."updated_at"
    RETURNING
      "id",
      "owner_member_id" AS "ownerMemberId",
      "recipient_phone_lookup_key" AS "recipientPhoneLookupKey",
      "armed_at" AS "armedAt",
      "expires_at" AS "expiresAt"
  `);
  const row = rows[0];
  if (!row) {
    throw new Error("Pending group setup upsert returned no row.");
  }
  return projectHostedPendingGroupSetupSnapshot(row);
}

export async function readHostedPendingGroupSetup(input: {
  now?: Date;
  ownerMemberId: string;
  prisma?: PrismaClient | Prisma.TransactionClient;
}): Promise<HostedPendingGroupSetupSnapshot | null> {
  const ownerMemberId = normalizeNullableString(input.ownerMemberId);
  if (!ownerMemberId) {
    return null;
  }
  const now = requireValidDate(input.now ?? new Date(), "pending group setup read time");
  const prisma = input.prisma ?? getPrisma();
  const rows = await prisma.$queryRaw<HostedPendingGroupSetupRow[]>(Prisma.sql`
    SELECT
      setup."id",
      setup."owner_member_id" AS "ownerMemberId",
      setup."recipient_phone_lookup_key" AS "recipientPhoneLookupKey",
      setup."armed_at" AS "armedAt",
      setup."expires_at" AS "expiresAt"
    FROM "hosted_pending_group_setup" AS setup
    INNER JOIN "hosted_member_routing" AS routing
      ON routing."member_id" = setup."owner_member_id"
      AND routing."linq_recipient_phone_lookup_key"
        = setup."recipient_phone_lookup_key"
    WHERE setup."owner_member_id" = ${ownerMemberId}
      AND setup."channel" = ${HOSTED_PENDING_GROUP_SETUP_CHANNEL}
      AND setup."expires_at" > ${now}
    LIMIT 1
  `);
  const row = rows[0];
  return row ? projectHostedPendingGroupSetupSnapshot(row) : null;
}

export async function cancelHostedPendingGroupSetupTx(input: {
  ownerMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const ownerMemberId = normalizeNullableString(input.ownerMemberId);
  if (!ownerMemberId) {
    return false;
  }
  return (await input.tx.$executeRaw(Prisma.sql`
    DELETE FROM "hosted_pending_group_setup"
    WHERE "owner_member_id" = ${ownerMemberId}
  `)) > 0;
}

/** A lone roster candidate wins; only the sender's own setup breaks a conflict. */
export function selectHostedPendingGroupSetupCandidate(input: {
  candidates: readonly HostedPendingGroupSetupCandidate[];
  senderMemberId?: string | null;
}): HostedPendingGroupSetupCandidateSelection {
  const byOwner = new Map<string, HostedPendingGroupSetupCandidate>();
  for (const candidate of input.candidates) {
    const ownerMemberId = normalizeNullableString(candidate.ownerMemberId);
    if (ownerMemberId && !byOwner.has(ownerMemberId)) {
      byOwner.set(ownerMemberId, candidate);
    }
  }
  const candidates = [...byOwner.values()];
  if (candidates.length === 0) {
    return { kind: "none", reason: "no_candidates" };
  }
  if (candidates.length === 1) {
    return { candidate: candidates[0]!, kind: "selected", reason: "only_candidate" };
  }
  const senderMemberId = normalizeNullableString(input.senderMemberId);
  const senderCandidate = senderMemberId ? byOwner.get(senderMemberId) : undefined;
  return senderCandidate
    ? {
        candidate: senderCandidate,
        kind: "selected",
        reason: "sender_wins_conflict",
      }
    : { kind: "none", reason: "ambiguous" };
}

/**
 * `DELETE ... RETURNING` is the one-time claim. A surrounding transaction
 * rollback restores it, while a simultaneous second group cannot consume it.
 */
export async function claimHostedPendingGroupSetupForParticipantsTx(input: {
  now?: Date;
  participantMemberIds: readonly string[];
  recipientPhoneLookupKeys: readonly string[];
  senderMemberId?: string | null;
  tx: Prisma.TransactionClient;
}): Promise<HostedPendingGroupSetupClaimResult> {
  const participantMemberIds = normalizeBoundedMemberIds(input.participantMemberIds);
  const recipientPhoneLookupKeys = normalizeLookupKeys(
    input.recipientPhoneLookupKeys,
  );
  if (participantMemberIds.length === 0 || recipientPhoneLookupKeys.length === 0) {
    return { kind: "none", reason: "no_candidates" };
  }
  const now = requireValidDate(input.now ?? new Date(), "pending group setup claim time");
  if (!(await hasActiveHostedLinqManagedLine({
    phoneNumberLookupKeys: recipientPhoneLookupKeys,
    prisma: input.tx,
  }))) {
    return { kind: "none", reason: "no_candidates" };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const candidateRows = await readCandidateRowsTx({
      now,
      ownerMemberIds: participantMemberIds,
      recipientPhoneLookupKeys,
      tx: input.tx,
    });
    const candidates = await filterCurrentlyEligibleCandidateRows({
      candidates: candidateRows,
      now,
      tx: input.tx,
    });
    const selection = selectHostedPendingGroupSetupCandidate({
      candidates,
      senderMemberId: input.senderMemberId,
    });
    if (selection.kind === "none") {
      return selection;
    }

    const selected = candidateRows.find(
      (row) =>
        row.id === selection.candidate.id
        && row.ownerMemberId === selection.candidate.ownerMemberId,
    );
    if (!selected) {
      continue;
    }
    const claimedRows = await input.tx.$queryRaw<HostedPendingGroupSetupRow[]>(Prisma.sql`
      DELETE FROM "hosted_pending_group_setup"
      WHERE "id" = ${selected.id}
        AND "owner_member_id" = ${selected.ownerMemberId}
        AND "channel" = ${HOSTED_PENDING_GROUP_SETUP_CHANNEL}
        AND "recipient_phone_lookup_key" = ${selected.recipientPhoneLookupKey}
        AND "expires_at" > ${now}
      RETURNING
        "id",
        "owner_member_id" AS "ownerMemberId",
        "recipient_phone_lookup_key" AS "recipientPhoneLookupKey",
        "armed_at" AS "armedAt",
        "expires_at" AS "expiresAt"
    `);
    const claimed = claimedRows[0];
    if (claimed) {
      return {
        claimToken: claimed,
        kind: "claimed",
        reason: selection.reason,
        setup: projectHostedPendingGroupSetupSnapshot(claimed),
      };
    }
  }
  return { kind: "none", reason: "claim_raced" };
}

/** Preserve the intent when route creation only converged on an existing route. */
export async function restoreHostedPendingGroupSetupClaimTx(input: {
  claimToken: HostedPendingGroupSetupRestoreToken;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const token = input.claimToken;
  return (await input.tx.$executeRaw(Prisma.sql`
    INSERT INTO "hosted_pending_group_setup" (
      "id", "owner_member_id", "channel", "recipient_phone_lookup_key",
      "armed_at", "expires_at", "created_at", "updated_at"
    )
    VALUES (
      ${token.id}, ${token.ownerMemberId}, ${HOSTED_PENDING_GROUP_SETUP_CHANNEL},
      ${token.recipientPhoneLookupKey}, ${token.armedAt}, ${token.expiresAt},
      ${token.armedAt}, ${token.armedAt}
    )
    ON CONFLICT ("owner_member_id") DO NOTHING
  `)) > 0;
}

async function readCandidateRowsTx(input: {
  now: Date;
  ownerMemberIds: readonly string[];
  recipientPhoneLookupKeys: readonly string[];
  tx: Prisma.TransactionClient;
}): Promise<HostedPendingGroupSetupRow[]> {
  return await input.tx.$queryRaw<HostedPendingGroupSetupRow[]>(Prisma.sql`
    SELECT
      setup."id",
      setup."owner_member_id" AS "ownerMemberId",
      setup."recipient_phone_lookup_key" AS "recipientPhoneLookupKey",
      setup."armed_at" AS "armedAt",
      setup."expires_at" AS "expiresAt"
    FROM "hosted_pending_group_setup" AS setup
    INNER JOIN "hosted_member" AS owner
      ON owner."id" = setup."owner_member_id"
    INNER JOIN "hosted_member_routing" AS routing
      ON routing."member_id" = setup."owner_member_id"
      AND routing."linq_recipient_phone_lookup_key"
        = setup."recipient_phone_lookup_key"
    WHERE setup."owner_member_id" IN (${Prisma.join(input.ownerMemberIds)})
      AND setup."channel" = ${HOSTED_PENDING_GROUP_SETUP_CHANNEL}
      AND setup."recipient_phone_lookup_key"
        IN (${Prisma.join(input.recipientPhoneLookupKeys)})
      AND setup."expires_at" > ${input.now}
      AND owner."suspended_at" IS NULL
    ORDER BY setup."owner_member_id" ASC
  `);
}

async function filterCurrentlyEligibleCandidateRows(input: {
  candidates: readonly HostedPendingGroupSetupRow[];
  now: Date;
  tx: Prisma.TransactionClient;
}): Promise<HostedPendingGroupSetupRow[]> {
  const eligible: HostedPendingGroupSetupRow[] = [];
  for (const candidate of input.candidates) {
    const decision = await readHostedRuntimeAiAccessDecision({
      memberId: candidate.ownerMemberId,
      now: input.now,
      prisma: input.tx,
    });
    if (decision.allowed) {
      eligible.push(candidate);
    }
  }
  return eligible;
}

function projectHostedPendingGroupSetupSnapshot(
  row: HostedPendingGroupSetupRow,
): HostedPendingGroupSetupSnapshot {
  return {
    armedAt: row.armedAt,
    channel: HOSTED_PENDING_GROUP_SETUP_CHANNEL,
    expiresAt: row.expiresAt,
    id: row.id,
    ownerMemberId: row.ownerMemberId,
    recipientPhoneLookupKey: row.recipientPhoneLookupKey,
  };
}

function normalizeBoundedMemberIds(values: readonly string[]): string[] {
  return normalizeLookupKeys(values).slice(
    0,
    HOSTED_PENDING_GROUP_SETUP_MAX_PARTICIPANT_MEMBERS,
  );
}

function normalizeLookupKeys(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeNullableString).filter(
    (value): value is string => value !== null,
  ))];
}

function requireNonEmptyString(value: string, label: string): string {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    throw new TypeError(`${label} is required.`);
  }
  return normalized;
}

function requireValidDate(value: Date, label: string): Date {
  if (Number.isNaN(value.getTime())) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}
