import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import type { HostedPulseTrialResetSummary } from "@/src/lib/hosted-ops/pulse-trial-reset";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireHostedOpsRequestAccess: vi.fn(),
  resetHostedPulseTrialsForOps: vi.fn(),
}));

vi.mock("@/src/lib/hosted-ops/access", () => ({
  requireHostedOpsRequestAccess: mocks.requireHostedOpsRequestAccess,
}));

vi.mock("@/src/lib/hosted-ops/pulse-trial-reset", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/hosted-ops/pulse-trial-reset")>(
    "../src/lib/hosted-ops/pulse-trial-reset",
  );

  return {
    ...actual,
    resetHostedPulseTrialsForOps: mocks.resetHostedPulseTrialsForOps,
  };
});

type RouteModule = typeof import("../app/api/ops/pulse-trial-reset/route");

let route: RouteModule;

describe("hosted ops Pulse Trial reset route", () => {
  beforeAll(async () => {
    route = await import("../app/api/ops/pulse-trial-reset/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedOpsRequestAccess.mockResolvedValue({ member: { id: "member_ops" } });
    mocks.resetHostedPulseTrialsForOps.mockResolvedValue(makeResetSummary());
  });

  it("runs a dry-run through the authenticated same-origin ops route", async () => {
    const request = new Request("https://join.example.test/api/ops/pulse-trial-reset", {
      body: JSON.stringify({
        batchSize: "25",
        mode: "dry-run",
      }),
      headers: {
        "Content-Type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    });

    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.requireHostedOpsRequestAccess).toHaveBeenCalledWith(request, {
      requireMutationOrigin: true,
    });
    expect(mocks.resetHostedPulseTrialsForOps).toHaveBeenCalledWith({
      batchSize: 25,
      mode: "dry-run",
    });
    await expect(response.json()).resolves.toEqual({
      candidates: 3,
      failures: {
        db_update_failed: 0,
        stripe_retrieve_failed: 0,
        stripe_update_failed: 0,
      },
      mode: "dry-run",
      reset: 0,
      resetWindow: {
        trialEndsAt: "2026-07-10T12:00:00.000Z",
        trialStartedAt: "2026-06-30T12:00:00.000Z",
      },
      skipped: {
        missing_stripe_refs: 1,
        stripe_checkout_offer_mismatch: 0,
        stripe_customer_mismatch: 0,
        stripe_subscription_not_trialing: 1,
      },
      wouldReset: 1,
    });
  });

  it("applies the reset only when the request explicitly asks for apply mode", async () => {
    mocks.resetHostedPulseTrialsForOps.mockResolvedValueOnce({
      ...makeResetSummary(),
      mode: "apply",
      reset: 1,
      wouldReset: 0,
    });

    const response = await route.POST(
      new Request("https://join.example.test/api/ops/pulse-trial-reset", {
        body: JSON.stringify({
          mode: "apply",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.resetHostedPulseTrialsForOps).toHaveBeenCalledWith({
      batchSize: undefined,
      mode: "apply",
    });
    await expect(response.json()).resolves.toMatchObject({
      mode: "apply",
      reset: 1,
      wouldReset: 0,
    });
  });

  it("rejects invalid mode and batch size before touching billing state", async () => {
    const invalidMode = await route.POST(
      new Request("https://join.example.test/api/ops/pulse-trial-reset", {
        body: JSON.stringify({
          mode: "delete",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(invalidMode.status).toBe(400);
    await expect(invalidMode.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_OPS_PULSE_TRIAL_RESET_MODE_INVALID",
      },
    });

    const invalidBatchSize = await route.POST(
      new Request("https://join.example.test/api/ops/pulse-trial-reset", {
        body: JSON.stringify({
          batchSize: "0",
          mode: "dry-run",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(invalidBatchSize.status).toBe(400);
    await expect(invalidBatchSize.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_OPS_PULSE_TRIAL_RESET_BATCH_SIZE_INVALID",
      },
    });
    expect(mocks.resetHostedPulseTrialsForOps).not.toHaveBeenCalled();
  });

  it("does not run the reset when ops access fails", async () => {
    mocks.requireHostedOpsRequestAccess.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_OPS_ACCESS_DENIED",
        httpStatus: 404,
        message: "Hosted ops route was not found.",
      }),
    );

    const response = await route.POST(
      new Request("https://join.example.test/api/ops/pulse-trial-reset", {
        body: JSON.stringify({
          mode: "dry-run",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(404);
    expect(mocks.resetHostedPulseTrialsForOps).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_OPS_ACCESS_DENIED",
      },
    });
  });
});

function makeResetSummary(): HostedPulseTrialResetSummary {
  return {
    candidates: 3,
    failures: {
      db_update_failed: 0,
      stripe_retrieve_failed: 0,
      stripe_update_failed: 0,
    },
    mode: "dry-run",
    reset: 0,
    resetWindow: {
      trialEndsAt: new Date("2026-07-10T12:00:00.000Z"),
      trialStartedAt: new Date("2026-06-30T12:00:00.000Z"),
    },
    skipped: {
      missing_stripe_refs: 1,
      stripe_checkout_offer_mismatch: 0,
      stripe_customer_mismatch: 0,
      stripe_subscription_not_trialing: 1,
    },
    wouldReset: 1,
  };
}
