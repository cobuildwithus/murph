import { describe, expect, it } from "vitest";
import {
  clinicalDocumentAttachmentsSchema, decodeClinicalDocumentBase64,
  hashClinicalDocumentBytes, listClinicalFhirAttachments,
} from "../src/index.ts";

const body = Buffer.from("Synthetic document");
const digest = hashClinicalDocumentBytes(body);
const attachment = {
  parentPageSha256: "a".repeat(64), resourceType: "DocumentReference", resourceId: "document-1", attachmentIndex: 0,
  status: "downloaded", relativePath: `attachments/${digest}.bin`, sha256: digest, byteLength: body.length, mediaType: "text/plain",
};

describe("clinical attachment contracts", () => {
  it("binds immutable paths to exact bytes and rejects duplicate source slots", () => {
    expect(clinicalDocumentAttachmentsSchema.safeParse([attachment]).success).toBe(true);
    expect(clinicalDocumentAttachmentsSchema.safeParse([attachment, attachment]).success).toBe(false);
    expect(clinicalDocumentAttachmentsSchema.safeParse([{ ...attachment, relativePath: `attachments/${"b".repeat(64)}.bin` }]).success).toBe(false);
    expect(clinicalDocumentAttachmentsSchema.safeParse([{ ...attachment, relativePath: "attachments/../private.bin" }]).success).toBe(false);
  });
  it("preserves malformed positions and discovers report and document forms", () => {
    expect(listClinicalFhirAttachments({ resourceType: "DocumentReference", content: [null, { attachment: { url: "Binary/body", contentType: "application/pdf" } }] })).toEqual([
      { attachmentIndex: 0 }, { attachmentIndex: 1, url: "Binary/body", contentType: "application/pdf" },
    ]);
    expect(listClinicalFhirAttachments({ resourceType: "DiagnosticReport", presentedForm: [{ data: body.toString("base64"), title: "Report" }] })).toEqual([
      { attachmentIndex: 0, data: body.toString("base64"), title: "Report" },
    ]);
  });
  it("indexes DiagnosticReport media after presented forms without treating images as report prose", () => {
    expect(listClinicalFhirAttachments({ resourceType: "DiagnosticReport", presentedForm: [{ url: "Binary/report" }], media: [
      { link: { reference: "Media/image-1" }, comment: "Study image" }, null,
    ] })).toEqual([
      { attachmentIndex: 0, url: "Binary/report" },
      { attachmentIndex: 1, isMedia: true, url: "Media/image-1", title: "Study image" },
      { attachmentIndex: 2, isMedia: true },
    ]);
  });
  it("accepts provider-boundary failure tokens without accepting private free text", () => {
    const unavailable = { parentPageSha256: "a".repeat(64), resourceType: "DocumentReference", resourceId: "document-1", attachmentIndex: 0, status: "unavailable", errorCode: "document-size-exceeded" };
    expect(clinicalDocumentAttachmentsSchema.safeParse([unavailable]).success).toBe(true);
    expect(clinicalDocumentAttachmentsSchema.safeParse([{ ...unavailable, errorCode: "private provider message" }]).success).toBe(false);
  });
  it("decodes only complete canonical base64", () => {
    expect(decodeClinicalDocumentBase64(body.toString("base64"))).toEqual(body);
    const large = Buffer.alloc(4 * 1024 * 1024, 17);
    expect(decodeClinicalDocumentBase64(large.toString("base64"))).toEqual(large);
    expect(decodeClinicalDocumentBase64("SGVsbG8=!!!")).toBeNull();
    expect(decodeClinicalDocumentBase64("SGVsbG8")).toBeNull();
  });
});
