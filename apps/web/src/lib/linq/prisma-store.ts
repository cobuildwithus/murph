import { Prisma, PrismaClient } from "@prisma/client";

import { generateHostedRandomPrefixedId, toIsoTimestamp } from "../device-sync/shared";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import { hostedLinqError } from "./errors";

export interface HostedLinqBindingRecord {
  id: string;
  userId: string;
  recipientPhone: string;
  label: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HostedLinqWebhookEventRecord {
  id: number;
  userId: string;
  bindingId: string;
  recipientPhone: string;
  eventId: string;
  traceId: string | null;
  eventType: string;
  chatId: string | null;
  messageId: string | null;
  occurredAt: string | null;
  receivedAt: string;
  createdAt: string;
}

export interface QueueHostedLinqWebhookEventInput {
  userId: string;
  bindingId: string;
  recipientPhone: string;
  eventId: string;
  traceId?: string | null;
  eventType: string;
  chatId?: string | null;
  messageId?: string | null;
  occurredAt?: string | null;
  receivedAt: string;
}

type LinqBindingPrismaRecord = Prisma.LinqRecipientBindingGetPayload<Prisma.LinqRecipientBindingDefaultArgs>;
type LinqWebhookEventPrismaRecord = Prisma.LinqWebhookEventGetPayload<Prisma.LinqWebhookEventDefaultArgs>;

export class PrismaLinqControlPlaneStore {
  readonly prisma: PrismaClient;

  constructor(input: { prisma: PrismaClient }) {
    this.prisma = input.prisma;
  }

  async listBindingsForUser(userId: string): Promise<HostedLinqBindingRecord[]> {
    const records = await this.prisma.linqRecipientBinding.findMany({
      where: {
        userId,
      },
      orderBy: [
        {
          recipientPhone: "asc",
        },
        {
          createdAt: "asc",
        },
      ],
    });

    return records.map(mapHostedLinqBindingRecord);
  }

  async getBindingByRecipientPhone(recipientPhone: string): Promise<HostedLinqBindingRecord | null> {
    const records = await this.findBindingsByCanonicalRecipientPhone(recipientPhone);

    if (records.length === 0) {
      return null;
    }

    const uniqueUserIds = new Set(records.map((record) => record.userId));
    if (uniqueUserIds.size > 1) {
      throw hostedLinqError({
        code: "LINQ_BINDING_OWNERSHIP_CONFLICT",
        message: `Linq recipient phone ${recipientPhone} is paired to multiple hosted users.`,
        httpStatus: 409,
        details: {
          recipientPhone,
        },
      });
    }

    const record = choosePreferredBindingRecord(records);

    return record ? mapHostedLinqBindingRecord(record) : null;
  }

  async upsertBinding(input: {
    userId: string;
    recipientPhone: string;
    label?: string | null;
  }): Promise<HostedLinqBindingRecord> {
    const recipientPhone = normalizeCanonicalRecipientPhone(input.recipientPhone);
    const existingRecords = await this.findBindingsByCanonicalRecipientPhone(recipientPhone);
    const existingByOtherUser = existingRecords.find((record) => record.userId !== input.userId);

    if (existingByOtherUser) {
      throw hostedLinqError({
        code: "LINQ_BINDING_OWNERSHIP_CONFLICT",
        message: `Linq recipient phone ${recipientPhone} is already paired to a different hosted user.`,
        httpStatus: 409,
        details: {
          recipientPhone,
        },
      });
    }

    const existing = choosePreferredBindingRecord(existingRecords);

    if (existing) {
      const updated = await this.prisma.linqRecipientBinding.update({
        where: {
          id: existing.id,
        },
        data: {
          label: input.label ?? null,
          recipientPhone,
        },
      });

      return mapHostedLinqBindingRecord(updated);
    }

    try {
      const created = await this.prisma.linqRecipientBinding.create({
        data: {
          id: generateHostedRandomPrefixedId("linqb"),
          userId: input.userId,
          recipientPhone,
          label: input.label ?? null,
        },
      });

      return mapHostedLinqBindingRecord(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const conflicted = await this.findBindingsByCanonicalRecipientPhone(recipientPhone);
        const conflictedByOtherUser = conflicted.find((record) => record.userId !== input.userId);

        if (conflictedByOtherUser) {
          throw hostedLinqError({
            code: "LINQ_BINDING_OWNERSHIP_CONFLICT",
            message: `Linq recipient phone ${recipientPhone} is already paired to a different hosted user.`,
            httpStatus: 409,
            details: {
              recipientPhone,
            },
            cause: error,
          });
        }
      }

      throw error;
    }
  }

  async queueWebhookEventIfNew(input: QueueHostedLinqWebhookEventInput): Promise<{
    inserted: boolean;
    event: HostedLinqWebhookEventRecord;
  }> {
    try {
      const created = await this.prisma.linqWebhookEvent.create({
        data: {
          userId: input.userId,
          bindingId: input.bindingId,
          recipientPhone: normalizeCanonicalRecipientPhone(input.recipientPhone),
          eventId: input.eventId,
          traceId: input.traceId ?? null,
          eventType: input.eventType,
          chatId: input.chatId ?? null,
          messageId: input.messageId ?? null,
          occurredAt: input.occurredAt ? new Date(input.occurredAt) : null,
          receivedAt: new Date(input.receivedAt),
        },
      });

      return {
        inserted: true,
        event: mapHostedLinqWebhookEventRecord(created),
      };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const existing = await this.prisma.linqWebhookEvent.findUnique({
        where: {
          eventId: input.eventId,
        },
      });

      if (!existing) {
        throw error;
      }

      return {
        inserted: false,
        event: mapHostedLinqWebhookEventRecord(existing),
      };
    }
  }

  async listEventsForUser(userId: string, options: {
    afterId?: number | null;
    limit?: number | null;
  } = {}): Promise<HostedLinqWebhookEventRecord[]> {
    const afterId = typeof options.afterId === "number" ? options.afterId : null;
    const limit = Math.min(500, Math.max(1, typeof options.limit === "number" ? options.limit : 100));
    const records = await this.prisma.linqWebhookEvent.findMany({
      where: {
        userId,
        ...(typeof afterId === "number"
          ? {
              id: {
                gt: afterId,
              },
            }
          : {}),
      },
      orderBy: {
        id: "asc",
      },
      take: limit,
    });

    return records.map(mapHostedLinqWebhookEventRecord);
  }

  private async findBindingsByCanonicalRecipientPhone(recipientPhone: string): Promise<LinqBindingPrismaRecord[]> {
    const canonicalRecipientPhone = normalizeCanonicalRecipientPhone(recipientPhone);
    const records = await this.prisma.linqRecipientBinding.findMany({
      orderBy: [
        {
          createdAt: "asc",
        },
        {
          id: "asc",
        },
      ],
    });

    return records.filter((record) => normalizeStoredRecipientPhone(record.recipientPhone) === canonicalRecipientPhone);
  }
}

export function mapHostedLinqBindingRecord(record: LinqBindingPrismaRecord): HostedLinqBindingRecord {
  return {
    id: record.id,
    userId: record.userId,
    recipientPhone: normalizeStoredRecipientPhone(record.recipientPhone) ?? record.recipientPhone,
    label: record.label,
    createdAt: toIsoTimestamp(record.createdAt),
    updatedAt: toIsoTimestamp(record.updatedAt),
  };
}

export function mapHostedLinqWebhookEventRecord(record: LinqWebhookEventPrismaRecord): HostedLinqWebhookEventRecord {
  return {
    id: record.id,
    userId: record.userId,
    bindingId: record.bindingId,
    recipientPhone: normalizeStoredRecipientPhone(record.recipientPhone) ?? record.recipientPhone,
    eventId: record.eventId,
    traceId: record.traceId,
    eventType: record.eventType,
    chatId: record.chatId,
    messageId: record.messageId,
    occurredAt: record.occurredAt ? record.occurredAt.toISOString() : null,
    receivedAt: record.receivedAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: unknown };
  return candidate.code === "P2002";
}

function normalizeCanonicalRecipientPhone(recipientPhone: string): string {
  const normalized = normalizeStoredRecipientPhone(recipientPhone);

  if (normalized) {
    return normalized;
  }

  throw hostedLinqError({
    code: "LINQ_RECIPIENT_PHONE_INVALID",
    message: `Linq recipient phone ${recipientPhone} is invalid.`,
    httpStatus: 400,
    details: {
      recipientPhone,
    },
  });
}

function normalizeStoredRecipientPhone(recipientPhone: string | null | undefined): string | null {
  return normalizePhoneNumber(recipientPhone ?? null);
}

function choosePreferredBindingRecord(records: LinqBindingPrismaRecord[]): LinqBindingPrismaRecord | null {
  return records.find((record) => normalizeStoredRecipientPhone(record.recipientPhone) === record.recipientPhone) ?? records[0] ?? null;
}
