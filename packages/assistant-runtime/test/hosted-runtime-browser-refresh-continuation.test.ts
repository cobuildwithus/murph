import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { initializeVault } from "@murphai/core";
import type { HostedMailboxFetchRequest, HostedMailboxItem, HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { test } from "vitest";
import {
  TEST_NOW,
  createBrowserVaultReplicaRef,
  createMailboxItem,
  createMailboxPort,
  createPlatform,
  createVaultSnapshotBundle,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceState,
  removeTempRoot,
  runHostedWorkspaceRuntimeJobInProcess,
  withRealTimeout,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import { createCoalescingRuntimeWakeSignal } from "../src/hosted-runtime/runtime-wake.ts";

test.each(["empty-hint", "foreground", "incomplete-prefix", "failed-classification", "owner-handoff", "late-foreground"] as const)("preserves browser refresh and foreground authority: %s", async (wakeKind) => {
  let vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-browser-refresh-continuation-"));
  const roots = [vaultRoot];
  const events: string[] = [];
  const items: HostedMailboxItem[] = [];
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const classifierFetches: HostedMailboxFetchRequest[] = [];
  const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
  const controller = new AbortController();
  let injected = false;
  let firstPass = true;
  let foregroundImported = false;
  let foregroundServiced = false;
  let observeHeldClassification: (() => void) | null = null;
  const heldClassification = new Promise<void>((resolve) => { observeHeldClassification = resolve; });
  let pendingRun: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;
  const facts = () => JSON.stringify({ events, injected, foregroundImported, foregroundServiced, classifierFetchCount: classifierFetches.length });
  try {
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    const snapshot = await createVaultSnapshotBundle({ vaultRoot });
    const artifacts = new Map([[snapshot.hash, snapshot.bytes]]);
    let currentWorkspace = createWorkspaceState({ snapshotRef: snapshot.snapshotRef, version: "0" });
    const workspacePort = createWorkspacePort({ events, checkpointRequests, workspace: currentWorkspace });
    const mailboxPort = createMailboxPort({ events, items });
    const platform = createPlatform({
      events,
      artifactBytesByHash: artifacts,
      mailboxPort: {
        ...mailboxPort,
        async fetch(request, context) {
          const classifier = request.requestId.includes(":browser-vault-wake-classify");
          if (classifier) {
            classifierFetches.push(request);
            if (wakeKind === "late-foreground") {
              assert.ok(context?.signal);
              const signal = context.signal;
              events.push("classifier.held");
              observeHeldClassification?.();
              await new Promise<void>((_resolve, reject) => {
                const abort = () => {
                  events.push("classifier.aborted");
                  reject(signal.reason);
                };
                if (signal.aborted) abort();
                else signal.addEventListener("abort", abort, { once: true });
              });
            }
            if (wakeKind === "failed-classification") throw new Error("Synthetic browser wake classification failure.");
          }
          const response = await mailboxPort.fetch(request);
          return classifier && wakeKind === "incomplete-prefix"
            ? { ...response, maxSeqByLane: response.maxSeqByLane.map((lane) => lane.lane === "conversation" ? { ...lane, maxSeq: "2" } : lane) }
            : response;
        },
      },
      workspacePort: {
        ...workspacePort,
        async read() { return { fetchedAt: TEST_NOW, workspace: currentWorkspace }; },
        async checkpoint(request) {
          const result = await workspacePort.checkpoint(request);
          currentWorkspace = { ...result.workspace, browserVaultReplicaRef: currentWorkspace.browserVaultReplicaRef };
          return { ...result, workspace: currentWorkspace };
        },
      },
      browserVaultReplicaPort: {
        async write({ replica, signal }) {
          events.push("replica.write");
          if (!injected) {
            injected = true;
            signal?.addEventListener("abort", () => events.push("replica.interrupted"), { once: true });
            if (wakeKind === "foreground" || wakeKind === "late-foreground") items.push(createMailboxItem({ id: "mailbox_browser_refresh_foreground", laneSeq: "1" }));
            runtimeWakeSignal.notify({ requestedProcessingMode: wakeKind === "owner-handoff" ? "system_mailbox" : "default" });
            if (wakeKind === "late-foreground") {
              await withRealTimeout(heldClassification, 1_000, facts);
            } else {
              await delay(50);
            }
            signal?.throwIfAborted();
          }
          if (wakeKind === "foreground") assert.ok(foregroundServiced, "Fresh foreground must precede replica publication.");
          return createBrowserVaultReplicaRef(replica);
        },
        async publishRef({ replicaRef }) {
          events.push("replica.publish");
          currentWorkspace = { ...currentWorkspace, browserVaultReplicaRef: replicaRef };
          return { published: true, workspace: currentWorkspace };
        },
      },
    });
    const run = (attempt: number) => runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
      request: { attemptId: `attempt_browser_refresh_continuation_${attempt}`, idleCheckpointDelayMs: 1, workspaceVersion: currentWorkspace.version },
    }), {
      platform, vaultRoot, runtimeWakeSignal, signal: controller.signal,
      async createCheckpointSnapshot() {
        const next = await createVaultSnapshotBundle({ vaultRoot });
        artifacts.set(next.hash, next.bytes);
        return { snapshotRef: next.snapshotRef };
      },
      async importItem() { foregroundImported = true; return { status: "imported" }; },
      async runAssistantPhase() {
        if (firstPass) {
          firstPass = false;
          return { checkpointReason: "canonical_runtime_commit", progressed: true };
        }
        if (foregroundImported && !foregroundServiced) {
          foregroundServiced = true;
          events.push("foreground.serviced");
          return { checkpointReason: "canonical_runtime_commit", progressed: true };
        }
        return { progressed: false };
      },
    });
    pendingRun = run(1);
    const firstResult = await withRealTimeout(pendingRun, 10_000, facts);
    assert.ok(injected, facts());
    assert.equal(classifierFetches.length, wakeKind === "owner-handoff" ? 0 : 1,
      "Owner handoff interrupts before reading; other wakes require one bounded classifier fetch.");
    if (wakeKind === "late-foreground") {
      assert.ok(events.includes("classifier.held"), facts());
      assert.ok(events.indexOf("replica.publish") > events.indexOf("classifier.held"), facts());
      assert.ok(events.indexOf("classifier.aborted") > events.indexOf("replica.publish"), facts());
      const retainedWake = runtimeWakeSignal.consumePending();
      assert.ok(retainedWake !== null || foregroundServiced || (
        firstResult.status === "scheduled"
        && Date.parse(firstResult.nextWakeAt ?? "") <= Date.now()
      ), `Foreground arriving during unfinished classification retains its wake until service or immediate continuation. ${facts()}`);
      return;
    }
    if (wakeKind === "incomplete-prefix" || wakeKind === "failed-classification" || wakeKind === "owner-handoff") {
      assert.ok(events.includes("replica.interrupted"), facts());
      assert.equal(events.includes("replica.publish"), false, "Unknown foreground authority must preserve preemption.");
      assert.equal(firstResult.status, "scheduled", facts());
      assert.ok(firstResult.nextWakeAt, facts());
      return;
    }
    if (!events.includes("replica.publish")) {
      assert.equal(firstResult.status, "scheduled", facts());
      assert.ok(firstResult.nextWakeAt, facts());
      vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-browser-refresh-replacement-"));
      roots.push(vaultRoot);
      pendingRun = run(2);
      await withRealTimeout(pendingRun, 10_000, facts);
    }
    assert.ok(events.includes("replica.publish"), `A deferred refresh must survive a clean replacement. ${facts()}`);
    if (wakeKind === "foreground") assert.ok(foregroundServiced, facts());
  } finally {
    controller.abort(new Error("Synthetic test cleanup."));
    await pendingRun?.catch(() => undefined);
    for (const root of roots) await removeTempRoot(root);
  }
});
