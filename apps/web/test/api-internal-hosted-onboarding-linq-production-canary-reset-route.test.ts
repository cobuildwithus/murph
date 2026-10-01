import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  phoneNumber: "+15551234567",
  prisma: {},
  requireResetRequest: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/linq-production-canary-reset", () => ({
  requireHostedLinqProductionCanaryResetRequest: mocks.requireResetRequest,
  resetHostedLinqProductionCanary: mocks.reset,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => mocks.prisma,
}));

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { POST } from "@/app/api/internal/hosted-onboarding/linq/production-canary/reset/route";

describe("POST /api/internal/hosted-onboarding/linq/production-canary/reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireResetRequest.mockReturnValue(mocks.phoneNumber);
    mocks.reset.mockResolvedValue({
      accountDeleted: true,
      admissionBudgetCount: 1,
      admissionDecisionCount: 1,
      deliveryClaimCount: 0,
    });
  });

  it("resets only the server-configured target and returns bounded counts", async () => {
    const request = new Request("https://example.test/api/internal/hosted-onboarding/linq/production-canary/reset", {
      headers: { authorization: "Bearer test-reset-secret" },
      method: "POST",
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      reset: {
        accountDeleted: true,
        admissionBudgetCount: 1,
        admissionDecisionCount: 1,
        deliveryClaimCount: 0,
      },
    });
    expect(mocks.requireResetRequest).toHaveBeenCalledWith(request);
    expect(mocks.reset).toHaveBeenCalledWith({
      phoneNumber: mocks.phoneNumber,
      prisma: mocks.prisma,
      request,
    });
  });

  it("authenticates before rejecting a query selector", async () => {
    const request = new Request("https://example.test/api/internal/hosted-onboarding/linq/production-canary/reset?phone=%2B15550000000", {
      method: "POST",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(mocks.requireResetRequest).toHaveBeenCalledOnce();
    expect(mocks.reset).not.toHaveBeenCalled();
  });

  it("rejects a body selector", async () => {
    const request = new Request("https://example.test/api/internal/hosted-onboarding/linq/production-canary/reset", {
      body: "{}",
      method: "POST",
    });

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(mocks.reset).not.toHaveBeenCalled();
  });

  it("does not inspect inputs or reset when authorization fails", async () => {
    mocks.requireResetRequest.mockImplementationOnce(() => {
      throw hostedOnboardingError({
        code: "HOSTED_LINQ_PRODUCTION_CANARY_UNAUTHORIZED",
        httpStatus: 401,
        message: "Unauthorized production canary reset request.",
      });
    });
    const request = new Request("https://example.test/api/internal/hosted-onboarding/linq/production-canary/reset?phone=private", {
      body: "{}",
      method: "POST",
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(mocks.reset).not.toHaveBeenCalled();
  });
});
