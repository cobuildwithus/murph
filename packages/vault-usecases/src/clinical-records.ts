import { createHash } from "node:crypto";
import type { Dir } from "node:fs";
import { chmod, mkdir, open, opendir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
  CLINICAL_FHIR_RESOURCE_TYPES,
  CLINICAL_RECORD_COVERAGE_FILE_NAME,
  CLINICAL_RECORD_COVERAGE_MAX_BYTES,
  CLINICAL_RECORD_FAMILY_COVERAGE_STATUSES,
  CLINICAL_RAW_MANIFEST_MAX_RESOURCE_FILES,
  CLINICAL_RAW_MANIFEST_MAX_BYTES,
  CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES,
  CLINICAL_RAW_RESOURCE_FILES_MAX_TOTAL_BYTES,
  CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES,
  buildClinicalRecordCoverageSnapshot,
  clinicalFhirManifestPathSchema,
  clinicalFhirRetrievalScopeSchema,
  clinicalFhirRetrievalScopesSchema,
  clinicalFhirResourceTypeSchema,
  clinicalIsoDateTimeSchema,
  clinicalRecordCoveragePathForManifestPath,
  clinicalRecordCoveragePathSchema,
  clinicalRecordCoverageSnapshotSchema,
  clinicalSourceSystemSchema,
  clinicalRawManifestSchema,
  clinicalRawPathSchema,
  countClinicalFhirPageResources,
  type ClinicalFhirRetrievalScope,
  type ClinicalImportPlan,
  type ClinicalRecordCoverageSnapshot,
  type ClinicalRecordFamilyCoverage,
  type ClinicalRecordFamilyCoverageStatus,
  type ClinicalRawManifest,
  type ClinicalSourceSystem,
} from "@murphai/clinical-records";
import type { EventImportDecision } from "@murphai/contracts";
import {
  applyCanonicalWriteBatch,
  importEventBatch,
  isVaultError,
  resolveVaultPathOnDisk,
} from "@murphai/core";
import {
  resolveRuntimePaths,
  writeJsonFileAtomic,
} from "@murphai/runtime-state/node";
import { z } from "zod";

import { loadRuntimeModule } from "./runtime-import.js";

const CLINICAL_IMPORTER_MODULE_SPECIFIER = "@murphai/importers/clinical-records";
const JSON_MEDIA_TYPE = "application/fhir+json";
const CLINICAL_RETRIEVAL_CHECKPOINT_SCHEMA =
  "murph.clinical-retrieval-checkpoint.v1";
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const TERMINAL_CLINICAL_IMPORT_ERROR_CODES = new Set([
  "EVENT_KIND_MISMATCH",
  "EVENT_SOURCE_REVISION_CONFLICT",
  "EVENT_SOURCE_REVISION_UNORDERED",
  "VAULT_RAW_IMMUTABLE",
]);

type ClinicalImporterModule = {
  buildClinicalImportPlanFromSnapshot(input: {
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
  nextPageUrlHash?: string;
  pageUrlHash?: string;
  resourceType: string;
}

export interface ClinicalFhirSnapshotImportInput {
  assertCurrent?: () => Promise<void>;
  completedResourceTypes: string[];
  connectionId: string;
  errors?: Array<{
    code: string;
    message: string;
    resourceType?: string;
  }>;
  fetchedAt: string;
  fhirBaseUrlHash: string;
  grantedScopes: string[];
  pages: ClinicalFhirSnapshotPage[];
  patientIdHash: string;
  providerDirectoryEntryId?: string;
  requestedScopes: string[];
  retrievalJobId: string;
  retrievalScopes: ClinicalFhirRetrievalScope[];
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
  retrievalScopes: ClinicalFhirRetrievalScope[];
  runId: string;
  sourceSystem: ClinicalSourceSystem;
}

export interface ClinicalFhirRetrievalCheckpoint {
  authorizationRequired: boolean;
  completedResourceTypes: string[];
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
  manifestPath: string;
  rawFileCount: number;
  reviewDecisionCount: number;
}

export interface ClinicalRecordFamilyCoverageSummary {
  executableDecisionCount: number;
  resourceType: ClinicalRecordFamilyCoverage["resourceType"];
  retrievalCoverages: Array<NonNullable<ClinicalRecordFamilyCoverage["retrievalCoverage"]>>;
  returnedResourceCount: number;
  reviewDecisionCount: number;
  sourceCount: number;
  statuses: ClinicalRecordFamilyCoverageStatus[];
}

export interface ClinicalRecordCoverageReadResult {
  complete: boolean;
  families: ClinicalRecordFamilyCoverageSummary[];
  invalidSnapshotCount: number;
  latestFetchedAt: string | null;
  snapshotCount: number;
  truncated: boolean;
}

export const CLINICAL_RECORD_COVERAGE_MAX_SNAPSHOTS = 100;
const CLINICAL_RECORD_COVERAGE_MAX_DIRECTORY_ENTRIES = 1_000;
const CLINICAL_RECORD_COVERAGE_DIRECTORY_BUFFER_SIZE = 16;

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

const clinicalFhirRetrievalCheckpointSchema = z.object({
  authorizationRequired: z.boolean(),
  completedResourceTypes: z.array(clinicalFhirResourceTypeSchema)
    .max(CLINICAL_RAW_MANIFEST_MAX_RESOURCE_FILES),
  currentResourceIndex: z.number().int().nonnegative()
    .max(CLINICAL_RAW_MANIFEST_MAX_RESOURCE_FILES),
  cursor: z.string().min(1).max(2_048).nullable(),
  errors: z.array(z.object({
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(512),
    resourceType: clinicalFhirResourceTypeSchema.optional(),
  }).strict()).max(CLINICAL_RAW_MANIFEST_MAX_RESOURCE_FILES),
  identity: z.object({
    connectionId: z.string().min(1).max(120).regex(/^[A-Za-z0-9._-]+$/u),
    fetchedAt: clinicalIsoDateTimeSchema,
    fhirBaseUrlHash: z.string().regex(SHA256_HEX_PATTERN),
    generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    grantedScopes: z.array(z.string().min(1).max(200)).max(50),
    patientIdHash: z.string().regex(SHA256_HEX_PATTERN),
    providerDirectoryEntryId: z.string().min(1).max(120)
      .regex(/^[A-Za-z0-9._-]+$/u).optional(),
    requestedScopes: z.array(z.string().min(1).max(200)).max(50),
    retrievalJobId: z.string().min(1).max(120).regex(/^[A-Za-z0-9._-]+$/u),
    retrievalScopes: clinicalFhirRetrievalScopesSchema,
    runId: z.string().min(1).max(120).regex(/^[A-Za-z0-9._-]+$/u),
    sourceSystem: clinicalSourceSystemSchema,
  }).strict(),
  identityHash: z.string().regex(SHA256_HEX_PATTERN),
  pageFetchCount: z.number().int().nonnegative()
    .max(CLINICAL_RAW_MANIFEST_MAX_RESOURCE_FILES),
  pages: z.array(z.object({
    content: z.string(),
    nextPageUrlHash: z.string().regex(SHA256_HEX_PATTERN).optional(),
    pageUrlHash: z.string().regex(SHA256_HEX_PATTERN).optional(),
    resourceType: clinicalFhirResourceTypeSchema,
  }).strict()).max(CLINICAL_RAW_MANIFEST_MAX_RESOURCE_FILES),
  resourcePageStartIndex: z.number().int().nonnegative()
    .max(CLINICAL_RAW_MANIFEST_MAX_RESOURCE_FILES),
  schema: z.literal(CLINICAL_RETRIEVAL_CHECKPOINT_SCHEMA),
  seenCursors: z.array(z.string().min(1).max(2_048))
    .max(CLINICAL_RAW_MANIFEST_MAX_RESOURCE_FILES),
  seenPageUrlHashes: z.array(z.string().regex(SHA256_HEX_PATTERN))
    .max(CLINICAL_RAW_MANIFEST_MAX_RESOURCE_FILES),
  successfulPageCount: z.number().int().nonnegative()
    .max(CLINICAL_RAW_MANIFEST_MAX_RESOURCE_FILES),
  totalBodyBytes: z.number().int().nonnegative()
    .max(CLINICAL_RAW_RESOURCE_FILES_MAX_TOTAL_BYTES),
  totalResourceCount: z.number().int().nonnegative()
    .max(CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES),
}).strict();

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
  const identity = clinicalFhirRetrievalCheckpointSchema.shape.identity.parse(
    input.identity,
  );
  const parsed = clinicalFhirRetrievalCheckpointSchema.parse({
    ...input.checkpoint,
    identity,
    identityHash: hashClinicalFhirRetrievalCheckpointIdentity(identity),
    schema: CLINICAL_RETRIEVAL_CHECKPOINT_SCHEMA,
  });
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

export async function readClinicalRecordCoverage(input: {
  maxSnapshots?: number;
  shouldYield?: (() => boolean) | null;
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<ClinicalRecordCoverageReadResult> {
  const maxSnapshots = z.number().int().min(1)
    .max(CLINICAL_RECORD_COVERAGE_MAX_SNAPSHOTS)
    .parse(input.maxSnapshots ?? CLINICAL_RECORD_COVERAGE_MAX_SNAPSHOTS);
  const shouldYield = input.shouldYield ?? null;
  const signal = input.signal ?? null;
  assertClinicalRecordCoverageCanContinue({ shouldYield, signal });

  const listed = await listClinicalFhirManifestPaths({
    maxSnapshots,
    shouldYield,
    signal,
    vaultRoot: input.vaultRoot,
  });
  if (listed.manifestPaths.length === 0) {
    return buildClinicalRecordCoverageReadResult({
      invalidSnapshotCount: listed.invalidManifestPathCount,
      snapshots: [],
      truncated: listed.truncated,
    });
  }

  const snapshots: ClinicalRecordCoverageSnapshot[] = [];
  let invalidSnapshotCount = listed.invalidManifestPathCount;
  for (const manifestPath of listed.manifestPaths) {
    assertClinicalRecordCoverageCanContinue({ shouldYield, signal });
    try {
      const manifest = await readClinicalRawManifest({
        manifestPath,
        shouldYield,
        signal,
        vaultRoot: input.vaultRoot,
      });
      const persistedCoverage = await readPersistedClinicalRecordCoverage({
        manifest,
        manifestPath,
        shouldYield,
        signal,
        vaultRoot: input.vaultRoot,
      });
      snapshots.push(
        persistedCoverage ?? buildClinicalRecordCoverageSnapshot({
          manifest,
          plan: {
            schemaVersion: "murph.clinical-import-plan.v1",
            source: {
              kind: "fhir",
              rawManifestPath: manifestPath,
              sourceSystem: manifest.sourceSystem,
              connectionId: manifest.connectionId,
              retrievalJobId: manifest.retrievalJobId,
            },
            decisions: [],
          },
        }),
      );
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      assertClinicalRecordCoverageCanContinue({ shouldYield, signal });
      invalidSnapshotCount += 1;
    }
  }

  return buildClinicalRecordCoverageReadResult({
    invalidSnapshotCount,
    snapshots: selectLatestClinicalCoverageSnapshotsByConnection(snapshots),
    truncated: listed.truncated,
  });
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
  let plan: ClinicalImportPlan;
  let executableDecisions: EventImportDecision[];
  try {
    plan = importer.buildClinicalImportPlanFromSnapshot({
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
  const coverageSnapshot = buildClinicalRecordCoverageSnapshot({
    manifest: prepared.manifest,
    plan,
  });
  const coveragePath = clinicalRecordCoveragePathForManifestPath(
    prepared.manifestPath,
  );
  const rawContents = [
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
    {
      allowExistingMatch: true,
      content: `${JSON.stringify(coverageSnapshot, null, 2)}\n`,
      mediaType: "application/json",
      originalFileName: CLINICAL_RECORD_COVERAGE_FILE_NAME,
      targetRelativePath: coveragePath,
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
    manifestPath: prepared.manifestPath,
    rawFileCount: rawContents.length,
    reviewDecisionCount,
  };
}

async function listClinicalFhirManifestPaths(input: {
  maxSnapshots: number;
  shouldYield: (() => boolean) | null;
  signal: AbortSignal | null;
  vaultRoot: string;
}): Promise<{
  invalidManifestPathCount: number;
  manifestPaths: string[];
  truncated: boolean;
}> {
  const { absolutePath: clinicalRoot } = await resolveVaultPathOnDisk(
    input.vaultRoot,
    "raw/clinical/fhir",
  );
  assertClinicalRecordCoverageCanContinue(input);
  const connectionDirectory = await openClinicalCoverageDirectoryOrNull(
    clinicalRoot,
  );
  assertClinicalRecordCoverageCanContinue(input);
  if (!connectionDirectory) {
    return {
      invalidManifestPathCount: 0,
      manifestPaths: [],
      truncated: false,
    };
  }

  const manifestPaths: string[] = [];
  let invalidManifestPathCount = 0;
  let visitedDirectoryEntryCount = 0;
  let truncated = false;
  let stop = false;

  for await (const connectionEntry of connectionDirectory) {
    assertClinicalRecordCoverageCanContinue(input);
    if (
      visitedDirectoryEntryCount
      >= CLINICAL_RECORD_COVERAGE_MAX_DIRECTORY_ENTRIES
    ) {
      truncated = true;
      break;
    }
    visitedDirectoryEntryCount += 1;
    if (!connectionEntry.isDirectory()) {
      continue;
    }
    const connectionId = connectionEntry.name;
    const connectionPath = clinicalFhirManifestPathSchema.safeParse(
      `raw/clinical/fhir/${connectionId}/placeholder/manifest.json`,
    );
    if (!connectionPath.success) {
      invalidManifestPathCount += 1;
      continue;
    }
    const connectionRoot = path.join(clinicalRoot, connectionEntry.name);
    const retrievalDirectory = await openClinicalCoverageDirectoryOrNull(
      connectionRoot,
    );
    assertClinicalRecordCoverageCanContinue(input);
    if (!retrievalDirectory) {
      invalidManifestPathCount += 1;
      continue;
    }

    for await (const retrievalEntry of retrievalDirectory) {
      assertClinicalRecordCoverageCanContinue(input);
      if (
        visitedDirectoryEntryCount
        >= CLINICAL_RECORD_COVERAGE_MAX_DIRECTORY_ENTRIES
      ) {
        truncated = true;
        stop = true;
        break;
      }
      visitedDirectoryEntryCount += 1;
      if (!retrievalEntry.isDirectory()) {
        continue;
      }
      const manifestPath = clinicalFhirManifestPathSchema.safeParse(
        `raw/clinical/fhir/${connectionEntry.name}/${retrievalEntry.name}/manifest.json`,
      );
      if (!manifestPath.success) {
        invalidManifestPathCount += 1;
        continue;
      }
      if (!await isClinicalCoverageRegularFile({
        relativePath: manifestPath.data,
        vaultRoot: input.vaultRoot,
      })) {
        invalidManifestPathCount += 1;
        continue;
      }
      assertClinicalRecordCoverageCanContinue(input);
      if (manifestPaths.length >= input.maxSnapshots) {
        truncated = true;
        stop = true;
        break;
      }
      manifestPaths.push(manifestPath.data);
    }
    if (stop) {
      break;
    }
  }

  return {
    invalidManifestPathCount,
    manifestPaths: manifestPaths.sort((left, right) => left.localeCompare(right)),
    truncated,
  };
}

async function openClinicalCoverageDirectoryOrNull(
  directory: string,
): Promise<Dir | null> {
  try {
    return await opendir(directory, {
      bufferSize: CLINICAL_RECORD_COVERAGE_DIRECTORY_BUFFER_SIZE,
    });
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

async function isClinicalCoverageRegularFile(input: {
  relativePath: string;
  vaultRoot: string;
}): Promise<boolean> {
  try {
    const { absolutePath } = await resolveVaultPathOnDisk(
      input.vaultRoot,
      input.relativePath,
    );
    return (await stat(absolutePath)).isFile();
  } catch {
    return false;
  }
}

async function readClinicalRawManifest(input: {
  manifestPath: string;
  shouldYield: (() => boolean) | null;
  signal: AbortSignal | null;
  vaultRoot: string;
}): Promise<ClinicalRawManifest> {
  const manifestPath = clinicalFhirManifestPathSchema.parse(input.manifestPath);
  assertClinicalRecordCoverageCanContinue(input);
  const { absolutePath } = await resolveVaultPathOnDisk(input.vaultRoot, manifestPath);
  assertClinicalRecordCoverageCanContinue(input);
  const raw = await readBoundedClinicalCoverageTextFile({
    absolutePath,
    label: "Clinical FHIR raw manifest",
    maxBytes: CLINICAL_RAW_MANIFEST_MAX_BYTES,
    shouldYield: input.shouldYield,
    signal: input.signal,
  });
  return clinicalRawManifestSchema.parse(JSON.parse(raw));
}

async function readPersistedClinicalRecordCoverage(input: {
  manifest: ClinicalRawManifest;
  manifestPath: string;
  shouldYield: (() => boolean) | null;
  signal: AbortSignal | null;
  vaultRoot: string;
}): Promise<ClinicalRecordCoverageSnapshot | null> {
  const coveragePath = clinicalRecordCoveragePathForManifestPath(
    input.manifestPath,
  );
  const { absolutePath } = await resolveVaultPathOnDisk(
    input.vaultRoot,
    clinicalRecordCoveragePathSchema.parse(coveragePath),
  );
  assertClinicalRecordCoverageCanContinue(input);

  let raw: string;
  try {
    raw = await readBoundedClinicalCoverageTextFile({
      absolutePath,
      label: "Clinical FHIR coverage artifact",
      maxBytes: CLINICAL_RECORD_COVERAGE_MAX_BYTES,
      shouldYield: input.shouldYield,
      signal: input.signal,
    });
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
  const coverage = clinicalRecordCoverageSnapshotSchema.parse(JSON.parse(raw));
  assertClinicalRecordCoverageMatchesManifest({
    coverage,
    manifest: input.manifest,
  });
  return coverage;
}

async function readBoundedClinicalCoverageTextFile(input: {
  absolutePath: string;
  label: string;
  maxBytes: number;
  shouldYield: (() => boolean) | null;
  signal: AbortSignal | null;
}): Promise<string> {
  assertClinicalRecordCoverageCanContinue(input);
  const handle = await open(input.absolutePath, "r");
  try {
    assertClinicalRecordCoverageCanContinue(input);
    const fileStat = await handle.stat();
    if (!fileStat.isFile() || fileStat.size > input.maxBytes) {
      throw new TypeError(`${input.label} exceeds its supported bounds.`);
    }

    const bytes = Buffer.alloc(input.maxBytes + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      assertClinicalRecordCoverageCanContinue(input);
      const result = await handle.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        offset,
      );
      if (result.bytesRead === 0) {
        break;
      }
      offset += result.bytesRead;
    }
    assertClinicalRecordCoverageCanContinue(input);
    if (offset > input.maxBytes) {
      throw new TypeError(`${input.label} exceeds its supported bounds.`);
    }
    return bytes.subarray(0, offset).toString("utf8");
  } finally {
    await handle.close();
  }
}

function assertClinicalRecordCoverageMatchesManifest(input: {
  coverage: ClinicalRecordCoverageSnapshot;
  manifest: ClinicalRawManifest;
}): void {
  if (
    input.coverage.connectionId !== input.manifest.connectionId
    || input.coverage.retrievalJobId !== input.manifest.retrievalJobId
    || input.coverage.fetchedAt !== input.manifest.fetchedAt
  ) {
    throw new TypeError("Clinical FHIR coverage artifact does not match its manifest identity.");
  }

  for (const family of input.coverage.families) {
    const expectedReturnedResourceCount = input.manifest.resourceFiles
      .filter((resourceFile) => resourceFile.resourceType === family.resourceType)
      .reduce((sum, resourceFile) => sum + resourceFile.count, 0);
    const expectedRetrievalCoverage = input.manifest.retrievalScopes.find(
      (scope) => scope.resourceType === family.resourceType,
    )?.coverage ?? null;
    if (
      family.returnedResourceCount !== expectedReturnedResourceCount
      || family.retrievalCoverage !== expectedRetrievalCoverage
    ) {
      throw new TypeError("Clinical FHIR coverage artifact does not match its manifest evidence.");
    }
  }
}

function selectLatestClinicalCoverageSnapshotsByConnection(
  snapshots: readonly ClinicalRecordCoverageSnapshot[],
): ClinicalRecordCoverageSnapshot[] {
  const latestByConnection = new Map<string, ClinicalRecordCoverageSnapshot>();
  for (const snapshot of snapshots) {
    const current = latestByConnection.get(snapshot.connectionId);
    if (
      !current
      || snapshot.fetchedAt > current.fetchedAt
      || (
        snapshot.fetchedAt === current.fetchedAt
        && snapshot.retrievalJobId > current.retrievalJobId
      )
    ) {
      latestByConnection.set(snapshot.connectionId, snapshot);
    }
  }
  return [...latestByConnection.values()].sort((left, right) =>
    left.connectionId.localeCompare(right.connectionId)
  );
}

function buildClinicalRecordCoverageReadResult(input: {
  invalidSnapshotCount: number;
  snapshots: readonly ClinicalRecordCoverageSnapshot[];
  truncated: boolean;
}): ClinicalRecordCoverageReadResult {
  let latestFetchedAt: string | null = null;
  for (const snapshot of input.snapshots) {
    if (latestFetchedAt === null || snapshot.fetchedAt > latestFetchedAt) {
      latestFetchedAt = snapshot.fetchedAt;
    }
  }

  return {
    complete: input.invalidSnapshotCount === 0 && !input.truncated,
    families: CLINICAL_FHIR_RESOURCE_TYPES.map((resourceType) => {
      const familyCoverage = input.snapshots.flatMap((snapshot) =>
        snapshot.families.filter((family) => family.resourceType === resourceType)
      );
      const statusSet = new Set(
        familyCoverage.map((family) => family.status),
      );
      const statuses = CLINICAL_RECORD_FAMILY_COVERAGE_STATUSES.filter((status) =>
        statusSet.has(status)
      );
      const retrievalCoverageSet = new Set(
        familyCoverage.flatMap((family) =>
          family.retrievalCoverage === null ? [] : [family.retrievalCoverage]
        ),
      );
      const retrievalCoverages = (["whole-family", "bounded-window"] as const)
        .filter((coverage) => retrievalCoverageSet.has(coverage));
      return {
        executableDecisionCount: familyCoverage.reduce(
          (sum, family) => sum + family.executableDecisionCount,
          0,
        ),
        resourceType,
        retrievalCoverages,
        returnedResourceCount: familyCoverage.reduce(
          (sum, family) => sum + family.returnedResourceCount,
          0,
        ),
        reviewDecisionCount: familyCoverage.reduce(
          (sum, family) => sum + family.reviewDecisionCount,
          0,
        ),
        sourceCount: familyCoverage.length,
        statuses: statuses.length > 0 ? [...statuses] : ["unknown"],
      };
    }),
    invalidSnapshotCount: input.invalidSnapshotCount,
    latestFetchedAt,
    snapshotCount: input.snapshots.length,
    truncated: input.truncated,
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
    retrievalScopes: identity.retrievalScopes.map((scope) =>
      clinicalFhirRetrievalScopeSchema.parse(scope)
    ),
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
    || new Set(checkpoint.completedResourceTypes).size
      !== checkpoint.completedResourceTypes.length
    || new Set(checkpoint.seenCursors).size !== checkpoint.seenCursors.length
    || new Set(checkpoint.seenPageUrlHashes).size
      !== checkpoint.seenPageUrlHashes.length
  ) {
    throw new TypeError("Clinical FHIR retrieval checkpoint counters are inconsistent.");
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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function assertClinicalRecordCoverageCanContinue(input: {
  shouldYield: (() => boolean) | null;
  signal: AbortSignal | null;
}): void {
  if (input.signal?.aborted) {
    throw input.signal.reason instanceof Error
      ? input.signal.reason
      : new DOMException("Clinical coverage read aborted.", "AbortError");
  }
  if (input.shouldYield?.() === true) {
    throw new DOMException(
      "Clinical coverage read yielded to foreground work.",
      "AbortError",
    );
  }
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
  const ordinalsByResourceType = new Map<string, number>();
  let totalBytes = 0;
  const pages = input.pages.map((page) => {
    const resourceType = clinicalFhirResourceTypeSchema.parse(page.resourceType);
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

    const ordinal = (ordinalsByResourceType.get(resourceType) ?? 0) + 1;
    ordinalsByResourceType.set(resourceType, ordinal);
    const relativePath = `${resourceType}/page-${String(ordinal).padStart(4, "0")}.json`;
    return {
      ...page,
      rawPath: clinicalRawPathSchema.parse(
        `${path.posix.dirname(manifestPath)}/${relativePath}`,
      ),
      relativePath,
      resourceType,
    };
  });

  const manifest = clinicalRawManifestSchema.parse({
    schemaVersion: "murph.clinical-raw-manifest.v2",
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
    resourceFiles: pages.map((page) => ({
      resourceType: page.resourceType,
      relativePath: page.relativePath,
      count: countClinicalFhirPageResources(page.content),
      sha256: createHash("sha256").update(page.content, "utf8").digest("hex"),
      ...(page.pageUrlHash ? { pageUrlHash: page.pageUrlHash } : {}),
      ...(page.nextPageUrlHash ? { nextPageUrlHash: page.nextPageUrlHash } : {}),
    })),
    retrievalScopes: input.retrievalScopes,
    completedResourceTypes: input.completedResourceTypes,
    requestedScopes: input.requestedScopes,
    grantedScopes: input.grantedScopes,
    ...(input.errors ? { errors: input.errors } : {}),
  });

  return {
    manifest,
    manifestPath,
    pages,
  };
}
