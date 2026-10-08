import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedRuntimeOwnerSnapshot } from "@murphai/hosted-execution/runtime-owner";
import { hostedRunnerIntercept, handleHostedRunnerOpenAiOutbound, handleHostedRunnerLinqOutbound, HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL } from "../src/runner-egress-intercept.ts";
import { handleRunnerOutboundRequest } from "../src/runner-outbound.ts";
import { commandHostedRuntimeOwner } from "../src/runtime-owner-client.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "../src/web-control-plane.ts";
import { RunnerInvocationReceiptStore } from "../src/runner-invocation-receipt.ts";
import { readNativeRuntimeProviderAuthority } from "../src/runtime-provider-authorization.ts";
import { HOSTED_RUNNER_WEB_CONTROL_ROUTES } from "../src/runner-outbound/shared-web-control-policy.ts";
import { CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS } from "../src/internal-hosts.ts";
import { createTestSqlStorage } from "./sql-storage.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";
import { MemoryEncryptedR2Bucket } from "./test-helpers.ts";

vi.mock("../src/runtime-owner-client.ts", () => ({ commandHostedRuntimeOwner: vi.fn() }));
vi.mock("../src/web-control-plane.ts", async importOriginal => ({
  ...await importOriginal<typeof import("../src/web-control-plane.ts")>(), fetchHostedExecutionWebControlPlaneResponse: vi.fn(),
}));

function harness() {
  const userId = "synthetic-usage-member";
  const identity = { attemptId: "synthetic-usage-attempt", generation: "1" };
  const sql = createTestSqlStorage();
  const receipt = () => new RunnerInvocationReceiptStore(sql);
  receipt().register(identity, { workspaceVersion: "0", platformAiUsageAllowed: true });
  const owner: HostedRuntimeOwnerSnapshot = { ...identity, userId, phase: "active", processingMode: "default", allocationId: "standby-claim-11111111-1111-4111-8111-111111111111", runnerContainerName: `runner--v-release_1--${"1".repeat(32)}`, workspaceVersion: "0", platformAiUsageAllowed: true, startedAt: new Date().toISOString(), acceptedAt: null, completedAt: null, failureCount: 0, lastErrorCode: null };
  const container = {
    beginRuntimeUsageSettlement: vi.fn(async (input: typeof identity & { reportId: string }) => receipt().beginUsageSettlement(input, input.reportId)),
    finishRuntimeUsageSettlement: vi.fn(async (input: typeof identity & { reportId: string; allowed: boolean }) => receipt().finishUsageSettlement(input, input.reportId, input.allowed)),
    readProviderAuthority: vi.fn(async () => {
      const invocation = receipt().readProviderInvocation();
      return invocation?.context ? { ...identity, userId, ...invocation.context,
        settlementPending: invocation.settlementPending, retiring: false } : null;
    }),
  };
  const env = { ...createHostedExecutionTestEnv(), HOSTED_RUNTIME_POSTGRES_ENABLED: "true", BUNDLES: new MemoryEncryptedR2Bucket(), RUNNER_CONTAINER: { getByName: () => container, get: () => container, idFromString: (id: string) => id }, USER_RUNNER: { getByName() { throw new Error("Unexpected UserRunner activation"); } } };
  vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({ cutover: "postgres", status: "authorized", owner });
  const request = (body: unknown = { usage: { usageId: "synthetic-report" } }) => new Request(`${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane}${HOSTED_RUNNER_WEB_CONTROL_ROUTES.usageRecording.path}`, { method: "POST", headers: {
    "content-type": "application/json", "x-hosted-runtime-attempt-id": identity.attemptId, "x-hosted-runtime-lease-generation": identity.generation, "x-hosted-runtime-workspace-version": "0",
  }, body: JSON.stringify(body) });
  return { userId, identity, receipt, owner, env, request, container };
}

const caller = { containerId: "synthetic-container", className: "RunnerContainer" };

describe("Provider identity and usage settlement with native receipts", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it.each(["none", "forged", "legacy"])("types with %s caller credentials and zero Web authorization calls", async proof => {
    const h = harness();
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const headers: Record<string, string> = proof === "none" ? {} : {
      authorization: "Bearer obsolete-credential",
      "x-hosted-runner-bound-user-id": "another-member",
      "x-hosted-provider-egress-token": "obsolete-token",
      "x-hosted-runtime-attempt-id": "another-attempt",
    };
    const response = await handleHostedRunnerLinqOutbound(new Request("https://api.linqapp.com/api/partner/v3/chats/synthetic-chat/typing", {
      method: "POST", headers,
    }), { ...h.env, LINQ_API_TOKEN: "synthetic-worker-secret" }, caller);
    expect(response.status).toBe(204);
    expect(commandHostedRuntimeOwner).not.toHaveBeenCalled();
    expect(upstream).toHaveBeenCalledTimes(1);
    const forwarded = upstream.mock.calls[0]?.[0];
    if (!(forwarded instanceof Request)) throw new Error("Expected forwarded provider request");
    expect(forwarded.headers.get("authorization")).toBe("Bearer synthetic-worker-secret");
    expect(forwarded.headers.has("x-hosted-runner-bound-user-id")).toBe(false);
    expect(h.container.readProviderAuthority).toHaveBeenCalledTimes(1);
  });

  it.each([{}, { containerId: caller.containerId }, { ...caller, className: "UnknownContainer" }])(
    "denies unbound platform callers regardless of their headers", async context => {
      const h = harness();
      const upstream = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Must not reach provider"));
      const result = await handleHostedRunnerLinqOutbound(new Request("https://api.linqapp.com/api/partner/v3/chats/synthetic-chat/typing", {
        method: "POST", headers: { "x-hosted-runner-bound-user-id": h.userId, "x-hosted-provider-egress-token": "claimed-token" },
      }), { ...h.env, LINQ_API_TOKEN: "synthetic-worker-secret" }, context);
      expect(result.status).toBe(401);
      expect(upstream).not.toHaveBeenCalled();
      expect(commandHostedRuntimeOwner).not.toHaveBeenCalled();
    });

  it.each([false, true])("enforces native spending settlement without a Web preflight (denied=%s)", async denied => {
    const h = harness();
    if (denied) {
      h.receipt().beginUsageSettlement(h.identity, "synthetic-denied-report");
      h.receipt().finishUsageSettlement(h.identity, "synthetic-denied-report", false);
    }
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "synthetic-response" }));
    const response = await handleHostedRunnerOpenAiOutbound(new Request("https://api.openai.com/v1/responses", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "synthetic-model", input: "Synthetic request" }),
    }), { ...h.env, OPENAI_API_KEY: "synthetic-provider-secret" }, caller);
    expect(response.status).toBe(denied ? 503 : 200);
    expect(commandHostedRuntimeOwner).not.toHaveBeenCalled();
    expect(upstream).toHaveBeenCalledTimes(denied ? 0 : 1);
    expect(h.container.readProviderAuthority).toHaveBeenCalledTimes(1);
  });

  it("denies a completed invocation even when its old credential remains available", async () => {
    const h = harness();
    h.receipt().complete(h.identity, false);
    expect(await readNativeRuntimeProviderAuthority(h.env, caller)).toBeNull();
    expect(commandHostedRuntimeOwner).not.toHaveBeenCalled();
  });

  it.each([{}, { usage: null }, { usage: "invalid" }])("rejects malformed usage envelopes before settlement admission", async body => {
    const h = harness();
    expect((await handleRunnerOutboundRequest(h.request(body), h.env, h.userId, caller)).status).toBe(400);
    expect(h.container.beginRuntimeUsageSettlement).not.toHaveBeenCalled();
    expect(fetchHostedExecutionWebControlPlaneResponse).not.toHaveBeenCalled();
  });

  it("persists pending evidence before HTTP and denies later providers when settlement and revocation are unavailable", async () => {
    const h = harness();
    vi.mocked(fetchHostedExecutionWebControlPlaneResponse).mockImplementation(async () => {
      expect(h.receipt().usageSettlementAllowsProviders(h.identity)).toBe(false);
      throw new Error("synthetic settlement response lost");
    });
    vi.mocked(commandHostedRuntimeOwner).mockImplementation(async input => {
      if (input.command.operation === "revoke_ai_usage") throw new Error("synthetic Web outage");
      return { cutover: "postgres", status: "authorized", owner: h.owner };
    });
    await expect(handleRunnerOutboundRequest(h.request(), h.env, h.userId, caller)).rejects.toThrow("synthetic Web outage");
    const provider = await readNativeRuntimeProviderAuthority(h.env, caller);
    expect(provider).toMatchObject({ settlementPending: true });
    expect(h.receipt().usageSettlementAllowsProviders(h.identity)).toBe(false);
  });

  it("delivers an already-produced transcript but durably blocks the next billable call when all Web calls fail", async () => {
    const h = harness();
    const run = vi.fn(async () => ({ text: "Synthetic transcript", duration: 1 }));
    const env = { ...h.env, AI: { run } };
    vi.mocked(commandHostedRuntimeOwner).mockRejectedValue(new Error("synthetic owner endpoint unavailable"));
    vi.mocked(fetchHostedExecutionWebControlPlaneResponse).mockImplementation(async () => {
      expect(h.container.beginRuntimeUsageSettlement).toHaveBeenCalledOnce();
      // Reconstruct from SQLite, as after controller eviction.
      expect(h.receipt().readProviderInvocation()).toMatchObject({ settlementPending: true });
      throw new Error("synthetic settlement endpoint unavailable");
    });
    const transcribe = () => hostedRunnerIntercept(new Request("http://murph-transcribe.worker/v1/transcribe", {
      method: "POST", body: new Uint8Array([1, 2, 3]),
    }), env, caller);
    const first = await transcribe();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ text: "Synthetic transcript" });
    expect(h.receipt().readProviderInvocation()).toMatchObject({ settlementPending: true });
    expect((await transcribe()).status).toBe(503);
    expect(run).toHaveBeenCalledOnce();
    expect(fetchHostedExecutionWebControlPlaneResponse).toHaveBeenCalledOnce();
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation))
      .toEqual(["revoke_ai_usage"]);
  });

  it("rejects mismatched native usage identity before any Web request", async () => {
    const h = harness();
    const request = h.request();
    request.headers.set("x-hosted-runtime-attempt-id", "replaced-attempt");
    await expect(handleRunnerOutboundRequest(request, h.env, h.userId, caller))
      .rejects.toThrow("Native usage settlement receipt was rejected");
    expect(fetchHostedExecutionWebControlPlaneResponse).not.toHaveBeenCalled();
    expect(commandHostedRuntimeOwner).not.toHaveBeenCalled();
  });

  it("clears its pending receipt only after explicit successful settlement", async () => {
    const h = harness();
    vi.mocked(fetchHostedExecutionWebControlPlaneResponse).mockImplementation(async () => {
      expect(h.receipt().usageSettlementAllowsProviders(h.identity)).toBe(false);
      return Response.json({ platformAiUsageAllowedAfter: true, recorded: true, usageId: "synthetic-report" });
    });
    expect((await handleRunnerOutboundRequest(h.request(), h.env, h.userId, caller)).status).toBe(200);
    expect(h.receipt().usageSettlementAllowsProviders(h.identity)).toBe(true);
    expect(fetchHostedExecutionWebControlPlaneResponse).toHaveBeenCalledTimes(1);
    const commands = vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation);
    expect(commands).toEqual([]);
  });
});
