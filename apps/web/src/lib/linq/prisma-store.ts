import { Prisma, PrismaClient } from "@prisma/client";

import { generateHostedRandomPrefixedId, toIsoTimestamp } from "../device-sync/shared";
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
    const record = await this.prisma.linqRecipientBinding.findUnique({
      where: {
        recipientPhone,
      },
    });

    return record ? mapHostedLinqBindingRecord(record) : null;
  }

  async upsertBinding(input: {
    userId: string;
    recipientPhone: string;
    label?: string | null;
  }): Promise<HostedLinqBindingRecord> {
    const existing = await this.prisma.linqRecipientBinding.findUnique({
      where: {
        recipientPhone: input.recipientPhone,
      },
    });

    if (existing) {
      if (existing.userId !== input.userId) {
        throw hostedLinqError({
          code: "LINQ_BINDING_OWNERSHIP_CONFLICT",
          message: `Linq recipient phone ${input.recipientPhone} is already paired to a different hosted user.`,
          httpStatus: 409,
          details: {
            recipientPhone: input.recipientPhone,
          },
        });
      }

      const updated = await this.prisma.linqRecipientBinding.update({
        where: {
          id: existing.id,
        },
        data: {
          label: input.label ?? null,
        },
      });

      return mapHostedLinqBindingRecord(updated);
    }

    try {
      const created = await this.prisma.linqRecipientBinding.create({
        data: {
          id: generateHostedRandomPrefixedId("linqb"),
          userId: input.userId,
          recipientPhone: input.recipientPhone,
          label: input.label ?? null,
        },
      });

      return mapHostedLinqBindingRecord(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const conflicted = await this.prisma.linqRecipientBinding.findUnique({
          where: {
            recipientPhone: input.recipientPhone,
          },
        });

        if (conflicted && conflicted.userId !== input.userId) {
          throw hostedLinqError({
            code: "LINQ_BINDING_OWNERSHIP_CONFLICT",
            message: `Linq recipient phone ${input.recipientPhone} is already paired to a different hosted user.`,
            httpStatus: 409,
            details: {
              recipientPhone: input.recipientPhone,
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
          recipientPhone: input.recipientPhone,
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
}

export function mapHostedLinqBindingRecord(record: LinqBindingPrismaRecord): HostedLinqBindingRecord {
  return {
    id: record.id,
    userId: record.userId,
    recipientPhone: record.recipientPhone,
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
    recipientPhone: record.recipientPhone,
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
