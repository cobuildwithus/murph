import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  CONTRACT_SCHEMA_VERSION,
  integrationIngestRecordSchema,
  jsonObjectSchema,
  rawImportManifestSchema,
  safeParseContract,
  type IntegrationEvidencePart,
  type IntegrationIngestEventOutput,
  type IntegrationIngestReceipt,
  type IntegrationIngestRecord,
  type JsonObject,
  type RawImportManifest,
} from "@murphai/contracts";

import { VAULT_LAYOUT } from "./constants.ts";
import { VaultError } from "./errors.ts";
import { pathExists, readJsonFile, walkVaultFiles } from "./fs.ts";
import { readJsonlRecords, toMonthlyShardRelativePath } from "./jsonl.ts";
import { isRawManifestFileName } from "./operations/raw-manifests.ts";
import { normalizeRelativeVaultPath, resolveVaultPath } from "./path-safety.ts";
import { toIsoTimestamp } from "./time.ts";

import type { WriteBatch } from "./operations/write-batch.ts";
import type { DateInput, UnknownRecord } from "./types.ts";

export interface IntegrationEvidencePartSeed {
  role: string;
  fileName: string;
  mediaType?: string;
  relativePath: string;
  byteSize: number;
  sha256: string;
  metadata?: Record<string, unknown>;
}

export interface IntegrationIngestOutputSeed {
  events: readonly IntegrationIngestEventOutput[];
  sampleIds: readonly string[];
  sampleIdsComplete: boolean;
}

export interface BuildIntegrationIngestRecordInput {
  id: string;
  provider: string;
  accountId?: string;
  source: string;
  importedAt: string;
  receipt?: IntegrationIngestReceipt;
  parts: readonly IntegrationEvidencePartSeed[];
  outputs?: IntegrationIngestOutputSeed;
  counts: {
    eventCount: number;
    sampleCount: number;
  };
  provenance?: Record<string, unknown>;
}

export interface IntegrationIngestAppendPlan {
  appended: boolean;
  payload: string;
  record: IntegrationIngestRecord;
  targetShardPath: string;
}

export interface IntegrationIngestPartSummary {
  byteSize: number;
  fileName: string;
  mediaType: string;
  relativePath: string;
  role: string;
  sha256: string;
}

export type IntegrationEvidencePartManifestBindingResult =
  | {
    manifestPath: string;
    ok: true;
  }
  | {
    code: string;
    message: string;
    ok: false;
    relativePath: string;
  };

export interface IntegrationEvidencePartManifestBindingCache {
  rawDirectories: Map<string, Promise<RawManifestDirectoryBindingState>>;
}

interface ParsedRawManifestBinding {
  manifest: RawImportManifest;
  manifestPath: string;
}

interface RawManifestDirectoryBindingState {
  manifestPaths: string[];
  manifests: ParsedRawManifestBinding[];
}

export interface IntegrationIngestEventSummary {
  accountId?: string;
  eventId: string;
  id: string;
  importedAt: string;
  parts: IntegrationIngestPartSummary[];
  provider: string;
  roles: string[];
  shardPath: string;
  source: string;
}

function sha256Hex(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableSortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stableSortValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableSortValue(entry)] as const),
    );
  }

  return value;
}

function stableSerializeJson(value: unknown): string {
  return JSON.stringify(stableSortValue(value));
}

function normalizeJsonObject(value: Record<string, unknown> | undefined, label: string): JsonObject | undefined {
  if (!value || Object.keys(value).length === 0) {
    return undefined;
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new VaultError(
      "INTEGRATION_INGEST_INVALID",
      `${label} must be JSON-serializable${detail}.`,
    );
  }

  const parsed = JSON.parse(serialized) as unknown;
  const result = safeParseContract(jsonObjectSchema, parsed);
  if (!result.success) {
    throw new VaultError(
      "INTEGRATION_INGEST_INVALID",
      `${label} must be a JSON object. ${result.errors.join("; ")}`,
      { errors: result.errors },
    );
  }

  return result.data;
}

export function toIntegrationIngestShardPath(importedAt: DateInput): string {
  return toMonthlyShardRelativePath(
    VAULT_LAYOUT.integrationIngestLedgerDirectory,
    importedAt,
    "importedAt",
  );
}

export function buildIntegrationEvidencePart(seed: IntegrationEvidencePartSeed): IntegrationEvidencePart {
  return {
    role: seed.role,
    fileName: seed.fileName,
    mediaType: seed.mediaType ?? "application/octet-stream",
    relativePath: normalizeRelativeVaultPath(seed.relativePath),
    byteSize: seed.byteSize,
    sha256: seed.sha256,
    ...(seed.metadata ? { metadata: normalizeJsonObject(seed.metadata, "Integration evidence part metadata") } : {}),
  };
}

export function stableSerializeIntegrationIngestRecord(record: IntegrationIngestRecord): string {
  return `${stableSerializeJson(record)}\n`;
}

export function buildIntegrationIngestRecord(input: BuildIntegrationIngestRecordInput): IntegrationIngestRecord {
  const importedAt = toIsoTimestamp(input.importedAt, "importedAt");
  const events = input.outputs?.events
    ? [...input.outputs.events]
        .map((event) => ({
          id: event.id,
          roles: [...event.roles].sort(),
        }))
        .sort((left, right) => left.id.localeCompare(right.id))
    : undefined;
  const sampleIds = input.outputs ? [...input.outputs.sampleIds].sort() : undefined;
  const parts = input.parts.map(buildIntegrationEvidencePart);
  const candidate: IntegrationIngestRecord = {
    schemaVersion: CONTRACT_SCHEMA_VERSION.integrationIngest,
    id: input.id,
    provider: input.provider,
    ...(input.accountId ? { accountId: input.accountId } : {}),
    source: input.source,
    importedAt,
    ...(input.receipt ? { receipt: input.receipt } : {}),
    parts,
    ...(input.outputs
      ? {
          outputs: {
            ...(events ? { events } : {}),
            sampleIds,
            sampleIdsComplete: input.outputs.sampleIdsComplete,
          },
        }
      : {}),
    counts: {
      eventCount: input.counts.eventCount,
      sampleCount: input.counts.sampleCount,
    },
    ...(input.provenance ? { provenance: normalizeJsonObject(input.provenance, "Integration ingest provenance") } : {}),
  };
  assertIntegrationIngestRecord(candidate);
  return candidate;
}

export function assertIntegrationIngestRecord(record: unknown): asserts record is IntegrationIngestRecord {
  const result = safeParseContract(integrationIngestRecordSchema, record);
  if (!result.success) {
    throw new VaultError("INTEGRATION_INGEST_INVALID", "Integration ingest record failed validation.", {
      errors: result.errors,
    });
  }
}

export function validateIntegrationIngestRecordForShard(input: {
  record: UnknownRecord;
  relativePath: string;
}): string[] {
  const errors: string[] = [];
  const result = safeParseContract(integrationIngestRecordSchema, input.record);
  if (!result.success) {
    errors.push(...result.errors);
    return errors;
  }

  const expectedPath = toIntegrationIngestShardPath(result.data.importedAt);
  if (normalizeRelativeVaultPath(input.relativePath) !== expectedPath) {
    errors.push(`$.importedAt: row belongs in ${expectedPath}.`);
  }

  return errors;
}

async function readIntegrationIngestRowsFromShard(input: {
  relativePath: string;
  vaultRoot: string;
}): Promise<IntegrationIngestRecord[]> {
  const resolved = resolveVaultPath(input.vaultRoot, input.relativePath);
  if (!(await pathExists(resolved.absolutePath))) {
    return [];
  }

  const rows = await readJsonlRecords({
    vaultRoot: input.vaultRoot,
    relativePath: input.relativePath,
  });

  return rows.map((row) => {
    assertIntegrationIngestRecord(row);
    return row;
  });
}

async function readAllIntegrationIngestShardPaths(vaultRoot: string): Promise<string[]> {
  return await walkVaultFiles(vaultRoot, VAULT_LAYOUT.integrationIngestLedgerDirectory, {
    extension: ".jsonl",
  });
}

export async function buildIntegrationIngestAppendPlan(input: {
  record: IntegrationIngestRecord;
  vaultRoot: string;
}): Promise<IntegrationIngestAppendPlan> {
  const targetShardPath = toIntegrationIngestShardPath(input.record.importedAt);
  const candidatePayload = stableSerializeIntegrationIngestRecord(input.record);
  const rows = await readIntegrationIngestRowsFromShard({
    vaultRoot: input.vaultRoot,
    relativePath: targetShardPath,
  });

  const existing = rows.filter((row) => row.id === input.record.id);
  if (existing.length > 1) {
    throw new VaultError(
      "INTEGRATION_INGEST_DUPLICATE",
      `Integration ingest "${input.record.id}" appears multiple times in ${targetShardPath}.`,
    );
  }

  if (existing.length === 1) {
    const existingPayload = stableSerializeIntegrationIngestRecord(existing[0] as IntegrationIngestRecord);
    if (existingPayload !== candidatePayload) {
      throw new VaultError(
        "INTEGRATION_INGEST_CONFLICT",
        `Integration ingest "${input.record.id}" already exists with different content.`,
      );
    }

    return {
      appended: false,
      payload: "",
      record: input.record,
      targetShardPath,
    };
  }

  return {
    appended: true,
    payload: candidatePayload,
    record: input.record,
    targetShardPath,
  };
}

export async function stageIntegrationIngestAppendPlan(
  batch: WriteBatch,
  appendPlan: IntegrationIngestAppendPlan,
): Promise<void> {
  if (!appendPlan.appended) {
    return;
  }

  await batch.stageJsonlAppend(appendPlan.targetShardPath, appendPlan.payload);
}

export async function readIntegrationIngestById(input: {
  id: string;
  vaultRoot: string;
}): Promise<{ record: IntegrationIngestRecord; shardPath: string } | null> {
  let match: { record: IntegrationIngestRecord; shardPath: string } | null = null;
  const shardPaths = await readAllIntegrationIngestShardPaths(input.vaultRoot);

  for (const shardPath of shardPaths) {
    for (const record of await readIntegrationIngestRowsFromShard({
      vaultRoot: input.vaultRoot,
      relativePath: shardPath,
    })) {
      if (record.id !== input.id) {
        continue;
      }

      if (match) {
        throw new VaultError(
          "INTEGRATION_INGEST_DUPLICATE",
          `Integration ingest "${input.id}" appears in multiple shards.`,
        );
      }

      match = { record, shardPath };
    }
  }

  return match;
}

export async function listIntegrationIngestsForEvent(input: {
  eventId: string;
  vaultRoot: string;
}): Promise<IntegrationIngestEventSummary[]> {
  const summaries: IntegrationIngestEventSummary[] = [];
  const shardPaths = await readAllIntegrationIngestShardPaths(input.vaultRoot);

  for (const shardPath of shardPaths) {
    for (const record of await readIntegrationIngestRowsFromShard({
      vaultRoot: input.vaultRoot,
      relativePath: shardPath,
    })) {
      const output = record.outputs?.events?.find((event) => event.id === input.eventId);
      if (!output) {
        continue;
      }

      const roles = new Set(output.roles);
      summaries.push({
        accountId: record.accountId,
        eventId: input.eventId,
        id: record.id,
        importedAt: record.importedAt,
        parts: record.parts
          .filter((part) => roles.has(part.role))
          .map((part) => ({
            byteSize: part.byteSize,
            fileName: part.fileName,
            mediaType: part.mediaType,
            relativePath: part.relativePath,
            role: part.role,
            sha256: part.sha256,
          })),
        provider: record.provider,
        roles: [...roles].sort(),
        shardPath,
        source: record.source,
      });
    }
  }

  return summaries.sort((left, right) =>
    left.importedAt.localeCompare(right.importedAt) || left.id.localeCompare(right.id),
  );
}

export async function readIntegrationEvidencePart(input: {
  ingestId: string;
  role: string;
  vaultRoot: string;
}): Promise<IntegrationEvidencePart | null> {
  const match = await readIntegrationIngestById({
    id: input.ingestId,
    vaultRoot: input.vaultRoot,
  });
  return match?.record.parts.find((part) => part.role === input.role) ?? null;
}

async function listRawManifestPathsForDirectory(input: {
  rawDirectory: string;
  vaultRoot: string;
}): Promise<string[]> {
  const rawFiles = await walkVaultFiles(input.vaultRoot, input.rawDirectory);

  return rawFiles.filter((relativePath) =>
    path.posix.dirname(relativePath) === input.rawDirectory
    && isRawManifestFileName(path.posix.basename(relativePath)),
  );
}

export function createIntegrationEvidencePartManifestBindingCache(): IntegrationEvidencePartManifestBindingCache {
  return {
    rawDirectories: new Map(),
  };
}

async function loadRawManifestBindingsForDirectory(input: {
  rawDirectory: string;
  vaultRoot: string;
}): Promise<RawManifestDirectoryBindingState> {
  const manifestPaths = (await listRawManifestPathsForDirectory(input)).sort();
  const manifests: ParsedRawManifestBinding[] = [];

  for (const manifestPath of manifestPaths) {
    let manifestValue: unknown;
    try {
      manifestValue = await readJsonFile(input.vaultRoot, manifestPath);
    } catch {
      continue;
    }

    const parsed = safeParseContract(rawImportManifestSchema, manifestValue);
    if (!parsed.success) {
      continue;
    }

    manifests.push({
      manifest: parsed.data,
      manifestPath,
    });
  }

  return {
    manifestPaths,
    manifests,
  };
}

async function readRawManifestBindingsForDirectory(input: {
  cache?: IntegrationEvidencePartManifestBindingCache;
  rawDirectory: string;
  vaultRoot: string;
}): Promise<RawManifestDirectoryBindingState> {
  if (!input.cache) {
    return await loadRawManifestBindingsForDirectory(input);
  }

  const cached = input.cache.rawDirectories.get(input.rawDirectory);
  if (cached) {
    return await cached;
  }

  const loaded = loadRawManifestBindingsForDirectory(input);
  input.cache.rawDirectories.set(input.rawDirectory, loaded);
  return await loaded;
}

export async function validateIntegrationEvidencePartManifestBinding(input: {
  cache?: IntegrationEvidencePartManifestBindingCache;
  ingestId: string;
  part: IntegrationEvidencePart;
  provider: string;
  vaultRoot: string;
}): Promise<IntegrationEvidencePartManifestBindingResult> {
  if (!input.part.relativePath.startsWith(`${VAULT_LAYOUT.rawIntegrationsDirectory}/`)) {
    return {
      code: "INTEGRATION_INGEST_PART_RAW_PATH",
      message: `Integration ingest part "${input.part.role}" raw artifact must be under "${VAULT_LAYOUT.rawIntegrationsDirectory}".`,
      ok: false,
      relativePath: input.part.relativePath,
    };
  }

  const rawDirectory = path.posix.dirname(input.part.relativePath);
  const directoryBinding = await readRawManifestBindingsForDirectory({
    cache: input.cache,
    rawDirectory,
    vaultRoot: input.vaultRoot,
  });

  if (directoryBinding.manifestPaths.length === 0) {
    return {
      code: "INTEGRATION_INGEST_PART_MANIFEST",
      message: `Integration ingest part "${input.part.role}" raw directory "${rawDirectory}" is missing a matching raw import manifest.`,
      ok: false,
      relativePath: rawDirectory,
    };
  }

  let ownerMatched = false;
  for (const { manifest, manifestPath } of directoryBinding.manifests) {
    if (
      manifest.rawDirectory !== rawDirectory ||
      manifest.importKind !== "device_batch" ||
      manifest.owner.kind !== "device_batch" ||
      manifest.owner.id !== input.ingestId ||
      manifest.owner.partition !== input.provider
    ) {
      continue;
    }

    ownerMatched = true;
    const artifactMatched = manifest.artifacts.some((artifact) =>
      artifact.relativePath === input.part.relativePath &&
      artifact.role === input.part.role &&
      artifact.byteSize === input.part.byteSize &&
      artifact.sha256 === input.part.sha256
    );
    if (artifactMatched) {
      return {
        manifestPath,
        ok: true,
      };
    }
  }

  if (!ownerMatched) {
    return {
      code: "INTEGRATION_INGEST_PART_MANIFEST_OWNER",
      message: `Integration ingest part "${input.part.role}" raw directory "${rawDirectory}" is missing a device_batch manifest owned by ingest "${input.ingestId}" for provider "${input.provider}".`,
      ok: false,
      relativePath: rawDirectory,
    };
  }

  return {
    code: "INTEGRATION_INGEST_PART_MANIFEST_ARTIFACT",
    message: `Integration ingest part "${input.part.role}" is not listed with matching integrity in its raw import manifest.`,
    ok: false,
    relativePath: input.part.relativePath,
  };
}

export async function parseIntegrationEvidencePartJson(input: {
  ingestId: string;
  role: string;
  vaultRoot: string;
}): Promise<unknown | null> {
  const match = await readIntegrationIngestById({
    id: input.ingestId,
    vaultRoot: input.vaultRoot,
  });
  if (!match) {
    return null;
  }

  const part = match.record.parts.find((candidate) => candidate.role === input.role) ?? null;
  if (!part) {
    return null;
  }

  const manifestBinding = await validateIntegrationEvidencePartManifestBinding({
    ingestId: match.record.id,
    part,
    provider: match.record.provider,
    vaultRoot: input.vaultRoot,
  });
  if (!manifestBinding.ok) {
    throw new VaultError(manifestBinding.code, manifestBinding.message, {
      relativePath: manifestBinding.relativePath,
    });
  }

  const resolved = resolveVaultPath(input.vaultRoot, part.relativePath);
  let bytes: Uint8Array;
  try {
    bytes = await fs.readFile(resolved.absolutePath);
  } catch (error) {
    throw new VaultError(
      "INTEGRATION_INGEST_PART_MISSING",
      `Integration ingest "${input.ingestId}" part "${input.role}" raw artifact is missing.`,
      { cause: error instanceof Error ? error.message : String(error), relativePath: part.relativePath },
    );
  }

  if (bytes.byteLength !== part.byteSize || sha256Hex(bytes) !== part.sha256) {
    throw new VaultError(
      "INTEGRATION_INGEST_PART_INTEGRITY",
      `Integration ingest "${input.ingestId}" part "${input.role}" raw artifact failed integrity verification.`,
      { relativePath: part.relativePath },
    );
  }

  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch (error) {
    throw new VaultError(
      "INTEGRATION_INGEST_PART_NOT_JSON",
      `Integration ingest "${input.ingestId}" part "${input.role}" is not valid JSON.`,
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}
