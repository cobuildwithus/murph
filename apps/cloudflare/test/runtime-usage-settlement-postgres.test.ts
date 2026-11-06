import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedRuntimeOwnerSnapshot } from "@murphai/hosted-execution/runtime-owner";
import type { AssistantUsageRecord } from "@murphai/hosted-execution/assistant-usage";
import { createHostedRuntimeVoiceCall } from "@murphai/assistant-runtime/hosted-invocation";
import { hostedRunnerIntercept, handleHostedRunnerOpenAiOutbound, handleHostedRunnerLinqOutbound, HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL } from "../src/runner-egress-intercept.ts";
import { handleRunnerOutboundRequest } from "../src/runner-outbound.ts";
import { commandHostedRuntimeOwner } from "../src/runtime-owner-client.ts";
import { fetchHostedExecutionWebControlPlaneResponse } from "../src/web-control-plane.ts";
import { RunnerInvocationReceiptStore } from "../src/runner-invocation-receipt.ts";
import { RunnerContainer } from "../src/runner-container.ts";
import { RunnerSlotBindingStore } from "../src/runner-slot-binding.ts";
import { createHostedRuntimeUsageRecordPort } from "../src/runtime-platform/usage-record-port.ts";
import { createCloudflareHostedInternalFetch } from "../src/runtime-platform/provider-fetch.ts";
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
  const binding = new RunnerSlotBindingStore(sql);
  const slot = { slotName: owner.runnerContainerName!, releaseId: "release_1", region: "GLOBAL" as const };
  binding.initialize(slot);
  binding.bind({ ...slot, userId, claimId: owner.allocationId! });
  const create = () => new RunnerContainer({
    id: { name: slot.slotName }, storage: { sql }, waitUntil: () => {},
  }, { CF_VERSION_METADATA: { id: "release_1" } });
  const container = {
    beginRuntimeUsageSettlement: vi.fn((input: Parameters<RunnerContainer["beginRuntimeUsageSettlement"]>[0]) => create().beginRuntimeUsageSettlement(input)),
    finishRuntimeUsageSettlement: vi.fn((input: Parameters<RunnerContainer["finishRuntimeUsageSettlement"]>[0]) => create().finishRuntimeUsageSettlement(input)),
    readProviderAuthority: vi.fn(() => create().readProviderAuthority()),
  };
  const env = { ...createHostedExecutionTestEnv(), HOSTED_RUNTIME_POSTGRES_ENABLED: "true", BUNDLES: new MemoryEncryptedR2Bucket(), RUNNER_CONTAINER: { getByName: () => container, get: () => container, idFromString: (id: string) => id }, USER_RUNNER: { getByName() { throw new Error("Unexpected UserRunner activation"); } } };
  vi.mocked(commandHostedRuntimeOwner).mockResolvedValue({ cutover: "postgres", status: "authorized", owner });
  const request = (body: unknown = { usage: { usageId: "synthetic-report" } }) => new Request(`${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane}${HOSTED_RUNNER_WEB_CONTROL_ROUTES.usageRecording.path}`, { method: "POST", headers: {
    "content-type": "application/json", "x-hosted-runtime-attempt-id": identity.attemptId, "x-hosted-runtime-lease-generation": identity.generation, "x-hosted-runtime-workspace-version": "0",
  }, body: JSON.stringify(body) });
  const metered = () => handleHostedRunnerOpenAiOutbound(new Request("https://api.openai.com/v1/responses", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "synthetic-model", input: "Synthetic request" }),
  }), { ...env, OPENAI_API_KEY: "synthetic-provider-secret" }, caller);
  return { userId, identity, sql, receipt, owner, env, request, container, metered };
}

const caller = { containerId: "synthetic-container", className: "RunnerContainer" };

describe("Provider identity and usage settlement with native receipts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchHostedExecutionWebControlPlaneResponse).mockReset();
  });
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

  it("persists denial before revocation when settlement and revocation are unavailable", async () => {
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
    expect(h.container.finishRuntimeUsageSettlement).toHaveBeenCalledExactlyOnceWith({ ...h.identity, userId: h.userId, reportId: "synthetic-report", allowed: false });
    expect(h.sql.exec("SELECT state FROM runner_usage_settlement").toArray()).toEqual([{ state: "denied" }]);
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

  it.each([true, false])("keeps denial durable when a usage report races (first allowed=%s)", async firstAllowed => {
    const h = harness();
    let answerFirst!: (response: Response) => void;
    let answerSecond!: (response: Response) => void;
    let markBothForwarded!: () => void;
    const firstResponse = new Promise<Response>(resolve => { answerFirst = resolve; });
    const secondResponse = new Promise<Response>(resolve => { answerSecond = resolve; });
    const bothForwarded = new Promise<void>(resolve => { markBothForwarded = resolve; });
    vi.mocked(fetchHostedExecutionWebControlPlaneResponse)
      .mockImplementationOnce(() => firstResponse)
      .mockImplementationOnce(() => { markBothForwarded(); return secondResponse; });
    const first = handleRunnerOutboundRequest(h.request(), h.env, h.userId, caller);
    const second = handleRunnerOutboundRequest(h.request(), h.env, h.userId, caller);
    await bothForwarded;
    expect(h.container.beginRuntimeUsageSettlement).toHaveBeenCalledTimes(2);
    answerFirst(Response.json({ platformAiUsageAllowedAfter: firstAllowed, recorded: true, usageId: "synthetic-report" }));
    expect((await first).status).toBe(200);
    expect(h.receipt().usageSettlementAllowsProviders(h.identity)).toBe(firstAllowed);
    answerSecond(Response.json({ platformAiUsageAllowedAfter: !firstAllowed, recorded: true, usageId: "synthetic-report" }));
    expect((await second).status).toBe(200);
    expect(h.container.finishRuntimeUsageSettlement.mock.calls.map(([input]) => input.allowed)).toEqual([firstAllowed, !firstAllowed]);
    expect(h.receipt().usageSettlementAllowsProviders(h.identity)).toBe(false);
    expect(h.receipt().readProviderInvocation()).toMatchObject({ settlementPending: true });
    expect(vi.mocked(commandHostedRuntimeOwner).mock.calls.map(([input]) => input.command.operation)).toEqual(["revoke_ai_usage"]);
    const upstream = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Must not reach provider"));
    const provider = await handleHostedRunnerOpenAiOutbound(new Request("https://api.openai.com/v1/responses", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "synthetic-model", input: "Synthetic request" }),
    }), { ...h.env, OPENAI_API_KEY: "synthetic-provider-secret" }, caller);
    expect(provider.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("exposes the unsafe pairing of the new Worker with the pre-4646 update-only controller", async () => {
    const h = harness();
    const finish = h.container.finishRuntimeUsageSettlement.getMockImplementation()!;
    h.container.finishRuntimeUsageSettlement.mockImplementation(async input => {
      if (input.allowed) return finish(input);
      h.sql.exec("UPDATE runner_usage_settlement SET state = 'denied' WHERE report_id = ? AND attempt_id = ? AND generation = ?", input.reportId, input.attemptId, input.generation);
    });
    let answerFirst!: (response: Response) => void;
    let loseSecond!: (error: Error) => void;
    let markBothForwarded!: () => void;
    const firstResponse = new Promise<Response>(resolve => { answerFirst = resolve; });
    const secondResponse = new Promise<Response>((_resolve, reject) => { loseSecond = reject; });
    const bothForwarded = new Promise<void>(resolve => { markBothForwarded = resolve; });
    vi.mocked(fetchHostedExecutionWebControlPlaneResponse)
      .mockImplementationOnce(() => firstResponse)
      .mockImplementationOnce(() => { markBothForwarded(); return secondResponse; });
    const first = handleRunnerOutboundRequest(h.request(), h.env, h.userId, caller);
    const second = handleRunnerOutboundRequest(h.request(), h.env, h.userId, caller);
    await bothForwarded;
    answerFirst(Response.json({ platformAiUsageAllowedAfter: true, recorded: true, usageId: "synthetic-report" }));
    expect((await first).status).toBe(200);
    expect(h.sql.exec("SELECT state FROM runner_usage_settlement").toArray()).toEqual([]);
    const rejected = expect(second).rejects.toThrow("synthetic response lost");
    loseSecond(new Error("synthetic response lost"));
    await rejected;
    expect(h.container.finishRuntimeUsageSettlement.mock.calls.map(([input]) => input.allowed)).toEqual([true, false]);
    expect(commandHostedRuntimeOwner).toHaveBeenCalledExactlyOnceWith({ source: h.env, userId: h.userId,
      command: { operation: "revoke_ai_usage", userId: h.userId, ...h.identity } });
    expect(h.receipt().usageSettlementAllowsProviders(h.identity)).toBe(true);
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "synthetic-response" }));
    expect((await h.metered()).status).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();
  });

  it("keeps native denial after a voice close replays the immutable record whose Web response was lost", async () => {
    const h = harness();
    const ledger = new Map<string, AssistantUsageRecord>();
    const forwarded: Array<{ usage: AssistantUsageRecord }> = [];
    vi.mocked(fetchHostedExecutionWebControlPlaneResponse).mockImplementation(async input => {
      const body = JSON.parse(input.body!) as { usage: AssistantUsageRecord };
      forwarded.push(body);
      ledger.set(body.usage.usageId, body.usage);
      if (forwarded.length === 1) throw new Error("synthetic response lost after accounting");
      return Response.json({ platformAiUsageAllowedAfter: true, recorded: true, usageId: body.usage.usageId });
    });
    const usagePort = createHostedRuntimeUsageRecordPort({
      boundUserId: h.userId, timeoutMs: 10_000, transport: { mode: "proxy" },
      fetchImpl: createCloudflareHostedInternalFetch(h.userId,
        async (input, init) => handleRunnerOutboundRequest(new Request(input, init), h.env, h.userId, caller),
        { readCurrentLease: () => ({ userId: h.userId, attemptId: h.identity.attemptId, leaseGeneration: h.identity.generation, workspaceVersion: "0" }) }),
    });
    type StartVoice = Parameters<ReturnType<typeof createHostedRuntimeVoiceCall>["connect"]>[1];
    const closure = { providerConfirmed: true, providerSessionId: "synthetic-session", seconds: 2 };
    let markStopped!: () => void;
    const stopped = new Promise<void>(resolve => { markStopped = resolve; });
    const native = {
      sdp: "synthetic-answer", closed: new Promise<typeof closure>(() => {}),
      speak: vi.fn(async () => {}), close: vi.fn(async () => { markStopped(); return closure; }),
    };
    const start = vi.fn<StartVoice>(async () => native);
    const onError = vi.fn();
    const call = createHostedRuntimeVoiceCall({
      callId: "synthetic-call", memberId: h.userId, signal: new AbortController().signal,
      usagePort, admitInput: async () => ({ mailboxItemId: "synthetic-mailbox" }), notifyRuntime: () => {}, onError,
    });
    try {
      await call.connect("synthetic-offer", start);
      start.mock.calls[0]![0].onUsage!(2);
      await stopped;
      await call.close();
      expect(native.close).toHaveBeenCalledOnce();
      expect(onError).not.toHaveBeenCalled();
      expect(forwarded).toHaveLength(2);
      expect(forwarded[1]!.usage).toEqual(forwarded[0]!.usage);
      expect(ledger.size).toBe(1);
      expect(commandHostedRuntimeOwner).toHaveBeenCalledExactlyOnceWith({ source: h.env, userId: h.userId,
        command: { operation: "revoke_ai_usage", userId: h.userId, ...h.identity } });
      expect(h.sql.exec("SELECT state FROM runner_usage_settlement").toArray()).toEqual([{ state: "denied" }]);
      const upstream = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Must not reach provider"));
      expect((await h.metered()).status).toBe(503);
      expect(upstream).not.toHaveBeenCalled();
    } finally {
      await call.close();
    }
  });

  it.each(["thrown forward", "non-OK response", "unparseable OK response"])("writes native denial before revoking Web after %s", async shape => {
    const h = harness();
    vi.mocked(fetchHostedExecutionWebControlPlaneResponse).mockImplementation(async () => {
      if (shape === "thrown forward") throw new Error("synthetic response lost");
      return new Response("unreadable", { status: shape === "non-OK response" ? 503 : 200 });
    });
    vi.mocked(commandHostedRuntimeOwner).mockImplementation(async input => {
      expect(input.command).toEqual({ operation: "revoke_ai_usage", userId: h.userId, ...h.identity });
      expect(h.sql.exec("SELECT state FROM runner_usage_settlement").toArray()).toEqual([{ state: "denied" }]);
      return { cutover: "postgres", status: "updated", owner: h.owner };
    });
    const delivery = handleRunnerOutboundRequest(h.request(), h.env, h.userId, caller);
    if (shape === "thrown forward") await expect(delivery).rejects.toThrow("synthetic response lost");
    else expect((await delivery).status).toBe(shape === "non-OK response" ? 503 : 200);
    expect(commandHostedRuntimeOwner).toHaveBeenCalledOnce();
  });

  it("propagates a failed native denial without revoking Web and lets a later replay settle pending evidence", async () => {
    const h = harness();
    const denialFailure = new Error("synthetic denial RPC unavailable");
    h.container.finishRuntimeUsageSettlement.mockRejectedValueOnce(denialFailure);
    vi.mocked(fetchHostedExecutionWebControlPlaneResponse)
      .mockRejectedValueOnce(new Error("synthetic response lost"))
      .mockResolvedValueOnce(Response.json({ platformAiUsageAllowedAfter: true, recorded: true, usageId: "synthetic-report" }));
    await expect(handleRunnerOutboundRequest(h.request(), h.env, h.userId, caller)).rejects.toBe(denialFailure);
    expect(commandHostedRuntimeOwner).not.toHaveBeenCalled();
    expect(h.sql.exec("SELECT state FROM runner_usage_settlement").toArray()).toEqual([{ state: "pending" }]);
    expect((await handleRunnerOutboundRequest(h.request(), h.env, h.userId, caller)).status).toBe(200);
    expect(h.sql.exec("SELECT state FROM runner_usage_settlement").toArray()).toEqual([]);
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "synthetic-response" }));
    expect((await h.metered()).status).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();
    expect(commandHostedRuntimeOwner).not.toHaveBeenCalled();
  });

  it.each([true, false])("keeps unknown denial durable across a racing success and another replay (success first=%s)", async successFirst => {
    const h = harness();
    let succeed!: (response: Response) => void;
    let lose!: (error: Error) => void;
    let markBothForwarded!: () => void;
    const success = new Promise<Response>(resolve => { succeed = resolve; });
    const lost = new Promise<Response>((_resolve, reject) => { lose = reject; });
    const bothForwarded = new Promise<void>(resolve => { markBothForwarded = resolve; });
    vi.mocked(fetchHostedExecutionWebControlPlaneResponse)
      .mockImplementationOnce(() => successFirst ? success : lost)
      .mockImplementationOnce(() => { markBothForwarded(); return successFirst ? lost : success; });
    const first = handleRunnerOutboundRequest(h.request(), h.env, h.userId, caller);
    const second = handleRunnerOutboundRequest(h.request(), h.env, h.userId, caller);
    const rejected = expect(successFirst ? second : first).rejects.toThrow("synthetic response lost");
    await bothForwarded;
    const answer = () => succeed(Response.json({ platformAiUsageAllowedAfter: true, recorded: true, usageId: "synthetic-report" }));
    if (successFirst) {
      answer();
      expect((await first).status).toBe(200);
      expect(h.sql.exec("SELECT state FROM runner_usage_settlement").toArray()).toEqual([]);
    }
    lose(new Error("synthetic response lost"));
    await rejected;
    expect(h.sql.exec("SELECT state FROM runner_usage_settlement").toArray()).toEqual([{ state: "denied" }]);
    if (!successFirst) {
      answer();
      expect((await second).status).toBe(200);
    }
    const upstream = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Must not reach provider"));
    expect((await h.metered()).status).toBe(503);
    vi.mocked(fetchHostedExecutionWebControlPlaneResponse).mockResolvedValueOnce(Response.json({ platformAiUsageAllowedAfter: true, recorded: true, usageId: "synthetic-report" }));
    expect((await handleRunnerOutboundRequest(h.request(), h.env, h.userId, caller)).status).toBe(200);
    expect(h.sql.exec("SELECT state FROM runner_usage_settlement").toArray()).toEqual([{ state: "denied" }]);
    expect((await h.metered()).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
    expect(commandHostedRuntimeOwner).toHaveBeenCalledExactlyOnceWith({ source: h.env, userId: h.userId,
      command: { operation: "revoke_ai_usage", userId: h.userId, ...h.identity } });
  });

  it("fences a lost old-generation response from the next generation's native authority", async () => {
    const h = harness();
    let lose!: (error: Error) => void;
    let markForwarded!: () => void;
    const held = new Promise<Response>((_resolve, reject) => { lose = reject; });
    const forwarded = new Promise<void>(resolve => { markForwarded = resolve; });
    vi.mocked(fetchHostedExecutionWebControlPlaneResponse).mockImplementationOnce(() => { markForwarded(); return held; });
    const delivery = handleRunnerOutboundRequest(h.request(), h.env, h.userId, caller);
    const rejected = expect(delivery).rejects.toThrow("synthetic response lost");
    await forwarded;
    const next = { attemptId: "synthetic-next-attempt", generation: "2" };
    h.receipt().complete(h.identity, false);
    h.receipt().register(next, { workspaceVersion: "0", platformAiUsageAllowed: true });
    lose(new Error("synthetic response lost"));
    await rejected;
    expect(h.container.finishRuntimeUsageSettlement).toHaveBeenCalledExactlyOnceWith({ ...h.identity, userId: h.userId, reportId: "synthetic-report", allowed: false });
    expect(h.sql.exec("SELECT state FROM runner_usage_settlement").toArray()).toEqual([]);
    expect(h.receipt().usageSettlementAllowsProviders(next)).toBe(true);
    expect(commandHostedRuntimeOwner).toHaveBeenCalledExactlyOnceWith({ source: h.env, userId: h.userId,
      command: { operation: "revoke_ai_usage", userId: h.userId, ...h.identity } });
    expect(await readNativeRuntimeProviderAuthority(h.env, caller)).toMatchObject(next);
    const upstream = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ id: "synthetic-response" }));
    expect((await h.metered()).status).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();
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
