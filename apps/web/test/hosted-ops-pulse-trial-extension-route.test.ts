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

import {
  HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
  HostedPulseTrialExtensionPreviewMismatchError,
  type HostedPulseTrialExtensionSummary,
} from "@/src/lib/hosted-ops/pulse-trial-extension";

type PulseTrialExtensionRouteModule =
  typeof import("../app/api/ops/pulse-trial-extension/route");

let route: PulseTrialExtensionRouteModule;

const originalHostedOpsMemberIds = process.env.HOSTED_OPS_MEMBER_IDS;
const NOW = new Date("2026-07-10T12:00:00.000Z");
const OPERATOR_MEMBER_ID = "member_operator";
const CANDIDATE_SNAPSHOT_DIGEST = `pulse-candidates-v4.${"a".repeat(43)}`;
const CANDIDATE_PREVIEW_TOKEN = `pulse-target-v3.${"b".repeat(43)}`;
const CONTINUATION_TOKEN =
  `pulse-cursor-v1.v1.${"a".repeat(16)}.${"b".repeat(8)}.${"c".repeat(22)}`;

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
      makeSummary({}),
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

  test("defaults to a bounded preview with the fixed campaign and no member filter", async () => {
    const response = await route.POST(makeRequest({}));

    assert.equal(response.status, 200);
    assert.equal(route.maxDuration, 800);
    assert.equal(mocks.assertHostedOnboardingMutationOrigin.mock.calls.length, 1);
    expect(mocks.extendHostedPulseTrialsForCampaign).toHaveBeenCalledWith({
      continuationToken: null,
      maxCandidates: 4,
      memberId: undefined,
      mode: "dry-run",
    });
    const payload = await response.json() as HostedPulseTrialExtensionSummary;
    assert.equal(payload.campaign, HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN);
    assert.equal(consoleInfoSpy.mock.calls.length, 0);
  });

  test("passes a trimmed member filter through to the campaign", async () => {
    await route.POST(makeRequest({ memberId: "  member_target  " }));

    expect(mocks.extendHostedPulseTrialsForCampaign).toHaveBeenCalledWith({
      continuationToken: null,
      maxCandidates: 4,
      memberId: "member_target",
      mode: "dry-run",
    });
  });

  test.each([
    ["blank", "   "],
    ["null", null],
    ["number", 42],
    ["object", { id: "member_target" }],
  ])("rejects a present invalid %s member scope instead of widening to all", async (
    _label,
    memberId,
  ) => {
    const response = await route.POST(makeRequest({ memberId }));

    assert.equal(response.status, 400);
    assert.equal(mocks.extendHostedPulseTrialsForCampaign.mock.calls.length, 0);
  });

  test("refuses to apply without the exact current campaign key", async () => {
    const missing = await route.POST(makeRequest({ mode: "apply" }));
    const stale = await route.POST(makeRequest({
      campaign: "pulse-beta-extension-another-occasion",
      mode: "apply",
    }));

    assert.equal(missing.status, 400);
    assert.equal(stale.status, 400);
    assert.equal(mocks.extendHostedPulseTrialsForCampaign.mock.calls.length, 0);
  });

  test("applies with the exact campaign key and logs only aggregate results", async () => {
    const response = await route.POST(makeRequest({
      campaign: HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
      candidatePreviewTokens: [CANDIDATE_PREVIEW_TOKEN],
      candidateSnapshotDigest: CANDIDATE_SNAPSHOT_DIGEST,
      memberId: "member_target",
      mode: "apply",
    }));

    assert.equal(response.status, 200);
    expect(mocks.extendHostedPulseTrialsForCampaign).toHaveBeenCalledWith({
      expectedCandidatePreviewTokens: [CANDIDATE_PREVIEW_TOKEN],
      expectedCandidateSnapshotDigest: CANDIDATE_SNAPSHOT_DIGEST,
      continuationToken: null,
      maxCandidates: 4,
      memberId: "member_target",
      mode: "apply",
    });
    assert.equal(consoleInfoSpy.mock.calls.length, 1);
    assert.deepEqual(consoleInfoSpy.mock.calls[0]?.[1], {
      campaign: HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
      localWindowsReconciled: 0,
      providerTrialsCleanedUp: 0,
      providerTrialsRecovered: 0,
      scope: "member",
      stripeTrialsExtended: 0,
      timestamp: NOW.toISOString(),
    });
  });

  test("refuses to apply without a candidate snapshot from Preview", async () => {
    const response = await route.POST(makeRequest({
      campaign: HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
      mode: "apply",
    }));

    assert.equal(response.status, 400);
    assert.equal(mocks.extendHostedPulseTrialsForCampaign.mock.calls.length, 0);
  });

  test("refuses to apply with a snapshot but without complete provider preview proof", async () => {
    const response = await route.POST(makeRequest({
      campaign: HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
      candidateSnapshotDigest: CANDIDATE_SNAPSHOT_DIGEST,
      mode: "apply",
    }));

    assert.equal(response.status, 400);
    assert.equal(mocks.extendHostedPulseTrialsForCampaign.mock.calls.length, 0);
  });

  test("rejects a changed candidate snapshot before applying", async () => {
    mocks.extendHostedPulseTrialsForCampaign.mockRejectedValueOnce(
      new HostedPulseTrialExtensionPreviewMismatchError(),
    );

    const response = await route.POST(makeRequest({
      campaign: HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
      candidatePreviewTokens: [CANDIDATE_PREVIEW_TOKEN],
      candidateSnapshotDigest: CANDIDATE_SNAPSHOT_DIGEST,
      mode: "apply",
    }));
    const payload = await response.json() as {
      error?: { code?: string; message?: string };
    };

    assert.equal(response.status, 409);
    assert.equal(payload.error?.code, "HOSTED_OPS_PULSE_TRIAL_EXTENSION_PREVIEW_STALE");
    assert.match(payload.error?.message ?? "", /Preview again/u);
    assert.equal(consoleInfoSpy.mock.calls.length, 0);
  });

  test("passes opaque all-member continuation and rejects invalid or member-scoped tokens", async () => {
    const continuationResponse = await route.POST(makeRequest({
      continuationToken: CONTINUATION_TOKEN,
    }));
    const memberContinuationResponse = await route.POST(makeRequest({
      continuationToken: CONTINUATION_TOKEN,
      memberId: "member_target",
    }));
    const malformedContinuationResponse = await route.POST(makeRequest({
      continuationToken: "member_secret",
    }));

    assert.equal(continuationResponse.status, 200);
    expect(mocks.extendHostedPulseTrialsForCampaign).toHaveBeenCalledWith({
      continuationToken: CONTINUATION_TOKEN,
      maxCandidates: 4,
      memberId: undefined,
      mode: "dry-run",
    });
    assert.equal(memberContinuationResponse.status, 400);
    assert.equal(malformedContinuationResponse.status, 400);
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
    campaign: HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
    candidatePreviewTokens: [],
    candidateSnapshotDigest: CANDIDATE_SNAPSHOT_DIGEST,
    candidates: 0,
    extensionDays: 7,
    failures: {
      db_update_failed: 0,
      member_lock_busy: 0,
      preview_state_changed: 0,
      provider_recovery_failed: 0,
      provider_recovery_lookup_failed: 0,
      route_runway_exhausted: 0,
      stripe_retrieve_failed: 0,
      stripe_update_failed: 0,
      stripe_update_result_invalid: 0,
    },
    hasMoreCandidates: false,
    localWindowsReconciled: 0,
    mode: "dry-run",
    nextContinuationToken: null,
    providerTrialsCleanedUp: 0,
    providerTrialsRecovered: 0,
    skipped: {
      local_candidate_changed: 0,
      local_trial_window_invalid: 0,
      missing_stripe_refs: 0,
      outside_campaign_cohort: 0,
      provider_recovery_not_found: 0,
      provider_trial_ended: 0,
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
    wouldCleanupProviderTrial: 0,
    wouldRecoverProviderTrial: 0,
    wouldReconcile: 0,
    ...overrides,
  };
}
