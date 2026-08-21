import assert from "node:assert/strict";

import { NextRequest } from "next/server";
import { describe, it } from "vitest";

import { config, proxy, rejectMalformedWorkflowWebhookToken } from "../proxy";

describe("workflow webhook proxy", () => {
  it("guards the generated workflow webhook route", () => {
    assert.deepEqual(config.matcher, [
      "/",
      "/.well-known/workflow/v1/webhook/:path*",
    ]);
  });

  it("returns 400 for malformed percent-encoded webhook tokens", async () => {
    const response = rejectMalformedWorkflowWebhookToken(
      "/.well-known/workflow/v1/webhook/%E0%A4%A",
    );

    assert.equal(response?.status, 400);
    assert.equal(await response?.text(), "Malformed token");
  });

  it("returns 400 from the proxy entrypoint for malformed token paths", async () => {
    const response = proxy(
      new NextRequest("https://example.test/.well-known/workflow/v1/webhook/%E0%A4%A"),
    );

    assert.equal(response.status, 400);
    assert.equal(await response.text(), "Malformed token");
  });

  it("lets valid workflow webhook tokens continue to the generated route", () => {
    assert.equal(
      rejectMalformedWorkflowWebhookToken("/.well-known/workflow/v1/webhook/token%20123"),
      null,
    );
  });

  it("ignores unrelated paths", () => {
    assert.equal(rejectMalformedWorkflowWebhookToken("/api/hosted-onboarding/linq/webhook"), null);
  });
});
