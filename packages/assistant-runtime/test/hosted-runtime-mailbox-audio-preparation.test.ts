import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, test, vi } from "vitest";
import { initializeVault } from "@murphai/core";
import {
  conversationRefFromAssistantInputConversation,
  createAssistantActiveTurnInputController,
  listAssistantInputEvents,
  readAssistantInputEvent,
  resolveAssistantConversationLookupKey,
} from "@murphai/assistant-engine";
import { createParserRegistry } from "@murphai/parsers";
import { createIntegratedInboxServices } from "@murphai/inbox-services";
import * as channelAdapters from "@murphai/assistant-engine/assistant-channel-adapters";
import type { HostedExecutionConversationMessageWake } from "@murphai/hosted-execution/contracts";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  type HostedMailboxItem,
} from "@murphai/hosted-execution/runtime-control";
import { createHostedConversationMailboxImportItem } from "../src/hosted-runtime/mailbox-conversation-import.ts";
import { fetchAndProcessHostedMailboxPrefix } from "../src/hosted-runtime/mailbox-import.ts";
import { createEmptyHostedMailboxImportState } from "../src/hosted-runtime/mailbox-state.ts";
import { readHostedPendingAssistantInputIds } from "../src/hosted-runtime/pending-input-index.ts";
import { selectHostedAssistantInputIds } from "../src/hosted-runtime/turn-input.ts";

// Only external parser selection and a transient runtime-read fault are synthetic.
// Normalization, raw capture writes, SQLite claims, parser preparation/publication,
// assistant evidence, pending index, grouping, and the mailbox loop are real.
const probes = vi.hoisted(() => ({
  configure: vi.fn(),
  activePreparations: 0,
  closeActiveCounts: [] as number[],
  failNextFailureRead: false,
}));
vi.mock("@murphai/parsers", async (importOriginal) => ({
  ...await importOriginal<typeof import("@murphai/parsers")>(),
  createConfiguredParserRegistry: probes.configure,
}));
vi.mock("@murphai/inboxd/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@murphai/inboxd/runtime")>();
  return {
    ...actual,
    async openInboxRuntime(input: Parameters<typeof actual.openInboxRuntime>[0]) {
      const runtime = await actual.openInboxRuntime(input);
      const list = runtime.listAttachmentParseJobs;
      runtime.listAttachmentParseJobs = (filters) => {
        if (probes.failNextFailureRead && filters?.state === "failed") {
          probes.failNextFailureRead = false;
          throw new Error("Synthetic parser result read unavailable.");
        }
        return list(filters);
      };
      const close = runtime.close;
      runtime.close = () => {
        probes.closeActiveCounts.push(probes.activePreparations);
        close();
      };
      return runtime;
    },
  };
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
  probes.configure.mockReset();
  probes.failNextFailureRead = false;
  probes.closeActiveCounts.length = 0;
  assert.equal(probes.activePreparations, 0);
});

describe.sequential("hosted consecutive audio preparation", () => {
  test.each(["success", "retry", "abort"] as const)(
    "preserves attachment typing during parallel preparation and cleans up on %s",
    async (scenario) => {
      const stop = vi.fn(async () => {});
      const start = vi.spyOn(channelAdapters, "startLinqTypingIndicator")
        .mockResolvedValue({ stop, isActive: () => true });
      const fixture = await createFixture(2, { typing: true });
      const abort = new AbortController();
      if (scenario === "retry") probes.failNextFailureRead = true;
      const operation = fixture.run({ signal: abort.signal });
      try {
        await observeBarrier(Promise.all(fixture.started.map((gate) => gate.promise)));
        assert.equal(start.mock.calls.length, 1);
        assert.deepEqual(await fixture.pending(), []);
        assert.equal(stop.mock.calls.length, 0);
        if (scenario === "abort") abort.abort(new Error("Synthetic paired typing preemption."));
        fixture.releaseAll();
        if (scenario === "abort") {
          await assert.rejects(operation, /Synthetic paired typing preemption/u);
        } else {
          const result = await operation;
          assert.equal(result.importedCount, scenario === "success" ? 2 : 0);
        }
        if (scenario === "success") assert.equal(stop.mock.calls.length, 0);
        else await vi.waitFor(() => assert.equal(stop.mock.calls.length, 1));
      } finally {
        abort.abort();
        fixture.releaseAll();
        await operation.catch(() => undefined);
        await vi.waitFor(() => assert.equal(stop.mock.calls.length, 1));
      }
    },
  );

  test("overlaps two separate messages, joins reverse completion, then admits one ordered combined batch", async () => {
    const fixture = await createFixture(3);
    const operation = fixture.run();
    // A watchdog detects a deadlocked regression; elapsed time is NOT a success assertion.
    // On the original snapshot, the second provider never enters this barrier.
    await observeBarrier(Promise.all([fixture.started[0]!.promise, fixture.started[1]!.promise]));
    assert.deepEqual([...fixture.calls].sort((left, right) => left - right), [1, 2]);
    assert.equal(fixture.maximumActive(), 2);
    assert.deepEqual(await fixture.pending(), []);
    const staged = await listAssistantInputEvents({ vault: fixture.vaultRoot });
    assert.equal(staged.events.length, 2);
    assert.ok(staged.events.every((event) => event.projection.status === "pending"));
    const stagedConversation = staged.events[0]!.conversation;
    assert.ok(stagedConversation);
    const conversation = conversationRefFromAssistantInputConversation(stagedConversation);
    const conversationKey = resolveAssistantConversationLookupKey({ conversation });
    assert.ok(conversationKey);
    const notified: string[] = [];
    const controller = createAssistantActiveTurnInputController({
      conversationKeys: [conversationKey],
      vault: fixture.vaultRoot,
      sessionId: "session_audio_fixture",
      turnId: "turn_audio_fixture",
      async admissionHook(input) {
        for (const inputId of input.availableInputIds ?? []) {
          const event = await readAssistantInputEvent({ inputId, vault: fixture.vaultRoot });
          assert.equal(event?.attachmentEvidence?.status, "available");
          assert.equal(event?.attachmentEvidence?.attachments[0]?.parseState, "succeeded");
          notified.push(inputId);
        }
        return { kind: "no-new-input" };
      },
    });
    try {
      fixture.release(2);
      await fixture.finished[1]!.promise;
      assert.deepEqual(notified, []);
      assert.deepEqual(await fixture.pending(), []);
      assert.deepEqual([...fixture.calls].sort((left, right) => left - right), [1, 2]); // third never exceeds the cap
      const jobs = await fixture.jobs();
      assert.equal(jobs.length, 2);
      assert.ok(jobs.every((job) => job.state === "running")); // no out-of-order publication
      fixture.release(1);
      await observeBarrier(fixture.started[2]!.promise);
      fixture.release(3);
      const result = await operation;
      assert.deepEqual(result.blocked, []);
      assert.equal(result.state.watermarks.conversation, "3");
      assert.equal(result.importedCount, 3);
      assert.equal(result.conversationImportTiming?.audioPairCount, 1);
      assert.equal(fixture.maximumActive(), 2);
      assert.deepEqual([...fixture.calls].sort((left, right) => left - right), [1, 2, 3]);
      await fixture.assertEvidenceOrder(result.assistantInputIds ?? []);
      assert.deepEqual(await fixture.pending(), result.assistantInputIds);
      assert.deepEqual([...new Set(notified)], result.assistantInputIds);
      // A no-new-input hook deliberately leaves IDs available for the controller's
      // next probe. Check unique durable admissions, not those repeated probes.
      assert.equal(new Set(result.assistantInputIds).size, 3);
      assert.equal((await listAssistantInputEvents({ vault: fixture.vaultRoot })).events.length, 3);
      const selection = await selectHostedAssistantInputIds({
        mode: "foreground", freshAssistantInputIds: result.assistantInputIds, vaultRoot: fixture.vaultRoot,
      });
      assert.deepEqual(selection.inputIds, result.assistantInputIds);
      assert.ok(probes.closeActiveCounts.every((count) => count === 0));
    } finally {
      controller.close();
    }
  });

  test("an earlier retry holds both watermarks and admission while a completed sibling replays without another transcription", async () => {
    const fixture = await createFixture(2);
    probes.failNextFailureRead = true;
    const operation = fixture.run();
    await observeBarrier(Promise.all(fixture.started.map((barrier) => barrier.promise)));
    fixture.release(2);
    fixture.release(1);
    const blocked = await operation;
    assert.equal(blocked.state.watermarks.conversation, "0");
    assert.equal(blocked.blocked[0]?.reasonCode, "conversation-import.parser-retry");
    assert.deepEqual(await fixture.pending(), []);
    assert.equal((await fixture.jobs()).filter((job) => job.state === "succeeded").length, 2);
    const staged = await listAssistantInputEvents({ vault: fixture.vaultRoot });
    assert.ok(staged.events.every((event) => event.projection.status === "pending"));
    const replay = await fixture.run();
    assert.equal(replay.state.watermarks.conversation, "2");
    assert.deepEqual([...fixture.calls].sort((left, right) => left - right), [1, 2]);
    assert.ok((await fixture.jobs()).every((job) => job.attempts === 1));
    await fixture.assertEvidenceOrder(replay.assistantInputIds ?? []);
    assert.deepEqual(await fixture.pending(), replay.assistantInputIds);
    assert.equal((await listAssistantInputEvents({ vault: fixture.vaultRoot })).events.length, 2);
  });

  test("preemption joins owned non-aborted parser attempts before closing, and replay does not bill again", async () => {
    const fixture = await createFixture(2);
    const abort = new AbortController();
    let settled = false;
    const operation = fixture.run({ signal: abort.signal }).then(
      () => { settled = true; return null; },
      (error: unknown) => { settled = true; return error; },
    );
    await observeBarrier(Promise.all(fixture.started.map((barrier) => barrier.promise)));
    const reason = new Error("Synthetic foreground preemption.");
    abort.abort(reason);
    fixture.release(2);
    await fixture.finished[1]!.promise;
    assert.equal(settled, false);
    assert.deepEqual(probes.closeActiveCounts, []);
    fixture.release(1);
    assert.equal(await operation, reason);
    assert.deepEqual(probes.closeActiveCounts, [0]);
    assert.deepEqual(await fixture.pending(), []);
    assert.ok((await fixture.jobs()).every((job) => job.state === "succeeded" && job.attempts === 1));
    const replay = await fixture.run();
    assert.equal(replay.state.watermarks.conversation, "2");
    assert.deepEqual([...fixture.calls].sort((left, right) => left - right), [1, 2]);
    await fixture.assertEvidenceOrder(replay.assistantInputIds ?? []);
  });

  test("cancellation before admission fetches no media and creates no parser runtime", async () => {
    const fixture = await createFixture(2);
    const abort = new AbortController();
    abort.abort(new Error("Synthetic cancelled import."));
    await assert.rejects(fixture.run({ signal: abort.signal }), /Synthetic cancelled import/u);
    assert.deepEqual(fixture.downloads, []);
    assert.deepEqual(fixture.calls, []);
    assert.deepEqual(probes.closeActiveCounts, []);
  });

  test.each(["gap", "causal-gap", "malformed", "disallowed", "sidecar"] as const)(
    "does not speculatively download or transcribe a later %s item",
    async (kind) => {
      const fixture = await createFixture(2);
      if (kind === "gap") fixture.items[1]!.laneSeq = "3";
      if (kind === "causal-gap") fixture.items[1]!.causalSeq = "4";
      if (kind === "malformed") fixture.items[1]!.payloadBytes = -1;
      if (kind === "disallowed") fixture.disallowSecond();
      if (kind === "sidecar") {
        fixture.items[1]!.payloadInlineCiphertext = null;
        fixture.items[1]!.payloadRef = "synthetic-sidecar";
      }
      const operation = fixture.run();
      await observeBarrier(fixture.started[0]!.promise);
      assert.deepEqual(fixture.downloads, [1]);
      assert.deepEqual(fixture.calls, [1]);
      fixture.releaseAll();
      const result = await operation;
      assert.equal(result.conversationImportTiming?.audioPairCount, undefined);
      if (kind !== "causal-gap") assert.deepEqual(fixture.calls, [1]);
      if (kind === "gap" || kind === "disallowed" || kind === "sidecar") {
        assert.equal(result.state.watermarks.conversation, "1");
      }
    },
  );

  test("a later decoder exception cannot prevent the earlier input's ordinary import", async () => {
    const fixture = await createFixture(2);
    fixture.throwSecondDecode();
    const operation = fixture.run();
    await observeBarrier(fixture.started[0]!.promise);
    assert.deepEqual(fixture.downloads, [1]);
    fixture.releaseAll();
    await assert.rejects(operation, /Synthetic decoder unavailable/u);
    assert.deepEqual(fixture.calls, [1]);
    assert.equal((await fixture.pending()).length, 1);
    assert.ok(probes.closeActiveCounts.every((count) => count === 0));
  });

  test.each(["other-thread", "other-reply", "text", "mixed-media", "replay", "system"] as const)(
    "keeps a %s boundary on the original serial path",
    async (kind) => {
      const fixture = await createFixture(2);
      const later = fixture.wakes[1];
      assert.equal(later?.message.channel, "linq");
      if (!later || later.message.channel !== "linq") throw new Error("Invalid synthetic wake.");
      if (kind === "other-thread") later.message.linqMessage.chatId = "thread_other_fixture";
      if (kind === "other-reply") later.message.linqMessage.replyToMessageId = "message_other_anchor";
      if (kind === "text") later.message.linqMessage.parts = [{ type: "text", value: "Synthetic text input." }];
      if (kind === "mixed-media") later.message.linqMessage.parts.push({
        type: "media", attachmentId: "synthetic_image", mimeType: "image/png", fileName: "synthetic.png",
      });
      if (kind === "replay") fixture.items[1]!.consumedAt = fixture.items[1]!.occurredAt;
      if (kind === "system") fixture.items.push({
        ...fixture.items[0]!, id: "system_fixture", kind: "member.activated", lane: "system",
      });
      const operation = fixture.run();
      await observeBarrier(fixture.started[0]!.promise);
      assert.deepEqual(fixture.calls, [1]);
      assert.deepEqual(fixture.downloads, [1]);
      fixture.releaseAll();
      const result = await operation;
      assert.equal(result.conversationImportTiming?.audioPairCount, undefined);
      assert.equal(fixture.maximumActive(), 1);
      if (kind === "replay") assert.equal(result.assistantInputIds?.length, 1);
    },
  );

  test("text-only stays inbox-free without parser configuration", async () => {
    const fixture = await createFixture(1);
    const wake = fixture.wakes[0];
    assert.ok(wake?.message.channel === "linq");
    wake.message.linqMessage.parts = [{ type: "text", value: "Synthetic text input." }];
    const text = await fixture.run();
    assert.equal(text.importedCount, 1);
    assert.deepEqual(fixture.calls, []);
    assert.deepEqual(fixture.downloads, []);
    assert.deepEqual(probes.closeActiveCounts, []);
    assert.equal(probes.configure.mock.calls.length, 0);
  });

  test("single audio preserves complete evidence without a pair", async () => {
    const fixture = await createFixture(1);
    fixture.releaseAll();
    const result = await fixture.run();
    assert.equal(result.importedCount, 1);
    assert.equal(result.conversationImportTiming?.audioPairCount, undefined);
    assert.deepEqual(fixture.calls, [1]);
    await fixture.assertEvidenceOrder(result.assistantInputIds ?? []);
  });
});

type ImporterOptions = Parameters<typeof createHostedConversationMailboxImportItem>[0];
async function createFixture(count: number, options: { typing?: boolean } = {}) {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-audio-pair-"));
  const occurredAt = new Date().toISOString();
  await initializeVault({ vaultRoot, createdAt: occurredAt });
  await createIntegratedInboxServices().init({ vault: vaultRoot, requestId: null });
  probes.closeActiveCounts.length = 0;
  const started = Array.from({ length: count }, () => deferred());
  const finished = Array.from({ length: count }, () => deferred());
  const releases = Array.from({ length: count }, () => deferred());
  const calls: number[] = [];
  const downloads: number[] = [];
  const operations: Promise<unknown>[] = [];
  let maximumActive = 0;
  let disallowSecond = false;
  let throwSecondDecode = false;
  const wakes: HostedExecutionConversationMessageWake[] = Array.from({ length: count }, (_, index) => ({
    kind: "conversation.message", eventId: `event_audio_fixture_${index + 1}`,
    occurredAt, userId: "member_audio_fixture",
    message: {
      channel: "linq", phoneLookupKey: "account_audio_fixture",
      linqMessage: {
        chatId: "thread_audio_fixture", from: "sender_audio_fixture", isFromMe: false,
        messageId: `message_audio_fixture_${index + 1}`, threadIsDirect: true,
        parts: [{
          type: "voice_memo", attachmentId: `audio_fixture_${index + 1}`,
          mimeType: "audio/wav", fileName: `voice-${index + 1}.wav`,
          url: `https://cdn.linqapp.com/synthetic-fixture/voice-${index + 1}.wav`,
        }],
      },
    },
  }));
  const items: HostedMailboxItem[] = wakes.map((wake, index) => ({
    createdAt: occurredAt, updatedAt: occurredAt, occurredAt,
    consumedAt: null, expiresAt: null, id: `item_audio_fixture_${index + 1}`,
    userId: wake.userId, kind: wake.kind, lane: "conversation",
    laneSeq: String(index + 1), causalSeq: String(index + 1), dedupeKey: wake.eventId,
    payloadBytes: 128, payloadInlineCiphertext: "synthetic-ciphertext", payloadRef: null,
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  }));
  const registry = createParserRegistry([{
    id: "synthetic-audio", locality: "local", openness: "open_source", runtime: "node", priority: 1,
    async discover() { return { available: true, reason: "Synthetic fixture." }; },
    supports(request) { return request.artifact.kind === "audio"; },
    async run(request) {
      assert.equal(request.signal, undefined); // hosted drain must NOT cooperatively abort a claim
      const ordinal = Number(request.artifact.fileName?.match(/voice-(\d+)\.wav/u)?.[1]);
      assert.ok(ordinal >= 1 && ordinal <= count);
      calls.push(ordinal);
      probes.activePreparations += 1;
      maximumActive = Math.max(maximumActive, probes.activePreparations);
      started[ordinal - 1]!.resolve();
      try {
        await releases[ordinal - 1]!.promise;
        return { text: `Synthetic transcript ${ordinal}.` };
      } finally {
        probes.activePreparations -= 1;
        finished[ordinal - 1]!.resolve();
      }
    },
  }]);
  probes.configure.mockResolvedValue({
    registry, ffmpeg: { allowSystemLookup: false, commandCandidates: [] },
  });
  const importerOptions: ImporterOptions = {
    vaultRoot,
    decodePayload: {
      async decode(input) {
        const wake = wakes.find((candidate) => candidate.eventId === input.itemRef.dedupeKey);
        if (throwSecondDecode && wake === wakes[1]) throw new Error("Synthetic decoder unavailable.");
        if (!wake || (disallowSecond && wake === wakes[1])) {
          return { status: "blocked", reasonCode: "payload.synthetic_disallowed", retryable: true };
        }
        return { status: "decoded", wake };
      },
    },
    // Bootstrap is initialized above. Production local capture/evidence ownership
    // remains real; no provider credential or member state is read by this fixture.
    async prepareWakeContext() {},
    runtime: {
      forwardedEnv: {}, userEnv: {}, platformEnv: {}, parserToolchain: null,
      platform: {
        ...(options.typing ? { providerFetch: vi.fn<typeof fetch>() } : {}),
        artifactStore: { async get() { return null; }, async put() {} },
        effectsPort: { async readRawEmailMessage() { return null; }, async sendEmail() {} },
        publicInternetFetch: async (input) => {
          const url = input instanceof Request ? input.url : String(input);
          const ordinal = Number(url.match(/voice-(\d+)\.wav/u)?.[1]);
          assert.ok(ordinal >= 1 && ordinal <= count);
          downloads.push(ordinal);
          return new Response(new Uint8Array(Buffer.from("RIFF----WAVEsynthetic audio bytes")), {
            status: 200, headers: { "content-type": "audio/wav" },
          });
        },
      },
      resolvedConfig: {
        channelCapabilities: { emailSendReady: false, telegramBotConfigured: false },
        deviceSync: null,
        managedAutoReplyChannels: [{ capabilityReady: true, channel: "linq", memberChannel: "linq" }],
      },
    },
  };
  const releaseAll = () => { for (const release of releases) release.resolve(); };
  cleanups.push(async () => {
    releaseAll();
    await Promise.allSettled(operations);
    await rm(vaultRoot, { force: true, recursive: true });
  });
  return {
    vaultRoot, items, wakes, started, finished, calls, downloads, releaseAll,
    disallowSecond() { disallowSecond = true; },
    throwSecondDecode() { throwSecondDecode = true; },
    release(ordinal: number) { releases[ordinal - 1]!.resolve(); },
    maximumActive: () => maximumActive,
    pending: () => readHostedPendingAssistantInputIds({ vaultRoot }),
    async jobs() {
      const actual = await vi.importActual<typeof import("@murphai/inboxd/runtime")>("@murphai/inboxd/runtime");
      const runtime = await actual.openInboxRuntime({ vaultRoot });
      try { return runtime.listAttachmentParseJobs({}); } finally { runtime.close(); }
    },
    async assertEvidenceOrder(inputIds: readonly string[]) {
      assert.equal(inputIds.length, count);
      for (const [index, inputId] of inputIds.entries()) {
        const event = await readAssistantInputEvent({ inputId, vault: vaultRoot });
        assert.ok(event);
        assert.equal(event.sourceRef.kind, "hosted-mailbox");
        if (event.sourceRef.kind !== "hosted-mailbox") assert.fail("Expected a mailbox source.");
        assert.equal(event.sourceRef.laneSeq, String(index + 1));
        const evidence = event?.attachmentEvidence;
        assert.equal(evidence?.status, "available", evidence?.reasonCode ?? undefined);
        assert.equal(evidence?.attachments[0]?.fileName, `voice-${index + 1}.wav`);
        assert.equal(evidence?.attachments[0]?.parseState, "succeeded");
        assert.equal(evidence?.attachments[0]?.inlineFragments[0]?.text, `Synthetic transcript ${index + 1}.`);
        assert.ok(evidence?.attachments[0]?.raw?.path.startsWith("raw/inbox/"));
        const derived = evidence?.attachments[0]?.derived;
        assert.ok(derived);
        assert.equal(derived.kind, "parser-result");
        if (derived.kind !== "parser-result") assert.fail("Expected a parser result.");
        assert.ok(derived.resultPath.startsWith("derived/inbox/"));
      }
    },
    run(context: { signal?: AbortSignal } = {}) {
      const importer = createHostedConversationMailboxImportItem(importerOptions);
      const bound = Object.assign(
        (item: Parameters<typeof importer>[0]) => item.item.lane === "system"
          ? Promise.resolve({ status: "skipped" as const })
          : importer(item, context),
        { importAudioPair: (pair: Parameters<typeof importer.importAudioPair>[0]) => importer.importAudioPair(pair, context) },
      );
      const operation = fetchAndProcessHostedMailboxPrefix({
        expectedUserId: "member_audio_fixture", importItem: bound, limitPerLane: count + 1,
        requestId: "request_audio_fixture", state: createEmptyHostedMailboxImportState(),
        mailboxPort: {
          async fetch() {
            return {
              assistantProvider: "openai", fetchedAt: occurredAt, items, userId: "member_audio_fixture",
              maxSeqByLane: [{ lane: "conversation", maxSeq: String(count) }],
            };
          },
          async fetchPayload() { return { fetchedAt: occurredAt, payload: null }; },
        },
      });
      // Observe rejection immediately; test teardown still joins the original promise.
      void operation.catch(() => undefined);
      operations.push(operation);
      return operation;
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function observeBarrier<T>(promise: Promise<T>): Promise<T> {
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        // Allow a cold lazy module import on a busy host. The barrier and call
        // counts prove overlap; wall-clock duration is never a success condition.
        watchdog = setTimeout(() => reject(new Error("Synthetic preparation barrier did not open.")), 60_000);
      }),
    ]);
  } finally {
    if (watchdog) clearTimeout(watchdog);
  }
}
