import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { createGunzip, crc32, deflateRawSync, gzipSync, inflateRawSync } from "node:zlib";

import {
  integrationIngestReceiptSchema,
  integrationIngestRecordSchema,
  type IntegrationEvidencePart,
  type IntegrationIngestEventOutput,
  type IntegrationIngestReceipt,
  type IntegrationIngestRecord,
} from "@murphai/contracts";

import { writeFileAtomic } from "./atomic-write.ts";
import { VAULT_LAYOUT } from "./constants.ts";
import { VaultError } from "./errors.ts";
import { pathExists, walkVaultFiles } from "./fs.ts";
import { toMonthlyShardRelativePath } from "./jsonl.ts";
import { resolveVaultPath } from "./path-safety.ts";

export const MAX_INTEGRATION_INGEST_PARTS = 10_000;
export const MAX_INTEGRATION_EVIDENCE_PART_BYTES = 100 * 1024 * 1024;
export const MAX_INTEGRATION_INGEST_BYTES = 100 * 1024 * 1024;
export const MAX_INTEGRATION_INGEST_JOURNAL_ROW_BYTES = 128 * 1024 * 1024;
export const MAX_INTEGRATION_INGEST_ZIP_ARCHIVE_BYTES = 128 * 1024 * 1024;
export const MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES = 256 * 1024 * 1024;
const INTEGRATION_INGEST_APPEND_PLAN_AUTHORITY = Symbol("integration-ingest-append-plan-authority");

export interface BuildIntegrationEvidencePartInput {
  role: string;
  fileName: string;
  mediaType: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface BuildIntegrationIngestRecordInput {
  id: string;
  provider: string;
  accountId?: string;
  source: "manual" | "import" | "device" | "derived";
  importedAt: string;
  receipt?: unknown;
  parts: readonly IntegrationEvidencePart[];
  eventOutputs: readonly IntegrationIngestEventOutput[];
  eventIdsComplete: boolean;
  sampleIds: readonly string[];
  sampleIdsComplete: boolean;
  eventCount: number;
  sampleCount: number;
  provenance?: Record<string, unknown>;
}

export interface IntegrationIngestAppendPlan {
  readonly [INTEGRATION_INGEST_APPEND_PLAN_AUTHORITY]: true;
  archivedAmendmentShardPaths: string[];
  appendedIds: string[];
  payloads: Map<string, string>;
  targetShardPaths: string[];
}

export interface BuildIntegrationIngestAppendPlanOptions {
  allowArchivedShardAmendments?: boolean;
}

export interface ArchivedIntegrationIngestShardText {
  content: string;
}

export interface AppendArchivedIntegrationIngestShardInput {
  expectedBaseByteLength: number;
  expectedBaseSha256: string;
  payload: string;
  targetRelativePath: string;
  vaultRoot: string;
}

export interface AppendArchivedIntegrationIngestShardResult {
  originalSize: number;
}

export interface TruncateArchivedIntegrationIngestShardInput {
  expectedBaseByteLength: number;
  expectedBaseSha256: string;
  targetRelativePath: string;
  vaultRoot: string;
}

export interface StoredIntegrationIngestEntry {
  relativePath: string;
  record: IntegrationIngestRecord;
}

interface RawIntegrationIngestJsonlRow {
  lineNumber: number;
  raw: unknown;
  relativePath: string;
  sourcePath: string;
}

type IntegrationIngestRowSourceKind = "jsonl" | "gzip" | "zip";

interface IntegrationIngestRowSource {
  kind: IntegrationIngestRowSourceKind;
  logicalPath: string;
  sourcePath: string;
}

interface ZipCentralDirectoryEntry {
  centralDirectoryOffset: number;
  compressedSize: number;
  compressionMethod: number;
  crc32: number;
  flags: number;
  localHeaderOffset: number;
  name: string;
  uncompressedSize: number;
}

const INTEGRATION_INGEST_ARCHIVE_SUFFIXES = [".gz", ".zip"] as const;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_MAX_EOCD_SEARCH_BYTES = 65_557;
const ZIP64_MARKER_16 = 0xffff;
const ZIP64_MARKER_32 = 0xffffffff;

export function integrationIngestShardPath(importedAt: string): string {
  return toMonthlyShardRelativePath(
    VAULT_LAYOUT.integrationIngestLedgerDirectory,
    importedAt,
    "importedAt",
  );
}

export function buildIntegrationEvidencePart(
  input: BuildIntegrationEvidencePartInput,
): IntegrationEvidencePart {
  const byteSize = Buffer.byteLength(input.content, "utf8");
  if (byteSize > MAX_INTEGRATION_EVIDENCE_PART_BYTES) {
    throw new VaultError(
      "INTEGRATION_EVIDENCE_PART_TOO_LARGE",
      `Integration evidence part "${input.role}" exceeds the ${MAX_INTEGRATION_EVIDENCE_PART_BYTES}-byte limit.`,
      { byteSize, role: input.role },
    );
  }

  return {
    role: input.role,
    fileName: input.fileName,
    mediaType: input.mediaType,
    content: input.content,
    byteSize,
    sha256: createHash("sha256").update(input.content, "utf8").digest("hex"),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export function compactIntegrationIngestReceipt(value: unknown): IntegrationIngestReceipt | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VaultError(
      "INTEGRATION_INGEST_RECEIPT_INVALID",
      "Integration ingest receipt must be an object.",
    );
  }

  const receipt = value as Record<string, unknown>;
  const parsed = integrationIngestReceiptSchema.safeParse({
    schemaVersion: receipt.schemaVersion,
    id: receipt.id,
    provider: receipt.provider,
    userId: receipt.userId,
    accountId: receipt.accountId,
    connectionId: receipt.connectionId,
    sourceKind: receipt.sourceKind,
    deliveryMode: receipt.deliveryMode,
    resourceType: receipt.resourceType,
    resourceId: receipt.resourceId,
    providerEventId: receipt.providerEventId,
    eventType: receipt.eventType,
    observedAt: receipt.observedAt,
    occurredAt: receipt.occurredAt,
    windowStart: receipt.windowStart,
    windowEnd: receipt.windowEnd,
    cursor: receipt.cursor,
    signatureVerified: receipt.signatureVerified,
    payloadHash: receipt.payloadHash,
  });
  if (!parsed.success) {
    throw new VaultError(
      "INTEGRATION_INGEST_RECEIPT_INVALID",
      "Integration ingest receipt failed contract validation.",
      { errors: parsed.error.issues.map((issue) => issue.message) },
    );
  }
  return parsed.data;
}

export function buildIntegrationIngestRecord(
  input: BuildIntegrationIngestRecordInput,
): IntegrationIngestRecord {
  if (input.parts.length > MAX_INTEGRATION_INGEST_PARTS) {
    throw new VaultError(
      "INTEGRATION_INGEST_TOO_MANY_PARTS",
      `Integration ingest may contain at most ${MAX_INTEGRATION_INGEST_PARTS} evidence parts.`,
      { partCount: input.parts.length },
    );
  }
  const totalPartBytes = input.parts.reduce((total, part) => total + part.byteSize, 0);
  if (totalPartBytes > MAX_INTEGRATION_INGEST_BYTES) {
    throw new VaultError(
      "INTEGRATION_INGEST_TOO_LARGE",
      `Integration ingest exceeds the ${MAX_INTEGRATION_INGEST_BYTES}-byte evidence limit.`,
      { totalPartBytes },
    );
  }

  const candidate = {
    schemaVersion: "murph.integration-ingest.v1" as const,
    id: input.id,
    provider: input.provider,
    ...(input.accountId ? { accountId: input.accountId } : {}),
    source: input.source,
    importedAt: input.importedAt,
    ...(input.receipt ? { receipt: compactIntegrationIngestReceipt(input.receipt) } : {}),
    parts: [...input.parts],
    outputs: {
      events: [...input.eventOutputs],
      eventIdsComplete: input.eventIdsComplete,
      sampleIds: [...input.sampleIds],
      sampleIdsComplete: input.sampleIdsComplete,
    },
    counts: {
      eventCount: input.eventCount,
      sampleCount: input.sampleCount,
    },
    ...(input.provenance && Object.keys(input.provenance).length > 0
      ? { provenance: input.provenance }
      : {}),
  };

  const parsed = integrationIngestRecordSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new VaultError(
      "INTEGRATION_INGEST_INVALID",
      "Integration ingest failed contract validation before write.",
      { errors: parsed.error.issues.map((issue) => issue.message) },
    );
  }
  assertIntegrationIngestRecordIntegrity(parsed.data);
  return parsed.data;
}

export function assertIntegrationIngestRecordIntegrity(record: IntegrationIngestRecord): void {
  let totalBytes = 0;
  for (const part of record.parts) {
    const byteSize = Buffer.byteLength(part.content, "utf8");
    const sha256 = createHash("sha256").update(part.content, "utf8").digest("hex");
    if (part.byteSize !== byteSize || part.sha256 !== sha256) {
      throw new VaultError(
        "INTEGRATION_EVIDENCE_INTEGRITY_INVALID",
        `Integration evidence part "${part.role}" failed byte-size or SHA-256 verification.`,
        { role: part.role },
      );
    }
    totalBytes += byteSize;
  }
  if (totalBytes > MAX_INTEGRATION_INGEST_BYTES) {
    throw new VaultError(
      "INTEGRATION_INGEST_TOO_LARGE",
      `Integration ingest exceeds the ${MAX_INTEGRATION_INGEST_BYTES}-byte evidence limit.`,
      { totalBytes },
    );
  }
}

export function stableSerializeIntegrationIngest(value: IntegrationIngestRecord): string {
  return JSON.stringify(stableSortJson(value));
}

export async function readIntegrationIngestEntries(
  vaultRoot: string,
): Promise<StoredIntegrationIngestEntry[]> {
  return readIntegrationIngestEntriesFromSources(
    vaultRoot,
    await listIntegrationIngestRowSources(vaultRoot),
  );
}

async function readIntegrationIngestEntriesFromSources(
  vaultRoot: string,
  sources: readonly IntegrationIngestRowSource[],
): Promise<StoredIntegrationIngestEntry[]> {
  const entries: StoredIntegrationIngestEntry[] = [];
  const seen = new Map<string, string>();

  for await (const { raw, relativePath, sourcePath } of readIntegrationIngestJsonlRows(vaultRoot, sources)) {
    const record = parseIntegrationIngestRecord(raw, sourcePath);
    assertIntegrationIngestShard(record.id, record.importedAt, relativePath);
    assertIntegrationIngestRecordIntegrity(record);
    assertUniqueIntegrationIngestId(seen, record.id, relativePath);
    entries.push({ relativePath, record });
  }
  return entries;
}

async function readIntegrationIngestEntriesByIdFromPaths(
  vaultRoot: string,
  paths: readonly string[],
  ids: ReadonlySet<string>,
): Promise<StoredIntegrationIngestEntry[]> {
  return readIntegrationIngestEntriesByIdFromSources(
    vaultRoot,
    await listIntegrationIngestRowSourcesForLogicalPaths(vaultRoot, paths),
    ids,
  );
}

async function readIntegrationIngestEntriesByIdFromSources(
  vaultRoot: string,
  sources: readonly IntegrationIngestRowSource[],
  ids: ReadonlySet<string>,
): Promise<StoredIntegrationIngestEntry[]> {
  if (ids.size === 0) return [];
  const entries: StoredIntegrationIngestEntry[] = [];
  const seen = new Map<string, string>();

  for await (const { raw, relativePath, sourcePath, lineNumber } of readIntegrationIngestJsonlRows(vaultRoot, sources)) {
    if (!isRecord(raw) || typeof raw.id !== "string") {
      throw new VaultError(
        "INTEGRATION_INGEST_INVALID",
        `Integration ingest record in "${sourcePath}" is missing id or importedAt.`,
        { relativePath: sourcePath, lineNumber },
      );
    }
    if (typeof raw.importedAt !== "string") {
      throw new VaultError(
        "INTEGRATION_INGEST_INVALID",
        `Integration ingest record in "${sourcePath}" is missing id or importedAt.`,
        { relativePath: sourcePath, lineNumber },
      );
    }
    if (!ids.has(raw.id)) {
      continue;
    }
    assertIntegrationIngestShard(raw.id, raw.importedAt, relativePath);
    const record = parseIntegrationIngestRecord(raw, sourcePath);
    assertIntegrationIngestRecordIntegrity(record);
    assertUniqueIntegrationIngestId(seen, record.id, relativePath);
    entries.push({ relativePath, record });
  }

  return entries;
}

export async function buildIntegrationIngestAppendPlan(
  vaultRoot: string,
  records: readonly IntegrationIngestRecord[],
  options: BuildIntegrationIngestAppendPlanOptions = {},
): Promise<IntegrationIngestAppendPlan> {
  const targetShardPaths = [
    ...new Set(records.map((record) => integrationIngestShardPath(record.importedAt))),
  ].sort();
  const requestedIds = new Set(records.map((record) => record.id));
  const targetSources = await listIntegrationIngestRowSourcesForLogicalPaths(vaultRoot, targetShardPaths);
  const archivedTargets = new Set(
    targetSources
      .filter((source) => source.kind !== "jsonl")
      .map((source) => source.logicalPath),
  );
  const targetExistingEntries = await readIntegrationIngestEntriesByIdFromSources(
    vaultRoot,
    targetSources,
    requestedIds,
  );
  const existingById = new Map(
    targetExistingEntries.map((entry) =>
      [entry.record.id, entry.record] as const,
    ),
  );
  const pendingById = new Map<string, IntegrationIngestRecord>();
  const archivedAmendmentShardPaths = new Set<string>();
  const payloads = new Map<string, string>();
  const appendedIds: string[] = [];

  for (const record of records) {
    assertIntegrationIngestRecordIntegrity(record);
    const existing = existingById.get(record.id) ?? pendingById.get(record.id);
    if (existing) {
      if (stableSerializeIntegrationIngest(existing) !== stableSerializeIntegrationIngest(record)) {
        throw new VaultError(
          "INTEGRATION_INGEST_ID_CONFLICT",
          `Integration ingest id "${record.id}" already exists with different content.`,
          { ingestId: record.id },
        );
      }
      continue;
    }

    pendingById.set(record.id, record);
    appendedIds.push(record.id);
    const relativePath = integrationIngestShardPath(record.importedAt);
    if (archivedTargets.has(relativePath)) {
      if (!options.allowArchivedShardAmendments) {
        throw new VaultError(
          "INTEGRATION_INGEST_SHARD_ARCHIVED",
          `Integration ingest shard "${relativePath}" is archived and cannot be appended.`,
          { ingestId: record.id, relativePath },
        );
      }
      archivedAmendmentShardPaths.add(relativePath);
    }
    const rowPayload = `${JSON.stringify(record)}\n`;
    const rowPayloadBytes = Buffer.byteLength(rowPayload, "utf8");
    if (rowPayloadBytes > MAX_INTEGRATION_INGEST_JOURNAL_ROW_BYTES) {
      throw new VaultError(
        "INTEGRATION_INGEST_ROW_TOO_LARGE",
        `Integration ingest row "${record.id}" exceeds the ${MAX_INTEGRATION_INGEST_JOURNAL_ROW_BYTES}-byte journal limit.`,
        { ingestId: record.id, rowPayloadBytes },
      );
    }
    payloads.set(relativePath, `${payloads.get(relativePath) ?? ""}${rowPayload}`);
  }

  return {
    [INTEGRATION_INGEST_APPEND_PLAN_AUTHORITY]: true,
    archivedAmendmentShardPaths: [...archivedAmendmentShardPaths].sort(),
    appendedIds,
    payloads,
    targetShardPaths,
  };
}

export function assertAuthorizedIntegrationIngestAppendPlan(
  plan: unknown,
): asserts plan is IntegrationIngestAppendPlan {
  if (
    typeof plan !== "object"
    || plan === null
    || Reflect.get(plan, INTEGRATION_INGEST_APPEND_PLAN_AUTHORITY) !== true
  ) {
    throw new VaultError(
      "INTEGRATION_INGEST_INVALID",
      "Integration ingest append plans must be created by the integration ingest planner.",
    );
  }
}

export async function parseIntegrationIngestAppendPayload(
  payload: string,
  logicalPath: string,
): Promise<IntegrationIngestRecord[]> {
  const records: IntegrationIngestRecord[] = [];
  const lines = createInterface({
    input: Readable.from([payload]),
    crlfDelay: Infinity,
  });
  const source: IntegrationIngestRowSource = {
    kind: "jsonl",
    logicalPath,
    sourcePath: logicalPath,
  };

  for await (const { raw, sourcePath } of parseIntegrationIngestJsonlLines(lines, source)) {
    const record = parseIntegrationIngestRecord(raw, sourcePath);
    assertIntegrationIngestShard(record.id, record.importedAt, logicalPath);
    assertIntegrationIngestRecordIntegrity(record);
    records.push(record);
  }
  return records;
}

export async function stageIntegrationIngestAppendPlan(
  batch: {
    stageIntegrationIngestAppendPlan(plan: IntegrationIngestAppendPlan): Promise<void>;
  },
  plan: IntegrationIngestAppendPlan,
): Promise<void> {
  await batch.stageIntegrationIngestAppendPlan(plan);
}

export async function readArchivedIntegrationIngestShardText(
  vaultRoot: string,
  logicalPath: string,
): Promise<ArchivedIntegrationIngestShardText | null> {
  const [source] = await listIntegrationIngestRowSourcesForLogicalPaths(vaultRoot, [logicalPath]);
  if (!source || source.kind === "jsonl") {
    return null;
  }

  return {
    content: await readIntegrationIngestSourceText(vaultRoot, source),
  };
}

export async function appendArchivedIntegrationIngestShard({
  expectedBaseByteLength,
  expectedBaseSha256,
  payload,
  targetRelativePath,
  vaultRoot,
}: AppendArchivedIntegrationIngestShardInput): Promise<AppendArchivedIntegrationIngestShardResult> {
  const source = await readArchivedIntegrationIngestShardSource(vaultRoot, targetRelativePath);
  const baseContent = await readIntegrationIngestSourceText(vaultRoot, source);
  const baseBytes = Buffer.from(baseContent, "utf8");
  const payloadBytes = Buffer.from(payload, "utf8");
  const records = await parseIntegrationIngestAppendPayload(payload, targetRelativePath);

  if (typeof expectedBaseByteLength !== "number" || typeof expectedBaseSha256 !== "string") {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_BASE_MISMATCH",
      `Integration ingest archive "${source.sourcePath}" append receipt base is required.`,
      { relativePath: source.sourcePath },
    );
  }

  const baseSlice = baseBytes.subarray(0, expectedBaseByteLength);
  const baseSliceSha256 = createHash("sha256").update(baseSlice).digest("hex");
  if (baseSlice.byteLength !== expectedBaseByteLength || baseSliceSha256 !== expectedBaseSha256) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_BASE_MISMATCH",
      `Integration ingest archive "${source.sourcePath}" base content does not match the append receipt.`,
      { relativePath: source.sourcePath },
    );
  }

  if (baseBytes.byteLength > expectedBaseByteLength) {
    const appendedEnd = expectedBaseByteLength + payloadBytes.byteLength;
    if (
      baseBytes.byteLength >= appendedEnd &&
      baseBytes.subarray(expectedBaseByteLength, appendedEnd).equals(payloadBytes)
    ) {
      return {
        originalSize: expectedBaseByteLength,
      };
    }

    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_BASE_MISMATCH",
      `Integration ingest archive "${source.sourcePath}" changed after the append receipt base.`,
      { relativePath: source.sourcePath },
    );
  }

  if (baseContent.length > 0 && !baseContent.endsWith("\n")) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${source.sourcePath}" is not newline-terminated.`,
      { relativePath: source.sourcePath },
    );
  }

  validateIntegrationIngestArchiveBaseContent(source, baseContent);
  const appendPlan = await buildIntegrationIngestAppendPlan(vaultRoot, records, {
    allowArchivedShardAmendments: true,
  });
  const appendPayload = appendPlan.payloads.get(targetRelativePath);
  const originalSize = expectedBaseByteLength;
  if (!appendPayload) {
    return {
      originalSize,
    };
  }

  await writeIntegrationIngestArchiveText(vaultRoot, source, `${baseContent}${appendPayload}`);
  return {
    originalSize,
  };
}

function validateIntegrationIngestArchiveBaseContent(
  source: IntegrationIngestRowSource,
  baseContent: string,
): void {
  const seen = new Map<string, string>();
  const lines = baseContent.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.length === 0) {
      continue;
    }
    const lineNumber = index + 1;
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (lineBytes > MAX_INTEGRATION_INGEST_JOURNAL_ROW_BYTES) {
      throw new VaultError(
        "INTEGRATION_INGEST_ROW_TOO_LARGE",
        `Integration ingest row in "${source.sourcePath}" exceeds the ${MAX_INTEGRATION_INGEST_JOURNAL_ROW_BYTES}-byte journal limit.`,
        { lineNumber, relativePath: source.sourcePath, rowPayloadBytes: lineBytes },
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      throw new VaultError("VAULT_INVALID_JSONL", `Invalid JSON on line ${lineNumber}.`, {
        relativePath: source.sourcePath,
        lineNumber,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    const record = parseIntegrationIngestRecord(raw, source.sourcePath);
    assertIntegrationIngestShard(record.id, record.importedAt, source.logicalPath);
    assertIntegrationIngestRecordIntegrity(record);
    assertUniqueIntegrationIngestId(seen, record.id, source.logicalPath);
  }
}

export async function truncateArchivedIntegrationIngestShard({
  expectedBaseByteLength,
  expectedBaseSha256,
  targetRelativePath,
  vaultRoot,
}: TruncateArchivedIntegrationIngestShardInput): Promise<void> {
  const source = await readArchivedIntegrationIngestShardSource(vaultRoot, targetRelativePath);
  const content = await readIntegrationIngestSourceText(vaultRoot, source);
  const contentBytes = Buffer.from(content, "utf8");
  if (contentBytes.byteLength < expectedBaseByteLength) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_BASE_MISMATCH",
      `Integration ingest archive "${source.sourcePath}" is smaller than the rollback base.`,
      { relativePath: source.sourcePath },
    );
  }

  const baseBytes = contentBytes.subarray(0, expectedBaseByteLength);
  const baseSha256 = createHash("sha256").update(baseBytes).digest("hex");
  if (baseSha256 !== expectedBaseSha256) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_BASE_MISMATCH",
      `Integration ingest archive "${source.sourcePath}" base content does not match the rollback receipt.`,
      { relativePath: source.sourcePath },
    );
  }

  if (contentBytes.byteLength === expectedBaseByteLength) {
    return;
  }
  await writeIntegrationIngestArchiveText(vaultRoot, source, baseBytes.toString("utf8"));
}

export async function listIntegrationIngestsForEvent(
  vaultRoot: string,
  eventId: string,
): Promise<StoredIntegrationIngestEntry[]> {
  const entries: StoredIntegrationIngestEntry[] = [];
  const seen = new Map<string, string>();
  for await (const { raw, relativePath, sourcePath } of readIntegrationIngestJsonlRows(
    vaultRoot,
    await listIntegrationIngestRowSources(vaultRoot),
  )) {
    const record = parseIntegrationIngestRecord(raw, sourcePath);
    assertIntegrationIngestShard(record.id, record.importedAt, relativePath);
    if (!record.outputs.events.some((output) => output.id === eventId)) {
      continue;
    }
    assertIntegrationIngestRecordIntegrity(record);
    assertUniqueIntegrationIngestId(seen, record.id, relativePath);
    entries.push({ relativePath, record });
  }
  return entries;
}

export async function readIntegrationIngestById(
  vaultRoot: string,
  ingestId: string,
): Promise<StoredIntegrationIngestEntry | null> {
  return (
    await readIntegrationIngestEntriesByIdFromSources(
      vaultRoot,
      await listIntegrationIngestRowSources(vaultRoot),
      new Set([ingestId]),
    )
  )[0] ?? null;
}

export function readIntegrationEvidencePart(
  record: IntegrationIngestRecord,
  role: string,
): IntegrationEvidencePart | null {
  assertIntegrationIngestRecordIntegrity(record);
  return record.parts.find((candidate) => candidate.role === role) ?? null;
}

function stableSortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableSortJson(entry)]),
    );
  }
  return value;
}

async function* readIntegrationIngestJsonlRows(
  vaultRoot: string,
  sources: readonly IntegrationIngestRowSource[],
): AsyncGenerator<RawIntegrationIngestJsonlRow> {
  for (const source of sortIntegrationIngestRowSources(sources)) {
    const absolutePath = resolveVaultPath(vaultRoot, source.sourcePath).absolutePath;
    if (!(await pathExists(absolutePath))) {
      continue;
    }
    const lines = createInterface({
      input: await openIntegrationIngestLineStream(vaultRoot, source),
      crlfDelay: Infinity,
    });
    yield* parseIntegrationIngestJsonlLines(lines, source);
  }
}

async function* parseIntegrationIngestJsonlLines(
  lines: AsyncIterable<string>,
  source: IntegrationIngestRowSource,
): AsyncGenerator<RawIntegrationIngestJsonlRow> {
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (line.length === 0) continue;
    const lineBytes = Buffer.byteLength(line, "utf8");
    if (lineBytes > MAX_INTEGRATION_INGEST_JOURNAL_ROW_BYTES) {
      throw new VaultError(
        "INTEGRATION_INGEST_ROW_TOO_LARGE",
        `Integration ingest row in "${source.sourcePath}" exceeds the ${MAX_INTEGRATION_INGEST_JOURNAL_ROW_BYTES}-byte journal limit.`,
        { lineNumber, relativePath: source.sourcePath, rowPayloadBytes: lineBytes },
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      throw new VaultError("VAULT_INVALID_JSONL", `Invalid JSON on line ${lineNumber}.`, {
        relativePath: source.sourcePath,
        lineNumber,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    yield {
      lineNumber,
      raw,
      relativePath: source.logicalPath,
      sourcePath: source.sourcePath,
    };
  }
}

async function openIntegrationIngestLineStream(
  vaultRoot: string,
  source: IntegrationIngestRowSource,
): Promise<NodeJS.ReadableStream> {
  if (source.kind === "jsonl") {
    const absolutePath = resolveVaultPath(vaultRoot, source.sourcePath).absolutePath;
    return createReadStream(absolutePath, { encoding: "utf8" });
  }
  return Readable.from([await readIntegrationIngestSourceText(vaultRoot, source)]);
}

async function listIntegrationIngestRowSources(
  vaultRoot: string,
): Promise<IntegrationIngestRowSource[]> {
  const sources = new Map<string, IntegrationIngestRowSource>();
  for (const extension of [".jsonl", ".jsonl.gz", ".jsonl.zip"] as const) {
    const paths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.integrationIngestLedgerDirectory, {
      extension,
    });
    for (const sourcePath of paths) {
      const source = integrationIngestRowSourceFromPath(sourcePath);
      sources.set(source.sourcePath, source);
    }
  }
  return assertSingleIntegrationIngestShardRepresentation(
    sortIntegrationIngestRowSources([...sources.values()]),
  );
}

async function listIntegrationIngestRowSourcesForLogicalPaths(
  vaultRoot: string,
  logicalPaths: readonly string[],
): Promise<IntegrationIngestRowSource[]> {
  const sources: IntegrationIngestRowSource[] = [];
  for (const logicalPath of [...new Set(logicalPaths)].sort()) {
    for (const sourcePath of [logicalPath, ...INTEGRATION_INGEST_ARCHIVE_SUFFIXES.map((suffix) => `${logicalPath}${suffix}`)]) {
      const resolved = resolveVaultPath(vaultRoot, sourcePath);
      if (await pathExists(resolved.absolutePath)) {
        sources.push(integrationIngestRowSourceFromPath(sourcePath));
      }
    }
  }
  return assertSingleIntegrationIngestShardRepresentation(sortIntegrationIngestRowSources(sources));
}

function integrationIngestRowSourceFromPath(sourcePath: string): IntegrationIngestRowSource {
  if (sourcePath.endsWith(".jsonl.gz")) {
    return {
      kind: "gzip",
      logicalPath: sourcePath.slice(0, -".gz".length),
      sourcePath,
    };
  }
  if (sourcePath.endsWith(".jsonl.zip")) {
    return {
      kind: "zip",
      logicalPath: sourcePath.slice(0, -".zip".length),
      sourcePath,
    };
  }
  return {
    kind: "jsonl",
    logicalPath: sourcePath,
    sourcePath,
  };
}

async function readArchivedIntegrationIngestShardSource(
  vaultRoot: string,
  logicalPath: string,
): Promise<IntegrationIngestRowSource> {
  const [source] = await listIntegrationIngestRowSourcesForLogicalPaths(vaultRoot, [logicalPath]);
  if (!source || source.kind === "jsonl") {
    throw new VaultError(
      "INTEGRATION_INGEST_SHARD_ARCHIVED",
      `Integration ingest shard "${logicalPath}" is not archived.`,
      { relativePath: logicalPath },
    );
  }
  return source;
}

async function readIntegrationIngestSourceText(
  vaultRoot: string,
  source: IntegrationIngestRowSource,
): Promise<string> {
  const absolutePath = resolveVaultPath(vaultRoot, source.sourcePath).absolutePath;
  if (source.kind === "jsonl") {
    return readFile(absolutePath, "utf8");
  }
  if (source.kind === "gzip") {
    return readGzippedIntegrationIngestJsonlText(absolutePath, source.sourcePath);
  }
  return readZippedIntegrationIngestJsonlText(vaultRoot, source);
}

async function writeIntegrationIngestArchiveText(
  vaultRoot: string,
  source: IntegrationIngestRowSource,
  content: string,
): Promise<void> {
  if (source.kind === "jsonl") {
    throw new VaultError(
      "INTEGRATION_INGEST_SHARD_ARCHIVED",
      `Integration ingest shard "${source.logicalPath}" is not archived.`,
      { relativePath: source.logicalPath },
    );
  }

  const archivePath = resolveVaultPath(vaultRoot, source.sourcePath).absolutePath;
  if (source.kind === "gzip") {
    const archive = gzipSync(content);
    assertIntegrationIngestArchiveReplacementSize(content, archive, source.sourcePath);
    await writeFileAtomic(archivePath, archive);
    return;
  }
  const archive = createSingleEntryIntegrationIngestZipArchive(
    source.logicalPath.split("/").at(-1) ?? "",
    content,
  );
  assertIntegrationIngestArchiveReplacementSize(content, archive, source.sourcePath);
  await writeFileAtomic(
    archivePath,
    archive,
  );
}

function sortIntegrationIngestRowSources(
  sources: readonly IntegrationIngestRowSource[],
): IntegrationIngestRowSource[] {
  return [...sources].sort((left, right) => {
    const logicalComparison = left.logicalPath.localeCompare(right.logicalPath);
    if (logicalComparison !== 0) return logicalComparison;
    return integrationIngestSourceKindOrder(left.kind) - integrationIngestSourceKindOrder(right.kind)
      || left.sourcePath.localeCompare(right.sourcePath);
  });
}

function integrationIngestSourceKindOrder(kind: IntegrationIngestRowSourceKind): number {
  if (kind === "jsonl") return 0;
  if (kind === "gzip") return 1;
  return 2;
}

async function readGzippedIntegrationIngestJsonlText(
  absolutePath: string,
  relativePath: string,
): Promise<string> {
  const archiveStat = await stat(absolutePath);
  if (archiveStat.size > MAX_INTEGRATION_INGEST_ZIP_ARCHIVE_BYTES) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_TOO_LARGE",
      `Integration ingest archive "${relativePath}" exceeds the ${MAX_INTEGRATION_INGEST_ZIP_ARCHIVE_BYTES}-byte compressed size limit.`,
      { byteSize: archiveStat.size, relativePath },
    );
  }
  return readBoundedIntegrationIngestArchiveText(
    createReadStream(absolutePath).pipe(createGunzip()),
    relativePath,
    "gzip",
  );
}

async function readBoundedIntegrationIngestArchiveText(
  chunks: AsyncIterable<Buffer | string>,
  relativePath: string,
  archiveKind: "gzip" | "zip",
): Promise<string> {
  const buffers: Buffer[] = [];
  let byteSize = 0;

  try {
    for await (const chunk of chunks) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
      byteSize += buffer.byteLength;
      if (byteSize > MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES) {
        throw new VaultError(
          "INTEGRATION_INGEST_ARCHIVE_TOO_LARGE",
          `Integration ingest archive "${relativePath}" exceeds the ${MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES}-byte uncompressed size limit.`,
          { byteSize, relativePath },
        );
      }
      buffers.push(buffer);
    }
  } catch (error) {
    if (error instanceof VaultError) {
      throw error;
    }
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${relativePath}" contains invalid ${archiveKind} data.`,
      { relativePath },
    );
  }

  return Buffer.concat(buffers, byteSize).toString("utf8");
}

async function readZippedIntegrationIngestJsonlText(
  vaultRoot: string,
  source: IntegrationIngestRowSource,
): Promise<string> {
  const archivePath = resolveVaultPath(vaultRoot, source.sourcePath).absolutePath;
  const archiveStat = await stat(archivePath);
  if (archiveStat.size > MAX_INTEGRATION_INGEST_ZIP_ARCHIVE_BYTES) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_TOO_LARGE",
      `Integration ingest archive "${source.sourcePath}" exceeds the ${MAX_INTEGRATION_INGEST_ZIP_ARCHIVE_BYTES}-byte compressed size limit.`,
      { byteSize: archiveStat.size, relativePath: source.sourcePath },
    );
  }
  const archive = await readFile(archivePath);
  const entry = selectZippedIntegrationIngestJsonlEntry(archive, source);
  assertZippedIntegrationIngestEntrySize(entry, source.sourcePath);
  const localHeaderOffset = entry.localHeaderOffset;
  if (localHeaderOffset !== 0) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${source.sourcePath}" has hidden bytes before its JSONL entry.`,
      { relativePath: source.sourcePath },
    );
  }
  assertZipReadableRange(archive, localHeaderOffset, 30, source.sourcePath);
  if (archive.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${source.sourcePath}" has an invalid local file header.`,
      { relativePath: source.sourcePath },
    );
  }
  if ((entry.flags & 0x1) !== 0) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_UNSUPPORTED",
      `Integration ingest archive "${source.sourcePath}" contains an encrypted entry.`,
      { relativePath: source.sourcePath },
    );
  }

  const fileNameLength = archive.readUInt16LE(localHeaderOffset + 26);
  const extraLength = archive.readUInt16LE(localHeaderOffset + 28);
  if (extraLength !== 0) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${source.sourcePath}" has hidden local header metadata.`,
      { relativePath: source.sourcePath },
    );
  }
  const localNameStart = localHeaderOffset + 30;
  const localNameEnd = localNameStart + fileNameLength;
  assertZipReadableRange(archive, localNameStart, fileNameLength, source.sourcePath);
  const localName = archive.subarray(localNameStart, localNameEnd).toString("utf8").replaceAll("\\", "/");
  if (localName !== entry.name) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${source.sourcePath}" local file header does not match its central directory.`,
      { relativePath: source.sourcePath },
    );
  }
  const contentOffset = localHeaderOffset + 30 + fileNameLength + extraLength;
  assertZipReadableRange(archive, contentOffset, entry.compressedSize, source.sourcePath);
  if (contentOffset + entry.compressedSize !== entry.centralDirectoryOffset) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${source.sourcePath}" has hidden bytes before its central directory.`,
      { relativePath: source.sourcePath },
    );
  }
  const compressed = archive.subarray(contentOffset, contentOffset + entry.compressedSize);
  const content = unzipIntegrationIngestEntry(compressed, entry, source.sourcePath);
  if (content.byteLength !== entry.uncompressedSize) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${source.sourcePath}" has an invalid uncompressed size.`,
      { relativePath: source.sourcePath },
    );
  }
  if ((crc32(content) >>> 0) !== entry.crc32) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${source.sourcePath}" failed CRC-32 verification.`,
      { relativePath: source.sourcePath },
    );
  }
  return content.toString("utf8");
}

function selectZippedIntegrationIngestJsonlEntry(
  archive: Buffer,
  source: IntegrationIngestRowSource,
): ZipCentralDirectoryEntry {
  const entries = readZipCentralDirectory(archive, source.sourcePath);
  const expectedName = source.logicalPath.split("/").at(-1) ?? "";
  if (entries.length === 1 && entries[0]?.name === expectedName) {
    return entries[0] as ZipCentralDirectoryEntry;
  }
  throw new VaultError(
    "INTEGRATION_INGEST_ARCHIVE_INVALID",
    `Integration ingest archive "${source.sourcePath}" must contain exactly one entry named "${expectedName}".`,
    { relativePath: source.sourcePath, entryCount: entries.length },
  );
}

function readZipCentralDirectory(
  archive: Buffer,
  relativePath: string,
): ZipCentralDirectoryEntry[] {
  const eocdOffset = findZipEndOfCentralDirectory(archive);
  if (eocdOffset < 0) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${relativePath}" is missing a ZIP central directory.`,
      { relativePath },
    );
  }
  assertZipReadableRange(archive, eocdOffset, 22, relativePath);
  const diskNumber = archive.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = archive.readUInt16LE(eocdOffset + 6);
  const diskEntryCount = archive.readUInt16LE(eocdOffset + 8);
  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = archive.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = archive.readUInt32LE(eocdOffset + 16);
  const commentLength = archive.readUInt16LE(eocdOffset + 20);
  if (
    diskNumber !== 0
    || centralDirectoryDisk !== 0
    || diskEntryCount !== entryCount
    || entryCount === ZIP64_MARKER_16
    || centralDirectorySize === ZIP64_MARKER_32
    || centralDirectoryOffset === ZIP64_MARKER_32
  ) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_UNSUPPORTED",
      `Integration ingest archive "${relativePath}" uses an unsupported ZIP variant.`,
      { relativePath },
    );
  }
  if (commentLength !== 0 || eocdOffset + 22 !== archive.byteLength) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${relativePath}" has an invalid ZIP comment length.`,
      { relativePath },
    );
  }

  const entries: ZipCentralDirectoryEntry[] = [];
  let offset = centralDirectoryOffset;
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (centralDirectoryEnd !== eocdOffset) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${relativePath}" has hidden central directory padding.`,
      { relativePath },
    );
  }
  assertZipReadableRange(archive, centralDirectoryOffset, centralDirectorySize, relativePath);
  for (let index = 0; index < entryCount; index += 1) {
    assertZipReadableRange(archive, offset, 46, relativePath);
    if (archive.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new VaultError(
        "INTEGRATION_INGEST_ARCHIVE_INVALID",
        `Integration ingest archive "${relativePath}" has an invalid central directory entry.`,
        { relativePath },
      );
    }
    const flags = archive.readUInt16LE(offset + 8);
    const compressionMethod = archive.readUInt16LE(offset + 10);
    const entryCrc32 = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const fileNameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    if (extraLength !== 0 || commentLength !== 0) {
      throw new VaultError(
        "INTEGRATION_INGEST_ARCHIVE_INVALID",
        `Integration ingest archive "${relativePath}" has hidden central directory metadata.`,
        { relativePath },
      );
    }
    if (
      compressedSize === ZIP64_MARKER_32
      || uncompressedSize === ZIP64_MARKER_32
      || localHeaderOffset === ZIP64_MARKER_32
    ) {
      throw new VaultError(
        "INTEGRATION_INGEST_ARCHIVE_UNSUPPORTED",
        `Integration ingest archive "${relativePath}" uses an unsupported ZIP64 entry.`,
        { relativePath },
      );
    }

    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    assertZipReadableRange(archive, nameStart, fileNameLength, relativePath);
    entries.push({
      centralDirectoryOffset,
      compressedSize,
      compressionMethod,
      crc32: entryCrc32,
      flags,
      localHeaderOffset,
      name: archive.subarray(nameStart, nameEnd).toString("utf8").replaceAll("\\", "/"),
      uncompressedSize,
    });
    offset = nameEnd + extraLength + commentLength;
  }
  if (offset !== centralDirectoryEnd) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${relativePath}" has an invalid central directory size.`,
      { relativePath },
    );
  }
  return entries;
}

function findZipEndOfCentralDirectory(archive: Buffer): number {
  const firstOffset = Math.max(0, archive.byteLength - ZIP_MAX_EOCD_SEARCH_BYTES);
  for (let offset = archive.byteLength - 22; offset >= firstOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
      return offset;
    }
  }
  return -1;
}

function unzipIntegrationIngestEntry(
  compressed: Buffer,
  entry: ZipCentralDirectoryEntry,
  relativePath: string,
): Buffer {
  if (entry.compressionMethod === 0) {
    return Buffer.from(compressed);
  }
  if (entry.compressionMethod === 8) {
    try {
      return inflateRawSync(compressed, {
        maxOutputLength: MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES,
      });
    } catch (error) {
      if (isZlibMaxOutputLengthError(error)) {
        throw new VaultError(
          "INTEGRATION_INGEST_ARCHIVE_TOO_LARGE",
          `Integration ingest archive "${relativePath}" exceeds the ${MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES}-byte uncompressed size limit.`,
          { relativePath },
        );
      }
      throw new VaultError(
        "INTEGRATION_INGEST_ARCHIVE_INVALID",
        `Integration ingest archive "${relativePath}" contains invalid deflated data.`,
        { relativePath },
      );
    }
  }
  throw new VaultError(
    "INTEGRATION_INGEST_ARCHIVE_UNSUPPORTED",
    `Integration ingest archive "${relativePath}" uses an unsupported compression method.`,
    { compressionMethod: entry.compressionMethod, relativePath },
  );
}

function assertSingleIntegrationIngestShardRepresentation(
  sources: readonly IntegrationIngestRowSource[],
): IntegrationIngestRowSource[] {
  const byLogicalPath = new Map<string, IntegrationIngestRowSource[]>();
  for (const source of sources) {
    const siblings = byLogicalPath.get(source.logicalPath) ?? [];
    siblings.push(source);
    byLogicalPath.set(source.logicalPath, siblings);
  }
  for (const [logicalPath, siblings] of byLogicalPath.entries()) {
    if (siblings.length <= 1) {
      continue;
    }
    throw new VaultError(
      "INTEGRATION_INGEST_SHARD_REPRESENTATION_CONFLICT",
      `Integration ingest shard "${logicalPath}" has multiple physical representations.`,
      {
        relativePath: logicalPath,
        sourcePaths: siblings.map((source) => source.sourcePath).sort(),
      },
    );
  }
  return [...sources];
}

function assertZippedIntegrationIngestEntrySize(
  entry: ZipCentralDirectoryEntry,
  relativePath: string,
): void {
  if (entry.compressedSize > MAX_INTEGRATION_INGEST_ZIP_ARCHIVE_BYTES) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_TOO_LARGE",
      `Integration ingest archive "${relativePath}" contains an entry that exceeds the ${MAX_INTEGRATION_INGEST_ZIP_ARCHIVE_BYTES}-byte compressed size limit.`,
      { byteSize: entry.compressedSize, relativePath },
    );
  }
  if (entry.uncompressedSize > MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_TOO_LARGE",
      `Integration ingest archive "${relativePath}" contains an entry that exceeds the ${MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES}-byte uncompressed size limit.`,
      { byteSize: entry.uncompressedSize, relativePath },
    );
  }
}

function assertZipReadableRange(
  archive: Buffer,
  offset: number,
  length: number,
  relativePath: string,
): void {
  if (offset < 0 || length < 0 || offset + length > archive.byteLength) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_INVALID",
      `Integration ingest archive "${relativePath}" has an invalid ZIP offset.`,
      { relativePath },
    );
  }
}

function assertIntegrationIngestArchiveReplacementSize(
  content: string,
  archive: Buffer,
  relativePath: string,
): void {
  const entryBytes = Buffer.byteLength(content, "utf8");
  if (entryBytes > MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_TOO_LARGE",
      `Integration ingest archive "${relativePath}" exceeds the ${MAX_INTEGRATION_INGEST_ZIP_ENTRY_BYTES}-byte uncompressed size limit.`,
      { byteSize: entryBytes, relativePath },
    );
  }
  if (archive.byteLength > MAX_INTEGRATION_INGEST_ZIP_ARCHIVE_BYTES) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_TOO_LARGE",
      `Integration ingest archive "${relativePath}" exceeds the ${MAX_INTEGRATION_INGEST_ZIP_ARCHIVE_BYTES}-byte compressed size limit.`,
      { byteSize: archive.byteLength, relativePath },
    );
  }
}

function createSingleEntryIntegrationIngestZipArchive(
  fileName: string,
  content: string,
): Buffer {
  const fileNameBytes = Buffer.from(fileName, "utf8");
  if (fileNameBytes.byteLength === 0 || fileNameBytes.byteLength > 0xffff) {
    throw new VaultError(
      "INTEGRATION_INGEST_ARCHIVE_UNSUPPORTED",
      "Integration ingest ZIP archive entry name is unsupported.",
    );
  }

  const contentBytes = Buffer.from(content, "utf8");
  const compressed = deflateRawSync(contentBytes);
  const contentCrc32 = crc32(contentBytes) >>> 0;
  const localHeader = Buffer.alloc(30 + fileNameBytes.byteLength);
  localHeader.writeUInt32LE(ZIP_LOCAL_FILE_HEADER_SIGNATURE, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(8, 8);
  localHeader.writeUInt32LE(contentCrc32, 14);
  localHeader.writeUInt32LE(compressed.byteLength, 18);
  localHeader.writeUInt32LE(contentBytes.byteLength, 22);
  localHeader.writeUInt16LE(fileNameBytes.byteLength, 26);
  fileNameBytes.copy(localHeader, 30);

  const centralDirectoryOffset = localHeader.byteLength + compressed.byteLength;
  const centralDirectory = Buffer.alloc(46 + fileNameBytes.byteLength);
  centralDirectory.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_SIGNATURE, 0);
  centralDirectory.writeUInt16LE(20, 4);
  centralDirectory.writeUInt16LE(20, 6);
  centralDirectory.writeUInt16LE(0, 8);
  centralDirectory.writeUInt16LE(8, 10);
  centralDirectory.writeUInt32LE(contentCrc32, 16);
  centralDirectory.writeUInt32LE(compressed.byteLength, 20);
  centralDirectory.writeUInt32LE(contentBytes.byteLength, 24);
  centralDirectory.writeUInt16LE(fileNameBytes.byteLength, 28);
  centralDirectory.writeUInt32LE(0, 42);
  fileNameBytes.copy(centralDirectory, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(ZIP_EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralDirectory.byteLength, 12);
  eocd.writeUInt32LE(centralDirectoryOffset, 16);

  return Buffer.concat([localHeader, compressed, centralDirectory, eocd]);
}

function isZlibMaxOutputLengthError(error: unknown): boolean {
  return error instanceof RangeError
    && (error as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE";
}

function parseIntegrationIngestRecord(
  raw: unknown,
  relativePath: string,
): IntegrationIngestRecord {
  const parsed = integrationIngestRecordSchema.safeParse(raw);
  if (!parsed.success) {
    throw new VaultError(
      "INTEGRATION_INGEST_INVALID",
      `Integration ingest record in "${relativePath}" failed contract validation.`,
      { errors: parsed.error.issues.map((issue) => issue.message), relativePath },
    );
  }
  return parsed.data;
}

function assertIntegrationIngestShard(
  id: string,
  importedAt: string,
  relativePath: string,
): void {
  const expectedPath = integrationIngestShardPath(importedAt);
  if (expectedPath !== relativePath) {
    throw new VaultError(
      "INTEGRATION_INGEST_SHARD_INVALID",
      `Integration ingest "${id}" belongs in "${expectedPath}", not "${relativePath}".`,
      { relativePath },
    );
  }
}

function assertUniqueIntegrationIngestId(
  seen: Map<string, string>,
  id: string,
  relativePath: string,
): void {
  const previousPath = seen.get(id);
  if (previousPath) {
    throw new VaultError(
      "INTEGRATION_INGEST_DUPLICATE_ID",
      `Integration ingest id "${id}" appears more than once.`,
      { previousPath, relativePath },
    );
  }
  seen.set(id, relativePath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
