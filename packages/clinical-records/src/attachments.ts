import { createHash } from "node:crypto";
import * as z from "@murphai/contracts/zod-runtime";

export const CLINICAL_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;
export const CLINICAL_DOCUMENTS_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const CLINICAL_DOCUMENT_MAX_ATTACHMENTS = 2_000;
const digest = z.string().regex(/^[a-f0-9]{64}$/u);

export const clinicalDocumentAttachmentIdentitySchema = z.object({
  parentPageSha256: digest,
  resourceType: z.enum(["DocumentReference", "DiagnosticReport"]),
  resourceId: z.string().regex(/^[A-Za-z0-9.-]{1,200}$/u),
  attachmentIndex: z.number().int().min(0).max(CLINICAL_DOCUMENT_MAX_ATTACHMENTS - 1),
}).strict();

export const clinicalDocumentAttachmentSchema = z.discriminatedUnion("status", [
  clinicalDocumentAttachmentIdentitySchema.extend({
    status: z.literal("downloaded"),
    relativePath: z.string().regex(/^attachments\/[a-f0-9]{64}\.bin$/u),
    mediaType: z.string().min(1).max(255).regex(/^[^\r\n\x00]+$/u),
    sha256: digest,
    byteLength: z.number().int().min(1).max(CLINICAL_DOCUMENT_MAX_BYTES),
  }).strict(),
  clinicalDocumentAttachmentIdentitySchema.extend({
    status: z.literal("unavailable"),
    errorCode: z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/u),
  }).strict(),
]);

export type ClinicalDocumentAttachmentIdentity = z.infer<typeof clinicalDocumentAttachmentIdentitySchema>;
export type ClinicalDocumentAttachment = z.infer<typeof clinicalDocumentAttachmentSchema>;

export function clinicalDocumentAttachmentKey(value: ClinicalDocumentAttachmentIdentity): string {
  return JSON.stringify([value.parentPageSha256, value.resourceType, value.resourceId, value.attachmentIndex]);
}

export const clinicalDocumentAttachmentsSchema = z.array(clinicalDocumentAttachmentSchema)
  .max(CLINICAL_DOCUMENT_MAX_ATTACHMENTS)
  .superRefine((attachments, context) => {
    const keys = new Set<string>();
    const files = new Map<string, number>();
    for (const attachment of attachments) {
      const key = clinicalDocumentAttachmentKey(attachment);
      if (keys.has(key)) context.addIssue({ code: "custom", message: "Duplicate clinical document attachment identity." });
      keys.add(key);
      if (attachment.status === "downloaded") {
        if (attachment.relativePath !== `attachments/${attachment.sha256}.bin`) {
          context.addIssue({ code: "custom", message: "Clinical document path must match its digest." });
        }
        files.set(attachment.relativePath, attachment.byteLength);
      }
    }
    if ([...files.values()].reduce((total, length) => total + length, 0) > CLINICAL_DOCUMENTS_MAX_TOTAL_BYTES) {
      context.addIssue({ code: "custom", message: "Clinical document evidence exceeds the byte budget." });
    }
  });

export interface ClinicalFhirAttachment {
  attachmentIndex: number;
  isMedia?: true;
  contentType?: string;
  data?: string;
  url?: string;
  title?: string;
  size?: number;
  hash?: string;
}

/** Keep every slot, including malformed slots, so missing content never looks complete. */
export function listClinicalFhirAttachments(resource: unknown): ClinicalFhirAttachment[] {
  if (!isRecord(resource)) return [];
  const values = resource.resourceType === "DocumentReference" ? resource.content
    : resource.resourceType === "DiagnosticReport" ? resource.presentedForm : undefined;
  const slots = values === undefined ? [] : Array.isArray(values) ? values : [undefined];
  const documents: ClinicalFhirAttachment[] = slots.map((value, attachmentIndex) => {
    const attachment = resource.resourceType === "DocumentReference" && isRecord(value) ? value.attachment : value;
    if (!isRecord(attachment)) return { attachmentIndex };
    return {
      attachmentIndex,
      ...(typeof attachment.contentType === "string" ? { contentType: attachment.contentType } : {}),
      ...(typeof attachment.data === "string" ? { data: attachment.data } : {}),
      ...(typeof attachment.url === "string" ? { url: attachment.url } : {}),
      ...(typeof attachment.title === "string" ? { title: attachment.title } : {}),
      ...(typeof attachment.size === "number" ? { size: attachment.size } : {}),
      ...(typeof attachment.hash === "string" ? { hash: attachment.hash } : {}),
    };
  });
  if (resource.resourceType !== "DiagnosticReport" || resource.media === undefined) return documents;
  const media = Array.isArray(resource.media) ? resource.media : [undefined];
  return [...documents, ...media.map((value, index): ClinicalFhirAttachment => ({
    attachmentIndex: documents.length + index,
    isMedia: true,
    ...(isRecord(value) && isRecord(value.link) && typeof value.link.reference === "string" ? { url: value.link.reference } : {}),
    ...(isRecord(value) && typeof value.comment === "string" ? { title: value.comment } : {}),
  }))];
}

export function decodeClinicalDocumentBase64(value: string): Buffer | null {
  if (value.length > Math.ceil(CLINICAL_DOCUMENT_MAX_BYTES / 3) * 4 + 1024) return null;
  const normalized = value.replace(/\s+/gu, "");
  if (!normalized || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(normalized)) return null;
  const bytes = Buffer.from(normalized, "base64");
  return bytes.length <= CLINICAL_DOCUMENT_MAX_BYTES && bytes.toString("base64") === normalized ? bytes : null;
}

export function hashClinicalDocumentBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
