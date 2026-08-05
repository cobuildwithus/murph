import { createHash } from "node:crypto";
import path from "node:path";

import {
  eventRecordSchema,
  rawImportManifestSchema,
  type EventRecord,
  type RawImportManifest,
} from "@murphai/contracts";

import { emitAuditRecord } from "../../audit.ts";
import { VaultError } from "../../errors.ts";
import { readUtf8File } from "../../fs.ts";
import {
  eventSpineRevision,
  isDeletedEventSpineRecord,
  selectLatestEventSpineEntry,
} from "../../history/event-spine.ts";
import { readJsonlRecords } from "../../jsonl.ts";
import { withCanonicalWriteLock } from "../../operations/canonical-write-lock.ts";
import {
  runCanonicalWrite,
  type CommittedPayloadReceipt,
} from "../../operations/write-batch.ts";
import { normalizeRelativeVaultPath } from "../../path-safety.ts";
import { statAndHashVaultFile } from "../../raw-artifact-integrity.ts";
import { loadVault } from "../../vault.ts";
import {
  CAPTURE_LOOKUP_INDEX_PATH,
  CAPTURE_LOOKUP_SCHEMA,
  isCaptureLookupBackedEvent,
  readStoredCaptureLookupIndex,
  type StoredCaptureLookup,
  type StoredCaptureLookupIndex,
} from "./capture-lookup.ts";
import { buildDeletedEventTombstone } from "./ledger.ts";

export const GENERATED_IMAGE_CAPTURE_RETENTION_DAYS = 14;
export const GENERATED_IMAGE_CAPTURE_RETENTION_WINDOW_MS =
  GENERATED_IMAGE_CAPTURE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
export const GENERATED_IMAGE_CAPTURE_SOURCE = "murph.generate_image";
export const GENERATED_IMAGE_CAPTURE_PROVENANCE_SCHEMA = "murph.generated-image.v1";
export const GENERATED_IMAGE_CAPTURE_TAGS = [
  "assistant-generated-image",
  "generated-image",
] as const;

const GENERATED_IMAGE_RETENTION_REASON = "generated_image_retention";
const GENERATED_IMAGE_RETENTION_TOMBSTONE_SCHEMA =
  "murph.generated-image-retention-tombstone.v1";
const GENERATED_IMAGE_RETENTION_PROTECTED_RECHECK_MS = 24 * 60 * 60 * 1000;
const DEFAULT_GENERATED_IMAGE_RETENTION_BATCH_SIZE = 100;

export interface RunGeneratedImageCaptureRetentionInput {
  maxCaptures?: number;
  now?: Date;
  protectedCaptureIds?: Iterable<string>;
  protectedStoredPaths?: Iterable<string>;
  signal?: AbortSignal | null;
  vaultRoot: string;
}

export interface RunGeneratedImageCaptureRetentionResult {
  hasMoreEligibleCaptures: boolean;
  nextEligibleAt: string | null;
  retiredByteCount: number;
  retiredCaptureCount: number;
  scannedCaptureCount: number;
}

interface ManifestSnapshot {
  contentReceipt: CommittedPayloadReceipt;
  manifest: RawImportManifest;
  relativePath: string;
}

interface GeneratedImageRetentionCandidate {
  attachmentRef: string;
  eventId: string;
  ledgerFile: string;
  lookupKeyHash: string;
  manifest: ManifestSnapshot;
  nextEventRecord: EventRecord | null;
  originalReceipt: CommittedPayloadReceipt;
  tombstoneContent: string;
}

export async function runGeneratedImageCaptureRetention(
  input: RunGeneratedImageCaptureRetentionInput,
): Promise<RunGeneratedImageCaptureRetentionResult> {
  throwIfGeneratedImageRetentionAborted(input.signal);
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new VaultError("INVALID_INPUT", "Generated-image retention now must be a valid date.");
  }
  const maxCaptures = normalizeBatchSize(input.maxCaptures);
  if (maxCaptures === 0) {
    return emptyRetentionResult();
  }

  return withCanonicalWriteLock(input.vaultRoot, async () => {
    await loadVault({ vaultRoot: input.vaultRoot });
    return runGeneratedImageCaptureRetentionLocked({
      ...input,
      maxCaptures,
      now,
    });
  });
}

async function runGeneratedImageCaptureRetentionLocked(
  input: Omit<RunGeneratedImageCaptureRetentionInput, "maxCaptures" | "now"> & {
    maxCaptures: number;
    now: Date;
  },
): Promise<RunGeneratedImageCaptureRetentionResult> {
  const lookupIndex = await readStoredCaptureLookupIndex({
    vaultRoot: input.vaultRoot,
  });
  const lookupEntries = Object.entries(lookupIndex.entries)
    .sort(([left], [right]) => left.localeCompare(right));
  if (lookupEntries.length === 0) {
    return emptyRetentionResult();
  }

  const lookupIntegrity = await statAndHashVaultFile(
    input.vaultRoot,
    CAPTURE_LOOKUP_INDEX_PATH,
  );
  if (!lookupIntegrity) {
    throw new VaultError(
      "GENERATED_IMAGE_RETENTION_LOOKUP_INVALID",
      "Generated-image lookup index disappeared during retention planning.",
    );
  }
  const lookupReceipt = toCommittedReceipt(lookupIntegrity);
  const protectedCaptureIds = new Set(input.protectedCaptureIds ?? []);
  const protectedStoredPaths = normalizeProtectedStoredPaths(
    input.protectedStoredPaths ?? [],
  );
  const protectedRecheckAt = new Date(
    input.now.getTime() + GENERATED_IMAGE_RETENTION_PROTECTED_RECHECK_MS,
  ).toISOString();
  const ledgerRecords = new Map<string, EventRecord[]>();
  const candidates: GeneratedImageRetentionCandidate[] = [];
  let hasMoreEligibleCaptures = false;
  let nextEligibleAt: string | null = null;
  let scannedCaptureCount = 0;

  for (const [lookupKeyHash, lookup] of lookupEntries) {
    throwIfGeneratedImageRetentionAborted(input.signal);
    if (lookup.retiredAt) {
      continue;
    }
    scannedCaptureCount += 1;

    const records = await readLookupEventRecords({
      cache: ledgerRecords,
      ledgerFile: lookup.ledgerFile,
      vaultRoot: input.vaultRoot,
    });
    const spine = records
      .filter((record) => record.id === lookup.eventId)
      .map((record) => ({ relativePath: lookup.ledgerFile, record }));
    const latest = selectLatestEventSpineEntry(spine);
    const origin = spine
      .map(({ record }) => record)
      .sort((left, right) => eventSpineRevision(left) - eventSpineRevision(right))[0];
    if (!latest || !origin) {
      throw new VaultError(
        "GENERATED_IMAGE_RETENTION_EVENT_MISSING",
        "Generated-image lookup target event is missing.",
        { relativePath: lookup.ledgerFile },
      );
    }
    if (!isGeneratedImageCaptureEvent(origin)) {
      continue;
    }
    assertGeneratedImageLookupEvent({ lookup, origin });

    const recordedAtMs = Date.parse(origin.recordedAt);
    if (!Number.isFinite(recordedAtMs)) {
      throw new VaultError(
        "GENERATED_IMAGE_RETENTION_EVENT_INVALID",
        "Generated-image capture recordedAt is invalid.",
        { relativePath: lookup.ledgerFile },
      );
    }
    const eligibleAtMs = recordedAtMs + GENERATED_IMAGE_CAPTURE_RETENTION_WINDOW_MS;
    if (eligibleAtMs > input.now.getTime()) {
      nextEligibleAt = selectEarlierTimestamp(
        nextEligibleAt,
        new Date(eligibleAtMs).toISOString(),
      );
      continue;
    }

    if (
      protectedCaptureIds.has(lookup.eventId) ||
      protectedStoredPaths.has(lookup.attachmentRef) ||
      (lookup.manifestPath !== null && protectedStoredPaths.has(lookup.manifestPath))
    ) {
      nextEligibleAt = selectEarlierTimestamp(nextEligibleAt, protectedRecheckAt);
      continue;
    }

    if (candidates.length >= input.maxCaptures) {
      hasMoreEligibleCaptures = true;
      break;
    }
    candidates.push(await prepareRetentionCandidate({
      latest: latest.record,
      lookup,
      lookupKeyHash,
      now: input.now,
      origin,
      signal: input.signal,
      vaultRoot: input.vaultRoot,
    }));
  }

  if (candidates.length === 0) {
    return {
      hasMoreEligibleCaptures,
      nextEligibleAt,
      retiredByteCount: 0,
      retiredCaptureCount: 0,
      scannedCaptureCount,
    };
  }

  const purgedAt = input.now.toISOString();
  const nextLookupIndex: StoredCaptureLookupIndex = structuredClone(lookupIndex);
  for (const candidate of candidates) {
    const entry = nextLookupIndex.entries[candidate.lookupKeyHash];
    if (!entry) {
      throw new VaultError(
        "GENERATED_IMAGE_RETENTION_LOOKUP_INVALID",
        "Generated-image lookup entry disappeared during retention planning.",
      );
    }
    entry.retiredAt = purgedAt;
  }

  const retiredByteCount = candidates.reduce(
    (total, candidate) => total + candidate.originalReceipt.byteLength,
    0,
  );
  await runCanonicalWrite({
    assertCanContinue: () => throwIfGeneratedImageRetentionAborted(input.signal),
    mutate: async ({ batch }) => {
      const ledgerAppends = new Map<string, string[]>();
      for (const candidate of candidates) {
        await batch.stageTextWrite(
          candidate.attachmentRef,
          candidate.tombstoneContent,
          {
            allowRaw: true,
            expectedTargetReceipt: candidate.originalReceipt,
            overwrite: true,
          },
        );
        await batch.stageTextWrite(
          candidate.manifest.relativePath,
          `${JSON.stringify(candidate.manifest.manifest, null, 2)}\n`,
          {
            allowRaw: true,
            expectedTargetReceipt: candidate.manifest.contentReceipt,
            overwrite: true,
          },
        );
        if (candidate.nextEventRecord) {
          const records = ledgerAppends.get(candidate.ledgerFile) ?? [];
          records.push(JSON.stringify(candidate.nextEventRecord));
          ledgerAppends.set(candidate.ledgerFile, records);
        }
      }
      for (const [ledgerFile, records] of ledgerAppends) {
        await batch.stageJsonlAppend(ledgerFile, `${records.join("\n")}\n`);
      }
      await batch.stageTextWrite(
        CAPTURE_LOOKUP_INDEX_PATH,
        `${JSON.stringify(nextLookupIndex, null, 2)}\n`,
        {
          expectedTargetReceipt: lookupReceipt,
          overwrite: true,
        },
      );
      await emitAuditRecord({
        action: "event_delete",
        batch,
        commandName: "core.runGeneratedImageCaptureRetention",
        files: [
          CAPTURE_LOOKUP_INDEX_PATH,
          ...new Set(candidates.flatMap((candidate) => [
            candidate.attachmentRef,
            candidate.manifest.relativePath,
            ...(candidate.nextEventRecord ? [candidate.ledgerFile] : []),
          ])),
        ],
        occurredAt: input.now,
        summary: `Retired ${candidates.length} assistant-generated image capture(s).`,
        targetIds: candidates.map((candidate) => candidate.eventId),
        vaultRoot: input.vaultRoot,
      });
    },
    occurredAt: input.now,
    operationType: "generated_image_capture_retention",
    summary: `Retire ${candidates.length} assistant-generated image capture(s)`,
    vaultRoot: input.vaultRoot,
  });

  return {
    hasMoreEligibleCaptures,
    nextEligibleAt,
    retiredByteCount,
    retiredCaptureCount: candidates.length,
    scannedCaptureCount,
  };
}

async function prepareRetentionCandidate(input: {
  latest: EventRecord;
  lookup: StoredCaptureLookup;
  lookupKeyHash: string;
  now: Date;
  origin: EventRecord;
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<GeneratedImageRetentionCandidate> {
  throwIfGeneratedImageRetentionAborted(input.signal);
  const attachment = input.origin.attachments?.find(
    (candidate) => candidate.relativePath === input.lookup.attachmentRef,
  );
  if (!attachment) {
    throw new VaultError(
      "GENERATED_IMAGE_RETENTION_ATTACHMENT_INVALID",
      "Generated-image capture attachment is missing.",
      { relativePath: input.lookup.attachmentRef },
    );
  }
  const originalIntegrity = await statAndHashVaultFile(
    input.vaultRoot,
    input.lookup.attachmentRef,
  );
  if (
    !originalIntegrity ||
    originalIntegrity.sha256 !== attachment.sha256
  ) {
    throw new VaultError(
      "GENERATED_IMAGE_RETENTION_PRECONDITION_FAILED",
      "Generated-image bytes changed after canonical capture.",
      { relativePath: input.lookup.attachmentRef },
    );
  }

  const manifest = await readGeneratedImageManifest({
    attachmentRef: input.lookup.attachmentRef,
    eventId: input.lookup.eventId,
    manifestPath: input.lookup.manifestPath,
    vaultRoot: input.vaultRoot,
  });
  const artifact = manifest.manifest.artifacts[0];
  if (
    !artifact ||
    artifact.relativePath !== input.lookup.attachmentRef ||
    artifact.byteSize !== originalIntegrity.byteSize ||
    artifact.sha256 !== originalIntegrity.sha256
  ) {
    throw new VaultError(
      "GENERATED_IMAGE_RETENTION_MANIFEST_INVALID",
      "Generated-image manifest no longer matches the retained image.",
      { relativePath: manifest.relativePath },
    );
  }

  const purgedAt = input.now.toISOString();
  const tombstoneContent = `${JSON.stringify({
    purgedAt,
    reason: GENERATED_IMAGE_RETENTION_REASON,
    schemaVersion: GENERATED_IMAGE_RETENTION_TOMBSTONE_SCHEMA,
  }, null, 2)}\n`;
  const tombstoneReceipt = createContentReceipt(tombstoneContent);
  artifact.byteSize = tombstoneReceipt.byteLength;
  artifact.mediaType = "application/json";
  artifact.originalFileName = "generated-image-retention-tombstone.json";
  artifact.role = "privacy_tombstone";
  artifact.sha256 = tombstoneReceipt.sha256;
  manifest.manifest.provenance = {
    ...manifest.manifest.provenance,
    generatedImageRetention: {
      purgedAt,
      reason: GENERATED_IMAGE_RETENTION_REASON,
      schema: GENERATED_IMAGE_RETENTION_TOMBSTONE_SCHEMA,
    },
  };

  return {
    attachmentRef: input.lookup.attachmentRef,
    eventId: input.lookup.eventId,
    ledgerFile: input.lookup.ledgerFile,
    lookupKeyHash: input.lookupKeyHash,
    manifest,
    nextEventRecord: isDeletedEventSpineRecord(input.latest)
      ? null
      : buildDeletedEventTombstone(input.latest, input.now),
    originalReceipt: toCommittedReceipt(originalIntegrity),
    tombstoneContent,
  };
}

async function readGeneratedImageManifest(input: {
  attachmentRef: string;
  eventId: string;
  manifestPath: string | null;
  vaultRoot: string;
}): Promise<ManifestSnapshot> {
  if (!input.manifestPath) {
    throw new VaultError(
      "GENERATED_IMAGE_RETENTION_MANIFEST_INVALID",
      "Generated-image capture lookup is missing its raw manifest.",
    );
  }
  const content = await readUtf8File(input.vaultRoot, input.manifestPath);
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new VaultError(
      "GENERATED_IMAGE_RETENTION_MANIFEST_INVALID",
      "Generated-image raw manifest is invalid JSON.",
      { relativePath: input.manifestPath },
    );
  }
  const parsed = rawImportManifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new VaultError(
      "GENERATED_IMAGE_RETENTION_MANIFEST_INVALID",
      "Generated-image raw manifest is invalid.",
      { relativePath: input.manifestPath },
    );
  }
  const generatedImage = parsed.data.provenance.generatedImage;
  if (
    parsed.data.importKind !== "capture" ||
    parsed.data.source !== GENERATED_IMAGE_CAPTURE_SOURCE ||
    parsed.data.owner.kind !== "capture" ||
    parsed.data.owner.id !== input.eventId ||
    parsed.data.rawDirectory !== path.posix.dirname(input.attachmentRef) ||
    parsed.data.artifacts.length !== 1 ||
    generatedImage === null ||
    typeof generatedImage !== "object" ||
    Array.isArray(generatedImage) ||
    generatedImage.schema !== GENERATED_IMAGE_CAPTURE_PROVENANCE_SCHEMA
  ) {
    throw new VaultError(
      "GENERATED_IMAGE_RETENTION_MANIFEST_INVALID",
      "Capture lookup does not own a generated-image raw manifest.",
      { relativePath: input.manifestPath },
    );
  }

  return {
    contentReceipt: createContentReceipt(content),
    manifest: structuredClone(parsed.data),
    relativePath: input.manifestPath,
  };
}

async function readLookupEventRecords(input: {
  cache: Map<string, EventRecord[]>;
  ledgerFile: string;
  vaultRoot: string;
}): Promise<EventRecord[]> {
  const cached = input.cache.get(input.ledgerFile);
  if (cached) {
    return cached;
  }
  const rawRecords = await readJsonlRecords({
    relativePath: input.ledgerFile,
    vaultRoot: input.vaultRoot,
  });
  const records = rawRecords.map((value) => {
    const parsed = eventRecordSchema.safeParse(value);
    if (!parsed.success) {
      throw new VaultError(
        "GENERATED_IMAGE_RETENTION_EVENT_INVALID",
        "Generated-image lookup ledger contains an invalid event record.",
        { relativePath: input.ledgerFile },
      );
    }
    return parsed.data;
  });
  input.cache.set(input.ledgerFile, records);
  return records;
}

function isGeneratedImageCaptureEvent(record: EventRecord): boolean {
  return isCaptureLookupBackedEvent(record) &&
    record.source === "derived" &&
    GENERATED_IMAGE_CAPTURE_TAGS.every((tag) => record.tags?.includes(tag) === true);
}

function assertGeneratedImageLookupEvent(input: {
  lookup: StoredCaptureLookup;
  origin: EventRecord;
}): void {
  const attachment = input.origin.attachments?.find(
    (candidate) => candidate.relativePath === input.lookup.attachmentRef,
  );
  if (
    eventSpineRevision(input.origin) !== 1 ||
    !attachment ||
    !(input.origin.rawRefs ?? []).includes(input.lookup.attachmentRef)
  ) {
    throw new VaultError(
      "GENERATED_IMAGE_RETENTION_EVENT_INVALID",
      "Generated-image capture lookup does not match its original event.",
      { relativePath: input.lookup.ledgerFile },
    );
  }
}

function normalizeProtectedStoredPaths(values: Iterable<string>): Set<string> {
  const output = new Set<string>();
  for (const value of values) {
    try {
      output.add(normalizeRelativeVaultPath(value));
    } catch {
      // An unrelated invalid protection cannot authorize any vault path.
    }
  }
  return output;
}

function normalizeBatchSize(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_GENERATED_IMAGE_RETENTION_BATCH_SIZE;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new VaultError(
      "INVALID_INPUT",
      "Generated-image retention maxCaptures must be a non-negative integer.",
    );
  }
  return value;
}

function selectEarlierTimestamp(previous: string | null, candidate: string): string {
  return previous === null || Date.parse(candidate) < Date.parse(previous)
    ? candidate
    : previous;
}

function createContentReceipt(content: string): CommittedPayloadReceipt {
  const bytes = Buffer.from(content, "utf8");
  return {
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function toCommittedReceipt(input: {
  byteSize: number;
  sha256: string;
}): CommittedPayloadReceipt {
  return {
    byteLength: input.byteSize,
    sha256: input.sha256,
  };
}

function throwIfGeneratedImageRetentionAborted(signal?: AbortSignal | null): void {
  signal?.throwIfAborted();
}

function emptyRetentionResult(): RunGeneratedImageCaptureRetentionResult {
  return {
    hasMoreEligibleCaptures: false,
    nextEligibleAt: null,
    retiredByteCount: 0,
    retiredCaptureCount: 0,
    scannedCaptureCount: 0,
  };
}
