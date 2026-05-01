import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("returns signed runtime crypto context for an active member with a provisioned workspace", async () => {
    const prisma = createPrisma({
      member: { billingStatus: "active", suspendedAt: null },
      workspace: { userId: "member_crypto_1" },
    });
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await route.POST(new Request("https://join.example.test/api/internal/hosted-runtime/crypto-context", {
      method: "POST",
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(prisma.hostedMember.findUnique).toHaveBeenCalledWith({
      select: { billingStatus: true, suspendedAt: true },
      where: { id: "member_crypto_1" },
    });
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

  it("rejects missing, inactive, or suspended hosted members before reading crypto roots", async () => {
    for (const member of [
      null,
      { billingStatus: "not_started", suspendedAt: null },
      { billingStatus: "active", suspendedAt: new Date("2026-05-01T00:00:00.000Z") },
    ]) {
      const prisma = createPrisma({
        member,
        workspace: { userId: "member_crypto_1" },
      });
      mocks.getPrisma.mockReturnValue(prisma);
      mocks.readHostedRuntimeCryptoContextForWorker.mockClear();

      const response = await route.POST(new Request("https://join.example.test/api/internal/hosted-runtime/crypto-context", {
        method: "POST",
      }));

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: "hosted_member_not_active" });
      expect(prisma.hostedWorkspace.findUnique).not.toHaveBeenCalled();
      expect(mocks.readHostedRuntimeCryptoContextForWorker).not.toHaveBeenCalled();
    }
  });

  it("rejects active members that do not have a provisioned hosted workspace", async () => {
    const prisma = createPrisma({
      member: { billingStatus: "active", suspendedAt: null },
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
});

function createPrisma(input: {
  member: { billingStatus: string; suspendedAt: Date | null } | null;
  workspace: { userId: string } | null;
}) {
  return {
    hostedMember: {
      findUnique: vi.fn().mockResolvedValue(input.member),
    },
    hostedWorkspace: {
      findUnique: vi.fn().mockResolvedValue(input.workspace),
    },
  };
}
