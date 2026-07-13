import { beforeEach, describe, expect, it, vi } from "vitest";

import { HOSTED_CONNECTED_APPS_PATH } from "@murphai/hosted-execution/connected-apps";
import { HOSTED_CALL_CIRCLE_RESPOND_PATH } from "@murphai/hosted-execution/call-circle";
import { HOSTED_PHONE_CALLS_PATH } from "@murphai/hosted-execution/phone-calls";
import {
  HOSTED_RUNTIME_CALL_CIRCLE_NOTIFICATION_CLAIM_PATH,
} from "@murphai/hosted-execution/routes";

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
} from "../src/runner-outbound/headers.ts";
import type { RunnerOutboundEnvironmentSource } from "../src/runner-outbound/shared.ts";
import {
  readHostedRunnerWebControlPolicy,
} from "../src/runner-outbound/shared-web-control-policy.ts";
import { handleRunnerWebControlRequest } from "../src/runner-outbound/web-control.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

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

  it("allows only the bounded phone-call start route", () => {
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
      path: "/api/internal/phone-calls/arbitrary",
    }).allowed).toBe(false);
  });

  it("allows only the bounded Call Circle response route", () => {
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: HOSTED_CALL_CIRCLE_RESPOND_PATH,
    })).toEqual({
      allowed: true,
      operation: "call_circle_respond",
    });
    expect(readHostedRunnerWebControlPolicy({
      method: "GET",
      path: HOSTED_CALL_CIRCLE_RESPOND_PATH,
    }).allowed).toBe(false);
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: "/api/internal/call-circle/respond/arbitrary",
    }).allowed).toBe(false);
  });

  it("allows only the bounded Call Circle notification-claim route", () => {
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: HOSTED_RUNTIME_CALL_CIRCLE_NOTIFICATION_CLAIM_PATH,
    })).toEqual({
      allowed: true,
      operation: "call_circle_notification_claim",
    });
    expect(readHostedRunnerWebControlPolicy({
      method: "GET",
      path: HOSTED_RUNTIME_CALL_CIRCLE_NOTIFICATION_CLAIM_PATH,
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

  it("requires the active runtime write fence before claiming a Call Circle notification", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => false);
    const env = createRuntimeFenceEnvironment(validateRuntimeWriteFence);
    const url = new URL(
      `http://web-control.worker${HOSTED_RUNTIME_CALL_CIRCLE_NOTIFICATION_CLAIM_PATH}`,
    );
    const request = new Request(url, {
      body: JSON.stringify({
        answeredMailboxItemIds: ["hmi_123"],
        deliveryIdempotencyKey:
          "assistant.notification.requested:call-circle:setup:hgrp_123:member_123",
      }),
      headers: {
        [HOSTED_RUNTIME_ATTEMPT_ID_HEADER]: "attempt_stale",
        [HOSTED_RUNTIME_LEASE_GENERATION_HEADER]: "4",
      },
      method: "POST",
    });

    const response = await handleRunnerWebControlRequest({
      env,
      environment: readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      })),
      request,
      url,
      userId: "member_123",
    });

    expect(response.status).toBe(401);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_stale",
      generation: "4",
      userId: "member_123",
    });
    expect(mocks.fetchHostedExecutionWebControlPlaneResponse).not.toHaveBeenCalled();
  });

  it("forwards an authorized Call Circle notification claim with its validated fence", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => true);
    const env = createRuntimeFenceEnvironment(validateRuntimeWriteFence);
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const url = new URL(
      `http://web-control.worker${HOSTED_RUNTIME_CALL_CIRCLE_NOTIFICATION_CLAIM_PATH}`,
    );
    const request = new Request(url, {
      body: JSON.stringify({
        answeredMailboxItemIds: ["hmi_123"],
        deliveryIdempotencyKey:
          "assistant.notification.requested:call-circle:setup:hgrp_123:member_123",
      }),
      headers: {
        [HOSTED_RUNTIME_ATTEMPT_ID_HEADER]: "attempt_current",
        [HOSTED_RUNTIME_LEASE_GENERATION_HEADER]: "5",
      },
      method: "POST",
    });

    const response = await handleRunnerWebControlRequest({
      env,
      environment: readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      })),
      request,
      url,
      userId: "member_123",
    });

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: "attempt_current",
      generation: "5",
      userId: "member_123",
    });
    expect(mocks.fetchHostedExecutionWebControlPlaneResponse).toHaveBeenCalledTimes(1);
    const forwardedHeaders = mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls[0]?.[0]
      ?.headers as Headers;
    expect(forwardedHeaders.get(HOSTED_RUNTIME_ATTEMPT_ID_HEADER)).toBe("attempt_current");
    expect(forwardedHeaders.get(HOSTED_RUNTIME_LEASE_GENERATION_HEADER)).toBe("5");
  });
});

function createRuntimeFenceEnvironment(
  validateRuntimeWriteFence: (input: {
    attemptId: string;
    generation: string;
    userId: string;
  }) => Promise<boolean>,
): RunnerOutboundEnvironmentSource {
  return {
    BUNDLES: {
      get: async () => null,
      put: async () => undefined,
    },
    USER_RUNNER: {
      getByName: () => ({ validateRuntimeWriteFence }),
    },
  };
}
