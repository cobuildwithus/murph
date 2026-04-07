import { describe, expect, it, vi } from "vitest";

import {
  HOSTED_MEMBER_PRIVATE_STATE_SCHEMA,
  applyHostedMemberPrivateStatePatch,
  createHostedExecutionControlClient,
  parseHostedMemberPrivateState,
} from "@murphai/hosted-execution";

describe("hosted member private state", () => {
  it("applies patches while preserving existing values", () => {
    const next = applyHostedMemberPrivateStatePatch({
      current: {
        linqChatId: "chat_existing",
        memberId: "member_123",
        privyUserId: "privy_existing",
        schema: HOSTED_MEMBER_PRIVATE_STATE_SCHEMA,
        signupPhoneCodeSentAt: "2026-04-06T10:30:00.000Z",
        signupPhoneNumber: "+15551230000",
        stripeCustomerId: "cus_existing",
        stripeLatestBillingEventId: "evt_existing",
        stripeLatestCheckoutSessionId: "cs_existing",
        stripeSubscriptionId: "sub_existing",
        updatedAt: "2026-04-06T10:00:00.000Z",
        walletAddress: "0xabc",
      },
      memberId: "member_123",
      now: "2026-04-06T11:00:00Z",
      patch: {
        privyUserId: "  privy_next  ",
        signupPhoneCodeSentAt: null,
        signupPhoneNumber: "  +15551234567  ",
        stripeCustomerId: null,
      },
    });

    expect(next).toEqual({
      linqChatId: "chat_existing",
      memberId: "member_123",
      privyUserId: "privy_next",
      schema: HOSTED_MEMBER_PRIVATE_STATE_SCHEMA,
      signupPhoneCodeSentAt: null,
      signupPhoneNumber: "+15551234567",
      stripeCustomerId: null,
      stripeLatestBillingEventId: "evt_existing",
      stripeLatestCheckoutSessionId: "cs_existing",
      stripeSubscriptionId: "sub_existing",
      updatedAt: "2026-04-06T11:00:00.000Z",
      walletAddress: "0xabc",
    });
  });

  it("parses and normalizes stored state", () => {
    const parsed = parseHostedMemberPrivateState({
      linqChatId: " chat_123 ",
      memberId: " member_123 ",
      privyUserId: " privy_123 ",
      schema: HOSTED_MEMBER_PRIVATE_STATE_SCHEMA,
      signupPhoneCodeSentAt: "2026-04-06T11:30:00Z",
      signupPhoneNumber: " +15551234567 ",
      stripeCustomerId: " cus_123 ",
      stripeLatestBillingEventId: " evt_123 ",
      stripeLatestCheckoutSessionId: " cs_123 ",
      stripeSubscriptionId: " sub_123 ",
      updatedAt: "2026-04-06T11:00:00Z",
      walletAddress: " 0xabc ",
    });

    expect(parsed).toEqual({
      linqChatId: "chat_123",
      memberId: "member_123",
      privyUserId: "privy_123",
      schema: HOSTED_MEMBER_PRIVATE_STATE_SCHEMA,
      signupPhoneCodeSentAt: "2026-04-06T11:30:00.000Z",
      signupPhoneNumber: "+15551234567",
      stripeCustomerId: "cus_123",
      stripeLatestBillingEventId: "evt_123",
      stripeLatestCheckoutSessionId: "cs_123",
      stripeSubscriptionId: "sub_123",
      updatedAt: "2026-04-06T11:00:00.000Z",
      walletAddress: "0xabc",
    });
  });

  it("rejects mismatched schemas", () => {
    expect(() =>
      parseHostedMemberPrivateState({
        memberId: "member_123",
        schema: "murph.hosted-member-private-state.v0",
        updatedAt: "2026-04-06T11:00:00Z",
      }),
    ).toThrow(/schema must be murph\.hosted-member-private-state\.v1/i);
  });

  it("control client reads, writes, and deletes member private state through the authorized route", async () => {
    const state = {
      linqChatId: "chat_123",
      memberId: "member/123",
      privyUserId: "did:privy:123",
      schema: HOSTED_MEMBER_PRIVATE_STATE_SCHEMA,
      signupPhoneCodeSentAt: "2026-04-07T00:00:00.000Z",
      signupPhoneNumber: "+15551234567",
      stripeCustomerId: "cus_123",
      stripeLatestBillingEventId: "evt_123",
      stripeLatestCheckoutSessionId: "cs_123",
      stripeSubscriptionId: "sub_123",
      updatedAt: "2026-04-07T00:00:00.000Z",
      walletAddress: "0xabc",
    } as const;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(state), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(state), { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(new Response("Not found", { status: 404 }));
    const client = createHostedExecutionControlClient({
      baseUrl: "https://worker.example.test/",
      fetchImpl,
      getBearerToken: async () => "vercel-oidc-token",
    });

    await expect(client.putMemberPrivateState("member/123", state)).resolves.toEqual(state);
    await expect(client.getMemberPrivateState("member/123")).resolves.toEqual(state);
    await expect(client.deleteMemberPrivateState("member/123")).resolves.toBeUndefined();
    await expect(client.getMemberPrivateState("member/123")).resolves.toBeNull();

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://worker.example.test/internal/users/member%2F123/member-private-state",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body ?? ""))).toEqual(state);
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer vercel-oidc-token",
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://worker.example.test/internal/users/member%2F123/member-private-state",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "https://worker.example.test/internal/users/member%2F123/member-private-state",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("control client rejects route/user mismatches for member private state writes", async () => {
    const client = createHostedExecutionControlClient({
      baseUrl: "https://worker.example.test/",
      fetchImpl: vi.fn(),
      getBearerToken: async () => "vercel-oidc-token",
    });

    expect(() => client.putMemberPrivateState("member_a", {
      linqChatId: null,
      memberId: "member_b",
      privyUserId: null,
      schema: HOSTED_MEMBER_PRIVATE_STATE_SCHEMA,
      signupPhoneCodeSentAt: null,
      signupPhoneNumber: null,
      stripeCustomerId: null,
      stripeLatestBillingEventId: null,
      stripeLatestCheckoutSessionId: null,
      stripeSubscriptionId: null,
      updatedAt: "2026-04-07T00:00:00.000Z",
      walletAddress: null,
    })).toThrow(/memberId mismatch/u);
  });
});
