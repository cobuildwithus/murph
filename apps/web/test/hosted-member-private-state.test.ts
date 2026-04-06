import { beforeEach, describe, expect, it, vi } from "vitest";

const controlMocks = vi.hoisted(() => ({
  deleteHostedMemberPrivateStateFromHostedExecution: vi.fn(),
  provisionManagedUserCryptoInHostedExecution: vi.fn(),
  readHostedExecutionControlClientIfConfigured: vi.fn(),
  readHostedMemberPrivateStateFromHostedExecution: vi.fn(),
  writeHostedMemberPrivateStateToHostedExecution: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/control", () => ({
  deleteHostedMemberPrivateStateFromHostedExecution:
    controlMocks.deleteHostedMemberPrivateStateFromHostedExecution,
  provisionManagedUserCryptoInHostedExecution:
    controlMocks.provisionManagedUserCryptoInHostedExecution,
  readHostedExecutionControlClientIfConfigured:
    controlMocks.readHostedExecutionControlClientIfConfigured,
  readHostedMemberPrivateStateFromHostedExecution:
    controlMocks.readHostedMemberPrivateStateFromHostedExecution,
  writeHostedMemberPrivateStateToHostedExecution:
    controlMocks.writeHostedMemberPrivateStateToHostedExecution,
}));

describe("hosted member private state helper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    controlMocks.readHostedExecutionControlClientIfConfigured.mockReturnValue(null);
    controlMocks.readHostedMemberPrivateStateFromHostedExecution.mockResolvedValue(null);
    controlMocks.writeHostedMemberPrivateStateToHostedExecution.mockImplementation(async (state) => state);
    controlMocks.provisionManagedUserCryptoInHostedExecution.mockResolvedValue({
      recipientKinds: ["automation", "recovery"],
      rootKeyId: "urk:test",
      userId: "member_123",
    });
    controlMocks.deleteHostedMemberPrivateStateFromHostedExecution.mockResolvedValue(undefined);
  });

  it("allows null-only patches without hosted execution control", async () => {
    const { writeHostedMemberPrivateStatePatch } = await import(
      "@/src/lib/hosted-onboarding/member-private-state"
    );

    await expect(
      writeHostedMemberPrivateStatePatch({
        memberId: "member_123",
        now: "2026-04-07T00:00:00.000Z",
        patch: {
          linqChatId: null,
        },
      }),
    ).resolves.toEqual({
      linqChatId: null,
      memberId: "member_123",
      privyUserId: null,
      schema: "murph.hosted-member-private-state.v1",
      stripeCustomerId: null,
      stripeLatestBillingEventId: null,
      stripeLatestCheckoutSessionId: null,
      stripeSubscriptionId: null,
      updatedAt: "2026-04-07T00:00:00.000Z",
      walletAddress: null,
    });
  });

  it("fails closed when persistent private state is required but control is unavailable", async () => {
    const { writeHostedMemberPrivateStatePatch } = await import(
      "@/src/lib/hosted-onboarding/member-private-state"
    );

    await expect(
      writeHostedMemberPrivateStatePatch({
        memberId: "member_123",
        patch: {
          privyUserId: "did:privy:123",
        },
      }),
    ).rejects.toMatchObject({
      code: "HOSTED_MEMBER_PRIVATE_STATE_NOT_CONFIGURED",
      httpStatus: 500,
    });
  });

  it("merges private state through hosted execution when control is configured", async () => {
    const current = {
      linqChatId: "chat_existing",
      memberId: "member_123",
      privyUserId: "privy_existing",
      schema: "murph.hosted-member-private-state.v1",
      stripeCustomerId: "cus_existing",
      stripeLatestBillingEventId: null,
      stripeLatestCheckoutSessionId: null,
      stripeSubscriptionId: null,
      updatedAt: "2026-04-07T00:00:00.000Z",
      walletAddress: "0xabc",
    };
    controlMocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      getMemberPrivateState: vi.fn().mockResolvedValue(current),
    });

    const { writeHostedMemberPrivateStatePatch } = await import(
      "@/src/lib/hosted-onboarding/member-private-state"
    );

    await expect(
      writeHostedMemberPrivateStatePatch({
        memberId: "member_123",
        now: "2026-04-07T01:00:00.000Z",
        patch: {
          privyUserId: "privy_next",
          stripeCustomerId: null,
        },
      }),
    ).resolves.toEqual({
      linqChatId: "chat_existing",
      memberId: "member_123",
      privyUserId: "privy_next",
      schema: "murph.hosted-member-private-state.v1",
      stripeCustomerId: null,
      stripeLatestBillingEventId: null,
      stripeLatestCheckoutSessionId: null,
      stripeSubscriptionId: null,
      updatedAt: "2026-04-07T01:00:00.000Z",
      walletAddress: "0xabc",
    });

    expect(controlMocks.provisionManagedUserCryptoInHostedExecution).toHaveBeenCalledWith(
      "member_123",
    );
    expect(controlMocks.writeHostedMemberPrivateStateToHostedExecution).toHaveBeenCalledWith({
      linqChatId: "chat_existing",
      memberId: "member_123",
      privyUserId: "privy_next",
      schema: "murph.hosted-member-private-state.v1",
      stripeCustomerId: null,
      stripeLatestBillingEventId: null,
      stripeLatestCheckoutSessionId: null,
      stripeSubscriptionId: null,
      updatedAt: "2026-04-07T01:00:00.000Z",
      walletAddress: "0xabc",
    });
  });

  it("deletes hosted private state when a configured patch clears every stored value", async () => {
    controlMocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      getMemberPrivateState: vi.fn().mockResolvedValue({
        linqChatId: "chat_existing",
        memberId: "member_123",
        privyUserId: null,
        schema: "murph.hosted-member-private-state.v1",
        stripeCustomerId: null,
        stripeLatestBillingEventId: null,
        stripeLatestCheckoutSessionId: null,
        stripeSubscriptionId: null,
        updatedAt: "2026-04-07T00:00:00.000Z",
        walletAddress: null,
      }),
    });

    const { writeHostedMemberPrivateStatePatch } = await import(
      "@/src/lib/hosted-onboarding/member-private-state"
    );

    await expect(
      writeHostedMemberPrivateStatePatch({
        memberId: "member_123",
        now: "2026-04-07T01:00:00.000Z",
        patch: {
          linqChatId: null,
        },
      }),
    ).resolves.toEqual({
      linqChatId: null,
      memberId: "member_123",
      privyUserId: null,
      schema: "murph.hosted-member-private-state.v1",
      stripeCustomerId: null,
      stripeLatestBillingEventId: null,
      stripeLatestCheckoutSessionId: null,
      stripeSubscriptionId: null,
      updatedAt: "2026-04-07T01:00:00.000Z",
      walletAddress: null,
    });

    expect(controlMocks.deleteHostedMemberPrivateStateFromHostedExecution).toHaveBeenCalledWith(
      "member_123",
    );
    expect(controlMocks.writeHostedMemberPrivateStateToHostedExecution).not.toHaveBeenCalled();
  });
});
