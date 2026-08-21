import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_ASSISTANT_LUNA_MODEL,
  HOSTED_ASSISTANT_PRODUCT_MODELS,
  HOSTED_ASSISTANT_PROVIDERS,
  HOSTED_ASSISTANT_REASONING_EFFORTS,
} from "@murphai/hosted-execution/assistant-model";
import {
  HOSTED_RUNTIME_ASSISTANT_CONFIGURATION_TOOL_PATH,
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

import {
  readHostedRunnerWebControlPolicy,
} from "../src/runner-outbound/shared-web-control-policy.ts";
import { handleRunnerWebControlRequest } from "../src/runner-outbound/web-control.ts";
import {
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
} from "../src/runner-outbound/headers.ts";
import type { RunnerOutboundEnvironmentSource } from "../src/runner-outbound/shared.ts";
import { writeRunnerRuntimeWriteFenceHeaders } from "../src/runner-outbound/write-fence.ts";
import {
  createHostedRuntimeAssistantConfigurationToolPort,
} from "../src/runtime-platform/assistant-configuration-tool-port.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

function requireRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Request {
  return input instanceof Request ? input : new Request(input, init);
}

const ACTIVE_WRITE_FENCE = {
  attemptId: "attempt_active",
  generation: "generation_active",
  workspaceVersion: "7",
} as const;

function createWriteFenceHeaders(input: {
  attemptId: string;
  generation: string;
}): Headers {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
  });
  writeRunnerRuntimeWriteFenceHeaders(headers, {
    ...input,
    workspaceVersion: ACTIVE_WRITE_FENCE.workspaceVersion,
  });
  return headers;
}

function createWriteFenceEnvironment(
  validateRuntimeWriteFence: (
    input: { attemptId: string; generation: string; userId: string },
  ) => Promise<boolean>,
): RunnerOutboundEnvironmentSource {
  return {
    BUNDLES: {} as RunnerOutboundEnvironmentSource["BUNDLES"],
    USER_RUNNER: {
      getByName() {
        return { validateRuntimeWriteFence };
      },
    },
  };
}

function createAssistantConfigurationRequest(headers?: Headers): {
  request: Request;
  url: URL;
} {
  const url = new URL(
    `http://web-control.worker${HOSTED_RUNTIME_ASSISTANT_CONFIGURATION_TOOL_PATH}`,
  );
  return {
    request: new Request(url, {
      body: JSON.stringify({ action: "read" }),
      headers,
      method: "POST",
    }),
    url,
  };
}

beforeEach(() => {
  mocks.fetchHostedExecutionWebControlPlaneResponse.mockReset();
});

describe("hosted assistant configuration tool port", () => {
  it("allows only the bounded POST web-control route", () => {
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: HOSTED_RUNTIME_ASSISTANT_CONFIGURATION_TOOL_PATH,
    })).toEqual({
      allowed: true,
      operation: "assistant_configuration_tool",
    });
    expect(readHostedRunnerWebControlPolicy({
      method: "GET",
      path: HOSTED_RUNTIME_ASSISTANT_CONFIGURATION_TOOL_PATH,
    }).allowed).toBe(false);
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: `${HOSTED_RUNTIME_ASSISTANT_CONFIGURATION_TOOL_PATH}/arbitrary`,
    }).allowed).toBe(false);
  });

  it("does not forward requests without a runtime write fence", async () => {
    const validateRuntimeWriteFence = vi.fn(async () => true);
    const { request, url } = createAssistantConfigurationRequest();
    const response = await handleRunnerWebControlRequest({
      env: createWriteFenceEnvironment(validateRuntimeWriteFence),
      environment: readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      })),
      request,
      url,
      userId: "member_123",
    });

    expect(response.status).toBe(401);
    expect(validateRuntimeWriteFence).not.toHaveBeenCalled();
    expect(mocks.fetchHostedExecutionWebControlPlaneResponse).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "stale generation",
      writeFence: {
        attemptId: ACTIVE_WRITE_FENCE.attemptId,
        generation: "generation_stale",
      },
    },
    {
      label: "mismatched attempt",
      writeFence: {
        attemptId: "attempt_other",
        generation: ACTIVE_WRITE_FENCE.generation,
      },
    },
  ])("does not forward requests with a $label write fence", async ({ writeFence }) => {
    const validateRuntimeWriteFence = vi.fn(async (input: {
      attemptId: string;
      generation: string;
      userId: string;
    }) => (
      input.attemptId === ACTIVE_WRITE_FENCE.attemptId
      && input.generation === ACTIVE_WRITE_FENCE.generation
      && input.userId === "member_123"
    ));
    const { request, url } = createAssistantConfigurationRequest(
      createWriteFenceHeaders(writeFence),
    );

    const response = await handleRunnerWebControlRequest({
      env: createWriteFenceEnvironment(validateRuntimeWriteFence),
      environment: readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      })),
      request,
      url,
      userId: "member_123",
    });

    expect(response.status).toBe(401);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: writeFence.attemptId,
      generation: writeFence.generation,
      userId: "member_123",
    });
    expect(mocks.fetchHostedExecutionWebControlPlaneResponse).not.toHaveBeenCalled();
  });

  it("forwards requests with the matching active write fence", async () => {
    const validateRuntimeWriteFence = vi.fn(async (input: {
      attemptId: string;
      generation: string;
      userId: string;
    }) => (
      input.attemptId === ACTIVE_WRITE_FENCE.attemptId
      && input.generation === ACTIVE_WRITE_FENCE.generation
      && input.userId === "member_123"
    ));
    mocks.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(
      new Response(JSON.stringify({ action: "read", result: {} }), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      }),
    );
    const { request, url } = createAssistantConfigurationRequest(
      createWriteFenceHeaders(ACTIVE_WRITE_FENCE),
    );

    const response = await handleRunnerWebControlRequest({
      env: createWriteFenceEnvironment(validateRuntimeWriteFence),
      environment: readHostedExecutionEnvironment(createHostedExecutionTestEnv({
        HOSTED_WEB_BASE_URL: "https://web.example.test",
      })),
      request,
      url,
      userId: "member_123",
    });

    expect(response.status).toBe(200);
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: ACTIVE_WRITE_FENCE.attemptId,
      generation: ACTIVE_WRITE_FENCE.generation,
      userId: "member_123",
    });
    expect(mocks.fetchHostedExecutionWebControlPlaneResponse).toHaveBeenCalledTimes(1);
    const [forwarded] = mocks.fetchHostedExecutionWebControlPlaneResponse.mock.calls[0]!;
    expect(forwarded).toMatchObject({
      body: JSON.stringify({ action: "read" }),
      boundUserId: "member_123",
      method: "POST",
      path: HOSTED_RUNTIME_ASSISTANT_CONFIGURATION_TOOL_PATH,
    });
    const forwardedHeaders = new Headers(forwarded.headers);
    expect(forwardedHeaders.get(HOSTED_RUNTIME_ATTEMPT_ID_HEADER)).toBe(
      ACTIVE_WRITE_FENCE.attemptId,
    );
    expect(forwardedHeaders.get(HOSTED_RUNTIME_LEASE_GENERATION_HEADER)).toBe(
      ACTIVE_WRITE_FENCE.generation,
    );
    expect(forwardedHeaders.get(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER)).toBe(
      ACTIVE_WRITE_FENCE.workspaceVersion,
    );
  });

  it("forwards read and update requests through the runner proxy", async () => {
    const fetchMock = vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const request = requireRequest(input, init);
      const body = await request.clone().json() as {
        action: "read" | "update";
      };
      const snapshot = {
        availableModels: [...HOSTED_ASSISTANT_PRODUCT_MODELS],
        availableProviders: [...HOSTED_ASSISTANT_PROVIDERS],
        availableReasoningEfforts: [...HOSTED_ASSISTANT_REASONING_EFFORTS],
        configurationAvailable: true,
        dormantSolPreference: false,
        model: HOSTED_ASSISTANT_LUNA_MODEL,
        provider: "openai",
        reasoningEffort: "high",
        solAvailable: false,
      };

      return new Response(JSON.stringify(body.action === "read"
        ? {
            action: "read",
            result: snapshot,
          }
        : {
            action: "update",
            result: {
              ...snapshot,
              appliesAt: "next_turn",
              requiredPlan: null,
              status: "updated",
            },
          }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      });
    });
    const port = createHostedRuntimeAssistantConfigurationToolPort({
      boundUserId: "member_123",
      fetchImpl: fetchMock as typeof fetch,
      timeoutMs: 1_000,
      transport: { mode: "proxy" },
    });

    await expect(port.request({ action: "read" })).resolves.toMatchObject({
      action: "read",
      result: {
        model: HOSTED_ASSISTANT_LUNA_MODEL,
        reasoningEffort: "high",
      },
    });
    await expect(port.request({
      action: "update",
      assistantInputId: `ain_${"c".repeat(32)}`,
      model: HOSTED_ASSISTANT_LUNA_MODEL,
      provider: "venice",
      reasoningEffort: "high",
    })).resolves.toMatchObject({
      action: "update",
      result: {
        appliesAt: "next_turn",
        model: HOSTED_ASSISTANT_LUNA_MODEL,
        reasoningEffort: "high",
        status: "updated",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requests = fetchMock.mock.calls.map(([input, init]) =>
      requireRequest(input, init)
    );
    for (const request of requests) {
      expect(request.url).toBe(
        `http://web-control.worker${HOSTED_RUNTIME_ASSISTANT_CONFIGURATION_TOOL_PATH}`,
      );
      expect(request.method).toBe("POST");
      expect(request.headers.get("content-type")).toBe("application/json");
    }
    await expect(requests[0]!.json()).resolves.toEqual({ action: "read" });
    await expect(requests[1]!.json()).resolves.toEqual({
      action: "update",
      assistantInputId: `ain_${"c".repeat(32)}`,
      model: HOSTED_ASSISTANT_LUNA_MODEL,
      provider: "venice",
      reasoningEffort: "high",
    });
  });

  it("rejects malformed control-plane responses", async () => {
    const port = createHostedRuntimeAssistantConfigurationToolPort({
      boundUserId: "member_123",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        action: "read",
        result: {
          availableModels: [...HOSTED_ASSISTANT_PRODUCT_MODELS],
          availableProviders: [...HOSTED_ASSISTANT_PROVIDERS],
          availableReasoningEfforts: ["none"],
          configurationAvailable: true,
          model: HOSTED_ASSISTANT_LUNA_MODEL,
          provider: "openai",
          reasoningEffort: "none",
          solAvailable: false,
        },
      }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      })) as typeof fetch,
      timeoutMs: 1_000,
      transport: { mode: "proxy" },
    });

    await expect(port.request({ action: "read" })).rejects.toThrow(
      "Hosted assistant configuration tool returned invalid JSON.",
    );
  });
});
