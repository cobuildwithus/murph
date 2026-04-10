import {
  rawAssetOwnerSchema,
  type RawAssetOwner,
  type RawAssetOwnerKind,
} from "@murphai/contracts";

import { VAULT_LAYOUT } from "./constants.ts";
import { copyImmutableFileIntoVaultRaw } from "./fs.ts";
import {
  basenameFromFilePath,
  normalizeRelativeVaultPath,
  sanitizeFileName,
  sanitizePathSegment,
} from "./path-safety.ts";
import { toIsoTimestamp } from "./time.ts";

import type { DateInput } from "./types.ts";

export interface CopyRawArtifactInput {
  vaultRoot: string;
  sourcePath: string;
  owner: RawAssetOwner;
  occurredAt?: DateInput;
  role?: string;
  targetName?: string;
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

interface RawAssetOwnerDefinition {
  rootDirectory: string;
  resolveFileName: (input: { originalFileName: string; role?: string; targetName?: string }) => string;
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

const RAW_ASSET_OWNER_PARTITION_KINDS = new Set<RawAssetOwnerKind>([
  "device_batch",
  "sample_batch",
  "workout_batch",
]);

function resolveDefaultFileName({ originalFileName, targetName }: { originalFileName: string; targetName?: string }): string {
  return sanitizeFileName(targetName || originalFileName, "artifact");
}

const RAW_ASSET_OWNER_DEFINITIONS = Object.freeze<Record<RawAssetOwnerKind, RawAssetOwnerDefinition>>({
  assessment: {
    rootDirectory: VAULT_LAYOUT.rawAssessmentsDirectory,
    resolveFileName: () => "source.json",
  },
  device_batch: {
    rootDirectory: VAULT_LAYOUT.rawIntegrationsDirectory,
    resolveFileName: resolveDefaultFileName,
  },
  document: {
    rootDirectory: VAULT_LAYOUT.rawDocumentsDirectory,
    resolveFileName: resolveDefaultFileName,
  },
  meal: {
    rootDirectory: VAULT_LAYOUT.rawMealsDirectory,
    resolveFileName: ({ originalFileName, role, targetName }) => {
      const safeFileName = resolveDefaultFileName({ originalFileName, targetName });
      const safeRole = sanitizePathSegment(role, "attachment");
      return `${safeRole}-${safeFileName}`;
    },
  },
  measurement: {
    rootDirectory: VAULT_LAYOUT.rawMeasurementsDirectory,
    resolveFileName: resolveDefaultFileName,
  },
  sample_batch: {
    rootDirectory: VAULT_LAYOUT.rawSamplesDirectory,
    resolveFileName: resolveDefaultFileName,
  },
  workout: {
    rootDirectory: VAULT_LAYOUT.rawWorkoutsDirectory,
    resolveFileName: resolveDefaultFileName,
  },
  workout_batch: {
    rootDirectory: VAULT_LAYOUT.rawWorkoutsDirectory,
    resolveFileName: resolveDefaultFileName,
  },
});

function inferMediaType(fileName: string): string {
  const match = /\.([^.]+)$/u.exec(fileName);
  if (!match) {
    return "application/octet-stream";
  }

  return MEDIA_TYPES.get(`.${match[1].toLowerCase()}`) ?? "application/octet-stream";
}

function normalizeRawAssetOwner(owner: RawAssetOwner): RawAssetOwner {
  return rawAssetOwnerSchema.parse(owner);
}

function resolveRawAssetOwnerDefinition(owner: RawAssetOwner): RawAssetOwnerDefinition {
  return RAW_ASSET_OWNER_DEFINITIONS[owner.kind];
}

function resolveRawAssetOwnerPrefixSegments(owner: RawAssetOwner): string[] {
  const normalizedOwner = normalizeRawAssetOwner(owner);
  const definition = resolveRawAssetOwnerDefinition(normalizedOwner);
  const segments = definition.rootDirectory.split("/");

  if (RAW_ASSET_OWNER_PARTITION_KINDS.has(normalizedOwner.kind)) {
    segments.push(normalizedOwner.partition as string);
  }

  return segments;
}

function resolveRawRelativePath({
  owner,
  occurredAt,
  originalFileName,
  role,
  targetName,
}: {
  owner: RawAssetOwner;
  occurredAt: DateInput;
  originalFileName: string;
  role?: string;
  targetName?: string;
}): string {
  const rawDirectory = resolveRawAssetDirectory({ owner, occurredAt });
  const normalizedOwner = normalizeRawAssetOwner(owner);
  const safeFileName = resolveRawAssetOwnerDefinition(normalizedOwner).resolveFileName({
    originalFileName,
    role,
    targetName,
  });

  return `${rawDirectory}/${safeFileName}`;
}

export function resolveRawAssetDirectory({
  owner,
  occurredAt,
}: {
  owner: RawAssetOwner;
  occurredAt: DateInput;
}): string {
  const normalizedOwner = normalizeRawAssetOwner(owner);
  const timestamp = toIsoTimestamp(occurredAt, "occurredAt");
  const year = timestamp.slice(0, 4);
  const month = timestamp.slice(5, 7);

  return [...resolveRawAssetOwnerPrefixSegments(normalizedOwner), year, month, normalizedOwner.id].join("/");
}

export function inferRawAssetOwnerFromDirectory(rawDirectory: string): RawAssetOwner | null {
  let normalizedDirectory: string;

  try {
    normalizedDirectory = normalizeRelativeVaultPath(rawDirectory);
  } catch {
    return null;
  }

  const segments = normalizedDirectory.split("/");

  const hasYearMonth = (year: string | undefined, month: string | undefined): boolean =>
    /^\d{4}$/u.test(year ?? "") && /^\d{2}$/u.test(month ?? "");

  try {
    if (
      segments[0] === "raw"
      && segments[1] === "documents"
      && segments.length === 5
      && hasYearMonth(segments[2], segments[3])
    ) {
      return normalizeRawAssetOwner({
        kind: "document",
        id: segments[4] as string,
      });
    }

    if (
      segments[0] === "raw"
      && segments[1] === "assessments"
      && segments.length === 5
      && hasYearMonth(segments[2], segments[3])
    ) {
      return normalizeRawAssetOwner({
        kind: "assessment",
        id: segments[4] as string,
      });
    }

    if (
      segments[0] === "raw"
      && segments[1] === "measurements"
      && segments.length === 5
      && hasYearMonth(segments[2], segments[3])
    ) {
      return normalizeRawAssetOwner({
        kind: "measurement",
        id: segments[4] as string,
      });
    }

    if (
      segments[0] === "raw"
      && segments[1] === "meals"
      && segments.length === 5
      && hasYearMonth(segments[2], segments[3])
    ) {
      return normalizeRawAssetOwner({
        kind: "meal",
        id: segments[4] as string,
      });
    }

    if (segments[0] === "raw" && segments[1] === "workouts") {
      if (segments.length === 5 && hasYearMonth(segments[2], segments[3])) {
        return normalizeRawAssetOwner({
          kind: "workout",
          id: segments[4] as string,
        });
      }

      if (segments.length === 6 && hasYearMonth(segments[3], segments[4])) {
        return normalizeRawAssetOwner({
          kind: "workout_batch",
          partition: segments[2] as string,
          id: segments[5] as string,
        });
      }
    }

    if (
      segments[0] === "raw"
      && segments[1] === "samples"
      && segments.length === 6
      && hasYearMonth(segments[3], segments[4])
    ) {
      return normalizeRawAssetOwner({
        kind: "sample_batch",
        partition: segments[2] as string,
        id: segments[5] as string,
      });
    }

    if (
      segments[0] === "raw"
      && segments[1] === "integrations"
      && segments.length === 6
      && hasYearMonth(segments[3], segments[4])
    ) {
      return normalizeRawAssetOwner({
        kind: "device_batch",
        partition: segments[2] as string,
        id: segments[5] as string,
      });
    }
  } catch {
    return null;
  }

  return null;
}

export function rawDirectoryMatchesOwner(rawDirectory: string, owner: RawAssetOwner): boolean {
  let normalizedOwner: RawAssetOwner;

  try {
    normalizedOwner = normalizeRawAssetOwner(owner);
  } catch {
    return false;
  }

  const inferredOwner = inferRawAssetOwnerFromDirectory(rawDirectory);
  return inferredOwner !== null
    && inferredOwner.kind === normalizedOwner.kind
    && inferredOwner.id === normalizedOwner.id
    && inferredOwner.partition === normalizedOwner.partition;
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
  owner,
  occurredAt = new Date(),
  role,
  targetName,
}: PrepareRawArtifactInput): RawArtifact {
  const originalFileName = basenameFromFilePath(sourcePath);
  const relativePath = resolveRawRelativePath({
    owner,
    occurredAt,
    originalFileName,
    role,
    targetName,
  });

  return {
    relativePath,
    originalFileName,
    mediaType: inferMediaType(originalFileName),
  };
}

export function prepareInlineRawArtifact({
  fileName,
  owner,
  occurredAt = new Date(),
  role,
  targetName,
  mediaType,
}: PrepareInlineRawArtifactInput): RawArtifact {
  const originalFileName = basenameFromFilePath(fileName);
  const relativePath = resolveRawRelativePath({
    owner,
    occurredAt,
    originalFileName,
    role,
    targetName,
  });

  return {
    relativePath,
    originalFileName,
    mediaType: mediaType ?? inferMediaType(originalFileName),
  };
}
