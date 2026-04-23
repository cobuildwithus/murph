import { getPrisma } from "../prisma";
import {
  assertBrowserMutationOrigin,
  requireAuthenticatedHostedUser,
  type AuthenticatedHostedUser,
} from "../device-sync/auth";
import { HostedAgentSessionService } from "../hosted-agent-sessions";
import {
  createHostedDeviceSyncControlPlaneContext,
  type HostedDeviceSyncControlPlaneContext,
} from "../device-sync/control-plane-context";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import { readHostedPhoneHint } from "../hosted-onboarding/contact-privacy";
import { readRawBodyBuffer } from "../http";
import { normalizeNullableString, parseInteger, toIsoTimestamp } from "../primitives";
import { hostedLinqError } from "./errors";
import { fetchLinqApi, LinqApiTimeoutError } from "./api";
import { readHostedLinqEnvironment } from "./env";
import { PrismaLinqControlPlaneStore } from "./prisma-store";
import {
  parseLinqMessageReceivedEvent,
  readLinqRecipientLineHandle,
  resolveLinqWebhookOccurredAt,
  verifyAndParseLinqWebhookRequest,
  type LinqWebhookEvent,
} from "@murphai/messaging-ingress/linq-webhook";

export const HOSTED_LINQ_BASE_PATH = "/api/linq";
export const HOSTED_LINQ_WEBHOOK_PATH = `${HOSTED_LINQ_BASE_PATH}/webhook`;
export const HOSTED_LINQ_BINDINGS_PATH = `${HOSTED_LINQ_BASE_PATH}/bindings`;
export const HOSTED_LINQ_AGENT_PAIR_PATH = `${HOSTED_LINQ_BASE_PATH}/agents/pair`;
export const HOSTED_LINQ_AGENT_EVENTS_PATH = `${HOSTED_LINQ_BASE_PATH}/agent/events`;

type HostedLinqWebhookResponse = ReturnType<typeof buildIgnoredWebhookResult> | {
  accepted: true;
  duplicate: boolean;
  routed: true;
  bindingId: string;
  recipientPhone: string;
  eventId: string;
  eventType: string;
  traceId: string | null;
  queueId: number;
};

export class HostedLinqControlPlane {
  readonly request: Request;
  readonly env = readHostedLinqEnvironment();
  private store: PrismaLinqControlPlaneStore | null = null;
  private deviceSyncContext: HostedDeviceSyncControlPlaneContext | null = null;
  private agentSessions: HostedAgentSessionService | null = null;
  private authenticatedUserPromise: Promise<AuthenticatedHostedUser> | null = null;

  constructor(request: Request) {
    this.request = request;
  }

  private getDeviceSyncContext() {
    if (!this.deviceSyncContext) {
      this.deviceSyncContext = createHostedDeviceSyncControlPlaneContext(this.request);
    }

    return this.deviceSyncContext;
  }

  private getAgentSessions() {
    if (!this.agentSessions) {
      const context = this.getDeviceSyncContext();
      this.agentSessions = new HostedAgentSessionService({
        request: this.request,
        store: context.store,
        pairPath: HOSTED_LINQ_AGENT_PAIR_PATH,
      });
    }

    return this.agentSessions;
  }

  private requireAuthenticatedUser(): Promise<AuthenticatedHostedUser> {
    if (!this.authenticatedUserPromise) {
      const context = this.getDeviceSyncContext();
      this.authenticatedUserPromise = requireAuthenticatedHostedUser(this.request, context.env, {
        nonceStore: context.store,
      });
    }

    return this.authenticatedUserPromise;
  }

  private assertBrowserMutationOrigin(): void {
    const context = this.getDeviceSyncContext();
    assertBrowserMutationOrigin(this.request, {
      ...context.env,
      allowedReturnOrigins: context.allowedReturnOrigins,
    });
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
    const user = await this.requireAuthenticatedUser();

    return {
      bindings: await this.getStore().listBindingsForUser(user.id),
    };
  }

  async upsertBinding(body: Record<string, unknown>) {
    this.assertBrowserMutationOrigin();
    const user = await this.requireAuthenticatedUser();
    const recipientPhone = normalizeRequiredRecipientPhone(body.recipientPhone);
    const label = normalizeNullableString(typeof body.label === "string" ? body.label : null);
    await this.assertRecipientPhoneOwnedByConfiguredAccount(recipientPhone);

    return {
      binding: await this.getStore().upsertBinding({
        userId: user.id,
        recipientPhone,
        label,
      }),
    };
  }

  async pairAgent(body: Record<string, unknown>) {
    this.assertBrowserMutationOrigin();
    const label = normalizeNullableString(typeof body.label === "string" ? body.label : null);

    return await this.getAgentSessions().createAgentSession(
      await this.requireAuthenticatedUser(),
      label,
    );
  }

  async listAgentEvents(url: URL) {
    const session = await this.getAgentSessions().requireAgentSession();
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
      timestampToleranceMs: this.env.webhookTimestampToleranceMs,
      webhookSecret: this.env.webhookSecret,
    });

    return this.planWebhookResponse(event);
  }

  private async assertRecipientPhoneOwnedByConfiguredAccount(recipientPhone: string): Promise<void> {
    const ownedRecipientPhones = await this.listOwnedRecipientPhones();

    if (ownedRecipientPhones.has(recipientPhone)) {
      return;
    }

    throw hostedLinqError({
      code: "LINQ_BINDING_RECIPIENT_UNVERIFIED",
      message: `Configured Linq account does not control recipient phone ${readHostedPhoneHint(recipientPhone)}.`,
      httpStatus: 403,
      details: {
        recipientPhone: readHostedPhoneHint(recipientPhone),
      },
    });
  }

  private async listOwnedRecipientPhones(): Promise<Set<string>> {
    if (!this.env.apiToken) {
      throw hostedLinqError({
        code: "LINQ_API_TOKEN_REQUIRED",
        message: "LINQ_API_TOKEN is required to verify hosted Linq recipient bindings.",
        httpStatus: 500,
      });
    }

    let response: Response;
    try {
      response = await fetchLinqApi({
        apiBaseUrl: this.env.apiBaseUrl,
        apiToken: this.env.apiToken,
        path: "phone_numbers",
        signal: this.request.signal,
      });
    } catch (error) {
      if (error instanceof LinqApiTimeoutError) {
        throw hostedLinqError({
          code: "LINQ_BINDING_PROBE_FAILED",
          message: "Linq recipient verification timed out.",
          httpStatus: 502,
          retryable: true,
        });
      }

      throw error;
    }

    if (!response.ok) {
      throw hostedLinqError({
        code: "LINQ_BINDING_PROBE_FAILED",
        message: `Linq recipient verification failed with HTTP ${response.status}.`,
        httpStatus: 502,
        retryable: response.status === 429 || response.status >= 500,
      });
    }

    const payload = (await response.json()) as {
      phone_numbers?: Array<{ phone_number?: string | null }> | null;
    };

    return new Set(
      (payload.phone_numbers ?? [])
        .map((entry) => normalizeOptionalRecipientPhone(entry.phone_number ?? null))
        .filter((value): value is string => value !== null),
    );
  }

  private async planWebhookResponse(event: LinqWebhookEvent): Promise<HostedLinqWebhookResponse> {
    if (event.event_type !== "message.received") {
      return this.buildIgnoredWebhookResponse(event);
    }

    let messageEvent: ReturnType<typeof parseLinqMessageReceivedEvent>;
    try {
      messageEvent = parseLinqMessageReceivedEvent(event);
    } catch (error) {
      if (error instanceof TypeError) {
        throw hostedLinqError({
          code: "LINQ_PAYLOAD_INVALID",
          message: error.message,
          httpStatus: 400,
          cause: error,
        });
      }

      throw error;
    }
    const recipientPhone = normalizeOptionalRecipientPhone(
      readLinqRecipientLineHandle(messageEvent.data),
    );

    if (!recipientPhone) {
      return this.buildIgnoredWebhookResponse(event, {
        reason: "recipient_phone_missing",
      });
    }

    const binding = await this.getStore().getBindingByRecipientPhone(recipientPhone);

    if (!binding) {
      return this.buildIgnoredWebhookResponse(event, {
        reason: "unpaired_recipient_phone",
        recipientPhone: readHostedPhoneHint(recipientPhone),
      });
    }

    const queued = await this.getStore().queueWebhookEventIfNew({
      userId: binding.userId,
      bindingId: binding.id,
      recipientPhone,
      eventId: event.event_id,
      traceId: event.trace_id ?? null,
      eventType: event.event_type,
      chatId: normalizeNullableString(messageEvent.data.chat_id),
      messageId: normalizeNullableString(messageEvent.data.message?.id),
      occurredAt: resolveLinqWebhookOccurredAt(messageEvent),
      receivedAt: toIsoTimestamp(new Date()),
    });

    return {
      accepted: true,
      duplicate: !queued.inserted,
      routed: true,
      bindingId: binding.id,
      recipientPhone: binding.recipientPhone,
      eventId: queued.event.eventId,
      eventType: queued.event.eventType,
      traceId: queued.event.traceId,
      queueId: queued.event.id,
    };
  }

  private async buildIgnoredWebhookResponse(
    event: LinqWebhookEvent,
    extra?: {
      reason?: string;
      recipientPhone?: string;
    },
  ): Promise<ReturnType<typeof buildIgnoredWebhookResult>> {
    return buildIgnoredWebhookResult(event, {
      reason: extra?.reason,
      recipientPhone: extra?.recipientPhone,
    });
  }
}

export function createHostedLinqControlPlane(request: Request): HostedLinqControlPlane {
  return new HostedLinqControlPlane(request);
}

function buildIgnoredWebhookResult(
  event: LinqWebhookEvent,
  extra?: {
    duplicate?: boolean;
    reason?: string;
    recipientPhone?: string;
  },
): {
  accepted: true;
  duplicate: boolean;
  routed: false;
  ignored: true;
  reason?: string;
  recipientPhone?: string;
  eventId: string;
  eventType: string;
  traceId: string | null;
} {
  return {
    accepted: true,
    duplicate: extra?.duplicate ?? false,
    routed: false,
    ignored: true,
    ...(extra?.reason ? { reason: extra.reason } : {}),
    ...(extra?.recipientPhone ? { recipientPhone: extra.recipientPhone } : {}),
    eventId: event.event_id,
    eventType: event.event_type,
    traceId: event.trace_id ?? null,
  };
}

function normalizeOptionalRecipientPhone(value: unknown): string | null {
  return normalizePhoneNumber(typeof value === "string" ? value : null);
}

function normalizeRequiredRecipientPhone(value: unknown): string {
  const normalized = normalizeOptionalRecipientPhone(value);

  if (normalized) {
    return normalized;
  }

  throw hostedLinqError({
    code: "LINQ_RECIPIENT_PHONE_INVALID",
    message: "Linq recipientPhone must be a valid phone number.",
    httpStatus: 400,
  });
}
