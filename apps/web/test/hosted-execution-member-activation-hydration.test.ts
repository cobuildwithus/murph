import { describe, expect, it } from "vitest";

import { hydrateHostedExecutionDispatch } from "@/src/lib/hosted-execution/hydration";
import { serializeHostedExecutionOutboxPayload } from "@/src/lib/hosted-execution/outbox-payload";
import { buildHostedMemberActivationDispatch } from "@/src/lib/hosted-onboarding/member-activation";

describe("hosted execution member activation hydration", () => {
  it("rehydrates first contact from sparse hosted member state", async () => {
    const dispatch = buildHostedMemberActivationDispatch({
      memberId: "member_123",
      occurredAt: "2026-04-04T00:00:00.000Z",
      sourceEventId: "evt_123",
      sourceType: "stripe.invoice.paid",
    });
    const prisma = {
      hostedMember: {
        findUnique: async () => ({
          linqChatId: "chat_123",
          normalizedPhoneNumber: "phone_lookup_123",
        }),
      },
    } as const;

    const hydrated = await hydrateHostedExecutionDispatch(
      {
        eventId: dispatch.eventId,
        eventKind: dispatch.event.kind,
        payloadJson: serializeHostedExecutionOutboxPayload(dispatch, {
          storage: "reference",
        }),
        sourceId: "stripe:evt_123",
        sourceType: "hosted_stripe_event",
        userId: dispatch.event.userId,
      } as never,
      prisma as never,
    );

    expect(hydrated).toEqual({
      event: {
        firstContact: {
          channel: "linq",
          identityId: "phone_lookup_123",
          threadId: "chat_123",
          threadIsDirect: true,
        },
        kind: "member.activated",
        userId: "member_123",
      },
      eventId: dispatch.eventId,
      occurredAt: dispatch.occurredAt,
    });
  });

  it("keeps first contact null when no sparse Linq binding remains", async () => {
    const dispatch = buildHostedMemberActivationDispatch({
      memberId: "member_456",
      occurredAt: "2026-04-04T00:00:00.000Z",
      sourceEventId: "evt_456",
      sourceType: "stripe.invoice.paid",
    });
    const prisma = {
      hostedMember: {
        findUnique: async () => ({
          linqChatId: null,
          normalizedPhoneNumber: "phone_lookup_456",
        }),
      },
    } as const;

    const hydrated = await hydrateHostedExecutionDispatch(
      {
        eventId: dispatch.eventId,
        eventKind: dispatch.event.kind,
        payloadJson: serializeHostedExecutionOutboxPayload(dispatch, {
          storage: "reference",
        }),
        sourceId: "stripe:evt_456",
        sourceType: "hosted_stripe_event",
        userId: dispatch.event.userId,
      } as never,
      prisma as never,
    );

    expect(hydrated).toEqual({
      event: {
        firstContact: null,
        kind: "member.activated",
        userId: "member_456",
      },
      eventId: dispatch.eventId,
      occurredAt: dispatch.occurredAt,
    });
  });
});
