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
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        observedRequest = { init, url: String(url) };
        return createJsonResponse({
          rootKeyEnvelope: null,
          snapshotAad: {
            key: "users/browser-vault-snapshots/opaque.json",
            purpose: "browser-vault-snapshot",
            userId: "user_123",
          },
          snapshotEnvelope: null,
        });
      }) as typeof fetch,
      getBearerToken: async () => "token-123",
      timeoutMs: 2_500,
    });

    await expect(client.createBrowserVaultSession("user_123", {
      crv: "P-256",
      kty: "EC",
      x: "x-value",
      y: "y-value",
    })).resolves.toEqual({
      rootKeyEnvelope: null,
      snapshotAad: {
        key: "users/browser-vault-snapshots/opaque.json",
        purpose: "browser-vault-snapshot",
        userId: "user_123",
      },
      snapshotEnvelope: null,
    });

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
