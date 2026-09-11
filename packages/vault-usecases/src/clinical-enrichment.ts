import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  clinicalDocumentExtractionOutputSchemaForFamily,
  clinicalDocumentExtractionOutputSchema,
  clinicalRawManifestSchema,
  clinicalRawPathSchema,
  type ClinicalDocumentAttachment,
  type ClinicalDocumentExtractionOutput,
  type ClinicalDocumentExtractionPayload,
} from "@murphai/clinical-records";
import { eventImportDecisionSchema, toLocalDayKey, vaultMetadataSchema, type ExternalRef } from "@murphai/contracts";
import * as z from "@murphai/contracts/zod-runtime";
import { importEventBatch, isVaultError, resolveVaultPathOnDisk, withCanonicalResourceLocks, withCanonicalWriteLock } from "@murphai/core";
import { listCanonicalEntities, readVaultMetadataSource, type CanonicalEntity } from "@murphai/query";
import { resolveRuntimePaths, writeJsonFileAtomic } from "@murphai/runtime-state/node";

import { clinicalEnrichmentLabHoldReason } from "./clinical-enrichment-labs.ts";
import { readClinicalEnrichmentParentEligibility } from "./clinical-enrichment-parent.ts";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const manifestRefSchema = z.object({ manifestPath: clinicalRawPathSchema, sha256: digestSchema }).strict();
const sourceSchema = z.object({ rawRef: clinicalRawPathSchema, sha256: digestSchema, mediaType: z.string().min(1).max(255), byteLength: z.number().int().positive().max(20 * 1024 * 1024) }).strict();
const outputsSchema = z.object({ labs: clinicalDocumentExtractionOutputSchema, measurements: clinicalDocumentExtractionOutputSchema, history: clinicalDocumentExtractionOutputSchema }).strict();
const countsSchema = z.object({ created: z.number().int().nonnegative(), existing: z.number().int().nonnegative(), held: z.number().int().nonnegative(), pages: z.number().int().nonnegative(), documents: z.number().int().nonnegative() }).strict();
const jobSchema = z.object({
  schema: z.literal("murph.clinical-enrichment.v1"),
  jobId: digestSchema,
  root: manifestRefSchema,
  attachmentIndex: z.number().int().nonnegative(),
  page: z.number().int().positive().max(100_000),
  totalPages: z.number().int().positive().max(100_000).optional(),
  nextAttemptAt: z.iso.datetime().optional(),
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
export type ClinicalEnrichmentSource = Pick<z.infer<typeof sourceSchema>, "rawRef" | "sha256" | "mediaType">;
export type ClinicalEnrichmentWork =
  | { status: "extract"; jobId: string; source: ClinicalEnrichmentSource; documentPath: string; page: number }
  | { status: "deferred"; jobId: string; nextAttemptAt: string }
  | { status: "apply" | "advance"; jobId: string };
const indexSchema = z.object({ schema: z.literal("murph.clinical-enrichment-index.v1"), pending: z.array(digestSchema).max(128) }).strict();
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
async function readJob(vaultRoot: string, jobId: string) { return jobSchema.parse(await readOptional(jobPath(vaultRoot, jobId))); }
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
async function verifySource(vaultRoot: string, source: z.infer<typeof sourceSchema>) {
  const resolved = await resolveVaultPathOnDisk(vaultRoot, source.rawRef);
  if ((await stat(resolved.absolutePath)).size !== source.byteLength) throw new Error("Clinical enrichment document size mismatch.");
  if (hash(await readFile(resolved.absolutePath)) !== source.sha256) throw new Error("Clinical enrichment document digest mismatch.");
  return resolved.absolutePath;
}
async function attestSource(vaultRoot: string, job: Job) {
  const manifest = await readManifest(vaultRoot, job.root);
  const attachment = "documentAttachments" in manifest ? manifest.documentAttachments?.[job.attachmentIndex] : undefined;
  if (!job.source || attachment?.status !== "downloaded" || attachment.sha256 !== job.source.sha256 || attachment.byteLength !== job.source.byteLength || attachment.mediaType !== job.source.mediaType || path.posix.join(path.posix.dirname(job.root.manifestPath), attachment.relativePath) !== job.source.rawRef) throw new Error("Clinical enrichment source is no longer attested by its manifest.");
  const parent = await readClinicalEnrichmentParentEligibility({ vaultRoot, manifestPath: job.root.manifestPath, manifest, attachment });
  return { documentPath: await verifySource(vaultRoot, job.source), parent };
}

/** Portable clinical operations only; raw evidence and canonical records keep their existing owners. */
export async function enqueueClinicalEnrichment(input: { vaultRoot: string; manifestPath: string; manifestSha256: string }): Promise<{ jobId: string }> {
  return locked(input.vaultRoot, async () => {
    const root = manifestRefSchema.parse({ manifestPath: input.manifestPath, sha256: input.manifestSha256 });
    await readManifest(input.vaultRoot, root);
    const jobId = root.sha256;
    const existing = await readOptional(jobPath(input.vaultRoot, jobId));
    const job = existing ? jobSchema.parse(existing) : jobSchema.parse({ schema: "murph.clinical-enrichment.v1", jobId, root, attachmentIndex: 0, page: 1, status: "pending", counts: { created: 0, existing: 0, held: 0, pages: 0, documents: 0 } });
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
      try { manifest = await readManifest(input.vaultRoot, job.root); }
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
      job.status = job.counts.held > 0 ? "blocked" : "complete";
      if (job.status === "blocked") job.reason = "Some clinical document records require review.";
      await saveJob(input.vaultRoot, job);
      // The next pass compacts the index after this terminal receipt commits.
      return { status: "advance", jobId };
    }
    return deferred;
  });
}

async function prepareCurrentClinicalDocument(
  vaultRoot: string,
  job: Job,
  attachment: Extract<ClinicalDocumentAttachment, { status: "downloaded" }>,
): Promise<Extract<ClinicalEnrichmentWork, { status: "extract" }> | null> {
  job.source = sourceSchema.parse({ rawRef: path.posix.join(path.posix.dirname(job.root.manifestPath), attachment.relativePath), sha256: attachment.sha256, mediaType: attachment.mediaType, byteLength: attachment.byteLength });
  let attested;
  try { attested = await attestSource(vaultRoot, job); }
  catch {
    holdCurrentDocument(job, "Clinical document or parent evidence failed integrity validation.");
    await saveJob(vaultRoot, job);
    return null;
  }
  if (!attested.parent.eligible) {
    holdCurrentDocument(job, attested.parent.reason ?? "Clinical document parent is not eligible.");
    await saveJob(vaultRoot, job);
    return null;
  }
  await saveJob(vaultRoot, job);
  return { status: "extract", jobId: job.jobId, source: { rawRef: job.source.rawRef, sha256: job.source.sha256, mediaType: job.source.mediaType }, documentPath: attested.documentPath, page: job.page };
}

export async function persistClinicalEnrichmentProposals(input: { vaultRoot: string; jobId: string; sourceSha256: string; page: number; totalPages: number; outputs: Record<(typeof families)[number], ClinicalDocumentExtractionOutput> }): Promise<void> {
  await locked(input.vaultRoot, async () => {
    const job = await readJob(input.vaultRoot, input.jobId);
    if (job.source?.sha256 !== input.sourceSha256 || job.page !== input.page) throw new Error("Clinical enrichment proposal cursor is stale.");
    if (job.status === "prepared") return; // First durable proposal wins; never resample accepted content.
    if (job.status !== "pending") throw new Error("Clinical enrichment job is terminal.");
    const attested = await attestSource(input.vaultRoot, job);
    if (!attested.parent.eligible) throw new Error("Clinical document parent is not eligible for proposals.");
    const outputs = outputsSchema.parse(Object.fromEntries(families.map((family) => [family, clinicalDocumentExtractionOutputSchemaForFamily(family).parse(input.outputs[family])])));
    if (input.page > input.totalPages || families.some((family) => outputs[family].records.some((record) => record.page !== undefined && record.page !== input.page))) throw new Error("Clinical enrichment proposals reference an unprocessed page.");
    if (job.totalPages !== undefined && job.totalPages !== input.totalPages) throw new Error("Clinical enrichment document page count changed.");
    if (Buffer.byteLength(JSON.stringify(outputs), "utf8") > 4 * 1024 * 1024) throw new Error("Clinical enrichment proposals exceed the byte limit.");
    job.totalPages = input.totalPages;
    job.failures = 0;
    delete job.nextAttemptAt;
    job.prepared = { page: input.page, totalPages: input.totalPages, outputs };
    job.status = "prepared";
    await saveJob(input.vaultRoot, job);
  });
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
    case "note": return stable(payload);
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

async function planClinicalEnrichmentPage(
  vaultRoot: string,
  job: Job,
  prepared: NonNullable<Job["prepared"]>,
  source: NonNullable<Job["source"]>,
  parent: { parentExternalRef: ExternalRef; parentRevision: string },
) {
  const metadata = vaultMetadataSchema.parse(await readVaultMetadataSource(vaultRoot));
  const dayReads = new Map<string, CanonicalEntity[]>();
  const accepted = [];
  let existing = 0;
  let held = 0;
  const identities = new Set<string>();
  const verifiedIds: string[] = [];
  const hold = (reason: string) => {
    held++;
    if (!job.holdReasons.includes(reason)) job.holdReasons = [...job.holdReasons, reason].slice(-20);
  };
  for (const family of families) {
    const output = clinicalDocumentExtractionOutputSchemaForFamily(family).parse(prepared.outputs[family]);
    if (output.status === "blocked") hold(`${family}: ${output.reason}`.slice(0, 500));
    for (const record of output.records) {
      const payload = record.payload;
      const labHold = clinicalEnrichmentLabHoldReason(payload);
      if (labHold) { hold(labHold); continue; }
      const facet = `document-extraction-${hash(`${source.sha256}\n${family}\n${factKey(payload)}`)}`;
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
        ...payload, source: "import", rawRefs: [source.rawRef],
        evidence: [{ rawRef: source.rawRef, page: prepared.page, ...(record.excerpt ? { excerpt: record.excerpt } : {}) }],
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

/** Applies only host-attributed, previously frozen proposals; retries replay the same source keys. */
export async function applyClinicalEnrichmentProposals(input: { vaultRoot: string; jobId: string }) {
  return locked(input.vaultRoot, () => withCanonicalWriteLock(input.vaultRoot, async () => {
    const job = await readJob(input.vaultRoot, input.jobId);
    if (job.status !== "prepared" || !job.prepared || !job.source) throw new Error("Clinical enrichment has no accepted proposals to apply.");
    const attested = await attestSource(input.vaultRoot, job);
    if (!attested.parent.eligible) {
      return holdPreparedClinicalDocument(input.vaultRoot, job, attested.parent.reason ?? "Clinical document parent is not eligible.");
    }
    const { accepted, existing, held, verifiedIds } = await planClinicalEnrichmentPage(input.vaultRoot, job, job.prepared, job.source, attested.parent);
    let canonical;
    try {
      canonical = accepted.length ? await importEventBatch({ vaultRoot: input.vaultRoot, apply: true, decisions: accepted.map((entry) => entry.decision) }) : null;
    } catch (error) {
      if (isVaultError(error) && (error.code === "EVENT_SOURCE_PARENT_WITHDRAWN" || error.code === "EVENT_SOURCE_PARENT_STALE")) {
        return holdPreparedClinicalDocument(input.vaultRoot, job, "Clinical document parent was withdrawn or replaced by a newer revision.");
      }
      throw error;
    }
    verifiedIds.push(...await readbackClinicalEnrichmentPage(input.vaultRoot, accepted));
    job.counts.created += canonical?.createdCount ?? 0;
    job.counts.existing += existing + (canonical?.skippedExistingCount ?? 0);
    job.counts.held += held;
    job.counts.pages++;
    job.lastReadback = { eventIds: verifiedIds, verifiedCount: verifiedIds.length };
    if (job.page >= job.prepared.totalPages) { job.attachmentIndex++; job.page = 1; job.counts.documents++; delete job.source; delete job.totalPages; }
    else job.page++;
    delete job.prepared;
    job.status = "pending";
    await saveJob(input.vaultRoot, job);
    return { canonical, counts: job.counts, readback: job.lastReadback };
  }));
}

async function holdPreparedClinicalDocument(vaultRoot: string, job: Job, reason: string) {
  holdCurrentDocument(job, reason);
  delete job.prepared;
  job.status = "pending";
  job.lastReadback = { eventIds: [], verifiedCount: 0 };
  await saveJob(vaultRoot, job);
  return { canonical: null, counts: job.counts, readback: job.lastReadback };
}

export async function readClinicalEnrichmentStatus(input: { vaultRoot: string; jobId: string }) {
  const job = await readJob(input.vaultRoot, input.jobId);
  return { status: job.status, counts: job.counts, nextAttemptAt: job.nextAttemptAt, reason: job.reason, holdReasons: job.holdReasons };
}

export async function deferClinicalEnrichment(input: { vaultRoot: string; jobId: string; reason: string; nextAttemptAt: string }) {
  return locked(input.vaultRoot, async () => {
    const job = await readJob(input.vaultRoot, input.jobId);
    if (job.status !== "pending") throw new Error("Only unprepared clinical enrichment can defer extraction.");
    job.failures++;
    job.reason = input.reason;
    if (job.failures >= 3) holdCurrentDocument(job, "Clinical extraction exceeded three provider attempts.");
    else job.nextAttemptAt = input.nextAttemptAt;
    await saveJob(input.vaultRoot, job);
    return { status: job.status, nextAttemptAt: job.nextAttemptAt };
  });
}

function holdCurrentDocument(job: Job, reason: string) {
  job.counts.held++;
  if (!job.holdReasons.includes(reason)) job.holdReasons = [...job.holdReasons, reason].slice(-20);
  job.attachmentIndex++;
  job.page = 1;
  job.failures = 0;
  delete job.source;
  delete job.totalPages;
  delete job.nextAttemptAt;
}

export async function blockClinicalEnrichment(input: { vaultRoot: string; jobId: string; reason: string }): Promise<void> {
  await locked(input.vaultRoot, async () => {
    const job = await readJob(input.vaultRoot, input.jobId);
    if (job.status === "complete") return;
    if (job.status === "prepared") throw new Error("Accepted clinical enrichment proposals must be applied before blocking.");
    job.reason = input.reason;
    holdCurrentDocument(job, input.reason);
    await saveJob(input.vaultRoot, job);
  });
}
