import { z } from "zod";

import { assertCanonicalWritePort } from "./core-port.ts";
import type { DocumentImportPayload } from "./core-port.ts";
import {
  inspectFileAsset,
  optionalTimestampSchema,
  optionalTrimmedStringSchema,
  parseInputObject,
  requiredTrimmedStringSchema,
  stripUndefined,
} from "./shared.ts";

export interface DocumentImportInput {
  filePath: string;
  vaultRoot?: string;
  title?: string;
  occurredAt?: string | number | Date;
  note?: string;
  source?: string;
}

export interface ImporterExecutionOptions {
  corePort?: unknown;
}

const documentImportInputSchema = z
  .object({
    filePath: requiredTrimmedStringSchema("filePath"),
    vaultRoot: optionalTrimmedStringSchema("vaultRoot"),
    title: optionalTrimmedStringSchema("title"),
    occurredAt: optionalTimestampSchema("occurredAt"),
    note: optionalTrimmedStringSchema("note"),
    source: optionalTrimmedStringSchema("source"),
  })
  .passthrough();

export async function prepareDocumentImport(input: unknown): Promise<DocumentImportPayload> {
  const request = parseInputObject(
    input,
    "document import input",
    documentImportInputSchema,
  );
  const rawArtifact = await inspectFileAsset(request.filePath);

  return stripUndefined({
    vaultRoot: request.vaultRoot,
    sourcePath: rawArtifact.sourcePath,
    title: request.title ?? rawArtifact.fileName,
    occurredAt: request.occurredAt,
    note: request.note,
    source: request.source,
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
