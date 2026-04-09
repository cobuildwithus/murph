import { createHmac } from "node:crypto";
import type { LinqWebhookEvent } from "@murphai/messaging-ingress/linq-webhook";

export function signLinqWebhook(secret: string, payload: string, timestamp: string): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `sha256=${signature}`;
}

export function buildV2026LinqWebhookEvent(input: {
  createdAt?: string;
  data?: Record<string, unknown>;
  eventId?: string;
  eventType?: string;
  traceId?: string | null;
} = {}): LinqWebhookEvent {
  return {
    api_version: "v3",
    created_at: input.createdAt ?? "2026-03-24T10:00:05.000Z",
    webhook_version: "2026-02-03",
    data: {
      chat: {
        id: "chat_123",
        owner_handle: {
          handle: "+15557654321",
          id: "handle_owner_123",
          is_me: true,
          service: "SMS",
        },
      },
      direction: "inbound",
      id: "msg_123",
      parts: [],
      sender_handle: {
        handle: "+15551234567",
        id: "handle_sender_123",
        service: "SMS",
      },
      sent_at: "2026-03-24T10:00:00.000Z",
      service: "SMS",
      ...(input.data ?? {}),
    },
    event_id: input.eventId ?? "evt_123",
    event_type: input.eventType ?? "message.received",
    trace_id: input.traceId ?? undefined,
  } as LinqWebhookEvent;
}
