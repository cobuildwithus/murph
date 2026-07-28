import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedAssistantAskCompletionDeliveryAuthorityTx: vi.fn(),
  assertHostedThreadRouteEgressAuthority: vi.fn(),
  getPrisma: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  assertHostedThreadRouteEgressAuthority:
    mocks.assertHostedThreadRouteEgressAuthority,
}));

vi.mock("@/src/lib/hosted-groups/group-assistant-ask", () => ({
  assertHostedAssistantAskCompletionDeliveryAuthorityTx:
    mocks.assertHostedAssistantAskCompletionDeliveryAuthorityTx,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

import { POST } from "../app/api/internal/hosted-runtime/thread-route/authority/route";

describe("hosted runtime thread route authority route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.getPrisma.mockReturnValue({
      $transaction: async (run: (tx: object) => Promise<unknown>) =>
        await run({}),
    });
    mocks.assertHostedThreadRouteEgressAuthority.mockResolvedValue({});
    mocks.assertHostedAssistantAskCompletionDeliveryAuthorityTx
      .mockResolvedValue(undefined);
  });

  it("revalidates reviewed Assistant Ask authority with the exact Telegram route", async () => {
    const authority = {
      channel: "telegram",
      containerMemberId: "member_123",
      threadId: "telegram_group_123",
    };
    const assistantAskCompletion = {
      answeredMailboxItemIds: ["ask_complete_123"],
      assistantAskCompletionExpiresAt: "2026-07-27T18:00:00.000Z",
      assistantAskFallback: false,
      idempotencyKey: "assistant-ask-completion:ask_complete_123",
    };
    const response = await POST(new Request(
      "https://example.test/api/internal/hosted-runtime/thread-route/authority",
      {
        body: JSON.stringify({ assistantAskCompletion, authority }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authorized: true });
    expect(mocks.assertHostedThreadRouteEgressAuthority).toHaveBeenCalledWith({
      authority,
      prisma: {},
    });
    expect(
      mocks.assertHostedAssistantAskCompletionDeliveryAuthorityTx,
    ).toHaveBeenCalledWith({
      ...assistantAskCompletion,
      boundRuntimeMemberId: "member_123",
      tx: {},
    });
  });

  it("requires the safe fallback when Assistant Ask authority expires", async () => {
    mocks.assertHostedAssistantAskCompletionDeliveryAuthorityTx
      .mockResolvedValueOnce({ assistantAskFallbackRequired: true });
    const response = await POST(new Request(
      "https://example.test/api/internal/hosted-runtime/thread-route/authority",
      {
        body: JSON.stringify({
          assistantAskCompletion: {
            answeredMailboxItemIds: ["ask_complete_123"],
            assistantAskCompletionExpiresAt: "2026-07-27T18:00:00.000Z",
            assistantAskFallback: false,
            idempotencyKey: "assistant-ask-completion:ask_complete_123",
          },
          authority: {
            channel: "telegram",
            containerMemberId: "member_123",
            threadId: "telegram_group_123",
          },
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      assistantAskFallbackRequired: true,
      authorized: true,
    });
  });

  it("delegates exact Telegram route authority to the Web-owned route store", async () => {
    const authority = {
      channel: "telegram",
      containerMemberId: "member_123",
      threadId: "telegram_group_123",
    };
    const response = await POST(new Request(
      "https://example.test/api/internal/hosted-runtime/thread-route/authority",
      {
        body: JSON.stringify(authority),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authorized: true });
    expect(mocks.assertHostedThreadRouteEgressAuthority).toHaveBeenCalledWith({
      authority,
      prisma: {},
    });
  });

  it("rejects authority for a different runtime container before reading routes", async () => {
    const response = await POST(new Request(
      "https://example.test/api/internal/hosted-runtime/thread-route/authority",
      {
        body: JSON.stringify({
          channel: "telegram",
          containerMemberId: "member_other",
          threadId: "telegram_group_123",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(403);
    expect(mocks.assertHostedThreadRouteEgressAuthority).not.toHaveBeenCalled();
  });
});
