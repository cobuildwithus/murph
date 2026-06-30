import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  createHostedDeviceSyncControlPlane: vi.fn(),
  describeProviders: vi.fn(),
  getPrisma: vi.fn(),
  reconcileDueHostedStripeEvents: vi.fn(),
  requireVercelCronRequest: vi.fn(),
}));

vi.mock("@/src/lib/device-sync/control-plane", () => ({
  createHostedDeviceSyncControlPlane: mocks.createHostedDeviceSyncControlPlane,
}));

vi.mock("@/src/lib/hosted-execution/vercel-cron", () => ({
  requireVercelCronRequest: mocks.requireVercelCronRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-event-reconciliation", () => ({
  reconcileDueHostedStripeEvents: mocks.reconcileDueHostedStripeEvents,
}));

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
    vi.stubEnv(
      "HOSTED_DEVICE_ROUTING_INDEX_KEY",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    vi.stubEnv("OURA_CLIENT_ID", "oura-client");
    vi.stubEnv("OURA_CLIENT_SECRET", "oura-secret");
    mocks.createHostedDeviceSyncControlPlane.mockReturnValue({
      describeProviders: mocks.describeProviders,
    });
    mocks.describeProviders.mockReturnValue([
      {
        callbackPath: "/oauth/oura/callback",
        callbackUrl: "https://join.example.test/oauth/oura/callback",
        defaultScopes: ["daily"],
        provider: "oura",
        supportsWebhooks: true,
        webhookPath: "/webhooks/oura",
        webhookUrl: "https://join.example.test/webhooks/oura",
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
          callbackPath: "/oauth/oura/callback",
          callbackUrl: "https://join.example.test/api/device-sync/oauth/oura/callback",
          connectionKind: "oauth2",
          credentialPolicy: "oauth_tokens",
          defaultScopes: ["personal", "daily", "workout", "session", "spo2"],
          provider: "oura",
          supportsWebhooks: true,
          webhookPath: "/webhooks/oura",
          webhookUrl: "https://join.example.test/api/device-sync/webhooks/oura",
        },
      ],
    });
  });

  it("does not advertise providers when authoritative provider config is invalid", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("OURA_RECONCILE_DAYS", "soon");

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
    vi.stubEnv("JUNCTION_API_KEY", "sk_us_junction-test");

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
    mocks.getPrisma.mockReturnValue({ label: "test-prisma" });
    mocks.reconcileDueHostedStripeEvents.mockResolvedValue(["evt_paid", "evt_trial"]);
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
    expect(mocks.reconcileDueHostedStripeEvents).toHaveBeenCalledWith({
      prisma: { label: "test-prisma" },
    });
    expect(
      mocks.requireVercelCronRequest.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.getPrisma.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY);
    expect(
      mocks.requireVercelCronRequest.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.reconcileDueHostedStripeEvents.mock.invocationCallOrder[0] ??
        Number.POSITIVE_INFINITY,
    );
    await expect(response.json()).resolves.toEqual({
      reconciledEventIds: ["evt_paid", "evt_trial"],
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
    expect(mocks.reconcileDueHostedStripeEvents).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "VERCEL_CRON_UNAUTHORIZED",
        message: "Unauthorized Vercel cron request.",
        retryable: false,
      },
    });
  });
});
