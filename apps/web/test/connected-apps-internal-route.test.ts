import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeHostedConnectedAppsRequest: vi.fn(),
  getPrisma: vi.fn(),
  hasHostedMemberEffectiveActiveAccessForMember: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  hasHostedMemberEffectiveActiveAccessForMember:
    mocks.hasHostedMemberEffectiveActiveAccessForMember,
}));

vi.mock("@/src/lib/connected-apps/service", () => ({
  executeHostedConnectedAppsRequest: mocks.executeHostedConnectedAppsRequest,
}));

type RouteModule = typeof import("../app/api/internal/connected-apps/route");

let route: RouteModule;

describe("internal connected-apps route", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    route ??= await import("../app/api/internal/connected-apps/route");
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_family");
    mocks.hasHostedMemberEffectiveActiveAccessForMember.mockResolvedValue(true);
    mocks.executeHostedConnectedAppsRequest.mockResolvedValue({
      accounts: [],
      operation: "manage",
    });
  });

  it("allows a family-sponsored member whose direct billing is not active", async () => {
    const prisma = createPrisma({
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
    expect(mocks.hasHostedMemberEffectiveActiveAccessForMember).toHaveBeenCalledWith({
      member: {
        billingStatus: "not_started",
        createdAt: expect.any(Date),
        id: "member_family",
        suspendedAt: null,
        updatedAt: expect.any(Date),
      },
      prisma,
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

  it("rejects inactive members when effective Family access is absent", async () => {
    const prisma = createPrisma({
      billingStatus: "not_started",
      id: "member_family",
      suspendedAt: null,
    });
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.hasHostedMemberEffectiveActiveAccessForMember.mockResolvedValueOnce(false);

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
  billingStatus: string;
  id: string;
  suspendedAt: Date | null;
}) {
  const now = new Date("2026-06-18T12:00:00.000Z");
  return {
    hostedMember: {
      findUnique: vi.fn(async ({ where }) =>
        where.id === member.id
          ? {
              billingStatus: member.billingStatus,
              createdAt: now,
              id: member.id,
              suspendedAt: member.suspendedAt,
              updatedAt: now,
            }
          : null
      ),
    },
  };
}
