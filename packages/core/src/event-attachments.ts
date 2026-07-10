import path from "node:path";
import { promises as fs } from "node:fs";

import {
  eventAttachmentSchema,
  storedMediaSchema,
  type EventAttachment,
  type EventAttachmentKind,
  type RawAssetOwner,
  type RawAssetOwnerKind,
  type RawImportKind,
  type StoredMedia,
} from "@murphai/contracts";

import { describeRawArtifact, stageRawImportManifest } from "./operations/raw-manifests.ts";
import {
  type CommittedPayloadReceipt,
  readStoredWriteOperation,
  WriteBatch,
  WRITE_OPERATION_DIRECTORY,
} from "./operations/write-batch.ts";
import { normalizeRelativeVaultPath, resolveVaultPath } from "./path-safety.ts";
import { prepareRawArtifact, type RawArtifact } from "./raw.ts";
import { loadVault } from "./vault.ts";
import { VaultError } from "./errors.ts";

import type { DateInput } from "./types.ts";

export type EventAttachmentOwnerKind = Extract<RawAssetOwnerKind, "capture" | "document" | "meal" | "measurement" | "workout">;

export interface EventAttachmentSourceInput {
  role: string;
  kind?: EventAttachmentKind;
  sourcePath: string;
  targetName?: string;
  allowExistingMatch?: boolean;
  expectedSourceReceipt?: CommittedPayloadReceipt;
}

export interface PreparedEventAttachment extends EventAttachmentSourceInput {
  raw: RawArtifact;
}

export interface StagePreparedEventAttachmentsInput {
  batch: WriteBatch;
  owner: RawAssetOwner;
  attachments: readonly PreparedEventAttachment[];
  importId: string;
  importKind: RawImportKind;
  importedAt: string;
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
  rawRefs: string[];
  stageOperationPath?: string;
}

export interface EventAttachmentProjections {
  media: StoredMedia[];
  rawRefs: string[];
}

function normalizeStageOperationPath(stageOperationPath: string): string {
  const normalizedPath = normalizeRelativeVaultPath(stageOperationPath);

  if (
    path.posix.dirname(normalizedPath) !== WRITE_OPERATION_DIRECTORY
    || !normalizedPath.endsWith(".json")
  ) {
    throw new VaultError(
      "INVALID_INPUT",
      "stageOperationPath must target a write operation metadata file under .runtime/operations/.",
    );
  }

  return normalizedPath;
}

function assertGeneratedWriteOperationId(operationId: string): void {
  if (!/^op_[0-9a-f]{32}$/u.test(operationId)) {
    throw new VaultError(
      "OPERATION_INVALID",
      "write operation metadata contains an invalid operation id.",
    );
  }
}

function assertStagedEventAttachmentOperation(operation: {
  status: string;
  actions: Array<{
    kind: string;
    state?: string;
    targetRelativePath: string;
  }>;
}, manifestPath: string): void {
  if (operation.status !== "staged") {
    throw new VaultError(
      "OPERATION_STATE_INVALID",
      "cleanupStagedEventAttachments only accepts staged attachment operations.",
    );
  }

  const rawDirectory = path.posix.dirname(manifestPath);
  let manifestMatched = false;

  for (const action of operation.actions) {
    if (action.state !== "staged") {
      throw new VaultError(
        "OPERATION_STATE_INVALID",
        "cleanupStagedEventAttachments only accepts attachment operations with staged actions.",
      );
    }

    if (action.kind === "raw_copy") {
      if (path.posix.dirname(action.targetRelativePath) !== rawDirectory) {
        throw new VaultError(
          "INVALID_INPUT",
          `staged raw path "${action.targetRelativePath}" must stay within "${rawDirectory}".`,
        );
      }
      continue;
    }

    if (action.kind === "text_write" && action.targetRelativePath === manifestPath) {
      manifestMatched = true;
      continue;
    }

    throw new VaultError(
      "INVALID_INPUT",
      "cleanupStagedEventAttachments requires a stageEventAttachments write operation.",
    );
  }

  if (!manifestMatched) {
    throw new VaultError(
      "INVALID_INPUT",
      `stage operation does not stage manifest "${manifestPath}".`,
    );
  }
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

export function prepareEventAttachments(
  input: PrepareEventAttachmentsInput,
): PreparedEventAttachment[] {
  return input.attachments.map((attachment) => {
    const kind = attachment.kind ?? inferEventAttachmentKind(attachment.sourcePath, attachment.targetName);

    return {
      ...attachment,
      kind,
      raw: prepareRawArtifact({
        sourcePath: attachment.sourcePath,
        owner: {
          kind: input.ownerKind,
          id: input.ownerId,
        },
        occurredAt: input.occurredAt,
        role: attachment.role,
        targetName: attachment.targetName,
      }),
    };
  });
}

export function buildAttachmentCompatibilityProjections(
  attachments: readonly EventAttachment[],
): EventAttachmentProjections {
  const media = attachments.map((attachment) =>
    storedMediaSchema.parse({
      kind: toStoredMediaKind(attachment.kind),
      relativePath: attachment.relativePath,
      mediaType: attachment.mediaType,
    }),
  );

  return {
    media,
    rawRefs: [...new Set(attachments.map((attachment) => attachment.relativePath))],
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
        expectedSourceReceipt: attachment.expectedSourceReceipt,
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
    owner: input.owner,
    source: input.source,
    artifacts: stagedArtifacts.map(({ attachment, raw }) => ({
      role: attachment.role,
      raw,
    })),
    provenance: input.provenance,
  });

  return {
    attachments,
    manifestPath,
    rawRefs: Array.from(new Set<string>(attachments.map((attachment) => attachment.relativePath))),
  };
}

export async function stageEventAttachments(
  input: StageEventAttachmentsInput,
): Promise<StagedEventAttachments | null> {
  await loadVault({ vaultRoot: input.vaultRoot });
  const prepared = prepareEventAttachments(input);
  if (prepared.length === 0) {
    return null;
  }

  const batch = await WriteBatch.create({
    vaultRoot: input.vaultRoot,
    operationType: input.operationType,
    summary: input.summary,
    occurredAt: input.occurredAt,
  });

  let staged: StagedEventAttachments | null;

  try {
    staged = await stagePreparedEventAttachmentsInBatch({
      batch,
      owner: {
        kind: input.ownerKind,
        id: input.ownerId,
      },
      attachments: prepared,
      importId: input.importId,
      importKind: input.importKind,
      importedAt: input.importedAt,
      source: input.source,
      provenance: input.provenance,
    });
  } catch (error) {
    await batch.rollback();
    throw error;
  }

  if (!staged) {
    return null;
  }

  return {
    ...staged,
    stageOperationPath: batch.metadataRelativePath,
  };
}

export async function cleanupStagedEventAttachments(input: {
  vaultRoot: string;
  manifestPath: string;
  stageOperationPath?: string;
}): Promise<void> {
  if (!input.stageOperationPath) {
    throw new VaultError(
      "INVALID_INPUT",
      "cleanupStagedEventAttachments requires stageOperationPath returned by stageEventAttachments.",
    );
  }

  const manifestPath = normalizeRelativeVaultPath(input.manifestPath);
  const stageOperationPath = normalizeStageOperationPath(input.stageOperationPath);
  const operation = await readStoredWriteOperation(input.vaultRoot, stageOperationPath);
  assertGeneratedWriteOperationId(operation.operationId);
  const stageRootRelativePath = path.posix.join(WRITE_OPERATION_DIRECTORY, operation.operationId);
  if (path.posix.dirname(stageRootRelativePath) !== WRITE_OPERATION_DIRECTORY) {
    throw new VaultError(
      "OPERATION_INVALID",
      "write operation staging directory must stay under .runtime/operations.",
    );
  }
  const expectedOperationPath = `${WRITE_OPERATION_DIRECTORY}/${operation.operationId}.json`;

  if (stageOperationPath !== expectedOperationPath) {
    throw new VaultError(
      "OPERATION_INVALID",
      `write operation metadata path "${stageOperationPath}" does not match operation "${operation.operationId}".`,
    );
  }

  assertStagedEventAttachmentOperation(operation, manifestPath);

  const resolvedOperationPath = resolveVaultPath(input.vaultRoot, stageOperationPath);
  const resolvedStageRoot = resolveVaultPath(
    input.vaultRoot,
    stageRootRelativePath,
  );
  await Promise.all([
    fs.rm(resolvedOperationPath.absolutePath, { force: true }),
    fs.rm(resolvedStageRoot.absolutePath, { recursive: true, force: true }),
  ]);
}
