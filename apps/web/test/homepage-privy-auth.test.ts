import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestHostedPrivyCompletionWithRetry: vi.fn(),
  ensureHostedPrivyPhoneReady: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/hosted-privy-auth-support", () => ({
  requestHostedPrivyCompletionWithRetry: mocks.requestHostedPrivyCompletionWithRetry,
}));

vi.mock("@/src/lib/hosted-onboarding/privy-client", async () => {
  const actual =
    await vi.importActual<typeof import("@/src/lib/hosted-onboarding/privy-client")>(
      "@/src/lib/hosted-onboarding/privy-client",
    );

  return {
    ...actual,
    ensureHostedPrivyPhoneReady: mocks.ensureHostedPrivyPhoneReady,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensureHostedPrivyPhoneReady.mockResolvedValue(undefined);
  mocks.requestHostedPrivyCompletionWithRetry.mockResolvedValue({
    activationPending: false,
    inviteCode: "invite-code",
    joinUrl: "https://join.example.test/join/invite-code",
    stage: "active",
  });
});

test("completeHostedPrivyAuth sends active members to home", async () => {
  const { completeHostedPrivyAuth } = await import(
    "@/src/components/hosted-onboarding/hosted-auth-completion"
  );
  const refreshUser = vi.fn().mockResolvedValue({
    linkedAccounts: [],
  });

  await expect(
    completeHostedPrivyAuth({
      authMethod: "email",
      refreshUser,
      user: null,
    }),
  ).resolves.toMatchObject({
    redirectUrl: "/home",
  });

  expect(mocks.ensureHostedPrivyPhoneReady).not.toHaveBeenCalled();
  expect(refreshUser).toHaveBeenCalledTimes(1);
});

test("completeHostedPrivyAuth sends initial-visit eligible active members through the welcome handoff", async () => {
  mocks.requestHostedPrivyCompletionWithRetry.mockResolvedValueOnce({
    initialVisitEligible: true,
    inviteCode: "invite-code",
    joinUrl: "https://join.example.test/join/invite-code",
    stage: "active",
  });
  const { completeHostedPrivyAuth } = await import(
    "@/src/components/hosted-onboarding/hosted-auth-completion"
  );

  await expect(
    completeHostedPrivyAuth({
      authMethod: "email",
      refreshUser: vi.fn().mockResolvedValue({
        linkedAccounts: [{ type: "email" }],
      }),
      user: null,
    }),
  ).resolves.toMatchObject({
    redirectUrl: "/home?initialVisit=true",
  });
});

test("completeHostedPrivyAuth sends invite-bound active members through the initial visit handoff", async () => {
  const { completeHostedPrivyAuth } = await import(
    "@/src/components/hosted-onboarding/hosted-auth-completion"
  );

  await expect(
    completeHostedPrivyAuth({
      authMethod: "telegram",
      inviteCode: "invite-code",
      refreshUser: vi.fn().mockResolvedValue({
        linkedAccounts: [{ type: "telegram" }],
      }),
      user: null,
    }),
  ).resolves.toMatchObject({
    redirectUrl: "/home?initialVisit=true",
  });
});

test("completeHostedPrivyAuth sends checkout users back to the invite join flow", async () => {
  mocks.requestHostedPrivyCompletionWithRetry.mockResolvedValue({
    activationPending: false,
    inviteCode: "invite-code",
    joinUrl: "https://join.example.test/join/invite-code",
    stage: "checkout",
  });

  const { completeHostedPrivyAuth } = await import(
    "@/src/components/hosted-onboarding/hosted-auth-completion"
  );

  await expect(
    completeHostedPrivyAuth({
      authMethod: "email",
      refreshUser: vi.fn().mockResolvedValue(null),
      user: {
        linkedAccounts: [{ type: "email" }],
      },
    }),
  ).resolves.toMatchObject({
    redirectUrl: "https://join.example.test/join/invite-code",
  });
});

test("completeHostedPrivyAuth sends activating members to home", async () => {
  mocks.requestHostedPrivyCompletionWithRetry.mockResolvedValue({
    activationPending: true,
    inviteCode: "invite-code",
    joinUrl: "https://join.example.test/join/invite-code",
    stage: "activating",
  });

  const { completeHostedPrivyAuth } = await import(
    "@/src/components/hosted-onboarding/hosted-auth-completion"
  );

  await expect(
    completeHostedPrivyAuth({
      authMethod: "email",
      refreshUser: vi.fn().mockResolvedValue(null),
      user: null,
    }),
  ).resolves.toMatchObject({
    redirectUrl: "/home",
  });
});

test("completeHostedPrivyAuth falls back to the invite join flow for blocked users", async () => {
  mocks.requestHostedPrivyCompletionWithRetry.mockResolvedValue({
    activationPending: false,
    inviteCode: "invite-code",
    joinUrl: "https://join.example.test/join/invite-code",
    stage: "blocked",
  });

  const { completeHostedPrivyAuth } = await import(
    "@/src/components/hosted-onboarding/hosted-auth-completion"
  );

  await expect(
    completeHostedPrivyAuth({
      authMethod: "email",
      refreshUser: vi.fn().mockResolvedValue(null),
      user: null,
    }),
  ).resolves.toMatchObject({
    redirectUrl: "https://join.example.test/join/invite-code",
  });
});

test("completeHostedPrivyAuth falls back to the current user when refreshUser fails", async () => {
  const { completeHostedPrivyAuth } = await import(
    "@/src/components/hosted-onboarding/hosted-auth-completion"
  );

  await completeHostedPrivyAuth({
    authMethod: "telegram",
    refreshUser: vi.fn().mockRejectedValue(new Error("stale user")),
    user: {
      linkedAccounts: [{ type: "telegram" }],
    },
  });

  expect(mocks.ensureHostedPrivyPhoneReady).not.toHaveBeenCalled();
});

test("completeHostedPrivyAuth prefers the completed user when refresh is stale for phone readiness", async () => {
  const { completeHostedPrivyAuth } = await import(
    "@/src/components/hosted-onboarding/hosted-auth-completion"
  );
  const completedUser = {
    linkedAccounts: [
      {
        latest_verified_at: 1771977600,
        number: "+15555551212",
        type: "phone",
      },
    ],
  };

  await completeHostedPrivyAuth({
    authMethod: "phone",
    completedUser,
    refreshUser: vi.fn().mockResolvedValue({
      linkedAccounts: [],
    }),
    user: null,
  });

  expect(mocks.ensureHostedPrivyPhoneReady).toHaveBeenCalledWith({
    user: completedUser,
  });
});

test("completeHostedPrivyAuth prefers the completed user when non-phone refresh is stale", async () => {
  const { completeHostedPrivyAuth } = await import(
    "@/src/components/hosted-onboarding/hosted-auth-completion"
  );
  const completedUser = {
    linkedAccounts: [
      {
        address: "fresh@example.com",
        latest_verified_at: 1771977600,
        type: "email",
      },
    ],
  };

  await completeHostedPrivyAuth({
    authMethod: "email",
    completedUser,
    refreshUser: vi.fn().mockResolvedValue({
      linkedAccounts: [
        {
          id: 12345,
          type: "telegram",
          username: "old_user",
        },
      ],
    }),
    user: null,
  });

  expect(mocks.ensureHostedPrivyPhoneReady).not.toHaveBeenCalled();
});

test("completeHostedPrivyAuth falls back to the current user when completed user is sparse", async () => {
  const { completeHostedPrivyAuth } = await import(
    "@/src/components/hosted-onboarding/hosted-auth-completion"
  );
  const currentUser = {
    linkedAccounts: [
      {
        latest_verified_at: 1771977600,
        number: "+15555551212",
        type: "phone",
      },
    ],
  };

  await completeHostedPrivyAuth({
    authMethod: "phone",
    completedUser: {
      linkedAccounts: [],
    },
    refreshUser: vi.fn().mockResolvedValue(null),
    user: currentUser,
  });

  expect(mocks.ensureHostedPrivyPhoneReady).toHaveBeenCalledWith({
    user: currentUser,
  });
});

test("completeHostedPrivyAuth does not prefetch checkout sessions for checkout-stage users", async () => {
  mocks.requestHostedPrivyCompletionWithRetry.mockResolvedValue({
    activationPending: false,
    inviteCode: "invite-code",
    joinUrl: "https://join.example.test/join/invite-code",
    stage: "checkout",
  });

  const { completeHostedPrivyAuth } = await import(
    "@/src/components/hosted-onboarding/hosted-auth-completion"
  );

  await expect(
    completeHostedPrivyAuth({
      authMethod: "email",
      refreshUser: vi.fn().mockResolvedValue(null),
      user: null,
    }),
  ).resolves.toMatchObject({
    redirectUrl: "https://join.example.test/join/invite-code",
  });
});

test("completeHostedPrivyAuth uses the phone readiness path when requested", async () => {
  const { completeHostedPrivyAuth } = await import(
    "@/src/components/hosted-onboarding/hosted-auth-completion"
  );

  await expect(
    completeHostedPrivyAuth({
      authMethod: "phone",
      user: {
        linkedAccounts: [{ type: "phone" }],
      },
    }),
  ).resolves.toMatchObject({
    redirectUrl: "/home",
  });

  expect(mocks.ensureHostedPrivyPhoneReady).toHaveBeenCalledWith({
    user: {
      linkedAccounts: [{ type: "phone" }],
    },
  });
});
