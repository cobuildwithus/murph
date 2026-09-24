import { describe, expect, it, vi } from "vitest";
import { runtimeProcessingRoutes } from "../src/worker/route-handlers/runtime-control.ts";
import { controlPostgresRuntimeVoice } from "../src/runtime-user-control.ts";
import { readHostedExecutionEnvironment } from "../src/env.ts";
import type { WorkerRouteContext } from "../src/worker-routes/shared.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";

vi.mock("../src/runtime-user-control.ts", () => ({
  controlPostgresRuntimeVoice: vi.fn(async () => ({ kind: "not_ready" })),
  readPostgresRunnerStatus: vi.fn(), reconcilePostgresRuntimeConsent: vi.fn(),
}));
const route = runtimeProcessingRoutes.find((route) => route.name === "voice-control")!;
const command = { action: "connect", callId: "call-synthetic", attemptId: "attempt-synthetic", leaseGeneration: "1", sdp: "v=0\r\noffer" };
function context(body = JSON.stringify(command), boundUserId = "member-synthetic"): WorkerRouteContext {
  const base = createHostedExecutionTestEnv();
  const namespace = { getByName: () => ({ destroyInstance: vi.fn(), invoke: vi.fn(), smokeHealth: vi.fn() }) };
  const request = new Request("https://runner.example.test/internal/users/member-synthetic/runtime/voice", {
    method: "POST", headers: { "content-type": "application/json", "x-hosted-execution-user-id": boundUserId }, body,
  });
  return { request, url: new URL(request.url), environment: readHostedExecutionEnvironment(base),
    env: { ...base, BUNDLES: new MemoryEncryptedR2Bucket(), RUNNER_CONTAINER: namespace, RUNNER_CONTAINER_SMOKE: namespace } };
}
describe("Worker voice control authority", () => {
  it("requires Web OIDC and exact bound-member routing", () => {
    expect(route.authorization).toBe("vercel-oidc");
    expect(route.authorizeBeforeMethod).toBe(true);
    expect(route.match(context().url.pathname)).toEqual({ userId: "member-synthetic" });
    expect(route.beforeMethod(context(), { userId: "member-synthetic" })).toBeNull();
    expect(route.beforeMethod(context(undefined, "other-member"), { userId: "member-synthetic" })).toMatchObject({ status: 401 });
  });
  it("passes only the validated command and path-bound member to the existing owner", async () => {
    vi.mocked(controlPostgresRuntimeVoice).mockClear();
    const ctx = context();
    expect(await (await route.handle(ctx, { userId: "member-synthetic" })).json()).toEqual({ kind: "not_ready" });
    expect(controlPostgresRuntimeVoice).toHaveBeenCalledExactlyOnceWith(ctx.env, "member-synthetic", command);
  });
  it.each(["{invalid-private-offer", JSON.stringify({ ...command, userId: "other-member" })])("rejects invalid input without reflecting its content", async (body) => {
    vi.mocked(controlPostgresRuntimeVoice).mockClear();
    const response = await route.handle(context(body), { userId: "member-synthetic" });
    expect(response.status).toBe(400);
    expect(await response.text()).toBe('{"error":"Invalid voice command."}');
    expect(controlPostgresRuntimeVoice).not.toHaveBeenCalled();
  });
});
