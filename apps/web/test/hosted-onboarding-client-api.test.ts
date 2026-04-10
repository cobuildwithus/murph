import { beforeEach, describe, expect, it, vi } from "vitest";

import { HostedOnboardingApiError, requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";

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
      message: "Request failed.",
      retryable: false,
    });
  });
});
