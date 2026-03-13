import { assertCanonicalWritePort } from "./core-port.js";
import type { DocumentImportPayload } from "./core-port.js";
import {
  assertPlainObject,
  inspectFileAsset,
  normalizeOptionalString,
  normalizeTimestamp,
  stripUndefined,
} from "./shared.js";

export interface DocumentImportInput {
  filePath: string;
  vaultRoot?: string;
  vault?: string;
  title?: string;
  occurredAt?: string | number | Date;
  note?: string;
  source?: string;
}

export interface ImporterExecutionOptions {
  corePort?: unknown;
}

export async function prepareDocumentImport(input: unknown): Promise<DocumentImportPayload> {
  const request = assertPlainObject(input, "document import input");
  const rawArtifact = await inspectFileAsset(request.filePath);

  return stripUndefined({
    vaultRoot: normalizeOptionalString(request.vaultRoot ?? request.vault, "vaultRoot"),
    sourcePath: rawArtifact.sourcePath,
    title: normalizeOptionalString(request.title, "title") ?? rawArtifact.fileName,
    occurredAt: normalizeTimestamp(request.occurredAt, "occurredAt"),
    note: normalizeOptionalString(request.note, "note"),
    source: normalizeOptionalString(request.source, "source"),
  });
}

export async function importDocument<TResult = unknown>(
  input: unknown,
  { corePort }: ImporterExecutionOptions = {},
): Promise<TResult> {
  const writer = assertCanonicalWritePort(corePort, ["importDocument"]);
  const payload = await prepareDocumentImport(input);
  return (await writer.importDocument(payload)) as TResult;
}
