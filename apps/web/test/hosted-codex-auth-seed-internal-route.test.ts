import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  readHostedCodexAuthAccessSeedForRuntime: vi.fn(),
  readHostedRuntimeWriteFence: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/codex-auth/store", () => ({
  readHostedCodexAuthAccessSeedForRuntime: mocks.readHostedCodexAuthAccessSeedForRuntime,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

vi.mock("@/src/lib/hosted-execution/runtime-write-fence", () => ({
  readHostedRuntimeWriteFence: mocks.readHostedRuntimeWriteFence,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type RouteModule =
  typeof import("../app/api/internal/hosted-runtime/codex-auth/seed/route");

const PRISMA = { prisma: true };
const CONNECTION_VERSION = "hca_abcdefghijklmnop";
const ACCESS_TOKEN = "synthetic-access-value";

let route: RouteModule;

describe("hosted Codex auth seed internal route", () => {
  beforeAll(async () => {
    route = await import("../app/api/internal/hosted-runtime/codex-auth/seed/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue(PRISMA);
    mocks.readHostedCodexAuthAccessSeedForRuntime.mockResolvedValue({
      accessToken: ACCESS_TOKEN,
      chatgptAccountId: "account_123",
      connectionVersion: CONNECTION_VERSION,
      expiresAt: "2026-07-21T21:00:00.000Z",
      schemaVersion: 1,
      status: "available",
    });
    mocks.readHostedRuntimeWriteFence.mockReturnValue({
      attemptId: "runtime_attempt_123",
      leaseGeneration: "7",
      workspaceVersion: "11",
    });
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
  });

  it("checks the runtime fence before signed auth and returns a bounded no-store seed", async () => {
    const order: string[] = [];
    mocks.readHostedRuntimeWriteFence.mockImplementationOnce(() => {
      order.push("fence");
      return {
        attemptId: "runtime_attempt_123",
        leaseGeneration: "7",
        workspaceVersion: "11",
      };
    });
    mocks.requireHostedCloudflareCallbackRequest.mockImplementationOnce(async () => {
      order.push("auth");
      return "member_123";
    });
    mocks.readHostedCodexAuthAccessSeedForRuntime.mockImplementationOnce(async () => {
      order.push("read");
      return {
        accessToken: ACCESS_TOKEN,
        chatgptAccountId: "account_123",
        connectionVersion: CONNECTION_VERSION,
        expiresAt: "2026-07-21T21:00:00.000Z",
        schemaVersion: 1,
        status: "available",
      };
    });
    const body = JSON.stringify({
      knownConnectionVersion: null,
      schemaVersion: 1,
    });
    const request = signedRequest(body);

    const response = await route.POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      accessToken: ACCESS_TOKEN,
      chatgptAccountId: "account_123",
      connectionVersion: CONNECTION_VERSION,
      expiresAt: "2026-07-21T21:00:00.000Z",
      schemaVersion: 1,
      status: "available",
    });
    expect(order).toEqual(["fence", "auth", "read"]);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(request, {
      maxBodyBytes: 4_096,
      payloadText: body,
    });
    expect(mocks.readHostedCodexAuthAccessSeedForRuntime).toHaveBeenCalledWith({
      knownConnectionVersion: null,
      memberId: "member_123",
      prisma: PRISMA,
    });
  });

  it("rejects missing write-fence headers before signed auth", async () => {
    mocks.readHostedRuntimeWriteFence.mockReturnValueOnce(null);

    const response = await route.POST(signedRequest(JSON.stringify({
      knownConnectionVersion: null,
      schemaVersion: 1,
    })));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_CODEX_AUTH_SEED_WRITE_FENCE_REQUIRED",
        message: "Hosted Codex auth seed read requires the active runtime write fence.",
        retryable: false,
      },
    });
    expect(mocks.requireHostedCloudflareCallbackRequest).not.toHaveBeenCalled();
    expect(mocks.readHostedCodexAuthAccessSeedForRuntime).not.toHaveBeenCalled();
  });

  it("requires signed callback auth before parsing or reading the seed", async () => {
    mocks.requireHostedCloudflareCallbackRequest.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
      httpStatus: 401,
      message: "Unauthorized hosted Cloudflare callback request.",
    }));

    const response = await route.POST(signedRequest("malformed signed body"));

    expect(response.status).toBe(401);
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedCodexAuthAccessSeedForRuntime).not.toHaveBeenCalled();
  });

  it("strictly rejects unknown credential fields without echoing or logging them", async () => {
    const sentinel = "sensitive-refresh-sentinel";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await route.POST(signedRequest(JSON.stringify({
      knownConnectionVersion: null,
      refreshToken: sentinel,
      schemaVersion: 1,
    })));

    expect(response.status).toBe(400);
    const responseText = await response.text();
    expect(responseText).not.toContain(sentinel);
    expect(JSON.stringify([...warn.mock.calls, ...error.mock.calls])).not.toContain(sentinel);
    expect(mocks.readHostedCodexAuthAccessSeedForRuntime).not.toHaveBeenCalled();
  });

  it("caps the signed raw request body before auth", async () => {
    const response = await route.POST(signedRequest("x".repeat(4_097)));

    expect(response.status).toBe(413);
    expect(mocks.requireHostedCloudflareCallbackRequest).not.toHaveBeenCalled();
    expect(mocks.readHostedCodexAuthAccessSeedForRuntime).not.toHaveBeenCalled();
  });

  it("never echoes or logs sensitive underlying read failures", async () => {
    const sentinel = "sensitive-crypto-failure-sentinel";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.readHostedCodexAuthAccessSeedForRuntime.mockRejectedValueOnce(new Error(sentinel));

    const response = await route.POST(signedRequest(JSON.stringify({
      knownConnectionVersion: CONNECTION_VERSION,
      schemaVersion: 1,
    })));

    expect(response.status).toBe(500);
    const responseText = await response.text();
    expect(responseText).not.toContain(sentinel);
    expect(JSON.stringify([...warn.mock.calls, ...error.mock.calls])).not.toContain(sentinel);
  });
});

function signedRequest(body: string): Request {
  return new Request(
    "https://join.example.test/api/internal/hosted-runtime/codex-auth/seed",
    {
      body,
      headers: {
        "content-type": "application/json",
        "x-hosted-runtime-attempt-id": "runtime_attempt_123",
        "x-hosted-runtime-lease-generation": "7",
        "x-hosted-runtime-workspace-version": "11",
      },
      method: "POST",
    },
  );
}
