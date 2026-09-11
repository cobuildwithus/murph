import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  CLINICAL_FHIR_MAX_RETRIEVAL_SLICES,
  CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE,
  CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES,
} from "@murphai/clinical-records";
import { findEventByExternalRef, initializeVault } from "@murphai/core";
import {
  HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE,
  type HostedClinicalRecordsRunDescriptor,
} from "@murphai/hosted-execution/clinical-records";
import {
  importClinicalFhirSnapshot,
  readClinicalFhirRetrievalCheckpointForRun,
} from "@murphai/vault-usecases/clinical-records";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runHostedClinicalRecordsSyncWakeLane } from "../src/hosted-runtime/clinical-records-maintenance.ts";
import { readHostedSystemMailboxState } from "../src/hosted-runtime/system-mailbox-state.ts";
import { readNextClinicalEnrichment } from "@murphai/vault-usecases/clinical-enrichment";
import type { HostedRuntimeClinicalRecordsPort } from "../src/hosted-runtime/platform.ts";

const HASH = "a".repeat(64);
const RUN: HostedClinicalRecordsRunDescriptor = {
  retrievalProtocol: "query-slices-v2",
  connectionId: "connection_1",
  fetchedAt: "2026-07-10T12:00:00.000Z",
  fhirBaseUrlHash: hash("https://ehr.example.test/fhir"),
  generation: 1,
  grantedScopes: ["patient/Observation.read"],
  patientIdHash: hash("patient-1"),
  requestedScopes: ["patient/Observation.read"],
  retrievalJobId: "clinical_run_1",
  retrievalSlices: [{ queryScopeId: "observation", sliceId: "whole", coverage: "whole-family", queryFingerprint: HASH, resourceType: "Observation" }],
  runId: "clinical_run_1",
  sourceSystem: "epic-fhir",
};
const WAKE = {
  eventId: "clinical-sync-1", generation: 1,
  kind: "clinical-records.sync-requested" as const,
  occurredAt: "2026-07-10T12:00:00.000Z",
  runId: "clinical_run_1", userId: "member_1",
};
type ImportSnapshot = NonNullable<Parameters<typeof runHostedClinicalRecordsSyncWakeLane>[0]["importSnapshot"]>;
let vaultRoot: string;
beforeEach(async () => { vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-clinical-runtime-")); });
afterEach(async () => { vi.useRealTimers(); await rm(vaultRoot, { force: true, recursive: true }); });

describe("hosted clinical records maintenance", () => {
  it("imports each page before fetching the next and accumulates counts without claiming complete batch coverage", async () => {
    const nextUrl = "https://ehr.example.test/fhir/Observation?page=2";
    const bodies = [bundle([lab("first")], nextUrl), bundle([lab("second")])];
    const importSnapshot = successfulImport();
    const fetchPage = vi.fn<HostedRuntimeClinicalRecordsPort["fetchPage"]>(async (request) => {
      if (request.cursor === null) return { body: bodies[0]!, nextCursor: "opaque-2", status: "page" };
      expect(importSnapshot).toHaveBeenCalledOnce();
      return { body: bodies[1]!, pageUrlHash: hash(nextUrl), nextCursor: null, status: "page" };
    });
    const port = createPort({ fetchPage });
    const result = await run(port, importSnapshot);
    expect(fetchPage).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: "opaque-2", generation: 1, queryScopeId: "observation" }), { signal: null });
    expect(importSnapshot).toHaveBeenCalledTimes(2);
    expect(importSnapshot.mock.calls.map(([snapshot]) => snapshot.pages.map((page) => page.content))).toEqual(bodies.map((body) => [body]));
    expect(importSnapshot.mock.calls.every(([snapshot]) => snapshot.completedRetrievalSlices?.length === 0)).toBe(true);
    expect(importSnapshot.mock.calls[1]?.[0].batch).toMatchObject({ index: 1, previous: { sha256: HASH } });
    expect(result).toMatchObject({ status: "completed", counts: { createdCount: 2, rawFileCount: 4, fetchedPageCount: 2, fetchedResourceFamilyCount: 1 } });
    expect(port.recordOutcome).not.toHaveBeenCalled();
  });

  it("saves actual canonical lab evidence before a later page fails", async () => {
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const nextUrl = "https://ehr.example.test/fhir/Observation?page=2";
    const fetchPage = vi.fn<HostedRuntimeClinicalRecordsPort["fetchPage"]>()
      .mockResolvedValueOnce({ body: bundle([lab("saved-a1c")], nextUrl), nextCursor: "cursor-2", status: "page" })
      .mockResolvedValueOnce({ status: "unavailable", errorCode: "provider_denied", retryable: false });
    const importSnapshot = vi.fn(importClinicalFhirSnapshot);
    const result = await run(createPort({ fetchPage }), importSnapshot);
    expect(result).toMatchObject({ status: "partial", counts: { createdCount: 1, labResultCount: 1, fetchedResourceFamilyCount: 0 }, outcome: { errorCode: "provider_denied" } });
    const imported = await importSnapshot.mock.results[0]!.value;
    const manifest = JSON.parse(await readFile(path.join(vaultRoot, imported.manifestPath), "utf8"));
    expect(manifest.completedRetrievalSlices).toEqual([]);
    expect(manifest.resourceFiles).toHaveLength(1);
    expect(manifest.resourceFiles[0].count).toBe(1);
    const rawPage = await readFile(path.join(path.dirname(path.join(vaultRoot, imported.manifestPath)), manifest.resourceFiles[0].relativePath), "utf8");
    expect(rawPage).toContain("saved-a1c");
  });

  it.each(["warning", "error", "fatal"])("reports provider %s outcomes as incomplete", async (severity) => {
    const result = await run(createPort({ fetchPage: async () => ({ status: "page", nextCursor: null,
      body: bundle([{ resourceType: "OperationOutcome", issue: [{ severity, code: "incomplete" }] }]),
    }) }), successfulImport());
    expect(result).toMatchObject({ status: "partial", outcome: { errorCode: "provider-search-incomplete" } });
  });

  it("retains committed same-resource query slices across preemption without replaying imports", async () => {
    const queryRun = createQueryRun(["labs", "vitals"]);
    const port = createPort({ readRun: async () => ({ status: "ready", run: queryRun }) });
    let shouldYield = false;
    const importSnapshot = successfulImport(async () => { shouldYield = true; });
    await expect(run(port, importSnapshot, () => shouldYield)).rejects.toMatchObject({ code: "CLINICAL_RECORDS_FOREGROUND_PREEMPTED" });
    expect(await checkpoint()).toMatchObject({ checkpoint: { batchIndex: 1, pages: [], importedCounts: { createdCount: 1 }, currentResourceIndex: 1 } });
    const completed = await run(port, importSnapshot);
    expect(importSnapshot).toHaveBeenCalledTimes(2);
    expect(importSnapshot.mock.calls.map(([snapshot]) => snapshot.pages[0]?.queryScopeId)).toEqual(["labs", "vitals"]);
    expect(completed).toMatchObject({ status: "completed", counts: { createdCount: 2, fetchedResourceFamilyCount: 1 } });
    expect(await checkpoint()).toBeNull();
  });

  it("completes the maximum query plan with bounded page imports", async () => {
    const scopes = Array.from({ length: CLINICAL_FHIR_MAX_RETRIEVAL_SLICES }, (_, index) => `observation-${index}`);
    const queryRun = createQueryRun(scopes);
    const importSnapshot = successfulImport();
    const result = await run(createPort({ readRun: async () => ({ status: "ready", run: queryRun }) }), importSnapshot);
    expect(importSnapshot).toHaveBeenCalledTimes(scopes.length);
    expect(result).toMatchObject({ status: "completed", counts: { fetchedPageCount: scopes.length, fetchedResourceFamilyCount: 1 } });
  });

  it("retains the active slice on authorization loss and does not attempt remaining queries", async () => {
    const queryRun = createQueryRun(["labs", "vitals", "unattempted"]);
    const port = createPort({ readRun: async () => ({ status: "ready", run: queryRun }),
      fetchPage: vi.fn<HostedRuntimeClinicalRecordsPort["fetchPage"]>()
        .mockResolvedValueOnce({ status: "page", body: bundle([lab("saved")]), nextCursor: "next" })
        .mockResolvedValueOnce({ status: "unavailable", retryable: false, errorCode: HOSTED_CLINICAL_RECORDS_AUTHORIZATION_REQUIRED_ERROR_CODE }),
    });
    const result = await run(port, successfulImport());
    expect(port.fetchPage).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: "partial", counts: { createdCount: 1, fetchedResourceFamilyCount: 0 }, outcome: { errorCode: "authorization-required" } });
    expect(port.recordOutcome).not.toHaveBeenCalled();
  });

  it("preserves committed counts when a later import rejects", async () => {
    const importSnapshot = successfulImport();
    importSnapshot.mockImplementationOnce(async (snapshot) => importResult(snapshot));
    importSnapshot.mockRejectedValueOnce(Object.assign(new Error("safe semantic rejection"), { code: "CLINICAL_FHIR_SNAPSHOT_REJECTED" }));
    const port = createPort({ fetchPage: pageSequence([bundle([lab("saved")]), bundle([lab("rejected")])]) });
    const result = await run(port, importSnapshot);
    expect(result).toMatchObject({ status: "partial", counts: { createdCount: 1 }, outcome: { errorCode: "snapshot_rejected" } });
    expect(await checkpoint()).toBeNull();
  });

  it("terminalizes an initial deterministic import rejection without claiming saved records", async () => {
    const importSnapshot = successfulImport();
    importSnapshot.mockRejectedValueOnce(Object.assign(new Error("safe semantic rejection"), { code: "CLINICAL_FHIR_SNAPSHOT_REJECTED" }));
    const result = await run(createPort(), importSnapshot);
    expect(result).toMatchObject({ status: "failed", counts: { createdCount: 0, rawFileCount: 0 }, outcome: { errorCode: "snapshot_rejected" } });
    expect(await checkpoint()).toBeNull();
  });

  it.each(["readRun", "fetchPage"] as const)("retries transient %s misses without terminal outcomes", async (operation) => {
    const unavailable = { status: "unavailable" as const, errorCode: "temporarily_unavailable", retryable: true };
    const port = createPort(operation === "readRun" ? { readRun: async () => unavailable } : { fetchPage: async () => unavailable });
    const importSnapshot = successfulImport();
    await expect(run(port, importSnapshot)).rejects.toMatchObject({ code: operation === "readRun" ? "CLINICAL_RECORDS_RUN_RETRYABLE" : "CLINICAL_RECORDS_PAGE_RETRYABLE" });
    expect(importSnapshot).not.toHaveBeenCalled();
    expect(port.recordOutcome).not.toHaveBeenCalled();
  });

  it("retries a later page without importing the committed page twice", async () => {
    const port = createPort({ fetchPage: vi.fn<HostedRuntimeClinicalRecordsPort["fetchPage"]>()
      .mockResolvedValueOnce({ status: "page", body: bundle([lab("first")]), nextCursor: "next" })
      .mockResolvedValueOnce({ status: "unavailable", errorCode: "temporarily_unavailable", retryable: true })
      .mockResolvedValueOnce({ status: "page", body: bundle([lab("second")]), nextCursor: null }) });
    const importSnapshot = successfulImport();
    await expect(run(port, importSnapshot)).rejects.toMatchObject({ code: "CLINICAL_RECORDS_PAGE_RETRYABLE" });
    expect(await checkpoint()).toMatchObject({ checkpoint: { importedCounts: { createdCount: 1 }, cursor: "next", pages: [] } });
    expect(await run(port, importSnapshot)).toMatchObject({ status: "completed", counts: { createdCount: 2, fetchedPageCount: 2 } });
    expect(importSnapshot).toHaveBeenCalledTimes(2);
    expect(port.fetchPage).toHaveBeenNthCalledWith(3, expect.objectContaining({ cursor: "next" }), { signal: null });
  });

  it.each(["cursor", "page-url"])("detects a %s cycle while preserving earlier imports", async (cycle) => {
    let fetchedPages = 0;
    const fetchPage = vi.fn<HostedRuntimeClinicalRecordsPort["fetchPage"]>(async () => ({
      body: bundle([]), nextCursor: cycle === "cursor" ? "repeated" : `cursor-${++fetchedPages}`,
      ...(cycle === "page-url" ? { pageUrlHash: HASH } : {}), status: "page",
    }));
    const result = await run(createPort({ fetchPage }), successfulImport());
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: "partial", outcome: { errorCode: "cursor_cycle" }, counts: { createdCount: cycle === "cursor" ? 2 : 1 } });
  });

  it.each([
    { body: "not-json", code: "invalid_fhir_page" },
    { body: "漢".repeat(Math.floor(CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES / 3) + 1), code: "page_size_exceeded" },
    { body: bundle(Array.from({ length: CLINICAL_RAW_MANIFEST_MAX_RESOURCES_PER_FILE + 1 }, () => ({ resourceType: "Observation" }))), code: "page_resource_limit_exceeded" },
  ])("keeps earlier page evidence when a later page violates $code", async ({ body, code }) => {
    const importSnapshot = successfulImport();
    const result = await run(createPort({ fetchPage: pageSequence([bundle([lab("retained")]), body]) }), importSnapshot);
    expect(importSnapshot).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ status: "partial", counts: { createdCount: 1 }, outcome: { errorCode: code } });
  });

  it("imports more than 32 MiB and 5,000 resources across bounded pages and resumes midway", async () => {
    const pages = Array.from({ length: 9 }, (_, index) => JSON.stringify({
      resourceType: "Bundle", page: index, padding: "x".repeat(4 * 1024 * 1024),
      entry: Array.from({ length: 600 }, (_, resource) => ({ resource: { resourceType: "Observation", id: `observation-${index}-${resource}` } })),
    }));
    expect(pages.reduce((bytes, page) => bytes + Buffer.byteLength(page), 0)).toBeGreaterThan(32 * 1024 * 1024);
    expect(pages.every((page) => Buffer.byteLength(page) < CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES)).toBe(true);
    const port = createPort({ fetchPage: pageSequence(pages) });
    const importSnapshot = successfulImport();
    await expect(run(port, importSnapshot, () => importSnapshot.mock.calls.length === 4)).rejects.toMatchObject({ code: "CLINICAL_RECORDS_FOREGROUND_PREEMPTED" });
    expect(await checkpoint()).toMatchObject({ checkpoint: { batchIndex: 4, pages: [], importedCounts: { createdCount: 4 } } });
    const result = await run(port, importSnapshot);
    expect(port.fetchPage).toHaveBeenCalledTimes(9);
    expect(importSnapshot.mock.calls.map(([snapshot]) => snapshot.pages.map((page) => hash(page.content)))).toEqual(pages.map((page) => [hash(page)]));
    expect(result).toMatchObject({ status: "completed", counts: { fetchedPageCount: 9, createdCount: 9 } });
  }, 30_000);

  it.each(["connection-inactive", "run-generation-stale"])("denies stale %s authority at the vault write boundary", async (errorCode) => {
    const port = createPort({ readRun: vi.fn<HostedRuntimeClinicalRecordsPort["readRun"]>()
      .mockResolvedValueOnce({ status: "ready", run: RUN })
      .mockResolvedValueOnce({ status: "unavailable", retryable: false, errorCode }) });
    let writes = 0;
    const importSnapshot = successfulImport(async (snapshot) => { await snapshot.assertCurrent?.(); writes += 1; });
    expect(await run(port, importSnapshot)).toMatchObject({ status: "unavailable", outcome: null });
    expect(writes).toBe(0);
    expect(await checkpoint()).toBeNull();
  });

  it("rejects a run descriptor that does not match the mailbox generation", async () => {
    const port = createPort({ readRun: async () => ({ status: "ready", run: { ...RUN, generation: 2 } }) });
    await expect(run(port, successfulImport())).rejects.toMatchObject({ code: "CLINICAL_RECORDS_RUN_POINTER_MISMATCH" });
    expect(port.fetchPage).not.toHaveBeenCalled();
  });

  it("consumes unavailable terminal pointers without fetching or rewriting outcomes", async () => {
    const port = createPort({ readRun: async () => ({ status: "unavailable", errorCode: "authorization-required", retryable: false }) });
    expect(await run(port, successfulImport())).toMatchObject({ status: "unavailable", outcome: null });
    expect(port.fetchPage).not.toHaveBeenCalled();
    expect(port.recordOutcome).not.toHaveBeenCalled();
  });

  it("preempts before reading without consuming the mailbox work", async () => {
    const port = createPort();
    await expect(run(port, successfulImport(), () => true)).rejects.toMatchObject({ code: "CLINICAL_RECORDS_FOREGROUND_PREEMPTED" });
    expect(port.readRun).not.toHaveBeenCalled();
  });

  it.each(["read", "import"])("aborts an in-flight %s when foreground work arrives", async (stage) => {
    let shouldYield = false;
    const blocked = vi.fn(async (signal: AbortSignal | null | undefined) => await new Promise<never>((_resolve, reject) => {
      if (!signal) return reject(new Error("Expected cancellation signal"));
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const port = createPort(stage === "read" ? { readRun: async (_request, options) => blocked(options?.signal) } : {});
    const importSnapshot = stage === "import" ? vi.fn<ImportSnapshot>(async (snapshot) => blocked(snapshot.signal)) : successfulImport();
    const pending = run(port, importSnapshot, () => shouldYield);
    await vi.waitFor(() => expect(blocked).toHaveBeenCalledOnce());
    shouldYield = true;
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(port.recordOutcome).not.toHaveBeenCalled();
  });

  it("retains a committed final batch if cancellation arrives at commit completion", async () => {
    const controller = new AbortController();
    const port = createPort();
    const importSnapshot = successfulImport(async () => { controller.abort(new DOMException("Foreground work arrived", "AbortError")); });
    await expect(runHostedClinicalRecordsSyncWakeLane({ clinicalRecordsPort: port, importSnapshot, signal: controller.signal, vaultRoot, wake: WAKE })).rejects.toMatchObject({ name: "AbortError" });
    expect(await checkpoint()).toMatchObject({ checkpoint: { pages: [], importedCounts: { createdCount: 1 }, batchIndex: 1 } });
    expect(await run(port, importSnapshot)).toMatchObject({ status: "completed", counts: { createdCount: 1 } });
    expect(port.fetchPage).toHaveBeenCalledOnce();
    expect(importSnapshot).toHaveBeenCalledOnce();
  });

  it("downloads ticketed and inline documents into the import owner with original bytes", async () => {
    const fixture = documentPage();
    const port = createPort({ readRun: async () => ({ status: "ready", run: documentRun() }),
      fetchPage: async () => fixture.page,
      fetchDocument: async () => documentResponse("downloaded clinical document"),
    });
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const importSnapshot = vi.fn(importClinicalFhirSnapshot);
    expect(await run(port, importSnapshot)).toMatchObject({ status: "completed" });
    expect(port.fetchDocument).toHaveBeenCalledOnce();
    expect(port.fetchDocument).toHaveBeenCalledWith({ generation: 1, runId: RUN.runId, ticket: "opaque-document-ticket" }, { signal: null });
    const snapshot = importSnapshot.mock.calls[0]![0];
    expect(snapshot.attachments?.map((attachment) => Buffer.from(attachment.contentBase64, "base64").toString()).sort()).toEqual(["downloaded clinical document", "inline clinical document"]);
    expect(snapshot.documentAttachments).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceId: "document-1", attachmentIndex: 0, status: "downloaded", parentPageSha256: hash(fixture.page.body) }),
      expect.objectContaining({ resourceId: "document-1", attachmentIndex: 1, status: "downloaded", parentPageSha256: hash(fixture.page.body) }),
    ]));
  });

  it("persists downloaded and inline document bodies as immutable vault evidence", async () => {
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const fixture = documentPage();
    const importSnapshot = vi.fn(importClinicalFhirSnapshot);
    const port = createPort({ readRun: async () => ({ status: "ready", run: documentRun() }), fetchPage: async () => fixture.page,
      fetchDocument: async () => documentResponse("downloaded clinical document"),
    });
    const result = await run(port, importSnapshot);
    expect(result).toMatchObject({ status: "completed", counts: { createdCount: 1 } });
    const imported = await importSnapshot.mock.results[0]!.value;
    const directory = path.dirname(path.join(vaultRoot, imported.manifestPath));
    const stored = await Promise.all(["inline clinical document", "downloaded clinical document"].map(async (content) =>
      readFile(path.join(directory, "attachments", `${hash(content)}.bin`), "utf8")));
    expect(stored).toEqual(["inline clinical document", "downloaded clinical document"]);
    const state = await readHostedSystemMailboxState(vaultRoot);
    expect(state.pending).toEqual([expect.objectContaining({
      routeAction: "apply-clinical-enrichment",
      wake: expect.objectContaining({ kind: "clinical-records.enrichment-requested", jobId: imported.manifestSha256 }),
    })]);
    expect(await readNextClinicalEnrichment({ vaultRoot })).toMatchObject({
      status: "extract", jobId: imported.manifestSha256, page: 1,
    });
  });

  it("retains an active staged page when authorization expires while downloading documents", async () => {
    const fixture = documentPage();
    let authorized = true;
    const port = createPort({ readRun: async () => authorized
      ? { status: "ready", run: documentRun() }
      : { status: "unavailable", errorCode: "authorization-required", retryable: false },
      fetchPage: async () => ({ ...fixture.page, nextCursor: "next-page" }),
      fetchDocument: async () => ({ status: "unavailable", errorCode: "temporarily_unavailable", retryable: true }),
    });
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const importSnapshot = vi.fn(importClinicalFhirSnapshot);
    await expect(run(port, importSnapshot)).rejects.toMatchObject({ code: "CLINICAL_RECORDS_DOCUMENT_RETRYABLE" });
    expect(importSnapshot).not.toHaveBeenCalled();
    expect(await checkpoint()).toMatchObject({ checkpoint: {
      pages: [{ content: fixture.page.body }],
      pendingDocuments: [{ ticket: "opaque-document-ticket" }],
      attachments: [{ contentBase64: Buffer.from("inline clinical document").toString("base64") }],
    } });
    authorized = false;
    const result = await run(port, importSnapshot);
    expect(result).toMatchObject({ status: "partial", counts: { createdCount: 1, labResultCount: 0, fetchedResourceFamilyCount: 0 }, outcome: { errorCode: "authorization-required" } });
    expect(importSnapshot).toHaveBeenCalledOnce();
    expect(importSnapshot.mock.calls[0]?.[0].pages.map((page) => page.content)).toEqual([fixture.page.body]);
    expect(importSnapshot.mock.calls[0]?.[0].attachments).toHaveLength(1);
    expect(importSnapshot.mock.calls[0]?.[0].documentAttachments).toEqual(expect.arrayContaining([
      expect.objectContaining({ resourceId: "document-1", attachmentIndex: 0, status: "downloaded" }),
      expect.objectContaining({ resourceId: "document-1", attachmentIndex: 1, status: "unavailable" }),
    ]));
    const imported = await importSnapshot.mock.results[0]!.value;
    const rawRoot = path.posix.dirname(imported.manifestPath);
    const rawPage = `${rawRoot}/documents/whole/DocumentReference/page-0001.json`;
    expect(await readFile(path.join(vaultRoot, rawPage), "utf8")).toBe(fixture.page.body);
    expect(await readFile(path.join(vaultRoot, rawRoot, "attachments", `${hash("inline clinical document")}.bin`), "utf8")).toBe("inline clinical document");
    // The canonical result is source metadata, not a prematurely complete document body.
    expect(await findEventByExternalRef({
      vaultRoot, system: `epic-fhir-${RUN.fhirBaseUrlHash}-${RUN.patientIdHash}`,
      resourceType: "document-reference", resourceId: "document-1",
    })).toMatchObject({
      kind: "note", source: "import", noteType: "clinical-document-receipt",
      note: "FHIR DocumentReference source document.\nSource status: current.\nAttachment count: 2.",
      evidence: [{ rawRef: rawPage, sourceLabel: "DocumentReference/document-1" }],
    });
    expect(await readNextClinicalEnrichment({ vaultRoot })).toMatchObject({ status: "extract" });
    expect(port.fetchPage).toHaveBeenCalledOnce();
    expect(port.fetchDocument).toHaveBeenCalledOnce();
    expect(await checkpoint()).toBeNull();
  });

  it("resumes transient document failures without refetching the page or losing inline bytes", async () => {
    const fixture = documentPage();
    const port = createPort({ readRun: async () => ({ status: "ready", run: documentRun() }), fetchPage: async () => fixture.page,
      fetchDocument: vi.fn<NonNullable<HostedRuntimeClinicalRecordsPort["fetchDocument"]>>()
        .mockResolvedValueOnce({ status: "unavailable", errorCode: "temporarily_unavailable", retryable: true })
        .mockResolvedValueOnce(documentResponse("downloaded clinical document")),
    });
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const importSnapshot = vi.fn(importClinicalFhirSnapshot);
    await expect(run(port, importSnapshot)).rejects.toMatchObject({ code: "CLINICAL_RECORDS_DOCUMENT_RETRYABLE" });
    expect(importSnapshot).not.toHaveBeenCalled();
    expect(await checkpoint()).toMatchObject({ checkpoint: { pages: [{ content: fixture.page.body }], pendingDocuments: [{ ticket: "opaque-document-ticket" }], attachments: [{ contentBase64: Buffer.from("inline clinical document").toString("base64") }] } });
    expect(await run(port, importSnapshot)).toMatchObject({ status: "completed" });
    expect(port.fetchPage).toHaveBeenCalledOnce();
    expect(importSnapshot.mock.calls[0]?.[0].attachments).toHaveLength(2);
  });

  it("does not download accepted document bytes twice after preemption", async () => {
    const fixture = documentPage();
    let shouldYield = false;
    const port = createPort({ readRun: async () => ({ status: "ready", run: documentRun() }), fetchPage: async () => fixture.page,
      fetchDocument: async () => { shouldYield = true; return documentResponse("downloaded clinical document"); },
    });
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const importSnapshot = vi.fn(importClinicalFhirSnapshot);
    await expect(run(port, importSnapshot, () => shouldYield)).rejects.toMatchObject({ code: "CLINICAL_RECORDS_FOREGROUND_PREEMPTED" });
    expect(await checkpoint()).toMatchObject({ checkpoint: { pendingDocuments: [], attachments: expect.any(Array) } });
    expect(importSnapshot).not.toHaveBeenCalled();
    expect(await run(port, importSnapshot)).toMatchObject({ status: "completed" });
    expect(port.fetchPage).toHaveBeenCalledOnce();
    expect(port.fetchDocument).toHaveBeenCalledOnce();
    expect(importSnapshot.mock.calls[0]?.[0].attachments).toHaveLength(2);
  });

  it("rejects altered download bytes before they reach canonical import", async () => {
    const port = createPort({ readRun: async () => ({ status: "ready", run: documentRun() }), fetchPage: async () => documentPage().page,
      fetchDocument: async () => ({ ...documentResponse("downloaded clinical document"), sha256: HASH }),
    });
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const importSnapshot = vi.fn(importClinicalFhirSnapshot);
    await expect(run(port, importSnapshot)).rejects.toMatchObject({ code: "CLINICAL_RECORDS_DOCUMENT_INTEGRITY" });
    expect(importSnapshot).not.toHaveBeenCalled();
    expect((await checkpoint())?.checkpoint.pendingDocuments).toHaveLength(1);
  });

  it("preserves missing document tickets as unavailable evidence instead of silently omitting them", async () => {
    const fixture = documentPage();
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const importSnapshot = vi.fn(importClinicalFhirSnapshot);
    const port = createPort({ readRun: async () => ({ status: "ready", run: documentRun() }), fetchPage: async () => ({ ...fixture.page, documents: [] }) });
    await run(port, importSnapshot);
    expect(port.fetchDocument).not.toHaveBeenCalled();
    expect(importSnapshot.mock.calls[0]?.[0].documentAttachments).toContainEqual(expect.objectContaining({ attachmentIndex: 1, status: "unavailable", errorCode: "document_unavailable" }));
  });

  it("keeps raw FHIR and the clinical importer out of the static mailbox path", async () => {
    const [events, importer, maintenance] = await Promise.all([
      readFile(new URL("../src/hosted-runtime/events.ts", import.meta.url), "utf8"),
      readFile(new URL("../../importers/src/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/hosted-runtime/clinical-records-maintenance-import.ts", import.meta.url), "utf8"),
    ]);
    expect(events).not.toContain("@murphai/vault-usecases/clinical-records");
    expect(events).not.toContain("@murphai/importers/clinical-records");
    expect(importer).not.toContain('export * from "./clinical-records/index.js"');
    expect(maintenance).toContain('import("./clinical-records-maintenance.ts")');
  });
});

function run(port: HostedRuntimeClinicalRecordsPort, importSnapshot: ImportSnapshot, shouldYieldClinicalRecords?: () => boolean) {
  return runHostedClinicalRecordsSyncWakeLane({ clinicalRecordsPort: port, importSnapshot, shouldYieldClinicalRecords, vaultRoot, wake: WAKE });
}
function checkpoint() { return readClinicalFhirRetrievalCheckpointForRun({ identity: WAKE, vaultRoot }); }
function successfulImport(before?: (input: Parameters<ImportSnapshot>[0]) => Promise<void>) {
  return vi.fn<ImportSnapshot>(async (snapshot) => { await before?.(snapshot); return importResult(snapshot); });
}
function importResult(snapshot: Parameters<ImportSnapshot>[0]): Awaited<ReturnType<ImportSnapshot>> {
  return {
    canonical: { applied: true, createdCount: 1, retractedCount: 0, skippedExistingCount: 0, supersededCount: 0 },
    executableDecisionCount: 1, labResultCount: 0, incompleteRevisionCount: 0,
    manifestPath: `raw/clinical/fhir/${snapshot.connectionId}/${snapshot.retrievalJobId}/manifest.json`,
    manifestSha256: HASH, rawFileCount: 2, reviewDecisionCount: 0,
  };
}
function createPort(overrides: Partial<HostedRuntimeClinicalRecordsPort> = {}) {
  return {
    fetchPage: vi.fn<HostedRuntimeClinicalRecordsPort["fetchPage"]>(overrides.fetchPage ?? (async () => ({ status: "page", body: bundle([]), nextCursor: null }))),
    fetchDocument: vi.fn<NonNullable<HostedRuntimeClinicalRecordsPort["fetchDocument"]>>(overrides.fetchDocument ?? (async () => ({ status: "unavailable", errorCode: "document_unavailable", retryable: false }))),
    readRun: vi.fn<HostedRuntimeClinicalRecordsPort["readRun"]>(overrides.readRun ?? (async () => ({ run: RUN, status: "ready" }))),
    recordOutcome: vi.fn<HostedRuntimeClinicalRecordsPort["recordOutcome"]>(overrides.recordOutcome ?? (async () => undefined)),
  };
}
function createQueryRun(queryScopeIds: string[]): HostedClinicalRecordsRunDescriptor {
  return { ...RUN, retrievalSlices: queryScopeIds.map((queryScopeId) => ({ coverage: "whole-family", queryFingerprint: hash(queryScopeId), queryScopeId, resourceType: "Observation", sliceId: "whole" })) };
}
function bundle(resources: unknown[], nextUrl?: string) {
  return JSON.stringify({ resourceType: "Bundle", type: "searchset", entry: resources.map((resource) => ({ resource })), ...(nextUrl ? { link: [{ relation: "next", url: nextUrl }] } : {}) });
}
function hash(content: string) { return createHash("sha256").update(content).digest("hex"); }
function lab(id: string) {
  return { resourceType: "Observation", id, status: "final", meta: { lastUpdated: RUN.fetchedAt }, subject: { reference: "Patient/patient-1" }, effectiveDateTime: RUN.fetchedAt,
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
    code: { coding: [{ system: "http://loinc.org", code: "4548-4", display: "Hemoglobin A1c" }] }, valueQuantity: { value: 5.4, unit: "%", code: "%", system: "http://unitsofmeasure.org" },
  };
}
function pageSequence(bodies: string[]) {
  let index = 0;
  return vi.fn<HostedRuntimeClinicalRecordsPort["fetchPage"]>(async () => {
    const body = bodies[index++];
    if (body === undefined) throw new Error("Unexpected additional page request");
    return { status: "page", body, nextCursor: index < bodies.length ? `opaque-${index + 1}` : null };
  });
}
function documentRun(): HostedClinicalRecordsRunDescriptor {
  return { ...RUN, requestedScopes: ["patient/DocumentReference.read"], grantedScopes: ["patient/DocumentReference.read"], retrievalSlices: [{ ...RUN.retrievalSlices[0]!, queryScopeId: "documents", resourceType: "DocumentReference" }] };
}
function documentPage() {
  const body = bundle([{ resourceType: "DocumentReference", id: "document-1", status: "current", meta: { lastUpdated: RUN.fetchedAt }, subject: { reference: "Patient/patient-1" }, date: RUN.fetchedAt,
    content: [
      { attachment: { contentType: "text/plain", data: Buffer.from("inline clinical document").toString("base64") } },
      { attachment: { contentType: "text/plain", url: "Binary/document-1" } },
    ],
  }]);
  return { page: { status: "page" as const, body, nextCursor: null, documents: [{ parentPageSha256: hash(body), resourceType: "DocumentReference" as const, resourceId: "document-1", attachmentIndex: 1, ticket: "opaque-document-ticket" }] } };
}
function documentResponse(text: string) {
  return { status: "document" as const, contentBase64: Buffer.from(text).toString("base64"), mediaType: "text/plain", sha256: hash(text), byteLength: Buffer.byteLength(text) };
}
