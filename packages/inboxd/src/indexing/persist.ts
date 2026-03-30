import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat } from "node:fs/promises";

import {
  assertContract,
  auditRecordSchema,
  eventRecordSchema,
  inboxCaptureRecordSchema,
  toLocalDayKey,
  type AuditRecord,
  type EventRecord,
  type InboxCaptureRecord as CanonicalInboxCaptureRecord,
} from "@murph/contracts";
import {
  acquireCanonicalWriteLock,
  applyCanonicalWriteBatch,
  type CanonicalRawContentInput,
  type CanonicalRawCopyInput,
  loadVault,
  readJsonlRecords,
  toMonthlyShardRelativePath,
  VAULT_LAYOUT,
  walkVaultFiles,
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
const INBOX_CAPTURE_LEDGER_DIRECTORY = "ledger/inbox-captures";

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

interface PreparedRawCapturePersistence {
  stored: StoredCapture;
  sanitizedInput: InboundCapture;
  rawCopies: CanonicalRawCopyInput[];
  rawContents: CanonicalRawContentInput[];
}

export interface PersistCanonicalInboxCaptureInput extends PersistRawCaptureInput {
  auditId: string;
}

export interface PersistCanonicalInboxCaptureResult {
  stored: StoredCapture;
  capture: {
    relativePath: string;
    record: CanonicalInboxCaptureRecord;
  };
  event: {
    relativePath: string;
    record: EventRecord;
  };
  audit: {
    relativePath: string;
    record: AuditRecord;
  };
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

function buildSanitizedInboundCapture(input: InboundCapture): InboundCapture {
  return {
    ...input,
    accountId: input.accountId ?? null,
    attachments: input.attachments.map((attachment) => ({
      ...stripEphemeralAttachmentFields(attachment),
      originalPath: null,
    })),
    raw: redactSensitivePaths(input.raw) as Record<string, unknown>,
  };
}

async function prepareRawCapturePersistence({
  captureId,
  eventId,
  input,
  storedAt = new Date().toISOString(),
}: Omit<PersistRawCaptureInput, "vaultRoot">): Promise<PreparedRawCapturePersistence> {
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
        );
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

  const sanitizedInput = buildSanitizedInboundCapture(input);

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
    rawCopies,
    rawContents,
  };
}

export async function persistRawCapture({
  vaultRoot,
  captureId,
  eventId,
  input,
  storedAt = new Date().toISOString(),
}: PersistRawCaptureInput): Promise<StoredCapture> {
  const prepared = await prepareRawCapturePersistence({
    captureId,
    eventId,
    input,
    storedAt,
  });

  await applyCanonicalWriteBatch({
    vaultRoot,
    operationType: "inbox_capture_raw_persist",
    summary: `Persist inbox capture ${captureId}`,
    occurredAt: prepared.stored.storedAt,
    rawCopies: prepared.rawCopies,
    rawContents: prepared.rawContents,
  });

  return prepared.stored;
}

export async function persistCanonicalInboxCapture({
  vaultRoot,
  captureId,
  eventId,
  auditId,
  input,
  storedAt = new Date().toISOString(),
}: PersistCanonicalInboxCaptureInput): Promise<PersistCanonicalInboxCaptureResult> {
  const vault = await loadVault({ vaultRoot });
  const prepared = await prepareRawCapturePersistence({
    captureId,
    eventId,
    input,
    storedAt,
  });
  const capturePath = buildInboxCaptureLedgerPathForOccurredAt(input.occurredAt);
  const captureRecord = buildInboxCaptureRecord({
    auditId,
    eventId,
    inbound: prepared.sanitizedInput,
    stored: prepared.stored,
  });
  const eventPath = buildInboxCaptureEventPathForOccurredAt(input.occurredAt);
  const eventRecord = buildInboxCaptureEventRecord({
    eventId,
    inbound: prepared.sanitizedInput,
    stored: prepared.stored,
    timeZone: vault.metadata.timezone,
  });
  const auditPath = buildInboxCaptureAuditPathForStoredAt(prepared.stored.storedAt);
  const auditRecord = buildInboxCaptureAuditRecord({
    auditId,
    eventId,
    inbound: prepared.sanitizedInput,
    stored: prepared.stored,
    capturePath,
    eventPath,
  });

  await applyCanonicalWriteBatch({
    vaultRoot,
    operationType: "inbox_capture_persist",
    summary: `Persist inbox capture ${captureId}`,
    occurredAt: prepared.stored.storedAt,
    rawCopies: prepared.rawCopies,
    rawContents: prepared.rawContents,
    jsonlAppends: [
      {
        relativePath: capturePath,
        record: captureRecord,
      },
      {
        relativePath: eventPath,
        record: eventRecord,
      },
      {
        relativePath: auditPath,
        record: auditRecord,
      },
    ],
  });

  return {
    stored: prepared.stored,
    capture: {
      relativePath: capturePath,
      record: captureRecord,
    },
    event: {
      relativePath: eventPath,
      record: eventRecord,
    },
    audit: {
      relativePath: auditPath,
      record: auditRecord,
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
    return inboxCaptureRecordToStoredCaptureEnvelope(storedRecord);
  }

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
  const capturePath = buildInboxCaptureLedgerPath(input.envelope);
  const eventPath = buildInboxCaptureEventPath(input.envelope);
  const auditPath = buildInboxCaptureAuditPath(input.envelope);
  const lock = await acquireCanonicalWriteLock(input.vaultRoot);

  try {
    const captureRecords = await readInboxCaptureRecordsIfPresent({
      vaultRoot: input.vaultRoot,
      relativePath: capturePath,
    });
    const existingCapture = findMatchingInboxCaptureRecord(captureRecords, input.envelope);

    const eventRecords = await readJsonlRecordsIfPresent({
      vaultRoot: input.vaultRoot,
      relativePath: eventPath,
    });
    const eventExists = eventRecords.some((record) =>
      isInboxCaptureEventRecord(record, input.envelope),
    );

    const auditRecords = await readJsonlRecordsIfPresent({
      vaultRoot: input.vaultRoot,
      relativePath: auditPath,
    });
    const existingAudit = findMatchingInboxCaptureAuditRecord(
      auditRecords,
      input.envelope,
      eventPath,
    );
    const auditId =
      existingCapture?.auditId ??
      existingAudit?.id ??
      input.createAuditId?.() ??
      generatePrefixedId("aud");
    const jsonlAppends: Array<{
      relativePath: string;
      record: AuditRecord | EventRecord | CanonicalInboxCaptureRecord;
    }> = [];

    if (!existingCapture) {
      jsonlAppends.push({
        relativePath: capturePath,
        record: buildInboxCaptureRecord({
          auditId,
          eventId: input.envelope.eventId,
          inbound: input.envelope.input,
          stored: input.envelope.stored,
        }),
      });
    }

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

    if (!existingAudit) {
      jsonlAppends.push({
        relativePath: auditPath,
        record: buildInboxCaptureAuditRecord({
          auditId,
          eventId: input.envelope.eventId,
          inbound: input.envelope.input,
          stored: input.envelope.stored,
          capturePath,
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
  capturePath?: string;
  eventPath: string;
}): Promise<{ relativePath: string; record: AuditRecord }> {
  const relativePath = buildInboxCaptureAuditPathForStoredAt(input.stored.storedAt);

  const record = buildInboxCaptureAuditRecord({
    auditId: input.auditId,
    eventId: input.eventId,
    inbound: input.inbound,
    stored: input.stored,
    capturePath: input.capturePath,
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
  const canonicalRecords = await listCanonicalInboxCaptureRecords(input.vaultRoot);
  const restoredIdentityKeys = new Set<string>();

  for (const record of canonicalRecords) {
    const envelope = inboxCaptureRecordToStoredCaptureEnvelope(record);
    const captureId = input.runtime.upsertCaptureIndex({
      captureId: envelope.captureId,
      eventId: envelope.eventId,
      input: envelope.input,
      stored: envelope.stored,
    });
    input.runtime.enqueueDerivedJobs({
      captureId,
      stored: envelope.stored,
    });
    restoredIdentityKeys.add(record.identityKey);
  }

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
    if (restoredIdentityKeys.has(identityKey)) {
      continue;
    }

    const entry = { absolutePath: envelopePath, envelope };
    const current = canonicalEntries.get(identityKey);

    if (!current || compareEnvelopeEntries(entry, current) < 0) {
      canonicalEntries.set(identityKey, entry);
    }
  }

  for (const entry of [...canonicalEntries.values()].sort(compareEnvelopeEntries)) {
    const evidence = await ensureStoredCaptureCanonicalEvidence({
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
    restoredIdentityKeys.add(createInboxCaptureIdentityKey(entry.envelope.input));
    if (evidence.auditId) {
      // keep return value consumed for deterministic repair flows
    }
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
  capturePath?: string;
  eventPath: string;
}): AuditRecord {
  const relativePath = buildInboxCaptureAuditPathForStoredAt(input.stored.storedAt);
  const captureChange = input.capturePath ? [{ path: input.capturePath, op: "append" as const }] : [];

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
      ...captureChange,
      { path: input.eventPath, op: "append" },
      { path: relativePath, op: "append" },
    ],
  }, "inbox capture audit");
}

function buildInboxCaptureLedgerPath(envelope: StoredCaptureEnvelope): string {
  return buildInboxCaptureLedgerPathForOccurredAt(envelope.input.occurredAt);
}

function buildInboxCaptureLedgerPathForOccurredAt(occurredAt: string): string {
  return toMonthlyShardRelativePath(
    INBOX_CAPTURE_LEDGER_DIRECTORY,
    occurredAt,
    "occurredAt",
  );
}

function buildInboxCaptureEventPath(envelope: StoredCaptureEnvelope): string {
  return buildInboxCaptureEventPathForOccurredAt(envelope.input.occurredAt);
}

function buildInboxCaptureEventPathForOccurredAt(occurredAt: string): string {
  return toMonthlyShardRelativePath(
    VAULT_LAYOUT.eventLedgerDirectory,
    occurredAt,
    "occurredAt",
  );
}

function buildInboxCaptureAuditPath(envelope: StoredCaptureEnvelope): string {
  return buildInboxCaptureAuditPathForStoredAt(envelope.stored.storedAt);
}

function buildInboxCaptureAuditPathForStoredAt(storedAt: string): string {
  return toMonthlyShardRelativePath(
    VAULT_LAYOUT.auditDirectory,
    storedAt,
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
      captureId,
      eventId: envelope.eventId,
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

function buildInboxCaptureRawRefs(stored: StoredCapture): string[] {
  return [
    stored.envelopePath,
    ...stored.attachments
      .map((attachment) => attachment.storedPath)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  ];
}

function buildInboxCaptureRecord(input: {
  auditId: string;
  eventId: string;
  inbound: InboundCapture;
  stored: StoredCapture;
}): CanonicalInboxCaptureRecord {
  return assertContract<CanonicalInboxCaptureRecord>(inboxCaptureRecordSchema, {
    schemaVersion: "murph.inbox-capture.v1",
    captureId: input.stored.captureId,
    identityKey: createInboxCaptureIdentityKey(input.inbound),
    eventId: input.eventId,
    auditId: input.auditId,
    source: input.inbound.source,
    accountId: input.inbound.accountId ?? null,
    externalId: input.inbound.externalId,
    thread: {
      id: input.inbound.thread.id,
      title: input.inbound.thread.title ?? null,
      isDirect: input.inbound.thread.isDirect ?? null,
    },
    actor: {
      id: input.inbound.actor.id ?? null,
      displayName: input.inbound.actor.displayName ?? null,
      isSelf: input.inbound.actor.isSelf,
    },
    occurredAt: input.inbound.occurredAt,
    recordedAt: input.stored.storedAt,
    receivedAt: input.inbound.receivedAt ?? null,
    text: input.inbound.text ?? null,
    raw: input.inbound.raw,
    sourceDirectory: input.stored.sourceDirectory,
    envelopePath: input.stored.envelopePath,
    rawRefs: buildInboxCaptureRawRefs(input.stored),
    attachments: normalizeStoredAttachments(
      input.stored.captureId,
      input.stored.attachments,
      `canonical inbox capture ${input.stored.captureId}`,
    ).map((attachment) => ({
      attachmentId: attachment.attachmentId,
      ordinal: attachment.ordinal,
      externalId: attachment.externalId ?? null,
      kind: attachment.kind,
      mime: attachment.mime ?? null,
      originalPath: null,
      fileName: attachment.fileName ?? null,
      byteSize: attachment.byteSize ?? null,
      storedPath: attachment.storedPath ?? null,
      sha256: attachment.sha256 ?? null,
    })),
  }, "inbox capture record");
}

function inboxCaptureRecordToStoredCaptureEnvelope(record: CanonicalInboxCaptureRecord): StoredCaptureEnvelope {
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
    attachments: record.attachments.map((attachment) => ({
      attachmentId: attachment.attachmentId,
      ordinal: attachment.ordinal,
      externalId: attachment.externalId ?? null,
      kind: attachment.kind,
      mime: attachment.mime ?? null,
      originalPath: null,
      storedPath: attachment.storedPath ?? null,
      fileName: attachment.fileName ?? null,
      byteSize: attachment.byteSize ?? null,
      sha256: attachment.sha256 ?? null,
    })),
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

function findMatchingInboxCaptureRecord(
  records: ReadonlyArray<CanonicalInboxCaptureRecord>,
  envelope: StoredCaptureEnvelope,
): CanonicalInboxCaptureRecord | null {
  const identityKey = createInboxCaptureIdentityKey(envelope.input);
  return selectMatchingInboxCaptureRecord(records, identityKey, envelope.captureId);
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

function findMatchingInboxCaptureAuditRecord(
  records: ReadonlyArray<unknown>,
  envelope: StoredCaptureEnvelope,
  eventPath: string,
): AuditRecord | null {
  for (const record of records) {
    if (!isInboxCaptureAuditRecord(record, envelope, eventPath)) {
      continue;
    }

    return assertContract<AuditRecord>(auditRecordSchema, record, "inbox capture audit record");
  }

  return null;
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
