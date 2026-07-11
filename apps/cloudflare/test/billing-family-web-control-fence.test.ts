import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_RUNTIME_BILLING_PLAN_TOOL_PATH,
  HOSTED_RUNTIME_FAMILY_PLAN_TOOL_PATH,
} from "@murphai/hosted-execution/routes";
import {
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
} from "../src/runner-outbound/headers.ts";

const mocks = vi.hoisted(() => ({
  fetchHostedExecutionWebControlPlaneResponse: vi.fn(),
  requireRunnerRuntimeWriteFenceWrite: vi.fn(),
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

vi.mock("../src/runner-outbound/write-fence.ts", async () => {
  const actual = await vi.importActual<typeof import(
    "../src/runner-outbound/write-fence.ts"
  )>("../src/runner-outbound/write-fence.ts");
  return {
    ...actual,
    requireRunnerRuntimeWriteFenceWrite:
      mocks.requireRunnerRuntimeWriteFenceWrite,
  };
});

import { readHostedExecutionEnvironment } from "../src/env.ts";
import type { RunnerOutboundEnvironmentSource } from
  "../src/runner-outbound/shared.ts";
import { handleRunnerWebControlRequest } from
  "../src/runner-outbound/web-control.ts";
import { RunnerRuntimeWriteFenceError } from
  "../src/runner-outbound/write-fence.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

const paths = [
  HOSTED_RUNTIME_BILLING_PLAN_TOOL_PATH,
  HOSTED_RUNTIME_FAMILY_PLAN_TOOL_PATH,
] as const;

describe("billing and Family web-control write fences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(
      new Response("{}", {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
  });

  it.each(paths)("rejects %s without an active-attempt write fence", async (path) => {
    mocks.requireRunnerRuntimeWriteFenceWrite.mockRejectedValueOnce(
      new RunnerRuntimeWriteFenceError(),
    );
    const response = await handle(path);

    expect(response.status).toBe(401);
    expect(mocks.fetchHostedExecutionWebControlPlaneResponse).not.toHaveBeenCalled();
  });

  it.each(paths)("forwards %s with the validated fence authority", async (path) => {
    mocks.requireRunnerRuntimeWriteFenceWrite.mockResolvedValueOnce({
      attemptId: "attempt_current",
      generation: "7",
      workspaceVersion: "11",
    });
    const response = await handle(path);

    expect(response.status).toBe(200);
    expect(mocks.fetchHostedExecutionWebControlPlaneResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        boundUserId: "member_current",
        path,
        headers: expect.any(Headers),
      }),
    );
    const forwarded = mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls[0]?.[0];
    expect(forwarded?.headers.get(HOSTED_RUNTIME_ATTEMPT_ID_HEADER))
      .toBe("attempt_current");
    expect(forwarded?.headers.get(HOSTED_RUNTIME_LEASE_GENERATION_HEADER)).toBe("7");
    expect(forwarded?.headers.get(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER)).toBe("11");
  });
});

async function handle(path: string): Promise<Response> {
  const url = new URL(`http://web-control.worker${path}`);
  return handleRunnerWebControlRequest({
    env: {} as RunnerOutboundEnvironmentSource,
    environment: readHostedExecutionEnvironment(createHostedExecutionTestEnv({
      HOSTED_WEB_BASE_URL: "https://web.example.test",
    })),
    request: new Request(url, {
      body: JSON.stringify({ action: "read_status" }),
      method: "POST",
    }),
    url,
    userId: "member_current",
  });
}
