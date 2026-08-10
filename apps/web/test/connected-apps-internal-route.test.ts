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

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
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
    expect(mocks.executeHostedConnectedAppsRequest).toHaveBeenCalledTimes(1);
  });

  it("keeps the direct-only official-alert read out of synthetic groups", async () => {
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
            arguments: { lat: 52.2297, lon: 21.0122 },
            toolSlug: "MURPH_OPENWEATHER_GET_NATIONAL_ALERTS",
          },
          operation: "execute",
        }),
        method: "POST",
      },
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "CONNECTED_APPS_PERSONAL_MEMBER_REQUIRED" },
    });
    expect(mocks.executeHostedConnectedAppsRequest).not.toHaveBeenCalled();
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

  it("logs structured provider diagnostics without returning them to the runner", async () => {
    mocks.getPrisma.mockReturnValue(createPrisma({
      accountGroupMemberships: [],
      billingStatus: "active",
      id: "member_family",
      suspendedAt: null,
    }));
    mocks.executeHostedConnectedAppsRequest.mockRejectedValue(
      hostedOnboardingError({
        cause: new Error(
          "Composio email sending returned an ambiguous result. Composio request failed with status 400. Provider error: code=1703, slug=PROVIDER_AUTH_FAILED.",
        ),
        code: "CONNECTED_APPS_PROVIDER_UNAVAILABLE",
        details: {
          operationName: "GMAIL_SEND_EMAIL",
          statusCode: 400,
          type: "composio_http_error",
        },
        httpStatus: 400,
        message: "The connected-app request could not be completed.",
        retryable: false,
      }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await route.POST(new Request(
      "https://join.example.test/api/internal/connected-apps",
      {
        body: JSON.stringify({
          input: {
            account: "work",
            agentApproved: true,
            arguments: {
              body: "Please help with my account.",
              recipient_email: "support@example.com",
              subject: "Account help",
            },
            toolSlug: "GMAIL_SEND_EMAIL",
          },
          operation: "execute",
        }),
        method: "POST",
      },
    ));

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload).toEqual({
      error: {
        code: "CONNECTED_APPS_PROVIDER_UNAVAILABLE",
        details: {
          operationName: "GMAIL_SEND_EMAIL",
          statusCode: 400,
          type: "composio_http_error",
        },
        message: "The connected-app request could not be completed.",
        retryable: false,
      },
    });
    expect(JSON.stringify(payload)).not.toContain("PROVIDER_AUTH_FAILED");
    expect(warnSpy).toHaveBeenCalledWith(
      "Hosted onboarding route failed.",
      expect.objectContaining({
        errorCauseMessage:
          "Composio email sending returned an ambiguous result. Composio request failed with status 400. Provider error: code=1703, slug=PROVIDER_AUTH_FAILED.",
        errorResponseCode: "CONNECTED_APPS_PROVIDER_UNAVAILABLE",
        requestMethod: "POST",
      }),
    );
    warnSpy.mockRestore();
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
