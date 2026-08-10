import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

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

  it("returns historical workspace roots without repeating caller admission", async () => {
    const prisma = createPrisma({
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
    expect(prisma.hostedWorkspace.findUnique).toHaveBeenCalledWith({
      select: { userId: true },
      where: { userId: "member_123" },
    });
    expect(mocks.readHostedDomainRootEnvelopeByRootKeyIdOrThrow).toHaveBeenCalledWith({
      domain: "runtime",
      prisma,
      rootKeyId: "udrk:runtime:test-root",
      userId: "member_123",
    });
  });

  it("rejects callbacks that do not have a provisioned hosted workspace", async () => {
    mocks.getPrisma.mockReturnValue(createPrisma({ workspace: null }));

    const response = await hostedRuntimeCryptoRootRoute.POST(
      new Request("https://join.example.test/api/internal/hosted-runtime/crypto-context/root", {
        body: JSON.stringify({
          domain: "runtime",
          rootKeyId: "udrk:runtime:test-root",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "hosted_workspace_not_provisioned",
    });
    expect(mocks.readHostedDomainRootEnvelopeByRootKeyIdOrThrow).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callbacks before reading workspace or crypto state", async () => {
    mocks.requireHostedCloudflareCallbackRequest.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
      httpStatus: 401,
      message: "Unauthorized hosted Cloudflare callback request.",
      retryable: false,
    }));

    const response = await hostedRuntimeCryptoRootRoute.POST(
      new Request("https://join.example.test/api/internal/hosted-runtime/crypto-context/root", {
        body: JSON.stringify({
          domain: "runtime",
          rootKeyId: "udrk:runtime:test-root",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.readHostedDomainRootEnvelopeByRootKeyIdOrThrow).not.toHaveBeenCalled();
  });
});

function createPrisma(input: {
  workspace: { userId: string } | null;
}) {
  return {
    hostedWorkspace: {
      findUnique: vi.fn().mockResolvedValue(input.workspace),
    },
  };
}
