import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
} from "@healthybob/runtime-state";

import {
  dispatchHostedExecutionStatus,
  dispatchHostedExecutionBestEffort,
} from "@/src/lib/hosted-execution/dispatch";

describe("dispatchHostedExecutionBestEffort", () => {
  const originalDispatchUrl = process.env.HOSTED_EXECUTION_DISPATCH_URL;
  const originalSigningSecret = process.env.HOSTED_EXECUTION_SIGNING_SECRET;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.HOSTED_EXECUTION_DISPATCH_URL;
    delete process.env.HOSTED_EXECUTION_SIGNING_SECRET;
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();

    if (typeof originalDispatchUrl === "string") {
      process.env.HOSTED_EXECUTION_DISPATCH_URL = originalDispatchUrl;
    } else {
      delete process.env.HOSTED_EXECUTION_DISPATCH_URL;
    }

    if (typeof originalSigningSecret === "string") {
      process.env.HOSTED_EXECUTION_SIGNING_SECRET = originalSigningSecret;
    } else {
      delete process.env.HOSTED_EXECUTION_SIGNING_SECRET;
    }

    global.fetch = originalFetch;
  });

  it("preserves the existing not-configured noop result", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      dispatchHostedExecutionBestEffort({
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "user-123",
        },
        eventId: "evt_123",
        occurredAt: "2026-03-26T12:00:00.000Z",
      }),
    ).resolves.toEqual({
      dispatched: false,
      reason: "not-configured",
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("swallows dispatch failures and logs the provided context", async () => {
    process.env.HOSTED_EXECUTION_DISPATCH_URL = "https://runner.example.test";
    process.env.HOSTED_EXECUTION_SIGNING_SECRET = "secret";
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      dispatchHostedExecutionBestEffort(
        {
          event: {
            kind: "assistant.cron.tick",
            reason: "manual",
            userId: "user-123",
          },
          eventId: "evt_123",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
        {
          context: "device-sync webhook-accepted user=user-123 provider=oura connection=dsc_123",
        },
      ),
    ).resolves.toEqual({
      dispatched: false,
      reason: "dispatch-failed",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted execution dispatch failed (device-sync webhook-accepted user=user-123 provider=oura connection=dsc_123).",
      "Hosted execution dispatch failed with HTTP 503.",
    );
    expect(timeoutSpy).toHaveBeenCalledWith(2_000);
  });

  it("swallows transport rejections and logs the provided context", async () => {
    process.env.HOSTED_EXECUTION_DISPATCH_URL = "https://runner.example.test";
    process.env.HOSTED_EXECUTION_SIGNING_SECRET = "secret";
    global.fetch = vi.fn().mockRejectedValue(new Error("socket hang up"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      dispatchHostedExecutionBestEffort(
        {
          event: {
            kind: "assistant.cron.tick",
            reason: "manual",
            userId: "user-123",
          },
          eventId: "evt_123",
          occurredAt: "2026-03-26T12:00:00.000Z",
        },
        {
          context: "device-sync disconnect user=user-123 provider=oura connection=dsc_123",
        },
      ),
    ).resolves.toEqual({
      dispatched: false,
      reason: "dispatch-failed",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted execution dispatch failed (device-sync disconnect user=user-123 provider=oura connection=dsc_123).",
      "socket hang up",
    );
  });

  it("signs dispatches with a fresh envelope timestamp instead of business occurredAt", async () => {
    process.env.HOSTED_EXECUTION_DISPATCH_URL = "https://runner.example.test";
    process.env.HOSTED_EXECUTION_SIGNING_SECRET = "secret";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-27T09:15:00.000Z"));
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          bundleRefs: {
            agentState: null,
            vault: null,
          },
          inFlight: false,
          lastError: null,
          lastEventId: "evt_123",
          lastRunAt: null,
          nextWakeAt: null,
          pendingEventCount: 0,
          poisonedEventIds: [],
          retryingEventId: null,
          userId: "user-123",
        }),
        { status: 200 },
      ),
    );

    await dispatchHostedExecutionStatus({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "user-123",
      },
      eventId: "evt_123",
      occurredAt: "2026-03-20T12:00:00.000Z",
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const fetchMock = global.fetch as unknown as {
      mock: { calls: Array<[RequestInfo | URL, RequestInit | undefined]> };
    };
    const [, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    const payload = typeof init?.body === "string" ? init.body : "";
    const timestamp = headers.get(HOSTED_EXECUTION_TIMESTAMP_HEADER);

    expect(timestamp).toBe("2026-03-27T09:15:00.000Z");
    expect(timestamp).not.toBe("2026-03-20T12:00:00.000Z");
    expect(headers.get(HOSTED_EXECUTION_SIGNATURE_HEADER)).toBe(
      createHmac("sha256", "secret")
        .update(`${timestamp}.${payload}`)
        .digest("hex"),
    );
  });
});
