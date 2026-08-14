import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedAssistantAskCompletionDeliveryAuthorityTx: vi.fn(),
  assertHostedGroupCurrentSenderPrivateCompletionDeliveryAuthorityTx: vi.fn(),
  assertHostedAssistantNotificationRouteAuthority: vi.fn(),
  getPrisma: vi.fn(),
  handoffHostedMailboxWake: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", () => ({
  assertHostedAssistantNotificationRouteAuthority:
    mocks.assertHostedAssistantNotificationRouteAuthority,
}));

vi.mock("@/src/lib/hosted-groups/group-assistant-ask", () => ({
  assertHostedAssistantAskCompletionDeliveryAuthorityTx:
    mocks.assertHostedAssistantAskCompletionDeliveryAuthorityTx,
}));

vi.mock("@/src/lib/hosted-groups/group-current-sender-assistant-ask", () => ({
  assertHostedGroupCurrentSenderPrivateCompletionDeliveryAuthorityTx:
    mocks.assertHostedGroupCurrentSenderPrivateCompletionDeliveryAuthorityTx,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-orchestration/mailbox-wake", () => ({
  handoffHostedMailboxWake: mocks.handoffHostedMailboxWake,
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
    mocks.assertHostedAssistantNotificationRouteAuthority.mockResolvedValue(
      undefined,
    );
    mocks.assertHostedAssistantAskCompletionDeliveryAuthorityTx
      .mockResolvedValue(undefined);
    mocks.assertHostedGroupCurrentSenderPrivateCompletionDeliveryAuthorityTx
      .mockResolvedValue(undefined);
    mocks.handoffHostedMailboxWake.mockResolvedValue(undefined);
  });

  it("hands off the persisted group fallback when private authority is lost", async () => {
    const mailboxWake = {
      expectedUserId: "member_group_runtime",
      mailboxItemId: `aask_done_${"d".repeat(64)}`,
    };
    mocks.assertHostedGroupCurrentSenderPrivateCompletionDeliveryAuthorityTx
      .mockResolvedValueOnce({
        assistantAskFallbackRequired: true,
        mailboxWake,
      });
    const request = new Request(
      "https://example.test/api/internal/hosted-runtime/thread-route/authority",
      {
        body: JSON.stringify({
          authority: {
            actorId: null,
            channel: "telegram",
            delivery: { kind: "thread", target: "private-thread" },
            identityId: null,
            threadId: "private-thread",
            threadIsDirect: true,
          },
          privateAssistantAskCompletion: {
            answeredMailboxItemIds: [`aask_private_${"b".repeat(64)}`],
            expiresAt: "2026-08-09T05:10:00.000Z",
            idempotencyKey:
              `assistant-ask-private:aask_private_${"b".repeat(64)}`,
            responseTextDigest: "c".repeat(64),
          },
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      assistantAskFallbackRequired: true,
      authorized: false,
    });
    expect(mocks.handoffHostedMailboxWake).toHaveBeenCalledWith({
      ...mailboxWake,
      directWakeSource: "assistant-ask-completion",
      signal: request.signal,
    });
  });

  it("binds a private Assistant Ask completion to its exact direct route", async () => {
    const authority = {
      actorId: null,
      channel: "linq",
      delivery: {
        kind: "thread",
        target: "linq-private-thread",
      },
      identityId: `hid_${"1".repeat(32)}`,
      threadId: `hid_${"2".repeat(32)}`,
      threadIsDirect: true,
    };
    const privateAssistantAskCompletion = {
      answeredMailboxItemIds: [`aask_done_${"b".repeat(64)}`],
      expiresAt: "2026-08-09T05:10:00.000Z",
      idempotencyKey: `assistant-ask-private:aask_done_${"b".repeat(64)}`,
      responseTextDigest: "c".repeat(64),
    };
    const response = await POST(new Request(
      "https://example.test/api/internal/hosted-runtime/thread-route/authority",
      {
        body: JSON.stringify({ authority, privateAssistantAskCompletion }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authorized: true });
    expect(
      mocks.assertHostedGroupCurrentSenderPrivateCompletionDeliveryAuthorityTx,
    ).toHaveBeenCalledWith({
      answeredMailboxItemIds:
        privateAssistantAskCompletion.answeredMailboxItemIds,
      assistantAskCompletionExpiresAt:
        privateAssistantAskCompletion.expiresAt,
      boundRuntimeMemberId: "member_123",
      idempotencyKey: privateAssistantAskCompletion.idempotencyKey,
      responseTextDigest: privateAssistantAskCompletion.responseTextDigest,
      route: authority,
      tx: {},
    });
    expect(
      mocks.assertHostedAssistantNotificationRouteAuthority,
    ).not.toHaveBeenCalled();
    expect(
      mocks.assertHostedAssistantAskCompletionDeliveryAuthorityTx,
    ).not.toHaveBeenCalled();
  });

  it("rejects mutually exclusive Assistant Ask authority branches", async () => {
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
            actorId: null,
            channel: "telegram",
            delivery: { kind: "thread", target: "private-thread" },
            identityId: null,
            threadId: "private-thread",
            threadIsDirect: true,
          },
          privateAssistantAskCompletion: {
            answeredMailboxItemIds: [`aask_done_${"b".repeat(64)}`],
            expiresAt: "2026-08-09T05:10:00.000Z",
            idempotencyKey:
              `assistant-ask-private:aask_done_${"b".repeat(64)}`,
            responseTextDigest: "c".repeat(64),
          },
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(400);
    expect(
      mocks.assertHostedGroupCurrentSenderPrivateCompletionDeliveryAuthorityTx,
    ).not.toHaveBeenCalled();
  });

  it("rejects extra top-level fields on private completion authority", async () => {
    const response = await POST(new Request(
      "https://example.test/api/internal/hosted-runtime/thread-route/authority",
      {
        body: JSON.stringify({
          authority: {
            actorId: null,
            channel: "telegram",
            delivery: { kind: "thread", target: "private-thread" },
            identityId: null,
            threadId: "private-thread",
            threadIsDirect: true,
          },
          privateAssistantAskCompletion: {
            answeredMailboxItemIds: [`aask_done_${"b".repeat(64)}`],
            expiresAt: "2026-08-09T05:10:00.000Z",
            idempotencyKey:
              `assistant-ask-private:aask_done_${"b".repeat(64)}`,
            responseTextDigest: "c".repeat(64),
          },
          threadId: "private-thread",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    ));

    expect(response.status).toBe(400);
    expect(
      mocks.assertHostedGroupCurrentSenderPrivateCompletionDeliveryAuthorityTx,
    ).not.toHaveBeenCalled();
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
    expect(
      mocks.assertHostedAssistantNotificationRouteAuthority,
    ).toHaveBeenCalledWith({ authority, prisma: {} });
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

  it("delegates exact Telegram route authority to the Web-owned notification route validator", async () => {
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
    expect(
      mocks.assertHostedAssistantNotificationRouteAuthority,
    ).toHaveBeenCalledWith({
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
    expect(
      mocks.assertHostedAssistantNotificationRouteAuthority,
    ).not.toHaveBeenCalled();
  });
});
