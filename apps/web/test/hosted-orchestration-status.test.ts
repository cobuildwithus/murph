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
      decisionSource: "status",
      lagRecoveryObserved: true,
      manualRunRequested: true,
      usageGateMode: "read_only",
      userId: MEMBER_ID,
    });
    expect(mocks.getRunnerStatus).toHaveBeenCalledWith(MEMBER_ID);
    expect(body).toEqual({
      cloudflare: {
        runnerStatus: buildRunnerStatusProjection(),
        unavailableReason: null,
      },
      demand: {
        current: buildDemand(),
      },
      temporal: {
        status: buildWorkflowStatusProjection(),
        unavailableReason: null,
        workflowId: "hosted-user-runtime:member_status_1",
      },
      userId: MEMBER_ID,
    });
    expect(body.temporal.status.latestMailboxPointer).toBeUndefined();
    expect(body.temporal.status.latestMailboxPointerPresent).toBe(true);
    expect(body.cloudflare.runnerStatus.userId).toBeUndefined();
    expect(body.cloudflare.runnerStatus.recentLogs).toBeUndefined();
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
        unavailableReason: "not_configured",
      },
      temporal: {
        status: null,
        unavailableReason: "not_configured",
        workflowId: "hosted-user-runtime:member_status_1",
      },
      userId: MEMBER_ID,
    });
    expect(mocks.readHostedRuntimeDemand).toHaveBeenCalledWith({
      browserVaultRefreshRequested: false,
      decisionSource: "status",
      lagRecoveryObserved: false,
      manualRunRequested: false,
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
        unavailableReason: "request_failed",
      },
      temporal: {
        status: null,
        unavailableReason: "query_failed",
      },
    });
    expect(mocks.readHostedRuntimeDemand).toHaveBeenCalledWith(expect.objectContaining({
      manualRunRequested: false,
      usageGateMode: "read_only",
      userId: MEMBER_ID,
    }));
  });

  it("classifies workflow not found separately from query failures", async () => {
    const error = new Error("workflow not found");
    error.name = "WorkflowNotFoundError";
    mocks.queryWorkflowStatus.mockRejectedValue(error);

    const response = await statusRoute.GET(
      requestForStatus(),
      routeContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.temporal).toMatchObject({
      status: null,
      unavailableReason: "not_found",
      workflowId: "hosted-user-runtime:member_status_1",
    });
  });

  it("classifies configured Temporal client creation failures as query failures", async () => {
    mocks.readHostedRuntimeTemporalSignalClientIfConfigured.mockRejectedValue(
      new Error("Temporal connection failed"),
    );

    const response = await statusRoute.GET(
      requestForStatus(),
      routeContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.temporal).toMatchObject({
      status: null,
      unavailableReason: "query_failed",
      workflowId: "hosted-user-runtime:member_status_1",
    });
  });

  it("keeps old workflow status query shapes visible during deploy skew", async () => {
    const oldStatus: Record<string, unknown> = { ...buildWorkflowStatus() };
    delete oldStatus.currentWaitReason;
    delete oldStatus.currentWaitUntil;
    delete oldStatus.lastOrchestrationAttemptId;
    delete oldStatus.lastRuntimeAttemptId;
    delete oldStatus.lastRuntimeStatus;
    delete oldStatus.latestPrewarmRequestedAt;
    delete oldStatus.lastPrewarmAttemptId;
    delete oldStatus.lastPrewarmErrorCode;
    delete oldStatus.lastPrewarmResult;
    delete oldStatus.prewarmRequested;
    delete oldStatus.prewarmSignalCount;
    mocks.queryWorkflowStatus.mockResolvedValue(oldStatus);

    const response = await statusRoute.GET(
      requestForStatus(),
      routeContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.temporal.unavailableReason).toBeNull();
    expect(body.temporal.status).toMatchObject({
      currentWaitReason: null,
      currentWaitUntil: null,
      lastOrchestrationAttemptId: null,
      lastPrewarmAttemptId: null,
      lastPrewarmErrorCode: null,
      lastPrewarmResult: null,
      lastRuntimeAttemptId: null,
      lastRuntimeStatus: null,
      latestPrewarmRequestedAt: null,
      prewarmRequested: false,
      prewarmSignalCount: 0,
    });
  });

  it("keeps core workflow flags visible when observability enums are newer than web", async () => {
    mocks.queryWorkflowStatus.mockResolvedValue({
      ...buildWorkflowStatus(),
      currentWaitReason: "future_wait_reason",
      lastDemandKind: "future_demand",
      lastExecutionKind: "future_execution",
      lastRuntimeStatus: "future_runtime_status",
      latestMailboxPointer: {
        lane: "future_lane",
      },
    });

    const response = await statusRoute.GET(
      requestForStatus(),
      routeContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.temporal.unavailableReason).toBeNull();
    expect(body.temporal.status).toMatchObject({
      currentWaitReason: null,
      lastDemandKind: null,
      lastExecutionKind: null,
      lastRuntimeStatus: null,
      latestMailboxPointerPresent: false,
      manualRunRequested: true,
      signalVersion: 4,
    });
    expect(mocks.readHostedRuntimeDemand).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionSource: "status",
        manualRunRequested: true,
        userId: MEMBER_ID,
      }),
    );
  });

  it("reports invalid status payloads without collapsing them into absent state", async () => {
    mocks.queryWorkflowStatus.mockResolvedValue({
      ...buildWorkflowStatus(),
      signalVersion: "invalid",
    });
    mocks.getRunnerStatus.mockRejectedValue(
      new TypeError("Hosted runner status response userId must be a non-empty string."),
    );

    const response = await statusRoute.GET(
      requestForStatus(),
      routeContext(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      cloudflare: {
        runnerStatus: null,
        unavailableReason: "status_invalid",
      },
      temporal: {
        status: null,
        unavailableReason: "status_invalid",
      },
    });
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
      unavailableReason: "user_mismatch",
      workflowId: "hosted-user-runtime:member_status_1",
    });
    expect(mocks.readHostedRuntimeDemand).toHaveBeenCalledWith({
      browserVaultRefreshRequested: false,
      decisionSource: "status",
      lagRecoveryObserved: false,
      manualRunRequested: false,
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
    recentLogs: [
      {
        at: "2026-05-21T11:59:30.000Z",
        component: "runner",
        eventCode: "runner.started",
        level: "info",
        phase: "invoke",
      },
    ],
    userId: MEMBER_ID,
    workspace: {
      createdAt: "2026-05-21T11:00:00.000Z",
      nextWakeAt: "2026-05-21T12:05:00.000Z",
      nextWakeReason: "assistant_due",
      redactedStatus: {
        unsafeSentinel: UNSAFE_SENTINEL,
      },
      snapshotRef: {
        key: `${UNSAFE_SENTINEL}/snapshot.enc`,
        version: "snapshot_version",
      },
      updatedAt: "2026-05-21T11:59:00.000Z",
      userId: MEMBER_ID,
      version: "8",
    },
  };
}

function buildRunnerStatusProjection() {
  return {
    heartbeatAt: "2026-05-21T12:00:00.000Z",
    inFlight: true,
    lastErrorAt: null,
    lastErrorCode: null,
    lastInvocationAt: "2026-05-21T11:59:30.000Z",
    mailboxLag: [],
    nextAlarmAt: "2026-05-21T12:04:00.000Z",
    recentLogCount: 1,
    userIdPresent: true,
    workspace: {
      browserVaultReplicaRefPresent: false,
      createdAt: "2026-05-21T11:00:00.000Z",
      nextWakeAt: "2026-05-21T12:05:00.000Z",
      nextWakeReason: "assistant_due",
      redactedStatusPresent: true,
      snapshotRefPresent: true,
      updatedAt: "2026-05-21T11:59:00.000Z",
      userIdPresent: true,
      version: "8",
    },
  };
}

function buildWorkflowStatus() {
  return {
    browserVaultRefreshRequested: false,
    currentWaitReason: "runtime_wake_recheck",
    currentWaitUntil: "2026-05-21T12:04:00.000Z",
    invalidSignalCount: 0,
    lagRecoveryObserved: true,
    lastDemandKind: "run",
    lastDemandNextWakeAt: null,
    lastDemandSource: "manual",
    lastExecutionAt: "2026-05-21T11:59:45.000Z",
    lastExecutionErrorCode: null,
    lastExecutionKind: "runtime_processing_accepted",
    lastInvalidSignalErrorCode: null,
    lastMailboxLagLaneCount: 1,
    lastOrchestrationAttemptId: "orchestration_attempt_1",
    lastPrewarmAttemptId: "prewarm_attempt_1",
    lastPrewarmErrorCode: null,
    lastPrewarmResult: "accepted",
    lastRuntimeAttemptId: "runtime_attempt_1",
    lastRuntimeStatus: "scheduled",
    latestMailboxPointer: {
      lane: "conversation",
      laneSeq: "6",
      mailboxItemId: "mailbox_status_1",
      source: "email",
    },
    latestPrewarmRequestedAt: "2026-05-21T11:59:15.000Z",
    mailboxSignalCount: 2,
    manualRunRequested: true,
    prewarmRequested: false,
    prewarmSignalCount: 1,
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
