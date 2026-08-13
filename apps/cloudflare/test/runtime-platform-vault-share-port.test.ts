import {
  HOSTED_VAULT_SHARE_DELIVERY_EFFECT_TIMEOUT_MS,
  HOSTED_VAULT_SHARE_DELIVERY_TRANSPORT_MARGIN_MS,
  HOSTED_VAULT_SHARE_EFFECT_DEADLINE_HEADER,
  HOSTED_VAULT_SHARE_SCOPE_FAILED_ERROR_CODE,
  hostedVaultShareProjectionKindToScope,
} from "@murphai/hosted-execution/vault-share";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchHostedExecutionWebControlPlaneResponse: vi.fn(),
}));

vi.mock("../src/web-control-plane.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/web-control-plane.ts")>(
    "../src/web-control-plane.ts",
  );
  return {
    ...actual,
    fetchHostedExecutionWebControlPlaneResponse:
      mocks.fetchHostedExecutionWebControlPlaneResponse,
  };
});

import { readHostedExecutionEnvironment } from "../src/env.ts";
import {
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_WEB_CONTROL_FORWARDED_RESPONSE_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
} from "../src/runner-outbound/headers.ts";
import type { RunnerOutboundEnvironmentSource } from "../src/runner-outbound/shared.ts";
import { handleRunnerWebControlRequest } from "../src/runner-outbound/web-control.ts";
import { handleRunnerOutboundRequest } from "../src/runner-outbound.ts";
import { createHostedWebVaultSharePort } from "../src/runtime-platform/vault-share-port.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

const GENERATION_TOKEN = "a".repeat(43);

beforeEach(() => {
  mocks.fetchHostedExecutionWebControlPlaneResponse.mockReset();
});

describe("createHostedWebVaultSharePort", () => {
  it("aborts an active projection-scope read and preserves the foreground wake reason", async () => {
    const scopeReadController = new AbortController();
    const wakeReason = new Error("Foreground runtime wake interrupted projection scope read.");
    let markFetchStarted: (() => void) | null = null;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      expect(signal).toBeTruthy();
      markFetchStarted?.();
      return await new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(signal?.reason);
        if (signal?.aborted) {
          abort();
          return;
        }
        signal?.addEventListener("abort", abort, { once: true });
      });
    });
    const vaultSharePort = createHostedWebVaultSharePort({
      boundUserId: "member_projection_abort",
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 30_000,
      transport: { mode: "proxy" },
    });

    const scopeReadResult = vaultSharePort.listActiveProjectionScopes({
      signal: scopeReadController.signal,
    });
    await fetchStarted;
    scopeReadController.abort(wakeReason);

    await expect(scopeReadResult).rejects.toBe(wakeReason);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps proxy delivery pending until the forwarded Web request is terminal", async () => {
    let releaseWebRequest: (response: Response) => void = () => {
      throw new Error("Forwarded Web request did not start.");
    };
    const webRequestStarted = new Promise<void>((resolve) => {
      mocks.fetchHostedExecutionWebControlPlaneResponse.mockImplementation(
        () => new Promise<Response>((release) => {
          releaseWebRequest = release;
          resolve();
        }),
      );
    });
    const environment = readHostedExecutionEnvironment(
      createHostedExecutionTestEnv({
        HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS: "2000",
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
    );
    const env: RunnerOutboundEnvironmentSource = {
      BUNDLES: {} as RunnerOutboundEnvironmentSource["BUNDLES"],
      USER_RUNNER: {
        getByName: () => ({
          validateRuntimeWriteFence: async () => true,
        }),
      },
    };
    const fetchImpl = vi.fn(async (requestInfo: RequestInfo | URL, init?: RequestInit) => {
      const url = requestInfo instanceof Request
        ? new URL(requestInfo.url)
        : new URL(requestInfo.toString());
      const headers = new Headers(init?.headers);
      headers.set(HOSTED_RUNTIME_ATTEMPT_ID_HEADER, "attempt_projection_proxy");
      headers.set(HOSTED_RUNTIME_LEASE_GENERATION_HEADER, "9");
      headers.set(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER, "7");
      return await handleRunnerWebControlRequest({
        env,
        environment,
        request: new Request(url, {
          ...init,
          headers,
        }),
        url,
        userId: "member_projection_proxy",
      });
    });
    const vaultSharePort = createHostedWebVaultSharePort({
      boundUserId: "member_projection_proxy",
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 1_000,
      transport: { mode: "proxy" },
    });

    let deliverySettled = false;
    const delivery = vaultSharePort.deliver({
      expectedGenerationToken: GENERATION_TOKEN,
      projectionKind: "profile-name.v0",
      projectionScope: hostedVaultShareProjectionKindToScope("profile-name.v0"),
      records: [],
      sourceWorkspaceVersion: "7",
    });
    void delivery.then(
      () => {
        deliverySettled = true;
      },
      () => {
        deliverySettled = true;
      },
    );

    await webRequestStarted;
    await Promise.resolve();
    expect(deliverySettled).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(mocks.fetchHostedExecutionWebControlPlaneResponse).toHaveBeenCalledTimes(1);
    const forwardedRequest = mocks.fetchHostedExecutionWebControlPlaneResponse
      .mock.calls[0]?.[0];
    const proxyRequestHeaders = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    const effectDeadlineHeader = proxyRequestHeaders.get(
      HOSTED_VAULT_SHARE_EFFECT_DEADLINE_HEADER,
    );
    expect(forwardedRequest?.timeoutMs).toBeGreaterThanOrEqual(
      HOSTED_VAULT_SHARE_DELIVERY_EFFECT_TIMEOUT_MS,
    );
    expect(forwardedRequest?.timeoutMs).toBeLessThanOrEqual(
      HOSTED_VAULT_SHARE_DELIVERY_EFFECT_TIMEOUT_MS
        + HOSTED_VAULT_SHARE_DELIVERY_TRANSPORT_MARGIN_MS,
    );
    expect(
      forwardedRequest?.headers?.get(HOSTED_VAULT_SHARE_EFFECT_DEADLINE_HEADER),
    ).toBe(effectDeadlineHeader);
    expect(effectDeadlineHeader).toMatch(/^\d{13}$/u);

    releaseWebRequest(Response.json({ status: "delivered" }));
    await expect(delivery).resolves.toEqual({ status: "delivered" });
    expect(deliverySettled).toBe(true);
  });

  it("classifies a marked terminal Web failure so later scopes can proceed", async () => {
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(
      Response.json({
        error: {
          code: HOSTED_VAULT_SHARE_SCOPE_FAILED_ERROR_CODE,
          message: "Hosted vault-share delivery failed. Retry the request.",
          retryable: true,
        },
      }, { status: 503 }),
    );
    const environment = readHostedExecutionEnvironment(
      createHostedExecutionTestEnv({
        HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS: "2000",
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      }),
    );
    const env: RunnerOutboundEnvironmentSource = {
      BUNDLES: {} as RunnerOutboundEnvironmentSource["BUNDLES"],
      USER_RUNNER: {
        getByName: () => ({
          validateRuntimeWriteFence: async () => true,
        }),
      },
    };
    const fetchImpl = vi.fn(async (requestInfo: RequestInfo | URL, init?: RequestInit) => {
      const url = requestInfo instanceof Request
        ? new URL(requestInfo.url)
        : new URL(requestInfo.toString());
      const headers = new Headers(init?.headers);
      headers.set(HOSTED_RUNTIME_ATTEMPT_ID_HEADER, "attempt_projection_web_failure");
      headers.set(HOSTED_RUNTIME_LEASE_GENERATION_HEADER, "9");
      headers.set(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER, "7");
      return await handleRunnerWebControlRequest({
        env,
        environment,
        request: new Request(url, { ...init, headers }),
        url,
        userId: "member_projection_web_failure",
      });
    });
    const vaultSharePort = createHostedWebVaultSharePort({
      boundUserId: "member_projection_web_failure",
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 2_000,
      transport: { mode: "proxy" },
    });

    await expect(vaultSharePort.deliver({
      expectedGenerationToken: GENERATION_TOKEN,
      projectionKind: "profile-name.v0",
      projectionScope: hostedVaultShareProjectionKindToScope("profile-name.v0"),
      records: [],
      sourceWorkspaceVersion: "7",
    })).resolves.toEqual({ status: "scope-failed" });
  });

  it("does not advance past a marked failure after the effect deadline", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-08-12T12:00:00.000Z"));
      const fetchImpl = vi.fn(async () => {
        vi.setSystemTime(Date.now() + HOSTED_VAULT_SHARE_DELIVERY_EFFECT_TIMEOUT_MS);
        return Response.json({
          error: {
            code: "HOSTED_VAULT_SHARE_DELIVERY_FAILED",
            message: "Hosted vault-share delivery failed. Retry the request.",
            retryable: true,
          },
        }, {
          headers: {
            [HOSTED_WEB_CONTROL_FORWARDED_RESPONSE_HEADER]: "1",
          },
          status: 503,
        });
      });
      const vaultSharePort = createHostedWebVaultSharePort({
        boundUserId: "member_projection_expired_web_failure",
        fetchImpl: fetchImpl as typeof fetch,
        timeoutMs: 2_000,
        transport: { mode: "proxy" },
      });

      await expect(vaultSharePort.deliver({
        expectedGenerationToken: GENERATION_TOKEN,
        projectionKind: "profile-name.v0",
        projectionScope: hostedVaultShareProjectionKindToScope("profile-name.v0"),
        records: [],
        sourceWorkspaceVersion: "7",
      })).rejects.toMatchObject({
        code: "HOSTED_VAULT_SHARE_DELIVERY_FAILED",
        forwardedFromWeb: true,
        status: 503,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains ownership when the production proxy propagates second-hop transport failure", async () => {
    vi.useFakeTimers();
    try {
      const secondHopStarted = vi.fn();
      mocks.fetchHostedExecutionWebControlPlaneResponse.mockImplementation(
        () => new Promise<Response>((_resolve, reject) => {
          secondHopStarted();
          setTimeout(() => {
            reject(new Error("synthetic admitted Web transport loss"));
          }, 5_000);
        }),
      );
      const env = {
        ...createHostedExecutionTestEnv({
          HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS: "2000",
          HOSTED_WEB_BASE_URL: "https://web.example.test",
        }),
        BUNDLES: {} as RunnerOutboundEnvironmentSource["BUNDLES"],
        USER_RUNNER: {
          getByName: () => ({
            validateRuntimeWriteFence: async () => true,
          }),
        },
      } as RunnerOutboundEnvironmentSource;
      const fetchImpl = vi.fn(async (
        requestInfo: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        const request = requestInfo instanceof Request
          ? requestInfo
          : new Request(requestInfo, init);
        const headers = new Headers(request.headers);
        headers.set(HOSTED_RUNTIME_ATTEMPT_ID_HEADER, "attempt_projection_proxy_500");
        headers.set(HOSTED_RUNTIME_LEASE_GENERATION_HEADER, "9");
        headers.set(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER, "7");
        return await handleRunnerOutboundRequest(
          new Request(request, { headers }),
          env,
          "member_projection_proxy_500",
        );
      });
      const vaultSharePort = createHostedWebVaultSharePort({
        boundUserId: "member_projection_proxy_500",
        fetchImpl: fetchImpl as typeof fetch,
        timeoutMs: 2_000,
        transport: { mode: "proxy" },
      });
      let deliverySettled = false;

      const delivery = vaultSharePort.deliver({
        expectedGenerationToken: GENERATION_TOKEN,
        projectionKind: "profile-name.v0",
        projectionScope: hostedVaultShareProjectionKindToScope("profile-name.v0"),
        records: [],
        sourceWorkspaceVersion: "7",
      });
      void delivery.then(
        () => {
          deliverySettled = true;
        },
        () => {
          deliverySettled = true;
        },
      );

      await vi.advanceTimersByTimeAsync(5_000);
      expect(secondHopStarted).toHaveBeenCalledTimes(1);
      expect(deliverySettled).toBe(false);
      await vi.advanceTimersByTimeAsync(
        HOSTED_VAULT_SHARE_DELIVERY_EFFECT_TIMEOUT_MS
          + HOSTED_VAULT_SHARE_DELIVERY_TRANSPORT_MARGIN_MS
          - 5_001,
      );
      expect(deliverySettled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      await expect(delivery).rejects.toThrow(
        "Hosted vault share delivery request failed.",
      );
      expect(deliverySettled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains ownership for an unmarked proxy-local HTTP 500", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => {
        setTimeout(() => {
          resolve(Response.json({ error: "synthetic proxy-local failure" }, {
            status: 500,
          }));
        }, 5_000);
      }));
      const vaultSharePort = createHostedWebVaultSharePort({
        boundUserId: "member_projection_proxy_local_500",
        fetchImpl: fetchImpl as typeof fetch,
        timeoutMs: 2_000,
        transport: { mode: "proxy" },
      });
      let deliverySettled = false;

      const delivery = vaultSharePort.deliver({
        expectedGenerationToken: GENERATION_TOKEN,
        projectionKind: "profile-name.v0",
        projectionScope: hostedVaultShareProjectionKindToScope("profile-name.v0"),
        records: [],
        sourceWorkspaceVersion: "7",
      });
      void delivery.then(
        () => {
          deliverySettled = true;
        },
        () => {
          deliverySettled = true;
        },
      );

      await vi.advanceTimersByTimeAsync(5_000);
      expect(deliverySettled).toBe(false);
      await vi.advanceTimersByTimeAsync(
        HOSTED_VAULT_SHARE_DELIVERY_EFFECT_TIMEOUT_MS
          + HOSTED_VAULT_SHARE_DELIVERY_TRANSPORT_MARGIN_MS
          - 5_001,
      );
      expect(deliverySettled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      await expect(delivery).rejects.toMatchObject({
        forwardedFromWeb: false,
        status: 500,
      });
      expect(deliverySettled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains delivery ownership through the conservative settlement window after transport ambiguity", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(() => new Promise<Response>((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error("synthetic proxy transport failure"));
        }, 5_000);
      }));
      const vaultSharePort = createHostedWebVaultSharePort({
        boundUserId: "member_projection_ambiguous",
        fetchImpl: fetchImpl as typeof fetch,
        timeoutMs: 1_000,
        transport: { mode: "proxy" },
      });
      let deliverySettled = false;

      const delivery = vaultSharePort.deliver({
        expectedGenerationToken: GENERATION_TOKEN,
        projectionKind: "profile-name.v0",
        projectionScope: hostedVaultShareProjectionKindToScope("profile-name.v0"),
        records: [],
        sourceWorkspaceVersion: "7",
      });
      void delivery.then(
        () => {
          deliverySettled = true;
        },
        () => {
          deliverySettled = true;
        },
      );
      await vi.advanceTimersByTimeAsync(5_000);
      expect(deliverySettled).toBe(false);

      await vi.advanceTimersByTimeAsync(
        HOSTED_VAULT_SHARE_DELIVERY_EFFECT_TIMEOUT_MS
          + HOSTED_VAULT_SHARE_DELIVERY_TRANSPORT_MARGIN_MS
          - 5_001,
      );
      expect(deliverySettled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(delivery).rejects.toThrow("Hosted vault share delivery request failed.");
      expect(deliverySettled).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
