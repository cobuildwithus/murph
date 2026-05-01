import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";

import { readHostedExecutionEnvironment } from "../src/env.ts";
import {
  handleRunnerOutboundRequest,
  type RunnerOutboundEnvironmentSource,
} from "../src/runner-outbound.ts";
import { resolveRunnerOutboundUserRunnerStub } from "../src/runner-outbound/shared.ts";
import {
  isAllowedHostedRunnerWebControlRequest,
  readHostedRunnerWebControlRoute,
} from "../src/runner-outbound/shared-web-control-policy.ts";
import { createHostedUserKeyStore } from "../src/user-key-store.ts";
import type {
  WorkerBindUserRunnerStubLike,
  WorkerUserRunnerNamespaceLike,
} from "../src/worker-contracts.ts";

const RUNNER_PROXY_TOKEN = "proxy-token";
const RUNNER_PROXY_TOKEN_HEADER = "x-hosted-execution-runner-proxy-token";
const MISSING_ARTIFACT_URL = `http://artifacts.worker/objects/${"a".repeat(64)}`;
const HEARTBEAT_URL = "http://runner-control.worker/internal/active-invocation/heartbeat";
const ALLOWLISTED_WEB_CONTROL_CASES = [
  {
    body: {
      connectionId: "conn_123",
      userId: "member_123",
    },
    name: "device-sync runtime snapshot",
    path: "/api/internal/device-sync/runtime/snapshot",
  },
  {
    body: {
      changes: [],
      connectionId: "conn_123",
      expectedRevision: "12",
      userId: "member_123",
    },
    name: "device-sync runtime apply",
    path: "/api/internal/device-sync/runtime/apply",
  },
  {
    body: {
      bytes: 17,
      eventId: "evt_123",
    },
    name: "hosted execution usage recording",
    path: "/api/internal/hosted-execution/usage/record",
  },
  {
    body: undefined,
    name: "delegated billing Stripe customer lookup",
    path: "/api/internal/hosted-execution/billing/stripe/customer/resolve",
  },
  {
    body: {
      provider: "google",
      returnPath: "/settings/sync",
    },
    name: "device-sync connect-target connect-link",
    path: "/api/internal/device-sync/connect-targets/google/connect-link",
  },
  {
    body: {
      lanes: [
        {
          importedSeq: "0",
          lane: "conversation",
        },
      ],
      requestId: "request_mailbox_1",
    },
    name: "hosted mailbox fetch",
    path: "/api/internal/hosted-mailbox/fetch",
  },
  {
    body: {
      itemId: "mailbox_item_123",
      payloadRef: {
        kind: "hosted-mailbox-payload",
        payloadId: "payload_123",
      },
      requestId: "request_payload_1",
    },
    name: "hosted mailbox payload fetch",
    path: "/api/internal/hosted-mailbox/payload/fetch",
  },
  {
    body: {
      attemptId: "attempt_1",
      expectedWorkspaceVersion: "4",
      leaseGeneration: "9",
      reason: "import",
    },
    name: "hosted workspace checkpoint",
    path: "/api/internal/hosted-workspace/checkpoint",
  },
  {
    body: {
      entries: [
        {
          at: "2026-04-26T00:00:03.000Z",
          component: "mailbox",
          eventCode: "mailbox.imported",
          level: "info",
          phase: "import",
          redactedJson: {
            importedCount: 1,
          },
        },
      ],
    },
    name: "hosted runtime log",
    path: "/api/internal/hosted-runtime/log",
  },
  {
    body: {
      component: "mailbox",
      detailsJson: {},
      environment: "production",
      fingerprint: "mailbox.unexpected",
      issueKind: "unexpected-mailbox-item",
      occurredAt: "2026-04-26T00:00:03.000Z",
      phase: "import",
      severity: "warning",
      summary: "Unexpected mailbox item",
    },
    name: "hosted issue recording",
    path: "/api/internal/hosted-execution/issues/record",
  },
] as const;

describe("handleRunnerOutboundRequest", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("bootstraps the bound user before returning the outbound stub", async () => {
    type ReceiverSensitiveStub = WorkerBindUserRunnerStubLike & {
      marker: string;
    };
    const stub: ReceiverSensitiveStub = {
      marker: "runner-outbound-stub",
      bindUser: vi.fn(async function (
        this: ReceiverSensitiveStub,
        userId: string,
      ) {
        expect(this.marker).toBe("runner-outbound-stub");
        return { userId };
      }),
    };
    const env = createDirectRunnerOutboundEnv({
      USER_RUNNER: {
        getByName() {
          return stub;
        },
      },
    });

    const resolvedStub = await resolveRunnerOutboundUserRunnerStub(env, "member_123");

    expect(resolvedStub).toBe(stub);
    expect(stub.bindUser).toHaveBeenCalledOnce();
    expect(stub.bindUser).toHaveBeenCalledWith("member_123");
  });

  it("fails closed when the runner stub is malformed at runtime", async () => {
    const env = createDirectRunnerOutboundEnv({
      USER_RUNNER: {
        getByName() {
          return {} as never;
        },
      },
    });

    await expect(resolveRunnerOutboundUserRunnerStub(env, "member_123")).rejects.toThrow(
      'User runner stub does not implement bindUser.',
    );
  });

  it("rejects internal worker proxy traffic when the proxy header is missing", async () => {
    const response = await handleRunnerOutboundRequest(
      new Request(MISSING_ARTIFACT_URL, {
        method: "GET",
      }),
      createRunnerOutboundEnv(),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
  });

  it("rejects artifact host proxy traffic when the invocation proxy token does not match", async () => {
    const response = await handleRunnerOutboundRequest(
      new Request(MISSING_ARTIFACT_URL, {
        headers: {
          [RUNNER_PROXY_TOKEN_HEADER]: "proxy-tokez",
        },
        method: "GET",
      }),
      createRunnerOutboundEnv(),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
  });

  it("records active invocation heartbeats through the runner-control host", async () => {
    const recordActiveInvocationHeartbeat = vi.fn(async () => ({
      nextAlarmAt: "2026-04-27T00:00:45.000Z",
      ok: true as const,
    }));
    const response = await handleRunnerOutboundRequest(
      new Request(HEARTBEAT_URL, {
        body: JSON.stringify({
          attemptId: "workspace-invocation-1",
          leaseGeneration: "1",
          requestId: "hosted-workspace-invocation:workspace-invocation-1",
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        USER_RUNNER: {
          getByName() {
            return {
              async bindUser(userId: string) {
                return { userId };
              },
              recordActiveInvocationHeartbeat,
            };
          },
        },
      }),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      nextAlarmAt: "2026-04-27T00:00:45.000Z",
      ok: true,
    });
    expect(recordActiveInvocationHeartbeat).toHaveBeenCalledWith({
      attemptId: "workspace-invocation-1",
      leaseGeneration: "1",
      userId: "member_123",
    });
  });

  it("rejects heartbeat proxy traffic when the invocation proxy token does not match", async () => {
    const response = await handleRunnerOutboundRequest(
      new Request(HEARTBEAT_URL, {
        headers: createRunnerProxyHeaders({
          [RUNNER_PROXY_TOKEN_HEADER]: "proxy-tokez",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv(),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
  });

  it("returns non-retryable liveness rejection for malformed heartbeat payloads", async () => {
    const recordActiveInvocationHeartbeat = vi.fn();
    const env = createRunnerOutboundEnv({
      USER_RUNNER: {
        getByName() {
          return {
            async bindUser(userId: string) {
              return { userId };
            },
            recordActiveInvocationHeartbeat,
          };
        },
      },
    });

    for (const body of [
      "{",
      JSON.stringify({
        attemptId: "workspace-invocation-1",
        leaseGeneration: "1",
        workspaceVersion: "0",
      }),
      JSON.stringify({
        attemptId: "workspace-invocation-1",
        leaseGeneration: "1",
        requestId: null,
      }),
    ]) {
      const response = await handleRunnerOutboundRequest(
        new Request(HEARTBEAT_URL, {
          body,
          headers: createRunnerProxyHeaders({
            "content-type": "application/json; charset=utf-8",
          }),
          method: "POST",
        }),
        env,
        "member_123",
        RUNNER_PROXY_TOKEN,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        reason: "malformed_request",
      });
    }

    expect(recordActiveInvocationHeartbeat).not.toHaveBeenCalled();
  });

  it("returns 404 for removed Cloudflare-owned device-sync runtime hosts", async () => {
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

  it("returns 404 for removed Cloudflare-owned device-sync connect-link hosts", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://device-sync.worker/api/internal/device-sync/connect-targets/whoop/connect-link", {
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

  it.each(ALLOWLISTED_WEB_CONTROL_CASES)(
    "proxies allowlisted hosted web-control path: $name",
    async ({ body, path }) => {
      expect(isAllowedHostedRunnerWebControlRequest({
        method: "POST",
        path,
      })).toBe(true);

      const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
      const fetchMock = vi.fn(async (
        ..._args: Parameters<typeof fetch>
      ): Promise<Response> =>
        new Response(
          JSON.stringify(
            path === "/api/internal/hosted-workspace/checkpoint"
              ? createHostedWorkspaceCheckpointResponse("5")
              : {
                  ok: true,
                  path,
                },
          ),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
            },
            status: 200,
          },
        ));
      vi.stubGlobal("fetch", fetchMock);

      const response = await handleRunnerOutboundRequest(
        new Request(`http://web-control.worker${path}`, {
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          headers: createRunnerProxyHeaders(
            body === undefined
              ? {}
              : {
                  "content-type": "application/json; charset=utf-8",
                },
          ),
          method: "POST",
        }),
        createRunnerOutboundEnv({
          HOSTED_WEB_BASE_URL: "https://web.example.test",
          HOSTED_EXECUTION_RUNNER_TIMEOUT_MS: "600000",
          HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS: "45000",
        }),
        "member_123",
        RUNNER_PROXY_TOKEN,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(
        path === "/api/internal/hosted-workspace/checkpoint"
          ? createHostedWorkspaceCheckpointResponse("5")
          : {
              ok: true,
              path,
            },
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const firstCall = fetchMock.mock.calls[0];
      if (!firstCall) {
        throw new Error("Expected the allowlisted web-control fetch to run.");
      }
      const [url, init] = firstCall;
      expect(String(url)).toBe(`https://web.example.test${path}`);
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(body === undefined ? undefined : JSON.stringify(body));
      const headers = new Headers(init?.headers);
      expect(headers.get("content-type")).toBe(body === undefined ? null : "application/json");
      expect(headers.get("x-hosted-execution-user-id")).toBe("member_123");
      expect(timeoutSpy).toHaveBeenCalledWith(45_000);
    },
  );

  it("rejects workspace checkpoints when the user runner no longer owns the active lease", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://web-control.worker/api/internal/hosted-workspace/checkpoint", {
        body: JSON.stringify({
          attemptId: "attempt_stale",
          expectedWorkspaceVersion: "4",
          leaseGeneration: "9",
          reason: "import",
          snapshotRef: null,
        }),
        headers: createRunnerProxyHeaders({
          "content-type": "application/json; charset=utf-8",
        }),
        method: "POST",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        USER_RUNNER: {
          getByName() {
            return {
              async bindUser(userId: string) {
                return { userId };
              },
              ownsActiveInvocationLease: vi.fn(async () => false),
              recordActiveInvocationWorkspaceCheckpoint: vi.fn(async () => ({
                recorded: true,
              })),
            };
          },
        },
      }),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies the hosted workspace read route through web-control GET", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> => new Response(JSON.stringify({
      fetchedAt: "2026-04-26T00:00:05.000Z",
      workspace: null,
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_WORKSPACE_PATH}`, {
        headers: createRunnerProxyHeaders(),
        method: "GET",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
        HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS: "45000",
      }),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      fetchedAt: "2026-04-26T00:00:05.000Z",
      workspace: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) {
      throw new Error("Expected the workspace read web-control fetch to run.");
    }
    const [url, init] = firstCall;
    expect(String(url)).toBe(`https://web.example.test${HOSTED_RUNTIME_WORKSPACE_PATH}`);
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBeNull();
    expect(headers.get("x-hosted-execution-user-id")).toBe("member_123");
    expect(timeoutSpy).toHaveBeenCalledWith(45_000);
  });

  it("rejects absolute web-control runtime routes before allowlist checks", () => {
    expect(readHostedRunnerWebControlRoute(
      `${HOSTED_RUNTIME_WORKSPACE_PATH}?requestId=request_123`,
    )).toEqual({
      pathAndSearch: `${HOSTED_RUNTIME_WORKSPACE_PATH}?requestId=request_123`,
      pathname: HOSTED_RUNTIME_WORKSPACE_PATH,
    });

    expect(() => readHostedRunnerWebControlRoute(
      `https://example.test${HOSTED_RUNTIME_WORKSPACE_PATH}`,
    )).toThrow("Hosted runtime web-control route must be relative.");
  });

  it("rejects deleted share payload proxy calls", async () => {
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> => new Response("unexpected", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(
        "http://web-control.worker/api/internal/hosted-execution/share/share_123/payload?requestId=request_share_1&eventId=event_accepted_123&ownerUserId=member_sender",
        {
          headers: createRunnerProxyHeaders(),
          method: "GET",
        },
      ),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects deleted share import proxy calls", async () => {
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> => new Response("unexpected", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://web-control.worker/api/internal/hosted-execution/share/import", {
        body: JSON.stringify({
          eventId: "event_accepted_123",
          importedAt: "2026-04-26T00:00:05.000Z",
          ownerUserId: "member_sender",
          shareId: "share_123",
          status: "imported",
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

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores legacy signed-user override headers on web-control proxy paths", async () => {
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> => new Response(JSON.stringify({
      fetchedAt: "2026-04-26T00:00:05.000Z",
      workspace: null,
    }), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_WORKSPACE_PATH}`, {
        headers: createRunnerProxyHeaders({
          "x-hosted-runtime-web-control-user-id": "member_sender",
        }),
        method: "GET",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    if (!firstCall) {
      throw new Error("Expected the workspace web-control fetch to run.");
    }
    const [_url, init] = firstCall;
    const headers = new Headers(init?.headers);
    expect(headers.get("x-hosted-execution-user-id")).toBe("member_123");
  });

  it("rejects method mismatches on otherwise allowlisted web-control proxy paths", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const getPostOnlyResponse = await handleRunnerOutboundRequest(
      new Request("http://web-control.worker/api/internal/hosted-runtime/log", {
        headers: createRunnerProxyHeaders(),
        method: "GET",
      }),
      createRunnerOutboundEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );
    const postGetOnlyResponse = await handleRunnerOutboundRequest(
      new Request(`http://web-control.worker${HOSTED_RUNTIME_WORKSPACE_PATH}`, {
        body: JSON.stringify({
          requestId: "request_workspace_1",
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

    expect(getPostOnlyResponse.status).toBe(404);
    expect(postGetOnlyResponse.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 for non-allowlisted web-control proxy paths", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://web-control.worker/api/internal/hosted-mailbox/status", {
        body: JSON.stringify({
          eventId: "evt_123",
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

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Not found",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not proxy generic loopback host traffic through runner outbound handling", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://127.0.0.1:8788/health?from=runner", {
        headers: createRunnerProxyHeaders(),
        method: "GET",
      }),
      createRunnerOutboundEnv({
        HOSTED_EXECUTION_LOCAL_LOOPBACK_PROXY_TOKEN: "local-loopback-token",
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
});

function createRunnerProxyHeaders(headers: Record<string, string> = {}) {
  return {
    [RUNNER_PROXY_TOKEN_HEADER]: RUNNER_PROXY_TOKEN,
    ...headers,
  };
}

function createRunnerOutboundEnv(
  overrides: Partial<RunnerOutboundEnvironmentSource> = {},
): RunnerOutboundEnvironmentSource {
  const values = new Map<string, string>();
  const defaultUserRunnerNamespace: WorkerUserRunnerNamespaceLike<WorkerBindUserRunnerStubLike> = {
    getByName() {
      return {
        async bindUser() {
          return { userId: "member_123" };
        },
        async ownsActiveInvocationLease() {
          return true;
        },
        async recordActiveInvocationHeartbeat() {
          return {
            nextAlarmAt: null,
            ok: true as const,
          };
        },
        async recordActiveInvocationWorkspaceCheckpoint() {
          return { recorded: true };
        },
      };
    },
  };
  const userRunnerNamespace = overrides.USER_RUNNER ?? defaultUserRunnerNamespace;
  const env = {
    BUNDLES: {
      async delete(key: string) {
        values.delete(key);
      },
      async get(key: string) {
        const value = values.get(key);

        if (!value) {
          return null;
        }

        return {
          async arrayBuffer() {
            const bytes = Buffer.from(value, "utf8");
            return bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            );
          },
        };
      },
      async put(key: string, value: string) {
        values.set(key, value);
      },
    },
    HOSTED_EXECUTION_AUTOMATION_RECIPIENT_KEY_ID: "automation:v1",
    HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK:
      "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"xSelVJv6r6LPUS8GCNgj1T_7z5GXOrhgY1cCdzGb5ao\",\"y\":\"8HhciS1cAPKs_fPfgZnb1USdRtBX-4Nvp8XiBHuMcmY\",\"d\":\"HAPljluiFVW3g-UEmrJ9NVYTlclAhaC8N5LT0h7vitQ\",\"ext\":true,\"key_ops\":[\"deriveBits\"]}",
    HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK:
      "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"xSelVJv6r6LPUS8GCNgj1T_7z5GXOrhgY1cCdzGb5ao\",\"y\":\"8HhciS1cAPKs_fPfgZnb1USdRtBX-4Nvp8XiBHuMcmY\",\"ext\":true,\"key_ops\":[]}",
    HOSTED_EXECUTION_RECOVERY_RECIPIENT_KEY_ID: "recovery:v1",
    HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK:
      "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"xSelVJv6r6LPUS8GCNgj1T_7z5GXOrhgY1cCdzGb5ao\",\"y\":\"8HhciS1cAPKs_fPfgZnb1USdRtBX-4Nvp8XiBHuMcmY\",\"ext\":true,\"key_ops\":[]}",
    HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_KEY_ID: "tee-automation:v1",
    HOSTED_EXECUTION_TEE_AUTOMATION_RECIPIENT_PUBLIC_JWK:
      "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"xSelVJv6r6LPUS8GCNgj1T_7z5GXOrhgY1cCdzGb5ao\",\"y\":\"8HhciS1cAPKs_fPfgZnb1USdRtBX-4Nvp8XiBHuMcmY\",\"ext\":true,\"key_ops\":[]}",
    HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: Buffer.alloc(32, 9).toString("base64"),
    HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: "murph-web",
    HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: "murph-team",
    HOSTED_WAKE_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64url"),
    HOSTED_WEB_BASE_URL: "https://web.example.test",
    HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK:
      "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"xSelVJv6r6LPUS8GCNgj1T_7z5GXOrhgY1cCdzGb5ao\",\"y\":\"8HhciS1cAPKs_fPfgZnb1USdRtBX-4Nvp8XiBHuMcmY\",\"d\":\"HAPljluiFVW3g-UEmrJ9NVYTlclAhaC8N5LT0h7vitQ\",\"ext\":true,\"key_ops\":[\"sign\"]}",
    ...overrides,
  } satisfies Omit<RunnerOutboundEnvironmentSource, "USER_RUNNER">;
  const bootstrappedByUserId = new Map<string, Promise<void>>();

  return {
    ...env,
    USER_RUNNER: {
      getByName(userId: string) {
        const stub = userRunnerNamespace.getByName(userId);
        return {
          ...stub,
          async bindUser(boundUserId: string) {
            let seeded = bootstrappedByUserId.get(boundUserId);
            if (!seeded) {
              seeded = ensureRunnerOutboundUserEnvelope(env, boundUserId);
              bootstrappedByUserId.set(boundUserId, seeded);
            }
            await seeded;
            return stub.bindUser?.(boundUserId) ?? { userId: boundUserId };
          },
        };
      },
    },
  };
}

function createHostedWorkspaceCheckpointResponse(version: string) {
  return {
    checkpointed: true,
    workspace: {
      checkpointedAt: "2026-04-26T00:00:05.000Z",
      createdAt: "2026-04-26T00:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef: null,
      updatedAt: "2026-04-26T00:00:05.000Z",
      userId: "member_123",
      version,
    },
  };
}

function createDirectRunnerOutboundEnv(
  overrides: Partial<RunnerOutboundEnvironmentSource>,
): RunnerOutboundEnvironmentSource {
  return {
    ...createRunnerOutboundEnv(),
    ...overrides,
  };
}

async function ensureRunnerOutboundUserEnvelope(
  env: Record<string, unknown>,
  userId: string,
): Promise<void> {
  const environment = readHostedExecutionEnvironment(
    env as Readonly<Record<string, string | undefined>>,
  );

  const store = createHostedUserKeyStore({
    automationRecipientKeyId: environment.automationRecipientKeyId,
    automationRecipientPrivateKey: environment.automationRecipientPrivateKey,
    automationRecipientPrivateKeysById: environment.automationRecipientPrivateKeysById,
    automationRecipientPublicKey: environment.automationRecipientPublicKey,
    bucket: env.BUNDLES as never,
    envelopeEncryptionKey: environment.platformEnvelopeKey,
    envelopeEncryptionKeyId: environment.platformEnvelopeKeyId,
    envelopeEncryptionKeysById: environment.platformEnvelopeKeysById,
    recoveryRecipientKeyId: environment.recoveryRecipientKeyId,
    recoveryRecipientPublicKey: environment.recoveryRecipientPublicKey,
    teeAutomationRecipientKeyId: environment.teeAutomationRecipientKeyId,
    teeAutomationRecipientPublicKey: environment.teeAutomationRecipientPublicKey,
  });
  await store.provisionManagedUserCryptoAtActivation(userId);
}
