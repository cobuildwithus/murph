import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import type { HostedPulseTrialExtensionSummary } from "@/src/lib/hosted-ops/pulse-trial-extension";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  extendHostedPulseTrialsForOps: vi.fn(),
  requireHostedOpsRequestAccess: vi.fn(),
}));

vi.mock("@/src/lib/hosted-ops/access", () => ({
  requireHostedOpsRequestAccess: mocks.requireHostedOpsRequestAccess,
}));

vi.mock("@/src/lib/hosted-ops/pulse-trial-extension", async () => {
  const actual = await vi.importActual<
    typeof import("../src/lib/hosted-ops/pulse-trial-extension")
  >("../src/lib/hosted-ops/pulse-trial-extension");

  return {
    ...actual,
    extendHostedPulseTrialsForOps: mocks.extendHostedPulseTrialsForOps,
  };
});

type RouteModule = typeof import("../app/api/ops/pulse-trial-extension/route");

let route: RouteModule;

describe("hosted Ops Pulse Trial extension route", () => {
  beforeAll(async () => {
    route = await import("../app/api/ops/pulse-trial-extension/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedOpsRequestAccess.mockResolvedValue({ member: { id: "member_ops" } });
    mocks.extendHostedPulseTrialsForOps.mockResolvedValue(makeSummary());
  });

  it("runs a preview through the authenticated same-origin Ops route", async () => {
    const request = makeRequest("dry-run");
    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.requireHostedOpsRequestAccess).toHaveBeenCalledWith(request, {
      requireMutationOrigin: true,
    });
    expect(mocks.extendHostedPulseTrialsForOps).toHaveBeenCalledWith({
      mode: "dry-run",
    });
    await expect(response.json()).resolves.toEqual(makeSummary());
  });

  it("applies only when explicitly requested", async () => {
    mocks.extendHostedPulseTrialsForOps.mockResolvedValueOnce({
      ...makeSummary(),
      localWindowsReconciled: 1,
      mode: "apply",
      stripeTrialsExtended: 1,
      wouldExtend: 0,
    });

    const response = await route.POST(makeRequest("apply"));

    expect(response.status).toBe(200);
    expect(mocks.extendHostedPulseTrialsForOps).toHaveBeenCalledWith({ mode: "apply" });
    await expect(response.json()).resolves.toMatchObject({
      localWindowsReconciled: 1,
      mode: "apply",
      stripeTrialsExtended: 1,
    });
  });

  it("rejects invalid mode before touching billing state", async () => {
    const response = await route.POST(makeRequest("delete"));

    expect(response.status).toBe(400);
    expect(mocks.extendHostedPulseTrialsForOps).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_MODE_INVALID",
      },
    });
  });

  it("does not run when Ops access fails", async () => {
    mocks.requireHostedOpsRequestAccess.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_OPS_ACCESS_DENIED",
        httpStatus: 404,
        message: "Hosted Ops route was not found.",
      }),
    );

    const response = await route.POST(makeRequest("dry-run"));

    expect(response.status).toBe(404);
    expect(mocks.extendHostedPulseTrialsForOps).not.toHaveBeenCalled();
  });
});

function makeRequest(mode: string): Request {
  return new Request("https://join.example.test/api/ops/pulse-trial-extension", {
    body: JSON.stringify({ mode }),
    headers: {
      "Content-Type": "application/json",
      origin: "https://join.example.test",
    },
    method: "POST",
  });
}

function makeSummary(): HostedPulseTrialExtensionSummary {
  return {
    alreadyExtended: 0,
    campaign: "pulse-beta-extension-2026-07",
    candidates: 2,
    extensionDays: 7,
    failures: {
      db_update_failed: 0,
      stripe_retrieve_failed: 0,
      stripe_update_failed: 0,
      stripe_update_result_invalid: 0,
    },
    localWindowsReconciled: 0,
    mode: "dry-run",
    skipped: {
      local_trial_window_invalid: 0,
      local_usage_period_missing: 0,
      missing_stripe_refs: 0,
      stripe_billing_plan_mismatch: 0,
      stripe_campaign_marker_conflict: 0,
      stripe_checkout_offer_mismatch: 0,
      stripe_customer_mismatch: 0,
      stripe_subscription_id_mismatch: 0,
      stripe_subscription_not_trialing: 1,
      stripe_trial_end_invalid: 0,
    },
    stripeTrialsExtended: 0,
    wouldExtend: 1,
    wouldReconcile: 0,
  };
}
