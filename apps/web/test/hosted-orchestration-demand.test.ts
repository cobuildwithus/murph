import {
  parseHostedRuntimeDemand,
} from "@murphai/hosted-execution/parsers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const FIXED_NOW = "2026-05-20T12:00:00.000Z";
const MEMBER_ID = "member_orch_1";
const UNSAFE_SENTINEL = "UNSAFE_STATUS_SENTINEL";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  readHostedMailboxFirstPendingSystemKind: vi.fn(),
  readHostedMailboxMaxSeqByLane: vi.fn(),
  readHostedMemberCoreState: vi.fn(),
  readHostedWorkspace: vi.fn(),
  readHostedAiUsageGate: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
  resolveHostedAiUsageGate: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  readHostedMailboxFirstPendingSystemKind:
    mocks.readHostedMailboxFirstPendingSystemKind,
  readHostedMailboxMaxSeqByLane: mocks.readHostedMailboxMaxSeqByLane,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberCoreState: mocks.readHostedMemberCoreState,
}));

vi.mock("@/src/lib/hosted-workspace/store", () => ({
  readHostedWorkspace: mocks.readHostedWorkspace,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  readHostedAiUsageGate: mocks.readHostedAiUsageGate,
  resolveHostedAiUsageGate: mocks.resolveHostedAiUsageGate,
}));

type DemandRoute = typeof import(
  "../app/api/internal/hosted-orchestration/users/[userId]/demand/route"
);

let demandRoute: DemandRoute;
let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

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
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    mocks.getPrisma.mockReturnValue({ kind: "prisma" });
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue(MEMBER_ID);
    mocks.readHostedMemberCoreState.mockResolvedValue(buildActiveMemberRecord());
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord());
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue(noMailboxBacklog());
    mocks.readHostedMailboxFirstPendingSystemKind.mockResolvedValue(null);
    mocks.readHostedAiUsageGate.mockResolvedValue({ allowed: true });
    mocks.resolveHostedAiUsageGate.mockResolvedValue({ allowed: true });
  });

  afterEach(() => {
    consoleInfoSpy.mockRestore();
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

  it("logs exactly one metadata-only demand decision record", async () => {
    const response = await demandRoute.GET(
      requestForDemand("?manualRunRequested=1"),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "Hosted runtime demand decision.",
      {
        blockedReason: null,
        browserVaultRefreshRequested: false,
        component: "hosted.orchestration.demand",
        conversationLagPresent: false,
        decisionSource: "workflow",
        demandKind: "run",
        demandReason: "manual",
        demandSource: "manual",
        deviceSyncRecoveryRequested: false,
        lagRecoveryObserved: false,
        mailboxLagLaneCount: 2,
        manualRunRequested: true,
        retryAtPresent: false,
        schema: "murph.hosted-runtime.demand-decision.v1",
        usageGateRequired: true,
        usageGateStatus: "allowed",
        userIdPresent: true,
        workspaceNextWakeAtPresent: false,
        workspaceNextWakeReason: null,
        workspacePresent: true,
      },
    );
    const loggedMetadata = consoleInfoSpy.mock.calls[0]?.[1];
    expect(JSON.stringify(loggedMetadata)).not.toMatch(
      /payload|body|prompt|message|transcript|redactedStatus/u,
    );
    expect(JSON.stringify(loggedMetadata)).not.toContain(MEMBER_ID);
  });

  it.each([
    ["runtime.manual-requested", "manual", "manual", true],
    [
      "runtime.browser-vault-refresh-requested",
      "browser_vault_refresh",
      "browser_vault_refresh",
      false,
    ],
    ["runtime.device-sync-recovery-requested", "mailbox_backlog", "nudge", false],
    ["runtime.mailbox-lag-observed", "lag_recovery", "nudge", false],
  ] as const)(
    "derives %s demand from the first pending system mailbox control item",
    async (kind, source, reason, gated) => {
      mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
        redactedStatusJson: {
          conversationImportedSeq: "0",
          systemImportedSeq: "0",
        },
      }));
      mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
        {
          lane: "conversation",
          maxSeq: "0",
        },
        {
          lane: "system",
          maxSeq: "3",
        },
      ]);
      mocks.readHostedMailboxFirstPendingSystemKind.mockResolvedValue(kind);

      const response = await demandRoute.GET(requestForDemand(), routeContext());
      const demand = parseHostedRuntimeDemand(await response.json());

      expect(response.status).toBe(200);
      expect(demand).toMatchObject({
        kind: "run",
        reason,
        source,
      });
      expect(mocks.readHostedMailboxFirstPendingSystemKind).toHaveBeenCalledWith({
        afterSeq: "0",
        prisma: { kind: "prisma" },
        userId: MEMBER_ID,
      });
      if (gated) {
        expect(mocks.resolveHostedAiUsageGate).toHaveBeenCalledWith({
          memberId: MEMBER_ID,
          now: new Date(FIXED_NOW),
        });
      } else {
        expect(mocks.resolveHostedAiUsageGate).not.toHaveBeenCalled();
      }
    },
  );

  it("keeps conversation mailbox backlog ahead of pending device-sync system wakes", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      redactedStatusJson: {
        conversationImportedSeq: "1",
        systemImportedSeq: "0",
      },
    }));
    mocks.readHostedMailboxMaxSeqByLane.mockResolvedValue([
      {
        lane: "conversation",
        maxSeq: "2",
      },
      {
        lane: "system",
        maxSeq: "1",
      },
    ]);
    mocks.readHostedMailboxFirstPendingSystemKind.mockResolvedValue("device-sync.wake");

    const response = await demandRoute.GET(requestForDemand(), routeContext());
    const demand = parseHostedRuntimeDemand(await response.json());

    expect(demand).toMatchObject({
      kind: "run",
      reason: "nudge",
      source: "mailbox_backlog",
    });
    expect(mocks.readHostedMailboxFirstPendingSystemKind).toHaveBeenCalledWith({
      afterSeq: "0",
      prisma: { kind: "prisma" },
      userId: MEMBER_ID,
    });
    expect(mocks.resolveHostedAiUsageGate).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      now: new Date(FIXED_NOW),
    });
  });

  it("does not log free-form wake reason strings", async () => {
    const unsafeWakeReason = `${UNSAFE_SENTINEL} prompt payload transcript`;
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt: "2026-05-20T12:05:00.000Z",
      nextWakeReason: unsafeWakeReason,
    }));

    const response = await demandRoute.GET(
      requestForDemand("?manualRunRequested=1"),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
    const loggedMetadata = consoleInfoSpy.mock.calls[0]?.[1];
    expect(loggedMetadata).toMatchObject({
      workspaceNextWakeReason: "other",
    });
    expect(JSON.stringify(loggedMetadata)).not.toContain(UNSAFE_SENTINEL);
    expect(JSON.stringify(loggedMetadata)).not.toMatch(
      /payload|body|prompt|message|transcript|redactedStatus/u,
    );
  });

  it.each([
    "alarm",
    "assistant",
    "assistant_due",
    "device-sync.reconcile",
    "mailbox",
  ] as const)("logs known workspace wake reason %s", async (nextWakeReason) => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt: "2026-05-20T11:58:00.000Z",
      nextWakeReason,
    }));

    const response = await demandRoute.GET(requestForDemand(), routeContext());

    expect(response.status).toBe(200);
    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
    expect(consoleInfoSpy.mock.calls[0]?.[1]).toMatchObject({
      workspaceNextWakeReason: nextWakeReason,
    });
  });

  it("can evaluate demand with a read-only usage gate for status diagnostics", async () => {
    const { readHostedRuntimeDemand } = await import(
      "@/src/lib/hosted-orchestration/runtime-demand"
    );
    mocks.readHostedAiUsageGate.mockResolvedValue({ allowed: false });

    const demand = await readHostedRuntimeDemand({
      manualRunRequested: true,
      now: FIXED_NOW,
      decisionSource: "status",
      usageGateMode: "read_only",
      userId: MEMBER_ID,
    });

    expect(demand).toMatchObject({
      kind: "blocked",
      reason: "ai_usage_denied",
    });
    expect(mocks.readHostedAiUsageGate).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      now: new Date(FIXED_NOW),
    });
    expect(mocks.resolveHostedAiUsageGate).not.toHaveBeenCalled();
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "Hosted runtime demand decision.",
      expect.objectContaining({
        component: "hosted.orchestration.demand",
        decisionSource: "status",
        schema: "murph.hosted-runtime.demand-decision.v1",
      }),
    );
  });

  it("blocks demand for missing hosted users before reading runtime state", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValue(null);

    const response = await demandRoute.GET(
      requestForDemand("?manualRunRequested=1"),
      routeContext(),
    );
    const demand = parseHostedRuntimeDemand(await response.json());

    expect(demand).toEqual({
      kind: "blocked",
      mailboxLag: [],
      reason: "user_not_active",
      retryAt: null,
      workspace: null,
    });
    expect(mocks.readHostedWorkspace).not.toHaveBeenCalled();
    expect(mocks.readHostedMailboxMaxSeqByLane).not.toHaveBeenCalled();
    expect(mocks.resolveHostedAiUsageGate).not.toHaveBeenCalled();
    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "Hosted runtime demand decision.",
      {
        blockedReason: "user_not_active",
        browserVaultRefreshRequested: false,
        component: "hosted.orchestration.demand",
        conversationLagPresent: false,
        decisionSource: "workflow",
        demandKind: "blocked",
        demandReason: null,
        demandSource: null,
        deviceSyncRecoveryRequested: false,
        lagRecoveryObserved: false,
        mailboxLagLaneCount: 0,
        manualRunRequested: true,
        retryAtPresent: false,
        schema: "murph.hosted-runtime.demand-decision.v1",
        usageGateRequired: false,
        usageGateStatus: "not_required",
        userIdPresent: true,
        workspaceNextWakeAtPresent: false,
        workspaceNextWakeReason: null,
        workspacePresent: false,
      },
    );
    expect(JSON.stringify(consoleInfoSpy.mock.calls[0]?.[1])).not.toContain(
      MEMBER_ID,
    );
  });

  it("blocks demand for inactive hosted users instead of honoring stale wakes", async () => {
    mocks.readHostedMemberCoreState.mockResolvedValue(buildActiveMemberRecord({
      billingStatus: "canceled",
    }));

    const response = await demandRoute.GET(
      requestForDemand(),
      routeContext(),
    );
    const demand = parseHostedRuntimeDemand(await response.json());

    expect(demand).toEqual({
      kind: "blocked",
      mailboxLag: [],
      reason: "user_not_active",
      retryAt: null,
      workspace: null,
    });
    expect(mocks.readHostedWorkspace).not.toHaveBeenCalled();
    expect(mocks.readHostedMailboxMaxSeqByLane).not.toHaveBeenCalled();
    expect(mocks.resolveHostedAiUsageGate).not.toHaveBeenCalled();
  });

  it("blocks selected run demand when hosted runtime workspace state is missing", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(null);

    const response = await demandRoute.GET(
      requestForDemand("?manualRunRequested=1"),
      routeContext(),
    );
    const demand = parseHostedRuntimeDemand(await response.json());

    expect(demand).toEqual({
      kind: "blocked",
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
      reason: "hosted_runtime_not_configured",
      retryAt: null,
      workspace: null,
    });
    expect(mocks.resolveHostedAiUsageGate).not.toHaveBeenCalled();
  });

  it("runs due workspace wakes", async () => {
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
      source: "workspace_wake",
      workspace: {
        nextWakeAt,
        nextWakeReason: "device-sync.reconcile",
        version: "4",
      },
    });
  });

  it("ignores retired legacy compaction workspace wakes", async () => {
    const nextWakeAt = "2026-05-20T11:58:00.000Z";
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt,
      nextWakeReason: "legacy-wearable-receipt-compaction-v1",
    }));

    const response = await demandRoute.GET(
      requestForDemand(),
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
        nextWakeReason: "legacy-wearable-receipt-compaction-v1",
        version: "4",
      },
    });
    expect(mocks.resolveHostedAiUsageGate).not.toHaveBeenCalled();
  });

  it("ignores legacy device-sync recovery flags when selecting run demand", async () => {
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
      source: "lag_recovery",
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
      source: "lag_recovery",
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
      source: "workspace_wake",
    });
    expect(mocks.resolveHostedAiUsageGate).not.toHaveBeenCalled();
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

  it("lets system-only mailbox backlog outrank manual demand without usage gating", async () => {
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
      kind: "run",
      reason: "nudge",
      source: "mailbox_backlog",
    });
    expect(mocks.resolveHostedAiUsageGate).not.toHaveBeenCalled();
  });

  it("returns the future workspace wake while idle", async () => {
    mocks.readHostedWorkspace.mockResolvedValue(buildWorkspaceRecord({
      nextWakeAt: "2026-05-20T12:03:00.000Z",
      nextWakeReason: "assistant_due",
    }));

    const response = await demandRoute.GET(
      requestForDemand(),
      routeContext(),
    );
    const demand = parseHostedRuntimeDemand(await response.json());

    expect(demand).toMatchObject({
      kind: "idle",
      nextWakeAt: "2026-05-20T12:03:00.000Z",
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

function buildActiveMemberRecord(overrides: Partial<{
  billingStatus: string;
  suspendedAt: Date | null;
}> = {}) {
  return {
    billingStatus: "active",
    createdAt: new Date(FIXED_NOW),
    id: MEMBER_ID,
    suspendedAt: null,
    updatedAt: new Date(FIXED_NOW),
    ...overrides,
  };
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
