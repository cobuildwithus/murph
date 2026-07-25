import {
  inboxCaptureRecordSchema,
  safeParseContract,
  type InboxCaptureRecord,
} from "@murphai/contracts";
import {
  acquireCanonicalWriteLock,
  normalizeRelativeVaultPath,
  readJsonlRecords,
  runCanonicalWrite,
  VAULT_LAYOUT,
  walkVaultFiles,
  withCanonicalWriteLockScope,
} from "@murphai/core";
import { openInboxRuntime } from "../kernel/sqlite.js";

export const INBOX_TEXT_RETENTION_DAYS = 14;
export const INBOX_TEXT_RETENTION_WINDOW_MS =
  INBOX_TEXT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const DEFAULT_INBOX_TEXT_RETENTION_BATCH_SIZE = 200;

type CurrentInboxCaptureRecord = Extract<
  InboxCaptureRecord,
  { schemaVersion: "murph.inbox-capture.v2" }
>;

export interface RunInboxTextRetentionInput {
  maxCaptures?: number;
  now?: Date | string;
  protectedCaptureIds?: Iterable<string>;
  signal?: AbortSignal | null;
  vaultRoot: string;
}

export interface InboxTextRetentionResult {
  expiredCaptures: number;
  hasMoreEligibleCaptures: boolean;
  /**
   * Captures past the window that this pass cannot expire because they are
   * still in the legacy envelope format. Non-zero means the vault needs
   * `runInboxEnvelopeMigration` before its content can fully expire.
   */
  legacyCapturesSkipped: number;
  nextEligibleAt: string | null;
}

interface ShardRedaction {
  expiredCaptures: number;
  records: InboxCaptureRecord[];
  redactedCaptureIds: string[];
  relativePath: string;
  storedPathsToDelete: string[];
}

/**
 * Expire inbound message content 14 days after it was recorded.
 *
 * Message text is not a standalone file the way attachment media is, so this
 * cannot mirror `runInboxMediaRetention` and unlink bytes: the text lives inside
 * append-only capture records. Each expired record is therefore rewritten in
 * place with its content fields cleared and `textRetiredAt` stamped — the record
 * becomes its own tombstone, which avoids a second parallel ledger to keep in
 * step with this one.
 *
 * Read and write both happen under the canonical write lock. Reading a shard
 * outside the lock and writing it back inside would silently drop any capture
 * appended in between, because these are whole-shard rewrites rather than
 * appends.
 */
export async function runInboxTextRetention(
  input: RunInboxTextRetentionInput,
): Promise<InboxTextRetentionResult> {
  throwIfAborted(input.signal);
  const now = normalizeNow(input.now);
  const maxCaptures = normalizeBatchSize(input.maxCaptures);
  if (maxCaptures === 0) {
    return emptyResult();
  }

  const cutoffMs = Date.parse(now) - INBOX_TEXT_RETENTION_WINDOW_MS;
  const protectedCaptureIds = new Set(input.protectedCaptureIds ?? []);

  return await withCanonicalWriteLockScope(input.vaultRoot, async () => {
    const lock = await acquireCanonicalWriteLock(input.vaultRoot);
    try {
      throwIfAborted(input.signal);
      const shardPaths = await walkVaultFiles(
        input.vaultRoot,
        VAULT_LAYOUT.inboxCaptureLedgerDirectory,
        { extension: ".jsonl" },
      );

      const redactions: ShardRedaction[] = [];
      let remaining = maxCaptures;
      let hasMoreEligibleCaptures = false;
      let legacyCapturesSkipped = 0;
      let nextEligibleAt: string | null = null;

      for (const [index, relativePath] of shardPaths.entries()) {
        throwIfAborted(input.signal);
        const redaction = await planShardRedaction({
          cutoffMs,
          now,
          protectedCaptureIds,
          relativePath,
          remaining,
          signal: input.signal,
          vaultRoot: input.vaultRoot,
        });
        nextEligibleAt = selectEarliestWake(nextEligibleAt, redaction.nextEligibleAt);
        hasMoreEligibleCaptures ||= redaction.hasMore;
        legacyCapturesSkipped += redaction.legacyCapturesSkipped;
        if (redaction.shard) {
          redactions.push(redaction.shard);
          remaining -= redaction.shard.expiredCaptures;
        }
        if (remaining <= 0) {
          // Shards left unread may still hold expired captures. Reporting "more"
          // here is what schedules the immediate follow-up wake; without it a
          // batch that fills up exactly at a shard boundary would leave the
          // remainder sitting until some later idle checkpoint.
          hasMoreEligibleCaptures ||= index < shardPaths.length - 1;
          break;
        }
      }

      const expiredCaptures = redactions.reduce(
        (total, shard) => total + shard.expiredCaptures,
        0,
      );
      if (expiredCaptures === 0) {
        return {
          expiredCaptures: 0,
          hasMoreEligibleCaptures,
          legacyCapturesSkipped,
          nextEligibleAt,
        };
      }

      throwIfAborted(input.signal);
      // Clear the projection BEFORE the ledger commits textRetiredAt.
      //
      // Ordering matters for recovery, not just tidiness. The projection is a
      // rebuildable cache, so failing here leaves the canonical record still
      // marked un-expired and the next pass retries the whole capture. Doing it
      // after the commit inverted that: planShardRedaction skips a record that
      // already carries textRetiredAt, so one transient SQLite failure stranded
      // readable content in the hosted snapshot permanently while the canonical
      // record claimed retention was complete. Hosted inbox init uses
      // rebuild: false, so no later rebuild is guaranteed to repair it.
      await redactCaptureProjections({
        captureIds: redactions.flatMap((shard) => shard.redactedCaptureIds),
        vaultRoot: input.vaultRoot,
      });

      throwIfAborted(input.signal);
      // The shard rewrite and the unlink of any out-of-line text file must
      // commit together. Split across two writes, a crash between them leaves
      // either a record still advertising content whose bytes are gone, or
      // orphaned message bytes no record points at any more.
      await runCanonicalWrite({
        vaultRoot: input.vaultRoot,
        operationType: "inbox_text_retention",
        summary:
          `Expire message content for ${expiredCaptures} inbox capture`
          + `${expiredCaptures === 1 ? "" : "s"}.`,
        occurredAt: now,
        mutate: async ({ batch }) => {
          for (const shard of redactions) {
            await batch.stageTextWrite(
              shard.relativePath,
              serializeShard(shard.records),
              { allowAppendOnlyJsonl: true, overwrite: true },
            );
            for (const storedPath of shard.storedPathsToDelete) {
              await batch.stageDelete(storedPath, { allowRaw: true });
            }
          }
        },
      });

      return {
        expiredCaptures,
        hasMoreEligibleCaptures,
        legacyCapturesSkipped,
        nextEligibleAt,
      };
    } finally {
      await lock.release();
    }
  });
}

async function redactCaptureProjections(input: {
  captureIds: readonly string[];
  vaultRoot: string;
}): Promise<void> {
  if (input.captureIds.length === 0) {
    return;
  }

  // Deliberately not swallowed: running before the canonical write means a
  // throw here simply leaves the capture un-expired for the next pass, which is
  // the retry-safe outcome. Swallowing it would let the ledger record the
  // content as expired while the projection still served it.
  const runtime = await openInboxRuntime({ vaultRoot: input.vaultRoot });

  try {
    for (const captureId of input.captureIds) {
      runtime.redactCaptureText(captureId);
    }
  } finally {
    runtime.close();
  }
}

async function planShardRedaction(input: {
  cutoffMs: number;
  now: string;
  protectedCaptureIds: ReadonlySet<string>;
  relativePath: string;
  remaining: number;
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<{
  hasMore: boolean;
  legacyCapturesSkipped: number;
  nextEligibleAt: string | null;
  shard: ShardRedaction | null;
}> {
  const rawRecords = await readJsonlRecords({
    relativePath: input.relativePath,
    vaultRoot: input.vaultRoot,
  });

  const records: InboxCaptureRecord[] = [];
  const redactedCaptureIds: string[] = [];
  const storedPathsToDelete: string[] = [];
  let expiredCaptures = 0;
  let hasMore = false;
  let legacyCapturesSkipped = 0;
  let nextEligibleAt: string | null = null;

  for (const rawRecord of rawRecords) {
    throwIfAborted(input.signal);
    const parsed = safeParseContract<InboxCaptureRecord>(
      inboxCaptureRecordSchema,
      rawRecord,
    );
    if (!parsed.success) {
      // Leave records this version cannot parse exactly as they are. Rewriting
      // a shard we do not fully understand risks discarding fields a newer or
      // older writer owns.
      records.push(rawRecord as unknown as InboxCaptureRecord);
      continue;
    }

    const record = parsed.data;
    const recordedAtMs = Date.parse(record.recordedAt);
    if (record.textRetiredAt !== undefined || !Number.isFinite(recordedAtMs)) {
      records.push(record);
      continue;
    }

    if (isLegacyCapture(record)) {
      records.push(record);
      if (recordedAtMs <= input.cutoffMs) {
        legacyCapturesSkipped += 1;
      }
      continue;
    }

    if (!hasExpirableContent(record)) {
      records.push(record);
      continue;
    }

    if (input.protectedCaptureIds.has(record.captureId)) {
      records.push(record);
      continue;
    }

    if (recordedAtMs > input.cutoffMs) {
      records.push(record);
      nextEligibleAt = selectEarliestWake(
        nextEligibleAt,
        new Date(recordedAtMs + INBOX_TEXT_RETENTION_WINDOW_MS).toISOString(),
      );
      continue;
    }

    if (expiredCaptures >= input.remaining) {
      records.push(record);
      hasMore = true;
      continue;
    }

    const redacted = redactCaptureRecord(record, input.now);
    records.push(redacted.record);
    redactedCaptureIds.push(record.captureId);
    storedPathsToDelete.push(...redacted.storedPathsToDelete);
    expiredCaptures += 1;
  }

  if (expiredCaptures === 0) {
    return { hasMore, legacyCapturesSkipped, nextEligibleAt, shard: null };
  }

  return {
    hasMore,
    legacyCapturesSkipped,
    nextEligibleAt,
    shard: {
      expiredCaptures,
      records,
      redactedCaptureIds,
      relativePath: input.relativePath,
      storedPathsToDelete,
    },
  };
}

/**
 * Strip every field that can carry the message body.
 *
 * `raw` is dropped wholesale rather than filtered against an allowlist of
 * body-bearing keys. Today only the Telegram connector puts content there (a
 * bounded `reply_context_preview`); Linq and email already reduce `raw` to
 * counts and flags. An allowlist would have to be revisited every time a
 * connector is added or a provider changes shape, and forgetting to would leak
 * content past its expiry silently. Nothing reads `raw` for behavior — it is
 * written to the capture and projected as opaque metadata — so dropping it
 * costs no functionality.
 */
function redactCaptureRecord(
  record: CurrentInboxCaptureRecord,
  now: string,
): { record: InboxCaptureRecord; storedPathsToDelete: string[] } {
  const storedPathsToDelete = record.textContent
    ? [normalizeStoredPath(record.textContent.storedPath)]
    : [];

  const deleted = new Set(storedPathsToDelete);
  const next = {
    ...record,
    raw: {},
    // Deleted bytes must stop being advertised as present. `rawRefs` is what
    // decides which raw/inbox directories are ledger-owned, so a reference left
    // behind here reads as a dangling ref during vault validation.
    rawRefs: record.rawRefs.filter((ref) => !deleted.has(normalizeStoredPath(ref))),
    textRetiredAt: now,
  } as InboxCaptureRecord;

  delete (next as { text?: unknown }).text;
  delete (next as { textContent?: unknown }).textContent;

  return { record: next, storedPathsToDelete };
}

/**
 * Legacy v1 captures are deliberately out of scope.
 *
 * A v1 record stores the verbatim provider payload in a separate envelope file,
 * and `envelopePath` is required by that schema, so retention cannot delete the
 * envelope without leaving the record pointing at missing bytes — which
 * `validateVault` reports as RAW_REFERENCE_MISSING. Clearing only the inline
 * text while the envelope survives would be a false guarantee. Retiring
 * envelopes is already `runInboxEnvelopeMigration`'s job, and it owns the
 * equivalence checks that make the deletion safe; once a capture is migrated to
 * v2 it expires through the normal path here. Counted rather than ignored so a
 * vault still holding legacy captures past the window is visible.
 */
function isLegacyCapture(
  record: InboxCaptureRecord,
): record is Exclude<InboxCaptureRecord, CurrentInboxCaptureRecord> {
  return record.schemaVersion !== "murph.inbox-capture.v2";
}

function hasExpirableContent(record: CurrentInboxCaptureRecord): boolean {
  if (typeof record.text === "string" && record.text.length > 0) {
    return true;
  }
  if (record.textContent) {
    return true;
  }
  return Object.keys(record.raw).length > 0;
}

function serializeShard(records: readonly InboxCaptureRecord[]): string {
  return records.map((record) => `${JSON.stringify(record)}\n`).join("");
}

function normalizeStoredPath(value: string): string {
  try {
    return normalizeRelativeVaultPath(value);
  } catch {
    return value;
  }
}

function selectEarliestWake(
  previous: string | null,
  candidate: string | null,
): string | null {
  if (candidate === null) {
    return previous;
  }
  if (previous === null) {
    return candidate;
  }
  return Date.parse(candidate) < Date.parse(previous) ? candidate : previous;
}

function normalizeNow(now: Date | string | undefined): string {
  if (now instanceof Date) {
    return now.toISOString();
  }
  if (typeof now === "string" && Number.isFinite(Date.parse(now))) {
    return new Date(now).toISOString();
  }
  return new Date().toISOString();
}

function normalizeBatchSize(value: number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  return DEFAULT_INBOX_TEXT_RETENTION_BATCH_SIZE;
}

function emptyResult(): InboxTextRetentionResult {
  return {
    expiredCaptures: 0,
    hasMoreEligibleCaptures: false,
    legacyCapturesSkipped: 0,
    nextEligibleAt: null,
  };
}

function throwIfAborted(signal: AbortSignal | null | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Inbox text retention aborted.");
  }
}
