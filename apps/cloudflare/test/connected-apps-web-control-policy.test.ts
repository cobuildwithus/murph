import { beforeEach, describe, expect, it, vi } from "vitest";

import { HOSTED_CONNECTED_APPS_PATH } from "@murphai/hosted-execution/connected-apps";
import {
  HOSTED_PHONE_CALLS_PATH,
  HOSTED_PHONE_CALL_STATUS_PATH,
  HOSTED_PHONE_CALL_STOP_PATH,
} from "@murphai/hosted-execution/phone-calls";

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

import { createHostedWebConnectedAppsPort } from "../src/runtime-platform/connected-apps-port.ts";
import { HostedWebControlPlaneResponseError } from "../src/runtime-platform/web-control-transport.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import type { RunnerOutboundEnvironmentSource } from "../src/runner-outbound/shared.ts";
import {
  readHostedRunnerWebControlPolicy,
} from "../src/runner-outbound/shared-web-control-policy.ts";
import { handleRunnerWebControlRequest } from "../src/runner-outbound/web-control.ts";
import {
  createHostedExecutionTestEnv,
  TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
} from "./hosted-execution-fixtures.ts";

beforeEach(() => {
  mocks.fetchHostedExecutionWebControlPlaneResponse.mockReset();
});

describe("connected-app web-control policy", () => {
  it("allows only the bounded POST route", () => {
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: HOSTED_CONNECTED_APPS_PATH,
    })).toEqual({
      allowed: true,
      operation: "connected_apps",
    });
    expect(readHostedRunnerWebControlPolicy({
      method: "GET",
      path: HOSTED_CONNECTED_APPS_PATH,
    }).allowed).toBe(false);
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: "/api/internal/connected-apps/arbitrary",
    }).allowed).toBe(false);
  });

  it("allows only the bounded phone-call control routes", () => {
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: HOSTED_PHONE_CALLS_PATH,
    })).toEqual({
      allowed: true,
      operation: "phone_call_start",
    });
    expect(readHostedRunnerWebControlPolicy({
      method: "GET",
      path: HOSTED_PHONE_CALLS_PATH,
    }).allowed).toBe(false);
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: HOSTED_PHONE_CALL_STATUS_PATH,
    })).toEqual({
      allowed: true,
      operation: "phone_call_status",
    });
    expect(readHostedRunnerWebControlPolicy({
      method: "GET",
      path: HOSTED_PHONE_CALL_STATUS_PATH,
    }).allowed).toBe(false);
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: HOSTED_PHONE_CALL_STOP_PATH,
    })).toEqual({
      allowed: true,
      operation: "phone_call_stop",
    });
    expect(readHostedRunnerWebControlPolicy({
      method: "GET",
      path: HOSTED_PHONE_CALL_STOP_PATH,
    }).allowed).toBe(false);
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: "/api/internal/phone-calls/arbitrary",
    }).allowed).toBe(false);
  });

  it("requires the runtime write fence before forwarding connected-app requests", async () => {
    const url = new URL(`http://web-control.worker${HOSTED_CONNECTED_APPS_PATH}`);
    const response = await handleRunnerWebControlRequest({
      env: {} as RunnerOutboundEnvironmentSource,
      environment: readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      })),
      request: new Request(url, {
        body: JSON.stringify({ operation: "manage" }),
        method: "POST",
      }),
      url,
      userId: "member_123",
    });

    expect(response.status).toBe(401);
    expect(mocks.fetchHostedExecutionWebControlPlaneResponse).not.toHaveBeenCalled();
  });
  it("keeps the control-plane error code, status, and message readable by the caller", async () => {
    // The assistant decides whether a connected-app failure is worth retrying
    // and what to tell the user, so a rejected request must arrive as more than
    // a transport error.
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "CONNECTED_APPS_RESULT_TOO_LARGE",
            message: "That request returned more than Murph can read at once.",
            retryable: false,
          },
        }),
        { headers: { "content-type": "application/json" }, status: 413 },
      ),
    );
    const port = createHostedWebConnectedAppsPort({
      boundUserId: "member_123",
      fetchImpl: (async () => {
        throw new Error("Direct transport should route through the control plane.");
      }) as unknown as typeof fetch,
      timeoutMs: 5_000,
      transport: {
        callbackSigning: {
          keyId: "v1",
          privateKeyJwkJson: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
        },
        mode: "direct",
        webControlBaseUrl: "https://web.example.test",
        workspaceCheckpointBridge: null,
      },
    });

    const error = await port.request(
      { input: { query: "travel credit" }, operation: "search" },
      { signal: null },
    ).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(HostedWebControlPlaneResponseError);
    expect(error).toMatchObject({
      code: "CONNECTED_APPS_RESULT_TOO_LARGE",
      detail: "That request returned more than Murph can read at once.",
      retryable: false,
      status: 413,
    });
  });
});
