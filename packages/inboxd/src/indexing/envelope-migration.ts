import { isDeepStrictEqual } from "node:util";

import {
  assertContract,
  inboxCaptureRecordSchema,
  type InboxCaptureRecord,
} from "@murphai/contracts";
import {
  applyCanonicalWriteBatch,
  listWriteOperationMetadataPaths,
  readJsonlRecords,
  readStoredWriteOperation,
  safeStatAndHashVaultFile,
  VAULT_LAYOUT,
  walkVaultFiles,
} from "@murphai/core";

import {
  buildInboxCaptureLedgerPathForOccurredAt,
  buildInboxCaptureRecord,
  buildLegacyInboxCaptureRecord,
  INBOX_CAPTURE_LEDGER_DIRECTORY,
} from "./persist/canonical-records.js";
import { readLegacyInboxCaptureSnapshot } from "./persist.js";

const DEFAULT_MAX_FILES = 250;

interface MigrationCandidate {
  byteLength: number;
  ledgerPath: string;
  migratedRecord: InboxCaptureRecord;
  relativePath: string;
  sha256: string;
}

interface MigrationDetection {
  activeOperationCount: number;
  blockerCount: number;
  candidateBytes: number;
  candidates: MigrationCandidate[];
  mismatchCount: number;
  missingLedgerCount: number;
  scannedEnvelopeCount: number;
}

export interface InboxEnvelopeMigrationResult {
  activeOperationCount: number;
  blockerCount: number;
  candidateBytes: number;
  candidateCount: number;
  deletedBytes: number;
  deletedCount: number;
  hasMore: boolean;
  hasWork: boolean;
  mismatchCount: number;
  missingLedgerCount: number;
  mode: "apply" | "dry-run";
  mutated: boolean;
  scannedEnvelopeCount: number;
}

export async function runInboxEnvelopeMigration(input: {
  apply?: boolean;
  maxFiles?: number;
  vaultRoot: string;
}): Promise<InboxEnvelopeMigrationResult> {
  const detection = await detectInboxEnvelopeMigration(input.vaultRoot);
  const mode = input.apply === true ? "apply" : "dry-run";
  const maxFiles = normalizeMaxFiles(input.maxFiles);
  const selected = detection.candidates.slice(0, maxFiles);
  const base = {
    activeOperationCount: detection.activeOperationCount,
    blockerCount: detection.blockerCount,
    candidateBytes: detection.candidateBytes,
    candidateCount: detection.candidates.length,
    hasMore: detection.candidates.length > selected.length,
    hasWork: detection.candidates.length > 0,
    mismatchCount: detection.mismatchCount,
    missingLedgerCount: detection.missingLedgerCount,
    mode,
    scannedEnvelopeCount: detection.scannedEnvelopeCount,
  } as const;

  if (mode === "dry-run" || selected.length === 0 || detection.blockerCount > 0) {
    return {
      ...base,
      deletedBytes: 0,
      deletedCount: 0,
      mutated: false,
    };
  }

  await applyCanonicalWriteBatch({
    vaultRoot: input.vaultRoot,
    operationType: "inbox_envelope_migration",
    summary: `Removed ${selected.length} redundant inbox capture envelope(s).`,
    audit: {
      action: "vault_repair",
      commandName: "inboxd.runInboxEnvelopeMigration",
      summary: `Removed ${selected.length} ledger-redundant inbox capture envelope(s).`,
    },
    jsonlAppends: selected.map((candidate) => ({
      record: candidate.migratedRecord,
      relativePath: candidate.ledgerPath,
    })),
    deletes: selected.map((candidate) => ({
      allowRaw: true,
      expectedTargetReceipt: {
        byteLength: candidate.byteLength,
        sha256: candidate.sha256,
      },
      relativePath: candidate.relativePath,
    })),
  });

  return {
    ...base,
    deletedBytes: selected.reduce((total, candidate) => total + candidate.byteLength, 0),
    deletedCount: selected.length,
    mutated: true,
  };
}

async function detectInboxEnvelopeMigration(vaultRoot: string): Promise<MigrationDetection> {
  const recordsByEnvelopePath = await readLegacyRecordsByEnvelopePath(vaultRoot);
  const activeEnvelopePaths = await readActiveEnvelopePaths(vaultRoot);
  const envelopePaths = (await walkVaultFiles(vaultRoot, VAULT_LAYOUT.rawInboxDirectory))
    .filter((relativePath) => relativePath.endsWith("/envelope.json"))
    .sort();
  const candidates: MigrationCandidate[] = [];
  let activeOperationCount = 0;
  let mismatchCount = 0;
  let missingLedgerCount = 0;

  for (const relativePath of envelopePaths) {
    if (activeEnvelopePaths.has(relativePath)) {
      activeOperationCount += 1;
      continue;
    }

    const records = recordsByEnvelopePath.get(relativePath) ?? [];
    if (records.length !== 1) {
      missingLedgerCount += 1;
      continue;
    }

    const integrity = await safeStatAndHashVaultFile(vaultRoot, relativePath);
    if (integrity.kind !== "ok") {
      mismatchCount += 1;
      continue;
    }

    let snapshot: Awaited<ReturnType<typeof readLegacyInboxCaptureSnapshot>> = null;
    try {
      snapshot = await readLegacyInboxCaptureSnapshot({
        relativePath,
        vaultRoot,
      });
    } catch {
      mismatchCount += 1;
      continue;
    }
    if (!snapshot) {
      mismatchCount += 1;
      continue;
    }
    const reconstructed = buildLegacyInboxCaptureRecord({
      envelopePath: relativePath,
      eventId: snapshot.eventId,
      inbound: snapshot.input,
      stored: snapshot.stored,
    });
    if (!isDeepStrictEqual(reconstructed, records[0])) {
      mismatchCount += 1;
      continue;
    }

    candidates.push({
      byteLength: integrity.integrity.byteSize,
      ledgerPath: buildInboxCaptureLedgerPathForOccurredAt(records[0].occurredAt),
      migratedRecord: buildInboxCaptureRecord({
        eventId: snapshot.eventId,
        inbound: snapshot.input,
        stored: snapshot.stored,
      }),
      relativePath,
      sha256: integrity.integrity.sha256,
    });
  }

  return {
    activeOperationCount,
    blockerCount: activeOperationCount + mismatchCount + missingLedgerCount,
    candidateBytes: candidates.reduce((total, candidate) => total + candidate.byteLength, 0),
    candidates,
    mismatchCount,
    missingLedgerCount,
    scannedEnvelopeCount: envelopePaths.length,
  };
}

async function readLegacyRecordsByEnvelopePath(
  vaultRoot: string,
): Promise<Map<string, InboxCaptureRecord[]>> {
  const recordsByPath = new Map<string, InboxCaptureRecord[]>();
  const ledgerPaths = await walkVaultFiles(vaultRoot, INBOX_CAPTURE_LEDGER_DIRECTORY, {
    extension: ".jsonl",
  });

  for (const ledgerPath of ledgerPaths) {
    const records = await readJsonlRecords({ relativePath: ledgerPath, vaultRoot });
    for (const [index, value] of records.entries()) {
      const record = assertContract<InboxCaptureRecord>(
        inboxCaptureRecordSchema,
        value,
        `inbox capture record at ${ledgerPath}#${index + 1}`,
      );
      if (record.schemaVersion !== "murph.inbox-capture.v1") {
        continue;
      }
      const existing = recordsByPath.get(record.envelopePath) ?? [];
      existing.push(record);
      recordsByPath.set(record.envelopePath, existing);
    }
  }
  return recordsByPath;
}

async function readActiveEnvelopePaths(vaultRoot: string): Promise<Set<string>> {
  const active = new Set<string>();
  for (const metadataPath of await listWriteOperationMetadataPaths(vaultRoot)) {
    try {
      const operation = await readStoredWriteOperation(vaultRoot, metadataPath);
      if (operation.status === "committed" || operation.status === "rolled_back") {
        continue;
      }
      for (const action of operation.actions) {
        if (
          (action.kind === "raw_copy" || action.kind === "delete") &&
          action.targetRelativePath.startsWith(`${VAULT_LAYOUT.rawInboxDirectory}/`) &&
          action.targetRelativePath.endsWith("/envelope.json")
        ) {
          active.add(action.targetRelativePath);
        }
      }
    } catch {
      // Invalid operation metadata is already reported by vault validation. It
      // must not make an otherwise unrelated envelope eligible for deletion.
      return new Set(
        (await walkVaultFiles(vaultRoot, VAULT_LAYOUT.rawInboxDirectory))
          .filter((relativePath) => relativePath.endsWith("/envelope.json")),
      );
    }
  }
  return active;
}

function normalizeMaxFiles(value: number | undefined): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, DEFAULT_MAX_FILES)
    : DEFAULT_MAX_FILES;
}
