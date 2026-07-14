import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {},
  readActiveHostedMemberAccess: vi.fn(),
  readHostedMemberRoutingState: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => mocks.prisma,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", async () => {
  const actual = await vi.importActual<typeof import(
    "@/src/lib/hosted-onboarding/hosted-member-routing-store"
  )>("@/src/lib/hosted-onboarding/hosted-member-routing-store");
  return {
    ...actual,
    readHostedMemberRoutingState: mocks.readHostedMemberRoutingState,
  };
});

vi.mock("@/src/lib/hosted-onboarding/member-access", async () => {
  const actual = await vi.importActual<typeof import(
    "@/src/lib/hosted-onboarding/member-access"
  )>("@/src/lib/hosted-onboarding/member-access");
  return {
    ...actual,
    readActiveHostedMemberAccess: mocks.readActiveHostedMemberAccess,
  };
});

import { POST } from "@/app/api/internal/hosted-execution/telegram/authorize-delivery/route";

describe("hosted Telegram delivery authorization route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.readActiveHostedMemberAccess.mockResolvedValue({ kind: "personal" });
    mocks.readHostedMemberRoutingState.mockResolvedValue({
      telegramThreadId: "789:bot:123456",
    });
  });

  it("authorizes only the member's current bot-bound target", async () => {
    const response = await POST(createRequest("789:bot:123456"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authorized: true });
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
      expect.any(Request),
      { maxBodyBytes: 2 * 1024 },
    );
    expect(mocks.readHostedMemberRoutingState).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: mocks.prisma,
    });
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
    mocks.readActiveHostedMemberAccess.mockResolvedValueOnce(null);

    const response = await POST(createRequest("789:bot:123456"));

    await expect(response.json()).resolves.toEqual({ authorized: false });
  });

  it("authorizes an exact current inbound-observed target without bot authority", async () => {
    mocks.readHostedMemberRoutingState.mockResolvedValueOnce({
      telegramThreadId: "789:topic:9",
    });

    const response = await POST(createRequest("789:topic:9"));

    await expect(response.json()).resolves.toEqual({ authorized: true });
  });
});

function createRequest(deliveryTarget: string): Request {
  return new Request(
    "https://join.example.test/api/internal/hosted-execution/telegram/authorize-delivery",
    {
      body: JSON.stringify({ deliveryTarget }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}
