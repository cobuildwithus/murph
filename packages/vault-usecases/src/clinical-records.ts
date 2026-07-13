import { createHash } from "node:crypto";
import path from "node:path";

import {
  CLINICAL_RAW_MANIFEST_MAX_RESOURCE_FILES,
  CLINICAL_RAW_RESOURCE_FILES_MAX_TOTAL_BYTES,
  CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES,
  clinicalFhirResourceTypeSchema,
  clinicalRawManifestSchema,
  clinicalRawPathSchema,
  countClinicalFhirPageResources,
  type ClinicalFhirRetrievalScope,
  type ClinicalImportPlan,
  type ClinicalRawManifest,
  type ClinicalSourceSystem,
} from "@murphai/clinical-records";
import type { EventImportDecision } from "@murphai/contracts";
import {
  applyCanonicalWriteBatch,
  importEventBatch,
} from "@murphai/core";

import { loadRuntimeModule } from "./runtime-import.js";

const CLINICAL_IMPORTER_MODULE_SPECIFIER = "@murphai/importers/clinical-records";
const JSON_MEDIA_TYPE = "application/fhir+json";

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
  sourceSystem: ClinicalSourceSystem;
  vaultRoot: string;
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

export async function importClinicalFhirSnapshot(
  input: ClinicalFhirSnapshotImportInput,
): Promise<ClinicalFhirSnapshotImportResult> {
  const prepared = prepareClinicalFhirSnapshot(input);
  const importer = await loadRuntimeModule<ClinicalImporterModule>(
    CLINICAL_IMPORTER_MODULE_SPECIFIER,
  );
  const plan = importer.buildClinicalImportPlanFromSnapshot({
    manifest: prepared.manifest,
    manifestPath: prepared.manifestPath,
    pages: prepared.pages.map((page) => ({
      content: page.content,
      relativePath: page.relativePath,
    })),
  });
  const executableDecisions = importer.clinicalPlanToEventImportDecisions(plan);
  const reviewDecisionCount = plan.decisions.filter(
    (decision) => decision.action === "review",
  ).length;
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
  ];

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

  const canonical = executableDecisions.length === 0
    ? {
        applied: false,
        createdCount: 0,
        retractedCount: 0,
        skippedExistingCount: 0,
        supersededCount: 0,
      }
    : await importEventBatch({
        apply: true,
        decisions: executableDecisions,
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
