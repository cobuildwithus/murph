import { beforeEach, describe, expect, it, vi } from "vitest";

import { HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH } from "@murphai/hosted-execution/routes";

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
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

beforeEach(() => {
  mocks.fetchHostedExecutionWebControlPlaneResponse.mockReset();
});

describe("workspace checkpoint web-control responses", () => {
  it("preserves an unreadable successful upstream response as an ambiguous server failure", async () => {
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(
      new Response("not-json", { status: 200 }),
    );
    const env: RunnerOutboundEnvironmentSource = {
      BUNDLES: {
        get: async () => null,
        put: async () => undefined,
      },
      USER_RUNNER: {
        getByName: () => ({
          validateRuntimeWriteFence: async () => true,
        }),
      },
    };
    const url = new URL(
      `http://web-control.worker${HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH}`,
    );
    const request = new Request(url, {
      body: JSON.stringify({
        attemptId: "attempt_1",
        expectedWorkspaceVersion: "4",
        leaseGeneration: "9",
        reason: "canonical_runtime_commit",
      }),
      headers: {
        [HOSTED_RUNTIME_ATTEMPT_ID_HEADER]: "attempt_1",
        [HOSTED_RUNTIME_LEASE_GENERATION_HEADER]: "9",
        [HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER]: "4",
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

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Hosted workspace checkpoint response was invalid.",
    });
  });
});
