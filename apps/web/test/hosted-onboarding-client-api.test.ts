import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HostedOnboardingApiError,
  requestHostedBillingCheckout,
  requestHostedOnboardingJson,
  requestHostedStarterUsageEnrollment,
} from "@/src/components/hosted-onboarding/client-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hosted onboarding client API", () => {
  it("enrolls Starter usage through the dedicated endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      redirectPath: "/home",
      status: "enrolled",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestHostedStarterUsageEnrollment({
      inviteCode: "invite_123",
    })).resolves.toEqual({ redirectPath: "/home", status: "enrolled" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hosted-onboarding/starter/enroll",
      expect.objectContaining({
        body: JSON.stringify({ inviteCode: "invite_123" }),
        method: "POST",
      }),
    );
  });

  it("starts paid access through the standard checkout endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      alreadyActive: false,
      url: "https://checkout.stripe.com/c/pay/cs_123",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestHostedBillingCheckout({
      billingPlanCode: "launch_edge_monthly",
      inviteCode: "invite_123",
    })).resolves.toMatchObject({ alreadyActive: false });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/hosted-onboarding/billing/checkout",
      expect.objectContaining({
        body: JSON.stringify({
          billingPlanCode: "launch_edge_monthly",
          inviteCode: "invite_123",
        }),
      }),
    );
  });

  it("preserves structured API errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: "HOSTED_STARTER_USAGE_ENROLLMENT_BLOCKED",
        message: "Open Settings to restore access.",
        retryable: false,
      },
    }), { status: 409 })));

    await expect(requestHostedOnboardingJson({ url: "/api/test" }))
      .rejects.toEqual(expect.objectContaining<Partial<HostedOnboardingApiError>>({
        code: "HOSTED_STARTER_USAGE_ENROLLMENT_BLOCKED",
        message: "Open Settings to restore access.",
        retryable: false,
      }));
  });
});
