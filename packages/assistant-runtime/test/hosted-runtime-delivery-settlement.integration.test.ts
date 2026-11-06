import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeVault, readMemoryDocument, registerAutomationFollowUp, upsertMemory } from "@murphai/core";
import { listAutomations } from "@murphai/query";
import {
  createAssistantOutboxIntent, readAssistantOutboxIntent, saveAssistantOutboxIntent,
} from "@murphai/assistant-engine/assistant-outbox";
import { findAssistantAutoReplyDeliveryIntentIds } from "@murphai/assistant-engine";
import { saveAssistantAutomationState } from "@murphai/assistant-engine/assistant-state";
import { DAILY_NUTRITION_OPTIONAL_GOALS_INTRO } from "@murphai/operator-config/assistant-response-cards";
import type { AssistantResponseMedia } from "@murphai/operator-config/assistant-cli-contracts";
import { serializeHostedEmailThreadTarget } from "@murphai/runtime-state";
import { buildHostedExecutionRuntimeTimerWake } from "@murphai/hosted-execution";
import type { HostedRuntimeActionApprovalPort } from "../src/hosted-runtime/platform.ts";
import {
  collectHostedAssistantDeliverySideEffects, drainHostedPreparedAssistantDeliveries,
  drainHostedAssistantDeliveryControlPlaneWritesBestEffort,
  prepareHostedAssistantDeliveryEffectsForDispatch, resolveHostedAssistantOutboxNextWakeAt,
} from "../src/hosted-runtime/callbacks.ts";
import { createHostedRuntimeEffectsPortStub } from "./hosted-runtime-test-helpers.ts";

// Only the two canonical settlement writes can fail; subsequent calls run the real writer.
vi.mock("@murphai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@murphai/core")>();
  return { ...actual, registerAutomationFollowUp: vi.fn(actual.registerAutomationFollowUp), upsertMemory: vi.fn(actual.upsertMemory) };
});

const roots: string[] = [];
const approvalGeneration = "b".repeat(64);
const approvalId = `haa_${"a".repeat(32)}`;
const followUpRequest = { afterMinutes: 15, instructions: "Check whether the requested task is complete." };
const env = { TELEGRAM_BOT_TOKEN: "bot-token", TELEGRAM_API_BASE_URL: "https://telegram.test", ELEVENLABS_API_KEY: "synthetic-key" };
const voice: AssistantResponseMedia = {
  kind: "voice_memo", filename: "memo.mp3", transcript: "Here is the requested transcript.",
  transport: { kind: "telegram_generation", generation: { kind: "elevenlabs_speech", modelId: "eleven_multilingual_v2", outputFormat: "mp3_44100_128", text: "Here is the requested transcript.", voiceId: "voice_murph" } },
};

function transportFailure() {
  return Object.assign(new Error("Synthetic response lost"), { code: "ECONNRESET", hostedRuntimeControlPlaneFetchFailure: true });
}
function acceptedTelegram() {
  return Response.json({ ok: true, result: { message_id: 7, chat: { id: 123 } } });
}
function rejectedTelegram() {
  return Response.json({ ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 0.001 } }, { status: 429 });
}

async function fixture(channel: "email" | "telegram", options: {
  targetKind?: "explicit" | "thread"; message?: string; media?: AssistantResponseMedia[];
  card?: Parameters<typeof createAssistantOutboxIntent>[0]["card"];
  operation?: Parameters<typeof createAssistantOutboxIntent>[0]["operation"]; replyToMessageId?: string;
  followUp?: boolean; autoReply?: boolean;
} = {}) {
  const root = await mkdtemp(path.join(process.env.MURPH_VITEST_TEMP_ROOT!, "delivery-settlement-"));
  roots.push(root);
  const vaultRoot = path.join(root, "vault");
  await initializeVault({ vaultRoot, createdAt: new Date().toISOString() });
  const target = channel === "telegram" ? "123" : options.targetKind === "thread"
    ? serializeHostedEmailThreadTarget({ to: ["member@example.test"], cc: [], subject: "Reply", lastMessageId: null, references: [] })
    : "member@example.test";
  const intent = await createAssistantOutboxIntent({
    bindingDelivery: { kind: "thread", target }, channel,
    ...(channel === "email" && options.targetKind !== "thread" ? { explicitTarget: target } : {}),
    deliveryTransportIdempotent: options.operation?.kind === "message-reaction", dedupeToken: "settlement-proof", media: options.media,
    card: options.card, operation: options.operation, replyToMessageId: options.replyToMessageId,
    message: options.message ?? "Here is the requested reply.", sessionId: "session_settlement",
    threadId: target, threadIsDirect: true, turnId: "turn_settlement", vault: vaultRoot,
    ...(options.followUp ? { followUpRequest } : {}),
    ...(options.autoReply ? { turnTrigger: "automation-auto-reply" as const } : {}),
  });
  const sendEmail = vi.fn(async () => ({ target }));
  const providerFetch = vi.fn<typeof fetch>(async () => acceptedTelegram());
  const effectsPort = createHostedRuntimeEffectsPortStub({
    sendEmail, resolveCurrentVerifiedEmailRecipient: async () => "member@example.test",
  });
  const collect = () => collectHostedAssistantDeliverySideEffects({ includeBackgroundDueIntents: true, messageVolumeReceiptPort: effectsPort, vaultRoot });
  const read = async () => {
    const current = await readAssistantOutboxIntent(vaultRoot, intent.intentId);
    if (!current) throw new Error("Missing outbox intent");
    return current;
  };
  const drain = async (overrides: Partial<Parameters<typeof drainHostedPreparedAssistantDeliveries>[0]> = {}) => {
    const assistantDeliveryEffects = overrides.assistantDeliveryEffects ?? await collect();
    // Due non-idempotent retries now require the prepared claim used by production.
    const preparation = overrides.preparedDispatches ? null : await prepareHostedAssistantDeliveryEffectsForDispatch({ assistantDeliveryEffects, vaultRoot });
    return drainHostedPreparedAssistantDeliveries({
      allowPreparedSending: true, preparedDispatches: preparation?.preparedDispatches,
      assistantDeliveryEffects, effectsPort, forwardedEnv: env, platformEnv: {}, providerFetch,
      vaultRoot, wake: buildHostedExecutionRuntimeTimerWake({ eventId: "evt_settlement", occurredAt: new Date().toISOString(), triggerKind: "runtime_timer", userId: "member_synthetic" }),
      ...overrides,
    });
  };
  const advance = async () => {
    const current = await read();
    vi.setSystemTime(new Date(current.nextAttemptAt ?? Date.now() + 60_000));
  };
  return { intent, vaultRoot, sendEmail, providerFetch, effectsPort, collect, read, drain, advance,
    wake: () => resolveHostedAssistantOutboxNextWakeAt({ vaultRoot }) };
}

async function assertParked(f: Awaited<ReturnType<typeof fixture>>, code = "ASSISTANT_DELIVERY_AMBIGUOUS") {
  expect(await f.read()).toMatchObject({ status: "abandoned", lastError: { code }, nextAttemptAt: null });
  await f.advance();
  expect(await f.collect()).toEqual([]);
  expect(await f.drain()).toEqual([]);
  expect(await f.wake()).toBeNull();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-04T12:00:00.000Z"));
  vi.mocked(registerAutomationFollowUp).mockClear();
  vi.mocked(upsertMemory).mockClear();
});
afterEach(async () => {
  await drainHostedAssistantDeliveryControlPlaneWritesBestEffort();
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe.sequential("hosted delivery settlement", () => {
  describe.each(["explicit", "thread"] as const)("email %s recipient", (targetKind) => {
    it.each(["connection", "500", "timeout", "port-liveness", "liveness"] as const)("parks an unproved %s outcome", async (failure) => {
      const f = await fixture("email", { targetKind });
      const reason = failure === "connection" ? transportFailure() : failure === "500"
        ? Object.assign(new Error("Synthetic HTTP 500"), { status: 500 })
        : Object.assign(new Error("Synthetic request timed out"), { name: "TimeoutError" });
      if (failure === "port-liveness") {
        // The platform's post-run guard rejects inside sendEmail after acceptance.
        const accept = f.sendEmail.getMockImplementation()!;
        f.sendEmail.mockImplementationOnce(async () => { await accept(); throw reason; });
      } else if (failure !== "liveness") f.sendEmail.mockRejectedValueOnce(reason);
      const outcomes = await f.drain({ assertLiveness: async () => {
        if (failure === "liveness" && f.sendEmail.mock.calls.length) throw reason;
      } });
      expect(outcomes).toEqual([expect.objectContaining({ retryable: false })]);
      await assertParked(f);
      expect(f.sendEmail).toHaveBeenCalledOnce();
      expect(reason).not.toHaveProperty("deliveryMayHaveSucceeded", true);
    });

    it("retries a proven skip without duplicating a binding send", async () => {
      const f = await fixture("email", { targetKind });
      f.sendEmail.mockRejectedValueOnce(Object.assign(transportFailure(), { deliveryMayHaveSucceeded: false, retryable: true }));
      expect(await f.drain()).toEqual([expect.objectContaining({ deliveryStatus: "retryable" })]);
      await f.advance();
      expect(await f.drain()).toEqual([expect.objectContaining({ deliveryStatus: "sent" })]);
      expect(f.sendEmail).toHaveBeenCalledTimes(2); // One skipped request, one binding send.
    });

    it("keeps an abort during recipient lookup outside provider entry", async () => {
      const f = await fixture("email", { targetKind });
      const controller = new AbortController();
      const abortReason = transportFailure();
      f.effectsPort.resolveCurrentVerifiedEmailRecipient = async () => {
        controller.abort(abortReason);
        return "member@example.test";
      };
      await expect(f.drain({ signal: controller.signal })).rejects.toBe(abortReason);
      expect(f.sendEmail).not.toHaveBeenCalled();
      expect((await f.read()).lastError?.code).not.toBe("ASSISTANT_DELIVERY_AMBIGUOUS");
      expect(["pending", "retryable"]).toContain((await f.read()).status);
    });
  });

  it.each(["unknown", "accepted", "rejected", "companion"] as const)("preserves Telegram transcript fallback: %s", async (fallback) => {
    const f = await fixture("telegram", { media: [voice], message: fallback === "companion" ? "Companion text." : "" });
    let messages = 0;
    f.providerFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://api.elevenlabs.io/")) return new Response(new Uint8Array(readFileSync(new URL("../../../fixtures/generated-audio/speech.mp3", import.meta.url))), { headers: { "content-type": "audio/mpeg" } });
      if (url.endsWith("/sendVoice")) return rejectedTelegram();
      expect(url).toContain("/sendMessage");
      messages += 1;
      if (fallback === "accepted" || (fallback === "companion" && messages === 1)) return acceptedTelegram();
      if (fallback === "rejected") return rejectedTelegram();
      throw transportFailure();
    });
    await f.drain();
    if (fallback === "accepted") {
      expect(await f.read()).toMatchObject({ status: "sent" });
    } else if (fallback === "rejected") {
      expect(await f.read()).toMatchObject({ status: "retryable" });
      return;
    } else {
      await assertParked(f);
      if (fallback === "companion") {
        expect((await f.read()).delivery).toMatchObject({ providerMessageIds: ["7"] });
      }
    }
    const calls = f.providerFetch.mock.calls.length;
    await f.advance();
    await f.drain();
    expect(f.providerFetch).toHaveBeenCalledTimes(calls);
  });

  it.each(["voice transcript", "text", "voice memo"] as const)("preserves an accepted Telegram %s receipt when liveness is lost", async (kind) => {
    const f = await fixture("telegram", kind === "text" ? {} : { media: [voice], message: "" });
    let accepted = false;
    const assertLiveness = async () => {
      if (accepted) throw new Error("Synthetic liveness lost after Telegram acceptance");
    };
    f.providerFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("https://api.elevenlabs.io/")) return new Response(new Uint8Array(readFileSync(new URL("../../../fixtures/generated-audio/speech.mp3", import.meta.url))), { headers: { "content-type": "audio/mpeg" } });
      if (kind === "voice transcript" && url.endsWith("/sendVoice")) return rejectedTelegram();
      expect(url).toContain(kind === "voice memo" ? "/sendVoice" : "/sendMessage");
      accepted = true;
      return acceptedTelegram();
    });

    await f.drain({ assertLiveness });
    expect.soft(await f.read()).toMatchObject({
      status: "sent",
      delivery: kind === "text" ? { providerMessageId: "7" } : { providerMessageIds: ["7"] },
    });
    expect(f.providerFetch.mock.calls.some(([input]) => String(input).endsWith("/sendVoice"))).toBe(kind !== "text");
    expect(f.providerFetch.mock.calls.filter(([input]) => String(input).endsWith("/sendMessage"))).toHaveLength(kind === "voice memo" ? 0 : 1);
    const calls = f.providerFetch.mock.calls.length;
    await f.advance();
    await f.drain();
    expect(f.providerFetch).toHaveBeenCalledTimes(calls);
  });

  it.each(["rich card", "file", "image", "reaction"] as const)("preserves an accepted Telegram %s receipt when the runtime aborts after the response", async (kind) => {
    const bytes = Buffer.from("%PDF-1.4\nSynthetic file\n%%EOF\n");
    const file: AssistantResponseMedia = { kind: "vault_file", approvalGeneration, approvalId, ref: "documents/report.pdf", filename: "report.pdf", contentType: "application/pdf", sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length };
    const f = await fixture("telegram", {
      ...(kind === "rich card" ? { card: { kind: "telegram_rich_content", version: 1, html: "<h2>Card</h2>" } } : {}),
      ...(kind === "file" ? { media: [file], message: "" } : {}),
      ...(kind === "image" ? { media: [{ kind: "image", source: "test", url: "https://example.test/image.png", alt: "Synthetic image" }] } : {}),
      ...(kind === "reaction" ? { operation: { kind: "message-reaction", reaction: "heart" }, replyToMessageId: "42", message: "" } : {}),
    });
    let actionApprovalPort: HostedRuntimeActionApprovalPort | undefined;
    if (kind === "file") {
      await mkdir(path.join(f.vaultRoot, "documents"), { recursive: true });
      await writeFile(path.join(f.vaultRoot, file.ref), bytes);
      actionApprovalPort = { consume: async () => ({ approvalGeneration, approvalId, status: "approved" }), read: async () => { throw new Error("Unexpected read"); }, request: async () => { throw new Error("Unexpected request"); } };
    }
    const controller = new AbortController();
    const reason = new DOMException("The operation timed out.", "TimeoutError");
    const operation = { "rich card": "/sendRichMessage", file: "/sendDocument", image: "/sendPhoto", reaction: "/setMessageReaction" }[kind];
    // Abort after the sender parsed acceptance; an in-flight abort is unknown and stays ambiguous.
    f.providerFetch.mockImplementation(async (input) => {
      const url = String(input);
      expect(url.endsWith(operation)).toBe(true);
      const response = Response.json({ ok: true, result: kind === "reaction" ? true : { message_id: 7, chat: { id: 123 } } });
      Object.defineProperty(response, "ok", { get: () => { controller.abort(reason); return true; } });
      return response;
    });

    await expect(f.drain({ actionApprovalPort, signal: controller.signal })).rejects.toBe(reason);
    expect(await f.read()).toMatchObject({
      status: "sent",
      delivery: kind === "reaction" ? { kind: "message-reaction", targetMessageId: "42" }
        : { providerMessageId: "7" },
    });
    expect(f.providerFetch.mock.calls.filter(([input]) => String(input).endsWith(operation))).toHaveLength(1);
    expect(f.providerFetch).toHaveBeenCalledOnce();
    const calls = f.providerFetch.mock.calls.length;
    await f.advance();
    await f.drain({ actionApprovalPort });
    expect(f.providerFetch).toHaveBeenCalledTimes(calls);
    expect(await f.wake()).toBeNull();
  });

  describe.each(["telegram", "email"] as const)("accepted %s settlement", (channel) => {
    it.each(["follow-up", "nutrition", "partial", "disabled"] as const)("wakes and confirms %s without resending", async (kind) => {
      const nutrition = kind !== "follow-up";
      const followUp = kind !== "nutrition";
      const f = await fixture(channel, { followUp, message: nutrition ? DAILY_NUTRITION_OPTIONAL_GOALS_INTRO : undefined, autoReply: kind === "disabled" });
      if (kind === "disabled") await saveAssistantAutomationState(f.vaultRoot, {
        autoReply: [{ channel, eligibleAfter: null, enabledAt: new Date().toISOString() }], version: 1, updatedAt: new Date().toISOString(),
      });
      if (kind === "follow-up") vi.mocked(registerAutomationFollowUp).mockRejectedValueOnce(new Error("Synthetic registration unavailable"));
      else vi.mocked(upsertMemory).mockRejectedValueOnce(new Error("Synthetic memory unavailable"));
      expect(await f.drain()).toEqual([expect.objectContaining({ deliveryStatus: "retryable" })]);
      const pending = await f.read();
      expect(pending).toMatchObject({ deliveryConfirmationPending: true, delivery: expect.any(Object), lastError: { code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING" } });
      expect(await listAutomations(f.vaultRoot)).toHaveLength(kind === "partial" || kind === "disabled" ? 1 : 0);
      expect((await readMemoryDocument(f.vaultRoot)).records).toHaveLength(0);
      expect(pending.nextAttemptAt).not.toBeNull();
      expect(await f.wake()).toBe(pending.nextAttemptAt);
      if (kind === "disabled") {
        expect(await findAssistantAutoReplyDeliveryIntentIds({ intents: [pending], vault: f.vaultRoot })).toEqual(new Set([pending.intentId]));
        await saveAssistantAutomationState(f.vaultRoot, {
          autoReply: [], version: 1, updatedAt: new Date().toISOString(),
        });
      }
      await f.advance();
      expect(await f.collect()).toHaveLength(1);
      expect(await f.drain()).toEqual([expect.objectContaining({ deliveryStatus: "sent" })]);
      expect(await f.read()).toMatchObject({ status: "sent", deliveryConfirmationPending: false });
      expect(channel === "email" ? f.sendEmail : f.providerFetch).toHaveBeenCalledOnce();
      expect(await listAutomations(f.vaultRoot)).toHaveLength(followUp ? 1 : 0);
      expect((await readMemoryDocument(f.vaultRoot)).records).toHaveLength(nutrition ? 1 : 0);
    });
  });

  it.each(["accepted", "unaccepted"] as const)("orders a later same-boundary reply behind an %s retryable predecessor", async (acceptance) => {
    const accepted = acceptance === "accepted";
    const f = await fixture("email", { followUp: accepted });
    if (accepted) {
      vi.mocked(registerAutomationFollowUp).mockRejectedValueOnce(new Error("Synthetic confirmation unavailable"));
    } else {
      f.sendEmail.mockRejectedValueOnce(Object.assign(transportFailure(), { deliveryMayHaveSucceeded: false, retryable: true }));
    }
    expect(await f.drain()).toEqual([expect.objectContaining({ deliveryStatus: "retryable" })]);
    const predecessor = await f.read();
    expect(predecessor).toMatchObject({
      status: "retryable", delivery: accepted ? expect.any(Object) : null,
      deliveryConfirmationPending: accepted, nextAttemptAt: expect.any(String),
    });
    expect(f.sendEmail).toHaveBeenCalledOnce();
    expect(await listAutomations(f.vaultRoot)).toHaveLength(0);
    const deadline = predecessor.nextAttemptAt!;
    vi.setSystemTime(new Date(Date.now() + 1));
    const later = await createAssistantOutboxIntent({
      bindingDelivery: f.intent.bindingDelivery, channel: "email", explicitTarget: f.intent.explicitTarget,
      deliveryTransportIdempotent: false, dedupeToken: "settlement-proof-later",
      message: "Here is the later reply.", sessionId: f.intent.sessionId,
      threadId: f.intent.threadId, threadIsDirect: true, turnId: f.intent.turnId, vault: f.vaultRoot,
    });
    expect.soft((await f.collect()).map((effect) => effect.effectId)).toEqual(accepted ? [later.intentId] : []);
    const earlierWake = new Date(Math.floor((Date.now() + Date.parse(deadline)) / 2)).toISOString();
    expect(Date.parse(earlierWake)).toBeGreaterThan(Date.now());
    expect(Date.parse(earlierWake)).toBeLessThan(Date.parse(deadline));
    await saveAssistantOutboxIntent(f.vaultRoot, { ...later, nextAttemptAt: earlierWake });
    expect.soft(await f.wake()).toBe(accepted ? earlierWake : deadline);
    vi.setSystemTime(new Date(earlierWake));
    if (!accepted) {
      expect(await f.collect()).toEqual([]);
      expect(await f.drain()).toEqual([]);
      expect(f.sendEmail).toHaveBeenCalledOnce();
      return;
    }
    expect(await f.drain()).toEqual([expect.objectContaining({ deliveryStatus: "sent" })]);
    expect(await readAssistantOutboxIntent(f.vaultRoot, later.intentId)).toMatchObject({ status: "sent" });
    expect(await f.read()).toMatchObject({ status: "retryable", nextAttemptAt: deadline });
    expect(await listAutomations(f.vaultRoot)).toHaveLength(0);
    expect(await f.wake()).toBe(deadline);
    vi.setSystemTime(new Date(deadline));
    expect(await f.drain()).toEqual([expect.objectContaining({ deliveryStatus: "sent" })]);
    expect(await f.read()).toMatchObject({ status: "sent", deliveryConfirmationPending: false });
    expect(await listAutomations(f.vaultRoot)).toHaveLength(1);
    expect(f.sendEmail).toHaveBeenCalledTimes(2);
    expect(f.sendEmail).toHaveBeenNthCalledWith(1, expect.objectContaining({ message: f.intent.message }));
    expect(f.sendEmail).toHaveBeenNthCalledWith(2, expect.objectContaining({ message: later.message }));
  });

  it("parks confirmation without accepted delivery evidence", async () => {
    const f = await fixture("telegram", { followUp: true });
    await saveAssistantOutboxIntent(f.vaultRoot, { ...f.intent, status: "retryable", delivery: null, deliveryConfirmationPending: true,
      nextAttemptAt: new Date().toISOString(), lastError: { code: "ASSISTANT_DELIVERY_CONFIRMATION_PENDING", message: "Unknown delivery" } });
    expect(await f.collect()).toEqual([]);
    expect(await f.wake()).toBeNull();
    await f.drain();
    expect(f.providerFetch).not.toHaveBeenCalled();
  });

  it.each(["before-commit", "after-commit", "denied", "expired", "pending", "conflict", "identity", "bytes"] as const)("approval consume: %s", async (failure) => {
    const bytes = Buffer.from("%PDF-1.4\nSynthetic file\n%%EOF\n");
    const media: AssistantResponseMedia = { kind: "vault_file", approvalGeneration, approvalId, ref: "documents/report.pdf", filename: "report.pdf", contentType: "application/pdf", sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length };
    const f = await fixture("telegram", { media: [media], message: "" });
    await mkdir(path.join(f.vaultRoot, "documents"), { recursive: true });
    await writeFile(path.join(f.vaultRoot, media.ref), bytes);
    let committed = false;
    const consume = vi.fn<HostedRuntimeActionApprovalPort["consume"]>(async () => {
      if (failure === "denied" || failure === "expired") return { approvalId, status: failure };
      if (failure === "pending") return { approvalId, status: "pending", approvalUrl: "https://example.test/approval", expiresAt: "2026-09-04T12:15:00.000Z" };
      if (failure === "conflict") throw Object.assign(new Error("Approval identity conflict"), { status: 409, statusCode: 409 });
      if (consume.mock.calls.length === 1 && (failure === "before-commit" || failure === "after-commit")) {
        committed = failure === "after-commit";
        throw transportFailure();
      }
      committed = true;
      return { approvalGeneration, approvalId, status: "approved" };
    });
    const actionApprovalPort: HostedRuntimeActionApprovalPort = { consume, read: async () => { throw new Error("Unexpected read"); }, request: async () => { throw new Error("Unexpected request"); } };
    const effects = await f.collect();
    const prepared = await prepareHostedAssistantDeliveryEffectsForDispatch({ assistantDeliveryEffects: effects, vaultRoot: f.vaultRoot });
    if (failure === "bytes") await writeFile(path.join(f.vaultRoot, media.ref), Buffer.from("changed bytes"));
    await f.drain({ assistantDeliveryEffects: effects, actionApprovalPort, allowPreparedSending: true, ...prepared,
      assertLiveness: async () => {
        if (failure === "identity") await saveAssistantOutboxIntent(f.vaultRoot, { ...await f.read(), media: [{ ...media, filename: "changed.pdf" }] });
      },
    });
    expect(f.providerFetch).not.toHaveBeenCalled();
    if (failure === "before-commit" || failure === "after-commit") {
      expect(committed).toBe(failure === "after-commit");
      expect(await f.read()).toMatchObject({ status: "retryable", lastError: { code: "ECONNRESET", message: "Synthetic response lost" } });
      await f.advance();
      const due = await f.collect();
      const retryPrepared = await prepareHostedAssistantDeliveryEffectsForDispatch({ assistantDeliveryEffects: due, vaultRoot: f.vaultRoot });
      expect(await f.drain({ assistantDeliveryEffects: due, actionApprovalPort, allowPreparedSending: true, ...retryPrepared })).toEqual([expect.objectContaining({ deliveryStatus: "sent" })]);
      expect(f.providerFetch).toHaveBeenCalledOnce();
      expect(consume).toHaveBeenCalledTimes(2);
      expect(consume.mock.calls[0]?.[0]).toEqual(consume.mock.calls[1]?.[0]);
      expect(consume.mock.calls[0]?.[0]).toMatchObject({ approvalGeneration, consumerId: `assistant-outbox:${f.intent.intentId}` });
    } else {
      expect(await f.read()).toMatchObject({ status: "failed" });
      expect(await f.wake()).toBeNull();
      await f.advance();
      expect(await f.collect()).toEqual([]);
    }
  });

  it.each(["receipt-first-success", "confirmation-first-success", "receipt-first-failure", "confirmation-first-failure"] as const)("keeps settlement's deadline across accounting writes: %s", async (order) => {
    const f = await fixture("email", { followUp: true });
    let resolveReceipt!: (receipt: { recordedAt: string }) => void;
    let rejectReceipt!: (error: Error) => void;
    const receipt = new Promise<{ recordedAt: string }>((resolve, reject) => {
      resolveReceipt = resolve;
      rejectReceipt = reject;
    });
    const record = vi.fn()
      .mockImplementationOnce(() => receipt)
      .mockImplementation(async () => ({ recordedAt: new Date().toISOString() }));
    f.effectsPort.recordOutboundMessageVolumeReceipt = record;
    vi.mocked(registerAutomationFollowUp).mockRejectedValueOnce(new Error("Synthetic confirmation unavailable"));
    await f.drain();
    const pending = await f.read();
    expect(pending).toMatchObject({ status: "retryable", messageVolumeReceiptRecordedAt: null });
    const confirmationFirst = order.startsWith("confirmation-first");
    const success = order.endsWith("success");
    try {
      if (confirmationFirst) {
        await f.advance();
        expect(await f.drain()).toEqual([expect.objectContaining({ deliveryStatus: "sent" })]);
      }
    } finally {
      if (success) resolveReceipt({ recordedAt: new Date().toISOString() });
      else rejectReceipt(transportFailure());
      await drainHostedAssistantDeliveryControlPlaneWritesBestEffort();
    }
    let current = await f.read();
    expect(current.messageVolumeReceiptRecordedAt).toBe(success ? new Date().toISOString() : null);
    if (!confirmationFirst) {
      expect(current.nextAttemptAt).toBe(pending.nextAttemptAt);
      expect(await f.wake()).toBe(pending.nextAttemptAt);
      await f.advance();
      expect(await f.drain()).toEqual([expect.objectContaining({ deliveryStatus: "sent" })]);
      await drainHostedAssistantDeliveryControlPlaneWritesBestEffort();
    }
    current = await f.read();
    if (!success && current.messageVolumeReceiptRecordedAt === null) {
      expect(current.nextAttemptAt).not.toBeNull();
      expect(await f.wake()).toBe(current.nextAttemptAt);
      await f.advance();
      await f.drain();
      await drainHostedAssistantDeliveryControlPlaneWritesBestEffort();
    }
    expect(await f.read()).toMatchObject({ status: "sent", nextAttemptAt: null, messageVolumeReceiptRecordedAt: expect.any(String) });
    expect(await f.wake()).toBeNull();
    expect(record).toHaveBeenCalledTimes(success ? 1 : 2);
    expect(f.sendEmail).toHaveBeenCalledOnce();
    expect(await listAutomations(f.vaultRoot)).toHaveLength(1);
  });
});
