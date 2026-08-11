import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  const hostedMemberFindUnique = vi.fn();
  return {
    getPrisma: vi.fn(),
    hostedMemberFindUnique,
    prisma: {
      hostedMember: {
        findUnique: hostedMemberFindUnique,
      },
      label: "test-prisma",
    },
    requireHostedCloudflareCallbackRequest: vi.fn(),
  };
});

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest:
    mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type AdmissionRoute = typeof import(
  "../app/api/internal/hosted-runtime/health-data-admission/route"
);

let route: AdmissionRoute;

describe("hosted runtime health-data admission route", () => {
  beforeAll(async () => {
    route = await import(
      "../app/api/internal/hosted-runtime/health-data-admission/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(mocks.prisma);
    mocks.hostedMemberFindUnique.mockResolvedValue({
      consentGrants: [],
      suspendedAt: null,
    });
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
  });

  it.each([
    ["granted", "active member", {
      consentGrants: [{ scope: "launch.health-data", status: "granted" }],
      suspendedAt: null,
    }, true],
    ["missing", "active legacy member", {
      consentGrants: [],
      suspendedAt: null,
    }, true],
    ["revoked", "withdrawn member", {
      consentGrants: [{ scope: "launch.health-data", status: "revoked" }],
      suspendedAt: null,
    }, false],
    ["granted", "suspended member", {
      consentGrants: [{ scope: "launch.health-data", status: "granted" }],
      suspendedAt: new Date("2026-08-09T00:00:00.000Z"),
    }, false],
    ["missing", "deleted member", null, false],
  ] as const)(
    "derives %s admission for %s",
    async (consentState, _memberKind, member, processingAllowed) => {
      mocks.hostedMemberFindUnique.mockResolvedValue(member);
      const request = new Request(
        "https://join.example.test/api/internal/hosted-runtime/health-data-admission",
      );

      const response = await route.GET(request);

      expect(response.status).toBe(200);
      expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(
        request,
        { maxBodyBytes: 0 },
      );
      expect(mocks.hostedMemberFindUnique).toHaveBeenCalledWith({
        select: {
          consentGrants: {
            select: {
              scope: true,
              status: true,
            },
            where: {
              scope: "launch.health-data",
            },
          },
          suspendedAt: true,
        },
        where: {
          id: "member_123",
        },
      });
      await expect(response.json()).resolves.toEqual({
        consentState,
        processingAllowed,
        userId: "member_123",
      });
    },
  );
});
