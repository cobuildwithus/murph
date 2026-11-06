import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import {
  addBodyMeasurement, addMeasurement, addMeal, buildBodyMeasurementEventDraft,
  deleteEvent, initializeVault, readEvent, removeAutomaticMealPhoto, runMealPhotoMaintenance,
  validateVault, withHostedCanonicalWritePort, type HostedCanonicalWritePersistenceInput,
} from "@murphai/core";
import { HOSTED_MEDIA_REFS_SCHEMA, HOSTED_MEDIA_REFS_RELATIVE_PATH } from "@murphai/runtime-state/node";
import { createHostedArtifactMaterializer } from "../src/hosted-runtime/artifacts.ts";
import { applyHostedCanonicalWriteReceiptWithMedia, externalizeHostedCanonicalWriteMediaPayloads } from "../src/hosted-runtime/canonical-write-media.ts";
import { parseHostedCanonicalWriteReceiptArtifact } from "../src/hosted-runtime/canonical-write-receipt.ts";
import { publishHostedWorkspaceMediaReferencesForSnapshot, readHostedMediaReferenceCatalogue, writeHostedMediaReferenceCatalogue } from "../src/hosted-runtime/media-references.ts";
import type { HostedRuntimeMediaStore } from "../src/hosted-runtime/platform.ts";

const at = "2026-01-01T00:00:00.000Z";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64");
const tar = promisify(execFile);
async function restore(source: string, destination: string) {
  const archive = `${destination}.tar`;
  await mkdir(destination);
  await tar("tar", ["-cf", archive, "-C", source, "."]);
  await tar("tar", ["-xf", archive, "-C", destination]);
}
function storeFixture() {
  const objects = new Map<string, Uint8Array>();
  const mediaStore = {
    put: vi.fn(async () => { throw new Error("Preserver must not upload photos"); }),
    get: vi.fn(async ({ mediaId }: { mediaId: string }) => objects.get(mediaId) ?? null),
    delete: vi.fn(async ({ mediaId }: { mediaId: string }) => { objects.delete(mediaId); }),
  } satisfies HostedRuntimeMediaStore;
  return { objects, mediaStore };
}
async function externalizeFixture(vaultRoot: string, relativePaths: string[], objects: Map<string, Uint8Array>, pendingUpload?: boolean) {
  const entries = [];
  for (const relativePath of relativePaths) {
    const bytes = await readFile(path.join(vaultRoot, relativePath));
    const entry = { relativePath, byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
      mediaId: createHash("sha256").update(relativePath).digest("hex"), mediaKind: "image" as const,
      mimeType: "image/png", recordedAt: at, expiresAt: null,
      ...(pendingUpload === undefined ? {} : { pendingUpload }) };
    entries.push(entry);
    objects.set(entry.mediaId, bytes);
    await rm(path.join(vaultRoot, relativePath));
  }
  await writeHostedMediaReferenceCatalogue({ vaultRoot, catalogue: { schema: HOSTED_MEDIA_REFS_SCHEMA, entries } });
  return entries;
}
async function replay(vaultRoot: string, persistence: HostedCanonicalWritePersistenceInput) {
  const receipt = parseHostedCanonicalWriteReceiptArtifact(JSON.stringify(persistence.receipt));
  if (!receipt) throw new Error("Expected receipt");
  await applyHostedCanonicalWriteReceiptWithMedia({ vaultRoot, receipt,
    readPayload: async ref => persistence.payloads.find(value => value.sha256 === ref.sha256 && value.byteLength === ref.byteSize)!.bytes });
}

test.each([true, false, undefined])("measurement receipt recovery preserves pending=%s without producing uploads", async pendingUpload => {
  const root = await mkdtemp(path.join(tmpdir(), "pending-photo-preserver-"));
  const source = path.join(root, "source"), restored = path.join(root, "restored");
  const { objects, mediaStore } = storeFixture();
  try {
    await initializeVault({ vaultRoot: source });
    const sourcePath = path.join(root, "fixture.png"); await writeFile(sourcePath, png);
    const measurement = await addMeasurement({ vaultRoot: source, attachments: [{ role: "media_1", sourcePath }],
      draft: { title: "Synthetic measurement", occurredAt: at, measurements: [{ metric: "weight", value: 70, unit: "kg" }] } });
    await addMeal({ vaultRoot: source, photoPath: sourcePath, occurredAt: at });
    expect(await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot: source, mediaStore }))
      .toMatchObject({ uploadedMediaCount: 0, referenceCount: 0, excludedVaultPaths: [] });
    const relativePath = measurement.event.attachments![0]!.relativePath;
    const entries = await externalizeFixture(source, [relativePath], objects, pendingUpload);
    await restore(source, restored);
    // The older snapshot has canonical ownership but no catalogue metadata.
    await rm(path.join(restored, HOSTED_MEDIA_REFS_RELATIVE_PATH));
    const receipts: HostedCanonicalWritePersistenceInput[] = [];
    await withHostedCanonicalWritePort({ persistCanonicalWrite: async persistence => {
      receipts.push(await externalizeHostedCanonicalWriteMediaPayloads({ persistence, vaultRoot: source, mediaStore }));
    } }, () => deleteEvent({ vaultRoot: source, eventId: measurement.event.id }));
    for (const receipt of receipts) await replay(restored, receipt);
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot: restored })).entries).toEqual(entries);
    expect(receipts.flatMap(value => value.receipt.actions)).toContainEqual(expect.objectContaining({
      kind: "raw_upsert", targetRelativePath: relativePath, sha256: entries[0]!.sha256,
      mediaRef: expect.objectContaining({ id: entries[0]!.mediaId }),
    }));
    await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot: restored, mediaStore });
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot: restored })).entries).toEqual(entries);
    if (pendingUpload) {
      const materialize = createHostedArtifactMaterializer({ vaultRoot: restored, operatorHomeRoot: path.join(root, "operator"), mediaStore });
      expect((await materialize([relativePath])).missingArtifactPaths.get(`vault:${relativePath}`)).toBe("missing");
      // Replaying older intent cannot turn matching settled evidence pending.
      for (const settled of [false, undefined]) {
        if (settled === undefined) delete entries[0]!.pendingUpload;
        else entries[0]!.pendingUpload = settled;
        await writeHostedMediaReferenceCatalogue({ vaultRoot: restored, catalogue: { schema: HOSTED_MEDIA_REFS_SCHEMA, entries } });
        for (const receipt of receipts) await replay(restored, receipt);
        expect((await readHostedMediaReferenceCatalogue({ vaultRoot: restored })).entries[0]!.pendingUpload).toBe(false);
      }
    }
    expect(mediaStore.put).not.toHaveBeenCalled(); expect(mediaStore.get).not.toHaveBeenCalled(); expect(mediaStore.delete).not.toHaveBeenCalled();
    if (!pendingUpload) {
      const materialize = createHostedArtifactMaterializer({ vaultRoot: restored, operatorHomeRoot: path.join(root, "operator"), mediaStore });
      expect((await materialize([relativePath])).missingArtifactPaths.size).toBe(0);
      expect(await readFile(path.join(restored, relativePath))).toEqual(png);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test.each(["body_measurement", "measurement"])("%s keeps sole-copy raw evidence after delete, checkpoint and restore", async kind => {
  const root = await mkdtemp(path.join(tmpdir(), "photo-preserver-"));
  const source = path.join(root, "source"), restored = path.join(root, "restored"), again = path.join(root, "again");
  const { objects, mediaStore } = storeFixture();
  try {
    await initializeVault({ vaultRoot: source, timezone: "UTC" });
    const sourcePath = path.join(root, "fixture.png"); await writeFile(sourcePath, png);
    const attachments = [{ role: "media_1", sourcePath }];
    const created = kind === "body_measurement"
      ? await addBodyMeasurement({ vaultRoot: source, attachments, draft: buildBodyMeasurementEventDraft({ title: "Synthetic body measurement", occurredAt: new Date(at), measurements: [{ type: "weight", value: 70, unit: "kg" }] }) })
      : await addMeasurement({ vaultRoot: source, attachments, draft: { title: "Synthetic measurement", occurredAt: at, measurements: [{ metric: "weight", value: 70, unit: "kg" }] } });
    const relativePath = created.event.attachments![0]!.relativePath;
    const inline = path.join(root, "inline");
    await restore(source, inline);
    const inlineDeleted = await deleteEvent({ vaultRoot: inline, eventId: created.event.id });
    expect(await readFile(path.join(inline, relativePath))).toEqual(png);
    const entries = await externalizeFixture(source, [relativePath], objects);
    await restore(source, restored);
    const receipts: HostedCanonicalWritePersistenceInput[] = [];
    const deleted = await withHostedCanonicalWritePort({ persistCanonicalWrite: async persistence => {
      receipts.push(await externalizeHostedCanonicalWriteMediaPayloads({ persistence, vaultRoot: restored, mediaStore }));
    } }, () => deleteEvent({ vaultRoot: restored, eventId: created.event.id }));
    expect(deleted.retainedPaths).toContain(relativePath);
    expect(deleted.retainedPaths).toEqual(inlineDeleted.retainedPaths);
    expect(receipts[0]!.receipt.actions).toContainEqual(expect.objectContaining({ targetRelativePath: relativePath, mediaRef: expect.objectContaining({ id: entries[0]!.mediaId }) }));
    expect(await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot: restored, mediaStore })).toMatchObject({ uploadedMediaCount: 0, prunedMediaCount: 0 });
    await restore(restored, again);
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot: again })).entries).toEqual(entries);
    expect((await validateVault({ vaultRoot: again })).valid).toBe(true);
    await expect(readFile(path.join(again, relativePath))).rejects.toMatchObject({ code: "ENOENT" });
    expect(mediaStore.put).not.toHaveBeenCalled(); expect(mediaStore.get).not.toHaveBeenCalled(); expect(mediaStore.delete).not.toHaveBeenCalled();
    const materialize = createHostedArtifactMaterializer({ vaultRoot: again, operatorHomeRoot: path.join(root, "operator"), mediaStore });
    expect((await materialize([relativePath])).missingArtifactPaths.size).toBe(0);
    expect(await readFile(path.join(again, relativePath))).toEqual(png);
    // Export the restored vault and verify the retained evidence in the archive.
    const exportPath = path.join(root, "export.tar");
    await tar("tar", ["-cf", exportPath, "-C", again, "."]);
    const exported = await tar("tar", ["-xOf", exportPath, `./${relativePath}`], { encoding: "buffer" });
    expect(exported.stdout).toEqual(png);
    expect(mediaStore.get).toHaveBeenCalledTimes(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test.each(["delete", "retention"])("absent meal bytes support review, %s and receipt-only replay", async operation => {
  const root = await mkdtemp(path.join(tmpdir(), "meal-preserver-"));
  const source = path.join(root, "source"), restored = path.join(root, "restored");
  const { objects, mediaStore } = storeFixture();
  try {
    await initializeVault({ vaultRoot: source, timezone: "UTC" });
    const photoPath = path.join(root, "fixture.png"); await writeFile(photoPath, png);
    const meal = await addMeal({ vaultRoot: source, photoPath, photoCapturedAt: at, occurredAt: at, source: "device",
      externalRef: { system: "meal-photo-capture", resourceType: "photo", resourceId: "a".repeat(64) } });
    const paths = [meal.photo!.relativePath];
    if (operation === "retention") {
      await runMealPhotoMaintenance({ vaultRoot: source, now: new Date(at) });
      const current = (await readEvent({ vaultRoot: source, eventId: meal.event.id })).event;
      if (current.kind !== "meal") throw new Error("Expected meal");
      paths.push(current.photoThumbnail!.relativePath);
    }
    const entries = await externalizeFixture(source, paths, objects, false);
    // Thumbnails are JPEG; use their canonical metadata in the fixture.
    if (entries.length > 1) {
      entries[1]!.mimeType = "image/jpeg";
      await writeHostedMediaReferenceCatalogue({ vaultRoot: source, catalogue: { schema: HOSTED_MEDIA_REFS_SCHEMA, entries } });
    }
    await restore(source, restored);
    const receipts: HostedCanonicalWritePersistenceInput[] = [];
    await withHostedCanonicalWritePort({ persistCanonicalWrite: async persistence => {
      receipts.push(await externalizeHostedCanonicalWriteMediaPayloads({ persistence, vaultRoot: source, mediaStore }));
    } }, async () => {
      expect(await removeAutomaticMealPhoto({ vaultRoot: source, eventId: meal.event.id })).toMatchObject({ removedPhotoCount: 1 });
      if (operation === "delete") await deleteEvent({ vaultRoot: source, eventId: meal.event.id });
      else expect(await runMealPhotoMaintenance({ vaultRoot: source, now: new Date("2026-05-01T00:00:00Z") })).toMatchObject({ retiredPhotoCount: 1 });
    });
    for (const receipt of receipts) await replay(restored, receipt);
    const tombstone = await readFile(path.join(restored, paths[0]!), "utf8");
    expect(JSON.parse(tombstone).reason).toBe(operation === "delete" ? "meal_deleted" : "meal_photo_retention");
    expect(await readFile(path.join(source, paths[0]!), "utf8")).toBe(tombstone);
    expect((await validateVault({ vaultRoot: restored })).valid).toBe(true);
    await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot: restored, mediaStore });
    expect(objects.has(entries[0]!.mediaId)).toBe(false);
    if (entries[1]) expect(objects.has(entries[1].mediaId)).toBe(true);
    expect(mediaStore.put).not.toHaveBeenCalled(); expect(mediaStore.get).not.toHaveBeenCalled();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("malformed sole-copy catalogue blocks checkpoint without writes or pruning", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "invalid-preserver-"));
  const { mediaStore } = storeFixture();
  try {
    await initializeVault({ vaultRoot: root });
    const cataloguePath = path.join(root, HOSTED_MEDIA_REFS_RELATIVE_PATH);
    await mkdir(path.dirname(cataloguePath), { recursive: true });
    const raw = JSON.stringify({ schema: HOSTED_MEDIA_REFS_SCHEMA, entries: [{ mediaKind: "image", relativePath: "raw/measurements/../photo.jpg" }] });
    await writeFile(cataloguePath, raw);
    await expect(publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot: root, mediaStore })).rejects.toMatchObject({ code: "HOSTED_MEDIA_REFERENCE_UNAVAILABLE" });
    expect(await readFile(cataloguePath, "utf8")).toBe(raw);
    expect(mediaStore.put).not.toHaveBeenCalled(); expect(mediaStore.delete).not.toHaveBeenCalled();
  } finally { await rm(root, { recursive: true, force: true }); }
});


test.each([true, false, undefined])("preserved photos keep inline checkpoint and receipt bytes with pending=%s", async pendingUpload => {
  const root = await mkdtemp(path.join(tmpdir(), "inline-photo-preserver-"));
  const vaultRoot = path.join(root, "vault");
  const { objects, mediaStore } = storeFixture();
  try {
    await initializeVault({ vaultRoot });
    const sourcePath = path.join(root, "fixture.png");
    await writeFile(sourcePath, png);
    const receipts: HostedCanonicalWritePersistenceInput[] = [];
    const measurement = await withHostedCanonicalWritePort({ persistCanonicalWrite: async persistence => { receipts.push(persistence); } },
      () => addMeasurement({ vaultRoot, attachments: [{ role: "media_1", sourcePath }],
        draft: { title: "Synthetic measurement", occurredAt: at, measurements: [{ metric: "weight", value: 70, unit: "kg" }] } }));
    const meal = await addMeal({ vaultRoot, photoPath: sourcePath, occurredAt: at });
    const paths = [meal.photo!.relativePath, measurement.event.attachments![0]!.relativePath];
    const entries = await externalizeFixture(vaultRoot, paths, objects, pendingUpload);
    for (const relativePath of paths) await writeFile(path.join(vaultRoot, relativePath), png);
    const rewritten = await externalizeHostedCanonicalWriteMediaPayloads({ persistence: receipts[0]!, vaultRoot, mediaStore });
    expect(rewritten.payloads).toEqual(receipts[0]!.payloads);
    const originalRaw = receipts[0]!.receipt.actions.find(action => action.targetRelativePath === paths[1]);
    expect(rewritten.receipt.actions).toContainEqual(originalRaw);
    expect(await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore }))
      .toMatchObject({ excludedVaultPaths: [], uploadedMediaCount: 0, prunedMediaCount: 0 });
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries).toEqual(entries);
    expect(mediaStore.put).not.toHaveBeenCalled();
    expect(mediaStore.get).not.toHaveBeenCalled();
    expect(mediaStore.delete).not.toHaveBeenCalled();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a photo whose identity cannot be established is kept rather than pruned", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-preserver-doubt-"));
  try {
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const photoPath = path.join(vaultRoot, "source.png");
    await writeFile(photoPath, png);
    const meal = await addMeal({ vaultRoot, photoPath, occurredAt: at });
    const relativePath = meal.photo!.relativePath;
    const { objects, mediaStore } = storeFixture();
    await externalizeFixture(vaultRoot, [relativePath], objects);
    const directory = path.join(vaultRoot, path.dirname(relativePath));
    const manifest = (await readdir(directory)).find(name => name.startsWith("manifest"));
    await writeFile(path.join(directory, manifest!), "{ not json");
    await publishHostedWorkspaceMediaReferencesForSnapshot({ mediaStore, vaultRoot });
    expect(mediaStore.delete).not.toHaveBeenCalled();
    expect(objects.size).toBe(1);
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries.map(entry => entry.relativePath)).toEqual([relativePath]);
    // A read of that photo is denied for that one file, not an aborted turn.
    const materialize = createHostedArtifactMaterializer({ vaultRoot, operatorHomeRoot: vaultRoot, mediaStore });
    expect((await materialize([relativePath])).missingArtifactPaths.get(`vault:${relativePath}`)).toBe("integrity");
    expect(mediaStore.get).not.toHaveBeenCalled();
  } finally { await rm(vaultRoot, { recursive: true, force: true }); }
});


test.each(["repeat", "rewrite"])("measurement %s preserves the original object and pointer", async operation => {
  const root = await mkdtemp(path.join(tmpdir(), "measurement-manifests-"));
  const vaultRoot = path.join(root, "vault");
  const { objects, mediaStore } = storeFixture();
  try {
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const sourcePath = path.join(root, "fixture.png");
    await writeFile(sourcePath, png);
    const attachments = [{ role: "media_1", sourcePath, allowExistingMatch: true }];
    const draft = { title: "Synthetic measurement", occurredAt: at,
      measurements: [{ metric: "weight", value: 70, unit: "kg" }] };
    const first = await addMeasurement({ vaultRoot, attachments, draft, rawImport: { importedAt: at } });
    const relativePath = first.event.attachments![0]!.relativePath;
    // Repeated imports reuse existing bytes; rewrites happen after externalization.
    const entries = operation === "rewrite" ? await externalizeFixture(vaultRoot, [relativePath], objects) : null;
    if (operation === "rewrite") await writeFile(sourcePath, Buffer.concat([png, Buffer.from("synthetic revision")]));
    const second = await addMeasurement({ vaultRoot, attachments, draft: { ...draft, id: first.event.id },
      rawImport: { importedAt: "2026-01-02T00:00:00.000Z" } });
    expect(second.event.attachments![0]!.relativePath).toBe(relativePath);
    expect(second.manifestPath).not.toBe(first.manifestPath);
    const expectedEntries = entries ?? await externalizeFixture(vaultRoot, [relativePath], objects);
    expect(await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore }))
      .toMatchObject({ prunedMediaCount: 0, uploadedMediaCount: 0 });
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries).toEqual(expectedEntries);
    expect(objects.get(expectedEntries[0]!.mediaId)).toEqual(png);
    expect(mediaStore.delete).not.toHaveBeenCalled();
    if (operation === "rewrite") await rm(path.join(vaultRoot, relativePath));
    const materialize = createHostedArtifactMaterializer({ vaultRoot, operatorHomeRoot: root, mediaStore });
    const result = await materialize([relativePath]);
    if (operation === "repeat") {
      expect(result.missingArtifactPaths.size).toBe(0);
      expect(await readFile(path.join(vaultRoot, relativePath))).toEqual(png);
      expect(mediaStore.get).toHaveBeenCalledTimes(1);
    } else {
      expect(result.missingArtifactPaths.get(`vault:${relativePath}`)).toBe("obsolete");
      expect(mediaStore.get).not.toHaveBeenCalled();
      await expect(readFile(path.join(vaultRoot, relativePath))).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect(mediaStore.put).not.toHaveBeenCalled();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("measurement rewrite and later reference receipts replay without asserting the retained old identity", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "measurement-receipt-rewrite-"));
  const vaultRoot = path.join(root, "vault"), restored = path.join(root, "restored"), again = path.join(root, "again");
  const { objects, mediaStore } = storeFixture();
  try {
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const sourcePath = path.join(root, "fixture.png");
    await writeFile(sourcePath, png);
    const attachments = [{ role: "media_1", sourcePath, allowExistingMatch: true }];
    const draft = { title: "Synthetic measurement", occurredAt: at,
      measurements: [{ metric: "weight", value: 70, unit: "kg" }] };
    const first = await addMeasurement({ vaultRoot, attachments, draft, rawImport: { importedAt: at } });
    const relativePath = first.event.attachments![0]!.relativePath;
    const entries = await externalizeFixture(vaultRoot, [relativePath], objects);
    await restore(vaultRoot, restored);
    await expect(readFile(path.join(restored, relativePath))).rejects.toMatchObject({ code: "ENOENT" });
    const replacement = Buffer.concat([png, Buffer.from("synthetic revision")]);
    await writeFile(sourcePath, replacement);
    const receipts: HostedCanonicalWritePersistenceInput[] = [];
    const port = { persistCanonicalWrite: async (persistence: HostedCanonicalWritePersistenceInput) => {
      receipts.push(await externalizeHostedCanonicalWriteMediaPayloads({ persistence, vaultRoot, mediaStore }));
    } };
    const second = await withHostedCanonicalWritePort(port, () => addMeasurement({
      vaultRoot, attachments, draft: { ...draft, id: first.event.id },
      rawImport: { importedAt: "2026-01-02T00:00:00.000Z" },
    }));
    expect(second.event.attachments![0]!.relativePath).toBe(relativePath);
    expect(second.manifestPath).not.toBe(first.manifestPath);
    expect(receipts).toHaveLength(1);
    await replay(restored, receipts[0]!);
    expect(await readFile(path.join(restored, relativePath))).toEqual(replacement);
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot: restored })).entries).toEqual(entries);

    // A later holder-only write must not reassert the old digest either.
    await withHostedCanonicalWritePort(port, () => deleteEvent({ vaultRoot, eventId: first.event.id }));
    expect(receipts).toHaveLength(2);
    expect(receipts[1]!.receipt.actions.some(action => action.kind === "raw_upsert")).toBe(false);
    await replay(restored, receipts[1]!);
    expect(await readFile(path.join(restored, relativePath))).toEqual(replacement);
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries).toEqual(entries);
    expect(await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot: restored, mediaStore }))
      .toMatchObject({ prunedMediaCount: 0, uploadedMediaCount: 0, excludedVaultPaths: [] });
    await restore(restored, again);
    expect(await readFile(path.join(again, relativePath))).toEqual(replacement);
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot: again })).entries).toEqual(entries);
    expect(objects.get(entries[0]!.mediaId)).toEqual(png);
    expect(mediaStore.put).not.toHaveBeenCalled();
    expect(mediaStore.get).not.toHaveBeenCalled();
    expect(mediaStore.delete).not.toHaveBeenCalled();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a malformed measurement manifest omits the receipt identity without failing the write", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "measurement-receipt-malformed-"));
  const vaultRoot = path.join(root, "vault"), restored = path.join(root, "restored");
  const { objects, mediaStore } = storeFixture();
  try {
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const sourcePath = path.join(root, "fixture.png");
    await writeFile(sourcePath, png);
    const measurement = await addMeasurement({ vaultRoot, attachments: [{ role: "media_1", sourcePath }],
      draft: { title: "Synthetic measurement", occurredAt: at, measurements: [{ metric: "weight", value: 70, unit: "kg" }] } });
    const relativePath = measurement.event.attachments![0]!.relativePath;
    const entries = await externalizeFixture(vaultRoot, [relativePath], objects);
    await restore(vaultRoot, restored);
    const receipts: HostedCanonicalWritePersistenceInput[] = [];
    await withHostedCanonicalWritePort({ persistCanonicalWrite: async persistence => {
      await writeFile(path.join(vaultRoot, measurement.manifestPath!), "{ not json");
      receipts.push(await externalizeHostedCanonicalWriteMediaPayloads({ persistence, vaultRoot, mediaStore }));
    } }, () => deleteEvent({ vaultRoot, eventId: measurement.event.id }));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.receipt.actions.some(action => action.kind === "raw_upsert")).toBe(false);
    await replay(restored, receipts[0]!);
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries).toEqual(entries);
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot: restored })).entries).toEqual(entries);
    expect(objects.get(entries[0]!.mediaId)).toEqual(png);
    expect(mediaStore.put).not.toHaveBeenCalled();
    expect(mediaStore.get).not.toHaveBeenCalled();
    expect(mediaStore.delete).not.toHaveBeenCalled();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a missing measurement manifest preserves bytes for recovery after its restoration", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "missing-measurement-manifest-"));
  const vaultRoot = path.join(root, "vault");
  const { objects, mediaStore } = storeFixture();
  try {
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const sourcePath = path.join(root, "fixture.png");
    await writeFile(sourcePath, png);
    const measurement = await addMeasurement({ vaultRoot, attachments: [{ role: "media_1", sourcePath }],
      draft: { title: "Synthetic measurement", occurredAt: at, measurements: [{ metric: "weight", value: 70, unit: "kg" }] } });
    const relativePath = measurement.event.attachments![0]!.relativePath;
    const entries = await externalizeFixture(vaultRoot, [relativePath], objects);
    const manifestPath = path.join(vaultRoot, measurement.manifestPath!);
    const manifest = await readFile(manifestPath);
    await rm(manifestPath);
    expect(await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore })).toMatchObject({ prunedMediaCount: 0 });
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries).toEqual(entries);
    expect(objects.get(entries[0]!.mediaId)).toEqual(png);
    expect(mediaStore.delete).not.toHaveBeenCalled();
    const materialize = createHostedArtifactMaterializer({ vaultRoot, operatorHomeRoot: root, mediaStore });
    expect((await materialize([relativePath])).missingArtifactPaths.get(`vault:${relativePath}`)).toBe("obsolete");
    expect(mediaStore.get).not.toHaveBeenCalled();
    await writeFile(manifestPath, manifest);
    expect((await materialize([relativePath])).missingArtifactPaths.size).toBe(0);
    expect(await readFile(path.join(vaultRoot, relativePath))).toEqual(png);
    expect(mediaStore.get).toHaveBeenCalledTimes(1);
    expect(mediaStore.put).not.toHaveBeenCalled();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test.each(["absent", "disagreeing"])("meal with %s manifest evidence is preserved but cannot be read", async evidence => {
  const root = await mkdtemp(path.join(tmpdir(), "uncertain-meal-manifest-"));
  const vaultRoot = path.join(root, "vault");
  const { objects, mediaStore } = storeFixture();
  try {
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const photoPath = path.join(root, "fixture.png");
    await writeFile(photoPath, png);
    const meal = await addMeal({ vaultRoot, photoPath, occurredAt: at });
    const relativePath = meal.photo!.relativePath;
    const entries = await externalizeFixture(vaultRoot, [relativePath], objects);
    const manifestPath = path.join(vaultRoot, meal.manifestPath!);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (evidence === "absent") manifest.artifacts = [];
    else {
      const artifact = manifest.artifacts.find((value: { relativePath: string }) => value.relativePath === relativePath);
      expect(artifact).toBeDefined();
      artifact.sha256 = "0".repeat(64);
    }
    await writeFile(evidence === "absent" ? manifestPath : path.join(path.dirname(manifestPath), "manifest.conflict.json"), JSON.stringify(manifest));
    expect(await publishHostedWorkspaceMediaReferencesForSnapshot({ vaultRoot, mediaStore })).toMatchObject({ prunedMediaCount: 0 });
    expect((await readHostedMediaReferenceCatalogue({ vaultRoot })).entries).toEqual(entries);
    expect(objects.get(entries[0]!.mediaId)).toEqual(png);
    expect(mediaStore.delete).not.toHaveBeenCalled();
    const materialize = createHostedArtifactMaterializer({ vaultRoot, operatorHomeRoot: root, mediaStore });
    expect((await materialize([relativePath])).missingArtifactPaths.get(`vault:${relativePath}`)).toBe("obsolete");
    expect(mediaStore.get).not.toHaveBeenCalled();
    expect(mediaStore.put).not.toHaveBeenCalled();
  } finally { await rm(root, { recursive: true, force: true }); }
});
