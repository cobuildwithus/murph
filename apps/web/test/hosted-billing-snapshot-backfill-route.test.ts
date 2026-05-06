import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  backfillHostedBillingSnapshots: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-billing-snapshot-backfill", () => ({
  backfillHostedBillingSnapshots: mocks.backfillHostedBillingSnapshots,
}));

type RouteModule = typeof import("../app/api/internal/hosted-onboarding/billing/backfill-snapshots/route");

let route: RouteModule;

describe("hosted billing snapshot backfill route", () => {
  const originalBackfillSecret = process.env.HOSTED_BILLING_BACKFILL_SECRET;

  beforeAll(async () => {
    route = await import("../app/api/internal/hosted-onboarding/billing/backfill-snapshots/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOSTED_BILLING_BACKFILL_SECRET = "backfill-secret";
    mocks.backfillHostedBillingSnapshots.mockResolvedValue({
      apply: false,
      customerMismatch: 0,
      failed: 0,
      limit: 25,
      missingSubscriptionRef: 0,
      scanned: 7,
      stripeRetrieveFailed: 0,
      unresolvedPlan: 0,
      updated: 0,
      wouldUpdate: 7,
    });
  });

  afterEach(() => {
    if (originalBackfillSecret === undefined) {
      delete process.env.HOSTED_BILLING_BACKFILL_SECRET;
      return;
    }

    process.env.HOSTED_BILLING_BACKFILL_SECRET = originalBackfillSecret;
  });

  it("runs a dry-run from GET", async () => {
    const response = await route.GET(
      new Request("https://join.example.test/api/internal/hosted-onboarding/billing/backfill-snapshots?limit=25", {
        headers: {
          authorization: "Bearer backfill-secret",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.backfillHostedBillingSnapshots).toHaveBeenCalledWith({
      apply: false,
      limit: 25,
    });
    await expect(response.json()).resolves.toMatchObject({
      backfill: {
        scanned: 7,
        wouldUpdate: 7,
      },
    });
  });

  it("requires explicit apply for writes", async () => {
    await route.POST(
      new Request("https://join.example.test/api/internal/hosted-onboarding/billing/backfill-snapshots", {
        body: JSON.stringify({
          apply: true,
          limit: 10,
        }),
        headers: {
          authorization: "Bearer backfill-secret",
        },
        method: "POST",
      }),
    );

    expect(mocks.backfillHostedBillingSnapshots).toHaveBeenCalledWith({
      apply: true,
      limit: 10,
    });
  });

  it("rejects requests without the dedicated backfill secret", async () => {
    const response = await route.GET(
      new Request("https://join.example.test/api/internal/hosted-onboarding/billing/backfill-snapshots", {
        headers: {
          authorization: "Bearer wrong-secret",
        },
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.backfillHostedBillingSnapshots).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_BILLING_BACKFILL_UNAUTHORIZED",
      },
    });
  });
});
