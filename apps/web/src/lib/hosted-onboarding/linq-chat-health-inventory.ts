import type { PrismaClient } from "@prisma/client";

import { fetchLinqApi, LinqApiTimeoutError } from "../linq/api";
import { hostedOnboardingError } from "./errors";
import {
  HOSTED_LINQ_CHAT_HEALTH_PROJECTION_CHUNK_SIZE,
  prepareHostedLinqChatHealthInventoryProjection,
  projectHostedLinqChatHealthInventoryChunk,
} from "./linq-provider-health-store";
import {
  parseHostedLinqChatHealthStatus,
  type HostedLinqChatHealthStatus,
} from "./linq-provider-status";
import { normalizePhoneNumber } from "./phone";
import { requireHostedOnboardingLinqConfig } from "./runtime";
import { normalizeNullableString } from "./shared";

const HOSTED_LINQ_CHAT_HEALTH_PAGE_SIZE = 100;
export const HOSTED_LINQ_CHAT_HEALTH_SYNC_LIMIT = 5_000;

export type HostedLinqChatHealthInventoryRecord = {
  chatId: string;
  isGroup: boolean | null;
  linePhoneNumber: string | null;
  providerStatus: HostedLinqChatHealthStatus;
  providerUpdatedAt: Date;
  service: string | null;
};

export async function syncHostedLinqChatHealthInventory(input: {
  maxChats?: number;
  observedAt?: Date;
  prisma: PrismaClient;
  signal?: AbortSignal;
}): Promise<{
  skippedCount: number;
  syncedCount: number;
}> {
  const inventory = await listHostedLinqChatHealthInventory({
    maxChats: input.maxChats,
    signal: input.signal,
  });
  const observedAt = input.observedAt ?? new Date();
  const chats = prepareHostedLinqChatHealthInventoryProjection(inventory.chats);

  let syncedCount = 0;
  for (
    let offset = 0;
    offset < chats.length;
    offset += HOSTED_LINQ_CHAT_HEALTH_PROJECTION_CHUNK_SIZE
  ) {
    syncedCount += await projectHostedLinqChatHealthInventoryChunk({
      chats: chats.slice(
        offset,
        offset + HOSTED_LINQ_CHAT_HEALTH_PROJECTION_CHUNK_SIZE,
      ),
      observedAt,
      prisma: input.prisma,
    });
  }

  return {
    skippedCount: inventory.skippedCount,
    syncedCount,
  };
}

export async function listHostedLinqChatHealthInventory(input: {
  maxChats?: number;
  signal?: AbortSignal;
} = {}): Promise<{
  chats: HostedLinqChatHealthInventoryRecord[];
  skippedCount: number;
}> {
  const maxChats = Math.min(
    normalizeHostedLinqChatHealthLimit(input.maxChats),
    HOSTED_LINQ_CHAT_HEALTH_SYNC_LIMIT,
  );
  const chats: HostedLinqChatHealthInventoryRecord[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let skippedCount = 0;

  do {
    input.signal?.throwIfAborted();
    const page = await fetchHostedLinqChatHealthPage({
      cursor,
      signal: input.signal,
    });
    if (chats.length + skippedCount + page.records.length > maxChats) {
      throw hostedOnboardingError({
        code: "LINQ_CHAT_HEALTH_INVENTORY_LIMIT_EXCEEDED",
        httpStatus: 502,
        message: `Linq chat inventory exceeds the configured ${maxChats} chat limit.`,
        retryable: false,
      });
    }

    for (const value of page.records) {
      const parsed = parseHostedLinqChatHealthInventoryRecord(value);
      if (parsed) {
        chats.push(parsed);
      } else {
        skippedCount += 1;
      }
    }

    cursor = page.nextCursor;
    if (cursor) {
      if (seenCursors.has(cursor)) {
        throw hostedOnboardingError({
          code: "LINQ_CHAT_HEALTH_CURSOR_REPEATED",
          httpStatus: 502,
          message: "Linq chat inventory repeated a pagination cursor.",
          retryable: true,
        });
      }
      seenCursors.add(cursor);
    }
  } while (cursor);

  return { chats, skippedCount };
}

async function fetchHostedLinqChatHealthPage(input: {
  cursor: string | null;
  signal?: AbortSignal;
}): Promise<{
  nextCursor: string | null;
  records: unknown[];
}> {
  const { apiBaseUrl, apiToken } = requireHostedOnboardingLinqConfig();
  const query = new URLSearchParams({
    limit: String(HOSTED_LINQ_CHAT_HEALTH_PAGE_SIZE),
  });
  if (input.cursor) {
    query.set("cursor", input.cursor);
  }

  let response: Response;
  try {
    response = await fetchLinqApi({
      apiBaseUrl,
      apiToken,
      method: "GET",
      path: `chats?${query.toString()}`,
      signal: input.signal,
    });
  } catch (error) {
    if (error instanceof LinqApiTimeoutError) {
      throw hostedOnboardingError({
        code: "LINQ_CHAT_HEALTH_INVENTORY_FAILED",
        httpStatus: 502,
        message: "Linq chat-health inventory sync timed out.",
        retryable: true,
      });
    }
    throw error;
  }

  if (!response.ok) {
    throw hostedOnboardingError({
      code: "LINQ_CHAT_HEALTH_INVENTORY_FAILED",
      httpStatus: 502,
      message: `Linq chat-health inventory sync failed with HTTP ${response.status}.`,
      retryable: response.status === 429 || response.status >= 500,
    });
  }

  const payload = await response.json();
  const record = readRecord(payload);
  return {
    nextCursor: normalizeNullableString(readString(record?.next_cursor)),
    records: Array.isArray(record?.chats) ? record.chats : [],
  };
}

export function parseHostedLinqChatHealthInventoryRecord(
  value: unknown,
): HostedLinqChatHealthInventoryRecord | null {
  const record = readRecord(value);
  const healthStatus = readRecord(record?.health_status);
  const handles = Array.isArray(record?.handles) ? record.handles : [];
  const ownPhones = handles.flatMap((handle) => {
    const handleRecord = readRecord(handle);
    if (handleRecord?.is_me !== true) {
      return [];
    }
    const phoneNumber = normalizePhoneNumber(readString(handleRecord.handle));
    return phoneNumber ? [phoneNumber] : [];
  });
  const uniqueOwnPhones = [...new Set(ownPhones)];
  const chatId = normalizeNullableString(readString(record?.id));
  const providerStatus = parseHostedLinqChatHealthStatus(healthStatus?.status);
  const providerUpdatedAt = parseProviderDate(healthStatus?.updated_at);
  if (!chatId || !providerStatus || !providerUpdatedAt) {
    return null;
  }

  return {
    chatId,
    isGroup: typeof record?.is_group === "boolean" ? record.is_group : null,
    linePhoneNumber: uniqueOwnPhones.length === 1 ? uniqueOwnPhones[0] ?? null : null,
    providerStatus,
    providerUpdatedAt,
    service: normalizeNullableString(readString(record?.service)),
  };
}

function normalizeHostedLinqChatHealthLimit(
  value: number | null | undefined,
): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return HOSTED_LINQ_CHAT_HEALTH_SYNC_LIMIT;
  }
  return value;
}

function parseProviderDate(value: unknown): Date | null {
  const normalized = normalizeNullableString(readString(value));
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : null;
}
