import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureHostedPrivyWalletReady: vi.fn(),
  requestHostedBillingCheckout: vi.fn(),
  requestHostedPrivyCompletionWithRetry: vi.fn(),
  ensureHostedPrivyPhoneReady: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/client-api", () => ({
  requestHostedBillingCheckout: mocks.requestHostedBillingCheckout,
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
    ensureHostedPrivyWalletReady: mocks.ensureHostedPrivyWalletReady,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensureHostedPrivyPhoneReady.mockResolvedValue(undefined);
  mocks.ensureHostedPrivyWalletReady.mockResolvedValue(undefined);
  mocks.requestHostedPrivyCompletionWithRetry.mockResolvedValue({
    activationPending: false,
    inviteCode: "invite-code",
    joinUrl: "https://join.example.test/join/invite-code",
    stage: "active",
  });
  mocks.requestHostedBillingCheckout.mockResolvedValue({
    alreadyActive: true,
    url: null,
  });
});

test("completeHostedPrivyAuth sends active members to settings", async () => {
  const { completeHostedPrivyAuth } = await import(
    "@/src/components/hosted-onboarding/hosted-auth-completion"
  );

  await expect(
    completeHostedPrivyAuth({
      createWallet: vi.fn(),
      intent: "signup",
      refreshUser: vi.fn().mockResolvedValue({
        linkedAccounts: [],
      }),
      user: null,
    }),
  ).resolves.toMatchObject({
    redirectUrl: "/settings",
  });

  expect(mocks.ensureHostedPrivyWalletReady).toHaveBeenCalledWith({
    createWallet: expect.any(Function),
    user: {
      linkedAccounts: [],
    },
  });
});

test("completeHostedPrivyAuth sends checkout users into billing", async () => {
  mocks.requestHostedPrivyCompletionWithRetry.mockResolvedValue({
    activationPending: false,
    inviteCode: "invite-code",
    joinUrl: "https://join.example.test/join/invite-code",
    stage: "checkout",
  });
  mocks.requestHostedBillingCheckout.mockResolvedValue({
    alreadyActive: false,
    url: "https://checkout.example.test/session_123",
  });

  const { completeHostedPrivyAuth } = await import(
    "@/src/components/hosted-onboarding/hosted-auth-completion"
  );

  await expect(
    completeHostedPrivyAuth({
      createWallet: vi.fn(),
      intent: "signup",
      refreshUser: vi.fn().mockResolvedValue(null),
      user: {
        linkedAccounts: [{ type: "email" }],
      },
    }),
  ).resolves.toMatchObject({
    redirectUrl: "https://checkout.example.test/session_123",
  });
});

test("completeHostedPrivyAuth falls back to the current user when refreshUser fails", async () => {
  const { completeHostedPrivyAuth } = await import(
    "@/src/components/hosted-onboarding/hosted-auth-completion"
  );

  await completeHostedPrivyAuth({
    createWallet: vi.fn(),
    intent: "signup",
    refreshUser: vi.fn().mockRejectedValue(new Error("stale user")),
    user: {
      linkedAccounts: [{ type: "telegram" }],
    },
  });

  expect(mocks.ensureHostedPrivyWalletReady).toHaveBeenCalledWith({
    createWallet: expect.any(Function),
    user: {
      linkedAccounts: [{ type: "telegram" }],
    },
  });
});

test("completeHostedPrivyAuth surfaces missing checkout URLs", async () => {
  mocks.requestHostedPrivyCompletionWithRetry.mockResolvedValue({
    activationPending: false,
    inviteCode: "invite-code",
    joinUrl: "https://join.example.test/join/invite-code",
    stage: "checkout",
  });
  mocks.requestHostedBillingCheckout.mockResolvedValue({
    alreadyActive: false,
    url: null,
  });

  const { completeHostedPrivyAuth } = await import(
    "@/src/components/hosted-onboarding/hosted-auth-completion"
  );

  await expect(
    completeHostedPrivyAuth({
      createWallet: vi.fn(),
      intent: "signup",
      refreshUser: vi.fn().mockResolvedValue(null),
      user: null,
    }),
  ).rejects.toThrow("Checkout did not return a redirect URL.");
});

test("completeHostedPrivyAuth uses the phone readiness path when requested", async () => {
  const { completeHostedPrivyAuth } = await import(
    "@/src/components/hosted-onboarding/hosted-auth-completion"
  );

  await expect(
    completeHostedPrivyAuth({
      createWallet: vi.fn(),
      intent: "signin",
      requirePhone: true,
      user: {
        linkedAccounts: [{ type: "phone" }],
      },
    }),
  ).resolves.toMatchObject({
    redirectUrl: "/settings",
  });

  expect(mocks.ensureHostedPrivyPhoneReady).toHaveBeenCalledWith({
    createWallet: expect.any(Function),
    user: {
      linkedAccounts: [{ type: "phone" }],
    },
  });
  expect(mocks.ensureHostedPrivyWalletReady).not.toHaveBeenCalled();
});
