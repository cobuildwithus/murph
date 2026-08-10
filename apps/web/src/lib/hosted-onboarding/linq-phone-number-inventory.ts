import { Prisma, type PrismaClient } from "@prisma/client";

import { fetchLinqApi, LinqApiTimeoutError } from "../linq/api";
import { hostedOnboardingError } from "./errors";
import {
  prepareHostedLinqLinePhones,
  type PreparedHostedLinqLinePhone,
} from "./linq-line-store";
import {
  parseHostedLinqLineReputationStatus,
  parseHostedLinqLineServiceStatus,
  type HostedLinqLineReputationStatus,
  type HostedLinqLineServiceStatus,
} from "./linq-provider-status";
import { normalizePhoneNumber } from "./phone";
import { requireHostedOnboardingLinqConfig } from "./runtime";
import { normalizeNullableString } from "./shared";

type HostedLinqInventoryClient = PrismaClient | Prisma.TransactionClient;

export const HOSTED_LINQ_PHONE_NUMBER_INVENTORY_SYNC_LIMIT = 250;
const HOSTED_LINQ_PHONE_NUMBER_INVENTORY_APPLY_MAX_ATTEMPTS = 3;

export type HostedLinqProviderInventoryLine = {
  phoneNumber: string;
  providerPhoneNumberId: string | null;
  providerReputationStatus: HostedLinqLineReputationStatus | null;
  providerServiceStatus: HostedLinqLineServiceStatus | null;
};

type PreparedHostedLinqProviderInventoryLine = PreparedHostedLinqLinePhone & {
  providerPhoneNumberId: string;
  providerReputationStatus: HostedLinqLineReputationStatus | null;
  providerServiceStatus: HostedLinqLineServiceStatus | null;
};

export async function syncHostedLinqPhoneNumberInventory(input: {
  maxLines?: number;
  observedAt?: Date;
  prisma: HostedLinqInventoryClient;
  signal?: AbortSignal;
}): Promise<{ syncedCount: number }> {
  const maxLines = Math.min(
    normalizeInventoryLineLimit(input.maxLines),
    HOSTED_LINQ_PHONE_NUMBER_INVENTORY_SYNC_LIMIT,
  );
  const lines = await listHostedLinqPhoneNumberInventory({
    maxLines,
    signal: input.signal,
  });
  const observedAt = input.observedAt ?? new Date();
  const linesByPhoneNumber = new Map(lines.map((line) => [line.phoneNumber, line]));
  const preparedLines = prepareHostedLinqLinePhones({
    maxLines,
    phoneNumbers: lines.map((line) => line.phoneNumber),
  }).map((prepared): PreparedHostedLinqProviderInventoryLine => {
    const line = linesByPhoneNumber.get(prepared.normalizedPhoneNumber);
    if (!line?.providerPhoneNumberId) {
      throw invalidInventorySnapshotError(
        "Linq phone-number inventory contained a record without a valid provider id.",
      );
    }
    return {
      ...prepared,
      providerPhoneNumberId: line.providerPhoneNumberId,
      providerReputationStatus: line.providerReputationStatus,
      providerServiceStatus: line.providerServiceStatus,
    };
  });

  if ("$transaction" in input.prisma && typeof input.prisma.$transaction === "function") {
    const prisma = input.prisma;
    // The unique lookup-key and provider-id indexes are the convergence
    // authorities. Retry only database conflicts produced while two complete
    // snapshots race; preprocessing remains outside every attempt.
    for (
      let attempt = 1;
      attempt <= HOSTED_LINQ_PHONE_NUMBER_INVENTORY_APPLY_MAX_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await prisma.$transaction(
          (tx) => applyHostedLinqPhoneNumberInventorySnapshot({
            lines: preparedLines,
            observedAt,
            prisma: tx,
          }),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          attempt === HOSTED_LINQ_PHONE_NUMBER_INVENTORY_APPLY_MAX_ATTEMPTS
          || !isHostedLinqInventoryConvergenceConflict(error)
        ) {
          throw error;
        }
      }
    }
    throw new Error("Hosted Linq inventory convergence retries were exhausted.");
  }

  return applyHostedLinqPhoneNumberInventorySnapshot({
    lines: preparedLines,
    observedAt,
    prisma: input.prisma,
  });
}

async function applyHostedLinqPhoneNumberInventorySnapshot(input: {
  lines: readonly PreparedHostedLinqProviderInventoryLine[];
  observedAt: Date;
  prisma: HostedLinqInventoryClient;
}): Promise<{ syncedCount: number }> {
  const rows = await input.prisma.$queryRaw<Array<{ syncedCount: bigint }>>(
    buildHostedLinqPhoneNumberInventorySnapshotQuery(input),
  );
  return { syncedCount: Number(rows[0]?.syncedCount ?? 0) };
}

function buildHostedLinqPhoneNumberInventorySnapshotQuery(input: {
  lines: readonly PreparedHostedLinqProviderInventoryLine[];
  observedAt: Date;
}): Prisma.Sql {
  const observedAt = Prisma.sql`${input.observedAt}::timestamp`;
  const inputRows = input.lines.length > 0
    ? Prisma.sql`VALUES ${Prisma.join(input.lines.map((line) => Prisma.sql`(
        ${line.currentLookupKey}::text,
        ARRAY[${Prisma.join(line.lookupKeyReadCandidates)}]::text[],
        ${line.phoneNumberEncrypted}::text,
        ${line.phoneNumberHint}::text,
        ${line.providerPhoneNumberId}::text,
        ${line.providerReputationStatus}::text,
        ${line.providerServiceStatus}::text
      )`))}`
    : Prisma.sql`
        SELECT
          NULL::text,
          ARRAY[]::text[],
          NULL::text,
          NULL::text,
          NULL::text,
          NULL::text,
          NULL::text
        WHERE FALSE
      `;

  return Prisma.sql`
    WITH input_line (
      current_lookup_key,
      lookup_key_candidates,
      phone_number_encrypted,
      phone_number_hint,
      provider_phone_number_id,
      provider_reputation_status,
      provider_service_status
    ) AS (
      ${inputRows}
    ),
    resolved_line AS MATERIALIZED (
      SELECT
        input.current_lookup_key,
        COALESCE(existing.phone_number_lookup_key, input.current_lookup_key)
          AS target_lookup_key,
        input.phone_number_encrypted,
        input.phone_number_hint,
        input.provider_phone_number_id,
        input.provider_reputation_status,
        input.provider_service_status
      FROM input_line AS input
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
    -- Only non-target owners are cleared here. Target rows replace stale ids
    -- in the upsert, so no physical row is modified twice in one statement.
    released_line AS (
      UPDATE hosted_linq_line AS line
      SET
        provider_inventory_confirmed_at = NULL,
        provider_phone_number_id = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE line.provider_phone_number_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM resolved_line AS resolved
          WHERE resolved.target_lookup_key = line.phone_number_lookup_key
        )
      RETURNING line.phone_number_lookup_key
    ),
    release_barrier AS MATERIALIZED (
      SELECT count(*) AS released_count
      FROM released_line
    ),
    upserted_line AS (
      INSERT INTO hosted_linq_line (
        phone_number_lookup_key,
        phone_number_encrypted,
        phone_number_hint,
        source,
        configured_at,
        provider_seen_at,
        provider_phone_number_id,
        provider_inventory_confirmed_at,
        provider_first_seen_at,
        provider_last_seen_at,
        health_status,
        egress_policy,
        provider_service_status,
        provider_service_updated_at,
        last_service_status_event_id,
        provider_reputation_status,
        provider_reputation_updated_at,
        last_reputation_status_event_id,
        assignment_weight,
        created_at,
        updated_at
      )
      SELECT
        resolved.target_lookup_key,
        resolved.phone_number_encrypted,
        resolved.phone_number_hint,
        'provider',
        NULL,
        ${observedAt},
        resolved.provider_phone_number_id,
        ${observedAt},
        ${observedAt},
        ${observedAt},
        'unknown',
        'enabled',
        resolved.provider_service_status,
        CASE
          WHEN resolved.provider_service_status IS NULL THEN NULL
          ELSE ${observedAt}
        END,
        NULL,
        resolved.provider_reputation_status,
        CASE
          WHEN resolved.provider_reputation_status IS NULL THEN NULL
          ELSE ${observedAt}
        END,
        NULL,
        100,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM resolved_line AS resolved
      CROSS JOIN release_barrier
      ORDER BY resolved.current_lookup_key
      ON CONFLICT (phone_number_lookup_key) DO UPDATE SET
        phone_number_encrypted = EXCLUDED.phone_number_encrypted,
        phone_number_hint = EXCLUDED.phone_number_hint,
        provider_seen_at = EXCLUDED.provider_seen_at,
        provider_phone_number_id = EXCLUDED.provider_phone_number_id,
        provider_inventory_confirmed_at = EXCLUDED.provider_inventory_confirmed_at,
        provider_first_seen_at = COALESCE(
          hosted_linq_line.provider_first_seen_at,
          EXCLUDED.provider_first_seen_at
        ),
        provider_last_seen_at = EXCLUDED.provider_last_seen_at,
        provider_service_status = CASE
          WHEN EXCLUDED.provider_service_status IS NULL
            OR hosted_linq_line.provider_service_updated_at >= ${observedAt}
            THEN hosted_linq_line.provider_service_status
          ELSE EXCLUDED.provider_service_status
        END,
        provider_service_updated_at = CASE
          WHEN EXCLUDED.provider_service_status IS NULL
            OR hosted_linq_line.provider_service_updated_at >= ${observedAt}
            THEN hosted_linq_line.provider_service_updated_at
          ELSE EXCLUDED.provider_service_updated_at
        END,
        last_service_status_event_id = CASE
          WHEN EXCLUDED.provider_service_status IS NULL
            OR hosted_linq_line.provider_service_updated_at >= ${observedAt}
            THEN hosted_linq_line.last_service_status_event_id
          ELSE NULL
        END,
        provider_reputation_status = CASE
          WHEN EXCLUDED.provider_reputation_status IS NULL
            OR hosted_linq_line.provider_reputation_updated_at >= ${observedAt}
            THEN hosted_linq_line.provider_reputation_status
          ELSE EXCLUDED.provider_reputation_status
        END,
        provider_reputation_updated_at = CASE
          WHEN EXCLUDED.provider_reputation_status IS NULL
            OR hosted_linq_line.provider_reputation_updated_at >= ${observedAt}
            THEN hosted_linq_line.provider_reputation_updated_at
          ELSE EXCLUDED.provider_reputation_updated_at
        END,
        last_reputation_status_event_id = CASE
          WHEN EXCLUDED.provider_reputation_status IS NULL
            OR hosted_linq_line.provider_reputation_updated_at >= ${observedAt}
            THEN hosted_linq_line.last_reputation_status_event_id
          ELSE NULL
        END,
        updated_at = CURRENT_TIMESTAMP
      RETURNING phone_number_lookup_key
    )
    SELECT count(*)::bigint AS "syncedCount"
    FROM upserted_line
  `;
}

function isHostedLinqInventoryConvergenceConflict(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  const code = typeof error.code === "string" ? error.code : null;
  if (code === "P2002" || code === "P2034") {
    return true;
  }
  if (code !== "P2010" || !("meta" in error)) {
    return false;
  }
  return ["23505", "40001", "40P01"].includes(
    readHostedLinqInventoryPostgresErrorCode(error.meta) ?? "",
  );
}

function readHostedLinqInventoryPostgresErrorCode(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") {
    return null;
  }
  if ("code" in meta && typeof meta.code === "string") {
    return meta.code;
  }
  if (!("driverAdapterError" in meta)) {
    return null;
  }
  const driverAdapterError = meta.driverAdapterError;
  if (
    !driverAdapterError
    || typeof driverAdapterError !== "object"
    || !("cause" in driverAdapterError)
  ) {
    return null;
  }
  const cause = driverAdapterError.cause;
  if (!cause || typeof cause !== "object") {
    return null;
  }
  if ("originalCode" in cause && typeof cause.originalCode === "string") {
    return cause.originalCode;
  }
  return "code" in cause && typeof cause.code === "string"
    ? cause.code
    : null;
}

export async function listHostedLinqPhoneNumberInventory(input: {
  maxLines?: number;
  signal?: AbortSignal;
} = {}): Promise<HostedLinqProviderInventoryLine[]> {
  const { apiBaseUrl, apiToken } = requireHostedOnboardingLinqConfig();

  let response: Response;
  try {
    response = await fetchLinqApi({
      apiBaseUrl,
      apiToken,
      method: "GET",
      path: "phone_numbers",
      signal: input.signal,
    });
  } catch (error) {
    if (error instanceof LinqApiTimeoutError) {
      throw hostedOnboardingError({
        code: "LINQ_PHONE_NUMBER_INVENTORY_FAILED",
        httpStatus: 502,
        message: "Linq phone-number inventory sync timed out.",
        retryable: true,
      });
    }
    throw error;
  }

  if (!response.ok) {
    throw hostedOnboardingError({
      code: "LINQ_PHONE_NUMBER_INVENTORY_FAILED",
      httpStatus: 502,
      message: `Linq phone-number inventory sync failed with HTTP ${response.status}.`,
      retryable: response.status === 429 || response.status >= 500,
    });
  }

  const payload = await response.json();
  return requireHostedLinqPhoneNumberInventorySnapshot(payload, {
    maxLines: input.maxLines,
  });
}

/**
 * Parse an inventory payload as an authoritative identity snapshot. The
 * lenient parser tolerates dropped records for display-style consumers, but a
 * snapshot that feeds ownership reconciliation must not be lossy: a malformed
 * collection or a record with a missing, invalid, or duplicate identity would
 * otherwise read as a smaller account and revoke legitimate ownership.
 */
export function requireHostedLinqPhoneNumberInventorySnapshot(
  payload: unknown,
  input: {
    maxLines?: number;
  } = {},
): HostedLinqProviderInventoryLine[] {
  if (!isRecord(payload) || !Array.isArray(payload.phone_numbers)) {
    throw invalidInventorySnapshotError(
      "Linq phone-number inventory response did not contain a phone_numbers array.",
    );
  }

  const lines = parseHostedLinqPhoneNumberInventory(payload, input);
  if (lines.length !== payload.phone_numbers.length) {
    throw invalidInventorySnapshotError(
      "Linq phone-number inventory contained records without a valid unique phone number.",
    );
  }

  const seenIds = new Set<string>();
  for (const line of lines) {
    if (!line.providerPhoneNumberId || seenIds.has(line.providerPhoneNumberId)) {
      throw invalidInventorySnapshotError(
        "Linq phone-number inventory contained records without a valid unique provider id.",
      );
    }
    seenIds.add(line.providerPhoneNumberId);
  }

  return lines;
}

function invalidInventorySnapshotError(message: string): Error {
  return hostedOnboardingError({
    code: "LINQ_PHONE_NUMBER_INVENTORY_INVALID",
    httpStatus: 502,
    message,
    retryable: true,
  });
}

export function parseHostedLinqPhoneNumberInventory(
  payload: unknown,
  input: {
    maxLines?: number;
  } = {},
): HostedLinqProviderInventoryLine[] {
  const records = readInventoryRecords(payload);
  const maxLines = normalizeInventoryLineLimit(input.maxLines);
  if (records.length > maxLines) {
    throw hostedOnboardingError({
      code: "LINQ_PHONE_NUMBER_INVENTORY_LIMIT_EXCEEDED",
      httpStatus: 502,
      message: `Linq phone-number inventory returned ${records.length} line(s), which exceeds the configured ${maxLines} line limit.`,
      retryable: false,
    });
  }

  const lines: HostedLinqProviderInventoryLine[] = [];
  const seenPhones = new Set<string>();

  for (const record of records) {
    const reputation = readRecord(record.reputation);
    const legacyHealthStatus = readRecord(record.health_status);
    const phoneNumber = normalizePhoneNumber(readString(record.phone_number));
    if (!phoneNumber || seenPhones.has(phoneNumber)) {
      continue;
    }
    seenPhones.add(phoneNumber);

    lines.push({
      phoneNumber,
      providerPhoneNumberId: normalizeNullableString(readString(record.id)),
      providerReputationStatus: parseHostedLinqLineReputationStatus(
        reputation?.status
        ?? legacyHealthStatus?.status
        ?? record.health_status,
      ),
      providerServiceStatus: parseHostedLinqLineServiceStatus(record.status),
    });
  }

  return lines;
}

function normalizeInventoryLineLimit(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return HOSTED_LINQ_PHONE_NUMBER_INVENTORY_SYNC_LIMIT;
  }
  return Math.floor(value);
}

function readInventoryRecords(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload)) {
    return [];
  }

  const value = payload.phone_numbers;

  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
