import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  getIdentityToken: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  getAccessToken: mocks.getAccessToken,
  getIdentityToken: mocks.getIdentityToken,
}));

import {
  requestHostedOnboardingJson,
  resetHostedOnboardingAuthHeadersForTests,
} from "@/src/components/hosted-onboarding/client-api";

describe("hosted onboarding client auth headers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHostedOnboardingAuthHeadersForTests();
    vi.stubGlobal("location", {
      origin: "https://join.example.test",
    });
  });

  it("fails explicitly before fetch when the Privy session is missing required tokens", async () => {
    mocks.getAccessToken.mockResolvedValue("signed-access-token");
    mocks.getIdentityToken.mockResolvedValue(null);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestHostedOnboardingJson<{ ok: true }>({
      url: "/api/hosted-onboarding/example",
    })).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: "Verify your phone to continue.",
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows optional-auth requests to proceed without Privy headers when tokens are unavailable", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
    }), {
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestHostedOnboardingJson<{ ok: true }>({
      auth: "optional",
      url: "/api/hosted-onboarding/example",
    })).resolves.toEqual({
      ok: true,
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/hosted-onboarding/example", expect.objectContaining({
      headers: {},
    }));
    expect(mocks.getAccessToken).not.toHaveBeenCalled();
    expect(mocks.getIdentityToken).not.toHaveBeenCalled();
  });

  it("sends explicit Privy headers on the first authenticated request", async () => {
    mocks.getAccessToken.mockResolvedValue("signed-access-token");
    mocks.getIdentityToken.mockResolvedValue("signed-identity-token");
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/hosted-onboarding/example", expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer signed-access-token",
        "x-privy-identity-token": "signed-identity-token",
      }),
    }));
  });

  it("refreshes explicit Privy headers after a 401 response", async () => {
    mocks.getAccessToken.mockResolvedValue("signed-access-token");
    mocks.getIdentityToken.mockResolvedValue("signed-identity-token");
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          code: "AUTH_REQUIRED",
          message: "Verify your phone to continue.",
        },
      }), {
        status: 401,
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
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
    expect(mocks.getAccessToken).toHaveBeenCalledTimes(2);
    expect(mocks.getIdentityToken).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/hosted-onboarding/example", expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer signed-access-token",
        "x-privy-identity-token": "signed-identity-token",
      }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/hosted-onboarding/example", expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer signed-access-token",
        "x-privy-identity-token": "signed-identity-token",
      }),
    }));
  });

  it("refreshes explicit Privy headers after a 403 Privy session mismatch response", async () => {
    mocks.getAccessToken.mockResolvedValue("signed-access-token");
    mocks.getIdentityToken.mockResolvedValue("signed-identity-token");
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          code: "PRIVY_SESSION_MISMATCH",
          message: "Privy session changed.",
        },
      }), {
        status: 403,
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
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

    expect(mocks.getAccessToken).toHaveBeenCalledTimes(2);
    expect(mocks.getIdentityToken).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry unrelated 403 onboarding responses", async () => {
    mocks.getAccessToken.mockResolvedValue("signed-access-token");
    mocks.getIdentityToken.mockResolvedValue("signed-identity-token");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({
      error: {
        code: "INVITE_INVALID",
        message: "Invite is invalid.",
      },
    }), {
      status: 403,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestHostedOnboardingJson<{ ok: true }>({
      url: "/api/hosted-onboarding/example",
    })).rejects.toMatchObject({
      code: "INVITE_INVALID",
      message: "Invite is invalid.",
    });

    expect(mocks.getAccessToken).toHaveBeenCalledTimes(1);
    expect(mocks.getIdentityToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails explicitly before fetch when Privy token refresh stays unavailable", async () => {
    mocks.getAccessToken.mockRejectedValue(new Error("temporary failure"));
    mocks.getIdentityToken.mockRejectedValue(new Error("temporary failure"));
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestHostedOnboardingJson<{ ok: true }>({
      url: "/api/hosted-onboarding/example",
    })).rejects.toMatchObject({
      code: "PRIVY_AUTH_UNAVAILABLE",
      message: "We could not refresh your Privy session. Wait a moment and try again.",
      retryable: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a clearer retry message when Privy rate-limits token refresh", async () => {
    const rateLimitError = Object.assign(new Error("Too Many Requests"), {
      status: 429,
    });
    mocks.getAccessToken.mockRejectedValue(rateLimitError);
    mocks.getIdentityToken.mockRejectedValue(rateLimitError);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestHostedOnboardingJson<{ ok: true }>({
      url: "/api/hosted-onboarding/example",
    })).rejects.toMatchObject({
      code: "PRIVY_RATE_LIMITED",
      message:
        "Privy is rate limiting this browser right now. Wait a minute, then try continuing signup again.",
      retryable: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps message-only token refresh failures on the generic unavailable path", async () => {
    mocks.getAccessToken.mockRejectedValue(new Error("Too Many Requests"));
    mocks.getIdentityToken.mockRejectedValue(new Error("Too Many Requests"));
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestHostedOnboardingJson<{ ok: true }>({
      url: "/api/hosted-onboarding/example",
    })).rejects.toMatchObject({
      code: "PRIVY_AUTH_UNAVAILABLE",
      message: "We could not refresh your Privy session. Wait a moment and try again.",
      retryable: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries token retrieval once before issuing the authenticated fetch", async () => {
    mocks.getAccessToken
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("signed-access-token");
    mocks.getIdentityToken
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("signed-identity-token");
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/hosted-onboarding/example", expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer signed-access-token",
        "x-privy-identity-token": "signed-identity-token",
      }),
    }));
  });

  it("reuses a short-lived explicit auth header burst after the first fallback", async () => {
    mocks.getAccessToken.mockResolvedValue("signed-access-token");
    mocks.getIdentityToken.mockResolvedValue("signed-identity-token");
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          code: "AUTH_REQUIRED",
          message: "Verify your phone to continue.",
        },
      }), {
        status: 401,
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
      }), {
        status: 200,
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: {
          code: "AUTH_REQUIRED",
          message: "Verify your phone to continue.",
        },
      }), {
        status: 401,
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
      }), {
        status: 200,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestHostedOnboardingJson<{ ok: true }>({
      url: "/api/hosted-onboarding/example",
    })).resolves.toEqual({ ok: true });
    await expect(requestHostedOnboardingJson<{ ok: true }>({
      url: "/api/hosted-onboarding/example",
    })).resolves.toEqual({ ok: true });

    expect(mocks.getAccessToken).toHaveBeenCalledTimes(3);
    expect(mocks.getIdentityToken).toHaveBeenCalledTimes(3);
  });

  it("fails cleanly when a successful response has an empty body", async () => {
    mocks.getAccessToken.mockResolvedValue("signed-access-token");
    mocks.getIdentityToken.mockResolvedValue("signed-identity-token");
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
    mocks.getAccessToken.mockResolvedValue("signed-access-token");
    mocks.getIdentityToken.mockResolvedValue("signed-identity-token");
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
