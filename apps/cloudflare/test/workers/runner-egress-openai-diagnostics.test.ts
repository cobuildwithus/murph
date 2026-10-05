import { afterEach, expect, test, vi } from "vitest";
import { HOSTED_RUNTIME_LOG_PATH } from "@murphai/hosted-execution/routes";
import { HOSTED_RUNTIME_OWNER_PATH } from "@murphai/hosted-execution/runtime-owner";
import { createPostgresTestOwner, forbiddenLegacyRuntime, nativeProviderTestNamespace } from "../postgres-owner-fixtures.ts";
import { createHostedExecutionTestEnv } from "../hosted-execution-fixtures.ts";
import {
  hostedRunnerIntercept,
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
  HOSTED_OPENAI_CACHE_DIAGNOSTIC_EVENT_CODE,
} from "../../src/runner-egress-intercept.ts";
import type { RunnerOutboundEnvironmentSource } from "../../src/runner-outbound.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("returns the OpenAI Responses body while its diagnostic runtime-log write is still pending", async () => {
  let releaseRuntimeLog: (() => void) | undefined;
  const runtimeLogReleased = new Promise<void>((resolve) => {
    releaseRuntimeLog = resolve;
  });
  let markRuntimeLogWritten: ((body: string) => void) | undefined;
  const runtimeLogWritten = new Promise<string>((resolve) => {
    markRuntimeLogWritten = resolve;
  });
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (target, init) => {
    const request = new Request(target, init);
    const url = new URL(request.url);
    if (url.pathname === HOSTED_RUNTIME_OWNER_PATH) {
      return Response.json({ cutover: "postgres", status: "authorized", owner: createPostgresTestOwner() });
    }
    if (url.hostname === "api.openai.com") return new Response("synthetic provider stream");
    if (url.pathname === HOSTED_RUNTIME_LOG_PATH) {
      const body = await request.text();
      await runtimeLogReleased;
      markRuntimeLogWritten?.(body);
      return Response.json({ loggedCount: 1 });
    }
    throw new Error(`Unexpected synthetic upstream ${url.pathname}`);
  }));
  const environment: RunnerOutboundEnvironmentSource = {
    ...createHostedExecutionTestEnv(),
    BUNDLES: {} as RunnerOutboundEnvironmentSource["BUNDLES"],
    OPENAI_API_KEY: "synthetic-provider-key",
    USER_RUNNER: forbiddenLegacyRuntime,
    RUNNER_CONTAINER: nativeProviderTestNamespace(() => createPostgresTestOwner()),
  };

  const requestBody = JSON.stringify({ input: "synthetic", model: "gpt-5.6-terra", stream: true });
  // Production container interception supplies no ctx.waitUntil.
  const response = await hostedRunnerIntercept(new Request("https://api.openai.com/v1/responses", {
    body: requestBody,
    headers: {
      authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
      "content-type": "application/json",
    },
    method: "POST",
  }), environment, { className: "RunnerContainer", containerId: "member_123--v-test" });

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("synthetic provider stream");
  releaseRuntimeLog?.();
  const runtimeLogBody = JSON.parse(await runtimeLogWritten) as {
    entries?: Array<{ eventCode?: string; redactedJson?: Record<string, unknown> }>;
  };
  expect(runtimeLogBody.entries?.[0]?.eventCode).toBe(HOSTED_OPENAI_CACHE_DIAGNOSTIC_EVENT_CODE);
  // The admitted bytes remain readable after the upstream request takes its body.
  expect(runtimeLogBody.entries?.[0]?.redactedJson).toMatchObject({
    jsonValid: true,
    modelKind: "gpt-5.6-terra",
    requestBytes: new TextEncoder().encode(requestBody).byteLength,
  });
});
