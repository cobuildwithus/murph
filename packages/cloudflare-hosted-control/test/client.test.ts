import { describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionOutboxPayload,
  type HostedExecutionOutboxPayload,
} from "@murphai/hosted-execution";

import { createCloudflareHostedControlClient } from "../src/client.ts";

describe("createCloudflareHostedControlClient", () => {
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

  it("preserves 204 handling for deleteStoredDispatchPayload", async () => {
    let observedRequest: { init?: RequestInit; url: string } | null = null;
    const client = createCloudflareHostedControlClient({
      baseUrl: "https://runner.example.test/root/",
      fetchImpl: vi.fn(async (url, init) => {
        observedRequest = { init, url: String(url) };
        return new Response(null, { status: 204 });
      }) as typeof fetch,
      getBearerToken: async () => "token-123",
    });

    await expect(client.deleteStoredDispatchPayload(createInlinePayload())).resolves.toBeUndefined();
    expect(observedRequest?.url).toBe(
      "https://runner.example.test/root/internal/users/user_123/dispatch-payload",
    );
    expect(observedRequest?.init?.method).toBe("DELETE");
    expect(new Headers(observedRequest?.init?.headers).get("authorization")).toBe(
      "Bearer token-123",
    );
  });
});

function createInlinePayload(): HostedExecutionOutboxPayload {
  return buildHostedExecutionOutboxPayload({
    event: {
      kind: "assistant.cron.tick",
      reason: "manual",
      userId: "user_123",
    },
    eventId: "evt_123",
    occurredAt: "2026-04-08T00:00:00.000Z",
  });
}
