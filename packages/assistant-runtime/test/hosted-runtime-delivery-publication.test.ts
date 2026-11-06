import {
  createDueAssistantWorkspace, createPhaseInput, mocks,
  runHostedWorkspaceAssistantPhase, runHostedWorkspaceDurableCheckpointEffects,
} from "./hosted-runtime-workspace-assistant-phase.harness.ts";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeVault, readMemoryDocument, registerAutomationFollowUp, upsertMemory } from "@murphai/core";
import { listAutomations } from "@murphai/query";
import {
  createAssistantOutboxIntent, listAssistantOutboxIntents, readAssistantOutboxIntent,
  requestAssistantVaultFileSend,
} from "@murphai/assistant-engine/assistant-outbox";
import { DAILY_NUTRITION_OPTIONAL_GOALS_INTRO } from "@murphai/operator-config/assistant-response-cards";
import { buildHostedExecutionRuntimeTimerWake } from "@murphai/hosted-execution";
import { buildHostedActionApprovalCycleOwnerKey, buildHostedActionApprovalOutcomeEffectId } from "@murphai/hosted-execution/action-approval";
import { HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON } from "@murphai/hosted-execution/orchestration-control";
import { serializeHostedEmailThreadTarget } from "@murphai/runtime-state";
import type { HostedRuntimeActionApprovalPort } from "../src/hosted-runtime/platform.ts";
import { createHostedRuntimeEffectsPortStub } from "./hosted-runtime-test-helpers.ts";

vi.mock("@murphai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@murphai/core")>();
  return { ...actual, registerAutomationFollowUp: vi.fn(actual.registerAutomationFollowUp), upsertMemory: vi.fn(actual.upsertMemory) };
});

const roots: string[] = [];
const callbacks = await vi.importActual<typeof import("../src/hosted-runtime/callbacks.ts")>("../src/hosted-runtime/callbacks.ts");
const NOW = "2026-09-04T12:00:00.000Z";
const followUpRequest = { afterMinutes: 15, instructions: "Check whether the requested task is complete." };
type Channel = "telegram" | "email" | "linq";
type Entry = "foreground" | "general";
type IntentInput = Parameters<typeof createAssistantOutboxIntent>[0];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  mocks.readAssistantOutboxIntent.mockImplementation(readAssistantOutboxIntent);
  mocks.collectHostedAssistantDeliverySideEffects.mockImplementation(callbacks.collectHostedAssistantDeliverySideEffects);
  mocks.prepareHostedAssistantDeliveryEffectsForDispatch.mockImplementation(callbacks.prepareHostedAssistantDeliveryEffectsForDispatch);
  mocks.drainHostedPreparedAssistantDeliveries.mockImplementation(callbacks.drainHostedPreparedAssistantDeliveries);
  mocks.resetHostedPreparedAssistantDeliveryEffects.mockImplementation(callbacks.resetHostedPreparedAssistantDeliveryEffects);
  mocks.resolveHostedAssistantOutboxNextWakeAt.mockImplementation(callbacks.resolveHostedAssistantOutboxNextWakeAt);
  vi.mocked(registerAutomationFollowUp).mockClear();
  vi.mocked(upsertMemory).mockClear();
});
afterEach(async () => {
  await callbacks.drainHostedAssistantDeliveryControlPlaneWritesBestEffort();
  vi.useRealTimers();
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true });
});

async function fixture(channel: Channel, options: Partial<IntentInput> = {}) {
  const root = await mkdtemp(path.join(process.env.MURPH_VITEST_TEMP_ROOT!, "delivery-publication-"));
  roots.push(root);
  const vaultRoot = path.join(root, "vault");
  const snapshot = path.join(root, "snapshot");
  await initializeVault({ vaultRoot, createdAt: NOW });
  const target = channel === "telegram" ? "123" : channel === "email" ? "member@example.test" : "linq_chat_publication";
  const base: IntentInput = {
    bindingDelivery: { kind: "thread", target }, channel,
    ...(channel === "email" ? { explicitTarget: target } : {}),
    deliveryTransportIdempotent: channel === "linq", dedupeToken: "publication-first",
    message: "Here is the requested reply.", sessionId: "session_publication",
    threadId: target, threadIsDirect: true, turnId: "turn_publication", vault: vaultRoot,
    answeredMailboxItemIds: ["mailbox_publication"],
    ...options,
  };
  const intent = await createAssistantOutboxIntent(base);
  const wireKeys: string[] = [];
  const visibleReplies = new Set<string>();
  const consumed = new Set<string>();
  const sendEmail = vi.fn<ReturnType<typeof createHostedRuntimeEffectsPortStub>["sendEmail"]>(async () => ({ target }));
  const providerFetch = vi.fn<typeof fetch>(async (url, init) => {
    if (channel === "telegram") return Response.json({ ok: true, result: { message_id: 7, chat: { id: 123 } } });
    if (String(url).includes("/typing")) return Response.json({});
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
    const key: string = body.message?.idempotency_key ?? "missing";
    wireKeys.push(key);
    visibleReplies.add(key);
    return Response.json({ message: { id: "linq_message_publication", chat_id: target } });
  });
  const recordLinqDeliveryOutcome = vi.fn<NonNullable<ReturnType<typeof createHostedRuntimeEffectsPortStub>["recordLinqDeliveryOutcome"]>>(async (request) => {
    if (request.acceptedAt) for (const id of request.answeredMailboxItemIds ?? []) consumed.add(id);
  });
  const effectsPort = createHostedRuntimeEffectsPortStub({
    sendEmail, recordLinqDeliveryOutcome, resolveCurrentVerifiedEmailRecipient: async () => "member@example.test",
  });
  const linqDeliveryContext = {
    directRecipientPhoneNumber: null, fromPhoneNumber: null, replyToMessageId: null,
    routeAuthority: null, service: "iMessage", target, threadIsDirect: true,
  };
  const env = { TELEGRAM_BOT_TOKEN: "synthetic-token", LINQ_API_TOKEN: "synthetic-token" };
  let checkpointedAt: string | null = null;
  let actionApprovalPort: HostedRuntimeActionApprovalPort | undefined;
  let signal: AbortSignal | undefined;
  const collect = (preferredIntentIds: string[] = [], preferredEffectIds: string[] = []) => callbacks.collectHostedAssistantDeliverySideEffects({
    actionApprovalPort, includeBackgroundDueIntents: true, preferredIntentIds, preferredEffectIds, vaultRoot,
    workspace: { checkpointedAt },
  });
  const drain = async (selected?: Awaited<ReturnType<typeof collect>>, prepare = true) => {
    const effects = selected ?? await collect();
    const preparation = prepare ? await callbacks.prepareHostedAssistantDeliveryEffectsForDispatch({ assistantDeliveryEffects: effects, linqDeliveryContext, vaultRoot }) : null;
    return callbacks.drainHostedPreparedAssistantDeliveries({
      actionApprovalPort, assistantDeliveryEffects: effects, effectsPort, forwardedEnv: env,
      linqDeliveryContext, platformEnv: {}, providerFetch, publicInternetFetch: providerFetch, vaultRoot,
      ...(preparation ? { allowPreparedSending: true, preparedDispatches: preparation.preparedDispatches } : {}),
      wake: buildHostedExecutionRuntimeTimerWake({ eventId: "evt_publication", occurredAt: new Date().toISOString(), triggerKind: "runtime_timer", userId: "member_synthetic_phase" }),
    });
  };
  const read = async (id = intent.intentId) => {
    const current = await readAssistantOutboxIntent(vaultRoot, id);
    if (!current) throw new Error("Missing publication proof intent");
    return current;
  };
  const retry = async () => {
    const originalFetch = providerFetch.getMockImplementation()!;
    if (channel === "telegram") providerFetch.mockImplementation(async () => Response.json({ ok: false, error_code: 429, parameters: { retry_after: 0.001 } }, { status: 429 }));
    else sendEmail.mockRejectedValueOnce(Object.assign(new Error("Synthetic definitive rejection"), { deliveryMayHaveSucceeded: false, retryable: true }));
    expect(await drain()).toEqual([expect.objectContaining({ deliveryStatus: "retryable" })]);
    const current = await read();
    expect(current.status).toBe("retryable");
    vi.setSystemTime(new Date(current.nextAttemptAt!));
    providerFetch.mockImplementation(originalFetch);
    providerFetch.mockClear(); sendEmail.mockClear();
  };
  const phase = async (entry: Entry = "general", preferredIntentIds: string[] = [], shouldYield?: () => boolean) => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValue({
      assistantAutomationCurrentTurnDeliveryIntentIds: entry === "foreground" ? preferredIntentIds : [],
      assistantAutomationProgressed: preferredIntentIds.length > 0,
      nextWakeAt: null, redactedLogEntries: [],
    });
    const input = createPhaseInput({
      importedCount: entry === "foreground" ? 1 : 0,
      now: () => new Date().toISOString(), operatorHomeRoot: path.join(root, "home"), vaultRoot,
      runtimeActionApprovalPort: actionApprovalPort, runtimeForwardedEnv: env, linqDeliveryContext,
      shouldYieldBackgroundMaintenance: shouldYield,
      signal,
      workspace: createDueAssistantWorkspace({ checkpointedAt, nextWakeAt: entry === "general" && preferredIntentIds.length > 0 ? null : new Date().toISOString(), nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON }),
    });
    input.runtime.platform.providerFetch = providerFetch;
    input.runtime.platform.effectsPort = effectsPort;
    input.platform.effectsPort = effectsPort;
    const result = await runHostedWorkspaceAssistantPhase(input);
    const callsBeforeLocalCheckpoint = providerFetch.mock.calls.length + sendEmail.mock.calls.length;
    const post = await result.afterCheckpoint?.();
    return { result, post, callsBeforeLocalCheckpoint };
  };
  return {
    root, vaultRoot, snapshot, intent, base, collect, drain, read, retry, phase, providerFetch, sendEmail,
    recordLinqDeliveryOutcome, wireKeys, visibleReplies, consumed,
    setApproval: (port: HostedRuntimeActionApprovalPort) => { actionApprovalPort = port; },
    setSignal: (value?: AbortSignal) => { signal = value; },
    setCheckpoint: (at: string) => { checkpointedAt = at; },
    publish: async () => { await rm(snapshot, { force: true, recursive: true }); await cp(vaultRoot, snapshot, { recursive: true }); },
    restore: async () => { await rm(vaultRoot, { recursive: true }); await cp(snapshot, vaultRoot, { recursive: true }); },
    sends: () => channel === "email" ? sendEmail.mock.calls.length : providerFetch.mock.calls.filter(([url]) => !String(url).includes("/typing")).length,
  };
}

describe.each(["telegram", "email"] as const)("%s publication", (channel) => {
  it.each(["retryable", "durable pending"] as const)("publishes the exact %s claim before sending and never resends after restore", async (state) => {
    const f = await fixture(channel);
    if (state === "retryable") await f.retry();
    else { f.setCheckpoint(NOW); expect((await f.read()).attemptCount).toBe(0); }
    const { post } = await f.phase();
    expect(f.sends()).toBe(0);
    expect(post?.afterDurableCheckpoint).toBeDefined();
    const hooks = post?.afterDurableCheckpoint;
    expect((typeof hooks === "function" ? [hooks] : hooks)?.map((hook) => hook.checkpointStartByMs)).toContain(Date.now() + callbacks.HOSTED_PUBLISHED_CLAIM_MAX_WAIT_MS);
    expect(await f.read()).toMatchObject({ status: "sending", preparedDispatchToken: expect.any(String) });
    expect(await callbacks.resolveHostedAssistantOutboxNextWakeAt({ vaultRoot: f.vaultRoot })).toBe(new Date(Date.now() + 120_000).toISOString());
    await f.publish(); // A blocked publication never invokes the durable callback.
    expect(f.sends()).toBe(0);
    await runHostedWorkspaceDurableCheckpointEffects(post?.afterDurableCheckpoint);
    expect(f.sends()).toBe(1);
    expect((await f.read()).status).toBe("sent");
    await f.restore();
    vi.setSystemTime(new Date(Date.now() + 600_000));
    await f.phase();
    expect(f.sends()).toBe(1);
    expect(await f.read()).toMatchObject({ status: "failed", lastError: { code: "ASSISTANT_DELIVERY_AMBIGUOUS" } });
  });

  it.each(["foreground", "general"] as const)("adds zero publications to a fresh first send through %s", async (entry) => {
    const f = await fixture(channel);
    expect(await f.collect([f.intent.intentId])).toEqual([expect.not.objectContaining({ publishBeforeDispatch: true })]);
    const { result, post } = await f.phase(entry, [f.intent.intentId]);
    expect(result.afterCheckpoint).toBeTypeOf("function"); // Existing local dirty-state hook only.
    expect(post?.afterDurableCheckpoint).toBeUndefined();
    expect(f.sends()).toBe(1);
    expect((await f.read()).status).toBe("sent");
  });

  it("settles a confirmation-only retry without a fence or another provider call", async () => {
    const f = await fixture(channel, { followUpRequest });
    vi.mocked(registerAutomationFollowUp).mockRejectedValueOnce(new Error("Synthetic settlement unavailable"));
    await f.drain();
    expect(await f.read()).toMatchObject({ status: "retryable", deliveryConfirmationPending: true, delivery: expect.any(Object) });
    vi.setSystemTime(new Date((await f.read()).nextAttemptAt!));
    expect(await f.collect()).toEqual([expect.not.objectContaining({ publishBeforeDispatch: true })]);
    const { post } = await f.phase();
    expect(post?.afterDurableCheckpoint).toBeUndefined();
    expect(f.sends()).toBe(1);
    expect((await f.read()).status).toBe("sent");
    expect(await listAutomations(f.vaultRoot)).toHaveLength(1);
  });
});

it("does not dispatch a marked effect without its prepared token", async () => {
  const f = await fixture("telegram");
  const effects = (await f.collect()).map((effect) => ({ ...effect, publishBeforeDispatch: true as const }));
  expect(await f.drain(effects, false)).toEqual([expect.objectContaining({ deliveryStatus: "pending", retryable: true })]);
  expect(f.sends()).toBe(0);
  expect(await f.read()).toMatchObject({ status: "pending", attemptCount: 0, preparedDispatchToken: null });
});

it("resets the exact prepared retry when the durable hook yields before provider entry", async () => {
  const f = await fixture("telegram");
  await f.retry();
  const before = await f.read();
  let yieldNow = false;
  const { post } = await f.phase("general", [], () => yieldNow);
  expect(post?.afterDurableCheckpoint).toBeDefined();
  expect(await f.read()).toMatchObject({ status: "sending", preparedDispatchToken: expect.any(String) });
  yieldNow = true;
  await runHostedWorkspaceDurableCheckpointEffects(post?.afterDurableCheckpoint);
  expect(f.sends()).toBe(0);
  expect(await f.read()).toMatchObject({ status: before.status, attemptCount: before.attemptCount, lastAttemptAt: before.lastAttemptAt, preparedDispatchToken: null });
  yieldNow = false;
  const later = await f.phase();
  expect(await f.read()).toMatchObject({ status: "sending", preparedDispatchToken: expect.any(String) });
  await runHostedWorkspaceDurableCheckpointEffects(later.post?.afterDurableCheckpoint);
  expect(f.sends()).toBe(1);
});

it("claims a blocked successor only in its own published batch", async () => {
  const f = await fixture("telegram");
  await f.retry();
  const second = await createAssistantOutboxIntent({ ...f.base, dedupeToken: "publication-second", message: "Second reply bubble." });
  f.setCheckpoint(new Date().toISOString());
  const first = await f.phase("foreground", [f.intent.intentId, second.intentId]);
  expect(await f.read()).toMatchObject({ status: "sending", preparedDispatchToken: expect.any(String) });
  expect(await f.read(second.intentId)).toMatchObject({ status: "pending", attemptCount: 0, preparedDispatchToken: null });
  await f.publish();
  await runHostedWorkspaceDurableCheckpointEffects(first.post?.afterDurableCheckpoint);
  expect(f.sends()).toBe(1);
  const secondPass = await f.phase();
  expect(await f.read(second.intentId)).toMatchObject({ status: "sending", preparedDispatchToken: expect.any(String) });
  await f.publish();
  await runHostedWorkspaceDurableCheckpointEffects(secondPass.post?.afterDurableCheckpoint);
  expect(f.sends()).toBe(2);
  await f.restore();
  vi.setSystemTime(new Date(Date.now() + 600_000));
  await f.phase();
  expect(f.sends()).toBe(2);
  expect((await f.read()).status).toBe("sent");
  expect((await f.read(second.intentId)).lastError?.code).toBe("ASSISTANT_DELIVERY_AMBIGUOUS");
});

describe.each(["foreground", "general"] as const)("Linq %s fast path", (entry) => {
  it("sends an ordinary keyed reply inline with zero publication hooks", async () => {
    const f = await fixture("linq");
    expect(await f.collect([f.intent.intentId])).toEqual([expect.not.objectContaining({ publishBeforeDispatch: true })]);
    const { result, post, callsBeforeLocalCheckpoint } = await f.phase(entry, [f.intent.intentId]);
    // Foreground already adds a managed-automation maintenance hook, even on
    // ordinary fast replies. The general fast path has no local hook.
    if (entry === "general") expect(result.afterCheckpoint).toBeUndefined();
    expect(post?.afterDurableCheckpoint).toBeUndefined();
    expect(callsBeforeLocalCheckpoint).toBeGreaterThanOrEqual(1);
    expect(f.sends()).toBe(1);
    expect((await f.read()).status).toBe("sent");
  });

  it("publishes an approval cycle and adopted bytes before the reply consumes its input", async () => {
    const f = await fixture("linq");
    const bytes = Buffer.from("%PDF-1.4\nSynthetic generated document\n%%EOF\n");
    const ref = ".runtime/operations/assistant/generated-deliveries/report.pdf";
    await mkdir(path.dirname(path.join(f.vaultRoot, ref)), { recursive: true });
    await writeFile(path.join(f.vaultRoot, ref), bytes);
    const approvalId = `haa_${"a".repeat(32)}`;
    const approvalGeneration = "b".repeat(64);
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const cycleOwnerKey = buildHostedActionApprovalCycleOwnerKey({ approvalId, expiresAt });
    let approved = false;
    const approval: HostedRuntimeActionApprovalPort = {
      request: vi.fn(async () => ({ approvalId, approvalUrl: "https://www.withmurph.ai/approve/synthetic", expiresAt, status: "pending" as const })),
      read: vi.fn(async () => approved
        ? { approvalGeneration, approvalId, cycleOwnerKey, status: "approved" as const }
        : { approvalId, approvalUrl: "https://www.withmurph.ai/approve/synthetic", expiresAt, cycleOwnerKey, status: "pending" as const }),
      consume: vi.fn(async () => ({ approvalGeneration, approvalId, status: "approved" as const })),
    };
    f.setApproval(approval);
    await requestAssistantVaultFileSend({ ...f.base, actionApprovalPort: approval, ref, toolCallId: "file_publication" });
    const parked = (await listAssistantOutboxIntents(f.vaultRoot)).find((intent) => intent.status === "awaiting_approval")!;
    expect(parked.deliveryIdempotencyKey).toBe(cycleOwnerKey);
    const file = parked.media[0]!;
    if (file.kind !== "vault_file") throw new Error("Expected adopted file");
    expect(file.ref).not.toBe(ref);
    const { post } = await f.phase(entry, [f.intent.intentId]);
    expect(f.sends()).toBe(0);
    expect(f.consumed.size).toBe(0);
    expect(post?.afterDurableCheckpoint).toBeDefined();
    const hooks = post?.afterDurableCheckpoint;
    expect((typeof hooks === "function" ? [hooks] : hooks)?.map((hook) => hook.checkpointStartByMs)).toContain(Date.now() + (entry === "foreground" ? 0 : callbacks.HOSTED_PUBLISHED_CLAIM_MAX_WAIT_MS));
    await f.publish();
    await runHostedWorkspaceDurableCheckpointEffects(post?.afterDurableCheckpoint);
    expect(f.sends()).toBe(1);
    expect(f.consumed.has("mailbox_publication")).toBe(true);
    await f.restore();
    expect((await f.read(parked.intentId)).status).toBe("awaiting_approval");
    const restoredBytes = await readFile(path.join(f.vaultRoot, file.ref));
    expect(createHash("sha256").update(restoredBytes).digest("hex")).toBe(file.sha256);
    expect(restoredBytes).toEqual(bytes);
    // The restored reply is still sending. Replay that predecessor under its
    // original key before selecting the same-boundary approval file.
    vi.setSystemTime(new Date(Date.now() + 600_000));
    const replay = await f.phase(entry, [f.intent.intentId]);
    await runHostedWorkspaceDurableCheckpointEffects(replay.post?.afterDurableCheckpoint);
    expect(f.visibleReplies.size).toBe(1);
    expect(f.wireKeys).toHaveLength(2);
    approved = true;
    const effects = await f.collect([], [buildHostedActionApprovalOutcomeEffectId({ approvalGeneration, approvalId, expiresAt })]);
    // Provider upload is stubbed, but verifies the actual adopted file bytes.
    f.providerFetch.mockClear();
    f.providerFetch.mockImplementation(async (url, init) => {
      if (String(url).includes("/attachments")) return Response.json({ attachment_id: "attachment_publication", expires_at: new Date(Date.now() + 60_000).toISOString(), http_method: "PUT", required_headers: { "content-type": "application/pdf" }, upload_url: "https://upload.example.test/file" });
      if (String(url).includes("upload.example.test")) {
        if (!(init?.body instanceof Blob)) throw new Error("Expected uploaded file bytes");
        expect(createHash("sha256").update(Buffer.from(await init.body.arrayBuffer())).digest("hex")).toBe(file.sha256);
        return new Response(null, { status: 200 });
      }
      return Response.json({ message: { id: "linq_file_publication", chat_id: f.intent.threadId } });
    });
    expect(await f.drain(effects)).toEqual([expect.objectContaining({ deliveryStatus: "sent", deliveryErrorMessage: null })]);
    expect((await f.read(parked.intentId)).status).toBe("sent");
    expect(approval.consume).toHaveBeenCalledOnce();
    expect(f.providerFetch.mock.calls.filter(([url]) => String(url).includes("upload.example.test"))).toHaveLength(1);
    await f.drain();
    expect(f.providerFetch.mock.calls.filter(([url]) => String(url).includes("upload.example.test"))).toHaveLength(1);
    expect(f.wireKeys.every((key) => key === f.wireKeys[0])).toBe(true);
  });

  it.each(["follow-up", "nutrition", "both"] as const)("restores and settles %s exactly once after accepted reply loss", async (kind) => {
    const f = await fixture("linq", {
      ...(kind !== "nutrition" ? { followUpRequest } : {}),
      ...(kind !== "follow-up" ? { message: DAILY_NUTRITION_OPTIONAL_GOALS_INTRO } : {}),
    });
    const { post } = await f.phase(entry, [f.intent.intentId]);
    expect(f.sends()).toBe(0);
    expect(post?.afterDurableCheckpoint).toBeDefined();
    await f.publish();
    if (kind === "follow-up") vi.mocked(registerAutomationFollowUp).mockRejectedValueOnce(new Error("Synthetic crash before settlement"));
    else vi.mocked(upsertMemory).mockRejectedValueOnce(new Error("Synthetic crash before settlement"));
    await runHostedWorkspaceDurableCheckpointEffects(post?.afterDurableCheckpoint);
    expect(f.consumed.has("mailbox_publication")).toBe(true);
    expect((await f.read()).deliveryConfirmationPending).toBe(true);
    await f.restore();
    vi.setSystemTime(new Date(Date.now() + 600_000));
    const restored = await f.phase(entry, [f.intent.intentId]);
    await runHostedWorkspaceDurableCheckpointEffects(restored.post?.afterDurableCheckpoint);
    expect((await f.read()).status).toBe("sent");
    expect(await listAutomations(f.vaultRoot)).toHaveLength(kind === "nutrition" ? 0 : 1);
    expect((await readMemoryDocument(f.vaultRoot)).records).toHaveLength(kind === "follow-up" ? 0 : 1);
    expect(new Set(f.wireKeys).size).toBe(1);
    expect(f.wireKeys).not.toContain("missing");
    expect(f.visibleReplies.size).toBe(1);
    await f.phase();
    expect(await listAutomations(f.vaultRoot)).toHaveLength(kind === "nutrition" ? 0 : 1);
  });
});

it("sends an unrelated keyed reply immediately while another boundary waits for publication", async () => {
  const f = await fixture("linq");
  const affected = await createAssistantOutboxIntent({ ...f.base, turnId: "turn_obligation", dedupeToken: "obligation", followUpRequest });
  const { post } = await f.phase("foreground", [f.intent.intentId, affected.intentId]);
  expect(f.sends()).toBe(1);
  expect((await f.read()).status).toBe("sent");
  expect((await f.read(affected.intentId)).status).toBe("sending");
  expect(post?.afterDurableCheckpoint).toBeDefined();
  await f.publish();
  await runHostedWorkspaceDurableCheckpointEffects(post?.afterDurableCheckpoint);
  expect(f.sends()).toBe(2);
});

it("does not treat Linq voice provider entry as acceptance or settle its obligation after restore", async () => {
  const f = await fixture("linq", { followUpRequest, media: [{
    kind: "voice_memo", filename: "memo.mp3", transcript: "Requested voice reply.",
    transport: { kind: "linq_attachment", attachmentId: "attachment_voice_publication" },
  }] });
  expect(f.intent.deliveryTransportIdempotent).toBe(false);
  const controller = new AbortController();
  f.setSignal(controller.signal);
  const { post } = await f.phase("foreground", [f.intent.intentId]);
  expect(f.sends()).toBe(0);
  expect(post?.afterDurableCheckpoint).toBeDefined();
  expect(await f.read()).toMatchObject({ status: "sending", delivery: null, deliveryTransportIdempotent: false });
  await f.publish();
  f.providerFetch.mockImplementation(async () => {
    controller.abort(new Error("Synthetic kill after provider entry"));
    throw controller.signal.reason;
  });
  await runHostedWorkspaceDurableCheckpointEffects(post?.afterDurableCheckpoint).catch(() => undefined);
  expect(f.sends()).toBe(1);
  expect(f.consumed.size).toBe(0);
  await f.restore();
  f.setSignal(undefined);
  vi.setSystemTime(new Date(Date.now() + 600_000));
  await f.phase();
  expect(await f.read()).toMatchObject({ status: "abandoned", lastError: { code: "ASSISTANT_DELIVERY_AMBIGUOUS" }, delivery: null });
  expect(f.sends()).toBe(1);
  expect(await listAutomations(f.vaultRoot)).toHaveLength(0);
  expect((await readMemoryDocument(f.vaultRoot)).records).toHaveLength(0);
});

it("keeps a group email planner and fresh child immediate, but publishes a due child retry", async () => {
  const target = serializeHostedEmailThreadTarget({ groupId: "group_publication", subject: "Group reply", targetKind: "group" });
  const f = await fixture("email", { bindingDelivery: { kind: "thread", target }, explicitTarget: target, deliveryTransportIdempotent: true, threadIsDirect: false, groupEmailAuthorizationProof: "a".repeat(64) });
  f.sendEmail.mockResolvedValueOnce({ target, fanoutRecipientMemberIds: ["member_recipient"] });
  expect(await f.collect()).toEqual([expect.not.objectContaining({ publishBeforeDispatch: true })]);
  const parent = await f.phase();
  expect(parent.post?.afterDurableCheckpoint).toBeUndefined();
  expect((await f.read()).status).toBe("sent");
  const child = (await listAssistantOutboxIntents(f.vaultRoot)).find((intent) => intent.intentId !== f.intent.intentId)!;
  expect(child.deliveryTransportIdempotent).toBe(false);
  expect(await f.collect()).toEqual([expect.not.objectContaining({ publishBeforeDispatch: true })]);
  f.sendEmail.mockRejectedValueOnce(Object.assign(new Error("Synthetic rejected recipient send"), { deliveryMayHaveSucceeded: false, retryable: true }));
  await f.drain();
  vi.setSystemTime(new Date((await f.read(child.intentId)).nextAttemptAt!));
  f.sendEmail.mockClear();
  const retry = await f.phase();
  expect(f.sends()).toBe(0);
  expect(await f.read(child.intentId)).toMatchObject({ status: "sending", preparedDispatchToken: expect.any(String) });
  await f.publish();
  await runHostedWorkspaceDurableCheckpointEffects(retry.post?.afterDurableCheckpoint);
  expect(f.sends()).toBe(1);
  await f.restore();
  vi.setSystemTime(new Date(Date.now() + 600_000));
  await f.phase();
  expect(f.sends()).toBe(1);
  expect((await f.read(child.intentId)).lastError?.code).toBe("ASSISTANT_DELIVERY_AMBIGUOUS");
});
