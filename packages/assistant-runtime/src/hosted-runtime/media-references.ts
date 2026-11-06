import type { AssistantWorkspaceArtifactUnavailableReason, AssistantWorkspaceArtifactMaterializationResult } from "@murphai/assistant-engine";
import { HostedRuntimeMediaReadError } from "./platform.ts";
import { createHostedMediaReferenceId } from "@murphai/hosted-execution";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";

import {
  collectEventRawReferencePaths,
  compareEventRevisionPriority,
  eventRecordSchema,
  inboxCaptureRecordSchema,
  safeParseContract,
  type EventRecord,
  type InboxCaptureAttachmentRecord,
  type InboxCaptureRecord,
} from "@murphai/contracts";
import {
  GENERATED_IMAGE_CAPTURE_RETENTION_WINDOW_MS,
  isGeneratedImageCaptureEvent,
  listEventLedgerShardPaths,
  normalizeRelativeVaultPath,
  readJsonlRecords,
  resolveVaultPath,
  resolveVaultPathOnDisk,
  statAndHashVaultFileInterruptible,
  canonicalRawArtifactMatches,
  isVaultError,
  withCanonicalWriteLock,
  VAULT_LAYOUT,
  walkVaultFiles,
} from "@murphai/core";
import {
  INBOX_IMAGE_RETENTION_WINDOW_MS,
  INBOX_VIDEO_RETENTION_WINDOW_MS,
  listInboxAttachmentRetentionRecords,
} from "@murphai/inboxd/retention";
import {
  HOSTED_MEDIA_REFS_SCHEMA,
  hostedColdIngestMonth,
  readHostedMediaReferenceCatalogueValue,
  readHostedColdIngestReferences,
  HostedColdHistoryUnavailableError,
  resolveHostedMediaReferenceCataloguePath,
} from "@murphai/runtime-state/node";

import { toHostedArtifactPathKey } from "./artifact-paths.ts";
import type {
  HostedRuntimeMediaKind,
  HostedRuntimeMediaStore,
} from "./platform.ts";

export { HOSTED_MEDIA_REFS_RELATIVE_PATH, HOSTED_MEDIA_REFS_SCHEMA } from "@murphai/runtime-state/node";

const RAW_INBOX_PREFIX = `${VAULT_LAYOUT.rawInboxDirectory}/`;
const RAW_MEALS_PREFIX = `${VAULT_LAYOUT.rawMealsDirectory}/`;
export function isHostedPendingMealMedia(entry: HostedMediaReference): boolean {
  return isHostedMealMediaV2Path(entry.relativePath) && entry.pendingUpload === true;
}

export function isHostedMealMediaV2Path(relativePath: string): boolean {
  return /^raw\/meals\/.+\/thumbnail-v2-[a-zA-Z0-9_-]+\.jpg$/u.test(relativePath);
}

const RAW_CAPTURES_PREFIX = `${VAULT_LAYOUT.rawCapturesDirectory}/`;

export interface HostedMediaReference {
  byteSize: number;
  expiresAt: string | null;
  mediaId: string;
  mediaKind: HostedRuntimeMediaKind;
  mimeType: string | null;
  pendingUpload?: boolean;
  recordedAt: string;
  relativePath: string;
  sha256: string;
}

export interface HostedMediaReferenceCatalogue {
  entries: HostedMediaReference[];
  mealUploadCursor?: string;
  schema: typeof HOSTED_MEDIA_REFS_SCHEMA;
}

export interface PublishHostedWorkspaceMediaReferencesResult {
  excludedVaultPaths: string[];
  prunedMediaCount: number;
  referenceCount: number;
  uploadedMediaCount: number;
}

interface HostedMediaCandidate {
  byteSize: number | null;
  expiresAt: string | null;
  mediaKind: HostedRuntimeMediaKind;
  mimeType: string | null;
  recordedAt: string;
  relativePath: string;
  sha256: string | null;
}

export async function publishHostedWorkspaceMediaReferencesForSnapshot(input: {
  mediaStore?: HostedRuntimeMediaStore | null;
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<PublishHostedWorkspaceMediaReferencesResult> {
  if (!input.mediaStore) {
    if ((await readHostedColdIngestReferences(input.vaultRoot)).length > 0) throw new HostedColdHistoryUnavailableError();
    return {
      excludedVaultPaths: [],
      prunedMediaCount: 0,
      referenceCount: 0,
      uploadedMediaCount: 0,
    };
  }

  const { existingCatalogue, entries, uploadedMediaCount } = await prepareHostedWorkspaceMediaReferences({
    ...input,
    mediaStore: input.mediaStore,
    includeColdIngests: true,
  });
  // Save new uploads as well as earlier cleanup pointers before pruning; a
  // failed deletion must not forget another kind's newly uploaded media.
  await writeHostedMediaReferenceCatalogue({
    catalogue: {
      ...existingCatalogue,
      entries: dedupeHostedMediaReferenceEntries([...existingCatalogue.entries, ...entries]),
      schema: HOSTED_MEDIA_REFS_SCHEMA,
    },
    vaultRoot: input.vaultRoot,
  });

  // Unacknowledged pending cleanup belongs to the abortable idle owner.
  // Preserve its pointer without obstructing snapshots on an absent-row 409.
  const nextMediaIds = new Set(entries.map((entry) => entry.mediaId));
  entries.push(...existingCatalogue.entries.filter(entry => isHostedPendingMealMedia(entry) && !nextMediaIds.has(entry.mediaId)));
  let prunedMediaCount = 0;
  for (const entry of existingCatalogue.entries) {
    assertHostedMediaReferenceLive(input.signal);
    if (nextMediaIds.has(entry.mediaId) || isHostedPendingMealMedia(entry)) {
      continue;
    }
    await input.mediaStore.delete?.({ mediaId: entry.mediaId });
    prunedMediaCount += 1;
  }

  // Keep cleanup pointers until retirement is acknowledged; a failed deletion
  // must remain discoverable on the next warm checkpoint attempt.
  await writeHostedMediaReferenceCatalogue({
    catalogue: {
      ...existingCatalogue,
      entries,
      schema: HOSTED_MEDIA_REFS_SCHEMA,
    },
    vaultRoot: input.vaultRoot,
  });

  return {
    // Meal CLI/native image tools read local paths. Keep their canonical bytes
    // in encrypted snapshots; the media store serves only thumbnail delivery.
    excludedVaultPaths: entries.filter(entry => !entry.relativePath.startsWith(RAW_MEALS_PREFIX)).map(entry => entry.relativePath),
    prunedMediaCount,
    referenceCount: entries.length,
    uploadedMediaCount,
  };
}

// Canonical writes can still roll back until their receipt is acknowledged.
// Preserve earlier references; only snapshot reconciliation may reclaim them.
export async function publishHostedWorkspaceMediaReferences(input: {
  mediaStore: HostedRuntimeMediaStore;
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<HostedMediaReference[]> {
  const { existingCatalogue, entries } = await prepareHostedWorkspaceMediaReferences(input);
  const byPath = new Map(existingCatalogue.entries.map((entry) => [entry.relativePath, entry]));
  for (const entry of entries) byPath.set(entry.relativePath, entry);
  await writeHostedMediaReferenceCatalogue({
    catalogue: { ...existingCatalogue, entries: [...byPath.values()], schema: HOSTED_MEDIA_REFS_SCHEMA },
    vaultRoot: input.vaultRoot,
  });
  return entries;
}

async function prepareHostedWorkspaceMediaReferences(input: {
  includeColdIngests?: boolean;
  mediaStore: HostedRuntimeMediaStore;
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<{
  entries: HostedMediaReference[];
  existingCatalogue: HostedMediaReferenceCatalogue;
  uploadedMediaCount: number;
}> {
  const existingCatalogue = await readHostedMediaReferenceCatalogue({
    vaultRoot: input.vaultRoot,
  });
  const existingByPath = new Map(
    existingCatalogue.entries.map((entry) => [entry.relativePath, entry]),
  );
  const candidates = await collectHostedMediaCandidates(input.vaultRoot, input.signal);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const ingestPaths = input.includeColdIngests
    ? new Set(await walkVaultFiles(input.vaultRoot, VAULT_LAYOUT.integrationIngestLedgerDirectory))
    : new Set<string>();
  for (const relativePath of ingestPaths) {
    const month = hostedColdIngestMonth(relativePath);
    if (!month || month >= currentMonth || existingByPath.has(relativePath)) continue;
    const logicalPath = relativePath.slice(0, -3);
    if ([logicalPath, `${logicalPath}.gz`, `${logicalPath}.zip`].some((sibling) => ingestPaths.has(sibling))) continue;
    candidates.push({ relativePath, mediaKind: "integration-ingest", expiresAt: null,
      byteSize: null, sha256: null, mimeType: "application/octet-stream", recordedAt: `${month}-01T00:00:00.000Z` });
  }
  const nextEntries: HostedMediaReference[] = existingCatalogue.entries.filter((entry) => entry.mediaKind === "integration-ingest");
  // A clock rollback must never externalize the current/future month.
  if (nextEntries.some((entry) => (hostedColdIngestMonth(entry.relativePath) ?? "") >= currentMonth)) {
    throw new Error("Cold ingest month is not closed; retry with a current workspace clock.");
  }
  let uploadedMediaCount = 0;

  for (const candidate of candidates) {
    assertHostedMediaReferenceLive(input.signal);
    const existing = existingByPath.get(candidate.relativePath);
    const localRef = await prepareHostedMediaReferenceFromLocalFile({
      candidate,
      existing,
      mediaStore: input.mediaStore,
      signal: input.signal,
      vaultRoot: input.vaultRoot,
    });
    if (localRef) {
      uploadedMediaCount += localRef.uploaded ? 1 : 0;
      nextEntries.push(localRef.entry);
      continue;
    }
    if (
      existing
      && existing.mediaKind === candidate.mediaKind
      && (
        candidate.sha256 === null
        || candidate.sha256 === existing.sha256
      )
      && (
        candidate.byteSize === null
        || candidate.byteSize === existing.byteSize
      )
    ) {
      const mergedEntry = {
        ...existing,
        expiresAt: resolveUpdatedHostedMediaExpiresAt(
          existing.expiresAt,
          candidate.expiresAt,
        ),
        recordedAt: minHostedMediaRecordedAt(
          existing.recordedAt,
          normalizeHostedMediaRecordedAt(candidate.recordedAt),
        ),
      };
      if (existing.expiresAt !== mergedEntry.expiresAt) {
        await input.mediaStore.record?.({
          byteSize: mergedEntry.byteSize,
          expiresAt: mergedEntry.expiresAt,
          mediaId: mergedEntry.mediaId,
          mediaKind: mergedEntry.mediaKind,
          sha256: mergedEntry.sha256,
        });
      }
      nextEntries.push(mergedEntry);
    }
  }

  return {
    entries: dedupeHostedMediaReferenceEntries(nextEntries),
    existingCatalogue,
    uploadedMediaCount,
  };
}

export async function materializeHostedWorkspaceMediaReferences(input: {
  mediaStore?: HostedRuntimeMediaStore | null;
  relativePaths: readonly string[];
  signal?: AbortSignal | null;
  vaultRoot: string;
  options?: { maxFileBytes?: number };
}): Promise<AssistantWorkspaceArtifactMaterializationResult> {
  const materializedArtifactPaths = new Set<string>();
  const missingArtifactPaths = new Map<string, AssistantWorkspaceArtifactUnavailableReason>();
  if (input.relativePaths.length === 0) {
    return { materializedArtifactPaths, missingArtifactPaths };
  }

  const requestedKeys = new Set(
    input.relativePaths.map((relativePath) => toHostedArtifactPathKey({ path: relativePath })),
  );
  const catalogue = await readHostedMediaReferenceCatalogue({
    vaultRoot: input.vaultRoot,
  });
  const entries = catalogue.entries.filter((entry) =>
    requestedKeys.has(toHostedArtifactPathKey({ path: entry.relativePath, root: "vault" }))
  );

  for (const entry of entries) {
    assertHostedMediaReferenceLive(input.signal);
    const key = toHostedArtifactPathKey({ path: entry.relativePath, root: "vault" });
    if (
      input.options?.maxFileBytes !== undefined
      && entry.byteSize > input.options.maxFileBytes
    ) {
      missingArtifactPaths.set(key, "size");
      continue;
    }
    try {
      if (!await hostedMediaReferenceIsCurrent(input.vaultRoot, entry)) {
        missingArtifactPaths.set(key, "obsolete");
        continue;
      }
    } catch (error) {
      if (!isHostedMediaCanonicalLockBusy(error)) throw error;
      missingArtifactPaths.set(key, "transport");
      continue;
    }
    if (entry.expiresAt !== null && Date.parse(entry.expiresAt) <= Date.now()) {
      await withHostedMediaInstallGuard(input.vaultRoot, entry, async () => {
        if (await localHostedMediaReferenceIsValid({ entry, signal: input.signal, vaultRoot: input.vaultRoot })) {
          assertHostedMediaReferenceLive(input.signal);
          const resolved = await resolveVaultPathOnDisk(input.vaultRoot, entry.relativePath);
          await rm(resolved.absolutePath, { force: true });
        }
      }).catch((error: unknown) => {
        // Eviction is best effort: the entry is reported expired either way.
        if (!isHostedMediaCanonicalLockBusy(error)) throw error;
      });
      missingArtifactPaths.set(key, "expired");
      continue;
    }
    if (await localHostedMediaReferenceIsValid({
      entry,
      signal: input.signal,
      vaultRoot: input.vaultRoot,
    })) {
      materializedArtifactPaths.add(key);
      continue;
    }

    if (!input.mediaStore) {
      missingArtifactPaths.set(key, "transport");
      continue;
    }
    let bytes: Uint8Array | null;
    try {
      bytes = await input.mediaStore.get(
        {
          byteSize: entry.byteSize,
          mediaId: entry.mediaId,
          mediaKind: entry.mediaKind,
          sha256: entry.sha256,
        },
        {
          purpose: "workspace_media_materialization",
          signal: input.signal,
        },
      );
    } catch (error) {
      assertHostedMediaReferenceLive(input.signal);
      // Only the transport's typed read failure becomes a file outcome. Owner
      // loss and other control-flow failures must abort the caller.
      if (!(error instanceof HostedRuntimeMediaReadError)) throw error;
      missingArtifactPaths.set(key, "transport");
      continue;
    }
    assertHostedMediaReferenceLive(input.signal);
    if (!bytes) {
      missingArtifactPaths.set(key, "missing");
      continue;
    }
    if (!hostedMediaBytesMatchEntry(bytes, entry)) {
      missingArtifactPaths.set(key, "integrity");
      continue;
    }

    try {
      await withHostedMediaInstallGuard(input.vaultRoot, entry, async () => {
        assertHostedMediaReferenceLive(input.signal);
        // A canonical retirement may have committed while the remote read ran.
        if (!await hostedMediaReferenceIsCurrent(input.vaultRoot, entry)) {
          missingArtifactPaths.set(key, "obsolete");
          return;
        }
        if (entry.expiresAt !== null && Date.parse(entry.expiresAt) <= Date.now()) {
          missingArtifactPaths.set(key, "expired");
          return;
        }
        await installHostedMediaReference({ bytes, entry, signal: input.signal, vaultRoot: input.vaultRoot });
        materializedArtifactPaths.add(key);
      });
    } catch (error) {
      // A long canonical writer must not abort the reader's turn. Retryable.
      if (!isHostedMediaCanonicalLockBusy(error)) throw error;
      missingArtifactPaths.set(key, "transport");
    }
  }

  return { materializedArtifactPaths, missingArtifactPaths };
}

function isHostedCanonicalPhotoPath(relativePath: string): boolean {
  return relativePath.startsWith("raw/meals/") || relativePath.startsWith("raw/measurements/");
}

async function hostedMediaReferenceIsCurrent(vaultRoot: string, entry: HostedMediaReference): Promise<boolean> {
  return !isHostedCanonicalPhotoPath(entry.relativePath) || canonicalRawArtifactMatches({ vaultRoot, ...entry });
}

// Foreground attachment reads reach this path, so inbox and capture media must
// never queue behind a canonical writer. Only canonical photo paths can race a
// retirement tombstone, and only their final install needs exclusion.
function withHostedMediaInstallGuard<T>(
  vaultRoot: string, entry: HostedMediaReference, run: () => Promise<T>,
): Promise<T> {
  return isHostedCanonicalPhotoPath(entry.relativePath) ? withCanonicalWriteLock(vaultRoot, run) : run();
}

function isHostedMediaCanonicalLockBusy(error: unknown): boolean {
  return isVaultError(error) && error.code === "CANONICAL_WRITE_LOCKED";
}

export async function readHostedMediaReferenceCatalogue(input: {
  vaultRoot: string;
}): Promise<HostedMediaReferenceCatalogue> {
  return parseHostedMediaReferenceCatalogue(await readHostedMediaReferenceCatalogueValue(input.vaultRoot));
}

async function collectHostedMediaCandidates(
  vaultRoot: string,
  signal: AbortSignal | null | undefined,
): Promise<HostedMediaCandidate[]> {
  const eventInventory = await collectHostedMediaEventInventory(vaultRoot, signal);
  return dedupeHostedMediaCandidates([
    ...await collectInboxHostedMediaCandidates({
      durableRawInboxRefs: eventInventory.durableRawInboxRefs,
      signal,
      vaultRoot,
    }),
    ...collectCaptureHostedMediaCandidates(eventInventory.latestEvents),
  ]);
}

async function collectInboxHostedMediaCandidates(input: {
  durableRawInboxRefs: ReadonlySet<string>;
  signal: AbortSignal | null | undefined;
  vaultRoot: string;
}): Promise<HostedMediaCandidate[]> {
  const [captureRecords, retentionRecords] = await Promise.all([
    listInboxCaptureRecords(input.vaultRoot, input.signal),
    listInboxAttachmentRetentionRecords(input.vaultRoot),
  ]);
  const retiredAttachmentIds = new Set(
    retentionRecords.map((record) => record.attachmentId),
  );
  const retiredStoredPaths = new Set(
    retentionRecords.map((record) => record.storedPath),
  );
  const candidates: HostedMediaCandidate[] = [];
  for (const capture of captureRecords) {
    assertHostedMediaReferenceLive(input.signal);
    for (const attachment of capture.attachments) {
      const mediaKind = readHostedMediaKindFromInboxAttachment(attachment);
      const storedPath = normalizeHostedMediaVaultPath(attachment.storedPath, RAW_INBOX_PREFIX);
      if (
        !mediaKind
        || !storedPath
        || retiredAttachmentIds.has(attachment.attachmentId)
        || retiredStoredPaths.has(storedPath)
      ) {
        continue;
      }
      const preserved = input.durableRawInboxRefs.has(storedPath);
      candidates.push({
        byteSize: normalizeHostedMediaByteSize(attachment.byteSize),
        expiresAt: preserved
          ? null
          : resolveHostedMediaReferenceExpiresAt({
              mediaKind,
              recordedAt: capture.recordedAt,
            }),
        mediaKind,
        mimeType: normalizeHostedMediaMimeType(attachment.mime),
        recordedAt: normalizeHostedMediaRecordedAt(capture.recordedAt),
        relativePath: storedPath,
        sha256: normalizeHostedMediaSha256(attachment.sha256),
      });
    }
  }
  return candidates;
}

function collectCaptureHostedMediaCandidates(
  latestEvents: Iterable<EventRecord>,
): HostedMediaCandidate[] {
  const candidates: HostedMediaCandidate[] = [];
  for (const record of latestEvents) {
    if (record.lifecycle?.state === "deleted") {
      continue;
    }
    // Legacy full photos stay in the encrypted vault until bounded maintenance
    // creates their thumbnail. A foreground write must not upload the backlog.
    const thumbnail = record.kind === "meal" ? record.photoThumbnail : null;
    if (record.kind === "meal" && !thumbnail) continue;
    for (const rawRef of collectEventRawReferencePaths(record)) {
      const normalized = normalizeHostedMediaVaultPath(rawRef, thumbnail ? RAW_MEALS_PREFIX : RAW_CAPTURES_PREFIX);
      const mediaKind = normalized ? readHostedMediaKindFromPath(normalized) : null;
      if (thumbnail && normalized !== thumbnail.relativePath) continue;
      if (!mediaKind || !normalized) {
        continue;
      }
      candidates.push({
        byteSize: thumbnail?.byteSize ?? null,
        expiresAt: isGeneratedImageCaptureEvent(record)
          ? new Date(Date.parse(record.recordedAt) + GENERATED_IMAGE_CAPTURE_RETENTION_WINDOW_MS).toISOString()
          : null,
        mediaKind,
        mimeType: readHostedMediaMimeTypeFromPath(normalized),
        recordedAt: normalizeHostedMediaRecordedAt(record.recordedAt),
        relativePath: normalized,
        sha256: thumbnail?.sha256 ?? null,
      });
    }
  }
  return candidates;
}

async function collectHostedMediaEventInventory(
  vaultRoot: string,
  signal: AbortSignal | null | undefined,
): Promise<{
  durableRawInboxRefs: Set<string>;
  latestEvents: EventRecord[];
}> {
  const durableRawInboxRefs = new Set<string>();
  const latestEvents = new Map<string, { record: EventRecord; relativePath: string }>();
  for (const relativePath of await listEventLedgerShardPaths(vaultRoot)) {
    assertHostedMediaReferenceLive(signal);
    // Validate all JSON before inspecting event values, preserving malformed-row errors.
    let count = 0;
    for (const rawRecord of await readJsonlRecords({ vaultRoot, relativePath })) {
      if (++count % 256 === 0) await yieldToEventLoop();
      for (const rawRef of collectEventRawReferencePaths(rawRecord)) {
        const storedPath = normalizeHostedMediaVaultPath(rawRef, RAW_INBOX_PREFIX);
        if (storedPath) {
          durableRawInboxRefs.add(storedPath);
        }
      }
      const parsed = safeParseContract<EventRecord>(eventRecordSchema, rawRecord);
      if (!parsed.success) {
        continue;
      }
      const current = latestEvents.get(parsed.data.id);
      if (!current || compareEventRevisionPriority({ ...parsed.data, relativePath }, { ...current.record, relativePath: current.relativePath }) > 0) {
        latestEvents.set(parsed.data.id, { record: parsed.data, relativePath });
      }
    }
  }
  return {
    durableRawInboxRefs,
    latestEvents: [...latestEvents.values()].map(entry => entry.record),
  };
}

async function listInboxCaptureRecords(
  vaultRoot: string,
  signal: AbortSignal | null | undefined,
): Promise<InboxCaptureRecord[]> {
  const records: InboxCaptureRecord[] = [];
  const ledgerPaths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.inboxCaptureLedgerDirectory, {
    extension: ".jsonl",
  });

  for (const relativePath of ledgerPaths) {
    assertHostedMediaReferenceLive(signal);
    for (const rawRecord of await readJsonlRecords({ vaultRoot, relativePath })) {
      const result = safeParseContract<InboxCaptureRecord>(inboxCaptureRecordSchema, rawRecord);
      if (result.success) {
        records.push(result.data);
      }
    }
  }

  return records;
}

async function prepareHostedMediaReferenceFromLocalFile(input: {
  candidate: HostedMediaCandidate;
  existing?: HostedMediaReference;
  mediaStore: HostedRuntimeMediaStore;
  signal: AbortSignal | null | undefined;
  vaultRoot: string;
}): Promise<{ entry: HostedMediaReference; uploaded: boolean } | null> {
  const integrity = await statAndHashVaultFileInterruptible(
    input.vaultRoot,
    input.candidate.relativePath,
    { shouldContinue: () => !(input.signal?.aborted ?? false) },
  );
  if (integrity.kind === "interrupted") {
    assertHostedMediaReferenceLive(input.signal);
    return null;
  }
  if (integrity.kind === "missing") {
    return null;
  }
  const { byteSize, sha256 } = integrity.integrity;
  if (
    input.candidate.sha256 !== null
    && input.candidate.sha256 !== sha256
  ) {
    return null;
  }
  if (
    input.candidate.byteSize !== null
    && input.candidate.byteSize !== byteSize
  ) {
    return null;
  }

  const entry: HostedMediaReference = {
    byteSize,
    expiresAt: input.candidate.expiresAt,
    mediaId: createHostedMediaReferenceId({
      byteSize,
      mediaKind: input.candidate.mediaKind,
      relativePath: input.candidate.relativePath,
      sha256,
    }),
    mediaKind: input.candidate.mediaKind,
    mimeType: input.candidate.mimeType,
    recordedAt: input.candidate.recordedAt,
    relativePath: input.candidate.relativePath,
    sha256,
  };
  if (
    input.existing
    && input.existing.mediaId === entry.mediaId
    && input.existing.mediaKind === entry.mediaKind
    && input.existing.byteSize === entry.byteSize
    && input.existing.sha256 === entry.sha256
  ) {
    const mergedEntry = {
      ...entry,
      ...(input.existing.pendingUpload === undefined ? {} : { pendingUpload: input.existing.pendingUpload }),
      expiresAt: resolveUpdatedHostedMediaExpiresAt(
        input.existing.expiresAt,
        entry.expiresAt,
      ),
      recordedAt: minHostedMediaRecordedAt(
        input.existing.recordedAt,
        entry.recordedAt,
      ),
    };
    if (input.existing.expiresAt !== mergedEntry.expiresAt) {
      await input.mediaStore.record?.({
        byteSize: mergedEntry.byteSize,
        expiresAt: mergedEntry.expiresAt,
        mediaId: mergedEntry.mediaId,
        mediaKind: mergedEntry.mediaKind,
        sha256: mergedEntry.sha256,
      });
    }
    return {
      entry: mergedEntry,
      uploaded: false,
    };
  }
  // Meal bytes remain in receipts and snapshots. Persist their delivery intent
  // before the first PUT: a response can be lost after remote registration.
  if (isHostedMealMediaV2Path(entry.relativePath)) {
    return { entry: { ...entry, pendingUpload: true }, uploaded: false };
  }
  const resolved = await resolveVaultPathOnDisk(input.vaultRoot, entry.relativePath);
  const bytes = new Uint8Array(await readFile(resolved.absolutePath));
  await input.mediaStore.put({
    byteSize: entry.byteSize,
    bytes,
    expiresAt: entry.expiresAt,
    mediaId: entry.mediaId,
    mediaKind: entry.mediaKind,
    sha256: entry.sha256,
  });
  return { entry, uploaded: true };
}


async function localHostedMediaReferenceIsValid(input: {
  entry: HostedMediaReference;
  signal: AbortSignal | null | undefined;
  vaultRoot: string;
}): Promise<boolean> {
  const integrity = await statAndHashVaultFileInterruptible(
    input.vaultRoot,
    input.entry.relativePath,
    { shouldContinue: () => !(input.signal?.aborted ?? false) },
  );
  if (integrity.kind === "interrupted") {
    assertHostedMediaReferenceLive(input.signal);
    return false;
  }
  if (integrity.kind !== "ok") {
    return false;
  }
  return integrity.integrity.byteSize === input.entry.byteSize
    && integrity.integrity.sha256 === input.entry.sha256;
}

async function installHostedMediaReference(input: {
  signal?: AbortSignal | null;
  bytes: Uint8Array;
  entry: HostedMediaReference;
  vaultRoot: string;
}): Promise<void> {
  const resolved = resolveVaultPath(input.vaultRoot, input.entry.relativePath);
  await mkdir(path.dirname(resolved.absolutePath), {
    mode: 0o700,
    recursive: true,
  });
  const tempPath = path.join(
    path.dirname(resolved.absolutePath),
    `.hosted-media-${randomUUID()}.tmp`,
  );
  try {
    assertHostedMediaReferenceLive(input.signal);
    await writeFile(tempPath, input.bytes, { mode: 0o600, signal: input.signal ?? undefined });
    await chmod(tempPath, 0o600);
    assertHostedMediaReferenceLive(input.signal);
    await rename(tempPath, resolved.absolutePath);
  } finally {
    await rm(tempPath, { force: true });
  }
}

function hostedMediaBytesMatchEntry(
  bytes: Uint8Array,
  entry: HostedMediaReference,
): boolean {
  if (bytes.byteLength !== entry.byteSize) {
    return false;
  }
  return createHash("sha256").update(bytes).digest("hex") === entry.sha256;
}

export async function writeHostedMediaReferenceCatalogue(input: {
  catalogue: HostedMediaReferenceCatalogue;
  vaultRoot: string;
}): Promise<void> {
  const cataloguePath = resolveHostedMediaReferenceCataloguePath(input.vaultRoot);
  await mkdir(path.dirname(cataloguePath), {
    mode: 0o700,
    recursive: true,
  });
  const tempPath = `${cataloguePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(input.catalogue, null, 2)}\n`, {
      mode: 0o600,
    });
    await chmod(tempPath, 0o600);
    await rename(tempPath, cataloguePath);
  } finally {
    await rm(tempPath, { force: true });
  }
}

function parseHostedMediaReferenceCatalogue(
  value: unknown,
): HostedMediaReferenceCatalogue {
  if (!isRecord(value) || value.schema !== HOSTED_MEDIA_REFS_SCHEMA || !Array.isArray(value.entries)) {
    return {
      entries: [],
      schema: HOSTED_MEDIA_REFS_SCHEMA,
    };
  }
  return {
    ...(typeof value.mealUploadCursor === "string" ? { mealUploadCursor: value.mealUploadCursor } : {}),
    entries: value.entries
      .map(parseHostedMediaReference)
      .filter((entry): entry is HostedMediaReference => entry !== null)
      .sort(compareHostedMediaReferences),
    schema: HOSTED_MEDIA_REFS_SCHEMA,
  };
}

function parseHostedMediaReference(value: unknown): HostedMediaReference | null {
  if (!isRecord(value)) {
    return null;
  }
  const relativePath = normalizeHostedMediaCataloguePath(value.relativePath);
  const mediaId = normalizeHostedMediaSha256(value.mediaId);
  const sha256 = normalizeHostedMediaSha256(value.sha256);
  const byteSize = normalizeHostedMediaByteSize(value.byteSize);
  const expiresAt = normalizeHostedMediaExpiresAt(value.expiresAt);
  const mediaKind = value.mediaKind === "image" || value.mediaKind === "video" || value.mediaKind === "integration-ingest"
    ? value.mediaKind
    : null;
  const recordedAt = normalizeHostedMediaRecordedAt(value.recordedAt);
  if (!relativePath || !mediaId || !sha256 || byteSize === null || !mediaKind) {
    return null;
  }
  return {
    byteSize,
    expiresAt,
    mediaId,
    mediaKind,
    mimeType: normalizeHostedMediaMimeType(value.mimeType),
    // Only the new namespace implies deferred delivery after an old writer
    // drops the marker. Legacy absence is settled, never a bulk upload request.
    ...(isHostedMealMediaV2Path(relativePath) ? { pendingUpload: value.pendingUpload !== false } : {}),
    recordedAt,
    relativePath,
    sha256,
  };
}

function dedupeHostedMediaCandidates(
  candidates: readonly HostedMediaCandidate[],
): HostedMediaCandidate[] {
  const byPath = new Map<string, HostedMediaCandidate>();
  for (const candidate of candidates) {
    const existing = byPath.get(candidate.relativePath);
    if (!existing || Date.parse(candidate.recordedAt) < Date.parse(existing.recordedAt)) {
      byPath.set(candidate.relativePath, candidate);
    }
  }
  return [...byPath.values()].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}

function dedupeHostedMediaReferenceEntries(
  entries: readonly HostedMediaReference[],
): HostedMediaReference[] {
  const byPath = new Map<string, HostedMediaReference>();
  for (const entry of entries) {
    byPath.set(entry.relativePath, entry);
  }
  return [...byPath.values()].sort(compareHostedMediaReferences);
}

function compareHostedMediaReferences(
  left: HostedMediaReference,
  right: HostedMediaReference,
): number {
  return left.relativePath.localeCompare(right.relativePath)
    || left.mediaId.localeCompare(right.mediaId);
}

function readHostedMediaKindFromInboxAttachment(
  attachment: InboxCaptureAttachmentRecord,
): HostedRuntimeMediaKind | null {
  if (attachment.kind === "image" || attachment.kind === "video") {
    return attachment.kind;
  }
  return null;
}

function resolveHostedMediaReferenceExpiresAt(input: {
  mediaKind: HostedRuntimeMediaKind;
  recordedAt: string;
}): string {
  const recordedAtMs = Date.parse(input.recordedAt);
  const baseMs = Number.isFinite(recordedAtMs) ? recordedAtMs : 0;
  const windowMs = input.mediaKind === "image"
    ? INBOX_IMAGE_RETENTION_WINDOW_MS
    : INBOX_VIDEO_RETENTION_WINDOW_MS;
  return new Date(baseMs + windowMs).toISOString();
}

function resolveUpdatedHostedMediaExpiresAt(
  existing: string | null,
  candidate: string | null,
): string | null {
  if (candidate === null) {
    return null;
  }
  if (existing === null) {
    return candidate;
  }
  return Date.parse(existing) <= Date.parse(candidate) ? existing : candidate;
}

function readHostedMediaKindFromPath(relativePath: string): HostedRuntimeMediaKind | null {
  const extension = path.posix.extname(relativePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg" || extension === ".png" || extension === ".webp") {
    return "image";
  }
  if (extension === ".mp4" || extension === ".mov" || extension === ".webm") {
    return "video";
  }
  return null;
}

function readHostedMediaMimeTypeFromPath(relativePath: string): string | null {
  const extension = path.posix.extname(relativePath).toLowerCase();
  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    default:
      return null;
  }
}

function normalizeHostedMediaVaultPath(
  value: unknown,
  requiredPrefix: string,
): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  try {
    const normalized = normalizeRelativeVaultPath(value);
    return normalized.startsWith(requiredPrefix) ? normalized : null;
  } catch {
    return null;
  }
}

function normalizeHostedMediaCataloguePath(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  try {
    const normalized = normalizeRelativeVaultPath(value);
    if (
      normalized.startsWith(RAW_INBOX_PREFIX)
      || normalized.startsWith(RAW_CAPTURES_PREFIX)
      || normalized.startsWith(RAW_MEALS_PREFIX)
      || hostedColdIngestMonth(normalized) !== null
    ) {
      return normalized;
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeHostedMediaSha256(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) ? value : null;
}

function normalizeHostedMediaByteSize(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function normalizeHostedMediaExpiresAt(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function normalizeHostedMediaMimeType(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized && normalized.length <= 128 ? normalized : null;
}

function normalizeHostedMediaRecordedAt(value: unknown): string {
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) {
      return new Date(ms).toISOString();
    }
  }
  return new Date(0).toISOString();
}

function minHostedMediaRecordedAt(left: string, right: string): string {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function assertHostedMediaReferenceLive(
  signal: AbortSignal | null | undefined,
): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Hosted media reference publication was interrupted.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
