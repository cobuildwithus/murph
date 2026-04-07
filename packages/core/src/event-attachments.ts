import path from "node:path";
import { promises as fs } from "node:fs";

import {
  eventAttachmentSchema,
  storedMediaSchema,
  type EventAttachment,
  type EventAttachmentKind,
  type RawImportKind,
  type StoredMedia,
} from "@murphai/contracts";

import { describeRawArtifact, stageRawImportManifest } from "./operations/raw-manifests.ts";
import { runCanonicalWrite, type WriteBatch } from "./operations/write-batch.ts";
import { resolveVaultPath } from "./path-safety.ts";
import { prepareRawArtifact, type RawArtifact } from "./raw.ts";
import { loadVault } from "./vault.ts";

import type { DateInput } from "./types.ts";

export type EventAttachmentOwnerKind = "document" | "meal" | "measurement" | "workout";

export interface EventAttachmentSourceInput {
  role: string;
  kind?: EventAttachmentKind;
  sourcePath: string;
  targetName?: string;
  allowExistingMatch?: boolean;
}

export interface PreparedEventAttachment extends EventAttachmentSourceInput {
  raw: RawArtifact;
}

export interface StagePreparedEventAttachmentsInput {
  batch: WriteBatch;
  attachments: readonly PreparedEventAttachment[];
  importId: string;
  importKind: RawImportKind;
  importedAt: string;
  rawDirectory?: string;
  source: string | null;
  provenance: Record<string, unknown>;
}

export interface PrepareEventAttachmentsInput {
  ownerKind: EventAttachmentOwnerKind;
  ownerId: string;
  occurredAt: DateInput;
  attachments: readonly EventAttachmentSourceInput[];
}

export interface StageEventAttachmentsInput extends PrepareEventAttachmentsInput {
  vaultRoot: string;
  operationType: string;
  summary: string;
  importId: string;
  importKind: RawImportKind;
  importedAt: string;
  source: string | null;
  provenance: Record<string, unknown>;
}

export interface StagedEventAttachments {
  attachments: EventAttachment[];
  manifestPath: string;
  rawDirectory: string;
  rawRefs: string[];
}

export interface AttachmentCompatibilityProjections {
  audioPaths: string[];
  documentPath: string | null;
  media: StoredMedia[];
  photoPaths: string[];
  rawRefs: string[];
}

function toStoredMediaKind(kind: EventAttachmentKind): StoredMedia["kind"] {
  switch (kind) {
    case "image":
      return "image";
    case "photo":
      return "photo";
    case "video":
      return "video";
    case "gif":
      return "gif";
    default:
      return "other";
  }
}

function inferEventAttachmentKind(sourcePath: string, targetName?: string): EventAttachmentKind {
  const fileName = (targetName ?? sourcePath).toLowerCase();

  if (fileName.endsWith(".gif")) {
    return "gif";
  }
  if (
    fileName.endsWith(".jpg")
    || fileName.endsWith(".jpeg")
    || fileName.endsWith(".png")
    || fileName.endsWith(".webp")
  ) {
    return "photo";
  }
  if (
    fileName.endsWith(".mp4")
    || fileName.endsWith(".mov")
    || fileName.endsWith(".webm")
  ) {
    return "video";
  }
  if (
    fileName.endsWith(".m4a")
    || fileName.endsWith(".mp3")
    || fileName.endsWith(".wav")
  ) {
    return "audio";
  }
  if (
    fileName.endsWith(".csv")
    || fileName.endsWith(".json")
    || fileName.endsWith(".md")
    || fileName.endsWith(".pdf")
    || fileName.endsWith(".txt")
  ) {
    return "document";
  }

  return "other";
}

function inferAttachmentCategory(
  ownerKind: EventAttachmentOwnerKind,
  attachment: EventAttachmentSourceInput,
): { category: string; slot?: string } {
  if (ownerKind === "document") {
    return { category: "documents" };
  }

  if (ownerKind === "meal") {
    return attachment.kind === "audio"
      ? {
          category: "meal-audio",
          slot: attachment.role,
        }
      : {
          category: "meal-photo",
          slot: attachment.role,
        };
  }

  return {
    category: ownerKind === "measurement" ? "measurements" : "workouts",
  };
}

export function prepareEventAttachments(
  input: PrepareEventAttachmentsInput,
): PreparedEventAttachment[] {
  return input.attachments.map((attachment) => {
    const kind = attachment.kind ?? inferEventAttachmentKind(attachment.sourcePath, attachment.targetName);
    const rawCategory = inferAttachmentCategory(input.ownerKind, {
      ...attachment,
      kind,
    });

    return {
      ...attachment,
      kind,
      raw: prepareRawArtifact({
        sourcePath: attachment.sourcePath,
        category: rawCategory.category,
        occurredAt: input.occurredAt,
        recordId: input.ownerId,
        slot: rawCategory.slot,
        targetName: attachment.targetName,
      }),
    };
  });
}

export function buildAttachmentCompatibilityProjections(
  attachments: readonly EventAttachment[],
): AttachmentCompatibilityProjections {
  const rawRefs = [...new Set(attachments.map((attachment) => attachment.relativePath))];
  const documentPath =
    attachments.find((attachment) => attachment.kind === "document")?.relativePath
    ?? attachments[0]?.relativePath
    ?? null;
  const photoPaths = [
    ...new Set(
      attachments
        .filter((attachment) => attachment.role === "photo" || attachment.kind === "photo")
        .map((attachment) => attachment.relativePath),
    ),
  ];
  const audioPaths = [
    ...new Set(
      attachments
        .filter((attachment) => attachment.role === "audio" || attachment.kind === "audio")
        .map((attachment) => attachment.relativePath),
    ),
  ];
  const media = attachments.map((attachment) =>
    storedMediaSchema.parse({
      kind: toStoredMediaKind(attachment.kind),
      relativePath: attachment.relativePath,
      mediaType: attachment.mediaType,
    }),
  );

  return {
    audioPaths,
    documentPath,
    media,
    photoPaths,
    rawRefs,
  };
}

export async function stagePreparedEventAttachmentsInBatch(
  input: StagePreparedEventAttachmentsInput,
): Promise<StagedEventAttachments | null> {
  if (input.attachments.length === 0) {
    return null;
  }

  const stagedArtifacts = await Promise.all(
    input.attachments.map(async (attachment) => ({
      attachment,
      raw: await input.batch.stageRawCopy({
        sourcePath: attachment.sourcePath,
        targetRelativePath: attachment.raw.relativePath,
        originalFileName: attachment.raw.originalFileName,
        mediaType: attachment.raw.mediaType,
        allowExistingMatch: attachment.allowExistingMatch ?? false,
      }),
    })),
  );

  const attachments = await Promise.all(
    stagedArtifacts.map(async ({ attachment, raw }) => {
      const described = await describeRawArtifact(raw, attachment.role);

      return eventAttachmentSchema.parse({
        role: attachment.role,
        kind: attachment.kind,
        relativePath: described.relativePath,
        mediaType: described.mediaType,
        sha256: described.sha256,
        originalFileName: described.originalFileName,
      });
    }),
  );

  const manifestPath = await stageRawImportManifest({
    batch: input.batch,
    importId: input.importId,
    importKind: input.importKind,
    importedAt: input.importedAt,
    rawDirectory: input.rawDirectory,
    source: input.source,
    artifacts: stagedArtifacts.map(({ attachment, raw }) => ({
      role: attachment.role,
      raw,
    })),
    canonicalProvenance: input.provenance,
  });

  return {
    attachments,
    manifestPath,
    rawDirectory: path.posix.dirname(manifestPath),
    rawRefs: [...new Set(attachments.map((attachment) => attachment.relativePath))],
  };
}

export async function stageEventAttachments(
  input: StageEventAttachmentsInput,
): Promise<StagedEventAttachments | null> {
  if (input.attachments.length === 0) {
    return null;
  }

  await loadVault({ vaultRoot: input.vaultRoot });
  const prepared = prepareEventAttachments(input);

  return await runCanonicalWrite({
    vaultRoot: input.vaultRoot,
    operationType: input.operationType,
    summary: input.summary,
    occurredAt: input.occurredAt,
    mutate: async ({ batch }) =>
      stagePreparedEventAttachmentsInBatch({
        batch,
        attachments: prepared,
        importId: input.importId,
        importKind: input.importKind,
        importedAt: input.importedAt,
        source: input.source,
        provenance: input.provenance,
      }),
  });
}

export async function cleanupStagedEventAttachments(input: {
  vaultRoot: string;
  manifestPath: string;
}): Promise<void> {
  const rawDirectory = path.posix.dirname(input.manifestPath);
  const resolved = resolveVaultPath(input.vaultRoot, rawDirectory);
  await fs.rm(resolved.absolutePath, { recursive: true, force: true });
}
