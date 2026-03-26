import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
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
});
