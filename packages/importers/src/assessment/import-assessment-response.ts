import { basename } from "node:path";
import * as z from "@murphai/contracts/zod-runtime";
import { assessmentResponseSchema } from "@murphai/contracts";

import {
  inspectFileAsset,
  optionalTimestampSchema,
  optionalTrimmedStringSchema,
  parseInputObject,
  requiredTrimmedStringSchema,
  stripUndefined,
} from "../shared.ts";

import { assertAssessmentImportPort } from "./core-port.ts";

import type { AssessmentResponseImportPayload } from "./core-port.ts";

export interface AssessmentImporterExecutionOptions {
  corePort?: unknown;
}

export interface AssessmentResponseImportInput {
  filePath: string;
  vaultRoot?: string;
  title?: string;
  occurredAt?: string | number | Date;
  importedAt?: string | number | Date;
  source?: string;
  assessmentType?: string;
  questionnaireSlug?: string;
  relatedIds?: string[];
}

const assessmentResponseImportInputSchema = z
  .object({
    filePath: requiredTrimmedStringSchema("filePath"),
    vaultRoot: optionalTrimmedStringSchema("vaultRoot"),
    title: optionalTrimmedStringSchema("title"),
    occurredAt: optionalTimestampSchema("occurredAt"),
    importedAt: optionalTimestampSchema("importedAt"),
    source: optionalTrimmedStringSchema("source"),
    assessmentType: assessmentResponseSchema.shape.assessmentType.optional(),
    questionnaireSlug: assessmentResponseSchema.shape.questionnaireSlug,
    relatedIds: assessmentResponseSchema.shape.relatedIds,
  })
  .passthrough();

export async function prepareAssessmentResponseImport(
  input: unknown,
): Promise<AssessmentResponseImportPayload> {
  const request = parseInputObject(
    input,
    "assessment response import input",
    assessmentResponseImportInputSchema,
  );
  const rawArtifact = await inspectFileAsset(request.filePath, "assessment");

  return stripUndefined({
    vaultRoot: request.vaultRoot,
    sourcePath: rawArtifact.sourcePath,
    title: request.title ?? basename(rawArtifact.sourcePath),
    recordedAt: request.occurredAt,
    importedAt: request.importedAt,
    source: request.source,
    assessmentType: request.assessmentType,
    questionnaireSlug: request.questionnaireSlug,
    relatedIds: request.relatedIds,
  });
}

export async function importAssessmentResponse<TResult = unknown>(
  input: unknown,
  { corePort }: AssessmentImporterExecutionOptions = {},
): Promise<TResult> {
  const writer = assertAssessmentImportPort(corePort);
  const payload = await prepareAssessmentResponseImport(input);
  return (await writer.importAssessmentResponse(payload)) as TResult;
}
