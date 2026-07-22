import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import {
  FILTERED_INTEGRATION_INGEST_SCHEMA_VERSION,
  eventRecordSchema,
  integrationIngestRecordSchema,
  type IntegrationIngestRecord,
} from "@murphai/contracts";

import { emitAuditRecord } from "./audit.ts";
import { VAULT_LAYOUT } from "./constants.ts";
import { VaultError } from "./errors.ts";
import { pathExists, walkVaultFiles } from "./fs.ts";
import { eventSpineRevision } from "./history/event-spine.ts";
import {
  assertIntegrationIngestRecordIntegrity,
  integrationEvidenceFingerprint,
  integrationIngestShardPath,
} from "./integration-ingests.ts";
import { visitJsonlRecordsInterruptible } from "./jsonl.ts";
import { assertCanonicalWriteLockScope } from "./operations/canonical-write-lock.ts";
import { runCanonicalWrite, type CommittedPayloadReceipt } from "./operations/write-batch.ts";
import { resolveVaultPath } from "./path-safety.ts";

const DEFAULT_MAX_INGEST_SHARDS = 48;
const DEFAULT_MAX_INGEST_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_EVENT_ROWS = 500_000;

export interface RepairJunctionEvidenceDuplicatesInput {
  apply?: boolean;
  maxEventRows?: number;
  maxIngestBytes?: number;
  maxIngestShards?: number;
  now?: Date;
  vaultRoot: string;
}

export interface JunctionEvidenceDuplicateRepairResult {
  auditPath: string | null;
  blockedReason: "event_bounds_exceeded" | "ingest_bounds_exceeded" | null;
  candidateEvidenceBytes: number;
  candidatePartCount: number;
  candidateRowCount: number;
  candidateShardCount: number;
  hasWork: boolean;
  mode: "apply" | "dry-run";
  mutated: boolean;
  revisionProtectedPartCount: number;
  skippedArchivedShardCount: number;
  scannedEventRowCount: number;
  scannedIngestBytes: number;
  scannedIngestRowCount: number;
  scannedIngestShardCount: number;
  touchedPaths: string[];
}

interface ParsedIngestRow {
  rawLine: string;
  record: IntegrationIngestRecord;
}

interface ParsedIngestShard {
  byteLength: number;
  expectedReceipt: CommittedPayloadReceipt;
  relativePath: string;
  rows: ParsedIngestRow[];
}

interface PlannedIngestShard {
  candidateEvidenceBytes: number;
  candidatePartCount: number;
  candidateRowCount: number;
  content: string;
  expectedReceipt: CommittedPayloadReceipt;
  relativePath: string;
  revisionProtectedPartCount: number;
}

interface JunctionEvidenceRepairPlan {
  blockedReason: JunctionEvidenceDuplicateRepairResult["blockedReason"];
  candidateEvidenceBytes: number;
  candidatePartCount: number;
  candidateRowCount: number;
  revisionProtectedPartCount: number;
  skippedArchivedShardCount: number;
  scannedEventRowCount: number;
  scannedIngestBytes: number;
  scannedIngestRowCount: number;
  scannedIngestShardCount: number;
  shards: PlannedIngestShard[];
}

export async function repairJunctionEvidenceDuplicates({
  apply = false,
  maxEventRows = DEFAULT_MAX_EVENT_ROWS,
  maxIngestBytes = DEFAULT_MAX_INGEST_BYTES,
  maxIngestShards = DEFAULT_MAX_INGEST_SHARDS,
  now = new Date(),
  vaultRoot,
}: RepairJunctionEvidenceDuplicatesInput): Promise<JunctionEvidenceDuplicateRepairResult> {
  assertCanonicalWriteLockScope(vaultRoot);
  const plan = await planJunctionEvidenceRepair({
    maxEventRows,
    maxIngestBytes,
    maxIngestShards,
    vaultRoot,
  });

  if (!apply) {
    return buildResult(plan, "dry-run", null);
  }
  if (plan.blockedReason || plan.shards.length === 0) {
    return buildResult(plan, "apply", null);
  }

  return await runCanonicalWrite({
    occurredAt: now,
    operationType: "junction_evidence_duplicate_repair",
    summary: "Repair historical duplicate Junction integration evidence",
    vaultRoot,
    mutate: async ({ batch }) => {
      for (const shard of plan.shards) {
        await batch.stageTextWrite(shard.relativePath, shard.content, {
          allowAppendOnlyJsonl: true,
          expectedTargetReceipt: shard.expectedReceipt,
          overwrite: true,
        });
      }

      const touchedPaths = plan.shards.map((shard) => shard.relativePath);
      const audit = await emitAuditRecord({
        action: "vault_repair",
        batch,
        changes: touchedPaths.map((path) => ({ op: "update" as const, path })),
        commandName: "core.repairJunctionEvidenceDuplicates",
        files: touchedPaths,
        occurredAt: now,
        summary:
          `Filtered ${plan.candidatePartCount} redundant Junction evidence part(s) ` +
          `across ${plan.candidateRowCount} ingest row(s); ` +
          `evidenceBytes=${plan.candidateEvidenceBytes}.`,
        vaultRoot,
      });

      return buildResult(plan, "apply", audit.relativePath);
    },
  });
}

function buildResult(
  plan: JunctionEvidenceRepairPlan,
  mode: "apply" | "dry-run",
  auditPath: string | null,
): JunctionEvidenceDuplicateRepairResult {
  const touchedPaths = plan.shards.map((shard) => shard.relativePath);
  return {
    auditPath,
    blockedReason: plan.blockedReason,
    candidateEvidenceBytes: plan.candidateEvidenceBytes,
    candidatePartCount: plan.candidatePartCount,
    candidateRowCount: plan.candidateRowCount,
    candidateShardCount: plan.shards.length,
    hasWork: plan.shards.length > 0,
    mode,
    mutated: mode === "apply" && auditPath !== null,
    revisionProtectedPartCount: plan.revisionProtectedPartCount,
    skippedArchivedShardCount: plan.skippedArchivedShardCount,
    scannedEventRowCount: plan.scannedEventRowCount,
    scannedIngestBytes: plan.scannedIngestBytes,
    scannedIngestRowCount: plan.scannedIngestRowCount,
    scannedIngestShardCount: plan.scannedIngestShardCount,
    touchedPaths,
  };
}

async function planJunctionEvidenceRepair(input: {
  maxEventRows: number;
  maxIngestBytes: number;
  maxIngestShards: number;
  vaultRoot: string;
}): Promise<JunctionEvidenceRepairPlan> {
  const relativePaths = (await walkVaultFiles(
    input.vaultRoot,
    VAULT_LAYOUT.integrationIngestLedgerDirectory,
    { extension: ".jsonl" },
  )).sort();
  const archivedPaths = [
    ...await walkVaultFiles(
      input.vaultRoot,
      VAULT_LAYOUT.integrationIngestLedgerDirectory,
      { extension: ".jsonl.gz" },
    ),
    ...await walkVaultFiles(
      input.vaultRoot,
      VAULT_LAYOUT.integrationIngestLedgerDirectory,
      { extension: ".jsonl.zip" },
    ),
  ];

  if (relativePaths.length > input.maxIngestShards) {
    return {
      ...emptyPlan("ingest_bounds_exceeded", 0),
      skippedArchivedShardCount: archivedPaths.length,
    };
  }

  const shards: ParsedIngestShard[] = [];
  let scannedIngestBytes = 0;
  let scannedIngestRowCount = 0;
  const referencedEventIds = new Set<string>();

  for (const relativePath of relativePaths) {
    const archivePaths = [`${relativePath}.gz`, `${relativePath}.zip`];
    for (const archivePath of archivePaths) {
      if (await pathExists(resolveVaultPath(input.vaultRoot, archivePath).absolutePath)) {
        throw new VaultError(
          "INTEGRATION_INGEST_SHARD_REPRESENTATION_CONFLICT",
          `Integration ingest shard "${relativePath}" has multiple physical representations.`,
          { relativePath },
        );
      }
    }

    const absolutePath = resolveVaultPath(input.vaultRoot, relativePath).absolutePath;
    const shardSize = (await stat(absolutePath)).size;
    if (scannedIngestBytes + shardSize > input.maxIngestBytes) {
      return {
        ...emptyPlan("ingest_bounds_exceeded", shards.length),
        scannedIngestBytes,
        scannedIngestRowCount,
        skippedArchivedShardCount: archivedPaths.length,
      };
    }
    const shard = await readIngestShard(input.vaultRoot, relativePath);
    scannedIngestBytes += shard.byteLength;
    scannedIngestRowCount += shard.rows.length;
    if (scannedIngestBytes > input.maxIngestBytes) {
      return {
        ...emptyPlan("ingest_bounds_exceeded", relativePaths.length),
        scannedIngestBytes,
        scannedIngestRowCount,
        scannedIngestShardCount: shards.length + 1,
        skippedArchivedShardCount: archivedPaths.length,
      };
    }
    shards.push(shard);
    for (const row of shard.rows) {
      if (isRepairEligibleRecord(row.record)) {
        for (const output of row.record.outputs.events) {
          referencedEventIds.add(output.id);
        }
      }
    }
  }

  const eventProof = await inspectEventRevisionProof({
    maxEventRows: input.maxEventRows,
    referencedEventIds,
    vaultRoot: input.vaultRoot,
  });
  if (eventProof.blocked) {
    return {
      ...emptyPlan("event_bounds_exceeded", shards.length),
      scannedEventRowCount: eventProof.scannedRowCount,
      scannedIngestBytes,
      scannedIngestRowCount,
      scannedIngestShardCount: shards.length,
      skippedArchivedShardCount: archivedPaths.length,
    };
  }

  const inspectedShards = shards.map((shard) =>
    planShard(shard, eventProof.unsafeEventIds)
  );
  const plannedShards = inspectedShards.filter((shard) => shard.candidatePartCount > 0);

  return {
    blockedReason: null,
    candidateEvidenceBytes: plannedShards.reduce(
      (total, shard) => total + shard.candidateEvidenceBytes,
      0,
    ),
    candidatePartCount: plannedShards.reduce(
      (total, shard) => total + shard.candidatePartCount,
      0,
    ),
    candidateRowCount: plannedShards.reduce(
      (total, shard) => total + shard.candidateRowCount,
      0,
    ),
    revisionProtectedPartCount: inspectedShards.reduce(
      (total, shard) => total + shard.revisionProtectedPartCount,
      0,
    ),
    scannedEventRowCount: eventProof.scannedRowCount,
    scannedIngestBytes,
    scannedIngestRowCount,
    scannedIngestShardCount: shards.length,
    skippedArchivedShardCount: archivedPaths.length,
    shards: plannedShards,
  };
}

function emptyPlan(
  blockedReason: JunctionEvidenceRepairPlan["blockedReason"],
  scannedIngestShardCount: number,
): JunctionEvidenceRepairPlan {
  return {
    blockedReason,
    candidateEvidenceBytes: 0,
    candidatePartCount: 0,
    candidateRowCount: 0,
    revisionProtectedPartCount: 0,
    skippedArchivedShardCount: 0,
    scannedEventRowCount: 0,
    scannedIngestBytes: 0,
    scannedIngestRowCount: 0,
    scannedIngestShardCount,
    shards: [],
  };
}

async function readIngestShard(
  vaultRoot: string,
  relativePath: string,
): Promise<ParsedIngestShard> {
  const absolutePath = resolveVaultPath(vaultRoot, relativePath).absolutePath;
  const content = await readFile(absolutePath, "utf8");
  const bytes = Buffer.from(content, "utf8");
  const rows: ParsedIngestRow[] = [];
  const seenIds = new Set<string>();

  for (const [index, rawLine] of content.split("\n").entries()) {
    if (rawLine.length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(rawLine);
    } catch {
      throw new VaultError("VAULT_INVALID_JSONL", `Invalid JSON on line ${index + 1}.`, {
        lineNumber: index + 1,
        relativePath,
      });
    }
    const parsed = integrationIngestRecordSchema.safeParse(raw);
    if (!parsed.success) {
      throw new VaultError(
        "INTEGRATION_INGEST_INVALID",
        `Stored integration ingest in "${relativePath}" failed validation.`,
        { lineNumber: index + 1, relativePath },
      );
    }
    assertIntegrationIngestRecordIntegrity(parsed.data);
    if (integrationIngestShardPath(parsed.data.importedAt) !== relativePath) {
      throw new VaultError(
        "INTEGRATION_INGEST_SHARD_INVALID",
        `Stored integration ingest in "${relativePath}" belongs to another shard.`,
        { lineNumber: index + 1, relativePath },
      );
    }
    if (seenIds.has(parsed.data.id)) {
      throw new VaultError(
        "INTEGRATION_INGEST_ID_CONFLICT",
        `Integration ingest id is duplicated in "${relativePath}".`,
        { lineNumber: index + 1, relativePath },
      );
    }
    seenIds.add(parsed.data.id);
    rows.push({ rawLine, record: parsed.data });
  }

  return {
    byteLength: bytes.byteLength,
    expectedReceipt: receiptFor(bytes),
    relativePath,
    rows,
  };
}

async function inspectEventRevisionProof(input: {
  maxEventRows: number;
  referencedEventIds: ReadonlySet<string>;
  vaultRoot: string;
}): Promise<{
  blocked: boolean;
  scannedRowCount: number;
  unsafeEventIds: ReadonlySet<string>;
}> {
  if (input.referencedEventIds.size === 0) {
    return { blocked: false, scannedRowCount: 0, unsafeEventIds: new Set() };
  }

  const occurrenceCountById = new Map<string, number>();
  const unsafeEventIds = new Set<string>();
  let scannedRowCount = 0;
  const relativePaths = (await walkVaultFiles(
    input.vaultRoot,
    VAULT_LAYOUT.eventLedgerDirectory,
    { extension: ".jsonl" },
  )).sort();

  for (const relativePath of relativePaths) {
    const visit = await visitJsonlRecordsInterruptible({
      vaultRoot: input.vaultRoot,
      relativePath,
      shouldContinue: () => scannedRowCount < input.maxEventRows,
      visit: (raw) => {
        scannedRowCount += 1;
        if (!isRecordWithReferencedId(raw, input.referencedEventIds)) return;
        const parsed = eventRecordSchema.safeParse(raw);
        if (!parsed.success) {
          unsafeEventIds.add(raw.id);
          return;
        }
        const count = (occurrenceCountById.get(parsed.data.id) ?? 0) + 1;
        occurrenceCountById.set(parsed.data.id, count);
        if (count > 1 || eventSpineRevision(parsed.data) > 1) {
          unsafeEventIds.add(parsed.data.id);
        }
      },
    });
    if (visit.interrupted) {
      return { blocked: true, scannedRowCount, unsafeEventIds: new Set() };
    }
  }

  for (const eventId of input.referencedEventIds) {
    if (!occurrenceCountById.has(eventId)) unsafeEventIds.add(eventId);
  }
  return { blocked: false, scannedRowCount, unsafeEventIds };
}

function planShard(
  shard: ParsedIngestShard,
  unsafeEventIds: ReadonlySet<string>,
): PlannedIngestShard {
  const seenFingerprints = new Set<string>();
  const seenEventLinks = new Set<string>();
  const outputLines: string[] = [];
  let candidateEvidenceBytes = 0;
  let candidatePartCount = 0;
  let candidateRowCount = 0;
  let revisionProtectedPartCount = 0;

  for (const row of shard.rows) {
    const record = row.record;
    const eligible = isRepairEligibleRecord(record);
    const removedRoles = new Set<string>();
    const retainedParts = record.parts.filter((part) => {
      const fingerprint = scopedFingerprint(record, part);
      const linkedEventIds = record.outputs.events
        .filter((output) => output.roles.includes(part.role))
        .map((output) => output.id);
      const revisionProtected = linkedEventIds.some((eventId) => unsafeEventIds.has(eventId));
      const redundant = eligible
        && !revisionProtected
        && seenFingerprints.has(fingerprint)
        && linkedEventIds.every((eventId) =>
          seenEventLinks.has(eventLinkFingerprint(fingerprint, eventId))
        );

      if (revisionProtected && seenFingerprints.has(fingerprint)) {
        revisionProtectedPartCount += 1;
      }
      if (redundant) {
        removedRoles.add(part.role);
        candidatePartCount += 1;
        candidateEvidenceBytes += part.byteSize;
        return false;
      }

      seenFingerprints.add(fingerprint);
      for (const eventId of linkedEventIds) {
        seenEventLinks.add(eventLinkFingerprint(fingerprint, eventId));
      }
      return true;
    });

    if (removedRoles.size === 0) {
      outputLines.push(row.rawLine);
      continue;
    }

    candidateRowCount += 1;
    const rewritten = integrationIngestRecordSchema.parse({
      ...record,
      schemaVersion: FILTERED_INTEGRATION_INGEST_SCHEMA_VERSION,
      evidenceRetention: "filtered",
      parts: retainedParts,
      outputs: {
        ...record.outputs,
        events: record.outputs.events.map((output) => ({
          ...output,
          roles: output.roles.filter((role) => !removedRoles.has(role)),
        })),
      },
    });
    assertIntegrationIngestRecordIntegrity(rewritten);
    outputLines.push(JSON.stringify(rewritten));
  }

  return {
    candidateEvidenceBytes,
    candidatePartCount,
    candidateRowCount,
    content: outputLines.length > 0 ? `${outputLines.join("\n")}\n` : "",
    expectedReceipt: shard.expectedReceipt,
    relativePath: shard.relativePath,
    revisionProtectedPartCount,
  };
}

function isRepairEligibleRecord(record: IntegrationIngestRecord): boolean {
  return record.provider === "junction"
    && record.source === "device"
    && typeof record.accountId === "string"
    && record.accountId.length > 0
    && record.outputs.eventIdsComplete
    && record.outputs.sampleIdsComplete
    && record.outputs.sampleIds.length === 0;
}

function scopedFingerprint(
  record: IntegrationIngestRecord,
  part: IntegrationIngestRecord["parts"][number],
): string {
  return JSON.stringify([
    record.provider,
    record.accountId ?? null,
    integrationEvidenceFingerprint(part),
  ]);
}

function eventLinkFingerprint(fingerprint: string, eventId: string): string {
  return `${fingerprint}\u0000${eventId}`;
}

function receiptFor(bytes: Uint8Array): CommittedPayloadReceipt {
  return {
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function isRecordWithReferencedId(
  value: unknown,
  referencedIds: ReadonlySet<string>,
): value is Record<string, unknown> & { id: string } {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && "id" in value
    && typeof value.id === "string"
    && referencedIds.has(value.id);
}
