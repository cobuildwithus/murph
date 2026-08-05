import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedMemberNotSuspended: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  completeHostedInitialOnboardingTx: vi.fn(),
  getPrisma: vi.fn(),
  parseHostedInitialOnboardingCompletionRequest: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));
vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));
vi.mock("@/src/lib/hosted-onboarding/entitlement", () => ({
  assertHostedMemberNotSuspended: mocks.assertHostedMemberNotSuspended,
}));
vi.mock("@/src/lib/hosted-onboarding/initial-onboarding", () => ({
  completeHostedInitialOnboardingTx: mocks.completeHostedInitialOnboardingTx,
  parseHostedInitialOnboardingCompletionRequest:
    mocks.parseHostedInitialOnboardingCompletionRequest,
}));
vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));

type RouteModule = typeof import(
  "../app/api/settings/initial-onboarding/route"
);

let route: RouteModule;

describe("website initial onboarding completion route", () => {
  beforeAll(async () => {
    route = await import("../app/api/settings/initial-onboarding/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_123" },
    });
    mocks.parseHostedInitialOnboardingCompletionRequest.mockReturnValue({
      action: "skip",
    });
    mocks.completeHostedInitialOnboardingTx.mockResolvedValue({
      completedNow: true,
      dispatch: null,
      preferences: { persona: null, tone: null, voice: null },
      status: "completed",
    });
    mocks.transaction.mockImplementation(async (
      callback: (tx: unknown) => Promise<unknown>,
    ) => callback({ tx: true }));
    mocks.getPrisma.mockReturnValue({ $transaction: mocks.transaction });
  });

  it("applies CSRF and session checks before the shared completion transaction", async () => {
    const request = new Request(
      "https://app.example.test/api/settings/initial-onboarding",
      {
        body: JSON.stringify({ action: "skip" }),
        headers: {
          "content-type": "application/json",
          origin: "https://app.example.test",
        },
        method: "POST",
      },
    );
    const response = await route.POST(request);

    await expect(response.json()).resolves.toEqual({
      completedNow: true,
      preferences: { persona: null, tone: null, voice: null },
      status: "completed",
    });
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(request);
    expect(mocks.requireActiveHostedAppSessionFromRequest).toHaveBeenCalledWith(request);
    expect(mocks.completeHostedInitialOnboardingTx).toHaveBeenCalledWith({
      memberId: "member_123",
      now: expect.any(Date),
      prisma: { tx: true },
      request: { action: "skip" },
    });
  });
});
