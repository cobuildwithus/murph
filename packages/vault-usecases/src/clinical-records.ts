import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import {
  CLINICAL_RAW_MANIFEST_MAX_RESOURCE_FILES,
  CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES,
  CLINICAL_RAW_RESOURCE_FILES_MAX_TOTAL_BYTES,
  CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES,
  clinicalDocumentAttachmentsSchema,
  clinicalDocumentAttachmentIdentitySchema,
  decodeClinicalDocumentBase64,
  hashClinicalDocumentBytes,
  type ClinicalDocumentAttachment,
  clinicalFhirQueryScopeIdSchema,
  clinicalFhirRetrievalSliceRefSchema,
  clinicalFhirRetrievalSlicesSchema,
  clinicalFhirSliceIdSchema,
  clinicalFhirResourceTypeSchema,
  clinicalIsoDateTimeSchema,
  clinicalSourceSystemSchema,
  clinicalRawManifestSchema,
  clinicalRawPathSchema,
  countClinicalFhirPageResources,
  type ClinicalFhirRetrievalSlice,
  type ClinicalFhirRetrievalSliceRef,
  type ClinicalImportPlan,
  type ClinicalRawManifest,
  type ClinicalSourceSystem,
} from "@murphai/clinical-records";
import type { EventImportDecision } from "@murphai/contracts";
import {
  applyCanonicalWriteBatch,
  importEventBatch,
  isVaultError,
} from "@murphai/core";
import {
  resolveRuntimePaths,
  writeJsonFileAtomic,
} from "@murphai/runtime-state/node";
import * as z from "@murphai/contracts/zod-runtime";

import { extractClinicalDocumentText } from "./clinical-document-text.js";

import { loadRuntimeModule } from "./runtime-import.js";

const CLINICAL_IMPORTER_MODULE_SPECIFIER = "@murphai/importers/clinical-records";
const JSON_MEDIA_TYPE = "application/fhir+json";
const CLINICAL_RETRIEVAL_CHECKPOINT_SCHEMA =
  "murph.clinical-retrieval-checkpoint.v4";
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const TERMINAL_CLINICAL_IMPORT_ERROR_CODES = new Set([
  "EVENT_KIND_MISMATCH",
  "EVENT_SOURCE_REVISION_CONFLICT",
  "EVENT_SOURCE_REVISION_UNORDERED",
  "VAULT_RAW_IMMUTABLE",
]);

type ClinicalImporterModule = {
  buildClinicalImportPlanFromSnapshot(input: {
    attachments?: ClinicalFhirSnapshotAttachment[];
    previousBatch?: { manifestPath: string; manifestContent: string; page: { relativePath: string; content: string } };
    manifest: unknown;
    manifestPath: string;
    pages: ReadonlyArray<{
      content: string;
      relativePath: string;
    }>;
  }): ClinicalImportPlan;
  clinicalPlanToEventImportDecisions(
    input: ClinicalImportPlan,
  ): EventImportDecision[];
};

export interface ClinicalFhirSnapshotPage {
  content: string;
  pageUrlHash?: string;
  queryScopeId: string;
  resourceType: string;
  sliceId: string;
}

export interface ClinicalFhirSnapshotAttachment {
  relativePath: string;
  contentBase64: string;
  extractedText?: string;
}

export interface ClinicalFhirPendingDocument {
  parentPageSha256: string;
  resourceType: "DocumentReference" | "DiagnosticReport";
  resourceId: string;
  attachmentIndex: number;
  ticket: string | null;
  errorCode?: string;
}

export interface ClinicalFhirSnapshotImportInput {
  batch?: {
    runId: string; index: number;
    previous?: { manifestPath: string; sha256: string };
    continuesWith?: { queryScopeId: string; sliceId: string; pageUrlHash: string };
  };
  attachments?: ClinicalFhirSnapshotAttachment[];
  documentAttachments?: ClinicalDocumentAttachment[];
  assertCurrent?: () => Promise<void>;
  completedRetrievalSlices: ClinicalFhirRetrievalSliceRef[];
  connectionId: string;
  errors?: Array<{
    code: string;
    message: string;
    queryScopeId?: string;
    resourceType?: string;
    sliceId?: string;
  }>;
  fetchedAt: string;
  fhirBaseUrlHash: string;
  grantedScopes: string[];
  pages: ClinicalFhirSnapshotPage[];
  patientIdHash: string;
  providerDirectoryEntryId?: string;
  requestedScopes: string[];
  retrievalJobId: string;
  retrievalProtocol: "query-slices-v2";
  retrievalSlices: ClinicalFhirRetrievalSlice[];
  signal?: AbortSignal | null;
  sourceSystem: ClinicalSourceSystem;
  vaultRoot: string;
}

export interface ClinicalFhirRetrievalCheckpointIdentity {
  connectionId: string;
  fetchedAt: string;
  fhirBaseUrlHash: string;
  generation: number;
  grantedScopes: string[];
  patientIdHash: string;
  providerDirectoryEntryId?: string;
  requestedScopes: string[];
  retrievalJobId: string;
  retrievalProtocol: "query-slices-v2";
  retrievalSlices: ClinicalFhirRetrievalSlice[];
  runId: string;
  sourceSystem: ClinicalSourceSystem;
}

export interface ClinicalFhirRetrievalCheckpoint {
  batchIndex: number;
  previousBatch?: { manifestPath: string; sha256: string };
  importedCounts: { createdCount: number; executableDecisionCount: number; labResultCount: number; rawFileCount: number; retractedCount: number; reviewDecisionCount: number; skippedExistingCount: number; supersededCount: number; incompleteRevisionCount: number };
  attachments: ClinicalFhirSnapshotAttachment[];
  documentAttachments: ClinicalDocumentAttachment[];
  pendingDocuments: ClinicalFhirPendingDocument[];
  authorizationRequired: boolean;
  completedRetrievalSlices: ClinicalFhirRetrievalSliceRef[];
  currentResourceIndex: number;
  cursor: string | null;
  errors: NonNullable<ClinicalFhirSnapshotImportInput["errors"]>;
  pageFetchCount: number;
  pages: ClinicalFhirSnapshotPage[];
  resourcePageStartIndex: number;
  seenCursors: string[];
  seenPageUrlHashes: string[];
  successfulPageCount: number;
  totalBodyBytes: number;
  totalResourceCount: number;
}

export interface ClinicalFhirRetrievalCheckpointRecord {
  checkpoint: ClinicalFhirRetrievalCheckpoint;
  identity: ClinicalFhirRetrievalCheckpointIdentity;
}

export interface ClinicalFhirSnapshotImportResult {
  canonical: {
    applied: boolean;
    createdCount: number;
    retractedCount: number;
    skippedExistingCount: number;
    supersededCount: number;
  };
  executableDecisionCount: number;
  labResultCount: number;
  incompleteRevisionCount: number;
  manifestPath: string;
  manifestSha256: string;
  rawFileCount: number;
  reviewDecisionCount: number;
}

export class ClinicalFhirSnapshotRejectedError extends Error {
  readonly code = "CLINICAL_FHIR_SNAPSHOT_REJECTED" as const;

  constructor(cause: unknown) {
    super("Clinical FHIR snapshot failed semantic validation.", { cause });
    this.name = "ClinicalFhirSnapshotRejectedError";
  }
}

export class ClinicalFhirRetrievalCheckpointError extends Error {
  readonly code = "CLINICAL_FHIR_RETRIEVAL_CHECKPOINT_INVALID" as const;

  constructor(cause?: unknown) {
    super("Clinical FHIR retrieval checkpoint is invalid.", { cause });
    this.name = "ClinicalFhirRetrievalCheckpointError";
  }
}

const clinicalFhirRetrievalCheckpointIdentitySchema = z
  .object({
    connectionId: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9._-]+$/u),
    fetchedAt: clinicalIsoDateTimeSchema,
    fhirBaseUrlHash: z.string().regex(SHA256_HEX_PATTERN),
    generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    grantedScopes: z.array(z.string().min(1).max(200)).max(50),
    patientIdHash: z.string().regex(SHA256_HEX_PATTERN),
    providerDirectoryEntryId: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9._-]+$/u)
      .optional(),
    requestedScopes: z.array(z.string().min(1).max(200)).max(50),
    retrievalJobId: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9._-]+$/u),
    retrievalProtocol: z.literal("query-slices-v2"),
    retrievalSlices: clinicalFhirRetrievalSlicesSchema,
    runId: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9._-]+$/u),
    sourceSystem: clinicalSourceSystemSchema,
  })
  .strict();

const clinicalFhirRetrievalCheckpointSchema = z
  .object({
    batchIndex: z.number().int().nonnegative(),
    previousBatch: z.object({ manifestPath: clinicalRawPathSchema, sha256: z.string().regex(SHA256_HEX_PATTERN) }).strict().optional(),
    importedCounts: z.object({
      createdCount: z.number().int().nonnegative(), executableDecisionCount: z.number().int().nonnegative(),
      labResultCount: z.number().int().nonnegative(), rawFileCount: z.number().int().nonnegative(),
      retractedCount: z.number().int().nonnegative(), reviewDecisionCount: z.number().int().nonnegative(),
      skippedExistingCount: z.number().int().nonnegative(), supersededCount: z.number().int().nonnegative(),
      incompleteRevisionCount: z.number().int().nonnegative(),
    }).strict(),
    attachments: z.array(z.object({
      relativePath: z.string().regex(/^attachments\/[a-f0-9]{64}\.bin$/u),
      contentBase64: z.string(),
      extractedText: z.string().optional(),
    }).strict()).max(2_000),
    documentAttachments: clinicalDocumentAttachmentsSchema,
    pendingDocuments: z.array(clinicalDocumentAttachmentIdentitySchema.extend({
      ticket: z.string().min(1).max(16_384).nullable(),
      errorCode: z.string().min(1).max(128).optional(),
    }).strict()).max(2_000),
    authorizationRequired: z.boolean(),
    completedRetrievalSlices: z
      .array(clinicalFhirRetrievalSliceRefSchema)
      .max(CLINICAL_RAW_MANIFEST_MAX_RESOURCE_FILES),
    currentResourceIndex: z
      .number()
      .int()
      .nonnegative()
      .max(CLINICAL_RAW_MANIFEST_MAX_RESOURCE_FILES),
    cursor: z.string().min(1).max(2_048).nullable(),
    errors: z
      .array(
        z
          .object({
            code: z.string().min(1).max(128),
            message: z.string().min(1).max(512),
            queryScopeId: clinicalFhirQueryScopeIdSchema.optional(),
            resourceType: clinicalFhirResourceTypeSchema.optional(),
            sliceId: clinicalFhirSliceIdSchema.optional(),
          })
          .strict(),
      )
      .max(CLINICAL_RAW_MANIFEST_MAX_RESOURCE_FILES),
    identity: clinicalFhirRetrievalCheckpointIdentitySchema,
    identityHash: z.string().regex(SHA256_HEX_PATTERN),
    pageFetchCount: z.number().int().nonnegative(),
    pages: z
      .array(
        z
          .object({
            content: z.string(),
            pageUrlHash: z.string().regex(SHA256_HEX_PATTERN).optional(),
            queryScopeId: clinicalFhirQueryScopeIdSchema,
            resourceType: clinicalFhirResourceTypeSchema,
            sliceId: clinicalFhirSliceIdSchema,
          })
          .strict(),
      )
      .max(CLINICAL_RAW_MANIFEST_MAX_RESOURCE_FILES),
    resourcePageStartIndex: z
      .number()
      .int()
      .nonnegative()
      .max(CLINICAL_RAW_MANIFEST_MAX_RESOURCE_FILES),
    schema: z.literal(CLINICAL_RETRIEVAL_CHECKPOINT_SCHEMA),
    seenCursors: z.array(z.string().min(1).max(2_048)),
    seenPageUrlHashes: z.array(z.string().regex(SHA256_HEX_PATTERN)),
    successfulPageCount: z.number().int().nonnegative(),
    totalBodyBytes: z.number().int().nonnegative().max(CLINICAL_RAW_RESOURCE_FILES_MAX_TOTAL_BYTES),
    totalResourceCount: z
      .number()
      .int()
      .nonnegative()
      .max(CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES),
  })
  .strict()
  .superRefine((checkpoint, context) => {
    const slices = new Map(
      checkpoint.identity.retrievalSlices.map((slice) => [
        `${slice.queryScopeId}\n${slice.sliceId}`,
        slice,
      ]),
    );
    for (const item of [
      ...checkpoint.pages,
      ...checkpoint.completedRetrievalSlices,
      ...checkpoint.errors,
    ]) {
      if (
        "code" in item &&
        item.queryScopeId === undefined &&
        item.sliceId === undefined &&
        item.resourceType === undefined
      )
        continue;
      const slice = slices.get(`${item.queryScopeId}\n${item.sliceId}`);
      if (
        !slice ||
        ("resourceType" in item &&
          item.resourceType !== undefined &&
          item.resourceType !== slice.resourceType)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Checkpoint evidence must match its frozen retrieval slice.",
        });
      }
    }
    if (checkpoint.currentResourceIndex > slices.size) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Checkpoint position exceeds its retrieval plan.",
      });
    }
  });

export async function readClinicalFhirRetrievalCheckpoint(input: {
  identity: ClinicalFhirRetrievalCheckpointIdentity;
  vaultRoot: string;
}): Promise<ClinicalFhirRetrievalCheckpoint | null> {
  const record = await readClinicalFhirRetrievalCheckpointForRun(input);
  if (!record) {
    return null;
  }
  if (
    hashClinicalFhirRetrievalCheckpointIdentity(record.identity)
    !== hashClinicalFhirRetrievalCheckpointIdentity(input.identity)
  ) {
    throw new ClinicalFhirRetrievalCheckpointError(
      new TypeError("Clinical FHIR retrieval checkpoint identity changed."),
    );
  }
  return record.checkpoint;
}

export async function readClinicalFhirRetrievalCheckpointForRun(input: {
  identity: Pick<ClinicalFhirRetrievalCheckpointIdentity, "generation" | "runId">;
  vaultRoot: string;
}): Promise<ClinicalFhirRetrievalCheckpointRecord | null> {
  let raw: string;
  try {
    raw = await readFile(resolveClinicalFhirRetrievalCheckpointPath(input), "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }

  try {
    const parsed = clinicalFhirRetrievalCheckpointSchema.parse(JSON.parse(raw));
    if (
      parsed.identity.runId !== input.identity.runId
      || parsed.identity.generation !== input.identity.generation
      || parsed.identityHash !== hashClinicalFhirRetrievalCheckpointIdentity(parsed.identity)
    ) {
      throw new TypeError("Clinical FHIR retrieval checkpoint identity changed.");
    }
    assertClinicalFhirRetrievalCheckpointConsistent(parsed);
    const {
      identity,
      identityHash: _identityHash,
      schema: _schema,
      ...checkpoint
    } = parsed;
    return { checkpoint, identity };
  } catch (error) {
    throw new ClinicalFhirRetrievalCheckpointError(error);
  }
}

export async function writeClinicalFhirRetrievalCheckpoint(input: {
  checkpoint: ClinicalFhirRetrievalCheckpoint;
  identity: ClinicalFhirRetrievalCheckpointIdentity;
  vaultRoot: string;
}): Promise<void> {
  const identity = clinicalFhirRetrievalCheckpointIdentitySchema.parse(
    input.identity,
  );
  const checkpointRecord = {
    ...input.checkpoint,
    identity,
    identityHash: hashClinicalFhirRetrievalCheckpointIdentity(identity),
  };
  const parsed = clinicalFhirRetrievalCheckpointSchema.parse({ ...checkpointRecord, schema: CLINICAL_RETRIEVAL_CHECKPOINT_SCHEMA });
  assertClinicalFhirRetrievalCheckpointConsistent(parsed);
  const directory = resolveRuntimePaths(input.vaultRoot).clinicalRecordsRuntimeRoot;
  await mkdir(directory, { mode: 0o700, recursive: true });
  await chmod(directory, 0o700);
  await writeJsonFileAtomic(resolveClinicalFhirRetrievalCheckpointPath(input), parsed, {
    mode: 0o600,
  });
}

export async function clearClinicalFhirRetrievalCheckpoint(input: {
  identity: Pick<ClinicalFhirRetrievalCheckpointIdentity, "generation" | "runId">;
  vaultRoot: string;
}): Promise<void> {
  await rm(resolveClinicalFhirRetrievalCheckpointPath(input), { force: true });
}

export async function importClinicalFhirSnapshot(
  input: ClinicalFhirSnapshotImportInput,
): Promise<ClinicalFhirSnapshotImportResult> {
  await yieldClinicalFhirImportControl(input.signal ?? null);
  let prepared: ReturnType<typeof prepareClinicalFhirSnapshot>;
  try {
    prepared = prepareClinicalFhirSnapshot(input);
  } catch (error) {
    throw new ClinicalFhirSnapshotRejectedError(error);
  }
  await yieldClinicalFhirImportControl(input.signal ?? null);
  const importer = await loadRuntimeModule<ClinicalImporterModule>(
    CLINICAL_IMPORTER_MODULE_SPECIFIER,
  );
  input.signal?.throwIfAborted();
  const previousBatch = await readPreviousClinicalBatch(input);
  const attachmentFiles = await prepareClinicalDocumentExtraction(input);
  let plan: ClinicalImportPlan;
  let executableDecisions: EventImportDecision[];
  try {
    plan = importer.buildClinicalImportPlanFromSnapshot({
      attachments: attachmentFiles,
      ...(previousBatch ? { previousBatch } : {}),
      manifest: prepared.manifest,
      manifestPath: prepared.manifestPath,
      pages: prepared.pages.map((page) => ({
        content: page.content,
        relativePath: page.relativePath,
      })),
    });
    executableDecisions = importer.clinicalPlanToEventImportDecisions(plan);
  } catch (error) {
    throw new ClinicalFhirSnapshotRejectedError(error);
  }
  await yieldClinicalFhirImportControl(input.signal ?? null);
  await input.assertCurrent?.();
  input.signal?.throwIfAborted();
  const reviewDecisionCount = plan.decisions.filter(
    (decision) => decision.action === "review",
  ).length;
  const rawContents = [
    ...prepareClinicalDocumentRawContents(input, prepared.manifestPath),
    ...prepared.pages.map((page) => ({
      allowExistingMatch: true,
      content: page.content,
      mediaType: JSON_MEDIA_TYPE,
      originalFileName: path.posix.basename(page.relativePath),
      targetRelativePath: page.rawPath,
    })),
    {
      allowExistingMatch: true,
      content: `${JSON.stringify(prepared.manifest, null, 2)}\n`,
      mediaType: "application/json",
      originalFileName: "manifest.json",
      targetRelativePath: prepared.manifestPath,
    },
  ];

  try {
    await applyCanonicalWriteBatch({
      audit: {
        action: "raw_copy",
        commandName: "vault-usecases.importClinicalFhirSnapshot",
        summary: "Persisted an immutable clinical FHIR retrieval snapshot.",
      },
      operationType: "clinical_fhir_snapshot",
      rawContents,
      summary: "Persist clinical FHIR retrieval snapshot",
      vaultRoot: input.vaultRoot,
    });
  } catch (error) {
    rethrowClinicalFhirImportError(error);
  }

  await yieldClinicalFhirImportControl(input.signal ?? null);
  if (executableDecisions.length > 0) {
    await input.assertCurrent?.();
    input.signal?.throwIfAborted();
  }

  const canonical = executableDecisions.length === 0
    ? {
        applied: false,
        createdCount: 0,
        retractedCount: 0,
        skippedExistingCount: 0,
        supersededCount: 0,
      }
    : await importClinicalEventDecisions({
        decisions: executableDecisions,
        signal: input.signal,
        vaultRoot: input.vaultRoot,
      });

  return {
    canonical: {
      applied: canonical.applied,
      createdCount: canonical.createdCount,
      retractedCount: canonical.retractedCount,
      skippedExistingCount: canonical.skippedExistingCount,
      supersededCount: canonical.supersededCount,
    },
    executableDecisionCount: executableDecisions.length,
    labResultCount: plan.decisions.filter((decision) => decision.action === "upsert" && decision.payload.kind === "test" && decision.payload.testCategory === "laboratory").length,
    incompleteRevisionCount: plan.decisions.filter((decision) => decision.action === "review" && decision.disposition === "incomplete").length,
    manifestPath: prepared.manifestPath,
    manifestSha256: createHash("sha256").update(`${JSON.stringify(prepared.manifest, null, 2)}\n`, "utf8").digest("hex"),
    rawFileCount: rawContents.length,
    reviewDecisionCount,
  };
}

function resolveClinicalFhirRetrievalCheckpointPath(input: {
  identity: Pick<ClinicalFhirRetrievalCheckpointIdentity, "generation" | "runId">;
  vaultRoot: string;
}): string {
  const fileName = `${createHash("sha256")
    .update(`${input.identity.runId}\n${input.identity.generation}`, "utf8")
    .digest("hex")}.json`;
  return path.join(
    resolveRuntimePaths(input.vaultRoot).clinicalRecordsRuntimeRoot,
    fileName,
  );
}

function hashClinicalFhirRetrievalCheckpointIdentity(
  identity: ClinicalFhirRetrievalCheckpointIdentity,
): string {
  const normalized = {
    connectionId: identity.connectionId,
    fetchedAt: identity.fetchedAt,
    fhirBaseUrlHash: identity.fhirBaseUrlHash,
    generation: identity.generation,
    grantedScopes: [...identity.grantedScopes],
    patientIdHash: identity.patientIdHash,
    providerDirectoryEntryId: identity.providerDirectoryEntryId ?? null,
    requestedScopes: [...identity.requestedScopes],
    retrievalJobId: identity.retrievalJobId,
    retrievalProtocol: identity.retrievalProtocol,
    retrievalSlices: clinicalFhirRetrievalSlicesSchema.parse(identity.retrievalSlices),
    runId: identity.runId,
    sourceSystem: clinicalSourceSystemSchema.parse(identity.sourceSystem),
  };
  return createHash("sha256")
    .update(JSON.stringify(normalized), "utf8")
    .digest("hex");
}

function assertClinicalFhirRetrievalCheckpointConsistent(
  checkpoint: z.infer<typeof clinicalFhirRetrievalCheckpointSchema>,
): void {
  if (
    checkpoint.resourcePageStartIndex > checkpoint.pages.length
    || checkpoint.successfulPageCount < checkpoint.pages.length
    || checkpoint.pageFetchCount < checkpoint.successfulPageCount
    || (
      new Set(checkpoint.completedRetrievalSlices.map((slice) =>
        `${slice.queryScopeId}\n${slice.sliceId}`
      )).size !== checkpoint.completedRetrievalSlices.length
    )
    || new Set(checkpoint.seenCursors).size !== checkpoint.seenCursors.length
    || new Set(checkpoint.seenPageUrlHashes).size
      !== checkpoint.seenPageUrlHashes.length
  ) {
    throw new TypeError("Clinical FHIR retrieval checkpoint counters are inconsistent.");
  }

  const attachmentFiles = new Map(checkpoint.attachments.map((attachment) => [attachment.relativePath, attachment]));
  if (attachmentFiles.size !== checkpoint.attachments.length) throw new TypeError("Clinical checkpoint repeats document bytes.");
  for (const document of checkpoint.documentAttachments) {
    if (document.status !== "downloaded") continue;
    const file = attachmentFiles.get(document.relativePath);
    const bytes = file ? decodeClinicalDocumentBase64(file.contentBase64) : null;
    if (!bytes || bytes.length !== document.byteLength || hashClinicalDocumentBytes(bytes) !== document.sha256) throw new TypeError("Clinical checkpoint document integrity is invalid.");
  }
  let stagedBytes = 0;
  for (const page of checkpoint.pages) {
    const pageBytes = Buffer.byteLength(page.content, "utf8");
    if (pageBytes > CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES) {
      throw new TypeError("Clinical FHIR retrieval checkpoint page is too large.");
    }
    stagedBytes += pageBytes;
  }
  if (stagedBytes > checkpoint.totalBodyBytes) {
    throw new TypeError("Clinical FHIR retrieval checkpoint byte count is inconsistent.");
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === "ENOENT";
}

async function importClinicalEventDecisions(input: {
  decisions: EventImportDecision[];
  signal?: AbortSignal | null;
  vaultRoot: string;
}) {
  try {
    return await importEventBatch({
      apply: true,
      decisions: input.decisions,
      signal: input.signal,
      vaultRoot: input.vaultRoot,
    });
  } catch (error) {
    rethrowClinicalFhirImportError(error);
  }
}

function rethrowClinicalFhirImportError(error: unknown): never {
  if (isVaultError(error) && TERMINAL_CLINICAL_IMPORT_ERROR_CODES.has(error.code)) {
    throw new ClinicalFhirSnapshotRejectedError(error);
  }
  throw error;
}

async function yieldClinicalFhirImportControl(signal: AbortSignal | null): Promise<void> {
  signal?.throwIfAborted();
  if (!signal) {
    return;
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  signal.throwIfAborted();
}

function prepareClinicalFhirSnapshot(input: ClinicalFhirSnapshotImportInput): {
  manifest: ClinicalRawManifest;
  manifestPath: string;
  pages: Array<ClinicalFhirSnapshotPage & {
    rawPath: string;
    relativePath: string;
  }>;
} {
  if (input.pages.length > CLINICAL_RAW_MANIFEST_MAX_RESOURCE_FILES) {
    throw new TypeError(
      `Clinical FHIR snapshot exceeds ${CLINICAL_RAW_MANIFEST_MAX_RESOURCE_FILES} raw page files.`,
    );
  }

  const manifestPath = clinicalRawPathSchema.parse(
    `raw/clinical/fhir/${input.connectionId}/${input.retrievalJobId}/manifest.json`,
  );
  const ordinalsByRetrieval = new Map<string, number>();
  let totalBytes = 0;
  const pages = input.pages.map((page) => {
    const resourceType = clinicalFhirResourceTypeSchema.parse(page.resourceType);
    const queryScopeId = page.queryScopeId;
    const sliceId = page.sliceId;
    const byteSize = Buffer.byteLength(page.content, "utf8");
    if (byteSize > CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES) {
      throw new TypeError(
        `Clinical FHIR raw page exceeds ${CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES} bytes.`,
      );
    }
    totalBytes += byteSize;
    if (totalBytes > CLINICAL_RAW_RESOURCE_FILES_MAX_TOTAL_BYTES) {
      throw new TypeError(
        `Clinical FHIR raw pages exceed ${CLINICAL_RAW_RESOURCE_FILES_MAX_TOTAL_BYTES} total bytes.`,
      );
    }

    const retrievalKey = `${queryScopeId}\n${sliceId}`;
    const ordinal = (ordinalsByRetrieval.get(retrievalKey) ?? 0) + 1;
    ordinalsByRetrieval.set(retrievalKey, ordinal);
    const relativePath = `${queryScopeId}/${sliceId}/${resourceType}/page-${String(ordinal).padStart(4, "0")}.json`;
    return {
      ...page,
      rawPath: clinicalRawPathSchema.parse(
        `${path.posix.dirname(manifestPath)}/${relativePath}`,
      ),
      relativePath,
      queryScopeId,
      sliceId,
      resourceType,
    };
  });

  const manifestBase = {
    kind: "clinical_fhir_retrieval",
    connectionId: input.connectionId,
    retrievalJobId: input.retrievalJobId,
    ...(input.providerDirectoryEntryId
      ? { providerDirectoryEntryId: input.providerDirectoryEntryId }
      : {}),
    sourceSystem: input.sourceSystem,
    fhirBaseUrlHash: input.fhirBaseUrlHash,
    patientIdHash: input.patientIdHash,
    fetchedAt: input.fetchedAt,
    requestedScopes: input.requestedScopes,
    grantedScopes: input.grantedScopes,
  } as const;
  const resourceFiles = pages.map((page) => ({
    queryScopeId: page.queryScopeId,
    sliceId: page.sliceId,
    resourceType: page.resourceType,
    relativePath: page.relativePath,
    count: countClinicalFhirPageResources(page.content),
    sha256: createHash("sha256").update(page.content, "utf8").digest("hex"),
    ...(page.pageUrlHash ? { pageUrlHash: page.pageUrlHash } : {}),
  }));
  const manifest = clinicalRawManifestSchema.parse({
    ...manifestBase,
    schemaVersion: "murph.clinical-raw-manifest.v3",
    ...(input.batch ? { batch: input.batch } : {}),
    resourceFiles,
    retrievalSlices: input.retrievalSlices,
    completedRetrievalSlices: input.completedRetrievalSlices,
    ...(input.documentAttachments ? { documentAttachments: input.documentAttachments } : {}),
    ...(input.errors ? { errors: input.errors } : {}),
  });

  return {
    manifest,
    manifestPath,
    pages,
  };
}

function prepareClinicalDocumentRawContents(
  input: ClinicalFhirSnapshotImportInput,
  manifestPath: string,
) {
  const files = new Map((input.attachments ?? []).map((attachment) => [attachment.relativePath, attachment]));
  const prepared = new Map<string, { allowExistingMatch: true; content: Uint8Array; mediaType: string; originalFileName: string; targetRelativePath: string }>();
  for (const attachment of input.documentAttachments ?? []) {
    if (attachment.status !== "downloaded" || prepared.has(attachment.relativePath)) continue;
    const file = files.get(attachment.relativePath);
    const bytes = file ? decodeClinicalDocumentBase64(file.contentBase64) : null;
    if (!bytes || bytes.length !== attachment.byteLength || hashClinicalDocumentBytes(bytes) !== attachment.sha256) {
      throw new ClinicalFhirSnapshotRejectedError(new TypeError("Clinical document bytes do not match the manifest."));
    }
    prepared.set(attachment.relativePath, {
      allowExistingMatch: true,
      content: bytes,
      mediaType: attachment.mediaType,
      originalFileName: path.posix.basename(attachment.relativePath),
      targetRelativePath: clinicalRawPathSchema.parse(`${path.posix.dirname(manifestPath)}/${attachment.relativePath}`),
    });
  }
  return [...prepared.values()];
}

async function readPreviousClinicalBatch(input: ClinicalFhirSnapshotImportInput) {
  if (!input.batch?.previous) return undefined;
  const previous = input.batch.previous;
  const expectedPath = `raw/clinical/fhir/${input.connectionId}/${input.batch.runId}-batch-${input.batch.index - 1}/manifest.json`;
  if (previous.manifestPath !== expectedPath) throw new ClinicalFhirSnapshotRejectedError(new TypeError("Clinical batch predecessor path is invalid."));
  const manifestContent = await readFile(path.join(input.vaultRoot, clinicalRawPathSchema.parse(previous.manifestPath)), "utf8");
  if (createHash("sha256").update(manifestContent, "utf8").digest("hex") !== previous.sha256) throw new ClinicalFhirSnapshotRejectedError(new TypeError("Clinical batch predecessor digest is invalid."));
  const manifest = clinicalRawManifestSchema.parse(JSON.parse(manifestContent));
  if (manifest.resourceFiles.length !== 1) throw new ClinicalFhirSnapshotRejectedError(new TypeError("Clinical batch predecessor page is invalid."));
  const relativePath = manifest.resourceFiles[0]!.relativePath;
  const content = await readFile(path.join(input.vaultRoot, path.posix.dirname(previous.manifestPath), relativePath), "utf8");
  return { manifestPath: previous.manifestPath, manifestContent, page: { relativePath, content } };
}

async function prepareClinicalDocumentExtraction(input: ClinicalFhirSnapshotImportInput): Promise<ClinicalFhirSnapshotAttachment[]> {
  const files: ClinicalFhirSnapshotAttachment[] = [];
  for (const attachment of input.attachments ?? []) {
    input.signal?.throwIfAborted();
    const evidence = input.documentAttachments?.find((document) => document.status === "downloaded" && document.relativePath === attachment.relativePath);
    if (!evidence || evidence.status !== "downloaded") throw new ClinicalFhirSnapshotRejectedError(new TypeError("Clinical document has no bound evidence."));
    const bytes = decodeClinicalDocumentBase64(attachment.contentBase64);
    if (!bytes || hashClinicalDocumentBytes(bytes) !== evidence.sha256 || bytes.length !== evidence.byteLength) throw new ClinicalFhirSnapshotRejectedError(new TypeError("Clinical document integrity validation failed."));
    const extractedText = attachment.extractedText ?? await extractClinicalDocumentText({ bytes, mediaType: evidence.mediaType, signal: input.signal, vaultRoot: input.vaultRoot });
    files.push({ ...attachment, ...(extractedText ? { extractedText } : {}) });
  }
  return files;
}
