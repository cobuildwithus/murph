import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

import {
  proxyLocalLoopbackRequest,
  readLocalLoopbackProxyBaseUrl,
} from "../src/local-loopback-proxy.ts";

describe("proxyLocalLoopbackRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("redacts token-bearing local proxy path segments from structured logs", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock as typeof fetch);

    await expect(proxyLocalLoopbackRequest({
      completedMessage: "completed",
      component: "worker",
      failedMessage: "failed",
      phase: "wake.running",
      request: new Request("https://runner.example.test/proxy", {
        method: "GET",
      }),
      startMessage: "started",
      upstreamUrl: new URL(
        "http://127.0.0.1:8788/__murph/local-internal-proxy/secret-token/results.worker/effects/outbox_123",
      ),
    })).resolves.toBeInstanceOf(Response);

    const startLog = mocks.emitHostedExecutionStructuredLog.mock.calls.find(([entry]) =>
      entry.message === "started"
    )?.[0];
    expect(startLog?.details).toMatchObject({
      upstreamOrigin: "http://127.0.0.1:8788",
      upstreamPathname:
        "/__murph/local-internal-proxy/<redacted>/results.worker/effects/outbox_123",
    });
    expect(String(startLog?.details?.upstreamPathname)).not.toContain("secret-token");
  });

  it("accepts IPv6 loopback proxy base URLs", () => {
    expect(readLocalLoopbackProxyBaseUrl("http://[::1]:8788")).toEqual(
      new URL("http://[::1]:8788/"),
    );
  });
});
