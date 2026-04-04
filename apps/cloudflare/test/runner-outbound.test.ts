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
        HOSTED_WEB_BASE_URL: "https://web.example.test",
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

  it("handles device-sync runtime requests locally and binds them to the authenticated user", async () => {
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
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        HOSTED_DEVICE_SYNC_CONTROL_BASE_URL: "https://web.example.test",
      }),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      connections: [],
      generatedAt: expect.any(String),
      userId: "member_123",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not depend on hosted-web allowlists for local device-sync runtime paths", async () => {
    const fetchMock = vi.fn();
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
      }),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      connections: [],
      generatedAt: expect.any(String),
      userId: "member_123",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps device-sync runtime routes local even when hosted-web base URLs are configured", async () => {
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
        HOSTED_WEB_BASE_URL: "https://web.example.test/app",
        HOSTED_DEVICE_SYNC_CONTROL_BASE_URL: "https://web.example.test",
      }),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      connections: [],
      generatedAt: expect.any(String),
      userId: "member_123",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 410 for removed hosted share payload fetches in the runtime hot path", async () => {
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

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Not found",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps removed hosted share payload fetches disabled even when the dedicated share token is missing", async () => {
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

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Not found",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps removed hosted share payload fetches disabled even if legacy query params are present", async () => {
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

  it("records hosted AI usage locally instead of proxying through hosted web", async () => {
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
    await expect(response.json()).resolves.toEqual({
      recorded: 1,
      usageIds: ["usage_123"],
    });
    expect(fetchMock).not.toHaveBeenCalled();
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
