import { describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionGatewayMessageSendDispatch,
  buildHostedExecutionMemberActivatedDispatch,
  buildHostedExecutionOutboxPayload,
  parseHostedExecutionDispatchRequest,
} from "@murphai/hosted-execution";

import { createCloudflareHostedControlClient } from "../src/client.ts";

describe("createCloudflareHostedControlClient", () => {
  it("rejects an unconfigured base URL before issuing a request", () => {
    expect(() =>
      createCloudflareHostedControlClient({
        baseUrl: "   ",
        getBearerToken: async () => "token-123",
      }),
    ).toThrow("Hosted execution baseUrl must be configured.");
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
});

function createJsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}
