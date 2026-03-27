import { VAULT_LAYOUT } from "./constants.ts";
import { copyImmutableFileIntoVaultRaw } from "./fs.ts";
import { basenameFromFilePath, sanitizeFileName, sanitizePathSegment } from "./path-safety.ts";
import { toIsoTimestamp } from "./time.ts";

import type { DateInput } from "./types.ts";

interface CopyRawArtifactInput {
  vaultRoot: string;
  sourcePath: string;
  category?: string;
  occurredAt?: DateInput;
  targetName?: string;
  recordId?: string;
  slot?: string;
  stream?: string;
  provider?: string;
  allowExistingMatch?: boolean;
}

export interface RawArtifact {
  relativePath: string;
  originalFileName: string;
  mediaType: string;
}

type PrepareRawArtifactInput = Omit<CopyRawArtifactInput, "vaultRoot">;

interface PrepareInlineRawArtifactInput extends Omit<PrepareRawArtifactInput, "sourcePath"> {
  fileName: string;
  mediaType?: string;
}

const MEDIA_TYPES = new Map<string, string>([
  [".csv", "text/csv"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".json", "application/json"],
  [".m4a", "audio/mp4"],
  [".md", "text/markdown"],
  [".mov", "video/quicktime"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".txt", "text/plain"],
  [".wav", "audio/wav"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
]);

function inferMediaType(fileName: string): string {
  const match = /\.([^.]+)$/u.exec(fileName);
  if (!match) {
    return "application/octet-stream";
  }

  return MEDIA_TYPES.get(`.${match[1].toLowerCase()}`) ?? "application/octet-stream";
}

function resolveRawRelativePath({
  category,
  occurredAt,
  originalFileName,
  recordId,
  slot,
  stream,
  targetName,
  provider,
}: {
  category: string;
  occurredAt: DateInput;
  originalFileName: string;
  recordId?: string;
  slot?: string;
  stream?: string;
  targetName?: string;
  provider?: string;
}): string {
  const timestamp = toIsoTimestamp(occurredAt, "occurredAt");
  const year = timestamp.slice(0, 4);
  const month = timestamp.slice(5, 7);
  const safeFileName = sanitizeFileName(targetName || originalFileName, "artifact");
  const stableId =
    typeof recordId === "string" && /^[A-Za-z0-9_-]+$/u.test(recordId)
      ? recordId
      : sanitizePathSegment(recordId, "item");

  if (category === "documents") {
    return `${VAULT_LAYOUT.rawDocumentsDirectory}/${year}/${month}/${stableId}/${safeFileName}`;
  }

  if (category === "meal-photo" || category === "meal-audio") {
    const safeSlot = sanitizePathSegment(slot, category === "meal-photo" ? "photo" : "audio");
    return `${VAULT_LAYOUT.rawMealsDirectory}/${year}/${month}/${stableId}/${safeSlot}-${safeFileName}`;
  }

  if (category === "samples") {
    const safeStream = sanitizePathSegment(stream, "stream");
    return `${VAULT_LAYOUT.rawSamplesDirectory}/${safeStream}/${year}/${month}/${stableId}/${safeFileName}`;
  }

  if (category === "assessments") {
    return `${VAULT_LAYOUT.rawAssessmentsDirectory}/${year}/${month}/${stableId}/source.json`;
  }

  if (category === "integrations") {
    const safeProvider = sanitizePathSegment(provider, "provider");
    return `${VAULT_LAYOUT.rawDirectory}/integrations/${safeProvider}/${year}/${month}/${stableId}/${safeFileName}`;
  }

  return `${VAULT_LAYOUT.rawDirectory}/${sanitizePathSegment(category, "artifact")}/${year}/${month}/${stableId}/${safeFileName}`;
}

export async function copyRawArtifact({
  vaultRoot,
  ...input
}: CopyRawArtifactInput): Promise<RawArtifact> {
  const artifact = prepareRawArtifact(input);

  await copyImmutableFileIntoVaultRaw(vaultRoot, input.sourcePath, artifact.relativePath, {
    allowExistingMatch: input.allowExistingMatch ?? false,
  });

  return artifact;
}

export function prepareRawArtifact({
  sourcePath,
  category = "artifact",
  occurredAt = new Date(),
  targetName,
  recordId,
  slot,
  stream,
  provider,
}: PrepareRawArtifactInput): RawArtifact {
  const originalFileName = basenameFromFilePath(sourcePath);
  const relativePath = resolveRawRelativePath({
    category,
    occurredAt,
    originalFileName,
    recordId,
    slot,
    stream,
    targetName,
    provider,
  });

  return {
    relativePath,
    originalFileName,
    mediaType: inferMediaType(originalFileName),
  };
}

export function prepareInlineRawArtifact({
  fileName,
  category = "artifact",
  occurredAt = new Date(),
  targetName,
  recordId,
  slot,
  stream,
  provider,
  mediaType,
}: PrepareInlineRawArtifactInput): RawArtifact {
  const originalFileName = basenameFromFilePath(fileName);
  const relativePath = resolveRawRelativePath({
    category,
    occurredAt,
    originalFileName,
    recordId,
    slot,
    stream,
    targetName,
    provider,
  });

  return {
    relativePath,
    originalFileName,
    mediaType: mediaType ?? inferMediaType(originalFileName),
  };
}
