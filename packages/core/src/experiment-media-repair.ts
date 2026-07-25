import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  EXPERIMENTS_DIRECTORY,
  ID_PREFIXES,
  rawImportManifestSchema,
  safeParseContract,
  type EventRecord,
  type ExperimentFrontmatter,
} from "@murphai/contracts";

import { commitAuditedCanonicalWrite } from "./audited-write.ts";
import { addCapture } from "./domains/events/attachment-backed.ts";
import {
  findEventByExternalRef,
  loadEventLedgerShardsById,
  selectLatestMatchedEvent,
} from "./domains/events/ledger.ts";
import { readExperimentFrontmatterDocument } from "./domains/experiments.ts";
import { VaultError } from "./errors.ts";
import {
  scanExperimentStorage,
  type ExperimentStorageEntry,
} from "./experiment-storage.ts";
import { readJsonFile } from "./fs.ts";
import { deterministicContractId } from "./ids.ts";
import { resolveRawManifestPath } from "./operations/raw-manifests.ts";
import { resolveVaultPath } from "./path-safety.ts";
import { safeStatAndHashVaultFile } from "./raw-artifact-integrity.ts";
import { rawDirectoryMatchesOwner } from "./raw.ts";

const REPAIR_SCHEMA = "murph.experiment-media-repair.v1";
const REPAIR_EXTERNAL_SYSTEM = "murph-repair";
const REPAIR_EXTERNAL_RESOURCE_TYPE = "experiment-media";
const REPAIR_EXTERNAL_VERSION = "1";
const REPAIR_TAG = "experiment-media-repair";
const REPAIR_ROLE = "experiment-media";
const RESULT_EXAMPLE_LIMIT = 20;

const SUPPORTED_MEDIA_EXTENSIONS = new Set([
  ".gif",
  ".jpeg",
  ".jpg",
  ".m4a",
  ".mov",
  ".mp3",
  ".mp4",
  ".png",
  ".wav",
  ".webm",
  ".webp",
]);

export interface RepairExperimentMediaInput {
  apply?: boolean;
  now?: Date;
  vaultRoot: string;
}

export interface ExperimentMediaRepairBlocker {
  code: string;
  message: string;
  relativePath?: string;
}

export interface RepairExperimentMediaResult {
  auditPaths: string[];
  blockerCount: number;
  blockerExamples: ExperimentMediaRepairBlocker[];
  blockersByCode: Record<string, number>;
  candidateBytes: number;
  candidateCount: number;
  candidateExamples: Array<{
    experimentSlug: string;
    relativePath: string;
    sizeBytes: number;
  }>;
  createdCaptureCount: number;
  deletedFileCount: number;
  hasWork: boolean;
  mode: "apply" | "dry-run";
  mutated: boolean;
  removedLegacyBytes: number;
  reusedCaptureCount: number;
  rewrittenDocumentCount: number;
}

interface ExperimentDocument {
  attributes: ExperimentFrontmatter;
  rawDocument: string;
  relativePath: string;
}

interface ExperimentMediaCandidate {
  eventId: string;
  experiment: ExperimentDocument;
  externalRef: {
    resourceId: string;
    resourceType: typeof REPAIR_EXTERNAL_RESOURCE_TYPE;
    system: typeof REPAIR_EXTERNAL_SYSTEM;
    version: typeof REPAIR_EXTERNAL_VERSION;
  };
  modifiedAt: string;
  relativePath: string;
  sha256: string;
  sizeBytes: number;
  sourcePath: string;
}

interface ExperimentMediaDetection {
  blockers: ExperimentMediaRepairBlocker[];
  candidates: ExperimentMediaCandidate[];
  documents: ExperimentDocument[];
}

interface TextRange {
  end: number;
  start: number;
}

interface VerifiedCapture {
  attachmentPath: string;
  eventId: string;
}

function blocker(
  code: string,
  message: string,
  relativePath?: string,
): ExperimentMediaRepairBlocker {
  return {
    code,
    message,
    ...(relativePath ? { relativePath } : {}),
  };
}

function experimentMediaRepairIdentity(input: {
  experimentId: string;
  relativePath: string;
  sha256: string;
}): { eventId: string; resourceId: string } {
  const resourceId = createHash("sha256")
    .update(REPAIR_SCHEMA)
    .update("\0")
    .update(input.experimentId)
    .update("\0")
    .update(input.relativePath)
    .update("\0")
    .update(input.sha256)
    .digest("hex");

  return {
    eventId: deterministicContractId(
      ID_PREFIXES.event,
      `${REPAIR_SCHEMA}:${resourceId}`,
    ),
    resourceId,
  };
}

async function readExperimentDocuments(input: {
  blockers: ExperimentMediaRepairBlocker[];
  entries: readonly ExperimentStorageEntry[];
  vaultRoot: string;
}): Promise<ExperimentDocument[]> {
  const documents: ExperimentDocument[] = [];

  for (const relativePath of input.entries
    .filter((entry) => entry.entryKind === "file" && entry.fileKind === "document")
    .map((entry) => entry.relativePath)) {
    try {
      const document = await readExperimentFrontmatterDocument(
        input.vaultRoot,
        relativePath,
      );
      documents.push({
        attributes: document.document.attributes,
        rawDocument: document.rawDocument,
        relativePath,
      });
    } catch (error) {
      input.blockers.push(blocker(
        error instanceof VaultError && error.code === "EXPERIMENT_DOCUMENT_PATH_MISMATCH"
          ? error.code
          : "EXPERIMENT_DOCUMENT_INVALID",
        error instanceof Error
          ? error.message
          : "Experiment document could not be read.",
        relativePath,
      ));
    }
  }

  return documents;
}

function indexExperimentDocuments(documents: readonly ExperimentDocument[]): {
  byId: Map<string, ExperimentDocument[]>;
  bySlug: Map<string, ExperimentDocument[]>;
} {
  const byId = new Map<string, ExperimentDocument[]>();
  const bySlug = new Map<string, ExperimentDocument[]>();

  for (const document of documents) {
    const idMatches = byId.get(document.attributes.experimentId) ?? [];
    idMatches.push(document);
    byId.set(document.attributes.experimentId, idMatches);

    const slugMatches = bySlug.get(document.attributes.slug) ?? [];
    slugMatches.push(document);
    bySlug.set(document.attributes.slug, slugMatches);
  }

  return { byId, bySlug };
}

function associatedExperimentForEntry(
  entry: ExperimentStorageEntry,
  documents: readonly ExperimentDocument[],
):
  | { kind: "ambiguous" }
  | { kind: "missing" }
  | {
      document: ExperimentDocument;
      kind: "matched";
    } {
  const referencedBy = documents.filter((document) =>
    collectExactPathLiteralMentions(document.rawDocument, entry.relativePath).length > 0
  );
  if (referencedBy.length === 0) {
    return { kind: "missing" };
  }
  if (referencedBy.length > 1) {
    return { kind: "ambiguous" };
  }
  const document = referencedBy[0];
  if (!document) {
    return { kind: "missing" };
  }
  return {
    document,
    kind: "matched",
  };
}

async function candidateFromEntry(input: {
  blockers: ExperimentMediaRepairBlocker[];
  entry: ExperimentStorageEntry;
  experiment: ExperimentDocument;
  vaultRoot: string;
}): Promise<ExperimentMediaCandidate | null> {
  const extension = path.posix.extname(input.entry.relativePath).toLowerCase();
  if (!SUPPORTED_MEDIA_EXTENSIONS.has(extension)) {
    input.blockers.push(blocker(
      "EXPERIMENT_MEDIA_UNSUPPORTED",
      "Only supported image, video, and audio files can be promoted to captures automatically.",
      input.entry.relativePath,
    ));
    return null;
  }

  const integrity = await safeStatAndHashVaultFile(
    input.vaultRoot,
    input.entry.relativePath,
  );
  if (integrity.kind !== "ok") {
    input.blockers.push(blocker(
      integrity.kind === "invalid" ? integrity.code : "EXPERIMENT_MEDIA_MISSING",
      integrity.kind === "invalid"
        ? integrity.message
        : "Experiment media disappeared while it was being inspected.",
      input.entry.relativePath,
    ));
    return null;
  }

  const identity = experimentMediaRepairIdentity({
    experimentId: input.experiment.attributes.experimentId,
    relativePath: input.entry.relativePath,
    sha256: integrity.integrity.sha256,
  });
  const modifiedAt = input.entry.modifiedAt ?? new Date(0).toISOString();
  const sourcePath = resolveVaultPath(
    input.vaultRoot,
    input.entry.relativePath,
  ).absolutePath;
  return {
    eventId: identity.eventId,
    experiment: input.experiment,
    externalRef: {
      resourceId: identity.resourceId,
      resourceType: REPAIR_EXTERNAL_RESOURCE_TYPE,
      system: REPAIR_EXTERNAL_SYSTEM,
      version: REPAIR_EXTERNAL_VERSION,
    },
    modifiedAt,
    relativePath: input.entry.relativePath,
    sha256: integrity.integrity.sha256,
    sizeBytes: integrity.integrity.byteSize,
    sourcePath,
  };
}

function codePointBefore(value: string, index: number): string | undefined {
  return Array.from(value.slice(0, index)).at(-1);
}

function codePointAt(value: string, index: number): string | undefined {
  return Array.from(value.slice(index))[0];
}

function isExactPathContinuationCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}_~%/\\?#&@+=-]/u.test(value);
}

function hasBoundarySafeExactPath(
  document: string,
  start: number,
  end: number,
): boolean {
  const before = codePointBefore(document, start);
  if (before === "." || isExactPathContinuationCharacter(before)) {
    return false;
  }

  const after = codePointAt(document, end);
  if (isExactPathContinuationCharacter(after)) {
    return false;
  }
  if (after !== ".") {
    return true;
  }

  let cursor = end;
  while (document[cursor] === ".") {
    cursor += 1;
  }
  return !isExactPathContinuationCharacter(codePointAt(document, cursor));
}

function collectBoundarySafeLiteralMentions(
  document: string,
  literal: string,
): TextRange[] {
  if (!literal) {
    return [];
  }

  const mentions: TextRange[] = [];
  let searchStart = 0;
  while (searchStart < document.length) {
    const start = document.indexOf(literal, searchStart);
    if (start < 0) {
      break;
    }
    const end = start + literal.length;
    if (hasBoundarySafeExactPath(document, start, end)) {
      mentions.push({ end, start });
    }
    searchStart = end;
  }
  return mentions;
}

function collectExactPathLiteralMentions(
  document: string,
  exactPath: string,
): TextRange[] {
  return exactPath.startsWith("bank/experiments/")
    ? collectBoundarySafeLiteralMentions(document, exactPath)
    : [];
}

function maskTextRanges(document: string, ranges: readonly TextRange[]): string {
  const masked = document.split("");
  for (const range of ranges) {
    for (let index = range.start; index < range.end; index += 1) {
      masked[index] = " ";
    }
  }
  return masked.join("");
}

function residualReferenceSpellings(
  documentPath: string,
  sourcePath: string,
): string[] {
  const relativePath = path.posix.relative(
    path.posix.dirname(documentPath),
    sourcePath,
  );
  const spellings = new Set([
    sourcePath,
    relativePath,
    `./${relativePath}`,
    path.posix.basename(sourcePath),
  ]);

  for (const spelling of [...spellings]) {
    spellings.add(spelling.replaceAll("/", "\\"));
    spellings.add(encodeURI(spelling));
  }
  return [...spellings];
}

function analyzeExperimentMediaReferences(
  documents: readonly ExperimentDocument[],
  candidates: readonly ExperimentMediaCandidate[],
): ExperimentMediaRepairBlocker[] {
  const blockers: ExperimentMediaRepairBlocker[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (
      collectExactPathLiteralMentions(
        candidate.experiment.rawDocument,
        candidate.relativePath,
      ).length === 0
    ) {
      blockers.push(blocker(
        "EXPERIMENT_MEDIA_REFERENCE_MISSING",
        "Misplaced experiment media must have a byte-exact full vault-relative path in its one canonical experiment document.",
        candidate.relativePath,
      ));
    }
  }

  for (const document of documents) {
    const provedRanges = candidates.flatMap((candidate) =>
      collectExactPathLiteralMentions(
        document.rawDocument,
        candidate.relativePath,
      )
    );
    const unprovedDocument = maskTextRanges(document.rawDocument, provedRanges);
    const foldedDocument = unprovedDocument.normalize("NFC").toLowerCase();

    for (const candidate of candidates) {
      const spellings = residualReferenceSpellings(
        document.relativePath,
        candidate.relativePath,
      );
      const hasResidualReference = spellings.some((spelling) =>
        collectBoundarySafeLiteralMentions(unprovedDocument, spelling).length > 0
        || collectBoundarySafeLiteralMentions(
          foldedDocument,
          spelling.normalize("NFC").toLowerCase(),
        ).length > 0
      );
      if (!hasResidualReference) {
        continue;
      }

      const key = `${document.relativePath}\0${candidate.relativePath}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      blockers.push(blocker(
        "EXPERIMENT_MEDIA_REFERENCE_UNSUPPORTED",
        "A legacy experiment media path appears outside its proved byte-exact full-path literal and requires manual review.",
        document.relativePath,
      ));
    }
  }

  return blockers;
}

function rewriteExperimentMediaReferences(input: {
  candidates: readonly ExperimentMediaCandidate[];
  documents: readonly ExperimentDocument[];
  verified: ReadonlyMap<string, VerifiedCapture>;
}): Array<{
  content: string;
  expectedTargetReceipt: { byteLength: number; sha256: string };
  relativePath: string;
}> {
  const targetBySource = new Map<string, string>();
  for (const candidate of input.candidates) {
    const verified = input.verified.get(candidate.relativePath);
    if (verified) {
      targetBySource.set(candidate.relativePath, verified.attachmentPath);
    }
  }

  const writes: Array<{
    content: string;
    expectedTargetReceipt: { byteLength: number; sha256: string };
    relativePath: string;
  }> = [];
  for (const document of input.documents) {
    const replacements: Array<{ end: number; start: number; value: string }> = [];

    for (const candidate of input.candidates) {
      if (candidate.experiment.relativePath !== document.relativePath) {
        continue;
      }
      const target = targetBySource.get(candidate.relativePath);
      if (!target) {
        continue;
      }
      for (const mention of collectExactPathLiteralMentions(
        document.rawDocument,
        candidate.relativePath,
      )) {
        replacements.push({
          end: mention.end,
          start: mention.start,
          value: target,
        });
      }
    }
    replacements.sort((left, right) => right.start - left.start);

    let content = document.rawDocument;
    for (const replacement of replacements) {
      content = `${content.slice(0, replacement.start)}${replacement.value}${content.slice(replacement.end)}`;
    }

    if (content !== document.rawDocument) {
      writes.push({
        content,
        expectedTargetReceipt: {
          byteLength: Buffer.byteLength(document.rawDocument, "utf8"),
          sha256: createHash("sha256")
            .update(document.rawDocument, "utf8")
            .digest("hex"),
        },
        relativePath: document.relativePath,
      });
    }
  }

  return writes;
}

async function detectExperimentMedia(
  vaultRoot: string,
): Promise<ExperimentMediaDetection> {
  const blockers: ExperimentMediaRepairBlocker[] = [];
  const entries = await scanExperimentStorage(vaultRoot);
  const documents = await readExperimentDocuments({ blockers, entries, vaultRoot });
  const index = indexExperimentDocuments(documents);
  for (const [experimentId, matches] of index.byId) {
    if (matches.length > 1) {
      blockers.push(blocker(
        "EXPERIMENT_DOCUMENT_ID_DUPLICATE",
        `More than one canonical experiment document declares id ${experimentId}.`,
      ));
    }
  }
  for (const [slug, matches] of index.bySlug) {
    if (matches.length > 1) {
      blockers.push(blocker(
        "EXPERIMENT_DOCUMENT_SLUG_DUPLICATE",
        `More than one canonical experiment document declares slug ${slug}.`,
      ));
    }
  }
  const candidates: ExperimentMediaCandidate[] = [];

  for (const entry of entries) {
    if (entry.entryKind === "file" && entry.fileKind !== "unsupported") {
      continue;
    }
    if (entry.entryKind === "symlink") {
      blockers.push(blocker(
        "EXPERIMENT_STORAGE_SYMLINK",
        "Symbolic links under experiment storage require manual review.",
        entry.relativePath,
      ));
      continue;
    }
    if (entry.entryKind === "special") {
      blockers.push(blocker(
        "EXPERIMENT_STORAGE_SPECIAL_FILE",
        "Non-regular files under experiment storage require manual review.",
        entry.relativePath,
      ));
      continue;
    }

    const association = associatedExperimentForEntry(entry, documents);
    if (association.kind === "missing") {
      blockers.push(blocker(
        "EXPERIMENT_MEDIA_UNASSOCIATED",
        "Misplaced experiment files must have a boundary-safe, byte-exact full vault-relative path in exactly one canonical experiment document.",
        entry.relativePath,
      ));
      continue;
    }
    if (association.kind === "ambiguous") {
      blockers.push(blocker(
        "EXPERIMENT_MEDIA_ASSOCIATION_AMBIGUOUS",
        "The legacy media path is associated with more than one canonical experiment.",
        entry.relativePath,
      ));
      continue;
    }

    const candidate = await candidateFromEntry({
      blockers,
      entry,
      experiment: association.document,
      vaultRoot,
    });
    if (candidate) {
      candidates.push(candidate);
    }
  }

  blockers.push(...analyzeExperimentMediaReferences(documents, candidates));
  return { blockers, candidates, documents };
}

function captureConflict(
  candidate: ExperimentMediaCandidate,
  message: string,
): ExperimentMediaRepairBlocker {
  return blocker(
    "EXPERIMENT_MEDIA_CAPTURE_CONFLICT",
    message,
    candidate.relativePath,
  );
}

function eventMatchesRepairIdentity(
  event: EventRecord,
  candidate: ExperimentMediaCandidate,
): boolean {
  const externalRef = event.externalRef;
  return (
    event.id === candidate.eventId
    && externalRef?.system === candidate.externalRef.system
    && externalRef.resourceType === candidate.externalRef.resourceType
    && externalRef.resourceId === candidate.externalRef.resourceId
    && externalRef.version === candidate.externalRef.version
  );
}

async function verifyCanonicalCapture(
  vaultRoot: string,
  candidate: ExperimentMediaCandidate,
  event: EventRecord,
): Promise<VerifiedCapture | ExperimentMediaRepairBlocker> {
  if (
    event.kind !== "note"
    || !event.tags?.includes("capture")
    || !event.tags.includes(REPAIR_TAG)
    || event.experimentId !== candidate.experiment.attributes.experimentId
    || event.experimentSlug !== candidate.experiment.attributes.slug
    || !event.links?.some((link) =>
      link.type === "related_to"
      && link.targetId === candidate.experiment.attributes.experimentId
    )
    || !eventMatchesRepairIdentity(event, candidate)
  ) {
    return captureConflict(
      candidate,
      "The deterministic repair identity already exists but is not the expected experiment capture.",
    );
  }

  const matchingAttachments = event.attachments?.filter((attachment) =>
    attachment.role === REPAIR_ROLE
    && attachment.sha256 === candidate.sha256
    && event.rawRefs?.includes(attachment.relativePath)
  ) ?? [];
  if (
    event.source !== "import"
    || event.attachments?.length !== 1
    || event.rawRefs?.length !== 1
    || matchingAttachments.length !== 1
  ) {
    return captureConflict(
      candidate,
      "The existing repair capture does not have exactly one matching canonical attachment.",
    );
  }

  const attachment = matchingAttachments[0];
  if (!attachment) {
    return captureConflict(candidate, "The existing repair capture attachment is missing.");
  }
  const rawDirectory = path.posix.dirname(attachment.relativePath);
  if (!rawDirectoryMatchesOwner(rawDirectory, { kind: "capture", id: event.id })) {
    return captureConflict(
      candidate,
      "The existing repair capture attachment is outside its canonical capture directory.",
    );
  }

  const integrity = await safeStatAndHashVaultFile(vaultRoot, attachment.relativePath);
  if (
    integrity.kind !== "ok"
    || integrity.integrity.sha256 !== candidate.sha256
    || integrity.integrity.byteSize !== candidate.sizeBytes
  ) {
    return captureConflict(
      candidate,
      "The existing repair capture attachment failed byte-for-byte verification.",
    );
  }

  const manifestPath = resolveRawManifestPath({
    artifacts: [{ relativePath: attachment.relativePath }],
    importId: event.id,
    importedAt: event.occurredAt,
  });
  let manifestValue: unknown;
  try {
    manifestValue = await readJsonFile(vaultRoot, manifestPath);
  } catch {
    return captureConflict(
      candidate,
      "The existing repair capture has no readable canonical raw manifest.",
    );
  }
  const parsedManifest = safeParseContract(rawImportManifestSchema, manifestValue);
  const manifestArtifact = parsedManifest.success
    && parsedManifest.data.artifacts.length === 1
    ? parsedManifest.data.artifacts[0]
    : null;
  if (
    !parsedManifest.success
    || parsedManifest.data.owner.kind !== "capture"
    || parsedManifest.data.owner.id !== event.id
    || parsedManifest.data.importId !== event.id
    || parsedManifest.data.importKind !== "capture"
    || parsedManifest.data.importedAt !== event.occurredAt
    || parsedManifest.data.source !== REPAIR_EXTERNAL_SYSTEM
    || parsedManifest.data.provenance.schema !== REPAIR_SCHEMA
    || parsedManifest.data.provenance.experimentId !== candidate.experiment.attributes.experimentId
    || parsedManifest.data.provenance.experimentSlug !== candidate.experiment.attributes.slug
    || parsedManifest.data.provenance.originalRelativePath !== candidate.relativePath
    || parsedManifest.data.provenance.sourceByteSize !== candidate.sizeBytes
    || parsedManifest.data.provenance.sourceSha256 !== candidate.sha256
    || parsedManifest.data.provenance.timestampSource !== "file-mtime"
    || !manifestArtifact
    || manifestArtifact.role !== REPAIR_ROLE
    || manifestArtifact.relativePath !== attachment.relativePath
    || manifestArtifact.sha256 !== candidate.sha256
    || manifestArtifact.byteSize !== candidate.sizeBytes
  ) {
    return captureConflict(
      candidate,
      "The existing repair capture has no matching canonical raw manifest.",
    );
  }

  return {
    attachmentPath: attachment.relativePath,
    eventId: event.id,
  };
}

async function inspectExistingCapture(
  vaultRoot: string,
  candidate: ExperimentMediaCandidate,
): Promise<
  | { kind: "conflict"; blocker: ExperimentMediaRepairBlocker }
  | { kind: "missing" }
  | { kind: "verified"; capture: VerifiedCapture }
> {
  const [byExternalRef, matchedShards] = await Promise.all([
    findEventByExternalRef({ vaultRoot, ...candidate.externalRef }),
    loadEventLedgerShardsById(vaultRoot, candidate.eventId),
  ]);
  const byId = selectLatestMatchedEvent(matchedShards)?.record ?? null;

  if (byExternalRef && byExternalRef.id !== candidate.eventId) {
    return {
      blocker: captureConflict(
        candidate,
        "The repair external reference is already owned by another event.",
      ),
      kind: "conflict",
    };
  }
  if (byId && byId.lifecycle?.state === "deleted") {
    return {
      blocker: captureConflict(
        candidate,
        "The deterministic repair capture was deleted and will not be revived automatically.",
      ),
      kind: "conflict",
    };
  }
  if (!byExternalRef && byId) {
    return {
      blocker: captureConflict(
        candidate,
        "The deterministic repair event id is already owned by an unrelated event.",
      ),
      kind: "conflict",
    };
  }
  if (!byExternalRef) {
    return { kind: "missing" };
  }

  const verified = await verifyCanonicalCapture(vaultRoot, candidate, byExternalRef);
  return "code" in verified
    ? { blocker: verified, kind: "conflict" }
    : { capture: verified, kind: "verified" };
}

async function createAndVerifyCapture(
  vaultRoot: string,
  candidate: ExperimentMediaCandidate,
): Promise<VerifiedCapture> {
  const sourceIntegrity = await safeStatAndHashVaultFile(
    vaultRoot,
    candidate.relativePath,
  );
  if (
    sourceIntegrity.kind !== "ok"
    || sourceIntegrity.integrity.sha256 !== candidate.sha256
    || sourceIntegrity.integrity.byteSize !== candidate.sizeBytes
  ) {
    throw new VaultError(
      "EXPERIMENT_MEDIA_SOURCE_CHANGED",
      "Source media changed before it could be copied and was left in place.",
      { relativePath: candidate.relativePath },
    );
  }

  try {
    await addCapture({
      vaultRoot,
      draft: {
        externalRef: candidate.externalRef,
        experimentId: candidate.experiment.attributes.experimentId,
        experimentSlug: candidate.experiment.attributes.slug,
        id: candidate.eventId,
        links: [{
          type: "related_to",
          targetId: candidate.experiment.attributes.experimentId,
        }],
        note: "Recovered misplaced media through the canonical experiment capture repair.",
        occurredAt: candidate.modifiedAt,
        source: "import",
        tags: [REPAIR_TAG],
        title: "Recovered experiment media",
      },
      attachments: [{
        allowExistingMatch: true,
        expectedSourceReceipt: {
          byteLength: candidate.sizeBytes,
          sha256: candidate.sha256,
        },
        role: REPAIR_ROLE,
        sourcePath: candidate.sourcePath,
        targetName: path.posix.basename(candidate.relativePath),
      }],
      rawImport: {
        importId: candidate.eventId,
        importedAt: candidate.modifiedAt,
        importKind: "capture",
        provenance: {
          experimentId: candidate.experiment.attributes.experimentId,
          experimentSlug: candidate.experiment.attributes.slug,
          originalRelativePath: candidate.relativePath,
          schema: REPAIR_SCHEMA,
          sourceByteSize: candidate.sizeBytes,
          sourceSha256: candidate.sha256,
          timestampSource: "file-mtime",
        },
        source: REPAIR_EXTERNAL_SYSTEM,
      },
    });
  } catch (error) {
    if (error instanceof VaultError && error.code === "OPERATION_PRECONDITION_FAILED") {
      throw new VaultError(
        "EXPERIMENT_MEDIA_SOURCE_CHANGED",
        "Source media changed before it could be copied and was left in place.",
        { relativePath: candidate.relativePath },
      );
    }
    throw error;
  }

  const stored = await findEventByExternalRef({ vaultRoot, ...candidate.externalRef });
  if (!stored) {
    throw new VaultError(
      "EXPERIMENT_MEDIA_CAPTURE_INVALID",
      "The canonical capture write completed without a readable event.",
      { relativePath: candidate.relativePath },
    );
  }
  const verified = await verifyCanonicalCapture(vaultRoot, candidate, stored);
  if ("code" in verified) {
    throw new VaultError(verified.code, verified.message, {
      relativePath: candidate.relativePath,
    });
  }
  return verified;
}

/**
 * Removes the legacy directories a promotion just emptied, deepest first.
 *
 * Promotion deletes files but the directories that held them are not vault
 * content, so nothing else ever reclaims them. Leaving them behind is what
 * turned a completed repair into residue that later readers had to tolerate.
 * `rmdir` succeeds only on an empty directory, so a directory that still holds
 * anything is left exactly as it is.
 */
async function removeEmptiedLegacyDirectories(
  vaultRoot: string,
  deletedRelativePaths: readonly string[],
): Promise<void> {
  const directories = new Set<string>();
  for (const deletedRelativePath of deletedRelativePaths) {
    let current = path.posix.dirname(deletedRelativePath);
    while (current.startsWith(`${EXPERIMENTS_DIRECTORY}/`)) {
      directories.add(current);
      current = path.posix.dirname(current);
    }
  }

  const depth = (relativePath: string): number => relativePath.split("/").length;
  for (const relativePath of [...directories].sort((left, right) =>
    depth(right) - depth(left)
  )) {
    try {
      await fs.rmdir(resolveVaultPath(vaultRoot, relativePath).absolutePath);
    } catch {
      // Still populated, already gone, or concurrently reused.
    }
  }
}

function summarizeBlockers(
  blockers: readonly ExperimentMediaRepairBlocker[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of blockers) {
    counts[entry.code] = (counts[entry.code] ?? 0) + 1;
  }
  return counts;
}

function resultFromDetection(input: {
  auditPaths?: string[];
  blockers?: ExperimentMediaRepairBlocker[];
  createdCaptureCount?: number;
  deletedFileCount?: number;
  detection: ExperimentMediaDetection;
  mode: "apply" | "dry-run";
  mutated?: boolean;
  removedLegacyBytes?: number;
  reusedCaptureCount?: number;
  rewrittenDocumentCount?: number;
}): RepairExperimentMediaResult {
  const blockers = input.blockers ?? input.detection.blockers;
  return {
    auditPaths: input.auditPaths ?? [],
    blockerCount: blockers.length,
    blockerExamples: blockers.slice(0, RESULT_EXAMPLE_LIMIT),
    blockersByCode: summarizeBlockers(blockers),
    candidateBytes: input.detection.candidates.reduce(
      (total, candidate) => total + candidate.sizeBytes,
      0,
    ),
    candidateCount: input.detection.candidates.length,
    candidateExamples: input.detection.candidates
      .slice(0, RESULT_EXAMPLE_LIMIT)
      .map((candidate) => ({
        experimentSlug: candidate.experiment.attributes.slug,
        relativePath: candidate.relativePath,
        sizeBytes: candidate.sizeBytes,
      })),
    createdCaptureCount: input.createdCaptureCount ?? 0,
    deletedFileCount: input.deletedFileCount ?? 0,
    hasWork: input.detection.candidates.length > 0 || blockers.length > 0,
    mode: input.mode,
    mutated: input.mutated ?? false,
    removedLegacyBytes: input.removedLegacyBytes ?? 0,
    reusedCaptureCount: input.reusedCaptureCount ?? 0,
    rewrittenDocumentCount: input.rewrittenDocumentCount ?? 0,
  };
}

export async function repairExperimentMediaInternal(
  input: RepairExperimentMediaInput,
): Promise<RepairExperimentMediaResult> {
  const mode = input.apply ? "apply" : "dry-run";
  const detection = await detectExperimentMedia(input.vaultRoot);
  if (!input.apply || detection.blockers.length > 0 || detection.candidates.length === 0) {
    return resultFromDetection({ detection, mode });
  }

  const existingCaptures = new Map<string, VerifiedCapture>();
  const missingCandidates: ExperimentMediaCandidate[] = [];
  const preflightBlockers: ExperimentMediaRepairBlocker[] = [];
  for (const candidate of detection.candidates) {
    const existing = await inspectExistingCapture(input.vaultRoot, candidate);
    if (existing.kind === "conflict") {
      preflightBlockers.push(existing.blocker);
    } else if (existing.kind === "verified") {
      existingCaptures.set(candidate.relativePath, existing.capture);
    } else {
      missingCandidates.push(candidate);
    }
  }
  if (preflightBlockers.length > 0) {
    return resultFromDetection({
      blockers: preflightBlockers,
      detection,
      mode,
      reusedCaptureCount: existingCaptures.size,
    });
  }

  const verifiedCaptures = new Map(existingCaptures);
  for (const candidate of missingCandidates) {
    verifiedCaptures.set(
      candidate.relativePath,
      await createAndVerifyCapture(input.vaultRoot, candidate),
    );
  }

  const changedSourceBlockers: ExperimentMediaRepairBlocker[] = [];
  for (const candidate of detection.candidates) {
    const integrity = await safeStatAndHashVaultFile(
      input.vaultRoot,
      candidate.relativePath,
    );
    if (
      integrity.kind !== "ok"
      || integrity.integrity.sha256 !== candidate.sha256
      || integrity.integrity.byteSize !== candidate.sizeBytes
    ) {
      changedSourceBlockers.push(blocker(
        "EXPERIMENT_MEDIA_SOURCE_CHANGED",
        "Source media changed after capture verification and was left in place.",
        candidate.relativePath,
      ));
    }
  }
  if (changedSourceBlockers.length > 0) {
    return resultFromDetection({
      blockers: changedSourceBlockers,
      createdCaptureCount: missingCandidates.length,
      detection,
      mode,
      mutated: missingCandidates.length > 0,
      reusedCaptureCount: existingCaptures.size,
    });
  }

  const documentWrites = rewriteExperimentMediaReferences({
    candidates: detection.candidates,
    documents: detection.documents,
    verified: verifiedCaptures,
  });
  const occurredAt = input.now ?? new Date();
  const deletion = await commitAuditedCanonicalWrite({
    audit: {
      action: "vault_repair",
      commandName: "core.repairExperimentMedia",
      occurredAt,
      summary: `Promoted ${detection.candidates.length} misplaced experiment media files to canonical captures.`,
      targetIds: [...new Set([
        ...[...verifiedCaptures.values()].map((capture) => capture.eventId),
        ...detection.candidates.map((candidate) =>
          candidate.experiment.attributes.experimentId
        ),
      ])].slice(0, 50),
    },
    mutate: async ({ batch }) => {
      for (const documentWrite of documentWrites) {
        await batch.stageTextWrite(
          documentWrite.relativePath,
          documentWrite.content,
          {
            expectedTargetReceipt: documentWrite.expectedTargetReceipt,
            overwrite: true,
          },
        );
      }
      for (const candidate of detection.candidates) {
        await batch.stageDelete(candidate.relativePath, {
          expectedTargetReceipt: {
            byteLength: candidate.sizeBytes,
            sha256: candidate.sha256,
          },
        });
      }

      return {
        changes: [
          ...documentWrites.map((entry) => ({
            op: "update" as const,
            path: entry.relativePath,
          })),
          ...detection.candidates.map((candidate) => ({
            op: "delete" as const,
            path: candidate.relativePath,
          })),
        ],
        result: true,
      };
    },
    occurredAt,
    operationType: "experiment_media_repair",
    summary: "Promote misplaced experiment media and remove verified legacy copies",
    vaultRoot: input.vaultRoot,
  });

  await removeEmptiedLegacyDirectories(
    input.vaultRoot,
    detection.candidates.map((candidate) => candidate.relativePath),
  );

  return resultFromDetection({
    auditPaths: [deletion.auditPath],
    createdCaptureCount: missingCandidates.length,
    deletedFileCount: detection.candidates.length,
    detection,
    mode,
    mutated: true,
    removedLegacyBytes: detection.candidates.reduce(
      (total, candidate) => total + candidate.sizeBytes,
      0,
    ),
    reusedCaptureCount: existingCaptures.size,
    rewrittenDocumentCount: documentWrites.length,
  });
}
