import {
  TEST_NOW,
  TEST_USER_ID,
  createSnapshotFixtureRef,
  createDeferred,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceState,
  createAssistantAskRequestedWake,
  mocks,
  stageAssistantInputEventForMailboxItem,
  writeSyntheticAssistantAutoReplyTerminalEvidence,
  removeTempRoot,
  requireEventIndex,
  waitForFakeTimerScheduled,
  waitUntil,
  withRealTimeout,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";

import assert from "node:assert/strict";
import { access, appendFile, chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { enqueueHostedSystemMailboxItem } from "../src/hosted-runtime/system-mailbox.ts";
import {
  addCaptureWithLookup,
  CURRENT_VAULT_FORMAT_VERSION,
  HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
  buildIntegrationEvidencePart,
  buildIntegrationIngestRecord,
  findCaptureByLookup,
  initializeVault,
  patchAutomation,
  readJsonlRecords,
  repairVault,
  runCanonicalWrite,
  showAutomation,
  upsertAutomation,
  validateVault,
} from "@murphai/core";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
  readHostedRuntimeFailurePhaseCode,
  type HostedMailboxFetchRequest,
  type HostedMailboxFetchResponse,
  type HostedMailboxItem,
  type HostedMailboxPayloadFetchRequest,
  type HostedMailboxPayloadFetchResponse,
  type HostedRuntimeRedactedJson,
  type HostedRuntimeLatencyTraceRequest,
  type HostedRuntimeLogRequest,
  type HostedRuntimeAssistantConfigurationControlRequest,
  type HostedRuntimeAssistantConfigurationSnapshot,
  type HostedRuntimeAssistantConfigurationToolResponse,
  type HostedWorkspaceCheckpointRequest,
  type HostedWorkspaceCheckpointResponse,
  type HostedWorkspaceReadResponse,
  type HostedWorkspaceInvocationRequest,
  type HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import { describe, expect, test, vi } from "vitest";
import {
  createCoalescingRuntimeWakeSignal,
  HostedRuntimeCheckpointInterruptedByWakeError,
  HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError,
  HostedWorkspaceRunnerUserMismatchError,
  drainHostedRuntimeDeferredUsageCompletionsBestEffort,
  parseHostedAssistantWorkspaceRuntimeJobInput,
  runHostedWorkspaceRuntimeJobInProcess,
  type HostedWorkspaceRuntimeJobOptions,
  type HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
} from "../src/hosted-runtime.ts";

describe("hosted workspace runtime entrypoint", () => {
  test.each([
    { name: "foreground prerequisite", startAfterMs: 0, expectedMs: 0 },
    { name: "background claim bound", startAfterMs: 480_000, expectedMs: 480_000 },
    { name: "ordinary durable effect", startAfterMs: null, expectedMs: 600_000 },
    { name: "background claim within the quiet window", startAfterMs: 720_000, expectedMs: 600_000 },
  ])("honors the publication deadline for a $name", async ({ startAfterMs, expectedMs }) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-publication-deadline-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const started = createDeferred<void>();
    let snapshotAt: number | null = null;
    const durableEffect = Object.assign(vi.fn(async () => { events.push("effect"); }),
      startAfterMs === null ? {} : { checkpointStartByMs: Date.parse(TEST_NOW) + startAfterMs });
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      let pass = 0;
      const job = withRealTimeout(runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({ request: { runnerIdleTtlMs: 600_000 } }), {
          vaultRoot,
          async importItem() { return { status: "imported" }; },
          async createCheckpointSnapshot() {
            snapshotAt ??= Date.now();
            return { snapshotRef: createSnapshotFixtureRef({ hash: "a".repeat(64), size: 512 }) };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({ events, items: [createMailboxItem()] }),
            workspacePort: createWorkspacePort({ checkpointRequests, events, workspace: createWorkspaceState() }),
            vaultSharePort: {
              async listActiveProjectionScopes() { events.push("projection-offer"); return { projectionKinds: [], projectionScopes: [] }; },
              async deliver() { return { status: "delivered" }; },
            },
          }),
          async runAssistantPhase() {
            if (++pass > 1) return { progressed: false };
            started.resolve();
            return { progressed: true, checkpointReason: "outbox_sending", afterCheckpoint: async () => ({
              checkpointReason: "outbox_sending", afterDurableCheckpoint: durableEffect,
            }) };
          },
        }), 15_000, () => events.join(","));
      await started.promise;
      if (expectedMs > 0) {
        await waitForFakeTimerScheduled(() => events.join(","));
        await vi.advanceTimersByTimeAsync(expectedMs);
      }
      await job;
      expect(snapshotAt).toBe(Date.parse(TEST_NOW) + expectedMs);
      expect(durableEffect).toHaveBeenCalledOnce();
      expect(events.indexOf("workspace.checkpoint")).toBeLessThan(events.indexOf("effect"));
      if (startAfterMs !== null && startAfterMs <= expectedMs) {
        const firstOffer = events.indexOf("projection-offer");
        expect(firstOffer === -1 || events.indexOf("effect") < firstOffer).toBe(true);
      } else {
        expect(events.indexOf("projection-offer")).toBeLessThan(events.indexOf("effect"));
      }
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test.each([0, 480_000])("keeps a publication deadline of %i ms across later accepted work and releases it after publication", async (startAfterMs) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-publication-rearm-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const items = [createMailboxItem()];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const thirdPass = createDeferred<void>();
    const secondPass = createDeferred<void>();
    const snapshots: number[] = [];
    let passes = 0;
    const accept = (seq: string) => {
      items.push(createMailboxItem({ id: `mailbox_publication_${seq}`, dedupeKey: `publication_${seq}`, laneSeq: seq, occurredAt: new Date().toISOString() }));
      runtimeWakeSignal.notify();
    };
    const effect = Object.assign(async () => { events.push("effect"); accept("3"); return { requiresFollowUpCheckpoint: true }; }, { checkpointStartByMs: Date.parse(TEST_NOW) + startAfterMs });
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const job = withRealTimeout(runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({ request: { runnerIdleTtlMs: 600_000 } }), {
          vaultRoot, runtimeWakeSignal,
          async importItem(item) {
            return { assistantInputId: await stageAssistantInputEventForMailboxItem({ item: item.item, vaultRoot }), status: "imported" };
          },
          async createCheckpointSnapshot() {
            snapshots.push(Date.now());
            return { snapshotRef: createSnapshotFixtureRef({ hash: "a".repeat(64), size: 512 }) };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({ events, items }),
            workspacePort: createWorkspacePort({ checkpointRequests, events, workspace: createWorkspaceState() }),
          }),
          async runAssistantPhase(input) {
            passes += 1;
            events.push(`pass:${passes}`);
            for (const inputId of input.initialMailboxImport.importResult.assistantInputIds ?? []) {
              await writeSyntheticAssistantAutoReplyTerminalEvidence({ inputId, vaultRoot });
            }
            if (passes === 1) return { progressed: true, checkpointReason: "outbox_sending", afterCheckpoint: async () => {
              vi.setSystemTime(new Date(Date.parse(TEST_NOW) + 60_000));
              accept("2");
              return { checkpointReason: "outbox_sending", afterDurableCheckpoint: effect };
            } };
            if (passes === 2) secondPass.resolve();
            if (passes === 3) thirdPass.resolve();
            return passes <= 3
              ? { progressed: true, checkpointReason: "assistant_runtime_commit" }
              : { progressed: false };
          },
        }), 15_000, () => events.join(","));
      await withRealTimeout(secondPass.promise, 15_000, () => events.join(","));
      if (startAfterMs > 0) {
        await waitForFakeTimerScheduled(() => events.join(","));
        await vi.advanceTimersByTimeAsync(startAfterMs - 60_000);
      }
      await withRealTimeout(thirdPass.promise, 15_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(600_000);
      await job;
      expect(snapshots[0]).toBe(Date.parse(TEST_NOW) + Math.max(60_000, startAfterMs));
      expect(snapshots.at(-1)).toBeGreaterThanOrEqual(snapshots[0]! + 600_000);
      expect(events.indexOf("pass:2")).toBeLessThan(events.indexOf("effect"));
      expect(events.indexOf("effect")).toBeLessThan(events.indexOf("pass:3"));
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("keeps a ready publication deadline through foreground work accepted during publication", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-publication-ready-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const items = [createMailboxItem()];
    const snapshots: number[] = [];
    const shutdown = new AbortController();
    const effect = Object.assign(vi.fn(async () => { events.push("effect"); }), { checkpointStartByMs: Date.parse(TEST_NOW) });
    let passes = 0;
    let job: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | undefined;
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      job = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({ request: { runnerIdleTtlMs: 600_000 } }), {
        vaultRoot, shutdownSignal: shutdown.signal,
        async importItem(item) {
          return { assistantInputId: await stageAssistantInputEventForMailboxItem({ item: item.item, vaultRoot }), status: "imported" };
        },
        async createCheckpointSnapshot() {
          snapshots.push(Date.now()); events.push(`snapshot:${snapshots.length}`);
          return { snapshotRef: createSnapshotFixtureRef({ hash: "a".repeat(64), size: 512 }) };
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events, items }),
          workspacePort: createWorkspacePort({
            checkpointRequests, events, workspace: createWorkspaceState(),
            checkpointResponse(request) {
              if (checkpointRequests.length === 1) items.push(createMailboxItem({ id: "mailbox_publication_late", dedupeKey: "publication_late", laneSeq: "2" }));
              return { checkpointed: true, conversationInputAhead: checkpointRequests.length === 1, workspace: createWorkspaceState({
                snapshotRef: request.snapshotRef, version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
              }) };
            },
          }),
        }),
        async runAssistantPhase(input) {
          events.push(`pass:${++passes}`);
          for (const inputId of input.initialMailboxImport.importResult.assistantInputIds ?? []) {
            await writeSyntheticAssistantAutoReplyTerminalEvidence({ inputId, vaultRoot });
          }
          if (passes === 1) return { progressed: true, checkpointReason: "outbox_sending", afterCheckpoint: async () => ({
            checkpointReason: "outbox_sending", afterDurableCheckpoint: effect,
          }) };
          return { progressed: true, checkpointReason: "assistant_runtime_commit" };
        },
      });
      await withRealTimeout(job, 5_000, () => `Ready hook stalled: snapshots=${snapshots.length}, hook calls=${effect.mock.calls.length}; ${events.join(",")}`);
      expect(snapshots).toEqual([Date.parse(TEST_NOW), Date.parse(TEST_NOW)]);
      expect(passes).toBe(2);
      expect(effect).toHaveBeenCalledOnce();
      expect(requireEventIndex(events, "workspace.checkpoint")).toBeLessThan(requireEventIndex(events, "pass:2"));
      expect(requireEventIndex(events, "pass:2")).toBeLessThan(requireEventIndex(events, "snapshot:2"));
      expect(requireEventIndex(events, "snapshot:2")).toBeLessThan(requireEventIndex(events, "effect"));
    } finally {
      shutdown.abort(new Error("Synthetic cleanup"));
      await job?.catch(() => undefined);
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("caps an active Ask wait at a future publication deadline", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-publication-ask-future-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const askStarted = createDeferred<void>();
    const effectPending = createDeferred<void>();
    const shutdown = new AbortController();
    let snapshotAt: number | null = null;
    let first = true;
    let job: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | undefined;
    const effect = Object.assign(vi.fn(async () => { events.push("effect"); }), { checkpointStartByMs: Date.parse(TEST_NOW) + 480_000 });
    mocks.executeReadOnlyAssistantAsk.mockImplementationOnce(async (input) => {
      askStarted.resolve();
      await new Promise<never>((_, reject) => {
        const abort = () => { events.push("ask-abort"); reject(input.abortSignal?.reason); };
        if (input.abortSignal?.aborted) abort();
        else input.abortSignal?.addEventListener("abort", abort, { once: true });
      });
      return { answer: "Synthetic answer.", outcome: "answered" };
    });
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const ask = createMailboxItem({ dedupeKey: "ask_publication_future", id: "mailbox_ask_publication_future", kind: "assistant.ask.requested", lane: "system", laneSeq: "1" });
      job = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({ request: { runnerIdleTtlMs: 600_000 } }), {
        vaultRoot, shutdownSignal: shutdown.signal,
        async importItem(item) {
          const wake = createAssistantAskRequestedWake({ eventId: ask.dedupeKey });
          wake.occurredAt = TEST_NOW;
          wake.ask.expiresAt = new Date(Date.parse(TEST_NOW) + 600_000).toISOString();
          return enqueueHostedSystemMailboxItem({ item, vaultRoot, wake });
        },
        async createCheckpointSnapshot() {
          snapshotAt ??= Date.now(); events.push("snapshot");
          return { snapshotRef: createSnapshotFixtureRef({ hash: "a".repeat(64), size: 512 }) };
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events, items: [ask] }),
          workspacePort: createWorkspacePort({ checkpointRequests, events, workspace: createWorkspaceState() }),
          assistantAskPort: { async request(request) {
            return request.action === "complete" ? { action: "complete", status: "completed" }
              : { action: "prepare", question: "Synthetic question?", status: "ready", targetLabel: "Synthetic group" };
          } },
        }),
        async runAssistantPhase() {
          if (!first) return { progressed: false };
          first = false;
          await askStarted.promise;
          return { progressed: true, checkpointReason: "outbox_sending", afterCheckpoint: async () => {
            effectPending.resolve();
            return { checkpointReason: "outbox_sending", afterDurableCheckpoint: effect };
          } };
        },
      });
      await withRealTimeout(effectPending.promise, 5_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(479_999);
      expect(snapshotAt).toBeNull();
      expect(events).not.toContain("ask-abort");
      await vi.advanceTimersByTimeAsync(1);
      await withRealTimeout(job, 5_000, () => `Future deadline missed: snapshot=${snapshotAt}, hook calls=${effect.mock.calls.length}; ${events.join(",")}`);
      expect(snapshotAt).toBe(Date.parse(TEST_NOW) + 480_000);
      expect(effect).toHaveBeenCalledOnce();
      expect(requireEventIndex(events, "ask-abort")).toBeLessThan(requireEventIndex(events, "snapshot"));
      expect(requireEventIndex(events, "workspace.checkpoint")).toBeLessThan(requireEventIndex(events, "effect"));
    } finally {
      shutdown.abort(new Error("Synthetic cleanup"));
      await job?.catch(() => undefined);
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test.each([true, false])("a due publication effect interrupts an active Ask: %s", async (due) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-publication-ask-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const askStarted = createDeferred<void>();
    const releaseAsk = createDeferred<void>();
    const checkpointStarted = createDeferred<void>();
    const shutdown = new AbortController();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const effect = Object.assign(vi.fn(async () => { events.push("effect"); }), due ? { checkpointStartByMs: Date.now() } : {});
    let first = true;
    mocks.executeReadOnlyAssistantAsk.mockImplementationOnce(async (input) => {
      events.push("ask-start");
      askStarted.resolve();
      await Promise.race([releaseAsk.promise, new Promise<never>((_, reject) => {
        const abort = () => { events.push("ask-abort"); reject(input.abortSignal?.reason); };
        if (input.abortSignal?.aborted) abort();
        else input.abortSignal?.addEventListener("abort", abort, { once: true });
      })]);
      events.push("ask-finish");
      return { answer: "Synthetic answer.", outcome: "answered" };
    });
    let job: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | undefined;
    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const ask = createMailboxItem({ dedupeKey: "ask_publication", id: "mailbox_ask_publication", kind: "assistant.ask.requested", lane: "system", laneSeq: "1" });
      job = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({ request: { runnerIdleTtlMs: 1 } }), {
        vaultRoot, shutdownSignal: shutdown.signal, runtimeWakeSignal,
        async importItem(item) {
          const wake = createAssistantAskRequestedWake({ eventId: ask.dedupeKey });
          wake.occurredAt = new Date().toISOString();
          wake.ask.expiresAt = new Date(Date.parse(wake.occurredAt) + 600_000).toISOString();
          return enqueueHostedSystemMailboxItem({ item, vaultRoot, wake });
        },
        async createCheckpointSnapshot() {
          events.push("snapshot"); checkpointStarted.resolve();
          return { snapshotRef: createSnapshotFixtureRef({ hash: "a".repeat(64), size: 512 }) };
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events, items: [ask] }),
          workspacePort: createWorkspacePort({ checkpointRequests, events, workspace: createWorkspaceState() }),
          assistantAskPort: { async request(request) {
            return request.action === "complete" ? { action: "complete", status: "completed" }
              : { action: "prepare", question: "Synthetic question?", status: "ready", targetLabel: "Synthetic group" };
          } },
        }),
        async runAssistantPhase() {
          if (!first) return { progressed: false };
          first = false;
          await askStarted.promise;
          return { progressed: true, checkpointReason: "outbox_sending", afterCheckpoint: async () => ({ checkpointReason: "outbox_sending", afterDurableCheckpoint: effect }) };
        },
      });
      await withRealTimeout(askStarted.promise, 10_000, () => events.join(","));
      const publishedWhileAskActive = await Promise.race([
        checkpointStarted.promise.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), 500)),
      ]);
      releaseAsk.resolve();
      await withRealTimeout(job, 10_000, () => events.join(","));
      expect(publishedWhileAskActive).toBe(due);
      expect(effect).toHaveBeenCalledOnce();
      expect(events.indexOf(due ? "ask-abort" : "ask-finish")).toBeLessThan(events.indexOf("snapshot"));
    } finally {
      releaseAsk.resolve(); shutdown.abort(new Error("Synthetic cleanup"));
      await job?.catch(() => undefined);
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("runs deferred durable checkpoint effects only after idle checkpoint succeeds", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {
        nextWakeAt: "2026-04-27T00:02:00.000Z",
        nextWakeReason: "device-sync.reconcile",
      };
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_durable_effect_success",
            runnerIdleTtlMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createSnapshotFixtureRef({
                hash: "e".repeat(64),
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            return {
              afterCheckpoint: async () => ({
                afterDurableCheckpoint: durableEffect,
                checkpointReason: "assistant_runtime_commit",
              }),
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      assert.equal(durableEffect.mock.calls.length, 1);
      assert.ok(
        events.indexOf("workspace.checkpoint") < events.indexOf("durable-effect"),
      );
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, "2026-04-27T00:02:00.000Z");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test.each(["caught-up", "incomplete", "unknown"] as const)("classifies %s empty projection wakes before completing checkpointed work", async (coverage) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-ready-completion-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let assistantPasses = 0;
    let scopeReads = 0;
    const mailboxPort = createMailboxPort({ events, items: [] });
    const durableEffect = vi.fn(async () => {
      events.push("completion");
      return { requiresFollowUpCheckpoint: true };
    });
    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
        request: { runnerIdleTtlMs: 1 },
      }), {
        vaultRoot,
        runtimeWakeSignal,
        async importItem() { return { status: "imported" }; },
        async createCheckpointSnapshot() {
          assert.ok(checkpointRequests.length < 4, "Ready completion was starved by empty wake checkpoint churn.");
          return { snapshotRef: createSnapshotFixtureRef({ hash: "a".repeat(64), size: 512 }) };
        },
        platform: createPlatform({
          mailboxPort: {
            ...mailboxPort,
            async fetch(request) {
              const response = await mailboxPort.fetch(request);
              if (scopeReads === 1 && coverage !== "caught-up") {
                return {
                  ...response,
                  maxSeqByLane: coverage === "unknown" ? [] : response.maxSeqByLane.map((entry) => ({
                    ...entry, maxSeq: entry.lane === "conversation" ? "1" : entry.maxSeq,
                  })),
                };
              }
              return response;
            },
          },
          workspacePort: createWorkspacePort({ checkpointRequests, events, workspace: createWorkspaceState() }),
          vaultSharePort: {
            async listActiveProjectionScopes() {
              scopeReads += 1;
              if (coverage === "caught-up" || scopeReads === 1) runtimeWakeSignal.notify();
              await new Promise((resolve) => setTimeout(resolve, 10));
              return { projectionKinds: [], projectionScopes: [] };
            },
            async deliver() { return { status: "delivered" }; },
          },
        }),
        async runAssistantPhase() {
          assistantPasses += 1;
          return {
            progressed: true,
            checkpointReason: "assistant_runtime_commit",
            nextWakeAt: new Date().toISOString(),
            nextWakeReason: "device-sync.reconcile",
            ...(assistantPasses === 1 ? {
              afterCheckpoint: async () => ({
                checkpointReason: "system_mailbox_receipt",
                afterDurableCheckpoint: durableEffect,
              }),
            } : {}),
          };
        },
      });
      assert.equal(durableEffect.mock.calls.length, 1);
      assert.equal(assistantPasses, coverage === "caught-up" ? 1 : 2);
      assert.ok(events.indexOf("workspace.checkpoint") < events.indexOf("completion"));
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("checkpoint-gated due projected wakes wait for the idle delay before handoff", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const runtimeTransitionTimeoutMs = 15_000;
    const assistantOneObserved = createDeferred<void>();
    const assistantTwoObserved = createDeferred<void>();
    let firstCheckpointStartedAtMs: number | null = null;
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {
        nextWakeAt: "2026-04-27T00:02:00.000Z",
        nextWakeReason: "system-mailbox",
      };
    });
    let assistantPass = 0;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const resultPromise = withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_durable_effect_external_wake",
              runnerIdleTtlMs: 180_000,
              leaseGeneration: "7",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              firstCheckpointStartedAtMs ??= Date.now();
              events.push(`snapshot:${snapshotInput.reason}`);
              return {
                snapshotRef: createSnapshotFixtureRef({
                  hash: "f".repeat(64),
                  size: 512,
                }),
              };
            },
            async importItem() {
              return { status: "imported" };
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: [createMailboxItem()],
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase() {
              assistantPass += 1;
              events.push(`assistant:${assistantPass}`);

              if (assistantPass === 1) {
                assistantOneObserved.resolve();
                return {
                  afterCheckpoint: async () => {
                    runtimeWakeSignal.notify();
                    return {
                      afterDurableCheckpoint: durableEffect,
                      checkpointReason: "system_mailbox_receipt",
                      nextWakeAt: TEST_NOW,
                      nextWakeReason: "assistant",
                    };
                  },
                  checkpointReason: "system_mailbox_receipt",
                  nextWakeAt: TEST_NOW,
                  nextWakeReason: "assistant",
                  progressed: true,
                };
              }

              if (assistantPass === 2) {
                assistantTwoObserved.resolve();
                return {
                  progressed: false,
                };
              }

              throw new Error("Self-projected wake ran before durable effect checkpoint.");
            },
            vaultRoot,
          },
        ),
        runtimeTransitionTimeoutMs,
        () => events.join(","),
      );
      await withRealTimeout(assistantOneObserved.promise, runtimeTransitionTimeoutMs, () =>
        events.join(",")
      );
      await waitForFakeTimerScheduled(() => events.join(","));
      assert.equal(checkpointRequests.length, 0);
      assert.equal(assistantPass, 1);
      await vi.advanceTimersByTimeAsync(179_000);
      assert.equal(checkpointRequests.length, 0);
      assert.equal(assistantPass, 1);
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await resultPromise;

      assert.equal(assistantPass, 1, events.join(","));
      assert.equal(checkpointRequests.length, 2, events.join(","));
      assert.equal(checkpointRequests.at(-1)?.nextWakeAt, TEST_NOW);
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, "assistant");
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, TEST_NOW);
      const publication = events.indexOf("workspace.checkpoint");
      assert.ok(publication >= 0);
      assert.ok(!events.slice(publication + 1).some((event) => event.startsWith("assistant:")), events.join(","));
      assert.equal(durableEffect.mock.calls.length, 1);
      assert.ok(publication < events.indexOf("durable-effect"));
      assert.equal(firstCheckpointStartedAtMs, Date.parse(TEST_NOW) + 180_000);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("durable-effect wake survives assistant handoff without another quiet window", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const runnerIdleTtlMs = 1;
    const dueAssistantWakeAt = TEST_NOW;
    const durableWakeAt = "2026-04-27T00:02:00.000Z";
    const replacementWakeAt = new Date(Date.parse(TEST_NOW) + 1).toISOString();
    const assistantOneObserved = createDeferred<void>();
    const assistantTwoObserved = createDeferred<void>();
    const assistantThreeObserved = createDeferred<void>();
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {
        nextWakeAt: durableWakeAt,
        nextWakeReason: "system-mailbox",
        requiresFollowUpCheckpoint: true,
      };
    });
    let assistantPass = 0;
    let snapshotCount = 0;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const resultPromise = withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_round1_durable_wake_survives_reschedule",
              runnerIdleTtlMs,
              leaseGeneration: "7",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              snapshotCount += 1;
              events.push(`snapshot:${snapshotInput.reason}:${snapshotCount}`);
              return {
                snapshotRef: createSnapshotFixtureRef({
                  hash: String(snapshotCount).repeat(64).slice(0, 64),
                  size: 512,
                }),
              };
            },
            async importItem() {
              return { status: "imported" };
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: [createMailboxItem()],
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase(input) {
              assistantPass += 1;
              events.push(
                `assistant:${assistantPass}:${input.workspace?.nextWakeAt ?? "none"}`,
              );

              if (assistantPass === 1) {
                assistantOneObserved.resolve();
                return {
                  afterCheckpoint: async () => ({
                    afterDurableCheckpoint: durableEffect,
                    checkpointReason: "system_mailbox_receipt",
                    nextWakeAt: dueAssistantWakeAt,
                    nextWakeReason: "assistant",
                  }),
                  checkpointReason: "system_mailbox_receipt",
                  nextWakeAt: dueAssistantWakeAt,
                  nextWakeReason: "assistant",
                  progressed: true,
                };
              }

              if (assistantPass === 2) {
                assistantTwoObserved.resolve();
                vi.setSystemTime(new Date(replacementWakeAt));
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: replacementWakeAt,
                  nextWakeReason: "assistant",
                  progressed: true,
                };
              }

              assistantThreeObserved.resolve();
              return {
                progressed: false,
              };
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      await withRealTimeout(assistantOneObserved.promise, 15_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(runnerIdleTtlMs);
      const result = await resultPromise;

      assert.equal(assistantPass, 1, events.join(","));
      assert.equal(checkpointRequests.length, 2, events.join(","));
      assert.equal(checkpointRequests.at(-1)?.nextWakeAt, dueAssistantWakeAt);
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, "assistant");
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, dueAssistantWakeAt);
      const publication = events.indexOf("workspace.checkpoint");
      assert.ok(publication >= 0);
      assert.ok(!events.slice(publication + 1).some((event) => event.startsWith("assistant:")), events.join(","));
      assert.equal(durableEffect.mock.calls.length, 1);
      assert.ok(publication < events.indexOf("durable-effect"));
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("later durable wake survives due assistant handoff without restarting the spent quiet window", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runnerIdleTtlMs = 180_000;
    const dueAssistantWakeAt = TEST_NOW;
    const durableWakeAt = "2026-04-27T00:02:00.000Z";
    const replacementWakeAt = "2026-04-27T00:10:00.000Z";
    const assistantOneObserved = createDeferred<void>();
    const assistantTwoObserved = createDeferred<void>();
    const checkpointStartedAtMs: number[] = [];
    const latencyTraceRequests: HostedRuntimeLatencyTraceRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {
        nextWakeAt: durableWakeAt,
        nextWakeReason: "system-mailbox",
        requiresFollowUpCheckpoint: true,
      };
    });
    let assistantPass = 0;

    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      vi.setSystemTime(new Date(TEST_NOW));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const resultPromise = withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_round3_hot_work_durable_reconcile_waits",
              runnerIdleTtlMs,
              leaseGeneration: "7",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              checkpointStartedAtMs.push(Date.now());
              events.push(`snapshot:${snapshotInput.reason}:${checkpointStartedAtMs.length}`);
              return {
                snapshotRef: createSnapshotFixtureRef({
                  hash: `${checkpointStartedAtMs.length}`.repeat(64).slice(0, 64),
                  size: 512,
                }),
              };
            },
            async importItem() {
              return { status: "imported" };
            },
            platform: createPlatform({
              latencyTraceRequests,
              mailboxPort: createMailboxPort({
                events,
                items: [createMailboxItem()],
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                checkpointWorkspace: (request) => {
                  if (checkpointRequests.length === 2) {
                    events.push("runtime-wake:after-follow-up-checkpoint");
                    runtimeWakeSignal.notify();
                  }
                  return createWorkspaceState({
                    inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
                    nextWakeAt: request.nextWakeAt ?? null,
                    nextWakeReason: request.nextWakeReason ?? null,
                    redactedStatus: request.redactedStatus ?? null,
                    snapshotRef: request.snapshotRef,
                    version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                  });
                },
                events,
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase(input) {
              assistantPass += 1;
              events.push(
                `assistant:${assistantPass}:${input.workspace?.nextWakeAt ?? "none"}`,
              );

              if (assistantPass === 1) {
                assistantOneObserved.resolve();
                return {
                  afterCheckpoint: async () => ({
                    afterDurableCheckpoint: durableEffect,
                    checkpointReason: "system_mailbox_receipt",
                    nextWakeAt: dueAssistantWakeAt,
                    nextWakeReason: "assistant",
                  }),
                  checkpointReason: "system_mailbox_receipt",
                  nextWakeAt: dueAssistantWakeAt,
                  nextWakeReason: "assistant",
                  progressed: true,
                };
              }

              if (assistantPass === 2) {
                assistantTwoObserved.resolve();
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: replacementWakeAt,
                  nextWakeReason: "assistant",
                  progressed: true,
                };
              }

              return {
                progressed: false,
              };
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      await withRealTimeout(assistantOneObserved.promise, 15_000, () => events.join(","));
      await waitForFakeTimerScheduled(() => events.join(","));
      await vi.advanceTimersByTimeAsync(runnerIdleTtlMs);
      const result = await resultPromise;

      assert.equal(assistantPass, 1, events.join(","));
      assert.equal(checkpointRequests.length, 2, events.join(","));
      assert.equal(checkpointRequests.at(-1)?.nextWakeAt, dueAssistantWakeAt);
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, "assistant");
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, dueAssistantWakeAt);
      const publication = events.indexOf("workspace.checkpoint");
      assert.ok(publication >= 0);
      assert.ok(!events.slice(publication + 1).some((event) => event.startsWith("assistant:")), events.join(","));
      assert.equal(durableEffect.mock.calls.length, 1);
      assert.ok(publication < events.indexOf("durable-effect"));
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("hands off a due wake blocked only by durable effects to the successor", async () => {
    // Incident shape (2026-07-03): a reply turn leaves a plain due assistant
    // wake (starved system-lane work) plus pending durable effects (consume
    // acks). The attempt must checkpoint, run the effects, service the
    // still-due wake in-attempt, and finish with a non-due return instead of
    // handing a due wake to the orchestrator, which has no prompt transport
    // for it.
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_effects_blocked_due_wake_001",
        laneSeq: "1",
      }),
    ];
    const dueWakeAt = new Date(Date.now() - 1_000).toISOString();
    const foregroundAfterCheckpointGate = createDeferred<void>();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {};
    });
    let assistantPass = 0;
    let snapshotCount = 0;
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_effects_blocked_due_wake",
            runnerIdleTtlMs: 25,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            snapshotCount += 1;
            events.push(`snapshot:${snapshotInput.reason}:${snapshotCount}`);
            return {
              snapshotRef: createSnapshotFixtureRef({
                hash: String(snapshotCount).repeat(64),
                size: 512,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            if (item.item.id !== "mailbox_item_entrypoint_effects_blocked_due_wake_001") {
              return { status: "imported" };
            }

            return {
              afterCheckpoint: async () => {
                events.push("mailbox.afterCheckpoint:start");
                await foregroundAfterCheckpointGate.promise;
                events.push("mailbox.afterCheckpoint:done");
                return {
                  attachmentEvidenceUpdated: true,
                  kind: "inbox_projection",
                  projectionUpdated: true,
                  reasonCode: null,
                  status: "succeeded",
                };
              },
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: mailboxItems,
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase(input) {
            assistantPass += 1;
            events.push(`assistant:${assistantPass}`);

            if (assistantPass === 1) {
              return {
                afterCheckpoint: async () => ({
                  afterDurableCheckpoint: durableEffect,
                  checkpointReason: "system_mailbox_receipt",
                }),
                checkpointReason: "system_mailbox_receipt",
                nextWakeAt: dueWakeAt,
                nextWakeReason: "assistant",
                progressed: true,
              };
            }

            if (assistantPass === 2) {
              assert.ok(
                events.includes(
                  "mailbox.importItem:mailbox_item_entrypoint_effects_blocked_due_wake_002",
                ),
                events.join(","),
              );
              assert.notEqual(input.workspace?.nextWakeAt, dueWakeAt);
              assert.ok(
                !events.includes("workspace.checkpoint"),
                events.join(","),
              );
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: null,
                nextWakeReason: null,
                progressed: true,
              };
            }

            if (assistantPass === 3) {
              // The service pass runs only after the checkpoint committed the
              // pending durable effects.
              assert.ok(events.includes("durable-effect"), events.join(","));
              assert.equal(input.workspace?.nextWakeAt, dueWakeAt);
              assert.equal(input.workspace?.nextWakeReason, "assistant");
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: null,
                nextWakeReason: null,
                progressed: true,
              };
            }

            throw new Error("Effects-blocked due wake should be serviced exactly once.");
          },
          runtimeWakeSignal,
          vaultRoot,
        },
      );

      await waitUntil(() => {
        assert.equal(events.includes("mailbox.afterCheckpoint:start"), true, events.join(","));
      }, 10_000);
      mailboxItems.push(createMailboxItem({
        id: "mailbox_item_entrypoint_effects_blocked_due_wake_002",
        laneSeq: "2",
      }));
      runtimeWakeSignal.notify();
      await waitUntil(() => {
        assert.equal(events.includes("assistant:2"), true);
      });
      assert.ok(
        !events.includes("workspace.checkpoint"),
        events.join(","),
      );
      foregroundAfterCheckpointGate.resolve();

      const result = await withRealTimeout(
        resultPromise,
        15_000,
        () => events.join(","),
      );

      assert.equal(assistantPass, 2, events.join(","));
      assert.equal(checkpointRequests.length, 1, events.join(","));
      assert.equal(checkpointRequests.at(-1)?.nextWakeAt, dueWakeAt);
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, "assistant");
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, dueWakeAt);
      const publication = events.indexOf("workspace.checkpoint");
      assert.ok(publication >= 0);
      assert.ok(!events.slice(publication + 1).some((event) => event.startsWith("assistant:")), events.join(","));
      assert.equal(durableEffect.mock.calls.length, 1);
      assert.ok(publication < events.indexOf("durable-effect"));
    } finally {
      foregroundAfterCheckpointGate.resolve();
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  });

  test("source-blind pre-checkpoint wakes preserve durable-effects-blocked due wakes", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_effects_blocked_dirty_wake_001",
        laneSeq: "1",
      }),
    ];
    const dueWakeAt = new Date(Date.now() - 1_000).toISOString();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {};
    });
    let assistantPass = 0;
    let snapshotCount = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_effects_blocked_dirty_wake",
              runnerIdleTtlMs: 25,
              leaseGeneration: "7",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              snapshotCount += 1;
              events.push(`snapshot:${snapshotInput.reason}:${snapshotCount}`);
              return {
                snapshotRef: createSnapshotFixtureRef({
                  hash: String(snapshotCount).repeat(64),
                  size: 512,
                }),
              };
            },
            async importItem(item) {
              events.push(`mailbox.importItem:${item.item.id}`);
              return { status: "imported" };
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: mailboxItems,
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase(input) {
              assistantPass += 1;
              events.push(`assistant:${assistantPass}`);

              if (assistantPass === 1) {
                return {
                  afterCheckpoint: async () => {
                    events.push("assistant.afterCheckpoint:1");
                    mailboxItems.push(createMailboxItem({
                      id: "mailbox_item_entrypoint_effects_blocked_dirty_wake_002",
                      laneSeq: "2",
                    }));
                    runtimeWakeSignal.notify();
                    return {
                      afterDurableCheckpoint: durableEffect,
                      checkpointReason: "system_mailbox_receipt",
                    };
                  },
                  checkpointReason: "system_mailbox_receipt",
                  nextWakeAt: dueWakeAt,
                  nextWakeReason: "assistant",
                  progressed: true,
                };
              }

              if (assistantPass === 2) {
                assert.ok(
                  events.includes(
                    "mailbox.importItem:mailbox_item_entrypoint_effects_blocked_dirty_wake_002",
                  ),
                  events.join(","),
                );
                assert.notEqual(input.workspace?.nextWakeAt, dueWakeAt);
                assert.ok(
                  !events.includes("workspace.checkpoint"),
                  events.join(","),
                );
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: null,
                  nextWakeReason: null,
                  progressed: true,
                };
              }

              if (assistantPass === 3) {
                assert.ok(events.includes("durable-effect"), events.join(","));
                assert.equal(input.workspace?.nextWakeAt, dueWakeAt);
                assert.equal(input.workspace?.nextWakeReason, "assistant");
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: null,
                  nextWakeReason: null,
                  progressed: true,
                };
              }

              throw new Error("Effects-blocked dirty wake should be serviced exactly once.");
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      assert.equal(assistantPass, 2, events.join(","));
      assert.equal(checkpointRequests.length, 1, events.join(","));
      assert.equal(checkpointRequests.at(-1)?.nextWakeAt, dueWakeAt);
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, "assistant");
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, dueWakeAt);
      const publication = events.indexOf("workspace.checkpoint");
      assert.ok(publication >= 0);
      assert.ok(!events.slice(publication + 1).some((event) => event.startsWith("assistant:")), events.join(","));
      assert.equal(durableEffect.mock.calls.length, 1);
      assert.ok(publication < events.indexOf("durable-effect"));
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("source-blind competing wakes preserve durable-effects-blocked assistant wakes as checkpoint wakes", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_competing_effects_blocked_wake_001",
        laneSeq: "1",
      }),
    ];
    const blockedWakeAt = new Date(Date.now() - 30_000).toISOString();
    const competingWakeAt = new Date(Date.now() - 60_000).toISOString();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {};
    });
    let assistantPass = 0;
    let snapshotCount = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_competing_effects_blocked_wake",
              runnerIdleTtlMs: 25,
              leaseGeneration: "7",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              snapshotCount += 1;
              events.push(`snapshot:${snapshotInput.reason}:${snapshotCount}`);
              return {
                snapshotRef: createSnapshotFixtureRef({
                  hash: String(snapshotCount).repeat(64),
                  size: 512,
                }),
              };
            },
            async importItem(item) {
              events.push(`mailbox.importItem:${item.item.id}`);
              return { status: "imported" };
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: mailboxItems,
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase(input) {
              assistantPass += 1;
              events.push(`assistant:${assistantPass}`);

              if (assistantPass === 1) {
                return {
                  afterCheckpoint: async () => {
                    events.push("assistant.afterCheckpoint:1");
                    mailboxItems.push(createMailboxItem({
                      id: "mailbox_item_entrypoint_competing_effects_blocked_wake_002",
                      laneSeq: "2",
                    }));
                    runtimeWakeSignal.notify();
                    return {
                      afterDurableCheckpoint: durableEffect,
                      checkpointReason: "system_mailbox_receipt",
                    };
                  },
                  checkpointReason: "system_mailbox_receipt",
                  nextWakeAt: blockedWakeAt,
                  nextWakeReason: "assistant",
                  progressed: true,
                };
              }

              if (assistantPass === 2) {
                assert.ok(
                  events.includes(
                    "mailbox.importItem:mailbox_item_entrypoint_competing_effects_blocked_wake_002",
                  ),
                  events.join(","),
                );
                assert.notEqual(input.workspace?.nextWakeAt, blockedWakeAt);
                assert.ok(
                  !events.includes("workspace.checkpoint"),
                  events.join(","),
                );
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: competingWakeAt,
                  nextWakeReason: "assistant",
                  progressed: true,
                };
              }

              if (assistantPass === 3) {
                assert.ok(events.includes("durable-effect"), events.join(","));
                assert.equal(input.workspace?.nextWakeAt, blockedWakeAt);
                assert.equal(input.workspace?.nextWakeReason, "assistant");
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: null,
                  nextWakeReason: null,
                  progressed: true,
                };
              }

              throw new Error("Durable-effects-blocked wake should service once after checkpoint.");
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      assert.equal(assistantPass, 2, events.join(","));
      assert.equal(checkpointRequests.length, 1, events.join(","));
      assert.equal(checkpointRequests.at(-1)?.nextWakeAt, blockedWakeAt);
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, "assistant");
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, blockedWakeAt);
      const publication = events.indexOf("workspace.checkpoint");
      assert.ok(publication >= 0);
      assert.ok(!events.slice(publication + 1).some((event) => event.startsWith("assistant:")), events.join(","));
      assert.equal(durableEffect.mock.calls.length, 1);
      assert.ok(publication < events.indexOf("durable-effect"));
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("source-blind pre-checkpoint wakes preserve checkpoint-gated due assistant wakes as checkpoint wakes", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_checkpoint_gated_dirty_wake_001",
        laneSeq: "1",
      }),
    ];
    const dueWakeAt = new Date(Date.now() - 1_000).toISOString();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let assistantPass = 0;
    let snapshotCount = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_checkpoint_gated_dirty_wake",
              runnerIdleTtlMs: 25,
              leaseGeneration: "7",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              snapshotCount += 1;
              events.push(`snapshot:${snapshotInput.reason}:${snapshotCount}`);
              return {
                snapshotRef: createSnapshotFixtureRef({
                  hash: String(snapshotCount).repeat(64),
                  size: 512,
                }),
              };
            },
            async importItem(item) {
              events.push(`mailbox.importItem:${item.item.id}`);
              return { status: "imported" };
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: mailboxItems,
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase(input) {
              assistantPass += 1;
              events.push(`assistant:${assistantPass}`);

              if (assistantPass === 1) {
                return {
                  afterCheckpoint: async () => {
                    events.push("assistant.afterCheckpoint:1");
                    mailboxItems.push(createMailboxItem({
                      id: "mailbox_item_entrypoint_checkpoint_gated_dirty_wake_002",
                      laneSeq: "2",
                    }));
                    runtimeWakeSignal.notify();
                    return {
                      checkpointReason: "system_mailbox_receipt",
                      nextWakeAt: dueWakeAt,
                      nextWakeReason: "assistant",
                    };
                  },
                  checkpointReason: "system_mailbox_receipt",
                  progressed: true,
                };
              }

              if (assistantPass === 2) {
                assert.ok(
                  events.includes(
                    "mailbox.importItem:mailbox_item_entrypoint_checkpoint_gated_dirty_wake_002",
                  ),
                  events.join(","),
                );
                assert.notEqual(input.workspace?.nextWakeAt, dueWakeAt);
                assert.ok(
                  !events.includes("workspace.checkpoint"),
                  events.join(","),
                );
                return {
                  browserVaultReplicaRefreshRequested: true,
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: dueWakeAt,
                  nextWakeReason: "assistant",
                  progressed: true,
                };
              }

              if (assistantPass === 3) {
                assert.equal(input.workspace?.nextWakeAt, dueWakeAt);
                assert.equal(input.workspace?.nextWakeReason, "assistant");
                assert.ok(events.includes("workspace.checkpoint"), events.join(","));
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: null,
                  nextWakeReason: null,
                  progressed: true,
                };
              }

              throw new Error("Checkpoint-gated dirty wake should service once after checkpoint.");
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      assert.equal(assistantPass, 2, events.join(","));
      assert.equal(checkpointRequests.length, 1, events.join(","));
      assert.equal(checkpointRequests.at(-1)?.nextWakeAt, dueWakeAt);
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, "assistant");
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, dueWakeAt);
      const publication = events.indexOf("workspace.checkpoint");
      assert.ok(publication >= 0);
      assert.ok(!events.slice(publication + 1).some((event) => event.startsWith("assistant:")), events.join(","));
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("hands off a durable-effect due assistant wake after forced follow-up checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const dueWakeAt = new Date(Date.now() - 1_000).toISOString();
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {
        nextWakeAt: dueWakeAt,
        nextWakeReason: "assistant",
        requiresFollowUpCheckpoint: true,
      };
    });
    let assistantPass = 0;
    let snapshotCount = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_durable_effect_follow_up_due_wake",
            runnerIdleTtlMs: 25,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            snapshotCount += 1;
            events.push(`snapshot:${snapshotInput.reason}:${snapshotCount}`);
            return {
              snapshotRef: createSnapshotFixtureRef({
                hash: String(snapshotCount).repeat(64),
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase(input) {
            assistantPass += 1;
            events.push(`assistant:${assistantPass}`);

            if (assistantPass === 1) {
              return {
                afterCheckpoint: async () => ({
                  afterDurableCheckpoint: durableEffect,
                  checkpointReason: "system_mailbox_receipt",
                }),
                checkpointReason: "system_mailbox_receipt",
                progressed: true,
              };
            }

            if (assistantPass === 2) {
              assert.equal(input.workspace?.nextWakeAt, dueWakeAt);
              assert.equal(input.workspace?.nextWakeReason, "assistant");
              assert.ok(events.includes("durable-effect"), events.join(","));
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: null,
                nextWakeReason: null,
                progressed: true,
              };
            }

            throw new Error("Durable-effect due wake should be serviced exactly once.");
          },
          vaultRoot,
        },
      );

      assert.equal(assistantPass, 1, events.join(","));
      assert.equal(checkpointRequests.length, 2, events.join(","));
      assert.equal(checkpointRequests.at(-1)?.nextWakeAt, dueWakeAt);
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, "assistant");
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, dueWakeAt);
      const publication = events.indexOf("workspace.checkpoint");
      assert.ok(publication >= 0);
      assert.ok(!events.slice(publication + 1).some((event) => event.startsWith("assistant:")), events.join(","));
      assert.equal(durableEffect.mock.calls.length, 1);
      assert.ok(publication < events.indexOf("durable-effect"));
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("fresh due assistant wake replaces checkpointed due wake after fresh post-checkpoint input", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const mailboxItems: HostedMailboxItem[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const dueWakeAt = new Date(Date.now() - 60_000).toISOString();
    const freshDueWakeAt = new Date(Date.now() - 30_000).toISOString();
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {
        nextWakeAt: dueWakeAt,
        nextWakeReason: "assistant",
        requiresFollowUpCheckpoint: true,
      };
    });
    let assistantPass = 0;
    let snapshotCount = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_follow_up_fresh_due_wake",
              runnerIdleTtlMs: 25,
              leaseGeneration: "7",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              snapshotCount += 1;
              events.push(`snapshot:${snapshotInput.reason}:${snapshotCount}`);
              return {
                snapshotRef: createSnapshotFixtureRef({
                  hash: String(snapshotCount).repeat(64),
                  size: 512,
                }),
              };
            },
            async importItem(item) {
              events.push(`mailbox.importItem:${item.item.id}`);
              return { status: "imported" };
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: mailboxItems,
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                checkpointWorkspace(request) {
                  const workspace = createWorkspaceState({
                    inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
                    nextWakeAt: request.nextWakeAt ?? null,
                    nextWakeReason: request.nextWakeReason ?? null,
                    redactedStatus: request.redactedStatus ?? null,
                    snapshotRef: request.snapshotRef,
                    version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
                  });
                  if (request.expectedWorkspaceVersion === "1") {
                    events.push("runtime-wake:after-follow-up-checkpoint");
                    mailboxItems.push(createMailboxItem({
                      id: "mailbox_item_entrypoint_follow_up_fresh_due_input_001",
                      laneSeq: "1",
                    }));
                    runtimeWakeSignal.notify();
                  }
                  return workspace;
                },
                events,
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase(input) {
              assistantPass += 1;
              events.push(`assistant:${assistantPass}`);

              if (assistantPass === 1) {
                return {
                  afterCheckpoint: async () => ({
                    afterDurableCheckpoint: durableEffect,
                    checkpointReason: "system_mailbox_receipt",
                  }),
                  checkpointReason: "system_mailbox_receipt",
                  progressed: true,
                };
              }

              if (assistantPass === 2) {
                assert.equal(input.workspace?.nextWakeAt, dueWakeAt);
                assert.equal(input.workspace?.nextWakeReason, "assistant");
                return {
                  checkpointReason: "assistant_runtime_commit",
                  invocationLocalAssistantWakeAt: freshDueWakeAt,
                  nextWakeAt: freshDueWakeAt,
                  nextWakeReason: "assistant",
                  progressed: true,
                };
              }

              if (assistantPass === 3) {
                assert.equal(input.workspace?.nextWakeAt, freshDueWakeAt);
                assert.equal(input.workspace?.nextWakeReason, "assistant");
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: null,
                  nextWakeReason: null,
                  progressed: true,
                };
              }

              throw new Error("Fresh due wake should run once after checkpoint.");
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      assert.equal(assistantPass, 3, events.join(","));
      assert.equal(durableEffect.mock.calls.length, 1);
      assert.deepEqual(
        checkpointRequests.map((request) => [
          request.reason,
          request.expectedWorkspaceVersion,
          request.nextWakeAt,
          request.nextWakeReason,
        ]),
        [
          ["idle_shutdown", "0", null, null],
          ["idle_shutdown", "1", dueWakeAt, "assistant"],
          ["idle_shutdown", "2", null, null],
        ],
      );
      assert.ok(
        requireEventIndex(events, "snapshot:idle_shutdown:2")
          < requireEventIndex(events, "assistant:2"),
      );
      assert.ok(
        requireEventIndex(events, "assistant:2")
          < requireEventIndex(events, "assistant:3"),
      );
      assert.ok(
        requireEventIndex(events, "assistant:3")
          < requireEventIndex(events, "snapshot:idle_shutdown:3"),
      );
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("checkpoints durable follow-up effects before handing off their due assistant wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const wakeA = new Date(Date.now() - 60_000).toISOString();
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      runtimeWakeSignal.notify();
      return {
        nextWakeAt: wakeA,
        nextWakeReason: "assistant",
        requiresFollowUpCheckpoint: true,
      };
    });
    let assistantPass = 0;
    let snapshotCount = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_follow_up_preempted_replacement_wake",
              runnerIdleTtlMs: 25,
              leaseGeneration: "7",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              snapshotCount += 1;
              events.push(`snapshot:${snapshotInput.reason}:${snapshotCount}`);
              return {
                snapshotRef: createSnapshotFixtureRef({
                  hash: String(snapshotCount).repeat(64),
                  size: 512,
                }),
              };
            },
            async importItem() {
              return { status: "imported" };
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: [],
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase(input) {
              assistantPass += 1;
              events.push(`assistant:${assistantPass}`);

              if (assistantPass === 1) {
                return {
                  afterCheckpoint: async () => ({
                    afterDurableCheckpoint: durableEffect,
                    checkpointReason: "system_mailbox_receipt",
                  }),
                  checkpointReason: "system_mailbox_receipt",
                  progressed: true,
                };
              }

              if (assistantPass === 2) {
                assert.ok(events.includes("durable-effect"), events.join(","));
                assert.equal(input.workspace?.nextWakeAt, wakeA);
                assert.equal(input.workspace?.nextWakeReason, "assistant");
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: null,
                  nextWakeReason: null,
                  progressed: true,
                };
              }

              throw new Error("Durable-effect due wake should be serviced exactly once.");
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      assert.equal(assistantPass, 1, events.join(","));
      assert.equal(checkpointRequests.length, 2, events.join(","));
      assert.equal(checkpointRequests.at(-1)?.nextWakeAt, wakeA);
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, "assistant");
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, wakeA);
      const publication = events.indexOf("workspace.checkpoint");
      assert.ok(publication >= 0);
      assert.ok(!events.slice(publication + 1).some((event) => event.startsWith("assistant:")), events.join(","));
      assert.equal(durableEffect.mock.calls.length, 1);
      assert.ok(publication < events.indexOf("durable-effect"));
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("hands off an already-projected due assistant wake after durable follow-up checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const dueWakeAt = new Date(Date.now() - 1_000).toISOString();
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {
        nextWakeAt: dueWakeAt,
        nextWakeReason: "assistant",
        requiresFollowUpCheckpoint: true,
      };
    });
    let assistantPass = 0;
    let snapshotCount = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_projected_follow_up_due_wake",
            runnerIdleTtlMs: 25,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            snapshotCount += 1;
            events.push(`snapshot:${snapshotInput.reason}:${snapshotCount}`);
            return {
              snapshotRef: createSnapshotFixtureRef({
                hash: String(snapshotCount).repeat(64),
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase(input) {
            assistantPass += 1;
            events.push(`assistant:${assistantPass}`);

            if (assistantPass === 1) {
              return {
                afterCheckpoint: async () => ({
                  afterDurableCheckpoint: durableEffect,
                  checkpointReason: "system_mailbox_receipt",
                }),
                checkpointReason: "system_mailbox_receipt",
                nextWakeAt: dueWakeAt,
                nextWakeReason: "assistant",
                progressed: true,
              };
            }

            if (assistantPass === 2) {
              assert.equal(input.workspace?.nextWakeAt, dueWakeAt);
              assert.equal(input.workspace?.nextWakeReason, "assistant");
              assert.ok(events.includes("durable-effect"), events.join(","));
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: null,
                nextWakeReason: null,
                progressed: true,
              };
            }

            throw new Error("Already-projected due wake should be serviced exactly once.");
          },
          vaultRoot,
        },
      );

      assert.equal(assistantPass, 1, events.join(","));
      assert.equal(checkpointRequests.length, 2, events.join(","));
      assert.equal(checkpointRequests.at(-1)?.nextWakeAt, dueWakeAt);
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, "assistant");
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, dueWakeAt);
      const publication = events.indexOf("workspace.checkpoint");
      assert.ok(publication >= 0);
      assert.ok(!events.slice(publication + 1).some((event) => event.startsWith("assistant:")), events.join(","));
      assert.equal(durableEffect.mock.calls.length, 1);
      assert.ok(publication < events.indexOf("durable-effect"));
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("hands off a checkpoint-blocked projected assistant wake after idle checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const dueWakeAt = TEST_NOW;
    let assistantPass = 0;
    let snapshotCount = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_checkpoint_blocked_due_wake",
            runnerIdleTtlMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            snapshotCount += 1;
            events.push(`snapshot:${snapshotInput.reason}:${snapshotCount}`);
            return {
              snapshotRef: createSnapshotFixtureRef({
                hash: String(snapshotCount).repeat(64),
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Checkpoint-blocked wake test should not import mailbox items.");
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase(input) {
            assistantPass += 1;
            events.push(`assistant:${assistantPass}`);

            if (assistantPass === 1) {
              const redactedStatus: HostedRuntimeRedactedJson = {
                hostedOutboxPendingDeliveryEffects: 1,
              };
              return {
                afterCheckpoint: async () => ({
                  checkpointReason: "outbox_receipt",
                  nextWakeAt: dueWakeAt,
                  nextWakeReason: "assistant",
                  redactedStatus: {
                    hostedOutboxDeliverySent: 1,
                  },
                }),
                checkpointReason: "outbox_sending",
                progressed: true,
                redactedStatus,
              };
            }

            if (assistantPass === 2) {
              assert.equal(input.workspace?.nextWakeAt, dueWakeAt);
              assert.equal(input.workspace?.nextWakeReason, "assistant");
              const redactedStatus: HostedRuntimeRedactedJson = {
                hostedAssistantProgressed: true,
                hostedAssistantNextWakeAt: null,
              };
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: null,
                nextWakeReason: null,
                progressed: true,
                redactedStatus,
              };
            }

            throw new Error("Checkpoint-blocked wake should be serviced exactly once.");
          },
          vaultRoot,
        },
      );

      assert.equal(assistantPass, 1, events.join(","));
      assert.equal(checkpointRequests.length, 1, events.join(","));
      assert.equal(checkpointRequests.at(-1)?.nextWakeAt, dueWakeAt);
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, "assistant");
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, dueWakeAt);
      const publication = events.indexOf("workspace.checkpoint");
      assert.ok(publication >= 0);
      assert.ok(!events.slice(publication + 1).some((event) => event.startsWith("assistant:")), events.join(","));
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("hands off a checkpointed plain due assistant wake to the successor", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const mintedWakeAt = new Date(Date.now() - 60_000).toISOString();
    const replacementWakeAt = new Date(Date.now() - 30_000).toISOString();
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {};
    });
    let assistantPass = 0;
    let snapshotCount = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await withRealTimeout(
        runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: "attempt_synthetic_replaced_plain_due_wake",
              runnerIdleTtlMs: 25,
              leaseGeneration: "7",
              userId: TEST_USER_ID,
              workspaceVersion: "0",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              snapshotCount += 1;
              events.push(`snapshot:${snapshotInput.reason}:${snapshotCount}`);
              return {
                snapshotRef: createSnapshotFixtureRef({
                  hash: String(snapshotCount).repeat(64),
                  size: 512,
                }),
              };
            },
            async importItem() {
              return { status: "imported" };
            },
            platform: createPlatform({
              mailboxPort: createMailboxPort({
                events,
                items: [],
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({ version: "0" }),
              }),
            }),
            runtimeWakeSignal,
            async runAssistantPhase(input) {
              assistantPass += 1;
              events.push(`assistant:${assistantPass}`);

              if (assistantPass === 1) {
                return {
                  afterCheckpoint: async () => {
                    runtimeWakeSignal.notify();
                    return {
                      afterDurableCheckpoint: durableEffect,
                      checkpointReason: "system_mailbox_receipt",
                      nextWakeAt: mintedWakeAt,
                      nextWakeReason: "assistant",
                    };
                  },
                  checkpointReason: "system_mailbox_receipt",
                  progressed: true,
                };
              }

              if (assistantPass === 2) {
                assert.equal(input.workspace?.nextWakeAt, mintedWakeAt);
                assert.equal(input.workspace?.nextWakeReason, "assistant");
                assert.ok(events.includes("durable-effect"), events.join(","));
                return {
                  checkpointReason: "assistant_runtime_commit",
                  invocationLocalAssistantWakeAt: replacementWakeAt,
                  nextWakeAt: replacementWakeAt,
                  nextWakeReason: "assistant",
                  progressed: true,
                };
              }

              if (assistantPass === 3) {
                assert.equal(input.workspace?.nextWakeAt, replacementWakeAt);
                assert.equal(input.workspace?.nextWakeReason, "assistant");
                return {
                  checkpointReason: "assistant_runtime_commit",
                  nextWakeAt: null,
                  nextWakeReason: null,
                  progressed: true,
                };
              }

              throw new Error("Replaced plain due wake should be serviced exactly once.");
            },
            vaultRoot,
          },
        ),
        15_000,
        () => events.join(","),
      );

      assert.equal(assistantPass, 1, events.join(","));
      assert.equal(checkpointRequests.length, 1, events.join(","));
      assert.equal(checkpointRequests.at(-1)?.nextWakeAt, mintedWakeAt);
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, "assistant");
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, mintedWakeAt);
      const publication = events.indexOf("workspace.checkpoint");
      assert.ok(publication >= 0);
      assert.ok(!events.slice(publication + 1).some((event) => event.startsWith("assistant:")), events.join(","));
      assert.equal(durableEffect.mock.calls.length, 1);
      assert.ok(publication < events.indexOf("durable-effect"));
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  });
