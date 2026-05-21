import {
  parseHostedRuntimeDemand,
} from "@murphai/hosted-execution/parsers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const FIXED_NOW = "2026-05-20T12:00:00.000Z";
const MEMBER_ID = "member_orch_1";
const UNSAFE_SENTINEL = "UNSAFE_STATUS_SENTINEL";

const mocks = vi.hoisted(() => ({
  readHostedMailboxMaxSeqByLane: vi.fn(),
  readHostedWorkspace: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
  resolveHostedAiUsageGate: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  readHostedMailboxMaxSeqByLane: mocks.readHostedMailboxMaxSeqByLane,
}));

vi.mock("@/src/lib/hosted-workspace/store", () => ({
  readHostedWorkspace: mocks.readHostedWorkspace,
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  resolveHostedAiUsageGate: mocks.resolveHostedAiUsageGate,
}));

type DemandRoute = typeof import(
  "../app/api/internal/hosted-orchestration/users/[userId]/demand/route"
);

let demandRoute: DemandRoute;

describe("hosted orchestration demand", () => {
  beforeAll(async () => {
    demandRoute = await import(
      "../app/api/internal/hosted-orchestration/users/[userId]/demand/route"
    );
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue(MEMBER_ID);
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord());
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue(noMailboxBacklog());
    mocks.resolveHostedAiUsageGate.mockResolvedValue({ allowed: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prioritizes mailbox lag over explicit manual demand and keeps demand slim", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      redactedStatusJson: {
        conversationImportedSeq: "2",
        payload: UNSAFE_SENTINEL,
        systemImportedSeq: "0",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "5",
      },
      {
        lane: "system",
        maxSeq: "0",
      },
    ]);

    const response = await demandRoute.GET(
      requestForDemand("?manualRunRequested=1"),
      routeContext(),
    );
    const body = await response.json();
    const demand = parseHostedRuntimeDemand(body);

    expect(response.status).toBe(200);
    expect(demand).toMatchObject({
      kind: "run",
      reason: "nudge",
      requiresAiUsageDecision: true,
      source: "mailbox_backlog",
      workspace: {
        nextWakeAt: null,
        nextWakeReason: null,
        version: "4",
      },
    });
    expect(demand.mailboxLag).toEqual([
      {
        importedSeq: "2",
        lag: "3",
        lane: "conversation",
        maxSeq: "5",
      },
      {
        importedSeq: "0",
        lag: "0",
        lane: "system",
        maxSeq: "0",
      },
    ]);
    expect(mocks.resolveHostedAiUsageGate).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      now: new Date(FIXED_NOW),
    });
    expect(JSON.stringify(body)).not.toContain("aiUsageAllowDecision");
    expect(JSON.stringify(body)).not.toContain("redactedStatus");
    expect(JSON.stringify(body)).not.toContain(UNSAFE_SENTINEL);
    expect(JSON.stringify(body)).not.toMatch(/payload|message|transcript/u);
  });

  it("gates maintenance runtime-result wakes that mask model-capable workspace wakes", async () => {
    mocks.resolveHostedAiUsageGate.mockResolvedValue({ allowed: false });
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt: "2026-05-20T11:59:30.000Z",
      nextWakeReason: "assistant_due",
      version: "8",
    }));

    const response = await demandRoute.GET(
      requestForDemand(
        "?runtimeResultWakeAt=2026-05-20T11%3A59%3A00.000Z&runtimeResultWakeReason=device-sync.reconcile",
      ),
      routeContext(),
    );
    const demand = parseHostedRuntimeDemand(await response.json());

    expect(demand).toMatchObject({
      kind: "blocked",
      reason: "ai_usage_denied",
      retryAt: null,
      workspace: {
        nextWakeAt: "2026-05-20T11:59:30.000Z",
        nextWakeReason: "assistant_due",
        version: "8",
      },
    });
    expect(mocks.resolveHostedAiUsageGate).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      now: new Date(FIXED_NOW),
    });
  });

  it("suppresses only the same stale workspace wake key", async () => {
    const nextWakeAt = "2026-05-20T11:58:00.000Z";
    const ignoredWorkspaceWakeKey = `4:${nextWakeAt}:assistant_due`;
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt,
      nextWakeReason: "assistant_due",
    }));

    const response = await demandRoute.GET(
      requestForDemand(
        `?ignoredWorkspaceWakeKey=${encodeURIComponent(ignoredWorkspaceWakeKey)}`,
      ),
      routeContext(),
    );
    const demand = parseHostedRuntimeDemand(await response.json());

    expect(demand).toEqual({
      kind: "idle",
      mailboxLag: [
        {
          importedSeq: "0",
          lag: "0",
          lane: "system",
          maxSeq: "0",
        },
        {
          importedSeq: "0",
          lag: "0",
          lane: "conversation",
          maxSeq: "0",
        },
      ],
      nextWakeAt: null,
      workspace: {
        nextWakeAt,
        nextWakeReason: "assistant_due",
        version: "4",
      },
    });
    expect(mocks.resolveHostedAiUsageGate).not.toHaveBeenCalled();

    const manualResponse = await demandRoute.GET(
      requestForDemand(
        `?manualRunRequested=1&ignoredWorkspaceWakeKey=${
          encodeURIComponent(ignoredWorkspaceWakeKey)
        }`,
      ),
      routeContext(),
    );
    const manualDemand = parseHostedRuntimeDemand(await manualResponse.json());

    expect(manualDemand).toMatchObject({
      kind: "run",
      reason: "manual",
      source: "manual",
    });
  });

  it("runs due workspace wake when the wake key is not ignored", async () => {
    const nextWakeAt = "2026-05-20T11:58:00.000Z";
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt,
      nextWakeReason: "device-sync.reconcile",
    }));

    const response = await demandRoute.GET(
      requestForDemand(),
      routeContext(),
    );
    const demand = parseHostedRuntimeDemand(await response.json());

    expect(demand).toMatchObject({
      kind: "run",
      reason: "nudge",
      requiresAiUsageDecision: false,
      source: "workspace_wake",
      workspace: {
        nextWakeAt,
        nextWakeReason: "device-sync.reconcile",
        version: "4",
      },
    });
  });

  it("prioritizes device-sync recovery over lag recovery", async () => {
    const response = await demandRoute.GET(
      requestForDemand(
        "?deviceSyncRecoveryRequested=1&lagRecoveryObserved=1",
      ),
      routeContext(),
    );
    const demand = parseHostedRuntimeDemand(await response.json());

    expect(demand).toMatchObject({
      kind: "run",
      reason: "nudge",
      requiresAiUsageDecision: false,
      source: "device_sync_recovery",
    });
    expect(mocks.resolveHostedAiUsageGate).not.toHaveBeenCalled();
  });

  it("treats browser-vault refresh as non-model demand", async () => {
    const response = await demandRoute.GET(
      requestForDemand("?browserVaultRefreshRequested=1"),
      routeContext(),
    );
    const demand = parseHostedRuntimeDemand(await response.json());

    expect(demand).toMatchObject({
      kind: "run",
      reason: "browser_vault_refresh",
      requiresAiUsageDecision: false,
      source: "browser_vault_refresh",
    });
    expect(mocks.resolveHostedAiUsageGate).not.toHaveBeenCalled();
  });

  it("blocks model-capable run demand when usage is denied", async () => {
    mocks.resolveHostedAiUsageGate.mockResolvedValue({ allowed: false });

    const response = await demandRoute.GET(
      requestForDemand("?manualRunRequested=1"),
      routeContext(),
    );
    const demand = parseHostedRuntimeDemand(await response.json());

    expect(demand).toMatchObject({
      kind: "blocked",
      reason: "ai_usage_denied",
      retryAt: null,
    });
  });

  it("blocks model-capable run demand with a short retry when the usage gate is unavailable", async () => {
    mocks.resolveHostedAiUsageGate.mockRejectedValue(new Error("unavailable"));

    const response = await demandRoute.GET(
      requestForDemand("?manualRunRequested=1"),
      routeContext(),
    );
    const demand = parseHostedRuntimeDemand(await response.json());

    expect(demand).toMatchObject({
      kind: "blocked",
      reason: "ai_usage_gate_unavailable",
      retryAt: "2026-05-20T12:00:30.000Z",
    });
  });

  it("does not gate maintenance and recovery demand sources", async () => {
    mocks.resolveHostedAiUsageGate.mockResolvedValue({ allowed: false });

    const lagResponse = await demandRoute.GET(
      requestForDemand("?lagRecoveryObserved=1"),
      routeContext(),
    );
    const lagDemand = parseHostedRuntimeDemand(await lagResponse.json());

    expect(lagDemand).toMatchObject({
      kind: "run",
      requiresAiUsageDecision: false,
      source: "lag_recovery",
    });
    expect(mocks.resolveHostedAiUsageGate).not.toHaveBeenCalled();

    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt: "2026-05-20T11:58:00.000Z",
      nextWakeReason: "device-sync.reconcile",
    }));
    const runtimeResultResponse = await demandRoute.GET(
      requestForDemand(
        "?runtimeResultWakeAt=2026-05-20T11%3A59%3A00.000Z&runtimeResultWakeReason=device-sync.reconcile",
      ),
      routeContext(),
    );
    const runtimeResultDemand = parseHostedRuntimeDemand(
      await runtimeResultResponse.json(),
    );

    expect(runtimeResultDemand).toMatchObject({
      kind: "run",
      requiresAiUsageDecision: false,
      source: "runtime_result_wake",
    });
    expect(mocks.resolveHostedAiUsageGate).not.toHaveBeenCalled();

    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt: "2026-05-20T11:58:00.000Z",
      nextWakeReason: "device-sync.reconcile",
    }));
    const workspaceResponse = await demandRoute.GET(
      requestForDemand(),
      routeContext(),
    );
    const workspaceDemand = parseHostedRuntimeDemand(await workspaceResponse.json());

    expect(workspaceDemand).toMatchObject({
      kind: "run",
      requiresAiUsageDecision: false,
      source: "workspace_wake",
    });
    expect(mocks.resolveHostedAiUsageGate).not.toHaveBeenCalled();
  });

  it("gates reasonless runtime-result wakes by default", async () => {
    mocks.resolveHostedAiUsageGate.mockResolvedValue({ allowed: false });

    const response = await demandRoute.GET(
      requestForDemand(
        "?runtimeResultWakeAt=2026-05-20T11%3A59%3A00.000Z",
      ),
      routeContext(),
    );
    const demand = parseHostedRuntimeDemand(await response.json());

    expect(demand).toMatchObject({
      kind: "blocked",
      reason: "ai_usage_denied",
      retryAt: null,
    });
    expect(mocks.resolveHostedAiUsageGate).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      now: new Date(FIXED_NOW),
    });
  });

  it("gates model-capable workspace wakes", async () => {
    mocks.resolveHostedAiUsageGate.mockResolvedValue({ allowed: false });
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt: "2026-05-20T11:58:00.000Z",
      nextWakeReason: "assistant",
    }));

    const response = await demandRoute.GET(
      requestForDemand(),
      routeContext(),
    );
    const demand = parseHostedRuntimeDemand(await response.json());

    expect(demand).toMatchObject({
      kind: "blocked",
      reason: "ai_usage_denied",
      retryAt: null,
    });
    expect(mocks.resolveHostedAiUsageGate).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      now: new Date(FIXED_NOW),
    });
  });

  it("does not gate system-only mailbox backlog", async () => {
    mocks.resolveHostedAiUsageGate.mockResolvedValue({ allowed: false });
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      redactedStatusJson: {
        conversationImportedSeq: "0",
        systemImportedSeq: "0",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "system",
        maxSeq: "2",
      },
      {
        lane: "conversation",
        maxSeq: "0",
      },
    ]);

    const response = await demandRoute.GET(
      requestForDemand(),
      routeContext(),
    );
    const demand = parseHostedRuntimeDemand(await response.json());

    expect(demand).toMatchObject({
      kind: "run",
      reason: "nudge",
      requiresAiUsageDecision: false,
      source: "mailbox_backlog",
    });
    expect(demand.mailboxLag).toContainEqual({
      importedSeq: "0",
      lag: "2",
      lane: "system",
      maxSeq: "2",
    });
    expect(mocks.resolveHostedAiUsageGate).not.toHaveBeenCalled();
  });

  it("does not let system-only mailbox backlog mask explicit manual demand gating", async () => {
    mocks.resolveHostedAiUsageGate.mockResolvedValue({ allowed: false });
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      redactedStatusJson: {
        conversationImportedSeq: "0",
        systemImportedSeq: "0",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "system",
        maxSeq: "2",
      },
      {
        lane: "conversation",
        maxSeq: "0",
      },
    ]);

    const response = await demandRoute.GET(
      requestForDemand("?manualRunRequested=1"),
      routeContext(),
    );
    const demand = parseHostedRuntimeDemand(await response.json());

    expect(demand).toMatchObject({
      kind: "blocked",
      reason: "ai_usage_denied",
      retryAt: null,
    });
    expect(mocks.resolveHostedAiUsageGate).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      now: new Date(FIXED_NOW),
    });
  });

  it("returns the earliest future runtime or workspace wake while idle", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt: "2026-05-20T12:03:00.000Z",
      nextWakeReason: "assistant_due",
    }));

    const response = await demandRoute.GET(
      requestForDemand(
        "?runtimeResultWakeAt=2026-05-20T12%3A01%3A00.000Z",
      ),
      routeContext(),
    );
    const demand = parseHostedRuntimeDemand(await response.json());

    expect(demand).toMatchObject({
      kind: "idle",
      nextWakeAt: "2026-05-20T12:01:00.000Z",
    });
  });

});

function requestForDemand(search = ""): Request {
  return new Request(
    `https://join.example.test/api/internal/hosted-orchestration/users/${
      encodeURIComponent(MEMBER_ID)
    }/demand${search}`,
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

function noMailboxBacklog() {
  return [
    {
      lane: "system",
      maxSeq: "0",
    },
    {
      lane: "conversation",
      maxSeq: "0",
    },
  ];
}

function buildWorkspaceRecord(overrides: Partial<{
  browserVaultReplicaRef: Record<string, unknown> | null;
  checkpointedAt: string | null;
  createdAt: string;
  nextWakeAt: string | null;
  nextWakeReason: string | null;
  redactedStatusJson: Record<string, unknown> | null;
  snapshotRef: Record<string, unknown> | null;
  updatedAt: string;
  userId: string;
  version: string;
}> = {}) {
  return {
    browserVaultReplicaRef: null,
    checkpointedAt: FIXED_NOW,
    createdAt: FIXED_NOW,
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatusJson: {
      conversationImportedSeq: "0",
      systemImportedSeq: "0",
    },
    snapshotRef: {
      hash: "snapshot_hash",
      key: "snapshot/object",
      size: 128,
      updatedAt: FIXED_NOW,
    },
    updatedAt: FIXED_NOW,
    userId: MEMBER_ID,
    version: "4",
    ...overrides,
  };
}
