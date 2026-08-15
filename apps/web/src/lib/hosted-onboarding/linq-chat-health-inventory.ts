import type { Prisma, PrismaClient } from "@prisma/client";
import type { Chat } from "@linqapp/sdk/resources/chats";

import {
  LinqApiTimeoutError,
  readLinqApiErrorStatus,
  runLinqApiRequest,
} from "../linq/api";
import { hostedOnboardingError } from "./errors";
import { upsertHostedLinqLineForPhoneTx } from "./linq-line-store";
import {
  projectHostedLinqChatHealthTx,
} from "./linq-provider-health-store";
import {
  parseHostedLinqChatHealthStatus,
  type HostedLinqChatHealthStatus,
} from "./linq-provider-status";
import { normalizePhoneNumber } from "./phone";
import { requireHostedOnboardingLinqConfig } from "./runtime";
import { normalizeNullableString } from "./shared";

type HostedLinqChatHealthClient = PrismaClient | Prisma.TransactionClient;

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
  prisma: HostedLinqChatHealthClient;
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
  const lineLookupKeyByPhone = new Map<string, string>();
  const linePhoneNumbers = [...new Set(
    inventory.chats
      .map((chat) => chat.linePhoneNumber)
      .filter((phoneNumber): phoneNumber is string => phoneNumber !== null),
  )];
  for (const phoneNumber of linePhoneNumbers) {
    const line = await upsertHostedLinqLineForPhoneTx({
      observedAt,
      phoneNumber,
      prisma: input.prisma,
      source: "provider",
    });
    lineLookupKeyByPhone.set(phoneNumber, line.phoneNumberLookupKey);
  }

  let syncedCount = 0;
  for (const chat of inventory.chats) {
    const projected = await projectHostedLinqChatHealthTx({
      chatId: chat.chatId,
      observedAt,
      phoneNumberLookupKey: chat.linePhoneNumber
        ? lineLookupKeyByPhone.get(chat.linePhoneNumber) ?? null
        : null,
      prisma: input.prisma,
      providerStatus: chat.providerStatus,
      providerUpdatedAt: chat.providerUpdatedAt,
      isGroup: chat.isGroup,
      service: chat.service,
    });
    if (projected) {
      syncedCount += 1;
    }
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
  const maxChats = normalizeHostedLinqChatHealthLimit(input.maxChats);
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
  records: Chat[];
}> {
  const { apiBaseUrl, apiToken } = requireHostedOnboardingLinqConfig();
  try {
    const page = await runLinqApiRequest({
      apiBaseUrl,
      apiToken,
      request: (client) => client.chats.listChats({
        ...(input.cursor ? { cursor: input.cursor } : {}),
        limit: HOSTED_LINQ_CHAT_HEALTH_PAGE_SIZE,
      }, { signal: input.signal }),
      signal: input.signal,
      timeoutMessage: "Linq chat-health inventory sync timed out.",
    });
    return {
      nextCursor: normalizeNullableString(page.next_cursor),
      records: page.chats,
    };
  } catch (error) {
    if (error instanceof LinqApiTimeoutError) {
      throw hostedOnboardingError({
        cause: error,
        code: "LINQ_CHAT_HEALTH_INVENTORY_FAILED",
        httpStatus: 502,
        message: "Linq chat-health inventory sync timed out.",
        retryable: true,
      });
    }
    const status = readLinqApiErrorStatus(error);
    if (status !== null) {
      throw hostedOnboardingError({
        cause: error,
        code: "LINQ_CHAT_HEALTH_INVENTORY_FAILED",
        httpStatus: 502,
        message: `Linq chat-health inventory sync failed with HTTP ${status}.`,
        retryable: status === 429 || status >= 500,
      });
    }
    throw error;
  }
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
