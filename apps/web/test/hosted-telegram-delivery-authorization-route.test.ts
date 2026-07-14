import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isHostedTelegramDeliveryTargetAuthorizedTx: vi.fn(),
  lockHostedMemberRow: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
  },
  requireHostedCloudflareCallbackRequest: vi.fn(),
  tx: {},
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => mocks.prisma,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/shared", () => ({
  lockHostedMemberRow: mocks.lockHostedMemberRow,
}));

vi.mock("@/src/lib/hosted-onboarding/telegram-egress-authorization", () => ({
  isHostedTelegramDeliveryTargetAuthorizedTx:
    mocks.isHostedTelegramDeliveryTargetAuthorizedTx,
}));

import { POST } from "@/app/api/internal/hosted-execution/telegram/authorize-delivery/route";

describe("hosted Telegram delivery authorization route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.tx));
    mocks.isHostedTelegramDeliveryTargetAuthorizedTx.mockImplementation(
      async ({ deliveryTarget }: { deliveryTarget: string }) =>
        deliveryTarget === "789:bot:123456" || deliveryTarget === "789:topic:9",
    );
  });

  it("authorizes only the member's current bot-bound target", async () => {
    const response = await POST(createRequest("789:bot:123456", "42"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authorized: true });
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      expect.any(Request),
      { maxBodyBytes: 2 * 1024 },
    );
    expect(mocks.lockHostedMemberRow).toHaveBeenCalledWith(mocks.tx, "member_123");
    expect(mocks.isHostedTelegramDeliveryTargetAuthorizedTx).toHaveBeenCalledWith({
      deliveryTarget: "789:bot:123456",
      memberId: "member_123",
      prisma: mocks.tx,
      replyToMessageId: "42",
    });
    expect(mocks.lockHostedMemberRow.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.isHostedTelegramDeliveryTargetAuthorizedTx.mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    ["former target", "456:bot:123456"],
    ["unbound target", "789"],
    ["malformed target", "not:a:telegram:target"],
  ])("rejects a %s", async (_scenario, deliveryTarget) => {
    const response = await POST(createRequest(deliveryTarget));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authorized: false });
  });

  it("rejects the current target when hosted access is inactive", async () => {
    mocks.isHostedTelegramDeliveryTargetAuthorizedTx.mockResolvedValueOnce(false);

    const response = await POST(createRequest("789:bot:123456"));

    await expect(response.json()).resolves.toEqual({ authorized: false });
  });

  it("authorizes an exact current inbound-observed target without bot authority", async () => {
    const response = await POST(createRequest("789:topic:9"));

    await expect(response.json()).resolves.toEqual({ authorized: true });
  });
});

function createRequest(
  deliveryTarget: string,
  replyToMessageId: string | null = null,
): Request {
  return new Request(
    "https://join.example.test/api/internal/hosted-execution/telegram/authorize-delivery",
    {
      body: JSON.stringify({ deliveryTarget, replyToMessageId }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}
