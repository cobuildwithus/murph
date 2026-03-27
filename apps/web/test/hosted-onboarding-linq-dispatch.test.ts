import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatchHostedExecution: vi.fn(),
  sendHostedLinqChatMessage: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/dispatch", () => ({
  dispatchHostedExecution: mocks.dispatchHostedExecution,
}));

vi.mock("@/src/lib/hosted-onboarding/linq", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/linq")>(
    "@/src/lib/hosted-onboarding/linq",
  );

  return {
    ...actual,
    sendHostedLinqChatMessage: mocks.sendHostedLinqChatMessage,
  };
});

vi.mock("@/src/lib/hosted-onboarding/runtime", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/runtime")>(
    "@/src/lib/hosted-onboarding/runtime",
  );

  return {
    ...actual,
    getHostedOnboardingEnvironment: () => ({
      encryptionKeyVersion: "v1",
      inviteTtlHours: 24,
      isProduction: false,
      linqApiBaseUrl: "https://linq.example.test",
      linqApiToken: "linq-token",
      linqWebhookSecret: null,
      publicBaseUrl: "https://join.example.test",
      sessionCookieName: "hb_hosted_session",
      sessionTtlDays: 30,
      stripeBillingMode: "payment",
      stripePriceId: "price_123",
      stripeSecretKey: "sk_test_123",
      stripeWebhookSecret: "whsec_123",
    }),
  };
});

import { HostedBillingStatus } from "@prisma/client";

import { handleHostedOnboardingLinqWebhook } from "@/src/lib/hosted-onboarding/service";

describe("handleHostedOnboardingLinqWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dispatchHostedExecution.mockResolvedValue({
      dispatched: true,
    });
  });

  it("dispatches active-member Linq messages to hosted execution instead of issuing a fresh invite", async () => {
    const prisma = {
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventType: "message.received",
            receiptAttemptCount: 1,
            receiptStatus: "processing",
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
        }),
      },
    } as unknown as Parameters<typeof handleHostedOnboardingLinqWebhook>[0]["prisma"];

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: JSON.stringify({
        api_version: "v1",
        created_at: "2026-03-26T12:00:00.000Z",
        data: {
          chat_id: "chat_123",
          from: "+15551234567",
          is_from_me: false,
          message: {
            id: "msg_123",
            parts: [
              {
                type: "text",
                value: "hello",
              },
            ],
          },
          recipient_phone: "+15550000000",
          received_at: "2026-03-26T12:00:00.000Z",
          service: "sms",
        },
        event_id: "evt_123",
        event_type: "message.received",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ok: true,
      reason: "dispatched-active-member",
    });
    expect(mocks.dispatchHostedExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          kind: "linq.message.received",
          userId: "member_123",
        }),
        eventId: "evt_123",
      }),
    );
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });
});
