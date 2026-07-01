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
    const reputation = readRecord(record.reputation);
    const phoneNumber = normalizePhoneNumber(readString(record.phone_number));
    if (!phoneNumber || seenPhones.has(phoneNumber)) {
      continue;
    }
    seenPhones.add(phoneNumber);

    lines.push({
      phoneNumber,
      providerPhoneNumberId: normalizeNullableString(readString(record.id)),
      providerReason: normalizeNullableString(readString(reputation?.reason)),
      providerStatus: normalizeNullableString(
        readString(reputation?.status) ?? readString(record.health_status),
      ),
    });
  }

  return lines;
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
