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
      "deleteUserData",
      "getRunnerStatus",
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
      fetchImpl: vi.fn(async () => createJsonResponse(createRunnerStatus())) as typeof fetch,
      getBearerToken: async () => "token-123",
    });

    await expect(client.getRunnerStatus("user_123")).resolves.toEqual(createRunnerStatus());
  });

  it("rejects blank user identifiers before issuing requests", () => {
    const fetchImpl = vi.fn(async () => createJsonResponse(createRunnerStatus())) as typeof fetch;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl,
      getBearerToken: async () => "token-123",
    });

    expect(() => client.getRunnerStatus("  \t")).toThrow(
      "Cloudflare hosted control userId must not be blank.",
    );
    expect(() => client.deleteUserData("")).toThrow(
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
    const promise = client.getRunnerStatus("user_123");

    await expect(promise).rejects.toThrow("Hosted execution runner status failed with HTTP 500.");
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
          encryptedReplica: createReplicaEnvelope(),
          replicaAad: {
            ...createReplicaAad(),
            runtimeRootKeyId: "udrk:runtime:other-root",
          },
          replicaKeyEnvelope: createReplicaKeyEnvelope(),
          replicaRef: createReplicaRef(),
          state: "ready",
        }),
      message: "Cloudflare browser vault session replicaAad.runtimeRootKeyId must match the requested replicaRef.runtimeRootKeyId.",
      name: "replica AAD runtime root differs from the request",
    },
    {
      buildResponse: () =>
        createBrowserVaultSession({
          encryptedReplica: createReplicaEnvelope(),
          replicaAad: {
            ...createReplicaAad(),
            dataKeyId: "hdk:browser-vault-replica:other",
          },
          replicaKeyEnvelope: createReplicaKeyEnvelope(),
          replicaRef: createReplicaRef(),
          state: "ready",
        }),
      message:
        "Cloudflare browser vault session replicaAad.dataKeyId must match the requested replicaRef.dataKeyEnvelope.dataKeyId.",
      name: "replica AAD data key differs from the request",
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
        "Cloudflare browser vault session encryptedReplica.keyId must match the requested replica storage key id.",
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
        "Cloudflare browser vault session replicaKeyEnvelope.recipients[0].keyId must match the requested replica storage key id.",
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

  it("fetches runner status without a run record contract", async () => {
    let observedRequest: ObservedRequest | null = null;
    const status = createRunnerStatus({ userId: "user_123" });
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        observedRequest = { init, url: String(url) };
        return createJsonResponse(status);
      }) as typeof fetch,
      getBearerToken: async () => "  Bearer token-123  ",
      timeoutMs: 2_500,
    });

    await expect(client.getRunnerStatus("user_123")).resolves.toEqual(status);

    const request = requireObservedRequest(observedRequest);
    expect(request.url).toBe("https://runner.example.test/root/internal/users/user_123/status");
    expect(request.init?.method).toBe("GET");
    expect(new Headers(request.init?.headers).get("authorization")).toBe("Bearer token-123");
    expect(new Headers(request.init?.headers).get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("user_123");
    expect(request.init?.redirect).toBe("error");
    expect(request.init?.signal).toBeInstanceOf(AbortSignal);
    expectNoRunContractFields(status);
  });

  it("rejects runner status responses for another user", async () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () =>
        createJsonResponse(createRunnerStatus({ userId: "user_other" }))) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
      timeoutMs: 2_500,
    });

    await expect(client.getRunnerStatus("user_123")).rejects.toThrow(
      "Hosted runner status userId must match the requested userId.",
    );
  });

  it("rejects runner status responses with a workspace for another user", async () => {
    const status = createRunnerStatus({ userId: "user_123" });
    status.workspace.userId = "user_other";
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () => createJsonResponse(status)) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
      timeoutMs: 2_500,
    });

    await expect(client.getRunnerStatus("user_123")).rejects.toThrow(
      "Hosted runner status workspace.userId must match the requested userId.",
    );
  });

  it("posts user data deletion requests and validates the bound user in the response", async () => {
    let observedRequest: ObservedRequest | null = null;
    const result = createUserDataDeletionResult({ userId: "user_123" });
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        observedRequest = { init, url: String(url) };
        return createJsonResponse(result);
      }) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
      timeoutMs: 2_500,
    });

    await expect(client.deleteUserData("user_123")).resolves.toEqual(result);

    const request = requireObservedRequest(observedRequest);
    expect(request.url).toBe("https://runner.example.test/root/internal/users/user_123/account-data/delete");
    expect(request.init?.method).toBe("POST");
    expect(request.init?.body).toBe("{}");
    expect(new Headers(request.init?.headers).get("authorization")).toBe("Bearer token-123");
    expect(new Headers(request.init?.headers).get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("user_123");
    expectNoRunContractFields(result);
  });

  it("rejects user data deletion responses for another user", async () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () =>
        createJsonResponse(createUserDataDeletionResult({ userId: "user_other" }))) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
      timeoutMs: 2_500,
    });

    await expect(client.deleteUserData("user_123")).rejects.toThrow(
      "Cloudflare user-data deletion result userId must match the requested userId.",
    );
  });

  it("rejects malformed user data deletion counts", async () => {
    const result = createUserDataDeletionResult({ userId: "user_123" });
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () =>
        createJsonResponse({
          ...result,
          r2: {
            ...result.r2,
            deletedObjectCount: -1,
          },
        })) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
      timeoutMs: 2_500,
    });

    await expect(client.deleteUserData("user_123")).rejects.toThrow(
      "Cloudflare user-data deletion result r2.deletedObjectCount must be a non-negative integer.",
    );
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
    dataKeyEnvelope: {
      alg: "AES-256-GCM-HKDF-SHA256" as const,
      dataKeyId: "hdk:browser-vault-replica:d",
      domain: "runtime" as const,
      lane: "browser-vault-replica" as const,
      resource: {
        objectKey: "users/browser-vault-replicas/opaque/replica.json",
        purpose: "browser-vault-replica",
        userId: "user_123",
      },
      rootKeyId: "udrk:runtime:test-root",
      schema: "murph.hosted-data-key-envelope.v1" as const,
      wraps: [{
        ciphertext: "wrapped-data-key",
        iv: "wrap-iv",
        kind: "domain-root" as const,
        rootKeyId: "udrk:runtime:test-root",
      }],
    },
    dataVersion: "d".repeat(64),
    generatedAt: "2026-04-20T08:00:00.000Z",
    keyId: "browser-vault-replica:d",
    objectKey: "users/browser-vault-replicas/opaque/replica.json",
    replicaSchema: "murph.browser-vault-replica" as const,
    schema: "murph.hosted-browser-vault-replica-ref.v1" as const,
    runtimeRootKeyId: "udrk:runtime:test-root",
    sourceBundleHash: "a".repeat(64),
  };
}

function createReplicaAad() {
  return {
    dataKeyId: "hdk:browser-vault-replica:d",
    dataKeyRootKeyId: "udrk:runtime:test-root",
    dataVersion: "d".repeat(64),
    objectKey: "users/browser-vault-replicas/opaque/replica.json",
    purpose: "browser-vault-replica" as const,
    runtimeRootKeyId: "udrk:runtime:test-root",
    schema: "murph.browser-vault-replica" as const,
    sourceBundleHash: "a".repeat(64),
    userId: "user_123",
  };
}

function createReplicaEnvelope() {
  return {
    algorithm: "AES-GCM" as const,
    ciphertext: "ciphertext",
    iv: "iv",
    keyId: "hdk:browser-vault-replica:d",
    schema: "murph.hosted-cipher.v1",
    scope: "browser-vault-replica" as const,
  };
}

function createReplicaKeyEnvelope() {
  return {
    createdAt: "2026-04-20T08:00:00.000Z",
    keyId: "hdk:browser-vault-replica:d",
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
        keyId: "hdk:browser-vault-replica:d",
        kind: "browser-session" as const,
      },
    ],
    schema: "murph.hosted-browser-session-key-envelope.v1" as const,
    userId: "user_123",
  };
}

function createUserDataDeletionResult(input: { userId: string }) {
  return {
    deletedAt: "2026-04-29T00:00:00.000Z",
    durableObject: {
      alarmCleared: true,
      stateDeleted: true,
    },
    ok: true,
    r2: {
      deletedObjectCount: 4,
      skippedUserScopedPrefixes: false,
      supported: true,
      userScopedSkipReason: null,
    },
    userId: input.userId,
  };
}

function createRunnerStatus(
  input: Partial<{
    heartbeatAt: string | null;
    inFlight: boolean;
    lastErrorAt: string | null;
    lastErrorCode: string | null;
    lastInvocationAt: string | null;
    nextAlarmAt: string | null;
    userId: string;
  }> = {},
) {
  return {
    heartbeatAt: input.heartbeatAt ?? "2026-04-26T00:00:01.000Z",
    inFlight: input.inFlight ?? false,
    lastErrorAt: input.lastErrorAt ?? null,
    lastErrorCode: input.lastErrorCode ?? null,
    lastInvocationAt: input.lastInvocationAt ?? null,
    mailboxLag: [
      {
        importedSeq: "2",
        lag: "1",
        lane: "conversation",
        maxSeq: "3",
      },
      {
        importedSeq: "1",
        lag: "0",
        lane: "system",
        maxSeq: "1",
      },
    ],
    nextAlarmAt: input.nextAlarmAt ?? null,
    recentLogs: [],
    userId: input.userId ?? "user_123",
    workspace: {
      checkpointedAt: "2026-04-26T00:00:00.000Z",
      createdAt: "2026-04-26T00:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: {
        importedConversationSeq: "2",
      },
      snapshotRef: null,
      updatedAt: "2026-04-26T00:00:00.000Z",
      userId: input.userId ?? "user_123",
      version: "4",
    },
  };
}

function expectNoRunContractFields(value: unknown): void {
  const disallowedKeys = new Set([
    "committedSeq",
    "requestedTargetSeq",
    "runId",
    "targetCommittedSeqHint",
    "targetSeq",
  ]);
  const keys = collectPropertyKeys(value);

  expect(keys.filter((key) => disallowedKeys.has(key))).toEqual([]);
}

function collectPropertyKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectPropertyKeys(item));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => [
    key,
    ...collectPropertyKeys(nestedValue),
  ]);
}
