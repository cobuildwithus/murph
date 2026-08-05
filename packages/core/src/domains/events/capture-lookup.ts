import { createHash } from "node:crypto";

import type { EventRecord } from "@murphai/contracts";

import { VaultError } from "../../errors.ts";
import { readJsonFile } from "../../fs.ts";
import { normalizeRelativeVaultPath } from "../../path-safety.ts";

export const CAPTURE_LOOKUP_BACKED_TAG = "capture-lookup-backed";
export const CAPTURE_LOOKUP_INDEX_PATH = "derived/captures/generated-image-lookups.json";
export const CAPTURE_LOOKUP_SCHEMA = "murph.capture-lookup.v1";

export interface StoredCaptureLookup {
  attachmentRef: string;
  eventId: string;
  ledgerFile: string;
  manifestPath: string | null;
  retiredAt?: string;
}

export interface StoredCaptureLookupIndex {
  entries: Record<string, StoredCaptureLookup>;
  schema: typeof CAPTURE_LOOKUP_SCHEMA;
}

export function isCaptureLookupBackedEvent(record: EventRecord): boolean {
  return record.kind === "note" && record.tags?.includes(CAPTURE_LOOKUP_BACKED_TAG) === true;
}

export function captureLookupPathForKey(
  lookupKey: string,
): { lookupKeyHash: string; lookupPath: string } {
  const normalized = lookupKey.trim();
  if (!normalized) {
    throw new VaultError("INVALID_INPUT", "Capture lookup key is required.");
  }

  return {
    lookupKeyHash: createHash("sha256")
      .update("murph.capture-lookup.v1")
      .update("\0")
      .update(normalized)
      .digest("hex"),
    lookupPath: CAPTURE_LOOKUP_INDEX_PATH,
  };
}

function readStringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNullableStringField(
  record: Record<string, unknown>,
  field: string,
): string | null | undefined {
  const value = record[field];
  if (value === null) {
    return null;
  }
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function parseStoredCaptureLookup(input: {
  lookupPath: string;
  value: unknown;
}): StoredCaptureLookup {
  if (input.value === null || typeof input.value !== "object" || Array.isArray(input.value)) {
    throw new VaultError("CAPTURE_LOOKUP_INVALID", "Capture lookup record is invalid.", {
      relativePath: input.lookupPath,
    });
  }

  const record = input.value as Record<string, unknown>;
  const eventId = readStringField(record, "eventId");
  const ledgerFile = readStringField(record, "ledgerFile");
  const attachmentRef = readStringField(record, "attachmentRef");
  const manifestPath = readNullableStringField(record, "manifestPath");
  const retiredAt = record.retiredAt === undefined
    ? undefined
    : readStringField(record, "retiredAt");

  if (
    !eventId ||
    !ledgerFile ||
    !attachmentRef ||
    manifestPath === undefined ||
    (
      record.retiredAt !== undefined &&
      (
        !retiredAt ||
        Number.isNaN(Date.parse(retiredAt)) ||
        new Date(retiredAt).toISOString() !== retiredAt
      )
    )
  ) {
    throw new VaultError("CAPTURE_LOOKUP_INVALID", "Capture lookup record is invalid.", {
      relativePath: input.lookupPath,
    });
  }

  const normalizedLedgerFile = normalizeRelativeVaultPath(ledgerFile);
  if (!normalizedLedgerFile.startsWith("ledger/events/") || !normalizedLedgerFile.endsWith(".jsonl")) {
    throw new VaultError("CAPTURE_LOOKUP_INVALID", "Capture lookup ledger file is invalid.", {
      relativePath: input.lookupPath,
    });
  }

  return {
    attachmentRef: normalizeRelativeVaultPath(attachmentRef),
    eventId,
    ledgerFile: normalizedLedgerFile,
    manifestPath: manifestPath === null ? null : normalizeRelativeVaultPath(manifestPath),
    ...(retiredAt ? { retiredAt } : {}),
  };
}

export function parseStoredCaptureLookupIndex(input: {
  lookupPath: string;
  value: unknown;
}): StoredCaptureLookupIndex {
  if (input.value === null || typeof input.value !== "object" || Array.isArray(input.value)) {
    throw new VaultError("CAPTURE_LOOKUP_INVALID", "Capture lookup index is invalid.", {
      relativePath: input.lookupPath,
    });
  }

  const record = input.value as Record<string, unknown>;
  const schema = readStringField(record, "schema");
  const entries = record.entries;
  if (
    schema !== CAPTURE_LOOKUP_SCHEMA ||
    entries === null ||
    typeof entries !== "object" ||
    Array.isArray(entries)
  ) {
    throw new VaultError("CAPTURE_LOOKUP_INVALID", "Capture lookup index is invalid.", {
      relativePath: input.lookupPath,
    });
  }

  return {
    entries: Object.fromEntries(
      Object.entries(entries).map(([lookupKeyHash, value]) => [
        lookupKeyHash,
        parseStoredCaptureLookup({ lookupPath: input.lookupPath, value }),
      ]),
    ),
    schema: CAPTURE_LOOKUP_SCHEMA,
  };
}

export async function readStoredCaptureLookupIndex(input: {
  vaultRoot: string;
}): Promise<StoredCaptureLookupIndex> {
  let value: unknown;
  try {
    value = await readJsonFile(input.vaultRoot, CAPTURE_LOOKUP_INDEX_PATH);
  } catch (error) {
    if (error instanceof VaultError && error.code === "VAULT_FILE_MISSING") {
      return {
        entries: {},
        schema: CAPTURE_LOOKUP_SCHEMA,
      };
    }
    throw error;
  }

  return parseStoredCaptureLookupIndex({
    lookupPath: CAPTURE_LOOKUP_INDEX_PATH,
    value,
  });
}

export async function readStoredCaptureLookup(input: {
  lookupKey: string;
  vaultRoot: string;
}): Promise<{ lookup: StoredCaptureLookup; lookupPath: string } | null> {
  const { lookupKeyHash, lookupPath } = captureLookupPathForKey(input.lookupKey);
  const index = await readStoredCaptureLookupIndex({ vaultRoot: input.vaultRoot });
  const lookup = index.entries[lookupKeyHash];
  return lookup ? { lookup, lookupPath } : null;
}
