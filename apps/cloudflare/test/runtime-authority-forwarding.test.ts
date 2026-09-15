import { describe, expect, it, vi } from "vitest";
import { fetchHostedExecutionWebControlPlaneResponse } from "../src/web-control-plane.ts";
import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murphai/hosted-execution/contracts";

describe("runtime callback authority forwarding", () => {
  const base = { baseUrl: "https://web.example.test", boundUserId: "synthetic_member", method: "POST" as const,
    path: "/api/internal/hosted-runtime/status", timeoutMs: 1000 };
  it("derives signed-query authority from the bound runtime headers", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({}));
    await fetchHostedExecutionWebControlPlaneResponse({ ...base, fetchImpl, headers: new Headers({
      "x-hosted-runtime-attempt-id": "synthetic_attempt", "x-hosted-runtime-lease-generation": "7",
    }) });
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.searchParams.get("runtimeAttempt")).toBe("synthetic_attempt");
    expect(url.searchParams.get("runtimeGeneration")).toBe("7");
  });
  it("rejects caller-supplied authority before signing or forwarding", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({}));
    for (const search of ["runtimeAuthority=1&runtimeAttempt=synthetic&runtimeGeneration=7", "runtimeGeneration=7"]) {
      await expect(fetchHostedExecutionWebControlPlaneResponse({ ...base, fetchImpl, search })).rejects.toThrow();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("strips a supplied member header from system migration calls", async () => {
    let forwarded: Headers | undefined;
    await fetchHostedExecutionWebControlPlaneResponse({ ...base, boundUserId: null,
      headers: new Headers({ [HOSTED_EXECUTION_USER_ID_HEADER]: "synthetic_injected_member" }),
      fetchImpl: async (_url, init) => { forwarded = new Headers(init?.headers); return Response.json({}); },
    });
    expect(forwarded?.has(HOSTED_EXECUTION_USER_ID_HEADER)).toBe(false);
  });
});
