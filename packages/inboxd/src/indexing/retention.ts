import { promises as fs } from "node:fs";

import {
  assertContract,
  collectEventRawReferencePaths,
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
  isVaultError,
  readJsonlRecords,
  resolveVaultPathOnDisk,
  runCanonicalWrite,
  statAndHashVaultFileInterruptible,
  toMonthlyShardRelativePath,
  VAULT_LAYOUT,
  withCanonicalWriteLockScope,
  walkVaultFiles,
} from "@murphai/core";
import { openInboxRuntime, type InboxRuntimeStore } from "../kernel/sqlite.js";

const INBOX_MEDIA_RETENTION_DAYS = 14;
const INBOX_MEDIA_RETENTION_WINDOW_MS = INBOX_MEDIA_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const INBOX_MEDIA_RETENTION_PROTECTED_RECHECK_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INBOX_MEDIA_RETENTION_BATCH_SIZE = 100;
const RETAINABLE_INBOX_MEDIA_KINDS = new Set<InboxCaptureAttachmentRecord["kind"]>([
  "audio",
  "image",
  "video",
]);
const RAW_INBOX_PREFIX = `${VAULT_LAYOUT.rawInboxDirectory}/`;
const RETENTION_REASON = "inbox_media_retention" as const;

export interface RunInboxMediaRetentionInput {
  materializeCandidatePaths?: (
    storedPaths: readonly string[]
  ) => Promise<InboxMediaRetentionMaterializeResult | void>;
  maxAttachments?: number;
  now?: Date | string;
  protectedAttachmentIds?: Iterable<string>;
  protectedCaptureIds?: Iterable<string>;
  protectedStoredPaths?: Iterable<string>;
  signal?: AbortSignal | null;
  vaultRoot: string;
}

export interface InboxMediaRetentionMaterializeResult {
  missingStoredPaths?: Iterable<string>;
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
  const protectedCaptureIds = new Set(input.protectedCaptureIds ?? []);
  const protectedStoredPaths = normalizeProtectedStoredPaths(input.protectedStoredPaths ?? []);
  const protectedMediaRecheckAt = new Date(
    Date.parse(now) + INBOX_MEDIA_RETENTION_PROTECTED_RECHECK_MS,
  ).toISOString();
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
  let activeParserJobProtector: ActiveAttachmentParseJobProtector | null = null;
  let hasMoreEligibleAttachments = false;
  let nextEligibleAt: string | null = null;

  const resolveActiveParserJobProtectionExpiresAt = async (
    attachment: InboxCaptureAttachmentRecord,
  ): Promise<string | null> => {
    activeParserJobProtector ??= await openActiveAttachmentParseJobProtector(input.vaultRoot);
    return activeParserJobProtector.resolveProtectionExpiresAt(attachment, cutoffMs);
  };

  try {
    let materializeCandidateCount = 0;
    let presentCandidateCount = 0;

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

        const alreadyRetained =
          initiallyRetainedAttachmentIds.has(attachment.attachmentId) ||
          initiallyRetainedStoredPaths.has(storedPath);
        if (durableRawInboxRefs.has(storedPath)) {
          continue;
        }
        if (
          !alreadyRetained &&
          (
            protectedCaptureIds.has(capture.captureId) ||
            protectedAttachmentIds.has(attachment.attachmentId) ||
            protectedStoredPaths.has(storedPath)
          )
        ) {
          nextEligibleAt = selectProtectedMediaRetentionWake({
            cutoffMs,
            nextEligibleAt,
            protectedMediaRecheckAt,
            recordedAtMs,
          });
          continue;
        }
        if (recordedAtMs > cutoffMs) {
          if (!alreadyRetained) {
            nextEligibleAt = selectEarliestRetentionWake(
              nextEligibleAt,
              new Date(recordedAtMs + INBOX_MEDIA_RETENTION_WINDOW_MS).toISOString(),
            );
          }
          continue;
        }

        if (presentCandidateCount >= maxAttachments) {
          hasMoreEligibleAttachments = true;
          break captureLoop;
        }
        const parserJobProtectionExpiresAt = await resolveActiveParserJobProtectionExpiresAt(
          attachment,
        );
        if (parserJobProtectionExpiresAt) {
          nextEligibleAt = selectEarliestRetentionWake(
            nextEligibleAt,
            parserJobProtectionExpiresAt,
          );
          continue;
        }

        const fileState = await statExistingVaultRegularFile(input.vaultRoot, storedPath, input.signal);
        if (fileState.kind === "missing") {
          if (alreadyRetained || !input.materializeCandidatePaths) {
            continue;
          }
          if (materializeCandidateCount >= maxAttachments) {
            hasMoreEligibleAttachments = true;
            continue;
          }
          materializeCandidateCount += 1;
        }
        if (fileState.kind === "invalid") {
          continue;
        }
        candidates.push({
          attachment,
          capture,
          materialize: fileState.kind === "missing",
          storedPath,
        });
        if (fileState.kind !== "missing") {
          presentCandidateCount += 1;
        }
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
    const missingAfterMaterialization = new Set<string>();
    if (pathsToMaterialize.length > 0) {
      throwIfRetentionAborted(input.signal);
      const materializeResult = await input.materializeCandidatePaths?.(pathsToMaterialize);
      for (const storedPath of normalizeMaterializedMissingStoredPaths(materializeResult)) {
        missingAfterMaterialization.add(storedPath);
      }
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
        let selectedCandidateCount = 0;

        for (const candidate of candidates) {
          throwIfRetentionAborted(input.signal);
          const isMissingAfterMaterialization = missingAfterMaterialization.has(candidate.storedPath);
          const alreadyRetained =
            alreadyRetainedAttachmentIds.has(candidate.attachment.attachmentId) ||
            alreadyRetainedStoredPaths.has(candidate.storedPath);
          if (
            latestDurableRawInboxRefs.has(candidate.storedPath)
          ) {
            continue;
          }
          if (
            !alreadyRetained &&
            (
              protectedCaptureIds.has(candidate.capture.captureId) ||
              protectedAttachmentIds.has(candidate.attachment.attachmentId) ||
              protectedStoredPaths.has(candidate.storedPath)
            )
          ) {
            nextEligibleAt = selectProtectedMediaRetentionWake({
              cutoffMs,
              nextEligibleAt,
              protectedMediaRecheckAt,
              recordedAtMs: Date.parse(candidate.capture.recordedAt),
            });
            continue;
          }

          const parserJobProtectionExpiresAt = await resolveActiveParserJobProtectionExpiresAt(
            candidate.attachment,
          );
          if (parserJobProtectionExpiresAt) {
            nextEligibleAt = selectEarliestRetentionWake(
              nextEligibleAt,
              parserJobProtectionExpiresAt,
            );
            continue;
          }

          if (!isMissingAfterMaterialization) {
            // Verify the bytes currently at the storedPath still match the
            // canonical attachment hash/size before tombstoning. Otherwise a
            // corrupted/replaced raw file would be silently converted into a
            // retention_expired tombstone carrying the canonical hash, hiding
            // the corruption from vault validation. Skipping on mismatch keeps
            // the file in place so validation can surface the divergence.
            const integrity = await safeVerifyRetentionCandidateIntegrity({
              attachment: candidate.attachment,
              signal: input.signal,
              storedPath: candidate.storedPath,
              vaultRoot: input.vaultRoot,
            });
            if (integrity.kind === "interrupted") {
              throwIfRetentionAborted(input.signal);
              continue;
            }
            if (integrity.kind !== "match") {
              continue;
            }
            if (selectedCandidateCount >= maxAttachments) {
              hasMoreEligibleAttachments = true;
              break;
            }
            selectedCandidateCount += 1;
          }

          if (!alreadyRetained) {
            records.push(
              buildRetentionRecord({
                attachment: candidate.attachment,
                capture: candidate.capture,
                purgedAt: now,
                storedPath: candidate.storedPath,
              }),
            );
          }
          if (!isMissingAfterMaterialization) {
            storedPathsToDelete.push(candidate.storedPath);
          }
        }

        if (records.length === 0 && storedPathsToDelete.length === 0) {
          return emptyRetentionResult({
            hasMoreEligibleAttachments,
            nextEligibleAt,
          });
        }

        const expiredBytes = records.reduce((total, record) => total + (record.byteSize ?? 0), 0);
        if (records.length > 0 || storedPathsToDelete.length > 0) {
          throwIfRetentionAborted(input.signal);
          // Tombstone append and raw-file unlink must commit atomically.
          // Previously the unlink ran after runCanonicalWrite committed, so a
          // crash, deploy eviction, or unlink failure (EPERM/EIO) between the
          // two left the ledger advertising the attachment as purged while
          // the raw bytes remained on disk; rebuildRuntimeFromVault then
          // projected the attachment as `retention_expired` with
          // storedPath: null, hiding the orphan private data.
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
              for (const storedPath of storedPathsToDelete) {
                await batch.stageDelete(storedPath, { allowRaw: true });
              }
            },
          });
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
  } finally {
    closeActiveAttachmentParseJobProtector(activeParserJobProtector);
  }
}

function uniqueRetentionStoredPaths(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

function normalizeMaterializedMissingStoredPaths(
  result: InboxMediaRetentionMaterializeResult | void,
): Set<string> {
  const output = new Set<string>();
  for (const storedPath of result?.missingStoredPaths ?? []) {
    const normalized = normalizeRawInboxMediaPath(storedPath);
    if (normalized) {
      output.add(normalized);
    }
  }
  return output;
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
      for (const referencedPath of collectEventRawReferencePaths(record)) {
        const storedPath = normalizeRawInboxMediaPath(referencedPath);
        if (storedPath) {
          references.add(storedPath);
        }
      }
    }
  }

  return references;
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

function selectProtectedMediaRetentionWake(input: {
  cutoffMs: number;
  nextEligibleAt: string | null;
  protectedMediaRecheckAt: string;
  recordedAtMs: number;
}): string | null {
  if (!Number.isFinite(input.recordedAtMs)) {
    return input.nextEligibleAt;
  }
  const candidate = input.recordedAtMs > input.cutoffMs
    ? new Date(input.recordedAtMs + INBOX_MEDIA_RETENTION_WINDOW_MS).toISOString()
    : input.protectedMediaRecheckAt;
  return selectEarliestRetentionWake(input.nextEligibleAt, candidate);
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

interface ActiveAttachmentParseJobProtector {
  close(): void;
  resolveProtectionExpiresAt(
    attachment: InboxCaptureAttachmentRecord,
    cutoffMs: number,
  ): string | null;
}

function closeActiveAttachmentParseJobProtector(
  protector: ActiveAttachmentParseJobProtector | null,
): void {
  protector?.close();
}

async function openActiveAttachmentParseJobProtector(
  vaultRoot: string,
): Promise<ActiveAttachmentParseJobProtector> {
  const runtime = await openInboxRuntime({ vaultRoot });
  return {
    close() {
      runtime.close();
    },
    resolveProtectionExpiresAt(attachment, cutoffMs) {
      return resolveActiveAttachmentParseJobProtectionExpiresAt(runtime, attachment, cutoffMs);
    },
  };
}

function resolveActiveAttachmentParseJobProtectionExpiresAt(
  runtime: InboxRuntimeStore,
  attachment: InboxCaptureAttachmentRecord,
  cutoffMs: number,
): string | null {
  if (attachment.kind !== "audio" && attachment.kind !== "video") {
    return null;
  }

  const activeJobs = [
    ...runtime.listAttachmentParseJobs({
      attachmentId: attachment.attachmentId,
      limit: 1,
      state: "pending",
    }),
    ...runtime.listAttachmentParseJobs({
      attachmentId: attachment.attachmentId,
      limit: 1,
      state: "running",
    }),
  ];

  let protectionExpiresAt: string | null = null;
  for (const job of activeJobs) {
    const jobProtectionExpiresAt = resolveFreshAttachmentParseJobProtectionExpiresAt({
      cutoffMs,
      jobCreatedAt: job.createdAt,
      jobStartedAt: job.startedAt ?? null,
    });
    if (jobProtectionExpiresAt) {
      protectionExpiresAt = selectEarliestRetentionWake(
        protectionExpiresAt,
        jobProtectionExpiresAt,
      );
    }
  }

  return protectionExpiresAt;
}

function resolveFreshAttachmentParseJobProtectionExpiresAt(input: {
  cutoffMs: number;
  jobCreatedAt: string;
  jobStartedAt: string | null;
}): string | null {
  const protectedAtMs = Date.parse(input.jobStartedAt ?? input.jobCreatedAt);
  if (!Number.isFinite(protectedAtMs) || protectedAtMs <= input.cutoffMs) {
    return null;
  }

  return new Date(protectedAtMs + INBOX_MEDIA_RETENTION_WINDOW_MS).toISOString();
}

type RetentionCandidateIntegrityResult =
  | { kind: "interrupted" }
  | { kind: "missing" }
  | { kind: "mismatch" }
  | { kind: "invalid" }
  | { kind: "match" };

async function safeVerifyRetentionCandidateIntegrity(input: {
  attachment: InboxCaptureAttachmentRecord;
  signal?: AbortSignal | null;
  storedPath: string;
  vaultRoot: string;
}): Promise<RetentionCandidateIntegrityResult> {
  let integrity: Awaited<ReturnType<typeof statAndHashVaultFileInterruptible>>;
  try {
    integrity = await statAndHashVaultFileInterruptible(
      input.vaultRoot,
      input.storedPath,
      { shouldContinue: () => !(input.signal?.aborted ?? false) },
    );
  } catch (error) {
    // The previous stat-only check returned `invalid` for symlinks and
    // non-regular files instead of throwing; preserve that skip behavior so
    // a malformed entry can never crash the whole retention pass.
    if (isVaultError(error)) {
      return { kind: "invalid" };
    }
    throw error;
  }

  if (integrity.kind === "interrupted") {
    return { kind: "interrupted" };
  }
  if (integrity.kind === "missing") {
    return { kind: "missing" };
  }

  if (integrity.integrity.sha256 !== input.attachment.sha256) {
    return { kind: "mismatch" };
  }
  const expectedByteSize = input.attachment.byteSize;
  if (
    expectedByteSize !== null
    && expectedByteSize !== undefined
    && integrity.integrity.byteSize !== expectedByteSize
  ) {
    return { kind: "mismatch" };
  }

  return { kind: "match" };
}

async function statExistingVaultRegularFile(
  vaultRoot: string,
  relativePath: string,
  signal?: AbortSignal | null,
): Promise<
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "ok" }
> {
  throwIfRetentionAborted(signal);
  const resolved = await resolveRetentionVaultPathOnDisk(vaultRoot, relativePath);
  if (!resolved) {
    return { kind: "invalid" };
  }
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

  return { kind: "ok" };
}

async function resolveRetentionVaultPathOnDisk(
  vaultRoot: string,
  relativePath: string,
): Promise<Awaited<ReturnType<typeof resolveVaultPathOnDisk>> | null> {
  try {
    return await resolveVaultPathOnDisk(vaultRoot, relativePath);
  } catch (error) {
    if (isVaultError(error) && error.code === "VAULT_PATH_SYMLINK") {
      return null;
    }
    throw error;
  }
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
