import path from "node:path";
import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";

import {
  assertContract,
  auditRecordSchema,
  eventRecordSchema,
  type AuditRecord,
  type EventRecord,
} from "@healthybob/contracts";
import {
  appendJsonlRecord,
  loadVault,
  toMonthlyShardRelativePath,
  VAULT_LAYOUT,
} from "@healthybob/core";

import type { InboundCapture, StoredAttachment, StoredCapture } from "../contracts/capture.js";
import {
  buildLegacyAttachmentId,
  createDeterministicInboxCaptureId,
  createInboxCaptureIdentityKey,
  ensureParentDirectory,
  normalizeStoredAttachments,
  normalizeAccountKey,
  normalizeRelativePath,
  redactSensitivePaths,
  resolveVaultPath,
  sanitizeFileName,
  sanitizeSegment,
  sha256File,
  walkNamedFiles,
} from "../shared.js";
import type { InboxRuntimeStore } from "../kernel/sqlite.js";

export interface PersistRawCaptureInput {
  vaultRoot: string;
  captureId: string;
  eventId: string;
  input: InboundCapture;
  storedAt?: string;
}

export interface StoredCaptureEnvelope {
  schema: "healthybob.inbox-envelope.v1";
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

  for (const [index, attachment] of input.attachments.entries()) {
    const ordinal = index + 1;
    const attachmentId = buildLegacyAttachmentId(captureId, ordinal);

    if (!attachment.originalPath) {
      storedAttachments.push({
        ...attachment,
        attachmentId,
        ordinal,
        storedPath: null,
        sha256: null,
      });
      continue;
    }

    const safeName = sanitizeFileName(attachment.fileName ?? attachment.originalPath, `attachment-${ordinal}`);
    const relativePath = normalizeRelativePath(
      path.posix.join(
        attachmentDirectory,
        `${String(ordinal).padStart(2, "0")}__${safeName}`,
      ),
    );
    const absolutePath = resolveVaultPath(vaultRoot, relativePath);
    await ensureParentDirectory(absolutePath);
    try {
      await copyFile(path.resolve(attachment.originalPath), absolutePath, fsConstants.COPYFILE_EXCL);
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }
    const fileStats = await stat(absolutePath);

    storedAttachments.push({
      ...attachment,
      attachmentId,
      ordinal,
      storedPath: relativePath,
      fileName: attachment.fileName ?? safeName,
      byteSize: attachment.byteSize ?? fileStats.size,
      sha256: await sha256File(absolutePath),
      originalPath: null,
    });
  }

  const envelopePath = normalizeRelativePath(path.posix.join(sourceDirectory, "envelope.json"));
  const absoluteEnvelopePath = resolveVaultPath(vaultRoot, envelopePath);
  await ensureParentDirectory(absoluteEnvelopePath);

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
      ...attachment,
      originalPath: null,
    })),
    raw: redactSensitivePaths(input.raw) as Record<string, unknown>,
  };

  await writeFile(
    absoluteEnvelopePath,
    `${JSON.stringify(
      {
        schema: "healthybob.inbox-envelope.v1",
        captureId,
        eventId,
        storedAt,
        input: sanitizedInput,
        stored: storedCapture,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return storedCapture;
}

export async function findStoredCaptureEnvelope(input: {
  vaultRoot: string;
  inbound: InboundCapture;
  captureId?: string;
}): Promise<StoredCaptureEnvelope | null> {
  const captureId = input.captureId ?? createDeterministicInboxCaptureId(input.inbound);
  const expectedPath = resolveVaultPath(
    input.vaultRoot,
    buildInboxEnvelopePath(input.inbound, captureId),
  );
  const expectedEnvelope = await readStoredCaptureEnvelope(expectedPath);

  if (expectedEnvelope) {
    return expectedEnvelope;
  }

  const accountRoot = resolveVaultPath(input.vaultRoot, buildInboxAccountDirectory(input.inbound));
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

export async function appendInboxCaptureEvent(input: {
  vaultRoot: string;
  eventId: string;
  occurredAt: string;
  inbound: InboundCapture;
  stored: StoredCapture;
}): Promise<{ relativePath: string; record: EventRecord }> {
  const relativePath = toMonthlyShardRelativePath(
    VAULT_LAYOUT.eventLedgerDirectory,
    input.occurredAt,
    "occurredAt",
  );
  const record = assertContract<EventRecord>(eventRecordSchema, {
    schemaVersion: "hb.event.v1",
    id: input.eventId,
    occurredAt: input.inbound.occurredAt,
    recordedAt: input.stored.storedAt,
    dayKey: input.inbound.occurredAt.slice(0, 10),
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

  await appendJsonlRecord({
    vaultRoot: input.vaultRoot,
    relativePath,
    record,
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

  const record = assertContract<AuditRecord>(auditRecordSchema, {
    schemaVersion: "hb.audit.v1",
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

  await appendJsonlRecord({
    vaultRoot: input.vaultRoot,
    relativePath,
    record,
  });

  return { relativePath, record };
}

export async function rebuildRuntimeFromVault(input: {
  vaultRoot: string;
  runtime: InboxRuntimeStore;
}): Promise<void> {
  const inboxRoot = resolveVaultPath(input.vaultRoot, `${VAULT_LAYOUT.rawDirectory}/inbox`);

  try {
    await mkdir(inboxRoot, { recursive: true });
  } catch {
    return;
  }

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
    );
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

function normalizeStoredCaptureEnvelope(envelope: StoredCaptureEnvelope): StoredCaptureEnvelope {
  return {
    ...envelope,
    stored: {
      ...envelope.stored,
      attachments: normalizeStoredAttachments(envelope.captureId, envelope.stored.attachments),
    },
  };
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
  return entry.envelope.captureId === createDeterministicInboxCaptureId(entry.envelope.input) ? 0 : 1;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
