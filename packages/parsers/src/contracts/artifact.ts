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
