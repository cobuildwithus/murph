import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HostedBillingStatus, Prisma } from "@prisma/client";
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  getPrisma: vi.fn(),
  hostedWorkspace: {
    count: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  requireActiveHostedAppSession: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
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
  signalHostedRuntimeMaintenanceRuntime:
    mocks.signalHostedRuntimeMaintenanceRuntime,
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
    mocks.hostedWorkspace.count.mockResolvedValue(0);
    mocks.hostedWorkspace.findMany.mockResolvedValue([]);
    mocks.hostedWorkspace.findFirst.mockResolvedValue(null);
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

  it("selects candidates with the resolver access projection in the WHERE", async () => {
    // Sponsored members and thread containers qualify inside the query, so
    // count, cursor, page, and batch wakes all describe the same population
    // and a leading inactive raw row cannot starve a limit-1 batch wake.
    mocks.hostedWorkspace.count.mockResolvedValue(1);
    mocks.hostedWorkspace.findMany.mockResolvedValue([
      workspaceRow("member_sponsored", "10"),
    ]);

    await expect(runtimeMaintenanceService.readHostedRuntimeMaintenanceOverview({
      limit: 1,
    })).resolves.toMatchObject({
      candidates: [{ userId: "member_sponsored" }],
      nextCursor: null,
    });

    expect(mocks.hostedWorkspace.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: activeCheckpointedWorkspaceWhere(),
    }));
    expect(mocks.hostedWorkspace.count).toHaveBeenCalledWith({
      where: activeCheckpointedWorkspaceWhere(),
    });
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
  const personAccess = [
    { billingStatus: HostedBillingStatus.active },
    {
      accountGroupMemberships: {
        some: {
          group: {
            billingStatus: HostedBillingStatus.active,
            suspendedAt: null,
          },
          status: "active",
        },
      },
    },
  ];
  return {
    member: {
      OR: [
        {
          OR: personAccess,
          threadContainer: null,
        },
        {
          threadContainer: {
            is: {
              owner: {
                OR: personAccess,
                suspendedAt: null,
              },
            },
          },
        },
      ],
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
