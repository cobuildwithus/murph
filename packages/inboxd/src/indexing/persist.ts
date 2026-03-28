import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat } from "node:fs/promises";

import {
  assertContract,
  auditRecordSchema,
  eventRecordSchema,
  toLocalDayKey,
  type AuditRecord,
  type EventRecord,
} from "@murph/contracts";
import {
  acquireCanonicalWriteLock,
  applyCanonicalWriteBatch,
  type CanonicalRawContentInput,
  type CanonicalRawCopyInput,
  isVaultError,
  loadVault,
  readJsonlRecords,
  toMonthlyShardRelativePath,
  VAULT_LAYOUT,
} from "@murph/core";

import type { InboundCapture, StoredAttachment, StoredCapture } from "../contracts/capture.ts";
import {
  buildAttachmentId,
  createDeterministicInboxCaptureId,
  createInboxCaptureIdentityKey,
  assertVaultPathOnDisk,
  generatePrefixedId,
  normalizeStoredAttachments,
  normalizeAccountKey,
  normalizeRelativePath,
  redactSensitivePaths,
  resolveVaultPath,
  sanitizeFileName,
  sanitizeSegment,
  sha256File,
  walkNamedFiles,
} from "../shared.ts";
import type { InboxRuntimeStore } from "../kernel/sqlite.ts";

const STORED_CAPTURE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const QUARANTINED_INVALID_CAPTURE_ID_SUFFIX = "quarantined-invalid-capture-id";

export interface PersistRawCaptureInput {
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

interface EnvelopeEntry {
  absolutePath: string;
  envelope: StoredCaptureEnvelope;
}

export interface StoredCaptureCanonicalEvidence {
  auditId?: string;
}

class UnsafeStoredCaptureIdError extends Error {
  readonly captureId: string;
  readonly canonicalCaptureId: string;
  readonly absolutePath: string;

  constructor(input: {
    captureId: string;
    canonicalCaptureId: string;
    absolutePath: string;
  }) {
    super(
      `Stored inbox envelope at ${input.absolutePath} contains unsafe captureId "${input.captureId}".`,
    );
    this.name = "UnsafeStoredCaptureIdError";
    this.captureId = input.captureId;
    this.canonicalCaptureId = input.canonicalCaptureId;
    this.absolutePath = input.absolutePath;
  }
}

export async function ensureInboxVault(vaultRoot: string): Promise<void> {
  await loadVault({ vaultRoot });
}

export async function persistRawCapture({
  vaultRoot,
  captureId,
  eventId,
  input,
  storedAt = new Date().toISOString(),
}: PersistRawCaptureInput): Promise<StoredCapture> {
  const sourceDirectory = buildInboxCaptureDirectory(input, captureId);
  const attachmentDirectory = path.posix.join(sourceDirectory, "attachments");
  const storedAttachments: StoredAttachment[] = [];
  const rawCopies: CanonicalRawCopyInput[] = [];
  const rawContents: CanonicalRawContentInput[] = [];

  for (const [index, attachment] of input.attachments.entries()) {
    const ordinal = index + 1;
    const attachmentId = buildAttachmentId(captureId, ordinal);
    const sanitizedAttachment = stripEphemeralAttachmentFields(attachment);

    if (!attachment.originalPath && !attachment.data) {
      storedAttachments.push(
        buildUnstoredAttachment({
          attachment: sanitizedAttachment,
          attachmentId,
          ordinal,
        }),
      );
      continue;
    }

    const safeName = sanitizeFileName(
      attachment.fileName ?? attachment.originalPath ?? attachment.externalId ?? `attachment-${ordinal}`,
      `attachment-${ordinal}`,
    );
    const relativePath = normalizeRelativePath(
      path.posix.join(
        attachmentDirectory,
        `${String(ordinal).padStart(2, "0")}__${safeName}`,
      ),
    );
    if (attachment.data) {
      const sha256 = createHash("sha256").update(attachment.data).digest("hex");
      rawContents.push({
        targetRelativePath: relativePath,
        content: attachment.data,
        originalFileName: safeName,
        mediaType: attachment.mime ?? "application/octet-stream",
        allowExistingMatch: true,
      });
      storedAttachments.push({
        ...sanitizedAttachment,
        attachmentId,
        ordinal,
        storedPath: relativePath,
        fileName: attachment.fileName ?? safeName,
        byteSize: attachment.byteSize ?? attachment.data.byteLength,
        sha256,
        originalPath: null,
      });
    } else if (attachment.originalPath) {
      const sourceAbsolutePath = path.resolve(attachment.originalPath);
      try {
        const sourceStats = await stat(sourceAbsolutePath);
        const sha256 = await sha256File(sourceAbsolutePath);

        rawCopies.push({
          sourcePath: sourceAbsolutePath,
          targetRelativePath: relativePath,
          originalFileName: safeName,
          mediaType: attachment.mime ?? "application/octet-stream",
          allowExistingMatch: true,
        });
        storedAttachments.push({
          ...sanitizedAttachment,
          attachmentId,
          ordinal,
          storedPath: relativePath,
          fileName: attachment.fileName ?? safeName,
          byteSize: attachment.byteSize ?? sourceStats.size,
          sha256,
          originalPath: null,
        });
      } catch (error) {
        if (!isMissingFileError(error)) {
          throw error;
        }

        storedAttachments.push(
          buildUnstoredAttachment({
            attachment: sanitizedAttachment,
            attachmentId,
            ordinal,
          }),
        )
        continue;
      }
    }
  }

  const envelopePath = normalizeRelativePath(path.posix.join(sourceDirectory, "envelope.json"));

  const storedCapture: StoredCapture = {
    captureId,
    eventId,
    storedAt,
    sourceDirectory,
    envelopePath,
    attachments: storedAttachments,
  };

  const sanitizedInput: InboundCapture = {
    ...input,
    accountId: input.accountId ?? null,
    attachments: input.attachments.map((attachment) => ({
      ...stripEphemeralAttachmentFields(attachment),
      originalPath: null,
    })),
    raw: redactSensitivePaths(input.raw) as Record<string, unknown>,
  };

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
    )}\n`,
    originalFileName: "envelope.json",
    mediaType: "application/json",
    allowExistingMatch: true,
  });

  await applyCanonicalWriteBatch({
    vaultRoot,
    operationType: "inbox_capture_raw_persist",
    summary: `Persist inbox capture ${captureId}`,
    occurredAt: storedAt,
    rawCopies,
    rawContents,
  });

  return storedCapture;
}

export async function findStoredCaptureEnvelope(input: {
  vaultRoot: string;
  inbound: InboundCapture;
  captureId?: string;
}): Promise<StoredCaptureEnvelope | null> {
  const captureId = input.captureId ?? createDeterministicInboxCaptureId(input.inbound);
  const expectedPath = await resolveVaultPath(
    input.vaultRoot,
    buildInboxEnvelopePath(input.inbound, captureId),
  );
  const expectedEnvelope = await readStoredCaptureEnvelope(expectedPath);

  if (expectedEnvelope) {
    return expectedEnvelope;
  }

  const accountRoot = await resolveVaultPath(input.vaultRoot, buildInboxAccountDirectory(input.inbound));
  const envelopeFiles = await walkInboxEnvelopeFiles(accountRoot);
  let selected: EnvelopeEntry | null = null;
  const identityKey = createInboxCaptureIdentityKey(input.inbound);

  for (const envelopePath of envelopeFiles) {
    const envelope = await readStoredCaptureEnvelope(envelopePath);

    if (!envelope || createInboxCaptureIdentityKey(envelope.input) !== identityKey) {
      continue;
    }

    const entry = { absolutePath: envelopePath, envelope };
    if (!selected || compareEnvelopeEntries(entry, selected) < 0) {
      selected = entry;
    }
  }

  return selected?.envelope ?? null;
}

export async function ensureStoredCaptureCanonicalEvidence(input: {
  vaultRoot: string;
  envelope: StoredCaptureEnvelope;
  createAuditId?: () => string;
}): Promise<StoredCaptureCanonicalEvidence> {
  const vault = await loadVault({ vaultRoot: input.vaultRoot });
  const eventPath = buildInboxCaptureEventPath(input.envelope);
  const auditPath = buildInboxCaptureAuditPath(input.envelope);
  const lock = await acquireCanonicalWriteLock(input.vaultRoot);

  try {
    const eventRecords = await readJsonlRecordsIfPresent({
      vaultRoot: input.vaultRoot,
      relativePath: eventPath,
    });
    const eventExists = eventRecords.some((record) =>
      isInboxCaptureEventRecord(record, input.envelope),
    );
    const jsonlAppends: Array<{
      relativePath: string;
      record: AuditRecord | EventRecord;
    }> = [];

    if (!eventExists) {
      jsonlAppends.push({
        relativePath: eventPath,
        record: buildInboxCaptureEventRecord({
          eventId: input.envelope.eventId,
          inbound: input.envelope.input,
          stored: input.envelope.stored,
          timeZone: vault.metadata.timezone,
        }),
      });
    }

    const auditRecords = await readJsonlRecordsIfPresent({
      vaultRoot: input.vaultRoot,
      relativePath: auditPath,
    });
    const auditExists = auditRecords.some((record) =>
      isInboxCaptureAuditRecord(record, input.envelope, eventPath),
    );
    let auditId: string | undefined;

    if (!auditExists) {
      auditId = input.createAuditId?.() ?? generatePrefixedId("aud");
      jsonlAppends.push({
        relativePath: auditPath,
        record: buildInboxCaptureAuditRecord({
          auditId,
          eventId: input.envelope.eventId,
          inbound: input.envelope.input,
          stored: input.envelope.stored,
          eventPath,
        }),
      });
    }

    if (jsonlAppends.length > 0) {
      await applyCanonicalWriteBatch({
        vaultRoot: input.vaultRoot,
        operationType: "inbox_capture_canonical_evidence",
        summary: `Ensure canonical evidence for inbox capture ${input.envelope.captureId}`,
        occurredAt: input.envelope.stored.storedAt,
        jsonlAppends,
      });
    }

    return { auditId };
  } finally {
    await lock.release();
  }
}

export async function appendInboxCaptureEvent(input: {
  vaultRoot: string;
  eventId: string;
  occurredAt: string;
  inbound: InboundCapture;
  stored: StoredCapture;
}): Promise<{ relativePath: string; record: EventRecord }> {
  const vault = await loadVault({ vaultRoot: input.vaultRoot });
  const relativePath = toMonthlyShardRelativePath(
    VAULT_LAYOUT.eventLedgerDirectory,
    input.occurredAt,
    "occurredAt",
  );
  const record = buildInboxCaptureEventRecord({
    eventId: input.eventId,
    inbound: input.inbound,
    stored: input.stored,
    timeZone: vault.metadata.timezone,
  });

  await applyCanonicalWriteBatch({
    vaultRoot: input.vaultRoot,
    operationType: "inbox_capture_event_append",
    summary: `Append inbox capture event ${input.eventId}`,
    occurredAt: input.stored.storedAt,
    jsonlAppends: [
      {
        relativePath,
        record,
      },
    ],
  });

  return { relativePath, record };
}

export async function appendImportAudit(input: {
  vaultRoot: string;
  auditId: string;
  eventId: string;
  inbound: InboundCapture;
  stored: StoredCapture;
  eventPath: string;
}): Promise<{ relativePath: string; record: AuditRecord }> {
  const relativePath = toMonthlyShardRelativePath(
    VAULT_LAYOUT.auditDirectory,
    input.stored.storedAt,
    "occurredAt",
  );

  const record = buildInboxCaptureAuditRecord({
    auditId: input.auditId,
    eventId: input.eventId,
    inbound: input.inbound,
    stored: input.stored,
    eventPath: input.eventPath,
  });

  await applyCanonicalWriteBatch({
    vaultRoot: input.vaultRoot,
    operationType: "inbox_capture_audit_append",
    summary: `Append inbox capture audit ${input.auditId}`,
    occurredAt: input.stored.storedAt,
    jsonlAppends: [
      {
        relativePath,
        record,
      },
    ],
  });

  return { relativePath, record };
}

export async function rebuildRuntimeFromVault(input: {
  vaultRoot: string;
  runtime: InboxRuntimeStore;
}): Promise<void> {
  const inboxRoot = await resolveVaultPath(input.vaultRoot, `${VAULT_LAYOUT.rawDirectory}/inbox`);

  try {
    await mkdir(inboxRoot, { recursive: true });
  } catch {
    return;
  }

  await assertVaultPathOnDisk(input.vaultRoot, inboxRoot);
  const envelopeFiles = await walkInboxEnvelopeFiles(inboxRoot);
  const canonicalEntries = new Map<string, EnvelopeEntry>();

  for (const envelopePath of envelopeFiles) {
    const envelope = await readStoredCaptureEnvelope(envelopePath);
    if (!envelope) {
      continue;
    }

    const identityKey = createInboxCaptureIdentityKey(envelope.input);
    const entry = { absolutePath: envelopePath, envelope };
    const current = canonicalEntries.get(identityKey);

    if (!current || compareEnvelopeEntries(entry, current) < 0) {
      canonicalEntries.set(identityKey, entry);
    }
  }

  for (const entry of [...canonicalEntries.values()].sort(compareEnvelopeEntries)) {
    await ensureStoredCaptureCanonicalEvidence({
      vaultRoot: input.vaultRoot,
      envelope: entry.envelope,
    });
    const captureId = input.runtime.upsertCaptureIndex({
      captureId: entry.envelope.captureId,
      eventId: entry.envelope.eventId,
      input: entry.envelope.input,
      stored: entry.envelope.stored,
    });
    input.runtime.enqueueDerivedJobs({
      captureId,
      stored: entry.envelope.stored,
    });
  }
}

function buildEventNote(capture: InboundCapture): string {
  const text = capture.text?.trim();
  if (text) {
    return text.length > 4000 ? `${text.slice(0, 3997)}...` : text;
  }

  const attachmentCount = capture.attachments.length;
  if (attachmentCount > 0) {
    return `Attachment-only inbox capture from ${capture.source} (${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}).`;
  }

  return `Inbox capture from ${capture.source}.`;
}

function buildInboxCaptureEventRecord(input: {
  eventId: string;
  inbound: InboundCapture;
  stored: StoredCapture;
  timeZone?: string;
}): EventRecord {
  const timeZone = input.timeZone ?? "UTC";

  return assertContract<EventRecord>(eventRecordSchema, {
    schemaVersion: "murph.event.v1",
    id: input.eventId,
    occurredAt: input.inbound.occurredAt,
    recordedAt: input.stored.storedAt,
    dayKey: toLocalDayKey(input.inbound.occurredAt, timeZone),
    timeZone,
    source: "import",
    kind: "note",
    title: `Inbox capture from ${input.inbound.source}`,
    note: buildEventNote(input.inbound),
    tags: ["inbox", `source-${sanitizeSegment(input.inbound.source, "source")}`],
    rawRefs: [
      input.stored.envelopePath,
      ...input.stored.attachments
        .map((attachment) => attachment.storedPath)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ],
  }, "inbox capture event");
}

function buildInboxCaptureAuditRecord(input: {
  auditId: string;
  eventId: string;
  inbound: InboundCapture;
  stored: StoredCapture;
  eventPath: string;
}): AuditRecord {
  const relativePath = toMonthlyShardRelativePath(
    VAULT_LAYOUT.auditDirectory,
    input.stored.storedAt,
    "occurredAt",
  );

  return assertContract<AuditRecord>(auditRecordSchema, {
    schemaVersion: "murph.audit.v1",
    id: input.auditId,
    action: "intake_import",
    status: "success",
    occurredAt: input.stored.storedAt,
    actor: "importer",
    commandName: `inboxd.processCapture:${sanitizeSegment(input.inbound.source, "source")}`,
    summary: `Imported inbox capture from ${input.inbound.source}.`,
    targetIds: [input.eventId],
    changes: [
      { path: input.stored.envelopePath, op: "create" },
      ...input.stored.attachments
        .map((attachment) => attachment.storedPath)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .map((storedPath) => ({ path: storedPath, op: "copy" as const })),
      { path: input.eventPath, op: "append" },
      { path: relativePath, op: "append" },
    ],
  }, "inbox capture audit");
}

function buildInboxCaptureEventPath(envelope: StoredCaptureEnvelope): string {
  return toMonthlyShardRelativePath(
    VAULT_LAYOUT.eventLedgerDirectory,
    envelope.input.occurredAt,
    "occurredAt",
  );
}

function buildInboxCaptureAuditPath(envelope: StoredCaptureEnvelope): string {
  return toMonthlyShardRelativePath(
    VAULT_LAYOUT.auditDirectory,
    envelope.stored.storedAt,
    "occurredAt",
  );
}

function buildInboxAccountDirectory(input: InboundCapture): string {
  const accountSegment = sanitizeSegment(normalizeAccountKey(input.accountId) || "default", "default");
  const sourceSegment = sanitizeSegment(input.source, "source");
  return normalizeRelativePath(
    path.posix.join(VAULT_LAYOUT.rawDirectory, "inbox", sourceSegment, accountSegment),
  );
}

function buildInboxCaptureDirectory(input: InboundCapture, captureId: string): string {
  return normalizeRelativePath(
    path.posix.join(
      buildInboxAccountDirectory(input),
      input.occurredAt.slice(0, 4),
      input.occurredAt.slice(5, 7),
      captureId,
    ),
  );
}

function buildInboxEnvelopePath(input: InboundCapture, captureId: string): string {
  return normalizeRelativePath(path.posix.join(buildInboxCaptureDirectory(input, captureId), "envelope.json"));
}

async function walkInboxEnvelopeFiles(directory: string): Promise<string[]> {
  try {
    return (await walkNamedFiles(directory, "envelope.json", { skipDirectories: ["attachments"] })).sort();
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }
}

async function readStoredCaptureEnvelope(absolutePath: string): Promise<StoredCaptureEnvelope | null> {
  try {
    return normalizeStoredCaptureEnvelope(
      JSON.parse(await readFile(absolutePath, "utf8")) as StoredCaptureEnvelope,
      absolutePath,
    );
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    if (error instanceof UnsafeStoredCaptureIdError) {
      await quarantineStoredCaptureEnvelope(absolutePath);
      return null;
    }

    throw error;
  }
}

function normalizeStoredCaptureEnvelope(
  envelope: StoredCaptureEnvelope,
  absolutePath: string,
): StoredCaptureEnvelope {
  if (!envelope || typeof envelope !== "object") {
    throw new TypeError(`Expected stored inbox envelope object at ${absolutePath}.`);
  }

  if (!envelope.stored || typeof envelope.stored !== "object") {
    throw new TypeError(`Missing canonical "stored" payload in stored inbox envelope at ${absolutePath}.`);
  }

  if (!envelope.input || typeof envelope.input !== "object") {
    throw new TypeError(`Missing canonical "input" payload in stored inbox envelope at ${absolutePath}.`);
  }

  if (typeof envelope.input.source !== "string" || envelope.input.source.trim().length === 0) {
    throw new TypeError(`Missing canonical "input.source" in stored inbox envelope at ${absolutePath}.`);
  }

  if (typeof envelope.input.externalId !== "string" || envelope.input.externalId.trim().length === 0) {
    throw new TypeError(`Missing canonical "input.externalId" in stored inbox envelope at ${absolutePath}.`);
  }

  if (!Array.isArray(envelope.stored.attachments)) {
    throw new TypeError(
      `Missing canonical "stored.attachments" array in stored inbox envelope at ${absolutePath}.`,
    );
  }

  const canonicalCaptureId = createDeterministicInboxCaptureId(envelope.input);
  const captureId = normalizeStoredCaptureId({
    captureId: envelope.captureId,
    canonicalCaptureId,
    absolutePath,
  });

  return {
    ...envelope,
    captureId,
    stored: {
      ...envelope.stored,
      attachments: normalizeStoredAttachmentsForCaptureId({
        captureId,
        attachments: envelope.stored.attachments,
        absolutePath,
      }),
    },
  };
}

async function readJsonlRecordsIfPresent(input: {
  vaultRoot: string;
  relativePath: string;
}): Promise<unknown[]> {
  try {
    return await readJsonlRecords(input);
  } catch (error) {
    if (isVaultError(error) && error.code === "VAULT_FILE_MISSING") {
      return [];
    }

    throw error;
  }
}

function compareEnvelopeEntries(left: EnvelopeEntry, right: EnvelopeEntry): number {
  const idComparison = comparePreferenceScore(left) - comparePreferenceScore(right);
  if (idComparison !== 0) {
    return idComparison;
  }

  const storedAtComparison = left.envelope.stored.storedAt.localeCompare(right.envelope.stored.storedAt);
  if (storedAtComparison !== 0) {
    return storedAtComparison;
  }

  const captureComparison = left.envelope.captureId.localeCompare(right.envelope.captureId);
  if (captureComparison !== 0) {
    return captureComparison;
  }

  return left.absolutePath.localeCompare(right.absolutePath);
}

function comparePreferenceScore(entry: EnvelopeEntry): number {
  const canonicalCaptureId = createDeterministicInboxCaptureId(entry.envelope.input);
  return path.basename(path.dirname(entry.absolutePath)) === canonicalCaptureId ? 0 : 1;
}

function isInboxCaptureEventRecord(record: unknown, envelope: StoredCaptureEnvelope): boolean {
  if (!isPlainRecord(record)) {
    return false;
  }

  return (
    record.id === envelope.eventId &&
    record.kind === "note" &&
    record.occurredAt === envelope.input.occurredAt &&
    record.recordedAt === envelope.stored.storedAt &&
    hasStringArrayEntry(record.rawRefs, envelope.stored.envelopePath)
  );
}

function isInboxCaptureAuditRecord(
  record: unknown,
  envelope: StoredCaptureEnvelope,
  eventPath: string,
): boolean {
  if (!isPlainRecord(record)) {
    return false;
  }

  return (
    record.action === "intake_import" &&
    record.status === "success" &&
    record.occurredAt === envelope.stored.storedAt &&
    record.commandName === `inboxd.processCapture:${sanitizeSegment(envelope.input.source, "source")}` &&
    hasStringArrayEntry(record.targetIds, envelope.eventId) &&
    hasAuditChange(record.changes, envelope.stored.envelopePath, "create") &&
    hasAuditChange(record.changes, eventPath, "append")
  );
}

function hasStringArrayEntry(value: unknown, expected: string): boolean {
  return Array.isArray(value) && value.some((entry) => entry === expected);
}

function hasAuditChange(value: unknown, expectedPath: string, expectedOp: string): boolean {
  return (
    Array.isArray(value) &&
    value.some((entry) => isPlainRecord(entry) && entry.path === expectedPath && entry.op === expectedOp)
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type PersistableInboundAttachment = Omit<InboundCapture["attachments"][number], "data">;

function stripEphemeralAttachmentFields(
  attachment: InboundCapture["attachments"][number],
): PersistableInboundAttachment {
  const { data, ...sanitized } = attachment;
  return sanitized;
}

function buildUnstoredAttachment(input: {
  attachment: PersistableInboundAttachment;
  attachmentId: string;
  ordinal: number;
}): StoredAttachment {
  return {
    ...input.attachment,
    attachmentId: input.attachmentId,
    ordinal: input.ordinal,
    originalPath: null,
    storedPath: null,
    sha256: null,
  };
}

function normalizeStoredCaptureId(input: {
  captureId: unknown;
  canonicalCaptureId: string;
  absolutePath: string;
}): string {
  const captureId = typeof input.captureId === "string" ? input.captureId.trim() : "";

  if (!captureId) {
    throw new TypeError(`Missing canonical "captureId" in stored inbox envelope at ${input.absolutePath}.`);
  }

  if (!STORED_CAPTURE_ID_PATTERN.test(captureId)) {
    throw new UnsafeStoredCaptureIdError({
      captureId,
      canonicalCaptureId: input.canonicalCaptureId,
      absolutePath: input.absolutePath,
    });
  }

  return input.canonicalCaptureId;
}

function normalizeStoredAttachmentsForCaptureId(input: {
  captureId: string;
  attachments: ReadonlyArray<StoredAttachment>;
  absolutePath: string;
}): StoredAttachment[] {
  const normalizedAttachments = normalizeStoredAttachments(
    input.captureId,
    input.attachments,
    `stored inbox envelope at ${input.absolutePath}`,
  );

  return normalizedAttachments.map((attachment) => ({
    ...attachment,
    attachmentId: buildAttachmentId(input.captureId, attachment.ordinal),
  }));
}

async function quarantineStoredCaptureEnvelope(absolutePath: string): Promise<void> {
  const quarantinePath = await resolveQuarantinedEnvelopePath(absolutePath);

  try {
    await rename(absolutePath, quarantinePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }

    throw error;
  }
}

async function resolveQuarantinedEnvelopePath(absolutePath: string): Promise<string> {
  const parsed = path.parse(absolutePath);

  for (let index = 0; index < 1000; index += 1) {
    const suffix = index === 0 ? "" : `-${index}`;
    const candidate = path.join(
      parsed.dir,
      `${parsed.name}.${QUARANTINED_INVALID_CAPTURE_ID_SUFFIX}${suffix}${parsed.ext}`,
    );

    try {
      await stat(candidate);
    } catch (error) {
      if (isMissingFileError(error)) {
        return candidate;
      }

      throw error;
    }
  }

  throw new TypeError(`Unable to quarantine stored inbox envelope at ${absolutePath}.`);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
