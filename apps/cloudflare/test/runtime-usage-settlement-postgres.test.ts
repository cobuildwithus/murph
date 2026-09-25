import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedRuntimeOwnerSnapshot } from "@murphai/hosted-execution/runtime-owner";
import { createHostedProviderEgressCredential } from "../src/hosted-provider-egress-credential.ts";
import { handleHostedRunnerOpenAiOutbound, handleHostedRunnerLinqOutbound, HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL } from "../src/runner-egress-intercept.ts";
import { handleRunnerOutboundRequest } from "../src/runner-outbound.ts";
import { commandHostedRuntimeOwner } from "../src/runtime-owner-client.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "../src/web-control-plane.ts";
import { RunnerInvocationReceiptStore } from "../src/runner-invocation-receipt.ts";
import { authorizePostgresRuntimeProvider } from "../src/runtime-provider-authorization.ts";
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
  receipt().register(identity);
  const owner: HostedRuntimeOwnerSnapshot = { ...identity, userId, phase: "active", processingMode: "default", allocationId: "standby-claim-11111111-1111-4111-8111-111111111111", runnerContainerName: `runner--v-release_1--${"1".repeat(32)}`, workspaceVersion: "0", customInferenceEnvelope: null, platformAiUsageAllowed: true, startedAt: new Date().toISOString(), acceptedAt: null, completedAt: null, failureCount: 0, lastErrorCode: null };
  const container = {
    beginRuntimeUsageSettlement: vi.fn(async (input: typeof identity & { reportId: string }) => receipt().beginUsageSettlement(input, input.reportId)),
    finishRuntimeUsageSettlement: vi.fn(async (input: typeof identity & { reportId: string; allowed: boolean }) => receipt().finishUsageSettlement(input, input.reportId, input.allowed)),
    runtimeUsageSettlementAllowsProviders: vi.fn(async (input: typeof identity) => receipt().usageSettlementAllowsProviders(input)),
  };
  const env = { ...createHostedExecutionTestEnv(), HOSTED_RUNTIME_POSTGRES_ENABLED: "true", BUNDLES: new MemoryEncryptedR2Bucket(), RUNNER_CONTAINER: { getByName: () => container }, USER_RUNNER: { getByName() { throw new Error("Unexpected UserRunner activation"); } } };
  vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({ cutover: "postgres", status: "authorized", owner });
  const request = (body: unknown = { usage: { usageId: "synthetic-report" } }) => new Request(`${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane}${HOSTED_RUNNER_WEB_CONTROL_ROUTES.usageRecording.path}`, { method: "POST", headers: {
    "content-type": "application/json", "x-hosted-runtime-attempt-id": identity.attemptId, "x-hosted-runtime-lease-generation": identity.generation, "x-hosted-runtime-workspace-version": "0",
  }, body: JSON.stringify(body) });
  return { userId, identity, receipt, owner, env, request, container };
}

describe("Postgres usage settlement with native receipts", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it.each(["token", "headers"])("authorizes typing with %s in one Web round trip", async proof => {
    const h = harness();
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    const headers = new Headers({ authorization: `Bearer ${HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL}`,
      "x-hosted-runner-bound-user-id": h.userId });
    if (proof === "token") headers.set("x-hosted-provider-egress-token", "synthetic-token");
    else {
      headers.set("x-hosted-runtime-attempt-id", h.identity.attemptId);
      headers.set("x-hosted-runtime-lease-generation", h.identity.generation);
      headers.set("x-hosted-runtime-workspace-version", "0");
    }
    const response = await handleHostedRunnerLinqOutbound(new Request("https://api.linqapp.com/api/partner/v3/chats/synthetic-chat/typing", {
      method: "POST", headers,
    }), { ...h.env, LINQ_API_TOKEN: "synthetic-worker-secret" }, { containerId: "synthetic-container", waitUntil() {} });
    expect(response.status).toBe(204);
    expect(commandHostedRuntimeOwner).toHaveBeenCalledTimes(1);
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls[0]?.[0].command.operation)
      .toBe(proof === "token" ? "authorize_provider" : "authorize_effect");
    expect(upstream).toHaveBeenCalledTimes(1);
    const forwarded = upstream.mock.calls[0]?.[0];
    if (!(forwarded instanceof Request)) throw new Error("Expected forwarded provider request");
    expect(forwarded.headers.get("authorization")).toBe("Bearer synthetic-worker-secret");
    expect(h.container.runtimeUsageSettlementAllowsProviders).not.toHaveBeenCalled();
  });

  it.each([false, true])("authenticates native provider credentials once and preserves the spending latch (denied=%s)", async denied => {
    const h = harness();
    const env = { ...h.env, OPENAI_API_KEY: "synthetic-provider-secret",
      HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET: "synthetic-provider-signing-secret-0123456789" };
    const credential = await createHostedProviderEgressCredential({ source: env, userId: h.userId,
      providerKind: "openai", runnerContainerName: h.owner.runnerContainerName! });
    if (denied) {
      h.receipt().beginUsageSettlement(h.identity, "synthetic-denied-report");
      h.receipt().finishUsageSettlement(h.identity, "synthetic-denied-report", false);
    }
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "synthetic-response" }));
    const response = await handleHostedRunnerOpenAiOutbound(new Request("https://api.openai.com/v1/responses", {
      method: "POST", headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5", input: "Synthetic request" }),
    }), env, { containerId: "synthetic-container", waitUntil() {} });
    expect(response.status).toBe(denied ? 503 : 200);
    expect(commandHostedRuntimeOwner).toHaveBeenCalledTimes(1);
    expect(upstream).toHaveBeenCalledTimes(denied ? 0 : 1);
    expect(h.container.runtimeUsageSettlementAllowsProviders).toHaveBeenCalledTimes(1);
  });

  it.each(["legacy", "draining", "postgres"] as const)("rejects blocked authorization without legacy fallback (%s)", async cutover => {
    const h = harness();
    vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({ cutover, status: "blocked", owner: null });
    const result = await authorizePostgresRuntimeProvider({ env: h.env, userId: h.userId, managed: false,
      command: { operation: "authorize_provider", runnerContainerName: null, providerEgressTokenHash: "f".repeat(64), providerKind: "linq" } });
    expect(result).toBeNull();
    expect(commandHostedRuntimeOwner).toHaveBeenCalledTimes(1);
    expect(h.container.runtimeUsageSettlementAllowsProviders).not.toHaveBeenCalled();
  });

  it.each([{}, { usage: null }, { usage: "invalid" }])("rejects malformed usage envelopes before settlement admission", async body => {
    const h = harness();
    expect((await handleRunnerOutboundRequest(h.request(body), h.env, h.userId)).status).toBe(400);
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
    await expect(handleRunnerOutboundRequest(h.request(), h.env, h.userId)).rejects.toThrow("synthetic Web outage");
    const provider = await authorizePostgresRuntimeProvider({ env: h.env, userId: h.userId, managed: true, command: { operation: "authorize_effect", ...h.identity, runnerContainerName: h.owner.runnerContainerName, managedAi: false } });
    expect(provider).toMatchObject({ settlementPending: true });
    expect(h.receipt().usageSettlementAllowsProviders(h.identity)).toBe(false);
  });

  it("clears its pending receipt only after explicit successful settlement", async () => {
    const h = harness();
    vi.mocked(fetchHostedExecutionWebControlPlaneResponse).mockImplementation(async () => {
      expect(h.receipt().usageSettlementAllowsProviders(h.identity)).toBe(false);
      return Response.json({ platformAiUsageAllowedAfter: true, recorded: true, usageId: "synthetic-report" });
    });
    expect((await handleRunnerOutboundRequest(h.request(), h.env, h.userId)).status).toBe(200);
    expect(h.receipt().usageSettlementAllowsProviders(h.identity)).toBe(true);
    expect(fetchHostedExecutionWebControlPlaneResponse).toHaveBeenCalledTimes(1);
    const commands = vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation);
    expect(commands).toEqual(["authorize_effect"]);
  });
});
