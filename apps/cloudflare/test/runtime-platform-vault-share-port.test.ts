import {
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
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
} from "../src/runner-outbound/headers.ts";
import type { RunnerOutboundEnvironmentSource } from "../src/runner-outbound/shared.ts";
import { handleRunnerWebControlRequest } from "../src/runner-outbound/web-control.ts";
import { createHostedWebVaultSharePort } from "../src/runtime-platform/vault-share-port.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

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
        HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS: "30000",
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
      timeoutMs: 30_000,
      transport: { mode: "proxy" },
    });

    let deliverySettled = false;
    const delivery = vaultSharePort.deliver({
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

    releaseWebRequest(Response.json({ status: "delivered" }));
    await expect(delivery).resolves.toEqual({ status: "delivered" });
    expect(deliverySettled).toBe(true);
  });
});
