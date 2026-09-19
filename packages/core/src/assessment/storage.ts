import { basename } from "node:path";
import { readFile } from "node:fs/promises";

import {
  assessmentResponseSchema,
  jsonObjectSchema,
  safeParseContract,
} from "@murphai/contracts";

import * as z from "@murphai/contracts/zod-runtime";

import { buildAuditRecord, resolveAuditShardPath } from "../audit.ts";
import { generateRecordId } from "../ids.ts";
import { readJsonlRecords, toMonthlyShardRelativePath } from "../jsonl.ts";
import { walkVaultFiles } from "../fs.ts";
import { stageRawImportManifest } from "../operations/raw-manifests.ts";
import { WriteBatch } from "../operations/write-batch.ts";
import { prepareRawArtifact } from "../raw.ts";
import { compareIsoTimestampsAscending, toIsoTimestamp } from "../time.ts";
import { VaultError } from "../errors.ts";

import type { UnknownRecord } from "../types.ts";
import type {
  AssessmentResponseRecord,
  ImportAssessmentResponseInput,
  ImportAssessmentResponseResult,
} from "./types.ts";
import { ASSESSMENT_LEDGER_DIRECTORY, ASSESSMENT_RESPONSE_SCHEMA_VERSION } from "./types.ts";

interface ReadAssessmentResponseInput {
  vaultRoot: string;
  assessmentId: string;
}

interface ListAssessmentResponsesInput {
  vaultRoot: string;
}

function parseAssessmentResponse(content: string): UnknownRecord {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new VaultError("ASSESSMENT_INVALID_JSON", "Assessment response must be valid JSON.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const result = safeParseContract(jsonObjectSchema, parsed);

  if (!result.success) {
    throw new VaultError("ASSESSMENT_INVALID_JSON", "Assessment response root must be a plain object.");
  }

  return result.data;
}

// Old ledger readers accepted arbitrary string links and discarded unknown
// fields. Keep that read compatibility without weakening new canonical writes.
const storedAssessmentResponseSchema = assessmentResponseSchema
  .extend({ relatedIds: z.array(z.string()).optional() })
  .strip();

function toAssessmentResponseRecord(
  value: unknown,
  schema: z.ZodType<AssessmentResponseRecord> = assessmentResponseSchema,
): AssessmentResponseRecord {
  const result = safeParseContract(schema, value);
  if (!result.success) {
    throw new VaultError("ASSESSMENT_RESPONSE_INVALID", "Assessment response record failed contract validation.", {
      errors: result.errors,
    });
  }
  return result.data;
}

function sortAssessmentResponses(records: readonly AssessmentResponseRecord[]): AssessmentResponseRecord[] {
  return [...records].sort((left, right) => {
    if (left.recordedAt !== right.recordedAt) {
      return compareIsoTimestampsAscending(left.recordedAt, right.recordedAt);
    }
    return left.id.localeCompare(right.id);
  });
}

export async function importAssessmentResponse({
  vaultRoot,
  sourcePath,
  assessmentType,
  title,
  recordedAt,
  importedAt,
  source,
  questionnaireSlug,
  relatedIds,
}: ImportAssessmentResponseInput): Promise<ImportAssessmentResponseResult> {
  const recordedTimestamp = toIsoTimestamp(recordedAt ?? importedAt ?? new Date(), "recordedAt");
  const id = generateRecordId("asmt");
  const content = await readFile(sourcePath, "utf8");
  const responses = parseAssessmentResponse(content);
  const raw = prepareRawArtifact({
    sourcePath,
    owner: {
      kind: "assessment",
      id,
    },
    occurredAt: recordedTimestamp,
  });
  const batch = await WriteBatch.create({
    vaultRoot,
    operationType: "assessment_import",
    summary: `Import assessment ${id}`,
    occurredAt: recordedTimestamp,
  });
  const stagedRaw = await batch.stageRawCopy({
    sourcePath,
    targetRelativePath: raw.relativePath,
    originalFileName: raw.originalFileName,
    mediaType: raw.mediaType,
  });

  const assessment = toAssessmentResponseRecord({
    schemaVersion: ASSESSMENT_RESPONSE_SCHEMA_VERSION,
    id,
    assessmentType:
      typeof assessmentType === "string" && assessmentType.trim() ? assessmentType.trim() : "intake",
    recordedAt: recordedTimestamp,
    source: source ?? "import",
    rawPath: raw.relativePath,
    title: typeof title === "string" && title.trim() ? title.trim() : basename(sourcePath),
    questionnaireSlug:
      typeof questionnaireSlug === "string" && questionnaireSlug.trim()
        ? questionnaireSlug.trim()
        : undefined,
    responses,
    relatedIds:
      relatedIds && relatedIds.length > 0
        ? [...new Set(relatedIds.map((entry) => entry.trim()).filter(Boolean))]
        : undefined,
  });

  const ledgerPath = toMonthlyShardRelativePath(
    ASSESSMENT_LEDGER_DIRECTORY,
    recordedTimestamp,
    "recordedAt",
  );

  const manifestPath = await stageRawImportManifest({
    batch,
    importId: assessment.id,
    importKind: "assessment",
    importedAt: assessment.recordedAt,
    owner: {
      kind: "assessment",
      id: assessment.id,
    },
    source: assessment.source ?? source ?? null,
    artifacts: [
      {
        role: "source_assessment",
        raw: stagedRaw,
      },
    ],
    provenance: {
      assessmentType: assessment.assessmentType,
      title: assessment.title ?? null,
      questionnaireSlug: assessment.questionnaireSlug ?? null,
      relatedIds: assessment.relatedIds ?? [],
      lookupId: assessment.id,
      ledgerFile: ledgerPath,
    },
  });
  await batch.stageJsonlAppend(ledgerPath, `${JSON.stringify(assessment)}\n`);

  const audit = buildAuditRecord({
    action: "intake_import",
    commandName: "core.importAssessmentResponse",
    summary: `Imported assessment ${assessment.id}.`,
    occurredAt: recordedTimestamp,
    targetIds: [assessment.id],
    changes: [
      {
        path: raw.relativePath,
        op: "copy",
      },
      {
        path: ledgerPath,
        op: "append",
      },
      {
        path: manifestPath,
        op: "create",
      },
    ],
  });
  const auditPath = resolveAuditShardPath(audit.occurredAt);
  await batch.stageJsonlAppend(auditPath, `${JSON.stringify(audit)}\n`);
  await batch.commit();

  return {
    assessment,
    raw,
    ledgerPath,
    auditPath,
    manifestPath,
  };
}

export async function listAssessmentResponses({
  vaultRoot,
}: ListAssessmentResponsesInput): Promise<AssessmentResponseRecord[]> {
  const shardPaths = await walkVaultFiles(vaultRoot, ASSESSMENT_LEDGER_DIRECTORY, {
    extension: ".jsonl",
  });
  const records: AssessmentResponseRecord[] = [];

  for (const shardPath of shardPaths) {
    const shardRecords = await readJsonlRecords({
      vaultRoot,
      relativePath: shardPath,
    });

    records.push(...shardRecords.map((record) => toAssessmentResponseRecord(record, storedAssessmentResponseSchema)));
  }

  return sortAssessmentResponses(records);
}

export async function readAssessmentResponse({
  vaultRoot,
  assessmentId,
}: ReadAssessmentResponseInput): Promise<AssessmentResponseRecord> {
  const records = await listAssessmentResponses({ vaultRoot });
  const match = records.find((record) => record.id === assessmentId);

  if (!match) {
    throw new VaultError("ASSESSMENT_RESPONSE_NOT_FOUND", `Assessment response "${assessmentId}" was not found.`, {
      assessmentId,
    });
  }

  return match;
}
