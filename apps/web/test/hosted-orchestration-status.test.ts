import {
  HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
} from "@murphai/hosted-execution/orchestration-control";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const MEMBER_ID = "member_status_1";
const OTHER_MEMBER_ID = "member_status_2";
const UNSAFE_SENTINEL = "UNSAFE_STATUS_SENTINEL";

const mocks = vi.hoisted(() => ({
  getHandle: vi.fn(),
  getRunnerStatus: vi.fn(),
  queryWorkflowStatus: vi.fn(),
  readHostedExecutionControlClientIfConfigured: vi.fn(),
  readHostedRuntimeDemand: vi.fn(),
  readHostedRuntimeTemporalSignalClientIfConfigured: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured:
    mocks.readHostedExecutionControlClientIfConfigured,
}));

vi.mock("@/src/lib/hosted-orchestration/runtime-demand", () => ({
  readHostedRuntimeDemand: mocks.readHostedRuntimeDemand,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  hostedUserRuntimeWorkflowId: (userId: string) => `hosted-user-runtime:${userId}`,
}));

vi.mock("@/src/lib/hosted-orchestration/temporal-client", () => ({
  readHostedRuntimeTemporalSignalClientIfConfigured:
    mocks.readHostedRuntimeTemporalSignalClientIfConfigured,
}));

type StatusRoute = typeof import(
  "../app/api/internal/hosted-orchestration/users/[userId]/status/route"
);

let statusRoute: StatusRoute;

describe("hosted orchestration status route", () => {
  beforeAll(async () => {
    statusRoute = await import(
      "../app/api/internal/hosted-orchestration/users/[userId]/status/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue(MEMBER_ID);
    mocks.queryWorkflowStatus.mockResolvedValue(buildWorkflowStatus());
    mocks.getHandle.mockReturnValue({
      query: mocks.queryWorkflowStatus,
    });
    mocks.readHostedRuntimeTemporalSignalClientIfConfigured.mockResolvedValue({
      workflow: {
        getHandle: mocks.getHandle,
      },
    });
    mocks.getRunnerStatus.mockResolvedValue(buildRunnerStatus());
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      getRunnerStatus: mocks.getRunnerStatus,
    });
    mocks.readHostedRuntimeDemand.mockResolvedValue(buildDemand());
  });

  it("composes workflow query state, current demand, and Cloudflare runner status", async () => {
    const response = await statusRoute.GET(
      requestForStatus(),
      routeContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getHandle).toHaveBeenCalledWith(
      "hosted-user-runtime:member_status_1",
    );
    expect(mocks.queryWorkflowStatus).toHaveBeenCalledWith(
      HOSTED_USER_RUNTIME_STATUS_QUERY_NAME,
    );
    expect(mocks.readHostedRuntimeDemand).toHaveBeenCalledWith({
      browserVaultRefreshRequested: false,
      deviceSyncRecoveryRequested: true,
      ignoredWorkspaceWakeKey: "8:2026-05-21T12:05:00.000Z:assistant_due",
      lagRecoveryObserved: true,
      manualRunRequested: true,
      runtimeResultWakeAt: "2026-05-21T12:01:00.000Z",
      runtimeResultWakeReason: "runtime.failed",
      usageGateMode: "read_only",
      userId: MEMBER_ID,
    });
    expect(mocks.getRunnerStatus).toHaveBeenCalledWith(MEMBER_ID);
    expect(body).toEqual({
      cloudflare: {
        runnerStatus: buildRunnerStatus(),
      },
      demand: {
        current: buildDemand(),
      },
      temporal: {
        status: buildWorkflowStatusProjection(),
        workflowId: "hosted-user-runtime:member_status_1",
      },
      userId: MEMBER_ID,
    });
    expect(body.temporal.status.latestMailboxPointer).toBeUndefined();
    expect(body.temporal.status.latestMailboxPointerPresent).toBe(true);
    expect(JSON.stringify(body)).not.toContain("mailbox_status_1");
    expect(JSON.stringify(body)).not.toContain(UNSAFE_SENTINEL);
    expect(JSON.stringify(body)).not.toMatch(/payload|body|prompt|transcript/u);
  });

  it("returns nullable subsections when Temporal and Cloudflare status are unavailable", async () => {
    mocks.readHostedRuntimeTemporalSignalClientIfConfigured.mockResolvedValue(null);
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue(null);

    const response = await statusRoute.GET(
      requestForStatus(),
      routeContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      cloudflare: {
        runnerStatus: null,
      },
      temporal: {
        status: null,
        workflowId: "hosted-user-runtime:member_status_1",
      },
      userId: MEMBER_ID,
    });
    expect(mocks.readHostedRuntimeDemand).toHaveBeenCalledWith({
      browserVaultRefreshRequested: false,
      deviceSyncRecoveryRequested: false,
      ignoredWorkspaceWakeKey: null,
      lagRecoveryObserved: false,
      manualRunRequested: false,
      runtimeResultWakeAt: null,
      runtimeResultWakeReason: null,
      usageGateMode: "read_only",
      userId: MEMBER_ID,
    });
    expect(mocks.getRunnerStatus).not.toHaveBeenCalled();
  });

  it("treats dependency errors as unavailable without failing the status route", async () => {
    mocks.queryWorkflowStatus.mockRejectedValue(new Error("Temporal unavailable"));
    mocks.getRunnerStatus.mockRejectedValue(new Error("Runner unavailable"));

    const response = await statusRoute.GET(
      requestForStatus(),
      routeContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      cloudflare: {
        runnerStatus: null,
      },
      temporal: {
        status: null,
      },
    });
    expect(mocks.readHostedRuntimeDemand).toHaveBeenCalledWith(expect.objectContaining({
      manualRunRequested: false,
      usageGateMode: "read_only",
      userId: MEMBER_ID,
    }));
  });

  it("treats workflow status for another user as unavailable", async () => {
    mocks.queryWorkflowStatus.mockResolvedValue({
      ...buildWorkflowStatus(),
      userId: OTHER_MEMBER_ID,
    });

    const response = await statusRoute.GET(
      requestForStatus(),
      routeContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.temporal).toEqual({
      status: null,
      workflowId: "hosted-user-runtime:member_status_1",
    });
    expect(mocks.readHostedRuntimeDemand).toHaveBeenCalledWith({
      browserVaultRefreshRequested: false,
      deviceSyncRecoveryRequested: false,
      ignoredWorkspaceWakeKey: null,
      lagRecoveryObserved: false,
      manualRunRequested: false,
      runtimeResultWakeAt: null,
      runtimeResultWakeReason: null,
      usageGateMode: "read_only",
      userId: MEMBER_ID,
    });
  });

  it("rejects status reads for a different authenticated hosted user", async () => {
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue(OTHER_MEMBER_ID);

    const response = await statusRoute.GET(
      requestForStatus(),
      routeContext(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_ORCHESTRATION_USER_MISMATCH",
        message: "Hosted orchestration request is not authorized for this user.",
      },
    });
    expect(mocks.readHostedRuntimeDemand).not.toHaveBeenCalled();
    expect(mocks.getRunnerStatus).not.toHaveBeenCalled();
    expect(mocks.queryWorkflowStatus).not.toHaveBeenCalled();
  });
});

function requestForStatus(): Request {
  return new Request(
    `https://join.example.test/api/internal/hosted-orchestration/users/${
      encodeURIComponent(MEMBER_ID)
    }/status`,
    { method: "GET" },
  );
}

function routeContext(): { params: Promise<{ userId: string }> } {
  return {
    params: Promise.resolve({
      userId: MEMBER_ID,
    }),
  };
}

function buildDemand() {
  return {
    kind: "run",
    mailboxLag: [
      {
        importedSeq: "5",
        lag: "1",
        lane: "conversation",
        maxSeq: "6",
      },
    ],
    reason: "manual",
    source: "manual",
    workspace: {
      nextWakeAt: "2026-05-21T12:05:00.000Z",
      nextWakeReason: "assistant_due",
      version: "8",
    },
  };
}

function buildRunnerStatus() {
  return {
    heartbeatAt: "2026-05-21T12:00:00.000Z",
    inFlight: true,
    lastErrorAt: null,
    lastErrorCode: null,
    lastInvocationAt: "2026-05-21T11:59:30.000Z",
    mailboxLag: [],
    nextAlarmAt: "2026-05-21T12:04:00.000Z",
    recentLogs: [],
    userId: MEMBER_ID,
    workspace: null,
  };
}

function buildWorkflowStatus() {
  return {
    browserVaultRefreshRequested: false,
    currentWaitReason: "runtime_failed_recheck",
    currentWaitUntil: "2026-05-21T12:01:00.000Z",
    deviceSyncRecoveryRequested: true,
    ignoredWorkspaceWakeKey: "8:2026-05-21T12:05:00.000Z:assistant_due",
    invalidSignalCount: 0,
    lagRecoveryObserved: true,
    lastDemandKind: "run",
    lastDemandNextWakeAt: null,
    lastDemandSource: "manual",
    lastExecutionAt: "2026-05-21T11:59:45.000Z",
    lastExecutionErrorCode: null,
    lastExecutionKind: "runtime_completed",
    lastInvalidSignalErrorCode: null,
    lastMailboxLagLaneCount: 1,
    lastOrchestrationAttemptId: "orchestration_attempt_1",
    lastRuntimeAttemptId: "runtime_attempt_1",
    lastRuntimeStatus: "failed",
    latestMailboxPointer: {
      lane: "conversation",
      laneSeq: "6",
      mailboxItemId: "mailbox_status_1",
      source: "email",
    },
    mailboxSignalCount: 2,
    manualRunRequested: true,
    runtimeFailedWithoutNextWakeCount: 1,
    runtimeResultWakeAt: "2026-05-21T12:01:00.000Z",
    runtimeResultWakeReason: "runtime.failed",
    sameRuntimeWakeSentCount: 0,
    signalVersion: 4,
    userId: MEMBER_ID,
  };
}

function buildWorkflowStatusProjection() {
  const {
    latestMailboxPointer,
    ...status
  } = buildWorkflowStatus();

  return {
    ...status,
    latestMailboxPointerPresent: latestMailboxPointer !== null,
  };
}
