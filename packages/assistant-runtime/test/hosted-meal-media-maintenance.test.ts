import { mkdtemp, writeFile, rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import * as core from "@murphai/core";
import { initializeVault, addMeal, runMealPhotoMaintenance, withHostedCanonicalWritePort, deleteEvent, readEvent, type HostedCanonicalWritePersistenceInput } from "@murphai/core";
import { snapshotHostedBundleRoots, sha256HostedBundleHex } from "@murphai/runtime-state/node";
import { createHostedRuntimeArtifactStoreStub } from "./hosted-runtime-test-helpers.ts";
import { createPlatform, createSnapshotFixtureRef, createWorkspaceState } from "./hosted-runtime-workspace-entrypoint.harness.ts";
import { externalizeHostedCanonicalWriteMediaPayloads } from "../src/hosted-runtime/canonical-write-media.ts";
import { appendHostedCanonicalWriteReceiptToArtifactLog, hostedCanonicalWriteReceiptLogStatusFields } from "../src/hosted-runtime/canonical-write-receipt-log.ts";
import { restoreHostedWorkspaceRuntimeJobWorkspace } from "../src/hosted-runtime/workspace-restore.ts";
import { publishHostedWorkspaceMediaReferencesForSnapshot, readHostedMediaReferenceCatalogue, writeHostedMediaReferenceCatalogue, HOSTED_MEDIA_REFS_RELATIVE_PATH, releaseHostedPhotoIntents } from "../src/hosted-runtime/media-references.ts";
import { runHostedMealMediaMaintenance, createHostedMealMediaBudget } from "../src/hosted-runtime/meal-media-maintenance.ts";
import { createMealMediaStore, mediaFailure, type MediaOperation } from "./hosted-meal-media.harness.ts";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const CAPTURED = "2030-01-01T12:00:00.000Z";
const EXPIRED = new Date("2030-04-01T12:00:00.000Z");
async function fixture(count = 1) {
  const root = await mkdtemp(path.join(tmpdir(), "meal-media-idle-")); roots.push(root);
  let vaultRoot = path.join(root, "live");
  await initializeVault({ vaultRoot, timezone: "UTC" });
  const photoPath = path.join(root, "fixture.png");
  await writeFile(photoPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64"));
  const meals: Array<Awaited<ReturnType<typeof addMeal>>> = [];
  for (let i = 0; i < count; i++) meals.push(await addMeal({ vaultRoot, photoPath, occurredAt: CAPTURED, photoCapturedAt: CAPTURED }));
  const store = createMealMediaStore();
  const { artifactStore, storedBytesByHash } = createHostedRuntimeArtifactStoreStub();
  let status = {};
  const persisted: HostedCanonicalWritePersistenceInput[] = [];
  const hooks: { receipt?: (input: HostedCanonicalWritePersistenceInput) => Promise<void>; published?: () => Promise<void> } = {};
  const port = { async persistCanonicalWrite(input: HostedCanonicalWritePersistenceInput) {
    const externalized = await externalizeHostedCanonicalWriteMediaPayloads({ persistence: input, mediaStore: store.mediaStore, vaultRoot });
    persisted.push(externalized);
    await hooks.receipt?.(externalized);
    status = hostedCanonicalWriteReceiptLogStatusFields(await appendHostedCanonicalWriteReceiptToArtifactLog({ ...externalized, artifactStore, previousStatus: status }));
    await hooks.published?.();
  } };
  const snapshot = async () => {
    const publication = await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore: store.mediaStore });
    const bytes = (await snapshotHostedBundleRoots({ kind: "vault", roots: [{ root: vaultRoot, rootKey: "vault" }] }))!;
    const hash = sha256HostedBundleHex(bytes); await artifactStore.put({ bytes, sha256: hash });
    releaseHostedPhotoIntents(vaultRoot, [...publication.pendingPhotoMediaIds, ...publication.retirementPendingMediaIds]);
    return createSnapshotFixtureRef({ hash, size: bytes.byteLength });
  };
  const baseline = await snapshot();
  let restores = 0;
  const restore = async (snapshotRef = baseline, receipts = status) => {
    vaultRoot = path.join(root, `restored-${++restores}`);
    await restoreHostedWorkspaceRuntimeJobWorkspace({ vaultRoot,
      platform: { ...createPlatform({ artifactBytesByHash: storedBytesByHash, mailboxPort: null, workspacePort: null }), artifactStore, mediaStore: store.mediaStore },
      workspace: createWorkspaceState({ snapshotRef, redactedStatus: receipts }),
    });
  };
  const pass = (options: Partial<Parameters<typeof runHostedMealMediaMaintenance>[0]> = {}) => runHostedMealMediaMaintenance({
    vaultRoot, mediaStore: store.mediaStore, budget: createHostedMealMediaBudget(), signal: new AbortController().signal,
    persistRetry: async () => {}, ...options,
  });
  return { get vaultRoot() { return vaultRoot; }, store, hooks, meals, persisted, artifactStore, snapshot, restore, pass,
    maintain: (now = EXPIRED) => withHostedCanonicalWritePort(port, () => runMealPhotoMaintenance({ vaultRoot, now, maxMeals: count })),
    remove: () => withHostedCanonicalWritePort(port, async () => { for (const meal of meals) await deleteEvent({ vaultRoot, eventId: meal.event.id }); }),
    catalogue: () => readHostedMediaReferenceCatalogue({ vaultRoot }),
  };
}
async function assertGone(f: Awaited<ReturnType<typeof fixture>>) {
  await f.pass(); await f.snapshot(); await f.snapshot();
  expect(f.store.bytes.size).toBe(0); expect(f.store.activeUnlimited()).toBe(0);
  expect((await f.catalogue()).entries).toHaveLength(0);
}

test.each([false, true])("published pending deletion before registration converges (cold=%s)", async cold => {
  const f = await fixture(); await f.maintain();
  expect(f.store.calls).toEqual([]);
  if (cold) await f.restore();
  await f.remove(); await assertGone(f);
  expect(f.store.calls.map(call => call.operation)).toEqual(["record", "delete"]);
  expect(f.store.calls[0]?.expiresAt).toBe(new Date(0).toISOString());
});

test.each([false, true])("failed receipt publication rolls back without obstructing snapshots (stored=%s)", async stored => {
  const f = await fixture();
  f.hooks.receipt = async input => {
    if (stored) await appendHostedCanonicalWriteReceiptToArtifactLog({ ...input, artifactStore: f.artifactStore, previousStatus: {} });
    throw new Error("Synthetic lost receipt response");
  };
  await expect(f.maintain()).rejects.toThrow("Synthetic lost receipt response");
  expect(f.store.calls).toEqual([]);
  await f.snapshot(); // Obsolete unknown pointer is retained, not DELETE 409.
  expect((await f.catalogue()).entries).toHaveLength(1);
  await assertGone(f);
});

test.each(["retry", "delete_first", "cold_retry", "cold_delete_first"])("lost registered PUT response remains deletable: %s", async next => {
  const f = await fixture(); await f.maintain();
  let lose = true;
  f.store.hooks.after = async op => { if (op === "put" && lose) { lose = false; throw mediaFailure("Synthetic lost PUT response"); } };
  expect(await f.pass()).toMatchObject({ failed: 1, pending: 1 });
  const id = (await f.catalogue()).entries[0]!.mediaId;
  expect(f.store.bytes.size).toBe(1);
  if (next.startsWith("cold")) await f.restore(); // crash after PUT, before full snapshot
  if (next.endsWith("retry")) expect(await f.pass()).toMatchObject({ uploaded: 1, pending: 0 });
  await f.remove(); await assertGone(f);
  expect(new Set(f.store.calls.filter(call => call.operation === "put").map(call => call.mediaId))).toEqual(new Set([id]));
});

test("receipt-only cold recovery waits for idle and survives the provisional grace window", async () => {
  const f = await fixture(); await f.maintain();
  await f.restore(); expect(f.store.calls).toEqual([]);
  let partial = true;
  f.store.hooks.before = async op => { if (op === "put" && partial) { partial = false; throw mediaFailure("Partial PUT"); } };
  expect(await f.pass()).toMatchObject({ failed: 1 });
  f.store.sweep(Date.now() + 2 * 60 * 60_000);
  expect(await f.pass()).toMatchObject({ uploaded: 1 });
  await f.remove(); await assertGone(f);
});

test.each(["record_reply", "retire_reply", "already_terminal", "crash_and_sweep"])("obsolete pending cleanup converges after %s", async failure => {
  const f = await fixture(); await f.maintain(); await f.remove();
  const entry = (await f.catalogue()).entries[0]!;
  if (failure === "already_terminal") { await f.store.mediaStore.record!(entry); await f.store.mediaStore.delete!({ mediaId: entry.mediaId }); }
  let once = true;
  const cancel = new AbortController();
  f.store.hooks.after = async op => {
    if (!once) return;
    if (failure === "record_reply" && op === "record" || failure === "retire_reply" && op === "delete") { once = false; throw mediaFailure("Lost reply"); }
    if (failure === "crash_and_sweep" && op === "record") { once = false; cancel.abort(); }
  };
  await f.pass({ signal: cancel.signal }).catch(() => undefined);
  if (failure === "retire_reply" || failure === "crash_and_sweep") expect((await f.catalogue()).entries).toHaveLength(1);
  f.store.sweep(Date.now() + 60_000);
  await assertGone(f);
  expect(f.store.calls.filter(call => call.operation === "put")).toHaveLength(0);
});

test.each(["before", "between", "after"])("late null registration cannot escape acknowledged retirement: %s", async when => {
  const f = await fixture(); await f.maintain(); await f.remove();
  const entry = (await f.catalogue()).entries[0]!;
  if (when === "before") await f.store.mediaStore.record!({ ...entry, expiresAt: null });
  let late = true;
  f.store.hooks.after = async op => { if (when === "between" && op === "record" && late) { late = false; await f.store.mediaStore.record!({ ...entry, expiresAt: null }); } };
  await assertGone(f);
  if (when === "after") await expect(f.store.mediaStore.record!({ ...entry, expiresAt: null })).rejects.toThrow("409");
  expect(f.store.rows.get(entry.mediaId)?.retired).toBe(true);
});

test.each(["before", "after"].flatMap(phase => ["record", "put", "delete", "retry_cas"].map(boundary => ({ phase, boundary }))))("foreground cancellation releases a never-settling $phase $boundary and starts no later effect", async ({ phase, boundary }) => {
  const f = await fixture(); await f.maintain();
  if (boundary === "delete") await f.remove();
  const cancel = new AbortController(); let release: () => void = () => {};
  const stuck = new Promise<void>(resolve => { release = resolve; });
  const block = async () => { cancel.abort(new Error("Foreground admitted")); await stuck; };
  if (phase === "before") f.store.hooks.before = async op => { if (op === boundary) await block(); };
  else f.store.hooks.after = async op => { if (op === boundary) await block(); };
  const running = f.pass({ signal: cancel.signal, ...(boundary === "retry_cas" ? { persistRetry: block } : {}) });
  await expect(running).rejects.toThrow("Foreground admitted");
  const calls = f.store.calls.length;
  expect((await f.catalogue()).entries).toHaveLength(1);
  release(); await new Promise(resolve => setImmediate(resolve));
  expect(f.store.calls).toHaveLength(calls);
});

test("owner loss after finite registration forbids retirement", async () => {
  const f = await fixture(); await f.maintain(); await f.remove();
  f.store.hooks.after = async op => { if (op === "record") throw Object.assign(new Error("Owner lost"), { code: "HOSTED_RUNTIME_STALE_INVOCATION_AUTHORITY" }); };
  await expect(f.pass()).rejects.toThrow("Owner lost");
  expect(f.store.calls.map(call => call.operation)).toEqual(["record"]);
});

test("read doubt keeps bounded discovery from trusting a partial holder inventory", async () => {
  const f = await fixture(); await f.maintain();
  const cancel = new AbortController();
  const shard = path.join(f.vaultRoot, "ledger/events/2030/2030-12.jsonl");
  await mkdir(path.dirname(shard), { recursive: true });
  await writeFile(shard, Array.from({ length: 20_000 }, (_, i) => JSON.stringify({ kind: "synthetic-unrelated", id: i })).join("\n") + "\n");
  await f.remove();
  let deletedLine: string | undefined;
  // Keep an early live revision and move its actual deletion to a later shard.
  for (const relativePath of await core.listEventLedgerShardPaths(f.vaultRoot)) {
    const file = path.join(f.vaultRoot, relativePath);
    const rows = (await readFile(file, "utf8")).trim().split("\n").filter(line => {
      const row = JSON.parse(line);
      if (row.id === f.meals[0]!.event.id && row.lifecycle?.state === "deleted") { deletedLine = line; return false; }
      return true;
    });
    await writeFile(file, rows.join("\n") + "\n");
  }
  const later = path.join(f.vaultRoot, "ledger/events/2031/2031-01.jsonl");
  if (!deletedLine) throw new Error("Expected a canonical deletion revision.");
  await mkdir(path.dirname(later), { recursive: true }); await writeFile(later, deletedLine + "\n");
  vi.spyOn(core, "canonicalRawArtifactIsPrivacyTombstone").mockRejectedValue(new Error("Synthetic identity read doubt"));
  const visit = core.visitEventLedgerShardRecordsInterruptible;
  vi.spyOn(core, "visitEventLedgerShardRecordsInterruptible").mockImplementation(async input => visit({ ...input, visit: async (row, line) => {
    if (line === 256) setImmediate(() => cancel.abort(new Error("Foreground during discovery")));
    return input.visit(row, line);
  } }));
  await expect(f.pass({ signal: cancel.signal })).rejects.toThrow("Foreground during discovery");
  expect(f.store.calls).toEqual([]);
  expect((await f.catalogue()).entries[0]?.pendingUpload).toBe(true);
  vi.restoreAllMocks();
  await assertGone(f);
  expect(f.store.calls.filter(call => call.operation === "put")).toEqual([]);
});

test("receipt replay preserves checkpointed completion for an unchanged thumbnail", async () => {
  const f = await fixture(); await f.maintain(new Date(CAPTURED)); await f.pass();
  const settled = await f.snapshot();
  const puts = f.store.calls.filter(call => call.operation === "put").length;
  await f.maintain(EXPIRED); // Real expiry receipt reuses the same thumbnail.
  await f.restore(settled);
  expect((await f.catalogue()).entries[0]?.pendingUpload).toBe(false);
  expect(await f.pass()).toMatchObject({ uploaded: 0 });
  expect(f.store.calls.filter(call => call.operation === "put")).toHaveLength(puts);
  const meal = (await readEvent({ vaultRoot: f.vaultRoot, eventId: f.meals[0]!.event.id })).event;
  expect(meal.attachments).toHaveLength(1);
  await f.remove(); await assertGone(f);
});

test("one invocation attempts at most ten, shares its budget, and resumes after the cursor", async () => {
  const f = await fixture(12); await f.maintain();
  const budget = createHostedMealMediaBudget();
  expect(await f.pass({ budget })).toMatchObject({ uploaded: 10, pending: 2 });
  expect(await f.pass({ budget })).toMatchObject({ uploaded: 0, pending: 2 });
  expect(await f.pass()).toMatchObject({ uploaded: 2, pending: 0 });
  await f.remove(); await assertGone(f);
});

test("two-second budget includes preparation and a timed-out head does not starve later entries", async () => {
  const f = await fixture(2); await f.maintain();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  let reached: () => void = () => {};
  const started = new Promise<void>(resolve => { reached = resolve; });
  f.store.hooks.before = async op => { if (op === "record") { reached(); await new Promise(() => {}); } };
  const running = f.pass(); await started; await vi.advanceTimersByTimeAsync(2_000);
  expect(await running).toMatchObject({ pending: 2 });
  const first = f.store.calls[0]!.mediaId;
  await f.restore(await f.snapshot());
  f.store.hooks.before = undefined;
  const budget = { ...createHostedMealMediaBudget(), remaining: 1 };
  expect(await f.pass({ budget })).toMatchObject({ uploaded: 1 });
  expect(f.store.calls.find(call => call.operation === "put")?.mediaId).not.toBe(first);
});

// This is the field set emitted by the old catalogue parser/publisher. The v2
// filename survives even though extension fields do not.
function legacyRoundTrip(catalogue: Awaited<ReturnType<typeof readHostedMediaReferenceCatalogue>>) {
  return { schema: catalogue.schema, entries: catalogue.entries.map(({ byteSize, expiresAt, mediaId, mediaKind, mimeType, recordedAt, relativePath, sha256 }) =>
    ({ byteSize, expiresAt, mediaId, mediaKind, mimeType, recordedAt, relativePath, sha256 })) };
}

test("old/new/old/new catalogue round trips recover only v2, never legacy delivery", async () => {
  const f = await fixture(); await f.maintain(); await f.pass();
  const catalogue = await f.catalogue();
  const entry = catalogue.entries[0]!;
  const legacy = { ...entry, mediaId: "f".repeat(64), relativePath: entry.relativePath.replace(/thumbnail-v2-[^.]+/u, `thumbnail-${entry.sha256}`) };
  catalogue.entries.push(legacy);
  for (let i = 0; i < 2; i++) {
    await writeHostedMediaReferenceCatalogue({ vaultRoot: f.vaultRoot, catalogue: legacyRoundTrip(catalogue) });
    const recovered = await f.catalogue();
    expect(recovered.entries.find(value => value.mediaId === legacy.mediaId)?.pendingUpload).toBeUndefined();
    expect(recovered.entries.find(value => value.mediaId === entry.mediaId)?.pendingUpload).toBe(true);
    expect(await f.pass()).toMatchObject({ uploaded: 1 });
    expect((await f.catalogue()).entries.find(value => value.mediaId === entry.mediaId)?.pendingUpload).toBe(false);
  }
  expect(f.store.calls.filter(call => call.operation === "put" && call.mediaId === legacy.mediaId)).toEqual([]);
});

test("every selected attempt consumes the ten-attempt budget, including immediate remote failures", async () => {
  const f = await fixture(12); await f.maintain();
  f.store.hooks.before = async op => { if (op === "record") throw mediaFailure(); };
  expect(await f.pass()).toMatchObject({ failed: 10, pending: 12 });
  expect(f.store.calls).toHaveLength(10);
});


test("lost receipt publication acknowledgement restores the actually published log before delivery", async () => {
  const f = await fixture();
  f.hooks.published = async () => { throw new Error("Synthetic lost receipt CAS response"); };
  await expect(f.maintain()).rejects.toThrow("Synthetic lost receipt CAS response");
  expect(f.store.calls).toEqual([]);
  await f.restore(); f.hooks.published = undefined;
  expect((await f.catalogue()).entries[0]?.pendingUpload).toBe(true);
  expect(await f.pass()).toMatchObject({ uploaded: 1 });
  await f.remove(); await assertGone(f);
});

test("empty delivery checks do not exhaust the next selected batch's budget", async () => {
  const f = await fixture(); const budget = createHostedMealMediaBudget();
  expect(await f.pass({ budget })).toMatchObject({ pending: 0 });
  expect(budget.deadlineMs).toBeNull();
  await f.maintain(); expect(await f.pass({ budget })).toMatchObject({ uploaded: 1 });
});

test("foreground cancellation during integrity checking starts no registration", async () => {
  const f = await fixture(); await f.maintain();
  const cancel = new AbortController(); let release: () => void = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const original = core.statAndHashVaultFileInterruptible;
  vi.spyOn(core, "statAndHashVaultFileInterruptible").mockImplementation(async (...args) => {
    cancel.abort(new Error("Foreground during integrity")); await blocked; return original(...args);
  });
  await expect(f.pass({ signal: cancel.signal })).rejects.toThrow("Foreground during integrity");
  expect(f.store.calls).toEqual([]); expect((await f.catalogue()).entries[0]?.pendingUpload).toBe(true);
  release(); await new Promise(resolve => setImmediate(resolve)); expect(f.store.calls).toEqual([]);
});


test("receipt replay preserves checkpointed upload attempts for an unchanged pending thumbnail", async () => {
  const f = await fixture(); await f.maintain(new Date(CAPTURED));
  f.store.hooks.before = async op => { if (op === "put") throw mediaFailure(); };
  for (let attempt = 0; attempt < 5; attempt++) expect(await f.pass()).toMatchObject({ failed: 1, pending: 1 });
  const snapshot = await f.snapshot();
  await f.maintain(EXPIRED); // Publishes another receipt with the same thumbnail identity.
  await f.restore(snapshot);
  expect((await f.catalogue()).entries[0]).toMatchObject({ pendingUpload: true, uploadAttempts: 5 });
  expect((await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot: f.vaultRoot, mediaStore: f.store.mediaStore })).hasRetryablePendingPhotos).toBe(false);
});


test.each(["media", "unexpected", "window"] as const)("a later entry is charged and rotated only for a recorded media error: %s", async failure => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const f = await fixture(3); await f.maintain();
  const entries = (await f.catalogue()).entries.sort((a, b) => a.mediaId.localeCompare(b.mediaId));
  const error = failure === "media" ? mediaFailure() : new Error("Synthetic unexpected failure");
  f.store.hooks.before = async (op, id) => {
    if (op !== "record" || id !== entries[1]!.mediaId) return;
    if (failure === "window") vi.setSystemTime(Date.now() + 2_000);
    throw error;
  };
  const budget = createHostedMealMediaBudget();
  if (failure === "unexpected") await expect(f.pass({ budget })).rejects.toBe(error);
  else expect(await f.pass({ budget })).toMatchObject({ uploaded: failure === "media" ? 2 : 1, failed: failure === "media" ? 1 : 0 });
  const catalogue = await f.catalogue();
  expect(catalogue.mealUploadCursor).toBe(entries[failure === "media" ? 1 : 0]!.mediaId);
  expect(catalogue.entries.find(entry => entry.mediaId === entries[1]!.mediaId)?.uploadAttempts ?? 0).toBe(failure === "media" ? 1 : 0);
  expect(budget.remaining).toBe(failure === "media" ? 7 : 8);
  f.store.hooks.before = undefined;
  f.store.calls.length = 0;
  await f.pass();
  expect(f.store.calls.find(call => call.operation === "record")?.mediaId).toBe(entries[1]!.mediaId);
});

test("a later slice of the same window does not charge a new head up front", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const f = await fixture(3); await f.maintain();
  const budget = createHostedMealMediaBudget();
  f.store.hooks.before = async op => { if (op === "record" || op === "put") vi.setSystemTime(Date.now() + 400); };
  expect(await f.pass({ budget, projectedDeadlineMs: Date.now() + 1_000 })).toMatchObject({ uploaded: 1, pending: 2 });
  f.store.hooks.before = undefined;
  expect(await f.pass({ budget })).toMatchObject({ uploaded: 2, pending: 0 });
  expect((await f.catalogue()).entries.map(entry => entry.uploadAttempts ?? 0).sort()).toEqual([0, 0, 1]);
  expect(budget.remaining).toBe(6);
});
