import { describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionGatewayMessageSendDispatch,
  buildHostedExecutionMemberActivatedDispatch,
  buildHostedExecutionOutboxPayload,
  parseHostedExecutionDispatchRequest,
} from "@murphai/hosted-execution";

import {
  type CloudflareHostedControlClientOptions,
  createCloudflareHostedControlClient,
} from "../src/client.ts";

describe("createCloudflareHostedControlClient", () => {
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

  it("fetches user env status with the expected request shape", async () => {
    let observedRequest: { init?: RequestInit; url: string } | null = null;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        observedRequest = { init, url: String(url) };
        return createJsonResponse({
          configuredUserEnvKeys: ["API_KEY", "TOKEN"],
          userId: "user_123",
        });
      }) as typeof fetch,
      getBearerToken: async () => "  Bearer token-123  ",
      timeoutMs: 2_500,
    });

    await expect(client.getUserEnvStatus("user_123")).resolves.toEqual({
      configuredUserEnvKeys: ["API_KEY", "TOKEN"],
      userId: "user_123",
    });

    expect(observedRequest?.url).toBe("https://runner.example.test/root/internal/users/user_123/env");
    expect(observedRequest?.init?.method).toBe("GET");
    expect(new Headers(observedRequest?.init?.headers).get("authorization")).toBe(
      "Bearer token-123",
    );
    expect(observedRequest?.init?.redirect).toBe("error");
    expect(observedRequest?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("fetches event status with the expected request shape", async () => {
    let observedRequest: { init?: RequestInit; url: string } | null = null;
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

    expect(observedRequest?.url).toBe(
      "https://runner.example.test/root/internal/users/user_123/events/member.activated%3Aevt_123/status",
    );
    expect(observedRequest?.init?.method).toBe("GET");
    expect(new Headers(observedRequest?.init?.headers).get("authorization")).toBe(
      "Bearer token-123",
    );
  });

  it("stores dispatch payloads using the parsed request body and bearer header", async () => {
    const dispatch = buildHostedExecutionMemberActivatedDispatch({
      eventId: "evt_123",
      memberId: "user_123",
      occurredAt: "2026-04-08T00:00:00.000Z",
    });
    const storedPayload = buildHostedExecutionOutboxPayload(dispatch);
    let observedRequest: { init?: RequestInit; url: string } | null = null;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        observedRequest = { init, url: String(url) };
        return createJsonResponse(storedPayload);
      }) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
      timeoutMs: 500,
    });

    await expect(client.storeDispatchPayload(dispatch)).resolves.toEqual(storedPayload);

    expect(observedRequest?.url).toBe(
      "https://runner.example.test/root/internal/users/user_123/dispatch-payload",
    );
    expect(observedRequest?.init?.method).toBe("PUT");
    expect(new Headers(observedRequest?.init?.headers).get("authorization")).toBe(
      "Bearer token-123",
    );
    expect(new Headers(observedRequest?.init?.headers).get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(observedRequest?.init?.redirect).toBe("error");
    expect(observedRequest?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(observedRequest?.init?.body))).toEqual(
      parseHostedExecutionDispatchRequest(dispatch),
    );
  });

  it("preserves 204 handling for deleteStoredDispatchPayload", async () => {
    const dispatch = buildHostedExecutionGatewayMessageSendDispatch({
      eventId: "gateway-123",
      occurredAt: "2026-04-08T00:00:00.000Z",
      sessionKey: "session_123",
      text: "hello from the reference lane",
      userId: "user_123",
    });
    const payload = buildHostedExecutionOutboxPayload(dispatch, {
      stagedPayloadId: "staged-gateway-123",
    });
    let observedRequest: { init?: RequestInit; url: string } | null = null;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        observedRequest = { init, url: String(url) };
        return new Response(null, { status: 204 });
      }) as typeof fetch,
      getBearerToken: async () => "token-123",
    });

    await expect(client.deleteStoredDispatchPayload(payload)).resolves.toBeUndefined();
    expect(observedRequest?.url).toBe(
      "https://runner.example.test/root/internal/users/user_123/dispatch-payload",
    );
    expect(observedRequest?.init?.method).toBe("DELETE");
    expect(new Headers(observedRequest?.init?.headers).get("authorization")).toBe(
      "Bearer token-123",
    );
    expect(JSON.parse(String(observedRequest?.init?.body))).toEqual(payload);
  });

  it("runs a user with the expected request shape", async () => {
    let observedRequest: { init?: RequestInit; url: string } | null = null;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        observedRequest = { init, url: String(url) };
        return createJsonResponse(createUserStatus({ userId: "user_123" }));
      }) as typeof fetch,
      getBearerToken: async () => "token-123",
      timeoutMs: 1_000,
    });

    await expect(client.run("user_123")).resolves.toEqual(createUserStatus({ userId: "user_123" }));

    expect(observedRequest?.url).toBe("https://runner.example.test/root/internal/users/user_123/run");
    expect(observedRequest?.init?.method).toBe("POST");
    expect(new Headers(observedRequest?.init?.headers).get("authorization")).toBe(
      "Bearer token-123",
    );
    expect(new Headers(observedRequest?.init?.headers).get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(JSON.parse(String(observedRequest?.init?.body))).toEqual({});
  });

  it("updates user env with the parsed request body", async () => {
    let observedRequest: { init?: RequestInit; url: string } | null = null;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        observedRequest = { init, url: String(url) };
        return createJsonResponse({
          configuredUserEnvKeys: ["HOSTED_API_KEY", "HOSTED_REGION"],
          userId: "user_123",
        });
      }) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
    });

    await expect(
      client.updateUserEnv("user_123", {
        env: {
          HOSTED_API_KEY: "api-key-123",
          HOSTED_REGION: null,
        },
        mode: "merge",
      }),
    ).resolves.toEqual({
      configuredUserEnvKeys: ["HOSTED_API_KEY", "HOSTED_REGION"],
      userId: "user_123",
    });

    expect(observedRequest?.url).toBe("https://runner.example.test/root/internal/users/user_123/env");
    expect(observedRequest?.init?.method).toBe("PUT");
    expect(JSON.parse(String(observedRequest?.init?.body))).toEqual({
      env: {
        HOSTED_API_KEY: "api-key-123",
        HOSTED_REGION: null,
      },
      mode: "merge",
    });
  });

  it("rejects invalid env updates before issuing a request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl,
      getBearerToken: async () => "Bearer token-123",
    });
    const invalidUpdate = JSON.parse('{"env":{"HOSTED_API_KEY":123},"mode":"merge"}');

    expect(() => client.updateUserEnv("user_123", invalidUpdate)).toThrow(
      "Hosted execution user env update env.HOSTED_API_KEY must be a string or null.",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("clears user env with DELETE and parses the response", async () => {
    let observedRequest: { init?: RequestInit; url: string } | null = null;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        observedRequest = { init, url: String(url) };
        return createJsonResponse({
          configuredUserEnvKeys: [],
          userId: "user_123",
        });
      }) as typeof fetch,
      getBearerToken: async () => "token-123",
    });

    await expect(client.clearUserEnv("user_123")).resolves.toEqual({
      configuredUserEnvKeys: [],
      userId: "user_123",
    });

    expect(observedRequest?.url).toBe("https://runner.example.test/root/internal/users/user_123/env");
    expect(observedRequest?.init?.method).toBe("DELETE");
    expect(observedRequest?.init?.body).toBeUndefined();
  });

  it("dispatches stored reference payloads using the payload user id route", async () => {
    const dispatch = buildHostedExecutionGatewayMessageSendDispatch({
      eventId: "gateway-123",
      occurredAt: "2026-04-08T00:00:00.000Z",
      sessionKey: "session_123",
      text: "hello from the reference lane",
      userId: "user_123",
    });
    const payload = buildHostedExecutionOutboxPayload(dispatch, {
      stagedPayloadId: "staged-gateway-123",
    });
    let observedRequest: { init?: RequestInit; url: string } | null = null;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        observedRequest = { init, url: String(url) };
        return createJsonResponse({
          event: {
            eventId: "gateway-123",
            lastError: null,
            state: "queued",
            userId: "user_123",
          },
          status: createUserStatus({ pendingEventCount: 1, userId: "user_123" }),
        });
      }) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
    });

    await expect(client.dispatchStoredPayload(payload)).resolves.toEqual({
      event: {
        eventId: "gateway-123",
        lastError: null,
        state: "queued",
        userId: "user_123",
      },
      status: createUserStatus({ pendingEventCount: 1, userId: "user_123" }),
    });

    expect(observedRequest?.url).toBe(
      "https://runner.example.test/root/internal/users/user_123/dispatch-payload/dispatch",
    );
    expect(observedRequest?.init?.method).toBe("POST");
    expect(JSON.parse(String(observedRequest?.init?.body))).toEqual(payload);
  });

  it("provisions managed user crypto with the expected route", async () => {
    let observedRequest: { init?: RequestInit; url: string } | null = null;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        observedRequest = { init, url: String(url) };
        return createJsonResponse({
          recipientKinds: ["automation", "recovery"],
          rootKeyId: "root-key-123",
          userId: "user_123",
        });
      }) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
    });

    await expect(client.provisionManagedUserCrypto("user_123")).resolves.toEqual({
      recipientKinds: ["automation", "recovery"],
      rootKeyId: "root-key-123",
      userId: "user_123",
    });

    expect(observedRequest?.url).toBe(
      "https://runner.example.test/root/internal/users/user_123/crypto-context",
    );
    expect(observedRequest?.init?.method).toBe("PUT");
    expect(observedRequest?.init?.body).toBeUndefined();
  });

  it("rejects blank bearer tokens before fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl,
      getBearerToken: async () => "   ",
    });

    await expect(client.getStatus("user_123")).rejects.toThrow(
      "Hosted execution bearer token must be configured.",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces parse failures for malformed status responses", async () => {
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test",
      fetchImpl: vi.fn(
        async () =>
          createJsonResponse({
            bundleRef: [],
            inFlight: false,
            lastError: null,
            lastEventId: null,
            lastRunAt: null,
            nextWakeAt: null,
            pendingEventCount: 0,
            poisonedEventIds: [],
            retryingEventId: null,
            userId: "user_123",
          }),
      ) as typeof fetch,
      getBearerToken: async () => "Bearer token-123",
    });

    await expect(client.getStatus("user_123")).rejects.toThrow(
      "Hosted execution user status bundleRef must be an object.",
    );
  });
});

function createJsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

function createUserStatus(
  overrides: Partial<{
    inFlight: boolean;
    pendingEventCount: number;
    userId: string;
  }> = {},
) {
  return {
    bundleRef: null,
    inFlight: overrides.inFlight ?? false,
    lastError: null,
    lastEventId: null,
    lastRunAt: null,
    nextWakeAt: null,
    pendingEventCount: overrides.pendingEventCount ?? 0,
    poisonedEventIds: [],
    retryingEventId: null,
    userId: overrides.userId ?? "user_123",
  };
}
