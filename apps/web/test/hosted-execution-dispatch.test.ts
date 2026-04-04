import { afterEach, beforeEach, describe as baseDescribe, expect, it, vi } from "vitest";

import {
  HOSTED_EXECUTION_DISPATCH_PATH,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  verifyHostedExecutionSignature,
} from "@murphai/hosted-execution";

import {
  dispatchHostedExecutionStatus,
  dispatchHostedExecutionBestEffort,
} from "@/src/lib/hosted-execution/dispatch";

const describe = baseDescribe.sequential;

describe("dispatchHostedExecutionBestEffort", () => {
  const originalDispatchUrl = process.env.HOSTED_EXECUTION_DISPATCH_URL;
  const originalSigningSecret = process.env.HOSTED_EXECUTION_SIGNING_SECRET;
  const originalDispatchTimeoutMs = process.env.HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.HOSTED_EXECUTION_DISPATCH_URL;
    delete process.env.HOSTED_EXECUTION_SIGNING_SECRET;
    delete process.env.HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS;
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

    if (typeof originalDispatchTimeoutMs === "string") {
      process.env.HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS = originalDispatchTimeoutMs;
    } else {
      delete process.env.HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS;
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
    global.fetch = vi.fn().mockResolvedValue(new Response("runner unavailable", { status: 503 }));
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
      "Hosted execution dispatch failed with HTTP 503: runner unavailable.",
    );
    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
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

  it("uses an explicit dispatch timeout override", async () => {
    process.env.HOSTED_EXECUTION_DISPATCH_URL = "https://runner.example.test";
    process.env.HOSTED_EXECUTION_SIGNING_SECRET = "secret";
    process.env.HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS = "45000";
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await dispatchHostedExecutionBestEffort({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "user-123",
      },
      eventId: "evt_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
    });

    expect(timeoutSpy).toHaveBeenCalledWith(45_000);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("ignores the removed Cloudflare compatibility aliases", async () => {
    process.env.HOSTED_EXECUTION_CLOUDFLARE_BASE_URL = "https://runner.example.test";
    process.env.HOSTED_EXECUTION_CLOUDFLARE_SIGNING_SECRET = "secret";
    process.env.HOSTED_EXECUTION_CLOUDFLARE_TIMEOUT_MS = "47000";

    await expect(
      dispatchHostedExecutionStatus({
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId: "user-123",
        },
        eventId: "evt_removed_aliases",
        occurredAt: "2026-03-20T12:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      status: {
        lastEventId: null,
        userId: "user-123",
      },
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("signs dispatches with a fresh envelope timestamp instead of business occurredAt", async () => {
    process.env.HOSTED_EXECUTION_DISPATCH_URL = "https://runner.example.test";
    process.env.HOSTED_EXECUTION_SIGNING_SECRET = "secret";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-27T09:15:00.000Z"));
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(buildDispatchResultFixture("evt_123")),
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
    await expect(
      verifyHostedExecutionSignature({
        method: "POST",
        path: HOSTED_EXECUTION_DISPATCH_PATH,
        payload,
        secret: "secret",
        signature: headers.get(HOSTED_EXECUTION_SIGNATURE_HEADER),
        timestamp,
        nowMs: Date.parse("2026-03-27T09:15:00.000Z"),
      }),
    ).resolves.toBe(true);
  });
});

function buildDispatchResultFixture(eventId: string) {
  return {
    event: {
      eventId,
      lastError: null,
      state: "completed",
      userId: "user-123",
    },
    status: {
      bundleRefs: {
        agentState: null,
        vault: null,
      },
      inFlight: false,
      lastError: null,
      lastEventId: eventId,
      lastRunAt: null,
      nextWakeAt: null,
      pendingEventCount: 0,
      poisonedEventIds: [],
      retryingEventId: null,
      userId: "user-123",
    },
  };
}
