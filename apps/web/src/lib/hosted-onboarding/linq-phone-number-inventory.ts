import type { Prisma, PrismaClient } from "@prisma/client";

import { fetchLinqApi, LinqApiTimeoutError } from "../linq/api";
import { hostedOnboardingError } from "./errors";
import {
  syncHostedLinqProviderLineInventoryTx,
  type HostedLinqProviderInventoryLine,
} from "./linq-line-store";
import { normalizePhoneNumber } from "./phone";
import { requireHostedOnboardingLinqConfig } from "./runtime";
import { normalizeNullableString } from "./shared";

type HostedLinqInventoryClient = PrismaClient | Prisma.TransactionClient;

export async function syncHostedLinqPhoneNumberInventory(input: {
  observedAt?: Date;
  prisma: HostedLinqInventoryClient;
  signal?: AbortSignal;
}): Promise<{ syncedCount: number }> {
  const lines = await listHostedLinqPhoneNumberInventory({
    signal: input.signal,
  });
  const syncedCount = await syncHostedLinqProviderLineInventoryTx({
    lines,
    observedAt: input.observedAt,
    prisma: input.prisma,
  });
  return { syncedCount };
}

export async function listHostedLinqPhoneNumberInventory(input: {
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
  return parseHostedLinqPhoneNumberInventory(payload);
}

export function parseHostedLinqPhoneNumberInventory(
  payload: unknown,
): HostedLinqProviderInventoryLine[] {
  const records = readInventoryRecords(payload);
  const lines: HostedLinqProviderInventoryLine[] = [];
  const seenPhones = new Set<string>();

  for (const record of records) {
    const phoneNumber = normalizePhoneNumber(readFirstString(record, [
      "phone_number",
      "phoneNumber",
      "number",
      "e164",
      "handle",
    ]));
    if (!phoneNumber || seenPhones.has(phoneNumber)) {
      continue;
    }
    seenPhones.add(phoneNumber);

    lines.push({
      phoneNumber,
      providerPhoneNumberId: normalizeNullableString(readFirstString(record, [
        "id",
        "phone_number_id",
        "phoneNumberId",
      ])),
      providerReason: normalizeNullableString(readFirstString(record, [
        "reason",
        "status_reason",
        "statusReason",
      ])),
      providerStatus: normalizeNullableString(readFirstString(record, [
        "health_status",
        "healthStatus",
        "reputation_status",
        "reputationStatus",
        "status",
      ])),
    });
  }

  return lines;
}

function readInventoryRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (!isRecord(payload)) {
    return [];
  }

  for (const key of ["phone_numbers", "phoneNumbers", "data", "items", "results"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }

  return [];
}

function readFirstString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = readNested(record, key);
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function readNested(record: Record<string, unknown>, key: string): unknown {
  if (Object.hasOwn(record, key)) {
    return record[key];
  }
  if (key === "reputation_status" || key === "reputationStatus") {
    const reputation = record.reputation;
    if (isRecord(reputation)) {
      return reputation.status;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
