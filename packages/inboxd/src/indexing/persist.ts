import path from "node:path";
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  assertContract,
  inboxCaptureRecordSchema,
  type InboxAttachmentRetentionRecord,
  type InboxCaptureRecord as CanonicalInboxCaptureRecord,
} from "@murphai/contracts";
import {
  acquireCanonicalWriteLock,
  applyCanonicalWriteBatch,
  type CanonicalRawContentInput,
  loadVault,
  listWriteOperationMetadataPaths,
  readJsonlRecords,
  readStoredWriteOperation,
  VAULT_LAYOUT,
  walkVaultFiles,
  withCanonicalWriteLockScope,
} from "@murphai/core";

import type { InboundCapture, StoredAttachment, StoredCapture } from "../contracts/capture.ts";
import {
  buildAttachmentId,
  createDeterministicInboxCaptureId,
  createInboxCaptureIdentityKey,
  normalizeStoredAttachments,
  normalizeRelativePath,
  resolveVaultPath,
  sanitizeFileName,
} from "../shared.ts";
import {
  replaceInboxCaptureProjection,
  type InboxCaptureProjectionAttachment,
  type InboxCaptureProjectionStoredCapture,
  type InboxRuntimeStore,
} from "../kernel/sqlite.ts";
import {
  buildInboxCaptureDirectory,
  buildInboxEnvelopePath,
  buildUnstoredAttachment,
  type PersistableInboundAttachment,
  stripEphemeralAttachmentFields,
} from "./capture-shape.js";
import {
  INBOX_CAPTURE_LEDGER_DIRECTORY,
  buildInboxCaptureLedgerPathForOccurredAt,
  buildInboxCaptureRecord,
} from "./persist/canonical-records.js";
import { normalizeAttachmentForStorage } from "./attachment-storage-normalizer.js";
import { normalizeRawMetadataForStorage } from "./raw-metadata-storage-normalizer.js";
import { listInboxParserManifestPathsNewestFirst } from "./parser-derivatives.js";
import { listInboxAttachmentRetentionRecords } from "./retention.js";
export interface PersistCanonicalInboxCaptureInput {
  vaultRoot: string;
  captureId: string;
  eventId: string;
  input: InboundCapture;
  storedAt?: string;
}

export interface StoredCaptureEnvelope {
  schema: "murph.inbox-envelope.v1";
  captureId: string;
  eventId: string;
  storedAt: string;
  input: InboundCapture;
  stored: StoredCapture;
}

interface PreparedRawCapturePersistence {
  stored: StoredCapture;
  sanitizedInput: InboundCapture;
  rawContents: CanonicalRawContentInput[];
}

interface EnvelopeEntry {
  relativePath: string;
  envelope: StoredCaptureEnvelope;
}

interface RecoverableInboxCaptureOperation {
  capturePath: string;
  envelopePath: string;
  updatedAt: string;
}

type StoredWriteOperation = Awaited<ReturnType<typeof readStoredWriteOperation>>;

interface ParserProjection {
  derivedPath: string;
  extractedText: string | null;
  parseState: "succeeded";
  parseUpdatedAt: string | null;
  parserProviderId: string | null;
  transcriptText: string | null;
}

const MAX_INBOX_CAPTURE_ATTACHMENT_COUNT = 64;
const MAX_INBOX_CAPTURE_ATTACHMENT_BYTES = 128 * 1024 * 1024;
const MAX_INBOX_CAPTURE_TOTAL_ATTACHMENT_BYTES = 512 * 1024 * 1024;

export interface PersistCanonicalInboxCaptureResult {
  stored: StoredCapture;
  capture: {
    relativePath: string;
    record: CanonicalInboxCaptureRecord;
  };
}

export async function ensureInboxVault(vaultRoot: string): Promise<void> {
  await loadVault({ vaultRoot });
}

function buildSanitizedInboundCapture(
  input: InboundCapture,
  storedAttachments?: ReadonlyArray<StoredAttachment>,
): InboundCapture {
  return {
    ...input,
    accountId: input.accountId ?? null,
    attachments: input.attachments.map((attachment, index) => {
      const sanitizedAttachment = stripEphemeralAttachmentFields(attachment);
      const storedAttachment = storedAttachments?.[index];

      if (!storedAttachment) {
        return {
          ...sanitizedAttachment,
          originalPath: null,
        };
      }

      return {
        externalId: storedAttachment.externalId ?? null,
        kind: storedAttachment.kind,
        mime: storedAttachment.mime ?? null,
        originalPath: null,
        fileName: storedAttachment.fileName ?? null,
        byteSize: storedAttachment.byteSize ?? null,
      };
    }),
    raw: normalizeRawMetadataForStorage(input.raw),
  };
}

async function resolveTrustedAttachmentSourcePath(input: {
  originalPath: string;
}): Promise<string | null> {
  const sourceAbsolutePath = path.resolve(input.originalPath);
  let canonicalSourcePath: string;

  try {
    canonicalSourcePath = await realpath(sourceAbsolutePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }

  const trustedRoots = await listTrustedAttachmentRoots();

  return trustedRoots.some((root) => isPathWithinRoot(root, canonicalSourcePath))
    ? canonicalSourcePath
    : null;
}

async function listTrustedAttachmentRoots(): Promise<string[]> {
  const rootCandidates = [path.resolve(tmpdir())];
  const trustedRoots: string[] = [];

  for (const rootCandidate of rootCandidates) {
    try {
      trustedRoots.push(await realpath(rootCandidate));
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }

  return trustedRoots;
}

function isPathWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);

  return (
    relative === "" ||
    (
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
    )
  );
}

async function prepareRawCapturePersistence({
  captureId,
  eventId,
  input,
  storedAt = new Date().toISOString(),
}: Omit<PersistCanonicalInboxCaptureInput, "vaultRoot">): Promise<PreparedRawCapturePersistence> {
  const sourceDirectory = buildInboxCaptureDirectory(input, captureId);
  const attachmentDirectory = path.posix.join(sourceDirectory, "attachments");
  const storedAttachments: StoredAttachment[] = [];
  const rawContents: CanonicalRawContentInput[] = [];
  let totalAttachmentBytes = 0;

  if (input.attachments.length > MAX_INBOX_CAPTURE_ATTACHMENT_COUNT) {
    throw new RangeError(
      `Inbox capture exceeded ${MAX_INBOX_CAPTURE_ATTACHMENT_COUNT} attachments.`,
    );
  }

  for (const [index, attachment] of input.attachments.entries()) {
    const ordinal = index + 1;
    const attachmentId = buildAttachmentId(captureId, ordinal);
    const sanitizedAttachment = stripEphemeralAttachmentFields(attachment);

    if (!attachment.originalPath && !attachment.data) {
      storedAttachments.push(
        buildUnstoredAttachment({
          attachment: removeRawImageSizeForStorage(sanitizedAttachment),
          attachmentId,
          ordinal,
        }),
      );
      continue;
    }

    const sourceAbsolutePath =
      !attachment.data && attachment.originalPath
        ? await resolveTrustedAttachmentSourcePath({
            originalPath: attachment.originalPath,
          })
        : null;
    const safeName = sanitizeFileName(
      attachment.fileName ??
        (sourceAbsolutePath ? path.basename(sourceAbsolutePath) : null) ??
        attachment.externalId ??
        `attachment-${ordinal}`,
      `attachment-${ordinal}`,
    );
    if (attachment.data) {
      totalAttachmentBytes = addInboxCaptureAttachmentBytesToBudget({
        byteLength: readAttachmentDataByteLength(attachment.data),
        totalAttachmentBytes,
      });
      const snapshotBytes = Uint8Array.from(attachment.data);
      const prepared = await prepareStoredAttachmentBytes({
        attachment,
        attachmentDirectory,
        attachmentId,
        ordinal,
        safeName,
        sourceBytes: snapshotBytes,
      });
      if (prepared) {
        rawContents.push(prepared.rawContent);
        storedAttachments.push(prepared.storedAttachment);
      } else {
        storedAttachments.push(
          buildUnstoredAttachment({
            attachment: removeRawImageSizeForStorage(sanitizedAttachment),
            attachmentId,
            ordinal,
          }),
        );
      }
    } else if (attachment.originalPath) {
      if (!sourceAbsolutePath) {
        storedAttachments.push(
          buildUnstoredAttachment({
            attachment: removeRawImageSizeForStorage(sanitizedAttachment),
            attachmentId,
            ordinal,
          }),
        );
        continue;
      }

      try {
        const sourceStats = await stat(sourceAbsolutePath);

        if (!sourceStats.isFile()) {
          storedAttachments.push(
            buildUnstoredAttachment({
              attachment: removeRawImageSizeForStorage(sanitizedAttachment),
              attachmentId,
              ordinal,
            }),
          );
          continue;
        }

        totalAttachmentBytes = addInboxCaptureAttachmentBytesToBudget({
          byteLength: sourceStats.size,
          totalAttachmentBytes,
        });
        const snapshotBytes = await readFile(sourceAbsolutePath);
        const prepared = await prepareStoredAttachmentBytes({
          attachment,
          attachmentDirectory,
          attachmentId,
          ordinal,
          safeName,
          sourceBytes: snapshotBytes,
        });
        if (prepared) {
          rawContents.push(prepared.rawContent);
          storedAttachments.push(prepared.storedAttachment);
        } else {
          storedAttachments.push(
            buildUnstoredAttachment({
              attachment: removeRawImageSizeForStorage(sanitizedAttachment),
              attachmentId,
              ordinal,
            }),
          );
        }
      } catch (error) {
        if (!isMissingFileError(error)) {
          throw error;
        }

        storedAttachments.push(
          buildUnstoredAttachment({
            attachment: removeRawImageSizeForStorage(sanitizedAttachment),
            attachmentId,
            ordinal,
          }),
        );
        continue;
      }
    }
  }

  const envelopePath = buildInboxEnvelopePath(input, captureId);

  const storedCapture: StoredCapture = {
    captureId,
    eventId,
    storedAt,
    sourceDirectory,
    envelopePath,
    attachments: storedAttachments,
  };

  const sanitizedInput = buildSanitizedInboundCapture(input, storedAttachments);

  rawContents.push({
    targetRelativePath: storedCapture.envelopePath,
    content: `${JSON.stringify(
      {
        schema: "murph.inbox-envelope.v1",
        captureId,
        eventId,
        storedAt,
        input: sanitizedInput,
        stored: storedCapture,
      },
      null,
      2,
    )}
`,
    originalFileName: "envelope.json",
    mediaType: "application/json",
    allowExistingMatch: true,
  });

  return {
    stored: storedCapture,
    sanitizedInput,
    rawContents,
  };
}

function removeRawImageSizeForStorage(
  attachment: PersistableInboundAttachment,
): PersistableInboundAttachment {
  if (attachment.kind !== "image") {
    return attachment;
  }

  return {
    ...attachment,
    byteSize: null,
  };
}

async function prepareStoredAttachmentBytes(input: {
  attachment: InboundCapture["attachments"][number];
  attachmentDirectory: string;
  attachmentId: string;
  ordinal: number;
  safeName: string;
  sourceBytes: Uint8Array;
}): Promise<{
  rawContent: CanonicalRawContentInput;
  storedAttachment: StoredAttachment;
} | null> {
  const sanitizedAttachment = stripEphemeralAttachmentFields(input.attachment);
  const originalFileName = input.attachment.fileName ?? input.safeName;
  const originalMediaType = input.attachment.mime ?? "application/octet-stream";
  const normalized = await normalizeAttachmentForStorage({
    attachment: input.attachment,
    bytes: input.sourceBytes,
    fileName: originalFileName,
    mediaType: originalMediaType,
  });

  if (!normalized) {
    return null;
  }

  const storedFileName = normalized.normalized
    ? normalized.fileName
    : originalFileName;
  const storedSafeName = normalized.normalized
    ? sanitizeFileName(normalized.fileName, `attachment-${input.ordinal}`)
    : input.safeName;
  const storedMime = normalized.normalized
    ? normalized.mediaType
    : sanitizedAttachment.mime ?? null;
  const relativePath = normalizeRelativePath(
    path.posix.join(
      input.attachmentDirectory,
      `${String(input.ordinal).padStart(2, "0")}__${storedSafeName}`,
    ),
  );
  const sha256 = createHash("sha256").update(normalized.bytes).digest("hex");

  return {
    rawContent: {
      targetRelativePath: relativePath,
      content: normalized.bytes,
      originalFileName: storedSafeName,
      mediaType: normalized.mediaType,
      allowExistingMatch: true,
    },
    storedAttachment: {
      ...sanitizedAttachment,
      attachmentId: input.attachmentId,
      ordinal: input.ordinal,
      storedPath: relativePath,
      fileName: storedFileName,
      mime: storedMime,
      byteSize: normalized.bytes.byteLength,
      sha256,
      originalPath: null,
    },
  };
}

function readAttachmentDataByteLength(data: ArrayLike<number>): number {
  return typeof data.length === "number" ? data.length : 0;
}

function addInboxCaptureAttachmentBytesToBudget(input: {
  byteLength: number;
  totalAttachmentBytes: number;
}): number {
  if (input.byteLength > MAX_INBOX_CAPTURE_ATTACHMENT_BYTES) {
    throw new RangeError(
      `Inbox capture attachment exceeded ${MAX_INBOX_CAPTURE_ATTACHMENT_BYTES} bytes.`,
    );
  }

  const nextTotal = input.totalAttachmentBytes + input.byteLength;
  if (nextTotal > MAX_INBOX_CAPTURE_TOTAL_ATTACHMENT_BYTES) {
    throw new RangeError(
      `Inbox capture attachments exceeded ${MAX_INBOX_CAPTURE_TOTAL_ATTACHMENT_BYTES} total bytes.`,
    );
  }

  return nextTotal;
}

export async function persistCanonicalInboxCapture({
  vaultRoot,
  captureId,
  eventId,
  input,
  storedAt = new Date().toISOString(),
}: PersistCanonicalInboxCaptureInput): Promise<PersistCanonicalInboxCaptureResult> {
  const prepared = await prepareRawCapturePersistence({
    captureId,
    eventId,
    input,
    storedAt,
  });
  const capturePath = buildInboxCaptureLedgerPathForOccurredAt(input.occurredAt);
  const captureRecord = buildInboxCaptureRecord({
    eventId,
    inbound: prepared.sanitizedInput,
    stored: prepared.stored,
  });

  await applyCanonicalWriteBatch({
    vaultRoot,
    operationType: "inbox_capture_persist",
    summary: `Persist inbox capture ${captureId}`,
    occurredAt: prepared.stored.storedAt,
    audit: {
      action: "inbox_capture_persist",
      commandName: "inboxd.persistCanonicalInboxCapture",
      summary: `Persisted inbox capture ${captureId}.`,
      targetIds: [captureId, eventId],
    },
    rawContents: prepared.rawContents,
    jsonlAppends: [
      {
        relativePath: capturePath,
        record: captureRecord,
      },
    ],
  });

  return {
    stored: prepared.stored,
    capture: {
      relativePath: capturePath,
      record: captureRecord,
    },
  };
}

export async function findStoredCaptureEnvelope(input: {
  vaultRoot: string;
  inbound: InboundCapture;
  captureId?: string;
}): Promise<StoredCaptureEnvelope | null> {
  const captureId = input.captureId ?? createDeterministicInboxCaptureId(input.inbound);
  const storedRecord = await findStoredInboxCaptureRecord({
    vaultRoot: input.vaultRoot,
    inbound: input.inbound,
    captureId,
  });

  if (storedRecord) {
    const retainedAttachments = await readRetainedAttachmentMap(input.vaultRoot);
    const envelope = inboxCaptureRecordToStoredCaptureEnvelope(storedRecord, retainedAttachments);
    return {
      ...envelope,
      stored: await hydrateAttachmentParserProjections({
        retainedAttachments,
        stored: envelope.stored,
        vaultRoot: input.vaultRoot,
      }),
    };
  }

  const recoverableOperations = await listRecoverableInboxCaptureOperations(input.vaultRoot);
  return await findRecoverableRawCaptureEnvelope({
    vaultRoot: input.vaultRoot,
    inbound: input.inbound,
    captureId,
    recoverableOperations,
  });
}

export async function ensureStoredCaptureCanonicalEvidence(input: {
  vaultRoot: string;
  envelope: StoredCaptureEnvelope;
}): Promise<void> {
  const relativePath = buildInboxCaptureLedgerPathForOccurredAt(input.envelope.input.occurredAt);

  await withCanonicalWriteLockScope(input.vaultRoot, async () => {
    const lock = await acquireCanonicalWriteLock(input.vaultRoot);

    try {
      const records = await readInboxCaptureRecordsIfPresent({
        vaultRoot: input.vaultRoot,
        relativePath,
      });
      const identityKey = createInboxCaptureIdentityKey(input.envelope.input);

      if (selectMatchingInboxCaptureRecord(records, identityKey, input.envelope.captureId)) {
        return;
      }

      await applyCanonicalWriteBatch({
        vaultRoot: input.vaultRoot,
        operationType: "inbox_capture_canonical_evidence",
        summary: `Ensure canonical evidence for inbox capture ${input.envelope.captureId}`,
        occurredAt: input.envelope.stored.storedAt,
        audit: {
          action: "inbox_capture_canonical_evidence",
          commandName: "inboxd.ensureStoredCaptureCanonicalEvidence",
          summary: `Ensured canonical inbox evidence for capture ${input.envelope.captureId}.`,
          targetIds: [input.envelope.captureId, input.envelope.eventId],
        },
        jsonlAppends: [
          {
            relativePath,
            record: buildInboxCaptureRecord({
              eventId: input.envelope.eventId,
              inbound: input.envelope.input,
              stored: input.envelope.stored,
            }),
          },
        ],
      });
    } finally {
      await lock.release();
    }
  });
}

export async function rebuildRuntimeFromVault(input: {
  enqueueParserJobs: boolean;
  vaultRoot: string;
  runtime: InboxRuntimeStore;
}): Promise<void> {
  const canonicalRecords = await listCanonicalInboxCaptureRecords(input.vaultRoot);
  const retainedAttachments = await readRetainedAttachmentMap(input.vaultRoot);
  const restoredIdentityKeys = new Set<string>();
  const projectionEntries: Array<{
    captureId: string;
    eventId: string;
    input: InboundCapture;
    stored: InboxCaptureProjectionStoredCapture;
  }> = [];

  for (const record of canonicalRecords) {
    const envelope = inboxCaptureRecordToStoredCaptureEnvelope(record, retainedAttachments);
    projectionEntries.push({
      captureId: envelope.captureId,
      eventId: envelope.eventId,
      input: envelope.input,
      stored: await hydrateAttachmentParserProjections({
        retainedAttachments,
        stored: envelope.stored,
        vaultRoot: input.vaultRoot,
      }),
    });
    restoredIdentityKeys.add(record.identityKey);
  }

  const recoverableOperations = await listRecoverableInboxCaptureOperations(input.vaultRoot);
  const recoveredEnvelopes = await listRecoverableRawCaptureEnvelopes(
    input.vaultRoot,
    restoredIdentityKeys,
    recoverableOperations,
  );

  for (const envelope of recoveredEnvelopes) {
    await ensureStoredCaptureCanonicalEvidence({
      vaultRoot: input.vaultRoot,
      envelope,
    });
    projectionEntries.push({
      captureId: envelope.captureId,
      eventId: envelope.eventId,
      input: envelope.input,
      stored: envelope.stored,
    });
    restoredIdentityKeys.add(createInboxCaptureIdentityKey(envelope.input));
  }

  replaceInboxCaptureProjection({
    databasePath: input.runtime.databasePath,
    enqueueParserJobs: input.enqueueParserJobs,
    entries: projectionEntries,
  });
}

async function readRetainedAttachmentMap(
  vaultRoot: string,
): Promise<Map<string, InboxAttachmentRetentionRecord>> {
  return new Map(
    (await listInboxAttachmentRetentionRecords(vaultRoot))
      .map((record) => [record.attachmentId, record]),
  );
}

async function hydrateAttachmentParserProjections(input: {
  retainedAttachments: ReadonlyMap<string, InboxAttachmentRetentionRecord>;
  stored: StoredCapture;
  vaultRoot: string;
}): Promise<InboxCaptureProjectionStoredCapture> {
  const attachments: InboxCaptureProjectionAttachment[] = [];

  for (const attachment of input.stored.attachments) {
    const retained = input.retainedAttachments.get(attachment.attachmentId);
    const parserProjection = await readAttachmentParserProjection({
      attachment,
      captureId: input.stored.captureId,
      fallbackUpdatedAt: retained?.purgedAt ?? null,
      vaultRoot: input.vaultRoot,
    });
    attachments.push({
      ...attachment,
      ...(parserProjection ?? {}),
    });
  }

  return {
    ...input.stored,
    attachments,
  };
}

async function readAttachmentParserProjection(input: {
  attachment: Pick<StoredAttachment, "attachmentId" | "kind">;
  captureId: string;
  fallbackUpdatedAt: string | null;
  vaultRoot: string;
}): Promise<ParserProjection | null> {
  const manifestPaths = await listInboxParserManifestPathsNewestFirst({
    attachmentId: input.attachment.attachmentId,
    captureId: input.captureId,
    vaultRoot: input.vaultRoot,
  });
  for (const manifestPath of manifestPaths) {
    const projection = await readAttachmentParserProjectionFromManifest({
      ...input,
      manifestPath,
    });
    if (projection) {
      return projection;
    }
  }

  return null;
}

async function readAttachmentParserProjectionFromManifest(input: {
  attachment: Pick<StoredAttachment, "attachmentId" | "kind">;
  captureId: string;
  fallbackUpdatedAt: string | null;
  manifestPath: string;
  vaultRoot: string;
}): Promise<ParserProjection | null> {
  let manifest: Record<string, unknown>;
  try {
    const manifestAbsolutePath = await resolveVaultPath(input.vaultRoot, input.manifestPath);
    manifest = expectRecord(
      JSON.parse(await readFile(manifestAbsolutePath, "utf8")),
      `retained parser manifest at ${input.manifestPath}`,
    );
  } catch {
    return null;
  }

  if (manifest.schema !== "murph.parser-manifest.v1") {
    return null;
  }

  const artifact = expectOptionalRecord(manifest.artifact);
  if (
    !artifact ||
    artifact.captureId !== input.captureId ||
    artifact.attachmentId !== input.attachment.attachmentId
  ) {
    return null;
  }

  const paths = expectOptionalRecord(manifest.paths);
  const plainTextPath = normalizeParserArtifactPath({
    attachmentId: input.attachment.attachmentId,
    captureId: input.captureId,
    pathValue: paths?.plainTextPath,
  });
  if (!plainTextPath) {
    return null;
  }

  let plainText: string;
  try {
    plainText = (await readFile(await resolveVaultPath(input.vaultRoot, plainTextPath), "utf8")).trim();
  } catch {
    return null;
  }
  if (!plainText) {
    return null;
  }

  const transcriptOnly = input.attachment.kind === "audio" || input.attachment.kind === "video";
  return {
    derivedPath: input.manifestPath,
    extractedText: transcriptOnly ? null : plainText,
    parseState: "succeeded",
    parseUpdatedAt: typeof manifest.createdAt === "string" ? manifest.createdAt : input.fallbackUpdatedAt,
    parserProviderId: typeof manifest.providerId === "string" ? manifest.providerId : null,
    transcriptText: transcriptOnly ? plainText : null,
  };
}

function normalizeParserArtifactPath(input: {
  attachmentId: string;
  captureId: string;
  pathValue: unknown;
}): string | null {
  if (typeof input.pathValue !== "string" || !input.captureId) {
    return null;
  }

  let normalized: string;
  try {
    normalized = normalizeRelativePath(input.pathValue);
  } catch {
    return null;
  }

  const attemptsPrefix = path.posix.join(
    "derived/inbox",
    input.captureId,
    "attachments",
    input.attachmentId,
    "attempts",
  );
  return normalized.startsWith(`${attemptsPrefix}/`) ? normalized : null;
}

async function readStoredCaptureEnvelope(input: {
  vaultRoot: string;
  relativePath: string;
}): Promise<StoredCaptureEnvelope | null> {
  const absolutePath = await resolveVaultPath(input.vaultRoot, input.relativePath);

  try {
    return normalizeStoredCaptureEnvelope(
      JSON.parse(await readFile(absolutePath, "utf8")),
      input.relativePath,
    );
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

function normalizeStoredCaptureEnvelope(
  value: unknown,
  relativePath: string,
): StoredCaptureEnvelope {
  const context = `stored inbox envelope at ${relativePath}`;
  const envelope = expectRecord(value, context);

  if (envelope.schema !== "murph.inbox-envelope.v1") {
    throw new TypeError(`Expected canonical "schema" in ${context}.`);
  }

  const inbound = buildSanitizedInboundCapture(
    normalizeStoredCaptureInboundInput(envelope.input, `${context}.input`),
  );
  const captureId = createDeterministicInboxCaptureId(inbound);
  const eventId = requireStringField(envelope, "eventId", context);
  const storedAt = requireStringField(envelope, "storedAt", context);

  if (requireStringField(envelope, "captureId", context) !== captureId) {
    throw new TypeError(`Stored inbox envelope at ${relativePath} must use the deterministic captureId.`);
  }

  const storedRecord = expectRecord(envelope.stored, `${context}.stored`);
  const sourceDirectory = requireStringField(storedRecord, "sourceDirectory", `${context}.stored`);
  const envelopePath = requireStringField(storedRecord, "envelopePath", `${context}.stored`);
  const attachmentsValue = storedRecord.attachments;

  if (!Array.isArray(attachmentsValue)) {
    throw new TypeError(`Expected canonical "attachments" array in ${context}.stored.`);
  }

  if (requireStringField(storedRecord, "captureId", `${context}.stored`) !== captureId) {
    throw new TypeError(`Stored inbox envelope at ${relativePath} has a mismatched stored.captureId.`);
  }

  if (requireStringField(storedRecord, "eventId", `${context}.stored`) !== eventId) {
    throw new TypeError(`Stored inbox envelope at ${relativePath} has a mismatched stored.eventId.`);
  }

  if (requireStringField(storedRecord, "storedAt", `${context}.stored`) !== storedAt) {
    throw new TypeError(`Stored inbox envelope at ${relativePath} has a mismatched stored.storedAt.`);
  }

  const expectedSourceDirectory = buildInboxCaptureDirectory(inbound, captureId);
  if (sourceDirectory !== expectedSourceDirectory) {
    throw new TypeError(`Stored inbox envelope at ${relativePath} has a mismatched stored.sourceDirectory.`);
  }

  const expectedEnvelopePath = buildInboxEnvelopePath(inbound, captureId);
  if (envelopePath !== expectedEnvelopePath) {
    throw new TypeError(`Stored inbox envelope at ${relativePath} has a mismatched stored.envelopePath.`);
  }

  const attachments = normalizeStoredAttachments(
    captureId,
    attachmentsValue,
    `${context}.stored.attachments`,
  ).map((attachment) => {
    const expectedAttachmentId = buildAttachmentId(captureId, attachment.ordinal);

    if (attachment.attachmentId !== expectedAttachmentId) {
      throw new TypeError(
        `Stored inbox envelope at ${relativePath} has a mismatched attachmentId for ordinal ${attachment.ordinal}.`,
      );
    }

    return {
      ...attachment,
      attachmentId: expectedAttachmentId,
      originalPath: null,
    };
  });

  return inboxCaptureRecordToStoredCaptureEnvelope(
    buildInboxCaptureRecord({
      eventId,
      inbound,
      stored: {
        captureId,
        eventId,
        storedAt,
        sourceDirectory,
        envelopePath,
        attachments,
      },
    }),
  );
}

async function readJsonlRecordsIfPresent(input: {
  vaultRoot: string;
  relativePath: string;
}): Promise<unknown[]> {
  try {
    return await readJsonlRecords(input);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "VAULT_FILE_MISSING"
    ) {
      return [];
    }

    throw error;
  }
}

async function listRecoverableRawCaptureEnvelopes(
  vaultRoot: string,
  restoredIdentityKeys: ReadonlySet<string>,
  recoverableOperations: ReadonlyMap<string, RecoverableInboxCaptureOperation>,
): Promise<StoredCaptureEnvelope[]> {
  const selectedByIdentityKey = new Map<string, EnvelopeEntry>();

  for (const relativePath of [...recoverableOperations.keys()].sort()) {
    const envelope = await readRecoverableStoredCaptureEnvelope({ vaultRoot, relativePath });

    if (!envelope) {
      continue;
    }

    const identityKey = createInboxCaptureIdentityKey(envelope.input);
    if (restoredIdentityKeys.has(identityKey)) {
      continue;
    }

    const current = selectedByIdentityKey.get(identityKey);
    const candidate = { relativePath, envelope };

    if (!current || compareEnvelopeEntries(candidate, current) < 0) {
      selectedByIdentityKey.set(identityKey, candidate);
    }
  }

  return [...selectedByIdentityKey.values()].sort(compareEnvelopeEntries).map((entry) => entry.envelope);
}

async function findRecoverableRawCaptureEnvelope(input: {
  vaultRoot: string;
  inbound: InboundCapture;
  captureId: string;
  recoverableOperations: ReadonlyMap<string, RecoverableInboxCaptureOperation>;
}): Promise<StoredCaptureEnvelope | null> {
  const identityKey = createInboxCaptureIdentityKey(input.inbound);
  let selected: EnvelopeEntry | null = null;

  for (const relativePath of [...input.recoverableOperations.keys()].sort()) {
    const envelope = await readRecoverableStoredCaptureEnvelope({
      vaultRoot: input.vaultRoot,
      relativePath,
    });

    if (!envelope) {
      continue;
    }

    if (
      envelope.captureId !== input.captureId &&
      createInboxCaptureIdentityKey(envelope.input) !== identityKey
    ) {
      continue;
    }

    const candidate = { relativePath, envelope };
    if (!selected || compareEnvelopeEntries(candidate, selected) < 0) {
      selected = candidate;
    }
  }

  return selected?.envelope ?? null;
}

async function readRecoverableStoredCaptureEnvelope(input: {
  vaultRoot: string;
  relativePath: string;
}): Promise<StoredCaptureEnvelope | null> {
  try {
    return await readStoredCaptureEnvelope(input);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      return null;
    }

    throw error;
  }
}

async function listRecoverableInboxCaptureOperations(
  vaultRoot: string,
): Promise<Map<string, RecoverableInboxCaptureOperation>> {
  const relativePaths = await listWriteOperationMetadataPaths(vaultRoot);
  const selected = new Map<string, RecoverableInboxCaptureOperation>();

  for (const relativePath of relativePaths) {
    let operation: StoredWriteOperation;

    try {
      operation = await readStoredWriteOperation(vaultRoot, relativePath);
    } catch {
      continue;
    }

    const recoverable = selectRecoverableInboxCaptureOperation(operation);
    if (!recoverable) {
      continue;
    }

    const current = selected.get(recoverable.envelopePath);
    if (!current || current.updatedAt.localeCompare(recoverable.updatedAt) < 0) {
      selected.set(recoverable.envelopePath, recoverable);
    }
  }

  return selected;
}

function selectRecoverableInboxCaptureOperation(
  operation: StoredWriteOperation,
): RecoverableInboxCaptureOperation | null {
  if (operation.operationType !== "inbox_capture_persist") {
    return null;
  }

  if (operation.status === "committed" || operation.status === "rolled_back") {
    return null;
  }

  const envelopeAction = operation.actions.find(
    (action) =>
      action.kind === "raw_copy" &&
      action.targetRelativePath.startsWith(`${VAULT_LAYOUT.rawInboxDirectory}/`) &&
      action.targetRelativePath.endsWith("/envelope.json") &&
      (action.state === "applied" || action.state === "reused"),
  );
  const captureAction = operation.actions.find(
    (action) =>
      action.kind === "jsonl_append" &&
      action.targetRelativePath.startsWith(`${INBOX_CAPTURE_LEDGER_DIRECTORY}/`) &&
      action.state === "staged",
  );

  if (!envelopeAction || !captureAction) {
    return null;
  }

  return {
    envelopePath: envelopeAction.targetRelativePath,
    capturePath: captureAction.targetRelativePath,
    updatedAt: operation.updatedAt,
  };
}

function compareEnvelopeEntries(left: EnvelopeEntry, right: EnvelopeEntry): number {
  const storedAtComparison = left.envelope.stored.storedAt.localeCompare(right.envelope.stored.storedAt);
  if (storedAtComparison !== 0) {
    return storedAtComparison;
  }

  const captureIdComparison = left.envelope.captureId.localeCompare(right.envelope.captureId);
  if (captureIdComparison !== 0) {
    return captureIdComparison;
  }

  return left.relativePath.localeCompare(right.relativePath);
}

function inboxCaptureRecordToStoredCaptureEnvelope(
  record: CanonicalInboxCaptureRecord,
  retainedAttachments: ReadonlyMap<string, { storedPath: string }> = new Map(),
): StoredCaptureEnvelope {
  const input: InboundCapture = {
    source: record.source,
    externalId: record.externalId,
    accountId: record.accountId ?? null,
    thread: {
      id: record.thread.id,
      title: record.thread.title ?? null,
      isDirect: record.thread.isDirect ?? undefined,
    },
    actor: {
      id: record.actor.id ?? null,
      displayName: record.actor.displayName ?? null,
      isSelf: record.actor.isSelf,
    },
    occurredAt: record.occurredAt,
    receivedAt: record.receivedAt ?? null,
    text: record.text ?? null,
    attachments: record.attachments.map((attachment) => ({
      externalId: attachment.externalId ?? null,
      kind: attachment.kind,
      mime: attachment.mime ?? null,
      originalPath: null,
      fileName: attachment.fileName ?? null,
      byteSize: attachment.byteSize ?? null,
    })),
    raw: record.raw,
  };
  const stored: StoredCapture = {
    captureId: record.captureId,
    eventId: record.eventId,
    storedAt: record.recordedAt,
    sourceDirectory: record.sourceDirectory,
    envelopePath: record.envelopePath,
    attachments: record.attachments.map((attachment) => {
      const retained = retainedAttachments.get(attachment.attachmentId);
      const retentionExpired = retained?.storedPath === attachment.storedPath;

      return {
        attachmentId: attachment.attachmentId,
        ordinal: attachment.ordinal,
        externalId: attachment.externalId ?? null,
        kind: attachment.kind,
        mime: attachment.mime ?? null,
        originalPath: null,
        storedPath: retentionExpired ? null : attachment.storedPath ?? null,
        fileName: attachment.fileName ?? null,
        byteSize: attachment.byteSize ?? null,
        sha256: attachment.sha256 ?? null,
        contentStatus: retentionExpired ? "retention_expired" : "available",
      };
    }),
  };
  return {
    schema: "murph.inbox-envelope.v1",
    captureId: record.captureId,
    eventId: record.eventId,
    storedAt: record.recordedAt,
    input,
    stored,
  };
}

async function readInboxCaptureRecordsIfPresent(input: {
  vaultRoot: string;
  relativePath: string;
}): Promise<CanonicalInboxCaptureRecord[]> {
  const records = await readJsonlRecordsIfPresent(input);
  return records.map((record, index) =>
    assertContract<CanonicalInboxCaptureRecord>(
      inboxCaptureRecordSchema,
      record,
      `inbox capture record at ${input.relativePath}#${index + 1}`,
    ),
  );
}

async function findStoredInboxCaptureRecord(input: {
  vaultRoot: string;
  inbound: InboundCapture;
  captureId: string;
}): Promise<CanonicalInboxCaptureRecord | null> {
  const identityKey = createInboxCaptureIdentityKey(input.inbound);
  const expectedPath = buildInboxCaptureLedgerPathForOccurredAt(input.inbound.occurredAt);
  const expectedRecords = await readInboxCaptureRecordsIfPresent({
    vaultRoot: input.vaultRoot,
    relativePath: expectedPath,
  });
  const expectedMatch = selectMatchingInboxCaptureRecord(expectedRecords, identityKey, input.captureId);

  if (expectedMatch) {
    return expectedMatch;
  }

  const relativePaths = await walkVaultFiles(input.vaultRoot, INBOX_CAPTURE_LEDGER_DIRECTORY, {
    extension: ".jsonl",
  });
  let selected: CanonicalInboxCaptureRecord | null = null;

  for (const relativePath of relativePaths) {
    if (relativePath === expectedPath) {
      continue;
    }

    const records = await readInboxCaptureRecordsIfPresent({
      vaultRoot: input.vaultRoot,
      relativePath,
    });
    const match = selectMatchingInboxCaptureRecord(records, identityKey, input.captureId);

    if (match && (!selected || compareInboxCaptureRecords(match, selected) < 0)) {
      selected = match;
    }
  }

  return selected;
}

async function listCanonicalInboxCaptureRecords(
  vaultRoot: string,
): Promise<CanonicalInboxCaptureRecord[]> {
  const relativePaths = await walkVaultFiles(vaultRoot, INBOX_CAPTURE_LEDGER_DIRECTORY, {
    extension: ".jsonl",
  });
  const selectedByIdentityKey = new Map<string, CanonicalInboxCaptureRecord>();

  for (const relativePath of relativePaths) {
    const records = await readInboxCaptureRecordsIfPresent({ vaultRoot, relativePath });

    for (const record of records) {
      const current = selectedByIdentityKey.get(record.identityKey);
      if (!current || compareInboxCaptureRecords(record, current) < 0) {
        selectedByIdentityKey.set(record.identityKey, record);
      }
    }
  }

  return [...selectedByIdentityKey.values()].sort(compareInboxCaptureRecords);
}

function selectMatchingInboxCaptureRecord(
  records: ReadonlyArray<CanonicalInboxCaptureRecord>,
  identityKey: string,
  captureId: string,
): CanonicalInboxCaptureRecord | null {
  let selected: CanonicalInboxCaptureRecord | null = null;

  for (const record of records) {
    if (record.identityKey !== identityKey && record.captureId !== captureId) {
      continue;
    }

    if (!selected || compareInboxCaptureRecords(record, selected) < 0) {
      selected = record;
    }
  }

  return selected;
}

function compareInboxCaptureRecords(
  left: CanonicalInboxCaptureRecord,
  right: CanonicalInboxCaptureRecord,
): number {
  const recordedAtComparison = left.recordedAt.localeCompare(right.recordedAt);
  if (recordedAtComparison !== 0) {
    return recordedAtComparison;
  }

  const captureComparison = left.captureId.localeCompare(right.captureId);
  if (captureComparison !== 0) {
    return captureComparison;
  }

  return left.envelopePath.localeCompare(right.envelopePath);
}

function normalizeStoredCaptureInboundInput(value: unknown, context: string): InboundCapture {
  const input = expectRecord(value, context);
  const thread = expectRecord(input.thread, `${context}.thread`);
  const actor = expectRecord(input.actor, `${context}.actor`);
  const raw = expectRecord(input.raw, `${context}.raw`);
  const attachmentsValue = input.attachments;

  if (!Array.isArray(attachmentsValue)) {
    throw new TypeError(`Expected canonical "attachments" array in ${context}.`);
  }

  return {
    source: requireStringField(input, "source", context),
    externalId: requireStringField(input, "externalId", context),
    accountId: readOptionalNullableStringField(input, "accountId", context),
    thread: {
      id: requireStringField(thread, "id", `${context}.thread`),
      title: readOptionalNullableStringField(thread, "title", `${context}.thread`),
      isDirect: readOptionalBooleanField(thread, "isDirect", `${context}.thread`),
    },
    actor: {
      id: readOptionalNullableStringField(actor, "id", `${context}.actor`),
      displayName: readOptionalNullableStringField(actor, "displayName", `${context}.actor`),
      isSelf: requireBooleanField(actor, "isSelf", `${context}.actor`),
    },
    occurredAt: requireStringField(input, "occurredAt", context),
    receivedAt: readOptionalNullableStringField(input, "receivedAt", context),
    text: readOptionalNullableStringField(input, "text", context) ?? null,
    attachments: attachmentsValue.map((attachment, index) =>
      normalizeStoredCaptureInboundAttachment(attachment, `${context}.attachments[${index}]`),
    ),
    raw,
  };
}

function normalizeStoredCaptureInboundAttachment(
  value: unknown,
  context: string,
): InboundCapture["attachments"][number] {
  const attachment = expectRecord(value, context);
  const kind = requireStringField(attachment, "kind", context);

  if (!isInboundAttachmentKind(kind)) {
    throw new TypeError(`Unsupported canonical attachment kind "${kind}" in ${context}.`);
  }

  return {
    externalId: readOptionalNullableStringField(attachment, "externalId", context),
    kind,
    mime: readOptionalNullableStringField(attachment, "mime", context),
    originalPath: null,
    fileName: readOptionalNullableStringField(attachment, "fileName", context),
    byteSize: readOptionalNullableNumberField(attachment, "byteSize", context),
  };
}

function expectRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Expected object in ${context}.`);
  }

  return value as Record<string, unknown>;
}

function expectOptionalRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function requireStringField(
  value: Record<string, unknown>,
  field: string,
  context: string,
): string {
  const fieldValue = value[field];

  if (typeof fieldValue !== "string" || fieldValue.trim().length === 0) {
    throw new TypeError(`Expected canonical "${field}" string in ${context}.`);
  }

  return fieldValue;
}

function requireBooleanField(
  value: Record<string, unknown>,
  field: string,
  context: string,
): boolean {
  const fieldValue = value[field];

  if (typeof fieldValue !== "boolean") {
    throw new TypeError(`Expected canonical "${field}" boolean in ${context}.`);
  }

  return fieldValue;
}

function readOptionalBooleanField(
  value: Record<string, unknown>,
  field: string,
  context: string,
): boolean | undefined {
  const fieldValue = value[field];

  if (fieldValue === undefined) {
    return undefined;
  }

  if (typeof fieldValue !== "boolean") {
    throw new TypeError(`Expected canonical "${field}" boolean in ${context}.`);
  }

  return fieldValue;
}

function readOptionalNullableStringField(
  value: Record<string, unknown>,
  field: string,
  context: string,
): string | null | undefined {
  const fieldValue = value[field];

  if (fieldValue === undefined) {
    return undefined;
  }

  if (fieldValue === null) {
    return null;
  }

  if (typeof fieldValue !== "string") {
    throw new TypeError(`Expected canonical "${field}" string in ${context}.`);
  }

  return fieldValue;
}

function readOptionalNullableNumberField(
  value: Record<string, unknown>,
  field: string,
  context: string,
): number | null | undefined {
  const fieldValue = value[field];

  if (fieldValue === undefined) {
    return undefined;
  }

  if (fieldValue === null) {
    return null;
  }

  if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue)) {
    throw new TypeError(`Expected canonical "${field}" number in ${context}.`);
  }

  return fieldValue;
}

function isInboundAttachmentKind(
  value: string,
): value is InboundCapture["attachments"][number]["kind"] {
  return ["image", "audio", "video", "document", "other"].includes(value);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
