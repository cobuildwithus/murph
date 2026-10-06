import { afterEach, expect, test, vi } from "vitest";
import { HOSTED_RUNTIME_LOG_PATH } from "@murphai/hosted-execution/routes";
import { HOSTED_RUNTIME_OWNER_PATH } from "@murphai/hosted-execution/runtime-owner";
import { createPostgresTestOwner, forbiddenLegacyRuntime, nativeProviderTestNamespace } from "../postgres-owner-fixtures.ts";
import { createHostedExecutionTestEnv } from "../hosted-execution-fixtures.ts";
import {
  hostedRunnerIntercept,
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
} from "../../src/runner-egress-intercept.ts";
import type { RunnerOutboundEnvironmentSource } from "../../src/runner-outbound.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("returns the OpenAI Responses body and emits its diagnostic as a Worker log only", async () => {
  const upstreamPaths: string[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (target, init) => {
    const request = new Request(target, init);
    const url = new URL(request.url);
    upstreamPaths.push(url.pathname);
    if (url.pathname === HOSTED_RUNTIME_OWNER_PATH) {
      return Response.json({ cutover: "postgres", status: "authorized", owner: createPostgresTestOwner() });
    }
    if (url.hostname === "api.openai.com") return new Response("synthetic provider stream");
    throw new Error(`Unexpected synthetic upstream ${url.pathname}`);
  }));
  // The workers test config silences structured stdio logs; this test reads them.
  vi.stubEnv("MURPH_HOSTED_EXECUTION_STDIO_LOGS", "1");
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
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
  const diagnostic = await vi.waitFor(() => {
    const record = info.mock.calls
      .map(([line]) => (typeof line === "string" ? JSON.parse(line) as {
        details?: Record<string, unknown>;
        message?: string;
      } : null))
      .find((entry) => entry?.message === "Hosted runner provider request diagnostic captured.");
    expect(record).toBeDefined();
    return record;
  });
  // The admitted bytes remain readable after the upstream request takes its body.
  expect(diagnostic?.details).toMatchObject({
    jsonValid: true,
    modelKind: "gpt-5.6-terra",
    requestBytes: new TextEncoder().encode(requestBody).byteLength,
  });
  expect(upstreamPaths).not.toContain(HOSTED_RUNTIME_LOG_PATH);
});
