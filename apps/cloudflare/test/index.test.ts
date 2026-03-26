import { describe, expect, it, vi } from "vitest";

import { createHostedExecutionSignature } from "../src/auth.js";
import worker from "../src/index.js";

describe("cloudflare worker routes", () => {
  it("serves a health endpoint", async () => {
    const response = await worker.fetch(
      new Request("https://runner.example.test/health"),
      createWorkerEnv(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "cloudflare-hosted-runner",
    });
  });

  it("accepts signed dispatch through the /internal/events alias", async () => {
    const dispatch = {
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "member_123",
      },
      eventId: "evt_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
    };
    const payload = JSON.stringify(dispatch);
    const signature = await createHostedExecutionSignature({
      payload,
      secret: "dispatch-secret",
      timestamp: dispatch.occurredAt,
    });
    const stubFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
        }),
      ),
    );

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/events", {
        body: payload,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-hb-execution-signature": signature,
          "x-hb-execution-timestamp": dispatch.occurredAt,
        },
        method: "POST",
      }),
      createWorkerEnv(stubFetch),
    );

    expect(response.status).toBe(200);
    expect(stubFetch).toHaveBeenCalledTimes(1);
  });
});

function createWorkerEnv(stubFetch = vi.fn()): {
  BUNDLES: { get: () => Promise<null>; put: () => Promise<void> };
  HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: string;
  HOSTED_EXECUTION_SIGNING_SECRET: string;
  USER_RUNNER: { getByName: () => { fetch: typeof stubFetch } };
} {
  return {
    BUNDLES: {
      async get() {
        return null;
      },
      async put() {},
    },
    HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    HOSTED_EXECUTION_SIGNING_SECRET: "dispatch-secret",
    USER_RUNNER: {
      getByName() {
        return {
          fetch: stubFetch,
        };
      },
    },
  };
}
