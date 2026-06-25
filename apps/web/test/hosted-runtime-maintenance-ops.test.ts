import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HostedBillingStatus, Prisma } from "@prisma/client";
import type {
  HostedExecutionAssistantNotificationRoute,
} from "@murphai/hosted-execution";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  getPrisma: vi.fn(),
  appendHostedMailboxEnvelopeTx: vi.fn(),
  hostedWorkspace: {
    count: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  readHostedMemberSnapshot: vi.fn(),
  requireActiveHostedAppSession: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
  signalHostedRuntimeMaintenanceRuntime: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireActiveHostedAppSession: mocks.requireActiveHostedAppSession,
  requireActiveHostedAppSessionFromRequest: mocks.requireActiveHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime:
    mocks.signalHostedMailboxAppendRuntime,
  signalHostedRuntimeMaintenanceRuntime:
    mocks.signalHostedRuntimeMaintenanceRuntime,
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMailboxEnvelopeTx: mocks.appendHostedMailboxEnvelopeTx,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberSnapshot: mocks.readHostedMemberSnapshot,
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((location: string) => {
    throw new Error(`NEXT_REDIRECT:${location}`);
  }),
}));

type RuntimeMaintenanceRouteModule =
  typeof import("../app/api/ops/runtime-maintenance/route");
type RuntimeMaintenanceServiceModule =
  typeof import("../src/lib/hosted-ops/runtime-maintenance");
type OpsAccessModule = typeof import("../src/lib/hosted-ops/access");

let runtimeMaintenanceRoute: RuntimeMaintenanceRouteModule;
let runtimeMaintenanceService: RuntimeMaintenanceServiceModule;
let opsAccess: OpsAccessModule;

const originalHostedOpsMemberIds = process.env.HOSTED_OPS_MEMBER_IDS;
const prisma = {
  hostedWorkspace: mocks.hostedWorkspace,
  $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({})),
};

describe("hosted runtime maintenance ops", () => {
  beforeAll(async () => {
    runtimeMaintenanceRoute = await import("../app/api/ops/runtime-maintenance/route");
    runtimeMaintenanceService = await import("../src/lib/hosted-ops/runtime-maintenance");
    opsAccess = await import("../src/lib/hosted-ops/access");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOSTED_OPS_MEMBER_IDS = "member_ops";
    mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.requireActiveHostedAppSession.mockResolvedValue({
      member: { id: "member_ops" },
    });
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValue({
      member: { id: "member_ops" },
    });
    mocks.signalHostedRuntimeMaintenanceRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_001",
    });
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_001",
    });
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue({
      dedupeConflict: false,
      duplicate: false,
      inserted: true,
      item: {
        id: "mailbox_seed_item",
      },
    });
    mocks.hostedWorkspace.count.mockResolvedValue(0);
    mocks.hostedWorkspace.findMany.mockResolvedValue([]);
    mocks.hostedWorkspace.findFirst.mockResolvedValue(null);
    mocks.readHostedMemberSnapshot.mockResolvedValue(null);
  });

  afterEach(() => {
    if (originalHostedOpsMemberIds === undefined) {
      delete process.env.HOSTED_OPS_MEMBER_IDS;
    } else {
      process.env.HOSTED_OPS_MEMBER_IDS = originalHostedOpsMemberIds;
    }
  });

  it("reads a paged active checkpointed workspace overview", async () => {
    mocks.hostedWorkspace.count.mockResolvedValue(3);
    mocks.hostedWorkspace.findMany.mockResolvedValue([
      workspaceRow("member_001", "10"),
      workspaceRow("member_002", "11"),
      workspaceRow("member_003", "12"),
    ]);

    await expect(runtimeMaintenanceService.readHostedRuntimeMaintenanceOverview({
      cursor: "member_000",
      limit: 2,
    })).resolves.toMatchObject({
      candidates: [
        {
          checkpointedAt: "2026-06-01T12:00:00.000Z",
          snapshotRefPresent: true,
          updatedAt: "2026-06-01T12:05:00.000Z",
          userId: "member_001",
          version: "10",
        },
        {
          userId: "member_002",
          version: "11",
        },
      ],
      limit: 2,
      nextCursor: "member_002",
      totalCandidateCount: 3,
    });

    expect(mocks.hostedWorkspace.count).toHaveBeenCalledWith({
      where: activeCheckpointedWorkspaceWhere(),
    });
    expect(mocks.hostedWorkspace.findMany).toHaveBeenCalledWith(expect.objectContaining({
      cursor: { userId: "member_000" },
      orderBy: { userId: "asc" },
      skip: 1,
      take: 3,
      where: activeCheckpointedWorkspaceWhere(),
    }));
  });

  it("caps batch wakes and returns the read cursor from the candidate page", async () => {
    mocks.hostedWorkspace.count.mockResolvedValue(4);
    mocks.hostedWorkspace.findMany.mockResolvedValue([
      workspaceRow("member_001", "10"),
      workspaceRow("member_002", "11"),
      workspaceRow("member_003", "12"),
      workspaceRow("member_004", "13"),
    ]);
    mocks.signalHostedRuntimeMaintenanceRuntime.mockImplementation(async (input) => ({
      signalAccepted: true,
      workflowId: `hosted-user-runtime:${input.userId}`,
    }));

    const result = await runtimeMaintenanceService.signalHostedRuntimeMaintenanceBatch({
      limit: 99,
    });

    expect(result).toMatchObject({
      limit: 3,
      nextCursor: "member_003",
      results: [
        {
          status: "signaled",
          userId: "member_001",
          workflowId: "hosted-user-runtime:member_001",
        },
        {
          status: "signaled",
          userId: "member_002",
          workflowId: "hosted-user-runtime:member_002",
        },
        {
          status: "signaled",
          userId: "member_003",
          workflowId: "hosted-user-runtime:member_003",
        },
      ],
    });
    expect(mocks.hostedWorkspace.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 4,
    }));
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).toHaveBeenCalledTimes(3);
  });

  it("stops a batch after the first workspace signal failure", async () => {
    mocks.hostedWorkspace.count.mockResolvedValue(3);
    mocks.hostedWorkspace.findMany.mockResolvedValue([
      workspaceRow("member_001", "10"),
      workspaceRow("member_002", "11"),
      workspaceRow("member_003", "12"),
    ]);
    mocks.signalHostedRuntimeMaintenanceRuntime.mockImplementation(async (input) => {
      if (input.userId === "member_002") {
        throw new Error("Temporal signal rejected for test workspace.");
      }
      return {
        signalAccepted: true,
        workflowId: `hosted-user-runtime:${input.userId}`,
      };
    });

    const result = await runtimeMaintenanceService.signalHostedRuntimeMaintenanceBatch({
      limit: 3,
    });

    expect(mocks.signalHostedRuntimeMaintenanceRuntime).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      results: [
        {
          status: "signaled",
          userId: "member_001",
          workflowId: "hosted-user-runtime:member_001",
        },
        {
          errorMessage: "Maintenance signal failed. Check server logs for details.",
          errorName: "Error",
          status: "failed",
          userId: "member_002",
        },
      ],
    });
  });

  it("enqueues managed automation seed wakes with resolved routes", async () => {
    const route = linqThreadRoute();
    mocks.hostedWorkspace.count.mockResolvedValue(3);
    mocks.hostedWorkspace.findMany.mockResolvedValue([
      workspaceRow("member_001", "10"),
      workspaceRow("member_002", "11"),
      workspaceRow("member_003", "12"),
    ]);
    const readRepairRoute = vi.fn(async (input: { userId: string }) =>
      input.userId === "member_002" ? null : route);
    const appendSeedWake = vi.fn(async (input: { userId: string }) =>
      mailboxAppendResult(`mailbox_seed_${input.userId}`, input.userId));
    const signalMailboxAppendRuntime = vi.fn(async (input: { expectedUserId?: string | null }) => ({
      signalAccepted: true as const,
      workflowId: `hosted-user-runtime:${input.expectedUserId ?? "unknown"}`,
    }));

    const result = await runtimeMaintenanceService.repairHostedRuntimeManagedAutomationsBatch({
      appendSeedWake,
      limit: 3,
      readRepairRoute,
      signalMailboxAppendRuntime,
    });

    expect(result).toMatchObject({
      limit: 3,
      nextCursor: null,
      results: [
        {
          inserted: true,
          mailboxItemId: "mailbox_seed_member_001",
          status: "enqueued",
          userId: "member_001",
          workflowId: "hosted-user-runtime:member_001",
        },
        {
          status: "route_missing",
          userId: "member_002",
        },
        {
          inserted: true,
          mailboxItemId: "mailbox_seed_member_003",
          status: "enqueued",
          userId: "member_003",
          workflowId: "hosted-user-runtime:member_003",
        },
      ],
    });
    expect(readRepairRoute).toHaveBeenCalledTimes(3);
    expect(appendSeedWake).toHaveBeenCalledTimes(2);
    expect(signalMailboxAppendRuntime).toHaveBeenCalledTimes(2);
    expect(signalMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_001",
      mailboxItemId: "mailbox_seed_member_001",
      prisma,
    });
  });

  it("requires an active checkpointed workspace for explicit user wakes", async () => {
    mocks.hostedWorkspace.findFirst.mockResolvedValue(null);

    await expect(runtimeMaintenanceService.signalHostedRuntimeMaintenanceBatch({
      userId: "member_missing",
    })).rejects.toMatchObject({
      code: "HOSTED_RUNTIME_MAINTENANCE_WORKSPACE_NOT_FOUND",
      httpStatus: 404,
    });

    expect(mocks.signalHostedRuntimeMaintenanceRuntime).not.toHaveBeenCalled();
  });

  it("signals an explicit active checkpointed workspace through the ops route", async () => {
    mocks.hostedWorkspace.findFirst.mockResolvedValue(workspaceRow("member_002", "11"));
    mocks.signalHostedRuntimeMaintenanceRuntime.mockImplementationOnce(async (input) => ({
      signalAccepted: true,
      workflowId: `hosted-user-runtime:${input.userId}`,
    }));

    const request = new Request("https://join.example.test/api/ops/runtime-maintenance", {
      body: JSON.stringify({
        userId: "member_002",
      }),
      headers: {
        "Content-Type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    });
    const response = await runtimeMaintenanceRoute.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.hostedWorkspace.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        ...activeCheckpointedWorkspaceWhere(),
        userId: "member_002",
      },
    }));
    expect(mocks.hostedWorkspace.findMany).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).toHaveBeenCalledWith({
      prisma,
      userId: "member_002",
    });
    await expect(response.json()).resolves.toMatchObject({
      limit: 1,
      nextCursor: null,
      results: [
        {
          status: "signaled",
          userId: "member_002",
          workflowId: "hosted-user-runtime:member_002",
        },
      ],
    });
  });

  it("seeds managed automations for an explicit workspace through the ops route", async () => {
    mocks.hostedWorkspace.findFirst.mockResolvedValue(workspaceRow("member_002", "11"));
    mocks.readHostedMemberSnapshot.mockResolvedValue(hostedMemberSnapshot("member_002"));
    mocks.appendHostedMailboxEnvelopeTx.mockResolvedValue(
      mailboxAppendResult("mailbox_seed_member_002", "member_002"),
    );
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValueOnce({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_002",
    });

    const request = new Request("https://join.example.test/api/ops/runtime-maintenance", {
      body: JSON.stringify({
        action: "seed-managed-automations",
        userId: "member_002",
      }),
      headers: {
        "Content-Type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    });
    const response = await runtimeMaintenanceRoute.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.readHostedMemberSnapshot).toHaveBeenCalledWith({
      memberId: "member_002",
      prisma,
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledWith(expect.objectContaining({
      envelope: expect.objectContaining({
        kind: "assistant.managed-automation.seed-requested",
        route: expect.objectContaining({
          channel: "linq",
          delivery: {
            kind: "thread",
            target: "linq_chat_member_002",
          },
        }),
        userId: "member_002",
      }),
    }));
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_002",
      mailboxItemId: "mailbox_seed_member_002",
      prisma,
    });
    await expect(response.json()).resolves.toMatchObject({
      limit: 1,
      results: [
        {
          mailboxItemId: "mailbox_seed_member_002",
          status: "enqueued",
          userId: "member_002",
          workflowId: "hosted-user-runtime:member_002",
        },
      ],
    });
  });

  it("rejects unsupported runtime maintenance actions", async () => {
    const response = await runtimeMaintenanceRoute.POST(
      new Request("https://join.example.test/api/ops/runtime-maintenance", {
        body: JSON.stringify({
          action: "not-a-real-action",
          userId: "member_002",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_RUNTIME_MAINTENANCE_ACTION_UNSUPPORTED",
      },
    });
  });

  it("gates the ops request helper by hosted app session member id", async () => {
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValueOnce({
      member: { id: "member_other" },
    });

    await expect(opsAccess.requireHostedOpsRequestAccess(
      new Request("https://join.example.test/api/ops/runtime-maintenance"),
    )).rejects.toMatchObject({
      code: "HOSTED_OPS_ACCESS_DENIED",
      httpStatus: 404,
    });
  });

  it("fails closed when the hosted ops allowlist is missing or invalid", async () => {
    delete process.env.HOSTED_OPS_MEMBER_IDS;

    await expect(opsAccess.requireHostedOpsRequestAccess(
      new Request("https://join.example.test/api/ops/runtime-maintenance"),
    )).rejects.toMatchObject({
      code: "HOSTED_OPS_ACCESS_DENIED",
      httpStatus: 404,
    });

    process.env.HOSTED_OPS_MEMBER_IDS = "!!!, member other";

    await expect(opsAccess.requireHostedOpsRequestAccess(
      new Request("https://join.example.test/api/ops/runtime-maintenance"),
    )).rejects.toMatchObject({
      code: "HOSTED_OPS_ACCESS_DENIED",
      httpStatus: 404,
    });
  });

  it("lists candidates through the authenticated ops route", async () => {
    mocks.hostedWorkspace.count.mockResolvedValue(1);
    mocks.hostedWorkspace.findMany.mockResolvedValue([
      workspaceRow("member_001", "10"),
    ]);

    const request = new Request(
      "https://join.example.test/api/ops/runtime-maintenance?limit=1&cursor=member_000",
    );
    const response = await runtimeMaintenanceRoute.GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.assertHostedOnboardingMutationOrigin).not.toHaveBeenCalled();
    expect(mocks.requireActiveHostedAppSessionFromRequest).toHaveBeenCalledWith(request);
    await expect(response.json()).resolves.toMatchObject({
      candidates: [
        {
          userId: "member_001",
          version: "10",
        },
      ],
      limit: 1,
      totalCandidateCount: 1,
    });
  });

  it("signals maintenance through the authenticated same-origin ops route", async () => {
    mocks.hostedWorkspace.count.mockResolvedValue(1);
    mocks.hostedWorkspace.findMany.mockResolvedValue([
      workspaceRow("member_001", "10"),
    ]);

    const request = new Request("https://join.example.test/api/ops/runtime-maintenance", {
      body: JSON.stringify({
        limit: 1,
      }),
      headers: {
        "Content-Type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    });
    const response = await runtimeMaintenanceRoute.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(request);
    expect(mocks.requireActiveHostedAppSessionFromRequest).toHaveBeenCalledWith(request);
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).toHaveBeenCalledWith({
      prisma,
      userId: "member_001",
    });
    await expect(response.json()).resolves.toMatchObject({
      limit: 1,
      results: [
        {
          status: "signaled",
          userId: "member_001",
        },
      ],
    });
  });

  it("does not signal when the ops route session member is not allowlisted", async () => {
    mocks.requireActiveHostedAppSessionFromRequest.mockResolvedValueOnce({
      member: { id: "member_other" },
    });

    const response = await runtimeMaintenanceRoute.POST(
      new Request("https://join.example.test/api/ops/runtime-maintenance", {
        body: JSON.stringify({ limit: 1 }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(404);
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_OPS_ACCESS_DENIED",
      },
    });
  });
});

function activeCheckpointedWorkspaceWhere() {
  return {
    member: {
      billingStatus: HostedBillingStatus.active,
      suspendedAt: null,
    },
    snapshotRef: {
      not: Prisma.DbNull,
    },
  };
}

function workspaceRow(userId: string, version: string) {
  return {
    checkpointedAt: new Date("2026-06-01T12:00:00.000Z"),
    snapshotRef: {
      objectKey: `snapshots/${userId}.tar.br.enc`,
    },
    updatedAt: new Date("2026-06-01T12:05:00.000Z"),
    userId,
    version: BigInt(version),
  };
}

function linqThreadRoute(): HostedExecutionAssistantNotificationRoute {
  return {
    actorId: "actor_member",
    channel: "linq",
    delivery: {
      kind: "thread",
      target: "linq_chat_member",
    },
    identityId: "identity_member",
    threadId: "thread_member",
    threadIsDirect: true,
  };
}

function mailboxAppendResult(id: string, userId: string) {
  return {
    dedupeConflict: false,
    duplicate: false,
    inserted: true,
    item: {
      createdAt: "2026-06-01T12:00:00.000Z",
      dedupeKey: `dedupe_${id}`,
      expiresAt: null,
      id,
      kind: "assistant.managed-automation.seed-requested" as const,
      lane: "system" as const,
      laneSeq: "1",
      occurredAt: "2026-06-01T12:00:00.000Z",
      payloadBytes: 256,
      payloadInlineCiphertext: "ciphertext",
      payloadRef: null,
      payloadSchema: "murph.hosted-mailbox-item.v1",
      updatedAt: "2026-06-01T12:00:00.000Z",
      userId,
    },
  };
}

function hostedMemberSnapshot(memberId: string) {
  return {
    billingRef: null,
    core: {
      billingStatus: HostedBillingStatus.active,
      id: memberId,
      suspendedAt: null,
    },
    emailAuthorization: null,
    identity: {
      phoneLookupKey: `phone_lookup_${memberId}`,
      phoneNumber: "+15550002222",
    },
    routing: {
      linqChatId: `linq_chat_${memberId}`,
      linqRecipientPhone: null,
      memberId,
      pendingLinqChatId: null,
      pendingLinqParticipantContact: null,
      pendingLinqRecipientPhone: null,
      telegramThreadId: null,
      telegramUserId: null,
    },
  };
}
