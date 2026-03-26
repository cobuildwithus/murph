import { describe, expect, it } from "vitest";

import { PrismaLinqControlPlaneStore } from "@/src/lib/linq/prisma-store";

type MutableLinqWebhookEvent = {
  id: number;
  userId: string;
  bindingId: string;
  recipientPhone: string;
  eventId: string;
  traceId: string | null;
  eventType: string;
  chatId: string | null;
  messageId: string | null;
  occurredAt: Date | null;
  receivedAt: Date;
  createdAt: Date;
};

function createStore(seed: MutableLinqWebhookEvent[] = []) {
  const events = new Map<number, MutableLinqWebhookEvent>(
    seed.map((event) => [
      event.id,
      cloneEvent(event),
    ]),
  );
  const createCalls: Record<string, unknown>[] = [];
  let nextId = seed.reduce((max, event) => Math.max(max, event.id), 0) + 1;

  const linqWebhookEvent = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      createCalls.push({ ...data });
      const event = normalizeEventRecord(nextId, data);
      events.set(event.id, event);
      nextId += 1;
      return cloneEvent(event);
    },
    findUnique: async ({ where }: { where: Record<string, unknown> }) => {
      if (typeof where.eventId !== "string") {
        return null;
      }

      for (const event of events.values()) {
        if (event.eventId === where.eventId) {
          return cloneEvent(event);
        }
      }

      return null;
    },
    findMany: async ({ where }: { where: Record<string, unknown> }) => {
      const rows = [...events.values()].filter((event) => matchesWhere(event, where));
      rows.sort((left, right) => left.id - right.id);
      return rows.map(cloneEvent);
    },
  };

  const store = new PrismaLinqControlPlaneStore({
    prisma: {
      linqWebhookEvent,
    } as never,
  });

  return {
    createCalls,
    store,
  };
}

describe("PrismaLinqControlPlaneStore hosted Linq webhook events", () => {
  it("persists and returns only sparse routing fields", async () => {
    const { createCalls, store } = createStore();

    const queued = await store.queueWebhookEventIfNew({
      userId: "user-123",
      bindingId: "linqb_123",
      recipientPhone: "+15557654321",
      eventId: "evt_sparse_123",
      traceId: "trace_sparse_123",
      eventType: "message.received",
      chatId: "chat_123",
      messageId: "msg_123",
      occurredAt: "2026-03-25T10:00:05.000Z",
      receivedAt: "2026-03-25T10:00:06.000Z",
    });

    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toEqual({
      userId: "user-123",
      bindingId: "linqb_123",
      recipientPhone: "+15557654321",
      eventId: "evt_sparse_123",
      traceId: "trace_sparse_123",
      eventType: "message.received",
      chatId: "chat_123",
      messageId: "msg_123",
      occurredAt: new Date("2026-03-25T10:00:05.000Z"),
      receivedAt: new Date("2026-03-25T10:00:06.000Z"),
    });
    expect("payloadJson" in createCalls[0]!).toBe(false);
    expect(queued.event).toEqual({
      id: 1,
      userId: "user-123",
      bindingId: "linqb_123",
      recipientPhone: "+15557654321",
      eventId: "evt_sparse_123",
      traceId: "trace_sparse_123",
      eventType: "message.received",
      chatId: "chat_123",
      messageId: "msg_123",
      occurredAt: "2026-03-25T10:00:05.000Z",
      receivedAt: "2026-03-25T10:00:06.000Z",
      createdAt: "2026-03-25T10:00:06.000Z",
    });
    expect("payload" in queued.event).toBe(false);

    const listed = await store.listEventsForUser("user-123");

    expect(listed).toEqual([queued.event]);
    expect("payload" in listed[0]!).toBe(false);
  });
});

function normalizeEventRecord(id: number, data: Record<string, unknown>): MutableLinqWebhookEvent {
  if (
    typeof data.userId !== "string" ||
    typeof data.bindingId !== "string" ||
    typeof data.recipientPhone !== "string" ||
    typeof data.eventId !== "string" ||
    typeof data.eventType !== "string" ||
    !(data.receivedAt instanceof Date)
  ) {
    throw new TypeError("Invalid hosted Linq webhook event record.");
  }

  return {
    id,
    userId: data.userId,
    bindingId: data.bindingId,
    recipientPhone: data.recipientPhone,
    eventId: data.eventId,
    traceId: data.traceId === null || typeof data.traceId === "string" ? data.traceId : null,
    eventType: data.eventType,
    chatId: data.chatId === null || typeof data.chatId === "string" ? data.chatId : null,
    messageId: data.messageId === null || typeof data.messageId === "string" ? data.messageId : null,
    occurredAt: data.occurredAt instanceof Date ? new Date(data.occurredAt) : null,
    receivedAt: new Date(data.receivedAt),
    createdAt: new Date(data.receivedAt),
  };
}

function matchesWhere(event: MutableLinqWebhookEvent, where: Record<string, unknown>): boolean {
  if (typeof where.userId === "string" && event.userId !== where.userId) {
    return false;
  }

  if (!where.id || typeof where.id !== "object" || Array.isArray(where.id)) {
    return true;
  }

  return !(where.id as { gt?: unknown }).gt || event.id > Number((where.id as { gt: number }).gt);
}

function cloneEvent(event: MutableLinqWebhookEvent): MutableLinqWebhookEvent {
  return {
    ...event,
    traceId: event.traceId,
    chatId: event.chatId,
    messageId: event.messageId,
    occurredAt: event.occurredAt ? new Date(event.occurredAt) : null,
    receivedAt: new Date(event.receivedAt),
    createdAt: new Date(event.createdAt),
  };
}
