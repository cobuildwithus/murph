import type {
  HostedExecutionClinicalRecordsSyncRequestedWake,
} from "@murphai/hosted-execution/contracts";
import {
  CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE,
  CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES,
  CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES,
  clinicalFhirRetrievalScopeSchema,
  clinicalSourceSystemSchema,
  countClinicalFhirPageResources,
} from "@murphai/clinical-records";
import {
  HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE,
  HOSTED_CLINICAL_RECORDS_MAX_PAGES,
  HOSTED_CLINICAL_RECORDS_MAX_TOTAL_BODY_BYTES,
  parseHostedClinicalRecordsFetchPageResponse,
  parseHostedClinicalRecordsReadRunResponse,
  type HostedClinicalRecordsOutcomeCounts,
  type HostedClinicalRecordsRunDescriptor,
} from "@murphai/hosted-execution/clinical-records";
import type {
  ClinicalFhirSnapshotImportInput,
  ClinicalFhirSnapshotImportResult,
} from "@murphai/vault-usecases/clinical-records";

import type {
  HostedRuntimeClinicalRecordsPort,
} from "./platform.ts";

const CLINICAL_RECORDS_VAULT_MODULE_SPECIFIER =
  "@murphai/vault-usecases/clinical-records";

type ClinicalRecordsVaultModule = {
  importClinicalFhirSnapshot(
    input: ClinicalFhirSnapshotImportInput,
  ): Promise<ClinicalFhirSnapshotImportResult>;
};

export interface HostedClinicalRecordsSyncMetrics {
  counts: HostedClinicalRecordsOutcomeCounts;
  status: "completed" | "failed" | "partial" | "unavailable";
}

export async function runHostedClinicalRecordsSyncWakeLane(input: {
  clinicalRecordsPort?: HostedRuntimeClinicalRecordsPort | null;
  importSnapshot?: ClinicalRecordsVaultModule["importClinicalFhirSnapshot"];
  shouldYieldClinicalRecords?: (() => boolean) | null;
  vaultRoot: string;
  wake: HostedExecutionClinicalRecordsSyncRequestedWake;
}): Promise<HostedClinicalRecordsSyncMetrics> {
  const port = input.clinicalRecordsPort;
  if (!port) {
    throw new HostedClinicalRecordsRuntimeError(
      "CLINICAL_RECORDS_PORT_NOT_CONFIGURED",
      "Hosted clinical records sync requires a configured runtime port.",
    );
  }

  const readResponse = parseHostedClinicalRecordsReadRunResponse(await port.readRun({
    generation: input.wake.generation,
    runId: input.wake.runId,
  }));
  if (readResponse.status === "unavailable") {
    if (readResponse.retryable) {
      throw new HostedClinicalRecordsRuntimeError(
        "CLINICAL_RECORDS_RUN_RETRYABLE",
        "Hosted clinical records run is temporarily unavailable.",
      );
    }
    return {
      counts: emptyCounts(),
      status: "unavailable",
    };
  }

  const run = readResponse.run;
  assertRunMatchesWake(run, input.wake);
  await preemptIfRequested({
    counts: emptyCounts(),
    port,
    shouldYield: input.shouldYieldClinicalRecords ?? null,
    wake: input.wake,
  });
  const retrievalScopes = run.retrievalScopes.map((scope) =>
    clinicalFhirRetrievalScopeSchema.parse(scope)
  );
  const pages: ClinicalFhirSnapshotImportInput["pages"] = [];
  const completedResourceTypes: string[] = [];
  const errors: NonNullable<ClinicalFhirSnapshotImportInput["errors"]> = [];
  let pageFetchCount = 0;
  let successfulPageCount = 0;
  let totalBodyBytes = 0;
  let totalResourceCount = 0;
  let authorizationRequired = false;

  for (const [resourceIndex, scope] of retrievalScopes.entries()) {
    await preemptIfRequested({
      counts: fetchCounts(successfulPageCount, completedResourceTypes.length),
      port,
      shouldYield: input.shouldYieldClinicalRecords ?? null,
      wake: input.wake,
    });
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    let completed = false;
    let resourceBodyBytes = 0;
    let resourceRecordCount = 0;
    const resourcePageStartIndex = pages.length;

    while (!completed) {
      await preemptIfRequested({
        counts: fetchCounts(successfulPageCount, completedResourceTypes.length),
        port,
        shouldYield: input.shouldYieldClinicalRecords ?? null,
        wake: input.wake,
      });
      if (pageFetchCount >= HOSTED_CLINICAL_RECORDS_MAX_PAGES) {
        return await recordTerminalFailure({
          counts: fetchCounts(successfulPageCount, completedResourceTypes.length),
          errorCode: "page_limit_exceeded",
          port,
          wake: input.wake,
        });
      }
      if (cursor && seenCursors.has(cursor)) {
        return await recordTerminalFailure({
          counts: fetchCounts(successfulPageCount, completedResourceTypes.length),
          errorCode: "cursor_cycle",
          port,
          wake: input.wake,
        });
      }
      if (cursor) {
        seenCursors.add(cursor);
      }

      const response = parseHostedClinicalRecordsFetchPageResponse(await port.fetchPage({
        cursor,
        generation: run.generation,
        requestId: `cr-${run.generation}-${resourceIndex + 1}-${seenCursors.size + 1}`,
        resourceType: scope.resourceType,
        runId: run.runId,
      }));
      pageFetchCount += 1;
      if (response.status === "unavailable") {
        if (response.retryable) {
          throw new HostedClinicalRecordsRuntimeError(
            "CLINICAL_RECORDS_PAGE_RETRYABLE",
            "Hosted clinical records page is temporarily unavailable.",
          );
        }
        errors.push({
          code: response.errorCode,
          message: "Provider did not return this FHIR resource family.",
          resourceType: scope.resourceType,
        });
        authorizationRequired = response.errorCode
          === HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE;
        pages.splice(resourcePageStartIndex);
        totalBodyBytes -= resourceBodyBytes;
        totalResourceCount -= resourceRecordCount;
        break;
      }
      successfulPageCount += 1;

      const pageBodyBytes = Buffer.byteLength(response.body, "utf8");
      if (pageBodyBytes > CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES) {
        return await recordTerminalFailure({
          counts: fetchCounts(successfulPageCount, completedResourceTypes.length),
          errorCode: "page_size_exceeded",
          port,
          wake: input.wake,
        });
      }
      let pageResourceCount: number;
      try {
        pageResourceCount = countClinicalFhirPageResources(response.body);
      } catch {
        return await recordTerminalFailure({
          counts: fetchCounts(successfulPageCount, completedResourceTypes.length),
          errorCode: "invalid_fhir_page",
          port,
          wake: input.wake,
        });
      }
      if (pageResourceCount > CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE) {
        return await recordTerminalFailure({
          counts: fetchCounts(successfulPageCount, completedResourceTypes.length),
          errorCode: "page_resource_limit_exceeded",
          port,
          wake: input.wake,
        });
      }
      if (
        totalResourceCount + pageResourceCount
        > CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES
      ) {
        return await recordTerminalFailure({
          counts: fetchCounts(successfulPageCount, completedResourceTypes.length),
          errorCode: "snapshot_resource_limit_exceeded",
          port,
          wake: input.wake,
        });
      }
      totalResourceCount += pageResourceCount;
      resourceRecordCount += pageResourceCount;
      resourceBodyBytes += pageBodyBytes;
      totalBodyBytes += pageBodyBytes;
      if (totalBodyBytes > HOSTED_CLINICAL_RECORDS_MAX_TOTAL_BODY_BYTES) {
        return await recordTerminalFailure({
          counts: fetchCounts(successfulPageCount, completedResourceTypes.length),
          errorCode: "snapshot_size_exceeded",
          port,
          wake: input.wake,
        });
      }
      pages.push({
        content: response.body,
        ...(response.nextPageUrlHash
          ? { nextPageUrlHash: response.nextPageUrlHash }
          : {}),
        ...(response.pageUrlHash ? { pageUrlHash: response.pageUrlHash } : {}),
        resourceType: scope.resourceType,
      });
      cursor = response.nextCursor;
      completed = cursor === null;
    }

    if (completed) {
      completedResourceTypes.push(scope.resourceType);
    }
    if (authorizationRequired) {
      for (const remainingScope of retrievalScopes.slice(resourceIndex + 1)) {
        errors.push({
          code: "not-attempted",
          message: "Retrieval was not attempted after provider authorization ended.",
          resourceType: remainingScope.resourceType,
        });
      }
      break;
    }
  }

  const importSnapshot = input.importSnapshot
    ?? (await loadRuntimeModule<ClinicalRecordsVaultModule>(
      CLINICAL_RECORDS_VAULT_MODULE_SPECIFIER,
    )).importClinicalFhirSnapshot;
  const result = await importSnapshot({
    completedResourceTypes,
    connectionId: run.connectionId,
    ...(errors.length > 0 ? { errors } : {}),
    fetchedAt: run.fetchedAt,
    fhirBaseUrlHash: run.fhirBaseUrlHash,
    grantedScopes: run.grantedScopes,
    pages,
    patientIdHash: run.patientIdHash,
    ...(run.providerDirectoryEntryId
      ? { providerDirectoryEntryId: run.providerDirectoryEntryId }
      : {}),
    requestedScopes: run.requestedScopes,
    retrievalJobId: run.retrievalJobId,
    retrievalScopes,
    sourceSystem: clinicalSourceSystemSchema.parse(run.sourceSystem),
    vaultRoot: input.vaultRoot,
  });
  const counts: HostedClinicalRecordsOutcomeCounts = {
    createdCount: result.canonical.createdCount,
    executableDecisionCount: result.executableDecisionCount,
    fetchedPageCount: successfulPageCount,
    fetchedResourceFamilyCount: completedResourceTypes.length,
    rawFileCount: result.rawFileCount,
    retractedCount: result.canonical.retractedCount,
    reviewDecisionCount: result.reviewDecisionCount,
    skippedExistingCount: result.canonical.skippedExistingCount,
    supersededCount: result.canonical.supersededCount,
  };
  const status = errors.length > 0 ? "partial" : "completed";
  if (!authorizationRequired) {
    await port.recordOutcome({
      counts,
      ...(errors[0] ? { errorCode: errors[0].code } : {}),
      generation: run.generation,
      runId: run.runId,
      status,
    });
  }
  return { counts, status };
}

function assertRunMatchesWake(
  run: HostedClinicalRecordsRunDescriptor,
  wake: HostedExecutionClinicalRecordsSyncRequestedWake,
): void {
  if (run.runId !== wake.runId || run.generation !== wake.generation) {
    throw new HostedClinicalRecordsRuntimeError(
      "CLINICAL_RECORDS_RUN_POINTER_MISMATCH",
      "Hosted clinical records run does not match its mailbox pointer.",
    );
  }
}

async function preemptIfRequested(input: {
  counts: HostedClinicalRecordsOutcomeCounts;
  port: HostedRuntimeClinicalRecordsPort;
  shouldYield: (() => boolean) | null;
  wake: HostedExecutionClinicalRecordsSyncRequestedWake;
}): Promise<void> {
  if (input.shouldYield?.() !== true) {
    return;
  }
  await input.port.recordOutcome({
    counts: input.counts,
    errorCode: "foreground_preempted",
    generation: input.wake.generation,
    runId: input.wake.runId,
    status: "preempted",
  });
  throw new HostedClinicalRecordsRuntimeError(
    "CLINICAL_RECORDS_FOREGROUND_PREEMPTED",
    "Hosted clinical records sync yielded to foreground work.",
  );
}

async function recordTerminalFailure(input: {
  counts: HostedClinicalRecordsOutcomeCounts;
  errorCode: string;
  port: HostedRuntimeClinicalRecordsPort;
  wake: HostedExecutionClinicalRecordsSyncRequestedWake;
}): Promise<HostedClinicalRecordsSyncMetrics> {
  await input.port.recordOutcome({
    counts: input.counts,
    errorCode: input.errorCode,
    generation: input.wake.generation,
    runId: input.wake.runId,
    status: "failed",
  });
  return {
    counts: input.counts,
    status: "failed",
  };
}

function fetchCounts(
  fetchedPageCount: number,
  fetchedResourceFamilyCount: number,
): HostedClinicalRecordsOutcomeCounts {
  return {
    ...emptyCounts(),
    fetchedPageCount,
    fetchedResourceFamilyCount,
  };
}

function emptyCounts(): HostedClinicalRecordsOutcomeCounts {
  return {
    createdCount: 0,
    executableDecisionCount: 0,
    fetchedPageCount: 0,
    fetchedResourceFamilyCount: 0,
    rawFileCount: 0,
    retractedCount: 0,
    reviewDecisionCount: 0,
    skippedExistingCount: 0,
    supersededCount: 0,
  };
}

function loadRuntimeModule<TModule>(specifier: string): Promise<TModule> {
  return import(specifier) as Promise<TModule>;
}

class HostedClinicalRecordsRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "HostedClinicalRecordsRuntimeError";
  }
}
