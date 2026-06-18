import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestHostedPrivyCompletionWithRetry: vi.fn(),
}));

vi.mock("@/src/components/hosted-onboarding/hosted-privy-auth-support", () => ({
  requestHostedPrivyCompletionWithRetry: mocks.requestHostedPrivyCompletionWithRetry,
}));

beforeEach(() => {
  vi.clearAllMocks();
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

  await expect(
    completeHostedPrivyAuth({
      authMethod: "email",
    }),
  ).resolves.toMatchObject({
    redirectUrl: "/home",
  });

  expect(mocks.requestHostedPrivyCompletionWithRetry).toHaveBeenCalledWith({
    authMethod: "email",
    inviteCode: undefined,
  });
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
    }),
  ).resolves.toMatchObject({
    redirectUrl: "https://join.example.test/join/invite-code",
  });
});

test("completeHostedPrivyAuth passes phone completion to the server", async () => {
  const { completeHostedPrivyAuth } = await import(
    "@/src/components/hosted-onboarding/hosted-auth-completion"
  );

  await expect(
    completeHostedPrivyAuth({
      authMethod: "phone",
    }),
  ).resolves.toMatchObject({
    redirectUrl: "/home",
  });

  expect(mocks.requestHostedPrivyCompletionWithRetry).toHaveBeenCalledWith({
    authMethod: "phone",
    inviteCode: undefined,
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
    }),
  ).resolves.toMatchObject({
    redirectUrl: "https://join.example.test/join/invite-code",
  });
});
