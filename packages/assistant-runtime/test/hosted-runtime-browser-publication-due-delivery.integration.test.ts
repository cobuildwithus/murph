import {
  createBrowserVaultReplicaRef,
  createMailboxPort,
  createPlatform,
  createVaultSnapshotBundle,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceState,
  mocks,
  removeTempRoot,
  runHostedWorkspaceRuntimeJobInProcess,
  withRealTimeout,
  type RefreshHostedBrowserVaultReplicaFromRuntime,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  createAssistantOutboxIntent,
  readAssistantOutboxIntent,
  saveAssistantOutboxIntent,
} from "@murphai/assistant-engine";
import { initializeVault } from "@murphai/core";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { test } from "vitest";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime/runtime-wake.ts";
import { runHostedWorkspaceAssistantPhase } from "../src/hosted-runtime/workspace-assistant-phase.ts";

test("delivers an outbox intent once after browser publication times out with already-due work and no wake notification", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-browser-due-delivery-"));
  const roots = [vaultRoot];
  let activeVaultRoot = vaultRoot;
  const artifactBytesByHash = new Map<string, Uint8Array>();
  const events: string[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const refreshResults: Awaited<ReturnType<RefreshHostedBrowserVaultReplicaFromRuntime>>[] = [];
  const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
  const controller = new AbortController();
  const actualRefresh = mocks.actualRefreshHostedBrowserVaultReplicaFromRuntime;
  assert.ok(actualRefresh);
  let currentWorkspace = createWorkspaceState();
  let invocation = 1;
  let assistantPassesBeforeTimeout = 0;
  let sendCount = 0;
  let firstIdleCheckpoint = true;
  const runtimeCompletions: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess>[] = [];
  const facts = () => JSON.stringify({ events, invocation, sendCount, assistantPassesBeforeTimeout });
  try {
    const createdAt = new Date().toISOString();
    await initializeVault({ createdAt, vaultRoot });
    const dueAt = new Date(Date.now() + 10_000).toISOString();
    const intent = await createAssistantOutboxIntent({
      channel: "email",
      createdAt,
      explicitTarget: "member@example.test",
      message: "Synthetic queued delivery.",
      sessionId: "session_synthetic_due_delivery",
      threadIsDirect: true,
      turnId: "turn_synthetic_due_delivery",
      turnTrigger: "manual-deliver",
      vault: vaultRoot,
    });
    await saveAssistantOutboxIntent(vaultRoot, { ...intent, nextAttemptAt: dueAt });
    const initialSnapshot = await createVaultSnapshotBundle({ vaultRoot });
    artifactBytesByHash.set(initialSnapshot.hash, initialSnapshot.bytes);
    currentWorkspace = { ...currentWorkspace, snapshotRef: initialSnapshot.snapshotRef };

    // Use the production timeout/cancellation path with its existing test seam.
    // No fabricated refresh status or assistant phase result is supplied.
    mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementation(
      async (input: Parameters<RefreshHostedBrowserVaultReplicaFromRuntime>[0]) => {
        const result = await actualRefresh({ ...input, timeoutMs: 2_000 });
        refreshResults.push(result);
        events.push(`refresh:${result.status}`);
        return result;
      },
    );
    const workspacePort = createWorkspacePort({ checkpointRequests, events, workspace: currentWorkspace });
    const basePlatform = createPlatform({
      artifactBytesByHash,
      mailboxPort: createMailboxPort({ events, items: [] }),
      workspacePort: {
        ...workspacePort,
        async read() { return { fetchedAt: new Date().toISOString(), workspace: currentWorkspace }; },
        async checkpoint(request) {
          const result = await workspacePort.checkpoint(request);
          currentWorkspace = { ...result.workspace, browserVaultReplicaRef: currentWorkspace.browserVaultReplicaRef };
          if (request.reason === "idle_shutdown" && firstIdleCheckpoint) {
            firstIdleCheckpoint = false;
            assert.equal(sendCount, 0);
            assert.equal(request.nextWakeAt, dueAt);
            assert.equal(request.nextWakeReason, "assistant_delivery");
            // A deadline can pass during checkpoint publication without a new
            // mailbox item or runtime notification. Keep real timers running.
            await delay(Math.max(0, Date.parse(dueAt) - Date.now()), undefined, { signal: controller.signal });
            events.push("checkpoint:delivery_due");
          }
          return { ...result, workspace: currentWorkspace };
        },
      },
      browserVaultReplicaPort: {
        async write({ replica }) { return createBrowserVaultReplicaRef(replica); },
        async publishRef({ replicaRef, signal }) {
          if (invocation === 1) {
            assert.ok(signal);
            assert.ok(Date.now() >= Date.parse(dueAt));
            assert.equal(sendCount, 0);
            events.push("publication:stalled");
            await new Promise<void>((resolve) => {
              if (signal.aborted) resolve();
              else signal.addEventListener("abort", () => resolve(), { once: true });
            });
            events.push("publication:aborted");
            signal.throwIfAborted();
          }
          currentWorkspace = { ...currentWorkspace, browserVaultReplicaRef: replicaRef };
          return { published: true, workspace: currentWorkspace };
        },
      },
    });
    const platform = {
      ...basePlatform,
      effectsPort: {
        ...basePlatform.effectsPort,
        async resolveCurrentVerifiedEmailRecipient() { return "member@example.test"; },
        async sendEmail(request: Parameters<typeof basePlatform.effectsPort.sendEmail>[0]) {
          sendCount += 1;
          events.push("delivery:sent");
          assert.equal(invocation, 2, "Only the timeout continuation may deliver the saved intent.");
          assert.equal(request.target, "member@example.test");
          assert.equal(request.message, intent.message);
        },
      },
    };
    const run = async () => {
      const runtimeCompletion = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
        request: {
          attemptId: `attempt_synthetic_due_delivery_${invocation}`,
          workspaceVersion: currentWorkspace.version,
        },
        resolvedConfig: {
          channelCapabilities: { emailSendReady: true, telegramBotConfigured: false },
          deviceSync: null,
        },
      }), {
        platform,
        runtimeWakeSignal,
        signal: controller.signal,
        vaultRoot: activeVaultRoot,
        async createCheckpointSnapshot() {
          const snapshot = await createVaultSnapshotBundle({ vaultRoot: activeVaultRoot });
          artifactBytesByHash.set(snapshot.hash, snapshot.bytes);
          return { snapshotRef: snapshot.snapshotRef };
        },
        async importItem() { throw new Error("No mailbox work is present."); },
        async runAssistantPhase(input) {
          if (invocation === 1) {
            assistantPassesBeforeTimeout += 1;
            assert.ok(Date.now() < Date.parse(dueAt), "Due work must wait until the post-checkpoint publication offer.");
          }
          return await runHostedWorkspaceAssistantPhase(input);
        },
      });
      runtimeCompletions.push(runtimeCompletion);
      return await withRealTimeout(runtimeCompletion, 20_000, facts);
    };
    const timedOut = await run();
    assert.ok(events.includes("publication:stalled"), facts());
    assert.ok(events.includes("publication:aborted"), facts());
    assert.equal(refreshResults.length, 1, facts());
    assert.equal(refreshResults[0]?.status, "deferred_timeout", facts());
    assert.equal(assistantPassesBeforeTimeout, 1, facts());
    assert.equal(sendCount, 0, facts());
    assert.equal(timedOut.status, "scheduled", facts());
    assert.equal(timedOut.nextWakeAt, dueAt, facts());
    assert.equal(timedOut.nextWakeReason, "assistant_delivery", facts());
    assert.equal((await readAssistantOutboxIntent(vaultRoot, intent.intentId))?.status, "pending");

    // The existing returned deadline starts a successor; notify() is never used.
    invocation = 2;
    activeVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-browser-due-successor-"));
    roots.push(activeVaultRoot);
    await run();
    assert.equal(sendCount, 1, facts());
    assert.equal((await readAssistantOutboxIntent(activeVaultRoot, intent.intentId))?.status, "sent");
    invocation = 3;
    await run();
    assert.equal(sendCount, 1, "A later invocation must not replay the delivered intent.");
  } finally {
    controller.abort();
    await Promise.allSettled(runtimeCompletions);
    mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementation(actualRefresh);
    await Promise.all(roots.map((root) => removeTempRoot(root)));
  }
});
