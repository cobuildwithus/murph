import { getPrisma } from "../prisma";
import { createHostedDeviceSyncControlPlane } from "../device-sync/control-plane";
import { normalizeString, parseInteger, toIsoTimestamp } from "../device-sync/shared";
import { readRawBodyBuffer } from "../http";
import { hostedLinqError } from "./errors";
import { readHostedLinqEnvironment } from "./env";
import { PrismaLinqControlPlaneStore } from "./prisma-store";
import {
  requireLinqMessageReceivedEvent,
  verifyAndParseLinqWebhookRequest,
  type LinqWebhookEvent,
} from "@murph/inboxd";

export const HOSTED_LINQ_BASE_PATH = "/api/linq";
export const HOSTED_LINQ_WEBHOOK_PATH = `${HOSTED_LINQ_BASE_PATH}/webhook`;
export const HOSTED_LINQ_BINDINGS_PATH = `${HOSTED_LINQ_BASE_PATH}/bindings`;
export const HOSTED_LINQ_AGENT_PAIR_PATH = `${HOSTED_LINQ_BASE_PATH}/agents/pair`;
export const HOSTED_LINQ_AGENT_EVENTS_PATH = `${HOSTED_LINQ_BASE_PATH}/agent/events`;

export class HostedLinqControlPlane {
  readonly request: Request;
  readonly env = readHostedLinqEnvironment();
  private store: PrismaLinqControlPlaneStore | null = null;
  private authControlPlane: ReturnType<typeof createHostedDeviceSyncControlPlane> | null = null;

  constructor(request: Request) {
    this.request = request;
  }

  private getAuthControlPlane() {
    if (!this.authControlPlane) {
      this.authControlPlane = createHostedDeviceSyncControlPlane(this.request);
    }

    return this.authControlPlane;
  }

  private getStore() {
    if (!this.store) {
      this.store = new PrismaLinqControlPlaneStore({ prisma: getPrisma() });
    }

    return this.store;
  }

  info() {
    const url = new URL(this.request.url);
    const baseUrl = new URL(HOSTED_LINQ_BASE_PATH, url.origin).toString();

    return {
      ok: true,
      baseUrl,
      routes: {
        webhookPath: HOSTED_LINQ_WEBHOOK_PATH,
        webhookUrl: new URL(HOSTED_LINQ_WEBHOOK_PATH, url.origin).toString(),
        bindingsPath: HOSTED_LINQ_BINDINGS_PATH,
        agentPairPath: HOSTED_LINQ_AGENT_PAIR_PATH,
        agentEventsPath: HOSTED_LINQ_AGENT_EVENTS_PATH,
      },
      webhookSigning: {
        configured: Boolean(this.env.webhookSecret),
      },
    };
  }

  async listBindings() {
    const user = await this.getAuthControlPlane().requireAuthenticatedUser();

    return {
      bindings: await this.getStore().listBindingsForUser(user.id),
    };
  }

  async upsertBinding(body: Record<string, unknown>) {
    this.getAuthControlPlane().assertBrowserMutationOrigin();
    const user = await this.getAuthControlPlane().requireAuthenticatedUser();
    const recipientPhone = normalizeRequiredString(body.recipientPhone, "Linq recipientPhone");
    const label = normalizeString(typeof body.label === "string" ? body.label : null);

    return {
      binding: await this.getStore().upsertBinding({
        userId: user.id,
        recipientPhone,
        label,
      }),
    };
  }

  async pairAgent(body: Record<string, unknown>) {
    this.getAuthControlPlane().assertBrowserMutationOrigin();
    const user = await this.getAuthControlPlane().requireAuthenticatedUser();
    const label = normalizeString(typeof body.label === "string" ? body.label : null);

    return await this.getAuthControlPlane().pairAgent(user.id, label);
  }

  async listAgentEvents(url: URL) {
    const session = await this.getAuthControlPlane().requireAgentSession();
    const afterId = parseInteger(url.searchParams.get("after"));
    const limit = parseInteger(url.searchParams.get("limit")) ?? 100;
    const events = await this.getStore().listEventsForUser(session.userId, {
      afterId,
      limit,
    });

    return {
      events,
      nextCursor: events.length > 0 ? events[events.length - 1].id : afterId,
    };
  }

  async handleWebhook() {
    if (!this.env.webhookSecret) {
      throw hostedLinqError({
        code: "LINQ_WEBHOOK_SECRET_MISSING",
        message: "LINQ_WEBHOOK_SECRET is required for the hosted Linq webhook ingress.",
        httpStatus: 500,
      });
    }

    const rawBody = await readRawBodyBuffer(this.request);
    const event = verifyAndParseLinqWebhookRequest({
      headers: this.request.headers,
      rawBody,
      webhookSecret: this.env.webhookSecret,
    });

    if (event.event_type !== "message.received") {
      return {
        accepted: true,
        duplicate: false,
        routed: false,
        ignored: true,
        eventId: event.event_id,
        eventType: event.event_type,
        traceId: event.trace_id ?? null,
      };
    }

    const messageEvent = requireLinqMessageReceivedEvent(event);
    const recipientPhone = normalizeString(messageEvent.data.recipient_phone ?? null);

    if (!recipientPhone) {
      return {
        accepted: true,
        duplicate: false,
        routed: false,
        ignored: true,
        reason: "recipient_phone_missing",
        eventId: event.event_id,
        eventType: event.event_type,
        traceId: event.trace_id ?? null,
      };
    }

    const binding = await this.getStore().getBindingByRecipientPhone(recipientPhone);

    if (!binding) {
      return {
        accepted: true,
        duplicate: false,
        routed: false,
        ignored: true,
        reason: "unpaired_recipient_phone",
        recipientPhone,
        eventId: event.event_id,
        eventType: event.event_type,
        traceId: event.trace_id ?? null,
      };
    }

    const queued = await this.getStore().queueWebhookEventIfNew({
      userId: binding.userId,
      bindingId: binding.id,
      recipientPhone,
      eventId: event.event_id,
      traceId: event.trace_id ?? null,
      eventType: event.event_type,
      chatId: normalizeString(messageEvent.data.chat_id),
      messageId: normalizeString(messageEvent.data.message?.id),
      occurredAt: resolveWebhookOccurredAt(event),
      receivedAt: toIsoTimestamp(new Date()),
    });

    return {
      accepted: true,
      duplicate: !queued.inserted,
      routed: true,
      bindingId: binding.id,
      recipientPhone,
      eventId: queued.event.eventId,
      eventType: queued.event.eventType,
      traceId: queued.event.traceId,
      queueId: queued.event.id,
    };
  }
}

export function createHostedLinqControlPlane(request: Request): HostedLinqControlPlane {
  return new HostedLinqControlPlane(request);
}

function resolveWebhookOccurredAt(event: LinqWebhookEvent): string | null {
  if (event.event_type !== "message.received") {
    return normalizeIsoTimestamp(event.created_at);
  }

  const receivedAt = normalizeIsoTimestamp(
    typeof event.data === "object" && event.data && "received_at" in event.data
      ? String((event.data as { received_at?: unknown }).received_at ?? "")
      : null,
  );

  return receivedAt ?? normalizeIsoTimestamp(event.created_at);
}

function normalizeIsoTimestamp(value: string | null | undefined): string | null {
  const normalized = normalizeString(value);

  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function normalizeRequiredString(value: unknown, label: string): string {
  const normalized = normalizeString(typeof value === "string" ? value : null);

  if (!normalized) {
    throw hostedLinqError({
      code: "LINQ_REQUIRED_FIELD_MISSING",
      message: `${label} is required.`,
      httpStatus: 400,
    });
  }

  return normalized;
}
