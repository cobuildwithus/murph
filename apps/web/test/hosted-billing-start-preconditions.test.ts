import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  projectHostedMemberRoutingState: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", () => ({
  projectHostedMemberRoutingState: mocks.projectHostedMemberRoutingState,
}));

import {
  assertHostedMemberBillingStartMessagingReady,
} from "@/src/lib/hosted-onboarding/billing-start-preconditions";

describe("hosted billing messaging readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectHostedMemberRoutingState.mockImplementation(async (routing) =>
      routing
    );
  });

  it("accepts a verified phone channel", async () => {
    await expect(assertHostedMemberBillingStartMessagingReady({
      identity: { phoneLookupKey: "phone-key" },
      prisma: {} as never,
      routing: null,
    })).resolves.toBeUndefined();
  });

  it("requires the first Telegram inbound before starting billing", async () => {
    await expect(assertHostedMemberBillingStartMessagingReady({
      identity: null,
      prisma: {} as never,
      routing: {
        telegramThreadId: null,
        telegramUserId: "456",
      } as never,
    })).rejects.toMatchObject({
      code: "HOSTED_MESSAGING_CHANNEL_REQUIRED",
      httpStatus: 409,
      message: expect.stringContaining("message Murph on Telegram"),
    });
  });

  it("accepts the exact Telegram thread established by inbound", async () => {
    await expect(assertHostedMemberBillingStartMessagingReady({
      identity: null,
      prisma: {} as never,
      routing: {
        telegramThreadId: "456:business:connection:dm-topic:9",
        telegramUserId: "456",
      } as never,
    })).resolves.toBeUndefined();
  });
});
