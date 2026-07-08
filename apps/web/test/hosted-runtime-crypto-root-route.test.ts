import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  readHostedDomainRootEnvelopeByRootKeyIdOrThrow: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-store", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-crypto/domain-root-store")>(
    "@/src/lib/hosted-crypto/domain-root-store",
  );

  return {
    ...actual,
    readHostedDomainRootEnvelopeByRootKeyIdOrThrow:
      mocks.readHostedDomainRootEnvelopeByRootKeyIdOrThrow,
  };
});

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type HostedRuntimeCryptoRootRouteModule =
  typeof import("../app/api/internal/hosted-runtime/crypto-context/root/route");

let hostedRuntimeCryptoRootRoute: HostedRuntimeCryptoRootRouteModule;

describe("hosted runtime crypto root route", () => {
  beforeAll(async () => {
    hostedRuntimeCryptoRootRoute = await import(
      "../app/api/internal/hosted-runtime/crypto-context/root/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
    mocks.getPrisma.mockReturnValue(createPrisma({
      member: {
        accountGroupMemberships: [],
        billingStatus: "active",
        suspendedAt: null,
        threadContainer: null,
      },
      workspace: {
        userId: "member_123",
      },
    }));
    mocks.readHostedDomainRootEnvelopeByRootKeyIdOrThrow.mockResolvedValue({
      domain: "runtime",
      rootKeyId: "udrk:runtime:test-root",
      schema: "murph.hosted-domain-root-key-envelope.v1",
      userId: "member_123",
      wraps: [],
    });
  });

  it("returns 404 when the requested decryptable root is unavailable", async () => {
    const { HostedDomainRootEnvelopeUnavailableError } = await import(
      "@/src/lib/hosted-crypto/domain-root-store"
    );
    mocks.readHostedDomainRootEnvelopeByRootKeyIdOrThrow.mockRejectedValue(
      new HostedDomainRootEnvelopeUnavailableError({
        domain: "runtime",
      }),
    );

    const response = await hostedRuntimeCryptoRootRoute.POST(
      new Request("https://join.example.test/api/internal/hosted-runtime/crypto-context/root", {
        body: JSON.stringify({
          domain: "runtime",
          rootKeyId: "udrk:runtime:missing-root",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_RUNTIME_CRYPTO_ROOT_NOT_FOUND",
        message: "Hosted runtime crypto root is not available.",
        retryable: false,
      },
    });
  });

  it("allows crypto root reads when an active participant keeps an inactive-owner group alive", async () => {
    const prisma = createPrisma({
      member: {
        accountGroupMemberships: [],
        billingStatus: "not_started",
        suspendedAt: null,
        threadContainer: {
          owner: {
            accountGroupMemberships: [],
            billingStatus: "paused",
            suspendedAt: null,
          },
        },
      },
      participantActive: true,
      workspace: {
        userId: "member_123",
      },
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await hostedRuntimeCryptoRootRoute.POST(
      new Request("https://join.example.test/api/internal/hosted-runtime/crypto-context/root", {
        body: JSON.stringify({
          domain: "runtime",
          rootKeyId: "udrk:runtime:test-root",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(prisma.hostedThreadContainerParticipant.findFirst).toHaveBeenCalledWith({
      select: {
        participantMemberId: true,
      },
      where: expect.objectContaining({
        containerMemberId: "member_123",
        removedAt: null,
      }),
    });
    expect(mocks.readHostedDomainRootEnvelopeByRootKeyIdOrThrow).toHaveBeenCalledWith({
      domain: "runtime",
      prisma,
      rootKeyId: "udrk:runtime:test-root",
      userId: "member_123",
    });
  });
});

function createPrisma(input: {
  member: {
    accountGroupMemberships: unknown[];
    billingStatus: string;
    suspendedAt: Date | null;
    threadContainer: null | { owner: unknown };
  } | null;
  participantActive?: boolean;
  workspace: { userId: string } | null;
}) {
  return {
    hostedMember: {
      findUnique: vi.fn().mockResolvedValue(input.member),
    },
    hostedThreadContainerParticipant: {
      findFirst: vi.fn(async () => input.participantActive
        ? { participantMemberId: "member_active_participant" }
        : null),
    },
    hostedWorkspace: {
      findUnique: vi.fn().mockResolvedValue(input.workspace),
    },
  };
}
