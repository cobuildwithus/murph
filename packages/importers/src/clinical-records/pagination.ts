import { createHash } from "node:crypto";
import {
  CLINICAL_RAW_MANIFEST_MAX_BYTES,
  CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES,
  clinicalFhirManifestPathSchema,
  clinicalRawManifestSchema,
  clinicalRawManifestResourceFileRetrievalKey,
  type ClinicalRawManifest,
  type ClinicalRawManifestResourceFile,
} from "@murphai/clinical-records";

export interface ClinicalPreviousImportBatch {
  manifestPath: string;
  manifestContent: string;
  page: { relativePath: string; content: string };
}

type FhirResourcePage = {
  isBundle: boolean;
  nextPageUrlHash?: string;
  rawRef: string;
  resourceFile: ClinicalRawManifestResourceFile;
};
type ClinicalBatchManifest = Extract<ClinicalRawManifest, { schemaVersion: "murph.clinical-raw-manifest.v3" }>;
type ClinicalBatchManifestWithBatch = ClinicalBatchManifest & { batch: NonNullable<ClinicalBatchManifest["batch"]> };

type ParsePage = (input: {
  manifest: ClinicalRawManifest;
  manifestPath: string;
  pageText: string;
  resourceFile: ClinicalRawManifestResourceFile;
}) => FhirResourcePage;

export function assertResolvedFhirPagination(input: {
  manifest: ClinicalRawManifest;
  resourcePages: readonly FhirResourcePage[];
  previousBatch?: ClinicalPreviousImportBatch;
  parsePage: ParsePage;
}): void {
  if (isClinicalBatchManifest(input.manifest) && input.manifest.batch) {
    assertClinicalBatchPagination(input);
    return;
  }
  if (input.previousBatch) throw new Error("Unexpected prior clinical retrieval batch evidence.");
  assertLegacyClinicalPagination(input);
}

function assertLegacyClinicalPagination(input: {
  manifest: ClinicalRawManifest;
  resourcePages: readonly FhirResourcePage[];
  parsePage: ParsePage;
}): void {
  const maps = buildLegacyClinicalPageMaps(input.resourcePages);
  for (const [retrievalKey, pages] of maps.pagesByRetrieval) validateLegacyClinicalGraph({ input, retrievalKey, pages, nextPageByRawRef: maps.nextPageByRawRef });
}

function buildLegacyClinicalPageMaps(resourcePages: readonly FhirResourcePage[]): { pagesByRetrieval: Map<string, FhirResourcePage[]>; nextPageByRawRef: Map<string, FhirResourcePage> } {
  const pagesByRetrieval = new Map<string, FhirResourcePage[]>();
  const pagesByRetrievalAndUrl = new Map<string, Map<string, FhirResourcePage>>();
  for (const page of resourcePages) {
    const retrievalKey = clinicalRawManifestResourceFileRetrievalKey(page.resourceFile);
    const pages = pagesByRetrieval.get(retrievalKey) ?? [];
    pages.push(page); pagesByRetrieval.set(retrievalKey, pages);
    if (!page.resourceFile.pageUrlHash) continue;
    const pagesByUrl = pagesByRetrievalAndUrl.get(retrievalKey) ?? new Map();
    if (pagesByUrl.has(page.resourceFile.pageUrlHash)) throw new Error(`Clinical FHIR raw manifest has duplicate page URL hashes for ${page.resourceFile.resourceType}.`);
    pagesByUrl.set(page.resourceFile.pageUrlHash, page); pagesByRetrievalAndUrl.set(retrievalKey, pagesByUrl);
  }
  const nextPageByRawRef = new Map<string, FhirResourcePage>();
  for (const page of resourcePages) {
    if (!page.nextPageUrlHash) continue;
    const nextPage = pagesByRetrievalAndUrl.get(clinicalRawManifestResourceFileRetrievalKey(page.resourceFile))?.get(page.nextPageUrlHash);
    if (!nextPage) throw new Error(`Clinical FHIR raw manifest has unresolved pagination for ${page.rawRef}.`);
    nextPageByRawRef.set(page.rawRef, nextPage);
  }
  return { pagesByRetrieval, nextPageByRawRef };
}

function validateLegacyClinicalGraph(input: { input: { manifest: ClinicalRawManifest }; retrievalKey: string; pages: FhirResourcePage[]; nextPageByRawRef: Map<string, FhirResourcePage> }): void {
  const resourceType = input.pages[0]?.resourceFile.resourceType ?? input.retrievalKey;
  const hasMetadata = input.pages.some((page) => page.resourceFile.pageUrlHash !== undefined || page.nextPageUrlHash !== undefined);
  const graphPages = hasMetadata ? input.pages : isWholeFamilyRetrieval(input.input.manifest, input.pages[0]?.resourceFile) ? input.pages.filter((page) => page.isBundle) : [];
  if (graphPages.length === 0) return;
  const roots = graphPages.filter((page) => !page.resourceFile.pageUrlHash);
  if (roots.length !== 1) throw new Error(`Clinical FHIR raw manifest must have exactly one pagination root for ${resourceType}.`);
  const seen = new Set<string>();
  let current: FhirResourcePage | undefined = roots[0];
  while (current) {
    if (seen.has(current.rawRef)) throw new Error(`Clinical FHIR raw manifest has cyclic pagination for ${current.rawRef}.`);
    seen.add(current.rawRef); current = input.nextPageByRawRef.get(current.rawRef);
  }
  if (seen.size !== graphPages.length) {
    const unreachable = graphPages.find((page) => !seen.has(page.rawRef));
    throw new Error(`Clinical FHIR raw manifest has unreachable pagination for ${unreachable?.rawRef ?? resourceType}.`);
  }
}

function isWholeFamilyRetrieval(
  manifest: ClinicalRawManifest,
  resourceFile: ClinicalRawManifestResourceFile | undefined,
): boolean {
  if (!resourceFile) return false;
  if (manifest.schemaVersion === "murph.clinical-raw-manifest.v2") {
    return manifest.retrievalScopes.some((scope) =>
      scope.resourceType === resourceFile.resourceType
      && scope.coverage === "whole-family"
    );
  }
  if (!("queryScopeId" in resourceFile)) return false;
  return manifest.retrievalSlices.some((slice) =>
    slice.queryScopeId === resourceFile.queryScopeId
    && slice.sliceId === resourceFile.sliceId
    && slice.coverage === "whole-family"
  );
}


function assertClinicalBatchPagination(input: {
  manifest: ClinicalRawManifest;
  resourcePages: readonly FhirResourcePage[];
  previousBatch?: ClinicalPreviousImportBatch;
  parsePage: ParsePage;
}): void {
  const manifest = input.manifest;
  if (!isClinicalBatchManifest(manifest)) {
    throw new Error("Expected a clinical retrieval batch.");
  }
  const batch = manifest.batch;
  if (!batch) throw new Error("Expected a clinical retrieval batch.");
  const page = input.resourcePages[0];
  assertBatchShape(input.resourcePages.length, page, batch.continuesWith?.pageUrlHash);
  if (batch.index === 0) {
    assertFirstClinicalBatch(input, page);
    return;
  }

  const prior = input.previousBatch;
  const previousRef = batch.previous;
  if (!prior || !previousRef || prior.manifestPath !== previousRef.manifestPath) {
    throw new Error("Clinical retrieval batch is missing its canonical predecessor evidence.");
  }
  assertPreviousClinicalBatchEvidence(prior, previousRef.sha256);
  const previous = clinicalRawManifestSchema.parse(JSON.parse(prior.manifestContent));
  const priorPath = clinicalFhirManifestPathSchema.parse(prior.manifestPath).split("/");
  if (!isClinicalBatchManifest(previous)) throw new Error("Clinical retrieval predecessor does not match its batch identity.");
  if (!previous.batch) throw new Error("Clinical retrieval predecessor does not match its batch identity.");
  assertPreviousClinicalBatchIdentity({ manifest, previous, batch, priorPath });
  const previousFile = previous.resourceFiles[0];
  if (!previousFile || previousFile.relativePath !== prior.page.relativePath) {
    throw new Error("Clinical retrieval predecessor is missing its declared raw page.");
  }
  // The vault owner loads this already-admitted predecessor from canonical raw
  // storage. Revalidate its exact bytes and outgoing edge without rereading an
  // unbounded chart history or accepting a caller-supplied middle-page hash.
  const previousPage = input.parsePage({
    manifest: previous,
    manifestPath: prior.manifestPath,
    pageText: prior.page.content,
    resourceFile: previousFile,
  });
  if (previousPage.nextPageUrlHash !== previous.batch.continuesWith?.pageUrlHash) {
    throw new Error("Clinical retrieval predecessor continuation does not match its raw next link.");
  }
  const continuation = previous.batch.continuesWith;
  if (!continuation) return assertNewSliceRoot(page);
  const currentSlice = manifest.retrievalSlices[0];
  const previousSlice = previous.retrievalSlices[0];
  // A denied continuation can leave one slice unfinished while the frozen run
  // proceeds to another slice. A new root claims no completion for the old one.
  if (!page.resourceFile.pageUrlHash && currentSlice && previousSlice && (
    currentSlice.queryScopeId !== previousSlice.queryScopeId
    || currentSlice.sliceId !== previousSlice.sliceId
  )) return;
  assertBatchContinuation({ continuation, page, currentSlice, previousSlice });
}

function assertBatchShape(pageCount: number, page: FhirResourcePage | undefined, expectedNextHash: string | undefined): asserts page is FhirResourcePage {
  if (pageCount !== 1 || !page) throw new Error("Clinical retrieval batches require exactly one raw page.");
  if (page.nextPageUrlHash !== expectedNextHash) throw new Error("Clinical retrieval batch continuation does not match its raw next link.");
}

function assertFirstClinicalBatch(input: { previousBatch?: ClinicalPreviousImportBatch }, page: FhirResourcePage): void {
  if (input.previousBatch || page.resourceFile.pageUrlHash) throw new Error("The first clinical retrieval batch must begin at a pagination root.");
}

function assertNewSliceRoot(page: FhirResourcePage): void {
  if (page.resourceFile.pageUrlHash) throw new Error("A new clinical retrieval slice must begin at a pagination root.");
}

function assertPreviousClinicalBatchEvidence(prior: ClinicalPreviousImportBatch, expectedHash: string): void {
  if (Buffer.byteLength(prior.manifestContent, "utf8") > CLINICAL_RAW_MANIFEST_MAX_BYTES
    || Buffer.byteLength(prior.page.content, "utf8") > CLINICAL_RAW_RESOURCE_FILE_MAX_BYTES
    || createHash("sha256").update(prior.manifestContent, "utf8").digest("hex") !== expectedHash) {
    throw new Error("Clinical retrieval predecessor evidence has invalid size or manifest hash.");
  }
}

function assertPreviousClinicalBatchIdentity(input: { manifest: ClinicalBatchManifestWithBatch; previous: ClinicalBatchManifestWithBatch; batch: NonNullable<ClinicalBatchManifest["batch"]>; priorPath: string[] }): void {
  const { manifest, previous, batch, priorPath } = input;
  if (previous.schemaVersion !== "murph.clinical-raw-manifest.v3" || !previous.batch || previous.batch.runId !== batch.runId
    || previous.batch.index !== batch.index - 1 || previous.connectionId !== manifest.connectionId
    || previous.sourceSystem !== manifest.sourceSystem || previous.fhirBaseUrlHash !== manifest.fhirBaseUrlHash
    || previous.patientIdHash !== manifest.patientIdHash || previous.providerDirectoryEntryId !== manifest.providerDirectoryEntryId
    || previous.fetchedAt !== manifest.fetchedAt || priorPath[3] !== previous.connectionId || priorPath[4] !== previous.retrievalJobId) {
    throw new Error("Clinical retrieval predecessor does not match its batch identity.");
  }
}

function assertBatchContinuation(input: { continuation: NonNullable<NonNullable<ClinicalBatchManifest["batch"]>["continuesWith"]>; page: FhirResourcePage; currentSlice: ClinicalBatchManifest["retrievalSlices"][number] | undefined; previousSlice: ClinicalBatchManifest["retrievalSlices"][number] | undefined }): void {
  const { continuation, page, currentSlice, previousSlice } = input;
  const windowsMatch = currentSlice?.coverage !== "bounded-window" || (previousSlice?.coverage === "bounded-window"
    && currentSlice.from === previousSlice.from && currentSlice.to === previousSlice.to);
  if (continuation.pageUrlHash !== page.resourceFile.pageUrlHash || currentSlice?.queryScopeId !== continuation.queryScopeId
    || currentSlice?.sliceId !== continuation.sliceId || !currentSlice || !previousSlice
    || currentSlice.queryFingerprint !== previousSlice.queryFingerprint || currentSlice.resourceType !== previousSlice.resourceType
    || currentSlice.coverage !== previousSlice.coverage || !windowsMatch || page.resourceFile.pageUrlHash === page.nextPageUrlHash) {
    throw new Error("Clinical retrieval batch does not follow its predecessor pagination link.");
  }
}

function isClinicalBatchManifest(manifest: ClinicalRawManifest): manifest is ClinicalBatchManifestWithBatch {
  return manifest.schemaVersion === "murph.clinical-raw-manifest.v3" && "batch" in manifest && manifest.batch !== undefined;
}
