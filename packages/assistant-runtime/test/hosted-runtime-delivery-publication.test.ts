import {
  createDueAssistantWorkspace, createPhaseInput, createResolvedMemberActivationMailboxItem,
  loadHostedSystemMailboxRealImplementation, mocks,
  runHostedWorkspaceAssistantPhase, runHostedWorkspaceDurableCheckpointEffects,
} from "./hosted-runtime-workspace-assistant-phase.harness.ts";
import * as assistantEngine from "@murphai/assistant-engine";
import type { HostedRuntimeLogRequest } from "@murphai/hosted-execution/runtime-control";
import { drainHostedRuntimeLogWritesBestEffort } from "../src/hosted-runtime/runtime-logs.ts";
import { runHostedWorkspaceUntilIdleOrBudget } from "../src/hosted-runtime/workspace-runner.ts";
import { createCoalescingRuntimeWakeSignal, createHostedWorkspaceCheckpointRequestBuilder } from "../src/hosted-runtime.ts";
import { enqueueHostedPendingAssistantInputId } from "../src/hosted-runtime/pending-input-index.ts";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeVault, readMemoryDocument, registerAutomationFollowUp, upsertMemory } from "@murphai/core";
import { listAutomations } from "@murphai/query";
import {
  createAssistantOutboxIntent, listAssistantOutboxIntents, readAssistantOutboxIntent,
  requestAssistantVaultFileSend, resetAssistantOutboxPreparedDispatchById,
} from "@murphai/assistant-engine/assistant-outbox";
import { DAILY_NUTRITION_OPTIONAL_GOALS_INTRO } from "@murphai/operator-config/assistant-response-cards";
import { buildHostedExecutionMemberActivatedWake, buildHostedExecutionRuntimeTimerWake } from "@murphai/hosted-execution";
import { buildHostedActionApprovalCycleOwnerKey, buildHostedActionApprovalOutcomeEffectId } from "@murphai/hosted-execution/action-approval";
import { HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON } from "@murphai/hosted-execution/orchestration-control";
import { serializeHostedEmailThreadTarget } from "@murphai/runtime-state";
import type { HostedRuntimeActionApprovalPort } from "../src/hosted-runtime/platform.ts";
import { readHostedSystemMailboxState } from "../src/hosted-runtime/system-mailbox-state.ts";
import { createHostedRuntimeEffectsPortStub } from "./hosted-runtime-test-helpers.ts";

vi.mock("@murphai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@murphai/core")>();
  return { ...actual, registerAutomationFollowUp: vi.fn(actual.registerAutomationFollowUp), upsertMemory: vi.fn(actual.upsertMemory) };
});

vi.mock("@murphai/assistant-engine/assistant-outbox", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@murphai/assistant-engine/assistant-outbox")>();
  return { ...actual, resetAssistantOutboxPreparedDispatchById: vi.fn(actual.resetAssistantOutboxPreparedDispatchById) };
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
  const logRequests: HostedRuntimeLogRequest[] = [];
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
  let publications = 0;
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
  const phase = async (entry: Entry = "general", preferredIntentIds: string[] = [], shouldYield?: () => boolean, selectedInputWakeAt: string | null = null) => {
    mocks.runHostedAssistantAutomationLane.mockResolvedValue({
      assistantAutomationCurrentTurnDeliveryIntentIds: entry === "foreground" ? preferredIntentIds : [],
      assistantAutomationProgressed: preferredIntentIds.length > 0,
      assistantAutomationSelectedInputWakeAt: selectedInputWakeAt,
      nextWakeAt: null, redactedLogEntries: [],
    });
    const input = createPhaseInput({
      importedCount: entry === "foreground" ? 1 : 0,
      logRequests,
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
    const completion = await result.afterCheckpoint?.();
    const afterDurableCheckpoint = [result.afterDurableCheckpoint, completion?.afterDurableCheckpoint]
      .flatMap((effects) => typeof effects === "function" ? [effects] : effects ?? []);
    const post = { ...result, ...completion, afterDurableCheckpoint: afterDurableCheckpoint.length ? afterDurableCheckpoint : undefined };
    return { result, post, callsBeforeLocalCheckpoint };
  };
  return {
    root, vaultRoot, snapshot, intent, base, collect, drain, read, retry, phase, providerFetch, sendEmail, logRequests,
    recordLinqDeliveryOutcome, wireKeys, visibleReplies, consumed,
    setApproval: (port: HostedRuntimeActionApprovalPort) => { actionApprovalPort = port; },
    setSignal: (value?: AbortSignal) => { signal = value; },
    setCheckpoint: (at: string) => { checkpointedAt = at; },
    publications: () => publications,
    publish: async () => { await rm(snapshot, { force: true, recursive: true }); await cp(vaultRoot, snapshot, { recursive: true }); publications += 1; },
    restore: async () => { await rm(vaultRoot, { recursive: true }); await cp(snapshot, vaultRoot, { recursive: true }); },
    sends: () => channel === "email" ? sendEmail.mock.calls.length : providerFetch.mock.calls.filter(([url]) => !String(url).includes("/typing")).length,
  };
}

async function queueTelegramSignupActivation(vaultRoot: string) {
  const systemMailbox = await loadHostedSystemMailboxRealImplementation();
  const item = createResolvedMemberActivationMailboxItem({ occurredAt: NOW });
  const wake = buildHostedExecutionMemberActivatedWake({
    eventId: item.item.dedupeKey, memberId: "member_synthetic_phase", occurredAt: NOW,
    memberChannels: { email: false, linq: false, telegram: true },
    signupWelcome: {
      route: {
        actorId: null, channel: "telegram", delivery: { kind: "explicit", target: "123" },
        identityId: "hbidx:telegram:v1:test", threadId: null, threadIsDirect: true,
      },
      text: "Welcome to Murph.",
    },
  });
  expect(await systemMailbox.enqueueHostedSystemMailboxItem({
    item, vaultRoot, wake,
  })).toMatchObject({ status: "imported" });
  mocks.prepareHostedSystemMailboxItemForCheckpoint.mockImplementation(systemMailbox.prepareHostedSystemMailboxItemForCheckpoint);
  mocks.recordHostedSystemMailboxItemAfterCheckpoint.mockImplementation(systemMailbox.recordHostedSystemMailboxItemAfterCheckpoint);
  mocks.resolveHostedSystemMailboxNextWakeCandidate.mockImplementation(systemMailbox.resolveHostedSystemMailboxNextWakeCandidate);
  mocks.runHostedAssistantAutomationLane.mockImplementationOnce(async () => {
    expect(await readHostedSystemMailboxState(vaultRoot)).toMatchObject({
      pending: [{ itemId: item.item.id, status: "pending", wake: { kind: "member.activated" } }],
    });
    return {
      assistantAutomationCurrentTurnDeliveryIntentIds: [], assistantAutomationProgressed: true,
      nextWakeAt: null, redactedLogEntries: [],
    };
  });
}

describe("post-foreground maintenance publication", () => {
  it("runs the prepared Telegram retry after publication and preserves its sent receipt on restore", async () => {
    const f = await fixture("telegram");
    await f.retry();
    await queueTelegramSignupActivation(f.vaultRoot);

    const { post, callsBeforeLocalCheckpoint } = await f.phase("foreground");
    expect(callsBeforeLocalCheckpoint).toBe(0);
    expect(f.sends()).toBe(0);
    expect(post?.afterDurableCheckpoint).toBeDefined();
    expect(await f.read()).toMatchObject({ status: "sending", preparedDispatchToken: expect.any(String) });
    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).not.toHaveBeenCalled();
    await f.publish();
    expect(f.sends()).toBe(0);
    const effects = post?.afterDurableCheckpoint;
    const results = [];
    for (const effect of typeof effects === "function" ? [effects] : effects ?? []) {
      results.push(await effect());
    }
    expect(f.sends()).toBe(1);
    expect(await f.read()).toMatchObject({ status: "sent", preparedDispatchToken: null });
    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledTimes(1);
    expect(await readHostedSystemMailboxState(f.vaultRoot)).toEqual({ pending: [] });
    expect(results).toContainEqual(expect.objectContaining({
      nextWakeAt: new Date(Date.now() + 120_000).toISOString(),
      nextWakeReason: HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
      requiresFollowUpCheckpoint: true,
      redactedStatus: expect.objectContaining({ hostedSystemMailboxRecorded: 0, hostedOutboxDeliverySent: 1 }),
    }));

    await f.publish(); // Persist the follow-up receipt before restoring the workspace.
    await f.restore();
    vi.setSystemTime(new Date(Date.now() + 600_000));
    const later = await f.phase();
    await runHostedWorkspaceDurableCheckpointEffects(later.post?.afterDurableCheckpoint);
    expect(f.sends()).toBe(1);
    expect((await f.read()).status).toBe("sent");
    expect(mocks.recordHostedSystemMailboxItemAfterCheckpoint).toHaveBeenCalledTimes(1);
  });

  it("resets the exact retry token when the inner hook yields and lets a later pass claim it", async () => {
    const f = await fixture("telegram");
    await f.retry();
    const before = await f.read();
    await queueTelegramSignupActivation(f.vaultRoot);
    let yieldNow = false;
    const { post } = await f.phase("foreground", [], () => yieldNow);
    const prepared = await f.read();
    expect(prepared).toMatchObject({ status: "sending", preparedDispatchToken: expect.any(String) });
    await f.publish();
    yieldNow = true;
    await runHostedWorkspaceDurableCheckpointEffects(post?.afterDurableCheckpoint);
    expect(f.sends()).toBe(0);
    expect(await f.read()).toMatchObject({
      status: before.status, attemptCount: before.attemptCount,
      lastAttemptAt: before.lastAttemptAt, preparedDispatchToken: null,
    });
    expect(mocks.resetHostedPreparedAssistantDeliveryEffects).toHaveBeenCalledWith(expect.objectContaining({
      preparedDispatches: [expect.objectContaining({ intentId: f.intent.intentId, preparedDispatchToken: prepared.preparedDispatchToken })],
    }));
    yieldNow = false;
    const later = await f.phase();
    const reclaimed = await f.read();
    expect(reclaimed).toMatchObject({ status: "sending", preparedDispatchToken: expect.any(String) });
    expect(reclaimed.preparedDispatchToken).not.toBe(prepared.preparedDispatchToken);
    await f.publish();
    await runHostedWorkspaceDurableCheckpointEffects(later.post?.afterDurableCheckpoint);
    expect(f.sends()).toBe(1);
    expect((await f.read()).status).toBe("sent");
  });
});

describe("post-send failure recovery", () => {
  it.each([false, true])("keeps the accepted receipt when resetting the remainder throws and retries the remaining effect (obligation: %s)", async (obligation) => {
    const f = await fixture("linq", obligation ? { followUpRequest } : {});
    const remaining = await createAssistantOutboxIntent({ ...f.base, dedupeToken: "reset-second", sessionId: "session_reset", turnId: "turn_reset" });
    const effects = await f.collect([f.intent.intentId, remaining.intentId]);
    expect(effects).toHaveLength(2);
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce(effects);
    let yieldNow = false;
    const providerFetch = f.providerFetch.getMockImplementation()!;
    f.providerFetch.mockImplementation(async (...args) => {
      const response = await providerFetch(...args);
      if (!String(args[0]).includes("/typing")) yieldNow = true;
      return response;
    });
    vi.mocked(resetAssistantOutboxPreparedDispatchById).mockRejectedValueOnce(new Error("Synthetic prepared reset unavailable"));

    const { result, post } = await f.phase("general", [f.intent.intentId, remaining.intentId], () => yieldNow);
    if (obligation) expect(post.afterDurableCheckpoint?.map((hook) => hook.checkpointStartByMs)).toEqual([Date.now()]);
    else expect(post.afterDurableCheckpoint).toBeUndefined();
    expect(f.sends()).toBe(1);
    expect(await f.read()).toMatchObject({ status: "sent", preparedDispatchToken: null });
    expect(await f.read(remaining.intentId)).toMatchObject({ status: "sending", preparedDispatchToken: expect.any(String) });
    expect(result).toMatchObject({ progressed: true, checkpointReason: "outbox_receipt", nextWakeAt: new Date(Date.now() + 30_000).toISOString() });
    expect(result.nextWakeReason ?? "assistant").toBe("assistant");
    expect(f.logRequests.flatMap((request) => request.entries)
      .filter((entry) => entry.errorCode === "assistant_after_checkpoint_failed")).toHaveLength(1);

    f.providerFetch.mockImplementation(providerFetch);
    const retryAt = await callbacks.resolveHostedAssistantOutboxNextWakeAt({ vaultRoot: f.vaultRoot });
    expect(retryAt).not.toBeNull();
    vi.setSystemTime(new Date(result.nextWakeAt!));
    const recovery = await f.phase();
    expect(f.sends()).toBe(1);
    expect(recovery.post.nextWakeAt).toBe(retryAt);
    vi.setSystemTime(new Date(recovery.post.nextWakeAt!));
    await f.phase();
    expect(f.sends()).toBe(2);
    expect(await f.read()).toMatchObject({ status: "sent", attemptCount: 1 });
    expect(await f.read(remaining.intentId)).toMatchObject({ status: "sent", preparedDispatchToken: null });
    expect(f.visibleReplies.size).toBe(2);
  });

  it.each([false, true])("stages a mixed-batch failure exactly once before cleanup throws (yielded: %s)", async (yielded) => {
    const f = await fixture("telegram");
    const terminal = await createAssistantOutboxIntent({ ...f.base, dedupeToken: "cleanup-terminal", sessionId: "session_terminal", turnId: "turn_terminal" });
    const remaining = yielded
      ? await createAssistantOutboxIntent({ ...f.base, dedupeToken: "cleanup-remaining", sessionId: "session_remaining", turnId: "turn_remaining" })
      : null;
    const ids = [f.intent.intentId, terminal.intentId, ...(remaining ? [remaining.intentId] : [])];
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce(await f.collect(ids));
    let yieldNow = false;
    f.providerFetch.mockResolvedValueOnce(Response.json({ ok: true, result: { message_id: 7, chat: { id: 123 } } }))
      .mockImplementationOnce(async () => {
        yieldNow = yielded;
        return Response.json({ ok: false, error_code: 400, description: "Synthetic terminal rejection" }, { status: 400 });
      });
    mocks.recordHostedProviderCleanupAfterDelivery.mockImplementationOnce(async () => {
      expect((await assistantEngine.listAssistantInputEvents({ vault: f.vaultRoot })).events).toHaveLength(1);
      throw new Error("Synthetic cleanup unavailable");
    });

    const { result } = await f.phase("general", ids, () => yieldNow);
    expect(f.sends()).toBe(2);
    expect(await f.read()).toMatchObject({ status: "sent" });
    expect(await f.read(terminal.intentId)).toMatchObject({ status: "failed" });
    expect(mocks.recordHostedProviderCleanupAfterDelivery).toHaveBeenCalledOnce();
    const staged = (await assistantEngine.listAssistantInputEvents({ vault: f.vaultRoot })).events;
    expect(staged).toHaveLength(1);
    expect(staged[0]?.sourceRef).toMatchObject({ lane: "system", payloadSchema: "murph.outbox-delivery-failed.v1" });

    vi.setSystemTime(new Date(result.nextWakeAt!));
    await f.phase();
    expect((await assistantEngine.listAssistantInputEvents({ vault: f.vaultRoot })).events).toEqual(staged);
    expect(f.sends()).toBe(yielded ? 3 : 2);
  });

  it.each([false, true])("keeps Linq cleanup, receipt and recovery wake when terminal staging fails (yielded: %s)", async (yielded) => {
    const f = await fixture("linq");
    const terminal = await createAssistantOutboxIntent({ ...f.base, dedupeToken: "terminal-second", sessionId: "session_terminal", turnId: "turn_terminal" });
    const remaining = yielded
      ? await createAssistantOutboxIntent({ ...f.base, dedupeToken: "terminal-remaining", sessionId: "session_remaining", turnId: "turn_remaining" })
      : null;
    const ids = [f.intent.intentId, terminal.intentId, ...(remaining ? [remaining.intentId] : [])];
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce(await f.collect(ids));
    let yieldNow = false;
    const providerFetch = f.providerFetch.getMockImplementation()!;
    f.providerFetch.mockImplementationOnce(providerFetch).mockImplementationOnce(async () => {
      yieldNow = yielded;
      return Response.json({ error: "Synthetic terminal rejection" }, { status: 400 });
    });
    mocks.drainHostedPreparedAssistantDeliveries.mockImplementationOnce(async (input) => {
      const outcomes = await callbacks.drainHostedPreparedAssistantDeliveries(input);
      mocks.readAssistantOutboxIntent.mockRejectedValueOnce(new Error("Synthetic terminal staging unavailable"));
      return outcomes;
    });
    const cleanup = await vi.importActual<typeof import("../src/hosted-runtime/provider-cleanup.ts")>("../src/hosted-runtime/provider-cleanup.ts");
    mocks.recordHostedProviderCleanupAfterDelivery.mockImplementation(cleanup.recordHostedProviderCleanupAfterDelivery);

    const { result } = await f.phase("general", ids, () => yieldNow);
    expect(f.sends()).toBe(2);
    expect(await f.read()).toMatchObject({ status: "sent", preparedDispatchToken: null });
    expect(await f.read(terminal.intentId)).toMatchObject({ status: "failed" });
    if (remaining) expect(await f.read(remaining.intentId)).toMatchObject({ status: "pending" });
    expect(result).toMatchObject({
      progressed: true, checkpointReason: "outbox_receipt",
      nextWakeAt: new Date(Date.now() + 30_000).toISOString(),
      redactedStatus: { hostedOutboxDeliveryAttempted: 2, hostedOutboxDeliverySent: 1 },
    });
    expect(result.nextWakeReason ?? "assistant").toBe("assistant");
    expect(f.logRequests.flatMap((request) => request.entries)
      .filter((entry) => entry.errorCode === "assistant_after_checkpoint_failed")).toHaveLength(1);
    expect(mocks.recordHostedProviderCleanupAfterDelivery).toHaveBeenCalledOnce();
    expect(mocks.drainHostedProviderCleanupAfterCommit).not.toHaveBeenCalled();
    const checkpoint = await cleanup.readHostedProviderCleanupCheckpoint(f.vaultRoot);
    expect(checkpoint?.nextWakeAt).toEqual(expect.any(String));
    await f.publish();
    await f.restore();
    vi.setSystemTime(new Date(checkpoint!.nextWakeAt!));
    const deleteFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    expect(await cleanup.drainHostedProviderCleanupAfterCommit({
      checkpoint: checkpoint!, env: { LINQ_API_TOKEN: "synthetic-token" }, fetchImplementation: deleteFetch,
      vaultRoot: f.vaultRoot,
      wake: buildHostedExecutionRuntimeTimerWake({ eventId: "evt_cleanup", occurredAt: new Date().toISOString(), triggerKind: "runtime_timer", userId: "member_synthetic_phase" }),
    })).toMatchObject({ attemptedLinqMessageCount: 1, deletedLinqMessageCount: 1 });
    expect(deleteFetch).toHaveBeenCalledWith(expect.stringContaining("linq_message_publication"), expect.objectContaining({ method: "DELETE" }));
    expect(await f.read()).toMatchObject({ status: "sent", attemptCount: 1 });
  });

  it("recovers a drain failure before provider acceptance without marking the effect sent", async () => {
    const f = await fixture("linq");
    mocks.drainHostedPreparedAssistantDeliveries.mockRejectedValueOnce(new Error("Synthetic drain unavailable before provider entry"));

    const { result } = await f.phase("general", [f.intent.intentId]);
    expect(f.sends()).toBe(0);
    expect(await f.read()).toMatchObject({ status: "sending", delivery: null, preparedDispatchToken: expect.any(String) });
    expect(result).toMatchObject({ progressed: true, nextWakeAt: new Date(Date.now() + 30_000).toISOString() });
    expect(result.nextWakeReason ?? "assistant").toBe("assistant");
    expect(result.redactedStatus?.hostedOutboxDeliverySent ?? 0).toBe(0);
    expect(f.logRequests.flatMap((request) => request.entries)
      .filter((entry) => entry.errorCode === "assistant_after_checkpoint_failed")).toHaveLength(1);

    vi.setSystemTime(new Date(result.nextWakeAt!));
    const recovery = await f.phase();
    expect(f.sends()).toBe(0);
    expect(await f.read()).toMatchObject({ status: "sending", delivery: null });
    expect(recovery.post.nextWakeAt).toBe(await callbacks.resolveHostedAssistantOutboxNextWakeAt({ vaultRoot: f.vaultRoot }));
    expect(Date.parse(recovery.post.nextWakeAt!)).toBeGreaterThan(Date.now());
    vi.setSystemTime(new Date(recovery.post.nextWakeAt!));
    await f.phase();
    expect(f.sends()).toBe(1);
    expect(await f.read()).toMatchObject({ status: "sent", preparedDispatchToken: null });
    expect(f.visibleReplies.size).toBe(1);
  });

  it("keeps an accepted receipt and recovery wake when the yielded branch cannot read cleanup state", async () => {
    const f = await fixture("telegram");
    const remaining = await createAssistantOutboxIntent({ ...f.base, dedupeToken: "yield-second", sessionId: "session_yield", turnId: "turn_yield",
      bindingDelivery: { kind: "thread", target: "456" }, threadId: "456" });
    const effects = await f.collect([f.intent.intentId, remaining.intentId]);
    expect(effects).toHaveLength(2);
    mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce(effects);
    let yieldNow = false;
    f.providerFetch.mockImplementationOnce(async () => {
      yieldNow = true;
      return Response.json({ ok: true, result: { message_id: 7, chat: { id: 123 } } });
    });
    mocks.recordHostedProviderCleanupAfterDelivery.mockImplementationOnce(async ({ outcomes }) => {
      expect(outcomes).toEqual([expect.objectContaining({ deliveryStatus: "sent" })]);
      await readFile(path.join(f.root, "missing-cleanup-state.json"));
      return { nextWakeAt: null };
    });
    const { result } = await f.phase("general", [f.intent.intentId, remaining.intentId], () => yieldNow);
    expect(f.sends()).toBe(1);
    expect(await f.read()).toMatchObject({ status: "sent", preparedDispatchToken: null });
    expect(await f.read(remaining.intentId)).toMatchObject({ status: "pending" });
    expect(result).toMatchObject({
      progressed: true, checkpointReason: "outbox_receipt",
      nextWakeAt: new Date(Date.now() + 30_000).toISOString(),
      redactedStatus: { hostedOutboxDeliverySent: 1, hostedOutboxPendingDeliveryEffects: 1 },
    });
    expect(result.nextWakeReason ?? "assistant").toBe("assistant");
    expect(mocks.recordHostedProviderCleanupAfterDelivery).toHaveBeenCalledOnce();
    expect(mocks.resolveHostedAssistantOutboxNextWakeAt).not.toHaveBeenCalled();
    expect(f.logRequests.flatMap((request) => request.entries)
      .filter((entry) => entry.errorCode === "assistant_after_checkpoint_failed")).toHaveLength(1);
  });

  it("drops an expired base wake when post-send projection fails", async () => {
    const f = await fixture("telegram");
    mocks.runHostedAssistantAutomationLane.mockResolvedValueOnce({
      assistantAutomationCurrentTurnDeliveryIntentIds: [f.intent.intentId],
      assistantAutomationProgressed: true,
      nextWakeAt: new Date(Date.now() + 5_000).toISOString(), redactedLogEntries: [],
    });
    f.providerFetch.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date(Date.now() + 8_000));
      return Response.json({ ok: true, result: { message_id: 7, chat: { id: 123 } } });
    });
    mocks.resolveHostedAssistantOutboxNextWakeAt.mockRejectedValueOnce(new Error("Synthetic projection unavailable"));
    const { result } = await f.phase("foreground", [f.intent.intentId]);
    expect(f.sends()).toBe(1);
    expect((await f.read()).status).toBe("sent");
    expect(result).toMatchObject({ progressed: true, nextWakeAt: "2026-09-04T12:00:38.000Z" });
    expect(result.nextWakeReason ?? "assistant").toBe("assistant");
  });
});

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
    if (entry === "general") expect(result.afterCheckpoint).toBeUndefined();
    expect(result.afterDurableCheckpoint).toBeUndefined();
    expect(post?.afterDurableCheckpoint).toBeUndefined();
    expect(f.sends()).toBe(1);
    expect((await f.read()).status).toBe("sent");
  });

  it.each(["foreground", "general"] as const)("keeps an accepted %s reply and continuation when cleanup fails", async (entry) => {
    const f = await fixture(channel);
    const continuationWakeAt = new Date(Date.now() + 60_000).toISOString();
    mocks.recordHostedProviderCleanupAfterDelivery.mockRejectedValueOnce(new Error("Synthetic cleanup unavailable"));
    const { result } = await f.phase(entry, [f.intent.intentId], undefined, continuationWakeAt);
    expect(result).toMatchObject({ progressed: true, checkpointReason: "outbox_receipt", nextWakeAt: new Date(Date.now() + 30_000).toISOString() });
    expect(result.redactedStatus).toMatchObject({ hostedOutboxDeliverySent: 1 });
    await drainHostedRuntimeLogWritesBestEffort();
    expect(f.logRequests.flatMap((request) => request.entries)).toContainEqual(expect.objectContaining({
      errorCode: "assistant_after_checkpoint_failed",
      redactedJson: expect.objectContaining({
        checkpointed: false,
        failureNames: ["Error"],
        failureSummaries: ["Synthetic cleanup unavailable"],
        failureCodeDetails: [],
        nestedErrorCode: "runtime_error",
      }),
    }));
    expect(f.sends()).toBe(1);
    expect(await f.read()).toMatchObject({ status: "sent", preparedDispatchToken: null });
    await f.publish();
    await f.restore();
    await f.phase();
    expect(f.sends()).toBe(1);
    expect((await f.read()).status).toBe("sent");
  });

  it("propagates liveness loss during cleanup without losing the accepted receipt", async () => {
    const f = await fixture(channel);
    const controller = new AbortController();
    f.setSignal(controller.signal);
    mocks.recordHostedProviderCleanupAfterDelivery.mockImplementationOnce(async () => {
      controller.abort(new Error("Synthetic invocation cancelled"));
      controller.signal.throwIfAborted();
      return { nextWakeAt: null };
    });
    await expect(f.phase("foreground", [f.intent.intentId])).rejects.toThrow("Synthetic invocation cancelled");
    expect(f.sends()).toBe(1);
    expect((await f.read()).status).toBe("sent");
  });

  it.each(["foreground", "general"] as const)("leaves a prompt assistant wake when %s post-delivery projection fails", async (entry) => {
    const f = await fixture(channel);
    mocks.resolveHostedAssistantOutboxNextWakeAt
      .mockRejectedValueOnce(new Error("Synthetic projection unavailable"));
    const { result } = await f.phase(entry, [f.intent.intentId]);
    expect(result).toMatchObject({
      progressed: true, checkpointReason: "outbox_receipt",
      nextWakeAt: new Date(Date.now() + 30_000).toISOString(),
    });
    expect(result.nextWakeReason ?? "assistant").toBe("assistant");
    expect(f.sends()).toBe(1);
    expect((await f.read()).status).toBe("sent");
    await drainHostedRuntimeLogWritesBestEffort();
    expect(f.logRequests.flatMap((request) => request.entries)).toContainEqual(expect.objectContaining({
      errorCode: "assistant_after_checkpoint_failed",
      redactedJson: expect.objectContaining({
        checkpointed: false, failureNames: ["Error"],
        failureSummaries: ["Synthetic projection unavailable"],
        failureCodeDetails: [], nestedErrorCode: "runtime_error",
      }),
    }));
  });

  it("does not list the outbox or read cleanup wakes before the first reply send", async () => {
    const f = await fixture(channel);
    const listing = vi.spyOn(assistantEngine, "listAssistantOutboxIntents");
    const assertNoReads = () => {
      expect(listing).not.toHaveBeenCalled();
      expect(mocks.resolveHostedAssistantOutboxNextWakeAt).not.toHaveBeenCalled();
      expect(mocks.resolveHostedProviderCleanupScheduledWakeAt).not.toHaveBeenCalled();
    };
    const fetch = f.providerFetch.getMockImplementation()!;
    const sendEmail = f.sendEmail.getMockImplementation()!;
    f.providerFetch.mockImplementation(async (...args) => { assertNoReads(); return fetch(...args); });
    f.sendEmail.mockImplementation(async (...args) => { assertNoReads(); return sendEmail(...args); });
    try {
      await f.phase("foreground", [f.intent.intentId]);
      expect(f.sends()).toBe(1);
      expect(listing).toHaveBeenCalled();
    } finally {
      listing.mockRestore();
    }
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

it("repairs a selected-input prefix after a general-path non-idempotent send", async () => {
  const f = await fixture("telegram");
  const engine = await vi.importActual<typeof import("@murphai/assistant-engine")>("@murphai/assistant-engine");
  mocks.readAssistantInputEvent.mockImplementation(engine.readAssistantInputEvent);
  mocks.readAssistantAutomationState.mockImplementation(engine.readAssistantAutomationState);
  const automation = await vi.importActual<typeof import("@murphai/assistant-engine/assistant-automation")>("@murphai/assistant-engine/assistant-automation");
  mocks.hasCompleteAssistantAutoReplyTerminalEvidence.mockImplementation(automation.hasCompleteAssistantAutoReplyTerminalEvidence);
  const events: Awaited<ReturnType<typeof engine.upsertAssistantInputEvent>>[] = [];
  for (const laneSeq of ["1", "2"]) {
    const event = await engine.upsertAssistantInputEvent({
      vault: f.vaultRoot,
      event: {
        content: { text: "Synthetic selected input", transcriptText: null, userMessageContent: [] },
        conversation: { accountId: "account_synthetic", actorId: "actor_synthetic", actorIsSelf: false, source: "telegram", threadId: "123", threadIsDirect: true },
        occurredAt: NOW, receivedAt: NOW,
        replyTarget: { channel: "telegram", messageId: `message_${laneSeq}`, threadId: "123" },
        sourceRef: { dedupeKey: `input_${laneSeq}`, eventId: `input_${laneSeq}`, itemId: `item_${laneSeq}`, causalSeq: laneSeq, kind: "hosted-mailbox", lane: "conversation", laneSeq, payloadSchema: "murph.hosted-mailbox-payload.v1", payloadSource: "inline", source: "hosted-mailbox", wakeSchema: "murph.hosted-execution-wake.v1" },
      },
    });
    events.push(event);
    await enqueueHostedPendingAssistantInputId({ inputId: event.inputId, vaultRoot: f.vaultRoot });
  }
  await engine.saveAssistantAutomationState(f.vaultRoot, {
    autoReply: [{ channel: "telegram", eligibleAfter: null, enabledAt: NOW }], updatedAt: NOW, version: 1,
  });
  const input = createPhaseInput({ vaultRoot: f.vaultRoot, importedCount: 0, now: () => NOW });
  const pendingLocalWork = new Set<Promise<void>>();
  const result = await runHostedWorkspaceUntilIdleOrBudget({
    checkpointRequestBuilder: createHostedWorkspaceCheckpointRequestBuilder({
      attemptId: "attempt_selected_delivery", expectedWorkspaceVersion: "0", leaseGeneration: "1", nextWakeAt: null, nextWakeReason: null, snapshotRef: null,
    }),
    expectedUserId: "member_synthetic_phase", requestId: "request_selected_delivery",
    initialMailboxImport: input.initialMailboxImport,
    initialAssistantInputBatch: { assistantInputIds: events.map((event) => event.inputId), emailDeliveryContexts: [], linqDeliveryContexts: [] },
    runtimeWakeSignal: createCoalescingRuntimeWakeSignal(),
    trackLocalWorkspaceMutationCompletion(completion) {
      if (completion) {
        pendingLocalWork.add(completion);
        void completion.then(() => { pendingLocalWork.delete(completion); });
      }
    },
    async importItem() { throw new Error("No new mailbox input expected"); },
    limitPerLane: 10, now: () => NOW, vaultRoot: f.vaultRoot, workspace: input.workspace,
    platform: {
      ...input.platform,
      mailboxPort: {
        async fetch() { return { fetchedAt: NOW, items: [], maxSeqByLane: [], userId: "member_synthetic_phase" }; },
        async fetchPayload() { throw new Error("No mailbox payload expected"); },
      },
      workspacePort: { async checkpoint() { throw new Error("No publication expected"); } },
    },
    async runAssistantPhase(selected) {
      expect(pendingLocalWork.size).toBe(1);
      expect(selected.initialAssistantInputBatch?.assistantInputIds).toEqual(events.map((event) => event.inputId));
      // A general pass has no foreground reply result. Its inline delivery must
      // not prevent the runner from repairing a handled prefix of its selection.
      await automation.writeAssistantAutoReplyReplyTerminalEvidence({
        captureIds: [], inputIds: [events[0]!.inputId], deliveryIntentId: f.intent.intentId,
        outcome: "result", recordedAt: NOW, sessionId: "session_publication", vault: f.vaultRoot,
      });
      const { result: delivered } = await f.phase("general", [f.intent.intentId]);
      expect(delivered.foregroundReplyFailed).toBeUndefined();
      expect(delivered.afterCheckpointKeepsForegroundImportLoop).toBe(true);
      expect(delivered.afterCheckpoint).toBeUndefined();
      expect(delivered.nextWakeAt).toBeNull();
      return delivered;
    },
  });
  expect(f.sends()).toBe(1);
  expect(pendingLocalWork.size).toBe(0);
  expect((await f.read()).status).toBe("sent");
  expect(result.latestAssistantInputBatch?.assistantInputIds).toEqual([events[1]!.inputId]);
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

  it.each(["follow-up", "nutrition", "both"] as const)("sends %s before publication and restores its accepted settlement exactly once", async (kind) => {
    const f = await fixture("linq", {
      ...(kind !== "nutrition" ? { followUpRequest } : {}),
      ...(kind !== "follow-up" ? { message: DAILY_NUTRITION_OPTIONAL_GOALS_INTRO } : {}),
    });
    const send = f.providerFetch.getMockImplementation()!;
    f.providerFetch.mockImplementation(async (...args) => {
      expect(f.publications()).toBe(0);
      return send(...args);
    });
    expect(await f.collect([f.intent.intentId])).toEqual([
      expect.objectContaining({ publishAfterDispatch: true }),
    ]);
    expect((await f.collect([f.intent.intentId]))[0]?.publishBeforeDispatch).toBeUndefined();
    if (kind === "follow-up") vi.mocked(registerAutomationFollowUp).mockRejectedValueOnce(new Error("Synthetic settlement unavailable"));
    else vi.mocked(upsertMemory).mockRejectedValueOnce(new Error("Synthetic settlement unavailable"));
    const { post } = await f.phase(entry, [f.intent.intentId]);
    expect(f.sends()).toBe(1);
    expect(f.publications()).toBe(0);
    expect(post.afterDurableCheckpoint?.map((hook) => hook.checkpointStartByMs)).toContain(Date.now());
    expect(f.consumed.has("mailbox_publication")).toBe(true);
    const accepted = await f.read();
    expect(accepted.deliveryConfirmationPending).toBe(true);
    await f.publish();
    expect(await runHostedWorkspaceDurableCheckpointEffects(post.afterDurableCheckpoint))
      .not.toMatchObject({ requiresFollowUpCheckpoint: true });
    await f.restore();
    expect(await f.read()).toMatchObject({
      intentId: accepted.intentId, deliveryIdempotencyKey: accepted.deliveryIdempotencyKey,
      deliveryConfirmationPending: true, delivery: accepted.delivery,
    });
    vi.setSystemTime(new Date(accepted.nextAttemptAt!));
    const restored = await f.phase(entry, [f.intent.intentId]);
    await runHostedWorkspaceDurableCheckpointEffects(restored.post.afterDurableCheckpoint);
    expect(await f.read()).toMatchObject({ status: "sent", deliveryConfirmationPending: false });
    expect(await listAutomations(f.vaultRoot)).toHaveLength(kind === "nutrition" ? 0 : 1);
    expect((await readMemoryDocument(f.vaultRoot)).records).toHaveLength(kind === "follow-up" ? 0 : 1);
    expect(f.wireKeys).toEqual([`assistant-outbox:${f.intent.intentId}`]);
    expect(f.visibleReplies.size).toBe(1);
    await f.phase();
    expect(await listAutomations(f.vaultRoot)).toHaveLength(kind === "nutrition" ? 0 : 1);
    expect((await readMemoryDocument(f.vaultRoot)).records).toHaveLength(kind === "follow-up" ? 0 : 1);
    expect(f.sends()).toBe(1);
  });

  it("recovers an already-published sending obligation under its original wire identity", async () => {
    const f = await fixture("linq", { followUpRequest, message: DAILY_NUTRITION_OPTIONAL_GOALS_INTRO });
    const send = f.providerFetch.getMockImplementation()!;
    f.providerFetch.mockImplementationOnce(async (...args) => {
      expect(await f.read()).toMatchObject({ status: "sending", delivery: null });
      await f.publish(); // Model a sending record published before this change.
      return send(...args);
    });
    vi.mocked(upsertMemory).mockRejectedValueOnce(new Error("Synthetic settlement unavailable"));
    await f.phase(entry, [f.intent.intentId]);
    expect(f.sends()).toBe(1);
    await f.restore();
    vi.setSystemTime(new Date(Date.now() + 600_000));
    await f.phase(entry, [f.intent.intentId]);
    expect(await f.read()).toMatchObject({ intentId: f.intent.intentId, status: "sent" });
    expect(f.wireKeys).toEqual(Array(2).fill(`assistant-outbox:${f.intent.intentId}`));
    expect(f.visibleReplies.size).toBe(1);
    expect(await listAutomations(f.vaultRoot)).toHaveLength(1);
    expect((await readMemoryDocument(f.vaultRoot)).records).toHaveLength(1);
  });

  it("requests immediate publication after successful settlement even when cleanup fails", async () => {
    const f = await fixture("linq", { followUpRequest, message: DAILY_NUTRITION_OPTIONAL_GOALS_INTRO });
    mocks.recordHostedProviderCleanupAfterDelivery.mockRejectedValueOnce(new Error("Synthetic cleanup unavailable"));
    const { post } = await f.phase(entry, [f.intent.intentId]);
    expect(f.sends()).toBe(1);
    expect(post.afterDurableCheckpoint?.map((hook) => hook.checkpointStartByMs)).toContain(Date.now());
    expect(await f.read()).toMatchObject({ status: "sent", deliveryConfirmationPending: false });
    await f.publish();
    await f.restore();
    await f.phase();
    expect(await listAutomations(f.vaultRoot)).toHaveLength(1);
    expect((await readMemoryDocument(f.vaultRoot)).records).toHaveLength(1);
    expect(f.wireKeys).toEqual([`assistant-outbox:${f.intent.intentId}`]);
  });

  it("requests one harmless early publication for a rejected obligation reply", async () => {
    const f = await fixture("linq", { followUpRequest });
    f.providerFetch.mockImplementation(async () => Response.json({ error: "Synthetic rejection" }, { status: 429 }));
    const { post } = await f.phase(entry, [f.intent.intentId]);
    expect(f.sends()).toBe(3); // The provider adapter exhausts its bounded 429 retries.
    expect(await f.read()).toMatchObject({ status: "retryable", delivery: null });
    expect(post.afterDurableCheckpoint?.map((hook) => hook.checkpointStartByMs)).toEqual([Date.now()]);
    expect(await runHostedWorkspaceDurableCheckpointEffects(post.afterDurableCheckpoint))
      .not.toMatchObject({ requiresFollowUpCheckpoint: true });
    expect(f.sends()).toBe(3);
  });

});

it("sends ordinary and obligation replies together before requesting publication", async () => {
  const f = await fixture("linq");
  const affected = await createAssistantOutboxIntent({ ...f.base, turnId: "turn_obligation", dedupeToken: "obligation", followUpRequest });
  const { post } = await f.phase("foreground", [f.intent.intentId, affected.intentId]);
  expect(f.sends()).toBe(2);
  expect((await f.read()).status).toBe("sent");
  expect((await f.read(affected.intentId)).status).toBe("sent");
  expect(post.afterDurableCheckpoint?.map((hook) => hook.checkpointStartByMs)).toContain(Date.now());
  await f.publish();
  await runHostedWorkspaceDurableCheckpointEffects(post?.afterDurableCheckpoint);
  expect(f.sends()).toBe(2);
});

it("publishes an accepted reply boundary when its obligation bubble yields", async () => {
  const f = await fixture("linq");
  vi.setSystemTime(new Date(Date.now() + 1));
  const remaining = await createAssistantOutboxIntent({ ...f.base, dedupeToken: "obligation-bubble", followUpRequest });
  const effects = await f.collect([f.intent.intentId, remaining.intentId]);
  expect(effects).toHaveLength(2);
  expect(effects[0]?.effectId).toBe(f.intent.intentId);
  expect(effects.every((effect) => effect.publishAfterDispatch && !effect.publishBeforeDispatch)).toBe(true);
  mocks.collectHostedAssistantDeliverySideEffects.mockResolvedValueOnce(effects);
  let yieldNow = false;
  const send = f.providerFetch.getMockImplementation()!;
  f.providerFetch.mockImplementation(async (...args) => {
    const response = await send(...args);
    if (!String(args[0]).includes("/typing")) yieldNow = true;
    return response;
  });
  const { post } = await f.phase("general", [f.intent.intentId, remaining.intentId], () => yieldNow);
  expect(f.sends()).toBe(1);
  expect(await f.read(remaining.intentId)).toMatchObject({ status: "pending", delivery: null });
  expect(post.afterDurableCheckpoint?.map((hook) => hook.checkpointStartByMs)).toContain(Date.now());
  await f.publish();
  await f.restore();
  expect(await f.read(remaining.intentId)).toMatchObject({ intentId: remaining.intentId, followUpRequest });
});

it.each(["text", "voice"] as const)("publishes earlier bubbles when a non-idempotent boundary carries a %s obligation", async (obligation) => {
  const f = await fixture("linq", obligation === "text" ? { followUpRequest } : {});
  vi.setSystemTime(new Date(Date.now() + 1));
  const voice = await createAssistantOutboxIntent({
    ...f.base, dedupeToken: "voice-obligation-bubble",
    followUpRequest: obligation === "voice" ? followUpRequest : undefined,
    media: [{
      kind: "voice_memo", filename: "memo.mp3", transcript: "Requested voice reply.",
      transport: { kind: "linq_attachment", attachmentId: "attachment_voice_boundary" },
    }],
  });
  expect(voice.deliveryTransportIdempotent).toBe(false);
  const effects = await f.collect([f.intent.intentId, voice.intentId]);
  expect(effects.map((effect) => effect.effectId)).toEqual([f.intent.intentId, voice.intentId]);
  expect(effects.every((effect) => effect.publishBeforeDispatch && !effect.publishAfterDispatch)).toBe(true);
  const { post } = await f.phase("foreground", [f.intent.intentId, voice.intentId]);
  expect(f.providerFetch).not.toHaveBeenCalled();
  expect(f.consumed.size).toBe(0);
  await f.publish();
  await runHostedWorkspaceDurableCheckpointEffects(post.afterDurableCheckpoint);
  expect(await f.read()).toMatchObject({ status: "sent" });
  expect(await f.read(voice.intentId)).toMatchObject({ status: "sent" });
  expect(f.wireKeys.filter((key) => key === "missing")).toHaveLength(1);
  expect(f.consumed.has("mailbox_publication")).toBe(true);
});

it.each(["fresh", "published"] as const)("does not treat %s Linq voice provider entry as acceptance or settle its obligation after restore", async (claim) => {
  const f = await fixture("linq", { followUpRequest, media: [{
    kind: "voice_memo", filename: "memo.mp3", transcript: "Requested voice reply.",
    transport: { kind: "linq_attachment", attachmentId: "attachment_voice_publication" },
  }] });
  expect(f.intent.deliveryTransportIdempotent).toBe(false);
  if (claim === "published") f.setCheckpoint(NOW);
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
