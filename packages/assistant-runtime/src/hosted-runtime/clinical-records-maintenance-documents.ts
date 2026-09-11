import { createHash } from "node:crypto";

import {
  CLINICAL_DOCUMENT_MAX_BYTES,
  CLINICAL_DOCUMENTS_MAX_TOTAL_BYTES,
  CLINICAL_DOCUMENT_MAX_ATTACHMENTS,
  clinicalDocumentAttachmentKey,
  decodeClinicalDocumentBase64,
  hashClinicalDocumentBytes,
  listClinicalFhirAttachments,
  type ClinicalDocumentAttachmentIdentity,
} from "@murphai/clinical-records";
import {
  parseHostedClinicalRecordsFetchDocumentResponse,
  type HostedClinicalRecordsDocumentDescriptor,
} from "@murphai/hosted-execution/clinical-records";
import type {
  ClinicalFhirRetrievalCheckpoint,
} from "@murphai/vault-usecases/clinical-records";

import type { HostedRuntimeClinicalRecordsPort } from "./platform.ts";

/** Enumerate from the original page, so omitted tickets cannot look like complete evidence. */
export function stageClinicalPageDocuments(input: {
  body: string;
  checkpoint: ClinicalFhirRetrievalCheckpoint;
  documents?: HostedClinicalRecordsDocumentDescriptor[];
}): void {
  const body: unknown = JSON.parse(input.body);
  if (!isRecord(body)) return;
  const resources: unknown[] = body.resourceType === "Bundle" && Array.isArray(body.entry)
    ? body.entry.map((entry: unknown) => isRecord(entry) ? entry.resource : null)
    : [body];
  const parentPageSha256 = createHash("sha256").update(input.body, "utf8").digest("hex");
  const seenAttachments = new Set<string>();
  const tickets = new Map((input.documents ?? []).map((document) => [clinicalDocumentAttachmentKey(document), document]));
  for (const resource of resources) {
    if (!isRecord(resource) || (resource.resourceType !== "DocumentReference" && resource.resourceType !== "DiagnosticReport") || typeof resource.id !== "string") continue;
    for (const attachment of listClinicalFhirAttachments(resource)) {
      if (input.checkpoint.documentAttachments.length + input.checkpoint.pendingDocuments.length >= CLINICAL_DOCUMENT_MAX_ATTACHMENTS) {
        recordDocumentBudgetError(input.checkpoint);
        continue;
      }
      const identity: ClinicalDocumentAttachmentIdentity = {
        parentPageSha256,
        resourceType: resource.resourceType,
        resourceId: resource.id,
        attachmentIndex: attachment.attachmentIndex,
      };
      const key = clinicalDocumentAttachmentKey(identity);
      if (seenAttachments.has(key)) continue;
      seenAttachments.add(key);
      if (attachment.data !== undefined) {
        const bytes = decodeClinicalDocumentBase64(attachment.data);
        if (!bytes || !attachment.contentType) {
          input.checkpoint.documentAttachments.push({ ...identity, status: "unavailable", errorCode: "invalid_inline_document" });
          recordDocumentUnavailableError(input.checkpoint, "invalid_inline_document");
          continue;
        }
        stageDownloadedDocument(input.checkpoint, identity, bytes, attachment.contentType);
        continue;
      }
      const descriptor = tickets.get(clinicalDocumentAttachmentKey(identity));
      input.checkpoint.pendingDocuments.push({
        ...identity,
        ticket: descriptor?.ticket ?? null,
        ...(descriptor?.errorCode ? { errorCode: descriptor.errorCode } : {}),
      });
    }
  }
}

export async function fetchPendingClinicalDocuments(input: {
  checkpoint: ClinicalFhirRetrievalCheckpoint;
  generation: number;
  persist: () => Promise<void>;
  port: HostedRuntimeClinicalRecordsPort;
  runId: string;
  signal: AbortSignal | null;
  throwIfPreempted: () => void;
}): Promise<void> {
  while (input.checkpoint.pendingDocuments.length > 0) {
    input.throwIfPreempted();
    const document = input.checkpoint.pendingDocuments[0]!;
    const { ticket, errorCode, ...identity } = document;
    const documentBytes = input.checkpoint.attachments.reduce((total, file) => total + Buffer.byteLength(file.contentBase64, "base64"), 0);
    const documentBudgetFull = documentBytes + CLINICAL_DOCUMENT_MAX_BYTES > CLINICAL_DOCUMENTS_MAX_TOTAL_BYTES;
    if (documentBudgetFull) recordDocumentBudgetError(input.checkpoint);
    if (!ticket || input.checkpoint.authorizationRequired || documentBudgetFull) {
      const unavailableCode = documentBudgetFull ? "document_batch_limit_exceeded" : normalizedDocumentError(errorCode);
      input.checkpoint.documentAttachments.push({ ...identity, status: "unavailable", errorCode: unavailableCode });
      recordDocumentUnavailableError(input.checkpoint, unavailableCode);
    } else {
      if (!input.port.fetchDocument) throw Object.assign(new Error("Clinical document transport is unavailable."), { code: "CLINICAL_RECORDS_DOCUMENT_PORT_NOT_CONFIGURED" });
      const response = parseHostedClinicalRecordsFetchDocumentResponse(await input.port.fetchDocument({
        runId: input.runId, generation: input.generation, ticket,
      }, { signal: input.signal }));
      if (response.status === "unavailable") {
        if (response.retryable) {
          throw Object.assign(new Error("Clinical document is temporarily unavailable."), { code: "CLINICAL_RECORDS_DOCUMENT_RETRYABLE" });
        }
        if (response.errorCode === "authorization-required") input.checkpoint.authorizationRequired = true;
        const unavailableCode = normalizedDocumentError(response.errorCode);
        input.checkpoint.documentAttachments.push({ ...identity, status: "unavailable", errorCode: unavailableCode });
        recordDocumentUnavailableError(input.checkpoint, unavailableCode);
      } else {
        const bytes = decodeClinicalDocumentBase64(response.contentBase64);
        if (!bytes || bytes.length !== response.byteLength || hashClinicalDocumentBytes(bytes) !== response.sha256) {
          throw Object.assign(new Error("Clinical document response failed integrity validation."), { code: "CLINICAL_RECORDS_DOCUMENT_INTEGRITY" });
        }
        stageDownloadedDocument(input.checkpoint, identity, bytes, response.mediaType);
      }
    }
    input.checkpoint.pendingDocuments.shift();
    // Save the accepted bytes and remove the ticket together before observing preemption.
    await input.persist();
    input.throwIfPreempted();
  }
}

function stageDownloadedDocument(
  checkpoint: ClinicalFhirRetrievalCheckpoint,
  identity: ClinicalDocumentAttachmentIdentity,
  bytes: Buffer,
  mediaType: string,
): void {
  const sha256 = hashClinicalDocumentBytes(bytes);
  const relativePath = `attachments/${sha256}.bin`;
  checkpoint.documentAttachments.push({ ...identity, status: "downloaded", relativePath, sha256, mediaType, byteLength: bytes.length });
  if (!checkpoint.attachments.some((attachment) => attachment.relativePath === relativePath)) {
    checkpoint.attachments.push({ relativePath, contentBase64: bytes.toString("base64") });
  }
}

function normalizedDocumentError(code: string | undefined): string {
  const normalized = code?.toLowerCase().replaceAll("-", "_");
  return normalized && /^[a-z][a-z0-9_]{0,79}$/u.test(normalized) ? normalized : "document_unavailable";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function recordDocumentBudgetError(checkpoint: ClinicalFhirRetrievalCheckpoint): void {
  if (!checkpoint.errors.some((error) => error.code === "document_batch_limit_exceeded")) {
    checkpoint.errors.push({ code: "document_batch_limit_exceeded", message: "Some documents exceeded the page attachment processing allowance." });
  }
}

function recordDocumentUnavailableError(checkpoint: ClinicalFhirRetrievalCheckpoint, code: string): void {
  if (checkpoint.errors.some((error) => error.code === code)) return;
  checkpoint.errors.push({ code, message: "One or more linked hospital documents were unavailable." });
}
