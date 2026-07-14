import "server-only";

import { createHash, randomBytes } from "node:crypto";

import {
  CLINICAL_FHIR_RESOURCE_TYPES,
  clinicalSourceSystemSchema,
  hashClinicalFhirPageUrl,
  hashClinicalFhirPatientId,
  type ClinicalSourceSystem,
} from "@murphai/clinical-records";
import {
  buildHostedExecutionClinicalRecordsSyncRequestedWake,
  HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS,
  HOSTED_CLINICAL_RECORDS_MAX_PAGES,
  HOSTED_CLINICAL_RECORDS_MAX_TOTAL_BODY_BYTES,
  HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE,
  type HostedClinicalRecordsFetchPageRequest,
  type HostedClinicalRecordsFetchPageResponse,
  type HostedClinicalRecordsOutcomeCounts,
  type HostedClinicalRecordsReadRunResponse,
  type HostedClinicalRecordsRecordOutcomeRequest,
  type HostedClinicalRecordsRetrievalScope,
} from "@murphai/hosted-execution/clinical-records";
import type { Prisma } from "@prisma/client";

import {
  appendHostedMailboxEnvelopeTx,
} from "../hosted-mailbox/store";
import {
  signalHostedMailboxAppendRuntime,
} from "../hosted-orchestration/signal-runtime";
import { getPrisma } from "../prisma";
import {
  openClinicalConnectionFhirBaseUrl,
  openClinicalConnectionSecret,
  openClinicalPageCursor,
  sealClinicalConnectionSecret,
  sealClinicalPageCursor,
  toClinicalJsonArray,
} from "./secrets";
import {
  clinicalRecordsError,
  isClinicalRecordsControlPlaneError,
} from "./errors";
import { refreshSmartAccessToken } from "./smart";
import {
  ClinicalResponseBodyLimitError,
  decodeClinicalResponseUtf8,
  readClinicalResponseBytes,
} from "./response-bytes";

const FHIR_REQUEST_TIMEOUT_MS = 20_000;
const FHIR_PAGE_COUNT = "100";
const FHIR_NEXT_URL_MAX_CHARS = 1_024;
const PAGE_REQUEST_CLAIM_STALE_MS = 30_000;
const PAGE_EGRESS_RESERVATION_BYTES = HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS;
const TOKEN_REFRESH_LEEWAY_MS = 60_000;
const RETRIEVAL_REQUEST_ID_PREFIX = "crq_";
const FHIR_PATIENT_ID_PATTERN = /^[A-Za-z0-9.-]{1,64}$/u;
const TERMINAL_RUN_STATUSES = new Set([
  "complete",
  "partial",
  "needs_reauth",
  "failed",
  "canceled",
]);
const ACTIVE_RUN_STATUSES = new Set(["queued", "retrieving", "importing"]);
const ALLOWED_RESOURCE_TYPES = new Set<string>(CLINICAL_FHIR_RESOURCE_TYPES);

type ClinicalRetrievalTx = Prisma.TransactionClient;

interface ClinicalMailboxCheckpoint {
  id: string;
  lane: "system" | "conversation";
  laneSeq: string;
  userId: string;
}

interface RunnableClinicalRun {
  connection: {
    accessTokenEncrypted: string | null;
    accessTokenExpiresAt: Date | null;
    clientId: string;
    fhirBaseHash: string;
    fhirBaseUrlEncrypted: string;
    grantedScopesJson: Prisma.JsonValue;
    id: string;
    memberId: string;
    patientIdEncrypted: string | null;
    providerDirectoryEntryId: string;
    refreshTokenEncrypted: string | null;
    requestedScopesJson: Prisma.JsonValue;
    retrievalGeneration: number;
    sourceSystem: ClinicalSourceSystem;
    status: string;
    tokenEndpoint: string;
    tokenVersion: number;
  };
  createdAt: Date;
  egressBytes: number;
  fetchedBytes: number;
  generation: number;
  grantedScopesJson: Prisma.JsonValue;
  id: string;
  memberId: string;
  pageCount: number;
  providerRequestCount: number;
  resourceTypes: HostedClinicalRecordsFetchPageRequest["resourceType"][];
  status: string;
}

interface ValidatedFhirPageUrl {
  raw: string;
  url: URL;
}

export async function readClinicalRetrievalRun(input: {
  generation: number;
  memberId: string;
  runId: string;
}): Promise<HostedClinicalRecordsReadRunResponse> {
  const loaded = await loadRunnableClinicalRun(input);
  if ("unavailable" in loaded) return unavailable(loaded.unavailable, loaded.retryable);
  const run = loaded.run;
  const requestedScopes = parseStoredStringArray(run.connection.requestedScopesJson, "requested scopes");
  const grantedScopes = parseStoredStringArray(run.grantedScopesJson, "granted scopes");
  let patientIdHash: string;
  const openedPatientId = await openClinicalConnectionSecret({
    connectionId: run.connection.id,
    encrypted: run.connection.patientIdEncrypted,
    field: "patientId",
    memberId: input.memberId,
    tokenVersion: run.connection.tokenVersion,
  });
  try {
    const patientId = requireFhirPatientId(openedPatientId);
    patientIdHash = hashClinicalFhirPatientId(patientId);
  } catch {
    return unavailable("patient-context-unavailable", false);
  }
  return {
    run: {
      connectionId: run.connection.id,
      fetchedAt: run.createdAt.toISOString(),
      fhirBaseUrlHash: run.connection.fhirBaseHash,
      generation: run.generation,
      grantedScopes,
      patientIdHash,
      providerDirectoryEntryId: run.connection.providerDirectoryEntryId,
      requestedScopes,
      retrievalJobId: run.id,
      retrievalScopes: buildRetrievalScopes(run.resourceTypes),
      runId: run.id,
      sourceSystem: run.connection.sourceSystem,
    },
    status: "ready",
  };
}

export async function fetchClinicalRetrievalPage(input: {
  fetchImpl?: typeof fetch;
  memberId: string;
  request: HostedClinicalRecordsFetchPageRequest;
}): Promise<HostedClinicalRecordsFetchPageResponse> {
  const loaded = await loadRunnableClinicalRun({
    generation: input.request.generation,
    memberId: input.memberId,
    runId: input.request.runId,
  });
  if ("unavailable" in loaded) return unavailable(loaded.unavailable, loaded.retryable);
  const run = loaded.run;
  if (!run.resourceTypes.includes(input.request.resourceType)) {
    return unavailable("resource-family-not-requested", false);
  }
  if (
    run.providerRequestCount >= HOSTED_CLINICAL_RECORDS_MAX_PAGES
    || run.egressBytes > HOSTED_CLINICAL_RECORDS_MAX_TOTAL_BODY_BYTES - PAGE_EGRESS_RESERVATION_BYTES
  ) {
    return unavailable("retrieval-bound-reached", false);
  }

  const openedPatientId = await openClinicalConnectionSecret({
    connectionId: run.connection.id,
    encrypted: run.connection.patientIdEncrypted,
    field: "patientId",
    memberId: input.memberId,
    tokenVersion: run.connection.tokenVersion,
  });
  const fhirBaseUrl = await openClinicalConnectionFhirBaseUrl({
    connectionId: run.connection.id,
    encrypted: run.connection.fhirBaseUrlEncrypted,
    memberId: input.memberId,
  });
  const openedCursor = input.request.cursor
    ? await openClinicalPageCursor({
        generation: run.generation,
        memberId: input.memberId,
        resourceType: input.request.resourceType,
        runId: run.id,
        value: input.request.cursor,
      })
    : null;
  let pageUrl: ValidatedFhirPageUrl;
  try {
    const patientId = requireFhirPatientId(openedPatientId);
    pageUrl = openedCursor
      ? parsePageCursor(openedCursor)
      : (() => {
          const url = buildInitialFhirPageUrl({
            fhirBaseUrl,
            patientId,
            resourceType: input.request.resourceType,
          });
          return { raw: url.toString(), url };
        })();
    assertFhirPageUrlAllowed({
      candidate: pageUrl.url,
      fhirBaseUrl,
      initialPatientRead: input.request.cursor === null && input.request.resourceType === "Patient",
      resourceType: input.request.resourceType,
    });
  } catch {
    return unavailable("page-cursor-invalid", false);
  }

  const requestFingerprint = sha256Hex([
    String(run.generation),
    input.request.resourceType,
    hashClinicalFhirPageUrl(pageUrl.raw),
  ].join("\n"));
  const claimed = await claimRetrievalPageRequest({
    connectionId: run.connection.id,
    generation: run.generation,
    memberId: input.memberId,
    requestFingerprint,
    runId: run.id,
  });
  if (!claimed.claimed) return unavailable(claimed.errorCode, claimed.retryable);

  let providerRequestStarted = false;
  try {
    const accessToken = await requireCurrentAccessToken({
      fetchImpl: input.fetchImpl,
      memberId: input.memberId,
      run,
    });
    providerRequestStarted = true;
    const response = await fetchFhirPage({
      accessToken,
      fetchImpl: input.fetchImpl,
      pageUrl: pageUrl.url,
    });
    let sanitized: Awaited<ReturnType<typeof readSanitizedFhirPage>>;
    try {
      sanitized = await readSanitizedFhirPage({
        fhirBaseUrl,
        resourceType: input.request.resourceType,
        response,
      });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      throw clinicalRecordsError({
        cause: error,
        code: "CLINICAL_RECORD_FHIR_RESPONSE_INVALID",
        httpStatus: 502,
        message: "The provider returned an invalid FHIR response.",
      });
    }
    const nextCursor = sanitized.nextUrl
      ? await sealClinicalPageCursor({
          generation: run.generation,
          memberId: input.memberId,
          resourceType: input.request.resourceType,
          runId: run.id,
          value: JSON.stringify({
            schema: "murph.clinical-page-cursor.v2",
            url: sanitized.nextUrl.raw,
          }),
        })
      : null;
    if (nextCursor && nextCursor.length > 2_048) {
      throw clinicalRecordsError({
        code: "CLINICAL_RECORD_PAGE_CURSOR_TOO_LARGE",
        httpStatus: 502,
        message: "The provider pagination cursor was too large.",
      });
    }
    const accounted = await completeRetrievalPageRequest({
      bodyBytes: sanitized.bodyBytes,
      claimVersion: claimed.claimVersion,
      isFirstCompletion: claimed.isFirstCompletion,
      requestRowId: claimed.requestRowId,
      run,
    });
    if (!accounted) return unavailable("request-superseded", true);
    return {
      body: sanitized.body,
      nextCursor,
      ...(input.request.cursor
        ? { pageUrlHash: hashClinicalFhirPageUrl(pageUrl.raw) }
        : {}),
      status: "page",
    };
  } catch (error) {
    await releaseRetrievalPageRequest({
      chargeReservation: providerRequestStarted,
      claimVersion: claimed.claimVersion,
      previousCompletedAt: claimed.previousCompletedAt,
      requestRowId: claimed.requestRowId,
      run,
    });
    if (
      isClinicalRecordsControlPlaneError(error)
      && error.code === "CLINICAL_RECORD_SMART_REAUTH_REQUIRED"
    ) {
      const marked = await markClinicalConnectionNeedsReauth({
        connectionId: run.connection.id,
        generation: run.generation,
        memberId: input.memberId,
        observedTokenVersion: run.connection.tokenVersion,
        runId: run.id,
      });
      return marked
        ? unavailable(HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE, false)
        : unavailable("credentials-updated-retry", true);
    }
    if (isClinicalRecordsControlPlaneError(error)) {
      return unavailable(
        error.code === "CLINICAL_RECORD_FHIR_FAMILY_UNAVAILABLE"
          ? "family-unavailable"
          : error.code === "CLINICAL_RECORD_RETRIEVAL_BOUND_REACHED"
            ? "retrieval-bound-reached"
          : error.code === "CLINICAL_RECORD_PAGE_CURSOR_TOO_LARGE"
          ? "page-cursor-too-large"
          : error.retryable
            ? "provider-temporarily-unavailable"
            : "provider-response-invalid",
        error.retryable,
      );
    }
    throw error;
  }
}

export async function recordClinicalRetrievalOutcome(input: {
  memberId: string;
  request: HostedClinicalRecordsRecordOutcomeRequest;
}): Promise<void> {
  const now = new Date();
  await getPrisma().$transaction(async (tx) => {
    const run = await tx.clinicalRecordRetrievalRun.findFirst({
      include: { connection: true },
      where: {
        generation: input.request.generation,
        id: input.request.runId,
        memberId: input.memberId,
      },
    });
    if (!run) throw staleRunError();
    if (input.request.status === "preempted") {
      if (run.completedAt) throw staleRunError();
      const connectionIsActive = run.connection.status === "active" || run.connection.status === "error";
      if (run.connection.retrievalGeneration !== run.generation || !connectionIsActive) {
        throw staleRunError();
      }
      const preempted = await tx.clinicalRecordRetrievalRun.updateMany({
        data: { lastErrorCode: input.request.errorCode ?? null, status: "queued" },
        where: {
          completedAt: null,
          connection: {
            retrievalGeneration: run.generation,
            status: { in: ["active", "error"] },
          },
          generation: run.generation,
          id: run.id,
          memberId: input.memberId,
          status: { in: [...ACTIVE_RUN_STATUSES] },
        },
      });
      if (preempted.count !== 1) throw staleRunError();
      return;
    }
    const storedStatus = mapOutcomeStatus(input.request.status);
    if (run.completedAt) {
      if (
        run.status === storedStatus
        && stableJson(run.outcomeCountsJson) === stableJson(input.request.counts)
        && (run.lastErrorCode ?? null) === (input.request.errorCode ?? null)
      ) return;
      throw clinicalRecordsError({
        code: "CLINICAL_RECORD_OUTCOME_CONFLICT",
        httpStatus: 409,
        message: "The Clinical Records retrieval outcome conflicts with the completed run.",
      });
    }
    const generationIsCurrent = run.connection.retrievalGeneration === run.generation;
    const connectionIsActive = run.connection.status === "active" || run.connection.status === "error";
    if (!generationIsCurrent || !connectionIsActive) {
      throw staleRunError();
    }
    if (
      (input.request.status === "completed" || input.request.status === "partial")
      && input.request.counts.fetchedPageCount !== run.pageCount
    ) {
      throw clinicalRecordsError({
        code: "CLINICAL_RECORD_OUTCOME_COUNT_MISMATCH",
        httpStatus: 409,
        message: "The Clinical Records retrieval page count does not match the control plane.",
      });
    }
    const connectionData = input.request.status === "failed"
      ? {
          lastErrorCode: input.request.errorCode ?? "retrieval-failed",
          status: "error",
        }
      : {
          lastErrorCode: input.request.errorCode ?? null,
          lastSyncCompletedAt: now,
          status: "active",
        };
    const updatedConnection = await tx.clinicalRecordConnection.updateMany({
      data: connectionData,
      where: {
        id: run.connectionId,
        memberId: input.memberId,
        retrievalGeneration: run.generation,
        status: { in: ["active", "error"] },
      },
    });
    if (updatedConnection.count !== 1) throw staleRunError();
    const updatedRun = await tx.clinicalRecordRetrievalRun.updateMany({
      data: {
        completedAt: now,
        importedCount: input.request.counts.createdCount,
        lastErrorCode: input.request.errorCode ?? null,
        outcomeCountsJson: { ...input.request.counts },
        reviewCount: input.request.counts.reviewDecisionCount,
        status: storedStatus,
      },
      where: {
        completedAt: null,
        connectionId: run.connectionId,
        generation: run.generation,
        id: run.id,
        memberId: input.memberId,
        status: { in: [...ACTIVE_RUN_STATUSES] },
      },
    });
    if (updatedRun.count !== 1) throw staleRunError();
  });
}

export async function appendClinicalRetrievalWakeTx(input: {
  generation: number;
  memberId: string;
  occurredAt: Date;
  runId: string;
  tx: ClinicalRetrievalTx;
}): Promise<ClinicalMailboxCheckpoint> {
  const appended = await appendHostedMailboxEnvelopeTx({
    envelope: buildHostedExecutionClinicalRecordsSyncRequestedWake({
      eventId: `clinical-records:sync:v1:${input.runId}:${input.generation}`,
      generation: input.generation,
      occurredAt: input.occurredAt.toISOString(),
      runId: input.runId,
      userId: input.memberId,
    }),
    tx: input.tx,
  });
  if (appended.dedupeConflict) {
    throw clinicalRecordsError({
      code: "CLINICAL_RECORD_WAKE_DEDUPE_CONFLICT",
      httpStatus: 503,
      message: "The Clinical Records retrieval wake conflicted with existing work.",
      retryable: true,
    });
  }
  return {
    id: appended.item.id,
    lane: appended.item.lane,
    laneSeq: appended.item.laneSeq,
    userId: input.memberId,
  };
}

export async function signalClinicalRetrievalWake(
  checkpoint: ClinicalMailboxCheckpoint,
): Promise<void> {
  try {
    await signalHostedMailboxAppendRuntime({
      expectedUserId: checkpoint.userId,
      knownCheckpoint: {
        lane: checkpoint.lane,
        laneSeq: checkpoint.laneSeq,
        userId: checkpoint.userId,
      },
      mailboxItemId: checkpoint.id,
    });
  } catch (error) {
    console.warn("Clinical Records retrieval wake signal failed after durable mailbox append.", {
      errorType: error instanceof Error ? error.name : "UnknownError",
      mailboxItemIdPresent: checkpoint.id.length > 0,
    });
  }
}

function buildRetrievalScopes(
  resourceTypes: readonly HostedClinicalRecordsFetchPageRequest["resourceType"][],
): HostedClinicalRecordsRetrievalScope[] {
  return resourceTypes.map((resourceType) => ({
    coverage: "whole-family",
    queryFingerprint: sha256Hex(
      resourceType === "Patient"
        ? "fhir-r4:Patient:read-by-launch-patient:v1"
        : `fhir-r4:${resourceType}:search:patient:_count=${FHIR_PAGE_COUNT}:v1`,
    ),
    resourceType,
  }));
}

async function loadRunnableClinicalRun(input: {
  generation: number;
  memberId: string;
  runId: string;
}): Promise<
  | { run: RunnableClinicalRun }
  | { retryable: boolean; unavailable: string }
> {
  const record = await getPrisma().clinicalRecordRetrievalRun.findFirst({
    include: { connection: true },
    where: {
      generation: input.generation,
      id: input.runId,
      memberId: input.memberId,
    },
  });
  if (!record) return { retryable: false, unavailable: "run-not-found" };
  if (record.connection.retrievalGeneration !== record.generation) {
    return { retryable: false, unavailable: "run-generation-stale" };
  }
  if (record.connection.status === "needs_reauth") {
    return {
      retryable: false,
      unavailable: HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE,
    };
  }
  if (TERMINAL_RUN_STATUSES.has(record.status)) {
    return { retryable: false, unavailable: "run-already-terminal" };
  }
  if (!ACTIVE_RUN_STATUSES.has(record.status)) {
    return { retryable: false, unavailable: "run-status-invalid" };
  }
  if (record.connection.status !== "active" && record.connection.status !== "error") {
    return { retryable: false, unavailable: "connection-inactive" };
  }
  if (
    !record.connection.patientIdEncrypted
    || !record.connection.accessTokenEncrypted
  ) {
    return { retryable: false, unavailable: "credentials-unavailable" };
  }
  let resourceTypes: HostedClinicalRecordsFetchPageRequest["resourceType"][];
  let sourceSystem: ClinicalSourceSystem;
  try {
    resourceTypes = parseStoredResourceTypes(record.resourceTypesJson);
    sourceSystem = clinicalSourceSystemSchema.parse(record.connection.sourceSystem);
  } catch {
    return { retryable: false, unavailable: "run-configuration-invalid" };
  }
  return {
    run: {
      connection: { ...record.connection, sourceSystem },
      createdAt: record.createdAt,
      egressBytes: record.egressBytes,
      fetchedBytes: record.fetchedBytes,
      generation: record.generation,
      grantedScopesJson: record.grantedScopesJson,
      id: record.id,
      memberId: record.memberId,
      pageCount: record.pageCount,
      providerRequestCount: record.providerRequestCount,
      resourceTypes,
      status: record.status,
    },
  };
}

function buildInitialFhirPageUrl(input: {
  fhirBaseUrl: string;
  patientId: string;
  resourceType: string;
}): URL {
  const base = input.fhirBaseUrl.replace(/\/+$/u, "");
  if (input.resourceType === "Patient") {
    return new URL(`${base}/Patient/${encodeURIComponent(input.patientId)}`);
  }
  const url = new URL(`${base}/${input.resourceType}`);
  url.searchParams.set("_count", FHIR_PAGE_COUNT);
  url.searchParams.set("patient", input.patientId);
  return url;
}

function parsePageCursor(plaintext: string): ValidatedFhirPageUrl {
  const parsed: unknown = JSON.parse(plaintext);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Invalid cursor.");
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "schema,url"
    || record.schema !== "murph.clinical-page-cursor.v2"
    || typeof record.url !== "string"
    || hasSurroundingAsciiWhitespace(record.url)
    || record.url.length > FHIR_NEXT_URL_MAX_CHARS
  ) throw new TypeError("Invalid cursor.");
  return { raw: record.url, url: new URL(record.url) };
}

function assertFhirPageUrlAllowed(input: {
  candidate: URL;
  fhirBaseUrl: string;
  initialPatientRead?: boolean;
  resourceType: string;
}): void {
  const base = new URL(input.fhirBaseUrl);
  const basePath = base.pathname.replace(/\/+$/u, "");
  const expectedResourcePath = `${basePath}/${input.resourceType}`;
  const pathAllowed = input.initialPatientRead
    ? input.candidate.pathname.startsWith(`${expectedResourcePath}/`)
      && input.candidate.pathname.slice(expectedResourcePath.length + 1).length > 0
      && !input.candidate.pathname.slice(expectedResourcePath.length + 1).includes("/")
    : input.candidate.pathname === expectedResourcePath;
  if (
    input.candidate.protocol !== "https:"
    || input.candidate.origin !== base.origin
    || input.candidate.username
    || input.candidate.password
    || input.candidate.hash
    || !pathAllowed
  ) throw new TypeError("FHIR page URL escaped the configured endpoint.");
}

async function requireCurrentAccessToken(input: {
  fetchImpl?: typeof fetch;
  memberId: string;
  run: RunnableClinicalRun;
}): Promise<string> {
  const connection = input.run.connection;
  const patientId = requireFhirPatientId(await openClinicalConnectionSecret({
    connectionId: connection.id,
    encrypted: connection.patientIdEncrypted,
    field: "patientId",
    memberId: input.memberId,
    tokenVersion: connection.tokenVersion,
  }));
  const shouldRefresh = connection.accessTokenExpiresAt !== null
    && connection.accessTokenExpiresAt.getTime() <= Date.now() + TOKEN_REFRESH_LEEWAY_MS;
  if (!shouldRefresh) {
    const accessToken = await openClinicalConnectionSecret({
      connectionId: connection.id,
      encrypted: connection.accessTokenEncrypted,
      field: "accessToken",
      memberId: input.memberId,
      tokenVersion: connection.tokenVersion,
    });
    if (!accessToken) throw reauthRequiredError();
    return accessToken;
  }
  const refreshToken = await openClinicalConnectionSecret({
    connectionId: connection.id,
    encrypted: connection.refreshTokenEncrypted,
    field: "refreshToken",
    memberId: input.memberId,
    tokenVersion: connection.tokenVersion,
  });
  if (!refreshToken) throw reauthRequiredError();
  const grantedScopes = parseStoredStringArray(connection.grantedScopesJson, "granted scopes");
  const refreshed = await refreshSmartAccessToken({
    clientId: connection.clientId,
    fetchImpl: input.fetchImpl,
    grantedScopes,
    refreshToken,
    resourceTypes: input.run.resourceTypes,
    tokenEndpoint: connection.tokenEndpoint,
  });
  const nextTokenVersion = connection.tokenVersion + 1;
  const nextPatientEncrypted = await sealClinicalConnectionSecret({
    connectionId: connection.id,
    field: "patientId",
    memberId: input.memberId,
    tokenVersion: nextTokenVersion,
    value: patientId,
  });
  const nextAccessEncrypted = await sealClinicalConnectionSecret({
    connectionId: connection.id,
    field: "accessToken",
    memberId: input.memberId,
    tokenVersion: nextTokenVersion,
    value: refreshed.accessToken,
  });
  const nextRefreshEncrypted = await sealClinicalConnectionSecret({
    connectionId: connection.id,
    field: "refreshToken",
    memberId: input.memberId,
    tokenVersion: nextTokenVersion,
    value: refreshed.refreshToken ?? refreshToken,
  });
  if (!nextPatientEncrypted || !nextAccessEncrypted || !nextRefreshEncrypted) {
    throw new TypeError("Clinical Records refreshed credential encryption failed.");
  }
  const updated = await getPrisma().clinicalRecordConnection.updateMany({
    data: {
      accessTokenEncrypted: nextAccessEncrypted,
      accessTokenExpiresAt: refreshed.expiresInSeconds
        ? new Date(Date.now() + refreshed.expiresInSeconds * 1_000)
        : null,
      grantedScopesJson: toClinicalJsonArray(refreshed.grantedScopes),
      patientIdEncrypted: nextPatientEncrypted,
      refreshTokenEncrypted: nextRefreshEncrypted,
      tokenVersion: nextTokenVersion,
    },
    where: {
      id: connection.id,
      memberId: input.memberId,
      retrievalGeneration: input.run.generation,
      status: { in: ["active", "error"] },
      tokenVersion: connection.tokenVersion,
    },
  });
  if (updated.count !== 1) {
    throw clinicalRecordsError({
      code: "CLINICAL_RECORD_CREDENTIALS_UPDATED",
      httpStatus: 409,
      message: "Clinical Records credentials changed during refresh.",
      retryable: true,
    });
  }
  return refreshed.accessToken;
}

async function fetchFhirPage(input: {
  accessToken: string;
  fetchImpl?: typeof fetch;
  pageUrl: URL;
}): Promise<Response> {
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(input.pageUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/fhir+json, application/json",
        Authorization: `Bearer ${input.accessToken}`,
      },
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(FHIR_REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw clinicalRecordsError({
      cause,
      code: "CLINICAL_RECORD_FHIR_FETCH_FAILED",
      httpStatus: 503,
      message: "The Clinical Records provider is temporarily unavailable.",
      retryable: true,
    });
  }
  if (response.status === 401) throw reauthRequiredError();
  if (response.status === 403) {
    throw clinicalRecordsError({
      code: "CLINICAL_RECORD_FHIR_FAMILY_UNAVAILABLE",
      httpStatus: 403,
      message: "This Clinical Records family is unavailable from the provider.",
    });
  }
  if (!response.ok) {
    throw clinicalRecordsError({
      code: "CLINICAL_RECORD_FHIR_FETCH_FAILED",
      httpStatus: response.status >= 500 || response.status === 429 ? 503 : 502,
      message: "The Clinical Records provider did not return the requested page.",
      retryable: response.status >= 500 || response.status === 429,
    });
  }
  return response;
}

async function readSanitizedFhirPage(input: {
  fhirBaseUrl: string;
  resourceType: string;
  response: Response;
}): Promise<{ body: string; bodyBytes: number; nextUrl: ValidatedFhirPageUrl | null }> {
  const contentType = input.response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !contentType.includes("json")) throw invalidFhirResponseError();
  let bytes: Uint8Array;
  try {
    bytes = await readClinicalResponseBytes(
      input.response,
      HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS,
    );
  } catch (cause) {
    if (cause instanceof ClinicalResponseBodyLimitError) throw invalidFhirResponseError();
    throw clinicalRecordsError({
      cause,
      code: "CLINICAL_RECORD_FHIR_FETCH_FAILED",
      httpStatus: 503,
      message: "The Clinical Records provider response stream failed.",
      retryable: true,
    });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(decodeClinicalResponseUtf8(bytes));
  } catch (cause) {
    throw clinicalRecordsError({
      cause,
      code: "CLINICAL_RECORD_FHIR_RESPONSE_INVALID",
      httpStatus: 502,
      message: "The Clinical Records provider returned invalid FHIR JSON.",
    });
  }
  const record = requireRecord(raw);
  let validated: Record<string, unknown>;
  let nextUrl: ValidatedFhirPageUrl | null = null;
  if (input.resourceType === "Patient") {
    if (record.resourceType !== "Patient") throw invalidFhirResponseError();
    validated = record;
  } else {
    if (record.resourceType !== "Bundle") throw invalidFhirResponseError();
    const entries = record.entry === undefined ? [] : requireBoundedArray(record.entry, 500);
    entries.forEach((entry) => {
      const entryRecord = requireRecord(entry);
      const resource = requireRecord(entryRecord.resource);
      if (resource.resourceType !== input.resourceType) throw invalidFhirResponseError();
    });
    nextUrl = readNextFhirUrl(record.link, input.fhirBaseUrl, input.resourceType);
    validated = record;
  }
  const body = JSON.stringify(validated);
  const bodyBytes = new TextEncoder().encode(body).byteLength;
  if (body.length > HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS || bodyBytes > HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS) {
    throw invalidFhirResponseError();
  }
  return { body, bodyBytes, nextUrl };
}

function readNextFhirUrl(
  value: unknown,
  fhirBaseUrl: string,
  resourceType: string,
): ValidatedFhirPageUrl | null {
  if (value === undefined) return null;
  const links = requireBoundedArray(value, 16);
  let next: ValidatedFhirPageUrl | null = null;
  for (const link of links) {
    const record = requireRecord(link);
    if (record.relation !== "next") continue;
    if (
      next
      || typeof record.url !== "string"
      || hasSurroundingAsciiWhitespace(record.url)
      || record.url.length > FHIR_NEXT_URL_MAX_CHARS
    ) {
      throw invalidFhirResponseError();
    }
    const url = new URL(record.url);
    assertFhirPageUrlAllowed({
      candidate: url,
      fhirBaseUrl,
      resourceType,
    });
    next = { raw: record.url, url };
  }
  return next;
}

function hasSurroundingAsciiWhitespace(value: string): boolean {
  return /^[\u0009-\u000D\u0020]|[\u0009-\u000D\u0020]$/u.test(value);
}

async function claimRetrievalPageRequest(input: {
  connectionId: string;
  generation: number;
  memberId: string;
  requestFingerprint: string;
  runId: string;
}): Promise<
  | { claimed: false; errorCode: string; retryable: boolean }
  | {
      claimed: true;
      claimVersion: number;
      isFirstCompletion: boolean;
      previousCompletedAt: Date | null;
      requestRowId: string;
    }
> {
  const prisma = getPrisma();
  const now = new Date();
  const candidateId = `${RETRIEVAL_REQUEST_ID_PREFIX}${randomBytes(16).toString("base64url")}`;
  const record = await prisma.clinicalRecordRetrievalRequest.upsert({
    create: {
      claimedAt: new Date(0),
      connectionId: input.connectionId,
      generation: input.generation,
      id: candidateId,
      memberId: input.memberId,
      requestFingerprint: input.requestFingerprint,
      runId: input.runId,
    },
    update: {},
    where: {
      runId_requestFingerprint: {
        requestFingerprint: input.requestFingerprint,
        runId: input.runId,
      },
    },
  });
  if (
    record.memberId !== input.memberId
    || record.connectionId !== input.connectionId
    || record.generation !== input.generation
  ) return { claimed: false, errorCode: "request-page-conflict", retryable: false };
  const isFirstCompletion = record.responseBytes === null;
  const previousCompletedAt = record.completedAt;
  const staleBefore = new Date(now.getTime() - PAGE_REQUEST_CLAIM_STALE_MS);
  try {
    return await prisma.$transaction(async (tx) => {
      const reclaimed = await tx.clinicalRecordRetrievalRequest.updateMany({
        data: {
          claimVersion: { increment: 1 },
          claimedAt: now,
          completedAt: null,
          reservedBytes: PAGE_EGRESS_RESERVATION_BYTES,
        },
        where: {
          claimVersion: record.claimVersion,
          id: record.id,
          OR: [
            { completedAt: { not: null }, reservedBytes: 0 },
            { claimedAt: { lte: staleBefore } },
          ],
        },
      });
      if (reclaimed.count !== 1) {
        return { claimed: false, errorCode: "request-in-progress", retryable: true } as const;
      }
      const reserved = await tx.clinicalRecordRetrievalRun.updateMany({
        data: {
          egressBytes: { increment: PAGE_EGRESS_RESERVATION_BYTES },
          providerRequestCount: { increment: 1 },
          startedAt: now,
          status: "retrieving",
        },
        where: {
          completedAt: null,
          egressBytes: {
            lte: HOSTED_CLINICAL_RECORDS_MAX_TOTAL_BODY_BYTES - PAGE_EGRESS_RESERVATION_BYTES,
          },
          generation: input.generation,
          id: input.runId,
          memberId: input.memberId,
          providerRequestCount: { lt: HOSTED_CLINICAL_RECORDS_MAX_PAGES },
          status: { in: [...ACTIVE_RUN_STATUSES] },
        },
      });
      if (reserved.count !== 1) throw new ClinicalRetrievalClaimRejection();
      return {
        claimed: true,
        claimVersion: record.claimVersion + 1,
        isFirstCompletion,
        previousCompletedAt,
        requestRowId: record.id,
      } as const;
    });
  } catch (error) {
    if (error instanceof ClinicalRetrievalClaimRejection) {
      return { claimed: false, errorCode: "retrieval-bound-reached", retryable: false };
    }
    throw error;
  }
}

async function completeRetrievalPageRequest(input: {
  bodyBytes: number;
  claimVersion: number;
  isFirstCompletion: boolean;
  requestRowId: string;
  run: RunnableClinicalRun;
}): Promise<boolean> {
  const now = new Date();
  return getPrisma().$transaction(async (tx) => {
    const completed = await tx.clinicalRecordRetrievalRequest.updateMany({
      data: { completedAt: now, reservedBytes: 0, responseBytes: input.bodyBytes },
      where: {
        claimVersion: input.claimVersion,
        completedAt: null,
        id: input.requestRowId,
        reservedBytes: PAGE_EGRESS_RESERVATION_BYTES,
        responseBytes: input.isFirstCompletion ? null : { not: null },
      },
    });
    if (completed.count !== 1) return false;
    const updated = await tx.clinicalRecordRetrievalRun.updateMany({
      data: {
        egressBytes: { decrement: PAGE_EGRESS_RESERVATION_BYTES - input.bodyBytes },
        fetchedBytes: { increment: input.bodyBytes },
        pageCount: input.isFirstCompletion ? { increment: 1 } : undefined,
      },
      where: {
        completedAt: null,
        generation: input.run.generation,
        id: input.run.id,
        memberId: input.run.memberId,
        status: { in: [...ACTIVE_RUN_STATUSES] },
      },
    });
    if (updated.count !== 1) {
      throw clinicalRecordsError({
        code: "CLINICAL_RECORD_RETRIEVAL_BOUND_REACHED",
        httpStatus: 409,
        message: "The Clinical Records retrieval bound was reached.",
      });
    }
    return true;
  });
}

async function releaseRetrievalPageRequest(input: {
  chargeReservation: boolean;
  claimVersion: number;
  previousCompletedAt: Date | null;
  requestRowId: string;
  run: RunnableClinicalRun;
}): Promise<void> {
  await getPrisma().$transaction(async (tx) => {
    const released = await tx.clinicalRecordRetrievalRequest.updateMany({
      data: {
        claimedAt: new Date(0),
        completedAt: input.previousCompletedAt,
        reservedBytes: 0,
      },
      where: {
        claimVersion: input.claimVersion,
        completedAt: null,
        id: input.requestRowId,
        reservedBytes: PAGE_EGRESS_RESERVATION_BYTES,
      },
    });
    if (released.count !== 1 || input.chargeReservation) return;
    await tx.clinicalRecordRetrievalRun.updateMany({
      data: { egressBytes: { decrement: PAGE_EGRESS_RESERVATION_BYTES } },
      where: {
        completedAt: null,
        generation: input.run.generation,
        id: input.run.id,
        memberId: input.run.memberId,
        status: { in: [...ACTIVE_RUN_STATUSES] },
      },
    });
  });
}

class ClinicalRetrievalClaimRejection extends Error {}

async function markClinicalConnectionNeedsReauth(input: {
  connectionId: string;
  generation: number;
  memberId: string;
  observedTokenVersion: number;
  runId: string;
}): Promise<boolean> {
  const now = new Date();
  return getPrisma().$transaction(async (tx) => {
    const connection = await tx.clinicalRecordConnection.updateMany({
      data: {
        accessTokenEncrypted: null,
        accessTokenExpiresAt: null,
        lastErrorCode: HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE,
        patientIdEncrypted: null,
        refreshTokenEncrypted: null,
        status: "needs_reauth",
      },
      where: {
        id: input.connectionId,
        memberId: input.memberId,
        retrievalGeneration: input.generation,
        status: { in: ["active", "error"] },
        tokenVersion: input.observedTokenVersion,
      },
    });
    if (connection.count !== 1) return false;
    await tx.clinicalRecordRetrievalRun.updateMany({
      data: {
        completedAt: now,
        lastErrorCode: HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE,
        status: "needs_reauth",
      },
      where: {
        completedAt: null,
        generation: input.generation,
        id: input.runId,
        memberId: input.memberId,
      },
    });
    return true;
  });
}

function unavailable(
  errorCode: string,
  retryable: boolean,
): HostedClinicalRecordsReadRunResponse & HostedClinicalRecordsFetchPageResponse {
  return { errorCode, retryable, status: "unavailable" };
}

function mapOutcomeStatus(status: HostedClinicalRecordsRecordOutcomeRequest["status"]): string {
  if (status === "completed") return "complete";
  return status;
}

function parseStoredResourceTypes(
  value: Prisma.JsonValue,
): HostedClinicalRecordsFetchPageRequest["resourceType"][] {
  const types = parseStoredStringArray(value, "resource types");
  const resourceTypes = types.filter(isClinicalFhirResourceType);
  if (resourceTypes.length !== types.length) {
    throw new TypeError("Stored Clinical Records resource types are invalid.");
  }
  return resourceTypes;
}

function isClinicalFhirResourceType(
  value: string,
): value is HostedClinicalRecordsFetchPageRequest["resourceType"] {
  return ALLOWED_RESOURCE_TYPES.has(value);
}

function parseStoredStringArray(value: Prisma.JsonValue, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw new TypeError(`Stored Clinical Records ${label} are invalid.`);
  }
  const strings = value.filter((item): item is string =>
    typeof item === "string" && item.length > 0 && item.length <= 200
  );
  if (strings.length !== value.length || new Set(strings).size !== strings.length) {
    throw new TypeError(`Stored Clinical Records ${label} are invalid.`);
  }
  return strings;
}

function requireFhirPatientId(value: string | null): string {
  if (!value || !FHIR_PATIENT_ID_PATTERN.test(value)) throw reauthRequiredError();
  return value;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidFhirResponseError();
  return value as Record<string, unknown>;
}

function requireBoundedArray(value: unknown, maxLength: number): unknown[] {
  if (!Array.isArray(value) || value.length > maxLength) throw invalidFhirResponseError();
  return value;
}

function invalidFhirResponseError() {
  return clinicalRecordsError({
    code: "CLINICAL_RECORD_FHIR_RESPONSE_INVALID",
    httpStatus: 502,
    message: "The Clinical Records provider returned invalid FHIR JSON.",
  });
}

function reauthRequiredError() {
  return clinicalRecordsError({
    code: "CLINICAL_RECORD_SMART_REAUTH_REQUIRED",
    httpStatus: 401,
    message: "The Clinical Records connection needs authorization again.",
  });
}

function staleRunError() {
  return clinicalRecordsError({
    code: "CLINICAL_RECORD_RUN_STALE",
    httpStatus: 409,
    message: "The Clinical Records retrieval run is no longer current.",
  });
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: Prisma.JsonValue | HostedClinicalRecordsOutcomeCounts | null): string {
  return JSON.stringify(canonicalizeJson(value));
}

function canonicalizeJson(
  value: Prisma.JsonValue | HostedClinicalRecordsOutcomeCounts | null | undefined,
): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalizeJson(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalizeJson(item)]),
    );
  }
  return value;
}
