import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  applyHostedCodexAuthUpdate: vi.fn(),
  requireHostedCloudflareCallbackRequest: vi.fn(),
}));

vi.mock("@/src/lib/codex-auth/store", () => ({
  applyHostedCodexAuthUpdate: mocks.applyHostedCodexAuthUpdate,
}));

vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: mocks.requireHostedCloudflareCallbackRequest,
}));

type CodexAuthInternalRouteModule =
  typeof import("../app/api/internal/hosted-runtime/codex-auth/route");

let route: CodexAuthInternalRouteModule;

describe("hosted Codex auth internal callback route", () => {
  beforeAll(async () => {
    route = await import("../app/api/internal/hosted-runtime/codex-auth/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.applyHostedCodexAuthUpdate.mockResolvedValue({
      applied: true,
      status: "applied",
    });
    mocks.requireHostedCloudflareCallbackRequest.mockResolvedValue("member_123");
  });

  it("verifies the signed raw body before applying a Codex auth update", async () => {
    const body = JSON.stringify({
      attemptId: "hca_abcdefghijklmnop",
      phase: "device_code",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://auth.openai.com/device",
    });
    const request = new Request("https://join.example.test/api/internal/hosted-runtime/codex-auth", {
      body,
      headers: {
        "content-type": "application/json",
        "x-hosted-runtime-attempt-id": "runtime_write_123",
        "x-hosted-runtime-lease-generation": "7",
      },
      method: "POST",
    });

    const response = await route.POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      applied: true,
      status: "applied",
    });
    expect(mocks.requireHostedCloudflareCallbackRequest).toHaveBeenCalledWith(request, {
      maxBodyBytes: 4_096,
      payloadText: body,
    });
    expect(mocks.applyHostedCodexAuthUpdate).toHaveBeenCalledWith({
      memberId: "member_123",
      update: {
        attemptId: "hca_abcdefghijklmnop",
        phase: "device_code",
        userCode: "ABCD-EFGH",
        verificationUrl: "https://auth.openai.com/device",
      },
    });
  });

  it("rejects unauthenticated callbacks before applying updates", async () => {
    mocks.requireHostedCloudflareCallbackRequest.mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
      httpStatus: 401,
      message: "Unauthorized hosted Cloudflare callback request.",
      retryable: false,
    }));

    const response = await route.POST(new Request(
      "https://join.example.test/api/internal/hosted-runtime/codex-auth",
      {
        body: JSON.stringify({
          attemptId: "hca_abcdefghijklmnop",
          phase: "connected",
        }),
        headers: {
          "content-type": "application/json",
          "x-hosted-runtime-attempt-id": "runtime_write_123",
          "x-hosted-runtime-lease-generation": "7",
        },
        method: "POST",
      },
    ));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
        message: "Unauthorized hosted Cloudflare callback request.",
        retryable: false,
      },
    });
    expect(mocks.applyHostedCodexAuthUpdate).not.toHaveBeenCalled();
  });

  it("rejects callbacks without runtime write-fence headers before applying updates", async () => {
    const response = await route.POST(new Request(
      "https://join.example.test/api/internal/hosted-runtime/codex-auth",
      {
        body: JSON.stringify({
          attemptId: "hca_abcdefghijklmnop",
          phase: "connected",
        }),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      },
    ));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_CODEX_AUTH_WRITE_FENCE_REQUIRED",
        message: "Hosted Codex auth update requires the active runtime write fence.",
        retryable: false,
      },
    });
    expect(mocks.requireHostedCloudflareCallbackRequest).not.toHaveBeenCalled();
    expect(mocks.applyHostedCodexAuthUpdate).not.toHaveBeenCalled();
  });
});
