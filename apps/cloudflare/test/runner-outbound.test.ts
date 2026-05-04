import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachHostedDomainRootEnvelopeSignature,
  buildHostedDomainRootEnvelopeSigningPayload,
  buildHostedDomainRootWrapContext,
  HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
  wrapHostedDomainRootKeyWithP256Ecdh,
  type HostedDomainRootKeyEnvelopeBodyV1,
  type HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";
import {
  HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
  HOSTED_RUNTIME_CRYPTO_ROOT_PATH,
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import { clearHostedRuntimeCryptoContextEnvelopeCacheForTests } from "../src/hosted-crypto/runtime-user-crypto-context.ts";
import {
  handleRunnerOutboundRequest,
  type RunnerOutboundEnvironmentSource,
} from "../src/runner-outbound.ts";
import {
  resolveRunnerOutboundUserCryptoContext,
  resolveRunnerOutboundUserRunnerStub,
  resetRunnerOutboundSharedCachesForTest,
} from "../src/runner-outbound/shared.ts";
import {
  isAllowedHostedRunnerWebControlRequest,
  readHostedRunnerWebControlRoute,
} from "../src/runner-outbound/shared-web-control-policy.ts";
import { asWorkerStringEnvironment } from "../src/worker-contracts.ts";
import type {
  WorkerBindUserRunnerStubLike,
  WorkerUserRunnerNamespaceLike,
} from "../src/worker-contracts.ts";
import {
  TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK_JSON,
  TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
  TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM,
  TEST_HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID,
} from "./hosted-execution-fixtures.ts";

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
    body: undefined,
    name: "hosted runtime crypto context",
    path: HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH,
  },
  {
    body: {
      domain: "ingress",
      rootKeyId: "udrk:ingress:test-root",
    },
    name: "hosted runtime crypto root",
    path: HOSTED_RUNTIME_CRYPTO_ROOT_PATH,
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
    vi.useRealTimers();
    clearHostedRuntimeCryptoContextEnvelopeCacheForTests();
    resetRunnerOutboundSharedCachesForTest();
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

  it("briefly reuses successful outbound bindUser assertions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T00:00:00.000Z"));
    const stub = {
      bindUser: vi.fn(async (userId: string) => ({ userId })),
    };
    const getByName = vi.fn(() => stub);
    const env = createDirectRunnerOutboundEnv({
      USER_RUNNER: {
        getByName,
      },
    });

    const firstStub = await resolveRunnerOutboundUserRunnerStub(env, "member_123");
    const secondStub = await resolveRunnerOutboundUserRunnerStub(env, "member_123");
    await vi.advanceTimersByTimeAsync(60_001);
    const thirdStub = await resolveRunnerOutboundUserRunnerStub(env, "member_123");

    expect(firstStub).toBe(stub);
    expect(secondStub).toBe(stub);
    expect(thirdStub).toBe(stub);
    expect(getByName).toHaveBeenCalledTimes(2);
    expect(stub.bindUser).toHaveBeenCalledTimes(2);
  });

  it("drops rejected outbound bindUser assertions from the cache", async () => {
    const bindUser = vi.fn()
      .mockRejectedValueOnce(new Error("bind failed"))
      .mockResolvedValueOnce({ userId: "member_123" });
    const env = createDirectRunnerOutboundEnv({
      USER_RUNNER: {
        getByName() {
          return { bindUser };
        },
      },
    });

    await expect(resolveRunnerOutboundUserRunnerStub(env, "member_123")).rejects.toThrow(
      "bind failed",
    );
    await expect(resolveRunnerOutboundUserRunnerStub(env, "member_123")).resolves.toMatchObject({
      bindUser,
    });

    expect(bindUser).toHaveBeenCalledTimes(2);
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
      inputAvailable: true,
      nextAlarmAt: "2026-04-27T00:00:45.000Z",
      ok: true as const,
      pendingNudge: true,
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
      inputAvailable: true,
      nextAlarmAt: "2026-04-27T00:00:45.000Z",
      ok: true,
      pendingNudge: true,
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

  it("reuses the bound user runner stub while proxying workspace checkpoints", async () => {
    const bindUser = vi.fn(async (userId: string) => ({ userId }));
    const ownsActiveInvocationLease = vi.fn(async () => true);
    const recordActiveInvocationWorkspaceCheckpoint = vi.fn(async () => ({
      recorded: true,
    }));
    const getByName = vi.fn(() => ({
      bindUser,
      ownsActiveInvocationLease,
      recordActiveInvocationWorkspaceCheckpoint,
    }));
    const fetchMock = vi.fn(async (
      ..._args: Parameters<typeof fetch>
    ): Promise<Response> => new Response(
      JSON.stringify(createHostedWorkspaceCheckpointResponse("5")),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleRunnerOutboundRequest(
      new Request("http://web-control.worker/api/internal/hosted-workspace/checkpoint", {
        body: JSON.stringify({
          attemptId: "attempt_1",
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
          getByName,
        },
      }),
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(200);
    expect(getByName).toHaveBeenCalledOnce();
    expect(bindUser).toHaveBeenCalledOnce();
    expect(ownsActiveInvocationLease).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      leaseGeneration: "9",
      userId: "member_123",
      workspaceVersion: "4",
    });
    expect(recordActiveInvocationWorkspaceCheckpoint).toHaveBeenCalledWith({
      attemptId: "attempt_1",
      leaseGeneration: "9",
      userId: "member_123",
      workspaceVersion: "5",
    });
  });

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

  it("selects ingress or runtime roots from the signed hosted crypto context", async () => {
    const cloudflareRecipient = await generateP256EcdhKeyPair();
    const signer = await generateP256SigningKeyPair();
    const env = createRunnerOutboundEnv({
      HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1",
      HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: signer.publicKeyPem.replace(/\n/g, "\\n"),
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cf-key-v1",
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
        cloudflareRecipient.privateJwk,
      ),
      HOSTED_CRYPTO_ENV: "test",
    });
    env.USER_RUNNER = {
      getByName() {
        return {
          async bindUser(userId: string) {
            return { userId };
          },
        };
      },
    };

    const ingressRoot = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const runtimeRoot = Uint8Array.from({ length: 32 }, (_, index) => 101 + index);
    const context = {
      envelopes: {
        ingress: await createSignedWorkerEnvelope({
          domain: "ingress",
          publicJwk: cloudflareRecipient.publicJwk,
          rootKey: ingressRoot,
          signer: signer.privateKey,
          userId: "member_123",
        }),
        runtime: await createSignedWorkerEnvelope({
          domain: "runtime",
          publicJwk: cloudflareRecipient.publicJwk,
          rootKey: runtimeRoot,
          signer: signer.privateKey,
          userId: "member_123",
        }),
      },
      schema: "murph.hosted-runtime-crypto-context.v1" as const,
      userId: "member_123",
    };
    const fetchMock = vi.fn(async (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      const [url, init] = args;
      assert.equal(String(url), `https://web.example.test${HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH}`);
      assert.equal(init?.method, "POST");
      assert.equal(init?.body, undefined);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-hosted-execution-user-id"), "member_123");
      assert.equal(headers.has("x-hosted-execution-signature"), true);
      return new Response(JSON.stringify(context), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(env));

    const runtime = await resolveRunnerOutboundUserCryptoContext({
      bucket: env.BUNDLES,
      domain: "runtime",
      env,
      environment,
      userId: "member_123",
    });
    const ingress = await resolveRunnerOutboundUserCryptoContext({
      bucket: env.BUNDLES,
      domain: "ingress",
      env,
      environment,
      userId: "member_123",
    });

    assert.deepEqual(runtime.rootKey, runtimeRoot);
    assert.equal(runtime.rootKeyId, "udrk:runtime:test-root");
    assert.deepEqual(ingress.rootKey, ingressRoot);
    assert.equal(ingress.rootKeyId, "udrk:ingress:test-root");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("checks the active invocation lease for every artifact PUT", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const ownsActiveInvocationLease = vi.fn(async () => true);
    const bindUser = vi.fn(async (userId: string) => ({ userId }));
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName() {
          return {
            bindUser,
            ownsActiveInvocationLease,
          };
        },
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    const bytes = new Uint8Array([1, 2, 3]);
    const sha256 = sha256Hex(bytes);

    const firstResponse = await handleRunnerOutboundRequest(
      createArtifactPutRequest({
        bytes,
        sha256,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
      RUNNER_PROXY_TOKEN,
    );
    const secondResponse = await handleRunnerOutboundRequest(
      createArtifactPutRequest({
        bytes,
        sha256,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(secondResponse.status).toBe(200);
    expect(firstResponse.status).toBe(200);
    expect(ownsActiveInvocationLease).toHaveBeenCalledTimes(2);
    expect(bindUser).toHaveBeenCalledOnce();
    expect(fixture.fetchMock).toHaveBeenCalledOnce();
  });

  it("recovers when a later artifact write lease check succeeds", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const ownsActiveInvocationLease = vi.fn();
    ownsActiveInvocationLease.mockImplementationOnce(() => {
      throw new Error("lease check failed");
    });
    ownsActiveInvocationLease.mockResolvedValueOnce(true);
    const bindUser = vi.fn(async (userId: string) => ({ userId }));
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName() {
          return {
            bindUser,
            ownsActiveInvocationLease,
          };
        },
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    const bytes = new Uint8Array([1, 2, 3]);
    const sha256 = sha256Hex(bytes);

    await expect(
      handleRunnerOutboundRequest(
        createArtifactPutRequest({
          bytes,
          sha256,
          workspaceVersion: "4",
        }),
        env,
        "member_123",
        RUNNER_PROXY_TOKEN,
      ),
    ).rejects.toThrow("lease check failed");
    expect(fixture.fetchMock).not.toHaveBeenCalled();
    const secondResponse = await handleRunnerOutboundRequest(
      createArtifactPutRequest({
        bytes,
        sha256,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(secondResponse.status).toBe(200);
    expect(ownsActiveInvocationLease).toHaveBeenCalledTimes(2);
    expect(bindUser).toHaveBeenCalledOnce();
    expect(fixture.fetchMock).toHaveBeenCalledOnce();
  });

  it("checks artifact write leases for different workspace versions", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const ownsActiveInvocationLease = vi.fn(async () => true);
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName() {
          return {
            async bindUser(userId: string) {
              return { userId };
            },
            ownsActiveInvocationLease,
          };
        },
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    const bytes = new Uint8Array([1, 2, 3]);
    const sha256 = sha256Hex(bytes);

    await handleRunnerOutboundRequest(
      createArtifactPutRequest({
        bytes,
        sha256,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
      RUNNER_PROXY_TOKEN,
    );
    await handleRunnerOutboundRequest(
      createArtifactPutRequest({
        bytes,
        sha256,
        workspaceVersion: "5",
      }),
      env,
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(ownsActiveInvocationLease).toHaveBeenCalledTimes(2);
  });

  it("checks artifact write leases again for repeated workspace versions", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const ownsActiveInvocationLease = vi.fn(async () => true);
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName() {
          return {
            async bindUser(userId: string) {
              return { userId };
            },
            ownsActiveInvocationLease,
          };
        },
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    const bytes = new Uint8Array([1, 2, 3]);
    const sha256 = sha256Hex(bytes);

    await handleRunnerOutboundRequest(
      createArtifactPutRequest({
        bytes,
        sha256,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
      RUNNER_PROXY_TOKEN,
    );
    await handleRunnerOutboundRequest(
      createArtifactPutRequest({
        bytes,
        sha256,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(ownsActiveInvocationLease).toHaveBeenCalledTimes(2);
  });

  it("checks artifact write leases again after denied artifact PUTs", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const ownsActiveInvocationLease = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName() {
          return {
            async bindUser(userId: string) {
              return { userId };
            },
            ownsActiveInvocationLease,
          };
        },
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    const bytes = new Uint8Array([1, 2, 3]);
    const sha256 = sha256Hex(bytes);

    const deniedResponse = await handleRunnerOutboundRequest(
      createArtifactPutRequest({
        bytes,
        sha256,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
      RUNNER_PROXY_TOKEN,
    );
    expect(fixture.fetchMock).not.toHaveBeenCalled();
    const allowedResponse = await handleRunnerOutboundRequest(
      createArtifactPutRequest({
        bytes,
        sha256,
        workspaceVersion: "4",
      }),
      env,
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(deniedResponse.status).toBe(401);
    expect(allowedResponse.status).toBe(200);
    expect(ownsActiveInvocationLease).toHaveBeenCalledTimes(2);
    expect(fixture.fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects artifact PUTs with missing lease headers before resolving crypto", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const bindUser = vi.fn(async (userId: string) => ({ userId }));
    const ownsActiveInvocationLease = vi.fn(async () => true);
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName() {
          return {
            bindUser,
            ownsActiveInvocationLease,
          };
        },
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    const bytes = new Uint8Array([1, 2, 3]);
    const sha256 = sha256Hex(bytes);

    const response = await handleRunnerOutboundRequest(
      new Request(`http://artifacts.worker/objects/${sha256}`, {
        body: toArrayBuffer(bytes),
        headers: createRunnerProxyHeaders(),
        method: "PUT",
      }),
      env,
      "member_123",
      RUNNER_PROXY_TOKEN,
    );

    expect(response.status).toBe(401);
    expect(bindUser).not.toHaveBeenCalled();
    expect(ownsActiveInvocationLease).not.toHaveBeenCalled();
    expect(fixture.fetchMock).not.toHaveBeenCalled();
  });

  it("does not retain resolved outbound plaintext crypto contexts", async () => {
    const fetchedAt = "2026-05-04T00:00:00.000Z";
    const fixture = await createHostedRuntimeCryptoContextFixture({
      cacheMaxAgeMs: 10_000,
      cryptoContextVersion: "ctx-no-plaintext-cache",
      fetchedAt,
    });
    const bindUser = vi.fn(async (userId: string) => ({ userId }));
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName() {
          return {
            bindUser,
          };
        },
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(fetchedAt));
    const environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(env));

    const firstContext = await resolveRunnerOutboundUserCryptoContext({
      bucket: env.BUNDLES,
      domain: "runtime",
      env,
      environment,
      userId: "member_123",
    });
    firstContext.rootKey[0] = 255;
    const secondContext = await resolveRunnerOutboundUserCryptoContext({
      bucket: env.BUNDLES,
      domain: "runtime",
      env,
      environment,
      userId: "member_123",
    });

    expect(firstContext.rootKeyId).toBe("udrk:runtime:test-root");
    expect(secondContext.rootKeyId).toBe("udrk:runtime:test-root");
    expect(secondContext).not.toBe(firstContext);
    expect(secondContext.rootKey).not.toBe(firstContext.rootKey);
    expect(secondContext.rootKey[0]).toBe(101);
    expect(fixture.fetchMock).toHaveBeenCalledOnce();
    expect(bindUser).toHaveBeenCalledOnce();
  });

  it("coalesces concurrent outbound runtime crypto cold binds and fetches", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture({
      cacheMaxAgeMs: 10_000,
      cryptoContextVersion: "ctx-pending-single-flight",
      fetchedAt: "2026-05-04T00:00:00.000Z",
    });
    let releaseBind!: () => void;
    const bindRelease = new Promise<void>((resolve) => {
      releaseBind = resolve;
    });
    const bindUser = vi.fn(async (userId: string) => {
      await bindRelease;
      return { userId };
    });
    const env = createRunnerOutboundEnv({
      ...fixture.env,
      USER_RUNNER: {
        getByName() {
          return {
            bindUser,
          };
        },
      },
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T00:00:00.000Z"));
    const environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(env));

    const firstContext = resolveRunnerOutboundUserCryptoContext({
      bucket: env.BUNDLES,
      domain: "runtime",
      env,
      environment,
      userId: "member_123",
    });
    const secondContext = resolveRunnerOutboundUserCryptoContext({
      bucket: env.BUNDLES,
      domain: "runtime",
      env,
      environment,
      userId: "member_123",
    });

    expect(bindUser).toHaveBeenCalledOnce();
    expect(fixture.fetchMock).not.toHaveBeenCalled();
    releaseBind();
    const [firstResolved, secondResolved] = await Promise.all([firstContext, secondContext]);

    expect(firstResolved.rootKeyId).toBe("udrk:runtime:test-root");
    expect(secondResolved.rootKeyId).toBe("udrk:runtime:test-root");
    expect(secondResolved).toBe(firstResolved);

    const thirdResolved = await resolveRunnerOutboundUserCryptoContext({
      bucket: env.BUNDLES,
      domain: "runtime",
      env,
      environment,
      userId: "member_123",
    });

    expect(thirdResolved).not.toBe(firstResolved);
    expect(bindUser).toHaveBeenCalledOnce();
    expect(fixture.fetchMock).toHaveBeenCalledOnce();
  });

  it("does not reuse outbound runtime crypto envelopes across hosted environment identity", async () => {
    const fetchedAt = "2026-05-04T00:00:00.000Z";
    const firstFixture = await createHostedRuntimeCryptoContextFixture({
      cacheMaxAgeMs: 10_000,
      cryptoContextVersion: "ctx-first-env",
      fetchedAt,
      runtimeRootKeyId: "udrk:runtime:first-root",
    });
    const secondFixture = await createHostedRuntimeCryptoContextFixture({
      authoritySignKeyVersion:
        "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/2",
      automationKeyId: "cf-key-v2",
      cacheMaxAgeMs: 10_000,
      cryptoContextVersion: "ctx-second-env",
      cryptoEnv: "staging",
      fetchedAt,
      runtimeRootKeyId: "udrk:runtime:second-root",
    });
    const firstEnv = createRunnerOutboundEnv({
      ...firstFixture.env,
      HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "callback:v1",
    });
    const secondEnv = createRunnerOutboundEnv({
      ...secondFixture.env,
      HOSTED_WEB_BASE_URL: "https://web-staging.example.test",
      HOSTED_WEB_CALLBACK_SIGNING_KEY_ID: "callback:v2",
    });
    const contextsByUrl = new Map([
      [`https://web.example.test${HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH}`, firstFixture.context],
      [
        `https://web-staging.example.test${HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH}`,
        secondFixture.context,
      ],
    ]);
    const fetchMock = vi.fn(async (
      ...args: Parameters<typeof fetch>
    ): Promise<Response> => {
      const [url, init] = args;
      const context = contextsByUrl.get(String(url));
      assert.ok(context);
      assert.equal(init?.method, "POST");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-hosted-execution-user-id"), "member_123");
      return new Response(JSON.stringify(context), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(fetchedAt));

    const firstContext = await resolveRunnerOutboundUserCryptoContext({
      bucket: firstEnv.BUNDLES,
      domain: "runtime",
      env: firstEnv,
      environment: readHostedExecutionEnvironment(asWorkerStringEnvironment(firstEnv)),
      userId: "member_123",
    });
    const secondContext = await resolveRunnerOutboundUserCryptoContext({
      bucket: secondEnv.BUNDLES,
      domain: "runtime",
      env: secondEnv,
      environment: readHostedExecutionEnvironment(asWorkerStringEnvironment(secondEnv)),
      userId: "member_123",
    });

    expect(firstContext.rootKeyId).toBe("udrk:runtime:first-root");
    expect(secondContext.rootKeyId).toBe("udrk:runtime:second-root");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refetches outbound runtime crypto envelopes after the envelope cache TTL", async () => {
    const fetchedAt = "2026-05-04T00:00:00.000Z";
    const fixture = await createHostedRuntimeCryptoContextFixture({
      cacheMaxAgeMs: 2_000,
      cryptoContextVersion: "ctx-short-envelope-ttl",
      fetchedAt,
    });
    const env = createRunnerOutboundEnv({
      ...fixture.env,
    });
    vi.stubGlobal("fetch", fixture.fetchMock);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(fetchedAt));
    const environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(env));

    await resolveRunnerOutboundUserCryptoContext({
      bucket: env.BUNDLES,
      domain: "runtime",
      env,
      environment,
      userId: "member_123",
    });
    await vi.advanceTimersByTimeAsync(2_001);
    await resolveRunnerOutboundUserCryptoContext({
      bucket: env.BUNDLES,
      domain: "runtime",
      env,
      environment,
      userId: "member_123",
    });

    expect(fixture.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not poison outbound runtime crypto context cache after a rejected fetch", async () => {
    const fixture = await createHostedRuntimeCryptoContextFixture();
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response("unavailable", { status: 503 });
      }

      return new Response(JSON.stringify(fixture.context), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const env = createRunnerOutboundEnv({
      ...fixture.env,
    });
    vi.stubGlobal("fetch", fetchMock);
    const environment = readHostedExecutionEnvironment(asWorkerStringEnvironment(env));

    await expect(resolveRunnerOutboundUserCryptoContext({
      bucket: env.BUNDLES,
      domain: "runtime",
      env,
      environment,
      userId: "member_123",
    })).rejects.toThrow(/Hosted runtime crypto context fetch failed/u);
    await expect(resolveRunnerOutboundUserCryptoContext({
      bucket: env.BUNDLES,
      domain: "runtime",
      env,
      environment,
      userId: "member_123",
    })).resolves.toMatchObject({
      rootKeyId: "udrk:runtime:test-root",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

function createArtifactPutRequest(input: {
  bytes: Uint8Array;
  sha256: string;
  workspaceVersion: string;
}): Request {
  return new Request(`http://artifacts.worker/objects/${input.sha256}`, {
    body: toArrayBuffer(input.bytes),
    headers: createRunnerProxyHeaders({
      "x-hosted-runtime-attempt-id": "attempt_1",
      "x-hosted-runtime-lease-generation": "9",
      "x-hosted-runtime-workspace-version": input.workspaceVersion,
    }),
    method: "PUT",
  });
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
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
            inputAvailable: false,
            nextAlarmAt: null,
            ok: true as const,
            pendingNudge: false,
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
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION,
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
      TEST_HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID:
      TEST_HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID,
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK:
      TEST_AUTOMATION_RECIPIENT_PRIVATE_JWK_JSON,
    HOSTED_CRYPTO_ENV: "test",
    HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: "murph-web",
    HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: "murph-team",
    HOSTED_WEB_BASE_URL: "https://web.example.test",
    HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK:
      "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"xSelVJv6r6LPUS8GCNgj1T_7z5GXOrhgY1cCdzGb5ao\",\"y\":\"8HhciS1cAPKs_fPfgZnb1USdRtBX-4Nvp8XiBHuMcmY\",\"d\":\"HAPljluiFVW3g-UEmrJ9NVYTlclAhaC8N5LT0h7vitQ\",\"ext\":true,\"key_ops\":[\"sign\"]}",
    ...overrides,
  } satisfies Omit<RunnerOutboundEnvironmentSource, "USER_RUNNER">;

  return {
    ...env,
    USER_RUNNER: {
      getByName(userId: string) {
        const stub = userRunnerNamespace.getByName(userId);
        return {
          ...stub,
          async bindUser(boundUserId: string) {
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

async function createHostedRuntimeCryptoContextFixture(input: {
  authoritySignKeyVersion?: string;
  automationKeyId?: string;
  cacheMaxAgeMs?: number;
  cryptoContextVersion?: string;
  cryptoEnv?: string;
  fetchedAt?: string;
  ingressRootKeyId?: string;
  runtimeRootKeyId?: string;
  userId?: string;
} = {}): Promise<{
  context: {
    cacheMaxAgeMs?: number;
    cryptoContextVersion?: string;
    envelopes: {
      ingress: HostedDomainRootKeyEnvelopeV1;
      runtime: HostedDomainRootKeyEnvelopeV1;
    };
    fetchedAt?: string;
    schema: "murph.hosted-runtime-crypto-context.v1";
    userId: string;
  };
  env: Partial<RunnerOutboundEnvironmentSource>;
  fetchMock: ReturnType<typeof vi.fn>;
}> {
  const userId = input.userId ?? "member_123";
  const authoritySignKeyVersion = input.authoritySignKeyVersion
    ?? "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1";
  const automationKeyId = input.automationKeyId ?? "cf-key-v1";
  const cacheMaxAgeMs = input.cacheMaxAgeMs ?? 60_000;
  const cryptoContextVersion = input.cryptoContextVersion ?? "ctx-v1";
  const cryptoEnv = input.cryptoEnv ?? "test";
  const fetchedAt = input.fetchedAt ?? new Date().toISOString();
  const cloudflareRecipient = await generateP256EcdhKeyPair();
  const signer = await generateP256SigningKeyPair();
  const context = {
    cacheMaxAgeMs,
    cryptoContextVersion,
    envelopes: {
      ingress: await createSignedWorkerEnvelope({
        authoritySignKeyVersion,
        cryptoEnv,
        domain: "ingress",
        publicJwk: cloudflareRecipient.publicJwk,
        recipientKeyId: automationKeyId,
        rootKey: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
        rootKeyId: input.ingressRootKeyId,
        signer: signer.privateKey,
        userId,
      }),
      runtime: await createSignedWorkerEnvelope({
        authoritySignKeyVersion,
        cryptoEnv,
        domain: "runtime",
        publicJwk: cloudflareRecipient.publicJwk,
        recipientKeyId: automationKeyId,
        rootKey: Uint8Array.from({ length: 32 }, (_, index) => 101 + index),
        rootKeyId: input.runtimeRootKeyId,
        signer: signer.privateKey,
        userId,
      }),
    },
    fetchedAt,
    schema: "murph.hosted-runtime-crypto-context.v1" as const,
    userId,
  };
  const fetchMock = vi.fn(async (
    ...args: Parameters<typeof fetch>
  ): Promise<Response> => {
    const [url, init] = args;
    assert.equal(String(url), `https://web.example.test${HOSTED_RUNTIME_CRYPTO_CONTEXT_PATH}`);
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("x-hosted-execution-user-id"), userId);
    return new Response(JSON.stringify(context), {
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      status: 200,
    });
  });

  return {
    context,
    env: {
      HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: authoritySignKeyVersion,
      HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM: signer.publicKeyPem.replace(/\n/g, "\\n"),
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: automationKeyId,
      HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify(
        cloudflareRecipient.privateJwk,
      ),
      HOSTED_CRYPTO_ENV: cryptoEnv,
    },
    fetchMock,
  };
}

async function createSignedWorkerEnvelope(input: {
  authoritySignKeyVersion?: string;
  cryptoEnv?: string;
  domain: "ingress" | "runtime";
  publicJwk: JsonWebKey;
  recipientKeyId?: string;
  rootKey: Uint8Array;
  rootKeyId?: string;
  signer: CryptoKey;
  userId: string;
}): Promise<HostedDomainRootKeyEnvelopeV1> {
  const authoritySignKeyVersion = input.authoritySignKeyVersion
    ?? "projects/test/locations/global/keyRings/ring/cryptoKeys/sign/cryptoKeyVersions/1";
  const cryptoEnv = input.cryptoEnv ?? "test";
  const recipientKeyId = input.recipientKeyId ?? "cf-key-v1";
  const rootKeyId = input.rootKeyId ?? `udrk:${input.domain}:test-root`;
  const now = "2026-05-01T00:00:00.000Z";
  const wrap = await wrapHostedDomainRootKeyWithP256Ecdh({
    encryptionContext: buildHostedDomainRootWrapContext({
      domain: input.domain,
      env: cryptoEnv,
      recipient: "cloudflare-automation-secret",
      rootKeyId,
      userId: input.userId,
    }),
    recipient: "cloudflare-automation-secret",
    recipientKeyId,
    recipientPublicJwk: input.publicJwk,
    rootKey: input.rootKey,
  });
  const body: HostedDomainRootKeyEnvelopeBodyV1 = {
    createdAt: now,
    domain: input.domain,
    generation: 1,
    rootKeyId,
    schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
    updatedAt: now,
    userId: input.userId,
    wraps: [wrap],
  };
  const signature = await crypto.subtle.sign(
    { hash: "SHA-256", name: "ECDSA" },
    input.signer,
    toArrayBuffer(buildHostedDomainRootEnvelopeSigningPayload(body)),
  );
  return attachHostedDomainRootEnvelopeSignature({
    body,
    keyVersionName: authoritySignKeyVersion,
    signature: Buffer.from(new Uint8Array(signature)).toString("base64"),
    signedAt: now,
  });
}

async function generateP256EcdhKeyPair(): Promise<{
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  return {
    privateJwk: await crypto.subtle.exportKey("jwk", keyPair.privateKey),
    publicJwk: await crypto.subtle.exportKey("jwk", keyPair.publicKey),
  };
}

async function generateP256SigningKeyPair(): Promise<{
  privateKey: CryptoKey;
  publicKeyPem: string;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  return {
    privateKey: keyPair.privateKey,
    publicKeyPem: toSpkiPem(await crypto.subtle.exportKey("spki", keyPair.publicKey)),
  };
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function toSpkiPem(value: ArrayBuffer): string {
  const base64 = Buffer.from(new Uint8Array(value)).toString("base64");
  const lines = base64.match(/.{1,64}/gu) ?? [base64];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}
