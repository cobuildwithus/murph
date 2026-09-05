import type {
  HostedExecutionClinicalRecordsSyncRequestedWake,
} from "@murphai/hosted-execution/contracts";
import {
  CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE,
  CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES,
  CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES,
  clinicalFhirRetrievalSliceSchema,
  clinicalSourceSystemSchema,
  countClinicalFhirPageResources,
  clinicalFhirPageHasIncompleteSearchOutcome,
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
  type HostedClinicalRecordsRetrievalSlice,
} from "@murphai/hosted-execution/clinical-records";
import type {
  ClinicalFhirRetrievalCheckpoint,
  ClinicalFhirRetrievalCheckpointIdentity,
  ClinicalFhirRetrievalCheckpointRecord,
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

type ClinicalFhirRetrievalWork = HostedClinicalRecordsRetrievalSlice;

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
  readClinicalFhirRetrievalCheckpointForRun(input: {
    identity: Pick<ClinicalFhirRetrievalCheckpointIdentity, "generation" | "runId">;
    vaultRoot: string;
  }): Promise<ClinicalFhirRetrievalCheckpointRecord | null>;
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
  if (readResponse.status === "unavailable" && readResponse.retryable) {
    throw new HostedClinicalRecordsRuntimeError(
      "CLINICAL_RECORDS_RUN_RETRYABLE",
      "Hosted clinical records run is temporarily unavailable.",
    );
  }
  const vaultModule = await loadClinicalRecordsVaultModule();
  let checkpoint: ClinicalFhirRetrievalCheckpoint;
  let checkpointIdentity: ClinicalFhirRetrievalCheckpointIdentity;
  let recoveringAuthorizationRequired = false;
  if (readResponse.status === "unavailable") {
    if (readResponse.errorCode !== HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE) {
      await vaultModule.clearClinicalFhirRetrievalCheckpoint({
        identity: input.wake,
        vaultRoot: input.vaultRoot,
      });
      return unavailableClinicalRecordsSync();
    }
    const record = await vaultModule.readClinicalFhirRetrievalCheckpointForRun({
      identity: input.wake,
      vaultRoot: input.vaultRoot,
    });
    if (!record) {
      return unavailableClinicalRecordsSync();
    }
    checkpoint = record.checkpoint;
    checkpointIdentity = record.identity;
    recoveringAuthorizationRequired = true;
  } else {
    const run = readResponse.run;
    assertRunMatchesWake(run, input.wake);
    throwIfPreempted(input);
    checkpointIdentity = {
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
      retrievalProtocol: run.retrievalProtocol,
      retrievalSlices: run.retrievalSlices,
      runId: run.runId,
      sourceSystem: clinicalSourceSystemSchema.parse(run.sourceSystem),
    };
    checkpoint =
      (await vaultModule.readClinicalFhirRetrievalCheckpoint({
        identity: checkpointIdentity,
        vaultRoot: input.vaultRoot,
      })) ?? emptyRetrievalCheckpoint();
  }

  await persistRetrievalCheckpoint({ checkpoint, checkpointIdentity, input, vaultModule });
  const retrievalWork = checkpointIdentity.retrievalSlices;
  const sourceSystem = clinicalSourceSystemSchema.parse(checkpointIdentity.sourceSystem);
  if (checkpoint.currentResourceIndex > retrievalWork.length) {
    throw new HostedClinicalRecordsRuntimeError(
      "CLINICAL_RECORDS_CHECKPOINT_SCOPE_MISMATCH",
      "Hosted clinical records checkpoint exceeds its retrieval scope.",
    );
  }
  if (recoveringAuthorizationRequired) {
    finalizeAuthorizationRequiredCheckpoint({
      checkpoint,
      retrievalWork,
    });
    await persistRetrievalCheckpoint({ checkpoint, checkpointIdentity, input, vaultModule });
    throwIfPreempted(input);
  }

  retrieval: for (
    let resourceIndex = checkpoint.currentResourceIndex;
    resourceIndex < retrievalWork.length;
    resourceIndex += 1
  ) {
    if (checkpoint.authorizationRequired) {
      break;
    }
    const scope = retrievalWork[resourceIndex];
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
        finishIncompleteRetrieval({ checkpoint, retrievalWork, code: "page_limit_exceeded" });
        await persistRetrievalCheckpoint({ checkpoint, checkpointIdentity, input, vaultModule });
        break retrieval;
      }
      if (checkpoint.cursor && checkpoint.seenCursors.includes(checkpoint.cursor)) {
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
          generation: checkpointIdentity.generation,
          requestId: `cr-${checkpointIdentity.generation}-${resourceIndex + 1}-${checkpoint.pageFetchCount + 1}`,
          queryFingerprint: scope.queryFingerprint,
          queryScopeId: scope.queryScopeId,
          retrievalProtocol: checkpointIdentity.retrievalProtocol,
          sliceId: scope.sliceId,
          resourceType: scope.resourceType,
          runId: checkpointIdentity.runId,
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
        if (response.errorCode === HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE) {
          finalizeAuthorizationRequiredCheckpoint({ checkpoint, retrievalWork });
        } else {
          checkpoint.errors.push({
            code: response.errorCode,
            message: "Provider did not return this FHIR resource family.",
            ...retrievalIdentityFields(scope),
            resourceType: scope.resourceType,
          });
          checkpoint.pages.splice(checkpoint.resourcePageStartIndex);
          checkpoint.currentResourceIndex = resourceIndex + 1;
          checkpoint.cursor = null;
          checkpoint.resourcePageStartIndex = checkpoint.pages.length;
          checkpoint.seenCursors = [];
          checkpoint.seenPageUrlHashes = [];
        }
        await persistRetrievalCheckpoint({ checkpoint, checkpointIdentity, input, vaultModule });
        throwIfPreempted(input);
        break;
      }
      checkpoint.successfulPageCount += 1;

      const pageBodyBytes = Buffer.byteLength(response.body, "utf8");
      if (pageBodyBytes > CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES) {
        finishIncompleteRetrieval({ checkpoint, retrievalWork, code: "page_size_exceeded" });
        await persistRetrievalCheckpoint({ checkpoint, checkpointIdentity, input, vaultModule });
        break retrieval;
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
        finishIncompleteRetrieval({
          checkpoint,
          retrievalWork,
          code: "page_resource_limit_exceeded",
        });
        await persistRetrievalCheckpoint({ checkpoint, checkpointIdentity, input, vaultModule });
        break retrieval;
      }
      if (
        checkpoint.totalResourceCount + pageResourceCount >
        CLINICAL_RAW_MANIFEST_MAX_TOTAL_RESOURCES
      ) {
        finishIncompleteRetrieval({
          checkpoint,
          retrievalWork,
          code: "snapshot_resource_limit_exceeded",
        });
        await persistRetrievalCheckpoint({ checkpoint, checkpointIdentity, input, vaultModule });
        break retrieval;
      }
      if (response.pageUrlHash && checkpoint.seenPageUrlHashes.includes(response.pageUrlHash)) {
        return await terminalFailureAfterClearingCheckpoint({
          checkpoint,
          checkpointIdentity,
          errorCode: "cursor_cycle",
          input,
          vaultModule,
        });
      }
      if (
        checkpoint.totalBodyBytes + pageBodyBytes >
        HOSTED_CLINICAL_RECORDS_MAX_TOTAL_BODY_BYTES
      ) {
        finishIncompleteRetrieval({ checkpoint, retrievalWork, code: "snapshot_size_exceeded" });
        await persistRetrievalCheckpoint({ checkpoint, checkpointIdentity, input, vaultModule });
        break retrieval;
      }
      if (
        clinicalFhirPageHasIncompleteSearchOutcome(response.body) &&
        !checkpoint.errors.some(
          (error) =>
            error.code === "provider-search-incomplete" &&
            error.resourceType === scope.resourceType &&
            error.queryScopeId === retrievalIdentityFields(scope).queryScopeId &&
            error.sliceId === retrievalIdentityFields(scope).sliceId,
        )
      ) {
        checkpoint.errors.push({
          code: "provider-search-incomplete",
          message: "The provider reported incomplete search results.",
          ...retrievalIdentityFields(scope),
          resourceType: scope.resourceType,
        });
      }
      checkpoint.totalResourceCount += pageResourceCount;
      checkpoint.totalBodyBytes += pageBodyBytes;
      checkpoint.pages.push({
        content: response.body,
        ...(response.pageUrlHash ? { pageUrlHash: response.pageUrlHash } : {}),
        ...retrievalIdentityFields(scope),
        resourceType: scope.resourceType,
      });
      if (requestedCursor) {
        checkpoint.seenCursors.push(requestedCursor);
      }
      if (response.pageUrlHash) {
        checkpoint.seenPageUrlHashes.push(response.pageUrlHash);
      }
      checkpoint.cursor = response.nextCursor;
      completed = checkpoint.cursor === null;
      if (completed) {
        checkpoint.completedRetrievalSlices.push(retrievalIdentityFields(scope));
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
  const boundError = checkpoint.errors.find((error) => error.code.endsWith("_exceeded"));
  if (checkpoint.completedRetrievalSlices.length === 0 && boundError) {
    return terminalFailureAfterClearingCheckpoint({
      checkpoint,
      checkpointIdentity,
      errorCode: boundError.code,
      input,
      vaultModule,
    });
  }
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
      completedRetrievalSlices: checkpoint.completedRetrievalSlices,
      connectionId: checkpointIdentity.connectionId,
      ...(checkpoint.errors.length > 0 ? { errors: checkpoint.errors } : {}),
      fetchedAt: checkpointIdentity.fetchedAt,
      fhirBaseUrlHash: checkpointIdentity.fhirBaseUrlHash,
      grantedScopes: checkpointIdentity.grantedScopes,
      pages: checkpoint.pages,
      patientIdHash: checkpointIdentity.patientIdHash,
      ...(checkpointIdentity.providerDirectoryEntryId
        ? { providerDirectoryEntryId: checkpointIdentity.providerDirectoryEntryId }
        : {}),
      requestedScopes: checkpointIdentity.requestedScopes,
      retrievalJobId: checkpointIdentity.retrievalJobId,
      retrievalProtocol: checkpointIdentity.retrievalProtocol,
      retrievalSlices: checkpointIdentity.retrievalSlices,
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
          completedResourceFamilyCount(checkpoint, checkpointIdentity),
        ),
        checkpointIdentity,
        errorCode: "snapshot_rejected",
      });
      return failure;
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
    fetchedResourceFamilyCount: completedResourceFamilyCount(checkpoint, checkpointIdentity),
    labResultCount: result.labResultCount,
    rawFileCount: result.rawFileCount,
    retractedCount: result.canonical.retractedCount,
    reviewDecisionCount: result.reviewDecisionCount,
    skippedExistingCount: result.canonical.skippedExistingCount,
    supersededCount: result.canonical.supersededCount,
  };
  const status =
    checkpoint.errors.length > 0 || result.incompleteRevisionCount > 0
      ? "partial"
      : "completed";
  const outcome = {
    counts,
    ...(checkpoint.authorizationRequired
      ? { errorCode: HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE }
      : checkpoint.errors[0]
        ? { errorCode: checkpoint.errors[0].code }
        : result.incompleteRevisionCount > 0
          ? { errorCode: "incomplete-source-revision" }
          : {}),
    generation: checkpointIdentity.generation,
    ...retrievalOutcomeIdentity(checkpointIdentity),
    runId: checkpointIdentity.runId,
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
    completedRetrievalSlices: [],
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

function finalizeAuthorizationRequiredCheckpoint(input: {
  checkpoint: ClinicalFhirRetrievalCheckpoint;
  retrievalWork: readonly ClinicalFhirRetrievalWork[];
}): void {
  if (input.checkpoint.authorizationRequired) {
    return;
  }
  input.checkpoint.authorizationRequired = true;
  finishIncompleteRetrieval({ ...input, code: HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE });
}

function finishIncompleteRetrieval(input: {
  checkpoint: ClinicalFhirRetrievalCheckpoint;
  retrievalWork: readonly ClinicalFhirRetrievalWork[];
  code: string;
}): void {
  const remaining = input.retrievalWork.slice(input.checkpoint.currentResourceIndex);
  input.checkpoint.pages.splice(input.checkpoint.resourcePageStartIndex);
  input.checkpoint.currentResourceIndex = input.retrievalWork.length;
  input.checkpoint.cursor = null;
  input.checkpoint.resourcePageStartIndex = input.checkpoint.pages.length;
  input.checkpoint.seenCursors = [];
  input.checkpoint.seenPageUrlHashes = [];
  for (const [index, scope] of remaining.entries()) {
    input.checkpoint.errors.push({
      code: index === 0 ? input.code : "not-attempted",
      message: index === 0 ? "Provider retrieval could not finish this query." : "Retrieval stopped before this query.",
      ...retrievalIdentityFields(scope),
      resourceType: scope.resourceType,
    });
  }
}

function retrievalIdentityFields(scope: ClinicalFhirRetrievalWork): { queryScopeId: string; sliceId: string } {
  return { queryScopeId: scope.queryScopeId, sliceId: scope.sliceId };
}

function completedResourceFamilyCount(checkpoint: ClinicalFhirRetrievalCheckpoint, identity: ClinicalFhirRetrievalCheckpointIdentity): number {
  const completed = new Set(checkpoint.completedRetrievalSlices.map((slice) => `${slice.queryScopeId}\n${slice.sliceId}`));
  return new Set(identity.retrievalSlices.filter((slice) => completed.has(`${slice.queryScopeId}\n${slice.sliceId}`)).map((slice) => slice.resourceType)).size;
}

function unavailableClinicalRecordsSync(): HostedClinicalRecordsSyncMetrics {
  return {
    counts: emptyCounts(),
    outcome: null,
    status: "unavailable",
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
      completedResourceFamilyCount(input.checkpoint, input.checkpointIdentity),
    ),
    checkpointIdentity: input.checkpointIdentity,
    errorCode: input.errorCode,
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
  if (input.shouldYieldClinicalRecords?.() === true) {
    throw new HostedClinicalRecordsRuntimeError(
      "CLINICAL_RECORDS_FOREGROUND_PREEMPTED",
      "Hosted clinical records sync yielded to foreground work.",
    );
  }
  input.signal?.throwIfAborted();
}

function terminalFailure(input: {
  checkpointIdentity: ClinicalFhirRetrievalCheckpointIdentity;
  counts: HostedClinicalRecordsOutcomeCounts;
  errorCode: string;
}): HostedClinicalRecordsSyncMetrics {
  return {
    counts: input.counts,
    outcome: {
      counts: input.counts,
      errorCode: input.errorCode,
      generation: input.checkpointIdentity.generation,
      ...retrievalOutcomeIdentity(input.checkpointIdentity),
      runId: input.checkpointIdentity.runId,
      status: "failed",
    },
    status: "failed",
  };
}

function retrievalOutcomeIdentity(
  identity: ClinicalFhirRetrievalCheckpointIdentity,
): {
  retrievalProtocol: "query-slices-v2";
  retrievalSlices: Array<{ queryScopeId: string; sliceId: string }>;
} {
  return {
    retrievalProtocol: identity.retrievalProtocol,
    retrievalSlices: identity.retrievalSlices.map((slice) => ({
      queryScopeId: slice.queryScopeId,
      sliceId: slice.sliceId,
    })),
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
