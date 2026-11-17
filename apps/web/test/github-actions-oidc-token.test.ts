import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitHubActionsOidcTokenSupplier } from "@/scripts/github-actions-oidc-token";
import { LINQ_PRODUCTION_CANARY_OIDC_AUDIENCE } from "@/src/lib/hosted-onboarding/linq-production-canary-contract";

const source = {
  ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc.example.test/token?existing=value",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "synthetic-request-token",
  MURPH_LINQ_PRODUCTION_CANARY_RESET_SECRET: "unused-static-secret",
};

afterEach(() => vi.unstubAllGlobals());

describe("canary request-time GitHub OIDC supplier", () => {
  it("requests a fresh dedicated-audience token on every call", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ value: "synthetic-first-token" }))
      .mockResolvedValueOnce(Response.json({ value: "synthetic-next-token" }));
    vi.stubGlobal("fetch", fetchMock);
    const getToken = createGitHubActionsOidcTokenSupplier(source, LINQ_PRODUCTION_CANARY_OIDC_AUDIENCE);
    const signal = new AbortController().signal;
    await expect(getToken(signal)).resolves.toBe("synthetic-first-token");
    await expect(getToken(signal)).resolves.toBe("synthetic-next-token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url.searchParams.get("audience")).toBe(LINQ_PRODUCTION_CANARY_OIDC_AUDIENCE);
    expect(url.searchParams.get("existing")).toBe("value");
    expect(options).toMatchObject({ redirect: "error", headers: { authorization: "Bearer synthetic-request-token" } });
  });

  it.each(["missing-config", "status", "invalid-body", "empty-token", "network"])(
    "fails closed without static retry or private error details: %s", async (mode) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      if (mode === "network") fetchMock.mockRejectedValue(new Error("synthetic-private-provider-details"));
      else fetchMock.mockResolvedValue(mode === "status"
        ? new Response("synthetic-private-provider-details", { status: 403 })
        : Response.json(mode === "empty-token" ? { value: "" } : { unexpected: "synthetic-private-provider-details" }));
      const getToken = createGitHubActionsOidcTokenSupplier(mode === "missing-config"
        ? { MURPH_LINQ_PRODUCTION_CANARY_RESET_SECRET: "unused-static-secret" } : source, LINQ_PRODUCTION_CANARY_OIDC_AUDIENCE);
      await expect(getToken(new AbortController().signal)).rejects.toMatchObject({
        name: "oidc-token-unavailable", message: "The Linq production canary failed.",
      });
      expect(fetchMock).toHaveBeenCalledTimes(mode === "missing-config" ? 0 : 1);
    },
  );

  it("keeps token acquisition inside the caller's observation deadline", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async (_url, options: RequestInit) => {
      controller.abort();
      options.signal?.throwIfAborted();
    }));
    await expect(createGitHubActionsOidcTokenSupplier(source, LINQ_PRODUCTION_CANARY_OIDC_AUDIENCE)(controller.signal))
      .rejects.toMatchObject({ name: "oidc-token-unavailable" });
  });
});
