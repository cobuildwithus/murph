import type { AssistantWorkspaceArtifactUnavailableReason, AssistantWorkspaceArtifactMaterializationResult } from "@murphai/assistant-engine";
import { HostedRuntimeMediaReadError, HostedRuntimeMediaWriteError } from "./platform.ts";
import { createHostedMediaReferenceId } from "@murphai/hosted-execution";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
  inferRawAssetOwnerFromDirectory,
  canonicalRawArtifactIsPrivacyTombstone,
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
  isHostedMealMediaV2Path,
  type HostedMediaReference,
  type HostedMediaReferenceCatalogue,
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
  return isHostedCanonicalPhotoPath(entry.relativePath) && entry.pendingUpload === true;
}

export function hostedPhotoNeedsRetry(entry: HostedMediaReference): boolean {
  return isHostedPendingMealMedia(entry) && (entry.uploadAttempts ?? 0) < 5;
}

function blockHostedPhotoIntent(vaultRoot: string, mediaId: string): void {
  const blocked = uncommittedPhotoIntents.get(vaultRoot) ?? new Set<string>();
  blocked.add(mediaId);
  uncommittedPhotoIntents.set(vaultRoot, blocked);
}

// A warm workspace can retain a failed checkpoint's local catalogue. Only the
// exact accepted archive (or a cold restore) releases upload and retirement intents.
const uncommittedPhotoIntents = new Map<string, Set<string>>();
export function hostedPhotoIntentIsCommitted(vaultRoot: string, mediaId: string): boolean {
  return !uncommittedPhotoIntents.get(vaultRoot)?.has(mediaId);
}
export function releaseHostedPhotoIntents(vaultRoot: string, mediaIds: readonly string[], accepted = true): void {
  if (!accepted) return;
  const blocked = uncommittedPhotoIntents.get(vaultRoot);
  for (const id of mediaIds) blocked?.delete(id);
  if (!blocked?.size) uncommittedPhotoIntents.delete(vaultRoot);
}
export function resetHostedPhotoIntentsAfterColdRestore(vaultRoot: string): void {
  uncommittedPhotoIntents.delete(vaultRoot);
}

export { isHostedMealMediaV2Path } from "@murphai/runtime-state/node";
export type { HostedMediaReference, HostedMediaReferenceCatalogue } from "@murphai/runtime-state/node";

const RAW_CAPTURES_PREFIX = `${VAULT_LAYOUT.rawCapturesDirectory}/`;
// Must exceed the routine 7-day lookback so month-start polls do not thaw and re-upload history.
const COLD_INGEST_DELAY_MS = 10 * 24 * 60 * 60 * 1000;

export interface PublishHostedWorkspaceMediaReferencesResult {
  pendingPhotoMediaIds: string[];
  retirementPendingMediaIds: string[];
  hasRetryablePendingPhotos: boolean;
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
      pendingPhotoMediaIds: [],
      retirementPendingMediaIds: [],
      hasRetryablePendingPhotos: false,
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
  entries.push(...existingCatalogue.entries.filter(entry => entry.pendingUpload === true && !nextMediaIds.has(entry.mediaId)));
  let prunedMediaCount = 0;
  for (const entry of existingCatalogue.entries) {
    assertHostedMediaReferenceLive(input.signal);
    if (nextMediaIds.has(entry.mediaId) || entry.pendingUpload === true) {
      continue;
    }
    // The accepted archive must hold the tombstone before its sole remote copy is deleted.
    if (isHostedCanonicalPhotoPath(entry.relativePath)
      && (!entry.retirementPending || !hostedPhotoIntentIsCommitted(input.vaultRoot, entry.mediaId))) {
      if (!entry.retirementPending) blockHostedPhotoIntent(input.vaultRoot, entry.mediaId);
      entries.push({ ...entry, retirementPending: true });
      continue;
    }
    try {
      await input.mediaStore.delete?.({ mediaId: entry.mediaId });
    } catch (error) {
      assertHostedMediaReferenceLive(input.signal);
      if (!entry.retirementPending || !isHostedCanonicalPhotoPath(entry.relativePath)
        || !(error instanceof HostedRuntimeMediaWriteError)) throw error;
      entries.push(entry);
      continue;
    }
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

  const excludedVaultPaths: string[] = [];
  let hasRetryablePendingPhotos = entries.some(hostedPhotoNeedsRetry);
  for (const entry of entries) {
    if (isHostedPendingMealMedia(entry) && !await hostedPhotoReferenceMayBeLive(input.vaultRoot, entry)) {
      hasRetryablePendingPhotos = true;
    }
    if (hostedMediaReferenceIsSettled(entry) && await hostedMediaReferenceDenialReason(input.vaultRoot, entry) === null) {
      excludedVaultPaths.push(entry.relativePath);
    }
  }
  return {
    pendingPhotoMediaIds: entries.filter(isHostedPendingMealMedia).map(entry => entry.mediaId),
    retirementPendingMediaIds: entries.filter(entry => entry.retirementPending).map(entry => entry.mediaId),
    hasRetryablePendingPhotos,
    excludedVaultPaths,
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
  const candidates = await collectHostedMediaCandidates(input.vaultRoot, input.signal, input.includeColdIngests === true);
  const now = Date.now();
  const currentMonth = new Date(now).toISOString().slice(0, 7);
  const coldIngestCutoffMonth = new Date(now - COLD_INGEST_DELAY_MS).toISOString().slice(0, 7);
  const ingestPaths = input.includeColdIngests
    ? new Set(await walkVaultFiles(input.vaultRoot, VAULT_LAYOUT.integrationIngestLedgerDirectory))
    : new Set<string>();
  for (const relativePath of ingestPaths) {
    const month = hostedColdIngestMonth(relativePath);
    if (!month || month >= coldIngestCutoffMonth || existingByPath.has(relativePath)) continue;
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
  nextEntries.push(...await collectRetainedPhotoReferences(input, existingCatalogue.entries));
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
      && !existing.retirementPending
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

// Preservation follows canonical retained ownership, independently of upload
// candidates. Measurement deletion keeps raw evidence; meal retirement does not.
async function collectRetainedPhotoReferences(
  input: { vaultRoot: string; signal?: AbortSignal | null },
  entries: readonly HostedMediaReference[],
): Promise<HostedMediaReference[]> {
  const retained: HostedMediaReference[] = [];
  for (const entry of entries) {
    assertHostedMediaReferenceLive(input.signal);
    if (!entry.retirementPending && isHostedCanonicalPhotoPath(entry.relativePath)
      && await hostedPhotoReferenceMayBeLive(input.vaultRoot, entry)) retained.push(entry);
  }
  return retained;
}

// Dropping an entry deletes its object, which may be the only copy. Prove a
// reference obsolete before pruning, and let doubt keep the object.
export async function hostedPhotoReferenceMayBeLive(vaultRoot: string, entry: HostedMediaReference): Promise<boolean> {
  if (entry.relativePath.startsWith("raw/measurements/")) return true;
  try {
    return !await canonicalRawArtifactIsPrivacyTombstone({ vaultRoot, relativePath: entry.relativePath });
  } catch {
    return true;
  }
}

export async function materializeHostedWorkspaceMediaReferences(input: {
  mediaStore?: HostedRuntimeMediaStore | null;
  relativePaths: readonly string[];
  signal?: AbortSignal | null;
  vaultRoot: string;
  options?: { maxFileBytes?: number; maxTotalDownloadBytes?: number };
}): Promise<AssistantWorkspaceArtifactMaterializationResult> {
  let downloadedBytes = 0;
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
    const unavailable = await hostedMediaReferenceUnavailableReason(input, entry);
    if (unavailable) {
      missingArtifactPaths.set(key, unavailable);
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

    if (entry.pendingUpload === true) {
      missingArtifactPaths.set(key, "missing");
      continue;
    }
    if (!input.mediaStore) {
      missingArtifactPaths.set(key, "transport");
      continue;
    }
    // Policy and the local cache already ran, so only a real download is charged.
    if (downloadedBytes + entry.byteSize > (input.options?.maxTotalDownloadBytes ?? Infinity)) {
      missingArtifactPaths.set(key, "size");
      continue;
    }
    downloadedBytes += entry.byteSize;
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
        // A backfill can detach or replace a later month's descriptor while an
        // earlier download runs. Its local shard is now the canonical truth.
        if (!await hostedColdIngestReferenceIsCurrent(input.vaultRoot, entry)) {
          const resolved = await resolveVaultPathOnDisk(input.vaultRoot, entry.relativePath);
          if (await lstat(resolved.absolutePath).then(file => file.isFile(), () => false)) materializedArtifactPaths.add(key);
          else missingArtifactPaths.set(key, "missing");
          return;
        }
        const denial = await hostedMediaReferenceDenialReason(input.vaultRoot, entry);
        if (denial) {
          missingArtifactPaths.set(key, denial);
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

// Leaving the archive makes the store the only copy. A photo needs positive proof
// of delivery: an absent marker only means "do not bulk upload this legacy entry".
function hostedMediaReferenceIsSettled(entry: HostedMediaReference): boolean {
  return isHostedCanonicalPhotoPath(entry.relativePath) ? entry.pendingUpload === false : entry.pendingUpload !== true;
}

async function hostedMediaReferenceDenialReason(vaultRoot: string, entry: HostedMediaReference): Promise<AssistantWorkspaceArtifactUnavailableReason | null> {
  if (entry.retirementPending) return "obsolete";
  if (!isHostedCanonicalPhotoPath(entry.relativePath)) return null;
  try {
    return await canonicalRawArtifactMatches({ vaultRoot, ...entry }) ? null : "obsolete";
  } catch (error) {
    return isHostedMediaCanonicalLockBusy(error) ? "transport" : "integrity";
  }
}

async function hostedMediaReferenceUnavailableReason(
  input: { vaultRoot: string; signal?: AbortSignal | null; options?: { maxFileBytes?: number } },
  entry: HostedMediaReference,
): Promise<AssistantWorkspaceArtifactUnavailableReason | null> {
  const denial = await hostedMediaReferenceDenialReason(input.vaultRoot, entry);
  if (denial) return denial;
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
    return "expired";
  }
  return input.options?.maxFileBytes !== undefined && entry.byteSize > input.options.maxFileBytes ? "size" : null;
}

async function hostedColdIngestReferenceIsCurrent(vaultRoot: string, entry: HostedMediaReference): Promise<boolean> {
  if (entry.mediaKind !== "integration-ingest") return true;
  return (await readHostedMediaReferenceCatalogue({ vaultRoot })).entries.some(current =>
    current.relativePath === entry.relativePath && current.mediaId === entry.mediaId && current.sha256 === entry.sha256);
}

// Foreground attachment reads reach this path, so inbox and capture media must
// never queue behind a canonical writer. Photos can race retirement tombstones;
// cold ingest shards can race a backfill. Their final installs need exclusion.
function withHostedMediaInstallGuard<T>(
  vaultRoot: string, entry: HostedMediaReference, run: () => Promise<T>,
): Promise<T> {
  return isHostedCanonicalPhotoPath(entry.relativePath) || entry.mediaKind === "integration-ingest"
    ? withCanonicalWriteLock(vaultRoot, run) : run();
}

function isHostedMediaCanonicalLockBusy(error: unknown): boolean {
  return isVaultError(error) && error.code === "CANONICAL_WRITE_LOCKED";
}

export async function readHostedMediaReferenceCatalogue(input: {
  vaultRoot: string;
}): Promise<HostedMediaReferenceCatalogue> {
  return readHostedMediaReferenceCatalogueValue(input.vaultRoot);
}

async function collectHostedMediaCandidates(
  vaultRoot: string,
  signal: AbortSignal | null | undefined,
  discoverPhotos: boolean,
): Promise<HostedMediaCandidate[]> {
  const eventInventory = await collectHostedMediaEventInventory(vaultRoot, signal);
  return dedupeHostedMediaCandidates([
    ...await collectInboxHostedMediaCandidates({
      durableRawInboxRefs: eventInventory.durableRawInboxRefs,
      signal,
      vaultRoot,
    }),
    ...collectCaptureHostedMediaCandidates(eventInventory.latestEvents),
    ...(discoverPhotos ? collectPhotoCandidates(eventInventory.latestEvents) : []),
  ]);
}

function collectPhotoCandidates(records: readonly EventRecord[]): HostedMediaCandidate[] {
  const candidates: HostedMediaCandidate[] = [];
  for (const record of records) {
    const lifetime = photoUploadLifetime(record);
    if (!lifetime) continue;
    const { capturedAt, expiresAt } = lifetime;
    for (const attachment of record.attachments ?? []) {
      const owner = inferRawAssetOwnerFromDirectory(path.posix.dirname(attachment.relativePath));
      if (owner?.kind !== (record.kind === "meal" ? "meal" : "measurement") || owner.id !== (record.kind === "meal" ? record.mealId : record.id)) continue;
      if (!isHostedCanonicalPhotoPath(attachment.relativePath)
        || !attachment.mediaType.startsWith("image/")
        || (record.kind === "meal" && attachment.relativePath === record.photoThumbnail?.relativePath)) continue;
      candidates.push({ relativePath: attachment.relativePath, mediaKind: "image",
        byteSize: null, sha256: attachment.sha256,
        mimeType: attachment.mediaType, recordedAt: capturedAt, expiresAt });
    }
  }
  return candidates;
}

function photoUploadLifetime(record: EventRecord): { capturedAt: string; expiresAt: string | null } | null {
  if (record.lifecycle?.state === "deleted") return null;
  if (record.kind !== "meal" && record.kind !== "measurement" && record.kind !== "body_measurement") return null;
  if (record.kind === "meal" && (!record.photoThumbnail || !record.photoCapturedAt)) return null;
  const capturedAt = record.kind === "meal" ? record.photoCapturedAt! : record.recordedAt;
  if (Date.now() - Date.parse(capturedAt) < 7 * 86_400_000) return null;
  const expiresAt = record.kind === "meal"
    ? new Date(Date.parse(capturedAt) + INBOX_IMAGE_RETENTION_WINDOW_MS).toISOString() : null;
  return expiresAt && Date.parse(expiresAt) <= Date.now() ? null : { capturedAt, expiresAt };
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
  if (input.existing?.retirementPending) return null;
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
      ...input.existing,
      ...entry,
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
  // Full photos need an accepted checkpoint before any remote registration.
  // Thumbnail-v2 intent already has the canonical receipt durability boundary.
  if (isHostedCanonicalPhotoPath(entry.relativePath)) {
    const denial = await hostedMediaReferenceDenialReason(input.vaultRoot, entry);
    assertHostedMediaReferenceLive(input.signal);
    if (denial) return null;
    if (!isHostedMealMediaV2Path(entry.relativePath)) {
      blockHostedPhotoIntent(input.vaultRoot, entry.mediaId);
    }
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

function normalizeHostedMediaSha256(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) ? value : null;
}

function normalizeHostedMediaByteSize(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
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
