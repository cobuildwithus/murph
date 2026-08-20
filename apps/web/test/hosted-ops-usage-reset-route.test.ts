import assert from "node:assert/strict";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  resetHostedOpsMemberUsage: vi.fn(),
  signalHostedRuntimeRecheckRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSessionFromRequest:
    mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin:
    mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-ops/member-usage", async () => {
  const actual = await vi.importActual<
    typeof import("@/src/lib/hosted-ops/member-usage")
  >("@/src/lib/hosted-ops/member-usage");
  return {
    ...actual,
    resetHostedOpsMemberUsage: mocks.resetHostedOpsMemberUsage,
  };
});

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedRuntimeRecheckRuntime:
    mocks.signalHostedRuntimeRecheckRuntime,
}));

import {
  HostedOpsMemberUsageResetNotFoundError,
  HostedOpsMemberUsageResetNoticeInFlightError,
  HostedOpsMemberUsageResetStaleError,
} from "@/src/lib/hosted-ops/member-usage";
import {
  HOSTED_POST_COMMIT_TIMEOUT_MS,
} from "@/src/lib/hosted-onboarding/bounded-post-commit";

type RouteModule = typeof import("../app/api/ops/usage-reset/route");

const NOW = new Date("2026-07-22T18:00:00.000Z");
const PERIOD_START = "2026-07-01T00:00:00.000Z";
const PERIOD_UPDATED_AT = "2026-07-22T17:30:00.000Z";
const OPERATOR_MEMBER_ID = "hbm_operator";
const TARGET_MEMBER_ID = "hbm_target";
const originalOpsMemberIds = process.env.HOSTED_OPS_MEMBER_IDS;
let route: RouteModule;
let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

describe("hosted ops usage reset route", () => {
  beforeAll(async () => {
    route = await import("../app/api/ops/usage-reset/route");
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
    mocks.resetHostedOpsMemberUsage.mockResolvedValue(makeResult());
    mocks.signalHostedRuntimeRecheckRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:hbm_target",
    });
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

  test("requires allowlisted same-origin access and applies the exact row version", async () => {
    const response = await route.POST(makeRequest());

    assert.equal(response.status, 200);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledTimes(1);
    expect(mocks.resetHostedOpsMemberUsage).toHaveBeenCalledWith({
      expectedPeriodUpdatedAt: new Date(PERIOD_UPDATED_AT),
      expectedUsageCreditLedgerVersion: 4n,
      memberId: TARGET_MEMBER_ID,
      periodStart: new Date(PERIOD_START),
    });
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      userId: TARGET_MEMBER_ID,
    });
    expect(
      mocks.resetHostedOpsMemberUsage.mock.invocationCallOrder[0],
    ).toBeLessThan(
      Number(mocks.signalHostedRuntimeRecheckRuntime.mock.invocationCallOrder[0]),
    );
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "Hosted ops usage reset completed.",
      {
        noticeClaimReleased: true,
        outcome: "reset",
        resetMode: "included_usage",
        runtimeRecheckStatus: "accepted",
        timestamp: NOW.toISOString(),
        usageCreditGrantedUsdMicros: "0",
      },
    );
    expect(JSON.stringify(consoleInfoSpy.mock.calls)).not.toContain(
      TARGET_MEMBER_ID,
    );
  });

  test("reports a committed reset as retryable when the runtime recheck fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.signalHostedRuntimeRecheckRuntime.mockRejectedValueOnce(
      new Error("Temporal unavailable"),
    );

    try {
      const response = await route.POST(makeRequest());

      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), {
        ...makeResult(),
        runtimeRecheckStatus: "pending",
      });
      expect(mocks.resetHostedOpsMemberUsage).toHaveBeenCalledTimes(1);
      expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Hosted ops runtime recheck failed.",
        {
          errorName: "Error",
          timestamp: NOW.toISOString(),
        },
      );
      expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain(
        TARGET_MEMBER_ID,
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  test("bounds a stalled post-commit wake and exposes wake-only recovery", async () => {
    mocks.signalHostedRuntimeRecheckRuntime.mockImplementationOnce(
      () => new Promise(() => {}),
    );

    const responsePromise = route.POST(makeRequest());
    await vi.waitFor(() => {
      expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledTimes(1);
    });
    await vi.advanceTimersByTimeAsync(HOSTED_POST_COMMIT_TIMEOUT_MS);
    const response = await responsePromise;

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      ...makeResult(),
      runtimeRecheckStatus: "pending",
    });
    expect(mocks.resetHostedOpsMemberUsage).toHaveBeenCalledTimes(1);
    const observedAbortSignal = mocks.signalHostedRuntimeRecheckRuntime
      .mock.calls[0]?.[0]?.abortSignal;
    expect(observedAbortSignal).toBeInstanceOf(AbortSignal);
    expect(observedAbortSignal.aborted).toBe(true);

    mocks.signalHostedRuntimeRecheckRuntime.mockResolvedValueOnce({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:hbm_target",
    });
    const retry = await route.POST(makeRuntimeRecheckRequest());

    assert.equal(retry.status, 200);
    expect(mocks.resetHostedOpsMemberUsage).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledTimes(2);
  });

  test("retries only the runtime wake after a committed reset", async () => {
    const response = await route.POST(makeRuntimeRecheckRequest());

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      memberId: TARGET_MEMBER_ID,
      runtimeRecheckStatus: "accepted",
    });
    expect(mocks.resetHostedOpsMemberUsage).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      userId: TARGET_MEMBER_ID,
    });
  });

  test("bounds a stalled wake-only retry without replaying the reset", async () => {
    mocks.signalHostedRuntimeRecheckRuntime.mockImplementationOnce(
      () => new Promise(() => {}),
    );

    const responsePromise = route.POST(makeRuntimeRecheckRequest());
    await vi.waitFor(() => {
      expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledTimes(1);
    });
    await vi.advanceTimersByTimeAsync(HOSTED_POST_COMMIT_TIMEOUT_MS);
    const response = await responsePromise;

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      memberId: TARGET_MEMBER_ID,
      runtimeRecheckStatus: "pending",
    });
    expect(mocks.resetHostedOpsMemberUsage).not.toHaveBeenCalled();
    const observedAbortSignal = mocks.signalHostedRuntimeRecheckRuntime
      .mock.calls[0]?.[0]?.abortSignal;
    expect(observedAbortSignal).toBeInstanceOf(AbortSignal);
    expect(observedAbortSignal.aborted).toBe(true);
  });

  test("hides the route from members outside the ops allowlist", async () => {
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "hbm_other" },
    });

    const response = await route.POST(makeRequest());

    assert.equal(response.status, 404);
    expect(mocks.resetHostedOpsMemberUsage).not.toHaveBeenCalled();
  });

  test.each([
    ["member", { memberId: "member_target" }],
    ["period", { periodStart: "July" }],
    ["updated timestamp", { expectedPeriodUpdatedAt: "now" }],
    ["ledger version", { expectedUsageCreditLedgerVersion: -1 }],
  ])("rejects an invalid %s field", async (_label, override) => {
    const response = await route.POST(makeRequest(override));

    assert.equal(response.status, 400);
    expect(mocks.resetHostedOpsMemberUsage).not.toHaveBeenCalled();
  });

  test("maps stale and in-flight resets to retryable-safe conflicts", async () => {
    mocks.resetHostedOpsMemberUsage
      .mockRejectedValueOnce(new HostedOpsMemberUsageResetStaleError())
      .mockRejectedValueOnce(new HostedOpsMemberUsageResetNoticeInFlightError(
        new Date(NOW.getTime() + 60_000),
      ));

    const stale = await route.POST(makeRequest());
    const inFlight = await route.POST(makeRequest());

    assert.equal(stale.status, 409);
    assert.equal(inFlight.status, 409);
    assert.deepEqual(await stale.json(), {
      error: {
        code: "HOSTED_OPS_USAGE_RESET_STALE",
        message:
          "Usage changed after this table loaded. Refresh and review the current row before resetting it.",
        retryable: false,
      },
    });
    assert.deepEqual(await inFlight.json(), {
      error: {
        code: "HOSTED_OPS_USAGE_RESET_NOTICE_IN_FLIGHT",
        details: {
          retryAt: "2026-07-22T18:01:00.000Z",
        },
        message:
          "A usage-limit notice is currently being sent. Retry after that dispatch settles.",
        retryable: true,
      },
    });
  });

  test("maps a removed member or period to a non-retryable not-found response", async () => {
    mocks.resetHostedOpsMemberUsage.mockRejectedValueOnce(
      new HostedOpsMemberUsageResetNotFoundError(),
    );

    const response = await route.POST(makeRequest());

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: {
        code: "HOSTED_OPS_USAGE_RESET_NOT_FOUND",
        message: "The hosted member or current usage period no longer exists.",
        retryable: false,
      },
    });
  });
});

function makeRequest(overrides: Record<string, unknown> = {}): Request {
  return new Request("http://localhost/api/ops/usage-reset", {
    body: JSON.stringify({
      expectedPeriodUpdatedAt: PERIOD_UPDATED_AT,
      expectedUsageCreditLedgerVersion: "4",
      memberId: TARGET_MEMBER_ID,
      periodStart: PERIOD_START,
      ...overrides,
    }),
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    method: "POST",
  });
}

function makeRuntimeRecheckRequest(): Request {
  return new Request("http://localhost/api/ops/usage-reset", {
    body: JSON.stringify({
      memberId: TARGET_MEMBER_ID,
      operation: "runtime_recheck",
    }),
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    method: "POST",
  });
}

function makeResult() {
  return {
    memberId: TARGET_MEMBER_ID,
    noticeClaimReleased: true,
    outcome: "reset",
    periodStart: PERIOD_START,
    previousSpentUsdMicros: "4522964",
    resetAt: NOW.toISOString(),
    resetMode: "included_usage",
    updatedAt: NOW.toISOString(),
    usageCreditGrantedUsdMicros: "0",
  };
}
