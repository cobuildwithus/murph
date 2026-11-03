import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, vi } from "vitest";
import { initializeVault } from "@murphai/core";
import { listCanonicalEntities } from "@murphai/query";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import type { HostedRuntimeDeviceSyncPort } from "../src/hosted-runtime-contracts.ts";
import { createEmptyHostedMailboxImportState } from "../src/hosted-runtime/mailbox-state.ts";
import { enqueueHostedSystemMailboxItem } from "../src/hosted-runtime/system-mailbox.ts";
import { readHostedSystemMailboxState } from "../src/hosted-runtime/system-mailbox-state.ts";
import {
  TEST_NOW, TEST_USER_ID, createDeviceSyncResolvedConfig, createMailboxItem,
  createMailboxPort, createPlatform, createResolvedDeviceSyncSystemMailboxItem,
  buildJunctionSleepFixtureResponse, createSnapshotDeviceSyncPort, createVaultSnapshotBundle, createWorkspacePort,
  createWorkspaceRuntimeJobInput, createWorkspaceState, removeTempRoot,
  runHostedWorkspaceRuntimeJobInProcess, writeMailboxImportStateFile,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";

test.each([
  ["system_mailbox", "staged"], ["system_mailbox", "empty"],
  ["default", "staged"], ["default", "empty"],
  ["system_mailbox", "crash-before-ack"], ["system_mailbox", "crash-after-ack"],
  ["system_mailbox", "empty-crash-before-ack"], ["system_mailbox", "empty-crash-after-ack"],
  ["system_mailbox", "continuation"],
] as const)("device idle shutdown publishes one snapshot: %s / %s", async (processingMode, scenario) => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-device-single-snapshot-"));
  const connectionId = "synthetic-single-snapshot-connection";
  const futureAt = "2026-04-28T00:00:00.000Z";
  const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
  const events: string[] = [];
  const artifacts = new Map<string, Uint8Array>();
  const snapshots: Awaited<ReturnType<typeof createVaultSnapshotBundle>>[] = [];
  let acknowledged = false;
  let followUpAcknowledged = false;
  let ackCalls = 0;
  let providerCalls = 0;
  let sleepResourceCalls = 0;
  let replay = false;
  const hasPayload = !scenario.startsWith("empty");
  const basePort = createSnapshotDeviceSyncPort({ connectionId, nextReconcileAt: hasPayload ? futureAt : TEST_NOW });
  const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
    ...basePort,
    async fetchDirtyStates() {
      const followUp = scenario === "continuation" && acknowledged;
      return {
        hasMore: false, nextWakeAt: null, userId: TEST_USER_ID,
        items: !hasPayload || (acknowledged && (!followUp || followUpAcknowledged)) ? [] : [{
          connectionId, dirtyRevision: followUp ? "8" : "7", processedRevision: followUp ? "7" : "0",
          dirtyResources: [{
            count: 1, dirtyPayloadId: followUp ? "synthetic-followup-payload" : "synthetic-sleep-payload", jobKind: "resource",
            payload: { resource: "sleep", resourceCategory: "summary", sourceProviderSlug: "whoop_v2",
              objectId: followUp ? "synthetic-followup-sleep" : "synthetic-sleep" },
            resource: "sleep", resourceCategory: "summary", sourceProviderSlug: "whoop",
            windowEnd: null, windowStart: null,
          }],
          eventCount: "1", latestDirtyAt: TEST_NOW, provider: "junction",
          resourceCategoryCounts: { summary: 1 }, sourceProviderCounts: { whoop: 1 },
          userId: TEST_USER_ID, windowEnd: null, windowStart: null,
        }],
      };
    },
    async ackDirtyStateProcessed(request) {
      assert.ok(checkpointRequests.some((entry) => entry.reason === "idle_shutdown"), "ack follows publication");
      const followUp = request.processedRevision === "8";
      assert.deepEqual(request.processedDirtyPayloadIds,
        [followUp ? "synthetic-followup-payload" : "synthetic-sleep-payload"]);
      ackCalls++;
      acknowledged = true;
      followUpAcknowledged ||= followUp;
      const stillDirty = scenario === "continuation" && !followUpAcknowledged;
      return { connectionId, dirtyRevision: stillDirty || followUp ? "8" : "7",
        processedRevision: request.processedRevision,
        recorded: true, stillDirty, nextWakeAt: stillDirty ? TEST_NOW : futureAt, userId: TEST_USER_ID };
    },
  };
  const providerFetch: typeof fetch = async (request) => {
    const url = new URL(request instanceof Request ? request.url : String(request));
    assert.equal(url.origin, "https://junction.example.test");
    providerCalls++;
    if (url.pathname.includes("/summary/sleep/")) sleepResourceCalls++;
    // Junction returns the sleep summary for the dirty day; the restored
    // continuation pass sees only the follow-up sleep from that same day.
    return Response.json(buildJunctionSleepFixtureResponse(url.pathname, replay && scenario === "continuation" ? {
      id: "synthetic-followup-sleep",
      start: "2026-04-26T13:00:00.000Z", end: "2026-04-26T15:00:00.000Z",
      updated_at: "2026-04-26T16:00:00.000Z",
    } : {
      id: "synthetic-sleep",
      start: "2026-04-26T00:30:00.000Z", end: "2026-04-26T07:30:00.000Z",
      updated_at: "2026-04-26T08:00:00.000Z",
    }));
  };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(TEST_NOW));
  vi.stubGlobal("fetch", providerFetch);
  try {
    await initializeVault({ createdAt: TEST_NOW, vaultRoot });
    const item = createMailboxItem({ id: "synthetic-device-item", dedupeKey: "device-sync.wake:single",
      kind: "device-sync.wake", lane: "system", laneSeq: "1" });
    await enqueueHostedSystemMailboxItem({
      item: createResolvedDeviceSyncSystemMailboxItem(item), vaultRoot,
      wake: { connectionId, eventId: item.dedupeKey, expectedConnectedAt: TEST_NOW,
        hint: { occurredAt: TEST_NOW, reason: "webhook_dirty_transition" },
        kind: "device-sync.wake", occurredAt: TEST_NOW, provider: "junction",
        reason: hasPayload ? "webhook_hint" : "reconcile_due", userId: TEST_USER_ID },
    });
    const importState = createEmptyHostedMailboxImportState();
    importState.watermarks.system = "1";
    await writeMailboxImportStateFile(vaultRoot, importState);
    const initial = await createVaultSnapshotBundle({ vaultRoot });
    artifacts.set(initial.hash, initial.bytes);
    const run = (snapshot: typeof initial, version: string) => runHostedWorkspaceRuntimeJobInProcess(
      createWorkspaceRuntimeJobInput({ request: { processingMode, workspaceVersion: version, runnerIdleTtlMs: 1 },
        resolvedConfig: createDeviceSyncResolvedConfig() }), {
        vaultRoot,
        platform: { ...createPlatform({ artifactBytesByHash: artifacts, deviceSyncPort,
          mailboxPort: createMailboxPort({ events, items: [] }),
          workspacePort: createWorkspacePort({ events, checkpointRequests,
            workspace: createWorkspaceState({ snapshotRef: snapshot.snapshotRef, version }) }),
        }), providerFetch },
        async createCheckpointSnapshot() {
          if (!replay && snapshots.length === 0) {
            assert.equal(ackCalls, 0);
            const pending = (await readHostedSystemMailboxState(vaultRoot)).pending;
            assert.equal(pending[0]?.status, "recording");
            assert.ok(pending[0]?.postCheckpointRecord);
          }
          const next = await createVaultSnapshotBundle({ vaultRoot });
          snapshots.push(next);
          artifacts.set(next.hash, next.bytes);
          return { snapshotRef: next.snapshotRef };
        },
        async importItem() { return { status: "imported" }; },
      },
    );
    const result = await run(initial, "0");
    for (const entry of (await readHostedSystemMailboxState(vaultRoot)).pending) {
      assert.equal(entry.lastErrorMessage, null);
    }
    assert.equal(snapshots.length, 1, "one device pass must publish exactly one idle snapshot");
    assert.equal(ackCalls, hasPayload ? 1 : 0);
    const completion = checkpointRequests.at(-1)!;
    assert.equal(completion.reason, "canonical_runtime_commit");
    assert.deepEqual(completion.snapshotRef, snapshots[0]!.snapshotRef,
      "completion metadata retains the archive containing imported work");
    assert.equal(completion.nextWakeAt, result.nextWakeAt);
    assert.equal(completion.nextWakeReason ?? null, result.nextWakeReason ?? null);
    assert.ok(scenario === "continuation" || !completion.nextWakeAt || Date.parse(completion.nextWakeAt) > Date.now(),
      "recording must not leave an already-serviced due wake in Web");
    const before = await listCanonicalEntities(vaultRoot, { family: "event" });
    const sleepRows = (rows: typeof before) => rows.filter((row) => row.kind === "sleep_session")
      .map((row) => ({ startAt: row.attributes.startAt, endAt: row.attributes.endAt, dataOrigin: row.attributes.dataOrigin }))
      .sort((left, right) => String(left.startAt).localeCompare(String(right.startAt)));
    const junctionSleep = (startAt: string, endAt: string) => ({
      startAt, endAt,
      dataOrigin: { version: 1, aggregatorProvider: "junction", sourceProviderSlug: "whoop-v2",
        normalizerVersion: "junction-normalizer.v1", observedAtRaw: "2026-04-26T00:00:00.000Z", timestampSemantics: "utc" },
    });
    const firstSleep = junctionSleep("2026-04-26T00:30:00.000Z", "2026-04-26T07:30:00.000Z");
    if (hasPayload) assert.deepEqual(sleepRows(before), [firstSleep]);
    if (scenario === "continuation") {
      replay = true;
      const previousProviderCalls = providerCalls;
      const previousSleepResourceCalls = sleepResourceCalls;
      const continued = await run(snapshots[0]!, "1");
      assert.equal(snapshots.length, 2, "restore cleanup and the second device pass share one snapshot");
      assert.ok(followUpAcknowledged, "the restored invocation must process the new dirty payload");
      assert.equal(ackCalls, 3, "replay the durable ack, then acknowledge newly checkpointed work");
      assert.equal(sleepResourceCalls, previousSleepResourceCalls + 1, "only the new resource is fetched");
      assert.equal(providerCalls, previousProviderCalls + 2, "plus one Junction source check for that import");
      assert.deepEqual(sleepRows(await listCanonicalEntities(vaultRoot, { family: "event" })),
        [firstSleep, junctionSleep("2026-04-26T13:00:00.000Z", "2026-04-26T15:00:00.000Z")]);
      assert.ok(!continued.nextWakeAt || Date.parse(continued.nextWakeAt) > Date.now());
    }
    if (scenario.includes("crash-")) {
      replay = true;
      // Discard all local bookkeeping by restoring the exact first published
      // archive; Web either has or has not accepted the acknowledgement.
      acknowledged = scenario.endsWith("crash-after-ack");
      const previousProviderCalls = providerCalls;
      const durable = snapshots[0]!;
      await run(durable, "1");
      assert.equal(snapshots.length, 2, "recovery also publishes only one snapshot");
      if (hasPayload) assert.ok(acknowledged, "restored recording converges even if the ack never reached Web");
      assert.equal(ackCalls, hasPayload ? 2 : 0, "already recorded acknowledgements replay idempotently");
      assert.equal(providerCalls, previousProviderCalls, "checkpointed imports never refetch provider data");
      assert.deepEqual(await listCanonicalEntities(vaultRoot, { family: "event" }), before);
      const pending = (await readHostedSystemMailboxState(vaultRoot)).pending;
      assert.ok(pending.every((entry) => entry.status === "pending" && entry.postCheckpointRecord === null),
        "restored recording leaves only replayable continuation work");
      await run(snapshots[1]!, "2");
      assert.equal(ackCalls, hasPayload ? 2 : 0, "a later cold restore cannot replay a settled journal forever");
      assert.equal(providerCalls, previousProviderCalls);
    }
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    await removeTempRoot(vaultRoot);
  }
});
