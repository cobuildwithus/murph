import type { Prisma, PrismaClient } from "@prisma/client";

import { fetchLinqApi, LinqApiTimeoutError } from "../linq/api";
import { createHostedPhoneLookupKeyReadCandidates } from "./contact-privacy-core";
import { hostedOnboardingError } from "./errors";
import {
  acquireHostedLinqInventoryApplyLockTx,
  upsertHostedLinqLineForPhoneTx,
} from "./linq-line-store";
import {
  projectHostedLinqLineProviderStateTx,
} from "./linq-provider-health-store";
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

export type HostedLinqProviderInventoryLine = {
  phoneNumber: string;
  providerPhoneNumberId: string | null;
  providerReputationStatus: HostedLinqLineReputationStatus | null;
  providerServiceStatus: HostedLinqLineServiceStatus | null;
};

export async function syncHostedLinqPhoneNumberInventory(input: {
  maxLines?: number;
  observedAt?: Date;
  prisma: HostedLinqInventoryClient;
  signal?: AbortSignal;
}): Promise<{ syncedCount: number }> {
  const lines = await listHostedLinqPhoneNumberInventory({
    maxLines: input.maxLines,
    signal: input.signal,
  });
  const observedAt = input.observedAt ?? new Date();

  // The contact-card and health crons both trigger this sync at minute zero,
  // and the per-phone upsert locks cannot order two whole-snapshot
  // applications that touch different phones. Apply each validated snapshot
  // under one inventory-wide advisory lock inside one transaction: concurrent
  // applications serialize instead of interleaving (so a moved id can never
  // race the unique provider-id index), and a mid-application failure rolls
  // the whole replacement back. Two overlapping runs may still commit in
  // either order; the hourly cadence converges any stale winner on the next
  // run.
  if ("$transaction" in input.prisma && typeof input.prisma.$transaction === "function") {
    const prisma = input.prisma;
    return prisma.$transaction((tx) => applyHostedLinqPhoneNumberInventorySnapshot({
      lines,
      observedAt,
      prisma: tx,
    }));
  }

  return applyHostedLinqPhoneNumberInventorySnapshot({
    lines,
    observedAt,
    prisma: input.prisma,
  });
}

async function applyHostedLinqPhoneNumberInventorySnapshot(input: {
  lines: HostedLinqProviderInventoryLine[];
  observedAt: Date;
  prisma: HostedLinqInventoryClient;
}): Promise<{ syncedCount: number }> {
  const { lines, observedAt } = input;
  let syncedCount = 0;

  await acquireHostedLinqInventoryApplyLockTx({ prisma: input.prisma });

  // A validated read is a complete identity snapshot (failed, malformed,
  // over-limit, and identity-lossy reads all throw before this point), so any
  // stored phone-to-provider-id pairing the snapshot does not confirm marks a
  // relinquished or moved line. Revoke exactly those pairings before the
  // upserts: relinquished ids stop qualifying as account-owned for
  // ownership-gated consumers (contact-card and backup-number candidacy), and
  // a moved id is released before its new row claims it, so the unique
  // provider-id index cannot collide.
  const confirmedLookupKeysById = new Map<string, Set<string>>();
  for (const line of lines) {
    if (line.providerPhoneNumberId) {
      confirmedLookupKeysById.set(
        line.providerPhoneNumberId,
        new Set(createHostedPhoneLookupKeyReadCandidates(line.phoneNumber)),
      );
    }
  }
  const heldRows = await input.prisma.hostedLinqLine.findMany({
    where: { providerPhoneNumberId: { not: null } },
    select: {
      phoneNumberLookupKey: true,
      providerPhoneNumberId: true,
    },
  });
  const staleLookupKeys = heldRows
    .filter((row) => {
      const confirmed = row.providerPhoneNumberId
        ? confirmedLookupKeysById.get(row.providerPhoneNumberId)
        : undefined;
      return !confirmed || !confirmed.has(row.phoneNumberLookupKey);
    })
    .map((row) => row.phoneNumberLookupKey);
  if (staleLookupKeys.length > 0) {
    await input.prisma.hostedLinqLine.updateMany({
      data: {
        providerInventoryConfirmedAt: null,
        providerPhoneNumberId: null,
      },
      where: { phoneNumberLookupKey: { in: staleLookupKeys } },
    });
  }

  for (const line of lines) {
    const storedLine = await upsertHostedLinqLineForPhoneTx({
      observedAt,
      phoneNumber: line.phoneNumber,
      prisma: input.prisma,
      providerPhoneNumberId: line.providerPhoneNumberId,
      source: "provider",
    });
    // Freshness watermark for ownership-gated consumers. Stamped only here,
    // inside the same transaction that applied a validated snapshot, so it
    // can never be advanced by chat-health or status projection.
    await input.prisma.hostedLinqLine.updateMany({
      data: { providerInventoryConfirmedAt: observedAt },
      where: { phoneNumberLookupKey: storedLine.phoneNumberLookupKey },
    });
    await projectHostedLinqLineProviderStateTx({
      observedAt,
      phoneNumberLookupKey: storedLine.phoneNumberLookupKey,
      prisma: input.prisma,
      providerUpdatedAt: observedAt,
      ...(line.providerReputationStatus
        ? { reputationStatus: line.providerReputationStatus }
        : {}),
      ...(line.providerServiceStatus
        ? { serviceStatus: line.providerServiceStatus }
        : {}),
    });
    syncedCount += 1;
  }

  return { syncedCount };
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
