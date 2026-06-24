import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  hasHostedMemberEffectiveActiveAccessForMember: vi.fn(),
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

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  hasHostedMemberEffectiveActiveAccessForMember:
    mocks.hasHostedMemberEffectiveActiveAccessForMember,
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
    mocks.hasHostedMemberEffectiveActiveAccessForMember.mockResolvedValue(true);
    mocks.getPrisma.mockReturnValue({
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: "active",
          id: "member_123",
          suspendedAt: null,
        }),
      },
      hostedWorkspace: {
        findUnique: vi.fn().mockResolvedValue({
          userId: "member_123",
        }),
      },
    });
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
});
