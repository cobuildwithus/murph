import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildHostedExecutionUserEnvPath,
  buildHostedExecutionUserRunPath,
  buildHostedExecutionUserStatusPath,
  createHostedExecutionControlClient,
  createHostedExecutionDispatchClient,
  createHostedExecutionSignature,
  createHostedExecutionSignatureHeaders,
  HOSTED_EXECUTION_DISPATCH_PATH,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  readHostedExecutionDispatchEnvironment,
  readHostedExecutionSignatureHeaders,
  readHostedExecutionWorkerEnvironment,
  verifyHostedExecutionSignature,
} from "@healthybob/hosted-execution";

describe("@healthybob/hosted-execution", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("creates and verifies matching HMAC signatures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00.000Z"));

    const signature = await createHostedExecutionSignature({
      payload: "{\"ok\":true}",
      secret: "top-secret",
      timestamp: "2026-03-26T12:00:00.000Z",
    });

    await expect(
      verifyHostedExecutionSignature({
        payload: "{\"ok\":true}",
        secret: "top-secret",
        signature,
        timestamp: "2026-03-26T12:00:00.000Z",
      }),
    ).resolves.toBe(true);
  });

  it("reads and normalizes hosted execution signature headers", async () => {
    const headerValues = await createHostedExecutionSignatureHeaders({
      payload: "{\"ok\":true}",
      secret: "top-secret",
      timestamp: "2026-03-26T12:00:00.000Z",
    });
    const headers = new Headers(headerValues);
    const { signature, timestamp } = readHostedExecutionSignatureHeaders(headers);

    expect(timestamp).toBe("2026-03-26T12:00:00.000Z");
    await expect(
      verifyHostedExecutionSignature({
        payload: "{\"ok\":true}",
        secret: "top-secret",
        signature: `sha256=${String(signature).toUpperCase()}`,
        timestamp,
        nowMs: Date.parse("2026-03-26T12:00:00.000Z"),
      }),
    ).resolves.toBe(true);
  });

  it("rejects malformed signature hex", async () => {
    await expect(
      verifyHostedExecutionSignature({
        payload: "{\"ok\":true}",
        secret: "top-secret",
        signature: "sha256=not-hex",
        timestamp: "2026-03-26T12:00:00.000Z",
        nowMs: Date.parse("2026-03-26T12:00:00.000Z"),
      }),
    ).resolves.toBe(false);
  });

  it("rejects stale timestamps even when the signature matches", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:05:01.000Z"));
    const timestamp = "2026-03-26T12:00:00.000Z";

    const signature = await createHostedExecutionSignature({
      payload: "{\"ok\":true}",
      secret: "top-secret",
      timestamp,
    });

    await expect(
      verifyHostedExecutionSignature({
        payload: "{\"ok\":true}",
        secret: "top-secret",
        signature,
        timestamp,
      }),
    ).resolves.toBe(false);
  });

  it("prefers current hosted dispatch env names but falls back to legacy aliases", () => {
    expect(
      readHostedExecutionDispatchEnvironment({
        HOSTED_EXECUTION_CLOUDFLARE_BASE_URL: "https://runner.example.test/",
        HOSTED_EXECUTION_CLOUDFLARE_SIGNING_SECRET: "secret",
        HOSTED_EXECUTION_CLOUDFLARE_TIMEOUT_MS: "45000",
        HOSTED_EXECUTION_DISPATCH_URL: "https://legacy.example.test/",
        HOSTED_EXECUTION_SIGNING_SECRET: "legacy-secret",
        HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS: "15000",
      }),
    ).toEqual({
      dispatchTimeoutMs: 45_000,
      dispatchUrl: "https://runner.example.test",
      signingSecret: "secret",
    });

    expect(
      readHostedExecutionDispatchEnvironment({
        HOSTED_EXECUTION_CLOUDFLARE_BASE_URL: "   ",
        HOSTED_EXECUTION_CLOUDFLARE_SIGNING_SECRET: "   ",
        HOSTED_EXECUTION_CLOUDFLARE_TIMEOUT_MS: "   ",
        HOSTED_EXECUTION_DISPATCH_URL: "https://legacy.example.test/",
        HOSTED_EXECUTION_SIGNING_SECRET: "legacy-secret",
        HOSTED_EXECUTION_DISPATCH_TIMEOUT_MS: "45000",
      }),
    ).toEqual({
      dispatchTimeoutMs: 45_000,
      dispatchUrl: "https://legacy.example.test",
      signingSecret: "legacy-secret",
    });
  });

  it("reads hosted worker env defaults and legacy signing-secret alias", () => {
    expect(
      readHostedExecutionWorkerEnvironment({
        HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS: "OPENAI_API_KEY",
        HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: "Zm9v",
        HOSTED_EXECUTION_CLOUDFLARE_SIGNING_SECRET: "dispatch-secret",
      }),
    ).toEqual({
      allowedUserEnvKeys: "OPENAI_API_KEY",
      allowedUserEnvPrefixes: null,
      bundleEncryptionKeyBase64: "Zm9v",
      bundleEncryptionKeyId: "v1",
      controlToken: null,
      defaultAlarmDelayMs: 15 * 60 * 1000,
      dispatchSigningSecret: "dispatch-secret",
      maxEventAttempts: 3,
      retryDelayMs: 30_000,
      runnerControlToken: null,
      runnerTimeoutMs: 60_000,
    });
  });

  it("falls back to the legacy worker signing-secret alias when the preferred value is blank", () => {
    expect(
      readHostedExecutionWorkerEnvironment({
        HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY: "Zm9v",
        HOSTED_EXECUTION_CLOUDFLARE_SIGNING_SECRET: "dispatch-secret",
        HOSTED_EXECUTION_SIGNING_SECRET: "   ",
      }).dispatchSigningSecret,
    ).toBe("dispatch-secret");
  });

  it("builds stable encoded user control paths", () => {
    expect(buildHostedExecutionUserStatusPath("member/123")).toBe("/internal/users/member%2F123/status");
    expect(buildHostedExecutionUserRunPath("member/123")).toBe("/internal/users/member%2F123/run");
    expect(buildHostedExecutionUserEnvPath("member/123")).toBe("/internal/users/member%2F123/env");
  });

  it("dispatch client signs payloads and posts to the shared dispatch route", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-27T09:15:00.000Z"));
    const fetchImpl = vi.fn().mockResolvedValue(
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
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const client = createHostedExecutionDispatchClient({
      baseUrl: "https://runner.example.test/",
      fetchImpl,
      signingSecret: "secret",
      timeoutMs: 45_000,
    });

    await client.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "user-123",
      },
      eventId: "evt_123",
      occurredAt: "2026-03-20T12:00:00.000Z",
    });

    expect(timeoutSpy).toHaveBeenCalledWith(45_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);
    const payload = typeof init?.body === "string" ? init.body : "";

    expect(url).toBe(`https://runner.example.test${HOSTED_EXECUTION_DISPATCH_PATH}`);
    expect(headers.get(HOSTED_EXECUTION_TIMESTAMP_HEADER)).toBe("2026-03-27T09:15:00.000Z");
    await expect(
      verifyHostedExecutionSignature({
        payload,
        secret: "secret",
        signature: headers.get(HOSTED_EXECUTION_SIGNATURE_HEADER),
        timestamp: headers.get(HOSTED_EXECUTION_TIMESTAMP_HEADER),
        nowMs: Date.parse("2026-03-27T09:15:00.000Z"),
      }),
    ).resolves.toBe(true);
  });

  it("requires a configured baseUrl for shared clients", () => {
    expect(() =>
      createHostedExecutionDispatchClient({
        baseUrl: "   ",
        signingSecret: "secret",
      }),
    ).toThrow("Hosted execution baseUrl must be configured.");
    expect(() =>
      createHostedExecutionControlClient({
        baseUrl: "   ",
      }),
    ).toThrow("Hosted execution baseUrl must be configured.");
  });

  it("dispatch client omits the timeout signal when no override is configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
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
    const client = createHostedExecutionDispatchClient({
      baseUrl: "https://runner.example.test/",
      fetchImpl,
      signingSecret: "secret",
    });

    await client.dispatch({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "user-123",
      },
      eventId: "evt_123",
      occurredAt: "2026-03-20T12:00:00.000Z",
    });

    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBeUndefined();
  });

  it("control client uses bearer auth and shared control routes", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          configuredUserEnvKeys: ["OPENAI_API_KEY"],
          userId: "member/123",
        }),
        { status: 200 },
      ),
    );
    const client = createHostedExecutionControlClient({
      baseUrl: "https://worker.example.test/",
      controlToken: "control-token",
      fetchImpl,
    });

    await expect(
      client.updateUserEnv("member/123", {
        env: {
          OPENAI_API_KEY: "secret",
        },
        mode: "merge",
      }),
    ).resolves.toEqual({
      configuredUserEnvKeys: ["OPENAI_API_KEY"],
      userId: "member/123",
    });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://worker.example.test/internal/users/member%2F123/env");
    expect(init?.method).toBe("PUT");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer control-token");
    expect(init?.body).toBe(JSON.stringify({
      env: {
        OPENAI_API_KEY: "secret",
      },
      mode: "merge",
    }));
  });

  it("control client omits bearer auth when no control token is configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
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
    const client = createHostedExecutionControlClient({
      baseUrl: "https://worker.example.test/",
      fetchImpl,
    });

    await client.getStatus("user-123");

    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("authorization")).toBeNull();
  });

  it("control client uses the remaining shared control routes", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(
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
            userId: "member/123",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            configuredUserEnvKeys: ["OPENAI_API_KEY"],
            userId: "member/123",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            configuredUserEnvKeys: [],
            userId: "member/123",
          }),
          { status: 200 },
        ),
      );
    const client = createHostedExecutionControlClient({
      baseUrl: "https://worker.example.test/",
      controlToken: "control-token",
      fetchImpl,
    });

    await expect(client.run("member/123")).resolves.toMatchObject({
      lastEventId: "evt_123",
      userId: "member/123",
    });
    await expect(client.getUserEnvStatus("member/123")).resolves.toEqual({
      configuredUserEnvKeys: ["OPENAI_API_KEY"],
      userId: "member/123",
    });
    await expect(client.clearUserEnv("member/123")).resolves.toEqual({
      configuredUserEnvKeys: [],
      userId: "member/123",
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://worker.example.test/internal/users/member%2F123/run",
      expect.objectContaining({
        body: "{}",
        method: "POST",
      }),
    );
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer control-token",
    );
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://worker.example.test/internal/users/member%2F123/env",
      expect.objectContaining({
        method: "GET",
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      "https://worker.example.test/internal/users/member%2F123/env",
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });

  it("includes HTTP error text for non-ok shared control responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("runner unavailable", { status: 503 }));
    const client = createHostedExecutionControlClient({
      baseUrl: "https://worker.example.test/",
      fetchImpl,
    });

    await expect(client.getStatus("user-123")).rejects.toThrow(
      "Hosted execution status failed with HTTP 503: runner unavailable.",
    );
  });

  it.each(["", "   \n"])("rejects blank success JSON bodies", async (body) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    const client = createHostedExecutionControlClient({
      baseUrl: "https://worker.example.test/",
      fetchImpl,
    });

    await expect(client.getStatus("user-123")).rejects.toThrow(
      "Hosted execution status returned a non-object JSON payload.",
    );
  });

  it("rejects malformed success JSON bodies", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{", { status: 200 }));
    const client = createHostedExecutionControlClient({
      baseUrl: "https://worker.example.test/",
      fetchImpl,
    });

    await expect(client.getStatus("user-123")).rejects.toThrow(
      "Hosted execution status returned a non-object JSON payload.",
    );
  });

  it("rejects array JSON payloads for typed shared control responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    const client = createHostedExecutionControlClient({
      baseUrl: "https://worker.example.test/",
      fetchImpl,
    });

    await expect(client.getStatus("user-123")).rejects.toThrow(
      "Hosted execution status returned a non-object JSON payload.",
    );
  });
});
