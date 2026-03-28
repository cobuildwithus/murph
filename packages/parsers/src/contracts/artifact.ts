import { isVaultError, normalizeOpaquePathSegment } from "@murph/core";

export type ParserArtifactKind = "audio" | "document" | "image" | "other" | "video";

export interface ParserArtifactRef {
  captureId: string;
  attachmentId: string;
  kind: ParserArtifactKind;
  mime?: string | null;
  fileName?: string | null;
  storedPath: string;
  absolutePath: string;
  byteSize?: number | null;
  sha256?: string | null;
}

export interface ParserArtifactSummary {
  captureId: string;
  attachmentId: string;
  kind: ParserArtifactKind;
  mime?: string | null;
  fileName?: string | null;
  storedPath: string;
}

export function normalizeParserArtifactId(
  value: unknown,
  fieldName: "attachmentId" | "captureId",
): string {
  const label = fieldName === "captureId" ? "Parser capture ID" : "Parser attachment ID";

  try {
    return normalizeOpaquePathSegment(value, label);
  } catch (error) {
    if (error instanceof Error && isVaultError(error)) {
      throw new TypeError(error.message);
    }

    throw error;
  }
}

export function normalizeParserArtifactIdentity<T extends {
  attachmentId: string;
  captureId: string;
}>(artifact: T): T {
  return {
    ...artifact,
    captureId: normalizeParserArtifactId(artifact.captureId, "captureId"),
    attachmentId: normalizeParserArtifactId(artifact.attachmentId, "attachmentId"),
  } as T;
}
