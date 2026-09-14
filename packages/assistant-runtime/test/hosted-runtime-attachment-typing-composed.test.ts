import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initializeVault } from "@murphai/core";
import type { HostedRuntimeLatencyTraceRequest } from "@murphai/hosted-execution/runtime-control";
import { test, vi } from "vitest";
import {
  TEST_NOW, TEST_USER_ID, createMailboxItem, createMailboxPort, createPlatform,
  createSnapshotFixtureRef, createWorkspacePort, createWorkspaceRuntimeJobInput,
  createWorkspaceState, removeTempRoot, runHostedWorkspaceRuntimeJobInProcess,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import { normalizeHostedAssistantRuntimeConfig } from "../src/hosted-runtime/environment.ts";
import { createHostedWorkspaceBridgeMailboxImporter } from "../src/hosted-runtime/snapshot-bridge-mailbox.ts";
import { createHostedAssistantChannelTypingDependencies } from "../src/hosted-runtime/channel-activity.ts";
import { readHostedPendingAssistantInputIds } from "../src/hosted-runtime/pending-input-index.ts";
import type { HostedAssistantLinqDeliveryContext } from "../src/hosted-runtime/linq-delivery-context.ts";

const evidence = vi.hoisted(() => ({
  ready: Promise.resolve(),
  admitted: false,
}));
// Keep the production factory, input staging, attachment typing, evidence admission,
// bridge, abort wrapper and Linq HTTP adapter. Only attachment preparation is synthetic.
vi.mock("../src/hosted-runtime/mailbox-conversation-import.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/hosted-runtime/mailbox-conversation-import.ts")>();
  return {
    ...actual,
    createHostedConversationMailboxImportItem: (
      input: Parameters<typeof actual.createHostedConversationMailboxImportItem>[0],
    ) => actual.createHostedConversationMailboxImportItem({
      ...input,
      async prepareWakeContext() {},
      async importConversationWake() {
        await evidence.ready;
        return { captureId: "synthetic_capture", metrics: { nextWakeAt: null, parserProcessed: 1 } };
      },
      async loadAttachmentEvidenceCapture() {
        return {
          captureId: "synthetic_capture",
          attachments: [{
            attachmentId: "synthetic_audio", byteSize: 4, derivedPath: null,
            extractedText: null, fileName: "audio.m4a", kind: "audio", mime: "audio/mp4",
            ordinal: 1, parseState: "succeeded", sha256: "a".repeat(64),
            storedPath: "raw/inbox/linq/synthetic_capture/attachments/audio.m4a",
            transcriptText: "A synthetic attachment.",
          }],
        };
      },
    }),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

test.each([
  { group: false, pendingAcceptance: false },
  { group: false, pendingAcceptance: true },
  { group: true, pendingAcceptance: false },
])("real attachment import and HTTP typing survive runtime handoff (group: $group, pending: $pendingAcceptance)", async ({ group, pendingAcceptance }) => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(TEST_NOW) });
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-typing-composed-"));
  const events: string[] = [];
  const milestones: HostedRuntimeLatencyTraceRequest["event"][] = [];
  let preparationAcceptedAt: string | null = null;
  const prepared = deferred<void>();
  const response = deferred<Response>();
  const providerEntered = deferred<void>();
  const assistantEntered = deferred<void>();
  evidence.ready = prepared.promise;
  evidence.admitted = false;
  const target = `synthetic_composed_${group ? "group" : "private"}_${pendingAcceptance ? "pending" : "accepted"}`;
  const route: HostedAssistantLinqDeliveryContext = {
    directRecipientPhoneNumber: null, fromPhoneNumber: null, replyToMessageId: "synthetic_audio_message",
    routeAuthority: group ? {
      accountLookupKey: "synthetic_account", channel: "linq",
      containerMemberId: TEST_USER_ID, threadId: target,
    } : null,
    service: "iMessage", target, threadIsDirect: !group,
  };
  const calls: { method: string; pathname: string }[] = [];
  const providerFetch: typeof fetch = async (request, init) => {
    calls.push({ method: init?.method ?? "GET", pathname: new URL(String(request)).pathname });
    if (calls.length === 1) {
      providerEntered.resolve();
      return response.promise;
    }
    return new Response(null, { status: 204 });
  };
  const platform = {
    ...createPlatform({
      mailboxPort: createMailboxPort({ events, items: [createMailboxItem({ laneSeq: "1", dedupeKey: "synthetic_attachment_event" })] }),
      workspacePort: createWorkspacePort({ checkpointRequests: [], events, workspace: createWorkspaceState({ version: "0" }) }),
    }),
    providerFetch,
    latencyTracePort: { async record(request: HostedRuntimeLatencyTraceRequest) {
      milestones.push(request.event);
      if (request.event.type === "assistant_milestone" && request.event.milestone === "linq_typing_accepted") preparationAcceptedAt = request.event.at;
      if (request.event.type === "assistant_milestone" && request.event.milestone === "pending_reply_admitted") evidence.admitted = true;
      return { matchedCount: 1, recorded: true, unmatchedCount: 0 };
    } },
  };
  const job = createWorkspaceRuntimeJobInput({
    request: { attemptId: "synthetic_composed_typing", userId: TEST_USER_ID, workspaceVersion: "0", idleCheckpointDelayMs: 1 },
  });
  const runtime = normalizeHostedAssistantRuntimeConfig(job.runtime, platform);
  runtime.forwardedEnv = { ...runtime.forwardedEnv, LINQ_API_TOKEN: "synthetic-token" };
  const importer = createHostedWorkspaceBridgeMailboxImporter({
    runtime, vaultRoot,
    decodeMailboxPayload: { async decode() {
      return { status: "decoded", wake: {
        eventId: "synthetic_attachment_event", kind: "conversation.message", occurredAt: TEST_NOW, userId: TEST_USER_ID,
        message: {
          channel: "linq", phoneLookupKey: "synthetic_lookup",
          ...(group ? { routeAuthority: route.routeAuthority! } : {}),
          linqMessage: {
            chatId: target, messageId: "synthetic_audio_message", isFromMe: false,
            from: "synthetic_sender", threadIsDirect: !group,
            parts: [{ type: "voice_memo", attachmentId: "synthetic_audio", fileName: "audio.m4a", mimeType: "audio/mp4", size: 4, url: "https://attachments.invalid/audio" }],
          },
        },
      } };
    } },
  });
  const abort = new AbortController();
  let running: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | undefined;
  let checked = false;
  const isAccepted = (event: HostedRuntimeLatencyTraceRequest["event"]) =>
    event.type === "assistant_milestone" && event.milestone === "linq_typing_accepted";
  try {
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    const audioPath = path.join(vaultRoot, "raw/inbox/linq/synthetic_capture/attachments/audio.m4a");
    await mkdir(path.dirname(audioPath), { recursive: true });
    await writeFile(audioPath, "test");
    running = runHostedWorkspaceRuntimeJobInProcess(job, {
      platform, signal: abort.signal, vaultRoot, importItem: importer,
      async createCheckpointSnapshot() {
        return { snapshotRef: createSnapshotFixtureRef({ hash: "a".repeat(64), size: 512 }) };
      },
      async runAssistantPhase(input) {
        if (checked) return { progressed: false };
        if ((await readHostedPendingAssistantInputIds({ vaultRoot })).length === 0) return { progressed: false };
        checked = true;
        assistantEntered.resolve();
        const typing = createHostedAssistantChannelTypingDependencies({
          forwardedEnv: { LINQ_API_TOKEN: "synthetic-token" }, userEnv: {},
          providerFetch: input.runtime.platform.providerFetch, linqDeliveryContexts: [route],
          signal: abort.signal,
        });
        const handoff = typing.startLinqTyping?.({ target });
        if (pendingAcceptance) {
          assert.equal(milestones.some(isAccepted), false);
          response.resolve(new Response(null, { status: 204 }));
        }
        const handle = await handoff;
        assert.ok(handle, "real attachment typing must reach the foreground owner");
        assert.equal(calls.length, 1, "handoff must not issue a duplicate HTTP start");
        assert.ok(handle.acceptedAt);
        if (!pendingAcceptance) assert.equal(handle.acceptedAt, preparationAcceptedAt, "handoff preserves the original provider acceptance");
        await handle.stop({ providerStop: false });
        assert.equal(calls.length, 1, "delivery clears typing without a redundant DELETE");
        const next = await typing.startLinqTyping?.({ target });
        assert.ok(next, "next message starts immediately instead of waiting through cooldown");
        assert.equal(calls.filter(call => call.method === "POST").length, 2);
        await next.stop();
        assert.equal(calls.filter(call => call.method === "DELETE").length, 1);
        return { progressed: false };
      },
    });
    void running.catch(() => {});
    await Promise.race([providerEntered.promise, running.then(() => { throw new Error("Runtime ended before attachment typing"); })]);
    assert.equal(checked, false, "unsettled evidence must not admit the model");
    assert.equal(evidence.admitted, false);
    assert.equal(milestones.some(isAccepted), false, "HTTP entry is not provider acceptance");
    if (!pendingAcceptance) {
      response.resolve(new Response(null, { status: 204 }));
      await vi.waitFor(() => assert.equal(milestones.some(isAccepted), true));
      assert.equal(checked, false, "early typing must not bypass evidence admission");
    }
    prepared.resolve();
    await Promise.race([assistantEntered.promise, running.then(() => { throw new Error("Runtime ended before admitted reply"); })]);
    await running;
    assert.equal(checked, true);
    assert.ok(calls.every(call => call.pathname.endsWith("/typing")));
  } finally {
    response.resolve(new Response(null, { status: 204 }));
    prepared.resolve();
    abort.abort();
    await running?.catch(() => {});
    vi.useRealTimers();
    await removeTempRoot(vaultRoot);
  }
});
