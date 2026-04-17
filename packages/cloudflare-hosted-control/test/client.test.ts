import { describe, expect, it, vi } from "vitest";

import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murphai/hosted-execution/contracts";

import {
  type CloudflareHostedControlClientOptions,
  createCloudflareHostedControlClient,
} from "../src/client.ts";

type ObservedRequest = { init?: RequestInit; url: string };

describe("createCloudflareHostedControlClient", () => {
  it("exposes only the narrowed execution-plane helpers", () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      getBearerToken: async () => "token-123",
    });

    expect(Object.keys(client).sort()).toEqual([
      "createBrowserVaultSession",
      "getEventStatus",
      "getStatus",
      "wakeUser",
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

  it("fetches event status with the expected request shape", async () => {
    let observedRequest: ObservedRequest | null = null;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        observedRequest = { init, url: String(url) };
        return createJsonResponse({
          eventId: "member.activated:evt_123",
          lastError: null,
          state: "completed",
          userId: "user_123",
        });
      }) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
      timeoutMs: 2_500,
    });

    await expect(
      client.getEventStatus("user_123", "member.activated:evt_123"),
    ).resolves.toEqual({
      eventId: "member.activated:evt_123",
      lastError: null,
      state: "completed",
      userId: "user_123",
    });

    const request = requireObservedRequest(observedRequest);
    expect(request.url).toBe(
      "https://runner.example.test/root/internal/users/user_123/events/member.activated%3Aevt_123/status",
    );
    expect(request.init?.method).toBe("GET");
    expect(new Headers(request.init?.headers).get("authorization")).toBe("Bearer token-123");
    expect(new Headers(request.init?.headers).get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("user_123");
  });

  it("fetches browser vault sessions with the expected request and parses snapshotAad", async () => {
    let observedRequest: ObservedRequest | null = null;
    const responseBody = createBrowserVaultSession({
      rootKeyEnvelope: createRootKeyEnvelope(),
      snapshotAad: createSnapshotAad(),
      snapshotEnvelope: createSnapshotEnvelope(),
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

    await expect(client.createBrowserVaultSession("user_123", {
      crv: "P-256",
      kty: "EC",
      x: "x-value",
      y: "y-value",
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
    }));
  });

  it("accepts an all-null browser vault session response", async () => {
    const responseBody = createBrowserVaultSession({
      rootKeyEnvelope: null,
      snapshotAad: null,
      snapshotEnvelope: null,
    });
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () => createJsonResponse(responseBody)) as typeof fetch,
      getBearerToken: async () => "token-123",
      timeoutMs: 2_500,
    });

    await expect(client.createBrowserVaultSession("user_123", {
      crv: "P-256",
      kty: "EC",
      x: "x-value",
      y: "y-value",
    })).resolves.toEqual(responseBody);
  });

  it("rejects browser vault sessions that omit all triad fields entirely", async () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () => createJsonResponse({})) as typeof fetch,
      getBearerToken: async () => "token-123",
      timeoutMs: 2_500,
    });

    await expect(client.createBrowserVaultSession("user_123", {
      crv: "P-256",
      kty: "EC",
      x: "x-value",
      y: "y-value",
    })).rejects.toThrow(
      "Cloudflare browser vault session must include rootKeyEnvelope, snapshotAad, and snapshotEnvelope together.",
    );
  });

  it("rejects partial browser vault sessions that omit either envelope or snapshotAad", async () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async () => createJsonResponse({
        rootKeyEnvelope: null,
        snapshotAad: createSnapshotAad(),
        snapshotEnvelope: null,
      })) as typeof fetch,
      getBearerToken: async () => "token-123",
      timeoutMs: 2_500,
    });

    await expect(client.createBrowserVaultSession("user_123", {
      crv: "P-256",
      kty: "EC",
      x: "x-value",
      y: "y-value",
    })).rejects.toThrow(
      "Cloudflare browser vault session must include rootKeyEnvelope, snapshotAad, and snapshotEnvelope together.",
    );
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

  it("posts wake requests with an optional target sequence hint", async () => {
    let observedRequest: ObservedRequest | null = null;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        observedRequest = { init, url: String(url) };
        return createJsonResponse(createUserStatus({ userId: "user_123" }));
      }) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
      timeoutMs: 2_500,
    });

    await expect(
      client.wakeUser("user_123", { targetSeqHint: "42" }),
    ).resolves.toEqual(createUserStatus({ userId: "user_123" }));

    const request = requireObservedRequest(observedRequest);
    expect(request.url).toBe("https://runner.example.test/root/internal/users/user_123/wake");
    expect(request.init?.method).toBe("POST");
    expect(new Headers(request.init?.headers).get("authorization")).toBe("Bearer token-123");
    expect(new Headers(request.init?.headers).get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("user_123");
    expect(request.init?.body).toBe(JSON.stringify({
      targetSeqHint: "42",
    }));
  });

});

function createJsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status: 200,
  });
}

function requireObservedRequest(request: ObservedRequest | null): ObservedRequest {
  if (!request) {
    throw new Error("Expected the fetch mock to capture a request.");
  }

  return request;
}

function createBrowserVaultSession(input: {
  rootKeyEnvelope: unknown;
  snapshotAad: unknown;
  snapshotEnvelope: unknown;
}) {
  return {
    rootKeyEnvelope: input.rootKeyEnvelope,
    snapshotAad: input.snapshotAad,
    snapshotEnvelope: input.snapshotEnvelope,
  };
}

function createRootKeyEnvelope() {
  return {
    createdAt: "2026-04-17T08:10:36.000Z",
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
        keyId: "browser-session:test",
        kind: "user-unlock",
      },
    ],
    rootKeyId: "urk:test",
    schema: "murph.hosted-user-root-key-envelope.v1",
    updatedAt: "2026-04-17T08:10:36.000Z",
    userId: "user_123",
  };
}

function createSnapshotAad() {
  return {
    key: "users/browser-vault-snapshots/opaque.json",
    purpose: "browser-vault-snapshot" as const,
    userId: "user_123",
  };
}

function createSnapshotEnvelope() {
  return {
    algorithm: "AES-GCM" as const,
    ciphertext: "ciphertext",
    iv: "iv",
    keyId: "urk:test",
    schema: "murph.hosted-cipher.v1",
    scope: "browser-vault-snapshot" as const,
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
    pendingEventCount: number;
    poisonedEventIds: string[];
    retryingEventId: string | null;
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
    pendingEventCount: input.pendingEventCount ?? 0,
    poisonedEventIds: input.poisonedEventIds ?? [],
    retryingEventId: input.retryingEventId ?? null,
    userId: input.userId ?? "user_123",
  };
}
