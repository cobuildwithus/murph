import "server-only";

import {
  getHostedCryptoDomainForLane,
  parseSerializedHostedSecureBoxEnvelope,
} from "@murphai/runtime-state";
import {
  HOSTED_RUNTIME_PENDING_GROUP_SETUP_SCHEMA_VERSION,
  parseHostedRuntimePendingGroupSetupInput,
  type HostedRuntimePendingGroupSetupInput,
} from "@murphai/hosted-execution/pending-group-setup";
import { Prisma, type PrismaClient } from "@prisma/client";

import {
  unwrapHostedDomainRootsForWebByRootKeyIds,
} from "../hosted-crypto/domain-root-store";
import {
  getHostedDomainRootUnwrapCache,
} from "../hosted-crypto/domain-root-unwrap-cache";
import {
  openHostedUserSecureBoxStrings,
  sealHostedUserSecureBoxString,
} from "../hosted-crypto/secure-box";
import { isHostedMemberSuspended } from "../hosted-onboarding/entitlement";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  readHostedMemberRoutingHomeLinqRecipientPhoneRecords,
  readHostedMemberRoutingHomeLinqRecipientPhoneSnapshots,
  type HostedMemberRoutingHomeLinqRecipientPhoneRecord,
  type HostedMemberRoutingHomeLinqRecipientPhoneSnapshot,
} from "../hosted-onboarding/hosted-member-routing-store";
import {
  readHostedLinqGroupLineRecoveryAuthoritiesTx,
  type HostedLinqGroupLineRecoveryAuthority,
} from "../hosted-onboarding/linq-delivery-store";
import {
  hasActiveHostedLinqManagedLine,
  readActiveHostedLinqManagedLineLookupKeys,
} from "../hosted-onboarding/linq-line-store";
import {
  readHostedRuntimeAiAccessDecision,
  readHostedRuntimeAiAllowedMemberIds,
} from "../hosted-onboarding/member-access";
import {
  createHostedPhoneLookupKeyReadCandidates,
} from "../hosted-onboarding/contact-privacy";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import { generateHostedRandomPrefixedId, normalizeNullableString } from "../primitives";
import { getPrisma } from "../prisma";

export const HOSTED_PENDING_GROUP_SETUP_TTL_MS = 30 * 60 * 1_000;
export const HOSTED_PENDING_GROUP_SETUP_MAX_PARTICIPANT_MEMBERS = 32;

const HOSTED_PENDING_GROUP_SETUP_CHANNEL = "linq" as const;
const HOSTED_PENDING_GROUP_SETUP_PAYLOAD_SCOPE =
  "hosted-pending-group-setup:payload:v1";
const HOSTED_PENDING_GROUP_SETUP_PRIVATE_FIELD_LANE =
  "hosted-member-private-field" as const;

type HostedPendingGroupSetupClient =
  | PrismaClient
  | Prisma.TransactionClient;

export type HostedPendingGroupSetupChannel =
  typeof HOSTED_PENDING_GROUP_SETUP_CHANNEL;

export interface HostedPendingGroupSetupSnapshot {
  armedAt: Date;
  channel: HostedPendingGroupSetupChannel;
  expiresAt: Date;
  id: string;
  ownerMemberId: string;
  recipientPhoneLookupKey: string;
  setup: HostedRuntimePendingGroupSetupInput;
}

interface HostedPendingGroupSetupRow {
  armedAt: Date;
  expiresAt: Date;
  id: string;
  ownerMemberId: string;
  payloadEncrypted: string;
  recipientPhoneLookupKey: string;
}

export interface HostedPendingGroupSetupCandidate {
  id: string;
  ownerMemberId: string;
}

export interface HostedPendingGroupSetupCandidateMetadata
  extends HostedPendingGroupSetupCandidate {
  armedAt: Date;
  recipientPhoneLookupKey: string;
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
  | "invalid_payload"
  | "no_candidates"
  | "only_candidate"
  | "recipient_line_unmanaged"
  | "sender_wins_conflict";

export type HostedPendingGroupSetupClaimResult =
  | {
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
        | "ambiguous"
        | "claim_raced"
        | "invalid_payload"
        | "no_candidates"
        | "recipient_line_unmanaged"
      >;
    };

export interface HostedPreparedPendingGroupSetupCandidate
  extends HostedPendingGroupSetupRow {
  originalLineManaged: boolean;
  originalRecipientPhone: string | null;
  originalRecipientPhoneLookupKeys: readonly string[];
  recoveryAuthority: HostedLinqGroupLineRecoveryAuthority;
  routing: HostedMemberRoutingHomeLinqRecipientPhoneRecord | null;
  runtimeAccessAllowed: boolean;
}

export type HostedPreparedPendingGroupSetupSelection = {
  admissionKind: "incoming_line" | "replacement_line";
  candidateId: string;
  reason: "only_candidate" | "sender_wins_conflict";
} | null;

export type HostedPreparedPendingGroupSetupPayloadRoot =
  | {
      candidateId: string;
      kind: "ready";
    }
  | {
      candidateId: string;
      error: unknown;
      kind: "failed";
    }
  | null;

/**
 * Request-local authority preparation. Private phone plaintext never leaves
 * this package; setup plaintext is opened only after the selected row is
 * locked. No part of the package is persisted or logged.
 */
export interface HostedPreparedPendingGroupSetupPackage {
  candidateRows: readonly HostedPendingGroupSetupRow[];
  candidates: readonly HostedPreparedPendingGroupSetupCandidate[];
  incomingRecipientPhoneLookupKeys: readonly string[];
  occurredAt: Date;
  participantMemberIds: readonly string[];
  preparationFailure?: unknown;
  recoveredRecipientPhoneLookupKey: string;
  selected: HostedPreparedPendingGroupSetupSelection;
  selectedPayloadRoot: HostedPreparedPendingGroupSetupPayloadRoot;
  senderMemberId: string | null;
  threadId: string;
}

export async function armHostedPendingGroupSetupTx(input: {
  now?: Date;
  ownerMemberId: string;
  setup: unknown;
  tx: Prisma.TransactionClient;
}): Promise<HostedPendingGroupSetupSnapshot> {
  const ownerMemberId = requireNonEmptyString(
    input.ownerMemberId,
    "pending group setup owner member id",
  );
  const now = requireValidDate(input.now ?? new Date(), "pending group setup armed at");
  const expiresAt = new Date(now.getTime() + HOSTED_PENDING_GROUP_SETUP_TTL_MS);
  const setup = parseHostedRuntimePendingGroupSetupInput(input.setup);

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
  const payloadEncrypted = await sealHostedUserSecureBoxString({
    aad: buildHostedPendingGroupSetupPayloadAad(id),
    lane: HOSTED_PENDING_GROUP_SETUP_PRIVATE_FIELD_LANE,
    prisma: input.tx,
    scope: HOSTED_PENDING_GROUP_SETUP_PAYLOAD_SCOPE,
    userId: ownerMemberId,
    value: JSON.stringify({
      schemaVersion: HOSTED_RUNTIME_PENDING_GROUP_SETUP_SCHEMA_VERSION,
      setup,
    }),
  });
  if (!payloadEncrypted) {
    throw new TypeError("Pending group setup payload encryption returned no value.");
  }
  const rows = await input.tx.$queryRaw<HostedPendingGroupSetupRow[]>(Prisma.sql`
    INSERT INTO "hosted_pending_group_setup" (
      "id", "owner_member_id", "channel", "recipient_phone_lookup_key",
      "payload_encrypted", "armed_at", "expires_at", "created_at", "updated_at"
    )
    VALUES (
      ${id}, ${ownerMemberId}, ${HOSTED_PENDING_GROUP_SETUP_CHANNEL},
      ${recipientPhoneLookupKey}, ${payloadEncrypted}, ${now}, ${expiresAt},
      ${now}, ${now}
    )
    ON CONFLICT ("owner_member_id") DO UPDATE SET
      "id" = EXCLUDED."id",
      "channel" = EXCLUDED."channel",
      "recipient_phone_lookup_key" = EXCLUDED."recipient_phone_lookup_key",
      "payload_encrypted" = EXCLUDED."payload_encrypted",
      "armed_at" = EXCLUDED."armed_at",
      "expires_at" = EXCLUDED."expires_at",
      "created_at" = EXCLUDED."created_at",
      "updated_at" = EXCLUDED."updated_at"
    RETURNING
      "id",
      "owner_member_id" AS "ownerMemberId",
      "recipient_phone_lookup_key" AS "recipientPhoneLookupKey",
      "payload_encrypted" AS "payloadEncrypted",
      "armed_at" AS "armedAt",
      "expires_at" AS "expiresAt"
  `);
  const row = rows[0];
  if (!row) {
    throw new Error("Pending group setup upsert returned no row.");
  }
  return projectHostedPendingGroupSetupSnapshot(row, setup);
}

export async function readHostedPendingGroupSetup(input: {
  now?: Date;
  ownerMemberId: string;
  prisma?: HostedPendingGroupSetupClient;
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
      setup."payload_encrypted" AS "payloadEncrypted",
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
  if (
    !row
    || !(await hasActiveHostedLinqManagedLine({
      phoneNumberLookupKeys: [row.recipientPhoneLookupKey],
      prisma,
    }))
  ) {
    return null;
  }
  try {
    return projectHostedPendingGroupSetupSnapshot(
      row,
      await openHostedPendingGroupSetupPayload({ prisma, row }),
    );
  } catch {
    // Optional unreadable setup state never becomes group authority.
    return null;
  }
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

/**
 * Reads live candidate metadata for a bounded, provider-proven roster with one
 * candidate projection plus the canonical set access and managed-line owners.
 */
export async function readHostedPendingGroupSetupCandidatesForParticipantsTx(
  input: {
    now?: Date;
    occurredAt: Date;
    participantMemberIds: readonly string[];
    tx: Prisma.TransactionClient;
  },
): Promise<HostedPendingGroupSetupCandidateMetadata[]> {
  const participantMemberIds = normalizeLookupKeys(input.participantMemberIds);
  if (
    participantMemberIds.length === 0
    || participantMemberIds.length
      > HOSTED_PENDING_GROUP_SETUP_MAX_PARTICIPANT_MEMBERS
  ) {
    return [];
  }
  const now = requireValidDate(
    input.now ?? new Date(),
    "pending group setup candidate read time",
  );
  const occurredAt = requireValidDate(
    input.occurredAt,
    "pending group setup candidate event time",
  );
  const rows = await readHostedPendingGroupSetupCandidateMetadataRows({
    now,
    occurredAt,
    ownerMemberIds: participantMemberIds,
    prisma: input.tx,
  });
  const allowedMemberIds = await readHostedRuntimeAiAllowedMemberIds({
    memberIds: rows.map((row) => row.ownerMemberId),
    now,
    prisma: input.tx,
  });
  const managedLineLookupKeys =
    await readActiveHostedLinqManagedLineLookupKeys({
      phoneNumberLookupKeys: rows.map((row) => row.recipientPhoneLookupKey),
      prisma: input.tx,
    });
  return rows.filter((row) =>
    allowedMemberIds.has(row.ownerMemberId)
    && managedLineLookupKeys.has(row.recipientPhoneLookupKey)
  );
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
 * Resolves all pending-setup candidate facts before BEGIN. Candidate, access,
 * line, routing, recovery-intent, and payload-root work is bounded by the
 * provider roster ceiling and every crypto provider call is request-scoped.
 */
export async function prepareHostedPendingGroupSetupForParticipants(input: {
  incomingRecipientPhoneLookupKeys: readonly string[];
  now?: Date;
  occurredAt: Date;
  participantMemberIds: readonly string[];
  prisma: PrismaClient;
  recoveredRecipientPhoneLookupKey: string;
  senderMemberId?: string | null;
  threadId: string;
}): Promise<HostedPreparedPendingGroupSetupPackage> {
  const now = requireValidDate(input.now ?? new Date(), "pending group setup prepare time");
  const occurredAt = requireValidDate(
    input.occurredAt,
    "pending group setup event time",
  );
  const participantMemberIds = normalizeLookupKeys(input.participantMemberIds);
  const incomingRecipientPhoneLookupKeys = normalizeLookupKeys(
    input.incomingRecipientPhoneLookupKeys,
  );
  const recoveredRecipientPhoneLookupKey = requireNonEmptyString(
    input.recoveredRecipientPhoneLookupKey,
    "pending group setup recovered recipient line",
  );
  const threadId = requireNonEmptyString(input.threadId, "pending group setup thread id");
  const senderMemberId = normalizeNullableString(input.senderMemberId);
  const emptyPackage = (): HostedPreparedPendingGroupSetupPackage => ({
    candidateRows: [],
    candidates: [],
    incomingRecipientPhoneLookupKeys,
    occurredAt,
    participantMemberIds,
    recoveredRecipientPhoneLookupKey,
    selected: null,
    selectedPayloadRoot: null,
    senderMemberId,
    threadId,
  });
  if (
    participantMemberIds.length === 0
    || participantMemberIds.length
      > HOSTED_PENDING_GROUP_SETUP_MAX_PARTICIPANT_MEMBERS
    || incomingRecipientPhoneLookupKeys.length === 0
  ) {
    return emptyPackage();
  }

  const candidateRows = await readHostedPendingGroupSetupCandidateRows({
    now,
    occurredAt,
    ownerMemberIds: participantMemberIds,
    prisma: input.prisma,
  });
  if (candidateRows.length === 0) {
    return emptyPackage();
  }

  const ownerMemberIds = candidateRows.map((row) => row.ownerMemberId);
  const preparedFacts = await (async () => {
    try {
      const allowedMemberIds = await readHostedRuntimeAiAllowedMemberIds({
        memberIds: ownerMemberIds,
        now,
        prisma: input.prisma,
      });
      const managedLineLookupKeys =
        await readActiveHostedLinqManagedLineLookupKeys({
          phoneNumberLookupKeys: [
            ...incomingRecipientPhoneLookupKeys,
            ...candidateRows.map((row) => row.recipientPhoneLookupKey),
          ],
          prisma: input.prisma,
        });
      const routingSnapshots =
        await readHostedMemberRoutingHomeLinqRecipientPhoneSnapshots({
          memberIds: ownerMemberIds,
          prisma: input.prisma,
          retainFailureInScopedCache: true,
        });
      return {
        allowedMemberIds,
        kind: "ready" as const,
        managedLineLookupKeys,
        routingSnapshots,
      };
    } catch (error) {
      return { error, kind: "failed" as const };
    }
  })();
  if (preparedFacts.kind === "failed") {
    return {
      ...emptyPackage(),
      candidateRows,
      preparationFailure: preparedFacts.error,
    };
  }
  const {
    allowedMemberIds,
    managedLineLookupKeys,
    routingSnapshots,
  } = preparedFacts;
  const routingByMemberId = new Map<
    string,
    HostedMemberRoutingHomeLinqRecipientPhoneSnapshot
  >(routingSnapshots.map((routing) => [routing.memberId, routing]));
  const candidatesWithoutRecovery = candidateRows.map((row) => {
    const routing = routingByMemberId.get(row.ownerMemberId) ?? null;
    const originalRecipientPhone = normalizePhoneNumber(
      routing?.linqRecipientPhone,
    );
    const originalRecipientPhoneLookupKeys =
      createHostedPhoneLookupKeyReadCandidates(originalRecipientPhone);
    return {
      ...row,
      originalLineManaged: managedLineLookupKeys.has(row.recipientPhoneLookupKey),
      originalRecipientPhone,
      originalRecipientPhoneLookupKeys,
      recoveryAuthority: "none" as HostedLinqGroupLineRecoveryAuthority,
      routing: routing
        ? {
            linqRecipientPhoneEncrypted: routing.linqRecipientPhoneEncrypted,
            linqRecipientPhoneLookupKey: routing.linqRecipientPhoneLookupKey,
            memberId: routing.memberId,
          }
        : null,
      runtimeAccessAllowed: allowedMemberIds.has(row.ownerMemberId),
    } satisfies HostedPreparedPendingGroupSetupCandidate;
  });
  const recoveryCandidates = candidatesWithoutRecovery.flatMap((candidate) =>
    isHostedPreparedPendingGroupSetupCandidateBaseEligible(candidate)
    && candidate.originalRecipientPhone
    && candidate.originalRecipientPhoneLookupKeys.includes(
      candidate.recipientPhoneLookupKey,
    )
    && !candidate.originalRecipientPhoneLookupKeys.includes(
      recoveredRecipientPhoneLookupKey,
    )
      ? [{
          memberId: candidate.ownerMemberId,
          originalRecipientPhone: candidate.originalRecipientPhone,
          pendingGroupSetupId: candidate.id,
          setupArmedAt: candidate.armedAt,
        }]
      : []
  );
  const recoveryAuthorities =
    await readHostedLinqGroupLineRecoveryAuthoritiesTx({
      candidates: recoveryCandidates,
      occurredAt,
      prisma: input.prisma,
      recoveredRecipientPhoneLookupKey,
      threadId,
    });
  const candidates = candidatesWithoutRecovery.map((candidate) => ({
    ...candidate,
    recoveryAuthority: recoveryAuthorities.get(candidate.id) ?? "none",
  }));
  const selected = selectHostedPreparedPendingGroupSetup({
    candidates,
    incomingRecipientPhoneLookupKeys,
    senderMemberId,
  });
  const selectedCandidate = selected
    ? candidates.find((candidate) => candidate.id === selected.candidateId) ?? null
    : null;
  let selectedPayloadRoot: HostedPreparedPendingGroupSetupPayloadRoot = null;
  if (selectedCandidate) {
    try {
      await prewarmHostedPendingGroupSetupPayloadRoot({
        prisma: input.prisma,
        row: selectedCandidate,
      });
      selectedPayloadRoot = {
        candidateId: selectedCandidate.id,
        kind: "ready",
      };
    } catch (error) {
      selectedPayloadRoot = {
        candidateId: selectedCandidate.id,
        error,
        kind: "failed",
      };
    }
  }

  return {
    candidateRows,
    candidates,
    incomingRecipientPhoneLookupKeys,
    occurredAt,
    participantMemberIds,
    recoveredRecipientPhoneLookupKey,
    selected,
    selectedPayloadRoot,
    senderMemberId,
    threadId,
  };
}

export function hasHostedPreparedPendingGroupSetupRecoveryInFlight(
  prepared: HostedPreparedPendingGroupSetupPackage,
): boolean {
  return prepared.candidates.some((candidate) =>
    candidate.recoveryAuthority === "in_flight"
  );
}

export function hasHostedPreparedPendingGroupSetupPotentialCandidate(
  prepared: HostedPreparedPendingGroupSetupPackage,
): boolean {
  return prepared.candidateRows.length > 0;
}

/**
 * The selected setup row stays locked for the surrounding route transaction.
 * Its caller consumes it only after that transaction creates the intended
 * route; rollback and route convergence therefore need no compensation path.
 */
export async function claimHostedPendingGroupSetupForParticipantsTx(input: {
  incomingRecipientPhoneLookupKeys?: readonly string[];
  now?: Date;
  occurredAt: Date;
  participantMemberIds: readonly string[];
  prepared?: HostedPreparedPendingGroupSetupPackage;
  recipientPhoneLookupKeys: readonly string[];
  recoveredRecipientPhoneLookupKey?: string | null;
  requiredCandidateId?: string | null;
  senderMemberId?: string | null;
  threadId?: string | null;
  tx: Prisma.TransactionClient;
}): Promise<HostedPendingGroupSetupClaimResult> {
  const participantMemberIds = normalizeLookupKeys(input.participantMemberIds);
  const recipientPhoneLookupKeys = normalizeLookupKeys(
    input.recipientPhoneLookupKeys,
  );
  const incomingRecipientPhoneLookupKeys = normalizeLookupKeys(
    input.incomingRecipientPhoneLookupKeys ?? input.recipientPhoneLookupKeys,
  );
  if (
    participantMemberIds.length === 0
    || participantMemberIds.length
      > HOSTED_PENDING_GROUP_SETUP_MAX_PARTICIPANT_MEMBERS
    || recipientPhoneLookupKeys.length === 0
    || incomingRecipientPhoneLookupKeys.length === 0
  ) {
    return { kind: "none", reason: "no_candidates" };
  }
  const preparedAt = requireValidDate(
    input.now ?? new Date(),
    "pending group setup claim time",
  );
  const occurredAt = requireValidDate(
    input.occurredAt,
    "pending group setup event time",
  );
  const requiredCandidateId = normalizeNullableString(input.requiredCandidateId);
  const senderMemberId = normalizeNullableString(input.senderMemberId);
  const recoveredRecipientPhoneLookupKey = normalizeNullableString(
    input.recoveredRecipientPhoneLookupKey,
  );
  const threadId = normalizeNullableString(input.threadId);

  const live = await readHostedPendingGroupSetupLiveClaimFacts({
    incomingRecipientPhoneLookupKeys,
    now: preparedAt,
    occurredAt,
    ownerMemberIds: participantMemberIds,
    prisma: input.tx,
  });
  if (!incomingRecipientPhoneLookupKeys.some((key) =>
    live.managedLineLookupKeys.has(key)
  )) {
    return { kind: "none", reason: "recipient_line_unmanaged" };
  }
  const prepared = input.prepared;
  if (!prepared) {
    if (hasPotentialLiveCandidate(live)) {
      throwHostedPendingGroupSetupPreparationRequired();
    }
    return { kind: "none", reason: "no_candidates" };
  }
  assertHostedPreparedPendingGroupSetupContext({
    incomingRecipientPhoneLookupKeys,
    occurredAt,
    participantMemberIds,
    prepared,
    recoveredRecipientPhoneLookupKey,
    senderMemberId,
    threadId,
  });
  if (prepared.preparationFailure !== undefined) {
    if (hasPotentialLiveCandidate(live)) {
      throw prepared.preparationFailure;
    }
    return { kind: "none", reason: "no_candidates" };
  }
  if (!hasSameHostedPendingGroupSetupLiveFacts({ live, prepared })) {
    throwHostedPendingGroupSetupPreparationRequired();
  }
  const recoveryAuthorities = recoveredRecipientPhoneLookupKey && threadId
    ? await readHostedPendingGroupSetupRecoveryAuthorities({
        candidates: prepared.candidates,
        occurredAt,
        prisma: input.tx,
        recoveredRecipientPhoneLookupKey,
        threadId,
      })
    : new Map<string, HostedLinqGroupLineRecoveryAuthority>();
  if ([...recoveryAuthorities.values()].includes("in_flight")) {
    throwHostedLinqGroupLineRecoveryInFlight();
  }
  if (prepared.candidates.some((candidate) =>
    (recoveryAuthorities.get(candidate.id) ?? "none")
      !== candidate.recoveryAuthority
  )) {
    throwHostedPendingGroupSetupPreparationRequired();
  }
  const currentCandidates = prepared.candidates.map((candidate) => ({
    ...candidate,
    recoveryAuthority: recoveryAuthorities.get(candidate.id) ?? "none",
  }));
  const selection = selectHostedPreparedPendingGroupSetup({
    candidates: currentCandidates,
    incomingRecipientPhoneLookupKeys,
    senderMemberId,
  });
  if (
    !hasSameHostedPreparedPendingGroupSetupSelection(selection, prepared.selected)
    || (
      selection
      && requiredCandidateId
      && selection.candidateId !== requiredCandidateId
    )
  ) {
    throwHostedPendingGroupSetupPreparationRequired();
  }
  if (!selection) {
    const genericSelection = selectHostedPendingGroupSetupCandidate({
      candidates: currentCandidates.filter((candidate) =>
        isHostedPreparedPendingGroupSetupCandidateBaseEligible(candidate)
        && incomingRecipientPhoneLookupKeys.includes(
          candidate.recipientPhoneLookupKey,
        )
      ),
      senderMemberId,
    });
    return genericSelection.kind === "none"
      ? genericSelection
      : { kind: "none", reason: "no_candidates" };
  }
  const selected = currentCandidates.find((candidate) =>
    candidate.id === selection.candidateId
  );
  if (
    !selected
    || !participantMemberIds.includes(selected.ownerMemberId)
    || !recipientPhoneLookupKeys.includes(selected.recipientPhoneLookupKey)
  ) {
    throwHostedPendingGroupSetupPreparationRequired();
  }
  const selectedPayloadRoot = prepared.selectedPayloadRoot;
  if (
    !selectedPayloadRoot
    || selectedPayloadRoot.candidateId !== selected.id
  ) {
    throwHostedPendingGroupSetupPreparationRequired();
  }
  if (selectedPayloadRoot.kind === "failed") {
    throw selectedPayloadRoot.error;
  }
  const claimedRows = await input.tx.$queryRaw<HostedPendingGroupSetupRow[]>(Prisma.sql`
    SELECT
      "id",
      "owner_member_id" AS "ownerMemberId",
      "recipient_phone_lookup_key" AS "recipientPhoneLookupKey",
      "payload_encrypted" AS "payloadEncrypted",
      "armed_at" AS "armedAt",
      "expires_at" AS "expiresAt"
    FROM "hosted_pending_group_setup"
    WHERE "id" = ${selected.id}
      AND "owner_member_id" = ${selected.ownerMemberId}
      AND "channel" = ${HOSTED_PENDING_GROUP_SETUP_CHANNEL}
      AND "recipient_phone_lookup_key" = ${selected.recipientPhoneLookupKey}
      AND "armed_at" <= ${occurredAt}
      AND "expires_at" > ${occurredAt}
      AND "expires_at" > ${preparedAt}
    FOR UPDATE
  `);
  const claimed = claimedRows[0];
  if (!claimed) {
    return { kind: "none", reason: "claim_raced" };
  }
  const lockedAt = requireValidDate(
    input.now ?? new Date(),
    "pending group setup locked claim time",
  );
  if (
    !hasSameHostedPendingGroupSetupRow(claimed, selected)
    || claimed.expiresAt <= lockedAt
  ) {
    throwHostedPendingGroupSetupPreparationRequired();
  }
  await revalidateLockedHostedPendingGroupSetupClaim({
    incomingRecipientPhoneLookupKeys,
    now: lockedAt,
    occurredAt,
    participantMemberIds,
    prepared,
    recoveredRecipientPhoneLookupKey,
    selection,
    senderMemberId,
    threadId,
    tx: input.tx,
  });
  let setup: HostedRuntimePendingGroupSetupInput;
  try {
    setup = await openHostedPendingGroupSetupPayload({
      prisma: input.tx,
      row: claimed,
    });
  } catch {
    // Arm validates payloads. Corrupt or future bytes are consumed rather than
    // repeatedly blocking unrelated new-group admission.
    await deleteHostedPendingGroupSetupTx({
      id: claimed.id,
      ownerMemberId: claimed.ownerMemberId,
      tx: input.tx,
    });
    return { kind: "none", reason: "invalid_payload" };
  }
  return {
    kind: "claimed",
    reason: selection.reason,
    setup: projectHostedPendingGroupSetupSnapshot(
      claimed,
      setup,
    ),
  };
}

/** Consume the exact setup row already locked by the surrounding transaction. */
export async function consumeHostedPendingGroupSetupClaimTx(input: {
  id: string;
  ownerMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  return await deleteHostedPendingGroupSetupTx(input);
}

async function readHostedPendingGroupSetupCandidateMetadataRows(input: {
  now: Date;
  occurredAt: Date;
  ownerMemberIds: readonly string[];
  prisma: HostedPendingGroupSetupClient;
}): Promise<HostedPendingGroupSetupCandidateMetadata[]> {
  return input.prisma.$queryRaw<HostedPendingGroupSetupCandidateMetadata[]>(Prisma.sql`
    SELECT
      setup."id",
      setup."owner_member_id" AS "ownerMemberId",
      setup."recipient_phone_lookup_key" AS "recipientPhoneLookupKey",
      setup."armed_at" AS "armedAt"
    FROM "hosted_pending_group_setup" AS setup
    INNER JOIN "hosted_member_routing" AS routing
      ON routing."member_id" = setup."owner_member_id"
      AND routing."linq_recipient_phone_lookup_key"
        = setup."recipient_phone_lookup_key"
    WHERE setup."owner_member_id" IN (${Prisma.join(input.ownerMemberIds)})
      AND setup."channel" = ${HOSTED_PENDING_GROUP_SETUP_CHANNEL}
      AND setup."armed_at" <= ${input.occurredAt}
      AND setup."expires_at" > ${input.occurredAt}
      AND setup."expires_at" > ${input.now}
    ORDER BY setup."owner_member_id" ASC
  `);
}

async function readHostedPendingGroupSetupCandidateRows(input: {
  now: Date;
  occurredAt: Date;
  ownerMemberIds: readonly string[];
  prisma: HostedPendingGroupSetupClient;
}): Promise<HostedPendingGroupSetupRow[]> {
  return input.prisma.$queryRaw<HostedPendingGroupSetupRow[]>(Prisma.sql`
    SELECT
      setup."id",
      setup."owner_member_id" AS "ownerMemberId",
      setup."recipient_phone_lookup_key" AS "recipientPhoneLookupKey",
      setup."payload_encrypted" AS "payloadEncrypted",
      setup."armed_at" AS "armedAt",
      setup."expires_at" AS "expiresAt"
    FROM "hosted_pending_group_setup" AS setup
    WHERE setup."owner_member_id" IN (${Prisma.join(input.ownerMemberIds)})
      AND setup."channel" = ${HOSTED_PENDING_GROUP_SETUP_CHANNEL}
      AND setup."armed_at" <= ${input.occurredAt}
      AND setup."expires_at" > ${input.occurredAt}
      AND setup."expires_at" > ${input.now}
    ORDER BY setup."owner_member_id" ASC
  `);
}

async function readHostedPendingGroupSetupLiveClaimFacts(input: {
  incomingRecipientPhoneLookupKeys: readonly string[];
  now: Date;
  occurredAt: Date;
  ownerMemberIds: readonly string[];
  prisma: Prisma.TransactionClient;
}) {
  const rows = await readHostedPendingGroupSetupCandidateRows(input);
  const ownerMemberIds = rows.map((row) => row.ownerMemberId);
  const allowedMemberIds = await readHostedRuntimeAiAllowedMemberIds({
    memberIds: ownerMemberIds,
    now: input.now,
    prisma: input.prisma,
  });
  const managedLineLookupKeys =
    await readActiveHostedLinqManagedLineLookupKeys({
      phoneNumberLookupKeys: [
        ...input.incomingRecipientPhoneLookupKeys,
        ...rows.map((row) => row.recipientPhoneLookupKey),
      ],
      prisma: input.prisma,
    });
  const routingRecords =
    await readHostedMemberRoutingHomeLinqRecipientPhoneRecords({
      memberIds: ownerMemberIds,
      prisma: input.prisma,
    });
  return { allowedMemberIds, managedLineLookupKeys, routingRecords, rows };
}

function hasPotentialLiveCandidate(input: Awaited<
  ReturnType<typeof readHostedPendingGroupSetupLiveClaimFacts>
>): boolean {
  const routingByMemberId = new Map<
    string,
    HostedMemberRoutingHomeLinqRecipientPhoneRecord
  >(input.routingRecords.map((routing) => [routing.memberId, routing]));
  return input.rows.some((row) =>
    input.allowedMemberIds.has(row.ownerMemberId)
    && input.managedLineLookupKeys.has(row.recipientPhoneLookupKey)
    && routingByMemberId.get(row.ownerMemberId)
      ?.linqRecipientPhoneLookupKey === row.recipientPhoneLookupKey
  );
}

function hasSameHostedPendingGroupSetupLiveFacts(input: {
  live: Awaited<ReturnType<typeof readHostedPendingGroupSetupLiveClaimFacts>>;
  prepared: HostedPreparedPendingGroupSetupPackage;
}): boolean {
  if (input.live.rows.length !== input.prepared.candidateRows.length) {
    return false;
  }
  const preparedRowsById = new Map(
    input.prepared.candidateRows.map((row) => [row.id, row]),
  );
  if (input.live.rows.some((row) => {
    const prepared = preparedRowsById.get(row.id);
    return !prepared || !hasSameHostedPendingGroupSetupRow(row, prepared);
  })) {
    return false;
  }
  const preparedById = new Map(
    input.prepared.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const liveRoutingByMemberId = new Map<
    string,
    HostedMemberRoutingHomeLinqRecipientPhoneRecord
  >(input.live.routingRecords.map((routing) => [routing.memberId, routing]));
  return input.live.rows.every((row) => {
    const prepared = preparedById.get(row.id);
    const routing = liveRoutingByMemberId.get(row.ownerMemberId) ?? null;
    return prepared !== undefined
      && prepared.runtimeAccessAllowed
        === input.live.allowedMemberIds.has(row.ownerMemberId)
      && prepared.originalLineManaged
        === input.live.managedLineLookupKeys.has(row.recipientPhoneLookupKey)
      && hasSameHostedMemberRoutingHomeLinqRecord(routing, prepared.routing);
  });
}

async function readHostedPendingGroupSetupRecoveryAuthorities(input: {
  candidates: readonly HostedPreparedPendingGroupSetupCandidate[];
  occurredAt: Date;
  prisma: HostedPendingGroupSetupClient;
  recoveredRecipientPhoneLookupKey: string;
  threadId: string;
}): Promise<Map<string, HostedLinqGroupLineRecoveryAuthority>> {
  const candidates = input.candidates.flatMap((candidate) =>
    isHostedPreparedPendingGroupSetupCandidateBaseEligible(candidate)
    && candidate.originalRecipientPhone
    && candidate.originalRecipientPhoneLookupKeys.includes(
      candidate.recipientPhoneLookupKey,
    )
    && !candidate.originalRecipientPhoneLookupKeys.includes(
      input.recoveredRecipientPhoneLookupKey,
    )
      ? [{
          memberId: candidate.ownerMemberId,
          originalRecipientPhone: candidate.originalRecipientPhone,
          pendingGroupSetupId: candidate.id,
          setupArmedAt: candidate.armedAt,
        }]
      : []
  );
  return readHostedLinqGroupLineRecoveryAuthoritiesTx({
    candidates,
    occurredAt: input.occurredAt,
    prisma: input.prisma,
    recoveredRecipientPhoneLookupKey:
      input.recoveredRecipientPhoneLookupKey,
    threadId: input.threadId,
  });
}

async function revalidateLockedHostedPendingGroupSetupClaim(input: {
  incomingRecipientPhoneLookupKeys: readonly string[];
  now: Date;
  occurredAt: Date;
  participantMemberIds: readonly string[];
  prepared: HostedPreparedPendingGroupSetupPackage;
  recoveredRecipientPhoneLookupKey: string | null;
  selection: NonNullable<HostedPreparedPendingGroupSetupSelection>;
  senderMemberId: string | null;
  threadId: string | null;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const live = await readHostedPendingGroupSetupLiveClaimFacts({
    incomingRecipientPhoneLookupKeys: input.incomingRecipientPhoneLookupKeys,
    now: input.now,
    occurredAt: input.occurredAt,
    ownerMemberIds: input.participantMemberIds,
    prisma: input.tx,
  });
  if (
    !input.incomingRecipientPhoneLookupKeys.some((key) =>
      live.managedLineLookupKeys.has(key)
    )
    || !hasSameHostedPendingGroupSetupLiveFacts({
      live,
      prepared: input.prepared,
    })
  ) {
    throwHostedPendingGroupSetupPreparationRequired();
  }
  const recoveryAuthorities =
    input.recoveredRecipientPhoneLookupKey && input.threadId
      ? await readHostedPendingGroupSetupRecoveryAuthorities({
          candidates: input.prepared.candidates,
          occurredAt: input.occurredAt,
          prisma: input.tx,
          recoveredRecipientPhoneLookupKey:
            input.recoveredRecipientPhoneLookupKey,
          threadId: input.threadId,
        })
      : new Map<string, HostedLinqGroupLineRecoveryAuthority>();
  if ([...recoveryAuthorities.values()].includes("in_flight")) {
    throwHostedLinqGroupLineRecoveryInFlight();
  }
  if (input.prepared.candidates.some((candidate) =>
    (recoveryAuthorities.get(candidate.id) ?? "none")
      !== candidate.recoveryAuthority
  )) {
    throwHostedPendingGroupSetupPreparationRequired();
  }
  const currentCandidates = input.prepared.candidates.map((candidate) => ({
    ...candidate,
    recoveryAuthority: recoveryAuthorities.get(candidate.id) ?? "none",
  }));
  const selection = selectHostedPreparedPendingGroupSetup({
    candidates: currentCandidates,
    incomingRecipientPhoneLookupKeys:
      input.incomingRecipientPhoneLookupKeys,
    senderMemberId: input.senderMemberId,
  });
  if (
    !hasSameHostedPreparedPendingGroupSetupSelection(
      selection,
      input.prepared.selected,
    )
    || !hasSameHostedPreparedPendingGroupSetupSelection(
      selection,
      input.selection,
    )
  ) {
    throwHostedPendingGroupSetupPreparationRequired();
  }
  const selected = currentCandidates.find((candidate) =>
    candidate.id === input.selection.candidateId
  );
  if (
    !selected
    || !input.participantMemberIds.includes(selected.ownerMemberId)
    || !isHostedPreparedPendingGroupSetupCandidateBaseEligible(selected)
    || (
      input.selection.admissionKind === "replacement_line"
      && selected.recoveryAuthority !== "accepted"
    )
  ) {
    throwHostedPendingGroupSetupPreparationRequired();
  }
}

function selectHostedPreparedPendingGroupSetup(input: {
  candidates: readonly HostedPreparedPendingGroupSetupCandidate[];
  incomingRecipientPhoneLookupKeys: readonly string[];
  senderMemberId: string | null;
}): HostedPreparedPendingGroupSetupSelection {
  const recoveredSelection = selectHostedPendingGroupSetupCandidate({
    candidates: input.candidates.filter((candidate) =>
      isHostedPreparedPendingGroupSetupCandidateBaseEligible(candidate)
      && candidate.recoveryAuthority === "accepted"
    ),
    senderMemberId: input.senderMemberId,
  });
  if (recoveredSelection.kind === "selected") {
    return {
      admissionKind: "replacement_line",
      candidateId: recoveredSelection.candidate.id,
      reason: recoveredSelection.reason,
    };
  }
  const incomingSelection = selectHostedPendingGroupSetupCandidate({
    candidates: input.candidates.filter((candidate) =>
      isHostedPreparedPendingGroupSetupCandidateBaseEligible(candidate)
      && input.incomingRecipientPhoneLookupKeys.includes(
        candidate.recipientPhoneLookupKey,
      )
    ),
    senderMemberId: input.senderMemberId,
  });
  return incomingSelection.kind === "selected"
    ? {
        admissionKind: "incoming_line",
        candidateId: incomingSelection.candidate.id,
        reason: incomingSelection.reason,
      }
    : null;
}

function isHostedPreparedPendingGroupSetupCandidateBaseEligible(
  candidate: HostedPreparedPendingGroupSetupCandidate,
): boolean {
  return candidate.runtimeAccessAllowed
    && candidate.originalLineManaged
    && candidate.routing?.linqRecipientPhoneLookupKey
      === candidate.recipientPhoneLookupKey
    && candidate.originalRecipientPhoneLookupKeys.includes(
      candidate.recipientPhoneLookupKey,
    );
}

function hasSameHostedPreparedPendingGroupSetupSelection(
  left: HostedPreparedPendingGroupSetupSelection,
  right: HostedPreparedPendingGroupSetupSelection,
): boolean {
  return left?.admissionKind === right?.admissionKind
    && left?.candidateId === right?.candidateId
    && left?.reason === right?.reason;
}

function hasSameHostedPendingGroupSetupRow(
  left: HostedPendingGroupSetupRow,
  right: HostedPendingGroupSetupRow,
): boolean {
  return left.id === right.id
    && left.ownerMemberId === right.ownerMemberId
    && left.recipientPhoneLookupKey === right.recipientPhoneLookupKey
    && left.payloadEncrypted === right.payloadEncrypted
    && left.armedAt.getTime() === right.armedAt.getTime()
    && left.expiresAt.getTime() === right.expiresAt.getTime();
}

function hasSameHostedMemberRoutingHomeLinqRecord(
  left: HostedMemberRoutingHomeLinqRecipientPhoneRecord | null,
  right: HostedMemberRoutingHomeLinqRecipientPhoneRecord | null,
): boolean {
  return left?.memberId === right?.memberId
    && left?.linqRecipientPhoneLookupKey
      === right?.linqRecipientPhoneLookupKey
    && left?.linqRecipientPhoneEncrypted
      === right?.linqRecipientPhoneEncrypted;
}

function assertHostedPreparedPendingGroupSetupContext(input: {
  incomingRecipientPhoneLookupKeys: readonly string[];
  occurredAt: Date;
  participantMemberIds: readonly string[];
  prepared: HostedPreparedPendingGroupSetupPackage;
  recoveredRecipientPhoneLookupKey: string | null;
  senderMemberId: string | null;
  threadId: string | null;
}): void {
  if (
    input.prepared.occurredAt.getTime() !== input.occurredAt.getTime()
    || !hasSameStringSet(
      input.prepared.participantMemberIds,
      input.participantMemberIds,
    )
    || !hasSameStringSet(
      input.prepared.incomingRecipientPhoneLookupKeys,
      input.incomingRecipientPhoneLookupKeys,
    )
    || input.prepared.recoveredRecipientPhoneLookupKey
      !== input.recoveredRecipientPhoneLookupKey
    || input.prepared.senderMemberId !== input.senderMemberId
    || input.prepared.threadId !== input.threadId
  ) {
    throwHostedPendingGroupSetupPreparationRequired();
  }
}

async function prewarmHostedPendingGroupSetupPayloadRoot(input: {
  prisma: PrismaClient;
  row: HostedPendingGroupSetupRow;
}): Promise<void> {
  const reference = readHostedSecureBoxRootReference({
    userId: input.row.ownerMemberId,
    value: input.row.payloadEncrypted,
  });
  if (!reference) {
    return;
  }
  if (!getHostedDomainRootUnwrapCache()) {
    throw new Error(
      "Pending group setup root preparation requires a request-scoped unwrap cache.",
    );
  }
  const roots = await unwrapHostedDomainRootsForWebByRootKeyIds({
    prisma: input.prisma,
    references: [reference],
    retainFailureInScopedCache: true,
  });
  for (const root of roots) {
    root.rootKey.fill(0);
  }
}

function readHostedSecureBoxRootReference(input: {
  userId: string;
  value: string | null;
}) {
  if (!input.value) {
    return null;
  }
  try {
    const envelope = parseSerializedHostedSecureBoxEnvelope(input.value);
    const domain = getHostedCryptoDomainForLane(
      HOSTED_PENDING_GROUP_SETUP_PRIVATE_FIELD_LANE,
    );
    return envelope.domain === domain
      ? { domain, rootKeyId: envelope.rootKeyId, userId: input.userId }
      : null;
  } catch {
    return null;
  }
}

async function deleteHostedPendingGroupSetupTx(input: {
  id: string;
  ownerMemberId: string;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  return (await input.tx.$executeRaw(Prisma.sql`
    DELETE FROM "hosted_pending_group_setup"
    WHERE "id" = ${input.id}
      AND "owner_member_id" = ${input.ownerMemberId}
      AND "channel" = ${HOSTED_PENDING_GROUP_SETUP_CHANNEL}
  `)) > 0;
}

function projectHostedPendingGroupSetupSnapshot(
  row: HostedPendingGroupSetupRow,
  setup: HostedRuntimePendingGroupSetupInput,
): HostedPendingGroupSetupSnapshot {
  return {
    armedAt: row.armedAt,
    channel: HOSTED_PENDING_GROUP_SETUP_CHANNEL,
    expiresAt: row.expiresAt,
    id: row.id,
    ownerMemberId: row.ownerMemberId,
    recipientPhoneLookupKey: row.recipientPhoneLookupKey,
    setup,
  };
}

async function openHostedPendingGroupSetupPayload(input: {
  prisma: HostedPendingGroupSetupClient;
  retainFailureInScopedCache?: boolean;
  row: HostedPendingGroupSetupRow;
}): Promise<HostedRuntimePendingGroupSetupInput> {
  const [serialized] = await openHostedUserSecureBoxStrings({
    entries: [{
      aad: buildHostedPendingGroupSetupPayloadAad(input.row.id),
      scope: HOSTED_PENDING_GROUP_SETUP_PAYLOAD_SCOPE,
      userId: input.row.ownerMemberId,
      value: input.row.payloadEncrypted,
    }],
    lane: HOSTED_PENDING_GROUP_SETUP_PRIVATE_FIELD_LANE,
    prisma: input.prisma,
    ...(input.retainFailureInScopedCache === undefined
      ? {}
      : { retainFailureInScopedCache: input.retainFailureInScopedCache }),
  });
  if (!serialized) {
    throw new TypeError("Pending group setup payload is missing.");
  }
  return parseHostedPendingGroupSetupPayloadEnvelope(JSON.parse(serialized));
}

function parseHostedPendingGroupSetupPayloadEnvelope(
  value: unknown,
): HostedRuntimePendingGroupSetupInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Pending group setup payload must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => key !== "schemaVersion" && key !== "setup",
    )
    || record.schemaVersion
      !== HOSTED_RUNTIME_PENDING_GROUP_SETUP_SCHEMA_VERSION
  ) {
    throw new TypeError("Pending group setup payload version is unsupported.");
  }
  return parseHostedRuntimePendingGroupSetupInput(record.setup);
}

function buildHostedPendingGroupSetupPayloadAad(id: string) {
  return {
    field: "payload_encrypted",
    purpose: "pending-group-setup",
    rowId: id,
    table: "hosted_pending_group_setup",
  } as const;
}

function throwHostedPendingGroupSetupPreparationRequired(): never {
  throw hostedOnboardingError({
    code: "HOSTED_PENDING_GROUP_SETUP_PREPARATION_REQUIRED",
    httpStatus: 503,
    message: "Fresh pending group setup preparation is required.",
    retryable: true,
  });
}

function throwHostedLinqGroupLineRecoveryInFlight(): never {
  throw hostedOnboardingError({
    code: "HOSTED_LINQ_GROUP_LINE_RECOVERY_IN_FLIGHT",
    httpStatus: 503,
    message:
      "The group line recovery message is still recovering. Retry this webhook after the current delivery attempt completes.",
    retryable: true,
  });
}

function normalizeLookupKeys(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeNullableString).filter(
    (value): value is string => value !== null,
  ))];
}

function hasSameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = normalizeLookupKeys(left).sort();
  const normalizedRight = normalizeLookupKeys(right).sort();
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
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
