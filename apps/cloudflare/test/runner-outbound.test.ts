import { beforeEach, describe as baseDescribe, expect, it, vi } from "vitest";

import { handleRunnerOutboundRequest } from "../src/runner-outbound.ts";

const describe = baseDescribe.sequential;

const RUNNER_PROXY_TOKEN = "proxy-token";
const RUNNER_PROXY_TOKEN_HEADER = "x-hosted-execution-runner-proxy-token";

describe("handleRunnerOutboundRequest", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects internal worker proxy traffic that is missing the per-run proxy token", async () => {
    const response = await handleRunnerOutboundRequest(
      new Request("http://device-sync.worker/api/internal/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          provider: "oura",
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_EXECUTION_ALLOWED_WEB_CONTROL_HOSTS: "web.example.test",
        HOSTED_DEVICE_SYNC_CONTROL_BASE_URL: "https://web.example.test",
      }),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
  });

  it("proxies device-sync runtime requests through the worker with the bound user id", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://device-sync.worker/api/internal/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          provider: "oura",
          userId: "member_other",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_EXECUTION_ALLOWED_WEB_CONTROL_HOSTS: "web.example.test",
        HOSTED_DEVICE_SYNC_CONTROL_BASE_URL: "https://web.example.test",
      }),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://web.example.test/api/internal/device-sync/runtime/snapshot",
      expect.objectContaining({
        body: JSON.stringify({
          provider: "oura",
          userId: "member_123",
        }),
        headers: expect.any(Headers),
        method: "POST",
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
    const requestHeaders = (fetchMock.mock.calls[0] as [string, RequestInit | undefined] | undefined)?.[1]?.headers;
    expect(requestHeaders).toBeInstanceOf(Headers);
    expect((requestHeaders as Headers).get("authorization")).toBe("Bearer internal-token");
    expect((requestHeaders as Headers).get("content-type")).toBe("application/json");
    expect((requestHeaders as Headers).get("x-hosted-execution-user-id")).toBe("member_123");
  });

  it("fails closed when a runner web-control base URL host is not allowlisted", async () => {
    await expect(handleRunnerOutboundRequest(
      new Request("http://device-sync.worker/api/internal/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          provider: "oura",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_DEVICE_SYNC_CONTROL_BASE_URL: "https://web.example.test",
      }),
      "member_123",
      RUNNER_PROXY_TOKEN,
    )).rejects.toThrow(/HOSTED_DEVICE_SYNC_CONTROL_BASE_URL host is not allowlisted/u);
  });

  it("accepts extra allowlisted runner web-control hosts", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://device-sync.worker/api/internal/device-sync/runtime/snapshot", {
        body: JSON.stringify({
          provider: "oura",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_DEVICE_SYNC_CONTROL_BASE_URL: "https://web.example.test",
        HOSTED_EXECUTION_ALLOWED_WEB_CONTROL_HOSTS: "api.example.test, web.example.test",
      }),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://web.example.test/api/internal/device-sync/runtime/snapshot",
      expect.any(Object),
    );
  });

  it("proxies hosted share payload requests through the worker control token", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://share-pack.worker/api/hosted-share/internal/share_123/payload", {
        body: JSON.stringify({
          shareCode: "code_123",
        }),
        headers: createRunnerProxyHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://web.example.test/api/hosted-share/internal/share_123/payload",
      expect.objectContaining({
        body: JSON.stringify({
          shareCode: "code_123",
        }),
        headers: expect.any(Headers),
        method: "POST",
      }),
    );
    const requestHeaders = (fetchMock.mock.calls[0] as [string, RequestInit | undefined] | undefined)?.[1]?.headers;
    expect(requestHeaders).toBeInstanceOf(Headers);
    expect((requestHeaders as Headers).get("authorization")).toBe("Bearer share-token");
    expect((requestHeaders as Headers).get("content-type")).toBe("application/json");
    expect((requestHeaders as Headers).get("x-hosted-execution-user-id")).toBe("member_123");
  });

  it("fails closed when the dedicated hosted share token is missing", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://share-pack.worker/api/hosted-share/internal/share_123/payload", {
        body: JSON.stringify({
          shareCode: "code_123",
        }),
        headers: createRunnerProxyHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        HOSTED_SHARE_INTERNAL_TOKEN: undefined,
      }),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted web control token is not configured.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects hosted share payload proxy requests that still include query params", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://share-pack.worker/api/hosted-share/internal/share_123/payload?shareCode=code_123", {
        body: JSON.stringify({
          shareCode: "code_123",
        }),
        headers: createRunnerProxyHeaders(),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Not found",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies hosted AI usage writes through the worker control token", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      recorded: 1,
      usageIds: ["usage_123"],
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://usage.worker/api/internal/hosted-execution/usage/record", {
        body: JSON.stringify({
          usage: [
            {
              usageId: "usage_123",
            },
          ],
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://web.example.test/api/internal/hosted-execution/usage/record",
      expect.objectContaining({
        body: JSON.stringify({
          usage: [
            {
              usageId: "usage_123",
            },
          ],
        }),
        headers: expect.any(Headers),
        method: "POST",
      }),
    );
    const requestHeaders = (fetchMock.mock.calls[0] as [string, RequestInit | undefined] | undefined)?.[1]?.headers;
    expect(requestHeaders).toBeInstanceOf(Headers);
    expect((requestHeaders as Headers).get("authorization")).toBe("Bearer internal-token");
    expect((requestHeaders as Headers).get("content-type")).toBe("application/json");
    expect((requestHeaders as Headers).get("x-hosted-execution-user-id")).toBe("member_123");
  });

  it("rejects side-effect writes when the route effect id and payload effect id differ", async () => {
    const response = await handleRunnerOutboundRequest(
      new Request("http://side-effects.worker/effects/outbox_123", {
        body: JSON.stringify({
          effectId: "outbox_999",
          fingerprint: "dedupe_123",
          intentId: "outbox_123",
          kind: "assistant.delivery",
          recordedAt: "2026-03-26T12:00:05.000Z",
          state: "prepared",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "PUT",
      }),
      createRunnerOutboundEnv(),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "effectId mismatch: expected outbox_123, received outbox_999.",
    });
  });
});

function createRunnerProxyHeaders(headers: Record<string, string> = {}) {
  return {
    [RUNNER_PROXY_TOKEN_HEADER]: RUNNER_PROXY_TOKEN,
    ...headers,
  };
}

function createRunnerOutboundEnv(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    BUNDLES: {
      async delete() {},
      async get() {
        return null;
      },
      async put() {},
    },
    HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
    HOSTED_EXECUTION_INTERNAL_TOKEN: "internal-token",
    HOSTED_SHARE_INTERNAL_TOKEN: "share-token",
    HOSTED_EXECUTION_SIGNING_SECRET: "dispatch-secret",
    USER_RUNNER: {
      getByName() {
        return {
          async bootstrapUser() {
            return { userId: "member_123" };
          },
          async commit() {
            throw new Error("not used");
          },
          async finalizeCommit() {
            throw new Error("not used");
          },
        };
      },
    },
    ...overrides,
  };
}
