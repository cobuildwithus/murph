import { describe, expect, it, vi } from "vitest";

import { createHostedExecutionSignature } from "../src/auth.js";
import worker from "../src/index.js";

describe("cloudflare worker routes", () => {
  it("serves a health endpoint even before secrets are configured", async () => {
    const response = await worker.fetch(
      new Request("https://runner.example.test/health"),
      {
        BUNDLES: {
          async get() {
            return null;
          },
          async put() {},
        },
        USER_RUNNER: {
          getByName() {
            return {
              fetch: vi.fn(),
            };
          },
        },
      } as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "cloudflare-hosted-runner",
    });
  });


  it("injects the path user id into manual run requests", async () => {
    const stubFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/run", {
        body: JSON.stringify({ note: "manual" }),
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      createWorkerEnv(stubFetch, {
        HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      }),
    );

    expect(response.status).toBe(200);
    expect(stubFetch).toHaveBeenCalledTimes(1);
    const request = stubFetch.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://runner.internal/run");
    await expect(request.text()).resolves.toContain('"userId":"member_123"');
  });

  it("accepts an empty manual run body and still injects the path user id", async () => {
    const stubFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/run", {
        body: "",
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      createWorkerEnv(stubFetch, {
        HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      }),
    );

    expect(response.status).toBe(200);
    expect(stubFetch).toHaveBeenCalledTimes(1);
    const request = stubFetch.mock.calls[0]?.[0] as Request;
    await expect(request.text()).resolves.toBe('{"userId":"member_123"}');
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

  it("forwards operator env config updates to the durable object", async () => {
    const stubFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/env", {
        body: JSON.stringify({
          env: {
            OPENAI_API_KEY: "sk-user",
            TELEGRAM_BOT_TOKEN: "bot-token",
          },
          mode: "replace",
        }),
        headers: {
          authorization: "Bearer control-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "PUT",
      }),
      createWorkerEnv(stubFetch, {
        HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      }),
    );

    expect(response.status).toBe(200);
    expect(stubFetch).toHaveBeenCalledTimes(1);
    const request = stubFetch.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://runner.internal/env?userId=member_123");
    await expect(request.text()).resolves.toContain("\"OPENAI_API_KEY\":\"sk-user\"");
  });

  it("forwards operator env status reads to the durable object", async () => {
    const stubFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/env", {
        headers: {
          authorization: "Bearer control-token",
        },
        method: "GET",
      }),
      createWorkerEnv(stubFetch, {
        HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      }),
    );

    expect(response.status).toBe(200);
    expect(stubFetch).toHaveBeenCalledTimes(1);
    const request = stubFetch.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://runner.internal/env?userId=member_123");
    expect(request.method).toBe("GET");
  });

  it("forwards operator env clears to the durable object", async () => {
    const stubFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));

    const response = await worker.fetch(
      new Request("https://runner.example.test/internal/users/member_123/env", {
        headers: {
          authorization: "Bearer control-token",
        },
        method: "DELETE",
      }),
      createWorkerEnv(stubFetch, {
        HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      }),
    );

    expect(response.status).toBe(200);
    expect(stubFetch).toHaveBeenCalledTimes(1);
    const request = stubFetch.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe("https://runner.internal/env?userId=member_123");
    expect(request.method).toBe("DELETE");
  });
});

function createWorkerEnv(
  stubFetch = vi.fn(),
  overrides: Partial<{
    HOSTED_EXECUTION_CONTROL_TOKEN: string;
  }> = {},
): {
  BUNDLES: { get: () => Promise<null>; put: () => Promise<void> };
  HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: string;
  HOSTED_EXECUTION_CONTROL_TOKEN?: string;
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
    HOSTED_EXECUTION_CONTROL_TOKEN: overrides.HOSTED_EXECUTION_CONTROL_TOKEN,
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
