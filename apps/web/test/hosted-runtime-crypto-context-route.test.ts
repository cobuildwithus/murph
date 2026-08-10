import { beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  readHostedRuntimeCryptoContextForWorker: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-crypto/domain-root-store", () => ({
  readHostedRuntimeCryptoContextForWorker: mocks.readHostedRuntimeCryptoContextForWorker,
}));

type RouteModule = typeof import("../app/api/internal/hosted-runtime/crypto-context/route");

let route: RouteModule;

describe("hosted runtime crypto-context route", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    route ??= await import("../app/api/internal/hosted-runtime/crypto-context/route");
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_crypto_1");
    mocks.readHostedRuntimeCryptoContextForWorker.mockResolvedValue({
      envelopes: {
        ingress: { schema: "ingress-envelope" },
        runtime: { schema: "runtime-envelope" },
      },
      schema: "murph.hosted-runtime-crypto-context.v1",
      userId: "member_crypto_1",
    });
  });

  it("returns signed workspace-bound crypto context without repeating caller admission", async () => {
    const prisma = createPrisma({
      workspace: { userId: "member_crypto_1" },
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await route.POST(new Request("https://join.example.test/api/internal/hosted-runtime/crypto-context", {
      method: "POST",
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(prisma.hostedWorkspace.findUnique).toHaveBeenCalledWith({
      select: { userId: true },
      where: { userId: "member_crypto_1" },
    });
    expect(mocks.readHostedRuntimeCryptoContextForWorker).toHaveBeenCalledWith({
      prisma,
      userId: "member_crypto_1",
    });
    expect(payload).toMatchObject({
      schema: "murph.hosted-runtime-crypto-context.v1",
      userId: "member_crypto_1",
    });
    expect(payload.fetchedAt).toEqual(expect.any(String));
  });

  it("rejects callbacks that do not have a provisioned hosted workspace", async () => {
    const prisma = createPrisma({
      workspace: null,
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await route.POST(new Request("https://join.example.test/api/internal/hosted-runtime/crypto-context", {
      method: "POST",
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "hosted_workspace_not_provisioned" });
    expect(mocks.readHostedRuntimeCryptoContextForWorker).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callbacks before reading workspace or crypto state", async () => {
    mocks.requireHostedCloudflareCallbackRequest.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
      httpStatus: 401,
      message: "Unauthorized hosted Cloudflare callback request.",
      retryable: false,
    }));

    const response = await route.POST(new Request(
      "https://join.example.test/api/internal/hosted-runtime/crypto-context",
      { method: "POST" },
    ));

    expect(response.status).toBe(401);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.readHostedRuntimeCryptoContextForWorker).not.toHaveBeenCalled();
  });
});

function createPrisma(input: { workspace: { userId: string } | null }) {
  return {
    hostedWorkspace: {
      findUnique: vi.fn().mockResolvedValue(input.workspace),
    },
  };
}
