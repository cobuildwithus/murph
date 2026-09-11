import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  issueClinicalDocumentTickets, readClinicalDocumentResponse, readClinicalMediaResponse, resolveClinicalDocumentUrl,
  type ClinicalDocumentTicket,
} from "@/src/lib/clinical-records/documents";

const mocks = vi.hoisted(() => ({ seal: vi.fn() }));
vi.mock("@/src/lib/clinical-records/secrets", () => ({ sealClinicalDocumentTicket: mocks.seal }));
const base = "https://fhir.example.test/FHIR/R4";
const parent = { resourceType: "DocumentReference", id: "doc-1", meta: { lastUpdated: "2026-09-10T12:00:00Z" },
  subject: { reference: "Patient/patient-1" }, content: [{ attachment: { url: "Binary/body-1", contentType: "text/plain" } }] };
function issue(resources: unknown[]) {
  return issueClinicalDocumentTickets({ body: JSON.stringify({ resourceType: "Bundle", entry: resources.map(resource => ({ resource })) }),
    fhirBaseUrl: base, patientId: "patient-1", memberId: "member-1", runId: "run-1", generation: 1,
    queryScopeId: "documents", sliceId: "whole-family", queryFingerprint: "a".repeat(64) });
}
function ticket(extra: Partial<ClinicalDocumentTicket> = {}): ClinicalDocumentTicket {
  return { schema: "murph.clinical-document-ticket.v1", queryScopeId: "documents", sliceId: "whole-family", queryFingerprint: "a".repeat(64),
    parentPageSha256: "b".repeat(64), resourceType: "DocumentReference", resourceId: "doc-1", resourceVersion: "2026-09-10T12:00:00Z",
    attachmentIndex: 0, url: `${base}/Binary/body-1`, ...extra };
}

describe("Clinical document attachment boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.seal.mockResolvedValue("opaque-ticket"); });
  it.each([
    "https://outside.example.test/Binary/body-1", "https://fhir.example.test/FHIR/R40/Binary/body-1",
    "https://user:password@fhir.example.test/FHIR/R4/Binary/body-1", "//outside.example.test/Binary/body-1",
    "Binary/body-1?target=other", "Binary/body-1#fragment", "Binary/%2e%2e/Patient/other", "../Patient/other",
    "Binary/body-1\\other", "http://fhir.example.test/FHIR/R4/Binary/body-1", "Binary/body-1/extra",
  ])("rejects unsafe attachment URL %s", (url) => expect(() => resolveClinicalDocumentUrl(url, base)).toThrow());
  it("resolves only relative or exact-base Binary reads", () => {
    expect(resolveClinicalDocumentUrl(`Binary/${"a".repeat(66)}`, base).pathname.endsWith("a".repeat(66))).toBe(true);
    expect(resolveClinicalDocumentUrl("Binary/body-1", base).href).toBe(`${base}/Binary/body-1`);
    expect(resolveClinicalDocumentUrl(`${base}/Binary/body-1/_history/2`, base).href).toBe(`${base}/Binary/body-1/_history/2`);
  });
  it("attests DiagnosticReport study media as a bounded Media-to-Binary hop", async () => {
    const report = { resourceType: "DiagnosticReport", id: "report-media", meta: parent.meta, subject: parent.subject,
      presentedForm: [], media: [{ link: { reference: "Media/study-1" }, comment: "MRI image" }] };
    const descriptors = await issue([report]);
    expect(descriptors).toHaveLength(1);
    expect(JSON.parse(mocks.seal.mock.calls[0]![0].value)).toMatchObject({ sourceKind: "media", url: `${base}/Media/study-1` });
    const media = await readClinicalMediaResponse({
      response: Response.json({ resourceType: "Media", id: "study-1", content: { url: "Binary/image-1" } }),
      mediaUrl: new URL(`${base}/Media/study-1`), fhirBaseUrl: base, maxResponseBytes: 64 * 1024,
    });
    expect(media.binaryUrl.href).toBe(`${base}/Binary/image-1`);
  });
  it("attests both document and diagnostic report attachments without changing their parent", async () => {
    const report = { resourceType: "DiagnosticReport", id: "report-1", meta: parent.meta, subject: parent.subject,
      presentedForm: [{ url: `${base}/Binary/body-2`, contentType: "application/pdf" }] };
    const descriptors = await issue([parent, report]);
    expect(descriptors.map(value => [value.resourceType, value.resourceId, value.attachmentIndex, value.ticket]))
      .toEqual([["DocumentReference", "doc-1", 0, "opaque-ticket"], ["DiagnosticReport", "report-1", 0, "opaque-ticket"]]);
    expect(JSON.parse(mocks.seal.mock.calls[0]![0].value)).toMatchObject({ resourceVersion: parent.meta.lastUpdated, url: `${base}/Binary/body-1` });
  });
  it("withholds tickets from wrong patients, foreign absolute patient bases, and ambiguous duplicate parents", async () => {
    for (const reference of ["Patient/other", "https://outside.example.test/FHIR/R4/Patient/patient-1"]) {
      expect(await issue([{ ...parent, subject: { reference } }])).toMatchObject([{ ticket: null, errorCode: "document-patient-mismatch" }]);
    }
    expect(await issue([parent, parent])).toMatchObject([{ ticket: null, errorCode: "document-parent-ambiguous" }]);
    expect(mocks.seal).not.toHaveBeenCalled();
  });
  it("preserves unavailable references as explicit outcomes and skips inline bytes", async () => {
    const value = { ...parent, content: [
      { attachment: { url: "https://outside.example.test/document" } },
      { attachment: { url: "Binary/body-1", data: "dGV4dA==", contentType: "text/plain" } },
    ] };
    expect(await issue([value])).toMatchObject([{ attachmentIndex: 0, ticket: null, errorCode: "document-reference-unavailable" }]);
    expect(mocks.seal).not.toHaveBeenCalled();
  });
  it.each([false, true])("preserves exact raw/Binary JSON bytes and validates declared size/hash (%s)", async (json) => {
    const bytes = Buffer.from("Clinical summary\n");
    const response = json ? Response.json({ resourceType: "Binary", id: "body-1", contentType: "text/plain", data: bytes.toString("base64") })
      : new Response(bytes, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    const result = await readClinicalDocumentResponse({ response, ticket: ticket({ mediaType: "text/plain", size: bytes.length,
      hash: createHash("sha1").update(bytes).digest("base64") }), url: new URL(`${base}/Binary/body-1`), maxResponseBytes: 30 * 1024 * 1024 });
    expect(result.bytes.equals(bytes)).toBe(true);
    expect(result.mediaType).toBe(json ? "text/plain" : "text/plain; charset=utf-8");
  });
  it.each([
    { id: "other" }, { data: "%%%" }, { data: "aA" }, { contentType: "application/pdf" },
  ])("rejects mismatched or malformed Binary response %j", async (patch) => {
    const response = Response.json({ resourceType: "Binary", id: "body-1", contentType: "text/plain", data: "aGk=", ...patch });
    await expect(readClinicalDocumentResponse({ response, ticket: ticket({ mediaType: "text/plain" }), url: new URL(`${base}/Binary/body-1`), maxResponseBytes: 1024 })).rejects.toThrow();
  });
  it("keeps useful PDF bodies larger than the FHIR page bound", async () => {
    const bytes = Buffer.alloc(6 * 1024 * 1024, 32);
    bytes.write("%PDF-1.7");
    const result = await readClinicalDocumentResponse({ response: new Response(bytes, { headers: { "Content-Type": "application/pdf" } }),
      ticket: ticket({ mediaType: "application/pdf" }), url: new URL(`${base}/Binary/body-1`), maxResponseBytes: 30 * 1024 * 1024 });
    expect(result.bytes.equals(bytes)).toBe(true);
  });
  it("cancels an over-limit stream even when Content-Length lies", async () => {
    const canceled = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(21 * 1024 * 1024)); }, cancel: canceled }),
      { headers: { "Content-Type": "application/pdf", "Content-Length": "2" } });
    await expect(readClinicalDocumentResponse({ response, ticket: ticket(), url: new URL(`${base}/Binary/body-1`), maxResponseBytes: 30 * 1024 * 1024 })).rejects.toThrow();
    expect(canceled).toHaveBeenCalledOnce();
  });
});
