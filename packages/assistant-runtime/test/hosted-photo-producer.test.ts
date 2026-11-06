import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { addBodyMeasurement, addMeasurement, addMeal, buildBodyMeasurementEventDraft, deleteEvent, initializeVault, runMealPhotoMaintenance } from "@murphai/core";
import { publishHostedWorkspaceMediaReferences, publishHostedWorkspaceMediaReferencesForSnapshot, readHostedMediaReferenceCatalogue, writeHostedMediaReferenceCatalogue, releaseHostedPhotoIntents } from "../src/hosted-runtime/media-references.ts";
import { HOSTED_MEDIA_REFS_SCHEMA } from "@murphai/runtime-state/node";
import { createHostedMealMediaBudget, runHostedMealMediaMaintenance } from "../src/hosted-runtime/meal-media-maintenance.ts";
import { createMealMediaStore, mediaFailure } from "./hosted-meal-media.harness.ts";

const roots: string[] = [];
const captured = "2030-01-01T12:00:00.000Z";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64");
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(kind: "meal" | "measurement" | "body_measurement" = "measurement", count = 1, extension = "png") {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(captured));
  const root = await mkdtemp(path.join(tmpdir(), "photo-producer-")); roots.push(root);
  let vaultRoot = path.join(root, "live");
  await initializeVault({ vaultRoot, timezone: "UTC" });
  const sourcePath = path.join(root, `synthetic.${extension}`); await writeFile(sourcePath, png);
  const ids: string[] = [], paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const attachments = [{ role: "media_1", sourcePath }];
    const created = kind === "meal" ? await addMeal({ vaultRoot, photoPath: sourcePath, photoCapturedAt: captured })
      : kind === "body_measurement" ? await addBodyMeasurement({ vaultRoot, attachments,
        draft: buildBodyMeasurementEventDraft({ title: "Synthetic body measurement", occurredAt: new Date(captured), measurements: [{ type: "weight", value: 70, unit: "kg" }] }) })
        : await addMeasurement({ vaultRoot, attachments, draft: { title: "Synthetic measurement", occurredAt: "2030-01-01T12:00:00.000Z", measurements: [{ metric: "weight", value: 70, unit: "kg" }] } });
    ids.push(created.event.id); paths.push(created.event.attachments![0]!.relativePath);
  }
  const store = createMealMediaStore();
  const publish = () => publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore: store.mediaStore });
  const accept = async () => { const result = await publish(); releaseHostedPhotoIntents(vaultRoot, result.pendingPhotoMediaIds); return result; };
  let sequence = 0;
  const cold = async () => { const next = path.join(root, `cold-${++sequence}`); await cp(vaultRoot, next, { recursive: true }); vaultRoot = next; };
  const pass = (options: Partial<Parameters<typeof runHostedMealMediaMaintenance>[0]> = {}) => runHostedMealMediaMaintenance({
    vaultRoot, mediaStore: store.mediaStore, budget: createHostedMealMediaBudget(), signal: new AbortController().signal,
    persistRetry: async () => {}, ...options,
  });
  return { get vaultRoot() { return vaultRoot; }, ids, paths, store, publish, accept, cold, pass,
    catalogue: () => readHostedMediaReferenceCatalogue({ vaultRoot }) };
}

test.each(["meal", "measurement", "body_measurement"] as const)("%s admission requires seven days, live ownership and verified bytes; foreground never discovers full photos", async kind => {
  const f = await fixture(kind, 3);
  if (kind === "meal") {
    vi.setSystemTime(new Date("2030-01-08T12:00:00.000Z"));
    expect((await f.publish()).referenceCount).toBe(0); // No thumbnail yet.
    vi.setSystemTime(new Date(captured));
    await runMealPhotoMaintenance({ vaultRoot: f.vaultRoot });
    await f.accept(); await f.pass(); // Existing thumbnails have their own delivery policy.
  }
  await deleteEvent({ vaultRoot: f.vaultRoot, eventId: f.ids[1]! });
  await writeFile(path.join(f.vaultRoot, f.paths[2]!), "changed local bytes");
  vi.setSystemTime(new Date("2030-01-08T11:59:59.999Z"));
  await f.publish();
  expect((await f.catalogue()).entries.filter(entry => f.paths.includes(entry.relativePath))).toEqual([]);
  vi.setSystemTime(new Date("2030-01-08T12:00:00.000Z"));
  await publishHostedWorkspaceMediaReferences({ vaultRoot: f.vaultRoot, mediaStore: f.store.mediaStore });
  expect((await f.catalogue()).entries.filter(entry => f.paths.includes(entry.relativePath))).toEqual([]);
  const first = await f.publish();
  const full = (await f.catalogue()).entries.filter(entry => f.paths.includes(entry.relativePath));
  expect(full).toHaveLength(1);
  expect(full[0]).toMatchObject({ relativePath: f.paths[0], pendingUpload: true,
    expiresAt: kind === "meal" ? "2030-04-01T12:00:00.000Z" : null });
  expect(first.excludedVaultPaths).not.toContain(f.paths[0]);
  const puts = f.store.calls.filter(call => call.operation === "put").length;
  await f.pass(); expect(f.store.calls.filter(call => call.operation === "put")).toHaveLength(puts);
  await f.accept(); expect(await f.pass()).toMatchObject({ uploaded: 1 });
  expect((await f.publish()).excludedVaultPaths).toContain(f.paths[0]);
  expect(f.store.rows.get(full[0]!.mediaId)?.expiresAt).toBe(full[0]!.expiresAt);
});

test.each(["retry", "cold_retry", "delete", "cold_delete"])("lost PUT response preserves full-photo recovery intent: %s", async next => {
  const f = await fixture("meal");
  await runMealPhotoMaintenance({ vaultRoot: f.vaultRoot }); await f.accept(); await f.pass();
  vi.setSystemTime(new Date("2030-01-09T12:00:00.000Z"));
  await f.accept();
  const entry = (await f.catalogue()).entries.find(value => value.relativePath === f.paths[0])!;
  let lose = true;
  f.store.hooks.after = async (operation, id) => { if (operation === "put" && id === entry.mediaId && lose) { lose = false; throw mediaFailure("Synthetic lost acknowledgement"); } };
  expect(await f.pass()).toMatchObject({ failed: 1, pending: 1 });
  expect(f.store.bytes.has(entry.mediaId)).toBe(true);
  if (next.startsWith("cold")) await f.cold();
  if (next.endsWith("retry")) expect(await f.pass()).toMatchObject({ uploaded: 1 });
  await deleteEvent({ vaultRoot: f.vaultRoot, eventId: f.ids[0]! });
  const tombstone = await readFile(path.join(f.vaultRoot, f.paths[0]!));
  expect((await f.publish()).excludedVaultPaths).not.toContain(f.paths[0]);
  await f.pass(); await f.publish();
  expect(await readFile(path.join(f.vaultRoot, f.paths[0]!))).toEqual(tombstone);
  expect(f.store.bytes.size).toBe(0); expect((await f.catalogue()).entries).toEqual([]);
});

test("five immediate failures consume attempts, persist cursor and leave pending bytes inline", async () => {
  const f = await fixture("measurement", 7);
  vi.setSystemTime(new Date("2030-01-09T12:00:00.000Z")); await f.accept();
  f.store.hooks.before = async operation => { if (operation === "put") throw mediaFailure(); };
  const budget = { ...createHostedMealMediaBudget(), remaining: 5 };
  expect(await f.pass({ budget })).toMatchObject({ failed: 5, pending: 7 });
  expect(budget.remaining).toBe(0);
  expect((await f.publish()).excludedVaultPaths).toEqual([]);
  const attempted = new Set(f.store.calls.filter(call => call.operation === "put").map(call => call.mediaId));
  expect(attempted.size).toBe(5);
  await f.accept(); await f.cold(); f.store.hooks.before = undefined;
  expect(await f.pass({ budget: { ...createHostedMealMediaBudget(), remaining: 2 } })).toMatchObject({ uploaded: 2, pending: 5 });
  expect(f.store.calls.filter(call => call.operation === "put").slice(-2).every(call => !attempted.has(call.mediaId))).toBe(true);
  const settled = (await f.catalogue()).entries.filter(entry => !entry.pendingUpload);
  for (const entry of settled) await rm(path.join(f.vaultRoot, entry.relativePath));
  expect(await f.pass({ budget: { ...createHostedMealMediaBudget(), remaining: 0 } })).toMatchObject({ uploaded: 0, pending: 5 });
  expect((await f.publish()).excludedVaultPaths.sort()).toEqual(settled.map(entry => entry.relativePath).sort());
  expect((await f.catalogue()).entries).toHaveLength(7);
});

test.each(["record", "put"])("full-photo cancellation after %s preserves committed intent", async boundary => {
  const f = await fixture(); vi.setSystemTime(new Date("2030-01-09T12:00:00.000Z")); await f.accept();
  const controller = new AbortController();
  f.store.hooks.after = async operation => { if (operation === boundary) controller.abort(new Error("Synthetic owner interruption")); };
  await expect(f.pass({ signal: controller.signal })).rejects.toThrow("Synthetic owner interruption");
  expect(f.store.calls.map(call => call.operation)).toEqual(boundary === "record" ? ["record"] : ["record", "put"]);
  expect((await f.catalogue()).entries[0]?.pendingUpload).toBe(true);
  await f.cold(); f.store.hooks.after = undefined;
  expect(await f.pass()).toMatchObject({ uploaded: 1 });
});

test("a stalled full-photo head yields at deadline and the committed cursor advances", async () => {
  const f = await fixture("measurement", 2); vi.setSystemTime(new Date("2030-01-09T12:00:00.000Z")); await f.accept();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  let started!: () => void; const reached = new Promise<void>(resolve => { started = resolve; });
  f.store.hooks.before = async operation => { if (operation === "record") { started(); await new Promise(() => {}); } };
  const running = f.pass(); await reached; await vi.advanceTimersByTimeAsync(2_000);
  expect(await running).toMatchObject({ pending: 2 });
  const first = f.store.calls[0]!.mediaId;
  await f.accept(); await f.cold(); f.store.hooks.before = undefined;
  expect(await f.pass({ budget: { ...createHostedMealMediaBudget(), remaining: 1 } })).toMatchObject({ uploaded: 1 });
  expect(f.store.calls.find(call => call.operation === "put")?.mediaId).not.toBe(first);
});


test("photo admission uses canonical image MIME rather than a second extension allowlist", async () => {
  const f = await fixture("measurement", 1, "gif");
  vi.setSystemTime(new Date("2030-01-09T12:00:00.000Z"));
  await f.accept(); expect(await f.pass()).toMatchObject({ uploaded: 1 });
  expect((await f.catalogue()).entries[0]?.mimeType).toBe("image/gif");
});

test("expired meals never create full-photo intents; measurement deletion preserves committed evidence", async () => {
  const meal = await fixture("meal");
  await runMealPhotoMaintenance({ vaultRoot: meal.vaultRoot }); await meal.accept(); await meal.pass();
  vi.setSystemTime(new Date("2030-04-01T12:00:00.000Z")); await meal.publish();
  expect((await meal.catalogue()).entries.some(entry => entry.relativePath === meal.paths[0])).toBe(false);
  const measurement = await fixture(); vi.setSystemTime(new Date("2030-01-09T12:00:00.000Z")); await measurement.accept();
  await deleteEvent({ vaultRoot: measurement.vaultRoot, eventId: measurement.ids[0]! });
  expect(await measurement.pass()).toMatchObject({ uploaded: 1, retired: 0 });
  expect((await measurement.publish()).excludedVaultPaths).toContain(measurement.paths[0]);
});

test("a photo leaves the archive only with explicit proof of delivery", async () => {
  const seeded = await fixture("meal");
  const relativePath = seeded.paths[0]!;
  const bytes = await readFile(path.join(seeded.vaultRoot, relativePath));
  const entry = { relativePath, mediaId: "e".repeat(64), mediaKind: "image" as const, mimeType: "image/png", byteSize: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), recordedAt: captured, expiresAt: null };
  const excluded = async (extra: { pendingUpload?: boolean }) => {
    await writeHostedMediaReferenceCatalogue({ vaultRoot: seeded.vaultRoot,
      catalogue: { schema: HOSTED_MEDIA_REFS_SCHEMA, entries: [{ ...entry, ...extra }] } });
    return (await seeded.publish()).excludedVaultPaths;
  };
  // Absent is the legacy "do not bulk upload" meaning, never proof the store has it.
  expect(await excluded({})).not.toContain(relativePath);
  expect(await excluded({ pendingUpload: true })).not.toContain(relativePath);
  expect(await excluded({ pendingUpload: false })).toContain(relativePath);
});
