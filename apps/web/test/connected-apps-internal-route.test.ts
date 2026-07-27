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

  it("allows accountless service lookup from a synthetic group container", async () => {
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_group");
    const prisma = createPrisma({
      accountGroupMemberships: [],
      billingStatus: "active",
      id: "member_group",
      suspendedAt: null,
      threadContainer: true,
    });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.executeHostedConnectedAppsRequest.mockResolvedValue({
      operation: "execute",
      output: { temperature: 72 },
    });

    const response = await route.POST(new Request(
      "https://join.example.test/api/internal/connected-apps",
      {
        body: JSON.stringify({
          input: {
            arguments: { lat: 40.7, lon: -74 },
            toolSlug: "OPENWEATHER_API_GET_CURRENT_WEATHER",
          },
          operation: "execute",
        }),
        method: "POST",
      },
    ));

    expect(response.status).toBe(200);
    expect(mocks.executeHostedConnectedAppsRequest).toHaveBeenCalledWith({
      memberId: "member_group",
      request: {
        input: {
          arguments: { lat: 40.7, lon: -74 },
          toolSlug: "OPENWEATHER_API_GET_CURRENT_WEATHER",
        },
        operation: "execute",
      },
    });
  });

  it("rejects personal connected-account operations from a synthetic group container", async () => {
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_group");
    const prisma = createPrisma({
      accountGroupMemberships: [],
      billingStatus: "active",
      id: "member_group",
      suspendedAt: null,
      threadContainer: true,
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

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "CONNECTED_APPS_PERSONAL_MEMBER_REQUIRED",
      },
    });
    expect(mocks.executeHostedConnectedAppsRequest).not.toHaveBeenCalled();
  });

  it("rejects account-backed execution from a synthetic group container before provider work", async () => {
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_group");
    const prisma = createPrisma({
      accountGroupMemberships: [],
      billingStatus: "active",
      id: "member_group",
      suspendedAt: null,
      threadContainer: true,
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await route.POST(new Request(
      "https://join.example.test/api/internal/connected-apps",
      {
        body: JSON.stringify({
          input: {
            account: "work",
            arguments: { query: "newer_than:7d" },
            toolSlug: "GMAIL_FETCH_EMAILS",
          },
          operation: "execute",
        }),
        method: "POST",
      },
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "CONNECTED_APPS_PERSONAL_MEMBER_REQUIRED",
      },
    });
    expect(mocks.executeHostedConnectedAppsRequest).not.toHaveBeenCalled();
  });

  it("rejects personal toolkit search from a synthetic group container before provider work", async () => {
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_group");
    mocks.getPrisma.mockReturnValue(createPrisma({
      accountGroupMemberships: [],
      billingStatus: "active",
      id: "member_group",
      suspendedAt: null,
      threadContainer: true,
    }));

    const response = await route.POST(new Request(
      "https://join.example.test/api/internal/connected-apps",
      {
        body: JSON.stringify({
          input: {
            query: "find recent messages",
            toolkits: ["gmail"],
          },
          operation: "search",
        }),
        method: "POST",
      },
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "CONNECTED_APPS_PERSONAL_MEMBER_REQUIRED",
      },
    });
    expect(mocks.executeHostedConnectedAppsRequest).not.toHaveBeenCalled();
  });

  it("narrows unfiltered group search to the accountless service toolkits", async () => {
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_group");
    mocks.getPrisma.mockReturnValue(createPrisma({
      accountGroupMemberships: [],
      billingStatus: "active",
      id: "member_group",
      suspendedAt: null,
      threadContainer: true,
    }));

    const response = await route.POST(new Request(
      "https://join.example.test/api/internal/connected-apps",
      {
        body: JSON.stringify({
          input: {
            query: "find nearby pharmacies and weather",
          },
          operation: "search",
        }),
        method: "POST",
      },
    ));

    expect(response.status).toBe(200);
    expect(mocks.executeHostedConnectedAppsRequest).toHaveBeenCalledWith({
      memberId: "member_group",
      request: {
        input: {
          query: "find nearby pharmacies and weather",
          toolkits: ["composio_search", "instacart", "openweather_api"],
        },
        operation: "search",
      },
    });
  });

  it("leaves unfiltered direct-member search unchanged", async () => {
    mocks.getPrisma.mockReturnValue(createPrisma({
      accountGroupMemberships: [],
      billingStatus: "active",
      id: "member_family",
      suspendedAt: null,
    }));

    const response = await route.POST(new Request(
      "https://join.example.test/api/internal/connected-apps",
      {
        body: JSON.stringify({
          input: {
            query: "find recent health context",
          },
          operation: "search",
        }),
        method: "POST",
      },
    ));

    expect(response.status).toBe(200);
    expect(mocks.executeHostedConnectedAppsRequest).toHaveBeenCalledWith({
      memberId: "member_family",
      request: {
        input: {
          query: "find recent health context",
        },
        operation: "search",
      },
    });
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
  threadContainer?: boolean;
}) {
  return {
    hostedMember: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === member.id
          ? {
              accountGroupMemberships: member.accountGroupMemberships,
              billingStatus: member.billingStatus,
              suspendedAt: member.suspendedAt,
              threadContainer: member.threadContainer
                ? {
                    memberId: member.id,
                    owner: {
                      accountGroupMemberships: [],
                      billingStatus: "active",
                      suspendedAt: null,
                    },
                  }
                : null,
            }
          : null
      ),
    },
  };
}
