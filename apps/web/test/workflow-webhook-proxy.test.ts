import assert from "node:assert/strict";

import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, it } from "vitest";

import { config, proxy, rejectMalformedWorkflowWebhookToken } from "../proxy";

describe("workflow webhook proxy", () => {
  it("returns 400 for malformed percent-encoded webhook tokens", async () => {
    const response = rejectMalformedWorkflowWebhookToken(
      "/.well-known/workflow/v1/webhook/%E0%A4%A",
    );

    assert.equal(response?.status, 400);
    assert.equal(await response?.text(), "Malformed token");
  });

  it.each(["%", "%2", "%GG", "%E0%A4%A", "%FF"])(
    "selects and rejects malformed first token %s",
    async (token) => {
      const request = new NextRequest(`https://example.test/.well-known/workflow/v1/webhook/${token}`);
      assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: request.url }), true);

      const response = proxy(request);
      assert.equal(response.status, 400);
      assert.equal(await response.text(), "Malformed token");
      assert.equal(response.headers.get("x-middleware-next"), null);
      assert.equal(response.headers.get("x-middleware-rewrite"), null);
    },
  );

  it.each([
    "token123",
    "token%20123",
    "token%2F123",
    "token%5C123",
    "token%252F",
    "token123?value=%E0%A4%A",
    "token123/%E0%A4%A",
  ])("preserves first-token-only validation for %s", (token) => {
    const url = `https://example.test/.well-known/workflow/v1/webhook/${token}`;
    const request = new NextRequest(url);
    assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }), true);
    const response = proxy(request);
    assert.equal(response.headers.get("x-middleware-next"), "1");
    assert.equal(response.headers.get("x-middleware-rewrite"), null);
    assert.equal(request.url, url);
  });

  it("ignores unrelated paths", () => {
    assert.equal(rejectMalformedWorkflowWebhookToken("/api/hosted-onboarding/linq/webhook"), null);
  });
});
