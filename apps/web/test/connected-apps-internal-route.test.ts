import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeHostedConnectedAppsRequest: vi.fn(),
  getPrisma: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/connected-apps/service", () => ({
  executeHostedConnectedAppsRequest: mocks.executeHostedConnectedAppsRequest,
}));

import { hostedMemberAccessSelect } from "@/src/lib/hosted-onboarding/member-access";

type RouteModule = typeof import("../app/api/internal/connected-apps/route");

let route: RouteModule;

describe("internal connected-apps route", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    route ??= await import("../app/api/internal/connected-apps/route");
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_family");
    mocks.executeHostedConnectedAppsRequest.mockResolvedValue({
      accounts: [],
      operation: "manage",
    });
  });

  it("allows a family-sponsored member whose direct billing is not active", async () => {
    const prisma = createPrisma({
      accountGroupMemberships: [{
        group: { billingStatus: "active", suspendedAt: null },
        status: "active",
      }],
      billingStatus: "not_started",
      id: "member_family",
      suspendedAt: null,
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await route.POST(new Request(
      "https://join.example.test/api/internal/connected-apps",
      {
        body: JSON.stringify({
          input: {
            action: "list",
          },
          operation: "manage",
        }),
        method: "POST",
      },
    ));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(prisma.hostedMember.findUnique).toHaveBeenCalledWith({
      select: hostedMemberAccessSelect,
      where: { id: "member_family" },
    });
    expect(mocks.executeHostedConnectedAppsRequest).toHaveBeenCalledWith({
      memberId: "member_family",
      request: {
        input: {
          action: "list",
        },
        operation: "manage",
      },
    });
    expect(payload).toEqual({
      result: {
        accounts: [],
        operation: "manage",
      },
    });
  });

  it("rejects inactive members without an active Family sponsorship", async () => {
    const prisma = createPrisma({
      accountGroupMemberships: [],
      billingStatus: "not_started",
      id: "member_family",
      suspendedAt: null,
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await route.POST(new Request(
      "https://join.example.test/api/internal/connected-apps",
      {
        body: JSON.stringify({
          input: {
            action: "list",
          },
          operation: "manage",
        }),
        method: "POST",
      },
    ));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({
      error: {
        code: "CONNECTED_APPS_MEMBER_INACTIVE",
      },
    });
    expect(mocks.executeHostedConnectedAppsRequest).not.toHaveBeenCalled();
  });
});

function createPrisma(member: {
  accountGroupMemberships: Array<{
    group: { billingStatus: string; suspendedAt: Date | null };
    status: string;
  }>;
  billingStatus: string;
  id: string;
  suspendedAt: Date | null;
}) {
  return {
    hostedMember: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === member.id
          ? {
              accountGroupMemberships: member.accountGroupMemberships,
              billingStatus: member.billingStatus,
              suspendedAt: member.suspendedAt,
              threadContainer: null,
            }
          : null
      ),
    },
  };
}
