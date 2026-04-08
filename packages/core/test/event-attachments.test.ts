import path from "node:path";
import { tmpdir } from "node:os";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { initializeVault } from "../src/index.ts";
import { WriteBatch } from "../src/operations/write-batch.ts";
import {
  buildAttachmentCompatibilityProjections,
  buildAttachmentPathCompatibilityProjections,
  cleanupStagedEventAttachments,
  prepareEventAttachments,
  stageEventAttachments,
  stagePreparedEventAttachmentsInBatch,
} from "../src/event-attachments.ts";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map(async (targetPath) => {
      await rm(targetPath, { recursive: true, force: true });
    }),
  );
});

async function createTempVault(prefix: string): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), prefix));
  cleanupPaths.push(vaultRoot);
  await initializeVault({
    vaultRoot,
    title: "Event Attachment Test Vault",
    timezone: "UTC",
  });
  return vaultRoot;
}

async function createSourceFile(vaultRoot: string, fileName: string, content: string) {
  const fixtureDirectory = path.join(vaultRoot, ".fixtures");
  await mkdir(fixtureDirectory, { recursive: true });
  const sourcePath = path.join(fixtureDirectory, fileName);
  await writeFile(sourcePath, content);
  return sourcePath;
}

const WORKOUT_OWNER_ID = "wfmt_01JNV422Y2M5ZBV64ZP4N1DRB1";
const IMPORT_ID = "xfm_01JNV422Y2M5ZBV64ZP4N1DRB1";

function makeCompatibilityAttachment(input: {
  role: string;
  kind: "document" | "photo" | "video" | "gif" | "image" | "other" | "audio";
  relativePath: string;
  mediaType: string;
}): {
  role: string;
  kind: "document" | "photo" | "video" | "gif" | "image" | "other" | "audio";
  relativePath: string;
  mediaType: string;
  sha256: string;
  originalFileName: string;
} {
  return {
    ...input,
    sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    originalFileName: path.posix.basename(input.relativePath),
  };
}

describe("event attachment helpers", () => {
  it("infers attachment kinds from source paths and target names", async () => {
    const vaultRoot = await createTempVault("murph-core-event-attachments-infer-");
    const sourcePath = await createSourceFile(vaultRoot, "fallback.bin", "payload");

    const prepared = prepareEventAttachments({
      ownerKind: "workout",
      ownerId: WORKOUT_OWNER_ID,
      occurredAt: "2026-04-07T08:30:00.000Z",
      attachments: [
        { role: "photo_1", sourcePath, targetName: "cover.PNG" },
        { role: "video_1", sourcePath, targetName: "clip.MOV" },
        { role: "audio_1", sourcePath, targetName: "voice.MP3" },
        { role: "document_1", sourcePath, targetName: "notes.PDF" },
        { role: "other_1", sourcePath },
        { role: "explicit_1", sourcePath, kind: "gif", targetName: "ignored.txt" },
      ],
    });

    expect(prepared.map((attachment) => attachment.kind)).toEqual([
      "photo",
      "video",
      "audio",
      "document",
      "other",
      "gif",
    ]);
    expect(prepared.every((attachment) => attachment.raw.relativePath.startsWith(`raw/workouts/2026/04/${WORKOUT_OWNER_ID}/`))).toBe(true);
  });

  it("projects compatibility paths and media with empty-input and deduped raw refs behavior", () => {
    const emptyPathProjection = buildAttachmentPathCompatibilityProjections([]);
    const emptyCompatibilityProjection = buildAttachmentCompatibilityProjections([]);

    expect(emptyPathProjection).toEqual({
      audioPaths: [],
      documentPath: null,
      photoPaths: [],
      rawRefs: [],
    });
    expect(emptyCompatibilityProjection).toEqual({
      audioPaths: [],
      documentPath: null,
      media: [],
      photoPaths: [],
      rawRefs: [],
    });

    const pathProjections = buildAttachmentPathCompatibilityProjections([
      {
        role: "document_1",
        kind: "document",
        relativePath: "raw/meals/2026/04/meal_01ARZ3NDEKTSV4RRFFQ69G5FAV/summary.pdf",
      },
      {
        role: "photo_1",
        kind: "photo",
        relativePath: "raw/meals/2026/04/meal_01ARZ3NDEKTSV4RRFFQ69G5FAV/hero.jpg",
      },
      {
        role: "thumbnail_1",
        kind: "other",
        relativePath: "raw/meals/2026/04/meal_01ARZ3NDEKTSV4RRFFQ69G5FAV/hero.jpg",
      },
      {
        role: "audio_1",
        kind: "other",
        relativePath: "raw/meals/2026/04/meal_01ARZ3NDEKTSV4RRFFQ69G5FAV/voice.m4a",
      },
      {
        role: "voice_1",
        kind: "audio",
        relativePath: "raw/meals/2026/04/meal_01ARZ3NDEKTSV4RRFFQ69G5FAV/voice.m4a",
      },
    ]);

    expect(pathProjections).toEqual({
      audioPaths: ["raw/meals/2026/04/meal_01ARZ3NDEKTSV4RRFFQ69G5FAV/voice.m4a"],
      documentPath: "raw/meals/2026/04/meal_01ARZ3NDEKTSV4RRFFQ69G5FAV/summary.pdf",
      photoPaths: ["raw/meals/2026/04/meal_01ARZ3NDEKTSV4RRFFQ69G5FAV/hero.jpg"],
      rawRefs: [
        "raw/meals/2026/04/meal_01ARZ3NDEKTSV4RRFFQ69G5FAV/summary.pdf",
        "raw/meals/2026/04/meal_01ARZ3NDEKTSV4RRFFQ69G5FAV/hero.jpg",
        "raw/meals/2026/04/meal_01ARZ3NDEKTSV4RRFFQ69G5FAV/voice.m4a",
      ],
    });

    const compatibilityProjection = buildAttachmentCompatibilityProjections([
      makeCompatibilityAttachment({
        role: "document_1",
        kind: "document",
        relativePath: "raw/meals/2026/04/meal_01ARZ3NDEKTSV4RRFFQ69G5FAV/summary.pdf",
        mediaType: "application/pdf",
      }),
      makeCompatibilityAttachment({
        role: "photo_1",
        kind: "photo",
        relativePath: "raw/meals/2026/04/meal_01ARZ3NDEKTSV4RRFFQ69G5FAV/hero.jpg",
        mediaType: "image/jpeg",
      }),
      makeCompatibilityAttachment({
        role: "preview_1",
        kind: "image",
        relativePath: "raw/meals/2026/04/meal_01ARZ3NDEKTSV4RRFFQ69G5FAV/cover.png",
        mediaType: "image/png",
      }),
      makeCompatibilityAttachment({
        role: "video_1",
        kind: "video",
        relativePath: "raw/meals/2026/04/meal_01ARZ3NDEKTSV4RRFFQ69G5FAV/clip.mp4",
        mediaType: "video/mp4",
      }),
      makeCompatibilityAttachment({
        role: "gif_1",
        kind: "gif",
        relativePath: "raw/meals/2026/04/meal_01ARZ3NDEKTSV4RRFFQ69G5FAV/loop.gif",
        mediaType: "image/gif",
      }),
      makeCompatibilityAttachment({
        role: "photo_2",
        kind: "photo",
        relativePath: "raw/meals/2026/04/meal_01ARZ3NDEKTSV4RRFFQ69G5FAV/hero.jpg",
        mediaType: "image/jpeg",
      }),
    ]);

    expect(compatibilityProjection.rawRefs).toEqual([
      "raw/meals/2026/04/meal_01ARZ3NDEKTSV4RRFFQ69G5FAV/summary.pdf",
      "raw/meals/2026/04/meal_01ARZ3NDEKTSV4RRFFQ69G5FAV/hero.jpg",
      "raw/meals/2026/04/meal_01ARZ3NDEKTSV4RRFFQ69G5FAV/cover.png",
      "raw/meals/2026/04/meal_01ARZ3NDEKTSV4RRFFQ69G5FAV/clip.mp4",
      "raw/meals/2026/04/meal_01ARZ3NDEKTSV4RRFFQ69G5FAV/loop.gif",
    ]);
    expect(compatibilityProjection.media.map((media) => media.kind)).toEqual([
      "other",
      "photo",
      "image",
      "video",
      "gif",
      "photo",
    ]);
  });

  it("stages prepared attachments in batch and dedupes repeated raw refs", async () => {
    const vaultRoot = await createTempVault("murph-core-event-attachments-batch-");
    const sourcePath = await createSourceFile(vaultRoot, "shared-photo.jpg", "shared-payload");
    const batch = await WriteBatch.create({
      vaultRoot,
      operationType: "test_event_attachment_batch",
      summary: "stage prepared event attachments",
      occurredAt: "2026-04-07T09:00:00.000Z",
    });

    await expect(
      stagePreparedEventAttachmentsInBatch({
        batch,
        owner: {
          kind: "workout",
          id: WORKOUT_OWNER_ID,
        },
        attachments: [],
        importId: IMPORT_ID,
        importKind: "workout_batch",
        importedAt: "2026-04-07T09:01:00.000Z",
        source: "manual",
        provenance: {},
      }),
    ).resolves.toBeNull();

    const prepared = prepareEventAttachments({
      ownerKind: "workout",
      ownerId: WORKOUT_OWNER_ID,
      occurredAt: "2026-04-07T09:00:00.000Z",
      attachments: [
        {
          role: "photo_1",
          sourcePath,
          targetName: "shared-photo.jpg",
          allowExistingMatch: true,
        },
        {
          role: "photo_2",
          sourcePath,
          targetName: "shared-photo.jpg",
          allowExistingMatch: true,
        },
      ],
    });

    const staged = await stagePreparedEventAttachmentsInBatch({
      batch,
      owner: {
        kind: "workout",
        id: WORKOUT_OWNER_ID,
      },
      attachments: prepared,
      importId: IMPORT_ID,
      importKind: "workout_batch",
      importedAt: "2026-04-07T09:01:00.000Z",
      source: "manual",
      provenance: {
        family: "event-attachments",
      },
    });

    expect(staged).not.toBeNull();
    expect(staged?.attachments).toHaveLength(2);
    expect(staged?.rawRefs).toEqual([prepared[0]?.raw.relativePath ?? ""]);
    expect(staged?.manifestPath).toContain(`raw/workouts/2026/04/${WORKOUT_OWNER_ID}/`);
  });

  it("stages event attachments, handles empty input, and cleans up the staged directory", async () => {
    const vaultRoot = await createTempVault("murph-core-event-attachments-stage-");
    const sourcePath = await createSourceFile(vaultRoot, "shared-photo.jpg", "shared-payload");

    await expect(
      stageEventAttachments({
        vaultRoot,
        operationType: "test_event_attachment_stage",
        summary: "stage event attachments",
        ownerKind: "workout",
        ownerId: WORKOUT_OWNER_ID,
        occurredAt: "2026-04-07T10:00:00.000Z",
        attachments: [],
        importId: IMPORT_ID,
        importKind: "workout_batch",
        importedAt: "2026-04-07T10:01:00.000Z",
        source: "manual",
        provenance: {},
      }),
    ).resolves.toBeNull();

    const staged = await stageEventAttachments({
      vaultRoot,
      operationType: "test_event_attachment_stage",
      summary: "stage event attachments",
      ownerKind: "workout",
      ownerId: WORKOUT_OWNER_ID,
      occurredAt: "2026-04-07T10:00:00.000Z",
      attachments: [
        {
          role: "photo_1",
          sourcePath,
          targetName: "shared-photo.jpg",
          allowExistingMatch: true,
        },
        {
          role: "photo_2",
          sourcePath,
          targetName: "shared-photo.jpg",
          allowExistingMatch: true,
        },
      ],
      importId: IMPORT_ID,
      importKind: "workout_batch",
      importedAt: "2026-04-07T10:01:00.000Z",
      source: "manual",
      provenance: {
        family: "event-attachments",
      },
    });

    expect(staged).not.toBeNull();
    expect(staged?.rawRefs).toEqual([staged?.attachments[0]?.relativePath ?? ""]);
    expect(staged?.manifestPath).toContain(`raw/workouts/2026/04/${WORKOUT_OWNER_ID}/`);

    if (!staged) {
      return;
    }

    const manifestAbsolutePath = path.join(vaultRoot, staged.manifestPath);
    expect(await readFile(manifestAbsolutePath, "utf8")).toContain("\"importKind\": \"workout_batch\"");

    await cleanupStagedEventAttachments({
      vaultRoot,
      manifestPath: staged.manifestPath,
    });

    await expect(access(manifestAbsolutePath)).rejects.toThrow();
  });
});
