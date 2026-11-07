import { createMealMediaStore, mediaFailure } from "./hosted-meal-media.harness.ts";
import { publishHostedWorkspaceMediaReferencesForSnapshot, publishHostedWorkspaceMediaReferences, readHostedMediaReferenceCatalogue } from "../src/hosted-runtime/media-references.ts";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as realDelay } from "node:timers/promises";
import { addCaptureWithLookup, addMeal, addMeasurement, runMealPhotoMaintenance, initializeVault } from "@murphai/core";
import { persistCanonicalInboxCapture } from "@murphai/inboxd";
import * as inboxRetention from "@murphai/inboxd/retention";
import {
  sha256HostedBundleHex,
  snapshotHostedBundleRoots,
} from "@murphai/runtime-state/node";
import type { HostedWorkspaceCheckpointRequest } from "@murphai/hosted-execution/runtime-control";
import { expect, test, vi } from "vitest";
import {
  TEST_USER_ID,
  createSnapshotFixtureRef,
  createCanonicalReceiptLogArtifacts,
  createMailboxPort,
  createPlatform,
  createWorkspacePort,
  createWorkspaceRuntimeJobInput,
  createWorkspaceState,
  removeTempRoot,
  withRealTimeout,
  waitForFakeTimerScheduled,
} from "./hosted-runtime-workspace-entrypoint.harness.ts";
import {
  createCoalescingRuntimeWakeSignal,
  HostedRuntimeCheckpointInterruptedByWakeError,
  runHostedWorkspaceRuntimeJobInProcess,
  type HostedWorkspaceRuntimeJobOptions,
} from "../src/hosted-runtime.ts";
import { HOSTED_CANONICAL_WRITE_RECEIPT_LOG_BACKGROUND_YIELD_THRESHOLD } from "../src/hosted-runtime/canonical-write-receipt-log.ts";

const START = Date.parse("2026-10-15T00:00:00.000Z");
const WINDOW = 10 * 60 * 1000;

async function createRetentionFixture(
  groups: Array<{ offset: number; count: number }>,
  { defaultWakeOffset = 24 * 60 * 60 * 1000, generatedImages = 0, receiptCount = 0, pendingMeal = false, pendingMeasurement = false, retentionDue = false } = {},
) {
  const root = await mkdtemp(path.join(tmpdir(), "murph-retention-wakes-"));
  const source = path.join(root, "source");
  const live = path.join(root, "live");
  const artifacts = new Map<string, Uint8Array>();
  const media: Array<{ storedPath: string; expiresAt: number }> = [];
  const generatedPaths: string[] = [];
  const mealMedia = createMealMediaStore();
  await initializeVault({ vaultRoot: source, createdAt: new Date(START).toISOString() });
  for (const [index, group] of groups.entries()) {
    const recordedAt = new Date(START + group.offset - 14 * 24 * 60 * 60 * 1000).toISOString();
    const capture = await persistCanonicalInboxCapture({
      vaultRoot: source,
      captureId: `cap_synthetic_retention_burst_${index}`,
      eventId: `evt_01JQ8PWXP5A68SQM1W0GYM410${index}`,
      storedAt: recordedAt,
      input: {
        source: "telegram", accountId: "self", externalId: `synthetic-retention-${index}`,
        thread: { id: "synthetic-retention", isDirect: true }, actor: { isSelf: false },
        occurredAt: recordedAt, receivedAt: recordedAt, text: "Synthetic retention fixture", raw: {},
        attachments: Array.from({ length: group.count }, (_, attachment) => ({
          kind: "audio" as const, mime: "audio/mp4", fileName: `voice-${attachment}.m4a`,
          data: Buffer.from(`synthetic-audio-${index}-${attachment}`),
        })),
      },
    });
    for (const attachment of capture.stored.attachments) {
      assert.ok(attachment.storedPath);
      media.push({ storedPath: attachment.storedPath, expiresAt: START + group.offset });
    }
  }
  for (let index = 0; index < generatedImages; index += 1) {
    const sourcePath = path.join(root, "generated.webp");
    await writeFile(sourcePath, `synthetic-generated-image-${index}`);
    const recordedAt = new Date(START - 14 * 24 * 60 * 60 * 1000).toISOString();
    const capture = await addCaptureWithLookup({
      attachments: [{ role: "media_1", sourcePath }],
      draft: { note: "Synthetic generated image.", occurredAt: recordedAt, recordedAt, source: "derived", tags: ["assistant-generated-image", "generated-image"], title: "Synthetic image" },
      lookupAttachmentRole: "media_1", lookupKey: `generated:synthetic-retention-${index}`,
      rawImport: { importKind: "capture", importedAt: recordedAt, source: "murph.generate_image",
        provenance: { family: "capture", generatedImage: { schema: "murph.generated-image.v1" }, mediaCount: 1 } },
      vaultRoot: source,
    });
    const storedPath = capture.event.attachments?.[0]?.relativePath;
    assert.ok(storedPath);
    generatedPaths.push(storedPath);
  }
  if (pendingMeal) {
    const photoPath = path.join(root, "fixture.png");
    await writeFile(photoPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64"));
    await addMeal({ vaultRoot: source, photoPath, occurredAt: new Date(START).toISOString(), photoCapturedAt: new Date(START).toISOString() });
    await runMealPhotoMaintenance({ vaultRoot: source, now: new Date(START) });
    await publishHostedWorkspaceMediaReferences({ vaultRoot: source, mediaStore: mealMedia.mediaStore });
    expect(mealMedia.calls).toEqual([]);
  }
  if (pendingMeasurement) {
    const sourcePath = path.join(root, "measurement.jpg");
    await writeFile(sourcePath, "synthetic measurement photo");
    await addMeasurement({ vaultRoot: source, attachments: [{ role: "media_1", sourcePath }],
      draft: { title: "Synthetic measurement", occurredAt: new Date(START).toISOString(), measurements: [{ metric: "weight", value: 70, unit: "kg" }] } });
    vi.setSystemTime(START);
    await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot: source, mediaStore: mealMedia.mediaStore });
  }
  const snapshot = async (vaultRoot: string) => {
    const bundle = await snapshotHostedBundleRoots({ kind: "vault", roots: [{ root: vaultRoot, rootKey: "vault" }] });
    assert.ok(bundle);
    const hash = sha256HostedBundleHex(bundle);
    artifacts.set(hash, bundle);
    return createSnapshotFixtureRef({ hash, size: bundle.byteLength });
  };
  const receipts = createCanonicalReceiptLogArtifacts(receiptCount);
  for (const [hash, bytes] of receipts.artifactBytesByHash) artifacts.set(hash, bytes);
  let workspace = createWorkspaceState({
    version: "0", snapshotRef: await snapshot(source),
    inboxMediaRetentionWakeAt: new Date(START).toISOString(),
    // Production publishes the earlier due retention wake as nextWakeAt and keeps
    // the assistant wake separately.
    ...(retentionDue
      ? { nextWakeAt: new Date(START).toISOString(), nextWakeReason: "inbox_media_retention" }
      : { nextWakeAt: new Date(START + defaultWakeOffset).toISOString(), nextWakeReason: "assistant" }),
    nextDefaultProcessingWakeAt: new Date(START + defaultWakeOffset).toISOString(), nextDefaultProcessingWakeReason: "assistant",
    redactedStatus: receiptCount > 0 ? {
      hostedCanonicalWriteReceiptLogByteSize: receipts.receiptLogBytes.byteLength,
      hostedCanonicalWriteReceiptLogSha256: receipts.receiptLogHash,
    } : null,
  });
  const checkpoints: HostedWorkspaceCheckpointRequest[] = [];
  const snapshotTimes: number[] = [];
  const invoke = (options: Partial<HostedWorkspaceRuntimeJobOptions> = {}) => runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({ request: {
    attemptId: "attempt_synthetic_retention_burst", leaseGeneration: "7", userId: TEST_USER_ID,
    processingMode: "inbox_media_retention", workspaceVersion: workspace.version, runnerIdleTtlMs: WINDOW,
  } }), {
    vaultRoot: live,
    platform: { ...createPlatform({ artifactBytesByHash: artifacts, mailboxPort: createMailboxPort({ events: [], items: [] }), workspacePort: createWorkspacePort({
      events: [], checkpointRequests: checkpoints, workspace,
      checkpointWorkspace(request) {
        workspace = { ...workspace, snapshotRef: request.snapshotRef,
          redactedStatus: request.redactedStatus ?? null,
          inboxMediaRetentionWakeAt: request.inboxMediaRetentionWakeAt ?? null,
          nextWakeAt: request.nextWakeAt ?? null, nextWakeReason: request.nextWakeReason ?? null,
          ...(request.nextDefaultProcessingWakeAt === undefined ? {} : {
            nextDefaultProcessingWakeAt: request.nextDefaultProcessingWakeAt,
            nextDefaultProcessingWakeReason: request.nextDefaultProcessingWakeReason ?? null,
          }),
          version: String(BigInt(request.expectedWorkspaceVersion) + 1n) };
        return workspace;
      },
    }) }), ...(pendingMeal || pendingMeasurement ? { mediaStore: mealMedia.mediaStore } : {}) },
    async createCheckpointSnapshot() {
      snapshotTimes.push(Date.now());
      for (const item of media.filter((item) => item.expiresAt > Date.now())) {
        expect((await stat(path.join(live, item.storedPath))).isFile()).toBe(true);
      }
      return { snapshotRef: await snapshot(live) };
    },
    async importItem() { throw new Error("Retention must not import mailbox work."); },
    async runAssistantPhase() { throw new Error("Retention must not enter the assistant."); },
    ...options,
  });
  return { root, live, media, mealMedia, generatedPaths, checkpoints, snapshotTimes, invoke, get workspace() { return workspace; } };
}

async function completeInvocation(
  fixture: Awaited<ReturnType<typeof createRetentionFixture>>,
  options: Partial<HostedWorkspaceRuntimeJobOptions> = {},
) {
  let settled = false;
  const running = fixture.invoke(options);
  void running.then(() => { settled = true; }, () => { settled = true; });
  await withRealTimeout((async () => {
    while (!settled) {
      await realDelay(5);
      if (vi.getTimerCount() > 0) {
        for (const item of fixture.media.filter((item) => item.expiresAt > Date.now())) {
          expect((await stat(path.join(fixture.live, item.storedPath))).isFile()).toBe(true);
        }
        await vi.advanceTimersToNextTimerAsync();
      }
    }
  })(), 15_000, () => "Retention invocation did not settle.");
  return await running;
}

// Follow the real entrypoint's published wakes, like the scheduler, while
// advancing only its timers. All retention, bytes and snapshots remain real.
async function drainRetention(fixture: Awaited<ReturnType<typeof createRetentionFixture>>) {
  let invocations = 0;
  for (; invocations < 10;) {
    invocations += 1;
    const result = await completeInvocation(fixture);
    assert.ok(result.nextWakeAt);
    const next = Date.parse(result.nextWakeAt);
    if (next >= START + WINDOW) break;
    vi.setSystemTime(next);
  }
  for (const item of fixture.media) {
    if (item.expiresAt <= Date.now()) {
      await expect(stat(path.join(fixture.live, item.storedPath))).rejects.toMatchObject({ code: "ENOENT" });
    } else {
      expect((await stat(path.join(fixture.live, item.storedPath))).isFile()).toBe(true);
    }
  }
  return invocations;
}

test("coalesces six exact expiries into one retention invocation and snapshot without early deletion", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(START);
  const fixture = await createRetentionFixture([
    ...Array.from({ length: 6 }, (_, index) => ({ offset: index * 20_000, count: 1 })),
    { offset: 60 * 60 * 1000, count: 1 },
  ]);
  try {
    expect(await drainRetention(fixture)).toBe(1);
    expect(fixture.snapshotTimes).toEqual([START + 100_000]);
    expect(fixture.checkpoints).toHaveLength(1);
    expect(fixture.checkpoints[0]?.inboxMediaRetentionWakeAt).toBe(new Date(START + 60 * 60 * 1000).toISOString());
    expect(fixture.checkpoints[0]?.nextWakeReason).toBe("assistant");
  } finally {
    vi.useRealTimers();
    await removeTempRoot(fixture.root);
  }
});

test("drains more than two media transaction batches before one retention checkpoint", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(START);
  const fixture = await createRetentionFixture([60, 60, 60, 25].map((count) => ({ offset: 0, count })));
  try {
    expect(await drainRetention(fixture)).toBe(1);
    expect(fixture.checkpoints).toHaveLength(1);
    expect(fixture.checkpoints[0]?.inboxMediaRetentionWakeAt).toBeNull();
  } finally {
    vi.useRealTimers();
    await removeTempRoot(fixture.root);
  }
});

test("keeps the invocation window fixed and preserves the first expiry beyond it", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(START);
  const fixture = await createRetentionFixture([0, 4, 8, 11].map((minute) => ({ offset: minute * 60_000, count: 1 })));
  try {
    expect(await drainRetention(fixture)).toBe(1);
    expect(fixture.snapshotTimes).toEqual([START + 8 * 60_000]);
    expect(fixture.checkpoints[0]?.inboxMediaRetentionWakeAt).toBe(new Date(START + 11 * 60_000).toISOString());
  } finally {
    vi.useRealTimers();
    await removeTempRoot(fixture.root);
  }
});

test("returns before an independent assistant wake instead of waiting for later retention", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(START);
  const fixture = await createRetentionFixture([0, 20, 40].map((second) => ({ offset: second * 1_000, count: 1 })), { defaultWakeOffset: 30_000 });
  try {
    const result = await completeInvocation(fixture);
    expect(fixture.snapshotTimes).toEqual([START + 20_000]);
    expect(result.nextWakeReason).toBe("assistant");
    expect(result.nextWakeAt).toBe(new Date(START + 30_000).toISOString());
    expect(fixture.checkpoints[0]?.inboxMediaRetentionWakeAt).toBe(new Date(START + 40_000).toISOString());
  } finally {
    vi.useRealTimers();
    await removeTempRoot(fixture.root);
  }
});

test.each(["foreground", "shutdown", "abort"] as const)("interrupts a retention wait for %s", async (interruption) => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(START);
  const fixture = await createRetentionFixture([{ offset: 0, count: 1 }, { offset: 20_000, count: 1 }]);
  const wake = createCoalescingRuntimeWakeSignal();
  const shutdown = new AbortController();
  const abort = new AbortController();
  const reason = new Error("Synthetic retention interruption.");
  const running = fixture.invoke({ runtimeWakeSignal: wake, shutdownSignal: shutdown.signal, signal: abort.signal });
  // Attach rejection handling before triggering either interruption.
  void running.catch(() => undefined);
  try {
    await waitForFakeTimerScheduled(() => "Retention did not wait for the next expiry.");
    expect(fixture.checkpoints).toHaveLength(0);
    if (interruption === "foreground") wake.notify({ requestedProcessingMode: "default" });
    else if (interruption === "shutdown") shutdown.abort(reason);
    else abort.abort(reason);
    if (interruption === "shutdown") {
      const result = await running;
      expect(result.nextWakeAt).toBe(new Date(START + 20_000).toISOString());
      expect(fixture.checkpoints).toHaveLength(1);
    } else {
      await expect(running).rejects.toBeInstanceOf(
        interruption === "foreground" ? HostedRuntimeCheckpointInterruptedByWakeError : Error,
      );
      expect(fixture.checkpoints).toHaveLength(0);
    }
    expect((await stat(path.join(fixture.live, fixture.media[1]!.storedPath))).isFile()).toBe(true);
  } finally {
    abort.abort(reason);
    await running.catch(() => undefined);
    vi.useRealTimers();
    await removeTempRoot(fixture.root);
  }
});

test("persists the failure retry and deletes the overdue bytes on the retry", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(START);
  const fixture = await createRetentionFixture([{ offset: 0, count: 1 }]);
  const retention = vi.spyOn(inboxRetention, "runInboxMediaRetention")
    .mockRejectedValueOnce(new Error("Synthetic retention I/O failure."));
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const failed = await completeInvocation(fixture);
    expect(retention).toHaveBeenCalledTimes(1);
    expect(failed.nextWakeAt).toBe(new Date(START + 60 * 60 * 1000).toISOString());
    expect((await stat(path.join(fixture.live, fixture.media[0]!.storedPath))).isFile()).toBe(true);
    vi.setSystemTime(Date.parse(failed.nextWakeAt!));
    await completeInvocation(fixture);
    expect(fixture.checkpoints.at(-1)?.inboxMediaRetentionWakeAt).toBeNull();
    await expect(stat(path.join(fixture.live, fixture.media[0]!.storedPath))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    retention.mockRestore();
    warn.mockRestore();
    vi.useRealTimers();
    await removeTempRoot(fixture.root);
  }
});

test("replays deletion from the committed snapshot when snapshot publication fails", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(START);
  const fixture = await createRetentionFixture([{ offset: 0, count: 1 }, { offset: 20_000, count: 1 }]);
  try {
    await expect(completeInvocation(fixture, {
      async createCheckpointSnapshot() { throw new Error("Synthetic snapshot failure."); },
    })).rejects.toThrow("Synthetic snapshot failure.");
    expect(fixture.checkpoints).toHaveLength(0);
    await completeInvocation(fixture);
    expect(fixture.checkpoints).toHaveLength(1);
    expect(fixture.checkpoints[0]?.inboxMediaRetentionWakeAt).toBeNull();
    for (const item of fixture.media) {
      await expect(stat(path.join(fixture.live, item.storedPath))).rejects.toMatchObject({ code: "ENOENT" });
    }
  } finally {
    vi.useRealTimers();
    await removeTempRoot(fixture.root);
  }
});

test("checkpoints at canonical receipt capacity and resumes remaining generated-image cleanup", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(START);
  const fixture = await createRetentionFixture([], {
    generatedImages: 2, receiptCount: HOSTED_CANONICAL_WRITE_RECEIPT_LOG_BACKGROUND_YIELD_THRESHOLD - 1,
  });
  try {
    const first = await completeInvocation(fixture);
    expect(first.nextWakeAt).toBe(new Date(START).toISOString());
    expect(fixture.snapshotTimes).toHaveLength(1);
    const remaining = await Promise.all(fixture.generatedPaths.map((storedPath) =>
      readFile(path.join(fixture.live, storedPath), "utf8").then((text) => text.startsWith("synthetic-generated-image-")),
    ));
    expect(remaining.filter(Boolean)).toHaveLength(1);
    await completeInvocation(fixture);
    expect(fixture.snapshotTimes).toHaveLength(2);
    expect(fixture.checkpoints.at(-1)?.inboxMediaRetentionWakeAt).toBeNull();
    for (const storedPath of fixture.generatedPaths) {
      expect(await readFile(path.join(fixture.live, storedPath), "utf8")).toContain("murph.generated-image-retention-tombstone.v1");
    }
  } finally {
    vi.useRealTimers();
    await removeTempRoot(fixture.root);
  }
});


test.each([false, true])("pending-only delivery persists retry and yields at an assistant deadline (earlierExpiry=%s)", async earlierExpiry => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] }); vi.setSystemTime(START);
  const fixture = await createRetentionFixture(earlierExpiry ? [{ offset: 1000, count: 1 }] : [], { pendingMeal: true, defaultWakeOffset: 250 });
  let reached: () => void = () => {};
  const entered = new Promise<void>(resolve => { reached = resolve; });
  fixture.mealMedia.hooks.before = async operation => {
    if (operation !== "record") return;
    expect(fixture.checkpoints.some(checkpoint => checkpoint.reason === "canonical_runtime_commit"
      && checkpoint.inboxMediaRetentionWakeAt !== null)).toBe(true);
    reached(); await new Promise(() => {});
  };
  const running = fixture.invoke(); void running.catch(() => {});
  try {
    await withRealTimeout(entered, 10_000, () => "Delivery never reached its registered retry boundary.");
    await vi.advanceTimersByTimeAsync(250);
    const result = await withRealTimeout(running, 10_000, () => "Assistant deadline did not preempt delivery.");
    expect(result.nextWakeAt).toBe(new Date(START + 250).toISOString());
    expect(result.nextWakeReason).toBe("assistant");
    expect(Date.now()).toBe(START + 250);
    expect(fixture.mealMedia.calls.map(call => call.operation)).toEqual(["record"]);
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot: fixture.live })).entries[0]?.pendingUpload).toBe(true);
    expect(fixture.checkpoints.at(-1)?.inboxMediaRetentionWakeAt).toBe(new Date(START + (earlierExpiry ? 1000 : 250 + 60 * 60_000)).toISOString());
  } finally { vi.useRealTimers(); await removeTempRoot(fixture.root); }
});

test("delivers a pending thumbnail while the serviced retention wake is already due", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] }); vi.setSystemTime(START + 8_000);
  const fixture = await createRetentionFixture([], { pendingMeal: true, retentionDue: true });
  try {
    // Frozen timers: real I/O must not run into the delivery deadline.
    await withRealTimeout(fixture.invoke(), 10_000, () => "Retention pass did not settle.");
    expect(fixture.mealMedia.calls.map(call => call.operation)).toEqual(["record", "put"]);
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot: fixture.live })).entries[0]?.pendingUpload).toBe(false);
    // No hourly delivery retry remains; only the full photo's own expiry.
    expect(Date.parse(fixture.checkpoints.at(-1)!.inboxMediaRetentionWakeAt!)).toBeGreaterThan(START + 8_000 + 60 * 60_000);
  } finally { vi.useRealTimers(); await removeTempRoot(fixture.root); }
});

test("foreground wake releases pending delivery without joining its never-settling transport", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] }); vi.setSystemTime(START);
  const fixture = await createRetentionFixture([], { pendingMeal: true });
  const wake = createCoalescingRuntimeWakeSignal();
  let reached: () => void = () => {}; const entered = new Promise<void>(resolve => { reached = resolve; });
  fixture.mealMedia.hooks.before = async operation => {
    if (operation === "record") { reached(); await new Promise(() => {}); }
  };
  const running = fixture.invoke({ runtimeWakeSignal: wake }); void running.catch(() => {});
  try {
    await withRealTimeout(entered, 10_000, () => "Delivery did not start.");
    wake.notify({ requestedProcessingMode: "default" });
    await expect(withRealTimeout(running, 10_000, () => "Foreground admission joined delivery.")).rejects.toBeInstanceOf(HostedRuntimeCheckpointInterruptedByWakeError);
    expect(fixture.mealMedia.calls.map(call => call.operation)).toEqual(["record"]);
    expect(fixture.snapshotTimes).toEqual([]);
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot: fixture.live })).entries[0]?.pendingUpload).toBe(true);
  } finally { vi.useRealTimers(); await removeTempRoot(fixture.root); }
});


test("paused retention invocations settle a photo despite an overdue default wake across cold restores", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(START - 8 * 24 * 60 * 60_000);
  const fixture = await createRetentionFixture([], { pendingMeasurement: true, defaultWakeOffset: -60_000 });
  const invoke = () => withRealTimeout(fixture.invoke(), 10_000, () => "Paused retention did not settle.");
  try {
    vi.setSystemTime(START);
    fixture.mealMedia.hooks.before = async () => { throw mediaFailure("Synthetic temporary outage"); };
    for (const failing of [true, false]) {
      const wake = fixture.workspace.inboxMediaRetentionWakeAt;
      expect(wake).not.toBeNull();
      vi.setSystemTime(new Date(wake!));
      await rm(fixture.live, { recursive: true, force: true });
      if (!failing) fixture.mealMedia.hooks.before = undefined;
      await invoke();
      expect(fixture.workspace.nextDefaultProcessingWakeAt).toBe(new Date(START - 60_000).toISOString());
      expect((await readHostedMediaReferenceCatalogue({ vaultRoot: fixture.live })).entries[0])
        .toMatchObject({ uploadAttempts: failing ? 1 : 2, pendingUpload: failing });
    }
    expect(fixture.workspace.inboxMediaRetentionWakeAt).toBeNull();
    expect([...fixture.mealMedia.bytes.values()].map(bytes => Buffer.from(bytes).toString())).toEqual(["synthetic measurement photo"]);
  } finally { vi.useRealTimers(); await removeTempRoot(fixture.root); }
});
