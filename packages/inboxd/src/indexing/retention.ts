import path from "node:path";
import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";

import {
  assertContract,
  inboxAttachmentRetentionRecordSchema,
  inboxCaptureRecordSchema,
  safeParseContract,
  type InboxAttachmentRetentionRecord,
  type InboxCaptureAttachmentRecord,
  type InboxCaptureRecord,
} from "@murphai/contracts";
import {
  normalizeRelativeVaultPath,
  acquireCanonicalWriteLock,
  readJsonlRecords,
  resolveVaultPath,
  runCanonicalWrite,
  toMonthlyShardRelativePath,
  VAULT_LAYOUT,
  withCanonicalWriteLockScope,
  walkVaultFiles,
} from "@murphai/core";

const INBOX_MEDIA_RETENTION_DAYS = 14;
const INBOX_MEDIA_RETENTION_WINDOW_MS = INBOX_MEDIA_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const DEFAULT_INBOX_MEDIA_RETENTION_BATCH_SIZE = 100;
const RETAINABLE_INBOX_MEDIA_KINDS = new Set<InboxCaptureAttachmentRecord["kind"]>([
  "audio",
  "image",
  "video",
]);
const RAW_INBOX_PREFIX = `${VAULT_LAYOUT.rawInboxDirectory}/`;
const RETENTION_REASON = "inbox_media_retention" as const;

export interface RunInboxMediaRetentionInput {
  materializeCandidatePaths?: (storedPaths: readonly string[]) => Promise<void>;
  maxAttachments?: number;
  now?: Date | string;
  protectedAttachmentIds?: Iterable<string>;
  protectedStoredPaths?: Iterable<string>;
  signal?: AbortSignal | null;
  vaultRoot: string;
}

export interface InboxMediaRetentionResult {
  expiredAttachments: number;
  expiredBytes: number;
  hasMoreEligibleAttachments: boolean;
  nextEligibleAt: string | null;
  records: InboxAttachmentRetentionRecord[];
}

interface InboxMediaRetentionCandidate {
  attachment: InboxCaptureAttachmentRecord;
  capture: InboxCaptureRecord;
  materialize: boolean;
  storedPath: string;
}

export async function runInboxMediaRetention(
  input: RunInboxMediaRetentionInput,
): Promise<InboxMediaRetentionResult> {
  throwIfRetentionAborted(input.signal);
  const now = normalizeRetentionNow(input.now);
  const maxAttachments = normalizeRetentionBatchSize(input.maxAttachments);
  if (maxAttachments === 0) {
    return emptyRetentionResult();
  }
  const cutoffMs = Date.parse(now) - INBOX_MEDIA_RETENTION_WINDOW_MS;
  const protectedAttachmentIds = new Set(input.protectedAttachmentIds ?? []);
  const protectedStoredPaths = normalizeProtectedStoredPaths(input.protectedStoredPaths ?? []);
  const [captureRecords, durableRawInboxRefs, initialRetentionRecords] = await Promise.all([
    listInboxCaptureRecords(input.vaultRoot),
    listDurableRawInboxReferences(input.vaultRoot),
    listInboxAttachmentRetentionRecords(input.vaultRoot),
  ]);
  const initiallyRetainedAttachmentIds = new Set(
    initialRetentionRecords.map((record) => record.attachmentId),
  );
  const initiallyRetainedStoredPaths = new Set(
    initialRetentionRecords.map((record) => record.storedPath),
  );
  const candidates: InboxMediaRetentionCandidate[] = [];
  let hasMoreEligibleAttachments = false;
  let nextEligibleAt: string | null = null;

  captureLoop:
  for (const capture of captureRecords) {
    throwIfRetentionAborted(input.signal);
    const recordedAtMs = Date.parse(capture.recordedAt);
    if (!Number.isFinite(recordedAtMs)) {
      continue;
    }

    for (const attachment of capture.attachments) {
      throwIfRetentionAborted(input.signal);
      const storedPath = normalizeRawInboxMediaPath(attachment.storedPath ?? null);
      if (!storedPath || !attachment.sha256 || !RETAINABLE_INBOX_MEDIA_KINDS.has(attachment.kind)) {
        continue;
      }
      if (
        protectedAttachmentIds.has(attachment.attachmentId) ||
        protectedStoredPaths.has(storedPath) ||
        durableRawInboxRefs.has(storedPath)
      ) {
        continue;
      }

      const alreadyRetained =
        initiallyRetainedAttachmentIds.has(attachment.attachmentId) ||
        initiallyRetainedStoredPaths.has(storedPath);
      if (recordedAtMs > cutoffMs) {
        if (!alreadyRetained) {
          nextEligibleAt = selectEarliestRetentionWake(
            nextEligibleAt,
            new Date(recordedAtMs + INBOX_MEDIA_RETENTION_WINDOW_MS).toISOString(),
          );
        }
        continue;
      }

      const integrity = await hashExistingVaultFile(input.vaultRoot, storedPath, input.signal);
      if (integrity.kind === "missing" && !input.materializeCandidatePaths) {
        continue;
      }
      if (integrity.kind !== "missing" && !isExpectedInboxMediaIntegrity(integrity, attachment)) {
        continue;
      }

      if (candidates.length >= maxAttachments) {
        hasMoreEligibleAttachments = true;
        break captureLoop;
      }
      candidates.push({
        attachment,
        capture,
        materialize: integrity.kind === "missing",
        storedPath,
      });
    }
  }

  if (candidates.length === 0) {
    return emptyRetentionResult({
      hasMoreEligibleAttachments,
      nextEligibleAt,
    });
  }

  const pathsToMaterialize = uniqueRetentionStoredPaths(
    candidates
      .filter((candidate) => candidate.materialize)
      .map((candidate) => candidate.storedPath),
  );
  if (pathsToMaterialize.length > 0) {
    throwIfRetentionAborted(input.signal);
    await input.materializeCandidatePaths?.(pathsToMaterialize);
    throwIfRetentionAborted(input.signal);
  }

  return await withCanonicalWriteLockScope(input.vaultRoot, async () => {
    const lock = await acquireCanonicalWriteLock(input.vaultRoot);

    try {
      throwIfRetentionAborted(input.signal);
      const [existingRetentionRecords, latestDurableRawInboxRefs] = await Promise.all([
        listInboxAttachmentRetentionRecords(input.vaultRoot),
        listDurableRawInboxReferences(input.vaultRoot),
      ]);
      const alreadyRetainedAttachmentIds = new Set(
        existingRetentionRecords.map((record) => record.attachmentId),
      );
      const alreadyRetainedStoredPaths = new Set(
        existingRetentionRecords.map((record) => record.storedPath),
      );
      const records: InboxAttachmentRetentionRecord[] = [];
      const storedPathsToDelete: string[] = [];

      for (const candidate of candidates) {
        throwIfRetentionAborted(input.signal);
        if (
          latestDurableRawInboxRefs.has(candidate.storedPath) ||
          protectedAttachmentIds.has(candidate.attachment.attachmentId) ||
          protectedStoredPaths.has(candidate.storedPath)
        ) {
          continue;
        }

        const integrity = await hashExistingVaultFile(
          input.vaultRoot,
          candidate.storedPath,
          input.signal,
        );
        if (!isExpectedInboxMediaIntegrity(integrity, candidate.attachment)) {
          continue;
        }

        const alreadyRetained =
          alreadyRetainedAttachmentIds.has(candidate.attachment.attachmentId) ||
          alreadyRetainedStoredPaths.has(candidate.storedPath);
        if (!alreadyRetained) {
          records.push(
            buildRetentionRecord({
              attachment: candidate.attachment,
              capture: candidate.capture,
              purgedAt: now,
              retainedDerivative: await findLatestParserManifest({
                attachmentId: candidate.attachment.attachmentId,
                captureId: candidate.capture.captureId,
                vaultRoot: input.vaultRoot,
              }),
              storedPath: candidate.storedPath,
            }),
          );
        }
        storedPathsToDelete.push(candidate.storedPath);
      }

      if (storedPathsToDelete.length === 0) {
        return emptyRetentionResult({
          hasMoreEligibleAttachments,
          nextEligibleAt,
        });
      }

      const expiredBytes = records.reduce((total, record) => total + (record.byteSize ?? 0), 0);
      if (records.length > 0) {
        await runCanonicalWrite({
          vaultRoot: input.vaultRoot,
          operationType: "inbox_media_retention",
          summary: `Record ${records.length} raw inbox media attachment expiration${records.length === 1 ? "" : "s"}.`,
          occurredAt: now,
          mutate: async ({ batch }) => {
            for (const record of records) {
              await batch.stageJsonlAppend(
                buildInboxAttachmentRetentionLedgerPath(record.purgedAt),
                `${JSON.stringify(record)}\n`,
              );
            }
          },
        });
      }

      for (const storedPath of storedPathsToDelete) {
        await deleteVaultFileIfPresent(input.vaultRoot, storedPath);
      }

      return {
        expiredAttachments: records.length,
        expiredBytes,
        hasMoreEligibleAttachments,
        nextEligibleAt,
        records,
      };
    } finally {
      await lock.release();
    }
  });
}

function isExpectedInboxMediaIntegrity(
  integrity: Awaited<ReturnType<typeof hashExistingVaultFile>>,
  attachment: InboxCaptureAttachmentRecord,
): integrity is { kind: "ok"; byteSize: number; sha256: string } {
  return integrity.kind === "ok" &&
    integrity.byteSize === (attachment.byteSize ?? integrity.byteSize) &&
    integrity.sha256 === attachment.sha256;
}

function uniqueRetentionStoredPaths(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

export function buildInboxAttachmentRetentionLedgerPath(purgedAt: string): string {
  return toMonthlyShardRelativePath(
    VAULT_LAYOUT.inboxAttachmentRetentionLedgerDirectory,
    purgedAt,
    "purgedAt",
  );
}

function buildRetentionRecord(input: {
  attachment: InboxCaptureAttachmentRecord;
  capture: InboxCaptureRecord;
  purgedAt: string;
  retainedDerivative: InboxAttachmentRetentionRecord["retainedDerivative"];
  storedPath: string;
}): InboxAttachmentRetentionRecord {
  const record = assertContract<InboxAttachmentRetentionRecord>(
    inboxAttachmentRetentionRecordSchema,
    {
      schemaVersion: "murph.inbox-attachment-retention.v1",
      captureId: input.capture.captureId,
      attachmentId: input.attachment.attachmentId,
      ordinal: input.attachment.ordinal,
      kind: input.attachment.kind,
      mime: input.attachment.mime ?? null,
      fileName: input.attachment.fileName ?? null,
      byteSize: input.attachment.byteSize ?? null,
      storedPath: input.storedPath,
      sha256: input.attachment.sha256,
      captureOccurredAt: input.capture.occurredAt,
      recordedAt: input.capture.recordedAt,
      purgedAt: input.purgedAt,
      reason: RETENTION_REASON,
      retainedDerivative: input.retainedDerivative ?? null,
    },
    "inbox attachment retention record",
  );
  return record;
}

async function listInboxCaptureRecords(vaultRoot: string): Promise<InboxCaptureRecord[]> {
  const records: InboxCaptureRecord[] = [];
  const ledgerPaths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.inboxCaptureLedgerDirectory, {
    extension: ".jsonl",
  });

  for (const relativePath of ledgerPaths) {
    for (const rawRecord of await readJsonlRecords({ vaultRoot, relativePath })) {
      const result = safeParseContract<InboxCaptureRecord>(inboxCaptureRecordSchema, rawRecord);
      if (result.success) {
        records.push(result.data);
      }
    }
  }

  return records;
}

export async function listInboxAttachmentRetentionRecords(
  vaultRoot: string,
): Promise<InboxAttachmentRetentionRecord[]> {
  const records: InboxAttachmentRetentionRecord[] = [];
  const ledgerPaths = await walkVaultFiles(
    vaultRoot,
    VAULT_LAYOUT.inboxAttachmentRetentionLedgerDirectory,
    { extension: ".jsonl" },
  );

  for (const relativePath of ledgerPaths) {
    for (const rawRecord of await readJsonlRecords({ vaultRoot, relativePath })) {
      const result = safeParseContract<InboxAttachmentRetentionRecord>(
        inboxAttachmentRetentionRecordSchema,
        rawRecord,
      );
      if (result.success) {
        records.push(result.data);
      }
    }
  }

  return records;
}

async function listDurableRawInboxReferences(vaultRoot: string): Promise<Set<string>> {
  const references = new Set<string>();
  const ledgerPaths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.eventLedgerDirectory, {
    extension: ".jsonl",
  });

  for (const relativePath of ledgerPaths) {
    for (const record of await readJsonlRecords({ vaultRoot, relativePath })) {
      for (const referencedPath of collectRecordRawReferences(record)) {
        const storedPath = normalizeRawInboxMediaPath(referencedPath);
        if (storedPath) {
          references.add(storedPath);
        }
      }
    }
  }

  return references;
}

function collectRecordRawReferences(record: Record<string, unknown>): string[] {
  const references: string[] = [];
  if (Array.isArray(record.rawRefs)) {
    for (const rawRef of record.rawRefs) {
      if (typeof rawRef === "string") {
        references.push(rawRef);
      }
    }
  }

  collectMediaReferences(record.media, references);
  if (isRecord(record.workout)) {
    collectMediaReferences(record.workout.media, references);
  }
  collectMediaReferences(record.attachments, references);
  return references;
}

function collectMediaReferences(value: unknown, references: string[]): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (const item of value) {
    if (isRecord(item) && typeof item.relativePath === "string") {
      references.push(item.relativePath);
    }
  }
}

async function findLatestParserManifest(input: {
  attachmentId: string;
  captureId: string;
  vaultRoot: string;
}): Promise<InboxAttachmentRetentionRecord["retainedDerivative"]> {
  const attemptsDirectory = normalizeRelativeVaultPath(
    path.posix.join(
      "derived/inbox",
      input.captureId,
      "attachments",
      input.attachmentId,
      "attempts",
    ),
  );
  const manifests = (await walkVaultFiles(input.vaultRoot, attemptsDirectory, {
    extension: ".json",
  })).filter((relativePath) => path.posix.basename(relativePath) === "manifest.json");
  const latest = manifests.sort().at(-1);
  return latest ? { kind: "parser-manifest", path: latest } : null;
}

function normalizeRetentionNow(now: Date | string | undefined): string {
  if (now instanceof Date) {
    return now.toISOString();
  }
  if (typeof now === "string" && Number.isFinite(Date.parse(now))) {
    return new Date(now).toISOString();
  }
  return new Date().toISOString();
}

function normalizeRetentionBatchSize(value: number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return DEFAULT_INBOX_MEDIA_RETENTION_BATCH_SIZE;
}

function emptyRetentionResult(input: {
  hasMoreEligibleAttachments?: boolean;
  nextEligibleAt?: string | null;
} = {}): InboxMediaRetentionResult {
  return {
    expiredAttachments: 0,
    expiredBytes: 0,
    hasMoreEligibleAttachments: input.hasMoreEligibleAttachments ?? false,
    nextEligibleAt: input.nextEligibleAt ?? null,
    records: [],
  };
}

function selectEarliestRetentionWake(
  previous: string | null,
  candidate: string,
): string {
  if (previous === null) {
    return candidate;
  }

  return Date.parse(candidate) < Date.parse(previous) ? candidate : previous;
}

function normalizeProtectedStoredPaths(values: Iterable<string>): Set<string> {
  const output = new Set<string>();
  for (const value of values) {
    const normalized = normalizeRawInboxMediaPath(value);
    if (normalized) {
      output.add(normalized);
    }
  }
  return output;
}

function normalizeRawInboxMediaPath(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const normalized = normalizeRelativeVaultPath(value);
    return normalized.startsWith(RAW_INBOX_PREFIX) ? normalized : null;
  } catch {
    return null;
  }
}

async function hashExistingVaultFile(
  vaultRoot: string,
  relativePath: string,
  signal?: AbortSignal | null,
): Promise<
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "ok"; byteSize: number; sha256: string }
> {
  throwIfRetentionAborted(signal);
  const resolved = resolveVaultPath(vaultRoot, relativePath);
  let stats: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stats = await fs.lstat(resolved.absolutePath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return { kind: "missing" };
    }
    throw error;
  }

  if (!stats.isFile() || stats.isSymbolicLink()) {
    return { kind: "invalid" };
  }

  return {
    kind: "ok",
    byteSize: stats.size,
    sha256: await sha256File(resolved.absolutePath, signal),
  };
}

async function deleteVaultFileIfPresent(
  vaultRoot: string,
  relativePath: string,
  signal?: AbortSignal | null,
): Promise<void> {
  throwIfRetentionAborted(signal);
  const resolved = resolveVaultPath(vaultRoot, relativePath);
  try {
    await fs.unlink(resolved.absolutePath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  throwIfRetentionAborted(signal);
}

async function sha256File(absolutePath: string, signal?: AbortSignal | null): Promise<string> {
  throwIfRetentionAborted(signal);
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(absolutePath);
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      stream.destroy(toRetentionAbortError(signal));
    };
    if (signal?.aborted) {
      cleanup();
      stream.destroy();
      reject(toRetentionAbortError(signal));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", (error) => {
      cleanup();
      reject(error);
    });
    stream.on("end", () => {
      cleanup();
      resolve();
    });
  });
  throwIfRetentionAborted(signal);
  return hash.digest("hex");
}

function throwIfRetentionAborted(signal: AbortSignal | null | undefined): void {
  if (signal?.aborted) {
    throw toRetentionAbortError(signal);
  }
}

function toRetentionAbortError(signal: AbortSignal | null | undefined): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error("Inbox media retention aborted.");
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
