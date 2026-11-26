import { CLINICAL_RECEIPT_PROTOCOL } from "@murphai/clinical-records/retrieval-limits";
import { createHash } from "node:crypto";
import { mkdir, opendir, readFile, rm, rmdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  clinicalDocumentAttachmentKey,
  clinicalExtractionDateIsSupported,
  clinicalDocumentExtractionOutputSchemaForFamily,
  clinicalDocumentExtractionOutputSchema,
  CLINICAL_DOCUMENT_EXTRACTION_MAX_RECORDS,
  clinicalRawManifestSchema,
  clinicalRawPathSchema,
  type ClinicalDocumentAttachment,
  type ClinicalDocumentExtractionOutput,
  type ClinicalDocumentExtractionPayload,
} from "@murphai/clinical-records";
import { eventImportDecisionSchema, toLocalDayKey, vaultMetadataSchema, type ExternalRef } from "@murphai/contracts";
import * as z from "@murphai/contracts/zod-runtime";
import { type ClinicalChangeReceipt, type ClinicalChangeReceiptIdentity, readClinicalChangeReceipt, importEventBatch, isVaultError, resolveVaultPathOnDisk, runCanonicalWrite, withCanonicalResourceLocks, withCanonicalWriteLock } from "@murphai/core";
import { normalizeMetricValue, unitsEquivalent } from "@murphai/health-metrics";
import { listCanonicalEntities, readVaultMetadataSource, type CanonicalEntity } from "@murphai/query";
import { resolveRuntimePaths, writeJsonFileAtomic } from "@murphai/runtime-state/node";

import { readClinicalStoredDocument } from "./clinical-document-storage.ts";
import { clinicalEnrichmentLabHoldReason } from "./clinical-enrichment-labs.ts";
import { attestClinicalStructuredSource, clinicalStructuredSourceSchema, type ClinicalStructuredSource } from "./clinical-structured-enrichment.ts";
import { readClinicalEnrichmentParentEligibility } from "./clinical-enrichment-parent.ts";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const manifestRefSchema = z.object({ manifestPath: clinicalRawPathSchema, sha256: digestSchema }).strict();
const sourceSchema = z.object({ rawRef: clinicalRawPathSchema, sha256: digestSchema, mediaType: z.string().min(1).max(255), byteLength: z.number().int().positive().max(20 * 1024 * 1024), resource: clinicalStructuredSourceSchema.optional() }).strict();
const outputsSchema = z.object({ labs: clinicalDocumentExtractionOutputSchema, measurements: clinicalDocumentExtractionOutputSchema, history: clinicalDocumentExtractionOutputSchema }).strict();
const countsSchema = z.object({ created: z.number().int().nonnegative(), existing: z.number().int().nonnegative(), held: z.number().int().nonnegative(), pages: z.number().int().nonnegative(), documents: z.number().int().nonnegative() }).strict();
const jobSchema = z.object({
  retrievalProtocol: z.literal(CLINICAL_RECEIPT_PROTOCOL).optional(),
  schema: z.enum(["murph.clinical-enrichment.v1", "murph.clinical-enrichment.v2", "murph.clinical-enrichment.v3"]),
  jobId: digestSchema,
  root: manifestRefSchema,
  attachmentIndex: z.number().int().nonnegative(),
  structuredSources: z.array(clinicalStructuredSourceSchema).max(1_000).optional(),
  resourceIndex: z.number().int().nonnegative().optional(),
  page: z.number().int().positive().max(100_000),
  totalPages: z.number().int().positive().max(100_000).optional(),
  nextAttemptAt: z.isoDateTime().optional(),
  failures: z.number().int().nonnegative().max(3).default(0),
  status: z.enum(["pending", "prepared", "complete", "blocked"]),
  source: sourceSchema.optional(),
  prepared: z.object({ page: z.number().int().positive(), totalPages: z.number().int().positive().max(100_000), outputs: outputsSchema }).strict().optional(),
  counts: countsSchema,
  lastReadback: z.object({ eventIds: z.array(z.string()).max(300), verifiedCount: z.number().int().nonnegative() }).strict().optional(),
  reason: z.string().min(1).max(500).optional(),
  holdReasons: z.array(z.string().min(1).max(500)).max(20).default([]),
}).strict();
type Job = z.infer<typeof jobSchema>;
export type ClinicalEnrichmentSource = Pick<z.infer<typeof sourceSchema>, "rawRef" | "sha256" | "mediaType" | "resource"> & { clinicalOccurredAt?: string; recordedAt?: string };
export type ClinicalEnrichmentWork =
  | { status: "extract"; jobId: string; source: ClinicalEnrichmentSource; documentPath: string; page: number; timeZone: string; extractedText?: string; failures: number }
  | { status: "deferred"; jobId: string; nextAttemptAt: string }
  | { status: "apply" | "advance"; jobId: string };
const indexSchema = z.object({ schema: z.literal("murph.clinical-enrichment-index.v1"), pending: z.array(digestSchema).max(128) }).strict();
const currentExtractionCacheDirectory = "extraction-v4";
const families = ["labs", "measurements", "history"] as const;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const rootPath = (vaultRoot: string) => path.join(resolveRuntimePaths(vaultRoot).clinicalRecordsRuntimeRoot, "enrichment");
const jobPath = (vaultRoot: string, jobId: string) => path.join(rootPath(vaultRoot), `${digestSchema.parse(jobId)}.json`);

async function readOptional(file: string): Promise<unknown | null> {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return null; throw error; }
}
async function readIndex(vaultRoot: string) {
  return indexSchema.parse(await readOptional(path.join(rootPath(vaultRoot), "pending.json")) ?? { schema: "murph.clinical-enrichment-index.v1", pending: [] });
}
async function saveJob(vaultRoot: string, job: Job) {
  await mkdir(rootPath(vaultRoot), { recursive: true, mode: 0o700 });
  await writeJsonFileAtomic(jobPath(vaultRoot, job.jobId), jobSchema.parse(job), { mode: 0o600 });
}
/**
 * The page's receipt digest binds `job.prepared`, so the accepted job joins the
 * canonical write log before that receipt. Restore then replays both, and a
 * lost snapshot can never re-sample a page whose receipt already exists.
 */
async function commitAcceptedJob(vaultRoot: string, jobId: string) {
  const absolutePath = jobPath(vaultRoot, jobId);
  const relativePath = path.relative(resolveRuntimePaths(vaultRoot).absoluteVaultRoot, absolutePath).split(path.sep).join("/");
  const content = await readFile(absolutePath, "utf8");
  await runCanonicalWrite({
    vaultRoot, operationType: "clinical_enrichment_accept", summary: "Commit accepted clinical enrichment proposals.",
    // The file already holds these bytes; reuse records them in the log without replacing it.
    mutate: async ({ batch }) => { await batch.stageTextWrite(relativePath, content, { overwrite: false, allowExistingMatch: true }); },
  });
}
async function readJob(vaultRoot: string, jobId: string) {
  const job = jobSchema.parse(await readOptional(jobPath(vaultRoot, jobId)));
  if (job.jobId !== jobId || job.root.sha256 !== jobId) throw new Error("Clinical enrichment job identity changed.");
  return job;
}
function locked<T>(vaultRoot: string, run: () => Promise<T>): Promise<T> {
  return withCanonicalResourceLocks({ vaultRoot, resources: [{ key: "clinical-enrichment", label: "Clinical document enrichment" }], run });
}
async function readManifest(vaultRoot: string, ref: z.infer<typeof manifestRefSchema>) {
  const resolved = await resolveVaultPathOnDisk(vaultRoot, clinicalRawPathSchema.parse(ref.manifestPath));
  if ((await stat(resolved.absolutePath)).size > 4 * 1024 * 1024) throw new Error("Clinical enrichment manifest exceeds the byte limit.");
  const bytes = await readFile(resolved.absolutePath);
  if (hash(bytes) !== ref.sha256) throw new Error("Clinical enrichment manifest digest mismatch.");
  return clinicalRawManifestSchema.parse(JSON.parse(bytes.toString("utf8")));
}
async function readJobManifest(vaultRoot: string, job: Job) {
  const manifest = await readManifest(vaultRoot, job.root);
  if (job.retrievalProtocol !== ("retrievalProtocol" in manifest ? manifest.retrievalProtocol : undefined)) {
    throw new Error("Clinical enrichment protocol mismatch.");
  }
  return manifest;
}
async function attestSource(vaultRoot: string, job: Job) {
  const manifest = await readJobManifest(vaultRoot, job);
  if (job.source?.resource) {
    const current = job.structuredSources?.[job.resourceIndex ?? 0];
    if (!current || stable(current) !== stable(job.source.resource)) throw new Error("Clinical resource cursor is stale.");
    const attested = await attestClinicalStructuredSource({ vaultRoot, manifestPath: job.root.manifestPath, manifest, source: current });
    if (stable(attested.source) !== stable(job.source)) throw new Error("Clinical resource source binding changed.");
    return { ...attested, manifest, sourceId: hash(stable(["resource", current])), storedSha256: attested.source.sha256 };
  }
  const attachment = "documentAttachments" in manifest ? manifest.documentAttachments?.[job.attachmentIndex] : undefined;
  if (!job.source || attachment?.status !== "downloaded" || attachment.sha256 !== job.source.sha256 || attachment.byteLength !== job.source.byteLength || attachment.mediaType !== job.source.mediaType || path.posix.join(path.posix.dirname(job.root.manifestPath), attachment.relativePath) !== job.source.rawRef) throw new Error("Clinical enrichment source is no longer attested by its manifest.");
  const parent = await readClinicalEnrichmentParentEligibility({ vaultRoot, manifestPath: job.root.manifestPath, manifest, attachment });
  const stored = await readClinicalStoredDocument({ vaultRoot, source: job.source });
  const { readClinicalAttachmentText } = await import("@murphai/importers/clinical-records");
  const extractedText = readClinicalAttachmentText(await readFile(stored.absolutePath), job.source.mediaType);
  return { manifest, sourceId: hash(stable(["attachment", clinicalDocumentAttachmentKey(attachment)])), documentPath: stored.absolutePath, storedSha256: stored.sha256, parent, extractedText };
}

/** Portable clinical operations only; raw evidence and canonical records keep their existing owners. */
export async function enqueueClinicalEnrichment(input: { vaultRoot: string; manifestPath: string; manifestSha256: string; structuredSources?: ClinicalStructuredSource[] }): Promise<{ jobId: string }> {
  return locked(input.vaultRoot, async () => {
    const root = manifestRefSchema.parse({ manifestPath: input.manifestPath, sha256: input.manifestSha256 });
    const manifest = await readManifest(input.vaultRoot, root);
    const retrievalProtocol = "retrievalProtocol" in manifest ? manifest.retrievalProtocol : undefined;
    const jobId = root.sha256;
    const existing = await readOptional(jobPath(input.vaultRoot, jobId));
    const job = existing ? jobSchema.parse(existing) : jobSchema.parse({ schema: "murph.clinical-enrichment.v3", jobId, root, retrievalProtocol, attachmentIndex: 0, ...(input.structuredSources?.length ? { structuredSources: input.structuredSources, resourceIndex: 0 } : {}), page: 1, status: "pending", counts: { created: 0, existing: 0, held: 0, pages: 0, documents: 0 } });
    if (job.retrievalProtocol !== retrievalProtocol) throw new Error("Clinical enrichment protocol mismatch.");
    if (job.status === "complete" || job.status === "blocked") return { jobId };
    const index = await readIndex(input.vaultRoot);
    if (!index.pending.includes(jobId)) index.pending.push(jobId);
    indexSchema.parse(index);
    // Retrieval retains its checkpoint until enqueue returns. A crash between
    // these writes replays enqueue and repairs this job's pending index entry.
    await mkdir(rootPath(input.vaultRoot), { recursive: true, mode: 0o700 });
    if (!existing) await saveJob(input.vaultRoot, job);
    await writeJsonFileAtomic(path.join(rootPath(input.vaultRoot), "pending.json"), index, { mode: 0o600 });
    return { jobId };
  });
}

export async function readNextClinicalEnrichment(input: { vaultRoot: string; now?: Date; jobId?: string }): Promise<ClinicalEnrichmentWork | null> {
  return locked(input.vaultRoot, async () => {
    const index = await readIndex(input.vaultRoot);
    let deferred: Extract<ClinicalEnrichmentWork, { status: "deferred" }> | null = null;
    let indexPosition = 0;
    while (indexPosition < index.pending.length) {
      const jobId = index.pending[indexPosition]!;
      if (input.jobId !== undefined && jobId !== input.jobId) { indexPosition++; continue; }
      const job = await readJob(input.vaultRoot, jobId);
      if (job.status === "complete" || job.status === "blocked") {
        index.pending.splice(indexPosition, 1);
        await writeJsonFileAtomic(path.join(rootPath(input.vaultRoot), "pending.json"), index, { mode: 0o600 });
        continue;
      }
      if (job.nextAttemptAt && Date.parse(job.nextAttemptAt) > (input.now ?? new Date()).getTime()) {
        if (!deferred || job.nextAttemptAt < deferred.nextAttemptAt) deferred = { status: "deferred", jobId, nextAttemptAt: job.nextAttemptAt };
        indexPosition++;
        continue;
      }
      if (job.status === "prepared") return { status: "apply", jobId };
      let manifest;
      try { manifest = await readJobManifest(input.vaultRoot, job); }
      catch {
        job.status = "blocked";
        job.reason = "Clinical source manifest failed integrity validation.";
        await saveJob(input.vaultRoot, job);
        return { status: "advance", jobId };
      }
      const attachments = "documentAttachments" in manifest ? manifest.documentAttachments ?? [] : [];
      while (job.attachmentIndex < attachments.length) {
        const attachment = attachments[job.attachmentIndex]!;
        if (attachment.status !== "downloaded") { job.counts.held++; job.attachmentIndex++; continue; }
        const work = await prepareCurrentClinicalDocument(input.vaultRoot, job, attachment);
        if (work) return work;
      }
      return prepareClinicalResourceOrFinish(input.vaultRoot, job, manifest);
    }
    return deferred;
  });
}

async function prepareClinicalResourceOrFinish(vaultRoot: string, job: Job, manifest: z.infer<typeof clinicalRawManifestSchema>): Promise<ClinicalEnrichmentWork> {
  const resource = job.structuredSources?.[job.resourceIndex ?? 0];
  if (resource) {
    const work = await prepareCurrentClinicalResource(vaultRoot, job, manifest, resource);
    return work ?? { status: "advance", jobId: job.jobId };
  }
  job.status = job.counts.held > 0 ? "blocked" : "complete";
  if (job.status === "blocked") job.reason = "Some clinical document records require review.";
  await saveJob(vaultRoot, job);
  // The next pass compacts the index after this terminal receipt commits.
  return { status: "advance", jobId: job.jobId };
}

async function prepareCurrentClinicalDocument(
  vaultRoot: string,
  job: Job,
  attachment: Extract<ClinicalDocumentAttachment, { status: "downloaded" }>,
): Promise<ClinicalEnrichmentWork | null> {
  job.source = sourceSchema.parse({ rawRef: path.posix.join(path.posix.dirname(job.root.manifestPath), attachment.relativePath), sha256: attachment.sha256, mediaType: attachment.mediaType, byteLength: attachment.byteLength });
  let attested;
  try { attested = await attestSource(vaultRoot, job); }
  catch {
    holdCurrentSource(job, "Clinical document or parent evidence failed integrity validation.");
    await saveJob(vaultRoot, job);
    return null;
  }
  if (!attested.parent.eligible) {
    holdCurrentSource(job, attested.parent.reason ?? "Clinical document parent is not eligible.");
    await saveJob(vaultRoot, job);
    return null;
  }
  const cached = await readOptional(extractionCachePath(vaultRoot, job.source.sha256, job.source.mediaType, job.page, attested.parent.clinicalOccurredAt));
  const proposal = jobSchema.shape.prepared.safeParse(cached);
  if (proposal.success && proposal.data && proposal.data.page === job.page) {
    acceptClinicalProposal(job, proposal.data);
    await saveJob(vaultRoot, job);
    return { status: "apply", jobId: job.jobId };
  }
  await saveJob(vaultRoot, job);
  const metadata = vaultMetadataSchema.parse(await readVaultMetadataSource(vaultRoot));
  return { status: "extract", jobId: job.jobId, source: { rawRef: job.source.rawRef, sha256: attested.storedSha256, mediaType: job.source.mediaType, clinicalOccurredAt: attested.parent.clinicalOccurredAt, recordedAt: attested.parent.retrievedAt }, documentPath: attested.documentPath, page: job.page, timeZone: metadata.timezone, failures: job.failures };
}

async function prepareCurrentClinicalResource(vaultRoot: string, job: Job, manifest: z.infer<typeof clinicalRawManifestSchema>, resource: ClinicalStructuredSource): Promise<ClinicalEnrichmentWork | null> {
  let attested;
  try { attested = await attestClinicalStructuredSource({ vaultRoot, manifestPath: job.root.manifestPath, manifest, source: resource }); }
  catch {
    holdCurrentSource(job, "Clinical structured source could not be attested.", true);
    await saveJob(vaultRoot, job);
    return null;
  }
  job.source = attested.source;
  if (!attested.parent.eligible) {
    holdCurrentSource(job, attested.parent.reason ?? "Clinical source is not eligible.");
    await saveJob(vaultRoot, job);
    return null;
  }
  const cache = await readOptional(extractionCachePath(vaultRoot, resource.sha256, job.source.mediaType, 1, attested.parent.clinicalOccurredAt));
  const proposal = jobSchema.shape.prepared.safeParse(cache);
  if (proposal.success && proposal.data?.page === 1 && proposal.data.totalPages === 1) {
    acceptClinicalProposal(job, proposal.data);
    await saveJob(vaultRoot, job);
    return { status: "apply", jobId: job.jobId };
  }
  await saveJob(vaultRoot, job);
  const metadata = vaultMetadataSchema.parse(await readVaultMetadataSource(vaultRoot));
  return { status: "extract", jobId: job.jobId, source: { ...job.source, clinicalOccurredAt: attested.parent.clinicalOccurredAt, recordedAt: attested.parent.retrievedAt },
    documentPath: attested.documentPath, extractedText: attested.extractedText, page: 1, timeZone: metadata.timezone, failures: job.failures };
}

export async function persistClinicalEnrichmentProposals(input: { vaultRoot: string; jobId: string; sourceSha256: string; page: number; totalPages: number; outputs: Record<(typeof families)[number], ClinicalDocumentExtractionOutput> }): Promise<void> {
  await locked(input.vaultRoot, async () => {
    const job = await readJob(input.vaultRoot, input.jobId);
    if (!job.source || job.page !== input.page) throw new Error("Clinical enrichment proposal cursor is stale.");
    if (job.status === "prepared") return; // First durable proposal wins; never resample accepted content.
    if (job.status !== "pending") throw new Error("Clinical enrichment job is terminal.");
    const attested = await attestSource(input.vaultRoot, job);
    if (!attested.parent.eligible) throw new Error("Clinical document parent is not eligible for proposals.");
    if (input.sourceSha256 !== attested.storedSha256) throw new Error("Clinical enrichment proposal source changed.");
    if (job.totalPages !== undefined && job.totalPages !== input.totalPages) throw new Error("Clinical enrichment document page count changed.");
    const prepared = validateClinicalProposal({ resource: Boolean(job.source.resource), page: input.page, totalPages: input.totalPages, outputs: input.outputs });
    acceptClinicalProposal(job, prepared);
    await saveJob(input.vaultRoot, job);
    const cachePath = extractionCachePath(input.vaultRoot, job.source.resource?.sha256 ?? job.source.sha256, job.source.mediaType, input.page, attested.parent.clinicalOccurredAt);
    await mkdir(path.dirname(cachePath), { recursive: true, mode: 0o700 });
    await writeJsonFileAtomic(cachePath, job.prepared, { mode: 0o600 });
  });
}

type ClinicalPreparedProposal = NonNullable<Job["prepared"]>;

/** One acceptance for fresh and cached proposals: it also clears the retry state. */
function acceptClinicalProposal(job: Job, prepared: ClinicalPreparedProposal) {
  // Older strict readers cannot apply typed clinical notes. Preserve legacy
  // frozen proposals, but mark newly produced checkpoints with their reader floor.
  job.schema = "murph.clinical-enrichment.v3";
  job.totalPages = prepared.totalPages;
  job.failures = 0;
  delete job.nextAttemptAt;
  job.prepared = prepared;
  job.status = "prepared";
}

function validateClinicalProposal(input: { resource: boolean; page: number; totalPages: number; outputs: Record<(typeof families)[number], ClinicalDocumentExtractionOutput> }): ClinicalPreparedProposal {
  const outputs = outputsSchema.parse(Object.fromEntries(families.map((family) => [family, clinicalDocumentExtractionOutputSchemaForFamily(family).parse(input.outputs[family])])));
  for (const output of Object.values(outputs)) {
    if (output.records.length === CLINICAL_DOCUMENT_EXTRACTION_MAX_RECORDS) {
      output.status = "blocked";
      output.reason = "Extraction reached its record limit; additional source facts may remain.";
    }
  }
  if (input.resource && (input.page !== 1 || input.totalPages !== 1)) throw new Error("Clinical resource must be a single extraction unit.");
  if (input.page > input.totalPages || families.some((family) => outputs[family].records.some((record) => record.page !== undefined && record.page !== input.page))) throw new Error("Clinical enrichment proposals reference an unprocessed page.");
  if (Buffer.byteLength(JSON.stringify(outputs), "utf8") > 4 * 1024 * 1024) throw new Error("Clinical enrichment proposals exceed the byte limit.");
  return { page: input.page, totalPages: input.totalPages, outputs };
}

/** One extraction at or ahead of a job's cursor. `key` is its extraction-cache identity. */
export interface ClinicalExtractionUnit {
  key: string;
  jobId: string;
  /** The job's current page when planned; a scheduling hint, rechecked when a failure settles. */
  cursor: boolean;
  cursorRef: string;
  locator: { attachmentIndex: number } | { resourceIndex: number };
  /** The manifest attachment or resource digest that keys the cache. */
  cacheSha256: string;
  page: number;
  failures: number;
  source: ClinicalEnrichmentSource;
  documentPath: string;
  timeZone: string;
  extractedText?: string;
}

// A cursor names its kind: documents come first, then the job's structured resources.
const documentCursorRef = (attachmentIndex: number, page: number) => `document:${attachmentIndex}:${page}`;
const resourceCursorRef = (resourceIndex: number) => `resource:${resourceIndex}`;
const jobCursorRef = (job: Job, attachmentCount: number) => job.attachmentIndex < attachmentCount
  ? documentCursorRef(job.attachmentIndex, job.page) : resourceCursorRef(job.resourceIndex ?? 0);

/**
 * Lists uncached extraction units in queue order, each job's cursor first.
 * Only job descriptions are read under the enrichment lock; attestation and
 * page counting run outside it, and every save attests its unit again.
 */
export async function planClinicalExtractionUnits(input: {
  vaultRoot: string;
  limit: number;
  now?: Date;
  exclude?(unit: ClinicalExtractionUnit): boolean;
  countPages(document: { documentPath: string; mediaType: string }): Promise<number>;
}): Promise<ClinicalExtractionUnit[]> {
  const now = (input.now ?? new Date()).getTime();
  const jobs = await locked(input.vaultRoot, async () => {
    const index = await readIndex(input.vaultRoot);
    const pending = await Promise.all(index.pending.map((jobId) => readJob(input.vaultRoot, jobId).catch(() => null)));
    return pending.filter((job): job is Job => job !== null && (job.status === "pending" || job.status === "prepared")
      && !(job.nextAttemptAt && Date.parse(job.nextAttemptAt) > now));
  });
  if (jobs.length === 0) return [];
  const { timezone } = vaultMetadataSchema.parse(await readVaultMetadataSource(input.vaultRoot));
  const units: ClinicalExtractionUnit[] = [];
  for (const job of jobs) {
    for await (const unit of planClinicalJobUnits(input, job, timezone)) {
      if (input.exclude?.(unit)) continue;
      units.push(unit);
      if (units.length >= input.limit) return units;
    }
  }
  return units;
}

async function* planClinicalJobUnits(
  input: Parameters<typeof planClinicalExtractionUnits>[0],
  job: Job,
  timeZone: string,
): AsyncGenerator<ClinicalExtractionUnit> {
  const manifest = await readJobManifest(input.vaultRoot, job).catch(() => null);
  if (!manifest) return;
  const attachmentCount = "documentAttachments" in manifest ? manifest.documentAttachments?.length ?? 0 : 0;
  for (let attachmentIndex = job.attachmentIndex; attachmentIndex < attachmentCount; attachmentIndex++) {
    yield* planClinicalDocumentUnits(input, job, manifest, attachmentIndex, timeZone);
  }
  for (let resourceIndex = job.resourceIndex ?? 0; resourceIndex < (job.structuredSources?.length ?? 0); resourceIndex++) {
    const locator = { resourceIndex };
    const attested = await attestClinicalUnitSource(input.vaultRoot, job, manifest, locator).catch(() => null);
    if (!attested?.parent.eligible) continue;
    const cursor = job.attachmentIndex >= attachmentCount && resourceIndex === (job.resourceIndex ?? 0);
    if (cursor && job.status === "prepared") continue;
    const unit = await unplannedClinicalUnit(input.vaultRoot, job, attested, { locator, page: 1, timeZone, cursor });
    if (unit) yield unit;
  }
}

async function* planClinicalDocumentUnits(
  input: Parameters<typeof planClinicalExtractionUnits>[0],
  job: Job,
  manifest: z.infer<typeof clinicalRawManifestSchema>,
  attachmentIndex: number,
  timeZone: string,
): AsyncGenerator<ClinicalExtractionUnit> {
  const locator = { attachmentIndex };
  const attested = await attestClinicalUnitSource(input.vaultRoot, job, manifest, locator).catch(() => null);
  if (!attested?.parent.eligible) return;
  const current = attachmentIndex === job.attachmentIndex;
  // An uncountable document still offers its current page, whose preparation settles it.
  const totalPages = (current ? job.totalPages : undefined)
    ?? await input.countPages({ documentPath: attested.documentPath, mediaType: attested.source.mediaType }).catch(() => current ? job.page : 0);
  // A prepared cursor page is frozen in the job itself, even when its cache entry was lost.
  const firstPage = current ? job.page + (job.status === "prepared" ? 1 : 0) : 1;
  for (let page = firstPage; page <= totalPages; page++) {
    const unit = await unplannedClinicalUnit(input.vaultRoot, job, attested, { locator, page, timeZone, cursor: current && page === job.page });
    if (unit) yield unit;
  }
}

async function unplannedClinicalUnit(
  vaultRoot: string,
  job: Job,
  attested: Awaited<ReturnType<typeof attestClinicalUnitSource>>,
  unit: { locator: ClinicalExtractionUnit["locator"]; page: number; timeZone: string; cursor: boolean },
): Promise<ClinicalExtractionUnit | null> {
  const cachePath = extractionCachePath(vaultRoot, attested.cacheSha256, attested.source.mediaType, unit.page, attested.parent.clinicalOccurredAt);
  if (await stat(cachePath).then(() => true, () => false)) return null;
  const cursorRef = "resourceIndex" in unit.locator
    ? resourceCursorRef(unit.locator.resourceIndex)
    : documentCursorRef(unit.locator.attachmentIndex, unit.page);
  return {
    key: path.relative(rootPath(vaultRoot), cachePath), jobId: job.jobId, cursor: unit.cursor, cursorRef, locator: unit.locator,
    cacheSha256: attested.cacheSha256, page: unit.page, failures: unit.cursor ? job.failures : 0,
    source: { rawRef: attested.source.rawRef, sha256: attested.storedSha256, mediaType: attested.source.mediaType, ...(attested.source.resource ? { resource: attested.source.resource } : {}),
      clinicalOccurredAt: attested.parent.clinicalOccurredAt, recordedAt: attested.parent.retrievedAt },
    documentPath: attested.documentPath, timeZone: unit.timeZone, ...(attested.resourceText !== undefined ? { extractedText: attested.resourceText } : {}),
  };
}

/** Attests one attachment or structured resource of a job, at or ahead of its cursor. */
async function attestClinicalUnitSource(vaultRoot: string, job: Job, manifest: z.infer<typeof clinicalRawManifestSchema>, locator: ClinicalExtractionUnit["locator"]) {
  if ("resourceIndex" in locator) {
    const resource = job.structuredSources?.[locator.resourceIndex];
    if (!resource) throw new Error("Clinical resource is not part of this job.");
    const attested = await attestClinicalStructuredSource({ vaultRoot, manifestPath: job.root.manifestPath, manifest, source: resource });
    return { ...attested, cacheSha256: resource.sha256, storedSha256: attested.source.sha256, resourceText: attested.extractedText };
  }
  const attachment = "documentAttachments" in manifest ? manifest.documentAttachments?.[locator.attachmentIndex] : undefined;
  if (attachment?.status !== "downloaded") throw new Error("Clinical document is not downloaded.");
  const source = sourceSchema.parse({ rawRef: path.posix.join(path.posix.dirname(job.root.manifestPath), attachment.relativePath), sha256: attachment.sha256, mediaType: attachment.mediaType, byteLength: attachment.byteLength });
  const attested = await attestSource(vaultRoot, { ...job, attachmentIndex: locator.attachmentIndex, source });
  return { ...attested, source, cacheSha256: attachment.sha256, resourceText: undefined };
}

/**
 * Saves one validated extraction to the cache, never replacing an existing
 * entry. The job's apply wake promotes it when the cursor reaches it.
 */
export async function saveClinicalExtraction(input: {
  vaultRoot: string;
  unit: ClinicalExtractionUnit;
  totalPages: number;
  outputs: Record<(typeof families)[number], ClinicalDocumentExtractionOutput>;
}): Promise<"saved" | "existing" | "stale"> {
  return locked(input.vaultRoot, async () => {
    const job = await readJob(input.vaultRoot, input.unit.jobId);
    if (job.status !== "pending" && job.status !== "prepared") return "stale";
    const attested = await readJobManifest(input.vaultRoot, job)
      .then((manifest) => attestClinicalUnitSource(input.vaultRoot, job, manifest, input.unit.locator)).catch(() => null);
    if (!attested?.parent.eligible || attested.storedSha256 !== input.unit.source.sha256) return "stale";
    const cachePath = extractionCachePath(input.vaultRoot, attested.cacheSha256, attested.source.mediaType, input.unit.page, attested.parent.clinicalOccurredAt);
    if (path.relative(rootPath(input.vaultRoot), cachePath) !== input.unit.key) return "stale";
    const current = "attachmentIndex" in input.unit.locator && input.unit.locator.attachmentIndex === job.attachmentIndex;
    if (current && job.totalPages !== undefined && job.totalPages !== input.totalPages) return "stale";
    if (await readOptional(cachePath) !== null) return "existing";
    const prepared = validateClinicalProposal({ resource: Boolean(attested.source.resource), page: input.unit.page, totalPages: input.totalPages, outputs: input.outputs });
    await mkdir(path.dirname(cachePath), { recursive: true, mode: 0o700 });
    await writeJsonFileAtomic(cachePath, prepared, { mode: 0o600 });
    return "saved";
  });
}

// Only obsolete cache directories are disposable; pending.json and accepted jobs
// remain recovery evidence. The idle owner supplies its existing deadline/wake signal.
export async function pruneSupersededClinicalExtractionCaches(input: {
  vaultRoot: string;
  signal: AbortSignal;
}): Promise<void> {
  input.signal.throwIfAborted();
  const relativeRoot = ".runtime/operations/clinical-records/enrichment";
  const root = await resolveVaultPathOnDisk(input.vaultRoot, relativeRoot);
  let directory;
  try { directory = await opendir(root.absolutePath); }
  catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return; throw error; }
  for await (const entry of directory) {
    input.signal.throwIfAborted();
    if (entry.isDirectory() && entry.name.startsWith("extraction-v") && entry.name !== currentExtractionCacheDirectory) {
      await removeCacheDirectory(path.join(root.absolutePath, entry.name));
    }
  }

  async function removeCacheDirectory(absolutePath: string): Promise<void> {
    input.signal.throwIfAborted();
    // Disk entry names are opaque: vault path normalization would reinterpret backslashes.
    for await (const entry of await opendir(absolutePath)) {
      input.signal.throwIfAborted();
      if (entry.isDirectory()) {
        await removeCacheDirectory(path.join(absolutePath, entry.name));
      } else {
        // Unlink symlinks themselves; never traverse them or their targets.
        await rm(path.join(absolutePath, entry.name), { force: true });
      }
    }
    input.signal.throwIfAborted();
    await rmdir(absolutePath);
  }
}

// Version the cache when extraction semantics change. It is private, disposable
// runtime state; current parent evidence and canonical authority are still checked.
function extractionCachePath(vaultRoot: string, sha256: string, mediaType: string, page: number, clinicalOccurredAt?: string): string {
  return path.join(rootPath(vaultRoot), currentExtractionCacheDirectory, hash(JSON.stringify([digestSchema.parse(sha256), mediaType, clinicalOccurredAt ?? null])), `${page}.json`);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function factKey(payload: ClinicalDocumentExtractionPayload) {
  switch (payload.kind) {
    case "measurement": return stable([payload.kind, payload.occurredAt, payload.measurements.map((entry) => stable([entry.metric, entry.value, entry.unit, entry.qualifiers])).sort()]);
    case "test": return stable([payload.kind, payload.occurredAt, payload.specimenType, payload.results?.map((entry) => stable([entry.biomarkerSlug ?? entry.slug, entry.analyte, entry.value, entry.textValue, entry.unit, entry.comparator])).sort() ?? payload.testName]);
    case "clinical_assertion": return stable([payload.kind, payload.occurredAt, payload.assertion, payload.domain, payload.polarity, payload.subject, payload.bodySite, payload.code, payload.codeSystem, payload.assertedOn]);
    case "note": return payload.clinicalFact ? stable([payload.kind, payload.clinicalFact]) : stable(payload);
  }
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function overlap(payload: ClinicalDocumentExtractionPayload, entities: CanonicalEntity[]): "new" | "existing" | "held" {
  const relevant = entities.filter((entity) => entity.kind === payload.kind && entity.occurredAt !== null && Date.parse(entity.occurredAt) === Date.parse(payload.occurredAt));
  if (payload.kind === "clinical_assertion") {
    const fields = ["assertion", "domain", "polarity", "subject", "bodySite", "code", "codeSystem", "assertedOn"] as const;
    return relevant.some((entity) => fields.every((field) => stable(entity.attributes[field]) === stable(payload[field]))) ? "existing" : "new";
  }
  if (payload.kind === "note") {
    if (payload.clinicalFact) return relevant.some((entity) => stable(entity.attributes.clinicalFact) === stable(payload.clinicalFact)) ? "existing" : "new";
    return relevant.some((entity) => stable([entity.attributes.note, entity.attributes.sections]) === stable([payload.note, payload.sections])) ? "existing" : "new";
  }
  if (payload.kind === "test" && !payload.results) return "new";
  const field = payload.kind === "measurement" ? "measurements" : "results";
  const proposed = payload.kind === "measurement" ? payload.measurements : payload.results ?? [];
  const specimenType = payload.kind === "test" ? payload.specimenType : undefined;
  const prior = clinicalValuesForComparison(relevant, field, specimenType);
  let matched = 0;
  for (const entry of proposed) {
    const result = compareClinicalValue(object(entry), prior, field, specimenType);
    if (result === "held") return "held";
    if (result === "existing") matched++;
  }
  return matched === proposed.length ? "existing" : matched > 0 ? "held" : "new";
}

function clinicalValuesForComparison(
  entities: CanonicalEntity[],
  field: "measurements" | "results",
  specimenType: string | undefined,
): Record<string, unknown>[] {
  return entities
    .filter((entity) => !specimenType || !entity.attributes.specimenType || specimenType === entity.attributes.specimenType)
    .flatMap((entity) => Array.isArray(entity.attributes[field])
      ? (entity.attributes[field] as unknown[]).map((value) => ({ ...object(value), specimenType: entity.attributes.specimenType }))
      : []);
}

function compareClinicalValue(
  candidate: Record<string, unknown>,
  prior: Record<string, unknown>[],
  field: "measurements" | "results",
  specimenType: string | undefined,
): "new" | "existing" | "held" {
  const key = field === "measurements" ? "metric" : "analyte";
  const biomarker = candidate.biomarkerSlug ?? candidate.slug;
  const sameMetric = prior.filter((value) =>
    (field === "results" && biomarker !== undefined && (value.biomarkerSlug ?? value.slug) === biomarker)
    || String(value[key]).trim().toLowerCase() === String(candidate[key]).trim().toLowerCase()
  );
  if (sameMetric.length === 0) return "new";
  if (sameMetric.length > 1) return "held";
  const existing = sameMetric[0]!;
  // Display labels do not establish analyte or specimen identity.
  if (field === "results" && (!biomarker || !specimenType || (existing.biomarkerSlug ?? existing.slug) !== biomarker || existing.specimenType !== specimenType)) return "held";
  const comparable = (value: Record<string, unknown>) => stable([value.value, value.textValue, value.unit, value.comparator, value.qualifiers]);
  return comparable(existing) === comparable(candidate) ? "existing" : "held";
}

async function readClinicalDay(vaultRoot: string, day: string) {
  return listCanonicalEntities(vaultRoot, {
    family: "event", kinds: ["measurement", "test", "note", "clinical_assertion"],
    from: day, to: day, limit: 1001,
  });
}

function findExtractedRecord(rows: CanonicalEntity[], externalRef: ExternalRef) {
  const fields = ["system", "resourceType", "resourceId", "facet", "version"] as const;
  return rows.find((row) => {
    const ref = object(row.attributes.externalRef);
    return fields.every((field) => ref[field] === externalRef[field]);
  });
}

function clinicalProposalDate(
  record: ClinicalDocumentExtractionOutput["records"][number],
  parent: { clinicalOccurredAt?: string; parentRevision: string },
  timeZone: string,
): ClinicalDocumentExtractionPayload | null {
  const payload = record.payload;
  if (!clinicalExtractionDateIsSupported(record, parent.clinicalOccurredAt, timeZone)) return null;
  if (payload.kind === "note" && payload.clinicalFact) {
    return { ...payload, noteType: "clinical_fact", occurredAt: payload.clinicalFact.clinicalDate ?? parent.clinicalOccurredAt ?? parent.parentRevision };
  }
  if (record.dateBasis === "document") return payload;
  if (record.dateBasis === "source") {
    // Resolve against this attested parent, including when identical document
    // bytes reused a cached extraction made for another parent.
    return parent.clinicalOccurredAt ? { ...payload, occurredAt: parent.clinicalOccurredAt } : null;
  }
  return null;
}

function clinicalSourceCodings(resource: Record<string, unknown>): Set<string> {
  const codings = new Set<string>();
  const pending: unknown[] = [resource];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    if ("code" in value && typeof value.code === "string") {
      const system = "system" in value ? value.system : undefined;
      codings.add(JSON.stringify([value.code, system]));
    }
    for (const child of Object.values(value)) pending.push(child);
  }
  return codings;
}

function observationQuantity(resource: Record<string, unknown>) {
  if (resource.resourceType !== "Observation" || resource.component) return null;
  const quantity = object(resource.valueQuantity);
  const unit = quantity.code ?? quantity.unit;
  if (typeof quantity.value === "number" && typeof unit === "string" && !quantity.comparator) {
    return { value: quantity.value, unit };
  }
  if (typeof resource.valueString !== "string") return null;
  // A single labeled quantity, excluding ranges and other multi-value text.
  const match = /^[a-z\s:]*?([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*([a-z%][a-z/%]*)\.?$/iu.exec(resource.valueString.trim());
  return match ? { value: Number(match[1]), unit: match[2]! } : null;
}

function matchesObservationQuantity(
  entry: Extract<ClinicalDocumentExtractionPayload, { kind: "measurement" }>["measurements"][number],
  source: { value: number; unit: string },
): boolean {
  if (unitsEquivalent(entry.unit, source.unit)) return entry.value === source.value;
  const actual = normalizeMetricValue({ metricKey: entry.metric, ...source });
  const proposed = normalizeMetricValue({ metricKey: entry.metric, unit: entry.unit, value: entry.value });
  return actual.canonicalValue !== null && actual.canonicalUnit === proposed.canonicalUnit
    && actual.canonicalValue === proposed.canonicalValue;
}

function clinicalResourceEvidence(source: NonNullable<Job["source"]>, text?: string) {
  if (!source.resource) return null;
  const resource = text ? object(JSON.parse(text)) : {};
  return { codings: clinicalSourceCodings(resource), quantity: observationQuantity(resource) };
}

function clinicalTypedFactEvidenceHold(record: ClinicalDocumentExtractionOutput["records"][number], text: string | undefined): string | null {
  if (record.payload.kind !== "note" || !record.payload.clinicalFact) return null;
  if (!record.excerpt || (text !== undefined && (!text.includes(record.excerpt)
    || (record.dateBasis === "document" && (!record.dateEvidence || !text.includes(record.dateEvidence)))))) {
    return "Clinical source fact lacks literal source evidence.";
  }
  return null;
}

function clinicalProposalTags(record: ClinicalDocumentExtractionOutput["records"][number]): string[] {
  const tags = record.dateBasis ? [`clinical-date-${record.dateBasis}`] : [];
  if (record.payload.kind === "note" && record.payload.clinicalFact) tags.push(`clinical-fact-${record.payload.clinicalFact.category}`);
  return tags;
}

function clinicalPageLocator(mediaType: string, page: number): { page?: number } {
  return ["application/pdf", "image/png", "image/jpeg"].includes(mediaType.split(";", 1)[0]?.trim().toLowerCase() ?? "") ? { page } : {};
}

function clinicalEvidenceHoldReason(record: ClinicalDocumentExtractionOutput["records"][number], evidence: ReturnType<typeof clinicalResourceEvidence>, text: string | undefined): string | null {
  const typedHold = clinicalTypedFactEvidenceHold(record, text);
  if (typedHold) return typedHold;
  if (!evidence) return null;
  if ((record.payload.kind === "note" && !record.payload.clinicalFact) || !text || !record.excerpt || !text.includes(record.excerpt)
    || (record.dateBasis === "document" && (!record.dateEvidence || !text.includes(record.dateEvidence)))) {
    return "Clinical resource proposal lacks literal source evidence.";
  }
  return clinicalResourcePayloadHold(record.payload, evidence);
}

function clinicalResourcePayloadHold(payload: ClinicalDocumentExtractionPayload, { codings, quantity }: NonNullable<ReturnType<typeof clinicalResourceEvidence>>): string | null {
  if (quantity && payload.kind === "measurement" && payload.measurements.some(entry => !matchesObservationQuantity(entry, quantity))) {
    return "Clinical measurement disagrees with the source observation.";
  }
  if (payload.kind === "note" && payload.clinicalFact?.codings?.some((coding) => !codings.has(JSON.stringify([coding.code, coding.system])))) {
    return "Clinical source fact coding does not match source coding.";
  }
  if (payload.kind === "clinical_assertion" && (payload.code || payload.codeSystem)
    && !codings.has(JSON.stringify([payload.code, payload.codeSystem]))) {
    return "Clinical resource proposal code and system do not match source coding.";
  }
  return null;
}

async function planClinicalEnrichmentPage(
  vaultRoot: string,
  job: Job,
  prepared: NonNullable<Job["prepared"]>,
  source: NonNullable<Job["source"]>,
  parent: { parentExternalRef: ExternalRef; parentRevision: string; clinicalOccurredAt?: string; retrievedAt: string },
  sourceText?: string,
) {
  const metadata = vaultMetadataSchema.parse(await readVaultMetadataSource(vaultRoot));
  const dayReads = new Map<string, CanonicalEntity[]>();
  const accepted = [];
  let existing = 0;
  let held = 0;
  const identities = new Set<string>();
  const verifiedIds: string[] = [];
  const evidence = clinicalResourceEvidence(source, sourceText);
  const hold = (reason: string) => {
    held++;
    recordHoldReason(job, reason);
  };
  for (const family of families) {
    const output = clinicalDocumentExtractionOutputSchemaForFamily(family).parse(prepared.outputs[family]);
    if (output.status === "blocked") hold(`${family}: ${output.reason}`.slice(0, 500));
    for (const record of output.records) {
      const evidenceHold = clinicalEvidenceHoldReason(record, evidence, sourceText);
      if (evidenceHold) {
        hold(evidenceHold); continue;
      }
      const proposed = record.payload;
      const payload = clinicalProposalDate(record, parent, metadata.timezone);
      if (!payload) { hold("Clinical fact has no supported event date."); continue; }
      const labHold = clinicalEnrichmentLabHoldReason(payload);
      if (labHold) { hold(labHold); continue; }
      // Identity belongs to the frozen proposal, including across a date-policy upgrade.
      const facet = `document-extraction-${hash(`${source.resource?.sha256 ?? source.sha256}\n${family}\n${factKey(proposed)}`)}`;
      const externalRef = { ...parent.parentExternalRef, facet, version: parent.parentRevision };
      if (identities.has(facet)) { existing++; continue; }
      identities.add(facet);
      const day = toLocalDayKey(payload.occurredAt, metadata.timezone);
      if (!dayReads.has(day) && dayReads.size >= 32) { hold("Page exceeds the 32 distinct clinical-date lookup budget."); continue; }
      if (!dayReads.has(day)) dayReads.set(day, await readClinicalDay(vaultRoot, day));
      const rows = dayReads.get(day)!;
      // Source identity lookup precedes overlap checks so crash replay cannot
      // be reclassified when other canonical data arrived in the meantime.
      const replay = findExtractedRecord(rows, externalRef);
      if (replay) { existing++; verifiedIds.push(replay.entityId); continue; }
      if (rows.length >= 501) { hold("Clinical date exceeds the bounded canonical overlap lookup."); continue; }
      const result = overlap(payload, rows);
      if (result === "existing") { existing++; continue; }
      if (result === "held") { hold("Clinical fact overlaps canonical data without a unique equivalent identity."); continue; }
      accepted.push({ day, externalRef, decision: eventImportDecisionSchema.parse({ action: "upsert", sourceParent: parent.parentExternalRef, payload: {
        ...payload, tags: clinicalProposalTags(record), source: "import", rawRefs: [source.rawRef],
        evidence: [{ rawRef: source.rawRef, ...clinicalPageLocator(source.mediaType, prepared.page), ...((record.dateEvidence ?? record.excerpt) ? { excerpt: [record.dateEvidence, record.excerpt].filter(Boolean).join(" · ").slice(0, 500) } : {}) }],
        externalRef,
      } }) });
    }
  }
  return { accepted, existing, held, verifiedIds };
}

async function readbackClinicalEnrichmentPage(
  vaultRoot: string,
  accepted: Awaited<ReturnType<typeof planClinicalEnrichmentPage>>["accepted"],
) {
  const verifiedIds: string[] = [];
  for (const day of new Set(accepted.map((entry) => entry.day))) {
    const rows = await readClinicalDay(vaultRoot, day);
    for (const entry of accepted.filter((value) => value.day === day)) {
      const stored = findExtractedRecord(rows, entry.externalRef);
      if (!stored) throw new Error("Clinical enrichment canonical readback did not prove the accepted record.");
      verifiedIds.push(stored.entityId);
    }
  }
  return verifiedIds;
}

function enrichmentReceiptIdentity(job: Job, attested: Awaited<ReturnType<typeof attestSource>>): ClinicalChangeReceiptIdentity {
  const { manifest, sourceId } = attested;
  const batch = "batch" in manifest ? manifest.batch : undefined;
  return {
    connectionId: manifest.connectionId, runId: batch?.runId ?? manifest.retrievalJobId,
    unit: { kind: "enrichment", batch: batch?.index ?? 0, jobId: job.jobId, sourceId, page: job.page },
    inputDigest: hash(stable([sourceId, job.source, job.prepared])),
  };
}

/** Applies only host-attributed, previously frozen proposals; retries replay the same source keys. */
export async function applyClinicalEnrichmentProposals(input: { vaultRoot: string; jobId: string }) {
  return locked(input.vaultRoot, () => withCanonicalWriteLock(input.vaultRoot, async () => {
    const job = await readJob(input.vaultRoot, input.jobId);
    if (job.status !== "prepared" || !job.prepared || !job.source) throw new Error("Clinical enrichment has no accepted proposals to apply.");
    const attested = await attestSource(input.vaultRoot, job);
    const identity = enrichmentReceiptIdentity(job, attested);
    const saved = await readClinicalChangeReceipt(input.vaultRoot, identity);
    if (!saved) await commitAcceptedJob(input.vaultRoot, job.jobId);
    const completeHeld = async (reason: string) => {
      const receipt = saved ?? (await importEventBatch({
        vaultRoot: input.vaultRoot, apply: true, decisions: [], receiptIdentity: identity,
      })).receipt;
      return holdPreparedClinicalDocument(input.vaultRoot, job, reason, receipt);
    };
    if (!attested.parent.eligible) {
      return completeHeld(attested.parent.reason ?? "Clinical document parent is not eligible.");
    }
    const { accepted, existing, held, verifiedIds } = await planClinicalEnrichmentPage(input.vaultRoot, job, job.prepared, job.source, attested.parent, attested.extractedText);
    let canonical;
    try {
      canonical = saved ? null : await importEventBatch({
        vaultRoot: input.vaultRoot, apply: true, receiptIdentity: identity, decisions: accepted.map((entry) => entry.decision),
      });
    } catch (error) {
      if (isVaultError(error) && (error.code === "EVENT_SOURCE_PARENT_WITHDRAWN" || error.code === "EVENT_SOURCE_PARENT_STALE")) {
        return completeHeld("Clinical document parent was withdrawn or replaced by a newer revision.");
      }
      throw error;
    }
    if (saved && accepted.length) {
      // A completed page cannot publish proposals that became eligible on retry.
      const reason = "Previously completed clinical page no longer matches current canonical facts.";
      job.counts.held += accepted.length;
      recordHoldReason(job, reason);
    } else {
      verifiedIds.push(...await readbackClinicalEnrichmentPage(input.vaultRoot, accepted));
    }
    job.counts.created += canonical?.createdCount ?? 0;
    job.counts.existing += existing + (canonical?.skippedExistingCount ?? 0);
    job.counts.held += held;
    const readback = await finishClinicalEnrichmentPage(input.vaultRoot, job, verifiedIds, job.prepared.totalPages);
    return { receipt: saved ?? canonical!.receipt, canonical: accepted.length ? canonical : null, counts: job.counts, readback };
  }));
}

async function finishClinicalEnrichmentPage(vaultRoot: string, job: Job, verifiedIds: string[], totalPages: number) {
  job.counts.pages++;
  job.lastReadback = { eventIds: verifiedIds, verifiedCount: verifiedIds.length };
  if (job.page >= totalPages) {
    advanceClinicalSource(job);
    job.page = 1;
    job.counts.documents++;
    delete job.source;
    delete job.totalPages;
  } else {
    job.page++;
  }
  delete job.prepared;
  job.status = "pending";
  await saveJob(vaultRoot, job);
  return job.lastReadback;
}

async function holdPreparedClinicalDocument(vaultRoot: string, job: Job, reason: string, receipt: ClinicalChangeReceipt) {
  holdCurrentSource(job, reason);
  delete job.prepared;
  job.status = "pending";
  job.lastReadback = { eventIds: [], verifiedCount: 0 };
  await saveJob(vaultRoot, job);
  return { receipt, canonical: null, counts: job.counts, readback: job.lastReadback };
}

export async function readClinicalEnrichmentStatus(input: { vaultRoot: string; jobId: string }) {
  const job = await readJob(input.vaultRoot, input.jobId);
  return { status: job.status, counts: job.counts, nextAttemptAt: job.nextAttemptAt, reason: job.reason, holdReasons: job.holdReasons };
}

/**
 * A failure settles only while the job's cursor still points at the failed
 * unit, and holds it by the unit's own kind. The kind comes from the manifest,
 * never from a source the apply wake may not have initialized yet. Null means
 * the cursor moved; undefined means the caller named no unit.
 */
async function settledCursorKind(vaultRoot: string, job: Job, cursorRef: string | undefined): Promise<boolean | undefined | null> {
  if (cursorRef === undefined) return undefined;
  if (job.status !== "pending") return null;
  const manifest = await readJobManifest(vaultRoot, job);
  const attachmentCount = "documentAttachments" in manifest ? manifest.documentAttachments?.length ?? 0 : 0;
  return jobCursorRef(job, attachmentCount) === cursorRef ? cursorRef.startsWith("resource:") : null;
}

export async function deferClinicalEnrichment(input: { vaultRoot: string; jobId: string; reason: string; nextAttemptAt: string; cursorRef?: string }) {
  return locked(input.vaultRoot, async () => {
    const job = await readJob(input.vaultRoot, input.jobId);
    const structured = await settledCursorKind(input.vaultRoot, job, input.cursorRef);
    if (structured === null) return { status: job.status, nextAttemptAt: job.nextAttemptAt };
    if (job.status !== "pending") throw new Error("Only unprepared clinical enrichment can defer extraction.");
    job.failures++;
    job.reason = input.reason;
    if (job.failures >= 3) holdCurrentSource(job, "Clinical extraction exceeded three provider attempts.", structured);
    else job.nextAttemptAt = input.nextAttemptAt;
    await saveJob(input.vaultRoot, job);
    return { status: job.status, nextAttemptAt: job.nextAttemptAt };
  });
}

function recordHoldReason(job: Job, reason: string) {
  if (!job.holdReasons.includes(reason)) job.holdReasons = [...job.holdReasons, reason].slice(-20);
}

function holdCurrentSource(job: Job, reason: string, structured?: boolean) {
  job.counts.held++;
  recordHoldReason(job, reason);
  advanceClinicalSource(job, structured);
  job.page = 1;
  job.failures = 0;
  delete job.source;
  delete job.totalPages;
  delete job.nextAttemptAt;
}

export async function blockClinicalEnrichment(input: { vaultRoot: string; jobId: string; reason: string; cursorRef?: string }): Promise<void> {
  await locked(input.vaultRoot, async () => {
    const job = await readJob(input.vaultRoot, input.jobId);
    if (job.status === "complete") return;
    const structured = await settledCursorKind(input.vaultRoot, job, input.cursorRef);
    if (structured === null) return;
    if (job.status === "prepared") throw new Error("Accepted clinical enrichment proposals must be applied before blocking.");
    job.reason = input.reason;
    holdCurrentSource(job, input.reason, structured);
    await saveJob(input.vaultRoot, job);
  });
}

function advanceClinicalSource(job: Job, structured = Boolean(job.source?.resource)): void {
  if (structured) job.resourceIndex = (job.resourceIndex ?? 0) + 1;
  else job.attachmentIndex++;
}
