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
  type HostedClinicalRecordsRecordOutcomeRequest,
  type HostedClinicalRecordsRunDescriptor,
} from "@murphai/hosted-execution/clinical-records";
import type {
  ClinicalFhirRetrievalCheckpoint,
  ClinicalFhirRetrievalCheckpointIdentity,
  ClinicalFhirSnapshotImportInput,
  ClinicalFhirSnapshotImportResult,
} from "@murphai/vault-usecases/clinical-records";

import type {
  HostedRuntimeClinicalRecordsPort,
} from "./platform.ts";
import {
  createHostedBackgroundMaintenanceCancellation,
} from "./background-maintenance-cancellation.ts";

const CLINICAL_RECORDS_VAULT_MODULE_SPECIFIER =
  "@murphai/vault-usecases/clinical-records";

type ClinicalRecordsVaultModule = {
  clearClinicalFhirRetrievalCheckpoint(input: {
    identity: Pick<ClinicalFhirRetrievalCheckpointIdentity, "generation" | "runId">;
    vaultRoot: string;
  }): Promise<void>;
  importClinicalFhirSnapshot(
    input: ClinicalFhirSnapshotImportInput,
  ): Promise<ClinicalFhirSnapshotImportResult>;
  readClinicalFhirRetrievalCheckpoint(input: {
    identity: ClinicalFhirRetrievalCheckpointIdentity;
    vaultRoot: string;
  }): Promise<ClinicalFhirRetrievalCheckpoint | null>;
  writeClinicalFhirRetrievalCheckpoint(input: {
    checkpoint: ClinicalFhirRetrievalCheckpoint;
    identity: ClinicalFhirRetrievalCheckpointIdentity;
    vaultRoot: string;
  }): Promise<void>;
};

export interface HostedClinicalRecordsSyncMetrics {
  counts: HostedClinicalRecordsOutcomeCounts;
  outcome: HostedClinicalRecordsRecordOutcomeRequest | null;
  status: "completed" | "failed" | "partial" | "unavailable";
}

export async function runHostedClinicalRecordsSyncWakeLane(input: {
  clinicalRecordsPort?: HostedRuntimeClinicalRecordsPort | null;
  importSnapshot?: ClinicalRecordsVaultModule["importClinicalFhirSnapshot"];
  signal?: AbortSignal | null;
  shouldYieldClinicalRecords?: (() => boolean) | null;
  vaultRoot: string;
  wake: HostedExecutionClinicalRecordsSyncRequestedWake;
}): Promise<HostedClinicalRecordsSyncMetrics> {
  const cancellation = createHostedBackgroundMaintenanceCancellation({
    signal: input.signal ?? null,
    shouldYield: input.shouldYieldClinicalRecords ?? null,
    timeoutMs: null,
  });
  try {
    return await runHostedClinicalRecordsSyncWakeLaneWithCancellation({
      ...input,
      signal: cancellation.signal,
    });
  } finally {
    cancellation.dispose();
  }
}

async function runHostedClinicalRecordsSyncWakeLaneWithCancellation(input: {
  clinicalRecordsPort?: HostedRuntimeClinicalRecordsPort | null;
  importSnapshot?: ClinicalRecordsVaultModule["importClinicalFhirSnapshot"];
  signal: AbortSignal | null;
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

  throwIfPreempted(input);
  const readResponsePayload = await port.readRun(
    {
      generation: input.wake.generation,
      runId: input.wake.runId,
    },
    { signal: input.signal },
  );
  throwIfPreempted(input);
  const readResponse = parseHostedClinicalRecordsReadRunResponse(readResponsePayload);
  if (readResponse.status === "unavailable") {
    if (readResponse.retryable) {
      throw new HostedClinicalRecordsRuntimeError(
        "CLINICAL_RECORDS_RUN_RETRYABLE",
        "Hosted clinical records run is temporarily unavailable.",
      );
    }
    const vaultModule = await loadClinicalRecordsVaultModule();
    await vaultModule.clearClinicalFhirRetrievalCheckpoint({
      identity: input.wake,
      vaultRoot: input.vaultRoot,
    });
    return {
      counts: emptyCounts(),
      outcome: null,
      status: "unavailable",
    };
  }

  const run = readResponse.run;
  assertRunMatchesWake(run, input.wake);
  throwIfPreempted(input);
  const retrievalScopes = run.retrievalScopes.map((scope) =>
    clinicalFhirRetrievalScopeSchema.parse(scope)
  );
  const sourceSystem = clinicalSourceSystemSchema.parse(run.sourceSystem);
  const checkpointIdentity: ClinicalFhirRetrievalCheckpointIdentity = {
    connectionId: run.connectionId,
    fetchedAt: run.fetchedAt,
    fhirBaseUrlHash: run.fhirBaseUrlHash,
    generation: run.generation,
    grantedScopes: run.grantedScopes,
    patientIdHash: run.patientIdHash,
    ...(run.providerDirectoryEntryId
      ? { providerDirectoryEntryId: run.providerDirectoryEntryId }
      : {}),
    requestedScopes: run.requestedScopes,
    retrievalJobId: run.retrievalJobId,
    retrievalScopes,
    runId: run.runId,
    sourceSystem,
  };
  const vaultModule = await loadClinicalRecordsVaultModule();
  const checkpoint = await vaultModule.readClinicalFhirRetrievalCheckpoint({
    identity: checkpointIdentity,
    vaultRoot: input.vaultRoot,
  }) ?? emptyRetrievalCheckpoint();
  if (checkpoint.currentResourceIndex > retrievalScopes.length) {
    throw new HostedClinicalRecordsRuntimeError(
      "CLINICAL_RECORDS_CHECKPOINT_SCOPE_MISMATCH",
      "Hosted clinical records checkpoint exceeds its retrieval scope.",
    );
  }

  for (
    let resourceIndex = checkpoint.currentResourceIndex;
    resourceIndex < retrievalScopes.length;
    resourceIndex += 1
  ) {
    if (checkpoint.authorizationRequired) {
      break;
    }
    const scope = retrievalScopes[resourceIndex];
    if (!scope) {
      throw new HostedClinicalRecordsRuntimeError(
        "CLINICAL_RECORDS_SCOPE_UNAVAILABLE",
        "Hosted clinical records retrieval scope is unavailable.",
      );
    }
    throwIfPreempted(input);
    let completed = false;

    while (!completed) {
      throwIfPreempted(input);
      if (checkpoint.pageFetchCount >= HOSTED_CLINICAL_RECORDS_MAX_PAGES) {
        return await terminalFailureAfterClearingCheckpoint({
          checkpoint,
          checkpointIdentity,
          errorCode: "page_limit_exceeded",
          input,
          vaultModule,
        });
      }
      if (
        checkpoint.cursor
        && checkpoint.seenCursors.includes(checkpoint.cursor)
      ) {
        return await terminalFailureAfterClearingCheckpoint({
          checkpoint,
          checkpointIdentity,
          errorCode: "cursor_cycle",
          input,
          vaultModule,
        });
      }

      const requestedCursor = checkpoint.cursor;
      const responsePayload = await port.fetchPage(
        {
          cursor: checkpoint.cursor,
          generation: run.generation,
          requestId: `cr-${run.generation}-${resourceIndex + 1}-${checkpoint.pageFetchCount + 1}`,
          resourceType: scope.resourceType,
          runId: run.runId,
        },
        { signal: input.signal },
      );
      const response = parseHostedClinicalRecordsFetchPageResponse(responsePayload);
      checkpoint.pageFetchCount += 1;
      if (response.status === "unavailable") {
        if (response.retryable) {
          await persistRetrievalCheckpoint({
            checkpoint,
            checkpointIdentity,
            input,
            vaultModule,
          });
          throw new HostedClinicalRecordsRuntimeError(
            "CLINICAL_RECORDS_PAGE_RETRYABLE",
            "Hosted clinical records page is temporarily unavailable.",
          );
        }
        checkpoint.errors.push({
          code: response.errorCode,
          message: "Provider did not return this FHIR resource family.",
          resourceType: scope.resourceType,
        });
        checkpoint.authorizationRequired = response.errorCode
          === HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE;
        checkpoint.pages.splice(checkpoint.resourcePageStartIndex);
        checkpoint.currentResourceIndex = checkpoint.authorizationRequired
          ? retrievalScopes.length
          : resourceIndex + 1;
        checkpoint.cursor = null;
        checkpoint.resourcePageStartIndex = checkpoint.pages.length;
        checkpoint.seenCursors = [];
        checkpoint.seenPageUrlHashes = [];
        if (checkpoint.authorizationRequired) {
          for (const remainingScope of retrievalScopes.slice(resourceIndex + 1)) {
            checkpoint.errors.push({
              code: "not-attempted",
              message: "Retrieval was not attempted after provider authorization ended.",
              resourceType: remainingScope.resourceType,
            });
          }
        }
        await persistRetrievalCheckpoint({ checkpoint, checkpointIdentity, input, vaultModule });
        throwIfPreempted(input);
        break;
      }
      checkpoint.successfulPageCount += 1;

      const pageBodyBytes = Buffer.byteLength(response.body, "utf8");
      if (pageBodyBytes > CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES) {
        return await terminalFailureAfterClearingCheckpoint({
          checkpoint,
          checkpointIdentity,
          errorCode: "page_size_exceeded",
          input,
          vaultModule,
        });
      }
      let pageResourceCount: number;
      try {
        pageResourceCount = countClinicalFhirPageResources(response.body);
      } catch {
        return await terminalFailureAfterClearingCheckpoint({
          checkpoint,
          checkpointIdentity,
          errorCode: "invalid_fhir_page",
          input,
          vaultModule,
        });
      }
      if (pageResourceCount > CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE) {
        return await terminalFailureAfterClearingCheckpoint({
          checkpoint,
          checkpointIdentity,
          errorCode: "page_resource_limit_exceeded",
          input,
          vaultModule,
        });
      }
      if (
        checkpoint.totalResourceCount + pageResourceCount
        > CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES
      ) {
        return await terminalFailureAfterClearingCheckpoint({
          checkpoint,
          checkpointIdentity,
          errorCode: "snapshot_resource_limit_exceeded",
          input,
          vaultModule,
        });
      }
      if (
        response.pageUrlHash
        && checkpoint.seenPageUrlHashes.includes(response.pageUrlHash)
      ) {
        return await terminalFailureAfterClearingCheckpoint({
          checkpoint,
          checkpointIdentity,
          errorCode: "cursor_cycle",
          input,
          vaultModule,
        });
      }
      checkpoint.totalResourceCount += pageResourceCount;
      checkpoint.totalBodyBytes += pageBodyBytes;
      if (checkpoint.totalBodyBytes > HOSTED_CLINICAL_RECORDS_MAX_TOTAL_BODY_BYTES) {
        return await terminalFailureAfterClearingCheckpoint({
          checkpoint,
          checkpointIdentity,
          errorCode: "snapshot_size_exceeded",
          input,
          vaultModule,
        });
      }
      checkpoint.pages.push({
        content: response.body,
        ...(response.nextPageUrlHash
          ? { nextPageUrlHash: response.nextPageUrlHash }
          : {}),
        ...(response.pageUrlHash ? { pageUrlHash: response.pageUrlHash } : {}),
        resourceType: scope.resourceType,
      });
      if (requestedCursor) {
        checkpoint.seenCursors.push(requestedCursor);
      }
      if (response.pageUrlHash) {
        checkpoint.seenPageUrlHashes.push(response.pageUrlHash);
      }
      if (
        response.nextPageUrlHash
        && checkpoint.seenPageUrlHashes.includes(response.nextPageUrlHash)
      ) {
        return await terminalFailureAfterClearingCheckpoint({
          checkpoint,
          checkpointIdentity,
          errorCode: "cursor_cycle",
          input,
          vaultModule,
        });
      }
      checkpoint.cursor = response.nextCursor;
      completed = checkpoint.cursor === null;
      if (completed) {
        checkpoint.completedResourceTypes.push(scope.resourceType);
        checkpoint.currentResourceIndex = resourceIndex + 1;
        checkpoint.resourcePageStartIndex = checkpoint.pages.length;
        checkpoint.seenCursors = [];
        checkpoint.seenPageUrlHashes = [];
      }
      await persistRetrievalCheckpoint({ checkpoint, checkpointIdentity, input, vaultModule });
      throwIfPreempted(input);
    }

    if (checkpoint.authorizationRequired) {
      break;
    }
  }

  throwIfPreempted(input);
  const importSnapshot = input.importSnapshot ?? vaultModule.importClinicalFhirSnapshot;
  let result: ClinicalFhirSnapshotImportResult;
  try {
    result = await importSnapshot({
      assertCurrent: async () => {
        await assertClinicalRecordsRunCurrent({
          allowAuthorizationRequired: checkpoint.authorizationRequired,
          input,
          port,
        });
      },
      completedResourceTypes: checkpoint.completedResourceTypes,
      connectionId: run.connectionId,
      ...(checkpoint.errors.length > 0 ? { errors: checkpoint.errors } : {}),
      fetchedAt: run.fetchedAt,
      fhirBaseUrlHash: run.fhirBaseUrlHash,
      grantedScopes: run.grantedScopes,
      pages: checkpoint.pages,
      patientIdHash: run.patientIdHash,
      ...(run.providerDirectoryEntryId
        ? { providerDirectoryEntryId: run.providerDirectoryEntryId }
        : {}),
      requestedScopes: run.requestedScopes,
      retrievalJobId: run.retrievalJobId,
      retrievalScopes,
      signal: input.signal,
      sourceSystem,
      vaultRoot: input.vaultRoot,
    });
  } catch (error) {
    if (isClinicalFhirSnapshotRejectedError(error)) {
      await clearRetrievalCheckpoint({ checkpointIdentity, input, vaultModule });
      const failure = terminalFailure({
        counts: fetchCounts(
          checkpoint.successfulPageCount,
          checkpoint.completedResourceTypes.length,
        ),
        errorCode: "snapshot_rejected",
        wake: input.wake,
      });
      return checkpoint.authorizationRequired
        ? { ...failure, outcome: null }
        : failure;
    }
    if (error instanceof HostedClinicalRecordsRunNoLongerCurrentError) {
      await clearRetrievalCheckpoint({ checkpointIdentity, input, vaultModule });
      return {
        counts: emptyCounts(),
        outcome: null,
        status: "unavailable",
      };
    }
    throw error;
  }
  await clearRetrievalCheckpoint({ checkpointIdentity, input, vaultModule });
  const counts: HostedClinicalRecordsOutcomeCounts = {
    createdCount: result.canonical.createdCount,
    executableDecisionCount: result.executableDecisionCount,
    fetchedPageCount: checkpoint.successfulPageCount,
    fetchedResourceFamilyCount: checkpoint.completedResourceTypes.length,
    rawFileCount: result.rawFileCount,
    retractedCount: result.canonical.retractedCount,
    reviewDecisionCount: result.reviewDecisionCount,
    skippedExistingCount: result.canonical.skippedExistingCount,
    supersededCount: result.canonical.supersededCount,
  };
  const status = checkpoint.errors.length > 0 ? "partial" : "completed";
  const outcome = checkpoint.authorizationRequired
    ? null
    : {
      counts,
      ...(checkpoint.errors[0] ? { errorCode: checkpoint.errors[0].code } : {}),
      generation: run.generation,
      runId: run.runId,
      status,
    } satisfies HostedClinicalRecordsRecordOutcomeRequest;
  return { counts, outcome, status };
}

async function loadClinicalRecordsVaultModule(): Promise<ClinicalRecordsVaultModule> {
  return await loadRuntimeModule<ClinicalRecordsVaultModule>(
    CLINICAL_RECORDS_VAULT_MODULE_SPECIFIER,
  );
}

function emptyRetrievalCheckpoint(): ClinicalFhirRetrievalCheckpoint {
  return {
    authorizationRequired: false,
    completedResourceTypes: [],
    currentResourceIndex: 0,
    cursor: null,
    errors: [],
    pageFetchCount: 0,
    pages: [],
    resourcePageStartIndex: 0,
    seenCursors: [],
    seenPageUrlHashes: [],
    successfulPageCount: 0,
    totalBodyBytes: 0,
    totalResourceCount: 0,
  };
}

async function persistRetrievalCheckpoint(input: {
  checkpoint: ClinicalFhirRetrievalCheckpoint;
  checkpointIdentity: ClinicalFhirRetrievalCheckpointIdentity;
  input: { vaultRoot: string };
  vaultModule: ClinicalRecordsVaultModule;
}): Promise<void> {
  await input.vaultModule.writeClinicalFhirRetrievalCheckpoint({
    checkpoint: input.checkpoint,
    identity: input.checkpointIdentity,
    vaultRoot: input.input.vaultRoot,
  });
}

async function clearRetrievalCheckpoint(input: {
  checkpointIdentity: ClinicalFhirRetrievalCheckpointIdentity;
  input: { vaultRoot: string };
  vaultModule: ClinicalRecordsVaultModule;
}): Promise<void> {
  await input.vaultModule.clearClinicalFhirRetrievalCheckpoint({
    identity: input.checkpointIdentity,
    vaultRoot: input.input.vaultRoot,
  });
}

async function terminalFailureAfterClearingCheckpoint(input: {
  checkpoint: ClinicalFhirRetrievalCheckpoint;
  checkpointIdentity: ClinicalFhirRetrievalCheckpointIdentity;
  errorCode: string;
  input: {
    vaultRoot: string;
    wake: HostedExecutionClinicalRecordsSyncRequestedWake;
  };
  vaultModule: ClinicalRecordsVaultModule;
}): Promise<HostedClinicalRecordsSyncMetrics> {
  await clearRetrievalCheckpoint(input);
  return terminalFailure({
    counts: fetchCounts(
      input.checkpoint.successfulPageCount,
      input.checkpoint.completedResourceTypes.length,
    ),
    errorCode: input.errorCode,
    wake: input.input.wake,
  });
}

async function assertClinicalRecordsRunCurrent(input: {
  allowAuthorizationRequired: boolean;
  input: {
    signal: AbortSignal | null;
    shouldYieldClinicalRecords?: (() => boolean) | null;
    wake: HostedExecutionClinicalRecordsSyncRequestedWake;
  };
  port: HostedRuntimeClinicalRecordsPort;
}): Promise<void> {
  throwIfPreempted(input.input);
  const payload = await input.port.readRun(
    {
      generation: input.input.wake.generation,
      runId: input.input.wake.runId,
    },
    { signal: input.input.signal },
  );
  const response = parseHostedClinicalRecordsReadRunResponse(payload);
  if (response.status === "unavailable") {
    if (
      input.allowAuthorizationRequired
      && response.errorCode === HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE
    ) {
      throwIfPreempted(input.input);
      return;
    }
    if (response.retryable) {
      throw new HostedClinicalRecordsRuntimeError(
        "CLINICAL_RECORDS_RUN_RETRYABLE",
        "Hosted clinical records run is temporarily unavailable.",
      );
    }
    throw new HostedClinicalRecordsRunNoLongerCurrentError();
  }
  assertRunMatchesWake(response.run, input.input.wake);
  throwIfPreempted(input.input);
}

class HostedClinicalRecordsRunNoLongerCurrentError extends Error {
  constructor() {
    super("Hosted clinical records run is no longer current.");
    this.name = "HostedClinicalRecordsRunNoLongerCurrentError";
  }
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

function throwIfPreempted(input: {
  signal: AbortSignal | null;
  shouldYieldClinicalRecords?: (() => boolean) | null;
}): void {
  input.signal?.throwIfAborted();
  if (input.shouldYieldClinicalRecords?.() !== true) {
    return;
  }
  throw new HostedClinicalRecordsRuntimeError(
    "CLINICAL_RECORDS_FOREGROUND_PREEMPTED",
    "Hosted clinical records sync yielded to foreground work.",
  );
}

function terminalFailure(input: {
  counts: HostedClinicalRecordsOutcomeCounts;
  errorCode: string;
  wake: HostedExecutionClinicalRecordsSyncRequestedWake;
}): HostedClinicalRecordsSyncMetrics {
  return {
    counts: input.counts,
    outcome: {
      counts: input.counts,
      errorCode: input.errorCode,
      generation: input.wake.generation,
      runId: input.wake.runId,
      status: "failed",
    },
    status: "failed",
  };
}

function isClinicalFhirSnapshotRejectedError(error: unknown): error is Error & {
  code: "CLINICAL_FHIR_SNAPSHOT_REJECTED";
} {
  return error instanceof Error
    && "code" in error
    && error.code === "CLINICAL_FHIR_SNAPSHOT_REJECTED";
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
