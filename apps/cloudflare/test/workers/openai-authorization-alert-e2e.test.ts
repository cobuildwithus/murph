/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import {
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
} from "../../src/runner-egress-intercept.ts";
import type {
  WorkerEnvironmentSource,
} from "../../src/worker-routes/shared.ts";
import worker from "./worker-entry.ts";
import {
  readDatabaseHealthMessageRequests,
  resetDatabaseHealthMessageRequests,
} from "./database-health-fetch.ts";

describe("OpenAI authorization alert Worker path", () => {
  it("returns the upstream 401 and sends one privacy-safe page to both operators", async () => {
    resetDatabaseHealthMessageRequests();

    const response = await worker.fetch(
      new Request("http://worker.test/__test/openai-authorization-alert", {
        method: "POST",
      }),
      env as WorkerEnvironmentSource,
    );

    expect(response.status).toBe(401);
    expect(response.statusText).toBe("Synthetic Unauthorized");
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json",
    );
    expect(response.headers.get("x-private-response-header")).toBe(
      "private-response-header",
    );
    expect(await response.text()).toBe("private-upstream-response-body");

    await vi.waitFor(() => {
      expect(readDatabaseHealthMessageRequests()).toHaveLength(2);
    });
    const messageRequests = readDatabaseHealthMessageRequests();
    expect(messageRequests.map((request) => ({
      idempotencyKey: request.idempotencyKey,
      recipient: request.recipient,
    })).sort((left, right) => left.recipient.localeCompare(right.recipient)))
      .toEqual([
        {
          idempotencyKey: "openai-authorization-alert:incident-1:page-1",
          recipient: "+12025550123",
        },
        {
          idempotencyKey:
            "openai-authorization-alert:incident-1:page-1-recipient-2",
          recipient: "+12025550124",
        },
      ]);
    expect(messageRequests[1]?.messageParts)
      .toEqual(messageRequests[0]?.messageParts);

    const message = messageRequests[0]?.messageParts[0]?.value;
    expect(message).toMatch(
      /^SEV1 OpenAI 401\nAggregate count: 1\nFirst observed UTC: [^\n]+\nLast observed UTC: [^\n]+$/u,
    );
    expect(message?.split("\n")).toHaveLength(4);
    const forbiddenDetails = [
      "private-upstream-response-body",
      "member-private-openai-alert",
      "private-runner-container-id",
      "openai-worker-test-key",
      HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
      "api.openai.com",
      "application/json",
      "application/problem+json",
      "private-provider-payload",
      "private-query",
      "private-request-header",
      "x-private-request-header",
      "x-private-response-header",
      "/v1/images/generations",
      "private-model",
      "private-attempt-detail",
    ];
    for (const request of messageRequests) {
      const deliveredMessage = request.messageParts[0]?.value ?? "";
      for (const detail of forbiddenDetails) {
        expect(deliveredMessage).not.toContain(detail);
      }
    }
  });
});
