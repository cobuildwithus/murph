import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureHostedPrivyWalletReady: vi.fn(),
  requestHostedBillingCheckout: vi.fn(),
  requestHostedPrivyCompletionWithRetry: vi.fn(),
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
    ensureHostedPrivyWalletReady: mocks.ensureHostedPrivyWalletReady,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
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

test("completeHomepagePrivyAuth sends active members to settings", async () => {
  const { completeHomepagePrivyAuth } = await import(
    "@/src/components/homepage/homepage-privy-auth"
  );

  await expect(
    completeHomepagePrivyAuth({
      createWallet: vi.fn(),
      refreshUser: vi.fn().mockResolvedValue({
        linkedAccounts: [],
      }),
      user: null,
    }),
  ).resolves.toBe("/settings");

  expect(mocks.ensureHostedPrivyWalletReady).toHaveBeenCalledWith({
    createWallet: expect.any(Function),
    user: {
      linkedAccounts: [],
    },
  });
});

test("completeHomepagePrivyAuth sends checkout users into billing", async () => {
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

  const { completeHomepagePrivyAuth } = await import(
    "@/src/components/homepage/homepage-privy-auth"
  );

  await expect(
    completeHomepagePrivyAuth({
      createWallet: vi.fn(),
      refreshUser: vi.fn().mockResolvedValue(null),
      user: {
        linkedAccounts: [{ type: "email" }],
      },
    }),
  ).resolves.toBe("https://checkout.example.test/session_123");
});

test("completeHomepagePrivyAuth falls back to the current user when refreshUser fails", async () => {
  const { completeHomepagePrivyAuth } = await import(
    "@/src/components/homepage/homepage-privy-auth"
  );

  await completeHomepagePrivyAuth({
    createWallet: vi.fn(),
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

test("completeHomepagePrivyAuth surfaces missing checkout URLs", async () => {
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

  const { completeHomepagePrivyAuth } = await import(
    "@/src/components/homepage/homepage-privy-auth"
  );

  await expect(
    completeHomepagePrivyAuth({
      createWallet: vi.fn(),
      refreshUser: vi.fn().mockResolvedValue(null),
      user: null,
    }),
  ).rejects.toThrow("Checkout did not return a redirect URL.");
});
