import { createHash } from "node:crypto";

import {
  integrationIngestReceiptSchema,
  integrationIngestRecordSchema,
  type IntegrationEvidencePart,
  type IntegrationIngestEventOutput,
  type IntegrationIngestReceipt,
  type IntegrationIngestRecord,
} from "@murphai/contracts";

import { VAULT_LAYOUT } from "./constants.ts";
import { VaultError } from "./errors.ts";
import { pathExists, walkVaultFiles } from "./fs.ts";
import { readJsonlRecords, toMonthlyShardRelativePath } from "./jsonl.ts";
import { resolveVaultPath } from "./path-safety.ts";

export const MAX_INTEGRATION_INGEST_PARTS = 10_000;
export const MAX_INTEGRATION_EVIDENCE_PART_BYTES = 100 * 1024 * 1024;
export const MAX_INTEGRATION_INGEST_BYTES = 100 * 1024 * 1024;

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
  appendedIds: string[];
  payloads: Map<string, string>;
  targetShardPaths: string[];
}

export interface StoredIntegrationIngestEntry {
  relativePath: string;
  record: IntegrationIngestRecord;
}

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
  const paths = await walkVaultFiles(vaultRoot, VAULT_LAYOUT.integrationIngestLedgerDirectory, {
    extension: ".jsonl",
  });
  return readIntegrationIngestEntriesFromPaths(vaultRoot, paths.sort());
}

async function readIntegrationIngestEntriesFromPaths(
  vaultRoot: string,
  paths: readonly string[],
): Promise<StoredIntegrationIngestEntry[]> {
  const entries: StoredIntegrationIngestEntry[] = [];
  const seen = new Map<string, string>();

  for (const relativePath of [...paths].sort()) {
    const absolutePath = resolveVaultPath(vaultRoot, relativePath).absolutePath;
    if (!(await pathExists(absolutePath))) {
      continue;
    }
    for (const raw of await readJsonlRecords({ vaultRoot, relativePath })) {
      const parsed = integrationIngestRecordSchema.safeParse(raw);
      if (!parsed.success) {
        throw new VaultError(
          "INTEGRATION_INGEST_INVALID",
          `Integration ingest record in "${relativePath}" failed contract validation.`,
          { errors: parsed.error.issues.map((issue) => issue.message), relativePath },
        );
      }
      assertIntegrationIngestRecordIntegrity(parsed.data);
      const expectedPath = integrationIngestShardPath(parsed.data.importedAt);
      if (expectedPath !== relativePath) {
        throw new VaultError(
          "INTEGRATION_INGEST_SHARD_INVALID",
          `Integration ingest "${parsed.data.id}" belongs in "${expectedPath}", not "${relativePath}".`,
          { relativePath },
        );
      }
      const previousPath = seen.get(parsed.data.id);
      if (previousPath) {
        throw new VaultError(
          "INTEGRATION_INGEST_DUPLICATE_ID",
          `Integration ingest id "${parsed.data.id}" appears more than once.`,
          { previousPath, relativePath },
        );
      }
      seen.set(parsed.data.id, relativePath);
      entries.push({ relativePath, record: parsed.data });
    }
  }
  return entries;
}

export async function buildIntegrationIngestAppendPlan(
  vaultRoot: string,
  records: readonly IntegrationIngestRecord[],
): Promise<IntegrationIngestAppendPlan> {
  const targetShardPaths = [
    ...new Set(records.map((record) => integrationIngestShardPath(record.importedAt))),
  ].sort();
  const existingById = new Map(
    (await readIntegrationIngestEntriesFromPaths(vaultRoot, targetShardPaths)).map((entry) =>
      [entry.record.id, entry.record] as const,
    ),
  );
  const pendingById = new Map<string, IntegrationIngestRecord>();
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
    payloads.set(relativePath, `${payloads.get(relativePath) ?? ""}${JSON.stringify(record)}\n`);
  }

  return { appendedIds, payloads, targetShardPaths };
}

export async function stageIntegrationIngestAppendPlan(
  batch: { stageJsonlAppend(relativePath: string, content: string): Promise<string> },
  plan: IntegrationIngestAppendPlan,
): Promise<void> {
  for (const relativePath of [...plan.payloads.keys()].sort()) {
    const payload = plan.payloads.get(relativePath);
    if (payload) {
      await batch.stageJsonlAppend(relativePath, payload);
    }
  }
}

export async function listIntegrationIngestsForEvent(
  vaultRoot: string,
  eventId: string,
): Promise<StoredIntegrationIngestEntry[]> {
  return (await readIntegrationIngestEntries(vaultRoot)).filter((entry) =>
    entry.record.outputs.events.some((output) => output.id === eventId)
  );
}

export async function readIntegrationIngestById(
  vaultRoot: string,
  ingestId: string,
): Promise<StoredIntegrationIngestEntry | null> {
  return (await readIntegrationIngestEntries(vaultRoot)).find((entry) => entry.record.id === ingestId) ?? null;
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
