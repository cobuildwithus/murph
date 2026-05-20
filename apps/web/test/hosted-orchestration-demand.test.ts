import {
  parseHostedRuntimeDemand,
} from "@murphai/hosted-execution/parsers";
import {
  parseHostedAiUsageAllowDecision,
  type HostedAiUsageAllowDecision,
} from "@murphai/hosted-execution/runtime-control";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const FIXED_NOW = "2026-05-20T12:00:00.000Z";
const MEMBER_ID = "member_orch_1";
const UNSAFE_SENTINEL = "UNSAFE_STATUS_SENTINEL";

const mocks = vi.hoisted(() => ({
  createHostedAiUsageAllowDecision: vi.fn(),
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

vi.mock("@/src/lib/hosted-execution/usage-gate-allow-decision", () => ({
  createHostedAiUsageAllowDecision: mocks.createHostedAiUsageAllowDecision,
}));

type DemandRoute = typeof import(
  "../app/api/internal/hosted-orchestration/users/[userId]/demand/route"
);
type UsageDecisionRoute = typeof import(
  "../app/api/internal/hosted-orchestration/users/[userId]/usage-allow-decision/route"
);

let demandRoute: DemandRoute;
let usageDecisionRoute: UsageDecisionRoute;

describe("hosted orchestration demand", () => {
  beforeAll(async () => {
    demandRoute = await import(
      "../app/api/internal/hosted-orchestration/users/[userId]/demand/route"
    );
    usageDecisionRoute = await import(
      "../app/api/internal/hosted-orchestration/users/[userId]/usage-allow-decision/route"
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
    mocks.createHostedAiUsageAllowDecision.mockResolvedValue(buildAiUsageAllowDecision());
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

  it("runs due runtime-result wake before due workspace wake", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt: "2026-05-20T11:59:30.000Z",
      nextWakeReason: "assistant_due",
      version: "8",
    }));

    const response = await demandRoute.GET(
      requestForDemand(
        "?runtimeResultWakeAt=2026-05-20T11%3A59%3A00.000Z",
      ),
      routeContext(),
    );
    const demand = parseHostedRuntimeDemand(await response.json());

    expect(demand).toMatchObject({
      kind: "run",
      reason: "retry",
      requiresAiUsageDecision: true,
      source: "runtime_result_wake",
      workspace: {
        nextWakeAt: "2026-05-20T11:59:30.000Z",
        nextWakeReason: "assistant_due",
        version: "8",
      },
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
      nextWakeReason: "assistant_due",
    }));

    const response = await demandRoute.GET(
      requestForDemand(),
      routeContext(),
    );
    const demand = parseHostedRuntimeDemand(await response.json());

    expect(demand).toMatchObject({
      kind: "run",
      reason: "nudge",
      requiresAiUsageDecision: true,
      source: "workspace_wake",
      workspace: {
        nextWakeAt,
        nextWakeReason: "assistant_due",
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
      requiresAiUsageDecision: true,
      source: "device_sync_recovery",
    });
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
      requestForDemand("?lagRecoveryObserved=1"),
      routeContext(),
    );
    const demand = parseHostedRuntimeDemand(await response.json());

    expect(demand).toMatchObject({
      kind: "blocked",
      reason: "ai_usage_gate_unavailable",
      retryAt: "2026-05-20T12:00:30.000Z",
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

  it("returns a fresh signed usage decision through the Activity-local endpoint", async () => {
    const response = await usageDecisionRoute.GET(
      requestForUsageDecision(),
      routeContext(),
    );
    const decision = parseHostedAiUsageAllowDecision(await response.json());

    expect(decision).toEqual(buildAiUsageAllowDecision());
    expect(mocks.resolveHostedAiUsageGate).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      now: new Date(FIXED_NOW),
    });
    expect(mocks.createHostedAiUsageAllowDecision).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      now: new Date(FIXED_NOW),
    });
  });

  it("returns a blocked usage decision state without usage ledger details", async () => {
    mocks.resolveHostedAiUsageGate.mockResolvedValue({
      allowed: false,
      reason: "ai_usage_limit_exceeded",
    });

    const response = await usageDecisionRoute.GET(
      requestForUsageDecision(),
      routeContext(),
    );
    const body = await response.json();

    expect(body).toEqual({
      kind: "blocked",
      reason: "ai_usage_denied",
      retryAt: null,
    });
    expect(JSON.stringify(body)).not.toMatch(/spent|remaining|limit|billing|ledger/u);
    expect(mocks.createHostedAiUsageAllowDecision).not.toHaveBeenCalled();
  });

  it("returns a retryable blocked usage state when a signed decision cannot be issued", async () => {
    mocks.createHostedAiUsageAllowDecision.mockResolvedValue(null);

    const response = await usageDecisionRoute.GET(
      requestForUsageDecision(),
      routeContext(),
    );

    await expect(response.json()).resolves.toEqual({
      kind: "blocked",
      reason: "ai_usage_gate_unavailable",
      retryAt: "2026-05-20T12:00:30.000Z",
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

function requestForUsageDecision(): Request {
  return new Request(
    `https://join.example.test/api/internal/hosted-orchestration/users/${
      encodeURIComponent(MEMBER_ID)
    }/usage-allow-decision`,
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

function buildAiUsageAllowDecision(): HostedAiUsageAllowDecision {
  return {
    allowed: true,
    expiresAt: "2026-05-20T12:00:30.000Z",
    issuedAt: FIXED_NOW,
    nonce: "nonce_orch_1",
    schema: "murph.hosted-ai-usage-allow-decision.v1",
    signature: {
      alg: "HMAC-SHA256",
      keyId: "v1",
      signature: "signature_orch_1",
    },
    userId: MEMBER_ID,
  };
}
