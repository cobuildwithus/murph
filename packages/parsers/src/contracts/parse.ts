import type { ParserArtifactKind, ParserArtifactRef, ParserArtifactSummary } from "./artifact.js";

export type ParseIntent = "attachment_text";
export type ParseBlockKind =
  | "heading"
  | "line"
  | "list_item"
  | "page_break"
  | "paragraph"
  | "segment"
  | "table";

export interface ParsedBlock {
  id: string;
  kind: ParseBlockKind;
  text: string;
  order: number;
  page?: number | null;
  startMs?: number | null;
  endMs?: number | null;
  confidence?: number | null;
  metadata?: Record<string, unknown>;
}

export interface ParsedTable {
  id: string;
  page?: number | null;
  rows: string[][];
}

export interface ParseWarning {
  code: string;
  message: string;
}

export interface ParseOutputMetadata {
  language?: string | null;
  pageCount?: number | null;
  durationMs?: number | null;
  warnings?: ParseWarning[];
}

export interface ParseRequest {
  intent: ParseIntent;
  artifact: ParserArtifactRef;
  inputPath: string;
  preparedKind?: ParserArtifactKind;
  scratchDirectory: string;
}

export interface ProviderRunResult {
  text: string;
  markdown?: string | null;
  blocks?: ParsedBlock[];
  tables?: ParsedTable[];
  metadata?: ParseOutputMetadata;
}

export interface ParserOutput {
  schema: "healthybob.parser-output.v1";
  providerId: string;
  artifact: ParserArtifactSummary;
  text: string;
  markdown: string;
  blocks: ParsedBlock[];
  tables: ParsedTable[];
  metadata: ParseOutputMetadata;
  createdAt: string;
}
