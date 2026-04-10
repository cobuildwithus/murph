import { describe, expect, it, vi } from "vitest";
import {
  readBearerAuthorizationToken,
} from "../src/auth-adapter.js";

import {
  buildVersionOverrideHeaders,
  resolveSmokeWorkerBaseUrl,
  runSmokeHostedDeploy,
} from "../scripts/smoke-hosted-deploy.shared.js";

describe("resolveSmokeWorkerBaseUrl", () => {
  it("prefers the explicit smoke worker base URL over the other envs", () => {
    expect(
      resolveSmokeWorkerBaseUrl({
        HOSTED_EXECUTION_DISPATCH_URL: "https://legacy.example.test/",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://override.example.test/",
      }),
    ).toBe("https://override.example.test");
  });

  it("falls back to the dispatch URL when no smoke override is set", () => {
    expect(
      resolveSmokeWorkerBaseUrl({
        HOSTED_EXECUTION_DISPATCH_URL: " https://worker.example.test/ ",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "   ",
      }),
    ).toBe("https://worker.example.test");
  });

  it("falls back to the legacy dispatch URL when the preferred envs are absent", () => {
    expect(
      resolveSmokeWorkerBaseUrl({
        HOSTED_EXECUTION_DISPATCH_URL: "https://legacy.example.test/",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "   ",
      }),
    ).toBe("https://legacy.example.test");
  });

  it("keeps the configured-error text stable when no worker base URL env is set", () => {
    expect(() => resolveSmokeWorkerBaseUrl({})).toThrow(
      "HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL or HOSTED_EXECUTION_DISPATCH_URL must be configured.",
    );
  });
});

describe("buildVersionOverrideHeaders", () => {
  it("formats the Cloudflare version override header when the worker name and version id are present", () => {
    expect(buildVersionOverrideHeaders({
      CF_WORKER_NAME: "hosted-worker",
      HOSTED_EXECUTION_SMOKE_VERSION_ID: "version-123",
    })).toEqual({
      "Cloudflare-Workers-Version-Overrides": "hosted-worker=\"version-123\"",
    });
  });

  it("returns undefined when no candidate version id is configured", () => {
    expect(buildVersionOverrideHeaders({
      CF_WORKER_NAME: "hosted-worker",
    })).toBeUndefined();
  });

  it("fails fast when a version id is configured without a worker name", () => {
    expect(() => buildVersionOverrideHeaders({
      HOSTED_EXECUTION_SMOKE_VERSION_ID: "version-123",
    })).toThrow("HOSTED_EXECUTION_SMOKE_WORKER_NAME or CF_WORKER_NAME must be configured.");
  });

  it("falls back to CF_WORKER_NAME when the smoke worker name is blank", () => {
    expect(buildVersionOverrideHeaders({
      CF_WORKER_NAME: "hosted-worker",
      HOSTED_EXECUTION_SMOKE_VERSION_ID: "version-123",
      HOSTED_EXECUTION_SMOKE_WORKER_NAME: "   ",
    })).toEqual({
      "Cloudflare-Workers-Version-Overrides": "hosted-worker=\"version-123\"",
    });
  });
});

describe("runSmokeHostedDeploy", () => {
  it("pins the candidate-version header and waits for manual-run completion status", async () => {
    const fetchCalls: Array<{
      body: string | undefined;
      headers: HeadersInit | undefined;
      method: string | undefined;
      url: string;
    }> = [];
    let statusReadCount = 0;
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({
        body: typeof init?.body === "string" ? init.body : undefined,
        headers: init?.headers,
        method: init?.method,
        url: String(url),
      });

      if (String(url).endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (String(url).endsWith("/status")) {
        statusReadCount += 1;

        return new Response(JSON.stringify({
          bundleRef: statusReadCount >= 2
            ? {
                hash: "vault-hash",
                key: "bundles/vault",
                size: 7,
                updatedAt: "2026-03-27T01:00:00.000Z",
              }
            : null,
          inFlight: statusReadCount < 2,
          lastError: null,
          lastRunAt: statusReadCount >= 2 ? "2026-03-27T01:00:00.000Z" : "2026-03-27T00:59:00.000Z",
          pendingEventCount: statusReadCount < 2 ? 1 : 0,
          poisonedEventIds: [],
          retryingEventId: null,
          userId: "member_123",
        }), { status: 200 });
      }

      return new Response(null, { status: 204 });
    };

    await runSmokeHostedDeploy({
      fetchImpl,
      log() {},
      source: {
        CF_WORKER_NAME: "hosted-worker",
        HOSTED_EXECUTION_SMOKE_OIDC_TOKEN: "vercel-oidc-token",
        HOSTED_EXECUTION_SMOKE_STATUS_POLL_INTERVAL_MS: "1",
        HOSTED_EXECUTION_SMOKE_STATUS_TIMEOUT_MS: "100",
        HOSTED_EXECUTION_SMOKE_USER_ID: "member_123",
        HOSTED_EXECUTION_SMOKE_VERSION_ID: "version-123",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
      },
    });

    expect(fetchCalls).toEqual([
      {
        body: undefined,
        headers: {
          "Cloudflare-Workers-Version-Overrides": "hosted-worker=\"version-123\"",
        },
        method: undefined,
        url: "https://worker.example.test/health",
      },
      {
        body: undefined,
        headers: {
          "Cloudflare-Workers-Version-Overrides": "hosted-worker=\"version-123\"",
          authorization: "Bearer vercel-oidc-token",
        },
        method: "GET",
        url: "https://worker.example.test/internal/users/member_123/status",
      },
      {
        body: "{}",
        headers: {
          "Cloudflare-Workers-Version-Overrides": "hosted-worker=\"version-123\"",
          authorization: "Bearer vercel-oidc-token",
          "content-type": "application/json; charset=utf-8",
        },
        method: "POST",
        url: "https://worker.example.test/internal/users/member_123/run",
      },
      {
        body: undefined,
        headers: {
          "Cloudflare-Workers-Version-Overrides": "hosted-worker=\"version-123\"",
          authorization: "Bearer vercel-oidc-token",
        },
        method: "GET",
        url: "https://worker.example.test/internal/users/member_123/status",
      },
    ]);
  });

  it("omits the override header when no candidate version id is configured", async () => {
    const fetchCalls: Array<{ headers: HeadersInit | undefined; url: string }> = [];
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({
        headers: init?.headers,
        url: String(url),
      });

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await runSmokeHostedDeploy({
      fetchImpl,
      log() {},
      source: {
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
      },
    });

    expect(fetchCalls).toEqual([
      {
        headers: undefined,
        url: "https://worker.example.test/health",
      },
    ]);
  });

  it("fails when the manual smoke run does not finish before the timeout", async () => {
    const fetchImpl = async (url: RequestInfo | URL) => {
      if (String(url).endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (String(url).endsWith("/run")) {
        return new Response(null, { status: 204 });
      }

      return new Response(JSON.stringify({
        bundleRef: null,
        inFlight: false,
        lastError: "runner stalled",
        lastRunAt: null,
        pendingEventCount: 1,
        poisonedEventIds: [],
        retryingEventId: "evt_stalled",
        userId: "member_123",
      }), { status: 200 });
    };

    await expect(runSmokeHostedDeploy({
      fetchImpl,
      log() {},
      source: {
        HOSTED_EXECUTION_SMOKE_OIDC_TOKEN: "vercel-oidc-token",
        HOSTED_EXECUTION_SMOKE_STATUS_POLL_INTERVAL_MS: "1",
        HOSTED_EXECUTION_SMOKE_STATUS_TIMEOUT_MS: "5",
        HOSTED_EXECUTION_SMOKE_USER_ID: "member_123",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
      },
    })).rejects.toThrow(/Timed out waiting for manual smoke run completion/u);
  });

  it("rejects timeout values with trailing non-digit characters", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await expect(runSmokeHostedDeploy({
      fetchImpl,
      log() {},
      source: {
        HOSTED_EXECUTION_DISPATCH_URL: "https://worker.example.com",
        HOSTED_EXECUTION_SMOKE_OIDC_TOKEN: "token-123",
        HOSTED_EXECUTION_SMOKE_STATUS_TIMEOUT_MS: "10ms",
        HOSTED_EXECUTION_SMOKE_USER_ID: "member_test_123",
      },
    })).rejects.toThrow(
      "HOSTED_EXECUTION_SMOKE_STATUS_TIMEOUT_MS must be a positive integer.",
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not echo manual smoke control response bodies in thrown errors", async () => {
    const promise = runSmokeHostedDeploy({
      fetchImpl: async (url: RequestInfo | URL) => {
        if (String(url).endsWith("/health")) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }

        if (String(url).endsWith("/status")) {
          return new Response(JSON.stringify({
            bundleRef: null,
            inFlight: false,
            lastError: null,
            lastRunAt: null,
            pendingEventCount: 0,
            poisonedEventIds: [],
            retryingEventId: null,
            userId: "member_123",
          }), { status: 200 });
        }

        return new Response("runner token secret", { status: 500 });
      },
      log() {},
      source: {
        HOSTED_EXECUTION_SMOKE_OIDC_TOKEN: "vercel-oidc-token",
        HOSTED_EXECUTION_SMOKE_USER_ID: "member_123",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
      },
    });

    await expect(promise).rejects.toThrow("Manual smoke run failed with HTTP 500.");
    await expect(promise).rejects.not.toThrow(/runner token secret/u);
  });

  it("accepts either HOSTED_EXECUTION_SMOKE_OIDC_TOKEN or VERCEL_OIDC_TOKEN for manual smoke control requests", async () => {
    const fetchCalls: Array<{
      headers: HeadersInit | undefined;
      method: string | undefined;
      url: string;
    }> = [];
    let statusReadCount = 0;
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({
        headers: init?.headers,
        method: init?.method,
        url: String(url),
      });

      if (String(url).endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (String(url).endsWith("/status")) {
        statusReadCount += 1;

        return new Response(JSON.stringify({
          bundleRef: statusReadCount >= 2 ? {
            hash: "vault-hash",
            key: "bundles/vault",
            size: 7,
            updatedAt: "2026-03-27T01:00:00.000Z",
          } : null,
          inFlight: statusReadCount < 2,
          lastError: null,
          lastRunAt: statusReadCount >= 2 ? "2026-03-27T01:00:00.000Z" : "2026-03-27T00:59:00.000Z",
          pendingEventCount: statusReadCount < 2 ? 1 : 0,
          poisonedEventIds: [],
          retryingEventId: null,
          userId: "member_123",
        }), { status: 200 });
      }

      return new Response(null, { status: 204 });
    };

    await runSmokeHostedDeploy({
      fetchImpl,
      log() {},
      source: {
        HOSTED_EXECUTION_SMOKE_STATUS_POLL_INTERVAL_MS: "1",
        HOSTED_EXECUTION_SMOKE_STATUS_TIMEOUT_MS: "100",
        HOSTED_EXECUTION_SMOKE_USER_ID: "member_123",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
        VERCEL_OIDC_TOKEN: "vercel-oidc-token",
      },
    });

    const statusCall = fetchCalls.find((entry) => entry.url.endsWith("/internal/users/member_123/status"));
    expect(statusCall).toBeDefined();
    const headers = new Headers(statusCall?.headers);
    expect(readBearerAuthorizationToken(headers.get("authorization"))).toBe("vercel-oidc-token");
  });

  it("fails before issuing requests when a candidate version id is configured without a worker name", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });

    await expect(runSmokeHostedDeploy({
      fetchImpl,
      log() {},
      source: {
        HOSTED_EXECUTION_SMOKE_VERSION_ID: "version-123",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
      },
    })).rejects.toThrow("HOSTED_EXECUTION_SMOKE_WORKER_NAME or CF_WORKER_NAME must be configured.");
  });

  it("fails with the OIDC-token error when manual smoke auth is unconfigured", async () => {
    await expect(runSmokeHostedDeploy({
      fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      log() {},
      source: {
        HOSTED_EXECUTION_SMOKE_USER_ID: "member_123",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
      },
    })).rejects.toThrow(
      "HOSTED_EXECUTION_SMOKE_OIDC_TOKEN or VERCEL_OIDC_TOKEN is required when HOSTED_EXECUTION_SMOKE_USER_ID is set.",
    );
  });
});
