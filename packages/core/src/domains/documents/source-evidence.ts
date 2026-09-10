import type {
  AuditRecord,
  DocumentEventRecord,
  EventAttachment,
  EventRecord,
} from "@murphai/contracts";
import {
  INBOX_ATTACHMENT_ID_PATTERN,
  INBOX_CAPTURE_ID_PATTERN,
  assertContractId,
  auditRecordSchema,
  collectEventRawReferencePaths,
  eventRecordSchema,
  safeParseContract,
} from "@murphai/contracts";

import { ID_PREFIXES, VAULT_LAYOUT } from "../../constants.ts";
import { VaultError } from "../../errors.ts";
import {
  listEventLedgerShardPaths,
  readEventLedgerShardRecords,
} from "../../event-ledger-storage.ts";
import { readUtf8File, walkVaultFiles } from "../../fs.ts";
import {
  compareEventSpineEntries,
  isDeletedEventSpineRecord,
  type EventSpineEntry,
} from "../../history/event-spine.ts";
import { readJsonlRecords } from "../../jsonl.ts";
import {
  parseRawImportManifest,
  resolveRawManifestPath,
} from "../../operations/raw-manifests.ts";
import type { CommittedPayloadReceipt } from "../../operations/write-batch.ts";
import { statAndHashVaultFile } from "../../raw-artifact-integrity.ts";
import { rawDirectoryMatchesOwner, type RawArtifact } from "../../raw.ts";

export interface ImportDocumentResult {
  created: boolean;
  documentId: string;
  raw: RawArtifact;
  event: DocumentEventRecord;
  eventPath: string;
  auditPath: string | null;
  manifestPath: string;
}

export interface InboxDocumentDefaultPromotionCorrelation {
  attachmentId: string;
  captureId: string;
  documentId: string;
  eventId: string;
}

interface ExactDocumentSource {
  result: ImportDocumentResult & { created: false };
  rawRef: string;
}

export interface LiveExactDocumentImportEvidence {
  defaultPromotions: InboxDocumentDefaultPromotionCorrelation[];
  documentId: string;
  manifestPath: string;
  rawRef: string;
}

export interface LiveExactDocumentImportEvidenceGroup {
  byteLength: number;
  evidence: LiveExactDocumentImportEvidence[] | null;
  sha256: string;
}

const DOCUMENT_SOURCE_AUDIT_COMMAND = "core.importDocument";
export const INBOX_DOCUMENT_DEFAULT_PROMOTION_AUDIT_COMMAND =
  "core.recordInboxDocumentDefaultPromotion";
export const WORKOUT_SOURCE_IMPORT_AUDIT_COMMAND = "core.importEventBatch.sourceRawRefOnce";
const INBOX_CAPTURE_ID_REGEX = new RegExp(INBOX_CAPTURE_ID_PATTERN);
const INBOX_ATTACHMENT_ID_REGEX = new RegExp(INBOX_ATTACHMENT_ID_PATTERN);

export function buildRawSourceReceiptTarget(
  sourceReceipt: CommittedPayloadReceipt,
): string {
  return `raw-source-v1:sha256:${sourceReceipt.sha256}:bytes:${sourceReceipt.byteLength}`;
}

interface ExactDocumentSourceSet {
  activityEventIdsByRawRef: ReadonlyMap<string, ReadonlySet<string>>;
  completionAuditEventIds: ReadonlySet<string>;
  deletedExactSourceExists: boolean;
  liveSources: ExactDocumentSource[];
}

function rejectDamagedExactDocumentEvidence(input: {
  documentId: string;
  manifestPath?: string;
  reason: string;
}): never {
  throw new VaultError(
    "RAW_MANIFEST_INVALID",
    "Preserved exact source evidence is incomplete or damaged. Exact reuse will not create a replacement identity.",
    {
      documentId: input.documentId,
      ...(input.manifestPath ? { manifestPath: input.manifestPath } : {}),
      reason: input.reason,
    },
  );
}

interface ExactDocumentEventLedgerEntry {
  event: EventRecord | null;
  rawEventId: string | null;
  relativePath: string;
}

async function loadExactDocumentAuditRecords(vaultRoot: string): Promise<AuditRecord[]> {
  const records: AuditRecord[] = [];
  const auditPaths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.auditDirectory, {
    extension: ".jsonl",
  });
  for (const relativePath of auditPaths) {
    for (const rawRecord of await readJsonlRecords({ vaultRoot, relativePath })) {
      const parsed = safeParseContract(auditRecordSchema, rawRecord);
      if (parsed.success) {
        records.push(parsed.data);
      }
    }
  }
  return records;
}

function normalizeInboxDocumentDefaultPromotionCorrelation(
  input: InboxDocumentDefaultPromotionCorrelation,
): InboxDocumentDefaultPromotionCorrelation {
  const documentId = assertContractId(input.documentId, ID_PREFIXES.document, "documentId");
  const eventId = assertContractId(input.eventId, ID_PREFIXES.event, "eventId");
  const { attachmentId, captureId } = input;
  if (captureId.length > 255 || !INBOX_CAPTURE_ID_REGEX.test(captureId)) {
    throw new TypeError("captureId must be a bounded inbox capture ID");
  }
  if (attachmentId.length > 255 || !INBOX_ATTACHMENT_ID_REGEX.test(attachmentId)) {
    throw new TypeError("attachmentId must be a bounded inbox attachment ID");
  }
  return { attachmentId, captureId, documentId, eventId };
}

function buildInboxDocumentPromotionAttachmentKey(input: {
  attachmentId: string;
  captureId: string;
}): string {
  return JSON.stringify([input.captureId, input.attachmentId]);
}

function resolveInboxDocumentDefaultPromotionCorrelations(
  auditRecords: readonly AuditRecord[],
): InboxDocumentDefaultPromotionCorrelation[] {
  const correlationsByAttachment = new Map<
    string,
    InboxDocumentDefaultPromotionCorrelation | null
  >();
  for (const record of auditRecords) {
    const correlation = parseInboxDocumentDefaultPromotionAuditRecord(record);
    if (!correlation) {
      continue;
    }
    const key = buildInboxDocumentPromotionAttachmentKey(correlation);
    const existing = correlationsByAttachment.get(key);
    if (existing === null) {
      continue;
    }
    if (!existing) {
      correlationsByAttachment.set(key, correlation);
      continue;
    }
    if (
      existing.documentId !== correlation.documentId
      || existing.eventId !== correlation.eventId
    ) {
      correlationsByAttachment.set(key, null);
    }
  }
  return [...correlationsByAttachment.values()]
    .filter((correlation): correlation is InboxDocumentDefaultPromotionCorrelation =>
      correlation !== null
    );
}

function parseInboxDocumentDefaultPromotionAuditRecord(
  record: AuditRecord,
): InboxDocumentDefaultPromotionCorrelation | null {
  if (
    record.commandName !== INBOX_DOCUMENT_DEFAULT_PROMOTION_AUDIT_COMMAND
    || record.status !== "success"
    || record.targetIds?.length !== 4
  ) {
    return null;
  }
  try {
    return normalizeInboxDocumentDefaultPromotionCorrelation({
      captureId: record.targetIds[0] ?? "",
      attachmentId: record.targetIds[1] ?? "",
      documentId: record.targetIds[2] ?? "",
      eventId: record.targetIds[3] ?? "",
    });
  } catch {
    return null;
  }
}

export async function listInboxDocumentDefaultPromotionCorrelations(input: {
  vaultRoot: string;
}): Promise<InboxDocumentDefaultPromotionCorrelation[]> {
  return resolveInboxDocumentDefaultPromotionCorrelations(
    await loadExactDocumentAuditRecords(input.vaultRoot),
  );
}

// Returns null when the exact correlation is already recorded. The caller keeps
// this inspection and its audit write within the existing canonical write lock.
export async function inspectInboxDocumentDefaultPromotion({
  vaultRoot,
  ...rawCorrelation
}: Omit<InboxDocumentDefaultPromotionCorrelation, "eventId"> & {
  vaultRoot: string;
}): Promise<InboxDocumentDefaultPromotionCorrelation | null> {
  const documentId = assertContractId(
    rawCorrelation.documentId,
    ID_PREFIXES.document,
    "documentId",
  );
  const auditRecords = await loadExactDocumentAuditRecords(vaultRoot);
  const canonicalEventIds = new Set<string>();
  for (const record of auditRecords) {
    if (
      record.commandName !== DOCUMENT_SOURCE_AUDIT_COMMAND
      || record.status !== "success"
      || record.targetIds?.length !== 3
      || record.targetIds[1] !== documentId
    ) {
      continue;
    }
    try {
      canonicalEventIds.add(assertContractId(record.targetIds[2], ID_PREFIXES.event, "eventId"));
    } catch {
      // A damaged source-owner audit cannot authorize a new correlation.
    }
  }
  if (canonicalEventIds.size !== 1) {
    throw new TypeError(
      "Inbox document promotion correlation requires exactly one canonical document import owner",
    );
  }
  const correlation = normalizeInboxDocumentDefaultPromotionCorrelation({
    ...rawCorrelation,
    documentId,
    eventId: [...canonicalEventIds][0] ?? "",
  });
  const targetIds = [
    correlation.captureId,
    correlation.attachmentId,
    correlation.documentId,
    correlation.eventId,
  ];
  if (new Set(targetIds).size !== targetIds.length) {
    throw new TypeError("Inbox document promotion correlation targets must be distinct");
  }
  const existingCorrelations = auditRecords
    .map(parseInboxDocumentDefaultPromotionAuditRecord)
    .filter((candidate): candidate is InboxDocumentDefaultPromotionCorrelation =>
      candidate !== null
    )
    .filter((candidate) =>
      candidate.captureId === correlation.captureId
      && candidate.attachmentId === correlation.attachmentId
    );
  if (existingCorrelations.length > 0) {
    if (existingCorrelations.every((existing) =>
      existing.documentId === correlation.documentId
      && existing.eventId === correlation.eventId
    )) {
      return null;
    }
    throw new TypeError(
      "Inbox document promotion correlation already belongs to a different canonical owner",
    );
  }

  return correlation;
}

async function loadExactDocumentEventLedgerEntries(
  vaultRoot: string,
): Promise<ExactDocumentEventLedgerEntry[]> {
  const entries: ExactDocumentEventLedgerEntry[] = [];
  for (const relativePath of await listEventLedgerShardPaths(vaultRoot)) {
    for (const rawRecord of await readEventLedgerShardRecords({ vaultRoot, relativePath })) {
      const parsed = safeParseContract(eventRecordSchema, rawRecord);
      const rawEventId = typeof rawRecord === "object"
        && rawRecord !== null
        && "id" in rawRecord
        && typeof rawRecord.id === "string"
        ? rawRecord.id
        : null;
      entries.push({
        event: parsed.success ? parsed.data : null,
        rawEventId,
        relativePath,
      });
    }
  }
  return entries;
}

async function inspectExactSourceAuditEvidence(input: {
  auditRecords?: readonly AuditRecord[];
  vaultRoot: string;
  sourceReceipt: CommittedPayloadReceipt;
}): Promise<{
  completionTargetEventIds: ReadonlySet<string>;
  documentIdsByEventId: ReadonlyMap<string, string>;
}> {
  const targetId = buildRawSourceReceiptTarget(input.sourceReceipt);
  const completionTargetEventIds = new Set<string>();
  const documentIdsByEventId = new Map<string, string>();

  const auditRecords = input.auditRecords ?? await loadExactDocumentAuditRecords(input.vaultRoot);
  for (const record of auditRecords) {
    const targetIds = record.targetIds ?? [];
    if (record.status !== "success" || !targetIds.includes(targetId)) {
      continue;
    }
    if (record.commandName === DOCUMENT_SOURCE_AUDIT_COMMAND) {
      let documentId: string;
      let eventId: string;
      try {
        if (targetIds.length !== 3 || targetIds[0] !== targetId) {
          throw new TypeError("source receipt audit must retain exactly one owner");
        }
        documentId = assertContractId(targetIds[1], ID_PREFIXES.document, "documentId");
        eventId = assertContractId(targetIds[2], ID_PREFIXES.event, "eventId");
      } catch {
        rejectDamagedExactDocumentEvidence({
          documentId: typeof targetIds[1] === "string" ? targetIds[1] : "unknown",
          reason: "source receipt audit does not retain one valid document owner",
        });
      }
      const existing = documentIdsByEventId.get(eventId);
      if (existing && existing !== documentId) {
        rejectDamagedExactDocumentEvidence({
          documentId,
          reason: "source receipt audit assigns one event to multiple document owners",
        });
      }
      documentIdsByEventId.set(eventId, documentId);
      continue;
    }
    if (record.commandName === WORKOUT_SOURCE_IMPORT_AUDIT_COMMAND) {
      for (const candidate of targetIds.slice(1)) {
        try {
          completionTargetEventIds.add(assertContractId(candidate, ID_PREFIXES.event, "eventId"));
        } catch {
          // The bounded audit target list may contain non-event context.
        }
      }
    }
  }

  return {
    completionTargetEventIds,
    documentIdsByEventId,
  };
}

async function inspectExactDocumentSourceSet(input: {
  auditRecords?: readonly AuditRecord[];
  eventLedgerEntries?: readonly ExactDocumentEventLedgerEntry[];
  vaultRoot: string;
  sourceReceipt: CommittedPayloadReceipt;
}): Promise<ExactDocumentSourceSet> {
  const auditEvidence = await inspectExactSourceAuditEvidence({
    auditRecords: input.auditRecords,
    vaultRoot: input.vaultRoot,
    sourceReceipt: input.sourceReceipt,
  });
  const emptyActivityIndex = new Map<string, ReadonlySet<string>>();
  if (
    auditEvidence.documentIdsByEventId.size === 0
    && auditEvidence.completionTargetEventIds.size === 0
  ) {
    return {
      activityEventIdsByRawRef: emptyActivityIndex,
      completionAuditEventIds: new Set<string>(),
      deletedExactSourceExists: false,
      liveSources: [],
    };
  }

  const eventLedgerEntries = input.eventLedgerEntries
    ?? await loadExactDocumentEventLedgerEntries(input.vaultRoot);
  const entries: EventSpineEntry<DocumentEventRecord>[] = [];
  const activityEventIds = new Set<string>();
  const activityEventIdsByRawRef = new Map<string, Set<string>>();
  for (const entry of eventLedgerEntries) {
    if (!entry.event) {
      if (entry.rawEventId && auditEvidence.documentIdsByEventId.has(entry.rawEventId)) {
        rejectDamagedExactDocumentEvidence({
          documentId: auditEvidence.documentIdsByEventId.get(entry.rawEventId) ?? "unknown",
          reason: "source receipt audit points to a contract-invalid document event",
        });
      }
      continue;
    }
    if (
      entry.event.kind === "document"
      && auditEvidence.documentIdsByEventId.has(entry.event.id)
    ) {
      entries.push({ relativePath: entry.relativePath, record: entry.event });
    }
    if (entry.event.kind === "activity_session") {
      activityEventIds.add(entry.event.id);
      for (const rawRef of collectEventRawReferencePaths(entry.event)) {
        const ids = activityEventIdsByRawRef.get(rawRef) ?? new Set<string>();
        ids.add(entry.event.id);
        activityEventIdsByRawRef.set(rawRef, ids);
      }
    }
  }

  const completionAuditEventIds = new Set(
    [...auditEvidence.completionTargetEventIds].filter((eventId) =>
      activityEventIds.has(eventId)
    ),
  );
  if (auditEvidence.documentIdsByEventId.size === 0) {
    if (completionAuditEventIds.size > 0) {
      rejectDamagedExactDocumentEvidence({
        documentId: "unknown",
        reason: "whole-source completion survives without its source receipt owner",
      });
    }
    return {
      activityEventIdsByRawRef,
      completionAuditEventIds,
      deletedExactSourceExists: false,
      liveSources: [],
    };
  }

  // Exact-source identity needs the latest revision even when it is a
  // tombstone. The ordinary collapse helper intentionally removes deleted
  // records, which would make a deleted source look like it never existed.
  const latestDocuments = new Map<string, EventSpineEntry<DocumentEventRecord>>();
  for (const entry of entries) {
    const current = latestDocuments.get(entry.record.id);
    if (!current || compareEventSpineEntries(current, entry) < 0) {
      latestDocuments.set(entry.record.id, entry);
    }
  }
  // The content-derived import audit owns source recreation identity. Its
  // document/event targets select the lifecycle row; that row derives the one
  // manifest and raw artifact to verify. No vault-wide manifest discovery or
  // compatibility reader participates in the decision.
  const claims = new Map<string, {
    entry: EventSpineEntry<DocumentEventRecord>;
    raw: EventAttachment;
  }>();
  for (const [eventId, documentId] of auditEvidence.documentIdsByEventId) {
    let origin: EventSpineEntry<DocumentEventRecord> | null = null;
    let raw: EventAttachment | null = null;
    for (const entry of entries) {
      if (entry.record.id !== eventId || entry.record.documentId !== documentId) {
        continue;
      }
      const candidateRaw = entry.record.attachments?.find((attachment) =>
        attachment.role === "source_document"
        && attachment.sha256 === input.sourceReceipt.sha256
      );
      if (
        candidateRaw
        && (!origin || compareEventSpineEntries(entry, origin) < 0)
      ) {
        origin = entry;
        raw = candidateRaw;
      }
    }
    if (!origin || !raw) {
      rejectDamagedExactDocumentEvidence({
        documentId,
        reason: "source receipt audit has no matching canonical document event",
      });
    }
    claims.set(eventId, { entry: origin, raw });
  }

  const verified = new Map<string, {
    latest: EventSpineEntry<DocumentEventRecord>;
    manifestPath: string;
    raw: EventAttachment;
  }>();
  for (const claim of [...claims.values()]
    .sort((left, right) => left.entry.record.id.localeCompare(right.entry.record.id))) {
    const documentId = claim.entry.record.documentId;
    const manifestPath = resolveRawManifestPath({
      artifacts: [claim.raw],
      importId: documentId,
      importedAt: claim.entry.record.recordedAt,
    });
    const latest = latestDocuments.get(claim.entry.record.id);
    if (
      !latest
      || latest.record.documentId !== documentId
      || !claim.entry.record.rawRefs?.includes(claim.raw.relativePath)
    ) {
      rejectDamagedExactDocumentEvidence({
        documentId,
        manifestPath,
        reason: "canonical document history does not retain one stable source owner",
      });
    }

    let manifestText: string;
    try {
      manifestText = await readUtf8File(input.vaultRoot, manifestPath);
    } catch (error) {
      if (error instanceof VaultError && error.code === "VAULT_FILE_MISSING") {
        rejectDamagedExactDocumentEvidence({
          documentId,
          manifestPath,
          reason: "required raw manifest is missing",
        });
      }
      throw error;
    }

    let manifest: ReturnType<typeof parseRawImportManifest>;
    try {
      manifest = parseRawImportManifest(JSON.parse(manifestText));
    } catch {
      rejectDamagedExactDocumentEvidence({
        documentId,
        manifestPath,
        reason: "required raw manifest is malformed",
      });
    }

    const sourceArtifacts = manifest.artifacts.filter((artifact) =>
      artifact.role === "source_document"
    );
    const artifact = sourceArtifacts[0];
    let resolvedManifestPath: string | null = null;
    try {
      resolvedManifestPath = resolveRawManifestPath({
        artifacts: manifest.artifacts,
        rawDirectory: manifest.rawDirectory,
        importId: manifest.importId,
        importedAt: manifest.importedAt,
      });
    } catch {
      // The shared resolver supplies the semantic owner/directory check below.
    }
    if (
      manifest.importKind !== "document"
      || manifest.importId !== documentId
      || manifest.importedAt !== claim.entry.record.recordedAt
      || manifest.owner.kind !== "document"
      || manifest.owner.id !== documentId
      || !rawDirectoryMatchesOwner(manifest.rawDirectory, manifest.owner)
      || resolvedManifestPath !== manifestPath
      || sourceArtifacts.length !== 1
      || !artifact
      || artifact.relativePath !== claim.raw.relativePath
      || artifact.originalFileName !== claim.raw.originalFileName
      || artifact.mediaType !== claim.raw.mediaType
      || artifact.byteSize !== input.sourceReceipt.byteLength
      || artifact.sha256 !== input.sourceReceipt.sha256
    ) {
      rejectDamagedExactDocumentEvidence({
        documentId,
        manifestPath,
        reason: "raw manifest does not match its canonical document owner",
      });
    }
    const integrity = await statAndHashVaultFile(input.vaultRoot, artifact.relativePath);
    if (!integrity) {
      throw new VaultError(
        "RAW_REFERENCE_MISSING",
        "Preserved exact source evidence is missing its immutable raw artifact. Exact reuse will not create a replacement identity.",
        { documentId, manifestPath, relativePath: artifact.relativePath },
      );
    }
    if (
      integrity.byteSize !== artifact.byteSize
      || integrity.sha256 !== artifact.sha256
    ) {
      rejectDamagedExactDocumentEvidence({
        documentId,
        manifestPath,
        reason: "raw artifact bytes do not match the immutable manifest",
      });
    }

    const latestRaw = latest.record.attachments?.find((attachment) =>
      attachment.role === "source_document"
      && attachment.relativePath === artifact.relativePath
      && attachment.sha256 === artifact.sha256
    );
    if (!latest.record.rawRefs?.includes(artifact.relativePath) || !latestRaw) {
      rejectDamagedExactDocumentEvidence({
        documentId,
        manifestPath,
        reason: "latest document lifecycle no longer retains its source attachment",
      });
    }
    verified.set(claim.entry.record.id, {
      latest,
      manifestPath,
      raw: claim.raw,
    });
  }

  // A deleted identity must fence the whole exact-byte equivalence set. An
  // ordinary import may have created a live alias later, but returning that
  // alias would reset raw-reference-scoped workout completion.
  const deletedExactSourceExists = [...verified.values()].some(({ latest }) =>
    isDeletedEventSpineRecord(latest.record)
  );

  const liveSources: ExactDocumentSource[] = [];
  for (const stored of verified.values()) {
    const entry = stored.latest;
    if (isDeletedEventSpineRecord(entry.record)) {
      continue;
    }
    liveSources.push({
      rawRef: stored.raw.relativePath,
      result: {
        created: false,
        documentId: entry.record.documentId,
        raw: {
          relativePath: stored.raw.relativePath,
          originalFileName: stored.raw.originalFileName,
          mediaType: stored.raw.mediaType,
        },
        event: entry.record,
        eventPath: entry.relativePath,
        auditPath: null,
        manifestPath: stored.manifestPath,
      },
    });
  }

  return {
    activityEventIdsByRawRef,
    completionAuditEventIds,
    deletedExactSourceExists,
    liveSources,
  };
}

export async function findExactDocumentImport(input: {
  vaultRoot: string;
  sourceReceipt: CommittedPayloadReceipt;
}): Promise<(ImportDocumentResult & { created: false }) | null> {
  const exactSources = await inspectExactDocumentSourceSet(input);
  if (exactSources.deletedExactSourceExists) {
    throw new VaultError(
      "DOCUMENT_EXACT_SOURCE_DELETED",
      "An exact source document existed but was deleted. Exact reuse will not create a replacement identity.",
    );
  }
  return exactSources.liveSources[0]?.result ?? null;
}

export async function listLiveExactDocumentImportEvidence(input: {
  sources: readonly CommittedPayloadReceipt[];
  vaultRoot: string;
}): Promise<LiveExactDocumentImportEvidenceGroup[]> {
  const receiptsByTargetId = new Map<string, CommittedPayloadReceipt>();
  for (const sourceReceipt of input.sources) {
    receiptsByTargetId.set(buildRawSourceReceiptTarget(sourceReceipt), sourceReceipt);
  }
  if (receiptsByTargetId.size === 0) {
    return [];
  }

  const auditRecords = await loadExactDocumentAuditRecords(input.vaultRoot);
  const targetIds = new Set(receiptsByTargetId.keys());
  const hasRelevantAuditEvidence = auditRecords.some((record) =>
    record.targetIds?.some((targetId) => targetIds.has(targetId)) === true
  );
  const defaultPromotionsByEventId = new Map<
    string,
    InboxDocumentDefaultPromotionCorrelation[]
  >();
  if (hasRelevantAuditEvidence) {
    for (const promotion of resolveInboxDocumentDefaultPromotionCorrelations(auditRecords)) {
      const promotions = defaultPromotionsByEventId.get(promotion.eventId) ?? [];
      promotions.push(promotion);
      defaultPromotionsByEventId.set(promotion.eventId, promotions);
    }
  }
  const eventLedgerEntries = hasRelevantAuditEvidence
    ? await loadExactDocumentEventLedgerEntries(input.vaultRoot)
    : [];
  const groups: LiveExactDocumentImportEvidenceGroup[] = [];
  for (const sourceReceipt of receiptsByTargetId.values()) {
    let exactSources: ExactDocumentSourceSet;
    try {
      exactSources = await inspectExactDocumentSourceSet({
        auditRecords,
        eventLedgerEntries,
        sourceReceipt,
        vaultRoot: input.vaultRoot,
      });
    } catch (error) {
      if (error instanceof VaultError) {
        groups.push({ ...sourceReceipt, evidence: null });
        continue;
      }
      throw error;
    }
    groups.push({
      ...sourceReceipt,
      evidence: exactSources.deletedExactSourceExists
        ? null
        : exactSources.liveSources.map(({ rawRef, result }) => ({
            defaultPromotions: [
              ...(defaultPromotionsByEventId.get(result.event.id) ?? []),
            ].filter((promotion) => promotion.documentId === result.documentId),
            documentId: result.documentId,
            manifestPath: result.manifestPath,
            rawRef,
          })),
    });
  }
  return groups;
}

export const WORKOUT_SOURCE_IMPORT_STATUS_VALUES = [
  "not_imported",
  "completed",
  "partial_conflict",
] as const;

export type WorkoutSourceImportStatus =
  (typeof WORKOUT_SOURCE_IMPORT_STATUS_VALUES)[number];

export async function inspectWorkoutSourceImportStatus(input: {
  vaultRoot: string;
  rawRef: string;
}): Promise<{ status: WorkoutSourceImportStatus; completionTargetId: string }> {
  const sourceIntegrity = await statAndHashVaultFile(input.vaultRoot, input.rawRef);
  if (sourceIntegrity === null) {
    throw new VaultError(
      "EVENT_BATCH_SOURCE_RAW_REF_MISSING",
      "The workout source does not exist as a vault file.",
    );
  }

  const sourceReceipt = {
    byteLength: sourceIntegrity.byteSize,
    sha256: sourceIntegrity.sha256,
  };
  const exactSources = await inspectExactDocumentSourceSet({
    vaultRoot: input.vaultRoot,
    sourceReceipt,
  });
  if (!exactSources.liveSources.some((source) => source.rawRef === input.rawRef)) {
    throw new VaultError(
      "EVENT_BATCH_SOURCE_DOCUMENT_NOT_LIVE",
      "The workout source is no longer owned by a live source document.",
    );
  }
  if (exactSources.deletedExactSourceExists) {
    throw new VaultError(
      "DOCUMENT_EXACT_SOURCE_DELETED",
      "An exact source document existed but was deleted. Workout import will not reuse a replacement identity.",
    );
  }

  const completionTargetId = buildRawSourceReceiptTarget(sourceReceipt);
  const exactRawRefs = new Set(exactSources.liveSources.map((source) => source.rawRef));
  const sourceEventIds = new Set<string>();
  for (const rawRef of exactRawRefs) {
    for (const eventId of exactSources.activityEventIdsByRawRef.get(rawRef) ?? []) {
      sourceEventIds.add(eventId);
    }
  }
  if ([...exactSources.completionAuditEventIds].some((eventId) => sourceEventIds.has(eventId))) {
    return { status: "completed", completionTargetId };
  }

  return {
    status: sourceEventIds.size > 0 ? "partial_conflict" : "not_imported",
    completionTargetId,
  };
}

export async function resolveWorkoutSourceImportStatus(input: {
  vaultRoot: string;
  rawRef: string;
}): Promise<WorkoutSourceImportStatus> {
  return (await inspectWorkoutSourceImportStatus(input)).status;
}
