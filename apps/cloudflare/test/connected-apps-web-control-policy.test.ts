import { beforeEach, describe, expect, it, vi } from "vitest";

import { HOSTED_CONNECTED_APPS_PATH } from "@murphai/hosted-execution/connected-apps";

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
});
