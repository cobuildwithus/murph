import assert from "node:assert/strict";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  extendHostedPulseTrialsForCampaign: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-ops/pulse-trial-extension", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-ops/pulse-trial-extension")
  >("@/src/lib/hosted-ops/pulse-trial-extension");
  return {
    ...actual,
    extendHostedPulseTrialsForCampaign: mocks.extendHostedPulseTrialsForCampaign,
  };
});

import type { HostedPulseTrialExtensionSummary } from "@/src/lib/hosted-ops/pulse-trial-extension";

type PulseTrialExtensionRouteModule =
  typeof import("../app/api/ops/pulse-trial-extension/route");

let route: PulseTrialExtensionRouteModule;

const originalHostedOpsMemberIds = process.env.HOSTED_OPS_MEMBER_IDS;
const NOW = new Date("2026-07-10T12:00:00.000Z");
const DERIVED_CAMPAIGN = "pulse-beta-extension-2026-07-10";
const OPERATOR_MEMBER_ID = "member_operator";

let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

describe("hosted ops Pulse Trial extension route", () => {
  beforeAll(async () => {
    route = await import("../app/api/ops/pulse-trial-extension/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    process.env.HOSTED_OPS_MEMBER_IDS = OPERATOR_MEMBER_ID;
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: OPERATOR_MEMBER_ID },
    });
    mocks.extendHostedPulseTrialsForCampaign.mockResolvedValue(
      makeSummary({ campaign: DERIVED_CAMPAIGN }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleInfoSpy.mockRestore();
    if (originalHostedOpsMemberIds === undefined) {
      delete process.env.HOSTED_OPS_MEMBER_IDS;
    } else {
      process.env.HOSTED_OPS_MEMBER_IDS = originalHostedOpsMemberIds;
    }
  });

  test("hides the route from members outside the ops allowlist", async () => {
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_other" },
    });

    const response = await route.POST(makeRequest({}));

    assert.equal(response.status, 404);
    assert.equal(mocks.extendHostedPulseTrialsForCampaign.mock.calls.length, 0);
  });

  test("defaults to a preview with the UTC-dated campaign and no member filter", async () => {
    const response = await route.POST(makeRequest({}));

    assert.equal(response.status, 200);
    assert.equal(mocks.assertHostedOnboardingMutationOrigin.mock.calls.length, 1);
    expect(mocks.extendHostedPulseTrialsForCampaign).toHaveBeenCalledWith({
      campaign: DERIVED_CAMPAIGN,
      memberId: undefined,
      mode: "dry-run",
    });
    const payload = await response.json() as HostedPulseTrialExtensionSummary;
    assert.equal(payload.campaign, DERIVED_CAMPAIGN);
    assert.equal(consoleInfoSpy.mock.calls.length, 0);
  });

  test("passes a trimmed member filter through to the campaign", async () => {
    await route.POST(makeRequest({ memberId: "  member_target  " }));

    expect(mocks.extendHostedPulseTrialsForCampaign).toHaveBeenCalledWith({
      campaign: DERIVED_CAMPAIGN,
      memberId: "member_target",
      mode: "dry-run",
    });
  });

  test("refuses to apply without the exact current campaign key", async () => {
    const missing = await route.POST(makeRequest({ mode: "apply" }));
    const stale = await route.POST(makeRequest({
      campaign: "pulse-beta-extension-2026-07-09",
      mode: "apply",
    }));

    assert.equal(missing.status, 400);
    assert.equal(stale.status, 400);
    assert.equal(mocks.extendHostedPulseTrialsForCampaign.mock.calls.length, 0);
  });

  test("applies with the exact campaign key and logs the operator", async () => {
    const response = await route.POST(makeRequest({
      campaign: DERIVED_CAMPAIGN,
      memberId: "member_target",
      mode: "apply",
    }));

    assert.equal(response.status, 200);
    expect(mocks.extendHostedPulseTrialsForCampaign).toHaveBeenCalledWith({
      campaign: DERIVED_CAMPAIGN,
      memberId: "member_target",
      mode: "apply",
    });
    assert.equal(consoleInfoSpy.mock.calls.length, 1);
    assert.deepEqual(consoleInfoSpy.mock.calls[0]?.[1], {
      campaign: DERIVED_CAMPAIGN,
      localWindowsReconciled: 0,
      operatorMemberId: OPERATOR_MEMBER_ID,
      stripeTrialsExtended: 0,
      targetMemberId: "member_target",
      timestamp: NOW.toISOString(),
    });
  });

  test("rejects unknown modes", async () => {
    const response = await route.POST(makeRequest({ mode: "extend-everything" }));

    assert.equal(response.status, 400);
    assert.equal(mocks.extendHostedPulseTrialsForCampaign.mock.calls.length, 0);
  });
});

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/ops/pulse-trial-extension", {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
}

function makeSummary(
  overrides: Partial<HostedPulseTrialExtensionSummary>,
): HostedPulseTrialExtensionSummary {
  return {
    alreadyExtended: 0,
    campaign: DERIVED_CAMPAIGN,
    candidates: 0,
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
      local_candidate_changed: 0,
      local_trial_window_invalid: 0,
      missing_stripe_refs: 0,
      stripe_billing_plan_mismatch: 0,
      stripe_campaign_marker_conflict: 0,
      stripe_checkout_offer_mismatch: 0,
      stripe_customer_mismatch: 0,
      stripe_price_mismatch: 0,
      stripe_subscription_id_mismatch: 0,
      stripe_subscription_canceling: 0,
      stripe_subscription_not_trialing: 0,
      stripe_trial_end_invalid: 0,
    },
    stripeTrialsExtended: 0,
    wouldExtend: 0,
    wouldReconcile: 0,
    ...overrides,
  };
}
