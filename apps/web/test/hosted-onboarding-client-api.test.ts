import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HostedOnboardingApiError,
  requestHostedBillingCheckout,
  requestHostedOnboardingJson,
  requestHostedPulseTrialStartPaid,
} from "@/src/components/hosted-onboarding/client-api";

describe("hosted onboarding client api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses same-origin credentials and no-store cache for GET requests", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
    }), {
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestHostedOnboardingJson<{ ok: true }>({
      url: "/api/hosted-onboarding/example",
    })).resolves.toEqual({
      ok: true,
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/hosted-onboarding/example", {
      body: undefined,
      cache: "no-store",
      credentials: "same-origin",
      headers: {},
      keepalive: false,
      method: "GET",
    });
  });

  it("posts JSON bodies without changing the default same-origin credentials", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
    }), {
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestHostedOnboardingJson<{ ok: true }>({
      payload: {
        inviteCode: "invite-code",
      },
      url: "/api/hosted-onboarding/example",
    })).resolves.toEqual({
      ok: true,
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/hosted-onboarding/example", {
      body: JSON.stringify({
        inviteCode: "invite-code",
      }),
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
      },
      keepalive: false,
      method: "POST",
    });
  });

  it("sends DELETE JSON requests through the shared hosted API helper", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
    }), {
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestHostedOnboardingJson<{ ok: true }>({
      method: "DELETE",
      payload: {},
      url: "/api/settings/chatgpt",
    })).resolves.toEqual({
      ok: true,
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/settings/chatgpt", {
      body: JSON.stringify({}),
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
      },
      keepalive: false,
      method: "DELETE",
    });
  });

  it("allows explicit fetch credential overrides", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
    }), {
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestHostedOnboardingJson<{ ok: true }>({
      credentials: "include",
      url: "/api/hosted-onboarding/example",
    })).resolves.toEqual({
      ok: true,
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/hosted-onboarding/example", expect.objectContaining({
      credentials: "include",
    }));
  });

  it("surfaces structured hosted onboarding errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      error: {
        code: "AUTH_REQUIRED",
        details: {
          reason: "missing_cookie",
        },
        message: "Verify your phone to continue.",
        retryable: true,
      },
    }), {
      status: 401,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestHostedOnboardingJson<{ ok: true }>({
      url: "/api/hosted-onboarding/example",
    })).rejects.toEqual(new HostedOnboardingApiError({
      code: "AUTH_REQUIRED",
      details: {
        reason: "missing_cookie",
      },
      message: "Verify your phone to continue.",
      retryable: true,
    }));
  });

  it("posts checkout offer in billing checkout requests", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      alreadyActive: false,
      url: "https://stripe.example.test/trial",
    }), {
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestHostedBillingCheckout({
      billingPlanCode: "launch_monthly",
      checkoutOffer: "pulse_trial_7d",
      inviteCode: "invite-code",
    })).resolves.toEqual({
      alreadyActive: false,
      url: "https://stripe.example.test/trial",
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/hosted-onboarding/billing/checkout", {
      body: JSON.stringify({
        billingPlanCode: "launch_monthly",
        checkoutOffer: "pulse_trial_7d",
        inviteCode: "invite-code",
      }),
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
      },
      keepalive: false,
      method: "POST",
    });
  });

  it("posts Start Pulse without a body and returns started status", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      billingPlanCode: "launch_monthly",
      status: "started",
    }), {
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestHostedPulseTrialStartPaid()).resolves.toEqual({
      status: "started",
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/settings/billing/start-paid-pulse", {
      body: undefined,
      cache: "no-store",
      credentials: "same-origin",
      headers: {},
      keepalive: false,
      method: "POST",
    });
  });

  it("keeps Start Pulse pending without redirecting", async () => {
    const assign = vi.fn();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      billingPlanCode: "launch_monthly",
      status: "billing_pending",
    }), {
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", {
      location: {
        assign,
      },
    });

    await expect(requestHostedPulseTrialStartPaid()).resolves.toEqual({
      status: "billing_pending",
    });
    expect(assign).not.toHaveBeenCalled();
  });

  it("redirects when Start Pulse requires payment", async () => {
    const assign = vi.fn();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      billingPlanCode: "launch_monthly",
      paymentUrl: "https://invoice.stripe.test/in_123",
      status: "payment_required",
    }), {
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", {
      location: {
        assign,
      },
    });

    await expect(requestHostedPulseTrialStartPaid()).resolves.toEqual({
      status: "redirecting",
    });
    expect(assign).toHaveBeenCalledWith("https://invoice.stripe.test/in_123");
  });

  it("rejects payment-required Start Pulse responses without a payment URL", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      billingPlanCode: "launch_monthly",
      status: "payment_required",
    }), {
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestHostedPulseTrialStartPaid()).rejects.toMatchObject({
      code: null,
      message: "Payment link missing.",
    });
  });

  it("fails cleanly when a successful response has an empty body", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("", {
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestHostedOnboardingJson<{ ok: true }>({
      url: "/api/hosted-onboarding/example",
    })).rejects.toMatchObject({
      code: null,
      message: "Request returned an unexpected response.",
      name: "HostedOnboardingApiError",
    });
  });

  it("falls back to a controlled failure for malformed error bodies", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("{", {
      status: 503,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestHostedOnboardingJson<{ ok: true }>({
      url: "/api/hosted-onboarding/example",
    })).rejects.toMatchObject({
      code: null,
      message: "Something went wrong. Try again.",
      retryable: false,
    });
  });
});
