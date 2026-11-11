import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedMemberNotSuspended: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  completeHostedInitialOnboardingTx: vi.fn(),
  getPrisma: vi.fn(),
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
// The completion writer is already stubbed below. Keep its unused mailbox
// dependency out of this route/parser proof; no persistence helper may run here.
vi.mock("@/src/lib/hosted-onboarding/member-preferences", () => ({
  projectHostedMemberAssistantPreferences: () => { throw new Error("Unexpected preference projection."); },
  upsertHostedMemberAssistantPreferencesTx: () => { throw new Error("Unexpected preference write."); },
}));

vi.mock("@/src/lib/hosted-onboarding/initial-onboarding", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/src/lib/hosted-onboarding/initial-onboarding")>(),
  completeHostedInitialOnboardingTx: mocks.completeHostedInitialOnboardingTx,
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
  it.each(["scientist-with-classic", "navy-seal", "longevity-scientist"])(
    "rejects stale persona %s before any completion transaction or mailbox dispatch",
    async (persona) => {
      const response = await route.POST(new Request(
        "https://app.example.test/api/settings/initial-onboarding",
        { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "save", preferences: { persona, tone: "casual", voice: "warm" } }) },
      ));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: {
        code: "INITIAL_ONBOARDING_REQUEST_INVALID",
        message: "Refresh Murph before completing setup.",
      } });
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(mocks.completeHostedInitialOnboardingTx).not.toHaveBeenCalled();
      expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
      expect(mocks.requireActiveHostedAppSessionFromRequest).toHaveBeenCalledOnce();
      expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledOnce();
    },
  );

  it("retains a valid Classic save with its explicit tone and voice", async () => {
    const preferences = { persona: "classic", tone: "casual", voice: "warm" };
    const response = await route.POST(new Request(
      "https://app.example.test/api/settings/initial-onboarding",
      { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "save", preferences }) },
    ));
    expect(response.status).toBe(200);
    expect(mocks.completeHostedInitialOnboardingTx).toHaveBeenCalledWith(
      expect.objectContaining({ request: { action: "save", preferences } }),
    );
  });

});
