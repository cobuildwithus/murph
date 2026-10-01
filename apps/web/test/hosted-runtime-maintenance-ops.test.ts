import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HostedBillingStatus, Prisma } from "@prisma/client";
vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  getPrisma: vi.fn(),
  hostedWorkspace: {
    count: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  hostedMember: {
    findMany: vi.fn(),
  },
  hostedThreadContainerParticipant: {
    findMany: vi.fn(),
  },
  readHostedRuntimeStalledRecheckCandidates: vi.fn(),
  requireActiveHostedAppSession: vi.fn(),
  requireActiveHostedAppSessionFromRequest: vi.fn(),
  signalHostedRuntimeMaintenanceRuntime: vi.fn(),
  signalHostedRuntimeRecheckRuntime: vi.fn(),
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
  signalHostedRuntimeRecheckRuntime:
    mocks.signalHostedRuntimeRecheckRuntime,
}));

vi.mock("@/src/lib/hosted-runtime-progress/alert-monitor", () => ({
  readHostedRuntimeStalledRecheckCandidates:
    mocks.readHostedRuntimeStalledRecheckCandidates,
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
const originalHostedAppSessionHmacKey = process.env.HOSTED_APP_SESSION_HMAC_KEY;
const prisma = {
  $queryRaw: mocks.$queryRaw,
  $transaction: mocks.$transaction,
  hostedMember: mocks.hostedMember,
  hostedThreadContainerParticipant: mocks.hostedThreadContainerParticipant,
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
    process.env.HOSTED_APP_SESSION_HMAC_KEY = Buffer.alloc(32, 7).toString("base64url");
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
    mocks.signalHostedRuntimeRecheckRuntime.mockResolvedValue({
      signalAccepted: true,
      workflowId: "hosted-user-runtime:member_001",
    });
    mocks.readHostedRuntimeStalledRecheckCandidates.mockResolvedValue({
      candidates: [],
      scanTruncated: false,
    });
    mocks.hostedWorkspace.count.mockResolvedValue(0);
    mocks.hostedWorkspace.findMany.mockResolvedValue([]);
    mocks.hostedWorkspace.findFirst.mockResolvedValue(null);
    mocks.$queryRaw.mockResolvedValue([]);
    mocks.hostedMember.findMany.mockResolvedValue([]);
    mocks.hostedThreadContainerParticipant.findMany.mockResolvedValue([]);
    mocks.$transaction.mockImplementation(async (operation) => await operation(prisma));
  });

  afterEach(() => {
    if (originalHostedOpsMemberIds === undefined) {
      delete process.env.HOSTED_OPS_MEMBER_IDS;
    } else {
      process.env.HOSTED_OPS_MEMBER_IDS = originalHostedOpsMemberIds;
    }
    if (originalHostedAppSessionHmacKey === undefined) {
      delete process.env.HOSTED_APP_SESSION_HMAC_KEY;
    } else {
      process.env.HOSTED_APP_SESSION_HMAC_KEY = originalHostedAppSessionHmacKey;
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

  it("reads a bounded stalled runtime recheck overview", async () => {
    mocks.readHostedRuntimeStalledRecheckCandidates.mockResolvedValue({
      candidates: [
        stalledRecheckCandidate("member_001", "2"),
        stalledRecheckCandidate("member_002", "3"),
        stalledRecheckCandidate("member_003", "5"),
      ],
      scanTruncated: true,
    });
    const generatedAt = new Date("2026-08-31T14:00:00.000Z");

    await expect(runtimeMaintenanceService.readHostedRuntimeStalledRecheckOverview({
      limit: 1,
      now: generatedAt,
    })).resolves.toEqual({
      candidates: [stalledRecheckCandidate("member_001", "2")],
      generatedAt: generatedAt.toISOString(),
      limit: 1,
      scanTruncated: true,
      totalCandidateCount: 3,
    });
    expect(mocks.readHostedRuntimeStalledRecheckCandidates).toHaveBeenCalledWith({
      now: generatedAt,
      prisma,
    });
  });

  it("normalizes, deduplicates, and signals up to three runtime rechecks sequentially", async () => {
    mocks.$queryRaw.mockResolvedValue([
      runtimeRecoveryFactRow("hbm_002"),
      runtimeRecoveryFactRow("hbm_001"),
      runtimeRecoveryFactRow("hbm_003"),
    ]);
    let inFlight = 0;
    let maxInFlight = 0;
    const signalOrder: string[] = [];
    mocks.signalHostedRuntimeRecheckRuntime.mockImplementation(async (input) => {
      signalOrder.push(input.userId);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return {
        signalAccepted: true,
        workflowId: `hosted-user-runtime:${input.userId}`,
      };
    });

    const result = await runtimeMaintenanceService.signalHostedRuntimeRecheckBatch({
      userIds: [
        " hbm_002 ",
        "hbm_001",
        "hbm_002",
        "hbm_003",
      ],
    });

    expect(signalOrder).toEqual(["hbm_002", "hbm_001", "hbm_003"]);
    expect(maxInFlight).toBe(1);
    expect(mocks.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signalHostedRuntimeRecheckRuntime.mock.invocationCallOrder[0]!,
    );
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledTimes(3);
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      requestedCount: 3,
      results: [
        { status: "signaled", userId: "hbm_002", witness: { userId: "hbm_002" } },
        { status: "signaled", userId: "hbm_001", witness: { userId: "hbm_001" } },
        { status: "signaled", userId: "hbm_003", witness: { userId: "hbm_003" } },
      ],
    });
    expect(mocks.readHostedRuntimeStalledRecheckCandidates).not.toHaveBeenCalled();
  });

  it("rejects empty and over-limit runtime recheck batches before signaling", async () => {
    await expect(runtimeMaintenanceService.signalHostedRuntimeRecheckBatch({
      userIds: [" ", ""],
    })).rejects.toMatchObject({
      code: "HOSTED_RUNTIME_RECHECK_USER_IDS_REQUIRED",
      httpStatus: 400,
    });
    await expect(runtimeMaintenanceService.signalHostedRuntimeRecheckBatch({
      userIds: [
        "hbm_001",
        "hbm_002",
        "hbm_003",
        "hbm_004",
      ],
    })).rejects.toMatchObject({
      code: "HOSTED_RUNTIME_RECHECK_LIMIT_EXCEEDED",
      httpStatus: 400,
    });

    expect(mocks.$queryRaw).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeRecheckRuntime).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).not.toHaveBeenCalled();
  });

  it("rejects invalid runtime member ids before reading workspaces", async () => {
    await expect(runtimeMaintenanceService.signalHostedRuntimeRecheckBatch({
      userIds: ["member_001"],
    })).rejects.toMatchObject({
      code: "HOSTED_RUNTIME_RECHECK_USER_ID_INVALID",
      httpStatus: 400,
    });
    await expect(runtimeMaintenanceService.signalHostedRuntimeRecheckBatch({
      userIds: [`hbm_${"a".repeat(125)}`],
    })).rejects.toMatchObject({
      code: "HOSTED_RUNTIME_RECHECK_USER_ID_INVALID",
      httpStatus: 400,
    });

    expect(mocks.$queryRaw).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeRecheckRuntime).not.toHaveBeenCalled();
  });

  it("can safely signal an ambiguous existing-workspace witness without presenting it as recovery", async () => {
    mocks.$queryRaw.mockResolvedValue([
      runtimeRecoveryFactRow("hbm_ambiguous"),
    ]);
    const result = await runtimeMaintenanceService.signalHostedRuntimeRecheckBatch({
      userIds: ["hbm_ambiguous"],
    });

    expect(result).toMatchObject({
      requestedCount: 1,
      results: [
        {
          status: "signaled",
          userId: "hbm_ambiguous",
          witness: {
            allocatedSystemHighWater: null,
            canonicalSystemConsumed: null,
            capturedHeadSequence: null,
            checkpointedAt: null,
            importedSystemSequence: null,
          },
        },
      ],
    });
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).not.toHaveBeenCalled();
  });

  it("does not signal when the captured batch proves the workspace is missing", async () => {
    const result = await runtimeMaintenanceService.signalHostedRuntimeRecheckBatch({
      userIds: ["hbm_missing"],
    });

    expect(result).toMatchObject({
      results: [{
        errorName: "HostedRuntimeWorkspaceNotFound",
        status: "failed",
        userId: "hbm_missing",
      }],
    });
    expect(mocks.signalHostedRuntimeRecheckRuntime).not.toHaveBeenCalled();
  });

  it("stops runtime rechecks on the first unknown signal result", async () => {
    mocks.$queryRaw.mockResolvedValue([
      runtimeRecoveryFactRow("hbm_001"),
      runtimeRecoveryFactRow("hbm_002"),
      runtimeRecoveryFactRow("hbm_003"),
    ]);
    mocks.signalHostedRuntimeRecheckRuntime.mockImplementation(async (input) => {
      if (input.userId === "hbm_002") {
        throw new DOMException("Timed out", "TimeoutError");
      }
      return {
        signalAccepted: true,
        workflowId: `hosted-user-runtime:${input.userId}`,
      };
    });

    const result = await runtimeMaintenanceService.signalHostedRuntimeRecheckBatch({
      userIds: ["hbm_001", "hbm_002", "hbm_003"],
    });

    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      results: [
        {
          status: "signaled",
          userId: "hbm_001",
          witness: { userId: "hbm_001" },
        },
        {
          errorName: "TimeoutError",
          status: "failed",
          userId: "hbm_002",
        },
      ],
    });
    expect(result.results).toHaveLength(2);
    expect(result.results[1]).not.toHaveProperty("witness");
    expect(mocks.readHostedRuntimeStalledRecheckCandidates).not.toHaveBeenCalled();
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

  it("lists stalled candidates and explicitly signals selected runtimes", async () => {
    mocks.$queryRaw.mockResolvedValue([
      runtimeRecoveryFactRow("hbm_002"),
    ]);
    mocks.readHostedRuntimeStalledRecheckCandidates.mockResolvedValue({
      candidates: [
        stalledRecheckCandidate("member_001", "2"),
        stalledRecheckCandidate("member_002", "4"),
      ],
      scanTruncated: false,
    });

    const getRequest = new Request(
      "https://join.example.test/api/ops/runtime-maintenance?operation=recheck-stalled-device-sync&limit=1",
    );
    const getResponse = await runtimeMaintenanceRoute.GET(getRequest);

    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get("Cache-Control")).toBe("no-store");
    await expect(getResponse.json()).resolves.toMatchObject({
      candidates: [{ userId: "member_001" }],
      limit: 1,
      totalCandidateCount: 2,
    });
    const postRequest = new Request(
      "https://join.example.test/api/ops/runtime-maintenance",
      {
        body: JSON.stringify({
          operation: "recheck-runtimes",
          userIds: ["hbm_002"],
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      },
    );
    const postResponse = await runtimeMaintenanceRoute.POST(postRequest);

    expect(postResponse.status).toBe(200);
    expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(
      postRequest,
    );
    expect(mocks.signalHostedRuntimeRecheckRuntime).toHaveBeenCalledWith({
      abortSignal: expect.any(AbortSignal),
      prisma,
      userId: "hbm_002",
    });
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).not.toHaveBeenCalled();
    await expect(postResponse.json()).resolves.toMatchObject({
      requestedCount: 1,
      results: [{
        status: "signaled",
        userId: "hbm_002",
        witness: { userId: "hbm_002" },
      }],
    });
  });

  it("rejects unknown operations before they can fall through to maintenance", async () => {
    const getResponse = await runtimeMaintenanceRoute.GET(new Request(
      "https://join.example.test/api/ops/runtime-maintenance?operation=recheck-stalled-runtime",
    ));
    const postResponse = await runtimeMaintenanceRoute.POST(new Request(
      "https://join.example.test/api/ops/runtime-maintenance",
      {
        body: JSON.stringify({
          limit: 1,
          operation: "recheck-stalled-runtime",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      },
    ));

    expect(getResponse.status).toBe(400);
    expect(postResponse.status).toBe(400);
    await expect(getResponse.json()).resolves.toMatchObject({
      error: { code: "HOSTED_RUNTIME_MAINTENANCE_OPERATION_INVALID" },
    });
    await expect(postResponse.json()).resolves.toMatchObject({
      error: { code: "HOSTED_RUNTIME_MAINTENANCE_OPERATION_INVALID" },
    });
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeRecheckRuntime).not.toHaveBeenCalled();
  });

  it("strictly rejects malformed runtime recheck user id arrays", async () => {
    const invalidUserIds = [
      "member_001",
      ["member_001", 2],
    ];

    for (const userIds of invalidUserIds) {
      const response = await runtimeMaintenanceRoute.POST(new Request(
        "https://join.example.test/api/ops/runtime-maintenance",
        {
          body: JSON.stringify({
            operation: "recheck-runtimes",
            userIds,
          }),
          headers: {
            "Content-Type": "application/json",
            origin: "https://join.example.test",
          },
          method: "POST",
        },
      ));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "HOSTED_RUNTIME_MAINTENANCE_OPERATION_INVALID" },
      });
    }

    expect(mocks.readHostedRuntimeStalledRecheckCandidates).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeRecheckRuntime).not.toHaveBeenCalled();
  });

  it("authenticates a read-only verification request and never signals Temporal", async () => {
    mocks.$queryRaw.mockResolvedValue([
      runtimeRecoveryFactRow("hbm_verify_one"),
    ]);
    const signalRequest = new Request(
      "https://join.example.test/api/ops/runtime-maintenance",
      {
        body: JSON.stringify({
          operation: "recheck-runtimes",
          userIds: ["hbm_verify_one"],
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      },
    );
    const signalResponse = await runtimeMaintenanceRoute.POST(signalRequest);
    const signalBody = await signalResponse.json();
    const baseline = signalBody.results[0].witness;
    mocks.signalHostedRuntimeRecheckRuntime.mockClear();

    const verifyRequest = new Request(
      "https://join.example.test/api/ops/runtime-maintenance",
      {
        body: JSON.stringify({
          baselines: [baseline],
          operation: "verify-runtime-rechecks",
        }),
        headers: {
          "Content-Type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      },
    );
    const verifyResponse = await runtimeMaintenanceRoute.POST(verifyRequest);

    expect(verifyResponse.status).toBe(200);
    expect(mocks.requireActiveHostedAppSessionFromRequest).toHaveBeenCalledWith(
      verifyRequest,
    );
    expect(mocks.signalHostedRuntimeRecheckRuntime).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).not.toHaveBeenCalled();
    await expect(verifyResponse.json()).resolves.toMatchObject({
      results: [{ status: "unknown", userId: "hbm_verify_one" }],
    });
  });

  it("strictly bounds verification input without invoking read or signal paths", async () => {
    const invalidBaselines = [
      "not-an-array",
      [],
      [{ userId: "hbm_1" }, { userId: "hbm_2" }, { userId: "hbm_3" }, { userId: "hbm_4" }],
    ];

    for (const baselines of invalidBaselines) {
      const response = await runtimeMaintenanceRoute.POST(new Request(
        "https://join.example.test/api/ops/runtime-maintenance",
        {
          body: JSON.stringify({
            baselines,
            operation: "verify-runtime-rechecks",
          }),
          headers: {
            "Content-Type": "application/json",
            origin: "https://join.example.test",
          },
          method: "POST",
        },
      ));

      expect(response.status).toBe(400);
    }

    expect(mocks.$transaction).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeRecheckRuntime).not.toHaveBeenCalled();
    expect(mocks.signalHostedRuntimeMaintenanceRuntime).not.toHaveBeenCalled();
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

function runtimeRecoveryFactRow(userId: string) {
  return {
    allocatedSystemHighWater: null,
    canonicalSystemConsumed: null,
    checkpointedAt: null,
    pendingHeadSequence: null,
    redactedStatusJson: null,
    userId,
    workspaceVersion: 1n,
  };
}

function stalledRecheckCandidate(userId: string, pendingItemCount = "1") {
  return {
    pendingItemCount,
    stalledSince: "2026-08-31T13:00:00.000Z",
    userId,
  };
}
