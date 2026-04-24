import { describe, expect, it, vi } from "vitest";

import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murphai/hosted-execution/contracts";

import {
  type CloudflareHostedControlClientOptions,
  createCloudflareHostedControlClient,
} from "../src/client.ts";
import {
  CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
} from "../src/routes.ts";

type ObservedRequest = { init?: RequestInit; url: string };

describe("createCloudflareHostedControlClient", () => {
  it("exposes only the narrowed execution-plane helpers", () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      getBearerToken: async () => "token-123",
    });

    expect(Object.keys(client).sort()).toEqual([
      "createBrowserVaultSession",
      "getStatus",
      "nudgeUserRun",
    ]);
  });

  it("rejects an unconfigured base URL before issuing a request", () => {
    expect(() =>
      createCloudflareHostedControlClient({
        baseUrl: "   ",
        getBearerToken: async () => "token-123",
      }),
    ).toThrow("Hosted execution baseUrl must be configured.");
  });

  it("rejects a missing bearer token provider before issuing a request", () => {
    const options = {
      baseUrl: "https://runner.example.test",
      getBearerToken: async () => "token-123",
    } satisfies CloudflareHostedControlClientOptions;

    Object.defineProperty(options, "getBearerToken", { value: undefined });

    expect(() => createCloudflareHostedControlClient(options)).toThrow(
      "Hosted execution getBearerToken must be configured.",
    );
  });

  it("accepts a loopback HTTP base URL only when explicitly allowed", async () => {
    expect(() =>
      createCloudflareHostedControlClient({
        baseUrl: "http://127.0.0.1:8787",
        getBearerToken: async () => "token-123",
      }),
    ).toThrow(/HTTPS unless the host is explicitly allowlisted/u);

    const client = createCloudflareHostedControlClient({
      allowHttpLocalhost: true,
      baseUrl: "http://127.0.0.1:8787",
      fetchImpl: vi.fn(async () => createJsonResponse(createUserStatus())) as typeof fetch,
      getBearerToken: async () => "token-123",
    });

    await expect(client.getStatus("user_123")).resolves.toEqual(createUserStatus());
  });

  it("rejects blank user identifiers before issuing requests", () => {
    const fetchImpl = vi.fn(async () => createJsonResponse(createUserStatus())) as typeof fetch;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl,
      getBearerToken: async () => "token-123",
    });

    expect(() => client.getStatus("  \t")).toThrow(
      "Cloudflare hosted control userId must not be blank.",
    );
    expect(() => client.nudgeUserRun("")).toThrow(
      "Cloudflare hosted control userId must not be blank.",
    );
    expect(() =>
      client.createBrowserVaultSession({
        browserPublicKeyJwk: {
          crv: "P-256",
          kty: "EC",
          x: "x-value",
          y: "y-value",
        },
        replicaRef: createReplicaRef(),
        userId: "\n",
      })
    ).toThrow("Cloudflare hosted control userId must not be blank.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not echo HTTP response bodies in thrown errors", async () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl: vi.fn(async () =>
        new Response("provider_token=secret-value", { status: 500 })) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
    });
    const promise = client.getStatus("user_123");

    await expect(promise).rejects.toThrow("Hosted execution status failed with HTTP 500.");
    await expect(promise).rejects.not.toThrow(/provider_token/u);
  });

  it("fetches browser vault sessions with the expected request and parses ready replica responses", async () => {
    let observedRequest: ObservedRequest | null = null;
    const responseBody = createBrowserVaultSession({
      encryptedReplica: createReplicaEnvelope(),
      replicaAad: createReplicaAad(),
      replicaKeyEnvelope: createReplicaKeyEnvelope(),
      replicaRef: createReplicaRef(),
      state: "ready",
    });
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        observedRequest = { init, url: String(url) };
        return createJsonResponse(responseBody);
      }) as typeof fetch,
      getBearerToken: async () => "token-123",
      timeoutMs: 2_500,
    });

    await expect(client.createBrowserVaultSession({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef: createReplicaRef(),
      userId: "user_123",
    })).resolves.toEqual(responseBody);

    const request = requireObservedRequest(observedRequest);
    expect(request.url).toBe("https://runner.example.test/root/internal/users/user_123/browser-vault/session");
    expect(request.init?.method).toBe("POST");
    expect(new Headers(request.init?.headers).get("authorization")).toBe("Bearer token-123");
    expect(new Headers(request.init?.headers).get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("user_123");
    expect(request.init?.body).toBe(JSON.stringify({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef: createReplicaRef(),
    }));
  });

  it("rejects browser vault sessions that are not ready", async () => {
    const responseBody = createBrowserVaultSession({
      encryptedReplica: null,
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: null,
      state: "empty",
    });
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () => createJsonResponse(responseBody)) as typeof fetch,
      getBearerToken: async () => "token-123",
      timeoutMs: 2_500,
    });

    await expect(client.createBrowserVaultSession({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef: createReplicaRef(),
      userId: "user_123",
    })).rejects.toThrow("Cloudflare browser vault session state must be ready.");
  });

  it("maps missing browser vault replica objects to a dedicated not-found error", async () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () =>
        createJsonResponse({
          code: CLOUDFLARE_HOSTED_CONTROL_BROWSER_VAULT_REPLICA_NOT_FOUND_CODE,
          error: "Browser vault replica was not found.",
        }, { status: 404 })) as typeof fetch,
      getBearerToken: async () => "token-123",
      timeoutMs: 2_500,
    });

    await expect(client.createBrowserVaultSession({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef: createReplicaRef(),
      userId: "user_123",
    })).rejects.toThrow("Hosted execution browser vault replica was not found.");
  });

  it("leaves generic browser vault 404s as HTTP failures", async () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () =>
        createJsonResponse({
          error: "Not found",
        }, { status: 404 })) as typeof fetch,
      getBearerToken: async () => "token-123",
      timeoutMs: 2_500,
    });
    const promise = client.createBrowserVaultSession({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef: createReplicaRef(),
      userId: "user_123",
    });

    await expect(promise).rejects.toThrow(
      "Hosted execution browser vault session failed with HTTP 404.",
    );
    await expect(promise).rejects.not.toThrow(
      "Hosted execution browser vault replica was not found.",
    );
  });

  for (const scenario of [
    {
      buildResponse: () =>
        createBrowserVaultSession({
          encryptedReplica: createReplicaEnvelope(),
          replicaAad: createReplicaAad(),
          replicaKeyEnvelope: createReplicaKeyEnvelope(),
          replicaRef: {
            ...createReplicaRef(),
            objectKey: "users/browser-vault-replicas/other/replica.json",
          },
          state: "ready",
        }),
      message:
        "Cloudflare browser vault session replicaRef.objectKey must match the requested replicaRef.objectKey.",
      name: "returned replicaRef objectKey differs from the request",
    },
    {
      buildResponse: () =>
        createBrowserVaultSession({
          encryptedReplica: createReplicaEnvelope(),
          replicaAad: {
            ...createReplicaAad(),
            userId: "user_other",
          },
          replicaKeyEnvelope: createReplicaKeyEnvelope(),
          replicaRef: createReplicaRef(),
          state: "ready",
        }),
      message: "Cloudflare browser vault session replicaAad.userId must match the requested userId.",
      name: "replica AAD user differs from the request",
    },
    {
      buildResponse: () =>
        createBrowserVaultSession({
          encryptedReplica: createReplicaEnvelope(),
          replicaAad: {
            ...createReplicaAad(),
            sourceBundleHash: "b".repeat(64),
          },
          replicaKeyEnvelope: createReplicaKeyEnvelope(),
          replicaRef: createReplicaRef(),
          state: "ready",
        }),
      message:
        "Cloudflare browser vault session replicaAad.sourceBundleHash must match the requested replicaRef.sourceBundleHash.",
      name: "replica AAD source bundle differs from the request",
    },
    {
      buildResponse: () =>
        createBrowserVaultSession({
          encryptedReplica: {
            ...createReplicaEnvelope(),
            keyId: "browser-vault-replica:other",
          },
          replicaAad: createReplicaAad(),
          replicaKeyEnvelope: createReplicaKeyEnvelope(),
          replicaRef: createReplicaRef(),
          state: "ready",
        }),
      message:
        "Cloudflare browser vault session encryptedReplica.keyId must match the requested replicaRef.keyId.",
      name: "encrypted replica key differs from the request",
    },
    {
      buildResponse: () =>
        createBrowserVaultSession({
          encryptedReplica: {
            ...createReplicaEnvelope(),
            scope: "bundle",
          },
          replicaAad: createReplicaAad(),
          replicaKeyEnvelope: createReplicaKeyEnvelope(),
          replicaRef: createReplicaRef(),
          state: "ready",
        }),
      message:
        "Cloudflare browser vault session encryptedReplica.scope must match the browser-vault-replica storage scope.",
      name: "encrypted replica scope is not browser-vault-replica",
    },
    {
      buildResponse: () =>
        createBrowserVaultSession({
          encryptedReplica: createReplicaEnvelope(),
          replicaAad: createReplicaAad(),
          replicaKeyEnvelope: {
            ...createReplicaKeyEnvelope(),
            userId: "user_other",
          },
          replicaRef: createReplicaRef(),
          state: "ready",
        }),
      message:
        "Cloudflare browser vault session replicaKeyEnvelope.userId must match the requested userId.",
      name: "key envelope user differs from the request",
    },
    {
      buildResponse: () => {
        const keyEnvelope = createReplicaKeyEnvelope();
        return createBrowserVaultSession({
          encryptedReplica: createReplicaEnvelope(),
          replicaAad: createReplicaAad(),
          replicaKeyEnvelope: {
            ...keyEnvelope,
            recipients: keyEnvelope.recipients.map((recipient) => ({
              ...recipient,
              keyId: "browser-vault-replica:other",
            })),
          },
          replicaRef: createReplicaRef(),
          state: "ready",
        });
      },
      message:
        "Cloudflare browser vault session replicaKeyEnvelope.recipients[0].keyId must match the requested replicaRef.keyId.",
      name: "recipient key differs from the request",
    },
  ]) {
    it(`rejects ready browser vault sessions when ${scenario.name}`, async () => {
      const client = createCloudflareHostedControlClient({
        baseUrl: "https://runner.example.test/root/",
        fetchImpl: vi.fn(async () => createJsonResponse(scenario.buildResponse())) as typeof fetch,
        getBearerToken: async () => "token-123",
        timeoutMs: 2_500,
      });

      await expect(client.createBrowserVaultSession({
        browserPublicKeyJwk: {
          crv: "P-256",
          kty: "EC",
          x: "x-value",
          y: "y-value",
        },
        replicaRef: createReplicaRef(),
        userId: "user_123",
      })).rejects.toThrow(scenario.message);
    });
  }

  it("rejects ready browser vault sessions without a replica ref", async () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () => createJsonResponse({
        encryptedReplica: createReplicaEnvelope(),
        replicaAad: createReplicaAad(),
        replicaKeyEnvelope: createReplicaKeyEnvelope(),
        replicaRef: null,
        state: "ready",
      })) as typeof fetch,
      getBearerToken: async () => "token-123",
      timeoutMs: 2_500,
    });

    await expect(client.createBrowserVaultSession({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef: createReplicaRef(),
      userId: "user_123",
    })).rejects.toThrow("Cloudflare browser vault session replicaRef must not be null.");
  });

  it("rejects ready browser vault sessions that omit replica payload fields", async () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () => createJsonResponse({
        encryptedReplica: null,
        replicaAad: createReplicaAad(),
        replicaKeyEnvelope: createReplicaKeyEnvelope(),
        replicaRef: createReplicaRef(),
        state: "ready",
      })) as typeof fetch,
      getBearerToken: async () => "token-123",
      timeoutMs: 2_500,
    });

    await expect(client.createBrowserVaultSession({
      browserPublicKeyJwk: {
        crv: "P-256",
        kty: "EC",
        x: "x-value",
        y: "y-value",
      },
      replicaRef: createReplicaRef(),
      userId: "user_123",
    })).rejects.toThrow("Cloudflare browser vault session encryptedReplica must be an object.");
  });

  it("fetches user status with the expected request shape", async () => {
    let observedRequest: ObservedRequest | null = null;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        observedRequest = { init, url: String(url) };
        return createJsonResponse(createUserStatus({ userId: "user_123" }));
      }) as typeof fetch,
      getBearerToken: async () => "  Bearer token-123  ",
      timeoutMs: 2_500,
    });

    await expect(client.getStatus("user_123")).resolves.toEqual(
      createUserStatus({ userId: "user_123" }),
    );

    const request = requireObservedRequest(observedRequest);
    expect(request.url).toBe("https://runner.example.test/root/internal/users/user_123/status");
    expect(request.init?.method).toBe("GET");
    expect(new Headers(request.init?.headers).get("authorization")).toBe("Bearer token-123");
    expect(new Headers(request.init?.headers).get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("user_123");
    expect(request.init?.redirect).toBe("error");
    expect(request.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects user status responses for another user", async () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () =>
        createJsonResponse(createUserStatus({ userId: "user_other" }))) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
      timeoutMs: 2_500,
    });

    await expect(client.getStatus("user_123")).rejects.toThrow(
      "Hosted execution status userId must match the requested userId.",
    );
  });

  it("posts run requests without a synchronous drain contract", async () => {
    let observedRequest: ObservedRequest | null = null;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        observedRequest = { init, url: String(url) };
        return createJsonResponse(createWakeNudgeResult({
          accepted: true,
          alreadyRunning: true,
        }));
      }) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
      timeoutMs: 2_500,
    });

    await expect(
      client.nudgeUserRun("user_123"),
    ).resolves.toEqual(createWakeNudgeResult({
      accepted: true,
      alreadyRunning: true,
    }));

    const request = requireObservedRequest(observedRequest);
    expect(request.url).toBe("https://runner.example.test/root/internal/users/user_123/run");
    expect(request.init?.method).toBe("POST");
    expect(new Headers(request.init?.headers).get("authorization")).toBe("Bearer token-123");
    expect(new Headers(request.init?.headers).get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("user_123");
    expect(request.init?.body).toBe("{}");
  });

});

function createJsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(value), {
    ...init,
    headers,
    status: init.status ?? 200,
  });
}

function requireObservedRequest(request: ObservedRequest | null): ObservedRequest {
  if (!request) {
    throw new Error("Expected the fetch mock to capture a request.");
  }

  return request;
}

function createBrowserVaultSession(input: {
  encryptedReplica: unknown;
  replicaAad: unknown;
  replicaKeyEnvelope: unknown;
  replicaRef: unknown;
  state: unknown;
}) {
  return {
    encryptedReplica: input.encryptedReplica,
    replicaAad: input.replicaAad,
    replicaKeyEnvelope: input.replicaKeyEnvelope,
    replicaRef: input.replicaRef,
    state: input.state,
  };
}

function createReplicaRef() {
  return {
    byteLength: 128,
    dataVersion: "d".repeat(64),
    generatedAt: "2026-04-20T08:00:00.000Z",
    keyId: "browser-vault-replica:d",
    objectKey: "users/browser-vault-replicas/opaque/replica.json",
    replicaSchema: "murph.browser-vault-replica.v1" as const,
    schema: "murph.hosted-browser-vault-replica-ref.v1" as const,
    sourceBundleHash: "a".repeat(64),
  };
}

function createReplicaAad() {
  return {
    dataVersion: "d".repeat(64),
    objectKey: "users/browser-vault-replicas/opaque/replica.json",
    purpose: "browser-vault-replica" as const,
    schema: "murph.browser-vault-replica.v1" as const,
    sourceBundleHash: "a".repeat(64),
    userId: "user_123",
  };
}

function createReplicaEnvelope() {
  return {
    algorithm: "AES-GCM" as const,
    ciphertext: "ciphertext",
    iv: "iv",
    keyId: "browser-vault-replica:d",
    schema: "murph.hosted-cipher.v1",
    scope: "browser-vault-replica" as const,
  };
}

function createReplicaKeyEnvelope() {
  return {
    createdAt: "2026-04-20T08:00:00.000Z",
    keyId: "browser-vault-replica:d",
    purpose: "browser-vault-replica" as const,
    recipients: [
      {
        ciphertext: "ciphertext",
        ephemeralPublicKeyJwk: {
          crv: "P-256",
          kty: "EC",
          x: "ephemeral-x",
          y: "ephemeral-y",
        },
        iv: "iv",
        keyId: "browser-vault-replica:d",
        kind: "browser-session" as const,
      },
    ],
    schema: "murph.hosted-browser-session-key-envelope.v1" as const,
    userId: "user_123",
  };
}

function createUserStatus(
  input: Partial<{
    bundleRef: unknown;
    inFlight: boolean;
    lastError: string | null;
    lastEventId: string | null;
    lastRunAt: string | null;
    nextWakeAt: string | null;
    pendingIngressEventCount: number;
    userId: string;
  }> = {},
) {
  return {
    bundleRef: input.bundleRef ?? null,
    inFlight: input.inFlight ?? false,
    lastError: input.lastError ?? null,
    lastEventId: input.lastEventId ?? null,
    lastRunAt: input.lastRunAt ?? null,
    nextWakeAt: input.nextWakeAt ?? null,
    pendingIngressEventCount: input.pendingIngressEventCount ?? 0,
    userId: input.userId ?? "user_123",
  };
}

function createWakeNudgeResult(
  input: Partial<{
    accepted: boolean;
    alarmScheduled: boolean;
    alreadyRunning: boolean;
  }> = {},
) {
  return {
    accepted: input.accepted ?? true,
    alarmScheduled: input.alarmScheduled ?? false,
    alreadyRunning: input.alreadyRunning ?? false,
  };
}
