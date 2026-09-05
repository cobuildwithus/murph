import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  collectEventRawReferencePaths,
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
  VAULT_LAYOUT,
  walkVaultFiles,
} from "@murphai/core";
import {
  INBOX_MEDIA_RETENTION_WINDOW_MS,
  INBOX_VIDEO_RETENTION_WINDOW_MS,
  listInboxAttachmentRetentionRecords,
} from "@murphai/inboxd/retention";
import {
  resolveAssistantStatePaths,
} from "@murphai/runtime-state/node";

import { toHostedArtifactPathKey } from "./artifact-paths.ts";
import type {
  HostedRuntimeMediaKind,
  HostedRuntimeMediaStore,
} from "./platform.ts";
import {
  collectHostedPendingAssistantInputMediaRetentionProtections,
  type HostedPendingAssistantInputMediaRetentionProtections,
} from "./pending-input-index.ts";

export const HOSTED_MEDIA_REFS_RELATIVE_PATH =
  ".runtime/operations/assistant/hosted-media-refs.json";
export const HOSTED_MEDIA_REFS_SCHEMA = "murph.hosted-media-refs.v1";

const RAW_INBOX_PREFIX = `${VAULT_LAYOUT.rawInboxDirectory}/`;
const RAW_CAPTURES_PREFIX = `${VAULT_LAYOUT.rawCapturesDirectory}/`;

export interface HostedMediaReference {
  byteSize: number;
  expiresAt: string | null;
  mediaId: string;
  mediaKind: HostedRuntimeMediaKind;
  mimeType: string | null;
  recordedAt: string;
  relativePath: string;
  sha256: string;
}

export interface HostedMediaReferenceCatalogue {
  entries: HostedMediaReference[];
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
    return {
      excludedVaultPaths: [],
      prunedMediaCount: 0,
      referenceCount: 0,
      uploadedMediaCount: 0,
    };
  }

  const existingCatalogue = await readHostedMediaReferenceCatalogue({
    vaultRoot: input.vaultRoot,
  });
  const existingByPath = new Map(
    existingCatalogue.entries.map((entry) => [entry.relativePath, entry]),
  );
  const candidates = await collectHostedMediaCandidates(input.vaultRoot, input.signal);
  const nextEntries: HostedMediaReference[] = [];
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

  const dedupedEntries = dedupeHostedMediaReferenceEntries(nextEntries);
  await writeHostedMediaReferenceCatalogue({
    catalogue: {
      entries: dedupedEntries,
      schema: HOSTED_MEDIA_REFS_SCHEMA,
    },
    vaultRoot: input.vaultRoot,
  });

  const nextMediaIds = new Set(dedupedEntries.map((entry) => entry.mediaId));
  let prunedMediaCount = 0;
  for (const entry of existingCatalogue.entries) {
    assertHostedMediaReferenceLive(input.signal);
    if (nextMediaIds.has(entry.mediaId)) {
      continue;
    }
    await input.mediaStore.delete?.({ mediaId: entry.mediaId });
    prunedMediaCount += 1;
  }

  return {
    excludedVaultPaths: dedupedEntries.map((entry) => entry.relativePath),
    prunedMediaCount,
    referenceCount: dedupedEntries.length,
    uploadedMediaCount,
  };
}

export async function materializeHostedWorkspaceMediaReferences(input: {
  materializedArtifactPaths: Set<string>;
  mediaStore?: HostedRuntimeMediaStore | null;
  relativePaths: readonly string[];
  signal?: AbortSignal | null;
  vaultRoot: string;
  options?: { maxFileBytes?: number };
}): Promise<{
  materializedArtifactPaths: Set<string>;
  missingArtifactPaths: Set<string>;
}> {
  const materializedArtifactPaths = new Set<string>();
  const missingArtifactPaths = new Set<string>();
  if (!input.mediaStore || input.relativePaths.length === 0) {
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
      missingArtifactPaths.add(key);
      continue;
    }
    if (entry.expiresAt !== null && Date.parse(entry.expiresAt) <= Date.now()) {
      const resolved = await resolveVaultPathOnDisk(input.vaultRoot, entry.relativePath);
      await rm(resolved.absolutePath, { force: true });
      input.materializedArtifactPaths.delete(key);
      missingArtifactPaths.add(key);
      continue;
    }
    if (await localHostedMediaReferenceIsValid({
      entry,
      signal: input.signal,
      vaultRoot: input.vaultRoot,
    })) {
      input.materializedArtifactPaths.add(key);
      materializedArtifactPaths.add(key);
      continue;
    }

    const bytes = await input.mediaStore.get(
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
    assertHostedMediaReferenceLive(input.signal);
    if (!bytes) {
      missingArtifactPaths.add(key);
      continue;
    }
    if (!hostedMediaBytesMatchEntry(bytes, entry)) {
      missingArtifactPaths.add(key);
      continue;
    }

    await installHostedMediaReference({
      bytes,
      entry,
      vaultRoot: input.vaultRoot,
    });
    input.materializedArtifactPaths.add(key);
    materializedArtifactPaths.add(key);
  }

  return { materializedArtifactPaths, missingArtifactPaths };
}

export async function readHostedMediaReferenceCatalogue(input: {
  vaultRoot: string;
}): Promise<HostedMediaReferenceCatalogue> {
  try {
    const raw = await readFile(resolveHostedMediaReferenceCataloguePath(input.vaultRoot), "utf8");
    return parseHostedMediaReferenceCatalogue(JSON.parse(raw) as unknown);
  } catch {
    return {
      entries: [],
      schema: HOSTED_MEDIA_REFS_SCHEMA,
    };
  }
}

async function collectHostedMediaCandidates(
  vaultRoot: string,
  signal: AbortSignal | null | undefined,
): Promise<HostedMediaCandidate[]> {
  const [eventInventory, pendingProtections] = await Promise.all([
    collectHostedMediaEventInventory(vaultRoot, signal),
    collectHostedPendingAssistantInputMediaRetentionProtections({ vaultRoot }),
  ]);
  return dedupeHostedMediaCandidates([
    ...await collectInboxHostedMediaCandidates({
      durableRawInboxRefs: eventInventory.durableRawInboxRefs,
      pendingProtections,
      signal,
      vaultRoot,
    }),
    ...collectCaptureHostedMediaCandidates(eventInventory.latestEvents),
  ]);
}

async function collectInboxHostedMediaCandidates(input: {
  durableRawInboxRefs: ReadonlySet<string>;
  pendingProtections: HostedPendingAssistantInputMediaRetentionProtections;
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
      const pendingProtected = !preserved && inboxAttachmentHasPendingProtection({
        attachment,
        capture,
        pendingProtections: input.pendingProtections,
        storedPath,
      });
      candidates.push({
        byteSize: normalizeHostedMediaByteSize(attachment.byteSize),
        expiresAt: preserved
          ? null
          : resolveHostedMediaReferenceExpiresAt({
              mediaKind,
              pendingProtected,
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
    for (const rawRef of collectEventRawReferencePaths(record)) {
      const normalized = normalizeHostedMediaVaultPath(rawRef, RAW_CAPTURES_PREFIX);
      const mediaKind = normalized ? readHostedMediaKindFromPath(normalized) : null;
      if (!mediaKind || !normalized) {
        continue;
      }
      candidates.push({
        byteSize: null,
        expiresAt: isGeneratedImageCaptureEvent(record)
          ? new Date(Date.parse(record.recordedAt) + GENERATED_IMAGE_CAPTURE_RETENTION_WINDOW_MS).toISOString()
          : null,
        mediaKind,
        mimeType: readHostedMediaMimeTypeFromPath(normalized),
        recordedAt: normalizeHostedMediaRecordedAt(record.recordedAt),
        relativePath: normalized,
        sha256: null,
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
  const latestEvents = new Map<string, EventRecord>();
  for (const relativePath of await listEventLedgerShardPaths(vaultRoot)) {
    assertHostedMediaReferenceLive(signal);
    for (const rawRecord of await readJsonlRecords({ vaultRoot, relativePath })) {
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
      if (!current || compareHostedEventRevision(parsed.data, current) > 0) {
        latestEvents.set(parsed.data.id, parsed.data);
      }
    }
  }
  return {
    durableRawInboxRefs,
    latestEvents: [...latestEvents.values()],
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

function createHostedMediaReferenceId(input: {
  byteSize: number;
  mediaKind: HostedRuntimeMediaKind;
  relativePath: string;
  sha256: string;
}): string {
  return createHash("sha256")
    .update("murph.hosted-media-ref.v1")
    .update("\0")
    .update(input.mediaKind)
    .update("\0")
    .update(input.relativePath)
    .update("\0")
    .update(input.sha256)
    .update("\0")
    .update(String(input.byteSize))
    .digest("hex");
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
    await writeFile(tempPath, input.bytes, { mode: 0o600 });
    await chmod(tempPath, 0o600);
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

function resolveHostedMediaReferenceCataloguePath(vaultRoot: string): string {
  return path.join(
    resolveAssistantStatePaths(path.resolve(vaultRoot)).assistantStateRoot,
    "hosted-media-refs.json",
  );
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
  const mediaKind = value.mediaKind === "image" || value.mediaKind === "video"
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

function compareHostedEventRevision(left: EventRecord, right: EventRecord): number {
  const revisionDelta = (left.lifecycle?.revision ?? 1) - (right.lifecycle?.revision ?? 1);
  if (revisionDelta !== 0) {
    return revisionDelta;
  }
  const recordedAtDelta = Date.parse(left.recordedAt) - Date.parse(right.recordedAt);
  if (recordedAtDelta !== 0) {
    return recordedAtDelta;
  }
  return Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
}

function readHostedMediaKindFromInboxAttachment(
  attachment: InboxCaptureAttachmentRecord,
): HostedRuntimeMediaKind | null {
  if (attachment.kind === "image" || attachment.kind === "video") {
    return attachment.kind;
  }
  return null;
}

function inboxAttachmentHasPendingProtection(input: {
  attachment: InboxCaptureAttachmentRecord;
  capture: InboxCaptureRecord;
  pendingProtections: HostedPendingAssistantInputMediaRetentionProtections;
  storedPath: string;
}): boolean {
  return input.pendingProtections.protectedStoredPaths.includes(input.storedPath)
    || input.pendingProtections.protectedAttachmentIds.includes(input.attachment.attachmentId)
    || input.pendingProtections.protectedCaptureIds.includes(input.capture.captureId);
}

function resolveHostedMediaReferenceExpiresAt(input: {
  mediaKind: HostedRuntimeMediaKind;
  pendingProtected: boolean;
  recordedAt: string;
}): string {
  const recordedAtMs = Date.parse(input.recordedAt);
  const baseMs = Number.isFinite(recordedAtMs) ? recordedAtMs : 0;
  const windowMs = input.pendingProtected || input.mediaKind === "image"
    ? INBOX_MEDIA_RETENTION_WINDOW_MS
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
