import { CLINICAL_RECEIPT_PROTOCOL, type ClinicalRetrievalProtocol } from "@murphai/clinical-records/retrieval-limits";
import { ContractValidationError } from "@murphai/contracts/validation-error";
import "server-only";
import { hasClinicalProcessorApprovals } from "./processor-registry";

import { renewClinicalAccess, CLEAR_CLINICAL_PERSISTENT_ACCESS, clinicalCredentialsAfterCheck } from "./persistent-access";

import { publishClinicalChangeTx } from "./notification";
import { closeClinicalRunTx } from "./run-lifecycle";
import { CLINICAL_RECORD_OPEN_RUN_STATUSES, CLINICAL_RECORD_TERMINAL_RUN_STATUSES } from "./client-contracts";
import { epicImportQueryEnabled } from "./epic-import-config";

import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { readClinicalTransportAccess } from "./transport-access";

import { createHash, randomBytes } from "node:crypto";

import {
  clinicalFhirRetrievalPlanSchema,
  clinicalSourceSystemSchema,
  hashClinicalFhirPageUrl,
  hashClinicalFhirPatientId,
  type ClinicalFhirRetrievalSlice,
  type ClinicalSourceSystem,
  type ClinicalFhirRetrievalPlan,
} from "@murphai/clinical-records";
import {
  buildHostedExecutionClinicalRecordsSyncRequestedWake,
  HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS,
  HOSTED_CLINICAL_RECORDS_FETCH_DOCUMENT_RESPONSE_MAX_BYTES,
  HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE,
  type HostedClinicalRecordsFetchDocumentRequest,
  type HostedClinicalRecordsFetchDocumentResponse,
  type HostedClinicalRecordsFetchPageRequest,
  type HostedClinicalRecordsFetchPageResponse,
  type HostedClinicalRecordsOutcomeCounts,
  type HostedClinicalRecordsReadRunResponse,
  type HostedClinicalRecordsRecordOutcomeRequest,
  type HostedClinicalRecordsRunDescriptor,
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
  openClinicalDocumentTicket,
  sealClinicalPageCursor,
} from "./secrets";
import {
  clinicalRecordsError,
  isClinicalRecordsControlPlaneError,
} from "./errors";
import {
  buildEpicBetaInitialFhirPageUrl,
  EPIC_BETA_FHIR_PAGE_COUNT,
  epicBinaryReadIsGranted,
  epicMediaReadIsGranted,
} from "./epic-policy";
import {
  ClinicalResponseBodyLimitError,
  decodeClinicalResponseUtf8,
  readClinicalResponseBytes,
} from "./response-bytes";

import {
  clinicalDocumentTicketSchema,
  issueClinicalDocumentTickets,
  readClinicalMediaResponse,
  readClinicalDocumentResponse,
  resolveClinicalDocumentUrl,
} from "./documents";

const FHIR_REQUEST_TIMEOUT_MS = 20_000;
const FHIR_NEXT_URL_MAX_CHARS = 1_024;
const PAGE_REQUEST_CLAIM_STALE_MS = 30_000;
const PAGE_EGRESS_RESERVATION_BYTES = HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS;
const DOCUMENT_MEDIA_RESPONSE_MAX_BYTES = 64 * 1024;
const DOCUMENT_EGRESS_RESERVATION_BYTES = HOSTED_CLINICAL_RECORDS_FETCH_DOCUMENT_RESPONSE_MAX_BYTES
  + DOCUMENT_MEDIA_RESPONSE_MAX_BYTES;
// PostgreSQL Int columns retain cumulative accounting; this is a storage safety
// ceiling, not the former small-chart retrieval budget. Execution yields locally.
const RETRIEVAL_COUNTER_MAX = 2_147_483_647;
const MAX_LOGICAL_REQUEST_CLAIM_VERSION = 20;
const TOKEN_EXPIRY_LEEWAY_MS = 60_000;
const RETRIEVAL_REQUEST_ID_PREFIX = "crq_";
const FHIR_PATIENT_ID_PATTERN = /^[A-Za-z0-9.-]{1,64}$/u;
type ClinicalRetrievalTx = Prisma.TransactionClient;

interface ClinicalMailboxCheckpoint {
  id: string;
  lane: "system" | "conversation";
  laneSeq: string;
  userId: string;
}

interface RunnableClinicalRun {
  connection: {
    requiresProcessorApprovals: boolean | null;
    accessTokenEncrypted: string | null;
    accessTokenExpiresAt: Date | null;
    refreshTokenEncrypted: string | null;
    fhirBaseHash: string;
    fhirBaseUrlEncrypted: string;
    id: string;
    patientIdEncrypted: string | null;
    providerDirectoryEntryId: string;
    requestedScopesJson: Prisma.JsonValue;
    retrievalGeneration: number;
    sourceSystem: ClinicalSourceSystem;
    status: string;
    tokenVersion: number;
  };
  createdAt: Date;
  startedAt: Date | null;
  egressBytes: number;
  generation: number;
  grantedScopes: string[];
  requestedScopes: string[];
  id: string;
  memberId: string;
  pageCount: number;
  providerRequestCount: number;
  retrievalPlan: ClinicalFhirRetrievalPlan;
  retrievalProtocol: ClinicalRetrievalProtocol;
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
}): Promise<
  | { run: HostedClinicalRecordsRunDescriptor; status: "ready" }
  | Extract<HostedClinicalRecordsReadRunResponse, { status: "unavailable" }>
> {
  const loaded = await loadRunnableClinicalRun(input);
  if ("unavailable" in loaded) return unavailable(loaded.unavailable, loaded.retryable);
  const run = loaded.run;
  const { requestedScopes, grantedScopes } = run;
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
    const closed = await getPrisma().$transaction(async tx => {
      await lockHostedMemberRow(tx, input.memberId);
      return endUnusableRunTx(tx, input, run.connection, "patient-context-unavailable");
    });
    return closed ? unavailable("patient-context-unavailable", false) : unavailable("credentials-updated-retry", true);
  }
  const runDescriptorBase = {
    connectionId: run.connection.id,
    fetchedAt: run.createdAt.toISOString(),
    fhirBaseUrlHash: run.connection.fhirBaseHash,
    generation: run.generation,
    grantedScopes,
    patientIdHash,
    providerDirectoryEntryId: run.connection.providerDirectoryEntryId,
    requestedScopes,
    retrievalJobId: run.id,
    runId: run.id,
    sourceSystem: run.connection.sourceSystem,
  } as const;
  return {
    run: { ...runDescriptorBase, retrievalProtocol: run.retrievalProtocol, retrievalSlices: run.retrievalPlan.slices },
    status: "ready",
  };
}

export async function fetchClinicalRetrievalPage(input: {
  fetchImpl?: typeof fetch;
  memberId: string;
  request: HostedClinicalRecordsFetchPageRequest;
}): Promise<HostedClinicalRecordsFetchPageResponse> {
  const loaded = await loadRunnableClinicalRun({
    expectedProtocol: input.request.retrievalProtocol,
    generation: input.request.generation,
    memberId: input.memberId,
    runId: input.request.runId,
  });
  if ("unavailable" in loaded) return unavailable(loaded.unavailable, loaded.retryable);
  const run = loaded.run;
  const retrievalSlice = resolveRequestedRetrievalSlice(run, input.request);
  if (!retrievalSlice) {
    return unavailable("retrieval-identity-mismatch", false);
  }
  if (!epicImportQueryEnabled(run.connection.providerDirectoryEntryId, retrievalSlice.queryScopeId)) {
    return unavailable("hospital-approval-required", false);
  }
  if (!run.resourceTypes.includes(input.request.resourceType)) {
    return unavailable("resource-family-not-requested", false);
  }
  if (
    run.providerRequestCount >= RETRIEVAL_COUNTER_MAX
    || run.egressBytes > RETRIEVAL_COUNTER_MAX - PAGE_EGRESS_RESERVATION_BYTES
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
        ...queryCursorIdentity(retrievalSlice, run.retrievalProtocol),
        resourceType: input.request.resourceType,
        runId: run.id,
        value: input.request.cursor,
      })
    : null;
  let pageUrl: ValidatedFhirPageUrl;
  try {
    const patientId = requireFhirPatientId(openedPatientId);
    pageUrl = openedCursor
      ? parsePageCursor(
          openedCursor,
          retrievalSlice,
        )
      : (() => {
          const url = buildInitialFhirPageUrl({
            fhirBaseUrl,
            patientId,
            retrievalSlice,
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

  const pageUrlHash = hashClinicalFhirPageUrl(pageUrl.raw);
  const requestFingerprint = sha256Hex([
        run.connection.id,
        String(run.generation),
        run.id,
        retrievalSlice.queryScopeId,
        retrievalSlice.resourceType,
        retrievalSlice.queryFingerprint,
        retrievalSlice.sliceId,
        pageUrlHash,
      ].join("\n"));
  const claimed = await claimRetrievalPageRequest({
    requiresProcessorApprovals: run.connection.requiresProcessorApprovals,
    firstStart: run.startedAt === null,
    connectionId: run.connection.id,
    generation: run.generation,
    memberId: input.memberId,
    queryScopeId: retrievalSlice.queryScopeId,
    sliceId: retrievalSlice.sliceId,
    requestFingerprint,
    runId: run.id,
  });
  if (!claimed.claimed) return unavailable(claimed.errorCode, claimed.retryable);

  let providerRequestStarted = false;
  try {
    const accessToken = await requireCurrentAccessToken({
      memberId: input.memberId,
      fetchImpl: input.fetchImpl,
      run,
    });
    providerRequestStarted = true;
    const response = await fetchFhirPage({
      accessToken,
      fetchImpl: input.fetchImpl,
      pageUrl: pageUrl.url,
    });
    return await finishClinicalRetrievalPage({ response, input, run, retrievalSlice, pageUrl,
      fhirBaseUrl, openedPatientId: requireFhirPatientId(openedPatientId), claimed });
  } catch (error) {
    await releaseRetrievalPageRequest({
      chargeReservation: providerRequestStarted,
      claimVersion: claimed.claimVersion,
      previousCompletedAt: claimed.previousCompletedAt,
      requestRowId: claimed.requestRowId,
      run,
    });
    if (isInvalidClinicalResponse(error)) return unavailable("provider-response-invalid", false);
    if (isClinicalRecordsControlPlaneError(error)) {
      if (error.code === "CLINICAL_RECORD_SMART_REAUTH_REQUIRED") {
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

/** Reads only a server-attested attachment from a currently authorized run. */
export async function fetchClinicalRetrievalDocument(input: {
  fetchImpl?: typeof fetch;
  memberId: string;
  request: HostedClinicalRecordsFetchDocumentRequest;
}): Promise<HostedClinicalRecordsFetchDocumentResponse> {
  const loaded = await loadRunnableClinicalRun({ expectedProtocol: input.request.retrievalProtocol ?? "query-slices-v2", generation: input.request.generation,
    memberId: input.memberId, runId: input.request.runId });
  if ("unavailable" in loaded) return unavailable(loaded.unavailable, loaded.retryable);
  const run = loaded.run;
  const { grantedScopes } = run;
  if (!epicBinaryReadIsGranted(grantedScopes)) return unavailable("document-scope-unavailable", false);
  const prepared = await loadClinicalDocumentRequest({ input, run, grantedScopes });
  if ("unavailable" in prepared) return unavailable(prepared.unavailable, prepared.retryable);
  const { ticket, url, fhirBaseUrl, patientIdHash } = prepared;
  // Ciphertext is randomized; the attested parent and URL own logical identity.
  const requestFingerprint = sha256Hex(["document", run.connection.id, String(run.generation), run.id,
    ticket.queryScopeId, ticket.sliceId, ticket.parentPageSha256, ticket.resourceType,
    ticket.resourceId, ticket.resourceVersion ?? "", String(ticket.attachmentIndex), url.href].join("\n"));
  const claimed = await claimRetrievalPageRequest({
    requiresProcessorApprovals: run.connection.requiresProcessorApprovals,
    firstStart: run.startedAt === null, connectionId: run.connection.id,
    generation: run.generation, memberId: input.memberId, queryScopeId: ticket.queryScopeId,
    sliceId: ticket.sliceId, requestFingerprint, runId: run.id,
    reservationBytes: DOCUMENT_EGRESS_RESERVATION_BYTES });
  if (!claimed.claimed) return unavailable(claimed.errorCode, claimed.retryable);
  let providerRequestStarted = false;
  try {
    const accessToken = await requireCurrentAccessToken({ memberId: input.memberId, fetchImpl: input.fetchImpl, run });
    providerRequestStarted = true;
    const response = await fetchFhirPage({ accessToken, fetchImpl: input.fetchImpl, pageUrl: url,
      accept: "application/fhir+json, application/json, */*;q=0.5" });
    const document = (ticket.sourceKind ?? "binary") === "media"
      ? await fetchMediaDocument({ response, mediaUrl: url, fhirBaseUrl, patientIdHash, accessToken, fetchImpl: input.fetchImpl, ticket })
      : await readClinicalDocumentResponse({ response, ticket, url,
      maxResponseBytes: DOCUMENT_EGRESS_RESERVATION_BYTES });
    const accounted = await completeRetrievalPageRequest({ bodyBytes: document.bytes.length,
      receivedBytes: document.receivedBytes, claimVersion: claimed.claimVersion,
      isFirstCompletion: claimed.isFirstCompletion, requestRowId: claimed.requestRowId, run,
      countAsPage: false, reservationBytes: DOCUMENT_EGRESS_RESERVATION_BYTES });
    if (!accounted) return unavailable("request-superseded", true);
    return { status: "document", contentBase64: document.bytes.toString("base64"),
      mediaType: document.mediaType, byteLength: document.bytes.length,
      sha256: createHash("sha256").update(document.bytes).digest("hex") };
  } catch (error) {
    await releaseRetrievalPageRequest({ chargeReservation: providerRequestStarted,
      claimVersion: claimed.claimVersion, previousCompletedAt: claimed.previousCompletedAt,
      requestRowId: claimed.requestRowId, run, reservationBytes: DOCUMENT_EGRESS_RESERVATION_BYTES });
    if (isClinicalRecordsControlPlaneError(error) && error.code === "CLINICAL_RECORD_SMART_REAUTH_REQUIRED") {
      const marked = await markClinicalConnectionNeedsReauth({ connectionId: run.connection.id,
        generation: run.generation, memberId: input.memberId,
        observedTokenVersion: run.connection.tokenVersion, runId: run.id });
      return marked ? unavailable(HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE, false)
        : unavailable("credentials-updated-retry", true);
    }
    if (error instanceof ClinicalResponseBodyLimitError) return unavailable("document-size-exceeded", false);
    if (isInvalidClinicalResponse(error) || error instanceof SyntaxError) return unavailable("document-response-invalid", false);
    if (isClinicalRecordsControlPlaneError(error)) {
      return unavailable(error.code === "CLINICAL_RECORD_FHIR_FAMILY_UNAVAILABLE"
        ? "document-unavailable" : error.retryable ? "provider-temporarily-unavailable" : "document-response-invalid", error.retryable);
    }
    throw error;
  }
}

async function loadClinicalDocumentRequest(input: {
  input: Parameters<typeof fetchClinicalRetrievalDocument>[0];
  run: RunnableClinicalRun;
  grantedScopes: readonly string[];
}): Promise<{ ticket: ReturnType<typeof clinicalDocumentTicketSchema.parse>; url: URL; fhirBaseUrl: string; patientIdHash: string } | { unavailable: string; retryable: boolean }> {
  let openedTicket: string;
  let fhirBaseUrl: string;
  let patientIdHash: string;
  try {
    openedTicket = await openClinicalDocumentTicket({ generation: input.run.generation, memberId: input.input.memberId,
      runId: input.run.id, value: input.input.request.ticket });
    fhirBaseUrl = await openClinicalConnectionFhirBaseUrl({ connectionId: input.run.connection.id,
      encrypted: input.run.connection.fhirBaseUrlEncrypted, memberId: input.input.memberId });
    const patientId = await openClinicalConnectionSecret({ connectionId: input.run.connection.id,
      encrypted: input.run.connection.patientIdEncrypted, field: "patientId", memberId: input.input.memberId,
      tokenVersion: input.run.connection.tokenVersion });
    patientIdHash = hashClinicalFhirPatientId(requireFhirPatientId(patientId));
  } catch (error) {
    const invalid = isInvalidClinicalResponse(error) || error instanceof SyntaxError
      || (error instanceof DOMException && error.name === "OperationError");
    return invalid ? { unavailable: "document-ticket-invalid", retryable: false }
      : { unavailable: "document-ticket-temporarily-unavailable", retryable: true };
  }
  try {
    const ticket = clinicalDocumentTicketSchema.parse(JSON.parse(openedTicket));
    const slice = input.run.retrievalPlan.slices.find((entry) => entry.queryScopeId === ticket.queryScopeId
      && entry.sliceId === ticket.sliceId && entry.queryFingerprint === ticket.queryFingerprint
      && entry.resourceType === ticket.resourceType);
    if (!slice) return { unavailable: "document-ticket-invalid", retryable: false };
    if (!epicImportQueryEnabled(input.run.connection.providerDirectoryEntryId, slice.queryScopeId)) {
      return { unavailable: "hospital-approval-required", retryable: false };
    }
    const sourceKind = ticket.sourceKind ?? "binary";
    if (sourceKind === "media" && !epicMediaReadIsGranted(input.grantedScopes)) return { unavailable: "media-scope-unavailable", retryable: false };
    return { ticket, url: resolveClinicalDocumentUrl(ticket.url, fhirBaseUrl, sourceKind), fhirBaseUrl, patientIdHash };
  } catch {
    return { unavailable: "document-ticket-invalid", retryable: false };
  }
}

async function finishClinicalRetrievalPage(input: {
  response: Response;
  input: Parameters<typeof fetchClinicalRetrievalPage>[0];
  run: RunnableClinicalRun;
  retrievalSlice: ClinicalFhirRetrievalSlice;
  pageUrl: ValidatedFhirPageUrl;
  fhirBaseUrl: string;
  openedPatientId: string;
  claimed: Extract<Awaited<ReturnType<typeof claimRetrievalPageRequest>>, { claimed: true }>;
}): Promise<HostedClinicalRecordsFetchPageResponse> {
  const sanitized = await sanitizeClinicalPageResponse(input);
  const nextCursor = await sealClinicalContinuationCursor({ ...input, nextUrl: sanitized.nextUrl });
  const documents = await issueClinicalDocumentTickets({
    body: sanitized.body, fhirBaseUrl: input.fhirBaseUrl, patientId: requireFhirPatientId(input.openedPatientId),
    memberId: input.input.memberId, runId: input.run.id, generation: input.run.generation,
    queryScopeId: input.retrievalSlice.queryScopeId, sliceId: input.retrievalSlice.sliceId,
    queryFingerprint: input.retrievalSlice.queryFingerprint,
  });
  const accounted = await completeRetrievalPageRequest({ bodyBytes: sanitized.bodyBytes, receivedBytes: sanitized.receivedBytes,
    claimVersion: input.claimed.claimVersion, isFirstCompletion: input.claimed.isFirstCompletion,
    requestRowId: input.claimed.requestRowId, run: input.run });
  if (!accounted) return unavailable("request-superseded", true);
  return { body: sanitized.body, ...(documents.length > 0 ? { documents } : {}), nextCursor,
    ...(input.input.request.cursor ? { pageUrlHash: hashClinicalFhirPageUrl(input.pageUrl.raw) } : {}), status: "page" };
}

async function sanitizeClinicalPageResponse(input: {
  response: Response;
  input: Parameters<typeof fetchClinicalRetrievalPage>[0];
  run: RunnableClinicalRun;
  retrievalSlice: ClinicalFhirRetrievalSlice;
  pageUrl: ValidatedFhirPageUrl;
  fhirBaseUrl: string;
  openedPatientId: string;
  claimed: Extract<Awaited<ReturnType<typeof claimRetrievalPageRequest>>, { claimed: true }>;
}): Promise<Awaited<ReturnType<typeof readSanitizedFhirPage>>> {
  try {
    return await readSanitizedFhirPage({ fhirBaseUrl: input.fhirBaseUrl,
      resourceType: input.input.request.resourceType, response: input.response });
  } catch (error) {
    if (!isInvalidClinicalResponse(error)) throw error;
    throw clinicalRecordsError({ cause: error, code: "CLINICAL_RECORD_FHIR_RESPONSE_INVALID", httpStatus: 502,
      message: "The provider returned an invalid FHIR response." });
  }
}

async function sealClinicalContinuationCursor(input: {
  nextUrl: ValidatedFhirPageUrl | null;
  input: Parameters<typeof fetchClinicalRetrievalPage>[0];
  run: RunnableClinicalRun;
  retrievalSlice: ClinicalFhirRetrievalSlice;
}): Promise<string | null> {
  if (!input.nextUrl) return null;
  const cursor = await sealClinicalPageCursor({ generation: input.run.generation, memberId: input.input.memberId,
    ...queryCursorIdentity(input.retrievalSlice, input.run.retrievalProtocol), resourceType: input.input.request.resourceType, runId: input.run.id,
    value: JSON.stringify({ queryFingerprint: input.retrievalSlice.queryFingerprint,
      queryScopeId: input.retrievalSlice.queryScopeId, resourceType: input.retrievalSlice.resourceType,
      schema: "murph.clinical-page-cursor.v3", sliceId: input.retrievalSlice.sliceId, url: input.nextUrl.raw }) });
  if (cursor.length > 2_048) throw clinicalRecordsError({ code: "CLINICAL_RECORD_PAGE_CURSOR_TOO_LARGE", httpStatus: 502,
    message: "The provider pagination cursor was too large." });
  return cursor;
}

async function fetchMediaDocument(input: {
  response: Response;
  mediaUrl: URL;
  fhirBaseUrl: string;
  patientIdHash: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
  ticket: ReturnType<typeof clinicalDocumentTicketSchema.parse>;
}): Promise<{ bytes: Buffer; mediaType: string; receivedBytes: number }> {
  const media = await readClinicalMediaResponse({ response: input.response, mediaUrl: input.mediaUrl,
    fhirBaseUrl: input.fhirBaseUrl, patientIdHash: input.patientIdHash, maxResponseBytes: DOCUMENT_MEDIA_RESPONSE_MAX_BYTES });
  const binaryResponse = await fetchFhirPage({ accessToken: input.accessToken, fetchImpl: input.fetchImpl,
    pageUrl: media.binaryUrl, accept: "application/fhir+json, application/json, */*;q=0.5" });
  const document = await readClinicalDocumentResponse({ response: binaryResponse, ticket: input.ticket, attachmentIntegrity: media.attachmentIntegrity,
    url: media.binaryUrl, maxResponseBytes: DOCUMENT_EGRESS_RESERVATION_BYTES });
  return { ...document, receivedBytes: media.receivedBytes + document.receivedBytes };
}

export async function recordClinicalRetrievalOutcome(input: {
  memberId: string;
  request: HostedClinicalRecordsRecordOutcomeRequest;
}): Promise<void> {
  const now = new Date();
  let notification: ClinicalMailboxCheckpoint | null = null;
  const rejection = await getPrisma().$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    const run = await tx.clinicalRecordRetrievalRun.findFirst({
      include: { connection: true },
      where: {
        generation: input.request.generation,
        id: input.request.runId,
        memberId: input.memberId,
      },
    });
    if (!run || run.connection.retrievalGeneration !== run.generation) throw staleRunError();
    assertOutcomeProtocol(input.request.retrievalProtocol, run);
    const rejection = validateOutcomeForRun(input.request, run);
    if (rejection) {
      if (!run.completedAt && ["active", "error"].includes(run.connection.status)) {
        await endUnusableRunTx(tx, { ...input.request, memberId: input.memberId }, run.connection,
          rejection.code === "CLINICAL_RECORD_OUTCOME_COUNT_MISMATCH" ? "outcome-count-mismatch" : "outcome-conflict");
      }
      return rejection; // Commit the failure before reporting the rejection to the runtime.
    }
    if (input.request.status === "preempted") {
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
          status: { in: [...CLINICAL_RECORD_OPEN_RUN_STATUSES] },
        },
      });
      if (preempted.count !== 1) throw staleRunError();
      return;
    }
    if (
      run.status === "needs_reauth"
      && run.connection.status === "needs_reauth"
      && ((input.request.status === "partial" && input.request.errorCode === HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE)
        || (input.request.status === "failed" && input.request.errorCode === "snapshot_rejected"))
    ) {
      if (run.outcomeCountsJson !== null) {
        if (stableJson(run.outcomeCountsJson) === stableJson(input.request.counts)) return;
        throw outcomeConflictError();
      }
      await tx.clinicalRecordRetrievalRun.update({
        where: { id: run.id },
        data: {
          outcomeCountsJson: { ...input.request.counts },
        },
      });
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
      data: {
        ...connectionData,
        lastCheckedAt: now,
        ...clinicalCredentialsAfterCheck(Boolean(run.connection.refreshTokenEncrypted), now),
      },
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
        lastErrorCode: input.request.errorCode ?? null,
        outcomeCountsJson: { ...input.request.counts },
        status: storedStatus,
      },
      where: {
        completedAt: null,
        connectionId: run.connectionId,
        generation: run.generation,
        id: run.id,
        memberId: input.memberId,
        status: { in: [...CLINICAL_RECORD_OPEN_RUN_STATUSES] },
      },
    });
    if (updatedRun.count !== 1) throw staleRunError();
    notification = await publishTerminalChangeProof(tx, input, run);
  });
  if (rejection) throw rejection;
  if (notification) await signalClinicalRetrievalWake(notification);
}

function publishTerminalChangeProof(tx: ClinicalRetrievalTx, input: { memberId: string; request: HostedClinicalRecordsRecordOutcomeRequest },
  run: { notificationTokenVersion: number | null; notificationCoverage: string | null; connection: { requiresProcessorApprovals: boolean | null } }) {
  if (run.notificationTokenVersion == null) return null;
  const hasChangeReceipt = input.request.hasChangeReceipt === true || run.notificationCoverage === "proved";
  if (!hasChangeReceipt && !run.connection.requiresProcessorApprovals) return null;
  return publishClinicalChangeTx(tx, { memberId: input.memberId, runId: input.request.runId, generation: input.request.generation }, hasChangeReceipt);
}

/** A delayed enrichment belongs to the original accepted run, even after a later daily admission. */
export async function recordClinicalChangeProof(input: RunPointer & { kind?: "change-receipt" | "change-scheduled" }): Promise<void> {
  // Older runners acknowledge a private checkpoint. It proves no provider attempt.
  if (input.kind === "change-scheduled") return;
  const notification = await getPrisma().$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    return publishClinicalChangeTx(tx, input);
  });
  if (notification) await signalClinicalRetrievalWake(notification);
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
      eventId: buildClinicalRetrievalWakeEventId({
        generation: input.generation,
        runId: input.runId,
      }),
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

export function buildClinicalRetrievalWakeEventId(input: {
  generation: number;
  runId: string;
}): string {
  return `clinical-records:sync:v1:${input.runId}:${input.generation}`;
}

export async function signalClinicalRetrievalWake(
  checkpoint: ClinicalMailboxCheckpoint,
  abortSignal?: AbortSignal,
): Promise<void> {
  try {
    await signalHostedMailboxAppendRuntime({
      abortSignal,
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

type RunPointer = { generation: number; memberId: string; runId: string };
type ClinicalReadPointer = RunPointer & { expectedProtocol?: ClinicalRetrievalProtocol };
type RunConnection = Pick<RunnableClinicalRun["connection"], "id" | "refreshTokenEncrypted" | "tokenVersion">;
type UnusableReason = "patient-context-unavailable" | "member-processing-inactive" | "run-configuration-invalid"
  | "processor-admission-blocked" | "credentials-unavailable" | "run-status-invalid" | "authorization-required";

async function loadRunnableClinicalRun(input: ClinicalReadPointer) {
  const loaded = await inspectRunnableClinicalRun(input, getPrisma());
  if (!("terminalize" in loaded) || !loaded.terminalize) return loaded;
  // Repeat the decision under the member lock. A reconnect, consent renewal or outcome can win the race.
  return getPrisma().$transaction(async tx => {
    await lockHostedMemberRow(tx, input.memberId);
    const current = await inspectRunnableClinicalRun(input, tx);
    if ("terminalize" in current && current.terminalize) {
      await endUnusableRunTx(tx, input, current.terminalize, current.unavailable);
    }
    return current;
  });
}

async function inspectRunnableClinicalRun(input: ClinicalReadPointer, prisma: ClinicalRetrievalTx): Promise<
  | { run: RunnableClinicalRun }
  | { retryable: false; unavailable: UnusableReason; terminalize: RunConnection }
  | { retryable: boolean; unavailable: string; terminalize?: never }
> {
  const active = await readClinicalTransportAccess({ memberId: input.memberId, prisma });
  const record = await prisma.clinicalRecordRetrievalRun.findFirst({
    select: {
      connection: {
        select: {
          requiresProcessorApprovals: true,
          accessTokenEncrypted: true,
          accessTokenExpiresAt: true,
          refreshTokenEncrypted: true,
          fhirBaseHash: true,
          fhirBaseUrlEncrypted: true,
          id: true,
          patientIdEncrypted: true,
          providerDirectoryEntryId: true,
          requestedScopesJson: true,
          retrievalGeneration: true,
          sourceSystem: true,
          status: true,
          tokenVersion: true,
        },
      },
      completedAt: true,
      startedAt: true,
      createdAt: true,
      egressBytes: true,
      generation: true,
      grantedScopesJson: true,
      id: true,
      memberId: true,
      pageCount: true,
      providerRequestCount: true,
      retrievalPlanJson: true,
      retrievalProtocol: true,
      status: true,
    },
    where: {
      generation: input.generation,
      id: input.runId,
      memberId: input.memberId,
    },
  });
  // Inactive callers get the same response for absent, obsolete and current pointers.
  const obsolete = (code: string) => ({ retryable: false as const, unavailable: active ? code : "member-processing-inactive" });
  if (!record) return obsolete("run-not-found");
  if (record.connection.retrievalGeneration !== record.generation) return obsolete("run-generation-stale");
  if (input.expectedProtocol && input.expectedProtocol !== record.retrievalProtocol) {
    return active ? { unavailable: "retrieval-protocol-mismatch", retryable: true } : obsolete("member-processing-inactive");
  }
  if (record.completedAt || CLINICAL_RECORD_TERMINAL_RUN_STATUSES.some(status => status === record.status)) {
    return obsolete(record.connection.status === "needs_reauth" && record.status === "needs_reauth"
      ? HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE : "run-already-terminal");
  }
  if (!["active", "error", "needs_reauth"].includes(record.connection.status)) return obsolete("connection-inactive");
  const unusable = (unavailable: UnusableReason) => ({ retryable: false as const, unavailable, terminalize: record.connection });
  if (!active) return unusable("member-processing-inactive");
  if (record.connection.requiresProcessorApprovals && !await hasClinicalProcessorApprovals(input.memberId, prisma)) {
    return unusable("processor-admission-blocked");
  }
  if (record.connection.status === "needs_reauth") return unusable("authorization-required");
  if (hasUnsupportedRetrievalFormat(record)) return { unavailable: "run-format-unsupported", retryable: true };
  if (!CLINICAL_RECORD_OPEN_RUN_STATUSES.some(status => status === record.status)) return unusable("run-status-invalid");
  if (!record.connection.accessTokenEncrypted || !record.connection.patientIdEncrypted) return unusable("credentials-unavailable");
  const configuration = parseRunnableClinicalConfiguration(record);
  if (!configuration) return unusable("run-configuration-invalid");
  const { requestedScopes, grantedScopes, retrievalPlan, sourceSystem, retrievalProtocol } = configuration;
  return {
    run: {
      connection: { ...record.connection, sourceSystem },
      createdAt: record.createdAt,
      startedAt: record.startedAt,
      egressBytes: record.egressBytes,
      generation: record.generation,
      requestedScopes, grantedScopes,
      id: record.id,
      memberId: record.memberId,
      pageCount: record.pageCount,
      providerRequestCount: record.providerRequestCount,
      retrievalPlan,
      retrievalProtocol,
      resourceTypes: [...new Set(retrievalPlan.slices.map((slice) => slice.resourceType))],
      status: record.status,
    },
  };
}

function parseRunnableClinicalConfiguration(record: {
  connection: { requestedScopesJson: Prisma.JsonValue; sourceSystem: string };
  grantedScopesJson: Prisma.JsonValue; retrievalPlanJson: Prisma.JsonValue; retrievalProtocol: string | null;
}) {
  try {
    const requestedScopes = parseStoredStringArray(record.connection.requestedScopesJson, "requested scopes");
    const grantedScopes = parseStoredStringArray(record.grantedScopesJson, "granted scopes");
    const retrievalPlan = clinicalFhirRetrievalPlanSchema.parse(record.retrievalPlanJson);
    const sourceSystem = clinicalSourceSystemSchema.parse(record.connection.sourceSystem);
    const retrievalProtocol = record.retrievalProtocol;
    if (retrievalProtocol !== "query-slices-v2" && retrievalProtocol !== CLINICAL_RECEIPT_PROTOCOL) return null;
    return { requestedScopes, grantedScopes, retrievalPlan, sourceSystem, retrievalProtocol } as const;
  } catch {
    return null;
  }
}

function buildInitialFhirPageUrl(input: {
  fhirBaseUrl: string;
  patientId: string;
  retrievalSlice: ClinicalFhirRetrievalSlice;
}): URL {
  return buildEpicBetaInitialFhirPageUrl({
    fhirBaseUrl: input.fhirBaseUrl,
    pageCount: EPIC_BETA_FHIR_PAGE_COUNT,
    patientId: input.patientId,
    retrievalSlice: input.retrievalSlice,
  });
}

function parsePageCursor(
  plaintext: string,
  expectedSlice: ClinicalFhirRetrievalSlice,
): ValidatedFhirPageUrl {
  const parsed: unknown = JSON.parse(plaintext);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ContractValidationError("Invalid cursor.");
  const record = parsed as Record<string, unknown>;
  if (
      Object.keys(record).sort().join(",")
        !== "queryFingerprint,queryScopeId,resourceType,schema,sliceId,url"
      || record.schema !== "murph.clinical-page-cursor.v3"
      || record.queryFingerprint !== expectedSlice.queryFingerprint
      || record.queryScopeId !== expectedSlice.queryScopeId
      || record.resourceType !== expectedSlice.resourceType
      || record.sliceId !== expectedSlice.sliceId
    ) throw new ContractValidationError("Invalid cursor.");
  if (
    typeof record.url !== "string"
    || hasSurroundingAsciiWhitespace(record.url)
    || record.url.length > FHIR_NEXT_URL_MAX_CHARS
  ) throw new ContractValidationError("Invalid cursor.");
  return { raw: record.url, url: new URL(record.url) };
}

function resolveRequestedRetrievalSlice(
  run: RunnableClinicalRun,
  request: HostedClinicalRecordsFetchPageRequest,
): ClinicalFhirRetrievalSlice | null {
  return run.retrievalPlan.slices.find((slice) => slice.queryScopeId === request.queryScopeId
    && slice.sliceId === request.sliceId && slice.resourceType === request.resourceType
    && slice.queryFingerprint === request.queryFingerprint) ?? null;
}

function queryCursorIdentity(
  slice: ClinicalFhirRetrievalSlice, retrievalProtocol: ClinicalRetrievalProtocol,
): {
  queryFingerprint: string;
  queryScopeId: string;
  retrievalProtocol: ClinicalRetrievalProtocol;
  sliceId: string;
} {
  return {
    queryFingerprint: slice.queryFingerprint,
    queryScopeId: slice.queryScopeId,
    retrievalProtocol,
    sliceId: slice.sliceId,
  };
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
  ) throw new ContractValidationError("FHIR page URL escaped the configured endpoint.");
}

async function requireCurrentAccessToken(input: {
  fetchImpl?: typeof fetch;
  memberId: string;
  run: RunnableClinicalRun;
}): Promise<string> {
  const connection = input.run.connection;
  if (
    (connection.accessTokenExpiresAt === null && connection.refreshTokenEncrypted)
    || (connection.accessTokenExpiresAt !== null
      && connection.accessTokenExpiresAt.getTime() <= Date.now() + TOKEN_EXPIRY_LEEWAY_MS)
  ) {
    if (connection.refreshTokenEncrypted) return renewClinicalAccess({ connectionId: connection.id, memberId: input.memberId, generation: input.run.generation, fetchImpl: input.fetchImpl });
    throw reauthRequiredError();
  }
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

async function fetchFhirPage(input: {
  accessToken: string;
  accept?: string;
  fetchImpl?: typeof fetch;
  pageUrl: URL;
}): Promise<Response> {
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(input.pageUrl, {
      cache: "no-store",
      headers: {
        Accept: input.accept ?? "application/fhir+json, application/json",
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
}): Promise<{ body: string; bodyBytes: number; receivedBytes: number; nextUrl: ValidatedFhirPageUrl | null }> {
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
      if (
        resource.resourceType !== input.resourceType
        && !isMarkedFhirSearchOutcomeEntry(entryRecord, resource)
      ) throw invalidFhirResponseError();
    });
    nextUrl = readNextFhirUrl(record.link, input.fhirBaseUrl, input.resourceType);
    validated = record;
  }
  const body = JSON.stringify(validated);
  const bodyBytes = new TextEncoder().encode(body).byteLength;
  if (body.length > HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS || bodyBytes > HOSTED_CLINICAL_RECORDS_MAX_PAGE_BODY_CHARS) {
    throw invalidFhirResponseError();
  }
  return { body, bodyBytes, receivedBytes: bytes.byteLength, nextUrl };
}

function isMarkedFhirSearchOutcomeEntry(
  entry: Record<string, unknown>,
  resource: Record<string, unknown>,
): boolean {
  if (resource.resourceType !== "OperationOutcome") return false;
  const search = requireRecord(entry.search);
  return search.mode === "outcome";
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
  requiresProcessorApprovals: boolean | null;
  firstStart: boolean;
  reservationBytes?: number;
  connectionId: string;
  generation: number;
  memberId: string;
  queryScopeId?: string;
  requestFingerprint: string;
  runId: string;
  sliceId?: string;
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
      queryScopeId: input.queryScopeId ?? null,
      requestFingerprint: input.requestFingerprint,
      runId: input.runId,
      sliceId: input.sliceId ?? null,
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
    || record.queryScopeId !== (input.queryScopeId ?? null)
    || record.sliceId !== (input.sliceId ?? null)
  ) return { claimed: false, errorCode: "request-page-conflict", retryable: false };
  if (record.claimVersion >= MAX_LOGICAL_REQUEST_CLAIM_VERSION) {
    return { claimed: false, errorCode: "request-retry-limit-reached", retryable: false };
  }
  const isFirstCompletion = record.responseBytes === null;
  const previousCompletedAt = record.completedAt;
  const staleBefore = new Date(now.getTime() - PAGE_REQUEST_CLAIM_STALE_MS);
  try {
    return await prisma.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, input.memberId);
      const active = await readClinicalTransportAccess({ memberId: input.memberId, prisma: tx });
      if (!active || (input.requiresProcessorApprovals && !await hasClinicalProcessorApprovals(input.memberId, tx))) {
        const errorCode = active ? "processor-admission-blocked" : "member-processing-inactive";
        const current = await tx.clinicalRecordRetrievalRun.findFirst({
          where: { id: input.runId, generation: input.generation, memberId: input.memberId }, include: { connection: true },
        });
        if (current && !current.completedAt && current.connection.retrievalGeneration === input.generation
          && ["active", "error"].includes(current.connection.status)) {
          await endUnusableRunTx(tx, input, current.connection, errorCode);
        }
        return { claimed: false, errorCode, retryable: false } as const;
      }
      const reclaimed = await tx.clinicalRecordRetrievalRequest.updateMany({
        data: {
          claimVersion: { increment: 1 },
          claimedAt: now,
          completedAt: null,
          reservedBytes: (input.reservationBytes ?? PAGE_EGRESS_RESERVATION_BYTES),
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
          egressBytes: { increment: (input.reservationBytes ?? PAGE_EGRESS_RESERVATION_BYTES) },
          providerRequestCount: { increment: 1 },
          status: "retrieving",
        },
        where: {
          completedAt: null,
          egressBytes: {
            lte: RETRIEVAL_COUNTER_MAX - (input.reservationBytes ?? PAGE_EGRESS_RESERVATION_BYTES),
          },
          generation: input.generation,
          id: input.runId,
          memberId: input.memberId,
          connection: { retrievalGeneration: input.generation, status: { in: ["active", "error"] } },
          providerRequestCount: { lt: RETRIEVAL_COUNTER_MAX },
          status: { in: [...CLINICAL_RECORD_OPEN_RUN_STATUSES] },
        },
      });
      if (reserved.count !== 1) throw new ClinicalRetrievalClaimRejection();
      if (input.firstStart) {
        await tx.clinicalRecordRetrievalRun.updateMany({ where: { id: input.runId, startedAt: null }, data: { startedAt: now } });
      }
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
  reservationBytes?: number;
  countAsPage?: boolean;
  bodyBytes: number;
  receivedBytes: number;
  claimVersion: number;
  isFirstCompletion: boolean;
  requestRowId: string;
  run: RunnableClinicalRun;
}): Promise<boolean> {
  const now = new Date();
  return getPrisma().$transaction(async (tx) => {
    const completed = await tx.clinicalRecordRetrievalRequest.updateMany({
      data: {
        claimVersion: { increment: 1 },
        completedAt: now,
        reservedBytes: 0,
        responseBytes: input.bodyBytes,
      },
      where: {
        claimVersion: input.claimVersion,
        completedAt: null,
        id: input.requestRowId,
        reservedBytes: (input.reservationBytes ?? PAGE_EGRESS_RESERVATION_BYTES),
        responseBytes: input.isFirstCompletion ? null : { not: null },
      },
    });
    if (completed.count !== 1) return false;
    const updated = await tx.clinicalRecordRetrievalRun.updateMany({
      data: {
        egressBytes: { decrement: (input.reservationBytes ?? PAGE_EGRESS_RESERVATION_BYTES) - input.receivedBytes },
        pageCount: input.isFirstCompletion && input.countAsPage !== false ? { increment: 1 } : undefined,
      },
      where: {
        completedAt: null,
        generation: input.run.generation,
        id: input.run.id,
        memberId: input.run.memberId,
        status: { in: [...CLINICAL_RECORD_OPEN_RUN_STATUSES] },
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
  reservationBytes?: number;
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
        reservedBytes: (input.reservationBytes ?? PAGE_EGRESS_RESERVATION_BYTES),
      },
    });
    if (released.count !== 1 || input.chargeReservation) return;
    await tx.clinicalRecordRetrievalRun.updateMany({
      data: { egressBytes: { decrement: (input.reservationBytes ?? PAGE_EGRESS_RESERVATION_BYTES) } },
      where: {
        completedAt: null,
        generation: input.run.generation,
        id: input.run.id,
        memberId: input.run.memberId,
        status: { in: [...CLINICAL_RECORD_OPEN_RUN_STATUSES] },
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
  return getPrisma().$transaction(async tx => {
    await lockHostedMemberRow(tx, input.memberId);
    return endUnusableRunTx(tx, input, { id: input.connectionId, tokenVersion: input.observedTokenVersion,
      refreshTokenEncrypted: null }, "authorization-required");
  });
}

export async function endUnusableRunTx(tx: ClinicalRetrievalTx, pointer: RunPointer, connection: RunConnection,
  reason: UnusableReason | "outcome-count-mismatch" | "outcome-conflict", now = new Date()) {
  const reauth = reason === "authorization-required" || reason === "credentials-unavailable" || reason === "patient-context-unavailable";
  const closed = await closeClinicalRunTx(tx, pointer, reauth ? "needs_reauth" : "failed", reason, now, connection.tokenVersion);
  if (!closed) return false;
  const updated = await tx.clinicalRecordConnection.updateMany({
    where: { id: connection.id, memberId: pointer.memberId, retrievalGeneration: pointer.generation,
      tokenVersion: connection.tokenVersion, status: { in: ["active", "error", "needs_reauth"] } },
    data: { lastErrorCode: reason, lastCheckedAt: now, ...(reauth ? {
      ...CLEAR_CLINICAL_PERSISTENT_ACCESS, accessTokenEncrypted: null, accessTokenExpiresAt: null,
      patientIdEncrypted: null, status: "needs_reauth",
    } : { ...clinicalCredentialsAfterCheck(Boolean(connection.refreshTokenEncrypted), now), status: "error" }) },
  });
  if (updated.count !== 1) throw staleRunError(); // Roll back the run write as well.
  return true;
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

function hasUnsupportedRetrievalFormat(run: { retrievalProtocol: string | null; retrievalPlanJson: Prisma.JsonValue }) {
  const plan = run.retrievalPlanJson;
  return (run.retrievalProtocol !== "query-slices-v2" && run.retrievalProtocol !== CLINICAL_RECEIPT_PROTOCOL) || (plan !== null && typeof plan === "object"
    && "schemaVersion" in plan && plan.schemaVersion !== clinicalFhirRetrievalPlanSchema.shape.schemaVersion.value);
}

function assertOutcomeProtocol(protocol: ClinicalRetrievalProtocol, run: { retrievalProtocol: string | null; retrievalPlanJson: Prisma.JsonValue }) {
  if (hasUnsupportedRetrievalFormat(run)) throw clinicalRecordsError({
    code: "CLINICAL_RECORD_RETRIEVAL_FORMAT_UNSUPPORTED", httpStatus: 503, retryable: true,
    message: "This server cannot read the stored retrieval format.",
  });
  if (protocol !== run.retrievalProtocol) throw outcomeConflictError();
}

function validateOutcomeForRun(request: HostedClinicalRecordsRecordOutcomeRequest, run: {
  pageCount: number;
  retrievalPlanJson: Prisma.JsonValue | null;
}) {
  if (
    request.status !== "preempted" &&
    (request.counts.fetchedPageCount > run.pageCount ||
      (request.status === "completed" &&
        request.counts.fetchedPageCount !== run.pageCount))
  ) {
    return clinicalRecordsError({
      code: "CLINICAL_RECORD_OUTCOME_COUNT_MISMATCH",
      httpStatus: 409,
      message: "The Clinical Records retrieval page count does not match the control plane.",
    });
  }

  const plan = clinicalFhirRetrievalPlanSchema.safeParse(run.retrievalPlanJson);
  if (!plan.success) return outcomeConflictError();
  const expected = plan.data.slices.map((slice) => ({
    queryScopeId: slice.queryScopeId,
    sliceId: slice.sliceId,
  }));
  if (JSON.stringify(request.retrievalSlices) !== JSON.stringify(expected)) {
    return outcomeConflictError();
  }
  return null;
}

function outcomeConflictError() {
  return clinicalRecordsError({
    code: "CLINICAL_RECORD_OUTCOME_CONFLICT",
    httpStatus: 409,
    message: "The Clinical Records retrieval outcome does not match its frozen query plan.",
  });
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

// A provider response or document our validators reject. The native TypeError
// branch is what these sites matched before validation had its own class.
function isInvalidClinicalResponse(error: unknown): boolean {
  return error instanceof ContractValidationError || error instanceof TypeError;
}
