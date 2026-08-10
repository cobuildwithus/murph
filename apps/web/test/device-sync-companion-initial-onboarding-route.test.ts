import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeHostedInitialOnboardingTx: vi.fn(),
  getPrisma: vi.fn(),
  issueMurphContactCardHandoffClaim: vi.fn(),
  parseHostedInitialOnboardingCompletionRequest: vi.fn(),
  readHostedInitialOnboardingState: vi.fn(),
  readHostedMurphContactContextForMember: vi.fn(),
  requireHostedCompanionMemberAuthFromBearerToken: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireHostedCompanionMemberAuthFromBearerToken:
    mocks.requireHostedCompanionMemberAuthFromBearerToken,
}));

vi.mock("@/src/lib/hosted-onboarding/initial-onboarding", () => ({
  COMPANION_INITIAL_ONBOARDING_SCHEMA:
    "murph.companion.initial-onboarding.v1",
  completeHostedInitialOnboardingTx: mocks.completeHostedInitialOnboardingTx,
  parseHostedInitialOnboardingCompletionRequest:
    mocks.parseHostedInitialOnboardingCompletionRequest,
  readHostedInitialOnboardingState: mocks.readHostedInitialOnboardingState,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-contact-context", () => ({
  readHostedMurphContactContextForMember:
    mocks.readHostedMurphContactContextForMember,
}));

vi.mock("@/src/lib/hosted-onboarding/contact-card-handoff", () => ({
  MURPH_CONTACT_CARD_NATIVE_COMPANION_SESSION_ID: "native-companion",
  issueMurphContactCardHandoffClaim: mocks.issueMurphContactCardHandoffClaim,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

vi.mock("@/src/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));

type InitialOnboardingRoute = typeof import(
  "../app/api/device-sync/companion/initial-onboarding/route"
);
type ContactCardRoute = typeof import(
  "../app/api/device-sync/companion/initial-onboarding/contact-card/route"
);

let route: InitialOnboardingRoute;
let contactCardRoute: ContactCardRoute;

describe("companion initial onboarding routes", () => {
  beforeAll(async () => {
    [route, contactCardRoute] = await Promise.all([
      import("../app/api/device-sync/companion/initial-onboarding/route"),
      import(
        "../app/api/device-sync/companion/initial-onboarding/contact-card/route"
      ),
    ]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue({ $transaction: mocks.transaction });
    mocks.transaction.mockImplementation(async (
      callback: (tx: unknown) => Promise<unknown>,
    ) => callback({ tx: true }));
    mocks.requireHostedCompanionMemberAuthFromBearerToken.mockResolvedValue({
      member: { id: "member_123" },
    });
    mocks.readHostedInitialOnboardingState.mockResolvedValue({
      preferences: { persona: null, tone: null, voice: null },
      status: "pending",
    });
    mocks.readHostedMurphContactContextForMember.mockResolvedValue({
      initialContactChannels: { email: false, telegram: false, text: true },
      murphEmailAddress: null,
      murphPhoneNumber: "+15555550123",
      userEmailAddress: null,
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
    mocks.issueMurphContactCardHandoffClaim.mockReturnValue("signed-handoff");
  });

  it("projects the website catalog through bearer-only member auth", async () => {
    const request = new Request(
      "https://app.example.test/api/device-sync/companion/initial-onboarding",
      { headers: { authorization: "Bearer identity-token" } },
    );
    const response = await route.GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      schema: "murph.companion.initial-onboarding.v1",
      status: "pending",
      preferences: { persona: null, tone: null, voice: null },
      contactAction: { kind: "text" },
      contactCard: { defaultAvatarId: "classic" },
    });
    expect(payload.catalog.personas).toHaveLength(6);
    expect(payload.catalog.voices.length).toBeGreaterThan(10);
    expect(payload.catalog.voices[0].previewURL).toMatch(
      /^https:\/\/app\.example\.test\/audio\//u,
    );
    expect(mocks.requireHostedCompanionMemberAuthFromBearerToken)
      .toHaveBeenCalledWith(request, expect.anything());
  });

  it("keeps pending onboarding available when optional contact projection fails", async () => {
    mocks.readHostedMurphContactContextForMember.mockRejectedValue(
      new Error("encrypted contact unavailable"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const request = new Request(
      "https://app.example.test/api/device-sync/companion/initial-onboarding",
      { headers: { authorization: "Bearer identity-token" } },
    );

    const response = await route.GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      schema: "murph.companion.initial-onboarding.v1",
      status: "pending",
      contactAction: null,
      contactCard: null,
    });
    expect(payload.catalog.personas).toHaveLength(6);
    expect(warn).toHaveBeenCalledWith(
      "Companion initial onboarding contact projection unavailable.",
    );
  });

  it("short-circuits completed onboarding before optional contact projection", async () => {
    mocks.readHostedInitialOnboardingState.mockResolvedValue({
      completedAt: new Date("2026-08-04T12:00:00.000Z"),
      preferences: { persona: "classic", tone: "formal", voice: "murph" },
      status: "completed",
    });
    const request = new Request(
      "https://app.example.test/api/device-sync/companion/initial-onboarding",
      { headers: { authorization: "Bearer identity-token" } },
    );

    const response = await route.GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "completed",
      catalog: null,
      contactAction: null,
      contactCard: null,
    });
    expect(mocks.readHostedMurphContactContextForMember).not.toHaveBeenCalled();
  });

  it("keeps bearer authentication and canonical state reads fail-closed", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const authFailure = new Error("auth failed");
    mocks.requireHostedCompanionMemberAuthFromBearerToken.mockRejectedValue(authFailure);
    const request = new Request(
      "https://app.example.test/api/device-sync/companion/initial-onboarding",
      { headers: { authorization: "Bearer identity-token" } },
    );

    const authResponse = await route.GET(request);

    expect(authResponse.status).toBe(500);
    expect(mocks.readHostedInitialOnboardingState).not.toHaveBeenCalled();

    mocks.requireHostedCompanionMemberAuthFromBearerToken.mockResolvedValue({
      member: { id: "member_123" },
    });
    const stateFailure = new Error("state failed");
    mocks.readHostedInitialOnboardingState.mockRejectedValue(stateFailure);

    const stateResponse = await route.GET(request);

    expect(stateResponse.status).toBe(500);
    expect(mocks.readHostedMurphContactContextForMember).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledTimes(2);
  });

  it("uses the shared completion transaction for native skip", async () => {
    const request = new Request(
      "https://app.example.test/api/device-sync/companion/initial-onboarding",
      {
        body: JSON.stringify({ action: "skip" }),
        headers: {
          authorization: "Bearer identity-token",
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
    const response = await route.POST(request);

    await expect(response.json()).resolves.toMatchObject({
      completedNow: true,
      status: "completed",
    });
    expect(mocks.completeHostedInitialOnboardingTx).toHaveBeenCalledWith({
      memberId: "member_123",
      now: expect.any(Date),
      prisma: { tx: true },
      request: { action: "skip" },
    });
  });

  it("mints an absolute short-lived contact-card handoff after bearer auth", async () => {
    const request = new Request(
      "https://app.example.test/api/device-sync/companion/initial-onboarding/contact-card",
      {
        body: JSON.stringify({ avatarId: "classic" }),
        headers: {
          authorization: "Bearer identity-token",
          "content-type": "application/json",
        },
        method: "POST",
      },
    );
    const response = await contactCardRoute.POST(request);

    await expect(response.json()).resolves.toEqual({
      url: "https://app.example.test/api/murph-contact-card?handoff=signed-handoff",
    });
    expect(mocks.issueMurphContactCardHandoffClaim).toHaveBeenCalledWith({
      avatarId: "classic",
      memberId: "member_123",
      sessionId: "native-companion",
    });
  });
});
