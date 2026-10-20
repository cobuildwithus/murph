import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeHostedInitialOnboardingTx: vi.fn(),
  getPrisma: vi.fn(),
  issueMurphContactCardHandoffClaim: vi.fn(),
  lookupHostedMemberByVerifiedEmailAddress: vi.fn(),
  readHostedInitialOnboardingState: vi.fn(),
  readHostedMemberMessagingSetupState: vi.fn(),
  readHostedMurphContactContextForMember: vi.fn(),
  requireActiveHostedMemberAuthFromBearerToken: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireActiveHostedMemberAuthFromBearerToken:
    mocks.requireActiveHostedMemberAuthFromBearerToken,
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
  readHostedInitialOnboardingState: mocks.readHostedInitialOnboardingState,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-contact-context", () => ({
  readHostedMurphContactContextForMember:
    mocks.readHostedMurphContactContextForMember,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  lookupHostedMemberByVerifiedEmailAddress:
    mocks.lookupHostedMemberByVerifiedEmailAddress,
  readHostedMemberMessagingSetupState:
    mocks.readHostedMemberMessagingSetupState,
}));

vi.mock("@/src/lib/hosted-onboarding/contact-card-handoff", () => ({
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
    mocks.requireActiveHostedMemberAuthFromBearerToken.mockResolvedValue({
      member: { id: "member_123" },
    });
    mocks.readHostedInitialOnboardingState.mockResolvedValue({
      preferences: { persona: null, tone: null, voice: null },
      status: "pending",
    });
    mocks.readHostedMemberMessagingSetupState.mockResolvedValue({
      identity: { phoneLookupKey: "hbidx:phone:v1:member" },
      routing: null,
    });
    mocks.readHostedMurphContactContextForMember.mockResolvedValue({
      initialContactChannels: { email: false, telegram: false, text: true },
      murphEmailAddress: null,
      murphPhoneNumber: "+15555550123",
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
      messagingSetupRequired: false,
      preferences: { persona: null, tone: null, voice: null },
      contactAction: { kind: "text" },
      contactCard: { defaultAvatarId: "classic" },
    });
    expect(payload.catalog.personas).toHaveLength(1);
    expect(payload.catalog.voices.length).toBeGreaterThan(10);
    expect(payload.catalog.voices[0].previewURL).toMatch(
      /^https:\/\/www\.withmurph\.ai\/audio\//u,
    );
    expect(mocks.requireActiveHostedMemberAuthFromBearerToken)
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
    expect(payload.catalog.personas).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      "Companion initial onboarding contact projection unavailable.",
    );
  });

  it("projects required messaging setup independently of onboarding completion", async () => {
    mocks.readHostedMemberMessagingSetupState.mockResolvedValue({
      identity: { phoneLookupKey: null },
      routing: null,
    });
    mocks.readHostedInitialOnboardingState.mockResolvedValue({
      completedAt: new Date("2026-08-04T12:00:00.000Z"),
      preferences: { persona: "classic", tone: "formal", voice: "murph" },
      status: "completed",
    });
    const response = await route.GET(new Request(
      "https://app.example.test/api/device-sync/companion/initial-onboarding",
      { headers: { authorization: "Bearer identity-token" } },
    ));

    await expect(response.json()).resolves.toMatchObject({
      messagingSetupRequired: true,
      status: "completed",
    });
    expect(mocks.lookupHostedMemberByVerifiedEmailAddress).not.toHaveBeenCalled();
  });

  it.each([
    { code: "246810", lookupMemberId: "member_123", expected: false },
    { code: "246810", lookupMemberId: "member_other", expected: true },
    { code: "", lookupMemberId: "member_123", expected: true },
  ])("lets only the configured review member past messaging setup (%j)", async ({ code, lookupMemberId, expected }) => {
    vi.stubEnv("HOSTED_AUTH_REVIEW_EMAIL", " Review@Example.test ");
    vi.stubEnv("HOSTED_AUTH_REVIEW_CODE", code);
    mocks.readHostedMemberMessagingSetupState.mockResolvedValue({
      identity: { phoneLookupKey: null },
      routing: null,
    });
    mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValue({
      core: { id: lookupMemberId },
      matchedBy: "verifiedEmail",
    });
    try {
      const response = await route.GET(new Request(
        "https://app.example.test/api/device-sync/companion/initial-onboarding",
        { headers: { authorization: "Bearer identity-token" } },
      ));

      await expect(response.json()).resolves.toMatchObject({
        messagingSetupRequired: expected,
      });
      if (code) {
        expect(mocks.lookupHostedMemberByVerifiedEmailAddress).toHaveBeenCalledWith(
          expect.objectContaining({ address: "review@example.test", projection: "core" }),
        );
      } else {
        expect(mocks.lookupHostedMemberByVerifiedEmailAddress).not.toHaveBeenCalled();
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    { telegramThreadId: null, phoneLookupKey: null, expectedAwaiting: true },
    { telegramThreadId: "123456789", phoneLookupKey: null, expectedAwaiting: false },
    { telegramThreadId: null, phoneLookupKey: "synthetic-phone-lookup", expectedAwaiting: false },
    { telegramThreadId: "123456789", phoneLookupKey: "synthetic-phone-lookup", expectedAwaiting: false },
  ])("projects Telegram waiting only when no direct route exists (%j)", async ({ telegramThreadId, phoneLookupKey, expectedAwaiting }) => {
    mocks.readHostedMemberMessagingSetupState.mockResolvedValue({
      identity: { phoneLookupKey },
      routing: { telegramUserId: "123456789", telegramThreadId },
    });
    const response = await route.GET(new Request(
      "https://app.example.test/api/device-sync/companion/initial-onboarding",
      { headers: { authorization: "Bearer identity-token" } },
    ));
    await expect(response.json()).resolves.toMatchObject({
      messagingSetupRequired: false,
      telegramAwaitingInbound: expectedAwaiting,
    });
  });

  it("retains the assigned contact route after onboarding completes", async () => {
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
      contactAction: { kind: "text", href: expect.stringContaining("sms:+15555550123") },
      contactCard: null,
    });
    expect(mocks.readHostedMurphContactContextForMember).toHaveBeenCalledWith({
      memberId: "member_123", prisma: expect.anything(),
    });
  });

  it("keeps completed onboarding available when its contact route is unavailable", async () => {
    mocks.readHostedInitialOnboardingState.mockResolvedValue({
      preferences: { persona: null, tone: null, voice: null }, status: "completed",
    });
    mocks.readHostedMurphContactContextForMember.mockRejectedValue(new Error("contact unavailable"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const method of ["GET", "POST"] as const) {
      const response = await route[method](new Request(
        "https://app.example.test/api/device-sync/companion/initial-onboarding",
        { method, ...(method === "POST" ? { body: JSON.stringify({ action: "skip" }) } : {}) },
      ));
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ status: "completed", contactAction: null });
    }
  });

  it("keeps bearer authentication and canonical state reads fail-closed", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const authFailure = new Error("auth failed");
    mocks.requireActiveHostedMemberAuthFromBearerToken.mockRejectedValue(authFailure);
    const request = new Request(
      "https://app.example.test/api/device-sync/companion/initial-onboarding",
      { headers: { authorization: "Bearer identity-token" } },
    );

    const authResponse = await route.GET(request);

    expect(authResponse.status).toBe(500);
    expect(mocks.readHostedInitialOnboardingState).not.toHaveBeenCalled();

    mocks.requireActiveHostedMemberAuthFromBearerToken.mockResolvedValue({
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
      contactAction: { kind: "text", href: expect.stringContaining("sms:+15555550123") },
    });
    expect(mocks.completeHostedInitialOnboardingTx).toHaveBeenCalledWith({
      memberId: "member_123",
      now: expect.any(Date),
      prisma: { tx: true },
      request: { action: "skip" },
    });
  });

  it("rejects a retired native selection before completion or mailbox dispatch", async () => {
    const response = await route.POST(new Request(
      "https://app.example.test/api/device-sync/companion/initial-onboarding",
      { method: "POST", headers: { authorization: "Bearer identity-token", "content-type": "application/json" },
        body: JSON.stringify({ action: "save", preferences: {
          persona: "scientist-with-classic", tone: "casual", voice: "warm",
        } }) },
    ));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: {
        code: "INITIAL_ONBOARDING_REQUEST_INVALID",
        message: "Refresh Murph before completing setup.",
      } });
    expect(mocks.requireActiveHostedMemberAuthFromBearerToken).toHaveBeenCalledOnce();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.completeHostedInitialOnboardingTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("accepts a current native Classic save without changing tone or voice", async () => {
    const preferences = { persona: "classic", tone: "casual", voice: "warm" };
    const response = await route.POST(new Request(
      "https://app.example.test/api/device-sync/companion/initial-onboarding",
      { method: "POST", headers: { authorization: "Bearer identity-token", "content-type": "application/json" },
        body: JSON.stringify({ action: "save", preferences }) },
    ));
    expect(response.status).toBe(200);
    expect(mocks.completeHostedInitialOnboardingTx).toHaveBeenCalledWith(
      expect.objectContaining({ request: { action: "save", preferences } }),
    );
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
