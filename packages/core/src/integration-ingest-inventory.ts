import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { VaultError } from "./errors.ts";
import { resolveVaultPath } from "./path-safety.ts";
import { isErrnoException } from "./types.ts";

export interface IngestRowRange {
  offset: number;
  length: number;
}

interface IngestFileFence {
  identity: string;
  fingerprint: string;
  byteLength: number;
  missing: boolean;
}

export interface IntegrationIngestInventory {
  vaultRoot: string;
  logicalPath: string;
  fence: IngestFileFence;
  byId: Map<string, IngestRowRange>;
  byEvidence: Map<string, Map<string, IngestRowRange | IngestRowRange[]>>;
  rowCount: number;
  referenceCount: number;
}

// Match the event identity cache's single-resident-vault policy. Count references
// as well as rows so an unusually wide evidence row cannot retain unbounded keys.
const MAX_ROWS = 100_000;
const MAX_REFERENCES = 500_000;
let resident: IntegrationIngestInventory | undefined;

export function invalidateIntegrationIngestInventory(vaultRoot: string): void {
  if (resident?.vaultRoot === vaultRoot) resident = undefined;
}

export async function readIngestFileFence(vaultRoot: string, logicalPath: string): Promise<IngestFileFence> {
  const root = await stat(vaultRoot);
  const rootIdentity = [root.dev, root.ino, root.birthtimeMs].join("\0");
  try {
    const file = await stat(resolveVaultPath(vaultRoot, logicalPath).absolutePath);
    const identity = [rootIdentity, file.dev, file.ino].join("\0");
    return {
      identity,
      fingerprint: [identity, file.size, file.mtimeMs, file.ctimeMs].join("\0"),
      byteLength: file.size,
      missing: false,
    };
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") throw error;
    return { identity: rootIdentity, fingerprint: rootIdentity, byteLength: 0, missing: true };
  }
}

export function findIntegrationIngestInventory(
  vaultRoot: string,
  logicalPath: string,
  fence: IngestFileFence,
): IntegrationIngestInventory | undefined {
  if (resident?.vaultRoot !== vaultRoot || resident.logicalPath !== logicalPath
    || resident.fence.fingerprint !== fence.fingerprint) resident = undefined;
  return resident;
}

export function retainIntegrationIngestInventory(inventory: IntegrationIngestInventory): void {
  resident = inventory.rowCount <= MAX_ROWS && inventory.referenceCount <= MAX_REFERENCES
    ? inventory : undefined;
}

export function addIntegrationIngestInventoryRow(
  inventory: IntegrationIngestInventory,
  id: string,
  range: IngestRowRange,
  evidenceScope: string,
  evidenceKeys: readonly string[],
): boolean {
  inventory.rowCount += 1;
  inventory.referenceCount += evidenceKeys.length;
  if (id.length > 256 || inventory.byId.has(id)
    || inventory.rowCount > MAX_ROWS || inventory.referenceCount > MAX_REFERENCES) return false;
  inventory.byId.set(id, range);
  let evidence = inventory.byEvidence.get(evidenceScope);
  if (!evidence) {
    evidence = new Map();
    inventory.byEvidence.set(evidenceScope, evidence);
  }
  for (const key of evidenceKeys) {
    const ranges = evidence.get(key);
    if (Array.isArray(ranges)) ranges.push(range);
    else evidence.set(key, ranges ? [ranges, range] : range);
  }
  return true;
}

// Byte offsets include CRLF and multibyte payloads. Visit rows synchronously
// within each chunk so scanning does not allocate a promise for every row.
export async function readPlainIngestRows(
  absolutePath: string,
  maxRowBytes: number,
  visit: (row: { line: Buffer; range: IngestRowRange; terminated: boolean }) => void,
): Promise<void> {
  let offset = 0;
  let chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of createReadStream(absolutePath, { highWaterMark: 1024 * 1024 })) {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(0x0a, start);
      const end = newline < 0 ? chunk.length : newline;
      const segment = chunk.subarray(start, end);
      length += segment.length;
      if (length > maxRowBytes) throw new VaultError("INTEGRATION_INGEST_INVALID", "Integration ingest row exceeds the byte limit.");
      if (newline < 0) {
        chunks.push(segment);
        break;
      }
      const line = chunks.length === 0 ? segment : Buffer.concat([...chunks, segment], length);
      visit({ line, range: { offset, length }, terminated: true });
      offset += length + 1;
      if (chunks.length > 0) chunks = [];
      length = 0;
      start = end + 1;
    }
  }
  if (length > 0) {
    visit({ line: Buffer.concat(chunks, length), range: { offset, length }, terminated: false });
  }
}
