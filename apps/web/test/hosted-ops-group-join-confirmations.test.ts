import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  drainPendingHostedGroupJoinConfirmations: vi.fn(),
  requireHostedOpsRequestAccess: vi.fn(),
}));

vi.mock("@/src/lib/hosted-groups/group-join-confirmation", () => ({
  drainPendingHostedGroupJoinConfirmations:
    mocks.drainPendingHostedGroupJoinConfirmations,
}));

vi.mock("@/src/lib/hosted-ops/access", () => ({
  requireHostedOpsRequestAccess: mocks.requireHostedOpsRequestAccess,
}));

type RouteModule = typeof import("../app/api/ops/group-join-confirmations/route");

let route: RouteModule;

describe("hosted group join confirmation drain route", () => {
  beforeAll(async () => {
    route = await import("../app/api/ops/group-join-confirmations/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedOpsRequestAccess.mockResolvedValue({
      member: { id: "member_ops" },
    });
    mocks.drainPendingHostedGroupJoinConfirmations.mockResolvedValue({
      appended: 1,
      deferred: 1,
      nextCursor: "membership_2",
      scanned: 2,
      terminalSkipped: 0,
    });
  });

  it("runs one authenticated bounded page and returns its continuation cursor", async () => {
    const request = new Request(
      "https://join.example.test/api/ops/group-join-confirmations",
      {
        body: JSON.stringify({ cursor: "membership_0", limit: 2 }),
        headers: {
          "content-type": "application/json",
          origin: "https://join.example.test",
        },
        method: "POST",
      },
    );

    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.requireHostedOpsRequestAccess).toHaveBeenCalledWith(request, {
      requireMutationOrigin: true,
    });
    expect(mocks.drainPendingHostedGroupJoinConfirmations).toHaveBeenCalledWith({
      cursor: "membership_0",
      limit: 2,
    });
    await expect(response.json()).resolves.toEqual({
      appended: 1,
      deferred: 1,
      nextCursor: "membership_2",
      scanned: 2,
      terminalSkipped: 0,
    });
  });
});
