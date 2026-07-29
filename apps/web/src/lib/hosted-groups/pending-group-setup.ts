import "server-only";

import {
  assistantPersonaIdSchema,
  assistantPersonalityScoreSchema,
  assistantPersonalitySettingIds,
  assistantTonePreferenceSchema,
  assistantVoiceOptionIdSchema,
  type AssistantPersonaId,
  type AssistantPersonalitySettingId,
  type AssistantTonePreference,
  type AssistantVoiceOptionId,
} from "@murphai/contracts";
import { Prisma, type PrismaClient } from "@prisma/client";

import {
  openHostedUserSecureBoxString,
  sealHostedUserSecureBoxString,
} from "../hosted-crypto/secure-box";
import { isHostedMemberSuspended } from "../hosted-onboarding/entitlement";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  readHostedRuntimeAiAccessDecision,
} from "../hosted-onboarding/member-access";
import { generateHostedRandomPrefixedId, normalizeNullableString } from "../primitives";
import { getPrisma } from "../prisma";

export const HOSTED_PENDING_GROUP_SETUP_TTL_MS = 30 * 60 * 1_000;
export const HOSTED_PENDING_GROUP_SETUP_MAX_PARTICIPANT_MEMBERS = 32;
export const HOSTED_PENDING_GROUP_SETUP_ROOM_CONTEXT_MAX_BYTES = 4 * 1_024;
export const HOSTED_PENDING_GROUP_SETUP_SCHEMA_VERSION = 1;

const HOSTED_PENDING_GROUP_SETUP_CHANNEL = "linq" as const;
const HOSTED_PENDING_GROUP_SETUP_PAYLOAD_SCOPE =
  "hosted-pending-group-setup:payload:v1";

export type HostedPendingGroupSetupChannel =
  typeof HOSTED_PENDING_GROUP_SETUP_CHANNEL;

export interface HostedPendingGroupSetupStyle {
  persona?: AssistantPersonaId;
  personality?: Partial<Record<AssistantPersonalitySettingId, number | null>>;
  tone?: AssistantTonePreference;
  voice?: AssistantVoiceOptionId;
}

export interface HostedPendingGroupSetupPayloadV1 {
  roomContextMarkdown?: string;
  schemaVersion: typeof HOSTED_PENDING_GROUP_SETUP_SCHEMA_VERSION;
  style?: HostedPendingGroupSetupStyle;
}

export interface HostedPendingGroupSetupSnapshot {
  armedAt: Date;
  channel: HostedPendingGroupSetupChannel;
  expiresAt: Date;
  id: string;
  ownerMemberId: string;
  payload: HostedPendingGroupSetupPayloadV1;
  recipientPhoneLookupKey: string;
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
        "ambiguous" | "claim_raced" | "invalid_payload" | "no_candidates"
      >;
    };

export interface HostedPendingGroupSetupRestoreToken {
  armedAt: Date;
  expiresAt: Date;
  id: string;
  ownerMemberId: string;
  payloadEncrypted: string;
  recipientPhoneLookupKey: string;
}

export async function armHostedPendingGroupSetupTx(input: {
  now?: Date;
  ownerMemberId: string;
  payload: unknown;
  recipientPhoneLookupKey: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedPendingGroupSetupSnapshot> {
  const ownerMemberId = requireNonEmptyString(
    input.ownerMemberId,
    "pending group setup owner member id",
  );
  const recipientPhoneLookupKey = requireNonEmptyString(
    input.recipientPhoneLookupKey,
    "pending group setup recipient phone lookup key",
  );
  const now = requireValidDate(input.now ?? new Date(), "pending group setup armed at");
  const expiresAt = new Date(now.getTime() + HOSTED_PENDING_GROUP_SETUP_TTL_MS);
  const payload = normalizeHostedPendingGroupSetupPayload(input.payload);

  const owner = await input.tx.hostedMember.findUnique({
    select: { id: true, suspendedAt: true },
    where: { id: ownerMemberId },
  });
  if (
    !owner
    || isHostedMemberSuspended(owner.suspendedAt)
    || !(await readHostedRuntimeAiAccessDecision({
      memberId: ownerMemberId,
      now,
      prisma: input.tx,
    })).allowed
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_PENDING_GROUP_SETUP_ACTIVE_MEMBER_REQUIRED",
      httpStatus: 403,
      message: "An active Murph member is required to prepare a group.",
      retryable: false,
    });
  }

  const id = generateHostedRandomPrefixedId("hpgs");
  const payloadEncrypted = await sealHostedUserSecureBoxString({
    aad: buildHostedPendingGroupSetupPayloadAad(id),
    lane: "hosted-member-private-field",
    prisma: input.tx,
    scope: HOSTED_PENDING_GROUP_SETUP_PAYLOAD_SCOPE,
    userId: ownerMemberId,
    value: JSON.stringify(payload),
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
      ${recipientPhoneLookupKey}, ${payloadEncrypted}, ${now}, ${expiresAt}, ${now}, ${now}
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
  return projectHostedPendingGroupSetupSnapshot(row, payload);
}

export async function readHostedPendingGroupSetup(input: {
  now?: Date;
  ownerMemberId: string;
  prisma?: PrismaClient;
}): Promise<HostedPendingGroupSetupSnapshot | null> {
  const ownerMemberId = normalizeNullableString(input.ownerMemberId);
  if (!ownerMemberId) {
    return null;
  }
  const now = requireValidDate(input.now ?? new Date(), "pending group setup read time");
  const prisma = input.prisma ?? getPrisma();
  const rows = await prisma.$queryRaw<HostedPendingGroupSetupRow[]>(Prisma.sql`
    SELECT
      "id",
      "owner_member_id" AS "ownerMemberId",
      "recipient_phone_lookup_key" AS "recipientPhoneLookupKey",
      "payload_encrypted" AS "payloadEncrypted",
      "armed_at" AS "armedAt",
      "expires_at" AS "expiresAt"
    FROM "hosted_pending_group_setup"
    WHERE "owner_member_id" = ${ownerMemberId}
      AND "channel" = ${HOSTED_PENDING_GROUP_SETUP_CHANNEL}
      AND "expires_at" > ${now}
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) {
    return null;
  }
  try {
    return projectHostedPendingGroupSetupSnapshot(
      row,
      await openHostedPendingGroupSetupPayload({
        prisma,
        row,
      }),
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
  recipientPhoneLookupKey: string;
  senderMemberId?: string | null;
  tx: Prisma.TransactionClient;
}): Promise<HostedPendingGroupSetupClaimResult> {
  const participantMemberIds = normalizeBoundedMemberIds(input.participantMemberIds);
  if (participantMemberIds.length === 0) {
    return { kind: "none", reason: "no_candidates" };
  }
  const recipientPhoneLookupKey = requireNonEmptyString(
    input.recipientPhoneLookupKey,
    "pending group setup recipient phone lookup key",
  );
  const now = requireValidDate(input.now ?? new Date(), "pending group setup claim time");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const candidateRows = await readCandidateRowsTx({
      now,
      ownerMemberIds: participantMemberIds,
      recipientPhoneLookupKey,
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

    const claimedRows = await input.tx.$queryRaw<HostedPendingGroupSetupRow[]>(Prisma.sql`
      DELETE FROM "hosted_pending_group_setup"
      WHERE "id" = ${selection.candidate.id}
        AND "owner_member_id" = ${selection.candidate.ownerMemberId}
        AND "channel" = ${HOSTED_PENDING_GROUP_SETUP_CHANNEL}
        AND "recipient_phone_lookup_key" = ${recipientPhoneLookupKey}
        AND "expires_at" > ${now}
      RETURNING
        "id",
        "owner_member_id" AS "ownerMemberId",
        "recipient_phone_lookup_key" AS "recipientPhoneLookupKey",
        "payload_encrypted" AS "payloadEncrypted",
        "armed_at" AS "armedAt",
        "expires_at" AS "expiresAt"
    `);
    const claimed = claimedRows[0];
    if (!claimed) {
      continue;
    }
    try {
      const payload = await openHostedPendingGroupSetupPayload({
        prisma: input.tx,
        row: claimed,
      });
      return {
        claimToken: { ...claimed },
        kind: "claimed",
        reason: selection.reason,
        setup: projectHostedPendingGroupSetupSnapshot(claimed, payload),
      };
    } catch {
      // Arm validates payloads. Corrupt or future bytes are consumed rather than
      // wedging every new group containing this member.
      return { kind: "none", reason: "invalid_payload" };
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
      "payload_encrypted", "armed_at", "expires_at", "created_at", "updated_at"
    )
    VALUES (
      ${token.id}, ${token.ownerMemberId}, ${HOSTED_PENDING_GROUP_SETUP_CHANNEL},
      ${token.recipientPhoneLookupKey}, ${token.payloadEncrypted},
      ${token.armedAt}, ${token.expiresAt}, ${token.armedAt}, ${token.armedAt}
    )
    ON CONFLICT ("owner_member_id") DO NOTHING
  `)) > 0;
}

export function normalizeHostedPendingGroupSetupPayload(
  value: unknown,
): HostedPendingGroupSetupPayloadV1 {
  const record = requireStrictObject(value, "Pending group setup payload");
  assertOnlyKeys(record, ["roomContextMarkdown", "schemaVersion", "style"]);
  if (record.schemaVersion !== HOSTED_PENDING_GROUP_SETUP_SCHEMA_VERSION) {
    throw new TypeError("Pending group setup schema version is invalid.");
  }

  const roomContextMarkdown = Object.hasOwn(record, "roomContextMarkdown")
    ? normalizeHostedPendingGroupSetupRoomContext(record.roomContextMarkdown)
    : undefined;
  const style = Object.hasOwn(record, "style")
    ? normalizeHostedPendingGroupSetupStyle(record.style)
    : undefined;
  if (roomContextMarkdown === undefined && style === undefined) {
    throw new TypeError("Pending group setup requires style or room context.");
  }

  return {
    ...(roomContextMarkdown === undefined ? {} : { roomContextMarkdown }),
    schemaVersion: HOSTED_PENDING_GROUP_SETUP_SCHEMA_VERSION,
    ...(style === undefined ? {} : { style }),
  };
}

function normalizeHostedPendingGroupSetupStyle(
  value: unknown,
): HostedPendingGroupSetupStyle {
  const record = requireStrictObject(value, "Pending group setup style");
  assertOnlyKeys(record, ["persona", "personality", "tone", "voice"]);
  const style: HostedPendingGroupSetupStyle = {};

  if (Object.hasOwn(record, "persona")) {
    style.persona = parseContractValue(
      assistantPersonaIdSchema,
      record.persona,
      "Pending group setup persona is invalid.",
    );
  }
  if (Object.hasOwn(record, "tone")) {
    style.tone = parseContractValue(
      assistantTonePreferenceSchema,
      record.tone,
      "Pending group setup tone is invalid.",
    );
  }
  if (Object.hasOwn(record, "voice")) {
    style.voice = parseContractValue(
      assistantVoiceOptionIdSchema,
      record.voice,
      "Pending group setup voice is invalid.",
    );
  }
  if (Object.hasOwn(record, "personality")) {
    const personalityRecord = requireStrictObject(
      record.personality,
      "Pending group setup personality",
    );
    assertOnlyKeys(personalityRecord, assistantPersonalitySettingIds);
    if (Object.keys(personalityRecord).length === 0) {
      throw new TypeError(
        "Pending group setup personality requires at least one setting.",
      );
    }
    const personality: HostedPendingGroupSetupStyle["personality"] = {};
    for (const setting of assistantPersonalitySettingIds) {
      if (!Object.hasOwn(personalityRecord, setting)) {
        continue;
      }
      const settingValue = personalityRecord[setting];
      personality[setting] = settingValue === null
        ? null
        : parseContractValue(
            assistantPersonalityScoreSchema,
            settingValue,
            `Pending group setup ${setting} is invalid.`,
          );
    }
    style.personality = personality;
  }

  if (Object.keys(style).length === 0) {
    throw new TypeError("Pending group setup style requires at least one setting.");
  }
  return style;
}

function normalizeHostedPendingGroupSetupRoomContext(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("Pending group setup room context must be text.");
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError("Pending group setup room context must not be empty.");
  }
  if (
    new TextEncoder().encode(normalized).byteLength
      > HOSTED_PENDING_GROUP_SETUP_ROOM_CONTEXT_MAX_BYTES
  ) {
    throw new TypeError("Pending group setup room context is too large.");
  }
  return normalized;
}

function parseContractValue<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  value: unknown,
  message: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(message);
  }
  return parsed.data;
}

function requireStrictObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown) {
    throw new TypeError(`Pending group setup field ${unknown} is not supported.`);
  }
}

async function readCandidateRowsTx(input: {
  now: Date;
  ownerMemberIds: readonly string[];
  recipientPhoneLookupKey: string;
  tx: Prisma.TransactionClient;
}): Promise<HostedPendingGroupSetupRow[]> {
  return await input.tx.$queryRaw<HostedPendingGroupSetupRow[]>(Prisma.sql`
    SELECT
      setup."id",
      setup."owner_member_id" AS "ownerMemberId",
      setup."recipient_phone_lookup_key" AS "recipientPhoneLookupKey",
      setup."payload_encrypted" AS "payloadEncrypted",
      setup."armed_at" AS "armedAt",
      setup."expires_at" AS "expiresAt"
    FROM "hosted_pending_group_setup" AS setup
    INNER JOIN "hosted_member" AS owner ON owner."id" = setup."owner_member_id"
    WHERE setup."owner_member_id" IN (${Prisma.join(input.ownerMemberIds)})
      AND setup."channel" = ${HOSTED_PENDING_GROUP_SETUP_CHANNEL}
      AND setup."recipient_phone_lookup_key" = ${input.recipientPhoneLookupKey}
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
  const decisions = await Promise.all(input.candidates.map(async (candidate) => ({
    candidate,
    decision: await readHostedRuntimeAiAccessDecision({
      memberId: candidate.ownerMemberId,
      now: input.now,
      prisma: input.tx,
    }),
  })));
  return decisions.flatMap(({ candidate, decision }) =>
    decision.allowed ? [candidate] : []
  );
}

async function openHostedPendingGroupSetupPayload(input: {
  prisma: PrismaClient | Prisma.TransactionClient;
  row: HostedPendingGroupSetupRow;
}): Promise<HostedPendingGroupSetupPayloadV1> {
  const serialized = await openHostedUserSecureBoxString({
    aad: buildHostedPendingGroupSetupPayloadAad(input.row.id),
    lane: "hosted-member-private-field",
    prisma: input.prisma,
    scope: HOSTED_PENDING_GROUP_SETUP_PAYLOAD_SCOPE,
    userId: input.row.ownerMemberId,
    value: input.row.payloadEncrypted,
  });
  if (!serialized) {
    throw new TypeError("Pending group setup payload is missing.");
  }
  return normalizeHostedPendingGroupSetupPayload(JSON.parse(serialized) as unknown);
}

function projectHostedPendingGroupSetupSnapshot(
  row: HostedPendingGroupSetupRow,
  payload: HostedPendingGroupSetupPayloadV1,
): HostedPendingGroupSetupSnapshot {
  return {
    armedAt: row.armedAt,
    channel: HOSTED_PENDING_GROUP_SETUP_CHANNEL,
    expiresAt: row.expiresAt,
    id: row.id,
    ownerMemberId: row.ownerMemberId,
    payload,
    recipientPhoneLookupKey: row.recipientPhoneLookupKey,
  };
}

function buildHostedPendingGroupSetupPayloadAad(id: string) {
  return {
    field: "payload_encrypted",
    purpose: "pending-group-setup",
    rowId: id,
    table: "hosted_pending_group_setup",
  } as const;
}

function normalizeBoundedMemberIds(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeNullableString).filter(
    (value): value is string => value !== null,
  ))].slice(0, HOSTED_PENDING_GROUP_SETUP_MAX_PARTICIPANT_MEMBERS);
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
