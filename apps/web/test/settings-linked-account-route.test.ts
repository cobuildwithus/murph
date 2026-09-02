import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueueHostedMemberChannelsUpdatedForActiveMemberTx: vi.fn(),
  getPrisma: vi.fn(),
  prismaClient: {
    $transaction: vi.fn(),
  },
  readHostedPrivyUserById: vi.fn(),
  removeHostedMemberLinkedAccountProjectionTx: vi.fn(),
  requireFreshActivePrivyMemberAuthForHostedAppSession: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireFreshActivePrivyMemberAuthForHostedAppSession:
    mocks.requireFreshActivePrivyMemberAuthForHostedAppSession,
}));

vi.mock("@/src/lib/hosted-onboarding/privy", () => ({
  readHostedPrivyUserById: mocks.readHostedPrivyUserById,
}));

vi.mock("@/src/lib/hosted-onboarding/linked-account-removal", () => ({
  removeHostedMemberLinkedAccountProjectionTx:
    mocks.removeHostedMemberLinkedAccountProjectionTx,
}));

vi.mock("@/src/lib/hosted-onboarding/member-channel-sync", () => ({
  enqueueHostedMemberChannelsUpdatedForActiveMemberTx:
    mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    publicBaseUrl: "https://join.example.test",
  }),
}));

type SettingsLinkedAccountRouteModule =
  typeof import("../app/api/settings/linked-account/route");

let route: SettingsLinkedAccountRouteModule;

describe("settings linked-account removal route", () => {
  beforeAll(async () => {
    route = await import("../app/api/settings/linked-account/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prismaClient);
    mocks.prismaClient.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(mocks.prismaClient),
    );
    mocks.requireFreshActivePrivyMemberAuthForHostedAppSession.mockResolvedValue({
      appSession: {
        member: { id: "member_123" },
        privyUserId: "did:privy:user_123",
      },
      freshPrivy: {
        member: {
          billingStatus: "active",
          id: "member_123",
          suspendedAt: null,
        },
      },
    });
    mocks.readHostedPrivyUserById.mockResolvedValue({
      id: "did:privy:user_123",
      linked_accounts: [
        {
          address: "remaining@example.com",
          latest_verified_at: 1_777_680_000,
          type: "email",
        },
      ],
    });
    mocks.removeHostedMemberLinkedAccountProjectionTx.mockResolvedValue(true);
    mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx.mockResolvedValue({
      mailboxItemId: "mailbox_item_channels_123",
    });
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_123",
    });
  });

  it("confirms live provider removal before revoking the matching Murph projection", async () => {
    const response = await route.DELETE(makeRequest({
      expectedIdentity: "456",
      method: "telegram",
    }));

    expect(response.status).toBe(200);
    expect(mocks.readHostedPrivyUserById).toHaveBeenCalledWith(
      "did:privy:user_123",
      {
        maxRetries: 0,
        signal: expect.any(AbortSignal),
        timeout: 5_000,
      },
    );
    expect(mocks.removeHostedMemberLinkedAccountProjectionTx).toHaveBeenCalledWith({
      expectedIdentity: "456",
      memberId: "member_123",
      method: "telegram",
      prisma: mocks.prismaClient,
    });
    expect(mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx).toHaveBeenCalledWith({
      linkedAccounts: [
        expect.objectContaining({
          address: "remaining@example.com",
          type: "email",
        }),
      ],
      memberId: "member_123",
      occurredAt: expect.any(String),
      prisma: mocks.prismaClient,
      sourceType: "settings.linked-account.remove",
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_item_channels_123",
    });
    await expect(response.json()).resolves.toEqual({
      changed: true,
      method: "telegram",
      ok: true,
      runTriggered: true,
    });
  });

  it("waits while Privy still reports the account being removed", async () => {
    mocks.readHostedPrivyUserById.mockResolvedValueOnce({
      id: "did:privy:user_123",
      linked_accounts: [
        {
          id: 456,
          type: "telegram",
        },
        {
          address: "remaining@example.com",
          latest_verified_at: 1_777_680_000,
          type: "email",
        },
      ],
    });

    const response = await route.DELETE(makeRequest({
      expectedIdentity: "456",
      method: "telegram",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "PRIVY_ACCOUNT_UNLINK_NOT_READY",
        retryable: true,
      },
    });
    expect(mocks.prismaClient.$transaction).not.toHaveBeenCalled();
  });

  it("refuses canonical removal when no supported sign-in remains", async () => {
    mocks.readHostedPrivyUserById.mockResolvedValueOnce({
      id: "did:privy:user_123",
      linked_accounts: [],
    });

    const response = await route.DELETE(makeRequest({
      expectedIdentity: "+14045550123",
      method: "phone",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "LINKED_ACCOUNT_LAST_SIGN_IN",
      },
    });
    expect(mocks.prismaClient.$transaction).not.toHaveBeenCalled();
  });

  it("keeps an idempotent retry successful without emitting another channel update", async () => {
    mocks.removeHostedMemberLinkedAccountProjectionTx.mockResolvedValueOnce(false);

    const response = await route.DELETE(makeRequest({
      expectedIdentity: "456",
      method: "telegram",
    }));

    expect(response.status).toBe(200);
    expect(mocks.enqueueHostedMemberChannelsUpdatedForActiveMemberTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      changed: false,
      runTriggered: false,
    });
  });

  it("rejects malformed removal requests before reading the provider", async () => {
    const response = await route.DELETE(makeRequest({
      expectedIdentity: "",
      method: "telegram",
    }));

    expect(response.status).toBe(400);
    expect(mocks.readHostedPrivyUserById).not.toHaveBeenCalled();
  });
});

function makeRequest(payload: Record<string, unknown>): Request {
  return new Request("https://join.example.test/api/settings/linked-account", {
    body: JSON.stringify(payload),
    headers: {
      "content-type": "application/json",
      origin: "https://join.example.test",
    },
    method: "DELETE",
  });
}
