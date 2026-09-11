import { createHash } from "node:crypto";

import {
  hashClinicalFhirBaseUrl,
  hashClinicalFhirPatientId,
  listClinicalFhirAttachments,
  normalizeClinicalFhirPatientReference,
} from "@murphai/clinical-records";
import {
  HOSTED_CLINICAL_RECORDS_MAX_DOCUMENT_BYTES,
  HOSTED_CLINICAL_RECORDS_MAX_DOCUMENT_TICKET_CHARS,
  HOSTED_CLINICAL_RECORDS_MAX_PAGE_DOCUMENTS,
  type HostedClinicalRecordsDocumentDescriptor,
} from "@murphai/hosted-execution/clinical-records";
import * as z from "@murphai/contracts/zod-runtime";

import { ClinicalResponseBodyLimitError, decodeClinicalResponseUtf8, readClinicalResponseBytes } from "./response-bytes";
import { clinicalRecordsError } from "./errors";
import { sealClinicalDocumentTicket } from "./secrets";

const resourceId = z.string().regex(/^[A-Za-z0-9.-]{1,200}$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const clinicalDocumentTicketSchema = z.object({
  schema: z.literal("murph.clinical-document-ticket.v1"),
  queryScopeId: z.string().min(1).max(120),
  sliceId: z.string().min(1).max(120),
  queryFingerprint: hash,
  parentPageSha256: hash,
  resourceType: z.enum(["DocumentReference", "DiagnosticReport"]),
  sourceKind: z.enum(["binary", "media"]).optional(),
  resourceId,
  resourceVersion: z.string().datetime({ offset: true }),
  attachmentIndex: z.number().int().nonnegative().max(1_999),
  url: z.string().min(1).max(1_024),
  mediaType: z.string().max(255).optional(),
  size: z.number().int().nonnegative().optional(),
  hash: z.string().max(128).optional(),
}).strict();
export type ClinicalDocumentTicket = z.infer<typeof clinicalDocumentTicketSchema>;
const documentIntegritySchema = clinicalDocumentTicketSchema.pick({ mediaType: true, size: true, hash: true });
type ClinicalDocumentIntegrity = z.infer<typeof documentIntegritySchema>;

/** A dependency URL cannot confer arbitrary provider or network authority. */
export function resolveClinicalDocumentUrl(value: string, fhirBaseUrl: string, sourceKind: "binary" | "media" = "binary"): URL {
  if (value !== value.trim() || /[\\%\u0000-\u0020]/u.test(value)) throw new TypeError("Invalid document URL.");
  const base = new URL(fhirBaseUrl);
  const url = new URL(value, `${base.href.replace(/\/+$/u, "")}/`);
  const prefix = `${base.pathname.replace(/\/+$/u, "")}/${sourceKind === "media" ? "Media" : "Binary"}/`;
  if (url.protocol !== "https:" || url.origin !== base.origin || url.username || url.password
    || url.search || url.hash || !url.pathname.startsWith(prefix)
    || !/^[A-Za-z0-9.-]{1,512}(?:\/_history\/[A-Za-z0-9.-]{1,64})?$/u.test(url.pathname.slice(prefix.length))) {
    throw new TypeError("Document URL escaped the configured FHIR document endpoint.");
  }
  return url;
}

export async function issueClinicalDocumentTickets(input: {
  body: string;
  fhirBaseUrl: string;
  patientId: string;
  memberId: string;
  runId: string;
  generation: number;
  queryScopeId: string;
  sliceId: string;
  queryFingerprint: string;
}): Promise<HostedClinicalRecordsDocumentDescriptor[]> {
  const page: unknown = JSON.parse(input.body);
  if (!isObject(page) || !Array.isArray(page.entry)) return [];
  const parents = page.entry.flatMap((entry: unknown) =>
    isObject(entry) && isObject(entry.resource)
      && (entry.resource.resourceType === "DocumentReference" || entry.resource.resourceType === "DiagnosticReport")
      ? [entry.resource] : []);
  const parentCounts = new Map<string, number>();
  for (const parent of parents) {
    const key = `${String(parent.resourceType)}:${String(parent.id)}`;
    parentCounts.set(key, (parentCounts.get(key) ?? 0) + 1);
  }
  const descriptors: HostedClinicalRecordsDocumentDescriptor[] = [];
  const emitted = new Set<string>();
  const parentPageSha256 = createHash("sha256").update(input.body).digest("hex");
  const fhirBaseUrlHash = hashClinicalFhirBaseUrl(input.fhirBaseUrl);
  for (const parent of parents) {
    const parsedId = resourceId.safeParse(parent.id);
    if (!parsedId.success) continue;
    const attachments = listClinicalFhirAttachments(parent);
    for (const [attachmentIndex, attachment] of attachments.entries()) {
      if (descriptors.length >= HOSTED_CLINICAL_RECORDS_MAX_PAGE_DOCUMENTS || attachmentIndex >= 2_000) return descriptors;
      const descriptor = await issueClinicalDocumentTicket({ input, parent, attachment, attachmentIndex,
        parsedId: parsedId.data, fhirBaseUrlHash, parentCounts, parentPageSha256, emitted });
      if (descriptor) descriptors.push(descriptor);
    }
  }
  return descriptors;
}

async function issueClinicalDocumentTicket(input: {
  input: Parameters<typeof issueClinicalDocumentTickets>[0];
  parent: Record<string, unknown>;
  attachment: ReturnType<typeof listClinicalFhirAttachments>[number];
  attachmentIndex: number;
  parsedId: string;
  fhirBaseUrlHash: string;
  parentCounts: Map<string, number>;
  parentPageSha256: string;
  emitted: Set<string>;
}): Promise<HostedClinicalRecordsDocumentDescriptor | null> {
  const type = input.parent.resourceType === "DocumentReference" ? "DocumentReference" : "DiagnosticReport";
  if (typeof input.attachment.data === "string") return null;
  const identity = `${type}:${input.parsedId}:${input.attachmentIndex}`;
  if (input.emitted.has(identity)) return null;
  input.emitted.add(identity);
  const descriptor: HostedClinicalRecordsDocumentDescriptor = {
    parentPageSha256: input.parentPageSha256, resourceType: type, resourceId: input.parsedId,
    attachmentIndex: input.attachmentIndex, ticket: null,
  };
  const subject = isObject(input.parent.subject) ? input.parent.subject.reference : null;
  if (typeof subject !== "string" || normalizeClinicalFhirPatientReference({ fhirBaseUrlHash: input.fhirBaseUrlHash, reference: subject }) !== input.input.patientId) {
    descriptor.errorCode = "document-patient-mismatch";
    return descriptor;
  }
  if ((input.parentCounts.get(`${type}:${input.parsedId}`) ?? 0) > 1) {
    descriptor.errorCode = "document-parent-ambiguous";
    return descriptor;
  }
  if (typeof input.attachment.url !== "string") {
    descriptor.errorCode = "document-reference-unavailable";
    return descriptor;
  }
  let ticket: ClinicalDocumentTicket;
  try {
    const sourceKind = input.attachment.isMedia ? "media" : "binary";
    const url = resolveClinicalDocumentUrl(input.attachment.url, input.input.fhirBaseUrl, sourceKind);
    ticket = clinicalDocumentTicketSchema.parse({
      schema: "murph.clinical-document-ticket.v1", queryScopeId: input.input.queryScopeId,
      sliceId: input.input.sliceId, queryFingerprint: input.input.queryFingerprint,
      parentPageSha256: input.parentPageSha256, resourceType: type, resourceId: input.parsedId,
      resourceVersion: isObject(input.parent.meta) ? input.parent.meta.lastUpdated : undefined,
      attachmentIndex: input.attachmentIndex, url: url.href, sourceKind,
      ...(input.attachment.contentType === undefined ? {} : { mediaType: input.attachment.contentType }),
      ...(input.attachment.size === undefined ? {} : { size: input.attachment.size }),
      ...(input.attachment.hash === undefined ? {} : { hash: input.attachment.hash }),
    });
    if (ticket.size !== undefined && ticket.size > HOSTED_CLINICAL_RECORDS_MAX_DOCUMENT_BYTES) {
      descriptor.errorCode = "document-size-exceeded";
      return descriptor;
    }
  } catch {
    descriptor.errorCode = "document-reference-unavailable";
    return descriptor;
  }
  let sealed: string;
  try {
    sealed = await sealClinicalDocumentTicket({ memberId: input.input.memberId, runId: input.input.runId,
      generation: input.input.generation, value: JSON.stringify(ticket) });
  } catch (cause) {
    throw clinicalRecordsError({ cause, code: "CLINICAL_RECORD_DOCUMENT_TICKET_SEAL_FAILED", httpStatus: 503,
      message: "The Clinical Records document ticket could not be sealed.", retryable: true });
  }
  if (sealed.length > HOSTED_CLINICAL_RECORDS_MAX_DOCUMENT_TICKET_CHARS) descriptor.errorCode = "document-ticket-too-large";
  else descriptor.ticket = sealed;
  return descriptor;
}

export function decodeClinicalDocumentBase64(value: string): Buffer {
  const canonical = value.replace(/\s+/gu, "");
  if (!isCanonicalClinicalBase64(canonical)) {
    throw new TypeError("Invalid document base64.");
  }
  const bytes = Buffer.from(canonical, "base64");
  if (bytes.length === 0 || bytes.length > HOSTED_CLINICAL_RECORDS_MAX_DOCUMENT_BYTES || bytes.toString("base64") !== canonical) {
    throw new TypeError("Invalid document bytes.");
  }
  return bytes;
}

function isCanonicalClinicalBase64(value: string): boolean {
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) return false;
  const padding = value.indexOf("=");
  if (padding < 0) return true;
  return padding >= value.length - 2 && value.length - padding <= 2;
}

export async function readClinicalDocumentResponse(input: {
  response: Response;
  ticket: ClinicalDocumentTicket;
  attachmentIntegrity?: ClinicalDocumentIntegrity;
  url: URL;
  maxResponseBytes: number;
}): Promise<{ bytes: Buffer; mediaType: string; receivedBytes: number }> {
  let mediaType = boundedMediaType(input.response.headers.get("content-type") ?? "");
  const baseMediaType = normalizeMediaType(mediaType);
  const isBinaryJson = baseMediaType === "application/fhir+json" || baseMediaType === "application/json";
  let received: Uint8Array;
  try {
    received = await readClinicalResponseBytes(input.response,
      isBinaryJson ? input.maxResponseBytes : HOSTED_CLINICAL_RECORDS_MAX_DOCUMENT_BYTES);
  } catch (error) {
    if (error instanceof ClinicalResponseBodyLimitError) throw error;
    throw clinicalRecordsError({ code: "CLINICAL_RECORD_FHIR_FETCH_FAILED", httpStatus: 503,
      message: "The Clinical Records document response stream failed.", retryable: true });
  }
  const decoded = isBinaryJson ? decodeDocumentBody(received, input.url, input.ticket.mediaType ?? input.attachmentIntegrity?.mediaType) : { bytes: Buffer.from(received), mediaType };
  const bytes = decoded.bytes;
  mediaType = decoded.mediaType;
  if (bytes.length === 0 || bytes.length > HOSTED_CLINICAL_RECORDS_MAX_DOCUMENT_BYTES) throw new TypeError("Invalid document size.");
  for (const integrity of [input.ticket, input.attachmentIntegrity]) {
    if (!integrity) continue;
    if (integrity.mediaType && normalizeMediaType(integrity.mediaType) !== normalizeMediaType(mediaType)) throw new TypeError("Document media type changed.");
    if (integrity.size !== undefined && integrity.size !== bytes.length) throw new TypeError("Document size changed.");
    if (integrity.hash !== undefined && createHash("sha1").update(bytes).digest("base64") !== integrity.hash) {
      throw new TypeError("Document hash changed.");
    }
  }
  return { bytes, mediaType, receivedBytes: received.byteLength };
}

function decodeDocumentBody(received: Uint8Array, url: URL, declaredMediaType: string | undefined): { bytes: Buffer; mediaType: string } {
  const binary: unknown = JSON.parse(decodeClinicalResponseUtf8(received));
  if (isObject(binary) && binary.resourceType === "Binary") {
    const expectedId = url.pathname.split("/Binary/")[1]?.split("/")[0];
    if (binary.id !== expectedId || typeof binary.data !== "string" || typeof binary.contentType !== "string") {
      throw new TypeError("Invalid FHIR Binary response.");
    }
    return { bytes: decodeClinicalDocumentBase64(binary.data), mediaType: boundedMediaType(binary.contentType) };
  }
  if (declaredMediaType && normalizeMediaType(declaredMediaType) === "application/json") {
    return { bytes: Buffer.from(received), mediaType: declaredMediaType };
  }
  throw new TypeError("Invalid FHIR Binary response.");
}

/** Media is only an attested bridge from a patient-bound DiagnosticReport to Binary. */
export async function readClinicalMediaResponse(input: {
  response: Response;
  mediaUrl: URL;
  fhirBaseUrl: string;
  patientIdHash: string;
  maxResponseBytes: number;
}): Promise<{ binaryUrl: URL; attachmentIntegrity: ClinicalDocumentIntegrity; receivedBytes: number }> {
  const contentType = normalizeMediaType((input.response.headers.get("content-type") ?? "application/fhir+json").split(";", 1)[0] ?? "");
  if (contentType !== "application/fhir+json" && contentType !== "application/json") {
    throw new TypeError("Invalid FHIR Media response content type.");
  }
  let received: Uint8Array;
  try {
    received = await readClinicalResponseBytes(input.response, input.maxResponseBytes);
  } catch (error) {
    if (error instanceof ClinicalResponseBodyLimitError) throw error;
    throw clinicalRecordsError({ code: "CLINICAL_RECORD_FHIR_FETCH_FAILED", httpStatus: 503,
      message: "The Clinical Records document response stream failed.", retryable: true });
  }
  const value = JSON.parse(decodeClinicalResponseUtf8(received));
  if (!isObject(value) || value.resourceType !== "Media" || value.id !== input.mediaUrl.pathname.split("/Media/")[1]?.split("/")[0]
    || !isObject(value.content) || typeof value.content.url !== "string") {
    throw new TypeError("Invalid FHIR Media response.");
  }
  validateClinicalMediaPatient({ subject: value.subject, fhirBaseUrl: input.fhirBaseUrl, patientIdHash: input.patientIdHash });
  const parsedIntegrity = documentIntegritySchema.safeParse({
    mediaType: value.content.contentType, size: value.content.size, hash: value.content.hash,
  });
  if (!parsedIntegrity.success) throw new TypeError("Invalid FHIR Media attachment integrity.");
  const attachmentIntegrity = parsedIntegrity.data;
  if (attachmentIntegrity.mediaType !== undefined) boundedMediaType(attachmentIntegrity.mediaType);
  if (attachmentIntegrity.size !== undefined && attachmentIntegrity.size > HOSTED_CLINICAL_RECORDS_MAX_DOCUMENT_BYTES) {
    throw new TypeError("Invalid document size.");
  }
  return {
    binaryUrl: resolveClinicalDocumentUrl(value.content.url, input.fhirBaseUrl, "binary"),
    attachmentIntegrity,
    receivedBytes: received.byteLength,
  };
}

function validateClinicalMediaPatient(input: { subject: unknown; fhirBaseUrl: string; patientIdHash: string }): void {
  if (input.subject === undefined) return;
  const reference = isObject(input.subject) ? input.subject.reference : undefined;
  const patientId = typeof reference === "string" ? normalizeClinicalFhirPatientReference({
    fhirBaseUrlHash: hashClinicalFhirBaseUrl(input.fhirBaseUrl), reference,
  }) : null;
  if (!patientId || hashClinicalFhirPatientId(patientId) !== input.patientIdHash) {
    throw new TypeError("FHIR Media patient does not match its attested parent.");
  }
}

function boundedMediaType(value: string): string {
  if (!value || value.length > 255 || /[\r\n\u0000]/u.test(value)) throw new TypeError("Invalid document media type.");
  normalizeMediaType(value);
  return value.trim();
}

function normalizeMediaType(value: string): string {
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mediaType.length > 255 || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(mediaType)) throw new TypeError("Invalid document media type.");
  return mediaType;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
