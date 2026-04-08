import { afterEach, beforeEach, describe as baseDescribe, expect, it, vi } from "vitest";

import {
  HOSTED_EXECUTION_DISPATCH_PATH,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  createHostedExecutionVercelOidcBearerTokenProvider: vi.fn(),
  tokenProvider: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/auth-adapter", () => ({
  createHostedExecutionVercelOidcBearerTokenProvider:
    mocks.createHostedExecutionVercelOidcBearerTokenProvider,
}));

const describe = baseDescribe.sequential;

describe("dispatchHostedExecutionBestEffort", () => {
  const originalDispatchUrl = process.env.HOSTED_EXECUTION_DISPATCH_URL;
  const originalDispatchTimeoutMs = process.env.HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    delete process.env.HOSTED_EXECUTION_DISPATCH_URL;
    delete process.env.HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS;
    global.fetch = vi.fn();
    mocks.createHostedExecutionVercelOidcBearerTokenProvider.mockReturnValue(mocks.tokenProvider);
    mocks.tokenProvider.mockResolvedValue("vercel-oidc-token");
  });

  afterEach(() => {
    vi.useRealTimers();

    if (typeof originalDispatchUrl === "string") {
      process.env.HOSTED_EXECUTION_DISPATCH_URL = originalDispatchUrl;
    } else {
      delete process.env.HOSTED_EXECUTION_DISPATCH_URL;
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

    const { dispatchHostedExecutionBestEffort } = await import(
      "@/src/lib/hosted-execution/dispatch"
    );

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
    global.fetch = vi.fn().mockResolvedValue(new Response("runner unavailable", { status: 503 }));
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { dispatchHostedExecutionBestEffort } = await import(
      "@/src/lib/hosted-execution/dispatch"
    );

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
    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
  });

  it("swallows transport rejections and logs the provided context", async () => {
    process.env.HOSTED_EXECUTION_DISPATCH_URL = "https://runner.example.test";
    global.fetch = vi.fn().mockRejectedValue(new Error("socket hang up"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { dispatchHostedExecutionBestEffort } = await import(
      "@/src/lib/hosted-execution/dispatch"
    );

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
    process.env.HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS = "45000";
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { dispatchHostedExecutionBestEffort } = await import(
      "@/src/lib/hosted-execution/dispatch"
    );

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

    const { dispatchHostedExecutionStatus } = await import(
      "@/src/lib/hosted-execution/dispatch"
    );

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

  it("sends bearer auth on dispatch requests", async () => {
    process.env.HOSTED_EXECUTION_DISPATCH_URL = "https://runner.example.test";
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify(buildDispatchResultFixture("evt_123")),
        { status: 200 },
      ),
    );

    const { dispatchHostedExecutionStatus } = await import(
      "@/src/lib/hosted-execution/dispatch"
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
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);

    expect(url).toBe(`https://runner.example.test${HOSTED_EXECUTION_DISPATCH_PATH}`);
    expect(headers.get("authorization")).toBe("Bearer vercel-oidc-token");
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
      bundleRef: null,
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
