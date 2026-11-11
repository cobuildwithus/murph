import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncControlPlane: vi.fn(),
  describeProviders: vi.fn(),
  dispatchHostedGroupSponsorshipRefills: vi.fn(),
  drainHostedGroupJoinOutreachSweep: vi.fn(),
  getPrisma: vi.fn(),
  drainGameChatLifecycle: vi.fn(),
  dispatchDueHostedStripeEvents: vi.fn(),
  requireVercelCronRequest: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));

vi.mock("@/src/lib/hosted-execution/vercel-cron", () => ({
  requireVercelCronRequest: mocks.requireVercelCronRequest,
}));

vi.mock("@/src/lib/hosted-groups/group-join-outreach-drain", () => ({
  drainHostedGroupJoinOutreachSweep: mocks.drainHostedGroupJoinOutreachSweep,
}));

vi.mock("@/src/lib/hosted-groups/group-sponsorship-refill-dispatch", () => ({
  dispatchHostedGroupSponsorshipRefills:
    mocks.dispatchHostedGroupSponsorshipRefills,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-event-reconciliation", () => ({
  dispatchDueHostedStripeEvents: mocks.dispatchDueHostedStripeEvents,
}));

vi.mock("@/src/lib/game/chat-lifecycle", () => ({ drainGameChatLifecycle: mocks.drainGameChatLifecycle }));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type DeviceSyncRootRouteModule = typeof import("../app/api/device-sync/route");
type HostedOnboardingStripeCronRouteModule =
  typeof import("../app/api/internal/hosted-onboarding/stripe/cron/route");

let deviceSyncRootRoute: DeviceSyncRootRouteModule;
let hostedOnboardingStripeCronRoute: HostedOnboardingStripeCronRouteModule;

describe("device-sync root route", () => {
  beforeAll(async () => {
    deviceSyncRootRoute = await import("../app/api/device-sync/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.drainGameChatLifecycle.mockResolvedValue({ attempted: 0, queued: 0, deferred: 0 });
    vi.stubEnv(
      "HOSTED_DEVICE_ROUTING_INDEX_KEY",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");
    vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "junction-client-user-id-secret");
    vi.stubEnv("JUNCTION_ENV", "sandbox");
    vi.stubEnv("JUNCTION_REGION", "us");
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      describeProviders: mocks.describeProviders,
    });
    mocks.describeProviders.mockReturnValue([
      {
        callbackPath: "/connect/junction/callback",
        callbackUrl: "https://join.example.test/connect/junction/callback",
        defaultScopes: ["daily"],
        provider: "junction",
        supportsWebhooks: true,
        webhookPath: "/webhooks/junction",
        webhookUrl: "https://join.example.test/webhooks/junction",
      },
    ]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns hosted device-sync provider descriptors without caching", async () => {
    const request = new Request("https://join.example.test/api/device-sync");

    const response = await deviceSyncRootRoute.GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.createHostedDeviceSyncControlPlane).not.toHaveBeenCalled();
    expect(mocks.describeProviders).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      ok: true,
      providers: [
        {
          callbackPath: "/connect/junction/callback",
          callbackUrl: "https://join.example.test/api/device-sync/connect/junction/callback",
          connectionKind: "external_link",
          credentialPolicy: "provider_config",
          defaultScopes: [],
          provider: "junction",
          supportsWebhooks: true,
          webhookPath: "/webhooks/junction",
          webhookUrl: "https://join.example.test/api/device-sync/webhooks/junction",
        },
      ],
    });
  });

  it("does not advertise providers when authoritative provider config is invalid", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("JUNCTION_RECONCILE_DAYS", "soon");

    try {
      const response = await deviceSyncRootRoute.GET(
        new Request("https://join.example.test/api/device-sync"),
      );

      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(mocks.createHostedDeviceSyncControlPlane).not.toHaveBeenCalled();
      expect(mocks.describeProviders).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid request.",
        },
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("maps route wrapper request errors to a no-store JSON error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("JUNCTION_CLIENT_USER_ID_SECRET", "");

    try {
      const response = await deviceSyncRootRoute.GET(
        new Request("https://join.example.test/api/device-sync"),
      );

      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(mocks.createHostedDeviceSyncControlPlane).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid request.",
        },
      });
    } finally {
      warn.mockRestore();
    }
  });
});

describe("hosted onboarding Stripe cron route", () => {
  beforeAll(async () => {
    hostedOnboardingStripeCronRoute = await import(
      "../app/api/internal/hosted-onboarding/stripe/cron/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.drainGameChatLifecycle.mockResolvedValue({ attempted: 0, queued: 0, deferred: 0 });
    mocks.getPrisma.mockReturnValue({ label: "test-prisma" });
    mocks.dispatchHostedGroupSponsorshipRefills.mockResolvedValue({
      attempted: 0,
      dispatched: 0,
      recoveryRequired: 0,
    });
    mocks.drainHostedGroupJoinOutreachSweep.mockResolvedValue({
      attempted: 0,
      results: [],
      sent: 0,
    });
    mocks.dispatchDueHostedStripeEvents.mockResolvedValue(["evt_paid", "evt_trial"]);
    mocks.requireVercelCronRequest.mockReturnValue(undefined);
  });

  it("requires cron auth before reconciling due Stripe events", async () => {
    const request = new Request(
      "https://join.example.test/api/internal/hosted-onboarding/stripe/cron",
    );

    const response = await hostedOnboardingStripeCronRoute.GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.requireVercelCronRequest).toHaveBeenCalledWith(request);
    expect(mocks.getPrisma).toHaveBeenCalledTimes(1);
    expect(mocks.drainHostedGroupJoinOutreachSweep).toHaveBeenCalledWith({
      prisma: { label: "test-prisma" },
      signal: request.signal,
    });
    expect(mocks.dispatchHostedGroupSponsorshipRefills).toHaveBeenCalledWith({
      prisma: { label: "test-prisma" },
    });
    expect(mocks.dispatchDueHostedStripeEvents).toHaveBeenCalledWith({
      prisma: { label: "test-prisma" },
    });
    expect(
      mocks.requireVercelCronRequest.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.getPrisma.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY);
    expect(
      mocks.requireVercelCronRequest.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.dispatchDueHostedStripeEvents.mock.invocationCallOrder[0] ??
        Number.POSITIVE_INFINITY,
    );
    await expect(response.json()).resolves.toEqual({
      gameChatLifecycle: { attempted: 0, queued: 0, deferred: 0 },
      groupJoinOutreach: { attempted: 0, results: [], sent: 0 },
      groupSponsorshipRefills: {
        attempted: 0,
        dispatched: 0,
        recoveryRequired: 0,
      },
      dispatchedStripeEventIds: ["evt_paid", "evt_trial"],
    });
  });

  it("logs a failed game drain by fixed reason and still reports Stripe reconciliation", async () => {
    mocks.drainGameChatLifecycle.mockRejectedValueOnce(new Error("Synthetic private detail."));
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const response = await hostedOnboardingStripeCronRoute.GET(
      new Request("https://join.example.test/api/internal/hosted-onboarding/stripe/cron"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      gameChatLifecycle: { kind: "failed" },
      dispatchedStripeEventIds: ["evt_paid", "evt_trial"],
    });
    expect(info).toHaveBeenCalledWith(expect.any(String), {
      diagnostic: "game.chat-lifecycle-drain",
      kind: "cron_failed",
      reason: "unhandled",
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain("Synthetic private detail");
    info.mockRestore();
  });

  it("still reports Stripe reconciliation when the outreach drain throws", async () => {
    // Outreach shares this billing-critical cron, so a drain failure must not
    // turn a healthy Stripe reconciliation into a failed cron invocation.
    mocks.drainHostedGroupJoinOutreachSweep.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_LINQ_ASSIGNABLE_LINE_LIMIT_EXCEEDED",
        httpStatus: 500,
        message: "Too many healthy lines.",
      }),
    );

    const response = await hostedOnboardingStripeCronRoute.GET(
      new Request("https://join.example.test/api/internal/hosted-onboarding/stripe/cron"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      gameChatLifecycle: { attempted: 0, queued: 0, deferred: 0 },
      groupJoinOutreach: { kind: "failed" },
      groupSponsorshipRefills: {
        attempted: 0,
        dispatched: 0,
        recoveryRequired: 0,
      },
      dispatchedStripeEventIds: ["evt_paid", "evt_trial"],
    });
  });

  it("does not create Prisma or reconcile Stripe events when cron auth fails", async () => {
    mocks.requireVercelCronRequest.mockImplementationOnce(() => {
      throw hostedOnboardingError({
        code: "VERCEL_CRON_UNAUTHORIZED",
        httpStatus: 401,
        message: "Unauthorized Vercel cron request.",
      });
    });

    const response = await hostedOnboardingStripeCronRoute.GET(
      new Request("https://join.example.test/api/internal/hosted-onboarding/stripe/cron"),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.dispatchHostedGroupSponsorshipRefills).not.toHaveBeenCalled();
    expect(mocks.drainHostedGroupJoinOutreachSweep).not.toHaveBeenCalled();
    expect(mocks.dispatchDueHostedStripeEvents).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "VERCEL_CRON_UNAUTHORIZED",
        message: "Unauthorized Vercel cron request.",
        retryable: false,
      },
    });
  });
});
