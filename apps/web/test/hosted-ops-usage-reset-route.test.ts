import assert from "node:assert/strict";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  readHostedOpsMemberUsageResetAllBatch: vi.fn(),
  readHostedOpsMemberUsageResetAllWakeBatch: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  resetHostedOpsMemberUsage: vi.fn(),
  resetHostedOpsMemberUsageForResetAll: vi.fn(),
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
    readHostedOpsMemberUsageResetAllBatch:
      mocks.readHostedOpsMemberUsageResetAllBatch,
    readHostedOpsMemberUsageResetAllWakeBatch:
      mocks.readHostedOpsMemberUsageResetAllWakeBatch,
    resetHostedOpsMemberUsage: mocks.resetHostedOpsMemberUsage,
    resetHostedOpsMemberUsageForResetAll:
      mocks.resetHostedOpsMemberUsageForResetAll,
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
  HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION,
} from "@/src/lib/hosted-ops/member-usage-contract";
import {
  HOSTED_POST_COMMIT_TIMEOUT_MS,
} from "@/src/lib/hosted-onboarding/bounded-post-commit";

type RouteModule = typeof import("../app/api/ops/usage-reset/route");

const NOW = new Date("2026-07-22T18:00:00.000Z");
const PERIOD_START = "2026-07-01T00:00:00.000Z";
const PERIOD_UPDATED_AT = "2026-07-22T17:30:00.000Z";
const OPERATOR_MEMBER_ID = "hbm_operator";
const TARGET_MEMBER_ID = "hbm_target";
const RESET_ALL_OPERATION_ID = "12345678-1234-4abc-8def-1234567890ab";
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
    mocks.readHostedOpsMemberUsageResetAllBatch.mockResolvedValue({
      hasMore: false,
      memberIds: [],
    });
    mocks.readHostedOpsMemberUsageResetAllWakeBatch.mockResolvedValue({
      hasMore: false,
      receipts: [],
    });
    mocks.resetHostedOpsMemberUsage.mockResolvedValue(makeResult());
    mocks.resetHostedOpsMemberUsageForResetAll.mockImplementation(
      async ({ memberId }: { memberId: string }) => ({
        memberId,
        outcome: "unchanged",
        resetMode: "included_usage",
        runtimeRecheckRequired: true,
        timestamp: NOW.toISOString(),
      }),
    );
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

  test("requires the exact destructive confirmation before reading a reset-everyone batch", async () => {
    const response = await route.POST(makeResetAllRequest({
      confirmation: "reset everyone",
    }));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: {
        code: "HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION_INVALID",
        message: `Type ${HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION} to continue.`,
        retryable: false,
      },
    });
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedOpsMemberUsageResetAllBatch).not.toHaveBeenCalled();
    expect(mocks.resetHostedOpsMemberUsageForResetAll).not.toHaveBeenCalled();
  });

  test("requires a valid operation UUID before reading a reset-everyone batch", async () => {
    const response = await route.POST(makeResetAllRequest({
      operationId: "not-a-uuid",
    }));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: {
        code: "HOSTED_OPS_USAGE_RESET_ALL_OPERATION_ID_INVALID",
        message: "Restart Reset everyone from the confirmation dialog.",
        retryable: false,
      },
    });
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedOpsMemberUsageResetAllBatch).not.toHaveBeenCalled();
    expect(mocks.resetHostedOpsMemberUsageForResetAll).not.toHaveBeenCalled();
  });

  test("processes reset-everyone members sequentially and rechecks only after each commit", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.readHostedOpsMemberUsageResetAllBatch.mockResolvedValueOnce({
      hasMore: false,
      memberIds: ["hbm_reset_001", "hbm_reset_002"],
    });
    mocks.resetHostedOpsMemberUsageForResetAll
      .mockResolvedValueOnce({
        memberId: "hbm_reset_001",
        outcome: "reset",
        resetMode: "starter_allowance",
        runtimeRecheckRequired: true,
        timestamp: NOW.toISOString(),
      })
      .mockResolvedValueOnce({
        memberId: "hbm_reset_002",
        outcome: "unchanged",
        resetMode: "included_usage",
        runtimeRecheckRequired: true,
        timestamp: NOW.toISOString(),
      });
    mocks.signalHostedRuntimeRecheckRuntime
      .mockResolvedValueOnce({
        signalAccepted: true,
        workflowId: "hosted-user-runtime:hbm_reset_001",
      })
      .mockRejectedValueOnce(new Error("Temporal unavailable"));

    try {
      const response = await route.POST(makeResetAllRequest());

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        counts: {
          failed: 0,
          pendingWake: 1,
          processed: 2,
          reset: 1,
          skipped: 0,
          unchanged: 1,
        },
        done: true,
        failure: null,
        lastAcknowledgedCursor: "hbm_reset_002",
      });
      const resetCallOrder = mocks.resetHostedOpsMemberUsageForResetAll
        .mock.invocationCallOrder;
      const wakeCallOrder = mocks.signalHostedRuntimeRecheckRuntime
        .mock.invocationCallOrder;
      expect(resetCallOrder[0]).toBeLessThan(Number(wakeCallOrder[0]));
      expect(wakeCallOrder[0]).toBeLessThan(Number(resetCallOrder[1]));
      expect(resetCallOrder[1]).toBeLessThan(Number(wakeCallOrder[1]));
      expect(mocks.resetHostedOpsMemberUsageForResetAll)
        .toHaveBeenNthCalledWith(1, {
          memberId: "hbm_reset_001",
          operationId: RESET_ALL_OPERATION_ID,
        });
      expect(mocks.resetHostedOpsMemberUsageForResetAll)
        .toHaveBeenNthCalledWith(2, {
          memberId: "hbm_reset_002",
          operationId: RESET_ALL_OPERATION_ID,
        });
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        "Hosted ops reset-everyone batch completed.",
        {
          counts: {
            failed: 0,
            pendingWake: 1,
            processed: 2,
            reset: 1,
            skipped: 0,
            unchanged: 1,
          },
          done: true,
          stoppedOnFailure: false,
        },
      );
      expect(JSON.stringify(consoleInfoSpy.mock.calls)).not.toContain(
        "hbm_reset_001",
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  test("acknowledges a stable no-period skip and advances to the next member", async () => {
    mocks.readHostedOpsMemberUsageResetAllBatch.mockResolvedValueOnce({
      hasMore: false,
      memberIds: ["hbm_reset_001", "hbm_reset_002"],
    });
    mocks.resetHostedOpsMemberUsageForResetAll
      .mockResolvedValueOnce({
        memberId: "hbm_reset_001",
        outcome: "skipped",
        resetMode: null,
        runtimeRecheckRequired: false,
        timestamp: NOW.toISOString(),
      })
      .mockResolvedValueOnce({
        memberId: "hbm_reset_002",
        outcome: "reset",
        resetMode: "included_usage",
        runtimeRecheckRequired: false,
        timestamp: NOW.toISOString(),
      });

    const response = await route.POST(makeResetAllRequest());

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      counts: {
        failed: 0,
        pendingWake: 0,
        processed: 2,
        reset: 1,
        skipped: 1,
        unchanged: 0,
      },
      done: true,
      failure: null,
      lastAcknowledgedCursor: "hbm_reset_002",
    });
    expect(mocks.resetHostedOpsMemberUsageForResetAll)
      .toHaveBeenNthCalledWith(2, {
        memberId: "hbm_reset_002",
        operationId: RESET_ALL_OPERATION_ID,
      });
    expect(mocks.signalHostedRuntimeRecheckRuntime).not.toHaveBeenCalled();
  });

  test("recovers only wake-required receipts without re-entering reset transactions", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.readHostedOpsMemberUsageResetAllWakeBatch.mockResolvedValueOnce({
      hasMore: false,
      receipts: [
        {
          memberId: "hbm_reset_001",
          timestamp: NOW.toISOString(),
        },
        {
          memberId: "hbm_reset_002",
          timestamp: NOW.toISOString(),
        },
      ],
    });
    mocks.signalHostedRuntimeRecheckRuntime
      .mockResolvedValueOnce({
        signalAccepted: true,
        workflowId: "hosted-user-runtime:hbm_reset_001",
      })
      .mockRejectedValueOnce(new Error("Temporal unavailable"));

    try {
      const response = await route.POST(makeWakeRecoveryRequest({
        afterMemberId: "hbm_reset_000",
      }));

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        attempted: 2,
        done: true,
        lastAcknowledgedCursor: "hbm_reset_002",
        pendingWake: 1,
      });
      expect(mocks.readHostedOpsMemberUsageResetAllWakeBatch)
        .toHaveBeenCalledWith({
          afterMemberId: "hbm_reset_000",
          operationId: RESET_ALL_OPERATION_ID,
        });
      expect(mocks.readHostedOpsMemberUsageResetAllBatch).not.toHaveBeenCalled();
      expect(mocks.resetHostedOpsMemberUsageForResetAll).not.toHaveBeenCalled();
      expect(mocks.resetHostedOpsMemberUsage).not.toHaveBeenCalled();
      expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledTimes(2);
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        "Hosted ops reset-everyone wake batch completed.",
        {
          attempted: 2,
          done: true,
          pendingWake: 1,
        },
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  test("stops at a failed member and returns the last acknowledged cursor", async () => {
    mocks.readHostedOpsMemberUsageResetAllBatch.mockResolvedValueOnce({
      hasMore: true,
      memberIds: ["hbm_reset_001", "hbm_reset_002", "hbm_reset_003"],
    });
    mocks.resetHostedOpsMemberUsageForResetAll
      .mockResolvedValueOnce({
        memberId: "hbm_reset_001",
        outcome: "reset",
        resetMode: "included_usage",
        runtimeRecheckRequired: false,
        timestamp: NOW.toISOString(),
      })
      .mockRejectedValueOnce(new HostedOpsMemberUsageResetNoticeInFlightError(
        new Date(NOW.getTime() + 60_000),
      ));

    const response = await route.POST(makeResetAllRequest());

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      counts: {
        failed: 1,
        pendingWake: 0,
        processed: 1,
        reset: 1,
        skipped: 0,
        unchanged: 0,
      },
      done: false,
      failure: {
        code: "HOSTED_OPS_USAGE_RESET_NOTICE_IN_FLIGHT",
        memberId: "hbm_reset_002",
        message:
          "A usage-limit notice is currently being sent. Retry from the last acknowledged member after that dispatch settles.",
        retryable: true,
      },
      lastAcknowledgedCursor: "hbm_reset_001",
    });
    expect(mocks.resetHostedOpsMemberUsageForResetAll).toHaveBeenCalledTimes(2);
    expect(mocks.resetHostedOpsMemberUsageForResetAll)
      .not.toHaveBeenCalledWith(expect.objectContaining({
        memberId: "hbm_reset_003",
      }));
    expect(mocks.signalHostedRuntimeRecheckRuntime).not.toHaveBeenCalled();
  });

  test("continues a reset-everyone walk strictly after the acknowledged cursor", async () => {
    const response = await route.POST(makeResetAllRequest({
      afterMemberId: "hbm_reset_010",
    }));

    assert.equal(response.status, 200);
    expect(mocks.readHostedOpsMemberUsageResetAllBatch).toHaveBeenCalledWith({
      afterMemberId: "hbm_reset_010",
    });
    assert.deepEqual(await response.json(), {
      counts: {
        failed: 0,
        pendingWake: 0,
        processed: 0,
        reset: 0,
        skipped: 0,
        unchanged: 0,
      },
      done: true,
      failure: null,
      lastAcknowledgedCursor: "hbm_reset_010",
    });
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

function makeResetAllRequest(
  overrides: Record<string, unknown> = {},
): Request {
  return new Request("http://localhost/api/ops/usage-reset", {
    body: JSON.stringify({
      afterMemberId: null,
      confirmation: HOSTED_OPS_USAGE_RESET_ALL_CONFIRMATION,
      operation: "reset_all_batch",
      operationId: RESET_ALL_OPERATION_ID,
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

function makeWakeRecoveryRequest(
  overrides: Record<string, unknown> = {},
): Request {
  return makeResetAllRequest({
    operation: "recover_reset_all_wakes",
    ...overrides,
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
