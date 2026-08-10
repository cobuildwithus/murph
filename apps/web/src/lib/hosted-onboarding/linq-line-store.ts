import { Prisma, type PrismaClient } from "@prisma/client";

import type { ParsedHostedLinqProviderEvent } from "./linq-provider-events";
import {
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
  readHostedPhoneHint,
} from "./contact-privacy";
import {
  type HostedLinqProviderEventProgress,
  createHostedLinqProviderEventProgress,
} from "./linq-provider-event-progress";
import {
  decryptHostedLinqLinePhoneNumber,
  encryptHostedLinqLinePhoneNumber,
} from "./linq-line-phone-codec";
import { evaluateHostedLinqEgressPolicy } from "./linq-egress-policy";
import {
  parseHostedLinqLineReputationStatus,
  parseHostedLinqLineServiceStatus,
  type HostedLinqLineReputationStatus,
  type HostedLinqLineServiceStatus,
} from "./linq-provider-status";
import { hostedOnboardingError } from "./errors";
import { normalizePhoneNumber } from "./phone";
import { normalizeNullableString } from "./shared";

type HostedLinqLineClient = PrismaClient | Prisma.TransactionClient;

export const HOSTED_LINQ_ASSIGNABLE_HOME_LINE_LIMIT = 250;
export const HOSTED_LINQ_RECENT_MESSAGE_LOAD_WINDOW_MS =
  7 * 24 * 60 * 60 * 1_000;

export type HostedLinqAssignableHomeLine = {
  assignmentWeight: number;
  maxNewConversationsPerDay: number | null;
  phoneNumber: string;
  phoneNumberHint: string;
  phoneNumberLookupKey: string;
  proactiveConversationCount: number | null;
  proactiveConversationDayUtc: Date | null;
};

export type HostedLinqContactCardLine = {
  /**
   * Only configured lines can own a member conversation, so consumers must
   * be able to judge configured-pool health without re-querying.
   */
  isConfigured: boolean;
  phoneNumber: string;
  phoneNumberHint: string;
  phoneNumberLookupKey: string;
  providerReputationStatus: HostedLinqLineReputationStatus | null;
  providerServiceStatus: HostedLinqLineServiceStatus | null;
};

type HostedLinqAssignableHomeLineRow = {
  assignmentWeight: number;
  maxNewConversationsPerDay: number | null;
  phoneNumberEncrypted: string | null;
  phoneNumberHint: string;
  phoneNumberLookupKey: string;
  proactiveConversationCount: number | null;
  proactiveConversationDayUtc: Date | null;
};

type HostedLinqContactCardLineRow = {
  configuredAt: Date | null;
  phoneNumberEncrypted: string | null;
  phoneNumberHint: string;
  phoneNumberLookupKey: string;
  providerReputationStatus: string | null;
  providerServiceStatus: string | null;
};

export type PreparedHostedLinqLinePhone = {
  currentLookupKey: string;
  lookupKeyReadCandidates: readonly string[];
  normalizedPhoneNumber: string;
  phoneNumberEncrypted: string;
  phoneNumberHint: string;
};

/**
 * Freezes every privacy-derived value before a multi-line transaction begins.
 * The sorted result also gives both bulk writers one deterministic row order.
 */
export function prepareHostedLinqLinePhones(input: {
  maxLines: number;
  phoneNumbers: readonly string[];
}): PreparedHostedLinqLinePhone[] {
  const preparedByCurrentLookupKey = new Map<string, PreparedHostedLinqLinePhone>();

  for (const phoneNumber of input.phoneNumbers) {
    const normalizedPhoneNumber = normalizePhoneNumber(phoneNumber);
    const currentLookupKey = createHostedPhoneLookupKey(normalizedPhoneNumber);
    const lookupKeyReadCandidates =
      createHostedPhoneLookupKeyReadCandidates(normalizedPhoneNumber);
    const phoneNumberEncrypted =
      encryptHostedLinqLinePhoneNumber(normalizedPhoneNumber);
    const phoneNumberHint = readHostedPhoneHint(normalizedPhoneNumber);

    if (
      !normalizedPhoneNumber
      || !currentLookupKey
      || lookupKeyReadCandidates.length === 0
      || !phoneNumberEncrypted
      || !phoneNumberHint
    ) {
      throw new TypeError("Hosted Linq line synchronization requires a valid phone number.");
    }

    preparedByCurrentLookupKey.set(currentLookupKey, {
      currentLookupKey,
      lookupKeyReadCandidates,
      normalizedPhoneNumber,
      phoneNumberEncrypted,
      phoneNumberHint,
    });
  }

  if (preparedByCurrentLookupKey.size > input.maxLines) {
    throw new RangeError(
      `Hosted Linq line synchronization requires at most ${input.maxLines} unique phone number(s).`,
    );
  }

  return [...preparedByCurrentLookupKey.values()].sort((left, right) =>
    left.currentLookupKey.localeCompare(right.currentLookupKey)
  );
}

export async function upsertHostedLinqLineForPhoneTx(input: {
  /** @deprecated Additive-rollout compatibility; assignment does not read it. */
  activeMemberLimit?: number | null;
  observedAt: Date;
  phoneNumber: string;
  prisma: HostedLinqLineClient;
  providerPhoneNumberId?: string | null;
  providerReason?: string | null;
  providerStatus?: string | null;
  source: "configured" | "provider" | "webhook";
}) {
  if ("$transaction" in input.prisma && typeof input.prisma.$transaction === "function") {
    return input.prisma.$transaction((tx) => upsertHostedLinqLineForPhoneInTransaction({
      ...input,
      prisma: tx,
    }));
  }

  return upsertHostedLinqLineForPhoneInTransaction(input);
}

async function upsertHostedLinqLineForPhoneInTransaction(input: {
  /** @deprecated Additive-rollout compatibility; assignment does not read it. */
  activeMemberLimit?: number | null;
  observedAt: Date;
  phoneNumber: string;
  prisma: HostedLinqLineClient;
  providerPhoneNumberId?: string | null;
  providerReason?: string | null;
  providerStatus?: string | null;
  source: "configured" | "provider" | "webhook";
}) {
  const normalizedPhoneNumber = normalizePhoneNumber(input.phoneNumber);
  const lookupKey = createHostedPhoneLookupKey(normalizedPhoneNumber);
  const lookupKeyReadCandidates = createHostedPhoneLookupKeyReadCandidates(normalizedPhoneNumber);

  if (!normalizedPhoneNumber || !lookupKey || lookupKeyReadCandidates.length === 0) {
    throw new TypeError("Hosted Linq line upsert requires a valid phone number.");
  }

  await acquireHostedLinqLinePhoneLockTx({
    phoneNumber: normalizedPhoneNumber,
    prisma: input.prisma,
  });

  const providerStatus = normalizeNullableString(input.providerStatus);
  const phoneNumberEncrypted = encryptHostedLinqLinePhoneNumber(normalizedPhoneNumber);
  const existingLines = await input.prisma.hostedLinqLine.findMany({
    where: {
      phoneNumberLookupKey: {
        in: lookupKeyReadCandidates,
      },
    },
    select: {
      phoneNumberLookupKey: true,
    },
  });
  const targetLookupKey =
    chooseHostedLinqLineWriteLookupKey(existingLines, lookupKeyReadCandidates, lookupKey)
    ?? lookupKey;

  const updateData = {
    ...(input.source === "configured" ? { configuredAt: input.observedAt } : {}),
    ...(input.source === "provider"
      ? {
          providerLastSeenAt: input.observedAt,
          providerSeenAt: input.observedAt,
        }
      : {}),
    phoneNumberEncrypted,
    phoneNumberHint: readHostedPhoneHint(normalizedPhoneNumber),
    ...(input.providerPhoneNumberId === undefined
      ? {}
      : { providerPhoneNumberId: normalizeNullableString(input.providerPhoneNumberId) }),
    ...(input.providerReason === undefined
      ? {}
      : { providerReason: normalizeNullableString(input.providerReason) }),
    ...(input.providerStatus === undefined
      ? {}
      : {
          providerStatus,
          providerUpdatedAt: input.observedAt,
        }),
    ...(input.source === "configured" ? { source: input.source } : {}),
  } satisfies Prisma.HostedLinqLineUpdateInput;

  const createData = {
    assignmentWeight: 100,
    ...(input.activeMemberLimit === undefined ? {} : { activeMemberLimit: input.activeMemberLimit }),
    configuredAt: input.source === "configured" ? input.observedAt : null,
    egressPolicy: "enabled",
    healthStatus: "unknown",
    phoneNumberEncrypted,
    phoneNumberHint: readHostedPhoneHint(normalizedPhoneNumber),
    phoneNumberLookupKey: lookupKey,
    providerFirstSeenAt: input.source === "provider" ? input.observedAt : null,
    providerLastSeenAt: input.source === "provider" ? input.observedAt : null,
    providerPhoneNumberId: normalizeNullableString(input.providerPhoneNumberId),
    providerReason: normalizeNullableString(input.providerReason),
    providerSeenAt: input.source === "provider" ? input.observedAt : null,
    providerStatus,
    providerUpdatedAt: input.providerStatus === undefined ? null : input.observedAt,
    source: input.source,
  } satisfies Prisma.HostedLinqLineCreateInput;

  const line = targetLookupKey === lookupKey && existingLines.length === 0
    ? await input.prisma.hostedLinqLine.upsert({
        where: {
          phoneNumberLookupKey: lookupKey,
        },
        create: createData,
        update: updateData,
      })
    : await input.prisma.hostedLinqLine.update({
        where: {
          phoneNumberLookupKey: targetLookupKey,
        },
        data: updateData,
      });

  if (input.source === "provider") {
    await input.prisma.hostedLinqLine.updateMany({
      where: {
        phoneNumberLookupKey: line.phoneNumberLookupKey,
        providerFirstSeenAt: null,
      },
      data: {
        providerFirstSeenAt: input.observedAt,
      },
    });
  }

  if (
    input.source === "configured"
    && input.activeMemberLimit !== undefined
    && input.activeMemberLimit !== null
  ) {
    await input.prisma.hostedLinqLine.updateMany({
      where: {
        activeMemberLimit: null,
        phoneNumberLookupKey: line.phoneNumberLookupKey,
      },
      data: {
        activeMemberLimit: input.activeMemberLimit,
      },
    });
  }

  return line;
}

async function acquireHostedLinqLinePhoneLockTx(input: {
  phoneNumber: string;
  prisma: HostedLinqLineClient;
}): Promise<void> {
  await input.prisma.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext('hosted_linq_line_phone'),
      hashtext(${input.phoneNumber})
    )
  `;
}

function chooseHostedLinqLineWriteLookupKey(
  existingLines: readonly { phoneNumberLookupKey: string }[],
  lookupKeyReadCandidates: readonly string[],
  currentLookupKey: string,
): string | null {
  const existingLookupKeys = new Set(
    existingLines.map((line) => line.phoneNumberLookupKey),
  );
  if (existingLookupKeys.has(currentLookupKey)) {
    return currentLookupKey;
  }
  return lookupKeyReadCandidates.find((candidate) => existingLookupKeys.has(candidate)) ?? null;
}

export async function acquireHostedLinqInventoryApplyLockTx(input: {
  prisma: HostedLinqLineClient;
}): Promise<void> {
  await input.prisma.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext('hosted_linq_phone_number_inventory'),
      hashtext('snapshot')
    )
  `;
}

export async function syncHostedLinqConfiguredLinesTx(input: {
  /**
   * Additive-rollout compatibility for previous application builds only.
   * Weighted assignment never reads this value; remove the column and env
   * seam after no rollback target still owns the legacy direct-member policy.
   */
  activeMemberLimit: number | null;
  observedAt?: Date;
  phoneNumbers: readonly string[];
  prisma: HostedLinqLineClient;
}): Promise<void> {
  const observedAt = input.observedAt ?? new Date();
  const lines = prepareHostedLinqLinePhones({
    maxLines: HOSTED_LINQ_ASSIGNABLE_HOME_LINE_LIMIT,
    phoneNumbers: input.phoneNumbers,
  });
  if (lines.length === 0) {
    return;
  }

  const apply = async (prisma: HostedLinqLineClient) => {
    await acquireHostedLinqInventoryApplyLockTx({ prisma });
    await prisma.$queryRaw<Array<{ syncedCount: bigint }>>(
      buildHostedLinqConfiguredLineSnapshotQuery({
        activeMemberLimit: input.activeMemberLimit,
        lines,
        observedAt,
      }),
    );
  };

  if ("$transaction" in input.prisma && typeof input.prisma.$transaction === "function") {
    const prisma = input.prisma;
    await prisma.$transaction((tx) => apply(tx));
    return;
  }

  await apply(input.prisma);
}

function buildHostedLinqConfiguredLineSnapshotQuery(input: {
  activeMemberLimit: number | null;
  lines: readonly PreparedHostedLinqLinePhone[];
  observedAt: Date;
}): Prisma.Sql {
  const observedAt = Prisma.sql`${input.observedAt}::timestamp`;
  const values = Prisma.join(input.lines.map((line) => Prisma.sql`(
    ${line.currentLookupKey}::text,
    ARRAY[${Prisma.join(line.lookupKeyReadCandidates)}]::text[],
    ${line.phoneNumberEncrypted}::text,
    ${line.phoneNumberHint}::text
  )`));

  return Prisma.sql`
    WITH input_line (
      current_lookup_key,
      lookup_key_candidates,
      phone_number_encrypted,
      phone_number_hint
    ) AS (
      VALUES ${values}
    ),
    locked_line AS MATERIALIZED (
      SELECT line.phone_number_lookup_key
      FROM hosted_linq_line AS line
      WHERE line.phone_number_lookup_key IN (
        SELECT candidate.lookup_key
        FROM input_line AS input
        CROSS JOIN LATERAL unnest(input.lookup_key_candidates)
          AS candidate(lookup_key)
      )
      ORDER BY line.phone_number_lookup_key
      FOR UPDATE
    ),
    lock_barrier AS MATERIALIZED (
      SELECT count(*) AS locked_count
      FROM locked_line
    ),
    resolved_line AS MATERIALIZED (
      SELECT
        input.current_lookup_key,
        COALESCE(existing.phone_number_lookup_key, input.current_lookup_key)
          AS target_lookup_key,
        input.phone_number_encrypted,
        input.phone_number_hint
      FROM input_line AS input
      CROSS JOIN lock_barrier
      LEFT JOIN LATERAL (
        SELECT line.phone_number_lookup_key
        FROM unnest(input.lookup_key_candidates) WITH ORDINALITY
          AS candidate(lookup_key, candidate_ordinal)
        INNER JOIN hosted_linq_line AS line
          ON line.phone_number_lookup_key = candidate.lookup_key
        ORDER BY
          (line.phone_number_lookup_key = input.current_lookup_key) DESC,
          candidate.candidate_ordinal
        LIMIT 1
      ) AS existing ON TRUE
    ),
    upserted_line AS (
      INSERT INTO hosted_linq_line (
        phone_number_lookup_key,
        phone_number_encrypted,
        phone_number_hint,
        source,
        configured_at,
        health_status,
        egress_policy,
        active_member_limit,
        assignment_weight,
        created_at,
        updated_at
      )
      SELECT
        resolved.target_lookup_key,
        resolved.phone_number_encrypted,
        resolved.phone_number_hint,
        'configured',
        ${observedAt},
        'unknown',
        'enabled',
        ${input.activeMemberLimit},
        100,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM resolved_line AS resolved
      ORDER BY resolved.current_lookup_key
      ON CONFLICT (phone_number_lookup_key) DO UPDATE SET
        phone_number_encrypted = EXCLUDED.phone_number_encrypted,
        phone_number_hint = EXCLUDED.phone_number_hint,
        source = 'configured',
        configured_at = EXCLUDED.configured_at,
        active_member_limit = CASE
          WHEN hosted_linq_line.active_member_limit IS NULL
            AND EXCLUDED.active_member_limit IS NOT NULL
            THEN EXCLUDED.active_member_limit
          ELSE hosted_linq_line.active_member_limit
        END,
        updated_at = CURRENT_TIMESTAMP
      RETURNING phone_number_lookup_key
    )
    SELECT count(*)::bigint AS "syncedCount"
    FROM upserted_line
  `;
}

export async function listHostedLinqAssignableHomeLines(input: {
  prisma: HostedLinqLineClient;
}): Promise<HostedLinqAssignableHomeLine[]> {
  const limit = HOSTED_LINQ_ASSIGNABLE_HOME_LINE_LIMIT;
  const rows = await input.prisma.hostedLinqLine.findMany({
    where: buildHostedLinqAssignableHomeLineWhere(),
    orderBy: [
      { assignmentWeight: "desc" },
      { phoneNumberLookupKey: "asc" },
    ],
    take: limit + 1,
    select: {
      assignmentWeight: true,
      maxNewConversationsPerDay: true,
      phoneNumberEncrypted: true,
      phoneNumberHint: true,
      phoneNumberLookupKey: true,
      proactiveConversationCount: true,
      proactiveConversationDayUtc: true,
    },
  });

  if (rows.length > limit) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_ASSIGNABLE_LINE_LIMIT_EXCEEDED",
      httpStatus: 500,
      message: `Hosted Linq assignment has more than ${limit} configured assignable line(s). Reduce the assignable pool or raise the reviewed limit before serving assignments.`,
      retryable: false,
    });
  }

  return mapHostedLinqAssignableHomeLineRows(rows);
}

/**
 * New inbound route authority must come from the managed Linq line pool, not
 * from a recipient phone supplied by the webhook alone. Existing inbound
 * authority is independent of predictive reputation so an at-risk line can
 * still receive replies and recover.
 */
export async function hasActiveHostedLinqManagedLine(input: {
  phoneNumberLookupKeys: readonly string[];
  prisma: HostedLinqLineClient;
}): Promise<boolean> {
  const phoneNumberLookupKeys = [...input.phoneNumberLookupKeys];
  if (phoneNumberLookupKeys.length === 0) {
    return false;
  }

  const line = await input.prisma.hostedLinqLine.findFirst({
    where: {
      configuredAt: { not: null },
      phoneNumberEncrypted: { not: null },
      phoneNumberLookupKey: {
        in: phoneNumberLookupKeys,
      },
    },
    select: {
      phoneNumberLookupKey: true,
    },
  });

  return line !== null;
}

export type HostedLinqIncomingLineState =
  | {
      kind: "assignable" | "at_risk" | "hard_blocked";
      phoneNumberLookupKey: string;
    }
  | {
      kind:
        | "conflicting"
        | "degraded_unavailable"
        | "structurally_unavailable"
        | "unmanaged";
    };

/**
 * Reads managed inbound-line state without reusing assignment eligibility as
 * relationship authority. Multiple privacy-key candidates must converge on
 * one row; ambiguous rows fail closed rather than selecting an arbitrary line.
 * Existing inbound authority is independent of predictive reputation so an
 * at-risk line can still receive replies and recover.
 */
export async function readHostedLinqIncomingLineState(input: {
  phoneNumberLookupKeys: readonly string[];
  prisma: HostedLinqLineClient;
}): Promise<HostedLinqIncomingLineState> {
  const phoneNumberLookupKeys = [...new Set(input.phoneNumberLookupKeys)];
  if (phoneNumberLookupKeys.length === 0) {
    return { kind: "unmanaged" };
  }

  const lines = await input.prisma.hostedLinqLine.findMany({
    where: {
      phoneNumberLookupKey: {
        in: phoneNumberLookupKeys,
      },
    },
    select: {
      configuredAt: true,
      egressPolicy: true,
      healthStatus: true,
      phoneNumberEncrypted: true,
      phoneNumberLookupKey: true,
      providerReputationStatus: true,
      providerServiceStatus: true,
    },
  });
  if (lines.length === 0) {
    return { kind: "unmanaged" };
  }
  if (lines.length !== 1) {
    return { kind: "conflicting" };
  }

  const line = lines[0]!;
  if (
    !line.configuredAt
    || !line.phoneNumberEncrypted
  ) {
    return { kind: "structurally_unavailable" };
  }

  const policy = evaluateHostedLinqEgressPolicy({
    chatHealthStatus: null,
    lineDeliveryHealthStatus: line.healthStatus,
    lineEgressPolicy: line.egressPolicy,
    lineReputationStatus: line.providerReputationStatus,
    lineServiceStatus: line.providerServiceStatus,
    newConversation: false,
  });
  if (policy.kind === "block") {
    if (policy.code === "operator_disabled") {
      return { kind: "structurally_unavailable" };
    }
    return {
      kind: "hard_blocked",
      phoneNumberLookupKey: line.phoneNumberLookupKey,
    };
  }
  if (line.providerReputationStatus === "AT_RISK") {
    return {
      kind: "at_risk",
      phoneNumberLookupKey: line.phoneNumberLookupKey,
    };
  }
  if (line.healthStatus === "healthy" || line.healthStatus === "unknown") {
    return {
      kind: "assignable",
      phoneNumberLookupKey: line.phoneNumberLookupKey,
    };
  }

  return { kind: "degraded_unavailable" };
}

export async function listHostedLinqHealthyProactiveLines(input: {
  prisma: HostedLinqLineClient;
}): Promise<HostedLinqAssignableHomeLine[]> {
  const limit = HOSTED_LINQ_ASSIGNABLE_HOME_LINE_LIMIT;
  const rows = await input.prisma.hostedLinqLine.findMany({
    where: {
      configuredAt: { not: null },
      egressPolicy: "enabled",
      healthStatus: "healthy",
      phoneNumberEncrypted: { not: null },
      ...buildHostedLinqProviderEligibleWhere(),
    },
    orderBy: [
      { assignmentWeight: "desc" },
      { phoneNumberLookupKey: "asc" },
    ],
    take: limit + 1,
    select: {
      assignmentWeight: true,
      maxNewConversationsPerDay: true,
      phoneNumberEncrypted: true,
      phoneNumberHint: true,
      phoneNumberLookupKey: true,
      proactiveConversationCount: true,
      proactiveConversationDayUtc: true,
    },
  });

  if (rows.length > limit) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_ASSIGNABLE_LINE_LIMIT_EXCEEDED",
      httpStatus: 500,
      message: `Hosted Linq proactive dispatch has more than ${limit} healthy line(s). Reduce the pool or raise the reviewed limit before dispatching.`,
      retryable: false,
    });
  }

  return mapHostedLinqAssignableHomeLineRows(rows);
}

/**
 * Derive recent load from the deduplicated effect owners. Accepted deliveries
 * own outbound effects; inbound message events own inbound effects.
 */
export function buildHostedLinqRecentMessageEffectCountsQuery(input: {
  lineLookupKeys: readonly string[];
  now: Date;
}): Prisma.Sql {
  const cutoff = new Date(
    input.now.getTime() - HOSTED_LINQ_RECENT_MESSAGE_LOAD_WINDOW_MS,
  );

  return Prisma.sql`
    WITH recent_line_counts AS (
      SELECT
        "phone_number_lookup_key",
        COUNT(*)::bigint AS "message_effect_count"
      FROM "hosted_linq_delivery"
      WHERE "phone_number_lookup_key" IN (${Prisma.join(input.lineLookupKeys)})
        AND "accepted_at" >= ${cutoff}
        AND "accepted_at" <= ${input.now}
      GROUP BY "phone_number_lookup_key"

      UNION ALL

      SELECT
        "phone_number_lookup_key",
        COUNT(*)::bigint AS "message_effect_count"
      FROM "hosted_linq_provider_event"
      WHERE "phone_number_lookup_key" IN (${Prisma.join(input.lineLookupKeys)})
        AND "event_type" = 'message.received'
        AND "direction" = 'inbound'
        AND "received_at" >= ${cutoff}
        AND "received_at" <= ${input.now}
      GROUP BY "phone_number_lookup_key"
    )
    SELECT
      "phone_number_lookup_key" AS "phoneNumberLookupKey",
      SUM("message_effect_count")::bigint AS "messageEffectCount"
    FROM recent_line_counts
    GROUP BY "phone_number_lookup_key"
  `;
}

export async function readHostedLinqRecentMessageEffectCountsTx(input: {
  lineLookupKeys: readonly string[];
  now: Date;
  prisma: HostedLinqLineClient;
}): Promise<ReadonlyMap<string, number>> {
  const lineLookupKeys = [...new Set(input.lineLookupKeys)];
  if (lineLookupKeys.length === 0) {
    return new Map();
  }
  if (lineLookupKeys.length > HOSTED_LINQ_ASSIGNABLE_HOME_LINE_LIMIT) {
    throw new RangeError(
      `Hosted Linq recent message load requires at most ${HOSTED_LINQ_ASSIGNABLE_HOME_LINE_LIMIT} candidate line(s).`,
    );
  }

  const rows = await input.prisma.$queryRaw<Array<{
    messageEffectCount: bigint;
    phoneNumberLookupKey: string;
  }>>(buildHostedLinqRecentMessageEffectCountsQuery({
    lineLookupKeys,
    now: input.now,
  }));

  return new Map(
    rows.map((row) => [
      row.phoneNumberLookupKey,
      Number(row.messageEffectCount),
    ]),
  );
}

export type HostedLinqReceiptCorrelatedRecoveryLine = {
  phoneNumber: string;
  phoneNumberLookupKey: string;
};

/**
 * Reuses an already-selected recovery sender without reopening healthy-pool
 * assignment. A provider failure projects the same line to `warning`; that
 * warning is eligible only while its latest receipt is the exact failed
 * recovery receipt the caller observed.
 */
export async function readHostedLinqReceiptCorrelatedRecoveryLineTx(input: {
  expectedFailureReceiptEventId: string;
  phoneNumberLookupKey: string;
  prisma: HostedLinqLineClient;
}): Promise<HostedLinqReceiptCorrelatedRecoveryLine | null> {
  const expectedFailureReceiptEventId =
    normalizeNullableString(input.expectedFailureReceiptEventId);
  const phoneNumberLookupKey = normalizeNullableString(input.phoneNumberLookupKey);
  if (!expectedFailureReceiptEventId || !phoneNumberLookupKey) {
    return null;
  }

  const line = await input.prisma.hostedLinqLine.findUnique({
    where: { phoneNumberLookupKey },
    select: {
      configuredAt: true,
      egressPolicy: true,
      healthStatus: true,
      lastReceiptEventId: true,
      phoneNumberEncrypted: true,
      phoneNumberLookupKey: true,
      providerReputationStatus: true,
      providerServiceStatus: true,
    },
  });
  const exactCorrelatedWarning =
    line?.healthStatus === "warning"
    && line.lastReceiptEventId === expectedFailureReceiptEventId;
  const policy = line
    ? evaluateHostedLinqEgressPolicy({
        chatHealthStatus: null,
        lineDeliveryHealthStatus: exactCorrelatedWarning
          ? "healthy"
          : line.healthStatus,
        lineEgressPolicy: line.egressPolicy,
        lineReputationStatus: line.providerReputationStatus,
        lineServiceStatus: line.providerServiceStatus,
        newConversation: true,
      })
    : null;
  if (
    !line?.configuredAt
    || !line.phoneNumberEncrypted
    || policy?.kind !== "allow"
    || (
      line.healthStatus !== "healthy"
      && !exactCorrelatedWarning
    )
  ) {
    return null;
  }

  try {
    const phoneNumber = normalizePhoneNumber(
      decryptHostedLinqLinePhoneNumber(line.phoneNumberEncrypted),
    );
    return phoneNumber
      ? {
          phoneNumber,
          phoneNumberLookupKey: line.phoneNumberLookupKey,
        }
      : null;
  } catch {
    return null;
  }
}

export async function claimHostedLinqProactiveConversationCapacityTx(input: {
  dayUtc: Date;
  limit: number;
  phoneNumberLookupKey: string;
  prisma: Prisma.TransactionClient;
  requiredHealthStatus?: "healthy";
}): Promise<boolean> {
  if (!Number.isInteger(input.limit) || input.limit <= 0) {
    return false;
  }
  const requiredLineStateWhere: Prisma.HostedLinqLineWhereInput =
    input.requiredHealthStatus
      ? {
          configuredAt: { not: null },
          egressPolicy: "enabled",
          healthStatus: input.requiredHealthStatus,
          phoneNumberEncrypted: { not: null },
          ...buildHostedLinqProviderEligibleWhere(),
        }
      : {};

  const incremented = await input.prisma.hostedLinqLine.updateMany({
    where: {
      ...requiredLineStateWhere,
      phoneNumberLookupKey: input.phoneNumberLookupKey,
      proactiveConversationCount: {
        lt: input.limit,
      },
      proactiveConversationDayUtc: input.dayUtc,
    },
    data: {
      proactiveConversationCount: {
        increment: 1,
      },
    },
  });
  if (incremented.count === 1) {
    return true;
  }

  const started = await input.prisma.hostedLinqLine.updateMany({
    where: {
      ...requiredLineStateWhere,
      phoneNumberLookupKey: input.phoneNumberLookupKey,
      OR: [
        { proactiveConversationDayUtc: null },
        { proactiveConversationDayUtc: { not: input.dayUtc } },
      ],
    },
    data: {
      proactiveConversationCount: 1,
      proactiveConversationDayUtc: input.dayUtc,
    },
  });

  return started.count === 1;
}

export async function assertHostedLinqAssignableHomeLinePoolReady(input: {
  prisma: HostedLinqLineClient;
}): Promise<void> {
  const lines = await listHostedLinqAssignableHomeLines(input);
  if (lines.length === 0) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_ASSIGNABLE_LINE_POOL_REQUIRED",
      httpStatus: 500,
      message: "Hosted Linq DB home-line cutover requires at least one configured, enabled, healthy assignable line.",
      retryable: false,
    });
  }
}

function buildHostedLinqAssignableHomeLineWhere(): Prisma.HostedLinqLineWhereInput {
  return {
    configuredAt: { not: null },
    egressPolicy: "enabled",
    healthStatus: { in: ["healthy", "unknown"] },
    phoneNumberEncrypted: { not: null },
    ...buildHostedLinqProviderEligibleWhere(),
  };
}

function buildHostedLinqProviderEligibleWhere(): Prisma.HostedLinqLineWhereInput {
  return {
    AND: [
      {
        OR: [
          { providerServiceStatus: null },
          { providerServiceStatus: { not: "FLAGGED" } },
        ],
      },
      {
        OR: [
          { providerReputationStatus: null },
          { providerReputationStatus: { notIn: ["AT_RISK", "CRITICAL"] } },
        ],
      },
    ],
  };
}

function mapHostedLinqAssignableHomeLineRows(
  rows: readonly HostedLinqAssignableHomeLineRow[],
): HostedLinqAssignableHomeLine[] {
  return rows.flatMap((row) => {
    const phoneNumber = normalizePhoneNumber(
      decryptHostedLinqLinePhoneNumber(row.phoneNumberEncrypted),
    );
    if (!phoneNumber) {
      return [];
    }
    return [{
      assignmentWeight: row.assignmentWeight,
      maxNewConversationsPerDay: row.maxNewConversationsPerDay,
      phoneNumber,
      phoneNumberHint: row.phoneNumberHint,
      phoneNumberLookupKey: row.phoneNumberLookupKey,
      proactiveConversationCount: row.proactiveConversationCount,
      proactiveConversationDayUtc: row.proactiveConversationDayUtc,
    }];
  });
}

/**
 * Ownership must be re-confirmed by a validated provider snapshot at least
 * this often for a line to stay contact-card eligible. Sized to three
 * five-minute health-cron cycles, so a single missed or failed run does not
 * disqualify the pool while a sustained inventory outage does.
 */
export const HOSTED_LINQ_INVENTORY_FRESHNESS_MAX_AGE_MS = 15 * 60 * 1000;

export function buildHostedLinqInventoryFreshnessCutoff(observedAt: Date): Date {
  return new Date(observedAt.getTime() - HOSTED_LINQ_INVENTORY_FRESHNESS_MAX_AGE_MS);
}

export async function readHostedLinqContactCardCandidacySnapshot(input: {
  limit?: number;
  lockMode?: "skip" | "wait";
  observedAt?: Date;
  prisma: PrismaClient | Prisma.TransactionClient;
}): Promise<{
  configuredLineCount: number;
  lines: HostedLinqContactCardLine[];
} | null> {
  const read = async (tx: HostedLinqLineClient) => {
    if (input.lockMode === "skip") {
      const acquired = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(
          hashtext('hosted_linq_phone_number_inventory'),
          hashtext('snapshot')
        ) AS locked
      `;
      if (acquired[0]?.locked !== true) {
        return null;
      }
    } else {
      await acquireHostedLinqInventoryApplyLockTx({ prisma: tx });
    }

    const configuredLineCount = await tx.hostedLinqLine.count({
      where: {
        configuredAt: { not: null },
        phoneNumberEncrypted: { not: null },
      },
    });
    const lines = await listHostedLinqContactCardLines({
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.observedAt === undefined ? {} : { observedAt: input.observedAt }),
      prisma: tx,
    });
    return { configuredLineCount, lines };
  };

  if ("$transaction" in input.prisma && typeof input.prisma.$transaction === "function") {
    const prisma = input.prisma;
    return prisma.$transaction((tx) => read(tx));
  }

  return read(input.prisma);
}

export async function listHostedLinqContactCardLines(input: {
  limit?: number;
  observedAt?: Date;
  prisma: HostedLinqLineClient;
}): Promise<HostedLinqContactCardLine[]> {
  const take = input.limit && input.limit > 0 ? input.limit : undefined;
  // Ownership is only trustworthy while a recent validated snapshot still
  // confirms it. Rows written before this watermark existed, and rows whose
  // confirmation has aged out through repeated failed or malformed inventory
  // reads, fail closed out of candidacy rather than publishing a possibly
  // relinquished number.
  const inventoryConfirmedAfter = buildHostedLinqInventoryFreshnessCutoff(
    input.observedAt ?? new Date(),
  );
  // Contact-card candidacy always requires validated inventory backing
  // (providerPhoneNumberId is written only from an authoritative provider
  // snapshot): a configured row whose ownership the inventory has revoked —
  // a moved or relinquished number — must not be maintained or offered as a
  // member-facing backup, even though configuration still matters to other
  // consumers such as inbound routing.
  const configuredRows = await input.prisma.hostedLinqLine.findMany({
    where: {
      configuredAt: { not: null },
      phoneNumberEncrypted: { not: null },
      providerInventoryConfirmedAt: { gte: inventoryConfirmedAfter },
      providerPhoneNumberId: { not: null },
    },
    orderBy: [
      { configuredAt: "desc" },
      { providerLastSeenAt: "desc" },
      { phoneNumberLookupKey: "asc" },
    ],
    ...(take ? { take } : {}),
    select: {
      configuredAt: true,
      phoneNumberEncrypted: true,
      phoneNumberHint: true,
      phoneNumberLookupKey: true,
      providerReputationStatus: true,
      providerServiceStatus: true,
    },
  });

  let rows: HostedLinqContactCardLineRow[] = configuredRows;
  if (!take || configuredRows.length < take) {
    // Unconfigured lines qualify only when the provider phone-number
    // inventory vouches for them (it is what sets providerPhoneNumberId).
    // Chat-health sync also stamps providerSeenAt, but it derives lines from
    // chat handles, which can reference numbers the account no longer owns;
    // Linq rejects contact-card calls for those with HTTP 403.
    const providerRows = await input.prisma.hostedLinqLine.findMany({
      where: {
        configuredAt: null,
        phoneNumberEncrypted: { not: null },
        providerInventoryConfirmedAt: { gte: inventoryConfirmedAfter },
        providerPhoneNumberId: { not: null },
        providerSeenAt: { not: null },
      },
      orderBy: [
        { providerLastSeenAt: "desc" },
        { phoneNumberLookupKey: "asc" },
      ],
      ...(take ? { take: take - configuredRows.length } : {}),
      select: {
        configuredAt: true,
        phoneNumberEncrypted: true,
        phoneNumberHint: true,
        phoneNumberLookupKey: true,
        providerReputationStatus: true,
        providerServiceStatus: true,
      },
    });
    rows = [...configuredRows, ...providerRows];
  }

  return mapHostedLinqContactCardRows(rows);
}

function mapHostedLinqContactCardRows(
  rows: readonly HostedLinqContactCardLineRow[],
): HostedLinqContactCardLine[] {
  return rows.flatMap((row) => {
    const phoneNumber = normalizePhoneNumber(
      decryptHostedLinqLinePhoneNumber(row.phoneNumberEncrypted),
    );
    if (!phoneNumber) {
      return [];
    }
    return [{
      isConfigured: row.configuredAt !== null,
      phoneNumber,
      phoneNumberHint: row.phoneNumberHint,
      phoneNumberLookupKey: row.phoneNumberLookupKey,
      providerReputationStatus: parseHostedLinqLineReputationStatus(
        row.providerReputationStatus,
      ),
      providerServiceStatus: parseHostedLinqLineServiceStatus(
        row.providerServiceStatus,
      ),
    }];
  });
}

export async function projectHostedLinqLineForProviderEventTx(input: {
  event: ParsedHostedLinqProviderEvent;
  lineLookupKey?: string | null;
  prisma: HostedLinqLineClient;
}): Promise<boolean> {
  const lineLookupKey = input.lineLookupKey ?? await ensureHostedLinqLineForProviderEventTx(input);
  if (!lineLookupKey) {
    return false;
  }

  switch (input.event.eventType) {
    case "chat.group_icon_updated":
    case "chat.group_icon_update_failed":
    case "message.edited":
      return false;
    case "message.received":
      return projectMessageReceived(input.prisma, lineLookupKey, input.event);
    case "message.delivered":
      return projectMessageDelivered(input.prisma, lineLookupKey, input.event);
    case "message.failed":
      return projectMessageFailed(input.prisma, lineLookupKey, input.event);
    case "message.sent":
    case "phone_number.status_updated":
    case "participant.added":
    case "participant.removed":
    case "reaction.added":
    case "reaction.removed":
      return false;
  }
}

export async function projectHostedLinqLineForDeliveryReceiptTx(input: {
  deliveryStatus: "delivered" | "failed";
  eventId: string;
  failureCode: string | null;
  failureReason: string | null;
  lineLookupKey: string;
  prisma: HostedLinqLineClient;
  providerCreatedAt: Date;
}): Promise<boolean> {
  if (input.deliveryStatus === "delivered") {
    return projectMessageDelivered(input.prisma, input.lineLookupKey, input);
  }

  return projectMessageFailed(input.prisma, input.lineLookupKey, input);
}

export async function ensureHostedLinqLineForProviderEventTx(input: {
  event: ParsedHostedLinqProviderEvent;
  prisma: HostedLinqLineClient;
}): Promise<string | null> {
  if (!input.event.phoneNumberLookupKey) {
    return null;
  }

  if (input.event.phoneNumberRole === "line" && input.event.phoneNumber) {
    const line = await upsertHostedLinqLineForPhoneTx({
      observedAt: input.event.providerCreatedAt,
      phoneNumber: input.event.phoneNumber,
      prisma: input.prisma,
      source: "webhook",
    });
    return line.phoneNumberLookupKey;
  }

  const existing = await input.prisma.hostedLinqLine.findUnique({
    where: {
      phoneNumberLookupKey: input.event.phoneNumberLookupKey,
    },
    select: {
      phoneNumberLookupKey: true,
    },
  });

  return existing?.phoneNumberLookupKey ?? null;
}

async function projectMessageReceived(
  prisma: HostedLinqLineClient,
  phoneNumberLookupKey: string,
  event: ParsedHostedLinqProviderEvent,
): Promise<boolean> {
  if (event.direction === "outbound") {
    await prisma.hostedLinqLine.update({
      where: { phoneNumberLookupKey },
      data: {
        totalOutboundCount: { increment: 1 },
      },
    });
    const updated = await prisma.hostedLinqLine.updateMany({
      where: {
        phoneNumberLookupKey,
        OR: [
          { lastOutboundAt: null },
          { lastOutboundAt: { lt: event.providerCreatedAt } },
        ],
      },
      data: {
        lastOutboundAt: event.providerCreatedAt,
      },
    });
    return updated.count === 1;
  }

  await prisma.hostedLinqLine.update({
    where: { phoneNumberLookupKey },
    data: {
      totalInboundCount: { increment: 1 },
    },
  });
  const updated = await prisma.hostedLinqLine.updateMany({
    where: {
      phoneNumberLookupKey,
      OR: [
        { lastInboundAt: null },
        { lastInboundAt: { lt: event.providerCreatedAt } },
      ],
    },
    data: {
      lastInboundAt: event.providerCreatedAt,
    },
  });
  return updated.count === 1;
}

async function projectMessageDelivered(
  prisma: HostedLinqLineClient,
  phoneNumberLookupKey: string,
  event: Pick<ParsedHostedLinqProviderEvent, "eventId" | "providerCreatedAt">,
): Promise<boolean> {
  const progress = createHostedLinqProviderEventProgress(event);
  const updated = await prisma.hostedLinqLine.updateMany({
    where: buildMessageReceiptLineProjectionWhere(phoneNumberLookupKey, progress),
    data: {
      consecutiveFailures: 0,
      lastDeliveredAt: event.providerCreatedAt,
      lastReceiptAt: event.providerCreatedAt,
      lastReceiptEventId: progress.eventLookupKey,
      totalDeliveredCount: { increment: 1 },
    },
  });
  if (updated.count === 1) {
    await prisma.hostedLinqLine.updateMany({
      where: {
        lastReceiptAt: progress.providerCreatedAt,
        lastReceiptEventId: progress.eventLookupKey,
        phoneNumberLookupKey,
      },
      data: {
        healthStatus: "healthy",
        lastDeliveredAt: event.providerCreatedAt,
        lastReceiptAt: event.providerCreatedAt,
        lastReceiptEventId: progress.eventLookupKey,
      },
    });
  }
  return updated.count === 1;
}

async function projectMessageFailed(
  prisma: HostedLinqLineClient,
  phoneNumberLookupKey: string,
  event: Pick<
    ParsedHostedLinqProviderEvent,
    "eventId" | "failureCode" | "failureReason" | "providerCreatedAt"
  >,
): Promise<boolean> {
  const progress = createHostedLinqProviderEventProgress(event);
  const updated = await prisma.hostedLinqLine.updateMany({
    where: buildMessageReceiptLineProjectionWhere(phoneNumberLookupKey, progress),
    data: {
      consecutiveFailures: { increment: 1 },
      healthStatus: "warning",
      lastFailedAt: event.providerCreatedAt,
      lastFailureCode: event.failureCode,
      lastFailureReason: event.failureReason,
      lastReceiptAt: event.providerCreatedAt,
      lastReceiptEventId: progress.eventLookupKey,
      totalFailedCount: { increment: 1 },
    },
  });
  return updated.count === 1;
}

function buildMessageReceiptLineProjectionWhere(
  phoneNumberLookupKey: string,
  progress: HostedLinqProviderEventProgress,
): Prisma.HostedLinqLineWhereInput {
  const orderingWhere: Prisma.HostedLinqLineWhereInput[] = [
    {
      lastReceiptAt: null,
    },
    {
      lastReceiptAt: {
        lt: progress.providerCreatedAt,
      },
    },
  ];

  orderingWhere.push({
    lastReceiptAt: progress.providerCreatedAt,
    OR: [
      { lastReceiptEventId: null },
      { lastReceiptEventId: { lt: progress.eventLookupKey } },
    ],
  });

  return {
    phoneNumberLookupKey,
    OR: orderingWhere,
  };
}
