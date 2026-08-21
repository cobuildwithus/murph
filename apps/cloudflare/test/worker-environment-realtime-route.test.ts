import { afterEach, describe, expect, it, vi } from "vitest";
import { ENVIRONMENT_REALTIME_TOOL_NAMES } from "@murphai/contracts";

import { readHostedExecutionEnvironment } from "../src/env.ts";
import type {
  WorkerEnvironmentSource,
  WorkerRouteContext,
} from "../src/worker-routes/shared.ts";
import {
  environmentRealtimeRoutes,
} from "../src/worker/route-handlers/environment-realtime.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";

describe("worker Environment Realtime route", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires Vercel OIDC and the matching bound user", () => {
    const route = environmentRealtimeRoutes[0];
    const missing = createContext("v=0\r\noffer");
    const matching = createContext("v=0\r\noffer", "user_123");

    expect(route.authorization).toBe("vercel-oidc");
    expect(route.authorizeBeforeMethod).toBe(true);
    expect(route.beforeMethod?.(missing, { userId: "user_123" })).toMatchObject({
      status: 401,
    });
    expect(route.beforeMethod?.(matching, { userId: "user_123" })).toBeNull();
  });

  it("creates a text-only Realtime call with a pseudonymous safety id", async () => {
    const fetchMock = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => new Response("v=0\r\nanswer"));
    vi.stubGlobal("fetch", fetchMock);
    const route = environmentRealtimeRoutes[0];
    const context = createContext("v=0\r\noffer", "user_123");

    const response = await route.handle(context, { userId: "user_123" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sdp: "v=0\r\nanswer" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/realtime/calls");
    const requestHeaders = new Headers(init?.headers);
    expect(requestHeaders.get("authorization")).toBe("Bearer test-openai-key");
    const safetyId = new Headers(init?.headers).get("OpenAI-Safety-Identifier");
    expect(safetyId).toMatch(/^[a-f0-9]{64}$/u);
    expect(safetyId).not.toContain("user_123");
    const body = init?.body;
    expect(body).toBeInstanceOf(FormData);
    const session = JSON.parse(String((body as FormData).get("session"))) as {
      instructions: string;
      model: string;
      output_modalities: string[];
      tool_choice: string;
      tools: Array<{
        name: string;
        parameters: { properties?: { action?: { enum?: string[] } } };
      }>;
    };
    expect(session).toMatchObject({
      model: "gpt-realtime-2.1",
      output_modalities: ["text"],
      tool_choice: "required",
    });
    expect(session.instructions).toContain(
      "Uncertainty or lack of knowledge leaves the field unresolved",
    );
    expect(session.tools.map((tool) => tool.name)).toEqual([
      ENVIRONMENT_REALTIME_TOOL_NAMES.setLanguage,
      ENVIRONMENT_REALTIME_TOOL_NAMES.continueInterview,
      ENVIRONMENT_REALTIME_TOOL_NAMES.updateInterview,
    ]);
    expect(
      session.tools.find(
        (tool) =>
          tool.name === ENVIRONMENT_REALTIME_TOOL_NAMES.updateInterview,
      )?.parameters.properties?.action?.enum,
    ).toEqual(["back", "next", "skip", "finish"]);
  });

  it("fails closed when the provider key is unavailable", async () => {
    const route = environmentRealtimeRoutes[0];
    const context = createContext("v=0\r\noffer", "user_123", false);

    const response = await route.handle(context, { userId: "user_123" });

    expect(response.status).toBe(503);
  });
});

function createContext(
  sdp: string,
  boundUserId?: string,
  includeProviderKey = true,
): WorkerRouteContext {
  const headers = new Headers({ "content-type": "application/sdp" });
  if (boundUserId) {
    headers.set("x-hosted-execution-user-id", boundUserId);
  }
  const request = new Request(
    "https://runner.example.test/internal/users/user_123/environment-realtime/call",
    { body: sdp, headers, method: "POST" },
  );
  const baseEnv = createHostedExecutionTestEnv();
  const env: WorkerEnvironmentSource = {
    ...baseEnv,
    BUNDLES: new MemoryEncryptedR2Bucket(),
    RUNNER_CONTAINER: createUnusedContainerNamespace(),
    RUNNER_CONTAINER_SMOKE: createUnusedContainerNamespace(),
    USER_RUNNER: {
      getByName() {
        return {
          async bindUser(userId) {
            return { userId };
          },
          deleteHostedUserData: failUnused,
          ensureRuntimeProcessingForUser: failUnused,
          publishHostedPrivateMedia: failUnused,
          runnerStatus: failUnused,
        };
      },
    },
    ...(includeProviderKey ? { OPENAI_API_KEY: "test-openai-key" } : {}),
  };
  return {
    env,
    environment: readHostedExecutionEnvironment(baseEnv),
    request,
    url: new URL(request.url),
  };
}

function createUnusedContainerNamespace():
  WorkerEnvironmentSource["RUNNER_CONTAINER"] {
  return {
    getByName() {
      return {
        destroyInstance: failUnused,
        invoke: failUnused,
        smokeHealth: failUnused,
      };
    },
  };
}

async function failUnused(): Promise<never> {
  throw new Error("Unexpected test dependency call.");
}
