import assert from "node:assert/strict";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  applyHostedPulseTrialExtension: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  previewHostedPulseTrialExtension: vi.fn(),
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
    applyHostedPulseTrialExtension: mocks.applyHostedPulseTrialExtension,
    previewHostedPulseTrialExtension: mocks.previewHostedPulseTrialExtension,
  };
});

import {
  HostedPulseTrialExtensionLockBusyError,
  HostedPulseTrialExtensionPreviewStaleError,
  HostedPulseTrialExtensionProviderError,
  type HostedPulseTrialExtensionPreviewProof,
  type HostedPulseTrialExtensionResult,
} from "@/src/lib/hosted-ops/pulse-trial-extension";

type RouteModule = typeof import("../app/api/ops/pulse-trial-extension/route");

const NOW = new Date("2026-07-14T16:00:00.000Z");
const OPERATOR_MEMBER_ID = "member_operator";
const TARGET_MEMBER_ID = "hbm_target_1";
const PREVIEW_PROOF: HostedPulseTrialExtensionPreviewProof = {
  previewedAt: NOW.toISOString(),
  targetTrialEndsAt: "2026-07-21T16:00:00.000Z",
  token: `pulse-member-preview-v1.v1.${"a".repeat(43)}`,
};

let route: RouteModule;
let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
const originalOpsMemberIds = process.env.HOSTED_OPS_MEMBER_IDS;

describe("hosted ops member Pulse Trial extension route", () => {
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
    mocks.previewHostedPulseTrialExtension.mockResolvedValue(makeResult());
    mocks.applyHostedPulseTrialExtension.mockResolvedValue(
      makeResult({ outcome: "extended", previewProof: null }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleInfoSpy.mockRestore();
    if (originalOpsMemberIds === undefined) {
      delete process.env.HOSTED_OPS_MEMBER_IDS;
    } else {
      process.env.HOSTED_OPS_MEMBER_IDS = originalOpsMemberIds;
    }
  });

  test("hides the route from members outside the ops allowlist", async () => {
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_other" },
    });

    const response = await route.POST(makeRequest({
      memberId: TARGET_MEMBER_ID,
      mode: "preview",
    }));

    assert.equal(response.status, 404);
    expect(mocks.previewHostedPulseTrialExtension).not.toHaveBeenCalled();
  });

  test("previews exactly one trimmed member", async () => {
    const response = await route.POST(makeRequest({
      memberId: `  ${TARGET_MEMBER_ID}  `,
    }));

    assert.equal(response.status, 200);
    assert.equal(route.maxDuration, 220);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledTimes(1);
    expect(mocks.previewHostedPulseTrialExtension).toHaveBeenCalledWith({
      memberId: TARGET_MEMBER_ID,
    });
    expect(mocks.applyHostedPulseTrialExtension).not.toHaveBeenCalled();
    assert.equal(consoleInfoSpy.mock.calls.length, 0);
  });

  test.each([
    ["missing", undefined],
    ["blank", "   "],
    ["wrong prefix", "member_target"],
    ["object", { id: TARGET_MEMBER_ID }],
  ])("rejects an invalid %s member ID", async (_label, memberId) => {
    const response = await route.POST(makeRequest({ memberId }));

    assert.equal(response.status, 400);
    expect(mocks.previewHostedPulseTrialExtension).not.toHaveBeenCalled();
    expect(mocks.applyHostedPulseTrialExtension).not.toHaveBeenCalled();
  });

  test("applies only the supplied member-scoped preview proof", async () => {
    const response = await route.POST(makeRequest({
      memberId: TARGET_MEMBER_ID,
      mode: "apply",
      previewProof: PREVIEW_PROOF,
    }));

    assert.equal(response.status, 200);
    expect(mocks.applyHostedPulseTrialExtension).toHaveBeenCalledWith({
      memberId: TARGET_MEMBER_ID,
      previewProof: PREVIEW_PROOF,
    });
    expect(mocks.previewHostedPulseTrialExtension).not.toHaveBeenCalled();
    assert.deepEqual(consoleInfoSpy.mock.calls[0]?.[1], {
      outcome: "extended",
      timestamp: NOW.toISOString(),
    });
  });

  test("rejects Apply without a complete Preview proof", async () => {
    const response = await route.POST(makeRequest({
      memberId: TARGET_MEMBER_ID,
      mode: "apply",
    }));

    assert.equal(response.status, 400);
    expect(mocks.applyHostedPulseTrialExtension).not.toHaveBeenCalled();
  });

  test("maps stale, busy, and unavailable results without widening scope", async () => {
    mocks.applyHostedPulseTrialExtension
      .mockRejectedValueOnce(new HostedPulseTrialExtensionPreviewStaleError())
      .mockRejectedValueOnce(new HostedPulseTrialExtensionLockBusyError())
      .mockRejectedValueOnce(new HostedPulseTrialExtensionProviderError());

    const stale = await route.POST(makeRequest({
      memberId: TARGET_MEMBER_ID,
      mode: "apply",
      previewProof: PREVIEW_PROOF,
    }));
    const busy = await route.POST(makeRequest({
      memberId: TARGET_MEMBER_ID,
      mode: "apply",
      previewProof: PREVIEW_PROOF,
    }));
    const unavailable = await route.POST(makeRequest({
      memberId: TARGET_MEMBER_ID,
      mode: "apply",
      previewProof: PREVIEW_PROOF,
    }));

    assert.equal(stale.status, 409);
    assert.equal(busy.status, 409);
    assert.equal(unavailable.status, 502);
    expect(mocks.applyHostedPulseTrialExtension).toHaveBeenCalledTimes(3);
  });

  test("rejects retired campaign and batch modes", async () => {
    for (const mode of ["dry-run", "campaign", "all"]) {
      const response = await route.POST(makeRequest({
        memberId: TARGET_MEMBER_ID,
        mode,
      }));
      assert.equal(response.status, 400);
    }
    expect(mocks.previewHostedPulseTrialExtension).not.toHaveBeenCalled();
  });
});

function makeResult(
  overrides: Partial<HostedPulseTrialExtensionResult> = {},
): HostedPulseTrialExtensionResult {
  return {
    currentTrialEndsAt: "2026-07-12T16:00:00.000Z",
    eligibilityCode: "eligible",
    eligible: true,
    extensionDays: 7,
    localBillingPhase: null,
    localBillingStatus: "paused",
    memberId: TARGET_MEMBER_ID,
    message: "This lapsed Pulse Trial can be restored for seven days.",
    outcome: "preview",
    previewProof: PREVIEW_PROOF,
    providerStatus: "paused",
    targetTrialEndsAt: PREVIEW_PROOF.targetTrialEndsAt,
    ...overrides,
  };
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/ops/pulse-trial-extension", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    method: "POST",
  });
}
