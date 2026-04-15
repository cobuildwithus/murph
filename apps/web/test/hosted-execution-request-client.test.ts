import { describe, expect, it } from "vitest";

import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murphai/hosted-execution/contracts";

import { createHostedExecutionWebJsonRequester } from "@/src/lib/hosted-execution/request-client";

describe("createHostedExecutionWebJsonRequester", () => {
  it("forwards the bound user header when a request is user-bound", async () => {
    let observedRequest!: { init?: RequestInit; url: string };
    const requester = createHostedExecutionWebJsonRequester({
      baseUrl: "https://runner.example.test/root",
      fetchImpl: async (url, init) => {
        observedRequest = { init, url: String(url) };
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      },
      getBearerToken: async () => "Bearer token-123",
      timeoutMs: 1_000,
    });

    await expect(requester.requestJson({
      body: JSON.stringify({ ok: true }),
      boundUserId: "member_123",
      label: "example",
      method: "POST",
      parse: (value) => value as { ok: true },
      path: "/internal/users/member_123/example",
    })).resolves.toEqual({ ok: true });

    expect(observedRequest.url).toBe("https://runner.example.test/root/internal/users/member_123/example");
    expect(new Headers(observedRequest.init?.headers).get("authorization")).toBe("Bearer token-123");
    expect(new Headers(observedRequest.init?.headers).get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe(
      "member_123",
    );
  });
});
